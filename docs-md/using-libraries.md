# 📚 Menggunakan Libraries

> ← Kembali ke [README utama](../README.md)

> Panduan lengkap: cara pakai library `.scad` di Mini OpenSCAD, baik bawaan (bundled) maupun custom.

---

## 🎯 Kenapa Libraries?

Daripada menulis 50 baris kode untuk gear, cukup:

```openscad
use <gears.scad>;

gear(number_of_teeth = 20, circular_pitch = 5, gear_thickness = 6);
```

**Manfaat:**

- ✅ Hemat waktu — fungsi siap pakai
- ✅ Konsisten — parameter standar (module/pitch)
- ✅ Bisa di-custom — library hanya building block, tetap fleksibel
- ✅ Reusable — pakai di banyak project

---

## 🔍 `use` vs `include`

Ada **dua cara** memuat library. Pilih sesuai kebutuhan:

| Aspek                     | `use <file>`                | `include <file>`                    |
| :------------------------ | :-------------------------- | :---------------------------------- |
| **Yang di-import**        | Hanya `module` & `function` | **Semua** (termasuk top-level code) |
| **Top-level variable**    | ❌ Tidak ikut               | ✅ Ikut                             |
| **Geometry di top-level** | ❌ Tidak dirender           | ✅ Dirender                         |
| **Kecepatan parse**       | ⚡ Cepat                    | 🐢 Lebih lambat                     |
| **Risiko konflik**        | Rendah                      | Lebih tinggi                        |
| **Rekomendasi**           | ✅ Default                  | Hanya kalau butuh konstanta         |

### Contoh Perbedaan

**File `lib.scad`:**

```openscad
// Top-level variable
DEFAULT_SIZE = 10;

// Top-level geometry (jarang, tapi mungkin)
echo("Library loaded");

// Module
module make_box() {
    cube(DEFAULT_SIZE);
}
```

**Dengan `use <lib.scad>`:**

```openscad
use <lib.scad>;

// ✅ make_box() tersedia
make_box();

// ❌ ERROR: DEFAULT_SIZE tidak dikenal
// cube(DEFAULT_SIZE);
```

**Dengan `include <lib.scad>`:**

```openscad
include <lib.scad>;

// ✅ make_box() tersedia
make_box();

// ✅ DEFAULT_SIZE tersedia
cube(DEFAULT_SIZE);  // ← 10

// ⚠️ echo() juga dijalankan
```

### Aturan Praktis

| Situasi                                      | Pakai              |
| :------------------------------------------- | :----------------- |
| Library berisi **module/function saja**      | `use`              |
| Library berisi **konstanta** yang kamu butuh | `include`          |
| Library pihak ketiga (tidak kamu kontrol)    | `use` (lebih aman) |
| Debugging library (butuh lihat output)       | `include`          |

**Di Files Manager:**

- **Klik ⌨** → `use` (default, recommended)
- **Alt + Klik ⌨** → `include` (kalau butuh top-level code)

---

## 📦 Bundled Libraries (8 Total)

Mini OpenSCAD menyertakan **8 library siap pakai**. Semua ber-badge **📚 LIB** di Files Manager.

### 1. 🧩 `gears.scad` — Gear & Transmission

**Modul:**

| Module            | Deskripsi            |
| :---------------- | :------------------- |
| `gear()`          | Gear involute profil |
| `rack()`          | Rack & pinion helper |
| `timing_pulley()` | Timing pulley (belt) |

**Contoh — Gear 20 gigi:**

```openscad
use <gears.scad>;

$fn = 64;

gear(
    number_of_teeth = 20,
    circular_pitch = 5,
    gear_thickness = 6,
    rim_thickness = 8,
    hub_thickness = 10,
    hub_diameter = 12,
    bore_diameter = 6
);
```

**Contoh — Gear Tower (3 tingkat):**

