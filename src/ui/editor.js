import { escapeHtml } from '../utils.js';

const HL_KEYWORDS = new Set([
    'cube', 'sphere', 'cylinder', 'polyhedron',
    'circle', 'square', 'polygon', 'text',
    'translate', 'rotate', 'scale', 'mirror', 'color',
    'union', 'difference', 'intersection', 'hull',
    'linear_extrude', 'rotate_extrude', 'offset', 'minkowski', 'resize', 'multmatrix',
    'for', 'if', 'else', 'module', 'function',
    'include', 'use',
    'true', 'false', 'undef'
]);

function highlightCode(src) {
    let out = '';
    let buf = '';
    let i = 0;
    const n = src.length;
    const flush = () => { if (buf) { out += escapeHtml(buf); buf = ''; } };

    while (i < n) {
        const c = src[i];

        if (c === '/' && src[i + 1] === '/') {
            flush();
            let j = i;
            while (j < n && src[j] !== '\n') j++;
            out += `<span class="tok-com">${escapeHtml(src.slice(i, j))}</span>`;
            i = j; continue;
        }
        if (c === '/' && src[i + 1] === '*') {
            flush();
            let j = src.indexOf('*/', i + 2);
            j = j === -1 ? n : j + 2;
            out += `<span class="tok-com">${escapeHtml(src.slice(i, j))}</span>`;
            i = j; continue;
        }
        if (c === '"') {
            flush();
            let j = i + 1;
            while (j < n && src[j] !== '"') {
                if (src[j] === '\\') j++;
                j++;
            }
            j = Math.min(j + 1, n);
            out += `<span class="tok-str">${escapeHtml(src.slice(i, j))}</span>`;
            i = j; continue;
        }
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
            flush();
            let j = i;
            while (j < n && /[0-9.]/.test(src[j])) j++;
            out += `<span class="tok-num">${escapeHtml(src.slice(i, j))}</span>`;
            i = j; continue;
        }
        if (/[A-Za-z_$]/.test(c)) {
            flush();
            let j = i;
            while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
            const word = src.slice(i, j);
            if (HL_KEYWORDS.has(word)) out += `<span class="tok-kw">${escapeHtml(word)}</span>`;
            else if (word[0] === '$') out += `<span class="tok-spl">${escapeHtml(word)}</span>`;
            else out += escapeHtml(word);
            i = j; continue;
        }
        if (c === '*' || c === '!' || c === '#') {
            flush();
            out += `<span class="tok-mod">${escapeHtml(c)}</span>`;
            i++; continue;
        }
        buf += c; i++;
    }
    flush();
    return out + '\n';
}

