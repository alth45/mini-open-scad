/**
 * Thumbnail generator untuk file di Files Manager.
 * - STL → offscreen 3D render (240×240 PNG data URL)
 * - SCAD → text preview (first 30 lines)
 *
 * Cache in-memory by `${name}:${size}` — invalidated naturally
 * saat file di-replace dengan size berbeda.
 */
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

const cache = new Map();

const MAX_STL_PREVIEW_BYTES = 50 * 1024 * 1024; // 50 MB

export async function generateThumbnail(
  name,
  buffer,
  size,
  { resolution = 240 } = {},
) {
  const key = `${name}:${size}`;
  if (cache.has(key)) return cache.get(key);

  const isSTL = /\.stl$/i.test(name);
  const isSCAD = /\.scad$/i.test(name);

  let result;

  if (isSTL) {
    if (size > MAX_STL_PREVIEW_BYTES) {
      result = {
        url: null,
        triangles: 0,
        error: "File terlalu besar untuk preview (>50 MB)",
      };
    } else {
      result = renderSTLThumbnail(buffer, resolution);
    }
  } else if (isSCAD) {
    result = renderSCADPreview(buffer);
  } else {
    result = { url: null, triangles: 0, error: "Tipe file tidak didukung" };
  }

  cache.set(key, result);
  return result;
}

export function clearThumbnailCache() {
  cache.clear();
}

/* ============================================================ */

function renderSTLThumbnail(buffer, resolution) {
  return new Promise((resolve) => {
    let renderer = null;
    let geo = null;
    let mat = null;

    try {
      geo = new STLLoader().parse(buffer);
      if (!geo.attributes.normal) geo.computeVertexNormals();

      geo.computeBoundingBox();
      const box = geo.boundingBox;
      const center = new THREE.Vector3();
      box.getCenter(center);
      const dims = new THREE.Vector3();
      box.getSize(dims);
      const maxDim = Math.max(dims.x, dims.y, dims.z) || 1;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1e1e1e);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a3a, 1.0));
      const dl1 = new THREE.DirectionalLight(0xffffff, 2.0);
      dl1.position.set(1, -1.4, 2.2);
      scene.add(dl1);
      const dl2 = new THREE.DirectionalLight(0xaaccff, 0.9);
      dl2.position.set(-1.6, 1.2, 0.6);
      scene.add(dl2);

      mat = new THREE.MeshStandardMaterial({
        color: 0xf9d72c,
        roughness: 0.55,
        metalness: 0.12,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(center).multiplyScalar(-1);
      scene.add(mesh);

      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e5);
      const fitH = maxDim / (2 * Math.tan((45 * Math.PI) / 360));
      const dist = fitH * 1.8;
      camera.up.set(0, 0, 1);
      camera.position.set(dist * 0.85, -dist * 1.0, dist * 0.72);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setSize(resolution, resolution, false);
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x1e1e1e, 1);
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL("image/png");

      const triCount = geo.index
        ? geo.index.count / 3
        : (geo.attributes.position?.count || 0) / 3;

      resolve({ url, triangles: Math.round(triCount), error: null });
    } catch (e) {
      resolve({
        url: null,
        triangles: 0,
        error: e.message || "STL parse gagal",
      });
    } finally {
      try {
        if (renderer) {
          renderer.dispose();
          if (typeof renderer.forceContextLoss === "function") {
            renderer.forceContextLoss();
          }
        }
        if (geo) geo.dispose();
        if (mat) mat.dispose();
      } catch {
        /* ignore cleanup errors */
      }
    }
  });
}

function renderSCADPreview(buffer) {
  try {
    const text = new TextDecoder().decode(buffer);
    const lines = text.split("\n").slice(0, 30);
    const truncated = text.split("\n").length > 30;
    return {
      url: null,
      triangles: 0,
      error: null,
      isText: true,
      text: lines.join("\n") + (truncated ? "\n// … (truncated)" : ""),
    };
  } catch (e) {
    return {
      url: null,
      triangles: 0,
      error: e.message || "SCAD decode gagal",
      isText: true,
    };
  }
}
