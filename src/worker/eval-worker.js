import { buildModel, serializeModel } from '../viewer/model.js';
import { loadFiles } from '../files/file-store.js';
import { extractImportNames } from '../core/ast-utils.js';
import { preloadOpenTypeFonts } from '../evaluator/opentype-fonts.js';


console.log('[eval-worker] module imports resolved');

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

        const importNames = extractImportNames(code);
        const files = importNames.length > 0 ? await loadFiles(importNames) : {};

        const result = buildModel(code, paramValues, files, previewMode);

        const transferables = [];
        for (const m of result.meshes) {
            transferables.push(m.positions.buffer);
            if (m.normals) transferables.push(m.normals.buffer);
        }

        self.postMessage({
            ok: true,
            meshes: result.meshes,
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