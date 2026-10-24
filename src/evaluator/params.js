/**
 * Override assignment top-level berdasarkan nilai parameter.
 * Mutate AST. Return Set nama yang berhasil di-override.
 */
export function applyParams(ast, values) {
    const applied = new Set();
    if (!values) return applied;

    for (const stmt of ast.body) {
        if (stmt.type === 'Assignment' &&
            !stmt.name.startsWith('$') &&
            values[stmt.name] !== undefined) {
            stmt.value = { type: 'Literal', value: values[stmt.name] };
            applied.add(stmt.name);
        }
    }
    return applied;
}