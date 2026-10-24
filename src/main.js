import './styles.css';
import { CONFIG, DEFAULT_CODE, PRESETS } from './config.js';
import { state } from './state.js';
import { saveTabs, loadTabs } from './storage.js';
import { formatError } from './utils.js';
import { buildModel, deserializeModel } from './viewer/model.js';
import { Viewer } from './viewer/scene.js';
import { createEditor } from './ui/editor.js';
import { log, clear as clearConsole, initConsoleControls } from './ui/console.js';
import { setStatus, toast } from './ui/status.js';
import { exportSTL } from './export.js';
import { CSG } from './evaluator/csg.js';
import { parseParams, mergeParamValues } from './core/params.js';
import { createParamsPanel } from './ui/params-panel.js';
import { createWorkerClient } from './worker/worker-client.js';
import { TabManager, createTab } from './tabs.js';
import { createTabBar } from './ui/tabbar.js';
import { encodeShareTab, buildShareUrl, readShareFromUrl } from './share.js';
import { downloadDataUrl, downloadBlob, timestampForFile, escapeHtml } from './utils.js';
import { createGifEncoder } from './gif.js';
import { createCheatSheet } from './ui/cheatsheet.js';
import { saveFile, loadFiles, listFiles, deleteFile } from './files/file-store.js';
import { extractImportNames } from './core/ast-utils.js';

/* ============================================================
   Viewer
   ============================================================ */
const viewer = new Viewer(document.getElementById('viewport'));
viewer.setInfoElements(document.getElementById('fps'), document.getElementById('viewInfo'));

/* ============================================================
   Worker
   ============================================================ */
let workerClient = null;
try {
    workerClient = createWorkerClient();
    if (workerClient) log('info', 'Web Worker aktif — evaluasi di thread terpisah.');
    else log('warn', 'Web Worker tidak tersedia — fallback sync.');
} catch (e) {
    console.warn(e);
    log('warn', 'Worker gagal init — fallback sync.');
}

/* ============================================================
   Tab manager (dideklarasikan dulu, dipakai editor onChange)
   ============================================================ */
let tabManager = null;

/* ============================================================
   Editor
   ============================================================ */
const btnUndo = document.getElementById('btnUndo');
const btnRedo = document.getElementById('btnRedo');

const editor = createEditor({
    editorEl: document.getElementById('editor'),
    highlightEl: document.getElementById('highlight'),
    gutterEl: document.getElementById('gutter'),
    onChange: (code) => {
        tabManager?.updateActiveSilent({ code });
        scheduleAutoRender();
        scheduleSave();
    },
    onSave: () => {
        saveNow();
        toast('💾 Saved');
        log('info', 'Disimpan ke localStorage.');
    },
    onHistoryChange: ({ canUndo, canRedo }) => {
        btnUndo.disabled = !canUndo;
        btnRedo.disabled = !canRedo;
    }
});

btnUndo.addEventListener('click', () => { editor.undo(); editor.focus(); });
btnRedo.addEventListener('click', () => { editor.redo(); editor.focus(); });

/* ============================================================
   Params panel
   ============================================================ */
const paramsPanelEl = document.getElementById('paramsPanel');
const btnParams = document.getElementById('btnParams');
let paramRenderTimer = null;

const paramsPanel = createParamsPanel({
    panelEl: paramsPanelEl,
    bodyEl: document.getElementById('paramsBody'),
    titleEl: document.getElementById('paramsTitle'),
    resetBtn: document.getElementById('paramsReset'),
    closeBtn: document.getElementById('paramsClose'),
    onChange: (name, value, allValues) => {
        state.paramValues = { ...allValues };
        tabManager?.updateActiveSilent({ paramValues: state.paramValues });
        scheduleSave();
        clearTimeout(paramRenderTimer);
        paramRenderTimer = setTimeout(doRender, 200);
    }
});

btnParams.addEventListener('click', () => {
    paramsPanelEl.classList.toggle('hidden');
    if (!paramsPanel.isHidden()) refreshParams();
});

function refreshParams() {
    const code = editor.getValue();
    const params = parseParams(code);
    state.paramValues = mergeParamValues(params, state.paramValues);
    tabManager?.updateActiveSilent({ paramValues: state.paramValues });
    paramsPanel.setParams(params, state.paramValues);
    btnParams.classList.toggle('has-params', params.length > 0);
}

/* ============================================================
   Tab manager wiring
   ============================================================ */
const tabBar = createTabBar(document.getElementById('tabbar-desktop'));

