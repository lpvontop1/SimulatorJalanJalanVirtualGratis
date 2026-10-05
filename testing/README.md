# Pengujian: Monas → Kantor Bupati Cianjur

Harness black-box & stress test yang menjalankan **modul game asli** (graph, router,
engine, world expander) di Node.js, menempuh rute nyata **Monas → Kantor Bupati
Cianjur (±111 km via Tol Jagorawi & Puncak)** memakai data jalan OSM sungguhan.

## Hasil terakhir (v1.1.0)

```
Selesai        : YA (sampai tujuan)
Jarak tempuh   : 110.9 km (jarak udara 80.1 km)
Persimpangan   : 2036 dilewati (1 bundaran), panduan A* 2007 keputusan
Flyover/layer  : 64 perubahan layer, selisih layer maks 1 (aturan layer terjaga)
Jalan buntu    : 0 kegagalan (U-turn/mundur/rescue otomatis siaga)
Dunia dinamis  : 284 tile, 68.715 way, 495.803 node dimuat selama berkendara
Waktu nyata    : ~60 detik (di server; di ponsel tergantung jaringan)
```

## Cara menjalankan

```bash
cd testing

# 1) ambil geometri rute dari OSRM (sekali)
curl -sS -o route-geo.json "https://router.project-osrm.org/route/v1/driving/106.8271692,-6.1754024;107.1408130,-6.8239280?overview=full&geometries=geojson" 
# ekstrak field geometry.coordinates ke array murni (python/jq), contoh:
python3 -c "import json;d=json.load(open('route-geo.json'));json.dump(d['routes'][0]['geometry']['coordinates'],open('route-geo.json','w'))"

# 2) pra-ambil tile data jalan sepanjang rute (cache disk, ramah server)
node prefetch-route.js

# 3) jalankan simulasi
node test-cianjur.js
```

Cache tile disimpan di `testing/.osmcache/` — eksekusi ulang tidak menembak
server lagi. Prefetch bersifat sekuensial + jeda antar permintaan agar sopan
terhadap infrastruktur OSM.

## Apa yang diuji

1. Alur "Mulai" di layar pilih lokasi: bbox kecil ±0.008° → snap pin ke jalan (≤400 m).
2. Ekspansi dunia dinamis (koridor mengikuti rute) — tidak menabrak "tepi data".
3. Aturan `oneway`, `layer` flyover/underpass, barrier (gate/bollard), bundaran.
4. Keputusan persimpangan 20 detik, putar balik jalan buntu, reverse-out, rescue.
5. Sampai tujuan → rekap `reason: destination`.
