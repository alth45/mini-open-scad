import { escapeHtml } from '../utils.js';

export function createFindReplace({ editorEl, findMatchesEl, containerEl }) {
    let isOpen = false;
    let mode = 'find';       // 'find' | 'replace'
    let query = '';
    let matches = [];
    let activeIndex = -1;
    let caseSensitive = false;
    let wholeWord = false;

    /* ---- DOM ---- */
    const findBarEl = document.createElement('div');
    findBarEl.id = 'findBar';
    findBarEl.className = 'hidden';
    findBarEl.innerHTML = `
    <div class="find-row">
      <input type="text" id="findInput" placeholder="Find" autocomplete="off" spellcheck="false" />
      <button class="find-toggle" id="findCase" title="Match case (Aa)">Aa</button>
      <button class="find-toggle" id="findWord" title="Whole word (W)">W</button>
      <span class="find-counter" id="findCounter"></span>
      <button class="find-nav" id="findPrev" title="Previous (Shift+Enter)">↑</button>
      <button class="find-nav" id="findNext" title="Next (Enter)">↓</button>
      <button class="find-close" id="findClose" title="Close (Esc)">✕</button>
    </div>
    <div class="find-row hidden" id="replaceRow">
      <input type="text" id="replaceInput" placeholder="Replace with…" autocomplete="off" spellcheck="false" />
      <button class="find-btn" id="replaceBtn" title="Replace (Enter)">Replace</button>
      <button class="find-btn" id="replaceAllBtn" title="Replace all">All</button>
    </div>
  `;
    containerEl.appendChild(findBarEl);

    const findInputEl = findBarEl.querySelector('#findInput');
    const replaceInputEl = findBarEl.querySelector('#replaceInput');
    const replaceRowEl = findBarEl.querySelector('#replaceRow');
    const counterEl = findBarEl.querySelector('#findCounter');
    const caseBtnEl = findBarEl.querySelector('#findCase');
    const wordBtnEl = findBarEl.querySelector('#findWord');

    /* ============================================================
       Search
       ============================================================ */
    function isWordChar(c) { return /[A-Za-z0-9_$]/.test(c); }

    function runSearch() {
        matches = [];
        activeIndex = -1;

        if (!query) {
            updateCounter();
            renderMatches();
            return;
        }

        const text = editorEl.value;
        const hay = caseSensitive ? text : text.toLowerCase();
        const needle = caseSensitive ? query : query.toLowerCase();
        const needleLen = needle.length;
        if (needleLen === 0) { updateCounter(); renderMatches(); return; }

        let idx = 0;
        while (idx <= hay.length - needleLen) {
            const at = hay.indexOf(needle, idx);
            if (at === -1) break;

            if (wholeWord) {
                const before = at === 0 ? '' : text[at - 1];
                const after = at + needleLen >= text.length ? '' : text[at + needleLen];
                if (isWordChar(before) || isWordChar(after)) {
                    idx = at + 1;
                    continue;
                }
            }

            matches.push({ start: at, end: at + needleLen });
            idx = at + needleLen;
            if (matches.length > 5000) break;
        }

        updateCounter();
    }

    function updateCounter() {
        if (!query) {
            counterEl.textContent = '';
            counterEl.classList.remove('no-match');
            return;
        }
        if (matches.length === 0) {
            counterEl.textContent = '0/0';
            counterEl.classList.add('no-match');
            return;
        }
        const cur = activeIndex >= 0 ? activeIndex + 1 : 1;
        counterEl.textContent = `${cur}/${matches.length}`;
        counterEl.classList.remove('no-match');
    }

    /* ============================================================
       Render highlights ke overlay
       ============================================================ */
    function renderMatches() {
        if (!isOpen || matches.length === 0) {
            findMatchesEl.innerHTML = '';
            return;
        }
        const text = editorEl.value;
        let out = '';
        let cursor = 0;
        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            if (m.start > cursor) out += escapeHtml(text.slice(cursor, m.start));
            const cls = i === activeIndex ? 'find-match find-match-active' : 'find-match';
            out += `<mark class="${cls}">${escapeHtml(text.slice(m.start, m.end))}</mark>`;
            cursor = m.end;
        }
        if (cursor < text.length) out += escapeHtml(text.slice(cursor));
        findMatchesEl.innerHTML = out + '\n';
        syncMatchScroll();
    }

    function syncMatchScroll() {
        findMatchesEl.scrollTop = editorEl.scrollTop;
        findMatchesEl.scrollLeft = editorEl.scrollLeft;
    }

    /* ============================================================
       Navigation
       ============================================================ */
    function setActiveMatch(index) {
        if (matches.length === 0) return;
        activeIndex = ((index % matches.length) + matches.length) % matches.length;
        const m = matches[activeIndex];
        editorEl.setSelectionRange(m.start, m.end);
        scrollMatchIntoView(m);
        updateCounter();
        renderMatches();
    }

    function scrollMatchIntoView(m) {
        const text = editorEl.value;
        const line = (text.slice(0, m.start).match(/\n/g) || []).length;
        const lh = parseFloat(getComputedStyle(editorEl).lineHeight) || 20;
        const topPx = line * lh;
        const viewH = editorEl.clientHeight;
        if (topPx < editorEl.scrollTop + lh) {
            editorEl.scrollTop = Math.max(0, topPx - lh * 2);
        } else if (topPx + lh > editorEl.scrollTop + viewH - lh) {
            editorEl.scrollTop = topPx + lh - viewH + lh * 2;
        }
        syncMatchScroll();
    }

    function findNext() {
        if (matches.length === 0) return;
        setActiveMatch(activeIndex < 0 ? 0 : activeIndex + 1);
    }

    function findPrev() {
        if (matches.length === 0) return;
        setActiveMatch(activeIndex <= 0 ? matches.length - 1 : activeIndex - 1);
    }

    /* ============================================================
       Replace
       ============================================================ */
    function replaceOne() {
        if (matches.length === 0 || activeIndex < 0) { findNext(); return; }
        const m = matches[activeIndex];
        const replacement = replaceInputEl.value;
        const text = editorEl.value;
        editorEl.value = text.slice(0, m.start) + replacement + text.slice(m.end);
        const caret = m.start + replacement.length;
        editorEl.setSelectionRange(caret, caret);
        editorEl.dispatchEvent(new Event('input'));

        runSearch();
        if (matches.length > 0) {
            let nextIdx = 0;
            for (let i = 0; i < matches.length; i++) {
                if (matches[i].start >= caret) { nextIdx = i; break; }
                nextIdx = (i + 1) % matches.length;
            }
            setActiveMatch(nextIdx);
        } else {
            renderMatches();
            updateCounter();
        }
    }

    function replaceAll() {
        if (matches.length === 0) return;
        const replacement = replaceInputEl.value;
        const text = editorEl.value;
        let out = '';
        let cursor = 0;
        for (const m of matches) {
            out += text.slice(cursor, m.start) + replacement;
            cursor = m.end;
        }
        out += text.slice(cursor);
        editorEl.value = out;
        editorEl.dispatchEvent(new Event('input'));

        runSearch();
        renderMatches();
        updateCounter();
    }

    /* ============================================================
       Open / Close / Refresh
       ============================================================ */
    function open(m) {
        mode = m || 'find';
        isOpen = true;
        findBarEl.classList.remove('hidden');
        replaceRowEl.classList.toggle('hidden', mode !== 'replace');

        /* Seed dari selection */
        const selStart = editorEl.selectionStart;
        const selEnd = editorEl.selectionEnd;
        if (selStart !== selEnd) {
            const sel = editorEl.value.slice(selStart, selEnd);
            if (sel && !sel.includes('\n') && sel.length < 200) {
                findInputEl.value = sel;
            }
        }
        query = findInputEl.value;
        runSearch();

        if (matches.length > 0) {
            let idx = 0;
            for (let i = 0; i < matches.length; i++) {
                if (matches[i].start >= selStart) { idx = i; break; }
            }
            setActiveMatch(idx);
        } else {
            renderMatches();
            updateCounter();
        }

        findInputEl.focus();
        findInputEl.select();
    }

    function close() {
        isOpen = false;
        findBarEl.classList.add('hidden');
        findMatchesEl.innerHTML = '';
        editorEl.focus();
    }

    /** Dipanggil eksternal saat editor value berubah via undo/redo/setValue. */
    function refresh() {
        if (!isOpen) return;
        runSearch();
        renderMatches();
        updateCounter();
    }

    /* ============================================================
       Events
       ============================================================ */
    findInputEl.addEventListener('input', () => {
        query = findInputEl.value;
        activeIndex = -1;
        runSearch();
        if (matches.length > 0) setActiveMatch(0);
        else { renderMatches(); updateCounter(); }
    });

    findInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) findPrev();
            else findNext();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    });

    replaceInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); replaceOne(); }
    });

    caseBtnEl.addEventListener('click', () => {
        caseSensitive = !caseSensitive;
        caseBtnEl.classList.toggle('active', caseSensitive);
        activeIndex = -1;
        runSearch();
        if (matches.length > 0) setActiveMatch(0);
        else { renderMatches(); updateCounter(); }
    });

    wordBtnEl.addEventListener('click', () => {
        wholeWord = !wholeWord;
        wordBtnEl.classList.toggle('active', wholeWord);
        activeIndex = -1;
        runSearch();
        if (matches.length > 0) setActiveMatch(0);
        else { renderMatches(); updateCounter(); }
    });

    findBarEl.querySelector('#findPrev').addEventListener('click', findPrev);
    findBarEl.querySelector('#findNext').addEventListener('click', findNext);
    findBarEl.querySelector('#findClose').addEventListener('click', close);
    findBarEl.querySelector('#replaceBtn').addEventListener('click', replaceOne);
    findBarEl.querySelector('#replaceAllBtn').addEventListener('click', replaceAll);

    editorEl.addEventListener('scroll', syncMatchScroll);

    return {
        openFind: () => open('find'),
        openReplace: () => open('replace'),
        close,
        isOpen: () => isOpen,
        findNext,
        findPrev,
        refresh,
    };
}