import { TabManager, createTab } from "../tabs.js";
import { createTabBar } from "../ui/tabbar.js";
import { store } from "../store/app-store.js";
import { DEFAULT_CODE } from "../config.js";
import { toast } from "../ui/status.js";

export function setupTabs(deps) {
  const {
    editor,
    getRenderController,
    updateAutoBtn,
    onTabActivated,
    onProjectsChange,
  } = deps;
  const tabBar = createTabBar(document.getElementById("tabbar-desktop"));
  let tabManager = null;

  function addTab() {
    const used = new Set(tabManager.visibleTabs.map((t) => t.name));
    let n = 2;
    while (used.has(`file${n}.scad`)) n++;
    tabManager.add(createTab(`file${n}.scad`, DEFAULT_CODE));
    getRenderController()?.saveNow();
  }

  tabManager = new TabManager({
    onListChange: (tabs, activeId) => {
      tabBar.render(tabs, activeId, {
        onSelect: (id) => {
          getRenderController()?.saveNow();
          tabManager.setActive(id);
        },
        onClose: (id) => {
          if (!tabManager.remove(id))
            toast("Tidak bisa close tab terakhir di project ini");
          else getRenderController()?.saveNow();
        },
        onAdd: addTab,
        onRename: (id, name) => {
          tabManager.rename(id, name);
          getRenderController()?.saveNow();
        },
      });
    },
    onActiveChange: (tab) => {
      if (!tab) return;
      editor.setValue(tab.code, { recordHistory: false });
      store.dispatch({ type: "SET_AUTO_RENDER", payload: tab.autoRender });
      store.dispatch({ type: "SET_PARAMS", payload: tab.paramValues || {} });
      updateAutoBtn();
      getRenderController()?.refreshParams();
      getRenderController()?.doRender();
      onTabActivated?.(tab);
    },
    onProjectsChange: (projects, activeProjectId) => {
      onProjectsChange?.(projects, activeProjectId);
    },
  });

  return { tabManager, addTab };
}
