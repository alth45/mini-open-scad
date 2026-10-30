import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'; // <-- IMPORT BARU
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
import { isManifoldReady, getWasm, objToManifold, manifoldMeshToGeo } from './manifold-engine.js';

/* ============================================================
   Helper: 2D Boolean menggunakan Manifold
   ============================================================ */

/** Ekstrak kontur 2D dari mesh hasil boolean 3D */
function extractShapesFromMesh(geo) {
    const pos = geo.attributes.position;
    let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) maxZ = Math.max(maxZ, pos.getZ(i));
    
    const edges = new Map();
    for (let i = 0; i < pos.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, i);
        const b = new THREE.Vector3().fromBufferAttribute(pos, i+1);
        const c = new THREE.Vector3().fromBufferAttribute(pos, i+2);
        
        if (Math.abs(a.z - maxZ) > 1e-4 || Math.abs(b.z - maxZ) > 1e-4 || Math.abs(c.z - maxZ) > 1e-4) continue;
        
        const ab = b.clone().sub(a);
        const ac = c.clone().sub(a);
        const n = ab.cross(ac);
        if (n.z <= 0) continue;
        
        const keyA = `${a.x.toFixed(4)},${a.y.toFixed(4)}`;
        const keyB = `${b.x.toFixed(4)},${b.y.toFixed(4)}`;
        const keyC = `${c.x.toFixed(4)},${c.y.toFixed(4)}`;
        
        const addEdge = (k1, k2, p1, p2) => {
            const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
            if (edges.has(key)) edges.delete(key);
            else edges.set(key, { start: p1, end: p2 });
        };
        addEdge(keyA, keyB, a, b);
        addEdge(keyB, keyC, b, c);
        addEdge(keyC, keyA, c, a);
    }
    
    const loops = [];
    const edgeList = Array.from(edges.values());
    while (edgeList.length > 0) {
        const loop = [];
        let cur = edgeList.pop();
        loop.push(cur.start);
        let endPt = cur.end;
        while (edgeList.length > 0) {
            loop.push(endPt);
            let found = false;
            for (let i = 0; i < edgeList.length; i++) {
                const e = edgeList[i];
                if (e.start.distanceTo(endPt) < 1e-3) { endPt = e.end; edgeList.splice(i, 1); found = true; break; }
                if (e.end.distanceTo(endPt) < 1e-3) { endPt = e.start; edgeList.splice(i, 1); found = true; break; }
            }
            if (!found) break;
            if (endPt.distanceTo(loop[0]) < 1e-3) break;
        }
        const clean = [];
        for (const p of loop) {
            if (clean.length === 0 || p.distanceTo(clean[clean.length-1]) > 1e-3) clean.push(p);
        }
        if (clean.length > 2 && clean[0].distanceTo(clean[clean.length-1]) > 1e-3) clean.push(clean[0]);
        if (clean.length >= 3) loops.push(clean);
    }

    const outers = [];
    const holes = [];
    for (const loop of loops) {
        const pts2d = loop.map(p => new THREE.Vector2(p.x, p.y));
        let area = 0;
        for (let i = 0; i < pts2d.length - 1; i++) {
            area += pts2d[i].x * pts2d[i+1].y - pts2d[i+1].x * pts2d[i].y;
        }
        if (area > 0) outers.push(pts2d);
        else holes.push(pts2d);
    }

    const shapes = [];
    for (const outer of outers) {
        const shape = new THREE.Shape(outer);
        const box = new THREE.Box2();
        for (const p of outer) box.expandByPoint(p);
        for (const hole of holes) {
            if (box.containsPoint(hole[0])) {
                shape.holes.push(new THREE.Path(hole));
            }
        }
        shapes.push(shape);
    }
    return shapes;
}

/** Konversi 1 Shape menjadi Manifold 3D tipis (untuk Boolean 2D) */
function shapeToManifold2D(shape, wasm) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false });
    geo.deleteAttribute('uv');
    geo.deleteAttribute('normal');
    const cleanGeo = mergeVertices(geo, 1e-4);
    
    const pos = cleanGeo.attributes.position;
    const idx = cleanGeo.index;
    if (!pos) return null;
    
    const vertProperties = new Float32Array(pos.array);
    let triVerts;
    if (idx) triVerts = new Uint32Array(idx.array);
    else {
        triVerts = new Uint32Array(pos.count);
        for (let i = 0; i < pos.count; i++) triVerts[i] = i;
    }
    try {
        const mesh = new wasm.Mesh({ numProp: 3, vertProperties, triVerts });
        return new wasm.Manifold(mesh);
    } catch (e) { return null; }
}

/* ============================================================
   Helper: 3D offset via Minkowski sum
   ============================================================ */

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

