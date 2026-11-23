import { STORAGE_SCHEMA_VERSION } from "./contract/schemas.js";
import { toast } from "./ui/status.js";

const CURRENT_KEY = "mini-openscad-v2";
const OLD_KEY = "mini-openscad-v1";

function backupRawData(raw) {
  try {
    const backupKey = `mini-openscad-backup-${Date.now()}`;
    localStorage.setItem(backupKey, raw);
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith("mini-openscad-backup-"),
    );
    if (keys.length > 5) localStorage.removeItem(keys.sort()[0]);
  } catch (e) {
    console.warn("[storage] Gagal membuat backup:", e);
  }
}

function migrateV1toV4(oldData) {
  const projId = "proj_migrated_" + Date.now().toString(36);
  const tabId = "tab_migrated_" + Date.now().toString(36);
  return {
    schemaVersion: 4,
    projects: [
      {
        id: projId,
        name: "Project 1",
        tabIds: [tabId],
        mainTabId: tabId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    tabs: [
      {
        id: tabId,
        name: "main.scad",
        code: oldData.code || "",
        paramValues:
          oldData.paramValues && typeof oldData.paramValues === "object"
            ? oldData.paramValues
            : {},
        autoRender:
          typeof oldData.autoRender === "boolean" ? oldData.autoRender : true,
        projectId: projId,
      },
    ],
    activeProjectId: projId,
    activeId: tabId,
    previewMode: true,
  };
}

function migrateV2toV4(v2Data) {
  const projId = "proj_migrated_" + Date.now().toString(36);
  const tabs = (v2Data.tabs || []).map((t) => ({ ...t, projectId: projId }));
  const activeId = v2Data.activeId || tabs[0]?.id;
  return {
    schemaVersion: 4,
    projects: [
      {
        id: projId,
        name: "Project 1",
        tabIds: tabs.map((t) => t.id),
        mainTabId: activeId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    tabs,
    activeProjectId: projId,
    activeId,
    previewMode: v2Data.previewMode ?? true,
  };
}

function migrateV3toV4(v3Data) {
  const projId = "proj_migrated_" + Date.now().toString(36);
  const tabs = (v3Data.tabs || []).map((t) => ({ ...t, projectId: projId }));
  const activeId = v3Data.activeId || tabs[0]?.id;
  return {
    schemaVersion: 4,
    projects: [
      {
        id: projId,
        name: "Project 1",
        tabIds: tabs.map((t) => t.id),
        mainTabId: activeId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    tabs,
    activeProjectId: projId,
    activeId,
    previewMode: v3Data.previewMode ?? true,
  };
}

export function saveTabs(data) {
  try {
    const payload = { schemaVersion: STORAGE_SCHEMA_VERSION, ...data };
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

      const version = data.schemaVersion || 2;
      let migrated = data;

      if (version === 2) migrated = migrateV2toV4(migrated);
      else if (version === 3) migrated = migrateV3toV4(migrated);
      else if (version !== STORAGE_SCHEMA_VERSION) {
        console.warn(`[storage] Versi skema tidak dikenal: ${version}`);
        return null;
      }

      if (
        Array.isArray(migrated.tabs) &&
        migrated.tabs.length > 0 &&
        Array.isArray(migrated.projects) &&
        migrated.projects.length > 0
      ) {
        // Persist migration if upgraded
        if (version !== STORAGE_SCHEMA_VERSION) {
          saveTabs(migrated);
        }
        return migrated;
      }
    }

    const oldRaw = localStorage.getItem(OLD_KEY);
    if (oldRaw) {
      backupRawData(oldRaw);
      const oldData = JSON.parse(oldRaw);
      const migrated = migrateV1toV4(oldData);
      localStorage.removeItem(OLD_KEY);
      saveTabs(migrated);
      return migrated;
    }

    return null;
  } catch (err) {
    console.warn("[storage] Gagal memuat data (korup?):", err);
    return null;
  }
}

/* Theme */
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