```openscad
use <gears.scad>;

$fn = 48;

for (i = [0 : 2]) {
    translate([0, 0, i * 8])
        gear(
            number_of_teeth = 15 + i * 5,
            circular_pitch = 4,
            gear_thickness = 5,
            bore_diameter = 4
        );
}
```

---

### 2. 🔵 `rounded_shapes.scad` — Rounded & Chamfered

**Modul:**

| Module               | Deskripsi                        |
| :------------------- | :------------------------------- |
| `rounded_cube()`     | Cube dengan sudut bulat          |
| `chamfered_cube()`   | Cube dengan chamfer 12-edges     |
| `rounded_cylinder()` | Cylinder dengan bulat atas/bawah |

**Contoh:**

```openscad
use <rounded_shapes.scad>;

$fn = 32;

// Cube rounded semua sudut
rounded_cube([40, 30, 20], radius = 4, center = true);

// Chamfer untuk estetik
translate([60, 0, 0])
    chamfered_cube([30, 30, 30], chamfer = 2, center = true);

// Cylinder dengan rounded bottom (untuk handle, dll)
translate([0, 50, 0])
    rounded_cylinder(20, 8, round_bottom = true, round_top = false);
```

---

### 3. 🔩 `threads.scad` — Screw & Bolt

**Modul:**

| Module            | Deskripsi                            |
| :---------------- | :----------------------------------- |
| `metric_bolt()`   | Bolt dengan thread (hex/socket head) |
| `threaded_hole()` | Hole untuk tap                       |

**Contoh:**

```openscad
use <threads.scad>;

// M6 bolt, 20mm panjang
metric_bolt(
    length = 20,
    diameter = 6,
    pitch = 1,
    head_diameter = 10,
    head_height = 4,
    head_type = "hex"
);
```

---

### 4. 📦 `enclosure.scad` — Electronics Enclosure

**Modul:**

| Module           | Deskripsi          |
| :--------------- | :----------------- |
| `pcb_standoff()` | Standoff untuk PCB |
| `vent_slots()`   | Ventilasi          |
| `box_with_lid()` | Box + lid (2 part) |

**Contoh:**

```openscad
use <enclosure.scad>;

// Casing dengan 4 standoff PCB
difference() {
    cube([80, 60, 30], center = true);
    translate([0, 0, 2]) cube([76, 56, 30], center = true);
}

for (x = [-30, 30]) {
    for (y = [-20, 20]) {
        translate([x, y, -13])
            pcb_standoff(5, 6, 3);
    }
}
```

---

### 5. 🍯 `patterns.scad` — Honeycomb, Grid, Lattice

**Modul:**

| Module            | Deskripsi                  |
| :---------------- | :------------------------- |
| `honeycomb_2d()`  | Honeycomb panel (2D)       |
| `grid_2d()`       | Grid pattern               |
| `perforated_2d()` | Sheet dengan lubang merata |
| `lattice_3d()`    | Kisi-kisi 3D               |

**Contoh — Panel Ventilasi:**

```openscad
use <patterns.scad>;

$fn = 32;

difference() {
    cube([100, 80, 3], center = true);
    translate([0, 0, -2])
        linear_extrude(height = 4)
            honeycomb_2d([100, 80], 10, 1.5);
}
```

**Contoh — Perforated Plate:**

```openscad
use <patterns.scad>;

linear_extrude(height = 2)
    perforated_2d([80, 60], 4, 8);
```

---

### 6. 🔗 `joints.scad` — Mechanical Joints

**Modul:**

| Module                                  | Deskripsi                |
| :-------------------------------------- | :----------------------- |
| `snap_fit_clip()`                       | Snap fit clip            |
| `dovetail_male()` / `dovetail_female()` | Dovetail slider          |
| `ball_socket()`                         | Ball joint (robotic arm) |
| `living_hinge()`                        | Living hinge (lipat)     |

**Contoh — Snap Fit:**

