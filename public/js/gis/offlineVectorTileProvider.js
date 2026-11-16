/**
 * Offline Mapbox Vector Tile (`.pbf` / `.mvt`) Decoder & CesiumJS ImageryProvider
 * (`public/js/gis/offlineVectorTileProvider.js`)
 *
 * Implements the Mapbox Vector Tile v2.1 binary protobuf specification without external
 * dependencies, rasterizing offline vector tiles (`data/tiles/vector/{z}/{x}/{y}.pbf`)
 * onto 256×256 HTML5 Canvas tiles for CesiumJS `ImageryLayer` consumption.
 */
(function (root) {
    'use strict';

    const DEFAULT_STYLE = Object.freeze({
        background: '#1c2430',
        water: '#1e3a5f',
        waterway: '#2563eb',
        landcover: '#1f3328',
        landuse: '#242d3a',
        park: '#1e3a2f',
        building: '#334155',
        buildingStroke: '#475569',
        boundary: '#94a3b8',
        transportation: '#cbd5e1',
        motorway: '#f59e0b',
        defaultFill: 'rgba(100,116,139,0.35)',
        defaultStroke: 'rgba(148,163,184,0.65)',
    });

    class ProtoReader {
        constructor(bytes, start = 0, end = bytes.byteLength) {
            this.bytes = bytes;
            this.pos = start;
            this.end = end;
        }

        readVarint() {
            let result = 0;
            let shift = 0;
            while (this.pos < this.end) {
                const b = this.bytes[this.pos++];
                result += (b & 0x7f) * Math.pow(2, shift);
                if ((b & 0x80) === 0) return result;
                shift += 7;
                if (shift > 53) throw new Error('MVT varint overflow');
            }
            throw new Error('Unexpected EOF reading MVT varint');
        }

        readSVarint() {
            const n = this.readVarint();
            return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
        }

        readBytes() {
            const len = this.readVarint();
            const start = this.pos;
            const finish = start + len;
            if (finish > this.end) throw new Error('MVT length-delimited field exceeds bounds');
            this.pos = finish;
            return { start, end: finish };
        }

        readString() {
            const { start, end } = this.readBytes();
            const sub = this.bytes.subarray(start, end);
            if (typeof TextDecoder !== 'undefined') {
                return new TextDecoder('utf-8').decode(sub);
            }
            let s = '';
            for (let i = 0; i < sub.length; i++) s += String.fromCharCode(sub[i]);
            return s;
        }

        readPackedUint32() {
            const { start, end } = this.readBytes();
            const sub = new ProtoReader(this.bytes, start, end);
            const out = [];
            while (sub.pos < sub.end) out.push(sub.readVarint());
            return out;
        }

        skip(wireType) {
            switch (wireType) {
                case 0:
                    this.readVarint();
                    break;
                case 1:
                    this.pos = Math.min(this.end, this.pos + 8);
                    break;
                case 2:
                    this.readBytes();
                    break;
                case 5:
                    this.pos = Math.min(this.end, this.pos + 4);
                    break;
                default:
                    throw new Error(`Unsupported MVT wire type: ${wireType}`);
            }
        }
    }

    function decodeGeometryCommands(cmds) {
        const rings = [];
        let cur = null;
        let x = 0;
        let y = 0;
        let i = 0;
        while (i < cmds.length) {
            const cmdInt = cmds[i++];
            const cmdId = cmdInt & 0x7;
            const count = cmdInt >>> 3;
            if (cmdId === 1) {
                // MoveTo
                for (let c = 0; c < count && i + 1 < cmds.length; c++) {
                    const dx = (cmds[i] >>> 1) ^ -(cmds[i] & 1);
                    const dy = (cmds[i + 1] >>> 1) ^ -(cmds[i + 1] & 1);
                    i += 2;
                    x += dx;
                    y += dy;
                    cur = [[x, y]];
                    rings.push(cur);
                }
            } else if (cmdId === 2) {
                // LineTo
                for (let c = 0; c < count && i + 1 < cmds.length; c++) {
                    const dx = (cmds[i] >>> 1) ^ -(cmds[i] & 1);
                    const dy = (cmds[i + 1] >>> 1) ^ -(cmds[i + 1] & 1);
                    i += 2;
                    x += dx;
                    y += dy;
                    if (cur) cur.push([x, y]);
                }
            } else if (cmdId === 7) {
                // ClosePath
                if (cur && cur.length > 0) {
                    cur.push([cur[0][0], cur[0][1]]);
                }
            }
        }
        return rings;
    }

    function decodeValue(bytes, start, end) {
        const r = new ProtoReader(bytes, start, end);
        let value = null;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        while (r.pos < r.end) {
            const tag = r.readVarint();
            const field = tag >>> 3;
            const wire = tag & 0x7;
            switch (field) {
                case 1:
                    value = r.readString();
                    break;
                case 2:
                    value = view.getFloat32(r.pos, true);
                    r.pos += 4;
                    break;
                case 3:
                    value = view.getFloat64(r.pos, true);
                    r.pos += 8;
                    break;
                case 4:
                case 5:
                    value = r.readVarint();
                    break;
                case 6:
                    value = r.readSVarint();
                    break;
                case 7:
                    value = r.readVarint() !== 0;
                    break;
                default:
                    r.skip(wire);
            }
        }
        return value;
    }

    function decodeFeature(bytes, start, end, keys, values) {
        const r = new ProtoReader(bytes, start, end);
        let id = null;
        let type = 0; // 1=POINT, 2=LINESTRING, 3=POLYGON
        let tags = [];
        let geomCmds = [];

        while (r.pos < r.end) {
            const tag = r.readVarint();
            const field = tag >>> 3;
            const wire = tag & 0x7;
            if (field === 1 && wire === 0) id = r.readVarint();
            else if (field === 2 && wire === 2) tags = r.readPackedUint32();
            else if (field === 3 && wire === 0) type = r.readVarint();
            else if (field === 4 && wire === 2) geomCmds = r.readPackedUint32();
            else r.skip(wire);
        }

        const properties = {};
        for (let i = 0; i + 1 < tags.length; i += 2) {
            const k = keys[tags[i]];
            if (k !== undefined) properties[k] = values[tags[i + 1]];
        }

        return {
            id,
            type,
            properties,
            geometry: decodeGeometryCommands(geomCmds),
        };
    }

    function decodeLayer(bytes, start, end) {
        const r = new ProtoReader(bytes, start, end);
        let name = '';
        let extent = 4096;
        let version = 2;
        const rawFeatures = [];
        const keys = [];
        const values = [];

        while (r.pos < r.end) {
            const tag = r.readVarint();
            const field = tag >>> 3;
            const wire = tag & 0x7;
            if (field === 1 && wire === 2) name = r.readString();
            else if (field === 2 && wire === 2) rawFeatures.push(r.readBytes());
            else if (field === 3 && wire === 2) keys.push(r.readString());
            else if (field === 4 && wire === 2) {
                const span = r.readBytes();
                values.push(decodeValue(bytes, span.start, span.end));
            } else if (field === 5 && wire === 0) extent = r.readVarint() || 4096;
            else if (field === 15 && wire === 0) version = r.readVarint();
            else r.skip(wire);
        }

        const features = rawFeatures.map((span) => decodeFeature(bytes, span.start, span.end, keys, values));
        return { name, version, extent, features };
    }

    /**
     * Decode a Mapbox Vector Tile binary buffer (`.pbf` / `.mvt`) into `{ layers }`.
     * @param {ArrayBuffer|Uint8Array} buffer
     */
    function decodeMvt(buffer) {
        const bytes = buffer instanceof Uint8Array
            ? buffer
            : buffer instanceof ArrayBuffer
              ? new Uint8Array(buffer)
              : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

        const reader = new ProtoReader(bytes, 0, bytes.byteLength);
        const layers = [];
        while (reader.pos < reader.end) {
            const tag = reader.readVarint();
            const field = tag >>> 3;
            const wire = tag & 0x7;
            if (field === 3 && wire === 2) {
                const span = reader.readBytes();
                layers.push(decodeLayer(bytes, span.start, span.end));
            } else {
                reader.skip(wire);
            }
        }
        return { layers };
    }

    /**
     * Render a decoded MVT object onto a 2D canvas (default 256×256).
     */
    function renderMvtToCanvas(decoded, tileSize = 256, style = DEFAULT_STYLE, canvasOverride = null) {
        const canvas = canvasOverride || document.createElement('canvas');
        canvas.width = tileSize;
        canvas.height = tileSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;

        if (style.background) {
            ctx.fillStyle = style.background;
            ctx.fillRect(0, 0, tileSize, tileSize);
        }

        for (const layer of decoded?.layers || []) {
            const scale = tileSize / (layer.extent || 4096);
            const lname = String(layer.name || '').toLowerCase();

            for (const feat of layer.features || []) {
                if (feat.type === 3) {
                    // Polygon
                    ctx.fillStyle =
                        lname.includes('water')
                            ? style.water
                            : lname.includes('park') || lname.includes('green')
                              ? style.park
                              : lname.includes('landcover')
                                ? style.landcover
                                : lname.includes('landuse')
                                  ? style.landuse
                                  : lname.includes('building')
                                    ? style.building
                                    : style.defaultFill;
                    ctx.beginPath();
                    for (const ring of feat.geometry) {
                        if (!ring.length) continue;
                        ctx.moveTo(ring[0][0] * scale, ring[0][1] * scale);
                        for (let p = 1; p < ring.length; p++) {
                            ctx.lineTo(ring[p][0] * scale, ring[p][1] * scale);
                        }
                        ctx.closePath();
                    }
                    ctx.fill('evenodd');
                    if (lname.includes('building')) {
                        ctx.strokeStyle = style.buildingStroke;
                        ctx.lineWidth = 0.6;
                        ctx.stroke();
                    }
                } else if (feat.type === 2) {
                    // LineString
                    const cls = String(feat.properties?.class || '').toLowerCase();
                    const isMotorway = cls === 'motorway' || cls === 'trunk';
                    ctx.strokeStyle = lname.includes('water')
                        ? style.waterway
                        : lname.includes('bound')
                          ? style.boundary
                          : isMotorway
                            ? style.motorway
                            : lname.includes('road') || lname.includes('transport')
                              ? style.transportation
                              : style.defaultStroke;
                    ctx.lineWidth = isMotorway ? 1.8 : 1.0;
                    ctx.beginPath();
                    for (const line of feat.geometry) {
                        if (line.length < 2) continue;
                        ctx.moveTo(line[0][0] * scale, line[0][1] * scale);
                        for (let p = 1; p < line.length; p++) {
                            ctx.lineTo(line[p][0] * scale, line[p][1] * scale);
                        }
                    }
                    ctx.stroke();
                }
            }
        }

        return canvas;
    }

    /**
     * CesiumJS-compatible `ImageryProvider` backed by offline `.pbf` / `.mvt` vector tiles.
     */
    class OfflineVectorTileImageryProvider {
        constructor(options = {}) {
            const C = root.Cesium;
            this.urlTemplate = options.url || '/data/tiles/vector/{z}/{x}/{y}.pbf';
            this.tileWidth = options.tileWidth || 256;
            this.tileHeight = options.tileHeight || 256;
            this.minimumLevel = Number.isInteger(options.minimumLevel) ? options.minimumLevel : 0;
            this.maximumLevel = Number.isInteger(options.maximumLevel) ? options.maximumLevel : 14;
            this.style = { ...DEFAULT_STYLE, ...(options.style || {}) };
            this.tilingScheme = C ? new C.WebMercatorTilingScheme() : null;
            this.rectangle = this.tilingScheme ? this.tilingScheme.rectangle : null;
            this.credit = C && options.credit ? new C.Credit(options.credit) : undefined;
            this.errorEvent = C ? new C.Event() : { addEventListener() {}, raiseEvent() {} };
            this.hasAlphaChannel = true;
            this.ready = true;
            this.readyPromise = Promise.resolve(true);
        }

        getTileCredits() {
            return undefined;
        }

        pickFeatures() {
            return undefined;
        }

        async requestImage(x, y, level) {
            const url = this.urlTemplate
                .replace('{z}', String(level))
                .replace('{x}', String(x))
                .replace('{y}', String(y));
            const resp = await fetch(url);
            if (!resp.ok) {
                const err = new Error(`Vector tile HTTP ${resp.status}: ${url}`);
                this.errorEvent?.raiseEvent?.(err);
                throw err;
            }
            let buf = await resp.arrayBuffer();
            const u8 = new Uint8Array(buf);
            // Transparently gunzip gzip-compressed `.pbf` tiles when DecompressionStream is available
            if (u8.byteLength >= 2 && u8[0] === 0x1f && u8[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
                const ds = new DecompressionStream('gzip');
                const decompressed = new Response(new Blob([u8]).stream().pipeThrough(ds));
                buf = await decompressed.arrayBuffer();
            }
            const decoded = decodeMvt(buf);
            return renderMvtToCanvas(decoded, this.tileWidth, this.style);
        }
    }

    if (root && typeof root === 'object') {
        root.OfflineVectorTileImageryProvider = OfflineVectorTileImageryProvider;
        root.offlineVectorTiles = {
            decodeMvt,
            renderMvtToCanvas,
            OfflineVectorTileImageryProvider,
            DEFAULT_STYLE,
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            decodeMvt,
            renderMvtToCanvas,
            OfflineVectorTileImageryProvider,
            DEFAULT_STYLE,
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
