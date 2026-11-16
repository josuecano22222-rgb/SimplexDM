/**
 * Line of sight — cursor_master_prompt.md Section E; Tools.md §3.
 */
(function () {
    'use strict';

    function isTileHitObject(hit) {
        if (!hit || !hit.object) return false;
        const o = hit.object;
        if (o.primitive && o.primitive instanceof Cesium.Cesium3DTileset) return true;
        if (typeof Cesium.Cesium3DTileFeature !== 'undefined' && o instanceof Cesium.Cesium3DTileFeature) {
            return true;
        }
        return false;
    }

    class LineOfSightClass {
        constructor(viewer) {
            this.viewer = viewer;
            this.step = 0.01;
            this.sphereRadius = 0.4;
            this.safeMaterial = Cesium.Color.GREEN;
            this.deadMaterial = Cesium.Color.RED;
            this.start = new Cesium.Cartesian3();
            this.end = new Cesium.Cartesian3();
            this.initialStart = new Cesium.Cartesian3();
            this.initialEnd = new Cesium.Cartesian3();
            this.h_offsetS = 0;
            this.h_offsetE = 0;
            this.startSphere = null;
            this.endSphere = null;
            this.lineEntities = [];
            this.orangeSpheres = [];
        }

        addStart(position, heightOffset) {
            this.h_offsetS = heightOffset || 0;
            this.initialStart = Cesium.Cartesian3.clone(position, new Cesium.Cartesian3());
            const c = Cesium.Cartographic.fromCartesian(position);
            c.height = (c.height || 0) + this.h_offsetS;
            this.start = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height);
            this._ensureStartSphere();
            this._pushExclude(this.startSphere);
        }

        addEnd(position, heightOffset, skipEndSphere) {
            this.h_offsetE = heightOffset || 0;
            this.initialEnd = Cesium.Cartesian3.clone(position, new Cesium.Cartesian3());
            const c = Cesium.Cartographic.fromCartesian(position);
            c.height = (c.height || 0) + this.h_offsetE;
            this.end = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height);
            if (!skipEndSphere) this._ensureEndSphere();
            if (this.endSphere) this._pushExclude(this.endSphere);
        }

        _ensureStartSphere() {
            const v = this.viewer;
            if (this.startSphere) v.entities.remove(this.startSphere);
            this.startSphere = v.entities.add({
                position: this.start,
                ellipsoid: {
                    radii: new Cesium.Cartesian3(this.sphereRadius, this.sphereRadius, this.sphereRadius),
                    material: Cesium.Color.YELLOW.withAlpha(0.55)
                }
            });
            this.startSphere._type = 'startLOS';
        }

        _ensureEndSphere() {
            const v = this.viewer;
            if (this.endSphere) v.entities.remove(this.endSphere);
            this.endSphere = v.entities.add({
                position: this.end,
                ellipsoid: {
                    radii: new Cesium.Cartesian3(this.sphereRadius, this.sphereRadius, this.sphereRadius),
                    material: Cesium.Color.DEEPSKYBLUE.withAlpha(0.55)
                }
            });
            this.endSphere._type = 'endLOS';
        }

        _pushExclude(entity) {
            if (!window.LOSobjectsToExclude) window.LOSobjectsToExclude = [];
            if (entity && window.LOSobjectsToExclude.indexOf(entity) < 0) {
                window.LOSobjectsToExclude.push(entity);
            }
        }

        _clearVizOnly() {
            const v = this.viewer;
            this.lineEntities.forEach(function (e) {
                if (v.entities.contains(e)) v.entities.remove(e);
            });
            this.lineEntities = [];
            this.orangeSpheres.forEach(function (e) {
                if (v.entities.contains(e)) v.entities.remove(e);
            });
            this.orangeSpheres = [];
        }

        showIntersections(results, scene, dir, totalDist, ex, rayStep) {
            const eps = rayStep != null ? rayStep : this.step;
            const firstRay = new Cesium.Ray(this.start, dir);
            const firstPick = scene.pickFromRay(firstRay, ex);
            let blockDist = totalDist;
            if (firstPick && firstPick.position) {
                const hd = Cesium.Cartesian3.distance(this.start, firstPick.position);
                if (hd < totalDist - eps) {
                    blockDist = hd;
                }
            }

            const orangeAdded = [];
            for (let i = 0; i < results.length; i++) {
                const h = results[i];
                if (!h || !h.position || !isTileHitObject(h)) continue;
                let dup = false;
                for (let j = 0; j < orangeAdded.length; j++) {
                    if (Cesium.Cartesian3.distance(orangeAdded[j], h.position) < 0.5) {
                        dup = true;
                        break;
                    }
                }
                if (dup) continue;
                orangeAdded.push(Cesium.Cartesian3.clone(h.position, new Cesium.Cartesian3()));
                const ent = this.viewer.entities.add({
                    position: h.position,
                    ellipsoid: {
                        radii: new Cesium.Cartesian3(this.sphereRadius * 0.85, this.sphereRadius * 0.85, this.sphereRadius * 0.85),
                        material: Cesium.Color.ORANGE.withAlpha(0.75)
                    }
                });
                ent._type = 'losOrange';
                this.orangeSpheres.push(ent);
            }

            const split = blockDist < totalDist - eps * 2;
            if (split) {
                const mid = Cesium.Cartesian3.add(
                    this.start,
                    Cesium.Cartesian3.multiplyByScalar(dir, blockDist, new Cesium.Cartesian3()),
                    new Cesium.Cartesian3()
                );
                this._addLine(this.start, mid, this.safeMaterial);
                this._addLine(mid, this.end, this.deadMaterial);
            } else {
                this._addLine(this.start, this.end, this.safeMaterial);
            }
        }

        visualizeLineOfSight() {
            this._clearVizOnly();
            const scene = this.viewer.scene;
            const dir = Cesium.Cartesian3.subtract(this.end, this.start, new Cesium.Cartesian3());
            const a = Cesium.Cartesian3.magnitude(dir);
            if (a < 1e-6) return;
            Cesium.Cartesian3.normalize(dir, dir);
            const ex = window.LOSobjectsToExclude || [];
            // Hard-cap ray samples: a fixed max step (e.g. 2.5 m) made long segments run 10k+ pickFromRay
            // calls synchronously and froze the app. Step scales with segment length; cap total iterations.
            const maxSamples = 450;
            const step = Math.max(0.05, a / maxSamples);

            const results = [];
            for (let d = step; d < a; d += step) {
                const p = Cesium.Cartesian3.add(
                    this.start,
                    Cesium.Cartesian3.multiplyByScalar(dir, d, new Cesium.Cartesian3()),
                    new Cesium.Cartesian3()
                );
                const ray = new Cesium.Ray(p, dir);
                const hit = scene.pickFromRay(ray, ex);
                if (hit && hit.position) {
                    results.push({
                        distance: Cesium.Cartesian3.distance(this.start, hit.position),
                        position: Cesium.Cartesian3.clone(hit.position, new Cesium.Cartesian3()),
                        object: hit.object
                    });
                }
            }

            this.showIntersections(results, scene, dir, a, ex, step);
        }

        _addLine(p0, p1, color) {
            const ent = this.viewer.entities.add({
                polyline: {
                    positions: [p0, p1],
                    width: 3,
                    material: color,
                    arcType: Cesium.ArcType.NONE
                }
            });
            ent._type = 'lineLOS';
            this.lineEntities.push(ent);
            this._pushExclude(ent);
        }

        updateHeight(hS, hE) {
            this.clear();
            this.addStart(this.initialStart, hS);
            this.addEnd(this.initialEnd, hE, false);
            this.visualizeLineOfSight();
        }

        updateLine() {
            this.clear();
        }

        clear() {
            const v = this.viewer;
            this._clearVizOnly();
            if (this.startSphere && v.entities.contains(this.startSphere)) v.entities.remove(this.startSphere);
            if (this.endSphere && v.entities.contains(this.endSphere)) v.entities.remove(this.endSphere);
            this.startSphere = null;
            this.endSphere = null;
        }
    }

    window.LineOfSightClass = LineOfSightClass;

    function getViewer() {
        return window.tilesetViewer && window.tilesetViewer.viewer;
    }

    function nudgeBackwardAlongCamera(viewer, screenPos, cartesian) {
        if (!Cesium.defined(cartesian)) return cartesian;
        const ray = viewer.camera.getPickRay(screenPos);
        if (!Cesium.defined(ray)) return cartesian;
        const dir = Cesium.Cartesian3.normalize(ray.direction, new Cesium.Cartesian3());
        return Cesium.Cartesian3.add(
            cartesian,
            Cesium.Cartesian3.multiplyByScalar(dir, -0.15, new Cesium.Cartesian3()),
            new Cesium.Cartesian3()
        );
    }

    function findLosInstance(entity, list) {
        for (let i = 0; i < list.length; i++) {
            const los = list[i];
            if (!los) continue;
            if (los.startSphere === entity || los.endSphere === entity) return los;
            if (los.lineEntities && los.lineEntities.indexOf(entity) >= 0) return los;
            if (los.orangeSpheres && los.orangeSpheres.indexOf(entity) >= 0) return los;
        }
        return null;
    }

    function registerTool() {
        const tm = window.toolManager;
        if (!tm || tm.getTool('createLineOfSight')) return;

        let initedFlag = false;
        let handler = null;
        let s = [];
        let u = true;
        let currentLos = null;
        let selSub = null;
        let vko = null;
        let subD1 = null;
        let subD2 = null;

        function hideInfoBox(hide) {
            const el = document.querySelector('.cesium-viewer-infoBoxContainer');
            if (!el) return;
            el.style.display = hide ? 'none' : '';
        }

        function injectToolbarKnockout() {
            const host = document.getElementById('toolbarLOS');
            if (!host || host.children.length > 0) return;
            const convCurr = window.convertToCurrUnit || function (m) {
                return m;
            };
            const convM = window.convertToMetersIfNecessary || function (x) {
                return x;
            };
            const i18n = window.smart3dI18n && window.smart3dI18n.t ? window.smart3dI18n.t : function (k) {
                return k;
            };

            const maxDisp = convCurr(10);
            const stepDisp = convCurr(0.1);

            host.setAttribute('dir', window.Lan === 'He' ? 'rtl' : 'ltr');

            const koRef = window.ko;
            if (koRef) {
                host.innerHTML =
                    '<fieldset id="form-nameHeight">' +
                    '<legend>' +
                    i18n('lineOfSight.title') +
                    '</legend>' +
                    '<table id="tableHeight">' +
                    '<tr><td data-bind="text: heightOffsetSLabel"></td><td>' +
                    '<input type="range" id="losRngS" min="0" data-bind="attr: { max: maxH, step: stepH }, value: heightS, valueUpdate: \'input\'" />' +
                    '</td></tr>' +
                    '<tr><td data-bind="text: heightOffsetELabel"></td><td>' +
                    '<input type="range" id="losRngE" min="0" data-bind="attr: { max: maxH, step: stepH }, value: heightE, valueUpdate: \'input\'" />' +
                    '</td></tr>' +
                    '</table>' +
                    '</fieldset>';
                vko = {
                    heightOffsetSLabel: koRef.observable(i18n('lineOfSight.heightOffsetS')),
                    heightOffsetELabel: koRef.observable(i18n('lineOfSight.heightOffsetE')),
                    maxH: koRef.observable(maxDisp),
                    stepH: koRef.observable(stepDisp),
                    heightS: koRef.observable(convCurr(0)),
                    heightE: koRef.observable(convCurr(0))
                };

                koRef.applyBindings(vko, host);

                subD1 = vko.heightS.subscribe(function () {
                    if (typeof window._losOffsetApply === 'function') window._losOffsetApply();
                });
                subD2 = vko.heightE.subscribe(function () {
                    if (typeof window._losOffsetApply === 'function') window._losOffsetApply();
                });
            } else {
                host.innerHTML =
                    '<fieldset id="form-nameHeight">' +
                    '<legend>' +
                    i18n('lineOfSight.title') +
                    '</legend>' +
                    '<table id="tableHeight">' +
                    '<tr><td>' +
                    i18n('lineOfSight.heightOffsetS') +
                    '</td><td>' +
                    '<input type="range" id="losRngS" min="0" max="' +
                    maxDisp +
                    '" step="' +
                    stepDisp +
                    '" value="0" />' +
                    '</td></tr>' +
                    '<tr><td>' +
                    i18n('lineOfSight.heightOffsetE') +
                    '</td><td>' +
                    '<input type="range" id="losRngE" min="0" max="' +
                    maxDisp +
                    '" step="' +
                    stepDisp +
                    '" value="0" />' +
                    '</td></tr>' +
                    '</table>' +
                    '</fieldset>';
                const rs = document.getElementById('losRngS');
                const re = document.getElementById('losRngE');
                const sync = function () {
                    if (typeof window._losOffsetApply === 'function') window._losOffsetApply();
                };
                if (rs) rs.addEventListener('input', sync);
                if (re) re.addEventListener('input', sync);
            }
        }

        function getHeightMeters() {
            const convM = window.convertToMetersIfNecessary || function (x) {
                return x;
            };
            if (vko) {
                return {
                    hS: convM(vko.heightS()),
                    hE: convM(vko.heightE())
                };
            }
            const rs = document.getElementById('losRngS');
            const re = document.getElementById('losRngE');
            return {
                hS: rs ? convM(parseFloat(rs.value)) : 0,
                hE: re ? convM(parseFloat(re.value)) : 0
            };
        }

        window._losOffsetApply = function () {
            const hm = getHeightMeters();
            if (currentLos && !u) {
                currentLos.updateHeight(hm.hS, hm.hE);
            }
        };

        function clearPreview(viewer) {
            if (!viewer._losPreviewT) viewer._losPreviewT = null;
            if (!viewer._losPreviewM) viewer._losPreviewM = null;
            if (viewer._losPreviewT && viewer.entities.contains(viewer._losPreviewT)) {
                viewer.entities.remove(viewer._losPreviewT);
            }
            if (viewer._losPreviewM && viewer.entities.contains(viewer._losPreviewM)) {
                viewer.entities.remove(viewer._losPreviewM);
            }
            viewer._losPreviewT = null;
            viewer._losPreviewM = null;
            const ex = window.LOSobjectsToExclude || [];
            for (let i = ex.length - 1; i >= 0; i--) {
                if (ex[i] && ex[i]._losPreview) {
                    ex.splice(i, 1);
                }
            }
        }

        function deactivateInner() {
            initedFlag = false;
            const viewer = getViewer();
            const btn = document.getElementById('lineofsight');
            if (btn) btn.classList.remove('ActiveButton');
            if (window.smart3dToolbarWireup && typeof window.smart3dToolbarWireup.syncMapToolAriaFromDom === 'function') {
                window.smart3dToolbarWireup.syncMapToolAriaFromDom();
            }
            const tb = document.getElementById('toolbarLOS');
            if (tb) {
                tb.style.display = 'none';
                tb.innerHTML = '';
            }
            vko = null;
            if (subD1 && typeof subD1.dispose === 'function') subD1.dispose();
            if (subD2 && typeof subD2.dispose === 'function') subD2.dispose();
            subD1 = null;
            subD2 = null;
            window._losOffsetApply = function () {};

            hideInfoBox(false);
            if (selSub && viewer) {
                viewer.selectedEntityChanged.removeEventListener(selSub);
                selSub = null;
            }
            if (handler && !handler.isDestroyed()) {
                handler.destroy();
                handler = null;
            }
            if (viewer) {
                clearPreview(viewer);
                s.forEach(function (los) {
                    los.clear();
                });
                s = [];
                viewer.canvas.style.cursor = '';
            }
            u = true;
            currentLos = null;
            window.LOSobjectsToExclude = [];
        }

        tm.createTool(
            'createLineOfSight',
            function activate() {
                const viewer = getViewer();
                if (!viewer) return;
                if (initedFlag) {
                    deactivateInner();
                }
                initedFlag = true;
                window.LOSobjectsToExclude = [];
                hideInfoBox(true);
                const btn = document.getElementById('lineofsight');
                if (btn) btn.classList.add('ActiveButton');
                if (window.smart3dToolbarWireup && typeof window.smart3dToolbarWireup.syncMapToolAriaFromDom === 'function') {
                    window.smart3dToolbarWireup.syncMapToolAriaFromDom();
                }
                viewer.canvas.style.cursor = 'crosshair';
                injectToolbarKnockout();
                const tb = document.getElementById('toolbarLOS');
                if (tb) tb.style.display = 'inline-block';
                if (typeof window.applyToolbarTopOffset === 'function') {
                    window.applyToolbarTopOffset();
                    requestAnimationFrame(function () {
                        window.applyToolbarTopOffset();
                    });
                }

                selSub = function () {
                    const ent = viewer.selectedEntity;
                    if (!ent || !ent._type) return;
                    const ty = ent._type;
                    if (ty !== 'lineLOS' && ty !== 'startLOS' && ty !== 'endLOS') return;
                    const inst = findLosInstance(ent, s);
                    if (!inst) return;
                    const convCurr = window.convertToCurrUnit || function (m) {
                        return m;
                    };
                    if (vko) {
                        vko.heightS(convCurr(inst.h_offsetS));
                        vko.heightE(convCurr(inst.h_offsetE));
                    } else {
                        const rs = document.getElementById('losRngS');
                        const re = document.getElementById('losRngE');
                        if (rs) rs.value = String(convCurr(inst.h_offsetS));
                        if (re) re.value = String(convCurr(inst.h_offsetE));
                    }
                    currentLos = inst;
                    u = false;
                };
                viewer.selectedEntityChanged.addEventListener(selSub);

                u = true;
                handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

                function previewUpdate(moveOrUndefined) {
                    if (u || !currentLos) return;
                    clearPreview(viewer);
                    const endPos = moveOrUndefined
                        ? moveOrUndefined.endPosition
                        : viewer.scene.canvas;
                    let pe;
                    if (moveOrUndefined) {
                        pe = window.safePickPosition(viewer, endPos);
                    } else {
                        return;
                    }
                    if (!pe) return;
                    const hm = getHeightMeters();
                    const S = Cesium.Cartesian3.clone(currentLos.start, new Cesium.Cartesian3());
                    const xCart = Cesium.Cartesian3.clone(pe, new Cesium.Cartesian3());
                    const xg = Cesium.Cartographic.fromCartesian(xCart);
                    xg.height = (xg.height || 0) + hm.hE;
                    const x = Cesium.Cartesian3.fromRadians(xg.longitude, xg.latitude, xg.height);

                    const dir = Cesium.Cartesian3.subtract(x, S, new Cesium.Cartesian3());
                    const dist = Cesium.Cartesian3.magnitude(dir);
                    if (dist < 0.01) return;
                    Cesium.Cartesian3.normalize(dir, dir);
                    const ray = new Cesium.Ray(S, dir);
                    const hit = viewer.scene.pickFromRay(ray, window.LOSobjectsToExclude || []);
                    const A = hit && hit.position ? hit.position : x;

                    const T = viewer.entities.add({
                        polyline: {
                            positions: new Cesium.CallbackProperty(function () {
                                return [S, A];
                            }, false),
                            width: 2,
                            material: Cesium.Color.GREEN,
                            arcType: Cesium.ArcType.NONE
                        }
                    });
                    T._losPreview = true;
                    const M = viewer.entities.add({
                        polyline: {
                            positions: new Cesium.CallbackProperty(function () {
                                return [A, x];
                            }, false),
                            width: 2,
                            material: Cesium.Color.RED,
                            arcType: Cesium.ArcType.NONE
                        }
                    });
                    M._losPreview = true;
                    viewer._losPreviewT = T;
                    viewer._losPreviewM = M;
                    if (!window.LOSobjectsToExclude) window.LOSobjectsToExclude = [];
                    window.LOSobjectsToExclude.push(T);
                    window.LOSobjectsToExclude.push(M);
                }

                function k(move) {
                    viewer._losLastMovePos = move.endPosition;
                    previewUpdate(move);
                }

                function C(click) {
                    const raw = window.safePickPosition(viewer, click.position);
                    if (!Cesium.defined(raw)) return;
                    const p = nudgeBackwardAlongCamera(viewer, click.position, raw);
                    if (u) {
                        currentLos = new LineOfSightClass(viewer);
                        const hm = getHeightMeters();
                        currentLos.addStart(p, hm.hS);
                        u = false;
                        handler.setInputAction(k, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
                    } else {
                        const hm = getHeightMeters();
                        const los = currentLos;
                        los.addEnd(p, hm.hE, false);
                        s.push(los);
                        clearPreview(viewer);
                        handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
                        u = true;
                        currentLos = null;
                        viewer.canvas.style.cursor = 'crosshair';
                        setTimeout(function () {
                            try {
                                los.visualizeLineOfSight();
                                viewer.scene.requestRender?.();
                            } catch (err) {
                                console.error('LineOfSight visualizeLineOfSight', err);
                            }
                        }, 0);
                    }
                }

                function w(click) {
                    C(click);
                }

                handler.setInputAction(w, Cesium.ScreenSpaceEventType.LEFT_CLICK);
            },
            function deactivate() {
                deactivateInner();
            }
        );

        const t = tm.getTool('createLineOfSight');
        if (t) t.showPickHelper = true;
    }

    window.lineOfSightManager = {
        init: function () {
            registerTool();
        }
    };
})();
