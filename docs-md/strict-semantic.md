# 🎯 Strict Semantics

> ← Kembali ke [README utama](../README.md) · Lihat juga [architecture.md](./architecture.md#8-fail-loud-at-build-quiet-at-runtime-fase-5-)

---

## 📖 Filosofi

OpenSCAD asli terkenal **lenient**: banyak kesalahan yang hanya menghasilkan _warning_ di console, tapi render tetap jalan dengan hasil yang rusak, aneh, atau bahkan tidak terlihat. User baru sering bingung: _"kok kubus saya bolong?"_ — padahal ada typo yang diabaikan.

**Mini OpenSCAD** mengambil pendekatan berbeda:

> 🎯 **Kalau salah, ya error. Tidak dirender. Titik.**

Prinsip ini disebut **Strict Semantics**. Tujuannya:

1. **Menghindari "silent bug"** — kesalahan yang baru ketahuan saat proses 3D printing atau CNC.
2. **Error actionable** — user langsung tahu _di mana_ dan _apa_ yang salah, bukan sekadar "kok hasilnya beda?".
3. **Kode bersih** — memaksa user menulis kode yang eksplisit dan predictable.
4. **Konsisten dengan filosofi** — _"Fail Loud at Build, Quiet at Runtime"_ (lihat [architecture.md §8](./architecture.md)).

---

## ⚖️ Klasifikasi: Error vs Warning

| Kategori       | Perilaku                                                | Contoh                       |
| :------------- | :------------------------------------------------------ | :--------------------------- |
| ❌ **Error**   | Render **dihentikan**. Pesan muncul di console + toast. | `cube(x)` saat `x` undefined |
| ⚠️ **Warning** | Render **dilanjutkan**. Pesan muncul di console.        | `$fn=512` (performa)         |
| ℹ️ **Info**    | Log info. Tidak ada dampak.                             | "Worker aktif"               |

**Aturan umum:**

- Kesalahan **semantik** (tipe salah, undef, out-of-range) → **ERROR**
- Kesalahan **performa** (kode benar tapi lambat) → **WARNING**
- **Fitur belum didukung** (bukan salah user) → **WARNING**

---

## ❌ Katalog ERROR

### 1. Variabel Undefined Dipakai di Angka

**Penyebab:** Variabel belum dideklarasikan, salah ketik, atau scope salah.

```openscad
// ❌ ERROR
cube(x);  // x belum dideklarasikan

// ❌ ERROR
x = undef;
cylinder(r = x, h = 10);
```

**Pesan:**

```
✖ Line 1: Nilai undef tidak bisa dipakai sebagai angka. Periksa variabel yang belum dideklarasikan atau ekspresi yang gagal.
```

**Solusi:**

```openscad
// ✅ OK — deklarasikan dulu
x = 10;
cube(x);

// ✅ OK — guard dengan is_undef
if (!is_undef(x)) { cube(x); }
```

---

### 2. Type Mismatch

**Penyebab:** Operasi aritmatika dengan tipe yang salah (string di tempat angka).

```openscad
// ❌ ERROR
cube("5");        // string, bukan number

// ❌ ERROR
size = "10";
cube(size + 5);
```

**Pesan:**

```
✖ Line 1: Operasi 'cube()' butuh angka (dapat: string)
```

**Solusi:**

```openscad
// ✅ OK — pakai number
cube(5);

// ✅ OK — konversi string
size = "10";
cube(parseFloat(size));  // (jika parseFloat didukung)
```

---

### 3. Polygon Self-Intersecting

**Penyebab:** Garis polygon saling menyilang (misal bentuk angka "8").

```openscad
// ❌ ERROR
linear_extrude(height = 5)
    polygon(points = [[0,0], [10,10], [10,0], [0,10]]);
```

**Pesan:**

```
✖ Line 2: polygon(): garis saling menyilang tidak valid. Periksa urutan titik — tidak boleh ada segmen yang saling berpotongan.
```

**Solusi:** Susun ulang titik agar membentuk polygon sederhana (tidak self-intersecting). Gunakan `difference()` jika ingin membuat bentuk kompleks.

---

### 4. Named Argument Typo

**Penyebab:** Parameter tidak dikenal di module atau function.

```openscad
// ❌ ERROR
module box(w, h, d) { cube([w, h, d]); }
box(10, 20, dd = 30);  // 'dd' bukan 'd'
```

**Pesan:**

```
✖ Line 2: Parameter 'dd' tidak dikenal. Mungkin maksud: 'd'?
```

**Fitur Levenshtein:** Pesan error menyertakan saran "Mungkin maksud X" berdasarkan jarak edit terdekat.

**Solusi:**

```openscad
// ✅ OK
box(10, 20, d = 30);
```

---

### 5. `children()` Out-of-Range

**Penyebab:** Module memanggil `children(n)` tapi tidak ada child ke-`n`.

```openscad
// ❌ ERROR
module wrap() { children(5); }
wrap() cube(10);  // hanya ada 1 child (index 0)
```

**Pesan:**

```
✖ Line 1: children(5): index di luar jangkauan (tersedia: 0..0)
```

**Solusi:**

```openscad
// ✅ OK
module wrap() { children(0); }
wrap() cube(10);
```

---

### 6. Index Out-of-Range (Array & String)

**Penyebab:** Mengakses index di luar batas array/string.

```openscad
// ❌ ERROR
v = [1, 2, 3];
cube(v[10]);

// ❌ ERROR
s = "Hi";
echo(s[5]);
```

**Pesan:**

```
✖ Line 2: Index [10] di luar batas array (panjang: 3)
```

**Solusi:**

```openscad
// ✅ OK — cek length dulu
v = [1, 2, 3];
if (len(v) > 10) { cube(v[10]); } else { cube(10); }
```

---

### 7. Extrude Tanpa Child 2D

**Penyebab:** `linear_extrude` atau `rotate_extrude` diberi child yang bukan 2D.

```openscad
// ❌ ERROR
linear_extrude(height = 5) cube(10);  // cube adalah 3D

// ❌ ERROR
rotate_extrude() sphere(5);  // sphere adalah 3D
```

**Pesan:**

```
✖ Line 1: linear_extrude(): butuh child 2D (circle, square, polygon, atau text).
```

**Solusi:**

```openscad
// ✅ OK
linear_extrude(height = 5) square(10);
```

---

### 8. Circular Include

**Penyebab:** File A include B, B include A (langsung atau tidak langsung).

**File `a.scad`:**

```openscad
include <b.scad>;
```

**File `b.scad`:**

```openscad
include <a.scad>;  // ❌ circular!
```

**Pesan:**

```
✖ Line 1: Circular include terdeteksi: 'a.scad'. File tidak bisa include dirinya sendiri (langsung atau tidak langsung).
```

**Solusi:** Refactor agar tidak ada dependency melingkar. Pindahkan definisi umum ke file ketiga.

---

### 9. `hull()` / `minkowski()` Gagal

**Penyebab:** Input tidak valid (kosong, terlalu besar, atau geometri tidak kompatibel).

```openscad
// ❌ ERROR
hull() { }  // tidak ada child

// ❌ ERROR (jika ConvexGeometry gagal)
minkowski() { complex_mesh(); sphere(2); }
```

**Pesan:**

```
✖ Line 1: hull(): gagal membuat convex hull (input tidak valid)
```

**Solusi:** Periksa input — minimal butuh 4 titik untuk hull 3D.

---

## ⚠️ Katalog WARNING

### 1. Render Lambat (Performance Hint)

**Penyebab:** Render memakan waktu lama, tapi hasilnya benar.

```openscad
// ⚠️ WARNING (tapi tetap render)
$fn = 512;
for (i = [0 : 1000]) { sphere(5); }
```

**Pesan:**

```
⚠ ⏱ Render lambat: sudah 75% dari batas waktu (15000/20000 ms).
```

**Tindakan:** Opsional — turunkan `$fn`, perkecil loop, atau naikkan `$maxTime`.

---

### 2. Manifold Tidak Tersedia

**Penyebab:** Browser tidak mendukung WebAssembly, atau `manifold.wasm` gagal dimuat.

**Pesan:**

```
⚠ Manifold engine gagal dimuat. Menggunakan three-bvh-csg (hasil STL mungkin kotor).
```

**Tindakan:** Update browser, atau cek file `manifold.wasm` di folder `public/`.

---

### 3. Feature Belum Didukung

**Penyebab:** Parameter atau fitur belum diimplementasikan.

```openscad
// ⚠️ WARNING (diabaikan)
text("Hello", spacing = 1.5);
```

**Pesan:**

```
⚠ text(): parameter `spacing` belum didukung, diabaikan.
```

**Tindakan:** Tidak ada — sistem otomatis mengabaikan parameter.

---

### 4. Auto-Fix

**Penyebab:** Sistem otomatis memperbaiki kesalahan minor.

```openscad
// ⚠️ WARNING (x < 0 di-clamp ke 0)
rotate_extrude()
    translate([-5, 0]) circle(r = 10);
```

**Pesan:**

```
⚠ rotate_extrude(): titik dengan x < 0 di-clamp ke 0.
```

**Tindakan:** Periksa kode — jika `x < 0` tidak disengaja, perbaiki posisi profile.

---

## 🔍 Contoh: Defensive Programming

Karena strict semantics, kamu perlu lebih eksplisit untuk kode yang tahan banting:

```openscad
// ✅ Defensive: cek dulu sebelum dipakai
module safe_cube(size) {
    if (is_num(size) && size > 0) {
        cube(size);
    } else {
        echo("Warning: size tidak valid, pakai default 10");
        cube(10);
    }
}

// ✅ Defensive: cek array sebelum indexing
module safe_rotate_to(v, idx) {
    if (is_list(v) && idx < len(v)) {
        rotate([0, 0, v[idx]]) children();
    }
}

// ✅ Guard dengan is_undef
x = undef;
if (is_undef(x)) {
    echo("x belum diisi, pakai default");
    cube(10);
}
```

---

## 🤔 Kapan Menggunakan Warning vs Error?

Saat mengembangkan fitur atau menambah builtin, tanyakan:

| Pertanyaan                                      | Jawaban     | Keputusan      |
| :---------------------------------------------- | :---------- | :------------- |
| Hasil render **akan rusak** karena ini?         | Ya          | ❌ **Error**   |
| Apakah user **bisa memperbaiki** kode?          | Ya          | ❌ **Error**   |
| Apakah ini **kesalahan user** atau environment? | User        | ❌ **Error**   |
| Apakah ini **kesalahan user** atau environment? | Environment | ⚠️ **Warning** |
| Apakah kode **benar** tapi lambat?              | Ya          | ⚠️ **Warning** |
| Apakah fitur belum ada (bukan salah user)?      | Ya          | ⚠️ **Warning** |

---

## 📊 Perbandingan dengan OpenSCAD Asli

| Kasus                     | OpenSCAD Asli                  | Mini OpenSCAD    |
| :------------------------ | :----------------------------- | :--------------- |
| `cube(undef)`             | ⚠️ Warning, render kubus 1×1×1 | ❌ ERROR         |
| `polygon` self-intersect  | ⚠️ Warning, hasil terlipat     | ❌ ERROR         |
| Named arg typo            | ⚠️ Warning, param diabaikan    | ❌ ERROR + saran |
| `children(99)`            | ⚠️ Warning, skip               | ❌ ERROR         |
| `[1,2,3][10]`             | ⚠️ Warning, return undef       | ❌ ERROR         |
| `linear_extrude() cube()` | ⚠️ Silent fail (0 geometri)    | ❌ ERROR         |
| Circular include          | ⚠️ Warning, skip               | ❌ ERROR         |
| `is_undef(x)`             | ✅ true                        | ✅ true          |
| `if (is_undef(x))`        | ✅ jalan                       | ✅ jalan         |

**Kesimpulan:** Mini OpenSCAD **lebih ketat** dari OpenSCAD, tapi tetap **kompatibel** untuk kode yang benar. Kode yang jalan di Mini OpenSCAD **pasti jalan** di OpenSCAD asli, tapi tidak sebaliknya.

---

## 🎯 Prinsip Desain

1. **User harus tahu persis apa yang salah** — error menyebut baris + hint.
2. **Jangan pernah diam-diam menghasilkan output rusak** — jika ragu, throw.
3. **Fitur yang belum ada = warning, bukan error** — jangan salahkan user.
4. **Auto-fix hanya untuk minor** — clamp negatif, dll.
5. **Pesan error harus actionable** — user bisa langsung perbaiki.

---

> ← Kembali ke [README utama](../README.md) · [architecture.md](./architecture.md) · [known-issues.md](./known-issues.md)

---
