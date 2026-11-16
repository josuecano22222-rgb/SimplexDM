/**
 * FloatingControlsUI
 * Floating control tiles displayed within the viewer area (like Meridian website)
 */

class FloatingControlsUI {
    constructor() {
        this.tilesetsContainer = null;
        this.init();
    }

    /**
     * Initialize floating controls
     */
    init() {
        this.createControlsContainer();
        this.renderTilesetControls();
        this.setupEventHandlers();
        
        // Initially hide floating controls - they'll be shown by app.js when sidebars are collapsed
        if (this.tilesetsContainer) {
            this.tilesetsContainer.style.display = 'none';
        }
    }

    /**
     * Create containers for floating controls
     */
    createControlsContainer() {
        const viewerContainer = document.querySelector('.viewer-container');
        if (!viewerContainer) return;

        // Create tileset controls container (top-left)
        this.tilesetsContainer = document.createElement('div');
        this.tilesetsContainer.id = 'floatingTilesetControls';
        this.tilesetsContainer.className = 'floating-tilesets-container';
        viewerContainer.appendChild(this.tilesetsContainer);
    }


    /**
     * Render tileset control tiles
     */
    renderTilesetControls() {
        if (!this.tilesetsContainer) return;

        const tilesets = window.displayControl ? window.displayControl.getAllTilesets() : [];
        
        let html = '';

        // Add tileset button
        html += `
            <div class="add-tileset-tile tileset-tile" id="floatingAddTilesetBtn">
                <div class="tileset-tile-body">
                    <button class="add-btn" title="Add Tileset">+</button>
                </div>
            </div>
        `;

        // Render each tileset
        tilesets.forEach(tileset => {
            const tilesetName = window.pathResolver?.getTilesetName(tileset.url) || tileset.url;
            html += `
                <div class="tileset-tile" data-tileset-id="${tileset.id}">
                    <div class="tileset-tile-header">
                        <span class="tileset-tile-label">${tilesetName}</span>
                        <button class="tileset-close-btn" data-tileset-id="${tileset.id}" title="Remove Tileset">×</button>
                    </div>
                    <div class="tileset-tile-body">
                        <div class="tileset-controls">
                            <button class="tileset-control-btn ${tileset.visible ? 'active' : ''}" 
                                    data-action="toggle" 
                                    data-tileset-id="${tileset.id}" 
                                    title="${tileset.visible ? 'Hide' : 'Show'}">
                                <i class="fas fa-eye${tileset.visible ? '' : '-slash'}"></i>
                            </button>
                            <button class="tileset-control-btn" 
                                    data-action="fit" 
                                    data-tileset-id="${tileset.id}" 
                                    title="Fit to View">
                                <i class="fas fa-expand"></i>
                            </button>
                            <button class="tileset-control-btn" 
                                    data-action="settings" 
                                    data-tileset-id="${tileset.id}" 
                                    title="Settings">
                                <i class="fas fa-cog"></i>
                            </button>
                        </div>
                        <div class="tileset-info">
                            <div class="tileset-quality">${tileset.quality || 'medium'}</div>
                        </div>
                    </div>
                </div>
            `;
        });

        this.tilesetsContainer.innerHTML = html;
    }

    /**
     * Set up event handlers
     */
    setupEventHandlers() {
        // Tileset controls
        this.tilesetsContainer?.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            const tilesetId = e.target.dataset.tilesetId || e.target.closest('[data-tileset-id]')?.dataset.tilesetId;
            
            if (action === 'toggle' && tilesetId) {
                const tileset = window.displayControl?.currentTilesets.get(tilesetId);
                if (tileset) {
                    window.displayControl?.toggleTilesetVisibility(tilesetId, !tileset.visible);
                    this.renderTilesetControls();
                }
            } else if (action === 'fit' && tilesetId) {
                window.displayControl?.fitToView(tilesetId);
            } else if (action === 'settings' && tilesetId) {
                this.showTilesetSettings(tilesetId);
            } else if (e.target.classList.contains('tileset-close-btn') || e.target.closest('.tileset-close-btn')) {
                const closeBtn = e.target.classList.contains('tileset-close-btn') ? e.target : e.target.closest('.tileset-close-btn');
                const id = closeBtn.dataset.tilesetId;
                if (id) {
                    window.displayControl?.removeTileset(id);
                    this.renderTilesetControls();
                }
            } else if (e.target.id === 'floatingAddTilesetBtn' || e.target.closest('#floatingAddTilesetBtn')) {
                this.showAddTilesetDialog();
            }
        });

        // Refresh tileset controls when tilesets change
        // Listen for tileset changes
        if (window.displayControl) {
            // Override methods to refresh floating controls
            const originalLoadTileset = window.displayControl.loadTileset.bind(window.displayControl);
            window.displayControl.loadTileset = async (...args) => {
                const result = await originalLoadTileset(...args);
                this.renderTilesetControls();
                return result;
            };

            const originalRemoveTileset = window.displayControl.removeTileset.bind(window.displayControl);
            window.displayControl.removeTileset = (...args) => {
                const result = originalRemoveTileset(...args);
                this.renderTilesetControls();
                return result;
            };

            const originalToggleTilesetVisibility = window.displayControl.toggleTilesetVisibility.bind(window.displayControl);
            window.displayControl.toggleTilesetVisibility = (...args) => {
                const result = originalToggleTilesetVisibility(...args);
                this.renderTilesetControls();
                return result;
            };
        }
    }

    /**
     * Show add tileset dialog
     */
    async showAddTilesetDialog() {
        if (window.displayControlUI) {
            await window.displayControlUI.showAddTilesetDialog();
            this.renderTilesetControls();
        }
    }

    /**
     * Show tileset settings
     */
    showTilesetSettings(tilesetId) {
        const tileset = window.displayControl?.currentTilesets.get(tilesetId);
        if (!tileset) return;

        window.notification?.modal(
            `Tileset Settings: ${window.pathResolver?.getTilesetName(tileset.url) || tileset.url}`,
            `
                <div class="form-group">
                    <label>Quality:</label>
                    <select id="tilesetQualitySelect" class="select-input">
                        <option value="low" ${tileset.quality === 'low' ? 'selected' : ''}>Low</option>
                        <option value="medium" ${tileset.quality === 'medium' ? 'selected' : ''}>Medium</option>
                        <option value="high" ${tileset.quality === 'high' ? 'selected' : ''}>High</option>
                        <option value="ultra" ${tileset.quality === 'ultra' ? 'selected' : ''}>Ultra</option>
                    </select>
                </div>
            `,
            {
                buttons: [
                    { label: 'Cancel', action: 'cancel', class: 'btn' },
                    { label: 'Apply', action: 'apply', class: 'btn-primary' }
                ]
            }
        ).then(result => {
            if (result === 'apply') {
                const quality = document.getElementById('tilesetQualitySelect')?.value;
                if (quality && window.displayControl) {
                    window.displayControl.setQuality(tilesetId, quality);
                    this.renderTilesetControls();
                }
            }
        });
    }

    /**
     * Refresh tileset controls
     */
    refresh() {
        this.renderTilesetControls();
    }
}

// Export singleton instance
window.floatingControlsUI = new FloatingControlsUI();
