/**
 * Bundled Libraries Loader
 * Load library .scad bawaan dari public/libraries/ ke IndexedDB
 * pada startup (sekali saja per versi).
 */

import { saveFile, listFiles } from "./file-store.js";
import { log } from "../ui/console.js";

const BUNDLED_LIBS = [
    'gears.scad',
    'rounded_shapes.scad',
    'threads.scad',
    'enclosure.scad',
    'patterns.scad',
    'joints.scad',
    'electronics.scad',
    'text_tools.scad',
];

// ✨ PENTING: Bump version agar auto-load ulang

const BUNDLED_VERSION_KEY = "bundled-libs-version";
const CURRENT_BUNDLED_VERSION = "2";

export async function loadBundledLibraries() {
  // Skip kalau sudah versi terbaru
  const savedVersion = localStorage.getItem(BUNDLED_VERSION_KEY);
  if (savedVersion === CURRENT_BUNDLED_VERSION) {
    return;
  }

  try {
    const existing = await listFiles();
    const existingNames = new Set(existing.map((f) => f.name));

    let loaded = 0;
    let skipped = 0;

    for (const filename of BUNDLED_LIBS) {
      // Skip jika user sudah punya file dengan nama yang sama
      // (jangan timpa file user!)
      if (existingNames.has(filename)) {
        skipped++;
        continue;
      }

      try {
        const res = await fetch(`/libraries/${filename}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        await saveFile(filename, buffer, "text/x-scad");
        loaded++;
      } catch (err) {
        console.warn(`[bundled-libs] gagal load ${filename}:`, err);
      }
    }

    localStorage.setItem(BUNDLED_VERSION_KEY, CURRENT_BUNDLED_VERSION);
    if (loaded > 0) {
      log("info", `📚 ${loaded} library bawaan dimuat (${skipped} dilewati)`);
    }
  } catch (err) {
    console.warn("[bundled-libs] load failed:", err);
  }
}
