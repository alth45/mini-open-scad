import { STLExporter } from 'three/addons/exporters/STLExporter.js';
/**
 * Export THREE.Object3D (model root) ke file STL.
 * @returns {{ ok: boolean, name?: string, size?: number, error?: string }}
 */
export function exportSTL(modelRoot) {
  if (!modelRoot || modelRoot.children.length === 0) {
    return { ok: false, error: 'Tidak ada model untuk diekspor. Render dulu.' };
  }
  try {
    modelRoot.updateMatrixWorld(true);
    const exporter = new STLExporter();
    const data = exporter.parse(modelRoot, { binary: true });

    const blob = new Blob([data], { type: 'application/octet-stream' });
    const name = `model_${Date.now()}.stl`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    return { ok: true, name, size: blob.size };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}