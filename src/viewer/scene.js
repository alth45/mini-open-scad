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
        this._theme = 'dark';
        this._measureMode = false;
        this._measurePoints = [];
        this._measureGroup = null;
        this._measureListeners = null;
        this.onMeasure = null;              // callback: (data) => void
        this._snapModes = { vertex: true, edge: true, face: true };
        this._snapCache = null;
        this._measurePreview = null;
        this._hoverRaf = null;
        this._pendingHover = null;
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
        /* ============================================================
    Theme
    ============================================================ */

    setTheme(theme) {
        this._theme = theme === 'light' ? 'light' : 'dark';
        const light = this._theme === 'light';
        const bg = light ? 0xf5f5f7 : 0x1e1e1e;

        this.renderer.setClearColor(bg, 1);
        this.scene.background = new THREE.Color(bg);

        /* Rebuild grid dengan warna sesuai tema */
        const wasVisible = this.grid ? this.grid.visible : true;
        if (this.grid) {
            this.scene.remove(this.grid);
            disposeObject(this.grid);
        }
        this.grid = light
            ? new THREE.GridHelper(400, 40, 0xb0b0b8, 0xd8d8de)
            : new THREE.GridHelper(400, 40, 0x4a4a4a, 0x2e2e2e);
        this.grid.rotation.x = Math.PI / 2;
        this.grid.position.z = -0.01;
        this.grid.visible = wasVisible;
        this.scene.add(this.grid);
    }

        /* ============================================================
                    Measure tool
    ============================================================ */

    setMeasureMode(on) {
        on = !!on;
        if (this._measureMode === on) return;
        this._measureMode = on;
        this.renderer.domElement.style.cursor = on ? 'crosshair' : '';

        if (on) {
            if (!this._measureListeners) {
                const down = (e) => { this._measureDownPos = { x: e.clientX, y: e.clientY }; };
                const up = (e) => this._handleMeasurePointerUp(e);
                const move = (e) => this._handleMeasurePointerMove(e);
                const leave = () => {
                    if (this._measurePreview) this._measurePreview.visible = false;
                };
                this._measureListeners = { down, up, move, leave };
                this.renderer.domElement.addEventListener('pointerdown', down);
                this.renderer.domElement.addEventListener('pointerup', up);
                this.renderer.domElement.addEventListener('pointermove', move);
                this.renderer.domElement.addEventListener('pointerleave', leave);
            }
        } else {
            if (this._measureListeners) {
                this.renderer.domElement.removeEventListener('pointerdown', this._measureListeners.down);
                this.renderer.domElement.removeEventListener('pointerup', this._measureListeners.up);
                this.renderer.domElement.removeEventListener('pointermove', this._measureListeners.move);
                this.renderer.domElement.removeEventListener('pointerleave', this._measureListeners.leave);
                this._measureListeners = null;
            }
            if (this._hoverRaf) { cancelAnimationFrame(this._hoverRaf); this._hoverRaf = null; }
            this._pendingHover = null;
            if (this._measurePreview) this._measurePreview.visible = false;
            this._measureDownPos = null;
            this.clearMeasurement();
        }
    }

   clearMeasurement() {
        this._disposeMeasureGroup();
        this._measurePoints = [];
        if (this._measurePreview) this._measurePreview.visible = false;
        this.onMeasure?.({ reset: true });
    }

    _handleMeasurePointerUp(e) {
        if (!this._measureMode) return;
        if (e.button !== 0) return;
        if (!this._measureDownPos) return;

        const dx = e.clientX - this._measureDownPos.x;
        const dy = e.clientY - this._measureDownPos.y;
        this._measureDownPos = null;
        if (Math.sqrt(dx * dx + dy * dy) > 4) return;

        if (!this.hasModel()) return;

        const hit = this._raycastMeasure(e.clientX, e.clientY);
        if (!hit) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        const snap = this._snapPoint(hit.point, e.clientX, e.clientY, rect);
        const point = snap ? snap.point.clone() : hit.point.clone();

        if (this._measurePoints.length >= 2) this._measurePoints = [];
        this._measurePoints.push(point);

        this._renderMeasurement();
        this._updateMeasurePreview(e.clientX, e.clientY);   // refresh preview

        if (this._measurePoints.length === 1) {
            this.onMeasure?.({ points: [point.clone()], complete: false });
        } else {
            const [a, b] = this._measurePoints;
            const dxv = b.x - a.x, dyv = b.y - a.y, dzv = b.z - a.z;
            const dist = Math.sqrt(dxv * dxv + dyv * dyv + dzv * dzv);
            this.onMeasure?.({
                points: [a.clone(), b.clone()],
                complete: true,
                distance: dist,
                dx: dxv, dy: dyv, dz: dzv,
            });
        }
    }

    _handleMeasurePointerMove(e) {
        if (!this._measureMode) return;
        if (e.buttons !== 0) {
            if (this._measurePreview) this._measurePreview.visible = false;
            return;
        }
        this._pendingHover = { x: e.clientX, y: e.clientY };
        if (this._hoverRaf) return;
        this._hoverRaf = requestAnimationFrame(() => {
            this._hoverRaf = null;
            const p = this._pendingHover;
            this._pendingHover = null;
            if (p) this._updateMeasurePreview(p.x, p.y);
        });
    }

    setSnapModes(modes) {
        if (!modes) return;
        if (typeof modes.vertex === 'boolean') this._snapModes.vertex = modes.vertex;
        if (typeof modes.edge === 'boolean') this._snapModes.edge = modes.edge;
        if (typeof modes.face === 'boolean') this._snapModes.face = modes.face;
        /* Invalidasi preview agar tidak nyangkut */
        if (this._measurePreview) this._measurePreview.visible = false;
    }

    getSnapModes() { return { ...this._snapModes }; }

    /* --- shared raycast helper (respect section plane) --- */
    _raycastMeasure(clientX, clientY) {
        if (!this.hasModel()) return null;
        const rect = this.renderer.domElement.getBoundingClientRect();
        const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);

        const meshes = [];
        this.modelRoot.traverse(o => { if (o.isMesh && o.visible) meshes.push(o); });
        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length === 0) return null;

        if (this._section.enabled) {
            for (const h of hits) {
                if (this._sectionPlane.distanceToPoint(h.point) <= 1e-6) {
                    return { point: h.point.clone(), object: h.object };
                }
            }
            return null;
        }
        return { point: hits[0].point.clone(), object: hits[0].object };
    }

    /* --- snap detection (screen-space, 20px radius) --- */
    _snapPoint(hitPointWorld, mouseX, mouseY, rect) {
        if (!this._snapCache || this._snapCache.disabled) return null;
        const m = this._snapModes;
        if (!m.vertex && !m.edge && !m.face) return null;

        /* radius dalam pixel untuk "near" */
        const SNAP_RADIUS_PX = 20;
        /* 3D buffer: perkiraan world-space dari SNAP_RADIUS_PX */
        const dist = this.camera.position.distanceTo(hitPointWorld);
        const vFov = this.camera.fov * Math.PI / 180;
        const worldPerPx = (2 * dist * Math.tan(vFov / 2)) / Math.max(rect.height, 1);
        const radiusW = worldPerPx * SNAP_RADIUS_PX * 2;   // 2× buffer
        const radiusSq = radiusW * radiusW;

        const groups = [];
        if (m.vertex) groups.push({ arr: this._snapCache.vertices, type: 'vertex' });
        if (m.edge)   groups.push({ arr: this._snapCache.edges,    type: 'edge' });
        if (m.face)   groups.push({ arr: this._snapCache.faceCenters, type: 'face' });

        const tmp = new THREE.Vector3();
        let best = null;
        let bestPx = SNAP_RADIUS_PX;
        const sectionOn = this._section.enabled;

        for (const g of groups) {
            for (const p of g.arr) {
                const dx = p.x - hitPointWorld.x;
                const dy = p.y - hitPointWorld.y;
                const dz = p.z - hitPointWorld.z;
                if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
                if (sectionOn && this._sectionPlane.distanceToPoint(p) > 1e-6) continue;

                tmp.copy(p).project(this.camera);
                const sx = (tmp.x * 0.5 + 0.5) * rect.width + rect.left;
                const sy = (-tmp.y * 0.5 + 0.5) * rect.height + rect.top;
                const sdx = sx - mouseX;
                const sdy = sy - mouseY;
                const px = Math.sqrt(sdx * sdx + sdy * sdy);
                if (px < bestPx) {
                    bestPx = px;
                    best = { point: p, type: g.type, px: bestPx };
                }
            }
        }
        return best;
    }

    /* --- hover preview marker --- */
    _updateMeasurePreview(mouseX, mouseY) {
        if (!this._measureMode || !this.hasModel()) {
            if (this._measurePreview) this._measurePreview.visible = false;
            return;
        }
        const hit = this._raycastMeasure(mouseX, mouseY);
        if (!hit) {
            if (this._measurePreview) this._measurePreview.visible = false;
            return;
        }
        const rect = this.renderer.domElement.getBoundingClientRect();
        const snap = this._snapPoint(hit.point, mouseX, mouseY, rect);
        const pos = snap ? snap.point : hit.point;

        const radius = this._measurePointRadius();

        if (!this._measurePreview) {
            const geo = new THREE.SphereGeometry(1, 16, 12);
            const mat = new THREE.MeshBasicMaterial({
                color: 0x4ade80,
                transparent: true,
                opacity: 0.85,
                depthTest: false,
                depthWrite: false,
            });
            this._measurePreview = new THREE.Mesh(geo, mat);
            this._measurePreview.renderOrder = 1004;
            this.scene.add(this._measurePreview);
        }
        this._measurePreview.scale.setScalar(radius);
        this._measurePreview.position.copy(pos);
        this._measurePreview.visible = true;
    }

    _measurePointRadius() {
        if (!this._sectionBounds) this.refreshSectionBounds();
        if (!this._sectionBounds) return 0.5;
        const size = this._sectionBounds.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        return maxDim * 0.008;
    }

    /* --- build snap candidate cache --- */
    _buildSnapCache() {
        this._snapCache = { vertices: [], edges: [], faceCenters: [], disabled: false };
        if (!this.hasModel()) return;

        /* hitung total triangle */
        let triTotal = 0;
        this.modelRoot.traverse(o => {
            if (!o.isMesh || !o.geometry) return;
            const pos = o.geometry.attributes.position;
            const idx = o.geometry.index;
            if (!pos) return;
            triTotal += Math.floor((idx ? idx.count : pos.count) / 3);
        });

        if (triTotal > 200000) {
            this._snapCache.disabled = true;
            this._snapCache.triTotal = triTotal;
            return;
        }
        this._snapCache.triTotal = triTotal;

        this.modelRoot.updateMatrixWorld(true);

        this.modelRoot.traverse(o => {
            if (!o.isMesh || !o.geometry) return;
            const geo = o.geometry;
            const pos = geo.attributes.position;
            if (!pos) return;

            const mat = o.matrixWorld;
            const idx = geo.index ? geo.index.array : null;
            const nVerts = pos.count;
            const triCount = Math.floor((idx ? idx.length : nVerts) / 3);

            /* world-space posisi semua vertex */
            const wp = new Float32Array(nVerts * 3);
            const tmp = new THREE.Vector3();
            for (let i = 0; i < nVerts; i++) {
                tmp.fromBufferAttribute(pos, i).applyMatrix4(mat);
                wp[i * 3]     = tmp.x;
                wp[i * 3 + 1] = tmp.y;
                wp[i * 3 + 2] = tmp.z;
            }

            /* dedupe vertices via rounded key */
            const seenV = new Set();
            for (let i = 0; i < nVerts; i++) {
                const x = wp[i * 3], y = wp[i * 3 + 1], z = wp[i * 3 + 2];
                const key = `${x.toFixed(4)}|${y.toFixed(4)}|${z.toFixed(4)}`;
                if (seenV.has(key)) continue;
                seenV.add(key);
                this._snapCache.vertices.push(new THREE.Vector3(x, y, z));
            }

            /* face centers + edge midpoints (dedupe edges) */
            const seenE = new Set();
            for (let t = 0; t < triCount; t++) {
                const i0 = idx ? idx[t * 3]     : t * 3;
                const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
                const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;

                /* face center */
                this._snapCache.faceCenters.push(new THREE.Vector3(
                    (wp[i0 * 3]     + wp[i1 * 3]     + wp[i2 * 3])     / 3,
                    (wp[i0 * 3 + 1] + wp[i1 * 3 + 1] + wp[i2 * 3 + 1]) / 3,
                    (wp[i0 * 3 + 2] + wp[i1 * 3 + 2] + wp[i2 * 3 + 2]) / 3,
                ));

                /* edges */
                const tri = [i0, i1, i2];
                for (let k = 0; k < 3; k++) {
                    const a = tri[k], b = tri[(k + 1) % 3];
                    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
                    if (seenE.has(key)) continue;
                    seenE.add(key);
                    this._snapCache.edges.push(new THREE.Vector3(
                        (wp[a * 3]     + wp[b * 3])     / 2,
                        (wp[a * 3 + 1] + wp[b * 3 + 1]) / 2,
                        (wp[a * 3 + 2] + wp[b * 3 + 2]) / 2,
                    ));
                }
            }
        });
    }

    _disposeMeasureGroup() {
        if (this._measureGroup) {
            this.scene.remove(this._measureGroup);
            disposeObject(this._measureGroup);
            this._measureGroup = null;
        }
    }

    _renderMeasurement() {
        this._disposeMeasureGroup();
        if (this._measurePoints.length === 0) return;
        if (!this.hasModel()) return;

        this.modelRoot.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(this.modelRoot);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        const group = new THREE.Group();
        group.name = '__measure';

        const pointRadius = maxDim * 0.008;
        const pointGeo = new THREE.SphereGeometry(pointRadius, 16, 12);
        const pointMat = new THREE.MeshBasicMaterial({
            color: 0xff4d4d,
            depthTest: false,
            depthWrite: false,
        });

        for (const p of this._measurePoints) {
            const sphere = new THREE.Mesh(pointGeo, pointMat);
            sphere.position.copy(p);
            sphere.renderOrder = 1002;
            group.add(sphere);
        }

        if (this._measurePoints.length === 2) {
            const [a, b] = this._measurePoints;
            const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
            const mat = new THREE.LineDashedMaterial({
                color: 0xff4d4d,
                dashSize: maxDim * 0.02,
                gapSize: maxDim * 0.012,
                depthTest: false,
                depthWrite: false,
                transparent: true,
                opacity: 0.95,
            });
            const line = new THREE.Line(geo, mat);
            line.computeLineDistances();
            line.renderOrder = 1001;
            group.add(line);

            const dxv = b.x - a.x, dyv = b.y - a.y, dzv = b.z - a.z;
            const dist = Math.sqrt(dxv * dxv + dyv * dyv + dzv * dzv);
            const mid = a.clone().add(b).multiplyScalar(0.5);

            const sprite = this._makeMeasureLabel(dist.toFixed(2), maxDim);
            sprite.position.copy(mid);
            group.add(sprite);
        }

        this._measureGroup = group;
        this.scene.add(group);
    }

    _makeMeasureLabel(text, maxDim) {
        const dpr = 2;
        const cw = 512, ch = 128;
        const canvas = document.createElement('canvas');
        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        ctx.font = 'bold 52px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
        const tw = ctx.measureText(text).width;
        const padX = 24;
        const bw = Math.min(tw + padX * 2, cw - 10);
        const bh = 80;
        const bx = (cw - bw) / 2;
        const by = (ch - bh) / 2;
        const r = 16;

        ctx.fillStyle = 'rgba(40, 10, 10, 0.85)';
        ctx.strokeStyle = 'rgba(255, 100, 100, 0.95)';
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

        ctx.fillStyle = '#ffbbbb';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, cw / 2, ch / 2);

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;

        const labelScale = maxDim * 0.16;
        const mat = new THREE.SpriteMaterial({
            map: tex,
            depthTest: false,
            depthWrite: false,
            transparent: true,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.renderOrder = 1003;
        sprite.scale.set(labelScale, labelScale / 4, 1);
        return sprite;
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
        this._buildSnapCache();                    // ← add

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
        const r = new THREE.WebGLRenderer({
            antialias: true,
            preserveDrawingBuffer: true,
            alpha: false
        });
        r.setPixelRatio(1);
        r.setSize(w, h, false);
        const light = this._theme === 'light';
        r.setClearColor(light ? 0xf5f5f7 : 0x1e1e1e, 1);
        r.localClippingEnabled = true;
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