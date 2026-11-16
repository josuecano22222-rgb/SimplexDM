/**
 * ObliqueViewsManager
 * External system integration for oblique aerial photography (Meridian Design - Pages 22-23)
 * Features: Point selection, external system link, confirmation dialog
 */

class ObliqueViewsManager {
    constructor() {
        this.tilesetViewer = null;
        this.modal = null;
        this.confirmationDialog = null;
        this.isSelecting = false;
        this.selectedPoint = null;
        this.handler = null;
        this.externalSystemUrl = 'https://oblique.simplex.com'; // Placeholder - disabled in offline mode
        this.init();
    }

    /**
     * Initialize oblique views manager
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.createObliqueViewsModal();
        this.createConfirmationDialog();
        this.setupEventHandlers();
    }

    /**
     * Create oblique views modal
     */
    createObliqueViewsModal() {
        // Remove existing if any
        const existing = document.getElementById('obliqueViewsModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'obliqueViewsModal';
        modal.className = 'oblique-views-modal';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="oblique-views-content">
                <div class="oblique-views-header">
                    <h2>Oblique Views</h2>
                    <button class="close-btn" id="closeObliqueViewsBtn">×</button>
                </div>
                <div class="oblique-views-body">
                    <div class="oblique-views-icon-container">
                        <div class="oblique-views-icon">📸</div>
                    </div>
                    
                    <div class="oblique-views-instructions">
                        <p>Click on any point in the model to view original oblique aerial photographs.</p>
                        <p>The source images are captured using the world's most advanced aerial photography system, developed by Meridian, at a resolution of 3 cm per pixel.</p>
                    </div>

                    <div class="oblique-views-info">
                        <div class="info-panel">
                            <div class="info-icon">ℹ️</div>
                            <p class="info-text">Oblique views are not available in all models.</p>
                        </div>
                    </div>

                    <div class="oblique-views-actions">
                        <button class="btn btn-primary" id="selectPointBtn">
                            <span>📍</span> Select Point on Map
                        </button>
                    </div>

                    <div class="oblique-views-preview">
                        <div class="preview-grid">
                            <div class="preview-panel">
                                <div class="preview-placeholder">Oblique View 1</div>
                            </div>
                            <div class="preview-panel">
                                <div class="preview-placeholder">Oblique View 2</div>
                            </div>
                            <div class="preview-panel">
                                <div class="preview-placeholder">Map View</div>
                            </div>
                            <div class="preview-panel">
                                <div class="preview-placeholder">Map View</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
    }

    /**
     * Create confirmation dialog
     */
    createConfirmationDialog() {
        // Remove existing if any
        const existing = document.getElementById('obliqueViewsConfirmation');
        if (existing) {
            existing.remove();
        }

        const dialog = document.createElement('div');
        dialog.id = 'obliqueViewsConfirmation';
        dialog.className = 'oblique-views-confirmation';
        dialog.style.display = 'none';

        dialog.innerHTML = `
            <div class="confirmation-content">
                <div class="confirmation-header">
                    <h3>Open External System</h3>
                </div>
                <div class="confirmation-body">
                    <p>The system will open the Meridian oblique aerial photography site for the selected point.</p>
                    <div class="confirmation-point-info">
                        <span class="point-label">Selected Point:</span>
                        <span class="point-coordinates" id="confirmationCoordinates">--</span>
                    </div>
                </div>
                <div class="confirmation-actions">
                    <button class="btn btn-primary" id="confirmObliqueBtn">Confirm</button>
                    <button class="btn" id="cancelObliqueBtn">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);
        this.confirmationDialog = dialog;
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Close button
        document.addEventListener('click', (e) => {
            if (e.target.id === 'closeObliqueViewsBtn' || (e.target === this.modal && e.target === this.modal)) {
                this.hide();
            }
        });

        // Select point button
        document.getElementById('selectPointBtn')?.addEventListener('click', () => {
            this.startPointSelection();
        });

        // Confirmation dialog buttons
        document.getElementById('confirmObliqueBtn')?.addEventListener('click', () => {
            this.openExternalSystem();
        });

        document.getElementById('cancelObliqueBtn')?.addEventListener('click', () => {
            this.hideConfirmation();
        });
    }

    /**
     * Show oblique views modal
     */
    show() {
        if (this.modal) {
            this.modal.style.display = 'flex';
        }
    }

    /**
     * Hide oblique views modal
     */
    hide() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
        this.stopPointSelection();
        this.hideConfirmation();
    }

    /**
     * Toggle oblique views modal
     */
    toggle() {
        if (this.modal && this.modal.style.display === 'none') {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Start point selection
     */
    startPointSelection() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) {
            if (window.notification) {
                window.notification.error('Viewer not ready');
            }
            return;
        }

        this.stopPointSelection();
        this.isSelecting = true;
        const viewer = this.tilesetViewer.viewer;
        viewer.canvas.style.cursor = 'crosshair';

        // Setup click handler
        this.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        this.handler.setInputAction((click) => {
            this.handlePointClick(click);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        if (window.notification) {
            window.notification.info('Click on the map to select a point');
        }
    }

    /**
     * Handle point click
     */
    handlePointClick(click) {
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
            
            this.selectedPoint = { lat, lon, cartesian };
            this.showConfirmation();
            this.stopPointSelection();
        }
    }

    /**
     * Stop point selection
     */
    stopPointSelection() {
        this.isSelecting = false;

        if (this.handler) {
            this.handler.destroy();
            this.handler = null;
        }

        const viewer = this.tilesetViewer?.viewer;
        if (viewer) {
            viewer.canvas.style.cursor = 'default';
        }
    }

    headingForDirection(direction) {
        switch ((direction || '').toLowerCase()) {
            case 'north':
                return 0; // looking south toward scene
            case 'south':
                return Math.PI; // looking north
            case 'east':
                return 3 * Math.PI / 2; // looking west
            case 'west':
                return Math.PI / 2; // looking east
            default:
                return 0;
        }
    }

    /**
     * Set an oblique view for the current scene center
     * Uses a deterministic orbital-style positioning around the picked center.
     */
    setObliqueView(direction) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;
        const viewer = this.tilesetViewer.viewer;
        const camera = viewer.camera;

        const centerScreen = new Cesium.Cartesian2(
            viewer.canvas.clientWidth / 2,
            viewer.canvas.clientHeight / 2
        );

        const center = camera.pickEllipsoid(centerScreen, viewer.scene.globe.ellipsoid) ?? camera.position;
        const centerCarto = Cesium.Cartographic.fromCartesian(center);

        const offsetDegrees = 0.005;
        const offsets = {
            north: { dLat: +offsetDegrees, dLon: 0 },
            south: { dLat: -offsetDegrees, dLon: 0 },
            east: { dLat: 0, dLon: +offsetDegrees },
            west: { dLat: 0, dLon: -offsetDegrees }
        };
        const o = offsets[(direction || '').toLowerCase()] || offsets.north;

        camera.setView({
            destination: Cesium.Cartesian3.fromRadians(
                centerCarto.longitude + Cesium.Math.toRadians(o.dLon),
                centerCarto.latitude + Cesium.Math.toRadians(o.dLat),
                (centerCarto.height || 0) + 300
            ),
            orientation: {
                heading: this.headingForDirection(direction),
                pitch: Cesium.Math.toRadians(-45),
                roll: 0
            }
        });
        viewer.scene.requestRender();
    }

    /**
     * Show confirmation dialog
     */
    showConfirmation() {
        if (!this.selectedPoint) return;

        // Update coordinates display
        const coordsEl = document.getElementById('confirmationCoordinates');
        if (coordsEl) {
            coordsEl.textContent = `${this.selectedPoint.lat.toFixed(6)}, ${this.selectedPoint.lon.toFixed(6)}`;
        }

        if (this.confirmationDialog) {
            this.confirmationDialog.style.display = 'flex';
        }
    }

    /**
     * Hide confirmation dialog
     */
    hideConfirmation() {
        if (this.confirmationDialog) {
            this.confirmationDialog.style.display = 'none';
        }
        this.selectedPoint = null;
    }

    /**
     * Open external system (disabled in offline mode)
     */
    openExternalSystem() {
        if (!this.selectedPoint) return;
        const { lat, lon } = this.selectedPoint;

        // Offline mode: External system requires internet connection
        if (window.notification) {
            window.notification.info('External system integration requires internet connection. This application runs offline.');
        }

        this.hideConfirmation();
        
        // Show coordinates that would have been sent
        if (window.notification) {
            window.notification.info(`Selected location: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
        }
    }

    /**
     * Set external system URL
     */
    setExternalSystemUrl(url) {
        this.externalSystemUrl = url;
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.obliqueViewsManager = new ObliqueViewsManager();
}