tabManager = new TabManager({
    onListChange: (tabs, activeId) => {
        tabBar.render(tabs, activeId, {
            onSelect: switchTab,
            onClose: closeTab,
            onAdd: addTab,
            onRename: (id, name) => { tabManager.rename(id, name); saveNow(); }
        });
    },
    onActiveChange: (tab) => {
        if (!tab) return;
        editor.setValue(tab.code, { recordHistory: false });
        state.autoRender = tab.autoRender;
        state.paramValues = { ...tab.paramValues };
        updateAutoBtn();
        refreshParams();
        doRender();
    }
});

function switchTab(id) {
    saveNow();
    tabManager.setActive(id);
}

function closeTab(id) {
    if (!tabManager.remove(id)) {
        toast('Tidak bisa close tab terakhir');
    } else {
        saveNow();
    }
}

function addTab() {
    const used = new Set(tabManager.tabs.map(t => t.name));
    let n = 1;
    while (used.has('Project ' + n)) n++;
    const tab = createTab('Project ' + n, DEFAULT_CODE);
    tabManager.add(tab);
    saveNow();
}

/* ============================================================
   Save / autosave
   ============================================================ */
let saveTimer = null;

function saveNow() {
    if (!tabManager) return;
    saveTabs(tabManager.tabs, tabManager.activeId);
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, CONFIG.saveDelay);
}

/* ============================================================
   Auto-render
   ============================================================ */
let autoRenderTimer = null;

function scheduleAutoRender() {
    if (!state.autoRender) return;
    clearTimeout(autoRenderTimer);
    autoRenderTimer = setTimeout(doRender, CONFIG.autoRenderDelay);
}

/* ============================================================
   Render pipeline
   ============================================================ */
async function doRender() {
    refreshParams();
    const code = editor.getValue();
    setStatus('rendering', 'Rendering…');

    try {
        let result;

        if (workerClient) {
            const data = await workerClient.run(code, state.paramValues);
            result = {
                root: deserializeModel(data.meshes),
                ms: data.ms,
                meshCount: data.meshCount,
                triCount: data.triCount,
                warnings: data.warnings || [],
                echoes: data.echoes || []
            };
        } else {
            await new Promise(r => requestAnimationFrame(r));
            const importNames = extractImportNames(code);
            const files = importNames.length > 0 ? await loadFiles(importNames) : {};
            result = buildModel(code, state.paramValues, files);
        }

        viewer.setModelRoot(result.root);
        viewer.fitToObject(result.root);
        setStatus('ready', 'Ready');
        state.lastSuccess = code;

        log('ok',
            `Rendered in ${result.ms.toFixed(0)} ms · ${result.meshCount} mesh · ` +
            `${Math.round(result.triCount)} triangle` +
            (result.ms > 500 ? '  (lambat — pertimbangkan turunkan $fn)' : '')
        );
        for (const w of result.warnings) log('warn', w);
        for (const e of result.echoes) log('info', e);
    } catch (err) {
        if (err && err.name === 'CancelledError') return;
        setStatus('error', 'Error');
        log('error', formatError(err, code));
        toast('✖ ' + (err.message || 'Render gagal'));
    }
}

/* ============================================================
   Presets
   ============================================================ */
const presetSel = document.getElementById('presetSelect');
for (const name of Object.keys(PRESETS)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    presetSel.appendChild(opt);
}
presetSel.addEventListener('change', () => {
    const name = presetSel.value;
    if (!name) return;
    editor.setValue(PRESETS[name]);
    tabManager.updateActiveSilent({ code: editor.getValue(), name });
    saveNow();
    presetSel.value = '';
    doRender();
    toast('Preset: ' + name);
});

/* ============================================================
   Share
   ============================================================ */
const shareModal = document.getElementById('shareModal');
const shareUrlEl = document.getElementById('shareUrl');
const shareLenEl = document.getElementById('shareLen');
const shareWarnEl = document.getElementById('shareWarn');

document.getElementById('btnShare').addEventListener('click', openShareModal);
document.getElementById('shareClose').addEventListener('click', () => shareModal.classList.add('hidden'));
shareModal.addEventListener('click', (e) => {
    if (e.target === shareModal) shareModal.classList.add('hidden');
});

async function openShareModal() {
    const tab = tabManager.active;
    if (!tab) return;

    try {
        const hash = await encodeShareTab(tab);
        const url = buildShareUrl(hash);

        shareUrlEl.value = url;
        shareUrlEl.dataset.url = url;
        shareLenEl.textContent = url.length;
        shareWarnEl.classList.toggle('hidden', url.length <= 8000);

        shareModal.classList.remove('hidden');
        shareUrlEl.focus();
        shareUrlEl.select();
    } catch (e) {
        log('error', 'Gagal membuat share URL: ' + e.message);
        toast('✖ Share gagal');
    }
}

