# 🐛 Troubleshooting & CSG Engine History

> ← Kembali ke [README utama](../README.md)

> Dokumen ini mencatat perjalanan debugging dan perbaikan arsitektur engine CSG (dari `three-bvh-csg` ke `manifold-3d`).

---

## 🛠️ 1. "Sarang Laba-laba" & STL Bocor (Non-Manifold)
**Gejala**: Tampilan wireframe di aplikasi terlihat seperti jaring laba-laba. File STL yang di-export memiliki garis merah (non-manifold) di Slicer dan gagal di-print.
**Penyebab**: `three-bvh-csg` bekerja dengan cara memotong segitiga secara *brute-force* (Triangle Soup). Ia tidak melakukan *re-meshing* untuk menyatukan vertex yang terpotong.
**Solusi**: Migrasi ke **`manifold-3d`**. Manifold adalah engine WebAssembly yang menjamin algoritma *watertight*. 

## 🛠️ 2. Error `Cannot pass "[object Object]" as a Manifold`
**Gejala**: Console browser dipenuhi error ini saat memanggil `union()` atau `difference()`.
**Penyebab**: Kita salah memanggil API statis `wasm.Manifold.union()` yang ternyata menerima parameter *array* atau *instance* yang salah format.
**Solusi**: Gunakan *method chaining* bawaan objek instance Manifold:
```javascript
let result = manifolds[0];
for (let i = 1; i < manifolds.length; i++) {
    result = result.add(manifolds[i]); // BUKAN wasm.Manifold.union(...)
}
```

## 🛠️ 3. Bentuk Render Menjadi "Meja" / Geometri Hilang
**Gejala**: Saat menggunakan `difference()` dengan `hull()` atau `translate()`, objek potongan (inner box) menjadi aneh dan menghilangkan dinding luar (seperti bentuk meja).
**Penyebab**: Saat mengonversi `Object3D` Three.js ke Manifold, kita lupa memanggil `updateMatrixWorld(true)`. Manifold menerima posisi 0,0,0 dari semua objek inner, sehingga memotong dari tengah.
**Solusi**: Paksa update matriks di baris paling awal fungsi `objToManifold`:
```javascript
export function objToManifold(obj) {
  if (!obj) return null;
  obj.updateMatrixWorld(true); // <-- KUNCI PERBAIKAN
  // ...
```

## 🛠️ 4. Warna Hilang Setelah Operasi Boolean (CSG)
**Gejala**: `color("red") difference() { ... }` menghasilkan warna kuning default.
**Penyebab**: Manifold hanya mengembalikan data geometri murni (position & normal), tidak menyimpan informasi material Three.js.
**Solusi**: Ambil material dari *base object* (kids[0]) dan kloning ke hasil mesh akhir:
```javascript
const mesh = makeMesh(manifoldMeshToGeo(result.getMesh()));
if (kids[0] && kids[0].material) {
    mesh.material = kids[0].material.clone();
}
```

## 🛠️ 5. File 3MF Memiliki Garis Merah di Slicer
**Gejala**: STL sudah watertight, tapi saat export 3MF, Slicer menampilkan garis merah (*Non-Manifold*).
**Penyebab**: Format 3MF sangat ketat. Manifold menghasilkan geometri *non-indexed* (Triangle Soup). 3MF membutuhkan topologi *shared vertices*.
**Solusi**: Gunakan `mergeVertices()` dari Three.js sebelum data diproses ke XML 3MF.
```javascript
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
geo = mergeVertices(geo, 1e-4);
```

## 🛠️ 6. Error `Incorrect response MIME type. Expected 'application/wasm'`
**Gejala**: WASM gagal dimuat di Vite.
**Penyebab**: Vite mengembalikan file `index.html` sebagai ganti file WASM karena path dari `node_modules` tidak dapat di-resolve dengan benar.
**Solusi**: Copy file `manifold.wasm` ke folder `public/` di root proyek, lalu tambahkan `locateFile` di inisialisasi Module:
```javascript
wasm = await Module({
  locateFile: (path) => path.endsWith('.wasm') ? '/manifold.wasm' : path
});
```
