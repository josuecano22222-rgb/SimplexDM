/**
 * Preload Script
 * 
 * Provides a secure bridge between the Electron main process and renderer process.
 * This script runs in a context that has access to both Node.js APIs and the DOM,
 * but exposes only a limited, secure API to the renderer process via contextBridge.
 * 
 * This prevents the renderer process from directly accessing Node.js APIs, which
 * improves security by following the principle of least privilege.
 * 
 * @module Preload
 * @requires electron
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Electron API exposed to renderer process
 * 
 * This object provides secure access to Electron functionality without exposing
 * the full ipcRenderer or Node.js APIs to the renderer process.
 * 
 * @namespace electronAPI
 */
contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Get the port number of the local HTTP server
     * 
     * @returns {Promise<number>} Promise that resolves with the server port number
     */
    getServerPort: () => ipcRenderer.invoke('get-server-port'),
    
    /**
     * Get the application version
     * 
     * @returns {Promise<string>} Promise that resolves with the version string
     */
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    
    /**
     * Get the application data directory path
     * 
     * @returns {Promise<string>} Promise that resolves with the user data directory path
     */
    getAppPath: () => ipcRenderer.invoke('get-app-path'),
    
    /**
     * Platform information
     * 
     * @type {string}
     * @readonly
     * @example 'win32', 'darwin', 'linux'
     */
    platform: process.platform,
    
    /**
     * Development mode flag
     * 
     * @type {boolean}
     * @readonly
     */
    isDev: process.env.NODE_ENV === 'development'
    ,
    /**
     * GIS API (offline-first).
     * Heavy operations run in main process.
     */
    gis: {
        project: {
            new: (args) => ipcRenderer.invoke('gis.project.new', args),
            open: () => ipcRenderer.invoke('gis.project.open'),
            openPath: (projectFolderPath) => ipcRenderer.invoke('gis.project.openPath', projectFolderPath),
            saveMetadata: (projectFolderPath, metadataPatch) => ipcRenderer.invoke('gis.project.saveMetadata', projectFolderPath, metadataPatch),
            getRecent: () => ipcRenderer.invoke('gis.project.getRecent')
        },
        layers: {
            list: (projectFolderPath) => ipcRenderer.invoke('gis.layers.list', projectFolderPath),
            createVector: (projectFolderPath, layerDef) => ipcRenderer.invoke('gis.layers.createVector', projectFolderPath, layerDef),
            delete: (projectFolderPath, layerId) => ipcRenderer.invoke('gis.layers.delete', projectFolderPath, layerId)
        },
        features: {
            query: (projectFolderPath, query) => ipcRenderer.invoke('gis.features.query', projectFolderPath, query),
            insert: (projectFolderPath, layerId, feature) => ipcRenderer.invoke('gis.features.insert', projectFolderPath, layerId, feature),
            update: (projectFolderPath, layerId, featureId, patch) => ipcRenderer.invoke('gis.features.update', projectFolderPath, layerId, featureId, patch),
            delete: (projectFolderPath, layerId, featureId) => ipcRenderer.invoke('gis.features.delete', projectFolderPath, layerId, featureId)
        },
        io: {
            importFile: (projectFolderPath, importSpec) => ipcRenderer.invoke('gis.import.file', projectFolderPath, importSpec),
            exportLayer: (projectFolderPath, exportSpec) => ipcRenderer.invoke('gis.export.layer', projectFolderPath, exportSpec)
        },
        crs: {
            lookup: (query) => ipcRenderer.invoke('gis.crs.lookup', query),
            transform: (transformSpec) => ipcRenderer.invoke('gis.crs.transform', transformSpec)
        },
        geoprocess: {
            run: (projectFolderPath, jobSpec) => ipcRenderer.invoke('gis.geoprocess.run', projectFolderPath, jobSpec),
            cancel: (jobId) => ipcRenderer.invoke('gis.geoprocess.cancel', jobId)
        },
        offline: {
            status: (projectFolderPath) => ipcRenderer.invoke('gis.offline.status', projectFolderPath),
            integrityCheck: (projectFolderPath) => ipcRenderer.invoke('gis.offline.integrityCheck', projectFolderPath)
        },
        raster: {
            sample: (rasterPath, lonLat) => ipcRenderer.invoke('gis.raster.sample', rasterPath, lonLat)
        },
        labels: {
            queryViewport: (viewport, activeRegions, opts) =>
                ipcRenderer.invoke('gis.labels.queryViewport', viewport, activeRegions, opts),
            listRegions: () => ipcRenderer.invoke('gis.labels.listRegions'),
            importRegion: (rlpPath) => ipcRenderer.invoke('gis.labels.importRegion', rlpPath),
            setRegionEnabled: (regionId, enabled) =>
                ipcRenderer.invoke('gis.labels.setRegionEnabled', regionId, enabled),
            removeRegion: (regionId) => ipcRenderer.invoke('gis.labels.removeRegion', regionId),
            readDownloadManifest: () => ipcRenderer.invoke('gis.labels.readDownloadManifest'),
            getWorldBaseInfo: () => ipcRenderer.invoke('gis.labels.getWorldBaseInfo'),
            downloadWorldBase: (opts) => ipcRenderer.invoke('gis.labels.downloadWorldBase', opts || {}),
            downloadRegionPack: (opts) => ipcRenderer.invoke('gis.labels.downloadRegionPack', opts || {}),
            /**
             * @param {(detail: { pct: number, msg: string }) => void} callback
             * @returns {() => void} unsubscribe
             */
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
            /**
             * @param {(detail: { pct: number, msg: string }) => void} callback
             * @returns {() => void} unsubscribe
             */
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
    }
});

if (process.env.NODE_ENV === 'development') {
    console.log('Preload script loaded');
}