document.getElementById('shareCopy').addEventListener('click', async () => {
    const url = shareUrlEl.dataset.url || shareUrlEl.value;
    try {
        await navigator.clipboard.writeText(url);
        toast('📋 URL copied');
    } catch {
        shareUrlEl.focus();
        shareUrlEl.select();
        document.execCommand('copy');
        toast('📋 URL copied');
    }
});

document.getElementById('shareOpen').addEventListener('click', () => {
    const url = shareUrlEl.dataset.url || shareUrlEl.value;
    window.open(url, '_blank', 'noopener');
});

/* ============================================================
   Files (STL import)
   ============================================================ */
const filesModal = document.getElementById('filesModal');
const filesInput = document.getElementById('filesInput');
const filesListEl = document.getElementById('filesList');
const dropOverlay = document.getElementById('dropOverlay');
const editorEl = document.getElementById('editor');

document.getElementById('btnFiles').addEventListener('click', openFilesModal);
document.getElementById('filesClose').addEventListener('click', () => filesModal.classList.add('hidden'));
filesModal.addEventListener('click', (e) => { if (e.target === filesModal) filesModal.classList.add('hidden'); });

document.getElementById('filesPick').addEventListener('click', () => filesInput.click());
filesInput.addEventListener('change', async () => {
    if (filesInput.files && filesInput.files.length > 0) {
        await importFiles([...filesInput.files]);
        filesInput.value = '';
        await refreshFilesList();
    }
});

/* Drag & drop di viewport */
let dragCounter = 0;
viewer.container.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.remove('hidden');
});
viewer.container.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
});
viewer.container.addEventListener('dragleave', () => {
    if (--dragCounter <= 0) {
        dragCounter = 0;
        dropOverlay.classList.add('hidden');
    }
});
viewer.container.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.add('hidden');
    await importFiles([...e.dataTransfer.files]);
    await refreshFilesList();
});

async function importFiles(files) {
    const MAX_SIZE = 100 * 1024 * 1024;
    let saved = 0, skipped = 0;
    for (const f of files) {
        if (!/\.stl$/i.test(f.name)) { skipped++; continue; }
        if (f.size > MAX_SIZE) {
            log('warn', `File '${f.name}' terlalu besar (${(f.size / 1024 / 1024).toFixed(1)}MB > 100MB)`);
            skipped++;
            continue;
        }
        try {
            const buffer = await f.arrayBuffer();
            await saveFile(f.name, buffer, f.type || 'model/stl');
            saved++;
            log('info', `📁 ${f.name} (${(f.size / 1024).toFixed(1)} KB) imported`);
        } catch (err) {
            log('error', `Gagal import '${f.name}': ${err.message}`);
        }
    }
    if (saved > 0) {
        toast(`📁 ${saved} file imported`);
        scheduleAutoRender();
    }
    if (skipped > 0) log('warn', `${skipped} file dilewati`);
}

async function openFilesModal() {
    filesModal.classList.remove('hidden');
    await refreshFilesList();
}

async function refreshFilesList() {
    try {
        const files = await listFiles();
        filesListEl.innerHTML = '';
        if (files.length === 0) {
            filesListEl.innerHTML =
                '<div class="files-empty">Belum ada file. Import STL di atas, atau drag-drop ke viewport.</div>';
            return;
        }
        for (const f of files) {
            const el = document.createElement('div');
            el.className = 'files-item';
            el.innerHTML = `
        <div class="files-info">
          <div class="files-name">${escapeHtml(f.name)}</div>
          <div class="files-meta">${(f.size / 1024).toFixed(1)} KB · ${new Date(f.uploadedAt).toLocaleDateString()}</div>
        </div>
        <div class="files-actions">
          <button class="files-insert" title="Insert import ke editor">⌨</button>
          <button class="files-delete" title="Hapus">✕</button>
        </div>
      `;
            el.querySelector('.files-insert').addEventListener('click', () => {
                const insert = `\nimport("${f.name}");\n`;
                const sel = editorEl.selectionStart;
                editorEl.value = editorEl.value.slice(0, sel) + insert + editorEl.value.slice(sel);
                editorEl.dispatchEvent(new Event('input'));
                filesModal.classList.add('hidden');
                toast(`Inserted import("${f.name}")`);
            });
            el.querySelector('.files-delete').addEventListener('click', async () => {
                if (!confirm(`Hapus file '${f.name}'?`)) return;
                await deleteFile(f.name);
                await refreshFilesList();
                toast(`🗑 Deleted ${f.name}`);
                scheduleAutoRender();
            });
            filesListEl.appendChild(el);
        }
    } catch (err) {
        log('error', 'Gagal list files: ' + err.message);
    }
}

