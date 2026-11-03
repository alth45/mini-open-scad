
# 🐛 Known Issues

> ← Kembali ke [README utama](../README.md)

> Daftar isu yang sudah diketahui beserta **workaround** yang bisa dipakai saat ini.

---

## ⚠️ Issue & Workaround (Aktif)

### 🐌 `minkowski` lambat untuk mesh > 5000 vertex

Operasi Minkowski sangat mahal secara komputasi pada mesh besar.

> ✅ **Workaround:** Turunkan `$fn` atau pakai `offset(r)`

```openscad
// ❌ lambat
minkowski() { complex_mesh(); sphere(2, $fn=64); }

// ✅ lebih cepat
minkowski() { complex_mesh(); sphere(2, $fn=16); }

````

---

### 🧊 `offset(r<0)` (shrink) tidak didukung di 3D

Offset negatif hanya bekerja di 2D, belum diimplementasikan untuk 3D.

> ✅ **Workaround:** Pakai `difference()` dengan objek lebih besar

```openscad
// ❌ tidak didukung
offset(r = -2) cube(20);

// ✅ alternatif
difference() {
  cube(20);
  cube([24, 24, 24], center = true);
}
```

---

### 🧊 State Frozen — mutasi langsung akan error

Sejak **Fase 2**, `state` mengembalikan **frozen snapshot**. Kamu tidak bisa memutasi properti secara langsung (akan melempar `TypeError: Cannot assign to read only property`).

> ✅ **Workaround:** Gunakan _spread operator_ untuk membuat objek baru

```javascript
// ❌ Ini akan error
state.section.enabled = true;

// ✅ Ini benar (memicu dispatch di store)
state.section = { ...state.section, enabled: true };
```

> 📌 Lihat `src/app/viewer-tools.js` untuk contoh lengkap pola ini.

---

### 📱 GIF 60 frame di mobile bisa lag

Encoding GIF berat untuk device mobile, terutama pada frame count tinggi.

> ✅ **Workaround:** Pakai quality **"Small"**

| Setting   | Frame | Ukuran | Mobile-friendly |
| :-------- | :---: | :----: | :-------------: |
| Default   |  60   | Besar  |       ❌        |
| **Small** |  30   | Kecil  |       ✅        |

---

### 📦 STL sangat besar (>50MB) = slow parse

Parsing STL besar memblokir UI dan memakan memori.

> ✅ **Workaround:** Split file, atau **hindari di mobile**

- ✂️ Pecah STL menjadi bagian lebih kecil
- 📵 Jangan load file >50MB di mobile
- 💻 Desktop lebih toleran, tapi tetap lambat

---

## ✅ Resolved Issues

### ✅ RESOLVED: Worker cold start (Fase 3)

~~Worker perlu waktu inisialisasi pada render pertama.~~

**Status: RESOLVED.** Worker sekarang **persistent** — dibuat sekali saat app load, dipakai berulang. Cold start hanya terjadi sekali di awal, tidak lagi per render. Render kedua dan seterusnya menjadi **instan** (hemat ~200-500ms per render).

---

## 📋 Ringkasan

| Issue              | Severity  | Workaround                     |
| :----------------- | :-------: | :----------------------------- |
| `minkowski` lambat | 🟠 Sedang | Turunkan `$fn` / `offset(r)`   |
| `offset(r<0)` 3D   | 🟡 Rendah | `difference()`                 |
| State Frozen       | 🟡 Rendah | Spread operator (`{...state}`) |
| GIF lag di mobile  | 🟠 Sedang | Quality "Small"                |
| STL >50MB          | 🔴 Tinggi | Split file / desktop only      |

---

> 💡 **Catatan:** Isu dengan severity 🔴 sebaiknya dihindari di mobile. Untuk pengalaman terbaik, gunakan **desktop** saat bekerja dengan model kompleks atau file STL besar.

---

> ← Kembali ke [README utama](../README.md)
