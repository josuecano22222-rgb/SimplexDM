/**
 * FileManager
 * Handles file system operations using File System Access API
 */

class FileManager {
    constructor() {
        this.fileHandleRegistry = null;
        this.pathResolver = null;
    }

    /**
     * Initialize with dependencies
     */
    init(fileHandleRegistry, pathResolver) {
        this.fileHandleRegistry = fileHandleRegistry;
        this.pathResolver = pathResolver;
    }

    /**
     * Check if File System Access API is available
     */
    isAvailable() {
        return this.fileHandleRegistry && this.fileHandleRegistry.isAvailable();
    }

    /**
     * Request directory selection from user
     */
    async selectDirectory() {
        if (!this.isAvailable()) {
            throw new Error('File System Access API not available');
        }
        
        try {
            const dirHandle = await this.fileHandleRegistry.requestDirectoryHandle();
            return dirHandle;
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Error selecting directory:', error);
            }
            return null;
        }
    }

    /**
     * Unified cross-platform file selection dialog (Electron IPC, File System Access API, or `<input type="file">`).
     * Automatically loads selected 3D tileset JSON, 3D models, spatial layers, or `.rlp` label packs when requested.
     */
    async openFileDialog(options = {}) {
        // 1. Electron native dialog (returns full OS filesystem paths)
        if (window.electronAPI && typeof window.electronAPI.openFileDialog === 'function') {
            const filters = options.filters || [
                { name: '3D Tiles & Geospatial', extensions: ['json', 'glb', 'gltf', 'geojson', 'kml', 'kmz', 'csv', 'rlp'] },
                { name: 'All Files', extensions: ['*'] },
            ];
            const res = await window.electronAPI.openFileDialog({
                title: options.title || 'Open Tileset, Model, or Geospatial File',
                filters,
                properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
            });
            if (res?.canceled || !res?.filePaths?.length) return null;
            const chosen = res.filePaths[0];
            if (options.autoLoad !== false) {
                await this._autoOpenSelectedPath(chosen);
            }
            return options.multiple ? res.filePaths : chosen;
        }

        // 2. File System Access API
        if (this.isAvailable()) {
            const handle = await this.selectFile(options);
            return handle;
        }

        // 3. Standard HTML `<input type="file">` fallback
        return await new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = options.accept || '.json,.glb,.gltf,.geojson,.kml,.kmz,.csv,.rlp';
            input.multiple = Boolean(options.multiple);
            input.style.display = 'none';
            document.body.appendChild(input);
            input.addEventListener('change', async () => {
                const file = input.files?.[0] || null;
                input.remove();
                if (!file) {
                    resolve(null);
                    return;
                }
                const fsPath = window.electronAPI?.getPathForFile?.(file) || file.path || '';
                if (fsPath && options.autoLoad !== false) {
                    await this._autoOpenSelectedPath(fsPath);
                    resolve(fsPath);
                    return;
                }
                resolve(file);
            });
            input.addEventListener('cancel', () => {
                input.remove();
                resolve(null);
            });
            input.click();
        });
    }

    async _autoOpenSelectedPath(filePath) {
        const lower = String(filePath || '').toLowerCase();
        if (lower.endsWith('.rlp') && window.electronAPI?.gis?.labels?.importRegion) {
            await window.electronAPI.gis.labels.importRegion(filePath);
            window.notification?.success?.('Label region pack imported');
        } else if (lower.endsWith('.json') && window.tilesetViewer?.loadTileset) {
            await window.tilesetViewer.loadTileset(filePath);
        }
    }

    /**
     * Request file selection from user
     */
    async selectFile(options = {}) {
        if (!this.isAvailable()) {
            throw new Error('File System Access API not available');
        }
        
        try {
            const fileHandle = await this.fileHandleRegistry.requestFileHandle(options);
            if (fileHandle) {
                // Store handle
                const path = await this.getPathFromHandle(fileHandle);
                this.fileHandleRegistry.storeHandle(path, fileHandle);
                return fileHandle;
            }
            return null;
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Error selecting file:', error);
            }
            return null;
        }
    }

    /**
     * Get path from file handle (approximation)
     */
    async getPathFromHandle(fileHandle) {
        // File handles don't expose paths directly
        // We'll use the filename as a key
        return fileHandle.name;
    }

    /**
     * Read file content
     */
    async readFile(pathOrHandle) {
        let fileHandle = pathOrHandle;
        
        // If it's a path string, try to get handle
        if (typeof pathOrHandle === 'string') {
            fileHandle = this.fileHandleRegistry.getHandle(pathOrHandle);
            
            if (!fileHandle) {
                // Fallback to HTTP fetch
                return await this.readFileViaHttp(pathOrHandle);
            }
        }
        
        if (!fileHandle) {
            throw new Error('File handle not found');
        }
        
        try {
            const file = await fileHandle.getFile();
            return await file.text();
        } catch (error) {
            console.error('Error reading file:', error);
            throw error;
        }
    }

    /**
     * Read file via HTTP (fallback)
     */
    async readFileViaHttp(path) {
        try {
            const resolved = await this.pathResolver.resolvePath(path);
            if (resolved && typeof resolved === 'object' && resolved.type === 'fileHandle' && resolved.handle) {
                const file = await resolved.handle.getFile();
                return await file.text();
            }
            const response = await fetch(resolved);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.text();
        } catch (error) {
            console.error('Error reading file via HTTP:', error);
            throw error;
        }
    }

    /**
     * Write file content via FileSystemFileHandle, managed config endpoint, or browser download fallback.
     */
    async writeFile(fileHandleOrPath, content) {
        if (!fileHandleOrPath) {
            throw new Error('File handle or path is required');
        }

        // FileSystemFileHandle
        if (typeof fileHandleOrPath === 'object' && typeof fileHandleOrPath.createWritable === 'function') {
            try {
                const writable = await fileHandleOrPath.createWritable();
                await writable.write(content);
                await writable.close();
                return true;
            } catch (error) {
                console.error('Error writing file handle:', error);
                throw error;
            }
        }

        if (typeof fileHandleOrPath === 'string') {
            // Check registered handle first
            const handle = this.fileHandleRegistry?.getHandle?.(fileHandleOrPath);
            if (handle && typeof handle.createWritable === 'function') {
                const writable = await handle.createWritable();
                await writable.write(content);
                await writable.close();
                return true;
            }

            // Managed server JSON endpoints (`app-config.json` and `site-content.json`)
            const norm = fileHandleOrPath.replace(/\\/g, '/').toLowerCase();
            const base = this.pathResolver?.baseUrl || window.location?.origin || '';
            if (norm.endsWith('config/app-config.json')) {
                const resp = await fetch(`${base}/api/app-config`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
                });
                if (!resp.ok) throw new Error(`Failed to save app-config.json (HTTP ${resp.status})`);
                return true;
            }
            if (norm.endsWith('site/site-content.json')) {
                const resp = await fetch(`${base}/api/site-content`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
                });
                if (!resp.ok) throw new Error(`Failed to save site-content.json (HTTP ${resp.status})`);
                return true;
            }

            // Fallback: trigger download of edited content
            return this.downloadContent(this.pathResolver?.getFilename?.(fileHandleOrPath) || 'edited-file.json', content);
        }

        throw new Error('Unsupported file target for writeFile');
    }

    downloadContent(filename, content, mimeType = 'application/json;charset=utf-8') {
        if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
            return false;
        }
        const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        const blob = new Blob([text], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
    }

    /**
     * List files in directory
     */
    async listFiles(dirHandle) {
        if (!dirHandle) {
            throw new Error('Directory handle is required');
        }
        
        const files = [];
        const dirs = [];
        
        try {
            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind === 'file') {
                    files.push({
                        name: name,
                        handle: handle,
                        type: 'file'
                    });
                } else {
                    dirs.push({
                        name: name,
                        handle: handle,
                        type: 'directory'
                    });
                }
            }
        } catch (error) {
            console.error('Error listing files:', error);
            throw error;
        }
        
        return { files, directories: dirs };
    }

    /**
     * Upload file
     */
    async uploadFile(file, targetDirHandle) {
        if (!targetDirHandle) {
            throw new Error('Target directory handle is required');
        }
        
        try {
            const fileHandle = await targetDirHandle.getFileHandle(file.name, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(file);
            await writable.close();
            return fileHandle;
        } catch (error) {
            console.error('Error uploading file:', error);
            throw error;
        }
    }

    /**
     * Download file
     */
    downloadFile(content, filename, mimeType = 'application/octet-stream') {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Get file extension
     */
    getFileExtension(filename) {
        const parts = filename.split('.');
        return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
    }

    /**
     * Check if file is JSON
     */
    isJsonFile(filename) {
        return this.getFileExtension(filename) === 'json';
    }

    /**
     * Check if file is B3DM
     */
    isB3dmFile(filename) {
        return this.getFileExtension(filename) === 'b3dm';
    }
}

// Export singleton instance
window.fileManager = new FileManager();
