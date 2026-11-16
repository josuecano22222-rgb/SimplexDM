'use strict';

const fs = require('fs');
const path = require('path');

const dbService = require('./labelDatabaseService');
const importer = require('./labelRegionImporter');
const downloader = require('./labelDownloadService');

const CH_PROGRESS = 'gis.labels.importProgress';
const CH_DOWNLOAD = 'gis.labels.downloadProgress';

/**
 * @param {{ ipcMain: import('electron').IpcMain, app: import('electron').App, dialog: import('electron').Dialog }} deps
 */
function registerLabelIpc(deps) {
  const { ipcMain, app, dialog } = deps;

  function sendDownloadProgress(event, pct, msg) {
    if (event && event.sender && !event.sender.isDestroyed()) {
      event.sender.send(CH_DOWNLOAD, { pct, msg });
    }
  }

  dbService.configure(app);
  importer.configure(app);
  dbService.loadWorldBase();

  ipcMain.handle('gis.labels.queryViewport', (_evt, viewport, activeRegions, opts) => {
    for (const id of activeRegions ?? []) {
      try {
        dbService.loadRegion(id);
      } catch (_) {
        /* skip missing */
      }
    }
    return dbService.queryViewport(viewport, activeRegions, opts || {});
  });

  ipcMain.handle('gis.labels.listRegions', () => importer.listInstalled());

  ipcMain.handle('gis.labels.importRegion', async (event, rlpPath) => {
    let filePath = rlpPath;
    if (!filePath) {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Import label region pack',
        filters: [{ name: 'Label Region Pack', extensions: ['rlp'] }],
        properties: ['openFile'],
      });
      if (canceled || !filePaths.length) return { canceled: true };
      filePath = filePaths[0];
    }

    const meta = await importer.importPack(filePath, (pct, msg) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(CH_PROGRESS, { pct, msg });
      }
    });
    return { canceled: false, meta };
  });

  ipcMain.handle('gis.labels.setRegionEnabled', (_evt, regionId, enabled) => {
    importer.setEnabled(regionId, enabled);
    if (enabled) {
      try {
        dbService.loadRegion(regionId);
      } catch (_) {
        /* ignore */
      }
    } else {
      dbService.unloadRegion(regionId);
    }
    return { ok: true };
  });

  ipcMain.handle('gis.labels.removeRegion', (_evt, regionId) => {
    dbService.unloadRegion(regionId);
    importer.remove(regionId);
    return { ok: true };
  });

  ipcMain.handle('gis.labels.readDownloadManifest', () => downloader.readDownloadManifest(app));

  ipcMain.handle('gis.labels.getWorldBaseInfo', () => {
    const userDest = path.join(dbService.dataDir, 'labels-world-base.db');
    return {
      userDataPath: userDest,
      userDataExists: fs.existsSync(userDest),
      loadedWorldBase: dbService.dbs.has('world-base'),
    };
  });

  /**
   * Download a labels-world-base.db from HTTPS into userData and reload.
   * @param {{ url?: string, sha256?: string, allowHttp?: boolean }} opts
   */
  ipcMain.handle('gis.labels.downloadWorldBase', async (event, opts) => {
    const options = opts && typeof opts === 'object' ? opts : {};
    let url = options.url;
    const allowHttp = !!options.allowHttp;
    const manifest = downloader.readDownloadManifest(app);
    if (!url && manifest.worldBaseUrl) url = manifest.worldBaseUrl;
    const expectSha = (options.sha256 || manifest.worldBaseSha256 || '').trim().toLowerCase();

    if (!url || typeof url !== 'string') {
      throw new Error(
        'No download URL. Paste an HTTPS link to a labels-world-base.db file, or set worldBaseUrl in data/label-download-manifest.json.'
      );
    }

    const finalPath = path.join(dbService.dataDir, 'labels-world-base.db');
    const stagingPath = path.join(dbService.dataDir, '_labels_world_staging.db');

    const onProgress = (pct01, received, total) => {
      const pct = Math.round(Math.min(99, Math.max(0, pct01 * 100)));
      const mb = (n) => (n / (1024 * 1024)).toFixed(1);
      let msg = `Downloading… ${pct}%`;
      if (total > 0) msg = `Downloading… ${mb(received)} / ${mb(total)} MB (${pct}%)`;
      sendDownloadProgress(event, pct, msg);
    };

    try {
      sendDownloadProgress(event, 0, 'Starting download…');
      if (fs.existsSync(stagingPath)) {
        try {
          fs.unlinkSync(stagingPath);
        } catch (_) {
          /* ignore */
        }
      }
      await downloader.downloadToFile(url, stagingPath, { onProgress, allowHttp });

      sendDownloadProgress(event, 99, 'Verifying database…');
      if (expectSha) {
        const h = (await downloader.sha256File(stagingPath)).toLowerCase();
        if (h !== expectSha) {
          throw new Error('SHA-256 checksum mismatch — file may be corrupt or tampered.');
        }
      }
      downloader.verifyLabelsSqlite(stagingPath);

      dbService.unloadWorldBase();
      if (fs.existsSync(finalPath)) {
        try {
          fs.unlinkSync(finalPath);
        } catch (e) {
          throw new Error(`Cannot replace existing database. Close Meridian and retry. (${e.message})`);
        }
      }
      try {
        const wal = `${finalPath}-wal`;
        const shm = `${finalPath}-shm`;
        if (fs.existsSync(wal)) fs.unlinkSync(wal);
        if (fs.existsSync(shm)) fs.unlinkSync(shm);
      } catch (_) {
        /* ignore */
      }
      fs.renameSync(stagingPath, finalPath);
      dbService.loadWorldBase();
      sendDownloadProgress(event, 100, 'World label database installed.');
      return { ok: true, path: finalPath };
    } catch (e) {
      try {
        if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
      } catch (_) {
        /* ignore */
      }
      throw e;
    }
  });

  /**
   * Download a .rlp pack from HTTPS and import it (same as local import).
   * @param {{ url?: string, allowHttp?: boolean }} opts
   */
  ipcMain.handle('gis.labels.downloadRegionPack', async (event, opts) => {
    const options = opts && typeof opts === 'object' ? opts : {};
    const url = options.url;
    const allowHttp = !!options.allowHttp;
    if (!url || typeof url !== 'string') {
      throw new Error('No URL. Paste an HTTPS link to a .rlp region pack.');
    }

    const tmp = path.join(importer.dataDir, `_region_dl_${Date.now()}.rlp`);
    const onDl = (pct01, received, total) => {
      const pct = Math.round(Math.min(95, Math.max(0, pct01 * 100)));
      const mb = (n) => (n / (1024 * 1024)).toFixed(1);
      let msg = `Downloading pack… ${pct}%`;
      if (total > 0) msg = `Downloading pack… ${mb(received)} / ${mb(total)} MB`;
      sendDownloadProgress(event, pct, msg);
    };

    try {
      await downloader.downloadToFile(url, tmp, {
        onProgress: onDl,
        allowHttp,
        maxBytes: 512 * 1024 * 1024,
      });
      const meta = await importer.importPack(tmp, (pct, msg) => {
        sendDownloadProgress(event, Math.max(pct, 96), msg);
      });
      try {
        fs.unlinkSync(tmp);
      } catch (_) {
        /* ignore */
      }
      sendDownloadProgress(event, 100, 'Region pack installed.');
      return { ok: true, meta };
    } catch (e) {
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch (_) {
        /* ignore */
      }
      throw e;
    }
  });

  app.on('before-quit', () => {
    try {
      dbService.closeAll();
    } catch (_) {
      /* ignore */
    }
  });

  if (process.env.NODE_ENV === 'development') {
    console.log('[registerLabelIpc] GIS label handlers registered');
  }
}

module.exports = { registerLabelIpc, CH_PROGRESS, CH_DOWNLOAD };
