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

    // Exact EPSG:xxxx
    const match = q.match(/(?:EPSG:)?(\d{3,6})/i);
    if (match) {
      const code = `EPSG:${match[1]}`;
      const rec = epsgIndex[code];
      if (rec) return [{ code, name: rec.name, proj4: rec.proj4, bbox: rec.bbox || null }];
    }

    const qLower = q.toLowerCase();
    const results = [];
    for (const [code, rec] of Object.entries(epsgIndex)) {
      if (code.toLowerCase().includes(qLower) || (rec.name || '').toLowerCase().includes(qLower)) {
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
    const c = String(code || '').toUpperCase();
    if (!c) throw new Error('CRS code required');
    if (this._loaded.has(c)) return;
    const rec = epsgIndex[c];
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
      const out = coords.map(([x, y]) => transformer.forward([x, y]));
      return { coords: out };
    }
    throw new Error('transform coords must be [x,y] or array of [x,y]');
  }
}

module.exports = { CrsService };

