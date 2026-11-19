/**
 * IndexedDB store untuk parameter presets per tab.
 * Terpisah dari file-store.js & image-store.js — tidak konflik.
 *
 * Schema per entry:
 *   { tabId, presets: [{ name, values, createdAt, updatedAt }], updatedAt }
 */
const DB_NAME = "mini-openscad-presets";
const STORE = "presets";
const VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "tabId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** @returns {Promise<Array<{name, values, createdAt, updatedAt}>>} */
export async function loadPresets(tabId) {
  if (!tabId) return [];
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(tabId);
      req.onsuccess = () => resolve(req.result?.presets || []);
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    console.warn("[presets] load failed:", e);
    return [];
  }
}

export async function savePresets(tabId, presets) {
  if (!tabId) throw new Error("tabId wajib");
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ tabId, presets, updatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteAllPresets(tabId) {
  if (!tabId) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(tabId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
