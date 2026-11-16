/**
 * JSONConfigManager
 * Manages JSON-driven configuration for the entire application
 * Reads configuration from JSON files and makes it available to all components
 */

class JSONConfigManager {
    constructor() {
        this.configs = new Map();
        this.tilesetConfig = null;
        this.toolConfigs = new Map();
        this.featureConfigs = new Map();
        this.uiConfigs = new Map();
        this.initialized = false;
        this._initPromise = null; // Track initialization promise
    }

    /**
     * Default Smart3D optional-tools shape for window.t (cursor_master_prompt.md Section C;
     * Map_Toolbar_Complete_Spec.md Part A.2 SceneModes / Tools).
     * @returns {Object}
     */
    getDefaultOptionalToolsT() {
        const sceneIds = [
            'transparency',
            'fog',
            'white',
            'slope',
            'height',
            'distance',
            'direction',
            'snow',
            'rain',
            'clouds',
            'ortho',
            'remapColors'
        ];
        const toolKeys = [
            'layersIC',
            'view_home',
            'history',
            'navNorth',
            'topView',
            'share',
            'printscreen',
            'elevationProfile',
            'streetview',
            'flightmode',
            'clipplane',
            'split',
            'special_effects'
        ];
        const SceneModes = {};
        sceneIds.forEach((id) => {
            SceneModes[id] = { Show: true, Active: true };
        });
        SceneModes.rain.density = 0.0012;
        SceneModes.rain.minimumBrightness = 0.45;
        /** Semi-transparent tile overlay: 0.05–1.0 (user / Project.Optional_tools.SceneModes.transparency.alpha). */
        SceneModes.transparency.alpha = 0.45;
        SceneModes.fog.density = 0.0004;
        SceneModes.fog.minimumBrightness = 0.35;
        SceneModes.distance.density = 0.0025;
        SceneModes.height.heightDivisor = 200;
        SceneModes.remapColors.heightDivisor = 25;
        SceneModes.ortho.orthoWidthFactor = 0.35;
        SceneModes.slope.thresholdDeg1 = 15;
        SceneModes.slope.thresholdDeg2 = 30;
        SceneModes.slope.thresholdDeg3 = 45;
        SceneModes.slope.gridSamples = 20;
        SceneModes.snow.density = 0.0018;
        SceneModes.snow.minimumBrightness = 0.65;
        const Tools = {};
        toolKeys.forEach((k) => {
            Tools[k] = { Show: true, Active: true };
        });
        return {
            Measure: { Show: true, Active: true },
            LOS: { Show: true, Active: true },
            Viewshed: { Show: true, Active: true },
            SceneModes,
            Tools,
            SceneTuning: {
                imageryContrast: 1,
                imageryBrightness: 1
            }
        };
    }

    /**
     * Coerce API 0/1 or boolean to boolean.
     * @private
     */
    _coerceBool(v, defaultVal = true) {
        if (v === undefined || v === null) return defaultVal;
        if (typeof v === 'boolean') return v;
        if (typeof v === 'number') return v !== 0;
        if (typeof v === 'string') {
            const s = v.trim().toLowerCase();
            if (s === '0' || s === 'false' || s === 'no') return false;
            if (s === '1' || s === 'true' || s === 'yes') return true;
        }
        return !!v;
    }