```openscad
use <joints.scad>;

// Clip 15mm panjang, 4mm tebal
snap_fit_clip(15, 4, 10, 3, 2);
```

**Contoh — Ball Joint:**

```openscad
use <joints.scad>;

$fn = 32;

// Socket untuk bola 8mm
ball_socket(ball_d = 8, socket_wall = 1.5, gap_angle = 120);
```

---

### 7. ⚡ `electronics.scad` — PCB, Cable, Battery

**Modul:**

| Module             | Deskripsi            |
| :----------------- | :------------------- |
| `pcb_standoff()`   | Single PCB standoff  |
| `pcb_mount_4x()`   | 4 standoff untuk PCB |
| `cable_clip()`     | Cable clip (C-shape) |
| `battery_holder()` | AA/AAA/18650 holder  |
| `raspi_mount()`    | Raspi 3/4 mount      |

**Contoh — Raspi Mount:**

```openscad
use <electronics.scad>;

raspi_mount("4");  // 4 standoff M2.5
```

**Contoh — Cable Clip:**

```openscad
use <electronics.scad>;

// Clip untuk kabel 5mm diameter
cable_clip(cable_d = 5, wall = 1.5, length = 8);
```

**Contoh — Battery Holder:**

```openscad
use <electronics.scad>;

// 2× AA battery
battery_holder("AA", 2);
```

---

### 8. 🔤 `text_tools.scad` — Text & Labels

**Modul:**

| Module            | Deskripsi               |
| :---------------- | :---------------------- |
| `text_centered()` | Text centered + extrude |
| `emboss_text()`   | Text emboss             |
| `text_circular()` | Text melingkar          |
| `label_box()`     | Label + background box  |
| `number_label()`  | Angka besar             |

**Contoh — Nameplate:**

```openscad
use <text_tools.scad>;

linear_extrude(height = 2)
    text_centered("MINI OPENS CAD", size = 12, bold = true);
```

**Contoh — Circular Text:**

```openscad
use <text_tools.scad>;

text_circular(
    txt = "ROUND LABEL · 2025",
    radius = 40,
    text_size = 5
);
```

**Contoh — Label Box:**

```openscad
use <text_tools.scad>;

label_box(
    txt = "BUTTON",
    box_size = [40, 12, 2],
    text_size = 7,
    border = 1.5
);
```

---

## 🎨 Library Custom — Buat Sendiri

### Cara Upload

1. Buat file `.scad` di komputer (misal `my_lib.scad`).
2. Buka **Files Manager** (📁).
3. Klik **"Choose STL File"** (tombol ini juga menerima `.scad`).
4. Drag & drop `.scad` ke viewport juga bisa.
5. File muncul di list dengan badge **SCAD** (bukan LIB).

### Contoh Custom Library

**File `my_tools.scad`:**

```openscad
// my_tools.scad — Custom tools untuk project saya

// Konstanta (butuh include untuk akses)
DEFAULT_THICKNESS = 3;
DEFAULT_HOLE_D = 4;

// Simple bracket
module bracket(width = 30, height = 20, thickness = DEFAULT_THICKNESS) {
    difference() {
        cube([width, height, thickness]);
        translate([width / 2, height / 2, -1])
            cylinder(h = thickness + 2, d = DEFAULT_HOLE_D, $fn = 24);
    }
}

// Corner bracket (L-shape)
module corner_bracket(size = 20, thickness = DEFAULT_THICKNESS) {
    union() {
        cube([size, thickness, size]);
        cube([thickness, size, size]);
    }
}
```

**Cara pakai di project:**

```openscad
use <my_tools.scad>;

bracket(40, 25, 3);
translate([60, 0, 0]) corner_bracket(30, 3);
```

**Kalau butuh konstanta:**

```openscad
include <my_tools.scad>;

// Sekarang DEFAULT_THICKNESS bisa dipakai
bracket(40, 25, DEFAULT_THICKNESS * 2);
```

---

