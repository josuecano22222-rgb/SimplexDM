/**
 * Meridian — UI layer z-index registry
 *
 * Single numeric ladder shared with `public/css/ui-improvements.css` (:root --z-*).
 * Use `simplexUILayer.zIndex('KEY')` instead of magic numbers in style.zIndex.
 *
 * Stack (low → high):
 *   MAP_COMPASS (600) < VIEWER_TOOL_STRIP (800) < SIDEBAR (900) < RESTORE_PEEL (950)
 *   < NAVBAR (1000) < COORDINATE_RESEARCH_PANEL (1100) < CONTEXT_POPUP (10000)
 *   < MEASUREMENT_TOOLBAR (10001) < FEATURE_ACTION_PANEL (10002) < LAYERS_MENU_POPUP (10003)
 *   < DEBUG_OVERLAY (10100) < SIM_FLOATING (10040)* < SIM_MEASURE_HOST (10050) < NESTED_FLYOUT (10060)
 *   < MODAL (12000)
 *
 * *SIM_FLOATING is intentionally high in CSS for the in-viewer panel; numeric order in L
 *   follows the comment ladder for documentation — runtime uses explicit keys only.
 */
(function (global) {
    'use strict';

    if (global.simplexUILayer) {
        return;
    }

    /** @type {Readonly<Record<string, number>>} */
    const L = Object.freeze({
        MAP_COMPASS: 600,
        VIEWER_TOOL_STRIP: 800,
        SUB_TOOLBAR_SE: 800,
        SIDEBAR: 900,
        RESTORE_PEEL: 950,
        STATUS_BAR: 950,
        NAVBAR: 1000,
        COORDINATE_RESEARCH_PANEL: 1100,
        CONTEXT_POPUP: 10000,
        MEASUREMENT_TOOLBAR: 10001,
        FEATURE_ACTION_PANEL: 10002,
        LAYERS_MENU_POPUP: 10003,
        DEBUG_OVERLAY: 10100,
        SIM_FLOATING_PANEL: 10040,
        SIM_MEASURE_HOST: 10050,
        NESTED_FLYOUT: 10060,
        MODAL: 12000
    });

    /**
     * @param {keyof typeof L | string} key
     * @returns {string} z-index as string for assignment to element.style.zIndex
     */
    function zIndex(key) {
        const v = L[key];
        if (v == null) {
            console.warn('simplexUILayer: unknown layer key', key);
            return String(L.NAVBAR);
        }
        return String(v);
    }

    /**
     * @param {HTMLElement | null | undefined} el
     * @param {keyof typeof L | string} key
     */
    function apply(el, key) {
        if (el && el.style) {
            el.style.zIndex = zIndex(key);
        }
    }

    global.simplexUILayer = {
        L: L,
        zIndex: zIndex,
        apply: apply
    };
})(typeof window !== 'undefined' ? window : globalThis);
