/**
 * Single entry point for Cesium Ion SDK add-ons shipped under `public/lib/cesium/packages/`:
 * - `IonSdkMeasurements` — `viewerMeasureMixin`, `Measure` widget (see tilesetViewer.js)
 * - `IonSdkSensors` — `RectangularSensor` (see simVisualToolsBridge.js, vshd.js)
 * - `IonSdkGeometry` — fan/vector helpers (loaded globally; used by sensors stack)
 *
 * UI code should use this facade for Ion measurement UI (expand/collapse, tool selection).
 * `simVisualToolsBridge.activateMeasurementTool` remains a backward-compat alias to
 * `activateMeasurementType` (bridge wires the Measure widget instance).
 */
(function () {
    'use strict';

    /**
     * IonSdkMeasurements only exposes these tool ids (see ion-sdk bundle).
     * Extend when the SDK adds measurement modes so toolbar keys still resolve.
     */
    const MEASUREMENT_TYPE_MAP = {
        line: { ids: ['horizontalMeasurement'], keywords: ['horizontal', 'distance'] },
        polyline: { ids: ['polylineMeasurement'], keywords: ['polyline'] },
        dimension: { ids: ['horizontalMeasurement'], keywords: ['horizontal'] },
        parallel: { ids: ['verticalMeasurement'], keywords: ['vertical'] },
        polygon: { ids: ['areaMeasurement'], keywords: ['area'] },
        'building-height': { ids: ['heightMeasurement'], keywords: ['height', 'terrain'] },
        'building-width': { ids: ['horizontalMeasurement'], keywords: ['horizontal'] },
        'building-length': { ids: ['polylineMeasurement'], keywords: ['polyline'] },
        'building-dimensions': { ids: ['horizontalMeasurement'], keywords: ['horizontal'] },
        volume: { ids: ['areaMeasurement'], keywords: ['area'] },
        'roof-area': { ids: ['areaMeasurement'], keywords: ['area'] },
        slope: { ids: ['pointMeasurement'], keywords: ['point', 'coordinates', 'slope'] },
        area: { ids: ['areaMeasurement'], keywords: ['area'] },
        height: { ids: ['heightMeasurement'], keywords: ['height'] },
        'distance-point': { ids: ['horizontalMeasurement'], keywords: ['horizontal'] },
        'distance-line': { ids: ['horizontalMeasurement'], keywords: ['horizontal'] },
        'vertical-segment': { ids: ['verticalMeasurement'], keywords: ['vertical'] },
        angle: { ids: ['horizontalMeasurement'], keywords: ['horizontal', 'distance'] }
    };

    /** Toolbar types with no Ion equivalent — handled elsewhere (e.g. timer). */
    const TOOLBAR_TYPES_ION_FALLBACK_ONLY = new Set(['timer']);

    function viewer() {
        return window.tilesetViewer && window.tilesetViewer.viewer;
    }

    function getMeasureViewModel() {
        const v = viewer();
        return v && v.measure && v.measure.viewModel ? v.measure.viewModel : null;
    }

    function isIonSdkMeasurementsAvailable() {
        return !!(window.IonSdkMeasurements && typeof window.IonSdkMeasurements.viewerMeasureMixin === 'function');
    }

    function isIonSdkSensorsAvailable() {
        return !!(window.IonSdkSensors && window.IonSdkSensors.RectangularSensor);
    }

    /**
     * Show or hide the Ion measurement toolbar (viewer mixin or fallback `Measure` container).
     * @param {boolean} expanded
     * @returns {boolean} true if a known host was updated
     */
    function expandIonMeasureToolbar(expanded) {
        const want = !!expanded;
        const v = viewer();
        if (v && v.measure && v.measure.viewModel && Object.prototype.hasOwnProperty.call(v.measure.viewModel, 'expanded')) {
            v.measure.viewModel.expanded = want;
            return true;
        }
        const bridge = window.simVisualToolsBridge;
        if (!bridge) {
            return false;
        }
        const el = bridge.measureContainerEl
            || document.getElementById('simMeasureContainer')
            || document.getElementById('simMeasureContainerPanel');
        if (el && bridge.measureWidget) {
            if (want) {
                el.style.display = '';
                el.style.visibility = 'visible';
            } else if (el.id === 'simMeasureContainer' && el.parentElement === document.body) {
                el.style.display = 'none';
            }
            return true;
        }
        return false;
    }

    function setMeasureExpanded(expanded) {
        return expandIonMeasureToolbar(expanded);
    }

    /**
     * @param {string} toolType — key in `MEASUREMENT_TYPE_MAP` (e.g. 'area', 'height')
     * @returns {boolean} true if a measurement mode was selected
     */
    function readSelectedMeasurement(viewModel) {
        if (!viewModel || viewModel.selectedMeasurement == null) return null;
        if (typeof viewModel.selectedMeasurement === 'function') {
            try {
                return viewModel.selectedMeasurement();
            } catch (err) {
                return null;
            }
        }
        return viewModel.selectedMeasurement;
    }

    function getMeasurementsArray(viewModel) {
        if (!viewModel) return null;
        const raw = viewModel.measurements;
        return typeof raw === 'function' ? raw() : raw;
    }

    /**
     * Ion forwards canvas input to `selectedMeasurement.handleMouseMove` / `handleClick`.
     * Setting it to `null` crashes the SDK (see IonSdkMeasurements Gt._handleMouseMove).
     * For custom pick tools (e.g. radius), park selection on a low-impact mode and reset state.
     */
    function pickBenignDefaultMeasurement(measurements) {
        if (!Array.isArray(measurements) || measurements.length === 0) return null;
        const norm = (value) => String(value || '').toLowerCase();
        let target = measurements.find((m) => norm(m.id) === 'pointmeasurement');
        if (!target) target = measurements.find((m) => norm(m.type).indexOf('point') !== -1);
        if (!target) target = measurements[0];
        return target || null;
    }

    function setSelectedMeasurementOnVm(viewModel, target) {
        if (!viewModel || !target) return false;
        try {
            if (typeof viewModel.selectedMeasurement === 'function') {
                viewModel.selectedMeasurement(target);
            } else {
                viewModel.selectedMeasurement = target;
            }
            if (typeof target.reset === 'function') {
                target.reset();
            }
            return true;
        } catch (err) {
            return false;
        }
    }

    /**
     * Leave aggressive Ion modes (distance/area in progress) by switching to a benign tool.
     */
    function clearSelectedMeasurementMode() {
        const neutralizeVm = (viewModel) => {
            if (!viewModel) return;
            const prev = readSelectedMeasurement(viewModel);
            if (prev && typeof prev.reset === 'function') {
                try {
                    prev.reset();
                } catch (err) {}
            }
            const measurements = getMeasurementsArray(viewModel);
            const target = pickBenignDefaultMeasurement(measurements);
            if (target) {
                setSelectedMeasurementOnVm(viewModel, target);
            }
        };
        const v = viewer();
        if (v && v.measure && v.measure.viewModel) {
            neutralizeVm(v.measure.viewModel);
        }
        const bridge = window.simVisualToolsBridge;
        if (bridge && bridge.measureWidget && bridge.measureWidget.viewModel) {
            const vmB = bridge.measureWidget.viewModel;
            if (!v || !v.measure || !v.measure.viewModel || vmB !== v.measure.viewModel) {
                neutralizeVm(vmB);
            }
        }
        return true;
    }

    function activateMeasurementType(toolType) {
        if (TOOLBAR_TYPES_ION_FALLBACK_ONLY.has(toolType)) {
            return false;
        }
        const bridge = window.simVisualToolsBridge;
        const v = viewer();
        if (v && v.measure && v.measure.viewModel) {
            v.measure.viewModel.expanded = true;
        }

        if (!bridge || !bridge.measureWidget || !bridge.measureWidget.viewModel) {
            return false;
        }

        const viewModel = bridge.measureWidget.viewModel;
        const measurementsRaw = viewModel.measurements;
        const measurements = typeof measurementsRaw === 'function' ? measurementsRaw() : measurementsRaw;

        if (!Array.isArray(measurements) || measurements.length === 0) {
            return false;
        }

        const descriptor = MEASUREMENT_TYPE_MAP[toolType] || {
            ids: [toolType],
            keywords: [toolType]
        };

        const normalize = (value) => String(value || '').toLowerCase();
        const idSet = new Set((descriptor.ids || []).map((id) => normalize(id)));
        const keywords = (descriptor.keywords || []).map((keyword) => normalize(keyword));

        let target = measurements.find((m) => idSet.has(normalize(m.id)));
        if (!target && keywords.length > 0) {
            target = measurements.find((m) => {
                const idText = normalize(m.id);
                const typeText = normalize(m.type);
                return keywords.some((keyword) => idText.includes(keyword) || typeText.includes(keyword));
            });
        }
        if (!target) {
            target = measurements[0];
        }
        if (!target) {
            return false;
        }

        if (typeof viewModel.selectedMeasurement === 'function') {
            viewModel.selectedMeasurement(target);
        } else {
            viewModel.selectedMeasurement = target;
        }

        if (Object.prototype.hasOwnProperty.call(viewModel, 'expanded')) {
            viewModel.expanded = true;
        }

        expandIonMeasureToolbar(true);
        if (typeof bridge.updateStatus === 'function') {
            bridge.updateStatus(`Measurement active: ${target.type || target.id || toolType}`);
        }
        return true;
    }

    window.ionSdkToolsFacade = {
        viewer,
        MEASUREMENT_TYPE_MAP,
        TOOLBAR_TYPES_ION_FALLBACK_ONLY,
        getMeasureViewModel,
        isIonSdkMeasurementsAvailable,
        isIonSdkSensorsAvailable,
        setMeasureExpanded,
        expandIonMeasureToolbar,
        clearSelectedMeasurementMode,
        activateMeasurementType,
        get simVisualToolsBridge() {
            return window.simVisualToolsBridge;
        }
    };
})();
