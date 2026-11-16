#!/usr/bin/env node
/**
 * generate-sample-tileset.mjs
 *
 * Builds a compact, 100% OGC 3D Tiles spec-compliant sample dataset at
 * `data/samples/meridian-campus/` exercising every format supported by SimplexDM:
 *   - `tileset.json` (Master hierarchical 3D Tiles dataset with LOD + geographic region)
 *   - `north_sector_2025_06_15.json` (Nested regional child tileset — 2025 survey)
 *   - `south_sector_2026_09_20.json` (Nested regional child tileset — 2026 survey)
 *   - `north_buildings.b3dm` (Valid B3DM v1 + embedded GLB 2.0 3D buildings + Batch Table JSON)
 *   - `south_buildings.b3dm` (Valid B3DM v1 + embedded GLB 2.0 3D buildings + Batch Table JSON)
 *   - `campus_lidar.pnts`    (Valid PNTS v1 RGB LiDAR point cloud over campus courtyard)
 *   - `campus_trees.i3dm`    (Valid I3DM v1 instanced 3D street markers + embedded GLB 2.0)
 *   - `campus_composite.cmpt`(Valid CMPT v1 composite tile bundling B3DM + I3DM)
 *
 * Anchored at Meridian Survey Campus, Amsterdam (4.9041°E, 52.3676°N, WGS84).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.resolve(__dirname, '..', 'data', 'samples', 'meridian-campus');

const DEG2RAD = Math.PI / 180;
const WGS84_A = 6378137.0;
const WGS84_E2 = 0.0066943799901413165;

/** Convert WGS84 (lonDeg, latDeg, hMeters) to ECEF [x, y, z]. */
function wgs84ToEcef(lonDeg, latDeg, h = 0) {
    const lon = lonDeg * DEG2RAD;
    const lat = latDeg * DEG2RAD;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);
    const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    return [
        (N + h) * cosLat * cosLon,
        (N + h) * cosLat * sinLon,
        (N * (1 - WGS84_E2) + h) * sinLat,
    ];
}

/**
 * Compute column-major 4x4 local East-North-Up (ENU) -> ECEF transform matrix
 * centered at (lonDeg, latDeg, hMeters).
 * In glTF 2.0 (Y-up), B3DM applies Cesium's Y-up-to-Z-up transform automatically,
 * so glTF vertex (x=East, y=Up, z=-North) maps cleanly to ENU (East, North, Up).
 */
function enuTransformMatrix(lonDeg, latDeg, h = 0) {
    const lon = lonDeg * DEG2RAD;
    const lat = latDeg * DEG2RAD;
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);

    const east = [-sinLon, cosLon, 0];
    const north = [-sinLat * cosLon, -sinLat * sinLon, cosLat];
    const up = [cosLat * cosLon, cosLat * sinLon, sinLat];
    const origin = wgs84ToEcef(lonDeg, latDeg, h);

    // Column-major 4x4
    return [
        east[0], east[1], east[2], 0,
        north[0], north[1], north[2], 0,
        up[0], up[1], up[2], 0,
        origin[0], origin[1], origin[2], 1,
    ];
}

function padBuffer(buf, padByte = 0x20, align = 8) {
    const rem = buf.length % align;
    if (rem === 0) return buf;
    const pad = Buffer.alloc(align - rem, padByte);
    return Buffer.concat([buf, pad]);
}

/**
 * Append a 3D extruded building box (5 visible faces + bottom) in glTF Y-up space:
 * x = east (m), y = height/up (m), z = -north (m).
 */
