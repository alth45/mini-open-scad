import { encodeShareTab, buildShareUrl } from "../share.js";
import { log } from "../ui/console.js";
import { toast } from "../ui/status.js";

export function initShareUI(deps) {
  const { tabManager } = deps;
  const shareModal = document.getElementById("shareModal");

  document.getElementById("btnShare").addEventListener("click", async () => {
    const tab = tabManager.active;
    if (!tab) return;
    try {
      const hash = await encodeShareTab(tab);
      const url = buildShareUrl(hash);
      const shareUrlEl = document.getElementById("shareUrl");
      shareUrlEl.value = url;
      shareUrlEl.dataset.url = url;
      document.getElementById("shareLen").textContent = url.length;
      document
        .getElementById("shareWarn")
        .classList.toggle("hidden", url.length <= 8000);
      shareModal.classList.remove("hidden");
      shareUrlEl.focus();
      shareUrlEl.select();
    } catch (e) {
      log("error", "Gagal membuat share URL: " + e.message);
      toast("✖ Share gagal");
    }
  });
  document
    .getElementById("shareClose")
    .addEventListener("click", () => shareModal.classList.add("hidden"));
  document.getElementById("shareCopy").addEventListener("click", async () => {
    const el = document.getElementById("shareUrl");
    try {
      await navigator.clipboard.writeText(el.dataset.url || el.value);
      toast("📋 URL copied");
    } catch {
      el.select();
      document.execCommand("copy");
      toast("📋 URL copied");
    }
  });
  document.getElementById("shareOpen").addEventListener("click", () => {
    const el = document.getElementById("shareUrl");
    window.open(el.dataset.url || el.value, "_blank", "noopener");
  });
}
