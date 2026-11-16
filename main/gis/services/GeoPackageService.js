const fs = require('fs');
const path = require('path');
const { GeoPackageAPI } = require('@ngageoint/geopackage');

/**
 * GeoPackageService
 * Uses @ngageoint/geopackage to manage vector layers and features in OGC GeoPackage containers.
 * Raster datasets are managed by the companion RasterService (GeoTIFF / COG).
 */
class GeoPackageService {
  /**
   * @param {object} deps
   * @param {import('./CrsService').CrsService} deps.crsService
   */
  constructor({ crsService }) {
    this.crsService = crsService;
  }

  /**
   * Ensure a GeoPackage exists and has minimal metadata.
   * @param {string} gpkgPath
   * @param {object} projectMetadata
   */
  async ensureProjectGeoPackage(gpkgPath, projectMetadata = {}) {
    await fs.promises.mkdir(path.dirname(gpkgPath), { recursive: true });
    const exists = fs.existsSync(gpkgPath);
    if (!exists) {
      await GeoPackageAPI.create(gpkgPath);
    }
    // Open once to ensure it is valid.
    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      // Store project-level metadata in gpkg metadata tables (non-standard, safe).
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
   * Create a new vector layer (feature table).
   * @param {string} gpkgPath
   * @param {object} layerDef
   * @param {string} layerDef.id
   * @param {string} layerDef.name
   * @param {string} layerDef.geometryType - POINT|LINESTRING|POLYGON|MULTI...
   * @param {string} layerDef.crs - EPSG:xxxx
   * @param {Array<{name:string,type:string}>} [layerDef.fields]
   */
  async createVectorLayer(gpkgPath, layerDef) {
    const id = String(layerDef?.id || layerDef?.name || '').trim();
    if (!id) throw new Error('Layer id required');
    const crs = String(layerDef?.crs || 'EPSG:4326').toUpperCase();
    // ensure CRS exists in our lookup (stage-1)
    this.crsService.ensure(crs);

    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      if ((gpkg.getFeatureTables() || []).includes(id)) {
        throw new Error(`Layer already exists: ${id}`);
      }

      const geometryType = String(layerDef?.geometryType || 'GEOMETRY').toUpperCase();
      const fields = Array.isArray(layerDef?.fields) ? layerDef.fields : [];

      const columns = [];
      // @ngageoint/geopackage uses its own column builders; simplest is to create via GeoJSON import pattern later.
      // For now, create a minimal table with id + geom and then add user fields dynamically.
      const srsId = this._epsgToSrsId(crs);
      const featureTable = gpkg.createFeatureTable(id, geometryType, srsId);

      // Add attribute columns
      for (const f of fields) {
        const name = String(f?.name || '').trim();
        if (!name) continue;
        const type = String(f?.type || 'TEXT').toUpperCase();
        // addColumn signature: (tableName, columnName, dataType, max, notNull, defaultValue)
        try {
          gpkg.addColumn(id, name, type);
        } catch {
          // ignore duplicates
        }
      }

      return { id, name: layerDef?.name || id, geometryType, crs };
    } finally {
      gpkg.close();
    }
  }

  async deleteLayer(gpkgPath, layerId) {
    const id = String(layerId || '').trim();
    if (!id) throw new Error('layerId required');
    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      if ((gpkg.getFeatureTables() || []).includes(id)) {
        gpkg.deleteFeatureTable(id);
        return { ok: true };
      }
      if ((gpkg.getTileTables() || []).includes(id)) {
        gpkg.deleteTileTable(id);
        return { ok: true };
      }
      return { ok: false, message: 'Layer not found' };
    } finally {
      gpkg.close();
    }
  }

  /**
   * Query features in a layer with basic pagination.
   * @param {string} gpkgPath
   * @param {object} query
   * @param {string} query.layerId
   * @param {number} [query.limit]
   * @param {number} [query.offset]
   * @param {string} [query.where]
   */
  async queryFeatures(gpkgPath, query) {
    const layerId = String(query?.layerId || '').trim();
    if (!layerId) throw new Error('query.layerId required');
    const limit = Math.max(1, Math.min(5000, Number(query?.limit || 500)));
    const offset = Math.max(0, Number(query?.offset || 0));

    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      const featureDao = gpkg.getFeatureDao(layerId);
      const rawWhere = query?.where ? String(query.where).trim() : '';
      let where = null;
      let whereArgs = undefined;
      if (rawWhere) {
        if (
          rawWhere.length > 512 ||
          /[;]|--|\/\*|\*\//.test(rawWhere) ||
          /\b(?:DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|ATTACH|DETACH|PRAGMA|UNION|SELECT|REPLACE|VACUUM)\b/i.test(
            rawWhere
          )
        ) {
          throw new Error('Unsafe SQL filter expression rejected');
        }
        where = rawWhere;
        if (Array.isArray(query?.whereArgs)) {
          whereArgs = query.whereArgs;
        }
      }
      const rows = [];
      const iter = where
        ? featureDao.queryForEach(where, whereArgs)
        : featureDao.queryForEach();

      let idx = 0;
      for (const row of iter) {
        if (idx++ < offset) continue;
        if (rows.length >= limit) break;
        const geojson = featureDao.getFeatureRowAsGeoJSON(row);
        rows.push(geojson);
      }

      return { features: rows, limit, offset, count: rows.length };
    } finally {
      gpkg.close();
    }
  }

  async insertFeature(gpkgPath, layerId, feature) {
    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      const featureDao = gpkg.getFeatureDao(layerId);
      const id = featureDao.create(feature);
      return { id };
    } finally {
      gpkg.close();
    }
  }

  async updateFeature(gpkgPath, layerId, featureId, patch) {
    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      const featureDao = gpkg.getFeatureDao(layerId);
      const row = featureDao.queryForId(featureId);
      if (!row) throw new Error('Feature not found');
      // naive: replace properties/geometry if provided in patch
      if (patch?.geometry) row.setGeometry(patch.geometry);
      if (patch?.properties) {
        for (const [k, v] of Object.entries(patch.properties)) {
          try {
            row.setValue(k, v);
          } catch {
            // ignore unknown columns
          }
        }
      }
      featureDao.update(row);
      return { ok: true };
    } finally {
      gpkg.close();
    }
  }

  async deleteFeature(gpkgPath, layerId, featureId) {
    const gpkg = await GeoPackageAPI.open(gpkgPath);
    try {
      const featureDao = gpkg.getFeatureDao(layerId);
      featureDao.deleteById(featureId);
      return { ok: true };
    } finally {
      gpkg.close();
    }
  }

  // ---------------------
  // Internal helpers
  // ---------------------

  _epsgToSrsId(code) {
    const match = String(code || '').match(/EPSG:(\d+)/i);
    if (!match) return 4326;
    return Number(match[1]);
  }

  async _ensureSimplexMetadataTable(gpkg) {
    const tableName = 'simplex_metadata';
    if (gpkg.isTable(tableName)) return;
    gpkg.getDatabase().exec(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  async _setMetadata(gpkg, key, value) {
    const db = gpkg.getDatabase();
    db.exec(`INSERT INTO simplex_metadata (key, value) VALUES (${this._q(key)}, ${this._q(String(value ?? ''))})
      ON CONFLICT(key) DO UPDATE SET value=excluded.value;`);
  }

  _q(s) {
    // very small SQL-escape for literals; keys are controlled by us
    return `'${String(s).replace(/'/g, "''")}'`;
  }
}

module.exports = { GeoPackageService };

