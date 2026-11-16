/**
 * Display modes — two coordinated surfaces:
 *
 * 1) Map rail (`#special_effects` → `#toolbarSE`) — wired by `smart3dToolbarWireup.js`:
 *    - Quick toggles: transparency, fog, white, slope, height, distance, direction, snow, clouds, ortho, remapColors.
 *    - Numeric tuning: `sceneModesParameterPanel.js` injects inputs into `#sceneModesSettingsHost` (writes `window.t.SceneModes` / `SceneTuning`).
 *
 * 2) Advanced modal (`#displayModesModal`) — this class:
 *    - Wireframe, contours, solid, ground level, compass, lighting, grid, vertical exaggeration, rain (not on rail).
 *    - Slope / clouds / snow overlap the rail: `syncModalFromToolbar()` aligns modal checkboxes + `currentModes` with rail when opening.
 *
 * Config: `Project.Optional_tools` → merged `window.t` (`SceneModes`, `Tools.special_effects`, etc.).
 */

class DisplayModesManager {
    constructor() {
        this.tilesetViewer = null;
        this.modal = null;
        this.isActive = false;
        this._inited = false;
        this.currentModes = {
            wireframe: false,
            contours: false,
            solid: true,
            slope: false,
            verticalExaggeration: 1.0,
            groundLevel: false,
            compass: true,
            lighting: true,
            weather: 'none', // 'none', 'snow', 'rain'
            clouds: false,
            grid: false
        };
        this.isApplyingModes = false;
        this.boundDocumentClickHandler = this.handleDocumentClick.bind(this);
        this._onOptionalToolsUpdated = this._onOptionalToolsUpdated.bind(this);
        this.init();
    }

    /**
     * Re-apply slope overlay and weather fog when `window.t` / SceneModes change (Control Center save).
     */
    _onOptionalToolsUpdated() {
        this.refreshSlopeOverlayIfActive();
        const w = this.currentModes.weather;
        if (w === 'snow' || w === 'rain') {
            this.applyWeatherEffect(w);
        }
    }

