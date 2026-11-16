/**
 * ControlGovernance
 * Centralized control system for managing all user interactions
 * Provides complete governance over tiles, mouse browsing, and features
 */

class ControlGovernance {
    constructor() {
        this.activeMode = null;
        this.modeStack = [];
        this.controlHandlers = new Map();
        this.mouseControls = {
            enabled: true,
            panEnabled: true,
            zoomEnabled: true,
            rotateEnabled: true,
            pickEnabled: true
        };
        this.tileControls = {
            enabled: true,
            loadEnabled: true,
            removeEnabled: true,
            visibilityEnabled: true,
            positioningEnabled: true
        };
        this.featureControls = {
            enabled: true,
            selectionEnabled: true,
            interactionEnabled: true
        };
        this.eventListeners = new Map();
        this.init();
    }

    /**
     * Initialize control governance system
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.setupDefaultHandlers();
        this.setupEventSystem();
        console.log('ControlGovernance initialized');
    }

    /**
     * Setup default control handlers
     */
    setupDefaultHandlers() {
        // Register default handlers
        this.registerHandler('measurement', {
            priority: 100,
            canHandle: () => {
                return window.enhancedMeasurementManager && 
                       window.enhancedMeasurementManager.isMeasuring;
            },
            handle: (event) => {
                if (window.enhancedMeasurementManager) {
                    return window.enhancedMeasurementManager.handleClick(event);
                }
                return false;
            }
        });

        this.registerHandler('cut', {
            priority: 90,
            canHandle: () => {
                return window.cutByPolygonManager && 
                       window.cutByPolygonManager.isActive;
            },
            handle: (event) => {
                if (window.cutByPolygonManager) {
                    return window.cutByPolygonManager.handleClick(event);
                }
                return false;
            }
        });

        this.registerHandler('feature', {
            priority: 80,
            canHandle: () => {
                return this.featureControls.enabled && 
                       this.featureControls.selectionEnabled;
            },
            handle: (event) => {
                if (window.featureInteractionManager) {
                    return window.featureInteractionManager.handleClick(event);
                }
                return false;
            }
        });

        this.registerHandler('layer', {
            priority: 70,
            canHandle: () => {
                return window.layersMenuManager;
            },
            handle: (event) => {
                // Layer clicks handled by layersMenuManager
                return false;
            }
        });

        this.registerHandler('navigation', {
            priority: 10,
            canHandle: () => {
                return this.mouseControls.enabled;
            },
            handle: () => {
                // Default navigation handled by Cesium
                return true;
            }
        });
    }

    /**
     * Register a control handler
     * @param {string} name - Handler name
     * @param {object} handler - Handler configuration
     */
    registerHandler(name, handler) {
        if (!handler.priority) {
            handler.priority = 50;
        }
        this.controlHandlers.set(name, handler);
        
        // Sort handlers by priority (highest first)
        const sorted = Array.from(this.controlHandlers.entries())
            .sort((a, b) => b[1].priority - a[1].priority);
        this.controlHandlers = new Map(sorted);
    }

    /**
     * Unregister a control handler
     * @param {string} name - Handler name
     */
    unregisterHandler(name) {
        this.controlHandlers.delete(name);
    }

