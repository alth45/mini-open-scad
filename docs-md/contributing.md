# 🤝 Kontribusi

> ← Kembali ke [README utama](../README.md)

> **PR welcome!** Untuk perubahan besar, buka **issue** terlebih dahulu untuk diskusi — hindari PR besar yang tidak dibahas sebelumnya.

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
console.warn('[csg] fallback triggered');
console.error('[eval-worker] parse failed', err);
```

> 🎯 Memudahkan filter di DevTools: `[worker]`, `[csg]`, `[share]`, dll.

### 🔹 Komentar Bahasa Indonesia

Untuk logika yang **tidak obvious**, tulis komentar dalam **Bahasa Indonesia**.

```js
// Normalisasi vektor agar konsisten terhadap winding order
// — kalau dibalik, CSG bisa menghasilkan mesh inverted
const normal = cross(b.sub(a), c.sub(a)).normalize();
```

---

## ✅ Sebelum Commit

Selalu jalankan build untuk memastikan tidak ada error bundling:

```bash
npm run build   # pastikan tidak ada error bundling
```

> ⚠️ **Jangan commit** jika build gagal — termasuk warning yang mengindikasikan masalah bundling.

---

## 📋 Checklist Kontribusi

| ✅ | Item |
|:---:|:---|
| ☐ | Issue dibuka dulu (untuk perubahan besar) |
| ☐ | ES modules — tidak ada `require()` |
| ☐ | JSDoc untuk fungsi publik baru |
| ☐ | Console log berprefix `[module]` |
| ☐ | Komentar Bahasa Indonesia untuk logika rumit |
| ☐ | `npm run build` lulus tanpa error |

---

> 💡 **Tips:** PR kecil & fokus lebih mudah di-review daripada PR besar yang menyentuh banyak file sekaligus. Pecah perubahan menjadi bagian-bagian logis.

---

> ← Kembali ke [README utama](../README.md)
