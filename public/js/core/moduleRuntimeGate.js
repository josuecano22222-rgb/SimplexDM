/**
 * Central gate for optional feature-manager init() calls (see index.html init queue).
 * Reads jsonConfigManager.modules.<key>.enabled; defaults to enabled when unset.
 */
(function () {
    'use strict';

    function shouldInitModule(key) {
        if (!key || typeof key !== 'string') return true;
        if (!window.jsonConfigManager || typeof window.jsonConfigManager.getModuleConfig !== 'function') {
            return true;
        }
        try {
            const c = window.jsonConfigManager.getModuleConfig(key);
            return c.enabled !== false;
        } catch (e) {
            return true;
        }
    }

    window.moduleRuntimeGate = {
        shouldInitModule
    };
})();
