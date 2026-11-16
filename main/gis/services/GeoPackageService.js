'use strict';

const fs = require('fs');
const path = require('path');
const { GeoPackageAPI, SqljsAdapter, GeoPackageDataType } = require('@ngageoint/geopackage');
const { Db } = require('@ngageoint/geopackage/dist/lib/db/db');

let _adapterInitialized = false;
let _activeAdapterName = 'uninitialized';

/**
 * Normalize SQL parameter bindings so `undefined` becomes `null` (required by sql.js).
 */
function sanitizeSqlParams(params) {
  if (Array.isArray(params)) {
    return params.map((v) => (v === undefined ? null : v));
  }
  if (params && typeof params === 'object' && !(params instanceof Uint8Array) && !Buffer.isBuffer(params)) {
    const out = {};
    for (const [k, v] of Object.entries(params)) {
      out[k] = v === undefined ? null : v;
    }
    return out;
  }
  return params;
}

/**
 * Resolve the bundled `rtree-sql.js` WebAssembly binary path (including Electron ASAR unpack).
 */
function resolveRtreeSqlWasmPath() {
  const pkgJsonPath = require.resolve('rtree-sql.js/package.json');
  const candidate = path.join(path.dirname(pkgJsonPath), 'dist', 'sql-wasm.wasm');
  const unpacked = candidate.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  if (unpacked !== candidate && fs.existsSync(unpacked)) {
    return unpacked;
  }
  return candidate;
}

/**
 * File-persisting WebAssembly SQLite + R*Tree adapter for `@ngageoint/geopackage`.
 * Used automatically whenever native `better-sqlite3` bindings are unavailable
 * (e.g. Windows without Visual Studio Build Tools, npm blocked install scripts,
 * or Node/Electron ABI mismatch).
 */
class PersistentSqljsAdapter extends SqljsAdapter {
  async initialize() {
    if (!SqljsAdapter.SQL) {
      const initSqlJs = require('rtree-sql.js');
      const wasmBinary = fs.readFileSync(resolveRtreeSqlWasmPath());
      SqljsAdapter.SQL = await initSqlJs({ wasmBinary });
    }
    return super.initialize();
  }

  insert(sql, params) {
    return super.insert(sql, sanitizeSqlParams(params));
  }

  run(sql, params) {
    return super.run(sql, sanitizeSqlParams(params));
  }

  get(sql, params) {
    return super.get(sql, sanitizeSqlParams(params));
  }

  all(sql, params) {
    return super.all(sql, sanitizeSqlParams(params));
  }

  each(sql, params) {
    return super.each(sql, sanitizeSqlParams(params));
  }

  close() {
    if (this.db && typeof this.filePath === 'string' && !/^https?:\/\//i.test(this.filePath)) {
      const exported = this.db.export();
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, Buffer.from(exported));
    }
    super.close();
  }
}

/**
 * Probe whether `@ngageoint/geopackage`'s native `better-sqlite3` binding works
 * in the current Node/Electron process; otherwise activate `PersistentSqljsAdapter`.
 */
function ensureGeoPackageDbAdapter() {
  if (_adapterInitialized) {
    return _activeAdapterName;
  }
  _adapterInitialized = true;

  try {
    const gpkgPkg = require.resolve('@ngageoint/geopackage/package.json');
    const bs3Path = require.resolve('better-sqlite3', { paths: [path.dirname(gpkgPkg)] });
    const NativeDb = require(bs3Path);
    const probe = new NativeDb(':memory:');
    probe.close();
    _activeAdapterName = 'better-sqlite3';
  } catch (_) {
    Db.registerDbAdapter(PersistentSqljsAdapter);
    _activeAdapterName = 'rtree-sql.js';
  }

  return _activeAdapterName;
}

/**
 * Validate a user-supplied SQL `WHERE` clause against injection and stacked statements.
 */
function validateWhereClause(rawWhere) {
  const trimmed = rawWhere == null ? '' : String(rawWhere).trim();
  if (!trimmed) return null;
  if (
    trimmed.length > 512 ||
    /[;]|--|\/\*|\*\//.test(trimmed) ||
    /\b(?:DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|ATTACH|DETACH|PRAGMA|UNION|SELECT|REPLACE|VACUUM)\b/i.test(
      trimmed
    )
  ) {
    throw new Error('Unsafe SQL filter expression rejected');
  }
  return trimmed;
}

