/**
 * Viewport descriptor from Cesium camera (for main-process label query).
 */
(function (global) {
    'use strict';

    const ZOOM_HEIGHT_TABLE = [
        [0, 20000000],
        [1, 10000000],
        [2, 5000000],
        [3, 2500000],
        [4, 1200000],
        [5, 600000],
        [6, 300000],
        [7, 150000],
        [8, 75000],
        [9, 37500],
        [10, 18750],
        [11, 9375],
        [12, 4688],
        [13, 2344],
        [14, 1172],
        [15, 586],
        [16, 293],
        [17, 146],
        [18, 0],
    ];

    class LabelQueryService {
        /**
         * @param {Cesium.Viewer} viewer
         * @returns {{ west: number, east: number, south: number, north: number, zoom: number }|null}
         */
        getViewport(viewer) {
            if (!viewer || !viewer.camera || !viewer.scene || !viewer.scene.globe) return null;
            const rect = viewer.camera.computeViewRectangle(
                viewer.scene.globe.ellipsoid,
                new Cesium.Rectangle()
            );
            if (!rect) return null;

            const height = viewer.camera.positionCartographic.height;

            return {
                west: Cesium.Math.toDegrees(rect.west),
                east: Cesium.Math.toDegrees(rect.east),
                south: Cesium.Math.toDegrees(rect.south),
                north: Cesium.Math.toDegrees(rect.north),
                zoom: this.heightToZoom(height),
            };
        }

        /**
         * @param {number} heightMeters
         * @returns {number}
         */
        heightToZoom(heightMeters) {
            for (let i = 0; i < ZOOM_HEIGHT_TABLE.length; i++) {
                const z = ZOOM_HEIGHT_TABLE[i][0];
                const minHeight = ZOOM_HEIGHT_TABLE[i][1];
                if (heightMeters >= minHeight) return z;
            }
            return 18;
        }
    }

    global.labelQueryService = new LabelQueryService();
})(typeof window !== 'undefined' ? window : this);
