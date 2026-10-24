import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function disposeObject(obj) {
    if (!obj) return;
    obj.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
            else o.material.dispose();
        }
    });
}

export class Viewer {
    constructor(container) {
        this.container = container;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setClearColor(0x1e1e1e, 1);
        container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1e1e1e);

        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20000);
        this.camera.up.set(0, 0, 1);
        this.camera.position.set(60, -80, 55);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.09;
        this.controls.screenSpacePanning = true;
        this.controls.minDistance = 0.5;
        this.controls.maxDistance = 20000;

        this._setupLights();

        this.grid = new THREE.GridHelper(400, 40, 0x4a4a4a, 0x2e2e2e);
        this.grid.rotation.x = Math.PI / 2;
        this.grid.position.z = -0.01;
        this.scene.add(this.grid);

        this.modelRoot = new THREE.Group();
        this.scene.add(this.modelRoot);

        this._fpsEl = null;
        this._viewInfoEl = null;
        this._frames = 0;
        this._lastFpsT = performance.now();

        this._resizeObserver = new ResizeObserver(() => this.resize());
        this._resizeObserver.observe(container);
        window.addEventListener('resize', () => this.resize());
        this.resize();

        this.resetView();
        this._animate();
    }

    /** Optional DOM refs untuk info FPS / bbox. */
    setInfoElements(fpsEl, viewInfoEl) {
        this._fpsEl = fpsEl;
        this._viewInfoEl = viewInfoEl;
    }

    _setupLights() {
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a3a, 1.15));

        const dir1 = new THREE.DirectionalLight(0xffffff, 2.0);
        dir1.position.set(1, -1.4, 2.2);
        this.scene.add(dir1);

        const dir2 = new THREE.DirectionalLight(0xaaccff, 0.9);
        dir2.position.set(-1.6, 1.2, 0.6);
        this.scene.add(dir2);

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    }

    _animate() {
        const tick = () => {
            this._raf = requestAnimationFrame(tick);
            this.controls.update();
            this.renderer.render(this.scene, this.camera);

            this._frames++;
            const now = performance.now();
            if (now - this._lastFpsT >= 500 && this._fpsEl) {
                this._fpsEl.textContent =
                    Math.round((this._frames * 1000) / (now - this._lastFpsT)) + ' fps';
                this._frames = 0;
                this._lastFpsT = now;
            }
        };
        tick();
    }

    resize() {
        const w = this.container.clientWidth || 1;
        const h = this.container.clientHeight || 1;
        if (!w || !h) return;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    resetView() {
        this.camera.position.set(60, -80, 55);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    setModelRoot(newRoot) {
        this.scene.remove(this.modelRoot);
        disposeObject(this.modelRoot);
        this.modelRoot = newRoot;
        this.scene.add(this.modelRoot);
    }

    clearModel() {
        this.setModelRoot(new THREE.Group());
    }

    hasModel() {
        return this.modelRoot.children.length > 0;
    }

    fitToModel() {
        if (this.hasModel()) this.fitToObject(this.modelRoot);
        else this.resetView();
    }

    fitToObject(object) {
        const box = new THREE.Box3().setFromObject(object);
        if (box.isEmpty()) return;

        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        const fitHeight = maxDim / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
        const fitWidth = fitHeight / Math.max(this.camera.aspect, 0.0001);
        const dist = Math.max(fitHeight, fitWidth) * 2.15;

        const dir = new THREE.Vector3(0.85, -1.0, 0.72).normalize();
        this.camera.position.copy(center).addScaledVector(dir, dist);

        this.camera.near = Math.max(dist / 5000, 0.001);
        this.camera.far = dist * 200;
        this.camera.updateProjectionMatrix();

        this.controls.target.copy(center);
        this.controls.update();

        if (this._viewInfoEl) {
            this._viewInfoEl.textContent =
                `bbox ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)}`;
        }
    }

    toggleWireframe() {
        let w = false;
        this.modelRoot.traverse(o => {
            if (o.isMesh && o.material) {
                if (Array.isArray(o.material)) o.material.forEach(m => { m.wireframe = !m.wireframe; w = m.wireframe; });
                else { o.material.wireframe = !o.material.wireframe; w = o.material.wireframe; }
            }
        });
        return w;
    }

    toggleGrid() {
        this.grid.visible = !this.grid.visible;
        return this.grid.visible;
    }

    /* ============================================================
   Capture
   ============================================================ */

    /** PNG screenshot di resolusi = viewport × scale (cap 4096). */
    captureScreenshot(scale = 2) {
        const w = Math.min(Math.round(this.container.clientWidth * scale), 4096);
        const h = Math.min(Math.round(this.container.clientHeight * scale), 4096);
        if (w < 1 || h < 1) throw new Error('Viewport kosong');

        const offscreen = this._createOffscreen(w, h);
        const oldAspect = this.camera.aspect;
        const oldFov = this.camera.fov;

        this.camera.aspect = w / h;
        this.camera.fov = this._fovForAspect(oldFov, oldAspect, this.camera.aspect);
        this.camera.updateProjectionMatrix();

        try {
            offscreen.render(this.scene, this.camera);
            return offscreen.domElement.toDataURL('image/png');
        } finally {
            this.camera.aspect = oldAspect;
            this.camera.fov = oldFov;
            this.camera.updateProjectionMatrix();
            this._destroyOffscreen(offscreen);
        }
    }

    /**
     * Iterasi turntable: panggil onFrame(ImageData, index, total) untuk tiap frame.
     * Kamera diputar 360° mengelilingi sumbu Z (up), elevasi & jarak dipertahankan.
     *
     * @param {{frames?:number, size?:number, signal?:AbortSignal}} opts
     * @param {(imageData:ImageData, i:number, total:number)=>void|Promise<void>} onFrame
     */
    async iterateTurntable({ frames = 36, size = 480, signal } = {}, onFrame) {
        const w = Math.min(size, 2048);
        const h = w;

        const offscreen = this._createOffscreen(w, h);

        const oldAspect = this.camera.aspect;
        const oldFov = this.camera.fov;
        const savedPos = this.camera.position.clone();
        const target = this.controls.target.clone();
        const camRel = savedPos.clone().sub(target);

        this.camera.aspect = 1;
        this.camera.fov = this._fovForAspect(oldFov, oldAspect, 1);
        this.camera.updateProjectionMatrix();

        const canvas2D = document.createElement('canvas');
        canvas2D.width = w;
        canvas2D.height = h;
        const ctx2d = canvas2D.getContext('2d', { willReadFrequently: true });

        try {
            for (let i = 0; i < frames; i++) {
                if (signal?.aborted) throw new Error('Cancelled');

                const angle = (Math.PI * 2 * i) / frames;
                const c = Math.cos(angle);
                const s = Math.sin(angle);

                /* rotasi camRel terhadap sumbu Z */
                this.camera.position.set(
                    target.x + camRel.x * c - camRel.y * s,
                    target.y + camRel.x * s + camRel.y * c,
                    target.z + camRel.z
                );
                this.camera.lookAt(target);

                offscreen.render(this.scene, this.camera);
                ctx2d.clearRect(0, 0, w, h);
                ctx2d.drawImage(offscreen.domElement, 0, 0, w, h);
                const imageData = ctx2d.getImageData(0, 0, w, h);

                await onFrame(imageData, i, frames);
                await new Promise(r => setTimeout(r, 0));   // yield
            }
        } finally {
            this.camera.position.copy(savedPos);
            this.camera.aspect = oldAspect;
            this.camera.fov = oldFov;
            this.camera.updateProjectionMatrix();
            this.controls.target.copy(target);
            this.controls.update();
            this._destroyOffscreen(offscreen);
        }
    }

    /* --- internal --- */

    _createOffscreen(w, h) {
        const r = new THREE.WebGLRenderer({
            antialias: true,
            preserveDrawingBuffer: true,
            alpha: false
        });
        r.setPixelRatio(1);
        r.setSize(w, h, false);
        r.setClearColor(0x1e1e1e, 1);
        return r;
    }

    _destroyOffscreen(r) {
        r.dispose();
        if (typeof r.forceContextLoss === 'function') r.forceContextLoss();
        r.domElement.remove();
    }

    /** FOV vertikal baru agar horizontal FOV tetap sama saat aspect berubah. */
    _fovForAspect(oldFov, oldAspect, newAspect) {
        const oldVHalf = (oldFov * Math.PI) / 360;          // half vertical rad
        const tanNew = Math.tan(oldVHalf) * oldAspect / newAspect;
        return 2 * Math.atan(tanNew) * 180 / Math.PI;
    }
}