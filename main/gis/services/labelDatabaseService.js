'use strict';

/**
 * Main-process SQLite label store (viewport R*Tree queries, offline place search,
 * world-base + regional `.rlp` SQLite databases).
 */

const Database = require('./sqliteDriver');
const path = require('path');
const fs = require('fs');

const REGION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Validate a label region identifier to prevent directory traversal and invalid filenames.
 * @param {string} regionId
 * @returns {string}
 */
function validateRegionId(regionId) {
  if (typeof regionId !== 'string') {
    throw new Error('Region id must be a non-empty string');
  }
  const trimmed = regionId.trim();
  if (!REGION_ID_RE.test(trimmed) || trimmed.includes('..') || trimmed === 'world-base') {
    throw new Error(`Invalid region id: "${regionId}"`);
  }
  return trimmed;
}

class LabelDatabaseService {
  constructor() {
    this.dbs = new Map();
    this._stmtCache = new Map();
    this._app = null;
    this.dataDir = '';
    this.regionsDir = '';
    this.worldBasePath = null;
  }

  /**
   * @param {import('electron').App} app
   */
  configure(app) {
    this._app = app;
    this.dataDir = path.join(app.getPath('userData'), 'label-data');
    this.regionsDir = path.join(this.dataDir, 'regions');
    fs.mkdirSync(this.regionsDir, { recursive: true });
  }

  unloadWorldBase() {
    const db = this.dbs.get('world-base');
    if (db) {
      try {
        db.close();
      } catch (_) {
        /* ignore */
      }
      this.dbs.delete('world-base');
      this.worldBasePath = null;
      for (const k of [...this._stmtCache.keys()]) {
        if (k.startsWith('world-base::')) this._stmtCache.delete(k);
      }
    }
  }

  reloadWorldBase() {
    this.unloadWorldBase();
    this.loadWorldBase();
  }

  _worldBaseCandidates() {
    const app = this._app;
    const appPath = app && typeof app.getAppPath === 'function' ? app.getAppPath() : '';
    const resourcesDir = process.resourcesPath || (appPath ? path.dirname(appPath) : '');
    const installDir = resourcesDir ? path.dirname(resourcesDir) : '';
    return [
      this.dataDir ? path.join(this.dataDir, 'labels-world-base.db') : '',
      installDir ? path.join(installDir, 'data', 'labels-world-base.db') : '',
      resourcesDir ? path.join(resourcesDir, 'data', 'labels-world-base.db') : '',
      appPath ? path.join(path.dirname(appPath), 'data', 'labels-world-base.db') : '',
      appPath ? path.join(appPath, 'data', 'labels-world-base.db') : '',
      path.join(__dirname, '..', '..', '..', 'data', 'labels-world-base.db'),
    ].filter(Boolean);
  }

  loadWorldBase() {
    if (!this._app) return false;
    if (this.dbs.has('world-base')) return true;

    const dbPath = this._worldBaseCandidates().find((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isFile();
      } catch (_) {
        return false;
      }
    });
    if (!dbPath) {
      return false;
    }

