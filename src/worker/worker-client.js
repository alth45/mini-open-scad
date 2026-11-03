import { TIME_BUDGET } from "../config.js";

export function createWorkerClient() {
  if (typeof Worker === "undefined") return null;

  let worker = null;
  let isReady = false;
  let currentRequestId = 0;
  const pending = new Map(); // requestId -> { resolve, reject, timeoutId, settled }

  function initWorker() {
    if (worker) return;
    worker = new Worker(new URL("./eval-worker.js", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === "ready") {
        isReady = true;
        return;
      }

      if (msg.type === "done" || msg.type === "error") {
        const p = pending.get(msg.requestId);
        if (!p) return;
        pending.delete(msg.requestId);
        clearTimeout(p.timeoutId);

        if (msg.type === "done") p.resolve(msg);
        else p.reject(msg.error);
      }
    };

    worker.onerror = (err) => {
      console.error("[worker] onerror:", err);
      for (const [, p] of pending) {
        clearTimeout(p.timeoutId);
        p.reject({
          name: "WorkerError",
          message: err.message || "Worker error",
          isScad: false,
        });
      }
      pending.clear();
      worker.terminate();
      worker = null;
      isReady = false;
    };
  }

  return {
    isReady: () => isReady,

    async run(code, paramValues, previewMode) {
      initWorker();

      if (!isReady) {
        await new Promise((resolve, reject) => {
          const start = performance.now();
          const check = setInterval(() => {
            if (isReady) {
              clearInterval(check);
              resolve();
            } else if (performance.now() - start > 10000) {
              clearInterval(check);
              reject(new Error("Worker init timeout"));
            }
          }, 50);
        });
      }

      const requestId = ++currentRequestId;

      // Batalkan request yang sedang berjalan (jika ada)
      for (const [id] of pending) {
        worker.postMessage({ type: "cancel", requestId: id });
      }

      return new Promise((resolve, reject) => {
        const watchdogMs =
          TIME_BUDGET.evalHardCapMs + TIME_BUDGET.watchdogGraceMs;
        const timeoutId = setTimeout(() => {
          pending.delete(requestId);
          worker.postMessage({ type: "cancel", requestId });
          reject({
            name: "WorkerTimeoutError",
            message: `Timeout ${Math.round(watchdogMs / 1000)}s`,
            line: 0,
            isScad: false,
          });
        }, watchdogMs);

        pending.set(requestId, { resolve, reject, timeoutId });
        worker.postMessage({
          type: "render",
          requestId,
          code,
          paramValues,
          previewMode,
        });
      });
    },

    cancel() {
      if (!worker) return;
      const requestId = currentRequestId;
      if (pending.has(requestId)) {
        worker.postMessage({ type: "cancel", requestId });
        const p = pending.get(requestId);
        clearTimeout(p.timeoutId);
        p.reject({
          name: "CancelledError",
          message: "Cancelled",
          isScad: false,
        });
        pending.delete(requestId);
      }
    },

    dispose() {
      if (worker) {
        worker.terminate();
        worker = null;
        isReady = false;
      }
    },
  };
}