export function createEditor({ editorEl, highlightEl, gutterEl, onChange, onSave, onHistoryChange }) {
        /* ---------- view refresh ---------- */
        function renderGutter() {
        const lines = editorEl.value.split('\n');
        const blocks = detectFoldableBlocks(lines);
        const foldableStarts = new Set(blocks.map(b => b.startLine));

        let html = '';
        for (let i = 0; i < lines.length; i++) {
            const isFolded = folds.has(i);
            const canFold = foldableStarts.has(i);
            const icon = isFolded ? '▸' : canFold ? '▾' : '';
            const cls = 'gutter-fold'
                + (canFold ? ' can-fold' : '')
                + (isFolded ? ' folded' : '');
            html += `<div class="gutter-line">`
                +  `<span class="${cls}" data-line="${i}">${icon}</span>`
                +  `<span class="gutter-num">${i + 1}</span>`
                +  `</div>`;
        }
        gutterEl.innerHTML = html;
    }
    function syncScroll() {
        gutterEl.scrollTop = editorEl.scrollTop;
        highlightEl.scrollTop = editorEl.scrollTop;
        highlightEl.scrollLeft = editorEl.scrollLeft;
    }
    function refresh() {
        highlightEl.innerHTML = highlightCode(editorEl.value);
        renderGutter();
        syncScroll();
    }

    /* ---- value-change listeners (untuk find-replace dkk) ---- */
    const valueListeners = new Set();
    function notifyValueChange() {
        for (const fn of valueListeners) fn(editorEl.value);
    }
            /* ============================================================
        Code folding
        ============================================================ */
    const folds = new Map();   // Map<startLineIdx, { hiddenLines: string[] }>

    /** Mask string & comment di satu baris — hanya brace yang tersisa */
    function maskBracesInLine(line) {
        let out = '';
        let i = 0;
        const n = line.length;
        while (i < n) {
            const c = line[i];
            if (c === '/' && line[i + 1] === '/') break;
            if (c === '/' && line[i + 1] === '*') break;
            if (c === '"') {
                i++;
                while (i < n && line[i] !== '"') { if (line[i] === '\\') i++; i++; }
                i++;
                out += '""';
                continue;
            }
            out += c;
            i++;
        }
        return out;
    }

    /** Deteksi blok foldable: [{ startLine, endLine }] — brace matching, non-nested di luar */
    function detectFoldableBlocks(lines) {
        const blocks = [];
        const stack = [];
        for (let i = 0; i < lines.length; i++) {
            const masked = maskBracesInLine(lines[i]);
            for (const ch of masked) {
                if (ch === '{') {
                    stack.push(i);
                } else if (ch === '}') {
                    const start = stack.pop();
                    if (start !== undefined && start < i) {
                        blocks.push({ startLine: start, endLine: i });
                    }
                }
            }
        }
        return blocks;
    }

    /** Rekonstruksi full code (unfold semua) tanpa mengubah editorEl.value */
    function getFullCode() {
        if (folds.size === 0) return editorEl.value;
        let lines = editorEl.value.split('\n');
        const sorted = [...folds.entries()].sort(([a], [b]) => b - a);
        for (const [startLine, fold] of sorted) {
            lines = [
                ...lines.slice(0, startLine + 1),
                ...fold.hiddenLines,
                ...lines.slice(startLine + 1)
            ];
        }
        return lines.join('\n');
    }

    function clearAllFolds() {
        if (folds.size === 0) return false;
        let lines = editorEl.value.split('\n');
        const sorted = [...folds.entries()].sort(([a], [b]) => b - a);
        for (const [startLine, fold] of sorted) {
            lines = [
                ...lines.slice(0, startLine + 1),
                ...fold.hiddenLines,
                ...lines.slice(startLine + 1)
            ];
        }
        folds.clear();
        return true;
    }

    function foldAt(startLineIdx) {
        if (folds.has(startLineIdx)) return;
        const lines = editorEl.value.split('\n');
        const blocks = detectFoldableBlocks(lines);
        const block = blocks.find(b => b.startLine === startLineIdx);
        if (!block) return;

        const hiddenLines = lines.slice(startLineIdx + 1, block.endLine);
        if (hiddenLines.length === 0) return;   // empty block — nothing to hide

        folds.set(startLineIdx, { hiddenLines });

        editorEl.value = [
            ...lines.slice(0, startLineIdx + 1),
            ...lines.slice(block.endLine)
        ].join('\n');
        refresh();
    }

    function unfoldAt(startLineIdx) {
        const fold = folds.get(startLineIdx);
        if (!fold) return;
        const lines = editorEl.value.split('\n');
        editorEl.value = [
            ...lines.slice(0, startLineIdx + 1),
            ...fold.hiddenLines,
            ...lines.slice(startLineIdx + 1)
        ].join('\n');
        folds.delete(startLineIdx);
        refresh();
    }

    function foldAllBlocks() {
        const lines = editorEl.value.split('\n');
        const blocks = detectFoldableBlocks(lines);
        /* Top-level only, urutkan descending agar fold di bawah tidak menggeser atas */
        blocks.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
        const topLevel = [];
        let lastEnd = -1;
        for (const b of blocks) {
            if (b.startLine > lastEnd) { topLevel.push(b); lastEnd = b.endLine; }
        }
        topLevel.sort((a, b) => b.startLine - a.startLine);
        for (const b of topLevel) foldAt(b.startLine);
    }

    /** Baris pada posisi kursor */
    function cursorLineIdx() {
        return editorEl.value.slice(0, editorEl.selectionStart).split('\n').length - 1;
    }

    /** Fold terdekat dari kursor (current line, atau baris di atasnya) */
    function foldAtCursor() {
        const line = cursorLineIdx();
        if (folds.has(line)) { unfoldAt(line); return; }
        const lines = editorEl.value.split('\n');
        const blocks = detectFoldableBlocks(lines);
        const here = blocks.find(b => b.startLine === line);
        if (here) { foldAt(line); return; }
        /* Cari block di atas yang masih enclosing */
        const above = blocks.filter(b => b.startLine < line && b.endLine > line);
        if (above.length > 0) {
            const outer = above.sort((a, b) => a.startLine - b.startLine)[0];
            foldAt(outer.startLine);
        }
    }   

    function unfoldAtCursor() {
        const line = cursorLineIdx();
        if (folds.has(line)) { unfoldAt(line); return; }
        /* Cari fold yang enclosing kursor */
        for (const [startLine] of folds) {
            if (startLine < line) { unfoldAt(startLine); return; }
        }
    }

    /* ---------- history ---------- */
    const MAX_HISTORY = 200;
    const DEBOUNCE_MS = 400;

    const history = { stack: [], index: -1 };
    let historyTimer = null;
    let applying = false;

    function snapshot() {
        return {
            value: editorEl.value,
            selStart: editorEl.selectionStart,
            selEnd: editorEl.selectionEnd
        };
    }

    function notifyHistory() {
        onHistoryChange?.({
            canUndo: history.index > 0,
            canRedo: history.index < history.stack.length - 1
        });
    }

    function commitHistory() {
        clearTimeout(historyTimer);
        historyTimer = null;
        if (applying) return;

        const snap = snapshot();
        const cur = history.stack[history.index];
        if (cur && cur.value === snap.value) return;   // no-op

        // truncate redo branch
        history.stack.length = history.index + 1;
        history.stack.push(snap);
        if (history.stack.length > MAX_HISTORY) history.stack.shift();
        history.index = history.stack.length - 1;
        notifyHistory();
    }

    function scheduleCommit() {
        if (applying) return;
        clearTimeout(historyTimer);
        historyTimer = setTimeout(commitHistory, DEBOUNCE_MS);
    }

    function applySnapshot(snap) {
        folds.clear();
        applying = true;
        try {
            editorEl.value = snap.value;
            refresh();
            editorEl.selectionStart = snap.selStart;
            editorEl.selectionEnd = snap.selEnd;
        } finally {
            applying = false;
        }
        onChange?.(snap.value);
        notifyValueChange();
        notifyHistory();
    }

    function undo() {
        if (historyTimer) commitHistory();     // flush pending typing
        if (history.index <= 0) return;
        history.index--;
        applySnapshot(history.stack[history.index]);
    }

    function redo() {
        if (history.index >= history.stack.length - 1) return;
        history.index++;
        applySnapshot(history.stack[history.index]);
    }
        /* ============================================================
    Toggle line comment (Ctrl+/)
    ============================================================ */
    function toggleLineComment() {
        const start = editorEl.selectionStart;
        const end = editorEl.selectionEnd;
        const val = editorEl.value;

        /* Batas blok baris */
        const startLineStart = val.lastIndexOf('\n', start - 1) + 1;
        const endLineEnd = val.indexOf('\n', end);
        const endPos = endLineEnd === -1 ? val.length : endLineEnd;

        const block = val.slice(startLineStart, endPos);
        const lines = block.split('\n');

        /* Cek apakah semua non-empty lines sudah commented */
        const nonEmpty = lines.filter(l => l.trim().length > 0);
        const allCommented = nonEmpty.length > 0 &&
                            nonEmpty.every(l => /^\s*\/\//.test(l));

        let newLines;
        if (allCommented) {
            /* Uncomment — hapus `// ` atau `//` setelah indent */
            newLines = lines.map(line => {
                if (line.trim().length === 0) return line;
                return line.replace(/^(\s*)\/\/\s?/, '$1');
            });
        } else {
            /* Comment — tambah `// ` setelah indent, skip empty lines */
            newLines = lines.map(line => {
                if (line.trim().length === 0) return line;
                return line.replace(/^(\s*)(.*)$/, '$1// $2');
            });
        }

        const newBlock = newLines.join('\n');
        if (newBlock === block) return;   // no-op

        const newVal = val.slice(0, startLineStart) + newBlock + val.slice(endPos);

        editorEl.value = newVal;

        /* Selection handling */
        if (start === end) {
            /* No selection → cursor di akhir baris */
            const newCursor = startLineStart + newBlock.length;
            editorEl.setSelectionRange(newCursor, newCursor);
        } else {
            /* Ada selection → select seluruh block */
            editorEl.setSelectionRange(startLineStart, startLineStart + newBlock.length);
        }

        editorEl.dispatchEvent(new Event('input'));
    }

    /* seed with current value */
    history.stack.push(snapshot());
    history.index = 0;

    /* ---------- events ---------- */
    editorEl.addEventListener('input', () => {
        if (applying) return;
        refresh();
        onChange?.(editorEl.value);
        notifyValueChange();
        scheduleCommit();
    });

    editorEl.addEventListener('scroll', syncScroll);
    /* Gutter click → toggle fold */
    gutterEl.addEventListener('click', (e) => {
        const icon = e.target.closest('.gutter-fold');
        if (!icon) return;
        const lineIdx = parseInt(icon.dataset.line, 10);
        if (folds.has(lineIdx)) unfoldAt(lineIdx);
        else foldAt(lineIdx);
    });

        /* Klik di textarea → unfold semua (review mode → edit mode) */
    editorEl.addEventListener('mousedown', () => {
        if (folds.size > 0) {
            clearAllFolds();
            refresh();
        }
    });

    editorEl.addEventListener('blur', () => {
        if (historyTimer) commitHistory();
    });

    editorEl.addEventListener('keydown', e => {
        const mod = e.ctrlKey || e.metaKey;

        /* Undo: Ctrl+Z / Cmd+Z */
        if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            undo();
            return;
        }

        /* Redo: Ctrl+Y / Ctrl+Shift+Z / Cmd+Shift+Z */
        if (mod && (
            (!e.shiftKey && (e.key === 'y' || e.key === 'Y')) ||
            (e.shiftKey && (e.key === 'z' || e.key === 'Z'))
        )) {
            e.preventDefault();
            redo();
            return;
        }

        if (e.key === 'Tab') {
            e.preventDefault();
            const start = editorEl.selectionStart;
            const end = editorEl.selectionEnd;
            const val = editorEl.value;
            editorEl.value = val.slice(0, start) + '  ' + val.slice(end);
            editorEl.selectionStart = editorEl.selectionEnd = start + 2;
            refresh();
            onChange?.(editorEl.value);
            notifyValueChange();
            scheduleCommit();
            return;
        }

        if (mod && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            onSave?.();
        }

                /* Ctrl+Shift+[ → fold at cursor; Ctrl+Shift+] → unfold at cursor */
        if (mod && e.shiftKey && !e.altKey && (e.key === '{' || e.key === '[')) {
            e.preventDefault();
            foldAtCursor();
            return;
        }
        if (mod && e.shiftKey && !e.altKey && (e.key === '}' || e.key === ']')) {
            e.preventDefault();
            unfoldAtCursor();
            return;
        }
                /* Toggle line comment: Ctrl+/ (atau Cmd+/ di Mac) */
        if (mod && !e.shiftKey && !e.altKey && e.key === '/') {
            e.preventDefault();
            toggleLineComment();
            return;
        }
    });

    /* ---------- public API ---------- */
    return {
        getValue: () => editorEl.value,

        /**
         * @param {string} v
         * @param {{ recordHistory?: boolean }} opts
         *   recordHistory=true (default) → bisa di-undo
         *   recordHistory=false → reset history (dipakai saat init)
         */
        setValue(v, { recordHistory = true } = {}) {
            folds.clear();
            if (historyTimer) commitHistory();     // flush pending
            notifyValueChange();
            applying = true;
            try {
                editorEl.value = v;
                refresh();
            } finally {
                applying = false;
            }

            if (recordHistory) {
                commitHistory();
            } else {
                history.stack = [snapshot()];
                history.index = 0;
                notifyHistory();
            }
        },

        refresh,
        focus: () => editorEl.focus(),
        undo,
        redo,
        canUndo: () => history.index > 0,
        canRedo: () => history.index < history.stack.length - 1,
        toggleLineComment,
        foldAll: foldAllBlocks,                    // ← add
        unfoldAll: () => { if (clearAllFolds()) refresh(); },   // ← add

        /* ---------- ui luar bisa subscribe changes ---------- */
        onValueChange(fn) {
            valueListeners.add(fn);
            return () => valueListeners.delete(fn);
        },
    };
}