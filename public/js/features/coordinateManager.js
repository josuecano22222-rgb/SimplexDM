/**
 * CoordinateManager
 * Enhanced coordinate display and management (Meridian Design - Page 8)
 * Handles ITM, GEO coordinate display, copying, and coordinate conversion
 */

/** Format lengths in meters for status UI (shared with app fallback). */
function simplexFormatDistanceMeters(m) {
    if (!Number.isFinite(m)) return '—';
    const a = Math.abs(m);
    if (a >= 1e9) return `${(m / 1e9).toFixed(3)} Gm`;
    if (a >= 1e6) return `${(m / 1e6).toFixed(3)} Mm`;
    if (a >= 1e3) return `${(m / 1000).toFixed(2)} km`;
    return `${m.toFixed(1)} m`;
}
if (typeof window !== 'undefined') {
    window.simplexFormatDistanceMeters = simplexFormatDistanceMeters;
}

class CoordinateManager {
    constructor() {
        this.tilesetViewer = null;
        this.isFlyAroundActive = false;
        this.flyAroundHandler = null;
        /** Escape stops automatic orbit (capture phase so it always reaches). */
        this._flyAroundEscapeListener = null;
        this.coordinateDisplay = null;
        this._lastMousePosition = null;
        this._mouseMoveListener = null;
        this._postRenderListener = null;
        this.currentCoordinates = {
            lon: null,
            lat: null,
            height: null,
            itm: { east: null, north: null, height: null },
            geo: { lon: null, lat: null, height: null }
        };
        this.init();
    }

    /**
     * Initialize coordinate manager
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.setupCoordinateDisplay();
        this.setupMouseTracking();
        this.setupRightClickCopy();
        this.setupFlyAround();
    }

    /**
     * Setup coordinate display in status bar
     */
    setupCoordinateDisplay() {
        // Coordinate display is already in status bar
        // We'll enhance it to show ITM and GEO formats
    }

