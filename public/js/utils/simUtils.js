/**
 * SIM-inspired utility helpers used by integration modules.
 * Pure browser-compatible helpers (no external dependencies).
 */
(function () {
    'use strict';

    function isArray(value) {
        return Array.isArray(value);
    }

    function isNullish(value) {
        return value === null || value === undefined;
    }

    function hasOwn(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    function find(list, predicate) {
        if (!isArray(list) || typeof predicate !== 'function') {
            return undefined;
        }
        for (let i = 0; i < list.length; i += 1) {
            if (predicate(list[i])) {
                return list[i];
            }
        }
        return undefined;
    }

    function eachArray(list, iterator) {
        if (!isArray(list) || typeof iterator !== 'function') {
            return;
        }
        list.forEach(iterator);
    }

    function each(obj, iterator) {
        if (isNullish(obj) || typeof iterator !== 'function') {
            return;
        }
        if (isArray(obj)) {
            obj.forEach(iterator);
            return;
        }
        for (const key in obj) {
            if (hasOwn(obj, key)) {
                iterator(obj[key], key);
            }
        }
    }

    function extend(target) {
        const out = target || {};
        for (let i = 1; i < arguments.length; i += 1) {
            const source = arguments[i];
            if (!source) {
                continue;
            }
            for (const key in source) {
                if (hasOwn(source, key) && source[key] !== undefined) {
                    out[key] = source[key];
                }
            }
        }
        return out;
    }

    function entries(obj) {
        const source = obj || {};
        const keys = Object.keys(source);
        const result = new Array(keys.length);
        for (let i = 0; i < keys.length; i += 1) {
            result[i] = [keys[i], source[keys[i]]];
        }
        return result;
    }

    function trySafe(fn) {
        try {
            return fn();
        } catch (_err) {
            return undefined;
        }
    }

    function addEventListenerSafe(element, eventName, callback, options) {
        if (!element || typeof element.addEventListener !== 'function') {
            return;
        }
        const opts = options || {};
        const capture = opts.capture === true;
        const passive = opts.passive !== false;
        element.addEventListener(eventName, callback, { capture: capture, passive: passive });
    }

    window.simUtils = {
        find: find,
        eachArray: eachArray,
        each: each,
        extend: extend,
        entries: entries,
        trySafe: trySafe,
        addEventListener: addEventListenerSafe
    };
})();
