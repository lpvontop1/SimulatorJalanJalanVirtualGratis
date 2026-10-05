/* =========================================================
 * Router — panduan rute (Dijkstra pada graf berarah)
 * dipakai untuk: garis rute, rekomendasi pilihan di persimpangan,
 * dan memilih jalur keluar bundaran terbaik.
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
    this.dist = null;     // nodeId -> biaya menuju titik akhir
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

  /** Bangun daftar sisi berarah: dari node -> [{to, cost, wayId}] */
  Router.prototype.buildForward = function () {
    var fwd = new Map(), self = this;
    this.g.ways.forEach(function (w) {
      for (var i = 1; i < w.nodeIds.length; i++) {
        var a = w.nodeIds[i - 1], b = w.nodeIds[i];
        if (self.g.canGo(w.id, a, b)) {
          if (!fwd.has(a)) fwd.set(a, []);
          fwd.get(a).push({ to: b, wayId: w.id });
        }
        if (self.g.canGo(w.id, b, a)) {
          if (!fwd.has(b)) fwd.set(b, []);
          fwd.get(b).push({ to: a, wayId: w.id });
        }
      }
    });
    return fwd;
  };

  /** Hitung dist-to-end utk semua node (Dijkstra pada graf TERBALIK dari titik akhir) */
  Router.prototype.setEnd = function (endNodeId) {
    var fwd = this.buildForward();
    var rev = new Map();
    fwd.forEach(function (edges, from) {
      edges.forEach(function (e) {
        if (!rev.has(e.to)) rev.set(e.to, []);
        rev.get(e.to).push({ to: from, wayId: e.wayId });
      });
    });
    this.endNodeId = endNodeId;
    var dist = new Map(), self = this;
    var heap = new MinHeap();
    dist.set(endNodeId, 0);
    heap.push({ d: 0, n: endNodeId });
    while (heap.a.length) {
      var top = heap.pop();
      var dCur = dist.has(top.n) ? dist.get(top.n) : Infinity; // HATI-HATI: 0 itu valid, jangan pakai ||
      if (top.d > dCur + 1e-9) continue;
      var edges = rev.get(top.n) || [];
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        var nd = top.d + self.edgeCost(e.wayId, top.n, e.to);
        var dTo = dist.has(e.to) ? dist.get(e.to) : Infinity;
        if (nd < dTo - 1e-9) {
          dist.set(e.to, nd);
          heap.push({ d: nd, n: e.to });
        }
      }
    }
    this.dist = dist;
    this.ready = true;
    return dist;
  };

  Router.prototype.distToEnd = function (nodeId) {
    if (!this.ready) return Infinity;
    var d = this.dist.get(nodeId);
    return d === undefined ? Infinity : d;
  };

  /** Rekomendasikan opsi terbaik di persimpangan (indeks, atau -1 bila tak bisa) */
  Router.prototype.recommend = function (options) {
    if (!this.ready || !options || !options.length) return -1;
    var best = -1, bestD = Infinity;
    for (var i = 0; i < options.length; i++) {
      var d = this.distToEnd(options[i].toNodeId);
      if (d < bestD - 1e-9) { bestD = d; best = i; }
    }
    return isFinite(bestD) ? best : -1;
  };

  /** Rekomendasi jalur keluar bundaran: biaya ring + distToEnd */
  Router.prototype.recommendExit = function (exits, ringDist) {
    if (!this.ready || !exits || !exits.length) return -1;
    var best = -1, bestD = Infinity;
    for (var i = 0; i < exits.length; i++) {
      var d = (ringDist[i] || 0) + this.distToEnd(exits[i].toNodeId);
      if (d < bestD - 1e-9) { bestD = d; best = i; }
    }
    return isFinite(bestD) ? best : -1;
  };

  root.Router = Router;
})(typeof window !== 'undefined' ? window : globalThis);