function resolveGpkgDataType(typeName) {
  const upper = String(typeName || 'TEXT').trim().toUpperCase();
  const map = {
    TEXT: GeoPackageDataType.TEXT,
    STRING: GeoPackageDataType.TEXT,
    VARCHAR: GeoPackageDataType.TEXT,
    INTEGER: GeoPackageDataType.INTEGER,
    INT: GeoPackageDataType.INTEGER,
    SMALLINT: GeoPackageDataType.SMALLINT,
    MEDIUMINT: GeoPackageDataType.MEDIUMINT,
    TINYINT: GeoPackageDataType.TINYINT,
    REAL: GeoPackageDataType.REAL,
    DOUBLE: GeoPackageDataType.DOUBLE,
    FLOAT: GeoPackageDataType.FLOAT,
    NUMBER: GeoPackageDataType.DOUBLE,
    BOOLEAN: GeoPackageDataType.BOOLEAN,
    BOOL: GeoPackageDataType.BOOLEAN,
    DATE: GeoPackageDataType.DATE,
    DATETIME: GeoPackageDataType.DATETIME,
    BLOB: GeoPackageDataType.BLOB,
  };
  return map[upper] !== undefined ? map[upper] : GeoPackageDataType.TEXT;
}

/**
 * GeoPackageService
 * Manages vector layers and GeoJSON features in OGC GeoPackage (`.gpkg`) containers,
 * with transparent native `better-sqlite3` and WebAssembly `rtree-sql.js` support.
 * Raster datasets are managed by the companion `RasterService` (GeoTIFF / COG).
 */
class GeoPackageService {
  /**
   * @param {object} deps
   * @param {import('./CrsService').CrsService} deps.crsService
   */
  constructor({ crsService }) {
    this.crsService = crsService;
    this.adapterName = ensureGeoPackageDbAdapter();
  }

  /**
   * Ensure a GeoPackage exists on disk and holds baseline project metadata.
   * @param {string} gpkgPath
   * @param {object} projectMetadata
   */
  async ensureProjectGeoPackage(gpkgPath, projectMetadata = {}) {
    ensureGeoPackageDbAdapter();
    await fs.promises.mkdir(path.dirname(gpkgPath), { recursive: true });
    const gpkg = fs.existsSync(gpkgPath)
      ? await GeoPackageAPI.open(gpkgPath)
      : await GeoPackageAPI.create(gpkgPath);
    try {
      await this._ensureSimplexMetadataTable(gpkg);
      await this._setMetadata(gpkg, 'project.name', projectMetadata?.name || '');
      await this._setMetadata(gpkg, 'project.description', projectMetadata?.description || '');
      await this._setMetadata(gpkg, 'project.displayCrs', projectMetadata?.displayCrs || 'EPSG:4326');
    } finally {
      gpkg.close();
    }
    return true;
  }

