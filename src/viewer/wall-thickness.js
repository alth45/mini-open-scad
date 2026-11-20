/**
 * Wall Thickness Analyzer — raycast per triangle centroid ke arah inward
 * normal, ukur jarak ke permukaan berikutnya = ketebalan dinding lokal.
 *
 * Optimasi:
 *   - three-mesh-bvh → BVH acceleration (~100× speedup)
 *   - raycastFirst (firstHitOnly) → skip hit kedua+
 *   - Sample subset untuk mesh besar (cap ~3000 rays)
 *   - Yield ke event loop tiap 200 rays → UI tetap responsif
 *
 * Threshold standar FDM:
 *   - < 0.8mm  → terlalu tipis (perlu redesign / nozzle lebih kecil)
 *   - 0.8-1.2mm → marginal (bisa tapi riskan)
 *   - > 1.2mm  → aman
 */
import * as THREE from "three";
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from "three-mesh-bvh";

// Extend prototype once (idempotent)
if (!THREE.BufferGeometry.prototype.computeBoundsTree) {
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
}

export const THRESHOLDS = {
  thin: 0.8, // mm — below = red (fail)
  marginal: 1.2, // mm — below = orange (warning)
  // above = green (safe)
};

export const MAX_RAY_DISTANCE = 50; // mm — beyond this = "thick" (safe)

const MAX_SAMPLES_TARGET = 3000;

function pickSampleCount(triCount) {
  if (triCount <= 1500) return triCount;
  if (triCount <= 10000) return 1500;
  if (triCount <= 50000) return 2000;
  return MAX_SAMPLES_TARGET;
}

function thicknessToColor(thickness) {
  const c = new THREE.Color();
  if (!Number.isFinite(thickness)) {
    c.setHex(0x60a5fa); // blue — no hit (open mesh / >MAX_RAY_DISTANCE)
  } else if (thickness < THRESHOLDS.thin) {
    c.setHex(0xff3030); // red — too thin
  } else if (thickness < THRESHOLDS.marginal) {
    c.setHex(0xffaa00); // orange — marginal
  } else {
    c.setHex(0x30d060); // green — safe
  }
  return c;
}

/**
 * Hitung wall thickness per triangle dan apply vertex colors.
 *
 * @param {THREE.Mesh} mesh
 * @param {{ onProgress?: (done: number, total: number) => void }} options
 * @returns {Promise<Stats>}
 */
export async function computeWallThickness(mesh, options = {}) {
  const { onProgress = null } = options;

  const geometry = mesh.geometry;
  if (!geometry || !geometry.attributes.position) {
    throw new Error("Mesh tidak punya geometry valid");
  }

  mesh.updateMatrixWorld(true);

  const pos = geometry.attributes.position;
  const indexed = !!geometry.index;
  const idx = geometry.index;
  const triCount = indexed ? idx.count / 3 : pos.count / 3;
  if (triCount < 1) throw new Error("Mesh kosong");

  // Build BVH sekali (cache di geometry)
  if (!geometry.boundsTree) {
    geometry.computeBoundsTree();
  }

  const sampleCount = pickSampleCount(triCount);
  const step = Math.max(1, Math.floor(triCount / sampleCount));
  const totalSamples = Math.ceil(triCount / step);

  const colors = new Float32Array(pos.count * 3).fill(0.5);
  const thicknessPerVertex = new Float32Array(pos.count).fill(-1);

  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  raycaster.near = 0.02; // skip self-hit
  raycaster.far = MAX_RAY_DISTANCE;

  // Handle mirrored meshes (det < 0) — winding flipped, normal points inward
  const det = mesh.matrixWorld.determinant();
  const flipNormal = det < 0;

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const rayDir = new THREE.Vector3();

  const colorCache = new Map();
  let processed = 0;

  const getIdx = (t, k) => (indexed ? idx.getX(t * 3 + k) : t * 3 + k);

  for (let t = 0; t < triCount; t += step) {
    const i0 = getIdx(t, 0);
    const i1 = getIdx(t, 1);
    const i2 = getIdx(t, 2);

    vA.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
    vB.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
    vC.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);

    origin
      .addVectors(vA, vB)
      .add(vC)
      .multiplyScalar(1 / 3);

    ab.subVectors(vB, vA);
    ac.subVectors(vC, vA);
    normal.crossVectors(ab, ac);
    const nlen = normal.length();
    if (nlen < 1e-9) {
      processed++;
      continue; // degenerate triangle
    }
    normal.divideScalar(nlen);

    // Ray direction = inward
    // Non-mirrored: face normal (from transformed vertices) points outward → inward = -normal
    // Mirrored:       face normal points inward (flipped winding) → inward = +normal
    rayDir.copy(normal);
    if (!flipNormal) rayDir.negate();

    raycaster.set(origin, rayDir);
    let thickness = Infinity;
    try {
      const hits = raycaster.intersectObject(mesh, false);
      if (hits.length > 0) thickness = hits[0].distance;
    } catch {
      // raycast fail → treat as open
    }

    let color = colorCache.get(thickness);
    if (!color) {
      color = thicknessToColor(thickness);
      colorCache.set(thickness, color);
    }

    for (const vi of [i0, i1, i2]) {
      if (thicknessPerVertex[vi] === -1) {
        thicknessPerVertex[vi] = thickness;
        colors[vi * 3] = color.r;
        colors[vi * 3 + 1] = color.g;
        colors[vi * 3 + 2] = color.b;
      }
    }

    processed++;

    // Yield every 200 samples to keep UI responsive
    if (processed % 200 === 0) {
      onProgress?.(processed, totalSamples);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.(totalSamples, totalSamples);

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  return computeStats(thicknessPerVertex);
}

/**
 * @returns {{ min, max, avg, count, thinCount, marginalCount, safeCount, openCount, thresholds }}
 */
function computeStats(thicknessPerVertex) {
  let min = Infinity,
    max = 0,
    sum = 0,
    count = 0;
  let thinCount = 0,
    marginalCount = 0,
    safeCount = 0,
    openCount = 0;

  for (const t of thicknessPerVertex) {
    if (t === -1) continue; // unassigned
    if (!Number.isFinite(t)) {
      openCount++;
      continue;
    }
    if (t < min) min = t;
    if (t > max) max = t;
    sum += t;
    count++;
    if (t < THRESHOLDS.thin) thinCount++;
    else if (t < THRESHOLDS.marginal) marginalCount++;
    else safeCount++;
  }

  return {
    min: count > 0 ? min : 0,
    max: count > 0 ? max : 0,
    avg: count > 0 ? sum / count : 0,
    count,
    thinCount,
    marginalCount,
    safeCount,
    openCount,
    thresholds: THRESHOLDS,
  };
}

/**
 * Bersihkan artifacts: hapus color attribute + dispose BVH.
 */
export function disposeWallThickness(mesh) {
  if (!mesh?.geometry) return;
  if (mesh.geometry.attributes.color) {
    mesh.geometry.deleteAttribute("color");
  }
  if (mesh.geometry.boundsTree) {
    mesh.geometry.disposeBoundsTree?.();
    delete mesh.geometry.boundsTree;
  }
}
