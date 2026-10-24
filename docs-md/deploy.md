# 🌐 Deploy Guide

> ← Kembali ke [README utama](../README.md)

> Beberapa opsi deployment — pilih sesuai kebutuhan. **Netlify** paling cepat untuk prototyping, **Docker** untuk self-hosted.

---

## 🚀 Netlify — *Paling Cepat*

### Opsi 1: Drag & Drop

```bash
npm run build
# drag & drop folder dist/ ke https://app.netlify.com/drop
```

### Opsi 2: Via CLI

```bash
npm install -g netlify-cli
netlify deploy --prod --dir=dist
```

---

## ▲ Vercel

```bash
npm install -g vercel
vercel --prod
```

---

## 🐙 GitHub Pages

```bash
# di vite.config.js, tambahkan: base: '/<repo-name>/'
npm run build
# commit dist/ ke branch gh-pages
```

> ⚠️ **Penting:** Jangan lupa set `base: '/<repo-name>/'` di `vite.config.js`, jika tidak aset akan 404.

---

## 🐳 Docker *(Opsional)*

Cocok untuk **self-hosted** atau deployment on-premise.

### `Dockerfile`

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

### Build & Run

```bash
docker build -t mini-open-scad .
docker run -p 8080:80 mini-open-scad
```

Akses di **`http://localhost:8080`** 🎉

---

## 📊 Perbandingan Platform

| Platform | Setup | Biaya | Cocok Untuk |
|:---|:---:|:---:|:---|
| 🚀 **Netlify** | ⚡ Sangat mudah | Gratis | Prototyping cepat |
| ▲ **Vercel** | ⚡ Mudah | Gratis | Preview per-PR |
| 🐙 **GitHub Pages** | 🔧 Manual | Gratis | Repo open-source |
| 🐳 **Docker** | 🔨 Menengah | Self-hosted | Kontrol penuh |

---

> 💡 **Tips:** Untuk demo publik, gunakan **Netlify Drop** — cukup drag `dist/` dan langsung online dalam hitungan detik, tanpa CLI atau akun kompleks.

---

> ← Kembali ke [README utama](../README.md)