    /**
     * Handle click event with governance
     * @param {object} event - Click event
     * @returns {boolean} - Whether event was handled
     */
    handleClick(event) {
        if (!this.mouseControls.enabled || !this.mouseControls.pickEnabled) {
            return false;
        }

        // Try handlers in priority order
        for (const [name, handler] of this.controlHandlers) {
            if (handler.canHandle && handler.canHandle()) {
                if (handler.handle) {
                    const handled = handler.handle(event);
                    if (handled) {
                        this.activeMode = name;
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * Set active mode
     * @param {string} mode - Mode name (null to clear)
     */
    setActiveMode(mode) {
        if (mode) {
            this.modeStack.push(this.activeMode);
            this.activeMode = mode;
        } else {
            this.activeMode = this.modeStack.pop() || null;
        }
        
        this.updateControlState();
        this.dispatchEvent('modeChanged', { mode: this.activeMode });
    }

    /**
     * Enable/disable mouse controls
     * @param {boolean} enabled - Whether to enable
     */
    setMouseControlsEnabled(enabled) {
        this.mouseControls.enabled = enabled;
        this.updateControlState();
        this.dispatchEvent('mouseControlsChanged', { enabled });
    }

    /**
     * Enable/disable specific mouse control
     * @param {string} control - Control name (pan, zoom, rotate, pick)
     * @param {boolean} enabled - Whether to enable
     */
    setMouseControlEnabled(control, enabled) {
        const key = `${control}Enabled`;
        if (this.mouseControls.hasOwnProperty(key)) {
            this.mouseControls[key] = enabled;
            this.updateControlState();
            this.dispatchEvent('mouseControlChanged', { control, enabled });
        }
    }

    /**
     * Enable/disable tile controls
     * @param {boolean} enabled - Whether to enable
     */
    setTileControlsEnabled(enabled) {
        this.tileControls.enabled = enabled;
        this.updateControlState();
        this.dispatchEvent('tileControlsChanged', { enabled });
    }

    /**
     * Enable/disable specific tile control
     * @param {string} control - Control name (load, remove, visibility, positioning)
     * @param {boolean} enabled - Whether to enable
     */
    setTileControlEnabled(control, enabled) {
        const key = `${control}Enabled`;
        if (this.tileControls.hasOwnProperty(key)) {
            this.tileControls[key] = enabled;
            this.updateControlState();
            this.dispatchEvent('tileControlChanged', { control, enabled });
        }
    }

    /**
     * Enable/disable feature controls
     * @param {boolean} enabled - Whether to enable
     */
    setFeatureControlsEnabled(enabled) {
        this.featureControls.enabled = enabled;
        this.updateControlState();
        this.dispatchEvent('featureControlsChanged', { enabled });
    }

    /**
     * Enable/disable specific feature control
     * @param {string} control - Control name (selection, interaction)
     * @param {boolean} enabled - Whether to enable
     */
    setFeatureControlEnabled(control, enabled) {
        const key = `${control}Enabled`;
        if (this.featureControls.hasOwnProperty(key)) {
            this.featureControls[key] = enabled;
            this.updateControlState();
            this.dispatchEvent('featureControlChanged', { control, enabled });
        }
    }

    /**
     * Update control state based on current mode
     */
    updateControlState() {
        // Disable default navigation when in special modes
        if (this.activeMode === 'measurement' || this.activeMode === 'cut') {
            // Measurement and cut modes handle their own navigation
            this.setMouseControlEnabled('pan', false);
            this.setMouseControlEnabled('zoom', false);
        } else {
            this.setMouseControlEnabled('pan', true);
            this.setMouseControlEnabled('zoom', true);
        }

        // Update Cesium camera controls
        if (this.tilesetViewer && this.tilesetViewer.viewer) {
            const controller = this.tilesetViewer.viewer.scene.screenSpaceCameraController;
            
            // Enable/disable camera controls based on mouse controls
            if (controller) {
                controller.enableRotate = this.mouseControls.rotateEnabled;
                controller.enableTranslate = this.mouseControls.panEnabled;
                controller.enableZoom = this.mouseControls.zoomEnabled;
                controller.enableTilt = this.mouseControls.rotateEnabled; // Tilt uses rotate controls
                controller.enableLook = this.mouseControls.rotateEnabled; // Look uses rotate controls
            }
        }
    }

    /**
     * Setup event system
     */
    setupEventSystem() {
        // Listen for mode changes from managers
        if (window.enhancedMeasurementManager) {
            window.addEventListener('measurementModeChanged', (e) => {
                this.setActiveMode(e.detail.active ? 'measurement' : null);
            });
        }

        if (window.cutByPolygonManager) {
            window.addEventListener('cutModeChanged', (e) => {
                this.setActiveMode(e.detail.active ? 'cut' : null);
            });
        }
    }

    /**
     * Dispatch control event
     * @param {string} eventName - Event name
     * @param {object} detail - Event detail
     */
    dispatchEvent(eventName, detail) {
        const event = new CustomEvent(`controlGovernance:${eventName}`, {
            detail: detail
        });
        window.dispatchEvent(event);
    }

    /**
     * Add event listener
     * @param {string} eventName - Event name
     * @param {function} callback - Callback function
     */
    addEventListener(eventName, callback) {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName).push(callback);
        
        window.addEventListener(`controlGovernance:${eventName}`, callback);
    }

    /**
     * Remove event listener
     * @param {string} eventName - Event name
     * @param {function} callback - Callback function
     */
    removeEventListener(eventName, callback) {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            const index = listeners.indexOf(callback);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        }
        
        window.removeEventListener(`controlGovernance:${eventName}`, callback);
    }

    /**
     * Get current control state
     * @returns {object} Current control state
     */
    getControlState() {
        return {
            activeMode: this.activeMode,
            mouseControls: { ...this.mouseControls },
            tileControls: { ...this.tileControls },
            featureControls: { ...this.featureControls }
        };
    }

    /**
     * Reset all controls to default state
     */
    reset() {
        this.activeMode = null;
        this.modeStack = [];
        this.mouseControls = {
            enabled: true,
            panEnabled: true,
            zoomEnabled: true,
            rotateEnabled: true,
            pickEnabled: true
        };
        this.tileControls = {
            enabled: true,
            loadEnabled: true,
            removeEnabled: true,
            visibilityEnabled: true,
            positioningEnabled: true
        };
        this.featureControls = {
            enabled: true,
            selectionEnabled: true,
            interactionEnabled: true
        };
        this.updateControlState();
        this.dispatchEvent('reset', {});
    }

    /**
     * Validate control configuration
     * @param {object} config - Configuration to validate
     * @returns {object} Validation result
     */
    validateConfig(config) {
        const errors = [];
        
        if (config.mouseControls) {
            const validControls = ['pan', 'zoom', 'rotate', 'pick'];
            for (const control of Object.keys(config.mouseControls)) {
                if (!validControls.includes(control.replace('Enabled', ''))) {
                    errors.push(`Invalid mouse control: ${control}`);
                }
            }
        }
        
        if (config.tileControls) {
            const validControls = ['load', 'remove', 'visibility', 'positioning'];
            for (const control of Object.keys(config.tileControls)) {
                if (!validControls.includes(control.replace('Enabled', ''))) {
                    errors.push(`Invalid tile control: ${control}`);
                }
            }
        }
        
        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Apply control configuration
     * @param {object} config - Configuration to apply
     */
    applyConfig(config) {
        const validation = this.validateConfig(config);
        if (!validation.valid) {
            console.error('Invalid control configuration:', validation.errors);
            return false;
        }

        if (config.mouseControls) {
            Object.assign(this.mouseControls, config.mouseControls);
        }
        
        if (config.tileControls) {
            Object.assign(this.tileControls, config.tileControls);
        }
        
        if (config.featureControls) {
            Object.assign(this.featureControls, config.featureControls);
        }
        
        this.updateControlState();
        this.dispatchEvent('configApplied', { config });
        return true;
    }
}

// Export singleton instance
window.controlGovernance = new ControlGovernance();
