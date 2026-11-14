/**
 * Code Outline / Symbol Panel
 *
 * Menampilkan daftar Parameters, Modules, Functions, Variables dari
 * source code editor. Klik item → jump ke baris deklarasi.
 * Cursor bergerak → item aktif di-highlight otomatis.
 *
 * Parsing pakai Parser existing (single source of truth).
 * Parse error → tunjukkan error tapi tetap tampilkan @param.
 */
import { tokenize } from "../core/tokenizer.js";
import { Parser } from "../core/parser.js";
import { parseParams } from "../core/params.js";
import { escapeHtml } from "../utils.js";

const DEBOUNCE_MS = 300;
const KIND_ICON = { param: "⚙", module: "◈", function: "ƒ", variable: "▪" };
const GROUPS = [
  { kind: "param", title: "Parameters" },
  { kind: "module", title: "Modules" },
  { kind: "function", title: "Functions" },
  { kind: "variable", title: "Variables" },
];

export function createCodeOutline({ editor, onJump }) {
  const rightEl = document.getElementById("right");
  const topbarRight = document.getElementById("topbar-right");
  if (!rightEl || !topbarRight) return null;

  /* ---------- Build panel ---------- */
  const panel = document.createElement("div");
  panel.id = "outlinePanel";
  panel.className = "outline-panel hidden";
  panel.innerHTML = `
    <div class="outline-head">
      <span class="outline-title">🗂 Outline</span>
      <div class="spacer"></div>
      <button id="outlineRefresh" class="outline-btn" title="Refresh">↻</button>
      <button id="outlineClose" class="outline-btn" title="Close">✕</button>
    </div>
    <div id="outlineBody" class="outline-body"></div>
  `;
  rightEl.appendChild(panel);

  const bodyEl = panel.querySelector("#outlineBody");

  /* ---------- Build button ---------- */
  const btn = document.createElement("button");
  btn.id = "btnOutline";
  btn.title = "Code outline (symbols)";
  btn.innerHTML = '🗂 <span class="lbl">Outline</span>';
  const paramsBtn = document.getElementById("btnParams");
  if (paramsBtn && paramsBtn.parentNode === topbarRight) {
    topbarRight.insertBefore(btn, paramsBtn);
  } else {
    topbarRight.appendChild(btn);
  }

  /* ---------- State ---------- */
  let isVisible = false;
  let refreshTimer = null;
  let symbols = [];
  let lastCode = null;
  let activeItemEl = null;

  /* ---------- Symbol extraction ---------- */
  function findParamLines(code, params) {
    const lines = code.split("\n");
    const map = new Map();
    for (const p of params) {
      // Prioritas 1: @param annotation
      for (let i = 0; i < lines.length; i++) {
        if (/@param\s+[A-Za-z_]/.test(lines[i]) && lines[i].includes(p.name)) {
          map.set(p.name, i + 1);
          break;
        }
      }
      // Fallback: assignment `name = ...` di top-level
      if (!map.has(p.name)) {
        for (let i = 0; i < lines.length; i++) {
          const re = new RegExp(
            `^\\s*${p.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*=`,
          );
          if (re.test(lines[i])) {
            map.set(p.name, i + 1);
            break;
          }
        }
      }
    }
    return map;
  }

  function parseSymbols(code) {
    let ast = null;
    let parseError = null;
    try {
      ast = new Parser(tokenize(code)).parseProgram();
    } catch (e) {
      parseError = e.message || String(e);
    }

    const items = [];

    /* Params — independent dari parse AST (komentar tetap bisa dibaca) */
    let params = [];
    try {
      params = parseParams(code);
    } catch {
      /* ignore */
    }
    if (params.length > 0) {
      const lineMap = findParamLines(code, params);
      for (const p of params) {
        items.push({
          kind: "param",
          name: p.name,
          label: p.label || p.name,
          line: lineMap.get(p.name) || 0,
          detail: p.type,
        });
      }
    }

    /* Top-level modules, functions, variables dari AST */
    if (ast && Array.isArray(ast.body)) {
      const paramNames = new Set(params.map((p) => p.name));
      for (const st of ast.body) {
        if (st.type === "ModuleDef") {
          items.push({
            kind: "module",
            name: st.name,
            label: st.name + "()",
            line: st.line,
            detail: `${st.params.length}p`,
          });
        } else if (st.type === "FunctionDef") {
          items.push({
            kind: "function",
            name: st.name,
            label: st.name + "()",
            line: st.line,
            detail: `${st.params.length}p`,
          });
        } else if (st.type === "Assignment" && !st.name.startsWith("$")) {
          if (paramNames.has(st.name)) continue; // sudah tampil sbg param
          items.push({
            kind: "variable",
            name: st.name,
            label: st.name,
            line: st.line,
            detail: "",
          });
        }
      }
    }

    return { error: parseError, items };
  }

  /* ---------- Render ---------- */
  function render() {
    if (!symbols || symbols.length === 0) {
      bodyEl.innerHTML = `<div class="outline-empty">Belum ada module, function, atau parameter.</div>`;
      activeItemEl = null;
      return;
    }

    let html = "";
    for (const g of GROUPS) {
      const list = symbols.filter((s) => s.kind === g.kind);
      if (list.length === 0) continue;
      html += `<div class="outline-group">`;
      html += `<div class="outline-group-title">${g.title} <span class="outline-count">${list.length}</span></div>`;
      for (const s of list) {
        html += `
          <div class="outline-item" data-kind="${s.kind}" data-line="${s.line}" data-name="${escapeHtml(s.name)}" title="${escapeHtml(s.detail || s.label)}">
            <span class="outline-icon">${KIND_ICON[s.kind] || "•"}</span>
            <span class="outline-label">${escapeHtml(s.label)}</span>
            ${s.detail ? `<span class="outline-detail">${escapeHtml(s.detail)}</span>` : ""}
            ${s.line > 0 ? `<span class="outline-line">L${s.line}</span>` : ""}
          </div>
        `;
      }
      html += `</div>`;
    }

    bodyEl.innerHTML = html;
    activeItemEl = null;

    bodyEl.querySelectorAll(".outline-item").forEach((el) => {
      el.addEventListener("click", () => {
        const line = parseInt(el.dataset.line, 10);
        if (line > 0) jumpToLine(line);
      });
    });

    if (isVisible) updateActive();
  }

  /* ---------- Jump to line ---------- */
  function jumpToLine(line) {
    const ta = document.getElementById("editor");
    if (!ta) return;
    const lines = ta.value.split("\n");
    if (line < 1 || line > lines.length) return;

    let offset = 0;
    for (let i = 0; i < line - 1; i++) offset += lines[i].length + 1;
    ta.focus();
    ta.setSelectionRange(offset, offset + lines[line - 1].length);

    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    const targetTop = (line - 1) * lh;
    if (
      targetTop < ta.scrollTop ||
      targetTop + lh > ta.scrollTop + ta.clientHeight - lh
    ) {
      ta.scrollTop = Math.max(0, targetTop - lh * 3);
    }
    ta.dispatchEvent(new Event("scroll"));
    onJump?.(line);
  }

  /* ---------- Highlight active symbol ---------- */
  function updateActive() {
    if (!isVisible) return;
    const ta = document.getElementById("editor");
    if (!ta) return;

    const before = ta.value.slice(0, ta.selectionStart);
    const currentLine = before.split("\n").length;

    let bestEl = null;
    let bestLine = -1;
    bodyEl.querySelectorAll(".outline-item").forEach((el) => {
      const line = parseInt(el.dataset.line, 10);
      if (line > 0 && line <= currentLine && line > bestLine) {
        bestLine = line;
        bestEl = el;
      }
    });

    if (bestEl === activeItemEl) return;
    if (activeItemEl) activeItemEl.classList.remove("active");
    activeItemEl = bestEl;
    if (activeItemEl) {
      activeItemEl.classList.add("active");
      activeItemEl.scrollIntoView?.({ block: "nearest" });
    }
  }

  /* ---------- Refresh ---------- */
  function refresh() {
    const code = editor.getValue();
    if (code === lastCode) return;
    lastCode = code;

    const { error, items } = parseSymbols(code);
    symbols = items;

    if (error && items.length === 0) {
      bodyEl.innerHTML = `
        <div class="outline-error">
          ⚠ Parse error:<br>
          <small>${escapeHtml(error)}</small>
        </div>
      `;
      activeItemEl = null;
      return;
    }

    if (error) {
      // Parse error tapi @param tetap ada
      const wrap = document.createElement("div");
      wrap.innerHTML = `
        <div class="outline-error outline-error-inline" title="${escapeHtml(error)}">⚠ Parse error — hanya parameter yang ditampilkan</div>
      `;
      bodyEl.innerHTML = wrap.innerHTML + bodyEl.innerHTML;
      // re-render symbols di bawah error
      const errorEl = bodyEl.querySelector(".outline-error-inline");
      render();
      if (errorEl) bodyEl.insertBefore(errorEl, bodyEl.firstChild);
      return;
    }

    render();
  }

  function scheduleRefresh() {
    if (!isVisible) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, DEBOUNCE_MS);
  }

  /* ---------- Show / hide ---------- */
  function show() {
    isVisible = true;
    panel.classList.remove("hidden");
    btn.classList.add("toggle-on");
    lastCode = null; // force reparse
    refresh();
    updateActive();
  }

  function hide() {
    isVisible = false;
    panel.classList.add("hidden");
    btn.classList.remove("toggle-on");
    clearTimeout(refreshTimer);
  }

  function toggle() {
    isVisible ? hide() : show();
  }

  /* ---------- Wire events ---------- */
  btn.addEventListener("click", toggle);
  panel.querySelector("#outlineClose").addEventListener("click", hide);
  panel.querySelector("#outlineRefresh").addEventListener("click", () => {
    lastCode = null;
    refresh();
  });

  // Editor changes → reparse (debounced, hanya saat visible)
  editor.onValueChange(() => scheduleRefresh());

  // Cursor bergerak → highlight active
  const ta = document.getElementById("editor");
  if (ta) {
    const onCursor = () => {
      if (isVisible) updateActive();
    };
    ta.addEventListener("keyup", onCursor);
    ta.addEventListener("click", onCursor);
    ta.addEventListener("focus", onCursor);
  }

  // Esc → close panel (tidak konflik dengan modal karena capture di main.js)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isVisible) {
      // Hanya kalau tidak ada modal terbuka
      const modalOpen = document.querySelector(".modal-backdrop:not(.hidden)");
      if (!modalOpen) hide();
    }
  });

  return {
    show,
    hide,
    toggle,
    isVisible: () => isVisible,
    refresh,
  };
}
