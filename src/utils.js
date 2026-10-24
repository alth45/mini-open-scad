export class SCADError extends Error {
    constructor(msg, line = 0, col = 0, hint = null) {
        super(msg);
        this.name = 'SCADError';
        this.line = line;
        this.col = col;
        this.hint = hint;
    }
}

export const escapeHtml = (s) =>
    s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export const isNum = v => typeof v === 'number' && Number.isFinite(v);
export const numArg = (v, def = 0) => (isNum(v) ? v : def);

export const DEG = Math.PI / 180;

export function formatError(err, code) {
    let msg = err?.message || String(err);
    const line = err?.line | 0;
    if (line > 0 && code) {
        const src = (code.split('\n')[line - 1] || '').trim();
        msg = `Line ${line}: ${msg}` + (src ? `\n   → ${src}` : '');
    }
    if (err?.hint) {
        msg += `\n   💡 ${err.hint}`;
    }
    return msg;
}

export function truthy(v) {
    if (Array.isArray(v)) return v.length > 0;
    if (v === null || v === undefined) return false;
    return !!v;
}

export function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function timestampForFile() {
    return new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
}