/**
 * InitializationManager
 * Optimized initialization manager that batches and defers non-critical initialization
 * Reduces initial load time and improves perceived performance
 */

class InitializationManager {
    constructor() {
        this.criticalQueue = [];
        this.normalQueue = [];
        this.deferredQueue = [];
        this.initialized = false;
        this.isIdle = false;
    }

    /**
     * Add critical initialization (must run immediately)
     */
    addCritical(initFn, name) {
        this.criticalQueue.push({ fn: initFn, name });
    }

    /**
     * Add normal initialization (runs after critical)
     */
    addNormal(initFn, name) {
        this.normalQueue.push({ fn: initFn, name });
    }

    /**
     * Add deferred initialization (runs when idle)
     */
    addDeferred(initFn, name) {
        this.deferredQueue.push({ fn: initFn, name });
    }

    /**
     * Execute initialization queue
     */
    async executeQueue(queue, queueName) {
        const results = [];
        for (const item of queue) {
            try {
                if (typeof item.fn === 'function') {
                    const result = await item.fn();
                    results.push({ name: item.name, success: true, result });
                } else if (item.fn && typeof item.fn.then === 'function') {
                    const result = await item.fn;
                    results.push({ name: item.name, success: true, result });
                } else {
                    results.push({
                        name: item.name,
                        success: false,
                        error: new Error('Invalid queue item: fn must be a function or a Promise')
                    });
                }
            } catch (error) {
                if (window.errorHandler) {
                    window.errorHandler.handle(error, {
                        component: 'InitializationManager',
                        action: `initialize-${item.name || 'unknown'}`
                    });
                } else {
                    console.error(`Initialization failed for ${item.name}:`, error);
                }
                results.push({ name: item.name, success: false, error });
            }
        }
        return results;
    }

    /**
     * Initialize critical modules
     */
    async initCritical() {
        if (this.criticalQueue.length === 0) return;
        
        // Execute critical queue synchronously
        await this.executeQueue(this.criticalQueue, 'critical');
        this.criticalQueue = [];
    }

    /**
     * Initialize normal modules (batched)
     */
    async initNormal() {
        if (this.normalQueue.length === 0) return;

        // Batch execute normal queue
        const batchSize = 5;
        for (let i = 0; i < this.normalQueue.length; i += batchSize) {
            const batch = this.normalQueue.slice(i, i + batchSize);
            await Promise.all(
                batch.map((item) =>
                    Promise.resolve()
                        .then(() => {
                            if (typeof item.fn !== 'function') {
                                throw new Error(`Invalid normal queue item "${item.name || 'unknown'}": fn must be a function`);
                            }
                            return item.fn();
                        })
                        .catch((error) => {
                            if (window.errorHandler) {
                                window.errorHandler.handle(error, {
                                    component: 'InitializationManager',
                                    action: `initialize-${item.name || 'unknown'}`
                                });
                            } else {
                                console.error(`Initialization failed for ${item.name}:`, error);
                            }
                        })
                )
            );

            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        
        this.normalQueue = [];
    }

    /**
     * Initialize deferred modules (when idle)
     */
    async initDeferred() {
        if (this.deferredQueue.length === 0) return;

        // Use requestIdleCallback if available, otherwise setTimeout
        const perf =
            window.jsonConfigManager && typeof window.jsonConfigManager.getPerformanceSettings === 'function'
                ? window.jsonConfigManager.getPerformanceSettings()
                : null;
        const yieldMs =
            perf && typeof perf.deferredInitYieldMs === 'number'
                ? Math.min(100, Math.max(0, perf.deferredInitYieldMs))
                : 10;
        const idleTimeout =
            perf && typeof perf.idleCallbackTimeoutMs === 'number'
                ? Math.min(10000, Math.max(100, perf.idleCallbackTimeoutMs))
                : 2000;

        const processDeferred = async () => {
            while (this.deferredQueue.length > 0) {
                const item = this.deferredQueue.shift();
                try {
                    await Promise.resolve(item.fn());
                } catch (error) {
                    if (window.errorHandler) {
                        window.errorHandler.handle(error, {
                            component: 'InitializationManager',
                            action: `initialize-${item.name || 'unknown'}`
                        });
                    }
                }

                await new Promise((resolve) => setTimeout(resolve, yieldMs));
            }
        };

        const runDeferred = () => {
            processDeferred().catch((err) => {
                if (window.errorHandler) {
                    window.errorHandler.handle(err, {
                        component: 'InitializationManager',
                        action: 'init-deferred'
                    });
                } else {
                    console.error('Deferred initialization failed:', err);
                }
            });
        };

        if (window.requestIdleCallback) {
            window.requestIdleCallback(runDeferred, { timeout: idleTimeout });
        } else {
            setTimeout(runDeferred, 1000);
        }
    }

    /**
     * Start initialization process
     */
    async init() {
        if (this.initialized) return;

        // Phase 1: Critical initialization (blocks until complete)
        await this.initCritical();

        // Phase 2: Normal initialization (batched, non-blocking)
        this.initNormal().catch(error => {
            if (window.errorHandler) {
                window.errorHandler.handle(error, {
                    component: 'InitializationManager',
                    action: 'init-normal'
                });
            }
        });

        // Phase 3: Deferred initialization (when idle)
        this.initDeferred();

        this.initialized = true;
    }

    /**
     * Wait for viewer to be ready (with timeout)
     */
    waitForViewer(timeout = 10000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const checkViewer = () => {
                if (window.tilesetViewer && window.tilesetViewer.viewer) {
                    resolve(window.tilesetViewer.viewer);
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error('Viewer initialization timeout'));
                } else {
                    requestAnimationFrame(checkViewer);
                }
            };
            checkViewer();
        });
    }
}

// Export singleton instance
if (typeof window !== 'undefined') {
    window.initializationManager = window.initializationManager || new InitializationManager();
}
