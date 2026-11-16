'use strict';

/**
 * HTTP REST gateway for offline GIS, SQLite world/regional labels, CRS projection,
 * JSTS geoprocessing, and offline map readiness (`server/gisApiRoutes.js`).
 *
 * Complements Electron IPC (`main/gis/registerGisIpc.js`) so SimplexDM operates
 * identically in standalone browser/server mode (`npm start`) and in Electron.
 * All paths use validated inputs and real SQLite/JSTS/proj4 services — never mocks.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('../main/gis/services/sqliteDriver');
const labelDb = require('../main/gis/services/labelDatabaseService');
const labelImporter = require('../main/gis/services/labelRegionImporter');
const { CrsService } = require('../main/gis/services/CrsService');
const { executeGeometryOperation, loadJsts } = require('../main/gis/workers/geoprocess.worker');

function extractGeoJsonGeometries(reader, input) {
    if (!input || typeof input !== 'object') return [];
    if (input.type === 'FeatureCollection' && Array.isArray(input.features)) {
        return input.features
            .map((f) => (f?.geometry ? reader.read(f.geometry) : null))
            .filter(Boolean);
    }
    if (input.type === 'Feature' && input.geometry) {
        return [reader.read(input.geometry)];
    }
    if (input.type && (input.coordinates || input.geometries)) {
        return [reader.read(input)];
    }
    return [];
}

const MAX_BODY_BYTES = 2_000_000;

function sendJson(res, status, payload, cors) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...cors,
    });
    res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let failed = false;
        req.on('data', (chunk) => {
            if (failed) return;
            total += chunk.length;
            if (total > maxBytes) {
                failed = true;
                req.destroy();
                const err = new Error('Payload too large');
                err.statusCode = 413;
                reject(err);
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (failed) return;
            const raw = Buffer.concat(chunks).toString('utf8').trim();
            if (!raw) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(raw));
            } catch (err) {
                err.statusCode = 400;
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

/** Inspect numeric zoom subdirectories inside a tile pyramid folder. */
function inspectTileFolder(dirPath, extensions) {
    const result = {
        available: false,
        zoomLevels: [],
        sampleTileCount: 0,
        hasMeta: false,
    };
    if (!dirPath || !fs.existsSync(dirPath)) return result;
    try {
        const metaPath = path.join(path.dirname(dirPath), 'meta.json');
        result.hasMeta = fs.existsSync(metaPath);
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const zooms = [];
        let tiles = 0;
        for (const e of entries) {
            if (e.isDirectory() && /^\d+$/.test(e.name)) {
                const z = parseInt(e.name, 10);
                if (z >= 0 && z <= 24) {
                    const zDir = path.join(dirPath, e.name);
                    const xDirs = fs.readdirSync(zDir, { withFileTypes: true }).slice(0, 12);
                    let zHasTile = false;
                    for (const xd of xDirs) {
                        if (!xd.isDirectory()) continue;
                        const yFiles = fs.readdirSync(path.join(zDir, xd.name)).slice(0, 20);
                        const matching = yFiles.filter((f) =>
                            extensions.some((ext) => f.toLowerCase().endsWith(ext))
                        );
                        if (matching.length > 0) {
                            zHasTile = true;
                            tiles += matching.length;
                        }
                    }
                    if (zHasTile) zooms.push(z);
                }
            }
        }
        zooms.sort((a, b) => a - b);
        result.zoomLevels = zooms;
        result.sampleTileCount = tiles;
        result.available = zooms.length > 0;
    } catch (_) {
        /* ignore permission or IO errors */
    }
    return result;
}

/** Count rows in a world-base SQLite database safely. */
function inspectWorldBaseDb(dbPath) {
    if (!dbPath || !fs.existsSync(dbPath)) {
        return { present: false, labelCount: 0, sizeBytes: 0, languages: [] };
    }
    let db = null;
    try {
        const stats = fs.statSync(dbPath);
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
        const row = db.prepare('SELECT COUNT(*) AS c FROM labels').get();
        return {
            present: true,
            labelCount: Number(row?.c) || 0,
            sizeBytes: stats.size,
            languages: ['native', 'en', 'ar'],
        };
    } catch (_) {
        return { present: false, labelCount: 0, sizeBytes: 0, languages: [] };
    } finally {
        try {
            db?.close();
        } catch (_) {
            /* ignore */
        }
    }
}

/**
 * Create a self-contained GIS API handler bound to `appPath` and `dataDir`.
 */
