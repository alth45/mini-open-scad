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
            result = buildModel(code, state.paramValues);
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

(function init() {
    tabManager.load(loadTabs());

    log('info', 'Mini OpenSCAD siap. Ctrl+Enter = Render · Ctrl+S = Save.');
    if (!CSG) {
        log('warn', 'CSG tidak tersedia — difference()/intersection() pakai child pertama.');
    } else {
        log('info', 'CSG engine aktif.');
    }
})();