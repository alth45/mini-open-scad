import * as THREE from 'three';
import * as opentype from 'opentype.js';
/* ============================================================
   URL font — dari public/fonts/ (tidak di-bundle Vite)
   Worker bisa fetch path absolut karena Vite serve public/ di root
   ============================================================ */
const OPENTYPE_REGISTRY = {
    'noto-jp': '/fonts/NotoSansJP-Regular.ttf',
    'noto:jp': '/fonts/NotoSansJP-Regular.ttf',
    'notosansjp': '/fonts/NotoSansJP-Regular.ttf',
    'noto': '/fonts/NotoSansJP-Regular.ttf',
};

const fontCache = new Map();
const loadedFonts = new Map();

export function isOpenTypeFont(name) {
    return OPENTYPE_REGISTRY[String(name || '').toLowerCase()] !== undefined;
}

async function fetchFont(url) {
    if (fontCache.has(url)) return fontCache.get(url);
    const p = (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
        const buf = await res.arrayBuffer();
        return opentype.parse(buf);
    })();
    fontCache.set(url, p);
    p.catch(() => fontCache.delete(url));   // jangan cache error permanen
    return p;
}

/* ============================================================
   Preload — dipanggil sekali di worker sebelum buildModel
   Idempotent + error-tolerant (font tidak ada = warning saja)
   ============================================================ */
export async function preloadOpenTypeFonts() {
    const promises = [];
    for (const [name, url] of Object.entries(OPENTYPE_REGISTRY)) {
        if (loadedFonts.has(name)) continue;
        promises.push((async () => {
            try {
                const font = await fetchFont(url);
                loadedFonts.set(name, font);
                console.log(`[opentype] loaded '${name}' from ${url}`);
            } catch (e) {
                console.warn(`[opentype] '${name}' tidak tersedia: ${e.message}`);
            }
        })());
    }
    await Promise.all(promises);
}

/* ============================================================
   Deteksi CJK
   ============================================================ */
const CJK_RE = /[\u3000-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
export function hasCJK(str) {
    return CJK_RE.test(str);
}

/* ============================================================
   Konversi opentype Path → THREE.Shape[]
   ============================================================ */
export function opentypePathToShapes(path) {
    const subPaths = [];
    let current = null;
    let curX = 0, curY = 0;

    for (const cmd of path.commands) {
        switch (cmd.type) {
            case 'M':
                if (current && current.curves.length > 0) subPaths.push(current);
                current = { curves: [], bbox: new THREE.Box2() };
                curX = cmd.x; curY = cmd.y;
                current.bbox.expandByPoint(new THREE.Vector2(curX, -curY));
                break;
            case 'L': {
                if (!current) break;
                current.curves.push(new THREE.LineCurve(
                    new THREE.Vector2(curX, -curY),
                    new THREE.Vector2(cmd.x, -cmd.y)
                ));
                curX = cmd.x; curY = cmd.y;
                current.bbox.expandByPoint(new THREE.Vector2(curX, -curY));
                break;
            }
            case 'Q': {
                if (!current) break;
                current.curves.push(new THREE.QuadraticBezierCurve(
                    new THREE.Vector2(curX, -curY),
                    new THREE.Vector2(cmd.x1, -cmd.y1),
                    new THREE.Vector2(cmd.x, -cmd.y)
                ));
                curX = cmd.x; curY = cmd.y;
                current.bbox.expandByPoint(new THREE.Vector2(curX, -curY));
                break;
            }
            case 'C': {
                if (!current) break;
                current.curves.push(new THREE.CubicBezierCurve(
                    new THREE.Vector2(curX, -curY),
                    new THREE.Vector2(cmd.x1, -cmd.y1),
                    new THREE.Vector2(cmd.x2, -cmd.y2),
                    new THREE.Vector2(cmd.x, -cmd.y)
                ));
                curX = cmd.x; curY = cmd.y;
                current.bbox.expandByPoint(new THREE.Vector2(curX, -curY));
                break;
            }
            case 'Z':
                if (current && current.curves.length > 0) {
                    const first = current.curves[0].getPoint(0);
                    const last = current.curves[current.curves.length - 1].getPoint(1);
                    if (last.distanceTo(first) > 1e-6) {
                        current.curves.push(new THREE.LineCurve(last, first));
                    }
                    subPaths.push(current);
                }
                current = null;
                break;
        }
    }
    if (current && current.curves.length > 0) subPaths.push(current);

    if (subPaths.length === 0) return [];

    subPaths.forEach(sp => { sp.area = Math.abs(polygonArea(sp.curves)); });
    subPaths.sort((a, b) => b.area - a.area);

    const outerShapes = [];
    for (const sp of subPaths) {
        let host = null;
        for (const o of outerShapes) {
            if (o.bbox.containsBox(sp.bbox)) { host = o; break; }
        }
        if (host) {
            const holePath = new THREE.Path();
            holePath.curves = sp.curves;
            host.shape.holes.push(holePath);
        } else {
            const shape = new THREE.Shape();
            shape.curves = sp.curves;
            outerShapes.push({ shape, bbox: sp.bbox });
        }
    }
    return outerShapes.map(o => o.shape);
}

function polygonArea(curves) {
    let area = 0;
    let prev = null;
    for (const c of curves) {
        const pts = c.getPoints(8);
        for (const p of pts) {
            if (prev) area += prev.x * p.y - p.x * prev.y;
            prev = p;
        }
    }
    return area / 2;
}

/* ============================================================
   Sync generator — hanya bekerja setelah preload
   Return null jika font belum ready (bukan throw)
   ============================================================ */
export function generateTextShapesSync(fontName, text, size) {
    const name = String(fontName || '').toLowerCase();
    const font = loadedFonts.get(name);
    if (!font) return null;
    const path = font.getPath(text, 0, 0, size);
    return opentypePathToShapes(path);
}