import { buildModel, serializeModel } from '../viewer/model.js';
import { loadFiles } from '../files/file-store.js';
import { extractImportNames } from '../core/ast-utils.js';

console.log('[eval-worker] module imports resolved');

self.onmessage = async (e) => {
    console.log('[eval-worker] onmessage fired, code length =', e.data?.code?.length);

    const { code, paramValues } = e.data || {};
    if (typeof code !== 'string') {
        self.postMessage({
            ok: false,
            error: { name: 'Error', message: 'Invalid payload', line: 0, isScad: false }
        });
        return;
    }

    try {
        /* Pre-load hanya file yang direferensikan lewat import("...") */
        const importNames = extractImportNames(code);
        const files = importNames.length > 0 ? await loadFiles(importNames) : {};

        const result = buildModel(code, paramValues, files);
        const meshes = serializeModel(result.root);

        const transferables = [];
        for (const m of meshes) {
            transferables.push(m.positions.buffer);
            if (m.normals) transferables.push(m.normals.buffer);
        }

        self.postMessage({
            ok: true,
            meshes,
            ms: result.ms,
            meshCount: result.meshCount,
            triCount: result.triCount,
            warnings: result.warnings,
            echoes: result.echoes || []
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