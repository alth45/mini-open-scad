/**
 * Ambil semua nama file literal dari panggilan import("...") di kode.
 * Cukup regex — parse penuh tidak perlu karena hanya membaca string.
 */
export function extractImportNames(code) {
    const names = new Set();
    const re = /import\s*\(\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(code))) names.add(m[1]);
    return [...names];
}