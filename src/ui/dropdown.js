import { escapeHtml } from "../utils.js";

export function createDropdown({
  container,
  placeholder = "Select…",
  icon = "",
  items = [],
  onSelect,
  resetAfterSelect = false,
}) {
  let isOpen = false;
  let activeIndex = -1;
  let currentValue = "";

  container.classList.add("dd-root");
  container.innerHTML = `
    <button type="button" class="dd-trigger" aria-haspopup="listbox" aria-expanded="false">
      ${icon ? `<span class="dd-icon" aria-hidden="true">${icon}</span>` : ""}
      <span class="dd-label lbl">${escapeHtml(placeholder)}</span>
      <span class="dd-chevron" aria-hidden="true">▾</span>
    </button>
  `;

  // ✨ PENTING: Append menu langsung ke body agar terbebas dari batasan layout parent
  const menu = document.createElement("div");
  menu.className = "dd-menu";
  menu.setAttribute("role", "listbox");
  menu.tabIndex = -1;
  menu.innerHTML = items
    .map(
      (it, i) => `
        <div class="dd-item" role="option" data-index="${i}">
          ${it.icon ? `<span class="dd-item-icon">${it.icon}</span>` : ""}
          <span class="dd-item-label">${escapeHtml(it.label)}</span>
          ${it.description ? `<span class="dd-item-desc">${escapeHtml(it.description)}</span>` : ""}
        </div>
      `,
    )
    .join("");
  document.body.appendChild(menu);

  const trigger = container.querySelector(".dd-trigger");
  const labelEl = container.querySelector(".dd-label");
  const itemEls = [...menu.querySelectorAll(".dd-item")];

  /* --- positioning --- */
  function positionMenu() {
    if (!isOpen) return;
    const rect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;

    let left = rect.left;
    let top = rect.bottom + 4;

    /* clamp horizontal */
    if (left + menuRect.width > vpW - 8) {
      left = vpW - menuRect.width - 8;
    }
    if (left < 8) left = 8;

    /* flip vertikal kalau tidak cukup ruang bawah */
    const spaceBelow = vpH - rect.bottom - 8;
    if (menuRect.height > spaceBelow && rect.top > menuRect.height + 8) {
      top = rect.top - menuRect.height - 4;
    }

    menu.style.left = left + "px";
    menu.style.top = top + "px";
    menu.style.minWidth = rect.width + "px";
  }

  /* --- open/close --- */
  function setOpen(next) {
    if (isOpen === next) return;
    isOpen = next;
    trigger.setAttribute("aria-expanded", String(next));
    menu.classList.toggle("open", next);

    if (next) {
      activeIndex = -1;
      updateActive();
      /* posisikan sebelum render agar tidak flash */
      positionMenu();
      requestAnimationFrame(positionMenu);
      window.addEventListener("scroll", positionMenu, true);
      window.addEventListener("resize", positionMenu);
    } else {
      window.removeEventListener("scroll", positionMenu, true);
      window.removeEventListener("resize", positionMenu);
    }
  }

  function updateActive() {
    itemEls.forEach((el, i) =>
      el.classList.toggle("active", i === activeIndex),
    );
    if (activeIndex >= 0 && itemEls[activeIndex]) {
      itemEls[activeIndex].scrollIntoView({ block: "nearest" });
    }
  }

  function select(index) {
    const it = items[index];
    if (!it) return;
    currentValue = it.value;
    if (!resetAfterSelect) {
      labelEl.textContent = it.label;
    }
    onSelect?.(it.value, it);
    setOpen(false);

    if (resetAfterSelect) {
      setTimeout(() => {
        labelEl.textContent = placeholder;
        currentValue = "";
      }, 180);
    }
  }

  /* --- events --- */
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!isOpen);
  });

  itemEls.forEach((el, i) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      select(i);
    });
    el.addEventListener("mouseenter", () => {
      activeIndex = i;
      updateActive();
    });
  });

  // Klik di luar (baik di luar trigger maupun di luar menu) → tutup
  document.addEventListener("click", (e) => {
    if (isOpen && !container.contains(e.target) && !menu.contains(e.target)) {
      setOpen(false);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!isOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      trigger.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = activeIndex < items.length - 1 ? activeIndex + 1 : 0;
      updateActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = activeIndex > 0 ? activeIndex - 1 : items.length - 1;
      updateActive();
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      select(activeIndex);
    }
  });

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    isOpen: () => isOpen,
    getValue: () => currentValue,
  };
}
