const proj4 = require('proj4');
const epsgIndex = require('epsg-index/all.json');

/**
 * CRS Service (Stage-1).
 * Uses proj4 definitions (no grid-shift files). Keeps API stable for later PROJ upgrade.
 */
class CrsService {
  constructor() {
    this._loaded = new Set();
  }

  /**
   * Lookup EPSG by code or free-text query.
   * @param {string} query
   */
  lookup(query) {
    const q = String(query || '').trim();
    if (!q) return [];

    // Exact EPSG:xxxx (epsg-index keys are numeric strings like '4326', support both)
    const match = q.match(/^(?:EPSG:)?(\d{3,6})$/i);
    if (match) {
      const numCode = match[1];
      const code = `EPSG:${numCode}`;
      const rec = epsgIndex[numCode] || epsgIndex[code];
      if (rec) return [{ code, name: rec.name, proj4: rec.proj4, bbox: rec.bbox || null }];
    }

    const qLower = q.toLowerCase();
    const results = [];
    for (const [rawCode, rec] of Object.entries(epsgIndex)) {
      const code = rawCode.toUpperCase().startsWith('EPSG:') ? rawCode.toUpperCase() : `EPSG:${rawCode}`;
      if (
        code.toLowerCase().includes(qLower) ||
        rawCode.toLowerCase().includes(qLower) ||
        (rec.name || '').toLowerCase().includes(qLower)
      ) {
        results.push({ code, name: rec.name, proj4: rec.proj4, bbox: rec.bbox || null });
        if (results.length >= 25) break;
      }
    }
    return results;
  }

  /**
   * Ensure a CRS definition is registered in proj4.
   * @param {string} code
   */
  ensure(code) {
    const raw = String(code || '').trim().toUpperCase();
    if (!raw) throw new Error('CRS code required');
    const c = /^\d{3,6}$/.test(raw) ? `EPSG:${raw}` : raw;
    if (this._loaded.has(c)) return;
    // Built-in proj4 definitions
    if (c === 'CRS84' || c === 'WGS84') {
      proj4.defs(c, '+proj=longlat +datum=WGS84 +no_defs +type=crs');
      this._loaded.add(c);
      return;
    }
    const numKey = c.startsWith('EPSG:') ? c.slice(5) : c;
    const rec = epsgIndex[numKey] || epsgIndex[c];
    if (!rec?.proj4) {
      throw new Error(`Unknown CRS: ${c}`);
    }
    proj4.defs(c, rec.proj4);
    this._loaded.add(c);
  }

  /**
   * Transform coordinates.
   * @param {object} spec
   * @param {string} spec.from
   * @param {string} spec.to
   * @param {[number, number]|Array<[number, number]>} spec.coords
   */
  transform(spec) {
    const from = String(spec?.from || '').toUpperCase();
    const to = String(spec?.to || '').toUpperCase();
    if (!from || !to) throw new Error('transform requires from/to CRS');
    this.ensure(from);
    this.ensure(to);
    const transformer = proj4(from, to);

    const coords = spec?.coords;
    if (Array.isArray(coords) && typeof coords[0] === 'number') {
      const [x, y] = coords;
      const out = transformer.forward([x, y]);
      return { coords: out };
    }
    if (Array.isArray(coords) && Array.isArray(coords[0])) {
      const out = coords.map(([x, y, ...rest]) => {
        const [tx, ty] = transformer.forward([x, y]);
        return rest.length ? [tx, ty, ...rest] : [tx, ty];
      });
      return { coords: out };
    }
    throw new Error('transform coords must be [x,y] or array of [x,y]');
  }

  /**
   * Transform a GeoJSON geometry object between two CRS codes while preserving Z/M values.
   * @param {object} geometry
   * @param {string} fromCrs
   * @param {string} toCrs
   */
  transformGeometry(geometry, fromCrs, toCrs) {
    if (!geometry || typeof geometry !== 'object') return geometry;
    const from = String(fromCrs || '').toUpperCase();
    const to = String(toCrs || '').toUpperCase();
    if (!from || !to || from === to) return geometry;
    this.ensure(from);
    this.ensure(to);
    const transformer = proj4(from, to);

    const mapCoords = (node) => {
      if (!Array.isArray(node) || node.length === 0) return node;
      if (typeof node[0] === 'number' && typeof node[1] === 'number') {
        const [tx, ty] = transformer.forward([node[0], node[1]]);
        return node.length > 2 ? [tx, ty, ...node.slice(2)] : [tx, ty];
      }
      return node.map(mapCoords);
    };

    if (geometry.type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
      return {
        ...geometry,
        geometries: geometry.geometries.map((g) => this.transformGeometry(g, from, to)),
      };
    }

    return {
      ...geometry,
      coordinates: mapCoords(geometry.coordinates),
    };
  }
}

module.exports = { CrsService };

