/**
 * Mobile UI Enhancements
 * - Fix Code/3D/Console tab bar
 * - "More" dropdown untuk tombol yang jarang dipakai di mobile
 */
export function initMobileUI(deps) {
  const { viewer } = deps;

  /* ============================================================
       1. Fix Code/3D/Console tab bar
       ============================================================ */
  const tabButtons = document.querySelectorAll("#tabbar button[data-tab]");
  const mainEl = document.getElementById("main");

  if (tabButtons.length > 0 && mainEl) {
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        tabButtons.forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
        mainEl.dataset.tab = btn.dataset.tab;

        // Force viewer resize setelah DOM update
        if (btn.dataset.tab === "3d") {
          viewer.scheduleResize?.() ?? setTimeout(() => viewer.resize(), 30);
        }
      });
    });
  }

  /* ============================================================
       2. Mobile "More" menu
       ============================================================ */
  setupMobileMore();
}

function setupMobileMore() {
  const topbarRight = document.getElementById("topbar-right");
  const topbarScroll = document.getElementById("topbar-scroll");
  const statusWrap = document.getElementById("statusWrap");
  if (!topbarRight || !topbarScroll) return;

  const MOVEABLE_IDS = [
    "btnFormat",
    "exportDropdown",
    "presetDropdown",
    "btnClear",
    "btnShare",
    "btnSaveProject",
    "btnPng",
    "btnGif",
    "btnFiles",
    "btnProfiler",
    "btnTheme",
    "btnFullscreen",
  ];

  // === Buat tombol More (⋮) ===
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.id = "btnMore";
  moreBtn.title = "Opsi lainnya";
  moreBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
  moreBtn.style.display = "none";
  if (statusWrap && statusWrap.parentNode === topbarRight) {
    topbarRight.insertBefore(moreBtn, statusWrap);
  } else {
    topbarRight.appendChild(moreBtn);
  }

  // === Buat panel More ===
  const panel = document.createElement("div");
  panel.id = "mobileMorePanel";
  panel.className = "hidden";
  panel.innerHTML = '<div class="mobile-more-title">Menu Lainnya</div>';
  document.body.appendChild(panel);

  let isOpen = false;

  function open() {
    if (isOpen) return;
    isOpen = true;
    panel.classList.remove("hidden");
    moreBtn.classList.add("toggle-on");
    const rect = moreBtn.getBoundingClientRect();
    panel.style.top = rect.bottom + 6 + "px";
    panel.style.right = window.innerWidth - rect.right + "px";
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.add("hidden");
    moreBtn.classList.remove("toggle-on");
  }

  // Tombol More: toggle buka/tutup
  moreBtn.addEventListener("click", () => {
    isOpen ? close() : open();
  });

  // Klik di luar panel → tutup
  document.addEventListener("click", (e) => {
    if (!isOpen) return;
    if (e.target === moreBtn) return;
    if (panel.contains(e.target)) return;
    close();
  });

  // Klik item di dropdown → tutup panel setelah dropdown handle selesai
  document.addEventListener(
    "click",
    (e) => {
      if (!isOpen) return;
      if (e.target.closest(".dd-item")) {
        setTimeout(close, 150);
      }
    },
    true,
  );

  // Klik tombol biasa (non-dropdown) di dalam panel → tutup panel
  panel.addEventListener("click", (e) => {
    // Jangan tutup jika user klik dropdown trigger atau item
    if (e.target.closest(".dd-trigger") || e.target.closest(".dd-menu")) return;
    // Tutup pada klik tombol biasa
    if (e.target.closest("button")) {
      setTimeout(close, 150);
    }
  });

  // Esc → tutup
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) close();
  });

  // === Pindah tombol in/out berdasarkan layar ===
  function updateLayout() {
    const isMobile = window.innerWidth <= 768;
    moreBtn.style.display = isMobile ? "inline-flex" : "none";
    if (!isMobile) close();

    for (const id of MOVEABLE_IDS) {
      const el = document.getElementById(id);
      if (!el) continue;

      if (isMobile) {
        if (!el.closest("#mobileMorePanel")) {
          const wrapper = document.createElement("div");
          wrapper.className = "mobile-more-item";
          wrapper.appendChild(el);
          panel.appendChild(wrapper);
        }
      } else {
        const wrapper = el.closest(".mobile-more-item");
        if (wrapper) {
          topbarScroll.appendChild(el);
          wrapper.remove();
        }
      }
    }
  }

  updateLayout();

  let resizeRaf = null;
  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      updateLayout();
    });
  });
}
