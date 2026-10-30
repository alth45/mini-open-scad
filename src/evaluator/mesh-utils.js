import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Membersihkan geometri: Weld vertices, hapus degenerate triangles, rebuild normals.
 */
export function cleanGeometry(geometry, { keepNormal = false } = {}) {
  if (!geometry) return null;
  let geo = geometry.clone();

  // Hapus atribut yang tidak perlu
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  if (geo.attributes.color) geo.deleteAttribute('color');
  
  // Hapus normal lama (biar dihitung ulang)
  if (!keepNormal && geo.attributes.normal) {
    geo.deleteAttribute('normal');
  }

  try {
    // Toleransi 0.0001 (0.1 mikron) untuk menyatukan vertex yang hampir sama
    geo = mergeVertices(geo, 1e-4);
  } catch (e) {
    console.warn('[mesh-utils] mergeVertices failed:', e);
  }

  // Filter degenerate triangles (segitiga dengan luas ~0)
  const pos = geo.attributes.position;
  const index = geo.index;
  if (index) {
    const newIndices = [];
    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3();
    
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      
      vA.fromBufferAttribute(pos, a);
      vB.fromBufferAttribute(pos, b);
      vC.fromBufferAttribute(pos, c);
      
      ab.subVectors(vB, vA);
      ac.subVectors(vC, vA);
      
      // Luas segitiga > 0 (cross product)
      if (ab.cross(ac).lengthSq() > 1e-10) {
        newIndices.push(a, b, c);
      }
    }
    geo.setIndex(newIndices);
  }

  if (!keepNormal) {
    geo.computeVertexNormals();
  }

  return geo;
}