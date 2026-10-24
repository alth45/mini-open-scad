import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { SCADError, numArg, isNum, DEG, truthy } from '../utils.js';
import { CONFIG } from '../config.js';
import {
    makeMesh, is2D, combine2D, shapePoints,
    transformShape2D, collectWorldGeometries,
    shapeToPolygon, convexHull2D, dedupePoints,
    shapeHasCurves, translateShape2D, computeShapesBounds
} from './geometry.js';
import { CSG, csgApply, makeBrush } from './csg.js';
import { findChildrenContext } from '../core/scope.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { getFont, DEFAULT_FONT } from './fonts.js';
import { hasCJK, generateTextShapesSync, isOpenTypeFont } from './opentype-fonts.js';

/* ============================================================
   Helper: 3D offset via Minkowski sum
   ============================================================ */

/** Dedupe titik 3D dengan epsilon. O(n²) — cukup untuk input < 1000. */
function dedupePoints3D(points, eps = 0.01) {
    const unique = [];
    const eps2 = eps * eps;
    for (const p of points) {
        let dup = false;
        for (const q of unique) {
            const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
            if (dx * dx + dy * dy + dz * dz < eps2) { dup = true; break; }
        }
        if (!dup) unique.push(p);
    }
    return unique;
}

/** Sample titik di permukaan bola radius |r|, resolusi adaptif dari $fn. */
function sphereBrushPoints(r, fn) {
    const absR = Math.abs(r);
    if (absR < 1e-9) return [new THREE.Vector3(0, 0, 0)];

    // Cap: 6..16 ring, karena brush cukup low-poly untuk hasil halus
    const rings = Math.max(6, Math.min(Math.ceil(fn / 2), 16));
    const segs = rings * 2;
    const pts = [];

    for (let i = 0; i <= rings; i++) {
        const theta = i * Math.PI / rings;
        const y = absR * Math.cos(theta);
        const rAtTheta = absR * Math.sin(theta);
        if (i === 0 || i === rings) {
            pts.push(new THREE.Vector3(0, y, 0));
        } else {
            for (let j = 0; j < segs; j++) {
                const phi = j * 2 * Math.PI / segs;
                pts.push(new THREE.Vector3(
                    rAtTheta * Math.cos(phi),
                    y,
                    rAtTheta * Math.sin(phi)
                ));
            }
        }
    }
    return pts;
}

/** 8 sudut kubus ukuran 2|r| (centered). Dipakai untuk offset(delta). */
function cubeBrushPoints(r) {
    const absR = Math.abs(r);
    if (absR < 1e-9) return [new THREE.Vector3(0, 0, 0)];
    const pts = [];
    for (const x of [-absR, absR])
        for (const y of [-absR, absR])
            for (const z of [-absR, absR])
                pts.push(new THREE.Vector3(x, y, z));
    return pts;
}

/**
 * 3D offset: A + B (Minkowski), lalu convex hull.
 * Hasil exact untuk input convex. Approximate untuk non-convex.
 */
function offset3DImpl(objs, a, node, scope, ctx) {
    const r = a.named.r;
    const delta = a.named.delta;

    let expandBy, brushType;
    if (r !== undefined) {
        expandBy = numArg(r);
        brushType = 'sphere';
    } else if (delta !== undefined) {
        expandBy = numArg(delta);
        brushType = 'cube';
    } else {
        throw new SCADError('offset(): butuh r= atau delta=', node.line);
    }

    if (expandBy < 0) {
        ctx.warn('offset(): negative expansion tidak didukung untuk 3D (dipakai |r|)');
        expandBy = Math.abs(expandBy);
    }

    if (objs.length > 1) {
        ctx.warn('offset(): multiple children digabung sebagai convex hull. Untuk union, bungkus dulu: union() { ... }');
    }

    const fn = getFnFor(a, scope);

    /* --- kumpulkan vertex input --- */
    const inputPts = [];
    for (const obj of objs) {
        for (const g of collectWorldGeometries(obj)) {
            const p = g.attributes.position.array;
            for (let i = 0; i < p.length; i += 3) {
                inputPts.push(new THREE.Vector3(p[i], p[i + 1], p[i + 2]));
            }
            g.dispose();
        }
    }

    if (inputPts.length === 0) return [];

    if (inputPts.length > 5000) {
        ctx.warn(`offset(): input besar (${inputPts.length} vertex) — mungkin lambat`);
    }

    const uniqueInput = dedupePoints3D(inputPts, 0.005);

    /* --- brush --- */
    const brushPts = brushType === 'sphere'
        ? sphereBrushPoints(expandBy, fn)
        : cubeBrushPoints(expandBy);

    /* --- Minkowski sum --- */
    const totalCombos = uniqueInput.length * brushPts.length;
    if (totalCombos > 500000) {
        ctx.warn(
            `offset(): ${totalCombos} kombinasi titik — pertimbangkan turunkan $fn ` +
            `atau offset lebih kecil`
        );
    }

    const sumPts = [];
    let i = 0;
    for (const ip of uniqueInput) {
        for (const bp of brushPts) {
            sumPts.push(new THREE.Vector3(ip.x + bp.x, ip.y + bp.y, ip.z + bp.z));
        }
        if ((++i & 0xFF) === 0) ctx.check();   // cek timeout tiap 256 vertex
    }

    ctx.check();

    if (sumPts.length > 1000000) {
        ctx.warn('offset(): hasil terlalu besar, render dibatalkan. Turunkan $fn atau ukuran objek.');
        return [];
    }

    try {
        return [makeMesh(new ConvexGeometry(sumPts))];
    } catch (e) {
        ctx.warn('offset(): gagal membuat convex hull (' + e.message + ')');
        return [];
    }
}

