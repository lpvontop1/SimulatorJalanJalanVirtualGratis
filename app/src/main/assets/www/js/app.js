/* =========================================================
 * App — bootstrap, jembatan Android, deteksi koneksi, API uji.
 * ========================================================= */
(function (root) {
  'use strict';
  var C = root.CONFIG;

  var App = {
    started: false
  };

  App.boot = function () {
    if (App.started) return;
    App.started = true;

    root.UI.init();
    root.Select.init();
    root.Game.init();

    // tombol kembali fisik Android -> JS
    root.__androidBack = function () {
      var cur = root.UI.current;
      if (cur === 'screen-game') {
        if (document.getElementById('overlay-pause').classList.contains('show')) root.Game.resume();
        else root.Game.pause();
        return;
      }
      if (cur === 'screen-select') { root.UI.show('screen-menu'); return; }
      if (cur === 'screen-cars' || cur === 'screen-settings' || cur === 'screen-credits') { root.UI.show('screen-menu'); return; }
      if (cur === 'screen-menu') {
        if (root.AndroidBridge && root.AndroidBridge.minimize) root.AndroidBridge.minimize();
        return;
      }
    };
    root.__setOnline = function (ok) {
      if (ok && root.UI.current === 'screen-offline') root.UI.tryReconnect();
      if (!ok && root.UI.current === 'screen-menu') {
        root.UI.toast('Koneksi terputus — fitur peta bisa terganggu');
      }
    };
    root.__appReady = function () {
      if (root.AndroidBridge && root.AndroidBridge.notifyReady) {
        try { root.AndroidBridge.notifyReady(); } catch (e) { /* abaikan */ }
      }
    };

    root.UI.show('screen-splash');

    // splash -> cek koneksi -> menu / offline
    var delay = new Promise(function (res) { setTimeout(res, 1400); });
    delay.then(function () { return root.UI.netCheck(); }).then(function (ok) {
      if (ok) root.UI.show('screen-menu');
      else root.UI.enterOffline();
    });

    // pemantau koneksi bawaan browser
    window.addEventListener('offline', function () { root.__setOnline(false); });
    window.addEventListener('online', function () { root.__setOnline(true); });

    root.__appReady();
  };

  /* ---------------- API pengujian (black-box & stress) ---------------- */
  App.testAPI = {
    ui: root.UI, select: root.Select, game: root.Game, engine: null,
    loadFixture: function () {
      var s = root.Select;
      if (!s.map) {
        s.map = new root.GameMap('select-map', { center: C.DEFAULT_CENTER, zoom: C.DEFAULT_ZOOM, carSvg: root.UI.currentCar().svg });
        s.map.map.on('zoomend moveend', function () {});
      }
      s.graph = new root.RoadGraph();
      s.graph.buildFromOverpass(root.TESTTOWN);
      s._cacheKey = 'fixture';
      // simulasikan titik awal & akhir otomatis
      var snapA = s.graph.findNearest(-6.20305, 106.8000, 100);
      var snapB = s.graph.findNearest(-6.20030, 106.8000, 100);
      s.start = snapA; s.end = null;
      s.map.setStartPin(snapA.lat, snapA.lon);
      root.UI.show('screen-select');
      return { ways: s.graph.ways.size, nodes: s.graph.nodes.size };
    },
    setEndFixture: function () {
      var s = root.Select;
      var snapB = s.graph.findNearest(-6.20030, 106.8000, 100);
      s.end = snapB;
      s.map.setEndPin(snapB.lat, snapB.lon);
    },
    startDrive: function (guided) {
      root.Settings.data.guided = !!guided;
      root.Game.startGame();
      return { engine: root.Game.engine, router: root.Game.router };
    },
    offlinePage: function () { root.UI.enterOffline(); },
    decisionState: function () {
      var e = root.Game.engine;
      return e ? { waiting: e.waiting, kind: e.decision && e.decision.kind, n: e.decision ? (e.decision.kind === 'roundabout' ? e.decision.exits.length : e.decision.options.length) : 0 } : null;
    }
  };

  if (/[?&]test=1/.test(location.search)) root.TestAPI = App.testAPI;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { App.boot(); });
  } else {
    App.boot();
  }

  root.App = App;
})(typeof window !== 'undefined' ? window : globalThis);
