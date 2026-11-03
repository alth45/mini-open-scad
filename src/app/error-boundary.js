/**
 * Global Error Boundary
 * Menangkap semua error yang tidak tertangani di level aplikasi.
 */
export function initErrorBoundary(deps) {
  const { log, toast, setStatus, formatError, getEditorCode } = deps;

  // 1. Tangkap Error Sinkron (window.onerror)
  window.addEventListener("error", (event) => {
    const err = event.error || new Error(event.message);

    // Abaikan error internal yang memang normal (misal: pembatalan render)
    if (err && (err.name === "CancelledError" || err.message === "Cancelled"))
      return;

    const code = getEditorCode ? getEditorCode() : "";
    log("error", "✖ Runtime Error: " + formatError(err, code));
    toast("✖ Terjadi kesalahan sistem. Cek console.");
  });

  // 2. Tangkap Promise Rejection (unhandledrejection)
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const code = getEditorCode ? getEditorCode() : "";

    // A. Pembatalan (Esc / Render ulang) -> Abaikan dengan tenang
    if (
      reason &&
      (reason.name === "CancelledError" || reason.message === "Cancelled")
    ) {
      event.preventDefault(); // Cegah log di console browser
      return;
    }

    // B. Worker Timeout -> Update Status UI + Beri tahu user
    if (reason && reason.name === "WorkerTimeoutError") {
      setStatus("error", "Timeout", false);
      log("error", "⏱ " + formatError(reason, code));
      toast("⏱ Render memakan waktu terlalu lama. Batalkan?");
      event.preventDefault();
      return;
    }

    // C. Error lainnya (Bug, WorkerInitError, dll)
    log("error", "✖ Unhandled Promise: " + formatError(reason, code));
    toast("✖ Terjadi kesalahan sistem. Cek console.");
  });
}
