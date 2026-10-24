# 🐛 Known Issues

> ← Kembali ke [README utama](../README.md)

> Daftar isu yang sudah diketahui beserta **workaround** yang bisa dipakai saat ini.

---

## ⚠️ Issue & Workaround

### 🐌 `minkowski` lambat untuk mesh > 5000 vertex

Operasi Minkowski sangat mahal secara komputasi pada mesh besar.

> ✅ **Workaround:** Turunkan `$fn` atau pakai `offset(r)`

```openscad
// ❌ lambat
minkowski() { complex_mesh(); sphere(2, $fn=64); }

// ✅ lebih cepat
minkowski() { complex_mesh(); sphere(2, $fn=16); }
```

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

### ⏱️ Model kompleks + worker cold start = delay ~200ms

Worker perlu waktu inisialisasi pada render pertama.

> ✅ **Status:** **Normal** — delay hilang setelah warmup render pertama. Tidak perlu tindakan.

---

### 📱 GIF 60 frame di mobile bisa lag

Encoding GIF berat untuk device mobile, terutama pada frame count tinggi.

> ✅ **Workaround:** Pakai quality **"Small"**

| Setting | Frame | Ukuran | Mobile-friendly |
|:---|:---:|:---:|:---:|
| Default | 60 | Besar | ❌ |
| **Small** | 30 | Kecil | ✅ |

---

### 📦 STL sangat besar (>50MB) = slow parse

Parsing STL besar memblokir UI dan memakan memori.

> ✅ **Workaround:** Split file, atau **hindari di mobile**

- ✂️ Pecah STL menjadi bagian lebih kecil
- 📵 Jangan load file >50MB di mobile
- 💻 Desktop lebih toleran, tapi tetap lambat

---

## 📋 Ringkasan

| Issue | Severity | Workaround |
|:---|:---:|:---|
| `minkowski` lambat | 🟠 Sedang | Turunkan `$fn` / `offset(r)` |
| `offset(r<0)` 3D | 🟡 Rendah | `difference()` |
| Worker cold start | 🟢 Normal | Tunggu warmup |
| GIF lag di mobile | 🟠 Sedang | Quality "Small" |
| STL >50MB | 🔴 Tinggi | Split file / desktop only |

---

> 💡 **Catatan:** Isu dengan severity 🔴 sebaiknya dihindari di mobile. Untuk pengalaman terbaik, gunakan **desktop** saat bekerja dengan model kompleks atau file STL besar.

---

> ← Kembali ke [README utama](../README.md)
