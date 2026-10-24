# 🆕 Fitur Terbaru (Changelog Fitur)

> ← Kembali ke [README utama](../README.md)

> Dokumen ini mencatat **fitur-fitur terbaru yang sudah terimplementasi** di Mini OpenSCAD. Fokus pada kapabilitas yang saat ini tersedia di codebase.

---

## 📌 Ringkasan

Mini OpenSCAD telah berkembang jauh dari sekadar editor OpenSCAD dasar. Saat ini sudah mencakup **evaluasi di Web Worker**, **profiler performa**, **UI parameter data-driven**, **import STL via IndexedDB**, **text Latin + CJK (Jepang)**, **export PNG/GIF/STL**, hingga **share via URL terkompresi**.

---

## 🧠 1. Evaluasi di Web Worker (Zero-copy)

Evaluasi model dipindahkan ke **Web Worker** terpisah agar UI tidak freeze saat render.

| Aspek | Detail |
|:---|:---|
| 📦 File | `src/worker/eval-worker.js`, `src/worker/worker-client.js` |
| 🚚 Transfer data | `Float32Array` geometry buffer via **transferable objects** (zero-copy) |
| ⏱️ Watchdog | Timeout 15 detik setelah worker ready |
| 🔄 Cancel | Render baru membatalkan render lama (`CancelledError`) |
| 🪂 Fallback | Jika Worker tak tersedia → eksekusi **sync** di main thread |

**Pesan ready handshake:** Worker mengirim `{ type: 'ready' }` sebelum menerima job, mencegah race condition saat cold start.

---

## 📊 2. Profiler Performa

Panel profiler mencatat & menganalisa waktu render.

| Tab | Fungsi |
|:---|:---|
| **Current** | Metrics render terakhir + breakdown per-tahap (`tokenize`, `parse`, `eval`, `stats`, `serialize`, `deserialize`) + tabel op |
| **History** | Tabel 100 render terakhir + statistik (avg/min/max/error rate) |
| **Hotspots** | Agregasi op paling mahal dari banyak render |

- 📦 File: `src/profiler.js`, `src/ui/profiler-panel.js`
- ⏱️ `trackOp()` mengukur tiap module call (`cube`, `difference`, dll) dengan `total`/`count`/`max`
- 🎛️ Tombol **Perf** di topbar (dan `Esc` untuk tutup)

---

## 🎛️ 3. Parameter UI Data-Driven

Form parameter di-generate otomatis dari anotasi komentar kode. Mendukung **dua format**:

### Format A — `@param` (prioritas tinggi)
```c
// @param size  {slider 10 60 30} Box size
// @param shape {enum cube sphere cylinder} Shape
// @param name  {string world} Name
// @param solid {bool true} Solid?
// @param color {color #3b82f6} Color
// @param count {number 5 1} Count
```

### Format B — OpenSCAD Customizer
```c
size = 30;              // [10:60]
steps = 8;             // [4:2:32]
shape = "cube";        // [cube, sphere:Bulat, cylinder]
solid = true;          // [true, false]
```

| Fitur | Detail |
|:---|:---|
| 🎚️ Tipe kontrol | `slider`, `number`, `string`, `bool`, `color`, `enum` |
| 🗂️ Group | Header `/* [Group Name] */` untuk mengelompokkan |
| 🔢 Numeric enum | Opsi enum angka dengan label (`[1:One, 2:Two]`) |
| ↺ Reset | Tombol reset ke nilai default |
| 🧲 Preserve value | `mergeParamValues()` mempertahankan nilai valid saat kode berubah |

- 📦 File: `src/core/params.js`, `src/ui/params-panel.js`, `src/evaluator/params.js`
- 📥 Override AST top-level lewat `applyParams()`

---

## 🧊 4. Preview vs Render Mode (`$preview`)

Toggle antara mode **Preview** (cepat) dan **Render** (final quality).

| Mode | Shortcut | `$preview` | Kegunaan |
|:---|:---:|:---:|:---|
| 👁 Preview | `F5` | `true` | Editing real-time, `$fn` lebih rendah |
| ✦ Render | `F6` | `false` | Kualitas final untuk export |

```c
// Contoh pemakaian
$fn = $preview ? 24 : 96;
```

- 📦 File: `src/state.js` (`previewMode`), `src/evaluator/index.js` (`$preview`)
- 📌 `$preview` adalah variabel boolean bawaan yang di-inject ke root scope

---

## 📁 5. Import STL + IndexedDB File Store

Import file STL untuk dimodifikasi, tersimpan antar sesi.

| Fitur | Detail |
|:---|:---|
| 📥 Import | Tombol **Files** atau **drag-drop** ke viewport |
| 💾 Storage | **IndexedDB** (`mini-openscad-files`) |
| 📏 Limit | Maks 100MB per file, hanya `.stl` |
| ⌨️ Insert cepat | Tombol insert → `import("file.stl");` |
| 🗑️ Delete | Hapus file dari store |
| 🖱️ Drag overlay | Overlay visual saat drag file ke viewport |

