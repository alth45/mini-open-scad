/**
 * Parser anotasi parameter dari source code.
 * Support 2 format:
 *   1. `// @param NAME {type args} Label`  ← format kita (prioritas tinggi)
 *   2. `name = value; // [annotation]`     ← format OpenSCAD Customizer
 *   3. `name = value; // description`      ← description only
 *
 * Group header `/* [Group Name] *​/` juga di-parse.
 */

/* ---- regex patterns ---- */
const PARAM_RE = /^\s*\/\/\s*@param\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]+)\}\s*(.*)$/;
const GROUP_RE = /^\s*\/\*\s*\[([^\]]+)\]\s*\*\/\s*$/;
const ASSIGN_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*;\s*(?:\/\/\s*(.*))?$/;
const UI_ANNOT_RE = /^\[(.*)\]$/;

function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

function parseLiteral(str) {
    /* String */
    const strMatch = /^"((?:[^"\\]|\\.)*)"$/.exec(str);
    if (strMatch) return strMatch[1].replace(/\\(.)/g, '$1');

    /* Boolean */
    if (str === 'true') return true;
    if (str === 'false') return false;

    /* Number */
    const numMatch = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.exec(str);
    if (numMatch) return parseFloat(str);

    return undefined;
}

/* ============================================================
   Parser 1: `@param NAME {type args} Label`
   ============================================================ */
function parseAtParam(name, typeSpec, label) {
    const tokens = typeSpec.trim().split(/\s+/);
    const type = tokens[0];
    const args = tokens.slice(1);
    const def = { name, label, type };

    switch (type) {
        case 'slider': {
            def.min = parseFloat(args[0] ?? 0);
            def.max = parseFloat(args[1] ?? 100);
            def.default = parseFloat(args[2] ?? (def.min + def.max) / 2);
            def.step = parseFloat(args[3] ?? 1);
            if (def.max <= def.min) return null;
            def.default = clamp(def.default, def.min, def.max);
            return def;
        }
        case 'number':
            def.default = parseFloat(args[0] ?? 0);
            def.step = parseFloat(args[1] ?? 1);
            return def;
        case 'string':
            def.default = args[0] ?? '';
            return def;
        case 'bool':
            def.default = args[0] !== 'false';
            return def;
        case 'color':
            def.default = args[0] ?? '#f9d72c';
            return def;
        case 'enum': {
            const options = args.length ? args : [''];
            def.options = options;
            def.default = options[0];
            return def;
        }
        default:
            return null;
    }
}

/* ============================================================
   Parser 2: `[annotation]` OpenSCAD Customizer
   ============================================================ */
function parseOpenScadAnnotation(name, defaultValue, annotationStr) {
    const typeOf = typeof defaultValue;
    const baseLabel = name;

    /* Tidak ada annotation → skip */
    if (!annotationStr) return null;

    /* Bukan [..] → description only */
    if (!annotationStr.startsWith('[')) {
        return {
            name,
            label: annotationStr,
            type: typeOf === 'boolean' ? 'bool' : typeOf === 'string' ? 'string' : 'number',
            default: defaultValue,
            step: 1,
        };
    }

    /* [..] — parse UI type */
    const uiMatch = UI_ANNOT_RE.exec(annotationStr);
    if (!uiMatch) return null;

    const content = uiMatch[1].trim();
    const parts = content.split(',').map(s => s.trim()).filter(Boolean);

    /* --- Boolean: [true, false] --- */
    if (parts.length === 2 && parts.every(p => p === 'true' || p === 'false')) {
        return {
            name, label: baseLabel, type: 'bool',
            default: typeof defaultValue === 'boolean' ? defaultValue : (parts[0] === 'true'),
        };
    }

    /* --- Slider: [min:max] atau [min:step:max] (single part with colons) --- */
    if (parts.length === 1) {
        const sub = content.split(':').map(s => s.trim());

        if (sub.length === 2) {
            const a = parseFloat(sub[0]);
            const b = parseFloat(sub[1]);
            if (Number.isFinite(a) && Number.isFinite(b) && a < b) {
                return {
                    name, label: baseLabel, type: 'slider',
                    min: a, max: b, step: 1,
                    default: clamp(typeOf === 'number' ? defaultValue : a, a, b),
                };
            }
        }

        if (sub.length === 3) {
            const a = parseFloat(sub[0]);
            const s = parseFloat(sub[1]);
            const b = parseFloat(sub[2]);
            if (Number.isFinite(a) && Number.isFinite(s) && Number.isFinite(b) && a < b && s > 0) {
                return {
                    name, label: baseLabel, type: 'slider',
                    min: a, step: s, max: b,
                    default: clamp(typeOf === 'number' ? defaultValue : a, a, b),
                };
            }
        }
    }

    /* --- Enum: [v1, v2, ...] atau [v1:Label1, v2:Label2, ...] --- */
    if (parts.length >= 2) {
        const parsed = parts.map(p => {
            const idx = p.indexOf(':');
            if (idx === -1) return { value: p, label: p };
            return { value: p.slice(0, idx).trim(), label: p.slice(idx + 1).trim() };
        });

        const isNumeric = typeOf === 'number';
        if (isNumeric) {
            const nums = parsed.map(o => parseFloat(o.value));
            if (nums.every(Number.isFinite)) {
                return {
                    name, label: baseLabel, type: 'enum',
                    options: nums,
                    optionLabels: parsed.map(o => o.label),
                    default: clamp(defaultValue, Math.min(...nums), Math.max(...nums)),
                };
            }
        }

        /* string enum */
        const stringDefault = typeOf === 'string' ? defaultValue : parsed[0].value;
        const match = parsed.find(o => o.value === String(stringDefault));
        return {
            name, label: baseLabel, type: 'enum',
            options: parsed.map(o => o.value),
            optionLabels: parsed.map(o => o.label),
            default: match ? match.value : parsed[0].value,
        };
    }

    return null;
}