function pushBoxGeometry(acc, { east, north, width, depth, baseH = 0, height, color, batchId }) {
    const hx = width / 2;
    const hz = depth / 2;
    const x0 = east - hx;
    const x1 = east + hx;
    const y0 = baseH;
    const y1 = baseH + height;
    const z0 = -north - hz;
    const z1 = -north + hz;

    // 6 faces: [normal, 4 corners CCW when viewed from outside]
    const faces = [
        // Roof (+Y) — slightly brighter
        { n: [0, 1, 0], shade: 1.08, v: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]] },
        // South (+Z)
        { n: [0, 0, 1], shade: 0.96, v: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
        // North (-Z)
        { n: [0, 0, -1], shade: 0.80, v: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]] },
        // East (+X)
        { n: [1, 0, 0], shade: 0.90, v: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]] },
        // West (-X)
        { n: [-1, 0, 0], shade: 0.84, v: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
        // Base (-Y)
        { n: [0, -1, 0], shade: 0.65, v: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
    ];

    for (const f of faces) {
        const baseIdx = acc.vertexCount;
        const r = Math.min(1, color[0] * f.shade);
        const g = Math.min(1, color[1] * f.shade);
        const b = Math.min(1, color[2] * f.shade);
        for (const [vx, vy, vz] of f.v) {
            acc.positions.push(vx, vy, vz);
            acc.normals.push(f.n[0], f.n[1], f.n[2]);
            acc.colors.push(r, g, b);
            acc.batchIds.push(batchId);
            acc.min[0] = Math.min(acc.min[0], vx);
            acc.min[1] = Math.min(acc.min[1], vy);
            acc.min[2] = Math.min(acc.min[2], vz);
            acc.max[0] = Math.max(acc.max[0], vx);
            acc.max[1] = Math.max(acc.max[1], vy);
            acc.max[2] = Math.max(acc.max[2], vz);
            acc.vertexCount++;
        }
        acc.indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
    }
}

/** Build a binary glTF 2.0 (GLB) buffer from accumulated building geometry. */
function buildGlb(buildings, includeBatchId = true) {
    const acc = {
        positions: [],
        normals: [],
        colors: [],
        batchIds: [],
        indices: [],
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
        vertexCount: 0,
    };

    buildings.forEach((b, idx) => pushBoxGeometry(acc, { ...b, batchId: idx }));

    const posBuf = Buffer.from(new Float32Array(acc.positions).buffer);
    const normBuf = Buffer.from(new Float32Array(acc.normals).buffer);
    const colBuf = Buffer.from(new Float32Array(acc.colors).buffer);
    const batchBuf = includeBatchId ? Buffer.from(new Float32Array(acc.batchIds).buffer) : Buffer.alloc(0);
    const idxRaw = Buffer.from(new Uint16Array(acc.indices).buffer);
    const idxBuf = padBuffer(idxRaw, 0x00, 4);

    const chunks = [posBuf, normBuf, colBuf];
    if (includeBatchId) chunks.push(batchBuf);
    chunks.push(idxBuf);
    const binBody = padBuffer(Buffer.concat(chunks), 0x00, 4);

    let offset = 0;
    const bufferViews = [];
    const addView = (len, target) => {
        const idx = bufferViews.length;
        const view = { buffer: 0, byteOffset: offset, byteLength: len };
        if (target) view.target = target;
        bufferViews.push(view);
        offset += len;
        return idx;
    };

    const posView = addView(posBuf.length, 34962);
    const normView = addView(normBuf.length, 34962);
    const colView = addView(colBuf.length, 34962);
    const batchView = includeBatchId ? addView(batchBuf.length, 34962) : -1;
    const idxView = addView(idxRaw.length, 34963);
    offset += idxBuf.length - idxRaw.length;

    const accessors = [
        {
            bufferView: posView,
            componentType: 5126,
            count: acc.vertexCount,
            type: 'VEC3',
            min: acc.min.map((n) => Number(n.toFixed(4))),
            max: acc.max.map((n) => Number(n.toFixed(4))),
        },
        { bufferView: normView, componentType: 5126, count: acc.vertexCount, type: 'VEC3' },
        { bufferView: colView, componentType: 5126, count: acc.vertexCount, type: 'VEC3' },
    ];

    const attributes = { POSITION: 0, NORMAL: 1, COLOR_0: 2 };
    if (includeBatchId) {
        attributes._BATCHID = accessors.length;
        accessors.push({
            bufferView: batchView,
            componentType: 5126,
            count: acc.vertexCount,
            type: 'SCALAR',
            min: [0],
            max: [Math.max(0, buildings.length - 1)],
        });
    }
    const indicesAccessor = accessors.length;
    accessors.push({
        bufferView: idxView,
        componentType: 5123,
        count: acc.indices.length,
        type: 'SCALAR',
    });

    const gltf = {
        asset: { version: '2.0', generator: 'SimplexDM Sample Generator v2.0.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: 'MeridianCampusMesh' }],
        materials: [
            {
                name: 'CampusArchitecturalMaterial',
                pbrMetallicRoughness: { metallicFactor: 0.12, roughnessFactor: 0.72 },
                doubleSided: true,
            },
        ],
        meshes: [
            {
                name: 'CampusBuildings',
                primitives: [{ attributes, indices: indicesAccessor, material: 0, mode: 4 }],
            },
        ],
        buffers: [{ byteLength: binBody.length }],
        bufferViews,
        accessors,
    };

    const jsonChunkData = padBuffer(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20, 4);
    const totalLength = 12 + 8 + jsonChunkData.length + 8 + binBody.length;
    const header = Buffer.alloc(12);
    header.write('glTF', 0, 'ascii');
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(totalLength, 8);

    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonChunkData.length, 0);
    jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binBody.length, 0);
    binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

    return Buffer.concat([header, jsonHeader, jsonChunkData, binHeader, binBody]);
}