    /**
     * Merge Project.Optional_tools (or equivalent keys) into the Section C `t` object.
     * @private
     * @param {*} raw — subtree from Project.Optional_tools
     * @returns {Object}
     */
    _optionalToolsRawToT(raw) {
        const out = this.getDefaultOptionalToolsT();
        if (!raw || typeof raw !== 'object') {
            return out;
        }
        const m = raw.Measure || raw.measure;
        const los = raw.LOS || raw.los || raw.LineOfSight || raw.lineOfSight;
        const vs = raw.Viewshed || raw.viewshed;
        if (m && typeof m === 'object') {
            out.Measure = {
                Show: this._coerceBool(m.Show, out.Measure.Show),
                Active: this._coerceBool(m.Active, out.Measure.Active)
            };
        }
        if (los && typeof los === 'object') {
            out.LOS = {
                Show: this._coerceBool(los.Show, out.LOS.Show),
                Active: this._coerceBool(los.Active, out.LOS.Active)
            };
        }
        if (vs && typeof vs === 'object') {
            out.Viewshed = {
                Show: this._coerceBool(vs.Show, out.Viewshed.Show),
                Active: this._coerceBool(vs.Active, out.Viewshed.Active)
            };
        }

        const smRaw = raw.SceneModes || raw.sceneModes;
        if (smRaw && typeof smRaw === 'object') {
            Object.keys(smRaw).forEach((id) => {
                const o = smRaw[id];
                if (!o || typeof o !== 'object') return;
                const base = out.SceneModes[id] || { Show: true, Active: true };
                const merged = {
                    Show: this._coerceBool(o.Show, base.Show),
                    Active: this._coerceBool(o.Active, base.Active)
                };
                if (id === 'transparency') {
                    const defA = typeof base.alpha === 'number' && !Number.isNaN(base.alpha) ? base.alpha : 0.45;
                    const rawA = typeof o.alpha === 'number' && !Number.isNaN(o.alpha) ? o.alpha : defA;
                    merged.alpha = Math.min(1, Math.max(0.05, rawA));
                }
                if (id === 'fog') {
                    const defD = typeof base.density === 'number' ? base.density : 0.0004;
                    const defB = typeof base.minimumBrightness === 'number' ? base.minimumBrightness : 0.35;
                    merged.density =
                        typeof o.density === 'number' && !Number.isNaN(o.density)
                            ? Math.min(0.01, Math.max(0.00001, o.density))
                            : defD;
                    merged.minimumBrightness =
                        typeof o.minimumBrightness === 'number' && !Number.isNaN(o.minimumBrightness)
                            ? Math.min(1, Math.max(0, o.minimumBrightness))
                            : defB;
                }
                if (id === 'distance') {
                    const defD = typeof base.density === 'number' ? base.density : 0.0025;
                    merged.density =
                        typeof o.density === 'number' && !Number.isNaN(o.density)
                            ? Math.min(0.02, Math.max(0.0001, o.density))
                            : defD;
                }
                if (id === 'height') {
                    const defH = typeof base.heightDivisor === 'number' ? base.heightDivisor : 200;
                    merged.heightDivisor =
                        typeof o.heightDivisor === 'number' && !Number.isNaN(o.heightDivisor)
                            ? Math.min(5000, Math.max(1, o.heightDivisor))
                            : defH;
                }
                if (id === 'remapColors') {
                    const defH = typeof base.heightDivisor === 'number' ? base.heightDivisor : 25;
                    merged.heightDivisor =
                        typeof o.heightDivisor === 'number' && !Number.isNaN(o.heightDivisor)
                            ? Math.min(5000, Math.max(1, o.heightDivisor))
                            : defH;
                }
                if (id === 'ortho') {
                    const defW = typeof base.orthoWidthFactor === 'number' ? base.orthoWidthFactor : 0.35;
                    merged.orthoWidthFactor =
                        typeof o.orthoWidthFactor === 'number' && !Number.isNaN(o.orthoWidthFactor)
                            ? Math.min(2, Math.max(0.05, o.orthoWidthFactor))
                            : defW;
                }
                if (id === 'slope') {
                    const pick = (v, def, lo, hi) => {
                        const n = typeof v === 'number' && !Number.isNaN(v) ? v : def;
                        return Math.min(hi, Math.max(lo, n));
                    };
                    const d1 = pick(o.thresholdDeg1, base.thresholdDeg1 ?? 15, 1, 89);
                    const d2 = pick(o.thresholdDeg2, base.thresholdDeg2 ?? 30, 1, 89);
                    const d3 = pick(o.thresholdDeg3, base.thresholdDeg3 ?? 45, 1, 89);
                    const sorted = [d1, d2, d3].sort((a, b) => a - b);
                    merged.thresholdDeg1 = sorted[0];
                    merged.thresholdDeg2 = sorted[1];
                    merged.thresholdDeg3 = sorted[2];
                    merged.gridSamples =
                        typeof o.gridSamples === 'number' && !Number.isNaN(o.gridSamples)
                            ? Math.min(80, Math.max(6, Math.round(o.gridSamples)))
                            : pick(base.gridSamples, 20, 6, 80);
                }
                if (id === 'snow') {
                    const defD = typeof base.density === 'number' ? base.density : 0.0018;
                    const defB = typeof base.minimumBrightness === 'number' ? base.minimumBrightness : 0.65;
                    merged.density =
                        typeof o.density === 'number' && !Number.isNaN(o.density)
                            ? Math.min(0.02, Math.max(0.0001, o.density))
                            : defD;
                    merged.minimumBrightness =
                        typeof o.minimumBrightness === 'number' && !Number.isNaN(o.minimumBrightness)
                            ? Math.min(1, Math.max(0, o.minimumBrightness))
                            : defB;
                }
                if (id === 'rain') {
                    const defD = typeof base.density === 'number' ? base.density : 0.0012;
                    const defB = typeof base.minimumBrightness === 'number' ? base.minimumBrightness : 0.45;
                    merged.density =
                        typeof o.density === 'number' && !Number.isNaN(o.density)
                            ? Math.min(0.02, Math.max(0.0001, o.density))
                            : defD;
                    merged.minimumBrightness =
                        typeof o.minimumBrightness === 'number' && !Number.isNaN(o.minimumBrightness)
                            ? Math.min(1, Math.max(0, o.minimumBrightness))
                            : defB;
                }
                out.SceneModes[id] = merged;
            });
        }

        const tuneRaw = raw.SceneTuning || raw.sceneTuning;
        if (tuneRaw && typeof tuneRaw === 'object') {
            const baseT = out.SceneTuning || { imageryContrast: 1, imageryBrightness: 1 };
            const c =
                typeof tuneRaw.imageryContrast === 'number' && !Number.isNaN(tuneRaw.imageryContrast)
                    ? Math.min(3, Math.max(0.2, tuneRaw.imageryContrast))
                    : baseT.imageryContrast;
            const br =
                typeof tuneRaw.imageryBrightness === 'number' && !Number.isNaN(tuneRaw.imageryBrightness)
                    ? Math.min(3, Math.max(0.2, tuneRaw.imageryBrightness))
                    : baseT.imageryBrightness;
            out.SceneTuning = { imageryContrast: c, imageryBrightness: br };
        }

        const toolsRaw = raw.Tools || raw.tools;
        if (toolsRaw && typeof toolsRaw === 'object') {
            Object.keys(toolsRaw).forEach((key) => {
                const o = toolsRaw[key];
                if (!o || typeof o !== 'object') return;
                const base = out.Tools[key] || { Show: true, Active: true };
                out.Tools[key] = {
                    Show: this._coerceBool(o.Show, base.Show),
                    Active: this._coerceBool(o.Active, base.Active)
                };
            });
        }

        return out;
    }

    /**
     * Merge a partial `t` object into defaults (same rules as Project.Optional_tools).
     * Use when `window.t` was created before SceneModes/Tools existed.
     * @param {Object|null} partial
     * @returns {Object}
     */
    mergeOptionalToolsTIntoDefaults(partial) {
        return this._optionalToolsRawToT(partial && typeof partial === 'object' ? partial : {});
    }

    /**
     * Read Project.Optional_tools from tileset JSON or merged app config and assign window.t.
     * Tileset root wins over app when both define Optional_tools.
     * @param {Object|null} tilesetJson — full tileset document (may include Project)
     */
    syncWindowTFromProjectOptionalTools(tilesetJson = null) {
        const app = this.configs.get('app');
        const fromTileset =
            tilesetJson &&
            tilesetJson.Project &&
            tilesetJson.Project.Optional_tools;
        const fromApp = app && app.Project && app.Project.Optional_tools;
        const baseRaw = fromTileset || fromApp;
        let mergedRaw =
            baseRaw && typeof baseRaw === 'object' ? { ...baseRaw } : {};
        const stored = this._readRuntimeOverrides();
        if (stored && stored.optionalToolsPatch && typeof stored.optionalToolsPatch === 'object') {
            mergedRaw = this._deepMergeOptionalToolsRaw(mergedRaw, stored.optionalToolsPatch);
        }
        window.t = this._optionalToolsRawToT(mergedRaw);
        try {
            window.dispatchEvent(
                new CustomEvent('smart3dOptionalToolsUpdated', {
                    detail: {
                        t: window.t,
                        source: fromTileset ? 'tileset' : fromApp ? 'app' : 'default'
                    }
                })
            );
        } catch (e) {
            /* ignore */
        }
    }

