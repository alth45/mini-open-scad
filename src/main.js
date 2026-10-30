import './styles.css';
import { CONFIG, DEFAULT_CODE, PRESETS } from './config.js';
import { state } from './state.js';
import { saveTabs, loadTabs, saveTheme, loadTheme } from './storage.js';
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
import { createHomeScreen } from './ui/home.js';
import { createDropdown } from './ui/dropdown.js';
import { profiler } from './profiler.js';
import { createProfilerPanel } from './ui/profiler-panel.js';
import { createFindReplace } from './ui/find-replace.js';
import { formatScad } from './format.js';

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
   Find & Replace
   ============================================================ */
const findReplace = createFindReplace({
    editorEl: document.getElementById('editor'),
    findMatchesEl: document.getElementById('findMatches'),
    containerEl: document.getElementById('codeArea'),
});

editor.onValueChange(() => findReplace.refresh());

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
    saveTabs(tabManager.tabs, tabManager.activeId, state.previewMode);
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
async function doRender(opts={}) {
    const {
        skipParams = false,
        skipFit = false,
        quiet = false,
        throwOnError= false
    } = opts;

    if(!skipParams)refreshParams();
    const code = editor.getValue();
    if(!quiet) setStatus('rendering', 'Rendering…', true);

    const tStart = performance.now();

    try {
        let result;
        let workerRoundtrip = null;

        if (workerClient) {
            const data = await workerClient.run(code, state.paramValues, state.previewMode);
            workerRoundtrip = data.workerRoundtrip ?? null;

            const tDeser = performance.now();
            result = {
                root: deserializeModel(data.meshes),
                ms: data.ms,
                breakdown: { ...(data.breakdown || {}), deserialize: performance.now() - tDeser },
                opTimings: data.opTimings || {},
                meshCount: data.meshCount,
                triCount: data.triCount,
                vertexCount: data.vertexCount || 0,
                warnings: data.warnings || [],
                echoes: data.echoes || []
            };
        } else {
            await new Promise(r => requestAnimationFrame(r));
            const importNames = extractImportNames(code);
            const files = importNames.length > 0 ? await loadFiles(importNames) : {};

            /* build SCAD cache sync (main thread — tidak ada worker) */
            const scadCache = new Map();
            try {
                const tokens = (await import('./core/tokenizer.js')).tokenize(code);
                const Parser = (await import('./core/parser.js')).Parser;
                const userAst = new Parser(tokens).parseProgram();
                const visited = new Set();
                async function walk(ast) {
                    const { extractScadImports } = await import('./core/ast-utils.js');
                    for (const f of extractScadImports(ast)) {
                        if (visited.has(f) || scadCache.has(f)) continue;
                        visited.add(f);
                        const fs = await loadFiles([f]);
                        if (!fs[f]) { scadCache.set(f, { ast: null, error: 'not found' }); continue; }
                        const text = new TextDecoder().decode(fs[f]);
                        const tk = (await import('./core/tokenizer.js')).tokenize(text);
                        const innerAst = new Parser(tk).parseProgram();
                        scadCache.set(f, { ast: innerAst, error: null });
                        await walk(innerAst);
                    }
                }
                await walk(userAst);
            } catch { /* skip */ }

            result = buildModel(code, state.paramValues, files, state.previewMode, scadCache);
        }

        const totalMs = performance.now() - tStart;

        viewer.setModelRoot(result.root);
        if (!skipFit) viewer.fitToObject(result.root);
        if (!quiet) setStatus('ready', 'Ready', false);
        state.lastSuccess = code;
        if (!quiet && state.section.enabled) refreshSectionBounds();

        if (!quiet) {
            profiler.record({
                timestamp: Date.now(),
                totalMs,
                workerRoundtrip,
                breakdown: result.breakdown,
                opTimings: result.opTimings,
                meshCount: result.meshCount,
                triCount: result.triCount,
                vertexCount: result.vertexCount,
                error: null,
                preview: code.replace(/\s+/g, ' ').slice(0, 80)
            });

            log('ok',
                `Rendered in ${result.ms.toFixed(0)} ms · ${result.meshCount} mesh · ` +
                `${Math.round(result.triCount)} triangle` +
                (result.ms > 500 ? '  (lambat — pertimbangkan turunkan $fn)' : '')
            );
            for (const w of result.warnings) log('warn', w);
            for (const e of result.echoes) log('info', e);
        }
    } catch (err) {
        if (err && err.name === 'CancelledError') {
            if (throwOnError) throw err;
            return;
        }

        const totalMs = performance.now() - tStart;
        if (!quiet) {
            profiler.record({
                timestamp: Date.now(),
                totalMs,
                workerRoundtrip: null,
                breakdown: {}, opTimings: {},
                meshCount: 0, triCount: 0, vertexCount: 0,
                error: err.message || String(err),
                preview: code.replace(/\s+/g, ' ').slice(0, 80)
            });
            setStatus('error', 'Error', false);
            log('error', formatError(err, code));
            toast('✖ ' + (err.message || 'Render gagal'));
        }
        if (throwOnError) throw err;
    }
}

/* ============================================================
   Presets (custom dropdown)
   ============================================================ */