/** Build a valid OGC 3D Tiles B3DM v1 binary buffer with Feature Table & Batch Table JSON. */
function buildB3dm(buildings) {
    const glb = buildGlb(buildings, true);
    const ftJson = { BATCH_LENGTH: buildings.length };
    const btJson = {
        building_id: buildings.map((b) => b.id),
        name: buildings.map((b) => b.name),
        height_m: buildings.map((b) => b.height),
        floors: buildings.map((b) => b.floors),
        usage: buildings.map((b) => b.usage),
        year_built: buildings.map((b) => b.yearBuilt),
        energy_rating: buildings.map((b) => b.energyRating),
        footprint_m2: buildings.map((b) => Math.round(b.width * b.depth)),
    };

    // Header is 28 bytes; (28 + ftJsonLen) must be 8-byte aligned -> ftJsonLen % 8 === 4
    let ftRaw = Buffer.from(JSON.stringify(ftJson), 'utf8');
    const ftPad = (8 - ((28 + ftRaw.length) % 8)) % 8;
    ftRaw = Buffer.concat([ftRaw, Buffer.alloc(ftPad, 0x20)]);

    const btRaw = padBuffer(Buffer.from(JSON.stringify(btJson), 'utf8'), 0x20, 8);
    const glbPadded = padBuffer(glb, 0x00, 8);

    const byteLength = 28 + ftRaw.length + btRaw.length + glbPadded.length;
    const header = Buffer.alloc(28);
    header.write('b3dm', 0, 'ascii');
    header.writeUInt32LE(1, 4); // version
    header.writeUInt32LE(byteLength, 8);
    header.writeUInt32LE(ftRaw.length, 12);
    header.writeUInt32LE(0, 16); // ftBinaryByteLength
    header.writeUInt32LE(btRaw.length, 20);
    header.writeUInt32LE(0, 24); // btBinaryByteLength

    return Buffer.concat([header, ftRaw, btRaw, glbPadded]);
}

