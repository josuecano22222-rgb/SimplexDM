/**
 * SIM integration bridge:
 * - standardizes tool interaction events
 * - forwards events to available analytics providers (if present)
 */
(function () {
    'use strict';

    class SimIntegrationManager {
        constructor() {
            this.initialized = false;
            this.instrumentationStarted = false;
            this.instrumentInterval = null;
            this.instrumentCycles = 0;
            this.maxInstrumentCycles = 60;
            this.instrumentedMethods = {};
            this.providers = {
                gtag: false,
                fbq: false,
                ga: false,
                posthog: false
            };
            this.managerTargets = [
                { global: 'cutByPolygonManager', tool: 'cut_by_polygon' },
                { global: 'visibleHiddenAreasManager', tool: 'visible_hidden_areas' },
                { global: 'searchManager', tool: 'search' },
                { global: 'splitScreenManager', tool: 'split_screen' },
                { global: 'displayModesManager', tool: 'display_modes' },
                { global: 'supermanFlightModeManager', tool: 'superman_flight' },
                { global: 'streetViewManager', tool: 'street_view' },
                { global: 'obliqueViewsManager', tool: 'oblique_views' },
                { global: 'lineOfSightManager', tool: 'line_of_sight' },
                { global: 'enhancedMeasurementManager', tool: 'enhanced_measurement' },
                { global: 'layersMenuManager', tool: 'layers_menu' },
                { global: 'shareLocationManager', tool: 'share_location' },
                { global: 'coordinateResearchManager', tool: 'coordinate_research' },
                { global: 'coordinateManager', tool: 'coordinate' },
                { global: 'bookmarkManager', tool: 'bookmark' },
                { global: 'featureInteractionManager', tool: 'feature_interaction' },
                { global: 'featureManager', tool: 'feature_manager' },
                { global: 'screenshotManager', tool: 'screenshot' },
                { global: 'regionsManager', tool: 'regions' },
                { global: 'shadeAnalysisManager', tool: 'shade_analysis' },
                { global: 'tilePositioning', tool: 'tile_positioning' },
                { global: 'modelsMapManager', tool: 'models_map' },
                { global: 'modelAndLayerUploadManager', tool: 'model_layer_upload' },
                { global: 'displayControl', tool: 'display_control' }
            ];
            this.methodNames = ['show', 'toggle', 'start', 'init', 'activate', 'deactivate', 'open', 'close'];
        }

        init() {
            if (this.initialized) {
                return;
            }

            this.detectProviders();
            this.bindToolEvents();
            this.startManagerInstrumentation();
            this.initialized = true;

            if (window.logger && typeof window.logger.info === 'function') {
                window.logger.info('SimIntegrationManager initialized', this.providers);
            }
        }

        detectProviders() {
            this.providers.gtag = typeof window.gtag === 'function';
            this.providers.fbq = typeof window.fbq === 'function';
            this.providers.ga = typeof window.ga === 'function';
            this.providers.posthog = typeof window.posthog !== 'undefined' && typeof window.posthog.capture === 'function';
        }

        bindToolEvents() {
            const addEvent = window.simUtils && window.simUtils.addEventListener
                ? window.simUtils.addEventListener
                : (el, evt, cb) => el && el.addEventListener && el.addEventListener(evt, cb);

            addEvent(document, 'click', (event) => {
                const button = event.target && event.target.closest ? event.target.closest('[data-tool]') : null;
                if (!button) {
                    return;
                }

                const toolName = button.getAttribute('data-tool') || 'unknown';
                const payload = {
                    tool: toolName,
                    source: 'toolbar',
                    timestamp: Date.now()
                };

                this.emit('tool_used', payload);
            }, { capture: true, passive: true });

            addEvent(window, 'nestedToolbarItemClick', (event) => {
                const detail = (event && event.detail) || {};
                const payload = {
                    action: detail.action || 'unknown',
                    source: 'nested_toolbar',
                    timestamp: Date.now()
                };
                this.emit('nested_tool_used', payload);
            }, { capture: false, passive: true });
        }

        startManagerInstrumentation() {
            if (this.instrumentationStarted) {
                return;
            }

            this.instrumentationStarted = true;
            this.instrumentManagerMethods();

            this.instrumentInterval = window.setInterval(() => {
                this.instrumentCycles += 1;
                this.instrumentManagerMethods();

                if (this.instrumentCycles >= this.maxInstrumentCycles) {
                    this.stopManagerInstrumentation();
                }
            }, 1000);
        }

        stopManagerInstrumentation() {
            if (this.instrumentInterval) {
                window.clearInterval(this.instrumentInterval);
                this.instrumentInterval = null;
            }
        }

        instrumentManagerMethods() {
            for (let i = 0; i < this.managerTargets.length; i += 1) {
                const target = this.managerTargets[i];
                const manager = window[target.global];
                if (!manager) {
                    continue;
                }

                for (let j = 0; j < this.methodNames.length; j += 1) {
                    const methodName = this.methodNames[j];
                    this.wrapManagerMethod(target.tool, target.global, manager, methodName);
                }
            }
        }

        wrapManagerMethod(toolName, globalName, manager, methodName) {
            if (typeof manager[methodName] !== 'function') {
                return;
            }

            const key = globalName + '.' + methodName;
            if (this.instrumentedMethods[key]) {
                return;
            }

            const original = manager[methodName].bind(manager);
            const self = this;

            manager[methodName] = function wrappedManagerMethod() {
                const args = Array.prototype.slice.call(arguments);
                self.emit('tool_manager_call', {
                    tool: toolName,
                    manager: globalName,
                    method: methodName,
                    source: 'manager_wrap',
                    timestamp: Date.now(),
                    args_count: args.length
                });
                return original.apply(null, args);
            };

            this.instrumentedMethods[key] = true;
        }

        emit(eventName, payload) {
            if (window.logger && typeof window.logger.debug === 'function') {
                window.logger.debug('[SIM_EVENT]', eventName, payload);
            }
            this.trackGtag(eventName, payload);
            this.trackMetaPixel(eventName, payload);
            this.trackGa(eventName, payload);
            this.trackPosthog(eventName, payload);
        }

        trackGtag(eventName, payload) {
            if (!this.providers.gtag) {
                return;
            }
            window.simUtils?.trySafe(() => window.gtag('event', eventName, payload));
        }

        trackMetaPixel(eventName, payload) {
            if (!this.providers.fbq) {
                return;
            }
            window.simUtils?.trySafe(() => window.fbq('trackCustom', eventName, payload));
        }

        trackGa(eventName, payload) {
            if (!this.providers.ga) {
                return;
            }
            window.simUtils?.trySafe(() => {
                window.ga('send', 'event', 'simplex_tools', eventName, JSON.stringify(payload));
            });
        }

        trackPosthog(eventName, payload) {
            if (!this.providers.posthog) {
                return;
            }
            window.simUtils?.trySafe(() => window.posthog.capture(eventName, payload));
        }
    }

    window.simIntegrationManager = new SimIntegrationManager();
    window.trackSimEvent = function (eventName, payload) {
        if (!window.simIntegrationManager) {
            return;
        }
        window.simIntegrationManager.emit(eventName || 'custom_sim_event', payload || {});
    };
})();
