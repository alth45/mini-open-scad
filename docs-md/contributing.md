# 🤝 Kontribusi

> ← Kembali ke [README utama](../README.md)

> **PR (Pull Request) sangat welcome!** Untuk perubahan besar, buka **Issue** terlebih dahulu untuk diskusi — hindari PR besar yang tidak dibahas sebelumnya.

---

## 📂 Memahami Arsitektur (PENTING)

Sebelum menulis kode, pahami bahwa proyek ini sudah dipecah menjadi beberapa modul agar *maintainable*. Jangan menaruh semua logika di `main.js`!
- `src/main.js`: Hanya untuk inisialisasi core, render pipeline, dan wiring.
- `src/app/`: Fitur UI (Shortcuts, Export UI, Capture, Viewer Tools).
- `src/evaluator/`: Core engine (Builtins, Manifold, CSG, Geometry).
- `src/core/`: Parser, Tokenizer, AST Utils.

---

## 📐 Style Guide

### 🔹 ES Modules

Gunakan `import` / `export` — konsisten di seluruh codebase.

```js
import { tokenize } from './parser.js';
export function parse(tokens) { /* ... */ }
```

### 🔹 No TypeScript *(saat ini)*

Proyek ini **belum** menggunakan TypeScript. Gunakan **JSDoc** untuk type hints.

```js
/**
 * @param {string} source
 * @returns {Token[]}
 */
function tokenize(source) { /* ... */ }
```

### 🔹 Prefix Console Log

Setiap log wajib diberi prefix **nama module** dalam kurung siku.

```js
console.log('[worker] starting...');
console.warn('[manifold] fallback triggered');
console.error('[eval-worker] parse failed', err);
```

> 🎯 Memudahkan filter di Chrome DevTools: `[worker]`, `[csg]`, `[share]`, dll.

### 🔹 Komentar Bahasa Indonesia

Untuk logika yang **tidak obvious** (terutama matematika geometri), tulis komentar dalam **Bahasa Indonesia**.

```js
// Normalisasi vektor agar konsisten terhadap winding order
// — kalau dibalik, CSG bisa menghasilkan mesh inverted
const normal = cross(b.sub(a), c.sub(a)).normalize();
```

---

## ⚙️ Aturan Khusus Engine (Manifold)

1. **Selalu Gunakan Manifold untuk 3D Boolean**: Jangan menggunakan `three-bvh-csg` sebagai primary engine. `three-bvh-csg` hanya untuk *fallback* jika WebAssembly gagal dimuat.
2. **Watertight by Default**: Setiap geometri yang dihasilkan oleh operasi CSG (Union, Difference, Intersection) **wajib** melewati proses `mergeVertices` atau di-generate langsung oleh Manifold. Ini menjamin file STL/3MF 100% siap cetak.
3. **2D Boolean Terpisah**: Operasi `difference` dan `union` untuk objek 2D (seperti `square` dan `circle`) menggunakan metode *extrude -> Manifold 3D -> extract 2D*. Jangan mengubah logika ini tanpa pengujian menyeluruh, karena ini yang membuat export DXF/SVG menjadi rapi.

---

## ✅ Sebelum Commit

1. **Jalankan Build**: Pastikan tidak ada error bundling.
   ```bash
   npm run build
   ```
2. **Jalankan Stress Test**: Buka file `docs-md/benchmark.md`, jalankan 2-3 test (terutama Test 6: Mixed, dan Test 8: 200 CSG Ops) untuk memastikan engine tidak crash setelah perubahanmu.
3. **Cek Export**: Pastikan file yang diexport ke STL/3MF tidak memiliki "garis merah" (non-manifold) saat dibuka di Slicer.

> ⚠️ **Jangan commit** jika build gagal atau stress test menghasilkan error.

---

## 📋 Checklist Kontribusi

| ✅ | Item |
|:---:|:---|
| ☐ | Issue dibuka dulu (untuk perubahan besar) |
| ☐ | ES modules — tidak ada `require()` |
| ☐ | JSDoc untuk fungsi publik baru |
| ☐ | Console log berprefix `[module]` |
| ☐ | Komentar Bahasa Indonesia untuk logika rumit |
| ☐ | Logika UI ditaruh di `src/app/`, bukan `main.js` |
| ☐ | `npm run build` lulus tanpa error |
| ☐ | Lulus Stress Test standar (lihat `benchmark.md`) |

---

> 💡 **Tips:** PR kecil & fokus lebih mudah di-review daripada PR besar yang menyentuh banyak file sekaligus. Pecah perubahan menjadi bagian-bagian logis (misal: PR untuk fix bug parser, PR terpisah untuk UI).

---

> ← Kembali ke [README utama](../README.md)
```