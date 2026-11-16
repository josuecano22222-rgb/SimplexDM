const fs = require('fs');
const vm = require('vm');
const { workerData, parentPort } = require('worker_threads');
const { GeoPackageAPI } = require('@ngageoint/geopackage');

let _cachedJsts = null;
function loadJsts() {
  if (_cachedJsts) return _cachedJsts;
  const distPath = require.resolve('jsts/dist/jsts.min.js');
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(distPath, 'utf8'), ctx, { filename: distPath });
  if (!ctx.jsts) {
    throw new Error('Failed to initialize JSTS geometry library');
  }
  _cachedJsts = ctx.jsts;
  return _cachedJsts;
}
const jsts = loadJsts();

function post(type, payload) {
  if (parentPort) {
    parentPort.postMessage({ type, ...payload, jobId: workerData.jobId });
  }
}

function readLayerGeometries(gpkg, layerId, reader, maxFeatures = 10000) {
  const tables = gpkg.getFeatureTables() || [];
  if (!tables.includes(layerId)) {
    throw new Error(`Layer not found: ${layerId}`);
  }
  const featureDao = gpkg.getFeatureDao(layerId);
  const geoms = [];
  let count = 0;
  for (const row of featureDao.queryForEach()) {
    const feat = featureDao.getFeatureRowAsGeoJSON(row);
    if (feat?.geometry) {
      geoms.push(reader.read(feat.geometry));
    }
    count++;
    if (count % 250 === 0) {
      post('progress', { progress: Math.min(0.85, count / maxFeatures) });
    }
    if (count >= maxFeatures) break;
  }
  return geoms;
}

function executeGeometryOperation(op, primaryGeoms, overlayGeoms, jobSpec = {}) {
  if (!Array.isArray(primaryGeoms) || primaryGeoms.length === 0) {
    throw new Error('Input layer contains no valid geometries');
  }

  const unionAll = (list) => list.reduce((acc, g) => (acc ? acc.union(g) : g), null);

  switch (op) {
    case 'buffer': {
      const dist = Number(jobSpec.distance || 0);
      if (!Number.isFinite(dist) || dist <= 0) {
        throw new Error('Positive buffer distance is required');
      }
      return unionAll(primaryGeoms.map((g) => g.buffer(dist)));
    }
    case 'dissolve':
    case 'union': {
      const combined = overlayGeoms && overlayGeoms.length ? [...primaryGeoms, ...overlayGeoms] : primaryGeoms;
      return unionAll(combined);
    }
    case 'intersect':
    case 'intersection': {
      const base = unionAll(primaryGeoms);
      if (overlayGeoms && overlayGeoms.length) {
        return base.intersection(unionAll(overlayGeoms));
      }
      return primaryGeoms.reduce((acc, g) => (acc ? acc.intersection(g) : g), null);
    }
    case 'difference':
    case 'clip': {
      if (!overlayGeoms || overlayGeoms.length === 0) {
        throw new Error(`${op} requires overlayLayerId with at least one geometry`);
      }
      const base = unionAll(primaryGeoms);
      const mask = unionAll(overlayGeoms);
      return op === 'clip' ? base.intersection(mask) : base.difference(mask);
    }
    case 'convexhull': {
      return unionAll(primaryGeoms).convexHull();
    }
    case 'centroid': {
      return unionAll(primaryGeoms).getCentroid();
    }
    case 'simplify': {
      const tolerance = Number(jobSpec.tolerance ?? 0.0001);
      if (!Number.isFinite(tolerance) || tolerance < 0) {
        throw new Error('Valid non-negative simplify tolerance is required');
      }
      const DPS = jsts.simplify?.DouglasPeuckerSimplifier;
      const base = unionAll(primaryGeoms);
      return DPS ? DPS.simplify(base, tolerance) : base;
    }
    default:
      throw new Error(`Unsupported geoprocess op: ${op}`);
  }
}

async function run() {
  const { project, jobSpec } = workerData;
  const op = String(jobSpec?.op || '').toLowerCase();
  const inputLayerId = jobSpec?.inputLayerId;
  if (!op || !inputLayerId) {
    throw new Error('jobSpec.op and jobSpec.inputLayerId required');
  }

  const gpkg = await GeoPackageAPI.open(project.gpkgPath);
  try {
    const reader = new jsts.io.GeoJSONReader();
    const writer = new jsts.io.GeoJSONWriter();

    const geoms = readLayerGeometries(gpkg, inputLayerId, reader);
    const overlayGeoms = jobSpec?.overlayLayerId
      ? readLayerGeometries(gpkg, String(jobSpec.overlayLayerId), reader)
      : null;

    const outGeom = executeGeometryOperation(op, geoms, overlayGeoms, jobSpec);
    if (!outGeom || (typeof outGeom.isEmpty === 'function' && outGeom.isEmpty())) {
      post('progress', { progress: 1 });
      post('result', { result: { ok: true, empty: true, outputLayerId: null, outputFeatureId: null } });
      return;
    }

    post('progress', { progress: 0.95 });
    const outGeo = writer.write(outGeom);
    const resultFeature = {
      type: 'Feature',
      geometry: outGeo,
      properties: { op, sourceLayer: inputLayerId, createdAt: new Date().toISOString() },
    };

    const outLayerId = String(jobSpec?.outputLayerId || `${inputLayerId}_${op}`).slice(0, 60);
    if (!(gpkg.getFeatureTables() || []).includes(outLayerId)) {
      gpkg.createFeatureTable(outLayerId, String(outGeo.type).toUpperCase(), 4326);
    }
    const outDao = gpkg.getFeatureDao(outLayerId);
    const newId = outDao.create(resultFeature);

    post('progress', { progress: 1 });
    post('result', { result: { ok: true, empty: false, outputLayerId: outLayerId, outputFeatureId: newId } });
  } finally {
    gpkg.close();
  }
}

if (workerData) {
  run().catch((e) => {
    post('error', { error: e?.message || String(e) });
  });
}

module.exports = { executeGeometryOperation, loadJsts };
