/**
 * FileHandleRegistry
 * Manages Windows File System Access API file handles
 */

class FileHandleRegistry {
    constructor() {
        this.handles = new Map();
        this.loadHandles();
    }

    /**
     * Check if File System Access API is available
     */
    isAvailable() {
        return 'showOpenFilePicker' in window && 'showDirectoryPicker' in window;
    }

    /**
     * Check if path is a Windows path
     */
    isWindowsPath(path) {
        return /^[A-Za-z]:/.test(path);
    }

    /**
     * Normalize path for storage
     * Uses pathResolver if available, otherwise falls back to simple normalization
     */
    normalizePath(path) {
        if (!path) return path;
        
        // Use pathResolver if available and initialized
        if (window.pathResolver && typeof window.pathResolver.normalizePath === 'function') {
            return window.pathResolver.normalizePath(path);
        }
        
        // Fallback: simple normalization (convert backslashes to forward slashes)
        return path.replace(/\\/g, '/');
    }

    /**
     * Store file handle with normalized path
     */
    storeHandle(path, handle) {
        const normalized = this.normalizePath(path);
        this.handles.set(normalized, handle);
        this.saveHandles();
    }

    /**
     * Get file handle by path
     */
    getHandle(path) {
        const normalized = this.normalizePath(path);
        return this.handles.get(normalized);
    }

    /**
     * Remove file handle
     */
    removeHandle(path) {
        const normalized = this.normalizePath(path);
        this.handles.delete(normalized);
        this.saveHandles();
    }

    /**
     * Check if handle exists for path
     */
    hasHandle(path) {
        const normalized = this.normalizePath(path);
        return this.handles.has(normalized);
    }

    /**
     * Get all stored paths
     */
    getAllPaths() {
        return Array.from(this.handles.keys());
    }

    /**
     * Save handles to IndexedDB
     */
    async saveHandles() {
        if (!('indexedDB' in window)) {
            return;
        }

        try {
            const db = await this.openDB();
            const tx = db.transaction(['handles'], 'readwrite');
            const store = tx.objectStore('handles');
            
            // Clear existing handles
            await store.clear();
            
            // Store handles (Note: File handles cannot be serialized, so we store paths only)
            // In a real implementation, you'd need to use a different approach
            // For now, we'll store paths and rely on user re-selecting files
            const paths = Array.from(this.handles.keys());
            for (const path of paths) {
                await store.put({ path, timestamp: Date.now() });
            }
            
            await tx.complete;
        } catch (error) {
            console.error('Failed to save handles:', error);
        }
    }

    /**
     * Load handles from IndexedDB
     */
    async loadHandles() {
        if (!('indexedDB' in window)) {
            return;
        }

        try {
            const db = await this.openDB();
            const tx = db.transaction(['handles'], 'readonly');
            const store = tx.objectStore('handles');
            const results = await new Promise((resolve, reject) => {
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            // Note: File handles cannot be restored from storage
            // User will need to re-select files
            const n = Array.isArray(results) ? results.length : 0;
            if (n > 0) {
                console.log('Loaded handle paths:', n);
            }
        } catch (error) {
            console.error('Failed to load handles:', error);
        }
    }

    /**
     * Open IndexedDB database
     */
    openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('meridian_handles', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('handles')) {
                    db.createObjectStore('handles', { keyPath: 'path' });
                }
            };
        });
    }

    /**
     * Request file handle from user
     */
    async requestFileHandle(options = {}) {
        if (!this.isAvailable()) {
            throw new Error('File System Access API not available');
        }

        try {
            const fileHandle = await window.showOpenFilePicker({
                multiple: false,
                types: options.types || [
                    {
                        description: 'JSON Files',
                        accept: { 'application/json': ['.json'] }
                    },
                    {
                        description: '3D Tiles',
                        accept: { 'application/json': ['.json', '.b3dm'] }
                    }
                ],
                ...options
            });

            if (fileHandle && fileHandle.length > 0) {
                return fileHandle[0];
            }
            
            return null;
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Error requesting file handle:', error);
            }
            return null;
        }
    }

    /**
     * Request directory handle from user
     */
    async requestDirectoryHandle() {
        if (!this.isAvailable()) {
            throw new Error('File System Access API not available');
        }

        try {
            const dirHandle = await window.showDirectoryPicker();
            return dirHandle;
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Error requesting directory handle:', error);
            }
            return null;
        }
    }

    /**
     * Get path from file handle (approximation)
     */
    async getPathFromHandle(fileHandle) {
        if (!fileHandle) return null;
        
        // File handles don't expose paths directly
        // We'll use the filename as a key and try to find matching stored handle
        const name = fileHandle.name;
        
        // Check if we have a stored handle with this name
        for (const [path, handle] of this.handles.entries()) {
            try {
                if (handle.name === name) {
                    return path;
                }
            } catch (e) {
                // Handle might be invalid, skip
            }
        }
        
        // Return name as fallback
        return name;
    }
}

// Export singleton instance
window.fileHandleRegistry = new FileHandleRegistry();
