/**
 * StreetViewManager
 * Immersive first-person ground-level 3D walkthrough inside loaded 3D Tiles & terrain.
 *
 * Works 100% offline directly in the Cesium 3D viewport:
 * - Enter at current camera location or click any street/plaza point on the 3D scene
 * - Configurable pedestrian eye height (1.2 m – 15 m, default 1.7 m) and FOV (45° – 110°)
 * - Smooth click-drag 360° look, WASD / Arrow walking (Shift to move faster), Q/E turn
 * - Accessible on-screen step/turn controls & live heading/coordinate HUD bar
 * - Clean exit (`Esc` or Exit button) restoring the exact pre-Street-View orbit camera & FOV
 */

class StreetViewManager {
    constructor() {
        this.tilesetViewer = null;
        this.modal = null;
        this.hud = null;
        this.isActive = false;
        this.isSelectingLocation = false;
        /** @type {{ lon:number, lat:number, groundHeight:number, eyeOffset:number }|null} */
        this.currentPosition = null;
        this.eyeHeight = 1.7;
        this.walkSpeed = 4.5; // m/s
        this.fovDeg = 75;
        this.offlineMode = true;

        this._savedCamera = null;
        this._lookHandler = null;
        this._pickHandler = null;
        this._isDraggingLook = false;
        this._lookLast = null;
        this._heading = 0; // radians
        this._pitch = 0; // radians
        this._sensitivity = 0.0026;
        this._keys = new Set();
        this._keydownHandler = null;
        this._keyupHandler = null;
        this._rafId = null;
        this._lastStepMs = 0;

        this.init();
    }

    static formatCardinal(headingDeg) {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const norm = ((Number(headingDeg) || 0) % 360 + 360) % 360;
        return dirs[Math.round(norm / 45) % 8];
    }

    isStreetViewImageryAvailable() {
        // First-person 3D scene street view is always available offline.
        return true;
    }

    lockViewerInputs() {
        const scene = this._getViewer()?.scene;
        if (!scene?.screenSpaceCameraController) return;
        if (this._hasLock) return;
        this._hasLock = true;
        window.__simplexInputLocks = (window.__simplexInputLocks || 0) + 1;
        scene.screenSpaceCameraController.enableInputs = false;
    }

    unlockViewerInputs() {
        const scene = this._getViewer()?.scene;
        if (!this._hasLock) return;
        this._hasLock = false;
        window.__simplexInputLocks = Math.max(0, (window.__simplexInputLocks || 0) - 1);
        if (scene?.screenSpaceCameraController) {
            scene.screenSpaceCameraController.enableInputs = window.__simplexInputLocks === 0;
        }
    }

    _getViewer() {
        if (!this.tilesetViewer && typeof window !== 'undefined') {
            this.tilesetViewer = window.tilesetViewer;
        }
        return this.tilesetViewer?.viewer || null;
    }

    init() {
        this.tilesetViewer = typeof window !== 'undefined' ? window.tilesetViewer : null;
        if (typeof document !== 'undefined') {
            this.createStreetViewModal();
            this.createStreetViewHud();
            this.setupEventHandlers();
        }
    }

    createStreetViewModal() {
        const existing = document.getElementById('streetViewModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'streetViewModal';
        modal.className = 'street-view-modal map-tool-panel-overlay';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'streetViewModalTitle');
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="street-view-content sdm-tool-dialog">
                <div class="street-view-header sdm-tool-header">
                    <h2 id="streetViewModalTitle">
                        <i class="fas fa-street-view" aria-hidden="true"></i>
                        <span>3D Street View</span>
                    </h2>
                    <button type="button" class="close-btn" id="closeStreetViewBtn" aria-label="Close Street View">×</button>
                </div>
                <div class="street-view-body sdm-tool-body">
                    <p class="sdm-tool-lead">
                        Explore your 3D Tiles reality model and terrain from pedestrian eye level. Drag to look 360°, use <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to walk, <kbd>Shift</kbd> to sprint, and <kbd>Esc</kbd> to return to orbit view.
                    </p>

                    <div class="street-view-controls">
                        <button type="button" class="btn btn-primary btn-sm" id="selectLocationBtn">
                            <i class="fas fa-map-marker-alt" aria-hidden="true"></i>
                            <span>Pick Street Point</span>
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm" id="useCurrentPositionBtn">
                            <i class="fas fa-location-arrow" aria-hidden="true"></i>
                            <span>Drop Below Camera</span>
                        </button>
                    </div>

                    <div class="oblique-sliders-grid">
                        <label class="oblique-slider-field" for="streetViewEyeHeight">
                            <span>Eye Height: <strong id="streetViewEyeVal">1.7 m</strong></span>
                            <input type="range" id="streetViewEyeHeight" min="1.2" max="15" step="0.1" value="1.7">
                        </label>
                        <label class="oblique-slider-field" for="streetViewFov">
                            <span>Field of View: <strong id="streetViewFovVal">75°</strong></span>
                            <input type="range" id="streetViewFov" min="45" max="110" step="1" value="75">
                        </label>
                    </div>

                    <div class="street-view-info">
                        <div class="info-item">
                            <span class="info-label">Location</span>
                            <span class="info-value" id="streetViewLocation">—</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Status</span>
                            <span class="info-value" id="streetViewStatus">Ready (100% offline 3D)</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
    }

