import "./styles.css";
import { store } from "./store/app-store.js";
import { state } from "./state.js";
import { loadTheme } from "./storage.js";
import { Viewer } from "./viewer/scene.js";
import { log, initConsoleControls } from "./ui/console.js";
import { createParamsPanel } from "./ui/params-panel.js";
import { createWorkerClient } from "./worker/worker-client.js";
import { createCheatSheet } from "./ui/cheatsheet.js";
import { createProfilerPanel } from "./ui/profiler-panel.js";
import { parseParams } from "./core/params.js";

import { initRenderController } from "./app/render-controller.js";
import { initFilesUI } from "./app/files-ui.js";
import { initShareUI } from "./app/share-ui.js";
import { initHomeUI } from "./app/home-ui.js";
import { initToolbar } from "./app/toolbar.js";
import { initShortcuts } from "./app/shortcuts.js";
import { initViewerTools } from "./app/viewer-tools.js";
import { initCapture } from "./app/capture.js";
import { initExportUI } from "./app/export-ui.js";
import { setupEditor } from "./app/editor-setup.js";
import { setupPreview } from "./app/preview-setup.js";
import { setupTabs } from "./app/tabs-setup.js";
import { bootApp } from "./app/boot.js";
import { initMobileUI } from "./app/mobile-ui.js";
/* ============================================================
   Core Initialization
   ============================================================ */
const viewer = new Viewer(document.getElementById("viewport"));
viewer.setInfoElements(
  document.getElementById("fps"),
  document.getElementById("viewInfo"),
);

let workerClient = null;
try {
  workerClient = createWorkerClient();
  if (workerClient)
    log("info", "Web Worker aktif — evaluasi di thread terpisah.");
} catch (e) {
  console.warn(e);
  log("warn", "Worker gagal init — fallback sync.");
}

let tabManager = null;
let renderController = null;

/* ============================================================
   Setup Modules
   ============================================================ */
const { editor, findReplace } = setupEditor({
  getTabManager: () => tabManager,
  getRenderController: () => renderController,
});

const paramsPanelEl = document.getElementById("paramsPanel");
const btnParams = document.getElementById("btnParams");
const paramsPanel = createParamsPanel({
  panelEl: paramsPanelEl,
  bodyEl: document.getElementById("paramsBody"),
  titleEl: document.getElementById("paramsTitle"),
  resetBtn: document.getElementById("paramsReset"),
  closeBtn: document.getElementById("paramsClose"),
  onChange: (name, value, allValues) => {
    store.dispatch({ type: "SET_PARAMS", payload: allValues });
    tabManager?.updateActiveSilent({ paramValues: allValues });
    renderController?.scheduleSave();
    renderController?.scheduleAutoRender(200);
  },
});

const { setPreviewMode, updateAutoBtn } = setupPreview({
  getRenderController: () => renderController,
});

const cheatSheet = createCheatSheet(document.getElementById("cheatModal"));
const profilerPanel = createProfilerPanel(
  document.getElementById("profilerPanel"),
);
// Inject "Export Report" button ke header profiler (Fase 5)
(function setupProfilerExport() {
  const profHead = document.querySelector("#profilerPanel .prof-head");
  if (!profHead) return;
  const exportBtn = document.createElement("button");
  exportBtn.className = "prof-btn";
  exportBtn.id = "profExport";
  exportBtn.title = "Export render report (JSON)";
  exportBtn.innerHTML = "💾";
  exportBtn.addEventListener("click", () => {
    profiler.exportReport();
    toast("💾 Render report exported");
  });
  const clearBtn = profHead.querySelector("#profClear");
  if (clearBtn) profHead.insertBefore(exportBtn, clearBtn);
})();
renderController = initRenderController({
  editor,
  viewer,
  workerClient,
  tabManager,
  paramsPanel,
  btnParams,
});

const { tabManager: tm, addTab } = setupTabs({
  editor,
  getRenderController: () => renderController,
  updateAutoBtn,
});
tabManager = tm;

/* ============================================================
   Wiring UI Modules
   ============================================================ */
initFilesUI({
  editor,
  viewer,
  scheduleAutoRender: renderController.scheduleAutoRender,
});
initShareUI({ tabManager });
const { homeScreen, HOME_SEEN_KEY } = initHomeUI({
  tabManager,
  editor,
  cheatSheet,
  addTab,
  saveNow: renderController.saveNow,
  scheduleAutoRender: renderController.scheduleAutoRender,
});
initToolbar({
  editor,
  viewer,
  tabManager,
  paramsPanel,
  paramsPanelEl,
  profilerPanel,
  refreshParams: renderController.refreshParams,
  doRender: renderController.doRender,
  saveNow: renderController.saveNow,
  setPreviewMode,
  updateAutoBtn,
  workerClient,
  doFormat: renderController.doFormat,
});

const capture = initCapture({
  viewer,
  editor,
  paramsPanel,
  state,
  doRender: renderController.doRender,
  parseParams,
});
initShortcuts({
  editor,
  findReplace,
  cheatSheet,
  profilerPanel,
  workerClient,
  state,
  viewer,
  saveNow: renderController.saveNow,
  doRender: renderController.doRender,
  setPreviewMode,
  toggleFullscreenViewport: () => viewer.toggleFullscreenViewport(),
  setMeasureMode: (m) => viewer.setMeasureMode(m),
  doFormat: renderController.doFormat,
  goToLine: renderController.goToLine,
  animation: capture.animation,
});
initViewerTools(viewer);
initExportUI({ viewer, editor, tabManager });
initMobileUI({ viewer }); 

/* ============================================================
   Init App
   ============================================================ */
initConsoleControls();
bootApp({
  tabManager,
  renderController,
  homeScreen,
  homeSeenKey: HOME_SEEN_KEY,
});
