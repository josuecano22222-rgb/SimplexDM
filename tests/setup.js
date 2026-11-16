/**
 * Jest global setup (`tests/setup.js`)
 * Provides Web API polyfills and a lightweight WGS84-accurate Cesium math stub
 * for unit tests running under jsdom without a WebGL GPU context.
 */
'use strict';

const { TextEncoder, TextDecoder } = require('util');

if (typeof globalThis.TextEncoder === 'undefined') {
    globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
    globalThis.TextDecoder = TextDecoder;
}

if (typeof globalThis.URL !== 'undefined') {
    if (typeof globalThis.URL.createObjectURL !== 'function') {
        globalThis.URL.createObjectURL = () => 'blob:jest-mock-url';
    }
    if (typeof globalThis.URL.revokeObjectURL !== 'function') {
        globalThis.URL.revokeObjectURL = () => {};
    }
}

// WGS84 ellipsoid constants for accurate ECEF <-> Geodetic tests
const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

class Cartesian3 {
    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
    static clone(c, result = new Cartesian3()) {
        if (!c) return undefined;
        result.x = c.x;
        result.y = c.y;
        result.z = c.z;
        return result;
    }
    static distance(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    }
    static subtract(a, b, result = new Cartesian3()) {
        result.x = a.x - b.x;
        result.y = a.y - b.y;
        result.z = a.z - b.z;
        return result;
    }
    static dot(a, b) {
        return a.x * b.x + a.y * b.y + a.z * b.z;
    }
    static magnitude(a) {
        return Math.hypot(a.x, a.y, a.z);
    }
    static normalize(a, result = new Cartesian3()) {
        const m = Cartesian3.magnitude(a) || 1;
        result.x = a.x / m;
        result.y = a.y / m;
        result.z = a.z / m;
        return result;
    }
    static fromDegrees(lonDeg, latDeg, height = 0) {
        const lon = (lonDeg * Math.PI) / 180;
        const lat = (latDeg * Math.PI) / 180;
        const sinLat = Math.sin(lat);
        const cosLat = Math.cos(lat);
        const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
        return new Cartesian3(
            (N + height) * cosLat * Math.cos(lon),
            (N + height) * cosLat * Math.sin(lon),
            (N * (1 - WGS84_E2) + height) * sinLat
        );
    }
}

class Cartesian2 {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }
}

class Cartographic {
    constructor(longitude = 0, latitude = 0, height = 0) {
        this.longitude = longitude;
        this.latitude = latitude;
        this.height = height;
    }
    static fromCartesian(c) {
        if (!c) return undefined;
        const { x, y, z } = c;
        const p = Math.hypot(x, y);
        if (p === 0 && z === 0) return undefined;
        const lon = Math.atan2(y, x);
        let lat = Math.atan2(z, p * (1 - WGS84_E2));
        let h = 0;
        for (let i = 0; i < 6; i++) {
            const sinLat = Math.sin(lat);
            const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
            h = p / Math.max(Math.cos(lat), 1e-12) - N;
            lat = Math.atan2(z, p * (1 - (WGS84_E2 * N) / (N + h)));
        }
        return new Cartographic(lon, lat, h);
    }
}

class NearFarScalar {
    constructor(near, nearValue, far, farValue) {
        this.near = near;
        this.nearValue = nearValue;
        this.far = far;
        this.farValue = farValue;
    }
}

class DistanceDisplayCondition {
    constructor(near, far) {
        this.near = near;
        this.far = far;
    }
}

class Color {
    constructor(r = 1, g = 1, b = 1, a = 1) {
        this.red = r;
        this.green = g;
        this.blue = b;
        this.alpha = a;
    }
    withAlpha(a) {
        return new Color(this.red, this.green, this.blue, a);
    }
    static fromCssColorString() {
        return new Color(1, 1, 1, 1);
    }
}
Color.WHITE = new Color(1, 1, 1, 1);
Color.BLACK = new Color(0, 0, 0, 1);
Color.TRANSPARENT = new Color(0, 0, 0, 0);

if (typeof globalThis.Cesium === 'undefined') {
    globalThis.Cesium = {
        Cartesian3,
        Cartesian2,
        Cartographic,
        NearFarScalar,
        DistanceDisplayCondition,
        Color,
        LabelStyle: { FILL: 0, OUTLINE: 1, FILL_AND_OUTLINE: 2 },
        HorizontalOrigin: { CENTER: 0, LEFT: 1, RIGHT: -1 },
        VerticalOrigin: { CENTER: 0, BOTTOM: 1, TOP: -1 },
        CameraEventType: { LEFT_DRAG: 0, RIGHT_DRAG: 1, MIDDLE_DRAG: 2, WHEEL: 3, PINCH: 4 },
        Intersect: { OUTSIDE: -1, INTERSECTING: 0, INSIDE: 1 },
        RequestScheduler: { maximumRequestsPerServer: 18 },
        Event: class {
            constructor() {
                this._listeners = new Set();
            }
            addEventListener(fn) {
                this._listeners.add(fn);
                return () => this._listeners.delete(fn);
            }
            removeEventListener(fn) {
                this._listeners.delete(fn);
            }
            raiseEvent(...args) {
                this._listeners.forEach((fn) => fn(...args));
            }
        },
        Credit: class {
            constructor(text) {
                this.text = text;
            }
        },
        WebMercatorTilingScheme: class {
            constructor() {
                this.rectangle = { west: -Math.PI, south: -1.4844, east: Math.PI, north: 1.4844 };
            }
        },
        Matrix4: {
            fromArray(arr) {
                return Array.from(arr);
            },
            multiplyByPoint(m, pt, result = new Cartesian3()) {
                result.x = m[0] * pt.x + m[4] * pt.y + m[8] * pt.z + m[12];
                result.y = m[1] * pt.x + m[5] * pt.y + m[9] * pt.z + m[13];
                result.z = m[2] * pt.x + m[6] * pt.y + m[10] * pt.z + m[14];
                return result;
            },
        },
        Math: {
            toDegrees: (rad) => (rad * 180) / Math.PI,
            toRadians: (deg) => (deg * Math.PI) / 180,
        },
        SceneTransforms: {
            worldToWindowCoordinates: (scene, cart3) => {
                if (typeof scene?._project === 'function') return scene._project(cart3);
                return new Cartesian2(400, 300);
            },
        },
        LabelCollection: class {
            constructor() {
                this._items = [];
                this._destroyed = false;
            }
            add(spec) {
                this._items.push(spec);
                return spec;
            }
            removeAll() {
                this._items = [];
            }
            isDestroyed() {
                return this._destroyed;
            }
            destroy() {
                this._destroyed = true;
                this._items = [];
            }
        },
    };
    if (typeof window !== 'undefined') {
        window.Cesium = globalThis.Cesium;
    }
}