/** Build a valid OGC 3D Tiles PNTS v1 point-cloud tile (local ENU coordinates + RGB). */
function buildPnts(pointCount = 320) {
    const positions = new Float32Array(pointCount * 3);
    const rgb = new Uint8Array(pointCount * 3);

    // Deterministic spiral courtyard canopy + surveyed ground grid
    for (let i = 0; i < pointCount; i++) {
        const t = i / pointCount;
        if (i < 200) {
            // Courtyard tree clusters in local ENU (East, North, Up)
            const cluster = i % 4;
            const cx = [-18, 18, -18, 18][cluster];
            const cy = [-10, -10, 12, 12][cluster];
            const angle = i * 2.399963; // golden angle
            const radius = 5.5 * Math.sqrt((i % 50) / 50);
            positions[i * 3 + 0] = cx + Math.cos(angle) * radius;
            positions[i * 3 + 1] = cy + Math.sin(angle) * radius;
            positions[i * 3 + 2] = 4.0 + Math.sin(t * Math.PI) * 7.5 + (i % 5) * 0.4;
            rgb[i * 3 + 0] = 42 + (i % 35);
            rgb[i * 3 + 1] = 165 + (i % 65);
            rgb[i * 3 + 2] = 95 + (i % 40);
        } else {
            // Surveyed plaza ground grid
            const idx = i - 200;
            const gx = (idx % 12) - 5.5;
            const gy = Math.floor(idx / 12) - 4.5;
            positions[i * 3 + 0] = gx * 7.5;
            positions[i * 3 + 1] = gy * 7.5;
            positions[i * 3 + 2] = 0.25;
            rgb[i * 3 + 0] = 0;
            rgb[i * 3 + 1] = 185;
            rgb[i * 3 + 2] = 255;
        }
    }

    const posBuf = Buffer.from(positions.buffer);
    const rgbBuf = Buffer.from(rgb.buffer);
    const ftBin = padBuffer(Buffer.concat([posBuf, rgbBuf]), 0x00, 8);

    const ftJson = {
        POINTS_LENGTH: pointCount,
        POSITION: { byteOffset: 0 },
        RGB: { byteOffset: posBuf.length },
    };
    let ftJsonBuf = Buffer.from(JSON.stringify(ftJson), 'utf8');
    const ftPad = (8 - ((28 + ftJsonBuf.length) % 8)) % 8;
    ftJsonBuf = Buffer.concat([ftJsonBuf, Buffer.alloc(ftPad, 0x20)]);

    const byteLength = 28 + ftJsonBuf.length + ftBin.length;
    const header = Buffer.alloc(28);
    header.write('pnts', 0, 'ascii');
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(byteLength, 8);
    header.writeUInt32LE(ftJsonBuf.length, 12);
    header.writeUInt32LE(ftBin.length, 16);
    header.writeUInt32LE(0, 20);
    header.writeUInt32LE(0, 24);

    return Buffer.concat([header, ftJsonBuf, ftBin]);
}

/** Build a valid OGC 3D Tiles I3DM v1 instanced 3D model tile (survey monuments/pylons). */
function buildI3dm(anchorLon, anchorLat) {
    const offsetsEnu = [
        [-32, 0, 0],
        [32, 0, 0],
        [0, -32, 0],
        [0, 32, 0],
    ];
    const [ox, oy, oz] = wgs84ToEcef(anchorLon, anchorLat, 0);
    const m = enuTransformMatrix(anchorLon, anchorLat, 0);
    const posArr = new Float32Array(offsetsEnu.length * 3);
    offsetsEnu.forEach(([e, n, u], i) => {
        // Relative to RTC_CENTER
        posArr[i * 3 + 0] = m[0] * e + m[4] * n + m[8] * u;
        posArr[i * 3 + 1] = m[1] * e + m[5] * n + m[9] * u;
        posArr[i * 3 + 2] = m[2] * e + m[6] * n + m[10] * u;
    });

    const ftBin = padBuffer(Buffer.from(posArr.buffer), 0x00, 8);
    const ftJson = {
        INSTANCES_LENGTH: offsetsEnu.length,
        EAST_NORTH_UP: true,
        RTC_CENTER: [Number(ox.toFixed(3)), Number(oy.toFixed(3)), Number(oz.toFixed(3))],
        POSITION: { byteOffset: 0 },
    };
    // I3DM header is 32 bytes (already 8-byte aligned)
    const ftJsonBuf = padBuffer(Buffer.from(JSON.stringify(ftJson), 'utf8'), 0x20, 8);

    const pylonGlb = padBuffer(
        buildGlb(
            [{ east: 0, north: 0, width: 2.2, depth: 2.2, baseH: 0, height: 8.5, color: [0.96, 0.65, 0.14] }],
            false
        ),
        0x00,
        8
    );

    const btJsonBuf = padBuffer(
        Buffer.from(
            JSON.stringify({
                monument_id: ['MON-W', 'MON-E', 'MON-S', 'MON-N'],
                type: ['control_pylon', 'control_pylon', 'control_pylon', 'control_pylon'],
            }),
            'utf8'
        ),
        0x20,
        8
    );

    const byteLength = 32 + ftJsonBuf.length + ftBin.length + btJsonBuf.length + pylonGlb.length;
    const header = Buffer.alloc(32);
    header.write('i3dm', 0, 'ascii');
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(byteLength, 8);
    header.writeUInt32LE(ftJsonBuf.length, 12);
    header.writeUInt32LE(ftBin.length, 16);
    header.writeUInt32LE(btJsonBuf.length, 20);
    header.writeUInt32LE(0, 24);
    header.writeUInt32LE(1, 28); // gltfFormat = 1 (embedded binary GLB)

    return Buffer.concat([header, ftJsonBuf, ftBin, btJsonBuf, pylonGlb]);
}

