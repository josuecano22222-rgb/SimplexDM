const fs = require('fs');

let _geoTiffPromise = null;

/**
 * Lazy-load `geotiff` across Electron 28 (Node 18, where transitive `quick-lru`
 * requires native ESM `import()`) and Node 20+/22+ runtimes.
 */
async function loadGeoTiff() {
  if (_geoTiffPromise) return _geoTiffPromise;
  _geoTiffPromise = (async () => {
    try {
      // eslint-disable-next-line global-require
      return require('geotiff');
    } catch (_) {
      // Dynamic import via Function prevents CJS/Jest parsers from choking
      // while using Node/Electron's native ESM loader at runtime.
      // eslint-disable-next-line no-new-func
      const dynamicImport = new Function('specifier', 'return import(specifier)');
      return dynamicImport('geotiff');
    }
  })();
  return _geoTiffPromise;
}

/**
 * RasterService
 * Offline GeoTIFF/COG value sampling with CRS awareness (via GeoKeys + CrsService),
 * bounds validation, multi-band inspection, and GDAL NoData detection.
 */
class RasterService {
  /**
   * @param {{ crsService?: import('./CrsService').CrsService }} [deps]
   */
  constructor(deps = {}) {
    this.crsService = deps.crsService || null;
  }

  _detectRasterCrs(image) {
    try {
      const geoKeys = typeof image.getGeoKeys === 'function' ? image.getGeoKeys() : null;
      if (!geoKeys) return 'EPSG:4326';
      const epsg = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey;
      if (Number.isInteger(epsg) && epsg > 0 && epsg !== 32767) {
        return `EPSG:${epsg}`;
      }
    } catch (_) {
      /* fall through */
    }
    return 'EPSG:4326';
  }

  /**
   * Inspect basic GeoTIFF metadata (width, height, bbox, CRS, band count).
   * @param {string} filePath
   */
  async open(filePath) {
    if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) {
      throw new Error(`Raster file not found: ${filePath || '(empty)'}`);
    }
    const GeoTIFF = await loadGeoTiff();
    const tiff = await GeoTIFF.fromFile(filePath);
    const image = await tiff.getImage();
    return {
      width: image.getWidth(),
      height: image.getHeight(),
      bbox: image.getBoundingBox(),
      crs: this._detectRasterCrs(image),
      samplesPerPixel: typeof image.getSamplesPerPixel === 'function' ? image.getSamplesPerPixel() : 1,
    };
  }

  /**
   * Sample pixel band value(s) at WGS84 `[lon, lat]`.
   * @param {string} filePath
   * @param {[number, number]} lonLat
   */
  async sampleValue(filePath, lonLat) {
    if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) {
      throw new Error(`Raster file not found: ${filePath || '(empty)'}`);
    }
    if (!Array.isArray(lonLat) || lonLat.length < 2) {
      throw new Error('lonLat must be [lon, lat]');
    }
    const lon = Number(lonLat[0]);
    const lat = Number(lonLat[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error('lonLat coordinates must be finite numbers');
    }

    const GeoTIFF = await loadGeoTiff();
    const tiff = await GeoTIFF.fromFile(filePath);
    const image = await tiff.getImage();
    const rasterCrs = this._detectRasterCrs(image);

    let x = lon;
    let y = lat;
    if (rasterCrs !== 'EPSG:4326' && this.crsService) {
      try {
        const transformed = this.crsService.transform({
          from: 'EPSG:4326',
          to: rasterCrs,
          coords: [lon, lat],
        });
        if (Array.isArray(transformed?.coords) && transformed.coords.length >= 2) {
          [x, y] = transformed.coords;
        }
      } catch (_) {
        /* keep input coords if EPSG definition is unavailable */
      }
    }

    const bbox = image.getBoundingBox();
    const [minX, minY, maxX, maxY] = bbox;
    const width = image.getWidth();
    const height = image.getHeight();
    if (!(width > 0 && height > 0) || maxX === minX || maxY === minY) {
      return { value: null, bands: [], crs: rasterCrs, outOfBounds: true };
    }

    if (x < minX || x > maxX || y < minY || y > maxY) {
      return { value: null, bands: [], crs: rasterCrs, outOfBounds: true };
    }

    const px = Math.min(width - 1, Math.max(0, Math.floor(((x - minX) / (maxX - minX)) * width)));
    const py = Math.min(height - 1, Math.max(0, Math.floor(((maxY - y) / (maxY - minY)) * height)));
    const rasters = await image.readRasters({ window: [px, py, px + 1, py + 1] });

    let noData = null;
    try {
      if (typeof image.getGDALNoData === 'function') {
        noData = image.getGDALNoData();
      }
    } catch (_) {
      noData = null;
    }

    const bands = [];
    for (let i = 0; i < rasters.length; i++) {
      const raw = rasters[i]?.[0];
      if (raw === undefined || raw === null || Number.isNaN(raw)) {
        bands.push(null);
      } else if (noData !== null && Math.abs(Number(raw) - Number(noData)) <= 1e-9) {
        bands.push(null);
      } else {
        bands.push(Number(raw));
      }
    }

    const primary = bands.length > 0 ? bands[0] : null;
    const isNoData = primary === null;
    return {
      value: primary,
      bands,
      crs: rasterCrs,
      pixel: [px, py],
      isNoData,
      outOfBounds: false,
    };
  }
}

module.exports = { RasterService };
