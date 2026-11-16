/**
 * Directions — straight-line (geodesic) path between two WGS84 points,
 * distance, bearing, optional polyline on the globe.
 */
(function () {
    'use strict';

    function parseNum(el) {
        if (!el) return NaN;
        const v = parseFloat(String(el.value).replace(/,/g, '.').trim(), 10);
        return Number.isFinite(v) ? v : NaN;
    }

    function cardinal8(deg) {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
        return dirs[i];
    }

    class DirectionsManager {
        constructor() {
            this._lineEntity = null;
        }

        init() {
            const closeBtn = document.getElementById('directionsCloseBtn');
            const modal = document.getElementById('directionsModal');
            closeBtn?.addEventListener('click', () => this.close());
            modal?.addEventListener('click', (e) => {
                if (e.target === modal) this.close();
            });
            document.getElementById('directionsUseCursorBtn')?.addEventListener('click', () => this.fillFromCursor());
            document.getElementById('directionsUseCameraBtn')?.addEventListener('click', () => this.fillFromCamera());
            document.getElementById('directionsSwapBtn')?.addEventListener('click', () => this.swapEndpoints());
            document.getElementById('directionsComputeBtn')?.addEventListener('click', () => this.compute());
            document.getElementById('directionsClearLineBtn')?.addEventListener('click', () => this.clearLine());
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                const modal = document.getElementById('directionsModal');
                if (modal && modal.style.display !== 'none') this.close();
            });
        }

        open() {
            const modal = document.getElementById('directionsModal');
            if (modal) modal.style.display = 'flex';
        }

        close() {
            const modal = document.getElementById('directionsModal');
            if (modal) modal.style.display = 'none';
        }

        fillFromCursor() {
            const cm = window.coordinateManager;
            if (!cm || cm.currentCoordinates.lon == null) {
                window.notification?.warning('Move the cursor over the globe first.');
                return;
            }
            const { lon, lat } = cm.currentCoordinates;
            this._setInputs('from', lat, lon);
        }

        fillFromCamera() {
            const v = window.tilesetViewer?.viewer;
            if (!v || !v.camera?.positionCartographic) {
                window.notification?.warning('Viewer not ready.');
                return;
            }
            const c = v.camera.positionCartographic;
            const lat = Cesium.Math.toDegrees(c.latitude);
            const lon = Cesium.Math.toDegrees(c.longitude);
            this._setInputs('from', lat, lon);
        }

        _setInputs(which, lat, lon) {
            const prefix = which === 'from' ? 'directionsFrom' : 'directionsTo';
            const la = document.getElementById(`${prefix}Lat`);
            const lo = document.getElementById(`${prefix}Lon`);
            if (la) la.value = lat.toFixed(10);
            if (lo) lo.value = lon.toFixed(10);
        }

        swapEndpoints() {
            const a1 = document.getElementById('directionsFromLat');
            const o1 = document.getElementById('directionsFromLon');
            const a2 = document.getElementById('directionsToLat');
            const o2 = document.getElementById('directionsToLon');
            if (!a1 || !o1 || !a2 || !o2) return;
            const t1 = a1.value;
            const t2 = o1.value;
            a1.value = a2.value;
            o1.value = o2.value;
            a2.value = t1;
            o2.value = t2;
        }

        compute() {
            const lat1 = parseNum(document.getElementById('directionsFromLat'));
            const lon1 = parseNum(document.getElementById('directionsFromLon'));
            const lat2 = parseNum(document.getElementById('directionsToLat'));
            const lon2 = parseNum(document.getElementById('directionsToLon'));
            if ([lat1, lon1, lat2, lon2].some((x) => !Number.isFinite(x))) {
                window.notification?.warning('Enter valid latitude and longitude for both points.');
                return;
            }
            if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90) {
                window.notification?.warning('Latitude must be between −90° and 90°.');
                return;
            }
            if (lon1 < -180 || lon1 > 180 || lon2 < -180 || lon2 > 180) {
                window.notification?.warning('Longitude must be between −180° and 180°.');
                return;
            }

            const start = Cesium.Cartographic.fromDegrees(lon1, lat1);
            const end = Cesium.Cartographic.fromDegrees(lon2, lat2);
            const geodesic = new Cesium.EllipsoidGeodesic(start, end);
            const meters = geodesic.surfaceDistance;
            const bearingStartDeg = this._initialBearingDeg(lat1, lon1, lat2, lon2);

            const distEl = document.getElementById('directionsDistanceOut');
            const bearEl = document.getElementById('directionsBearingOut');
            const cardEl = document.getElementById('directionsCardinalOut');
            if (distEl) {
                distEl.textContent =
                    typeof window.simplexFormatDistanceMeters === 'function'
                        ? window.simplexFormatDistanceMeters(meters)
                        : (!Number.isFinite(meters) ? '—' : `${meters.toFixed(1)} m`);
            }
            if (bearEl) bearEl.textContent = `${bearingStartDeg.toFixed(2)}° (from start toward destination)`;
            if (cardEl) cardEl.textContent = cardinal8(bearingStartDeg);

            this._drawGeodesic(geodesic, lat1, lon1, lat2, lon2);

            if (window.notification) {
                window.notification.success(
                    window.appI18n?.nt ? window.appI18n.nt('geodesicPathUpdated') : 'Geodesic path updated.'
                );
            }
        }

        /**
         * Initial (forward) bearing from point 1 toward point 2, degrees 0–360 (clockwise from north).
         */
        _initialBearingDeg(lat1, lon1, lat2, lon2) {
            const φ1 = (lat1 * Math.PI) / 180;
            const φ2 = (lat2 * Math.PI) / 180;
            const Δλ = ((lon2 - lon1) * Math.PI) / 180;
            const y = Math.sin(Δλ) * Math.cos(φ2);
            const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
            const θ = Math.atan2(y, x);
            return ((θ * 180) / Math.PI + 360) % 360;
        }

        _drawGeodesic(geodesic, lat1, lon1, lat2, lon2) {
            const viewer = window.tilesetViewer?.viewer;
            if (!viewer || !viewer.entities) return;

            this.clearLine();

            const positions = [];
            const n = 96;
            try {
                for (let i = 0; i <= n; i++) {
                    const c = geodesic.interpolateUsingFraction(i / n);
                    positions.push(
                        Cesium.Cartesian3.fromRadians(
                            c.longitude,
                            c.latitude,
                            Math.max(0, c.height || 0)
                        )
                    );
                }
            } catch (e) {
                positions.length = 0;
                positions.push(
                    Cesium.Cartesian3.fromDegrees(lon1, lat1, 0),
                    Cesium.Cartesian3.fromDegrees(lon2, lat2, 0)
                );
            }
            if (positions.length < 2) {
                positions.length = 0;
                positions.push(
                    Cesium.Cartesian3.fromDegrees(lon1, lat1, 0),
                    Cesium.Cartesian3.fromDegrees(lon2, lat2, 0)
                );
            }

            this._lineEntity = viewer.entities.add({
                name: 'Directions geodesic',
                polyline: {
                    positions,
                    width: 3,
                    material: Cesium.Color.CYAN.withAlpha(0.95),
                    clampToGround: false
                }
            });
        }

        clearLine() {
            const viewer = window.tilesetViewer?.viewer;
            if (viewer && viewer.entities && this._lineEntity) {
                viewer.entities.remove(this._lineEntity);
                this._lineEntity = null;
            }
        }
    }

    window.directionsManager = new DirectionsManager();
})();
