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

/**
 * Kumpulkan semua file yang direferensikan include/use dalam AST.
 * Rekursif ke semua body.
 */
export function extractScadImports(ast) {
    const names = new Set();
    function walk(stmts) {
        if (!stmts) return;
        for (const st of stmts) {
            if (st.type === 'Include') names.add(st.file);
            if (st.body) walk(st.body);
            if (st.thenBody) walk(st.thenBody);
            if (st.elseBody) walk(st.elseBody);
        }
    }
    walk(ast.body);
    return [...names];
}