    createStreetViewHud() {
        const existing = document.getElementById('streetViewHud');
        if (existing) existing.remove();

        const hud = document.createElement('div');
        hud.id = 'streetViewHud';
        hud.className = 'street-view-hud';
        hud.setAttribute('role', 'region');
        hud.setAttribute('aria-label', 'Active Street View controls');
        hud.style.display = 'none';

        hud.innerHTML = `
            <div class="sv-hud-badge">
                <i class="fas fa-street-view" aria-hidden="true"></i>
                <span>Street View</span>
            </div>
            <div class="sv-hud-telemetry" id="svHudTelemetry" aria-live="polite">0° N · Eye 1.7 m</div>
            <div class="sv-hud-controls" role="group" aria-label="Walk and look controls">
                <button type="button" class="btn btn-xs" data-sv-act="turnLeft" title="Turn left 30°" aria-label="Turn left">
                    <i class="fas fa-undo" aria-hidden="true"></i>
                </button>
                <button type="button" class="btn btn-xs" data-sv-act="forward" title="Step forward 5 m" aria-label="Step forward">
                    <i class="fas fa-arrow-up" aria-hidden="true"></i>
                </button>
                <button type="button" class="btn btn-xs" data-sv-act="backward" title="Step back 5 m" aria-label="Step backward">
                    <i class="fas fa-arrow-down" aria-hidden="true"></i>
                </button>
                <button type="button" class="btn btn-xs" data-sv-act="turnRight" title="Turn right 30°" aria-label="Turn right">
                    <i class="fas fa-redo" aria-hidden="true"></i>
                </button>
                <button type="button" class="btn btn-xs" data-sv-act="settings" title="Adjust eye height &amp; FOV" aria-label="Street View settings">
                    <i class="fas fa-sliders-h" aria-hidden="true"></i>
                </button>
                <button type="button" class="btn btn-xs btn-danger" id="exitStreetViewHudBtn" title="Exit Street View (Esc)">
                    <i class="fas fa-sign-out-alt" aria-hidden="true"></i> Exit
                </button>
            </div>
        `;

        document.body.appendChild(hud);
        this.hud = hud;
    }

