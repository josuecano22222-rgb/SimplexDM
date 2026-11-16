/**
 * RenderLoopManager
 * Centralized render loop management to consolidate multiple postRender listeners
 * Reduces overhead from multiple event listeners running every frame
 */

class RenderLoopManager {
    constructor() {
        this.viewer = null;
        this.scene = null;
        this.callbacks = new Set();
        this.isInitialized = false;
        this.postRenderListener = null;
        /** Max time (ms) per frame for postRender callbacks — aligns with 60fps budget (WCAG / RAIL-style). */
        this.frameBudgetMs = 8;
    }

    /**
     * @param {number} ms - Clamped to [1, 16] ms (one frame at 60fps ≈ 16.67ms total).
     */
    setFrameBudgetMs(ms) {
        const n = Number(ms);
        if (!Number.isFinite(n)) return;
        this.frameBudgetMs = Math.min(16, Math.max(1, n));
    }

    getFrameBudgetMs() {
        return this.frameBudgetMs;
    }

    /**
     * Initialize render loop manager
     * @param {Object} viewer - Cesium viewer instance
     */
    init(viewer) {
        if (this.isInitialized) {
            console.warn('RenderLoopManager already initialized');
            return;
        }

        if (!viewer || !viewer.scene) {
            console.warn('RenderLoopManager: Viewer not available');
            return;
        }

        this.viewer = viewer;
        this.scene = viewer.scene;

        // Set up single postRender listener
        this.postRenderListener = () => {
            this.executeCallbacks();
        };

        this.scene.postRender.addEventListener(this.postRenderListener);
        this.isInitialized = true;

        if (window.jsonConfigManager && typeof window.jsonConfigManager.getPerformanceSettings === 'function') {
            const p = window.jsonConfigManager.getPerformanceSettings();
            if (p && typeof p.renderLoopFrameBudgetMs === 'number') {
                this.setFrameBudgetMs(p.renderLoopFrameBudgetMs);
            }
        }

        console.log('RenderLoopManager initialized');
    }

    /**
     * Register a callback to run on each frame
     * @param {Function} callback - Function to call each frame
     * @param {Object} context - Optional context object
     * @returns {Function} Unregister function
     */
    register(callback, context = null) {
        if (typeof callback !== 'function') {
            console.warn('RenderLoopManager: Callback must be a function');
            return () => {};
        }

        const wrappedCallback = context 
            ? callback.bind(context)
            : callback;

        this.callbacks.add(wrappedCallback);

        // Return unregister function
        return () => {
            this.callbacks.delete(wrappedCallback);
        };
    }

    /**
     * Unregister a callback
     * @param {Function} callback - Callback to unregister
     */
    unregister(callback) {
        this.callbacks.delete(callback);
    }

    /**
     * Execute all registered callbacks
     * @private
     */
    executeCallbacks(startIndex = 0) {
        const callbacks = Array.from(this.callbacks);
        if (callbacks.length === 0) return;

        const startTime = performance.now();
        const maxExecutionTime = this.frameBudgetMs;

        for (let i = startIndex; i < callbacks.length; i++) {
            if (performance.now() - startTime > maxExecutionTime) {
                const next = i;
                requestAnimationFrame(() => this.executeCallbacks(next));
                return;
            }
            try {
                callbacks[i]();
            } catch (error) {
                if (window.errorHandler) {
                    window.errorHandler.handle(error, {
                        component: 'RenderLoopManager',
                        action: 'executeCallback'
                    });
                } else {
                    console.error('RenderLoopManager: Error in callback:', error);
                }
            }
        }
    }

    /**
     * Get number of registered callbacks
     * @returns {number}
     */
    getCallbackCount() {
        return this.callbacks.size;
    }

    /**
     * Clear all callbacks
     */
    clear() {
        this.callbacks.clear();
    }

    /**
     * Cleanup - remove event listener and clear callbacks
     */
    cleanup() {
        if (this.scene && this.postRenderListener) {
            this.scene.postRender.removeEventListener(this.postRenderListener);
            this.postRenderListener = null;
        }

        this.clear();
        this.viewer = null;
        this.scene = null;
        this.isInitialized = false;
    }
}

// Export singleton instance
if (typeof window !== 'undefined') {
    window.renderLoopManager = window.renderLoopManager || new RenderLoopManager();
}
