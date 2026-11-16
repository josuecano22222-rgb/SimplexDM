/**
 * VSHD — viewshed director (cursor_master_prompt.md Section F; Tools.md §4.2).
 * IonSdkSensors.RectangularSensor; u_viewshedVisibleColor / u_viewshedOccludedColor when exposed by the primitive.
 */
(function () {
    'use strict';

    const RS =
        (typeof window !== 'undefined' && window.IonSdkSensors && window.IonSdkSensors.RectangularSensor) ||
        (typeof IonSdkSensors !== 'undefined' && IonSdkSensors.RectangularSensor);

    const OBSERVER_ENTITY_ID = 'simplex_viewshed_observer';

    const VSHD = {
        current: { params: {} },
        _primitive: null,
        _viewer: null,
        _eyeCartesian: null,
        _targetCartesian: null,

        _removeObserverEntity() {
            if (!this._viewer || !this._viewer.entities) return;
            const e = this._viewer.entities.getById(OBSERVER_ENTITY_ID);
            if (e) this._viewer.entities.remove(e);
        },

        _syncObserverEntity() {
            if (!this._viewer || !this._eyeCartesian) {
                this._removeObserverEntity();
                return;
            }
            const pos = Cesium.Cartesian3.clone(this._eyeCartesian, new Cesium.Cartesian3());
            let labelText = 'Observer position';
            if (window.smart3dI18n && typeof window.smart3dI18n.t === 'function') {
                labelText = window.smart3dI18n.t('viewshed.observerMarker');
            }
            let pinUrl;
            try {
                pinUrl = typeof Cesium.buildModuleUrl === 'function' ? Cesium.buildModuleUrl('Assets/Textures/pin.svg') : null;
            } catch (err) {
                pinUrl = null;
            }
            const ent = this._viewer.entities.getById(OBSERVER_ENTITY_ID);
            if (ent) {
                if (ent.position instanceof Cesium.ConstantPositionProperty) {
                    ent.position.setValue(pos);
                } else {
                    ent.position = new Cesium.ConstantPositionProperty(pos);
                }
                return;
            }
            const common = { disableDepthTestDistance: Number.POSITIVE_INFINITY };
            if (pinUrl) {
                this._viewer.entities.add({
                    id: OBSERVER_ENTITY_ID,
                    position: new Cesium.ConstantPositionProperty(pos),
                    billboard: {
                        image: pinUrl,
                        scale: 1.25,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        heightReference: Cesium.HeightReference.NONE,
                        ...common
                    },
                    label: {
                        text: labelText,
                        font: '600 14px system-ui, -apple-system, "Segoe UI", sans-serif',
                        fillColor: Cesium.Color.WHITE,
                        outlineColor: Cesium.Color.fromCssColorString('#0a1628'),
                        outlineWidth: 3,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        pixelOffset: new Cesium.Cartesian2(0, -50),
                        showBackground: true,
                        backgroundColor: Cesium.Color.fromCssColorString('#1565c0').withAlpha(0.92),
                        backgroundPadding: new Cesium.Cartesian2(10, 5),
                        ...common
                    }
                });
            } else {
                this._viewer.entities.add({
                    id: OBSERVER_ENTITY_ID,
                    position: new Cesium.ConstantPositionProperty(pos),
                    point: {
                        pixelSize: 20,
                        color: Cesium.Color.fromCssColorString('#1e88e5').withAlpha(0.95),
                        outlineColor: Cesium.Color.WHITE,
                        outlineWidth: 3,
                        heightReference: Cesium.HeightReference.NONE,
                        ...common
                    },
                    label: {
                        text: labelText,
                        font: '600 14px system-ui, -apple-system, "Segoe UI", sans-serif',
                        fillColor: Cesium.Color.WHITE,
                        outlineColor: Cesium.Color.fromCssColorString('#0a1628'),
                        outlineWidth: 3,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        pixelOffset: new Cesium.Cartesian2(0, -28),
                        showBackground: true,
                        backgroundColor: Cesium.Color.fromCssColorString('#1565c0').withAlpha(0.92),
                        backgroundPadding: new Cesium.Cartesian2(10, 5),
                        ...common
                    }
                });
            }
        },

        ResetToDefaults(p) {
            if (!p) return;
            p.name = p.name || '';
            p.radius = typeof p.radius === 'number' ? p.radius : 500;
            p.sheight = typeof p.sheight === 'number' ? p.sheight : typeof p.height === 'number' ? p.height : 0;
            p.heading = typeof p.heading === 'number' ? p.heading : 0;
            p.pitch = typeof p.pitch === 'number' ? p.pitch : 0;
            p.xangle = typeof p.xangle === 'number' ? p.xangle : typeof p.fovx === 'number' ? p.fovx : 90;
            p.yangle = typeof p.yangle === 'number' ? p.yangle : typeof p.fovy === 'number' ? p.fovy : 60;
            p.computedRadius =
                typeof p.computedRadius === 'number' ? p.computedRadius : p.radius;
            p.computedHeight =
                typeof p.computedHeight === 'number' ? p.computedHeight : p.sheight;
            p.classificationType = p.classificationType || 0;
            p.uid = p.uid || '';
            p.init_position = p.init_position || { longitude: 0, latitude: 0, height: 0 };
            p.params = p.params || {};
            this.current.params = p;
        },

        SetCurrent(p) {
            this.current = this.current || { params: {} };
            this.current.params = p;
        },

        SetViewer(viewer) {
            this._viewer = viewer;
        },

        _applyViewshedUniforms(prim) {
            if (!prim) return;
            if (Object.prototype.hasOwnProperty.call(prim, 'viewshedVisibleColor')) {
                prim.viewshedVisibleColor = Cesium.Color.LIME.withAlpha(0.45);
            }
            if (Object.prototype.hasOwnProperty.call(prim, 'viewshedOccludedColor')) {
                prim.viewshedOccludedColor = Cesium.Color.RED.withAlpha(0.45);
            }
        },

        CreateRectangularSensor(p) {
            if (!RS || !this._viewer) return;
            this.Delete();
            const xFull = Math.max(0.5, Math.min(179.9, p.xangle != null ? p.xangle : p.fovx != null ? p.fovx : 90));
            const yFull = Math.max(0.5, Math.min(179.9, p.yangle != null ? p.yangle : p.fovy != null ? p.fovy : 60));
            const xHalf = Cesium.Math.toRadians(xFull / 2);
            const yHalf = Cesium.Math.toRadians(yFull / 2);
            const rMeters = p.computedRadius != null ? p.computedRadius : p.radius;
            const r = Math.max(0.01, Number.isFinite(rMeters) ? rMeters : 500);
            const modelMatrix = this._modelMatrixFor(p);
            // Lateral frustum surfaces use a light material and read as a solid white disk from above;
            // keep them off so the map stays visible while viewshed colors (green/red) remain on geometry.
            const prim = new RS({
                modelMatrix: modelMatrix,
                radius: r,
                xHalfAngle: xHalf,
                yHalfAngle: yHalf,
                showViewshed: true,
                showLateralSurfaces: false,
                showDomeSurfaces: false
            });
            this._applyViewshedUniforms(prim);
            this._viewer.scene.primitives.add(prim);
            this._primitive = prim;
            this._syncObserverEntity();
        },

        UpdateEyePoint(cartesian, p) {
            this._eyeCartesian = Cesium.Cartesian3.clone(cartesian, new Cesium.Cartesian3());
            const c = Cesium.Cartographic.fromCartesian(this._eyeCartesian);
            p.init_position = {
                longitude: Cesium.Math.toDegrees(c.longitude),
                latitude: Cesium.Math.toDegrees(c.latitude),
                height: c.height
            };
            this.UpdateSensor(p);
            if (!this._primitive) this._syncObserverEntity();
        },

        SetTarget(cartesian, p) {
            if (!this._eyeCartesian) return;
            this._targetCartesian = Cesium.Cartesian3.clone(cartesian, new Cesium.Cartesian3());
            const enu = Cesium.Transforms.eastNorthUpToFixedFrame(this._eyeCartesian);
            const inv = Cesium.Matrix4.inverse(enu, new Cesium.Matrix4());
            const rel = Cesium.Matrix4.multiplyByPoint(inv, this._targetCartesian, new Cesium.Cartesian3());
            const e = rel.x;
            const n = rel.y;
            const u = rel.z;
            const horiz = Math.sqrt(e * e + n * n);
            const eps = 1e-10;
            if (horiz < eps && Math.abs(u) < eps) {
                this.current.params = p;
                this.UpdateSensor(p);
                return;
            }
            let heading;
            let pitch;
            if (horiz < eps) {
                heading = Cesium.Math.toRadians(p.heading != null ? p.heading : 0);
                pitch = Math.atan2(u, eps);
            } else {
                heading = Math.atan2(e, n);
                pitch = Math.atan2(u, horiz);
            }
            p.heading = Cesium.Math.toDegrees(heading);
            p.pitch = Cesium.Math.toDegrees(pitch);
            this.current.params = p;
            this.UpdateSensor(p);
        },

        UpdateSensor(p) {
            if (!this._primitive || !RS || !p) return;
            const xFull = Math.max(0.5, Math.min(179.9, p.xangle != null ? p.xangle : p.fovx != null ? p.fovx : 90));
            const yFull = Math.max(0.5, Math.min(179.9, p.yangle != null ? p.yangle : p.fovy != null ? p.fovy : 60));
            const xHalf = Cesium.Math.toRadians(xFull / 2);
            const yHalf = Cesium.Math.toRadians(yFull / 2);
            this._primitive.xHalfAngle = xHalf;
            this._primitive.yHalfAngle = yHalf;
            const rMeters = p.computedRadius != null ? p.computedRadius : p.radius;
            this._primitive.radius = Math.max(0.01, Number.isFinite(rMeters) ? rMeters : 500);
            this._primitive.modelMatrix = this._modelMatrixFor(p);
            this._primitive.showViewshed = true;
            this._applyViewshedUniforms(this._primitive);
            this.current.params = p;
            this._syncObserverEntity();
        },

        UpdateAllChanges(p) {
            this.UpdateSensor(p);
        },

        _modelMatrixFor(p) {
            let eye = this._eyeCartesian;
            if (!eye) {
                return Cesium.Matrix4.IDENTITY.clone();
            }
            const c = Cesium.Cartographic.fromCartesian(eye);
            const shRaw = p.sheight != null ? p.sheight : p.height;
            const shM = Number.isFinite(shRaw) ? shRaw : 0;
            // Terrain elevation from the last pick (UpdateEyePoint). Do not add sheight to the current
            // cartographic height — that value already includes the previous offset and would accumulate.
            let terrainH;
            if (p.init_position && Number.isFinite(p.init_position.height)) {
                terrainH = p.init_position.height;
            } else {
                terrainH = (c.height || 0) - shM;
            }
            c.height = terrainH + shM;
            eye = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height);
            this._eyeCartesian = Cesium.Cartesian3.clone(eye, new Cesium.Cartesian3());
            const h = Cesium.Math.toRadians(p.heading || 0);
            const pitch = Cesium.Math.toRadians(p.pitch || 0);
            const hpr = new Cesium.HeadingPitchRoll(h, pitch, 0);
            return Cesium.Transforms.headingPitchRollToFixedFrame(this._eyeCartesian, hpr);
        },

        Delete() {
            this._removeObserverEntity();
            if (this._primitive && this._viewer) {
                const pr = this._viewer.scene.primitives;
                if (typeof pr.removeAndDestroy === 'function') {
                    pr.removeAndDestroy(this._primitive);
                } else {
                    pr.remove(this._primitive);
                    if (typeof this._primitive.destroy === 'function' && !this._primitive.isDestroyed()) {
                        this._primitive.destroy();
                    }
                }
            }
            this._primitive = null;
        },

        ActivateTransformEditor() {},

        DeactivateTransformEditor() {},

        hideEyeTargetEntities() {
            this._removeObserverEntity();
            this._eyeCartesian = null;
            this._targetCartesian = null;
        }
    };

    if (typeof window !== 'undefined') {
        window.VSHD = VSHD;
    }
})();
