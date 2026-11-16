/**
 * Pick world position; optional nudge on globe ray (Tools.md §3.3, §6.7).
 * Order: depth-buffer pick on tiles/terrain → un-nudged globe ray → nudged globe ray → ellipsoid.
 */
(function () {
    'use strict';

    /**
     * @param {Cesium.Viewer} viewer
     * @param {Cesium.Cartesian2} screenPosition
     * @param {object} [options]
     * @param {Cesium.Cartesian3} [options.nudgeMeters=0.08] — backward along camera ray for fallback globe picks (smaller = less bias when zoomed in)
     * @returns {Cesium.Cartesian3|undefined}
     */
    function safePickPosition(viewer, screenPosition, options) {
        if (!viewer || !viewer.scene || !screenPosition) return undefined;
        const scene = viewer.scene;
        const ray = viewer.camera.getPickRay(screenPosition);
        if (!Cesium.defined(ray)) return undefined;

        const back = options && options.nudgeMeters !== undefined ? options.nudgeMeters : 0.08;
        const dir = Cesium.Cartesian3.normalize(ray.direction, new Cesium.Cartesian3());
        const origin = Cesium.Cartesian3.add(
            ray.origin,
            Cesium.Cartesian3.multiplyByScalar(dir, -back, new Cesium.Cartesian3()),
            new Cesium.Cartesian3()
        );
        const nudgedRay = new Cesium.Ray(origin, ray.direction);
        const rawRay = new Cesium.Ray(ray.origin, ray.direction);

        if (scene.pickPositionSupported) {
            const p = scene.pickPosition(screenPosition);
            if (Cesium.defined(p)) return p;
        }

        if (scene.globe) {
            const hitRaw = scene.globe.pick(rawRay, scene);
            if (Cesium.defined(hitRaw)) return hitRaw;
            const hitNudged = scene.globe.pick(nudgedRay, scene);
            if (Cesium.defined(hitNudged)) return hitNudged;
        }

        const ellipsoid = scene.globe && scene.globe.ellipsoid;
        if (ellipsoid) {
            let e = Cesium.IntersectionTests.rayEllipsoid(rawRay, ellipsoid);
            if (Cesium.defined(e)) {
                return Cesium.Ray.getPoint(rawRay, e.start);
            }
            e = Cesium.IntersectionTests.rayEllipsoid(nudgedRay, ellipsoid);
            if (Cesium.defined(e)) {
                return Cesium.Ray.getPoint(nudgedRay, e.start);
            }
        }
        return undefined;
    }

    if (typeof window !== 'undefined') {
        window.safePickPosition = safePickPosition;
    }
})();