createDropdown({
    container: document.getElementById('presetDropdown'),
    placeholder: '— Presets —',
    icon: '<i class="fa-solid fa-book"></i>',
    resetAfterSelect: true,
    items: Object.entries(PRESETS).map(([name]) => ({
        value: name,
        label: name,
    })),
    onSelect: (name) => {
        editor.setValue(PRESETS[name]);
        tabManager.updateActiveSilent({ code: editor.getValue(), name });
        saveNow();
        doRender();
        toast('Preset: ' + name);
    },
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
        if (!/\.(stl|scad)$/i.test(f.name)) { skipped++; continue; }
        if (f.size > MAX_SIZE) {
            log('warn', `File '${f.name}' terlalu besar (${(f.size / 1024 / 1024).toFixed(1)}MB > 100MB)`);
            skipped++;
            continue;
        }
        try {
            const buffer = await f.arrayBuffer();
            const type = /\.scad$/i.test(f.name) ? 'text/x-scad' : 'model/stl';
            await saveFile(f.name, buffer, type);
            saved++;
            log('info', `<i class="fa-solid fa-file"></i> ${f.name} (${(f.size / 1024).toFixed(1)} KB) imported`);
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
                '<div class="files-empty">Belum ada file. Import <b>.stl</b> atau <b>.scad</b> di atas, atau drag-drop ke viewport.</div>';
            return;
        }
        for (const f of files) {
            const isScad = /\.scad$/i.test(f.name);
            const typeBadge = isScad
                ? '<span class="files-type-badge scad">SCAD</span>'
                : '<span class="files-type-badge stl">STL</span>';

            const el = document.createElement('div');
            el.className = 'files-item';
            el.innerHTML = `
        <div class="files-info">
          <div class="files-name">${typeBadge}${escapeHtml(f.name)}</div>
          <div class="files-meta">${(f.size / 1024).toFixed(1)} KB · ${new Date(f.uploadedAt).toLocaleDateString()}</div>
        </div>
        <div class="files-actions">
          <button class="files-insert" title="${isScad ? 'Insert include' : 'Insert import'}">⌨</button>
          <button class="files-delete" title="Hapus">✕</button>
        </div>
      `;
            el.querySelector('.files-insert').addEventListener('click', () => {
                const insert = isScad
                    ? `\ninclude <${f.name}>;\n`
                    : `\nimport("${f.name}");\n`;
                const sel = editorEl.selectionStart;
                editorEl.value = editorEl.value.slice(0, sel) + insert + editorEl.value.slice(sel);
                editorEl.dispatchEvent(new Event('input'));
                filesModal.classList.add('hidden');
                toast(isScad ? `Inserted include <${f.name}>` : `Inserted import("${f.name}")`);
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
   Home screen
   ============================================================ */
const HOME_SEEN_KEY = 'mini-openscad-home-seen';
const editorMain = document.getElementById('editor');

const homeScreen = createHomeScreen(
    document.getElementById('homeScreen'),
    {
        onAction(action) {
            switch (action) {
                case 'new':
                    homeScreen.hide();
                    addTab();
                    break;
                case 'import':
                    homeScreen.hide();
                    document.getElementById('filesInput').click();
                    break;
                case 'files':
                    homeScreen.hide();
                    document.getElementById('btnFiles').click();
                    break;
                case 'cheat':
                    homeScreen.hide();
                    cheatSheet.open();
                    break;
                case 'skip':
                    homeScreen.hide();
                    break;
            }
        },
        onFileInsert(name) {
            homeScreen.hide();
            const insert = `\nimport("${name}");\n`;
            const sel = editorMain.selectionStart;
            editorMain.value = editorMain.value.slice(0, sel) + insert + editorMain.value.slice(sel);
            editorMain.dispatchEvent(new Event('input'));
            toast(`Inserted import("${name}")`);
        },
        onFileDeleted(name) {
            toast(`🗑 Deleted ${name}`);
            scheduleAutoRender();
        }
    }
);

document.getElementById('btnHome').addEventListener('click', () => {
    homeScreen.show();
});

/* ============================================================
   Profiler
   ============================================================ */
const profilerPanel = createProfilerPanel(document.getElementById('profilerPanel'));

document.getElementById('btnProfiler').addEventListener('click', () => {
    profilerPanel.toggle();
});

// Esc menutup panel (jika tidak ada modal lain yang terbuka)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && profilerPanel.isVisible()) {
        // biarkan modal lain handle duluan
        if (document.querySelector('.modal-backdrop:not(.hidden)')) return;
        if (cheatSheet.isOpen()) return;
        profilerPanel.hide();
    }
});

/* ============================================================
   Preview / Render mode toggle
   ============================================================ */
const btnPreview = document.getElementById('btnPreview');

function updatePreviewBtn() {
    if (state.previewMode) {
        btnPreview.innerHTML = '👁 <span class="lbl">Preview</span>';
        btnPreview.classList.remove('toggle-on');
        btnPreview.title = 'Preview mode (fast). Klik untuk render final (F6).';
    } else {
        btnPreview.innerHTML = '✦ <span class="lbl">Render</span>';
        btnPreview.classList.add('toggle-on');
        btnPreview.title = 'Render mode (final quality). Klik untuk preview (F5).';
    }
}

function setPreviewMode(value) {
    if (state.previewMode === value) return;
    state.previewMode = value;
    updatePreviewBtn();
    saveNow();
    doRender();

    if (!value) {
        toast('✦ Render mode — kualitas final, lebih lambat');
    } else {
        toast('👁 Preview mode — cepat');
    }
}

btnPreview.addEventListener('click', () => {
    setPreviewMode(!state.previewMode);
});

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
   Param animation + GIF export
   ============================================================ */

const animation = {
    active: false,
    mode: null,          // 'preview' | 'gif'
    paramName: null,
    min: 0,
    max: 1,
    frames: 36,
    delay: 50,
    abort: false,
    originalValue: null,
    gif: null,
    offscreen: null,
};

/* ---- DOM refs (dibuat lazy di setup IIFE) ---- */
let animModal, animParamSelect, animDelay, animDelayLabel,
    animPlay, animExport, animCancel, animClose, animStop,
    animProgressWrap, animProgressFill, animStatus,
    animEmpty, animForm;

function openAnimModal() {
    if (animation.active) return;

    const params = parseParams(editor.getValue()).filter(p => p.type === 'slider');

    animParamSelect.innerHTML = '';
    if (params.length === 0) {
        animEmpty.classList.remove('hidden');
        animForm.classList.add('hidden');
        animExport.disabled = true;
        animPlay.disabled = true;
    } else {
        animEmpty.classList.add('hidden');
        animForm.classList.remove('hidden');
        animExport.disabled = false;
        animPlay.disabled = false;
        for (const p of params) {
            const o = document.createElement('option');
            o.value = p.name;
            o.textContent = `${p.label || p.name}  (${p.min}–${p.max})`;
            animParamSelect.appendChild(o);
        }
    }

    animProgressWrap.classList.add('hidden');
    animProgressFill.style.width = '0%';
    animStatus.textContent = '';
    animModal.classList.remove('hidden');
}

async function runAnimationFrameLoop(mode, onFrameProgress) {
    const params = parseParams(editor.getValue());
    const param = params.find(p => p.name === animation.paramName);
    if (!param || param.type !== 'slider') {
        throw new Error(`Parameter '${animation.paramName}' tidak ditemukan atau bukan slider`);
    }
    animation.min = param.min;
    animation.max = param.max;

    for (let i = 0; i < animation.frames; i++) {
        if (animation.abort) break;

        /* ping-pong via cosine — loop mulus tanpa lompatan */
        const t = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / animation.frames);
        const value = animation.min + (animation.max - animation.min) * t;

        state.paramValues[animation.paramName] = value;
        paramsPanel.setValue(animation.paramName, value);

        await doRender({
            skipParams: true,
            skipFit: true,
            quiet: true,
            throwOnError: true,
        });

        if (mode === 'gif') {
            const imageData = viewer.captureImageData(480, animation.offscreen);
            animation.gif.addFrame(imageData, { delay: animation.delay });
        }

        onFrameProgress?.(i + 1, animation.frames);

        if (mode === 'preview') {
            await new Promise(r => setTimeout(r, animation.delay));
        }
    }
}

async function startPreviewAnimation() {
    if (animation.active) return;
    const paramName = animParamSelect.value;
    if (!paramName) { toast('⚠ Pilih parameter dulu'); return; }
    if (!viewer.hasModel()) { toast('⚠ Render model dulu'); return; }

    const framesEl = document.querySelector('input[name="animFrames"]:checked');
    animation.frames = parseInt(framesEl?.value || '36', 10);
    animation.delay = parseInt(animDelay.value, 10);
    animation.active = true;
    animation.mode = 'preview';
    animation.abort = false;
    animation.paramName = paramName;
    animation.originalValue = state.paramValues[paramName];

    document.body.classList.add('is-animating');
    animModal.classList.add('hidden');
    animStop.classList.remove('hidden');

    try {
        await runAnimationFrameLoop('preview');
    } catch (e) {
        if (!animation.abort) {
            log('error', 'Animasi gagal: ' + e.message);
            toast('✖ ' + e.message);
        }
    } finally {
        if (animation.originalValue !== null && animation.originalValue !== undefined) {
            state.paramValues[paramName] = animation.originalValue;
            paramsPanel.setValue(paramName, animation.originalValue);
            try { await doRender({ quiet: true, throwOnError: false }); } catch {}
        }
        animation.active = false;
        animation.mode = null;
        animStop.classList.add('hidden');
        document.body.classList.remove('is-animating');
    }
}

async function startGifExport() {
    if (animation.active) return;
    const paramName = animParamSelect.value;
    if (!paramName) { toast('⚠ Pilih parameter dulu'); return; }
    if (!viewer.hasModel()) { toast('⚠ Render model dulu'); return; }

    const framesEl = document.querySelector('input[name="animFrames"]:checked');
    animation.frames = parseInt(framesEl?.value || '36', 10);
    animation.delay = parseInt(animDelay.value, 10);
    animation.active = true;
    animation.mode = 'gif';
    animation.abort = false;
    animation.paramName = paramName;
    animation.originalValue = state.paramValues[paramName];
    animation.gif = createGifEncoder();
    animation.offscreen = viewer._createOffscreen(480, 480);

    document.body.classList.add('is-animating');
    animExport.disabled = true;
    animPlay.disabled = true;
    animCancel.disabled = false;
    animProgressWrap.classList.remove('hidden');
    animProgressFill.style.width = '0%';
    animStatus.textContent = `Rendering 0 / ${animation.frames}…`;

    try {
        await runAnimationFrameLoop('gif', (i, total) => {
            animProgressFill.style.width = ((i / total) * 90) + '%';
            animStatus.textContent = `Rendering ${i} / ${total}…`;
        });

        if (animation.abort) {
            animStatus.textContent = 'Cancelled';
            toast('Cancelled');
            return;
        }

        animStatus.textContent = 'Encoding GIF…';
        animProgressFill.style.width = '95%';
        await new Promise(r => setTimeout(r, 20));

        const bytes = animation.gif.finish();
        const blob = new Blob([bytes], { type: 'image/gif' });
        downloadBlob(blob, `anim-${timestampForFile()}.gif`);

        animProgressFill.style.width = '100%';
        animStatus.textContent = `Done · ${(blob.size / 1024).toFixed(0)} KB`;
        log('ok', `Anim GIF saved: ${(blob.size / 1024).toFixed(0)} KB, ${animation.frames} frames`);
        toast('🎬 GIF saved');
    } catch (e) {
        console.error('[anim]', e);
        animStatus.textContent = 'Error: ' + e.message;
        log('error', 'GIF gagal: ' + e.message);
        toast('✖ GIF gagal');
    } finally {
        if (animation.originalValue !== null && animation.originalValue !== undefined) {
            state.paramValues[paramName] = animation.originalValue;
            paramsPanel.setValue(paramName, animation.originalValue);
            try { await doRender({ quiet: true, throwOnError: false }); } catch {}
        }
        if (animation.offscreen) {
            viewer._destroyOffscreen(animation.offscreen);
            animation.offscreen = null;
        }
        animation.active = false;
        animation.mode = null;
        animation.gif = null;
        document.body.classList.remove('is-animating');
        animExport.disabled = false;
        animPlay.disabled = false;
        animCancel.disabled = true;
    }
}

/* ---- setup UI (modal + stop button + toggle button) ---- */
(function setupAnimUI() {
    /* 1. Modal */
    animModal = document.createElement('div');
    animModal.id = 'animModal';
    animModal.className = 'modal-backdrop hidden';
    animModal.innerHTML = `
      <div class="modal" style="max-width:520px">
        <div class="modal-title">
          <span>🎬 Param Animation</span>
          <button class="modal-x" id="animClose">✕</button>
        </div>
        <div class="modal-body">
          <div id="animEmpty" class="anim-empty hidden">
            Tidak ada parameter slider.<br>
            Tambahkan di kode:<br>
            <code>// @param size {slider 10 60 30} Size</code>
          </div>
          <div id="animForm">
            <div class="anim-row">
              <label>Parameter</label>
              <select id="animParam"></select>
            </div>
            <div class="anim-row">
              <label>Frames</label>
              <div class="anim-radio-group">
                <label><input type="radio" name="animFrames" value="24"> 24</label>
                <label><input type="radio" name="animFrames" value="36" checked> 36</label>
                <label><input type="radio" name="animFrames" value="48"> 48</label>
                <label><input type="radio" name="animFrames" value="60"> 60</label>
              </div>
            </div>
            <div class="anim-row">
              <label>Delay</label>
              <div class="anim-slider-wrap">
                <input type="range" id="animDelay" min="20" max="200" step="10" value="50">
                <span id="animDelayLabel">50 ms</span>
              </div>
            </div>
            <div class="anim-row" style="padding-top:6px">
              <label></label>
              <button class="primary" id="animPlay" style="flex:1 1 auto">▶ Play preview</button>
            </div>
          </div>
          <div id="animProgressWrap" class="anim-progress-wrap hidden">
            <div class="anim-progress-bar"><div class="anim-progress-fill" id="animProgressFill"></div></div>
            <div class="anim-status" id="animStatus"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button id="animCancel" disabled>Cancel</button>
          <button class="primary" id="animExport">⬇ Export GIF</button>
        </div>
      </div>
    `;
    document.body.appendChild(animModal);

    animParamSelect     = animModal.querySelector('#animParam');
    animDelay           = animModal.querySelector('#animDelay');
    animDelayLabel      = animModal.querySelector('#animDelayLabel');
    animPlay            = animModal.querySelector('#animPlay');
    animExport          = animModal.querySelector('#animExport');
    animCancel          = animModal.querySelector('#animCancel');
    animClose           = animModal.querySelector('#animClose');
    animProgressWrap    = animModal.querySelector('#animProgressWrap');
    animProgressFill    = animModal.querySelector('#animProgressFill');
    animStatus          = animModal.querySelector('#animStatus');
    animEmpty           = animModal.querySelector('#animEmpty');
    animForm            = animModal.querySelector('#animForm');

    /* 2. Stop button (floating, dalam #right) */
    animStop = document.createElement('button');
    animStop.id = 'animStop';
    animStop.className = 'hidden';
    animStop.textContent = '■ Stop (Esc)';
    document.getElementById('right').appendChild(animStop);

    /* 3. Toggle button di viewportOverlay */
    const overlay = document.getElementById('viewportOverlay');
    if (overlay) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'btnAnim';
        btn.title = 'Param animation (live preview + GIF export)';
        btn.innerHTML = '🎬';
        btn.addEventListener('click', openAnimModal);
        overlay.appendChild(btn);
    }

    /* 4. Wiring */
    animClose.addEventListener('click', () => animModal.classList.add('hidden'));
    animModal.addEventListener('click', (e) => {
        if (e.target === animModal) animModal.classList.add('hidden');
    });
    animDelay.addEventListener('input', () => {
        animDelayLabel.textContent = animDelay.value + ' ms';
    });
    animPlay.addEventListener('click', startPreviewAnimation);
    animExport.addEventListener('click', startGifExport);
    animCancel.addEventListener('click', () => {
        animation.abort = true;
        animStatus.textContent = 'Cancelling…';
    });
    animStop.addEventListener('click', () => { animation.abort = true; });
})();

