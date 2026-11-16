/**
 * TilePositioning
 * Geodesic East-North-Up (ENU) 3D Tileset positioning, rotation, tilt, scaling,
 * transform reset, and 4x4 matrix JSON export.
 *
 * Uses local ENU tangent frame centered on each tileset's bounding sphere so that
 * North/South/East/West/Up/Down movements and Heading/Pitch/Roll rotations act along
 * true geographic axes anywhere on the WGS84 ellipsoid without discarding prior
 * translations, rotations, or root transforms.
 */

class TilePositioning {
    constructor() {
        this.tilesetViewer = null;
        /** @type {Map<string, { eastM:number, northM:number, upM:number, headingDeg:number, pitchDeg:number, rollDeg:number, scale:number, baseModelMatrix:any, anchorCartesian:any }>} */
        this._states = new Map();
        this.init();
    }

    /**
     * Pure WGS84 geodesic ENU -> ECEF delta vector (meters).
     * Works identically with or without a live Cesium WebGL scene.
     */
    static computeEnuDeltaEcef(lonDeg, latDeg, eastM = 0, northM = 0, upM = 0) {
        const deg2rad = Math.PI / 180;
        const lon = Number(lonDeg) * deg2rad;
        const lat = Number(latDeg) * deg2rad;
        const sinLon = Math.sin(lon);
        const cosLon = Math.cos(lon);
        const sinLat = Math.sin(lat);
        const cosLat = Math.cos(lat);

        const e = Number(eastM) || 0;
        const n = Number(northM) || 0;
        const u = Number(upM) || 0;

        // ENU basis vectors in ECEF:
        // East  = [-sinLon,           cosLon,          0     ]
        // North = [-sinLat * cosLon, -sinLat * sinLon, cosLat]
        // Up    = [ cosLat * cosLon,  cosLat * sinLon, sinLat]
        return {
            x: -sinLon * e - sinLat * cosLon * n + cosLat * cosLon * u,
            y: cosLon * e - sinLat * sinLon * n + cosLat * sinLon * u,
            z: cosLat * n + sinLat * u,
        };
    }

    init() {
        this.tilesetViewer = typeof window !== 'undefined' ? window.tilesetViewer : null;
    }

    _getViewer() {
        if (!this.tilesetViewer && typeof window !== 'undefined') {
            this.tilesetViewer = window.tilesetViewer;
        }
        return this.tilesetViewer;
    }

    _getTilesetEntry(id) {
        const tv = this._getViewer();
        if (!tv || !tv.tilesets) return null;
        return tv.tilesets.get(id) || null;
    }

    _ensureState(id, tileset) {
        let state = this._states.get(id);
        if (state) return state;

        let baseModelMatrix = null;
        let anchorCartesian = null;
        if (typeof Cesium !== 'undefined') {
            baseModelMatrix = tileset.modelMatrix
                ? Cesium.Matrix4.clone(tileset.modelMatrix, new Cesium.Matrix4())
                : Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY, new Cesium.Matrix4());

            if (tileset.boundingSphere?.center) {
                anchorCartesian = Cesium.Cartesian3.clone(
                    tileset.boundingSphere.center,
                    new Cesium.Cartesian3()
                );
            } else if (tileset.root?.transform) {
                anchorCartesian = Cesium.Matrix4.getTranslation(
                    tileset.root.transform,
                    new Cesium.Cartesian3()
                );
            } else {
                anchorCartesian = Cesium.Cartesian3.fromDegrees(0, 0, 0);
            }
        }

