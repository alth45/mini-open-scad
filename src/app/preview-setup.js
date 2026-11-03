import { store } from "../store/app-store.js";

export function setupPreview(deps) {
  const { getRenderController } = deps;

  function updateAutoBtn() {
    const btn = document.getElementById("btnAutoRender");
    const auto = store.getState().autoRender;
    btn.classList.toggle("toggle-on", auto);
    btn.textContent = auto ? "⚡ Auto" : "⚡ Auto off";
  }

  function setPreviewMode(value) {
    if (store.getState().previewMode === value) return;
    store.dispatch({ type: "SET_PREVIEW_MODE", payload: value });
    const btn = document.getElementById("btnPreview");
    btn.innerHTML = value
      ? '👁 <span class="lbl">Preview</span>'
      : '✦ <span class="lbl">Render</span>';
    btn.classList.toggle("toggle-on", !value);
    getRenderController()?.saveNow();
    getRenderController()?.doRender();
  }

  return { updateAutoBtn, setPreviewMode };
}
