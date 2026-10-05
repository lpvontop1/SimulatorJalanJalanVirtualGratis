/* =========================================================
 * Simulator Jalan Jalan Virtual — Konfigurasi Global
 * Kredit: zdn_gg
 * ========================================================= */
(function (root) {
  'use strict';

  var CONFIG = {
    APP_NAME: 'Simulator Jalan Jalan Virtual',
    VERSION: '1.1.0',
    CREDIT: 'zdn_gg',

    /* --- Aturan permainan --- */
    DECISION_TIMEOUT_S: 20,          // detik sebelum sistem memilih otomatis
    AUTO_CHOICE: 'STRAIGHT_FIRST',   // lurus dulu, kalau tidak ada -> acak (aturan pertigaan/simpang)
    END_TRIGGER_RADIUS_M: 30,        // jarak dianggap "melewati" titik akhir
    SNAP_MAX_DIST_M: 90,             // jarak maksimal snap titik ke jalan
    MIN_ZOOM_SELECT: 14,             // zoom minimal untuk menaruh pin
    LAUNCH_BOX_DEG: 0.008,           // setengah-lebar bbox data saat "Mulai" (±0.008° ≈ 1.8 km) — kecil & cepat
    LAUNCH_SNAP_M: 400,              // jarak snap pin mentah ke jalan saat "Mulai" (400 m cukup utk titik di dalam taman besar spt Monas)
    OUT_OF_DATA_HINT_M: 400,         // jarak ke jalan terdekat utk mendeteksi "area belum termuat"
    MAX_GRAPH_WAYS: 16000,           // batas aman data jalan awal (layar pilih lokasi)
    MAX_GRAPH_TOTAL: 90000,          // batas total way saat ekspansi dinamis (90-120 MB, aman utk ponsel 3GB+)

    /* --- Ekspansi dunia (muat data jalan selama berkendara) --- */
    EXPAND_TILE_DEG: 0.03,           // ukuran tile ~3.3 km
    EXPAND_RING: 1,                  // jendela (2*ring+1)^2 tile di sekitar mobil
    EXPAND_CHECK_MS: 2500,           // interval cek kebutuhan ekspansi
    EXPAND_REBUILD_MS: 2500,         // jeda minimum rebuild Dijkstra setelah data baru
    START_SPEED_KMH: 40,
    MIN_SPEED_KMH: 10,
    MAX_SPEED_KMH: 130,
    SPEED_STEP_KMH: 10,

    /* --- Kecepatan referensi untuk pembobotan rute (km/j) --- */
    ROUTE_SPEED: {
      motorway: 90, motorway_link: 60,
      trunk: 80, trunk_link: 50,
      primary: 60, primary_link: 40,
      secondary: 50, secondary_link: 35,
      tertiary: 40, tertiary_link: 30,
      residential: 30, unclassified: 30,
      living_street: 15, service: 20, road: 30
    },

    /* --- Jalan yang boleh dilalui mobil --- */
    DRIVABLE: [
      'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
      'residential', 'unclassified', 'living_street', 'service', 'road',
      'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'
    ],

    /* Jalan mayor (boleh muncul opsi putar balik di tengah ruas persimpangan) */
    MAJOR_ROADS: ['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link'],

    /* --- Jaringan --- */
    OVERPASS_ENDPOINTS: [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ],
    OVERPASS_TIMEOUT_MS: 20000,
    OVERPASS_COOLDOWN_MS: 300000,    // bila semua endpoint Overpass gagal, langsung pakai OSM API selama 5 menit

    /* --- Lokasi populer utk layar koordinat --- */
    COORD_PRESETS: [
      { name: 'Monas, Jakarta', lat: -6.1754024, lon: 106.8271692 },
      { name: 'Bundaran HI', lat: -6.1954480, lon: 106.8228550 },
      { name: 'Semanggi', lat: -6.2195710, lon: 106.8128220 },
      { name: 'Kota Tua Jakarta', lat: -6.1352000, lon: 106.8133000 },
      { name: 'Kebun Raya Bogor', lat: -6.5950380, lon: 106.7992390 },
      { name: 'Alun-Alun Cianjur', lat: -6.8211758, lon: 107.1400036 },
      { name: 'Kantor Bupati Cianjur', lat: -6.8239280, lon: 107.1408130 },
      { name: 'Gedung Sate, Bandung', lat: -6.9025300, lon: 107.6187100 }
    ],

    /* --- Peta --- */
    DEFAULT_ZOOM: 16,
    FOLLOW_ZOOM: 17,
    DEFAULT_CENTER: [-6.219571, 106.812822], // Semanggi, Jakarta (pusat default)
    TILE_STYLES: {
      voyager: {
        name: 'Voyager (Cerah)',
        url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd', maxZoom: 20
      },
      osm: {
        name: 'OSM Klasik',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap contributors',
        subdomains: 'abc', maxZoom: 19
      },
      dark: {
        name: 'Malam (Gelap)',
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd', maxZoom: 20
      }
    },

    /* --- Gaya mobil default (indeks sprites.CARS) --- */
    DEFAULT_CAR: 'sedan-biru'
  };

  CONFIG.HIGHWAY_LABEL = {
    motorway: 'Jalan Tol', motorway_link: 'Ramp Tol',
    trunk: 'Jalan Nasional', trunk_link: 'Ramp Nasional',
    primary: 'Jalan Provinsi', primary_link: 'Ramp Provinsi',
    secondary: 'Jalan Kabupaten', secondary_link: 'Ramp',
    tertiary: 'Jalan Kecamatan', tertiary_link: 'Ramp',
    residential: 'Jalan Lingkungan', unclassified: 'Jalan Umum',
    living_street: 'Jalan Perumahan', service: 'Jalan Layanan', road: 'Jalan'
  };

  root.CONFIG = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
