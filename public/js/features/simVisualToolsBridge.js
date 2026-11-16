/**
 * SIM visual tools bridge for Meridian.
 * Loads and wires Ion SDK measurement/sensor capabilities safely.
 */
(function () {
    'use strict';

    class SimVisualToolsBridge {
        constructor() {
            this.initialized = false;
            this.viewerReady = false;
            this.measureWidget = null;
            this.sensorPrimitive = null;
            this.waitTimer = null;
            this.viewer = null;
            this.sensorConfig = {
                radius: 250,
                xHalfAngleDeg: 35,
                yHalfAngleDeg: 20,
                lon: 32.36,
                lat: 36.58,
                height: 120
            };
            this.defaultSensorConfig = { ...this.sensorConfig };
            this.pickHandler = null;
            this.isPickMode = false;
            this.measureContainerEl = null;
        }

        init() {
            if (this.initialized) {
                return;
            }
            this.initialized = true;
            this.waitForViewerAndWire();
        }

        waitForViewerAndWire() {
            let attempts = 0;
            this.waitTimer = window.setInterval(() => {
                attempts += 1;
                const viewer = window.tilesetViewer && window.tilesetViewer.viewer;
                if (viewer && viewer.scene) {
                    this.viewerReady = true;
                    this.viewer = viewer;
                    window.clearInterval(this.waitTimer);
                    this.waitTimer = null;
                    this.initializeMeasurements(viewer);
                    this.initializeSensors(viewer);
                    this.bindSensorControls();
                    this.bindExistingTools(viewer);
                } else if (attempts > 480) {
                    window.clearInterval(this.waitTimer);
                    this.waitTimer = null;
                }
            }, 250);
        }

        initializeMeasurements(viewer) {
            if (!window.IonSdkMeasurements) {
                return;
            }

            if (viewer.measure && viewer.measure.viewModel) {
                this.measureWidget = viewer.measure;
                const cont = viewer.measure.container;
                this.measureContainerEl = cont && cont.nodeType === 1 ? cont : null;
                return;
            }

            const container = this.ensureMeasureContainer();
            if (!container) {
                return;
            }

            if (typeof window.IonSdkMeasurements.Measure === 'function') {
                window.simUtils?.trySafe(() => {
                    this.measureWidget = new window.IonSdkMeasurements.Measure({
                        container: container,
                        scene: viewer.scene
                    });
                });
            }
        }

        initializeSensors(viewer) {
            if (!window.IonSdkSensors) {
                return;
            }

            // Create a lazy default sensor instance only when requested by tools.
            this.viewer = viewer;
            this.loadPersistedSensorConfig();
        }

        bindSensorControls() {
            const get = (id) => document.getElementById(id);
            const bindInput = (id, key, parser = Number) => {
                const el = get(id);
                if (!el) {
                    return;
                }
                el.value = this.sensorConfig[key];
                el.addEventListener('change', () => {
                    const parsed = parser(el.value);
                    if (!Number.isNaN(parsed)) {
                        this.sensorConfig[key] = parsed;
                        this.applySensorConfig(true);
                    }
                });
            };

            bindInput('simSensorRadiusInput', 'radius');
            bindInput('simSensorXHalfAngleInput', 'xHalfAngleDeg');
            bindInput('simSensorYHalfAngleInput', 'yHalfAngleDeg');
            bindInput('simSensorLonInput', 'lon');
            bindInput('simSensorLatInput', 'lat');
            bindInput('simSensorHeightInput', 'height');

            const showBtn = get('simSensorShowBtn');
            if (showBtn) {
                showBtn.addEventListener('click', () => this.showSensor(this.viewer));
            }

            const hideBtn = get('simSensorHideBtn');
            if (hideBtn) {
                hideBtn.addEventListener('click', () => this.hideSensor(this.viewer));
            }

            const pickBtn = get('simSensorPickBtn');
            if (pickBtn) {
                pickBtn.addEventListener('click', () => this.enablePickMode());
            }

            const applyBtn = get('simSensorApplyBtn');
            if (applyBtn) {
                applyBtn.addEventListener('click', () => this.applySensorConfig(true));
            }

            const resetBtn = get('simSensorResetBtn');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => this.resetSensorConfig());
            }

            this.updateStatus('Sensor controls ready');
        }

        bindExistingTools(viewer) {
            this.wrapMethod(window.visibleHiddenAreasManager, 'show', () => {
                this.showSensor(viewer);
            });
            this.wrapMethod(window.visibleHiddenAreasManager, 'hide', () => {
                this.hideSensor(viewer);
            });

            this.wrapMethod(window.enhancedMeasurementManager, 'show', () => {
                this.showMeasureWidget();
            });
            this.wrapMethod(window.enhancedMeasurementManager, 'hide', () => {
                this.hideMeasureWidget();
            });
        }

        wrapMethod(instance, methodName, before) {
            if (!instance || typeof instance[methodName] !== 'function') {
                return;
            }
            const original = instance[methodName].bind(instance);
            instance[methodName] = (...args) => {
                window.simUtils?.trySafe(() => before());
                return original(...args);
            };
        }

        ensureMeasureContainer() {
            let container = document.getElementById('simMeasureContainer');
            if (container) {
                this.measureContainerEl = container;
                return container;
            }
            const panelContainer = document.getElementById('simMeasureContainerPanel');
            if (panelContainer) {
                this.measureContainerEl = panelContainer;
                return panelContainer;
            }
            container = document.createElement('div');
            container.id = 'simMeasureContainer';
            container.style.position = 'relative';
            container.style.zIndex = window.simplexUILayer
                ? window.simplexUILayer.zIndex('SIM_MEASURE_HOST')
                : '10050';
            container.style.overflow = 'auto';
            document.body.appendChild(container);
            this.measureContainerEl = container;
            return container;
        }

        showMeasureWidget() {
            const f = window.ionSdkToolsFacade;
            if (f && typeof f.expandIonMeasureToolbar === 'function') {
                f.expandIonMeasureToolbar(true);
            }
        }

        hideMeasureWidget() {
            const f = window.ionSdkToolsFacade;
            if (f && typeof f.expandIonMeasureToolbar === 'function') {
                f.expandIonMeasureToolbar(false);
            }
        }

        /** @deprecated Prefer `window.ionSdkToolsFacade.activateMeasurementType` from UI. */
        activateMeasurementTool(toolType) {
            const f = window.ionSdkToolsFacade;
            if (f && typeof f.activateMeasurementType === 'function') {
                return f.activateMeasurementType(toolType);
            }
            return false;
        }

        showSensor(viewer) {
            if (!window.IonSdkSensors || !viewer || !viewer.scene) {
                return;
            }
            if (this.sensorPrimitive) {
                this.sensorPrimitive.show = true;
                this.applySensorConfig(true);
                this.updateStatus('Sensor visible');
                return;
            }

            const Cesium = window.Cesium;
            if (!Cesium) {
                return;
            }

            const origin = Cesium.Cartesian3.fromDegrees(
                this.sensorConfig.lon,
                this.sensorConfig.lat,
                this.sensorConfig.height
            );
            this.sensorPrimitive = window.simUtils?.trySafe(() => new window.IonSdkSensors.RectangularSensor({
                position: origin,
                radius: this.sensorConfig.radius,
                xHalfAngle: Cesium.Math.toRadians(this.sensorConfig.xHalfAngleDeg),
                yHalfAngle: Cesium.Math.toRadians(this.sensorConfig.yHalfAngleDeg),
                showLateralSurfaces: true,
                showDomeSurfaces: false,
                showEllipsoidSurfaces: false,
                show: true
            }));

            if (this.sensorPrimitive) {
                viewer.scene.primitives.add(this.sensorPrimitive);
                this.updateStatus('Sensor created');
            }
        }

        applySensorConfig(persist = false) {
            if (!this.sensorPrimitive || !window.Cesium) {
                if (persist) {
                    this.persistSensorConfig();
                    this.updateStatus('Config saved (sensor not yet created)');
                }
                return;
            }
            const Cesium = window.Cesium;
            this.sensorPrimitive.radius = this.sensorConfig.radius;
            this.sensorPrimitive.xHalfAngle = Cesium.Math.toRadians(this.sensorConfig.xHalfAngleDeg);
            this.sensorPrimitive.yHalfAngle = Cesium.Math.toRadians(this.sensorConfig.yHalfAngleDeg);
            this.sensorPrimitive.position = Cesium.Cartesian3.fromDegrees(
                this.sensorConfig.lon,
                this.sensorConfig.lat,
                this.sensorConfig.height
            );
            if (persist) {
                this.persistSensorConfig();
            }
            this.updateStatus(
                `Applied | lon:${this.sensorConfig.lon.toFixed(6)} lat:${this.sensorConfig.lat.toFixed(6)} h:${this.sensorConfig.height}`
            );
        }

        hideSensor(viewer) {
            if (this.sensorPrimitive) {
                this.sensorPrimitive.show = false;
                this.updateStatus('Sensor hidden');
            }
            if (!viewer || !viewer.scene) {
                return;
            }
        }

        enablePickMode() {
            if (!this.viewer || !this.viewer.scene || !window.Cesium) {
                this.updateStatus('Viewer not ready for pick mode');
                return;
            }
            if (this.isPickMode) {
                return;
            }
            this.isPickMode = true;
            this.updateStatus('Pick mode: click map to set sensor position');

            const Cesium = window.Cesium;
            this.pickHandler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
            this.pickHandler.setInputAction((movement) => {
                const cartesian =
                    this.viewer.scene.pickPosition(movement.position) ||
                    this.viewer.camera.pickEllipsoid(movement.position, this.viewer.scene.globe.ellipsoid);
                if (!cartesian) {
                    this.updateStatus('Pick failed: no valid point');
                    return;
                }

                const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                this.sensorConfig.lon = Cesium.Math.toDegrees(cartographic.longitude);
                this.sensorConfig.lat = Cesium.Math.toDegrees(cartographic.latitude);
                this.sensorConfig.height = cartographic.height || 0;
                this.syncInputsFromConfig();
                this.applySensorConfig(true);
                this.disablePickMode();
                this.showSensor(this.viewer);
            }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        }

        disablePickMode() {
            this.isPickMode = false;
            if (this.pickHandler) {
                this.pickHandler.destroy();
                this.pickHandler = null;
            }
        }

        resetSensorConfig() {
            this.sensorConfig = { ...this.defaultSensorConfig };
            this.syncInputsFromConfig();
            this.applySensorConfig(true);
            this.updateStatus('Sensor config reset');
        }

        syncInputsFromConfig() {
            const set = (id, value) => {
                const el = document.getElementById(id);
                if (el) {
                    el.value = value;
                }
            };
            set('simSensorRadiusInput', this.sensorConfig.radius);
            set('simSensorXHalfAngleInput', this.sensorConfig.xHalfAngleDeg);
            set('simSensorYHalfAngleInput', this.sensorConfig.yHalfAngleDeg);
            set('simSensorLonInput', this.sensorConfig.lon);
            set('simSensorLatInput', this.sensorConfig.lat);
            set('simSensorHeightInput', this.sensorConfig.height);
        }

        persistSensorConfig() {
            window.simUtils?.trySafe(() => {
                localStorage.setItem('simSensorConfig', JSON.stringify(this.sensorConfig));
            });
        }

        loadPersistedSensorConfig() {
            const raw = window.simUtils?.trySafe(() => localStorage.getItem('simSensorConfig'));
            if (!raw) {
                this.syncInputsFromConfig();
                return;
            }
            const parsed = window.simUtils?.trySafe(() => JSON.parse(raw));
            if (!parsed) {
                this.syncInputsFromConfig();
                return;
            }
            this.sensorConfig = {
                ...this.sensorConfig,
                ...parsed
            };
            this.syncInputsFromConfig();
        }

        /**
         * @param {Object} obj
         * @param {{ persist?: boolean }} [options]
         */
        applySensorConfigFromObject(obj, options) {
            if (!obj || typeof obj !== 'object') return;
            Object.assign(this.sensorConfig, obj);
            this.syncInputsFromConfig();
            if (options && options.persist) {
                this.persistSensorConfig();
            }
        }

        updateStatus(message) {
            const el = document.getElementById('simSensorStatus');
            if (el) {
                el.textContent = message;
            }
        }
    }

    window.simVisualToolsBridge = new SimVisualToolsBridge();
})();
