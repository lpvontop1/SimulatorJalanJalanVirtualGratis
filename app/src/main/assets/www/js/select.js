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
    _fetching: false, _fetchedBoxes: new Set(), _tappedAt: 0,
    _refetchTimer: null, _pendingRefetch: false,
    covered: new Set() // tile yang datanya pasti sudah masuk graph (dibagikan ke WorldExpander)
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
      Select.map.map.on('zoomend moveend', onViewMoved);
      attachTapDetector(Select.map.map, onTap);
    }
    // dua tahap: segera + setelah animasi layar selesai (anti peta kosong/bergeser)
    setTimeout(function () { if (Select.map) Select.map.map.invalidateSize(); }, 60);
    setTimeout(function () { if (Select.map) Select.map.map.invalidateSize(); }, 420);
    updatePanel();
    refreshZoomHint();
    ensureData();
  };

  /*
   * PENTING: setiap kali pemain menggeser/memperbesar peta, data jalan untuk
   * area BARU harus dimuat — kalau tidak, tile tampak tapi graf kosong dan
   * ketukan jalan tidak bisa dipilih (bug "peta tampil tapi tak bisa klik").
   */
  function onViewMoved() {
    refreshZoomHint();
    if (Select._refetchTimer) clearTimeout(Select._refetchTimer);
    Select._refetchTimer = setTimeout(function () {
      Select._refetchTimer = null;
      if (root.UI.current === 'screen-select') ensureData();
    }, 650);
  }

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
    if (Select.graph && Select._fetchedBoxes.has(key)) return; // area ini sudah termuat
    if (Select.graph && Select.graph.ways.size >= C.MAX_GRAPH_TOTAL) {
      root.UI.toast('Area jelajahan sudah sangat luas — data tidak ditambah lagi');
      return;
    }
    fetchRoads(b, key);
  }

  /*
   * Deteksi tap andal utk Android WebView: beberapa WebView tidak selalu
   * memicu event 'click' sintetis setelah sentuhan (terutama setelah pinch).
   * Kita dengarkan pointerdown/up: bila jari bergerak < 26px dalam < 600ms,
   * perlakukan sebagai tap pada titik itu. Deduplikasi memakai _tappedAt.
   */
  function attachTapDetector(map, cb) {
    var el = map.getContainer();
    if (!window.PointerEvent) return;
    var down = null, multi = false;
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      if (down) { multi = true; return; } // sentuhan kedua (pinch) -> batal
      multi = false;
      down = { x: e.clientX, y: e.clientY, t: Date.now() };
    });
    el.addEventListener('pointermove', function (e) {
      if (!down) return;
      if (Math.abs(e.clientX - down.x) > 26 || Math.abs(e.clientY - down.y) > 26) multi = true;
    });
    el.addEventListener('pointercancel', function () { down = null; multi = true; });
    el.addEventListener('pointerup', function (e) {
      if (!down) return;
      var d = down; down = null;
      if (multi || e.pointerType === 'mouse') return;
      if (Date.now() - d.t > 600) return;
      if (Math.abs(e.clientX - d.x) > 26 || Math.abs(e.clientY - d.y) > 26) return;
      var rect = el.getBoundingClientRect();
      var pt = L.point(e.clientX - rect.left, e.clientY - rect.top);
      var latlng = map.containerPointToLatLng(pt);
      cb({ latlng: latlng, synthetic: true });
    });
  }

  function fetchRoads(b, key) {
    if (Select._fetching) return;
    Select._fetching = true;
    var loading = $('select-loading'), errBox = $('select-error');
    if (loading) loading.classList.add('show');
    if (errBox) errBox.classList.remove('show');
    var s = b.getSouth(), w = b.getWest(), n = b.getNorth(), e = b.getEast();
    root.Net.fetchRoadBBox(s, w, n, e, { excludeService: false })
      .then(function (res) {
        // pengaman: hitung way drivable SEBELUM merge agar graf tidak membengkak
        var g = Select.graph || (Select.graph = new root.RoadGraph());
        var cnt = 0, els = res.json.elements || [];
        for (var i = 0; i < els.length; i++) {
          if (els[i].type === 'way' && g.isDrivable(els[i].tags || {})) cnt++;
        }
        if (cnt > C.MAX_GRAPH_WAYS) throw new Error('Terlalu besar');
        var kept = g.ways.size ? g.mergeFromOverpass(res.json) : g.buildFromOverpass(res.json);
        Select._fetchedBoxes.add(key);
        // tandai tile utuh yang sudah pasti tercakup (dipakai juga saat game)
        var t = C.EXPAND_TILE_DEG;
        for (var tx = Math.ceil(w / t - 1e-9); tx <= Math.floor(e / t + 1e-9); tx++) {
          for (var ty = Math.ceil(s / t - 1e-9); ty <= Math.floor(n / t + 1e-9); ty++) {
            Select.covered.add(tx + ':' + ty);
          }
        }
        Select._fetching = false;
        if (loading) loading.classList.remove('show');
        root.UI.toast('Data jalan termuat (+' + kept + ' ruas, via ' + res.via + ')');
      })
      .catch(function () {
        Select._fetching = false;
        if ($('select-loading')) $('select-loading').classList.remove('show');
        if (errBox) errBox.classList.add('show');
      });
  }

  Select.retry = function () {
    Select._fetchedBoxes = new Set();
    ensureData();
  };

  function onTap(e) {
    var now = Date.now();
    if (now - Select._tappedAt < (e.synthetic ? 800 : 350)) return; // anti dobel (klik sintetis vs klik browser)
    Select._tappedAt = now;
    if (Select.map.map.getZoom() < C.MIN_ZOOM_SELECT) {
      root.UI.toast('Perbesar peta dulu (zoom minimal ' + C.MIN_ZOOM_SELECT + ') untuk memilih titik');
      return;
    }
    showTapPulse(e.latlng.lat, e.latlng.lng); // respons visual setiap ketukan
    if (!Select.graph || Select.graph.ways.size === 0) {
      root.UI.toast('Data jalan masih dimuat, tunggu sebentar...');
      ensureData();
      return;
    }
    var snap = Select.graph.findNearest(e.latlng.lat, e.latlng.lng, C.SNAP_MAX_DIST_M);
    if (!snap) {
      // Kemungkinan besar area ini belum termuat — muat sekarang & beri tahu pemain
      var nearM = Select.graph.nearestDistM(e.latlng.lat, e.latlng.lng);
      if (nearM == null || nearM > C.OUT_OF_DATA_HINT_M) {
        root.UI.toast('Memuat data jalan area ini... ketuk ulang sebentar lagi');
        if (Select._refetchTimer) clearTimeout(Select._refetchTimer);
        Select._fetchedBoxes.clear();
        ensureData();
      } else {
        root.UI.toast('Titik itu bukan jalan! Ketuk tepat di atas jalan ya');
      }
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

  /* Pulse kecil di titik ketukan — umpan balik bahwa tap terdaftar */
  function showTapPulse(lat, lon) {
    if (!Select.map) return;
    var m = L.marker([lat, lon], {
      interactive: false, keyboard: false, zIndexOffset: 600,
      icon: L.divIcon({ className: 'tap-pulse', iconSize: [26, 26] })
    }).addTo(Select.map.map);
    setTimeout(function () { Select.map.map.removeLayer(m); }, 650);
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
      if (Select.map) Select.map.clearEndPin();
      root.Game.startGame();
    });
    root.UI.bindTap('btn-select-go', function () {
      if (!Select.start) { root.UI.toast('Pilih titik awal dulu di jalan!'); return; }
      root.Game.startGame();
    });
    root.UI.bindTap('select-guided', function () { Select.guidedToggle(); });
    root.UI.bindTap('select-car-chip', function () { UI_showCars(); });
    root.UI.bindTap('btn-select-retry', function () { Select.retry(); });
    // KUNCI: layar pilih lokasi harus menyiapkan peta + data SETIAP kali ditampilkan
    root.UI.onShow('screen-select', function () { Select.enter(); });
    paintGuided();
  };

  function UI_showMenu() { root.UI.show('screen-menu'); }
  function UI_showCars() {
    root.UI.show('screen-cars');
    var old = document.getElementById('btn-car-back');
    if (old) old.textContent = 'Kembali';
  }
})(typeof window !== 'undefined' ? window : globalThis);
