import { generateThumbnail } from "../files/file-thumbnail.js";
import { escapeHtml } from "../utils.js";

/**
 * Preview panel untuk Files Manager.
 * API: { show({ name, size, buffer, type }), clear() }
 */
export function createFilePreview(previewEl) {
  if (!previewEl) {
    console.warn("[file-preview] element tidak ditemukan");
    return { show: async () => {}, clear: () => {} };
  }

  let currentKey = null;
  let reqId = 0;

  function renderEmpty() {
    previewEl.innerHTML = `
      <div class="fp-empty">
        <div class="fp-empty-icon">👁️</div>
        <div class="fp-empty-text">Klik file untuk preview</div>
      </div>
    `;
  }

  renderEmpty();

  async function show({ name, size, buffer, type } = {}) {
    if (!name || !buffer) {
      clear();
      return;
    }

    const key = `${name}:${size}`;
    if (currentKey === key) return; // sudah tampil
    currentKey = key;
    const myReqId = ++reqId;

    previewEl.innerHTML = `<div class="fp-loading">⏳ Loading preview…</div>`;

    let thumb;
    try {
      thumb = await generateThumbnail(name, buffer, size);
    } catch (e) {
      thumb = { url: null, triangles: 0, error: e.message };
    }

    if (myReqId !== reqId) return; // stale — user klik file lain

    const isSCAD = /\.scad$/i.test(name);
    const isSTL = /\.stl$/i.test(name);

    let bodyHtml = "";
    if (thumb.error) {
      bodyHtml = `<div class="fp-error">⚠ ${escapeHtml(thumb.error)}</div>`;
    } else if (isSTL && thumb.url) {
      bodyHtml = `<img class="fp-thumb" src="${thumb.url}" alt="${escapeHtml(name)}" />`;
    } else if (isSCAD && thumb.text) {
      bodyHtml = `<pre class="fp-code">${escapeHtml(thumb.text)}</pre>`;
    }

    const metaParts = [`<b>${escapeHtml(name)}</b>`];
    metaParts.push(`${(size / 1024).toFixed(1)} KB`);
    if (isSTL && thumb.triangles > 0) {
      metaParts.push(`${thumb.triangles.toLocaleString("id-ID")} tri`);
    }

    previewEl.innerHTML = `
      <div class="fp-body">
        ${bodyHtml}
        <div class="fp-meta">${metaParts.join(" · ")}</div>
      </div>
    `;
  }

  function clear() {
    currentKey = null;
    reqId++;
    renderEmpty();
  }

  return { show, clear };
}
