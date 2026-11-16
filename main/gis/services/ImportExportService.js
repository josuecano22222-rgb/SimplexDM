const fs = require('fs');
const path = require('path');
const shapefile = require('shapefile');
const { DOMParser } = require('xmldom');
const toGeoJSON = require('@tmcw/togeojson');
const Papa = require('papaparse');
const unzipper = require('unzipper');

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function geometryToKml(geom) {
  if (!geom || !geom.type) return '';
  const fmtCoord = (c) => (c.length >= 3 ? `${c[0]},${c[1]},${c[2]}` : `${c[0]},${c[1]}`);
  const fmtRing = (ring) => (ring || []).map(fmtCoord).join(' ');

  switch (geom.type) {
    case 'Point':
      return `<Point><coordinates>${fmtCoord(geom.coordinates)}</coordinates></Point>`;
    case 'LineString':
      return `<LineString><coordinates>${fmtRing(geom.coordinates)}</coordinates></LineString>`;
    case 'Polygon': {
      const [outer, ...holes] = geom.coordinates || [];
      const outerXml = `<outerBoundaryIs><LinearRing><coordinates>${fmtRing(outer)}</coordinates></LinearRing></outerBoundaryIs>`;
      const innerXml = holes
        .map((h) => `<innerBoundaryIs><LinearRing><coordinates>${fmtRing(h)}</coordinates></LinearRing></innerBoundaryIs>`)
        .join('');
      return `<Polygon>${outerXml}${innerXml}</Polygon>`;
    }
    case 'MultiPoint':
      return `<MultiGeometry>${(geom.coordinates || [])
        .map((c) => geometryToKml({ type: 'Point', coordinates: c }))
        .join('')}</MultiGeometry>`;
    case 'MultiLineString':
      return `<MultiGeometry>${(geom.coordinates || [])
        .map((c) => geometryToKml({ type: 'LineString', coordinates: c }))
        .join('')}</MultiGeometry>`;
    case 'MultiPolygon':
      return `<MultiGeometry>${(geom.coordinates || [])
        .map((c) => geometryToKml({ type: 'Polygon', coordinates: c }))
        .join('')}</MultiGeometry>`;
    case 'GeometryCollection':
      return `<MultiGeometry>${(geom.geometries || []).map(geometryToKml).join('')}</MultiGeometry>`;
    default:
      return '';
  }
}