function createGisApiHandler({ appPath, dataDir }) {
    const crsService = new CrsService();
    let labelsReady = false;
    let sessionUserDataDir = null;

    function ensureLabelService() {
        if (labelsReady && labelDb._app) {
            if (!labelDb.worldDb) {
                labelDb.loadWorldBase();
            }
            return;
        }
        // Only self-configure when Electron main hasn't already configured labelDb
        if (!labelDb._app) {
            sessionUserDataDir = path.join(os.tmpdir(), 'simplexdm-web-userdata');
            fs.mkdirSync(sessionUserDataDir, { recursive: true });
            const standaloneApp = {
                isPackaged: false,
                getAppPath: () => appPath,
                getPath: (name) => {
                    if (name === 'userData') return sessionUserDataDir;
                    return os.tmpdir();
                },
            };
            labelDb.configure(standaloneApp);
            labelImporter.configure(standaloneApp);
        }
        labelDb.loadWorldBase();
        // Also mount any already-installed regional packs
        try {
            const installed = labelImporter.listInstalled();
            for (const reg of installed) {
                if (reg?.id && reg.enabled !== false) {
                    try {
                        labelDb.loadRegion(reg.id);
                    } catch (_) {
                        /* ignore */
                    }
                }
            }
        } catch (_) {
            /* ignore */
        }
        labelsReady = true;
    }

    return async function handleGisApi(req, res, urlObj, rawPathname, cors) {
        try {
            // ── Offline Maps, Labels & Sample Dataset Readiness ──
            if (rawPathname === '/api/offline-maps/status' && req.method === 'GET') {
                const baseDbPath = path.join(dataDir, 'labels-world-base.db');
                const sampleTileset = path.join(dataDir, 'samples', 'meridian-campus', 'tileset.json');
                const sampleRlp = path.join(dataDir, 'samples', 'amsterdam-labels.rlp');
                const rasterTiles = inspectTileFolder(path.join(dataDir, 'tiles', 'raster'), ['.png', '.jpg', '.jpeg', '.webp']);
                const vectorTiles = inspectTileFolder(path.join(dataDir, 'tiles', 'vector'), ['.pbf', '.mvt']);
                const proTiles = inspectTileFolder(path.join(dataDir, 'pro', 'raster'), ['.png', '.jpg', '.jpeg', '.webp']);
                const labelsInfo = inspectWorldBaseDb(baseDbPath);

                let installedRegions = [];
                try {
                    ensureLabelService();
                    installedRegions = labelImporter.listInstalled();
                } catch (_) {
                    installedRegions = [];
                }

                sendJson(
                    res,
                    200,
                    {
                        ok: true,
                        raster: rasterTiles,
                        vector: vectorTiles,
                        aerial: proTiles,
                        onlineFallback: true,
                        labels: {
                            ...labelsInfo,
                            installedRegions: installedRegions.length,
                            samplePackAvailable: fs.existsSync(sampleRlp),
                        },
                        samples: {
                            meridianCampus: {
                                available: fs.existsSync(sampleTileset),
                                url: 'data/samples/meridian-campus/tileset.json',
                                name: 'Meridian Survey Campus (Amsterdam)',
                                formats: ['b3dm', 'i3dm', 'pnts', 'cmpt'],
                                location: { lon: 4.9041, lat: 52.3676, height: 0 },
                            },
                            amsterdamLabelPack: {
                                available: fs.existsSync(sampleRlp),
                                regionId: 'nl-amsterdam-metro',
                                name: 'Amsterdam Metropolitan Detail Pack',
                            },
                        },
                    },
                    cors
                );
                return true;
            }

            // ── Offline SQLite Labels: Installed Regions & World Base ──
            if (rawPathname === '/api/gis/labels/regions' && req.method === 'GET') {
                ensureLabelService();
                const baseDbPath = path.join(dataDir, 'labels-world-base.db');
                const sampleRlp = path.join(dataDir, 'samples', 'amsterdam-labels.rlp');
                sendJson(
                    res,
                    200,
                    {
                        ok: true,
                        worldBase: inspectWorldBaseDb(baseDbPath),
                        installed: labelImporter.listInstalled(),
                        samplePackAvailable: fs.existsSync(sampleRlp),
                    },
                    cors
                );
                return true;
            }

            // ── Offline SQLite Labels: Viewport R*Tree Query ──
            if (
                rawPathname === '/api/gis/labels/query' &&
                (req.method === 'GET' || req.method === 'POST')
            ) {
                ensureLabelService();
                let viewport;
                let activeRegions = [];
                let opts = {};

                if (req.method === 'POST') {
                    const body = await readJsonBody(req);
                    viewport = body.viewport || body;
                    activeRegions = Array.isArray(body.activeRegions) ? body.activeRegions : [];
                    opts = body.opts && typeof body.opts === 'object' ? body.opts : {};
                } else {
                    const sp = urlObj.searchParams;
                    viewport = {
                        west: Number(sp.get('west')),
                        south: Number(sp.get('south')),
                        east: Number(sp.get('east')),
                        north: Number(sp.get('north')),
                        zoom: Number(sp.get('zoom')),
                    };
                    const typesParam = sp.get('types');
                    if (typesParam !== null) {
                        opts.types = typesParam
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean);
                    }
                    const regionsParam = sp.get('regions');
                    if (regionsParam) {
                        activeRegions = regionsParam
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean);
                    }
                    if (sp.has('maxResults')) {
                        const mr = parseInt(sp.get('maxResults'), 10);
                        if (Number.isFinite(mr) && mr > 0) opts.maxResults = Math.min(mr, 1000);
                    }
                }

                // Auto-include installed regional packs if caller didn't restrict
                if (activeRegions.length === 0) {
                    try {
                        activeRegions = labelImporter
                            .listInstalled()
                            .filter((r) => r.enabled !== false)
                            .map((r) => r.id)
                            .filter(Boolean);
                        for (const id of activeRegions) {
                            try {
                                labelDb.loadRegion(id);
                            } catch (_) {
                                /* ignore */
                            }
                        }
                    } catch (_) {
                        /* ignore */
                    }
                } else {
                    for (const id of activeRegions) {
                        try {
                            labelDb.loadRegion(id);
                        } catch (_) {
                            /* ignore */
                        }
                    }
                }

                const labels = labelDb.queryViewport(viewport, activeRegions, opts);
                sendJson(res, 200, labels, cors);
                return true;
            }

            // ── Offline SQLite Labels: Place Name Search (native / EN / AR) ──
            if (rawPathname === '/api/gis/labels/search' && req.method === 'GET') {
                ensureLabelService();
                const q = String(urlObj.searchParams.get('q') || '').trim();
                const limitRaw = parseInt(urlObj.searchParams.get('limit') || '25', 10);
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 25;
                if (!q) {
                    sendJson(res, 200, [], cors);
                    return true;
                }
                const activeRegions = labelImporter
                    .listInstalled()
                    .filter((r) => r.enabled !== false)
                    .map((r) => r.id)
                    .filter(Boolean);
                const matches = labelDb.searchLabels(q, { maxResults: limit, activeRegions });
                sendJson(res, 200, matches, cors);
                return true;
            }

            // ── Offline SQLite Labels: Import Bundled Sample .rlp Pack ──
            if (rawPathname === '/api/gis/labels/import-sample' && req.method === 'POST') {
                ensureLabelService();
                const sampleRlp = path.join(dataDir, 'samples', 'amsterdam-labels.rlp');
                if (!fs.existsSync(sampleRlp)) {
                    sendJson(res, 404, { ok: false, error: 'Sample .rlp pack not found' }, cors);
                    return true;
                }
                const meta = await labelImporter.importPack(sampleRlp);
                labelDb.reloadRegion(meta.id);
                sendJson(res, 200, { ok: true, meta }, cors);
                return true;
            }

            // ── Offline SQLite Labels: Remove Installed Region ──
            if (rawPathname === '/api/gis/labels/remove-region' && req.method === 'POST') {
                ensureLabelService();
                const body = await readJsonBody(req);
                const regionId = String(body.regionId || '').trim();
                if (!regionId) {
                    sendJson(res, 400, { ok: false, error: 'regionId is required' }, cors);
                    return true;
                }
                labelDb.unloadRegion(regionId);
                labelImporter.remove(regionId);
                sendJson(res, 200, { ok: true, regionId }, cors);
                return true;
            }

            // ── CRS Search & Coordinate/GeoJSON Projection ──
            if (rawPathname === '/api/gis/crs/search' && req.method === 'GET') {
                const q = String(urlObj.searchParams.get('q') || '').trim();
                const limitRaw = parseInt(urlObj.searchParams.get('limit') || '25', 10);
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 25;
                const items = crsService.lookup(q).slice(0, limit);
                sendJson(res, 200, { ok: true, items }, cors);
                return true;
            }

            if (rawPathname === '/api/gis/crs/transform' && req.method === 'POST') {
                const body = await readJsonBody(req);
                if (body.geojson) {
                    const projected = crsService.reprojectGeoJSON(body.geojson, body.from, body.to);
                    sendJson(res, 200, { ok: true, geojson: projected }, cors);
                } else {
                    const out = crsService.transform({
                        from: body.from || 'EPSG:4326',
                        to: body.to || 'EPSG:3857',
                        coords: body.coords,
                    });
                    sendJson(res, 200, { ok: true, ...out }, cors);
                }
                return true;
            }

            // ── JSTS Vector Geoprocessing ──
            if (rawPathname === '/api/gis/geoprocess' && req.method === 'POST') {
                const body = await readJsonBody(req);
                const op = String(body.op || body.operation || '').trim();
                if (!op) {
                    sendJson(res, 400, { ok: false, error: 'Missing geometry operation (op)' }, cors);
                    return true;
                }
                const params = body.params && typeof body.params === 'object' ? body.params : body;
                const jsts = loadJsts();
                const reader = new jsts.io.GeoJSONReader();
                const writer = new jsts.io.GeoJSONWriter();
                const primaryGeoms = extractGeoJsonGeometries(
                    reader,
                    params.geojson || params.feature || params.primary
                );
                const overlayGeoms = extractGeoJsonGeometries(
                    reader,
                    params.overlay || params.clip || params.secondary
                );
                const outGeom = executeGeometryOperation(op, primaryGeoms, overlayGeoms, params);
                const result = {
                    type: 'Feature',
                    properties: { operation: op },
                    geometry: writer.write(outGeom),
                };
                sendJson(res, 200, { ok: true, result }, cors);
                return true;
            }

            return false;
        } catch (err) {
            const status = Number.isInteger(err?.statusCode) ? err.statusCode : 400;
            sendJson(
                res,
                status,
                { ok: false, error: err?.message || 'GIS request failed' },
                cors
            );
            return true;
        }
    };
}

module.exports = { createGisApiHandler };
