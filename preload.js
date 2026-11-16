/**
 * Preload Script
 *
 * Provides a secure, least-privilege IPC bridge between the Electron main
 * process and the isolated renderer process via `window.electronAPI`.
 *
 * @module Preload
 * @requires electron
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Get the port number of the local loopback HTTP server.
     * @returns {Promise<number>}
     */
    getServerPort: () => ipcRenderer.invoke('get-server-port'),

    /**
     * Get the application version from package.json.
     * @returns {Promise<string>}
     */
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),

    /**
     * Get the Electron userData directory path.
     * @returns {Promise<string>}
     */
    getAppPath: () => ipcRenderer.invoke('get-app-path'),

    /**
     * Open a native OS file or folder selection dialog and return full paths.
     * @param {{ title?: string, filters?: Array<{ name: string, extensions: string[] }>, properties?: string[] }} [opts]
     * @returns {Promise<{ canceled: boolean, filePaths: string[] }>}
     */
    openFileDialog: (opts) => ipcRenderer.invoke('dialog:open-file', opts || {}),

    /**
     * Resolve the filesystem path for a File object selected via `<input type="file">`
     * or HTML5 drag-and-drop (Electron 32+ replacement for removed `File.path`).
     * @param {File} file
     * @returns {string}
     */
    getPathForFile: (file) => {
        try {
            if (webUtils && typeof webUtils.getPathForFile === 'function' && file) {
                return webUtils.getPathForFile(file) || '';
            }
            return (file && typeof file.path === 'string' ? file.path : '') || '';
        } catch (_) {
            return '';
        }
    },

    /** @type {string} Operating system identifier ('win32', 'darwin', 'linux') */
    platform: process.platform,

    /** @type {boolean} True when NODE_ENV === 'development' */
    isDev: process.env.NODE_ENV === 'development',

    /**
     * Offline-first GIS and Map Labels IPC API.
     */
    gis: {
        project: {
            new: (args) => ipcRenderer.invoke('gis.project.new', args),
            open: () => ipcRenderer.invoke('gis.project.open'),
            openPath: (projectFolderPath) => ipcRenderer.invoke('gis.project.openPath', projectFolderPath),
            saveMetadata: (projectFolderPath, metadataPatch) =>
                ipcRenderer.invoke('gis.project.saveMetadata', projectFolderPath, metadataPatch),
            getRecent: () => ipcRenderer.invoke('gis.project.getRecent'),
        },
        layers: {
            list: (projectFolderPath) => ipcRenderer.invoke('gis.layers.list', projectFolderPath),
            createVector: (projectFolderPath, layerDef) =>
                ipcRenderer.invoke('gis.layers.createVector', projectFolderPath, layerDef),
            delete: (projectFolderPath, layerId) =>
                ipcRenderer.invoke('gis.layers.delete', projectFolderPath, layerId),
        },
        features: {
            query: (projectFolderPath, query) => ipcRenderer.invoke('gis.features.query', projectFolderPath, query),
            insert: (projectFolderPath, layerId, feature) =>
                ipcRenderer.invoke('gis.features.insert', projectFolderPath, layerId, feature),
            update: (projectFolderPath, layerId, featureId, patch) =>
                ipcRenderer.invoke('gis.features.update', projectFolderPath, layerId, featureId, patch),
            delete: (projectFolderPath, layerId, featureId) =>
                ipcRenderer.invoke('gis.features.delete', projectFolderPath, layerId, featureId),
        },
        io: {
            importFile: (projectFolderPath, importSpec) =>
                ipcRenderer.invoke('gis.import.file', projectFolderPath, importSpec),
            exportLayer: (projectFolderPath, exportSpec) =>
                ipcRenderer.invoke('gis.export.layer', projectFolderPath, exportSpec),
        },
        crs: {
            lookup: (query) => ipcRenderer.invoke('gis.crs.lookup', query),
            transform: (transformSpec) => ipcRenderer.invoke('gis.crs.transform', transformSpec),
        },
        geoprocess: {
            run: (projectFolderPath, jobSpec) => ipcRenderer.invoke('gis.geoprocess.run', projectFolderPath, jobSpec),
            cancel: (jobId) => ipcRenderer.invoke('gis.geoprocess.cancel', jobId),
        },
        offline: {
            status: (projectFolderPath) => ipcRenderer.invoke('gis.offline.status', projectFolderPath),
            integrityCheck: (projectFolderPath) => ipcRenderer.invoke('gis.offline.integrityCheck', projectFolderPath),
        },
        raster: {
            sample: (rasterPath, lonLat) => ipcRenderer.invoke('gis.raster.sample', rasterPath, lonLat),
        },
        labels: {
            queryViewport: (viewport, activeRegions, opts) =>
                ipcRenderer.invoke('gis.labels.queryViewport', viewport, activeRegions, opts),
            search: (query, opts) =>
                ipcRenderer.invoke('gis.labels.search', query, opts || {}),
            listRegions: () => ipcRenderer.invoke('gis.labels.listRegions'),
            importRegion: (rlpPath) => ipcRenderer.invoke('gis.labels.importRegion', rlpPath),
            setRegionEnabled: (regionId, enabled) =>
                ipcRenderer.invoke('gis.labels.setRegionEnabled', regionId, enabled),
            removeRegion: (regionId) => ipcRenderer.invoke('gis.labels.removeRegion', regionId),
            readDownloadManifest: () => ipcRenderer.invoke('gis.labels.readDownloadManifest'),
            getWorldBaseInfo: () => ipcRenderer.invoke('gis.labels.getWorldBaseInfo'),
            downloadWorldBase: (opts) => ipcRenderer.invoke('gis.labels.downloadWorldBase', opts || {}),
            downloadRegionPack: (opts) => ipcRenderer.invoke('gis.labels.downloadRegionPack', opts || {}),
            onImportProgress: (callback) => {
                const listener = (_event, detail) => {
                    try {
                        callback(detail);
                    } catch (_) {
                        /* ignore */
                    }
                };
                ipcRenderer.on('gis.labels.importProgress', listener);
                return () => ipcRenderer.removeListener('gis.labels.importProgress', listener);
            },
            onDownloadProgress: (callback) => {
                const listener = (_event, detail) => {
                    try {
                        callback(detail);
                    } catch (_) {
                        /* ignore */
                    }
                };
                ipcRenderer.on('gis.labels.downloadProgress', listener);
                return () => ipcRenderer.removeListener('gis.labels.downloadProgress', listener);
            },
        },
    },
});

if (process.env.NODE_ENV === 'development') {
    console.log('Preload script loaded');
}
