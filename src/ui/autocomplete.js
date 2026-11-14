/**
 * Autocomplete untuk editor OpenSCAD.
 *
 * - Trigger: mengetik ≥2 karakter identifier, atau `$` (special var),
 *   atau `Ctrl+Space` (paksa tampil semua).
 * - Navigasi: ↑↓, pilih: Tab / Enter, tutup: Esc.
 * - Insert cerdas: module/fungsi otomatis `()`, keyword otomatis suffix.
 * - Tidak trigger di dalam string atau comment `//`.
 * - Data modul diambil dari SYNTAX (cheatsheet) — single source of truth.
 */
import { SYNTAX } from "./cheatsheet.js";
import { escapeHtml } from "../utils.js";

const WORD_RE = /[A-Za-z0-9_$]+$/;

const KEYWORD_INSERTS = {
  for: "for ",
  if: "if ",
  else: "else ",
  module: "module ",
  function: "function ",
  let: "let ",
  include: "include <",
  use: "use <",
  import: { insert: 'import("")', cursorOffset: -2 },
  true: "true",
  false: "false",
  undef: "undef",
  each: "each ",
};

const SPECIAL_VARS = [
  { name: "$fn", desc: "Fixed segment count (0 = auto)" },
  { name: "$fa", desc: "Max angle per segment (deg)" },
  { name: "$fs", desc: "Min arc length (mm)" },
  { name: "$preview", desc: "true saat F5 preview, false saat F6 final" },
  { name: "$maxTime", desc: "Batas waktu evaluasi (ms)" },
  { name: "$children", desc: "Jumlah child yang diterima module" },
];

const BUILTIN_FUNCTIONS = [
  "abs",
  "sign",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "floor",
  "ceil",
  "round",
  "sqrt",
  "pow",
  "exp",
  "ln",
  "log",
  "min",
  "max",
  "len",
  "norm",
  "concat",
  "str",
  "cross",
  "rands",
  "chr",
  "ord",
  "search",
  "is_num",
  "is_string",
  "is_bool",
  "is_list",
  "is_undef",
  "is_function",
  "is_range",
  "is_object",
];

const KIND_ICONS = { module: "◈", function: "ƒ", keyword: "K", var: "$" };

let _allItemsCache = null;

function getAllItems() {
  if (_allItemsCache) return _allItemsCache;
  const map = new Map();
  const add = (it) => {
    if (!map.has(it.label)) map.set(it.label, it);
  };

  // 1. Kumpulkan deskripsi dari SYNTAX dulu (untuk keyword yang nanti override)
  const syntaxDesc = new Map();
  for (const section of SYNTAX) {
    for (const item of section.items) {
      const m = item.name.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (m) syntaxDesc.set(m[1], item.desc || "");
    }
  }

  // 2. Keyword (PRIORITAS — override SYNTAX classification)
  for (const [kw, spec] of Object.entries(KEYWORD_INSERTS)) {
    const insert = typeof spec === "string" ? spec : spec.insert;
    const cursorOffset = typeof spec === "string" ? 0 : spec.cursorOffset || 0;
    map.set(kw, {
      label: kw,
      kind: "keyword",
      desc: syntaxDesc.get(kw) || "",
      insert,
      cursorOffset,
      category: "Keyword",
    });
  }

  // 3. Modul/fungsi/var dari SYNTAX
  for (const section of SYNTAX) {
    for (const item of section.items) {
      const m = item.name.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (!m) continue;
      const label = m[1];
      if (map.has(label)) continue;
      const callable = item.code.includes(label + "(");
      add({
        label,
        kind: callable ? "module" : "var",
        desc: item.desc || "",
        insert: callable ? `${label}()` : label,
        cursorOffset: callable ? -1 : 0,
        category: section.title,
      });
    }
  }

  // 4. Special vars (jika belum ada)
  for (const sv of SPECIAL_VARS) {
    add({
      label: sv.name,
      kind: "var",
      desc: sv.desc,
      insert: sv.name,
      cursorOffset: 0,
      category: "Special",
    });
  }

  // 5. Built-in functions
  for (const fn of BUILTIN_FUNCTIONS) {
    add({
      label: fn,
      kind: "function",
      desc: "Built-in function",
      insert: `${fn}()`,
      cursorOffset: -1,
      category: "Function",
    });
  }

  _allItemsCache = Array.from(map.values());
  return _allItemsCache;
}

