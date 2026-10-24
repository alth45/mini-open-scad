# 🛠️ Development Tips

> ← Kembali ke [README utama](../README.md)

> Kumpulan tips praktis untuk **debugging** dan **extending** engine saat development.

---

## 🐞 Debug Worker

Worker berjalan di thread terpisah — gunakan **Chrome DevTools** untuk inspect.

```
Chrome DevTools
  └─ Sources
      └─ Sidebar → Workers
          └─ Klik eval-worker.js
              ├─ Set breakpoint
              └─ console.log() berjalan normal
```

> 💡 Worker punya **console sendiri** — `console.log` di dalamnya tetap muncul di tab Console utama.

---

## 📝 Enable Verbose Logs

Semua log di-prefix agar mudah difilter:

| Prefix | Sumber |
|:---|:---|
| `[worker]` | Worker utama |
| `[eval-worker]` | Evaluator worker |
| `[csg]` | CSG operations |
| `[share]` | Share URL module |
| `[gif]` | GIF export |

### Filter di Console

```
-[vite]
```

> 🎯 Exclude noise HMR dari Vite agar log aplikasi lebih bersih dan fokus.

---

## 🧩 Modify Builtins

Menambah module baru (misal `cylinder`, `cone`, `torus`):

### Langkah

1. **Buka** `src/evaluator/builtins.js`
2. **Cari** function `makeBuiltins(evalStatements)`
3. **Tambah** entry baru ke object yang di-return:

```js
function makeBuiltins(evalStatements) {
  return {
    cube, sphere,
    // ✨ tambahkan di sini
    cylinder: (r, h) => makeCylinder(r, h),
  };
}
```

4. **Selesai** — module langsung tersedia di bahasa ✅

---

## ✍️ Modify Syntax

Menambah **keyword highlighting** untuk sintaks baru:

### Langkah

1. **Buka** `src/ui/editor.js`
2. **Cari** `HL_KEYWORDS` Set
3. **Tambah** keyword:

```js
const HL_KEYWORDS = new Set([
  'module', 'function', 'for', 'if',
  // ✨ tambahkan di sini
  'intersection', 'hull', 'minkowski',
]);
```

> ⚠️ Highlighting **hanya visual** — untuk mendukung sintaks sebenarnya, perlu update di `src/evaluator/` juga.

---

## 📌 Quick Reference

| Task | File | Entry Point |
|:---|:---|:---|
| 🔍 Debug worker | DevTools | `Sources → Workers` |
| 🧩 Tambah module | `src/evaluator/builtins.js` | `makeBuiltins()` |
| ✍️ Tambah highlight | `src/ui/editor.js` | `HL_KEYWORDS` Set |
| 🎯 Filter log | Console | `-[vite]` |

---

> 💡 **Pro tip:** Sebelum menambah builtin baru, cek dulu implementasi `cube`/`sphere` sebagai pola — biasanya cukup mengikuti pola yang sama (terima params → return geometry buffer).

---

> ← Kembali ke [README utama](../README.md)
