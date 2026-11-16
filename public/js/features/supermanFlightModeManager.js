/**
 * SupermanFlightModeManager — free-flight camera (keyboard only: move + look + vertical).
 * Uses Cesium Camera move and look APIs for correct ellipsoid / orientation behavior.
 *
 * Public API preserved: init, show, hide, toggle, enableFlightMode, disableFlightMode, cleanup,
 * window.supermanFlightModeManager, modal ids (#supermanFlightModal, #supermanFlightToggle, etc.).
 * When flight is disabled, no flight input listeners run; viewer controls and canvas cursor match pre-flight state.
 */

class SupermanFlightModeManager {
    constructor() {
        this.tilesetViewer = null;
        this.modal = null;
        this.isActive = false;
        this.isEnabled = false;

        /** Base horizontal speed (m/s); slider 10–200. */
        this.baseSpeed = 50;
        /** Radians per second for I/J/K/L look. */
        this.keyboardLookRadiansPerSecond = 2.0;
        /** Invert vertical keyboard look (I/K). */
        this.invertMouseY = false;

        this._lastMovementTime = null;
        this._preUpdateCallback = null;
        this._frameCounter = 0;

        this._keyboardListenersBound = false;
        this._keydownListener = null;
        this._keyupListener = null;
        this._blurListener = null;
        this._visibilityListener = null;

        /** Canvas cursor before flight; restored on disable (no lingering grab/grabbing). */
        this._savedCanvasCursor = undefined;

        /** Scratch vectors (avoid per-frame allocations). */
        this._scratchWorldUp = new Cesium.Cartesian3();
        this._sceneRenderBackup = null;
        this._hudEl = null;
        this._hudSpeedEl = null;
        this._escapeGlobalListener = null;

        this.keys = {
            forward: false,
            back: false,
            left: false,
            right: false,
            upWorld: false,
            downWorld: false,
            boost: false,
            lookLeft: false,
            lookRight: false,
            lookUp: false,
            lookDown: false
        };

        this.init();
    }

    lockViewerInputs() {
        const scene = this.tilesetViewer?.viewer?.scene;
        if (!scene?.screenSpaceCameraController) return;
        window.__simplexInputLocks = (window.__simplexInputLocks || 0) + 1;
        scene.screenSpaceCameraController.enableInputs = false;
    }

