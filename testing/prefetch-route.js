'use strict';
/* Prefetch koridor mengikuti GEOMETRI RUTE JALAN SEBENARNYA (OSRM).
 * Ramah server: sekuensial, jeda antar request, retry per tile, cache disk. */
require('../app/src/main/assets/www/js/config.js');
require('../app/src/main/assets/www/js/utils.js');
require('../app/src/main/assets/www/js/graph.js');
require('../app/src/main/assets/www/js/world.js');
var FS = require('fs');
var PATH = require('path');
var Net = globalThis.Net;

var CACHE_DIR = PATH.join(__dirname, '.osmcache');
try { FS.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {}
var T = 0.012; // tile ~1.3 km

/* geometri rute dari OSRM (lon, lat) */
var GEO = JSON.parse(FS.readFileSync(PATH.join(__dirname, 'route-geo.json'), 'utf8'));
/* sampling waypoint utk pilot: tiap ~7 km */
var WAYOUT = PATH.join(__dirname, 'route-waypoints.json');

function key(s, w, n, e) {
  return (s.toFixed(4) + '_' + w.toFixed(4) + '_' + n.toFixed(4) + '_' + e.toFixed(4)).replace(/-/g, 'm') + '.json';
}
function readCache(f) {
  try { return JSON.parse(FS.readFileSync(CACHE_DIR + '/' + f, 'utf8')); } catch (e) { return null; }
}
function writeCache(f, json) {
  try { FS.writeFileSync(CACHE_DIR + '/' + f, JSON.stringify(json)); } catch (e) {}
}
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function fetchTile(s, w, n, e, tries) {
  var f = key(s, w, n, e);
  var c = readCache(f);
  if (c) return Promise.resolve({ json: c, cached: true });
  return Net._fetchOsmApi(s, w, n, e, 0).then(function (res) {
    writeCache(f, res.json);
    return { json: res.json, cached: false };
  }).catch(function (err) {
    if (tries > 0) {
      console.log('  retry (' + (err.message || err) + ') sisa ' + tries);
      return sleep(8000).then(function () { return fetchTile(s, w, n, e, tries - 1); });
    }
    throw err;
  });
}

(async function () {
  var tiles = [];
  var seen = {};
  function addTile(tx, ty) {
    var k = tx + ':' + ty;
    if (seen[k]) return;
    seen[k] = 1;
    tiles.push([ty * T, tx * T, (ty + 1) * T, (tx + 1) * T]);
  }
  for (var i = 0; i < GEO.length; i++) {
    var lon = GEO[i][0], lat = GEO[i][1];
    var tx = Math.floor(lon / T), ty = Math.floor(lat / T);
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) addTile(tx + dx, ty + dy);
  }
  console.log('koridor rute asli: ' + tiles.length + ' tile (' + T + '\u00b0)');

  // simpan waypoint sampling (~7 km) untuk pilot
  var wps = [{ lat: GEO[0][1], lon: GEO[0][0] }];
  var acc = 0;
  for (var j = 1; j < GEO.length; j++) {
    var dLat = GEO[j][1] - GEO[j - 1][1], dLon = GEO[j][0] - GEO[j - 1][0];
    acc += Math.sqrt(dLat * dLat + dLon * dLon) * 111.32;
    if (acc >= 7) {
      wps.push({ lat: GEO[j][1], lon: GEO[j][0] });
      acc = 0;
    }
  }
  wps.push({ lat: GEO[GEO.length - 1][1], lon: GEO[GEO.length - 1][0] });
  FS.writeFileSync(WAYOUT, JSON.stringify(wps));
  console.log('waypoint pilot: ' + wps.length);

  var ok = 0, fail = 0, cached = 0;
  for (var k = 0; k < tiles.length; k++) {
    var t = tiles[k];
    try {
      var r = await fetchTile(t[0], t[1], t[2], t[3], 3);
      if (r.cached) cached++; else ok++;
      if ((k + 1) % 25 === 0 || k === tiles.length - 1) {
        process.stdout.write('[' + (k + 1) + '/' + tiles.length + '] baru=' + ok + ' cache=' + cached + '\n');
      }
      if (!r.cached) await sleep(1800);
    } catch (e) {
      fail++;
      console.log('\n  GAGAL permanen tile ' + t.join(','));
    }
  }
  console.log('SELESAI: baru=' + ok + ' cache=' + cached + ' gagal=' + fail);
  process.exit(fail > tiles.length * 0.1 ? 1 : 0);
})();
