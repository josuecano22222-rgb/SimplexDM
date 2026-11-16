/**
 * Live editors for `window.t` scene visualization numbers (display modes sub-toolbar).
 * Updates config in memory and re-applies active modes via smart3dToolbarWireup.refreshActiveSceneParameters.
 *
 * Relationship to the rest of the Display modes unit:
 * - Rendered inside `#sceneModesSettingsHost` when `#toolbarSE` is expanded (`#special_effects` on the map strip).
 * - Edits `SceneModes` (transparency α, fog, depth fog, height divisors, ortho factor, slope thresholds, snow/rain fog, imagery tone).
 * - Does not own the quick-toggle buttons in the ribbon; those call `handleSceneModeButton` in `smart3dToolbarWireup.js`.
 * - Advanced-only features (wireframe, contours, …) live in `displayModesManager` modal, opened via `#openDisplayModesAdvancedBtn`.
 */
(function () {
    'use strict';

    let debounceRefresh = null;
    let wired = false;

    function scheduleRefresh() {
        if (debounceRefresh) clearTimeout(debounceRefresh);
        debounceRefresh = setTimeout(function () {
            debounceRefresh = null;
            if (window.smart3dToolbarWireup && typeof window.smart3dToolbarWireup.refreshActiveSceneParameters === 'function') {
                window.smart3dToolbarWireup.refreshActiveSceneParameters();
            }
        }, 140);
    }

    function ensureT() {
        if (window.jsonConfigManager && typeof window.jsonConfigManager.mergeOptionalToolsTIntoDefaults === 'function') {
            window.t = window.jsonConfigManager.mergeOptionalToolsTIntoDefaults(window.t || {});
        }
        return window.t || {};
    }

    function syncField(id, value) {
        var el = document.getElementById(id);
        if (el && el.value !== String(value)) el.value = value;
    }

    function readNum(id, fallback) {
        var el = document.getElementById(id);
        if (!el) return fallback;
        var v = parseFloat(el.value);
        return Number.isFinite(v) ? v : fallback;
    }

    function syncFromT() {
        var t = ensureT();
        var sm = t.SceneModes || {};
        var tr = sm.transparency || {};
        var fog = sm.fog || {};
        var dist = sm.distance || {};
        var height = sm.height || {};
        var remap = sm.remapColors || {};
        var ortho = sm.ortho || {};
        var slope = sm.slope || {};
        var snow = sm.snow || {};
        var rain = sm.rain || {};
        var tune = t.SceneTuning || {};

        syncField('sm_transparency_alpha', (typeof tr.alpha === 'number' ? tr.alpha : 0.45).toFixed(2));
        syncField('sm_fog_density', (typeof fog.density === 'number' ? fog.density : 0.0004).toFixed(6));
        syncField('sm_fog_min_brightness', (typeof fog.minimumBrightness === 'number' ? fog.minimumBrightness : 0.35).toFixed(2));
        syncField('sm_distance_density', (typeof dist.density === 'number' ? dist.density : 0.0025).toFixed(6));
        syncField('sm_height_divisor', String(typeof height.heightDivisor === 'number' ? height.heightDivisor : 200));
        syncField('sm_remap_divisor', String(typeof remap.heightDivisor === 'number' ? remap.heightDivisor : 25));
        syncField('sm_ortho_factor', (typeof ortho.orthoWidthFactor === 'number' ? ortho.orthoWidthFactor : 0.35).toFixed(2));
        syncField('sm_slope_t1', String(typeof slope.thresholdDeg1 === 'number' ? slope.thresholdDeg1 : 15));
        syncField('sm_slope_t2', String(typeof slope.thresholdDeg2 === 'number' ? slope.thresholdDeg2 : 30));
        syncField('sm_slope_t3', String(typeof slope.thresholdDeg3 === 'number' ? slope.thresholdDeg3 : 45));
        syncField('sm_slope_grid', String(typeof slope.gridSamples === 'number' ? slope.gridSamples : 20));
        syncField('sm_snow_density', (typeof snow.density === 'number' ? snow.density : 0.0018).toFixed(6));
        syncField('sm_snow_brightness', (typeof snow.minimumBrightness === 'number' ? snow.minimumBrightness : 0.65).toFixed(2));
        syncField('sm_rain_density', (typeof rain.density === 'number' ? rain.density : 0.0012).toFixed(6));
        syncField('sm_rain_brightness', (typeof rain.minimumBrightness === 'number' ? rain.minimumBrightness : 0.45).toFixed(2));
        syncField('sm_imagery_contrast', (typeof tune.imageryContrast === 'number' ? tune.imageryContrast : 1).toFixed(2));
        syncField('sm_imagery_brightness', (typeof tune.imageryBrightness === 'number' ? tune.imageryBrightness : 1).toFixed(2));
    }

    function writeFromFields() {
        var t = ensureT();
        if (!t.SceneModes) t.SceneModes = {};
        if (!t.SceneTuning) t.SceneTuning = { imageryContrast: 1, imageryBrightness: 1 };

        var a = readNum('sm_transparency_alpha', 0.45);
        t.SceneModes.transparency = t.SceneModes.transparency || {};
        t.SceneModes.transparency.alpha = Math.min(1, Math.max(0.05, a));

        t.SceneModes.fog = t.SceneModes.fog || {};
        t.SceneModes.fog.density = Math.min(0.01, Math.max(0.00001, readNum('sm_fog_density', 0.0004)));
        t.SceneModes.fog.minimumBrightness = Math.min(1, Math.max(0, readNum('sm_fog_min_brightness', 0.35)));

        t.SceneModes.distance = t.SceneModes.distance || {};
        t.SceneModes.distance.density = Math.min(0.02, Math.max(0.0001, readNum('sm_distance_density', 0.0025)));

        t.SceneModes.height = t.SceneModes.height || {};
        t.SceneModes.height.heightDivisor = Math.min(5000, Math.max(1, Math.round(readNum('sm_height_divisor', 200))));

        t.SceneModes.remapColors = t.SceneModes.remapColors || {};
        t.SceneModes.remapColors.heightDivisor = Math.min(5000, Math.max(1, Math.round(readNum('sm_remap_divisor', 25))));

        t.SceneModes.ortho = t.SceneModes.ortho || {};
        t.SceneModes.ortho.orthoWidthFactor = Math.min(2, Math.max(0.05, readNum('sm_ortho_factor', 0.35)));

        t.SceneModes.slope = t.SceneModes.slope || {};
        var s1 = Math.min(89, Math.max(1, Math.round(readNum('sm_slope_t1', 15))));
        var s2 = Math.min(89, Math.max(1, Math.round(readNum('sm_slope_t2', 30))));
        var s3 = Math.min(89, Math.max(1, Math.round(readNum('sm_slope_t3', 45))));
        var sorted = [s1, s2, s3].sort(function (x, y) {
            return x - y;
        });
        t.SceneModes.slope.thresholdDeg1 = sorted[0];
        t.SceneModes.slope.thresholdDeg2 = sorted[1];
        t.SceneModes.slope.thresholdDeg3 = sorted[2];
        t.SceneModes.slope.gridSamples = Math.min(80, Math.max(6, Math.round(readNum('sm_slope_grid', 20))));

        t.SceneModes.snow = t.SceneModes.snow || {};
        t.SceneModes.snow.density = Math.min(0.02, Math.max(0.0001, readNum('sm_snow_density', 0.0018)));
        t.SceneModes.snow.minimumBrightness = Math.min(1, Math.max(0, readNum('sm_snow_brightness', 0.65)));

        t.SceneModes.rain = t.SceneModes.rain || {};
        t.SceneModes.rain.density = Math.min(0.02, Math.max(0.0001, readNum('sm_rain_density', 0.0012)));
        t.SceneModes.rain.minimumBrightness = Math.min(1, Math.max(0, readNum('sm_rain_brightness', 0.45)));

        t.SceneTuning.imageryContrast = Math.min(3, Math.max(0.2, readNum('sm_imagery_contrast', 1)));
        t.SceneTuning.imageryBrightness = Math.min(3, Math.max(0.2, readNum('sm_imagery_brightness', 1)));
    }

    function buildMarkup(host) {
        if (!host || host.getAttribute('data-built') === '1') return;
        host.setAttribute('data-built', '1');
        host.innerHTML = [
            '<div class="scene-param-grid">',
            '<div class="scene-param-group"><span class="scene-param-group-title">Tile &amp; fog</span>',
            '<label class="scene-param"><span>Transparency α</span><input id="sm_transparency_alpha" type="number" step="0.05" min="0.05" max="1" class="scene-param-input"></label>',
            '<label class="scene-param"><span>Fog density</span><input id="sm_fog_density" type="number" step="0.0001" min="0.00001" max="0.01" class="scene-param-input"></label>',
            '<label class="scene-param"><span>Fog min brightness</span><input id="sm_fog_min_brightness" type="number" step="0.05" min="0" max="1" class="scene-param-input"></label>',
            '<label class="scene-param"><span>Depth fog density</span><input id="sm_distance_density" type="number" step="0.0001" min="0.0001" max="0.02" class="scene-param-input"></label>',
            '</div>',
            '<div class="scene-param-group"><span class="scene-param-group-title">Height &amp; camera</span>',
            '<label class="scene-param"><span>Height ramp ÷ (m)</span><input id="sm_height_divisor" type="number" step="1" min="1" max="5000" class="scene-param-input"></label>',
            '<label class="scene-param"><span>Thematic ÷ (m)</span><input id="sm_remap_divisor" type="number" step="1" min="1" max="5000" class="scene-param-input"></label>',
            '<label class="scene-param"><span>Ortho width factor</span><input id="sm_ortho_factor" type="number" step="0.05" min="0.05" max="2" class="scene-param-input"></label>',
            '</div>',
            '<div class="scene-param-group"><span class="scene-param-group-title">Slope</span>',
            '<label class="scene-param"><span>Threshold 1°</span><input id="sm_slope_t1" type="number" step="1" min="1" max="89" class="scene-param-input"></label>',
            '<label class="scene-param"><span>Threshold 2°</span><input id="sm_slope_t2" type="number" step="1" min="1" max="89" class="scene-param-input"></label>',
            '<label class="scene-param"><span>Threshold 3°</span><input id="sm_slope_t3" type="number" step="1" min="1" max="89" class="scene-param-input"></label>',
            '<label class="scene-param"><span>Grid samples</span><input id="sm_slope_grid" type="number" step="1" min="6" max="80" class="scene-param-input"></label>',
            '</div>',
            '<div class="scene-param-group"><span class="scene-param-group-title">Weather &amp; imagery</span>',
            '<label class="scene-param"><span>Snow fog density</span><input id="sm_snow_density" type="number" step="0.0001" min="0.0001" max="0.02" class="scene-param-input"></label>',
            '<label class="scene-param"><span>Snow min brightness</span><input id="sm_snow_brightness" type="number" step="0.05" min="0" max="1" class="scene-param-input"></label>',
            '<label class="scene-param"><span>Rain fog density</span><input id="sm_rain_density" type="number" step="0.0001" min="0.0001" max="0.02" class="scene-param-input"></label>',
            '<label class="scene-param"><span>Rain min brightness</span><input id="sm_rain_brightness" type="number" step="0.05" min="0" max="1" class="scene-param-input"></label>',
            '<label class="scene-param"><span>Imagery contrast</span><input id="sm_imagery_contrast" type="number" step="0.05" min="0.2" max="3" class="scene-param-input"></label>',
            '<label class="scene-param"><span>Imagery brightness</span><input id="sm_imagery_brightness" type="number" step="0.05" min="0.2" max="3" class="scene-param-input"></label>',
            '</div>',
            '</div>'
        ].join('');
    }

    function wireInputs() {
        var host = document.getElementById('sceneModesSettingsHost');
        if (!host) return;
        buildMarkup(host);
        var inputs = host.querySelectorAll('input');
        for (var i = 0; i < inputs.length; i++) {
            inputs[i].addEventListener('change', function () {
                writeFromFields();
                syncFromT();
                scheduleRefresh();
            });
            inputs[i].addEventListener('input', function () {
                writeFromFields();
                scheduleRefresh();
            });
        }
    }

    function init() {
        if (wired) return;
        wired = true;
        wireInputs();
        syncFromT();
        window.addEventListener('smart3dOptionalToolsUpdated', function () {
            syncFromT();
        });
        window.addEventListener('jsonConfigUpdated', function () {
            syncFromT();
        });
    }

    window.sceneModesParameterPanel = {
        init: init,
        syncFromT: syncFromT
    };
})();
