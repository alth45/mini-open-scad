import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { listFiles, loadFiles, saveFile } from './files/file-store.js';
import { downloadBlob, timestampForFile } from './utils.js';

/**
 * Mengemas project aktif + semua file STL/SCAD di IndexedDB menjadi .zip
 */
export async function exportProjectZip(tab) {
    if (!tab) throw new Error('Tidak ada tab aktif');

    // 1. Ambil semua file dari IndexedDB
    const allFiles = await listFiles();
    const fileNames = allFiles.map(f => f.name);
    const buffers = await loadFiles(fileNames);

    // 2. Siapkan isi ZIP
    const zipContent = {
        'project.json': strToU8(JSON.stringify({
            name: tab.name,
            code: tab.code,
            paramValues: tab.paramValues,
            autoRender: tab.autoRender,
            previewMode: tab.previewMode
        }))
    };

    // 3. Masukkan semua file ke dalam folder 'files/' di dalam zip
    for (const name of fileNames) {
        if (buffers[name]) {
            // buffers[name] adalah ArrayBuffer, fflate butuh Uint8Array
            zipContent[`files/${name}`] = new Uint8Array(buffers[name]);
        }
    }

    // 4. Buat ZIP dan unduh
    const zipped = zipSync(zipContent, { level: 6 });
    const blob = new Blob([zipped], { type: 'application/zip' });
    
    const safeName = (tab.name || 'project').replace(/[^\w-]/g, '_').slice(0, 40);
    const fileName = `${safeName}_${timestampForFile()}.zip`;
    
    downloadBlob(blob, fileName);
    return { ok: true, name: fileName, size: blob.size };
}

/**
 * Membaca file .zip dan mengembalikan data project & me-restore file ke IndexedDB
 */
export async function importProjectZip(arrayBuffer) {
    const unzipped = unzipSync(new Uint8Array(arrayBuffer));
    
    if (!unzipped['project.json']) {
        throw new Error('Bukan file Mini OpenSCAD Project yang valid (project.json tidak ditemukan)');
    }
    
    // 1. Baca metadata
    const metaStr = strFromU8(unzipped['project.json']);
    const meta = JSON.parse(metaStr);

    // 2. Restore semua file ke IndexedDB
    let savedCount = 0;
    for (const [path, data] of Object.entries(unzipped)) {
        if (path.startsWith('files/')) {
            const fileName = path.replace('files/', '');
            const type = fileName.endsWith('.scad') ? 'text/x-scad' : 'model/stl';
            
            // Simpan ke IndexedDB (pastikan arrayBuffer terpisah dari zip buffer)
            const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            await saveFile(fileName, buffer, type);
            savedCount++;
        }
    }

    return { meta, savedCount };
}