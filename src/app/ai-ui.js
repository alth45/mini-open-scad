import { createTokenHarborClient } from "../ai/tokenharbor-client.js";
import { askFixer, askGenerator, askExplainer } from "../ai/code-fixer.js";
import { recordRequest } from "../ai/token-tracker.js";
import { createTokenWidget } from "../ui/token-widget.js";
import { AI_CONFIG } from "../config.js";
import { log } from "../ui/console.js";
import { getToolDefinitions, createToolExecutor } from "../ai/ai-tools.js";
import { toast } from "../ui/status.js";
import { diffLines, diffStats, collapseContext } from "../ai/diff.js";
import { escapeHtml } from "../utils.js";

export async function initAIUI(deps) {
  const { editor, tabManager, saveNow, doRender, getLastError, viewer } = deps;

  const client = createTokenHarborClient({
    getApiKey: () => localStorage.getItem(AI_CONFIG.keyStorage) || "",
  });

  /* ---------- Build modal ---------- */
  const modal = document.createElement("div");
  modal.id = "aiModal";
  modal.className = "modal-backdrop hidden";
  modal.innerHTML = `
    <div class="modal ai-modal">
      <div class="modal-title">
        <span>🤖 AI Assistant <small>${AI_CONFIG.model}</small></span>
        <div style="display:flex;gap:6px">
          <button id="aiSettingsBtn" class="modal-x" title="API key settings">⚙</button>
          <button id="aiClose" class="modal-x">✕</button>
        </div>
      </div>
      <div id="aiSettings" class="ai-settings hidden">
        <label>TokenHarbor API key</label>
        <input id="aiKeyInput" type="password" placeholder="thk_live_…" autocomplete="off" />
        <div class="ai-settings-row">
          <button id="aiKeySave" class="primary">Save key</button>
          <button id="aiKeyClear">Clear</button>
          <span id="aiKeyStatus"></span>
        </div>
        <div class="ai-settings-row" style="margin-top:10px">
          <label class="ai-setting-check">
            <input type="checkbox" id="aiToolsEnabled" checked />
            <span>Enable tool calling (model must support)</span>
          </label>
        </div>
        <p class="ai-hint">
          Dapatkan key gratis di
          <a href="https://tokenharbor.ai/dashboard/api-keys" target="_blank" rel="noopener">tokenharbor.ai/dashboard/api-keys</a>.
          Key disimpan lokal di browser (localStorage) — jangan pakai di komputer publik.
        </p>
      </div>
      <div class="ai-modes">
        <button class="ai-mode active" data-mode="fix">🔧 Fix Code</button>
        <button class="ai-mode" data-mode="generate">✨ Generate Code</button>
        <button class="ai-mode" data-mode="explain">📖 Explain Code</button>
      </div>
      <div id="aiLog" class="ai-log"></div>
      <div class="ai-composer">
        <textarea id="aiInput" rows="2"
          placeholder="Jelaskan yang ingin diperbaiki, atau kosongkan untuk auto-fix error…"></textarea>
        <div id="aiSuggestions" class="ai-suggestions hidden">
          <button class="ai-chip" data-prompt="Gear 20 gigi dengan hub 5mm, thickness 8mm, dan $fn=64">⚙ Spur gear</button>
          <button class="ai-chip" data-prompt="Phone stand adjustable dengan slot USB-C di belakang">📱 Phone stand</button>
          <button class="ai-chip" data-prompt="Parametric box dengan snap-fit lid, ukuran dalam 60×40×25mm">📦 Snap box</button>
          <button class="ai-chip" data-prompt="Vase spiral sederhana tinggi 100mm diameter 40mm dengan wall 1.5mm">🏺 Spiral vase</button>
          <button class="ai-chip" data-prompt="Pegboard hook untuk pegboard 1 inch spacing, load capacity kuat">🪝 Pegboard hook</button>
          <button class="ai-chip" data-prompt="Cable clip diameter 5mm dengan lubang sekrup M3 untuk mounting">🔌 Cable clip</button>
        </div>
        <div class="ai-actions">
          <button id="aiAutoFix" title="Kirim kode + error terakhir ke AI">🛠 Fix error</button>
          <button id="aiSend" class="primary">➤ Send</button>
        </div>
      </div>
      <div id="aiStatus" class="ai-status"></div>
      <div id="aiStatsBar" class="ai-stats-bar"></div>

    </div>
  `;
  document.body.appendChild(modal);

  const $ = (s) => modal.querySelector(s);
  const logEl = $("#aiLog");
  const inputEl = $("#aiInput");
  const statusEl = $("#aiStatus");
  const settingsEl = $("#aiSettings");
  const keyInput = $("#aiKeyInput");
  const keyStatus = $("#aiKeyStatus");
  // ✨ Init token widget (subscribe ke tracker, auto-render)
  const tokenWidget = createTokenWidget($("#aiStatsBar"));

  const suggestionsEl = $("#aiSuggestions");
  let currentMode = "fix"; // "fix" | "generate"

  const toolsToggle = $("#aiToolsEnabled");

  // Persist toggle state
  try {
    const saved = localStorage.getItem("mini-openscad-ai-tools-enabled");
    if (saved === "0") toolsToggle.checked = false;
  } catch {
    /* ignore */
  }
  toolsToggle?.addEventListener("change", () => {
    try {
      localStorage.setItem(
        "mini-openscad-ai-tools-enabled",
        toolsToggle.checked ? "1" : "0",
      );
    } catch {
      /* ignore */
    }
  });

  // ✨ Tool executor — dipakai orchestrator saat tools enabled
  const toolExecutor = createToolExecutor({
    getEditorValue: () => editor.getValue(),
    getLastError: () => getLastError?.(),
    viewer,
    store: (await import("../store/app-store.js")).store,
  });

  const history = []; // [{role, content}]
  let busy = false;
  let abortController = null;

  /* ---------- Helpers ---------- */
  function open() {
    modal.classList.remove("hidden");
    refreshKeyStatus();
    if (!localStorage.getItem(AI_CONFIG.keyStorage)) {
      settingsEl.classList.remove("hidden");
    }
    applyModeUI(); // sync UI dengan currentMode terakhir
    tokenWidget?.refresh?.(); // ← refresh stats fresh
    inputEl.focus();
  }

  function close() {
    abortController?.abort();
    abortController = null;
    modal.classList.add("hidden");
  }
  function refreshKeyStatus() {
    const k = localStorage.getItem(AI_CONFIG.keyStorage);
    keyStatus.textContent = k ? "✓ key tersimpan" : "belum ada key";
    keyStatus.className = "ai-key-status " + (k ? "ok" : "warn");
  }
  function addMessage(role, text) {
    const el = document.createElement("div");
    el.className = "ai-msg " + role;
    el.textContent = text;
    logEl.appendChild(el);
    logEl.scrollTop = logEl.scrollHeight;
    return el;
  }
  function appendStream(el, chunk) {
    el.textContent += chunk;
    logEl.scrollTop = logEl.scrollHeight;
  }

  /* ---------- Tool badge helpers ---------- */
  function summarizeToolResult(name, result) {
    if (!result) return "";
    if (result.error) return "— error";
    switch (name) {
      case "get_model_stats":
        return result.hasModel ? `— ${result.triangles} tri` : "— kosong";
      case "get_render_error":
        return result.error ? "— ada error" : "— clean";
      case "get_current_code":
        return `— ${result.length} chars`;
      case "get_param_values":
        return `— ${result.count} params`;
      case "get_param_definitions":
        return `— ${(result.params || []).length} def`;
      case "get_imported_files":
        return `— ${result.count} file`;
      case "list_snippets":
        return `— ${result.count} snippets`;
      case "validate_code":
        return result.ok ? "— ok" : "— error";
      default:
        return "";
    }
  }

  function makeToolBadgeHandler(replyEl) {
    const badges = new Map();
    return ({ id, name, status, result }) => {
      let badge = badges.get(id);
      if (status === "running") {
        badge = document.createElement("span");
        badge.className = "ai-tool-badge running";
        badge.textContent = `🔧 ${name}()…`;
        replyEl.appendChild(badge);
        badges.set(id, badge);
      } else if (badge) {
        if (status === "done") {
          badge.className = "ai-tool-badge done";
          badge.textContent =
            `✓ ${name}() ${summarizeToolResult(name, result)}`.trim();
        } else if (status === "error") {
          badge.className = "ai-tool-badge error";
          badge.textContent = `✗ ${name}()`;
        }
      }
    };
  }

  /* ---------- Core ---------- */
  async function run({ question, autoFix, mode = currentMode }) {
    if (busy) return;
    const oldCode = editor.getValue();
    const error = mode === "fix" && autoFix ? getLastError?.() || null : null;

    if (mode === "fix" && autoFix && !error) {
      toast("Tidak ada error terakhir — coba Render dulu.");
      return;
    }
    if (mode === "generate" && !question?.trim()) {
      toast("Tulis prompt dulu, atau klik salah satu saran.");
      return;
    }

    if (mode === "explain" && !oldCode.trim()) {
      toast("Tidak ada kode untuk dijelaskan.");
      return;
    }

    busy = true;
    abortController = new AbortController();
    statusEl.textContent =
      mode === "generate" ? "AI sedang menulis kode…" : "AI sedang berpikir…";

    const userLabel =
      question ||
      (mode === "fix" ? "Perbaiki error render terakhir." : "(kosong)");
    addMessage("user", userLabel);
    history.push({ role: "user", content: userLabel });

    const replyEl = addMessage("assistant", "");

    const toolsEnabled =
      toolsToggle?.checked && getToolDefinitions()?.length > 0;
    const tools = toolsEnabled ? getToolDefinitions() : undefined;
    const onToolCall = makeToolBadgeHandler(replyEl);
    const onUsage = (usage) => {
      recordRequest({
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        model: AI_CONFIG.model,
      });
    };

    try {
      const commonOpts = {
        onToken: (chunk) => appendStream(replyEl, chunk),
        signal: abortController.signal,
        tools,
        toolExecutor: toolsEnabled ? toolExecutor : undefined,
        onToolCall: toolsEnabled ? onToolCall : undefined,
        onUsage,
      };

      const result =
        mode === "explain"
          ? await askExplainer(client, {
              code: oldCode,
              question,
              history: history.slice(-6, -1),
              ...commonOpts,
            })
          : mode === "generate"
            ? await askGenerator(client, {
                prompt: question,
                existingCode: oldCode,
                history: history.slice(-6, -1),
                ...commonOpts,
              })
            : await askFixer(client, {
                code: oldCode,
                error,
                question,
                history: history.slice(-6, -1),
                ...commonOpts,
              });

      // Usage sudah di-track per-round via onUsage — skip aggregate
      // (aggregate kalau ada tidak ada onUsage callback sama sekali)
      if (result.usage && (!toolsEnabled || !result.toolTrace?.length)) {
        // fallback kalau bukan tools path atau tidak ada tool calls
        // (usage sudah di-record via onUsage kalau tools path, jadi ini hanya untuk non-tools)
        // Skip — sudah handled by onUsage di client.chat? Tidak — onUsage hanya di orchestrator.
        // Kalau non-tools path: recordRequest dipanggil di sini
        if (!toolsEnabled) {
          recordRequest({
            inputTokens: result.usage.prompt_tokens || 0,
            outputTokens: result.usage.completion_tokens || 0,
            model: AI_CONFIG.model,
          });
        }
      }

      history.push({ role: "assistant", content: result.reply });
      if (mode !== "explain" && result.proposedCode) {
        appendFixBlock(replyEl, result.proposedCode, oldCode, {
          generated: mode === "generate",
          prompt: question || "",
        });
      }

      // ✨ Log tool trace ke console (untuk debug)
      if (result.toolTrace?.length > 0) {
        const toolNames = result.toolTrace.map((t) => t.name).join(", ");
        log(
          "info",
          `🤖 AI used ${result.toolTrace.length} tool(s): ${toolNames}`,
        );
      }

      statusEl.textContent = "";
    } catch (e) {
      if (e.name === "AbortError") return;
      replyEl.textContent = "⚠ " + e.message;
      statusEl.textContent = "";
      if (e.name === "MissingApiKeyError")
        settingsEl.classList.remove("hidden");
      log("error", "AI: " + e.message);
    } finally {
      busy = false;
      abortController = null;
    }
  }

  function appendFixBlock(afterEl, code, baseCode, options = {}) {
    const { generated = false, prompt = "" } = options;
    const ops = diffLines(baseCode, code);
    const stats = diffStats(ops);
    const changed = stats.add > 0 || stats.del > 0;
    const editorDrift = editor.getValue() !== baseCode;

    const wrap = document.createElement("div");
    wrap.className = "ai-fix-block";

    const statsHTML = changed
      ? `<span class="ai-fix-stats"><span class="add">+${stats.add}</span> <span class="del">−${stats.del}</span></span>`
      : `<span class="ai-fix-stats no-change">no change</span>`;

    const driftHTML = editorDrift
      ? `<span class="ai-fix-warn" title="Kode editor telah berubah sejak AI membaca. Apply akan menimpa perubahan tersebut.">⚠</span>`
      : "";

    const label = generated ? "✨ Generated code" : "🛠 Proposed fix";

    wrap.innerHTML = `
      <div class="ai-fix-head">
        <span class="ai-fix-label">${label}</span>
        ${statsHTML}
        ${driftHTML}
        <div class="spacer"></div>
        ${changed ? `<button class="ai-fix-toggle"></button>` : ""}
        <button class="ai-fix-copy">Copy</button>
        ${generated ? `<button class="ai-fix-newtab primary">New tab</button>` : ""}
        <button class="ai-fix-apply ${generated ? "" : "primary"}">${generated ? "Replace current" : "Apply"}</button>
      </div>
      ${changed ? `<div class="ai-fix-diff"></div>` : ""}
    `;

    afterEl.appendChild(wrap);

    if (changed) {
      const diffEl = wrap.querySelector(".ai-fix-diff");
      const toggleBtn = wrap.querySelector(".ai-fix-toggle");
      const collapsed = collapseContext(ops, 3);
      diffEl.innerHTML = buildDiffHTML(collapsed);

      const autoExpand = collapsed.length <= 20;
      diffEl.classList.toggle("hidden", !autoExpand);
      toggleBtn.textContent = autoExpand ? "Hide diff" : "Show diff";

      toggleBtn.addEventListener("click", () => {
        const hidden = diffEl.classList.toggle("hidden");
        toggleBtn.textContent = hidden ? "Show diff" : "Hide diff";
        logEl.scrollTop = logEl.scrollHeight;
      });
    }

    // Action: New tab (jika generated)
    if (generated) {
      const newTabBtn = wrap.querySelector(".ai-fix-newtab");
      newTabBtn.addEventListener("click", () => {
        const shortName = (prompt || "AI Code")
          .slice(0, 30)
          .replace(/\s+/g, " ")
          .trim();
        const tabName = `✨ ${shortName || "AI Code"}`;
        try {
          const tab = createTab(tabName, code);
          tabManager.add(tab); // triggers setActive → editor.load + doRender
          saveNow?.();
          toast("✓ Tab baru dibuat");
          close();
        } catch (e) {
          toast("✖ Gagal buat tab: " + e.message);
        }
      });
    }

    // Action: Apply / Replace current
    wrap.querySelector(".ai-fix-apply").addEventListener("click", () => {
      const current = editor.getValue();
      if (current !== baseCode) {
        const ok = confirm(
          "Kode editor telah berubah sejak AI membaca.\n\n" +
            "Lanjutkan akan MENIMPA perubahan tersebut dengan hasil AI.\n\n" +
            "Lanjutkan?",
        );
        if (!ok) return;
      }
      editor.setValue(code); // recordHistory=true → bisa undo
      tabManager?.updateActiveSilent({ code });
      saveNow?.();
      toast("✓ Kode diperbarui");
      doRender?.();
      close();
    });

    wrap.querySelector(".ai-fix-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        toast("📋 Copied");
      } catch {
        toast("Copy gagal");
      }
    });

    logEl.scrollTop = logEl.scrollHeight;
  }

  /** Render ops[] → HTML string untuk panel diff */
  function buildDiffHTML(ops) {
    return ops
      .map((op) => {
        if (op.type === "skip") {
          return `<div class="ai-diff-skip">⋯ ${op.count} baris tidak berubah ⋯</div>`;
        }
        const marker = op.type === "add" ? "+" : op.type === "del" ? "−" : " ";
        const oldNum = op.oldNum ?? "";
        const newNum = op.newNum ?? "";
        const text = escapeHtml(op.text) || " ";
        return (
          `<div class="ai-diff-line ${op.type}">` +
          `<span class="ai-diff-num">${oldNum}</span>` +
          `<span class="ai-diff-num">${newNum}</span>` +
          `<span class="ai-diff-marker">${marker}</span>` +
          `<span class="ai-diff-text">${text}</span>` +
          `</div>`
        );
      })
      .join("");
  }

  /* ---------- Events ---------- */
  $("#aiClose").addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  $("#aiSettingsBtn").addEventListener("click", () =>
    settingsEl.classList.toggle("hidden"),
  );
  $("#aiKeySave").addEventListener("click", () => {
    const v = keyInput.value.trim();
    if (!v.startsWith("thk_")) {
      toast("⚠ Key harus diawali 'thk_'");
      return;
    }
    localStorage.setItem(AI_CONFIG.keyStorage, v);
    keyInput.value = "";
    refreshKeyStatus();
    toast("✓ Key tersimpan");
  });
  $("#aiKeyClear").addEventListener("click", () => {
    localStorage.removeItem(AI_CONFIG.keyStorage);
    refreshKeyStatus();
    toast("Key dihapus");
  });

  // ---- Mode switcher ----
  modal.querySelectorAll(".ai-mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      if (mode === currentMode) return;
      currentMode = mode;
      modal
        .querySelectorAll(".ai-mode")
        .forEach((b) => b.classList.toggle("active", b === btn));
      applyModeUI();
    });
  });

  function applyModeUI() {
    const isGen = currentMode === "generate";
    const isExplain = currentMode === "explain";
    inputEl.placeholder = isGen
      ? "Deskripsikan part yang ingin dibuat… (mis. 'gear 20 gigi hub 5mm')"
      : isExplain
        ? "Tanya apa saja tentang kode ini… (kosongkan untuk penjelasan umum)"
        : "Jelaskan yang ingin diperbaiki, atau kosongkan untuk auto-fix error…";
    // Fix error button hanya muncul di mode fix
    $("#aiAutoFix").classList.toggle("hidden", currentMode !== "fix");
    suggestionsEl.classList.toggle("hidden", !isGen);
    const sendLabel = isGen
      ? "✨ Generate"
      : isExplain
        ? "📖 Explain"
        : "➤ Send";
    $("#aiSend").textContent = sendLabel;
    $("#aiSend").classList.add("primary");
  }

  $("#aiSend").addEventListener("click", () => {
    const q = inputEl.value.trim();
    inputEl.value = "";
    run({ question: q || null, autoFix: false, mode: currentMode });
  });
  $("#aiAutoFix").addEventListener("click", () => {
    inputEl.value = "";
    run({ question: null, autoFix: true, mode: "fix" });
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("#aiSend").click();
    }
  });

  // ---- Suggestion chips (generate mode) ----
  suggestionsEl.querySelectorAll(".ai-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const p = chip.dataset.prompt || chip.textContent;
      inputEl.value = p;
      run({ question: p, autoFix: false, mode: "generate" });
      inputEl.value = "";
    });
  });

  // ============================================================
  // 📖 Explain Code — selection-aware
  // ============================================================

  function getEditorEl() {
    return document.getElementById("editor");
  }

  function explainSelection(customQuestion = null) {
    if (busy) {
      toast("AI sedang sibuk — tunggu dulu.");
      return;
    }
    const ta = getEditorEl();
    if (!ta) return;

    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = ta.value.slice(start, end).trim();

    let code = sel;
    if (!code) {
      code = ta.value;
      if (!code.trim()) {
        toast("Editor kosong — tidak ada yang bisa dijelaskan.");
        return;
      }
      const lines = code.split("\n").length;
      if (lines > 200) {
        const ok = confirm(
          `Tidak ada seleksi. Seluruh kode (${lines} baris) akan dijelaskan — mungkin butuh waktu lama.\n\n` +
            `Tip: select beberapa baris dulu untuk penjelasan yang lebih fokus.\n\n` +
            `Lanjutkan?`,
        );
        if (!ok) return;
      }
    }

    // Force explain mode
    currentMode = "explain";
    modal
      .querySelectorAll(".ai-mode")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.mode === "explain"),
      );
    open(); // idempotent — juga panggil applyModeUI()

    run({ question: customQuestion, mode: "explain", codeOverride: code });
  }

  // ---- Floating selection toolbar ----
  (function setupSelectionToolbar() {
    const ta = getEditorEl();
    if (!ta) return;

    const bar = document.createElement("div");
    bar.className = "ai-selection-toolbar";
    bar.innerHTML = `<button class="ai-sel-btn" title="Explain selection (Ctrl+Shift+E)">📖 Explain</button>`;
    document.body.appendChild(bar);

    let cwCache = 0;
    function measureCharWidth() {
      if (cwCache) return cwCache;
      const style = getComputedStyle(ta);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      ctx.font = `${style.fontSize} ${style.fontFamily}`;
      cwCache = ctx.measureText("M").width || 8;
      return cwCache;
    }

    function update() {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const hasSel =
        end > start && ta.value.slice(start, end).trim().length > 0;

      if (!hasSel) {
        bar.classList.remove("visible");
        return;
      }

      const style = getComputedStyle(ta);
      const lineHeight = parseFloat(style.lineHeight) || 20;
      const padTop = parseFloat(style.paddingTop) || 10;
      const padLeft = parseFloat(style.paddingLeft) || 12;
      const cw = measureCharWidth();

      const before = ta.value.slice(0, end);
      const lines = before.split("\n");
      const lineIdx = lines.length - 1;
      const col = lines[lineIdx].length;

      const rect = ta.getBoundingClientRect();
      const x = rect.left + padLeft + col * cw - ta.scrollLeft;
      const y = rect.top + padTop + lineIdx * lineHeight - ta.scrollTop;

      const tw = bar.offsetWidth || 110;
      const th = bar.offsetHeight || 30;
      let px = x + 6;
      let py = y + lineHeight + 4;
      if (px + tw > window.innerWidth - 8) px = window.innerWidth - tw - 8;
      if (px < 8) px = 8;
      if (py + th > window.innerHeight - 8) py = y - th - 4;
      if (py < 8) py = 8;

      bar.style.left = px + "px";
      bar.style.top = py + "px";
      bar.classList.add("visible");
    }

    ta.addEventListener("select", update);
    ta.addEventListener("mouseup", () => setTimeout(update, 10));
    ta.addEventListener("keyup", () => setTimeout(update, 10));
    ta.addEventListener("scroll", update);
    ta.addEventListener("blur", () => {
      setTimeout(() => {
        if (document.activeElement !== ta) bar.classList.remove("visible");
      }, 120);
    });

    bar.querySelector(".ai-sel-btn").addEventListener("mousedown", (e) => {
      e.preventDefault(); // jangan hilangkan selection
      bar.classList.remove("visible");
      explainSelection();
    });
  })();

  // ---- Keyboard shortcut: Ctrl+Shift+E ----
  document.addEventListener(
    "keydown",
    (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && !e.altKey && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        e.stopPropagation();
        explainSelection();
      }
    },
    true, // CAPTURE — biar tidak kalah oleh handler lain
  );

  /* ---------- Button di topbar ---------- */
  const topbarRight = document.getElementById("topbar-right");
  if (topbarRight) {
    const btn = document.createElement("button");
    btn.id = "btnAI";
    btn.title = "AI Code Fixer (TokenHarbor)";
    btn.innerHTML =
      '<i class="fa-solid fa-robot"></i> <span class="lbl">AI</span>';
    btn.addEventListener("click", open);
    const status = document.getElementById("statusWrap");
    topbarRight.insertBefore(btn, status);
  }

  return { open, close, explainSelection };
}
