/* =========================================================
 * Game — layar permainan: HUD, popup pilihan ganda, pause, rekap.
 * Popup mengunci gestur peta agar tidak ada konflik sentuhan.
 * ========================================================= */
(function (root) {
  'use strict';
  var C = root.CONFIG, U = root.Utils;

  var Game = {
    map: null, engine: null, router: null,
    _raf: null, _lastT: 0,
    _lastCountSec: -1
  };
  root.Game = Game;

  function $(id) { return document.getElementById(id); }

  /* ---------------- mulai ---------------- */
  Game.startGame = function () {
    var sel = root.Select;
    if (!sel.start) { root.UI.toast('Pilih titik awal dulu!'); return; }
    var settings = root.Settings.get();
    var graph = sel.graph;
    if (!graph) { root.UI.toast('Data jalan belum siap, tunggu sebentar...'); return; }

    Game.router = null;
    if (sel.end && settings.guided) {
      try {
        Game.router = new root.Router(graph);
        var endNodeId = nearestNodeIdTo(graph, sel.end);
        Game.router.setEnd(endNodeId);
        // data asli kadang terputus antar-komponen — cari titik terhubung alternatif
        var connected = ensureConnectedEnd(Game.router, graph);
        if (!connected) {
          root.UI.toast('Rute belum terhubung — akan diperbarui saat data jalan bertambah');
        }
      } catch (e) { Game.router = null; }
    }

    Game.engine = new root.DriveEngine({
      graph: graph,
      router: Game.router,
      guided: settings.guided,
      end: sel.end ? { lat: sel.end.lat, lon: sel.end.lon, wayId: sel.end.wayId } : null
    });
    Game.engine.place({ wayId: sel.start.wayId, segIndex: sel.start.segIndex, t: sel.start.t });

    setupWorld();

    root.UI.show('screen-game');
    if (!Game.map) {
      Game.map = new root.GameMap('game-map', { carSvg: root.UI.currentCar().svg, zoom: C.FOLLOW_ZOOM });
      Game.map._onTileFail = function () { root.UI.toast('Koneksi peta lemah — permainan tetap jalan'); };
    }
    Game.map.carEl.querySelector('.car-rot').innerHTML = root.UI.currentCar().svg;
    Game.map.follow = true;
    Game.map.map.setView([Game.engine.car.lat, Game.engine.car.lon], C.FOLLOW_ZOOM, { animate: false });
    setTimeout(function () { if (Game.map) Game.map.map.invalidateSize(); }, 60);

    wireEngine();
    if (sel.end) Game.map.setEndPin(sel.end.lat, sel.end.lon);
    else Game.map.clearEndPin();
    drawGuidedRoute();
    Game.map.setCar(Game.engine.car.lat, Game.engine.car.lon, Game.engine.car.bearing, true);

    Game.engine.start();
    $('game-mode-badge').textContent = settings.guided ? 'DIPANDU' : 'BEBAS';
    $('game-mode-badge').className = 'chip ' + (settings.guided ? 'chip-blue' : 'chip-amber');
    $('hud-speed').textContent = Game.engine.car.speedKmh;
    Game._lastT = performance.now();
    cancelAnimationFrame(Game._raf);
    Game._raf = requestAnimationFrame(loop);
  };

  function nearestNodeIdTo(graph, snap) {
    var w = graph.ways.get(snap.wayId);
    var a = graph.nodes.get(w.nodeIds[snap.segIndex]);
    var b = graph.nodes.get(w.nodeIds[Math.min(snap.segIndex + 1, w.nodeIds.length - 1)]);
    var da = U.haversine(snap.lat, snap.lon, a.lat, a.lon);
    var db = U.haversine(snap.lat, snap.lon, b.lat, b.lon);
    return da <= db ? a.id : b.id;
  }

  /**
   * Pastikan titik akhir router berada di komponen yang TERHUBUNG ke titik awal.
   * Bila titik akhir ter-snap ke komponen terisolasi (mis. jalan layanan gated),
   * cari titik alternatif terdekat yang terhubung dan geser pin ke sana.
   * return true bila router siap dipakai (rute terhubung).
   */
  function ensureConnectedEnd(router, graph) {
    var sel = root.Select;
    if (!sel.end || !sel.start) return false;
    var startNodeId = nearestNodeIdTo(graph, sel.start);
    if (isFinite(router.distToEnd(startNodeId))) return true;
    // titik akhir terpisah — petakan jangkauan DARI titik awal (reverse Dijkstra),
    // lalu cari kandidat terdekat dari tujuan yang berada di komponen titik awal
    var fromStart = new root.Router(graph);
    fromStart.setEnd(startNodeId);
    var alt = graph.findNearestWhere(sel.end.lat, sel.end.lon, C.END_RELOCATE_RADIUS_M || 800, function (aId, bId) {
      return isFinite(fromStart.distToEnd(aId)) || isFinite(fromStart.distToEnd(bId));
    });
    if (!alt) return false;
    var wAlt = graph.ways.get(alt.wayId);
    var aN = graph.nodes.get(wAlt.nodeIds[alt.segIndex]);
    var bN = graph.nodes.get(wAlt.nodeIds[Math.min(alt.segIndex + 1, wAlt.nodeIds.length - 1)]);
    var nid = U.haversine(alt.lat, alt.lon, aN.lat, aN.lon) <= U.haversine(alt.lat, alt.lon, bN.lat, bN.lon) ? aN.id : bN.id;
    router.setEnd(nid);
    // geser tujuan efektif agar pemicu rekap & pin konsisten
    sel.end.lat = alt.lat; sel.end.lon = alt.lon; sel.end.wayId = alt.wayId;
    sel.end.segIndex = alt.segIndex; sel.end.t = alt.t;
    if (Game.map) Game.map.setEndPin(alt.lat, alt.lon);
    return isFinite(router.distToEnd(startNodeId));
  }

  /* ---------------- dunia dinamis (ekspansi data selama jalan) ---------------- */
  function setupWorld() {
    var graph = Game.engine.graph;
    if (!Game.world || Game.world.graph !== graph) {
      Game.world = new root.WorldExpander(graph, {
        covered: root.Select.covered, // tile dari layar pilih lokasi ikut terhitung
        onMerged: onWorldMerged,
        onLimited: function () { root.UI.toast('Area jelajahan mencapai batas memori — data baru dihentikan'); },
        onFail: function () { root.UI.toast('Gagal memuat area jalan baru — akan dicoba lagi'); }
      });
      if (root.Select.end) {
        Game.world.setTarget(root.Select.end.lat, root.Select.end.lon); // prefetch koridor ke tujuan
      }
    }
    Game._routeDirty = false;
    Game._lastWorldCheck = 0;
    Game._lastRebuild = 0;
  }

  function onWorldMerged() {
    if (!Game.engine || !Game.router) return;
    if (Game.engine.waiting || Game.engine.paused) rebuildRouter();
    else Game._routeDirty = true; // ditangguhkan agar tidak patah saat melaju
  }

  function rebuildRouter() {
    if (!Game.router || !Game.engine) return;
    try {
      Game.router.setEnd(Game.router.endNodeId); // Dijkstra ulang pada graf terbaru
      // bila tujuan masih di komponen terpisah, coba lagi cari titik terhubung
      ensureConnectedEnd(Game.router, Game.engine.graph);
      drawGuidedRoute();
    } catch (e) { /* graf sedang berubah — coba lagi nanti */ }
    Game._routeDirty = false;
    Game._lastRebuild = performance.now();
  }

  function drawGuidedRoute() {
    if (!Game.router || !Game.engine || !Game.router.ready) { Game.map && Game.map.clearRoute(); return; }
    // gambar jalur serakah mengikuti state (node, way) — konsisten dgn Dijkstra
    var g = Game.engine.graph;
    var snap = root.Select.start;
    if (!snap) { Game.map.clearRoute(); return; }
    var node = nearestNodeIdTo(g, snap);
    var inWayId = snap.wayId;
    var latlngs = [[Game.engine.car.lat, Game.engine.car.lon]];
    var visited = new Set();
    var guard = 0;
    while (guard++ < 6000) {
      if (node === Game.router.endNodeId) break;
      var vKey = node + '|' + inWayId;
      if (visited.has(vKey)) break;
      visited.add(vKey);
      var n = g.nodes.get(node);
      var bestWay = null, bestTo = null, bestD = Infinity;
      n.wayIds.forEach(function (wid) {
        if (!g.connectable(inWayId, wid, node)) return; // aturan layer flyover
        g.nextNodeOf(wid, node).forEach(function (to) {
          var cost = Game.router.edgeCost(wid, node, to);
          var d = Game.router.distToState(to, wid) + cost;
          if (d < bestD - 1e-9) { bestD = d; bestWay = wid; bestTo = to; }
        });
      });
      if (bestWay == null || !isFinite(bestD)) break;
      var nb = g.nodes.get(bestTo);
      latlngs.push([nb.lat, nb.lon]);
      node = bestTo; inWayId = bestWay;
    }
    Game.map.setRoute(latlngs);
  }

  /* ---------------- loop utama ---------------- */
  function loop(t) {
    if (!Game.engine) { Game._raf = null; return; } // stop — tanpa loop zombie
    Game._raf = requestAnimationFrame(loop);
    var dt = Math.min(t - Game._lastT, 250);
    Game._lastT = t;
    Game.engine.step(dt);
    updateDecisionTimer();

    // ekspansi dunia + rebuild rute (dijadwalkan, jarang)
    if (Game.world && !Game.engine.finished && t - Game._lastWorldCheck > C.EXPAND_CHECK_MS) {
      Game._lastWorldCheck = t;
      Game.world.update(Game.engine.car.lat, Game.engine.car.lon);
    }
    if (Game._routeDirty && Game.router && t - Game._lastRebuild > C.EXPAND_REBUILD_MS) {
      rebuildRouter();
    }
  }

  var RING_C = 2 * Math.PI * 26;
  function updateDecisionTimer() {
    var d = Game.engine && Game.engine.decision;
    var wrap = $('dec-timerwrap');
    if (!d) { if (wrap) wrap.classList.remove('urgent'); return; }
    var remain = Math.max(0, Game.engine.decisionTimeoutS - d.timerS);
    var sec = Math.ceil(remain);
    var circle = document.getElementById('dec-ring');
    var num = document.getElementById('dec-sec');
    if (circle) circle.style.strokeDashoffset = String(RING_C * (d.timerS / Game.engine.decisionTimeoutS));
    if (num) num.textContent = sec;
    if (wrap) wrap.classList.toggle('urgent', remain <= 5);
    if (sec !== Game._lastCountSec) {
      Game._lastCountSec = sec;
      if (sec <= 5 && sec > 0) root.Sound.tick();
    }
  }

  /* ---------------- events engine -> UI ---------------- */
  function wireEngine() {
    var e = Game.engine;
    e.on('tick', onTick);
    e.on('decision', onDecision);
    e.on('chosen', onHideDecision);
    e.on('auto', onAuto);
    e.on('toast', function (t) { root.UI.toast(t.text); });
    e.on('finish', onFinish);
    e.on('speed', function (s) { $('hud-speed').textContent = s.kmh; });
  }

  function onTick(d) {
    if (Game.map) Game.map.setCar(d.lat, d.lon, d.bearing);
    if (root.Settings.get().roadName) {
      $('hud-road').textContent = d.roadName || 'Jalan';
      $('hud-road').style.display = '';
    } else {
      $('hud-road').style.display = 'none';
    }
    $('hud-remaining').textContent = d.distToEndM != null ? ('Sisa ' + U.fmtDist(d.distToEndM)) : 'Perjalanan bebas';
    $('hud-dist').textContent = U.fmtDist(d.stats.distanceM);
  }

  /* ---------------- popup keputusan ---------------- */
  var CLS_ICON = {
    left: '<svg viewBox="0 0 24 24"><path d="M14 5 L7 12 L14 19" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M10 5 L17 12 L10 19" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    straight: '<svg viewBox="0 0 24 24"><path d="M12 19 L12 6 M6 12 L12 5 L18 12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    uturn: '<svg viewBox="0 0 24 24"><path d="M6 19 L6 10 A5 5 0 0 1 16 10 L16 15 M13 12 L16 16 L19 12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  var CLS_LABEL = { left: 'KIRI', right: 'KANAN', straight: 'LURUS', uturn: 'PUTAR BALIK' };

  function onDecision(d) {
    var ov = $('overlay-decision');
    var box = $('dec-options');
    box.innerHTML = '';
    Game.map.lockGestures();
    Game._lastCountSec = -1;

    if (d.kind === 'roundabout') {
      $('dec-title').textContent = 'Bundaran!';
      $('dec-sub').textContent = 'Pilih jalur keluar (dari arah kamu datang)';
      d.exits.forEach(function (ex, i) {
        var b = document.createElement('button');
        b.className = 'dec-btn dec-exit';
        b.innerHTML = '<span class="exit-n">' + (i + 1) + '</span><span class="exit-label">Jalur ' + (i + 1) + '</span><span class="exit-road">' + ex.name + '</span>';
        if (i === d.recommended) b.classList.add('recommended');
        b.addEventListener('click', mkChoose(i));
        box.appendChild(b);
      });
    } else {
      $('dec-title').textContent = 'Persimpangan!';
      $('dec-sub').textContent = 'Mau lewat jalur mana?';
      d.options.forEach(function (o, i) {
        var b = document.createElement('button');
        b.className = 'dec-btn cls-' + o.cls;
        b.innerHTML = '<span class="dec-icon">' + (CLS_ICON[o.cls] || CLS_ICON.straight) + '</span><span class="dec-label">' + (CLS_LABEL[o.cls] || 'JALAN') + '</span>';
        if (i === d.recommended) b.classList.add('recommended');
        b.addEventListener('click', mkChoose(i));
        box.appendChild(b);
      });
    }
    ov.classList.add('show');
  }

  function mkChoose(i) {
    return function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      root.Sound.click();
      Game.engine.choose(i);
    };
  }

  function onHideDecision() {
    var ov = $('overlay-decision');
    if (ov) ov.classList.remove('show');
    if (Game.map) Game.map.unlockGestures();
  }

  function onAuto(a) {
    onHideDecision();
    root.UI.toast(a.text);
    root.Sound.ding();
  }

  /* ---------------- pause & akhir ---------------- */
  Game.pause = function () {
    if (!Game.engine || Game.engine.finished) return;
    Game.engine.pause();
    $('overlay-pause').classList.add('show');
    if (Game.map) Game.map.lockGestures();
  };
  Game.resume = function () {
    $('overlay-pause').classList.remove('show');
    if (Game.map) Game.map.unlockGestures();
    if (Game.engine) Game.engine.resume();
  };

  function onFinish(f) {
    cancelAnimationFrame(Game._raf);
    onHideDecision();
    $('overlay-pause').classList.remove('show');
    var s = f.stats;
    var title = f.reason === 'destination' ? 'Sampai Tujuan!' : 'Perjalanan Diakhiri';
    if (f.reason === 'destination') root.Sound.ding();
    $('recap-title').textContent = title;
    $('recap-sub').textContent = f.reason === 'destination'
      ? 'Kamu berhasil mencapai titik akhir. Berikut rekap petualanganmu:'
      : (f.reason === 'stuck'
        ? 'Mobil sampai di jalan buntu satu arah / tepi data peta. Ini rekap perjalananmu:'
        : 'Perjalanan berhenti di tengah jalan. Ini rekapnya:');
    var avg = s.speedN ? Math.round(s.speedSum / s.speedN) : 0;
    $('recap-stats').innerHTML =
      stat('Jarak Tempuh', U.fmtDist(s.distanceM)) +
      stat('Waktu', U.fmtTime(s.elapsedMs)) +
      stat('Kecepatan Rata-rata', avg + ' km/j') +
      stat('Kecepatan Tertinggi', Math.round(s.maxSpeedKmh) + ' km/j') +
      stat('Persimpangan Dilewati', s.decisions + 'x') +
      stat('Bundaran', s.roundabouts + 'x') +
      stat('Belok Kiri', s.turns.left + 'x') +
      stat('Belok Kanan', s.turns.right + 'x') +
      stat('Lurus di Simpang', s.turns.straight + 'x') +
      stat('Putar Balik', s.turns.uturn + 'x') +
      stat('Pilihan Otomatis (timeout)', s.autoPicks + 'x');
    setTimeout(function () { $('overlay-recap').classList.add('show'); }, 350);
  }

  function stat(k, v) {
    return '<div class="recap-item"><span class="rk">' + k + '</span><span class="rv">' + v + '</span></div>';
  }

  Game.destroy = function () {
    cancelAnimationFrame(Game._raf);
    Game._raf = null;
    if (Game.engine) { Game.engine.finished = true; Game.engine = null; }
    if (Game.world) Game.world.busy = false;
    if (Game.map) { Game.map.clearRoute(); Game.map.clearPins(); }
    onHideDecision();
    $('overlay-pause').classList.remove('show');
    $('overlay-recap').classList.remove('show');
  };

  Game.restart = function () {
    Game.destroy();
    Game.startGame();
  };

  /* ---------------- init bindings ---------------- */
  Game.init = function () {
    root.UI.bindTap('btn-pause', function () { Game.pause(); });
    root.UI.bindTap('btn-pause-resume', function () { Game.resume(); });
    root.UI.bindTap('btn-pause-restart', function () { Game.restart(); });
    root.UI.bindTap('btn-pause-finish', function () {
      Game.resume();
      Game.engine && Game.engine.finishManual();
    });
    root.UI.bindTap('btn-pause-menu', function () { Game.destroy(); root.UI.show('screen-menu'); });
    root.UI.bindTap('btn-recap-again', function () { Game.restart(); });
    root.UI.bindTap('btn-recap-select', function () { Game.destroy(); root.UI.show('screen-select'); });
    root.UI.bindTap('btn-recap-menu', function () { Game.destroy(); root.UI.show('screen-menu'); });
    root.UI.bindTap('btn-zin', function () { Game.map && Game.map.zoomIn(); });
    root.UI.bindTap('btn-zout', function () { Game.map && Game.map.zoomOut(); });
    root.UI.bindTap('btn-center', function () {
      if (Game.map && Game.engine) Game.map.recenter(Game.engine.car.lat, Game.engine.car.lon);
    });
    root.UI.bindTap('btn-speed-up', function () { Game.engine && Game.engine.setSpeedDelta(C.SPEED_STEP_KMH); });
    root.UI.bindTap('btn-speed-down', function () { Game.engine && Game.engine.setSpeedDelta(-C.SPEED_STEP_KMH); });

    // dukungan keyboard (untuk uji di desktop)
    document.addEventListener('keydown', function (ev) {
      if (root.UI.current !== 'screen-game' || !Game.engine) return;
      if (ev.key === 'ArrowUp') Game.engine.setSpeedDelta(C.SPEED_STEP_KMH);
      else if (ev.key === 'ArrowDown') Game.engine.setSpeedDelta(-C.SPEED_STEP_KMH);
      else if (ev.key === ' ') { ev.preventDefault(); Game.engine.paused ? Game.resume() : Game.pause(); }
      else if (Game.engine.waiting && Game.engine.decision) {
        var d = Game.engine.decision;
        var n = d.kind === 'roundabout' ? d.exits.length : d.options.length;
        if (ev.key >= '1' && ev.key <= '9') {
          var i = parseInt(ev.key, 10) - 1;
          if (i < n) Game.engine.choose(i);
        } else if (ev.key === 'Enter') Game.engine.choose(0);
      }
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
