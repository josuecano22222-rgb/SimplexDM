/**
 * CutByPolygonManager
 * Temporary polygon cutting (Meridian Design - Pages 49-50)
 * Features: Polygon selection, 3D mesh cutting, topography cutting, black hole visualization, toggle
 */

class CutByPolygonManager {
    constructor() {
        this.tilesetViewer = null;
        this.modal = null;
        this.isActive = false;
        this.isDrawing = false;
        this.cutPolygon = null;
        this.cutEntity = null;
        this.handler = null;
        this.cutPlane = null;
        this.vertexMarkerEntities = [];
        this.createdClippingCollections = new Map();
        this.originalClippingCollections = new Map();
        this.init();
    }

    /**
     * Initialize cut by polygon manager
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.createCutByPolygonModal();
        this.setupEventHandlers();
    }

    /**
     * Create cut by polygon modal
     */
    createCutByPolygonModal() {
        // Remove existing if any
        const existing = document.getElementById('cutByPolygonModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'cutByPolygonModal';
        modal.className = 'cut-by-polygon-modal map-tool-panel-overlay';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="cut-by-polygon-content">
                <div class="cut-by-polygon-header">
                    <h2>Cut by Polygon</h2>
                    <button class="close-btn" id="closeCutByPolygonBtn">×</button>
                </div>
                <div class="cut-by-polygon-body">
                    <div class="cut-by-polygon-icon-container">
                        <div class="cut-by-polygon-icon">✂️</div>
                    </div>
                    
                    <div class="cut-by-polygon-instructions">
                        <p>Draw a polygon on the map to create a temporary cut.</p>
                        <p>The area inside the polygon will be removed, creating a "black hole" effect.</p>
                        <p>Click points to create the polygon, double-click to finish.</p>
                    </div>

                    <div class="cut-by-polygon-controls">
                        <div class="control-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="cutByPolygonToggle" class="cut-toggle-checkbox">
                                <span class="cut-toggle-slider"></span>
                                <span class="cut-toggle-text">Enable Cut by Polygon</span>
                            </label>
                        </div>
                        <div class="control-group">
                            <label>Cut Depth (meters):</label>
                            <input type="number" id="cutDepthInput" class="number-input" 
                                   value="100" min="1" max="1000" step="10">
                        </div>
                    </div>

                    <div class="cut-by-polygon-actions">
                        <button class="btn btn-primary" id="drawPolygonBtn">
                            <span>✏️</span> Draw Polygon
                        </button>
                        <button class="btn" id="clearCutBtn" style="display: none;">
                            <span>🗑️</span> Clear Cut
                        </button>
                    </div>

                    <div class="cut-by-polygon-info">
                        <p class="info-text">
                            <strong>Note:</strong> This creates a temporary cut in the 3D model. The cut can be toggled on/off and cleared at any time.
                        </p>
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
        this.modal?.querySelector('#closeCutByPolygonBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
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

        // Toggle cut
        document.getElementById('cutByPolygonToggle')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.enableCut();
            } else {
                this.disableCut();
            }
        });

        // Draw polygon
        document.getElementById('drawPolygonBtn')?.addEventListener('click', () => {
            this.startDrawingPolygon();
        });

        // Clear cut
        document.getElementById('clearCutBtn')?.addEventListener('click', () => {
            this.clearCut();
        });

