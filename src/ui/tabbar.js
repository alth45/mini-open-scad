export function createTabBar(containerEl) {
  let lastTabs = [];
  let lastActiveId = null;
  let lastCallbacks = null;
  let currentMobilePanel = null;

  function isMobile() {
    return window.innerWidth <= 768;
  }

  function render(tabs, activeId, callbacks) {
    lastTabs = tabs;
    lastActiveId = activeId;
    lastCallbacks = callbacks;

    if (isMobile()) {
      renderMobile(tabs, activeId, callbacks);
    } else {
      renderDesktop(tabs, activeId, callbacks);
      closePanel();
    }
  }

  /* ============================================================
       DESKTOP: Horizontal scrollable tabs (existing behavior)
       ============================================================ */
  function renderDesktop(tabs, activeId, callbacks) {
    containerEl.innerHTML = "";

    for (const tab of tabs) {
      const el = document.createElement("div");
      el.className = "tab" + (tab.id === activeId ? " active" : "");
      el.dataset.id = tab.id;

      const name = document.createElement("span");
      name.className = "tab-name";
      name.textContent = tab.name;
      name.title = "Double-click untuk rename";
      el.appendChild(name);

      const close = document.createElement("button");
      close.className = "tab-close";
      close.textContent = "×";
      close.title = "Close tab";
      close.disabled = tabs.length === 1;
      el.appendChild(close);

      el.addEventListener("click", (e) => {
        if (e.target === close) return;
        callbacks.onSelect?.(tab.id);
      });

      close.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!close.disabled) callbacks.onClose?.(tab.id);
      });

      el.addEventListener("auxclick", (e) => {
        if (e.button === 1 && tabs.length > 1) {
          e.preventDefault();
          callbacks.onClose?.(tab.id);
        }
      });

      name.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        startRename(el, name, tab, callbacks.onRename);
      });

      containerEl.appendChild(el);
    }

    const add = document.createElement("button");
    add.className = "tab-add";
    add.textContent = "+";
    add.title = "New tab";
    add.addEventListener("click", () => callbacks.onAdd?.());
    containerEl.appendChild(add);
  }

  /* ============================================================
       MOBILE: Compact switcher button
       ============================================================ */
  function renderMobile(tabs, activeId, callbacks) {
    const activeTab = tabs.find((t) => t.id === activeId);
    containerEl.innerHTML = "";

    // Switcher button
    const switcher = document.createElement("button");
    switcher.type = "button";
    switcher.className = "tab-mobile-switcher";
    switcher.innerHTML = `
            <i class="fa-solid fa-layer-group" style="opacity:.7;font-size:12px"></i>
            <span class="tab-mobile-label"></span>
            <span class="tab-mobile-count"></span>
            <i class="fa-solid fa-chevron-down" style="font-size:9px;opacity:.5"></i>
        `;
    switcher.querySelector(".tab-mobile-label").textContent =
      activeTab?.name || "Untitled";
    switcher.querySelector(".tab-mobile-count").textContent = tabs.length;

    switcher.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanel(tabs, activeId, callbacks);
    });

    containerEl.appendChild(switcher);

    // Add button
    const add = document.createElement("button");
    add.className = "tab-add";
    add.textContent = "+";
    add.title = "New tab";
    add.addEventListener("click", () => callbacks.onAdd?.());
    containerEl.appendChild(add);
  }

  /* ============================================================
       Mobile Panel (dropdown list of all tabs)
       ============================================================ */
  function togglePanel(tabs, activeId, callbacks) {
    if (currentMobilePanel) {
      closePanel();
      return;
    }

    const panel = document.createElement("div");
    panel.className = "tab-mobile-panel";

    // Title
    const title = document.createElement("div");
    title.className = "tab-mobile-panel-title";
    title.textContent = `Projects (${tabs.length})`;
    panel.appendChild(title);

    // List of tabs
    for (const tab of tabs) {
      const row = document.createElement("div");
      row.className =
        "tab-mobile-item" + (tab.id === activeId ? " active" : "");

      const name = document.createElement("span");
      name.className = "tab-mobile-name";
      name.textContent = tab.name;
      row.appendChild(name);

      // Rename button
      const rename = document.createElement("button");
      rename.className = "tab-mobile-rename";
      rename.innerHTML = '<i class="fa-solid fa-pen"></i>';
      rename.title = "Rename";
      rename.addEventListener("click", (e) => {
        e.stopPropagation();
        const newName = prompt("Rename tab:", tab.name);
        if (newName !== null && newName.trim()) {
          callbacks.onRename?.(tab.id, newName.trim());
          closePanel();
        }
      });
      row.appendChild(rename);

      // Close button (disabled if only 1 tab)
      if (tabs.length > 1) {
        const close = document.createElement("button");
        close.className = "tab-mobile-close";
        close.textContent = "×";
        close.title = "Close tab";
        close.addEventListener("click", (e) => {
          e.stopPropagation();
          callbacks.onClose?.(tab.id);
          closePanel();
        });
        row.appendChild(close);
      }

      row.addEventListener("click", () => {
        callbacks.onSelect?.(tab.id);
        closePanel();
      });

      panel.appendChild(row);
    }

    // Add new project
    const addRow = document.createElement("div");
    addRow.className = "tab-mobile-add-row";
    addRow.innerHTML =
      '<i class="fa-solid fa-plus"></i> <span>New Project</span>';
    addRow.addEventListener("click", () => {
      callbacks.onAdd?.();
      closePanel();
    });
    panel.appendChild(addRow);

    // Outside click handler
    const outsideHandler = (e) => {
      if (!panel.contains(e.target)) closePanel();
    };
    setTimeout(() => document.addEventListener("click", outsideHandler), 10);
    panel._outsideHandler = outsideHandler;

    // Esc handler
    const escHandler = (e) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", escHandler);
    panel._escHandler = escHandler;

    document.body.appendChild(panel);
    currentMobilePanel = panel;

    // Position under switcher
    const rect = containerEl.getBoundingClientRect();
    panel.style.top = rect.bottom + 4 + "px";
    panel.style.left = Math.max(8, rect.left) + "px";
    panel.style.right = Math.max(8, window.innerWidth - rect.right) + "px";
    panel.style.maxWidth = Math.min(360, window.innerWidth - 16) + "px";
  }

  function closePanel() {
    if (!currentMobilePanel) return;
    if (currentMobilePanel._outsideHandler) {
      document.removeEventListener("click", currentMobilePanel._outsideHandler);
    }
    if (currentMobilePanel._escHandler) {
      document.removeEventListener("keydown", currentMobilePanel._escHandler);
    }
    currentMobilePanel.remove();
    currentMobilePanel = null;
  }

  /* ============================================================
       Rename inline (desktop only)
       ============================================================ */
  function startRename(parentEl, nameEl, tab, onRename) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tab-rename-input";
    input.value = tab.name;
    input.addEventListener("click", (e) => e.stopPropagation());

    parentEl.replaceChild(input, nameEl);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) onRename?.(tab.id, input.value);
      else parentEl.replaceChild(nameEl, input);
    };

    input.addEventListener("blur", () => finish(true));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
  }

  /* ============================================================
       Resize: re-render when switching mobile ↔ desktop
       ============================================================ */
  let wasMobile = isMobile();
  let resizeRaf = null;
  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      const nowMobile = isMobile();
      if (nowMobile !== wasMobile) {
        wasMobile = nowMobile;
        closePanel();
        render(lastTabs, lastActiveId, lastCallbacks);
      }
    });
  });

  return { render };
}
