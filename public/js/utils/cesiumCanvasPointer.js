/**
 * Maps DOM pointer coordinates to Cesium canvas pixel space for pickEllipsoid / pickPosition / scene.pick.
 * Handles border insets and CSS scaling when the layout box (getBoundingClientRect) differs from clientWidth/Height.
 */
(function () {
    if (typeof Cesium === 'undefined') return;

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {number} clientX
     * @param {number} clientY
     * @returns {Cesium.Cartesian2|null}
     */
    function cesiumPointerToCanvasPixels(canvas, clientX, clientY) {
        if (!canvas || !(canvas instanceof HTMLCanvasElement)) return null;
        const rect = canvas.getBoundingClientRect();
        const cw = canvas.clientWidth;
        const ch = canvas.clientHeight;
        if (cw <= 0 || ch <= 0 || rect.width <= 0 || rect.height <= 0) return null;

        const scaleX = cw / rect.width;
        const scaleY = ch / rect.height;
        const x = (clientX - rect.left - canvas.clientLeft) * scaleX;
        const y = (clientY - rect.top - canvas.clientTop) * scaleY;

        return new Cesium.Cartesian2(x, y);
    }

    window.cesiumPointerToCanvasPixels = cesiumPointerToCanvasPixels;

    /**
     * World-space Cartesian (WGS84 ellipsoid) → window pixels.
     * Ion SDK / newer Cesium use SceneTransforms.worldToWindowCoordinates; older builds used wgs84ToWindowCoordinates.
     */
    function cesiumWorldToWindowCoordinates(scene, cartesian) {
        if (!scene || !cartesian) return undefined;
        const ST = Cesium.SceneTransforms;
        if (!ST) return undefined;
        if (typeof ST.worldToWindowCoordinates === 'function') {
            return ST.worldToWindowCoordinates(scene, cartesian);
        }
        if (typeof ST.wgs84ToWindowCoordinates === 'function') {
            return ST.wgs84ToWindowCoordinates(scene, cartesian);
        }
        return undefined;
    }

    window.cesiumWorldToWindowCoordinates = cesiumWorldToWindowCoordinates;
})();
