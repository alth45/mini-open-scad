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
import { CSG } from './evaluator/csg.js';
import { parseParams, mergeParamValues } from './core/params.js';
import { createParamsPanel } from './ui/params-panel.js';
import { createWorkerClient } from './worker/worker-client.js';
import { TabManager, createTab } from './tabs.js';
import { createTabBar } from './ui/tabbar.js';
import { encodeShareTab, buildShareUrl, readShareFromUrl } from './share.js';
import { createCheatSheet } from './ui/cheatsheet.js';
import { saveFile, loadFiles, listFiles, deleteFile } from './files/file-store.js';
import { extractImportNames } from './core/ast-utils.js';
import { createHomeScreen } from './ui/home.js';
import { createDropdown } from './ui/dropdown.js';
import { profiler } from './profiler.js';
import { createProfilerPanel } from './ui/profiler-panel.js';
import { createFindReplace } from './ui/find-replace.js';
import { formatScad } from './format.js';
import { initManifold } from './evaluator/manifold-engine.js';
import { importProjectZip } from './project-backup.js';
import { downloadBlob } from './utils.js';

// MODUL BARU HASIL PECAHAN
import { initShortcuts } from './app/shortcuts.js';
import { initViewerTools } from './app/viewer-tools.js';
import { initCapture } from './app/capture.js';
import { initExportUI } from './app/export-ui.js';

/* ============================================================
   Core Initialization
   ============================================================ */
const viewer = new Viewer(document.getElementById('viewport'));
viewer.setInfoElements(document.getElementById('fps'), document.getElementById('viewInfo'));

let workerClient = null;
try {
    workerClient = createWorkerClient();
    if (workerClient) log('info', 'Web Worker aktif — evaluasi di thread terpisah.');
} catch (e) { console.warn(e); log('warn', 'Worker gagal init — fallback sync.'); }

let tabManager = null;
const btnUndo = document.getElementById('btnUndo');
const btnRedo = document.getElementById('btnRedo');

const editor = createEditor({
    editorEl: document.getElementById('editor'),
    highlightEl: document.getElementById('highlight'),
    gutterEl: document.getElementById('gutter'),
    onChange: (code) => { tabManager?.updateActiveSilent({ code }); scheduleAutoRender(); scheduleSave(); },
    onSave: () => { saveNow(); toast('💾 Saved'); log('info', 'Disimpan ke localStorage.'); },
    onHistoryChange: ({ canUndo, canRedo }) => { btnUndo.disabled = !canUndo; btnRedo.disabled = !canRedo; }
});
btnUndo.addEventListener('click', () => { editor.undo(); editor.focus(); });
btnRedo.addEventListener('click', () => { editor.redo(); editor.focus(); });

const findReplace = createFindReplace({
    editorEl: document.getElementById('editor'), findMatchesEl: document.getElementById('findMatches'), containerEl: document.getElementById('codeArea')
});
editor.onValueChange(() => findReplace.refresh());

const paramsPanelEl = document.getElementById('paramsPanel');
const btnParams = document.getElementById('btnParams');
let paramRenderTimer = null;

const paramsPanel = createParamsPanel({
    panelEl: paramsPanelEl, bodyEl: document.getElementById('paramsBody'),
    titleEl: document.getElementById('paramsTitle'), resetBtn: document.getElementById('paramsReset'), closeBtn: document.getElementById('paramsClose'),
    onChange: (name, value, allValues) => {
        state.paramValues = { ...allValues };
        tabManager?.updateActiveSilent({ paramValues: state.paramValues });
        scheduleSave();
        clearTimeout(paramRenderTimer);
        paramRenderTimer = setTimeout(doRender, 200);
    }
});

const tabBar = createTabBar(document.getElementById('tabbar-desktop'));
tabManager = new TabManager({
    onListChange: (tabs, activeId) => {
        tabBar.render(tabs, activeId, { onSelect: switchTab, onClose: closeTab, onAdd: addTab, onRename: (id, name) => { tabManager.rename(id, name); saveNow(); } });
    },
    onActiveChange: (tab) => {
        if (!tab) return;
        editor.setValue(tab.code, { recordHistory: false });
        state.autoRender = tab.autoRender; state.paramValues = { ...tab.paramValues };
        updateAutoBtn(); refreshParams(); doRender();
    }
});