    /**
     * Setup mouse coordinate tracking
     * Enhanced with better error handling and performance optimization
     */
    setupMouseTracking() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) {
            // Retry after a delay if viewer not ready
            setTimeout(() => this.setupMouseTracking(), 500);
            return;
        }

        const viewer = this.tilesetViewer.viewer;
        const canvas = viewer.scene.canvas;

        // Track mouse position and mark dirty (throttled ~20 Hz to eliminate idle GPU pickPosition reads)
        this._mouseDirty = false;
        this._lastPickMs = 0;
        this._coordDisplayMode = this._coordDisplayMode || 'WGS84';
        this._mouseMoveListener = (event) => {
            const pos =
                typeof window.cesiumPointerToCanvasPixels === 'function'
                    ? window.cesiumPointerToCanvasPixels(canvas, event.clientX, event.clientY)
                    : null;
            if (!pos) return;
            if (pos.x < 0 || pos.y < 0 || pos.x > canvas.clientWidth || pos.y > canvas.clientHeight) return;
            this._lastMousePosition = pos;
            this._mouseDirty = true;
            viewer.scene?.requestRender?.();
        };
        canvas.addEventListener('mousemove', this._mouseMoveListener, { passive: true });

        // Click status-bar CRS badge to cycle coordinate system (WGS84 -> UTM -> DMS -> EPSG:3857 -> ITM)
        const coordsEl = document.getElementById('mouseCoordinates');
        if (coordsEl && !coordsEl.dataset.crsCycleBound) {
            coordsEl.dataset.crsCycleBound = '1';
            coordsEl.addEventListener('click', (e) => {
                if (e.target.closest('[data-cycle-crs]')) {
                    this.cycleDisplayFormat();
                } else if (e.target.closest('[data-copy-coords]')) {
                    this.copyCurrentCoordinates();
                }
            });
        }

        // Bind coordinate update to scene.postRender (runs only when cursor moved >= 50 ms ago)
        if (!this._postRenderListener) {
            this._postRenderListener = () => {
                if (!this._lastMousePosition || !this._mouseDirty) return;
                const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                if (now - this._lastPickMs < 50) return;
                this._lastPickMs = now;
                this._mouseDirty = false;

                const scene = viewer.scene;
                const camera = viewer.camera;
                let cartesian = null;
                let picked3D = false;

                const has3DTiles = (this.tilesetViewer?.tilesets?.size || 0) > 0;
                const hasTerrain = !(viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);

                if ((has3DTiles || hasTerrain) && scene.pickPositionSupported) {
                    try {
                        cartesian = scene.pickPosition(this._lastMousePosition);
                        if (cartesian) picked3D = true;
                    } catch (_) {
                        cartesian = null;
                    }
                }
                if (!cartesian) {
                    cartesian = camera.pickEllipsoid(this._lastMousePosition, scene.globe.ellipsoid);
                }
                if (!cartesian) return;

                const carto = Cesium.Cartographic.fromCartesian(cartesian);
                const lon = Cesium.Math.toDegrees(carto.longitude);
                const lat = Cesium.Math.toDegrees(carto.latitude);
                const elev = picked3D ? (carto.height || 0.0) : 0.0;
                const camAlt = camera.positionCartographic?.height ?? 0.0;

                if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
                this.currentCoordinates.cameraAlt = camAlt;
                this.updateCoordinates(lon, lat, elev);
            };
            viewer.scene.postRender.addEventListener(this._postRenderListener);
        }
    }

    /**
     * Update coordinates (both GEO and ITM)
     */
    updateCoordinates(lon, lat, height) {
        this.currentCoordinates.lon = lon;
        this.currentCoordinates.lat = lat;
        this.currentCoordinates.height = height;

        // Convert to display CRS (project-defined) using main-process CRS service when available.
        // Fallback keeps the old ITM approximation for legacy workflows.
        this.updateDerivedCrs(lon, lat, height);

        // GEO & high-precision UTM / DMS / Web Mercator
        this.currentCoordinates.geo = { lon, lat, height };
        this.currentCoordinates.utm = CoordinateManager.wgs84ToUtm(lon, lat);
        this.currentCoordinates.dms = CoordinateManager.toDms(lon, lat);
        this.currentCoordinates.mercator = CoordinateManager.wgs84ToWebMercator(lon, lat);

        // Update display
        this.updateCoordinateDisplay();
    }

    /**
     * Exact Snyder/Redfearn WGS84 -> UTM conversion (sub-millimeter precision, zones 1–60,
     * including standard Norway 32V and Svalbard 31X/33X/35X/37X zone exceptions).
     */
    static wgs84ToUtm(lonDeg, latDeg) {
        const lon = Number(lonDeg);
        const lat = Number(latDeg);
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -80 || lat > 84) {
            return null;
        }
        const a = 6378137.0;
        const f = 1 / 298.257223563;
        const k0 = 0.9996;
        const e2 = f * (2 - f);
        const ep2 = e2 / (1 - e2);

        const normLon = ((lon + 180) % 360 + 360) % 360 - 180;
        let zone = Math.floor((normLon + 180) / 6) + 1;
        if (lat >= 56 && lat < 64 && normLon >= 3 && normLon < 12) {
            zone = 32;
        } else if (lat >= 72 && lat < 84) {
            if (normLon >= 0 && normLon < 9) zone = 31;
            else if (normLon >= 9 && normLon < 21) zone = 33;
            else if (normLon >= 21 && normLon < 33) zone = 35;
            else if (normLon >= 33 && normLon < 42) zone = 37;
        }

        const bands = 'CDEFGHJKLMNPQRSTUVWXX';
        const bandIdx = Math.max(0, Math.min(bands.length - 1, Math.floor((lat + 80) / 8)));
        const band = bands[bandIdx];
        const hemisphere = lat >= 0 ? 'N' : 'S';

        const deg2rad = Math.PI / 180;
        const phi = lat * deg2rad;
        const lam = normLon * deg2rad;
        const lam0 = ((zone - 1) * 6 - 180 + 3) * deg2rad;

        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);
        const tanPhi = Math.tan(phi);

        const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
        const T = tanPhi * tanPhi;
        const C = ep2 * cosPhi * cosPhi;
        const A = cosPhi * (lam - lam0);

        const e4 = e2 * e2;
        const e6 = e4 * e2;
        const M =
            a *
            ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
                ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
                ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
                ((35 * e6) / 3072) * Math.sin(6 * phi));

        const A2 = A * A;
        const A3 = A2 * A;
        const A4 = A2 * A2;
        const A5 = A4 * A;
        const A6 = A3 * A3;

        const easting =
            k0 *
                N *
                (A +
                    ((1 - T + C) * A3) / 6 +
                    ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5) / 120) +
            500000.0;

        let northing =
            k0 *
            (M +
                N *
                    tanPhi *
                    (A2 / 2 +
                        ((5 - T + 9 * C + 4 * C * C) * A4) / 24 +
                        ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6) / 720));
        if (lat < 0) northing += 10000000.0;

        const epsg = `EPSG:${(hemisphere === 'N' ? 32600 : 32700) + zone}`;
        return {
            zone,
            band,
            hemisphere,
            easting: Number(easting.toFixed(2)),
            northing: Number(northing.toFixed(2)),
            epsg,
            formatted: `${zone}${band} ${Math.round(easting)}E ${Math.round(northing)}N`,
        };
    }

    /**
     * Inverse UTM -> WGS84 (longitude, latitude in degrees).
     */
    static utmToWgs84(zone, hemisphereOrBand, easting, northing) {
        const z = Number(zone);
        const E = Number(easting);
        const N0 = Number(northing);
        if (!Number.isInteger(z) || z < 1 || z > 60 || !Number.isFinite(E) || !Number.isFinite(N0)) {
            return null;
        }
        const hb = String(hemisphereOrBand || 'N').trim().toUpperCase();
        const isSouth = hb === 'S' || (hb.length === 1 && hb >= 'C' && hb < 'N');

        const a = 6378137.0;
        const f = 1 / 298.257223563;
        const k0 = 0.9996;
        const e2 = f * (2 - f);
        const ep2 = e2 / (1 - e2);
        const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

        const x = E - 500000.0;
        const y = isSouth ? N0 - 10000000.0 : N0;
        const M = y / k0;
        const e4 = e2 * e2;
        const e6 = e4 * e2;
        const mu = M / (a * (1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));

        const e1_2 = e1 * e1;
        const e1_3 = e1_2 * e1;
        const e1_4 = e1_2 * e1_2;
        const phi1 =
            mu +
            ((3 * e1) / 2 - (27 * e1_3) / 32) * Math.sin(2 * mu) +
            ((21 * e1_2) / 16 - (55 * e1_4) / 32) * Math.sin(4 * mu) +
            ((151 * e1_3) / 96) * Math.sin(6 * mu) +
            ((1097 * e1_4) / 512) * Math.sin(8 * mu);

        const sin1 = Math.sin(phi1);
        const cos1 = Math.cos(phi1);
        const tan1 = Math.tan(phi1);
        const N1 = a / Math.sqrt(1 - e2 * sin1 * sin1);
        const T1 = tan1 * tan1;
        const C1 = ep2 * cos1 * cos1;
        const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sin1 * sin1, 1.5);
        const D = x / (N1 * k0);
        const D2 = D * D;
        const D4 = D2 * D2;

        const latRad =
            phi1 -
            ((N1 * tan1) / R1) *
                (D2 / 2 -
                    ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D4) / 24 +
                    ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) *
                        D4 *
                        D2) /
                        720);
        const lon0 = (((z - 1) * 6 - 180 + 3) * Math.PI) / 180;
        const lonRad =
            lon0 +
            (D -
                ((1 + 2 * T1 + C1) * D2 * D) / 6 +
                ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D4 * D) / 120) /
                cos1;

        const rad2deg = 180 / Math.PI;
        return {
            lon: Number((lonRad * rad2deg).toFixed(7)),
            lat: Number((latRad * rad2deg).toFixed(7)),
        };
    }

    /**
     * Format WGS84 degrees as Degrees-Minutes-Seconds (DMS).
     */
    static toDms(lonDeg, latDeg) {
        const fmt = (deg, posH, negH) => {
            const h = deg >= 0 ? posH : negH;
            const abs = Math.abs(Number(deg) || 0);
            const d = Math.floor(abs);
            const mFull = (abs - d) * 60;
            const m = Math.floor(mFull);
            const s = ((mFull - m) * 60).toFixed(2);
            return `${d}°${String(m).padStart(2, '0')}′${String(s).padStart(5, '0')}″${h}`;
        };
        const latStr = fmt(latDeg, 'N', 'S');
        const lonStr = fmt(lonDeg, 'E', 'W');
        return { lat: latStr, lon: lonStr, formatted: `${latStr} ${lonStr}` };
    }

    /**
     * Web Mercator (EPSG:3857) projection in meters.
     */
    static wgs84ToWebMercator(lonDeg, latDeg) {
        const R = 6378137.0;
        const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, Number(latDeg) || 0));
        const x = (R * (Number(lonDeg) || 0) * Math.PI) / 180;
        const y = R * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360));
        return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
    }

    cycleDisplayFormat() {
        const order = ['WGS84', 'UTM', 'DMS', 'EPSG:3857', 'ITM'];
        const cur = order.indexOf(this._coordDisplayMode || 'WGS84');
        this._coordDisplayMode = order[(cur + 1) % order.length];
        this.updateCoordinateDisplay();
        return this._coordDisplayMode;
    }

    copyCurrentCoordinates() {
        const { lon, lat, height, utm, dms } = this.currentCoordinates;
        if (lon === null || lat === null) return false;
        let text = `${lat.toFixed(6)}, ${lon.toFixed(6)}, ${(height || 0).toFixed(2)}m`;
        if (this._coordDisplayMode === 'UTM' && utm) {
            text = `${utm.zone}${utm.band} ${utm.easting.toFixed(2)}E ${utm.northing.toFixed(2)}N`;
        } else if (this._coordDisplayMode === 'DMS' && dms) {
            text = dms.formatted;
        }
        navigator?.clipboard?.writeText?.(text)?.then(() => {
            window.notification?.success?.(`Copied: ${text}`);
        }).catch(() => {});
        return text;
    }

    /**
     * Update derived CRS values (async safe).
     */
    async updateDerivedCrs(lon, lat, height) {
        const displayCrs = window.projectManager?.metadata?.displayCrs || 'EPSG:4326';
        if (displayCrs && displayCrs.toUpperCase() !== 'EPSG:4326' && window.electronAPI?.gis?.crs?.transform) {
            try {
                const res = await window.electronAPI.gis.crs.transform({
                    from: 'EPSG:4326',
                    to: displayCrs,
                    coords: [lon, lat]
                });
                const [x, y] = res.coords || [];
                this.currentCoordinates.itm = { east: x, north: y, height };
                this.currentCoordinates.displayCrs = displayCrs;
                this.updateCoordinateDisplay();
                return;
            } catch (e) {
                // fall through to legacy
            }
        }
        const itm = this.convertToITM(lon, lat, height);
        this.currentCoordinates.itm = itm;
        this.currentCoordinates.displayCrs = 'ITM(approx)';
    }

    /**
     * Convert WGS84 to ITM (Israel Transverse Mercator)
     * Simplified conversion - for production, use proper projection library
     */
    convertToITM(lon, lat, height) {
        // ITM projection parameters for Israel
        // This is a simplified conversion - for accurate results, use proj4js or similar
        const lon0 = 35.2045169444444; // Central meridian
        const lat0 = 31.7343936111111; // Central parallel
        const k0 = 1.0000067; // Scale factor
        const a = 6378137.0; // WGS84 semi-major axis
        const e2 = 0.00669438002290; // WGS84 first eccentricity squared

        // Convert degrees to radians
        const lonRad = lon * Math.PI / 180;
        const latRad = lat * Math.PI / 180;
        const lon0Rad = lon0 * Math.PI / 180;
        const lat0Rad = lat0 * Math.PI / 180;

        // Simplified ITM conversion (approximate)
        // For production, implement full ITM projection formulas
        const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad));
        const t = Math.tan(latRad);
        const c = e2 * Math.cos(latRad) * Math.cos(latRad) / (1 - e2);
        const A = Math.cos(latRad) * (lonRad - lon0Rad);

        const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * latRad
            - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * latRad)
            + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * latRad)
            - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * latRad));

        const M0 = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * lat0Rad
            - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * lat0Rad)
            + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * lat0Rad)
            - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * lat0Rad));

        const east = k0 * N * (A + (1 - t * t + c) * A * A * A / 6 + (5 - 18 * t * t + t * t * t * t + 72 * c - 58) * A * A * A * A * A / 120) + 500000;
        const north = k0 * (M - M0 + N * t * (A * A / 2 + (5 - t * t + 9 * c + 4 * c * c) * A * A * A * A / 24 + (61 - 58 * t * t + t * t * t * t + 600 * c - 330) * A * A * A * A * A * A / 720));

        return {
            east: east,
            north: north,
            height: height
        };
    }

    /**
     * Update coordinate display in status bar
     */
    updateCoordinateDisplay() {
        const coords = document.getElementById('mouseCoordinates');
        if (!coords) return;

        const { lon, lat, height } = this.currentCoordinates;

        if (lon !== null && lat !== null) {
            coords.classList.remove('status-coords-empty');
            const latAbs = Math.abs(lat);
            const lonAbs = Math.abs(lon);
            const latDir = lat >= 0 ? 'N' : 'S';
            const lonDir = lon >= 0 ? 'E' : 'W';
            const viewer = window.tilesetViewer?.viewer;
            const ellipsoidTerrain =
                viewer && viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider;
            const surfaceTitle = ellipsoidTerrain
                ? 'No terrain DEM: height is along the ellipsoid normal (often 0 m on the ellipsoid)'
                : 'Height of the picked surface point above the WGS84 ellipsoid (terrain / 3D tiles)';
            const camAlt = this.currentCoordinates.cameraAlt;
            const camTitle =
                'Camera altitude above the WGS84 ellipsoid. Large values mean the view is far from Earth (zoomed out).';

            const utm = this.currentCoordinates.utm || CoordinateManager.wgs84ToUtm(lon, lat);
            const dms = this.currentCoordinates.dms || CoordinateManager.toDms(lon, lat);
            const merc = this.currentCoordinates.mercator || CoordinateManager.wgs84ToWebMercator(lon, lat);
            const mode = this._coordDisplayMode || 'WGS84';

            let primaryRows =
                `<span class="status-coord-dt">Latitude</span>` +
                `<span class="status-coord-dd" title="Geodetic latitude (°)">${latAbs.toFixed(5)}° ${latDir}</span>` +
                `<span class="status-coord-dt">Longitude</span>` +
                `<span class="status-coord-dd" title="Geodetic longitude (°)">${lonAbs.toFixed(5)}° ${lonDir}</span>`;

            if (mode === 'UTM' && utm) {
                primaryRows =
                    `<span class="status-coord-dt">Zone ${utm.zone}${utm.band}</span>` +
                    `<span class="status-coord-dd">${utm.epsg}</span>` +
                    `<span class="status-coord-dt">E / N</span>` +
                    `<span class="status-coord-dd">${utm.easting.toFixed(1)} · ${utm.northing.toFixed(1)}</span>`;
            } else if (mode === 'DMS' && dms) {
                primaryRows =
                    `<span class="status-coord-dt">Lat DMS</span>` +
                    `<span class="status-coord-dd">${dms.lat}</span>` +
                    `<span class="status-coord-dt">Lon DMS</span>` +
                    `<span class="status-coord-dd">${dms.lon}</span>`;
            } else if (mode === 'EPSG:3857' && merc) {
                primaryRows =
                    `<span class="status-coord-dt">X (m)</span>` +
                    `<span class="status-coord-dd">${merc.x.toFixed(1)}</span>` +
                    `<span class="status-coord-dt">Y (m)</span>` +
                    `<span class="status-coord-dd">${merc.y.toFixed(1)}</span>`;
            }

            const grid =
                `<div class="status-coord-head">` +
                `<button type="button" class="status-crs-badge" data-cycle-crs="1" title="Click to switch coordinate system (WGS84 / UTM / DMS / EPSG:3857 / ITM)">${mode}</button>` +
                `<span class="status-coord-head-hint">${utm ? `UTM ${utm.zone}${utm.band}` : 'ellipsoid'}</span>` +
                `</div>` +
                `<div class="status-coord-grid" role="group" aria-label="Cursor coordinates" data-copy-coords="1" title="Click coordinates to copy">` +
                primaryRows +
                `<span class="status-coord-dt">Surface</span>` +
                `<span class="status-coord-dd" title="${surfaceTitle}">${simplexFormatDistanceMeters(height)}</span>` +
                `<span class="status-coord-dt">Camera Δh</span>` +
                `<span class="status-coord-dd" title="${camTitle}">${simplexFormatDistanceMeters(camAlt)}</span>` +
                `</div>`;

            const itm = this.currentCoordinates.itm;
            const crsRaw = mode === 'ITM' ? 'EPSG:2039' : window.simplexProjectCRS;
            const localLine =
                mode === 'WGS84' && utm
                    ? `<div class="status-coord-local" title="WGS84 UTM Easting / Northing">` +
                      `<span class="status-coord-local-label">UTM ${utm.zone}${utm.band}</span>` +
                      `<span class="status-coord-local-val">E ${Math.round(utm.easting)} · N ${Math.round(utm.northing)} m</span>` +
                      `</div>`
                    : crsRaw && itm && Number.isFinite(itm.east) && Number.isFinite(itm.north)
                      ? `<div class="status-coord-local" title="Project CRS easting / northing">` +
                        `<span class="status-coord-local-label">${String(crsRaw).replace(/[<>&]/g, '')}</span>` +
                        `<span class="status-coord-local-val">E ${itm.east.toFixed(2)} m · N ${itm.north.toFixed(2)} m</span>` +
                        `</div>`
                      : '';

            coords.innerHTML = `<div class="status-coord-block">${grid}${localLine}</div>`;
            coords.removeAttribute('title');
        } else {
            coords.classList.add('status-coords-empty');
            coords.textContent = '—';
            coords.title = 'Move the cursor over the globe to see coordinates';
        }
    }

    /**
     * Setup right-click to copy coordinates
     * Uses accurate 3D picking from tileset geometry, not just ellipsoid
     */
    setupRightClickCopy() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const canvas = viewer.scene.canvas;

        // Handle right-click on canvas
        canvas.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            
            const screenPosition =
                typeof window.cesiumPointerToCanvasPixels === 'function'
                    ? window.cesiumPointerToCanvasPixels(canvas, event.clientX, event.clientY)
                    : new Cesium.Cartesian2(
                          event.clientX - canvas.getBoundingClientRect().left,
                          event.clientY - canvas.getBoundingClientRect().top
                      );
            if (!screenPosition) return;
            
            // Use accurate 3D picking utility (picks from tileset geometry, not just ellipsoid)
            let cartesian = null;
            if (window.featurePickingUtils && typeof window.featurePickingUtils.pick3DPosition === 'function') {
                cartesian = window.featurePickingUtils.pick3DPosition(viewer, screenPosition);
            } else {
                // Fallback: try pickPosition first (for 3D tileset geometry)
                cartesian = viewer.scene.pickPosition(screenPosition);
                
                // If no 3D geometry, fallback to ellipsoid (terrain/ground)
                if (!cartesian) {
                    cartesian = viewer.camera.pickEllipsoid(screenPosition, viewer.scene.globe.ellipsoid);
                }
            }
            
            if (cartesian) {
                const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                const lon = Cesium.Math.toDegrees(cartographic.longitude);
                const lat = Cesium.Math.toDegrees(cartographic.latitude);
                const height = cartographic.height;

                // Validate coordinates
                if (!isNaN(lon) && !isNaN(lat) && !isNaN(height) &&
                    isFinite(lon) && isFinite(lat) && isFinite(height)) {
                    
                    const itm = this.convertToITM(lon, lat, height);
                    
                    // Show coordinate copy menu at mouse position
                    this.showCoordinateCopyMenu(
                        { x: event.clientX, y: event.clientY },
                        lon, lat, height, itm
                    );
                } else {
                    console.warn('Invalid coordinates:', { lon, lat, height });
                }
            } else {
                // Show error notification if coordinates couldn't be picked
                if (window.notification) {
                    window.notification.warning(
                        window.appI18n?.nt ? window.appI18n.nt('coordIndeterminate') : 'Could not determine coordinates at this location'
                    );
                }
            }
        });
    }

    /**
     * Show coordinate copy menu (Matching Image Design)
     */
    showCoordinateCopyMenu(screenPosition, lon, lat, height, itm) {
        // Remove existing menu if any
        const existingMenu = document.getElementById('coordinateCopyMenu');
        if (existingMenu) {
            existingMenu.remove();
        }

        // Validate inputs
        if (lon === null || lat === null || isNaN(lon) || isNaN(lat)) {
            console.error('Invalid coordinates provided to menu:', { lon, lat, height });
            if (window.notification) {
                window.notification.error(window.appI18n?.nt ? window.appI18n.nt('coordInvalid') : 'Invalid coordinates');
            }
            return;
        }

        // Convert to XYZ (simplified - for production use proper conversion)
        const xyz = this.convertToXYZ(lon, lat, height);
        
        // Decimal degrees lat, lon (10 places) for pasting into external tools
        const latLonDecimal = `${lat.toFixed(12)}, ${lon.toFixed(12)}`;

        // Create menu matching image design
        const menu = document.createElement('div');
        menu.id = 'coordinateCopyMenu';
        menu.className = 'coordinate-popup-menu';
        menu.setAttribute('role', 'menu');
        menu.style.position = 'fixed';
        
        // Calculate position to keep menu on screen
        const menuWidth = 320; // align with CSS min/max width
        const menuHeight = 260; // approximate height
        let left = screenPosition.x;
        let top = screenPosition.y;
        
        // Adjust if menu would go off right edge
        if (left + menuWidth > window.innerWidth) {
            left = window.innerWidth - menuWidth - 10;
        }
        
        // Adjust if menu would go off bottom edge
        if (top + menuHeight > window.innerHeight) {
            top = window.innerHeight - menuHeight - 10;
        }
        
        // Ensure menu doesn't go off left or top edges
        left = Math.max(10, left);
        top = Math.max(10, top);
        
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.style.zIndex = window.simplexUILayer
            ? window.simplexUILayer.zIndex('CONTEXT_POPUP')
            : '10000';

        menu.innerHTML = `
            <div class="coordinate-popup-item coordinate-popup-latlon" data-copy="${latLonDecimal.replace(/"/g, '&quot;')}" role="menuitem">
                <svg class="coordinate-popup-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
                <span>Copy lat, lon (decimal)</span>
            </div>
            <div class="coordinate-popup-body">
                <div class="coordinate-popup-item coordinate-popup-format" role="menuitem">
                    <span class="coordinate-popup-label">ITM</span>
                    <span class="coordinate-popup-value">${itm.east.toFixed(3)}, ${itm.north.toFixed(2)}, ${height.toFixed(2)} m</span>
                </div>
                <div class="coordinate-popup-item coordinate-popup-format" role="menuitem">
                    <span class="coordinate-popup-label">GPS</span>
                    <span class="coordinate-popup-value">${lat.toFixed(12)}, ${lon.toFixed(12)}, ${height.toFixed(2)} m</span>
                </div>
                <div class="coordinate-popup-item coordinate-popup-format" role="menuitem">
                    <span class="coordinate-popup-label">XYZ</span>
                    <span class="coordinate-popup-value">${xyz.x.toFixed(2)}, ${xyz.y.toFixed(3)}, ${xyz.z.toFixed(3)}</span>
                </div>
            </div>
            <div class="coordinate-popup-item coordinate-popup-action" data-action="flyAround" role="menuitem">
                <svg class="coordinate-popup-icon" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path d="M10 2l-2 6h4l-2 6M2 10h16"/>
                </svg>
                <span>Fly Around</span>
            </div>
        `;

        document.body.appendChild(menu);

        // Add click handlers
        menu.querySelectorAll('.coordinate-popup-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent event bubbling
                
                const action = item.dataset.action;
                const copyValue = item.dataset.copy;
                
                console.log('Menu item clicked:', { action, copyValue, item });
                
                if (action === 'flyAround') {
                    if (window.viewControls && typeof window.viewControls.flyAround === 'function') {
                        window.viewControls.flyAround();
                    }
                    menu.remove();
                } else if (copyValue) {
                    console.log('Copying lat, lon (decimal):', copyValue);
                    this.copyToClipboard(copyValue);
                    menu.remove();
                    
                    if (window.notification) {
                        window.notification.success(
                            window.appI18n?.nt ? window.appI18n.nt('copiedLatLonDecimal') : 'Copied lat, lon (decimal degrees).'
                        );
                    }
                } else {
                    // Other formats - copy from displayed value
                    const valueElement = item.querySelector('.coordinate-popup-value');
                    if (valueElement) {
                        const value = valueElement.textContent;
                        console.log('Copying coordinate value:', value);
                        this.copyToClipboard(value);
                        menu.remove();
                        
                        if (window.notification) {
                            window.notification.success(
                                window.appI18n?.nt ? window.appI18n.nt('copiedCoords') : 'Coordinates copied'
                            );
                        }
                    } else {
                        console.warn('No value element found in menu item');
                    }
                }
            });
        });

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 0);
    }

    /**
     * Convert to XYZ coordinates (simplified)
     */
    convertToXYZ(lon, lat, height) {
        // Simplified conversion - for production use proper geodetic to ECEF conversion
        const a = 6378137.0; // WGS84 semi-major axis
        const e2 = 0.00669438002290; // WGS84 first eccentricity squared
        
        const lonRad = lon * Math.PI / 180;
        const latRad = lat * Math.PI / 180;
        
        const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad));
        const x = (N + height) * Math.cos(latRad) * Math.cos(lonRad);
        const y = (N + height) * Math.cos(latRad) * Math.sin(lonRad);
        const z = (N * (1 - e2) + height) * Math.sin(latRad);
        
        return { x, y, z };
    }

    /**
     * Convert XYZ (ECEF) coordinates to GEO (WGS84 lat/lon/height)
     * Uses Cesium's built-in conversion if available, otherwise manual calculation
     */
    convertXYZToGEO(x, y, z) {
        // Use Cesium's conversion if available (most accurate)
        if (typeof Cesium !== 'undefined') {
            try {
                const cartesian = new Cesium.Cartesian3(x, y, z);
                const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                return {
                    lon: Cesium.Math.toDegrees(cartographic.longitude),
                    lat: Cesium.Math.toDegrees(cartographic.latitude),
                    height: cartographic.height
                };
            } catch (error) {
                console.warn('Cesium conversion failed, using manual calculation:', error);
            }
        }

        // Manual ECEF to geodetic conversion (Bowring's method)
        const a = 6378137.0; // WGS84 semi-major axis
        const e2 = 0.00669438002290; // WGS84 first eccentricity squared
        const f = 1 / 298.257223563; // WGS84 flattening
        const b = a * (1 - f); // Semi-minor axis

        const p = Math.sqrt(x * x + y * y);
        const lon = Math.atan2(y, x);

        // Initial latitude estimate
        let lat = Math.atan2(z, p * (1 - e2));
        let prevLat = lat;
        let iterations = 0;
        const maxIterations = 10;
        const tolerance = 1e-12;

        // Iterative calculation for latitude
        do {
            const sinLat = Math.sin(lat);
            const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
            const height = p / Math.cos(lat) - N;
            prevLat = lat;
            lat = Math.atan2(z, p * (1 - e2 * N / (N + height)));
            iterations++;
        } while (Math.abs(lat - prevLat) > tolerance && iterations < maxIterations);

        // Calculate final height
        const sinLat = Math.sin(lat);
        const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
        const height = p / Math.cos(lat) - N;

        return {
            lon: lon * 180 / Math.PI,
            lat: lat * 180 / Math.PI,
            height: height
        };
    }

    /**
     * Copy text to clipboard
     */
    async copyToClipboard(text) {
        if (!text || text.trim() === '') {
            console.error('Cannot copy empty text');
            if (window.notification) {
                window.notification.error(window.appI18n?.nt ? window.appI18n.nt('nothingToCopy') : 'Nothing to copy');
            }
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            console.log('Copied to clipboard:', text);
        } catch (err) {
            console.warn('Clipboard API failed, using fallback:', err);
            // Fallback for older browsers or when clipboard API is not available
            try {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.top = '-9999px';
                textArea.style.left = '-9999px';
                textArea.style.opacity = '0';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                
                if (!successful) {
                    throw new Error('execCommand copy failed');
                }
                console.log('Copied to clipboard (fallback):', text);
            } catch (fallbackErr) {
                console.error('Failed to copy to clipboard:', fallbackErr);
                if (window.notification) {
                    const p = window.appI18n?.nt ? window.appI18n.nt('copyCoordsManual') : 'Failed to copy coordinates. Please copy manually: ';
                    window.notification.error(p + text);
                }
            }
        }
    }

    /**
     * Setup Fly Around functionality
     */
    setupFlyAround() {
        // Fly Around toggle will be handled by viewControls
        // This sets up the continuous orbiting functionality
    }

    /**
     * Start Fly Around mode - continuous orbiting around center of screen
     */
    startFlyAround() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer || this.isFlyAroundActive) return;

        this.isFlyAroundActive = true;
        this._bindFlyAroundEscape();
        const viewer = this.tilesetViewer.viewer;
        const camera = viewer.camera;

        // Get center of screen
        const center = new Cesium.Cartesian2(
            viewer.canvas.clientWidth / 2,
            viewer.canvas.clientHeight / 2
        );

        // Get center point in 3D
        const centerCartesian = viewer.camera.pickEllipsoid(center, viewer.scene.globe.ellipsoid);
        if (!centerCartesian) {
            // If no intersection, use current camera target
            const currentPosition = camera.position;
            const cartographic = Cesium.Cartographic.fromCartesian(currentPosition);
            const centerLon = Cesium.Math.toDegrees(cartographic.longitude);
            const centerLat = Cesium.Math.toDegrees(cartographic.latitude);
            const centerHeight = cartographic.height;
            
            this.startOrbiting(centerLon, centerLat, centerHeight);
            return;
        }

        const centerCartographic = Cesium.Cartographic.fromCartesian(centerCartesian);
        const centerLongitude = Cesium.Math.toDegrees(centerCartographic.longitude);
        const centerLatitude = Cesium.Math.toDegrees(centerCartographic.latitude);
        const centerHeight = centerCartographic.height;

        this.startOrbiting(centerLongitude, centerLatitude, centerHeight);
    }

    /**
     * Start orbiting around a point
     */
    startOrbiting(centerLon, centerLat, centerHeight) {
        const viewer = this.tilesetViewer.viewer;
        const camera = viewer.camera;
        const centerCartesian = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, centerHeight);

        // Start orbiting around center
        let angle = 0;
        const radius = 1000; // meters
        const speed = 0.01; // radians per frame
        const altitude = centerHeight + 500;

        const animate = () => {
            if (!this.isFlyAroundActive) return;

            angle += speed;
            
            // Calculate new position orbiting around center
            const offsetLon = (radius * Math.cos(angle)) / 111320; // approximate meters to degrees
            const offsetLat = (radius * Math.sin(angle)) / 111320;

            const newLon = centerLon + offsetLon;
            const newLat = centerLat + offsetLat;

            const newPosition = Cesium.Cartesian3.fromDegrees(newLon, newLat, altitude);
            
            // Move camera (lookAt would be overwritten by setView; orientation below looks toward the area)
            camera.setView({
                destination: newPosition,
                orientation: {
                    heading: angle + Math.PI / 2,
                    pitch: -0.5,
                    roll: 0
                }
            });

            requestAnimationFrame(animate);
        };

        this.flyAroundHandler = animate;
        animate();
    }

    /**
     * Stop Fly Around mode
     */
    stopFlyAround() {
        this._unbindFlyAroundEscape();
        this.isFlyAroundActive = false;
        this.flyAroundHandler = null;
    }

    _bindFlyAroundEscape() {
        if (this._flyAroundEscapeListener) return;
        this._flyAroundEscapeListener = (e) => {
            if (!this.isFlyAroundActive) return;
            if (e.code !== 'Escape') return;
            e.preventDefault();
            this.stopFlyAround();
        };
        document.addEventListener('keydown', this._flyAroundEscapeListener, true);
    }

    _unbindFlyAroundEscape() {
        if (!this._flyAroundEscapeListener) return;
        document.removeEventListener('keydown', this._flyAroundEscapeListener, true);
        this._flyAroundEscapeListener = null;
    }

    /**
     * Toggle Fly Around
     */
    toggleFlyAround() {
        if (this.isFlyAroundActive) {
            this.stopFlyAround();
        } else {
            this.startFlyAround();
        }
        return this.isFlyAroundActive;
    }
}

if (typeof window !== 'undefined') {
    window.CoordinateManager = CoordinateManager;
    window.coordinateManager = new CoordinateManager();
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CoordinateManager };
}
