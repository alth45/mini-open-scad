import { jsPDF } from "jspdf";
import { downloadBlob, timestampForFile } from "./utils.js";
import * as THREE from "three";

/**
 * Mapping view → sumbu yang terlihat di screen (untuk dimension label).
 * Iso tidak termasuk (silhouette terlalu kompleks untuk dim lines).
 */
const VIEW_AXIS_MAP = {
  front: { h: "x", v: "z" },
  back: { h: "x", v: "z" },
  left: { h: "y", v: "z" },
  right: { h: "y", v: "z" },
  top: { h: "x", v: "y" },
  bottom: { h: "x", v: "y" },
};

/**
 * Ekspor PDF Blueprint (Technical Drawing) - Full Orthographic + Isometric
 */
export async function exportBlueprintPDF(viewer, tab, options = {}) {
  if (!viewer.hasModel()) {
    return { ok: false, error: "Tidak ada model untuk diekspor. Render dulu." };
  }

  const {
    paperSize = "a4",
    orientation = "landscape",
    projectName = tab?.name || "Untitled Project",
    units = "mm",
  } = options;

  try {
    const pdf = new jsPDF({ orientation, unit: "mm", format: paperSize });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    // --- 1. Background kertas blueprint ---
    pdf.setFillColor(252, 252, 248);
    pdf.rect(0, 0, pageW, pageH, "F");

    // --- 2. Grid tipis ---
    pdf.setDrawColor(235, 235, 230);
    pdf.setLineWidth(0.1);
    for (let x = 0; x < pageW; x += 5) pdf.line(x, 0, x, pageH);
    for (let y = 0; y < pageH; y += 5) pdf.line(0, y, pageW, y);

    pdf.setDrawColor(220, 220, 215);
    for (let x = 0; x < pageW; x += 25) pdf.line(x, 0, x, pageH);
    for (let y = 0; y < pageH; y += 25) pdf.line(0, y, pageW, y);

    // --- 3. Border frame ---
    pdf.setDrawColor(30, 30, 30);
    pdf.setLineWidth(1);
    pdf.rect(8, 8, pageW - 16, pageH - 16);

    // --- 4. Header ---
    pdf.setLineWidth(0.6);
    pdf.line(8, 20, pageW - 8, 20);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.setTextColor(30, 30, 30);
    pdf.text("TECHNICAL DRAWING", 14, 15);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(80, 80, 80);
    pdf.text(`Sheet: 1 of 1`, pageW - 60, 12);
    pdf.text(`Date: ${new Date().toLocaleDateString()}`, pageW - 60, 17);
    pdf.text(`Units: ${units}`, 14, 18);
    pdf.text(`Engine: Manifold`, 60, 18);

    // --- 5. Hitung dimensi model ---
    const bbox = new THREE.Box3().setFromObject(viewer.modelRoot);
    const size = bbox.getSize(new THREE.Vector3());
    const dims = {
      x: size.x.toFixed(1),
      y: size.y.toFixed(1),
      z: size.z.toFixed(1),
    };

    // --- 6. Layout Panel (4 Kolom x 2 Baris) ---
    const padding = 10;
    const headerH = 20;
    const footerH = 8;
    const gap = 4;

    const panelW = (pageW - padding * 2 - gap * 3) / 4; // Lebar per panel
    const panelH = (pageH - headerH - padding - footerH - gap) / 2; // Tinggi per panel
    const startX = padding;
    const startY = headerH + 4;

    const views = [
      {
        id: "front",
        label: "FRONT VIEW",
        dims: `X: ${dims.x} × Z: ${dims.z}`,
        r: 0,
        c: 0,
      },
      {
        id: "back",
        label: "BACK VIEW",
        dims: `X: ${dims.x} × Z: ${dims.z}`,
        r: 0,
        c: 1,
      },
      {
        id: "left",
        label: "LEFT VIEW",
        dims: `Y: ${dims.y} × Z: ${dims.z}`,
        r: 0,
        c: 2,
      },
      {
        id: "right",
        label: "RIGHT VIEW",
        dims: `Y: ${dims.y} × Z: ${dims.z}`,
        r: 0,
        c: 3,
      },
      {
        id: "top",
        label: "TOP VIEW",
        dims: `X: ${dims.x} × Y: ${dims.y}`,
        r: 1,
        c: 0,
      },
      {
        id: "bottom",
        label: "BOTTOM VIEW",
        dims: `X: ${dims.x} × Y: ${dims.y}`,
        r: 1,
        c: 1,
      },
      {
        id: "iso",
        label: "ISOMETRIC",
        dims: `BBox: ${dims.x} × ${dims.y} × ${dims.z}`,
        r: 1,
        c: 2,
      },
    ];

    // --- 7. Render tiap view ---

    const renderSize = 600; // Lebih kecil karena panel lebih kecil
    for (const v of views) {
      // ✨ Request projection bersama dengan capture
      const captureResult = viewer.captureViewForBlueprint(v.id, renderSize, {
        withProjection: true,
      });
      const dataUrl = captureResult.dataUrl || captureResult;
      const projection = captureResult.projection || null;

      const x = startX + v.c * (panelW + gap);
      const y = startY + v.r * (panelH + gap);

      // Panel background (putih)
      pdf.setFillColor(255, 255, 255);
      pdf.rect(x, y, panelW, panelH, "F");

      // Panel border
      pdf.setDrawColor(60, 60, 60);
      pdf.setLineWidth(0.3);
      pdf.rect(x, y, panelW, panelH);

      // Panel header bar
      pdf.setFillColor(30, 30, 30);
      pdf.rect(x, y, panelW, 5, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.text(v.label, x + 1.5, y + 3.5);

      // Dimensi (header text)
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(6);
      pdf.text(v.dims, x + panelW - 1.5, y + 3.5, { align: "right" });

      // Gambar model
      const imgSize = Math.min(panelW - 2, panelH - 7);
      const imgX = x + (panelW - imgSize) / 2;
      const imgY = y + 5 + (panelH - 5 - imgSize) / 2;
      pdf.addImage(dataUrl, "PNG", imgX, imgY, imgSize, imgSize);

      // ✨ Dimension lines (ortho views only)
      if (projection) {
        drawViewDimensions(
          pdf,
          v.id,
          projection,
          {
            imgX,
            imgY,
            imgSize,
            panelX: x,
            panelY: y,
            panelW,
            panelH,
          },
          renderSize,
        );
      }

      // Corner marks
      const markSize = 2;
      pdf.setDrawColor(30, 30, 30);
      pdf.setLineWidth(0.3);
      pdf.line(x, y + 5, x + markSize, y + 5);
      pdf.line(x, y + 5, x, y + 5 + markSize);
      pdf.line(x + panelW - markSize, y + 5, x + panelW, y + 5);
      pdf.line(x + panelW, y + 5, x + panelW, y + 5 + markSize);
      pdf.line(x, y + panelH - markSize, x, y + panelH);
      pdf.line(x, y + panelH, x + markSize, y + panelH);
      pdf.line(x + panelW - markSize, y + panelH, x + panelW, y + panelH);
      pdf.line(x + panelW, y + panelH - markSize, x + panelW, y + panelH);
    }

    // --- 8. Title Block (Mengisi panel ke-8 di Row 1, Col 3) ---
    const tbX = startX + 3 * (panelW + gap);
    const tbY = startY + 1 * (panelH + gap);
    const tbW = panelW;
    const tbH = panelH;

    pdf.setFillColor(255, 255, 255);
    pdf.rect(tbX, tbY, tbW, tbH, "F");

    pdf.setDrawColor(30, 30, 30);
    pdf.setLineWidth(0.6);
    pdf.rect(tbX, tbY, tbW, tbH);

    // Isi Title Block
    const rowH = (tbH - 6) / 3; // Sisa tinggi setelah header
    const colW = tbW / 2;
    pdf.setLineWidth(0.2);

    const drawTbCell = (x, y, w, h, label, value, isHeader = false) => {
      if (isHeader) {
        pdf.setFillColor(30, 30, 30);
        pdf.rect(x, y, w, h, "F");
        pdf.setTextColor(255, 255, 255);
      } else {
        pdf.setTextColor(30, 30, 30);
      }
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(6);
      pdf.text(label, x + 1.5, y + 3);

      pdf.setFont("helvetica", isHeader ? "bold" : "normal");
      pdf.setFontSize(isHeader ? 9 : 7);
      const maxChars = Math.floor(w / 1.5);
      const truncated = String(value).substring(0, maxChars);
      pdf.text(truncated, x + 1.5, y + h - 2);
    };

    // Header Title Block
    drawTbCell(tbX, tbY, tbW, 6, "PROJECT", projectName, true);

    // Row 1
    pdf.line(tbX + colW, tbY + 6, tbX + colW, tbY + tbH);
    drawTbCell(tbX, tbY + 6, colW, rowH, "SCALE", "1:1");
    drawTbCell(tbX + colW, tbY + 6, colW, rowH, "UNITS", units);

    // Row 2
    pdf.line(tbX, tbY + 6 + rowH, tbX + tbW, tbY + 6 + rowH);
    drawTbCell(
      tbX,
      tbY + 6 + rowH,
      colW,
      rowH,
      "DATE",
      new Date().toLocaleDateString(),
    );
    drawTbCell(
      tbX + colW,
      tbY + 6 + rowH,
      colW,
      rowH,
      "MADE WITH",
      "Mini OpenSCAD",
    );

    // Row 3
    pdf.line(tbX, tbY + 6 + rowH * 2, tbX + tbW, tbY + 6 + rowH * 2);
    drawTbCell(tbX, tbY + 6 + rowH * 2, colW, rowH, "BBOX X", dims.x + " mm");
    drawTbCell(
      tbX + colW,
      tbY + 6 + rowH * 2,
      colW,
      rowH,
      "BBOX Y",
      dims.y + " mm",
    );

    // --- 9. Footer ---
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(80, 80, 80);
    pdf.text(
      "Generated by Mini OpenSCAD · manifold-3d engine · Dimensions in millimeters",
      padding,
      pageH - 5,
    );

    const blob = pdf.output("blob");
    const fileName = `blueprint_${timestampForFile()}.pdf`;
    downloadBlob(blob, fileName);
    return { ok: true, name: fileName, size: blob.size };
  } catch (e) {
    console.error("[pdf]", e);
    return { ok: false, error: e.message };
  }

  /* ============================================================
   Dimension Lines (2D vector overlay)
   ============================================================ */

  function drawViewDimensions(pdf, viewId, projection, layout, captureSize) {
    const axisMap = VIEW_AXIS_MAP[viewId];
    if (!axisMap) return; // iso: skip

    const { imgX, imgY, imgSize, panelX, panelY, panelW, panelH } = layout;
    const scale = imgSize / captureSize;

    // Project 8 corners ke PDF coords
    const corners = projection.corners.map((c) => ({
      x: imgX + c.x * scale,
      y: imgY + c.y * scale,
    }));

    // Screen bounds
    let sMinX = Infinity,
      sMaxX = -Infinity,
      sMinY = Infinity,
      sMaxY = -Infinity;
    for (const c of corners) {
      if (c.x < sMinX) sMinX = c.x;
      if (c.x > sMaxX) sMaxX = c.x;
      if (c.y < sMinY) sMinY = c.y;
      if (c.y > sMaxY) sMaxY = c.y;
    }

    const wDim = projection.size[axisMap.h];
    const hDim = projection.size[axisMap.v];
    if (wDim < 0.5 && hDim < 0.5) return;

    // Layout params (mm)
    const gap = 1.0; // gap antara model dan extension line
    const offset = 5.0; // jarak dimension line dari model
    const overshoot = 1.2; // ekstensi melewati dim line
    const arrowLen = 1.4; // panjang arrow
    const arrowHalf = 0.5; // setengah lebar arrow
    const labelSize = 5.5;

    pdf.setDrawColor(40, 40, 40);
    pdf.setFillColor(40, 40, 40);
    pdf.setLineWidth(0.15);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(labelSize);
    pdf.setTextColor(40, 40, 40);

    const hY = sMaxY + offset; // horizontal dim line Y (di bawah model)
    const vX = sMaxX + offset; // vertical dim line X (di kanan model)

    // Panel clip check — jangan keluar border panel
    const minClipX = panelX + 0.5;
    const maxClipX = panelX + panelW - 0.5;
    const minClipY = panelY + 5.5;
    const maxClipY = panelY + panelH - 0.5;

    // ============ HORIZONTAL DIMENSION (bottom) ============
    if (wDim >= 0.5) {
      const hDimLineY = Math.min(hY, maxClipY - 1.5);

      // Extension lines
      pdf.line(sMinX, sMaxY + gap, sMinX, hDimLineY + overshoot);
      pdf.line(sMaxX, sMaxY + gap, sMaxX, hDimLineY + overshoot);

      // Dimension line
      pdf.line(sMinX, hDimLineY, sMaxX, hDimLineY);

      // Arrows
      drawArrow(pdf, sMinX, hDimLineY, "left", arrowLen, arrowHalf);
      drawArrow(pdf, sMaxX, hDimLineY, "right", arrowLen, arrowHalf);

      // Label
      const labelY = hDimLineY - 0.8;
      if (labelY > minClipY) {
        pdf.text(`${wDim.toFixed(1)}`, (sMinX + sMaxX) / 2, labelY, {
          align: "center",
          baseline: "bottom",
        });
      }
    }

    // ============ VERTICAL DIMENSION (right) ============
    if (hDim >= 0.5) {
      const vDimLineX = Math.min(vX, maxClipX - 1.5);

      // Extension lines
      pdf.line(sMaxX + gap, sMinY, vDimLineX + overshoot, sMinY);
      pdf.line(sMaxX + gap, sMaxY, vDimLineX + overshoot, sMaxY);

      // Dimension line
      pdf.line(vDimLineX, sMinY, vDimLineX, sMaxY);

      // Arrows (up at top, down at bottom)
      drawArrow(pdf, vDimLineX, sMinY, "up", arrowLen, arrowHalf);
      drawArrow(pdf, vDimLineX, sMaxY, "down", arrowLen, arrowHalf);

      // Rotated label
      const labelX = vDimLineX + 1.0;
      if (labelX < maxClipX) {
        pdf.text(`${hDim.toFixed(1)}`, labelX, (sMinY + sMaxY) / 2, {
          align: "center",
          baseline: "bottom",
          angle: 90,
        });
      }
    }
  }

  function drawArrow(pdf, x, y, direction, len, halfWidth) {
    let pts;
    switch (direction) {
      case "right":
        // Tip at (x,y), body extends left
        pts = [
          [x, y],
          [x - len, y - halfWidth],
          [x - len, y + halfWidth],
        ];
        break;
      case "left":
        // Tip at (x,y), body extends right
        pts = [
          [x, y],
          [x + len, y - halfWidth],
          [x + len, y + halfWidth],
        ];
        break;
      case "up":
        // Tip at (x,y), body extends down
        pts = [
          [x, y],
          [x - halfWidth, y + len],
          [x + halfWidth, y + len],
        ];
        break;
      case "down":
        // Tip at (x,y), body extends up
        pts = [
          [x, y],
          [x - halfWidth, y - len],
          [x + halfWidth, y - len],
        ];
        break;
      default:
        return;
    }
    pdf.triangle(
      pts[0][0],
      pts[0][1],
      pts[1][0],
      pts[1][1],
      pts[2][0],
      pts[2][1],
      "F",
    );
  }
}
