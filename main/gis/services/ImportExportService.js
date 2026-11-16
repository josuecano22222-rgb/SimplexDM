const fs = require('fs');
const path = require('path');
const shapefile = require('shapefile');
const { DOMParser } = require('xmldom');
const toGeoJSON = require('@tmcw/togeojson');
const Papa = require('papaparse');

class ImportExportService {
  /**
   * @param {object} deps
   * @param {import('./GeoPackageService').GeoPackageService} deps.gpkgService
   * @param {import('./CrsService').CrsService} deps.crsService
   */
  constructor({ gpkgService, crsService }) {
    this.gpkgService = gpkgService;
    this.crsService = crsService;
  }

  /**
   * Import a file into the project's GeoPackage.
   * @param {object} project
   * @param {string} project.gpkgPath
   * @param {object} importSpec
   * @param {string} importSpec.path Absolute file path
   * @param {string} [importSpec.layerId]
   * @param {string} [importSpec.format] geojson|kml|shp|csv
   * @param {string} [importSpec.crs] EPSG:xxxx for source data
   */
  async importFile(project, importSpec) {
    const filePath = String(importSpec?.path || '');
    if (!filePath) throw new Error('importSpec.path required');
    const format = (importSpec?.format || path.extname(filePath).slice(1)).toLowerCase();

    if (format === 'geojson' || format === 'json') {
      const fc = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      return await this._importGeoJSON(project, fc, importSpec);
    }
    if (format === 'kml') {
      const xml = await fs.promises.readFile(filePath, 'utf8');
      const dom = new DOMParser().parseFromString(xml);
      const fc = toGeoJSON.kml(dom);
      return await this._importGeoJSON(project, fc, importSpec);
    }
    if (format === 'shp') {
      const fc = await this._readShapefileAsGeoJSON(filePath);
      return await this._importGeoJSON(project, fc, importSpec);
    }
    if (format === 'csv') {
      const text = await fs.promises.readFile(filePath, 'utf8');
      const fc = this._csvToPointFeatureCollection(text, importSpec);
      return await this._importGeoJSON(project, fc, importSpec);
    }

    throw new Error(`Unsupported import format: ${format}`);
  }

  /**
   * Export a layer to a file.
   * @param {object} project
   * @param {object} exportSpec
   * @param {string} exportSpec.layerId
   * @param {string} exportSpec.format geojson (stage-1)
   * @param {string} exportSpec.path output file path
   */
  async exportLayer(project, exportSpec) {
    const format = String(exportSpec?.format || 'geojson').toLowerCase();
    if (format !== 'geojson') {
      throw new Error('Stage-1 export supports only GeoJSON');
    }
    const res = await this.gpkgService.queryFeatures(project.gpkgPath, {
      layerId: exportSpec.layerId,
      limit: 5000,
      offset: 0,
    });
    const fc = { type: 'FeatureCollection', features: res.features || [] };
    await fs.promises.writeFile(exportSpec.path, JSON.stringify(fc, null, 2), 'utf8');
    return { ok: true, path: exportSpec.path };
  }

  // -----------------------
  // Internal import helpers
  // -----------------------

  async _importGeoJSON(project, fc, importSpec) {
    if (!fc || fc.type !== 'FeatureCollection') {
      throw new Error('Expected GeoJSON FeatureCollection');
    }
    const layerId = String(importSpec?.layerId || path.basename(importSpec.path).replace(/\W+/g, '_')).slice(0, 60);
    const sourceCrs = String(importSpec?.crs || 'EPSG:4326').toUpperCase();

    // Create layer lazily if missing; geometry type is inferred.
    const geometryType = this._inferGeometryType(fc);
    await this.gpkgService.createVectorLayer(project.gpkgPath, {
      id: layerId,
      name: layerId,
      geometryType,
      crs: sourceCrs,
      fields: this._inferFields(fc),
    });

    // Insert features (no reprojection in stage-1 importer; we preserve coords as-is).
    let inserted = 0;
    for (const f of fc.features || []) {
      await this.gpkgService.insertFeature(project.gpkgPath, layerId, f);
      inserted++;
    }
    return { ok: true, layerId, inserted };
  }

  _inferGeometryType(fc) {
    for (const f of fc.features || []) {
      const t = f?.geometry?.type;
      if (t) return String(t).toUpperCase();
    }
    return 'GEOMETRY';
  }

  _inferFields(fc) {
    const fields = new Map();
    for (const f of fc.features || []) {
      const props = f?.properties || {};
      for (const [k, v] of Object.entries(props)) {
        if (fields.has(k)) continue;
        fields.set(k, this._jsValueToSqlType(v));
      }
      if (fields.size >= 30) break;
    }
    return [...fields.entries()].map(([name, type]) => ({ name, type }));
  }

  _jsValueToSqlType(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? 'INTEGER' : 'REAL';
    if (typeof v === 'boolean') return 'BOOLEAN';
    return 'TEXT';
  }

  async _readShapefileAsGeoJSON(shpPath) {
    const features = [];
    const source = await shapefile.open(shpPath);
    while (true) {
      const res = await source.read();
      if (res.done) break;
      features.push({ type: 'Feature', geometry: res.value.geometry, properties: res.value.properties || {} });
    }
    return { type: 'FeatureCollection', features };
  }

  _csvToPointFeatureCollection(text, importSpec) {
    const parsed = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
    const latKey = importSpec?.latKey || 'lat';
    const lonKey = importSpec?.lonKey || 'lon';
    const features = [];
    for (const row of parsed.data || []) {
      const lat = Number(row[latKey]);
      const lon = Number(row[lonKey]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const props = { ...row };
      delete props[latKey];
      delete props[lonKey];
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: props,
      });
    }
    return { type: 'FeatureCollection', features };
  }
}

module.exports = { ImportExportService };

