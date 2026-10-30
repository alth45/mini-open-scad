import { buildModel, serializeModel } from '../viewer/model.js';
import { loadFiles } from '../files/file-store.js';
import { extractImportNames } from '../core/ast-utils.js';
import { preloadOpenTypeFonts } from '../evaluator/opentype-fonts.js';
import { extractScadImports } from '../core/ast-utils.js';
import { tokenize } from '../core/tokenizer.js';
import { Parser } from '../core/parser.js';
import { initManifold } from '../evaluator/manifold-engine.js';

console.log('[eval-worker] module imports resolved');

/* ============================================================
   Pre-load semua file .scad yang direferensikan (rekursif)
   ============================================================ */
async function loadScadTree(code, cache) {
    let userAst;
    try {
        const tokens = tokenize(code);
        userAst = new Parser(tokens).parseProgram();
    } catch {
        return;   /* syntax error di user code — biar buildModel yang handle */
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
                entry = { ast: null, error: 'File tidak ditemukan di storage' };
            } else {
                const text = new TextDecoder().decode(buf);
                const tokens = tokenize(text);
                const innerAst = new Parser(tokens).parseProgram();
                entry = { ast: innerAst, error: null };
            }
        } catch (e) {
            entry = { ast: null, error: e.message || String(e) };
        }
        cache.set(file, entry);

        if (entry.ast) {
            await loadScadImportsRecursive(entry.ast, cache, visited);
        }
    }
}

self.onmessage = async (e) => {
    const { code, paramValues, previewMode } = e.data || {};
    if (typeof code !== 'string') {
        self.postMessage({
            ok: false,
            error: { name: 'Error', message: 'Invalid payload', line: 0, isScad: false }
        });
        return;
    }

    try {
        /* Pre-load all OpenType fonts (idempotent — di-cache) */
        await preloadOpenTypeFonts();
        await initManifold();

        const importNames = extractImportNames(code);
        const files = importNames.length > 0 ? await loadFiles(importNames) : {};

        /* Pre-load semua .scad yang direferensikan include/use */
        const scadCache = new Map();
        await loadScadTree(code, scadCache);

        const result = buildModel(code, paramValues, files, previewMode, scadCache);

        const transferables = [];
        for (const m of result.meshes) {
            transferables.push(m.positions.buffer);
            if (m.normals) transferables.push(m.normals.buffer);
        }

        self.postMessage({
            ok: true,
            meshes: result.meshes,
            shapes2d: result.shapes2d,
            ms: result.ms,
            breakdown: result.breakdown,
            opTimings: result.opTimings,
            meshCount: result.meshCount,
            triCount: result.triCount,
            vertexCount: result.vertexCount,
            warnings: result.warnings,
            echoes: result.echoes
        }, transferables);

        result.root.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose?.();
        });
    } catch (err) {
        self.postMessage({
            ok: false,
            error: {
                name: err?.name || 'Error',
                message: err?.message || String(err),
                line: err?.line || 0,
                col: err?.col || 0,
                hint: err?.hint || null,
                isScad: err?.name === 'SCADError'
            }
        });
    }
};

console.log('[eval-worker] script fully evaluated, sending ready signal');
self.postMessage({ type: 'ready' });