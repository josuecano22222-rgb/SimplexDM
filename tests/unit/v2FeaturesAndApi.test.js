/**
 * @jest-environment node
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { createRequestHandler } = require('../../server/server');
const { TilePositioning } = require('../../public/js/features/tilePositioning');
const { CoordinateManager } = require('../../public/js/features/coordinateManager');
const { ShadeAnalysisManager } = require('../../public/js/features/shadeAnalysisManager');
const { ObliqueViewsManager } = require('../../public/js/features/obliqueViewsManager');
const { StreetViewManager } = require('../../public/js/features/streetViewManager');
const { MetadataManager } = require('../../public/js/features/metadata');
const { FileEditor } = require('../../public/js/core/fileEditor');
const { B3DMFeatureExtractor } = require('../../public/js/core/b3dmFeatureExtractor');

function httpRequest(port, reqPath, options = {}) {
    return new Promise((resolve, reject) => {
        const bodyStr = options.body ? JSON.stringify(options.body) : null;
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path: reqPath,
                method: options.method || 'GET',
                headers: {
                    ...(bodyStr
                        ? {
                              'Content-Type': 'application/json',
                              'Content-Length': Buffer.byteLength(bodyStr),
                          }
                        : {}),
                    ...(options.headers || {}),
                },
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    const text = buf.toString('utf8');
                    let json = null;
                    try {
                        json = JSON.parse(text);
                    } catch (_) {
                        /* non-JSON response */
                    }
                    resolve({ status: res.statusCode, headers: res.headers, buf, text, json });
                });
            }
        );
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

