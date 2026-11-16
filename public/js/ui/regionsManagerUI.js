/**
 * RegionsManagerUI
 * Regions management interface
 */

class RegionsManagerUI {
    constructor() {
        this.regionsManager = null;
        this.filteredRegions = [];
        this.init();
    }

    /**
     * Initialize
     */
    init() {
        this.regionsManager = window.regionsManager;
        this.filteredRegions = [];
        this.setupEventHandlers();
        this.refresh();
    }

    /**
     * Set up event handlers
     */
    setupEventHandlers() {
        const searchInput = document.getElementById('regionSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterRegions();
            });
        }

        const dateStart = document.getElementById('dateFilterStart');
        const dateEnd = document.getElementById('dateFilterEnd');
        if (dateStart) {
            dateStart.addEventListener('change', () => {
                this.filterRegions();
            });
        }
        if (dateEnd) {
            dateEnd.addEventListener('change', () => {
                this.filterRegions();
            });
        }
    }

    /**
     * Refresh regions list
     */
    refresh() {
        const list = document.getElementById('regionsList');
        
        if (list) {
            if (this.filteredRegions.length === 0) {
                list.innerHTML = '<div class="sidebar-placeholder"><p class="sidebar-placeholder-title">No regions yet</p><p class="sidebar-placeholder-hint">Load a master tileset to discover and filter regions.</p></div>';
                return;
            }

            list.innerHTML = this.filteredRegions.map(region => `
                <div class="list-item" onclick="window.regionsManagerUI.loadRegion('${region.id}')">
                    <div>
                        <strong>${region.name}</strong>
                        <div class="list-item-meta">
                            ${region.date ? `Date: ${region.date}` : ''}
                            ${region.geometricError ? ` | Error: ${region.geometricError.toFixed(2)}` : ''}
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="event.stopPropagation(); window.regionsManagerUI.loadRegion('${region.id}')">Load</button>
                </div>
            `).join('');
        }
    }

    /**
     * Filter regions
     */
    filterRegions() {
        const searchInput = document.getElementById('regionSearch');
        const dateStart = document.getElementById('dateFilterStart');
        const dateEnd = document.getElementById('dateFilterEnd');

        let regions = this.regionsManager.getAllRegions();

        // Filter by name
        if (searchInput && searchInput.value) {
            regions = this.regionsManager.filterRegionsByName(searchInput.value);
        }

        // Filter by date
        if (dateStart || dateEnd) {
            regions = this.regionsManager.filterRegionsByDate(
                dateStart?.value,
                dateEnd?.value
            );
        }

        this.filteredRegions = regions;
        this.refresh();
    }

    /**
     * Load region
     */
    async loadRegion(regionId) {
        try {
            await this.regionsManager.loadRegion(regionId);
            window.notification?.success('Region loaded');
        } catch (error) {
            window.notification?.error('Failed to load region: ' + error.message);
        }
    }

    /**
     * Load master tileset
     */
    /**
     * @param {string} url
     * @param {boolean} [merge] - append regions from another master without clearing existing
     */
    async loadMasterTileset(url, merge = false) {
        try {
            await this.regionsManager.loadMasterTileset(url, { merge });
            this.filteredRegions = [...this.regionsManager.getAllRegions()];
            window.notification?.success(
                `Discovered ${this.regionsManager.getAllRegions().length} region entries (catalog)`
            );
            this.refresh();
        } catch (error) {
            window.notification?.error('Failed to load master tileset: ' + error.message);
        }
    }
}

// Export singleton instance
window.regionsManagerUI = new RegionsManagerUI();
