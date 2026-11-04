import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa"; // <-- TAMBAH

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "prompt", // user yang putuskan kapan reload
      injectRegister: null, // kita register manual di main.js
      includeAssets: ["manifold.wasm", "icon.svg", "fonts/**/*"],
      manifest: {
        name: "Mini OpenSCAD",
        short_name: "MiniSCAD",
        description:
          "Miniature CAD tool di browser — tulis OpenSCAD, lihat 3D real-time.",
        lang: "id",
        theme_color: "#1e1e1e",
        background_color: "#1e1e1e",
        display: "standalone",
        orientation: "any",
        scope: "./",
        start_url: "./",
        categories: ["productivity", "graphics", "design"],
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        screenshots: [
          {
            src: "screenshot-desktop.png", // Path relatif terhadap folder public
            sizes: "1280x720",
            type: "image/png",
            form_factor: "wide", // Wajib untuk desktop
            label: "Editor Mini OpenSCAD dengan tampilan 3D",
          },
          {
            src: "screenshot-mobile.png",
            sizes: "750x1334",
            type: "image/png",
            // form_factor tidak di-set (atau bisa diisi "narrow")
            // Ini akan memenuhi syarat untuk mobile
            label: "Antarmuka Mini OpenSCAD di perangkat mobile",
          },
        ],
      },
      workbox: {
        globPatterns: [
          "**/*.{js,css,html,svg,png,ico,woff,woff2,ttf,otf,wasm,json}",
        ],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024, // 15MB (manifold.wasm besar)
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "fontawesome-cdn",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
        // skip waiting: default — user yang trigger via prompt
        navigateFallback: null, // SPA, jangan redirect ke index
      },
    }),
  ],
  server: {
    port: 5174,
    open: false,
  },
  preview: {
    port: 8000,
    open: false,
  },
  worker: {
    format: "es",
  },
  resolve: {
    dedupe: ["three", "three-mesh-bvh"],
    alias: [{ find: /^three\/addons\//, replacement: "three/examples/jsm/" }],
  },
  optimizeDeps: {
    include: ["three", "three-mesh-bvh", "three-bvh-csg", "opentype.js"],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV || "production",
    ),
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("three-bvh-csg") || id.includes("three-mesh-bvh"))
            return "csg-vendor";
          if (id.includes("/node_modules/three/")) return "three-vendor";
          if (id.includes("/node_modules/gifenc/")) return "gif-vendor";
          if (id.includes("/node_modules/opentype.js/"))
            return "opentype-vendor";
          return "vendor";
        },
      },
    },
  },
});