    unlockViewerInputs() {
        const scene = this.tilesetViewer?.viewer?.scene;
        if (!scene?.screenSpaceCameraController) return;
        window.__simplexInputLocks = Math.max(0, (window.__simplexInputLocks || 0) - 1);
        scene.screenSpaceCameraController.enableInputs = window.__simplexInputLocks === 0;
    }

    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.createSupermanFlightModal();
        this.setupEventHandlers();
    }

    createSupermanFlightModal() {
        const existing = document.getElementById('supermanFlightModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'supermanFlightModal';
        modal.className = 'superman-flight-modal map-tool-panel-overlay';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'supermanFlightTitle');
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="superman-flight-content" role="document">
                <div class="superman-flight-header">
                    <h2 id="supermanFlightTitle">Flight mode</h2>
                    <button type="button" class="close-btn superman-flight-close" id="closeSupermanFlightBtn" aria-label="Close flight panel">×</button>
                </div>
                <div class="superman-flight-body">
                    <div class="superman-flight-icon-container">
                        <div class="superman-flight-icon" aria-hidden="true">🦸</div>
                    </div>
                    <div class="superman-flight-instructions">
                        <p>Fly with the keyboard only. Movement and look happen only while you hold keys. Globe controls stay off until you disable flight.</p>
                    </div>
                    <div class="superman-flight-controls">
                        <div class="control-group">
                            <h3>Movement</h3>
                            <div class="controls-grid">
                                <div class="control-item"><kbd>W</kbd><span>Forward</span></div>
                                <div class="control-item"><kbd>S</kbd><span>Back</span></div>
                                <div class="control-item"><kbd>A</kbd><span>Strafe left</span></div>
                                <div class="control-item"><kbd>D</kbd><span>Strafe right</span></div>
                                <div class="control-item"><kbd>Q</kbd><span>Down (world)</span></div>
                                <div class="control-item"><kbd>E</kbd><span>Up (world)</span></div>
                                <div class="control-item"><kbd>↑↓←→</kbd><span>Same as WASD</span></div>
                                <div class="control-item"><kbd>Shift</kbd><span>Faster</span></div>
                            </div>
                        </div>
                        <div class="control-group">
                            <h3>Look</h3>
                            <div class="controls-grid">
                                <div class="control-item"><kbd>J</kbd><span>Look left</span></div>
                                <div class="control-item"><kbd>L</kbd><span>Look right</span></div>
                                <div class="control-item"><kbd>I</kbd><span>Look up</span></div>
                                <div class="control-item"><kbd>K</kbd><span>Look down</span></div>
                            </div>
                        </div>
                        <div class="control-group">
                            <label class="checkbox-label flight-invert-label">
                                <input type="checkbox" id="flightInvertY" />
                                <span>Invert vertical look (I/K)</span>
                            </label>
                        </div>
                        <div class="control-group">
                            <label>Base speed</label>
                            <div class="slider-control">
                                <input type="range" id="flightSpeedSlider" class="range-slider"
                                       min="10" max="200" step="10" value="50" />
                                <div class="slider-value"><span id="flightSpeedValue">50 m/s</span></div>
                            </div>
                        </div>
                    </div>
                    <div class="superman-flight-actions">
                        <label class="checkbox-label">
                            <input type="checkbox" id="supermanFlightToggle" class="flight-toggle-checkbox" />
                            <span class="flight-toggle-slider"></span>
                            <span class="flight-toggle-text">Enable flight mode</span>
                        </label>
                    </div>
                    <div class="superman-flight-info">
                        <p class="info-text">Turn flight off to restore the same globe mouse and touch behavior as before flight (cursor included).</p>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;

        this._ensureFlightHud();
        this._wireEscapeGlobal();
    }

    _ensureFlightHud() {
        if (document.getElementById('flightModeHud')) {
            this._hudEl = document.getElementById('flightModeHud');
            this._hudSpeedEl = document.getElementById('flightHudSpeed');
            return;
        }
        const hud = document.createElement('div');
        hud.id = 'flightModeHud';
        hud.className = 'flight-mode-hud';
        hud.setAttribute('aria-hidden', 'true');
        hud.innerHTML =
            '<div class="flight-mode-hud-inner">' +
            '<span id="flightHudSpeed" class="flight-hud-speed">0 m/s</span>' +
            '<span class="flight-hud-sep" aria-hidden="true">·</span>' +
            '<span class="flight-hud-hint">Esc — exit flight</span>' +
            '</div>';
        const host = document.querySelector('.viewer-container') || document.body;
        host.appendChild(hud);
        this._hudEl = hud;
        this._hudSpeedEl = document.getElementById('flightHudSpeed');
    }

    _setHudVisible(show) {
        this._ensureFlightHud();
        if (this._hudEl) {
            this._hudEl.style.display = show ? 'block' : 'none';
            this._hudEl.setAttribute('aria-hidden', show ? 'false' : 'true');
        }
    }

    _wireEscapeGlobal() {
        if (this._escapeGlobalListener) return;
        this._escapeGlobalListener = (e) => {
            if (e.code !== 'Escape') return;
            if (this.isEnabled) {
                e.preventDefault();
                this.disableFlightMode();
                return;
            }
            if (this.modal && window.getComputedStyle(this.modal).display !== 'none') {
                e.preventDefault();
                this.hide();
            }
        };
        document.addEventListener('keydown', this._escapeGlobalListener, { passive: false });
    }

    _applyFlightRenderPolicy(viewer) {
        const scene = viewer && viewer.scene;
        if (!scene) return;
        this._sceneRenderBackup = {
            requestRenderMode: scene.requestRenderMode,
            maximumRenderTimeChange: scene.maximumRenderTimeChange
        };
        scene.requestRenderMode = false;
        scene.maximumRenderTimeChange = Infinity;
    }

    _restoreFlightRenderPolicy(viewer) {
        const scene = viewer && viewer.scene;
        if (!scene || !this._sceneRenderBackup) return;
        scene.requestRenderMode = this._sceneRenderBackup.requestRenderMode;
        scene.maximumRenderTimeChange = this._sceneRenderBackup.maximumRenderTimeChange;
        this._sceneRenderBackup = null;
    }

    /**
     * Only skip flight keys when the user is typing in a text-like control.
     * Checkboxes, range sliders, and buttons must NOT block — otherwise focus stays on
     * the flight toggle after enable and WASD/IJKL never update (silent no-op).
     */
    _isTypingContextTarget(e) {
        const t = e && e.target;
        if (!t) return false;
        if (t.isContentEditable) return true;
        const tag = (t.tagName || '').toLowerCase();
        if (tag === 'textarea' || tag === 'select') return true;
        if (tag !== 'input') return false;
        const type = (t.type || 'text').toLowerCase();
        const typingTypes = new Set([
            'text',
            'search',
            'email',
            'password',
            'number',
            'url',
            'tel',
            'date',
            'time',
            'datetime-local',
            'month',
            'week',
            'color'
        ]);
        return typingTypes.has(type) || type === '';
    }

    setupEventHandlers() {
        this.modal?.querySelector('#closeSupermanFlightBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
        });

        document.getElementById('supermanFlightToggle')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.enableFlightMode();
            } else {
                this.disableFlightMode();
            }
        });

        document.getElementById('flightInvertY')?.addEventListener('change', (e) => {
            this.invertMouseY = !!e.target.checked;
        });

        const slider = document.getElementById('flightSpeedSlider');
        if (slider) {
            slider.addEventListener('input', (e) => {
                this.baseSpeed = parseFloat(e.target.value);
                const el = document.getElementById('flightSpeedValue');
                if (el) el.textContent = `${this.baseSpeed} m/s`;
            });
        }
    }

    _resetKeyState() {
        Object.keys(this.keys).forEach((k) => {
            this.keys[k] = false;
        });
    }

    _bindLifecycleListeners() {
        this._blurListener = () => {
            if (this.isEnabled) this._resetKeyState();
        };
        this._visibilityListener = () => {
            if (document.hidden && this.isEnabled) this._resetKeyState();
        };
        window.addEventListener('blur', this._blurListener);
        document.addEventListener('visibilitychange', this._visibilityListener);
    }

    _unbindLifecycleListeners() {
        if (this._blurListener) {
            window.removeEventListener('blur', this._blurListener);
            this._blurListener = null;
        }
        if (this._visibilityListener) {
            document.removeEventListener('visibilitychange', this._visibilityListener);
            this._visibilityListener = null;
        }
    }

    _dispatchFlightEvent(enabled) {
        try {
            window.dispatchEvent(
                new CustomEvent('simplex-flight-mode-changed', {
                    detail: { enabled: !!enabled }
                })
            );
        } catch (err) {
            /* ignore */
        }
    }

    setupKeyboardHandlers() {
        if (this._keyboardListenersBound) return;

        const setKeyFromCode = (code, down) => {
            switch (code) {
                case 'KeyW':
                case 'ArrowUp':
                    this.keys.forward = down;
                    break;
                case 'KeyS':
                case 'ArrowDown':
                    this.keys.back = down;
                    break;
                case 'KeyA':
                case 'ArrowLeft':
                    this.keys.left = down;
                    break;
                case 'KeyD':
                case 'ArrowRight':
                    this.keys.right = down;
                    break;
                case 'KeyQ':
                    this.keys.downWorld = down;
                    break;
                case 'KeyE':
                    this.keys.upWorld = down;
                    break;
                case 'KeyI':
                    this.keys.lookUp = down;
                    break;
                case 'KeyK':
                    this.keys.lookDown = down;
                    break;
                case 'KeyJ':
                    this.keys.lookLeft = down;
                    break;
                case 'KeyL':
                    this.keys.lookRight = down;
                    break;
                case 'ShiftLeft':
                case 'ShiftRight':
                    this.keys.boost = down;
                    break;
                default:
                    return false;
            }
            return true;
        };

        const flightKeyCodes = new Set([
            'ArrowUp',
            'ArrowDown',
            'ArrowLeft',
            'ArrowRight',
            'KeyW',
            'KeyA',
            'KeyS',
            'KeyD',
            'KeyQ',
            'KeyE',
            'KeyI',
            'KeyJ',
            'KeyK',
            'KeyL',
            'ShiftLeft',
            'ShiftRight'
        ]);

        this._keydownListener = (e) => {
            if (!this.isEnabled) return;
            if (this._isTypingContextTarget(e)) return;
            const code = e.code;
            if (flightKeyCodes.has(code)) {
                e.preventDefault();
            }
            setKeyFromCode(code, true);
        };

        this._keyupListener = (e) => {
            if (!this.isEnabled) return;
            if (this._isTypingContextTarget(e)) return;
            const code = e.code;
            setKeyFromCode(code, false);
        };

        document.addEventListener('keydown', this._keydownListener, { passive: false });
        document.addEventListener('keyup', this._keyupListener, { passive: false });
        this._keyboardListenersBound = true;
    }

    _altitudeSpeedFactor(camera) {
        const h = camera.positionCartographic?.height ?? 0;
        return Cesium.Math.clamp(1 + h / 500, 1, 40);
    }

    _worldUpDirection(camera, result) {
        const p = camera.position;
        const mag = Cesium.Cartesian3.magnitude(p);
        if (mag < 1) {
            return Cesium.Cartesian3.clone(Cesium.Cartesian3.UNIT_Z, result);
        }
        return Cesium.Cartesian3.normalize(p, result);
    }

    updateCameraMovement() {
        if (!this.tilesetViewer?.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const scene = viewer.scene;
        const camera = viewer.camera;

        if (scene.mode === Cesium.SceneMode.SCENE2D) {
            scene.requestRender();
            return;
        }

        const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        const dt = this._lastMovementTime ? Math.min(0.08, (now - this._lastMovementTime) / 1000) : 1 / 60;
        this._lastMovementTime = now;

        const altFactor = this._altitudeSpeedFactor(camera);
        const metersPerSecond = this.baseSpeed * altFactor * (this.keys.boost ? 2.25 : 1);
        const step = metersPerSecond * dt;

        let f = 0;
        let r = 0;
        if (this.keys.forward) f += 1;
        if (this.keys.back) f -= 1;
        if (this.keys.left) r -= 1;
        if (this.keys.right) r += 1;

        let wu = 0;
        if (this.keys.upWorld) wu += 1;
        if (this.keys.downWorld) wu -= 1;

        const horizLen = Math.hypot(f, r);
        const anyHoriz = horizLen > 1e-6;
        const anyVert = Math.abs(wu) > 1e-6;

        if (anyHoriz) {
            const inv = step / horizLen;
            camera.moveForward(f * inv);
            camera.moveRight(r * inv);
        }
        if (anyVert) {
            const worldUp = this._worldUpDirection(camera, this._scratchWorldUp);
            const amount = wu * step;
            camera.move(worldUp, amount);
        }

        const moving = anyHoriz || anyVert;

        const lookRate = this.keyboardLookRadiansPerSecond * dt;
        const vPitchSign = this.invertMouseY ? -1 : 1;
        if (this.keys.lookLeft) {
            camera.lookRight(-lookRate);
        }
        if (this.keys.lookRight) {
            camera.lookRight(lookRate);
        }
        if (this.keys.lookUp) {
            camera.lookDown(-lookRate * vPitchSign);
        }
        if (this.keys.lookDown) {
            camera.lookDown(lookRate * vPitchSign);
        }

        const anyLook =
            this.keys.lookLeft ||
            this.keys.lookRight ||
            this.keys.lookUp ||
            this.keys.lookDown;

        if (this._hudSpeedEl) {
            const eff = this.baseSpeed * altFactor * (this.keys.boost ? 2.25 : 1);
            this._hudSpeedEl.textContent = `${Math.round(eff)} m/s`;
        }

        this._frameCounter++;
        if (moving || anyLook || this._frameCounter % 20 === 0) {
            scene.requestRender();
        }
    }

    enableFlightMode() {
        this.tilesetViewer = window.tilesetViewer;

        if (!this.tilesetViewer?.viewer) {
            if (window.notification) {
                window.notification.error(
                    window.appI18n?.nt ? window.appI18n.nt('viewerNotReady') : 'Viewer not ready'
                );
            }
            const cb = document.getElementById('supermanFlightToggle');
            if (cb) cb.checked = false;
            return;
        }

        const viewer = this.tilesetViewer.viewer;
        if (viewer.scene.mode === Cesium.SceneMode.SCENE2D) {
            if (window.notification) {
                window.notification.warning(
                    window.appI18n?.nt ? window.appI18n.nt('flightOnly3d') : 'Flight mode is only available in 3D view.'
                );
            }
            const cb = document.getElementById('supermanFlightToggle');
            if (cb) cb.checked = false;
            return;
        }

        if (this.isEnabled) {
            return;
        }

        this.isEnabled = true;
        this._lastMovementTime =
            typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        this._resetKeyState();

        const canvas = viewer.canvas;
        if (canvas) {
            this._savedCanvasCursor = canvas.style.cursor;
        }

        this.lockViewerInputs();
        try {
            this.setupKeyboardHandlers();
            this._bindLifecycleListeners();
            this.bindPreUpdateLoop();
        } catch (err) {
            this.unlockViewerInputs();
            if (canvas && this._savedCanvasCursor !== undefined) {
                canvas.style.cursor = this._savedCanvasCursor;
            }
            this._savedCanvasCursor = undefined;
            this.isEnabled = false;
            const cb = document.getElementById('supermanFlightToggle');
            if (cb) cb.checked = false;
            console.error('Flight mode failed to start:', err);
            if (window.notification) {
                window.notification.error(
                    window.appI18n?.nt ? window.appI18n.nt('flightStartFailed') : 'Could not start flight mode'
                );
            }
            return;
        }

        this._applyFlightRenderPolicy(viewer);
        this._setHudVisible(true);

        this._dispatchFlightEvent(true);

        try {
            const ae = document.activeElement;
            if (ae && typeof ae.blur === 'function') {
                ae.blur();
            }
        } catch (blurErr) {
            /* ignore */
        }
        if (canvas) {
            if (!canvas.hasAttribute('tabindex')) {
                canvas.setAttribute('tabindex', '-1');
            }
            try {
                canvas.focus({ preventScroll: true });
            } catch (focusErr) {
                try {
                    canvas.focus();
                } catch (e2) {
                    /* ignore */
                }
            }
        }

        if (window.notification) {
            window.notification.success(
                window.appI18n?.nt ? window.appI18n.nt('supermanEnabled') : 'Superman Flight Mode enabled'
            );
        }
    }

    disableFlightMode() {
        if (!this.isEnabled) return;

        this.isEnabled = false;
        this._unbindPreUpdateIfAny();
        this._unbindLifecycleListeners();

        this._resetKeyState();

        const viewer = this.tilesetViewer?.viewer;
        if (viewer) {
            const c = viewer.canvas;
            if (c && this._savedCanvasCursor !== undefined) {
                c.style.cursor = this._savedCanvasCursor;
            }
            this._savedCanvasCursor = undefined;
            this._restoreFlightRenderPolicy(viewer);
            this.unlockViewerInputs();
            viewer.scene.requestRender();
        }
        this._lastMovementTime = null;
        this._setHudVisible(false);

        if (this._keyboardListenersBound) {
            if (this._keydownListener) document.removeEventListener('keydown', this._keydownListener);
            if (this._keyupListener) document.removeEventListener('keyup', this._keyupListener);
            this._keydownListener = null;
            this._keyupListener = null;
            this._keyboardListenersBound = false;
        }

        this._dispatchFlightEvent(false);

        const toggle = document.getElementById('supermanFlightToggle');
        if (toggle && toggle.checked) {
            toggle.checked = false;
        }

        if (window.notification) {
            window.notification.info(
                window.appI18n?.nt ? window.appI18n.nt('supermanDisabled') : 'Superman Flight Mode disabled'
            );
        }
    }

    bindPreUpdateLoop() {
        const viewer = this.tilesetViewer?.viewer;
        if (!viewer) return;
        const scene = viewer.scene;

        if (this._preUpdateCallback) return;

        this._preUpdateCallback = () => {
            if (!this.isEnabled) return;
            this.updateCameraMovement();
        };
        scene.preUpdate.addEventListener(this._preUpdateCallback);
    }

    _unbindPreUpdateIfAny() {
        const viewer = this.tilesetViewer?.viewer;
        if (!viewer) return;
        const scene = viewer.scene;
        if (this._preUpdateCallback) {
            scene.preUpdate.removeEventListener(this._preUpdateCallback);
            this._preUpdateCallback = null;
        }
    }

    unbindPreUpdateLoop() {
        this._unbindPreUpdateIfAny();
    }

    cleanup() {
        if (this.isEnabled) {
            this.disableFlightMode();
        } else {
            this.unbindPreUpdateLoop();
        }
    }

    show() {
        if (this.modal) {
            this.modal.style.display = 'flex';
        }
    }

    hide() {
        if (this.isEnabled) {
            this.disableFlightMode();
        }
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }

    toggle() {
        if (this.modal && this.modal.style.display === 'none') {
            this.show();
        } else {
            this.hide();
        }
    }
}

if (typeof window !== 'undefined') {
    window.supermanFlightModeManager = new SupermanFlightModeManager();
}
