let nextTabId = 1;
let nextProjectId = 1;

export function createTab(
  name = "Untitled",
  code = "",
  paramValues = {},
  autoRender = true,
  projectId = null,
) {
  return {
    id: "tab_" + Date.now().toString(36) + "_" + (nextTabId++).toString(36),
    name,
    code,
    paramValues,
    autoRender,
    projectId,
  };
}

export function createProject(name = "Untitled Project") {
  return {
    id:
      "proj_" + Date.now().toString(36) + "_" + (nextProjectId++).toString(36),
    name,
    tabIds: [],
    mainTabId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export class TabManager {
  constructor({ onListChange, onActiveChange, onProjectsChange } = {}) {
    this.projects = [];
    this.tabs = [];
    this.activeProjectId = null;
    this.activeId = null;
    this.onListChange = onListChange;
    this.onActiveChange = onActiveChange;
    this.onProjectsChange = onProjectsChange;
  }

  get active() {
    return this.tabs.find((t) => t.id === this.activeId) || null;
  }

  get activeProject() {
    return this.projects.find((p) => p.id === this.activeProjectId) || null;
  }

  get visibleTabs() {
    return this.tabs.filter((t) => t.projectId === this.activeProjectId);
  }

  load(data) {
    if (
      data &&
      Array.isArray(data.tabs) &&
      data.tabs.length > 0 &&
      Array.isArray(data.projects)
    ) {
      this.tabs = data.tabs;
      this.projects = data.projects;
      this.activeProjectId =
        data.activeProjectId &&
        this.projects.find((p) => p.id === data.activeProjectId)
          ? data.activeProjectId
          : this.projects[0].id;
      const ptabs = this.visibleTabs;
      this.activeId =
        data.activeId && ptabs.find((t) => t.id === data.activeId)
          ? data.activeId
          : ptabs[0]?.id || null;
    } else {
      const proj = createProject("Project 1");
      const tab = createTab("main.scad");
      tab.projectId = proj.id;
      proj.tabIds = [tab.id];
      proj.mainTabId = tab.id;
      this.projects = [proj];
      this.tabs = [tab];
      this.activeProjectId = proj.id;
      this.activeId = tab.id;
    }
    this._notifyProjects();
    this._notifyList();
    this._notifyActive();
  }

  /* ---------- Tab CRUD ---------- */
  add(tab, { switchTo = true } = {}) {
    if (!tab.projectId) tab.projectId = this.activeProjectId;
    this.tabs.push(tab);
    const proj = this.activeProject;
    if (proj && !proj.tabIds.includes(tab.id)) proj.tabIds.push(tab.id);
    this._notifyList();
    if (switchTo) this.setActive(tab.id);
  }

  remove(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return false;
    const projectTabs = this.tabs.filter((t) => t.projectId === tab.projectId);
    if (projectTabs.length <= 1) return false;
    const idx = this.tabs.findIndex((t) => t.id === id);
    this.tabs.splice(idx, 1);
    const proj = this.projects.find((p) => p.id === tab.projectId);
    if (proj) {
      proj.tabIds = proj.tabIds.filter((tid) => tid !== id);
      if (proj.mainTabId === id) proj.mainTabId = proj.tabIds[0] || null;
    }
    if (this.activeId === id) {
      const remaining = this.tabs.filter((t) => t.projectId === tab.projectId);
      this.activeId =
        remaining[Math.min(idx, remaining.length - 1)]?.id || null;
      this._notifyList();
      this._notifyActive();
    } else {
      this._notifyList();
    }
    return true;
  }

  rename(id, name) {
    const t = this.tabs.find((x) => x.id === id);
    if (!t) return;
    t.name = (name || "").trim() || "untitled.scad";
    this._notifyList();
  }

  setActive(id) {
    if (this.activeId === id) return;
    if (!this.tabs.find((t) => t.id === id)) return;
    this.activeId = id;
    this._notifyList();
    this._notifyActive();
  }

  updateActiveSilent(fields) {
    const t = this.active;
    if (!t) return;
    Object.assign(t, fields);
  }

  /* ---------- Project CRUD ---------- */
  createProject(name = "New Project") {
    const proj = createProject(name);
    const tab = createTab("main.scad");
    tab.projectId = proj.id;
    proj.tabIds = [tab.id];
    proj.mainTabId = tab.id;
    this.projects.push(proj);
    this.tabs.push(tab);
    this._notifyProjects();
    this._notifyList();
    return proj;
  }

  removeProject(id) {
    if (this.projects.length <= 1) return false;
    const idx = this.projects.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    this.tabs = this.tabs.filter((t) => t.projectId !== id);
    this.projects.splice(idx, 1);
    if (this.activeProjectId === id) {
      const nextProj = this.projects[Math.max(0, idx - 1)];
      this.activeProjectId = nextProj.id;
      const ptabs = this.tabs.filter((t) => t.projectId === nextProj.id);
      this.activeId = ptabs[0]?.id || null;
      this._notifyActive();
    }
    this._notifyProjects();
    this._notifyList();
    return true;
  }

  setActiveProject(id) {
    if (this.activeProjectId === id) return;
    const proj = this.projects.find((p) => p.id === id);
    if (!proj) return;
    this.activeProjectId = id;
    const ptabs = this.tabs.filter((t) => t.projectId === id);
    this.activeId = ptabs[0]?.id || null;
    this._notifyProjects();
    this._notifyList();
    this._notifyActive();
  }

  renameProject(id, name) {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return;
    p.name = (name || "").trim() || "Untitled Project";
    p.updatedAt = Date.now();
    this._notifyProjects();
  }

  setMainTab(id) {
    const proj = this.activeProject;
    if (!proj) return;
    proj.mainTabId = id;
    this._notifyProjects();
  }

  /* ---------- Serialization ---------- */
  toStorageData() {
    return {
      projects: this.projects,
      tabs: this.tabs,
      activeProjectId: this.activeProjectId,
      activeId: this.activeId,
    };
  }

  _notifyList() {
    this.onListChange?.(this.visibleTabs, this.activeId);
  }
  _notifyActive() {
    this.onActiveChange?.(this.active);
  }
  _notifyProjects() {
    this.onProjectsChange?.(this.projects, this.activeProjectId);
  }
}
