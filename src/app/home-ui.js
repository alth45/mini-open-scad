import { createHomeScreen } from "../ui/home.js";
import { importProjectZip } from "../project-backup.js";
import { createTab } from "../tabs.js";
import { log } from "../ui/console.js";
import { toast } from "../ui/status.js";

export function initHomeUI(deps) {
  const { tabManager, cheatSheet, addTab, saveNow, scheduleAutoRender } = deps;
  const HOME_SEEN_KEY = "mini-openscad-home-seen";

  const homeScreen = createHomeScreen(document.getElementById("homeScreen"), {
    onAction(action) {
      switch (action) {
        case "new":
          homeScreen.hide();
          addTab();
          break;
        case "import":
          homeScreen.hide();
          document.getElementById("filesInput").click();
          break;
        case "load-zip":
          homeScreen.hide();
          document.getElementById("projectZipInput").click();
          break;
        case "files":
          homeScreen.hide();
          document.getElementById("btnFiles").click();
          break;
        case "cheat":
          homeScreen.hide();
          cheatSheet.open();
          break;
        case "skip":
          homeScreen.hide();
          break;
      }
    },
    onFileInsert(name) {
      homeScreen.hide();
      const isScad = /\.scad$/i.test(name);

      // Bedakan berdasarkan ekstensi
      const insert = isScad ? `\nuse <${name}>;\n` : `\nimport("${name}");\n`;

      const el = document.getElementById("editor");
      const sel = el.selectionStart;
      el.value = el.value.slice(0, sel) + insert + el.value.slice(sel);
      el.dispatchEvent(new Event("input"));

      // Feedback
      toast(isScad ? `Inserted use <${name}>` : `Inserted import("${name}")`);
    },
    onFileDeleted() {
      scheduleAutoRender();
    },
  });
  document
    .getElementById("btnHome")
    .addEventListener("click", () => homeScreen.show());

  const projectZipInput = document.getElementById("projectZipInput");
  if (projectZipInput) {
    projectZipInput.addEventListener("change", async () => {
      if (!projectZipInput.files?.length) return;
      const file = projectZipInput.files[0];
      projectZipInput.value = "";
      try {
        toast("⏳ Memuat project…");
        const buffer = await file.arrayBuffer();
        const { meta, savedCount } = await importProjectZip(buffer);
        const tab = createTab(
          meta.name || "Imported Project",
          meta.code || "",
          meta.paramValues || {},
        );
        if (meta.autoRender !== undefined) tab.autoRender = meta.autoRender;
        tabManager.add(tab);
        saveNow();
        toast(`📦 Project loaded (${savedCount} file)`);
        scheduleAutoRender();
      } catch (e) {
        log("error", "Load project gagal: " + e.message);
        toast("✖ " + e.message);
      }
    });
  }
  return { homeScreen, HOME_SEEN_KEY };
}
