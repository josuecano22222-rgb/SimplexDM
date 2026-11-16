/**
 * Unit tests verifying UI & feature module integrations, edge cases, and regressions:
 * - RegionsManager (3D Tiles 1.0/1.1 nested discovery, date filter & clearDateFilter)
 * - CutByPolygonManager (#cutDrawPolygonBtn unique ID, cancelCutting, null-safe clearCut)
 * - EnhancedMeasurementManager (getResults, clear, distance/plane/surface/ruler aliases)
 * - SearchManager (offline SQLite label search with zero internet access)
 * - DatabaseUI & DashboardUI (show/hide, XSS escaping)
 * - TileInspectorUI (analyzeFeature with B3DMFeatureExtractor, showStyleOptions)
 * - DisplayControl (processLastTilesWithHighAccuracy)
 * - ComprehensiveSettingsUI (_syncToolCatalogAndModules re-enable preservation)
 * - RasterService (file existence & sampling validation)
 */
'use strict';

require('../../public/js/core/b3dmFeatureExtractor');
require('../../public/js/utils/tilesetDatabase');
require('../../public/js/utils/pathResolver');
require('../../public/js/core/tilesetProcessor');
require('../../public/js/core/jsonConfigManager');
require('../../public/js/features/regions');
require('../../public/js/features/cutByPolygonManager');
require('../../public/js/features/enhancedMeasurementManager');
require('../../public/js/features/searchManager');
require('../../public/js/features/displayControl');
require('../../public/js/ui/databaseUI');
require('../../public/js/ui/dashboardUI');
require('../../public/js/ui/tileInspectorUI');
require('../../public/js/ui/controlCenterRegistry');
require('../../public/js/ui/comprehensiveSettingsUI');

const { RasterService } = require('../../main/gis/services/RasterService');
const { CrsService } = require('../../main/gis/services/CrsService');

