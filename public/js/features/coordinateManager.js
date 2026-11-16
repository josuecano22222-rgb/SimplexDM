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

        // Track mouse position only (coordinate computation happens in postRender)
        this._mouseMoveListener = (event) => {
            const pos =
                typeof window.cesiumPointerToCanvasPixels === 'function'
                    ? window.cesiumPointerToCanvasPixels(canvas, event.clientX, event.clientY)
                    : null;
            if (!pos) return;
            if (pos.x < 0 || pos.y < 0 || pos.x > canvas.clientWidth || pos.y > canvas.clientHeight) return;
            this._lastMousePosition = pos;
        };
        canvas.addEventListener('mousemove', this._mouseMoveListener, { passive: true });
        
        // Also handle mouse leave to clear coordinates
        canvas.addEventListener('mouseleave', () => {
            // Optionally clear coordinates when mouse leaves canvas
            // this.updateCoordinates(null, null, null);
        });

        // Bind coordinate update to scene.postRender for reliable per-frame updates
        if (!this._postRenderListener) {
            this._postRenderListener = () => {
                if (!this._lastMousePosition) return;
                const scene = viewer.scene;
                const camera = viewer.camera;

                let cartesian = null;

                const noTerrain = viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider;
                if (noTerrain) {
                    cartesian = camera.pickEllipsoid(this._lastMousePosition, scene.globe.ellipsoid);
                } else {
                    if (scene.pickPositionSupported) {
                        cartesian = scene.pickPosition(this._lastMousePosition);
                    }
                    if (!cartesian) {
                        cartesian = camera.pickEllipsoid(this._lastMousePosition, scene.globe.ellipsoid);
                    }
                }

                if (!cartesian) return;

                const carto = Cesium.Cartographic.fromCartesian(cartesian);
                const lon = Cesium.Math.toDegrees(carto.longitude);
                const lat = Cesium.Math.toDegrees(carto.latitude);
                const elev = noTerrain ? 0.0 : (carto.height || 0.0);
                const camAlt = camera.positionCartographic?.height ?? 0.0;

                if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
                this.updateCoordinates(lon, lat, elev);
                this.currentCoordinates.cameraAlt = camAlt;
                this.updateCoordinateDisplay();
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

        // GEO is same as lon/lat
        this.currentCoordinates.geo = { lon, lat, height };

        // Update display
        this.updateCoordinateDisplay();
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

            const grid =
                `<div class="status-coord-head">` +
                `<span class="status-crs-badge">WGS84</span>` +
                `<span class="status-coord-head-hint">ellipsoid</span>` +
                `</div>` +
                `<div class="status-coord-grid" role="group" aria-label="Cursor WGS84">` +
                `<span class="status-coord-dt">Latitude</span>` +
                `<span class="status-coord-dd" title="Geodetic latitude (°)">${latAbs.toFixed(5)}° ${latDir}</span>` +
                `<span class="status-coord-dt">Longitude</span>` +
                `<span class="status-coord-dd" title="Geodetic longitude (°)">${lonAbs.toFixed(5)}° ${lonDir}</span>` +
                `<span class="status-coord-dt">Surface</span>` +
                `<span class="status-coord-dd" title="${surfaceTitle}">${simplexFormatDistanceMeters(height)}</span>` +
                `<span class="status-coord-dt">Camera Δh</span>` +
                `<span class="status-coord-dd" title="${camTitle}">${simplexFormatDistanceMeters(camAlt)}</span>` +
                `</div>`;

            const itm = this.currentCoordinates.itm;
            const crsRaw = window.simplexProjectCRS || this.currentCoordinates.displayCrs;
            const crsSafe = String(crsRaw || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            const localLine =
                crsRaw && itm && Number.isFinite(itm.east) && Number.isFinite(itm.north)
                    ? `<div class="status-coord-local" title="Project CRS easting / northing">` +
                      `<span class="status-coord-local-label">${crsSafe}</span>` +
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

// Initialize when available
if (typeof window !== 'undefined') {
    window.coordinateManager = new CoordinateManager();
}
