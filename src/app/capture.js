import { createGifEncoder } from '../gif.js';
import { downloadDataUrl, downloadBlob, timestampForFile } from '../utils.js';
import { log } from '../ui/console.js';
import { toast } from '../ui/status.js';

export function initCapture(deps) {
    const { viewer, editor, paramsPanel, state, doRender, parseParams } = deps;

    /* ============================================================
       1. Screenshot PNG
       ============================================================ */
    document.getElementById('btnPng').addEventListener('click', () => {
        try {
            const dataUrl = viewer.captureScreenshot(2);
            downloadDataUrl(dataUrl, `screenshot-${timestampForFile()}.png`);
            toast('📷 PNG saved');
        } catch (e) {
            log('error', 'Screenshot gagal: ' + e.message);
            toast('✖ Screenshot gagal');
        }
    });

    /* ============================================================
       2. Turntable GIF
       ============================================================ */
    const gifModal = document.getElementById('gifModal');
    const gifDelay = document.getElementById('gifDelay');
    const gifDelayLbl = document.getElementById('gifDelayLabel');
    const gifProgressWrap = document.getElementById('gifProgressWrap');
    const gifProgressFill = document.getElementById('gifProgressFill');
    const gifStatus = document.getElementById('gifStatus');
    const gifStart = document.getElementById('gifStart');
    const gifCancel = document.getElementById('gifCancel');
    let gifController = null;

    gifDelay.addEventListener('input', () => {
        gifDelayLbl.textContent = gifDelay.value + 'ms';
    });

    document.getElementById('btnGif').addEventListener('click', () => {
        gifModal.classList.remove('hidden');
        gifProgressWrap.classList.add('hidden');
        gifProgressFill.style.width = '0%';
        gifStatus.textContent = 'Preparing…';
        gifStart.disabled = false;
        gifCancel.disabled = true;
    });

    document.getElementById('gifClose').addEventListener('click', () => {
        if (gifController) gifController.abort();
        gifModal.classList.add('hidden');
    });

    gifModal.addEventListener('click', (e) => {
        if (e.target === gifModal) {
            if (gifController) gifController.abort();
            gifModal.classList.add('hidden');
        }
    });

    gifStart.addEventListener('click', async () => {
        if (!viewer.hasModel()) {
            toast('⚠ Render model dulu');
            return;
        }

        const qualityEl = document.querySelector('input[name="gifQuality"]:checked');
        const quality = qualityEl?.value || 'medium';
        const qualityMap = {
            small: { frames: 24, size: 320 },
            medium: { frames: 36, size: 480 },
            large: { frames: 60, size: 640 }
        };
        const { frames, size } = qualityMap[quality];
        const delay = parseInt(gifDelay.value, 10) || 50;

        gifStart.disabled = true;
        gifCancel.disabled = false;
        gifProgressWrap.classList.remove('hidden');
        gifProgressFill.style.width = '0%';
        gifStatus.textContent = `Rendering 0 / ${frames}…`;

        gifController = new AbortController();
        const controller = gifController;

        try {
            const gif = createGifEncoder();

            await viewer.iterateTurntable(
                { frames, size, signal: controller.signal },
                (imageData, i, total) => {
                    gif.addFrame(imageData, { delay });
                    const pct = ((i + 1) / total) * 90;
                    gifProgressFill.style.width = pct + '%';
                    gifStatus.textContent = `Rendering ${i + 1} / ${total}…`;
                }
            );

            gifStatus.textContent = 'Encoding GIF…';
            gifProgressFill.style.width = '95%';
            await new Promise(r => setTimeout(r, 20));

            const bytes = gif.finish();
            const blob = new Blob([bytes], { type: 'image/gif' });
            downloadBlob(blob, `turntable-${timestampForFile()}.gif`);

            gifProgressFill.style.width = '100%';
            gifStatus.textContent = `Done · ${(blob.size / 1024).toFixed(0)} KB`;
            log('ok', `GIF saved: ${(blob.size / 1024).toFixed(0)} KB, ${frames} frames`);
            toast('🎞 GIF saved');

            setTimeout(() => gifModal.classList.add('hidden'), 800);
        } catch (e) {
            if (e.message === 'Cancelled') {
                gifStatus.textContent = 'Cancelled';
                toast('Cancelled');
            } else {
                console.error('[gif]', e);
                gifStatus.textContent = 'Error: ' + e.message;
                log('error', 'GIF gagal: ' + e.message);
                toast('✖ GIF gagal');
            }
        } finally {
            gifController = null;
            gifStart.disabled = false;
            gifCancel.disabled = true;
        }
    });

    gifCancel.addEventListener('click', () => {
        if (gifController) {
            gifController.abort();
            gifStatus.textContent = 'Cancelling…';
        }
    });


    /* ============================================================
       3. Param Animation (Live Preview + GIF)
       ============================================================ */
    const animation = {
        active: false,
        mode: null,          // 'preview' | 'gif'
        paramName: null,
        min: 0,
        max: 1,
        frames: 36,
        delay: 50,
        abort: false,
        originalValue: null,
        gif: null,
        offscreen: null,
    };

    let animModal, animParamSelect, animDelay, animDelayLabel,
        animPlay, animExport, animCancel, animClose, animStop,
        animProgressWrap, animProgressFill, animStatus,
        animEmpty, animForm;

    function openAnimModal() {
        if (animation.active) return;

        const params = parseParams(editor.getValue()).filter(p => p.type === 'slider');

        animParamSelect.innerHTML = '';
        if (params.length === 0) {
            animEmpty.classList.remove('hidden');
            animForm.classList.add('hidden');
            animExport.disabled = true;
            animPlay.disabled = true;
        } else {
            animEmpty.classList.add('hidden');
            animForm.classList.remove('hidden');
            animExport.disabled = false;
            animPlay.disabled = false;
            for (const p of params) {
                const o = document.createElement('option');
                o.value = p.name;
                o.textContent = `${p.label || p.name}  (${p.min}–${p.max})`;
                animParamSelect.appendChild(o);
            }
        }

        animProgressWrap.classList.add('hidden');
        animProgressFill.style.width = '0%';
        animStatus.textContent = '';
        animModal.classList.remove('hidden');
    }

    async function runAnimationFrameLoop(mode, onFrameProgress) {
        const params = parseParams(editor.getValue());
        const param = params.find(p => p.name === animation.paramName);
        if (!param || param.type !== 'slider') {
            throw new Error(`Parameter '${animation.paramName}' tidak ditemukan atau bukan slider`);
        }
        animation.min = param.min;
        animation.max = param.max;

        for (let i = 0; i < animation.frames; i++) {
            if (animation.abort) break;

            /* ping-pong via cosine — loop mulus tanpa lompatan */
            const t = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / animation.frames);
            const value = animation.min + (animation.max - animation.min) * t;

            state.paramValues[animation.paramName] = value;
            paramsPanel.setValue(animation.paramName, value);

            await doRender({
                skipParams: true,
                skipFit: true,
                quiet: true,
                throwOnError: true,
            });

            if (mode === 'gif') {
                const imageData = viewer.captureImageData(480, animation.offscreen);
                animation.gif.addFrame(imageData, { delay: animation.delay });
            }

            onFrameProgress?.(i + 1, animation.frames);

            if (mode === 'preview') {
                await new Promise(r => setTimeout(r, animation.delay));
            }
        }
    }

    async function startPreviewAnimation() {
        if (animation.active) return;
        const paramName = animParamSelect.value;
        if (!paramName) { toast('⚠ Pilih parameter dulu'); return; }
        if (!viewer.hasModel()) { toast('⚠ Render model dulu'); return; }

        const framesEl = document.querySelector('input[name="animFrames"]:checked');
        animation.frames = parseInt(framesEl?.value || '36', 10);
        animation.delay = parseInt(animDelay.value, 10);
        animation.active = true;
        animation.mode = 'preview';
        animation.abort = false;
        animation.paramName = paramName;
        animation.originalValue = state.paramValues[paramName];

        document.body.classList.add('is-animating');
        animModal.classList.add('hidden');
        animStop.classList.remove('hidden');

        try {
            await runAnimationFrameLoop('preview');
        } catch (e) {
            if (!animation.abort) {
                log('error', 'Animasi gagal: ' + e.message);
                toast('✖ ' + e.message);
            }
        } finally {
            if (animation.originalValue !== null && animation.originalValue !== undefined) {
                state.paramValues[paramName] = animation.originalValue;
                paramsPanel.setValue(paramName, animation.originalValue);
                try { await doRender({ quiet: true, throwOnError: false }); } catch {}
            }
            animation.active = false;
            animation.mode = null;
            animStop.classList.add('hidden');
            document.body.classList.remove('is-animating');
        }
    }

    async function startGifExport() {
        if (animation.active) return;
        const paramName = animParamSelect.value;
        if (!paramName) { toast('⚠ Pilih parameter dulu'); return; }
        if (!viewer.hasModel()) { toast('⚠ Render model dulu'); return; }

        const framesEl = document.querySelector('input[name="animFrames"]:checked');
        animation.frames = parseInt(framesEl?.value || '36', 10);
        animation.delay = parseInt(animDelay.value, 10);
        animation.active = true;
        animation.mode = 'gif';
        animation.abort = false;
        animation.paramName = paramName;
        animation.originalValue = state.paramValues[paramName];
        animation.gif = createGifEncoder();
        animation.offscreen = viewer._createOffscreen(480, 480);

        document.body.classList.add('is-animating');
        animExport.disabled = true;
        animPlay.disabled = true;
        animCancel.disabled = false;
        animProgressWrap.classList.remove('hidden');
        animProgressFill.style.width = '0%';
        animStatus.textContent = `Rendering 0 / ${animation.frames}…`;

        try {
            await runAnimationFrameLoop('gif', (i, total) => {
                animProgressFill.style.width = ((i / total) * 90) + '%';
                animStatus.textContent = `Rendering ${i} / ${total}…`;
            });

            if (animation.abort) {
                animStatus.textContent = 'Cancelled';
                toast('Cancelled');
                return;
            }

            animStatus.textContent = 'Encoding GIF…';
            animProgressFill.style.width = '95%';
            await new Promise(r => setTimeout(r, 20));

            const bytes = animation.gif.finish();
            const blob = new Blob([bytes], { type: 'image/gif' });
            downloadBlob(blob, `anim-${timestampForFile()}.gif`);

            animProgressFill.style.width = '100%';
            animStatus.textContent = `Done · ${(blob.size / 1024).toFixed(0)} KB`;
            log('ok', `Anim GIF saved: ${(blob.size / 1024).toFixed(0)} KB, ${animation.frames} frames`);
            toast('🎬 GIF saved');
        } catch (e) {
            console.error('[anim]', e);
            animStatus.textContent = 'Error: ' + e.message;
            log('error', 'GIF gagal: ' + e.message);
            toast('✖ GIF gagal');
        } finally {
            if (animation.originalValue !== null && animation.originalValue !== undefined) {
                state.paramValues[paramName] = animation.originalValue;
                paramsPanel.setValue(paramName, animation.originalValue);
                try { await doRender({ quiet: true, throwOnError: false }); } catch {}
            }
            if (animation.offscreen) {
                viewer._destroyOffscreen(animation.offscreen);
                animation.offscreen = null;
            }
            animation.active = false;
            animation.mode = null;
            animation.gif = null;
            document.body.classList.remove('is-animating');
            animExport.disabled = false;
            animPlay.disabled = false;
            animCancel.disabled = true;
        }
    }

    /* ---- setup UI (modal + stop button + toggle button) ---- */
    (function setupAnimUI() {
        animModal = document.createElement('div');
        animModal.id = 'animModal';
        animModal.className = 'modal-backdrop hidden';
        animModal.innerHTML = `
          <div class="modal" style="max-width:520px">
            <div class="modal-title">
              <span>🎬 Param Animation</span>
              <button class="modal-x" id="animClose">✕</button>
            </div>
            <div class="modal-body">
              <div id="animEmpty" class="anim-empty hidden">
                Tidak ada parameter slider.<br>
                Tambahkan di kode:<br>
                <code>// @param size {slider 10 60 30} Size</code>
              </div>
              <div id="animForm">
                <div class="anim-row">
                  <label>Parameter</label>
                  <select id="animParam"></select>
                </div>
                <div class="anim-row">
                  <label>Frames</label>
                  <div class="anim-radio-group">
                    <label><input type="radio" name="animFrames" value="24"> 24</label>
                    <label><input type="radio" name="animFrames" value="36" checked> 36</label>
                    <label><input type="radio" name="animFrames" value="48"> 48</label>
                    <label><input type="radio" name="animFrames" value="60"> 60</label>
                  </div>
                </div>
                <div class="anim-row">
                  <label>Delay</label>
                  <div class="anim-slider-wrap">
                    <input type="range" id="animDelay" min="20" max="200" step="10" value="50">
                    <span id="animDelayLabel">50 ms</span>
                  </div>
                </div>
                <div class="anim-row" style="padding-top:6px">
                  <label></label>
                  <button class="primary" id="animPlay" style="flex:1 1 auto">▶ Play preview</button>
                </div>
              </div>
              <div id="animProgressWrap" class="anim-progress-wrap hidden">
                <div class="anim-progress-bar"><div class="anim-progress-fill" id="animProgressFill"></div></div>
                <div class="anim-status" id="animStatus"></div>
              </div>
            </div>
            <div class="modal-footer">
              <button id="animCancel" disabled>Cancel</button>
              <button class="primary" id="animExport">⬇ Export GIF</button>
            </div>
          </div>
        `;
        document.body.appendChild(animModal);

        animParamSelect     = animModal.querySelector('#animParam');
        animDelay           = animModal.querySelector('#animDelay');
        animDelayLabel      = animModal.querySelector('#animDelayLabel');
        animPlay            = animModal.querySelector('#animPlay');
        animExport          = animModal.querySelector('#animExport');
        animCancel          = animModal.querySelector('#animCancel');
        animClose           = animModal.querySelector('#animClose');
        animProgressWrap    = animModal.querySelector('#animProgressWrap');
        animProgressFill    = animModal.querySelector('#animProgressFill');
        animStatus          = animModal.querySelector('#animStatus');
        animEmpty           = animModal.querySelector('#animEmpty');
        animForm            = animModal.querySelector('#animForm');

        animStop = document.createElement('button');
        animStop.id = 'animStop';
        animStop.className = 'hidden';
        animStop.textContent = '■ Stop (Esc)';
        document.getElementById('right').appendChild(animStop);

        const overlay = document.getElementById('viewportOverlay');
        if (overlay) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'btnAnim';
            btn.title = 'Param animation (live preview + GIF export)';
            btn.innerHTML = '🎬';
            btn.addEventListener('click', openAnimModal);
            overlay.appendChild(btn);
        }

        animClose.addEventListener('click', () => animModal.classList.add('hidden'));
        animModal.addEventListener('click', (e) => {
            if (e.target === animModal) animModal.classList.add('hidden');
        });
        animDelay.addEventListener('input', () => {
            animDelayLabel.textContent = animDelay.value + ' ms';
        });
        animPlay.addEventListener('click', startPreviewAnimation);
        animExport.addEventListener('click', startGifExport);
        animCancel.addEventListener('click', () => {
            animation.abort = true;
            animStatus.textContent = 'Cancelling…';
        });
        animStop.addEventListener('click', () => { animation.abort = true; });
    })();

    return { animation };
}