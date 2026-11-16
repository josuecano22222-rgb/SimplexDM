/**
 * StreetViewManager
 * Street View integration (Meridian Design - Page 48)
 * Features: Location display, coordinate tracking
 * NOTE: This application runs offline. Immersive street-level imagery is not bundled.
 */

class StreetViewManager {
    constructor() {
        this.tilesetViewer = null;
        this.modal = null;
        this.streetViewPanel = null;
        this.isActive = false;
        this.currentPosition = null;
        this.offlineMode = true; // Running in offline mode
        this._lookHandler = null;
        this._isLookEnabled = false;
        this._lockedDestination = null;
        this._lookLast = null;
        this._heading = 0;
        this._pitch = 0;
        this._sensitivity = 0.002;
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

    /**
     * Initialize street view manager
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.createStreetViewModal();
        this.setupEventHandlers();
    }

    /**
     * Whether third-party street-level imagery is available (not in offline builds).
     */
    isStreetViewImageryAvailable() {
        return false;
    }

    /**
     * Create Street View modal
     */
    createStreetViewModal() {
        // Remove existing if any
        const existing = document.getElementById('streetViewModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'streetViewModal';
        modal.className = 'street-view-modal map-tool-panel-overlay';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="street-view-content">
                <div class="street-view-header">
                    <h2>Street View</h2>
                    <button class="close-btn" id="closeStreetViewBtn">×</button>
                </div>
                <div class="street-view-body">
                    <div class="street-view-icon-container">
                        <div class="street-view-icon">🚶</div>
                    </div>
                    
                    <div class="street-view-instructions">
                        <p><strong>Offline Mode:</strong> This application runs entirely offline.</p>
                        <p>Street-level photo panoramas are not available in offline mode.</p>
                        <p>You can still view coordinates and location information from the 3D viewer.</p>
                    </div>

                    <div class="street-view-controls">
                        <button class="btn btn-primary" id="useCurrentPositionBtn">
                            <span>📍</span> Use Current Camera Position
                        </button>
                        <button class="btn" id="selectLocationBtn">
                            <span>🗺️</span> Select Location on Map
                        </button>
                    </div>

                    <div class="street-view-panel-container">
                        <div id="streetViewPanel" class="street-view-panel">
                            <div class="street-view-placeholder">
                                <div class="placeholder-icon">🗺️</div>
                                <p>Street View will appear here</p>
                                <p class="placeholder-hint">Select a location to view</p>
                            </div>
                        </div>
                    </div>

                    <div class="street-view-info">
                        <div class="info-item">
                            <span class="info-label">Location:</span>
                            <span class="info-value" id="streetViewLocation">--</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Status:</span>
                            <span class="info-value" id="streetViewStatus">Ready</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        this.modal?.querySelector('#closeStreetViewBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
        });

        // Use current position
        document.getElementById('useCurrentPositionBtn')?.addEventListener('click', () => {
            this.useCurrentCameraPosition();
        });

        // Select location
        document.getElementById('selectLocationBtn')?.addEventListener('click', () => {
            this.startLocationSelection();
        });

        if (!this._escapeListener) {
            this._escapeListener = (e) => {
                if (e.code !== 'Escape') return;
                if (!this.modal || window.getComputedStyle(this.modal).display === 'none') return;
                e.preventDefault();
                this.hide();
            };
            document.addEventListener('keydown', this._escapeListener, { passive: false });
        }
    }

    /**
     * Show Street View modal
     */
    show() {
        if (this.modal) {
            this.modal.style.display = 'flex';
        }
    }

    /**
     * Hide Street View modal
     */
    hide() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
        this.stopLocationSelection();
        this.deactivateStreetViewLook();
    }

    /**
     * Toggle Street View modal
     */
    toggle() {
        if (this.modal && this.modal.style.display === 'none') {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Use current camera position
     */
    useCurrentCameraPosition() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) {
            if (window.notification) {
                window.notification.error(
                    window.appI18n?.nt ? window.appI18n.nt('viewerNotReady') : 'Viewer not ready'
                );
            }
            return;
        }

        const viewer = this.tilesetViewer.viewer;
        const camera = viewer.camera;

        // Get center of screen
        const center = new Cesium.Cartesian2(
            viewer.canvas.clientWidth / 2,
            viewer.canvas.clientHeight / 2
        );

        // Pick point from scene
        const pickedObject = viewer.scene.pick(center);
        let cartesian = null;

        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.position) {
            cartesian = pickedObject.id.position.getValue();
        } else {
            cartesian = viewer.camera.pickEllipsoid(center, viewer.scene.globe.ellipsoid);
        }

