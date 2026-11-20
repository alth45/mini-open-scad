import { parseSvgToShapes } from "../files/svg-to-polygon.js";
import { parseDxfToShapes } from "../files/dxf-to-polygon.js";
import { shapesToScad } from "../files/vector-to-code.js";
import { createTab } from "../tabs.js";
import { escapeHtml } from "../utils.js";
import { log } from "../ui/console.js";
import { toast } from "../ui/status.js";

export function initImportVectorUI({ editor, tabManager, saveNow, doRender }) {
  const topbarScroll = document.getElementById("topbar-scroll");
  if (!topbarScroll) return null;

  /* ---------- Topbar button ---------- */
  const btn = document.createElement("button");
  btn.id = "btnImportVector";
  btn.title = "Import SVG/DXF → polygon()";
  btn.innerHTML = '📥 <span class="lbl">SVG/DXF</span>';
  const snippetBtn = document.getElementById("btnSnippets");
  if (snippetBtn && snippetBtn.parentNode === topbarScroll) {
    topbarScroll.insertBefore(btn, snippetBtn.nextSibling);
  } else {
    topbarScroll.appendChild(btn);
  }
  btn.addEventListener("click", openModal);

  /* ---------- Modal ---------- */
  const modal = document.createElement("div");
  modal.id = "importVectorModal";
  modal.className = "modal-backdrop hidden";
  modal.innerHTML = `
    <div class="modal import-vector-modal">
      <div class="modal-title">
        <span>📥 Import Vector</span>
        <button id="ivClose" class="modal-x">✕</button>
      </div>
      <div class="modal-body">
        <p class="iv-hint">
          Convert <code>.svg</code> atau <code>.dxf</code> menjadi <code>polygon()</code>.
          Kurva di-discretize otomatis. Wrap hasilnya dengan <code>linear_extrude()</code> untuk 3D.
        </p>
        <div class="iv-drop" id="ivDrop">
          <div class="iv-drop-icon">📂</div>
          <div class="iv-drop-text">Drag file ke sini, atau:</div>
          <button id="ivPick" class="primary">Pilih file…</button>
          <input type="file" id="ivFile" accept=".svg,.dxf,image/svg+xml,application/dxf" hidden />
        </div>
        <div class="iv-options">
          <div class="iv-row">
            <label>Ukuran maks (mm)</label>
            <input type="number" id="ivMaxSize" value="100" min="1" max="500" step="1" />
          </div>
          <div class="iv-row">
            <label>Toleransi sample</label>
            <select id="ivTolerance">
              <option value="0.3">0.3 — halus (banyak point)</option>
              <option value="0.5" selected>0.5 — standard</option>
              <option value="1.0">1.0 — ringan</option>
              <option value="2.0">2.0 — very coarse</option>
            </select>
          </div>
        </div>
        <div id="ivPreview" class="iv-preview hidden">
          <div id="ivPreviewInfo" class="iv-preview-info"></div>
          <pre id="ivPreviewCode" class="iv-preview-code"></pre>
        </div>
        <div id="ivError" class="iv-error hidden"></div>
      </div>
      <div class="modal-footer">
        <button id="ivNewTab" disabled>⊕ New tab</button>
        <button id="ivInsert" class="primary" disabled>➤ Insert</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const $ = (s) => modal.querySelector(s);
  const dropEl = $("#ivDrop");
  const fileInput = $("#ivFile");
  const maxSizeInput = $("#ivMaxSize");
  const toleranceInput = $("#ivTolerance");
  const previewEl = $("#ivPreview");
  const previewInfoEl = $("#ivPreviewInfo");
  const previewCodeEl = $("#ivPreviewCode");
  const errorEl = $("#ivError");
  const insertBtn = $("#ivInsert");
  const newTabBtn = $("#ivNewTab");

  let currentFile = null;
  let currentScad = null;
  let currentMeta = null;

  /* ---------- Open / close ---------- */
  function openModal() {
    modal.classList.remove("hidden");
    resetState();
  }
  function closeModal() {
    modal.classList.add("hidden");
  }
  function resetState() {
    currentFile = null;
    currentScad = null;
    currentMeta = null;
    fileInput.value = "";
    previewEl.classList.add("hidden");
    errorEl.classList.add("hidden");
    insertBtn.disabled = true;
    newTabBtn.disabled = true;
  }

  /* ---------- Process file ---------- */
  async function processFile(file) {
    if (!file) return;
    errorEl.classList.add("hidden");
    previewEl.classList.add("hidden");
    insertBtn.disabled = true;
    newTabBtn.disabled = true;

    const name = file.name.toLowerCase();
    const isSvg = name.endsWith(".svg");
    const isDxf = name.endsWith(".dxf");
    if (!isSvg && !isDxf) {
      showError("File harus .svg atau .dxf");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showError("File terlalu besar (>5 MB)");
      return;
    }

    try {
      toast("⏳ Parsing…");
      const text = await file.text();
      const opts = {
        maxSize: parseFloat(maxSizeInput.value) || 100,
        tolerance: parseFloat(toleranceInput.value) || 0.5,
      };

      const result = isSvg
        ? await parseSvgToShapes(text, opts)
        : await parseDxfToShapes(text, opts);

      currentFile = file;
      currentMeta = result;
      currentScad = shapesToScad(result.shapes);

      if (!currentScad)
        throw new Error("Tidak ada shape valid yang di-extract");

      const shapeCount = result.shapes.length;
      const totalPts = result.shapes.reduce((s, sh) => s + sh.points.length, 0);

      previewInfoEl.innerHTML =
        `<div><b>${escapeHtml(file.name)}</b></div>` +
        `<div>${shapeCount} shape${shapeCount > 1 ? "s" : ""} · ${totalPts} points</div>` +
        `<div>Bounding: ${result.width} × ${result.height} mm</div>`;

      previewCodeEl.textContent =
        currentScad.length > 2000
          ? currentScad.slice(0, 2000) + "\n// … (truncated preview)"
          : currentScad;

      previewEl.classList.remove("hidden");
      insertBtn.disabled = false;
      newTabBtn.disabled = false;
      log("info", `📥 ${file.name}: ${shapeCount} shapes, ${totalPts} points`);
      toast(`✅ ${shapeCount} shape${shapeCount > 1 ? "s" : ""} ready`);
    } catch (e) {
      showError(e.message || String(e));
      log("error", "Import vector gagal: " + e.message);
    }
  }

  function showError(msg) {
    errorEl.textContent = "✖ " + msg;
    errorEl.classList.remove("hidden");
    toast("✖ " + msg);
  }

  /* ---------- Actions ---------- */
  function insertAtCursor() {
    if (!currentScad) return;
    const ta = document.getElementById("editor");
    if (!ta) return;
    const cursor = ta.selectionStart;
    const val = ta.value;
    const insertion = `\n${currentScad}\n`;
    ta.value = val.slice(0, cursor) + insertion + val.slice(cursor);
    ta.selectionStart = ta.selectionEnd = cursor + insertion.length;
    ta.dispatchEvent(new Event("input"));
    toast("✅ Inserted");
    closeModal();
  }

  function insertNewTab() {
    if (!currentScad || !tabManager) return;
    const baseName = (currentFile?.name || "Import").replace(/\.[^.]+$/, "");
    const tabName = `📥 ${baseName}`.slice(0, 40);
    const code =
      `// Imported from ${currentFile?.name || "file"}\n` +
      `// ${currentMeta?.shapes?.length || 0} shape(s) · ${currentMeta?.width}×${currentMeta?.height}mm\n\n` +
      `linear_extrude(height = 3)\n${indent(currentScad)}`;
    const tab = createTab(tabName, code);
    tabManager.add(tab);
    saveNow?.();
    doRender?.();
    toast("✅ Tab baru dibuat");
    closeModal();
  }

  function indent(s) {
    return s
      .split("\n")
      .map((l) => "    " + l)
      .join("\n");
  }

  /* ---------- Events ---------- */
  $("#ivClose").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  $("#ivPick").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  });

  // Drag-drop ke drop zone di modal
  dropEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropEl.classList.add("drag-over");
  });
  dropEl.addEventListener("dragleave", () =>
    dropEl.classList.remove("drag-over"),
  );
  dropEl.addEventListener("drop", (e) => {
    e.preventDefault();
    dropEl.classList.remove("drag-over");
    const f = e.dataTransfer?.files?.[0];
    if (f) processFile(f);
  });

  // Options change → re-parse
  maxSizeInput.addEventListener("change", () => {
    if (currentFile) processFile(currentFile);
  });
  toleranceInput.addEventListener("change", () => {
    if (currentFile) processFile(currentFile);
  });

  insertBtn.addEventListener("click", insertAtCursor);
  newTabBtn.addEventListener("click", insertNewTab);

  return { open: openModal, close: closeModal, processFile };
}
