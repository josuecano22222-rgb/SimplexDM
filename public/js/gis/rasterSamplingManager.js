/**
 * RasterSamplingManager
 * Stage-1 raster sampling for GeoTIFF/COG sidecar files.
 */
class RasterSamplingManager {
    constructor() {
        this.viewer = null;
        this.activeRasterPath = null;
    }

    init(viewer) {
        this.viewer = viewer;
        this._wireClick();
    }

    setActiveRaster(rasterPath) {
        this.activeRasterPath = rasterPath;
        window.notification?.info(`Active raster sampler: ${rasterPath}`);
    }

    _wireClick() {
        if (!this.viewer) return;
        const canvas = this.viewer.scene.canvas;
        canvas.addEventListener('dblclick', async (e) => {
            if (!this.activeRasterPath) return;
            const pos =
                typeof window.cesiumPointerToCanvasPixels === 'function'
                    ? window.cesiumPointerToCanvasPixels(canvas, e.clientX, e.clientY)
                    : new Cesium.Cartesian2(
                          e.clientX - canvas.getBoundingClientRect().left,
                          e.clientY - canvas.getBoundingClientRect().top
                      );
            if (!pos) return;
            const cartesian = this.viewer.scene.pickPosition(pos) ||
                this.viewer.camera.pickEllipsoid(pos, this.viewer.scene.globe.ellipsoid);
            if (!cartesian) return;
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            const lon = Cesium.Math.toDegrees(carto.longitude);
            const lat = Cesium.Math.toDegrees(carto.latitude);
            try {
                const res = await window.electronAPI.gis.raster.sample(this.activeRasterPath, [lon, lat]);
                window.notification?.info(`Raster value: ${res.value}`);
            } catch (err) {
                window.errorHandler?.handle(err, { component: 'RasterSamplingManager', action: 'sample' }, true);
            }
        }, true);
    }
}

if (typeof window !== 'undefined') {
    window.rasterSamplingManager = window.rasterSamplingManager || new RasterSamplingManager();
}