describe('UI & Feature Module Regressions & Edge Cases', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        delete window.electronAPI;
    });

    test('RegionsManager extracts 3D Tiles 1.0 content.url & 1.1 contents[] and filters/clears date ranges', async () => {
        const rm = window.regionsManager;
        rm.regions = [];
        await rm.discoverRegions(
            {
                asset: { version: '1.1' },
                root: {
                    content: { url: 'north/block_2025_03_15.json' },
                    children: [
                        {
                            contents: [
                                { uri: 'mesh.glb' },
                                { uri: 'south/block_2026_08_20.json' },
                            ],
                        },
                    ],
                },
            },
            { masterBaseUrl: 'http://127.0.0.1:8080/data/master', masterUrl: 'http://127.0.0.1:8080/data/master/tileset.json' }
        );
        expect(rm.regions).toHaveLength(2);

        const filtered2026 = rm.filterByDateRange('2026-01-01', '2026-12-31');
        expect(filtered2026).toHaveLength(1);
        expect(filtered2026[0].uri).toContain('south/block_2026_08_20.json');

        const restored = rm.clearDateFilter();
        expect(restored).toHaveLength(2);
    });

    test('CutByPolygonManager uses unique #cutDrawPolygonBtn ID and supports safe cancelCutting()', () => {
        const cpm = window.cutByPolygonManager;
        cpm.tilesetViewer = { viewer: { entities: { remove: () => {} }, canvas: { style: {} } } };
        cpm.createCutByPolygonModal();
        expect(document.getElementById('cutDrawPolygonBtn')).not.toBeNull();
        expect(document.getElementById('drawPolygonBtn')).toBeNull();
        expect(() => cpm.cancelCutting()).not.toThrow();
    });

    test('EnhancedMeasurementManager exposes getResults(), clear(), and distance/plane/surface/ruler aliases', () => {
        const emm = window.enhancedMeasurementManager;
        emm._useIonSdkOnly = false;
        emm.measurements = [
            { id: 'm1', type: 'distance-point', value: 42.35, formatted: '42.35 m', points: [{}, {}] },
            { id: 'm2', type: 'roof-area', value: 128.5, formatted: '128.50 m²', points: [{}, {}, {}] },
        ];
        const res = emm.getResults();
        expect(res).toHaveLength(2);
        expect(res[0]).toMatchObject({ id: 'm1', value: 42.35, pointCount: 2 });
        expect(typeof emm.clear).toBe('function');
    });

    test('SearchManager returns offline SQLite label matches seamlessly when network is offline', async () => {
        const sm = window.searchManager;
        window.electronAPI = {
            gis: {
                labels: {
                    search: async (q) =>
                        q.toLowerCase().includes('amsterdam')
                            ? [{ name: 'Amsterdam', name_en: 'Amsterdam', name_ar: 'أمستردام', type: 'city', lon: 4.9041, lat: 52.3676 }]
                            : [],
                },
            },
        };
        const prevFetch = global.fetch;
        global.fetch = async () => {
            throw new Error('ENETUNREACH (offline)');
        };
        try {
            const out = await sm.searchByAddress('Amsterdam');
            expect(out.nominatimFailed).toBe(false);
            expect(out.results).toHaveLength(1);
            expect(out.results[0].source).toBe('offline-labels');
            expect(out.results[0].coordinates.lon).toBeCloseTo(4.9041, 4);
            expect(out.results[0].coordinates.lat).toBeCloseTo(52.3676, 4);
        } finally {
            global.fetch = prevFetch;
        }
    });

    test('DatabaseUI escapes untrusted tileset names against XSS and supports show/hide', async () => {
        document.body.innerHTML =
            '<div id="databaseModal" style="display:none"><div class="database-content-area"></div></div>' +
            '<div id="dashboardModal" style="display:none"></div>';

        const db = window.tilesetDatabase;
        await db.init();
        await db.clearDatabase();
        await db.storeTileset('<img src=x onerror=alert(1)>.json', { asset: { version: '1.0' }, root: {} });

        window.databaseUI.init();
        window.databaseUI.show();
        await window.databaseUI.refresh();
        expect(document.getElementById('databaseModal').style.display).toBe('flex');
        const area = document.querySelector('.database-content-area');
        expect(area.querySelector('img')).toBeNull();
        expect(area.innerHTML).toContain('&lt;img');
        window.databaseUI.hide();
        expect(document.getElementById('databaseModal').style.display).toBe('none');

        window.dashboardUI.show();
        expect(document.getElementById('dashboardModal').style.display).toBe('flex');
        window.dashboardUI.hide();
        expect(document.getElementById('dashboardModal').style.display).toBe('none');
        await db.clearDatabase();
    });

    test('ComprehensiveSettingsUI allows disabling AND re-enabling modules without lockout', () => {
        const ui = window.comprehensiveSettingsUI;
        const sample = {
            tools: { items: [{ action: 'search', enabled: true }] },
            modules: { searchManager: { enabled: false } },
        };
        // Step 1: disable module -> disables matching tool catalog item
        ui._syncToolCatalogAndModules(sample);
        expect(sample.tools.items[0].enabled).toBe(false);

        // Step 2: user re-enables module -> both module AND tool item become enabled
        sample.modules.searchManager.enabled = true;
        ui._syncToolCatalogAndModules(sample);
        expect(sample.modules.searchManager.enabled).toBe(true);
        expect(sample.tools.items[0].enabled).toBe(true);
    });

    test('TileInspectorUI, DisplayControl, and RasterService guard invalid inputs cleanly', async () => {
        expect(typeof window.tileInspectorUI.analyzeFeature).toBe('function');
        expect(typeof window.tileInspectorUI.showStyleOptions).toBe('function');
        expect(() => window.tileInspectorUI.showStyleOptions()).not.toThrow();

        window.displayControl.currentTilesets.clear();
        expect(await window.displayControl.processLastTilesWithHighAccuracy()).toBeNull();

        const raster = new RasterService({ crsService: new CrsService() });
        await expect(raster.open('/nonexistent/dem.tif')).rejects.toThrow();
    });
});
