/* =========================================================
 * SelectFlow — layar pemilihan titik awal/akhir
 * Data jalan diambil dari Overpass API (OSM) sesuai area pandang.
 * ========================================================= */
(function (root) {
  'use strict';
  var C = root.CONFIG, U = root.Utils;

  var Select = {
    map: null, graph: null,
    start: null, end: null,
    _fetching: false, _cache: new Map(), _tappedAt: 0
  };
  root.Select = Select;

  function $(id) { return document.getElementById(id); }

  Select.enter = function () {
    if (!Select.map) {
      Select.map = new root.GameMap('select-map', {
        center: C.DEFAULT_CENTER, zoom: C.DEFAULT_ZOOM,
        carSvg: root.UI.currentCar().svg
      });
      Select.map.map.on('click', onTap);
      Select.map.map.on('zoomend moveend', refreshZoomHint);
    }
    setTimeout(function () { if (Select.map) Select.map.map.invalidateSize(); }, 60);
    updatePanel();
    refreshZoomHint();
    ensureData();
  };

  Select.leave = function () { /* peta dipertahankan agar cepat kembali */ };

  function refreshZoomHint() {
    if (!Select.map) return;
    var z = Select.map.map.getZoom();
    var warn = $('select-zoom-warn');
    if (warn) warn.classList.toggle('show', z < C.MIN_ZOOM_SELECT);
  }

  function ensureData() {
    if (!Select.map) return;
    var b = Select.map.map.getBounds();
    var key = [b.getSouth().toFixed(2), b.getWest().toFixed(2), b.getNorth().toFixed(2), b.getEast().toFixed(2)].join(',');
    if (Select.graph && Select._cacheKey === key) return;
    if (Select._cache.has(key)) {
      Select.graph = Select._cache.get(key);
      return;
    }
    fetchRoads(b, key);
  }

  function overpassQuery(b) {
    var s = b.getSouth().toFixed(5), w = b.getWest().toFixed(5),
        n = b.getNorth().toFixed(5), e = b.getEast().toFixed(5);
    return '[out:json][timeout:30];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|road|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](' +
      s + ',' + w + ',' + n + ',' + e + ');(._;>;);out body qt;';
  }

  function fetchRoads(b, key) {
    if (Select._fetching) return;
    Select._fetching = true;
    var loading = $('select-loading'), errBox = $('select-error');
    if (loading) loading.classList.add('show');
    if (errBox) errBox.classList.remove('show');
    var body = 'data=' + encodeURIComponent(overpassQuery(b));
    var done = function (g, kept, via) {
      Select.graph = g;
      Select._cache.set(key, g);
      Select._fetching = false;
      if (loading) loading.classList.remove('show');
      root.UI.toast('Data jalan termuat (' + kept + ' ruas, via ' + via + ')');
    };
    var attempt = function (idx) {
      if (idx >= C.OVERPASS_ENDPOINTS.length) { osmApiFallback(b, done, 0); return; }
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, C.OVERPASS_TIMEOUT_MS);
      fetch(C.OVERPASS_ENDPOINTS[idx], { method: 'POST', body: body, signal: ctrl.signal })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (json) {
          clearTimeout(timer);
          var g = new root.RoadGraph();
          var kept = g.buildFromOverpass(json);
          if (kept > C.MAX_GRAPH_WAYS) throw new Error('Terlalu besar');
          done(g, kept, 'Overpass');
        })
        .catch(function () { clearTimeout(timer); attempt(idx + 1); });
    };
    attempt(0);
  }

  /** Cadangan: API resmi OSM 0.6 (geometri utuh, tanpa filter — lebih besar tapi andal) */
  function osmApiFallback(b, done, idx) {
    var PAD = 0.004; // perluas agar jalan di tepi tetap utuh
    var s = (b.getSouth() - PAD).toFixed(5), w = (b.getWest() - PAD).toFixed(5),
        n = (b.getNorth() + PAD).toFixed(5), e = (b.getEast() + PAD).toFixed(5);
    var url = 'https://api.openstreetmap.org/api/0.6/map.json?bbox=' + w + ',' + s + ',' + e + ',' + n;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 60000);
    fetch(url, { signal: ctrl.signal })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (txt) {
        clearTimeout(timer);
        if (txt.indexOf('too many nodes') !== -1) throw new Error('too big');
        var json = JSON.parse(txt);
        var g = new root.RoadGraph();
        var kept = g.buildFromOverpass(json);
        if (!kept) throw new Error('kosong');
        done(g, kept, 'OSM API');
      })
      .catch(function () {
        clearTimeout(timer);
        var errBox = $('select-error');
        Select._fetching = false;
        if ($('select-loading')) $('select-loading').classList.remove('show');
        if (errBox) errBox.classList.add('show');
      });
  }

  Select.retry = function () {
    Select._cacheKey = null;
    ensureData();
  };

  function onTap(e) {
    var now = Date.now();
    if (now - Select._tappedAt < 350) return; // anti sentuhan ganda
    Select._tappedAt = now;
    if (Select.map.map.getZoom() < C.MIN_ZOOM_SELECT) {
      root.UI.toast('Perbesar peta dulu (zoom minimal ' + C.MIN_ZOOM_SELECT + ') untuk memilih titik');
      return;
    }
    if (!Select.graph) {
      root.UI.toast('Data jalan masih dimuat, tunggu sebentar...');
      ensureData();
      return;
    }
    var snap = Select.graph.findNearest(e.latlng.lat, e.latlng.lng, C.SNAP_MAX_DIST_M);
    if (!snap) {
      root.UI.toast('Titik itu bukan jalan! Ketuk tepat di atas jalan ya');
      return;
    }
    if (!Select.start || (Select.start && Select.end)) {
      Select.start = snap; Select.end = null;
      Select.map.setStartPin(snap.lat, snap.lon);
      Select.map.clearEndPin();
      Select.map.clearRoute();
      root.UI.toast('Titik awal ditandai. Sekarang ketuk titik akhir (atau lewati).');
    } else {
      Select.end = snap;
      Select.map.setEndPin(snap.lat, snap.lon);
      root.UI.toast('Titik akhir ditandai!');
    }
    updatePanel();
  }

  function updatePanel() {
    var hint = $('select-hint');
    var btnGo = $('btn-select-go');
    var btnSkip = $('btn-select-skip');
    var chip = $('select-route-info');
    if (Select.start && Select.end) {
      if (hint) hint.innerHTML = '<b>Titik akhir siap!</b><small>Tekan tombol hijau untuk mulai berkendara</small>';
      if (btnGo) btnGo.classList.add('ready');
    } else if (Select.start) {
      if (hint) hint.innerHTML = '<b>Pilih titik akhir</b><small>Ketuk jalan untuk tujuan — atau tekan "Tanpa Tujuan"</small>';
      if (btnGo) btnGo.classList.remove('ready');
    } else {
      if (hint) hint.innerHTML = '<b>Ketuk jalan untuk titik AWAL</b><small>Kamu akan mulai berkendara dari titik itu</small>';
      if (btnGo) btnGo.classList.remove('ready');
    }
    if (chip) {
      var d = Select.start && Select.end ? U.haversine(Select.start.lat, Select.start.lon, Select.end.lat, Select.end.lon) : null;
      chip.textContent = d ? ('Jarak udara ± ' + U.fmtDist(d)) : 'Rute bebas tanpa tujuan';
    }
  }

  Select.resetPoints = function () {
    Select.start = null; Select.end = null;
    if (Select.map) { Select.map.clearPins(); Select.map.clearRoute(); }
    updatePanel();
  };

  Select.guidedToggle = function () {
    var s = root.Settings.get();
    s.guided = !s.guided;
    root.Settings.save();
    paintGuided();
  };

  function paintGuided() {
    var el = $('select-guided');
    var s = root.Settings.get();
    if (el) {
      el.classList.toggle('on', s.guided);
      el.querySelector('span').textContent = s.guided ? 'Mode Dipandu: AKTIF' : 'Mode Dipandu: MATI';
    }
    var g = $('game-mode-badge');
    if (g) g.textContent = s.guided ? 'DIPANDU' : 'BEBAS';
  }
  Select.paintGuided = paintGuided;

  Select.init = function () {
    root.UI.bindTap('btn-select-back', function () { UI_showMenu(); });
    root.UI.bindTap('btn-select-reset', function () { Select.resetPoints(); });
    root.UI.bindTap('btn-select-skip', function () {
      Select.end = null;
      if (Select.map) Select.map.endMarker && Select.map.map.removeLayer(Select.map.endMarker);
      root.Game.startGame();
    });
    root.UI.bindTap('btn-select-go', function () {
      if (!Select.start) { root.UI.toast('Pilih titik awal dulu di jalan!'); return; }
      root.Game.startGame();
    });
    root.UI.bindTap('select-guided', function () { Select.guidedToggle(); });
    root.UI.bindTap('select-car-chip', function () { UI_showCars(); });
    root.UI.bindTap('btn-select-retry', function () { Select.retry(); });
    paintGuided();
  };

  function UI_showMenu() { root.UI.show('screen-menu'); }
  function UI_showCars() {
    root.UI.show('screen-cars');
    var old = document.getElementById('btn-car-back');
    if (old) old.textContent = 'Kembali';
  }
})(typeof window !== 'undefined' ? window : globalThis);
