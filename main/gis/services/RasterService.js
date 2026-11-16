const fs = require('fs');
const path = require('path');
const GeoTIFF = require('geotiff');

/**
 * RasterService (Stage-1)
 * Offline-first viewer support: register rasters as sidecar files in the project folder
 * and expose a lightweight sampling API. (Full GeoPackage tile ingestion is staged next.)
 *
 * Note: GeoPackage tile-table ingestion is non-trivial without GDAL; stage-1 keeps the
 * authoritative reference inside the project folder and records it via project.json.
 */
class RasterService {
  async sampleValue(filePath, lonLat) {
    const [lon, lat] = lonLat;
    const tiff = await GeoTIFF.fromFile(filePath);
    const image = await tiff.getImage();
    const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY] in raster CRS
    // Stage-1 assumes EPSG:4326 geotiffs (common for COGs). Reprojection is added later.
    const [minX, minY, maxX, maxY] = bbox;
    const width = image.getWidth();
    const height = image.getHeight();
    const px = Math.floor(((lon - minX) / (maxX - minX)) * width);
    const py = Math.floor(((maxY - lat) / (maxY - minY)) * height);
    const window = [px, py, px + 1, py + 1];
    const rasters = await image.readRasters({ window });
    return { value: rasters[0]?.[0] ?? null };
  }
}

module.exports = { RasterService };

