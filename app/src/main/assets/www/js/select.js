/* =========================================================
 * SelectFlow — layar pemilihan titik awal/akhir (v1.1.0)
 *
 * PERBAIKAN BESAR (revisi user):
 *  - Peta BUKAN lagi memicu pengambilan data. Menggeser/zoom 100% bebas
 *    tanpa loading (bug lama: tiap geser = fetch Overpass viewport penuh
 *    yang bisa berjalan sangat lama / tidak selesai-selesai).
 *  - Ketuk peta = menaruh PIN mentah (tanpa perlu data jalan).
 *  - Data jalan hanya diambil SAAT menekan "Mulai" — bbox KECIL (±0.008°,
 *    sekitar 1.8 km) di sekitar pin, lalu pin di-snap ke jalan terdekat.
 *  - Ada dua cara masuk ke layar ini: "Pilih di Peta" atau "Tulis
 *    Koordinat" (screen-pickmode / screen-coords).
 * ========================================================= */
(function (root) {
  'use strict';
  var C = root.CONFIG, U = root.Utils;

  var Select = {
    map: null, graph: null,
    startRaw: null, endRaw: null,   // pin mentah hasil ketukan/koordinat {lat,lon}
    start: null, end: null,         // hasil snap ke jalan (dipakai Game)
    _launching: false,
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
      Select.map.map.on('zoomend moveend', refreshZoomHint);
      attachTapDetector(Select.map.map, onTap);
    }
    // dua tahap: segera + setelah animasi layar selesai (anti peta kosong/bergeser)
    setTimeout(function () { if (Select.map) Select.map.map.invalidateSize(); }, 60);
    setTimeout(function () { if (Select.map) Select.map.map.invalidateSize(); }, 420);
    refreshZoomHint();
    updatePanel();
  };

  Select.leave = function () { /* peta dipertahankan agar cepat kembali */ };

  function refreshZoomHint() {
    if (!Select.map) return;
    var z = Select.map.map.getZoom();
    var warn = $('select-zoom-warn');
    if (warn) warn.classList.toggle('show', z < C.MIN_ZOOM_SELECT);
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

  function onTap(e) {
    var now = Date.now();
    if (now - (Select._tappedAt || 0) < (e.synthetic ? 800 : 350)) return; // anti dobel
    Select._tappedAt = now;
    if (Select.map.map.getZoom() < C.MIN_ZOOM_SELECT) {
      root.UI.toast('Perbesar peta dulu (zoom minimal ' + C.MIN_ZOOM_SELECT + ') untuk menaruh pin');
      return;
    }
    showTapPulse(e.latlng.lat, e.latlng.lng); // respons visual setiap ketukan
    if (!Select.startRaw || (Select.startRaw && Select.endRaw)) {
      Select.startRaw = { lat: e.latlng.lat, lon: e.latlng.lng };
      Select.endRaw = null;
      Select.start = null; Select.end = null;
      Select.map.setStartPin(e.latlng.lat, e.latlng.lng);
      Select.map.clearEndPin();
      Select.map.clearRoute();
      root.UI.toast('Pin A (titik awal) terpasang — ketuk lagi untuk pin tujuan');
    } else {
      Select.endRaw = { lat: e.latlng.lat, lon: e.latlng.lng };
      Select.end = null;
      Select.map.setEndPin(e.latlng.lat, e.latlng.lng);
      root.UI.toast('Pin B (tujuan) terpasang!');
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

  function markCovered(pt, boxDeg) {
    var t = C.EXPAND_TILE_DEG;
    var w = pt.lon - boxDeg, e2 = pt.lon + boxDeg, s = pt.lat - boxDeg, n = pt.lat + boxDeg;
    for (var tx = Math.ceil(w / t - 1e-9); tx <= Math.floor(e2 / t + 1e-9); tx++) {
      for (var ty = Math.ceil(s / t - 1e-9); ty <= Math.floor(n / t + 1e-9); ty++) {
        Select.covered.add(tx + ':' + ty);
      }
    }
  }

  /* Titik dari layar koordinat: pasang pin & pusatkan peta (tanpa fetch) */
  Select.useCoords = function (lat, lon) {
    Select.startRaw = { lat: lat, lon: lon };
    Select.endRaw = null;
    Select.start = null; Select.end = null;
    Select.enterIfNeeded();
    root.UI.show('screen-select');
    setTimeout(function () {
      if (!Select.map) return;
      Select.map.map.setView([lat, lon], Math.max(16, C.DEFAULT_ZOOM), { animate: true });
      Select.map.setStartPin(lat, lon);
      Select.map.clearEndPin();
      Select.map.clearRoute();
      refreshZoomHint();
      updatePanel();
    }, 80);
    root.UI.toast('Titik awal dari koordinat terpasang — tekan Mulai 🚗');
  };

  Select.enterIfNeeded = function () {
    if (!Select.map) Select.enter();
  };

  /*
   * LAUNCH — dipanggil tombol "Mulai 🚗" / "Tanpa Tujuan".
 * Ambil data jalan bbox KECIL di sekitar pin, snap ke jalan, lalu mulai game.
   */
  Select.launch = function () {
    if (Select._launching) return;
    if (!Select.startRaw) {
      root.UI.toast('Taruh pin awal dulu — ketuk peta, atau pakai koordinat');
      return;
    }
    Select._launching = true;
    var loading = $('select-loading'), errBox = $('select-error');
    if (loading) loading.classList.add('show');
    if (errBox) errBox.classList.remove('show');

    var box = C.LAUNCH_BOX_DEG;
    var sR = Select.startRaw;
    var g = null;

    root.Net.fetchRoadBBox(sR.lat - box, sR.lon - box, sR.lat + box, sR.lon + box, { excludeService: false })
      .then(function (res) {
        g = new root.RoadGraph();
        var cnt = 0, els = res.json.elements || [];
        for (var i = 0; i < els.length; i++) {
          if (els[i].type === 'way' && g.isDrivable(els[i].tags || {})) cnt++;
        }
        if (!cnt) throw new Error('Tidak ada jalan mobil di area pin A. Coba geser pin ke permukiman/jalan nyata.');
        g.buildFromOverpass(res.json);
        var snapStart = g.findNearest(sR.lat, sR.lon, C.LAUNCH_SNAP_M);
        if (!snapStart) throw new Error('Tidak ada jalan di sekitar pin A (radius ' + C.LAUNCH_SNAP_M + ' m). Ketuk lebih tepat di jalan.');
        Select.graph = g;
        Select.start = snapStart;
        Select.map.setStartPin(snapStart.lat, snapStart.lon);
        markCovered(sR, box);
        // pin tujuan (opsional)
        if (Select.endRaw) {
          var eR = Select.endRaw;
          return root.Net.fetchRoadBBox(eR.lat - box, eR.lon - box, eR.lat + box, eR.lon + box, { excludeService: false })
            .then(function (res2) {
              g.mergeFromOverpass(res2.json);
              var snapEnd = g.findNearest(eR.lat, eR.lon, C.LAUNCH_SNAP_M);
              if (!snapEnd) throw new Error('Tidak ada jalan di sekitar pin B. Ketuk lebih tepat di jalan, atau tekan "Tanpa Tujuan".');
              Select.end = snapEnd;
              Select.map.setEndPin(snapEnd.lat, snapEnd.lon);
              markCovered(eR, box);
            });
        }
        Select.end = null;
        Select.map.clearEndPin();
      })
      .then(function () {
        Select._launching = false;
        if (loading) loading.classList.remove('show');
        root.Game.startGame();
      })
      .catch(function (err) {
        Select._launching = false;
        if (loading) loading.classList.remove('show');
        var msg = (err && err.message) ? err.message : 'Gagal mengambil data jalan.';
        if (msg === 'kosong' || /HTTP|network|Failed|abort/i.test(msg)) msg = 'Koneksi ke server peta gagal. Periksa internet lalu coba lagi.';
        var m = $('select-error-msg');
        if (m) m.textContent = msg;
        if (errBox) errBox.classList.add('show');
      });
  };

  Select.retry = function () {
    if ($('select-error')) $('select-error').classList.remove('show');
    Select.launch();
  };

  Select.resetPoints = function () {
    Select.startRaw = null; Select.endRaw = null;
    Select.start = null; Select.end = null;
    if (Select.map) { Select.map.clearPins(); Select.map.clearRoute(); }
    updatePanel();
  };

  function updatePanel() {
    var hint = $('select-hint');
    var btnGo = $('btn-select-go');
    var chip = $('select-route-info');
    if (Select.startRaw && Select.endRaw) {
      if (hint) hint.innerHTML = '<b>Pin A &amp; B terpasang!</b><small>Tekan Mulai — data jalan diambil otomatis</small>';
      if (btnGo) btnGo.classList.add('ready');
    } else if (Select.startRaw) {
      if (hint) hint.innerHTML = '<b>Pin A terpasang</b><small>Ketuk lagi untuk pin tujuan — atau langsung tekan Mulai</small>';
      if (btnGo) btnGo.classList.add('ready');
    } else {
      if (hint) hint.innerHTML = '<b>Ketuk peta untuk menaruh pin AWAL</b><small>Geser &amp; zoom bebas — data jalan diambil saat menekan Mulai</small>';
      if (btnGo) btnGo.classList.remove('ready');
    }
    if (chip) {
      var d = Select.startRaw && Select.endRaw ? U.haversine(Select.startRaw.lat, Select.startRaw.lon, Select.endRaw.lat, Select.endRaw.lon) : null;
      chip.textContent = d ? ('Jarak udara ± ' + U.fmtDist(d)) : 'Rute bebas tanpa tujuan';
    }
  }

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
    root.UI.bindTap('btn-select-back', function () { root.UI.show('screen-pickmode'); });
    root.UI.bindTap('btn-select-reset', function () { Select.resetPoints(); });
    root.UI.bindTap('btn-select-skip', function () {
      Select.endRaw = null; Select.end = null;
      if (Select.map) Select.map.clearEndPin();
      updatePanel();
      Select.launch();
    });
    root.UI.bindTap('btn-select-go', function () { Select.launch(); });
    root.UI.bindTap('select-guided', function () { Select.guidedToggle(); });
    root.UI.bindTap('select-car-chip', function () { UI_showCars(); });
    root.UI.bindTap('btn-select-retry', function () { Select.retry(); });
    // KUNCI: layar pilih lokasi menyiapkan peta SETIAP kali ditampilkan (tanpa fetch)
    root.UI.onShow('screen-select', function () { Select.enter(); });
    paintGuided();
  };

  function UI_showCars() {
    root.UI.show('screen-cars');
    var old = document.getElementById('btn-car-back');
    if (old) old.textContent = 'Kembali';
  }
})(typeof window !== 'undefined' ? window : globalThis);