/* ============================================================
   Theme toggle (dark / light)
   ============================================================ */

function applyTheme(theme) {
    state.theme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);

    const btn = document.getElementById('btnTheme');
    if (btn) {
        const isLight = state.theme === 'light';
        btn.innerHTML = isLight ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
        btn.title = isLight ? 'Switch to dark theme' : 'Switch to light theme';
        btn.classList.toggle('toggle-on', isLight);
    }

    viewer.setTheme(state.theme);
    saveTheme(state.theme);
}

function toggleTheme() {
    applyTheme(state.theme === 'light' ? 'dark' : 'light');
}

(function setupThemeButton() {
    const topbarRight = document.getElementById('topbar-right');
    if (!topbarRight) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnTheme';
    btn.innerHTML = '🌙';
    btn.title = 'Switch to light theme';
    btn.addEventListener('click', toggleTheme);
    topbarRight.insertBefore(btn, topbarRight.firstChild);
})();

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
/* ============================================================
   Export .scad (source code)
   ============================================================ */

function formatScadValue(val) {
    if (typeof val === 'string') {
        return '"' + val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
    }
    if (typeof val === 'boolean') return String(val);
    if (typeof val === 'number' && Number.isFinite(val)) return String(val);
    if (val === null || val === undefined) return 'undef';
    return String(val);
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Bake nilai param aktif ke:
 *   1) top-level assignment:  name = ...;
 *   2) komentar @param default (slider/number/bool/color/string)
 * Tujuannya: file hasil export = kondisi visual saat ini persis.
 */
