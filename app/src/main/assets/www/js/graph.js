/* =========================================================
 * RoadGraph — graf jalan dari data Overpass/OSM
 * Aturan penting:
 *  - oneway dihormati ketat (tidak bisa melawan arah)
 *  - flyover/underpass: jalan hanya tersambung bila layer sama
 *    (kecuali ramp/link yang memang menghubungkan beda layer, selisih <= 1)
 *  - bundaran (junction=roundabout) = oneway otomatis
 * ========================================================= */
(function (root) {
  'use strict';
  var C = root.CONFIG, U = root.Utils;

  function RoadGraph() {
    this.nodes = new Map(); // id -> {id, lat, lon, wayIds:[]}
    this.ways = new Map();  // id -> {id, nodeIds:[], tags:{}, layer, oneway, name, hw, isLink, isRoundabout, lengthM}
    this.nodeKey = new Map(); // "lat,lon rounded" -> nodeId (gabung node koordinat sama dari way beda)
  }

  /* ---------- filter jalan yang bisa dilalui mobil ---------- */
  RoadGraph.prototype.isDrivable = function (tags) {
    if (!tags || !tags.highway) return false;
    if (C.DRIVABLE.indexOf(tags.highway) === -1) return false;
    if (tags.area === 'yes') return false;
    if (tags.access === 'no' || tags.access === 'private' || tags.motor_vehicle === 'no' || tags.motor_vehicle === 'private') return false;
    if (tags.highway === 'service') {
      var s = tags.service;
      if (s === 'parking_aisle' || s === 'driveway' || s === 'drive-through' || s === 'emergency_access') return false;
    }
    return true;
  };

  RoadGraph.prototype.layerOf = function (tags) {
    var l = parseFloat(tags && tags.layer);
    if (!isNaN(l)) return l;
    if (tags && tags.tunnel === 'yes' && !tags.layer) return -1; // konvensi umum tunnel = layer -1
    return 0;
  };

  /** 'fwd' | 'rev' | null (dua arah) — arah YANG DILARANG dihitung di sini */
  RoadGraph.prototype.onewayOf = function (tags) {
    var ow = tags.oneway;
    if (ow === '-1') return 'fwd';           // hanya boleh melawan urutan node => larang maju
    if (ow === 'yes' || ow === '1' || ow === 'true') return 'rev'; // hanya boleh maju => larang mundur
    // bundaran secara semantik OSM selalu one-way (searah sirkulasi)
    if (tags.junction === 'roundabout' && ow !== 'no') return 'rev';
    var hw = tags.highway;
    if ((hw === 'motorway' || hw === 'motorway_link') && ow !== 'no') return 'rev'; // implied oneway
    return null;
  };

  RoadGraph.prototype.buildFromOverpass = function (json) {
    var els = (json && json.elements) || [];
    var i, el;
    // 1) nodes
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.type === 'node') {
        this.nodes.set(el.id, { id: el.id, lat: el.lat, lon: el.lon, wayIds: [] });
      }
    }
    // 2) ways drivable
    var kept = 0;
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.type !== 'way') continue;
      var tags = el.tags || {};
      if (!this.isDrivable(tags)) continue;
      var nodeIds = (el.nodes || []).filter(function (nid) { return this.nodes.has(nid); }, this);
      if (nodeIds.length < 2) continue;
      var onewayRaw = this.onewayOf(tags);
      var hw = tags.highway;
      var way = {
        id: el.id,
        nodeIds: nodeIds,
        tags: tags,
        hw: hw,
        isLink: hw.indexOf('_link') !== -1,
        layer: this.layerOf(tags),
        oneway: onewayRaw, // 'fwd' = larang maju; 'rev' = larang mundur; null = dua arah
        isRoundabout: tags.junction === 'roundabout',
        name: tags.name || tags.ref || (C.HIGHWAY_LABEL[hw] || 'Jalan'),
        lengthM: 0
      };
      var n;
      for (var j = 1; j < nodeIds.length; j++) {
        n = this.nodes.get(nodeIds[j - 1]); var m = this.nodes.get(nodeIds[j]);
        way.lengthM += U.haversine(n.lat, n.lon, m.lat, m.lon);
      }
      this.ways.set(el.id, way);
      kept++;
    }
    // 3) tautkan node <-> way + gabungkan node yang berimpit koordinat (flyover memakai node berbeda namun koordinat sama)
    this.ways.forEach(function (w) {
      w.nodeIds.forEach(function (nid) {
        var nd = this.nodes.get(nid);
        if (nd.wayIds.indexOf(w.id) === -1) nd.wayIds.push(w.id);
      }, this);
    }, this);
    return kept;
  };

  /* ---------- konektivitas ---------- */

  /** Bolehkah bergerak di `way` dari node a ke node b? (berbasis posisi, aman utk way loop) */
  RoadGraph.prototype.canGo = function (wayId, aId, bId) {
    var w = this.ways.get(wayId);
    if (!w || aId === bId) return false;
    var ids = w.nodeIds;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] !== aId) continue;
      if (i + 1 < ids.length && ids[i + 1] === bId && w.oneway !== 'fwd') return true;
      if (i - 1 >= 0 && ids[i - 1] === bId && w.oneway !== 'rev') return true;
    }
    return false;
  };

  /**
   * Dua way tersambung di node yang sama?
   * Flyover/underpass: hanya layer sama yang tersambung.
   * Ramp/link boleh menghubungkan selisih layer <= 1 (secara fisik mereka memang turun-naik).
   */
  RoadGraph.prototype.connectable = function (wayA, wayB) {
    if (wayA === wayB) return true;
    var a = this.ways.get(wayA), b = this.ways.get(wayB);
    if (!a || !b) return false;
    if (a.layer === b.layer) return true;
    if ((a.isLink || b.isLink) && Math.abs(a.layer - b.layer) <= 1) return true;
    return false;
  };

  /** Semua tetangga node yang bisa dituju dari fromNodeId melalui wayId (semua okuransi) */
  RoadGraph.prototype.nextNodeOf = function (wayId, fromNodeId) {
    var res = [], seen = new Set(), self = this;
    var w = this.ways.get(wayId);
    if (!w) return res;
    var ids = w.nodeIds;
    function tryPush(toId) {
      if (!toId || seen.has(toId)) return;
      if (self.canGo(wayId, fromNodeId, toId)) { seen.add(toId); res.push(toId); }
    }
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] !== fromNodeId) continue;
      if (i + 1 < ids.length) tryPush(ids[i + 1]);
      if (i - 1 >= 0) tryPush(ids[i - 1]);
    }
    return res;
  };

  /**
   * Opsi lanjutan di node `atId`, datang dari way `inWayId` via node `prevNodeId`
   * (null saat posisi awal). Tidak pernah melawan oneway. Hanya menyambung
   * layer sesuai aturan flyover/ramp.
   * return [{wayId, toNodeId, way, isReverse}]
   */
  RoadGraph.prototype.optionsAt = function (atId, inWayId, prevNodeId) {
    var self = this;
    var node = this.nodes.get(atId);
    if (!node) return [];
    var inWay = inWayId != null ? this.ways.get(inWayId) : null;
    var raw = [];

    node.wayIds.forEach(function (wid) {
      var w = self.ways.get(wid);
      if (!w) return;
      if (!inWay || self.connectable(inWayId, wid)) {
        self.nextNodeOf(wid, atId).forEach(function (toId) {
          raw.push({ wayId: wid, toNodeId: toId, way: w });
        });
      }
    });

    // dedupe (way yang melingkar bisa memuat node sama dua kali)
    var seen = new Set();
    raw = raw.filter(function (o) {
      var k = o.wayId + ':' + o.toNodeId;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (!inWay) return raw;

    // Pisahkan "putar balik murni" = kembali persis ke node asal lewat way yang sama
    var nonUturn = raw.filter(function (o) {
      return !(o.wayId === inWayId && o.toNodeId === prevNodeId);
    });
    var uturnOpt = raw.filter(function (o) {
      return o.wayId === inWayId && o.toNodeId === prevNodeId;
    });

    var result = nonUturn.slice();
    if (uturnOpt.length) {
      var major = C.MAJOR_ROADS.indexOf(inWay.hw) !== -1 || inWay.isLink;
      var deadEnd = nonUturn.length === 0;
      // Putar balik ditawarkan di jalan mayor / jalan buntu, asal oneway mengizinkan
      if ((major || deadEnd)) result = result.concat(uturnOpt);
    }
    return result;
  };

  /** Semua opsi TANPA filter putar-balik (dipakai darurat agar mobil tidak pernah macet) */
  RoadGraph.prototype.rawOptionsAt = function (atId) {
    var self = this;
    var node = this.nodes.get(atId);
    if (!node) return [];
    var raw = [];
    node.wayIds.forEach(function (wid) {
      self.nextNodeOf(wid, atId).forEach(function (toId) {
        raw.push({ wayId: wid, toNodeId: toId, way: self.ways.get(wid) });
      });
    });
    return raw;
  };

  /** cari titik terdekat di seluruh way (snap tap pemain) */
  RoadGraph.prototype.findNearest = function (lat, lon, maxDistM) {
    var best = null, self = this;
    this.ways.forEach(function (w) {
      for (var i = 1; i < w.nodeIds.length; i++) {
        var a = self.nodes.get(w.nodeIds[i - 1]), b = self.nodes.get(w.nodeIds[i]);
        var pr = U.projectToSegment(lat, lon, a.lat, a.lon, b.lat, b.lon);
        if (!best || pr.distM < best.distM) {
          best = {
            distM: pr.distM, lat: pr.lat, lon: pr.lon, wayId: w.id,
            segIndex: i - 1, t: pr.t,
            nodeA: w.nodeIds[i - 1], nodeB: w.nodeIds[i]
          };
        }
      }
    });
    if (!best || best.distM > (maxDistM || C.SNAP_MAX_DIST_M)) return null;
    return best;
  };

  root.RoadGraph = RoadGraph;
})(typeof window !== 'undefined' ? window : globalThis);
