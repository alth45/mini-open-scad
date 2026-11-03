import { createTab } from "../tabs.js";
import { loadTabs } from "../storage.js";
import { readShareFromUrl } from "../share.js";
import { CSG } from "../evaluator/csg.js";
import { log } from "../ui/console.js";
import { toast } from "../ui/status.js";

export async function bootApp(deps) {
  const { tabManager, renderController, homeScreen, homeSeenKey } = deps;

  let shareData = null;
  try {
    shareData = await readShareFromUrl();
  } catch (e) {
    if (e.name === "ShareVersionError") toast("⚠ " + e.message);
    else console.warn(e);
  }

  if (shareData) {
    const existing = loadTabs();
    const sharedTab = createTab(
      shareData.name,
      shareData.code,
      shareData.paramValues,
    );
    if (existing && existing.tabs.length > 0) {
      tabManager.load({
        tabs: [...existing.tabs, sharedTab],
        activeId: sharedTab.id,
      });
      toast("📥 Shared project ditambahkan sebagai tab baru");
    } else {
      tabManager.load({ tabs: [sharedTab], activeId: sharedTab.id });
      toast("📥 Shared project loaded");
    }
    history.replaceState(null, "", location.pathname + location.search);
    renderController.saveNow();
  } else {
    tabManager.load(loadTabs());
  }

  const seenHome = localStorage.getItem(homeSeenKey);
  if (!seenHome) {
    setTimeout(() => {
      homeScreen.show();
      localStorage.setItem(homeSeenKey, "1");
    }, 100);
  }

  log("info", "Mini OpenSCAD siap. Ctrl+Enter = Render · Ctrl+S = Save.");
  if (CSG) log("info", "CSG engine aktif.");
}