const cheatSheet = createCheatSheet(document.getElementById('cheatModal'));
const profilerPanel = createProfilerPanel(document.getElementById('profilerPanel'));

/* ============================================================
   Core Logic
   ============================================================ */
function refreshParams() {
    const params = parseParams(editor.getValue());
    state.paramValues = mergeParamValues(params, state.paramValues);
    tabManager?.updateActiveSilent({ paramValues: state.paramValues });
    paramsPanel.setParams(params, state.paramValues);
    btnParams.classList.toggle('has-params', params.length > 0);
}

function switchTab(id) { saveNow(); tabManager.setActive(id); }
function closeTab(id) { if (!tabManager.remove(id)) toast('Tidak bisa close tab terakhir'); else saveNow(); }
function addTab() {
    const used = new Set(tabManager.tabs.map(t => t.name)); let n = 1;
    while (used.has('Project ' + n)) n++;
    tabManager.add(createTab('Project ' + n, DEFAULT_CODE)); saveNow();
}

let saveTimer = null;
function saveNow() { if (tabManager) saveTabs(tabManager.tabs, tabManager.activeId, state.previewMode); }
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, CONFIG.saveDelay); }

let autoRenderTimer = null;
function scheduleAutoRender() {
    if (!state.autoRender) return;
    clearTimeout(autoRenderTimer);
    autoRenderTimer = setTimeout(doRender, CONFIG.autoRenderDelay);
}

async function doRender(opts = {}) {
    const { skipParams = false, skipFit = false, quiet = false, throwOnError = false } = opts;
    if (!skipParams) refreshParams();
    const code = editor.getValue();
    if (!quiet) setStatus('rendering', 'Rendering…', true);
    const tStart = performance.now();

    try {
        let result, workerRoundtrip = null;
        if (workerClient) {
            const data = await workerClient.run(code, state.paramValues, state.previewMode);
            workerRoundtrip = data.workerRoundtrip ?? null;
            const tDeser = performance.now();
            result = { root: deserializeModel(data.meshes), 
                ms: data.ms, breakdown: { ...(data.breakdown || {}), 
                deserialize: performance.now() - tDeser }, 
                opTimings: data.opTimings || {}, 
                meshCount: data.meshCount, 
                triCount: data.triCount, 
                vertexCount: data.vertexCount || 0, 
                warnings: data.warnings || [], 
                echoes: data.echoes || [], 
                shapes2d: data.shapes2d || [] 
            };
        } else {
            await new Promise(r => requestAnimationFrame(r));
            await initManifold();
            const importNames = extractImportNames(code);
            const files = importNames.length > 0 ? await loadFiles(importNames) : {};
            const scadCache = new Map();
            result = buildModel(code, state.paramValues, files, state.previewMode, scadCache);
        }

        viewer.setModelRoot(result.root);
        if (!skipFit) viewer.fitToObject(result.root);
        if (!quiet) setStatus('ready', 'Ready', false);
        state.lastSuccess = code;
        state.last2dShapes = result.shapes2d || []; // <-- Simpan shapes 2D

        
        if (!quiet) {
            profiler.record({ timestamp: Date.now(), totalMs: performance.now() - tStart, workerRoundtrip, breakdown: result.breakdown, opTimings: result.opTimings, meshCount: result.meshCount, triCount: result.triCount, vertexCount: result.vertexCount, error: null, preview: code.replace(/\s+/g, ' ').slice(0, 80) });
            log('ok', `Rendered in ${result.ms.toFixed(0)} ms · ${result.meshCount} mesh · ${Math.round(result.triCount)} triangle`);
            for (const w of result.warnings) log('warn', w);
            for (const e of result.echoes) log('info', e);
        }
    } catch (err) {
        if (err && err.name === 'CancelledError') { if (throwOnError) throw err; return; }
        if (!quiet) {
            setStatus('error', 'Error', false);
            log('error', formatError(err, code));
            toast('✖ ' + (err.message || 'Render gagal'));
        }
        if (throwOnError) throw err;
    }
}

function updateAutoBtn() {
    const btn = document.getElementById('btnAutoRender');
    btn.classList.toggle('toggle-on', state.autoRender);
    btn.textContent = state.autoRender ? '⚡ Auto' : '⚡ Auto off';
}

