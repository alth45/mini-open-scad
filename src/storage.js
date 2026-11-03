import { STORAGE_SCHEMA_VERSION } from "./contract/schemas.js";

const CURRENT_KEY = "mini-openscad-v2";
const OLD_KEY = "mini-openscad-v1";
import { toast } from "./ui/status.js"; // TAMBAHKAN

/* ---------- Helper Backup ---------- */
function backupRawData(raw) {
  try {
    const backupKey = `mini-openscad-backup-${Date.now()}`;
    localStorage.setItem(backupKey, raw);
    // Opsional: Hapus backup lama jika lebih dari 5, agar tidak memenuhi kuota
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith("mini-openscad-backup-"),
    );
    if (keys.length > 5) {
      localStorage.removeItem(keys.sort()[0]);
    }
  } catch (e) {
    console.warn("[storage] Gagal membuat backup:", e);
  }
}

/* ---------- Migration Chain ---------- */
function migrateV1toV2(oldData) {
  const id = "tab_migrated_" + Date.now().toString(36);
  return {
    tabs: [
      {
        id,
        name: "Project 1",
        code: oldData.code || "",
        paramValues:
          oldData.paramValues && typeof oldData.paramValues === "object"
            ? oldData.paramValues
            : {},
        autoRender:
          typeof oldData.autoRender === "boolean" ? oldData.autoRender : true,
      },
    ],
    activeId: id,
    previewMode: true,
    schemaVersion: 3, // Langsung ke versi terbaru
  };
}

function migrateV2toV3(v2Data) {
  return {
    ...v2Data,
    schemaVersion: 3,
  };
}

/* ---------- Public API ---------- */
export function saveTabs(tabs, activeId, previewMode = true) {
  try {
    const payload = {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      tabs,
      activeId,
      previewMode,
    };
    localStorage.setItem(CURRENT_KEY, JSON.stringify(payload));
  } catch (e) {
    if (e.name === "QuotaExceededError" || e.code === 22) {
      console.warn("[storage] Storage penuh!");
      toast("⚠ Storage penuh! Hapus project lama atau file STL.");
    } else {
      console.warn("[storage] Gagal menyimpan:", e);
    }
  }
}

export function loadTabs() {
  try {
    let raw = localStorage.getItem(CURRENT_KEY);
    if (raw) {
      backupRawData(raw);
      const data = JSON.parse(raw);
      if (!data) return null;

      // Tentukan versi (jika tidak ada schemaVersion, anggap v2)
      const version = data.schemaVersion || 2;
      let migrated = data;

      if (version === 2) {
        migrated = migrateV2toV3(migrated);
      } else if (version !== STORAGE_SCHEMA_VERSION) {
        console.warn(`[storage] Versi skema tidak dikenal: ${version}`);
        return null;
      }

      if (Array.isArray(migrated.tabs) && migrated.tabs.length > 0) {
        return migrated;
      }
    }

    // Fallback: Coba migrasi dari V1 (Single Project)
    const oldRaw = localStorage.getItem(OLD_KEY);
    if (oldRaw) {
      backupRawData(oldRaw);
      const oldData = JSON.parse(oldRaw);
      const migrated = migrateV1toV2(oldData);
      localStorage.removeItem(OLD_KEY);
      saveTabs(migrated.tabs, migrated.activeId, migrated.previewMode);
      return migrated;
    }

    return null;
  } catch (err) {
    console.warn("[storage] Gagal memuat data (korup?):", err);
    return null;
  }
}
/* ---------- Theme Storage ---------- */
const THEME_KEY = "mini-openscad-theme";

export function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* quota / private */
  }
}

export function loadTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "dark";
  } catch {
    return "dark";
  }
}
