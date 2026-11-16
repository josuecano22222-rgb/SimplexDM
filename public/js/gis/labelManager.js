/**
 * Cesium label overlay driven by offline SQLite (Electron main).
 */
(function (global) {
    'use strict';

    const TYPE_STYLE = {
        country: {
            font: 'bold 20px sans-serif',
            fillColor: () => Cesium.Color.WHITE,
            maxDist: 20000000,
        },
        state: {
            font: 'bold 16px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#e0e0e0'),
            maxDist: 10000000,
        },
        city: {
            font: 'bold 14px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#ffe082'),
            maxDist: 5000000,
        },
        town: {
            font: '13px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#fff9c4'),
            maxDist: 2000000,
        },
        village: {
            font: '12px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#fffde7'),
            maxDist: 800000,
        },
        suburb: {
            font: '11px sans-serif',
            fillColor: () => Cesium.Color.WHITE,
            maxDist: 500000,
        },
        motorway: {
            font: '11px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#ffcc80'),
            maxDist: 800000,
        },
        road: {
            font: '10px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#b0bec5'),
            maxDist: 300000,
        },
        waterway: {
            font: 'italic 11px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#81d4fa'),
            maxDist: 600000,
        },
        lake: {
            font: 'italic 12px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#64b5f6'),
            maxDist: 2000000,
        },
        mountain: {
            font: '11px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#d7ccc8'),
            maxDist: 1500000,
        },
        island: {
            font: '12px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#c8e6c9'),
            maxDist: 3000000,
        },
        airport: {
            font: '11px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#ce93d8'),
            maxDist: 800000,
        },
        railway: {
            font: '10px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#ef9a9a'),
            maxDist: 300000,
        },
        hospital: {
            font: '10px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#f48fb1'),
            maxDist: 200000,
        },
        school: {
            font: '10px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#a5d6a7'),
            maxDist: 150000,
        },
        poi: {
            font: '10px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#80cbc4'),
            maxDist: 100000,
        },
        custom: {
            font: 'bold 14px sans-serif',
            fillColor: () => Cesium.Color.fromCssColorString('#ff8a65'),
            maxDist: 5000000,
        },
    };

    const NEAR_FAR_TRANSLUCENCY = new Cesium.NearFarScalar(5e4, 1.0, 8e6, 0.0);
    const NEAR_FAR_SCALE = new Cesium.NearFarScalar(1e3, 1.2, 5e6, 0.5);

    const ENABLED_STORAGE_KEY = 'simplex.mapLabels.enabled';

    function readEnabledFromStorage() {
        try {
            const v = global.localStorage.getItem(ENABLED_STORAGE_KEY);
            if (v === '0' || v === 'false') return false;
        } catch (_) {
            /* ignore */
        }
        return true;
    }

    class LabelManager {
        constructor() {
            /** @type {Cesium.Viewer|null} */
            this.viewer = null;
            /** @type {Cesium.LabelCollection|null} */
            this.collection = null;
            this._activeRegions = [];
            this._enabledTypes = new Set(Object.keys(TYPE_STYLE));
            this._lang = 'default';
            this._debounceTimer = null;
            this._cameraListener = null;
            this._initialized = false;
            /** @type {boolean} */
            this._globallyEnabled = readEnabledFromStorage();
        }

        isGloballyEnabled() {
            return this._globallyEnabled;
        }

        /**
         * @param {boolean} on
         */
        setGloballyEnabled(on) {
            this._globallyEnabled = !!on;
            try {
                global.localStorage.setItem(ENABLED_STORAGE_KEY, this._globallyEnabled ? '1' : '0');
            } catch (_) {
                /* ignore */
            }
            try {
                global.dispatchEvent(new CustomEvent('simplex:mapLabelsEnabledChanged', { detail: { enabled: this._globallyEnabled } }));
            } catch (_) {
                /* ignore */
            }
            if (!this._globallyEnabled) {
                if (this.collection && !this.collection.isDestroyed()) {
                    this.collection.removeAll();
                }
            } else {
                this._scheduleRefresh();
            }
        }

        _labelsApi() {
            return global.electronAPI && global.electronAPI.gis && global.electronAPI.gis.labels
                ? global.electronAPI.gis.labels
                : null;
        }

        /**
         * @param {Cesium.Viewer} viewer
         */
        init(viewer) {
            if (this._initialized || !viewer) return;
            if (!this._labelsApi()) {
                console.warn('[LabelManager] electronAPI.gis.labels unavailable (not Electron?)');
                return;
            }
            this.viewer = viewer;
            this.collection = new Cesium.LabelCollection({ scene: viewer.scene });
            viewer.scene.primitives.add(this.collection);

            this._cameraListener = () => this._scheduleRefresh();
            viewer.camera.moveEnd.addEventListener(this._cameraListener);

            this._loadRegionsFromManifest();
            this._scheduleRefresh();
            this._initialized = true;
        }

        isInitialized() {
            return this._initialized === true;
        }

        destroy() {
            if (!this._initialized) return;
            if (this._debounceTimer) clearTimeout(this._debounceTimer);
            if (this.viewer && this._cameraListener) {
                this.viewer.camera.moveEnd.removeEventListener(this._cameraListener);
            }
            if (this.collection && !this.collection.isDestroyed()) {
                try {
                    this.viewer.scene.primitives.remove(this.collection);
                } catch (_) {
                    /* ignore */
                }
                this.collection.destroy();
            }
            this.viewer = null;
            this.collection = null;
            this._initialized = false;
        }

        /**
         * @param {string[]} types
         */
        setEnabledTypes(types) {
            this._enabledTypes = new Set(types);
            this._scheduleRefresh();
        }

        /**
         * @param {string} lang
         */
        setLanguage(lang) {
            this._lang = lang || 'default';
            this._scheduleRefresh();
        }

        /**
         * @param {string[]} regionIds
         */
        setActiveRegions(regionIds) {
            this._activeRegions = regionIds || [];
            this._scheduleRefresh();
        }

        refresh() {
            if (this._debounceTimer) clearTimeout(this._debounceTimer);
            this._doRefresh();
        }

        _scheduleRefresh() {
            if (this._debounceTimer) clearTimeout(this._debounceTimer);
            this._debounceTimer = setTimeout(() => this._doRefresh(), 280);
        }

        async _doRefresh() {
            const api = this._labelsApi();
            if (!this.viewer || !api || !global.labelQueryService) return;
            if (!this._globallyEnabled) {
                if (this.collection && !this.collection.isDestroyed()) {
                    this.collection.removeAll();
                }
                return;
            }
            try {
                const viewport = global.labelQueryService.getViewport(this.viewer);
                if (!viewport) return;

                const opts = {
                    types: Array.from(this._enabledTypes),
                    maxResults: 600,
                };

                const rows = await api.queryViewport(viewport, this._activeRegions, opts);
                const withNames = rows.map((row) => ({
                    row,
                    name: this._resolveName(row),
                }));

                let toDraw = withNames;
                if (global.labelCollisionEngine) {
                    const forCull = withNames.map((w) => ({
                        lon: w.row.lon,
                        lat: w.row.lat,
                        name: w.name,
                        type: w.row.type,
                    }));
                    const culled = global.labelCollisionEngine.cull(this.viewer, forCull);
                    const keep = new Set(
                        culled.map((x) => `${x.lon},${x.lat},${x.name}`)
                    );
                    toDraw = withNames.filter((w) => keep.has(`${w.row.lon},${w.row.lat},${w.name}`));
                }

                this._renderLabels(toDraw.map((w) => ({ ...w.row, _text: w.name })));
            } catch (err) {
                console.warn('[LabelManager] refresh error:', err);
            }
        }

        /**
         * @param {object[]} rows
         */
        _renderLabels(rows) {
            if (!this.collection || this.collection.isDestroyed()) return;
            this.collection.removeAll();

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const styleDef = TYPE_STYLE[row.type] || TYPE_STYLE.poi;
                const text = row._text || this._resolveName(row);
                const style = {
                    font: styleDef.font,
                    fillColor: styleDef.fillColor(),
                    maxDist: styleDef.maxDist,
                };

                this.collection.add({
                    position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat),
                    text,
                    font: style.font,
                    fillColor: style.fillColor,
                    outlineColor: Cesium.Color.BLACK.withAlpha(0.55),
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -6),
                    scaleByDistance: NEAR_FAR_SCALE,
                    translucencyByDistance: NEAR_FAR_TRANSLUCENCY,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, style.maxDist),
                    eyeOffset: new Cesium.Cartesian3(0, 0, -500),
                });
            }
        }

        /**
         * @param {object} row
         */
        _resolveName(row) {
            const lang = this._lang;
            if (lang === 'en' && row.name_en) return row.name_en;
            if (lang === 'ar' && row.name_ar) return row.name_ar;
            if (lang !== 'default' && row.name_local) {
                try {
                    const loc = JSON.parse(row.name_local);
                    if (loc && loc[lang]) return loc[lang];
                } catch (_) {
                    /* ignore */
                }
            }
            return row.name || '';
        }

        async _loadRegionsFromManifest() {
            const api = this._labelsApi();
            if (!api) return;
            try {
                const installed = await api.listRegions();
                this._activeRegions = installed.filter((r) => r.enabled !== false).map((r) => r.id);
            } catch (err) {
                console.warn('[LabelManager] could not load region manifest:', err);
            }
        }
    }

    global.labelManager = new LabelManager();
})(typeof window !== 'undefined' ? window : this);