    /**
     * Initialize display modes manager (once; duplicate deferred inits are ignored).
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        if (!this._inited) {
            this._inited = true;
            this.createDisplayModesModal();
            this.setupEventHandlers();
        if (typeof window !== 'undefined') {
            window.addEventListener('smart3dOptionalToolsUpdated', this._onOptionalToolsUpdated);
            window.addEventListener('simplex:localeChanged', () => this.applyModalLocale());
        }
        }
    }

    _modalT(key) {
        const i18n = window.appI18n;
        if (i18n && typeof i18n.t === 'function') {
            const v = i18n.t('ui.displayModesModal.' + key);
            if (v && v !== 'ui.displayModesModal.' + key) return v;
        }
        return key;
    }

    applyModalLocale() {
        if (window.appI18n && typeof window.appI18n.applyDom === 'function' && this.modal) {
            window.appI18n.applyDom(this.modal);
            const val = document.getElementById('verticalExaggerationSlider');
            const valEl = document.getElementById('verticalExaggerationValue');
            if (val && valEl) {
                const x = parseFloat(val.value);
                valEl.textContent = this._modalT('sliderValue').replace('{value}', x.toFixed(1));
            }
        }
    }

    /**
     * Create display modes modal
     */
    createDisplayModesModal() {
        // Remove existing if any
        const existing = document.getElementById('displayModesModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'displayModesModal';
        modal.className = 'display-modes-modal';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="display-modes-content">
                <div class="display-modes-header">
                    <div class="display-modes-header-text">
                        <h2 data-i18n="ui.displayModesModal.title">Display modes</h2>
                        <p class="display-modes-subtitle" data-i18n="ui.displayModesModal.subtitle">Tune rendering, analysis overlays, and visual context for the current view.</p>
                    </div>
                    <button type="button" class="close-btn" id="closeDisplayModesBtn" data-i18n-aria="ui.displayModesModal.closeAria" aria-label="Close">×</button>
                </div>
                <div class="display-modes-body">
                    <div class="display-modes-icon-container">
                        <div class="display-modes-icon">🎨</div>
                    </div>
                    <div class="display-modes-section-label" data-i18n="ui.displayModesModal.sectionViz">Visualization</div>
                    <div id="displayModesStatus" class="tool-status ready" data-i18n="ui.displayModesModal.statusReady">Ready</div>
                    <div id="displayModesLoading" class="tool-loading-indicator" style="display: none;">
                        <span class="spinner-sm"></span>
                        <span data-i18n="ui.displayModesModal.statusApplying">Applying display mode…</span>
                    </div>
                    
                    <div class="display-modes-grid">
                        <div class="display-mode-section">
                            <h3 data-i18n="ui.displayModesModal.sectionRendering">Rendering modes</h3>
                            <div class="mode-controls">
                                <label class="mode-checkbox">
                                    <input type="checkbox" id="wireframeMode" data-mode="wireframe">
                                    <span data-i18n="ui.displayModesModal.wireframe">Wireframe mode</span>
                                </label>
                                <label class="mode-checkbox">
                                    <input type="checkbox" id="solidMode" data-mode="solid" checked>
                                    <span data-i18n="ui.displayModesModal.solid">Solid mode</span>
                                </label>
                                <label class="mode-checkbox">
                                    <input type="checkbox" id="contoursMode" data-mode="contours">
                                    <span data-i18n="ui.displayModesModal.contours">Contours / water lines</span>
                                </label>
                            </div>
                        </div>

                        <div class="display-mode-section">
                            <h3 data-i18n="ui.displayModesModal.sectionAnalysis">Analysis modes</h3>
                            <div class="mode-controls">
                                <label class="mode-checkbox">
                                    <input type="checkbox" id="slopeMode" data-mode="slope">
                                    <span data-i18n="ui.displayModesModal.slope">Slope analysis</span>
                                </label>
                                <label class="mode-checkbox">
                                    <input type="checkbox" id="groundLevelMode" data-mode="groundLevel">
                                    <span data-i18n="ui.displayModesModal.groundLevel">Ground level view</span>
                                </label>
                            </div>
                        </div>

                        <div class="display-mode-section">
                            <h3 data-i18n="ui.displayModesModal.sectionVisualFx">Visual effects</h3>
                            <div class="mode-controls">
                                <label class="mode-checkbox">
                                    <input type="checkbox" id="compassMode" data-mode="compass" checked>
                                    <span data-i18n="ui.displayModesModal.compass">Compass overlay</span>
                                </label>
                                <label class="mode-checkbox">
                                    <input type="checkbox" id="lightingMode" data-mode="lighting" checked>
                                    <span data-i18n="ui.displayModesModal.lighting">Globe lighting</span>
                                </label>
                                <label class="mode-checkbox">
                                    <input type="checkbox" id="cloudsMode" data-mode="clouds">
                                    <span data-i18n="ui.displayModesModal.clouds">Clouds / sky atmosphere</span>
                                </label>
                                <label class="mode-checkbox">
                                    <input type="checkbox" id="gridMode" data-mode="grid">
                                    <span data-i18n="ui.displayModesModal.grid">Grid / modular overlays</span>
                                </label>
                            </div>
                        </div>

                        <div class="display-mode-section">
                            <h3 data-i18n="ui.displayModesModal.sectionWeather">Weather effects</h3>
                            <div class="mode-controls">
                                <select id="weatherSelect" class="select-input" aria-label="Weather">
                                    <option value="none" data-i18n="ui.displayModesModal.weatherNone">None</option>
                                    <option value="snow" data-i18n="ui.displayModesModal.weatherSnow">Snow</option>
                                    <option value="rain" data-i18n="ui.displayModesModal.weatherRain">Rain</option>
                                </select>
                            </div>
                        </div>

                        <div class="display-mode-section">
                            <h3 data-i18n="ui.displayModesModal.sectionVertExag">Vertical exaggeration</h3>
                            <div class="mode-controls">
                                <div class="slider-control">
                                    <input type="range" id="verticalExaggerationSlider" 
                                           class="range-slider" 
                                           min="0.1" max="5" step="0.1" value="1.0">
                                    <div class="slider-value">
                                        <span id="verticalExaggerationValue">1.0×</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="display-modes-actions">
                        <button type="button" class="btn" id="resetModesBtn">
                            <span aria-hidden="true">🔄</span> <span data-i18n="ui.displayModesModal.resetBtn">Reset to defaults</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
        this.applyModalLocale();
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Close button
        document.addEventListener('click', this.boundDocumentClickHandler);

        // Mode checkboxes
        document.querySelectorAll('.mode-checkbox input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const mode = e.target.dataset.mode;
                const enabled = e.target.checked;
                this.toggleMode(mode, enabled);
            });
        });

        // Weather select
        document.getElementById('weatherSelect')?.addEventListener('change', (e) => {
            this.setWeather(e.target.value);
        });

        // Vertical exaggeration slider
        const slider = document.getElementById('verticalExaggerationSlider');
        if (slider) {
            slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.setVerticalExaggeration(value);
                const vEl = document.getElementById('verticalExaggerationValue');
                if (vEl) vEl.textContent = this._modalT('sliderValue').replace('{value}', value.toFixed(1));
            });
        }

        // Reset button
        document.getElementById('resetModesBtn')?.addEventListener('click', () => {
            this.resetToDefaults();
        });

        const adv = document.getElementById('openDisplayModesAdvancedBtn');
        if (adv) {
            adv.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.show();
            });
        }
    }

    /**
     * Align modal controls and `currentModes` with the map rail (`#toolbarSE` ActiveButtons) where they overlap.
     */
    syncModalFromToolbar() {
        const slopeBtn = document.getElementById('slope');
        const cloudsBtn = document.getElementById('clouds');
        const snowBtn = document.getElementById('snow');
        const rainBtn = document.getElementById('rain');
        const slopeCh = document.getElementById('slopeMode');
        const cloudsCh = document.getElementById('cloudsMode');
        const weatherSel = document.getElementById('weatherSelect');

        const slopeOn = !!(slopeBtn && slopeBtn.classList.contains('ActiveButton'));
        const cloudsOn = !!(cloudsBtn && cloudsBtn.classList.contains('ActiveButton'));
        const snowOn = !!(snowBtn && snowBtn.classList.contains('ActiveButton'));
        const rainOn = !!(rainBtn && rainBtn.classList.contains('ActiveButton'));

        if (slopeCh) slopeCh.checked = slopeOn;
        if (cloudsCh) cloudsCh.checked = cloudsOn;
        if (weatherSel) {
            if (snowOn) weatherSel.value = 'snow';
            else if (rainOn) weatherSel.value = 'rain';
            else if (weatherSel.value === 'snow' || weatherSel.value === 'rain') weatherSel.value = 'none';
        }

        this.currentModes.slope = slopeOn;
        this.currentModes.clouds = cloudsOn;
        if (snowOn) this.currentModes.weather = 'snow';
        else if (rainOn) this.currentModes.weather = 'rain';
        else if (this.currentModes.weather === 'snow' || this.currentModes.weather === 'rain') {
            this.currentModes.weather = 'none';
        }
    }

    /**
     * Keep map rail weather buttons aligned with modal / `currentModes.weather`.
     */
    syncWeatherRailFromModal() {
        const w = this.currentModes.weather;
        const snowB = document.getElementById('snow');
        const rainB = document.getElementById('rain');
        if (snowB) {
            const on = w === 'snow';
            snowB.classList.toggle('ActiveButton', on);
            snowB.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        if (rainB) {
            const on = w === 'rain';
            rainB.classList.toggle('ActiveButton', on);
            rainB.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }

    handleDocumentClick(e) {
        if (e.target.id === 'closeDisplayModesBtn' || (e.target === this.modal)) {
            this.hide();
        }
    }

    setStatus(kind, message) {
        const statusEl = document.getElementById('displayModesStatus');
        if (!statusEl) return;
        statusEl.className = `tool-status ${kind}`;
        const fallback = message;
        if (kind === 'ready') statusEl.textContent = this._modalT('statusDone');
        else if (kind === 'loading') statusEl.textContent = this._modalT('statusLoading');
        else if (kind === 'error') statusEl.textContent = fallback || this._modalT('statusError');
        else statusEl.textContent = fallback;
    }

    setLoading(isLoading) {
        this.isApplyingModes = isLoading;
        const loadingEl = document.getElementById('displayModesLoading');
        if (loadingEl) {
            loadingEl.style.display = isLoading ? 'flex' : 'none';
        }
    }

    /**
     * Show display modes modal
     */
    show() {
        this.syncModalFromToolbar();
        if (this.modal) {
            this.modal.style.display = 'flex';
        }
    }

    /**
     * Hide display modes modal
     */
    hide() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }

    /**
     * Toggle display modes modal
     */
    toggle() {
        if (this.modal && this.modal.style.display === 'none') {
            this.show();
        } else {
            this.hide();
        }
    }

    /** Toolbar shortcuts — building controls are configured in Display Modes */
    showBuildings() {
        this.show();
    }

    hideBuildings() {
        this.show();
    }

    toggleBuildings() {
        this.show();
    }

    /**
     * Toggle display mode
     */
    async toggleMode(mode, enabled) {
        if (mode === 'wireframe' && enabled) {
            this.currentModes.grid = false;
            const gridEl = document.getElementById('gridMode');
            if (gridEl) gridEl.checked = false;
        } else if (mode === 'grid' && enabled) {
            this.currentModes.wireframe = false;
            const wireEl = document.getElementById('wireframeMode');
            if (wireEl) wireEl.checked = false;
        }
        this.currentModes[mode] = enabled;
        await this.applyDisplayModes();
    }

    /**
     * Set weather effect
     */
    async setWeather(weather) {
        this.currentModes.weather = weather;
        await this.applyDisplayModes();
    }

    /**
     * Set vertical exaggeration
     */
    async setVerticalExaggeration(value) {
        this.currentModes.verticalExaggeration = value;
        await this.applyDisplayModes();
    }

    /**
     * Apply display modes to viewer
     */
    async applyDisplayModes() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const scene = viewer.scene;
        this.setLoading(true);
        this.setStatus('loading', '');

        try {
            // Apply wireframe mode
            if (this.currentModes.wireframe) {
                scene.globe.enableLighting = false;
                scene.globe.baseColor = Cesium.Color.WHITE;
                this.applyWireframeMode(true);
            } else {
                this.applyWireframeMode(false);
            }

            if (this.currentModes.solid && !this.currentModes.wireframe) {
                scene.globe.enableLighting = this.currentModes.lighting;
            }

            await this.applyContoursMode(this.currentModes.contours);
            await this.applySlopeMode(this.currentModes.slope);
            this.applyGroundLevelMode(this.currentModes.groundLevel);

            scene.globe.terrainExaggeration = this.currentModes.verticalExaggeration;

            if (this.currentModes.compass) {
                this.showCompass();
            } else {
                this.hideCompass();
            }

            const lightingEnabled = this.currentModes.wireframe ? false : this.currentModes.lighting;
            scene.globe.enableLighting = lightingEnabled;
            scene.globe.dynamicAtmosphereLighting = lightingEnabled;

            if (scene.skyAtmosphere) {
                scene.skyAtmosphere.show = this.currentModes.clouds || this.currentModes.lighting;
            }

            this.applyWeatherEffect(this.currentModes.weather);
            this.applyGridMode(this.currentModes.grid);
            this.syncWeatherRailFromModal();
            scene.requestRender();
            this.setStatus('ready', '');
        } catch (error) {
            this.setStatus('error', `Error: ${error?.message || this._modalT('statusError')}`);
            window.notification?.error(`Display modes failed: ${error?.message || 'unknown error'}`);
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Apply wireframe mode
     */
    applyWireframeMode(enabled) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const scene = viewer.scene;

        // Wireframe mode requires custom shader or material modification
        // This is a simplified implementation
        if (enabled) {
            scene.globe.material = new Cesium.GridMaterialProperty({
                color: Cesium.Color.CYAN,
                cellAlpha: 0.2,
                lineCount: new Cesium.Cartesian2(8, 8),
                lineThickness: new Cesium.Cartesian2(1.0, 1.0)
            });
        } else {
            scene.globe.material = undefined; // Reset to default
        }
    }

    /**
     * Apply contours mode
     * Generates contour lines based on terrain elevation
     */
    async applyContoursMode(enabled) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const scene = viewer.scene;

        if (enabled) {
            // Remove existing contours if any
            this.removeContours();

            // Create contour lines using Cesium's polyline entities
            // We'll sample terrain heights and create contour lines
            this.contourEntities = [];
            this.contourInterval = 10; // 10 meter intervals (configurable)

            // Get camera view bounds
            const rectangle = viewer.camera.computeViewRectangle();
            if (!rectangle) {
                if (window.notification) {
                    const msg = window.appI18n?.nt ? window.appI18n.nt('contourNoBounds') : 'Cannot generate contours: adjust the camera so the view has bounds.';
                    window.notification.warning(msg);
                }
                return;
            }

            // Generate contour lines
            await this.generateContourLines(rectangle);
        } else {
            this.removeContours();
        }
    }

    /**
     * Generate contour lines for a given rectangle
     */
    async generateContourLines(rectangle) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const scene = viewer.scene;
        const globe = scene.globe;

        // Sample points in a grid (rectangle coordinates are already in radians)
        const samples = 50; // Grid resolution
        const minLon = rectangle.west;
        const maxLon = rectangle.east;
        const minLat = rectangle.south;
        const maxLat = rectangle.north;

        const lonStep = (maxLon - minLon) / samples;
        const latStep = (maxLat - minLat) / samples;

        // Sample heights
        const heightGrid = [];
        for (let i = 0; i <= samples; i++) {
            heightGrid[i] = [];
            for (let j = 0; j <= samples; j++) {
                const lon = minLon + i * lonStep;
                const lat = minLat + j * latStep;
                const cartographic = new Cesium.Cartographic(lon, lat);
                // Use terrain-accurate sampling when available
                let height = 0;
                if (scene.sampleHeightMostDetailed) {
                    try {
                        const samplesAtPoint = await scene.sampleHeightMostDetailed([cartographic]);
                        const sampled = Array.isArray(samplesAtPoint) ? samplesAtPoint[0] : null;
                        height = (sampled && typeof sampled.height === 'number')
                            ? sampled.height
                            : (globe.getHeight(cartographic) || 0);
                    } catch {
                        height = globe.getHeight(cartographic) || 0;
                    }
                } else {
                    height = globe.getHeight(cartographic) || 0;
                }
                heightGrid[i][j] = height;
            }
        }

        // Generate contour lines using marching squares algorithm
        const contours = this.marchSquares(heightGrid, minLon, maxLon, minLat, maxLat, samples);

        // Create Cesium entities for contour lines
        contours.forEach((contour, index) => {
            const entity = viewer.entities.add({
                polyline: {
                    positions: contour.positions,
                    width: 2,
                    material: Cesium.Color.CYAN.withAlpha(0.8),
                    clampToGround: true,
                    zIndex: 10
                }
            });
            this.contourEntities.push(entity);
        });
    }

    /**
     * Marching squares algorithm for contour generation
     */
    marchSquares(heightGrid, minLon, maxLon, minLat, maxLat, samples) {
        const contours = [];
        const lonStep = (maxLon - minLon) / samples;
        const latStep = (maxLat - minLat) / samples;

        // Find min/max heights
        let minHeight = Infinity;
        let maxHeight = -Infinity;
        for (let i = 0; i <= samples; i++) {
            for (let j = 0; j <= samples; j++) {
                const h = heightGrid[i][j];
                if (h < minHeight) minHeight = h;
                if (h > maxHeight) maxHeight = h;
            }
        }

        // Generate contours at intervals
        const startHeight = Math.ceil(minHeight / this.contourInterval) * this.contourInterval;
        for (let contourHeight = startHeight; contourHeight <= maxHeight; contourHeight += this.contourInterval) {
            const positions = [];

            // Simplified contour generation - create horizontal lines at contour height
            for (let i = 0; i < samples; i++) {
                for (let j = 0; j < samples; j++) {
                    const h1 = heightGrid[i][j];
                    const h2 = heightGrid[i + 1] ? heightGrid[i + 1][j] : h1;
                    const h3 = heightGrid[i][j + 1] || h1;
                    const h4 = heightGrid[i + 1] && heightGrid[i + 1][j + 1] ? heightGrid[i + 1][j + 1] : h1;

                    // Check if contour passes through this cell
                    const crosses = (h1 <= contourHeight && h2 > contourHeight) ||
                                  (h1 > contourHeight && h2 <= contourHeight) ||
                                  (h1 <= contourHeight && h3 > contourHeight) ||
                                  (h1 > contourHeight && h3 <= contourHeight);

                    if (crosses) {
                        const lon = minLon + i * lonStep;
                        const lat = minLat + j * latStep;
                        positions.push(Cesium.Cartesian3.fromRadians(lon, lat, contourHeight));
                    }
                }
            }

            if (positions.length > 0) {
                contours.push({ height: contourHeight, positions: positions });
            }
        }

        return contours;
    }

    /**
     * Remove contour lines
     */
    removeContours() {
        if (!this.contourEntities || !this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        this.contourEntities.forEach(entity => {
            viewer.entities.remove(entity);
        });
        this.contourEntities = [];
    }

    /**
     * Apply slope analysis mode
     * Colors terrain based on slope angle using imagery layer overlay
     */
    async applySlopeMode(enabled) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const scene = viewer.scene;
        const globe = scene.globe;

        if (enabled) {
            // Remove existing slope visualization
            this.removeSlopeVisualization();

            // Use Cesium's built-in slope visualization via custom imagery
            // Create a slope-based color imagery provider
            try {
                // Create a custom imagery layer that colors by slope
                // For now, we'll use a simplified approach with entity-based visualization
                // In a full implementation, this would use a custom imagery provider

                // Add slope visualization as an overlay using entities
                this.slopeEntities = [];
                this.slopeVisualizationActive = true;

                // Sample terrain and create colored polygons based on slope
                await this.generateSlopeVisualization();

                // Add legend
                this.addSlopeLegend();
            } catch (error) {
                console.error('Failed to enable slope analysis:', error);
                if (window.notification) {
                    window.notification.error('Failed to enable slope analysis: ' + error.message);
                }
            }
        } else {
            this.removeSlopeVisualization();
        }
    }

    /**
     * Generate slope visualization
     * Creates colored polygons based on terrain slope
     */
    /**
     * Slope classification thresholds and grid density from `window.t.SceneModes.slope`.
     * @returns {{ t1: number, t2: number, t3: number, samples: number }}
     */
    getSlopeVisualizationConfig() {
        const sm = window.t && window.t.SceneModes && window.t.SceneModes.slope;
        const pick = (v, def, lo, hi) => {
            const n = typeof v === 'number' && !Number.isNaN(v) ? v : def;
            return Math.min(hi, Math.max(lo, n));
        };
        const t1 = pick(sm && sm.thresholdDeg1, 15, 1, 89);
        const t2 = pick(sm && sm.thresholdDeg2, 30, 1, 89);
        const t3 = pick(sm && sm.thresholdDeg3, 45, 1, 89);
        const sorted = [t1, t2, t3].sort((a, b) => a - b);
        const samples = pick(sm && sm.gridSamples, 20, 6, 80);
        return { t1: sorted[0], t2: sorted[1], t3: sorted[2], samples };
    }

    /**
     * Rebuild slope overlay when thresholds or grid change while mode is on (toolbar).
     */
    async refreshSlopeOverlayIfActive() {
        if (!this.currentModes.slope) return;
        this.removeSlopeVisualization();
        await this.generateSlopeVisualization();
        this.addSlopeLegend();
        if (this.tilesetViewer && this.tilesetViewer.viewer) {
            this.tilesetViewer.viewer.scene.requestRender();
        }
    }

    async generateSlopeVisualization() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const scene = viewer.scene;
        const globe = scene.globe;

        // Get camera view bounds
        const rectangle = viewer.camera.computeViewRectangle();
        if (!rectangle) return;

        const { t1, t2, t3, samples } = this.getSlopeVisualizationConfig();
        // Sample terrain in a grid (rectangle values are already in radians)
        const minLon = rectangle.west;
        const maxLon = rectangle.east;
        const minLat = rectangle.south;
        const maxLat = rectangle.north;

        const lonStep = (maxLon - minLon) / samples;
        const latStep = (maxLat - minLat) / samples;

        // Sample heights and calculate slopes
        for (let i = 0; i < samples; i++) {
            for (let j = 0; j < samples; j++) {
                const lon1 = minLon + i * lonStep;
                const lat1 = minLat + j * latStep;
                const lon2 = minLon + (i + 1) * lonStep;
                const lat2 = minLat + (j + 1) * latStep;

                // Get heights at corners using terrain-accurate sampling
                const c1 = new Cesium.Cartographic(lon1, lat1);
                const c2 = new Cesium.Cartographic(lon2, lat1);
                const c3 = new Cesium.Cartographic(lon1, lat2);
                const c4 = new Cesium.Cartographic(lon2, lat2);

                let h1 = 0, h2 = 0, h3 = 0, h4 = 0;
                if (scene.sampleHeightMostDetailed) {
                    try {
                        const sampled = await scene.sampleHeightMostDetailed([c1, c2, c3, c4]);
                        h1 = (sampled?.[0] && typeof sampled[0].height === 'number') ? sampled[0].height : (globe.getHeight(c1) || 0);
                        h2 = (sampled?.[1] && typeof sampled[1].height === 'number') ? sampled[1].height : (globe.getHeight(c2) || 0);
                        h3 = (sampled?.[2] && typeof sampled[2].height === 'number') ? sampled[2].height : (globe.getHeight(c3) || 0);
                        h4 = (sampled?.[3] && typeof sampled[3].height === 'number') ? sampled[3].height : (globe.getHeight(c4) || 0);
                    } catch {
                        h1 = globe.getHeight(c1) || 0;
                        h2 = globe.getHeight(c2) || 0;
                        h3 = globe.getHeight(c3) || 0;
                        h4 = globe.getHeight(c4) || 0;
                    }
                } else {
                    h1 = globe.getHeight(c1) || 0;
                    h2 = globe.getHeight(c2) || 0;
                    h3 = globe.getHeight(c3) || 0;
                    h4 = globe.getHeight(c4) || 0;
                }

                // Calculate horizontal distances in meters using geodesics
                const geoX = new Cesium.EllipsoidGeodesic(c1, c2);
                const geoY = new Cesium.EllipsoidGeodesic(c1, c3);
                const dx = geoX.surfaceDistance || 1.0;
                const dy = geoY.surfaceDistance || 1.0;

                const dz1 = h2 - h1;
                const dz2 = h3 - h1;

                const slope1 = Math.atan(Math.abs(dz1) / dx) * (180 / Math.PI);
                const slope2 = Math.atan(Math.abs(dz2) / dy) * (180 / Math.PI);
                const avgSlope = (slope1 + slope2) / 2;

                // Determine color based on slope
                let color;
                if (avgSlope < t1) {
                    color = Cesium.Color.GREEN.withAlpha(0.6);
                } else if (avgSlope < t2) {
                    color = Cesium.Color.YELLOW.withAlpha(0.6);
                } else if (avgSlope < t3) {
                    color = Cesium.Color.ORANGE.withAlpha(0.6);
                } else {
                    color = Cesium.Color.RED.withAlpha(0.6);
                }

                // Create polygon entity (simple quad) in radians
                const positions = Cesium.Cartesian3.fromRadiansArrayHeights([
                    lon1, lat1, h1,
                    lon2, lat1, h2,
                    lon2, lat2, h4,
                    lon1, lat2, h3
                ]);

                const entity = viewer.entities.add({
                    polygon: {
                        hierarchy: positions,
                        material: color,
                        outline: false,
                        heightReference: Cesium.HeightReference.NONE
                    }
                });

                this.slopeEntities.push(entity);
            }
        }
    }

    /**
     * Remove slope visualization
     */
    removeSlopeVisualization() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;

        if (this.slopeEntities) {
            this.slopeEntities.forEach(entity => {
                viewer.entities.remove(entity);
            });
            this.slopeEntities = [];
        }

        this.slopeVisualizationActive = false;
        this.removeSlopeLegend();
    }

    /**
     * Add slope legend
     */
    addSlopeLegend() {
        this.removeSlopeLegend();

        const { t1, t2, t3 } = this.getSlopeVisualizationConfig();

        const legend = document.createElement('div');
        legend.id = 'slopeLegend';
        legend.className = 'slope-legend';
        legend.innerHTML = `
            <div class="legend-header">Slope Analysis</div>
            <div class="legend-item">
                <div class="legend-color" style="background: #00ff00;"></div>
                <span>0–${t1}° (Gentle)</span>
            </div>
            <div class="legend-item">
                <div class="legend-color" style="background: #ffff00;"></div>
                <span>${t1}–${t2}° (Moderate)</span>
            </div>
            <div class="legend-item">
                <div class="legend-color" style="background: #ff8000;"></div>
                <span>${t2}–${t3}° (Steep)</span>
            </div>
            <div class="legend-item">
                <div class="legend-color" style="background: #ff0000;"></div>
                <span>${t3}°+ (Very Steep)</span>
            </div>
        `;

        document.querySelector('.viewer-container')?.appendChild(legend);
    }

    /**
     * Remove slope legend
     */
    removeSlopeLegend() {
        const legend = document.getElementById('slopeLegend');
        if (legend) {
            legend.remove();
        }
    }

    /**
     * Apply ground level view
     */
    applyGroundLevelMode(enabled) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const camera = viewer.camera;

        if (enabled) {
            // Set camera to ground level
            const currentPosition = camera.position;
            const cartographic = Cesium.Cartographic.fromCartesian(currentPosition);
            const groundHeight = viewer.scene.globe.getHeight(cartographic) || 0;
            
            camera.setView({
                destination: Cesium.Cartesian3.fromRadians(
                    cartographic.longitude,
                    cartographic.latitude,
                    groundHeight + 1.7 // Eye height
                ),
                orientation: {
                    heading: camera.heading,
                    pitch: -0.1, // Slight downward angle
                    roll: 0
                }
            });
        }
    }

    /**
     * Show compass
     */
    showCompass() {
        // Compass is typically shown as an overlay
        // Cesium has built-in compass, but we can add custom one
        const compass = document.getElementById('compassOverlay');
        if (!compass) {
            const compassEl = document.createElement('div');
            compassEl.id = 'compassOverlay';
            compassEl.className = 'compass-overlay';
            compassEl.innerHTML = '<div class="compass-needle">N</div>';
            document.querySelector('.viewer-container')?.appendChild(compassEl);
        } else {
            compass.style.display = 'block';
        }
    }

    /**
     * Hide compass
     */
    hideCompass() {
        const compass = document.getElementById('compassOverlay');
        if (compass) {
            compass.style.display = 'none';
        }
    }

    /**
     * Apply weather effect
     */
    applyWeatherEffect(weather) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const scene = viewer.scene;

        // Remove existing weather effects
        this.removeWeatherEffects();

        if (weather === 'snow') {
            this.applySnowEffect();
        } else if (weather === 'rain') {
            this.applyRainEffect();
        }
    }

    /**
     * Apply snow effect
     */
    applySnowEffect() {
        if (!this.tilesetViewer?.viewer?.scene) return;
        const scene = this.tilesetViewer.viewer.scene;
        const sm = window.t && window.t.SceneModes && window.t.SceneModes.snow;
        const d =
            sm && typeof sm.density === 'number' && !Number.isNaN(sm.density)
                ? Math.min(0.02, Math.max(0.0001, sm.density))
                : 0.0018;
        const b =
            sm && typeof sm.minimumBrightness === 'number' && !Number.isNaN(sm.minimumBrightness)
                ? Math.min(1, Math.max(0, sm.minimumBrightness))
                : 0.65;
        scene.fog.enabled = true;
        scene.fog.density = d;
        scene.fog.minimumBrightness = b;
    }

    /**
     * Apply rain effect
     */
    applyRainEffect() {
        if (!this.tilesetViewer?.viewer?.scene) return;
        const scene = this.tilesetViewer.viewer.scene;
        const sm = window.t && window.t.SceneModes && window.t.SceneModes.rain;
        const d =
            sm && typeof sm.density === 'number' && !Number.isNaN(sm.density)
                ? Math.min(0.02, Math.max(0.0001, sm.density))
                : 0.0012;
        const b =
            sm && typeof sm.minimumBrightness === 'number' && !Number.isNaN(sm.minimumBrightness)
                ? Math.min(1, Math.max(0, sm.minimumBrightness))
                : 0.45;
        scene.fog.enabled = true;
        scene.fog.density = d;
        scene.fog.minimumBrightness = b;
    }

    /**
     * Remove weather effects
     */
    removeWeatherEffects() {
        if (!this.tilesetViewer?.viewer?.scene) return;
        const scene = this.tilesetViewer.viewer.scene;
        scene.fog.enabled = false;
        scene.fog.density = 0.0002;
        scene.fog.minimumBrightness = 0.03;
    }

    /**
     * Apply grid mode
     */
    applyGridMode(enabled) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const scene = viewer.scene;

        if (enabled) {
            // Add grid overlay
            scene.globe.material = new Cesium.GridMaterialProperty({
                color: Cesium.Color.WHITE,
                cellAlpha: 0.1,
                lineCount: new Cesium.Cartesian2(10, 10),
                lineThickness: new Cesium.Cartesian2(1.0, 1.0)
            });
        } else {
            // Remove grid if no other material is active
            if (!this.currentModes.wireframe) {
                scene.globe.material = undefined;
            }
        }
    }

    /**
     * Reset to defaults
     */
    resetToDefaults() {
        this.currentModes = {
            wireframe: false,
            contours: false,
            solid: true,
            slope: false,
            verticalExaggeration: 1.0,
            groundLevel: false,
            compass: true,
            lighting: true,
            weather: 'none',
            clouds: false,
            grid: false
        };

        // Update UI
        document.getElementById('wireframeMode').checked = false;
        document.getElementById('solidMode').checked = true;
        document.getElementById('contoursMode').checked = false;
        document.getElementById('slopeMode').checked = false;
        document.getElementById('groundLevelMode').checked = false;
        document.getElementById('compassMode').checked = true;
        document.getElementById('lightingMode').checked = true;
        document.getElementById('cloudsMode').checked = false;
        document.getElementById('gridMode').checked = false;
        document.getElementById('weatherSelect').value = 'none';
        document.getElementById('verticalExaggerationSlider').value = '1.0';
        document.getElementById('verticalExaggerationValue').textContent = '1.0x';

        this.applyDisplayModes();

        if (window.notification && window.appI18n?.nt) {
            window.notification.success(window.appI18n.nt('displayModesReset'));
        }
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.displayModesManager = new DisplayModesManager();
}