/* ============================================================
   Cheat Sheet
   ============================================================ */
const cheatSheet = createCheatSheet(document.getElementById('cheatModal'));

/* ============================================================
   Capture: PNG + GIF
   ============================================================ */
document.getElementById('btnPng').addEventListener('click', () => {
    try {
        const dataUrl = viewer.captureScreenshot(2);
        downloadDataUrl(dataUrl, `screenshot-${timestampForFile()}.png`);
        toast('📷 PNG saved');
    } catch (e) {
        log('error', 'Screenshot gagal: ' + e.message);
        toast('✖ Screenshot gagal');
    }
});

const gifModal = document.getElementById('gifModal');
const gifDelay = document.getElementById('gifDelay');
const gifDelayLbl = document.getElementById('gifDelayLabel');
const gifProgressWrap = document.getElementById('gifProgressWrap');
const gifProgressFill = document.getElementById('gifProgressFill');
const gifStatus = document.getElementById('gifStatus');
const gifStart = document.getElementById('gifStart');
const gifCancel = document.getElementById('gifCancel');

let gifController = null;

gifDelay.addEventListener('input', () => {
    gifDelayLbl.textContent = gifDelay.value + 'ms';
});

document.getElementById('btnGif').addEventListener('click', () => {
    gifModal.classList.remove('hidden');
    gifProgressWrap.classList.add('hidden');
    gifProgressFill.style.width = '0%';
    gifStatus.textContent = 'Preparing…';
    gifStart.disabled = false;
    gifCancel.disabled = true;
});

document.getElementById('gifClose').addEventListener('click', () => {
    if (gifController) gifController.abort();
    gifModal.classList.add('hidden');
});
gifModal.addEventListener('click', (e) => {
    if (e.target === gifModal) {
        if (gifController) gifController.abort();
        gifModal.classList.add('hidden');
    }
});

gifStart.addEventListener('click', async () => {
    if (!viewer.hasModel()) {
        toast('⚠ Render model dulu');
        return;
    }

    const qualityEl = document.querySelector('input[name="gifQuality"]:checked');
    const quality = qualityEl?.value || 'medium';
    const qualityMap = {
        small: { frames: 24, size: 320 },
        medium: { frames: 36, size: 480 },
        large: { frames: 60, size: 640 }
    };
    const { frames, size } = qualityMap[quality];
    const delay = parseInt(gifDelay.value, 10) || 50;

    gifStart.disabled = true;
    gifCancel.disabled = false;
    gifProgressWrap.classList.remove('hidden');
    gifProgressFill.style.width = '0%';
    gifStatus.textContent = `Rendering 0 / ${frames}…`;

    gifController = new AbortController();
    const controller = gifController;

    try {
        const gif = createGifEncoder();

        await viewer.iterateTurntable(
            { frames, size, signal: controller.signal },
            (imageData, i, total) => {
                gif.addFrame(imageData, { delay });
                const pct = ((i + 1) / total) * 90;
                gifProgressFill.style.width = pct + '%';
                gifStatus.textContent = `Rendering ${i + 1} / ${total}…`;
            }
        );

        gifStatus.textContent = 'Encoding GIF…';
        gifProgressFill.style.width = '95%';
        await new Promise(r => setTimeout(r, 20));

        const bytes = gif.finish();
        const blob = new Blob([bytes], { type: 'image/gif' });
        downloadBlob(blob, `turntable-${timestampForFile()}.gif`);

        gifProgressFill.style.width = '100%';
        gifStatus.textContent = `Done · ${(blob.size / 1024).toFixed(0)} KB`;
        log('ok', `GIF saved: ${(blob.size / 1024).toFixed(0)} KB, ${frames} frames`);
        toast('🎞 GIF saved');

        setTimeout(() => gifModal.classList.add('hidden'), 800);
    } catch (e) {
        if (e.message === 'Cancelled') {
            gifStatus.textContent = 'Cancelled';
            toast('Cancelled');
        } else {
            console.error('[gif]', e);
            gifStatus.textContent = 'Error: ' + e.message;
            log('error', 'GIF gagal: ' + e.message);
            toast('✖ GIF gagal');
        }
    } finally {
        gifController = null;
        gifStart.disabled = false;
        gifCancel.disabled = true;
    }
});

