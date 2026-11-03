import { saveFile, listFiles, deleteFile } from "../files/file-store.js";
import { log } from "../ui/console.js";
import { toast } from "../ui/status.js";

export function initFilesUI(deps) {
  const { editor, viewer, scheduleAutoRender } = deps;
  const filesModal = document.getElementById("filesModal");
  const filesInput = document.getElementById("filesInput");
  const filesListEl = document.getElementById("filesList");
  const dropOverlay = document.getElementById("dropOverlay");

  document.getElementById("btnFiles").addEventListener("click", () => {
    filesModal.classList.remove("hidden");
    refreshFilesList();
  });
  document
    .getElementById("filesClose")
    .addEventListener("click", () => filesModal.classList.add("hidden"));
  document
    .getElementById("filesPick")
    .addEventListener("click", () => filesInput.click());

  filesInput.addEventListener("change", async () => {
    if (filesInput.files?.length) {
      await importFiles([...filesInput.files]);
      filesInput.value = "";
      await refreshFilesList();
    }
  });

  let dragCounter = 0;
  viewer.container.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.remove("hidden");
  });
  viewer.container.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  viewer.container.addEventListener("dragleave", () => {
    if (--dragCounter <= 0) {
      dragCounter = 0;
      dropOverlay.classList.add("hidden");
    }
  });
  viewer.container.addEventListener("drop", async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.add("hidden");
    await importFiles([...e.dataTransfer.files]);
    await refreshFilesList();
  });

  async function importFiles(files) {
    const MAX_SIZE = 100 * 1024 * 1024;
    let saved = 0,
      skipped = 0;
    for (const f of files) {
      if (!/\.(stl|scad)$/i.test(f.name)) {
        skipped++;
        continue;
      }
      if (f.size > MAX_SIZE) {
        log("warn", `File '${f.name}' terlalu besar`);
        skipped++;
        continue;
      }
      try {
        const buffer = await f.arrayBuffer();
        const type = /\.scad$/i.test(f.name) ? "text/x-scad" : "model/stl";
        await saveFile(f.name, buffer, type);
        saved++;
        log("info", `File ${f.name} diimport`);
      } catch (err) {
        log("error", `Gagal import '${f.name}': ${err.message}`);
      }
    }
    if (saved > 0) {
      toast(`📁 ${saved} file imported`);
      scheduleAutoRender();
    }
    if (skipped > 0) log("warn", `${skipped} file dilewati`);
  }

  async function refreshFilesList() {
    try {
      const files = await listFiles();
      filesListEl.innerHTML = "";
      if (files.length === 0) {
        filesListEl.innerHTML =
          '<div class="files-empty">Belum ada file.</div>';
        return;
      }
      for (const f of files) {
        const isScad = /\.scad$/i.test(f.name);
        const el = document.createElement("div");
        el.className = "files-item";
        el.innerHTML = `<div class="files-info"><div class="files-name">${f.name}</div><div class="files-meta">${(f.size / 1024).toFixed(1)} KB</div></div>
                    <div class="files-actions"><button class="files-insert">⌨</button><button class="files-delete">✕</button></div>`;
        el.querySelector(".files-insert").addEventListener("click", () => {
          const insert = isScad
            ? `\ninclude <${f.name}>;\n`
            : `\nimport("${f.name}");\n`;
          const sel = document.getElementById("editor").selectionStart;
          const val = document.getElementById("editor").value;
          document.getElementById("editor").value =
            val.slice(0, sel) + insert + val.slice(sel);
          document.getElementById("editor").dispatchEvent(new Event("input"));
          filesModal.classList.add("hidden");
        });
        el.querySelector(".files-delete").addEventListener(
          "click",
          async () => {
            if (!confirm(`Hapus file '${f.name}'?`)) return;
            await deleteFile(f.name);
            await refreshFilesList();
            scheduleAutoRender();
          },
        );
        filesListEl.appendChild(el);
      }
    } catch (err) {
      log("error", "Gagal list files: " + err.message);
    }
  }
  return { refreshFilesList };
}