function bakeParamsIntoCode(code, paramValues) {
    if (!paramValues || Object.keys(paramValues).length === 0) return code;

    let out = code;

    for (const [name, val] of Object.entries(paramValues)) {
        if (name.startsWith('$')) continue;
        const esc = escapeRegex(name);
        const valStr = formatScadValue(val);

        /* 1) assignment */
        const assignRe = new RegExp(`^(\\s*${esc}\\s*=\\s*)[^;\\n]+;`, 'm');
        out = out.replace(assignRe, (_, pre) => `${pre}${valStr};`);

        /* 2) @param comment */
        const paramRe = new RegExp(
            `^(\\s*//\\s*@param\\s+${esc}\\s*\\{)\\s*([^}]+?)\\s*(\\}.*)$`,
            'm'
        );
        out = out.replace(paramRe, (match, pre, spec, post) => {
            const tokens = spec.trim().split(/\s+/);
            const type = tokens[0];
            const args = tokens.slice(1);

            switch (type) {
                case 'slider':
                    if (args.length < 3) return match;
                    args[2] = String(val);
                    break;
                case 'number':
                case 'bool':
                case 'color':
                    if (args.length < 1) return match;
                    args[0] = String(val);
                    break;
                case 'string':
                    // Parser @param split by whitespace — string dengan spasi tidak bisa di-bake
                    if (String(val).includes(' ')) return match;
                    if (args.length >= 1) args[0] = String(val);
                    else args.push(String(val));
                    break;
                case 'enum':
                    // Opsi enum fixed — tidak bisa di-bake
                    return match;
                default:
                    return match;
            }
            return pre + [type, ...args].join(' ') + post;
        });
    }

    return out;
}