function sphereBrushPoints(r, fn) {
    const absR = Math.abs(r);
    if (absR < 1e-9) return [new THREE.Vector3(0, 0, 0)];
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
                    rAtTheta * Math.cos(phi), y, rAtTheta * Math.sin(phi)
                ));
            }
        }
    }
    return pts;
}

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

function offset3DImpl(objs, a, node, scope, ctx) {
    const r = a.named.r;
    const delta = a.named.delta;
    let expandBy, brushType;
    if (r !== undefined) { expandBy = numArg(r); brushType = 'sphere'; }
    else if (delta !== undefined) { expandBy = numArg(delta); brushType = 'cube'; }
    else throw new SCADError('offset(): butuh r= atau delta=', node.line);

    if (expandBy < 0) { ctx.warn('offset(): negative expansion tidak didukung untuk 3D'); expandBy = Math.abs(expandBy); }
    if (objs.length > 1) ctx.warn('offset(): multiple children digabung sebagai convex hull.');

    const fn = getFnFor(a, scope);
    const inputPts = [];
    for (const obj of objs) {
        for (const g of collectWorldGeometries(obj)) {
            const p = g.attributes.position.array;
            for (let i = 0; i < p.length; i += 3) inputPts.push(new THREE.Vector3(p[i], p[i+1], p[i+2]));
            g.dispose();
        }
    }
    if (inputPts.length === 0) return [];
    if (inputPts.length > 5000) ctx.warn(`offset(): input besar (${inputPts.length} vertex)`);
    const uniqueInput = dedupePoints3D(inputPts, 0.005);
    const brushPts = brushType === 'sphere' ? sphereBrushPoints(expandBy, fn) : cubeBrushPoints(expandBy);
    const sumPts = [];
    let i = 0;
    for (const ip of uniqueInput) {
        for (const bp of brushPts) sumPts.push(new THREE.Vector3(ip.x + bp.x, ip.y + bp.y, ip.z + bp.z));
        if ((++i & 0xFF) === 0) ctx.check();
    }
    ctx.check();
    if (sumPts.length > 1000000) { ctx.warn('offset(): hasil terlalu besar'); return []; }
    try { return [makeMesh(new ConvexGeometry(sumPts))]; } catch (e) { ctx.warn('offset(): gagal'); return []; }
}

function formatEchoValue(v) {
    if (v === null || v === undefined) return 'undef';
    if (Array.isArray(v)) return '[' + v.map(formatEchoValue).join(', ') + ']';
    if (v.__range) return '[' + v.start + ':' + v.step + ':' + v.end + ']';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
    if (typeof v === 'string') return '"' + v + '"';
    return String(v);
}

function miterPoint(cur, n1, u1, n2, u2, ad) {
    const dx = (n2.x - n1.x) * ad, dy = (n2.y - n1.y) * ad;
    const det = u1.x * u2.y - u1.y * u2.x;
    if (Math.abs(det) < 1e-9) return null;
    const t = (dx * u2.y - dy * u2.x) / det;
    return new THREE.Vector2(cur.x + n1.x * ad + t * u1.x, cur.y + n1.y * ad + t * u1.y);
}

