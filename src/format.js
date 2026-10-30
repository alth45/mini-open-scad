/* ============================================================
   Auto-format OpenSCAD source code
   - Indentasi 2 spasi via brace depth
   - Spacing operator, comma, bracket
   - Kolaps baris kosong berlebih
   - Preserve string & comment content verbatim
   ============================================================ */

const NULL = '\u0000';

/* Ganti string/comment dengan placeholder agar regex tidak menyentuhnya */
function maskStringsAndComments(line) {
    const tokens = [];
    let out = '';
    let i = 0;
    const n = line.length;

    while (i < n) {
        const c = line[i];

        if (c === '/' && line[i + 1] === '/') {
            tokens.push(line.slice(i));
            out += `${NULL}${tokens.length - 1}${NULL}`;
            break;
        }

        if (c === '/' && line[i + 1] === '*') {
            const end = line.indexOf('*/', i + 2);
            if (end !== -1) {
                tokens.push(line.slice(i, end + 2));
                out += `${NULL}${tokens.length - 1}${NULL}`;
                i = end + 2;
                continue;
            }
            tokens.push(line.slice(i));
            out += `${NULL}${tokens.length - 1}${NULL}`;
            break;
        }

        if (c === '"') {
            let j = i + 1;
            while (j < n && line[j] !== '"') {
                if (line[j] === '\\') j++;
                j++;
            }
            tokens.push(line.slice(i, Math.min(j + 1, n)));
            out += `${NULL}${tokens.length - 1}${NULL}`;
            i = Math.min(j + 1, n);
            continue;
        }

        out += c;
        i++;
    }

    return { masked: out, tokens };
}

function unmask(masked, tokens) {
    return masked.replace(
        new RegExp(`${NULL}(\\d+)${NULL}`, 'g'),
        (_, idx) => tokens[+idx]
    );
}

const OPL = `(?:[a-zA-Z0-9_$)\\]"]|${NULL}\\d+${NULL})`;
const OPR = `(?:[a-zA-Z0-9_$(\\[\\]"-]|${NULL}\\d+${NULL})`;

function applySpacing(masked) {
    let s = masked;

    /* Modifier awal baris: *cube(10) — tidak ada spasi setelah * ! # */
    s = s.replace(/^([ \t]*)([*!#])\s+/, '$1$2');

    /* Kolaps multiple whitespace */
    s = s.replace(/[ \t]+/g, ' ');

    /* Tidak ada spasi sebelum , ; ) ] */
    s = s.replace(/[ \t]+([,;)\]])/g, '$1');

    /* Tidak ada spasi setelah ( atau [ */
    s = s.replace(/([(\[]) [ \t]+/g, '$1');

    /* Satu spasi setelah koma */
    s = s.replace(/,([^\s)\]])/g, ', $1');

    /* Binary operators */
    s = s.replace(/[ \t]*(==|!=|<=|>=|&&|\|\|)[ \t]*/g, ' $1 ');
    s = s.replace(/([^=!<>])[ \t]*=[ \t]*(?!=)/g, '$1 = ');
    s = s.replace(/([a-zA-Z0-9_$)\]])[ \t]*<[ \t]*([a-zA-Z0-9_$(\[-])/g, '$1 < $2');
    s = s.replace(/([a-zA-Z0-9_$)\]])[ \t]*>[ \t]*([a-zA-Z0-9_$(\[-])/g, '$1 > $2');

    /* Math operators (binary, lookahead agar chain 'a+b+c' tetap jalan) */
    s = s.replace(
        new RegExp(`(${OPL})[ \\t]*([+\\-*/%^])[ \\t]*(?=${OPR})`, 'g'),
        '$1 $2 '
    );

    /* Spasi sebelum { setelah identifier/)/] */
    s = s.replace(/([a-zA-Z0-9_$)\]]){/g, '$1 {');

    /* Spasi di dalam blok one-liner: { x; } */
    s = s.replace(/\{[ \t]*([^\s}])/g, '{ $1');
    s = s.replace(/([^\s{])\}/g, '$1 }');

    /* Spasi antara ) / ] dan identifier berikutnya */
    s = s.replace(/([)\]])[ \t]*([a-zA-Z_$])/g, '$1 $2');

    /* } else */
    s = s.replace(/}[ \t]*else\b/g, '} else');

    /* Final collapse */
    s = s.replace(/  +/g, ' ');

    return s;
}

export function formatScad(source) {
    if (!source || !source.trim()) return source || '';

    const lines = source.split('\n');
    const out = [];
    let depth = 0;
    let inBlockComment = false;

    for (const rawLine of lines) {
        const trimmed = rawLine.replace(/[ \t]+$/, '').trim();

        if (!trimmed) {
            if (out.length > 0 && out[out.length - 1] !== '') out.push('');
            continue;
        }

        if (inBlockComment) {
            if (trimmed.includes('*/')) inBlockComment = false;
            out.push('  '.repeat(depth) + trimmed);
            continue;
        }

        if (/^\/\*\s*\[[^\]]+\]\s*\*\/$/.test(trimmed)) {
            out.push(trimmed);
            continue;
        }

        if (trimmed.startsWith('/*') && !trimmed.includes('*/')) {
            out.push('  '.repeat(depth) + trimmed);
            inBlockComment = true;
            continue;
        }

        if (trimmed.startsWith('//')) {
            out.push('  '.repeat(depth) + trimmed);
            continue;
        }

        if (/^(include|use)\s*[<"]/.test(trimmed)) {
            let lc = 0;
            for (const ch of trimmed) {
                if (ch === '}' || ch === ']' || ch === ')') lc++;
                else break;
            }
            out.push('  '.repeat(Math.max(0, depth - lc)) + trimmed);
            continue;
        }

        let leadingClose = 0;
        for (const ch of trimmed) {
            if (ch === '}' || ch === ']' || ch === ')') leadingClose++;
            else break;
        }
        const effectiveDepth = Math.max(0, depth - leadingClose);

        const { masked, tokens } = maskStringsAndComments(trimmed);
        const spaced = applySpacing(masked);
        const formatted = unmask(spaced, tokens).trim();
        out.push('  '.repeat(effectiveDepth) + formatted);

        let net = 0;
        for (const ch of masked) {
            if (ch === '{' || ch === '[' || ch === '(') net++;
            else if (ch === '}' || ch === ']' || ch === ')') net--;
        }
        depth = Math.max(0, depth + net);
    }

    while (out.length && out[0] === '') out.shift();
    while (out.length && out[out.length - 1] === '') out.pop();

    return out.join('\n') + '\n';
}