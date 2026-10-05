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

  /* Node penghalang (barrier) yang tak bisa dilewati mobil — membuat jalan
   * di balik tarikan/bolard benar-benar berakhir (jalan buntu yang realistis). */
  var BLOCKING_BARRIERS = ['bollard', 'block', 'cycle_barrier', 'lift_gate', 'stile', 'kissing_gate', 'turnstile', 'chain', 'fence', 'wall', 'hedge', 'gate_locked'];
  RoadGraph.prototype.barrierBlocks = function (nodeTags) {
    if (!nodeTags || !nodeTags.barrier) return false;
    if (BLOCKING_BARRIERS.indexOf(nodeTags.barrier) !== -1) return true;
    if (nodeTags.barrier === 'gate' && (nodeTags.access === 'no' || nodeTags.access === 'private' || nodeTags.locked === 'yes')) return true;
    return false;
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
    this.nodes.clear();
    this.ways.clear();
    this.nodeKey.clear();
    return this._ingestElements(json);
  };

  /**
   * Gabungkan data Overpass/OSM baru ke graf yang sudah berjalan (ekspansi dinamis).
   * API OSM & Overpass selalu mengembalikan geometri way UTUH, jadi way dengan id sama
   * selalu identik -> aman dilewati. return jumlah way BARU yang ditambahkan.
   */
  RoadGraph.prototype.mergeFromOverpass = function (json) {
    return this._ingestElements(json);
  };

  RoadGraph.prototype._ingestElements = function (json) {
    var els = (json && json.elements) || [];
    var i, el;
    // 0) Hemat memori (v1.1.0): OSM API 0.6 mengembalikan SEMUA objek di bbox
    //    (gedung, trotoar, pohon...). Simpan HANYA node yang dipakai way drivable.
    //    Payload Overpass hasil filter tetap utuh (semua nodenya milik jalan).
    var needed = null;
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.type === 'way' && !this.ways.has(el.id) && this.isDrivable(el.tags || {})) { needed = {}; break; }
    }
    if (needed) {
      for (i = 0; i < els.length; i++) {
        el = els[i];
        if (el.type === 'way' && !this.ways.has(el.id) && this.isDrivable(el.tags || {})) {
          var nds = el.nodes || [];
          for (var k = 0; k < nds.length; k++) needed[nds[k]] = 1;
        }
      }
    }
    // 1) nodes (simpan juga tags utk deteksi barrier/noexit)
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.type === 'node' && !this.nodes.has(el.id)) {
        if (needed && !needed[el.id]) continue; // node tak terpakai -> buang
        this.nodes.set(el.id, { id: el.id, lat: el.lat, lon: el.lon, wayIds: [], tags: el.tags || null });
      }
    }
    // 2) ways drivable yang belum ada
    var kept = 0;
    var newWays = [];
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.type !== 'way') continue;
      if (this.ways.has(el.id)) continue; // sudah ada (geometri utuh -> identik)
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
      newWays.push(way);
      kept++;
    }
    // 3) tautkan node <-> way (hanya way baru)
    for (i = 0; i < newWays.length; i++) {
      var w = newWays[i];
      for (var k = 0; k < w.nodeIds.length; k++) {
        var nd = this.nodes.get(w.nodeIds[k]);
        if (nd.wayIds.indexOf(w.id) === -1) nd.wayIds.push(w.id);
      }
    }
    return kept;
  };

  /* ---------- konektivitas ---------- */

  /** Bolehkah bergerak di `way` dari node a ke node b? (berbasis posisi, aman utk way loop) */
  RoadGraph.prototype.canGo = function (wayId, aId, bId) {
    var w = this.ways.get(wayId);
    if (!w || aId === bId) return false;
    // barrier (lift_gate/bollard/dll) = dinding: segmen yang menyentuhnya tak bisa dilalui
    if (this._blocked(aId) || this._blocked(bId)) return false;
    var ids = w.nodeIds;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] !== aId) continue;
      if (i + 1 < ids.length && ids[i + 1] === bId && w.oneway !== 'fwd') return true;
      if (i - 1 >= 0 && ids[i - 1] === bId && w.oneway !== 'rev') return true;
    }
    return false;
  };

  RoadGraph.prototype._blocked = function (nodeId) {
    var nd = this.nodes.get(nodeId);
    return !!(nd && this.barrierBlocks(nd.tags));
  };

  /**
   * Dua way tersambung di node yang sama?
   * Aturan flyover/underpass (semantik OSM wiki Key:layer):
   *  - layer sama: tersambung.
   *  - node UJUNG salah satu way: SELALU tersambung (jalan benar-benar
   *    berakhir/lanjut di situ — mis. permukaan L0 turun ke underpass L-2;
   *    beda layer berapapun sah karena mapper memang menghubungkannya).
   *  - ramp/link: beda layer <= 1 tersambung (memang naik-turun).
   *  - flyover MELINTAS di tengah ruas (node interior kedua way): TIDAK tersambung.
   */
  RoadGraph.prototype._isEndpoint = function (wayId, nodeId) {
    var w = this.ways.get(wayId);
    if (!w || nodeId == null) return false;
    return w.nodeIds[0] === nodeId || w.nodeIds[w.nodeIds.length - 1] === nodeId;
  };

  RoadGraph.prototype.connectable = function (wayA, wayB, nodeId) {
    if (wayA === wayB) return true;
    var a = this.ways.get(wayA), b = this.ways.get(wayB);
    if (!a || !b) return false;
    if (a.layer === b.layer) return true;
    var diff = Math.abs(a.layer - b.layer);
    if (nodeId != null && (this._isEndpoint(wayA, nodeId) || this._isEndpoint(wayB, nodeId))) return true;
    if (a.isLink || b.isLink) return diff <= 1;
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

  /** Tetangga MENTAH (tanpa cek arah) — dipakai Dijkstra terbalik */
  RoadGraph.prototype.adjNodesOf = function (wayId, nodeId) {
    var res = [], seen = new Set();
    var w = this.ways.get(wayId);
    if (!w) return res;
    var ids = w.nodeIds;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] !== nodeId) continue;
      if (i + 1 < ids.length && !seen.has(ids[i + 1])) { seen.add(ids[i + 1]); res.push(ids[i + 1]); }
      if (i - 1 >= 0 && !seen.has(ids[i - 1])) { seen.add(ids[i - 1]); res.push(ids[i - 1]); }
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
      if (!inWay || self.connectable(inWayId, wid, atId)) {
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

  /** cari titik terdekat di seluruh way (snap tap pemain)
   *  v1.1.0: utamakan jalan NON-service — jangan memulai/mengakhiri perjalanan
   *  di loop parkir/jalan layanan bila jalan utama hanya sedikit lebih jauh. */
  RoadGraph.prototype.findNearest = function (lat, lon, maxDistM) {
    var best = null, bestMain = null, self = this;
    this.ways.forEach(function (w) {
      var isMain = w.hw !== 'service';
      for (var i = 1; i < w.nodeIds.length; i++) {
        // lewati segmen jebakan (kedua arah terlarang) — tidak layak jadi titik awal
        var aId = w.nodeIds[i - 1], bId = w.nodeIds[i];
        if (!self.canGo(w.id, aId, bId) && !self.canGo(w.id, bId, aId)) continue;
        var a = self.nodes.get(aId), b = self.nodes.get(bId);
        var pr = U.projectToSegment(lat, lon, a.lat, a.lon, b.lat, b.lon);
        if (!best || pr.distM < best.distM) {
          best = {
            distM: pr.distM, lat: pr.lat, lon: pr.lon, wayId: w.id,
            segIndex: i - 1, t: pr.t,
            nodeA: aId, nodeB: bId
          };
        }
        if (isMain && (!bestMain || pr.distM < bestMain.distM)) {
          bestMain = {
            distM: pr.distM, lat: pr.lat, lon: pr.lon, wayId: w.id,
            segIndex: i - 1, t: pr.t, nodeA: aId, nodeB: bId
          };
        }
      }
    });
    var limit = maxDistM || C.SNAP_MAX_DIST_M;
    if (!best || best.distM > limit) return null;
    // bila terdekat adalah jalan layanan & jalan utama masih dalam jangkauan
    // (maksimal 250 m lebih jauh), pakai jalan utama agar tidak nyangkut di parkir
    var bestWay = this.ways.get(best.wayId);
    if (bestWay && bestWay.hw === 'service' && bestMain &&
        bestMain.distM <= limit && bestMain.distM <= best.distM + 250) {
      return bestMain;
    }
    return best;
  };

  /** Jarak ke way terdekat (tanpa batas) — null bila graf kosong. Untuk cek "area ini belum termuat?" */
  RoadGraph.prototype.nearestDistM = function (lat, lon) {
    var best = null, self = this;
    this.ways.forEach(function (w) {
      for (var i = 1; i < w.nodeIds.length; i++) {
        var a = self.nodes.get(w.nodeIds[i - 1]), b = self.nodes.get(w.nodeIds[i]);
        var pr = U.projectToSegment(lat, lon, a.lat, a.lon, b.lat, b.lon);
        if (best == null || pr.distM < best) best = pr.distM;
      }
    });
    return best;
  };

  /**
   * Segmen boleh jadi titik penempatan mobil? Minimal satu arah sah
   * (tidak melawan oneway & tidak menabrak barrier lift_gate/bollard).
   * Segmen "jebakan" (kedua arah terlarang) dilewati findNearest agar
   * pemain tidak bisa menaruh mobil di kantong tanpa jalan keluar.
   */
  RoadGraph.prototype.placeableSegment = function (wayId, segIndex) {
    var w = this.ways.get(wayId);
    if (!w) return false;
    if (segIndex < 0 || segIndex + 1 >= w.nodeIds.length) return false;
    var a = w.nodeIds[segIndex], b = w.nodeIds[segIndex + 1];
    return this.canGo(wayId, a, b) || this.canGo(wayId, b, a);
  };

  /**
   * Titik terdekat dengan syarat tambahan (predicate pada (nodeA, nodeB, wayId)).
   * Dipakai untuk mencari titik akhir alternatif yang TERHUBUNG ke komponen mobil.
   */
  RoadGraph.prototype.findNearestWhere = function (lat, lon, maxDistM, pred) {
    var best = null, self = this;
    this.ways.forEach(function (w) {
      for (var i = 1; i < w.nodeIds.length; i++) {
        var aId = w.nodeIds[i - 1], bId = w.nodeIds[i];
        if (!self.canGo(w.id, aId, bId) && !self.canGo(w.id, bId, aId)) continue;
        var a = self.nodes.get(aId), b = self.nodes.get(bId);
        var pr = U.projectToSegment(lat, lon, a.lat, a.lon, b.lat, b.lon);
        if (pr.distM > (maxDistM || C.SNAP_MAX_DIST_M)) continue;
        if (pred && !pred(aId, bId, w.id, pr)) continue;
        if (!best || pr.distM < best.distM) {
          best = {
            distM: pr.distM, lat: pr.lat, lon: pr.lon, wayId: w.id,
            segIndex: i - 1, t: pr.t, nodeA: aId, nodeB: bId
          };
        }
      }
    });
    return best;
  };

  root.RoadGraph = RoadGraph;
})(typeof window !== 'undefined' ? window : globalThis);
