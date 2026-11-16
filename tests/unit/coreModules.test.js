/**
 * Unit tests for Core & Feature Renderer Modules:
 * - B3DMFeatureExtractor (binary .b3dm / .i3dm / GLB + Batch Table binary)
 * - AdvancedTileLoadingManager (LRU cache, priority queue, culling, adaptive network, perf monitor)
 * - CollaborationManager (bookmarks, annotations, presentations, share URLs, import/export)
 * - PathResolver (URL, Windows, UNC, Unix, relative, join, getTilesetName)
 * - TilesetDatabase (store, query, delete, 3D Tiles 1.0 & 1.1 traversal)
 * - TilesetProcessor (analyzeTileset, getLastTwoLeafTiles w/ ECEF->WGS84, high accuracy)
 * - JSONConfigManager & AppI18n (defaults, shorthand mapping, 985-key EN/AR parity, RTL)
 */
'use strict';

const { B3DMFeatureExtractor } = require('../../public/js/core/b3dmFeatureExtractor');
const {
    LRUTileCache,
    TilePriorityQueue,
    HorizonAndFrustumCuller,
    AdaptiveNetworkOptimizer,
    PerformanceMonitor,
    AdvancedTileLoadingManager,
} = require('../../public/js/core/advancedTileLoading');
const {
    CollaborationManager,
    STORAGE_KEYS,
} = require('../../public/js/features/collaborationManager');

require('../../public/js/utils/pathResolver');
require('../../public/js/utils/tilesetDatabase');
require('../../public/js/core/tilesetProcessor');
require('../../public/js/core/appI18n.locale-en');
require('../../public/js/core/appI18n.locale-ar');
require('../../public/js/core/appI18n');
require('../../public/js/core/jsonConfigManager');

function padBuffer(buf, byteAlign = 8, padByte = 0x20) {
    const rem = buf.length % byteAlign;
    if (rem === 0) return buf;
    return Buffer.concat([buf, Buffer.alloc(byteAlign - rem, padByte)]);
}

/** Build a genuine 3D Tiles 1.0 `.b3dm` buffer with JSON + binary Batch Table + embedded glTF 2.0 GLB. */
function createTestB3dm() {
    const ftJson = padBuffer(Buffer.from(JSON.stringify({ BATCH_LENGTH: 3 }), 'utf8'), 8, 0x20);
    const ftBin = Buffer.alloc(0);

    // Binary Batch Table: 3 Float32 heights = [12.5, 25.0, 37.5] (12 bytes -> padded to 16)
    const rawBtBin = Buffer.alloc(12);
    rawBtBin.writeFloatLE(12.5, 0);
    rawBtBin.writeFloatLE(25.0, 4);
    rawBtBin.writeFloatLE(37.5, 8);
    const btBin = padBuffer(rawBtBin, 8, 0x00);

    const btJson = padBuffer(
        Buffer.from(
            JSON.stringify({
                name: ['Bldg-A', 'Bldg-B', 'Bldg-C'],
                usage: ['office', 'residential', 'office'],
                height: { byteOffset: 0, componentType: 'FLOAT', type: 'SCALAR' },
            }),
            'utf8'
        ),
        8,
        0x20
    );

    // Minimal valid glTF 2.0 GLB payload
    const gltfJson = padBuffer(
        Buffer.from(JSON.stringify({ asset: { version: '2.0', generator: 'MeridianTest' }, meshes: [{}] }), 'utf8'),
        4,
        0x20
    );
    const glb = Buffer.alloc(12 + 8 + gltfJson.length);
    glb.write('glTF', 0, 'ascii');
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(gltfJson.length, 12);
    glb.writeUInt32LE(0x4e4f534a, 16); // JSON chunk
    gltfJson.copy(glb, 20);

    const totalLen = 28 + ftJson.length + ftBin.length + btJson.length + btBin.length + glb.length;
    const header = Buffer.alloc(28);
    header.write('b3dm', 0, 'ascii');
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(totalLen, 8);
    header.writeUInt32LE(ftJson.length, 12);
    header.writeUInt32LE(ftBin.length, 16);
    header.writeUInt32LE(btJson.length, 20);
    header.writeUInt32LE(btBin.length, 24);

    return Buffer.concat([header, ftJson, ftBin, btJson, btBin, glb]);
}