        if (cartesian) {
            const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
            const lat = Cesium.Math.toDegrees(cartographic.latitude);
            const lon = Cesium.Math.toDegrees(cartographic.longitude);
            
            this.loadStreetView(lat, lon);
        } else {
            if (window.notification) {
                window.notification.warning(
                    window.appI18n?.nt
                        ? window.appI18n.nt('streetLocationUnknown')
                        : 'Could not determine location. Please select a location on the map.'
                );
            }
        }
    }

    /**
     * Start location selection
     */
    startLocationSelection() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) {
            if (window.notification) {
                window.notification.error(
                    window.appI18n?.nt ? window.appI18n.nt('viewerNotReady') : 'Viewer not ready'
                );
            }
            return;
        }

        this.stopLocationSelection();
        this.isSelecting = true;
        const viewer = this.tilesetViewer.viewer;
        viewer.canvas.style.cursor = 'crosshair';

        // Setup click handler
        this.selectionHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        this.selectionHandler.setInputAction((click) => {
            this.handleLocationClick(click);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        if (window.notification) {
            window.notification.info(
                window.appI18n?.nt ? window.appI18n.nt('streetClickMap') : 'Click on the map to select a location for Street View'
            );
        }
    }

    /**
     * Handle location click
     */
    handleLocationClick(click) {
        if (!this.isSelecting || !this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        
        // Try picking from scene first
        const pickedObject = viewer.scene.pick(click.position);
        let cartesian = null;

        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.position) {
            cartesian = pickedObject.id.position.getValue();
        } else {
            cartesian = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
        }

        if (cartesian) {
            const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
            const lat = Cesium.Math.toDegrees(cartographic.latitude);
            const lon = Cesium.Math.toDegrees(cartographic.longitude);
            
            this.loadStreetView(lat, lon);
            this.stopLocationSelection();
        }
    }

    /**
     * Stop location selection
     */
    stopLocationSelection() {
        this.isSelecting = false;

        if (this.selectionHandler) {
            this.selectionHandler.destroy();
            this.selectionHandler = null;
        }

        const viewer = this.tilesetViewer?.viewer;
        if (viewer) {
            viewer.canvas.style.cursor = 'default';
        }
    }

    /**
     * Load Street View for given coordinates
     * Offline mode: Display location information only
     */
    loadStreetView(lat, lon) {
        this.currentPosition = { lat, lon };

        // Update status
        document.getElementById('streetViewStatus').textContent = 'Offline Mode';
        document.getElementById('streetViewLocation').textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

        // In offline mode, show location information instead of Street View
        this.displayLocationInfo(lat, lon);

        // Activate ground-locked look-around mode in the Cesium viewer
        this.activateStreetViewLook();
    }

    /**
     * Display location information (offline mode)
     */
    displayLocationInfo(lat, lon) {
        const panel = document.getElementById('streetViewPanel');
        if (!panel) return;

        // Display location information instead of Street View
        panel.innerHTML = `
            <div class="street-view-placeholder">
                <div class="placeholder-icon">📍</div>
                <h3>Location Information</h3>
                <div style="margin-top: 20px; text-align: left; padding: 15px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                    <p><strong>Latitude:</strong> ${lat.toFixed(6)}°</p>
                    <p><strong>Longitude:</strong> ${lon.toFixed(6)}°</p>
                    <p style="margin-top: 15px; font-size: calc(0.9em * var(--ui-fs-mul, 1)); opacity: 0.8;">
                        Street-level photo panoramas require an online imagery provider.
                        This application runs entirely offline for local use.
                    </p>
                </div>
            </div>
        `;

        document.getElementById('streetViewStatus').textContent = 'Location Displayed';
        this.isActive = true;
    }

    /**
     * Activate ground-locked "street view" camera mode (offline look-around)
     * - locks camera destination near ground + eye height
     * - disables default camera controller inputs
     * - updates heading/pitch via mouse move (no flyTo)
     */
    activateStreetViewLook() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const scene = viewer.scene;
        const camera = viewer.camera;

        // Disable standard inputs (prevent drift) with shared lock
        this.lockViewerInputs();

        const carto = this.currentPosition
            ? Cesium.Cartographic.fromDegrees(this.currentPosition.lon, this.currentPosition.lat, 0)
            : Cesium.Cartographic.fromCartesian(camera.position);
        const initialHeading = camera.heading;
        this._heading = initialHeading;
        this._pitch = 0;

        const applyLock = (groundHeight) => {
            const eyeHeight = (groundHeight ?? 0) + 1.7;
            this._lockedDestination = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, eyeHeight);
            camera.setView({
                destination: this._lockedDestination,
                orientation: {
                    heading: this._heading,
                    pitch: this._pitch,
                    roll: 0
                }
            });
            scene.requestRender();
        };

        if (typeof scene.sampleHeightMostDetailed === 'function') {
            scene.sampleHeightMostDetailed([carto]).then((samples) => {
                const s = Array.isArray(samples) ? samples[0] : carto;
                const groundHeight = (s && typeof s.height === 'number') ? s.height : 0;
                applyLock(groundHeight);
            }).catch(() => {
                applyLock(0);
            });
        } else {
            applyLock(0);
        }

        // Install look handler
        if (this._lookHandler) {
            this._lookHandler.destroy();
            this._lookHandler = null;
        }

        this._lookHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
        this._isLookEnabled = true;
        this._lookLast = null;

        this._lookHandler.setInputAction((movement) => {
            if (!this._isLookEnabled) return;
            if (!this._lockedDestination) return;

            const current = movement.endPosition;
            if (!this._lookLast) {
                this._lookLast = new Cesium.Cartesian2(current.x, current.y);
                return;
            }

            const deltaX = current.x - this._lookLast.x;
            const deltaY = current.y - this._lookLast.y;
            this._lookLast = new Cesium.Cartesian2(current.x, current.y);

            this._heading += deltaX * this._sensitivity;
            this._pitch = Cesium.Math.clamp(
                this._pitch + deltaY * this._sensitivity,
                Cesium.Math.toRadians(-85),
                Cesium.Math.toRadians(85)
            );

            camera.setView({
                destination: this._lockedDestination,
                orientation: {
                    heading: this._heading,
                    pitch: this._pitch,
                    roll: 0
                }
            });
            scene.requestRender();
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        if (window.notification) {
            window.notification.info(
                window.appI18n?.nt ? window.appI18n.nt('streetLookAround') : 'Street View look-around enabled (mouse move)'
            );
        }
    }

    /**
     * Deactivate ground-locked look-around mode and restore default controls
     */
    deactivateStreetViewLook() {
        const viewer = this.tilesetViewer?.viewer;
        const scene = viewer?.scene;

        this._isLookEnabled = false;
        this._lockedDestination = null;
        this._lookLast = null;

        if (this._lookHandler) {
            this._lookHandler.destroy();
            this._lookHandler = null;
        }

        if (scene?.screenSpaceCameraController) {
            this.unlockViewerInputs();
            scene.requestRender();
        }
    }

    /**
     * Sync Street View position with 3D viewer
     */
    syncWithViewer(lat, lon) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const destination = Cesium.Cartesian3.fromDegrees(lon, lat, 100); // 100m altitude

        // Use setView to avoid flight jitter in look-around mode
        viewer.camera.setView({
            destination: destination,
            orientation: {
                heading: viewer.camera.heading,
                pitch: viewer.camera.pitch,
                roll: 0
            }
        });
        viewer.scene.requestRender();
    }

    /**
     * Show placeholder
     */
    showPlaceholder(message) {
        const panel = document.getElementById('streetViewPanel');
        if (panel) {
            panel.innerHTML = `
                <div class="street-view-placeholder">
                    <div class="placeholder-icon">🗺️</div>
                    <p>${message || 'Street View not available'}</p>
                    <p class="placeholder-hint">Please select a different location</p>
                </div>
            `;
        }
        document.getElementById('streetViewStatus').textContent = 'Not Available';
    }

    /**
     * Get current Street View position
     */
    getCurrentPosition() {
        return this.currentPosition;
    }

    /**
     * Check if Street View is active
     */
    isStreetViewActive() {
        return this.isActive;
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.streetViewManager = new StreetViewManager();
}
