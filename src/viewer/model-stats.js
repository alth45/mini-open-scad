import * as THREE from "three";

/**
 * Hitung statistik 3D dari model root.
 * - volume via signed tetrahedron sum (divergence theorem)
 * - area via cross product per triangle
 * - weight PLA: volume × 1.24 g/cm³ (solid, tanpa infill)
 * - filament 1.75mm: volume / (π · r²)
 *
 * @param {THREE.Object3D} root
 */
export function computeModelStats(root) {
  const stats = {
    volume: 0,
    area: 0,
    size: { x: 0, y: 0, z: 0 },
    center: { x: 0, y: 0, z: 0 },
    triangles: 0,
    vertices: 0,
    meshes: 0,
    weightGrams: 0,
    filamentMeters: 0,
  };
  if (!root) return stats;

  root.updateMatrixWorld(true);

  const box = new THREE.Box3();
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const cross = new THREE.Vector3();

  let signedVolume = 0;

  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    stats.meshes++;

    const geo = o.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index;
    const m = o.matrixWorld;

    const triCount = idx ? idx.count / 3 : pos.count / 3;
    stats.triangles += triCount;
    stats.vertices += pos.count;

    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

      vA.fromBufferAttribute(pos, i0).applyMatrix4(m);
      vB.fromBufferAttribute(pos, i1).applyMatrix4(m);
      vC.fromBufferAttribute(pos, i2).applyMatrix4(m);

      box.expandByPoint(vA);
      box.expandByPoint(vB);
      box.expandByPoint(vC);

      ab.subVectors(vB, vA);
      ac.subVectors(vC, vA);
      cross.crossVectors(ab, ac);
      stats.area += cross.length() * 0.5;

      signedVolume += vA.dot(cross) / 6;
    }
  });

  stats.volume = Math.abs(signedVolume);

  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    stats.size = { x: size.x, y: size.y, z: size.z };
    stats.center = { x: center.x, y: center.y, z: center.z };
  }

  // PLA density 1.24 g/cm³ ; input mm³ → cm³ / 1000
  stats.weightGrams = (stats.volume / 1000) * 1.24;

  // Filament 1.75 mm (radius 0.875 mm)
  const filamentMm = stats.volume / (Math.PI * 0.875 * 0.875);
  stats.filamentMeters = filamentMm / 1000;

  return stats;
}

export function formatVolume(mm3) {
  if (!Number.isFinite(mm3) || mm3 <= 0) return "0";
  if (mm3 < 1) return (mm3 * 1000).toFixed(0) + " μm³";
  if (mm3 < 1000) return mm3.toFixed(1) + " mm³";
  return (mm3 / 1000).toFixed(2) + " cm³";
}

export function formatArea(mm2) {
  if (!Number.isFinite(mm2) || mm2 <= 0) return "0";
  if (mm2 < 100) return mm2.toFixed(1) + " mm²";
  return (mm2 / 100).toFixed(2) + " cm²";
}

export function formatWeight(g) {
  if (!Number.isFinite(g) || g <= 0) return "0 g";
  if (g < 1) return (g * 1000).toFixed(0) + " mg";
  return g.toFixed(1) + " g";
}

export function formatFilament(m) {
  if (!Number.isFinite(m) || m <= 0) return "0 m";
  if (m < 0.1) return (m * 100).toFixed(0) + " cm";
  return m.toFixed(2) + " m";
}
