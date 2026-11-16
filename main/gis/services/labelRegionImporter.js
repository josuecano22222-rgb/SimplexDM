'use strict';

/**
 * Validates and installs `.rlp` (zip: `meta.json` + `data.db`) into `userData/label-data/regions`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const unzipper = require('unzipper');

const dbService = require('./labelDatabaseService');
const { validateRegionId } = dbService;
const { verifyLabelsSqlite } = require('./labelDownloadService');

const MANIFEST_FILE = 'label-manifest.json';

class LabelRegionImporter {
  constructor() {
    this._app = null;
    this.dataDir = '';
    this.regionsDir = '';
    this.manifestPath = '';
  }

  /**
   * @param {import('electron').App} app
   */
  configure(app) {
    this._app = app;
    this.dataDir = path.join(app.getPath('userData'), 'label-data');
    this.regionsDir = path.join(this.dataDir, 'regions');
    this.manifestPath = path.join(this.dataDir, MANIFEST_FILE);
    fs.mkdirSync(this.regionsDir, { recursive: true });
  }

  /**
   * @param {string} rlpPath
   * @param {(pct: number, message: string) => void} [onProgress]
   */
  async importPack(rlpPath, onProgress = () => {}) {
    if (!this._app) throw new Error('LabelRegionImporter not configured');
    if (!rlpPath || typeof rlpPath !== 'string' || !fs.existsSync(rlpPath)) {
      throw new Error(`Region pack not found: ${rlpPath || '(empty path)'}`);
    }

    onProgress(5, 'Opening pack…');
    const directory = await unzipper.Open.file(rlpPath);
    let meta = null;
    /** @type {Buffer|null} */
    let dbBuffer = null;

    for (const file of directory.files) {
      if (file.type === 'Directory') continue;
      const normalized = String(file.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (normalized.includes('..')) {
        throw new Error('Unsafe path inside region pack archive');
      }
      const base = path.posix.basename(normalized);
      const depth = normalized.split('/').length;
      if (depth > 2) continue;

      if (base === 'meta.json' && !meta) {
        const buf = await file.buffer();
        try {
          meta = JSON.parse(buf.toString('utf8'));
        } catch (_) {
          throw new Error('Corrupt meta.json in pack');
        }
      } else if (base === 'data.db' && !dbBuffer) {
        onProgress(35, 'Reading database…');
        dbBuffer = await file.buffer();
      }
    }

    if (!meta || typeof meta !== 'object' || !meta.id) {
      throw new Error('Pack is missing meta.json or region id');
    }

    const safeId = validateRegionId(String(meta.id));
    meta.id = safeId;

    if (!dbBuffer || !dbBuffer.length) {
      throw new Error('Pack is missing data.db');
    }

    onProgress(65, 'Verifying checksum…');
    const sha = crypto.createHash('sha256').update(dbBuffer).digest('hex');
    if (meta.sha256 && String(meta.sha256).trim().toLowerCase() !== sha) {
      throw new Error(`Checksum mismatch for region "${safeId}". File may be corrupt.`);
    }

    fs.mkdirSync(this.regionsDir, { recursive: true });
    const tmpDb = path.join(this.regionsDir, `_tmp_${safeId}_${process.pid}_${Date.now()}.db`);
    const finalPath = path.join(this.regionsDir, `${safeId}.db`);

    onProgress(80, 'Verifying SQLite schema…');
    fs.writeFileSync(tmpDb, dbBuffer);

    try {
      verifyLabelsSqlite(tmpDb);

      onProgress(90, `Installing "${safeId}"…`);
      // Release any open SQLite handle before replacing an existing region file
      dbService.unloadRegion(safeId);
      for (const stale of [finalPath, `${finalPath}-wal`, `${finalPath}-shm`]) {
        if (fs.existsSync(stale)) {
          fs.unlinkSync(stale);
        }
      }
      fs.renameSync(tmpDb, finalPath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
      } catch (_) {
        /* ignore */
      }
      throw err;
    }

    const normalizedMeta = {
      ...meta,
      id: safeId,
      name: typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : safeId,
      sizeBytes: typeof meta.sizeBytes === 'number' ? meta.sizeBytes : dbBuffer.length,
      sha256: sha,
      installedAt: new Date().toISOString(),
      enabled: true,
    };

    const manifest = this._readManifest();
    manifest.installed = manifest.installed.filter((r) => r.id !== safeId);
    manifest.installed.push(normalizedMeta);
    this._writeManifest(manifest);

    // Load immediately so subsequent viewport queries see the new/updated pack
    try {
      dbService.loadRegion(safeId);
    } catch (_) {
      /* ignore if dbService not configured */
    }

    onProgress(100, `Region "${safeId}" installed successfully.`);
    return normalizedMeta;
  }

  listInstalled() {
    return this._readManifest().installed;
  }

  /**
   * @param {string} regionId
   * @param {boolean} enabled
   */
  setEnabled(regionId, enabled) {
    const safeId = validateRegionId(regionId);
    const m = this._readManifest();
    const r = m.installed.find((x) => x.id === safeId);
    if (r) {
      r.enabled = Boolean(enabled);
      this._writeManifest(m);
    }
  }

  /**
   * @param {string} regionId
   */
  remove(regionId) {
    const safeId = validateRegionId(regionId);
    dbService.unloadRegion(safeId);
    for (const file of [
      path.join(this.regionsDir, `${safeId}.db`),
      path.join(this.regionsDir, `${safeId}.db-wal`),
      path.join(this.regionsDir, `${safeId}.db-shm`),
    ]) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
    const m = this._readManifest();
    m.installed = m.installed.filter((r) => r.id !== safeId);
    this._writeManifest(m);
  }

  _readManifest() {
    if (!this.manifestPath || !fs.existsSync(this.manifestPath)) return { installed: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
      return Array.isArray(parsed?.installed) ? parsed : { installed: [] };
    } catch (_) {
      return { installed: [] };
    }
  }

  /**
   * @param {{ installed: object[] }} data
   */
  _writeManifest(data) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmpPath = `${this.manifestPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.manifestPath);
  }
}

const instance = new LabelRegionImporter();
instance.LabelRegionImporter = LabelRegionImporter;

module.exports = instance;