function featureCollectionToKml(fc, docName = 'SimplexDM Export') {
  const placemarks = (fc.features || [])
    .map((feat, idx) => {
      const props = feat?.properties || {};
      const name = props.name || props.title || props.id || `Feature ${idx + 1}`;
      const dataEntries = Object.entries(props)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `<Data name="${escapeXml(k)}"><value>${escapeXml(typeof v === 'object' ? JSON.stringify(v) : v)}</value></Data>`)
        .join('');
      const extData = dataEntries ? `<ExtendedData>${dataEntries}</ExtendedData>` : '';
      const geomXml = geometryToKml(feat?.geometry);
      return `    <Placemark><name>${escapeXml(name)}</name>${extData}${geomXml}</Placemark>`;
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${escapeXml(docName)}</name>`,
    placemarks,
    '  </Document>',
    '</kml>',
    '',
  ].join('\n');
}

function featureCollectionToCsv(fc) {
  const rows = (fc.features || []).map((feat) => {
    const props = { ...(feat?.properties || {}) };
    const g = feat?.geometry;
    if (g && g.type === 'Point' && Array.isArray(g.coordinates)) {
      props.lon = g.coordinates[0];
      props.lat = g.coordinates[1];
      if (g.coordinates.length >= 3) props.elevation = g.coordinates[2];
    } else if (g) {
      props.geometry_type = g.type;
      props.geometry_geojson = JSON.stringify(g);
    }
    return props;
  });
  return Papa.unparse(rows);
}

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
   * Import a geospatial vector file (GeoJSON, KML, KMZ, Shapefile, CSV) into the project GeoPackage.
   */
  async importFile(project, importSpec) {
    const filePath = String(importSpec?.path || '');
    if (!filePath) throw new Error('importSpec.path required');
    const format = String(importSpec?.format || path.extname(filePath).slice(1)).toLowerCase();

    if (format === 'geojson' || format === 'json') {
      const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      const fc = this._normalizeFeatureCollection(parsed);
      return await this._importGeoJSON(project, fc, importSpec);
    }
    if (format === 'kml') {
      const xml = await fs.promises.readFile(filePath, 'utf8');
      const dom = new DOMParser().parseFromString(xml, 'text/xml');
      const fc = toGeoJSON.kml(dom);
      return await this._importGeoJSON(project, fc, importSpec);
    }
    if (format === 'kmz') {
      const xml = await this._extractKmlFromKmz(filePath);
      const dom = new DOMParser().parseFromString(xml, 'text/xml');
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
   * Export a GeoPackage vector layer to GeoJSON, KML, or CSV with full pagination and optional CRS reprojection.
   * @param {object} project
   * @param {{ layerId: string, format?: string, path: string, targetCrs?: string, sourceCrs?: string }} exportSpec
   */
  async exportLayer(project, exportSpec) {
    const layerId = String(exportSpec?.layerId || '').trim();
    const outPath = String(exportSpec?.path || '').trim();
    if (!layerId) throw new Error('exportSpec.layerId required');
    if (!outPath) throw new Error('exportSpec.path required');

    const format = String(exportSpec?.format || path.extname(outPath).slice(1) || 'geojson').toLowerCase();
    if (!['geojson', 'json', 'kml', 'csv'].includes(format)) {
      throw new Error(`Unsupported export format: ${format}. Supported: geojson, kml, csv.`);
    }

    // Paginate through the full layer without silent truncation at 5,000 rows
    const pageSize = 2500;
    let offset = 0;
    let allFeatures = [];
    while (true) {
      const page = await this.gpkgService.queryFeatures(project.gpkgPath, {
        layerId,
        limit: pageSize,
        offset,
      });
      const batch = Array.isArray(page?.features) ? page.features : [];
      allFeatures.push(...batch);
      if (batch.length < pageSize) break;
      offset += batch.length;
    }

    const srcCrs = String(exportSpec?.sourceCrs || 'EPSG:4326').toUpperCase();
    const dstCrs = String(exportSpec?.targetCrs || (format === 'kml' ? 'EPSG:4326' : srcCrs)).toUpperCase();
    if (this.crsService && srcCrs !== dstCrs) {
      allFeatures = allFeatures.map((f) => ({
        ...f,
        geometry: this.crsService.transformGeometry(f.geometry, srcCrs, dstCrs),
      }));
    }

    const fc = { type: 'FeatureCollection', features: allFeatures };
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });

    if (format === 'geojson' || format === 'json') {
      await fs.promises.writeFile(outPath, JSON.stringify(fc, null, 2), 'utf8');
    } else if (format === 'kml') {
      await fs.promises.writeFile(outPath, featureCollectionToKml(fc, layerId), 'utf8');
    } else if (format === 'csv') {
      await fs.promises.writeFile(outPath, featureCollectionToCsv(fc), 'utf8');
    }

    return { ok: true, path: outPath, format, count: allFeatures.length };
  }

  _normalizeFeatureCollection(doc) {
    if (!doc || typeof doc !== 'object') {
      throw new Error('Expected GeoJSON FeatureCollection');
    }
    if (doc.type === 'FeatureCollection' && Array.isArray(doc.features)) {
      return doc;
    }
    if (doc.type === 'Feature') {
      return { type: 'FeatureCollection', features: [doc] };
    }
    if (doc.type && doc.coordinates) {
      return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: doc, properties: {} }] };
    }
    throw new Error('Expected GeoJSON FeatureCollection');
  }

  async _extractKmlFromKmz(kmzPath) {
    const dir = await unzipper.Open.file(kmzPath);
    const kmlEntry =
      dir.files.find((f) => f.type !== 'Directory' && path.posix.basename(f.path).toLowerCase() === 'doc.kml') ||
      dir.files.find((f) => f.type !== 'Directory' && f.path.toLowerCase().endsWith('.kml'));
    if (!kmlEntry) {
      throw new Error('KMZ archive does not contain a .kml document');
    }
    const buf = await kmlEntry.buffer();
    return buf.toString('utf8');
  }

  async _importGeoJSON(project, fc, importSpec) {
    if (!fc || fc.type !== 'FeatureCollection') {
      throw new Error('Expected GeoJSON FeatureCollection');
    }
    const baseName = path.basename(importSpec.path, path.extname(importSpec.path));
    const layerId = String(importSpec?.layerId || baseName.replace(/\W+/g, '_')).slice(0, 60) || 'layer';
    const sourceCrs = String(importSpec?.crs || 'EPSG:4326').toUpperCase();
    const targetCrs = String(importSpec?.targetCrs || 'EPSG:4326').toUpperCase();

    let features = Array.isArray(fc.features) ? fc.features : [];
    if (this.crsService && sourceCrs !== targetCrs) {
      features = features.map((f) => ({
        ...f,
        geometry: this.crsService.transformGeometry(f.geometry, sourceCrs, targetCrs),
      }));
    }

    const normalizedFc = { type: 'FeatureCollection', features };
    const geometryType = this._inferGeometryType(normalizedFc);
    await this.gpkgService.createVectorLayer(project.gpkgPath, {
      id: layerId,
      name: layerId,
      geometryType,
      crs: targetCrs,
      fields: this._inferFields(normalizedFc),
    });

    let inserted = 0;
    for (const f of features) {
      await this.gpkgService.insertFeature(project.gpkgPath, layerId, f);
      inserted++;
    }
    return { ok: true, layerId, crs: targetCrs, inserted };
  }

  _inferGeometryType(fc) {
    const types = new Set();
    for (const f of fc.features || []) {
      if (f?.geometry?.type) types.add(String(f.geometry.type).toUpperCase());
    }
    return types.size === 1 ? [...types][0] : 'GEOMETRY';
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
    const fields = parsed.meta?.fields || [];
    const findCol = (explicit, candidates) => {
      if (explicit) return explicit;
      return fields.find((f) => candidates.includes(String(f).trim().toLowerCase())) || candidates[0];
    };
    const latKey = findCol(importSpec?.latKey, ['lat', 'latitude', 'y']);
    const lonKey = findCol(importSpec?.lonKey, ['lon', 'lng', 'long', 'longitude', 'x']);
    const altKey = findCol(importSpec?.altKey, ['alt', 'altitude', 'elevation', 'height', 'z']);

    const features = [];
    for (const row of parsed.data || []) {
      const lat = Number(row[latKey]);
      const lon = Number(row[lonKey]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const alt = row[altKey] !== undefined && row[altKey] !== null && row[altKey] !== '' ? Number(row[altKey]) : NaN;
      const props = { ...row };
      delete props[latKey];
      delete props[lonKey];
      const coordinates = Number.isFinite(alt) ? [lon, lat, alt] : [lon, lat];
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: props,
      });
    }
    return { type: 'FeatureCollection', features };
  }
}

module.exports = { ImportExportService, featureCollectionToKml, featureCollectionToCsv };
