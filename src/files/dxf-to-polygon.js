/**
 * Minimal DXF parser — extract polylines/circles/arcs dari text DXF.
 * Handles: LWPOLYLINE, POLYLINE+VERTEX, CIRCLE, ARC.
 * Skips: SPLINE, ELLIPSE, INSERT (block ref), HATCH.
 */
export async function parseDxfToShapes(dxfText, options = {}) {
  const { tolerance = 0.5, maxSize = 100 } = options;

  const entities = parseDxfEntities(dxfText);
  const subpaths = [];

  for (const ent of entities) {
    if (ent.type === "LWPOLYLINE" || ent.type === "POLYLINE") {
      if (ent.vertices.length >= 3) {
        const pts = ent.vertices.map((v) => [v.x, v.y]);
        if (ent.closed) pts.push(pts[0]);
        subpaths.push(pts);
      }
    } else if (ent.type === "CIRCLE") {
      const circ = 2 * Math.PI * ent.r;
      const n = Math.max(16, Math.ceil(circ / tolerance));
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push([ent.cx + Math.cos(a) * ent.r, ent.cy + Math.sin(a) * ent.r]);
      }
      pts.push(pts[0]);
      subpaths.push(pts);
    } else if (ent.type === "ARC") {
      const sweep = normalizeAngle(ent.endAngle - ent.startAngle);
      const arcLen = ((Math.abs(sweep) * Math.PI) / 180) * ent.r;
      const n = Math.max(8, Math.ceil(arcLen / tolerance));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const a = ((ent.startAngle + (sweep * i) / n) * Math.PI) / 180;
        pts.push([ent.cx + Math.cos(a) * ent.r, ent.cy + Math.sin(a) * ent.r]);
      }
      subpaths.push(pts);
    }
  }

  if (subpaths.length === 0) {
    throw new Error(
      "DXF tidak berisi polyline valid. Butuh LWPOLYLINE / POLYLINE / CIRCLE / ARC. " +
        "Entity SPLINE/ELLIPSE/HATCH belum didukung.",
    );
  }

  // Bounding box + scale
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const sub of subpaths) {
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

  const shapes = subpaths.map((pts) =>
    pts.map(([x, y]) => [
      +((x - cx) * scale).toFixed(3),
      +((y - cy) * scale).toFixed(3),
    ]),
  );

  return {
    shapes: shapes.map((points) => ({ points })),
    width: +(w * scale).toFixed(2),
    height: +(h * scale).toFixed(2),
    unit: "mm",
    rawSubpathCount: subpaths.length,
  };
}

function normalizeAngle(a) {
  while (a < 0) a += 360;
  while (a > 360) a -= 360;
  return a;
}

/* ============================================================
   DXF tokenizer — key-value pairs (code/value per line pair)
   ============================================================ */
function tokenizeDxf(text) {
  const lines = text.split(/\r?\n/);
  const tokens = [];
  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) continue;
    tokens.push({ code, value: lines[i + 1] || "" });
  }
  return tokens;
}

function parseDxfEntities(text) {
  const tokens = tokenizeDxf(text);
  const entities = [];
  let i = 0;
  let inEntities = false;

  // Cari ENTITIES section
  while (i < tokens.length - 1) {
    const { code, value } = tokens[i];
    if (code === 0 && value.trim() === "SECTION") {
      const next = tokens[i + 1];
      if (next?.code === 2 && next.value.trim() === "ENTITIES") {
        inEntities = true;
        i += 2;
        break;
      }
    }
    i++;
  }
  if (!inEntities) return [];

  while (i < tokens.length) {
    const { code, value } = tokens[i];
    if (code === 0 && (value.trim() === "ENDSEC" || value.trim() === "EOF"))
      break;
    if (code !== 0) {
      i++;
      continue;
    }

    const type = value.trim();
    const entityTokens = [];
    i++;
    while (i < tokens.length && tokens[i].code !== 0) {
      entityTokens.push(tokens[i]);
      i++;
    }

    if (type === "LWPOLYLINE") {
      entities.push(parseLwPolyline(entityTokens));
    } else if (type === "POLYLINE") {
      const ent = parsePolylineHeader(entityTokens);
      if (ent) {
        ent._pendingVertices = true;
        entities.push(ent);
      }
    } else if (type === "VERTEX") {
      const v = parseVertex(entityTokens);
      if (v) {
        const last = entities[entities.length - 1];
        if (last?.type === "POLYLINE" && last._pendingVertices) {
          last.vertices.push(v);
        }
      }
    } else if (type === "SEQEND") {
      const last = entities[entities.length - 1];
      if (last?.type === "POLYLINE") delete last._pendingVertices;
    } else if (type === "CIRCLE") {
      const ent = parseCircle(entityTokens);
      if (ent) entities.push(ent);
    } else if (type === "ARC") {
      const ent = parseArc(entityTokens);
      if (ent) entities.push(ent);
    }
  }

  return entities.filter((e) => !e._pendingVertices);
}

function parseLwPolyline(tokens) {
  const vertices = [];
  let curX = null;
  let closed = false;
  for (const { code, value } of tokens) {
    if (code === 70) closed = (parseInt(value, 10) & 1) === 1;
    else if (code === 10) curX = parseFloat(value);
    else if (code === 20 && curX !== null) {
      vertices.push({ x: curX, y: parseFloat(value) });
      curX = null;
    }
  }
  return { type: "LWPOLYLINE", vertices, closed };
}

function parsePolylineHeader(tokens) {
  let closed = false;
  for (const { code, value } of tokens) {
    if (code === 70) closed = (parseInt(value, 10) & 1) === 1;
  }
  return { type: "POLYLINE", vertices: [], closed };
}

function parseVertex(tokens) {
  let x = null,
    y = null;
  for (const { code, value } of tokens) {
    if (code === 10) x = parseFloat(value);
    else if (code === 20) y = parseFloat(value);
  }
  return x !== null && y !== null ? { x, y } : null;
}

function parseCircle(tokens) {
  let cx = null,
    cy = null,
    r = null;
  for (const { code, value } of tokens) {
    if (code === 10) cx = parseFloat(value);
    else if (code === 20) cy = parseFloat(value);
    else if (code === 40) r = parseFloat(value);
  }
  if (cx === null || cy === null || !r || r <= 0) return null;
  return { type: "CIRCLE", cx, cy, r };
}

function parseArc(tokens) {
  let cx = null,
    cy = null,
    r = null,
    startAngle = 0,
    endAngle = 360;
  for (const { code, value } of tokens) {
    if (code === 10) cx = parseFloat(value);
    else if (code === 20) cy = parseFloat(value);
    else if (code === 40) r = parseFloat(value);
    else if (code === 50) startAngle = parseFloat(value);
    else if (code === 51) endAngle = parseFloat(value);
  }
  if (cx === null || cy === null || !r || r <= 0) return null;
  return { type: "ARC", cx, cy, r, startAngle, endAngle };
}