describe('SimplexDM v2.0.0 — REST GIS API, Sample 3D Tiles & Cesium Fallback', () => {
    let srv;
    let port;

    beforeAll(
        () =>
            new Promise((resolve) => {
                const handler = createRequestHandler({
                    appPath: ROOT,
                    publicDir: path.join(ROOT, 'public'),
                    dataDir: path.join(ROOT, 'data'),
                });
                srv = http.createServer(handler);
                srv.listen(0, '127.0.0.1', () => {
                    port = srv.address().port;
                    resolve();
                });
            })
    );

    afterAll(
        () =>
            new Promise((resolve) => {
                srv.close(() => resolve());
            })
    );

    test('GET /api/offline-maps/status reports bundled world labels & sample assets', async () => {
        const res = await httpRequest(port, '/api/offline-maps/status');
        expect(res.status).toBe(200);
        expect(res.json.ok).toBe(true);
        expect(res.json.labels.present).toBe(true);
        expect(res.json.labels.labelCount).toBeGreaterThanOrEqual(150);
        expect(res.json.samples.amsterdamLabelPack.available).toBe(true);
        expect(res.json.samples.meridianCampus.available).toBe(true);
    });

    test('POST /api/gis/labels/query, GET /search & /regions serve English and Arabic labels', async () => {
        const reg = await httpRequest(port, '/api/gis/labels/regions');
        expect(reg.status).toBe(200);
        expect(reg.json.worldBase.present).toBe(true);

        const vp = await httpRequest(port, '/api/gis/labels/query', {
            method: 'POST',
            body: {
                viewport: { west: -5, south: 47, east: 15, north: 56, zoom: 6 },
                activeRegions: [],
                opts: {},
            },
        });
        expect(vp.status).toBe(200);
        expect(Array.isArray(vp.json)).toBe(true);
        expect(vp.json.some((r) => r.name_en === 'Amsterdam')).toBe(true);

        const arSearch = await httpRequest(
            port,
            `/api/gis/labels/search?q=${encodeURIComponent('أمستردام')}&limit=5`
        );
        expect(arSearch.status).toBe(200);
        expect(arSearch.json.length).toBeGreaterThanOrEqual(1);
        expect(arSearch.json[0].name_en).toBe('Amsterdam');

        // Import bundled Amsterdam .rlp regional pack, query z15 streets, then remove cleanly
        const imp = await httpRequest(port, '/api/gis/labels/import-sample', { method: 'POST', body: {} });
        expect(imp.status).toBe(200);
        expect(imp.json.ok).toBe(true);
        expect(imp.json.meta.id).toBe('nl-amsterdam-metro');

        const localVp = await httpRequest(port, '/api/gis/labels/query', {
            method: 'POST',
            body: {
                viewport: { west: 4.86, south: 52.34, east: 4.94, north: 52.39, zoom: 15 },
                activeRegions: ['nl-amsterdam-metro'],
                opts: {},
            },
        });
        expect(localVp.status).toBe(200);
        expect(localVp.json.length).toBeGreaterThanOrEqual(5);

        const rm = await httpRequest(port, '/api/gis/labels/remove-region', {
            method: 'POST',
            body: { regionId: 'nl-amsterdam-metro' },
        });
        expect(rm.status).toBe(200);
        expect(rm.json.ok).toBe(true);
    });

    test('GET /api/gis/crs/search & POST /api/gis/crs/transform project coordinates accurately', async () => {
        const search = await httpRequest(port, '/api/gis/crs/search?q=32631');
        expect(search.status).toBe(200);
        expect(search.json.ok).toBe(true);
        expect(search.json.items.some((c) => c.code === 'EPSG:32631')).toBe(true);

        const tx = await httpRequest(port, '/api/gis/crs/transform', {
            method: 'POST',
            body: { from: 'EPSG:4326', to: 'EPSG:32631', coords: [4.9041, 52.3676] },
        });
        expect(tx.status).toBe(200);
        expect(tx.json.coords[0]).toBeGreaterThan(620000);
        expect(tx.json.coords[0]).toBeLessThan(640000);
        expect(tx.json.coords[1]).toBeGreaterThan(5800000);
    });

    test('POST /api/gis/geoprocess executes real JSTS geometry buffering', async () => {
        const res = await httpRequest(port, '/api/gis/geoprocess', {
            method: 'POST',
            body: {
                op: 'buffer',
                params: {
                    geojson: {
                        type: 'Feature',
                        properties: {},
                        geometry: { type: 'Point', coordinates: [4.9041, 52.3676] },
                    },
                    distance: 0.01,
                },
            },
        });
        expect(res.status).toBe(200);
        expect(res.json.ok).toBe(true);
        const geom = res.json.result.geometry || res.json.result;
        expect(geom.type).toBe('Polygon');
        expect(geom.coordinates[0].length).toBeGreaterThan(8);
    });

    test('serves bundled Meridian Campus 3D Tileset (.b3dm, .i3dm, .pnts, .cmpt) & parses features', async () => {
        const tsRes = await httpRequest(port, '/data/samples/meridian-campus/tileset.json');
        expect(tsRes.status).toBe(200);
        expect(['1.0', '1.1']).toContain(tsRes.json.asset.version);
        expect(tsRes.json.root.children.length).toBeGreaterThanOrEqual(4);

        const extractor = new B3DMFeatureExtractor();
        for (const [file, magic] of [
            ['north_buildings.b3dm', 'b3dm'],
            ['campus_trees.i3dm', 'i3dm'],
            ['campus_lidar.pnts', 'pnts'],
            ['campus_composite.cmpt', 'cmpt'],
        ]) {
            const tileRes = await httpRequest(port, `/data/samples/meridian-campus/${file}`);
            expect(tileRes.status).toBe(200);
            expect(tileRes.buf.slice(0, 4).toString('ascii')).toBe(magic);
            const parsed = extractor.parseTileBuffer(
                tileRes.buf.buffer.slice(
                    tileRes.buf.byteOffset,
                    tileRes.buf.byteOffset + tileRes.buf.byteLength
                )
            );
            expect(parsed.format).toBe(magic);
        }
    });

    test('serves CesiumJS via node_modules fallback and returns clean stub for optional Ion SDK', async () => {
        const cesiumHead = await httpRequest(port, '/lib/cesium/Widgets/widgets.css', {
            method: 'HEAD',
        });
        expect(cesiumHead.status).toBe(200);

        const ionStub = await httpRequest(
            port,
            '/lib/cesium/packages/ion-sdk-measurements/Build/IonSdkMeasurements/IonSdkMeasurements.js'
        );
        expect(ionStub.status).toBe(200);
        expect(ionStub.headers['x-simplex-optional-addon']).toBe('unavailable');
    });
});