    try {
      this._openDb('world-base', dbPath, true);
      this.worldBasePath = dbPath;
      return true;
    } catch (err) {
      console.warn('[LabelDatabaseService] Failed to open world-base DB:', err.message);
      return false;
    }
  }

  /**
   * @param {string} regionId
   */
  loadRegion(regionId) {
    if (!this._app) return;
    const safeId = validateRegionId(regionId);
    if (this.dbs.has(safeId)) return;
    const p = path.join(this.regionsDir, `${safeId}.db`);
    if (!fs.existsSync(p)) throw new Error(`Region not installed: ${safeId}`);
    this._openDb(safeId, p, true);
  }

  /**
   * @param {string} regionId
   */
  reloadRegion(regionId) {
    const safeId = validateRegionId(regionId);
    this.unloadRegion(safeId);
    const p = path.join(this.regionsDir, `${safeId}.db`);
    if (fs.existsSync(p)) {
      this._openDb(safeId, p, true);
    }
  }

  /**
   * @param {string} regionId
   */
  unloadRegion(regionId) {
    let safeId;
    try {
      safeId = validateRegionId(regionId);
    } catch (_) {
      return;
    }
    const db = this.dbs.get(safeId);
    if (db) {
      try {
        db.close();
      } catch (_) {
        /* ignore */
      }
      this.dbs.delete(safeId);
      for (const k of [...this._stmtCache.keys()]) {
        if (k.startsWith(`${safeId}::`)) this._stmtCache.delete(k);
      }
    }
  }

  closeAll() {
    for (const db of this.dbs.values()) {
      try {
        db.close();
      } catch (_) {
        /* ignore */
      }
    }
    this.dbs.clear();
    this._stmtCache.clear();
    this.worldBasePath = null;
  }

  /**
   * Query visible map labels inside a viewport bounding box (supports antimeridian split).
   * @param {{ west:number, east:number, south:number, north:number, zoom:number }} viewport
   * @param {string[]} [activeRegions]
   * @param {{ types?: string[], maxResults?: number }} [opts]
   */
  queryViewport(viewport, activeRegions = [], opts = {}) {
    if (!viewport || typeof viewport !== 'object') return [];
    const west = Number(viewport.west);
    const east = Number(viewport.east);
    const south = Number(viewport.south);
    const north = Number(viewport.north);
    const zoom = Number(viewport.zoom);
    if (![west, east, south, north, zoom].every(Number.isFinite) || south > north) {
      return [];
    }

    // Explicit empty types array means the user disabled all label categories
    if (Array.isArray(opts.types) && opts.types.length === 0) {
      return [];
    }

    const maxResults = Math.max(1, Math.min(5000, Math.floor(Number(opts.maxResults ?? 600) || 600)));
    const validTypes = Array.isArray(opts.types)
      ? opts.types.filter((t) => typeof t === 'string' && t.length > 0 && t.length <= 32)
      : null;
    if (validTypes && validTypes.length === 0) {
      return [];
    }

    const typeFilter = validTypes ? `AND l.type IN (${validTypes.map(() => '?').join(',')})` : '';
    const SQL = `
      SELECT l.id, l.name, l.name_en, l.name_ar, l.name_local,
             l.type, l.subtype, l.priority, l.lon, l.lat
      FROM   labels l
      JOIN   labels_rtree r ON l.id = r.id
      WHERE  r.bbox_west  <= ? AND r.bbox_east  >= ?
        AND  r.bbox_south <= ? AND r.bbox_north >= ?
        AND  l.zoom_min   <= ? AND l.zoom_max   >= ?
        ${typeFilter}
      ORDER  BY l.priority DESC
      LIMIT  ?
    `;

    // Antimeridian split: e.g. west=170, east=-170 -> [170, 180] and [-180, -170]
    const lonSpans =
      west <= east
        ? [[west, east]]
        : [
            [west, 180],
            [-180, east],
          ];

    // Prefer detailed region packs first, then world-base for coverage gaps
    const safeRegions = [];
    if (Array.isArray(activeRegions)) {
      for (const r of activeRegions) {
        try {
          safeRegions.push(validateRegionId(r));
        } catch (_) {
          /* ignore invalid id */
        }
      }
    }
    const dbIds = [...new Set([...safeRegions, 'world-base'])];

    const seenDbRow = new Set();
    const seenFeature = new Set();
    const results = [];

    for (const dbId of dbIds) {
      if (!this.dbs.has(dbId)) continue;
      let stmt;
      try {
        stmt = this._getStmt(dbId, SQL);
      } catch (err) {
        console.warn(`[LabelDatabaseService] prepare failed for "${dbId}":`, err.message);
        continue;
      }

      for (const [spanWest, spanEast] of lonSpans) {
        try {
          const params = [
            spanEast,
            spanWest,
            north,
            south,
            zoom,
            zoom,
            ...(validTypes || []),
            maxResults,
          ];
          const rows = stmt.all(...params);
          for (const row of rows) {
            const dbRowKey = `${dbId}:${row.id}`;
            if (seenDbRow.has(dbRowKey)) continue;
            seenDbRow.add(dbRowKey);

            // Deduplicate identical place across world-base and overlapping region packs
            // without colliding on unrelated auto-increment row IDs
            const spatialKey = `${row.type}|${String(row.name || '').toLowerCase()}|${Math.round(
              Number(row.lon) * 1e4
            )}|${Math.round(Number(row.lat) * 1e4)}`;
            if (seenFeature.has(spatialKey)) continue;
            seenFeature.add(spatialKey);
            results.push(row);
          }
        } catch (err) {
          console.warn(`[LabelDatabaseService] query failed for "${dbId}":`, err.message);
        }
      }
    }

    results.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return results.slice(0, maxResults);
  }

  /**
   * Offline multilingual search across loaded world-base and active region databases.
   * @param {string} query
   * @param {{ activeRegions?: string[], types?: string[], limit?: number }} [opts]
   */
  searchLabels(query, opts = {}) {
    if (typeof query !== 'string') return [];
    const trimmed = query.trim();
    if (!trimmed) return [];

    const limit = Math.max(1, Math.min(200, Math.floor(Number(opts.limit ?? 25) || 25)));
    const validTypes =
      Array.isArray(opts.types) && opts.types.length > 0
        ? opts.types.filter((t) => typeof t === 'string' && t.length > 0 && t.length <= 32)
        : null;
    if (Array.isArray(opts.types) && opts.types.length === 0) return [];

    const escaped = trimmed.replace(/[\\%_]/g, '\\$&');
    const prefixPattern = `${escaped}%`;
    const containsPattern = `%${escaped}%`;
    const typeFilter = validTypes ? `AND l.type IN (${validTypes.map(() => '?').join(',')})` : '';

    const SQL = `
      SELECT l.id, l.name, l.name_en, l.name_ar, l.name_local,
             l.type, l.subtype, l.priority, l.zoom_min, l.zoom_max, l.lon, l.lat,
             CASE
               WHEN lower(l.name) = lower(?) OR lower(l.name_en) = lower(?) OR l.name_ar = ? THEN 2
               WHEN l.name LIKE ? ESCAPE '\\' OR l.name_en LIKE ? ESCAPE '\\' OR l.name_ar LIKE ? ESCAPE '\\' THEN 1
               ELSE 0
             END AS match_rank
      FROM   labels l
      WHERE  (l.name LIKE ? ESCAPE '\\' OR l.name_en LIKE ? ESCAPE '\\' OR l.name_ar LIKE ? ESCAPE '\\')
        ${typeFilter}
      ORDER  BY match_rank DESC, l.priority DESC
      LIMIT  ?
    `;

    const params = [
      trimmed,
      trimmed,
      trimmed,
      prefixPattern,
      prefixPattern,
      prefixPattern,
      containsPattern,
      containsPattern,
      containsPattern,
      ...(validTypes || []),
      limit,
    ];

    const dbIds = Array.isArray(opts.activeRegions)
      ? [
          ...new Set([
            ...opts.activeRegions.filter((r) => {
              try {
                validateRegionId(r);
                return true;
              } catch (_) {
                return false;
              }
            }),
            'world-base',
          ]),
        ]
      : [...this.dbs.keys()];

    const seen = new Set();
    const out = [];
    for (const dbId of dbIds) {
      if (!this.dbs.has(dbId)) continue;
      try {
        const stmt = this._getStmt(dbId, SQL);
        const rows = stmt.all(...params);
        for (const row of rows) {
          const key = `${row.type}|${String(row.name || '').toLowerCase()}|${Math.round(
            Number(row.lon) * 1e4
          )}|${Math.round(Number(row.lat) * 1e4)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ ...row, regionId: dbId });
        }
      } catch (err) {
        console.warn(`[LabelDatabaseService] search failed for "${dbId}":`, err.message);
      }
    }

    out.sort((a, b) => (b.match_rank - a.match_rank) || ((b.priority || 0) - (a.priority || 0)));
    return out.slice(0, limit).map(({ match_rank: _mr, ...rest }) => rest);
  }

  /**
   * @param {string} id
   * @param {string} filePath
   * @param {boolean} readonly
   */
  _openDb(id, filePath, readonly = true) {
    const db = new Database(filePath, { readonly, fileMustExist: true });
    if (!readonly) {
      try {
        db.pragma('journal_mode = WAL');
      } catch (_) {
        /* ignore */
      }
    }
    try {
      db.pragma('cache_size = -32000');
      db.pragma('temp_store = MEMORY');
    } catch (_) {
      /* ignore */
    }
    this.dbs.set(id, db);
  }

  /**
   * @param {string} dbId
   * @param {string} sql
   */
  _getStmt(dbId, sql) {
    const key = `${dbId}::${sql}`;
    if (!this._stmtCache.has(key)) {
      const database = this.dbs.get(dbId);
      if (!database) throw new Error(`No DB for ${dbId}`);
      this._stmtCache.set(key, database.prepare(sql));
    }
    return this._stmtCache.get(key);
  }
}

const instance = new LabelDatabaseService();
instance.LabelDatabaseService = LabelDatabaseService;
instance.validateRegionId = validateRegionId;

module.exports = instance;