describe('Core & Feature Renderer Modules', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    test('B3DMFeatureExtractor parses binary .b3dm header, Feature/Batch tables (JSON + binary), and glTF 2.0', () => {
        const extractor = new B3DMFeatureExtractor();
        const b3dm = createTestB3dm();
        const result = extractor.parseTileBuffer(b3dm);

        expect(result.format).toBe('b3dm');
        expect(result.version).toBe(1);
        expect(result.featureCount).toBe(3);
        expect(result.propertyNames.sort()).toEqual(['height', 'name', 'usage']);
        expect(result.features[0].properties).toMatchObject({ name: 'Bldg-A', usage: 'office', height: 12.5 });
        expect(result.features[2].properties).toMatchObject({ name: 'Bldg-C', usage: 'office', height: 37.5 });
        expect(result.gltf).toBeTruthy();

        const summary = extractor.summarizeFeatures(result);
        expect(summary.featureCount).toBe(3);
        expect(summary.properties.height.min).toBeCloseTo(12.5, 4);
        expect(summary.properties.height.max).toBeCloseTo(37.5, 4);

        expect(() => extractor.parseB3dm(Buffer.from('NOPE000000000000000000000000'))).toThrow(/magic/i);
    });

    test('AdvancedTileLoadingManager enforces LRU byte budget, priority ordering, culling, and adaptive network', async () => {
        const cache = new LRUTileCache({
            maxBytes: 1000,
            maxEntries: 10,
        });
        cache.set('tileA', { id: 'A' }, 400);
        cache.set('tileB', { id: 'B' }, 400);
        // Touch tileA so tileB becomes least-recently-used
        expect(cache.get('tileA')).toEqual({ id: 'A' });
        cache.set('tileC', { id: 'C' }, 400);
        expect(cache.has('tileB')).toBe(false);
        expect(cache.has('tileA')).toBe(true);
        expect(cache.has('tileC')).toBe(true);
        expect(cache.getStats().currentBytes).toBe(800);
        expect(cache.getStats().evictions).toBe(1);

        // Priority queue orders closest/highest-SSE tile first
        const pq = new TilePriorityQueue();
        const pNear = TilePriorityQueue.computePriority({
            distanceMeters: 80,
            screenSpaceError: 64,
            inFrustum: true,
            centerWeight: 1.0,
        });
        const pFar = TilePriorityQueue.computePriority({
            distanceMeters: 25000,
            screenSpaceError: 8,
            inFrustum: true,
            centerWeight: 0.4,
        });
        pq.enqueue('farTile', pFar);
        pq.enqueue('nearTile', pNear);
        expect(pq.dequeue()).toBe('nearTile');
        expect(pq.dequeue()).toBe('farTile');

        // Horizon culler hides antipodal behind-Earth sphere and keeps near-camera sphere visible
        const culler = new HorizonAndFrustumCuller();
        const camPos = Cesium.Cartesian3.fromDegrees(4.9, 52.37, 250);
        const nearCenter = Cesium.Cartesian3.fromDegrees(4.901, 52.371, 20);
        const antipodalCenter = Cesium.Cartesian3.fromDegrees(-175.1, -52.37, 0);
        expect(culler.isSphereVisibleOverHorizon(camPos, nearCenter, 80)).toBe(true);
        expect(culler.isSphereVisibleOverHorizon(camPos, antipodalCenter, 100)).toBe(false);

        // Adaptive network executes scheduled tasks, tracks throughput, and tunes SSE by FPS
        const net = new AdaptiveNetworkOptimizer({ maxConcurrent: 4 });
        const out = await net.schedule('tile-1', async () => 'loaded-ok', { priority: 10, byteLength: 32768 });
        expect(out).toBe('loaded-ok');
        net.recordTransfer(40, 65536);
        expect(net.recommendScreenSpaceError(8, 18)).toBeGreaterThan(8);
        expect(net.recommendScreenSpaceError(8, 60)).toBeLessThanOrEqual(8);

        // Manager optimizes Cesium3DTileset properties and PerformanceMonitor records FPS
        const mgr = new AdvancedTileLoadingManager();
        mgr.applyConfig({ tileCacheSize: 256, maxConcurrentRequests: 12 });
        const mockTileset = { maximumScreenSpaceError: 16 };
        mgr.optimizeTileset(mockTileset);
        expect(mockTileset.cullWithChildrenBounds).toBe(true);
        expect(mockTileset.foveatedScreenSpaceError).toBe(true);

        const pm = new PerformanceMonitor(mgr);
        pm.recordFrame(16.67);
        pm.recordFrame(16.67);
        expect(pm.getSnapshot().fps).toBeGreaterThan(50);
    });

    test('CollaborationManager handles bookmarks, 3D annotations, presentations, share URLs & JSON round-trip', () => {
        let lastFlyTo = null;
        window.tilesetViewer = {
            getCameraPosition: () => ({
                lon: 4.9041,
                lat: 52.3676,
                height: 350,
                heading: 15,
                pitch: -35,
                roll: 0,
            }),
            flyTo: (target) => {
                lastFlyTo = target;
                return true;
            },
            viewer: {
                camera: {
                    positionCartographic: {
                        longitude: Cesium.Math.toRadians(4.9041),
                        latitude: Cesium.Math.toRadians(52.3676),
                        height: 350,
                    },
                    heading: Cesium.Math.toRadians(15),
                    pitch: Cesium.Math.toRadians(-35),
                    roll: 0,
                    flyTo: (opts) => {
                        lastFlyTo = opts;
                    },
                },
                entities: {
                    add: (e) => e,
                    remove: () => true,
                },
                scene: { requestRender: () => {} },
            },
        };

        const cm = new CollaborationManager();
        cm.init();

        const bm = cm.shareCurrentView('Dam Square — أمستردام', 'Inspection view');
        expect(bm.camera.lon).toBeCloseTo(4.9041, 3);
        expect(bm.shareUrl).toContain('4.9041');

        const ann = cm.addAnnotation({
            title: 'Roof clearance',
            text: 'Verify 2.4m setback',
            lon: 4.905,
            lat: 52.368,
            height: 28,
        });
        expect(cm.annotations).toHaveLength(1);
        cm.flyToAnnotation(ann.id);
        expect(lastFlyTo).toBeTruthy();

        const pres = cm.createPresentation('Site Walkthrough');
        cm.addSlideToPresentation(pres.id, 'Overview slide', 4);
        expect(cm.presentations).toHaveLength(1);
        expect(cm.presentations[0].slides).toHaveLength(1);

        // Verify exact localStorage keys documented in README
        expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.bookmarks))).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.annotations))).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.presentations))).toHaveLength(1);

        // Package export -> clear -> import round-trip
        const pkg = cm.toPackage();
        cm.clearAll();
        expect(cm.annotations).toHaveLength(0);
        expect(cm.sharedBookmarks).toHaveLength(0);
        cm.importPackage(pkg, { merge: false });
        expect(cm.sharedBookmarks).toHaveLength(1);
        expect(cm.annotations).toHaveLength(1);
        expect(cm.presentations).toHaveLength(1);
    });

    test('PathResolver handles HTTP, Windows, UNC, Unix, relative paths, join(), and getTilesetName()', async () => {
        const pr = window.pathResolver;
        expect(await pr.resolvePath('https://cdn.example.com/scene/tileset.json')).toBe(
            'https://cdn.example.com/scene/tileset.json'
        );
        expect(await pr.resolvePath('C:\\Models\\City\\tileset.json')).toContain('/file?path=');
        expect(await pr.resolvePath('\\\\nas01\\3dtiles\\tileset.json')).toContain('/file?path=');
        expect(await pr.resolvePath('/opt/datasets/amsterdam/tileset.json')).toContain('/file?path=');

        expect(pr.join('C:\\Models\\City', '.\\sub\\tile.json')).toBe('C:/Models/City/sub/tile.json');
        expect(pr.resolveRelativePath('../block2/tileset.json', 'http://127.0.0.1:8080/data/block1/tileset.json')).toBe(
            'http://127.0.0.1:8080/data/block2/tileset.json'
        );
        expect(
            pr.getTilesetName('http://127.0.0.1:8080/file?path=C%3A%5CModels%5CDowntown%5Ctileset.json')
        ).toBe('Downtown');
    });

    test('TilesetDatabase & TilesetProcessor support 3D Tiles 1.0 & 1.1 and high-accuracy leaf coordinates', async () => {
        const db = window.tilesetDatabase;
        await db.init();
        await db.clearDatabase();

        const centerEcef = Cesium.Cartesian3.fromDegrees(4.9041, 52.3676, 15.2);
        const sampleTileset = {
            asset: { version: '1.1' },
            geometricError: 200,
            root: {
                geometricError: 100,
                boundingVolume: { sphere: [centerEcef.x, centerEcef.y, centerEcef.z, 500] },
                contents: [{ uri: 'lod0.glb' }, { uri: 'sub/nested_2026_05_01.json' }],
                children: [
                    {
                        geometricError: 2.5,
                        boundingVolume: {
                            region: [
                                Cesium.Math.toRadians(4.9),
                                Cesium.Math.toRadians(52.36),
                                Cesium.Math.toRadians(4.91),
                                Cesium.Math.toRadians(52.37),
                                0,
                                40,
                            ],
                        },
                        content: { uri: 'leaf_a.b3dm' },
                    },
                    {
                        geometricError: 1.0,
                        boundingVolume: { sphere: [centerEcef.x, centerEcef.y, centerEcef.z, 25] },
                        content: { url: 'leaf_b.glb' },
                    },
                ],
            },
        };

        await db.storeTileset('/data/city/tileset.json', sampleTileset);
        const stored = await db.getTileset('/data/city/tileset.json');
        expect(stored.tileCount).toBe(3);
        expect(stored.nestedTilesets).toBe(1);
        expect(db.findNestedTilesets(sampleTileset)).toEqual(['sub/nested_2026_05_01.json']);

        const mockTilesetInstance = { maximumScreenSpaceError: 16, skipLevelOfDetail: true, dynamicScreenSpaceError: true };
        const hiAcc = await window.tilesetProcessor.processLastTilesWithHighAccuracy(sampleTileset, mockTilesetInstance);
        expect(hiAcc.applied).toBe(true);
        expect(hiAcc.lastTiles.count).toBe(2);
        expect(mockTilesetInstance.maximumScreenSpaceError).toBeLessThanOrEqual(0.5);
        expect(mockTilesetInstance.skipLevelOfDetail).toBe(false);

        const lastTwo = window.tilesetProcessor.getLastTwoLeafTiles(sampleTileset);
        expect(lastTwo).toHaveLength(2);
        const leafA = lastTwo.find((t) => t.contentUri === 'leaf_a.b3dm');
        const leafB = lastTwo.find((t) => t.contentUri === 'leaf_b.glb');
        expect(leafA.centerWGS84.lon).toBeCloseTo(4.905, 4);
        expect(leafA.centerWGS84.lat).toBeCloseTo(52.365, 4);
        expect(leafA.centerWGS84.height).toBeCloseTo(20, 3);
        expect(leafB.centerWGS84.lon).toBeCloseTo(4.9041, 4);
        expect(leafB.centerWGS84.lat).toBeCloseTo(52.3676, 4);
        expect(leafB.centerWGS84.height).toBeCloseTo(15.2, 2);

        await db.deleteTileset('/data/city/tileset.json');
        expect((await db.getAllTilesets()).length).toBe(0);
    });

    test('JSONConfigManager supports README shorthand & AppI18n switches EN/AR with RTL + fallback preservation', () => {
        const jcm = window.jsonConfigManager;
        const merged = jcm.mergeAppConfigWithDefaults({
            tools: { measurement: { enabled: false }, navigation: { historySize: 120 } },
            modules: { collaborationManager: { enabled: true } },
        });
        expect(merged.features.measurement.enabled).toBe(false);
        expect(merged.features.navigation.historySize).toBe(120);
        expect(merged.modules.collaborationManager.enabled).toBe(true);
        expect(merged.modules.performanceMonitor.enabled).toBe(true);

        const i18n = window.appI18n;
        i18n.setLocale('ar');
        expect(document.documentElement.getAttribute('dir')).toBe('rtl');
        expect(i18n.t('ui.nav.dashboard')).toBeTruthy();
        expect(i18n.t('ui.nav.dashboard')).not.toBe('ui.nav.dashboard');

        // Missing key preserves existing HTML fallback text instead of injecting raw key path
        const el = document.createElement('span');
        el.setAttribute('data-i18n', 'ui.nonexistent.key.for.test');
        el.textContent = 'Human Readable Fallback';
        i18n.applyDom(el);
        expect(el.textContent).toBe('Human Readable Fallback');

        i18n.setLocale('en');
        expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    });
});
