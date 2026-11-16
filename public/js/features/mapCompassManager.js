/**
 * MapCompassManager — on-map compass: live heading, click/drag to orient, bearing input.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'simplex_mapCompassVisible';

    function normalizeDeg(deg) {
        const d = Number(deg);
        if (!Number.isFinite(d)) return 0;
        return ((d % 360) + 360) % 360;
    }

    function cardinal8(deg) {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const i = Math.round(normalizeDeg(deg) / 45) % 8;
        return dirs[i];
    }

    function getViewer() {
        return window.tilesetViewer && window.tilesetViewer.viewer ? window.tilesetViewer.viewer : null;
    }

    class MapCompassManager {
        constructor() {
            this._removeListener = null;
            this._drag = null;
            this._lastFiniteHeading = 0;
            this._lastRenderedDeg = null;
            this.initialized = false;
        }

        init() {
            if (this.initialized) return;
            const widget = document.getElementById('mapCompassWidget');
            const dial = document.getElementById('mapCompassDial');
            const collapseBtn = document.getElementById('mapCompassCollapse');
            const showBtn = document.getElementById('mapCompassShowBtn');
            const applyBtn = document.getElementById('mapCompassApplyBtn');
            const bearingInput = document.getElementById('mapCompassBearingInput');
            if (!widget || !dial) {
                this.initialized = true;
                return;
            }

            const visiblePref = localStorage.getItem(STORAGE_KEY);
            if (visiblePref === '0') {
                widget.classList.add('map-compass-widget--hidden');
                if (showBtn) showBtn.style.display = 'flex';
            } else if (showBtn) {
                showBtn.style.display = 'none';
            }

            collapseBtn?.addEventListener('click', () => {
                widget.classList.add('map-compass-widget--hidden');
                if (showBtn) showBtn.style.display = 'flex';
                localStorage.setItem(STORAGE_KEY, '0');
            });

            showBtn?.addEventListener('click', () => {
                widget.classList.remove('map-compass-widget--hidden');
                showBtn.style.display = 'none';
                localStorage.setItem(STORAGE_KEY, '1');
            });

            dial.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.navigationManager && typeof window.navigationManager.pointToNorth === 'function') {
                    window.navigationManager.pointToNorth();
                }
            });

            dial.addEventListener('pointerdown', (e) => this._onDialPointerDown(e, dial));
            applyBtn?.addEventListener('click', () => this._applyBearingInput(bearingInput));
            bearingInput?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this._applyBearingInput(bearingInput);
            });

            const viewer = getViewer();
            if (viewer && viewer.scene) {
                const cb = () => this._syncRose(viewer);
                viewer.scene.postRender.addEventListener(cb);
                this._removeListener = () => {
                    viewer.scene.postRender.removeEventListener(cb);
                };
            }

            this.initialized = true;
        }

        _readHeadingDeg(viewer) {
            const rawRad = viewer && viewer.camera ? viewer.camera.heading : NaN;
            if (typeof rawRad === 'number' && Number.isFinite(rawRad)) {
                const rawDeg = Cesium.Math.toDegrees(rawRad);
                if (Number.isFinite(rawDeg)) {
                    this._lastFiniteHeading = normalizeDeg(rawDeg);
                }
            }
            return Number.isFinite(this._lastFiniteHeading) ? this._lastFiniteHeading : 0;
        }

        _syncRose(viewer) {
            const deg = this._readHeadingDeg(viewer);
            if (this._lastRenderedDeg !== null && Math.abs(deg - this._lastRenderedDeg) < 0.02) {
                return;
            }
            this._lastRenderedDeg = deg;
            const rot = Number.isFinite(-deg) ? (-deg || 0) : 0;
            const roseEl = document.getElementById('mapCompassRose');
            if (roseEl) {
                roseEl.setAttribute('transform', `rotate(${rot} 50 50)`);
            }
            const degOut = document.getElementById('mapCompassHeadingText');
            const cardOut = document.getElementById('mapCompassCardinal');
            if (degOut) degOut.textContent = deg.toFixed(0) + '°';
            if (cardOut) cardOut.textContent = cardinal8(deg);
        }

        _setHeading(deg) {
            const safeDeg = normalizeDeg(deg);
            this._lastFiniteHeading = safeDeg;
            if (window.navigationManager && typeof window.navigationManager.setHeadingDegrees === 'function') {
                window.navigationManager.setHeadingDegrees(safeDeg);
            } else {
                const v = getViewer();
                if (!v || !v.camera) return;
                const cam = v.camera;
                const pitch = Number.isFinite(cam.pitch) ? cam.pitch : -Cesium.Math.PI_OVER_TWO;
                const roll = Number.isFinite(cam.roll) ? cam.roll : 0;
                cam.setView({
                    orientation: {
                        heading: Cesium.Math.toRadians(safeDeg),
                        pitch: pitch,
                        roll: roll
                    }
                });
            }
        }

        _applyBearingInput(inputEl) {
            if (!inputEl) return;
            const v = parseFloat(String(inputEl.value).replace(/,/g, '.').trim(), 10);
            if (!Number.isFinite(v)) {
                window.notification?.warning('Enter a bearing between 0 and 360.');
                return;
            }
            this._setHeading(v);
        }

        _bearingFromDialClick(dial, clientX, clientY) {
            const r = dial.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const dx = clientX - cx;
            const dy = clientY - cy;
            const rad = Math.atan2(dx, -dy);
            return normalizeDeg((rad * 180) / Math.PI);
        }

        _onDialPointerDown(e, dial) {
            if (e.button !== 0) return;
            const viewer = getViewer();
            if (!viewer) return;

            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX;
            const startY = e.clientY;
            const startH = this._readHeadingDeg(viewer);
            let moved = false;

            const onMove = (ev) => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
                if (moved) {
                    const delta = (ev.clientX - startX) * 0.4;
                    this._setHeading(startH + delta);
                }
            };

            const onUp = (upEv) => {
                dial.removeEventListener('pointermove', onMove);
                dial.removeEventListener('pointerup', onUp);
                dial.removeEventListener('pointercancel', onUp);
                try {
                    dial.releasePointerCapture(e.pointerId);
                } catch (_) {}

                if (!moved && upEv.type === 'pointerup') {
                    const r = dial.getBoundingClientRect();
                    const cx = r.left + r.width / 2;
                    const cy = r.top + r.height / 2;
                    const rdx = upEv.clientX - cx;
                    const rdy = upEv.clientY - cy;
                    if (Math.hypot(rdx, rdy) > 8) {
                        const b = this._bearingFromDialClick(dial, upEv.clientX, upEv.clientY);
                        this._setHeading(b);
                    }
                }
            };

            dial.addEventListener('pointermove', onMove);
            dial.addEventListener('pointerup', onUp);
            dial.addEventListener('pointercancel', onUp);
            try {
                dial.setPointerCapture(e.pointerId);
            } catch (_) {}
        }

        destroy() {
            if (this._removeListener) {
                this._removeListener();
                this._removeListener = null;
            }
            this.initialized = false;
        }
    }

    window.mapCompassManager = new MapCompassManager();
})();
