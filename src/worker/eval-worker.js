import { buildModel, serializeModel } from "../viewer/model.js";
import { loadFiles } from "../files/file-store.js";
import { extractImportNames, extractScadImports } from "../core/ast-utils.js";
import { preloadOpenTypeFonts } from "../evaluator/opentype-fonts.js";
import { initManifold } from "../evaluator/manifold-engine.js";
import { tokenize } from "../core/tokenizer.js";
import { Parser } from "../core/parser.js";

let isReady = false;
let currentRequestId = null;
let cancelFlag = false;

// Inisialisasi sekali saat Worker dimuat
(async () => {
  try {
    await preloadOpenTypeFonts();
    await initManifold();
    isReady = true;
    self.postMessage({ type: "ready" });
  } catch (err) {
    self.postMessage({ type: "init-error", error: err.message });
  }
})();

async function loadScadTree(code, cache) {
  let userAst;
  try {
    const tokens = tokenize(code);
    userAst = new Parser(tokens).parseProgram();
  } catch {
    return;
  }
  const visited = new Set();
  await loadScadImportsRecursive(userAst, cache, visited);
}

async function loadScadImportsRecursive(ast, cache, visited) {
  const imports = extractScadImports(ast);
  for (const file of imports) {
    if (visited.has(file) || cache.has(file)) continue;
    visited.add(file);
    let entry;
    try {
      const files = await loadFiles([file]);
      const buf = files[file];
      if (!buf) {
        entry = { ast: null, error: "File tidak ditemukan" };
      } else {
        const text = new TextDecoder().decode(buf);
        const innerAst = new Parser(tokenize(text)).parseProgram();
        entry = { ast: innerAst, error: null };
      }
    } catch (e) {
      entry = { ast: null, error: e.message };
    }
    cache.set(file, entry);
    if (entry.ast) await loadScadImportsRecursive(entry.ast, cache, visited);
  }
}

self.onmessage = async (e) => {
  const msg = e.data || {};

  if (msg.type === "cancel") {
    cancelFlag = true;
    return;
  }

  if (msg.type !== "render") return;
  if (!isReady) {
    self.postMessage({
      type: "error",
      requestId: msg.requestId,
      error: { message: "Worker belum siap" },
    });
    return;
  }

  const { code, paramValues, previewMode, requestId } = msg;
  currentRequestId = requestId;
  cancelFlag = false;

  if (typeof code !== "string") {
    self.postMessage({
      type: "error",
      requestId,
      error: { message: "Code harus string", isScad: false },
    });
    return;
  }

  try {
    const importNames = extractImportNames(code);
    const files = importNames.length > 0 ? await loadFiles(importNames) : {};

    const scadCache = new Map();
    await loadScadTree(code, scadCache);

    // Gunakan cancelChecker agar loop bisa berhenti jika di-cancel
    const isCancelled = () => cancelFlag || currentRequestId !== requestId;
    const result = buildModel(
      code,
      paramValues,
      files,
      previewMode,
      scadCache,
      isCancelled,
    );

    if (isCancelled()) return; // Jangan kirim hasil jika sudah di-cancel

    const transferables = [];
    for (const m of result.meshes) {
      transferables.push(m.positions.buffer);
      if (m.normals) transferables.push(m.normals.buffer);
    }

    self.postMessage(
      {
        type: "done",
        requestId,
        meshes: result.meshes,
        ms: result.ms,
        breakdown: result.breakdown,
        opTimings: result.opTimings,
        meshCount: result.meshCount,
        triCount: result.triCount,
        vertexCount: result.vertexCount,
        warnings: result.warnings,
        echoes: result.echoes,
        shapes2d: result.shapes2d,
      },
      transferables,
    );

    // Bersihkan resource setelah transfer
    result.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
  } catch (err) {
    self.postMessage({
      type: "error",
      requestId,
      error: {
        name: err?.name || "Error",
        message: err?.message || String(err),
        line: err?.line || 0,
        col: err?.col || 0,
        hint: err?.hint || null,
        isScad: err?.name === "SCADError",
      },
    });
  }
};
