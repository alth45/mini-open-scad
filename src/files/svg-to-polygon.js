/**
 * Parse SVG text → array of polygon shapes.
 * Native APIs only — inject SVG ke hidden DOM untuk getTotalLength/getCTM.
 *
 * Return: { shapes: [{ points: [[x,y], ...] }], width, height, unit, rawSubpathCount }
 *   - Points sudah di-scale ke target size (max dimension = maxSize)
 *   - Origin di-center, Y-axis di-flip (SVG Y-down → CAD Y-up)
 */
export async function parseSvgToShapes(svgText, options = {}) {
  const { tolerance = 0.5, maxSize = 100, minPointsPerShape = 3 } = options;

  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("SVG parse error — file mungkin korup");
  }
  const svgEl = doc.querySelector("svg");
  if (!svgEl) throw new Error("SVG tidak valid — root <svg> tidak ditemukan");

  // ViewBox untuk coordinate system
  let vb = null;
  const vbAttr = svgEl.getAttribute("viewBox");
  if (vbAttr) {
    const nums = vbAttr
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (nums.length === 4 && nums[2] > 0 && nums[3] > 0) {
      vb = { x: nums[0], y: nums[1], w: nums[2], h: nums[3] };
    }
  }
  if (!vb) {
    const w = parseFloat(svgEl.getAttribute("width")) || 100;
    const h = parseFloat(svgEl.getAttribute("height")) || 100;
    vb = { x: 0, y: 0, w, h };
  }

  // Tolerance dalam viewBox units → selalu ~0.5mm setelah scale
  const viewBoxToMmScale = maxSize / Math.max(vb.w, vb.h);
  const effectiveTolerance = tolerance / viewBoxToMmScale;

  // Inject ke live DOM (getTotalLength/getCTM butuh rendered element)
  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden;pointer-events:none;opacity:0;";
  document.body.appendChild(container);
  const liveSvg = document.importNode(svgEl, true);
  container.appendChild(liveSvg);

  const allSubpaths = [];

  try {
    // Walk semua shape elements
    const shapeEls = [];
    const walker = document.createTreeWalker(liveSvg, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    do {
      const tag = node.tagName?.toLowerCase();
      if (!tag) continue;
      if (
        tag === "path" ||
        tag === "polygon" ||
        tag === "polyline" ||
        tag === "rect" ||
        tag === "circle" ||
        tag === "ellipse"
      ) {
        shapeEls.push(node);
      }
    } while ((node = walker.nextNode()));

    for (const el of shapeEls) {
      const tag = el.tagName.toLowerCase();
      const ctm = el.getCTM?.();

      const subpaths =
        tag === "path"
          ? samplePathElement(el, effectiveTolerance)
          : sampleNonPathShape(el, effectiveTolerance);

      for (const sub of subpaths) {
        if (sub.length < minPointsPerShape) continue;
        // Apply cumulative transform (handle parent <g transform>)
        const pts = ctm ? sub.map(([x, y]) => applyMatrix(ctm, x, y)) : sub;
        allSubpaths.push(pts);
      }
    }
  } finally {
    document.body.removeChild(container);
  }

  if (allSubpaths.length === 0) {
    throw new Error("SVG tidak berisi shape yang bisa di-extract");
  }

  // Bounding box untuk scaling
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const sub of allSubpaths) {
    for (const [x, y] of sub) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const maxDim = Math.max(w, h) || 1;
  const scale = maxSize / maxDim;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const shapes = allSubpaths.map((pts) =>
    pts.map(([x, y]) => [
      +((x - cx) * scale).toFixed(3),
      +(-(y - cy) * scale).toFixed(3), // flip Y: SVG Y-down → CAD Y-up
    ]),
  );

  return {
    shapes: shapes.map((points) => ({ points })),
    width: +(w * scale).toFixed(2),
    height: +(h * scale).toFixed(2),
    unit: "mm",
    sourceViewBox: vb,
    rawSubpathCount: allSubpaths.length,
  };
}

/* ============================================================ */

function applyMatrix(m, x, y) {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

/**
 * Sample <path>, split into subpaths via sudden-gap detection.
 */
function samplePathElement(pathEl, tolerance) {
  let totalLength;
  try {
    totalLength = pathEl.getTotalLength();
  } catch {
    return [];
  }
  if (!totalLength || totalLength <= 0) return [];

  const numSamples = Math.max(16, Math.ceil(totalLength / tolerance));
  const stepLen = totalLength / numSamples;

  const subpaths = [];
  let current = [];
  let lastPt = null;

  for (let i = 0; i <= numSamples; i++) {
    const t = (i / numSamples) * totalLength;
    let pt;
    try {
      pt = pathEl.getPointAtLength(t);
    } catch {
      continue;
    }
    const v = [pt.x, pt.y];

    if (lastPt) {
      const dx = v[0] - lastPt[0];
      const dy = v[1] - lastPt[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Subpath break: sudden jump (mis. setelah "M ..." berikutnya)
      if (dist > stepLen * 3) {
        if (current.length >= 3) subpaths.push(current);
        current = [];
      }
    }

    current.push(v);
    lastPt = v;
  }

  if (current.length >= 3) subpaths.push(current);
  return subpaths;
}

/**
 * Manual sampling untuk rect/circle/ellipse/polygon/polyline.
 */
function sampleNonPathShape(el, tolerance) {
  const tag = el.tagName.toLowerCase();

  if (tag === "polygon" || tag === "polyline") {
    const ptsAttr = el.getAttribute("points") || "";
    const nums = ptsAttr
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (nums.length < 6) return [];
    const pts = [];
    for (let i = 0; i < nums.length; i += 2) {
      if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) {
        pts.push([nums[i], nums[i + 1]]);
      }
    }
    return pts.length >= 3 ? [pts] : [];
  }

  if (tag === "rect") {
    const x = parseFloat(el.getAttribute("x")) || 0;
    const y = parseFloat(el.getAttribute("y")) || 0;
    const w = parseFloat(el.getAttribute("width")) || 0;
    const h = parseFloat(el.getAttribute("height")) || 0;
    if (w <= 0 || h <= 0) return [];
    return [
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
    ];
  }

  if (tag === "circle" || tag === "ellipse") {
    const cx = parseFloat(el.getAttribute("cx")) || 0;
    const cy = parseFloat(el.getAttribute("cy")) || 0;
    let rx, ry;
    if (tag === "circle") {
      const r = parseFloat(el.getAttribute("r")) || 0;
      rx = ry = r;
    } else {
      rx = parseFloat(el.getAttribute("rx")) || 0;
      ry = parseFloat(el.getAttribute("ry")) || 0;
    }
    if (rx <= 0 || ry <= 0) return [];

    const circ = Math.PI * (rx + ry);
    const n = Math.max(16, Math.ceil(circ / tolerance));
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return [pts];
  }

  return [];
}
