import { createTokenHarborClient } from "../ai/tokenharbor-client.js";
import { askFixer } from "../ai/code-fixer.js";
import { AI_CONFIG } from "../config.js";
import { log } from "../ui/console.js";
import { toast } from "../ui/status.js";
import { diffLines, diffStats, collapseContext } from "../ai/diff.js";
import { escapeHtml } from "../utils.js";

export function initAIUI(deps) {
  const { editor, tabManager, saveNow, doRender, getLastError } = deps;

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
        <span><i class="fa-solid fa-robot"></i> AI Code Fixer <small>${AI_CONFIG.model}</small></span>
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
        <p class="ai-hint">
          Dapatkan key gratis di
          <a href="https://tokenharbor.ai/dashboard/api-keys" target="_blank" rel="noopener">tokenharbor.ai/dashboard/api-keys</a>.
          Key disimpan lokal di browser (localStorage) — jangan pakai di komputer publik.
        </p>
      </div>
      <div id="aiLog" class="ai-log"></div>
      <div class="ai-composer">
        <textarea id="aiInput" rows="2"
          placeholder="Jelaskan yang ingin diperbaiki, atau kosongkan untuk auto-fix error…"></textarea>
        <div class="ai-actions">
          <button id="aiAutoFix" title="Kirim kode + error terakhir ke AI">🛠 Fix error</button>
          <button id="aiSend" class="primary">➤ Send</button>
        </div>
      </div>
      <div id="aiStatus" class="ai-status"></div>
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

  /* ---------- Core ---------- */
  async function run({ question, autoFix }) {
    if (busy) return;
    const oldCode = editor.getValue();
    const error = autoFix ? getLastError?.() || null : null;

    if (autoFix && !error) {
      toast("Tidak ada error terakhir — coba Render dulu.");
      return;
    }
    busy = true;
    abortController = new AbortController();
    statusEl.textContent = "AI sedang berpikir…";

    const userLabel = question || "Perbaiki error render terakhir.";
    addMessage("user", userLabel);
    history.push({ role: "user", content: userLabel });

    const replyEl = addMessage("assistant", "");

    try {
      const result = await askFixer(client, {
        code: oldCode,
        error,
        question,
        history: history.slice(-6, -1), // 6 pesan sebelumnya
        onToken: (chunk) => appendStream(replyEl, chunk),
        signal: abortController.signal,
      });

      history.push({ role: "assistant", content: result.reply });
      if (result.proposedCode)
        appendFixBlock(replyEl, result.proposedCode, oldCode);
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

  function appendFixBlock(afterEl, code, baseCode) {
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

    wrap.innerHTML = `
      <div class="ai-fix-head">
        <span class="ai-fix-label">🛠 Proposed fix</span>
        ${statsHTML}
        ${driftHTML}
        <div class="spacer"></div>
        ${changed ? `<button class="ai-fix-toggle"></button>` : ""}
        <button class="ai-fix-copy">Copy</button>
        <button class="ai-fix-apply primary">Apply</button>
      </div>
      ${changed ? `<div class="ai-fix-diff"></div>` : ""}
    `;

    afterEl.appendChild(wrap);

    if (changed) {
      const diffEl = wrap.querySelector(".ai-fix-diff");
      const toggleBtn = wrap.querySelector(".ai-fix-toggle");
      const collapsed = collapseContext(ops, 3);
      diffEl.innerHTML = buildDiffHTML(collapsed);

      // Auto-expand kalau diff pendek; collapse kalau panjang
      const autoExpand = collapsed.length <= 20;
      diffEl.classList.toggle("hidden", !autoExpand);
      toggleBtn.textContent = autoExpand ? "Hide diff" : "Show diff";

      toggleBtn.addEventListener("click", () => {
        const hidden = diffEl.classList.toggle("hidden");
        toggleBtn.textContent = hidden ? "Show diff" : "Hide diff";
        logEl.scrollTop = logEl.scrollHeight;
      });
    }

    wrap.querySelector(".ai-fix-apply").addEventListener("click", () => {
      const current = editor.getValue();
      if (current !== baseCode) {
        const ok = confirm(
          "Kode editor telah berubah sejak AI membaca.\n\n" +
            "Apply akan MENIMPA perubahan tersebut dengan fix AI.\n\n" +
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

  $("#aiSend").addEventListener("click", () => {
    const q = inputEl.value.trim();
    inputEl.value = "";
    run({ question: q || null, autoFix: false });
  });
  $("#aiAutoFix").addEventListener("click", () => {
    inputEl.value = "";
    run({ question: null, autoFix: true });
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("#aiSend").click();
    }
  });

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

  return { open, close };
}
