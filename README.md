# Simulator Jalan Jalan Virtual

Game berkendara 2D berbasis **peta OpenStreetMap nyata** untuk Android 9+ —
dibungkus **Kotlin + WebView fullscreen**, seluruh antarmuka & logika memakai **HTML/CSS/JS**.

> dibuat oleh **zdn_gg**

## Fitur

- 🗺️ **Peta OSM asli** (data jalan real-time via Overpass API, cadangan OSM API 0.6)
- 🚗 **Pilih titik awal** dengan mengetuk jalan, **titik akhir opsional** (harus di jalan!)
- 🛣️ **Pilihan ganda di persimpangan**: kiri / lurus / kanan / putar balik
- ⏱️ **20 detik** tanpa memilih → sistem pilih **lurus** (di pertigaan: **acak**)
- ⭕ **Bundaran**: pilih jalur keluar ke-1/2/3/... (dinomori dari arah masuk)
- 🌉 **Flyover & underpass aman** — hanya jalan se-layer yang tersambung
- 🚫 **One-way ketat** — mustahil melawan arah (termasuk jalan tol & bundaran)
- 🧭 **Mode Dipandu**: garis rute + rekomendasi arah (Dijkstra); atau mode Bebas total
- 🔍 Zoom, jeda, kecepatan 10–130 km/j, rekap perjalanan lengkap
- 🚙 **Garasi mobil**: 6 sprite 2D orisinal yang selalu menghadap arah jalan
- 📴 **Halaman offline estetik** (mobilnya ban kempis, lucu banget) + auto-reconnect

## Aturan main

1. Tekan **MULAI**, ketuk jalan untuk titik awal (opsional: titik akhir).
2. Mobil jalan otomatis — kamu atur kecepatan & pilih arah di persimpangan.
3. Lewati titik akhir → perjalanan selesai + rekap lengkap.

## Bangun sendiri (build)

```bash
# butuh JDK 17+ dan Android SDK (platform 34, build-tools 34)
./gradlew assembleDebug assembleRelease
# hasil: app/build/outputs/apk/{debug,release}/
```

Keystore rilis disertakan untuk kemudahan build ulang (`app/simjalan.keystore`,
pass `zdngg2026sim`) — untuk rilis publik sebaiknya buat keystore sendiri.

## Teknologi

| Lapisan | Teknologi |
|---|---|
| Pembungkus | Kotlin, WebView (WebViewAssetLoader), immersive fullscreen, landscape |
| Antarmuka | HTML/CSS murni (tanpa framework), responsif landscape |
| Logika game | JavaScript: graf jalan OSM, Dijkstra, mesin keputusan persimpangan |
| Peta | Leaflet + tile OSM/CARTO |
| Data jalan | Overpass API (+ fallback OSM API 0.6) |

## Kredit

- **zdn_gg** — pembuat aplikasi
- **OpenStreetMap** — data peta © kontributor OpenStreetMap (ODbL)
- **CARTO** — tile Voyager & Dark
- **Leaflet** — library peta (BSD-2)
