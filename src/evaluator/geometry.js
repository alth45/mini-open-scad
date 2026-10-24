import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';

export function makeMaterial() {
  return new THREE.MeshStandardMaterial({
    color: CONFIG.defaultColor,
    roughness: 0.55,
    metalness: 0.12,
    side: THREE.DoubleSide,
    flatShading: false
  });
}

export function makeMesh(geometry) {
  const m = new THREE.Mesh(geometry, makeMaterial());
  m.userData.scad = true;
  return m;
}

export const is2D = o => o && o.__shape2d === true;

export function combine2D(list) {
  const shapes = [];
  for (const s of list) if (is2D(s)) shapes.push(...s.shapes);
  return { __shape2d: true, shapes };
}

export function shapePoints(shape, divisions = 64) {
  const raw = [];
  for (const curve of shape.curves) {
    const pts = curve.getPoints(curve.type === 'LineCurve' ? 1 : divisions);
    for (const p of pts) raw.push(p);
  }
  const out = [];
  for (const p of raw) {
    if (out.length === 0 || out[out.length - 1].distanceTo(p) > 1e-7) out.push(p);
  }
  return out;
}

export function transformShape2D(s2d, m) {
  const shapes = [];
  for (const sh of s2d.shapes) {
    const pts = shapePoints(sh, 64).map(p => {
      const v = new THREE.Vector3(p.x, p.y, 0).applyMatrix4(m);
      return new THREE.Vector2(v.x, v.y);
    });
    if (pts.length < 3) continue;
    shapes.push(new THREE.Shape(pts));
  }
  return { __shape2d: true, shapes };
}

export function collectWorldGeometries(obj) {
  const out = [];
  if (!obj) return out;
  obj.updateMatrixWorld(true);
  obj.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    let g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (g.index) {
      const ng = g.toNonIndexed();
      g.dispose();
      g = ng;
    }
    if (o.matrixWorld.determinant() < 0) {
      const p = g.attributes.position.array;
      for (let i = 0; i < p.length; i += 9) {
        for (let k = 0; k < 3; k++) {
          const tmp = p[i + k]; p[i + k] = p[i + 6 + k]; p[i + 6 + k] = tmp;
        }
      }
      g.attributes.position.needsUpdate = true;
      g.deleteAttribute('normal');
      g.computeVertexNormals();
    }
    const pos = g.attributes.position;
    let nrm = g.attributes.normal;
    if (!nrm) { g.computeVertexNormals(); nrm = g.attributes.normal; }
    const ng2 = new THREE.BufferGeometry();
    ng2.setAttribute('position', pos.clone());
    ng2.setAttribute('normal', nrm.clone());
    out.push(ng2);
    g.dispose();
  });
  return out;
}

export function mergeWorldGeometries(obj) {
  const geoms = collectWorldGeometries(obj);
  if (geoms.length === 0) return null;
  if (geoms.length === 1) return geoms[0];
  const merged = mergeGeometries(geoms, false);
  geoms.forEach(g => g.dispose());
  return merged || null;
}

/* ============================================================
   Helpers untuk offset() / minkowski() / 2D hull
   ============================================================ */

/** Buang titik duplikat berurutan. */
export function dedupePoints(pts, eps = 1e-7) {
  const out = [];
  for (const p of pts) {
    if (!out.length || out[out.length - 1].distanceTo(p) > eps) out.push(p);
  }
  if (out.length > 1 && out[0].distanceTo(out[out.length - 1]) < eps) out.pop();
  return out;
}

/** THREE.Shape (termasuk holes) → { outer: Vector2[], holes: Vector2[][] } */
export function shapeToPolygon(shape, divisions = 64) {
  const outer = dedupePoints(shapePoints(shape, divisions));
  const holes = [];
  for (const h of (shape.holes || [])) {
    const pts = dedupePoints(h.getPoints(divisions));
    if (pts.length >= 3) holes.push(pts);
  }
  return { outer, holes };
}

/** Convex hull 2D via monotone chain (Andrew). */
export function convexHull2D(points) {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o, a, b) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}