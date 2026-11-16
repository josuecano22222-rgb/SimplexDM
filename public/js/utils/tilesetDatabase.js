/**
 * TilesetDatabase
 * Tileset metadata database backed by IndexedDB (with in-memory fallback when IndexedDB is unavailable).
 */

function idbRequestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
}

function idbTransactionComplete(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
}

class TilesetDatabase {
    constructor() {
        this.db = null;
        this.dbName = 'tileset_database';
        this.dbVersion = 1;
        this.storeName = 'tilesets';
        this._memoryFallback = new Map();
        this._initPromise = null;
        this.init();
    }

    async init() {
        if (this.db) return this.db;
        if (this._initPromise) return this._initPromise;
        if (typeof indexedDB === 'undefined') {
            return null;
        }
        this._initPromise = this.openDB()
            .then((db) => {
                this.db = db;
                return db;
            })
            .catch((error) => {
                console.warn('TilesetDatabase falling back to in-memory store:', error?.message || error);
                return null;
            })
            .finally(() => {
                this._initPromise = null;
            });
        return this._initPromise;
    }

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

    async storeTileset(url, tilesetJson = {}) {
        if (!url) throw new Error('Tileset URL is required');
        const metadata = {
            url,
            timestamp: Date.now(),
            geometricError: tilesetJson.geometricError ?? tilesetJson.root?.geometricError ?? null,
            root: tilesetJson.root || null,
            asset: tilesetJson.asset || { version: '1.0' },
            tileCount: this.countTiles(tilesetJson),
            nestedTilesets: this.findNestedTilesets(tilesetJson).length,
        };

        await this.init();
        if (!this.db) {
            this._memoryFallback.set(url, metadata);
            return metadata;
        }

        try {
            const tx = this.db.transaction([this.storeName], 'readwrite');
            const store = tx.objectStore(this.storeName);
            store.put(metadata);
            await idbTransactionComplete(tx);
            return metadata;
        } catch (error) {
            console.error('Failed to store tileset:', error);
            this._memoryFallback.set(url, metadata);
            return metadata;
        }
    }

    async getTileset(url) {
        if (!url) return null;
        await this.init();
        if (!this.db) {
            return this._memoryFallback.get(url) || null;
        }

        try {
            const tx = this.db.transaction([this.storeName], 'readonly');
            const store = tx.objectStore(this.storeName);
            const result = await idbRequestToPromise(store.get(url));
            return result || null;
        } catch (error) {
            console.error('Failed to get tileset:', error);
            return this._memoryFallback.get(url) || null;
        }
    }

    async getAllTilesets() {
        await this.init();
        if (!this.db) {
            return Array.from(this._memoryFallback.values());
        }

        try {
            const tx = this.db.transaction([this.storeName], 'readonly');
            const store = tx.objectStore(this.storeName);
            const list = await idbRequestToPromise(store.getAll());
            return Array.isArray(list) ? list : [];
        } catch (error) {
            console.error('Failed to get all tilesets:', error);
            return Array.from(this._memoryFallback.values());
        }
    }

    async deleteTileset(url) {
        if (!url) return false;
        this._memoryFallback.delete(url);
        await this.init();
        if (!this.db) return true;

        try {
            const tx = this.db.transaction([this.storeName], 'readwrite');
            tx.objectStore(this.storeName).delete(url);
            await idbTransactionComplete(tx);
            return true;
        } catch (error) {
            console.error('Failed to delete tileset:', error);
            return false;
        }
    }

    countTiles(tilesetJson) {
        if (!tilesetJson || !tilesetJson.root) return 0;
        let count = 0;
        const traverse = (tile) => {
            if (!tile) return;
            count++;
            if (Array.isArray(tile.children)) {
                tile.children.forEach(traverse);
            }
        };
        traverse(tilesetJson.root);
        return count;
    }

    findNestedTilesets(tilesetJson) {
        if (!tilesetJson || !tilesetJson.root) return [];
        const nested = [];
        const checkContent = (content) => {
            const uri = content?.uri || content?.url;
            if (typeof uri === 'string' && uri.split('?')[0].toLowerCase().endsWith('.json')) {
                nested.push(uri);
            }
        };
        const traverse = (tile) => {
            if (!tile) return;
            if (tile.content) checkContent(tile.content);
            if (Array.isArray(tile.contents)) tile.contents.forEach(checkContent);
            if (Array.isArray(tile.children)) tile.children.forEach(traverse);
        };
        traverse(tilesetJson.root);
        return nested;
    }

    async clearDatabase() {
        this._memoryFallback.clear();
        await this.init();
        if (!this.db) return true;

        try {
            const tx = this.db.transaction([this.storeName], 'readwrite');
            tx.objectStore(this.storeName).clear();
            await idbTransactionComplete(tx);
            return true;
        } catch (error) {
            console.error('Failed to clear database:', error);
            throw error;
        }
    }
}

window.TilesetDatabase = TilesetDatabase;
window.tilesetDatabase = new TilesetDatabase();