    /**
     * localStorage key for Control Center / runtime UI overrides (app, optional tools, linked prefs).
     */
    static get RUNTIME_OVERRIDES_STORAGE_KEY() {
        return 'simplex_runtime_overrides_v1';
    }

    /**
     * @returns {Object|null}
     */
    _readRuntimeOverrides() {
        try {
            const s = localStorage.getItem(JSONConfigManager.RUNTIME_OVERRIDES_STORAGE_KEY);
            if (!s) return null;
            const o = JSON.parse(s);
            return o && typeof o === 'object' ? o : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Merge Optional_tools-shaped objects (Measure/LOS/Viewshed, SceneModes[id], Tools[key]).
     * @private
     */
    _deepMergeOptionalToolsRaw(a, b) {
        if (!a || typeof a !== 'object') a = {};
        if (!b || typeof b !== 'object') return { ...a };
        const out = { ...a, ...b };
        ['Measure', 'LOS', 'Viewshed'].forEach((k) => {
            if (a[k] && b[k] && typeof a[k] === 'object' && typeof b[k] === 'object') {
                out[k] = { ...a[k], ...b[k] };
            }
        });
        out.SceneModes = { ...(a.SceneModes || {}) };
        const sm = b.SceneModes || {};
        Object.keys(sm).forEach((id) => {
            out.SceneModes[id] = {
                ...(a.SceneModes && a.SceneModes[id] ? a.SceneModes[id] : {}),
                ...sm[id]
            };
        });
        out.Tools = { ...(a.Tools || {}) };
        const tk = b.Tools || {};
        Object.keys(tk).forEach((key) => {
            out.Tools[key] = {
                ...(a.Tools && a.Tools[key] ? a.Tools[key] : {}),
                ...tk[key]
            };
        });
        if (a.SceneTuning && b.SceneTuning && typeof a.SceneTuning === 'object' && typeof b.SceneTuning === 'object') {
            out.SceneTuning = { ...a.SceneTuning, ...b.SceneTuning };
        } else if (b.SceneTuning && typeof b.SceneTuning === 'object') {
            out.SceneTuning = { ...(a.SceneTuning || {}), ...b.SceneTuning };
        }
        return out;
    }

    /**
     * Deep-merge plain objects; arrays and non-objects are taken from `patch` when defined.
     * @private
     */
    _deepMergePlain(base, patch) {
        if (!patch || typeof patch !== 'object') return base;
        if (!base || typeof base !== 'object') return patch;
        const out = Array.isArray(base) ? [...base] : { ...base };
        Object.keys(patch).forEach((k) => {
            const pv = patch[k];
            const bv = base[k];
            if (
                pv !== null &&
                typeof pv === 'object' &&
                !Array.isArray(pv) &&
                bv !== null &&
                typeof bv === 'object' &&
                !Array.isArray(bv)
            ) {
                out[k] = this._deepMergePlain(bv, pv);
            } else {
                out[k] = pv;
            }
        });
        return out;
    }

    /**
     * Apply persisted Control Center state after app config is loaded (and optional tileset sync).
     * Merges saved app snapshot, mirrors prefs into localStorage, refreshes window.t and performance.
     */
    applyRuntimeOverridesFromStorage() {
        const stored = this._readRuntimeOverrides();
        if (!stored || typeof stored !== 'object') {
            this.applyPerformanceRuntime();
            try {
                window.dispatchEvent(
                    new CustomEvent('jsonConfigUpdated', { detail: { configManager: this } })
                );
            } catch (e) {
                /* ignore */
            }
            return;
        }
        if (stored.appConfig && typeof stored.appConfig === 'object') {
            this.configs.set('app', this.mergeAppConfigWithDefaults(stored.appConfig));
        }
        if (stored.appSettings && typeof stored.appSettings === 'object') {
            try {
                localStorage.setItem('appSettings', JSON.stringify(stored.appSettings));
            } catch (e) {
                /* ignore */
            }
        }
        if (stored.platformControls && typeof stored.platformControls === 'object') {
            try {
                localStorage.setItem('platformControlsSettings', JSON.stringify(stored.platformControls));
            } catch (e) {
                /* ignore */
            }
        }
        if (stored.simSensorConfig && typeof stored.simSensorConfig === 'object') {
            try {
                localStorage.setItem('simSensorConfig', JSON.stringify(stored.simSensorConfig));
            } catch (e) {
                /* ignore */
            }
        }
        this.syncWindowTFromProjectOptionalTools(this.tilesetConfig);
        this.applyPerformanceRuntime();
        try {
            window.dispatchEvent(
                new CustomEvent('jsonConfigUpdated', { detail: { configManager: this } })
            );
        } catch (e) {
            /* ignore */
        }
    }

    /**
     * Persist Control Center payload (full or partial — omit keys to leave prior values on next save).
     */
    saveRuntimeOverridesToStorage(payload) {
        const prev = this._readRuntimeOverrides() || {};
        const next = this._deepMergePlain(prev, payload || {});
        try {
            localStorage.setItem(JSONConfigManager.RUNTIME_OVERRIDES_STORAGE_KEY, JSON.stringify(next));
        } catch (e) {
            console.warn('saveRuntimeOverridesToStorage failed', e);
        }
    }

    /**
     * Clear runtime overrides and re-apply config from files/defaults (page reload recommended for full reset).
     */
    clearRuntimeOverridesStorage() {
        try {
            localStorage.removeItem(JSONConfigManager.RUNTIME_OVERRIDES_STORAGE_KEY);
        } catch (e) {
            /* ignore */
        }
    }

    /**
     * Build Optional_tools-shaped raw object from current `window.t` (for Control Center export/save).
     * @param {Object} t — same shape as getDefaultOptionalToolsT()
     * @returns {Object}
     */
    optionalToolsRawFromWindowT(t) {
        const src = t && typeof t === 'object' ? t : this.getDefaultOptionalToolsT();
        const raw = {};
        raw.Measure = src.Measure ? { ...src.Measure } : { Show: true, Active: true };
        raw.LOS = src.LOS ? { ...src.LOS } : { Show: true, Active: true };
        raw.Viewshed = src.Viewshed ? { ...src.Viewshed } : { Show: true, Active: true };
        raw.SceneModes = {};
        if (src.SceneModes) {
            Object.keys(src.SceneModes).forEach((id) => {
                raw.SceneModes[id] = { ...src.SceneModes[id] };
            });
        }
        raw.Tools = {};
        if (src.Tools) {
            Object.keys(src.Tools).forEach((k) => {
                raw.Tools[k] = { ...src.Tools[k] };
            });
        }
        raw.SceneTuning = src.SceneTuning
            ? { ...src.SceneTuning }
            : { imageryContrast: 1, imageryBrightness: 1 };
        return raw;
    }

    /**
     * Initialize JSON Config Manager
     * @returns {Promise<void>} Promise that resolves when initialization is complete
     */
    async init() {
        // Return existing promise if already initializing
        if (this._initPromise) {
            return this._initPromise;
        }

        // Return immediately if already initialized
        if (this.initialized) {
            return Promise.resolve();
        }

        // Create and store the promise
        this._initPromise = this._doInit();
        
        try {
            await this._initPromise;
        } finally {
            this._initPromise = null;
        }
    }

    /**
     * Internal initialization method
     * @private
     */
    async _doInit() {
        // Load default configuration
        await this.loadDefaultConfig();
        
        // Load tileset-specific configuration if available
        await this.loadTilesetConfig();
        
        this.initialized = true;
        this.applyRuntimeOverridesFromStorage();
        console.log('JSONConfigManager initialized');
    }

    /**
     * Load default configuration
     */
    async loadDefaultConfig() {
        try {
            // Try to load from config file (optional)
            const configPath = 'config/app-config.json';
            const configLoaded = await this._tryLoadConfigFile(configPath);

            if (!configLoaded) {
                const defaultConfig = this.getDefaultConfig();
                this.configs.set('app', defaultConfig);
                console.log('Using default configuration');
            } else {
                const merged = this.mergeAppConfigWithDefaults(this.configs.get('app'));
                this.configs.set('app', merged);
            }
        } catch (error) {
            console.warn('Failed to load default config, using defaults:', error);
            const defaultConfig = this.getDefaultConfig();
            this.configs.set('app', defaultConfig);
        }
        this.syncWindowTFromProjectOptionalTools(null);
    }

    /**
     * Try to load configuration file
     * @private
     * @param {string} configPath - Path to config file
     * @returns {Promise<boolean>} True if config was loaded, false otherwise
     */
    async _tryLoadConfigFile(configPath) {
        // Check if pathResolver is available and initialized
        if (!this._isPathResolverReady()) {
            console.log('PathResolver not ready, using default config');
            return false;
        }

        try {
            const resolvedPath = await window.pathResolver.resolvePath(configPath);
            
            // Validate resolved path
            if (!this._isValidResolvedPath(resolvedPath)) {
                return false;
            }

            const response = await fetch(resolvedPath);
            if (!response.ok) {
                // Silently return false for 404s - config file is optional
                return false;
            }

            const config = await response.json();
            this.configs.set('app', config);
            console.log('Loaded app configuration from:', resolvedPath);
            return true;
        } catch (e) {
            // Config file doesn't exist or pathResolver not ready, use defaults
            // This is expected and not an error - silently fail
            return false;
        }
    }

    /**
     * Check if pathResolver is ready
     * @private
     * @returns {boolean}
     */
    _isPathResolverReady() {
        return window.pathResolver && 
               typeof window.pathResolver.resolvePath === 'function' && 
               window.pathResolver.baseUrl;
    }

    /**
     * Validate resolved path
     * @private
     * @param {*} resolvedPath - Resolved path to validate
     * @returns {boolean}
     */
    _isValidResolvedPath(resolvedPath) {
        return resolvedPath && 
               typeof resolvedPath === 'string' && 
               !resolvedPath.includes('/null/') && 
               resolvedPath !== 'null' && 
               resolvedPath.startsWith('http');
    }

    /**
     * Get default configuration structure
     */
    getDefaultConfig() {
        return {
            tools: {
                enabled: true,
                items: [
                    { id: 'toolHome', icon: '🏠', label: 'Home', enabled: true, action: 'home' },
                    { id: 'toolBack', icon: '◀', label: 'Back', enabled: true, action: 'back' },
                    { id: 'toolForward', icon: '▶', label: 'Forward', enabled: true, action: 'forward' },
                    { id: 'toolNorth', icon: 'N', label: 'Point to North', enabled: true, action: 'north' },
                    { id: 'toolTopView', icon: '⬆', label: 'Top View', enabled: true, action: 'topView' },
                    { id: 'toolFlyAround', icon: '✈', label: 'Fly Around', enabled: true, action: 'flyAround' },
                    { id: 'toolMeasure', icon: '📏', label: 'Measure', enabled: true, action: 'measure' },
                    { id: 'toolScreenshot', icon: '📷', label: 'Screenshot', enabled: true, action: 'screenshot' },
                    { id: 'toolShare', icon: '🔗', label: 'Share Location', enabled: true, action: 'share' },
                    { id: 'toolBookmarks', icon: '🔖', label: 'Bookmarks', enabled: true, action: 'bookmarks' },
                    { id: 'toolSearch', icon: '🔍', label: 'Search', enabled: true, action: 'search' },
                    { id: 'toolModelsMap', icon: '🗺️', label: 'Models Map', enabled: true, action: 'modelsMap' },
                    { id: 'toolLayers', icon: '📑', label: 'Layers Menu', enabled: true, action: 'layers' },
                    { id: 'toolShadeAnalysis', icon: '☀️', label: 'Shade Analysis', enabled: true, action: 'shadeAnalysis' },
                    { id: 'toolLineOfSight', icon: '👁️', label: 'Line of Sight', enabled: true, action: 'lineOfSight' },
                    { id: 'toolVisibleHidden', icon: '👁️', label: 'View Range', enabled: true, action: 'visibleHidden' },
                    { id: 'toolStreetView', icon: '🚶', label: 'Street View', enabled: true, action: 'streetView' },
                    { id: 'toolCutPolygon', icon: '✂️', label: 'Cut by Polygon', enabled: true, action: 'cutPolygon' },
                    { id: 'toolSplitScreen', icon: '⛶', label: 'Split Screen', enabled: true, action: 'splitScreen' },
                    { id: 'toolDisplayModes', icon: '🎨', label: 'Display Modes', enabled: true, action: 'displayModes' },
                    { id: 'toolFlightMode', icon: '🦸', label: 'Flight Mode', enabled: true, action: 'flightMode' },
                    { id: 'toolObliqueViews', icon: '📸', label: 'Oblique Views', enabled: true, action: 'obliqueViews' },
                    { id: 'toolModelUpload', icon: '⬆️', label: 'Upload Models & Layers', enabled: true, action: 'modelUpload' },
                    { id: 'toolMapLabels', icon: '🏷️', label: 'Map labels (offline)', enabled: true, action: 'mapLabels' }
                ]
            },
            features: {
                measurement: {
                    enabled: true,
                    accuracy: 0.1, // 10 centimeters
                    requireZoom: true
                },
                navigation: {
                    enabled: true,
                    historySize: 50,
                    autoSave: true
                },
                layers: {
                    enabled: true,
                    defaultVisible: ['background', '3d'],
                    defaultHidden: ['streets', 'house-number', 'blocks', 'parcels', 'land-uses']
                },
                /** Optional shared-workspace backend; line-of-sight to Control Center. */
                collaboration: {
                    enabled: false,
                    backendUrl: ''
                }
            },
            /**
             * Per-module runtime init gates (index.html init queue). Toolbar wireup is not gated here.
             * @type {Object<string, { enabled: boolean }>}
             */
            modules: {
                searchManager: { enabled: true },
                modelsMapManager: { enabled: true },
                shareLocationManager: { enabled: true },
                layersMenuManager: { enabled: true },
                shadeAnalysisManager: { enabled: true },
                coordinateResearchManager: { enabled: true },
                splitScreenManager: { enabled: true },
                streetViewManager: { enabled: true },
                simVisualToolsBridge: { enabled: true },
                simIntegrationManager: { enabled: true },
                projectManager: { enabled: true },
                geoprocessingUI: { enabled: true },
                offlineStatusUI: { enabled: true },
                tileInspectorUI: { enabled: true },
                bookmarkManager: { enabled: true },
                screenshotManager: { enabled: true },
                enhancedMeasurementManager: { enabled: true },
                lineOfSightManager: { enabled: true },
                visibleHiddenAreasManager: { enabled: true },
                cutByPolygonManager: { enabled: true },
                displayModesManager: { enabled: true },
                supermanFlightModeManager: { enabled: true },
                obliqueViewsManager: { enabled: true },
                modelAndLayerUploadManager: { enabled: true },
                coordinateManager: { enabled: true },
                featureInteractionManager: { enabled: true },
                labelManager: { enabled: true }
            },
            ui: {
                sidebars: {
                    left: { defaultCollapsed: true },
                    right: { defaultCollapsed: true },
                    /** false = full bottom map tool strip visible on load */
                    tools: { defaultCollapsed: false }
                },
                /** Top bar buttons in index.html (Control Center can hide chrome). */
                chrome: {
                    showNavigationHelp: true,
                    showDatabase: true,
                    showDashboard: true,
                    showDirections: true,
                    showHelp: true
                },
                theme: 'dark',
                language: 'en'
            },
            /**
             * Runtime performance tuning (user-editable via app-config.json).
             * Values align with common RAIL / Core Web Vitals guidance (keep main-thread work chunked).
             */
            performance: {
                renderLoopFrameBudgetMs: 8,
                idleCallbackTimeoutMs: 2000,
                deferredInitYieldMs: 10,
                /** Parallel HTTP requests per origin (localhost tile server); higher = faster tile streaming */
                maximumRequestsPerServer: 18,
                /** Cap for viewer.resolutionScale vs devicePixelRatio (sharpness on HiDPI) */
                viewerResolutionScaleMax: 2,
                /** false = use resolutionScale for crisp rendering; true = browser default (often softer) */
                useBrowserRecommendedResolution: false
            },
            /**
             * Vector GIS + 3D Tiles presentation (layers, Baana-style tilesets). Merged with app-config.json.
             */
            layerRendering: {
                enabled: true,
                /** Cap maximumScreenSpaceError for any Cesium3DTileset (lower = more detail); min() with existing */
                tilesetMaximumScreenSpaceError: 8,
                /** When true, may enable dynamicScreenSpaceError on tilesets that support it */
                enableDynamicScreenSpaceError: false,
                /** Geodesic polyline subdivision (degrees); smaller = smoother curves, more GPU work */
                polylineGranularityDeg: 0.1,
                fxaa: true,
                depthTestAgainstTerrain: true,
                /** Draw vector points on top of terrain/buildings (always visible) */
                vectorPointsAlwaysOnTop: false,
                /** Optional override for RequestScheduler (omit to use performance.maximumRequestsPerServer) */
                maximumRequestsPerServer: null
            }
        };
    }

    /**
     * Merge loaded app config with defaults so partial JSON files stay valid.
     * @param {Object|null} loaded
     * @returns {Object}
     */
    mergeAppConfigWithDefaults(loaded) {
        const d = this.getDefaultConfig();
        if (!loaded || typeof loaded !== 'object') return d;
        const f = { ...d.features, ...loaded.features };
        if (d.features.measurement || loaded.features?.measurement) {
            f.measurement = { ...d.features.measurement, ...loaded.features?.measurement };
        }
        if (d.features.navigation || loaded.features?.navigation) {
            f.navigation = { ...d.features.navigation, ...loaded.features?.navigation };
        }
        if (d.features.layers || loaded.features?.layers) {
            f.layers = { ...d.features.layers, ...loaded.features?.layers };
        }
        if (d.features.collaboration || loaded.features?.collaboration) {
            f.collaboration = { ...d.features.collaboration, ...loaded.features?.collaboration };
        }
        const modules = this._mergeModulesObject(d.modules, loaded.modules);
        const ui = { ...d.ui, ...loaded.ui };
        if (d.ui.sidebars || loaded.ui?.sidebars) {
            const dl = d.ui.sidebars || {};
            const ul = loaded.ui?.sidebars || {};
            ui.sidebars = {
                left: { ...dl.left, ...ul.left },
                right: { ...dl.right, ...ul.right },
                tools: { ...dl.tools, ...ul.tools }
            };
        }
        if (d.ui.chrome || loaded.ui?.chrome) {
            ui.chrome = { ...d.ui.chrome, ...loaded.ui?.chrome };
        }
        const performance = this._mergePerformanceObject(d.performance, loaded.performance);
        const layerRendering = { ...d.layerRendering, ...(loaded.layerRendering || {}) };
        return {
            ...d,
            ...loaded,
            tools: { ...d.tools, ...loaded.tools },
            features: f,
            modules,
            ui,
            performance,
            layerRendering
        };
    }

    /**
     * Merge runtime module gates: each key is `{ enabled: boolean }` plus optional future fields.
     * @private
     */
    _mergeModulesObject(defaults, user) {
        const d = defaults && typeof defaults === 'object' ? defaults : {};
        const u = user && typeof user === 'object' ? user : {};
        const out = {};
        const keys = new Set([...Object.keys(d), ...Object.keys(u)]);
        keys.forEach((key) => {
            const base = d[key] && typeof d[key] === 'object' ? d[key] : { enabled: true };
            const patch = u[key] && typeof u[key] === 'object' ? u[key] : {};
            out[key] = { ...base, ...patch };
            if (typeof out[key].enabled !== 'boolean') {
                out[key].enabled = true;
            }
        });
        return out;
    }

    /**
     * @private
     */
    _mergePerformanceObject(base, user) {
        const b = base && typeof base === 'object' ? base : this.getDefaultConfig().performance;
        const u = user && typeof user === 'object' ? user : {};
        const clamp = (v, min, max, fallback) => {
            const n = typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
            return Math.min(max, Math.max(min, n));
        };
        return {
            renderLoopFrameBudgetMs: clamp(u.renderLoopFrameBudgetMs, 1, 16, b.renderLoopFrameBudgetMs),
            idleCallbackTimeoutMs: clamp(u.idleCallbackTimeoutMs, 100, 10000, b.idleCallbackTimeoutMs),
            deferredInitYieldMs: clamp(u.deferredInitYieldMs, 0, 100, b.deferredInitYieldMs),
            maximumRequestsPerServer: clamp(
                u.maximumRequestsPerServer,
                6,
                64,
                b.maximumRequestsPerServer
            ),
            viewerResolutionScaleMax: clamp(
                u.viewerResolutionScaleMax,
                0.5,
                2.5,
                b.viewerResolutionScaleMax
            ),
            useBrowserRecommendedResolution:
                typeof u.useBrowserRecommendedResolution === 'boolean'
                    ? u.useBrowserRecommendedResolution
                    : b.useBrowserRecommendedResolution
        };
    }

    /**
     * Resolved performance settings (defaults + app-config.json).
     * @returns {object} performance block including display throughput fields
     */
    getPerformanceSettings() {
        const app = this.configs.get('app');
        const merged = app ? this.mergeAppConfigWithDefaults(app) : this.getDefaultConfig();
        return this._mergePerformanceObject(this.getDefaultConfig().performance, merged.performance);
    }

    /**
     * Expose settings for non-module code; refresh render loop if already running.
     */
    applyPerformanceRuntime() {
        const p = this.getPerformanceSettings();
        if (typeof window !== 'undefined') {
            window.__simplexPerformance = p;
        }
        if (window.renderLoopManager && typeof window.renderLoopManager.setFrameBudgetMs === 'function') {
            window.renderLoopManager.setFrameBudgetMs(p.renderLoopFrameBudgetMs);
        }
        if (
            window.tilesetViewer &&
            typeof window.tilesetViewer.applyDisplayPerformanceSettings === 'function'
        ) {
            window.tilesetViewer.applyDisplayPerformanceSettings(p);
        }
        try {
            if (
                window.layerRenderingQuality &&
                typeof window.layerRenderingQuality.applyFromMergedConfig === 'function'
            ) {
                window.layerRenderingQuality.applyFromMergedConfig();
            }
        } catch (e) {
            /* ignore */
        }
    }

    /**
     * Short label for a tileset URL/path (for merged hierarchy listings)
     * @private
     */
    _tilesetSourceLabel(sourceUrl) {
        if (!sourceUrl || typeof sourceUrl !== 'string') return '';
        const q = sourceUrl.indexOf('?');
        const base = q >= 0 ? sourceUrl.slice(0, q) : sourceUrl;
        const parts = base.replace(/\\/g, '/').split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : base;
    }

    /**
     * Load tileset-specific configuration from JSON file
     * @param {Object|null} tilesetJson - Parsed tileset root document
     * @param {Object} [loadOptions]
     * @param {boolean} [loadOptions.merge] - If true, append extracted lists to existing (multiple masters)
     * @param {string} [loadOptions.sourceUrl] - Original URL/path (labels merged entries)
     */
    async loadTilesetConfig(tilesetJson = null, loadOptions = {}) {
        try {
            const { merge = false, sourceUrl = '' } = loadOptions;
            // If tileset JSON provided, use it
            if (tilesetJson) {
                this.tilesetConfig = tilesetJson;
                this.extractConfigFromTileset(tilesetJson, { merge, sourceUrl });
                return;
            }

            // Try to get current tileset JSON from viewer
            if (window.tilesetViewer) {
                const tilesets = window.tilesetViewer.getAllTilesets();
                if (tilesets.length > 0 && tilesets[0].url) {
                    try {
                        const resolvedUrl = await window.pathResolver?.resolvePath(tilesets[0].url);
                        if (!resolvedUrl) return;

                        let json;
                        if (typeof resolvedUrl === 'object' && resolvedUrl.type === 'fileHandle' && resolvedUrl.handle) {
                            const file = await resolvedUrl.handle.getFile();
                            json = JSON.parse(await file.text());
                        } else if (typeof resolvedUrl === 'string') {
                            const response = await fetch(resolvedUrl);
                            if (!response.ok) return;
                            json = await response.json();
                        } else {
                            return;
                        }
                        this.tilesetConfig = json;
                        this.extractConfigFromTileset(json);
                    } catch (error) {
                        console.warn('Failed to load tileset config:', error);
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to load tileset configuration:', error);
        }
    }

    /**
     * Extract configuration from tileset JSON structure
     * @param {Object} tilesetJson
     * @param {Object} [opts]
     * @param {boolean} [opts.merge] - Append to existing extracted arrays (multi-master)
     * @param {string} [opts.sourceUrl] - Source path for tagging merged rows
     */
    extractConfigFromTileset(tilesetJson, opts = {}) {
        if (!tilesetJson) return;

        const { merge = false, sourceUrl = '' } = opts;
        const label = this._tilesetSourceLabel(sourceUrl);
        const tag = (p) => (merge && label ? `${label}:${p}` : p);
        const tagRow = (row) => {
            const out = { ...row, path: tag(row.path) };
            if (sourceUrl) out.sourceUrl = sourceUrl;
            return out;
        };

        // Extract bounding volume information
        const boundingVolumes = this.extractBoundingVolumes(tilesetJson).map(tagRow);
        const geometricErrors = this.extractGeometricErrors(tilesetJson).map(tagRow);
        const contentRefs = this.extractContentReferences(tilesetJson).map(tagRow);

        if (merge) {
            this.configs.set('boundingVolumes', [
                ...(this.configs.get('boundingVolumes') || []),
                ...boundingVolumes
            ]);
            this.configs.set('geometricErrors', [
                ...(this.configs.get('geometricErrors') || []),
                ...geometricErrors
            ]);
            this.configs.set('contentReferences', [
                ...(this.configs.get('contentReferences') || []),
                ...contentRefs
            ]);
        } else {
            this.configs.set('boundingVolumes', boundingVolumes);
            this.configs.set('geometricErrors', geometricErrors);
            this.configs.set('contentReferences', contentRefs);
        }

        // Extract asset information (keep last single asset for legacy; accumulate list when merging)
        if (tilesetJson.asset) {
            if (merge) {
                const assets = this.configs.get('tilesetAssets') || [];
                assets.push({ sourceUrl: sourceUrl || undefined, asset: tilesetJson.asset });
                this.configs.set('tilesetAssets', assets);
            } else {
                this.configs.set('tilesetAssets', [{ sourceUrl: sourceUrl || undefined, asset: tilesetJson.asset }]);
            }
            this.configs.set('asset', tilesetJson.asset);
        } else if (!merge) {
            this.configs.delete('tilesetAssets');
        }

        // Extract any custom configuration from extras
        if (tilesetJson.asset?.extras) {
            const extras = tilesetJson.asset.extras;
            if (extras.config) {
                this.mergeConfig(extras.config);
            }
        }

        // Project.Optional_tools on tileset root → window.t (read-through; overrides app when present)
        this.syncWindowTFromProjectOptionalTools(tilesetJson);

        // Notify components of config update
        this.notifyConfigUpdate();
    }

    /**
     * Extract bounding volumes from tileset
     * @param {Object} tilesetJson - Tileset JSON object
     * @returns {Array} Array of bounding volume information
     */
    extractBoundingVolumes(tilesetJson) {
        if (!tilesetJson || typeof tilesetJson !== 'object') {
            return [];
        }

        const volumes = [];
        const visitedNodes = new Set(); // Cycle detection
        
        const traverse = (node, path = 'root') => {
            // Cycle detection
            if (visitedNodes.has(node)) {
                return;
            }
            visitedNodes.add(node);

            if (node.boundingVolume) {
                volumes.push({
                    path: path,
                    type: node.boundingVolume.sphere ? 'sphere' : 
                          node.boundingVolume.box ? 'box' : 
                          node.boundingVolume.region ? 'region' : 'unknown',
                    data: node.boundingVolume.sphere || node.boundingVolume.box || node.boundingVolume.region,
                    geometricError: node.geometricError
                });
            }
            
            if (node.children && Array.isArray(node.children)) {
                node.children.forEach((child, index) => {
                    traverse(child, `${path}.children[${index}]`);
                });
            }

            visitedNodes.delete(node);
        };

        if (tilesetJson.root) {
            traverse(tilesetJson.root);
        }

        return volumes;
    }

    /**
     * Extract geometric errors from tileset
     * @param {Object} tilesetJson - Tileset JSON object
     * @returns {Array} Array of geometric error information
     */
    extractGeometricErrors(tilesetJson) {
        if (!tilesetJson || typeof tilesetJson !== 'object') {
            return [];
        }

        const errors = [];
        const visitedNodes = new Set(); // Cycle detection
        
        const traverse = (node, path = 'root') => {
            // Cycle detection
            if (visitedNodes.has(node)) {
                return;
            }
            visitedNodes.add(node);

            if (typeof node.geometricError === 'number') {
                errors.push({
                    path: path,
                    value: node.geometricError
                });
            }
            
            if (node.children && Array.isArray(node.children)) {
                node.children.forEach((child, index) => {
                    traverse(child, `${path}.children[${index}]`);
                });
            }

            visitedNodes.delete(node);
        };

        if (tilesetJson.root) {
            traverse(tilesetJson.root);
        }

        return errors;
    }

    /**
     * Extract content references from tileset
     * @param {Object} tilesetJson - Tileset JSON object
     * @returns {Array} Array of content reference information
     */
    extractContentReferences(tilesetJson) {
        if (!tilesetJson || typeof tilesetJson !== 'object') {
            return [];
        }

        const references = [];
        const visitedNodes = new Set(); // Cycle detection
        
        const traverse = (node, path = 'root') => {
            // Cycle detection
            if (visitedNodes.has(node)) {
                return;
            }
            visitedNodes.add(node);

            if (node.content && node.content.uri) {
                const uri = node.content.uri;
                references.push({
                    path: path,
                    uri: uri,
                    type: typeof uri === 'string' && uri.endsWith('.b3dm') ? 'b3dm' :
                          typeof uri === 'string' && uri.endsWith('.json') ? 'tileset' : 'other'
                });
            }
            
            if (node.children && Array.isArray(node.children)) {
                node.children.forEach((child, index) => {
                    traverse(child, `${path}.children[${index}]`);
                });
            }

            visitedNodes.delete(node);
        };

        if (tilesetJson.root) {
            traverse(tilesetJson.root);
        }

        return references;
    }

    /**
     * Merge configuration from source
     * @param {Object} sourceConfig - Source configuration to merge
     */
    mergeConfig(sourceConfig) {
        if (!sourceConfig || typeof sourceConfig !== 'object') {
            console.warn('Invalid sourceConfig provided to mergeConfig');
            return;
        }

        const appConfig = this.configs.get('app') || this.getDefaultConfig();
        
        // Deep merge (returns new object, doesn't mutate)
        const mergedConfig = this.deepMerge(appConfig, sourceConfig);
        this.configs.set('app', mergedConfig);
        this.syncWindowTFromProjectOptionalTools(this.tilesetConfig);
    }

    /**
     * Deep merge objects safely (creates new objects instead of mutating)
     * @param {Object} target - Target object to merge into
     * @param {Object} source - Source object to merge from
     * @returns {Object} Merged object (new object, doesn't mutate target)
     */
    deepMerge(target, source) {
        // Input validation
        if (!target || typeof target !== 'object') {
            target = {};
        }
        if (!source || typeof source !== 'object') {
            return target;
        }

        // Create a copy of target to avoid mutation
        const result = Array.isArray(target) ? [...target] : { ...target };

        for (const key in source) {
            // Only process own properties
            if (!source.hasOwnProperty(key)) {
                continue;
            }

            const sourceValue = source[key];
            const targetValue = result[key];

            // Handle null/undefined
            if (sourceValue === null || sourceValue === undefined) {
                result[key] = sourceValue;
                continue;
            }

            // Deep merge objects (but not arrays or Date objects)
            if (sourceValue && 
                typeof sourceValue === 'object' && 
                !Array.isArray(sourceValue) &&
                !(sourceValue instanceof Date) &&
                !(sourceValue instanceof RegExp)) {
                
                // Recursively merge if target also has this key as an object
                if (targetValue && 
                    typeof targetValue === 'object' && 
                    !Array.isArray(targetValue) &&
                    !(targetValue instanceof Date) &&
                    !(targetValue instanceof RegExp)) {
                    result[key] = this.deepMerge(targetValue, sourceValue);
                } else {
                    // Create a copy of source object
                    result[key] = { ...sourceValue };
                }
            } else {
                // Primitive values, arrays, Dates, RegExp - copy directly
                result[key] = sourceValue;
            }
        }

        return result;
    }

    /**
     * Get configuration value by path
     */
    getConfig(path, defaultValue = null) {
        const parts = path.split('.');
        let current = this.configs.get('app') || this.getDefaultConfig();
        
        for (const part of parts) {
            if (current && typeof current === 'object' && part in current) {
                current = current[part];
            } else {
                return defaultValue;
            }
        }
        
        return current !== undefined ? current : defaultValue;
    }

    /**
     * Get tool configuration
     */
    getToolConfig(toolId) {
        const tools = this.getConfig('tools.items', []);
        return tools.find(tool => tool.id === toolId) || null;
    }

    /**
     * Get all enabled tools
     */
    getEnabledTools() {
        const tools = this.getConfig('tools.items', []);
        return tools.filter(tool => tool.enabled !== false);
    }

    /**
     * Get feature configuration
     */
    getFeatureConfig(featureName) {
        return this.getConfig(`features.${featureName}`, {});
    }

    /**
     * Resolved module gate for runtime init (defaults + app-config + runtime overrides).
     * @param {string} key — e.g. `searchManager`, `screenshotManager`
     * @returns {{ enabled: boolean }}
     */
    getModuleConfig(key) {
        const app = this.mergeAppConfigWithDefaults(this.configs.get('app'));
        const d = this.getDefaultConfig().modules[key] || { enabled: true };
        const u = app.modules && app.modules[key] ? app.modules[key] : {};
        return { ...d, ...u };
    }

    /**
     * Get tileset-specific configuration
     */
    getTilesetConfig(key) {
        return this.configs.get(key) || null;
    }

    /**
     * Notify components of configuration update
     */
    notifyConfigUpdate() {
        // Dispatch custom event
        const event = new CustomEvent('jsonConfigUpdated', {
            detail: { configManager: this }
        });
        window.dispatchEvent(event);
    }

    /**
     * Update configuration
     */
    updateConfig(path, value) {
        const appConfig = this.configs.get('app') || this.getDefaultConfig();
        const parts = path.split('.');
        let current = appConfig;
        
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current[part]) {
                current[part] = {};
            }
            current = current[part];
        }
        
        current[parts[parts.length - 1]] = value;
        this.configs.set('app', appConfig);
        if (path === 'Project' || (typeof path === 'string' && path.indexOf('Project.') === 0)) {
            this.syncWindowTFromProjectOptionalTools(this.tilesetConfig);
        }
        if (path === 'performance' || (typeof path === 'string' && path.indexOf('performance.') === 0)) {
            this.applyPerformanceRuntime();
        }
        this.notifyConfigUpdate();
    }
}

// Export singleton instance
window.jsonConfigManager = new JSONConfigManager();
