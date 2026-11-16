/**
 * DatabaseUI
 * Tileset database interface
 */

class DatabaseUI {
    constructor() {
        this.tilesetDatabase = null;
        this.init();
    }

    _t(path) {
        if (window.appI18n && typeof window.appI18n.t === 'function') {
            const v = window.appI18n.t(path);
            if (v !== path) return v;
        }
        return path;
    }

    /**
     * Initialize
     */
    init() {
        this.tilesetDatabase = window.tilesetDatabase;
        if (!this._localeBound) {
            this._localeBound = true;
            window.addEventListener('simplex:localeChanged', () => {
                const modal = document.getElementById('databaseModal');
                if (modal && modal.style.display !== 'none') {
                    this.refresh();
                }
            });
        }
    }

    show() {
        const modal = document.getElementById('databaseModal');
        if (modal) {
            modal.style.display = 'flex';
        }
        this.refresh();
    }

    hide() {
        const modal = document.getElementById('databaseModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    /**
     * Refresh database content
     */
    async refresh() {
        const container = document.querySelector('.database-content-area');
        if (!container) return;

        const tilesets = await this.tilesetDatabase.getAllTilesets();
        // Ensure tilesets is always an array
        const tilesetsArray = Array.isArray(tilesets) ? tilesets : [];
        const stats = this.calculateStatistics(tilesetsArray);

        const t = (k) => this._t('db.' + k);
        container.innerHTML = `
            <div class="database-stats">
                <div class="stat-card">
                    <h3>${stats.totalTilesets}</h3>
                    <p>${t('totalTilesets')}</p>
                </div>
                <div class="stat-card">
                    <h3>${stats.totalTiles}</h3>
                    <p>${t('totalTiles')}</p>
                </div>
                <div class="stat-card">
                    <h3>${stats.totalNested}</h3>
                    <p>${t('nestedTilesets')}</p>
                </div>
            </div>
            <div class="database-actions">
                <button class="btn btn-primary" id="syncAllBtn">${t('syncAll')}</button>
                <button class="btn" id="parseMasterBtn">${t('parseMaster')}</button>
                <button class="btn btn-danger" id="clearDatabaseBtn">${t('clearDatabase')}</button>
            </div>
            <div class="tileset-list">
                <h3>${t('storedTilesetsCount').replace(/\{count\}/g, String(tilesetsArray.length))}</h3>
                ${tilesetsArray.map(tileset => {
                    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                    const displayName = esc(window.pathResolver?.getTilesetName(tileset.url) || tileset.url);
                    return `
                    <div class="list-item">
                        <div>
                            <strong>${displayName}</strong>
                            <div style="font-size: calc(11px * var(--ui-fs-mul, 1)); color: var(--text-secondary);">
                                ${t('tiles')}: ${Number(tileset.tileCount) || 0} | 
                                ${t('nested')}: ${Number(tileset.nestedTilesets) || 0} |
                                ${tileset.timestamp ? new Date(tileset.timestamp).toLocaleDateString() : '—'}
                            </div>
                        </div>
                    </div>
                `;
                }).join('')}
            </div>
        `;

        // Set up event handlers
        document.getElementById('syncAllBtn')?.addEventListener('click', () => {
            this.syncAll();
        });
        document.getElementById('parseMasterBtn')?.addEventListener('click', () => {
            this.parseMaster();
        });
        document.getElementById('clearDatabaseBtn')?.addEventListener('click', () => {
            this.clearDatabase();
        });
    }

    /**
     * Calculate statistics
     */
    calculateStatistics(tilesets) {
        if (!Array.isArray(tilesets)) {
            tilesets = [];
        }
        return {
            totalTilesets: tilesets.length,
            totalTiles: tilesets.reduce((sum, t) => sum + (t.tileCount || 0), 0),
            totalNested: tilesets.reduce((sum, t) => sum + (t.nestedTilesets || 0), 0)
        };
    }

    /**
     * Synchronize all tilesets
     * Updates metadata for all stored tilesets by re-parsing their JSON files
     */
    async syncAll() {
        if (!this.tilesetDatabase) {
            window.notification?.error('Database not available');
            return;
        }

        window.notification?.info(this._t('db.syncing'));

        try {
            const tilesets = await this.tilesetDatabase.getAllTilesets();
            let synced = 0;
            let failed = 0;

            for (const tileset of tilesets) {
                try {
                    // Try to fetch and re-parse the tileset JSON
                    const url = tileset.url;
                    
                    // Check if it's a file path or URL
                    let tilesetUrl;
                    if (url.startsWith('http://') || url.startsWith('https://')) {
                        tilesetUrl = url;
                    } else {
                        // It's a file path - convert to origin-aware server URL
                        let originBase = window.pathResolver?.baseUrl || window.location.origin;
                        if (window.electronAPI?.isElectron === true && typeof window.electronAPI.getServerPort === 'function') {
                            const rawPort = await window.electronAPI.getServerPort();
                            const serverPort = Number.isFinite(Number(rawPort)) && Number(rawPort) > 0 ? Number(rawPort) : 8000;
                            originBase = `http://localhost:${serverPort}`;
                        }
                        tilesetUrl = `${originBase}/file?path=${encodeURIComponent(url)}`;
                    }

                    const response = await fetch(tilesetUrl);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch: ${response.statusText}`);
                    }

                    const tilesetJson = await response.json();
                    
                    // Re-store with updated metadata
                    await this.tilesetDatabase.storeTileset(url, tilesetJson);
                    synced++;
                } catch (error) {
                    console.error(`Failed to sync tileset ${tileset.url}:`, error);
                    failed++;
                }
            }

            const syncMsg = this._t('db.syncComplete')
                .replace(/\{synced\}/g, String(synced))
                .replace(/\{failed\}/g, String(failed));
            window.notification?.success(syncMsg);
            
            // Refresh the UI
            await this.refresh();
        } catch (error) {
            console.error('Synchronization error:', error);
            window.notification?.error(this._t('db.syncFailed') + error.message);
        }
    }

    /**
     * Parse master tileset
     * Scans for a master tileset.json file and parses all nested tilesets
     */
    async parseMaster() {
        if (!this.tilesetDatabase) {
            window.notification?.error('Database not available');
            return;
        }

        if (!window.fileManager) {
            window.notification?.error(this._t('db.fileManagerNotAvailable'));
            return;
        }

        window.notification?.info(this._t('db.parsingMaster'));

        try {
            // Prompt user to select master tileset file
            const selected = await window.fileManager.openFileDialog({
                autoLoad: false,
                filters: [
                    { name: 'Tileset JSON', extensions: ['json'] }
                ]
            });

            if (!selected) {
                window.notification?.info(this._t('db.noFileSelected'));
                return;
            }

            // Support string path, FileSystemFileHandle, or File object
            let masterUrl = '';
            let content = '';
            if (typeof selected === 'string') {
                masterUrl = selected;
                content = await window.fileManager.readFile(selected);
            } else if (typeof selected.getFile === 'function') {
                const f = await selected.getFile();
                masterUrl = selected.name || f.name;
                content = await f.text();
            } else if (typeof selected.text === 'function') {
                masterUrl = window.electronAPI?.getPathForFile?.(selected) || selected.path || selected.name;
                content = await selected.text();
            } else if (selected.path) {
                masterUrl = selected.path;
                content = await window.fileManager.readFile(selected.path);
            }

            const masterTileset = JSON.parse(content);

            // Store master tileset
            await this.tilesetDatabase.storeTileset(masterUrl, masterTileset);

            // Find and parse nested tilesets
            const nestedTilesets = this.tilesetDatabase.findNestedTilesets(masterTileset);
            let parsed = 1; // Count master tileset
            let failed = 0;

            // Parse each nested tileset
            const masterDir = window.pathResolver?.getDirectory(masterUrl) || '';
            for (const nestedUri of nestedTilesets) {
                try {
                    const nestedPath = window.pathResolver
                        ? await window.pathResolver.resolvePath(nestedUri, masterDir || null)
                        : nestedUri;

                    let nestedContent;
                    try {
                        nestedContent = await window.fileManager.readFile(nestedPath);
                    } catch (e) {
                        const altPath = window.pathResolver?.join
                            ? window.pathResolver.join(masterDir, nestedUri)
                            : `${masterDir}/${nestedUri}`;
                        nestedContent = await window.fileManager.readFile(altPath);
                    }

                    const nestedTileset = JSON.parse(nestedContent);
                    const storeKey = typeof nestedPath === 'string' ? nestedPath : nestedUri;
                    await this.tilesetDatabase.storeTileset(storeKey, nestedTileset);
                    parsed++;
                } catch (error) {
                    console.error(`Failed to parse nested tileset ${nestedUri}:`, error);
                    failed++;
                }
            }

            const pm = this._t('db.masterParsed')
                .replace(/\{parsed\}/g, String(parsed))
                .replace(/\{failed\}/g, String(failed));
            window.notification?.success(pm);

            // Refresh the UI
            await this.refresh();
        } catch (error) {
            console.error('Master tileset parsing error:', error);
            window.notification?.error(this._t('db.parseMasterFailed') + error.message);
        }
    }

    /**
     * Clear database
     */
    async clearDatabase() {
        const confirmed = await window.notification?.confirm(this._t('db.clearConfirm'));
        if (confirmed === 'ok') {
            try {
                await this.tilesetDatabase.clearDatabase();
                window.notification?.success(this._t('db.cleared'));
                this.refresh();
            } catch (error) {
                window.notification?.error(this._t('db.clearFailed') + error.message);
            }
        }
    }
}

// Export singleton instance
window.databaseUI = new DatabaseUI();
