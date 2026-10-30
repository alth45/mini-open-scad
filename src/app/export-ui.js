import { state } from '../state.js';
import { createDropdown } from '../ui/dropdown.js';
import { log } from '../ui/console.js';
import { toast } from '../ui/status.js';
import { exportSTL, exportOBJ, exportGLTF, exportPLY, export3MF } from '../export.js';
import { exportProjectZip } from '../project-backup.js';
import { downloadBlob, timestampForFile } from '../utils.js';
import { exportSVG, exportDXF } from '../export-2d.js'; // <-- IMPORT BARU


export function initExportUI(deps) {
    const { viewer, editor, tabManager } = deps;

    async function handleExport(format) {
        if (format === 'scad') {
            if (typeof window.exportScad === 'function') window.exportScad();
            else toast('⚠ SCAD export tidak tersedia');
            return;
        }
        // --- EXPORT 2D (SVG & DXF) ---
        if (format === 'svg' || format === 'dxf') {
            const shapes = state.last2dShapes || [];
            if (shapes.length === 0) {
                toast('⚠ Tidak ada objek 2D. Gunakan circle(), square(), atau polygon() di root.');
                return;
            }
            const result = format === 'svg' ? exportSVG(shapes) : exportDXF(shapes);
            if (result.ok) {
                log('ok', `Export ${format.toUpperCase()}: ${result.name} (${(result.size / 1024).toFixed(1)} KB)`);
                toast(`⬇ ${format.toUpperCase()} saved`);
            } else {
                log('warn', result.error);
                toast('⚠ ' + result.error);
            }
            return;
        }
        /* export 3d*/
        let result;
        try {
            switch (format) {
                case 'stl': result = exportSTL(viewer.modelRoot); break;
                case 'obj': result = exportOBJ(viewer.modelRoot); break;
                case 'glb': result = await exportGLTF(viewer.modelRoot, { binary: true }); break;
                case 'gltf': result = await exportGLTF(viewer.modelRoot, { binary: false }); break;
                case 'ply': result = exportPLY(viewer.modelRoot, { binary: true }); break;
                case '3mf': result = export3MF(viewer.modelRoot); break;
            }
        } catch (e) { result = { ok: false, error: e.message }; }
        
        if (result?.ok) {
            log('ok', `Export ${format.toUpperCase()}: ${result.name} (${(result.size / 1024).toFixed(1)} KB)`);
            toast(`⬇ ${format.toUpperCase()} saved`);
        } else { log('warn', result?.error || 'Export gagal'); toast('⚠ ' + (result?.error || 'Export gagal')); }
    }

    createDropdown({
        container: document.getElementById('exportDropdown'),
        placeholder: 'Export', icon: '<i class="fa-solid fa-download"></i>', resetAfterSelect: true,
        items: [
            { value: 'stl', label: 'STL', description: '3D print · binary' },
            { value: '3mf', label: '3MF', description: '3D print modern · ZIP' },
            { value: 'obj', label: 'OBJ', description: 'Wavefront · no color' },
            { value: 'glb', label: 'GLB', description: 'glTF binary · PBR' },
            { value: 'gltf', label: 'glTF', description: 'JSON · readable' },
            { value: 'svg', label: 'SVG', description: '2D Vector · Laser/CNC' }, 
            { value: 'dxf', label: 'DXF', description: '2D AutoCAD · Laser/CNC' }, 
            { value: 'ply', label: 'PLY', description: 'Mesh + colors' },
            { value: 'scad', label: '.scad', description: 'Source code' },
        ],
        onSelect: (value) => handleExport(value),
    });

    const btnSaveProject = document.getElementById('btnSaveProject');
    if (btnSaveProject) {
        btnSaveProject.addEventListener('click', async () => {
            const tab = tabManager.active; if (!tab) return;
            try {
                toast('📦 Packing project…');
                const res = await exportProjectZip(tab);
                log('ok', `Project saved: ${res.name} (${(res.size / 1024).toFixed(1)} KB)`);
                toast('📦 Project Saved');
            } catch (e) { log('error', 'Save project gagal: ' + e.message); toast('✖ Save gagal'); }
        });
    }
}