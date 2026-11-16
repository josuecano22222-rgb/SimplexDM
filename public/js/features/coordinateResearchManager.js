/**
 * CoordinateResearchManager
 * Comprehensive coordinate research and conversion tool
 * Supports DD, DMM, DMS, UTM, and MGRS formats
 */

class CoordinateResearchManager {
    constructor() {
        this.converter = null;
        this.modal = null;
        this.tilesetViewer = null;
        this._userMarkers = [];
        this.FLY_PIN_ID = 'coord_research_fly_pin';
        /** Decimal places for DD display, labels, and copy (matches input fields). */
        this.DD_DISPLAY_PRECISION = 12;
        this.init();
    }

    /**
     * Prefer the user's typed string when it parses to the same value (avoids float/format drift).
     */
    _preferRawDecimalString(raw, value) {
        const p = this.DD_DISPLAY_PRECISION;
        if (raw == null || typeof raw !== 'string') return Number(value).toFixed(p);
        const s = raw.trim();
        if (!s) return Number(value).toFixed(p);
        const n = parseFloat(s);
        if (!Number.isFinite(n) || !Number.isFinite(value)) return Number(value).toFixed(p);
        if (Math.abs(n - value) < 1e-14) return s;
        return Number(value).toFixed(p);
    }

    _ddMapLabel(lat, lon, heightM) {
        const p = this.DD_DISPLAY_PRECISION;
        return `${lat.toFixed(p)}°, ${lon.toFixed(p)}°  ·  ${heightM.toFixed(1)} m`;
    }

    /**
     * Initialize coordinate research manager
     */
    init() {
        // Initialize converter
        if (typeof CoordinateConverter !== 'undefined') {
            this.converter = new CoordinateConverter();
        } else {
            console.warn('CoordinateConverter not loaded');
        }

        this.tilesetViewer = window.tilesetViewer;
        
        // Ensure modal is created
        if (!this.modal) {
            this.createModal();
        }
        
        // Setup event handlers
        if (this.modal) {
            this.setupEventHandlers();
        } else {
            console.error('CoordinateResearchManager: Failed to create modal during init');
        }
    }

    parseCoordinate(input) {
        if (!input || typeof input !== 'string') return null;
        const trimmed = input.trim();

        // Prefer existing converter when available
        if (this.converter && typeof this.converter.parseCoordinateString === 'function') {
            const parsed = this.converter.parseCoordinateString(trimmed);
            if (parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lon)) {
                return { lat: parsed.lat, lon: parsed.lon };
            }
        }