describe('SimplexDM v2.0.0 — Geodesic Math, Solar Ephemeris, Security & Editors', () => {
    test('TilePositioning.computeEnuDeltaEcef produces exact WGS84 ENU vectors', () => {
        // At (0°E, 0°N): East = (0, +1, 0), North = (0, 0, +1), Up = (+1, 0, 0)
        const eqNorth = TilePositioning.computeEnuDeltaEcef(0, 0, 0, 10, 0);
        expect(eqNorth.x).toBeCloseTo(0, 8);
        expect(eqNorth.y).toBeCloseTo(0, 8);
        expect(eqNorth.z).toBeCloseTo(10, 8);

        const eqEast = TilePositioning.computeEnuDeltaEcef(0, 0, 15, 0, 0);
        expect(eqEast.x).toBeCloseTo(0, 8);
        expect(eqEast.y).toBeCloseTo(15, 8);
        expect(eqEast.z).toBeCloseTo(0, 8);

        const eqUp = TilePositioning.computeEnuDeltaEcef(0, 0, 0, 0, 25);
        expect(eqUp.x).toBeCloseTo(25, 8);
        expect(eqUp.y).toBeCloseTo(0, 8);
        expect(eqUp.z).toBeCloseTo(0, 8);

        // Norm invariance at Amsterdam (4.9041°E, 52.3676°N)
        const ams = TilePositioning.computeEnuDeltaEcef(4.9041, 52.3676, 3, 4, 12);
        expect(Math.hypot(ams.x, ams.y, ams.z)).toBeCloseTo(13, 8);
    });

    test('CoordinateManager WGS84 <-> UTM round-trips within 0.001° across global zones & exceptions', () => {
        const samples = [
            { name: 'Amsterdam', lon: 4.9041, lat: 52.3676, zone: 31, band: 'U' },
            { name: 'New York', lon: -74.006, lat: 40.7128, zone: 18, band: 'T' },
            { name: 'Sydney', lon: 151.2093, lat: -33.8688, zone: 56, band: 'H' },
            { name: 'Bergen (Norway 32V)', lon: 5.3221, lat: 60.3913, zone: 32, band: 'V' },
            { name: 'Longyearbyen (Svalbard 33X)', lon: 15.63, lat: 78.22, zone: 33, band: 'X' },
        ];
        for (const s of samples) {
            const utm = CoordinateManager.wgs84ToUtm(s.lon, s.lat);
            expect(utm).not.toBeNull();
            expect(utm.zone).toBe(s.zone);
            expect(utm.band).toBe(s.band);
            const back = CoordinateManager.utmToWgs84(
                utm.zone,
                utm.hemisphere,
                utm.easting,
                utm.northing
            );
            expect(back.lon).toBeCloseTo(s.lon, 4);
            expect(back.lat).toBeCloseTo(s.lat, 4);
        }

        const dms = CoordinateManager.toDms(4.9041, 52.3676);
        expect(dms.lat).toContain('52°22′');
        expect(dms.lon).toContain('4°54′');
    });

    test('ShadeAnalysisManager.computeSolarPosition returns accurate seasonal solar geometry', () => {
        const summerNoon = ShadeAnalysisManager.computeSolarPosition(
            new Date('2026-06-21T11:40:00Z'),
            52.3676,
            4.9041
        );
        const winterNoon = ShadeAnalysisManager.computeSolarPosition(
            new Date('2026-12-21T11:40:00Z'),
            52.3676,
            4.9041
        );
        const midnight = ShadeAnalysisManager.computeSolarPosition(
            new Date('2026-11-16T00:00:00Z'),
            52.3676,
            4.9041
        );

        // Amsterdam summer solstice max elevation ~61.1°, winter solstice ~14.2°
        expect(summerNoon.altitudeDeg).toBeGreaterThan(59);
        expect(summerNoon.altitudeDeg).toBeLessThan(63);
        expect(summerNoon.phase).toBe('Daylight');
        expect(winterNoon.altitudeDeg).toBeGreaterThan(12);
        expect(winterNoon.altitudeDeg).toBeLessThan(16);
        expect(midnight.altitudeDeg).toBeLessThan(-12);
        expect(midnight.phase).toBe('Night');
    });

    test('ObliqueViewsManager & StreetViewManager pure direction helpers are accurate', () => {
        expect(ObliqueViewsManager.computeViewSpec('east', 45, 300)).toMatchObject({
            headingDeg: 90,
            pitchDeg: -45,
            rangeMeters: 300,
        });
        expect(ObliqueViewsManager.computeViewSpec('nadir', 30, 500).pitchDeg).toBe(-89.5);
        expect(StreetViewManager.formatCardinal(0)).toBe('N');
        expect(StreetViewManager.formatCardinal(90)).toBe('E');
        expect(StreetViewManager.formatCardinal(225)).toBe('SW');
    });

    test('MetadataManager neutralizes XSS payloads and exports valid CSV', () => {
        const mm = new MetadataManager();
        const escaped = mm.formatValue('<img src=x onerror=alert(1)>');
        expect(escaped).not.toContain('<img');
        expect(escaped).toContain('&lt;img');
        mm.currentMetadata = {
            properties: { name: 'Tower "A"', height_m: 42.5 },
            title: 'Test',
        };
        const csv = mm.toCsvString();
        expect(csv).toContain('"Tower ""A"""');
        expect(csv).toContain('"42.5"');
    });

    test('FileEditor validates 3D Tiles JSON, reports warnings, formats & minifies', () => {
        const ed = new FileEditor();
        const valid = ed.validateJSON(
            JSON.stringify({
                asset: { version: '1.1' },
                geometricError: 64,
                root: { boundingVolume: { sphere: [0, 0, 0, 10] }, geometricError: 0 },
            })
        );
        expect(valid.valid).toBe(true);
        expect(valid.warnings).toHaveLength(0);

        const warn = ed.validateJSON(JSON.stringify({ asset: {}, root: {} }));
        expect(warn.valid).toBe(true);
        expect(warn.warnings.length).toBeGreaterThan(0);

        const bad = ed.validateJSON('{\n  "asset": \n}');
        expect(bad.valid).toBe(false);

        expect(ed.minifyJSON('{\n  "a": 1\n}')).toBe('{"a":1}');
        expect(ed.formatJSON('{"a":1}')).toBe('{\n  "a": 1\n}');
    });

    test('Static security & completeness: zero raw alert(), zero external font CDNs, full OSS docs', () => {
        for (const doc of ['README.md', 'LICENSE', 'CONTRIBUTING.md']) {
            const p = path.join(ROOT, doc);
            expect(fs.existsSync(p)).toBe(true);
            expect(fs.statSync(p).size).toBeGreaterThan(500);
        }
        for (const rel of [
            'public/index.html',
            'public/landing.html',
            'public/admin.html',
            'public/css/landing.css',
        ]) {
            const txt = fs.readFileSync(path.join(ROOT, rel), 'utf8');
            expect(txt).not.toContain('fonts.googleapis.com');
            expect(txt).not.toContain('cdnjs.cloudflare.com');
            expect(txt).not.toMatch(/\balert\s*\(/);
        }
    });
});
