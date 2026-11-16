/**
 * PathManager
 * Manages file path storage and retrieval using IndexedDB
 */

class PathManager {
    constructor() {
        this.db = null;
        this.dbName = 'meridian_paths';
        this.dbVersion = 1;
        this.storeName = 'paths';
        this.paths = new Map();
        this.init();
    }

    /**
     * Initialize IndexedDB
     */
    async init() {
        try {
            this.db = await this.openDB();
            await this.loadPaths();
        } catch (error) {
            console.error('Failed to initialize PathManager:', error);
            // Fallback to localStorage
            this.useLocalStorage = true;
            await this.loadPathsFromLocalStorage();
        }
    }

    /**
     * Open IndexedDB database
     */
    openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('type', 'type', { unique: false });
                    store.createIndex('enabled', 'enabled', { unique: false });
                }
            };
        });
    }

    /**
     * Load all paths from IndexedDB
     */
    async loadPaths() {
        if (!this.db) {
            await this.loadPathsFromLocalStorage();
            return;
        }
        
        try {
            const tx = this.db.transaction([this.storeName], 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.getAll();
            
            const paths = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            
            this.paths.clear();
            
            if (Array.isArray(paths)) {
                paths.forEach(path => {
                    this.paths.set(path.id, path);
                });
            }
            
            return Array.from(this.paths.values());
        } catch (error) {
            console.error('Failed to load paths:', error);
            // Fallback to localStorage
            await this.loadPathsFromLocalStorage();
            return [];
        }
    }

    /**
     * Load paths from localStorage (fallback)
     */
    async loadPathsFromLocalStorage() {
        try {
            const stored = localStorage.getItem('meridian_paths');
            if (stored) {
                const paths = JSON.parse(stored);
                this.paths.clear();
                paths.forEach(path => {
                    this.paths.set(path.id, path);
                });
            }
        } catch (error) {
            console.error('Failed to load paths from localStorage:', error);
        }
    }

    /**
     * Save paths to IndexedDB
     */
    async savePath(path) {
        if (!path.id) {
            path.id = this.generateId();
        }
        
        if (!path.timestamp) {
            path.timestamp = Date.now();
        }
        
        this.paths.set(path.id, path);
        
        if (this.useLocalStorage || !this.db) {
            return this.savePathToLocalStorage(path);
        }
        
        try {
            const tx = this.db.transaction([this.storeName], 'readwrite');
            const store = tx.objectStore(this.storeName);
            await new Promise((resolve, reject) => {
                const req = store.put(path);
                req.onerror = () => reject(req.error);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
            });
            return path;
        } catch (error) {
            console.error('Failed to save path:', error);
            return this.savePathToLocalStorage(path);
        }
    }

    /**
     * Save path to localStorage (fallback)
     */
    async savePathToLocalStorage(path) {
        try {
            const paths = Array.from(this.paths.values());
            localStorage.setItem('meridian_paths', JSON.stringify(paths));
            return path;
        } catch (error) {
            console.error('Failed to save path to localStorage:', error);
            throw error;
        }
    }

    /**
     * Get path by ID
     */
    getPath(id) {
        return this.paths.get(id);
    }

    /**
     * Get all paths
     */
    getAllPaths() {
        return Array.from(this.paths.values());
    }

    /**
     * Get paths by type
     */
    getPathsByType(type) {
        return Array.from(this.paths.values()).filter(p => p.type === type);
    }

    /**
     * Get enabled paths
     */
    getEnabledPaths() {
        return Array.from(this.paths.values()).filter(p => p.enabled !== false);
    }

    /**
     * Add new path
     */
    async addPath(path, type = 'tileset', enabled = true) {
        const pathObj = {
            id: this.generateId(),
            path: path,
            type: type,
            enabled: enabled,
            name: this.extractName(path),
            timestamp: Date.now()
        };
        
        return await this.savePath(pathObj);
    }

    /**
     * Update path
     */
    async updatePath(id, updates) {
        const path = this.paths.get(id);
        if (!path) {
            throw new Error(`Path with id ${id} not found`);
        }
        
        Object.assign(path, updates);
        return await this.savePath(path);
    }

    /**
     * Delete path
     */
    async deletePath(id) {
        this.paths.delete(id);
        
        if (this.useLocalStorage || !this.db) {
            return this.deletePathFromLocalStorage(id);
        }
        
        try {
            const tx = this.db.transaction([this.storeName], 'readwrite');
            const store = tx.objectStore(this.storeName);
            await new Promise((resolve, reject) => {
                const req = store.delete(id);
                req.onerror = () => reject(req.error);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
            });
            return true;
        } catch (error) {
            console.error('Failed to delete path:', error);
            return this.deletePathFromLocalStorage(id);
        }
    }

    /**
     * Delete path from localStorage (fallback)
     */
    async deletePathFromLocalStorage(id) {
        try {
            const paths = Array.from(this.paths.values());
            localStorage.setItem('meridian_paths', JSON.stringify(paths));
            return true;
        } catch (error) {
            console.error('Failed to delete path from localStorage:', error);
            throw error;
        }
    }

    /**
     * Toggle path enabled state
     */
    async togglePath(id) {
        const path = this.paths.get(id);
        if (!path) {
            throw new Error(`Path with id ${id} not found`);
        }
        
        path.enabled = !path.enabled;
        return await this.savePath(path);
    }

    /**
     * Extract name from path
     */
    extractName(path) {
        if (!path) return 'Untitled';
        
        // Remove path separators and get filename
        const parts = path.replace(/\\/g, '/').split('/');
        let name = parts[parts.length - 1] || path;
        
        // Remove extension
        const extIndex = name.lastIndexOf('.');
        if (extIndex > 0) {
            name = name.substring(0, extIndex);
        }
        
        return name || 'Untitled';
    }

    /**
     * Validate path
     */
    validatePath(path) {
        if (!path || typeof path !== 'string') {
            return { valid: false, warning: 'Path is required' };
        }
        
        // Check if path looks valid
        if (path.trim().length === 0) {
            return { valid: false, warning: 'Path cannot be empty' };
        }
        
        return { valid: true };
    }

    /**
     * Import paths from JSON
     */
    async importPaths(jsonData) {
        try {
            let paths;
            if (typeof jsonData === 'string') {
                try {
                    paths = JSON.parse(jsonData);
                } catch (e) {
                    throw new Error('Invalid JSON format: ' + e.message);
                }
            } else {
                paths = jsonData;
            }
            
            // Handle different formats
            if (Array.isArray(paths)) {
                // Array of path objects or strings
                const imported = [];
                for (const pathData of paths) {
                    if (typeof pathData === 'string') {
                        // Simple string path
                        const path = await this.addPath(pathData, 'tileset', true);
                        imported.push(path);
                    } else if (typeof pathData === 'object' && pathData !== null) {
                        // Path object with properties
                        const path = await this.addPath(
                            pathData.path || pathData.url || pathData.name,
                            pathData.type || 'tileset',
                            pathData.enabled !== false
                        );
                        imported.push(path);
                    }
                }
                return imported;
            } else if (typeof paths === 'object' && paths !== null) {
                // Single object or object with paths array
                if (paths.paths && Array.isArray(paths.paths)) {
                    return await this.importPaths(paths.paths);
                } else if (paths.path) {
                    // Single path object
                    const path = await this.addPath(
                        paths.path || paths.url || paths.name,
                        paths.type || 'tileset',
                        paths.enabled !== false
                    );
                    return [path];
                } else {
                    throw new Error('Invalid import format: expected array or object with paths property');
                }
            } else {
                throw new Error('Invalid import format: expected array or object');
            }
        } catch (error) {
            console.error('Failed to import paths:', error);
            throw error;
        }
    }

    /**
     * Export paths to JSON
     */
    exportPaths() {
        const paths = Array.from(this.paths.values());
        return JSON.stringify(paths, null, 2);
    }

    /**
     * Generate unique ID
     */
    generateId() {
        return `path_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Export singleton instance
window.pathManager = new PathManager();
