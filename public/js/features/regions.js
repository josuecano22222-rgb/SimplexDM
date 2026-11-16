/**
 * RegionsManager
 * Region discovery and management
 */

class RegionsManager {
    constructor() {
        this.regions = [];
        /** @type {string|null} Kept for backward compatibility (last registered master). */
        this.masterTilesetUrl = null;
        this.tilesetProcessor = null;
        this.init();
    }

    /**
     * Initialize with dependencies
     */
    init() {
        this.tilesetProcessor = window.tilesetProcessor;
    }

    /**
     * Load master tileset and discover regions.
     * @param {string} url - Tileset JSON URL or resolvable path
     * @param {{ merge?: boolean }} [options] - merge=true appends regions from another master (multi-file workflows)
     */
    async loadMasterTileset(url, options = {}) {
        const merge = options.merge === true;
        try {
            this.masterTilesetUrl = url;

            let resolvedFetch = url;
            if (window.pathResolver && typeof window.pathResolver.resolvePath === 'function') {
                try {
                    resolvedFetch = await window.pathResolver.resolvePath(url);
                } catch {
                    resolvedFetch = url;
                }
            }

            const response = await fetch(resolvedFetch);
            const tilesetJson = await response.json();

            let masterBaseUrl = url;
            if (typeof url === 'string' && url.lastIndexOf('/') >= 0) {
                masterBaseUrl = url.substring(0, url.lastIndexOf('/'));
            }

            await this.discoverRegions(tilesetJson, {
                merge,
                masterBaseUrl,
                masterUrl: url
            });

            if (window.regionsManagerUI) {
                window.regionsManagerUI.filteredRegions = [...this.regions];
                window.regionsManagerUI.refresh();
            }

            return this.regions;
        } catch (error) {
            window.notification?.error('Failed to load master tileset: ' + error.message);
            throw error;
        }
    }

    /**
     * Remove regions discovered from a given master tileset URL (when that tileset is unloaded).
     * @param {string} masterUrl
     */
    removeRegionsForMasterUrl(masterUrl) {
        if (!masterUrl) return;
        this.regions = this.regions.filter((r) => r.masterUrl !== masterUrl);
        if (window.regionsManagerUI) {
            window.regionsManagerUI.filteredRegions = window.regionsManagerUI.filteredRegions.filter(
                (r) => r.masterUrl !== masterUrl
            );
            window.regionsManagerUI.refresh();
        }
    }

    /**
     * Discover regions from tileset
     * @param {object} tilesetJson
     * @param {{ merge?: boolean, masterBaseUrl?: string, masterUrl?: string }} [opts]
     */
    async discoverRegions(tilesetJson, opts = {}) {
        const { merge = false, masterBaseUrl = '', masterUrl = '' } = opts;
        if (!merge) {
            this.regions = [];
        } else if (masterUrl) {
            this.regions = this.regions.filter((r) => r.masterUrl !== masterUrl);
        }

        const masterLabel = masterUrl
            ? masterUrl.replace(/\\/g, '/').split('/').filter(Boolean).pop() || masterUrl
            : '';

        const traverse = (tile, path = 'root', depth = 0) => {
            if (tile.content && tile.content.uri) {
                const uri = tile.content.uri;

                if (uri.endsWith('.json')) {
                    const baseName = this.extractRegionName(uri);
                    const region = {
                        id: this.generateRegionId(),
                        name: masterLabel ? `${masterLabel} — ${baseName}` : baseName,
                        uri: uri,
                        path: path,
                        depth: depth,
                        geometricError: tile.geometricError,
                        boundingVolume: tile.boundingVolume,
                        date: this.extractDate(uri) || new Date().toISOString(),
                        masterBaseUrl: masterBaseUrl,
                        masterUrl: masterUrl
                    };

                    this.regions.push(region);
                }
            }

            if (tile.children && Array.isArray(tile.children)) {
                tile.children.forEach((child, index) => {
                    traverse(child, `${path}.children[${index}]`, depth + 1);
                });
            }
        };

        if (tilesetJson.root) {
            traverse(tilesetJson.root);
        }

        return this.regions;
    }

    /**
     * Extract region name from URI
     */
    extractRegionName(uri) {
        const parts = uri.split('/');
        const filename = parts[parts.length - 1];
        return filename.replace('.json', '').replace(/_/g, ' ');
    }

    /**
     * Extract date from URI or name
     */
    extractDate(uri) {
        // Try to extract date from filename
        const dateMatch = uri.match(/(\d{4})[_-](\d{2})[_-](\d{2})/);
        if (dateMatch) {
            return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        }
        return null;
    }

    /**
     * Filter regions by name
     */
    filterRegionsByName(searchTerm) {
        if (!searchTerm) {
            return this.regions;
        }
        
        const term = searchTerm.toLowerCase();
        return this.regions.filter(region => 
            region.name && region.name.toLowerCase().includes(term)
        );
    }
    
    /**
     * Clear search filter
     */
    clearSearch() {
        // Reset to show all regions
        if (window.regionsManagerUI) {
            const searchInput = document.getElementById('regionSearch');
            if (searchInput) {
                searchInput.value = '';
            }
            window.regionsManagerUI.filteredRegions = this.regions;
            window.regionsManagerUI.refresh();
        }
    }

    /**
     * Filter regions by date range
     */
    filterRegionsByDate(startDate, endDate) {
        if (!startDate && !endDate) {
            return this.regions;
        }
        
        return this.regions.filter(region => {
            const regionDate = new Date(region.date);
            if (startDate && regionDate < new Date(startDate)) {
                return false;
            }
            if (endDate && regionDate > new Date(endDate)) {
                return false;
            }
            return true;
        });
    }

    /**
     * Get all regions
     */
    getAllRegions() {
        return this.regions;
    }

    /**
     * Get region by ID
     */
    getRegion(id) {
        return this.regions.find(r => r.id === id);
    }

    /**
     * Load region tileset
     */
    async loadRegion(regionId) {
        const region = this.getRegion(regionId);
        if (!region) {
            throw new Error('Region not found');
        }

        let url = region.uri;
        const base =
            region.masterBaseUrl ||
            (this.masterTilesetUrl && this.masterTilesetUrl.lastIndexOf('/') >= 0
                ? this.masterTilesetUrl.substring(0, this.masterTilesetUrl.lastIndexOf('/'))
                : '');

        if (base && !/^https?:\/\//i.test(url) && !url.startsWith('file:')) {
            const b = base.replace(/\/+$/, '');
            const u = url.replace(/^\.?\//, '');
            url = `${b}/${u}`;
        }

        if (window.displayControl) {
            await window.displayControl.loadTileset(url, {
                fitToView: false,
                mergeRegionCatalog: false
            });
        }

        return url;
    }

    /**
     * Generate region ID
     */
    generateRegionId() {
        return `region_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Export singleton instance
window.regionsManager = new RegionsManager();