function formatEchoValue(v) {
    if (v === null || v === undefined) return 'undef';
    if (Array.isArray(v)) return '[' + v.map(formatEchoValue).join(', ') + ']';
    if (v.__range) return '[' + v.start + ':' + v.step + ':' + v.end + ']';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') {
        return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
    }
    if (typeof v === 'string') return '"' + v + '"';
    return String(v);
}
/**
 * Intersection of two offset lines at a vertex.
 * Line 1: cur + n1*ad, direction u1
 * Line 2: cur + n2*ad, direction u2
 */
function miterPoint(cur, n1, u1, n2, u2, ad) {
    const dx = (n2.x - n1.x) * ad;
    const dy = (n2.y - n1.y) * ad;
    const det = u1.x * u2.y - u1.y * u2.x;
    if (Math.abs(det) < 1e-9) return null;
    const t = (dx * u2.y - dy * u2.x) / det;
    return new THREE.Vector2(
        cur.x + n1.x * ad + t * u1.x,
        cur.y + n1.y * ad + t * u1.y
    );
}

/**
 * Offset a closed polygon.
 * @param {THREE.Vector2[]} points
 * @param {number} delta  positive = expand, negative = shrink
 * @param {'round'|'miter'|'bevel'} joinType
 * @param {number} segments  arc resolution for round joins
 */
function offsetPolygon(points, delta, joinType, segments) {
    const n = points.length;
    if (n < 3) return [];

    let area = 0;
    for (let i = 0; i < n; i++) {
        const p = points[i], q = points[(i + 1) % n];
        area += p.x * q.y - q.x * p.y;
    }
    const winding = area > 0 ? 1 : -1;

    const ad = Math.abs(delta);
    const expand = delta > 0;
    const sign = winding * (expand ? 1 : -1);

    const out = [];
    for (let i = 0; i < n; i++) {
        const prev = points[(i - 1 + n) % n];
        const cur = points[i];
        const next = points[(i + 1) % n];

        const e1 = new THREE.Vector2().subVectors(cur, prev);
        const e2 = new THREE.Vector2().subVectors(next, cur);
        const len1 = e1.length(), len2 = e2.length();
        if (len1 < 1e-9 || len2 < 1e-9) { out.push(cur.clone()); continue; }

        const u1 = e1.clone().divideScalar(len1);
        const u2 = e2.clone().divideScalar(len2);

        const n1 = new THREE.Vector2(u1.y * sign, -u1.x * sign);
        const n2 = new THREE.Vector2(u2.y * sign, -u2.x * sign);

        const cross = u1.x * u2.y - u1.y * u2.x;
        const isConvex = cross * sign > 0;

        const p1 = new THREE.Vector2(cur.x + n1.x * ad, cur.y + n1.y * ad);
        const p2 = new THREE.Vector2(cur.x + n2.x * ad, cur.y + n2.y * ad);

        // Diverging edges → need arc/bevel/miter.
        // Converging edges → intersection point.
        const diverging = (expand === isConvex);

        if (diverging) {
            if (joinType === 'miter') {
                const M = miterPoint(cur, n1, u1, n2, u2, ad);
                if (M && M.distanceTo(cur) <= ad * 4) out.push(M);
                else { out.push(p1); out.push(p2); }
            } else if (joinType === 'bevel') {
                out.push(p1); out.push(p2);
            } else {
                const a1 = Math.atan2(n1.y, n1.x);
                const a2 = Math.atan2(n2.y, n2.x);
                let da = a2 - a1;
                while (da > Math.PI) da -= 2 * Math.PI;
                while (da < -Math.PI) da += 2 * Math.PI;
                const steps = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / Math.max(segments, 2))));
                for (let k = 0; k <= steps; k++) {
                    const a = a1 + da * (k / steps);
                    out.push(new THREE.Vector2(cur.x + Math.cos(a) * ad, cur.y + Math.sin(a) * ad));
                }
            }
        } else {
            const M = miterPoint(cur, n1, u1, n2, u2, ad);
            if (M) out.push(M);
            else { out.push(p1); out.push(p2); }
        }
    }
    return out;
}

/** Kumpulkan semua titik 3D dari sebuah Object3D (dunia). */
function collectPoints3D(obj) {
    const pts = [];
    for (const g of collectWorldGeometries(obj)) {
        const p = g.attributes.position.array;
        for (let i = 0; i < p.length; i += 3) {
            pts.push(new THREE.Vector3(p[i], p[i + 1], p[i + 2]));
        }
        g.dispose();
    }
    return pts;
}

