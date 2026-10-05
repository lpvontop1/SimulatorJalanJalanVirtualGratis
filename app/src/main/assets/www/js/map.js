/* =========================================================
 * GameMap — pembungkus Leaflet: peta, marker mobil, ikuti kamera,
 * zoom aman (tanpa konflik sentuhan), garis rute dipandu.
 * ========================================================= */
(function (root) {
  'use strict';
  var C = root.CONFIG, U = root.Utils;

  function GameMap(containerId, opts) {
    opts = opts || {};
    var style = C.TILE_STYLES[root.Settings ? root.Settings.get().mapStyle : 'voyager'] || C.TILE_STYLES.voyager;
    this.map = L.map(containerId, {
      zoomControl: false,
      attributionControl: true,
      doubleClickZoom: true,
      touchZoom: true,
      dragging: true,
      zoomSnap: 0.5,
      wheelPxPerZoomLevel: 120
    }).setView(opts.center || C.DEFAULT_CENTER, opts.zoom || C.DEFAULT_ZOOM);
    this.tileLayer = L.tileLayer(style.url, {
      attribution: style.attribution + ' | Kredit aplikasi: ' + C.CREDIT,
      subdomains: style.subdomains, maxZoom: style.maxZoom
    }).addTo(this.map);
    this.follow = true;
    this._userGesturing = false;
    this._tileErrors = 0;
    this.tileLayer.on('tileerror', this._onTileError.bind(this));

    var el = this.map.getContainer();
    var self = this;
    el.addEventListener('touchstart', function (e) {
      if (e.touches.length > 1) self._userGesturing = true;
    }, { passive: true });
    el.addEventListener('touchend', function () {
      setTimeout(function () { self._userGesturing = false; }, 350);
    }, { passive: true });
    this.map.on('dragstart', function () { self.follow = false; self._emitFollow(false); });
    this.map.on('drag zoomstart', function () { if (self._onUserMapAction) self._onUserMapAction(); });

    // marker mobil (divIcon + SVG)
    this.carEl = document.createElement('div');
    this.carEl.className = 'car-sprite';
    this.carEl.innerHTML = '<div class="car-rot">' + (opts.carSvg || root.Sprites.CARS[0].svg) + '</div>';
    this.carMarker = L.marker([0, 0], {
      icon: L.divIcon({ className: '', html: this.carEl, iconSize: [40, 64], iconAnchor: [20, 32] }),
      interactive: false, zIndexOffset: 1000, keyboard: false
    }).addTo(this.map);
    this._lastBearing = 0;

    this.startMarker = null;
    this.endMarker = null;
    this.routeLine = null;
  }

  GameMap.prototype._onTileError = function () {
    this._tileErrors++;
    if (this._tileErrors === 6 && this._onTileFail) this._onTileFail();
  };
  GameMap.prototype.resetTileErrors = function () { this._tileErrors = 0; };

  GameMap.prototype._emitFollow = function (v) { if (this._onFollowChange) this._onFollowChange(v); };

  GameMap.prototype.setCar = function (lat, lon, bearing, instant) {
    this.carMarker.setLatLng([lat, lon]);
    var rot = this.carEl.querySelector('.car-rot');
    if (rot) {
      var diff = U.angleDiff(bearing, this._lastBearing);
      this._lastBearing = instant ? bearing : this._lastBearing + diff * 0.35;
      rot.style.transform = 'rotate(' + this._lastBearing.toFixed(1) + 'deg)';
    }
    if (this.follow && !this._userGesturing) {
      this.map.setView([lat, lon], this.map.getZoom(), { animate: false });
    }
  };

  GameMap.prototype.recenter = function (lat, lon) {
    this.follow = true;
    this._emitFollow(true);
    this.map.setView([lat, lon], Math.max(this.map.getZoom(), C.FOLLOW_ZOOM - 1), { animate: true });
  };

  GameMap.prototype.zoomIn = function () { this.map.zoomIn(1); };
  GameMap.prototype.zoomOut = function () { this.map.zoomOut(1); };

  /** Kunci semua gestur peta (saat popup keputusan aktif) */
  GameMap.prototype.lockGestures = function () {
    var m = this.map;
    m.dragging.disable(); m.touchZoom.disable(); m.scrollWheelZoom.disable();
    m.doubleClickZoom.disable(); m.boxZoom.disable(); m.keyboard.disable();
    var c = m.getContainer(); if (c) c.classList.add('map-locked');
  };
  GameMap.prototype.unlockGestures = function () {
    var m = this.map;
    m.dragging.enable(); m.touchZoom.enable(); m.scrollWheelZoom.enable();
    m.doubleClickZoom.enable(); m.boxZoom.enable(); m.keyboard.enable();
    var c = m.getContainer(); if (c) c.classList.remove('map-locked');
  };

  GameMap.prototype.setStartPin = function (lat, lon) {
    if (this.startMarker) this.map.removeLayer(this.startMarker);
    this.startMarker = L.marker([lat, lon], {
      icon: L.divIcon({ className: '', html: pinSvg('#2fbf71', 'A'), iconSize: [34, 44], iconAnchor: [17, 40] }),
      interactive: false, zIndexOffset: 800
    }).addTo(this.map);
  };
  GameMap.prototype.setEndPin = function (lat, lon) {
    if (this.endMarker) this.map.removeLayer(this.endMarker);
    this.endMarker = L.marker([lat, lon], {
      icon: L.divIcon({ className: '', html: pinSvg('#e4572e', 'B'), iconSize: [34, 44], iconAnchor: [17, 40] }),
      interactive: false, zIndexOffset: 800
    }).addTo(this.map);
  };
  GameMap.prototype.clearEndPin = function () {
    if (this.endMarker) { this.map.removeLayer(this.endMarker); this.endMarker = null; }
  };
  GameMap.prototype.clearPins = function () {
    if (this.startMarker) { this.map.removeLayer(this.startMarker); this.startMarker = null; }
    if (this.endMarker) { this.map.removeLayer(this.endMarker); this.endMarker = null; }
  };

  GameMap.prototype.setRoute = function (latlngs) {
    if (this.routeLine) { this.map.removeLayer(this.routeLine); this.routeLine = null; }
    if (latlngs && latlngs.length > 1) {
      this.routeLine = L.polyline(latlngs, {
        color: '#1d6ef2', weight: 6, opacity: 0.75, dashArray: '1 9', lineCap: 'round'
      }).addTo(this.map);
    }
  };
  GameMap.prototype.clearRoute = function () { this.setRoute(null); };

  GameMap.prototype.destroy = function () {
    this.map.remove();
  };

  function pinSvg(color, label) {
    return '<svg viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M17 43 C17 43 4 26 4 15 A13 13 0 1 1 30 15 C30 26 17 43 17 43 Z" fill="' + color + '" stroke="white" stroke-width="2.5"/>' +
      '<text x="17" y="20" text-anchor="middle" font-size="14" font-weight="bold" fill="white" font-family="Arial">' + label + '</text></svg>';
  }

  root.GameMap = GameMap;
})(typeof window !== 'undefined' ? window : globalThis);
