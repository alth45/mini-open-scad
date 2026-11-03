import { store } from "../store/app-store.js";
import { createDropdown } from "../ui/dropdown.js";
import { PRESETS } from "../config.js";
import { toast, setStatus } from "../ui/status.js";
import { clear as clearConsole } from "../ui/console.js";

export function initToolbar(deps) {
  const {
    editor,
    viewer,
    tabManager,
    paramsPanel,
    paramsPanelEl,
    profilerPanel, // <-- KUNCI PERBAIKAN: Tambahkan ini
    refreshParams,
    doRender,
    saveNow,
    setPreviewMode,
    updateAutoBtn,
    workerClient,
    doFormat,
  } = deps;

  document.getElementById("btnRender").addEventListener("click", doRender);
  document
    .getElementById("btnPreview")
    .addEventListener("click", () =>
      setPreviewMode(!store.getState().previewMode),
    );
  document.getElementById("btnParams").addEventListener("click", () => {
    paramsPanelEl.classList.toggle("hidden");
    if (!paramsPanel.isHidden()) refreshParams();
  });

  // Perbaikan tombol profiler
  document
    .getElementById("btnProfiler")
    .addEventListener("click", () => profilerPanel.toggle());

  document.getElementById("btnAutoRender").addEventListener("click", () => {
    const current = store.getState().autoRender;
    store.dispatch({ type: "SET_AUTO_RENDER", payload: !current });
    tabManager.updateActiveSilent({ autoRender: !current });
    updateAutoBtn();
    saveNow();
  });
  document.getElementById("btnCancelRender").addEventListener("click", () => {
    if (workerClient) workerClient.cancel();
    setStatus("ready", "Ready", false);
  });
  document.getElementById("btnClear").addEventListener("click", () => {
    editor.setValue("");
    tabManager.updateActiveSilent({ code: "", paramValues: {} });
    saveNow();
    clearConsole();
    viewer.clearModel();
    viewer.resetView();
    setStatus("ready", "Ready", false);
  });
  document.getElementById("btnWireframe").addEventListener("click", (e) => {
    const on = viewer.toggleWireframe();
    e.currentTarget.classList.toggle("toggle-on", on);
  });
  document.getElementById("btnGrid").addEventListener("click", (e) => {
    const on = viewer.toggleGrid();
    e.currentTarget.classList.toggle("toggle-on", on);
  });
  document
    .getElementById("btnReset")
    .addEventListener("click", () => viewer.fitToModel());

  createDropdown({
    container: document.getElementById("presetDropdown"),
    placeholder: "— Presets —",
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
      toast("Preset: " + name);
    },
  });

  (function setupFormatButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "btnFormat";
    btn.innerHTML = "{ }";
    btn.title = "Format code (Shift+Alt+F)";
    btn.style.fontFamily = "var(--mono)";
    btn.style.fontSize = "11px";
    btn.style.fontWeight = "700";
    btn.addEventListener("click", doFormat);
    const redo = document.getElementById("btnRedo");
    if (redo && redo.parentNode)
      redo.parentNode.insertBefore(btn, redo.nextSibling);
  })();
}
