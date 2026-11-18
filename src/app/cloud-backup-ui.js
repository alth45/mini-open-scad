import {
  getBackupHistory,
  getAllBackupCount,
  restoreFromUrls,
  exportBackupBundle,
  importBackupBundle,
} from "../files/cloud-storage.js";
import { createTab } from "../tabs.js";
import { log } from "../ui/console.js";
import { toast } from "../ui/status.js";

export function initCloudBackupUI(deps) {
  const { tabManager, editor, saveNow, doRender } = deps;
  const topbarRight = document.getElementById("topbar-right");
  if (!topbarRight) return null;

  /* ---------- Tombol ---------- */
  const btn = document.createElement("button");
  btn.id = "btnCloudBackup";
  btn.title = "Cloudinary backup";
  btn.innerHTML = '☁ <span class="lbl">Backup</span>';
  const statusWrap = document.getElementById("statusWrap");
  topbarRight.insertBefore(btn, statusWrap);

  /* ---------- Panel ---------- */
  const panel = document.createElement("div");
  panel.id = "cloudBackupPanel";
  panel.className = "modal-backdrop hidden";
  panel.innerHTML = `
    <div class="modal" style="max-width:640px">
      <div class="modal-title">
        <span>☁ Cloudinary Backup</span>
        <button id="cloudClose" class="modal-x">✕</button>
      </div>
      <div class="modal-body">
        <div class="cloud-stats" id="cloudStats">—</div>
        <div class="cloud-actions">
          <button id="cloudBackupNow" class="primary">☁ Backup sekarang</button>
          <button id="cloudExport">📤 Export bundle</button>
          <button id="cloudImport">📥 Import bundle</button>
          <input type="file" id="cloudImportInput" accept=".json" hidden />
        </div>
        <div id="cloudList" class="cloud-list"></div>
       <div class="cloud-restore-url">
            <label>Restore dari URL Cloudinary (paste <code>.scad</code> URL):</label>
            <div style="display:flex;gap:6px">
                <input id="cloudRestoreUrl" type="text" placeholder="https://res.cloudinary.com/…/file.json" />
                <button id="cloudRestoreBtn">Restore</button>
            </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const $ = (s) => panel.querySelector(s);

  /* ---------- Render ---------- */
  function refresh() {
    const tab = tabManager?.active;
    const allCount = getAllBackupCount();
    $("#cloudStats").textContent = tab
      ? `Tab aktif: "${tab.name}" · Total backup di index: ${allCount}`
      : "Tidak ada tab aktif.";

    if (!tab) {
      $("#cloudList").innerHTML = "";
      return;
    }

    const history = getBackupHistory(tab.id);
    if (history.length === 0) {
      $("#cloudList").innerHTML =
        '<div class="cloud-empty">Belum ada backup untuk tab ini. Klik "Backup sekarang" atau edit kode (auto-backup 10s).</div>';
      return;
    }

    $("#cloudList").innerHTML = history
      .map((e, i) => {
        const badge = e.compressed
          ? ' <span class="cloud-badge" title="Compressed (gzip)">🗜️</span>'
          : "";
        const sizeStr = `${(e.size / 1024).toFixed(1)} KB`;
        return `
      <div class="cloud-item" data-idx="${i}">
        <div class="cloud-item-info">
          <div class="cloud-item-time">${new Date(e.timestamp).toLocaleString()}</div>
          <div class="cloud-item-meta">${sizeStr}${badge}</div>
        </div>
        <div class="cloud-item-actions">
          <button class="cloud-restore" data-idx="${i}">↺ Restore</button>
          <button class="cloud-copy" data-idx="${i}">📋 Copy URL</button>
        </div>
      </div>
    `;
      })
      .join("");

    // Wire actions
    panel.querySelectorAll(".cloud-restore").forEach((b) => {
      b.addEventListener("click", () => restoreEntry(history[+b.dataset.idx]));
    });
    panel.querySelectorAll(".cloud-copy").forEach((b) => {
      b.addEventListener("click", async () => {
        const e = history[+b.dataset.idx];
        const url = e.url || e.codeUrl; // ← format baru : format lama
        if (!url) {
          toast("⚠ URL tidak tersedia");
          return;
        }
        try {
          await navigator.clipboard.writeText(url);
          toast("📋 URL copied");
        } catch {
          toast("Copy gagal");
        }
      });
    });
  }

  async function restoreEntry(entry) {
    if (!confirm("Restore snapshot ini? Tab baru akan dibuat.")) return;
    try {
      // Format baru: entry.url · Format lama: {entry.codeUrl, entry.metaUrl}
      const params = entry.url
        ? { url: entry.url }
        : { codeUrl: entry.codeUrl, metaUrl: entry.metaUrl };
      const data = await restoreFromUrls(params);
      const tab = createTab(
        data.name,
        data.code,
        data.paramValues,
        data.autoRender,
      );
      tabManager.add(tab);
      saveNow?.();
      doRender?.();
      toast("✓ Restored ke tab baru");
      panel.classList.add("hidden");
    } catch (e) {
      log("error", "Restore gagal: " + e.message);
      toast("✖ " + e.message);
    }
  }

  /* ---------- Events ---------- */
  btn.addEventListener("click", () => {
    panel.classList.remove("hidden");
    refresh();
  });
  $("#cloudClose").addEventListener("click", () =>
    panel.classList.add("hidden"),
  );
  panel.addEventListener("click", (e) => {
    if (e.target === panel) panel.classList.add("hidden");
  });

  $("#cloudBackupNow").addEventListener("click", async () => {
    const tab = tabManager?.active;
    if (!tab) return;
    try {
      toast("⏳ Uploading…");
      const { backupTab } = await import("../files/cloud-storage.js");
      const entry = await backupTab(tab);
      log("ok", `☁ Backup: ${(entry.size / 1024).toFixed(1)} KB`);
      toast("☁ Backup uploaded");
      refresh();
    } catch (e) {
      log("error", "Backup gagal: " + e.message);
      toast("✖ " + e.message);
    }
  });

  $("#cloudExport").addEventListener("click", () => {
    exportBackupBundle();
    toast("📤 Bundle exported");
  });
  $("#cloudImport").addEventListener("click", () =>
    $("#cloudImportInput").click(),
  );
  $("#cloudImportInput").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const txt = await f.text();
      const { merged, totalTabs } = importBackupBundle(txt);
      toast(`📥 Merged ${merged} entries dari ${totalTabs} tab`);
      refresh();
    } catch (err) {
      toast("✖ " + err.message);
    }
  });

  $("#cloudRestoreBtn").addEventListener("click", async () => {
    const url = $("#cloudRestoreUrl").value.trim();
    if (!url) return;
    try {
      toast("⏳ Fetching…");
      // Auto-detect: URL baru (.json gabungan) atau lama (.scad plain)
      const data = await restoreFromUrls({ url });
      const tab = createTab(
        data.name,
        data.code,
        data.paramValues,
        data.autoRender,
      );
      tabManager.add(tab);
      saveNow?.();
      doRender?.();
      toast("✓ Restored");
      $("#cloudRestoreUrl").value = "";
      panel.classList.add("hidden");
    } catch (e) {
      toast("✖ " + e.message);
    }
  });

  return {
    open: () => {
      panel.classList.remove("hidden");
      refresh();
    },
  };
}