- 📦 File: `src/files/file-store.js`, `src/core/ast-utils.js`
- 🔍 `extractImportNames()` regex-scan `import("...")` untuk load hanya file yang dibutuhkan
- 🪂 Worker juga bisa load STL (via `ctx.getFileBuffer()`)

---

## ✍️ 6. Text 2D — Latin & Jepang (CJK)

Dukungan `text()` dengan **dua font engine**.

| Font | Engine | Cakupan |
|:---|:---|:---|
| `helvetiker` / `helvetiker:bold` | three.js Font (JSON) | Latin |
| `noto-jp` | **opentype.js** + OTF | Jepang / CJK |

- 🔍 Auto-deteksi CJK: string Jepang otomatis pakai `noto-jp`
- 📦 File: `src/evaluator/fonts.js`, `src/evaluator/opentype-fonts.js`
- 🎯 Alignment: `halign` (`left`/`center`/`right`), `valign` (`baseline`/`top`/`center`/`bottom`)
- ⚙️ Preload font di worker (`preloadOpenTypeFonts()`) — idempotent & error-tolerant

```c
text("Hello", size = 10);
text("こんにちは", size = 10);              // auto pakai noto-jp
text("Hi", font = "helvetiker:bold", halign = "center");
```

---

## 🧩 7. Bahasa: Sintaks Lanjutan

### `let()` — expression & statement
```c
x = let(a = 5, b = a * 2) a + b;   // 15

let(w = 20, h = 10) {
    cube([w, h, 5]);
    translate([0, h, 0]) sphere(w / 4);
}
```

### List comprehension
```c
[for (i = [0 : 5]) i * 2]
[for (i = [0 : 10]) if (i % 2 == 0) i]
```

### Multi-iterator `for` (Cartesian product)
```c
for (x = [0:1], y = [0:1]) translate([x*10, y*10, 0]) cube(8);
```

### Modul, fungsi & children
```c
module wrapper() { children(); }
wrapper() cube(10);

function f(x) = x * 2;
```

- 📦 File: `src/core/parser.js`, `src/evaluator/index.js`
- 🧮 Operator lengkap: `+ - * / % ^`, `== != < <= > >=`, `&& ||`, ternary `?:`, index `[]`, range `[a:b:c]`

---

## 🧱 8. Geometri: Primitives, CSG & Ekstrusi

| Kategori | Module |
|:---|:---|
| **3D primitives** | `cube`, `sphere`, `cylinder` (r1/r2/d/d1/d2), `polyhedron` |
| **2D primitives** | `circle`, `square`, `polygon`, `text` |
| **Transforms** | `translate`, `rotate`, `scale`, `mirror`, `resize` (auto), `multmatrix`, `color` |
| **Boolean (CSG)** | `union`, `difference`, `intersection` (three-bvh-csg) |
| **Convex** | `hull` (2D & 3D), `minkowski` (approx) |
| **Extrusion** | `linear_extrude`, `rotate_extrude` |
| **Offset** | `offset(r=)` & `offset(delta=)` untuk **2D dan 3D** |
| **I/O** | `import` (STL) |
| **Debug** | `echo`, `assert` |

### Highlight fitur geometri
- **`$fn` / `$fa` / `$fs`** — auto-tessellation adaptif (clamp 5–512 segmen)
- **`offset` 3D** — via Minkowski + convex hull, brush sphere/cube
- **`resize(auto=true)`** — scale seragam agar muat target
- **CSG 2D** — `difference`/`intersection` langsung pada shape 2D (holes)
- **`color`** — string nama, hex `#rrggbb`, atau `[r,g,b]`

- 📦 File: `src/evaluator/builtins.js`, `src/evaluator/geometry.js`, `src/evaluator/csg.js`

---

## 🔢 9. Fungsi Matematika Bawaan

`abs`, `sign`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `floor`, `ceil`, `round`, `sqrt`, `pow`, `exp`, `ln`, `log`, `min`, `max`, `len`, `norm`, `concat`, `str`, plus konstanta `PI`.

- 📐 Sudut dalam **derajat** (bukan radian)
- 📦 File: `src/evaluator/functions.js`

---

## 🖼️ 10. Export & Capture

| Fitur | Detail |
|:---|:---|
| ⬇️ **Export STL** | Binary STL via `STLExporter` |
| 📷 **Screenshot PNG** | Offscreen renderer, resolusi 2× (cap 4096) |
| 🎞️ **Turntable GIF** | Rotasi 360° + `gifenc`, pilihan quality (small/medium/large) + delay frame |

- 🎬 GIF: progress bar, cancel via `AbortController`, encoding streaming
- 🖥️ Offscreen renderer menjaga aspect ratio (adjust FOV horizontal)
- 📦 File: `src/export.js`, `src/gif.js`, `src/viewer/scene.js`

---

## 🔗 11. Share via URL (Terkompresi)

