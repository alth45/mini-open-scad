import { createEditor } from "../ui/editor.js";
import { createFindReplace } from "../ui/find-replace.js";
import { initErrorBoundary } from "./error-boundary.js";
import { log } from "../ui/console.js";
import { toast, setStatus } from "../ui/status.js";
import { formatError } from "../utils.js";

export function setupEditor(deps) {
  const { getTabManager, getRenderController } = deps;

  const btnUndo = document.getElementById("btnUndo");
  const btnRedo = document.getElementById("btnRedo");

  const editor = createEditor({
    editorEl: document.getElementById("editor"),
    highlightEl: document.getElementById("highlight"),
    gutterEl: document.getElementById("gutter"),
    onChange: (code) => {
      getTabManager()?.updateActiveSilent({ code });
      getRenderController()?.scheduleAutoRender();
      getRenderController()?.scheduleSave();
    },
    onSave: () => {
      getRenderController()?.saveNow();
      toast("💾 Saved");
      log("info", "Disimpan ke localStorage.");
    },
    onHistoryChange: ({ canUndo, canRedo }) => {
      btnUndo.disabled = !canUndo;
      btnRedo.disabled = !canRedo;
    },
  });

  btnUndo.addEventListener("click", () => {
    editor.undo();
    editor.focus();
  });
  btnRedo.addEventListener("click", () => {
    editor.redo();
    editor.focus();
  });

  initErrorBoundary({
    log,
    toast,
    setStatus,
    formatError,
    getEditorCode: () => editor.getValue(),
  });

  const findReplace = createFindReplace({
    editorEl: document.getElementById("editor"),
    findMatchesEl: document.getElementById("findMatches"),
    containerEl: document.getElementById("codeArea"),
  });
  editor.onValueChange(() => findReplace.refresh());

  return { editor, findReplace };
}
