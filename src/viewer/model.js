import * as THREE from 'three';
import { tokenize } from '../core/tokenizer.js';
import { Parser } from '../core/parser.js';
import { EvalContext, makeRootScope, evalStatements } from '../evaluator/index.js';
import { applyParams } from '../evaluator/params.js';
/**
 * Compile OpenSCAD source → THREE.Group + stats. Murni (tidak menyentuh scene).
 */
export function buildModel(code, paramValues) {
    const t0 = performance.now();

    const tokens = tokenize(code);
    const ast = new Parser(tokens).parseProgram();

    if (paramValues) applyParams(ast, paramValues);

    const ctx = new EvalContext();
    const rootScope = makeRootScope(paramValues);

    const results = evalStatements(ast.body, rootScope, ctx);

    const root = new THREE.Group();
    const warnings = [...ctx.warnings];
    let meshCount = 0, triCount = 0;

    for (const r of results) {
        if (!r) continue;
        if (r.isObject3D) root.add(r);
        else if (r.__shape2d) {
            warnings.push('Shape 2D di top-level tidak dirender. Bungkus dengan linear_extrude()/rotate_extrude().');
        }
    }

    root.traverse(o => {
        if (o.isMesh && o.geometry) {
            meshCount++;
            const pos = o.geometry.attributes.position;
            if (pos) triCount += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
        }
    });

    return {
        root,
        ms: performance.now() - t0,
        meshCount,
        triCount,
        warnings,
        echoes: [...ctx.echoes]

    };
}

/* ============================================================
   Serialisasi THREE.Mesh ↔ plain data (untuk Web Worker)
   ============================================================ */

/**
 * Flatten Object3D → array of plain mesh data.
 * - World matrix di-bake ke positions
 * - Geometri dijadikan non-indexed (TriangleSoup)
 * - Warna dari material.color per-mesh disimpan
 * - Mirror (determinant < 0) → winding di-flip
 *
 * Hasil bisa di-`postMessage` dengan buffer sebagai transferable.
 */
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

/**
 * Kebalikan dari serializeModel — bangun THREE.Group dari plain data.
 * Cocok dipakai di main thread setelah menerima transferable dari worker.
 */
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