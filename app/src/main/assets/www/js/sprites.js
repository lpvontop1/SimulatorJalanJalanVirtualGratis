/* =========================================================
 * Sprites — mobil 2D tampak atas (SVG inline, bebas lisensi)
 * Digambar menghadap UTARA (atas). Rotasi via CSS transform.
 * ========================================================= */
(function (root) {
  'use strict';

  function carSvg(o) {
    o = o || {};
    var body = o.body || '#e63946';
    var dark = o.dark || 'rgba(0,0,0,.25)';
    var roof = o.roof || 'rgba(255,255,255,.28)';
    var glass = o.glass || '#9adbe8';
    var extra = o.extra || '';
    var stripe = o.stripe
      ? '<rect x="17" y="4" width="6" height="56" rx="3" fill="' + o.stripe + '" opacity=".85"/>'
      : '';
    return '<svg viewBox="0 0 40 64" xmlns="http://www.w3.org/2000/svg">' +
      // bayangan
      '<ellipse cx="20" cy="34" rx="17" ry="29" fill="rgba(0,0,0,.28)"/>' +
      // roda
      '<rect x="1.5" y="10" width="6" height="11" rx="2.5" fill="#1b1b1b"/>' +
      '<rect x="32.5" y="10" width="6" height="11" rx="2.5" fill="#1b1b1b"/>' +
      '<rect x="1.5" y="42" width="6" height="11" rx="2.5" fill="#1b1b1b"/>' +
      '<rect x="32.5" y="42" width="6" height="11" rx="2.5" fill="#1b1b1b"/>' +
      // bodi
      '<path d="M6 14 Q6 5 20 5 Q34 5 34 14 L34 50 Q34 59 20 59 Q6 59 6 50 Z" fill="' + body + '" stroke="' + dark + '" stroke-width="1.4"/>' +
      stripe +
      // kap depan highlight
      '<path d="M9 13 Q9 8 20 8 Q31 8 31 13 L31 18 L9 18 Z" fill="rgba(255,255,255,.14)"/>' +
      // kaca depan
      '<path d="M9 20 L31 20 L29 27 L11 27 Z" fill="' + glass + '"/>' +
      // atap
      '<rect x="10.5" y="27" width="19" height="15" rx="4" fill="' + roof + '"/>' +
      // kaca belakang
      '<path d="M11 42 L29 42 L31 48 L9 48 Z" fill="' + glass + '" opacity=".85"/>' +
      // lampu depan & belakang
      '<rect x="8" y="6" width="7" height="3" rx="1.5" fill="#fff7ae"/>' +
      '<rect x="25" y="6" width="7" height="3" rx="1.5" fill="#fff7ae"/>' +
      '<rect x="8" y="55.5" width="7" height="3" rx="1.5" fill="#ff5a5a"/>' +
      '<rect x="25" y="55.5" width="7" height="3" rx="1.5" fill="#ff5a5a"/>' +
      // spion
      '<rect x="2.5" y="21" width="3" height="5" rx="1.5" fill="' + dark + '"/>' +
      '<rect x="34.5" y="21" width="3" height="5" rx="1.5" fill="' + dark + '"/>' +
      extra +
      '</svg>';
  }

  var taxiSign = '<rect x="14" y="9.5" width="12" height="5" rx="1.5" fill="#222"/>' +
    '<text x="20" y="14.4" font-size="4.6" text-anchor="middle" fill="#ffd23f" font-family="Arial" font-weight="bold">TAXI</text>';

  var policeStripe = '<rect x="6.5" y="30" width="27" height="6" fill="#1d3557" opacity=".9"/>' +
    '<rect x="14" y="10" width="5" height="4.5" rx="1" fill="#ff4d4d"/>' +
    '<rect x="21" y="10" width="5" height="4.5" rx="1" fill="#4d79ff"/>' +
    '<text x="20" y="36.5" font-size="4.4" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="bold">POLISI</text>';

  var CARS = [
    { id: 'sedan-biru', name: 'Sedan Biru', svg: carSvg({ body: '#3567d6', roof: 'rgba(255,255,255,.25)' }) },
    { id: 'sport-merah', name: 'Sport Merah', svg: carSvg({ body: '#e63946', stripe: '#ffd23f' }) },
    { id: 'taksi-kuning', name: 'Taksi Kuning', svg: carSvg({ body: '#ffb703', extra: taxiSign, stripe: '#22222255' }) },
    { id: 'jip-hijau', name: 'Jip Hijau', svg: carSvg({ body: '#4a7c59', roof: 'rgba(0,0,0,.18)' }) },
    { id: 'polisi', name: 'Mobil Polisi', svg: carSvg({ body: '#f1faee', extra: policeStripe }) },
    { id: 'klasik-ungu', name: 'Klasik Ungu', svg: carSvg({ body: '#7b2cbf', stripe: '#e0aaff' }) }
  ];

  function byId(id) {
    for (var i = 0; i < CARS.length; i++) if (CARS[i].id === id) return CARS[i];
    return CARS[0];
  }

  root.Sprites = { CARS: CARS, byId: byId };
})(typeof window !== 'undefined' ? window : globalThis);