        // Cut depth input
        document.getElementById('cutDepthInput')?.addEventListener('change', (e) => {
            if (this.cutPolygon) {
                this.applyCut();
            }
        });
    }

    /**
     * Show cut by polygon modal
     */
    show() {
        if (this.modal) {
            this.modal.style.display = 'flex';
        }
    }

    /**
     * Hide cut by polygon modal
     */
    hide() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
        this.stopDrawing();
    }

    /**
     * Toggle cut by polygon modal
     */
    toggle() {
        if (this.modal && this.modal.style.display === 'none') {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Start drawing polygon
     */
    startDrawingPolygon() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) {
            if (window.notification) {
                window.notification.error('Viewer not ready');
            }
            return;
        }

        this.stopDrawing();
        this.isDrawing = true;
        this.cutPolygon = {
            points: [],
            entity: null
        };

        const viewer = this.tilesetViewer.viewer;
        viewer.canvas.style.cursor = 'crosshair';

        // Setup handlers
        this.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

        // Click handler
        this.handler.setInputAction((click) => {
            this.handlePolygonClick(click);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // Double-click handler (finish)
        this.handler.setInputAction((click) => {
            this.finishPolygon();
        }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

        // Right-click handler (cancel)
        this.handler.setInputAction((click) => {
            this.cancelPolygon();
        }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

        // Mouse move handler (preview)
        this.handler.setInputAction((movement) => {
            this.handlePolygonMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        // Update UI
        document.getElementById('drawPolygonBtn').style.display = 'none';
        document.getElementById('clearCutBtn').style.display = 'inline-flex';

        if (window.notification) {
            window.notification.info('Click to add polygon points. Double-click to finish.');
        }
    }

    /**
     * Handle polygon click
     */
    handlePolygonClick(click) {
        if (!this.isDrawing || !this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        
        // Try picking from scene first
        const pickedObject = viewer.scene.pick(click.position);
        let cartesian = null;

        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.position) {
            cartesian = pickedObject.id.position.getValue();
        } else {
            cartesian = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
        }

        if (!cartesian) return;

        this.cutPolygon.points.push(cartesian);
        this.updatePolygonVisualization();
    }

    /**
     * Handle polygon mouse move
     */
    handlePolygonMouseMove(movement) {
        if (!this.isDrawing || !this.cutPolygon || this.cutPolygon.points.length === 0) return;

        const viewer = this.tilesetViewer.viewer;
        const cartesian = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid);
        
        if (cartesian) {
            this.updatePolygonPreview(cartesian);
        }
    }

    /**
     * Update polygon visualization
     */
    updatePolygonVisualization() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer || !this.cutPolygon) return;

        const viewer = this.tilesetViewer.viewer;

        // Remove existing entity
        if (this.cutPolygon.entity) {
            viewer.entities.remove(this.cutPolygon.entity);
        }
        if (this.vertexMarkerEntities.length > 0) {
            this.vertexMarkerEntities.forEach((entity) => viewer.entities.remove(entity));
            this.vertexMarkerEntities = [];
        }

        if (this.cutPolygon.points.length < 2) return;

        // Create polygon outline
        if (this.cutPolygon.points.length >= 3) {
            // Closed polygon
            this.cutPolygon.entity = viewer.entities.add({
                polygon: {
                    hierarchy: this.cutPolygon.points,
                    material: Cesium.Color.RED.withAlpha(0.3),
                    outline: true,
                    outlineColor: Cesium.Color.RED,
                    height: 0,
                    extrudedHeight: -1000 // Extrude downward to create cut effect
                }
            });
        } else {
            // Open polyline
            this.cutPolygon.entity = viewer.entities.add({
                polyline: {
                    positions: this.cutPolygon.points,
                    width: 3,
                    material: Cesium.Color.RED,
                    clampToGround: true
                }
            });
        }

        // Add point markers
        this.cutPolygon.points.forEach((point, index) => {
            const marker = viewer.entities.add({
                position: point,
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.RED,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2
                },
                label: {
                    text: String(index + 1),
                    font: '14px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -20)
                }
            });
            this.vertexMarkerEntities.push(marker);
        });
    }

    /**
     * Update polygon preview
     */
    updatePolygonPreview(previewPosition) {
        // Remove preview entity
        if (this.previewEntity) {
            this.tilesetViewer.viewer.entities.remove(this.previewEntity);
        }

        if (!this.cutPolygon || this.cutPolygon.points.length === 0) return;

        const lastPoint = this.cutPolygon.points[this.cutPolygon.points.length - 1];
        
        // Create preview line
        this.previewEntity = this.tilesetViewer.viewer.entities.add({
            polyline: {
                positions: [lastPoint, previewPosition],
                width: 2,
                material: Cesium.Color.RED.withAlpha(0.5),
                clampToGround: true
            }
        });
    }

    /**
     * Finish polygon
     */
    finishPolygon() {
        if (!this.cutPolygon || this.cutPolygon.points.length < 3) {
            if (window.notification) {
                window.notification.warning('Polygon needs at least 3 points');
            }
            return;
        }

        this.stopDrawing();
        this.applyCut();

        if (window.notification) {
            window.notification.success('Polygon cut created');
        }
    }

    /**
     * Cancel polygon
     */
    cancelPolygon() {
        if (!this.cutPolygon) return;

        const viewer = this.tilesetViewer?.viewer;
        if (viewer && this.cutPolygon.entity) {
            viewer.entities.remove(this.cutPolygon.entity);
        }

        this.cutPolygon = null;
        this.isActive = false;
        this.stopDrawing();

        if (window.notification) {
            window.notification.info('Polygon drawing cancelled');
        }
    }

    /**
     * Apply cut to 3D model
     */
    applyCut() {
        if (!this.cutPolygon || this.cutPolygon.points.length < 3) return;

        const viewer = this.tilesetViewer.viewer;
        const cutDepth = parseFloat(document.getElementById('cutDepthInput')?.value || '100');

        // Remove existing cut entity
        if (this.cutEntity) {
            viewer.entities.remove(this.cutEntity);
        }

        // Create cut visualization (black hole effect)
        // Use a polygon with extruded height to create the cut
        this.cutEntity = viewer.entities.add({
            polygon: {
                hierarchy: this.cutPolygon.points,
                material: Cesium.Color.BLACK.withAlpha(0.9),
                outline: true,
                outlineColor: Cesium.Color.RED,
                height: 0,
                extrudedHeight: -cutDepth, // Extrude downward
                closeTop: false, // Open top to show cut
                closeBottom: true // Close bottom
            }
        });

        // Also create a clipping plane effect using Cesium's clipping planes
        // This requires modifying the tileset's clipping planes
        this.applyClippingPlanes();

        // Enable cut toggle
        document.getElementById('cutByPolygonToggle').checked = true;
        this.enableCut();
    }

    /**
     * Apply clipping planes to tilesets
     */
    applyClippingPlanes() {
        if (!this.tilesetViewer || !this.cutPolygon || this.cutPolygon.points.length < 3) return;

        const viewer = this.tilesetViewer.viewer;
        const tilesets = this.tilesetViewer.getAllTilesets();

        // Calculate plane from polygon
        // For simplicity, create a vertical plane
        const center = this.calculatePolygonCenter(this.cutPolygon.points);
        const normal = Cesium.Cartesian3.UNIT_Z; // Vertical plane

        tilesets.forEach(tilesetData => {
            const tileset = tilesetData.tileset;
            if (tileset && tileset.root) {
                if (!this.originalClippingCollections.has(tileset)) {
                    this.originalClippingCollections.set(tileset, tileset.clippingPlanes || null);
                }
                // Create clipping plane
                const clippingPlane = new Cesium.ClippingPlane(
                    normal,
                    -Cesium.Cartesian3.dot(normal, center)
                );

                // Apply clipping plane to tileset
                if (!this.createdClippingCollections.has(tileset)) {
                    const collection = new Cesium.ClippingPlaneCollection({
                        planes: [clippingPlane],
                        enabled: true
                    });
                    tileset.clippingPlanes = collection;
                    this.createdClippingCollections.set(tileset, collection);
                } else {
                    const collection = this.createdClippingCollections.get(tileset);
                    collection.removeAll();
                    collection.add(clippingPlane);
                }
            }
        });
    }

    /**
     * Calculate polygon center
     */
    calculatePolygonCenter(points) {
        const sum = new Cesium.Cartesian3(0, 0, 0);
        points.forEach(point => {
            Cesium.Cartesian3.add(sum, point, sum);
        });
        return Cesium.Cartesian3.multiplyByScalar(sum, 1.0 / points.length, new Cesium.Cartesian3());
    }

    /**
     * Enable cut
     */
    enableCut() {
        if (!this.cutEntity) return;

        this.isActive = true;
        const viewer = this.tilesetViewer.viewer;

        // Show cut entity
        this.cutEntity.show = true;

        // Enable clipping planes
        const tilesets = this.tilesetViewer.getAllTilesets();
        tilesets.forEach(tilesetData => {
            const tileset = tilesetData.tileset;
            if (tileset && tileset.clippingPlanes) {
                tileset.clippingPlanes.enabled = true;
            }
        });

        if (window.notification) {
            window.notification.info('Cut enabled');
        }

        if (window.app && typeof window.app.setToolStatus === 'function') {
            window.app.setToolStatus('Polygon cut active — tileset clipping enabled');
        }
    }

    /**
     * Disable cut
     */
    disableCut() {
        if (!this.cutEntity) return;

        this.isActive = false;
        const viewer = this.tilesetViewer.viewer;

        // Hide cut entity
        this.cutEntity.show = false;

        // Disable clipping planes
        const tilesets = this.tilesetViewer.getAllTilesets();
        tilesets.forEach(tilesetData => {
            const tileset = tilesetData.tileset;
            if (tileset && tileset.clippingPlanes) {
                tileset.clippingPlanes.enabled = false;
            }
        });

        if (window.notification) {
            window.notification.info('Cut disabled');
        }

        if (window.app && typeof window.app.clearToolStatus === 'function') {
            window.app.clearToolStatus();
        }
    }

    /**
     * Clear cut
     */
    clearCut() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;

        // Remove entities
        if (this.cutPolygon && this.cutPolygon.entity) {
            viewer.entities.remove(this.cutPolygon.entity);
        }
        if (this.cutEntity) {
            viewer.entities.remove(this.cutEntity);
        }
        if (this.previewEntity) {
            viewer.entities.remove(this.previewEntity);
        }
        if (this.vertexMarkerEntities.length > 0) {
            this.vertexMarkerEntities.forEach((entity) => viewer.entities.remove(entity));
            this.vertexMarkerEntities = [];
        }

        // Restore clipping planes only for tilesets touched by this manager
        this.createdClippingCollections.forEach((collection, tileset) => {
            if (tileset) {
                const original = this.originalClippingCollections.get(tileset) || null;
                if (original) {
                    tileset.clippingPlanes = original;
                } else if (tileset.clippingPlanes === collection) {
                    tileset.clippingPlanes = null;
                }
            }
        });
        this.createdClippingCollections.clear();
        this.originalClippingCollections.clear();

        // Reset state
        this.cutPolygon = null;
        this.cutEntity = null;
        this.previewEntity = null;
        this.isActive = false;

        // Update UI
        document.getElementById('cutByPolygonToggle').checked = false;
        document.getElementById('drawPolygonBtn').style.display = 'inline-flex';
        document.getElementById('clearCutBtn').style.display = 'none';

        this.stopDrawing();

        if (window.notification) {
            window.notification.success('Cut cleared');
        }

        if (window.app && typeof window.app.clearToolStatus === 'function') {
            window.app.clearToolStatus();
        }
    }

    /**
     * Stop drawing
     */
    stopDrawing() {
        this.isDrawing = false;

        if (this.handler) {
            this.handler.destroy();
            this.handler = null;
        }

        // Remove preview
        if (this.previewEntity) {
            this.tilesetViewer.viewer.entities.remove(this.previewEntity);
            this.previewEntity = null;
        }

        const viewer = this.tilesetViewer?.viewer;
        if (viewer) {
            viewer.canvas.style.cursor = 'default';
        }
    }

    /**
     * Activate cut tool - show modal and start drawing
     * Called by toolbar "Start Cut" button
     */
    activate() {
        this.isActive = true;
        this.show();
        if (this.tilesetViewer && this.tilesetViewer.viewer) {
            this.startDrawingPolygon();
        } else {
            this.isActive = false;
            if (window.notification) {
                window.notification.warning('Viewer not ready. Please wait for tileset to load.');
            }
        }
    }

    /**
     * Start cutting - alias for activate
     * Called by toolbar "Start Cut" button
     */
    startCutting() {
        this.activate();
    }

    /**
     * Cancel current cut operation
     * Called by toolbar "Cancel Cut" button
     */
    cancel() {
        if (this.isDrawing) {
            this.cancelPolygon();
        } else if (this.cutPolygon || this.cutEntity) {
            this.clearCut();
        } else {
            this.isActive = false;
            this.hide();
        }
    }

    /**
     * Deactivate cut tool
     * Called by toolbar "Cancel Cut" button
     */
    deactivate() {
        this.cancel();
    }

    /**
     * Handle map click for control governance (cut tool active).
     * Returns true when cut tool is active so other tools do not handle the event.
     */
    handleClick(event) {
        return this.isActive;
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.cutByPolygonManager = new CutByPolygonManager();
}
