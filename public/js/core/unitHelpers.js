/**
 * Display-unit helpers (Tools.md §3.3 — convertToCurrUnit / convertToMetersIfNecessary).
 * Default: meters only.
 */
(function () {
    'use strict';

    function convertToCurrUnit(meters) {
        const n = Number(meters);
        return Number.isFinite(n) ? n : 0;
    }

    function convertToMetersIfNecessary(displayValue) {
        const n = Number(displayValue);
        return Number.isFinite(n) ? n : 0;
    }

    function getUnitForDisplay() {
        if (window.smart3dI18n && typeof window.smart3dI18n.t === 'function') {
            const u = window.smart3dI18n.t('measurement.displayUnits.meters');
            if (u && u !== 'measurement.displayUnits.meters') return u;
        }
        return 'm';
    }

    if (typeof window !== 'undefined') {
        window.convertToCurrUnit = convertToCurrUnit;
        window.convertToMetersIfNecessary = convertToMetersIfNecessary;
        window.getUnitForDisplay = getUnitForDisplay;
    }
})();
