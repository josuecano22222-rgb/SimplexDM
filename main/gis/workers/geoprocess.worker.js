const { workerData, parentPort } = require('worker_threads');
const jsts = require('jsts');
const { GeoPackageAPI } = require('@ngageoint/geopackage');

function post(type, payload) {
  parentPort.postMessage({ type, ...payload, jobId: workerData.jobId });
}

function toJstsGeometry(geojsonGeom) {
  const reader = new jsts.io.GeoJSONReader();
  return reader.read(geojsonGeom);
}

function fromJstsGeometry(geom) {
  const writer = new jsts.io.GeoJSONWriter();
  return writer.write(geom);
}

async function run() {
  const { project, jobSpec } = workerData;
  const op = String(jobSpec?.op || '').toLowerCase();
  const inputLayerId = jobSpec?.inputLayerId;
  if (!op || !inputLayerId) throw new Error('jobSpec.op and jobSpec.inputLayerId required');

  const gpkg = await GeoPackageAPI.open(project.gpkgPath);
  try {
    const featureDao = gpkg.getFeatureDao(inputLayerId);
    const all = [];
    for (const row of featureDao.queryForEach()) {
      all.push(featureDao.getFeatureRowAsGeoJSON(row));
      if (all.length % 250 === 0) post('progress', { progress: Math.min(0.9, all.length / 5000) });
      if (all.length >= 5000) break; // stage-1 cap; streaming will be added later
    }

    const reader = new jsts.io.GeoJSONReader();
    const writer = new jsts.io.GeoJSONWriter();
    const geoms = all
      .map((f) => f?.geometry)
      .filter(Boolean)
      .map((g) => reader.read(g));

    let outGeom = null;
    if (op === 'buffer') {
      const dist = Number(jobSpec?.distance || 0);
      if (!Number.isFinite(dist) || dist <= 0) throw new Error('buffer distance required');
      // Buffer each feature independently
      const buffered = geoms.map((g) => g.buffer(dist));
      outGeom = buffered.reduce((acc, g) => (acc ? acc.union(g) : g), null);
    } else if (op === 'dissolve') {
      outGeom = geoms.reduce((acc, g) => (acc ? acc.union(g) : g), null);
    } else if (op === 'union') {
      outGeom = geoms.reduce((acc, g) => (acc ? acc.union(g) : g), null);
    } else {
      throw new Error(`Unsupported geoprocess op: ${op}`);
    }

    post('progress', { progress: 0.95 });
    const outGeo = writer.write(outGeom);
    const resultFeature = { type: 'Feature', geometry: outGeo, properties: { op } };

    // Persist as new layer (simple)
    const outLayerId = String(jobSpec?.outputLayerId || `${inputLayerId}_${op}`).slice(0, 60);
    if (!(gpkg.getFeatureTables() || []).includes(outLayerId)) {
      gpkg.createFeatureTable(outLayerId, String(outGeo.type).toUpperCase(), 4326);
    }
    const outDao = gpkg.getFeatureDao(outLayerId);
    const newId = outDao.create(resultFeature);

    post('progress', { progress: 1 });
    post('result', { result: { ok: true, outputLayerId: outLayerId, outputFeatureId: newId } });
  } finally {
    gpkg.close();
  }
}

run().catch((e) => {
  post('error', { error: e?.message || String(e) });
});

