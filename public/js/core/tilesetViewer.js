/**
 * TilesetViewer
 * CesiumJS viewer wrapper and tileset management
 */

class TilesetViewer {
    constructor() {
        this.viewer = null;
        this.tilesets = new Map();
        this.selectedFeature = null;
        this.pathResolver = null;
        this.fileHandleRegistry = null;
        this.mouseCoordinates = { lon: 0, lat: 0, height: 0 };
        this.fps = 0;
        this._initPromise = null;
        this._eventHandlers = new Map(); // Track event handlers for cleanup
        this._fpsLastTime = performance.now();
        this._fpsFrameCount = 0;
        this._mouseMoveThrottleTime = 0; // Throttle mouse move updates
        this._mouseMoveThrottleDelay = 16; // ~60fps for mouse updates
        this._pathCache = new Map(); // Cache resolved paths for performance
        this._tilesetBasePaths = new Map(); // Cache tileset base paths
        /** Parsed root tileset.json by URL — avoids duplicate fetch for JSON tree + jsonConfigManager */
        if (!window.tilesetJsonCache) {
            window.tilesetJsonCache = new Map();
        }
        /** Subfolder under `/data/` for offline raster tiles: `tiles` (standard) or `pro` (aerial). */
        this._offlineRasterDataFolder = 'tiles';
        this._offlineRasterSwitchGeneration = 0;
        // Don't call init() immediately - let caller await it
    }

    /** @readonly */
    static OFFLINE_RASTER_STORAGE_KEY = 'simplex.offlineRasterSource';

    /**
     * Valid offline raster folders (each must contain raster/{z}/{x}/{y}.png and meta.json).
     * @returns {string[]}
     */
    static getOfflineRasterFolderIds() {
        return ['tiles', 'pro'];
    }

    _readOfflineRasterFolder() {
        try {
            const v = localStorage.getItem(TilesetViewer.OFFLINE_RASTER_STORAGE_KEY);
            if (v === 'pro' || v === 'tiles') return v;
        } catch (_) {
            /* ignore */
        }
        return 'tiles';
    }

    getOfflineRasterSource() {
        return this._offlineRasterDataFolder || 'tiles';
    }

    /**
     * Fetch raster_zooms from meta.json for an offline raster folder.
     * @param {string} baseUrl
     * @param {string} dataFolder
     * @returns {Promise<number[]|null>}
     */
    async fetchOfflineMapZoomsFromMeta(baseUrl, dataFolder) {
        try {
            const metaUrl = `${baseUrl}/data/${dataFolder}/meta.json`;
            const response = await fetch(metaUrl);
            if (!response.ok) return null;
            const meta = await response.json();
            if (meta.raster_zooms && Array.isArray(meta.raster_zooms) && meta.raster_zooms.length > 0) {
                return meta.raster_zooms.sort((a, b) => a - b);
            }
        } catch (e) {
            console.debug('fetchOfflineMapZoomsFromMeta:', e?.message || e);
        }
        return null;
    }

    /**
     * Switch offline raster basemap (2D imagery under /data/tiles or /data/pro). Independent of 3D Tiles.
     * @param {string} dataFolder - `tiles` | `pro`
     */
    async setOfflineRasterSource(dataFolder) {
        const allowed = TilesetViewer.getOfflineRasterFolderIds();
        if (!allowed.includes(dataFolder)) {
            console.warn('setOfflineRasterSource: invalid folder', dataFolder);
            return false;
        }
        if (!this.viewer || !this.viewer.imageryLayers) {
            return false;
        }

        const gen = ++this._offlineRasterSwitchGeneration;
        const baseUrl =
            (this.pathResolver && this.pathResolver.baseUrl) ||
            (window.pathResolver && window.pathResolver.baseUrl) ||
            window.location.origin ||
            'http://localhost:8000';

        const defaultZooms = [0, 1, 2, 3, 4, 5, 6, 7];
        let zooms = defaultZooms;
        const fromMeta = await this.fetchOfflineMapZoomsFromMeta(baseUrl, dataFolder);
        if (fromMeta && fromMeta.length) {
            zooms = fromMeta;
        }

        if (gen !== this._offlineRasterSwitchGeneration) return false;

        try {
            localStorage.setItem(TilesetViewer.OFFLINE_RASTER_STORAGE_KEY, dataFolder);
        } catch (_) {
            /* ignore */
        }

        if (this._offlineMapLayer) {
            try {
                this.viewer.imageryLayers.remove(this._offlineMapLayer, true);
            } catch (e) {
                console.warn('remove offline map layer:', e);
            }
            this._offlineMapLayer = null;
        }
        this._offlineMapProvider = null;

        this._offlineRasterDataFolder = dataFolder;
        this._addOfflineMapLayer(baseUrl, zooms, dataFolder);

        const sel = document.getElementById('offlineRasterSourceSelect');
        if (sel && sel.value !== dataFolder) {
            sel.value = dataFolder;
        }

        this.viewer.scene.requestRender?.();
        window.dispatchEvent(
            new CustomEvent('offlineRasterSourceChanged', { detail: { folder: dataFolder, zoomLevels: zooms } })
        );

        if (window.app && typeof window.app.setTransientStatus === 'function') {
            const label = dataFolder === 'pro' ? 'Aerial (data/pro)' : 'Standard (data/tiles)';
            window.app.setTransientStatus(`Offline basemap: ${label}`, 2400);
        }

        return true;
    }

    _syncOfflineRasterSelectUI() {
        const sel = document.getElementById('offlineRasterSourceSelect');
        if (sel) {
            const v = this.getOfflineRasterSource();
            if (sel.querySelector(`option[value="${v}"]`)) {
                sel.value = v;
            }
        }
    }

    /**
     * Store parsed tileset JSON for reuse (JSON tree, config). Keys: user path + resolved URL.
     * @param {string} userUrl
     * @param {string} resolvedUrl
     * @param {object} data
     */
    static storeTilesetJsonCache(userUrl, resolvedUrl, data) {
        if (!window.tilesetJsonCache) window.tilesetJsonCache = new Map();
        if (userUrl) window.tilesetJsonCache.set(userUrl, data);
        if (resolvedUrl && resolvedUrl !== userUrl) {
            window.tilesetJsonCache.set(resolvedUrl, data);
        }
    }

    /**
     * Defaults so loading favors the frustum, screen center, and camera view axis (Cesium foveated 3D Tiles).
     * Tuned for smooth camera motion and faster coverage when jumping between distant areas (coarse-first, cull stale).
     * Override via loadTileset(options). See Cesium3DTileset: foveatedConeSize, preloadWhenHidden, preferLeaves.
     * @returns {object}
     */
    static getViewPriorityTilesetDefaults() {
        return {
            preloadWhenHidden: false,
            preloadFlightDestinations: true,
            foveatedScreenSpaceError: true,
            foveatedConeSize: 0.12,
            foveatedMinimumScreenSpaceErrorRelaxation: 0.0,
            foveatedTimeDelay: 0.2,
            preferLeaves: false,
            cullRequestsWhileMoving: true,
            cullRequestsWhileMovingMultiplier: 90
        };
    }

    /**
     * Throughput + visual accuracy: parallel tile requests, native resolution scale, HDR, FXAA.
     * Safe to call after viewer init and when app-config performance changes.
     * @param {object} [perf] - from JSONConfigManager.getPerformanceSettings(); if omitted, reads config or defaults.
     */
    applyDisplayPerformanceSettings(perf) {
        const viewer = this.viewer;
        if (!viewer || typeof Cesium === 'undefined') return;
        const scene = viewer.scene;
        let p = perf;
        if (p == null && window.jsonConfigManager && typeof window.jsonConfigManager.getPerformanceSettings === 'function') {
            try {
                p = window.jsonConfigManager.getPerformanceSettings();
            } catch {
                p = null;
            }
        }
        if (p == null && window.__simplexPerformance) {
            p = window.__simplexPerformance;
        }
        if (p == null) {
            p = {
                maximumRequestsPerServer: 18,
                viewerResolutionScaleMax: 2,
                useBrowserRecommendedResolution: false
            };
        }
        if (Cesium.RequestScheduler) {
            const n = Math.min(64, Math.max(6, Number(p.maximumRequestsPerServer) || 18));
            Cesium.RequestScheduler.maximumRequestsPerServer = n;
        }
        const useBrowser = p.useBrowserRecommendedResolution === true;
        if (viewer.useBrowserRecommendedResolution !== undefined) {
            viewer.useBrowserRecommendedResolution = useBrowser;
        }
        if (!useBrowser && viewer.resolutionScale !== undefined) {
            const smax = Math.min(2.5, Math.max(0.5, Number(p.viewerResolutionScaleMax) || 2));
            const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
            viewer.resolutionScale = Math.min(smax, dpr);
        }
        if (scene) {
            if (scene.highDynamicRange !== undefined) {
                scene.highDynamicRange = true;
            }
            try {
                if (scene.postProcessStages && scene.postProcessStages.fxaa) {
                    scene.postProcessStages.fxaa.enabled = true;
                }
            } catch {
                /* ignore */
            }
        }
    }

