#!/usr/bin/env node
'use strict';

/**
 * SimplexDM Cross-Platform Offline Label & Tile Utilities (`scripts/offlineLabelTools.js`)
 *
 * Pure Node.js implementations of the offline label database builder, `.rlp`
 * regional label packager, offline slippy-tile `meta.json` generator, and
 * cross-platform Python 3 discovery (handles Windows `python` / `py -3` and
 * rejects the Microsoft Store `WindowsApps\python3.exe` execution-alias stub).
 *
 * Works identically on Windows, macOS, and Linux with zero Python dependency,
 * producing databases and `.rlp` packages 100% schema-compatible with
 * `scripts/build_world_labels.py`, `scripts/pack_region.py`, and `data/update_meta.py`.
 *
 * CLI usage:
 *   node scripts/offlineLabelTools.js build-labels --geojson places.geojson --out labels.db [--min-zoom 0 --max-zoom 8]
 *   node scripts/offlineLabelTools.js pack-region  --db master.db --id nl --name "NL" --west 3 --south 50 --east 8 --north 54 --out nl.rlp
 *   node scripts/offlineLabelTools.js update-meta  [--dir data/tiles]
 */

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const Database = require('../main/gis/services/sqliteDriver');

// Precomputed IEEE 802.3 CRC-32 lookup table (works across all Node 18-25+ versions)
const CRC32_TABLE = (() => {
    const tbl = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        tbl[i] = c >>> 0;
    }
    return tbl;
})();

function crc32Buffer(buf) {
    if (typeof zlib.crc32 === 'function') {
        return zlib.crc32(buf) >>> 0;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Write a standard PKZIP Deflate archive from `[{ name, data }]` entries using Node built-ins only.
 * Compatible with `unzipper`, Python `zipfile`, Windows Explorer, and `.rlp` / `.kmz` importers.
 */
function writeZipArchive(outPath, entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuf = Buffer.from(String(entry.name).replace(/\\/g, '/'), 'utf8');
        const rawBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
        const compressed = zlib.deflateRawSync(rawBuf, { level: 6 });
        const crc = crc32Buffer(rawBuf);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); // Local file header signature
        local.writeUInt16LE(20, 4);         // Version needed (2.0)
        local.writeUInt16LE(0x0800, 6);     // UTF-8 filename flag
        local.writeUInt16LE(8, 8);          // Compression method: DEFLATE
        local.writeUInt16LE(0, 10);         // Mod time
        local.writeUInt16LE(0x21, 12);      // Mod date (1980-01-01)
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(rawBuf.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);

        localParts.push(local, nameBuf, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); // Central directory signature
        central.writeUInt16LE(20, 4);         // Version made by
        central.writeUInt16LE(20, 6);         // Version needed
        central.writeUInt16LE(0x0800, 8);     // UTF-8 filename flag
        central.writeUInt16LE(8, 10);         // DEFLATE
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0x21, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(rawBuf.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);

        centralParts.push(central, nameBuf);
        offset += local.length + nameBuf.length + compressed.length;
    }

    const centralBuf = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // End of central directory signature
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, Buffer.concat([...localParts, centralBuf, eocd]));
}

