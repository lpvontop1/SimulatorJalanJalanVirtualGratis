/* =========================================================
 * UI inti — Settings, manajer layar, menu, pilih mobil,
 * pengaturan, kredit, toast, suara, halaman offline.
 * ========================================================= */
(function (root) {
  'use strict';
  var C = root.CONFIG, U = root.Utils;

  /* ---------------- Settings (localStorage) ---------------- */
  var Settings = {
    data: { guided: true, roadName: true, sound: true, mapStyle: 'osm', carId: C.DEFAULT_CAR },
    load: function () {
      try {
        var raw = localStorage.getItem('sjv_settings');
        if (raw) { var d = JSON.parse(raw); for (var k in this.data) if (k in d) this.data[k] = d[k]; }
      } catch (e) { /* abaikan */ }
      return this.data;
    },
    save: function () {
      try { localStorage.setItem('sjv_settings', JSON.stringify(this.data)); } catch (e) { /* abaikan */ }
    },
    get: function () { return this.data; }
  };
  root.Settings = Settings;
  Settings.load();

  /* ---------------- Suara kecil (WebAudio) ---------------- */
  var Sound = {
    ctx: null,
    ensure: function () {
      if (!Settings.get().sound) return null;
      try {
        if (!this.ctx) this.ctx = new (root.AudioContext || root.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      } catch (e) { return null; }
    },
    blip: function (freq, dur, vol) {
      var ctx = this.ensure(); if (!ctx) return;
      try {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.setValueAtTime(vol || 0.08, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (dur || 0.12));
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + (dur || 0.12));
      } catch (e) { /* abaikan */ }
    },
    click: function () { this.blip(660, 0.08); },
    tick: function () { this.blip(980, 0.07, 0.05); },
    ding: function () { this.blip(520, 0.18); setTimeout(function () { Sound.blip(780, 0.22); }, 140); }
  };
  root.Sound = Sound;

  /* ---------------- Manajer layar ---------------- */
  var UI = {
    current: 'screen-splash',
    show: function (id) {
      var screens = document.querySelectorAll('.screen');
      for (var i = 0; i < screens.length; i++) screens[i].classList.toggle('active', screens[i].id === id);
      this.current = id;
      document.body.setAttribute('data-screen', id);
      if (this._onShow[id]) this._onShow[id]();
    },
    _onShow: {},
    onShow: function (id, cb) { this._onShow[id] = cb; },

    /* ---------------- Toast ---------------- */
    toastTimer: null,
    toast: function (text, ms) {
      var el = document.getElementById('toast');
      if (!el) return;
      el.textContent = text;
      el.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2600);
    }
  };
  root.UI = UI;

  /* ---------------- Bindings layar menu ---------------- */
  function bindTap(id, fn) {
    var el = document.getElementById(id);
    if (!el) return;
    var handler = function (e) {
      e.preventDefault(); e.stopPropagation();
      Sound.click();
      fn(e);
    };
    el.addEventListener('click', handler);
  }
  UI.bindTap = bindTap;

  function initMenu() {
    bindTap('btn-play', function () { UI.show('screen-select'); });
    bindTap('btn-cars', function () { UI.show('screen-cars'); });
    bindTap('btn-settings', function () { UI.show('screen-settings'); });
    bindTap('btn-credits', function () { UI.show('screen-credits'); });
  }

  /* ---------------- Pilih mobil ---------------- */
  var carIdx = 0;
  function renderCar() {
    var cars = root.Sprites.CARS;
    var car = cars[carIdx];
    var view = document.getElementById('car-view');
    if (view) view.innerHTML = car.svg;
    var name = document.getElementById('car-name');
    if (name) name.textContent = car.name;
    var dots = document.getElementById('car-dots');
    if (dots) {
      var h = '';
      for (var i = 0; i < cars.length; i++) {
        h += '<span class="dot' + (i === carIdx ? ' on' : '') + '"></span>';
      }
      dots.innerHTML = h;
    }
  }
  function initCars() {
    var saved = Settings.get().carId;
    for (var i = 0; i < root.Sprites.CARS.length; i++) {
      if (root.Sprites.CARS[i].id === saved) carIdx = i;
    }
    renderCar();
    bindTap('btn-car-prev', function () { carIdx = (carIdx - 1 + root.Sprites.CARS.length) % root.Sprites.CARS.length; renderCar(); });
    bindTap('btn-car-next', function () { carIdx = (carIdx + 1) % root.Sprites.CARS.length; renderCar(); });
    bindTap('btn-car-use', function () {
      Settings.data.carId = root.Sprites.CARS[carIdx].id;
      Settings.save();
      UI.toast('Mobil dipakai: ' + root.Sprites.CARS[carIdx].name);
      UI.show('screen-menu');
    });
    bindTap('btn-car-back', function () { UI.show('screen-menu'); });
  }
  UI.currentCar = function () { return root.Sprites.byId(Settings.get().carId); };

  /* ---------------- Pengaturan ---------------- */
  function initSettings() {
    var s = Settings.get();
    var tGl = document.getElementById('set-guided');
    var tRn = document.getElementById('set-roadname');
    var tSd = document.getElementById('set-sound');
    var sel = document.getElementById('set-mapstyle');
    function paint() {
      if (tGl) tGl.classList.toggle('on', s.guided);
      if (tRn) tRn.classList.toggle('on', s.roadName);
      if (tSd) tSd.classList.toggle('on', s.sound);
      if (sel) sel.value = s.mapStyle;
    }
    paint();
    bindTap('set-guided', function () { s.guided = !s.guided; Settings.save(); paint(); });
    bindTap('set-roadname', function () { s.roadName = !s.roadName; Settings.save(); paint(); });
    bindTap('set-sound', function () { s.sound = !s.sound; Settings.save(); paint(); if (s.sound) Sound.ding(); });
    if (sel) sel.addEventListener('change', function () { s.mapStyle = sel.value; Settings.save(); });
    bindTap('btn-settings-back', function () { UI.show('screen-menu'); });
    bindTap('btn-reset', function () {
      localStorage.removeItem('sjv_settings');
      Settings.data = { guided: true, roadName: true, sound: true, mapStyle: 'osm', carId: C.DEFAULT_CAR };
      paint();
      UI.toast('Pengaturan dikembalikan ke awal');
    });
  }

  /* ---------------- Halaman offline ---------------- */
  var OFFLINE_TIPS = [
    'Fakta lucu: 97% mobil butuh jalan, 100% game ini butuh internet.',
    'Sinyal hilang itu sementara, skormu hilang itu selamanya... eh, belum ada skor sih.',
    'Coba deketin jendela, kadang sinyal suka sembunyi di situ.',
    'Mobil ini elektrik, tapi datanya tetap pakai kuota.',
    'Sabar dulu, peta sedang mencari sinyal di ujung dunia.'
  ];
  var offlineRetryTimer = null, offlineCountdown = 0;

  function netCheck() {
    return new Promise(function (resolve) {
      if (navigator.onLine === false) return resolve(false);
      var done = false;
      var img = new Image();
      var t = setTimeout(function () { if (!done) { done = true; resolve(false); } }, 6000);
      img.onload = function () { if (!done) { done = true; clearTimeout(t); resolve(true); } };
      img.onerror = function () { if (!done) { done = true; clearTimeout(t); resolve(false); } };
      img.src = 'https://tile.openstreetmap.org/10/488/296.png?c=' + Date.now();
    });
  }
  UI.netCheck = netCheck;

  function enterOffline() {
    UI.show('screen-offline');
    var tipEl = document.getElementById('offline-tip');
    if (tipEl) tipEl.textContent = OFFLINE_TIPS[Math.floor(Math.random() * OFFLINE_TIPS.length)];
    scheduleOfflineRetry();
  }
  UI.enterOffline = enterOffline;

  function scheduleOfflineRetry() {
    clearTimeout(offlineRetryTimer);
    offlineCountdown = 5;
    var cd = document.getElementById('offline-countdown');
    var tick = function () {
      if (document.body.getAttribute('data-screen') !== 'screen-offline') return;
      if (cd) cd.textContent = 'Mencoba menyambung ulang otomatis dalam ' + offlineCountdown + ' detik...';
      if (offlineCountdown <= 0) { tryReconnect(); return; }
      offlineCountdown--;
      offlineRetryTimer = setTimeout(tick, 1000);
    };
    tick();
  }

  function tryReconnect() {
    var cd = document.getElementById('offline-countdown');
    if (cd) cd.textContent = 'Menyambungkan...';
    netCheck().then(function (ok) {
      if (ok) {
        UI.toast('Sinyal kembali! Siap berkendara.');
        UI.show('screen-menu');
      } else {
        scheduleOfflineRetry();
      }
    });
  }
  UI.tryReconnect = tryReconnect;

  function initOffline() {
    bindTap('btn-offline-retry', function () { tryReconnect(); });
  }

  /* ---------------- Inisialisasi UI ---------------- */
  UI.init = function () {
    initMenu();
    initCars();
    initSettings();
    initOffline();
  };
})(typeof window !== 'undefined' ? window : globalThis);