    /**
     * Cache only the root tileset.json (same URL as {@code finalUrl}), not external chunk JSON files.
     * @param {string} userUrl
     * @param {string} finalUrl
     * @param {string} requestSourceUrl - original request URL before path rewriting
     * @param {ArrayBuffer} buffer
     * @param {{ done?: boolean }} state — mutate .done when cached
     */
    _tryCacheRootTilesetJson(userUrl, finalUrl, requestSourceUrl, buffer, state) {
        if (state.done || !buffer || buffer.byteLength === 0) return;
        const strip = (u) =>
            String(u || '')
                .split('?')[0]
                .split('#')[0]
                .replace(/\\/g, '/');
        if (strip(requestSourceUrl) !== strip(finalUrl)) return;
        try {
            const head = new Uint8Array(buffer, 0, Math.min(64, buffer.byteLength));
            const s = String.fromCharCode.apply(null, head);
            const t = s.trimStart();
            if (t[0] !== '{' && t[0] !== '[') return;
            const text = new TextDecoder().decode(buffer);
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object') {
                TilesetViewer.storeTilesetJsonCache(userUrl, finalUrl, parsed);
                state.done = true;
            }
        } catch {
            /* not JSON or parse error */
        }
    }

    /**
     * Join a tileset root directory (Windows or POSIX) with a relative URI from 3D Tiles.
     * @param {string} basePath
     * @param {string} relativePath
     * @returns {string}
     */
    /**
     * SSE multiplier so 3D (pitched) views load the same effective detail as top-down (nadir).
     * Cesium's tile refinement is tighter when looking straight down; without this, leaf 3D tiles
     * look softer when orbiting. multiplier is 1 at nadir and decreases toward the horizon (floored).
     * @param {Cesium.Camera} camera
     * @param {Cesium.SceneMode} sceneMode
     * @returns {number}
     */
    static getViewAngleSseMultiplier(camera, sceneMode) {
        if (!camera || sceneMode === Cesium.SceneMode.SCENE2D) {
            return 1;
        }
        const nadir = -Cesium.Math.PI_OVER_TWO;
        const deviationFromNadir = Math.abs(camera.pitch - nadir);
        const c = Math.cos(deviationFromNadir);
        return Math.max(0.2, c);
    }

    /**
     * Apply view-angle SSE to all tilesets (matches nadir / top-down detail when pitched in 3D).
     */
    _syncAllTilesetsSseForViewAngle() {
        if (!this.viewer || !this.viewer.camera) return;
        const mult = TilesetViewer.getViewAngleSseMultiplier(
            this.viewer.camera,
            this.viewer.scene.mode
        );
        this.tilesets.forEach((data) => {
            const tileset = data.tileset;
            if (!tileset || (typeof tileset.isDestroyed === 'function' && tileset.isDestroyed())) {
                return;
            }
            const base = data.options && data.options.maximumScreenSpaceError;
            if (base == null || !isFinite(base)) return;
            tileset.maximumScreenSpaceError = base * mult;
        });
    }

    _joinTilesetDirAndRelative(basePath, relativePath) {
        let rel = String(relativePath || '')
            .replace(/^\.\.?\//, '')
            .replace(/\\/g, '/');
        if (rel.startsWith('./')) rel = rel.substring(2);
        if (!basePath || basePath === '.') return rel;
        const baseNormalized = basePath.replace(/\\/g, '/');
        const baseWithSlash = baseNormalized.endsWith('/') ? baseNormalized : baseNormalized + '/';
        const joined = baseWithSlash + rel;
        if (/^[A-Za-z]:/.test(basePath)) {
            return joined.replace(/\//g, '\\').replace(/\\+/g, '\\');
        }
        return joined.replace(/\/+/g, '/');
    }

    _registerJsonDirectoryFromFileUrl(requestUrl, jsonDirsSeen) {
        if (!jsonDirsSeen || !requestUrl) return;
        const m = String(requestUrl).match(/\/file\?path=(.+)$/);
        if (!m) return;
        let dec;
        try {
            dec = decodeURIComponent(m[1]);
        } catch {
            return;
        }
        if (!/\.json$/i.test(dec)) return;
        const norm = dec.replace(/\\/g, '/');
        const slash = norm.lastIndexOf('/');
        const dir = slash >= 0 ? norm.substring(0, slash) : '.';
        const store = /^[A-Za-z]:/.test(dec) ? dir.replace(/\//g, '\\') : dir;
        jsonDirsSeen.add(store);
    }

    _isXhr404(err) {
        return !!(err && (err.status === 404 || err.statusCode === 404));
    }

    async _loadWithXhrAndDirFallback(requestUrl, options, jsonDirsSeen, relativeTail, usedBasePath) {
        const xhrOnce = (url) =>
            Cesium.Resource._Implementations.loadWithXhr(
                url,
                options.method || 'GET',
                options.data,
                options.headers,
                options.responseType,
                options.overrideMimeType
            );
        const pathResolver = this.pathResolver || window.pathResolver;
        const baseUrl = (pathResolver && pathResolver.baseUrl) || window.location.origin;
        const tried = new Set([requestUrl]);
        const normBase = (p) => (p ? String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '');
        try {
            return await xhrOnce(requestUrl);
        } catch (err) {
            if (!this._isXhr404(err) || !relativeTail || !jsonDirsSeen || !jsonDirsSeen.size) {
                throw err;
            }
            let lastErr = err;
            const usedN = normBase(usedBasePath);
            const bases = [...jsonDirsSeen]
                .filter(Boolean)
                .sort(
                    (a, b) =>
                        normBase(b).length - normBase(a).length
                );
            for (const base of bases) {
                if (usedBasePath != null && normBase(base) === usedN) continue;
                const joined = this._joinTilesetDirAndRelative(base, relativeTail);
                const alt = `${baseUrl}/file?path=${encodeURIComponent(joined)}`;
                if (tried.has(alt)) continue;
                tried.add(alt);
                try {
                    return await xhrOnce(alt);
                } catch (e) {
                    lastErr = e;
                    if (!this._isXhr404(e)) throw e;
                }
            }
            throw lastErr;
        }
    }

    /**
     * Initialize Cesium viewer
     * @returns {Promise<void>} Promise that resolves when initialization is complete
     */
    async init() {
        // Return existing promise if already initializing
        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = this._doInit();
        return this._initPromise;
    }

    /**
     * Internal initialization method
     * @private
     */
    async _doInit() {
        const container = document.getElementById('cesiumContainer');
        if (!container) {
            console.error('Cesium container not found');
            throw new Error('Cesium container not found');
        }

        // Wait for Cesium to be available with timeout
        const MAX_WAIT_TIME = 30000; // 30 seconds max wait
        const CHECK_INTERVAL = 100;
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
            const checkCesium = () => {
                // Check timeout
                if (Date.now() - startTime > MAX_WAIT_TIME) {
                    container.innerHTML = `
                        <div style="padding: 50px; text-align: center; color: var(--text-color);">
                            <h2>CesiumJS Loading Timeout</h2>
                            <p>CesiumJS failed to load within ${MAX_WAIT_TIME / 1000} seconds.</p>
                            <p>Please ensure CesiumJS is installed in:</p>
                            <code>public/lib/cesium/</code>
                            <p style="margin-top: 20px;">
                                <a href="https://github.com/CesiumGS/cesium/releases/tag/1.119" 
                                   style="color: var(--primary-color);">
                                    Download CesiumJS v1.119
                                </a>
                            </p>
                        </div>
                    `;
                    reject(new Error('CesiumJS loading timeout'));
                    return;
                }

                if (typeof Cesium === 'undefined') {
                    // Check if script is still loading
                    if (window.cesiumAvailable === undefined) {
                        // Still loading, wait a bit more
                        setTimeout(checkCesium, CHECK_INTERVAL);
                        return;
                    }
                    
                    if (window.cesiumAvailable === false) {
                        container.innerHTML = `
                            <div style="padding: 50px; text-align: center; color: var(--text-color);">
                                <h2>CesiumJS Not Found</h2>
                                <p>Please ensure CesiumJS is installed in:</p>
                                <code>public/lib/cesium/</code>
                                <p style="margin-top: 20px;">
                                    <a href="https://github.com/CesiumGS/cesium/releases/tag/1.119" 
                                       style="color: var(--primary-color);">
                                        Download CesiumJS v1.119
                                    </a>
                                </p>
                                <p style="margin-top: 10px; font-size: calc(12px * var(--ui-fs-mul, 1)); color: var(--text-secondary);">
                                    Expected files: Cesium.js and Widgets/widgets.css
                                </p>
                            </div>
                        `;
                        reject(new Error('CesiumJS not available'));
                        return;
                    }
                    setTimeout(checkCesium, CHECK_INTERVAL);
                    return;
                }

                // Cesium is available, proceed with initialization
                try {
                    // Set Cesium base URL for Workers and Assets
                    if (window.CESIUM_BASE_URL) {
                        Cesium.buildModuleUrl.setBaseUrl(window.CESIUM_BASE_URL);
                    }
                    
                    // Offline / local-data mode: clear Ion token only. Do not replace
                    // Ion.defaultServer.request — that breaks Cesium Resource/Request.clone() flows.
                    if (Cesium.Ion) {
                        Cesium.Ion.defaultAccessToken = '';
                    }
                    
                    // Get base URL for tile loading
                    const baseUrl = (this.pathResolver && this.pathResolver.baseUrl) || 
                                   (window.pathResolver && window.pathResolver.baseUrl) || 
                                   window.location.origin || 
                                   'http://localhost:8000';
                    
                    // Offline-first: avoid widgets that load Cesium Ion / default imagery (Resource.request.clone).
                    // Ion SDK measurements still inject into the viewer toolbar when available.
                    this.viewer = new Cesium.Viewer(container, {
                        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
                        imageryProvider: new Cesium.SingleTileImageryProvider({
                            url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                            rectangle: Cesium.Rectangle.MAX_VALUE
                        }),
                        baseLayerPicker: false,
                        geocoder: false,
                        homeButton: true,
                        sceneModePicker: true,
                        navigationHelpButton: true,
                        projectionPicker: true,
                        animation: false,
                        timeline: false,
                        fullscreenButton: true,
                        vrButton: false,
                        infoBox: true,
                        selectionIndicator: true,
                        shouldAnimate: false,
                        creditContainer: document.createElement('div')
                    });
                    
                    // Set up base map imagery layer (background - rendered at bottom)
                    // This is the base map from data/tiles/raster/ - different from JSON tilesets which are 3D primitives
                    if (this.viewer.imageryLayers) {
                        // Remove only the default black background layer, keep any other imagery layers
                        // Find and remove the default single-tile provider if it exists
                        const layersToRemove = [];
                        for (let i = 0; i < this.viewer.imageryLayers.length; i++) {
                            const layer = this.viewer.imageryLayers.get(i);
                            if (layer && layer.imageryProvider) {
                                const provider = layer.imageryProvider;
                                // Remove default black background or Ion layers
                                if (provider.url && (
                                    provider.url.includes('data:image/png;base64') ||
                                    provider.url.includes('cesium.com') ||
                                    provider.url.includes('api.cesium.com')
                                )) {
                                    layersToRemove.push(layer);
                                }
                            }
                        }
                        layersToRemove.forEach(layer => this.viewer.imageryLayers.remove(layer));
                        
                        // Add offline map tiles as PRIMARY base layer (data/tiles or data/pro — user preference)
                        const defaultZooms = [0, 1, 2, 3, 4, 5, 6, 7];
                        const rasterFolder = this._readOfflineRasterFolder();
                        this._offlineRasterDataFolder = rasterFolder;
                        const initGen = ++this._offlineRasterSwitchGeneration;
                        void (async () => {
                            let zooms = defaultZooms;
                            try {
                                const z = await this.fetchOfflineMapZoomsFromMeta(baseUrl, rasterFolder);
                                if (z && z.length) zooms = z;
                            } catch (e) {
                                /* ignore */
                            }
                            if (!this.viewer) return;
                            if (initGen !== this._offlineRasterSwitchGeneration) return;
                            this._addOfflineMapLayer(baseUrl, zooms, rasterFolder);
                            this._loadOfflineMapConfig(baseUrl, rasterFolder);
                        })();
                    }
                    
                    // Leave Cesium viewer chrome visible (widgets, Ion measurement toolbar, etc.).

                    // Set up mouse move handler for coordinates (tracked for cleanup)
                    // Throttled for performance - only update at ~60fps max
                    const mouseMoveHandler = (e) => {
                        const now = performance.now();
                        if (now - this._mouseMoveThrottleTime >= this._mouseMoveThrottleDelay) {
                            this._mouseMoveThrottleTime = now;
                            this.updateMouseCoordinates(e);
                        }
                    };
                    this.viewer.canvas.addEventListener('mousemove', mouseMoveHandler);
                    this._eventHandlers.set('mousemove', { element: this.viewer.canvas, handler: mouseMoveHandler, type: 'mousemove' });

                    // Set up click handler for feature picking (tracked for cleanup)
                    const clickHandler = (e) => {
                        this.handlePick(e);
                    };
                    this.viewer.canvas.addEventListener('click', clickHandler);
                    this._eventHandlers.set('click', { element: this.viewer.canvas, handler: clickHandler, type: 'click' });

                    // Set up render loop for FPS (tracked for cleanup)
                    const fpsHandler = () => {
                        this.updateFPS();
                    };
                    this.viewer.clock.onTick.addEventListener(fpsHandler);
                    this._eventHandlers.set('clockTick', { element: this.viewer.clock.onTick, handler: fpsHandler, type: 'event' });

                    // Initialize render loop manager
                    if (window.renderLoopManager) {
                        window.renderLoopManager.init(this.viewer);
                    }

                    // Status bar: aggregate 3D Tiles loaded-tile count + sampled feature count (throttled)
                    this._statsLastTime = 0;
                    this._sceneStatsHandler = () => {
                        if (!this.viewer) return;
                        const now = performance.now();
                        if (now - this._statsLastTime < 450) return;
                        this._statsLastTime = now;
                        let tileSum = 0;
                        this.tilesets.forEach((data) => {
                            const st = data.tileset && data.tileset.statistics;
                            if (st && typeof st.numberOfTilesWithContentReady === 'number') {
                                tileSum += st.numberOfTilesWithContentReady;
                            }
                        });
                        if (window.app && typeof window.app.updateTileCount === 'function') {
                            window.app.updateTileCount(tileSum);
                        }
                        let feat = 0;
                        if (window.tileInspector && window.tileInspector.featureStats) {
                            feat = window.tileInspector.featureStats.totalFeatures | 0;
                        }
                        if (window.app && typeof window.app.updateFeatureCount === 'function') {
                            window.app.updateFeatureCount(feat);
                        }
                    };
                    this.viewer.scene.postRender.addEventListener(this._sceneStatsHandler);

                    this._tilesetSseLastTime = 0;
                    /** Throttle ~20Hz: keeps SSE aligned with pitch during drag/flight without per-tileset moveEnd listeners */
                    this._tilesetSseThrottleMs = 50;
                    this._tilesetSseViewHandler = () => {
                        const now = performance.now();
                        if (now - this._tilesetSseLastTime < this._tilesetSseThrottleMs) return;
                        this._tilesetSseLastTime = now;
                        this._syncAllTilesetsSseForViewAngle();
                    };
                    this.viewer.scene.postRender.addEventListener(this._tilesetSseViewHandler);

                    this.applyDisplayPerformanceSettings();

                    // Improve 3D picking for measurements/tools on 3D Tiles and imagery layers
                    const scene = this.viewer.scene;
                    if (scene) {
                        // Keep render errors from permanently killing the render loop.
                        scene.rethrowRenderErrors = false;
                    }
                    if (scene && scene.globe) {
                        scene.globe.depthTestAgainstTerrain = true;
                    }
                    if (scene && typeof scene.pickTranslucentDepth === 'boolean') {
                        // This path has caused intermittent renderer crashes on some GPU/tileset combos.
                        scene.pickTranslucentDepth = false;
                    }
                    if (scene && scene.renderError) {
                        const onRenderError = (sc, err) => {
                            const msg = String((err && (err.message || err)) || '');
                            console.error('Cesium renderError:', err);
                            try {
                                if (sc && typeof sc.pickTranslucentDepth === 'boolean') {
                                    sc.pickTranslucentDepth = false;
                                }
                                if (sc && sc.globe) {
                                    sc.globe.shadows = Cesium.ShadowMode.DISABLED;
                                }
                            } catch (recoverErr) {
                                console.warn('Render recovery attempt failed:', recoverErr);
                            }
                            if (msg.includes('_target') || msg.includes('Invalid array length')) {
                                console.warn('Applied render safety fallback for unstable renderer state.');
                            }
                        };
                        scene.renderError.addEventListener(onRenderError);
                        this._eventHandlers.set('renderError', { element: scene.renderError, handler: onRenderError, type: 'event' });
                    }

                    if (window.__preferIonSdkMeasurements &&
                        window.IonSdkMeasurements &&
                        typeof window.IonSdkMeasurements.viewerMeasureMixin === 'function' &&
                        !this.viewer.measure) {
                        try {
                            window.IonSdkMeasurements.viewerMeasureMixin(this.viewer);
                            window.__ionViewerMeasureAttached = true;
                            if (this.viewer.measure && this.viewer.measure.viewModel) {
                                /* Collapsed until user opens Measure from the map toolbar (GIS-style default). */
                                this.viewer.measure.viewModel.expanded = false;
                            }
                        } catch (ionMeasureErr) {
                            console.warn('IonSdkMeasurements.viewerMeasureMixin failed:', ionMeasureErr);
                        }
                    }

                    if (typeof window.applySceneTuningFromWindowT === 'function') {
                        window.applySceneTuningFromWindowT(this.viewer);
                        try {
                            const self = this;
                            this.viewer.imageryLayers.layerAdded.addEventListener(function () {
                                window.applySceneTuningFromWindowT(self.viewer);
                            });
                        } catch (e) {
                            /* ignore */
                        }
                    }

                    if (window.viewRangeToolbarInject && typeof window.viewRangeToolbarInject.scheduleInject === 'function') {
                        window.viewRangeToolbarInject.scheduleInject(this.viewer);
                    }

                    if (window.smart3dToolbarWireup && typeof window.smart3dToolbarWireup.init === 'function') {
                        window.smart3dToolbarWireup.init();
                    }
                    if (window.lineOfSightManager && typeof window.lineOfSightManager.init === 'function') {
                        window.lineOfSightManager.init();
                    }

                    console.log('Cesium viewer initialized');
                    this._syncOfflineRasterSelectUI();
                    // Initialize GIS layer runtime after viewer is ready
                    try {
                        if (window.layerRuntime && window.layerRuntime.init) {
                            window.layerRuntime.init(this.viewer);
                        }
                        if (window.layerStore && window.layerStore.refresh) {
                            window.layerStore.refresh();
                        }
                    } catch (e) {
                        console.warn('GIS layer runtime init failed:', e);
                    }
                    resolve();
                } catch (error) {
                    console.error('Failed to initialize Cesium viewer:', error);
                    reject(error);
                }
            };
            
            checkCesium();
        });
    }

    /**
     * Initialize with dependencies
     */
    initDependencies(pathResolver, fileHandleRegistry) {
        if (!pathResolver) {
            console.warn('TilesetViewer.initDependencies called with null pathResolver, will use window.pathResolver');
            pathResolver = window.pathResolver;
        }
        if (!fileHandleRegistry) {
            console.warn('TilesetViewer.initDependencies called with null fileHandleRegistry, will use window.fileHandleRegistry');
            fileHandleRegistry = window.fileHandleRegistry;
        }
        
        this.pathResolver = pathResolver;
        this.fileHandleRegistry = fileHandleRegistry;
        
        console.log('TilesetViewer dependencies initialized:', {
            pathResolver: !!this.pathResolver,
            fileHandleRegistry: !!this.fileHandleRegistry,
            baseUrl: this.pathResolver?.baseUrl,
            pathResolverInitialized: !!(this.pathResolver && this.pathResolver.baseUrl)
        });
        
        // If pathResolver exists but isn't initialized, try to initialize it
        if (this.pathResolver && !this.pathResolver.baseUrl && this.fileHandleRegistry) {
            console.warn('PathResolver passed to initDependencies is not initialized, initializing now...');
            this.pathResolver.init(this.fileHandleRegistry).then(() => {
                console.log('PathResolver initialized via initDependencies');
            }).catch(err => {
                console.error('Failed to initialize PathResolver in initDependencies:', err);
            });
        }
    }

    /**
     * Cesium 1.12+ ignores `requestFunction` on {@link Cesium.Resource} options; the loader lives on
     * {@link Cesium.Request}. This builds a Resource with a proper Request so clone/fetch work.
     * @private
     */
    _cesiumResourceWithRequest(url, requestFunction) {
        const probe = new Cesium.Resource({ url });
        const RequestClass = probe.request.constructor;
        const request = new RequestClass({ url, requestFunction });
        return new Cesium.Resource({ url, request });
    }

    /**
     * Load tileset
     */
    async loadTileset(url, options = {}) {
        if (!this.viewer) {
            const error = new Error('Viewer not initialized');
            if (window.errorHandler) {
                window.errorHandler.handle(error, { component: 'TilesetViewer', action: 'loadTileset' });
            }
            throw error;
        }

        // Validate input
        if (!url || typeof url !== 'string') {
            const error = new Error('Invalid tileset URL');
            if (window.errorHandler) {
                window.errorHandler.handle(error, { component: 'TilesetViewer', action: 'loadTileset' });
            }
            throw error;
        }

        try {
            // Resolve path with error handling
            // Use this.pathResolver if available and initialized, otherwise fall back to window.pathResolver
            let pathResolver = this.pathResolver;
            let needsInit = false;
            
            // Check if this.pathResolver is initialized (has baseUrl)
            if (!pathResolver || !pathResolver.baseUrl) {
                // Try window.pathResolver
                pathResolver = window.pathResolver;
                
                // Check if window.pathResolver exists but isn't initialized
                if (pathResolver && !pathResolver.baseUrl) {
                    needsInit = true;
                } else if (!pathResolver) {
                    // PathResolver doesn't exist at all
                    throw new Error('PathResolver module not loaded. Please ensure PathResolver.js is included in the page.');
                }
            }
            
            // Initialize if needed
            if (needsInit && window.fileHandleRegistry) {
                console.warn('PathResolver exists but not initialized, initializing now...');
                try {
                    await pathResolver.init(window.fileHandleRegistry);
                    // Also set it on this instance for future use
                    this.pathResolver = pathResolver;
                    this.fileHandleRegistry = window.fileHandleRegistry;
                    console.log('PathResolver initialized successfully');
                } catch (initError) {
                    console.error('Failed to initialize PathResolver:', initError);
                    throw new Error('PathResolver initialization failed: ' + (initError.message || initError));
                }
            } else if (needsInit && !window.fileHandleRegistry) {
                throw new Error('PathResolver needs initialization but FileHandleRegistry is not available. Please ensure FileHandleRegistry.js is loaded.');
            }
            
            // Ensure we have a valid pathResolver
            if (!pathResolver || !pathResolver.baseUrl) {
                throw new Error('PathResolver is not properly initialized. baseUrl is missing.');
            }
            
            // Use the resolved pathResolver
            const activePathResolver = pathResolver;

            // Use explicit branch: `||` would re-run resolvePath when the result is a falsy string or 0.
            const resolvedUrl = window.errorHandler
                ? await window.errorHandler.handleAsync(
                    () => activePathResolver.resolvePath(url),
                    { component: 'TilesetViewer', action: 'resolvePath' },
                    {
                        showNotification: true,
                        retry: { enabled: true, maxAttempts: 3, delay: 1000 }
                    }
                )
                : await activePathResolver.resolvePath(url);
            
            if (window.logger) {
                window.logger.debug('Resolved URL:', resolvedUrl, 'from input:', url);
            } else {
                console.log('Resolved URL:', resolvedUrl, 'from input:', url);
            }
            
            // Create resource with custom request function for Windows paths
            let resource;
            if (resolvedUrl && typeof resolvedUrl === 'object' && resolvedUrl.type === 'fileHandle') {
                const fhState = { done: false };
                resource = this._cesiumResourceWithRequest(url, async () => {
                    const handle = resolvedUrl.handle;
                    const file = await handle.getFile();
                    const buf = await file.arrayBuffer();
                    this._tryCacheRootTilesetJson(url, url, url, buf, fhState);
                    return buf;
                });
            } else {
                // Use resolved URL (should be HTTP URL)
                const finalUrl = typeof resolvedUrl === 'string' ? resolvedUrl : url;
                console.log('Loading tileset from:', finalUrl);
                
                // Extract base path for relative resolution (optimized for JSON paths)
                // Check if this is a /file endpoint request
                let tilesetBaseUrl;
                let tilesetBasePath = null; // Windows path for /file endpoint
                
                // Check cache first for performance
                const cacheKey = finalUrl;
                if (this._tilesetBasePaths.has(cacheKey)) {
                    const cached = this._tilesetBasePaths.get(cacheKey);
                    tilesetBaseUrl = cached.baseUrl;
                    tilesetBasePath = cached.basePath;
                } else {
                    if (finalUrl.includes('/file?path=')) {
                        // Extract the actual file path from the /file endpoint
                        const pathMatch = finalUrl.match(/\/file\?path=(.+)$/);
                        if (pathMatch) {
                            tilesetBasePath = decodeURIComponent(pathMatch[1]);
                            // Get directory of the tileset JSON file (optimized path extraction)
                            const pathObj = tilesetBasePath.replace(/\\/g, '/');
                            const lastSlash = pathObj.lastIndexOf('/');
                            tilesetBasePath = lastSlash >= 0 ? pathObj.substring(0, lastSlash) : '.';
                            // Store the base URL for /file endpoint
                            tilesetBaseUrl = finalUrl.substring(0, finalUrl.indexOf('/file')) + '/file';
                        } else {
                            tilesetBaseUrl = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
                        }
                    } else {
                        tilesetBaseUrl = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
                    }
                    // Cache for future use
                    this._tilesetBasePaths.set(cacheKey, { baseUrl: tilesetBaseUrl, basePath: tilesetBasePath });
                }

                // Directories that contain tileset JSON (master + external refs) for resolving content URIs
                const jsonDirsSeen = new Set();
                if (tilesetBasePath) jsonDirsSeen.add(tilesetBasePath);

                /** Only the first JSON payload in this load is treated as root tileset.json for cache */
                const rootJsonCacheState = { done: false };
                
                // Custom Request intercepts tile loads (must be on Cesium.Request, not Resource options)
                resource = this._cesiumResourceWithRequest(finalUrl, async (options) => {
                        let requestUrl = options.url;
                        const originalUrl = requestUrl;
                        let relativeTailForRetry = null;
                        const usedBaseForRetry = tilesetBasePath || null;
                        
                        // Fast path: check cache first
                        if (this._pathCache.has(requestUrl)) {
                            requestUrl = this._pathCache.get(requestUrl);
                        } else {
                            // Remove any query parameters that might have been appended (like ?path=...)
                            const urlWithoutQuery = requestUrl.split('?')[0];
                            
                            // Use URL without query for processing
                            requestUrl = urlWithoutQuery;
                        
                        // Check if this is a URL constructed by Cesium using baseUrl (/file/relative/path)
                        // We need to convert it to /file?path=absolute/path format
                        // Match pattern: http://host/file/relative/path or /file/relative/path
                        const filePathMatch = requestUrl.match(/\/file\/([^?#]+)/);
                        if (filePathMatch && !requestUrl.includes('/file?path=') && tilesetBasePath) {
                            let relativePath = decodeURIComponent(filePathMatch[1]);
                            relativeTailForRetry = relativePath.replace(/\\/g, '/').replace(/^\.\.?\//, '');
                            
                            // Resolve relative to tileset directory (optimized path resolution)
                            let resolvedPath;
                            if (tilesetBasePath === '.') {
                                resolvedPath = relativePath;
                            } else {
                                // Normalize paths for joining - handle mixed separators
                                let baseNormalized = tilesetBasePath.replace(/\\/g, '/');
                                let relativeNormalized = relativePath.replace(/\\/g, '/');
                                
                                // Remove leading ./ or ../ from relative path
                                relativeNormalized = relativeNormalized.replace(/^\.\.?\//, '');
                                
                                // Join paths properly - ensure base ends with /
                                const baseWithSlash = baseNormalized.endsWith('/') ? baseNormalized : baseNormalized + '/';
                                const joined = baseWithSlash + relativeNormalized;
                                
                                // Convert back to Windows path format if original was Windows path
                                const isWindowsPath = tilesetBasePath.match(/^[A-Za-z]:/) || tilesetBasePath.includes('\\');
                                resolvedPath = isWindowsPath ? joined.replace(/\//g, '\\') : joined;
                                
                                // Normalize the path (remove redundant separators)
                                const separator = isWindowsPath ? '\\' : '/';
                                resolvedPath = resolvedPath.replace(/[\\/]+/g, separator);
                            }
                            
                            // Convert to /file?path= format
                            const encodedPath = encodeURIComponent(resolvedPath);
                            const pathResolver = this.pathResolver || window.pathResolver;
                            const baseUrl = (pathResolver && pathResolver.baseUrl) || 
                                           window.location.origin;
                            requestUrl = `${baseUrl}/file?path=${encodedPath}`;
                        }
                        
                        // Check if this is an absolute path from server root that should be relative to tileset
                        // This handles cases where Cesium makes requests like /Cesium_Ashkelon_2025_V1.b3dm
                        // or http://localhost:8001/Cesium_Ashkelon_2025_V1.b3dm
                        // or http://localhost:8001/Data/101/L15_1011.b3dm (tileset subdirectories)
                        if (tilesetBasePath && !requestUrl.includes('/file?path=')) {
                            let relativePath = null;
                            let shouldIntercept = false;
                            
                            // Check if it's a simple absolute path from server root
                            if (requestUrl.startsWith('/') && 
                                !requestUrl.startsWith('/file') && 
                                !requestUrl.startsWith('/data') &&
                                !requestUrl.startsWith('/Data') &&
                                !requestUrl.startsWith('/lib') &&
                                !requestUrl.startsWith('/css') &&
                                !requestUrl.startsWith('/js') &&
                                !requestUrl.includes('index.html') &&
                                !requestUrl.includes('favicon')) {
                                relativePath = requestUrl.substring(1);
                                shouldIntercept = true;
                            } 
                            // Check if it's a full URL to server root (including /Data/ paths)
                            else if (requestUrl.startsWith('http://localhost:') && 
                                     !requestUrl.includes('/file') && 
                                     !requestUrl.includes('/data') &&
                                     !requestUrl.includes('/lib') &&
                                     !requestUrl.includes('/css') &&
                                     !requestUrl.includes('/js')) {
                                try {
                                    const urlObj = new URL(requestUrl.split('?')[0]); // Remove query params for parsing
                                    const pathname = urlObj.pathname;
                                    // Check if this looks like a tileset file path (Data/, .b3dm, .json, etc.)
                                    if (pathname && (
                                        pathname.startsWith('/Data/') || 
                                        pathname.endsWith('.b3dm') || 
                                        pathname.endsWith('.json') ||
                                        pathname.match(/^\/[A-Z]/) // Paths starting with capital letter (like /Data/)
                                    )) {
                                        relativePath = pathname.substring(1); // Remove leading /
                                        shouldIntercept = true;
                                    }
                                } catch (e) {
                                    // Invalid URL, skip
                                }
                            }
                            
                            if (shouldIntercept && relativePath) {
                                relativeTailForRetry = relativePath.replace(/\\/g, '/').replace(/^\.\.?\//, '');
                                // Resolve relative to tileset directory (optimized)
                                let resolvedPath;
                                if (tilesetBasePath === '.') {
                                    resolvedPath = relativePath;
                                } else {
                                    const baseNormalized = tilesetBasePath.replace(/\\/g, '/');
                                    const baseWithSlash = baseNormalized.endsWith('/') ? baseNormalized : baseNormalized + '/';
                                    const joined = baseWithSlash + relativePath;
                                    
                                    const isWindowsPath = tilesetBasePath.match(/^[A-Za-z]:/);
                                    resolvedPath = isWindowsPath ? joined.replace(/\//g, '\\') : joined;
                                }
                                
                                // Convert to /file?path= format
                                const encodedPath = encodeURIComponent(resolvedPath);
                                const pathResolver = this.pathResolver || window.pathResolver;
                                const baseUrl = (pathResolver && pathResolver.baseUrl) || 
                                               window.location.origin;
                                requestUrl = `${baseUrl}/file?path=${encodedPath}`;
                            }
                        }
                        
                        // If it's a relative URL (not starting with http), resolve it relative to the tileset JSON
                        if (!requestUrl.startsWith('http://') && !requestUrl.startsWith('https://') && !requestUrl.startsWith('data:')) {
                            // Remove leading ./ or ../
                            let relativePath = requestUrl.replace(/^\.\.?\//, '');
                            
                            // If we have a base path (Windows path), resolve relative to it
                            if (tilesetBasePath) {
                                // Normalize the relative request URL
                                relativePath = relativePath.replace(/\\/g, '/');
                                // Remove leading ./ if present
                                if (relativePath.startsWith('./')) {
                                    relativePath = relativePath.substring(2);
                                }
                                relativeTailForRetry = relativePath.replace(/^\.\.?\//, '');
                                
                                // Handle paths that start with Data/ or data/ (tileset subdirectories)
                                // These should be resolved relative to tileset directory, not server data directory
                                
                                // Resolve relative path on Windows filesystem
                                let resolvedPath;
                                if (tilesetBasePath === '.') {
                                    resolvedPath = relativePath;
                                } else {
                                    // Use proper path joining for Windows
                                    // Normalize both paths - handle mixed separators
                                    let baseNormalized = tilesetBasePath.replace(/\\/g, '/');
                                    let relativeNormalized = relativePath.replace(/\\/g, '/');
                                    
                                    // Remove leading ./ or ../ from relative path
                                    relativeNormalized = relativeNormalized.replace(/^\.\.?\//, '');
                                    
                                    // Ensure base ends with /
                                    const baseWithSlash = baseNormalized.endsWith('/') ? baseNormalized : baseNormalized + '/';
                                    const joined = baseWithSlash + relativeNormalized;
                                    
                                    // Convert back to Windows path format if original was Windows path
                                    if (tilesetBasePath.match(/^[A-Za-z]:/)) {
                                        // Windows absolute path - use backslashes
                                        resolvedPath = joined.replace(/\//g, '\\');
                                    } else if (tilesetBasePath.includes('\\')) {
                                        // Windows path format (backslashes) - preserve
                                        resolvedPath = joined.replace(/\//g, '\\');
                                    } else {
                                        // Unix-style path - keep forward slashes
                                        resolvedPath = joined;
                                    }
                                    
                                    // Normalize the path (remove redundant separators)
                                    // Use Windows backslashes if it's a Windows path, otherwise forward slashes
                                    const isWindowsPath = tilesetBasePath.match(/^[A-Za-z]:/);
                                    const separator = isWindowsPath ? '\\' : '/';
                                    resolvedPath = resolvedPath.replace(/[\\/]+/g, separator);
                                }
                                
                                // Convert back to /file endpoint URL
                                const encodedPath = encodeURIComponent(resolvedPath);
                                const pathResolver = this.pathResolver || window.pathResolver;
                                const baseUrl = (pathResolver && pathResolver.baseUrl) || 
                                               window.location.origin;
                                requestUrl = `${baseUrl}/file?path=${encodedPath}`;
                            } else {
                                // Get base URL from tileset JSON location
                                requestUrl = tilesetBaseUrl + requestUrl;
                            }
                        }
                        
                            // Normalize path separators in URL (URLs use forward slashes)
                            // But preserve backslashes in the path parameter value
                            if (!requestUrl.includes('/file?path=')) {
                                requestUrl = requestUrl.replace(/\\/g, '/');
                            }
                            
                            // Cache resolved path for future requests
                            this._pathCache.set(originalUrl, requestUrl);
                        }
                        
                        // Reduced logging for performance (only first 5 requests)
                        if (!this._tileRequestCount) this._tileRequestCount = 0;
                        if (this._tileRequestCount < 5) {
                            console.log('Requesting tile:', requestUrl);
                            this._tileRequestCount++;
                        } else if (this._tileRequestCount === 5) {
                            console.log('(Suppressing further tile request logs for performance)');
                            this._tileRequestCount++;
                        }
                        
                        try {
                            const response = await this._loadWithXhrAndDirFallback(
                                requestUrl,
                                options,
                                jsonDirsSeen,
                                relativeTailForRetry,
                                usedBaseForRetry
                            );
                            if (response instanceof ArrayBuffer) {
                                this._tryCacheRootTilesetJson(
                                    url,
                                    finalUrl,
                                    requestUrl,
                                    response,
                                    rootJsonCacheState
                                );
                            }
                            this._registerJsonDirectoryFromFileUrl(requestUrl, jsonDirsSeen);
                            
                            // Log successful tile loads (first few only)
                            if (this._tileRequestCount < 5) {
                                console.log('✓ Successfully loaded tile:', requestUrl);
                            }
                            
                            return response;
                        } catch (error) {
                            // Enhanced error handling with detailed logging
                            const errorInfo = {
                                url: requestUrl,
                                originalUrl: originalUrl,
                                tilesetBasePath: tilesetBasePath,
                                error: error.message || error,
                                status: error.status || error.statusCode
                            };
                            
                            // Log detailed error information (first 10 errors)
                            if (this._tileRequestCount < 10) {
                                console.error('✗ Failed to load tile:', errorInfo);
                                
                                // Provide helpful error messages
                                if (error.status === 404 || error.statusCode === 404) {
                                    console.error('  → File not found. Check:');
                                    console.error('    1. File exists at resolved path');
                                    console.error('    2. Path encoding is correct');
                                    console.error('    3. Tileset directory structure matches JSON');
                                } else if (error.status === 403 || error.statusCode === 403) {
                                    console.error('  → Permission denied. Check file permissions.');
                                } else {
                                    console.error('  → Network or server error. Check server console.');
                                }
                            }
                            
                            // Handle error with retry logic
                            if (window.errorHandler) {
                                window.errorHandler.handle(error, {
                                    component: 'TilesetViewer',
                                    action: 'loadTile',
                                    url: requestUrl,
                                    details: errorInfo
                                }, false); // Don't show notification for individual tile failures
                            }
                            
                            throw error;
                        }
                });
                
                // Set baseUrl for Cesium to use when resolving relative paths
                if (!finalUrl.includes('/file?path=')) {
                    // Normal case: use the tileset base URL
                    resource.baseUrl = tilesetBaseUrl;
                } else {
                    // For /file endpoint, set baseUrl to the server base + /file
                    // This way Cesium will construct URLs like http://localhost:8001/file/relative/path
                    // which we can then intercept and fix in the request function
                    const pathResolver = this.pathResolver || window.pathResolver;
                    const baseUrl = (pathResolver && pathResolver.baseUrl) || 
                                   window.location.origin;
                    resource.baseUrl = `${baseUrl}/file`;
                }
            }

            // Create tileset — view-first loading (foveated SSE + no hidden preload) + high accuracy
            // Cesium3DTileset.maximumMemoryUsage is in megabytes (MB), not bytes — large mistaken values break WebGL/textures.
            const tilesetOptions = {
                ...TilesetViewer.getViewPriorityTilesetDefaults(),
                maximumScreenSpaceError: options.maximumScreenSpaceError ?? 0.08,
                maximumMemoryUsage:
                    options.maximumMemoryUsage != null ? options.maximumMemoryUsage : 2048,
                refine: options.refine !== undefined ? options.refine : Cesium.Cesium3DTileRefine.REPLACE,
                skipLevelOfDetail: false,
                skipLevels: 0,
                baseScreenSpaceError: 0,
                immediatelyLoadDesiredLevelOfDetail: false,
                dynamicScreenSpaceError: false,
                ...options,
                loadingDescendantLimit:
                    options.loadingDescendantLimit != null ? options.loadingDescendantLimit : 768
            };
            
            const tileset = await Cesium.Cesium3DTileset.fromUrl(resource, tilesetOptions);
            
            // CRITICAL: Apply optimized settings directly to tileset instance
            // Ensures consistent high-performance display for JSON paths and regular paths
            tileset.maximumScreenSpaceError = tilesetOptions.maximumScreenSpaceError;
            tileset.maximumMemoryUsage = tilesetOptions.maximumMemoryUsage;
            tileset.refine = Cesium.Cesium3DTileRefine.REPLACE; // Force REPLACE to prevent layer blending
            tileset.skipLevelOfDetail = false; // Never skip levels
            tileset.skipLevels = 0; // Don't skip any levels
            tileset.baseScreenSpaceError = 0; // Maximum accuracy
            tileset.immediatelyLoadDesiredLevelOfDetail = false;
            tileset.loadingDescendantLimit = tilesetOptions.loadingDescendantLimit;
            
            // View-priority + accuracy (defaults from getViewPriorityTilesetDefaults; options can override)
            if (tileset.cullWithChildrenBounds !== undefined) {
                tileset.cullWithChildrenBounds = false;
            }
            if (tileset.loadSiblings !== undefined) {
                tileset.loadSiblings =
                    options.loadSiblings !== undefined ? options.loadSiblings : true;
            }
            const vp = TilesetViewer.getViewPriorityTilesetDefaults();
            if (tileset.preloadWhenHidden !== undefined) {
                tileset.preloadWhenHidden =
                    options.preloadWhenHidden !== undefined
                        ? options.preloadWhenHidden
                        : vp.preloadWhenHidden;
            }
            if (tileset.preloadFlightDestinations !== undefined) {
                tileset.preloadFlightDestinations =
                    options.preloadFlightDestinations !== undefined
                        ? options.preloadFlightDestinations
                        : vp.preloadFlightDestinations;
            }
            if (tileset.foveatedScreenSpaceError !== undefined) {
                tileset.foveatedScreenSpaceError =
                    options.foveatedScreenSpaceError !== undefined
                        ? options.foveatedScreenSpaceError
                        : vp.foveatedScreenSpaceError;
            }
            if (tileset.foveatedConeSize !== undefined) {
                tileset.foveatedConeSize =
                    options.foveatedConeSize !== undefined
                        ? options.foveatedConeSize
                        : vp.foveatedConeSize;
            }
            if (tileset.foveatedMinimumScreenSpaceErrorRelaxation !== undefined) {
                tileset.foveatedMinimumScreenSpaceErrorRelaxation =
                    options.foveatedMinimumScreenSpaceErrorRelaxation !== undefined
                        ? options.foveatedMinimumScreenSpaceErrorRelaxation
                        : vp.foveatedMinimumScreenSpaceErrorRelaxation;
            }
            if (tileset.foveatedTimeDelay !== undefined) {
                tileset.foveatedTimeDelay =
                    options.foveatedTimeDelay !== undefined
                        ? options.foveatedTimeDelay
                        : vp.foveatedTimeDelay;
            }
            if (tileset.preferLeaves !== undefined) {
                tileset.preferLeaves =
                    options.preferLeaves !== undefined ? options.preferLeaves : vp.preferLeaves;
            }
            if (tileset.cullRequestsWhileMoving !== undefined) {
                tileset.cullRequestsWhileMoving =
                    options.cullRequestsWhileMoving !== undefined
                        ? options.cullRequestsWhileMoving
                        : vp.cullRequestsWhileMoving;
            }
            if (tileset.cullRequestsWhileMovingMultiplier !== undefined) {
                tileset.cullRequestsWhileMovingMultiplier =
                    options.cullRequestsWhileMovingMultiplier !== undefined
                        ? options.cullRequestsWhileMovingMultiplier
                        : vp.cullRequestsWhileMovingMultiplier;
            }
            if (tileset.dynamicScreenSpaceError !== undefined) {
                tileset.dynamicScreenSpaceError = false;
            }

            // Log configuration (reduced verbosity for performance)
            if (window.logger) {
                window.logger.debug('Tileset configured for fast, high-quality display:', {
                    maximumScreenSpaceError: tileset.maximumScreenSpaceError,
                    refine: tileset.refine,
                    skipLevelOfDetail: tileset.skipLevelOfDetail,
                    maximumMemoryUsageMB: tileset.maximumMemoryUsage
                });
            }
            
            // Ensure tileset uses our resource with custom request function
            // Set the baseResource to our resource so all child requests use our path resolution
            if (tileset && tileset._baseResource) {
                const baseResource = tileset._baseResource;
                
                baseResource.baseUrl = resource.baseUrl;
                
                // Extract base path for relative resolution (same logic as above)
                let basePathForChildren = null;
                const finalUrlForChildren = typeof resolvedUrl === 'string' ? resolvedUrl : url;
                if (finalUrlForChildren.includes('/file?path=')) {
                    const pathMatch = finalUrlForChildren.match(/\/file\?path=(.+)$/);
                    if (pathMatch) {
                        const tilesetPath = decodeURIComponent(pathMatch[1]);
                        // Get directory of the tileset JSON file
                        const pathObj = tilesetPath.replace(/\\/g, '/');
                        const lastSlash = pathObj.lastIndexOf('/');
                        if (lastSlash >= 0) {
                            basePathForChildren = pathObj.substring(0, lastSlash);
                        } else {
                            basePathForChildren = '.';
                        }
                    }
                }
                if (basePathForChildren) {
                    jsonDirsSeen.add(basePathForChildren);
                }
                
                const childTileRequestFunction = async (requestOptions) => {
                    let requestUrl = requestOptions.url;
                    const originalChildUrl = requestUrl;
                    let relativeTailForRetry = null;
                    const usedChildBase = basePathForChildren;
                    
                    // Fast path: check cache first for performance
                    if (this._pathCache.has(requestUrl)) {
                        requestUrl = this._pathCache.get(requestUrl);
                    } else {
                        // Check if this is a full URL that should be intercepted (like http://localhost:8001/Data/...)
                        if (requestUrl.startsWith('http://localhost:') && 
                            !requestUrl.includes('/file') && 
                            !requestUrl.includes('/data') &&
                            !requestUrl.includes('/lib') &&
                            !requestUrl.includes('/css') &&
                            !requestUrl.includes('/js') &&
                            basePathForChildren) {
                        try {
                            const urlObj = new URL(requestUrl.split('?')[0]); // Remove query params
                            const pathname = urlObj.pathname;
                            // Check if this looks like a tileset file path
                            if (pathname && (
                                pathname.startsWith('/Data/') || 
                                pathname.endsWith('.b3dm') || 
                                pathname.endsWith('.json') ||
                                pathname.match(/^\/[A-Z]/) // Paths starting with capital letter
                            )) {
                                let relativePath = pathname.substring(1); // Remove leading /
                                relativeTailForRetry = relativePath.replace(/\\/g, '/').replace(/^\.\.?\//, '');
                                console.log('Child: Detected absolute URL that should be relative:', relativePath, 'base:', basePathForChildren);
                                
                                // Resolve relative to tileset directory
                                let resolvedPath;
                                if (basePathForChildren === '.') {
                                    resolvedPath = relativePath;
                                } else {
                                    const baseNormalized = basePathForChildren.replace(/\\/g, '/');
                                    const baseWithSlash = baseNormalized.endsWith('/') ? baseNormalized : baseNormalized + '/';
                                    const joined = baseWithSlash + relativePath;
                                    
                                    if (basePathForChildren.match(/^[A-Za-z]:/)) {
                                        resolvedPath = joined.replace(/\//g, '\\');
                                    } else {
                                        resolvedPath = joined;
                                    }
                                }
                                
                                const encodedPath = encodeURIComponent(resolvedPath);
                                const pathResolver = this.pathResolver || window.pathResolver;
                                const baseUrl = (pathResolver && pathResolver.baseUrl) || 
                                               window.location.origin;
                                requestUrl = `${baseUrl}/file?path=${encodedPath}`;
                                console.log('Child: Fixed absolute URL to relative:', {
                                    original: originalChildUrl,
                                    relative: relativePath,
                                    resolved: resolvedPath,
                                    final: requestUrl
                                });
                            }
                            } catch (e) {
                                // Invalid URL, continue to next check
                            }
                        }
                        
                        // Check if this is an absolute path from server root that should be relative to tileset
                        if (requestUrl.startsWith('/') && !requestUrl.startsWith('/file') && !requestUrl.startsWith('/data') && 
                            !requestUrl.startsWith('/Data') &&
                            !requestUrl.startsWith('http://') && !requestUrl.startsWith('https://') && basePathForChildren) {
                            // Remove leading / and treat as relative to tileset
                            let relativePath = requestUrl.substring(1);
                            relativeTailForRetry = relativePath.replace(/\\/g, '/').replace(/^\.\.?\//, '');
                            
                            // Resolve relative to tileset directory
                            let resolvedPath;
                            if (basePathForChildren === '.') {
                                resolvedPath = relativePath;
                            } else {
                                const baseNormalized = basePathForChildren.replace(/\\/g, '/');
                                const baseWithSlash = baseNormalized.endsWith('/') ? baseNormalized : baseNormalized + '/';
                                const joined = baseWithSlash + relativePath;
                                
                                if (basePathForChildren.match(/^[A-Za-z]:/)) {
                                    resolvedPath = joined.replace(/\//g, '\\');
                                } else {
                                    resolvedPath = joined;
                                }
                            }
                            
                            const encodedPath = encodeURIComponent(resolvedPath);
                            const baseUrl = (this.pathResolver && this.pathResolver.baseUrl) || 
                                           (window.pathResolver && window.pathResolver.baseUrl) || 
                                           'http://localhost:8000';
                            requestUrl = `${baseUrl}/file?path=${encodedPath}`;
                        }
                        
                        // Check if this is a URL constructed by Cesium using baseUrl (/file/relative/path)
                        const childFilePathMatch = requestUrl.match(/\/file\/([^?#]+)/);
                        if (childFilePathMatch && !requestUrl.includes('/file?path=') && basePathForChildren) {
                            let relativePath = decodeURIComponent(childFilePathMatch[1]);
                            let relativeNormalized = relativePath.replace(/\\/g, '/');
                            relativeNormalized = relativeNormalized.replace(/^\.\.?\//, '');
                            relativeTailForRetry = relativeNormalized;
                            
                            // Resolve relative to tileset directory
                            let resolvedPath;
                            if (basePathForChildren === '.') {
                                resolvedPath = relativePath;
                            } else {
                                const baseNormalized = basePathForChildren.replace(/\\/g, '/');
                                const baseWithSlash = baseNormalized.endsWith('/') ? baseNormalized : baseNormalized + '/';
                                const joined = baseWithSlash + relativeNormalized;
                                
                                if (basePathForChildren.match(/^[A-Za-z]:/)) {
                                    resolvedPath = joined.replace(/\//g, '\\');
                                } else {
                                    resolvedPath = joined;
                                }
                            }
                            
                            const encodedPath = encodeURIComponent(resolvedPath);
                            const baseUrl = (this.pathResolver && this.pathResolver.baseUrl) || 
                                           (window.pathResolver && window.pathResolver.baseUrl) || 
                                           'http://localhost:8000';
                            requestUrl = `${baseUrl}/file?path=${encodedPath}`;
                        }
                        
                        // If it's a relative URL (not starting with http), resolve it relative to the tileset JSON
                        if (!requestUrl.startsWith('http://') && !requestUrl.startsWith('https://') && !requestUrl.startsWith('data:')) {
                            let relativePath = requestUrl.replace(/^\.\.?\//, '');
                            
                            if (basePathForChildren) {
                                relativePath = relativePath.replace(/\\/g, '/');
                                if (relativePath.startsWith('./')) {
                                    relativePath = relativePath.substring(2);
                                }
                                relativeTailForRetry = relativePath.replace(/^\.\.?\//, '');
                                
                                let resolvedPath;
                                if (basePathForChildren === '.') {
                                    resolvedPath = relativePath;
                                } else {
                                    const baseNormalized = basePathForChildren.replace(/\\/g, '/');
                                    const baseWithSlash = baseNormalized.endsWith('/') ? baseNormalized : baseNormalized + '/';
                                    const joined = baseWithSlash + relativePath;
                                    
                                    if (basePathForChildren.match(/^[A-Za-z]:/)) {
                                        resolvedPath = joined.replace(/\//g, '\\');
                                    } else {
                                        resolvedPath = joined;
                                    }
                                }
                                
                                const encodedPath = encodeURIComponent(resolvedPath);
                                const pathResolver = this.pathResolver || window.pathResolver;
                                const baseUrl = (pathResolver && pathResolver.baseUrl) || 
                                               window.location.origin;
                                requestUrl = `${baseUrl}/file?path=${encodedPath}`;
                            } else {
                                requestUrl = tilesetBaseUrl + requestUrl;
                            }
                        }
                        
                        // Normalize path separators (but preserve in path parameter)
                        if (!requestUrl.includes('/file?path=')) {
                            requestUrl = requestUrl.replace(/\\/g, '/');
                        }
                        
                        // Cache resolved path for future requests
                        this._pathCache.set(originalChildUrl, requestUrl);
                    }
                    
                    // Reduced logging for performance (only first 3 child requests)
                    if (!this._childRequestCount) this._childRequestCount = 0;
                    if (this._childRequestCount < 3) {
                        if (window.logger) {
                            window.logger.debug('Child tile request:', requestUrl);
                        }
                        this._childRequestCount++;
                    }
                    
                    try {
                        const out = await this._loadWithXhrAndDirFallback(
                            requestUrl,
                            requestOptions,
                            jsonDirsSeen,
                            relativeTailForRetry,
                            usedChildBase
                        );
                        this._registerJsonDirectoryFromFileUrl(requestUrl, jsonDirsSeen);
                        return out;
                    } catch (error) {
                        if (window.errorHandler) {
                            window.errorHandler.handle(error, {
                                component: 'TilesetViewer',
                                action: 'loadTile',
                                url: requestUrl
                            }, false);
                        } else if (this._tileRequestCount < 10) {
                            console.error('Tile request failed:', requestUrl, error);
                        }
                        throw error;
                    }
                };
                const baseReqUrl = baseResource.request.url;
                const ReqCtor = baseResource.request.constructor;
                baseResource.request = new ReqCtor({
                    url: baseReqUrl,
                    requestFunction: childTileRequestFunction
                });
                
                // Set baseUrl for child requests
                if (!finalUrlForChildren.includes('/file?path=')) {
                    baseResource.baseUrl = tilesetBaseUrl;
                } else {
                    const baseUrl = (this.pathResolver && this.pathResolver.baseUrl) || 
                                   (window.pathResolver && window.pathResolver.baseUrl) || 
                                   'http://localhost:8001';
                    baseResource.baseUrl = `${baseUrl}/file`;
                }
            }

            // Add to scene
            this.viewer.scene.primitives.add(tileset);

            try {
                if (window.layerRenderingQuality && typeof window.layerRenderingQuality.applyToTileset === 'function') {
                    window.layerRenderingQuality.applyToTileset(tileset);
                }
            } catch (e) {
                /* non-fatal */
            }

            const mergedOptions = {
                ...options,
                maximumScreenSpaceError: tilesetOptions.maximumScreenSpaceError,
                maximumMemoryUsage: tilesetOptions.maximumMemoryUsage
            };

            // SSE + REPLACE/refine flags: single throttled path in scene.postRender (_tilesetSseViewHandler)
            // so pitch/orbit updates during continuous motion; no per-tileset camera.moveEnd (was redundant).
            const cleanupHandlers = () => {};

            // Generate ID and store
            const id = this.generateTilesetId();
            this.tilesets.set(id, {
                id: id,
                tileset: tileset,
                url: url,
                visible: true,
                options: mergedOptions,
                _cleanupHandlers: cleanupHandlers // Store cleanup for later
            });

            this._syncAllTilesetsSseForViewAngle();

            window.dispatchEvent(
                new CustomEvent('tilesetLoaded', {
                    detail: { tileset, id, url }
                })
            );

            const jsonTab = document.getElementById('jsonTab');
            if (
                window.jsonTreeExplorer &&
                jsonTab &&
                jsonTab.classList.contains('active')
            ) {
                const all = Array.from(this.tilesets.values())
                    .map((t) => t.url)
                    .filter(Boolean);
                const p =
                    all.length > 1
                        ? window.jsonTreeExplorer.loadAllFromUrls(all)
                        : all.length === 1
                          ? window.jsonTreeExplorer.loadJSON(all[0])
                          : Promise.resolve();
                p.catch((err) => {
                    console.warn('JSON tree refresh after tileset load:', err);
                });
            }

            // Load tileset JSON configuration (for metadata only, no processing)
            if (window.jsonConfigManager) {
                try {
                    const mergeTilesetDerivedConfig = this.tilesets.size > 1;
                    const resolvedUrl = await this.pathResolver?.resolvePath(url);
                    let tilesetJson = null;
                    if (window.tilesetJsonCache) {
                        tilesetJson =
                            window.tilesetJsonCache.get(url) ||
                            (typeof resolvedUrl === 'string' ? window.tilesetJsonCache.get(resolvedUrl) : null);
                    }
                    if (!tilesetJson && resolvedUrl && typeof resolvedUrl === 'string') {
                        const response = await fetch(resolvedUrl);
                        if (response.ok) tilesetJson = await response.json();
                    }
                    if (tilesetJson) {
                        await window.jsonConfigManager.loadTilesetConfig(tilesetJson, {
                            merge: mergeTilesetDerivedConfig,
                            sourceUrl: url
                        });
                    }
                } catch (error) {
                    console.warn('Failed to load tileset JSON for configuration:', error);
                }
            }

            // Fit to view
            if (options.fitToView !== false) {
                await this.fitToView(id);
            }

            return id;
        } catch (error) {
            console.error('Failed to load tileset:', error);
            throw error;
        }
    }

    /**
     * Remove tileset and clean up GPU resources
     */
    removeTileset(id) {
        const tilesetData = this.tilesets.get(id);
        if (!tilesetData) {
            return false;
        }

        const tileset = tilesetData.tileset;
        
        // Clean up event handlers
        if (tilesetData._cleanupHandlers && typeof tilesetData._cleanupHandlers === 'function') {
            try {
                tilesetData._cleanupHandlers();
            } catch (error) {
                console.warn('Error cleaning up tileset handlers:', error);
            }
        }
        
        // Remove from scene
        this.viewer.scene.primitives.remove(tileset);
        
        // Clean up tileset resources
        if (tileset && typeof tileset.destroy === 'function') {
            try {
                tileset.destroy();
            } catch (error) {
                console.warn('Error destroying tileset:', error);
            }
        }
        
        // Clear reference
        this.tilesets.delete(id);

        if (tilesetData.url && window.tilesetJsonCache) {
            window.tilesetJsonCache.delete(tilesetData.url);
        }
        
        // Clear selected feature if it was from this tileset
        if (this.selectedFeature && this.selectedFeature.tileset === tileset) {
            this.selectedFeature = null;
        }

        const jsonTab = document.getElementById('jsonTab');
        if (
            window.jsonTreeExplorer &&
            jsonTab &&
            jsonTab.classList.contains('active')
        ) {
            const urls = Array.from(this.tilesets.values())
                .map((t) => t.url)
                .filter(Boolean);
            window.jsonTreeExplorer.loadAllFromUrls(urls).catch((err) => {
                console.warn('JSON tree after tileset remove:', err);
            });
        }

        return true;
    }

    /**
     * Clean up all event handlers
     */
    cleanup() {
        // Remove all tracked event handlers
        for (const [key, handlerInfo] of this._eventHandlers.entries()) {
            try {
                if (handlerInfo.type === 'event') {
                    // Cesium event listener
                    handlerInfo.element.removeEventListener(handlerInfo.handler);
                } else {
                    // DOM event listener
                    handlerInfo.element.removeEventListener(handlerInfo.type, handlerInfo.handler);
                }
            } catch (error) {
                console.warn(`Error removing event handler ${key}:`, error);
            }
        }
        this._eventHandlers.clear();
        
        // Cleanup render loop manager
        if (window.renderLoopManager) {
            window.renderLoopManager.cleanup();
        }
        
        // Remove all tilesets
        const tilesetIds = Array.from(this.tilesets.keys());
        tilesetIds.forEach(id => this.removeTileset(id));
        
        // Clear caches
        this._pathCache.clear();
        this._tilesetBasePaths.clear();
        
        // Destroy viewer if it exists
        if (this.viewer && typeof this.viewer.destroy === 'function') {
            try {
                if (this.viewer.scene && this._sceneStatsHandler) {
                    this.viewer.scene.postRender.removeEventListener(this._sceneStatsHandler);
                    this._sceneStatsHandler = null;
                }
                if (this.viewer.scene && this._tilesetSseViewHandler) {
                    this.viewer.scene.postRender.removeEventListener(this._tilesetSseViewHandler);
                    this._tilesetSseViewHandler = null;
                }
                this.viewer.destroy();
            } catch (error) {
                console.warn('Error destroying viewer:', error);
            }
        }
        
        this.viewer = null;
        this._initPromise = null;
    }

    /**
     * Toggle tileset visibility
     */
    toggleTilesetVisibility(id, visible) {
        const tilesetData = this.tilesets.get(id);
        if (!tilesetData) {
            return false;
        }

        tilesetData.tileset.show = visible;
        tilesetData.visible = visible;
        return true;
    }

    /**
     * Fit tileset to view
     */
    async fitToView(id) {
        const tilesetData = this.tilesets.get(id);
        if (!tilesetData) {
            return false;
        }

        try {
            await this.viewer.zoomTo(tilesetData.tileset);
            return true;
        } catch (error) {
            console.error('Failed to fit to view:', error);
            return false;
        }
    }

    /**
     * Handle feature picking with type checking
     */
    handlePick(event) {
        if (!this.viewer) return;

        const canvas = this.viewer.scene.canvas;
        const windowPos =
            typeof window.cesiumPointerToCanvasPixels === 'function'
                ? window.cesiumPointerToCanvasPixels(canvas, event.clientX, event.clientY)
                : new Cesium.Cartesian2(
                      event.clientX - canvas.getBoundingClientRect().left,
                      event.clientY - canvas.getBoundingClientRect().top
                  );
        if (!windowPos) return;

        const pickedObject = this.viewer.scene.pick(windowPos);
        if (!Cesium.defined(pickedObject)) {
            return;
        }

        if (pickedObject instanceof Cesium.Cesium3DTileFeature) {
            this.selectFeature(pickedObject);
            return;
        }

        if (!pickedObject.primitive) {
            return;
        }

        const primitive = pickedObject.primitive;

        if (primitive instanceof Cesium.Cesium3DTileFeature) {
            this.selectFeature(primitive);
        } else if (primitive instanceof Cesium.Cesium3DTileset) {
            return;
        }
    }

    /**
     * Select feature with proper type checking
     */
    selectFeature(feature) {
        const hasIds = feature && typeof feature.getPropertyIds === 'function';
        const hasNames = feature && typeof feature.getPropertyNames === 'function';
        if (!feature || (!hasIds && !hasNames)) {
            console.warn('Invalid feature provided to selectFeature');
            return;
        }

        this.selectedFeature = feature;
        
        // Extract properties (3D Tiles features use getPropertyIds; entities use getPropertyNames)
        const properties = {};
        try {
            const names = hasIds ? feature.getPropertyIds() : feature.getPropertyNames();
            if (Array.isArray(names)) {
                names.forEach(name => {
                    try {
                        properties[name] = feature.getProperty(name);
                    } catch (error) {
                        console.warn(`Error getting property ${name}:`, error);
                    }
                });
            }
        } catch (error) {
            console.warn('Error extracting feature properties:', error);
        }

        // Update metadata display
        if (window.metadataManager) {
            window.metadataManager.displayFeatureMetadata(properties, feature);
        }

        // Update coordinate overlay
        if (feature.position) {
            try {
                const cartographic = Cesium.Cartographic.fromCartesian(feature.position);
                this.showSelectedCoordinate(
                    'Selected Feature',
                    Cesium.Math.toDegrees(cartographic.longitude),
                    Cesium.Math.toDegrees(cartographic.latitude),
                    cartographic.height
                );
            } catch (error) {
                console.warn('Error converting feature position:', error);
            }
        }
    }

    /**
     * Show selected coordinate overlay
     */
    showSelectedCoordinate(name, lon, lat, height) {
        const overlay = document.getElementById('selectedCoordinateOverlay');
        if (!overlay) return;

        document.getElementById('selectedCoordinateName').textContent = name;
        document.getElementById('selectedLon').textContent = lon.toFixed(10);
        document.getElementById('selectedLat').textContent = lat.toFixed(10);
        document.getElementById('selectedHeight').textContent = height.toFixed(2);

        overlay.style.display = 'block';

        // Close button handler
        const closeBtn = document.getElementById('closeCoordinateOverlay');
        if (closeBtn) {
            closeBtn.onclick = () => {
                overlay.style.display = 'none';
            };
        }
    }

    /**
     * Update mouse coordinates
     * Works with both ellipsoid and terrain
     */
    updateMouseCoordinates(event) {
        if (!this.viewer) return;

        const scene = this.viewer.scene;
        const canvas = this.viewer.canvas;

        // Canvas-relative coordinates (accounts for borders / CSS scale vs client size)
        if (!this._mousePosition) {
            this._mousePosition = new Cesium.Cartesian2();
        }
        const mapped =
            typeof window.cesiumPointerToCanvasPixels === 'function'
                ? window.cesiumPointerToCanvasPixels(canvas, event.clientX, event.clientY)
                : null;
        if (!mapped) return;
        this._mousePosition.x = mapped.x;
        this._mousePosition.y = mapped.y;
        
        // Try to pick position on terrain/3D objects first
        let cartesian = null;
        try {
            cartesian = scene.pickPosition(this._mousePosition);
        } catch (error) {
            // Ignore pick errors
        }
        
        // If no 3D position found, fall back to ellipsoid
        if (!cartesian) {
            try {
                cartesian = this.viewer.camera.pickEllipsoid(
                    this._mousePosition,
                    scene.globe.ellipsoid
                );
            } catch (error) {
                // Ignore ellipsoid pick errors
            }
        }

        if (cartesian && cartesian.x !== undefined && cartesian.y !== undefined && cartesian.z !== undefined) {
            try {
                // Reuse cartographic object to reduce allocations
                if (!this._cartographic) {
                    this._cartographic = new Cesium.Cartographic();
                }
                Cesium.Cartographic.fromCartesian(cartesian, this._cartographic);
                
                const lon = Cesium.Math.toDegrees(this._cartographic.longitude);
                const lat = Cesium.Math.toDegrees(this._cartographic.latitude);
                const height = this._cartographic.height;

                this.mouseCoordinates = { lon, lat, height };

                // Update via coordinate manager if available
                if (window.coordinateManager) {
                    window.coordinateManager.updateCoordinates(lon, lat, height);
                } else if (window.app) {
                    window.app.updateMouseCoordinates(lon, lat, height);
                }
            } catch (error) {
                // Ignore coordinate conversion errors
                console.debug('Coordinate conversion error:', error);
            }
        }
    }

    /**
     * Update FPS using actual frame timing
     */
    updateFPS() {
        if (!this.viewer) return;

        const now = performance.now();
        this._fpsFrameCount++;
        
        // Calculate FPS every second
        const elapsed = now - this._fpsLastTime;
        if (elapsed >= 1000) {
            this.fps = Math.round((this._fpsFrameCount * 1000) / elapsed);
            this._fpsFrameCount = 0;
            this._fpsLastTime = now;

            // Update status bar
            if (window.app) {
                window.app.updateFPS(this.fps);
            }
        }
    }

    /**
     * Rotate tileset around specified axis
     * @param {string} id - Tileset ID
     * @param {string} axis - Rotation axis: 'x', 'y', or 'z'
     * @param {number} degrees - Rotation angle in degrees
     * @returns {boolean} Success status
     */
    rotateTileset(id, axis, degrees) {
        const tilesetData = this.tilesets.get(id);
        if (!tilesetData || !tilesetData.tileset) {
            return false;
        }

        const tileset = tilesetData.tileset;
        if (!tileset.root || !tileset.root.transform) {
            console.warn('Tileset root or transform not available');
            return false;
        }

        try {
            // Convert degrees to radians
            const radians = Cesium.Math.toRadians(degrees);
            
            // Get current transform matrix
            const currentMatrix = tileset.root.transform;
            
            // Create rotation matrix based on axis
            let rotationMatrix;
            switch (axis.toLowerCase()) {
                case 'x':
                    rotationMatrix = Cesium.Matrix3.fromRotationX(radians);
                    break;
                case 'y':
                    rotationMatrix = Cesium.Matrix3.fromRotationY(radians);
                    break;
                case 'z':
                    rotationMatrix = Cesium.Matrix3.fromRotationZ(radians);
                    break;
                default:
                    console.warn(`Invalid rotation axis: ${axis}. Use 'x', 'y', or 'z'`);
                    return false;
            }
            
            // Extract translation from current matrix
            const translation = Cesium.Matrix4.getTranslation(currentMatrix, new Cesium.Cartesian3());
            
            // Extract rotation/scale from current matrix
            const currentRotation = Cesium.Matrix4.getMatrix3(currentMatrix, new Cesium.Matrix3());
            
            // Combine rotations
            const combinedRotation = Cesium.Matrix3.multiply(
                rotationMatrix,
                currentRotation,
                new Cesium.Matrix3()
            );
            
            // Create new transform matrix
            const newMatrix = Cesium.Matrix4.fromRotationTranslation(
                combinedRotation,
                translation
            );
            
            // Apply new transform
            tileset.root.transform = newMatrix;
            
            return true;
        } catch (error) {
            console.error('Error rotating tileset:', error);
            return false;
        }
    }

    /**
     * Add offline map layer as primary base layer
     * @private
     * @param {string} baseUrl
     * @param {number[]} zoomLevels
     * @param {string} [dataFolder='tiles'] - `tiles` (standard imagery) or `pro` (aerial), under `/data/{folder}/raster/`
     */
    _addOfflineMapLayer(baseUrl, zoomLevels, dataFolder = 'tiles') {
        try {
            const minZoom = Math.min(...zoomLevels);
            const maxZoom = Math.max(...zoomLevels);
            const folder = dataFolder === 'pro' ? 'pro' : 'tiles';
            const tileUrl = `${baseUrl}/data/${folder}/raster/{z}/{x}/{y}.png`;
            const creditText =
                folder === 'pro'
                    ? 'Offline aerial imagery (data/pro)'
                    : '© OpenStreetMap contributors (Offline — data/tiles)';

            this._offlineRasterDataFolder = folder;

            console.log(`Attempting to add offline map layer from: ${tileUrl}`);

            const offlineMapProvider = new Cesium.UrlTemplateImageryProvider({
                url: tileUrl,
                rectangle: Cesium.Rectangle.MAX_VALUE, // Cover entire globe
                minimumLevel: minZoom,
                maximumLevel: maxZoom,
                credit: creditText,
                enablePickFeatures: false
            });

            // Add offline map tiles as base layer (at index 0, bottom layer)
            const offlineLayer = this.viewer.imageryLayers.addImageryProvider(offlineMapProvider, 0);
            console.log(`✓ Offline map tiles layer added [${folder}] (zoom levels ${minZoom}-${maxZoom})`);
            console.log(`  Tile URL pattern: ${tileUrl}`);
            
            // Store reference for potential updates
            this._offlineMapLayer = offlineLayer;
            this._offlineMapProvider = offlineMapProvider;
            
            // Track tile load errors for diagnostics
            let errorCount = 0;
            let successCount = 0;
            const maxErrorLogs = 5; // Only log first few errors to avoid spam
            
            // Set up error handling for missing tiles
            offlineMapProvider.errorEvent.addEventListener((error) => {
                errorCount++;
                
                // Log first few errors for debugging
                if (errorCount <= maxErrorLogs) {
                    console.warn(`Offline map tile error (${errorCount}/${maxErrorLogs}):`, {
                        message: error?.message,
                        url: error?.target?.url || 'unknown',
                        status: error?.status
                    });
                    
                    if (errorCount === 1) {
                        console.warn('  This might indicate:');
                        console.warn(`  1. Map tiles not installed under data/${folder}/raster/`);
                        console.warn('  2. Server not serving from correct data directory');
                        console.warn('  3. Check server console for DATA_DIR path');
                    }
                }
                
                // After 10 errors, check if any tiles loaded successfully
                if (errorCount === 10 && successCount === 0) {
                    console.error('⚠️  No offline map tiles loaded successfully. Check:');
                    console.error(`  1. Map tiles location: data/${folder}/raster/`);
                    console.error('  2. Server DATA_DIR path (check server console)');
                    console.error('  3. File permissions and accessibility');
                }
            });
            
            // Track successful tile loads - check if readyPromise exists
            if (offlineMapProvider.readyPromise) {
                offlineMapProvider.readyPromise.then(() => {
                    successCount++;
                    if (successCount === 1) {
                        console.log('✓ First offline map tile loaded successfully');
                    }
                }).catch((error) => {
                    if (errorCount === 0) {
                        console.error('Failed to load offline map tiles:', error);
                    }
                });
            }
            
        } catch (error) {
            console.error('Failed to create offline map imagery provider:', error);
            console.error('  Base URL:', baseUrl);
            console.error('  This might indicate a configuration issue');
            // If offline fails, add online fallback
            this._addOnlineFallbackLayer(baseUrl, 0, 19);
        }
    }
    
    /**
     * Load offline map configuration from meta.json (asynchronous, informational)
     * @private
     * @param {string} dataFolder
     */
    async _loadOfflineMapConfig(baseUrl, dataFolder = 'tiles') {
        const folder = dataFolder === 'pro' ? 'pro' : 'tiles';
        try {
            const metaUrl = `${baseUrl}/data/${folder}/meta.json`;
            const response = await fetch(metaUrl);

            if (response.ok) {
                const meta = await response.json();
                if (meta.raster_zooms && Array.isArray(meta.raster_zooms) && meta.raster_zooms.length > 0) {
                    const zooms = meta.raster_zooms.sort((a, b) => a - b);
                    console.log(`✓ Loaded offline map configuration [${folder}] from meta.json:`, meta);
                    console.log(`  Available zoom levels: ${zooms.join(', ')}`);
                }
            }
        } catch (error) {
            console.debug('Could not load meta.json (using defaults):', error.message);
        }
    }
    
    /**
     * Add online OpenStreetMap as fallback layer (only used if offline tiles completely unavailable)
     * @private
     */
    _addOnlineFallbackLayer(baseUrl, minZoom, maxZoom) {
        // Add online OSM as a fallback layer (only if offline completely fails)
        try {
            const osmProvider = new Cesium.UrlTemplateImageryProvider({
                url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                subdomains: ['a', 'b', 'c'],
                rectangle: Cesium.Rectangle.MAX_VALUE,
                credit: '© OpenStreetMap contributors (Online Fallback)',
                minimumLevel: minZoom,
                maximumLevel: Math.max(maxZoom, 19), // Allow higher zoom online
                alpha: 0.0 // Hidden by default - only show if offline fails
            });
            
            const osmLayer = this.viewer.imageryLayers.addImageryProvider(osmProvider);
            this._onlineFallbackLayer = osmLayer;
            console.log('Online OpenStreetMap fallback layer added (hidden, only shows if offline fails)');
            
        } catch (error) {
            console.warn('Failed to create online OpenStreetMap fallback:', error);
            // Try simple URL without subdomains
            try {
                const osmProviderSimple = new Cesium.UrlTemplateImageryProvider({
                    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                    rectangle: Cesium.Rectangle.MAX_VALUE,
                    credit: '© OpenStreetMap contributors (Online Fallback)',
                    minimumLevel: minZoom,
                    maximumLevel: Math.max(maxZoom, 19),
                    alpha: 0.0
                });
                this.viewer.imageryLayers.addImageryProvider(osmProviderSimple);
                console.log('Online OpenStreetMap fallback layer added (simple URL, hidden)');
            } catch (error2) {
                console.error('Failed to add online fallback layer:', error2);
            }
        }
    }

    /**
     * Generate tileset ID
     */
    generateTilesetId() {
        return `tileset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get all tilesets
     */
    getAllTilesets() {
        return Array.from(this.tilesets.values());
    }
}

// Export singleton instance
window.tilesetViewer = new TilesetViewer();
// Initialize asynchronously - callers should await tilesetViewer.init()
window.tilesetViewer.init().catch(error => {
    console.error('Failed to initialize TilesetViewer:', error);
});