gifCancel.addEventListener('click', () => {
    if (gifController) {
        gifController.abort();
        gifStatus.textContent = 'Cancelling…';
    }
});

/* ============================================================
   Buttons
   ============================================================ */
const btnAuto = document.getElementById('btnAutoRender');
function updateAutoBtn() {
    btnAuto.classList.toggle('toggle-on', state.autoRender);
    btnAuto.textContent = state.autoRender ? '⚡ Auto' : '⚡ Auto off';
}

document.getElementById('btnRender').addEventListener('click', doRender);

document.getElementById('btnExport').addEventListener('click', () => {
    const r = exportSTL(viewer.modelRoot);
    if (r.ok) {
        log('ok', `Export STL berhasil: ${r.name} (${(r.size / 1024).toFixed(1)} KB)`);
        toast('⬇ STL diekspor');
    } else {
        log('warn', r.error);
        toast('⚠ ' + r.error);
    }
});

document.getElementById('btnClear').addEventListener('click', () => {
    editor.setValue('');
    tabManager.updateActiveSilent({ code: '', paramValues: {} });
    saveNow();
    clearConsole();
    viewer.clearModel();
    viewer.resetView();
    setStatus('ready', 'Ready');
    document.getElementById('viewInfo').textContent = '—';
    log('info', 'Editor dikosongkan.');
});

btnAuto.addEventListener('click', () => {
    state.autoRender = !state.autoRender;
    tabManager.updateActiveSilent({ autoRender: state.autoRender });
    updateAutoBtn();
    saveNow();
    toast(state.autoRender ? 'Auto-render ON' : 'Auto-render OFF');
});

document.getElementById('btnWireframe').addEventListener('click', e => {
    const on = viewer.toggleWireframe();
    e.currentTarget.classList.toggle('toggle-on', on);
});

document.getElementById('btnGrid').addEventListener('click', e => {
    const on = viewer.toggleGrid();
    e.currentTarget.classList.toggle('toggle-on', on);
});

document.getElementById('btnReset').addEventListener('click', () => viewer.fitToModel());

/* ============================================================
   Mobile view tabs (code/3d/console)
   ============================================================ */
const mainEl = document.getElementById('main');
document.querySelectorAll('#tabbar button[data-tab]').forEach(b => {
    b.addEventListener('click', () => {
        document.querySelectorAll('#tabbar button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        mainEl.dataset.tab = b.dataset.tab;
        if (b.dataset.tab === '3d') setTimeout(() => viewer.resize(), 30);
    });
});

/* ============================================================
   Shortcuts
   ============================================================ */
window.addEventListener('keydown', e => {
    const inField = e.target.matches('input, textarea, select, [contenteditable]');

    /* ? → toggle cheat sheet (hanya jika tidak di field) */
    if (e.key === '?' && !inField) {
        e.preventDefault();
        cheatSheet.toggle();
        return;
    }

    /* Esc → tutup cheat sheet / modal lain yang terbuka */
    if (e.key === 'Escape') {
        if (cheatSheet.isOpen()) { cheatSheet.close(); return; }
        // modal lain di-handle masing-masing; biarkan event bubble
    }

    /* Ctrl+Enter → render */
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        doRender();
    }
});

window.addEventListener('beforeunload', () => {
    workerClient?.dispose();
});

/* ============================================================
   Init
   ============================================================ */
initConsoleControls();

(async function init() {
    /* Cek URL share dulu */
    let shareData = null;
    try {
        shareData = await readShareFromUrl();
    } catch (e) {
        console.warn('[share] read error:', e);
    }

    if (shareData) {
        const existing = loadTabs();
        const sharedTab = createTab(shareData.name, shareData.code, shareData.paramValues);

        if (existing && existing.tabs.length > 0) {
            const tabs = [...existing.tabs, sharedTab];
            tabManager.load({ tabs, activeId: sharedTab.id });
            toast('📥 Shared project ditambahkan sebagai tab baru');
        } else {
            tabManager.load({ tabs: [sharedTab], activeId: sharedTab.id });
            toast('📥 Shared project loaded');
        }

        /* Clear hash agar refresh tidak duplicate */
        history.replaceState(null, '', location.pathname + location.search);
        saveNow();
    } else {
        tabManager.load(loadTabs());
    }

    log('info', 'Mini OpenSCAD siap. Ctrl+Enter = Render · Ctrl+S = Save.');
    if (!CSG) {
        log('warn', 'CSG tidak tersedia — difference()/intersection() pakai child pertama.');
    } else {
        log('info', 'CSG engine aktif.');
    }
})();