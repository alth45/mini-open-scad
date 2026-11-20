import { store } from "../store/app-store.js";
import { CONFIG, CLOUD_CONFIG } from "../config.js"; // ← merged (fix duplicate)
import { parseParams, mergeParamValues } from "../core/params.js";
import { buildModel, deserializeModel } from "../viewer/model.js";
import { extractImportNames } from "../core/ast-utils.js";
import { loadFiles } from "../files/file-store.js";
import { initManifold } from "../evaluator/manifold-engine.js";
import { formatScad } from "../format.js";
import { setStatus, toast } from "../ui/status.js";
import { log } from "../ui/console.js";
import { formatError } from "../utils.js";
import { saveTabs } from "../storage.js";
import { profiler } from "../profiler.js";
import { backupTab } from "../files/cloud-storage.js";

export function initRenderController(deps) {
  const { editor, viewer, workerClient, paramsPanel, btnParams } = deps;

  // ✨ Closure getter — selalu baca `tabManager` terkini.
  //    Fallback ke `deps.tabManager` untuk backward-compat.
  const getTabManager = deps.getTabManager || (() => deps.tabManager);

  let saveTimer = null;
  let autoRenderTimer = null;
  let _lastError = null; // error render terakhir untuk AI Code Fixer
  let _cloudBackupTimer = null;
  const _lastBackedUpByTab = new Map(); // tabId → last code (per-tab dedup)

  /* ============================================================
     Refresh params panel dari AST
     ============================================================ */
  function refreshParams() {
    const params = parseParams(editor.getValue());
    const merged = mergeParamValues(params, store.getState().paramValues);
    store.dispatch({ type: "SET_PARAMS", payload: merged });
    // ❌ TIDAK clear _lastError di sini — biarkan error render terakhir persist
    getTabManager()?.updateActiveSilent({ paramValues: merged });
    paramsPanel.setParams(params, merged);
    btnParams.classList.toggle("has-params", params.length > 0);
  }

  /* ============================================================
     Save (localStorage) + Cloudinary backup (debounced)
     ============================================================ */
  function saveNow() {
    const tm = getTabManager();

    // 1. Save ke localStorage (primary, offline-ready)
    if (tm) {
      saveTabs(tm.tabs, tm.activeId, store.getState().previewMode);
    }

    // 2. Cloudinary backup (debounced 10s, di background)
    const activeTab = tm?.active;
    if (
      activeTab &&
      CLOUD_CONFIG.cloudName !== "GANTI_DENGAN_CLOUD_NAME_ANDA"
    ) {
      clearTimeout(_cloudBackupTimer);
      _cloudBackupTimer = setTimeout(async () => {
        // Re-read tabManager saat timer fires (bisa berubah / null)
        const currentTm = getTabManager();
        const tab = currentTm?.active;
        if (!tab) return;

        // Per-tab dedup: skip kalau code tab ini tidak berubah
        const lastCode = _lastBackedUpByTab.get(tab.id);
        if (tab.code === lastCode) return;
        _lastBackedUpByTab.set(tab.id, tab.code);

        try {
          const entry = await backupTab(tab);
          if (entry) {
            log(
              "info",
              `☁ Backup uploaded (${(entry.size / 1024).toFixed(1)} KB)`,
            );
          }
        } catch (e) {
          console.warn("[cloud] backup failed:", e);
          // Silent — backup adalah background, jangan ganggu user
        }
      }, CLOUD_CONFIG.autoBackupDelayMs);
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, CONFIG.saveDelay);
  }

  function scheduleAutoRender(delay = null) {
    if (!store.getState().autoRender) return;
    clearTimeout(autoRenderTimer);
    const wait = delay !== null ? delay : CONFIG.autoRenderDelay;
    autoRenderTimer = setTimeout(doRender, wait);
  }

  /* ============================================================
     Render pipeline
     ============================================================ */
  async function doRender(opts = {}) {
    const {
      skipParams = false,
      skipFit = false,
      quiet = false,
      throwOnError = false,
    } = opts;
    if (!skipParams) refreshParams();
    const code = editor.getValue();
    const currentState = store.getState();

    if (!quiet) setStatus("rendering", "Rendering…", true);
    const tStart = performance.now();

    try {
      let result,
        workerRoundtrip = null;
      if (workerClient) {
        const data = await workerClient.run(
          code,
          currentState.paramValues,
          currentState.previewMode,
        );
        workerRoundtrip = data.workerRoundtrip ?? null;
        const tDeser = performance.now();
        result = {
          root: deserializeModel(data.meshes),
          ms: data.ms,
          breakdown: {
            ...(data.breakdown || {}),
            deserialize: performance.now() - tDeser,
          },
          opTimings: data.opTimings || {},
          meshCount: data.meshCount,
          triCount: data.triCount,
          vertexCount: data.vertexCount || 0,
          warnings: data.warnings || [],
          echoes: data.echoes || [],
          shapes2d: data.shapes2d || [],
        };
      } else {
        await new Promise((r) => requestAnimationFrame(r));
        await initManifold();
        const importNames = extractImportNames(code);
        const files =
          importNames.length > 0 ? await loadFiles(importNames) : {};
        result = buildModel(
          code,
          currentState.paramValues,
          files,
          currentState.previewMode,
          new Map(),
        );
      }

      viewer.setModelRoot(result.root);
      if (!skipFit) viewer.fitToObject(result.root);
      if (!quiet) setStatus("ready", "Ready", false);

      // ✨ Clear error HANYA saat render sukses
      _lastError = null;

      store.dispatch({ type: "SET_LAST_SUCCESS", payload: code });
      store.dispatch({
        type: "SET_LAST_2D_SHAPES",
        payload: result.shapes2d || [],
      });

      if (!quiet) {
        profiler.record({
          timestamp: Date.now(),
          totalMs: performance.now() - tStart,
          workerRoundtrip,
          breakdown: result.breakdown,
          opTimings: result.opTimings,
          meshCount: result.meshCount,
          triCount: result.triCount,
          vertexCount: result.vertexCount,
          error: null,
          preview: code.replace(/\s+/g, " ").slice(0, 80),
        });

        log(
          "ok",
          `Rendered in ${result.ms.toFixed(0)} ms · ${result.meshCount} mesh · ${Math.round(result.triCount)} triangle`,
        );
        if (currentState.previewMode && result.ms > 500) {
          log(
            "warn",
            "👁 Preview mode aktif — $fn mungkin direduksi. Tekan F6 untuk render final.",
          );
        }
        for (const w of result.warnings) log("warn", w);
        for (const e of result.echoes) log("info", e);
      }
    } catch (err) {
      if (err && err.name === "CancelledError") {
        if (throwOnError) throw err;
        return;
      }
      if (!quiet) {
        const formatted = formatError(err, code);
        _lastError = formatted; // ✨ capture untuk AI Code Fixer
        setStatus("error", "Error", false);
        log("error", formatted);
        toast("✖ " + (err.message || "Render gagal"));
      }
      if (throwOnError) throw err;
    }
  }

  /* ============================================================
     Format code
     ============================================================ */
  function doFormat() {
    const current = editor.getValue();
    if (!current.trim()) {
      toast("⚠ Editor kosong");
      return;
    }
    try {
      const formatted = formatScad(current);
      if (formatted === current) toast("✓ Sudah rapi");
      else {
        editor.setValue(formatted);
        getTabManager()?.updateActiveSilent({ code: formatted });
        scheduleSave();
        toast("✨ Code formatted");
      }
      editor.focus();
    } catch (e) {
      // ❌ JANGAN sentuh _lastError — error format bukan error render
      log("error", "Format gagal: " + e.message);
      toast("✖ Format gagal");
    }
  }

  /* ============================================================
     Go to line (prompt)
     ============================================================ */
  function goToLine() {
    const el = document.getElementById("editor");
    const lines = el.value.split("\n");
    const total = lines.length;
    const input = prompt(`Go to line (1–${total}):`, "");
    if (!input) return;
    const ln = Math.max(1, Math.min(total, parseInt(input, 10) || 1));
    let offset = 0;
    for (let i = 0; i < ln - 1; i++) offset += lines[i].length + 1;
    el.focus();
    el.setSelectionRange(offset, offset + lines[ln - 1].length);
    el.dispatchEvent(new Event("scroll"));
  }

  return {
    refreshParams,
    saveNow,
    scheduleSave,
    scheduleAutoRender,
    doRender,
    doFormat,
    goToLine,
    getLastError: () => _lastError,
  };
}
