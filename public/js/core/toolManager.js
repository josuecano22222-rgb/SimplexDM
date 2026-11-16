/**
 * Minimal tool registry (Tools.md §2, §3.3, §4.3).
 * Exclusive tools: only one analysis/measure mode at a time (LOS, viewshed, measure strip, radius).
 */
(function () {
    'use strict';

    const EXCLUSIVE_ANALYSIS = new Set(['createLineOfSight', 'viewshed']);
    const EXCLUSIVE_MEASURE = new Set(['measureToolbar', 'drawCylinder']);

    class ToolManager {
        constructor() {
            this._tools = new Map();
            /** When true, measureToolbar activate skips turning off drawCylinder (nested enable). */
            this._suspendExclusive = false;
        }

        /**
         * Run fn with exclusive coordination suspended (e.g. drawCylinder enabling measureToolbar).
         */
        suspendExclusive(fn) {
            this._suspendExclusive = true;
            try {
                return fn();
            } finally {
                this._suspendExclusive = false;
            }
        }

        _deactivateExclusivePeers(name) {
            for (const [otherName, otherTool] of this._tools) {
                if (otherName === name || !otherTool._active) continue;

                let shouldOff = false;
                if (EXCLUSIVE_ANALYSIS.has(name) && EXCLUSIVE_ANALYSIS.has(otherName)) {
                    shouldOff = true;
                }
                if (EXCLUSIVE_ANALYSIS.has(name) && EXCLUSIVE_MEASURE.has(otherName)) {
                    shouldOff = true;
                }
                if (EXCLUSIVE_MEASURE.has(name) && EXCLUSIVE_ANALYSIS.has(otherName)) {
                    shouldOff = true;
                }
                if (EXCLUSIVE_MEASURE.has(name) && EXCLUSIVE_MEASURE.has(otherName)) {
                    if (name === 'drawCylinder' && otherName === 'measureToolbar') {
                        continue;
                    }
                    if (name === 'measureToolbar' && otherName === 'drawCylinder') {
                        shouldOff = true;
                    }
                }

                if (shouldOff) {
                    if (name === 'measureToolbar' && otherName === 'drawCylinder' && this._suspendExclusive) {
                        continue;
                    }
                    otherTool.enabled = false;
                }
            }
        }

        createTool(name, activate, deactivate) {
            const self = this;
            const tool = {
                _active: false,
                showPickHelper: true
            };
            Object.defineProperty(tool, 'enabled', {
                get() {
                    return tool._active;
                },
                set(v) {
                    const on = !!v;
                    if (tool._active === on) return;
                    if (on) {
                        self._deactivateExclusivePeers(name);
                    }
                    tool._active = on;
                    if (on) activate.call(tool);
                    else deactivate.call(tool);
                },
                enumerable: true,
                configurable: true
            });
            tool.toggle = function () {
                tool.enabled = !tool.enabled;
            };
            this._tools.set(name, tool);
            return tool;
        }

        getTool(name) {
            return this._tools.get(name);
        }
    }

    if (typeof window !== 'undefined') {
        window.toolManager = new ToolManager();
    }
})();
