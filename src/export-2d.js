import { downloadBlob } from './utils.js';

/* ============================================================
   Export SVG
   ============================================================ */
export function exportSVG(shapes2d) {
    if (!shapes2d || shapes2d.length === 0) return { ok: false, error: 'Tidak ada shape 2D' };

    const allContours = [];
    for (const s of shapes2d) {
        allContours.push(s.outer);
        if (s.holes) allContours.push(...s.holes);
    }
    if (allContours.length === 0) return { ok: false, error: 'Shape 2D kosong' };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pts of allContours) {
        for (const p of pts) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }
    }
    
    // Padding 5mm
    minX -= 5; minY -= 5;
    const w = (maxX - minX) + 10;
    const h = (maxY - minY) + 10;

    // SVG Y-axis goes down, CAD Y-axis goes up. We invert Y.
    let paths = '';
    for (const pts of allContours) {
        if (pts.length < 2) continue;
        let d = '';
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const x = (p.x - minX).toFixed(4);
            const y = (h - (p.y - minY)).toFixed(4); // Invert Y
            d += (i === 0 ? `M ${x} ${y} ` : `L ${x} ${y} `);
        }
        d += 'Z'; // Close path
        paths += `  <path d="${d}" fill="none" stroke="black" stroke-width="0.5" />\n`;
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm">
${paths}
</svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const name = `vector_2d_${Date.now()}.svg`;
    downloadBlob(blob, name);
    return { ok: true, name, size: blob.size };
}

/* ============================================================
   Export DXF (AutoCAD R12 format)
   ============================================================ */
export function exportDXF(shapes2d) {
    if (!shapes2d || shapes2d.length === 0) return { ok: false, error: 'Tidak ada shape 2D' };

    const allContours = [];
    for (const s of shapes2d) {
        allContours.push(s.outer);
        if (s.holes) allContours.push(...s.holes);
    }
    if (allContours.length === 0) return { ok: false, error: 'Shape 2D kosong' };

    let dxf = '';
    const addLine = (code, value) => { dxf += `${code}\n${value}\n`; };

    // --- HEADER ---
    addLine(0, 'SECTION'); addLine(2, 'HEADER');
    addLine(9, '$ACADVER'); addLine(1, 'AC1009'); // AutoCAD R12
    addLine(9, '$INSBASE'); addLine(10, '0.0'); addLine(20, '0.0'); addLine(30, '0.0');
    addLine(0, 'ENDSEC');

    // --- TABLES (Minimal) ---
    addLine(0, 'SECTION'); addLine(2, 'TABLES');
    addLine(0, 'TABLE'); addLine(2, 'LAYER'); addLine(70, '1');
    addLine(0, 'LAYER'); addLine(2, '0'); addLine(70, '0'); addLine(62, '7'); addLine(6, 'CONTINUOUS');
    addLine(0, 'ENDTAB');
    addLine(0, 'ENDSEC');

    // --- ENTITIES ---
    addLine(0, 'SECTION'); addLine(2, 'ENTITIES');

    for (const pts of allContours) {
        if (pts.length < 2) continue;

        // POLYLINE Entity (R12 standard)
        addLine(0, 'POLYLINE');
        addLine(8, '0'); // Layer
        addLine(66, '1'); // Vertices follow
        addLine(70, '1'); // 1 = Closed polyline
        addLine(10, '0.0'); addLine(20, '0.0'); addLine(30, '0.0');

        for (const p of pts) {
            addLine(0, 'VERTEX');
            addLine(8, '0');
            addLine(10, p.x.toFixed(4));
            addLine(20, p.y.toFixed(4));
            addLine(30, '0.0');
        }
        addLine(0, 'SEQEND');
    }

    addLine(0, 'ENDSEC');
    addLine(0, 'EOF');

    const blob = new Blob([dxf], { type: 'application/dxf' });
    const name = `vector_2d_${Date.now()}.dxf`;
    downloadBlob(blob, name);
    return { ok: true, name, size: blob.size };
}