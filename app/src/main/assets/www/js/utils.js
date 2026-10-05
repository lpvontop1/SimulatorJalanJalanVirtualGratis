/* =========================================================
 * Utilitas Geo — haversine, bearing, proyeksi titik ke ruas
 * ========================================================= */
(function (root) {
  'use strict';

  var R_EARTH = 6371008.8; // meter rata-rata
  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;

  function haversine(lat1, lon1, lat2, lon2) {
    var dLat = (lat2 - lat1) * D2R;
    var dLon = (lon2 - lon1) * D2R;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Arah 0..360 derajat, 0 = utara, searah jarum jam positif */
  function bearing(lat1, lon1, lat2, lon2) {
    var dLon = (lon2 - lon1) * D2R;
    var y = Math.sin(dLon) * Math.cos(lat2 * D2R);
    var x = Math.cos(lat1 * D2R) * Math.sin(lat2 * D2R) -
      Math.sin(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.cos(dLon);
    return (Math.atan2(y, x) * R2D + 360) % 360;
  }

  /** Selisih sudut terpendek a-b dalam -180..180 (positif = searah jarum jam / ke kanan) */
  function angleDiff(a, b) {
    var d = (a - b + 540) % 360 - 180;
    return d;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  /** Interpolasi sudut terpendek */
  function lerpAngle(a, b, t) {
    return a + angleDiff(b, a) * t;
  }

  /**
   * Proyeksikan titik P ke segmen A-B (equirectangular lokal, akurat utk <10km).
   * return {t, lat, lon, distM}
   */
  function projectToSegment(pLat, pLon, aLat, aLon, bLat, bLon) {
    var latRef = pLat;
    var ax = (aLon - pLon) * Math.cos(latRef * D2R), ay = (aLat - pLat);
    var bx = (bLon - pLon) * Math.cos(latRef * D2R), by = (bLat - pLat);
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    var lat = lerp(aLat, bLat, t), lon = lerp(aLon, bLon, t);
    return { t: t, lat: lat, lon: lon, distM: haversine(pLat, pLon, lat, lon) };
  }

  function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

  function fmtDist(m) {
    if (m >= 1000) return (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km';
    return Math.round(m) + ' m';
  }

  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    if (h > 0) return h + ' jam ' + m + ' mnt';
    if (m > 0) return m + ' mnt ' + ss + ' dtk';
    return ss + ' detik';
  }

  /** ID unik sederhana */
  var _uid = 0;
  function uid() { return 'u' + (++_uid) + '_' + Date.now().toString(36); }

  var Utils = {
    haversine: haversine,
    bearing: bearing,
    angleDiff: angleDiff,
    lerp: lerp,
    lerpAngle: lerpAngle,
    projectToSegment: projectToSegment,
    clamp: clamp,
    fmtDist: fmtDist,
    fmtTime: fmtTime,
    uid: uid
  };

  root.Utils = Utils;
})(typeof window !== 'undefined' ? window : globalThis);
