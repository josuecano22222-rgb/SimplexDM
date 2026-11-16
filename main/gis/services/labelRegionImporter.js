'use strict';

/**
 * Validates and installs .rlp (zip: meta.json + data.db) into userData/label-data/regions.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const unzipper = require('unzipper');

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
   * @param {(pct: number, message: string) => void} onProgress
   */
  async importPack(rlpPath, onProgress = () => {}) {
    if (!this._app) throw new Error('LabelRegionImporter not configured');
    onProgress(5, 'Opening pack…');

    const directory = await unzipper.Open.file(rlpPath);
    let meta = null;
    /** @type {Buffer|null} */
    let dbBuffer = null;

    for (const file of directory.files) {
      const p = (file.path || '').replace(/\\/g, '/');
      if (file.type === 'Directory') continue;
      if (p === 'meta.json') {
        const buf = await file.buffer();
        try {
          meta = JSON.parse(buf.toString('utf8'));
        } catch {
          throw new Error('Corrupt meta.json in pack');
        }
      } else if (p === 'data.db') {
        onProgress(35, 'Reading database…');
        dbBuffer = await file.buffer();
      }
    }

    if (!meta || !meta.id) {
      throw new Error('Pack is missing meta.json or region id');
    }
    if (!dbBuffer || !dbBuffer.length) {
      throw new Error('Pack is missing data.db');
    }

    onProgress(70, 'Verifying integrity…');
    const sha = crypto.createHash('sha256').update(dbBuffer).digest('hex');
    if (meta.sha256 && sha !== meta.sha256) {
      throw new Error(`Checksum mismatch for region "${meta.id}". File may be corrupt.`);
    }

    const tmpDb = path.join(this.regionsDir, `_tmp_${Date.now()}.db`);
    const finalPath = path.join(this.regionsDir, `${meta.id}.db`);

    onProgress(85, `Installing "${meta.id}"…`);
    fs.writeFileSync(tmpDb, dbBuffer);

    try {
      if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
      fs.renameSync(tmpDb, finalPath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
      } catch (_) {
        /* ignore */
      }
      throw err;
    }

    const manifest = this._readManifest();
    manifest.installed = manifest.installed.filter((r) => r.id !== meta.id);
    manifest.installed.push({
      ...meta,
      sha256: sha,
      installedAt: new Date().toISOString(),
      enabled: true,
    });
    this._writeManifest(manifest);

    onProgress(100, `Region "${meta.id}" installed successfully.`);
    return meta;
  }

  listInstalled() {
    return this._readManifest().installed;
  }

  /**
   * @param {string} regionId
   * @param {boolean} enabled
   */
  setEnabled(regionId, enabled) {
    const m = this._readManifest();
    const r = m.installed.find((x) => x.id === regionId);
    if (r) {
      r.enabled = enabled;
      this._writeManifest(m);
    }
  }

  /**
   * @param {string} regionId
   */
  remove(regionId) {
    const dbPath = path.join(this.regionsDir, `${regionId}.db`);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const m = this._readManifest();
    m.installed = m.installed.filter((r) => r.id !== regionId);
    this._writeManifest(m);
  }

  _readManifest() {
    if (!fs.existsSync(this.manifestPath)) return { installed: [] };
    try {
      return JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
    } catch {
      return { installed: [] };
    }
  }

  /**
   * @param {{ installed: object[] }} data
   */
  _writeManifest(data) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.manifestPath, JSON.stringify(data, null, 2), 'utf8');
  }
}

module.exports = new LabelRegionImporter();
