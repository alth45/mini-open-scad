/**
 * Cloudinary backup layer — snapshot-based.
 *
 * PENTING: Unsigned upload TIDAK bisa overwrite (Cloudinary security).
 * Setiap save = file baru dengan public_id ber-timestamp.
 * Index backup disimpan di localStorage (per-tab, max 20 versi).
 */
import { CLOUD_CONFIG } from "../config.js";

const API_BASE = `https://api.cloudinary.com/v1_1/${CLOUD_CONFIG.cloudName}`;
const INDEX_KEY = "mini-openscad-cloud-backup-index";

/* ---------- Index lokal ---------- */
function readIndex() {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeIndex(idx) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
  } catch (e) {
    console.warn("[cloud] index write failed:", e);
  }
}

export function getBackupHistory(tabId) {
  const idx = readIndex();
  return (idx[tabId] || []).slice().sort((a, b) => b.timestamp - a.timestamp);
}

export function getAllBackupCount() {
  const idx = readIndex();
  return Object.values(idx).reduce((sum, arr) => sum + arr.length, 0);
}

function pushBackupEntry(tabId, entry) {
  const idx = readIndex();
  const list = idx[tabId] || [];
  list.push(entry);
  // Batasi 20 versi per tab (yang lama dihapus dari index, file di Cloudinary tetap ada)
  idx[tabId] = list.slice(-20);
  writeIndex(idx);
}

/* ---------- Upload raw ---------- */
async function uploadRaw(publicId, text, contentType = "text/plain") {
  const blob = new Blob([text], { type: contentType });
  const file = new File([blob], publicId.split("/").pop() || "file.txt", {
    type: contentType,
  });

  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUD_CONFIG.uploadPreset);
  fd.append("public_id", publicId);
  fd.append("folder", CLOUD_CONFIG.folder);
  // overwrite sengaja TIDAK dikirim — unsigned upload mengabaikannya

  const res = await fetch(`${API_BASE}/raw/upload`, {
    method: "POST",
    body: fd,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `Cloudinary upload gagal (${res.status}): ${err.error?.message || "unknown"}`,
    );
  }
  return res.json();
}

/* ---------- Fetch teks ---------- */
async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url} gagal (${res.status})`);
  return res.text();
}

/* ---------- Public API ---------- */

/**
 * Upload snapshot satu tab. Return entry { timestamp, codeUrl, metaUrl, size }.
 */
export async function backupTab(tab) {
  if (!tab?.id) return null;
  const ts = Date.now();
  const iso = new Date(ts).toISOString().replace(/[:.]/g, "-");
  const base = `${CLOUD_CONFIG.folder}/tabs/${tab.id}/${iso}`;

  const code = tab.code || "";
  const meta = JSON.stringify(
    {
      id: tab.id,
      name: tab.name || "Untitled",
      paramValues: tab.paramValues || {},
      autoRender: tab.autoRender !== false,
      previewMode: tab.previewMode !== false,
      savedAt: ts,
    },
    null,
    2,
  );

  const [codeRes, metaRes] = await Promise.all([
    uploadRaw(`${base}.scad`, code),
    uploadRaw(`${base}.json`, meta, "application/json"),
  ]);

  const entry = {
    timestamp: ts,
    codeUrl: codeRes.secure_url,
    metaUrl: metaRes.secure_url,
    size: (code.length + meta.length) * 2, // bytes approx
    deleteToken: codeRes.delete_token || null, // valid 10 menit
  };
  pushBackupEntry(tab.id, entry);
  return entry;
}

/**
 * Restore tab dari URL snapshot Cloudinary.
 * @returns {{ id, name, code, paramValues, autoRender, previewMode }}
 */
export async function restoreFromUrls(codeUrl, metaUrl) {
  const [code, metaRaw] = await Promise.all([
    fetchText(codeUrl),
    metaUrl ? fetchText(metaUrl) : Promise.resolve("{}"),
  ]);
  let meta = {};
  try {
    meta = JSON.parse(metaRaw);
  } catch {
    /* meta korup — abaikan */
  }
  return {
    id: meta.id || "restored_" + Date.now().toString(36),
    name: meta.name || "Restored Tab",
    code,
    paramValues: meta.paramValues || {},
    autoRender: meta.autoRender !== false,
    previewMode: meta.previewMode !== false,
  };
}

/**
 * Delete file via delete_token (valid hanya 10 menit setelah upload).
 * Setelah 10 menit, user harus delete manual di Cloudinary dashboard.
 */
export async function deleteByToken(deleteToken) {
  if (!deleteToken)
    return { ok: false, error: "Token tidak tersedia / sudah expired" };
  const fd = new FormData();
  fd.append("token", deleteToken);
  const res = await fetch(`${API_BASE}/delete_by_token`, {
    method: "POST",
    body: fd,
  });
  return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
}

/* ---------- Export / Import bundle (cross-device) ---------- */

/** Export semua backup history sebagai JSON (untuk dipindah device). */
export function exportBackupBundle() {
  const idx = readIndex();
  const bundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    cloudName: CLOUD_CONFIG.cloudName,
    tabs: idx,
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mini-openscad-backup-bundle-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Import bundle → merge ke index lokal. */
export function importBackupBundle(jsonText) {
  const bundle = JSON.parse(jsonText);
  if (!bundle?.tabs) throw new Error("Format bundle tidak valid");
  const idx = readIndex();
  let merged = 0;
  for (const [tabId, entries] of Object.entries(bundle.tabs)) {
    const existing = new Set((idx[tabId] || []).map((e) => e.timestamp));
    for (const e of entries) {
      if (!existing.has(e.timestamp)) {
        (idx[tabId] = idx[tabId] || []).push(e);
        merged++;
      }
    }
    idx[tabId].sort((a, b) => a.timestamp - b.timestamp);
    idx[tabId] = idx[tabId].slice(-20);
  }
  writeIndex(idx);
  return { merged, totalTabs: Object.keys(bundle.tabs).length };
}