        // Decimal degrees: "lat, lon" or "lat lon"
        const decimalMatch = trimmed.match(/(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/);
        if (decimalMatch) {
            let a = parseFloat(decimalMatch[1]);
            let b = parseFloat(decimalMatch[2]);
            if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
            // Heuristic: values beyond ±90° in the first field are almost always longitude (lon, lat order).
            let lat;
            let lon;
            if (Math.abs(a) > 90 && Math.abs(b) <= 90) {
                lon = a;
                lat = b;
            } else {
                lat = a;
                lon = b;
            }
            if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
        }

        // DMS helper
        const dmsToDecimal = (deg, min, sec, hemi) => {
            let v = Math.abs(deg) + (min || 0) / 60 + (sec || 0) / 3600;
            const h = (hemi || '').toUpperCase();
            if (h === 'S' || h === 'W') v = -v;
            if (deg < 0) v = -Math.abs(v);
            return v;
        };

        // DMS pattern: "23°27'7.56\"N 45°7'24.24\"E" or "23 27 7.56 N, 45 7 24.24 E"
        const dmsPattern = /(\d+)[°\s]+(\d+)[′'\s]+(\d+(?:\.\d+)?)[″"\s]*([NS])[\s,]+(\d+)[°\s]+(\d+)[′'\s]+(\d+(?:\.\d+)?)[″"\s]*([EW])/i;
        const dmsMatch = trimmed.match(dmsPattern);
        if (dmsMatch) {
            const lat = dmsToDecimal(parseFloat(dmsMatch[1]), parseFloat(dmsMatch[2]), parseFloat(dmsMatch[3]), dmsMatch[4]);
            const lon = dmsToDecimal(parseFloat(dmsMatch[5]), parseFloat(dmsMatch[6]), parseFloat(dmsMatch[7]), dmsMatch[8]);
            if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
        }

        return null;
    }

    /**
     * Wait a couple of frames so 3D Tiles / depth are ready before ray pick.
     */
    async _waitForRenderFrames(viewer, count = 2) {
        for (let i = 0; i < count; i++) {
            viewer.scene.requestRender?.();
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
    }

    /**
     * Intersect a downward ray with the scene (3D Tiles, globe, etc.) for accurate placement.
     */
    _sampleSurfaceCartesian(viewer, lon, lat) {
        const scene = viewer.scene;
        const ellipsoid = scene.globe.ellipsoid;
        const tryHeights = [220000, 140000, 80000, 40000, 18000, 8000];
        for (let i = 0; i < tryHeights.length; i++) {
            const h = tryHeights[i];
            const origin = Cesium.Cartesian3.fromDegrees(lon, lat, h);
            const normal = ellipsoid.geodeticSurfaceNormal(origin, new Cesium.Cartesian3());
            const direction = Cesium.Cartesian3.negate(normal, new Cesium.Cartesian3());
            const ray = new Cesium.Ray(origin, direction);
            if (typeof scene.pickFromRay === 'function') {
                const hit = scene.pickFromRay(ray);
                if (hit && hit.position) {
                    const carto = Cesium.Cartographic.fromCartesian(hit.position);
                    const liftM = 2.5;
                    return Cesium.Cartesian3.fromRadians(
                        carto.longitude,
                        carto.latitude,
                        carto.height + liftM
                    );
                }
            }
        }
        return Cesium.Cartesian3.fromDegrees(lon, lat, 3.0);
    }

    async _sampleSurfaceCartesianAsync(viewer, lon, lat) {
        await this._waitForRenderFrames(viewer, 3);
        return this._sampleSurfaceCartesian(viewer, lon, lat);
    }

    _pointGraphicOptions() {
        return {
            pixelSize: 14,
            color: Cesium.Color.fromCssColorString('#00d4aa').withAlpha(0.95),
            outlineColor: Cesium.Color.fromCssColorString('#0a1628'),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        };
    }

    _labelGraphicOptions(text) {
        return {
            text,
            font: '600 13px system-ui, -apple-system, "Segoe UI", sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.fromCssColorString('#0a1628'),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#0a1628').withAlpha(0.82),
            backgroundPadding: new Cesium.Cartesian2(10, 4)
        };
    }

    /**
     * Create coordinate research modal
     */
    createModal() {
        // Remove existing if any
        const existing = document.getElementById('coordinateResearchModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'coordinateResearchModal';
        modal.className = 'coordinate-research-modal';

        modal.innerHTML = `
            <div class="coordinate-research-content">
                <div class="coordinate-research-header">
                    <h2 class="coordinate-research-title">
                        <span class="coordinate-research-title-icon" aria-hidden="true"><i class="fas fa-crosshairs"></i></span>
                        <span data-i18n="ui.coordResearch.heading">Coordinate Research</span>
                    </h2>
                    <button type="button" class="close-btn coord-close-btn" id="closeCoordinateResearchBtn" data-i18n-aria="ui.coordResearch.closeAria" aria-label="Close">
                        <i class="fas fa-times" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="coordinate-research-body">
                    <section class="coord-card coord-card--quick" aria-labelledby="coordQuickHeading">
                        <div class="coord-card-head">
                            <span class="coord-card-icon" aria-hidden="true"><i class="fas fa-search"></i></span>
                            <h3 class="coord-card-title" id="coordQuickHeading" data-i18n="ui.coordResearch.findOnMap">Find on map</h3>
                        </div>
                        <div class="coordinate-quick-row">
                            <input type="text" id="coordinateQuickSearchInput" class="coordinate-input coordinate-quick-input" autocomplete="off" aria-labelledby="coordQuickHeading" data-i18n-placeholder="ui.coordResearch.quickPlaceholder" placeholder="Paste lat, lon (e.g. 60.1699, 24.9384) or a maps link" />
                            <button type="button" class="btn btn-primary btn-icon-text" id="coordinateQuickSearchBtn" data-i18n="ui.coordResearch.go" data-i18n-title="ui.coordResearch.goTitle" title="Place pin and fly">
                                <i class="fas fa-arrow-right" aria-hidden="true"></i><span data-i18n="ui.coordResearch.go">Go</span>
                            </button>
                        </div>
                        <div class="coordinate-quick-actions">
                            <button type="button" class="btn btn-icon-text" id="coordinateClearPinsBtn" data-i18n="ui.coordResearch.clearPins" data-i18n-title="ui.coordResearch.clearPinsTitle" title="Remove pins from the map">
                                <i class="fas fa-trash-alt" aria-hidden="true"></i><span data-i18n="ui.coordResearch.clearPins">Clear pins</span>
                            </button>
                        </div>
                        <p class="input-hint coordinate-quick-hint" data-i18n="ui.coordResearch.quickHint">Pin is placed on the 3D surface (tiles) when available, then lifted slightly so it stays visible on top.</p>
                    </section>

                    <section class="coord-card coord-card--input" aria-labelledby="coordInputHeading">
                        <div class="coord-card-head">
                            <span class="coord-card-icon" aria-hidden="true"><i class="fas fa-edit"></i></span>
                            <h3 class="coord-card-title" id="coordInputHeading" data-i18n="ui.coordResearch.inputHeading">Input Coordinates</h3>
                        </div>
                        <div class="coord-tab-strip-wrap">
                        <div class="coordinate-input-tabs coord-tab-strip" role="tablist" aria-label="Input coordinate format">
                            <button type="button" role="tab" class="coord-fmt-tab active" id="cr-tab-in-dd" data-format="dd" aria-selected="true" aria-controls="cr-panel-in-dd" data-i18n="ui.coordResearch.fmtDD">Decimal Degrees</button>
                            <button type="button" role="tab" class="coord-fmt-tab" id="cr-tab-in-dmm" data-format="dmm" aria-selected="false" aria-controls="cr-panel-in-dmm" data-i18n="ui.coordResearch.fmtDMM">Degrees Decimal Minutes</button>
                            <button type="button" role="tab" class="coord-fmt-tab" id="cr-tab-in-dms" data-format="dms" aria-selected="false" aria-controls="cr-panel-in-dms" data-i18n="ui.coordResearch.fmtDMS">Degrees Minutes Seconds</button>
                            <button type="button" role="tab" class="coord-fmt-tab" id="cr-tab-in-utm" data-format="utm" aria-selected="false" aria-controls="cr-panel-in-utm" data-i18n="ui.coordResearch.fmtUTM">UTM</button>
                            <button type="button" role="tab" class="coord-fmt-tab" id="cr-tab-in-mgrs" data-format="mgrs" aria-selected="false" aria-controls="cr-panel-in-mgrs" data-i18n="ui.coordResearch.fmtMGRS">MGRS</button>
                        </div>
                        </div>
                        
                        <!-- DD Input -->
                        <div class="input-panel active" id="cr-panel-in-dd" role="tabpanel" data-panel="dd" aria-labelledby="cr-tab-in-dd" aria-hidden="false">
                            <div class="input-group">
                                <label data-i18n="ui.coordResearch.latLabel">Latitude:</label>
                                <input type="number" id="ddLatInput" class="coordinate-input" step="0.0000000001" data-i18n-placeholder="ui.coordResearch.ddPhLat" placeholder="e.g., 31.7683190000">
                                <small class="input-hint" data-i18n="ui.coordResearch.ddPrecisionHint">High precision: up to 10 decimal places</small>
                            </div>
                            <div class="input-group">
                                <label data-i18n="ui.coordResearch.lonLabel">Longitude:</label>
                                <input type="number" id="ddLonInput" class="coordinate-input" step="0.0000000001" data-i18n-placeholder="ui.coordResearch.ddPhLon" placeholder="e.g., 35.2137100000">
                                <small class="input-hint" data-i18n="ui.coordResearch.ddPrecisionHint">High precision: up to 10 decimal places</small>
                            </div>
                        </div>
                        
                        <!-- DMM Input -->
                        <div class="input-panel" id="cr-panel-in-dmm" role="tabpanel" data-panel="dmm" aria-labelledby="cr-tab-in-dmm" aria-hidden="true">
                            <div class="input-group">
                                <label data-i18n="ui.coordResearch.latLabel">Latitude:</label>
                                <div class="dmm-input-group">
                                    <input type="number" id="dmmLatDegInput" class="coordinate-input small" data-i18n-placeholder="ui.coordResearch.phDegrees" placeholder="Degrees" step="1">
                                    <span>°</span>
                                    <input type="number" id="dmmLatMinInput" class="coordinate-input small" data-i18n-placeholder="ui.coordResearch.phMinutes" placeholder="Minutes" step="0.00001">
                                    <span>′</span>
                                    <select id="dmmLatDirInput" class="direction-select">
                                        <option value="N">N</option>
                                        <option value="S">S</option>
                                    </select>
                                </div>
                            </div>
                            <div class="input-group">
                                <label data-i18n="ui.coordResearch.lonLabel">Longitude:</label>
                                <div class="dmm-input-group">
                                    <input type="number" id="dmmLonDegInput" class="coordinate-input small" data-i18n-placeholder="ui.coordResearch.phDegrees" placeholder="Degrees" step="1">
                                    <span>°</span>
                                    <input type="number" id="dmmLonMinInput" class="coordinate-input small" data-i18n-placeholder="ui.coordResearch.phMinutes" placeholder="Minutes" step="0.00001">
                                    <span>′</span>
                                    <select id="dmmLonDirInput" class="direction-select">
                                        <option value="E">E</option>
                                        <option value="W">W</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        
                        <!-- DMS Input -->
                        <div class="input-panel" id="cr-panel-in-dms" role="tabpanel" data-panel="dms" aria-labelledby="cr-tab-in-dms" aria-hidden="true">
                            <div class="input-group">
                                <label data-i18n="ui.coordResearch.latLabel">Latitude:</label>
                                <div class="dms-input-group">
                                    <input type="number" id="dmsLatDegInput" class="coordinate-input small" data-i18n-placeholder="ui.coordResearch.phDegrees" placeholder="Degrees" step="1">
                                    <span>°</span>
                                    <input type="number" id="dmsLatMinInput" class="coordinate-input small" data-i18n-placeholder="ui.coordResearch.phMinutes" placeholder="Minutes" step="1">
                                    <span>′</span>
                                    <input type="number" id="dmsLatSecInput" class="coordinate-input small" data-i18n-placeholder="ui.coordResearch.phSeconds" placeholder="Seconds" step="0.01">
                                    <span>″</span>
                                    <select id="dmsLatDirInput" class="direction-select">
                                        <option value="N">N</option>
                                        <option value="S">S</option>
                                    </select>
                                </div>
                            </div>
                            <div class="input-group">
                                <label data-i18n="ui.coordResearch.lonLabel">Longitude:</label>
                                <div class="dms-input-group">
                                    <input type="number" id="dmsLonDegInput" class="coordinate-input small" data-i18n-placeholder="ui.coordResearch.phDegrees" placeholder="Degrees" step="1">
                                    <span>°</span>
                                    <input type="number" id="dmsLonMinInput" class="coordinate-input small" data-i18n-placeholder="ui.coordResearch.phMinutes" placeholder="Minutes" step="1">
                                    <span>′</span>
                                    <input type="number" id="dmsLonSecInput" class="coordinate-input small" data-i18n-placeholder="ui.coordResearch.phSeconds" placeholder="Seconds" step="0.01">
                                    <span>″</span>
                                    <select id="dmsLonDirInput" class="direction-select">
                                        <option value="E">E</option>
                                        <option value="W">W</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        
                        <!-- UTM Input -->
                        <div class="input-panel" id="cr-panel-in-utm" role="tabpanel" data-panel="utm" aria-labelledby="cr-tab-in-utm" aria-hidden="true">
                            <div class="input-group">
                                <label data-i18n="ui.coordResearch.zoneLabel">Zone:</label>
                                <input type="number" id="utmZoneInput" class="coordinate-input" min="1" max="60" data-i18n-placeholder="ui.coordResearch.utmZonePh" placeholder="1-60">
                            </div>
                            <div class="input-group">
                                <label data-i18n="ui.coordResearch.hemisphereLabel">Hemisphere:</label>
                                <select id="utmHemisphereInput" class="coordinate-input">
                                    <option value="N" data-i18n="ui.coordResearch.utmNorthOpt">N (Northern)</option>
                                    <option value="S" data-i18n="ui.coordResearch.utmSouthOpt">S (Southern)</option>
                                </select>
                            </div>
                            <div class="input-group">
                                <label data-i18n="ui.coordResearch.eastingLabel">Easting (m):</label>
                                <input type="number" id="utmEastingInput" class="coordinate-input" step="0.01" data-i18n-placeholder="ui.coordResearch.utmEastingPh" placeholder="e.g., 465000">
                            </div>
                            <div class="input-group">
                                <label data-i18n="ui.coordResearch.northingLabel">Northing (m):</label>
                                <input type="number" id="utmNorthingInput" class="coordinate-input" step="0.01" data-i18n-placeholder="ui.coordResearch.utmNorthingPh" placeholder="e.g., 6035000">
                            </div>
                        </div>
                        
                        <!-- MGRS Input -->
                        <div class="input-panel" id="cr-panel-in-mgrs" role="tabpanel" data-panel="mgrs" aria-labelledby="cr-tab-in-mgrs" aria-hidden="true">
                            <div class="input-group">
                                <label data-i18n="ui.coordResearch.mgrsLabel">MGRS:</label>
                                <input type="text" id="mgrsInput" class="coordinate-input" data-i18n-placeholder="ui.coordResearch.mgrsPh" placeholder="e.g., 40U EJ 12345 67890">
                                <small class="input-hint" data-i18n="ui.coordResearch.mgrsFormatHint">Format: Zone Band Grid Easting Northing</small>
                            </div>
                        </div>
                        
                        <div class="coordinate-actions coord-actions-row">
                            <button type="button" class="btn btn-primary btn-icon-text" id="convertCoordinatesBtn">
                                <i class="fas fa-sync-alt" aria-hidden="true"></i><span data-i18n="ui.coordResearch.convert">Convert</span>
                            </button>
                            <button type="button" class="btn btn-icon-text" id="useCurrentLocationBtn">
                                <i class="fas fa-crosshairs" aria-hidden="true"></i><span data-i18n="ui.coordResearch.useCurrentLocation">Use Current Location</span>
                            </button>
                            <button type="button" class="btn btn-icon-text" id="parseFromStringBtn">
                                <i class="fas fa-file-import" aria-hidden="true"></i><span data-i18n="ui.coordResearch.parseFromString">Parse from String</span>
                            </button>
                        </div>
                    </section>

                    <section class="coord-card coord-card--output" aria-labelledby="coordOutputHeading">
                        <div class="coord-card-head">
                            <span class="coord-card-icon" aria-hidden="true"><i class="fas fa-exchange-alt"></i></span>
                            <h3 class="coord-card-title" id="coordOutputHeading" data-i18n="ui.coordResearch.outputHeading">Converted Coordinates</h3>
                        </div>
                        <div class="coord-tab-strip-wrap">
                        <div class="output-tabs coord-tab-strip" role="tablist" aria-label="Converted coordinate format">
                            <button type="button" role="tab" class="output-tab-btn active" id="cr-tab-out-dd" data-output="dd" aria-selected="true" aria-controls="cr-panel-out-dd" data-i18n="ui.coordResearch.fmtDD">Decimal Degrees</button>
                            <button type="button" role="tab" class="output-tab-btn" id="cr-tab-out-dmm" data-output="dmm" aria-selected="false" aria-controls="cr-panel-out-dmm" data-i18n="ui.coordResearch.fmtDMM">Degrees Decimal Minutes</button>
                            <button type="button" role="tab" class="output-tab-btn" id="cr-tab-out-dms" data-output="dms" aria-selected="false" aria-controls="cr-panel-out-dms" data-i18n="ui.coordResearch.fmtDMS">Degrees Minutes Seconds</button>
                            <button type="button" role="tab" class="output-tab-btn" id="cr-tab-out-utm" data-output="utm" aria-selected="false" aria-controls="cr-panel-out-utm" data-i18n="ui.coordResearch.fmtUTM">UTM</button>
                            <button type="button" role="tab" class="output-tab-btn" id="cr-tab-out-mgrs" data-output="mgrs" aria-selected="false" aria-controls="cr-panel-out-mgrs" data-i18n="ui.coordResearch.fmtMGRS">MGRS</button>
                        </div>
                        </div>

                        <div class="output-panels">
                            <div class="output-panel active" id="cr-panel-out-dd" role="tabpanel" data-output="dd" aria-labelledby="cr-tab-out-dd" aria-hidden="false">
                                <div class="output-value output-dd-row">
                                    <div class="output-label" data-i18n="ui.coordResearch.latLabel">Latitude:</div>
                                    <div class="output-text" id="outputDDLat">--</div>
                                    <button type="button" class="copy-btn" data-copy="dd-lat" data-i18n-title="ui.coordResearch.copyLatTitle" aria-label="Copy latitude" title="Copy latitude"><i class="fas fa-copy" aria-hidden="true"></i></button>
                                </div>
                                <div class="output-value output-dd-row">
                                    <div class="output-label" data-i18n="ui.coordResearch.lonLabel">Longitude:</div>
                                    <div class="output-text" id="outputDDLon">--</div>
                                    <button type="button" class="copy-btn" data-copy="dd-lon" data-i18n-title="ui.coordResearch.copyLonTitle" aria-label="Copy longitude" title="Copy longitude"><i class="fas fa-copy" aria-hidden="true"></i></button>
                                </div>
                                <div class="output-value output-value--pair">
                                    <div class="output-label" data-i18n="ui.coordResearch.outLatLonPair">Lat, lon (decimal):</div>
                                    <div class="output-text output-text--strong" id="outputDDLatLon">--</div>
                                    <button type="button" class="copy-btn copy-btn--primary" data-copy="dd-both" data-i18n-title="ui.coordResearch.copyLatLonPairTitle" aria-label="Copy lat, lon pair" title="Copy lat, lon (decimal degrees)"><i class="fas fa-copy" aria-hidden="true"></i></button>
                                </div>
                            </div>

                            <div class="output-panel" id="cr-panel-out-dmm" role="tabpanel" data-output="dmm" aria-labelledby="cr-tab-out-dmm" aria-hidden="true">
                                <div class="output-value">
                                    <div class="output-label" data-i18n="ui.coordResearch.latLabel">Latitude:</div>
                                    <div class="output-text" id="outputDMMLat">--</div>
                                    <button type="button" class="copy-btn" data-copy="dmm-lat" aria-label="Copy"><i class="fas fa-copy" aria-hidden="true"></i></button>
                                </div>
                                <div class="output-value">
                                    <div class="output-label" data-i18n="ui.coordResearch.lonLabel">Longitude:</div>
                                    <div class="output-text" id="outputDMMLon">--</div>
                                    <button type="button" class="copy-btn" data-copy="dmm-lon" aria-label="Copy"><i class="fas fa-copy" aria-hidden="true"></i></button>
                                </div>
                            </div>

                            <div class="output-panel" id="cr-panel-out-dms" role="tabpanel" data-output="dms" aria-labelledby="cr-tab-out-dms" aria-hidden="true">
                                <div class="output-value">
                                    <div class="output-label" data-i18n="ui.coordResearch.latLabel">Latitude:</div>
                                    <div class="output-text" id="outputDMSLat">--</div>
                                    <button type="button" class="copy-btn" data-copy="dms-lat" aria-label="Copy"><i class="fas fa-copy" aria-hidden="true"></i></button>
                                </div>
                                <div class="output-value">
                                    <div class="output-label" data-i18n="ui.coordResearch.lonLabel">Longitude:</div>
                                    <div class="output-text" id="outputDMSLon">--</div>
                                    <button type="button" class="copy-btn" data-copy="dms-lon" aria-label="Copy"><i class="fas fa-copy" aria-hidden="true"></i></button>
                                </div>
                            </div>

                            <div class="output-panel" id="cr-panel-out-utm" role="tabpanel" data-output="utm" aria-labelledby="cr-tab-out-utm" aria-hidden="true">
                                <div class="output-value">
                                    <div class="output-label" data-i18n="ui.coordResearch.outZone">Zone:</div>
                                    <div class="output-text" id="outputUTMZone">--</div>
                                </div>
                                <div class="output-value">
                                    <div class="output-label" data-i18n="ui.coordResearch.outHemisphere">Hemisphere:</div>
                                    <div class="output-text" id="outputUTMHemisphere">--</div>
                                </div>
                                <div class="output-value">
                                    <div class="output-label" data-i18n="ui.coordResearch.outEasting">Easting:</div>
                                    <div class="output-text" id="outputUTMEasting">--</div>
                                    <button type="button" class="copy-btn" data-copy="utm-easting" aria-label="Copy"><i class="fas fa-copy" aria-hidden="true"></i></button>
                                </div>
                                <div class="output-value">
                                    <div class="output-label" data-i18n="ui.coordResearch.outNorthing">Northing:</div>
                                    <div class="output-text" id="outputUTMNorthing">--</div>
                                    <button type="button" class="copy-btn" data-copy="utm-northing" aria-label="Copy"><i class="fas fa-copy" aria-hidden="true"></i></button>
                                </div>
                            </div>

                            <div class="output-panel" id="cr-panel-out-mgrs" role="tabpanel" data-output="mgrs" aria-labelledby="cr-tab-out-mgrs" aria-hidden="true">
                                <div class="output-value">
                                    <div class="output-label" data-i18n="ui.coordResearch.outMgrs">MGRS:</div>
                                    <div class="output-text" id="outputMGRS">--</div>
                                    <button type="button" class="copy-btn" data-copy="mgrs" aria-label="Copy"><i class="fas fa-copy" aria-hidden="true"></i></button>
                                </div>
                            </div>
                        </div>

                        <div class="coordinate-map-actions coord-actions-row">
                            <button type="button" class="btn btn-primary btn-icon-text" id="flyToCoordinatesBtn">
                                <i class="fas fa-paper-plane" aria-hidden="true"></i><span data-i18n="ui.coordResearch.flyToLocation">Fly to Location</span>
                            </button>
                            <button type="button" class="btn btn-icon-text" id="addMarkerBtn">
                                <i class="fas fa-map-marker-alt" aria-hidden="true"></i><span data-i18n="ui.coordResearch.addMarker">Add Marker</span>
                            </button>
                        </div>
                    </section>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
        if (typeof window !== 'undefined' && window.appI18n && typeof window.appI18n.applyDom === 'function') {
            window.appI18n.applyDom(modal);
        }
        this._onLocaleChanged = () => {
            if (this.modal && window.appI18n) {
                window.appI18n.applyDom(this.modal);
                if (this.currentResult) {
                    this.displayResults(this.currentResult);
                }
            }
        };
        window.addEventListener('simplex:localeChanged', this._onLocaleChanged);
        this._handlersBound = false;
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        if (this._handlersBound) return;
        this._handlersBound = true;

        // Close button
        const closeBtn = document.getElementById('closeCoordinateResearchBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide());
        }

        // Input format tabs
        const inputTabs = this.modal.querySelectorAll('.coordinate-input-tabs .coord-fmt-tab');
        inputTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                const format = e.currentTarget.dataset.format;
                if (format) this.switchInputFormat(format);
            });
        });

        // Output format tabs
        const outputTabs = this.modal.querySelectorAll('.output-tab-btn');
        outputTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                const format = e.currentTarget.dataset.output;
                if (format) this.switchOutputFormat(format);
            });
        });

        // Convert button
        const convertBtn = document.getElementById('convertCoordinatesBtn');
        if (convertBtn) {
            convertBtn.addEventListener('click', () => this.convert());
        }

        // Use current location button
        const useCurrentBtn = document.getElementById('useCurrentLocationBtn');
        if (useCurrentBtn) {
            useCurrentBtn.addEventListener('click', () => this.useCurrentLocation());
        }

        // Parse from string button
        const parseBtn = document.getElementById('parseFromStringBtn');
        if (parseBtn) {
            parseBtn.addEventListener('click', () => this.parseFromString());
        }

        // Fly to coordinates button
        const flyToBtn = document.getElementById('flyToCoordinatesBtn');
        if (flyToBtn) {
            flyToBtn.addEventListener('click', () => this.flyToCoordinates());
        }

        // Add marker button
        const addMarkerBtn = document.getElementById('addMarkerBtn');
        if (addMarkerBtn) {
            addMarkerBtn.addEventListener('click', () => this.addMarker());
        }

        const quickBtn = document.getElementById('coordinateQuickSearchBtn');
        if (quickBtn) {
            quickBtn.addEventListener('click', () => this.quickSearchGo());
        }
        const quickInput = document.getElementById('coordinateQuickSearchInput');
        if (quickInput) {
            quickInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.quickSearchGo();
                }
            });
        }
        const clearPinsBtn = document.getElementById('coordinateClearPinsBtn');
        if (clearPinsBtn) {
            clearPinsBtn.addEventListener('click', () => this.clearCoordinatePins());
        }

        // Copy buttons
        const copyBtns = this.modal.querySelectorAll('.copy-btn');
        copyBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const copyType = e.currentTarget.dataset.copy;
                if (copyType) this.copyToClipboard(copyType);
            });
        });

        // Enter key handlers for inputs
        const inputs = this.modal.querySelectorAll('.coordinate-input');
        inputs.forEach(input => {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.convert();
                }
            });
        });
    }

    /**
     * Switch input format tab
     */
    switchInputFormat(format) {
        // Update tabs
        const tabs = this.modal.querySelectorAll('.coord-fmt-tab');
        tabs.forEach(tab => {
            const on = tab.dataset.format === format;
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
        });

        // Update panels
        const panels = this.modal.querySelectorAll('.input-panel');
        panels.forEach(panel => {
            const on = panel.dataset.panel === format;
            panel.classList.toggle('active', on);
            panel.setAttribute('aria-hidden', on ? 'false' : 'true');
        });
    }

    /**
     * Switch output format tab
     */
    switchOutputFormat(format) {
        // Update tabs
        const tabs = this.modal.querySelectorAll('.output-tab-btn');
        tabs.forEach(tab => {
            const on = tab.dataset.output === format;
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
        });

        // Update panels
        const panels = this.modal.querySelectorAll('.output-panel');
        panels.forEach(panel => {
            const on = panel.dataset.output === format;
            panel.classList.toggle('active', on);
            panel.setAttribute('aria-hidden', on ? 'false' : 'true');
        });
    }

    /**
     * Get input coordinates based on current format
     */
    getInputCoordinates() {
        const activePanel = this.modal.querySelector('.input-panel.active');
        const format = activePanel.dataset.panel;

        switch (format) {
            case 'dd':
                const lat = parseFloat(document.getElementById('ddLatInput').value);
                const lon = parseFloat(document.getElementById('ddLonInput').value);
                if (isNaN(lat) || isNaN(lon)) return null;
                return { lat, lon };

            case 'dmm':
                const latDeg = parseInt(document.getElementById('dmmLatDegInput').value);
                const latMin = parseFloat(document.getElementById('dmmLatMinInput').value);
                const latDir = document.getElementById('dmmLatDirInput').value;
                const lonDeg = parseInt(document.getElementById('dmmLonDegInput').value);
                const lonMin = parseFloat(document.getElementById('dmmLonMinInput').value);
                const lonDir = document.getElementById('dmmLonDirInput').value;
                if (isNaN(latDeg) || isNaN(latMin) || isNaN(lonDeg) || isNaN(lonMin)) return null;
                let latDD = this.converter.dmmToDD(latDeg, latMin);
                let lonDD = this.converter.dmmToDD(lonDeg, lonMin);
                if (latDir === 'S') latDD = -latDD;
                if (lonDir === 'W') lonDD = -lonDD;
                return { lat: latDD, lon: lonDD };

            case 'dms':
                const dmsLatDeg = parseInt(document.getElementById('dmsLatDegInput').value);
                const dmsLatMin = parseInt(document.getElementById('dmsLatMinInput').value);
                const dmsLatSec = parseFloat(document.getElementById('dmsLatSecInput').value);
                const dmsLatDir = document.getElementById('dmsLatDirInput').value;
                const dmsLonDeg = parseInt(document.getElementById('dmsLonDegInput').value);
                const dmsLonMin = parseInt(document.getElementById('dmsLonMinInput').value);
                const dmsLonSec = parseFloat(document.getElementById('dmsLonSecInput').value);
                const dmsLonDir = document.getElementById('dmsLonDirInput').value;
                if (isNaN(dmsLatDeg) || isNaN(dmsLatMin) || isNaN(dmsLatSec) || 
                    isNaN(dmsLonDeg) || isNaN(dmsLonMin) || isNaN(dmsLonSec)) return null;
                let dmsLatDD = this.converter.dmsToDD(dmsLatDeg, dmsLatMin, dmsLatSec);
                let dmsLonDD = this.converter.dmsToDD(dmsLonDeg, dmsLonMin, dmsLonSec);
                if (dmsLatDir === 'S') dmsLatDD = -dmsLatDD;
                if (dmsLonDir === 'W') dmsLonDD = -dmsLonDD;
                return { lat: dmsLatDD, lon: dmsLonDD };

            case 'utm':
                const zone = parseInt(document.getElementById('utmZoneInput').value);
                const hemisphere = document.getElementById('utmHemisphereInput').value;
                const easting = parseFloat(document.getElementById('utmEastingInput').value);
                const northing = parseFloat(document.getElementById('utmNorthingInput').value);
                if (isNaN(zone) || isNaN(easting) || isNaN(northing)) return null;
                return this.converter.utmToDD(zone, hemisphere, easting, northing);

            case 'mgrs':
                const mgrs = document.getElementById('mgrsInput').value.trim();
                if (!mgrs) return null;
                return this.converter.mgrsToDD(mgrs);

            default:
                return null;
        }
    }

    /**
     * Convert coordinates and display results
     */
    convert() {
        if (!this.converter) {
            window.notification?.error(
                window.appI18n?.nt ? window.appI18n.nt('coordConverterUnavailable') : 'Coordinate converter not available'
            );
            return;
        }

        const coords = this.getInputCoordinates();
        if (!coords) {
            window.notification?.warning(
                window.appI18n?.nt ? window.appI18n.nt('coordEnterValid') : 'Please enter valid coordinates'
            );
            return;
        }

        // Validate coordinates
        if (coords.lat < -90 || coords.lat > 90 || coords.lon < -180 || coords.lon > 180) {
            window.notification?.error(
                window.appI18n?.nt ? window.appI18n.nt('coordLatLonRange') : 'Invalid coordinates: Latitude must be -90 to 90, Longitude must be -180 to 180'
            );
            return;
        }

        // Convert to all formats
        const result = this.converter.convertAll({ lat: coords.lat, lon: coords.lon });
        if (!result) {
            window.notification?.error(
                window.appI18n?.nt ? window.appI18n.nt('conversionFailed') : 'Conversion failed'
            );
            return;
        }

        // Store for later use
        this.currentCoordinates = coords;
        this.currentResult = result;

        // Display results
        this.displayResults(result);
    }

    /**
     * Display conversion results
     */
    displayResults(result) {
        const latIn = document.getElementById('ddLatInput')?.value?.trim();
        const lonIn = document.getElementById('ddLonInput')?.value?.trim();
        const latStr = this._preferRawDecimalString(latIn, result.dd.lat);
        const lonStr = this._preferRawDecimalString(lonIn, result.dd.lon);
        document.getElementById('outputDDLat').textContent = `${latStr}°`;
        document.getElementById('outputDDLon').textContent = `${lonStr}°`;

        const latLonPair = `${latStr}, ${lonStr}`;
        document.getElementById('outputDDLatLon').textContent = latLonPair;

        // DMM - Show high precision (8 decimal places for minutes)
        const dmmLatParts = result.dmm.formatted.split(',');
        document.getElementById('outputDMMLat').textContent = dmmLatParts[0] ? dmmLatParts[0].trim() : '--';
        document.getElementById('outputDMMLon').textContent = dmmLatParts[1] ? dmmLatParts[1].trim() : '--';

        // DMS - Show high precision (6 decimal places for seconds)
        const dmsLatParts = result.dms.formatted.split(',');
        document.getElementById('outputDMSLat').textContent = dmsLatParts[0] ? dmsLatParts[0].trim() : '--';
        document.getElementById('outputDMSLon').textContent = dmsLatParts[1] ? dmsLatParts[1].trim() : '--';

        // UTM - Show high precision (3 decimal places)
        document.getElementById('outputUTMZone').textContent = `${result.utm.zone}${result.utm.hemisphere}`;
        const t = (k) => (typeof window !== 'undefined' && window.appI18n ? window.appI18n.t(k) : k);
        document.getElementById('outputUTMHemisphere').textContent =
            result.utm.hemisphere === 'N' ? t('ui.coordResearch.northern') : t('ui.coordResearch.southern');
        document.getElementById('outputUTMEasting').textContent = `${result.utm.easting.toFixed(3)} m`;
        document.getElementById('outputUTMNorthing').textContent = `${result.utm.northing.toFixed(3)} m`;

        // MGRS
        document.getElementById('outputMGRS').textContent = result.mgrs.formatted;
    }

    /**
     * Use current mouse location
     */
    useCurrentLocation() {
        if (!window.coordinateManager || !window.coordinateManager.currentCoordinates) {
            window.notification?.warning(
                window.appI18n?.nt ? window.appI18n.nt('coordNoCursor') : 'No current location available. Move your mouse over the map.'
            );
            return;
        }

        const coords = window.coordinateManager.currentCoordinates;
        if (coords.lon === null || coords.lat === null) {
            window.notification?.warning(
                window.appI18n?.nt ? window.appI18n.nt('coordNoCursor') : 'No current location available. Move your mouse over the map.'
            );
            return;
        }

        // Switch to DD format and fill inputs with high precision (10 decimal places)
        this.switchInputFormat('dd');
        document.getElementById('ddLatInput').value = coords.lat.toFixed(this.DD_DISPLAY_PRECISION);
        document.getElementById('ddLonInput').value = coords.lon.toFixed(this.DD_DISPLAY_PRECISION);

        // Convert automatically
        this.convert();
    }

    /**
     * Parse coordinates from string
     */
    async parseFromString() {
        const t = (k) => (typeof window !== 'undefined' && window.appI18n ? window.appI18n.t(k) : k);
        const ph = t('ui.coordResearch.parseModalPlaceholder');
        const escAttr = (s) =>
            String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const input = await window.notification?.modal(
            t('ui.coordResearch.parseModalTitle'),
            `<input type="text" id="parseStringInput" class="text-input" placeholder="${escAttr(ph)}" style="width: 100%;">`,
            {
                buttons: [
                    { label: t('ui.coordResearch.cancel'), action: 'cancel', class: 'btn' },
                    { label: t('ui.coordResearch.parse'), action: 'parse', class: 'btn-primary' }
                ]
            }
        );

        if (input === 'parse') {
            const parseInput = document.getElementById('parseStringInput');
            if (parseInput && parseInput.value) {
                const coords = this.parseCoordinate(parseInput.value);
                if (coords) {
                    // Switch to DD format and fill inputs with high precision (10 decimal places)
                    this.switchInputFormat('dd');
                    document.getElementById('ddLatInput').value = coords.lat.toFixed(this.DD_DISPLAY_PRECISION);
                    document.getElementById('ddLonInput').value = coords.lon.toFixed(this.DD_DISPLAY_PRECISION);
                    this.convert();
                    window.notification?.success(
                        window.appI18n?.nt ? window.appI18n.nt('coordParseOk') : 'Coordinates parsed successfully!'
                    );
                } else {
                    window.notification?.error(
                        window.appI18n?.nt ? window.appI18n.nt('coordParseFail') : 'Could not parse coordinates. Please check the format. Supports: DD, DMM, DMS, UTM, MGRS, and common pasted map URLs.'
                    );
                }
            }
        }
    }

    /**
     * Quick search: parse box → convert → fly + pin (map-apps style)
     */
    async quickSearchGo() {
        const input = document.getElementById('coordinateQuickSearchInput');
        const raw = input && input.value ? input.value.trim() : '';
        if (!raw) {
            window.notification?.warning(
                window.appI18n?.nt ? window.appI18n.nt('coordSearchEmpty') : 'Enter coordinates or a link to search.'
            );
            return;
        }
        const coords = this.parseCoordinate(raw);
        if (!coords) {
            window.notification?.error(
                window.appI18n?.nt ? window.appI18n.nt('coordSearchUnreadable') : 'Could not read coordinates. Try decimal degrees (lat, lon) or a maps URL.'
            );
            return;
        }
        this.switchInputFormat('dd');
        const latEl = document.getElementById('ddLatInput');
        const lonEl = document.getElementById('ddLonInput');
        if (latEl) latEl.value = coords.lat.toFixed(this.DD_DISPLAY_PRECISION);
        if (lonEl) lonEl.value = coords.lon.toFixed(this.DD_DISPLAY_PRECISION);
        this.convert();
        await this.flyToCoordinates();
    }

    /**
     * Remove fly pin and user-added markers from the map.
     */
    clearCoordinatePins() {
        this.tilesetViewer = window.tilesetViewer;
        const viewer = this.tilesetViewer && this.tilesetViewer.viewer;
        if (!viewer) return;
        const fly = viewer.entities.getById(this.FLY_PIN_ID);
        if (fly) viewer.entities.remove(fly);
        this._userMarkers.forEach((id) => {
            const e = viewer.entities.getById(id);
            if (e) viewer.entities.remove(e);
        });
        this._userMarkers = [];
        viewer.scene.requestRender?.();
        window.notification?.info(window.appI18n?.nt ? window.appI18n.nt('pinsCleared') : 'Pins cleared');
    }

    /**
     * Fly to WGS84 lon/lat with ray-picked surface on 3D Tiles / globe (high accuracy, same as "Fly to Location").
     * @param {number} lon - Longitude (degrees)
     * @param {number} lat - Latitude (degrees)
     * @param {number|undefined} explicitHeightM - If set, use this ellipsoid height (m) instead of sampling the mesh.
     */
    async flyToLonLatPrecise(lon, lat, explicitHeightM) {
        this.tilesetViewer = window.tilesetViewer;
        const viewer = this.tilesetViewer && this.tilesetViewer.viewer;
        if (!viewer) {
            window.notification?.warning(
                window.appI18n?.nt ? window.appI18n.nt('viewerNotReady') : '3D viewer not ready'
            );
            return;
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            window.notification?.error(
                window.appI18n?.nt ? window.appI18n.nt('coordInvalid') : 'Invalid coordinates'
            );
            return;
        }
        if (lat < -90 || lat > 90) {
            window.notification?.error(
                window.appI18n?.nt ? window.appI18n.nt('coordLatRange') : 'Latitude must be between -90 and 90'
            );
            return;
        }
        if (lon < -180 || lon > 180) {
            window.notification?.error(
                window.appI18n?.nt ? window.appI18n.nt('coordLonRange') : 'Longitude must be between -180 and 180'
            );
            return;
        }

        const flyBtn = document.getElementById('flyToCoordinatesBtn');
        if (flyBtn) flyBtn.disabled = true;

        try {
            let surfacePos;
            let terrainH;
            if (Number.isFinite(explicitHeightM)) {
                surfacePos = Cesium.Cartesian3.fromDegrees(lon, lat, explicitHeightM);
                const carto = Cesium.Cartographic.fromCartesian(surfacePos);
                terrainH = carto.height;
            } else {
                surfacePos = await this._sampleSurfaceCartesianAsync(viewer, lon, lat);
                const carto = Cesium.Cartographic.fromCartesian(surfacePos);
                terrainH = carto.height;
            }

            const existing = viewer.entities.getById(this.FLY_PIN_ID);
            if (existing) viewer.entities.remove(existing);

            viewer.entities.add({
                id: this.FLY_PIN_ID,
                position: surfacePos,
                point: this._pointGraphicOptions(),
                label: this._labelGraphicOptions(this._ddMapLabel(lat, lon, terrainH))
            });

            const sphere = new Cesium.BoundingSphere(surfacePos, 3.0);
            const range = Math.min(900, Math.max(140, terrainH * 0.35 + 180));
            await viewer.camera.flyToBoundingSphere(sphere, {
                duration: 1.65,
                offset: new Cesium.HeadingPitchRange(
                    0,
                    Cesium.Math.toRadians(-38),
                    range
                )
            });

            const dp = this.DD_DISPLAY_PRECISION;
            const flyMsg = window.appI18n?.nt
                ? window.appI18n
                      .nt('coordFlyShowing')
                      .replace('{lat}', lat.toFixed(dp))
                      .replace('{lon}', lon.toFixed(dp))
                      .replace('{h}', terrainH.toFixed(1))
                : `Showing ${lat.toFixed(dp)}°, ${lon.toFixed(dp)}° (surface ~${terrainH.toFixed(1)} m)`;
            window.notification?.success(flyMsg);
        } catch (err) {
            console.error('flyToLonLatPrecise:', err);
            window.notification?.error(
                (window.appI18n?.nt ? window.appI18n.nt('coordFlyError') : 'Could not fly to coordinates: ') +
                    (err.message || err)
            );
        } finally {
            if (flyBtn) flyBtn.disabled = false;
        }

        viewer.scene.requestRender?.();
    }

    /**
     * Fly to coordinates
     */
    async flyToCoordinates() {
        this.tilesetViewer = window.tilesetViewer;
        if (!this.currentCoordinates || !this.tilesetViewer || !this.tilesetViewer.viewer) {
            window.notification?.warning(
                window.appI18n?.nt ? window.appI18n.nt('noCoordFly') : 'No coordinates to fly to'
            );
            return;
        }

        const { lat, lon } = this.currentCoordinates;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            window.notification?.error(
                window.appI18n?.nt ? window.appI18n.nt('coordInvalid') : 'Invalid coordinates'
            );
            return;
        }
        if (lat < -90 || lat > 90) {
            window.notification?.error(
                window.appI18n?.nt ? window.appI18n.nt('coordLatRange') : 'Latitude must be between -90 and 90'
            );
            return;
        }
        if (lon < -180 || lon > 180) {
            window.notification?.error(
                window.appI18n?.nt ? window.appI18n.nt('coordLonRange') : 'Longitude must be between -180 and 180'
            );
            return;
        }

        await this.flyToLonLatPrecise(lon, lat, undefined);
    }

    /**
     * Add marker at coordinates
     */
    async addMarker() {
        this.tilesetViewer = window.tilesetViewer;
        if (!this.currentCoordinates || !this.tilesetViewer || !this.tilesetViewer.viewer) {
            window.notification?.warning(
                window.appI18n?.nt ? window.appI18n.nt('noCoordMark') : 'No coordinates to mark'
            );
            return;
        }

        const { lat, lon } = this.currentCoordinates;
        const viewer = this.tilesetViewer.viewer;
        const surfacePos = await this._sampleSurfaceCartesianAsync(viewer, lon, lat);
        const carto = Cesium.Cartographic.fromCartesian(surfacePos);
        const id = `coord_user_marker_${Date.now()}`;
        this._userMarkers.push(id);

        viewer.entities.add({
            id,
            position: surfacePos,
            point: this._pointGraphicOptions(),
            label: this._labelGraphicOptions(this._ddMapLabel(lat, lon, carto.height))
        });

        window.notification?.success(
            window.appI18n?.nt ? window.appI18n.nt('markerOnSurface') : 'Marker placed on the 3D surface'
        );
        viewer.scene.requestRender?.();
    }

    /**
     * Copy to clipboard
     */
    async copyToClipboard(type) {
        if (!this.currentResult) {
            window.notification?.warning(
                window.appI18n?.nt ? window.appI18n.nt('nothingToCopy') : 'No coordinates to copy'
            );
            return;
        }

        const dp = this.DD_DISPLAY_PRECISION;
        const stripDeg = (s) => (s || '').replace(/\s*°\s*$/, '').trim();
        let text = '';
        switch (type) {
            case 'dd-lat':
                text =
                    stripDeg(document.getElementById('outputDDLat')?.textContent) ||
                    this.currentResult.dd.lat.toFixed(dp);
                break;
            case 'dd-lon':
                text =
                    stripDeg(document.getElementById('outputDDLon')?.textContent) ||
                    this.currentResult.dd.lon.toFixed(dp);
                break;
            case 'dd-both':
                text =
                    document.getElementById('outputDDLatLon')?.textContent?.trim() ||
                    `${this.currentResult.dd.lat.toFixed(dp)}, ${this.currentResult.dd.lon.toFixed(dp)}`;
                break;
            case 'dmm-lat':
                text = this.currentResult.dmm.formatted.split(',')[0].trim();
                break;
            case 'dmm-lon':
                text = this.currentResult.dmm.formatted.split(',')[1].trim();
                break;
            case 'dms-lat':
                text = this.currentResult.dms.formatted.split(',')[0].trim();
                break;
            case 'dms-lon':
                text = this.currentResult.dms.formatted.split(',')[1].trim();
                break;
            case 'utm-easting':
                text = this.currentResult.utm.easting.toFixed(3);
                break;
            case 'utm-northing':
                text = this.currentResult.utm.northing.toFixed(3);
                break;
            case 'mgrs':
                text = this.currentResult.mgrs.value || '';
                break;
        }

        if (text) {
            try {
                await navigator.clipboard.writeText(text);
                window.notification?.success(
                    window.appI18n?.nt ? window.appI18n.nt('copiedClipboard') : 'Copied to clipboard'
                );
            } catch (err) {
                window.notification?.error(
                    window.appI18n?.nt ? window.appI18n.nt('copyFailed') : 'Failed to copy'
                );
            }
        }
    }

    /**
     * Show panel
     */
    show() {
        if (!this.modal) {
            console.warn('CoordinateResearchManager: Modal not created, recreating...');
            this.createModal();
            this.setupEventHandlers();
        }
        
        if (this.modal) {
            this.modal.classList.add('visible');
            // Adjust Cesium viewer container to account for panel
            this.adjustViewerLayout(true);
            console.log('CoordinateResearchManager: Modal shown');
        } else {
            console.error('CoordinateResearchManager: Failed to create modal');
            if (window.notification) {
                window.notification.error(
                    window.appI18n?.nt ? window.appI18n.nt('coordPanelFailed') : 'Failed to show Coordinate Research panel'
                );
            }
        }
    }

    /**
     * Hide panel
     */
    hide() {
        if (this.modal) {
            this.modal.classList.remove('visible');
            // Restore Cesium viewer container
            this.adjustViewerLayout(false);
        }
    }

    /**
     * Toggle panel
     */
    toggle() {
        if (this.modal) {
            if (this.modal.classList.contains('visible')) {
                this.hide();
            } else {
                this.show();
            }
        }
    }

    /**
     * Adjust viewer layout when panel is shown/hidden
     */
    adjustViewerLayout(panelVisible) {
        // Use setTimeout to ensure DOM has updated
        setTimeout(() => {
            const cesiumContainer = document.getElementById('cesiumContainer');
            if (!cesiumContainer) return;

            if (panelVisible && this.modal) {
                // Add margin-right to viewer to prevent overlap
                const panelWidth = this.modal.offsetWidth || 500;
                cesiumContainer.style.marginRight = `${panelWidth}px`;
                cesiumContainer.style.transition = 'margin-right 0.3s ease';
            } else {
                // Remove margin when panel is hidden
                cesiumContainer.style.marginRight = '0';
            }
        }, 50);
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.coordinateResearchManager = new CoordinateResearchManager();
}
