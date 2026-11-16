'use strict';

/**
 * HTTPS download and SQLite schema verification helpers for label databases and `.rlp` packs.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const Database = require('./sqliteDriver');

const MAX_REDIRECTS = 16;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;

const REQUIRED_LABEL_COLUMNS = ['id', 'name', 'type', 'priority', 'zoom_min', 'zoom_max', 'lon', 'lat'];

/**
 * @param {import('electron').App} app
 * @returns {string[]}
 */
function manifestCandidatePaths(app) {
  const appPath = app && typeof app.getAppPath === 'function' ? app.getAppPath() : '';
  const out = [
    path.join(__dirname, '..', '..', '..', 'data', 'label-download-manifest.json'),
    appPath ? path.join(appPath, 'data', 'label-download-manifest.json') : '',
    appPath ? path.join(path.dirname(appPath), 'data', 'label-download-manifest.json') : '',
  ];
  if (process.resourcesPath) {
    out.push(path.join(process.resourcesPath, 'data', 'label-download-manifest.json'));
    out.push(path.join(path.dirname(process.resourcesPath), 'data', 'label-download-manifest.json'));
  }
  return [...new Set(out.filter(Boolean))];
}

/**
 * Normalize manifest schema so both flat (`worldBaseUrl`) and nested (`worldBase.url`) formats work.
 * @param {import('electron').App} app
 * @returns {object}
 */
function readDownloadManifest(app) {
  for (const p of manifestCandidatePaths(app)) {
    try {
      if (p && fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          const worldBaseUrl =
            parsed.worldBaseUrl || (parsed.worldBase && typeof parsed.worldBase.url === 'string' ? parsed.worldBase.url : '');
          const worldBaseSha256 =
            parsed.worldBaseSha256 ||
            (parsed.worldBase && typeof parsed.worldBase.sha256 === 'string' ? parsed.worldBase.sha256 : '');
          return {
            ...parsed,
            worldBaseUrl: worldBaseUrl || '',
            worldBaseSha256: worldBaseSha256 || '',
            regions: Array.isArray(parsed.regions) ? parsed.regions : [],
          };
        }
      }
    } catch (e) {
      console.warn('[labelDownloadService] manifest read failed:', p, e.message);
    }
  }
  return { worldBaseUrl: '', worldBaseSha256: '', regions: [] };
}

function requestOnce(urlString, redirectCount, opts) {
  const { allowHttp = false } = opts;
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error('Too many redirects'));
      return;
    }
    let u;
    try {
      u = new URL(urlString);
    } catch (_) {
      reject(new Error('Invalid URL'));
      return;
    }
    if (u.protocol === 'http:' && !allowHttp) {
      reject(new Error('HTTP is disabled for security. Use HTTPS (or allowHttp in development).'));
      return;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      reject(new Error('Only http(s) URLs are supported'));
      return;
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      urlString,
      {
        method: 'GET',
        headers: { 'User-Agent': 'SimplexDM/2.0 (labels)' },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400) {
          const raw = res.headers.location;
          const loc = Array.isArray(raw) ? raw[0] : raw;
          if (!loc) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode} without Location`));
            return;
          }
          res.resume();
          const next = new URL(loc, urlString).href;
          resolve(requestOnce(next, redirectCount + 1, opts));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(res);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * @param {string} filePath
 * @returns {Promise<string>} hex sha256
 */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const rs = fs.createReadStream(filePath);
    rs.on('error', reject);
    rs.on('data', (d) => hash.update(d));
    rs.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Verify that `filePath` is a valid SimplexDM label SQLite DB with `labels` and `labels_rtree`.
 * @param {string} filePath
 */
function verifyLabelsSqlite(filePath) {
  let db;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
  } catch (e) {
    throw new Error(`Not a valid SQLite file: ${e.message}`);
  }
  try {
    const labels = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='labels'")
      .get();
    if (!labels) throw new Error('Database is missing required table "labels"');

    const rtree = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='labels_rtree'")
      .get();
    if (!rtree) throw new Error('Database is missing required R-tree "labels_rtree"');

    const colRows = db.prepare('PRAGMA table_info(labels)').all();
    const cols = new Set(colRows.map((c) => c.name));
    for (const reqCol of REQUIRED_LABEL_COLUMNS) {
      if (!cols.has(reqCol)) {
        throw new Error(`Database table "labels" is missing required column "${reqCol}"`);
      }
    }
  } finally {
    if (db) {
      try {
        db.close();
      } catch (_) {
        /* ignore */
      }
    }
  }
}

/**
 * @param {string} urlString
 * @param {string} destPath
 * @param {{ onProgress?: (pct01: number, received: number, total: number) => void, maxBytes?: number, allowHttp?: boolean }} [options]
 */
async function downloadToFile(urlString, destPath, options = {}) {
  const { onProgress, maxBytes = DEFAULT_MAX_BYTES, allowHttp = false } = options;
  const res = await requestOnce(urlString, 0, { allowHttp });
  const cl = res.headers['content-length'];
  const total = cl ? parseInt(cl, 10) : 0;
  if (Number.isFinite(total) && total > maxBytes) {
    res.resume();
    throw new Error(`Remote file too large (${total} bytes)`);
  }

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.part`;
  if (fs.existsSync(tmp)) {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* ignore */
    }
  }

  let received = 0;
  const ws = fs.createWriteStream(tmp);

  try {
    await new Promise((resolve, reject) => {
      res.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received > maxBytes) {
          res.destroy();
          reject(new Error(`Download exceeded maximum size (${maxBytes} bytes)`));
          return;
        }
        if (onProgress) {
          const pct = total > 0 ? received / total : 0;
          onProgress(pct, received, total);
        }
      });
      res.pipe(ws);
    });
  } catch (e) {
    try {
      ws.destroy();
    } catch (_) {
      /* ignore */
    }
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (_) {
      /* ignore */
    }
    throw e;
  }

  await fs.promises.rename(tmp, destPath);
}

module.exports = {
  readDownloadManifest,
  manifestCandidatePaths,
  downloadToFile,
  sha256File,
  verifyLabelsSqlite,
  DEFAULT_MAX_BYTES,
};
