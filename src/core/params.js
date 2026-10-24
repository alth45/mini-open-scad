/**
 * Parse anotasi // @param dari source code.
 * Format: // @param NAME {TYPE ARGS...} LABEL
 */
const PARAM_RE = /^\s*\/\/\s*@param\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]+)\}\s*(.*)$/;

export function parseParams(code) {
    const params = [];
    const seen = new Set();
    for (const line of code.split('\n')) {
        const m = PARAM_RE.exec(line);
        if (!m) continue;
        const name = m[1];
        if (name.startsWith('$') || seen.has(name)) continue;
        seen.add(name);

        const tokens = m[2].trim().split(/\s+/);
        const type = tokens[0];
        const args = tokens.slice(1);
        const label = (m[3] || '').trim() || name;
        const def = { name, type, label };

        switch (type) {
            case 'slider': {
                def.min = parseFloat(args[0] ?? 0);
                def.max = parseFloat(args[1] ?? 100);
                def.default = parseFloat(args[2] ?? (def.min + def.max) / 2);
                def.step = parseFloat(args[3] ?? 1);
                if (def.max <= def.min) continue;
                def.default = Math.min(def.max, Math.max(def.min, def.default));
                break;
            }
            case 'number':
                def.default = parseFloat(args[0] ?? 0);
                def.step = parseFloat(args[1] ?? 1);
                break;
            case 'string':
                def.default = args[0] ?? '';
                break;
            case 'bool':
                def.default = args[0] !== 'false';
                break;
            case 'color':
                def.default = args[0] ?? '#f9d72c';
                break;
            case 'enum':
                def.options = args.length ? args : [''];
                def.default = args[0] ?? '';
                break;
            default:
                continue;
        }
        params.push(def);
    }
    return params;
}

/**
 * Merge nilai lama dengan schema baru.
 * Nilai yang tidak cocok tipe/range → reset ke default.
 */
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
            case 'enum':
                out[p.name] = p.options.includes(old) ? old : p.default;
                break;
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