/** Build a valid OGC 3D Tiles CMPT v1 composite tile wrapping inner B3DM + I3DM tiles. */
function buildCmpt(innerTiles) {
    const padded = innerTiles.map((t) => padBuffer(t, 0x00, 8));
    const bodyLen = padded.reduce((s, b) => s + b.length, 0);
    const byteLength = 16 + bodyLen;
    const header = Buffer.alloc(16);
    header.write('cmpt', 0, 'ascii');
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(byteLength, 8);
    header.writeUInt32LE(padded.length, 12);
    return Buffer.concat([header, ...padded]);
}

function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const ANCHOR_LON = 4.9041;
    const ANCHOR_LAT = 52.3676;
    const ANCHOR_H = 0.0;

    const northBuildings = [
        {
            id: 'BLD-N01',
            name: 'Meridian Geomatics Tower',
            east: -38,
            north: 42,
            width: 28,
            depth: 24,
            height: 62.5,
            floors: 16,
            usage: 'Research & Engineering',
            yearBuilt: 2023,
            energyRating: 'A++',
            color: [0.18, 0.62, 0.88],
        },
        {
            id: 'BLD-N02',
            name: 'Photogrammetry Lab North',
            east: 4,
            north: 46,
            width: 34,
            depth: 22,
            height: 36.0,
            floors: 9,
            usage: 'Laboratory',
            yearBuilt: 2021,
            energyRating: 'A+',
            color: [0.24, 0.72, 0.78],
        },
        {
            id: 'BLD-N03',
            name: 'LiDAR Calibration Pavilion',
            east: 44,
            north: 38,
            width: 26,
            depth: 26,
            height: 24.5,
            floors: 6,
            usage: 'Calibration Facility',
            yearBuilt: 2025,
            energyRating: 'A+++',
            color: [0.20, 0.78, 0.58],
        },
        {
            id: 'BLD-N04',
            name: 'North Civic Atrium',
            east: -16,
            north: 78,
            width: 42,
            depth: 20,
            height: 19.0,
            floors: 4,
            usage: 'Civic & Exhibition',
            yearBuilt: 2019,
            energyRating: 'A',
            color: [0.46, 0.62, 0.82],
        },
    ];

    const southBuildings = [
        {
            id: 'BLD-S01',
            name: 'Urban Twin Command Center',
            east: -34,
            north: -44,
            width: 32,
            depth: 26,
            height: 48.0,
            floors: 12,
            usage: 'Operations Center',
            yearBuilt: 2024,
            energyRating: 'A++',
            color: [0.32, 0.56, 0.90],
        },
        {
            id: 'BLD-S02',
            name: 'Amstel Waterfront Hub',
            east: 12,
            north: -48,
            width: 38,
            depth: 24,
            height: 31.5,
            floors: 8,
            usage: 'Mixed Use',
            yearBuilt: 2022,
            energyRating: 'A+',
            color: [0.82, 0.58, 0.28],
        },
        {
            id: 'BLD-S03',
            name: 'Hydrographic Archive',
            east: 50,
            north: -38,
            width: 24,
            depth: 28,
            height: 41.0,
            floors: 10,
            usage: 'Data Archive',
            yearBuilt: 2026,
            energyRating: 'A+++',
            color: [0.54, 0.48, 0.86],
        },
        {
            id: 'BLD-S04',
            name: 'Solar Transit Canopy',
            east: -8,
            north: -82,
            width: 48,
            depth: 18,
            height: 14.0,
            floors: 3,
            usage: 'Transit Hub',
            yearBuilt: 2026,
            energyRating: 'A+++',
            color: [0.22, 0.74, 0.66],
        },
    ];

    const plazaPavilion = [
        {
            id: 'BLD-C01',
            name: 'Central Geodetic Observatory',
            east: 0,
            north: 0,
            width: 16,
            depth: 16,
            height: 18.5,
            floors: 4,
            usage: 'Observatory',
            yearBuilt: 2026,
            energyRating: 'A+++',
            color: [0.0, 0.73, 1.0],
        },
    ];

    const northB3dm = buildB3dm(northBuildings);
    const southB3dm = buildB3dm(southBuildings);
    const centerB3dm = buildB3dm(plazaPavilion);
    const lidarPnts = buildPnts(320);
    const pylonsI3dm = buildI3dm(ANCHOR_LON, ANCHOR_LAT);
    const campusCmpt = buildCmpt([centerB3dm, pylonsI3dm]);

    fs.writeFileSync(path.join(OUT_DIR, 'north_buildings.b3dm'), northB3dm);
    fs.writeFileSync(path.join(OUT_DIR, 'south_buildings.b3dm'), southB3dm);
    fs.writeFileSync(path.join(OUT_DIR, 'campus_lidar.pnts'), lidarPnts);
    fs.writeFileSync(path.join(OUT_DIR, 'campus_trees.i3dm'), pylonsI3dm);
    fs.writeFileSync(path.join(OUT_DIR, 'campus_composite.cmpt'), campusCmpt);

    const transform = enuTransformMatrix(ANCHOR_LON, ANCHOR_LAT, ANCHOR_H).map((v) => Number(v.toFixed(6)));

    const regionRad = (wDeg, sDeg, eDeg, nDeg, minH, maxH) => [
        Number((wDeg * DEG2RAD).toFixed(8)),
        Number((sDeg * DEG2RAD).toFixed(8)),
        Number((eDeg * DEG2RAD).toFixed(8)),
        Number((nDeg * DEG2RAD).toFixed(8)),
        minH,
        maxH,
    ];

    const northTileset = {
        asset: {
            version: '1.0',
            tilesetVersion: '2025.06.15',
            gltfUpAxis: 'Y',
            extras: {
                name: 'Meridian Campus — North Sector (2025 Survey)',
                surveyDate: '2025-06-15',
                crs: 'EPSG:4978 (WGS84 ECEF)',
                gsdCm: 3.0,
                buildings: northBuildings.length,
            },
        },
        properties: {
            height_m: { minimum: 19.0, maximum: 62.5 },
            floors: { minimum: 4, maximum: 16 },
            year_built: { minimum: 2019, maximum: 2025 },
        },
        geometricError: 64,
        root: {
            transform,
            boundingVolume: {
                region: regionRad(4.9030, 52.3677, 4.9052, 52.3686, 0, 68),
            },
            geometricError: 0,
            refine: 'ADD',
            content: { uri: 'north_buildings.b3dm' },
        },
    };

    const southTileset = {
        asset: {
            version: '1.0',
            tilesetVersion: '2026.09.20',
            gltfUpAxis: 'Y',
            extras: {
                name: 'Meridian Campus — South Sector (2026 Survey)',
                surveyDate: '2026-09-20',
                crs: 'EPSG:4978 (WGS84 ECEF)',
                gsdCm: 3.0,
                buildings: southBuildings.length,
            },
        },
        properties: {
            height_m: { minimum: 14.0, maximum: 48.0 },
            floors: { minimum: 3, maximum: 12 },
            year_built: { minimum: 2022, maximum: 2026 },
        },
        geometricError: 64,
        root: {
            transform,
            boundingVolume: {
                region: regionRad(4.9030, 52.3666, 4.9052, 52.3675, 0, 54),
            },
            geometricError: 0,
            refine: 'ADD',
            content: { uri: 'south_buildings.b3dm' },
        },
    };

    const masterTileset = {
        asset: {
            version: '1.0',
            tilesetVersion: '2.0.0',
            gltfUpAxis: 'Y',
            extras: {
                title: 'Meridian Survey Campus — Amsterdam 3D Reality Sample',
                location: 'Amsterdam, NL (52.3676°N, 4.9041°E)',
                crs: 'EPSG:4978 / WGS84',
                formats: ['b3dm', 'i3dm', 'pnts', 'cmpt'],
                totalBuildings: northBuildings.length + southBuildings.length + plazaPavilion.length,
                lidarPoints: 320,
                surveyAccuracyCm: 3.0,
            },
        },
        properties: {
            height_m: { minimum: 14.0, maximum: 62.5 },
            floors: { minimum: 3, maximum: 16 },
            year_built: { minimum: 2019, maximum: 2026 },
            footprint_m2: { minimum: 256, maximum: 912 },
        },
        geometricError: 240,
        root: {
            boundingVolume: {
                region: regionRad(4.9028, 52.3665, 4.9054, 52.3687, 0, 70),
            },
            geometricError: 96,
            refine: 'ADD',
            children: [
                {
                    boundingVolume: {
                        region: regionRad(4.9030, 52.3677, 4.9052, 52.3686, 0, 68),
                    },
                    geometricError: 32,
                    refine: 'ADD',
                    content: { uri: 'north_sector_2025_06_15.json' },
                },
                {
                    boundingVolume: {
                        region: regionRad(4.9030, 52.3666, 4.9052, 52.3675, 0, 54),
                    },
                    geometricError: 32,
                    refine: 'ADD',
                    content: { uri: 'south_sector_2026_09_20.json' },
                },
                {
                    transform,
                    boundingVolume: {
                        region: regionRad(4.9035, 52.3672, 4.9047, 52.3680, 0, 22),
                    },
                    geometricError: 8,
                    refine: 'ADD',
                    content: { uri: 'campus_lidar.pnts' },
                },
                {
                    boundingVolume: {
                        region: regionRad(4.9035, 52.3672, 4.9047, 52.3680, 0, 24),
                    },
                    geometricError: 4,
                    refine: 'ADD',
                    content: { uri: 'campus_composite.cmpt' },
                },
            ],
        },
    };

    fs.writeFileSync(path.join(OUT_DIR, 'north_sector_2025_06_15.json'), JSON.stringify(northTileset, null, 2) + '\n');
    fs.writeFileSync(path.join(OUT_DIR, 'south_sector_2026_09_20.json'), JSON.stringify(southTileset, null, 2) + '\n');
    fs.writeFileSync(path.join(OUT_DIR, 'tileset.json'), JSON.stringify(masterTileset, null, 2) + '\n');

    const files = fs.readdirSync(OUT_DIR);
    const totalBytes = files.reduce((s, f) => s + fs.statSync(path.join(OUT_DIR, f)).size, 0);
    console.log(
        `✓ Generated Meridian Campus 3D Tiles sample (${files.length} files, ${(totalBytes / 1024).toFixed(1)} KB total) in data/samples/meridian-campus/`
    );
}

main();