function setPreviewMode(value) {
    if (state.previewMode === value) return;
    state.previewMode = value;
    const btn = document.getElementById('btnPreview');
    btn.innerHTML = value ? '👁 <span class="lbl">Preview</span>' : '✦ <span class="lbl">Render</span>';
    btn.classList.toggle('toggle-on', !value);
    saveNow(); doRender();
}

function goToLine() {
    const el = document.getElementById('editor'); const lines = el.value.split('\n'); const total = lines.length;
    const input = prompt(`Go to line (1–${total}):`, ''); if (!input) return;
    const ln = Math.max(1, Math.min(total, parseInt(input, 10) || 1));
    let offset = 0; for (let i = 0; i < ln - 1; i++) offset += lines[i].length + 1;
    el.focus(); el.setSelectionRange(offset, offset + lines[ln - 1].length); el.dispatchEvent(new Event('scroll'));
}

function doFormat() {
    const current = editor.getValue();
    if (!current.trim()) { toast('⚠ Editor kosong'); return; }
    try {
        const formatted = formatScad(current);
        if (formatted === current) toast('✓ Sudah rapi');
        else { editor.setValue(formatted); tabManager?.updateActiveSilent({ code: formatted }); scheduleSave(); toast('✨ Code formatted'); }
        editor.focus();
    } catch (e) { log('error', 'Format gagal: ' + e.message); toast('✖ Format gagal'); }
}

/* ============================================================
   Share Logic
   ============================================================ */
const shareModal = document.getElementById('shareModal');
document.getElementById('btnShare').addEventListener('click', async () => {
    const tab = tabManager.active; if (!tab) return;
    try {
        const hash = await encodeShareTab(tab);
        const url = buildShareUrl(hash);
        const shareUrlEl = document.getElementById('shareUrl');
        shareUrlEl.value = url; shareUrlEl.dataset.url = url;
        document.getElementById('shareLen').textContent = url.length;
        document.getElementById('shareWarn').classList.toggle('hidden', url.length <= 8000);
        shareModal.classList.remove('hidden');
        shareUrlEl.focus(); shareUrlEl.select();
    } catch (e) { log('error', 'Gagal membuat share URL: ' + e.message); toast('✖ Share gagal'); }
});
document.getElementById('shareClose').addEventListener('click', () => shareModal.classList.add('hidden'));
document.getElementById('shareCopy').addEventListener('click', async () => {
    const el = document.getElementById('shareUrl');
    try { await navigator.clipboard.writeText(el.dataset.url || el.value); toast('📋 URL copied'); }
    catch { el.select(); document.execCommand('copy'); toast('📋 URL copied'); }
});
document.getElementById('shareOpen').addEventListener('click', () => {
    const el = document.getElementById('shareUrl');
    window.open(el.dataset.url || el.value, '_blank', 'noopener');
});

/* ============================================================
   Files / STL Import Logic
   ============================================================ */
const filesModal = document.getElementById('filesModal');
const filesInput = document.getElementById('filesInput');
const filesListEl = document.getElementById('filesList');
const dropOverlay = document.getElementById('dropOverlay');

document.getElementById('btnFiles').addEventListener('click', () => {
    filesModal.classList.remove('hidden');
    refreshFilesList();
});
document.getElementById('filesClose').addEventListener('click', () => filesModal.classList.add('hidden'));
document.getElementById('filesPick').addEventListener('click', () => filesInput.click());
filesInput.addEventListener('change', async () => {
    if (filesInput.files?.length) {
        await importFiles([...filesInput.files]);
        filesInput.value = '';
        await refreshFilesList();
    }
});

