/**
 * @jest-environment node
 *
 * Comprehensive tests for Desktop GIS services (`main/gis/services/` & `geoprocess.worker.js`).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const Database = require('../../main/gis/services/sqliteDriver');
const { CrsService } = require('../../main/gis/services/CrsService');
const { GeoPackageService } = require('../../main/gis/services/GeoPackageService');
const {
    ImportExportService,
    featureCollectionToKml,
    featureCollectionToCsv,
} = require('../../main/gis/services/ImportExportService');
const { resolveWorkerScript } = require('../../main/gis/services/GeoprocessingService');
const { executeGeometryOperation, loadJsts } = require('../../main/gis/workers/geoprocess.worker');
const { ProjectService } = require('../../main/gis/services/ProjectService');
const { OfflineService } = require('../../main/gis/services/OfflineService');
const { writeZipArchive } = require('../../scripts/offlineLabelTools');

describe('Desktop GIS Services (SQLite R*Tree, CRS, GeoPackage, I/O, Geoprocessing, Project, Offline)', () => {
    let tmpDir;
    let mockApp;
    let crs;
    let gpkg;
    let io;
    let projectSvc;
    let offlineSvc;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-gis-test-'));
        const userData = path.join(tmpDir, 'userData');
        fs.mkdirSync(userData, { recursive: true });
        mockApp = {
            getPath: () => userData,
            getAppPath: () => path.resolve(__dirname, '../..'),
            isPackaged: false,
        };
        crs = new CrsService();
        gpkg = new GeoPackageService({ crsService: crs });
        io = new ImportExportService({ gpkgService: gpkg, crsService: crs });
        projectSvc = new ProjectService({ app: mockApp });
        offlineSvc = new OfflineService({ app: mockApp });
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('sqliteDriver opens database with R*Tree spatial index support and transactions', () => {
        const dbPath = path.join(tmpDir, 'rtree-smoke.db');
        const db = new Database(dbPath);
        expect(['better-sqlite3', 'node:sqlite']).toContain(Database.driverName);
        db.exec('CREATE VIRTUAL TABLE test_rtree USING rtree(id, minx, maxx, miny, maxy);');
        const insertMany = db.transaction((rows) => {
            const stmt = db.prepare('INSERT INTO test_rtree VALUES (?, ?, ?, ?, ?)');
            for (const r of rows) stmt.run(...r);
        });
        insertMany([
            [1, 4.8, 4.95, 52.3, 52.4],
            [2, 13.3, 13.5, 52.4, 52.6],
        ]);
        const hits = db
            .prepare('SELECT id FROM test_rtree WHERE maxx >= ? AND minx <= ? AND maxy >= ? AND miny <= ?')
            .all(4.85, 4.9, 52.35, 52.38);
        expect(hits).toHaveLength(1);
        expect(hits[0].id).toBe(1);
        db.close();
    });

    test('CrsService accurately reprojects 2D and 3D (Z/M-preserving) geometries & bboxes', () => {
        const pt3d = { type: 'Point', coordinates: [4.9041, 52.3676, 42.75] };
        const merc = crs.transformGeometry(pt3d, 'EPSG:4326', 'EPSG:3857');
        expect(merc.coordinates[0]).toBeCloseTo(545921.9, 0);
        expect(merc.coordinates[1]).toBeCloseTo(6866867.1, 0);
        expect(merc.coordinates[2]).toBeCloseTo(42.75, 5);

        const roundTrip = crs.transformGeometry(merc, 'EPSG:3857', 'EPSG:4326');
        expect(roundTrip.coordinates[0]).toBeCloseTo(4.9041, 6);
        expect(roundTrip.coordinates[1]).toBeCloseTo(52.3676, 6);
        expect(roundTrip.coordinates[2]).toBeCloseTo(42.75, 5);

        const poly3d = {
            type: 'Polygon',
            coordinates: [
                [
                    [35.2, 31.76, 750],
                    [35.22, 31.76, 760],
                    [35.22, 31.78, 770],
                    [35.2, 31.78, 755],
                    [35.2, 31.76, 750],
                ],
            ],
        };
        const utmPoly = crs.transformGeometry(poly3d, 'EPSG:4326', 'EPSG:32636');
        const backPoly = crs.transformGeometry(utmPoly, 'EPSG:32636', 'EPSG:4326');
        expect(backPoly.coordinates[0][2][0]).toBeCloseTo(35.22, 5);
        expect(backPoly.coordinates[0][2][1]).toBeCloseTo(31.78, 5);
        expect(backPoly.coordinates[0][2][2]).toBeCloseTo(770, 5);

        const gc = {
            type: 'GeometryCollection',
            geometries: [pt3d, { type: 'LineString', coordinates: [[4.9, 52.3, 10], [5.0, 52.4, 20]] }],
        };
        const gcMerc = crs.transformGeometry(gc, 'EPSG:4326', 'EPSG:3857');
        expect(gcMerc.geometries).toHaveLength(2);
        // Also verify CRS lookup by code and free text
        const lookup4326 = crs.lookup('EPSG:4326');
        expect(lookup4326).toHaveLength(1);
        expect(lookup4326[0].code).toBe('EPSG:4326');
        const lookupUtm = crs.lookup('UTM zone 36N');
        expect(lookupUtm.some((r) => r.code === 'EPSG:32636')).toBe(true);
    });

    test('GeoPackageService executes full .gpkg lifecycle on disk and blocks SQL injection', async () => {
        // Verify SQL-injection validator guards unsafe clauses before opening database
        await expect(
            gpkg.queryFeatures(path.join(tmpDir, 'nonexistent.gpkg'), {
                layerId: 'parcels',
                where: '1=1; DROP TABLE parcels;--',
            })
        ).rejects.toThrow(/Unsafe SQL/i);
        await expect(
            gpkg.queryFeatures(path.join(tmpDir, 'nonexistent.gpkg'), {
                layerId: 'parcels',
                where: 'id = 1 UNION SELECT 1,2,3',
            })
        ).rejects.toThrow(/Unsafe SQL/i);

        // Full OGC GeoPackage round-trip on disk (works via native better-sqlite3 OR rtree-sql.js WASM)
        expect(['better-sqlite3', 'rtree-sql.js']).toContain(gpkg.adapterName);
        const gpkgPath = path.join(tmpDir, 'workspace-roundtrip.gpkg');
        await gpkg.ensureProjectGeoPackage(gpkgPath, {
            name: 'Meridian Field Survey',
            description: 'Cross-platform GeoPackage check',
            displayCrs: 'EPSG:4326',
        });
        expect(fs.existsSync(gpkgPath)).toBe(true);

        await gpkg.createVectorLayer(gpkgPath, {
            id: 'sensors',
            name: 'Sensors',
            geometryType: 'POINT',
            crs: 'EPSG:4326',
            fields: [
                { name: 'label', type: 'TEXT' },
                { name: 'elevation_m', type: 'REAL' },
            ],
        });

        const ins1 = await gpkg.insertFeature(gpkgPath, 'sensors', {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [4.9041, 52.3676] },
            properties: { label: 'Dam Square', elevation_m: 3.5 },
        });
        const ins2 = await gpkg.insertFeature(gpkgPath, 'sensors', {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [4.9003, 52.3791] },
            properties: { label: 'Centraal', elevation_m: 5.2 },
        });
        expect(ins1.id).toBeGreaterThan(0);
        expect(ins2.id).toBeGreaterThan(0);

        const layers = await gpkg.listLayers(gpkgPath);
        expect(layers.vectors.map((l) => l.id)).toContain('sensors');

        const queried = await gpkg.queryFeatures(gpkgPath, { layerId: 'sensors' });
        expect(queried.features).toHaveLength(2);
        expect(queried.features.map((f) => f.properties.label).sort()).toEqual(['Centraal', 'Dam Square']);

        await gpkg.deleteFeature(gpkgPath, 'sensors', ins1.id);
        const afterFeatureDel = await gpkg.queryFeatures(gpkgPath, { layerId: 'sensors' });
        expect(afterFeatureDel.features).toHaveLength(1);

        const delLayer = await gpkg.deleteLayer(gpkgPath, 'sensors');
        expect(delLayer.ok).toBe(true);
        const afterLayerDel = await gpkg.listLayers(gpkgPath);
        expect(afterLayerDel.vectors).toHaveLength(0);
    });

    test('ImportExportService converts CSV, KML, KMZ, and GeoJSON losslessly with XML escaping', async () => {
        const csvFc = io._csvToPointFeatureCollection(
            'name,lon,lat,elevation,notes\n"Sensor 1",4.90,52.37,12.5,"Main, North"\n"Sensor 2",4.92,52.38,8.0,"Harbor"\n',
            {}
        );
        expect(csvFc.type).toBe('FeatureCollection');
        expect(csvFc.features).toHaveLength(2);
        expect(csvFc.features[0].geometry.coordinates[0]).toBeCloseTo(4.9, 5);
        expect(csvFc.features[0].geometry.coordinates[1]).toBeCloseTo(52.37, 5);
        expect(csvFc.features[0].properties.notes).toBe('Main, North');

        // Export to KML, bundle into a real .kmz ZIP archive (pure Node.js, no Python needed), and extract back
        const kmlStr = featureCollectionToKml(csvFc, 'SensorNetwork');
        expect(kmlStr).toContain('<Placemark>');
        expect(kmlStr).toContain('Sensor 1');
        const kmzPath = path.join(tmpDir, 'sensors.kmz');
        writeZipArchive(kmzPath, [{ name: 'doc.kml', data: Buffer.from(kmlStr, 'utf8') }]);
        const extractedKml = await io._extractKmlFromKmz(kmzPath);
        expect(extractedKml).toContain('SensorNetwork');
        expect(extractedKml).toContain('4.9,52.37');

        // CSV & polygon KML escaping
        const roundCsv = featureCollectionToCsv(csvFc);
        expect(roundCsv).toContain('"Main, North"');
        expect(roundCsv).toContain('52.37');

        const polyKml = featureCollectionToKml(
            {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        properties: { name: 'Zone A & B <North>' },
                        geometry: {
                            type: 'Polygon',
                            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
                        },
                    },
                ],
            },
            'Zones'
        );
        expect(polyKml).toContain('Zone A &amp; B &lt;North&gt;');
        expect(polyKml).toContain('<Polygon>');
    });

    test('Geoprocessing worker runs real JSTS buffer, intersection, union, difference, dissolve, clip, simplify', () => {
        // Verify app.asar -> app.asar.unpacked worker script resolution
        const unpacked = resolveWorkerScript('/opt/Meridian/resources/app.asar/main/gis/services', () => true);
        expect(unpacked).toContain('app.asar.unpacked');
        expect(unpacked.endsWith('geoprocess.worker.js')).toBe(true);

        const jsts = loadJsts();
        const reader = new jsts.io.GeoJSONReader();
        const writer = new jsts.io.GeoJSONWriter();

        const gA = reader.read({
            type: 'Polygon',
            coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
        });
        const gB = reader.read({
            type: 'Polygon',
            coordinates: [[[1, 0], [3, 0], [3, 2], [1, 2], [1, 0]]],
        });
        const gC = reader.read({
            type: 'Polygon',
            coordinates: [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
        });

        // 1. Buffer: area of buffered point with r=2 approaches pi*r^2 ~= 12.56
        const bufGeom = executeGeometryOperation(
            'buffer',
            [reader.read({ type: 'Point', coordinates: [0, 0] })],
            [],
            { distance: 2 }
        );
        expect(writer.write(bufGeom).type).toBe('Polygon');
        expect(bufGeom.getArea()).toBeGreaterThan(12);
        expect(bufGeom.getArea()).toBeLessThan(12.7);

        // 2. Intersection of [0..2]x[0..2] (area 4) and [1..3]x[0..2] (area 4) = [1..2]x[0..2] (area 2)
        const interGeom = executeGeometryOperation('intersection', [gA], [gB]);
        expect(interGeom.getArea()).toBeCloseTo(2.0, 6);

        // 3. Difference (gA - gB) = [0..1]x[0..2] (area 2)
        const diffGeom = executeGeometryOperation('difference', [gA], [gB]);
        expect(diffGeom.getArea()).toBeCloseTo(2.0, 6);

        // 4. Union (gA U gB) = [0..3]x[0..2] (area 6)
        const unionGeom = executeGeometryOperation('union', [gA], [gB]);
        expect(unionGeom.getArea()).toBeCloseTo(6.0, 6);

        // 5. Dissolve (gA, gB, gC) = area 6 + 1 = 7 (MultiPolygon)
        const dissolveGeom = executeGeometryOperation('dissolve', [gA, gB, gC], []);
        expect(dissolveGeom.getArea()).toBeCloseTo(7.0, 6);
        expect(writer.write(dissolveGeom).type).toBe('MultiPolygon');

        // 6. Clip (gA + gC clipped by gB leaves only gA ∩ gB, area 2)
        const clipGeom = executeGeometryOperation('clip', [gA, gC], [gB]);
        expect(clipGeom.getArea()).toBeCloseTo(2.0, 6);

        // 7. Convex hull & centroid
        const hullGeom = executeGeometryOperation('convexhull', [gA, gB], []);
        expect(hullGeom.getArea()).toBeCloseTo(6.0, 6);
        const centroidGeo = writer.write(executeGeometryOperation('centroid', [gA], []));
        expect(centroidGeo.coordinates[0]).toBeCloseTo(1.0, 6);
        expect(centroidGeo.coordinates[1]).toBeCloseTo(1.0, 6);

        // 8. Simplify (Douglas-Peucker removes collinear jitter)
        const line = reader.read({
            type: 'LineString',
            coordinates: [[0, 0], [0.5, 0.001], [1.0, -0.001], [2, 0]],
        });
        const simpGeo = writer.write(executeGeometryOperation('simplify', [line], [], { tolerance: 0.05 }));
        expect(simpGeo.coordinates).toHaveLength(2);
    });

    test('ProjectService and OfflineService create, reopen, update, and verify offline GIS projects', async () => {
        const projDir = path.join(tmpDir, 'amsterdam-project');
        const created = await projectSvc.createProject(projDir, {
            name: 'Amsterdam Digital Twin',
            crs: 'EPSG:4326',
        });
        expect((created.metadata?.name || created.name)).toBe('Amsterdam Digital Twin');

        const reopened = await projectSvc.openProject(projDir);
        expect((reopened.metadata?.name || reopened.name)).toBe('Amsterdam Digital Twin');

        await projectSvc.saveProjectMetadata(projDir, { description: 'Updated plan' });
        const recent = await projectSvc.getRecentProjects();
        expect(Array.isArray(recent)).toBe(true);

        const status = await offlineSvc.getOfflineStatus(projDir);
        expect(status).toBeTruthy();
    });
});
