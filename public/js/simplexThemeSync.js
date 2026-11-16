/**
 * Synchronise meta tags, classe html.simplex-light et classes theme-light / theme-dark sur le body.
 * @param {HTMLElement|null} bodyEl — Si fourni, met à jour theme-light / theme-dark.
 * @param {'light'|'dark'|null|undefined} explicit — Si défini, utilise cette valeur au lieu de localStorage.
 */
(function () {
    'use strict';

    function readThemeFromStorage() {
        try {
            var raw = localStorage.getItem('simplex_runtime_overrides_v1');
            if (!raw) return 'dark';
            var o = JSON.parse(raw);
            var t = o && o.appConfig && o.appConfig.ui && o.appConfig.ui.theme;
            return t === 'light' ? 'light' : 'dark';
        } catch (e) {
            return 'dark';
        }
    }

    window.simplexThemeSync = function (bodyEl, explicit) {
        var theme =
            explicit === 'light' || explicit === 'dark'
                ? explicit
                : readThemeFromStorage();
        var light = theme === 'light';

        if (bodyEl) {
            bodyEl.classList.toggle('theme-light', light);
            bodyEl.classList.toggle('theme-dark', !light);
        }

        document.documentElement.classList.toggle('simplex-light', light);

        var m = document.querySelector('meta[name="color-scheme"]');
        if (m) m.setAttribute('content', light ? 'light' : 'dark');

        var tc = document.querySelector('meta[name="theme-color"]');
        if (tc) tc.setAttribute('content', light ? '#f1f5f9' : '#0a0d16');
    };
})();
