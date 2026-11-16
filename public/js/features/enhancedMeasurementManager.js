/**
 * EnhancedMeasurementManager
 * Advanced measurement tools (Meridian Design - Pages 24-31)
 * Features: Distance, Area, Height, Angle, Complex Polygons, Square meter units
 */

class EnhancedMeasurementManager {
    constructor() {
        this.tilesetViewer = null;
        this.modal = null;
        this.toolbar = null;
        this.measurements = [];
        this.isMeasuring = false;
        this.currentMeasurement = null;
        this.measurementType = null;
        this.handler = null;
        this.entities = [];
        this._useIonSdkOnly = !!window.__preferIonSdkMeasurements;
        /** When true, first new click replaces picks for two-point measurement types */
        this._editFirstPointAdd = false;
        this.init();
    }

    /**
     * Initialize enhanced measurement manager
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;

        if (this._useIonSdkOnly) {
            return;
        }
        
        // Load configuration from JSON
        if (window.jsonConfigManager) {
            const config = window.jsonConfigManager.getFeatureConfig('measurement');
            if (config) {
                this.accuracy = config.accuracy || 0.1;
                this.requireZoom = config.requireZoom !== false;
            }
        }
        
        this.createMeasurementModal();
        this.createToolbar();
        this.setupEventHandlers();
    }

    /**
     * Create measurement modal
     */
    createMeasurementModal() {
        // Remove existing if any
        const existing = document.getElementById('measurementModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'measurementModal';
        modal.className = 'measurement-modal';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="measurement-modal-content">
                <div class="measurement-modal-header">
                    <h2>Measurement Tools</h2>
                    <button class="close-btn" id="closeMeasurementBtn">×</button>
                </div>
                <div class="measurement-modal-body">
                    <div class="measurement-icon-container">
                        <div class="measurement-icon">
                            <div class="ruler-icon"></div>
                        </div>
                    </div>
                    <div class="measurement-instructions">
                        <p>Clicking this button will open a secondary toolbar with all advanced measurement tools.</p>
                    </div>
                    <div class="measurement-accuracy-notes">
                        <p class="accuracy-note">* The measurement deviation range on the 3D model is only 10 centimeters.</p>
                        <p class="accuracy-note">** You must zoom in on the model to accurately measure.</p>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
    }

    /**
     * Create measurement toolbar
     */
    createToolbar() {
        // Remove existing if any
        const existing = document.getElementById('measurementToolbar');
        if (existing) {
            existing.remove();
        }

        const toolbar = document.createElement('div');
        toolbar.id = 'measurementToolbar';
        toolbar.className = 'measurement-toolbar';
        toolbar.style.display = 'none';

        toolbar.innerHTML = `
            <div class="measurement-toolbar-content">
                <div class="measurement-tool-header">
                    <div class="measurement-tool-header-text">
                        <h3 id="measurementToolTitle">Measurement Tools</h3>
                        <p class="measurement-tool-subtitle">Pick a tool, then click directly in the 3D scene (right-click to finish, Esc to cancel).</p>
                    </div>
                    <button type="button" class="close-btn" id="closeMeasurementToolbarBtn" aria-label="Close measurement toolbar">×</button>
                </div>
                <div class="measurement-tool-group-label">Distance, Surface &amp; 3D Geometry</div>
                <div class="measurement-tools-grid" role="list">
                    <div class="measurement-tool-item" role="button" tabindex="0" data-type="distance-point" title="Point-to-Point Distance">
                        <div class="tool-icon" aria-hidden="true"><i class="fas fa-ruler-horizontal"></i></div>
                        <div class="tool-content">
                            <div class="tool-label">Point Distance</div>
                            <div class="tool-description">Two-point 3D &amp; geodesic distance</div>
                        </div>
                    </div>
                    <div class="measurement-tool-item" role="button" tabindex="0" data-type="ruler" title="3D Segmented Ruler">
                        <div class="tool-icon" aria-hidden="true"><i class="fas fa-ruler-combined"></i></div>
                        <div class="tool-content">
                            <div class="tool-label">3D Ruler</div>
                            <div class="tool-description">Distance + ΔZ + azimuth readout</div>
                        </div>
                    </div>
                    <div class="measurement-tool-item" role="button" tabindex="0" data-type="polyline" title="Polyline/Path Measurement">
                        <div class="tool-icon" aria-hidden="true"><i class="fas fa-route"></i></div>
                        <div class="tool-content">
                            <div class="tool-label">Polyline</div>
                            <div class="tool-description">Multi-segment path length</div>
                        </div>
                    </div>
                    <div class="measurement-tool-item" role="button" tabindex="0" data-type="height" title="Vertical Height Measurement">
                        <div class="tool-icon" aria-hidden="true"><i class="fas fa-arrows-alt-v"></i></div>
                        <div class="tool-content">
                            <div class="tool-label">Height</div>
                            <div class="tool-description">Vertical elevation delta</div>
                        </div>
                    </div>
                    <div class="measurement-tool-item" role="button" tabindex="0" data-type="area" title="Area Measurement (Polygon)">
                        <div class="tool-icon" aria-hidden="true"><i class="fas fa-draw-polygon"></i></div>
                        <div class="tool-content">
                            <div class="tool-label">Area</div>
                            <div class="tool-description">Planar area in m²/ha/km²</div>
                        </div>
                    </div>
                    <div class="measurement-tool-item" role="button" tabindex="0" data-type="roof-area" title="3D Inclined Plane / Surface Area">
                        <div class="tool-icon" aria-hidden="true"><i class="fas fa-vector-square"></i></div>
                        <div class="tool-content">
                            <div class="tool-label">Plane / Surface</div>
                            <div class="tool-description">True 3D sloped roof/facade area</div>
                        </div>
                    </div>
                    <div class="measurement-tool-item" role="button" tabindex="0" data-type="volume" title="3D Prism Volume">
                        <div class="tool-icon" aria-hidden="true"><i class="fas fa-cube"></i></div>
                        <div class="tool-content">
                            <div class="tool-label">Volume</div>
                            <div class="tool-description">Footprint × elevation span (m³)</div>
                        </div>
                    </div>
                    <div class="measurement-tool-item" role="button" tabindex="0" data-type="angle" title="Angle Measurement">
                        <div class="tool-icon" aria-hidden="true"><i class="fas fa-drafting-compass"></i></div>
                        <div class="tool-content">
                            <div class="tool-label">Angle</div>
                            <div class="tool-description">Three-point angle in degrees</div>
                        </div>
                    </div>
                </div>
                <div class="measurement-tool-actions">
                    <button type="button" class="btn btn-sm" id="exportMeasurementsGeoJsonBtn" title="Export measurements as 3D GeoJSON"><i class="fas fa-file-export" aria-hidden="true"></i> GeoJSON</button>
                    <button type="button" class="btn btn-sm" id="exportMeasurementsCsvBtn" title="Export measurements as CSV with WGS84 &amp; UTM"><i class="fas fa-file-csv" aria-hidden="true"></i> CSV</button>
                    <button type="button" class="btn btn-danger btn-sm" id="clearAllMeasurementsBtn">Clear All</button>
                    <button type="button" class="btn btn-sm" id="closeMeasurementToolbarBtn2">Close</button>
                </div>
                <div id="measurementStatus" class="tool-status ready" role="status" aria-live="polite">Ready</div>
                <div class="measurement-result-panel">
                    <div class="result-item">
                        <div class="result-label">Latest Result:</div>
                        <div class="result-value" id="measurementResultValue">--</div>
                    </div>
                </div>
            </div>
        `;

        document.querySelector('.viewer-container')?.appendChild(toolbar);
        this.toolbar = toolbar;
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Modal close
        document.getElementById('closeMeasurementBtn')?.addEventListener('click', () => {
            this.hideModal();
        });

        // Toolbar close
        document.getElementById('closeMeasurementToolbarBtn')?.addEventListener('click', () => {
            this.hideToolbar();
        });

        document.getElementById('closeMeasurementToolbarBtn2')?.addEventListener('click', () => {
            this.hideToolbar();
        });

        // Tool selection (click + Enter/Space keyboard activation)
        document.querySelectorAll('.measurement-tool-item').forEach(item => {
            const activate = () => {
                const type = item.dataset.type;
                this.selectMeasurementType(type);
            };
            item.addEventListener('click', activate);
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate();
                }
            });
        });

        // Export GeoJSON / CSV
        document.getElementById('exportMeasurementsGeoJsonBtn')?.addEventListener('click', () => {
            this.exportGeoJSON();
        });
        document.getElementById('exportMeasurementsCsvBtn')?.addEventListener('click', () => {
            this.exportCSV();
        });

        // Clear all
        document.getElementById('clearAllMeasurementsBtn')?.addEventListener('click', () => {
            this.clearAllMeasurements();
        });
    }

    /**
     * Show measurement modal
     */
    showModal() {
        if (this.modal) {
            this.modal.style.display = 'flex';
        }
    }

    /**
     * Hide measurement modal
     */
    hideModal() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
        // Show toolbar when modal is closed
        this.showToolbar();
    }

    /**
     * Show measurement toolbar
     */
    showToolbar() {
        if (this.toolbar) {
            // Position as side pop-up on the right (or left if no space)
            this.toolbar.style.display = 'block';
            this.toolbar.style.position = 'fixed';
            this.toolbar.style.top = '80px';
            this.toolbar.style.zIndex = window.simplexUILayer
                ? window.simplexUILayer.zIndex('MEASUREMENT_TOOLBAR')
                : '10001';
            
            // Smart positioning - check available space
            const toolbarWidth = 400; // Max width
            const spacing = 20;
            const rightSpace = window.innerWidth - spacing;
            
            if (rightSpace >= toolbarWidth + spacing) {
                // Position on right
                this.toolbar.style.right = `${spacing}px`;
                this.toolbar.style.left = 'auto';
                this.toolbar.style.transform = 'none';
            } else {
                // Position on left if right doesn't have space
                this.toolbar.style.left = `${spacing}px`;
                this.toolbar.style.right = 'auto';
                this.toolbar.style.transform = 'none';
            }
        }
    }

    /**
     * Hide measurement toolbar
     */
    hideToolbar() {
        if (this.toolbar) {
            this.toolbar.style.display = 'none';
        }
        this.stopMeasurement();
    }

    /**
     * Select measurement type
     */
    selectMeasurementType(type) {
        if (this._useIonSdkOnly) {
            const f = window.ionSdkToolsFacade;
            if (f && typeof f.activateMeasurementType === 'function' && f.activateMeasurementType(type)) {
                return;
            }
            if (window.notification && typeof window.notification.info === 'function') {
                window.notification.info(
                    window.appI18n?.nt
                        ? window.appI18n.nt('measureUseIonBarZh')
                        : 'Use the Ion measurement controls in the Cesium toolbar at the top of the 3D view.'
                );
            }
            return;
        }
        this.measurementType = type;
        this.startMeasurement(type);
        this.setStatus('ready', `Ready: ${type}. Click points in scene.`);

        // Update UI
        document.querySelectorAll('.measurement-tool-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.type === type) {
                item.classList.add('active');
            }
        });

        // Update title
        const title = document.getElementById('measurementToolTitle');
        if (title) {
            const labels = {
                'distance-point': 'Distance (Point-to-Point)',
                'polyline': 'Polyline Measurement',
                'height': 'Height Measurement',
                'distance-line': 'Line Distance',
                'vertical-segment': 'Vertical Segment',
                'area': 'Area Measurement',
                'angle': 'Angle Measurement'
            };
            title.textContent = labels[type] || 'Measurement Tools';
        }
    }

    /**
     * Compatibility alias used by toolbar/fallback integrations
     */
    activateTool(type) {
        this.selectMeasurementType(type);
    }

    /**
     * @param {string} type
     * @param {Cesium.Cartesian3[]|null} [initialPoints] - when set, continues an edit with existing picks
     */
    startMeasurement(type, initialPoints) {
        if (this._useIonSdkOnly) {
            return;
        }
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        // Normalize documented shorthand measurement type names ('distance', 'plane', 'surface', 'ruler')
        const TYPE_ALIASES = {
            distance: 'distance-point',
            ruler: 'polyline',
            plane: 'roof-area',
            surface: 'roof-area',
        };
        const resolvedType = TYPE_ALIASES[type] || type;
        type = resolvedType;

        this.stopMeasurement(); // Stop any existing measurement

        this.isMeasuring = true;
        this.measurementType = type;
        const pts =
            initialPoints && initialPoints.length > 0
                ? initialPoints.map((p) => Cesium.Cartesian3.clone(p, new Cesium.Cartesian3()))
                : [];
        this.currentMeasurement = {
            type: type,
            points: pts,
            entities: [],
            labels: []
        };

        const typeLabels = {
            'distance-point': 'point distance',
            'polyline': 'polyline',
            'height': 'height',
            'distance-line': 'line distance',
            'vertical-segment': 'vertical segment',
            'area': 'area',
            'angle': 'angle',
            'building-height': 'building height',
            'building-width': 'width',
            'building-length': 'length',
            'building-dimensions': 'dimensions',
            'volume': 'volume',
            'roof-area': 'roof area',
            'slope': 'slope'
        };
        const human = typeLabels[type] || type;
        const editing = initialPoints && initialPoints.length > 0;
        if (window.app && typeof window.app.setToolStatus === 'function') {
            window.app.setToolStatus(
                editing
                    ? `Editing (${human}) — click to add points, double-click or right-click to finish`
                    : `Measuring (${human}) — click on the 3D surface`
            );
        }

        const viewer = this.tilesetViewer.viewer;
        viewer.canvas.style.cursor = 'crosshair';

        // Setup handlers
        this.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

        // Click handler
        this.handler.setInputAction((click) => {
            this.handleClick(click);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // Double-click handler (complete measurement)
        this.handler.setInputAction((click) => {
            this.handleDoubleClick(click);
        }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

        // Right-click handler (cancel/complete)
        this.handler.setInputAction((click) => {
            this.completeMeasurement();
        }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

        // Mouse move handler (for preview)
        this.handler.setInputAction((movement) => {
            this.handleMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        if (editing) {
            this.updateVisualization();
        }

        const instructions = {
            'distance-point': 'Click two points to measure distance',
            'polyline': 'Click multiple points, double-click to finish',
            'height': 'Click base point, then top point to measure height',
            'distance-line': 'Click two points to measure line distance',
            'vertical-segment': 'Click two points for vertical segment',
            'area': 'Click points to create polygon, double-click to finish',
            'angle': 'Click three points to measure angle',
            'building-height': 'Click base, then top on the 3D model (height)',
            'building-width': 'Click two points across the width on the model',
            'building-length': 'Click along the length; double-click to finish',
            'building-dimensions': 'Click two corners for a reference distance on the model',
            'volume': 'Outline a base polygon; double-click to finish (area-based)',
            'roof-area': 'Click roof corners; double-click to finish',
            'slope': 'Click points; double-click to finish (see status for slope where supported)'
        };

        if (window.notification) {
            window.notification.info(
                editing
                    ? 'Editing: add more points or double-click / right-click to save.'
                    : instructions[type] || 'Click on the map to add points'
            );
        }
    }

    /**
     * Resolve a measurement from a picked Cesium entity (used by feature interaction).
     * @param {Cesium.Entity} entity
     * @returns {object|undefined}
     */
    findMeasurementByEntity(entity) {
        if (!entity || !this.measurements || this.measurements.length === 0) {
            return undefined;
        }
        for (const m of this.measurements) {
            if (m.entities && m.entities.indexOf(entity) !== -1) {
                return m;
            }
            if (m.labels && m.labels.indexOf(entity) !== -1) {
                return m;
            }
        }
        return undefined;
    }

    /**
     * Remove a completed measurement from the list and re-open it for editing.
     * @param {object} measurement
     * @returns {boolean}
     */
    beginEditMeasurement(measurement) {
        if (this._useIonSdkOnly) {
            if (window.notification && typeof window.notification.info === 'function') {
                window.notification.info(
                    window.appI18n?.nt
                        ? window.appI18n.nt('measureEditIonActive')
                        : 'Edit is not available when Ion SDK measurements are active.'
                );
            }
            return false;
        }
        if (!measurement || !this.tilesetViewer || !this.tilesetViewer.viewer) {
            return false;
        }
        const idx = this.measurements.indexOf(measurement);
        if (idx === -1) {
            return false;
        }

        const viewer = this.tilesetViewer.viewer;
        this.measurements.splice(idx, 1);
        if (measurement.entities) {
            measurement.entities.forEach((e) => viewer.entities.remove(e));
        }
        if (measurement.labels) {
            measurement.labels.forEach((l) => viewer.entities.remove(l));
        }

        this.showToolbar();
        document.querySelectorAll('.measurement-tool-item').forEach((item) => {
            item.classList.remove('active');
            if (item.dataset.type === measurement.type) {
                item.classList.add('active');
            }
        });
        const title = document.getElementById('measurementToolTitle');
        if (title) {
            const labels = {
                'distance-point': 'Distance (Point-to-Point)',
                polyline: 'Polyline Measurement',
                height: 'Height Measurement',
                'distance-line': 'Line Distance',
                'vertical-segment': 'Vertical Segment',
                area: 'Area Measurement',
                angle: 'Angle Measurement'
            };
            title.textContent = `Edit: ${labels[measurement.type] || measurement.type}`;
        }

        this.startMeasurement(measurement.type, measurement.points);
        const twoPointTypes = [
            'distance-point',
            'height',
            'distance-line',
            'vertical-segment',
            'building-height',
            'building-width',
            'building-dimensions'
        ];
        this._editFirstPointAdd = !!(
            measurement.points &&
            measurement.points.length >= 2 &&
            twoPointTypes.includes(measurement.type)
        );
        this.setLatestResult(measurement.result || '--');
        this.setStatus('ready', 'Editing — add points or finish with double-click / right-click');
        return true;
    }

    setStatus(kind, message) {
        const statusEl = document.getElementById('measurementStatus');
        if (!statusEl) return;
        statusEl.className = `tool-status ${kind}`;
        statusEl.textContent = message;
    }

    formatDistance(meters) {
        if (!Number.isFinite(meters)) return '--';
        if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
        return `${meters.toFixed(2)} m`;
    }

    formatArea(squareMeters) {
        if (!Number.isFinite(squareMeters)) return '--';
        if (squareMeters >= 1000000) return `${(squareMeters / 1000000).toFixed(3)} km²`;
        if (squareMeters >= 10000) return `${(squareMeters / 10000).toFixed(2)} ha`;
        return `${squareMeters.toFixed(2)} m²`;
    }

    setLatestResult(text) {
        const resultEl = document.getElementById('measurementResultValue');
        if (resultEl) {
            resultEl.textContent = text || '--';
        }
    }

    /**
     * Pick a world position on 3D Tiles / layers first, then ellipsoid.
     */
    pickSurfacePosition(viewer, screenPosition) {
        const scene = viewer.scene;
        if (!scene) {
            return null;
        }
        if (scene.pickPositionSupported) {
            const onSurface = scene.pickPosition(screenPosition);
            if (Cesium.defined(onSurface)) {
                return onSurface;
            }
        }
        const picked = scene.pick(screenPosition);
        if (Cesium.defined(picked) && picked.id) {
            const entity = picked.id;
            if (entity && entity.position) {
                const t = viewer.clock ? viewer.clock.currentTime : Cesium.JulianDate.now();
                const pos = entity.position.getValue(t);
                if (Cesium.defined(pos)) {
                    return pos;
                }
            }
        }
        return viewer.camera.pickEllipsoid(screenPosition, scene.globe.ellipsoid);
    }

    /**
     * Handle click
     */
    handleClick(click) {
        if (!this.isMeasuring || !this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const cartesian = this.pickSurfacePosition(viewer, click.position);

        if (!cartesian) {
            return;
        }

        this.addPoint(cartesian);
    }

    /**
     * Handle double click
     */
    handleDoubleClick(click) {
        if (!this.isMeasuring) return;
        
        // Complete measurement on double-click
        if (this.currentMeasurement && this.currentMeasurement.points.length >= 2) {
            this.completeMeasurement();
        }
    }

    /**
     * Handle mouse move
     */
    handleMouseMove(movement) {
        if (!this.isMeasuring || !this.currentMeasurement) return;

        const viewer = this.tilesetViewer.viewer;
        const cartesian = this.pickSurfacePosition(viewer, movement.endPosition);

        if (cartesian && this.currentMeasurement.points.length > 0) {
            this.updatePreview(cartesian);
        }
    }

    /**
     * Add measurement point
     */
    addPoint(position) {
        if (!this.currentMeasurement) return;

        const twoPointTypes = [
            'distance-point',
            'height',
            'distance-line',
            'vertical-segment',
            'building-height',
            'building-width',
            'building-dimensions'
        ];
        if (
            this._editFirstPointAdd &&
            twoPointTypes.includes(this.measurementType) &&
            this.currentMeasurement.points.length >= 2
        ) {
            this._editFirstPointAdd = false;
            this.currentMeasurement.points = [position];
            this.updateVisualization();
            if (window.app && typeof window.app.setToolStatus === 'function') {
                window.app.setToolStatus(
                    `Editing (${this.measurementType}) — place the second point`
                );
            }
            return;
        }

        this.currentMeasurement.points.push(position);
        this.updateVisualization();

        if (window.app && typeof window.app.setToolStatus === 'function') {
            const n = this.currentMeasurement.points.length;
            window.app.setToolStatus(
                `Measuring (${this.measurementType}): ${n} point(s) — double-click or right-click to finish`
            );
        }

        // Auto-complete for certain types
        if (this.measurementType === 'distance-point' && this.currentMeasurement.points.length === 2) {
            setTimeout(() => this.completeMeasurement(), 100);
        } else if (this.measurementType === 'height' && this.currentMeasurement.points.length === 2) {
            setTimeout(() => this.completeMeasurement(), 100);
        } else if (this.measurementType === 'building-height' && this.currentMeasurement.points.length === 2) {
            setTimeout(() => this.completeMeasurement(), 100);
        } else if (this.measurementType === 'building-width' && this.currentMeasurement.points.length === 2) {
            setTimeout(() => this.completeMeasurement(), 100);
        } else if (this.measurementType === 'building-dimensions' && this.currentMeasurement.points.length === 2) {
            setTimeout(() => this.completeMeasurement(), 100);
        } else if (this.measurementType === 'angle' && this.currentMeasurement.points.length === 3) {
            setTimeout(() => this.completeMeasurement(), 100);
        }
    }

    /**
     * Update preview
     */
    updatePreview(previewPosition) {
        // Remove preview entity
        if (this.previewEntity) {
            this.tilesetViewer.viewer.entities.remove(this.previewEntity);
        }

        if (!this.currentMeasurement || this.currentMeasurement.points.length === 0) return;

        const viewer = this.tilesetViewer.viewer;
        const lastPoint = this.currentMeasurement.points[this.currentMeasurement.points.length - 1];
        
        // Elevate preview points above terrain
        const elevatePoint = (point) => {
            if (this.measurementType === 'height' || this.measurementType === 'building-height') {
                return point; // Keep original for height measurements
            }
            const cartographic = Cesium.Cartographic.fromCartesian(point);
            const height = viewer.scene.globe.getHeight(cartographic) || 0;
            return Cesium.Cartesian3.fromRadians(
                cartographic.longitude,
                cartographic.latitude,
                cartographic.height + Math.max(5, height * 0.01)
            );
        };

        const elevatedLastPoint = elevatePoint(lastPoint);
        const elevatedPreviewPosition = elevatePoint(previewPosition);
        
        // Create preview line
        this.previewEntity = viewer.entities.add({
            polyline: {
                positions: [elevatedLastPoint, elevatedPreviewPosition],
                width: 4, // Increased width
                material: Cesium.Color.CYAN.withAlpha(0.7), // Increased opacity
                clampToGround: false, // Don't clamp to ground
                heightReference: Cesium.HeightReference.NONE
            },
            disableDepthTestDistance: Number.POSITIVE_INFINITY // Always render above everything
        });
    }

    /**
     * Update visualization
     */
    updateVisualization() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer || !this.currentMeasurement) return;

        const viewer = this.tilesetViewer.viewer;

        // Remove existing entities
        this.currentMeasurement.entities.forEach(entity => {
            viewer.entities.remove(entity);
        });
        this.currentMeasurement.entities = [];

        // Add point markers
        this.currentMeasurement.points.forEach((point, index) => {
            // Elevate point slightly above terrain for better visibility
            const cartographic = Cesium.Cartographic.fromCartesian(point);
            const height = viewer.scene.globe.getHeight(cartographic) || 0;
            const elevatedPoint = Cesium.Cartesian3.fromRadians(
                cartographic.longitude,
                cartographic.latitude,
                cartographic.height + Math.max(5, height * 0.01) // Add at least 5m or 1% of terrain height
            );

            const pointEntity = viewer.entities.add({
                position: elevatedPoint,
                point: {
                    pixelSize: 16,
                    color: Cesium.Color.YELLOW,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 3,
                    heightReference: Cesium.HeightReference.NONE,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY // Always render above everything
                },
                label: {
                    text: String(index + 1),
                    font: 'bold 16px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 4,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -25),
                    backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
                    backgroundPadding: new Cesium.Cartesian2(6, 4),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY // Always render above everything
                }
            });
            this.currentMeasurement.entities.push(pointEntity);
        });

        // Draw lines/polygons based on type
        if (this.measurementType === 'area' && this.currentMeasurement.points.length >= 3) {
            // Elevate polygon points above terrain
            const elevatedPolygonPoints = this.currentMeasurement.points.map(point => {
                const cartographic = Cesium.Cartographic.fromCartesian(point);
                const height = viewer.scene.globe.getHeight(cartographic) || 0;
                return Cesium.Cartesian3.fromRadians(
                    cartographic.longitude,
                    cartographic.latitude,
                    cartographic.height + Math.max(5, height * 0.01)
                );
            });

            // Polygon for area
            const polygonEntity = viewer.entities.add({
                polygon: {
                    hierarchy: elevatedPolygonPoints,
                    material: Cesium.Color.YELLOW.withAlpha(0.3),
                    outline: true,
                    outlineColor: Cesium.Color.YELLOW,
                    heightReference: Cesium.HeightReference.NONE
                },
                disableDepthTestDistance: Number.POSITIVE_INFINITY // Always render above everything
            });
            this.currentMeasurement.entities.push(polygonEntity);
        } else if (this.currentMeasurement.points.length >= 2) {
            // Elevate polyline points above terrain for better visibility
            const elevatedLinePoints = this.currentMeasurement.points.map(point => {
                if (this.measurementType === 'height' || this.measurementType === 'building-height') {
                    // For height measurements, keep original positions
                    return point;
                }
                const cartographic = Cesium.Cartographic.fromCartesian(point);
                const height = viewer.scene.globe.getHeight(cartographic) || 0;
                return Cesium.Cartesian3.fromRadians(
                    cartographic.longitude,
                    cartographic.latitude,
                    cartographic.height + Math.max(5, height * 0.01) // Add at least 5m or 1% of terrain height
                );
            });

            // Polyline for distance/path
            const polylineEntity = viewer.entities.add({
                polyline: {
                    positions: elevatedLinePoints,
                    width: 5, // Increased width for better visibility
                    material: Cesium.Color.YELLOW,
                    clampToGround: false, // Don't clamp to ground - use elevated positions
                    heightReference: Cesium.HeightReference.NONE
                },
                disableDepthTestDistance: Number.POSITIVE_INFINITY // Always render above everything
            });
            this.currentMeasurement.entities.push(polylineEntity);
        }

        // Add measurement labels
        this.addMeasurementLabels();
    }

    /**
     * Add measurement labels
     */
    addMeasurementLabels() {
        if (!this.currentMeasurement || this.currentMeasurement.points.length < 2) return;

        const viewer = this.tilesetViewer.viewer;

        // Remove existing labels
        this.currentMeasurement.labels.forEach(label => {
            viewer.entities.remove(label);
        });
        this.currentMeasurement.labels = [];

        if (this.measurementType === 'distance-point' || this.measurementType === 'distance-line'
            || this.measurementType === 'building-width' || this.measurementType === 'building-dimensions') {
            const distance = this.calculateDistance(
                this.currentMeasurement.points[0],
                this.currentMeasurement.points[1]
            );
            const midPoint = Cesium.Cartesian3.midpoint(
                this.currentMeasurement.points[0],
                this.currentMeasurement.points[1],
                new Cesium.Cartesian3()
            );
            this.addLabel(midPoint, this.formatDistance(distance));
        } else if (this.measurementType === 'height' || this.measurementType === 'building-height') {
            const height = this.calculateHeight(
                this.currentMeasurement.points[0],
                this.currentMeasurement.points[1]
            );
            const topPoint = this.currentMeasurement.points[1];
            this.addLabel(topPoint, `H: ${this.formatDistance(height)}`);
        } else if (this.measurementType === 'polyline' || this.measurementType === 'building-length') {
            let totalDistance = 0;
            for (let i = 1; i < this.currentMeasurement.points.length; i++) {
                totalDistance += this.calculateDistance(
                    this.currentMeasurement.points[i - 1],
                    this.currentMeasurement.points[i]
                );
            }
            const lastPoint = this.currentMeasurement.points[this.currentMeasurement.points.length - 1];
            this.addLabel(lastPoint, `Total: ${this.formatDistance(totalDistance)}`);
        } else if ((this.measurementType === 'area' || this.measurementType === 'volume'
            || this.measurementType === 'roof-area') && this.currentMeasurement.points.length >= 3) {
            const area = this.calculateArea(this.currentMeasurement.points);
            const centroid = this.calculateCentroid(this.currentMeasurement.points);
            this.addLabel(centroid, this.formatArea(area));
        } else if (this.measurementType === 'angle' && this.currentMeasurement.points.length === 3) {
            const angle = this.calculateAngle(
                this.currentMeasurement.points[0],
                this.currentMeasurement.points[1],
                this.currentMeasurement.points[2]
            );
            this.addLabel(this.currentMeasurement.points[1], `${angle.toFixed(2)}°`);
        }
    }

    /**
     * Add label entity
     */
    addLabel(position, text) {
        const viewer = this.tilesetViewer.viewer;
        
        // Elevate label position above terrain
        const cartographic = Cesium.Cartographic.fromCartesian(position);
        const height = viewer.scene.globe.getHeight(cartographic) || 0;
        const elevatedPosition = Cesium.Cartesian3.fromRadians(
            cartographic.longitude,
            cartographic.latitude,
            cartographic.height + Math.max(10, height * 0.02) // Add at least 10m or 2% of terrain height for labels
        );

        const labelEntity = viewer.entities.add({
            position: elevatedPosition,
            label: {
                text: text,
                font: 'bold 18px sans-serif', // Increased font size and made bold
                fillColor: Cesium.Color.YELLOW,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 4, // Increased outline width
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -15),
                scale: 1.3, // Increased scale
                backgroundColor: Cesium.Color.BLACK.withAlpha(0.8), // Add semi-transparent black background
                backgroundPadding: new Cesium.Cartesian2(8, 6), // Padding around text
                disableDepthTestDistance: Number.POSITIVE_INFINITY // Always render above everything
            }
        });
        this.currentMeasurement.labels.push(labelEntity);
    }

    /**
     * Calculate distance between two points
     */
    calculateDistance(point1, point2) {
        // Use geodesic distance along the WGS84 ellipsoid, not raw Cartesian distance
        const carto1 = Cesium.Cartographic.fromCartesian(point1);
        const carto2 = Cesium.Cartographic.fromCartesian(point2);

        const geodesic = new Cesium.EllipsoidGeodesic(carto1, carto2);
        const surfaceDistance = geodesic.surfaceDistance || 0;

        // Include height difference as part of true 3D distance if available
        const heightDiff = (carto2.height || 0) - (carto1.height || 0);
        const verticalComponent = Math.abs(heightDiff);

        // Return full 3D geodesic distance in meters
        return Math.sqrt(surfaceDistance * surfaceDistance + verticalComponent * verticalComponent);
    }

    /**
     * Calculate height (vertical distance)
     */
    calculateHeight(basePoint, topPoint) {
        const cartographic1 = Cesium.Cartographic.fromCartesian(basePoint);
        const cartographic2 = Cesium.Cartographic.fromCartesian(topPoint);
        return Math.abs(cartographic2.height - cartographic1.height);
    }

    /**
     * Calculate area of polygon
     */
    calculateArea(points) {
        if (points.length < 3) return 0;
        // Use spherical excess on WGS84 ellipsoid as a good approximation
        // Convert all points once to cartographic (radians)
        const cartos = points.map(p => Cesium.Cartographic.fromCartesian(p));

        // Compute area on the unit sphere using the l'Huilier / vector cross‑product method
        let total = 0;
        for (let i = 0; i < cartos.length; i++) {
            const p1 = cartos[i];
            const p2 = cartos[(i + 1) % cartos.length];

            const lon1 = p1.longitude;
            const lat1 = p1.latitude;
            const lon2 = p2.longitude;
            const lat2 = p2.latitude;

            total += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
        }

        const radius = Cesium.Ellipsoid.WGS84.maximumRadius;
        const areaOnSphere = Math.abs(total) * radius * radius / 2.0;

        return areaOnSphere;
    }

    /**
     * Calculate centroid
     */
    calculateCentroid(points) {
        const sum = new Cesium.Cartesian3(0, 0, 0);
        points.forEach(point => {
            Cesium.Cartesian3.add(sum, point, sum);
        });
        return Cesium.Cartesian3.multiplyByScalar(sum, 1.0 / points.length, new Cesium.Cartesian3());
    }

    /**
     * Calculate angle between three points
     */
    calculateAngle(point1, vertex, point2) {
        const v1 = Cesium.Cartesian3.subtract(point1, vertex, new Cesium.Cartesian3());
        const v2 = Cesium.Cartesian3.subtract(point2, vertex, new Cesium.Cartesian3());
        
        Cesium.Cartesian3.normalize(v1, v1);
        Cesium.Cartesian3.normalize(v2, v2);
        
        const dot = Cesium.Cartesian3.dot(v1, v2);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        
        return Cesium.Math.toDegrees(angle);
    }

    /**
     * Complete measurement
     */
    completeMeasurement() {
        if (!this.currentMeasurement) {
            this.stopMeasurement();
            return;
        }
        const n = this.currentMeasurement.points.length;
        if (this.measurementType === 'angle' && n < 3) {
            this.stopMeasurement();
            return;
        }
        if (this.measurementType !== 'angle' && n < 2) {
            this.stopMeasurement();
            return;
        }

        // Calculate final result
        let result = null;
        if (this.measurementType === 'distance-point' || this.measurementType === 'distance-line'
            || this.measurementType === 'building-width' || this.measurementType === 'building-dimensions') {
            result = this.calculateDistance(
                this.currentMeasurement.points[0],
                this.currentMeasurement.points[1]
            );
            this.currentMeasurement.result = this.formatDistance(result);
        } else if (this.measurementType === 'ruler') {
            let totalDistance = 0;
            for (let i = 1; i < this.currentMeasurement.points.length; i++) {
                totalDistance += this.calculateDistance(
                    this.currentMeasurement.points[i - 1],
                    this.currentMeasurement.points[i]
                );
            }
            const first = this.currentMeasurement.points[0];
            const last = this.currentMeasurement.points[this.currentMeasurement.points.length - 1];
            const dz = this.calculateSignedHeight(first, last);
            const bearing = this.calculateAzimuth(first, last);
            result = totalDistance;
            const dzSign = dz >= 0 ? '+' : '-';
            this.currentMeasurement.result = `Ruler: ${this.formatDistance(totalDistance)} (ΔZ ${dzSign}${this.formatDistance(Math.abs(dz))}, ${bearing.toFixed(1)}°)`;
        } else if (this.measurementType === 'height' || this.measurementType === 'building-height') {
            result = this.calculateHeight(
                this.currentMeasurement.points[0],
                this.currentMeasurement.points[1]
            );
            this.currentMeasurement.result = `Height: ${this.formatDistance(result)}`;
        } else if (this.measurementType === 'polyline' || this.measurementType === 'building-length') {
            let totalDistance = 0;
            for (let i = 1; i < this.currentMeasurement.points.length; i++) {
                totalDistance += this.calculateDistance(
                    this.currentMeasurement.points[i - 1],
                    this.currentMeasurement.points[i]
                );
            }
            result = totalDistance;
            this.currentMeasurement.result = `Total: ${this.formatDistance(totalDistance)}`;
        } else if (this.measurementType === 'roof-area') {
            result = this.calculate3DSurfaceArea(this.currentMeasurement.points);
            this.currentMeasurement.result = `Plane Area: ${this.formatArea(result)}`;
        } else if (this.measurementType === 'volume') {
            const volInfo = this.calculateVolume(this.currentMeasurement.points);
            result = volInfo.volume;
            this.currentMeasurement.volume = volInfo.volume;
            this.currentMeasurement.area = volInfo.area;
            this.currentMeasurement.height = volInfo.height;
            this.currentMeasurement.result = `Volume: ${this.formatVolume(volInfo.volume)} (${this.formatArea(volInfo.area)} × ${this.formatDistance(volInfo.height)})`;
        } else if (this.measurementType === 'area') {
            result = this.calculateArea(this.currentMeasurement.points);
            this.currentMeasurement.result = `Area: ${this.formatArea(result)}`;
        } else if (this.measurementType === 'angle') {
            result = this.calculateAngle(
                this.currentMeasurement.points[0],
                this.currentMeasurement.points[1],
                this.currentMeasurement.points[2]
            );
            this.currentMeasurement.result = `Angle: ${result.toFixed(2)}°`;
        } else if (n >= 2) {
            result = this.calculateDistance(
                this.currentMeasurement.points[0],
                this.currentMeasurement.points[1]
            );
            this.currentMeasurement.result = this.formatDistance(result);
        }

        this.currentMeasurement.value = result;
        this.currentMeasurement.formatted = this.currentMeasurement.result;
        this.currentMeasurement.timestamp = new Date().toISOString();

        // Save measurement
        this.measurements.push(this.currentMeasurement);
        this.setLatestResult(this.currentMeasurement.result);
        this.setStatus('ready', `Done: ${this.currentMeasurement.result}`);

        const doneText = this.currentMeasurement.result;
        if (window.app && typeof window.app.clearToolStatus === 'function') {
            window.app.clearToolStatus();
        }
        if (window.app && typeof window.app.setTransientStatus === 'function') {
            window.app.setTransientStatus(`Measured: ${doneText}`, 4500);
        }

        if (window.notification) {
            const mc = window.appI18n?.nt
                ? window.appI18n.nt('measurementComplete').replace('{result}', String(this.currentMeasurement.result))
                : `Measurement complete: ${this.currentMeasurement.result}`;
            window.notification.success(mc);
        }

        // Reset for next measurement
        this.currentMeasurement = null;
        this.isMeasuring = false;
        this._editFirstPointAdd = false;

        // Keep visualization but stop interaction
        if (this.handler) {
            this.handler.destroy();
            this.handler = null;
        }

        const viewer = this.tilesetViewer.viewer;
        if (viewer) {
            viewer.canvas.style.cursor = 'default';
        }
    }

    /**
     * Stop measurement
     */
    stopMeasurement() {
        if (this._useIonSdkOnly) {
            this.isMeasuring = false;
            return;
        }
        this.isMeasuring = false;
        this.measurementType = null;
        this.currentMeasurement = null;
        this._editFirstPointAdd = false;

        if (this.handler) {
            this.handler.destroy();
            this.handler = null;
        }

        // Remove preview
        if (this.previewEntity) {
            this.tilesetViewer.viewer.entities.remove(this.previewEntity);
            this.previewEntity = null;
        }

        const viewer = this.tilesetViewer.viewer;
        if (viewer) {
            viewer.canvas.style.cursor = 'default';
        }

        // Update UI
        document.querySelectorAll('.measurement-tool-item').forEach(item => {
            item.classList.remove('active');
        });

        if (window.app && typeof window.app.clearToolStatus === 'function') {
            window.app.clearToolStatus();
        }
    }

    /**
     * Clear all measurements
     */
    clearAllMeasurements() {
        if (this._useIonSdkOnly) {
            this.stopMeasurement();
            if (window.notification && typeof window.notification.info === 'function') {
                window.notification.info(
                    window.appI18n?.nt
                        ? window.appI18n.nt('measureClearIonZh')
                        : 'To clear measurements, use the Ion measurement toolbar.'
                );
            }
            return;
        }
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;

        // Remove all measurement entities
        this.measurements.forEach(measurement => {
            measurement.entities.forEach(entity => {
                viewer.entities.remove(entity);
            });
            measurement.labels.forEach(label => {
                viewer.entities.remove(label);
            });
        });

        this.measurements = [];
        this.stopMeasurement();
        this.setLatestResult('--');
        this.setStatus('ready', 'Ready');

        if (window.app && typeof window.app.clearToolStatus === 'function') {
            window.app.clearToolStatus();
        }

        if (window.notification) {
            window.notification.success(
                window.appI18n?.nt ? window.appI18n.nt('allMeasurementsCleared') : 'All measurements cleared'
            );
        }
    }

    /**
     * Show measurement interface (inline side panel — no full-screen intro modal)
     */
    show() {
        if (this._useIonSdkOnly) {
            const f = window.ionSdkToolsFacade;
            if (f && typeof f.expandIonMeasureToolbar === 'function') {
                f.expandIonMeasureToolbar(true);
            } else if (window.notification && typeof window.notification.info === 'function') {
                window.notification.info(
                    window.appI18n?.nt
                        ? window.appI18n.nt('measureUseIonBarZh2')
                        : 'Use the Ion measurement controls at the top of the 3D view.'
                );
            }
            return;
        }
        if (this.modal) {
            this.modal.style.display = 'none';
        }
        this.showToolbar();
    }

    /**
     * Toggle measurement interface
     */
    toggle() {
        if (this._useIonSdkOnly) {
            this.show();
            return;
        }
        const toolbarVisible = this.toolbar && this.toolbar.style.display !== 'none';
        if (!toolbarVisible) {
            this.show();
        } else {
            this.hideModal();
            this.hideToolbar();
        }
    }

    /**
     * Calculate true 3D inclined surface / plane area (m²) via fan triangulation in ECEF.
     */
    calculate3DSurfaceArea(points) {
        if (!Array.isArray(points) || points.length < 3) return 0;
        const p0 = points[0];
        let area = 0;
        for (let i = 1; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const ux = p1.x - p0.x, uy = p1.y - p0.y, uz = p1.z - p0.z;
            const vx = p2.x - p0.x, vy = p2.y - p0.y, vz = p2.z - p0.z;
            const cx = uy * vz - uz * vy;
            const cy = uz * vx - ux * vz;
            const cz = ux * vy - uy * vx;
            area += 0.5 * Math.hypot(cx, cy, cz);
        }
        return area;
    }

    /**
     * Calculate signed vertical elevation difference (m) from p1 to p2.
     */
    calculateSignedHeight(p1, p2) {
        const c1 = this._pointToWgs84(p1);
        const c2 = this._pointToWgs84(p2);
        if (!c1 || !c2) return 0;
        return c2.elev - c1.elev;
    }

    /**
     * Calculate forward azimuth bearing in degrees [0, 360) from p1 to p2.
     */
    calculateAzimuth(p1, p2) {
        const c1 = this._pointToWgs84(p1);
        const c2 = this._pointToWgs84(p2);
        if (!c1 || !c2) return 0;
        const toRad = Math.PI / 180;
        const lat1 = c1.lat * toRad;
        const lat2 = c2.lat * toRad;
        const dLon = (c2.lon - c1.lon) * toRad;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    }

    /**
     * Calculate 3D prism volume (m³) from polygon points and elevation span.
     */
    calculateVolume(points, explicitHeight = null) {
        if (!Array.isArray(points) || points.length < 3) {
            return { area: 0, height: 0, volume: 0 };
        }
        const area = typeof this.calculateArea === 'function'
            ? this.calculateArea(points)
            : this.calculate3DSurfaceArea(points);
        let height = Number.isFinite(explicitHeight) && explicitHeight > 0 ? explicitHeight : 0;
        if (!height) {
            const elevs = points.map((p) => this._pointToWgs84(p)?.elev).filter((h) => Number.isFinite(h));
            if (elevs.length >= 2) {
                const span = Math.max(...elevs) - Math.min(...elevs);
                height = span > 0.05 ? span : 3.0; // Default 3m single-storey prism if flat footprint
            } else {
                height = 3.0;
            }
        }
        return { area, height, volume: area * height };
    }

    formatVolume(cubicMeters) {
        const v = Number(cubicMeters) || 0;
        if (this.currentUnit === 'feet' || this.currentUnit === 'imperial') {
            return `${(v * 35.3146667).toFixed(2)} ft³`;
        }
        if (v >= 1e6) return `${(v / 1e6).toFixed(3)} hm³`;
        return `${v.toFixed(2)} m³`;
    }

    /**
     * Convert a Cartesian3 or `{ lon, lat, height/elev }` object into WGS84 `{ lon, lat, elev }`.
     */
    _pointToWgs84(pt) {
        if (!pt) return null;
        if (Number.isFinite(pt.lon) && Number.isFinite(pt.lat)) {
            return { lon: pt.lon, lat: pt.lat, elev: Number(pt.elev ?? pt.height ?? 0) };
        }
        if (Number.isFinite(pt.longitude) && Number.isFinite(pt.latitude)) {
            return { lon: pt.longitude, lat: pt.latitude, elev: Number(pt.height ?? pt.elev ?? 0) };
        }
        if (typeof Cesium !== 'undefined' && Cesium.Cartographic?.fromCartesian && Number.isFinite(pt.x)) {
            const c = Cesium.Cartographic.fromCartesian(pt);
            if (c) {
                return {
                    lon: Cesium.Math.toDegrees(c.longitude),
                    lat: Cesium.Math.toDegrees(c.latitude),
                    elev: Number.isFinite(c.height) ? c.height : 0,
                };
            }
        }
        // Pure WGS84 ECEF → geodetic fallback (works in headless tests without Cesium runtime)
        if (Number.isFinite(pt.x) && Number.isFinite(pt.y) && Number.isFinite(pt.z)) {
            const a = 6378137.0;
            const e2 = 6.69437999014e-3;
            const b = a * Math.sqrt(1 - e2);
            const ep2 = (a * a - b * b) / (b * b);
            const p = Math.hypot(pt.x, pt.y);
            const th = Math.atan2(a * pt.z, b * p);
            const lon = Math.atan2(pt.y, pt.x);
            const lat = Math.atan2(
                pt.z + ep2 * b * Math.pow(Math.sin(th), 3),
                p - e2 * a * Math.pow(Math.cos(th), 3)
            );
            const sinLat = Math.sin(lat);
            const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
            const cosLat = Math.cos(lat);
            const elev = Math.abs(cosLat) > 1e-10 ? p / cosLat - N : Math.abs(pt.z) - b;
            return { lon: (lon * 180) / Math.PI, lat: (lat * 180) / Math.PI, elev };
        }
        return null;
    }

    _formatUtm(lon, lat) {
        if (typeof window !== 'undefined' && window.coordinateManager?.wgs84ToUtm) {
            const u = window.coordinateManager.wgs84ToUtm(lat, lon);
            if (u) return `${u.zone}${u.band || u.hemisphere || ''} ${Math.round(u.easting)}E ${Math.round(u.northing)}N`;
        }
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -80 || lat > 84) return '';
        const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
        const hemi = lat >= 0 ? 'N' : 'S';
        const a = 6378137.0;
        const f = 1 / 298.257223563;
        const k0 = 0.9996;
        const e2 = f * (2 - f);
        const ep2 = e2 / (1 - e2);
        const latRad = (lat * Math.PI) / 180;
        const lon0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
        const dLon = (lon * Math.PI) / 180 - lon0;
        const sinLat = Math.sin(latRad);
        const cosLat = Math.cos(latRad);
        const tanLat = Math.tan(latRad);
        const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
        const T = tanLat * tanLat;
        const C = ep2 * cosLat * cosLat;
        const A = cosLat * dLon;
        const M = a * (
            (1 - e2 / 4 - (3 * e2 * e2) / 64) * latRad -
            ((3 * e2) / 8 + (3 * e2 * e2) / 32) * Math.sin(2 * latRad) +
            ((15 * e2 * e2) / 256) * Math.sin(4 * latRad)
        );
        const easting = k0 * N * (A + ((1 - T + C) * Math.pow(A, 3)) / 6) + 500000;
        let northing = k0 * (M + N * tanLat * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24));
        if (lat < 0) northing += 10000000;
        return `${zone}${hemi} ${Math.round(easting)}E ${Math.round(northing)}N`;
    }

    /**
     * Return all recorded measurements (structured result summary).
     */
    getResults() {
        return (this.measurements || []).map((m, idx) => {
            const coords = (m.points || []).map((p) => this._pointToWgs84(p)).filter(Boolean);
            const anchor = coords[0] || null;
            return {
                id: m.id || `measurement_${idx + 1}`,
                type: m.type,
                value: m.value ?? m.distance ?? m.area ?? m.height ?? m.angle ?? m.volume ?? null,
                formatted: m.formatted || m.result || m.text || m.label || '',
                unit: m.unit || this.currentUnit || 'meters',
                pointCount: Array.isArray(m.points) ? m.points.length : 0,
                anchor: anchor ? { ...anchor, utm: this._formatUtm(anchor.lon, anchor.lat) } : null,
                timestamp: m.timestamp || null,
            };
        });
    }

    /**
     * Serialize recorded measurements as an RFC 7946 3D GeoJSON FeatureCollection.
     */
    toGeoJSON() {
        const polygonTypes = new Set(['area', 'roof-area', 'volume']);
        const features = (this.measurements || []).map((m, idx) => {
            const coords = (m.points || [])
                .map((p) => this._pointToWgs84(p))
                .filter(Boolean)
                .map((c) => [Number(c.lon.toFixed(7)), Number(c.lat.toFixed(7)), Number(c.elev.toFixed(3))]);

            let geometry = null;
            if (coords.length === 1) {
                geometry = { type: 'Point', coordinates: coords[0] };
            } else if (coords.length >= 3 && polygonTypes.has(m.type)) {
                const ring = [...coords];
                const first = ring[0];
                const last = ring[ring.length - 1];
                if (first[0] !== last[0] || first[1] !== last[1] || first[2] !== last[2]) {
                    ring.push([...first]);
                }
                geometry = { type: 'Polygon', coordinates: [ring] };
            } else if (coords.length >= 2) {
                geometry = { type: 'LineString', coordinates: coords };
            }

            const firstCoord = coords[0] || null;
            return {
                type: 'Feature',
                id: m.id || `measurement_${idx + 1}`,
                geometry,
                properties: {
                    id: m.id || `measurement_${idx + 1}`,
                    type: m.type || 'distance-point',
                    value: m.value ?? m.volume ?? m.area ?? m.distance ?? m.height ?? m.angle ?? null,
                    formatted: m.formatted || m.result || m.text || '',
                    unit: m.unit || this.currentUnit || 'meters',
                    pointCount: coords.length,
                    anchorLon: firstCoord ? firstCoord[0] : null,
                    anchorLat: firstCoord ? firstCoord[1] : null,
                    anchorElevationM: firstCoord ? firstCoord[2] : null,
                    anchorUtm: firstCoord ? this._formatUtm(firstCoord[0], firstCoord[1]) : '',
                    timestamp: m.timestamp || null,
                },
            };
        });

        return {
            type: 'FeatureCollection',
            name: 'meridian-measurements',
            crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
            features,
        };
    }

    /**
     * Serialize recorded measurements as CSV with WGS84, elevation (m), and UTM columns.
     */
    toCSV() {
        const esc = (v) => {
            const s = v == null ? '' : String(v);
            return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const header = [
            'id', 'type', 'value', 'unit', 'formatted',
            'point_count', 'anchor_lat', 'anchor_lon', 'anchor_elevation_m', 'anchor_utm', 'timestamp',
        ];
        const rows = this.toGeoJSON().features.map((f) => {
            const p = f.properties;
            return [
                p.id, p.type, p.value, p.unit, p.formatted,
                p.pointCount, p.anchorLat, p.anchorLon, p.anchorElevationM, p.anchorUtm, p.timestamp,
            ].map(esc).join(',');
        });
        return [header.join(','), ...rows].join('\n');
    }

    _downloadText(content, filename, mimeType) {
        if (typeof document === 'undefined' || typeof Blob === 'undefined') return content;
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return content;
    }

    exportGeoJSON() {
        if (!this.measurements || this.measurements.length === 0) {
            window.notification?.warning?.('No measurements to export yet.');
            return null;
        }
        const json = JSON.stringify(this.toGeoJSON(), null, 2);
        const stamp = new Date().toISOString().slice(0, 10);
        this._downloadText(json, `meridian-measurements-${stamp}.geojson`, 'application/geo+json');
        window.notification?.success?.(`Exported ${this.measurements.length} measurement(s) to GeoJSON.`);
        return json;
    }

    exportCSV() {
        if (!this.measurements || this.measurements.length === 0) {
            window.notification?.warning?.('No measurements to export yet.');
            return null;
        }
        const csv = this.toCSV();
        const stamp = new Date().toISOString().slice(0, 10);
        this._downloadText(csv, `meridian-measurements-${stamp}.csv`, 'text/csv;charset=utf-8');
        window.notification?.success?.(`Exported ${this.measurements.length} measurement(s) to CSV.`);
        return csv;
    }

    /**
     * Alias for `clearAllMeasurements()` documented in the public API.
     */
    clear() {
        if (typeof this.clearAllMeasurements === 'function') {
            return this.clearAllMeasurements();
        }
        this.stopMeasurement?.();
    }
}

// Initialize when available
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.enhancedMeasurementManager = new EnhancedMeasurementManager();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EnhancedMeasurementManager };
}
