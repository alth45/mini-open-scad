import './styles.css';
import { CONFIG, DEFAULT_CODE, PRESETS } from './config.js';
import { state } from './state.js';
import { saveToStorage, loadFromStorage } from './storage.js';
import { formatError } from './utils.js';
import { buildModel, deserializeModel } from './viewer/model.js';
import { createWorkerClient } from './worker/worker-client.js';
import { Viewer } from './viewer/scene.js';
import { createEditor } from './ui/editor.js';
import { log, clear as clearConsole, initConsoleControls } from './ui/console.js';
import { setStatus, toast } from './ui/status.js';
import { exportSTL } from './export.js';
import { CSG } from './evaluator/csg.js';
import { parseParams, mergeParamValues, defaultValues } from './core/params.js';
import { createParamsPanel } from './ui/params-panel.js';

/* ---------- Setup Viewer ---------- */
const viewer = new Viewer(document.getElementById('viewport'));
viewer.setInfoElements(
    document.getElementById('fps'),
    document.getElementById('viewInfo')
);
let workerClient = null;
try {
    workerClient = createWorkerClient();
    if (workerClient) {
        log('info', 'Web Worker aktif — evaluasi di thread terpisah.');
    } else {
        log('warn', 'Web Worker tidak tersedia — fallback ke render sinkron (UI bisa freeze pada geometri berat).');
    }
} catch (e) {
    console.warn('[MiniOpenSCAD] Worker init gagal:', e);
    log('warn', 'Worker gagal diinisialisasi — fallback ke render sinkron.');
}
/* ---------- Setup Editor ---------- */
const btnUndo = document.getElementById('btnUndo');
const btnRedo = document.getElementById('btnRedo');

const editor = createEditor({
    editorEl: document.getElementById('editor'),
    highlightEl: document.getElementById('highlight'),
    gutterEl: document.getElementById('gutter'),
    onChange: () => {
        scheduleAutoRender();
        scheduleSave();
    },
    onSave: () => {
        saveToStorage(editor.getValue(), state.autoRender);
        toast('💾 Auto-saved to localStorage');
        log('info', 'Kode disimpan ke localStorage.');
    },
    onHistoryChange: ({ canUndo, canRedo }) => {
        btnUndo.disabled = !canUndo;
        btnRedo.disabled = !canRedo;
    }
});
/* ---------- Params panel ---------- */
const paramsPanelEl = document.getElementById('paramsPanel');
const btnParams = document.getElementById('btnParams');

const paramsPanel = createParamsPanel({
    panelEl: paramsPanelEl,
    bodyEl: document.getElementById('paramsBody'),
    titleEl: document.getElementById('paramsTitle'),
    resetBtn: document.getElementById('paramsReset'),
    closeBtn: document.getElementById('paramsClose'),
    onChange: (name, value, allValues) => {
        state.paramValues = { ...allValues };
        scheduleSave();
        clearTimeout(paramRenderTimer);
        paramRenderTimer = setTimeout(doRender, 200);
    }
});

btnParams.addEventListener('click', () => {
    paramsPanelEl.classList.toggle('hidden');
    if (!paramsPanel.isHidden()) {
        refreshParams();
    }
});

let paramRenderTimer = null;

/* ---------- Sinkronisasi @param <-> state ---------- */
function refreshParams() {
    const code = editor.getValue();
    const params = parseParams(code);
    state.paramValues = mergeParamValues(params, state.paramValues);
    paramsPanel.setParams(params, state.paramValues);

    btnParams.classList.toggle('has-params', params.length > 0);

    if (params.length > 0 && !state.paramsPanelShownOnce) {
        paramsPanel.show();
        state.paramsPanelShownOnce = true;
    }
}
/* ---------- Auto-render / auto-save timers ---------- */
let autoRenderTimer = null;
let saveTimer = null;

function scheduleAutoRender() {
    if (!state.autoRender) return;
    clearTimeout(autoRenderTimer);
    autoRenderTimer = setTimeout(doRender, CONFIG.autoRenderDelay);
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveToStorage(editor.getValue(), state.autoRender, state.paramValues);
    }, CONFIG.saveDelay);
}

/* ---------- Render pipeline ---------- */
async function doRender() {
    refreshParams();
    const code = editor.getValue();
    setStatus('rendering', 'Rendering…');

    try {
        let result;

        if (workerClient) {
            /* ---- jalur worker: UI tetap responsif ---- */
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
            /* ---- fallback sync ---- */
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
        if (err && err.name === 'CancelledError') {
            // render lama dibatalkan oleh render baru — jangan tampilkan error
            return;
        }
        setStatus('error', 'Error');
        log('error', formatError(err, code));
        toast('✖ ' + (err.message || 'Render gagal'));
    }
}

/* ---------- Presets ---------- */
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
    saveToStorage(editor.getValue(), state.autoRender);
    presetSel.value = '';
    doRender();
    toast('Preset: ' + name);
});

/* ---------- Buttons ---------- */
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
    saveToStorage('', state.autoRender);
    clearConsole();
    viewer.clearModel();
    viewer.resetView();
    setStatus('ready', 'Ready');
    document.getElementById('viewInfo').textContent = '—';
    log('info', 'Editor dikosongkan.');
});

btnAuto.addEventListener('click', () => {
    state.autoRender = !state.autoRender;
    updateAutoBtn();
    saveToStorage(editor.getValue(), state.autoRender);
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
btnUndo.addEventListener('click', () => { editor.undo(); editor.focus(); });
btnRedo.addEventListener('click', () => { editor.redo(); editor.focus(); });

document.getElementById('btnReset').addEventListener('click', () => viewer.fitToModel());

/* ---------- Mobile tabs ---------- */
const mainEl = document.getElementById('main');
document.querySelectorAll('#tabbar button').forEach(b => {
    b.addEventListener('click', () => {
        document.querySelectorAll('#tabbar button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        mainEl.dataset.tab = b.dataset.tab;
        if (b.dataset.tab === '3d') setTimeout(() => viewer.resize(), 30);
    });
});

/* ---------- Global shortcuts ---------- */
window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        doRender();
    }
});

/* ---------- Init ---------- */
initConsoleControls();
updateAutoBtn();

(function init() {
    const saved = loadFromStorage();
    if (saved) {
        state.autoRender = saved.autoRender;
        state.paramValues = saved.paramValues || {};
        editor.setValue(saved.code, { recordHistory: false });
    } else {
        editor.setValue(DEFAULT_CODE, { recordHistory: false });
    }
    updateAutoBtn();

    log('info', 'Mini OpenSCAD siap. Ctrl+Enter = Render · Ctrl+S = Save.');
    if (!CSG) {
        log('warn', 'three-bvh-csg tidak tersedia — difference()/intersection() akan memakai child pertama saja.');
    } else {
        log('info', 'CSG engine (three-bvh-csg) aktif.');
    }

    setTimeout(doRender, 120);
})();

window.addEventListener('beforeunload', () => {
    workerClient?.dispose();
});