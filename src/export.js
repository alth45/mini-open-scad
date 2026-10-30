import * as THREE from 'three'; // <-- TAMBAHKAN BARIS INI
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';
import { downloadBlob, timestampForFile } from './utils.js';
import { cleanGeometry } from './evaluator/mesh-utils.js';
import { isManifoldReady } from './evaluator/manifold-engine.js';
import { zipSync, strToU8 } from 'fflate';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

function emptyModelError() {
    return { ok: false, error: 'Tidak ada model untuk diekspor. Render dulu.' };
}

function ensureModel(modelRoot) {
    return (!modelRoot || modelRoot.children.length === 0)
        ? emptyModelError()
        : null;
}

function makeFileName(ext) {
    return `model_${timestampForFile()}.${ext}`;
}

/** 
 * Jika Manifold gagal, kita bersihkan manual geometrinya (weld vertices).
 * Jika Manifold aktif, langsung export karena geometri sudah sempurna.
 */
function prepareRootForExport(root) {
    root.updateMatrixWorld(true);
    
    // Jika Manifold aktif, kita tidak perlu bersihkan manual lagi (jauh lebih cepat)
    if (isManifoldReady()) {
        return root; 
    }

    // Fallback untuk three-bvh-csg: Bersihkan geometri
    const cloned = root.clone(true);
    cloned.traverse(o => {
        if (o.isMesh && o.geometry) {
            o.geometry = cleanGeometry(o.geometry, { keepNormal: false });
            o.matrixAutoUpdate = false;
        }
    });
    cloned.updateMatrixWorld(true);
    return cloned;
}

/* ---------- STL (binary) ---------- */
export function exportSTL(modelRoot) {
    const err = ensureModel(modelRoot);
    if (err) return err;
    try {
        const exportRoot = prepareRootForExport(modelRoot);
        const data = new STLExporter().parse(exportRoot, { binary: true });
        const blob = new Blob([data], { type: 'model/stl' });
        const name = makeFileName('stl');
        downloadBlob(blob, name);
        return { ok: true, name, size: blob.size };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/* ---------- OBJ (Wavefront) ---------- */
export function exportOBJ(modelRoot) {
    const err = ensureModel(modelRoot);
    if (err) return err;
    try {
        const exportRoot = prepareRootForExport(modelRoot);
        const str = new OBJExporter().parse(exportRoot);
        const blob = new Blob([str], { type: 'text/plain' });
        const name = makeFileName('obj');
        downloadBlob(blob, name);
        return { ok: true, name, size: blob.size };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/* ---------- glTF / GLB ---------- */
export async function exportGLTF(modelRoot, { binary = false } = {}) {
    const err = ensureModel(modelRoot);
    if (err) return err;
    try {
        const exportRoot = prepareRootForExport(modelRoot);
        const result = await new Promise((resolve, reject) => {
            new GLTFExporter().parse(
                exportRoot,
                resolve,
                reject,
                { binary, onlyVisible: true, embedImages: true }
            );
        });

        if (binary) {
            const blob = new Blob([result], { type: 'model/gltf-binary' });
            const name = makeFileName('glb');
            downloadBlob(blob, name);
            return { ok: true, name, size: blob.size };
        }

        const json = JSON.stringify(result, null, 2);
        const blob = new Blob([json], { type: 'model/gltf+json' });
        const name = makeFileName('gltf');
        downloadBlob(blob, name);
        return { ok: true, name, size: blob.size };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/* ---------- PLY (binary) ---------- */
export function exportPLY(modelRoot, { binary = true } = {}) {
    const err = ensureModel(modelRoot);
    if (err) return err;
    try {
        const exportRoot = prepareRootForExport(modelRoot);
        let result = null;
        new PLYExporter().parse(
            exportRoot,
            (res) => { result = res; },
            { binary, excludeAttributes: ['uv'] }
        );
        if (!result) return { ok: false, error: 'PLY exporter gagal menghasilkan data' };
        const blob = new Blob([result], { type: 'application/octet-stream' });
        const name = makeFileName('ply');
        downloadBlob(blob, name);
        return { ok: true, name, size: blob.size };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/* ---------- 3MF (3D Manufacturing Format) ---------- */
export function export3MF(modelRoot) {
    const err = ensureModel(modelRoot);
    if (err) return err;
    try {
        modelRoot.updateMatrixWorld(true);

        const vertices = [];
        const triangles = [];
        let vertexOffset = 0;
        
        const v = new THREE.Vector3();

        modelRoot.traverse(o => {
            if (!o.isMesh || !o.geometry) return;
            
            // 1. KUNCI PERBAIKAN: Weld vertices agar tidak menjadi "Triangle Soup"
            let geo = o.geometry.clone();
            if (geo.attributes.normal) geo.deleteAttribute('normal');
            if (geo.attributes.uv) geo.deleteAttribute('uv');
            if (geo.attributes.color) geo.deleteAttribute('color');
            
            try {
                geo = mergeVertices(geo, 1e-4);
            } catch (e) {
                console.warn('[3MF] Weld failed:', e);
            }

            const pos = geo.attributes.position;
            const idx = geo.index;
            
            for (let i = 0; i < pos.count; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
                vertices.push(`<vertex x="${v.x.toFixed(4)}" y="${v.y.toFixed(4)}" z="${v.z.toFixed(4)}" />`);
            }
            
            if (idx) {
                for (let i = 0; i < idx.count; i += 3) {
                    triangles.push(`<triangle v1="${idx.getX(i) + vertexOffset}" v2="${idx.getX(i+1) + vertexOffset}" v3="${idx.getX(i+2) + vertexOffset}" />`);
                }
            } else {
                for (let i = 0; i < pos.count; i += 3) {
                    triangles.push(`<triangle v1="${i + vertexOffset}" v2="${i+1 + vertexOffset}" v3="${i+2 + vertexOffset}" />`);
                }
            }
            
            vertexOffset += pos.count;
        });

        if (vertices.length === 0) return { ok: false, error: 'Model kosong' };

        // 2. Susun XML 3D Model
        const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          ${vertices.join('\n')}
        </vertices>
        <triangles>
          ${triangles.join('\n')}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

        // 3. File wajib standar 3MF (Content Types & Relationships)
        const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;

        const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

        // 4. Kompres ke format ZIP (.3mf)
        const zipped = zipSync({
            '[Content_Types].xml': strToU8(contentTypesXml),
            '_rels/.rels': strToU8(relsXml),
            '3D/3dmodel.model': strToU8(modelXml)
        });

        const blob = new Blob([zipped], { type: 'model/3mf' });
        const name = makeFileName('3mf');
        downloadBlob(blob, name);
        return { ok: true, name, size: blob.size };

    } catch (e) {
        return { ok: false, error: e.message };
    }
}