/* ============================================================
   Main: parseParams
   ============================================================ */
export function parseParams(code) {
    const lines = code.split('\n');

    /* Pass 1: kumpulkan nama @param (prioritas tinggi — akan override OpenSCAD) */
    const atParamNames = new Set();
    for (const line of lines) {
        const m = PARAM_RE.exec(line);
        if (m && !m[1].startsWith('$')) atParamNames.add(m[1]);
    }

    /* Pass 2: parse in source order */
    const params = [];
    const seen = new Set();
    let currentGroup = null;

    for (const line of lines) {
        /* Group header */
        const gm = GROUP_RE.exec(line);
        if (gm) { currentGroup = gm[1].trim(); continue; }

        /* @param first */
        const pm = PARAM_RE.exec(line);
        if (pm) {
            const name = pm[1];
            if (name.startsWith('$') || seen.has(name)) continue;
            const def = parseAtParam(name, pm[2].trim(), (pm[3] || '').trim() || name);
            if (def) {
                def.group = currentGroup;
                params.push(def);
                seen.add(name);
            }
            continue;
        }

        /* OpenSCAD customizer (skip if already handled by @param) */
        const am = ASSIGN_RE.exec(line);
        if (!am) continue;
        const name = am[1];
        if (name.startsWith('$') || seen.has(name) || atParamNames.has(name)) continue;

        const defaultValue = parseLiteral(am[2].trim());
        if (defaultValue === undefined) continue;

        const def = parseOpenScadAnnotation(name, defaultValue, (am[3] || '').trim());
        if (def) {
            def.group = currentGroup;
            params.push(def);
            seen.add(name);
        }
    }

    return params;
}

/* ============================================================
   Merge + default helpers (updated untuk numeric enum)
   ============================================================ */
export function mergeParamValues(params, oldValues) {
    const out = {};
    for (const p of params) {
        const old = oldValues?.[p.name];
        switch (p.type) {
            case 'slider':
                out[p.name] = (typeof old === 'number' && old >= p.min && old <= p.max)
                    ? old : p.default;
                break;
            case 'number':
                out[p.name] = typeof old === 'number' && Number.isFinite(old) ? old : p.default;
                break;
            case 'string':
                out[p.name] = typeof old === 'string' ? old : p.default;
                break;
            case 'bool':
                out[p.name] = typeof old === 'boolean' ? old : p.default;
                break;
            case 'color':
                out[p.name] = typeof old === 'string' ? old : p.default;
                break;
            case 'enum': {
                /* match strict atau string-coerced (numeric enum bisa datang sebagai string) */
                const match = p.options.find(o => o === old || String(o) === String(old));
                out[p.name] = match !== undefined ? match : p.default;
                break;
            }
            default:
                out[p.name] = p.default;
        }
    }
    return out;
}

export function defaultValues(params) {
    const out = {};
    for (const p of params) out[p.name] = p.default;
    return out;
}