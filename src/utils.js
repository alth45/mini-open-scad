export class SCADError extends Error {
    constructor(msg, line = 0, col = 0) {
        super(msg);
        this.name = 'SCADError';
        this.line = line;
        this.col = col;
    }
}

export const escapeHtml = (s) =>
    s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export const isNum = v => typeof v === 'number' && Number.isFinite(v);
export const numArg = (v, def = 0) => (isNum(v) ? v : def);

export const DEG = Math.PI / 180;

/** Format error SCAD dengan konteks baris. */
export function formatError(err, code) {
    let msg = err?.message || String(err);
    const line = err?.line | 0;
    if (line > 0 && code) {
        const src = (code.split('\n')[line - 1] || '').trim();
        msg = `Line ${line}: ${msg}` + (src ? `\n   → ${src}` : '');
    }
    return msg;
}

export function truthy(v) {
    if (Array.isArray(v)) return v.length > 0;
    if (v === null || v === undefined) return false;
    return !!v;
}