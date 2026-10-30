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
    function updateLineNumbers() {
        const lines = editorEl.value.split('\n').length;
        let s = '';
        for (let i = 1; i <= lines; i++) s += i + '\n';
        gutterEl.textContent = s;
    }
    function syncScroll() {
        gutterEl.scrollTop = editorEl.scrollTop;
        highlightEl.scrollTop = editorEl.scrollTop;
        highlightEl.scrollLeft = editorEl.scrollLeft;
    }
    function refresh() {
        highlightEl.innerHTML = highlightCode(editorEl.value);
        updateLineNumbers();
        syncScroll();
    }

    /* ---- value-change listeners (untuk find-replace dkk) ---- */
    const valueListeners = new Set();
    function notifyValueChange() {
        for (const fn of valueListeners) fn(editorEl.value);
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

        /* ---------- ui luar bisa subscribe changes ---------- */
        onValueChange(fn) {
            valueListeners.add(fn);
            return () => valueListeners.delete(fn);
        },
    };
}