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
                        <p class="measurement-tool-subtitle">Pick a tool, then click directly in the 3D scene.</p>
                    </div>
                    <button class="close-btn" id="closeMeasurementToolbarBtn">×</button>
                </div>
                <div class="measurement-tool-group-label">Distance & Geometry</div>
                <div class="measurement-tools-grid">
                    <div class="measurement-tool-item" data-type="distance-point" title="Point-to-Point Distance">
                        <div class="tool-icon" aria-hidden="true">📏</div>
                        <div class="tool-content">
                            <div class="tool-label">Point Distance</div>
                            <div class="tool-description">Two-point geodesic distance</div>
                        </div>
                    </div>
                    <div class="measurement-tool-item" data-type="polyline" title="Polyline/Path Measurement">
                        <div class="tool-icon" aria-hidden="true">🛤️</div>
                        <div class="tool-content">
                            <div class="tool-label">Polyline</div>
                            <div class="tool-description">Multi-segment path length</div>
                        </div>
                    </div>
                    <div class="measurement-tool-item" data-type="height" title="Vertical Height Measurement">
                        <div class="tool-icon" aria-hidden="true">📐</div>
                        <div class="tool-content">
                            <div class="tool-label">Height</div>
                            <div class="tool-description">Vertical elevation delta</div>
                        </div>
                    </div>
                    <div class="measurement-tool-item" data-type="distance-line" title="Simple Line Distance">
                        <div class="tool-icon" aria-hidden="true">📏</div>
                        <div class="tool-content">
                            <div class="tool-label">Line Distance</div>
                            <div class="tool-description">Straight segment distance</div>
                        </div>
                    </div>
                    <div class="measurement-tool-item" data-type="vertical-segment" title="Vertical Segment">
                        <div class="tool-icon" aria-hidden="true">⬆️</div>
                        <div class="tool-content">
                            <div class="tool-label">Vertical Segment</div>
                            <div class="tool-description">Height segment by two picks</div>
                        </div>
                    </div>
                    <div class="measurement-tool-item" data-type="area" title="Area Measurement (Polygon)">
                        <div class="tool-icon" aria-hidden="true">▱</div>
                        <div class="tool-content">
                            <div class="tool-label">Area</div>
                            <div class="tool-description">Polygon area in m²/ha/km²</div>
                        </div>
                    </div>
                    <div class="measurement-tool-item" data-type="angle" title="Angle Measurement">
                        <div class="tool-icon" aria-hidden="true">∠</div>
                        <div class="tool-content">
                            <div class="tool-label">Angle</div>
                            <div class="tool-description">Three-point angle in degrees</div>
                        </div>
                    </div>
                </div>
                <div class="measurement-tool-actions">
                    <button class="btn btn-danger" id="clearAllMeasurementsBtn">Clear All</button>
                    <button class="btn" id="closeMeasurementToolbarBtn2">Close</button>
                </div>
                <div id="measurementStatus" class="tool-status ready">Ready</div>
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

        // Tool selection
        document.querySelectorAll('.measurement-tool-item').forEach(item => {
            item.addEventListener('click', () => {
                const type = item.dataset.type;
                this.selectMeasurementType(type);
            });
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
            this.currentMeasurement.result = `Total: ${this.formatDistance(totalDistance)}`;
        } else if (this.measurementType === 'area' || this.measurementType === 'volume'
            || this.measurementType === 'roof-area') {
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
     * Return all recorded measurements (structured result summary).
     */
    getResults() {
        return (this.measurements || []).map((m, idx) => ({
            id: m.id || `measurement_${idx + 1}`,
            type: m.type,
            value: m.value ?? m.distance ?? m.area ?? m.height ?? m.angle ?? m.volume ?? null,
            formatted: m.formatted || m.text || m.label || '',
            unit: m.unit || this.currentUnit || 'meters',
            pointCount: Array.isArray(m.points) ? m.points.length : 0,
            timestamp: m.timestamp || null,
        }));
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
if (typeof window !== 'undefined') {
    window.enhancedMeasurementManager = new EnhancedMeasurementManager();
}