let dragCounter = 0;
viewer.container.addEventListener('dragenter', (e) => { if (!e.dataTransfer?.types?.includes('Files')) return; e.preventDefault(); dragCounter++; dropOverlay.classList.remove('hidden'); });
viewer.container.addEventListener('dragover', (e) => { if (!e.dataTransfer?.types?.includes('Files')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
viewer.container.addEventListener('dragleave', () => { if (--dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.add('hidden'); } });
viewer.container.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault(); dragCounter = 0; dropOverlay.classList.add('hidden');
    await importFiles([...e.dataTransfer.files]); await refreshFilesList();
});

async function importFiles(files) {
    const MAX_SIZE = 100 * 1024 * 1024; let saved = 0, skipped = 0;
    for (const f of files) {
        if (!/\.(stl|scad)$/i.test(f.name)) { skipped++; continue; }
        if (f.size > MAX_SIZE) { log('warn', `File '${f.name}' terlalu besar`); skipped++; continue; }
        try {
            const buffer = await f.arrayBuffer();
            const type = /\.scad$/i.test(f.name) ? 'text/x-scad' : 'model/stl';
            await saveFile(f.name, buffer, type); saved++;
            log('info', `File ${f.name} diimport`);
        } catch (err) { log('error', `Gagal import '${f.name}': ${err.message}`); }
    }
    if (saved > 0) { toast(`📁 ${saved} file imported`); scheduleAutoRender(); }
    if (skipped > 0) log('warn', `${skipped} file dilewati`);
}

async function refreshFilesList() {
    try {
        const files = await listFiles();
        filesListEl.innerHTML = '';
        if (files.length === 0) { filesListEl.innerHTML = '<div class="files-empty">Belum ada file.</div>'; return; }
        for (const f of files) {
            const isScad = /\.scad$/i.test(f.name);
            const el = document.createElement('div'); el.className = 'files-item';
            el.innerHTML = `<div class="files-info"><div class="files-name">${f.name}</div><div class="files-meta">${(f.size / 1024).toFixed(1)} KB</div></div>
            <div class="files-actions"><button class="files-insert">⌨</button><button class="files-delete">✕</button></div>`;
            el.querySelector('.files-insert').addEventListener('click', () => {
                const insert = isScad ? `\ninclude <${f.name}>;\n` : `\nimport("${f.name}");\n`;
                const sel = document.getElementById('editor').selectionStart;
                document.getElementById('editor').value = document.getElementById('editor').value.slice(0, sel) + insert + document.getElementById('editor').value.slice(sel);
                document.getElementById('editor').dispatchEvent(new Event('input'));
                filesModal.classList.add('hidden');
            });
            el.querySelector('.files-delete').addEventListener('click', async () => {
                if (!confirm(`Hapus file '${f.name}'?`)) return;
                await deleteFile(f.name); await refreshFilesList(); scheduleAutoRender();
            });
            filesListEl.appendChild(el);
        }
    } catch (err) { log('error', 'Gagal list files: ' + err.message); }
}

/* ============================================================
   Home Screen & ZIP Loader
   ============================================================ */
const HOME_SEEN_KEY = 'mini-openscad-home-seen';
const homeScreen = createHomeScreen(document.getElementById('homeScreen'), {
    onAction(action) {
        switch (action) {
            case 'new': homeScreen.hide(); addTab(); break;
            case 'import': homeScreen.hide(); document.getElementById('filesInput').click(); break;
            case 'load-zip': homeScreen.hide(); document.getElementById('projectZipInput').click(); break;
            case 'files': homeScreen.hide(); document.getElementById('btnFiles').click(); break;
            case 'cheat': homeScreen.hide(); cheatSheet.open(); break;
            case 'skip': homeScreen.hide(); break;
        }
    },
    onFileInsert(name) {
        homeScreen.hide();
        const insert = `\nimport("${name}");\n`;
        const sel = document.getElementById('editor').selectionStart;
        document.getElementById('editor').value = document.getElementById('editor').value.slice(0, sel) + insert + document.getElementById('editor').value.slice(sel);
        document.getElementById('editor').dispatchEvent(new Event('input'));
    },
    onFileDeleted() { scheduleAutoRender(); }
});
document.getElementById('btnHome').addEventListener('click', () => homeScreen.show());

const projectZipInput = document.getElementById('projectZipInput');
if (projectZipInput) {
    projectZipInput.addEventListener('change', async () => {
        if (!projectZipInput.files?.length) return;
        const file = projectZipInput.files[0]; projectZipInput.value = '';
        try {
            toast('⏳ Memuat project…');
            const buffer = await file.arrayBuffer();
            const { meta, savedCount } = await importProjectZip(buffer);
            const tab = createTab(meta.name || 'Imported Project', meta.code || '', meta.paramValues || {});
            if (meta.autoRender !== undefined) tab.autoRender = meta.autoRender;
            tabManager.add(tab); saveNow();
            toast(`📦 Project loaded (${savedCount} file)`);
            scheduleAutoRender();
        } catch (e) { log('error', 'Load project gagal: ' + e.message); toast('✖ ' + e.message); }
    });
}

/* ============================================================
   Wiring UI & Buttons
   ============================================================ */
document.getElementById('btnRender').addEventListener('click', doRender);
document.getElementById('btnPreview').addEventListener('click', () => setPreviewMode(!state.previewMode));
document.getElementById('btnParams').addEventListener('click', () => { paramsPanelEl.classList.toggle('hidden'); if (!paramsPanel.isHidden()) refreshParams(); });
document.getElementById('btnProfiler').addEventListener('click', () => profilerPanel.toggle());
document.getElementById('btnAutoRender').addEventListener('click', () => { state.autoRender = !state.autoRender; tabManager.updateActiveSilent({ autoRender: state.autoRender }); updateAutoBtn(); saveNow(); });
document.getElementById('btnCancelRender').addEventListener('click', () => { if (workerClient) workerClient.cancel(); setStatus('ready', 'Ready', false); });
document.getElementById('btnClear').addEventListener('click', () => { editor.setValue(''); tabManager.updateActiveSilent({ code: '', paramValues: {} }); saveNow(); clearConsole(); viewer.clearModel(); viewer.resetView(); setStatus('ready', 'Ready', false); });
document.getElementById('btnWireframe').addEventListener('click', e => { const on = viewer.toggleWireframe(); e.currentTarget.classList.toggle('toggle-on', on); });
document.getElementById('btnGrid').addEventListener('click', e => { const on = viewer.toggleGrid(); e.currentTarget.classList.toggle('toggle-on', on); });
document.getElementById('btnReset').addEventListener('click', () => viewer.fitToModel());

// Presets Dropdown
createDropdown({
    container: document.getElementById('presetDropdown'), placeholder: '— Presets —', icon: '<i class="fa-solid fa-book"></i>', resetAfterSelect: true,
    items: Object.entries(PRESETS).map(([name]) => ({ value: name, label: name })),
    onSelect: (name) => { editor.setValue(PRESETS[name]); tabManager.updateActiveSilent({ code: editor.getValue(), name }); saveNow(); doRender(); toast('Preset: ' + name); },
});

// Format Button
(function setupFormatButton() {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'btnFormat'; btn.innerHTML = '{ }'; btn.title = 'Format code (Shift+Alt+F)';
    btn.style.fontFamily = 'var(--mono)'; btn.style.fontSize = '11px'; btn.style.fontWeight = '700';
    btn.addEventListener('click', doFormat);
    const redo = document.getElementById('btnRedo');
    if (redo && redo.parentNode) redo.parentNode.insertBefore(btn, redo.nextSibling);
})();

// Inisialisasi Modul Hasil Pecahan
const shortcutsDeps = { editor, findReplace, cheatSheet, profilerPanel, workerClient, state, viewer, saveNow, doRender, setPreviewMode, toggleFullscreenViewport: () => window.toggleFullscreenViewport(), setMeasureMode: (m) => window.setMeasureMode(m), doFormat, goToLine };
const capture = initCapture({ viewer, editor, paramsPanel, state, doRender, parseParams });
shortcutsDeps.animation = capture.animation;
initShortcuts(shortcutsDeps);
initViewerTools(viewer);
initExportUI({ viewer, editor, tabManager });

/* ============================================================
   Init App
   ============================================================ */
initConsoleControls();

(async function init() {
    // Theme & Share URL
    document.documentElement.setAttribute('data-theme', loadTheme());
    let shareData = null;
    try { shareData = await readShareFromUrl(); } catch (e) { console.warn(e); }

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
        history.replaceState(null, '', location.pathname + location.search); saveNow();
    } else {
        tabManager.load(loadTabs());
    }

    const seenHome = localStorage.getItem(HOME_SEEN_KEY);
    if (!seenHome) {
        setTimeout(() => { homeScreen.show(); localStorage.setItem(HOME_SEEN_KEY, '1'); }, 100);
    }

    log('info', 'Mini OpenSCAD siap. Ctrl+Enter = Render · Ctrl+S = Save.');
    if (CSG) log('info', 'CSG engine aktif.');
})();