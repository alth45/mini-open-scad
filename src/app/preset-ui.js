import { loadPresets, savePresets } from "../files/preset-store.js";
import { store } from "../store/app-store.js";
import { parseParams } from "../core/params.js";
import { escapeHtml } from "../utils.js";
import { log } from "../ui/console.js";
import { toast } from "../ui/status.js";

export function initPresetUI({ editor, tabManager, renderController }) {
  const paramsHead = document.getElementById("paramsHead");
  if (!paramsHead) {
    console.warn("[preset-ui] #paramsHead tidak ditemukan");
    return { refresh: () => {}, open: () => {}, close: () => {} };
  }

  /* ---------- Button di params head ---------- */
  const btn = document.createElement("button");
  btn.id = "paramsPresets";
  btn.title = "Param presets (save/load kombinasi nilai)";
  btn.innerHTML = "📌";
  const resetBtn = document.getElementById("paramsReset");
  if (resetBtn && resetBtn.parentNode === paramsHead) {
    paramsHead.insertBefore(btn, resetBtn);
  } else {
    paramsHead.appendChild(btn);
  }

  /* ---------- Panel (di body, fixed) ---------- */
  const panel = document.createElement("div");
  panel.id = "presetPanel";
  panel.className = "preset-panel hidden";
  panel.innerHTML = `
    <div class="preset-head">
      <span class="preset-title">📌 Presets</span>
      <button class="preset-x" title="Close">✕</button>
    </div>
    <div class="preset-body">
      <div class="preset-save-row">
        <input type="text" id="presetNameInput" class="preset-name-input"
               placeholder="Nama preset (mis. Large)" maxlength="40" autocomplete="off" />
        <button id="presetSaveBtn" class="preset-save-btn primary" title="Save current values">Save</button>
      </div>
      <div id="presetList" class="preset-list"></div>
    </div>
  `;
  document.body.appendChild(panel);

  const listEl = panel.querySelector("#presetList");
  const nameInput = panel.querySelector("#presetNameInput");
  let isOpen = false;

  /* ---------- Helpers ---------- */
  function currentTabId() {
    return tabManager?.activeId || null;
  }

  function currentValues() {
    return store.getState().paramValues || {};
  }

  function getCurrentParamNames() {
    try {
      return parseParams(editor.getValue()).map((p) => p.name);
    } catch {
      return [];
    }
  }

  function summarizeValues(values) {
    const keys = Object.keys(values);
    if (keys.length === 0) return "no params";
    if (keys.length <= 2) {
      return keys.map((k) => `${k}=${formatVal(values[k])}`).join(" · ");
    }
    return `${keys.length} params`;
  }

  function formatVal(v) {
    if (typeof v === "number")
      return Number.isInteger(v) ? String(v) : v.toFixed(2);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "string" && v.length > 10) return `"${v.slice(0, 8)}…"`;
    return String(v);
  }

  /* ---------- Panel position ---------- */
  function positionPanel() {
    const rect = btn.getBoundingClientRect();
    const w = panel.offsetWidth || 280;
    const h = panel.offsetHeight || 200;
    let left = rect.right - w; // right-align to button
    let top = rect.bottom + 4;
    if (left < 8) left = 8;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (top + h > window.innerHeight - 8) top = rect.top - h - 4;
    if (top < 8) top = 8;
    panel.style.left = left + "px";
    panel.style.top = top + "px";
  }

  /* ---------- Render list ---------- */
  async function refreshList() {
    const tabId = currentTabId();
    if (!tabId) {
      listEl.innerHTML = `<div class="preset-empty">Tidak ada tab aktif.</div>`;
      return;
    }
    const presets = await loadPresets(tabId);
    const paramNames = getCurrentParamNames();
    const validNames = new Set(paramNames);

    if (presets.length === 0) {
      listEl.innerHTML = `
        <div class="preset-empty">
          Belum ada preset.<br>
          <small>Atur slider ke kombinasi yang diinginkan, lalu Save di atas.</small>
        </div>`;
      return;
    }

    // Sort by createdAt ascending (stable order)
    const sorted = presets
      .slice()
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    listEl.innerHTML = sorted
      .map((p) => {
        // Filter preset values to params that still exist in code
        const validValues = {};
        let dropped = 0;
        for (const k of Object.keys(p.values || {})) {
          if (validNames.has(k)) validValues[k] = p.values[k];
          else dropped++;
        }
        const valuesSummary = summarizeValues(validValues);
        const stale = dropped > 0;
        return `
          <div class="preset-item" data-name="${escapeHtml(p.name)}">
            <div class="preset-item-info">
              <div class="preset-item-name">${escapeHtml(p.name)}</div>
              <div class="preset-item-meta">
                ${escapeHtml(valuesSummary)}${stale ? ` · <span class="preset-warn" title="${dropped} param dihapus dari kode">⚠ ${dropped}</span>` : ""}
              </div>
            </div>
            <div class="preset-item-actions">
              <button class="preset-apply" title="Apply">▶</button>
              <button class="preset-delete" title="Delete">✕</button>
            </div>
          </div>`;
      })
      .join("");

    listEl.querySelectorAll(".preset-item").forEach((el) => {
      const name = el.dataset.name;
      const preset = sorted.find((p) => p.name === name);
      el.querySelector(".preset-apply").addEventListener("click", () =>
        applyPreset(preset),
      );
      el.querySelector(".preset-delete").addEventListener("click", () =>
        deletePreset(name),
      );
    });
  }

  /* ---------- Save / Apply / Delete ---------- */
  async function saveCurrentPreset() {
    const tabId = currentTabId();
    if (!tabId) {
      toast("⚠ Tidak ada tab aktif");
      return;
    }

    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }

    const paramNames = getCurrentParamNames();
    if (paramNames.length === 0) {
      toast("⚠ Kode ini tidak punya @param — tidak ada yang bisa di-preset");
      return;
    }

    const vals = currentValues();
    const filtered = {};
    for (const n of paramNames) if (n in vals) filtered[n] = vals[n];

    let all = await loadPresets(tabId);
    const existingIdx = all.findIndex((p) => p.name === name);

    if (existingIdx >= 0) {
      if (!confirm(`Preset "${name}" sudah ada. Timpa dengan nilai saat ini?`))
        return;
      all[existingIdx] = {
        ...all[existingIdx],
        values: filtered,
        updatedAt: Date.now(),
      };
    } else {
      all.push({
        name,
        values: filtered,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    try {
      await savePresets(tabId, all);
      nameInput.value = "";
      toast(`📌 Preset "${name}" saved`);
      log(
        "info",
        `📌 Preset saved: "${name}" (${Object.keys(filtered).length} params)`,
      );
      await refreshList();
    } catch (e) {
      log("error", "Save preset gagal: " + e.message);
      toast("✖ " + e.message);
    }
  }

  async function applyPreset(preset) {
    if (!preset) return;
    const tabId = currentTabId();
    if (!tabId) {
      toast("⚠ Tidak ada tab aktif");
      return;
    }

    const merged = { ...currentValues(), ...preset.values };

    // 1. Update store
    store.dispatch({ type: "SET_PARAMS", payload: merged });
    // 2. Sync tab state
    tabManager?.updateActiveSilent({ paramValues: merged });
    // 3. Refresh UI panel (rebuild controls with new values, filter invalid)
    try {
      renderController?.refreshParams?.();
    } catch (e) {
      log("warn", "refreshParams gagal: " + e.message);
    }
    // 4. Persist + render
    renderController?.scheduleSave?.();
    renderController?.scheduleAutoRender?.(150);

    toast(`📌 Preset "${preset.name}" applied`);
    log("info", `📌 Preset applied: "${preset.name}"`);
    closePanel();
  }

  async function deletePreset(name) {
    const tabId = currentTabId();
    if (!tabId) return;
    if (!confirm(`Hapus preset "${name}"?`)) return;
    const all = await loadPresets(tabId);
    const next = all.filter((p) => p.name !== name);
    try {
      await savePresets(tabId, next);
      toast(`🗑 Preset "${name}" dihapus`);
      await refreshList();
    } catch (e) {
      log("error", "Delete preset gagal: " + e.message);
      toast("✖ " + e.message);
    }
  }

  /* ---------- Open / close ---------- */
  function openPanel() {
    if (isOpen) return;
    isOpen = true;
    panel.classList.remove("hidden");
    btn.classList.add("toggle-on");
    refreshList();
    requestAnimationFrame(positionPanel);
    setTimeout(() => nameInput.focus(), 50);
  }

  function closePanel() {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.add("hidden");
    btn.classList.remove("toggle-on");
  }

  function togglePanel() {
    isOpen ? closePanel() : openPanel();
  }

  /* ---------- Events ---------- */
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePanel();
  });

  panel.querySelector(".preset-x").addEventListener("click", closePanel);
  panel
    .querySelector("#presetSaveBtn")
    .addEventListener("click", saveCurrentPreset);

  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveCurrentPreset();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePanel();
    }
  });

  document.addEventListener("click", (e) => {
    if (!isOpen) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    closePanel();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) closePanel();
  });

  window.addEventListener("resize", () => {
    if (isOpen) positionPanel();
  });

  /* ---------- Public API ---------- */
  return {
    open: openPanel,
    close: closePanel,
    refresh: () => {
      if (isOpen) refreshList();
    },
    /** Call from tab-switch handler to reload presets when tab changes */
    refreshForTab: (tabId) => {
      if (isOpen && tabId === currentTabId()) refreshList();
    },
  };
}
