import { SNIPPETS } from "../ui/snippets-data.js";
import { formatScad } from "../format.js";
import { escapeHtml } from "../utils.js";
import { log } from "../ui/console.js";
import { toast } from "../ui/status.js";

export function initSnippetUI(deps) {
  const { editor, tabManager, saveNow, doRender } = deps;

  /* ---------- Build button in topbar ---------- */
  const topbarScroll = document.getElementById("topbar-scroll");
  if (!topbarScroll) return null;

  const btn = document.createElement("button");
  btn.id = "btnSnippets";
  btn.title = "Snippet Library — template siap pakai";
  btn.innerHTML = '📚 <span class="lbl">Snippets</span>';
  btn.addEventListener("click", open);

  // Sisipkan setelah presetDropdown (masih satu grup: insert tool)
  const presetDD = document.getElementById("presetDropdown");
  if (presetDD && presetDD.parentNode === topbarScroll) {
    topbarScroll.insertBefore(btn, presetDD.nextSibling);
  } else {
    topbarScroll.appendChild(btn);
  }

  /* ---------- Build modal ---------- */
  const modal = document.createElement("div");
  modal.id = "snippetModal";
  modal.className = "modal-backdrop hidden";
  modal.innerHTML = `
    <div class="modal snippet-modal">
      <div class="snippet-head">
        <span class="snippet-title">📚 Snippet Library</span>
        <input id="snippetSearch" class="snippet-search" type="search"
               placeholder="Cari snippet…" autocomplete="off" />
        <button id="snippetClose" class="modal-x">✕</button>
      </div>
      <div id="snippetCats" class="snippet-cats"></div>
      <div id="snippetGrid" class="snippet-grid"></div>
      <div id="snippetPreview" class="snippet-preview hidden">
        <div class="snippet-preview-head">
          <span id="snippetPreviewTitle"></span>
          <div class="spacer"></div>
          <button id="snippetCopy" class="snippet-btn">Copy</button>
          <button id="snippetUse" class="snippet-btn primary">Use this snippet</button>
        </div>
        <pre id="snippetPreviewCode" class="snippet-preview-code"></pre>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  /* ---------- Refs ---------- */
  const searchEl = modal.querySelector("#snippetSearch");
  const catsEl = modal.querySelector("#snippetCats");
  const gridEl = modal.querySelector("#snippetGrid");
  const previewEl = modal.querySelector("#snippetPreview");
  const previewTitleEl = modal.querySelector("#snippetPreviewTitle");
  const previewCodeEl = modal.querySelector("#snippetPreviewCode");

  /* ---------- State ---------- */
  let currentCategory = "All";
  let currentSearch = "";
  let selectedSnippet = null;

  /* ---------- Build category chips ---------- */
  const categories = ["All", ...new Set(SNIPPETS.map((s) => s.category))];
  for (const cat of categories) {
    const b = document.createElement("button");
    b.className = "snippet-cat" + (cat === "All" ? " active" : "");
    b.textContent = cat;
    b.dataset.cat = cat;
    b.addEventListener("click", () => {
      currentCategory = cat;
      catsEl
        .querySelectorAll(".snippet-cat")
        .forEach((x) => x.classList.toggle("active", x === b));
      renderGrid();
    });
    catsEl.appendChild(b);
  }

  /* ---------- Render grid ---------- */
  function renderGrid() {
    const q = currentSearch.toLowerCase();
    const filtered = SNIPPETS.filter((s) => {
      if (currentCategory !== "All" && s.category !== currentCategory)
        return false;
      if (!q) return true;
      return (s.name + " " + s.description + " " + s.category)
        .toLowerCase()
        .includes(q);
    });

    if (filtered.length === 0) {
      gridEl.innerHTML = `<div class="snippet-empty">Tidak ada snippet yang cocok.</div>`;
      return;
    }

    gridEl.innerHTML = filtered
      .map(
        (s) => `
      <button class="snippet-card ${selectedSnippet?.id === s.id ? "active" : ""}"
              data-id="${s.id}" title="${escapeHtml(s.description)}">
        <div class="snippet-card-icon">${s.icon}</div>
        <div class="snippet-card-body">
          <div class="snippet-card-name">${escapeHtml(s.name)}</div>
          <div class="snippet-card-cat">${escapeHtml(s.category)}</div>
          <div class="snippet-card-desc">${escapeHtml(s.description)}</div>
        </div>
      </button>
    `,
      )
      .join("");

    gridEl.querySelectorAll(".snippet-card").forEach((card) => {
      card.addEventListener("click", () => selectSnippet(card.dataset.id));
    });
  }

  /* ---------- Select snippet → show preview ---------- */
  function selectSnippet(id) {
    selectedSnippet = SNIPPETS.find((s) => s.id === id) || null;
    if (!selectedSnippet) {
      previewEl.classList.add("hidden");
      return;
    }

    gridEl
      .querySelectorAll(".snippet-card")
      .forEach((c) => c.classList.toggle("active", c.dataset.id === id));

    previewTitleEl.textContent = `${selectedSnippet.icon} ${selectedSnippet.name}`;
    previewCodeEl.textContent = selectedSnippet.code;
    previewEl.classList.remove("hidden");
    setTimeout(
      () => previewEl.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      50,
    );
  }

  /* ---------- Use snippet → replace editor ---------- */
  function useSnippet() {
    if (!selectedSnippet) return;

    const hasContent = editor.getValue().trim().length > 0;
    if (hasContent) {
      const ok = confirm(
        `Ganti seluruh isi editor dengan "${selectedSnippet.name}"?\n\n` +
          `Bisa di-undo dengan Ctrl+Z jika tidak sengaja.`,
      );
      if (!ok) return;
    }

    let code = selectedSnippet.code;
    try {
      code = formatScad(code);
    } catch {
      /* keep raw — format best-effort */
    }

    editor.setValue(code); // recordHistory=true → undoable
    tabManager?.updateActiveSilent({ code });
    saveNow?.();
    log("info", `📚 Snippet loaded: ${selectedSnippet.name}`);
    toast(`📚 ${selectedSnippet.name}`);
    doRender?.();
    close();
  }

  /* ---------- Copy snippet ---------- */
  function copySnippet() {
    if (!selectedSnippet) return;
    navigator.clipboard
      .writeText(selectedSnippet.code)
      .then(() => toast("📋 Copied"))
      .catch(() => toast("Copy gagal"));
  }

  /* ---------- Open / close ---------- */
  function open() {
    modal.classList.remove("hidden");
    selectedSnippet = null;
    previewEl.classList.add("hidden");
    renderGrid();
    setTimeout(() => searchEl.focus(), 50);
  }

  function close() {
    modal.classList.add("hidden");
  }

  /* ---------- Events ---------- */
  modal.querySelector("#snippetClose").addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  searchEl.addEventListener("input", () => {
    currentSearch = searchEl.value.trim();
    renderGrid();
  });
  modal.querySelector("#snippetUse").addEventListener("click", useSnippet);
  modal.querySelector("#snippetCopy").addEventListener("click", copySnippet);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      e.preventDefault();
      close();
    }
  });

  return { open, close };
}