Bagikan project lewat URL — kode + parameter + mode ter-encode.

| Aspek | Detail |
|:---|:---|
| 🗜️ Kompresi | `CompressionStream('gzip')` → base64url |
| 🪂 Fallback | Plain JSON base64url kalau gzip tak tersedia |
| ⚠️ Warning | Peringatan kalau URL > 8000 karakter |
| 📥 Import | Buka link → tab baru ditambahkan ke project yang ada |
| 🧹 Cleanup | Hash dibersihkan setelah load (anti-duplikat saat refresh) |

- 📦 File: `src/share.js`
- Format payload: `[kind][base64url]` — `z` (gzip) atau `p` (plain)

---

## 🗂️ 12. Multi-Tab & Auto-save

| Fitur | Detail |
|:---|:---|
| 🗂️ Multi-tab | Beberapa project terpisah dalam satu sesi |
| ✏️ Rename | Double-click nama tab |
| ❌ Close | Tombol × atau klik tengah (min 1 tab) |
| ⚡ Auto-render | Render otomatis setelah idle (delay 800ms) |
| 💾 Auto-save | localStorage (delay 500ms), key `mini-openscad-v2` |
| 🔄 Migrasi | Otomatis migrasi dari format v1 (single project) |

- 📦 File: `src/tabs.js`, `src/storage.js`, `src/ui/tabbar.js`
- 🖥️ Setiap tab menyimpan `code`, `paramValues`, `autoRender`

---

## 🏠 13. Home Screen & Dropdown Custom

| Fitur | Detail |
|:---|:---|
| 🏠 Home screen | Muncul saat kunjungan pertama, menu New/Import/Files/Cheat |
| 📁 File cards | Grid file STL tersimpan (max 5 + "show more") |
| 📚 Presets dropdown | Dropdown custom (fixed positioning, anti-clip) |
| ⌨️ Keyboard nav | Arrow up/down, Enter, Esc pada dropdown |

- 📦 File: `src/ui/home.js`, `src/ui/dropdown.js`

---

## 🧭 14. Viewer 3D

| Fitur | Detail |
|:---|:---|
| 🎥 Kamera | OrbitControls, damping, Z-up |
| 🖼️ Wireframe | Toggle wireframe per mesh |
| 📐 Grid | Toggle grid helper |
| 🎯 Fit-to-model | Auto-frame bbox + info dimensi |
| 📊 FPS counter | Update tiap 500ms |
| 🔄 Resize | ResizeObserver + window resize |

- 📦 File: `src/viewer/scene.js`
- 💡 Lighting: Hemisphere + 2 Directional + Ambient
- 🎨 Material: MeshStandardMaterial, DoubleSide, roughness 0.55

---

## 🐞 15. Friendly Errors & Suggestions

| Fitur | Detail |
|:---|:---|
| 💡 Saran typo | Levenshtein distance untuk variabel/fungsi/module tak dikenal |
| 📍 Line info | Pesan error menampilkan baris + snippet kode |
| 🔧 Hints | Hint kontekstual (mis. `children()` di luar module) |

**Contoh output:**
```
Line 12: Variabel tidak dikenal: 'raduis'
   → cylinder(h = 10, raduis = 5);
   💡 Mungkin maksud Anda: 'radius'
```

- 📦 File: `src/utils/suggest.js`, `src/utils.js`
- 🎚️ Threshold adaptif berdasarkan panjang nama

---

## 📋 Ringkasan Fitur per Kategori

| Kategori | Fitur Utama |
|:---|:---|
| ⚙️ **Runtime** | Web Worker, zero-copy transfer, cancel, watchdog, fallback sync |
| 📊 **Observability** | Profiler (current/history/hotspots), FPS, bbox info |
| 🎛️ **Parametrik** | `@param` + OpenSCAD customizer, 6 tipe kontrol, group |
| 🧊 **Mode Render** | Preview (`$preview=true`) vs Render (`$preview=false`) |
| 📁 **File I/O** | Import/drag-drop STL, IndexedDB, insert snippet |
| ✍️ **Text** | Latin (helvetiker) + Jepang (noto-jp via opentype.js) |
| 🧩 **Bahasa** | `let()`, list comprehension, multi-iterator for, ternary |
| 🧱 **Geometri** | 2D & 3D primitives, CSG, hull, minkowski, offset, extrude |
| 🖼️ **Export** | STL, PNG (2×), turntable GIF |
| 🔗 **Sharing** | URL gzip-compressed, anti-duplikat |
| 🗂️ **Project** | Multi-tab, rename, auto-render, auto-save, migrasi v1→v2 |

---

## ⏭️ Catatan

> Dokumen ini mencerminkan **fitur yang sudah terimplementasi** pada codebase saat ini. Untuk detail arsitektur lihat [architecture.md](./architecture.md), untuk sanity test lihat [testing.md](./testing.md).

---

> ← Kembali ke [README utama](../README.md)