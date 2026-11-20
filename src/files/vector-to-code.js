/**
 * Convert shape data → OpenSCAD polygon() source code.
 */

export function shapesToScad(shapes, options = {}) {
  const { wrap = true } = options;
  if (!shapes || shapes.length === 0) return "";

  if (shapes.length === 1) {
    return buildPolygonCall(shapes[0].points, wrap);
  }

  const parts = shapes.map((s) => buildPolygonCall(s.points, wrap));
  return (
    "// " +
    shapes.length +
    " polygon(s) — wrap in union() or difference() sesuai kebutuhan\n" +
    parts.join("\n\n")
  );
}

function buildPolygonCall(points, wrap) {
  if (!points || points.length < 3) return "";
  const pts = points.map(([x, y]) => `[${x}, ${y}]`);
  if (!wrap) {
    return `polygon(points = [${pts.join(", ")}]);`;
  }
  return `polygon(points = [\n  ${pts.join(",\n  ")}\n]);`;
}
