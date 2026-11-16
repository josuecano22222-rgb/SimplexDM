/**
 * AppSettingsFramework — single integration layer for all persisted preferences and user data keys.
 * - Registers every known localStorage key
 * - Applies dependent modules after jsonConfig / Control Center / Dashboard saves
 * - Full export/import for backup and migration
 */
(function () {
    'use strict';

    /** @type {ReadonlyArray<{ key: string, category: string, description: string }>} */
    const KNOWN_KEYS = Object.freeze([
        { key: 'simplex_runtime_overrides_v1', category: 'config', description: 'Control Center merged runtime (app + optional tools + prefs)' },
        { key: 'appSettings', category: 'preferences', description: 'Dashboard: paths, quality, memory, notifications' },
        { key: 'platformControlsSettings', category: 'preferences', description: 'Site accessible, land use, sun time' },
        { key: 'simSensorConfig', category: 'preferences', description: 'Ion SDK sensor cone defaults' },
        { key: 'meridian_paths', category: 'data', description: 'Saved tileset paths (fallback when IndexedDB unavailable)' },
        { key: 'simplex_bookmarks_v1', category: 'data', description: 'Camera bookmarks' },
        { key: 'simplex_features_v1', category: 'data', description: 'Drawn / managed features' },
        { key: 'uploadedModels', category: 'data', description: 'Uploaded model catalog metadata' },
        { key: 'uploadedLayers', category: 'data', description: 'Uploaded layer catalog metadata' },
        { key: 'collaboration_bookmarks', category: 'data', description: 'Collaboration bookmarks (optional module)' },
        { key: 'collaboration_annotations', category: 'data', description: 'Collaboration annotations' },
        { key: 'collaboration_presentations', category: 'data', description: 'Collaboration presentations' }
    ]);

    class AppSettingsFramework {
        constructor() {
            this._bootstrapped = false;
        }

        /**
         * Call once after scripts load (before or after jsonConfigManager.init).
         */
        bootstrap() {
            if (this._bootstrapped) return;
            this._bootstrapped = true;
            window.addEventListener('jsonConfigUpdated', () => {
                this.applyDependentModules({ source: 'jsonConfigUpdated' });
            });
        }

        getKnownKeys() {
            return KNOWN_KEYS;
        }

        /**
         * Apply displayControl, platform controls, SIM bridge from current localStorage (idempotent).
         */
        applyDependentModules(options) {
            const silent = options && options.silent;
            try {
                this._applyAppSettingsToDisplayControl();
                this._applyPlatformControls();
                this._applySimSensor();
                this._applyChromeVisibility();
                this.applyUiLayoutFromAppConfig();
                if (
                    window.smart3dToolbarWireup &&
                    typeof window.smart3dToolbarWireup.refreshToolbarTitlesAndVisibility === 'function'
                ) {
                    window.smart3dToolbarWireup.refreshToolbarTitlesAndVisibility();
                }
                if (!silent) {
                    try {
                        window.dispatchEvent(
                            new CustomEvent('simplex:dependentSettingsApplied', {
                                detail: { source: (options && options.source) || 'framework' }
                            })
                        );
                    } catch (e) {
                        /* ignore */
                    }
                }
            } catch (e) {
                console.warn('AppSettingsFramework.applyDependentModules:', e);
            }
        }

        _applyAppSettingsToDisplayControl() {
            const dc = window.displayControl;
            if (!dc || typeof dc.applyAppSettings !== 'function') return;
            let s = null;
            try {
                const raw = localStorage.getItem('appSettings');
                if (raw) s = JSON.parse(raw);
            } catch (e) {
                /* ignore */
            }
            dc.applyAppSettings(s || {});
        }

        _applyPlatformControls() {
            const pc = window.platformControlsUI;
            if (!pc || typeof pc.applyFromObject !== 'function') return;
            let s = null;
            try {
                const raw = localStorage.getItem('platformControlsSettings');
                if (raw) s = JSON.parse(raw);
            } catch (e) {
                /* ignore */
            }
            if (s) pc.applyFromObject(s, { silent: true });
        }

        _applySimSensor() {
            const bridge = window.simVisualToolsBridge;
            if (!bridge || typeof bridge.applySensorConfigFromObject !== 'function') return;
            let s = null;
            try {
                const raw = localStorage.getItem('simSensorConfig');
                if (raw) s = JSON.parse(raw);
            } catch (e) {
                /* ignore */
            }
            if (s && typeof s === 'object') bridge.applySensorConfigFromObject(s, { persist: true });
        }

        /**
         * Theme, sidebar collapsed state, and optional bottom tool-strip collapse from merged app config.
         * Safe to call whenever jsonConfig updates; idempotent.
         */
        applyUiLayoutFromAppConfig() {
            const jcm = window.jsonConfigManager;
            if (!jcm) {
                if (typeof window.simplexThemeSync === 'function') {
                    window.simplexThemeSync(document.body);
                }
                return;
            }
            let app = null;
            try {
                app = jcm.mergeAppConfigWithDefaults(jcm.configs.get('app'));
            } catch (e) {
                return;
            }
            const ui = app.ui || {};
            const theme = ui.theme === 'light' ? 'light' : 'dark';
            if (typeof window.simplexThemeSync === 'function') {
                window.simplexThemeSync(document.body, theme);
            } else {
                document.body.classList.toggle('theme-light', theme === 'light');
                document.body.classList.toggle('theme-dark', theme !== 'light');
            }
            const lang = typeof ui.language === 'string' && ui.language.trim() ? ui.language.trim() : 'en';
            if (window.appI18n && typeof window.appI18n.setLocale === 'function') {
                window.appI18n.setLocale(lang);
            } else if (window.smart3dI18n && typeof window.smart3dI18n.setLocale === 'function') {
                window.smart3dI18n.setLocale(lang);
            }
            const sb = ui.sidebars || {};
            const left = document.getElementById('leftSidebar');
            const right = document.getElementById('rightSidebar');
            if (left) {
                const collapsed = sb.left && sb.left.defaultCollapsed !== false;
                left.classList.toggle('collapsed', collapsed);
            }
            if (right) {
                const collapsed = sb.right && sb.right.defaultCollapsed !== false;
                right.classList.toggle('collapsed', collapsed);
            }
            const toolsMin = sb.tools && sb.tools.defaultCollapsed === true;
            document.body.classList.toggle('simplex-tools-strip-collapsed', !!toolsMin);
            try {
                window.dispatchEvent(new CustomEvent('simplex:sidebarLayoutChanged'));
            } catch (e) {
                /* ignore */
            }
        }

        /** Apply ui.chrome visibility for top navigation buttons. */
        _applyChromeVisibility() {
            const jcm = window.jsonConfigManager;
            const reg = window.controlCenterRegistry;
            if (!jcm || !reg || !Array.isArray(reg.NAV_CHROME_IDS)) return;
            const app = jcm.mergeAppConfigWithDefaults(jcm.configs.get('app'));
            const chrome = (app.ui && app.ui.chrome) || {};
            reg.NAV_CHROME_IDS.forEach(({ id, configKey }) => {
                const el = document.getElementById(id);
                if (!el) return;
                const show = chrome[configKey] !== false;
                el.style.display = show ? '' : 'none';
            });
        }

        /**
         * Persist Control Center payload and run full jsonConfig apply (toolbar, performance, events).
         */
        persistControlCenterAndApply(payload) {
            const jcm = window.jsonConfigManager;
            if (!jcm) return;
            jcm.saveRuntimeOverridesToStorage(payload || {});
            jcm.applyRuntimeOverridesFromStorage();
        }

        /**
         * After Dashboard or other code writes `appSettings` only.
         */
        applyAfterAppSettingsChange() {
            this._applyAppSettingsToDisplayControl();
        }

        /**
         * Snapshot of all known keys (parsed JSON or string fallback).
         */
        exportFullSnapshot() {
            const out = {
                version: 2,
                exportedAt: new Date().toISOString(),
                keys: {},
                knownKeyMeta: KNOWN_KEYS
            };
            KNOWN_KEYS.forEach(({ key }) => {
                try {
                    const v = localStorage.getItem(key);
                    if (v == null) return;
                    try {
                        out.keys[key] = JSON.parse(v);
                    } catch (e) {
                        out.keys[key] = v;
                    }
                } catch (e) {
                    /* ignore */
                }
            });
            const jcm = window.jsonConfigManager;
            if (jcm) {
                out.runtime = {
                    appConfig: jcm.mergeAppConfigWithDefaults(jcm.configs.get('app')),
                    optionalToolsPatch: jcm.optionalToolsRawFromWindowT(window.t || jcm.getDefaultOptionalToolsT())
                };
            }
            return out;
        }

        /**
         * Restore keys from exportFullSnapshot payload; re-run jsonConfig + dependents.
         */
        importFullSnapshot(data) {
            if (!data || typeof data !== 'object') throw new Error('Invalid snapshot');
            const jcm = window.jsonConfigManager;
            if (data.keys && typeof data.keys === 'object') {
                Object.keys(data.keys).forEach((key) => {
                    try {
                        const val = data.keys[key];
                        localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
                    } catch (e) {
                        console.warn('importFullSnapshot key', key, e);
                    }
                });
            }
            if (data.runtime && jcm) {
                jcm.saveRuntimeOverridesToStorage({
                    appConfig: data.runtime.appConfig,
                    optionalToolsPatch: data.runtime.optionalToolsPatch
                });
            }
            if (jcm) {
                jcm.applyRuntimeOverridesFromStorage();
            }
            this.applyDependentModules({ source: 'importFullSnapshot', silent: true });
            if (window.bookmarkManager && typeof window.bookmarkManager.loadBookmarks === 'function') {
                window.bookmarkManager.loadBookmarks();
            }
            if (window.featureManager && typeof window.featureManager.reloadFromStorage === 'function') {
                window.featureManager.reloadFromStorage();
            }
            const upload = window.modelAndLayerUploadManager;
            if (upload && typeof upload.loadUploadedItems === 'function') {
                upload.loadUploadedItems();
                if (typeof upload.updateUploadedItemsList === 'function') upload.updateUploadedItemsList();
            }
        }

        /**
         * Legacy Control Center export (version 1) — same shape as early exports.
         */
        importLegacyControlCenter(data) {
            const jcm = window.jsonConfigManager;
            if (!jcm || !data || typeof data !== 'object') return;
            jcm.saveRuntimeOverridesToStorage({
                appConfig: data.appConfig,
                optionalToolsPatch: data.optionalToolsPatch,
                appSettings: data.appSettings,
                platformControls: data.platformControls,
                simSensorConfig: data.simSensorConfig
            });
            jcm.applyRuntimeOverridesFromStorage();
        }

        clearPreferenceKeys() {
            ['appSettings', 'platformControlsSettings', 'simSensorConfig'].forEach((k) => {
                try {
                    localStorage.removeItem(k);
                } catch (e) {
                    /* ignore */
                }
            });
        }

        clearRuntimeOverridesOnly() {
            if (window.jsonConfigManager) {
                window.jsonConfigManager.clearRuntimeOverridesStorage();
            }
        }
    }

    const _instance = new AppSettingsFramework();
    window.appSettingsFramework = _instance;
    _instance.bootstrap();
})();
