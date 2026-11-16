/**
 * Screen-space overlap culling for label candidates (priority order preserved).
 */
(function (global) {
    'use strict';

    /**
     * @param {Cesium.Scene} scene
     * @param {Cesium.Cartesian3} cartesian
     * @returns {Cesium.Cartesian2|undefined}
     */
    function worldToWindowCoordinates(scene, cartesian) {
        if (typeof global.cesiumWorldToWindowCoordinates === 'function') {
            return global.cesiumWorldToWindowCoordinates(scene, cartesian);
        }
        if (!scene || !cartesian || typeof Cesium === 'undefined') return undefined;
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

    class LabelCollisionEngine {
        /**
         * @param {number} paddingPx
         */
        constructor(paddingPx) {
            this.padding = paddingPx || 5;
        }

        /**
         * @param {Cesium.Viewer} viewer
         * @param {{ lon: number, lat: number, name: string, type: string }[]} labels
         */
        cull(viewer, labels) {
            const scene = viewer.scene;
            const occupied = [];
            const visible = [];
            const p = this.padding;

            for (let i = 0; i < labels.length; i++) {
                const lbl = labels[i];
                const cart3 = Cesium.Cartesian3.fromDegrees(lbl.lon, lbl.lat);
                const cart2 = worldToWindowCoordinates(scene, cart3);
                if (!cart2) continue;

                const tw = this._estimateWidth(lbl.name, lbl.type);
                const th = 16;

                const box = {
                    x1: cart2.x - tw / 2 - p,
                    y1: cart2.y - th - p,
                    x2: cart2.x + tw / 2 + p,
                    y2: cart2.y + p,
                };

                let hit = false;
                for (let j = 0; j < occupied.length; j++) {
                    if (this._overlaps(occupied[j], box)) {
                        hit = true;
                        break;
                    }
                }
                if (!hit) {
                    occupied.push(box);
                    visible.push(lbl);
                }
            }
            return visible;
        }

        /**
         * @param {{ x1: number, y1: number, x2: number, y2: number }} a
         * @param {{ x1: number, y1: number, x2: number, y2: number }} b
         */
        _overlaps(a, b) {
            return !(a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1);
        }

        /**
         * @param {string} text
         * @param {string} type
         */
        _estimateWidth(text, type) {
            const fontSize =
                type === 'country' ? 20 : type === 'state' ? 16 : type === 'city' ? 14 : 11;
            const len = text ? text.length : 0;
            return len * fontSize * 0.6 + 8;
        }
    }

    global.labelCollisionEngine = new LabelCollisionEngine(5);
})(typeof window !== 'undefined' ? window : this);
