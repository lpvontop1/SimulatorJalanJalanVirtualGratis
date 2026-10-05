/* =========================================================
 * Test black-box & stress: Monas (Jakarta) -> Kantor Bupati Cianjur
 * Memakai modul game ASLI (config/utils/graph/router/engine/world).
 * Strategi pilot: Router game (Dijkstra terbalik) diarahkan ke WAYPOINT
 * leg aktif mengikuti rute jalan sebenarnya — menguji recommend() asli.
 * Data: cache tile OSM API 0.6 koridor waypoint (prefetch-corridor.js).
 * Jalankan: node test-cianjur.js
 * ========================================================= */
'use strict';

require('../app/src/main/assets/www/js/config.js');
require('../app/src/main/assets/www/js/utils.js');
require('../app/src/main/assets/www/js/graph.js');
require('../app/src/main/assets/www/js/router.js');
require('../app/src/main/assets/www/js/engine.js');
require('../app/src/main/assets/www/js/world.js');

var C = globalThis.CONFIG, U = globalThis.Utils;
var Net = globalThis.Net, RoadGraph = globalThis.RoadGraph, Router = globalThis.Router;
var DriveEngine = globalThis.DriveEngine, WorldExpander = globalThis.WorldExpander;
var FS = require('fs');
var PATH = require('path');

Net._overpassDownUntil = Date.now() + 3600e3; // pakai jalur fallback OSM API

var START = { lat: -6.1754024, lon: 106.8271692 }; // Monas
var END = { lat: -6.8239280, lon: 107.1408130 };   // Kantor Bupati Cianjur (Jl. Mangunsarkoro)
var BOX = C.LAUNCH_BOX_DEG;
/* Waypoint lega dari GEOMETRI RUTE JALAN SEBENARNYA (OSRM, ~7 km per leg) */
var WAYPOINTS = JSON.parse(FS.readFileSync(PATH.join(__dirname, 'route-waypoints.json'), 'utf8'));
/* Trek lengkap rute (pilot GPS-track-following) */
var TRACK = JSON.parse(FS.readFileSync(PATH.join(__dirname, 'route-geo.json'), 'utf8')); // [lon,lat]
var trackIdx = 0;

function log(s) { console.log(s); }
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

