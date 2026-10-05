/* =========================================================
 * Router — panduan rute (Dijkstra pada state (node, way))
 * dipakai untuk: garis rute, rekomendasi pilihan di persimpangan,
 * dan memilih jalur keluar bundaran terbaik.
 * State (node, way) = mobil berada di node, terakhir melewati `way`.
 * Ini membuat aturan layer (flyover/underpass) & oneway konsisten
 * dengan aturan engine (optionsAt/connectable).
 * ========================================================= */
(function (root) {
  'use strict';
  var C = root.CONFIG, U = root.Utils;

  function MinHeap() { this.a = []; }
  MinHeap.prototype.push = function (item) {
    var a = this.a; a.push(item); var i = a.length - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (a[p].d <= a[i].d) break;
      var t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  };
  MinHeap.prototype.pop = function () {
    var a = this.a; if (!a.length) return null;
    var top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; var i = 0;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < a.length && a[l].d < a[m].d) m = l;
        if (r < a.length && a[r].d < a[m].d) m = r;
        if (m === i) break;
        var t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  };

  function Router(graph) {
    this.g = graph;
    this.dist = null;     // Map "nodeId|wayId" -> biaya menuju titik akhir
    this.endNodeId = null;
    this.ready = false;
  }

  Router.prototype.speedOf = function (way) {
    var v = C.ROUTE_SPEED[way.hw];
    if (way.tags && way.tags.maxspeed) {
      var mx = parseInt(way.tags.maxspeed, 10);
      if (!isNaN(mx) && mx > 5 && mx < 200) v = mx;
    }
    return (v || 30) / 3.6; // m/s
  };

  Router.prototype.edgeCost = function (wayId, aId, bId) {
    var a = this.g.nodes.get(aId), b = this.g.nodes.get(bId);
    return U.haversine(a.lat, a.lon, b.lat, b.lon) / this.speedOf(this.g.ways.get(wayId));
  };

  /** Biaya menuju titik akhir dari state (nodeId, wayId). Infinity bila tak terhubung. */
  Router.prototype.distToState = function (nodeId, wayId) {
    if (!this.ready) return Infinity;
    var d = this.dist.get(nodeId + '|' + wayId);
    return d === undefined ? Infinity : d;
  };

  /** Biaya terbaik dari node (cara apa pun). Infinity bila tak terhubung. */
  Router.prototype.distToEnd = function (nodeId) {
    if (!this.ready) return Infinity;
    var node = this.g.nodes.get(nodeId);
    if (!node) return Infinity;
    var best = Infinity;
    for (var i = 0; i < node.wayIds.length; i++) {
      var d = this.distToState(nodeId, node.wayIds[i]);
      if (d < best) best = d;
    }
    return best;
  };

  /**
   * Dijkstra TERBALIK dari titik akhir pada state (node, way).
   * Predesesor dari state (m, W2): node n lewat W2 (n -> m boleh),
   * lalu transisi W -> W2 di n harus connectable (aturan layer flyover).
   */
  Router.prototype.setEnd = function (endNodeId) {
    var g = this.g, self = this;
    this.endNodeId = endNodeId;
    var dist = new Map();
    var heap = new MinHeap();
    var endNode = g.nodes.get(endNodeId);
    if (endNode) {
      endNode.wayIds.forEach(function (wid) {
        var k = endNodeId + '|' + wid;
        dist.set(k, 0);
        heap.push({ d: 0, n: endNodeId, w: wid });
      });
    }
    while (heap.a.length) {
      var top = heap.pop();
      var kCur = top.n + '|' + top.w;
      var dCur = dist.has(kCur) ? dist.get(kCur) : Infinity; // 0 itu valid — jangan pakai ||
      if (top.d > dCur + 1e-9) continue;
      // predesesor: n --(W2)--> top.n, di top.n tiba via W2 (dari n lewat W)
      var waysAtM = g.nodes.get(top.n).wayIds;
      var seenPair = new Set();
      for (var i = 0; i < waysAtM.length; i++) {
        var w2id = waysAtM[i];
        var ns = g.adjNodesOf(w2id, top.n);
        for (var j = 0; j < ns.length; j++) {
          var n = ns[j];
          if (!g.canGo(w2id, n, top.n)) continue; // harus bisa dilalui n -> top.n
          var nodeN = g.nodes.get(n);
          for (var k = 0; k < nodeN.wayIds.length; k++) {
            var wid = nodeN.wayIds[k];
            if (!g.connectable(wid, w2id, n)) continue; // KONSISTEN dgn engine
            var key = n + '|' + wid;
            if (seenPair.has(key)) continue;
            seenPair.add(key);
            var nd = top.d + self.edgeCost(w2id, n, top.n);
            var dOld = dist.has(key) ? dist.get(key) : Infinity;
            if (nd < dOld - 1e-9) {
              dist.set(key, nd);
              heap.push({ d: nd, n: n, w: wid });
            }
          }
        }
      }
    }
    this.dist = dist;
    this.ready = true;
    return dist;
  };

  /** Rekomendasikan opsi terbaik di persimpangan (indeks, atau -1 bila tak bisa) */
  Router.prototype.recommend = function (options) {
    if (!this.ready || !options || !options.length) return -1;
    var best = -1, bestD = Infinity;
    for (var i = 0; i < options.length; i++) {
      var d = this.distToState(options[i].toNodeId, options[i].wayId);
      if (d < bestD - 1e-9) { bestD = d; best = i; }
    }
    return isFinite(bestD) ? best : -1;
  };

  /** Rekomendasi jalur keluar bundaran: biaya ring + distToEnd */
  Router.prototype.recommendExit = function (exits, ringDist) {
    if (!this.ready || !exits || !exits.length) return -1;
    var best = -1, bestD = Infinity;
    for (var i = 0; i < exits.length; i++) {
      var d = (ringDist[i] || 0) + this.distToState(exits[i].toNodeId, exits[i].wayId);
      if (d < bestD - 1e-9) { bestD = d; best = i; }
    }
    return isFinite(bestD) ? best : -1;
  };

  root.Router = Router;
})(typeof window !== 'undefined' ? window : globalThis);
