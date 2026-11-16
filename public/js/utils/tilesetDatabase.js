/**
 * TilesetDatabase
 * Tileset metadata database using IndexedDB
 */

class TilesetDatabase {
    constructor() {
        this.db = null;
        this.dbName = 'tileset_database';
        this.dbVersion = 1;
        this.storeName = 'tilesets';
        this.init();
    }

    /**
     * Initialize IndexedDB
     */
    async init() {
        try {
            this.db = await this.openDB();
        } catch (error) {
            console.error('Failed to initialize TilesetDatabase:', error);
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
                    const store = db.createObjectStore(this.storeName, { keyPath: 'url' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    /**
     * Store tileset metadata
     */
    async storeTileset(url, tilesetJson) {
        if (!this.db) return;

        try {
            const metadata = {
                url: url,
                timestamp: Date.now(),
                geometricError: tilesetJson.geometricError,
                root: tilesetJson.root,
                asset: tilesetJson.asset,
                tileCount: this.countTiles(tilesetJson),
                nestedTilesets: this.findNestedTilesets(tilesetJson).length
            };

            const tx = this.db.transaction([this.storeName], 'readwrite');
            const store = tx.objectStore(this.storeName);
            await store.put(metadata);
            return metadata;
        } catch (error) {
            console.error('Failed to store tileset:', error);
            throw error;
        }
    }

    /**
     * Get tileset metadata
     */
    async getTileset(url) {
        if (!this.db) return null;

        try {
            const tx = this.db.transaction([this.storeName], 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.get(url);
            return await request;
        } catch (error) {
            console.error('Failed to get tileset:', error);
            return null;
        }
    }

    /**
     * Get all tilesets
     */
    async getAllTilesets() {
        if (!this.db) return [];

        try {
            const tx = this.db.transaction([this.storeName], 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.getAll();
            return await request;
        } catch (error) {
            console.error('Failed to get all tilesets:', error);
            return [];
        }
    }

    /**
     * Count tiles in tileset
     */
    countTiles(tilesetJson) {
        let count = 0;
        
        const traverse = (tile) => {
            count++;
            if (tile.children) {
                tile.children.forEach(child => traverse(child));
            }
        };
        
        if (tilesetJson.root) {
            traverse(tilesetJson.root);
        }
        
        return count;
    }

    /**
     * Find nested tilesets
     */
    findNestedTilesets(tilesetJson) {
        const nested = [];
        
        const traverse = (tile) => {
            if (tile.content && tile.content.uri && tile.content.uri.endsWith('.json')) {
                nested.push(tile.content.uri);
            }
            if (tile.children) {
                tile.children.forEach(child => traverse(child));
            }
        };
        
        if (tilesetJson.root) {
            traverse(tilesetJson.root);
        }
        
        return nested;
    }

    /**
     * Clear database
     */
    async clearDatabase() {
        if (!this.db) return;

        try {
            const tx = this.db.transaction([this.storeName], 'readwrite');
            const store = tx.objectStore(this.storeName);
            await store.clear();
            return true;
        } catch (error) {
            console.error('Failed to clear database:', error);
            throw error;
        }
    }
}

// Export singleton instance
window.tilesetDatabase = new TilesetDatabase();
