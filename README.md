# 🚗 Simulator Jalan Jalan Virtual

> Game berkendara 2D di atas peta **OpenStreetMap** sungguhan — jelajahi jalan-jalan Indonesia, belok sesuka hatimu, patuhi aturan jalan, dan sampailah ke tujuan!
>
> **dibuat oleh [zdn_gg](https://github.com/lpvontop1)** • v1.1.0 • Android 9+

![platform](https://img.shields.io/badge/Android-9%2B%20(API%2028)-3ddc84) ![engine](https://img.shields.io/badge/Engine-Kotlin%20%2B%20WebView-1d6ef2) ![map](https://img.shields.io/badge/Peta-OpenStreetMap-7ebc6f) ![license-data](https://img.shields.io/badge/Data-ODbL%20%C2%A9%20OSM%20Contributors-ffb703)

---

## ✨ Fitur

### 🗺️ Berkendara di Peta Nyata
- **Peta OpenStreetMap interaktif** (tile CARTO Voyager / OSM Klasik / Dark) dengan data jalan **real-time** via Overpass API + fallback OSM API 0.6.
- **Dunia yang mengembang dinamis** — saat mobil melaju mendekati tepi data, tile jalan baru dimuat otomatis, termasuk **prefetch koridor menuju tujuan**. Perjalanan Jakarta → Cianjur (±100 km) tidak pernah menabrak "tepi dunia".
- **Titik awal fleksibel**: pilih langsung di peta (ketuk untuk menaruh pin) **atau** tulis koordinat lat/lon — tersedia preset lokasi populer (Monas, Bundaran HI, Kantor Bupati Cianjur, dll). Menggeser peta **tidak memicu loading**; data baru diambil saat kamu menekan *Mulai*.

### 🚦 Aturan Jalan yang Dihormati
| Aturan | Implementasi |
|---|---|
| **Persimpangan** | Popup pilihan Kiri / Lurus / Kanan dengan hitung mundur **20 detik** |
| **Timeout** | Tidak memilih → otomatis **lurus**; di pertigaan/simpang → **acak** (bukan jebakan buntu) |
| **Bundaran** | Jalur keluar **dinomori dari arah masuk**, arah sirkulasi otomatis one-way |
| **Flyover / Underpass** | Koneksi jalan menghormati tag `layer`/`bridge`/`tunnel` — tidak ada popup aneh di perempatan bertingkat (Semanggi, layang tol) |
| **Jalan satu arah** | Mustahil melawan `oneway` (termasuk implied oneway motorway & bundaran) |
| **Jalan buntu** | Putar balik **otomatis** di ujung jalan |
| **Barrier** | Bollard / lift gate / gerbang terkunci benar-benar memutus jalan |

### 🎮 Gameplay
- **Mode Dipandu**: garis rute + rekomendasi arah di tiap persimpangan (Dijkstra pada state `(node, way)` — konsisten dengan aturan layer & oneway) — atau **Mode Bebas** untuk jelajah tanpa arah.
- **Akselerasi & rem**: 10–130 km/j, kecepatan per kelas jalan dipakai pembobot rute.
- **6 mobil 2D** digambar khusus (sedan, sport, taksi, jip, polisi, klasik) dengan rotasi halus mengikuti tikungan.
- **Multi-touch aman**: pinch-zoom peta tidak konflik dengan tombol; popup keputusan mengunci gestur peta.
- **Rekap perjalanan**: jarak, waktu, kecepatan rata-rata/tertinggi, jumlah persimpangan, bundaran, belokan, putar balik, dan pilihan otomatis.
- **Halaman offline** yang lucu saat sinyal hilang (dengan auto-reconnect).

---

## 📥 Unduh & Pasang

Ambil APK dari [**GitHub Releases**](https://github.com/lpvontop1/SimulatorJalanJalanVirtual/releases):

| Berkas | Untuk |
|---|---|
| `app-debug.apk` | Uji coba cepat (debuggable) |
| `app-release.apk` | Pemakaian harian (signed, direkomendasikan) |

1. Unduh APK, buka di ponsel.
2. Izinkan "Pasang aplikasi tidak dikenal" bila diminta.
3. Buka **Simulator Jalan Jalan Virtual** — putar layar otomatis landscape. Butuh **internet** saat memuat data jalan.

---

## 🔨 Build dari Sumber

**Kebutuhan**: JDK 17+, Android SDK (platform 34, build-tools 34.0.0).

```bash
git clone https://github.com/lpvontop1/SimulatorJalanJalanVirtual.git
cd SimulatorJalanJalanVirtual
echo "sdk.dir=/jalur/ke/Android/Sdk" > local.properties
./gradlew assembleDebug assembleRelease
# hasil: app/build/outputs/apk/{debug,release}/
```

> Keystore release (`app/simjalan.keystore`) ikut di-repo untuk kemudahan build ulang — praktis untuk proyek hobi ini.

### Struktur Proyek

```
app/src/main/
├── java/gg/zdn/simulatorjalanjalan/MainActivity.kt   # Kotlin: WebView fullscreen immersive,
│                                                      # WebViewAssetLoader (origin https aman),
│                                                      # jembatan JS<->Android, pantau koneksi
└── assets/www/                                       # seluruh UI & logika game (HTML/CSS/JS)
    ├── index.html                                    # 9 layar: splash, menu, pickmode, koordinat,
    │                                                 # pilih lokasi, game, garasi, setting, kredit, offline
    └── js/
        ├── config.js     # konstanta & preset lokasi
        ├── graph.js      # RoadGraph: oneway, layer flyover/underpass, barrier, snap
        ├── router.js     # Dijkstra terbalik (node, way) utk rute & rekomendasi
        ├── engine.js     # DriveEngine: gerak, persimpangan, bundaran, jalan buntu
        ├── world.js      # Net (Overpass+OSM API, cooldown) + WorldExpander dinamis
        ├── select.js     # alur pilih titik awal (pin mentah -> fetch kecil -> snap)
        ├── game.js       # HUD, popup, rekap, loop utama
        └── ...           # map.js (Leaflet), ui.js, sprites.js, utils.js, testtown.js
```

---

## 🧪 Pengujian

- **Stress test antar kota dengan modul game asli** (lihat [`testing/`](testing/)):
  - **Monas → Kebun Raya Bogor (69,6 km)** — lulus.
  - **Monas → Kantor Bupati Cianjur (110,9 km via Tol Jagorawi & Puncak)** — **lulus sampai tujuan**: 2.036 persimpangan dilewati, 64 perubahan layer flyover tanpa pelanggaran, ekspansi dunia memuat 68 ribu way / 495 ribu node selama berkendara, 0 kegagalan jalan buntu.
- Fixture sintetis `testtown.js` (termasuk Semanggi mini) dipakai untuk uji regresi cepat via `?test=1`.

---

## 🙏 Kredit

- **zdn_gg** — pembuat & pemilik aplikasi
- [OpenStreetMap](https://www.openstreetmap.org/copyright) — data peta & tile (© kontributor OSM, ODbL)
- [CARTO](https://carto.com/attributions) — tile style Voyager & Dark Matter
- [Leaflet](https://leafletjs.com/) — library peta interaktif (BSD-2)
- Overpass API & OSM API 0.6 — sumber data jalan real-time

---

## 📄 Lisensi

Kode aplikasi: milik **zdn_gg**. Data peta: © kontributor OpenStreetMap (ODbL) — atribut wajib ditampilkan di dalam aplikasi.

> ⚠️ *Ini game simulasi. Jangan gunakan sebagai alat navigasi sungguhan — dan ingat, di dunia nyata, keselamatan berkendara nomor satu!*
