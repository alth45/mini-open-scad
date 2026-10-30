import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function disposeObject(obj) {
    if (!obj) return;
    obj.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
                if (m.map) m.map.dispose();   // ← dispose CanvasTexture di sprite
                m.dispose();
            }
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
        this._dimensionVisible = false;
        this._dimensionGroup = null;
        this._section = { enabled: false, axis: 'z', position: 0, flipped: false };
        this._sectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        this._sectionBounds = null;
        this._sectionIndicator = null;
        this.renderer.localClippingEnabled = true;   // ← wajib untuk per-material clipping
        this._frames = 0;
        this._lastFpsT = performance.now();

        this._resizeObserver = new ResizeObserver(() => this.resize());
        this._resizeObserver.observe(container);
        window.addEventListener('resize', () => this.resize());
        this.resize();

        this.currentDirection = new THREE.Vector3(0.85, -1.0, 0.72).normalize();
        this.currentUp = new THREE.Vector3(0, 0, 1);

        this.controls.addEventListener('end', () => {
            const offset = this.camera.position.clone().sub(this.controls.target);
            if (offset.lengthSq() > 1e-6) {
                this.currentDirection.copy(offset).normalize();
                this.currentUp.copy(this.camera.up);
            }
        });

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
        this.currentUp.set(0, 0, 1);
        this.currentDirection.set(0.85, -1.0, 0.72).normalize();
        this.camera.up.copy(this.currentUp);
        this.camera.position.set(60, -80, 55);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    setModelRoot(newRoot) {
        this.scene.remove(this.modelRoot);
        disposeObject(this.modelRoot);
        this.modelRoot = newRoot;
        this.scene.add(this.modelRoot);
        this.refreshSectionBounds();              // ← cache bbox baru
        this._applySectionToModel();              // ← material baru, apply clipping
        this._updateSectionIndicator();           // ← indicator ikut bbox baru
        this._refreshDimensionOverlay();
    }

    clearModel() {
        this.setModelRoot(new THREE.Group());
    }

    hasModel() {
        return this.modelRoot.children.length > 0;
    }

    fitToModel() {
        this.setView('iso');
    }

    /* ============================================================
   Dimension overlay (bbox wireframe + dimension lines)
   ============================================================ */

    toggleDimensions() {
        this._dimensionVisible = !this._dimensionVisible;
        this._refreshDimensionOverlay();
        return this._dimensionVisible;
    }

    hasDimensions() {
        return this._dimensionVisible;
    }

    _refreshDimensionOverlay() {
        this._disposeDimensionGroup();
        if (!this._dimensionVisible || !this.hasModel()) return;

        this.modelRoot.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(this.modelRoot);
        if (box.isEmpty()) return;

        this._createDimensionOverlay(box);
    }

    _disposeDimensionGroup() {
        if (this._dimensionGroup) {
            this.scene.remove(this._dimensionGroup);
            disposeObject(this._dimensionGroup);
            this._dimensionGroup = null;
        }
    }

        /* ============================================================
    Section / clipping plane
    ============================================================ */

    refreshSectionBounds() {
        if (!this.hasModel()) { this._sectionBounds = null; return null; }
        this.modelRoot.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(this.modelRoot);
        this._sectionBounds = box.isEmpty() ? null : box;
        return this._sectionBounds;
    }

    getModelBounds() { return this._sectionBounds; }

    setSection({ enabled, axis, position, flipped }) {
        if (enabled !== undefined) this._section.enabled = !!enabled;
        if (axis !== undefined) this._section.axis = axis;
        if (position !== undefined) this._section.position = Number(position) || 0;
        if (flipped !== undefined) this._section.flipped = !!flipped;

        this._updateSectionPlane();
        this._applySectionToModel();
        this._updateSectionIndicator();
    }

    _updateSectionPlane() {
        const { axis, position, flipped } = this._section;
        const sign = flipped ? -1 : 1;
        const n = this._sectionPlane.normal;
        if (axis === 'x')      { n.set(sign, 0, 0); }
        else if (axis === 'y') { n.set(0, sign, 0); }
        else                   { n.set(0, 0, sign); }
        this._sectionPlane.constant = -sign * position;
    }

    _applySectionToModel() {
        if (!this.hasModel()) return;
        const enabled = this._section.enabled;

        this.modelRoot.traverse(o => {
            if (!o.isMesh || !o.material) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
                if (enabled) {
                    const already = m.clippingPlanes && m.clippingPlanes[0] === this._sectionPlane;
                    if (!already) {
                        m.clippingPlanes = [this._sectionPlane];
                        m.needsUpdate = true;
                    }
                } else if (m.clippingPlanes && m.clippingPlanes.length > 0) {
                    m.clippingPlanes = [];
                    m.needsUpdate = true;
                }
            }
        });
    }

    _updateSectionIndicator() {
        if (!this._section.enabled || !this._sectionBounds) {
            this._disposeSectionIndicator();
            return;
        }

        const bounds = this._sectionBounds;
        const size = bounds.getSize(new THREE.Vector3());
        const min = bounds.min, max = bounds.max;
        const { axis, position } = this._section;
        const margin = Math.max(size.x, size.y, size.z) * 0.05;

        let pts;
        if (axis === 'x') {
            pts = [
                position, min.y - margin, min.z - margin,
                position, max.y + margin, min.z - margin,
                position, max.y + margin, max.z + margin,
                position, min.y - margin, max.z + margin,
                position, min.y - margin, min.z - margin,
            ];
        } else if (axis === 'y') {
            pts = [
                min.x - margin, position, min.z - margin,
                max.x + margin, position, min.z - margin,
                max.x + margin, position, max.z + margin,
                min.x - margin, position, max.z + margin,
                min.x - margin, position, min.z - margin,
            ];
        } else {
            pts = [
                min.x - margin, min.y - margin, position,
                max.x + margin, min.y - margin, position,
                max.x + margin, max.y + margin, position,
                min.x - margin, max.y + margin, position,
                min.x - margin, min.y - margin, position,
            ];
        }

        if (!this._sectionIndicator) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
            const mat = new THREE.LineBasicMaterial({
                color: 0x60a5fa,
                transparent: true,
                opacity: 0.55,
                depthTest: false,
                depthWrite: false,
            });
            const line = new THREE.Line(geo, mat);
            line.renderOrder = 997;
            const group = new THREE.Group();
            group.name = '__sectionIndicator';
            group.add(line);
            this._sectionIndicator = group;
            this.scene.add(group);
        } else {
            const attr = this._sectionIndicator.children[0].geometry.attributes.position;
            attr.array.set(pts);
            attr.needsUpdate = true;
        }
    }

    _disposeSectionIndicator() {
        if (this._sectionIndicator) {
            this.scene.remove(this._sectionIndicator);
            disposeObject(this._sectionIndicator);
            this._sectionIndicator = null;
        }
    }

    _createDimensionOverlay(box) {
        const group = new THREE.Group();
        group.name = '__dimensions';

        const size = box.getSize(new THREE.Vector3());
        const min = box.min;
        const max = box.max;
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        /* --- proporsi adaptif --- */
        const offset     = maxDim * 0.10;
        const zDimOffset = maxDim * 0.15;
        const extOver    = maxDim * 0.03;
        const arrowLen   = maxDim * 0.022;
        const arrowRad   = arrowLen * 0.38;
        const labelScale = maxDim * 0.16;

        /* --- materials --- */
        const lineMat = new THREE.LineBasicMaterial({
            color: 0x60a5fa,
            transparent: true,
            opacity: 0.85,
            depthTest: false,
            depthWrite: false,
        });
        const arrowMat = new THREE.MeshBasicMaterial({
            color: 0x60a5fa,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
            depthWrite: false,
        });

        /* --- bbox wireframe --- */
        const bboxGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
        const edges = new THREE.EdgesGeometry(bboxGeo);
        bboxGeo.dispose();
        const bboxLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
            color: 0x3b82f6,
            transparent: true,
            opacity: 0.28,
            depthTest: false,
            depthWrite: false,
        }));
        bboxLines.renderOrder = 998;
        bboxLines.position.copy(center);
        group.add(bboxLines);

        /* --- helpers --- */
        const V = (x, y, z) => new THREE.Vector3(x, y, z);
        const UP_Y = new THREE.Vector3(0, 1, 0);

        const addLine = (a, b) => {
            const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
            const line = new THREE.Line(geo, lineMat);
            line.renderOrder = 999;
            group.add(line);
        };

        const addArrow = (tip, dir) => {
            const geo = new THREE.ConeGeometry(arrowRad, arrowLen, 10);
            const cone = new THREE.Mesh(geo, arrowMat);
            const d = dir.clone().normalize();
            cone.quaternion.setFromUnitVectors(UP_Y, d);
            cone.position.copy(tip).sub(d.clone().multiplyScalar(arrowLen / 2));
            cone.renderOrder = 999;
            group.add(cone);
        };

        const addLabel = (pos, text) => {
            const dpr = 2;
            const cw = 512, ch = 128;
            const canvas = document.createElement('canvas');
            canvas.width = cw * dpr;
            canvas.height = ch * dpr;
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);

            ctx.font = 'bold 48px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
            const tw = ctx.measureText(text).width;
            const padX = 20;
            const bw = Math.min(tw + padX * 2, cw - 10);
            const bh = 76;
            const bx = (cw - bw) / 2;
            const by = (ch - bh) / 2;
            const r = 16;

            ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
            ctx.strokeStyle = 'rgba(96, 165, 250, 0.9)';
            ctx.lineWidth = 3;
            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(bx, by, bw, bh, r);
                ctx.fill();
                ctx.stroke();
            } else {
                ctx.fillRect(bx, by, bw, bh);
                ctx.strokeRect(bx, by, bw, bh);
            }

            ctx.fillStyle = '#93c5fd';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, cw / 2, ch / 2);

            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = false;

            const mat = new THREE.SpriteMaterial({
                map: tex,
                depthTest: false,
                depthWrite: false,
                transparent: true,
            });
            const sprite = new THREE.Sprite(mat);
            sprite.renderOrder = 1000;
            sprite.scale.set(labelScale, labelScale / 4, 1);
            sprite.position.copy(pos);
            group.add(sprite);
        };

        /* ============ X DIMENSION (di bawah objek, sejajar X) ============ */
        {
            const y = min.y - offset;
            const z = min.z;

            addLine(V(min.x, min.y, z), V(min.x, y - extOver, z));
            addLine(V(max.x, min.y, z), V(max.x, y - extOver, z));
            addLine(V(min.x, y, z), V(max.x, y, z));

            addArrow(V(min.x, y, z), V(-1, 0, 0));
            addArrow(V(max.x, y, z), V(1, 0, 0));

            addLabel(
                V(center.x, y - extOver * 0.6 - labelScale * 0.15, z),
                `X: ${size.x.toFixed(2)}`
            );
        }

        /* ============ Y DIMENSION (kanan objek, sejajar Y) ============ */
        {
            const x = max.x + offset;
            const z = min.z;

            addLine(V(max.x, min.y, z), V(x + extOver, min.y, z));
            addLine(V(max.x, max.y, z), V(x + extOver, max.y, z));
            addLine(V(x, min.y, z), V(x, max.y, z));

            addArrow(V(x, min.y, z), V(0, -1, 0));
            addArrow(V(x, max.y, z), V(0, 1, 0));

            addLabel(
                V(x + extOver * 0.6 + labelScale * 0.15, center.y, z),
                `Y: ${size.y.toFixed(2)}`
            );
        }

        /* ============ Z DIMENSION (kanan-atas objek, sejajar Z) ============ */
        {
            const x = max.x + zDimOffset;
            const y = min.y;

            addLine(V(max.x, y, min.z), V(x + extOver, y, min.z));
            addLine(V(max.x, y, max.z), V(x + extOver, y, max.z));
            addLine(V(x, y, min.z), V(x, y, max.z));

            addArrow(V(x, y, min.z), V(0, 0, -1));
            addArrow(V(x, y, max.z), V(0, 0, 1));

            addLabel(
                V(x + extOver * 0.6 + labelScale * 0.15, y, center.z),
                `Z: ${size.z.toFixed(2)}`
            );
        }

        this._dimensionGroup = group;
        this.scene.add(group);
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

        this.camera.up.copy(this.currentUp);
        this.camera.position.copy(center).addScaledVector(this.currentDirection, dist);
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

    setView(preset) {
        const VIEWS = {
            front:  { dir: [0, -1, 0],       up: [0, 0, 1] },
            back:   { dir: [0, 1, 0],        up: [0, 0, 1] },
            right:  { dir: [1, 0, 0],        up: [0, 0, 1] },
            left:   { dir: [-1, 0, 0],       up: [0, 0, 1] },
            top:    { dir: [0, 0, 1],        up: [0, 1, 0] },  // up ganti ke +Y
            bottom: { dir: [0, 0, -1],       up: [0, -1, 0] },
            iso:    { dir: [0.85, -1, 0.72], up: [0, 0, 1] },
        };
        const v = VIEWS[preset];
        if (!v) return;

        this.currentUp.set(v.up[0], v.up[1], v.up[2]);
        this.currentDirection.set(v.dir[0], v.dir[1], v.dir[2]).normalize();

        if (this.hasModel()) {
            this.fitToObject(this.modelRoot);
        } else {
            this.camera.up.copy(this.currentUp);
            if (preset === 'iso') {
                this.camera.position.set(60, -80, 55);
            } else {
                this.camera.position.copy(this.currentDirection).multiplyScalar(120);
            }
            this.controls.target.set(0, 0, 0);
            this.controls.update();
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
     * Capture current view as ImageData.
     * @param {number} size          - lebar/tinggi (px)
     * @param {WebGLRenderer} [reuse] - reuse offscreen renderer (untuk loop animasi — hindari leak context)
     */
    captureImageData(size = 480, reuse = null) {
        const w = size, h = size;
        const offscreen = reuse || this._createOffscreen(w, h);

        const oldAspect = this.camera.aspect;
        const oldFov = this.camera.fov;
        this.camera.aspect = 1;
        this.camera.fov = this._fovForAspect(oldFov, oldAspect, 1);
        this.camera.updateProjectionMatrix();

        try {
            offscreen.render(this.scene, this.camera);
            const canvas2D = document.createElement('canvas');
            canvas2D.width = w;
            canvas2D.height = h;
            const ctx = canvas2D.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(offscreen.domElement, 0, 0, w, h);
            return ctx.getImageData(0, 0, w, h);
        } finally {
            this.camera.aspect = oldAspect;
            this.camera.fov = oldFov;
            this.camera.updateProjectionMatrix();
            if (!reuse) this._destroyOffscreen(offscreen);
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
        const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
        r.setPixelRatio(1);
        r.setSize(w, h, false);
        r.setClearColor(0x1e1e1e, 1);
        r.localClippingEnabled = true;            // ← add
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