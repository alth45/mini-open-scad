/**
 * PWA Integration
 * - Service worker registration + update prompt
 * - Custom "Install App" button
 * - Offline indicator
 */
import { registerSW } from "virtual:pwa-register";

const INSTALL_DISMISSED_KEY = "pwa-install-dismissed";

export function initPWA(deps) {
  const { toast, log } = deps;

  /* ============================================================
     1. Service Worker Registration
     ============================================================ */
  let updateSW = null;
  try {
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        showUpdateBanner();
      },
      onOfflineReady() {
        toast("📦 Aplikasi siap diakses offline");
        log("info", "PWA: app cached, offline-ready");
      },
      onRegisteredSW(swUrl, registration) {
        log(
          "info",
          `PWA: service worker registered — ${swUrl.split("/").pop()}`,
        );
        // Cek update setiap jam
        if (registration) {
          setInterval(() => registration.update(), 60 * 60 * 1000);
        }
      },
      onRegisterError(err) {
        console.warn("[pwa] SW registration failed:", err);
      },
    });
  } catch (e) {
    console.warn("[pwa] registerSW unavailable (dev mode?):", e);
  }

  /* ============================================================
     2. Install Prompt
     ============================================================ */
  let deferredInstallPrompt = null;
  let installBtnEl = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!localStorage.getItem(INSTALL_DISMISSED_KEY)) {
      showInstallButton();
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    hideInstallButton();
    toast("✅ Mini OpenSCAD terinstall");
    log("info", "PWA: app installed");
  });

  function showInstallButton() {
    if (installBtnEl) return;
    const overlay = document.getElementById("viewportOverlay");
    if (!overlay) return;

    installBtnEl = document.createElement("button");
    installBtnEl.type = "button";
    installBtnEl.id = "btnInstall";
    installBtnEl.title = "Install Mini OpenSCAD ke device";
    installBtnEl.innerHTML = "📲 Install";
    installBtnEl.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome !== "accepted") {
        localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
      }
      deferredInstallPrompt = null;
      hideInstallButton();
    });
    overlay.appendChild(installBtnEl);
  }

  function hideInstallButton() {
    if (installBtnEl) {
      installBtnEl.remove();
      installBtnEl = null;
    }
  }

  /* ============================================================
     3. Update Banner
     ============================================================ */
  function showUpdateBanner() {
    if (document.getElementById("pwaUpdateBanner")) return;

    const banner = document.createElement("div");
    banner.id = "pwaUpdateBanner";
    banner.innerHTML = `
      <span>🎉 Versi baru tersedia!</span>
      <button id="pwaUpdateBtn" class="primary">Reload</button>
      <button id="pwaUpdateClose" title="Nanti saja">✕</button>
    `;
    document.body.appendChild(banner);

    banner.querySelector("#pwaUpdateBtn").addEventListener("click", () => {
      if (updateSW) updateSW(true); // true = reload setelah update
    });
    banner.querySelector("#pwaUpdateClose").addEventListener("click", () => {
      banner.remove();
      // Update akan terpasang otomatis saat user buka app berikutnya
    });
  }

  /* ============================================================
     4. Offline Indicator
     ============================================================ */
  window.addEventListener("offline", () => {
    toast("📴 Offline — aplikasi masih bisa dipakai");
  });
  window.addEventListener("online", () => {
    log("info", "🌐 Kembali online");
  });

  log("info", "PWA: module initialized");
}
