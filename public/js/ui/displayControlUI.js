/**
 * DisplayControlUI
 * Display control interface
 */

function __displayControlEscapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function __displayControlT(key) {
    if (window.appI18n && typeof window.appI18n.t === 'function') {
        return window.appI18n.t(key);
    }
    return key;
}

class DisplayControlUI {
    constructor() {
        this.displayControl = null;
        this.tilesetViewer = null;
        this.tilePositioning = null;
        this.init();
    }

    /**
     * Initialize
     */
    init() {
        this.displayControl = window.displayControl;
        this.tilesetViewer = window.tilesetViewer;
        this.tilePositioning = window.tilePositioning;
        this.setupEventHandlers();
        this.refresh();
    }

    /**
     * Set up event handlers
     */
    setupEventHandlers() {
        // Tileset selector
        const selector = document.getElementById('tilesetSelector');
        if (selector) {
            selector.addEventListener('change', async (e) => {
                if (e.target.value) {
                    if (e.target.value === '__quick_load__') {
                        // Show quick load dialog
                        if (window.pathInputUI) {
                            await window.pathInputUI.showPathInputDialog();
                        }
                        selector.value = ''; // Reset selector
                    } else {
                        await this.loadTileset(e.target.value);
                    }
                }
            });
        }

        // Add tileset button
        const addBtn = document.getElementById('addTilesetBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                this.showAddTilesetDialog();
            });
        }

        // Quality selector
        const qualitySelector = document.getElementById('qualitySelector');
        if (qualitySelector) {
            qualitySelector.addEventListener('change', (e) => {
                this.setQuality(e.target.value);
            });
        }

        // Rotation controls
        document.getElementById('rotateLeftPanelBtn')?.addEventListener('click', () => {
            this.rotateTileset('left');
        });
        document.getElementById('rotateRightPanelBtn')?.addEventListener('click', () => {
            this.rotateTileset('right');
        });
        document.getElementById('tiltUpPanelBtn')?.addEventListener('click', () => {
            this.tiltTileset('up');
        });
        document.getElementById('tiltDownPanelBtn')?.addEventListener('click', () => {
            this.tiltTileset('down');
        });

        // Position controls
        document.getElementById('moveNorthBtn')?.addEventListener('click', () => {
            this.moveTileset('north');
        });
        document.getElementById('moveSouthBtn')?.addEventListener('click', () => {
            this.moveTileset('south');
        });
        document.getElementById('moveEastBtn')?.addEventListener('click', () => {
            this.moveTileset('east');
        });
        document.getElementById('moveWestBtn')?.addEventListener('click', () => {
            this.moveTileset('west');
        });
        document.getElementById('moveUpBtn')?.addEventListener('click', () => {
            this.moveTileset('up');
        });
        document.getElementById('moveDownBtn')?.addEventListener('click', () => {
            this.moveTileset('down');
        });

        // Overlay controls
        document.getElementById('rotateLeftBtn')?.addEventListener('click', () => {
            this.rotateTileset('left');
        });
        document.getElementById('rotateRightBtn')?.addEventListener('click', () => {
            this.rotateTileset('right');
        });
        document.getElementById('tiltUpBtn')?.addEventListener('click', () => {
            this.tiltTileset('up');
        });
        document.getElementById('tiltDownBtn')?.addEventListener('click', () => {
            this.tiltTileset('down');
        });
    }

    /**
     * Refresh tileset list
     */
    refresh() {
        const tilesets = this.displayControl ? this.displayControl.getAllTilesets() : [];
        const list = document.getElementById('tilesetList');
        const selector = document.getElementById('tilesetSelector');

        if (list) {
            if (tilesets.length === 0) {
                list.innerHTML =
                    '<div class="tileset-list-empty sidebar-placeholder">' +
                    '<p class="sidebar-placeholder-title">' +
                    __displayControlEscapeHtml(__displayControlT('ui.rightSidebar.tilesetListEmptyTitle')) +
                    '</p><p class="sidebar-placeholder-hint">' +
                    __displayControlEscapeHtml(__displayControlT('ui.rightSidebar.tilesetListEmptyHint')) +
                    '</p></div>';
            } else {
                const visOn = __displayControlT('ui.rightSidebar.tilesetShow');
                const visOff = __displayControlT('ui.rightSidebar.tilesetHide');
                const fitL = __displayControlT('ui.rightSidebar.tilesetFit');
                const remL = __displayControlT('ui.rightSidebar.tilesetRemove');
                const ql = __displayControlT('ui.rightSidebar.quality');
                list.innerHTML = tilesets
                    .map((tileset) => {
                        const label = __displayControlEscapeHtml(
                            window.pathResolver?.getTilesetName(tileset.url) || tileset.url
                        );
                        const visLabel = __displayControlEscapeHtml(tileset.visible ? visOff : visOn);
                        const fitLe = __displayControlEscapeHtml(fitL);
                        const remLe = __displayControlEscapeHtml(remL);
                        return `
                    <div class="list-item tileset-list-item">
                        <div class="tileset-list-item-main">
                            <strong class="tileset-list-name">${label}</strong>
                            <div class="list-item-meta">${__displayControlEscapeHtml(ql)}: ${__displayControlEscapeHtml(tileset.quality)}</div>
                        </div>
                        <div class="list-item-actions tileset-list-actions">
                            <button type="button" class="btn btn-xs btn-icon btn-icon--tileset-row" onclick="window.displayControlUI.toggleVisibility('${tileset.id}')" title="${visLabel}" aria-label="${visLabel}">
                                <i class="fas fa-${tileset.visible ? 'eye-slash' : 'eye'}" aria-hidden="true"></i>
                            </button>
                            <button type="button" class="btn btn-xs btn-icon btn-icon--tileset-row" onclick="window.displayControlUI.fitToView('${tileset.id}')" title="${fitLe}" aria-label="${fitLe}">
                                <i class="fas fa-expand-arrows-alt" aria-hidden="true"></i>
                            </button>
                            <button type="button" class="btn btn-xs btn-icon btn-icon--tileset-row btn-icon--danger" onclick="window.displayControlUI.removeTileset('${tileset.id}')" title="${remLe}" aria-label="${remLe}">
                                <i class="fas fa-times" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>`;
                    })
                    .join('');
            }
        }

        this.refreshSelector();
    }

    /**
     * Refresh tileset selector dropdown
     */
    refreshSelector() {
        const selector = document.getElementById('tilesetSelector');
        if (!selector) return;

        // Update selector with paths
        const paths = window.pathManager ? window.pathManager.getPathsByType('tileset') : [];
        const currentValue = selector.value;
        
        const ph = __displayControlT('ui.rightSidebar.selectTilesetPlaceholder');
        const browse = __displayControlT('ui.rightSidebar.browseTilesetOption');
        selector.innerHTML =
            '<option value="">' + __displayControlEscapeHtml(ph) + '</option>' +
            paths.map((path) => `<option value="${path.path}">${path.name}</option>`).join('');

        selector.innerHTML += '<option value="__quick_load__">' + __displayControlEscapeHtml(browse) + '</option>';
        
        // Restore selection if still valid
        if (currentValue && paths.some(p => p.path === currentValue)) {
            selector.value = currentValue;
        }
    }

    /**
     * Load tileset
     */
    async loadTileset(url) {
        try {
            await this.displayControl.loadTileset(url);
            this.refresh();
        } catch (error) {
            const errorMessage = error?.message || error?.toString() || 'Unknown error';
            window.notification?.error('Failed to load tileset: ' + errorMessage);
        }
    }

    /**
     * Remove tileset
     */
    removeTileset(id) {
        this.displayControl.removeTileset(id);
        this.refresh();
    }

    /**
     * Toggle visibility
     */
    toggleVisibility(id) {
        const tileset = this.displayControl.currentTilesets.get(id);
        if (tileset) {
            this.displayControl.toggleTilesetVisibility(id, !tileset.visible);
            this.refresh();
        }
    }

    /**
     * Fit to view
     */
    async fitToView(id) {
        await this.displayControl.fitToView(id);
    }

    /**
     * Set quality
     */
    setQuality(quality) {
        this.displayControl.setDefaultQuality(quality);
    }

    /**
     * Rotate tileset
     */
    rotateTileset(direction) {
        if (this.tilePositioning) {
            const selectedId = this.getSelectedTilesetId();
            if (selectedId) {
                this.tilePositioning.rotateTileset(selectedId, direction, 5);
            } else {
                this.tilePositioning.rotateAllTilesets(direction, 5);
            }
        }
    }

    /**
     * Tilt tileset
     */
    tiltTileset(direction) {
        if (this.tilePositioning) {
            const selectedId = this.getSelectedTilesetId();
            if (selectedId) {
                this.tilePositioning.tiltTileset(selectedId, direction, 5);
            } else {
                this.tilePositioning.tiltAllTilesets(direction, 5);
            }
        }
    }

    /**
     * Move tileset
     */
    moveTileset(direction) {
        if (this.tilePositioning) {
            const stepSize = this.getStepSize();
            const selectedId = this.getSelectedTilesetId();
            const target = document.getElementById('targetSelector')?.value || 'selected';
            
            if (target === 'all' || !selectedId) {
                this.tilePositioning.moveAllTilesets(direction, stepSize);
            } else {
                this.tilePositioning.moveTileset(selectedId, direction, stepSize);
            }
        }
    }

    /**
     * Get step size
     */
    getStepSize() {
        const input = document.getElementById('stepSizeInput');
        const unit = document.getElementById('stepSizeUnit')?.value || 'm';
        const value = parseFloat(input?.value || 1);

        // Convert to meters
        switch (unit) {
            case 'cm':
                return value / 100;
            case 'km':
                return value * 1000;
            default:
                return value;
        }
    }

    /**
     * Get selected tileset ID
     */
    getSelectedTilesetId() {
        const tilesets = this.displayControl.getAllTilesets();
        return tilesets.length > 0 ? tilesets[0].id : null;
    }

    /**
     * Show add tileset dialog
     */
    async showAddTilesetDialog() {
        const url = await window.notification?.modal(
            'Add Tileset',
            '<input type="text" id="tilesetUrlInput" class="text-input" placeholder="Enter tileset URL or path" style="width: 100%;">',
            {
                buttons: [
                    { label: 'Cancel', action: 'cancel', class: 'btn' },
                    { label: 'Browse...', action: 'browse', class: 'btn' },
                    { label: 'Load', action: 'load', class: 'btn-primary' }
                ]
            }
        );

        if (url === 'load') {
            const input = document.getElementById('tilesetUrlInput');
            if (input && input.value) {
                await this.loadTileset(input.value);
            }
        } else if (url === 'browse') {
            // Browse for file
            try {
                const fileHandle = await window.fileManager?.selectFile();
                if (fileHandle) {
                    const path = await window.fileHandleRegistry?.getPathFromHandle(fileHandle);
                    if (path) {
                        await this.loadTileset(path);
                    } else {
                        // Fallback: use file name
                        await this.loadTileset(fileHandle.name);
                    }
                }
            } catch (error) {
                window.notification?.error('Failed to browse file: ' + error.message);
            }
        }
    }
}

// Export singleton instance
window.displayControlUI = new DisplayControlUI();