/**
 * Resolve segment count untuk satu primitive.
 * Prioritas:
 *   1. `$fn ≥ 3` (per-call atau scope) → pakai langsung
 *   2. `$fa`/`$fs` auto-tessellation (jika radius tersedia)
 *   3. `CONFIG.fallbackFn` (jika radius tidak diketahui)
 *
 * @param {object} args  - parsed args
 * @param {Scope}  scope - eval scope
 * @param {number|null} radius - reference radius untuk auto-tessellation
 */
function getFnFor(args, scope, radius = null) {
    /* --- $fn explicit override --- */
    const fnVal = (args.named && args.named.$fn !== undefined)
        ? args.named.$fn
        : scope.get('$fn');
    const n = Number(fnVal);
    if (Number.isFinite(n) && n >= 3) return Math.min(Math.floor(n), 512);

    /* --- auto-tessellation $fa/$fs (butuh radius) --- */
    if (radius == null || !Number.isFinite(radius) || radius <= 0) {
        return CONFIG.fallbackFn;
    }

    const faVal = (args.named && args.named.$fa !== undefined)
        ? args.named.$fa
        : scope.get('$fa');
    const fsVal = (args.named && args.named.$fs !== undefined)
        ? args.named.$fs
        : scope.get('$fs');

    const fa = Number(faVal);
    const fs = Number(fsVal);

    const faN = Number.isFinite(fa) && fa > 0 ? 360 / fa : Infinity;
    const fsN = Number.isFinite(fs) && fs > 0 ? (radius * 2 * Math.PI) / fs : Infinity;

    /* user set both to 0 → fallback */
    if (!Number.isFinite(faN) && !Number.isFinite(fsN)) {
        return CONFIG.fallbackFn;
    }

    const computed = Math.max(5, Math.min(faN, fsN));
    return Math.min(512, Math.floor(computed));
}

function getArg(args, index, name, def) {
    if (args.pos[index] !== undefined) return args.pos[index];
    if (name && args.named[name] !== undefined) return args.named[name];
    return def;
}

/**
 * Builtins di-inject dengan `evalStatements` supaya tidak ada circular import.
 * @param {(stmts:any[], scope:any, ctx:any)=>any[]} evalStatements
 */
