/**
 * Offline Map Labels, Python ETL/Packaging Scripts, Offline Tile Metadata,
 * and Mapbox Vector Tile (`.pbf`) Decoder Tests.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const labelDbSingleton = require('../../main/gis/services/labelDatabaseService');
const { LabelRegionImporter } = require('../../main/gis/services/labelRegionImporter');
const {
    downloadToFile,
    verifyLabelsSqlite,
    readDownloadManifest,
} = require('../../main/gis/services/labelDownloadService');
const {
    decodeMvt,
    renderMvtToCanvas,
} = require('../../public/js/gis/offlineVectorTileProvider');

require('../../public/js/gis/labelCollisionEngine');
require('../../public/js/gis/labelManager');

const ROOT = path.resolve(__dirname, '../..');

/** Encode a minimal spec-compliant Mapbox Vector Tile v2 binary buffer for testing. */
function encodeTestMvt() {
    const varint = (n) => {
        const out = [];
        let v = n >>> 0;
        while (v >= 0x80) {
            out.push((v & 0x7f) | 0x80);
            v >>>= 7;
        }
        out.push(v);
        return out;
    };
    const zigzag = (n) => ((n << 1) ^ (n >> 31)) >>> 0;
    const cmd = (id, count) => ((id & 0x7) | (count << 3)) >>> 0;
    const fieldBytes = (fieldNum, payload) => [
        ...varint((fieldNum << 3) | 2),
        ...varint(payload.length),
        ...payload,
    ];
    const fieldVarint = (fieldNum, val) => [...varint((fieldNum << 3) | 0), ...varint(val)];
    const fieldString = (fieldNum, str) => fieldBytes(fieldNum, Array.from(Buffer.from(str, 'utf8')));
    const packedUint = (nums) => nums.flatMap((n) => varint(n));

    // Polygon feature: square (100,100) -> (600,100) -> (600,600) -> (100,600) -> close
    const geomCmds = [
        cmd(1, 1), zigzag(100), zigzag(100),
        cmd(2, 3), zigzag(500), zigzag(0), zigzag(0), zigzag(500), zigzag(-500), zigzag(0),
        cmd(7, 1),
    ];
    const feature = [
        ...fieldVarint(1, 42), // id = 42
        ...fieldBytes(2, packedUint([0, 0])), // tags: key[0] = value[0]
        ...fieldVarint(3, 3), // type = POLYGON
        ...fieldBytes(4, packedUint(geomCmds)),
    ];
    const valueMsg = fieldString(1, 'canal');
    const layer = [
        ...fieldVarint(15, 2), // version = 2
        ...fieldString(1, 'water'), // name = 'water'
        ...fieldBytes(2, feature),
        ...fieldString(3, 'class'),
        ...fieldBytes(4, valueMsg),
        ...fieldVarint(5, 4096), // extent = 4096
    ];
    return new Uint8Array(fieldBytes(3, layer));
}