function sanitizeFileName(name) {
    return (name || 'project')
        .replace(/\.[^.]+$/, '')          // strip extension
        .replace(/[^\w\-]+/g, '-')        // non-word → dash
        .replace(/^-+|-+$/g, '')          // trim dashes
        .slice(0, 80)
        || 'project';
}

function formatTimestamp(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
         + `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function exportScad() {
    const tab = tabManager.active;
    if (!tab) {
        toast('⚠ Tidak ada project aktif');
        return;
    }

    const rawCode = editor.getValue();
    if (!rawCode.trim()) {
        toast('⚠ Editor kosong — tidak ada yang diekspor');
        return;
    }

    const code = bakeParamsIntoCode(rawCode, state.paramValues);
    const tabName = tab.name || 'project';
    const fileName = sanitizeFileName(tabName) + '.scad';
    const timestamp = formatTimestamp(new Date());

    const header =
    `// ===============================================
    // Exported from Mini OpenSCAD
    // Project: ${tabName}
    // Date: ${timestamp}
    // ===============================================

    `;

    const blob = new Blob([header + code], { type: 'text/x-scad' });
    downloadBlob(blob, fileName);

    const sizeKb = (blob.size / 1024).toFixed(1);
    log('ok', `Export .scad: ${fileName} (${sizeKb} KB)`);
    toast(`📄 ${fileName} saved`);
}

    (function setupScadExportButton() {
        const btnExport = document.getElementById('btnExport');
        if (!btnExport || !btnExport.parentNode) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'btnExportScad';
        btn.title = 'Export source code as .scad file';
        btn.innerHTML = '<i class="fa-solid fa-file"></i> <span class="lbl">.scad</span>';
        btn.addEventListener('click', exportScad);
        btnExport.parentNode.insertBefore(btn, btnExport.nextSibling);
    })();

document.getElementById('btnClear').addEventListener('click', () => {
    editor.setValue('');
    tabManager.updateActiveSilent({ code: '', paramValues: {} });
    saveNow();
    clearConsole();
    viewer.clearModel();
    viewer.resetView();
    setStatus('ready', 'Ready', false);
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

btnCancelRender.addEventListener('click', () => {
    if (workerClient) workerClient.cancel();
    setStatus('ready', 'Ready', false);
    toast('Render dibatalkan');
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
   Fullscreen viewport
   ============================================================ */
function setFullscreenViewport(on) {
    const active = document.body.classList.contains('fullscreen-viewport');
    if (active === on) return;
    document.body.classList.toggle('fullscreen-viewport', on);
    document.getElementById('btnFullscreen')?.classList.toggle('toggle-on', on);
    setTimeout(() => viewer.resize(), 50);
}

function toggleFullscreenViewport() {
    setFullscreenViewport(!document.body.classList.contains('fullscreen-viewport'));
}

(function setupFullscreenButton() {
    const topbarRight = document.getElementById('topbar-right');
    const right = document.getElementById('right');
    if (!topbarRight || !right) return;

    /* Tombol masuk fullscreen di topbar */
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnFullscreen';
    btn.title = 'Fullscreen viewport (F / Esc untuk keluar)';
    btn.innerHTML = '⛶';
    btn.addEventListener('click', toggleFullscreenViewport);
    topbarRight.insertBefore(btn, topbarRight.firstChild);

    /* Tombol keluar floating (hanya tampil saat fullscreen) */
    const exitBtn = document.createElement('button');
    exitBtn.type = 'button';
    exitBtn.id = 'fullscreenExit';
    exitBtn.title = 'Exit fullscreen (Esc)';
    exitBtn.innerHTML = '✕';
    exitBtn.addEventListener('click', () => setFullscreenViewport(false));
    right.appendChild(exitBtn);
})();

/* ============================================================
   Camera view presets (bottom-center bar)
   ============================================================ */
(function setupViewPresets() {
    const container = viewer.container;
    if (!container) return;

    const bar = document.createElement('div');
    bar.id = 'viewPresetBar';

    const VIEWS = [
        { id: 'iso',    label: 'ISO', title: 'Isometric view' },
        { id: 'front',  label: 'FRT', title: 'Front view (dari -Y)' },
        { id: 'right',  label: 'RGT', title: 'Right view (dari +X)' },
        { id: 'top',    label: 'TOP', title: 'Top view (dari +Z)' },
        { id: 'back',   label: 'BCK', title: 'Back view (dari +Y)' },
        { id: 'left',   label: 'LFT', title: 'Left view (dari -X)' },
        { id: 'bottom', label: 'BTM', title: 'Bottom view (dari -Z)' },
    ];

    for (const v of VIEWS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = v.label;
        btn.title = v.title;
        btn.dataset.view = v.id;
        btn.addEventListener('click', () => {
            viewer.setView(v.id);
            // feedback singkat
            bar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setTimeout(() => btn.classList.remove('active'), 600);
        });
        bar.appendChild(btn);
    }
    /* Divider visual antara view primer dan sekunder */
    const sep = document.createElement('span');
    sep.className = 'view-preset-sep';
    bar.insertBefore(sep, bar.children[4]);   // antara TOP dan BCK

    container.appendChild(bar);
})();

/* ============================================================
   Dimension overlay toggle
   ============================================================ */
(function setupDimensionToggle() {
    const overlay = document.getElementById('viewportOverlay');
    if (!overlay) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnDimensions';
    btn.title = 'Toggle dimension overlay (bbox + X/Y/Z)';
    btn.innerHTML = '<i class="fa-solid fa-ruler"></i>';
    btn.addEventListener('click', () => {
        const on = viewer.toggleDimensions();
        btn.classList.toggle('toggle-on', on);
        if (on && !viewer.hasModel()) {
            toast('⚠ Render model dulu untuk melihat dimensi');
        }
    });
    overlay.appendChild(btn);
})();

/* ============================================================
   Section / clipping plane
   ============================================================ */
let sectionPanelEl = null;
let sectionSlider = null;
let sectionValueEl = null;
let sectionAxisBtns = null;
let sectionFlipBtn = null;

function syncSectionToViewer() {
    viewer.setSection(state.section);
}

function refreshSectionBounds() {
    if (!state.section.enabled || !sectionSlider) return;
    const bounds = viewer.getModelBounds();
    if (!bounds) return;

    const min = bounds.min[state.section.axis];
    const max = bounds.max[state.section.axis];
    const range = max - min;
    const margin = Math.max(range * 0.05, 0.01);

    sectionSlider.min = (min - margin).toFixed(3);
    sectionSlider.max = (max + margin).toFixed(3);
    sectionSlider.step = Math.max(range / 1000, 0.001);

    let pos = state.section.position;
    if (pos < min - margin || pos > max + margin) {
        pos = (min + max) / 2;
        state.section.position = pos;
        syncSectionToViewer();
    }
    sectionSlider.value = pos;
    sectionValueEl.textContent = Number(pos).toFixed(2);
}

function setSectionEnabled(on) {
    state.section.enabled = on;
    const btn = document.getElementById('btnSection');

    if (on) {
        const bounds = viewer.getModelBounds();
        if (bounds) {
            state.section.position =
                (bounds.min[state.section.axis] + bounds.max[state.section.axis]) / 2;
        } else {
            state.section.position = 0;
        }
        sectionPanelEl.classList.remove('hidden');
        btn?.classList.add('toggle-on');
        refreshSectionBounds();
    } else {
        sectionPanelEl.classList.add('hidden');
        btn?.classList.remove('toggle-on');
    }
    syncSectionToViewer();
}

function setSectionAxis(axis) {
    state.section.axis = axis;
    sectionAxisBtns.forEach(b => b.classList.toggle('active', b.dataset.axis === axis));
    const bounds = viewer.getModelBounds();
    if (bounds) {
        state.section.position = (bounds.min[axis] + bounds.max[axis]) / 2;
    }
    refreshSectionBounds();
    syncSectionToViewer();
}

(function setupSectionUI() {
    const overlay = document.getElementById('viewportOverlay');
    if (!overlay) return;

    /* Toggle button */
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnSection';
    btn.title = 'Section / clipping plane';
    btn.innerHTML = '<i class="fa-solid fa-scissors"></i>';
    btn.addEventListener('click', () => setSectionEnabled(!state.section.enabled));
    overlay.appendChild(btn);

    /* Panel */
    sectionPanelEl = document.createElement('div');
    sectionPanelEl.id = 'sectionPanel';
    sectionPanelEl.className = 'hidden';
    sectionPanelEl.innerHTML = `
      <div class="section-head">
        <span><i class="fa-solid fa-scissors"></i> Section</span>
        <button class="section-x" id="sectionClose" title="Close">✕</button>
      </div>
      <div class="section-body">
        <div class="section-row">
          <label>Axis</label>
          <div class="section-axes">
            <button data-axis="x" title="Cut along X">X</button>
            <button data-axis="y" title="Cut along Y">Y</button>
            <button data-axis="z" title="Cut along Z">Z</button>
          </div>
        </div>
        <div class="section-row">
          <label>Position</label>
          <input type="range" id="sectionSlider" min="-1" max="1" step="0.01" value="0">
          <span class="section-value" id="sectionValue">0.00</span>
        </div>
        <div class="section-row">
          <button id="sectionFlip" title="Flip side">⇅ Flip side</button>
        </div>
      </div>
    `;
    document.getElementById('right').appendChild(sectionPanelEl);

    sectionSlider = sectionPanelEl.querySelector('#sectionSlider');
    sectionValueEl = sectionPanelEl.querySelector('#sectionValue');
    sectionAxisBtns = [...sectionPanelEl.querySelectorAll('.section-axes button')];
    sectionFlipBtn = sectionPanelEl.querySelector('#sectionFlip');

    /* Default axis = z */
    sectionAxisBtns.forEach(b => b.classList.toggle('active', b.dataset.axis === 'z'));

    sectionSlider.addEventListener('input', () => {
        const pos = parseFloat(sectionSlider.value);
        state.section.position = pos;
        sectionValueEl.textContent = pos.toFixed(2);
        syncSectionToViewer();
    });

    sectionAxisBtns.forEach(b => {
        b.addEventListener('click', () => setSectionAxis(b.dataset.axis));
    });

    sectionFlipBtn.addEventListener('click', () => {
        state.section.flipped = !state.section.flipped;
        sectionFlipBtn.classList.toggle('toggle-on', state.section.flipped);
        syncSectionToViewer();
    });

    sectionPanelEl.querySelector('#sectionClose')
        .addEventListener('click', () => setSectionEnabled(false));
})();


/* ============================================================
   Measure tool (+ vertex/edge/face snapping)
   ============================================================ */
let measureInfoEl = null;
let measureBodyEl = null;
let measureMode = false;
const snapModes = { vertex: true, edge: true, face: true };

function setMeasureMode(on) {
    measureMode = !!on;
    viewer.setMeasureMode(measureMode);

    const btn = document.getElementById('btnMeasure');
    btn?.classList.toggle('toggle-on', measureMode);

    if (measureMode) {
        measureInfoEl.classList.remove('hidden');
        updateMeasureInfo({ reset: true });
        if (!viewer.hasModel()) {
            toast('⚠ Render model dulu, lalu klik 2 titik');
        } else {
            const sc = viewer._snapCache;
            if (sc && sc.disabled) {
                toast(`📐 Measure aktif (snap disabled: ${sc.triTotal.toLocaleString()} tri)`);
            } else {
                toast('📐 Measure: klik 2 titik — snap V/E/F aktif');
            }
        }
    } else {
        measureInfoEl.classList.add('hidden');
    }
}

function updateMeasureInfo(data) {
    if (!measureBodyEl) return;

    if (data.reset) {
        measureBodyEl.innerHTML = `
            <div class="measure-hint">
                Klik <b>2 titik</b> di permukaan model.<br>
                <span class="measure-snap-hint">Snap V/E/F aktif — hover untuk lihat preview.</span>
            </div>`;
        return;
    }

    if (!data.complete) {
        const p = data.points[0];
        measureBodyEl.innerHTML = `
            <div class="measure-hint">Titik 1 terpasang. Klik titik ke-2.</div>
            <div class="measure-coords">
                <div>P1 (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})</div>
            </div>`;
        return;
    }

    const { distance, dx, dy, dz, points: [a, b] } = data;
    measureBodyEl.innerHTML = `
        <div class="measure-result">
            <div class="measure-dist">
                <span>Distance</span>
                <strong>${distance.toFixed(2)}</strong>
            </div>
            <div class="measure-deltas">
                <div><span>ΔX</span><span>${dx.toFixed(2)}</span></div>
                <div><span>ΔY</span><span>${dy.toFixed(2)}</span></div>
                <div><span>ΔZ</span><span>${dz.toFixed(2)}</span></div>
            </div>
            <div class="measure-coords">
                <div>P1 (${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.z.toFixed(2)})</div>
                <div>P2 (${b.x.toFixed(2)}, ${b.y.toFixed(2)}, ${b.z.toFixed(2)})</div>
            </div>
            <div class="measure-hint" style="margin-top:6px">Klik lagi untuk ukur ulang.</div>
        </div>`;
}

(function setupMeasureUI() {
    const overlay = document.getElementById('viewportOverlay');
    if (!overlay) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnMeasure';
    btn.title = 'Measure tool (M) — klik 2 titik di model';
    btn.innerHTML = '📐';
    btn.addEventListener('click', () => setMeasureMode(!measureMode));
    overlay.appendChild(btn);

    measureInfoEl = document.createElement('div');
    measureInfoEl.id = 'measureInfo';
    measureInfoEl.className = 'hidden';
    measureInfoEl.innerHTML = `
        <div class="measure-snap-bar">
            <span class="measure-snap-label">Snap</span>
            <button type="button" data-snap="vertex" class="active" title="Snap ke vertex">V</button>
            <button type="button" data-snap="edge" class="active" title="Snap ke edge midpoint">E</button>
            <button type="button" data-snap="face" class="active" title="Snap ke face center">F</button>
        </div>
        <div id="measureBody"></div>
    `;
    document.getElementById('right').appendChild(measureInfoEl);

    measureBodyEl = measureInfoEl.querySelector('#measureBody');

    /* Snap toggle buttons */
    measureInfoEl.querySelectorAll('.measure-snap-bar button').forEach(b => {
        b.addEventListener('click', () => {
            const key = b.dataset.snap;
            snapModes[key] = !snapModes[key];
            b.classList.toggle('active', snapModes[key]);
            viewer.setSnapModes(snapModes);
        });
    });

    /* Init snap modes ke viewer */
    viewer.setSnapModes(snapModes);
    viewer.onMeasure = updateMeasureInfo;
})();

/* ============================================================
   Auto-format code
   ============================================================ */
function doFormat() {
    const current = editor.getValue();
    if (!current.trim()) {
        toast('⚠ Editor kosong');
        return;
    }

    try {
        const formatted = formatScad(current);
        if (formatted === current) {
            toast('✓ Sudah rapi');
        } else {
            editor.setValue(formatted);
            tabManager?.updateActiveSilent({ code: formatted });
            scheduleSave();
            toast('✨ Code formatted');
        }
        editor.focus();
    } catch (e) {
        log('error', 'Format gagal: ' + e.message);
        toast('✖ Format gagal');
    }
}

(function setupFormatButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnFormat';
    btn.innerHTML = '{ }';
    btn.title = 'Format code (Shift+Alt+F)';
    btn.style.fontFamily = 'var(--mono)';
    btn.style.fontSize = '11px';
    btn.style.fontWeight = '700';
    btn.addEventListener('click', doFormat);

    const redo = document.getElementById('btnRedo');
    if (redo && redo.parentNode) {
        redo.parentNode.insertBefore(btn, redo.nextSibling);
    } else {
        const left = document.getElementById('topbar-left');
        if (left) left.appendChild(btn);
    }
})();
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

function goToLine() {
    const el = document.getElementById('editor');
    const lines = el.value.split('\n');
    const total = lines.length;
    const input = prompt(`Go to line (1–${total}):`, '');
    if (!input) return;
    const ln = Math.max(1, Math.min(total, parseInt(input, 10) || 1));

    let offset = 0;
    for (let i = 0; i < ln - 1; i++) offset += lines[i].length + 1;

    el.focus();
    el.setSelectionRange(offset, offset + lines[ln - 1].length);
    el.dispatchEvent(new Event('scroll'));
}

/* ============================================================
   Global shortcuts — CAPTURE phase
   Block browser default: Ctrl+F/H/G, F5/F6, Ctrl+S
   ============================================================ */
window.addEventListener('keydown', (e) => {

    /* Esc → cancel render (jika sedang rendering) */
    if (e.key === 'Escape' && !btnCancelRender.classList.contains('hidden')) {
        e.preventDefault();
        e.stopPropagation();
        if (workerClient) workerClient.cancel();
        setStatus('ready', 'Ready', false);
        toast('Render dibatalkan');
        return;
    }

    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const inField = e.target.matches('input, textarea, select, [contenteditable]');


    /* --- Ctrl+F / Ctrl+H / Ctrl+G --- */
    if (mod && !e.altKey && !e.shiftKey) {
        const k = key.toLowerCase();

        if (k === 'f' || k === 'h' || k === 'g') {
            const target = e.target;
            const tag = target.tagName;
            const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
                || target.isContentEditable;
            const isEditor = target === document.getElementById('editor');
            const isFindInput = target.id === 'findInput' || target.id === 'replaceInput';

            /* Kalau di input lain (params panel, cheat search, dll) — biarkan browser */
            if (isInput && !isEditor && !isFindInput) return;

            e.preventDefault();
            e.stopPropagation();

            if (k === 'f') {
                if (isFindInput) { target.select(); }
                else { findReplace.openFind(); }
            } else if (k === 'h') {
                findReplace.openReplace();
            } else if (k === 'g') {
                goToLine();
            }
            return;
        }

        /* --- Ctrl+S → simpan (bukan save page) --- */
        if (k === 's') {
            e.preventDefault();
            e.stopPropagation();
            saveNow();
            toast('💾 Saved');
            log('info', 'Disimpan ke localStorage.');
            return;
        }
    }

    /* --- F5 / F6 --- */
    if (key === 'F5') {
        e.preventDefault();
        e.stopPropagation();
        if (!state.previewMode) setPreviewMode(true);
        return;
    }
    if (key === 'F6') {
        e.preventDefault();
        e.stopPropagation();
        if (state.previewMode) setPreviewMode(false);
        return;
    }

    /* F → toggle fullscreen viewport */
    if ((key === 'f' || key === 'F') && !inField) {
        e.preventDefault();
        e.stopPropagation();
        toggleFullscreenViewport();
        return;
    }

        /* M → toggle measure mode */
    if ((key === 'm' || key === 'M') && !inField) {
        e.preventDefault();
        e.stopPropagation();
        setMeasureMode(!measureMode);
        return;
    }

        /* Shift+Alt+F → format code (VS Code style) */
    if (e.shiftKey && e.altKey && (key === 'f' || key === 'F')) {
        e.preventDefault();
        e.stopPropagation();
        doFormat();
        return;
    }

    /* ? → toggle cheat sheet */
    if (e.key === '?' && !inField) {
        e.preventDefault();
        cheatSheet.toggle();
        return;
    }

    /* Esc → tutup modal/panel berlapis */
    if (e.key === 'Escape') {
        if (animation.active) {                          
            e.preventDefault();
            animation.abort = true;
            toast('Animation stopped');
            return;
        }
         if (measureMode) {                                  
            e.preventDefault();
            setMeasureMode(false);
            return;
        }
        if (findReplace.isOpen()) { findReplace.close(); return; }
        if (cheatSheet.isOpen()) { cheatSheet.close(); return; }
        if (profilerPanel.isVisible() && !document.querySelector('.modal-backdrop:not(.hidden)')) {
            profilerPanel.hide();
            return;
        }
        if (document.body.classList.contains('fullscreen-viewport')) {
            setFullscreenViewport(false);
            return;
        }
        return;
    }

    /* Ctrl+Enter → render */
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        doRender();
    }


}, true); // ← CAPTURE PHASE

window.addEventListener('beforeunload', () => {
    workerClient?.dispose();
});

/* ============================================================
   Init
   ============================================================ */
initConsoleControls();

/* ============================================================
   Toolbar: wheel → horizontal scroll
   ============================================================ */
(function setupToolbarScroll() {
    const topbarScroll = document.getElementById('topbar-scroll');
    if (!topbarScroll) return;

    topbarScroll.addEventListener('wheel', (e) => {
        /* hanya intercept kalau memang overflow */
        if (topbarScroll.scrollWidth <= topbarScroll.clientWidth) return;
        /* biarkan scroll horizontal asli (shift+wheel) lewat */
        if (e.deltaX !== 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        if (e.deltaY === 0) return;

        e.preventDefault();
        topbarScroll.scrollLeft += e.deltaY;
    }, { passive: false });
})();

(async function init() {
    applyTheme(loadTheme());
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
            if (typeof shareData.previewMode === 'boolean') {
                state.previewMode = shareData.previewMode;
            }
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


    /* Show home on first visit */
    const seenHome = localStorage.getItem(HOME_SEEN_KEY);
    if (!seenHome) {
        setTimeout(() => {
            homeScreen.show();
            localStorage.setItem(HOME_SEEN_KEY, '1');
        }, 100);
    }

    log('info', 'Mini OpenSCAD siap. Ctrl+Enter = Render · Ctrl+S = Save.');
    if (!CSG) {
        log('warn', 'CSG tidak tersedia — difference()/intersection() pakai child pertama.');
    } else {
        log('info', 'CSG engine aktif.');
    }
})();