export function createAutocomplete({ editorEl }) {
  if (!editorEl) return null;

  /* ---------- DOM ---------- */
  const popup = document.createElement("div");
  popup.className = "ac-popup hidden";
  popup.id = "autocompletePopup";
  popup.innerHTML = `<div class="ac-list" id="acList" role="listbox"></div>`;
  document.body.appendChild(popup);
  const listEl = popup.querySelector("#acList");

  /* ---------- State ---------- */
  let visible = false;
  let activeIndex = 0;
  let currentItems = [];
  let currentWordStart = 0;
  let justInserted = false;
  let charWidthCache = 0;

  /* ---------- Helpers ---------- */
  function getCharWidth() {
    if (charWidthCache) return charWidthCache;
    const style = getComputedStyle(editorEl);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = `${style.fontSize} ${style.fontFamily}`;
    charWidthCache = ctx.measureText("M").width || 8;
    return charWidthCache;
  }

  function computePosition(cursorOffset) {
    const style = getComputedStyle(editorEl);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const padTop = parseFloat(style.paddingTop) || 10;
    const padLeft = parseFloat(style.paddingLeft) || 12;
    const cw = getCharWidth();

    const before = editorEl.value.slice(0, cursorOffset);
    const lines = before.split("\n");
    const lineIdx = lines.length - 1;
    const col = lines[lineIdx].length;

    const rect = editorEl.getBoundingClientRect();
    const x = rect.left + padLeft + col * cw - editorEl.scrollLeft;
    const y =
      rect.top + padTop + (lineIdx + 1) * lineHeight - editorEl.scrollTop;
    return { x, y };
  }

  function isInStringOrComment(cursor) {
    const before = editorEl.value.slice(0, cursor);
    const lineStart = before.lastIndexOf("\n") + 1;
    const line = before.slice(lineStart);
    let inStr = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i - 1] !== "\\") inStr = !inStr;
      if (!inStr && c === "/" && line[i + 1] === "/") return true;
    }
    return inStr;
  }

  function filterItems(prefix) {
    const all = getAllItems();
    if (!prefix) return all.slice(0, 40);
    const lower = prefix.toLowerCase();
    const exact = [],
      starts = [],
      contains = [];
    for (const it of all) {
      const l = it.label.toLowerCase();
      if (l === lower) exact.push(it);
      else if (l.startsWith(lower)) starts.push(it);
      else if (l.includes(lower)) contains.push(it);
    }
    return [...exact, ...starts, ...contains].slice(0, 40);
  }

  function render() {
    if (currentItems.length === 0) {
      hide();
      return;
    }
    listEl.innerHTML = currentItems
      .map(
        (it, i) => `
      <div class="ac-item ${i === activeIndex ? "active" : ""}"
           data-index="${i}" data-kind="${it.kind}" role="option">
        <span class="ac-icon">${KIND_ICONS[it.kind] || "?"}</span>
        <span class="ac-label">${escapeHtml(it.label)}</span>
        ${it.desc ? `<span class="ac-desc">${escapeHtml(it.desc)}</span>` : ""}
      </div>
    `,
      )
      .join("");

    listEl.querySelectorAll(".ac-item").forEach((el) => {
      const idx = parseInt(el.dataset.index, 10);
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectIndex(idx);
      });
      el.addEventListener("mouseenter", () => {
        activeIndex = idx;
        updateActiveVisual();
      });
    });
  }

  function updateActiveVisual() {
    listEl.querySelectorAll(".ac-item").forEach((el, i) => {
      el.classList.toggle("active", i === activeIndex);
    });
    const el = listEl.children[activeIndex];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }

  function position() {
    const { x, y } = computePosition(editorEl.selectionStart);
    const popW = popup.offsetWidth || 260;
    const popH = popup.offsetHeight || 200;
    let px = x;
    let py = y + 2;
    if (px + popW > window.innerWidth - 8) px = window.innerWidth - popW - 8;
    if (px < 8) px = 8;
    if (py + popH > window.innerHeight - 8) {
      py = y - popH - 22;
      if (py < 8) py = 8;
    }
    popup.style.left = px + "px";
    popup.style.top = py + "px";
  }

  function show(items, wordStart) {
    currentItems = items;
    currentWordStart = wordStart;
    activeIndex = 0;
    visible = true;
    popup.classList.remove("hidden");
    render();
    requestAnimationFrame(() => position());
  }

  function hide() {
    visible = false;
    popup.classList.add("hidden");
    currentItems = [];
  }

  function isVisible() {
    return visible;
  }

  function selectIndex(idx) {
    if (idx < 0 || idx >= currentItems.length) return;
    activeIndex = idx;
    updateActiveVisual();
    applyItem(currentItems[idx]);
  }

  function applyItem(item) {
    const cursor = editorEl.selectionStart;
    const val = editorEl.value;
    const before = val.slice(0, currentWordStart);
    const after = val.slice(cursor);
    const newVal = before + item.insert + after;
    const newCursor =
      before.length + item.insert.length + (item.cursorOffset || 0);

    editorEl.value = newVal;
    editorEl.selectionStart = editorEl.selectionEnd = newCursor;

    justInserted = true;
    editorEl.dispatchEvent(new Event("input", { bubbles: true }));
    hide();
    editorEl.focus();
  }

  function handleInput() {
    if (justInserted) {
      justInserted = false;
      return;
    }

    const cursor = editorEl.selectionStart;
    if (cursor !== editorEl.selectionEnd) {
      hide();
      return;
    }
    if (isInStringOrComment(cursor)) {
      hide();
      return;
    }

    const before = editorEl.value.slice(0, cursor);
    const m = before.match(WORD_RE);
    if (!m) {
      hide();
      return;
    }
    const word = m[0];
    if (/^[0-9]/.test(word)) {
      hide();
      return;
    }

    const isDollar = word.startsWith("$");
    if (word.length < 2 && !(isDollar && word.length === 1)) {
      hide();
      return;
    }

    const items = filterItems(word);
    if (items.length === 0) {
      hide();
      return;
    }
    show(items, cursor - word.length);
  }

  function onKeyDown(e) {
    // Ctrl+Space — manual trigger
    if ((e.ctrlKey || e.metaKey) && e.code === "Space") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (visible) {
        hide();
        return;
      }
      const cursor = editorEl.selectionStart;
      const before = editorEl.value.slice(0, cursor);
      const m = before.match(WORD_RE);
      const word = m ? m[0] : "";
      const items = filterItems(word);
      if (items.length) show(items, cursor - word.length);
      return;
    }

    if (!visible) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopImmediatePropagation();
      activeIndex = (activeIndex + 1) % currentItems.length;
      updateActiveVisual();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopImmediatePropagation();
      activeIndex =
        (activeIndex - 1 + currentItems.length) % currentItems.length;
      updateActiveVisual();
    } else if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      e.stopImmediatePropagation();
      selectIndex(activeIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      hide();
    }
  }

  function onScroll() {
    if (visible) position();
  }
  function onBlur() {
    setTimeout(() => {
      if (document.activeElement !== editorEl) hide();
    }, 100);
  }
  function onClick() {
    if (visible) hide();
  }

  /* ---------- Wire ---------- */
  editorEl.addEventListener("input", handleInput);
  editorEl.addEventListener("keydown", onKeyDown, true); // CAPTURE — sebelum editor
  editorEl.addEventListener("scroll", onScroll);
  editorEl.addEventListener("blur", onBlur);
  editorEl.addEventListener("click", onClick);
  window.addEventListener("resize", () => {
    if (visible) position();
  });

  return { hide, isVisible };
}