describe('Offline Label Databases, Python Packagers, Offline Tile Metadata & MVT Decoder', () => {
    let tmpDir;
    let userDataDir;
    let worldDbPath;
    let rlpPath;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-labels-test-'));
        userDataDir = path.join(tmpDir, 'userData');
        fs.mkdirSync(path.join(userDataDir, 'label-data', 'regions'), { recursive: true });

        const allPlacesGeoJson = path.join(tmpDir, 'world-places.geojson');
        fs.writeFileSync(
            allPlacesGeoJson,
            JSON.stringify({
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        properties: {
                            name: 'Nederland',
                            'name:en': 'Netherlands',
                            'name:ar': 'هولندا',
                            'name:fr': 'Pays-Bas',
                            place: 'country',
                            population: 17900000,
                        },
                        geometry: { type: 'Point', coordinates: [5.2913, 52.1326] },
                    },
                    {
                        type: 'Feature',
                        properties: {
                            name: 'Amsterdam',
                            'name:en': 'Amsterdam',
                            'name:ar': 'أمستردام',
                            place: 'city',
                            population: 921000,
                        },
                        geometry: { type: 'Point', coordinates: [4.9041, 52.3676] },
                    },
                    {
                        type: 'Feature',
                        properties: {
                            name: 'Damrak',
                            'name:en': 'Damrak Street',
                            'name:ar': 'شارع دامراك',
                            highway: 'primary',
                        },
                        geometry: {
                            type: 'LineString',
                            coordinates: [[4.8925, 52.3735], [4.8975, 52.3775]],
                        },
                    },
                    {
                        type: 'Feature',
                        properties: {
                            name: 'Schiphol Airport',
                            'name:en': 'Amsterdam Airport Schiphol',
                            'name:ar': 'مطار سخيبول أمستردام',
                            aeroway: 'aerodrome',
                        },
                        geometry: { type: 'Point', coordinates: [4.7683, 52.3105] },
                    },
                ],
            })
        );

        // 1. Build full SQLite label DB (zooms 0..18) via scripts/build_world_labels.py
        const masterSourceDb = path.join(tmpDir, 'master-source.db');
        execFileSync(
            'python3',
            [
                path.join(ROOT, 'scripts/build_world_labels.py'),
                '--geojson', allPlacesGeoJson,
                '--min-zoom', '0',
                '--max-zoom', '18',
                '--out', masterSourceDb,
                '--quiet',
            ],
            { stdio: 'pipe' }
        );

        // Build coarse world base DB (zooms 0..8) in userData/label-data/
        worldDbPath = path.join(userDataDir, 'label-data', 'labels-world-base.db');
        execFileSync(
            'python3',
            [
                path.join(ROOT, 'scripts/build_world_labels.py'),
                '--geojson', allPlacesGeoJson,
                '--min-zoom', '0',
                '--max-zoom', '8',
                '--out', worldDbPath,
                '--quiet',
            ],
            { stdio: 'pipe' }
        );

        // 2. Cut a distributable .rlp region pack via scripts/pack_region.py
        rlpPath = path.join(tmpDir, 'nl-north-holland.rlp');
        execFileSync(
            'python3',
            [
                path.join(ROOT, 'scripts/pack_region.py'),
                '--db', masterSourceDb,
                '--id', 'nl-north-holland',
                '--name', 'North Holland',
                '--west', '4.5',
                '--south', '52.1',
                '--east', '5.2',
                '--north', '52.6',
                '--min-zoom', '8',
                '--max-zoom', '18',
                '--out', rlpPath,
                '--quiet',
            ],
            { stdio: 'pipe' }
        );
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('build_world_labels.py & pack_region.py work end-to-end with LabelDatabaseService & LabelRegionImporter', async () => {
        expect(fs.existsSync(worldDbPath)).toBe(true);
        expect(fs.existsSync(rlpPath)).toBe(true);
        verifyLabelsSqlite(worldDbPath);

        const mockApp = {
            getPath: (name) => (name === 'userData' ? userDataDir : tmpDir),
            getAppPath: () => tmpDir,
            isPackaged: false,
        };

        const svc = labelDbSingleton;
        svc.closeAll();
        svc.configure(mockApp);
        expect(svc.loadWorldBase()).toBe(true);

        const importer = new LabelRegionImporter();
        importer.configure(mockApp);

        // Query world DB at low zoom
        const worldHits = svc.queryViewport(
            { west: 3.0, south: 50.5, east: 7.5, north: 53.8, zoom: 5 },
            [],
            { maxResults: 50 }
        );
        expect(worldHits.length).toBeGreaterThanOrEqual(2);
        expect(worldHits[0].type).toBe('country');
        expect(worldHits[0].name_ar).toBe('هولندا');

        // Empty types array returns [] (no labels shown when user clicks "None")
        const noneHits = svc.queryViewport(
            { west: 3.0, south: 50.5, east: 7.5, north: 53.8, zoom: 5 },
            [],
            { types: [], maxResults: 50 }
        );
        expect(noneHits).toEqual([]);

        // Import region pack (.rlp) and verify SHA-256 + R*Tree queries + Arabic search
        const progressEvents = [];
        const imported = await importer.importPack(rlpPath, (pct, msg) => progressEvents.push({ pct, msg }));
        expect(imported.id).toBe('nl-north-holland');
        expect(imported.count).toBeGreaterThanOrEqual(2);
        expect(progressEvents.length).toBeGreaterThan(0);

        const detailHits = svc.queryViewport(
            { west: 4.7, south: 52.25, east: 5.0, north: 52.42, zoom: 13 },
            ['nl-north-holland'],
            { maxResults: 50 }
        );
        const names = detailHits.map((r) => r.name);
        expect(names).toContain('Damrak');
        expect(names).toContain('Schiphol Airport');

        // Offline search in English & Arabic
        const arSearch = svc.searchLabels('أمستردام', { maxResults: 10 }, ['nl-north-holland']);
        expect(arSearch.length).toBeGreaterThanOrEqual(1);
        const roadSearch = svc.searchLabels('Damrak', { maxResults: 10 }, ['nl-north-holland']);
        expect(roadSearch).toHaveLength(1);
        expect(roadSearch[0].type).toBe('road');

        // Toggle disable + remove region cleanly
        importer.setEnabled('nl-north-holland', false);
        expect(importer.listInstalled()[0].enabled).toBe(false);
        importer.remove('nl-north-holland');
        expect(importer.listInstalled()).toEqual([]);

        // Path traversal region IDs are blocked
        expect(() => labelDbSingleton.validateRegionId('../escape')).toThrow();

        // LabelDownloadService enforces HTTPS on remote URLs and reads bundled manifest
        await expect(
            downloadToFile('http://insecure.example.com/world.db', path.join(tmpDir, 'bad.db'))
        ).rejects.toThrow(/HTTPS/i);
        const manifest = readDownloadManifest({ getAppPath: () => ROOT, getPath: () => userDataDir });
        expect(manifest).toBeTruthy();

        svc.closeAll();
    });

    test('data/map_offline.py & data/update_meta.py scan raster + vector zooms and write meta.json', () => {
        const tilesDir = path.join(tmpDir, 'tiles');
        fs.mkdirSync(path.join(tilesDir, 'raster', '0', '0'), { recursive: true });
        fs.mkdirSync(path.join(tilesDir, 'raster', '2', '1'), { recursive: true });
        fs.mkdirSync(path.join(tilesDir, 'vector', '4', '8'), { recursive: true });

        // 1x1 PNG stub and MVT PBF tile
        fs.writeFileSync(path.join(tilesDir, 'raster', '0', '0', '0.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        fs.writeFileSync(path.join(tilesDir, 'raster', '2', '1', '1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        fs.writeFileSync(path.join(tilesDir, 'vector', '4', '8', '5.pbf'), Buffer.from(encodeTestMvt()));

        execFileSync('python3', [path.join(ROOT, 'data/update_meta.py'), '--dir', tilesDir, '--quiet'], {
            stdio: 'pipe',
        });

        const meta = JSON.parse(fs.readFileSync(path.join(tilesDir, 'meta.json'), 'utf8'));
        expect(meta.raster_zooms).toEqual([0, 2]);
        expect(meta.vector_zooms).toEqual([4]);
    });

    test('OfflineVectorTileImageryProvider decodes binary MVT v2 protobuf tiles and renders canvas', () => {
        const buf = encodeTestMvt();
        const decoded = decodeMvt(buf);
        expect(decoded.layers).toHaveLength(1);
        const layer = decoded.layers[0];
        expect(layer.name).toBe('water');
        expect(layer.extent).toBe(4096);
        expect(layer.features).toHaveLength(1);
        expect(layer.features[0].id).toBe(42);
        expect(layer.features[0].type).toBe(3); // POLYGON
        expect(layer.features[0].properties).toEqual({ class: 'canal' });
        expect(layer.features[0].geometry[0]).toEqual([
            [100, 100],
            [600, 100],
            [600, 600],
            [100, 600],
            [100, 100],
        ]);

        // Render with a spy 2D context
        const ops = [];
        const mockCanvas = {
            width: 0,
            height: 0,
            getContext: () => ({
                fillStyle: '',
                strokeStyle: '',
                lineWidth: 1,
                fillRect: (...a) => ops.push(['fillRect', ...a]),
                beginPath: () => ops.push(['beginPath']),
                moveTo: (...a) => ops.push(['moveTo', ...a]),
                lineTo: (...a) => ops.push(['lineTo', ...a]),
                closePath: () => ops.push(['closePath']),
                fill: () => ops.push(['fill']),
                stroke: () => ops.push(['stroke']),
            }),
        };
        renderMvtToCanvas(decoded, 256, undefined, mockCanvas);
        expect(mockCanvas.width).toBe(256);
        expect(ops.some((o) => o[0] === 'fill')).toBe(true);
    });

    test('labelCollisionEngine culls overlapping & off-canvas labels; labelManager resolves i18n names', () => {
        const viewer = {
            scene: {
                canvas: { clientWidth: 800, clientHeight: 600 },
                _project: (cart3) => {
                    // Use deterministic map from x sign to screen coords
                    if (cart3._off) return { x: -50, y: 100 };
                    return { x: 400, y: 300 };
                },
            },
        };
        // Two labels projecting to identical screen point: higher-priority first wins
        const culled = window.labelCollisionEngine.cull(viewer, [
            { lon: 4.9, lat: 52.37, name: 'Amsterdam', type: 'city' },
            { lon: 4.9, lat: 52.37, name: 'Centrum', type: 'suburb' },
        ]);
        expect(culled).toHaveLength(1);
        expect(culled[0].name).toBe('Amsterdam');

        // Off-canvas coordinates are discarded
        const offViewer = {
            scene: {
                canvas: { clientWidth: 800, clientHeight: 600 },
                _project: () => ({ x: 950, y: 300 }),
            },
        };
        expect(
            window.labelCollisionEngine.cull(offViewer, [{ lon: 4.9, lat: 52.37, name: 'Far', type: 'city' }])
        ).toHaveLength(0);

        // LabelManager multi-language resolution
        const row = {
            name: 'Nederland',
            name_en: 'Netherlands',
            name_ar: 'هولندا',
            name_local: JSON.stringify({ fr: 'Pays-Bas' }),
        };
        window.labelManager.setLanguage('default');
        expect(window.labelManager._resolveName(row)).toBe('Nederland');
        window.labelManager.setLanguage('en');
        expect(window.labelManager._resolveName(row)).toBe('Netherlands');
        window.labelManager.setLanguage('ar');
        expect(window.labelManager._resolveName(row)).toBe('هولندا');
        window.labelManager.setLanguage('fr');
        expect(window.labelManager._resolveName(row)).toBe('Pays-Bas');
    });
});
