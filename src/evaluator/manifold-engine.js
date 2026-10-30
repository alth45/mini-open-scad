import Module from 'manifold-3d';
import * as THREE from 'three';
import { makeMesh } from './geometry.js';
import { cleanGeometry } from './mesh-utils.js';

let wasm = null;
let setupPromise = null;
let manifoldAvailable = false;

export async function initManifold() {
  if (wasm) return wasm;
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    try {
      wasm = await Module({
        locateFile: (path) => {
          if (path.endsWith('.wasm')) return '/manifold.wasm';
          return path;
        }
      });
      wasm.setup();
      manifoldAvailable = true;
      console.log('✅ [manifold] engine ready — STL akan 100% watertight!');
    } catch (e) {
      console.warn('❌ [manifold] failed to init:', e);
      manifoldAvailable = false;
    }
    return wasm;
  })();
  return setupPromise;
}

export function isManifoldReady() {
  return manifoldAvailable;
}

export function getWasm() {
  return wasm;
}

/** Memastikan arah putar segitiga (winding) menghadap ke luar (volume positif) */
function fixWinding(geo) {
    const pos = geo.attributes.position;
    const idx = geo.index;
    if (!idx) return geo;
    
    let vol = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < idx.count; i += 3) {
        a.fromBufferAttribute(pos, idx.getX(i));
        b.fromBufferAttribute(pos, idx.getX(i + 1));
        c.fromBufferAttribute(pos, idx.getX(i + 2));
        vol += a.dot(b.cross(c)) / 6;
    }
    
    if (vol < 0) {
        const arr = idx.array.slice();
        for (let i = 0; i < arr.length; i += 3) {
            const tmp = arr[i];
            arr[i] = arr[i + 2];
            arr[i + 2] = tmp;
        }
        geo.setIndex(new THREE.BufferAttribute(arr, 1));
    }
    return geo;
}

export function objToManifold(obj) {
  if (!obj) return null;
  
  // KUNCI PERBAIKAN: Paksa update matrix transformasi (translate/rotate/scale)
  obj.updateMatrixWorld(true); 

  if (obj.isMesh && obj.geometry) {
    let g = obj.geometry.clone();
    g.applyMatrix4(obj.matrixWorld);
    
    // Bersihkan dan perbaiki arah normal
    g = cleanGeometry(g, { keepNormal: false });
    g = fixWinding(g);

    const pos = g.attributes.position;
    const idx = g.index;
    if (!pos) return null;

    const vertProperties = new Float32Array(pos.array);
    let triVerts;
    if (idx) {
      triVerts = new Uint32Array(idx.array);
    } else {
      triVerts = new Uint32Array(pos.count);
      for (let i = 0; i < pos.count; i++) triVerts[i] = i;
    }

    try {
      const mesh = new wasm.Mesh({ numProp: 3, vertProperties, triVerts });
      return new wasm.Manifold(mesh);
    } catch (e) {
      console.warn('[manifold] gagal membuat mesh dari geometri:', e);
      return null;
    }
  }
  
  if (obj.children && obj.children.length > 0) {
    const manifolds = [];
    for (const child of obj.children) {
      const m = objToManifold(child);
      if (m) manifolds.push(m);
    }
    if (manifolds.length === 0) return null;
    if (manifolds.length === 1) return manifolds[0];
    
    let result = manifolds[0];
    for (let i = 1; i < manifolds.length; i++) {
      result = result.add(manifolds[i]);
    }
    return result;
  }
  
  return null;
}

export function manifoldMeshToGeo(mesh) {
  let geo = new THREE.BufferGeometry();
  const numProp = mesh.numProp || 3;
  const props = mesh.vertProperties;

  if (numProp > 3) {
    const out = new Float32Array(mesh.numVert * 3);
    for (let i = 0; i < mesh.numVert; i++) {
      out[i * 3] = props[i * numProp];
      out[i * 3 + 1] = props[i * numProp + 1];
      out[i * 3 + 2] = props[i * numProp + 2];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
  } else {
    geo.setAttribute('position', new THREE.BufferAttribute(props.slice(), 3));
  }

  geo.setIndex(new THREE.BufferAttribute(mesh.triVerts.slice(), 1));
  
  const nonIndexed = geo.toNonIndexed();
  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

export function manifoldToMeshObject(manifold) {
  if (!manifold) return null;
  const mesh = manifold.getMesh();
  const geo = manifoldMeshToGeo(mesh);
  return makeMesh(geo);
}