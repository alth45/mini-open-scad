import { state } from '../state.js';
import { toast } from '../ui/status.js';
import { createDropdown } from '../ui/dropdown.js'; // <-- IMPORT BARU

export function initViewerTools(viewer) {
    /* 1. Fullscreen */
    function setFullscreen(on) {
        const active = document.body.classList.contains('fullscreen-viewport');
        if (active === on) return;
        document.body.classList.toggle('fullscreen-viewport', on);
        document.getElementById('btnFullscreen')?.classList.toggle('toggle-on', on);
        setTimeout(() => viewer.resize(), 50);
    }
    window.toggleFullscreenViewport = () => setFullscreen(!document.body.classList.contains('fullscreen-viewport'));

    const topbarRight = document.getElementById('topbar-right');
    const right = document.getElementById('right');
    if (topbarRight && right) {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'btnFullscreen'; btn.title = 'Fullscreen viewport (F / Esc untuk keluar)';
        btn.innerHTML = '⛶';
        btn.addEventListener('click', window.toggleFullscreenViewport);
        topbarRight.insertBefore(btn, topbarRight.firstChild);

        const exitBtn = document.createElement('button');
        exitBtn.type = 'button'; exitBtn.id = 'fullscreenExit'; exitBtn.title = 'Exit fullscreen (Esc)';
        exitBtn.innerHTML = '✕';
        exitBtn.addEventListener('click', () => setFullscreen(false));
        right.appendChild(exitBtn);
    }

    /* 2. View Presets */
    const bar = document.createElement('div');
    bar.id = 'viewPresetBar';
    const VIEWS = [
        { id: 'iso', label: 'ISO' }, { id: 'front', label: 'FRT' }, { id: 'right', label: 'RGT' },
        { id: 'top', label: 'TOP' }, { id: 'back', label: 'BCK' }, { id: 'left', label: 'LFT' }, { id: 'bottom', label: 'BTM' },
    ];
    VIEWS.forEach(v => {
        const btn = document.createElement('button');
        btn.textContent = v.label; btn.title = v.id;
        btn.addEventListener('click', () => {
            viewer.setView(v.id);
            bar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setTimeout(() => btn.classList.remove('active'), 600);
        });
        bar.appendChild(btn);
    });
    const sep = document.createElement('span'); sep.className = 'view-preset-sep';
    bar.insertBefore(sep, bar.children[4]);
    viewer.container.appendChild(bar);

    /* 3. Dimensions */
    const overlay = document.getElementById('viewportOverlay');
    if (overlay) {
        const btn = document.createElement('button');
        btn.id = 'btnDimensions'; btn.title = 'Toggle dimension overlay'; btn.innerHTML = '<i class="fa-solid fa-ruler"></i>';
        btn.addEventListener('click', () => {
            const on = viewer.toggleDimensions();
            btn.classList.toggle('toggle-on', on);
            if (on && !viewer.hasModel()) toast('⚠ Render model dulu untuk melihat dimensi');
        });
        overlay.appendChild(btn);
    }

    /* 4. Section */
    let secSlider, secValue, secAxisBtns, secFlip, secPanel;
    function syncSec() { viewer.setSection(state.section); }
    function refreshSec() {
        if (!state.section.enabled || !secSlider) return;
        const b = viewer.getModelBounds(); if (!b) return;
        const min = b.min[state.section.axis], max = b.max[state.section.axis];
        const range = max - min, margin = Math.max(range * 0.05, 0.01);
        secSlider.min = (min - margin).toFixed(3); secSlider.max = (max + margin).toFixed(3);
        secSlider.step = Math.max(range / 1000, 0.001);
        let pos = state.section.position;
        if (pos < min - margin || pos > max + margin) { pos = (min + max) / 2; state.section.position = pos; syncSec(); }
        secSlider.value = pos; secValue.textContent = Number(pos).toFixed(2);
    }
    function setSecEnabled(on) {
        state.section.enabled = on;
        const btn = document.getElementById('btnSection');
        if (on) {
            const b = viewer.getModelBounds();
            state.section.position = b ? (b.min[state.section.axis] + b.max[state.section.axis]) / 2 : 0;
            secPanel.classList.remove('hidden'); btn?.classList.add('toggle-on'); refreshSec();
        } else { secPanel.classList.add('hidden'); btn?.classList.remove('toggle-on'); }
        syncSec();
    }
    function setSecAxis(axis) {
        state.section.axis = axis;
        secAxisBtns.forEach(b => b.classList.toggle('active', b.dataset.axis === axis));
        const b = viewer.getModelBounds();
        if (b) state.section.position = (b.min[axis] + b.max[axis]) / 2;
        refreshSec(); syncSec();
    }
    if (overlay) {
        const btn = document.createElement('button'); btn.id = 'btnSection'; btn.innerHTML = '<i class="fa-solid fa-scissors"></i>';
        btn.addEventListener('click', () => setSecEnabled(!state.section.enabled));
        overlay.appendChild(btn);
        secPanel = document.createElement('div'); secPanel.id = 'sectionPanel'; secPanel.className = 'hidden';
        secPanel.innerHTML = `
          <div class="section-head"><span>✂️ Section</span><button class="section-x" id="sectionClose">✕</button></div>
          <div class="section-body">
            <div class="section-row"><label>Axis</label><div class="section-axes"><button data-axis="x">X</button><button data-axis="y">Y</button><button data-axis="z">Z</button></div></div>
            <div class="section-row"><label>Position</label><input type="range" id="sectionSlider" min="-1" max="1" step="0.01" value="0"><span class="section-value" id="sectionValue">0.00</span></div>
            <div class="section-row"><button id="sectionFlip">⇅ Flip side</button></div>
          </div>`;
        document.getElementById('right').appendChild(secPanel);
        secSlider = secPanel.querySelector('#sectionSlider'); secValue = secPanel.querySelector('#sectionValue');
        secAxisBtns = [...secPanel.querySelectorAll('.section-axes button')]; secFlip = secPanel.querySelector('#sectionFlip');
        secAxisBtns.forEach(b => b.classList.toggle('active', b.dataset.axis === 'z'));
        secSlider.addEventListener('input', () => { state.section.position = parseFloat(secSlider.value); secValue.textContent = state.section.position.toFixed(2); syncSec(); });
        secAxisBtns.forEach(b => b.addEventListener('click', () => setSecAxis(b.dataset.axis)));
        secFlip.addEventListener('click', () => { state.section.flipped = !state.section.flipped; secFlip.classList.toggle('toggle-on', state.section.flipped); syncSec(); });
        secPanel.querySelector('#sectionClose').addEventListener('click', () => setSecEnabled(false));
    }

    /* 5. Measure */
    let mInfo, mBody, mMode = false;
    const snapModes = { vertex: true, edge: true, face: true };
    window._measureMode = false;
    
    function setMMode(on) {
        mMode = !!on; window._measureMode = mMode; viewer.setMeasureMode(mMode);
        document.getElementById('btnMeasure')?.classList.toggle('toggle-on', mMode);
        if (mMode) {
            mInfo.classList.remove('hidden'); updateMInfo({ reset: true });
            if (!viewer.hasModel()) toast('⚠ Render model dulu'); else toast('📐 Measure: klik 2 titik');
        } else mInfo.classList.add('hidden');
    }
    window.setMeasureMode = setMMode;

    function updateMInfo(data) {
        if (!mBody) return;
        if (data.reset) { mBody.innerHTML = `<div class="measure-hint">Klik <b>2 titik</b> di permukaan model.</div>`; return; }
        if (!data.complete) {
            const p = data.points[0];
            mBody.innerHTML = `<div class="measure-hint">Titik 1 terpasang.</div><div class="measure-coords"><div>P1 (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})</div></div>`;
            return;
        }
        const { distance, dx, dy, dz, points: [a, b] } = data;
        mBody.innerHTML = `
            <div class="measure-result">
              <div class="measure-dist"><span>Distance</span><strong>${distance.toFixed(2)}</strong></div>
              <div class="measure-deltas"><div><span>ΔX</span><span>${dx.toFixed(2)}</span></div><div><span>ΔY</span><span>${dy.toFixed(2)}</span></div><div><span>ΔZ</span><span>${dz.toFixed(2)}</span></div></div>
              <div class="measure-coords"><div>P1 (${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.z.toFixed(2)})</div><div>P2 (${b.x.toFixed(2)}, ${b.y.toFixed(2)}, ${b.z.toFixed(2)})</div></div>
            </div>`;
    }

    if (overlay) {
        const btn = document.createElement('button'); btn.id = 'btnMeasure'; btn.innerHTML = '📐';
        btn.addEventListener('click', () => setMMode(!mMode));
        overlay.appendChild(btn);
        mInfo = document.createElement('div'); mInfo.id = 'measureInfo'; mInfo.className = 'hidden';
        mInfo.innerHTML = `
            <div class="measure-snap-bar"><span class="measure-snap-label">Snap</span>
              <button data-snap="vertex" class="active">V</button><button data-snap="edge" class="active">E</button><button data-snap="face" class="active">F</button>
            </div><div id="measureBody"></div>`;
        document.getElementById('right').appendChild(mInfo);
        mBody = mInfo.querySelector('#measureBody');
        mInfo.querySelectorAll('.measure-snap-bar button').forEach(b => {
            b.addEventListener('click', () => { snapModes[b.dataset.snap] = !snapModes[b.dataset.snap]; b.classList.toggle('active', snapModes[b.dataset.snap]); viewer.setSnapModes(snapModes); });
        });
        viewer.setSnapModes(snapModes); viewer.onMeasure = updateMInfo;
    }

    if (overlay) {
        const ddContainer = document.createElement('div');
        ddContainer.id = 'lightingDropdown';
        ddContainer.className = 'dd-root';
        // Styling manual agar pas di dalam overlay
        ddContainer.style.marginLeft = '6px'; 
        ddContainer.style.display = 'inline-block';
        overlay.appendChild(ddContainer);

        createDropdown({
            container: ddContainer,
            placeholder: '💡 Default',
            icon: '',
            resetAfterSelect: false,
            items: [
                { value: 'default', label: '💡 Default', description: 'Cahaya dasar, cepat' },
                { value: 'studio', label: '📸 Studio', description: 'PBR + Soft Shadows' },
                { value: 'dramatic', label: '🎭 Dramatic', description: 'Kontras tinggi' },
            ],
            onSelect: (value) => {
                viewer.setLightingPreset(value);
                // Update label
                const labels = { default: '💡 Default', studio: '📸 Studio', dramatic: '🎭 Dramatic' };
                ddContainer.querySelector('.dd-label').textContent = labels[value];
                
                // Toggle shadow plane
                if (viewer.shadowPlane) {
                    viewer.shadowPlane.visible = (value !== 'default');
                }
            },
        });
    }
}