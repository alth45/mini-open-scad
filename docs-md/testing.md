# 🧪 Testing & Sanity Checklist

> ← Kembali ke [README utama](../README.md)

> Belum ada **automated test suite**, tapi tersedia **sanity checklist** manual per fitur untuk memastikan tiap komponen berfungsi sesuai harapan.

---

## 🌐 Bahasa

Setiap skenario berikut harus menghasilkan render yang **valid dan sesuai ekspektasi**.

| # | Fitur | Contoh Kode |
|:---:|:---|:---|
| **1** | 🧩 **CSG** | `difference() { cube(20); sphere(14); }` |
| **2** | 🔄 **Transform** | `translate([20, 0, 0]) rotate([0, 0, 45]) cube(10);` |
| **3** | 🔁 **Control Flow** | `for (i = [0 : 4]) translate([i * 12, 0, 0]) cube(10);` |
| **4** | 📐 **Function** | `function f(x) = x * 2;`<br>`cube(f(10));` |
| **5** | 📦 **Module + Children** | `module wrapper() { children(); }`<br>`wrapper() sphere(5);` |
| **6** | 🎚️ **Parameter** | `// @param s {slider 10 50 25} Size`<br>`cube(s);` |

---

## 🛠️ Tool

Checklist fitur aplikasi — semua harus **lulus tanpa error**.

| Fitur | Kriteria Lulus |
|:---|:---|
| 🔗 **Share URL** | Buka di tab baru → konten sama persis |
| 🖼️ **PNG / GIF Export** | File ter-download & **valid** (bisa dibuka) |
| 📂 **STL Import** | Model dari disk **tampil** di viewer |
| 🗂️ **Multi-tab** | Switch antar tab, **rename**, dan **close** berfungsi |
| ↩️ **Undo / Redo** | `Ctrl` + `Z` / `Ctrl` + `Y` bekerja konsisten |
| ❓ **Cheat Sheet** | Tekan `?` → modal **toggle** buka/tutup |

---

> 💡 **Catatan:** Checklist ini menjadi baseline sebelum automated test suite dibangun. Setiap fitur baru wajib menambah item ke sanity checklist terlebih dahulu.

---

> ← Kembali ke [README utama](../README.md)