## 🚨 Troubleshooting

### ❌ Error: "file tidak ditemukan"

**Penyebab:** Nama file salah, atau belum di-upload.

**Solusi:**

1. Buka Files Manager → pastikan file ada.
2. Cek nama persis (case-sensitive — `Gears.scad` ≠ `gears.scad`).
3. Kalau bundled lib hilang, refresh browser (auto-restore).

---

### ❌ Error: "Function tidak dikenal: gear"

**Penyebab:** Lupa `use <gears.scad>;` atau pakai `include` tapi library belum di-load.

**Solusi:**

```openscad
// ✅ Benar
use <gears.scad>;
gear(number_of_teeth = 20);

// ❌ Salah — lupa use
gear(number_of_teeth = 20);  // ← error
```

---

### ❌ Error: "Circular include terdeteksi"

**Penyebab:** File A include B, B include A (langsung atau tidak langsung).

**Solusi:** Refactor — pindahkan definisi umum ke file C, dan A + B `use <c.scad>`.

---

### ⚠️ Warning: "Manifold tidak tersedia"

**Penyebab:** Browser tidak mendukung WASM atau `manifold.wasm` gagal dimuat.

**Solusi:** Update browser modern (Chrome 90+, Firefox 88+, Safari 15+).

---

### ⚠️ Render Lambat

**Penyebab:** Library punya banyak top-level code, atau `$fn` terlalu tinggi.

**Solusi:**

- Pakai `use` (bukan `include`) — hanya module, tidak execute top-level.
- Turunkan `$fn` (default 32 cukup untuk sebagian besar).

---

## 💡 Best Practices

### 1. Selalu `use`, bukan `include`

Kecuali kamu benar-benar butuh konstanta.

```openscad
use <gears.scad>;        // ✅ 90% kasus
include <gears.scad>;    // ⚠️ Hanya jika butuh DEFAULT_*
```

---

### 2. Gabungkan banyak `use` di atas file

```openscad
use <gears.scad>;
use <rounded_shapes.scad>;
use <electronics.scad>;

// ... kode project ...
```

Bukan di tengah-tengah code:

```openscad
cube(10);
use <gears.scad>;  // ❌ Bisa jalan, tapi confusing
```

---

### 3. Bikin custom library untuk pattern yang berulang

Kalau kamu sering tulis module yang sama, ekstrak ke `my_lib.scad` dan `use` di project baru.

**Sebelum (100 baris per project):**

```openscad
module my_bracket(...) { ... }  // copy-paste setiap project
module my_pipe_joint(...) { ... }
```

**Sesudah (5 baris per project):**

```openscad
use <my_lib.scad>;
my_bracket(...);
my_pipe_joint(...);
```

---

### 4. Pin versi library custom

Kalau library berubah, simpan versi backup:

```
my_tools_v1.scad     ← versi lama (masih dipakai project A)
my_tools_v2.scad     ← versi baru (dipakai project B)
```

Karena `use <my_tools_v1.scad>` di project A tidak akan terpengaruh perubahan v2.

---

## 📊 Ringkasan Semua Module

| Library               | Total Module  | Use Case Utama           |
| :-------------------- | :-----------: | :----------------------- |
| `gears.scad`          |       3       | Gear, rack, pulley       |
| `rounded_shapes.scad` |       3       | Aesthetic rounded shapes |
| `threads.scad`        |       2       | Screws, bolts            |
| `enclosure.scad`      |       3       | Electronics boxes        |
| `patterns.scad`       |       4       | Ventilation, decoration  |
| `joints.scad`         |       5       | Mechanical joints        |
| `electronics.scad`    |       5       | PCB, cables, batteries   |
| `text_tools.scad`     |       5       | Signage, labels          |
| **Total**             | **30 module** | **Ready to use**         |

---

## 🔗 Link Cepat

