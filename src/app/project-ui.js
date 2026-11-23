import { escapeHtml } from "../utils.js";
import { log } from "../ui/console.js";
import { toast } from "../ui/status.js";

export function initProjectUI({ tabManager, saveNow, doRender }) {
  const topbarLeft = document.getElementById("topbar-left");
  if (!topbarLeft) return null;

  /* ---------- Tombol project di topbar ---------- */
  const btn = document.createElement("button");
  btn.id = "btnProject";
  btn.className = "project-btn";
  btn.title = "Switch / manage projects";
  btn.innerHTML = `🗂 <span class="pm-btn-label">Loading…</span> <span class="pm-chevron">▾</span>`;
  const brand = document.getElementById("brand");
  if (brand && brand.parentNode === topbarLeft) {
    topbarLeft.insertBefore(btn, brand.nextSibling);
  } else {
    topbarLeft.appendChild(btn);
  }

  /* ---------- Dropdown ---------- */
  const menu = document.createElement("div");
  menu.id = "projectMenu";
  menu.className = "project-menu hidden";
  menu.innerHTML = `
    <div class="pm-title">🗂 Projects</div>
    <div class="pm-list" id="pmList"></div>
    <div class="pm-footer">
      <button class="pm-new" id="pmNew">➕ New Project</button>
    </div>
  `;
  document.body.appendChild(menu);

  const listEl = menu.querySelector("#pmList");
  let isOpen = false;

  /* ---------- Render ---------- */
  function renderButton() {
    const proj = tabManager.activeProject;
    const label = proj ? proj.name : "No Project";
    const count = tabManager.visibleTabs.length;
    btn.querySelector(".pm-btn-label").textContent = label;
    btn.title = `${label} (${count} tab${count !== 1 ? "s" : ""})`;
  }

  function renderList() {
    const projects = tabManager.projects;
    const activeId = tabManager.activeProjectId;
    listEl.innerHTML = projects
      .map((p) => {
        const count = tabManager.tabs.filter(
          (t) => t.projectId === p.id,
        ).length;
        const isActive = p.id === activeId;
        return `
          <div class="pm-item ${isActive ? "active" : ""}" data-id="${p.id}">
            <span class="pm-item-icon">${isActive ? "▶" : "📁"}</span>
            <span class="pm-item-name">${escapeHtml(p.name)}</span>
            <span class="pm-item-count">${count}</span>
            <button class="pm-rename" data-id="${p.id}" title="Rename">✏</button>
            ${projects.length > 1 ? `<button class="pm-delete" data-id="${p.id}" title="Delete">✕</button>` : ""}
          </div>
        `;
      })
      .join("");

    listEl.querySelectorAll(".pm-item").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        const id = el.dataset.id;
        if (id !== tabManager.activeProjectId) {
          tabManager.setActiveProject(id);
          saveNow?.();
          doRender?.();
          toast(`🗂 ${tabManager.activeProject?.name || "Project"}`);
        }
        closeMenu();
      });
    });

    listEl.querySelectorAll(".pm-rename").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const p = tabManager.projects.find((x) => x.id === b.dataset.id);
        if (!p) return;
        const newName = prompt("Rename project:", p.name);
        if (newName === null) return;
        tabManager.renameProject(p.id, newName);
        renderButton();
        renderList();
        saveNow?.();
      });
    });

    listEl.querySelectorAll(".pm-delete").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const p = tabManager.projects.find((x) => x.id === b.dataset.id);
        if (!p) return;
        const count = tabManager.tabs.filter(
          (t) => t.projectId === p.id,
        ).length;
        if (
          !confirm(
            `Hapus project "${p.name}"?\n\n${count} tab akan ikut terhapus. Tidak bisa di-undo.`,
          )
        )
          return;
        if (tabManager.removeProject(p.id)) {
          saveNow?.();
          doRender?.();
          renderButton();
          renderList();
          toast(`🗑 Project "${p.name}" dihapus`);
        } else {
          toast("⚠ Tidak bisa hapus project terakhir");
        }
      });
    });
  }

  /* ---------- Open / close ---------- */
  function openMenu() {
    if (isOpen) return;
    isOpen = true;
    menu.classList.remove("hidden");
    btn.classList.add("toggle-on");
    renderList();
    positionMenu();
  }
  function closeMenu() {
    if (!isOpen) return;
    isOpen = false;
    menu.classList.add("hidden");
    btn.classList.remove("toggle-on");
  }
  function positionMenu() {
    const rect = btn.getBoundingClientRect();
    menu.style.left = rect.left + "px";
    menu.style.top = rect.bottom + 4 + "px";
    // Clamp
    const mw = menu.offsetWidth || 280;
    if (rect.left + mw > window.innerWidth - 8) {
      menu.style.left = window.innerWidth - mw - 8 + "px";
    }
  }

  /* ---------- Events ---------- */
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    isOpen ? closeMenu() : openMenu();
  });
  menu.querySelector("#pmNew").addEventListener("click", () => {
    const name = prompt("New project name:", "New Project");
    if (name === null) return;
    const proj = tabManager.createProject(name.trim() || "New Project");
    tabManager.setActiveProject(proj.id);
    saveNow?.();
    doRender?.();
    renderButton();
    renderList();
    closeMenu();
    toast(`✨ Project "${proj.name}" dibuat`);
  });
  document.addEventListener("click", (e) => {
    if (!isOpen) return;
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) closeMenu();
  });
  window.addEventListener("resize", () => {
    if (isOpen) positionMenu();
  });

  /* ---------- Public refresh ---------- */
  function refresh() {
    renderButton();
    if (isOpen) renderList();
  }
  refresh();

  return { refresh, open: openMenu, close: closeMenu };
}
