import * as THREE from 'three';
import { tokenize } from '../core/tokenizer.js';
import { Parser } from '../core/parser.js';
import { EvalContext, makeRootScope, evalStatements } from '../evaluator/index.js';
import { applyParams } from '../evaluator/params.js';
import { CONFIG } from '../config.js';

export function buildModel(code, paramValues, files = null, previewMode = true, scadCache = null) {
    const tStart = performance.now();

    /* --- tokenize --- */
    const t0 = performance.now();
    const tokens = tokenize(code);
    const tTokenize = performance.now() - t0;

    /* --- parse --- */
    const t1 = performance.now();
    const ast = new Parser(tokens).parseProgram();
    const tParse = performance.now() - t1;

    /* --- apply params --- */
    if (paramValues) applyParams(ast, paramValues);

    /* --- scan $maxTime --- */
    const userTimeout = scanMaxTime(ast, CONFIG.evalTimeoutMs);

    /* --- eval --- */
    const ctx = new EvalContext(files, scadCache, userTimeout);
    const rootScope = makeRootScope(paramValues, previewMode);

    const t2 = performance.now();
    const results = evalStatements(ast.body, rootScope, ctx);
    const tEval = performance.now() - t2;

    /* --- stats --- */
    const t3 = performance.now();
    const root = new THREE.Group();
    const warnings = [...ctx.warnings];
    let meshCount = 0, triCount = 0, vertexCount = 0;

    // Simpan data points 2D (agar bisa diserialisasi ke Worker)
    const shapes2d = [];

    for (const r of results) {
        if (!r) continue;
        if (r.isObject3D) {
            root.add(r);
        } else if (r.__shape2d) {
            // 1. Ekstrak points murni untuk diexport
            for (const shape of r.shapes) {
                const outer = shape.getPoints(64);
                const holes = (shape.holes || []).map(h => h.getPoints(64));
                shapes2d.push({ outer, holes });
            }

            // 2. Render sebagai bidang datar (flat mesh) agar terlihat di viewport 3D
            try {
                const geo = new THREE.ShapeGeometry(r.shapes);
                const mat = new THREE.MeshBasicMaterial({ 
                    color: 0x60a5fa, 
                    side: THREE.DoubleSide, 
                    transparent: true, 
                    opacity: 0.8,
                    depthWrite: false
                });
                const mesh = new THREE.Mesh(geo, mat);
                root.add(mesh);
            } catch (e) {
                warnings.push('Gagal merender shape 2D ke viewport: ' + e.message);
            }
        }
    }

    root.traverse(o => {
        if (o.isMesh && o.geometry) {
            meshCount++;
            const pos = o.geometry.attributes.position;
            if (pos) {
                vertexCount += pos.count;
                triCount += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
            }
        }
    });
    const tStats = performance.now() - t3;

    /* --- serialize --- */
    const t4 = performance.now();
    const meshes = serializeModel(root);
    const tSerialize = performance.now() - t4;

    return {
        root,
        ms: performance.now() - tStart,
        breakdown: {
            tokenize: tTokenize,
            parse: tParse,
            eval: tEval,
            stats: tStats,
            serialize: tSerialize
        },
        opTimings: ctx.opTimings,
        meshCount,
        triCount,
        vertexCount,
        warnings,
        echoes: ctx.echoes || [],
        meshes,
        shapes2d // <-- Dikembalikan ke pemanggil
    };
}

function scanMaxTime(ast, defaultMs) {
    for (const st of ast.body) {
        if (st.type === 'Assignment' && st.name === '$maxTime') {
            if (st.value && st.value.type === 'Literal' && typeof st.value.value === 'number') {
                return Math.max(100, Math.min(CONFIG.maxTimeoutMs, st.value.value));
            }
        }
    }
    return defaultMs;
}

export function serializeModel(root) {
    root.updateMatrixWorld(true);
    const meshes = [];

    root.traverse(obj => {
        if (!obj.isMesh || !obj.geometry) return;

        const geo = obj.geometry.clone();
        geo.applyMatrix4(obj.matrixWorld);
        const g2 = geo.index ? geo.toNonIndexed() : geo;

        let pos = g2.attributes.position.array;
        let nrm = g2.attributes.normal ? g2.attributes.normal.array : null;

        if (obj.matrixWorld.determinant() < 0) {
            pos = new Float32Array(pos);
            for (let i = 0; i < pos.length; i += 9) {
                for (let k = 0; k < 3; k++) {
                    const tmp = pos[i + 3 + k];
                    pos[i + 3 + k] = pos[i + 6 + k];
                    pos[i + 6 + k] = tmp;
                }
            }
            nrm = null;
        }

        let color = [0.976, 0.843, 0.172];
        if (obj.material && obj.material.color) {
            color = [obj.material.color.r, obj.material.color.g, obj.material.color.b];
        }

        meshes.push({
            positions: pos instanceof Float32Array ? pos.slice() : new Float32Array(pos),
            normals: nrm ? (nrm instanceof Float32Array ? nrm.slice() : new Float32Array(nrm)) : null,
            color
        });

        if (g2 !== geo) g2.dispose();
        geo.dispose();
    });

    return meshes;
}

export function deserializeModel(meshes) {
    const root = new THREE.Group();
    for (const m of meshes) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
        if (m.normals) {
            geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
        } else {
            geo.computeVertexNormals();
        }
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(m.color[0], m.color[1], m.color[2]),
            roughness: 0.55,
            metalness: 0.12,
            side: THREE.DoubleSide
        });
        root.add(new THREE.Mesh(geo, mat));
    }
    return root;
}