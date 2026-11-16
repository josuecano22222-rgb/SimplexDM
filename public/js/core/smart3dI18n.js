/**
 * Smart3D toolbar / tooltips / panels — delegates to appI18n under `smart3d.*`.
 * Locale bundles: appI18n.locale-en.js / appI18n.locale-ar.js (loaded before this file).
 */
(function () {
    'use strict';

    function appI18n() {
        return typeof window !== 'undefined' ? window.appI18n : null;
    }

    function t(path) {
        const i18n = appI18n();
        if (i18n && typeof i18n.t === 'function') {
            const key = 'smart3d.' + path;
            const v = i18n.t(key);
            if (v !== key) return v;
        }
        return path;
    }

    function setLocale(code) {
        const i18n = appI18n();
        if (i18n && typeof i18n.setLocale === 'function') {
            return i18n.setLocale(code);
        }
        return 'en';
    }

    function getLocale() {
        const i18n = appI18n();
        if (i18n && typeof i18n.getLocale === 'function') {
            return i18n.getLocale();
        }
        return 'en';
    }

    if (typeof window !== 'undefined') {
        window.smart3dI18n = {
            dict: {},
            locales: { en: {}, ar: {} },
            supportedLocales: ['en', 'ar'],
            getLocale,
            setLocale,
            t
        };
    }
})();