- 🏠 [Home Screen](../README.md#cara-pakai) — klik file card untuk auto-insert `use`
- 📁 **Files Manager** — `Alt+Klik` untuk `include`
- ❓ **Cheat Sheet** — tekan `?` di app
- 📖 [Strict Semantics](./strict-semantics.md) — kapan error vs warning

---

> ← Kembali ke [README utama](../README.md)

````

---

## 📝 Update `README.md`

Tambahkan baris baru di tabel Documentation:

```markdown
| [📚 Menggunakan Libraries](./docs-md/using-libraries.md) | `use` vs `include`, 8 bundled libs, custom library |
````

Letakkan setelah baris `Strict Semantics`.

---

## 📝 Update `cheatsheet.js` — Section Baru

Buka `src/ui/cheatsheet.js`, cari array `SYNTAX` di paling bawah, dan tambahkan section baru **tepat sebelum** `{ title: 'Parameters UI', ... }` (atau di mana saja yang rapi):

```javascript
  {
    title: 'Bundled Libraries',
    items: [
      {
        name: 'use <gears.scad>',
        code: 'use <gears.scad>;\n\ngear(number_of_teeth = 20, circular_pitch = 5);\nrack(length = 50);\ntiming_pulley(teeth = 20, pitch = 2);',
        desc: 'Gear, rack, timing pulley'
      },
      {
        name: 'use <rounded_shapes.scad>',
        code: 'use <rounded_shapes.scad>;\n\nrounded_cube([40,30,20], 4, center=true);\nchamfered_cube([30,30,30], 2, center=true);',
        desc: 'Rounded cube, chamfer, rounded cylinder'
      },
      {
        name: 'use <threads.scad>',
        code: 'use <threads.scad>;\n\nmetric_bolt(length=20, diameter=6, pitch=1);',
        desc: 'Screw, bolt (simplified)'
      },
      {
        name: 'use <enclosure.scad>',
        code: 'use <enclosure.scad>;\n\npcb_standoff(height=5, outer_d=6, hole_d=3);\nvent_slots(20, 2, 4, 4);',
        desc: 'Electronics enclosure parts'
      },
      {
        name: 'use <patterns.scad>',
        code: 'use <patterns.scad>;\n\nlinear_extrude(height=3) honeycomb_2d([80,60], 10, 1.5);\nperforated_2d([60,40], 4, 8);\nlattice_3d([40,40,40], 10, 1.5);',
        desc: 'Honeycomb, grid, perforated, lattice'
      },
      {
        name: 'use <joints.scad>',
        code: 'use <joints.scad>;\n\nsnap_fit_clip(15, 4, 10, 3, 2);\ndovetail_male(20, 10, 5);\nball_socket(8, 1.5, 120);',
        desc: 'Snap fit, dovetail, ball joint, hinge'
      },
      {
        name: 'use <electronics.scad>',
        code: 'use <electronics.scad>;\n\npcb_mount_4x(58, 49, 5, 3);\ncable_clip(5, 1.5, 8);\nbattery_holder("AA", 2);\nraspi_mount("4");',
        desc: 'PCB mount, cable clip, battery holder'
      },
      {
        name: 'use <text_tools.scad>',
        code: 'use <text_tools.scad>;\n\ntext_centered("HELLO", 15, 2);\ntext_circular("ROUND", 40, 5);\nlabel_box("NAME", [40,12,2], 7);',
        desc: 'Text center, circular, label box'
      },
    ]
  },
```

---

## 🧪 Verifikasi Setelah Apply

1. **Buka file `docs-md/using-libraries.md` di VS Code** → cek Markdown valid (preview)
2. **Refresh aplikasi** → tekan **`?`** (cheat sheet)
3. **Cari "Bundled Libraries"** di cheat sheet → 8 kartu muncul dengan contoh code
4. **Copy-paste salah satu contoh** → klik **"Use"** → langsung jalan
5. **Cek README** → link `📚 Menggunakan Libraries` muncul di tabel

---