const REGION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LANG_TAG_RE = /^name:([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)$/;
const RASTER_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const VECTOR_EXTS = new Set(['.pbf', '.mvt']);

const PLACE_RULES = {
    country: ['country', 1000, 0, 7],
    state: ['state', 820, 2, 10],
    province: ['state', 820, 2, 10],
    region: ['state', 780, 3, 10],
    city: ['city', 750, 3, 15],
    town: ['town', 580, 6, 16],
    municipality: ['town', 560, 6, 15],
    village: ['village', 420, 9, 17],
    hamlet: ['village', 340, 11, 18],
    suburb: ['suburb', 460, 10, 18],
    borough: ['suburb', 480, 9, 17],
    quarter: ['suburb', 410, 11, 18],
    neighbourhood: ['suburb', 360, 12, 19],
    island: ['island', 520, 5, 16],
    archipelago: ['island', 560, 4, 14],
};

const HIGHWAY_RULES = {
    motorway: ['motorway', 500, 7, 18],
    trunk: ['motorway', 460, 8, 18],
    primary: ['road', 390, 10, 19],
    secondary: ['road', 340, 11, 19],
    tertiary: ['road', 290, 12, 20],
    residential: ['road', 220, 14, 20],
    living_street: ['road', 210, 14, 20],
    pedestrian: ['road', 250, 13, 20],
    unclassified: ['road', 210, 13, 20],
};

const WATERWAY_VALUES = new Set(['river', 'canal', 'stream', 'strait']);
const AEROWAY_VALUES = new Set(['aerodrome', 'airport', 'international', 'heliport']);
const RAILWAY_VALUES = new Set(['station', 'halt', 'tram_stop', 'subway_entrance']);
const SCHOOL_AMENITIES = new Set(['school', 'university', 'college', 'kindergarten']);
const HOSPITAL_AMENITIES = new Set(['hospital', 'clinic', 'doctors']);
const POI_AMENITIES = new Set([
    'townhall', 'embassy', 'police', 'fire_station', 'library', 'museum',
    'place_of_worship', 'marketplace', 'bus_station', 'ferry_terminal',
    'theatre', 'courthouse', 'post_office',
]);
const VALID_LABEL_TYPES = new Set([
    'country', 'state', 'city', 'town', 'village', 'suburb', 'motorway', 'road',
    'waterway', 'lake', 'mountain', 'island', 'airport', 'railway', 'hospital',
    'school', 'poi', 'custom',
]);

/**
 * Discover a working Python 3.8+ interpreter across Linux, macOS, and Windows.
 * Safely skips the Windows Store `WindowsApps\python3.exe` alias stub.
 * @returns {{ cmd: string, prefixArgs: string[], version: string } | null}
 */
function findPython3(env = process.env) {
    if (env.SKIP_PYTHON_TOOLS === '1') {
        return null;
    }
    const candidates =
        process.platform === 'win32'
            ? [
                  { cmd: 'python', prefixArgs: [] },
                  { cmd: 'py', prefixArgs: ['-3'] },
                  { cmd: 'python3', prefixArgs: [] },
              ]
            : [
                  { cmd: 'python3', prefixArgs: [] },
                  { cmd: 'python', prefixArgs: [] },
              ];

    const probeCode =
        'import sys; ok = sys.version_info >= (3, 8); print("%d.%d.%d" % sys.version_info[:3] if ok else ""); sys.exit(0 if ok else 1)';

    for (const c of candidates) {
        try {
            const res = spawnSync(c.cmd, [...c.prefixArgs, '-c', probeCode], {
                stdio: ['ignore', 'pipe', 'pipe'],
                env,
                timeout: 5000,
                windowsHide: true,
            });
            if (res.status === 0) {
                const version = (res.stdout ? res.stdout.toString('utf8') : '').trim();
                if (/^\d+\.\d+\.\d+$/.test(version)) {
                    return { cmd: c.cmd, prefixArgs: c.prefixArgs, version };
                }
            }
        } catch (_) {
            // Try next candidate
        }
    }
    return null;
}

function runPythonScript(pythonInfo, scriptPath, args = [], opts = {}) {
    const res = spawnSync(
        pythonInfo.cmd,
        [...pythonInfo.prefixArgs, scriptPath, ...args],
        {
            stdio: opts.stdio || 'pipe',
            cwd: opts.cwd,
            env: opts.env || process.env,
            windowsHide: true,
        }
    );
    if (res.status !== 0) {
        const stderr = res.stderr ? res.stderr.toString('utf8').trim() : '';
        throw new Error(`Python script failed (${path.basename(scriptPath)}): ${stderr || `exit ${res.status}`}`);
    }
    return res;
}

function parsePopulation(raw) {
    if (raw == null) return 0;
    if (typeof raw === 'number') return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
    const cleaned = String(raw).split(';')[0].replace(/[^\d]/g, '');
    if (!cleaned) return 0;
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function classifyTags(tags = {}) {
    const explicit = String(tags.label_type || tags.simplex_type || '').trim().toLowerCase();
    if (VALID_LABEL_TYPES.has(explicit)) {
        return {
            type: explicit,
            subtype: String(tags.subtype || explicit),
            priority: Number(tags.priority ?? 500),
            zoomMin: Math.max(0, Math.trunc(Number(tags.zoom_min ?? 0))),
            zoomMax: Math.min(22, Math.trunc(Number(tags.zoom_max ?? 18))),
        };
    }

    const pop = parsePopulation(tags.population);
    const popBonus = pop > 0 ? Math.min(180, Math.log10(pop + 1) * 25) : 0;
    const cap = String(tags.capital || '').trim().toLowerCase();
    const capBonus = cap === 'yes' || cap === '2' ? 90 : cap === '4' || cap === 'state' || cap === 'admin' ? 40 : 0;

    const place = String(tags.place || '').trim().toLowerCase();
    if (PLACE_RULES[place]) {
        let [type, basePrio, zoomMin, zoomMax] = PLACE_RULES[place];
        if (type === 'city' && (pop >= 1_000_000 || capBonus >= 90)) zoomMin = Math.min(zoomMin, 2);
        else if (type === 'city' && pop >= 250_000) zoomMin = Math.min(zoomMin, 4);
        else if (type === 'town' && pop >= 50_000) zoomMin = Math.min(zoomMin, 5);
        return { type, subtype: place, priority: Math.round((basePrio + popBonus + capBonus) * 100) / 100, zoomMin, zoomMax };
    }

    const aeroway = String(tags.aeroway || '').trim().toLowerCase();
    if (AEROWAY_VALUES.has(aeroway)) {
        const isIntl = Boolean(tags.iata) || aeroway === 'international';
        return { type: 'airport', subtype: aeroway, priority: isIntl ? 620 : 470, zoomMin: isIntl ? 7 : 10, zoomMax: 18 };
    }

    const railway = String(tags.railway || '').trim().toLowerCase();
    if (RAILWAY_VALUES.has(railway)) {
        return { type: 'railway', subtype: railway, priority: railway === 'station' ? 460 : 340, zoomMin: railway === 'station' ? 11 : 13, zoomMax: 19 };
    }

    const highway = String(tags.highway || '').trim().toLowerCase();
    if (HIGHWAY_RULES[highway]) {
        const [type, prio, zoomMin, zoomMax] = HIGHWAY_RULES[highway];
        return { type, subtype: highway, priority: prio, zoomMin, zoomMax };
    }

    const waterway = String(tags.waterway || '').trim().toLowerCase();
    if (WATERWAY_VALUES.has(waterway)) {
        return { type: 'waterway', subtype: waterway, priority: waterway === 'river' ? 500 : 360, zoomMin: waterway === 'river' ? 6 : 11, zoomMax: 18 };
    }

    const natural = String(tags.natural || '').trim().toLowerCase();
    if (natural === 'water' || String(tags.water || '').trim().toLowerCase() === 'lake') {
        return { type: 'lake', subtype: String(tags.water || 'water'), priority: 490, zoomMin: 6, zoomMax: 18 };
    }
    if (natural === 'peak' || natural === 'volcano' || natural === 'mountain_range') {
        return { type: 'mountain', subtype: natural, priority: 480, zoomMin: 7, zoomMax: 18 };
    }

    const amenity = String(tags.amenity || '').trim().toLowerCase();
    if (HOSPITAL_AMENITIES.has(amenity)) {
        return { type: 'hospital', subtype: amenity, priority: 430, zoomMin: 12, zoomMax: 19 };
    }
    if (SCHOOL_AMENITIES.has(amenity)) {
        return { type: 'school', subtype: amenity, priority: amenity === 'university' ? 440 : 360, zoomMin: 12, zoomMax: 19 };
    }
    if (POI_AMENITIES.has(amenity) || tags.tourism || tags.historic) {
        const sub = amenity || String(tags.tourism || tags.historic).toLowerCase();
        return { type: 'poi', subtype: sub, priority: 340, zoomMin: 12, zoomMax: 19 };
    }
    return null;
}

function collectCoords(geom, out = []) {
    if (!geom || !geom.coordinates) return out;
    const walk = (c) => {
        if (!Array.isArray(c) || c.length === 0) return;
        if (typeof c[0] === 'number' && typeof c[1] === 'number') {
            out.push([c[0], c[1]]);
        } else {
            for (const sub of c) walk(sub);
        }
    };
    walk(geom.coordinates);
    return out;
}

function extractNames(props = {}) {
    const base = String(props.name || props['name:en'] || props['name:ar'] || props.ref || '').trim();
    if (!base) return null;
    const nameEn = props['name:en'] ? String(props['name:en']).trim() : null;
    const nameAr = props['name:ar'] ? String(props['name:ar']).trim() : null;
    const localMap = {};
    for (const [k, v] of Object.entries(props)) {
        const m = LANG_TAG_RE.exec(k);
        if (m && v != null && String(v).trim()) {
            localMap[m[1]] = String(v).trim();
        }
    }
    const nameLocal = Object.keys(localMap).length > 0 ? JSON.stringify(localMap) : null;
    return { name: base, nameEn, nameAr, nameLocal };
}

/**
 * Build a SQLite + R*Tree world/source label database from a GeoJSON FeatureCollection.
 */
function buildWorldLabelsDb({ geojsonPath, outPath, minZoom = 0, maxZoom = 18 }) {
    const raw = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
    const features = Array.isArray(raw?.features) ? raw.features : [];

    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

    const db = new Database(outPath);
    let count = 0;
    try {
        db.exec(`
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE labels (
                id         INTEGER PRIMARY KEY,
                osm_id     INTEGER,
                name       TEXT NOT NULL,
                name_en    TEXT,
                name_ar    TEXT,
                name_local TEXT,
                type       TEXT NOT NULL,
                subtype    TEXT,
                priority   REAL NOT NULL DEFAULT 0,
                zoom_min   INTEGER NOT NULL DEFAULT 0,
                zoom_max   INTEGER NOT NULL DEFAULT 18,
                lon        REAL NOT NULL,
                lat        REAL NOT NULL
            );
            CREATE VIRTUAL TABLE labels_rtree USING rtree(
                id, bbox_west, bbox_east, bbox_south, bbox_north
            );
        `);

        const insertLabel = db.prepare(`
            INSERT INTO labels (id, osm_id, name, name_en, name_ar, name_local, type, subtype, priority, zoom_min, zoom_max, lon, lat)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertRtree = db.prepare(
            'INSERT INTO labels_rtree (id, bbox_west, bbox_east, bbox_south, bbox_north) VALUES (?, ?, ?, ?, ?)'
        );

        const writeAll = db.transaction(() => {
            for (const feat of features) {
                if (!feat || !feat.geometry) continue;
                const props = feat.properties || {};
                const names = extractNames(props);
                if (!names) continue;
                const cls = classifyTags(props);
                if (!cls) continue;
                if (cls.zoomMin > maxZoom || cls.zoomMax < minZoom) continue;

                const pts = collectCoords(feat.geometry);
                if (pts.length === 0) continue;

                let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
                let sumLon = 0, sumLat = 0;
                for (const [lon, lat] of pts) {
                    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
                    if (lon < west) west = lon;
                    if (lon > east) east = lon;
                    if (lat < south) south = lat;
                    if (lat > north) north = lat;
                    sumLon += lon;
                    sumLat += lat;
                }
                if (!Number.isFinite(west)) continue;

                let lon = sumLon / pts.length;
                let lat = sumLat / pts.length;
                if (feat.geometry.type === 'LineString' && pts.length >= 2) {
                    const mid = pts[Math.floor(pts.length / 2)];
                    lon = (pts[0][0] + pts[pts.length - 1][0]) / 2 || mid[0];
                    lat = (pts[0][1] + pts[pts.length - 1][1]) / 2 || mid[1];
                }
                if (west === east) {
                    west = Math.max(-180, lon - 0.001);
                    east = Math.min(180, lon + 0.001);
                }
                if (south === north) {
                    south = Math.max(-90, lat - 0.001);
                    north = Math.min(90, lat + 0.001);
                }

                count += 1;
                const osmId = Number.isFinite(Number(props.osm_id)) ? Math.trunc(Number(props.osm_id)) : null;
                insertLabel.run(
                    count,
                    osmId,
                    names.name,
                    names.nameEn,
                    names.nameAr,
                    names.nameLocal,
                    cls.type,
                    cls.subtype,
                    cls.priority,
                    Math.max(minZoom, cls.zoomMin),
                    cls.zoomMax,
                    lon,
                    lat
                );
                insertRtree.run(count, west, east, south, north);
            }
        });
        writeAll();

        db.exec(`
            CREATE INDEX idx_labels_zoom_priority ON labels (zoom_min, zoom_max, priority DESC);
            CREATE INDEX idx_labels_type          ON labels (type);
            CREATE INDEX idx_labels_name          ON labels (name COLLATE NOCASE);
            CREATE INDEX idx_labels_name_en       ON labels (name_en COLLATE NOCASE);
            CREATE INDEX idx_labels_name_ar       ON labels (name_ar);
        `);

        const insertMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
        const metaEntries = [
            ['schema_version', '1'],
            ['format', 'simplex-labels-sqlite-v1'],
            ['created_at', new Date().toISOString()],
            ['label_count', String(count)],
            ['min_zoom', String(minZoom)],
            ['max_zoom', String(maxZoom)],
            ['generator', 'scripts/offlineLabelTools.js'],
        ];
        for (const [k, v] of metaEntries) insertMeta.run(k, v);
    } finally {
        db.close();
    }

    return { outPath, labelCount: count };
}

/**
 * Cut a distributable `.rlp` regional label package (`meta.json` + `data.db` ZIP with SHA-256).
 */
function packRegionRlp({
    sourceDbPath,
    outPath,
    id,
    name,
    west,
    south,
    east,
    north,
    minZoom = 0,
    maxZoom = 22,
}) {
    const rid = String(id || '').trim();
    if (!REGION_ID_RE.test(rid) || rid.includes('..')) {
        throw new Error(`Invalid region id "${id}"`);
    }
    if (west < -180 || east > 180 || south < -90 || north > 90 || south > north) {
        throw new Error('Invalid region bounding box');
    }

    const src = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-rlp-'));
    const dataDbPath = path.join(tmpDir, 'data.db');

    try {
        const querySpan = (w, e) =>
            src
                .prepare(
                    `SELECT l.id, l.osm_id, l.name, l.name_en, l.name_ar, l.name_local,
                            l.type, l.subtype, l.priority, l.zoom_min, l.zoom_max, l.lon, l.lat,
                            r.bbox_west, r.bbox_east, r.bbox_south, r.bbox_north
                     FROM labels l
                     JOIN labels_rtree r ON l.id = r.id
                     WHERE r.bbox_west <= ? AND r.bbox_east >= ?
                       AND r.bbox_south <= ? AND r.bbox_north >= ?
                       AND l.zoom_max >= ? AND l.zoom_min <= ?
                     ORDER BY l.priority DESC, l.id ASC`
                )
                .all(e, w, north, south, minZoom, maxZoom);

        let rows;
        if (west <= east) {
            rows = querySpan(west, east);
        } else {
            const seen = new Set();
            rows = [];
            for (const r of [...querySpan(west, 180), ...querySpan(-180, east)]) {
                if (!seen.has(r.id)) {
                    seen.add(r.id);
                    rows.push(r);
                }
            }
        }

        const dst = new Database(dataDbPath);
        try {
            dst.exec(`
                CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE labels (
                    id         INTEGER PRIMARY KEY,
                    osm_id     INTEGER,
                    name       TEXT NOT NULL,
                    name_en    TEXT,
                    name_ar    TEXT,
                    name_local TEXT,
                    type       TEXT NOT NULL,
                    subtype    TEXT,
                    priority   REAL NOT NULL DEFAULT 0,
                    zoom_min   INTEGER NOT NULL DEFAULT 0,
                    zoom_max   INTEGER NOT NULL DEFAULT 18,
                    lon        REAL NOT NULL,
                    lat        REAL NOT NULL
                );
                CREATE VIRTUAL TABLE labels_rtree USING rtree(
                    id, bbox_west, bbox_east, bbox_south, bbox_north
                );
            `);

            const insL = dst.prepare(`
                INSERT INTO labels (id, osm_id, name, name_en, name_ar, name_local, type, subtype, priority, zoom_min, zoom_max, lon, lat)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const insR = dst.prepare(
                'INSERT INTO labels_rtree (id, bbox_west, bbox_east, bbox_south, bbox_north) VALUES (?, ?, ?, ?, ?)'
            );

            const copyTx = dst.transaction(() => {
                rows.forEach((r, idx) => {
                    const newId = idx + 1;
                    insL.run(
                        newId, r.osm_id ?? null, r.name, r.name_en ?? null, r.name_ar ?? null,
                        r.name_local ?? null, r.type, r.subtype ?? null, r.priority,
                        r.zoom_min, r.zoom_max, r.lon, r.lat
                    );
                    insR.run(newId, r.bbox_west, r.bbox_east, r.bbox_south, r.bbox_north);
                });
            });
            copyTx();

            dst.exec(`
                CREATE INDEX idx_labels_zoom_priority ON labels (zoom_min, zoom_max, priority DESC);
                CREATE INDEX idx_labels_type          ON labels (type);
                CREATE INDEX idx_labels_name          ON labels (name COLLATE NOCASE);
                CREATE INDEX idx_labels_name_en       ON labels (name_en COLLATE NOCASE);
                CREATE INDEX idx_labels_name_ar       ON labels (name_ar);
            `);

            const insM = dst.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
            insM.run('schema_version', '1');
            insM.run('region_id', rid);
            insM.run('label_count', String(rows.length));
        } finally {
            dst.close();
        }

        const dbBytes = fs.readFileSync(dataDbPath);
        const sha256 = crypto.createHash('sha256').update(dbBytes).digest('hex');
        let actualZMin = Infinity;
        let actualZMax = -Infinity;
        for (const r of rows) {
            if (r.zoom_min < actualZMin) actualZMin = r.zoom_min;
            if (r.zoom_max > actualZMax) actualZMax = r.zoom_max;
        }
        const zoomPair = [
            Number.isFinite(actualZMin) ? Math.max(minZoom, actualZMin) : minZoom,
            Number.isFinite(actualZMax) ? Math.min(maxZoom, actualZMax) : Math.min(maxZoom, 18),
        ];
        const meta = {
            id: rid,
            name: name || rid,
            formatVersion: 1,
            bbox: [west, south, east, north],
            zoom: zoomPair,
            count: rows.length,
            sizeBytes: dbBytes.length,
            sha256,
            createdAt: new Date().toISOString(),
        };

        writeZipArchive(outPath, [
            { name: 'meta.json', data: Buffer.from(JSON.stringify(meta, null, 2), 'utf8') },
            { name: 'data.db', data: dbBytes },
        ]);

        return meta;
    } finally {
        src.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

function tileBoundsWgs84(z, x, y) {
    const n = Math.pow(2, z);
    const west = (x / n) * 360 - 180;
    const east = ((x + 1) / n) * 360 - 180;
    const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    const south = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
    return [west, south, east, north];
}

function scanTileTree(rootDir, validExts) {
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
        return { zooms: [], tile_count: 0, total_bytes: 0, formats: [], bbox: null };
    }
    const zooms = new Set();
    const formats = new Set();
    let tileCount = 0;
    let totalBytes = 0;
    let finestZoom = -1;
    let bbox = null;

    for (const zEnt of fs.readdirSync(rootDir, { withFileTypes: true })) {
        if (!zEnt.isDirectory() || !/^\d+$/.test(zEnt.name)) continue;
        const z = parseInt(zEnt.name, 10);
        if (z < 0 || z > 24) continue;
        const maxIdx = Math.pow(2, z) - 1;
        let zHasTiles = false;
        const zDir = path.join(rootDir, zEnt.name);

        for (const xEnt of fs.readdirSync(zDir, { withFileTypes: true })) {
            if (!xEnt.isDirectory() || !/^\d+$/.test(xEnt.name)) continue;
            const x = parseInt(xEnt.name, 10);
            if (x < 0 || x > maxIdx) continue;
            const xDir = path.join(zDir, xEnt.name);

            for (const yEnt of fs.readdirSync(xDir, { withFileTypes: true })) {
                if (!yEnt.isFile()) continue;
                const ext = path.extname(yEnt.name).toLowerCase();
                const stem = path.basename(yEnt.name, path.extname(yEnt.name));
                if (!validExts.has(ext) || !/^\d+$/.test(stem)) continue;
                const y = parseInt(stem, 10);
                if (y < 0 || y > maxIdx) continue;
                const size = fs.statSync(path.join(xDir, yEnt.name)).size;
                if (size <= 0) continue;

                zHasTiles = true;
                tileCount += 1;
                totalBytes += size;
                formats.add(ext.slice(1));

                const [w, s, e, n] = tileBoundsWgs84(z, x, y);
                if (z > finestZoom) {
                    finestZoom = z;
                    bbox = [w, s, e, n];
                } else if (z === finestZoom && bbox) {
                    bbox[0] = Math.min(bbox[0], w);
                    bbox[1] = Math.min(bbox[1], s);
                    bbox[2] = Math.max(bbox[2], e);
                    bbox[3] = Math.max(bbox[3], n);
                }
            }
        }
        if (zHasTiles) zooms.add(z);
    }

    return {
        zooms: Array.from(zooms).sort((a, b) => a - b),
        tile_count: tileCount,
        total_bytes: totalBytes,
        formats: Array.from(formats).sort(),
        bbox: bbox ? bbox.map((v) => Math.round(v * 1e6) / 1e6) : null,
    };
}

/**
 * Scan an offline tile directory (`raster/` + `vector/`) and write `meta.json`.
 */
function updateTileMeta({ dir }) {
    const tilesDir = path.resolve(dir || path.join(__dirname, '..', 'data', 'tiles'));
    fs.mkdirSync(tilesDir, { recursive: true });
    const raster = scanTileTree(path.join(tilesDir, 'raster'), RASTER_EXTS);
    const vector = scanTileTree(path.join(tilesDir, 'vector'), VECTOR_EXTS);

    const meta = {
        schema_version: 1,
        updated_at: new Date().toISOString(),
        raster_zooms: raster.zooms,
        vector_zooms: vector.zooms,
        raster,
        vector,
    };
    fs.writeFileSync(path.join(tilesDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    return meta;
}

function parseCliArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        if (tok.startsWith('--')) {
            const key = tok.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) {
                out[key] = true;
            } else {
                out[key] = next;
                i += 1;
            }
        } else {
            out._.push(tok);
        }
    }
    return out;
}

if (require.main === module) {
    const args = parseCliArgs(process.argv.slice(2));
    const sub = args._[0];
    if (sub === 'build-labels') {
        if (!args.geojson || !args.out) {
            console.error('Usage: node scripts/offlineLabelTools.js build-labels --geojson <file> --out <db> [--min-zoom 0 --max-zoom 18]');
            process.exit(1);
        }
        const res = buildWorldLabelsDb({
            geojsonPath: args.geojson,
            outPath: args.out,
            minZoom: Number(args['min-zoom'] ?? 0),
            maxZoom: Number(args['max-zoom'] ?? 18),
        });
        if (!args.quiet) console.log(`[labels] Wrote ${res.labelCount} labels to ${res.outPath}`);
    } else if (sub === 'pack-region') {
        if (!args.db || !args.id || !args.out) {
            console.error('Usage: node scripts/offlineLabelTools.js pack-region --db <db> --id <id> --west W --south S --east E --north N --out <file.rlp>');
            process.exit(1);
        }
        const meta = packRegionRlp({
            sourceDbPath: args.db,
            outPath: args.out,
            id: args.id,
            name: args.name || args.id,
            west: Number(args.west),
            south: Number(args.south),
            east: Number(args.east),
            north: Number(args.north),
            minZoom: Number(args['min-zoom'] ?? 0),
            maxZoom: Number(args['max-zoom'] ?? 22),
        });
        if (!args.quiet) console.log(`[pack-region] Packed ${meta.label_count} labels into ${args.out}`);
    } else if (sub === 'update-meta') {
        const meta = updateTileMeta({ dir: args.dir });
        if (!args.quiet) {
            console.log(
                `[update-meta] raster zooms=[${meta.raster_zooms.join(',')}] (${meta.raster.tile_count} tiles), ` +
                    `vector zooms=[${meta.vector_zooms.join(',')}] (${meta.vector.tile_count} tiles)`
            );
        }
    } else {
        console.error('Commands: build-labels | pack-region | update-meta');
        process.exit(1);
    }
}

module.exports = {
    findPython3,
    runPythonScript,
    writeZipArchive,
    buildWorldLabelsDb,
    packRegionRlp,
    updateTileMeta,
};