    setupEventHandlers() {
        this.modal?.querySelector('#closeStreetViewBtn')?.addEventListener('click', () => this.hideModal());
        this.modal?.addEventListener('click', (e) => {
            if (e.target === this.modal) this.hideModal();
        });

        this.modal?.querySelector('#selectLocationBtn')?.addEventListener('click', () => {
            this.startLocationPick();
        });
        this.modal?.querySelector('#useCurrentPositionBtn')?.addEventListener('click', () => {
            this.enterAtCurrentCamera();
        });

        const eyeInput = this.modal?.querySelector('#streetViewEyeHeight');
        const eyeVal = this.modal?.querySelector('#streetViewEyeVal');
        eyeInput?.addEventListener('input', () => {
            this.eyeHeight = Number(eyeInput.value) || 1.7;
            if (eyeVal) eyeVal.textContent = `${this.eyeHeight.toFixed(1)} m`;
            if (this.isActive && this.currentPosition) {
                this.currentPosition.eyeOffset = this.eyeHeight;
                this._applyCameraPose();
            }
        });

        const fovInput = this.modal?.querySelector('#streetViewFov');
        const fovVal = this.modal?.querySelector('#streetViewFovVal');
        fovInput?.addEventListener('input', () => {
            this.fovDeg = Number(fovInput.value) || 75;
            if (fovVal) fovVal.textContent = `${this.fovDeg}°`;
            if (this.isActive) {
                this._applyFov(this.fovDeg);
            }
        });

        this.hud?.querySelector('#exitStreetViewHudBtn')?.addEventListener('click', () => this.exitStreetView());
        this.hud?.querySelectorAll('[data-sv-act]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const act = btn.getAttribute('data-sv-act');
                if (act === 'forward') this.stepHorizontal(5, 0);
                else if (act === 'backward') this.stepHorizontal(-5, 0);
                else if (act === 'turnLeft') {
                    this._heading -= Math.PI / 6;
                    this._applyCameraPose();
                } else if (act === 'turnRight') {
                    this._heading += Math.PI / 6;
                    this._applyCameraPose();
                } else if (act === 'settings') {
                    if (this.modal) this.modal.style.display = 'flex';
                }
            });
        });

        this._keydownHandler = (e) => {
            if (e.key === 'Escape') {
                if (this.isSelectingLocation) {
                    e.preventDefault();
                    this._stopLocationPick();
                    this.show();
                    return;
                }
                if (this.modal && this.modal.style.display !== 'none') {
                    e.preventDefault();
                    this.hideModal();
                    return;
                }
                if (this.isActive) {
                    e.preventDefault();
                    this.exitStreetView();
                    return;
                }
            }

            if (!this.isActive) return;
            const tag = (e.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
                return;
            }
            const handled = new Set([
                'KeyW', 'KeyA', 'KeyS', 'KeyD',
                'KeyQ', 'KeyE',
                'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
                'ShiftLeft', 'ShiftRight',
            ]);
            if (handled.has(e.code)) {
                e.preventDefault();
                this._keys.add(e.code);
                this._startWalkLoop();
            }
        };

        this._keyupHandler = (e) => {
            this._keys.delete(e.code);
        };

        document.addEventListener('keydown', this._keydownHandler);
        document.addEventListener('keyup', this._keyupHandler);
    }

    show() {
        if (!this.modal) this.createStreetViewModal();
        this.modal.style.display = 'flex';
        document.getElementById('streetview')?.setAttribute('aria-pressed', 'true');
    }

    hideModal() {
        if (this.modal) this.modal.style.display = 'none';
        if (!this.isActive) {
            document.getElementById('streetview')?.setAttribute('aria-pressed', 'false');
        }
    }

    hide() {
        this._stopLocationPick();
        this.exitStreetView(true);
        this.hideModal();
    }

    toggle() {
        if (this.isActive) {
            this.exitStreetView();
        } else if (this.modal && this.modal.style.display !== 'none') {
            this.hideModal();
        } else {
            this.show();
        }
    }

    startLocationPick() {
        const viewer = this._getViewer();
        if (!viewer || typeof Cesium === 'undefined') {
            window.notification?.error?.('3D viewer is not ready');
            return;
        }
        this._stopLocationPick();
        this.isSelectingLocation = true;
        this.hideModal();
        viewer.canvas.style.cursor = 'crosshair';
        window.notification?.info?.('Click any street or plaza point to enter 3D Street View (Esc to cancel)');

        this._pickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        this._pickHandler.setInputAction((click) => {
            let cartesian = null;
            if (viewer.scene.pickPositionSupported) {
                try {
                    cartesian = viewer.scene.pickPosition(click.position);
                } catch (_) {
                    cartesian = null;
                }
            }
            if (!cartesian) {
                cartesian = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
            }
            this._stopLocationPick();
            if (!cartesian) {
                window.notification?.warning?.('Could not resolve surface position — try clicking closer to terrain');
                return;
            }
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            this.enterAt(
                Cesium.Math.toDegrees(carto.longitude),
                Cesium.Math.toDegrees(carto.latitude),
                Math.max(-450, carto.height || 0),
                viewer.camera.heading
            );
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }

    _stopLocationPick() {
        this.isSelectingLocation = false;
        if (this._pickHandler) {
            try {
                this._pickHandler.destroy();
            } catch (_) {
                /* ignore */
            }
            this._pickHandler = null;
        }
        const viewer = this._getViewer();
        if (viewer?.canvas) viewer.canvas.style.cursor = '';
    }

    enterAtCurrentCamera() {
        const viewer = this._getViewer();
        if (!viewer || typeof Cesium === 'undefined') {
            window.notification?.error?.('3D viewer is not ready');
            return false;
        }
        const carto = viewer.camera.positionCartographic;
        const lon = Cesium.Math.toDegrees(carto.longitude);
        const lat = Cesium.Math.toDegrees(carto.latitude);
        let groundH = 0;
        try {
            const sampled = viewer.scene.globe.getHeight(new Cesium.Cartographic(carto.longitude, carto.latitude));
            if (Number.isFinite(sampled)) groundH = sampled;
        } catch (_) {
            groundH = 0;
        }
        return this.enterAt(lon, lat, groundH, viewer.camera.heading);
    }

    enterAt(lon, lat, groundHeight = 0, headingRad = 0) {
        const viewer = this._getViewer();
        if (!viewer || typeof Cesium === 'undefined') return false;

        if (!this.isActive) {
            this._savedCamera = {
                position: Cesium.Cartesian3.clone(viewer.camera.position, new Cesium.Cartesian3()),
                heading: viewer.camera.heading,
                pitch: viewer.camera.pitch,
                roll: viewer.camera.roll,
                fov: viewer.camera.frustum?.fov,
            };
        }

        this.isActive = true;
        this.currentPosition = {
            lon: Number(lon),
            lat: Number(lat),
            groundHeight: Number.isFinite(groundHeight) ? groundHeight : 0,
            eyeOffset: this.eyeHeight,
        };
        this._heading = Number.isFinite(headingRad) ? headingRad : 0;
        this._pitch = Cesium.Math.toRadians(-2);

        this.hideModal();
        this.lockViewerInputs();
        this._applyFov(this.fovDeg);
        this._applyCameraPose();
        this._bindLookDrag(viewer);

        if (this.hud) this.hud.style.display = 'flex';
        document.getElementById('streetview')?.classList.add('active');
        document.getElementById('streetview')?.setAttribute('aria-pressed', 'true');

        const statusEl = document.getElementById('streetViewStatus');
        if (statusEl) statusEl.textContent = 'Active — First-Person 3D';
        return true;
    }

    _applyFov(deg) {
        const viewer = this._getViewer();
        if (!viewer?.camera?.frustum || typeof Cesium === 'undefined') return;
        if ('fov' in viewer.camera.frustum) {
            viewer.camera.frustum.fov = Cesium.Math.toRadians(Math.max(45, Math.min(110, deg)));
            viewer.scene?.requestRender?.();
        }
    }

    _applyCameraPose() {
        const viewer = this._getViewer();
        const pos = this.currentPosition;
        if (!viewer || !pos || typeof Cesium === 'undefined') return;

        const maxPitch = Cesium.Math.toRadians(82);
        this._pitch = Math.max(-maxPitch, Math.min(maxPitch, this._pitch));
        this._heading = ((this._heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

        const totalH = (pos.groundHeight || 0) + (pos.eyeOffset || this.eyeHeight);
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, totalH),
            orientation: {
                heading: this._heading,
                pitch: this._pitch,
                roll: 0,
            },
        });
        viewer.scene?.requestRender?.();

        const hdgDeg = Math.round(Cesium.Math.toDegrees(this._heading)) % 360;
        const card = StreetViewManager.formatCardinal(hdgDeg);
        const locStr = `${pos.lat.toFixed(6)}°, ${pos.lon.toFixed(6)}° (${totalH.toFixed(1)} m)`;
        const locEl = document.getElementById('streetViewLocation');
        if (locEl) locEl.textContent = locStr;
        const hudTel = document.getElementById('svHudTelemetry');
        if (hudTel) {
            hudTel.textContent = `${hdgDeg}° ${card} · ${pos.lat.toFixed(5)}°, ${pos.lon.toFixed(5)}° · Eye ${this.eyeHeight.toFixed(1)} m`;
        }
    }

    /**
     * Advance pedestrian coordinates by `forwardMeters` and `rightMeters` along current heading.
     */
    stepHorizontal(forwardMeters = 0, rightMeters = 0) {
        const pos = this.currentPosition;
        if (!pos) return;
        const sinH = Math.sin(this._heading);
        const cosH = Math.cos(this._heading);
        const eastM = forwardMeters * sinH + rightMeters * cosH;
        const northM = forwardMeters * cosH - rightMeters * sinH;

        const metersPerDegLat = 111320;
        const cosLat = Math.max(0.01, Math.cos((pos.lat * Math.PI) / 180));
        const metersPerDegLon = metersPerDegLat * cosLat;

        pos.lat = Math.max(-89.9, Math.min(89.9, pos.lat + northM / metersPerDegLat));
        pos.lon = ((pos.lon + eastM / metersPerDegLon + 540) % 360) - 180;
        this._applyCameraPose();
    }

    _startWalkLoop() {
        if (this._rafId || typeof requestAnimationFrame === 'undefined') return;
        this._lastStepMs = performance.now();
        const tick = (now) => {
            if (!this.isActive || this._keys.size === 0) {
                this._rafId = null;
                return;
            }
            const dt = Math.min(0.1, Math.max(0.001, (now - this._lastStepMs) / 1000));
            this._lastStepMs = now;
            const boost = this._keys.has('ShiftLeft') || this._keys.has('ShiftRight') ? 3.0 : 1.0;
            const speed = this.walkSpeed * boost * dt;

            let fwd = 0;
            let right = 0;
            if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) fwd += speed;
            if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) fwd -= speed;
            if (this._keys.has('KeyD')) right += speed;
            if (this._keys.has('KeyA')) right -= speed;
            if (this._keys.has('KeyQ') || this._keys.has('ArrowLeft')) this._heading -= 1.5 * dt;
            if (this._keys.has('KeyE') || this._keys.has('ArrowRight')) this._heading += 1.5 * dt;

            if (fwd !== 0 || right !== 0) {
                this.stepHorizontal(fwd, right);
            } else {
                this._applyCameraPose();
            }
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
    }

    _bindLookDrag(viewer) {
        this._unbindLookDrag();
        if (typeof Cesium === 'undefined') return;
        viewer.canvas.style.cursor = 'grab';
        const h = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        h.setInputAction((down) => {
            this._isDraggingLook = true;
            this._lookLast = { x: down.position.x, y: down.position.y };
            viewer.canvas.style.cursor = 'grabbing';
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        h.setInputAction((move) => {
            if (!this._isDraggingLook || !this._lookLast) return;
            const dx = move.endPosition.x - this._lookLast.x;
            const dy = move.endPosition.y - this._lookLast.y;
            this._lookLast = { x: move.endPosition.x, y: move.endPosition.y };
            this._heading -= dx * this._sensitivity;
            this._pitch += dy * this._sensitivity;
            this._applyCameraPose();
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        h.setInputAction(() => {
            this._isDraggingLook = false;
            this._lookLast = null;
            if (viewer?.canvas) viewer.canvas.style.cursor = 'grab';
        }, Cesium.ScreenSpaceEventType.LEFT_UP);

        this._lookHandler = h;
    }

    _unbindLookDrag() {
        if (this._lookHandler) {
            try {
                this._lookHandler.destroy();
            } catch (_) {
                /* ignore */
            }
            this._lookHandler = null;
        }
        this._isDraggingLook = false;
        this._lookLast = null;
        const viewer = this._getViewer();
        if (viewer?.canvas) viewer.canvas.style.cursor = '';
    }

    exitStreetView(silent = false) {
        if (!this.isActive) return;
        this.isActive = false;
        this._keys.clear();
        if (this._rafId && typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this._unbindLookDrag();
        this.unlockViewerInputs();

        const viewer = this._getViewer();
        if (viewer && this._savedCamera && typeof Cesium !== 'undefined') {
            try {
                if (Number.isFinite(this._savedCamera.fov) && viewer.camera.frustum && 'fov' in viewer.camera.frustum) {
                    viewer.camera.frustum.fov = this._savedCamera.fov;
                }
                viewer.camera.setView({
                    destination: this._savedCamera.position,
                    orientation: {
                        heading: this._savedCamera.heading,
                        pitch: this._savedCamera.pitch,
                        roll: this._savedCamera.roll,
                    },
                });
                viewer.scene?.requestRender?.();
            } catch (_) {
                /* ignore */
            }
        }
        this._savedCamera = null;

        if (this.hud) this.hud.style.display = 'none';
        const btn = typeof document !== 'undefined' ? document.getElementById('streetview') : null;
        btn?.classList.remove('active');
        btn?.setAttribute('aria-pressed', 'false');

        const statusEl = typeof document !== 'undefined' ? document.getElementById('streetViewStatus') : null;
        if (statusEl) statusEl.textContent = 'Ready (100% offline 3D)';
        if (!silent) {
            window.notification?.info?.('Exited Street View');
        }
    }

    cleanup() {
        this._stopLocationPick();
        this.exitStreetView(true);
        if (typeof document !== 'undefined') {
            if (this._keydownHandler) document.removeEventListener('keydown', this._keydownHandler);
            if (this._keyupHandler) document.removeEventListener('keyup', this._keyupHandler);
        }
    }
}

if (typeof window !== 'undefined') {
    window.StreetViewManager = StreetViewManager;
    window.streetViewManager = new StreetViewManager();
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StreetViewManager };
}