        state = {
            eastM: 0,
            northM: 0,
            upM: 0,
            headingDeg: 0,
            pitchDeg: 0,
            rollDeg: 0,
            scale: 1,
            baseModelMatrix,
            anchorCartesian,
        };
        this._states.set(id, state);
        return state;
    }

    /**
     * Rebuild and apply `tileset.modelMatrix` from the accumulated ENU state:
     *   M = enuToFixed(anchor) * T(east,north,up) * R(h,p,r) * S(scale) * fixedToEnu(anchor) * baseModelMatrix
     */
    _applyState(id, tileset, state) {
        if (typeof Cesium === 'undefined' || !tileset) return false;

        const anchor = state.anchorCartesian || tileset.boundingSphere?.center;
        if (!anchor || Cesium.Cartesian3.magnitudeSquared(anchor) < 1e-6) {
            return false;
        }

        const enuToFixed = Cesium.Transforms.eastNorthUpToFixedFrame(anchor);
        const fixedToEnu = Cesium.Matrix4.inverseTransformation(enuToFixed, new Cesium.Matrix4());

        const hpr = new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(state.headingDeg || 0),
            Cesium.Math.toRadians(state.pitchDeg || 0),
            Cesium.Math.toRadians(state.rollDeg || 0)
        );
        const rotMat3 = Cesium.Matrix3.fromHeadingPitchRoll(hpr, new Cesium.Matrix3());
        const scaleVal = Math.max(0.01, Math.min(100, Number(state.scale) || 1));
        const localTrs = Cesium.Matrix4.fromRotationTranslation(
            rotMat3,
            new Cesium.Cartesian3(state.eastM || 0, state.northM || 0, state.upM || 0),
            new Cesium.Matrix4()
        );
        if (Math.abs(scaleVal - 1) > 1e-9) {
            Cesium.Matrix4.multiplyByUniformScale(localTrs, scaleVal, localTrs);
        }

        const worldDelta = Cesium.Matrix4.multiply(enuToFixed, localTrs, new Cesium.Matrix4());
        Cesium.Matrix4.multiply(worldDelta, fixedToEnu, worldDelta);

        const base = state.baseModelMatrix || Cesium.Matrix4.IDENTITY;
        tileset.modelMatrix = Cesium.Matrix4.multiply(worldDelta, base, new Cesium.Matrix4());

        this._getViewer()?.viewer?.scene?.requestRender?.();
        if (typeof window !== 'undefined') {
            window.dispatchEvent(
                new CustomEvent('tilesetTransformChanged', {
                    detail: { id, state: this.getTransformState(id) },
                })
            );
        }
        return true;
    }

    /**
     * Rotate tileset around local Up (heading) axis.
     */
    rotateTileset(id, direction, degrees = 1) {
        const entry = this._getTilesetEntry(id);
        if (!entry?.tileset) return false;
        const deg = Number(degrees);
        if (!Number.isFinite(deg)) return false;

        const state = this._ensureState(id, entry.tileset);
        const delta = direction === 'left' ? -deg : deg;
        state.headingDeg = ((state.headingDeg + delta) % 360 + 360) % 360;
        return this._applyState(id, entry.tileset, state);
    }

    /**
     * Tilt tileset around local pitch axis.
     */
    tiltTileset(id, direction, degrees = 1) {
        const entry = this._getTilesetEntry(id);
        if (!entry?.tileset) return false;
        const deg = Number(degrees);
        if (!Number.isFinite(deg)) return false;

        const state = this._ensureState(id, entry.tileset);
        const delta = direction === 'up' ? deg : -deg;
        state.pitchDeg = Math.max(-90, Math.min(90, state.pitchDeg + delta));
        return this._applyState(id, entry.tileset, state);
    }

    /**
     * Move tileset along local geographic East-North-Up axes (distance in meters).
     */
    moveTileset(id, direction, distance = 1) {
        const entry = this._getTilesetEntry(id);
        if (!entry?.tileset) return false;
        const dist = Number(distance);
        if (!Number.isFinite(dist)) return false;

        const state = this._ensureState(id, entry.tileset);
        switch (String(direction || '').toLowerCase()) {
            case 'north':
                state.northM += dist;
                break;
            case 'south':
                state.northM -= dist;
                break;
            case 'east':
                state.eastM += dist;
                break;
            case 'west':
                state.eastM -= dist;
                break;
            case 'up':
                state.upM += dist;
                break;
            case 'down':
                state.upM -= dist;
                break;
            default:
                return false;
        }
        return this._applyState(id, entry.tileset, state);
    }

    /**
     * Apply uniform scale factor to a tileset (0.01 – 100).
     */
    scaleTileset(id, scale = 1) {
        const entry = this._getTilesetEntry(id);
        if (!entry?.tileset) return false;
        const s = Number(scale);
        if (!Number.isFinite(s) || s <= 0) return false;

        const state = this._ensureState(id, entry.tileset);
        state.scale = Math.max(0.01, Math.min(100, s));
        return this._applyState(id, entry.tileset, state);
    }

    /**
     * Set explicit transform parameters on a tileset.
     */
    setTransform(id, spec = {}) {
        const entry = this._getTilesetEntry(id);
        if (!entry?.tileset || !spec || typeof spec !== 'object') return false;
        const state = this._ensureState(id, entry.tileset);
        for (const key of ['eastM', 'northM', 'upM', 'headingDeg', 'pitchDeg', 'rollDeg', 'scale']) {
            if (spec[key] !== undefined && Number.isFinite(Number(spec[key]))) {
                state[key] = Number(spec[key]);
            }
        }
        state.scale = Math.max(0.01, Math.min(100, state.scale || 1));
        return this._applyState(id, entry.tileset, state);
    }

    /**
     * Reset a tileset to its original unmodified survey coordinates & orientation.
     */
    resetTileset(id) {
        const entry = this._getTilesetEntry(id);
        if (!entry?.tileset) return false;
        const state = this._states.get(id);
        if (!state) return true;

        state.eastM = 0;
        state.northM = 0;
        state.upM = 0;
        state.headingDeg = 0;
        state.pitchDeg = 0;
        state.rollDeg = 0;
        state.scale = 1;

        if (typeof Cesium !== 'undefined' && state.baseModelMatrix) {
            entry.tileset.modelMatrix = Cesium.Matrix4.clone(
                state.baseModelMatrix,
                new Cesium.Matrix4()
            );
        }
        this._getViewer()?.viewer?.scene?.requestRender?.();
        if (typeof window !== 'undefined') {
            window.dispatchEvent(
                new CustomEvent('tilesetTransformChanged', {
                    detail: { id, state: this.getTransformState(id) },
                })
            );
        }
        return true;
    }

    getTransformState(id) {
        const s = this._states.get(id);
        if (!s) {
            return {
                eastM: 0,
                northM: 0,
                upM: 0,
                headingDeg: 0,
                pitchDeg: 0,
                rollDeg: 0,
                scale: 1,
            };
        }
        return {
            eastM: Number(s.eastM.toFixed(4)),
            northM: Number(s.northM.toFixed(4)),
            upM: Number(s.upM.toFixed(4)),
            headingDeg: Number(s.headingDeg.toFixed(3)),
            pitchDeg: Number(s.pitchDeg.toFixed(3)),
            rollDeg: Number(s.rollDeg.toFixed(3)),
            scale: Number(s.scale.toFixed(4)),
        };
    }

    /**
     * Export current 4x4 column-major transform array + human-readable ENU offsets as JSON.
     */
    exportTransformJson(id) {
        const entry = this._getTilesetEntry(id);
        if (!entry?.tileset) return null;
        let matrix = null;
        if (typeof Cesium !== 'undefined' && entry.tileset.modelMatrix) {
            matrix = Cesium.Matrix4.toArray(entry.tileset.modelMatrix).map((n) =>
                Number(n.toFixed(8))
            );
        }
        return {
            tilesetId: id,
            name: entry.name || id,
            enuOffset: this.getTransformState(id),
            modelMatrix: matrix,
            exportedAt: new Date().toISOString(),
        };
    }

    /**
     * Legacy helper preserved for backward compatibility.
     */
    getDirectionOffset(direction, distance) {
        const d = Number(distance) || 0;
        const table = {
            north: [0, d, 0],
            south: [0, -d, 0],
            east: [d, 0, 0],
            west: [-d, 0, 0],
            up: [0, 0, d],
            down: [0, 0, -d],
        };
        const [x, y, z] = table[direction] || [0, 0, 0];
        return typeof Cesium !== 'undefined' ? new Cesium.Cartesian3(x, y, z) : { x, y, z };
    }

    rotateAllTilesets(direction, degrees) {
        const tv = this._getViewer();
        if (!tv) return false;
        tv.getAllTilesets().forEach((t) => this.rotateTileset(t.id, direction, degrees));
        return true;
    }

    tiltAllTilesets(direction, degrees) {
        const tv = this._getViewer();
        if (!tv) return false;
        tv.getAllTilesets().forEach((t) => this.tiltTileset(t.id, direction, degrees));
        return true;
    }

    moveAllTilesets(direction, distance) {
        const tv = this._getViewer();
        if (!tv) return false;
        tv.getAllTilesets().forEach((t) => this.moveTileset(t.id, direction, distance));
        return true;
    }

    resetAllTilesets() {
        const tv = this._getViewer();
        if (!tv) return false;
        tv.getAllTilesets().forEach((t) => this.resetTileset(t.id));
        return true;
    }
}

if (typeof window !== 'undefined') {
    window.TilePositioning = TilePositioning;
    window.tilePositioning = new TilePositioning();
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TilePositioning };
}
