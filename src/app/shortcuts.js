export function initShortcuts(deps) {
    const {
        editor, findReplace, cheatSheet, profilerPanel, workerClient,
        state, viewer, animation, btnCancelRender,
        saveNow, doRender, setPreviewMode, toggleFullscreenViewport,
        setMeasureMode, doFormat, goToLine
    } = deps;

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !btnCancelRender.classList.contains('hidden')) {
            e.preventDefault(); e.stopPropagation();
            if (workerClient) workerClient.cancel();
            import('../ui/status.js').then(m => m.setStatus('ready', 'Ready', false));
            import('../ui/status.js').then(m => m.toast('Render dibatalkan'));
            return;
        }

        const mod = e.ctrlKey || e.metaKey;
        const key = e.key;
        const inField = e.target.matches('input, textarea, select, [contenteditable]');

        if (mod && !e.altKey && !e.shiftKey) {
            const k = key.toLowerCase();
            if (k === 'f' || k === 'h' || k === 'g') {
                const target = e.target;
                const tag = target.tagName;
                const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
                const isEditor = target === document.getElementById('editor');
                const isFindInput = target.id === 'findInput' || target.id === 'replaceInput';
                if (isInput && !isEditor && !isFindInput) return;

                e.preventDefault(); e.stopPropagation();
                if (k === 'f') { isFindInput ? target.select() : findReplace.openFind(); }
                else if (k === 'h') findReplace.openReplace();
                else if (k === 'g') goToLine();
                return;
            }

            if (k === 's') {
                e.preventDefault(); e.stopPropagation();
                saveNow();
                import('../ui/status.js').then(m => m.toast('💾 Saved'));
                import('../ui/console.js').then(m => m.log('info', 'Disimpan ke localStorage.'));
                return;
            }
        }

        if (key === 'F5') { e.preventDefault(); e.stopPropagation(); if (!state.previewMode) setPreviewMode(true); return; }
        if (key === 'F6') { e.preventDefault(); e.stopPropagation(); if (state.previewMode) setPreviewMode(false); return; }

        if ((key === 'f' || key === 'F') && !inField) { e.preventDefault(); e.stopPropagation(); toggleFullscreenViewport(); return; }
        if ((key === 'm' || key === 'M') && !inField) { e.preventDefault(); e.stopPropagation(); setMeasureMode(!window._measureMode); return; }
        if (e.shiftKey && e.altKey && (key === 'f' || key === 'F')) { e.preventDefault(); e.stopPropagation(); doFormat(); return; }
        if (e.key === '?' && !inField) { e.preventDefault(); cheatSheet.toggle(); return; }

        if (e.key === 'Escape') {
            if (animation.active) { e.preventDefault(); animation.abort = true; import('../ui/status.js').then(m => m.toast('Animation stopped')); return; }
            if (window._measureMode) { e.preventDefault(); setMeasureMode(false); return; }
            if (findReplace.isOpen()) { findReplace.close(); return; }
            if (cheatSheet.isOpen()) { cheatSheet.close(); return; }
            if (profilerPanel.isVisible() && !document.querySelector('.modal-backdrop:not(.hidden)')) { profilerPanel.hide(); return; }
            if (document.body.classList.contains('fullscreen-viewport')) { setFullscreenViewport(false); return; }
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault(); doRender();
        }
    }, true);
}