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

/* ---------- 3MF (3D Manufacturing Format) Multi-Color PrusaSlicer Compatible ---------- */
export function export3MF(modelRoot) {
    const err = ensureModel(modelRoot);
    if (err) return err;
    try {
        modelRoot.updateMatrixWorld(true);

        let objectsXml = '';
        let buildXml = '';
        let prusaModelConfigXml = '';
        let colorList = [];
        
        let objectId = 2; // ID 1 untuk basematerials
        let extruderId = 1; 
        const colorMap = new Map(); 
        const v = new THREE.Vector3();
        
        // 1. Kumpulkan warna unik dan petakan ke extruder
        const meshes = [];
        modelRoot.traverse(o => {
            if (!o.isMesh || !o.geometry) return;
            
            let colorHex = '#CCCCCC';
            if (o.material && o.material.color) {
                colorHex = '#' + o.material.color.getHexString().toUpperCase();
            }
            
            if (!colorMap.has(colorHex)) {
                colorMap.set(colorHex, extruderId);
                colorList.push(colorHex);
                extruderId++;
            }
            meshes.push({ mesh: o, colorHex });
        });

        if (meshes.length === 0) return { ok: false, error: 'Model kosong' };

        // 2. Bangun XML untuk setiap objek
        for (const item of meshes) {
            const o = item.mesh;
            const pindex = colorMap.get(item.colorHex) - 1; // 0-based index
            const exId = colorMap.get(item.colorHex); // 1-based untuk PrusaSlicer
            
            let geo = o.geometry.clone();
            if (geo.attributes.normal) geo.deleteAttribute('normal');
            if (geo.attributes.uv) geo.deleteAttribute('uv');
            if (geo.attributes.color) geo.deleteAttribute('color');
            
            try { geo = mergeVertices(geo, 1e-4); } catch (e) {}

            const pos = geo.attributes.position;
            const idx = geo.index;
            
            let objVertices = '';
            for (let i = 0; i < pos.count; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
                objVertices += `        <vertex x="${v.x.toFixed(4)}" y="${v.y.toFixed(4)}" z="${v.z.toFixed(4)}" />\n`;
            }
            
            let objTriangles = '';
            let triCount = 0;
            if (idx) {
                for (let i = 0; i < idx.count; i += 3) {
                    objTriangles += `        <triangle v1="${idx.getX(i)}" v2="${idx.getX(i+1)}" v3="${idx.getX(i+2)}" />\n`;
                    triCount++;
                }
            } else {
                for (let i = 0; i < pos.count; i += 3) {
                    objTriangles += `        <triangle v1="${i}" v2="${i+1}" v3="${i+2}" />\n`;
                    triCount++;
                }
            }
            
            // Tulis Object 3MF
            objectsXml += `  <object id="${objectId}" type="model" pid="1" pindex="${pindex}">\n    <mesh>\n      <vertices>\n${objVertices}      </vertices>\n      <triangles>\n${objTriangles}      </triangles>\n    </mesh>\n  </object>\n`;
            
            // Tulis Build Item dengan atribut slic3rpe:extruder
            buildXml += `    <item objectid="${objectId}" slic3rpe:extruder="${exId}" />\n`;
            
            // Tulis Metadata Konfigurasi PrusaSlicer
            prusaModelConfigXml += `  <object id="${objectId}" instances_count="1">\n    <volume firstid="0" lastid="${triCount - 1}">\n      <metadata type="volume" key="extruder" value="${exId}"/>\n    </volume>\n    <metadata type="object" key="extruder" value="${exId}"/>\n  </object>\n`;
            
            objectId++;
        }

        // 3. Bangun XML Model Utama
        const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
  <resources>
    <basematerials id="1">
${colorList.map((c, i) => `      <base name="color_${i}" displaycolor="${c}FF" />`).join('\n')}
    </basematerials>
${objectsXml}  </resources>
  <build>
${buildXml}  </build>
</model>`;

        // 4. Bangun Metadata PrusaSlicer
        const prusaModelConfig = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${prusaModelConfigXml}</config>`;
        
        // Daftar warna untuk PrusaSlicer
        const colorsStr = colorList.join(';');
        const prusaPeConfig = `filament_colour = ${colorsStr}\nextruder_colour = ${colorsStr}\n`;

        // 5. File Wajib 3MF
        const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="config" ContentType="text/xml" />
</Types>`;

        const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

        // 6. Gabungkan semua ke dalam ZIP
        const zipped = zipSync({
            '[Content_Types].xml': strToU8(contentTypesXml),
            '_rels/.rels': strToU8(relsXml),
            '3D/3dmodel.model': strToU8(modelXml),
            'Metadata/Slic3r_PE_model.config': strToU8(prusaModelConfig),
            'Metadata/Slic3r_PE.config': strToU8(prusaPeConfig)
        });

        const blob = new Blob([zipped], { type: 'model/3mf' });
        const name = makeFileName('3mf');
        downloadBlob(blob, name);
        return { ok: true, name, size: blob.size };

    } catch (e) {
        return { ok: false, error: e.message };
    }
}