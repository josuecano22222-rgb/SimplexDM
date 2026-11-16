/**
 * App-wide i18n (English + Arabic). Locale bundles in appI18n.locale-en.js / appI18n.locale-ar.js
 * Smart3D toolbar strings live under `smart3d.*` (see smart3dI18n.js delegating here).
 */
(function (global) {
    'use strict';

    function deepGet(obj, path) {
        if (!obj || !path) return undefined;
        const parts = path.split('.');
        let cur = obj;
        for (let i = 0; i < parts.length; i++) {
            if (cur == null) return undefined;
            cur = cur[parts[i]];
        }
        return cur;
    }

    function normalizeLocale(code) {
        if (!code || typeof code !== 'string') return 'en';
        const c = code.trim().toLowerCase().split(/[-_]/)[0];
        return c === 'ar' ? 'ar' : 'en';
    }

    const bundles = {
        en: global.__SIMPLEX_LOCALE_EN || {},
        ar: global.__SIMPLEX_LOCALE_AR || {}
    };

    let activeLocale = 'en';

    function t(path) {
        if (!path || typeof path !== 'string') return '';
        let v = deepGet(bundles[activeLocale], path);
        if (typeof v !== 'string') v = deepGet(bundles.en, path);
        return typeof v === 'string' ? v : path;
    }

    function applyDom(root) {
        const el = root || document;
        el.querySelectorAll('[data-i18n]').forEach((node) => {
            const k = node.getAttribute('data-i18n');
            if (!k) return;
            const val = t(k);
            if (val !== k || !node.textContent.trim()) {
                node.textContent = val;
            }
        });
        el.querySelectorAll('[data-i18n-title]').forEach((node) => {
            const k = node.getAttribute('data-i18n-title');
            if (!k) return;
            const val = t(k);
            if (val !== k || !node.getAttribute('title')) {
                node.setAttribute('title', val);
            }
        });
        el.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
            const k = node.getAttribute('data-i18n-placeholder');
            if (!k) return;
            const val = t(k);
            if (val !== k || !node.getAttribute('placeholder')) {
                node.setAttribute('placeholder', val);
            }
        });
        el.querySelectorAll('[data-i18n-aria]').forEach((node) => {
            const k = node.getAttribute('data-i18n-aria');
            if (!k) return;
            const val = t(k);
            if (val !== k || !node.getAttribute('aria-label')) {
                node.setAttribute('aria-label', val);
            }
        });
        el.querySelectorAll('[data-i18n-html]').forEach((node) => {
            const k = node.getAttribute('data-i18n-html');
            if (!k) return;
            const val = t(k);
            if (val !== k || !node.innerHTML.trim()) {
                node.innerHTML = val;
            }
        });
    }

    function applyDocumentTitle() {
        const title = t('meta.pageTitle');
        if (title && title !== 'meta.pageTitle') {
            document.title = title;
        }
    }

    function setLocale(code) {
        const next = normalizeLocale(code);
        activeLocale = next;
        const langAttr =
            typeof code === 'string' && code.trim()
                ? code.trim()
                : next === 'ar'
                  ? 'ar'
                  : 'en';
        document.documentElement.setAttribute('lang', langAttr);
        document.documentElement.setAttribute('dir', next === 'ar' ? 'rtl' : 'ltr');
        applyDom(document);
        applyDocumentTitle();
        try {
            global.dispatchEvent(
                new CustomEvent('simplex:localeChanged', { detail: { locale: activeLocale } })
            );
        } catch (e) {
            /* ignore */
        }
        if (global.smart3dToolbarWireup && typeof global.smart3dToolbarWireup.refreshToolbarTitlesAndVisibility === 'function') {
            global.smart3dToolbarWireup.refreshToolbarTitlesAndVisibility();
        }
        return activeLocale;
    }

    function getLocale() {
        return activeLocale;
    }

    /** Resolve registry / dynamic label: `registry.modules.searchManager` etc. */
    function reg(path, fallback) {
        const x = t(path);
        return x !== path ? x : fallback || '';
    }

    /** Toast / notification strings under `notif.*` (locale part 3). */
    function nt(key) {
        if (!key || typeof key !== 'string') return '';
        return t('notif.' + key);
    }

    global.appI18n = {
        t,
        nt,
        reg,
        setLocale,
        getLocale,
        applyDom,
        applyDocumentTitle,
        normalizeLocale,
        supportedLocales: ['en', 'ar']
    };

    if (typeof document !== 'undefined') {
        const run = function () {
            applyDom(document);
            applyDocumentTitle();
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run);
        } else {
            run();
        }
    }
})(typeof window !== 'undefined' ? window : this);
