'use strict';

/**
 * Main-process SQLite label store (viewport queries, optional world-base + region DBs).
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class LabelDatabaseService {
  constructor() {
    /** @type {Map<string, import('better-sqlite3').Database>} */
    this.dbs = new Map();
    this._stmtCache = new Map();
    this._app = null;
    this.dataDir = '';
    this.regionsDir = '';
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

  /**
   * Close the world-base DB so it can be replaced or reloaded.
   */
  unloadWorldBase() {
    const db = this.dbs.get('world-base');
    if (db) {
      try {
        db.close();
      } catch (_) {
        /* ignore */
      }
      this.dbs.delete('world-base');
      for (const k of [...this._stmtCache.keys()]) {
        if (k.startsWith('world-base::')) this._stmtCache.delete(k);
      }
    }
  }

  reloadWorldBase() {
    this.unloadWorldBase();
    this.loadWorldBase();
  }

  loadWorldBase() {
    if (!this._app) return;
    if (this.dbs.has('world-base')) return;

    const app = this._app;
    const userBase = path.join(this.dataDir, 'labels-world-base.db');
    const candidates = [
      userBase,
      path.join(process.resourcesPath || '', 'data', 'labels-world-base.db'),
      path.join(path.dirname(app.getAppPath()), 'data', 'labels-world-base.db'),
      path.join(app.getAppPath(), 'data', 'labels-world-base.db'),
      path.join(__dirname, '..', '..', '..', 'data', 'labels-world-base.db'),
    ];

    const dbPath = candidates.find((p) => p && fs.existsSync(p));
    if (!dbPath) {
      console.warn('[LabelDatabaseService] world-base not found — use region packs or place data/labels-world-base.db');
      return;
    }

    this._openDb('world-base', dbPath, true);
    console.log('[LabelDatabaseService] world-base loaded:', dbPath);
  }

  /**
   * @param {string} regionId
   */
  loadRegion(regionId) {
    if (!this._app) return;
    if (this.dbs.has(regionId)) return;
    const p = path.join(this.regionsDir, `${regionId}.db`);
    if (!fs.existsSync(p)) throw new Error(`Region not installed: ${regionId}`);
    this._openDb(regionId, p, true);
  }

  /**
   * @param {string} regionId
   */
  unloadRegion(regionId) {
    const db = this.dbs.get(regionId);
    if (db) {
      try {
        db.close();
      } catch (_) {
        /* ignore */
      }
      this.dbs.delete(regionId);
      for (const k of this._stmtCache.keys()) {
        if (k.startsWith(`${regionId}::`)) this._stmtCache.delete(k);
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
  }

  /**
   * @param {{ west:number, east:number, south:number, north:number, zoom:number }} viewport
   * @param {string[]} activeRegions
   * @param {{ types?: string[], maxResults?: number }} opts
   */
  queryViewport(viewport, activeRegions = [], opts = {}) {
    const { west, east, south, north, zoom } = viewport;
    const maxResults = opts.maxResults ?? 600;
    const typeFilter = opts.types?.length
      ? `AND l.type IN (${opts.types.map(() => '?').join(',')})`
      : '';

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

    const params = [east, west, north, south, zoom, zoom, ...(opts.types ?? []), maxResults];

    const seen = new Set();
    const results = [];

    const dbIds = ['world-base', ...(activeRegions ?? [])];
    for (const id of dbIds) {
      if (!this.dbs.has(id)) continue;
      try {
        const stmt = this._getStmt(id, SQL);
        const rows = stmt.all(...params);
        for (const row of rows) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            results.push(row);
          }
        }
      } catch (err) {
        console.warn(`[LabelDatabaseService] query failed for "${id}":`, err.message);
      }
    }

    results.sort((a, b) => b.priority - a.priority);
    return results.slice(0, maxResults);
  }

  /**
   * @param {string} id
   * @param {string} filePath
   * @param {boolean} readonly
   */
  _openDb(id, filePath, readonly = true) {
    const db = new Database(filePath, { readonly, fileMustExist: true });
    try {
      db.pragma('journal_mode = WAL');
    } catch (_) {
      /* readonly / some mounts may reject */
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

module.exports = new LabelDatabaseService();
