/* ============================================================
   WORKER CLIENT — main-thread wrapper
   PENTING: new Worker(new URL(...)) HARUS satu ekspresi
   supaya Vite bisa bundle worker di production build.
   ============================================================ */
import { CONFIG } from '../config.js';

export function createWorkerClient() {
    if (typeof Worker === 'undefined') {
        console.warn('[worker] Worker API tidak tersedia');
        return null;
    }

    let currentWorker = null;
    let currentId = 0;
    let pendingReject = null;

    function cancelPending(reason) {
        if (pendingReject) {
            const r = pendingReject;
            pendingReject = null;
            r({ name: 'CancelledError', message: reason || 'Cancelled', isScad: false });
        }
        if (currentWorker) {
            currentWorker.terminate();
            currentWorker = null;
        }
    }

    return {
        isReady: () => true,

        async run(code, paramValues, previewMode) {
            const id = ++currentId;
            cancelPending('Superseded by new render');

            return new Promise((resolve, reject) => {
                console.log('[worker] spawning worker for render', id);
                let worker;
                try {
                    /* ⬇⬇⬇ INLINE — jangan dipisah ke variabel */
                    worker = new Worker(
                        new URL('./eval-worker.js', import.meta.url),
                        { type: 'module' }
                    );
                } catch (e) {
                    console.error('[worker] constructor failed:', e);
                    reject({ name: 'WorkerInitError', message: e.message, line: 0, isScad: false });
                    return;
                }
                currentWorker = worker;
                pendingReject = reject;

                let settled = false;
                let sent = false;
                let watchdog = null;

                const startWatchdog = () => {
                    /* Watchdog harus lebih besar dari timeout internal worker
                       (maxTimeoutMs = 60s) + buffer untuk serialisasi + transfer */
                    const watchdogMs = CONFIG.maxTimeoutMs + 5000;   // 65s
                    watchdog = setTimeout(() => {
                        console.error(`[worker] WATCHDOG TIMEOUT — tidak ada balasan dalam ${watchdogMs}ms`);
                        finish();
                        reject({
                            name: 'WorkerTimeoutError',
                            message:
                                `Worker tidak membalas dalam ${Math.round(watchdogMs / 1000)} detik. ` +
                                `Kemungkinan: (1) render sangat berat dan $maxTime besar, ` +
                                `(2) worker hang karena bug, atau (3) browser freeze. ` +
                                `Coba Cancel (Esc) lalu render ulang dengan $fn lebih rendah.`,
                            line: 0,
                            isScad: false
                        });
                    }, watchdogMs);
                };
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    if (watchdog) clearTimeout(watchdog);
                    worker.terminate();
                    if (currentWorker === worker) currentWorker = null;
                    if (pendingReject === reject) pendingReject = null;
                };

                worker.onmessage = (e) => {
                    const msg = e.data || {};
                    if (msg.type === 'ready' && !sent) {
                        console.log('[worker] ready signal received, sending job');
                        sent = true;
                        startWatchdog();
                        worker.postMessage({ code, paramValues, previewMode });
                        return;
                    }
                    console.log('[worker] response for render', id, 'ok:', msg.ok);
                    if (id !== currentId) return;
                    finish();
                    if (msg.ok) resolve(msg);
                    else reject(msg.error || { name: 'Error', message: 'Unknown', line: 0 });
                };

                worker.onerror = (err) => {
                    console.error('[worker] onerror:', err.message || err.type, err.filename, 'line', err.lineno);
                    if (id !== currentId) return;
                    finish();
                    reject({
                        name: 'WorkerError',
                        message: (err.message || 'Worker runtime error') +
                            (err.filename ? ` (${err.filename}:${err.lineno})` : ''),
                        line: 0,
                        isScad: false
                    });
                };
            });
        },
        cancel() {
            cancelPending('User cancelled');
        },
        dispose() { cancelPending('Disposed'); },

    };
}