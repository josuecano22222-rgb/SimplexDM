/**
 * Smart3D toolbar — cursor_master_prompt.md Sections C, D, G, H; Tools.md §2, §5.
 * Checklist #1 (cursor_master_prompt.md line 602): legacy Smart3D toolbar bundles are not loaded here;
 * measure / LOS / viewshed are implemented only via this module + lineOfSightManager + visibleHiddenAreasManager + vshd.
 */
(function () {
    'use strict';

    let measureToolbarIdsAssigned = false;
    let measureToolbarIdObserverRunning = false;
    var MAP_TOOLS_STRIP_STORAGE_KEY = 'simplex_map_tools_strip_collapsed';

    function loadMapToolsStripCollapsedPref() {
        try {
            return localStorage.getItem(MAP_TOOLS_STRIP_STORAGE_KEY) === '1';
        } catch (err) {
            return false;
        }
    }

    function persistMapToolsStripCollapsed(collapsed) {
        try {
            localStorage.setItem(MAP_TOOLS_STRIP_STORAGE_KEY, collapsed ? '1' : '0');
        } catch (err) {}
    }

    function syncMapToolsStripToggleLabels() {
        var root = document.getElementById('mapToolsStrip');
        var btn = document.getElementById('mapToolsStripToggle');
        if (!root || !btn) return;
        var collapsed = root.classList.contains('tools-strip--collapsed');
        var showKey = 'ui.viewer.toolsStripToggleShow';
        var hideKey = 'ui.viewer.toolsStripToggleHide';
        var label = collapsed ? 'Show map tools' : 'Hide map tools';
        if (window.appI18n && typeof window.appI18n.t === 'function') {
            label = collapsed ? window.appI18n.t(showKey) : window.appI18n.t(hideKey);
        }
        btn.setAttribute('title', label);
        btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }

    function wireMapToolsStripToggle() {
        var btn = document.getElementById('mapToolsStripToggle');
        var root = document.getElementById('mapToolsStrip');
        if (!btn || !root || btn.getAttribute('data-strip-toggle-wired') === '1') return;
        btn.setAttribute('data-strip-toggle-wired', '1');
        var startCollapsed = loadMapToolsStripCollapsedPref();
        root.classList.toggle('tools-strip--collapsed', startCollapsed);
        syncMapToolsStripToggleLabels();
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var next = !root.classList.contains('tools-strip--collapsed');
            root.classList.toggle('tools-strip--collapsed', next);
            persistMapToolsStripCollapsed(next);
            syncMapToolsStripToggleLabels();
        });
    }

    if (typeof window.fetch2 !== 'function') {
        window.fetch2 = function (url, options) {
            return fetch(url, options);
        };
    }

    /**
     * Apply `window.t.SceneTuning` (imagery contrast / brightness) to all Cesium imagery layers.
     */
    function applySceneTuningFromWindowT(viewer) {
        if (!viewer || !viewer.imageryLayers || !viewer.scene) return;
        var tune = window.t && window.t.SceneTuning;
        var c =
            tune && typeof tune.imageryContrast === 'number' && !Number.isNaN(tune.imageryContrast)
                ? tune.imageryContrast
                : 1;
        var b =
            tune && typeof tune.imageryBrightness === 'number' && !Number.isNaN(tune.imageryBrightness)
                ? tune.imageryBrightness
                : 1;
        var layers = viewer.imageryLayers;
        var i;
        for (i = 0; i < layers.length; i++) {
            var layer = layers.get(i);
            if (layer) {
                layer.contrast = c;
                layer.brightness = b;
            }
        }
        viewer.scene.requestRender();
    }
    window.applySceneTuningFromWindowT = applySceneTuningFromWindowT;

    function logButtonClick(name) {
        if (window.logger && typeof window.logger.info === 'function') {
            window.logger.info('ButtonClick', name);
        }
    }

    function load_pro_info(e) {
        if (e && e.preventDefault) e.preventDefault();
        if (window.notification && typeof window.notification.info === 'function') {
            window.notification.info(
                window.appI18n && window.appI18n.t ? window.appI18n.t('ui.notice.proInfo') : 'PRO'
            );
        }
    }

    function isMapToolPanelVisible(modalEl) {
        if (!modalEl) return false;
        try {
            return window.getComputedStyle(modalEl).display !== 'none';
        } catch (err) {
            return false;
        }
    }

    /**
     * Display modes (map rail): `#special_effects` toggles `#toolbarSE.expanded`.
     * Scene toggles → `handleSceneModeButton`; numeric fields → `sceneModesParameterPanel` in `#sceneModesSettingsHost`.
     * Advanced modal (`displayModesManager`, `#displayModesModal`) opens from `#openDisplayModesAdvancedBtn` or alias `displayModesAdvanced`.
     */

    /**
     * Collapse display-modes sub-rail and hide the gradient/BW panel (used by coordinator).
     */
    function forceCloseDisplayModesUi() {
        var tb = document.getElementById('toolbarSE');
        var panel = document.querySelector('.tools_special_effects');
        var fxBtn = document.getElementById('special_effects');
        if (tb) {
            tb.classList.remove('expanded');
            tb.setAttribute('aria-hidden', 'true');
            tb.setAttribute('aria-expanded', 'false');
        }
        if (panel) {
            panel.style.visibility = 'hidden';
            panel.setAttribute('aria-hidden', 'true');
            panel.classList.remove('visible');
        }
        if (fxBtn) {
            fxBtn.classList.remove('ActiveButton');
            fxBtn.setAttribute('aria-expanded', 'false');
        }
    }

    /**
     * Close other map tool UIs so only one tool surface is active (layers, measure, LOS, modals, etc.).
     * @param {string} exceptKey — Tool id or 'sceneMode' (keeps display-modes rail open for scene sub-buttons).
     */
    function closeOtherMapToolUis(exceptKey) {
        try {
            if (window.nestedToolbarManager && typeof window.nestedToolbarManager.hideAllToolbars === 'function') {
                window.nestedToolbarManager.hideAllToolbars();
            }
            if (window.toolbarManager && typeof window.toolbarManager.closeAllFlyouts === 'function') {
                window.toolbarManager.closeAllFlyouts();
            }
        } catch (err) {}

        if (exceptKey !== 'layersIC') {
            var lm = window.layersMenuManager;
            if (lm && typeof lm.hide === 'function') lm.hide();
            var lb = document.getElementById('layersIC');
            if (lb) lb.classList.remove('ActiveButton');
        }

        if (exceptKey !== 'measure') {
            var tm = window.toolManager;
            if (tm) {
                var mt = tm.getTool('measureToolbar');
                if (mt && mt.enabled) mt.enabled = false;
                var dc = tm.getTool('drawCylinder');
                if (dc && dc.enabled) dc.enabled = false;
            }
            var mbtn = document.getElementById('measure');
            if (mbtn) mbtn.classList.remove('ActiveButton');
        }

        if (exceptKey !== 'special_effects' && exceptKey !== 'sceneMode') {
            forceCloseDisplayModesUi();
        }

        if (exceptKey !== 'lineofsight') {
            var tmLos = window.toolManager && window.toolManager.getTool('createLineOfSight');
            if (tmLos && tmLos.enabled) tmLos.enabled = false;
        }

        if (exceptKey !== 'viewshed') {
            var tmVs = window.toolManager && window.toolManager.getTool('viewshed');
            if (tmVs && tmVs.enabled) tmVs.enabled = false;
        }

        if (exceptKey !== 'elevationProfile') {
            if (typeof window.closeElevationProfilePanel === 'function') {
                window.closeElevationProfilePanel();
            }
        }

        if (exceptKey !== 'share') {
            if (window.shareLocationManager && typeof window.shareLocationManager.hide === 'function') {
                window.shareLocationManager.hide();
            }
        }

        if (exceptKey !== 'printscreen') {
            if (window.screenshotManager && typeof window.screenshotManager.hide === 'function') {
                window.screenshotManager.hide();
            }
        }

        if (exceptKey !== 'streetview') {
            if (window.streetViewManager && typeof window.streetViewManager.hide === 'function') {
                window.streetViewManager.hide();
            }
        }

        if (exceptKey !== 'flightmode') {
            if (window.supermanFlightModeManager && typeof window.supermanFlightModeManager.hide === 'function') {
                window.supermanFlightModeManager.hide();
            }
        }

        if (exceptKey !== 'clipplane') {
            if (window.cutByPolygonManager && typeof window.cutByPolygonManager.hide === 'function') {
                window.cutByPolygonManager.hide();
            }
        }

        if (exceptKey !== 'split') {
            if (window.splitScreenManager && typeof window.splitScreenManager.hide === 'function') {
                window.splitScreenManager.hide();
            }
        }

        syncMapToolAriaFromDom();
    }

    function syncMapToolAriaFromDom() {
        ['layersIC', 'measure', 'lineofsight', 'viewshed', 'special_effects'].forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.setAttribute('aria-pressed', el.classList.contains('ActiveButton') ? 'true' : 'false');
        });
    }

    /**
     * Dock Ion measure toolbar above the bottom `.tools` strip (aligned with special_effects row);
     * sync CSS vars for legacy top-offset consumers.
     */
    function applyToolbarTopOffset() {
        const bar = document.querySelector('.cesium-viewer-toolbar');
        const measureEl = document.querySelector('.cesium-measure-toolbar');
        const tools = document.querySelector('.tools');
        const viewerContainer = document.querySelector('.viewer-container');
        const viewerRoot = document.getElementById('cesiumContainer') || document.querySelector('.cesium-viewer');

        const barH = bar ? Math.ceil(bar.getBoundingClientRect().height) : 34;
        const rowTop = 5 + barH + 8;

        const measureInDock =
            measureEl && document.getElementById('toolbarMeasure') && measureEl.closest && measureEl.closest('#toolbarMeasure');
        if (measureInDock) {
            measureEl.style.position = 'relative';
            measureEl.style.top = 'auto';
            measureEl.style.bottom = 'auto';
            measureEl.style.left = 'auto';
            measureEl.style.right = 'auto';
            measureEl.style.transform = 'none';
        } else if (measureEl && viewerContainer && tools) {
            const vcRect = viewerContainer.getBoundingClientRect();
            const toolsRect = tools.getBoundingClientRect();
            const gap = 8;
            const bottomPx = Math.max(8, Math.round(vcRect.bottom - toolsRect.top + gap));
            measureEl.style.position = '';
            measureEl.style.top = 'auto';
            measureEl.style.bottom = bottomPx + 'px';
            measureEl.style.left = '50%';
            measureEl.style.right = 'auto';
            measureEl.style.transform = 'translateX(-50%)';
        } else if (measureEl && !tools) {
            measureEl.style.position = '';
            measureEl.style.top = 'auto';
            measureEl.style.bottom = '64px';
            measureEl.style.left = '50%';
            measureEl.style.right = 'auto';
            measureEl.style.transform = 'translateX(-50%)';
        }

        if (viewerContainer) {
            viewerContainer.style.setProperty('--s3d-analysis-row-top', rowTop + 'px');
            const th = tools ? Math.ceil(tools.getBoundingClientRect().height) || 48 : 48;
            const panelsTop = rowTop + th + 12;
            viewerContainer.style.setProperty('--s3d-analysis-panels-top', panelsTop + 'px');
        }
        if (viewerRoot) {
            viewerRoot.style.setProperty('--s3d-analysis-row-top', rowTop + 'px');
        }
    }

    /** GIS-style default pointer when no tool locks navigation. */
    function restoreViewerCanvasCursorAndNavigation(viewer) {
        const v = viewer || getViewer();
        if (!v || !v.scene) return;
        const canvas = v.scene.canvas;
        if (canvas) {
            canvas.style.cursor = 'grab';
        }
        const sc = v.scene.screenSpaceCameraController;
        if (sc && (window.__simplexInputLocks || 0) === 0) {
            sc.enableInputs = true;
        }
    }

    function cursorForMeasureId(measureId) {
        if (!measureId) return 'grab';
        if (measureId === 'measure-collapse') return 'grab';
        if (measureId === 'maesure.horizontalDistance') return 'ew-resize';
        if (measureId === 'maesure.verticalDistance') return 'ns-resize';
        if (measureId === 'measure.radius') return 'crosshair';
        if (measureId.indexOf('maesure.') === 0) return 'crosshair';
        return 'crosshair';
    }

    let measureCursorClickWired = false;
    function wireMeasureToolbarCursorDelegation() {
        if (measureCursorClickWired) return;
        measureCursorClickWired = true;
        document.addEventListener(
            'click',
            function (ev) {
                const btn = ev.target && ev.target.closest && ev.target.closest('.cesium-measure-toolbar .cesium-measure-button');
                if (!btn) return;
                const mid = btn.getAttribute('measure-id') || '';
                const viewer = getViewer();
                if (!viewer || !viewer.scene) return;
                viewer.scene.canvas.style.cursor = cursorForMeasureId(mid);
            },
            true
        );
    }

    function collapseIonMeasureIfToolbarInactive(viewer) {
        const v = viewer || getViewer();
        const tm = window.toolManager;
        const mt = tm && tm.getTool('measureToolbar');
        if (mt && mt.enabled) return;
        quietCollapseIonMeasureUi(v);
    }

    /** Collapse Ion measure UI without clicking the main control (click would re-toggle / start distance mode). */
    function quietCollapseIonMeasureUi(viewer) {
        const v = viewer || getViewer();
        const f = window.ionSdkToolsFacade;
        if (f && typeof f.expandIonMeasureToolbar === 'function') {
            f.expandIonMeasureToolbar(false);
        } else if (v && v.measure && v.measure.viewModel) {
            v.measure.viewModel.expanded = false;
        }
        const tb = document.querySelector('.cesium-measure-toolbar');
        if (tb) tb.classList.remove('expanded');
    }

    function getViewer() {
        return window.tilesetViewer && window.tilesetViewer.viewer;
    }

    /** Move normative map toolbar nodes into `.cesium-viewer` (same subtree as canvas). */
    function reparentMapToolbarIntoViewer() {
        const cv = document.getElementById('cesiumContainer') || document.querySelector('.cesium-viewer');
        if (!cv) return false;
        const ids = ['toolbar', 'viewerModesStack', 'toolbarLOS', 'toolbarVSH', 'toolbarRadius', 'cut_surface_toolbox', 'editmodel'];
        ids.forEach(function (id) {
            const el = document.getElementById(id);
            if (el && el.parentNode !== cv) cv.appendChild(el);
        });
        const tools = document.querySelector('.tools');
        if (tools && tools.parentNode !== cv) cv.appendChild(tools);
        const tse = document.querySelector('.tools_special_effects');
        if (tse && tse.parentNode !== cv) cv.appendChild(tse);
        const ep = document.getElementById('modal_elevationProfile');
        if (ep && ep.parentNode !== cv) cv.appendChild(ep);
        return true;
    }

    function reparentMeasureToolbar() {
        const host = document.getElementById('toolbarMeasure');
        const cv = document.querySelector('.cesium-viewer');
        const bar = document.querySelector('.cesium-measure-toolbar');
        const target = host || cv;
        if (target && bar && bar.parentNode !== target) {
            target.appendChild(bar);
            reparentMapToolbarIntoViewer();
            if (typeof window.applyToolbarTopOffset === 'function') {
                window.applyToolbarTopOffset();
            }
            return true;
        }
        reparentMapToolbarIntoViewer();
        return !!(target && bar && bar.parentNode === target);
    }

    function setMeasureToolbarHostVisible(show) {
        const host = document.getElementById('toolbarMeasure');
        if (!host) return;
        host.style.display = show ? 'flex' : 'none';
        if (show) {
            host.classList.add('expanded');
            host.setAttribute('aria-hidden', 'false');
        } else {
            host.classList.remove('expanded');
            host.setAttribute('aria-hidden', 'true');
        }
        if (typeof window.applyToolbarTopOffset === 'function') {
            window.applyToolbarTopOffset();
        }
    }

    function scheduleMeasureToolbarReparent() {
        if (reparentMeasureToolbar()) return;
        const start = Date.now();
        const mo = new MutationObserver(function () {
            if (reparentMeasureToolbar()) {
                mo.disconnect();
                return;
            }
            if (Date.now() - start > 6000) {
                mo.disconnect();
            }
        });
        mo.observe(document.body, { childList: true, subtree: true });
        setTimeout(function () {
            try {
                mo.disconnect();
            } catch (e) {}
        }, 6000);
    }

    function assignMeasureIdsOnce(viewer) {
        const root = (viewer && viewer.container) || document;
        const mt = root.querySelector('.cesium-measure-toolbar');
        if (!mt) return false;
        if (!mt.querySelector('.cesium-measure-button-main')) return false;
        const buttons = mt.querySelectorAll('.cesium-measure-button:not(#drawCylinder)');
        /* Ion SDK versions differ in button count; assign ids for however many exist (min 2: main + one tool). */
        if (!buttons || buttons.length < 2) return false;
        const ids = [
            'measure-collapse',
            'maesure.distance',
            'maesure.componentDistance',
            'maesure.polylineDistance',
            'maesure.horizontalDistance',
            'maesure.verticalDistance',
            'maesure.HeightFromTerrain',
            'maesure.area',
            'maesure.pointCoordinates',
            'maesure.settingsAndHelp'
        ];
        const lim = Math.min(ids.length, buttons.length);
        for (let i = 0; i < lim; i++) {
            buttons[i].setAttribute('measure-id', ids[i]);
        }
        return true;
    }

    /** Runs assignMeasureIdsOnce after Ion bar + .cesium-measure-button-main exist (MutationObserver on viewer container / #cesiumContainer). */
    function scheduleAssignMeasureIdsWhenReady(viewer, onDone) {
        if (measureToolbarIdsAssigned) {
            if (typeof onDone === 'function') onDone(true);
            return;
        }
        if (measureToolbarIdObserverRunning) return;
        const container = (viewer && viewer.container) || document.getElementById('cesiumContainer') || document.body;
        function tryOnce() {
            return assignMeasureIdsOnce(viewer);
        }
        let completed = false;
        let mo = null;
        function finish(ok) {
            if (completed) return;
            completed = true;
            measureToolbarIdObserverRunning = false;
            if (ok) measureToolbarIdsAssigned = true;
            if (mo) {
                try {
                    mo.disconnect();
                } catch (e) {}
            }
            if (typeof onDone === 'function') onDone(ok);
        }
        if (tryOnce()) {
            finish(true);
            return;
        }
        measureToolbarIdObserverRunning = true;
        const start = Date.now();
        mo = new MutationObserver(function () {
            if (tryOnce()) {
                finish(true);
            } else if (Date.now() - start > 15000) {
                finish(false);
            }
        });
        mo.observe(container, { childList: true, subtree: true });
        setTimeout(function () {
            if (completed) return;
            if (tryOnce()) finish(true);
            else finish(false);
        }, 15000);
    }

    function setMeasureButtonTitles() {
        const t = window.smart3dI18n && window.smart3dI18n.t ? window.smart3dI18n.t : function (k) {
            return k;
        };
        const root = document.querySelector('.cesium-measure-toolbar');
        if (!root) return;
        const buttons = root.querySelectorAll('.cesium-measure-button');
        const map = [
            null,
            'maesure.distance',
            'maesure.componentDistance',
            'maesure.polylineDistance',
            'maesure.horizontalDistance',
            'maesure.verticalDistance',
            null,
            'maesure.area'
        ];
        for (let i = 1; i <= 7; i++) {
            if (i === 6) continue;
            const key = map[i];
            if (key && buttons[i]) {
                buttons[i].setAttribute('title', t(key));
            }
        }
    }

    function drawCylinderToolEnabled() {
        const d = window.toolManager && window.toolManager.getTool('drawCylinder');
        return d && d.enabled;
    }

    function registerMeasureToolbarTool() {
        const tm = window.toolManager;
        if (!tm || tm.getTool('measureToolbar')) return;

        let o = false;

        tm.createTool(
            'measureToolbar',
            function activate() {
                var toolSelf = this;
                const viewer = getViewer();
                if (!viewer || !viewer.scene) {
                    if (window.notification && typeof window.notification.warning === 'function') {
                        window.notification.warning(
                            window.appI18n && window.appI18n.nt
                                ? window.appI18n.nt('measureViewerNotReady')
                                : 'The 3D viewer is not ready. Try Measure again in a moment.'
                        );
                    }
                    queueMicrotask(function () {
                        try {
                            toolSelf.enabled = false;
                        } catch (e) {}
                    });
                    return;
                }
                if (viewer.scene.pickPositionSupported !== true) {
                    if (window.notification && typeof window.notification.warning === 'function') {
                        window.notification.warning(
                            window.appI18n && window.appI18n.nt
                                ? window.appI18n.nt('measurePickLimited')
                                : 'Depth picking is not available yet (no 3D surface). Load a tileset or terrain, then open Measure.'
                        );
                    }
                    queueMicrotask(function () {
                        try {
                            toolSelf.enabled = false;
                        } catch (e) {}
                    });
                    return;
                }
                if (!viewer.measure || !viewer.measure.viewModel) {
                    if (window.notification && typeof window.notification.warning === 'function') {
                        window.notification.warning(
                            window.appI18n && window.appI18n.nt
                                ? window.appI18n.nt('measureToolsWait')
                                : 'Measurement tools are not ready yet. Wait for the scene to finish loading.'
                        );
                    }
                    queueMicrotask(function () {
                        try {
                            toolSelf.enabled = false;
                        } catch (e) {}
                    });
                    return;
                }

                o = true;
                reparentMapToolbarIntoViewer();
                setMeasureToolbarHostVisible(true);
                scheduleMeasureToolbarReparent();
                if (typeof window.applyToolbarTopOffset === 'function') {
                    window.applyToolbarTopOffset();
                    requestAnimationFrame(function () {
                        window.applyToolbarTopOffset();
                    });
                }

                const mbtn = document.getElementById('measure');
                if (mbtn && !mbtn.classList.contains('ActiveButton')) {
                    mbtn.classList.add('ActiveButton');
                }

                if (!tm._suspendExclusive && drawCylinderToolEnabled()) {
                    const dc = tm.getTool('drawCylinder');
                    if (dc) dc.enabled = false;
                }

                if (!measureToolbarIdsAssigned) {
                    scheduleAssignMeasureIdsWhenReady(viewer, function () {});
                }
                /* Ion toggleActive flips expanded; do not click the main button here or we collapse right after opening. */
                if (window.ionSdkToolsFacade && typeof window.ionSdkToolsFacade.expandIonMeasureToolbar === 'function') {
                    window.ionSdkToolsFacade.expandIonMeasureToolbar(true);
                } else {
                    viewer.measure.viewModel.expanded = true;
                }
                setMeasureButtonTitles();
                wireMeasureToolbarCursorDelegation();
                if (viewer.scene && viewer.scene.canvas) {
                    viewer.scene.canvas.style.cursor = 'grab';
                }

                if (!tm._suspendExclusive && drawCylinderToolEnabled()) {
                    const dc = tm.getTool('drawCylinder');
                    if (dc) dc.enabled = false;
                }
            },
            function deactivate() {
                o = false;
                setMeasureToolbarHostVisible(false);
                const mbtn = document.getElementById('measure');
                if (mbtn) mbtn.classList.remove('ActiveButton');
                const v = getViewer();
                /* Collapse via viewModel only — programmatic click on the main measure button toggles expanded and would re-enable a measurement mode. */
                quietCollapseIonMeasureUi(v);
                restoreViewerCanvasCursorAndNavigation(v);
            }
        );

        const tool = tm.getTool('measureToolbar');
        if (tool) tool.showPickHelper = true;
    }

    function ensureDrawCylinderNode(viewer) {
        if (document.getElementById('drawCylinder')) {
            const el = document.getElementById('drawCylinder');
            if (window.smart3dI18n && window.smart3dI18n.t) {
                el.setAttribute('title', window.smart3dI18n.t('tooltips.tools.radius'));
            }
            return el;
        }

        const svgCircle =
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

        const wrap = document.createElement('div');
        wrap.className = 'cesium-measure-button';
        wrap.id = 'drawCylinder';
        wrap.setAttribute('measure-id', 'measure.radius');
        if (window.smart3dI18n && window.smart3dI18n.t) {
            wrap.setAttribute('title', window.smart3dI18n.t('tooltips.tools.radius'));
        }
        wrap.innerHTML = svgCircle;
        wrap.onclick = function () {
            logButtonClick('drawCylinder');
            const t = window.toolManager && window.toolManager.getTool('drawCylinder');
            if (t) t.toggle();
        };

        const host =
            (viewer && viewer.container && viewer.container.querySelector('.cesium-measure-toolbar')) ||
            document.querySelector('.cesium-measure-toolbar');
        if (host) {
            host.appendChild(wrap);
            return wrap;
        }

        const start = Date.now();
        const mo = new MutationObserver(function () {
            const h = document.querySelector('.cesium-measure-toolbar');
            if (h) {
                if (!document.getElementById('drawCylinder')) {
                    h.appendChild(wrap);
                }
                mo.disconnect();
            } else if (Date.now() - start > 6000) {
                mo.disconnect();
            }
        });
        const c = document.getElementById('cesiumContainer');
        if (c) mo.observe(c, { childList: true, subtree: true });
        return wrap;
    }

    function buildHorizontalCirclePositions(center, radiusMeters, steps) {
        if (
            !center ||
            !Number.isFinite(center.x) ||
            !Number.isFinite(center.y) ||
            !Number.isFinite(center.z) ||
            !Number.isFinite(radiusMeters) ||
            radiusMeters <= 0
        ) {
            return [];
        }
        const cart = Cesium.Cartographic.fromCartesian(center);
        if (
            !cart ||
            !Number.isFinite(cart.longitude) ||
            !Number.isFinite(cart.latitude) ||
            !Number.isFinite(cart.height)
        ) {
            return [];
        }
        const ellipsoid = Cesium.Ellipsoid.WGS84;
        const n = Math.min(256, Math.max(8, (steps | 0) || 64));
        const positions = [];
        for (let i = 0; i <= n; i++) {
            const angle = (i / n) * Cesium.Math.TWO_PI;
            const east = radiusMeters * Math.cos(angle);
            const north = radiusMeters * Math.sin(angle);
            const surf = Cesium.Cartesian3.fromRadians(cart.longitude, cart.latitude, cart.height);
            const enu = Cesium.Transforms.eastNorthUpToFixedFrame(surf, ellipsoid);
            const offset = new Cesium.Cartesian3(east, north, 0);
            const world = Cesium.Matrix4.multiplyByPoint(enu, offset, new Cesium.Cartesian3());
            positions.push(world);
        }
        return positions;
    }

    function registerDrawCylinderTool() {
        const tm = window.toolManager;
        if (!tm || tm.getTool('drawCylinder')) return;

        let handler = null;
        let keyEsc = null;
        let centerCartesian = null;
        let radiusPointCartesian = null;
        let entities = [];
        let modeStr = 'position';
        let mouseButtonsDown = 0;
        let onMouseButtonsChange = null;
        let onMouseLeave = null;

        function clearGraphics(viewer) {
            entities.forEach(function (e) {
                if (viewer && viewer.entities.contains(e)) viewer.entities.remove(e);
            });
            entities = [];
        }

        function resetMeasurementState() {
            centerCartesian = null;
            radiusPointCartesian = null;
        }

        const RADIUS_MIN_DISPLAY_M = 0.05;
        const RADIUS_MAX_M = 1000000;
        const RADIUS_LINE_COLOR = Cesium.Color.fromCssColorString('#22d3ee');
        const RADIUS_CENTER_COLOR = Cesium.Color.fromCssColorString('#fbbf24');
        const RADIUS_HINT =
            (window.appI18n && typeof window.appI18n.nt === 'function' && window.appI18n.nt('radiusMeasureDragHint')) ||
            'Move the mouse or click again to set radius';
        const RADIUS_TOO_LARGE =
            (window.appI18n && typeof window.appI18n.nt === 'function' && window.appI18n.nt('radiusMeasureTooLarge')) ||
            'Radius too large — pick a closer point';

        function rebuildRadiusGraphics(viewer) {
            clearGraphics(viewer);
            if (!viewer || !Cesium.defined(centerCartesian) || !Cesium.defined(radiusPointCartesian)) return;

            const dist = Cesium.Cartesian3.distance(centerCartesian, radiusPointCartesian);
            const centerPt = viewer.entities.add({
                position: centerCartesian,
                point: {
                    pixelSize: 14,
                    color: RADIUS_CENTER_COLOR,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                }
            });
            entities.push(centerPt);

            if (!Number.isFinite(dist)) {
                return;
            }
            if (dist > RADIUS_MAX_M) {
                const warn = viewer.entities.add({
                    position: centerCartesian,
                    label: {
                        text: RADIUS_TOO_LARGE,
                        font: '14px sans-serif',
                        fillColor: Cesium.Color.WHITE,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 3,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        pixelOffset: new Cesium.Cartesian2(0, -28),
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        showBackground: true,
                        backgroundColor: Cesium.Color.fromCssColorString('#7f1d1d').withAlpha(0.9),
                        backgroundPadding: new Cesium.Cartesian2(10, 6)
                    }
                });
                entities.push(warn);
                return;
            }

            if (dist < RADIUS_MIN_DISPLAY_M) {
                const hint = viewer.entities.add({
                    position: centerCartesian,
                    label: {
                        text: RADIUS_HINT,
                        font: '14px sans-serif',
                        fillColor: Cesium.Color.WHITE,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 3,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        pixelOffset: new Cesium.Cartesian2(0, -28),
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        showBackground: true,
                        backgroundColor: Cesium.Color.fromCssColorString('#0f172a').withAlpha(0.88),
                        backgroundPadding: new Cesium.Cartesian2(10, 6)
                    }
                });
                entities.push(hint);
                return;
            }

            const conv = window.convertToCurrUnit || function (m) {
                return m;
            };
            const gud = window.getUnitForDisplay || function () {
                return 'm';
            };
            const labelText = conv(dist).toFixed(2) + ' ' + gud();

            const labelEnt = viewer.entities.add({
                position: radiusPointCartesian,
                label: {
                    text: labelText,
                    font: 'bold 14px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 3,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    showBackground: true,
                    backgroundColor: Cesium.Color.fromCssColorString('#0f172a').withAlpha(0.85),
                    backgroundPadding: new Cesium.Cartesian2(8, 5)
                }
            });
            entities.push(labelEnt);

            const arrow = viewer.entities.add({
                polyline: {
                    positions: [centerCartesian, radiusPointCartesian],
                    width: 4,
                    material: RADIUS_LINE_COLOR,
                    depthFailMaterial: RADIUS_LINE_COLOR.withAlpha(0.92),
                    arcType: Cesium.ArcType.NONE
                }
            });
            entities.push(arrow);

            const circlePos = buildHorizontalCirclePositions(centerCartesian, dist, 64);
            if (circlePos.length >= 2) {
                const ringColor = RADIUS_CENTER_COLOR.withAlpha(0.95);
                const circle = viewer.entities.add({
                    polyline: {
                        positions: circlePos,
                        width: 3,
                        material: ringColor,
                        depthFailMaterial: ringColor.withAlpha(0.85),
                        arcType: Cesium.ArcType.NONE
                    }
                });
                entities.push(circle);
            }
        }

        tm.createTool(
            'drawCylinder',
            function activate() {
                const viewer = getViewer();
                if (!viewer || !viewer.scene || viewer.scene.pickPositionSupported !== true) return;

                const mt = tm.getTool('measureToolbar');
                if (!mt || !mt.enabled) {
                    tm.suspendExclusive(function () {
                        mt.enabled = true;
                    });
                }

                const tb = document.querySelector('.cesium-measure-toolbar');
                if (tb) tb.classList.add('expanded');

                const mbtn = document.getElementById('measure');
                if (mbtn && !mbtn.classList.contains('ActiveButton')) {
                    mbtn.classList.add('ActiveButton');
                }

                if (window.ionSdkToolsFacade && typeof window.ionSdkToolsFacade.clearSelectedMeasurementMode === 'function') {
                    window.ionSdkToolsFacade.clearSelectedMeasurementMode();
                }

                const dcBtn = document.getElementById('drawCylinder');
                if (dcBtn) dcBtn.classList.add('active');

                if (viewer.scene && viewer.scene.canvas) {
                    viewer.scene.canvas.style.cursor = 'crosshair';
                }

                modeStr = window.ismobile ? 'mobilePosition' : 'position';

                handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
                onMouseButtonsChange = function (ev) {
                    mouseButtonsDown = ev && typeof ev.buttons === 'number' ? ev.buttons : 0;
                };
                onMouseLeave = function () {
                    mouseButtonsDown = 0;
                };
                viewer.scene.canvas.addEventListener('mousemove', onMouseButtonsChange, { passive: true });
                viewer.scene.canvas.addEventListener('mousedown', onMouseButtonsChange, { passive: true });
                viewer.scene.canvas.addEventListener('mouseup', onMouseButtonsChange, { passive: true });
                viewer.scene.canvas.addEventListener('mouseleave', onMouseLeave, { passive: true });

                function onPick(click) {
                    const p = window.safePickPosition(viewer, click.position);
                    if (!Cesium.defined(p)) return;
                    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return;
                    if (!centerCartesian) {
                        centerCartesian = Cesium.Cartesian3.clone(p, new Cesium.Cartesian3());
                        radiusPointCartesian = Cesium.Cartesian3.clone(p, new Cesium.Cartesian3());
                    } else {
                        radiusPointCartesian = Cesium.Cartesian3.clone(p, new Cesium.Cartesian3());
                    }
                    rebuildRadiusGraphics(viewer);
                }

                function onMove(move) {
                    if (modeStr === 'mobilePosition') return;
                    if (!centerCartesian) return;
                    if (mouseButtonsDown !== 0) return;
                    const p = window.safePickPosition(viewer, move.endPosition);
                    if (!Cesium.defined(p)) return;
                    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return;
                    radiusPointCartesian = Cesium.Cartesian3.clone(p, new Cesium.Cartesian3());
                    rebuildRadiusGraphics(viewer);
                }

                handler.setInputAction(onPick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
                if (!window.ismobile) {
                    handler.setInputAction(onMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
                }

                keyEsc = function (ev) {
                    if (ev.key === 'Escape') {
                        if (keyEsc) {
                            window.removeEventListener('keydown', keyEsc);
                            keyEsc = null;
                        }
                        if (window.__SMART3D_CHECKLIST_HOOKS) {
                            window.__SMART3D_CHECKLIST_HOOKS.drawCylinderEscapeKeyListenerActive = false;
                        }
                        const t = tm.getTool('drawCylinder');
                        if (t) t.enabled = false;
                    }
                };
                window.addEventListener('keydown', keyEsc);
                if (window.__SMART3D_CHECKLIST_HOOKS) {
                    window.__SMART3D_CHECKLIST_HOOKS.drawCylinderEscapeKeyListenerActive = true;
                }
            },
            function deactivate() {
                const viewer = getViewer();
                if (keyEsc) {
                    window.removeEventListener('keydown', keyEsc);
                    keyEsc = null;
                }
                if (window.__SMART3D_CHECKLIST_HOOKS) {
                    window.__SMART3D_CHECKLIST_HOOKS.drawCylinderEscapeKeyListenerActive = false;
                }
                if (handler && !handler.isDestroyed()) {
                    handler.destroy();
                    handler = null;
                }
                if (onMouseButtonsChange && viewer && viewer.scene && viewer.scene.canvas) {
                    viewer.scene.canvas.removeEventListener('mousemove', onMouseButtonsChange);
                    viewer.scene.canvas.removeEventListener('mousedown', onMouseButtonsChange);
                    viewer.scene.canvas.removeEventListener('mouseup', onMouseButtonsChange);
                    onMouseButtonsChange = null;
                }
                if (onMouseLeave && viewer && viewer.scene && viewer.scene.canvas) {
                    viewer.scene.canvas.removeEventListener('mouseleave', onMouseLeave);
                    onMouseLeave = null;
                }
                mouseButtonsDown = 0;
                if (viewer) clearGraphics(viewer);
                resetMeasurementState();

                const dcEl = document.getElementById('drawCylinder');
                if (dcEl) dcEl.classList.remove('active');

                const tb = document.querySelector('.cesium-measure-toolbar');
                if (tb) tb.classList.remove('expanded');

                const mt = tm.getTool('measureToolbar');
                if (mt && !mt.enabled) {
                    mt.toggle();
                }
                if (viewer && window.smart3dToolbarWireup && typeof window.smart3dToolbarWireup.restoreViewerCanvasCursorAndNavigation === 'function') {
                    window.smart3dToolbarWireup.restoreViewerCanvasCursorAndNavigation(viewer);
                }
            }
        );
        if (window.__SMART3D_CHECKLIST_HOOKS) {
            window.__SMART3D_CHECKLIST_HOOKS.drawCylinderImplementsEscapeKeyCancel = true;
        }
    }

    /**
     * Scene modes that replace 3D Tiles `style` on the same tilesets — only one should be active at a time.
     * (Avoids inconsistent restore stacks when e.g. White + Transparency both toggle tileset.style.)
     */
    var STYLE_TILESET_SCENE_MODE_IDS = ['transparency', 'white', 'height', 'remapColors'];

    var sceneToolbarState = {
        /** @type {{ tileset: Object, style: Object|null }[]} */
        transparencySnapshots: [],
        fogPrev: null,
        /** @type {{ tileset: Object, style: Object|null }[]} */
        whiteSnapshots: [],
        /** @type {{ tileset: Object, style: Object|null }[]} */
        heightRampSnapshots: [],
        /** @type {{ tileset: Object, style: Object|null }[]} */
        remapSnapshots: [],
        orthoFrustum: null,
        depthFogPrev: null,
        dirLight: undefined
    };

    /**
     * Read configured alpha for transparency mode (0.05–1.0).
     */
    function getTransparencyAlpha() {
        var cfg = window.t && window.t.SceneModes && window.t.SceneModes.transparency;
        var a = cfg && typeof cfg.alpha === 'number' ? cfg.alpha : 0.45;
        if (!Number.isFinite(a)) a = 0.45;
        return Math.min(1, Math.max(0.05, a));
    }

    /**
     * Turn off other tileset-style scene modes so their saved stacks and DOM state stay consistent.
     * @param {string} keepId — Mode being activated; not deactivated.
     * @param {Object} viewer — Cesium Viewer
     */
    function deactivateOtherTilesetStyleSceneModes(keepId, viewer) {
        STYLE_TILESET_SCENE_MODE_IDS.forEach(function (mid) {
            if (mid === keepId) return;
            var b = document.getElementById(mid);
            if (!b || !b.classList.contains('ActiveButton')) return;
            if (mid === 'transparency') toggleSceneTransparency(viewer, false);
            else if (mid === 'white') toggleWhiteModel(viewer, false);
            else if (mid === 'height') toggleHeightRamp(viewer, false);
            else if (mid === 'remapColors') toggleRemapSimCity(viewer, false);
            b.classList.remove('ActiveButton');
            b.setAttribute('aria-pressed', 'false');
        });
    }

    /** `fog` and `distance` (depth fog) both use `scene.fog` — only one active at a time. */
    var FOG_SCENE_MODE_IDS = ['fog', 'distance'];

    function deactivateOtherFogSceneModes(keepId, viewer) {
        FOG_SCENE_MODE_IDS.forEach(function (mid) {
            if (mid === keepId) return;
            var b = document.getElementById(mid);
            if (!b || !b.classList.contains('ActiveButton')) return;
            if (mid === 'fog') toggleSceneFog(viewer, false);
            else if (mid === 'distance') toggleDepthFog(viewer, false);
            b.classList.remove('ActiveButton');
            b.setAttribute('aria-pressed', 'false');
        });
    }

    function getFogSceneConfig() {
        var cfg = window.t && window.t.SceneModes && window.t.SceneModes.fog;
        var d = cfg && typeof cfg.density === 'number' ? cfg.density : 0.0004;
        var b = cfg && typeof cfg.minimumBrightness === 'number' ? cfg.minimumBrightness : 0.35;
        if (!Number.isFinite(d)) d = 0.0004;
        if (!Number.isFinite(b)) b = 0.35;
        return { density: Math.min(0.01, Math.max(0.00001, d)), minimumBrightness: Math.min(1, Math.max(0, b)) };
    }

    function getDepthFogDensity() {
        var cfg = window.t && window.t.SceneModes && window.t.SceneModes.distance;
        var d = cfg && typeof cfg.density === 'number' ? cfg.density : 0.0025;
        if (!Number.isFinite(d)) d = 0.0025;
        return Math.min(0.02, Math.max(0.0001, d));
    }

    function getHeightDivisor() {
        var cfg = window.t && window.t.SceneModes && window.t.SceneModes.height;
        var h = cfg && typeof cfg.heightDivisor === 'number' ? cfg.heightDivisor : 200;
        if (!Number.isFinite(h)) h = 200;
        return Math.min(5000, Math.max(1, h));
    }

    function getRemapHeightDivisor() {
        var cfg = window.t && window.t.SceneModes && window.t.SceneModes.remapColors;
        var h = cfg && typeof cfg.heightDivisor === 'number' ? cfg.heightDivisor : 25;
        if (!Number.isFinite(h)) h = 25;
        return Math.min(5000, Math.max(1, h));
    }

    /**
     * Scalar 0..1 for height-style tile coloring. Some tiles omit ${POSITION} (undefined);
     * Cartesian2 positions have no .z. Fall back to ${POSITION_ABSOLUTE} or a neutral value.
     */
    function tilesetElevationRampFactorExpr(div) {
        return (
            '(${POSITION} !== undefined ? (isNaN(${POSITION}.z) ? fract(length(${POSITION}) / ' +
            div +
            ') : fract(${POSITION}.z / ' +
            div +
            ')) : (${POSITION_ABSOLUTE} !== undefined ? (isNaN(${POSITION_ABSOLUTE}.z) ? fract(length(${POSITION_ABSOLUTE}) / ' +
            div +
            ') : fract(abs(${POSITION_ABSOLUTE}.z) / ' +
            div +
            ')) : 0.5))'
        );
    }

    function getOrthoWidthFactor() {
        var cfg = window.t && window.t.SceneModes && window.t.SceneModes.ortho;
        var w = cfg && typeof cfg.orthoWidthFactor === 'number' ? cfg.orthoWidthFactor : 0.35;
        if (!Number.isFinite(w)) w = 0.35;
        return Math.min(2, Math.max(0.05, w));
    }

    function getSceneTuning() {
        var t = window.t || {};
        var st = t.SceneTuning || {};
        var c = typeof st.imageryContrast === 'number' && !Number.isNaN(st.imageryContrast) ? st.imageryContrast : 1;
        var b = typeof st.imageryBrightness === 'number' && !Number.isNaN(st.imageryBrightness) ? st.imageryBrightness : 1;
        return { imageryContrast: Math.min(3, Math.max(0.2, c)), imageryBrightness: Math.min(3, Math.max(0.2, b)) };
    }

    function applyImageryToneFromT(viewer) {
        if (!viewer || !viewer.scene) return;
        var tune = getSceneTuning();
        var layers = viewer.scene.imageryLayers;
        if (!layers || layers.length === 0) return;
        var i;
        for (i = 0; i < layers.length; i++) {
            var layer = layers.get(i);
            if (!layer) continue;
            try {
                if ('contrast' in layer) layer.contrast = tune.imageryContrast;
            } catch (e1) {}
            try {
                if ('brightness' in layer) layer.brightness = tune.imageryBrightness;
            } catch (e2) {}
        }
        viewer.scene.requestRender();
    }

    function refreshFogFromConfigIfActive(viewer) {
        var btn = document.getElementById('fog');
        if (!btn || !btn.classList.contains('ActiveButton')) return;
        var f = viewer.scene.fog;
        var fc = getFogSceneConfig();
        f.enabled = true;
        f.density = fc.density;
        f.minimumBrightness = fc.minimumBrightness;
    }

    function refreshDepthFogFromConfigIfActive(viewer) {
        var btn = document.getElementById('distance');
        if (!btn || !btn.classList.contains('ActiveButton')) return;
        var f = viewer.scene.fog;
        f.enabled = true;
        f.density = getDepthFogDensity();
    }

    function refreshOrthoWidthIfActive(viewer) {
        var btn = document.getElementById('ortho');
        if (!btn || !btn.classList.contains('ActiveButton')) return;
        var cam = viewer.camera;
        if (!(cam.frustum instanceof Cesium.OrthographicFrustum)) return;
        var wf = getOrthoWidthFactor();
        var w = cam.positionCartographic ? Math.max(cam.positionCartographic.height * wf, 100) : 1000;
        cam.frustum.width = w;
        cam.frustum.aspectRatio = viewer.canvas.clientWidth / Math.max(viewer.canvas.clientHeight, 1);
    }

    /**
     * Re-apply live visualization after `window.t` scene numeric fields change (toolbar panel).
     */
    function refreshActiveSceneParameters() {
        var viewer = getViewer();
        if (!viewer) return;
        mergeExtendedT();
        refreshToolbarTitlesAndVisibility();
        applyImageryToneFromT(viewer);
        refreshFogFromConfigIfActive(viewer);
        refreshDepthFogFromConfigIfActive(viewer);
        refreshOrthoWidthIfActive(viewer);
        var tr = document.getElementById('transparency');
        if (tr && tr.classList.contains('ActiveButton')) {
            toggleSceneTransparency(viewer, false);
            toggleSceneTransparency(viewer, true);
        }
        var wh = document.getElementById('white');
        if (wh && wh.classList.contains('ActiveButton')) {
            toggleWhiteModel(viewer, false);
            toggleWhiteModel(viewer, true);
        }
        var ht = document.getElementById('height');
        if (ht && ht.classList.contains('ActiveButton')) {
            toggleHeightRamp(viewer, false);
            toggleHeightRamp(viewer, true);
        }
        var rm = document.getElementById('remapColors');
        if (rm && rm.classList.contains('ActiveButton')) {
            toggleRemapSimCity(viewer, false);
            toggleRemapSimCity(viewer, true);
        }
        var dm = window.displayModesManager;
        if (dm && typeof dm.refreshSlopeOverlayIfActive === 'function') {
            dm.refreshSlopeOverlayIfActive();
        }
        if (dm && document.getElementById('snow') && document.getElementById('snow').classList.contains('ActiveButton')) {
            if (typeof dm.applyWeatherEffect === 'function') {
                dm.applyWeatherEffect('snow');
            }
        }
        if (dm && document.getElementById('rain') && document.getElementById('rain').classList.contains('ActiveButton')) {
            if (typeof dm.applyWeatherEffect === 'function') {
                dm.applyWeatherEffect('rain');
            }
        }
        viewer.scene.requestRender();
    }

    function mergeExtendedT() {
        if (window.jsonConfigManager && typeof window.jsonConfigManager.mergeOptionalToolsTIntoDefaults === 'function') {
            window.t = window.jsonConfigManager.mergeOptionalToolsTIntoDefaults(window.t);
        } else if (window.jsonConfigManager && typeof window.jsonConfigManager.getDefaultOptionalToolsT === 'function') {
            window.t = window.jsonConfigManager.getDefaultOptionalToolsT();
        }
    }

    function applyConfigVisibility() {
        var t = window.t || {};
        function setShown(id, show) {
            var el = document.getElementById(id);
            if (!el) return;
            if (show) el.style.removeProperty('display');
            else el.style.display = 'none';
        }
        function smShow(id) {
            var c = t.SceneModes && t.SceneModes[id];
            return !c || c.Show !== false;
        }
        function toolShow(key) {
            var c = t.Tools && t.Tools[key];
            return !c || c.Show !== false;
        }
        setShown('measure', !!(t.Measure && t.Measure.Show));
        setShown('lineofsight', !!(t.LOS && t.LOS.Show));
        setShown('viewshed', !!(t.Viewshed && t.Viewshed.Show));
        ['transparency', 'fog', 'white', 'slope', 'height', 'distance', 'direction', 'snow', 'rain', 'clouds', 'ortho', 'remapColors'].forEach(function (id) {
            setShown(id, smShow(id));
        });
        setShown('layersIC', toolShow('layersIC'));
        setShown('view_home', toolShow('view_home'));
        setShown('gotoPrevView', toolShow('history'));
        setShown('gotoNextView', toolShow('history'));
        var nc = document.querySelector('.north-container');
        if (nc) nc.style.display = toolShow('navNorth') ? '' : 'none';
        setShown('topView', toolShow('topView'));
        setShown('share', toolShow('share'));
        setShown('printscreen', toolShow('printscreen'));
        setShown('elevationProfileButton', toolShow('elevationProfile'));
        setShown('streetview', toolShow('streetview'));
        setShown('flightmode', toolShow('flightmode'));
        setShown('clipplane', toolShow('clipplane'));
        setShown('split', toolShow('split'));
        setShown('special_effects', toolShow('special_effects'));
    }

    function refreshToolbarTitlesAndVisibility() {
        mergeExtendedT();
        applyConfigVisibility();
        var i18n = window.smart3dI18n && window.smart3dI18n.t ? window.smart3dI18n.t : function (k) {
            return k;
        };
        var t = window.t || {};
        function proTitle(base, active) {
            if (active === false) return base + ' (PRO)';
            return base;
        }
        function titleForDomId(id) {
            var s = i18n('toolbar.' + id);
            return s.indexOf('toolbar.') === 0 ? id : s;
        }
        ['transparency', 'fog', 'white', 'slope', 'height', 'distance', 'direction', 'snow', 'rain', 'clouds', 'ortho', 'remapColors'].forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            var cfg = t.SceneModes && t.SceneModes[id];
            if (!cfg || cfg.Show === false) return;
            var baseTitle = titleForDomId(id);
            if (id === 'transparency' && typeof cfg.alpha === 'number' && Number.isFinite(cfg.alpha)) {
                baseTitle = baseTitle + ' (' + Math.round(cfg.alpha * 100) + '%)';
            } else if (id === 'height' && typeof cfg.heightDivisor === 'number' && Number.isFinite(cfg.heightDivisor)) {
                baseTitle = baseTitle + ' (÷' + cfg.heightDivisor + ' m)';
            } else if (id === 'remapColors' && typeof cfg.heightDivisor === 'number' && Number.isFinite(cfg.heightDivisor)) {
                baseTitle = baseTitle + ' (÷' + cfg.heightDivisor + ' m)';
            }
            el.setAttribute('title', proTitle(baseTitle, cfg.Active));
            el.setAttribute('aria-label', titleForDomId(id));
            el.setAttribute('aria-pressed', el.classList.contains('ActiveButton') ? 'true' : 'false');
        });
        var core = [
            ['measure', 'Measure', t.Measure],
            ['lineofsight', 'LOS', t.LOS],
            ['viewshed', 'Viewshed', t.Viewshed]
        ];
        core.forEach(function (row) {
            var id = row[0];
            var cfg = row[2];
            var el = document.getElementById(id);
            if (!el || !cfg || !cfg.Show) return;
            el.setAttribute('title', proTitle(titleForDomId(id), cfg.Active));
            el.setAttribute('aria-label', titleForDomId(id));
            el.setAttribute('aria-pressed', el.classList.contains('ActiveButton') ? 'true' : 'false');
        });
        var toolPairs = [
            ['layersIC', 'layersIC'],
            ['view_home', 'view_home'],
            ['gotoPrevView', 'history'],
            ['gotoNextView', 'history'],
            ['navNorth', 'navNorth'],
            ['topView', 'topView'],
            ['share', 'share'],
            ['printscreen', 'printscreen'],
            ['elevationProfileButton', 'elevationProfile'],
            ['streetview', 'streetview'],
            ['flightmode', 'flightmode'],
            ['clipplane', 'clipplane'],
            ['split', 'split'],
            ['special_effects', 'special_effects']
        ];
        toolPairs.forEach(function (pair) {
            var id = pair[0];
            var key = pair[1];
            var el = document.getElementById(id);
            if (!el) return;
            var cfg = t.Tools && t.Tools[key];
            if (!cfg || cfg.Show === false) return;
            el.setAttribute('title', proTitle(titleForDomId(id), cfg.Active));
            el.setAttribute('aria-label', titleForDomId(id));
            if (id === 'layersIC' || id === 'special_effects') {
                el.setAttribute('aria-pressed', el.classList.contains('ActiveButton') ? 'true' : 'false');
            }
        });
        var tv = window.tilesetViewer;
        if (tv && tv.viewer) {
            applySceneTuningFromWindowT(tv.viewer);
            ensureMeasureToolbar(tv.viewer);
        }
        syncMapToolsStripToggleLabels();
    }

    function getPrimaryTilesets() {
        var tv = window.tilesetViewer;
        if (!tv || typeof tv.getAllTilesets !== 'function') return [];
        var list = tv.getAllTilesets();
        var out = [];
        list.forEach(function (row) {
            if (row && row.tileset) out.push(row.tileset);
        });
        return out;
    }

    function toggleSceneTransparency(viewer, active) {
        var ts = getPrimaryTilesets();
        var alpha = getTransparencyAlpha();
        if (active) {
            if (!sceneToolbarState.transparencySnapshots.length) {
                sceneToolbarState.transparencySnapshots = ts.map(function (tileset) {
                    return { tileset: tileset, style: tileset.style ? tileset.style : null };
                });
            } else {
                var seen = new Set();
                sceneToolbarState.transparencySnapshots.forEach(function (e) {
                    if (e.tileset) seen.add(e.tileset);
                });
                ts.forEach(function (tileset) {
                    if (!seen.has(tileset)) {
                        sceneToolbarState.transparencySnapshots.push({
                            tileset: tileset,
                            style: tileset.style ? tileset.style : null
                        });
                    }
                });
            }
            var colorExpr = 'color("white", ' + alpha + ')';
            ts.forEach(function (tileset) {
                tileset.style = new Cesium.Cesium3DTileStyle({ color: colorExpr });
            });
        } else {
            var restored = new Set();
            sceneToolbarState.transparencySnapshots.forEach(function (entry) {
                var t = entry.tileset;
                if (!t) return;
                try {
                    t.style = entry.style || undefined;
                } catch (err) {
                    try {
                        t.style = undefined;
                    } catch (e2) {}
                }
                restored.add(t);
            });
            ts.forEach(function (tileset) {
                if (!restored.has(tileset)) {
                    try {
                        tileset.style = undefined;
                    } catch (err) {}
                }
            });
            sceneToolbarState.transparencySnapshots = [];
        }
        viewer.scene.requestRender();
    }

    function toggleSceneFog(viewer, active) {
        var f = viewer.scene.fog;
        var fc = getFogSceneConfig();
        if (active) {
            if (!sceneToolbarState.fogPrev) {
                sceneToolbarState.fogPrev = { enabled: f.enabled, density: f.density, minimumBrightness: f.minimumBrightness };
            }
            f.enabled = true;
            f.density = Math.max(f.density || 0, fc.density);
            f.minimumBrightness = fc.minimumBrightness;
        } else {
            if (sceneToolbarState.fogPrev) {
                f.enabled = sceneToolbarState.fogPrev.enabled;
                f.density = sceneToolbarState.fogPrev.density;
                f.minimumBrightness = sceneToolbarState.fogPrev.minimumBrightness;
                sceneToolbarState.fogPrev = null;
            } else {
                f.enabled = false;
            }
        }
        viewer.scene.requestRender();
    }

    function mergeTilesetSnapshotsForStyle(snapshotArr, ts) {
        if (!snapshotArr.length) return;
        var seen = new Set();
        snapshotArr.forEach(function (e) {
            if (e.tileset) seen.add(e.tileset);
        });
        ts.forEach(function (tileset) {
            if (!seen.has(tileset)) {
                snapshotArr.push({ tileset: tileset, style: tileset.style ? tileset.style : null });
            }
        });
    }

    function restoreTilesetSnapshots(snapshotArr, currentTilesets) {
        var restored = new Set();
        snapshotArr.forEach(function (entry) {
            var t = entry.tileset;
            if (!t) return;
            try {
                t.style = entry.style || undefined;
            } catch (err) {
                try {
                    t.style = undefined;
                } catch (e2) {}
            }
            restored.add(t);
        });
        currentTilesets.forEach(function (tileset) {
            if (!restored.has(tileset)) {
                try {
                    tileset.style = undefined;
                } catch (err) {}
            }
        });
    }

    function toggleWhiteModel(viewer, active) {
        var ts = getPrimaryTilesets();
        if (active) {
            if (!sceneToolbarState.whiteSnapshots.length) {
                sceneToolbarState.whiteSnapshots = ts.map(function (tileset) {
                    return { tileset: tileset, style: tileset.style ? tileset.style : null };
                });
            } else {
                mergeTilesetSnapshotsForStyle(sceneToolbarState.whiteSnapshots, ts);
            }
            ts.forEach(function (tileset) {
                tileset.style = new Cesium.Cesium3DTileStyle({ color: 'color("white")' });
            });
        } else {
            restoreTilesetSnapshots(sceneToolbarState.whiteSnapshots, ts);
            sceneToolbarState.whiteSnapshots = [];
        }
        viewer.scene.requestRender();
    }

    function toggleDepthFog(viewer, active) {
        var f = viewer.scene.fog;
        var targetDensity = getDepthFogDensity();
        if (active) {
            if (!sceneToolbarState.depthFogPrev) {
                sceneToolbarState.depthFogPrev = { enabled: f.enabled, density: f.density };
            }
            f.enabled = true;
            f.density = targetDensity;
        } else {
            if (sceneToolbarState.depthFogPrev) {
                f.enabled = sceneToolbarState.depthFogPrev.enabled;
                f.density = sceneToolbarState.depthFogPrev.density;
                sceneToolbarState.depthFogPrev = null;
            }
        }
        viewer.scene.requestRender();
    }

    function toggleOrthoCamera(viewer, active) {
        var cam = viewer.camera;
        var wf = getOrthoWidthFactor();
        if (active) {
            if (!(cam.frustum instanceof Cesium.OrthographicFrustum)) {
                sceneToolbarState.orthoFrustum = cam.frustum.clone();
                var w = cam.positionCartographic ? Math.max(cam.positionCartographic.height * wf, 100) : 1000;
                var o = new Cesium.OrthographicFrustum();
                o.width = w;
                o.aspectRatio = viewer.canvas.clientWidth / Math.max(viewer.canvas.clientHeight, 1);
                o.near = 0.01;
                o.far = 5e7;
                cam.frustum = o;
            }
        } else if (sceneToolbarState.orthoFrustum) {
            cam.frustum = sceneToolbarState.orthoFrustum;
            sceneToolbarState.orthoFrustum = null;
        }
        viewer.scene.requestRender();
    }

    function toggleHeightRamp(viewer, active) {
        var ts = getPrimaryTilesets();
        var div = getHeightDivisor();
        var expr = 'mix(color("blue"), color("red"), ' + tilesetElevationRampFactorExpr(div) + ')';
        if (active) {
            if (!sceneToolbarState.heightRampSnapshots.length) {
                sceneToolbarState.heightRampSnapshots = ts.map(function (tileset) {
                    return { tileset: tileset, style: tileset.style ? tileset.style : null };
                });
            } else {
                mergeTilesetSnapshotsForStyle(sceneToolbarState.heightRampSnapshots, ts);
            }
            ts.forEach(function (tileset) {
                tileset.style = new Cesium.Cesium3DTileStyle({ color: expr });
            });
        } else {
            restoreTilesetSnapshots(sceneToolbarState.heightRampSnapshots, ts);
            sceneToolbarState.heightRampSnapshots = [];
        }
        viewer.scene.requestRender();
    }

    function toggleRemapSimCity(viewer, active) {
        var ts = getPrimaryTilesets();
        var div = getRemapHeightDivisor();
        var expr = 'mix(color("cyan"), color("magenta"), ' + tilesetElevationRampFactorExpr(div) + ')';
        if (active) {
            if (!sceneToolbarState.remapSnapshots.length) {
                sceneToolbarState.remapSnapshots = ts.map(function (tileset) {
                    return { tileset: tileset, style: tileset.style ? tileset.style : null };
                });
            } else {
                mergeTilesetSnapshotsForStyle(sceneToolbarState.remapSnapshots, ts);
            }
            ts.forEach(function (tileset) {
                tileset.style = new Cesium.Cesium3DTileStyle({ color: expr });
            });
        } else {
            restoreTilesetSnapshots(sceneToolbarState.remapSnapshots, ts);
            sceneToolbarState.remapSnapshots = [];
        }
        viewer.scene.requestRender();
    }

    function handleSceneModeButton(id, e) {
        closeOtherMapToolUis('sceneMode');
        var names = {
            transparency: 'Transparency',
            fog: 'Fog',
            white: 'WhiteModel',
            slope: 'Slope',
            height: 'Height',
            distance: 'DepthMap',
            direction: 'Direction',
            snow: 'Snow',
            rain: 'Rain',
            clouds: 'Clouds',
            ortho: 'OrthoView',
            remapColors: 'RemapColors'
        };
        logButtonClick(names[id] || id);
        var t = window.t || {};
        var cfg = t.SceneModes && t.SceneModes[id];
        if (!cfg || cfg.Show === false) return;
        if (!cfg.Active) {
            load_pro_info(e);
            return;
        }
        var viewer = getViewer();
        if (!viewer) return;
        var btn = document.getElementById(id);
        var on = !btn || !btn.classList.contains('ActiveButton');
        var dm = window.displayModesManager;

        if (on && STYLE_TILESET_SCENE_MODE_IDS.indexOf(id) >= 0) {
            deactivateOtherTilesetStyleSceneModes(id, viewer);
        }
        if (on && FOG_SCENE_MODE_IDS.indexOf(id) >= 0) {
            deactivateOtherFogSceneModes(id, viewer);
        }

        if (id === 'transparency') toggleSceneTransparency(viewer, on);
        else if (id === 'fog') toggleSceneFog(viewer, on);
        else if (id === 'white') toggleWhiteModel(viewer, on);
        else if (id === 'slope' && dm && typeof dm.toggleMode === 'function') dm.toggleMode('slope', on);
        else if (id === 'height') toggleHeightRamp(viewer, on);
        else if (id === 'distance') toggleDepthFog(viewer, on);
        else if (id === 'direction') {
            if (on) {
                if (sceneToolbarState.dirLight === undefined) {
                    sceneToolbarState.dirLight = viewer.scene.globe.enableLighting;
                }
                viewer.scene.globe.enableLighting = false;
            } else if (sceneToolbarState.dirLight !== undefined) {
                viewer.scene.globe.enableLighting = sceneToolbarState.dirLight;
                sceneToolbarState.dirLight = undefined;
            }
            viewer.scene.requestRender();
        } else if (id === 'snow' && dm && typeof dm.setWeather === 'function') {
            if (on) {
                var rainBtn = document.getElementById('rain');
                if (rainBtn && rainBtn.classList.contains('ActiveButton')) {
                    rainBtn.classList.remove('ActiveButton');
                    rainBtn.setAttribute('aria-pressed', 'false');
                }
                dm.setWeather('snow');
            } else {
                dm.setWeather('none');
            }
        } else if (id === 'rain' && dm && typeof dm.setWeather === 'function') {
            if (on) {
                var snowBtn = document.getElementById('snow');
                if (snowBtn && snowBtn.classList.contains('ActiveButton')) {
                    snowBtn.classList.remove('ActiveButton');
                    snowBtn.setAttribute('aria-pressed', 'false');
                }
                dm.setWeather('rain');
            } else {
                dm.setWeather('none');
            }
        } else if (id === 'clouds' && dm && typeof dm.toggleMode === 'function') dm.toggleMode('clouds', on);
        else if (id === 'ortho') toggleOrthoCamera(viewer, on);
        else if (id === 'remapColors') toggleRemapSimCity(viewer, on);

        if (btn) {
            if (on) btn.classList.add('ActiveButton');
            else btn.classList.remove('ActiveButton');
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }

    function syncHistoryNavButtons() {
        var nm = window.navigationManager;
        if (!nm) return;
        var p = document.getElementById('gotoPrevView');
        var n = document.getElementById('gotoNextView');
        if (p) {
            var pd = nm.historyIndex <= 0;
            p.disabled = pd;
            p.setAttribute('aria-disabled', pd ? 'true' : 'false');
        }
        if (n) {
            var nd = nm.historyIndex >= nm.history.length - 1;
            n.disabled = nd;
            n.setAttribute('aria-disabled', nd ? 'true' : 'false');
        }
    }

    function wireNorthArrowAndHistory(viewer) {
        if (!viewer || !viewer.scene) return;
        viewer.scene.postRender.addEventListener(function () {
            var arrow = document.querySelector('.north-arrow');
            if (arrow) {
                var h = Cesium.Math.toDegrees(viewer.camera.heading);
                arrow.style.setProperty('--rotation', -h + 'deg');
            }
            syncHistoryNavButtons();
        });
    }

    function wireElevationProfileTool() {
        var btn = document.getElementById('elevationProfileButton');
        var modal = document.getElementById('modal_elevationProfile');
        var host = document.getElementById('elevationProfileChartHost');
        var closeBtn = document.getElementById('modal-close-ep');
        var drag = document.getElementById('modal-move-elevation-profile');
        if (!btn || !modal || !host) return;

        var handler = null;
        var positions = [];
        var polyEnt = null;
        var escapeKeyListener = null;

        function pickProfilePoint(viewer, screenPosition) {
            if (typeof window.safePickPosition === 'function') {
                return window.safePickPosition(viewer, screenPosition);
            }
            if (viewer.scene.pickPositionSupported) {
                return viewer.scene.pickPosition(screenPosition);
            }
            return undefined;
        }

        function closeModal() {
            modal.style.display = 'none';
            if (escapeKeyListener) {
                document.removeEventListener('keydown', escapeKeyListener, true);
                escapeKeyListener = null;
            }
            var v = getViewer();
            if (handler && !handler.isDestroyed()) handler.destroy();
            handler = null;
            positions = [];
            if (v && polyEnt) {
                v.entities.remove(polyEnt);
                polyEnt = null;
            }
        }

        if (closeBtn) closeBtn.addEventListener('click', closeModal);

        window.closeElevationProfilePanel = closeModal;

        if (drag) {
            var ox = 0,
                oy = 0,
                sx = 0,
                sy = 0,
                dragging = false;
            drag.addEventListener('mousedown', function (e) {
                dragging = true;
                ox = modal.offsetLeft;
                oy = modal.offsetTop;
                sx = e.clientX;
                sy = e.clientY;
                e.preventDefault();
            });
            window.addEventListener('mousemove', function (e) {
                if (!dragging) return;
                modal.style.left = ox + (e.clientX - sx) + 'px';
                modal.style.top = oy + (e.clientY - sy) + 'px';
                modal.style.transform = 'none';
            });
            window.addEventListener('mouseup', function () {
                dragging = false;
            });
        }

        btn.addEventListener('click', function () {
            closeOtherMapToolUis('elevationProfile');
            logButtonClick('ElevationProfile');
            var cfg = window.t && window.t.Tools && window.t.Tools.elevationProfile;
            if (cfg && cfg.Show === false) return;
            if (cfg && cfg.Active === false) {
                load_pro_info({ preventDefault: function () {} });
                return;
            }
            var viewer = getViewer();
            if (!viewer || !viewer.scene) return;
            if (!viewer.scene.pickPositionSupported && typeof window.safePickPosition !== 'function') {
                if (window.notification && typeof window.notification.warning === 'function') {
                    window.notification.warning(
                        window.appI18n && window.appI18n.nt
                            ? window.appI18n.nt('epDepthPick')
                            : 'Elevation profile needs depth-buffer picking. Try a different angle or load terrain.'
                    );
                }
                return;
            }
            positions = [];
            modal.style.display = 'block';
            modal.style.position = 'absolute';
            host.textContent =
                window.appI18n && window.appI18n.nt
                    ? window.appI18n.nt('epClickHint')
                    : 'Click points on the model or terrain along your path. Double-click to finish. Press Esc to cancel.';
            if (escapeKeyListener) {
                document.removeEventListener('keydown', escapeKeyListener, true);
                escapeKeyListener = null;
            }
            escapeKeyListener = function (ev) {
                if (ev.key !== 'Escape') return;
                if (modal.style.display !== 'block') return;
                ev.preventDefault();
                closeModal();
            };
            document.addEventListener('keydown', escapeKeyListener, true);

            if (handler && !handler.isDestroyed()) handler.destroy();
            handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
            handler.setInputAction(function (click) {
                var p = pickProfilePoint(viewer, click.position);
                if (!Cesium.defined(p)) {
                    if (window.notification && typeof window.notification.info === 'function') {
                        window.notification.info(
                            window.appI18n && window.appI18n.nt
                                ? window.appI18n.nt('epNoSurface')
                                : 'No surface under cursor — click on visible geometry or terrain.'
                        );
                    }
                    return;
                }
                positions.push(p);
                if (!polyEnt) {
                    polyEnt = viewer.entities.add({
                        polyline: {
                            positions: new Cesium.CallbackProperty(function () {
                                return positions;
                            }, false),
                            width: 2,
                            material: Cesium.Color.CYAN,
                            arcType: Cesium.ArcType.GEODESIC
                        }
                    });
                }
            }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
            handler.setInputAction(function () {
                if (positions.length < 2) {
                    if (window.notification && typeof window.notification.warning === 'function') {
                        window.notification.warning(
                            window.appI18n && window.appI18n.nt
                                ? window.appI18n.nt('epNeedTwoPoints')
                                : 'Add at least two points before finishing the profile.'
                        );
                    }
                    return;
                }
                var cartos = positions.map(function (c) {
                    return Cesium.Cartographic.fromCartesian(c);
                });
                var tp = viewer.terrainProvider;
                if (!tp) {
                    if (window.notification && typeof window.notification.error === 'function') {
                        window.notification.error(
                            window.appI18n && window.appI18n.nt
                                ? window.appI18n.nt('epNoTerrain')
                                : 'No terrain provider available for elevation sampling.'
                        );
                    }
                    return;
                }
                Cesium.sampleTerrainMostDetailed(tp, cartos)
                    .then(function (updated) {
                        var heights = updated.map(function (c) {
                            return c.height;
                        });
                        var minH = Math.min.apply(null, heights);
                        var maxH = Math.max.apply(null, heights);
                        host.innerHTML = '';
                        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                        svg.setAttribute('width', '100%');
                        svg.setAttribute('height', '120');
                        svg.setAttribute('viewBox', '0 0 300 120');
                        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        var pts = heights.map(function (h, i) {
                            var x = (i / Math.max(heights.length - 1, 1)) * 280 + 10;
                            var y = 100 - ((h - minH) / Math.max(maxH - minH, 1)) * 90;
                            return x + ',' + y;
                        });
                        path.setAttribute('d', 'M' + pts.join(' L'));
                        path.setAttribute('fill', 'none');
                        path.setAttribute('stroke', '#00b9ff');
                        path.setAttribute('stroke-width', '2');
                        svg.appendChild(path);
                        host.appendChild(svg);
                        var cap = document.createElement('div');
                        cap.style.marginTop = '6px';
                        cap.textContent = 'min ' + minH.toFixed(1) + ' m — max ' + maxH.toFixed(1) + ' m';
                        host.appendChild(cap);
                    })
                    .catch(function (err) {
                        if (window.errorHandler) {
                            window.errorHandler.handle(err, { component: 'ElevationProfile', action: 'sampleTerrain' }, false);
                        } else {
                            console.warn('Elevation profile terrain sampling failed:', err);
                        }
                        if (window.notification && typeof window.notification.error === 'function') {
                            window.notification.error(
                                window.appI18n && window.appI18n.nt
                                    ? window.appI18n.nt('epTerrainFailed')
                                    : 'Terrain sampling failed. Check terrain availability and try again.'
                            );
                        }
                    });
                if (handler && !handler.isDestroyed()) handler.destroy();
                handler = null;
            }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        });
    }

    let toolbarClickHandlersWired = false;
    let configUiListenersWired = false;

    /**
     * Single implementation for each documented `.tools` button id (all-tools.md §4, Map_Toolbar_Complete_Spec Part A).
     * Sidebar, platform UI, and nested-toolbar event bus must call these — do not duplicate tool logic elsewhere.
     */
    var mapToolbarHandlers = {
        layersIC: function (e) {
            closeOtherMapToolUis('layersIC');
            logButtonClick('Layers');
            var cfg = window.t && window.t.Tools && window.t.Tools.layersIC;
            if (!cfg || cfg.Show === false) return;
            if (cfg && cfg.Active === false) {
                load_pro_info(e);
                return;
            }
            var layersBtn = document.getElementById('layersIC');
            if (layersBtn) layersBtn.classList.toggle('ActiveButton');
            if (window.layersMenuManager && typeof window.layersMenuManager.toggle === 'function') {
                window.layersMenuManager.toggle();
            } else if (window.layersMenuManager && typeof window.layersMenuManager.show === 'function') {
                window.layersMenuManager.show();
            }
            syncMapToolAriaFromDom();
        },
        view_home: function (e) {
            logButtonClick('ViewHome');
            var cfg = window.t && window.t.Tools && window.t.Tools.view_home;
            if (!cfg || cfg.Show === false) return;
            if (cfg && cfg.Active === false) {
                load_pro_info(e);
                return;
            }
            if (window.navigationManager && typeof window.navigationManager.home === 'function') {
                window.navigationManager.home();
            }
        },
        gotoPrevView: function (e) {
            logButtonClick('GotoPrevView');
            var cfg = window.t && window.t.Tools && window.t.Tools.history;
            if (!cfg || cfg.Show === false) return;
            if (cfg && cfg.Active === false) {
                load_pro_info(e);
                return;
            }
            if (window.navigationManager) window.navigationManager.navigateBack();
            syncHistoryNavButtons();
        },
        gotoNextView: function (e) {
            logButtonClick('GotoNextView');
            var cfg = window.t && window.t.Tools && window.t.Tools.history;
            if (!cfg || cfg.Show === false) return;
            if (cfg && cfg.Active === false) {
                load_pro_info(e);
                return;
            }
            if (window.navigationManager) window.navigationManager.navigateForward();
            syncHistoryNavButtons();
        },
        navNorth: function (e) {
            logButtonClick('NavNorth');
            var cfg = window.t && window.t.Tools && window.t.Tools.navNorth;
            if (!cfg || cfg.Show === false) return;
            if (cfg && cfg.Active === false) {
                load_pro_info(e);
                return;
            }
            if (window.navigationManager && typeof window.navigationManager.pointToNorth === 'function') {
                window.navigationManager.pointToNorth();
            }
        },
        topView: function (e) {
            logButtonClick('TopView');
            var cfg = window.t && window.t.Tools && window.t.Tools.topView;
            if (!cfg || cfg.Show === false) return;
            if (cfg && cfg.Active === false) {
                load_pro_info(e);
                return;
            }
            if (window.navigationManager && typeof window.navigationManager.topView === 'function') {
                window.navigationManager.topView();
            }
        },
        share: function (e) {
            closeOtherMapToolUis('share');
            logButtonClick('Share');
            var cfg = window.t && window.t.Tools && window.t.Tools.share;
            if (!cfg || cfg.Show === false) return;
            if (cfg && cfg.Active === false) {
                load_pro_info(e);
                return;
            }
            if (window.shareLocationManager && typeof window.shareLocationManager.show === 'function') {
                window.shareLocationManager.show();
            }
        },
        printscreen: function (e) {
            closeOtherMapToolUis('printscreen');
            logButtonClick('PrintScreen');
            var cfg = window.t && window.t.Tools && window.t.Tools.printscreen;
            if (!cfg || cfg.Show === false) return;
            if (cfg && cfg.Active === false) {
                load_pro_info(e);
                return;
            }
            if (window.screenshotManager && typeof window.screenshotManager.show === 'function') {
                window.screenshotManager.show();
            }
        },
        measure: function (e) {
            closeOtherMapToolUis('measure');
            logButtonClick('Measure');
            var cfg = window.t && window.t.Measure;
            if (!cfg || !cfg.Show) return;
            if (!cfg.Active) {
                load_pro_info(e);
                return;
            }
            scheduleMeasureToolbarReparent();
            var mt = window.toolManager && window.toolManager.getTool('measureToolbar');
            if (mt) mt.toggle();
            syncMapToolAriaFromDom();
        },
        lineofsight: function (e) {
            closeOtherMapToolUis('lineofsight');
            logButtonClick('LineOfSight');
            var cfg = window.t && window.t.LOS;
            if (!cfg || !cfg.Show) return;
            if (!cfg.Active) {
                load_pro_info(e);
                return;
            }
            var tool = window.toolManager && window.toolManager.getTool('createLineOfSight');
            if (tool) tool.enabled = !tool.enabled;
            syncMapToolAriaFromDom();
        },
        viewshed: function (e) {
            closeOtherMapToolUis('viewshed');
            logButtonClick('Viewshed');
            var cfg = window.t && window.t.Viewshed;
            var tm = window.toolManager;
            if (!cfg || !cfg.Show) return;
            if (!cfg.Active) {
                load_pro_info(e);
                return;
            }
            var tool = tm && tm.getTool('viewshed');
            if (tool) tool.enabled = !tool.enabled;
            syncMapToolAriaFromDom();
        },
        streetview: function (e) {
            closeOtherMapToolUis('streetview');
            logButtonClick('StreetView');
            var cfg = window.t && window.t.Tools && window.t.Tools.streetview;
            if (!cfg || cfg.Show === false) return;
            if (cfg && cfg.Active === false) {
                load_pro_info(e);
                return;
            }
            var svm = window.streetViewManager;
            if (!svm) return;
            if (isMapToolPanelVisible(svm.modal)) {
                if (typeof svm.hide === 'function') svm.hide();
                return;
            }
            if (typeof svm.show === 'function') svm.show();
        },
        flightmode: function (e) {
            closeOtherMapToolUis('flightmode');
            logButtonClick('FlightMode');
            var cfg = window.t && window.t.Tools && window.t.Tools.flightmode;
            if (!cfg || cfg.Show === false) return;
            if (cfg && cfg.Active === false) {
                load_pro_info(e);
                return;
            }
            var fm = window.supermanFlightModeManager;
            if (!fm) return;
            if (isMapToolPanelVisible(fm.modal)) {
                if (typeof fm.hide === 'function') fm.hide();
                return;
            }
            if (typeof fm.show === 'function') fm.show();
        },
        clipplane: function (e) {
            closeOtherMapToolUis('clipplane');
            logButtonClick('ClipPlane');
            var cfg = window.t && window.t.Tools && window.t.Tools.clipplane;
            if (!cfg || cfg.Show === false) return;
            if (cfg && cfg.Active === false) {
                load_pro_info(e);
                return;
            }
            var cut = window.cutByPolygonManager;
            if (!cut) return;
            if (isMapToolPanelVisible(cut.modal)) {
                if (typeof cut.hide === 'function') cut.hide();
                return;
            }
            if (typeof cut.show === 'function') cut.show();
        },
        split: function (e) {
            closeOtherMapToolUis('split');
            logButtonClick('SplitScreen');
            var cfg = window.t && window.t.Tools && window.t.Tools.split;
            if (!cfg || cfg.Show === false) return;
            if (cfg && cfg.Active === false) {
                load_pro_info(e);
                return;
            }
            var ssm = window.splitScreenManager;
            if (!ssm) return;
            if (isMapToolPanelVisible(ssm.modal)) {
                if (typeof ssm.hide === 'function') ssm.hide();
                return;
            }
            if (typeof ssm.show === 'function') ssm.show();
        },
        special_effects: function (e) {
            closeOtherMapToolUis('special_effects');
            logButtonClick('SpecialEffects');
            var cfg = window.t && window.t.Tools && window.t.Tools.special_effects;
            if (!cfg || cfg.Show === false) return;
            if (cfg && cfg.Active === false) {
                load_pro_info(e);
                return;
            }
            var fxBtn = document.getElementById('special_effects');
            var tb = document.getElementById('toolbarSE');
            if (tb) tb.classList.toggle('expanded');
            var open = tb && tb.classList.contains('expanded');
            /* Scene modes live in #toolbarSE; .tools_special_effects is legacy (unused). */
            if (tb) {
                tb.setAttribute('aria-hidden', open ? 'false' : 'true');
                tb.setAttribute('aria-expanded', open ? 'true' : 'false');
            }
            if (fxBtn) {
                if (open) fxBtn.classList.add('ActiveButton');
                else fxBtn.classList.remove('ActiveButton');
                fxBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            }
            syncMapToolAriaFromDom();
        }
    };

    var nestedAliasToToolId = {
        home: 'view_home',
        back: 'gotoPrevView',
        forward: 'gotoNextView',
        north: 'navNorth',
        topView: 'topView',
        measure: 'measure',
        screenshot: 'printscreen',
        share: 'share',
        layers: 'layersIC',
        lineOfSight: 'lineofsight',
        visibleHidden: 'viewshed',
        viewRange: 'viewshed',
        viewshed: 'viewshed',
        streetView: 'streetview',
        flightMode: 'flightmode',
        cutPolygon: 'clipplane',
        splitScreen: 'split',
        displayModes: 'special_effects'
    };

    function invokeMapToolAction(toolId, e) {
        if (!toolId) return;
        var fn = mapToolbarHandlers[toolId];
        if (typeof fn === 'function') {
            fn(e || { preventDefault: function () {} });
        }
    }

    function invokeMapToolActionByNestedAlias(alias, e) {
        if (alias === 'mapLabels' && window.labelManagerUI && typeof window.labelManagerUI.focusPanel === 'function') {
            window.labelManagerUI.focusPanel();
            return;
        }
        if (
            alias === 'elevationProfile' ||
            alias === 'elevation_profile' ||
            alias === 'profile' ||
            alias === 'elevation'
        ) {
            var epBtn = document.getElementById('elevationProfileButton');
            if (epBtn) {
                epBtn.click();
            }
            return;
        }
        if (alias === 'search' && window.searchManager && typeof window.searchManager.show === 'function') {
            window.searchManager.show();
            return;
        }
        if (
            alias === 'bookmarks' &&
            window.bookmarkManager &&
            typeof window.bookmarkManager.toggleGallery === 'function'
        ) {
            window.bookmarkManager.toggleGallery();
            return;
        }
        if (
            alias === 'displayModesAdvanced' ||
            alias === 'display_modes_advanced' ||
            alias === 'displayModesModal'
        ) {
            if (window.displayModesManager && typeof window.displayModesManager.show === 'function') {
                window.displayModesManager.show();
            }
            return;
        }
        var id = nestedAliasToToolId[alias];
        if (id) invokeMapToolAction(id, e);
    }

    function wireDom() {
        if (!window.t || typeof window.t !== 'object') {
            if (window.jsonConfigManager && typeof window.jsonConfigManager.getDefaultOptionalToolsT === 'function') {
                window.t = window.jsonConfigManager.getDefaultOptionalToolsT();
            } else {
                window.t = {
                    Measure: { Show: true, Active: true },
                    LOS: { Show: true, Active: true },
                    Viewshed: { Show: true, Active: true },
                    SceneModes: {},
                    Tools: {}
                };
            }
        }
        mergeExtendedT();

        refreshToolbarTitlesAndVisibility();

        if (!toolbarClickHandlersWired) {
            toolbarClickHandlersWired = true;

            ['transparency', 'fog', 'white', 'slope', 'height', 'distance', 'direction', 'snow', 'clouds', 'ortho', 'remapColors'].forEach(function (sid) {
                var b = document.getElementById(sid);
                if (b) {
                    b.addEventListener('click', function (e) {
                        handleSceneModeButton(sid, e);
                    });
                }
            });

            Object.keys(mapToolbarHandlers).forEach(function (id) {
                var el = document.getElementById(id);
                if (el) {
                    el.addEventListener('click', function (ev) {
                        mapToolbarHandlers[id](ev);
                    });
                }
            });

            wireElevationProfileTool();
        }

        if (!configUiListenersWired) {
            configUiListenersWired = true;
            window.addEventListener('jsonConfigUpdated', refreshToolbarTitlesAndVisibility);
            window.addEventListener('smart3dOptionalToolsUpdated', refreshToolbarTitlesAndVisibility);
        }

        wireMapToolsStripToggle();

        if (window.sceneModesParameterPanel && typeof window.sceneModesParameterPanel.init === 'function') {
            window.sceneModesParameterPanel.init();
        }
    }

    function ensureMeasureToolbar(viewer) {
        if (!viewer || !viewer.container) return;
        let root = viewer.container.querySelector('.cesium-viewer');
        if (!root) root = viewer.container;
        let mt = root.querySelector('.cesium-measure-toolbar');
        if (!mt && viewer.measure && viewer.measure._container) {
            mt = viewer.measure._container;
        }
        if (mt && !mt.classList.contains('cesium-measure-toolbar')) {
            mt.classList.add('cesium-measure-toolbar');
        }
        if (mt) {
            mt.classList.add('simplex-ion-measure-toolbar');
        }
        reparentMeasureToolbar();
        reparentMapToolbarIntoViewer();
        applyToolbarTopOffset();
        ensureDrawCylinderNode(viewer);
        if (!measureToolbarIdsAssigned) {
            scheduleAssignMeasureIdsWhenReady(viewer, function () {});
        }
        collapseIonMeasureIfToolbarInactive(viewer);
    }

    let observeViewerToolbarDone = false;

    function observeViewerToolbar(viewer) {
        if (!viewer || !viewer.container) return;
        if (observeViewerToolbarDone) return;
        observeViewerToolbarDone = true;
        ensureMeasureToolbar(viewer);
        const mo = new MutationObserver(function () {
            ensureMeasureToolbar(viewer);
        });
        mo.observe(viewer.container, { childList: true, subtree: true });
        setTimeout(function () {
            mo.disconnect();
        }, 6000);
    }

    function init() {
        window.__SMART3D_CHECKLIST_HOOKS = window.__SMART3D_CHECKLIST_HOOKS || {};
        registerMeasureToolbarTool();
        registerDrawCylinderTool();
        wireMeasureToolbarCursorDelegation();
        reparentMapToolbarIntoViewer();
        if (typeof window.applyToolbarTopOffset === 'function') {
            window.applyToolbarTopOffset();
        }
        let resizeT = null;
        window.addEventListener(
            'resize',
            function () {
                if (resizeT) clearTimeout(resizeT);
                resizeT = setTimeout(function () {
                    window.applyToolbarTopOffset && window.applyToolbarTopOffset();
                }, 100);
            },
            { passive: true }
        );
        wireDom();
        forceCloseDisplayModesUi();
        syncMapToolAriaFromDom();
        window.__SMART3D_CHECKLIST_HOOKS.drawCylinderImplementsEscapeKeyCancel = true;

        var northWired = false;
        function tryWireNorthAndHistory() {
            if (northWired) return;
            var v = getViewer();
            if (!v) return;
            northWired = true;
            wireNorthArrowAndHistory(v);
        }
        tryWireNorthAndHistory();

        const tm = window.toolManager;
        if (tm) {
            const mt = tm.getTool('measureToolbar');
            const dc = tm.getTool('drawCylinder');
            window.__SMART3D_CHECKLIST_HOOKS.measureToolbarRegistered = !!mt;
            window.__SMART3D_CHECKLIST_HOOKS.measureToolbarShowPickHelper = !!(mt && mt.showPickHelper);
            window.__SMART3D_CHECKLIST_HOOKS.drawCylinderRegistered = !!dc;
            window.__SMART3D_CHECKLIST_HOOKS.createLineOfSightRegistered = !!tm.getTool('createLineOfSight');
            window.__SMART3D_CHECKLIST_HOOKS.createLineOfSightShowPickHelper = !!(
                tm.getTool('createLineOfSight') && tm.getTool('createLineOfSight').showPickHelper
            );
            window.__SMART3D_CHECKLIST_HOOKS.viewshedRegistered = !!tm.getTool('viewshed');
            window.__SMART3D_CHECKLIST_HOOKS.viewshedShowPickHelper = !!(tm.getTool('viewshed') && tm.getTool('viewshed').showPickHelper);
        }
        const viewer = getViewer();
        if (viewer) {
            observeViewerToolbar(viewer);
            tryWireNorthAndHistory();
        } else {
            const iv = window.setInterval(function () {
                const v = getViewer();
                if (v) {
                    clearInterval(iv);
                    observeViewerToolbar(v);
                    tryWireNorthAndHistory();
                }
            }, 200);
            setTimeout(function () {
                clearInterval(iv);
            }, 30000);
        }
    }

    window.load_pro_info = load_pro_info;
    window.logButtonClick = logButtonClick;
    window.applyToolbarTopOffset = applyToolbarTopOffset;
    window.smart3dToolbarWireup = {
        init: init,
        ensureMeasureToolbar: ensureMeasureToolbar,
        ensureDrawCylinder: ensureDrawCylinderNode,
        refreshToolbarTitlesAndVisibility: refreshToolbarTitlesAndVisibility,
        refreshActiveSceneParameters: refreshActiveSceneParameters,
        applyImageryToneFromT: applyImageryToneFromT,
        getSceneTuning: getSceneTuning,
        invokeMapToolAction: invokeMapToolAction,
        invokeMapToolActionByNestedAlias: invokeMapToolActionByNestedAlias,
        closeOtherMapToolUis: closeOtherMapToolUis,
        forceCloseDisplayModesUi: forceCloseDisplayModesUi,
        restoreViewerCanvasCursorAndNavigation: restoreViewerCanvasCursorAndNavigation,
        collapseIonMeasureIfToolbarInactive: collapseIonMeasureIfToolbarInactive,
        syncMapToolAriaFromDom: syncMapToolAriaFromDom
    };
})();
