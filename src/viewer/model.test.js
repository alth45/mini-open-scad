import { describe, it, expect, vi } from "vitest";
import { buildModel } from "./model.js";
import { PRESETS } from "../config.js";

// Mock manifold engine agar tidak mencoba fetch WASM di Node.js
vi.mock("../evaluator/manifold-engine.js", () => ({
  isManifoldReady: () => false,
  getWasm: () => null,
  objToManifold: () => null,
  manifoldMeshToGeo: () => null,
  initManifold: async () => ({}),
}));

describe("Golden Test: 8 Presets", () => {
  // Iterasi setiap preset di CONFIG
  for (const [name, code] of Object.entries(PRESETS)) {
    it(`harus merender preset '${name}' dengan geometri valid`, () => {
      // Render tanpa paramValues, dan previewMode = true
      const result = buildModel(code, {}, {}, true, null);

      // 1. Pastikan tidak ada error
      expect(result.warnings).toEqual([]); // Fallback CSG biasanya aman, jika ada warning berarti ada bug

      // 2. Pastikan menghasilkan mesh dan triangle
      expect(result.meshCount).toBeGreaterThan(0);
      expect(result.triCount).toBeGreaterThan(0);
      expect(result.vertexCount).toBeGreaterThan(0);

      // 3. Pastikan Bounding Box tidak kosong (opsional, memastikan geometri punya volume)
      let hasVolume = false;
      result.root.traverse((o) => {
        if (o.isMesh && o.geometry) {
          o.geometry.computeBoundingBox();
          const box = o.geometry.boundingBox;
          if (box && !box.isEmpty()) {
            hasVolume = true;
          }
        }
      });
      expect(hasVolume).toBe(true);
    });
  }
});