function offsetPolygon(points, delta, joinType, segments) {
    const n = points.length;
    if (n < 3) return [];
    let area = 0;
    for (let i = 0; i < n; i++) {
        const p = points[i], q = points[(i + 1) % n];
        area += p.x * q.y - q.x * p.y;
    }
    const winding = area > 0 ? 1 : -1;
    const ad = Math.abs(delta), expand = delta > 0, sign = winding * (expand ? 1 : -1);
    const out = [];
    for (let i = 0; i < n; i++) {
        const prev = points[(i - 1 + n) % n], cur = points[i], next = points[(i + 1) % n];
        const e1 = new THREE.Vector2().subVectors(cur, prev), e2 = new THREE.Vector2().subVectors(next, cur);
        const len1 = e1.length(), len2 = e2.length();
        if (len1 < 1e-9 || len2 < 1e-9) { out.push(cur.clone()); continue; }
        const u1 = e1.clone().divideScalar(len1), u2 = e2.clone().divideScalar(len2);
        const n1 = new THREE.Vector2(u1.y * sign, -u1.x * sign), n2 = new THREE.Vector2(u2.y * sign, -u2.x * sign);
        const cross = u1.x * u2.y - u1.y * u2.x;
        const isConvex = cross * sign > 0;
        const p1 = new THREE.Vector2(cur.x + n1.x * ad, cur.y + n1.y * ad);
        const p2 = new THREE.Vector2(cur.x + n2.x * ad, cur.y + n2.y * ad);
        const diverging = (expand === isConvex);
        if (diverging) {
            if (joinType === 'miter') {
                const M = miterPoint(cur, n1, u1, n2, u2, ad);
                if (M && M.distanceTo(cur) <= ad * 4) out.push(M);
                else { out.push(p1); out.push(p2); }
            } else if (joinType === 'bevel') { out.push(p1); out.push(p2); }
            else {
                const a1 = Math.atan2(n1.y, n1.x), a2 = Math.atan2(n2.y, n2.x);
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

function collectPoints3D(obj) {
    const pts = [];
    for (const g of collectWorldGeometries(obj)) {
        const p = g.attributes.position.array;
        for (let i = 0; i < p.length; i += 3) pts.push(new THREE.Vector3(p[i], p[i+1], p[i+2]));
        g.dispose();
    }
    return pts;
}

function getFnFor(args, scope, radius = null) {
    const fnVal = (args.named && args.named.$fn !== undefined) ? args.named.$fn : scope.get('$fn');
    const n = Number(fnVal);
    if (Number.isFinite(n) && n >= 3) return Math.min(Math.floor(n), 512);
    if (radius == null || !Number.isFinite(radius) || radius <= 0) return CONFIG.fallbackFn;
    const faVal = (args.named && args.named.$fa !== undefined) ? args.named.$fa : scope.get('$fa');
    const fsVal = (args.named && args.named.$fs !== undefined) ? args.named.$fs : scope.get('$fs');
    const fa = Number(faVal), fs = Number(fsVal);
    const faN = Number.isFinite(fa) && fa > 0 ? 360 / fa : Infinity;
    const fsN = Number.isFinite(fs) && fs > 0 ? (radius * 2 * Math.PI) / fs : Infinity;
    if (!Number.isFinite(faN) && !Number.isFinite(fsN)) return CONFIG.fallbackFn;
    const computed = Math.max(5, Math.min(faN, fsN));
    return Math.min(512, Math.floor(computed));
}

function getArg(args, index, name, def) {
    if (args.pos[index] !== undefined) return args.pos[index];
    if (name && args.named[name] !== undefined) return args.named[name];
    return def;
}

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
        children(a, node, scope, ctx) {
            const cc = findChildrenContext(scope);
            if (!cc) throw new SCADError('children() hanya bisa dipanggil di dalam module.', node.line);
            const n = cc.children.length;
            if (n === 0) return [];
            let indices;
            if (a.pos.length === 0) {
                indices = [];
                for (let i = 0; i < n; i++) indices.push(i);
            } else {
                const v = a.pos[0];
                if (v && typeof v === 'object' && v.__range) {
                    indices = [];
                    for (let i = v.start; i <= v.end + 1e-9; i += v.step) indices.push(Math.round(i));
                } else if (Array.isArray(v)) indices = v.map(x => Math.round(numArg(x)));
                else indices = [Math.round(numArg(v))];
            }
            const out = [];
            for (const i of indices) {
                if (!Number.isFinite(i) || i < 0 || i >= n) { ctx.warn(`children(${i}): index di luar jangkauan`); continue; }
                out.push(...evalStatements([cc.children[i]], cc.callerScope, ctx));
            }
            return out;
        },

        import(a, node, scope, ctx) {
            const filename = getArg(a, 0, 'file', null);
            if (typeof filename !== 'string') throw new SCADError('import(): butuh nama file string', node.line);
            const buffer = ctx.getFileBuffer(filename);
            if (!buffer) throw new SCADError(`import(): file tidak ditemukan: '${filename}'`, node.line);
            let geometry;
            try { geometry = new STLLoader().parse(buffer); }
            catch (e) { throw new SCADError(`import(): gagal parse STL '${filename}': ${e.message}`, node.line); }
            if (!geometry || !geometry.attributes.position || geometry.attributes.position.count === 0)
                throw new SCADError(`import(): STL kosong atau korup: '${filename}'`, node.line);
            if (!geometry.attributes.normal) geometry.computeVertexNormals();
            if (a.named.center) {
                geometry.computeBoundingBox();
                const c = new THREE.Vector3();
                geometry.boundingBox.getCenter(c);
                geometry.translate(-c.x, -c.y, -c.z);
            }
            return [makeMesh(geometry)];
        },

        resize(a, node, scope, ctx) {
            const target = getArg(a, 0, 'newsize', [1, 1, 1]);
            if (!Array.isArray(target) || target.length < 2) throw new SCADError('resize(): newsize harus vector', node.line);
            const auto = !!a.named.auto;
            const kids = evalStatements(node.children, scope, ctx);
            if (kids.length === 0) return [];
            if (kids.every(is2D)) {
                const base = kids[0];
                if (!base.shapes.length) return [];
                for (const baseShape of base.shapes) {
                    for (let i = 1; i < kids.length; i++) {
                        for (const s of kids[i].shapes) {
                            try { baseShape.holes.push(new THREE.Path(shapePoints(s, 64))); } catch { }
                        }
                    }
                }
                return [{ __shape2d: true, shapes: base.shapes }];
            }
            const group = new THREE.Group();
            for (const k of kids) if (k && k.isObject3D) group.add(k);
            if (group.children.length === 0) return [];
            group.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(group);
            if (box.isEmpty()) return kids;
            const size = box.getSize(new THREE.Vector3()), scale = new THREE.Vector3(1, 1, 1);
            if (auto) {
                let best = 0;
                for (let i = 0; i < 3; i++) {
                    const t = target[i], s = size.getComponent(i);
                    if (t > 0 && s > 1e-9) best = Math.max(best, t / s);
                }
                if (best > 0) scale.set(best, best, best);
            } else {
                for (let i = 0; i < 3; i++) {
                    const t = target[i], s = size.getComponent(i);
                    if (t > 0 && s > 1e-9) scale.setComponent(i, t / s);
                }
            }
            group.scale.copy(scale);
            return [group];
        },

        multmatrix(a, node, scope, ctx) {
            const m = getArg(a, 0, 'm', null);
            if (!Array.isArray(m) || m.length !== 4 || !m.every(r => Array.isArray(r) && r.length === 4))
                throw new SCADError('multmatrix(): butuh 4×4 array', node.line);
            const mat = new THREE.Matrix4().set(
                m[0][0], m[0][1], m[0][2], m[0][3], m[1][0], m[1][1], m[1][2], m[1][3],
                m[2][0], m[2][1], m[2][2], m[2][3], m[3][0], m[3][1], m[3][2], m[3][3]
            );
            return applyMatrixToChildren(mat, node, scope, ctx);
        },

        echo(a, node, scope, ctx) {
            const parts = a.pos.map(formatEchoValue);
            for (const k in a.named) parts.push(k + ' = ' + formatEchoValue(a.named[k]));
            ctx.log('ECHO: ' + parts.join(' '));
            return [];
        },

        assert(a, node) {
            const cond = a.pos[0];
            const msg = a.pos[1] !== undefined ? String(a.pos[1]) : 'Assertion failed';
            if (!truthy(cond)) throw new SCADError('Assertion failed: ' + msg, node.line);
            return [];
        },

        cube(a, node) {
            let size = getArg(a, 0, 'size', 1);
            if (isNum(size)) size = [size, size, size];
            if (!Array.isArray(size) || size.length < 3) throw new SCADError('cube(): size harus number atau [x,y,z]', node.line);
            const center = !!a.named.center;
            const sx = Math.max(Math.abs(size[0]), 1e-6), sy = Math.max(Math.abs(size[1]), 1e-6), sz = Math.max(Math.abs(size[2]), 1e-6);
            const g = new THREE.BoxGeometry(sx, sy, sz);
            if (!center) g.translate(sx / 2, sy / 2, sz / 2);
            return [makeMesh(g)];
        },

        sphere(a, node, scope) {
            let r = a.named.r, d = a.named.d;
            if (r === undefined && a.pos[0] !== undefined) r = a.pos[0];
            if (r === undefined && d !== undefined) r = numArg(d) / 2;
            r = Math.abs(numArg(r, 1)) || 1e-6;
            const fn = getFnFor(a, scope, r);
            const g = new THREE.SphereGeometry(r, fn, Math.max(2, Math.round(fn / 2)));
            return [makeMesh(g)];
        },

        cylinder(a, node, scope) {
            let h = a.named.h;
            if (h === undefined && a.pos[0] !== undefined) h = a.pos[0];
            if (h === undefined) h = 1;
            let r1 = a.named.r1, r2 = a.named.r2, r = a.named.r, d = a.named.d, d1 = a.named.d1, d2 = a.named.d2;
            if (a.pos.length === 2) { r1 = a.pos[1]; r2 = a.pos[1]; }
            if (a.pos.length >= 3) { r1 = a.pos[1]; r2 = a.pos[2]; }
            if (r !== undefined) { if (r1 === undefined) r1 = r; if (r2 === undefined) r2 = r; }
            if (d !== undefined) {
                const rFromD = numArg(d) / 2;
                if (r1 === undefined) r1 = rFromD;
                if (r2 === undefined) r2 = rFromD;
            }
            if (d1 !== undefined && r1 === undefined) r1 = numArg(d1) / 2;
            if (d2 !== undefined && r2 === undefined) r2 = numArg(d2) / 2;
            if (r1 === undefined) r1 = 1;
            if (r2 === undefined) r2 = r1;
            const fn = getFnFor(a, scope, Math.max(Math.abs(r1), Math.abs(r2)));
            const height = Math.max(Math.abs(numArg(h, 1)), 1e-6);
            const g = new THREE.CylinderGeometry(
                Math.max(Math.abs(numArg(r2, 1)), 1e-6), Math.max(Math.abs(numArg(r1, 1)), 1e-6),
                height, fn, 1, false
            );
            g.rotateX(Math.PI / 2);
            g.translate(0, 0, height / 2);
            if (a.named.center) g.translate(0, 0, -height / 2);
            return [makeMesh(g)];
        },

        polyhedron(a, node) {
            const points = getArg(a, 0, 'points', null), faces = getArg(a, 1, 'faces', null);
            if (!Array.isArray(points) || !Array.isArray(faces)) throw new SCADError('polyhedron(): butuh points[] dan faces[]', node.line);
            const verts = [], push = p => verts.push(p[0], p[1], p[2]);
            for (const f of faces) {
                if (!Array.isArray(f) || f.length < 3) continue;
                for (let i = 1; i < f.length - 1; i++) { push(points[f[0]]); push(points[f[i + 1]]); push(points[f[i]]); }
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
            g.computeVertexNormals();
            return [makeMesh(g)];
        },

        circle(a, node, scope) {
            let r = a.named.r, d = a.named.d;
            if (r === undefined && a.pos[0] !== undefined) r = a.pos[0];
            if (r === undefined && d !== undefined) r = numArg(d) / 2;
            r = Math.abs(numArg(r, 1)) || 1e-6;
            const fn = getFnFor(a, scope, r);
            const n = Math.max(3, fn), s = new THREE.Shape(), pts = [];
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
            const w = Math.max(Math.abs(numArg(size[0], 1)), 1e-6), h = Math.max(Math.abs(numArg(size[1], 1)), 1e-6);
            const center = !!a.named.center;
            const x0 = center ? -w / 2 : 0, y0 = center ? -h / 2 : 0;
            const s = new THREE.Shape();
            s.moveTo(x0, y0); s.lineTo(x0 + w, y0); s.lineTo(x0 + w, y0 + h); s.lineTo(x0, y0 + h); s.closePath();
            return [{ __shape2d: true, shapes: [s] }];
        },

        polygon(a, node) {
            const pts = getArg(a, 0, 'points', null);
            if (!Array.isArray(pts) || pts.length < 3) throw new SCADError('polygon(): butuh minimal 3 titik', node.line);
            const v2 = pts.map(p => new THREE.Vector2(numArg(p[0]), numArg(p[1])));
            return [{ __shape2d: true, shapes: [new THREE.Shape(v2)] }];
        },

        text(a, node, scope, ctx) {
            const str = getArg(a, 0, 'text', '');
            if (typeof str !== 'string') throw new SCADError('text(): text harus string', node.line);
            if (str.length === 0) return [];
            const size = Math.abs(numArg(getArg(a, 1, 'size', 10), 10)) || 10;
            let fontName = String(getArg(a, 2, 'font', DEFAULT_FONT));
            const halign = String(a.named.halign || 'left').toLowerCase();
            const valign = String(a.named.valign || 'baseline').toLowerCase();
            if (a.named.spacing !== undefined && numArg(a.named.spacing, 1) !== 1) ctx.warn('text(): parameter `spacing` belum didukung.');
            const useCJK = hasCJK(str);
            if (useCJK && fontName === DEFAULT_FONT) fontName = 'noto-jp';
            let shapes;
            if (isOpenTypeFont(fontName)) {
                const otShapes = generateTextShapesSync(fontName, str, size);
                if (otShapes === null) throw new SCADError(`text(): font '${fontName}' belum ready`, node.line);
                shapes = otShapes;
                if (!shapes || shapes.length === 0) return [];
            } else {
                try { shapes = getFont(fontName).generateShapes(str, size); }
                catch (e) { throw new SCADError(`text(): gagal generate shapes: ${e.message}`, node.line); }
                if (!shapes || shapes.length === 0) return [];
            }
            const box = computeShapesBounds(shapes);
            if (box.isEmpty()) return [];
            let dx = 0, dy = 0;
            switch (halign) {
                case 'center': dx = -(box.min.x + box.max.x) / 2; break;
                case 'right': dx = -box.max.x; break;
                default: dx = -box.min.x; break;
            }
            switch (valign) {
                case 'center': dy = -(box.min.y + box.max.y) / 2; break;
                case 'top': dy = -box.max.y; break;
                case 'bottom': dy = -box.min.y; break;
                default: dy = 0; break;
            }
            if (dx !== 0 || dy !== 0) for (const s of shapes) translateShape2D(s, dx, dy);
            return { __shape2d: true, shapes };
        },

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
            const m = new THREE.Matrix4().makeScale(
                numArg(v[0], 1) || 1e-6, numArg(v[1], 1) || 1e-6, numArg(v[2], 1) || 1e-6
            );
            return applyMatrixToChildren(m, node, scope, ctx);
        },

        mirror(a, node, scope, ctx) {
            let n = getArg(a, 0, 'v', [1, 0, 0]);
            if (isNum(n)) n = [n, 0, 0];
            const len = Math.hypot(n[0] || 0, n[1] || 0, n[2] || 0) || 1;
            const ux = (n[0] || 0) / len, uy = (n[1] || 0) / len, uz = (n[2] || 0) / len;
            const m = new THREE.Matrix4().set(
                1 - 2 * ux * ux, -2 * ux * uy, -2 * ux * uz, 0, -2 * uy * ux, 1 - 2 * uy * uy, -2 * uy * uz, 0,
                -2 * uz * ux, -2 * uz * uy, 1 - 2 * uz * uz, 0, 0, 0, 0, 1
            );
            return applyMatrixToChildren(m, node, scope, ctx);
        },

        color(a, node, scope, ctx) {
            const cv = getArg(a, 0, 'c', 'red');
            let col;
            try { col = Array.isArray(cv) ? new THREE.Color(numArg(cv[0], 1), numArg(cv[1], 0), numArg(cv[2], 0)) : new THREE.Color(String(cv)); }
            catch { col = new THREE.Color(0xf9d72c); }
            const kids = evalStatements(node.children, scope, ctx);
            for (const k of kids) {
                if (!k || !k.isObject3D) continue;
                k.traverse(o => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.color.copy(col); } });
            }
            return kids;
        },

        /* ---------- BOOLEAN ---------- */
        union(a, node, scope, ctx) {
            const kids = evalStatements(node.children, scope, ctx);
            if (kids.length === 0) return [];
            
            // GUNAKAN MANIFOLD UNTUK 2D UNION
            if (kids.every(is2D)) {
                if (isManifoldReady()) {
                    try {
                        const wasm = getWasm();
                        let resultM = null;
                        for (const k of kids) {
                            for (const s of k.shapes) {
                                const m = shapeToManifold2D(s, wasm);
                                if (!m) continue;
                                if (!resultM) resultM = m;
                                else resultM = resultM.add(m);
                            }
                        }
                        if (resultM) {
                            const geo = manifoldMeshToGeo(resultM.getMesh());
                            const shapes = extractShapesFromMesh(geo);
                            if (shapes.length > 0) return [{ __shape2d: true, shapes }];
                        }
                    } catch (e) { ctx.warn('Manifold 2D union failed: ' + e.message); }
                }
                return [combine2D(kids)];
            }
            
            if (isManifoldReady()) {
                try {
                    const manifolds = kids.map(k => objToManifold(k)).filter(Boolean);
                    if (manifolds.length > 0) {
                        let result = manifolds[0];
                        for (let i = 1; i < manifolds.length; i++) result = result.add(manifolds[i]);
                        const mesh = makeMesh(manifoldMeshToGeo(result.getMesh()));
                        const firstKid = kids.find(k => k && k.isMesh && k.material);
                        if (firstKid) mesh.material = firstKid.material.clone();
                        return [mesh];
                    }
                } catch (e) { ctx.warn('Manifold union failed: ' + e.message); }
            }
            const g = new THREE.Group();
            for (const k of kids) if (k && k.isObject3D) g.add(k);
            return [g];
        },

        difference(a, node, scope, ctx) {
            const kids = evalStatements(node.children, scope, ctx).filter(Boolean);
            if (kids.length === 0) return [];

            // GUNAKAN MANIFOLD UNTUK 2D DIFFERENCE
            if (kids.every(is2D)) {
                if (isManifoldReady()) {
                    try {
                        const wasm = getWasm();
                        let baseM = null;
                        for (const s of kids[0].shapes) {
                            const m = shapeToManifold2D(s, wasm);
                            if (!m) continue;
                            if (!baseM) baseM = m;
                            else baseM = baseM.add(m);
                        }
                        if (baseM) {
                            let resultM = baseM;
                            for (let i = 1; i < kids.length; i++) {
                                for (const s of kids[i].shapes) {
                                    const toolM = shapeToManifold2D(s, wasm);
                                    if (toolM) resultM = resultM.subtract(toolM);
                                }
                            }
                            const geo = manifoldMeshToGeo(resultM.getMesh());
                            const shapes = extractShapesFromMesh(geo);
                            if (shapes.length > 0) return [{ __shape2d: true, shapes }];
                        }
                    } catch (e) { ctx.warn('Manifold 2D difference failed: ' + e.message); }
                }
                
                // Fallback jika manifold gagal
                const base = kids[0];
                if (!base.shapes.length) return [];
                const newShapes = [];
                const holes = [];
                for (let i = 1; i < kids.length; i++) {
                    for (const s of kids[i].shapes) {
                        try { holes.push(new THREE.Path(shapePoints(s, 64))); } catch { }
                    }
                }
                for (const baseShape of base.shapes) {
                    const newShape = new THREE.Shape(baseShape.getPoints(64));
                    const baseBox = new THREE.Box2();
                    for (const p of newShape.getPoints(64)) baseBox.expandByPoint(p);

                    for (const h of holes) {
                        let overlaps = false;
                        for (const p of h.getPoints(64)) {
                            if (baseBox.containsPoint(p)) { overlaps = true; break; }
                        }
                        if (overlaps) newShape.holes.push(new THREE.Path(h.getPoints(64)));
                    }
                    newShapes.push(newShape);
                }
                return [{ __shape2d: true, shapes: newShapes }];
            }

            if (isManifoldReady()) {
                try {
                    const base = objToManifold(kids[0]);
                    if (base) {
                        let result = base;
                        for (let i = 1; i < kids.length; i++) {
                            const tool = objToManifold(kids[i]);
                            if (tool) result = result.subtract(tool);
                        }
                        const mesh = makeMesh(manifoldMeshToGeo(result.getMesh()));
                        const firstKid = kids.find(k => k && k.isMesh && k.material);
                        if (firstKid) mesh.material = firstKid.material.clone();
                        return [mesh];
                    }
                } catch (e) { ctx.warn('Manifold difference failed: ' + e.message); }
            }

            if (!CSG) { ctx.warn('difference() butuh three-bvh-csg'); return [kids[0]]; }
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

            if (isManifoldReady()) {
                try {
                    const manifolds = kids.map(k => objToManifold(k)).filter(Boolean);
                    if (manifolds.length >= 2) {
                        let result = manifolds[0];
                        for (let i = 1; i < manifolds.length; i++) result = result.intersect(manifolds[i]);
                        const mesh = makeMesh(manifoldMeshToGeo(result.getMesh()));
                        const firstKid = kids.find(k => k && k.isMesh && k.material);
                        if (firstKid) mesh.material = firstKid.material.clone();
                        return [mesh];
                    }
                } catch (e) { ctx.warn('Manifold intersection failed: ' + e.message); }
            }

            if (!CSG) { ctx.warn('intersection() butuh three-bvh-csg'); return [kids[0]]; }
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
            if (kids.length === 0) return [];

            /* 2D hull */
            if (kids.every(is2D)) {
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

            /* 3D hull (Manifold path) */
            if (isManifoldReady()) {
                try {
                    const flatPoints = [];
                    for (const k of kids) {
                        if (!k || !k.isObject3D) continue;
                        const geoms = collectWorldGeometries(k);
                        for (const g of geoms) {
                            const p = g.attributes.position.array;
                            for (let i = 0; i < p.length; i += 3) {
                                flatPoints.push(p[i], p[i+1], p[i+2]);
                            }
                            g.dispose();
                        }
                    }
                    if (flatPoints.length < 12) return [];

                    const wasm = getWasm();
                    
                    // KUNCI PERBAIKAN: konversi ke array of [x,y,z] tuples
                    const pointsArr = [];
                    for (let i = 0; i < flatPoints.length; i += 3) {
                        pointsArr.push([flatPoints[i], flatPoints[i+1], flatPoints[i+2]]);
                    }

                    let result = null;

                    // Coba Manifold.ofPoints (API terbaru, paling stabil)
                    if (typeof wasm.Manifold.ofPoints === 'function') {
                        try {
                            result = wasm.Manifold.ofPoints(pointsArr);
                        } catch (e) {
                            console.warn('[hull] ofPoints failed:', e.message);
                        }
                    }

                    // Fallback: coba Manifold.hull dengan Vec3[]
                    if (!result && typeof wasm.Manifold.hull === 'function') {
                        try {
                            result = wasm.Manifold.hull(pointsArr);
                        } catch (e) {
                            console.warn('[hull] Manifold.hull failed:', e.message);
                        }
                    }

                    if (result) {
                        return [makeMesh(manifoldMeshToGeo(result.getMesh()))];
                    }
                    // Kalau result masih null, jatuh ke ConvexGeometry di bawah (tanpa warning)
                } catch (e) {
                    // Silent — fallback ConvexGeometry akan menangani
                }
            }

            /* Fallback 3D hull (ConvexGeometry) */
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

        offset(a, node, scope, ctx) {
            const kids = evalStatements(node.children, scope, ctx).filter(Boolean);
            if (kids.length === 0) return [];
            const shapes2D = [], objs3D = [];
            for (const k of kids) {
                if (is2D(k)) shapes2D.push(...k.shapes);
                else if (k && k.isObject3D) objs3D.push(k);
            }
            if (shapes2D.length > 0 && objs3D.length > 0) throw new SCADError('offset(): child harus semua 2D atau semua 3D', node.line);
            if (objs3D.length > 0) return offset3DImpl(objs3D, a, node, scope, ctx);
            if (shapes2D.length === 0) { ctx.warn('offset(): butuh child 2D atau 3D.'); return []; }
            const r = a.named.r, delta = a.named.delta;
            let offsetVal, joinType, segments;
            if (r !== undefined) { offsetVal = numArg(r); joinType = 'round'; segments = Math.max(4, Math.min(getFnFor(a, scope), 64)); }
            else if (delta !== undefined) {
                offsetVal = numArg(delta);
                const join = a.named.join;
                joinType = join === 'round' ? 'round' : join === 'bevel' ? 'bevel' : 'miter';
                segments = 16;
            } else throw new SCADError('offset(): butuh r= atau delta=', node.line);
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

        minkowski(a, node, scope, ctx) {
            const kids = evalStatements(node.children, scope, ctx).filter(Boolean);
            if (kids.length !== 2) throw new SCADError('minkowski(): butuh tepat 2 child', node.line);
            const [A, B] = kids;
            if (is2D(A) !== is2D(B)) throw new SCADError('minkowski(): kedua child harus 2D atau 3D', node.line);
            if (is2D(A)) {
                const aPts = [], bPts = [];
                for (const sh of A.shapes) for (const p of shapePoints(sh, 64)) aPts.push(p);
                for (const sh of B.shapes) for (const p of shapePoints(sh, 64)) bPts.push(p);
                if (aPts.length === 0 || bPts.length === 0) return [];
                const sumPts = [];
                for (const ap of aPts) for (const bp of bPts) sumPts.push(new THREE.Vector2(ap.x + bp.x, ap.y + bp.y));
                const hullPts = convexHull2D(sumPts);
                if (hullPts.length < 3) return [];
                return [{ __shape2d: true, shapes: [new THREE.Shape(hullPts)] }];
            } else {
                const aPts = collectPoints3D(A), bPts = collectPoints3D(B);
                if (aPts.length === 0 || bPts.length === 0) return [];
                const sumPts = [];
                for (const ap of aPts) for (const bp of bPts) sumPts.push(new THREE.Vector3(ap.x + bp.x, ap.y + bp.y, ap.z + bp.z));
                if (sumPts.length > 60000) ctx.warn('minkowski(): vertex count besar');
                try { return [makeMesh(new ConvexGeometry(sumPts))]; }
                catch { ctx.warn('minkowski(): gagal.'); return []; }
            }
        },

        linear_extrude(a, node, scope, ctx) {
            const h = Math.abs(numArg(getArg(a, 0, 'height', 1), 1)) || 1e-6;
            const center = !!a.named.center;
            const fn = getFnFor(a, scope, null);
            const kids = evalStatements(node.children, scope, ctx);
            const shapes = [];
            for (const k of kids) if (is2D(k)) shapes.push(...k.shapes);
            if (shapes.length === 0) { ctx.warn('linear_extrude(): butuh child 2D.'); return []; }
            const meshes = [];
            for (const s of shapes) {
                try {
                    const hasCurves = shapeHasCurves(s);
                    const curveSegments = hasCurves ? Math.max(8, Math.min(fn, 128)) : 1;
                    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments, steps: 1 });
                    if (center) g.translate(0, 0, -h / 2);
                    meshes.push(makeMesh(g));
                } catch (e) { ctx.warn('linear_extrude(): gagal (' + e.message + ')'); }
            }
            return meshes;
        },

        rotate_extrude(a, node, scope, ctx) {
            const angle = numArg(getArg(a, 0, 'angle', 360), 360);
            const kids = evalStatements(node.children, scope, ctx);
            const shapes = [];
            for (const k of kids) if (is2D(k)) shapes.push(...k.shapes);
            if (shapes.length === 0) { ctx.warn('rotate_extrude(): butuh child 2D.'); return []; }
            let maxR = 0;
            for (const s of shapes) for (const p of shapePoints(s, 64)) if (p.x > maxR) maxR = p.x;
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
                if (negative) ctx.warn('rotate_extrude(): x < 0 di-clamp ke 0.');
                try {
                    const g = new THREE.LatheGeometry(v2, Math.max(3, fn), 0, angle * DEG);
                    g.rotateX(Math.PI / 2);
                    meshes.push(makeMesh(g));
                } catch (e) { ctx.warn('rotate_extrude(): gagal (' + e.message + ')'); }
            }
            return meshes;
        }
    };
}