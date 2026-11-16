/**
 * Viewshed — cursor_master_prompt.md Section F; Tools.md §4.
 */
(function () {
    'use strict';

    function getViewer() {
        return window.tilesetViewer && window.tilesetViewer.viewer;
    }

    function M(ibMode) {
        const i18n = window.smart3dI18n && window.smart3dI18n.t ? window.smart3dI18n.t : function (k) {
            return k;
        };
        const saveAllow = window.viewshedAllowSave !== false;
        const saveStyle = saveAllow ? '' : ' style="display:none"';
        const tblId = ibMode ? 'tableVSH_ib' : 'tableVSH';
        const saveId = ibMode ? 'save_vsh_ib' : 'save_vsh';
        return (
            '<div class="toolbarVSH-inner">' +
            '<button type="button" id="close_vshd_tb"></button>' +
            '<div class="vsh-mini">' +
            '<button type="button" id="' +
            saveId +
            '"' +
            saveStyle +
            '></button>' +
            '<button type="button" id="delete_vsh"></button>' +
            '<button type="button" id="target_vsh"></button>' +
            '<button type="button" id="move_vsh"></button>' +
            '<button type="button" id="focus_vsh"></button>' +
            '<button type="button" id="show_vsh"></button>' +
            '</div>' +
            '<table id="' +
            tblId +
            '">' +
            '<tr><td>' +
            i18n('viewshed.sensorProperties') +
            '</td><td><input type="text" id="vsh_name" data-field="name" /></td></tr>' +
            '<tr><td>radius</td><td><input type="range" id="vsh_radius_r" min="0" max="500" step="0.05" data-field="radius" /><span id="vsh_radius_lbl"></span></td></tr>' +
            '<tr><td>height</td><td><input type="range" id="vsh_height_r" min="0" max="50" step="0.01" data-field="sheight" /><span id="vsh_height_lbl"></span></td></tr>' +
            '<tr><td>heading</td><td><input type="range" id="vsh_hdg_r" min="-180" max="180" step="0.05" data-field="heading" /><span id="vsh_hdg_lbl"></span></td></tr>' +
            '<tr><td>pitch</td><td><input type="range" id="vsh_pitch_r" min="-180" max="180" step="0.05" data-field="pitch" /><span id="vsh_pitch_lbl"></span></td></tr>' +
            '<tr><td>FOVy</td><td><input type="range" id="vsh_fovy_r" min="0.5" max="180" step="0.1" data-field="yangle" /><span id="vsh_fovy_lbl"></span></td></tr>' +
            '<tr><td>FOVx</td><td><input type="range" id="vsh_fovx_r" min="0.5" max="180" step="0.1" data-field="xangle" /><span id="vsh_fovx_lbl"></span></td></tr>' +
            '<tr><td>classificationType</td><td><input type="number" id="vsh_class" data-field="classificationType" /></td></tr>' +
            '<tr><td>uid</td><td><input type="text" id="vsh_uid" data-field="uid" /></td></tr>' +
            '</table>' +
            '</div>'
        );
    }

    function registerViewshedTool() {
        const tm = window.toolManager;
        if (!tm || tm.getTool('viewshed')) return;

        let handler = null;
        let d = null;
        let l = false;
        let c = false;
        let r = false;
        let s = false;
        let m = 'position';
        let h = false;
        let koDispose = null;
        let subS = null;

        const p = {
            name: '',
            radius: 500,
            sheight: 0,
            heading: 0,
            pitch: 0,
            yangle: 60,
            xangle: 90,
            computedRadius: 500,
            computedHeight: 0,
            classificationType: 0,
            uid: '',
            init_position: { longitude: 0, latitude: 0, height: 0 },
            params: {},
            _type: ''
        };

        let vshPhase = 'eye';
        let ibMode = false;

        window.save_vsh_and_close = function () {
            const tool = tm.getTool('viewshed');
            if (tool) tool.enabled = false;
        };

        function S() {
            const convM = window.convertToMetersIfNecessary || function (x) {
                return x;
            };
            let rad = p.computedRadius != null ? p.computedRadius : p.radius;
            rad = Math.max(0.01, rad);
            p.radius = convM(rad);
            p.computedRadius = rad;
            const ht = p.computedHeight != null ? p.computedHeight : p.sheight;
            p.sheight = convM(ht);
            p.computedHeight = ht;
            window.VSHD.UpdateSensor(p);
        }

        function x() {
            const viewer = getViewer();
            const VSHD = window.VSHD;
            if (!viewer || !VSHD || !VSHD._eyeCartesian) return;
            const pr = VSHD.current && VSHD.current.params ? VSHD.current.params : p;
            const dest = Cesium.Cartesian3.clone(VSHD._eyeCartesian, new Cesium.Cartesian3());
            const radM = pr.computedRadius != null ? pr.computedRadius : pr.radius;
            const r = Math.max(0.1, Number.isFinite(radM) ? radM : 500);
            const viewDist = Math.min(2800, Math.max(75, r * 0.38));
            const bs = new Cesium.BoundingSphere(dest, Math.max(1.5, r * 0.02));
            const hdg = Cesium.Math.toRadians(pr.heading || 0);
            viewer.camera.flyToBoundingSphere(bs, {
                offset: new Cesium.HeadingPitchRange(hdg + Math.PI, Cesium.Math.toRadians(-24), viewDist),
                duration: 2
            });
            viewer.scene.requestRender?.();
        }

        function T() {
            const endsIb = typeof p._type === 'string' && p._type.endsWith('_ib');
            if (endsIb) {
                let base = window.updateUrl || '';
                if (base.indexOf('updateFeatures') >= 0) {
                    base = base.replace('updateFeatures', 'updateViewshed');
                } else if (!base) {
                    base = window.updateViewshed || '';
                }
                const featureID = window.featureID != null ? window.featureID : '';
                const uID = window.uID != null ? window.uID : '';
                let url = base;
                if (url && featureID !== '') {
                    url = url.replace(/\/?$/, '') + '/' + featureID + '/' + uID;
                }
                if (url && typeof window.fetch2 === 'function') {
                    window
                        .fetch2(url, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: window.uToken || ''
                            },
                            body: JSON.stringify({
                                uid: p.uid,
                                init_position: p.init_position,
                                params: p
                            })
                        })
                        .catch(function () {});
                }
            } else if (window.notification && typeof window.notification.info === 'function') {
                window.notification.info(
                    window.appI18n?.nt ? window.appI18n.nt('viewshedSaved') : 'Viewshed saved locally'
                );
            }
        }

        function applyUnitSliders(viewer) {
            const conv = window.convertToCurrUnit || function (m) {
                return m;
            };
            const rmax = conv(500);
            const hmax = conv(50);
            const rr = document.getElementById('vsh_radius_r');
            const hr = document.getElementById('vsh_height_r');
            if (rr) {
                rr.max = rmax;
                rr.min = 0;
            }
            if (hr) {
                hr.max = hmax;
                hr.min = 0;
            }
        }

        function wirePanel(viewer, openFull) {
            ibMode = typeof p._type === 'string' && p._type.endsWith('_ib');
            const host = document.getElementById('toolbarVSH');
            if (!host) return;
            host.innerHTML = M(ibMode);
            const VSHD = window.VSHD;
            if (openFull) {
                VSHD.ResetToDefaults(p);
                VSHD.SetCurrent(p);
            }
            VSHD.SetViewer(viewer);
            applyUnitSliders(viewer);

            function syncFromUi() {
                const nm = document.getElementById('vsh_name');
                if (nm) p.name = nm.value;
                const uidEl = document.getElementById('vsh_uid');
                if (uidEl) p.uid = uidEl.value;
                const cl = document.getElementById('vsh_class');
                if (cl) p.classificationType = parseFloat(cl.value) || 0;
            }

            function fmtDeg(v) {
                const n = Number(v);
                return (Number.isFinite(n) ? n : 0).toFixed(2) + '\u00b0';
            }
            function fmtFov(v) {
                const n = Number(v);
                return (Number.isFinite(n) ? n : 0).toFixed(2) + '\u00b0';
            }
            function fmtLen(v) {
                const n = Number(v);
                return (Number.isFinite(n) ? n : 0).toFixed(3);
            }
            const unitSuf =
                typeof window.getUnitForDisplay === 'function' ? ' ' + window.getUnitForDisplay() : '';

            function syncSlidersToDom() {
                const fields = {
                    vsh_radius_r: 'computedRadius',
                    vsh_height_r: 'computedHeight',
                    vsh_hdg_r: 'heading',
                    vsh_pitch_r: 'pitch',
                    vsh_fovx_r: 'xangle',
                    vsh_fovy_r: 'yangle'
                };
                Object.keys(fields).forEach(function (id) {
                    const el = document.getElementById(id);
                    const key = fields[id];
                    if (el && p[key] != null) el.value = p[key];
                });
                const nm = document.getElementById('vsh_name');
                const uidEl = document.getElementById('vsh_uid');
                const cl = document.getElementById('vsh_class');
                if (nm) nm.value = p.name || '';
                if (uidEl) uidEl.value = p.uid || '';
                if (cl) cl.value = String(p.classificationType || 0);
                const lr = document.getElementById('vsh_radius_lbl');
                const lh = document.getElementById('vsh_height_lbl');
                if (lr) lr.textContent = fmtLen(p.computedRadius != null ? p.computedRadius : p.radius) + unitSuf;
                if (lh) lh.textContent = fmtLen(p.computedHeight != null ? p.computedHeight : p.sheight) + unitSuf;
                const lhH = document.getElementById('vsh_hdg_lbl');
                const lhP = document.getElementById('vsh_pitch_lbl');
                const lfX = document.getElementById('vsh_fovx_lbl');
                const lfY = document.getElementById('vsh_fovy_lbl');
                if (lhH) lhH.textContent = fmtDeg(p.heading);
                if (lhP) lhP.textContent = fmtDeg(p.pitch);
                if (lfX) lfX.textContent = fmtFov(p.xangle);
                if (lfY) lfY.textContent = fmtFov(p.yangle);
            }

            syncSlidersToDom();

            function onRange(id, key, isRadius) {
                const el = document.getElementById(id);
                if (!el) return;
                el.addEventListener('input', function () {
                    let v = parseFloat(el.value);
                    if (isRadius) v = Math.max(0.01, v);
                    p[key] = v;
                    if (key === 'radius' || key === 'computedRadius') {
                        p.computedRadius = v;
                        p.radius = v;
                    }
                    if (key === 'sheight' || key === 'computedHeight') {
                        p.computedHeight = v;
                        p.sheight = v;
                    }
                    syncFromUi();
                    S();
                    syncSlidersToDom();
                });
            }

            onRange('vsh_radius_r', 'computedRadius', true);
            onRange('vsh_height_r', 'computedHeight', false);
            onRange('vsh_hdg_r', 'heading', false);
            onRange('vsh_pitch_r', 'pitch', false);
            onRange('vsh_fovx_r', 'xangle', false);
            onRange('vsh_fovy_r', 'yangle', false);

            document.getElementById('vsh_name')?.addEventListener('input', function () {
                syncFromUi();
            });
            document.getElementById('vsh_uid')?.addEventListener('input', function () {
                syncFromUi();
            });
            document.getElementById('vsh_class')?.addEventListener('input', function () {
                syncFromUi();
            });

            document.getElementById('close_vshd_tb')?.addEventListener('click', function () {
                window.save_vsh_and_close();
            });
            document.getElementById('delete_vsh')?.addEventListener('click', function () {
                VSHD.Delete();
                if (window.notification) {
                    window.notification.info(
                        window.appI18n?.nt ? window.appI18n.nt('viewshedRemoved') : 'Viewshed removed'
                    );
                }
            });
            document.getElementById('focus_vsh')?.addEventListener('click', function () {
                x();
            });
            document.getElementById('target_vsh')?.addEventListener('click', function () {
                vshPhase = 'target';
                h = false;
                const em = document.getElementById('editmodel');
                if (em) {
                    const i18n = window.smart3dI18n && window.smart3dI18n.t ? window.smart3dI18n.t : function (k) {
                        return k;
                    };
                    em.textContent = i18n('viewshed.locateTarget');
                }
            });
            document.getElementById('move_vsh')?.addEventListener('click', function () {
                if (VSHD.ActivateTransformEditor) VSHD.ActivateTransformEditor();
            });
            document.getElementById('show_vsh')?.addEventListener('click', function () {
                if (window.notification) {
                    window.notification.info(
                        window.appI18n?.nt ? window.appI18n.nt('viewshedShow') : 'Show'
                    );
                }
            });
            const sid = ibMode ? 'save_vsh_ib' : 'save_vsh';
            document.getElementById(sid)?.addEventListener('click', function () {
                T();
            });

            window.__vshSyncSliders = syncSlidersToDom;
        }

        function A(click) {
            const viewer = getViewer();
            const VSHD = window.VSHD;
            const pos = window.safePickPosition(viewer, click.position, { nudgeMeters: 0.06 });
            if (!pos) return;
            if (vshPhase === 'eye') {
                VSHD.UpdateEyePoint(pos, p);
                VSHD.CreateRectangularSensor(p);
                vshPhase = 'target';
                const em = document.getElementById('editmodel');
                if (em) {
                    const i18n = window.smart3dI18n && window.smart3dI18n.t ? window.smart3dI18n.t : function (k) {
                        return k;
                    };
                    em.textContent = i18n('viewshed.locateTarget');
                }
            } else if (vshPhase === 'target') {
                VSHD.SetTarget(pos, p);
                vshPhase = 'done';
                h = false;
                if (typeof window.__vshSyncSliders === 'function') window.__vshSyncSliders();
            }
        }

        function E(move) {
            if (window.ismobile) return;
            const viewer = getViewer();
            if (!l || !viewer) return;
            const pos = window.safePickPosition(viewer, move.endPosition, { nudgeMeters: 0.06 });
            if (!pos) return;
            if (vshPhase === 'target' && !h) {
                window.VSHD.SetTarget(pos, p);
                if (typeof window.__vshSyncSliders === 'function') window.__vshSyncSliders();
            } else if (h && (vshPhase === 'done' || vshPhase === 'eye')) {
                window.VSHD.UpdateEyePoint(pos, p);
                window.VSHD.UpdateSensor(p);
            }
        }

        tm.createTool(
            'viewshed',
            function activate(e) {
                const viewer = getViewer();
                if (!viewer) return;
                const openFull = e === undefined ? true : !!e;
                l = true;
                c = false;
                r = false;
                s = false;
                m = 'position';
                h = false;
                vshPhase = 'eye';

                const host = document.getElementById('toolbarVSH');
                if (host) {
                    host.innerHTML = '';
                    host.style.display = 'inline-block';
                }
                if (typeof window.applyToolbarTopOffset === 'function') {
                    window.applyToolbarTopOffset();
                    requestAnimationFrame(function () {
                        window.applyToolbarTopOffset();
                    });
                }

                if (openFull) {
                    wirePanel(viewer, true);
                } else {
                    wirePanel(viewer, false);
                }

                if (openFull) {
                    document.getElementById('viewshed')?.classList.add('ActiveButton');
                    if (window.smart3dToolbarWireup && typeof window.smart3dToolbarWireup.syncMapToolAriaFromDom === 'function') {
                        window.smart3dToolbarWireup.syncMapToolAriaFromDom();
                    }
                    if (typeof window.SimplexButton === 'function') window.SimplexButton();
                    if (typeof window.closeBookmarksNav === 'function') window.closeBookmarksNav();
                    const em = document.getElementById('editmodel');
                    if (em) {
                        em.style.display = 'block';
                        const i18n = window.smart3dI18n && window.smart3dI18n.t ? window.smart3dI18n.t : function (k) {
                            return k;
                        };
                        em.textContent = i18n('viewshed.locateSensor');
                    }
                    if (viewer.scene.globe) {
                        d = viewer.scene.globe.shadows;
                        viewer.scene.globe.shadows = Cesium.ShadowMode.ENABLED;
                    }
                    if (viewer.scene.pickPositionSupported) {
                        m = 'position';
                    }
                }

                handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
                handler.setInputAction(A, Cesium.ScreenSpaceEventType.LEFT_CLICK);
                handler.setInputAction(E, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
            },
            function deactivate() {
                l = false;
                c = false;
                r = false;
                s = false;
                m = 'position';
                h = false;
                document.getElementById('viewshed')?.classList.remove('ActiveButton');
                if (window.smart3dToolbarWireup && typeof window.smart3dToolbarWireup.syncMapToolAriaFromDom === 'function') {
                    window.smart3dToolbarWireup.syncMapToolAriaFromDom();
                }
                const tb = document.getElementById('toolbarVSH');
                if (tb) {
                    tb.style.display = 'none';
                    tb.innerHTML = '';
                }
                const em = document.getElementById('editmodel');
                if (em) em.style.display = 'none';
                const viewer = getViewer();
                if (viewer && viewer.scene.globe && d !== null) {
                    viewer.scene.globe.shadows = d;
                    d = null;
                }
                if (window.VSHD) {
                    window.VSHD.Delete();
                    window.VSHD.hideEyeTargetEntities();
                }
                window.__vshSyncSliders = undefined;
                if (handler && !handler.isDestroyed()) {
                    handler.destroy();
                    handler = null;
                }
                if (koDispose && typeof koDispose === 'function') koDispose();
                koDispose = null;
                if (subS && typeof subS.dispose === 'function') subS.dispose();
                subS = null;
            }
        );

        const tool = tm.getTool('viewshed');
        if (tool) tool.showPickHelper = true;
    }

    registerViewshedTool();

    window.visibleHiddenAreasManager = {
        init: function () {},
        show: function () {
            const t = window.toolManager && window.toolManager.getTool('viewshed');
            if (t) t.enabled = true;
        },
        hide: function () {
            const t = window.toolManager && window.toolManager.getTool('viewshed');
            if (t) t.enabled = false;
        },
        toggle: function () {
            const t = window.toolManager && window.toolManager.getTool('viewshed');
            if (t) t.enabled = !t.enabled;
        }
    };
})();