  async updateProjectMetadata(gpkgPath, metadata) {
    ensureGeoPackageDbAdapter();
    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      await this._ensureSimplexMetadataTable(gpkg);
      await this._setMetadata(gpkg, 'project.name', metadata?.name || '');
      await this._setMetadata(gpkg, 'project.description', metadata?.description || '');
      await this._setMetadata(gpkg, 'project.displayCrs', metadata?.displayCrs || 'EPSG:4326');
    } finally {
      gpkg.close();
    }
    return true;
  }

  async listLayers(gpkgPath) {
    ensureGeoPackageDbAdapter();
    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      const featureTables = gpkg.getFeatureTables() || [];
      const tileTables = gpkg.getTileTables() || [];
      return {
        vectors: featureTables.map((name) => ({ id: name, name, type: 'vector' })),
        rasters: tileTables.map((name) => ({ id: name, name, type: 'raster' })),
      };
    } finally {
      gpkg.close();
    }
  }

  /**
   * Create a new vector feature layer in the GeoPackage.
   * @param {string} gpkgPath
   * @param {object} layerDef
   */
  async createVectorLayer(gpkgPath, layerDef) {
    const id = String(layerDef?.id || layerDef?.name || '').trim();
    if (!id) throw new Error('Layer id required');
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(id)) {
      throw new Error(`Invalid layer identifier: ${id}`);
    }
    const crs = String(layerDef?.crs || 'EPSG:4326').toUpperCase();
    this.crsService.ensure(crs);

    ensureGeoPackageDbAdapter();
    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      if ((gpkg.getFeatureTables() || []).includes(id)) {
        throw new Error(`Layer already exists: ${id}`);
      }

      const geometryType = String(layerDef?.geometryType || 'GEOMETRY').toUpperCase();
      const fields = Array.isArray(layerDef?.fields) ? layerDef.fields : [];
      const properties = [];
      for (const f of fields) {
        const name = String(f?.name || '').trim();
        if (!name || name === 'id' || name === 'geometry') continue;
        const typeStr = String(f?.type || 'TEXT').trim().toUpperCase();
        resolveGpkgDataType(typeStr);
        properties.push({ name, dataType: typeStr });
      }

      await gpkg.createFeatureTableFromProperties(id, properties);
      return { id, name: layerDef?.name || id, geometryType, crs };
    } finally {
      gpkg.close();
    }
  }

  async deleteLayer(gpkgPath, layerId) {
    const id = String(layerId || '').trim();
    if (!id) throw new Error('layerId required');
    ensureGeoPackageDbAdapter();
    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      const hasFeature = (gpkg.getFeatureTables() || []).includes(id);
      const hasTile = (gpkg.getTileTables() || []).includes(id);
      if (hasFeature || hasTile) {
        if (typeof gpkg.deleteTable === 'function') {
          gpkg.deleteTable(id);
        } else if (hasFeature && typeof gpkg.deleteFeatureTable === 'function') {
          gpkg.deleteFeatureTable(id);
        } else if (hasTile && typeof gpkg.deleteTileTable === 'function') {
          gpkg.deleteTileTable(id);
        }
        return { ok: true };
      }
      return { ok: false, message: 'Layer not found' };
    } finally {
      gpkg.close();
    }
  }

  /**
   * Query features in a vector layer with pagination and validated SQL filtering.
   * @param {string} gpkgPath
   * @param {object} query
   */
  async queryFeatures(gpkgPath, query) {
    const layerId = String(query?.layerId || '').trim();
    if (!layerId) throw new Error('query.layerId required');
    const limit = Math.max(1, Math.min(5000, Number(query?.limit || 500)));
    const offset = Math.max(0, Number(query?.offset || 0));

    // Reject unsafe SQL clauses before touching disk
    const where = validateWhereClause(query?.where);
    const whereArgs = where && Array.isArray(query?.whereArgs) ? query.whereArgs : undefined;

    if (!fs.existsSync(gpkgPath)) {
      throw new Error(`GeoPackage file not found: ${gpkgPath}`);
    }

    ensureGeoPackageDbAdapter();
    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      const featureDao = gpkg.getFeatureDao(layerId);
      const rows = [];

      if (!where && typeof gpkg.queryForGeoJSONFeaturesInTable === 'function') {
        const all = gpkg.queryForGeoJSONFeaturesInTable(layerId) || [];
        const sliced = all.slice(offset, offset + limit);
        return { features: sliced, limit, offset, count: sliced.length };
      }

      const iter = where
        ? featureDao.queryForEach(where, whereArgs)
        : featureDao.queryForEach();

      let idx = 0;
      for (const rawRow of iter) {
        if (idx++ < offset) continue;
        if (rows.length >= limit) break;
        const featureRow = typeof featureDao.getRow === 'function' ? featureDao.getRow(rawRow) : rawRow;
        const geojson = GeoPackageAPI.parseFeatureRowIntoGeoJSON(featureRow, featureDao.srs);
        rows.push(geojson);
      }

      return { features: rows, limit, offset, count: rows.length };
    } finally {
      gpkg.close();
    }
  }

  async insertFeature(gpkgPath, layerId, feature) {
    ensureGeoPackageDbAdapter();
    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      const normalized =
        feature?.type === 'Feature'
          ? feature
          : { type: 'Feature', geometry: feature?.geometry || feature, properties: feature?.properties || {} };
      const id = gpkg.addGeoJSONFeatureToGeoPackage(normalized, layerId);
      return { id };
    } finally {
      gpkg.close();
    }
  }

  async updateFeature(gpkgPath, layerId, featureId, patch) {
    ensureGeoPackageDbAdapter();
    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      const featureDao = gpkg.getFeatureDao(layerId);
      const row = featureDao.queryForId(featureId);
      if (!row) throw new Error('Feature not found');
      if (patch?.properties) {
        for (const [k, v] of Object.entries(patch.properties)) {
          if (k === 'id') continue;
          try {
            row.setValueWithColumnName(k, v);
          } catch (_) {
            // Ignore unknown columns
          }
        }
      }
      if (patch?.geometry) {
        const { GeometryData } = require('@ngageoint/geopackage');
        const geomData = GeometryData.fromGeoJSON(patch.geometry, featureDao.srs?.srs_id || 4326);
        row.geometry = geomData;
      }
      featureDao.update(row);
      return { ok: true };
    } finally {
      gpkg.close();
    }
  }

  async deleteFeature(gpkgPath, layerId, featureId) {
    ensureGeoPackageDbAdapter();
    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      const featureDao = gpkg.getFeatureDao(layerId);
      featureDao.deleteById(featureId);
      return { ok: true };
    } finally {
      gpkg.close();
    }
  }

  async _ensureSimplexMetadataTable(gpkg) {
    gpkg.connection.run(
      'CREATE TABLE IF NOT EXISTS simplex_metadata (key TEXT PRIMARY KEY, value TEXT)'
    );
  }

  async _setMetadata(gpkg, key, value) {
    gpkg.connection.run(
      'INSERT OR REPLACE INTO simplex_metadata (key, value) VALUES (?, ?)',
      [String(key), String(value ?? '')]
    );
  }
}

module.exports = {
  GeoPackageService,
  ensureGeoPackageDbAdapter,
  validateWhereClause,
};