export function makeBuiltins(evalStatements) {

    function applyMatrixToChildren(m, node, scope, ctx) {
        const kids = evalStatements(node.children, scope, ctx);
        if (kids.length === 0) return [];
        if (kids.every(is2D)) return [combine2D(kids.map(k => transformShape2D(k, m)))];
        const g = new THREE.Group();
        g.applyMatrix4(m);
        for (const k of kids) if (k && k.isObject3D) g.add(k);
        return [g];
    }

    return {



        /* ---------- CHILDREN ---------- */
        children(a, node, scope, ctx) {
            const cc = findChildrenContext(scope);
            if (!cc) {
                throw new SCADError(
                    'children() hanya bisa dipanggil di dalam module. ' +
                    'Pakai lewat module wrapper: module m() children();',
                    node.line
                );
            }

            const n = cc.children.length;
            if (n === 0) return [];

            /* tentukan index yang diminta */
            let indices;
            if (a.pos.length === 0) {
                indices = [];
                for (let i = 0; i < n; i++) indices.push(i);
            } else {
                const v = a.pos[0];
                if (v && typeof v === 'object' && v.__range) {
                    indices = [];
                    for (let i = v.start; i <= v.end + 1e-9; i += v.step) {
                        indices.push(Math.round(i));
                    }
                } else if (Array.isArray(v)) {
                    indices = v.map(x => Math.round(numArg(x)));
                } else {
                    indices = [Math.round(numArg(v))];
                }
            }

            /* evaluasi tiap child di callerScope */
            const out = [];
            for (const i of indices) {
                if (!Number.isFinite(i) || i < 0 || i >= n) {
                    ctx.warn(`children(${i}): index di luar jangkauan (tersedia: 0..${n - 1})`);
                    continue;
                }
                const res = evalStatements([cc.children[i]], cc.callerScope, ctx);
                out.push(...res);
            }
            return out;
        },


        /* ---------- IMPORT STL ---------- */
        import(a, node, scope, ctx) {
            const filename = getArg(a, 0, 'file', null);
            if (typeof filename !== 'string') {
                throw new SCADError('import(): butuh nama file string', node.line);
            }

            const buffer = ctx.getFileBuffer(filename);
            if (!buffer) {
                throw new SCADError(
                    `import(): file tidak ditemukan: '${filename}'`,
                    node.line, 0,
                    `Import lewat tombol 📁 atau drag-drop STL ke viewport`
                );
            }

            let geometry;
            try {
                const loader = new STLLoader();
                geometry = loader.parse(buffer);
            } catch (e) {
                throw new SCADError(
                    `import(): gagal parse STL '${filename}': ${e.message}`,
                    node.line
                );
            }

            if (!geometry || !geometry.attributes.position || geometry.attributes.position.count === 0) {
                throw new SCADError(`import(): STL kosong atau korup: '${filename}'`, node.line);
            }

            if (!geometry.attributes.normal) geometry.computeVertexNormals();

            if (a.named.center) {
                geometry.computeBoundingBox();
                const c = new THREE.Vector3();
                geometry.boundingBox.getCenter(c);
                geometry.translate(-c.x, -c.y, -c.z);
            }

            // convexity = CGAL hint, tidak berpengaruh di renderer kita — diabaikan.

            return [makeMesh(geometry)];
        },

        /* ---------- RESIZE ---------- */
        resize(a, node, scope, ctx) {
            const target = getArg(a, 0, 'newsize', [1, 1, 1]);
            if (!Array.isArray(target) || target.length < 2) {
                throw new SCADError('resize(): newsize harus vector', node.line);
            }
            const auto = !!a.named.auto;

            const kids = evalStatements(node.children, scope, ctx);
            if (kids.length === 0) return [];

            /* 2D */
            if (kids.every(is2D)) {
                const base = kids[0];
                if (!base.shapes.length) return [];

                /* Terapkan holes ke SEMUA base shape (penting untuk text — multi-letter) */
                for (const baseShape of base.shapes) {
                    for (let i = 1; i < kids.length; i++) {
                        for (const s of kids[i].shapes) {
                            try {
                                baseShape.holes.push(new THREE.Path(shapePoints(s, 64)));
                            } catch { /* ignore */ }
                        }
                    }
                }
                return [{ __shape2d: true, shapes: base.shapes }];
            }
            /* 3D */
            const group = new THREE.Group();
            for (const k of kids) if (k && k.isObject3D) group.add(k);
            if (group.children.length === 0) return [];

            group.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(group);
            if (box.isEmpty()) return kids;

            const size = box.getSize(new THREE.Vector3());
            const scale = new THREE.Vector3(1, 1, 1);
            if (auto) {
                let best = 0;
                for (let i = 0; i < 3; i++) {
                    const t = target[i];
                    const s = size.getComponent(i);
                    if (t > 0 && s > 1e-9) best = Math.max(best, t / s);
                }
                if (best > 0) scale.set(best, best, best);
            } else {
                for (let i = 0; i < 3; i++) {
                    const t = target[i];
                    const s = size.getComponent(i);
                    if (t > 0 && s > 1e-9) scale.setComponent(i, t / s);
                }
            }
            group.scale.copy(scale);
            return [group];
        },

        /* ---------- MULTMATRIX ---------- */
        multmatrix(a, node, scope, ctx) {
            const m = getArg(a, 0, 'm', null);
            if (!Array.isArray(m) || m.length !== 4 ||
                !m.every(r => Array.isArray(r) && r.length === 4)) {
                throw new SCADError('multmatrix(): butuh 4×4 array', node.line);
            }
            const mat = new THREE.Matrix4().set(
                m[0][0], m[0][1], m[0][2], m[0][3],
                m[1][0], m[1][1], m[1][2], m[1][3],
                m[2][0], m[2][1], m[2][2], m[2][3],
                m[3][0], m[3][1], m[3][2], m[3][3]
            );
            return applyMatrixToChildren(mat, node, scope, ctx);
        },

        /* ---------- ECHO (debug) ---------- */
        echo(a, node, scope, ctx) {
            const parts = a.pos.map(formatEchoValue);
            for (const k in a.named) {
                parts.push(k + ' = ' + formatEchoValue(a.named[k]));
            }
            ctx.log('ECHO: ' + parts.join(' '));
            return [];
        },

        /* ---------- ASSERT ---------- */
        assert(a, node) {
            const cond = a.pos[0];
            const msg = a.pos[1] !== undefined ? String(a.pos[1]) : 'Assertion failed';
            if (!truthy(cond)) throw new SCADError('Assertion failed: ' + msg, node.line);
            return [];
        },

        /* ---------- PRIMITIVE 3D ---------- */
        cube(a, node) {
            let size = getArg(a, 0, 'size', 1);
            if (isNum(size)) size = [size, size, size];
            if (!Array.isArray(size) || size.length < 3)
                throw new SCADError('cube(): size harus number atau [x,y,z]', node.line);
            const center = !!a.named.center;
            const sx = Math.max(Math.abs(size[0]), 1e-6);
            const sy = Math.max(Math.abs(size[1]), 1e-6);
            const sz = Math.max(Math.abs(size[2]), 1e-6);
            const g = new THREE.BoxGeometry(sx, sy, sz);
            if (!center) g.translate(sx / 2, sy / 2, sz / 2);
            return [makeMesh(g)];
        },

        sphere(a, node, scope) {
            /* --- resolve r (prioritas: r > d > positional) --- */
            let r = a.named.r;
            let d = a.named.d;
            if (r === undefined && a.pos[0] !== undefined) r = a.pos[0];
            if (r === undefined && d !== undefined) r = numArg(d) / 2;
            r = Math.abs(numArg(r, 1)) || 1e-6;

            const fn = getFnFor(a, scope, r);
            const g = new THREE.SphereGeometry(r, fn, Math.max(2, Math.round(fn / 2)));
            return [makeMesh(g)];
        },

        cylinder(a, node, scope) {
            /* --- resolve h --- */
            let h = a.named.h;
            if (h === undefined && a.pos[0] !== undefined) h = a.pos[0];
            if (h === undefined) h = 1;

            /* --- resolve r1 / r2 (prioritas: r1/r2 > d1/d2 > r > d > positional) --- */
            let r1 = a.named.r1;
            let r2 = a.named.r2;
            let r = a.named.r;
            let d = a.named.d;
            let d1 = a.named.d1;
            let d2 = a.named.d2;

            /* positional: cylinder(h, r) atau cylinder(h, r1, r2) */
            if (a.pos.length === 2) { r1 = a.pos[1]; r2 = a.pos[1]; }
            if (a.pos.length >= 3) { r1 = a.pos[1]; r2 = a.pos[2]; }

            /* r menang atas d */
            if (r !== undefined) {
                if (r1 === undefined) r1 = r;
                if (r2 === undefined) r2 = r;
            }
            if (d !== undefined) {
                const rFromD = numArg(d) / 2;
                if (r1 === undefined) r1 = rFromD;
                if (r2 === undefined) r2 = rFromD;
            }
            /* d1/d2 menang kalau r1/r2 belum di-set */
            if (d1 !== undefined && r1 === undefined) r1 = numArg(d1) / 2;
            if (d2 !== undefined && r2 === undefined) r2 = numArg(d2) / 2;

            if (r1 === undefined) r1 = 1;
            if (r2 === undefined) r2 = r1;

            const fn = getFnFor(a, scope, Math.max(Math.abs(r1), Math.abs(r2)));
            const height = Math.max(Math.abs(numArg(h, 1)), 1e-6);
            const g = new THREE.CylinderGeometry(
                Math.max(Math.abs(numArg(r2, 1)), 1e-6),
                Math.max(Math.abs(numArg(r1, 1)), 1e-6),
                height, fn, 1, false
            );
            g.rotateX(Math.PI / 2);
            g.translate(0, 0, height / 2);
            if (a.named.center) g.translate(0, 0, -height / 2);
            return [makeMesh(g)];
        },
        polyhedron(a, node) {
            const points = getArg(a, 0, 'points', null);
            const faces = getArg(a, 1, 'faces', null);
            if (!Array.isArray(points) || !Array.isArray(faces))
                throw new SCADError('polyhedron(): butuh points[] dan faces[]', node.line);

            const verts = [];
            const push = p => { verts.push(p[0], p[1], p[2]); };
            for (const f of faces) {
                if (!Array.isArray(f) || f.length < 3) continue;
                for (let i = 1; i < f.length - 1; i++) {
                    push(points[f[0]]);
                    push(points[f[i + 1]]);
                    push(points[f[i]]);
                }
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
            g.computeVertexNormals();
            return [makeMesh(g)];
        },

        /* ---------- PRIMITIVE 2D ---------- */
        circle(a, node, scope) {
            let r = a.named.r;
            let d = a.named.d;
            if (r === undefined && a.pos[0] !== undefined) r = a.pos[0];
            if (r === undefined && d !== undefined) r = numArg(d) / 2;
            r = Math.abs(numArg(r, 1)) || 1e-6;

            const fn = getFnFor(a, scope, r);
            const n = Math.max(3, fn);
            const s = new THREE.Shape();
            const pts = [];
            for (let i = 0; i < n; i++) {
                const ang = (i / n) * Math.PI * 2;
                pts.push(new THREE.Vector2(Math.cos(ang) * r, Math.sin(ang) * r));
            }
            s.setFromPoints(pts);
            return [{ __shape2d: true, shapes: [s] }];
        },

        square(a) {
            let size = getArg(a, 0, 'size', 1);
            if (isNum(size)) size = [size, size];
            const w = Math.max(Math.abs(numArg(size[0], 1)), 1e-6);
            const h = Math.max(Math.abs(numArg(size[1], 1)), 1e-6);
            const center = !!a.named.center;
            const x0 = center ? -w / 2 : 0;
            const y0 = center ? -h / 2 : 0;
            const s = new THREE.Shape();
            s.moveTo(x0, y0);
            s.lineTo(x0 + w, y0);
            s.lineTo(x0 + w, y0 + h);
            s.lineTo(x0, y0 + h);
            s.closePath();
            return [{ __shape2d: true, shapes: [s] }];
        },

        polygon(a, node) {
            const pts = getArg(a, 0, 'points', null);
            if (!Array.isArray(pts) || pts.length < 3)
                throw new SCADError('polygon(): butuh minimal 3 titik', node.line);
            const v2 = pts.map(p => new THREE.Vector2(numArg(p[0]), numArg(p[1])));
            return [{ __shape2d: true, shapes: [new THREE.Shape(v2)] }];
        },


        /* ---------- TEXT (2D) ---------- */
        text(a, node, scope, ctx) {
            const str = getArg(a, 0, 'text', '');
            if (typeof str !== 'string') {
                throw new SCADError('text(): text harus string', node.line);
            }
            if (str.length === 0) return [];

            const size = Math.abs(numArg(getArg(a, 1, 'size', 10), 10)) || 10;
            let fontName = String(getArg(a, 2, 'font', DEFAULT_FONT));
            const halign = String(a.named.halign || 'left').toLowerCase();
            const valign = String(a.named.valign || 'baseline').toLowerCase();

            if (a.named.spacing !== undefined && numArg(a.named.spacing, 1) !== 1) {
                ctx.warn('text(): parameter `spacing` belum didukung, diabaikan.');
            }

            /* --- pilih font berdasarkan isi string --- */
            const useCJK = hasCJK(str);
            if (useCJK && fontName === DEFAULT_FONT) fontName = 'noto-jp';

            let shapes;
            if (isOpenTypeFont(fontName)) {
                const otShapes = generateTextShapesSync(fontName, str, size);
                if (otShapes === null) {
                    throw new SCADError(
                        `text(): font '${fontName}' belum ready atau tidak tersedia. ` +
                        `Pastikan 'public/fonts/noto-jp.otf' ada, lalu render lagi.`,
                        node.line
                    );
                }
                shapes = otShapes;
                if (!shapes || shapes.length === 0) return [];
            } else {
                // helvetiker path — tidak berubah
                try {
                    const font = getFont(fontName);
                    shapes = font.generateShapes(str, size);
                } catch (e) {
                    throw new SCADError(`text(): gagal generate shapes: ${e.message}`, node.line);
                }
                if (!shapes || shapes.length === 0) return [];
            }

            /* --- alignment --- */
            const box = computeShapesBounds(shapes);
            if (box.isEmpty()) return [];

            let dx = 0, dy = 0;
            switch (halign) {
                case 'center': dx = -(box.min.x + box.max.x) / 2; break;
                case 'right': dx = -box.max.x; break;
                case 'left':
                default: dx = -box.min.x; break;
            }
            switch (valign) {
                case 'center': dy = -(box.min.y + box.max.y) / 2; break;
                case 'top': dy = -box.max.y; break;
                case 'bottom': dy = -box.min.y; break;
                case 'baseline':
                default: dy = 0; break;
            }
            if (dx !== 0 || dy !== 0) {
                for (const s of shapes) translateShape2D(s, dx, dy);
            }

            return { __shape2d: true, shapes };
        },

        /* ---------- TRANSFORM ---------- */
        translate(a, node, scope, ctx) {
            let v = getArg(a, 0, 'v', [0, 0, 0]);
            if (isNum(v)) v = [v, 0, 0];
            const m = new THREE.Matrix4().makeTranslation(v[0] || 0, v[1] || 0, v[2] || 0);
            return applyMatrixToChildren(m, node, scope, ctx);
        },

        rotate(a, node, scope, ctx) {
            let v = getArg(a, 0, 'a', [0, 0, 0]);
            if (isNum(v)) v = [0, 0, v];
            const e = new THREE.Euler((v[0] || 0) * DEG, (v[1] || 0) * DEG, (v[2] || 0) * DEG, 'ZYX');
            const m = new THREE.Matrix4().makeRotationFromEuler(e);
            return applyMatrixToChildren(m, node, scope, ctx);
        },

        scale(a, node, scope, ctx) {
            let v = getArg(a, 0, 'v', [1, 1, 1]);
            if (isNum(v)) v = [v, v, v];
            const sx = numArg(v[0], 1) || 1e-6;
            const sy = numArg(v[1], 1) || 1e-6;
            const sz = numArg(v[2], 1) || 1e-6;
            const m = new THREE.Matrix4().makeScale(sx, sy, sz);
            return applyMatrixToChildren(m, node, scope, ctx);
        },

        mirror(a, node, scope, ctx) {
            let n = getArg(a, 0, 'v', [1, 0, 0]);
            if (isNum(n)) n = [n, 0, 0];
            const len = Math.hypot(n[0] || 0, n[1] || 0, n[2] || 0) || 1;
            const ux = (n[0] || 0) / len, uy = (n[1] || 0) / len, uz = (n[2] || 0) / len;
            const m = new THREE.Matrix4().set(
                1 - 2 * ux * ux, -2 * ux * uy, -2 * ux * uz, 0,
                -2 * uy * ux, 1 - 2 * uy * uy, -2 * uy * uz, 0,
                -2 * uz * ux, -2 * uz * uy, 1 - 2 * uz * uz, 0,
                0, 0, 0, 1
            );
            return applyMatrixToChildren(m, node, scope, ctx);
        },

        color(a, node, scope, ctx) {
            const cv = getArg(a, 0, 'c', 'red');
            let col;
            try {
                col = Array.isArray(cv)
                    ? new THREE.Color(numArg(cv[0], 1), numArg(cv[1], 0), numArg(cv[2], 0))
                    : new THREE.Color(String(cv));
            } catch { col = new THREE.Color(0xf9d72c); }

            const kids = evalStatements(node.children, scope, ctx);
            for (const k of kids) {
                if (!k || !k.isObject3D) continue;
                k.traverse(o => {
                    if (o.isMesh && o.material) {
                        o.material = o.material.clone();
                        o.material.color.copy(col);
                    }
                });
            }
            return kids;
        },

        /* ---------- BOOLEAN ---------- */
        union(a, node, scope, ctx) {
            const kids = evalStatements(node.children, scope, ctx);
            if (kids.length === 0) return [];
            if (kids.every(is2D)) return [combine2D(kids)];
            const g = new THREE.Group();
            for (const k of kids) if (k && k.isObject3D) g.add(k);
            return [g];
        },

        difference(a, node, scope, ctx) {
            const kids = evalStatements(node.children, scope, ctx).filter(Boolean);
            if (kids.length === 0) return [];

            if (kids.every(is2D)) {
                const base = kids[0];
                if (!base.shapes.length) return [];
                const outer = base.shapes[0];
                const holes = [];
                for (let i = 1; i < kids.length; i++) {
                    for (const s of kids[i].shapes) {
                        try { holes.push(new THREE.Path(shapePoints(s, 64))); } catch { /* ignore */ }
                    }
                }
                outer.holes.push(...holes);
                return [{ __shape2d: true, shapes: [outer] }];
            }

            if (!CSG) {
                ctx.warn('difference() butuh three-bvh-csg; hanya child pertama yang dirender.');
                return [kids[0]];
            }

            let result = makeBrush(kids[0]);
            if (!result) return [];
            for (let i = 1; i < kids.length; i++) {
                ctx.check();
                const tool = makeBrush(kids[i]);
                if (!tool) continue;
                result = csgApply(result, tool, CSG.SUBTRACTION);
            }
            return [makeMesh(result.geometry)];
        },

        intersection(a, node, scope, ctx) {
            const kids = evalStatements(node.children, scope, ctx).filter(Boolean);
            if (kids.length === 0) return [];
            if (kids.length === 1) return [kids[0]];

            if (!CSG) {
                ctx.warn('intersection() butuh three-bvh-csg; hanya child pertama yang dirender.');
                return [kids[0]];
            }

            let result = makeBrush(kids[0]);
            if (!result) return [];
            for (let i = 1; i < kids.length; i++) {
                ctx.check();
                const tool = makeBrush(kids[i]);
                if (!tool) continue;
                result = csgApply(result, tool, CSG.INTERSECTION);
            }
            return [makeMesh(result.geometry)];
        },

        hull(a, node, scope, ctx) {
            const kids = evalStatements(node.children, scope, ctx).filter(Boolean);

            /* 2D hull */
            if (kids.length > 0 && kids.every(is2D)) {
                const points = [];
                for (const k of kids) {
                    for (const sh of k.shapes) {
                        for (const p of shapePoints(sh, 64)) points.push(p);
                    }
                }
                if (points.length < 3) return [];
                const hullPts = convexHull2D(points);
                if (hullPts.length < 3) return [];
                return [{ __shape2d: true, shapes: [new THREE.Shape(hullPts)] }];
            }

            /* 3D hull (existing) */
            const points = [];
            for (const k of kids) {
                if (!k || !k.isObject3D) continue;
                const geoms = collectWorldGeometries(k);
                for (const g of geoms) {
                    const p = g.attributes.position.array;
                    for (let i = 0; i < p.length; i += 3) {
                        points.push(new THREE.Vector3(p[i], p[i + 1], p[i + 2]));
                    }
                    g.dispose();
                }
            }
            if (points.length < 4) return [];
            try {
                return [makeMesh(new ConvexGeometry(points))];
            } catch {
                ctx.warn('hull(): gagal membuat convex hull.');
                return [];
            }
        },

        /* ---------- OFFSET (2D & 3D) ---------- */
        offset(a, node, scope, ctx) {
            const kids = evalStatements(node.children, scope, ctx).filter(Boolean);
            if (kids.length === 0) return [];

            const shapes2D = [];
            const objs3D = [];
            for (const k of kids) {
                if (is2D(k)) shapes2D.push(...k.shapes);
                else if (k && k.isObject3D) objs3D.push(k);
            }

            if (shapes2D.length > 0 && objs3D.length > 0) {
                throw new SCADError('offset(): child harus semua 2D atau semua 3D', node.line);
            }

            /* --------- 3D path --------- */
            if (objs3D.length > 0) {
                return offset3DImpl(objs3D, a, node, scope, ctx);
            }

            /* --------- 2D path (existing) --------- */
            if (shapes2D.length === 0) {
                ctx.warn('offset(): butuh child 2D atau 3D.');
                return [];
            }

            const r = a.named.r;
            const delta = a.named.delta;
            let offsetVal, joinType, segments;
            if (r !== undefined) {
                offsetVal = numArg(r);
                joinType = 'round';
                segments = Math.max(4, Math.min(getFnFor(a, scope), 64));
            } else if (delta !== undefined) {
                offsetVal = numArg(delta);
                const join = a.named.join;
                joinType = join === 'round' ? 'round' : join === 'bevel' ? 'bevel' : 'miter';
                segments = 16;
            } else {
                throw new SCADError('offset(): butuh r= (round) atau delta= (miter)', node.line);
            }

            const resultShapes = [];
            for (const sh of shapes2D) {
                const poly = shapeToPolygon(sh);
                if (poly.outer.length < 3) continue;
                const newOuter = offsetPolygon(poly.outer, offsetVal, joinType, segments);
                if (newOuter.length < 3) continue;
                const newShape = new THREE.Shape(newOuter);
                for (const h of poly.holes) {
                    const newHole = offsetPolygon(h, -offsetVal, joinType, segments);
                    if (newHole.length >= 3) newShape.holes.push(new THREE.Path(newHole));
                }
                resultShapes.push(newShape);
            }
            return [{ __shape2d: true, shapes: resultShapes }];
        },

        /* ---------- MINKOWSKI (approximate, convex only) ---------- */
        minkowski(a, node, scope, ctx) {
            const kids = evalStatements(node.children, scope, ctx).filter(Boolean);
            if (kids.length !== 2) {
                throw new SCADError('minkowski(): butuh tepat 2 child', node.line);
            }
            const [A, B] = kids;
            const aIs2D = is2D(A);
            const bIs2D = is2D(B);

            if (aIs2D !== bIs2D) {
                throw new SCADError('minkowski(): kedua child harus 2D atau keduanya 3D', node.line);
            }

            if (aIs2D) {
                const aPts = [];
                for (const sh of A.shapes) for (const p of shapePoints(sh, 64)) aPts.push(p);
                const bPts = [];
                for (const sh of B.shapes) for (const p of shapePoints(sh, 64)) bPts.push(p);
                if (aPts.length === 0 || bPts.length === 0) return [];

                const sumPts = [];
                for (const ap of aPts) for (const bp of bPts) {
                    sumPts.push(new THREE.Vector2(ap.x + bp.x, ap.y + bp.y));
                }
                const hullPts = convexHull2D(sumPts);
                if (hullPts.length < 3) return [];
                return [{ __shape2d: true, shapes: [new THREE.Shape(hullPts)] }];
            } else {
                const aPts = collectPoints3D(A);
                const bPts = collectPoints3D(B);
                if (aPts.length === 0 || bPts.length === 0) return [];

                const sumPts = [];
                for (const ap of aPts) for (const bp of bPts) {
                    sumPts.push(new THREE.Vector3(ap.x + bp.x, ap.y + bp.y, ap.z + bp.z));
                }
                if (sumPts.length > 60000) {
                    ctx.warn('minkowski(): vertex count besar (' + sumPts.length + '), mungkin lambat.');
                }
                try {
                    return [makeMesh(new ConvexGeometry(sumPts))];
                } catch {
                    ctx.warn('minkowski(): gagal membuat convex hull.');
                    return [];
                }
            }
        },

        /* ---------- EXTRUSION ---------- */
        linear_extrude(a, node, scope, ctx) {
            const h = Math.abs(numArg(getArg(a, 0, 'height', 1), 1)) || 1e-6;
            const center = !!a.named.center;
            const fn = getFnFor(a, scope, null);      // no radius → fallbackFn (32)
            const kids = evalStatements(node.children, scope, ctx);

            const shapes = [];
            for (const k of kids) if (is2D(k)) shapes.push(...k.shapes);
            if (shapes.length === 0) {
                ctx.warn('linear_extrude(): butuh child 2D (circle/square/polygon/text).');
                return [];
            }

            const meshes = [];
            for (const s of shapes) {
                try {
                    /* Shapes dengan curve (text, arc) → high res
                       Shapes polyline (polygon, circle $fn, square) → low res */
                    const hasCurves = shapeHasCurves(s);
                    const curveSegments = hasCurves ? Math.max(8, Math.min(fn, 128)) : 1;

                    const g = new THREE.ExtrudeGeometry(s, {
                        depth: h,
                        bevelEnabled: false,
                        curveSegments,
                        steps: 1
                    });
                    if (center) g.translate(0, 0, -h / 2);
                    meshes.push(makeMesh(g));
                } catch (e) {
                    ctx.warn('linear_extrude(): gagal mengekstrusi shape (' + e.message + ')');
                }
            }
            return meshes;
        },

        rotate_extrude(a, node, scope, ctx) {
            const angle = numArg(getArg(a, 0, 'angle', 360), 360);
            const kids = evalStatements(node.children, scope, ctx);

            const shapes = [];
            for (const k of kids) if (is2D(k)) shapes.push(...k.shapes);
            if (shapes.length === 0) {
                ctx.warn('rotate_extrude(): butuh child 2D (circle/square/polygon).');
                return [];
            }

            /* hitung reference radius — max |x| dari semua titik profile */
            let maxR = 0;
            for (const s of shapes) {
                for (const p of shapePoints(s, 64)) {
                    if (p.x > maxR) maxR = p.x;
                }
            }
            const fn = getFnFor(a, scope, maxR);

            const meshes = [];
            for (const s of shapes) {
                let pts = shapePoints(s, Math.max(24, fn));
                if (pts.length < 2) continue;
                let negative = false;
                const v2 = pts.map(p => {
                    if (p.x < -1e-9) negative = true;
                    return new THREE.Vector2(Math.max(p.x, 0), p.y);
                });
                if (negative) ctx.warn('rotate_extrude(): titik dengan x < 0 di-clamp ke 0.');

                try {
                    const g = new THREE.LatheGeometry(v2, Math.max(3, fn), 0, angle * DEG);
                    g.rotateX(Math.PI / 2);
                    meshes.push(makeMesh(g));
                } catch (e) {
                    ctx.warn('rotate_extrude(): gagal (' + e.message + ')');
                }
            }
            return meshes;
        }
    };
}