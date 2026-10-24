import { SCADError } from '../utils.js';

export function tokenize(src) {
  const tokens = [];
  let i = 0, line = 1, col = 1;
  const n = src.length;
  const isDigit = c => c >= '0' && c <= '9';
  const isIdentStart = c => /[A-Za-z_$]/.test(c);
  const isIdentPart  = c => /[A-Za-z0-9_$]/.test(c);

  while (i < n) {
    const c = src[i];

    if (c === '\n') { i++; line++; col = 1; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; col++; continue; }

    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') { i++; col++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2; col += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') { line++; col = 1; } else col++;
        i++;
      }
      i = Math.min(i + 2, n); col += 2;
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))) {
      const sl = line, sc = col;
      let s = '';
      while (i < n && (isDigit(src[i]) || src[i] === '.')) { s += src[i]; i++; col++; }
      if (src[i] === 'e' || src[i] === 'E') {
        s += src[i]; i++; col++;
        if (src[i] === '+' || src[i] === '-') { s += src[i]; i++; col++; }
        while (i < n && isDigit(src[i])) { s += src[i]; i++; col++; }
      }
      tokens.push({ type: 'number', value: parseFloat(s), line: sl, col: sc });
      continue;
    }

    if (isIdentStart(c)) {
      const sl = line, sc = col;
      let s = '';
      while (i < n && isIdentPart(src[i])) { s += src[i]; i++; col++; }
      tokens.push({ type: 'ident', value: s, line: sl, col: sc });
      continue;
    }

    if (c === '"') {
      const sl = line, sc = col;
      i++; col++;
      let s = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\') { s += src[i + 1]; i += 2; col += 2; }
        else {
          if (src[i] === '\n') { line++; col = 1; } else col++;
          s += src[i]; i++;
        }
      }
      i++; col++;
      tokens.push({ type: 'string', value: s, line: sl, col: sc });
      continue;
    }

    const two = src.substr(i, 2);
    if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'op', value: two, line, col });
      i += 2; col += 2; continue;
    }

    if ('+-*/%^<>=!?:;,.(){}[]#'.includes(c)) {
      tokens.push({ type: 'op', value: c, line, col });
      i++; col++; continue;
    }

    throw new SCADError(`Karakter tidak dikenal: '${c}'`, line, col);
  }

  tokens.push({ type: 'eof', value: null, line, col });
  return tokens;
}