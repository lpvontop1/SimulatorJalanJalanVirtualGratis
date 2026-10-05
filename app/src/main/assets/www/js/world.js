/* =========================================================
 * WorldExpander — perluasan dinamis data jalan selama berkendara.
 * Saat mobil mendekati batas data yang sudah dimuat, tile bbox baru
 * diambil dari Overpass (fallback OSM API 0.6) lalu digabung ke graf.
 * Dengan ini perjalanan jauh (mis. Monas -> Kebun Raya Bogor) tidak
 * pernah menabrak "tepi data".
 * Kredit: zdn_gg
 * ========================================================= */
(function (root) {
  'use strict';
  var C = root.CONFIG;

  /* ---------------- Pengambil data jaringan ---------------- */
  var Net = {};

  /* UA identitas aplikasi — praktik sopan yang direkomendasikan wiki OSM */
  Net.UA = 'SimulatorJalanJalanVirtual/' + (C.VERSION || '1.0.2') + ' (hybrid driving game; credit zdn_gg)';

  /** Query Overpass utk bbox; excludeService dipakai tile ekspansi (hemat kuota) */
  Net.bboxQuery = function (s, w, n, e, excludeService) {
    var kinds = 'motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|road|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
    if (!excludeService) kinds += '|service';
    return '[out:json][timeout:30];way["highway"~"^(' + kinds + ')$"](' +
      s.toFixed(5) + ',' + w.toFixed(5) + ',' + n.toFixed(5) + ',' + e.toFixed(5) + ');(._;>;);out body qt;';
  };

  /**
   * Ambil data jalan utk bbox: coba semua endpoint Overpass, lalu fallback OSM API 0.6.
   * resolve({json, via}) | reject(Error)
   */
  Net.fetchRoadBBox = function (s, w, n, e, opts) {
    opts = opts || {};
    var body = 'data=' + encodeURIComponent(Net.bboxQuery(s, w, n, e, !!opts.excludeService));
    return new Promise(function (resolve, reject) {
      var attempt = function (idx) {
        if (idx >= C.OVERPASS_ENDPOINTS.length) {
          Net._fetchOsmApi(s, w, n, e).then(resolve, reject);
          return;
        }
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || C.OVERPASS_TIMEOUT_MS);
        fetch(C.OVERPASS_ENDPOINTS[idx], { method: 'POST', body: body, signal: ctrl.signal, headers: { 'User-Agent': Net.UA } })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (json) {
            clearTimeout(timer);
            // hasil kosong = gagal (instansi regional/terlalu tersaring) -> coba endpoint berikutnya
            if (!json || !json.elements || !json.elements.length) throw new Error('kosong');
            resolve({ json: json, via: 'Overpass' });
          })
          .catch(function () { clearTimeout(timer); attempt(idx + 1); });
      };
      attempt(0);
    });
  };

  /** Satu permintaan HTTP dengan retry utk 429 (rate-limit) & 5xx */
  Net._osmGet = function (url, attempts) {
    attempts = attempts == null ? 2 : attempts;
    return new Promise(function (resolve, reject) {
      var attempt = function (n) {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, 60000);
        fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': Net.UA } }).then(function (r) {
          clearTimeout(timer);
          if (r.status === 429 || r.status >= 500) {
            if (n > 0) { setTimeout(function () { attempt(n - 1); }, r.status === 429 ? 6000 : 2500); return; }
            reject(new Error('HTTP ' + r.status));
            return;
          }
          if (r.status === 400) {
            // Bisa jadi "too many nodes" (batas 50rb node OSM API) — baca body agar
            // pemanggil (_fetchOsmApi) bisa memutuskan memecah bbox jadi 4 kuadran.
            r.text().then(function (txt) {
              if (txt && txt.indexOf('too many nodes') !== -1) resolve(txt);
              else reject(new Error('HTTP 400'));
            }, function () { reject(new Error('HTTP 400')); });
            return;
          }
          if (!r.ok) { reject(new Error('HTTP ' + r.status)); return; }
          r.text().then(resolve, reject);
        }).catch(function (err) {
          clearTimeout(timer);
          if (n > 0) { setTimeout(function () { attempt(n - 1); }, 2500); return; }
          reject(err);
        });
      };
      attempt(attempts);
    });
  };

  /** Cadangan resmi OSM API 0.6 (geometri utuh, tanpa filter — lebih besar tapi andal).
   *  Area padat bisa melebihi batas 50rb node -> bbox dipecah 4 otomatis (rekursif, sekuensial). */
  Net._fetchOsmApi = function (s, w, n, e, depth) {
    depth = depth || 0;
    var PAD = depth === 0 ? 0.004 : 0; // perluas sedikit di level atas agar jalan tepi tetap utuh
    var url = 'https://api.openstreetmap.org/api/0.6/map.json?bbox=' +
      (w - PAD).toFixed(5) + ',' + (s - PAD).toFixed(5) + ',' + (e + PAD).toFixed(5) + ',' + (n + PAD).toFixed(5);
    return Net._osmGet(url).then(function (txt) {
      if (txt.indexOf('too many nodes') !== -1) {
        var err = new Error('too big');
        err.tooBig = true;
        throw err;
      }
      var json = JSON.parse(txt);
      if (!json || !json.elements || !json.elements.length) throw new Error('kosong');
      return { json: json, via: 'OSM API' };
    }).catch(function (err) {
      if (err && err.tooBig) {
        if (depth >= 3) {
          // kuadran terdalam pun masih kebesaran (sangat jarang) — kirim kosong agar tidak fatal
          return { json: { elements: [] }, via: 'OSM API', partial: true };
        }
        // pecah jadi 4 kuadran, diambil SEKUENSIAL (ramah rate-limit), lalu digabung
        var midLat = (s + n) / 2, midLon = (w + e) / 2;
        var quads = [
          [s, w, midLat, midLon], [s, midLon, midLat, e],
          [midLat, w, n, midLon], [midLat, midLon, n, e]
        ];
        var parts = [];
        var chain = Promise.resolve();
        quads.forEach(function (q) {
          chain = chain.then(function () {
            return Net._fetchOsmApi(q[0], q[1], q[2], q[3], depth + 1);
          }).then(function (p) { parts.push(p); });
        });
        return chain.then(function () {
          var els = [], seen = {};
          parts.forEach(function (p) {
            (p.json.elements || []).forEach(function (el) {
              var k = el.type + el.id;
              if (seen[k]) return;
              seen[k] = 1;
              els.push(el);
            });
          });
          return { json: { elements: els }, via: 'OSM API' };
        });
      }
      throw err;
    });
  };

  /* ---------------- Ekspander dunia ---------------- */
  function WorldExpander(graph, opts) {
    opts = opts || {};
    this.graph = graph;
    this.tileDeg = opts.tileDeg || C.EXPAND_TILE_DEG;
    this.ring = opts.ring != null ? opts.ring : C.EXPAND_RING; // 1 => jendela 3x3 tile
    this.fetcher = opts.fetcher || function (s, w, n, e) {
      return Net.fetchRoadBBox(s, w, n, e, { excludeService: true });
    };
    this.covered = opts.covered || new Set(); // key tile yang datanya pasti sudah masuk graf
    this.maxWays = opts.maxWays || C.MAX_GRAPH_TOTAL;
    this.onMerged = opts.onMerged || null;    // function(newWays)
    this.onLimited = opts.onLimited || null;  // batas jumlah way tercapai
    this.onFail = opts.onFail || null;
    this.target = null;                        // {lat, lon} titik akhir utk prefetch koridor
    this.busy = false;
    this.mergedWays = 0;
    this.fetchCount = 0;
    this._failAt = new Map();
    this._limitedNotified = false;
    this.failCooldownMs = opts.failCooldownMs || 15000;
  }

  WorldExpander.prototype._key = function (tx, ty) { return tx + ':' + ty; };
  WorldExpander.prototype._tileIndex = function (lat, lon) {
    var t = this.tileDeg;
    return { tx: Math.floor(lon / t), ty: Math.floor(lat / t) };
  };

  /** Tandai semua tile yang SEPENUHNYA berada di dalam bbox yang datanya sudah diambil */
  WorldExpander.prototype.markCoveredBBox = function (s, w, n, e) {
    var t = this.tileDeg;
    var tx0 = Math.ceil(w / t - 1e-9), tx1 = Math.floor(e / t + 1e-9);
    var ty0 = Math.ceil(s / t - 1e-9), ty1 = Math.floor(n / t + 1e-9);
    var nMarked = 0;
    for (var tx = tx0; tx <= tx1; tx++) {
      for (var ty = ty0; ty <= ty1; ty++) {
        this.covered.add(this._key(tx, ty));
        nMarked++;
      }
    }
    return nMarked;
  };

  /** Set tujuan: tile di sepanjang garis mobil->tujuan akan diprioritaskan (koridor) */
  WorldExpander.prototype.setTarget = function (lat, lon) {
    this.target = { lat: lat, lon: lon };
  };
  WorldExpander.prototype.clearTarget = function () { this.target = null; };

  /**
   * Panggil berkala (mis. tiap 2-3 detik): bila ada tile yang belum tercakup,
   * ambil SATU tile terdekat dari posisi mobil (tile koridor ke tujuan ikut dihitung).
   * return Promise<bool> (true bila ada data baru).
   */
  WorldExpander.prototype.update = function (lat, lon) {
    var self = this;
    if (this.busy || typeof this.fetcher !== 'function') return Promise.resolve(false);
    if (this.graph.ways.size >= this.maxWays) {
      if (this.onLimited && !this._limitedNotified) { this._limitedNotified = true; this.onLimited(); }
      return Promise.resolve(false);
    }
    var t = this.tileDeg;
    var now = Date.now();
    var cand = new Map(); // key -> {tx,ty,d} (dedupe ring vs koridor)
    var ti = this._tileIndex(lat, lon);
    var dx, dy;
    for (dx = -this.ring; dx <= this.ring; dx++) {
      for (dy = -this.ring; dy <= this.ring; dy++) {
        var tx0 = ti.tx + dx, ty0 = ti.ty + dy;
        var k0 = this._key(tx0, ty0);
        if (this.covered.has(k0)) continue;
        var clat0 = (ty0 + 0.5) * t, clon0 = (tx0 + 0.5) * t;
        cand.set(k0, { tx: tx0, ty: ty0, d: Math.abs(clat0 - lat) + Math.abs(clon0 - lon) });
      }
    }
    // koridor menuju tujuan (prioritas sama, dipilih yang terdekat dari mobil)
    if (this.target) {
      var tLat = this.target.lat, tLon = this.target.lon;
      var distDeg = Math.abs(tLat - lat) + Math.abs(tLon - lon);
      var steps = Math.min(200, Math.max(1, Math.ceil(distDeg / (t / 2))));
      for (var i = 0; i <= steps; i++) {
        var f = i / steps;
        var pLat = lat + (tLat - lat) * f, pLon = lon + (tLon - lon) * f;
        var txi = Math.floor(pLon / t), tyi = Math.floor(pLat / t);
        var ki = this._key(txi, tyi);
        if (cand.has(ki) || this.covered.has(ki)) continue;
        var failAt = this._failAt.get(ki);
        if (failAt && now - failAt < this.failCooldownMs) continue;
        var clat = (tyi + 0.5) * t, clon = (txi + 0.5) * t;
        cand.set(ki, { tx: txi, ty: tyi, d: Math.abs(clat - lat) + Math.abs(clon - lon) });
      }
    }
    // urutkan kandidat: terdekat dari mobil dulu
    var list = [];
    cand.forEach(function (c) {
      var failAt2 = self._failAt.get(self._key(c.tx, c.ty));
      if (failAt2 && now - failAt2 < self.failCooldownMs) return;
      list.push(c);
    });
    if (!list.length) return Promise.resolve(false);
    list.sort(function (a, b) { return a.d - b.d; });
    var pick = list[0];
    var s = pick.ty * t, w = pick.tx * t, n = s + t, e = w + t;
    this.busy = true;
    this.fetchCount++;
    return this.fetcher(s, w, n, e).then(function (res) {
      self.busy = false;
      var json = res && res.json ? res.json : res;
      var added = self.graph.mergeFromOverpass(json);
      self.mergedWays += added;
      self.covered.add(self._key(pick.tx, pick.ty));
      if (added > 0 && self.onMerged) self.onMerged(added);
      return added > 0;
    }).catch(function () {
      self.busy = false;
      self._failAt.set(self._key(pick.tx, pick.ty), Date.now());
      if (self.onFail) self.onFail();
      return false;
    });
  };

  root.Net = Net;
  root.WorldExpander = WorldExpander;
})(typeof window !== 'undefined' ? window : globalThis);