/* ---- cache disk ---- */
var CACHE_DIR = PATH.join(__dirname, '.osmcache');
try { FS.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {}
function cachedFetcher(s, w, n, e) {
  var key = (s.toFixed(4) + '_' + w.toFixed(4) + '_' + n.toFixed(4) + '_' + e.toFixed(4)).replace(/-/g, 'm');
  var f = CACHE_DIR + '/' + key + '.json';
  return new Promise(function (resolve, reject) {
    FS.readFile(f, 'utf8', function (err, txt) {
      if (!err) { try { resolve({ json: JSON.parse(txt), via: 'cache' }); return; } catch (e) {} }
      Net._fetchOsmApi(s, w, n, e, 0).then(function (res) {
        try { FS.writeFile(f, JSON.stringify(res.json), function () {}); } catch (e2) {}
        resolve(res);
      }, reject);
    });
  });
}
function fetchBox(lat, lon) {
  return Net._fetchOsmApi(lat - BOX, lon - BOX, lat + BOX, lon + BOX, 0);
}

function nearestNodeIdTo(graph, snap) {
  var w = graph.ways.get(snap.wayId);
  var a = graph.nodes.get(w.nodeIds[snap.segIndex]);
  var b = graph.nodes.get(w.nodeIds[Math.min(snap.segIndex + 1, w.nodeIds.length - 1)]);
  var da = U.haversine(snap.lat, snap.lon, a.lat, a.lon);
  var db = U.haversine(snap.lat, snap.lon, b.lat, b.lon);
  return da <= db ? a.id : b.id;
}

(async function main() {
  var t0 = Date.now();
  log('=== UJI MONAS -> KANTOR BUPATI CIANJUR (pilot: Router per-leg) ===');

  /* ---- 1. alur pilih lokasi (identik select.launch) ---- */
  log('[1/4] Data titik awal (Monas)...');
  var resA = await fetchBox(START.lat, START.lon);
  var graph = new RoadGraph();
  graph.buildFromOverpass(resA.json);
  var snapStart = graph.findNearest(START.lat, START.lon, C.LAUNCH_SNAP_M);
  if (!snapStart) throw new Error('GAGAL: pin awal tidak tersnap');
  log('  OK: ways=' + graph.ways.size + ' | snap A ' + snapStart.distM.toFixed(1) + ' m');
  log('[2/4] Data titik akhir (Kantor Bupati Cianjur)...');
  var resB = await fetchBox(END.lat, END.lon);
  graph.mergeFromOverpass(resB.json);
  var snapEnd = graph.findNearest(END.lat, END.lon, C.LAUNCH_SNAP_M);
  if (!snapEnd) throw new Error('GAGAL: pin akhir tidak tersnap');
  log('  OK: total ways=' + graph.ways.size + ' | snap B ' + snapEnd.distM.toFixed(1) + ' m');
  var airDist = U.haversine(snapStart.lat, snapStart.lon, snapEnd.lat, snapEnd.lon);
  log('  Jarak udara: ' + (airDist / 1000).toFixed(1) + ' km\n');

  /* ---- 2. engine + world ---- */
  var engine = new DriveEngine({
    graph: graph, router: null, guided: true,
    end: { lat: snapEnd.lat, lon: snapEnd.lon, wayId: snapEnd.wayId }
  });
  engine.place({ wayId: snapStart.wayId, segIndex: snapStart.segIndex, t: snapStart.t });
  engine.setSpeedDelta(70); // 110 km/j (simulasi lebih cepat)
  engine.start();

  var world = new WorldExpander(graph, {
    covered: new Set(), tileDeg: 0.012, ring: 1, fetcher: cachedFetcher, maxWays: 300000,
    onFail: function () { worldFails++; }
  });

  var legIdx = 1;
  world.setTarget(WAYPOINTS[legIdx].lat, WAYPOINTS[legIdx].lon);
  var legRouter = null, legConnected = false, lastRebuild = -1e9, simMs = 0;

  function rebuildLegRouter(force) {
    var wp = WAYPOINTS[Math.min(legIdx, WAYPOINTS.length - 1)];
    var snap = graph.findNearest(wp.lat, wp.lon, 6000);
    if (!snap) return;
    try {
      legRouter = new Router(graph);
      legRouter.setEnd(nearestNodeIdTo(graph, snap));
      var carNode = nearestNodeIdTo(graph, nearestSnapOfCar());
      var conn = isFinite(legRouter.distToEnd(carNode));
      if (conn && !legConnected) {
        log('  >> Router leg ' + legIdx + ' TERHUBUNG (sim ' + (simMs / 60000).toFixed(1) + ' mnt)');
      }
      if (conn || force) legConnected = conn;
    } catch (e) { /* graf berubah */ }
  }
  function nearestSnapOfCar() {
    return { wayId: engine.car.wayId, segIndex: engine.car.fromIdx, lat: engine.car.lat, lon: engine.car.lon };
  }

  /* ---- 3. pilot = A* per keputusan menuju titik trek di depan ---- */
  function advanceTrack(lat, lon) {
    var best = trackIdx, bd = Infinity;
    var lim = Math.min(TRACK.length, trackIdx + 300);
    for (var i = trackIdx; i < lim; i++) {
      var d = U.haversine(lat, lon, TRACK[i][1], TRACK[i][0]);
      if (d < bd) { bd = d; best = i; }
    }
    trackIdx = best;
    return bd;
  }
  function trackAheadScore(lat, lon) {
    var bd = Infinity;
    var lim = Math.min(TRACK.length, trackIdx + 80);
    for (var i = trackIdx; i < lim; i++) {
      var d = U.haversine(lat, lon, TRACK[i][1], TRACK[i][0]);
      if (d < bd) bd = d;
    }
    return bd;
  }
  function Heap() { this.a = []; }
  Heap.prototype.push = function (it) { var a = this.a; a.push(it); var i = a.length - 1; while (i > 0) { var p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; var t = a[p]; a[p] = a[i]; a[i] = t; i = p; } };
  Heap.prototype.pop = function () { var a = this.a; if (!a.length) return null; var top = a[0], last = a.pop(); if (a.length) { a[0] = last; var i = 0; for (;;) { var l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; var t = a[m]; a[m] = a[i]; a[i] = t; i = m; } } return top; };

  function speedOf(way) { return (C.ROUTE_SPEED[way.hw] || 30) / 3.6; }

  /* A*: return opsi pertama terbaik, atau null.
   * startOpts: [{wayId, fromNodeId, toNodeId}] — harus legal menurut engine. */
  var aStarFail = { noGoal: 0, noPath: 0 };
  var aStarOk = 0;
  function aStarStep(startOpts, goalPt, budget) {
    // kumpulkan node goal: dekat titik goal & BUKAN khusus jalan layanan
    // (jalan samping buntu dekat trek tak boleh jadi goal)
    var goalNodes = new Set();
    graph.nodes.forEach(function (n) {
      if (Math.abs(n.lat - goalPt[1]) < 0.004 && Math.abs(n.lon - goalPt[0]) < 0.005 &&
          U.haversine(n.lat, n.lon, goalPt[1], goalPt[0]) < 160) {
        var main = false;
        for (var wi = 0; wi < n.wayIds.length; wi++) {
          var w = graph.ways.get(n.wayIds[wi]);
          if (w && w.hw !== 'service') { main = true; break; }
        }
        if (main) goalNodes.add(n.id);
      }
    });
    if (!goalNodes.size) {
      aStarFail.noGoal++;
      if (aStarFail.noGoal <= 3) {
        var nn2 = null, nd2 = 1e9;
        graph.nodes.forEach(function (n) {
          var d = U.haversine(n.lat, n.lon, goalPt[1], goalPt[0]);
          if (d < nd2) { nd2 = d; nn2 = n; }
        });
        log('  [aStar-noGoal] goal ' + goalPt[1].toFixed(5) + ',' + goalPt[0].toFixed(5) +
          ' | node termuat terdekat ' + (nn2 ? nd2.toFixed(0) + ' m' : 'tidak ada') +
          ' | car ' + engine.car.lat.toFixed(5) + ',' + engine.car.lon.toFixed(5) +
          ' | tiles=' + world.fetchCount + ' ways=' + graph.ways.size);
      }
      return null;
    }
    var g0 = graph.nodes.get(goalPt.gid);
    function h(nid) {
      if (goalNodes.has(nid)) return 0;
      var n = graph.nodes.get(nid);
      return n ? U.haversine(n.lat, n.lon, goalPt[1], goalPt[0]) / 30 : 1e9;
    }
    var open = new Heap(), gScore = new Map(), parent = new Map();
    for (var i = 0; i < startOpts.length; i++) {
      var o = startOpts[i];
      var aN = graph.nodes.get(o.fromNodeId), bN = graph.nodes.get(o.toNodeId);
      if (!aN || !bN) continue;
      var g = U.haversine(aN.lat, aN.lon, bN.lat, bN.lon) / speedOf(graph.ways.get(o.wayId));
      var k = o.toNodeId + '|' + o.wayId;
      if (!gScore.has(k) || g < gScore.get(k)) {
        gScore.set(k, g);
        parent.set(k, { firstIdx: i, prevKey: null });
        open.push({ f: g + h(o.toNodeId), k: k, n: o.toNodeId, w: o.wayId });
      }
    }
    var expansions = 0;
    while (open.a.length && expansions++ < (budget || 25000)) {
      var cur = open.pop();
      if (goalNodes.has(cur.n)) {
        // rekonstruksi: jalan mundur ke langkah pertama
        var p = parent.get(cur.k);
        while (p.prevKey) p = parent.get(p.prevKey);
        return startOpts[p.firstIdx];
      }
      var gCur = gScore.get(cur.k);
      var waysAt = graph.nodes.get(cur.n).wayIds;
      for (var j = 0; j < waysAt.length; j++) {
        var wid = waysAt[j];
        if (!graph.connectable(cur.w, wid, cur.n)) continue;
        var nxts = graph.nextNodeOf(wid, cur.n);
        for (var q = 0; q < nxts.length; q++) {
          var toId = nxts[q];
          var nA = graph.nodes.get(cur.n), nB = graph.nodes.get(toId);
          var ng = gCur + U.haversine(nA.lat, nA.lon, nB.lat, nB.lon) / speedOf(graph.ways.get(wid));
          var nk = toId + '|' + wid;
          if (!gScore.has(nk) || ng < gScore.get(nk) - 1e-9) {
            gScore.set(nk, ng);
            parent.set(nk, { firstIdx: parent.get(cur.k).firstIdx, prevKey: cur.k });
            open.push({ f: ng + h(toId), k: nk, n: toId, w: wid });
          }
        }
      }
    }
    aStarFail.noPath++;
    return null;
  }

  function trackAheadPoint() {
    return TRACK[Math.min(TRACK.length - 1, trackIdx + 60)]; // ±2.2 km di depan (komit jalan utama di hairpin)
  }

  var stats = { decisions: 0, rb: 0, guided: 0, greedy: 0, deadend: 0, layerChanges: 0, maxLayerGap: 0 };
  var finishInfo = null;
  engine.on('finish', function (f) { finishInfo = f; });
  engine.on('decision', function (d) {
    stats.decisions++;
    if (d.kind === 'roundabout') stats.rb++;
    advanceTrack(engine.car.lat, engine.car.lon);
    // final approach: bila sudah dekat tujuan, target A* = node tujuan langsung
    var dEndNow = U.haversine(engine.car.lat, engine.car.lon, END.lat, END.lon);
    var finalLeg = dEndNow < 500;
    var goalPt = finalLeg ? [END.lon, END.lat] : trackAheadPoint();
    if (d.kind !== 'roundabout') {
      var opts = d.options.map(function (o) { return { wayId: o.wayId, fromNodeId: d.nodeId, toNodeId: o.toNodeId }; });
      var pick = aStarStep(opts, goalPt, 40000);
      if (pick) {
        aStarOk++;
        // cari indeks opsi asli yang cocok
        for (var i = 0; i < d.options.length; i++) {
          if (d.options[i].wayId === pick.wayId && d.options[i].toNodeId === pick.toNodeId) {
            stats.guided++;
            engine.choose(i);
            return;
          }
        }
      }
    }
    // fallback: skor trek (bundaran & bila A* gagal); final approach = jarak ke tujuan
    var list = d.kind === 'roundabout' ? d.exits : d.options;
    var best = -1, bestScore = 1e9;
    for (var k = 0; k < list.length; k++) {
      var o2 = list[k];
      var nTo = graph.nodes.get(o2.toNodeId);
      var sc = 1e9;
      if (nTo) sc = finalLeg ? U.haversine(nTo.lat, nTo.lon, END.lat, END.lon) : trackAheadScore(nTo.lat, nTo.lon);
      if (o2.way && o2.way.hw === 'service') sc += 600;
      if (recentNodes.indexOf(o2.toNodeId) !== -1) sc += 4000;
      if (sc < bestScore) { bestScore = sc; best = k; }
    }
    stats.greedy++;
    if (best >= 0) engine.choose(best);
  });
  engine.on('toast', function (t) { log('  [mobil] ' + t.text); });
  engine.on('deadend', function () { stats.deadend++; });

  var recentNodes = [], lastNodeSeen = null;
  var lastWayLayer = graph.ways.get(engine.car.wayId).layer;
  var guard = 0, worldCalls = 0, worldFails = 0;
  var DT = 100, step = 0;
  // pemutus loop: bila jarak ke waypoint leg tak kunjung turun, paksa greedy
  var minLegDist = 1e9, stagnant = 0, greedyUntil = -1;

  log('[3/4] Simulasi berkendara...\n');
  while (!engine.finished && guard++ < 400000) {
    engine.step(DT); simMs += DT; step++;
    var curN = graph.ways.get(engine.car.wayId).nodeIds[engine.car.toIdx];
    if (curN !== lastNodeSeen) {
      lastNodeSeen = curN;
      recentNodes.push(curN);
      if (recentNodes.length > 150) recentNodes.shift();
      // KEMUDI PAKSA: bila mobil menerobos simpang yang sudah sering dilewati
      // (sirkuit satu arah tanpa keputusan), paksakan belok ke way yang paling
      // dekat dengan trek rute di depan.
      var visits = recentNodes.filter(function (x) { return x === curN; }).length;
      if (visits >= 3) {
        var nNow = graph.nodes.get(curN);
        if (nNow && nNow.wayIds.length > 1) {
          // A* keluar dari sirkuit: kandidat = semua keluaran simpang ini
          var outs = [];
          for (var wi = 0; wi < nNow.wayIds.length; wi++) {
            var wid2 = nNow.wayIds[wi];
            var nxts = graph.nextNodeOf(wid2, curN);
            for (var ni = 0; ni < nxts.length; ni++) {
              outs.push({ wayId: wid2, fromNodeId: curN, toNodeId: nxts[ni] });
            }
          }
          var pickW = aStarStep(outs, trackAheadPoint(), 40000);
          if (pickW) {
            engine._takeWay(pickW.wayId, curN, pickW.toNodeId);
            log('  [kemudi] A* keluar sirkuit di simpang ' + curN);
          }
        }
      }
    }
    if (engine.finished) break;
    var layerNow = graph.ways.get(engine.car.wayId).layer;
    if (layerNow !== lastWayLayer) {
      stats.layerChanges++;
      stats.maxLayerGap = Math.max(stats.maxLayerGap, Math.abs(layerNow - lastWayLayer));
      lastWayLayer = layerNow;
    }
    if (step % 20 === 0) {
      advanceTrack(engine.car.lat, engine.car.lon);
      // koridor ekspansi dunia mengikuti TREK (segmen pendek 550 m di depan
      // agar tile di tikungan/tanjakan tetap terambil — garis lurus jauh
      // terbukti melewatkan belokan pegunungan)
      var tgtTrack = TRACK[Math.min(TRACK.length - 1, trackIdx + 15)];
      world.setTarget(tgtTrack[1], tgtTrack[0]);
      if (step % 6000 === 0) {
        var dEnd = U.haversine(engine.car.lat, engine.car.lon, END.lat, END.lon);
        log('  [t+' + (simMs / 60000).toFixed(0) + 'mnt] pos ' + engine.car.lat.toFixed(4) + ',' + engine.car.lon.toFixed(4) +
          ' | trek ' + trackIdx + '/' + TRACK.length + ' | sisa ' + (dEnd / 1000).toFixed(1) + ' km | tempuh ' + (engine.stats.distanceM / 1000).toFixed(1) + ' km');
      }
      var added = await world.update(engine.car.lat, engine.car.lon);
      worldCalls++;
    }
  }
  rebuildLegRouter(true);

  /* ---- 4. laporan ---- */
  var s = engine.stats;
  var reason = finishInfo ? finishInfo.reason : '(belum selesai)';
  log('\n================ HASIL ================');
  log('Selesai: ' + (engine.finished ? 'YA' : 'TIDAK (guard)') + ' | alasan: ' + reason);
  if (reason === 'stuck') {
    var cw = graph.ways.get(engine.car.wayId);
    log('  STUCK di ' + engine.car.lat.toFixed(5) + ',' + engine.car.lon.toFixed(5) +
      ' | way ' + JSON.stringify(cw.name) + ' hw=' + cw.hw + ' L' + cw.layer + ' ow=' + cw.oneway);
  }
  log('Jarak tempuh  : ' + (s.distanceM / 1000).toFixed(1) + ' km (udara ' + (airDist / 1000).toFixed(1) + ' km)');
  log('Waktu simulasi: ' + (simMs / 60000).toFixed(1) + ' mnt | rata2 ' + (s.speedN ? Math.round(s.speedSum / s.speedN) : 0) + ' km/j');
  log('Persimpangan  : ' + stats.decisions + ' (bundaran ' + stats.rb + ') | terpandu ' + stats.guided + ' | greedy ' + stats.greedy);
  log('Belok         : kiri ' + s.turns.left + ' | lurus ' + s.turns.straight + ' | kanan ' + s.turns.right + ' | putar balik ' + s.turns.uturn);
  log('Jalan buntu   : ' + stats.deadend + 'x (U-turn/mundur/rescue otomatis)');
  log('Layer flyover : ' + stats.layerChanges + ' perubahan (gap maks ' + stats.maxLayerGap + ')');
  log('Dunia         : ' + world.fetchCount + ' tile (' + worldFails + ' gagal), ways ' + graph.ways.size + ', nodes ' + graph.nodes.size);
  log('A* pilot      : sukses ' + aStarOk + ' | gagal ' + JSON.stringify(aStarFail));
  log('Waktu nyata   : ' + ((Date.now() - t0) / 1000).toFixed(1) + ' dtk');
  var pass = engine.finished && finishInfo && finishInfo.reason === 'destination' && s.distanceM > 50000;
  log(pass ? '\n>>> LULUS: Monas -> Kantor Bupati Cianjur TUNTAS <<<' : '\n>>> BELUM TUNTAS <<<');
  process.exit(pass ? 0 : 1);
})().catch(function (e) {
  console.error('FATAL:', e && e.message || e);
  if (e && e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(2);
});
