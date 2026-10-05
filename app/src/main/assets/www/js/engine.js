/* =========================================================
 * DriveEngine — mesin berkendara
 * Mekanik:
 *  - mobil melaju terus di ruas jalan, kecepatan diatur pemain
 *  - di persimpangan muncul pilihan ganda (kiri/lurus/kanan/putar balik)
 *  - tidak memilih 20 detik -> sistem pilih otomatis (lurus; pertigaan/simpang: acak)
 *  - bundaran: pilih jalur keluar (dinomori dari arah masuk)
 *  - flyover/underpass: hanya jalan dengan layer sama yang tersambung
 *  - one-way: mustahil melawan arah (dijamin RoadGraph)
 *  - titik akhir: melewati radiusnya -> rekap & selesai
 * ========================================================= */
(function (root) {
  'use strict';
  var C = root.CONFIG, U = root.Utils;

  function DriveEngine(opts) {
    this.graph = opts.graph;
    this.router = opts.router || null;
    this.guided = !!opts.guided;
    this.end = opts.end || null; // {lat, lon, wayId}
    this.decisionTimeoutS = opts.decisionTimeoutS || C.DECISION_TIMEOUT_S;

    this.car = null;
    this.prevNodeId = null;
    this.waiting = false;
    this.decision = null;      // {kind, options|exits, timerS, ringDist?, recommended}
    this.pendingExit = -1;     // indeks jalur keluar bundaran yang dipilih
    this.rbExits = null;       // daftar keluar bundaran aktif
    this.paused = true;
    this.finished = false;
    this._listeners = {};
    this.stats = this._freshStats();
  }

  DriveEngine.prototype._freshStats = function () {
    return {
      distanceM: 0, elapsedMs: 0, decisions: 0, autoPicks: 0,
      turns: { left: 0, straight: 0, right: 0, uturn: 0 },
      roundabouts: 0, maxSpeedKmh: 0, speedSum: 0, speedN: 0
    };
  };

  DriveEngine.prototype.on = function (evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
    return this;
  };
  DriveEngine.prototype.emit = function (evt, data) {
    var l = this._listeners[evt] || [];
    for (var i = 0; i < l.length; i++) l[i](data);
  };

  /* ---------------- penempatan awal ---------------- */
  DriveEngine.prototype.place = function (snap) {
    // snap: {wayId, segIndex, t, dir?} dari graph.findNearest (dir = arah preferensi opsional)
    var w = this.graph.ways.get(snap.wayId);
    var fromIdx = snap.segIndex, dir = 0;
    var fwdOk = w.oneway !== 'fwd' && fromIdx + 1 < w.nodeIds.length;
    var revOk = w.oneway !== 'rev' && fromIdx - 1 >= 0;
    if (snap.dir === 1 && fwdOk) dir = 1;
    else if (snap.dir === -1 && revOk) dir = -1;
    else if (fwdOk && !revOk) dir = 1;
    else if (!fwdOk && revOk) dir = -1;
    else if (snap.t > 0.5 && revOk) dir = -1; // dekat ujung -> arah jauh
    else dir = 1;
    this.car = {
      wayId: snap.wayId, fromIdx: fromIdx, dir: dir,
      toIdx: fromIdx + dir, t: snap.t,
      lat: 0, lon: 0, bearing: 0, speedKmh: C.START_SPEED_KMH
    };
    this._updatePos();
    this.prevNodeId = null;
    return this.car;
  };

  DriveEngine.prototype.start = function () {
    if (!this.car) throw new Error('place() belum dipanggil');
    this.paused = false;
    this.emit('start', { car: this.car, end: this.end, guided: this.guided });
    // bila langsung berada di bundaran (mulai di lingkaran bundaran)
    var w = this.graph.ways.get(this.car.wayId);
    if (w.isRoundabout) this._maybeRoundaboutAtStart();
  };

  DriveEngine.prototype.pause = function () { this.paused = true; this.emit('pause', {}); };
  DriveEngine.prototype.resume = function () { if (!this.finished) { this.paused = false; this.emit('resume', {}); } };

  /* ---------------- kecepatan ---------------- */
  DriveEngine.prototype.setSpeedDelta = function (dkmh) {
    if (!this.car) return;
    this.car.speedKmh = U.clamp(this.car.speedKmh + dkmh, C.MIN_SPEED_KMH, C.MAX_SPEED_KMH);
    this.emit('speed', { kmh: this.car.speedKmh });
  };

  /* ---------------- pergerakan ---------------- */
  DriveEngine.prototype._nodeOf = function (wayId, idx) {
    return this.graph.nodes.get(this.graph.ways.get(wayId).nodeIds[idx]);
  };

  DriveEngine.prototype._updatePos = function () {
    var c = this.car;
    var a = this._nodeOf(c.wayId, c.fromIdx), b = this._nodeOf(c.wayId, c.toIdx);
    c.lat = U.lerp(a.lat, b.lat, c.t);
    c.lon = U.lerp(a.lon, b.lon, c.t);
    c.bearing = U.bearing(a.lat, a.lon, b.lat, b.lon);
    c.segLenM = U.haversine(a.lat, a.lon, b.lat, b.lon);
  };

  DriveEngine.prototype.step = function (dtMs) {
    if (this.finished) return;
    if (this.paused) { this.emit('tick', this._tickData()); return; }
    var dt = Math.min(dtMs, 200) / 1000; // clamp dt (tab melambat)

    if (this.waiting) {
      this.stats.elapsedMs += dtMs;
      this.decision.timerS += dt;
      if (this.decision.timerS >= this.decisionTimeoutS) this._autoChoose();
      else this.emit('tick', this._tickData());
      return;
    }

    var c = this.car;
    var distM = (c.speedKmh / 3.6) * dt;
    var guard = 0;
    while (distM > 0 && guard++ < 30) {
      var remain = c.segLenM * (1 - c.t);
      if (distM < remain) {
        c.t += distM / Math.max(c.segLenM, 1e-6);
        this.stats.distanceM += distM;
        distM = 0;
      } else {
        distM -= remain;
        this.stats.distanceM += remain;
        // tiba di node
        c.t = 1;
        this._updatePos();
        var arrivedId = this.graph.ways.get(c.wayId).nodeIds[c.toIdx];
        var fromId = this.graph.ways.get(c.wayId).nodeIds[c.fromIdx];
        this.prevNodeId = fromId;
        this._arriveAt(arrivedId);
        if (this.waiting || this.finished) break;
        if (distM <= 0.0001) break;
      }
    }
    if (!this.waiting && !this.finished) this._updatePos();
    this.stats.elapsedMs += dtMs;
    this.stats.speedSum += this.car.speedKmh; this.stats.speedN++;
    this.stats.maxSpeedKmh = Math.max(this.stats.maxSpeedKmh, this.car.speedKmh);

    this._checkEnd();
    this.emit('tick', this._tickData());
  };

  DriveEngine.prototype._tickData = function () {
    var c = this.car;
    var way = this.graph.ways.get(c.wayId);
    var remainToNode = c.segLenM * (1 - c.t);
    return {
      lat: c.lat, lon: c.lon, bearing: c.bearing,
      speedKmh: c.speedKmh, waiting: this.waiting,
      wayId: c.wayId, roadName: way.name,
      remainM: remainToNode,
      distToEndM: this.end ? U.haversine(c.lat, c.lon, this.end.lat, this.end.lon) : null,
      stats: this.stats
    };
  };

  /* ---------------- tiba di node ---------------- */
  DriveEngine.prototype._arriveAt = function (nodeId) {
    var c = this.car;
    var curWay = this.graph.ways.get(c.wayId);

    // sedang di dalam bundaran dengan pilihan keluar yang sudah dikomit
    if (curWay.isRoundabout && this.pendingExit >= 0) {
      var target = this.rbExits[this.pendingExit];
      if (nodeId === target.nodeId) {
        // keluar sesuai pilihan
        var ok = this.graph.canGo(target.wayId, nodeId, target.toNodeId) &&
          this.graph.connectable(curWay.id, target.wayId);
        if (ok) { this._takeWay(target.wayId, nodeId, target.toNodeId); return; }
      }
      // lanjut mengelilingi bundaran
      var cont = this._ringContinuation(nodeId, curWay.id);
      if (cont) { this._takeWay(cont.wayId, nodeId, cont.toNodeId); return; }
      // anomaly: keluar paksa di opsi pertama yang valid
      var any = this.graph.optionsAt(nodeId, curWay.id, this.prevNodeId);
      if (any.length) { this._takeWay(any[0].wayId, nodeId, any[0].toNodeId); return; }
      this._forceEscape(nodeId);
      return;
    }

    // cek masuk bundaran
    var opts = this.graph.optionsAt(nodeId, curWay.id, this.prevNodeId);
    var ringOpt = null;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].way.isRoundabout) { ringOpt = opts[i]; break; }
    }
    if (ringOpt) {
      this._startRoundabout(nodeId, curWay.id, ringOpt);
      return;
    }

    // persimpangan biasa
    this._decide(nodeId, curWay.id);
  };

  DriveEngine.prototype._forceEscape = function (nodeId) {
    // darurat: mundur arah datang agar mobil tidak pernah beku
    var c = this.car;
    var cur = this.graph.ways.get(c.wayId);
    var prev = this.prevNodeId;
    if (prev != null && this.graph.canGo(c.wayId, nodeId, prev)) {
      this._takeWay(c.wayId, nodeId, prev);
      this.emit('toast', { text: 'Data jalan bermasalah — mobil memutar balik darurat' });
    } else {
      this.finished = true;
      this.emit('finish', { stats: this.stats, reason: 'stuck' });
    }
  };

  DriveEngine.prototype._takeWay = function (wayId, fromNodeId, toNodeId) {
    var w = this.graph.ways.get(wayId);
    var ti = w.nodeIds.indexOf(toNodeId);
    if (ti === -1) { this._forceEscape(fromNodeId); return; }
    // cari okuransi fromNodeId yang bersebelahan dengan ti (aman utk way loop)
    var fi = -1, i;
    for (i = 0; i < w.nodeIds.length; i++) {
      if (w.nodeIds[i] === fromNodeId && Math.abs(i - ti) === 1) { fi = i; break; }
    }
    if (fi === -1) fi = w.nodeIds.indexOf(fromNodeId);
    if (fi === -1) { this._forceEscape(fromNodeId); return; }
    var c = this.car;
    c.wayId = wayId; c.fromIdx = fi; c.toIdx = ti; c.dir = ti > fi ? 1 : -1;
    c.t = 0;
    this._updatePos();
    // keluar dari konteks bundaran bila meninggalkan ring
    if (!w.isRoundabout && this.pendingExit >= 0) {
      this.pendingExit = -1; this.rbExits = null;
    }
  };

  /* ---------------- persimpangan biasa ---------------- */
  DriveEngine.prototype._decide = function (nodeId, inWayId) {
    var opts = this.graph.optionsAt(nodeId, inWayId, this.prevNodeId);
    var node = this.graph.nodes.get(nodeId);
    var inWay = this.graph.ways.get(inWayId);
    var inBearing = this.car.bearing;

    if (!opts.length) {
      // jalan buntu: putar balik jika boleh, else darurat
      var raw = this.graph.rawOptionsAt(nodeId);
      var back = raw.filter(function (o) { return o.wayId === inWayId && o.toNodeId === this.prevNodeId; }, this);
      if (back.length) {
        this._takeWay(back[0].wayId, nodeId, back[0].toNodeId);
        this.stats.turns.uturn++;
        this.emit('toast', { text: 'Jalan buntu — putar balik otomatis' });
        return;
      }
      this._forceEscape(nodeId);
      return;
    }

    // klasifikasi arah
    opts.forEach(function (o) {
      var to = this.graph.nodes.get(o.toNodeId);
      var b = U.bearing(node.lat, node.lon, to.lat, to.lon);
      var diff = U.angleDiff(b, inBearing); // + = kanan
      o.bearing = b;
      o.diff = diff;
      o.cls = Math.abs(diff) <= 30 ? 'straight' : (Math.abs(diff) <= 150 ? (diff > 0 ? 'right' : 'left') : 'uturn');
    }, this);

    if (opts.length === 1) {
      // bukan persimpangan — lanjut otomatis (belokan biasa)
      var o = opts[0];
      this.stats.turns[o.cls === 'uturn' ? 'uturn' : o.cls]++;
      this._takeWay(o.wayId, nodeId, o.toNodeId);
      return;
    }

    // PERSIMPANGAN — pilihan ganda!
    this.stats.decisions++;
    this.waiting = true;
    var recommended = -1;
    if (this.guided && this.router) recommended = this.router.recommend(opts);
    this.decision = {
      kind: 'junction', options: opts, timerS: 0,
      recommended: recommended, roadName: inWay.name, nodeId: nodeId
    };
    this.emit('decision', this.decision);
  };

  /* ---------------- bundaran ---------------- */
  DriveEngine.prototype._ringContinuation = function (nodeId, curWayId) {
    var self = this;
    var opts = this.graph.rawOptionsAt(nodeId).filter(function (o) {
      return o.way.isRoundabout && self.graph.connectable(curWayId, o.wayId) &&
        self.graph.canGo(o.wayId, nodeId, o.toNodeId);
    });
    return opts.length ? opts[0] : null;
  };

  DriveEngine.prototype._startRoundabout = function (entryNodeId, inWayId, ringOpt) {
    var exits = this._computeRoundaboutExits(entryNodeId, inWayId, ringOpt);
    if (!exits.length) { this._takeWay(ringOpt.wayId, entryNodeId, ringOpt.toNodeId); return; }
    // kecil: bila cuma 1 keluar & itu jalan masuk yang sama -> lewatkan popup
    this.stats.decisions++;
    this.stats.roundabouts++;
    this.waiting = true;
    var ringDist = exits.map(function (e) { return e.ringDistM; });
    var recommended = this.guided && this.router ? this.router.recommendExit(exits, ringDist) : -1;
    this.decision = {
      kind: 'roundabout', exits: exits, timerS: 0, ringOpt: ringOpt,
      recommended: recommended, roadName: this.graph.ways.get(inWayId).name,
      nodeId: entryNodeId, ringDist: ringDist
    };
    this.emit('decision', this.decision);
  };

  /** Keluar-keluar bundaran dinomori dari arah masuk (searah sirkulasi) */
  DriveEngine.prototype._computeRoundaboutExits = function (entryNodeId, inWayId, ringOpt) {
    var self = this, exits = [];
    var ringWayIds = new Set();
    var visited = new Set();
    var steps = 0;
    var ringDist = 0;
    var cur = ringOpt.toNodeId;      // node ring pertama setelah masuk
    var curWay = ringOpt.wayId;
    var prev = entryNodeId;
    ringDist += this._segLen(ringOpt.wayId, entryNodeId, ringOpt.toNodeId);

    var collectAt = function (nodeId, excludeEntry) {
      var opts = self.graph.optionsAt(nodeId, curWay, prev);
      opts.forEach(function (o) {
        if (o.way.isRoundabout) return;
        if (excludeEntry && o.wayId === inWayId && o.toNodeId === prev) return;
        // hindari duplikat
        for (var i = 0; i < exits.length; i++) {
          if (exits[i].nodeId === nodeId && exits[i].wayId === o.wayId) return;
        }
        exits.push({ nodeId: nodeId, wayId: o.wayId, toNodeId: o.toNodeId, ringDistM: ringDist, name: o.way.name });
      });
    };

    while (steps++ < 96) {
      visited.add(curWay + ':' + cur);
      if (cur === entryNodeId) { collectAt(cur, false); break; } // satu putaran penuh
      collectAt(cur, true);
      var next = this.graph.rawOptionsAt(cur).filter(function (o) {
        return o.way.isRoundabout && self.graph.canGo(o.wayId, cur, o.toNodeId) &&
          self.graph.connectable(curWay, o.wayId);
      });
      if (!next.length) break; // ring putus (data aneh) — berhenti
      var chosen = next[0];
      ringDist += this._segLen(chosen.wayId, cur, chosen.toNodeId);
      prev = cur; cur = chosen.toNodeId; curWay = chosen.wayId;
    }
    return exits;
  };

  DriveEngine.prototype._segLen = function (wayId, aId, bId) {
    var a = this.graph.nodes.get(aId), b = this.graph.nodes.get(bId);
    if (!a || !b) return 0;
    return U.haversine(a.lat, a.lon, b.lat, b.lon);
  };

  DriveEngine.prototype._maybeRoundaboutAtStart = function () {
    // mobil mulai di lingkaran bundaran: siapkan pilihan keluar dari posisi sekarang
    var c = this.car;
    var nodeId = this.graph.ways.get(c.wayId).nodeIds[c.toIdx];
    var fakeRing = { wayId: c.wayId, toNodeId: nodeId };
    var exits = this._computeRoundaboutExits(nodeId, c.wayId, fakeRing);
    if (exits.length) {
      this.stats.roundabouts++;
      this.waiting = true;
      var ringDist = exits.map(function (e) { return e.ringDistM; });
      this.decision = {
        kind: 'roundabout', exits: exits, timerS: 0,
        ringOpt: fakeRing, roadName: this.graph.ways.get(c.wayId).name,
        nodeId: nodeId, ringDist: ringDist,
        recommended: this.guided && this.router ? this.router.recommendExit(exits, ringDist) : -1
      };
      this.emit('decision', this.decision);
    }
  };

  /* ---------------- pilihan pemain ---------------- */
  DriveEngine.prototype.choose = function (index) {
    if (!this.waiting || !this.decision) return false;
    var d = this.decision;
    if (d.kind === 'roundabout') return this.chooseExit(index);
    var o = d.options[index];
    if (!o) return false;
    this.stats.turns[o.cls === 'uturn' ? 'uturn' : o.cls]++;
    this._commitChoice(o.cls, o);
    return true;
  };

  DriveEngine.prototype.chooseExit = function (index) {
    if (!this.waiting || !this.decision || this.decision.kind !== 'roundabout') return false;
    var d = this.decision;
    var exit = d.exits[index];
    if (!exit) return false;
    this.pendingExit = index;
    this.rbExits = d.exits;
    // masuk ring sekarang
    this._takeWay(d.ringOpt.wayId, d.nodeId, d.ringOpt.toNodeId);
    this.waiting = false;
    this.decision = null;
    this.emit('chosen', { kind: 'roundabout', index: index, label: 'Jalur ' + (index + 1) });
    return true;
  };

  DriveEngine.prototype._commitChoice = function (cls, o) {
    this._takeWay(o.wayId, this.decision.nodeId, o.toNodeId);
    this.waiting = false;
    this.decision = null;
    this.emit('chosen', { kind: 'junction', cls: cls });
  };

  DriveEngine.prototype._autoChoose = function () {
    var d = this.decision;
    this.stats.autoPicks++;
    if (d.kind === 'roundabout') {
      // default: keluar paling "lurus" relatif arah masuk; kalau ragu -> pertama
      var inB = this.car.bearing, best = 0, bestDiff = 1e9;
      for (var i = 0; i < d.exits.length; i++) {
        var to = this.graph.nodes.get(d.exits[i].toNodeId);
        var nd = this.graph.nodes.get(d.exits[i].nodeId);
        var b = U.bearing(nd.lat, nd.lon, to.lat, to.lon);
        var diff = Math.abs(U.angleDiff(b, inB));
        if (diff < bestDiff) { bestDiff = diff; best = i; }
      }
      this.emit('auto', { text: 'Waktu habis — keluar jalur ' + (best + 1) });
      this.chooseExit(best);
      return;
    }
    // aturan: lurus kalau ada; kalau tidak (pertigaan/simpang) -> acak
    var opts = d.options;
    var idx = -1;
    for (var j = 0; j < opts.length; j++) {
      if (opts[j].cls === 'straight') { idx = j; break; }
    }
    if (idx === -1) idx = Math.floor(Math.random() * opts.length);
    var o = opts[idx];
    this.stats.turns[o.cls === 'uturn' ? 'uturn' : o.cls]++;
    this.emit('auto', {
      text: 'Waktu habis — sistem: ' + ({ left: 'Belok Kiri', right: 'Belok Kanan', straight: 'Lurus', uturn: 'Putar Balik' }[o.cls])
    });
    this._commitChoice(o.cls, o);
  };

  /* ---------------- titik akhir ---------------- */
  DriveEngine.prototype._checkEnd = function () {
    if (this.finished || !this.end) return;
    var d = U.haversine(this.car.lat, this.car.lon, this.end.lat, this.end.lon);
    if (d > C.END_TRIGGER_RADIUS_M) return;
    // jangan picu bila mobil di layer berbeda (mis. di flyover di atas titik akhir)
    var endWay = this.end.wayId != null ? this.graph.ways.get(this.end.wayId) : null;
    var carWay = this.graph.ways.get(this.car.wayId);
    var sameLayer = !endWay || !carWay || endWay.layer === carWay.layer;
    if (!sameLayer && d > 12) return;
    this.finished = true;
    this.emit('finish', { stats: this.stats, reason: 'destination' });
  };

  /* ---------------- akhir perjalanan manual (dari pause) ---------------- */
  DriveEngine.prototype.finishManual = function () {
    if (this.finished) return;
    this.finished = true;
    this.emit('finish', { stats: this.stats, reason: 'manual' });
  };

  /* ---------------- utilitas uji ---------------- */
  DriveEngine.prototype.fastForward = function (seconds, dtMs) {
    dtMs = dtMs || 100;
    var n = Math.round(seconds * 1000 / dtMs);
    for (var i = 0; i < n && !this.finished; i++) this.step(dtMs);
    return this;
  };

  root.DriveEngine = DriveEngine;
})(typeof window !== 'undefined' ? window : globalThis);
