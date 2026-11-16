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
            const url = await this.pathResolver.resolvePath(path);
            const response = await fetch(url);
            
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
     * Write file content
     */
    async writeFile(fileHandle, content) {
        if (!fileHandle) {
            throw new Error('File handle is required');
        }
        
        try {
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
            return true;
        } catch (error) {
            console.error('Error writing file:', error);
            throw error;
        }
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
