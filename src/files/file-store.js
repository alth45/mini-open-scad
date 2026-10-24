/* ============================================================
   IndexedDB store untuk file STL (dipakai main thread & worker)
   ============================================================ */

const DB_NAME = 'mini-openscad-files';
const STORE = 'files';
const VERSION = 1;

let dbPromise = null;

function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'name' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

export async function saveFile(name, buffer, type = 'model/stl') {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({
            name,
            size: buffer.byteLength,
            type,
            data: buffer,
            uploadedAt: Date.now()
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function loadFiles(names) {
    if (!names || names.length === 0) return {};
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const out = {};
        let pending = names.length;
        for (const name of names) {
            const req = store.get(name);
            req.onsuccess = () => {
                if (req.result) out[name] = req.result.data;
                if (--pending === 0) resolve(out);
            };
            req.onerror = () => { if (--pending === 0) resolve(out); };
        }
    });
}

export async function listFiles() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => {
            const files = (req.result || [])
                .map(({ name, size, type, uploadedAt }) => ({ name, size, type, uploadedAt }))
                .sort((a, b) => a.name.localeCompare(b.name));
            resolve(files);
        };
        req.onerror = () => reject(req.error);
    });
}

export async function deleteFile(name) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(name);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}