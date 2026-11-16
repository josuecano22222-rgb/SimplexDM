/**
 * PathInputUI
 * Provides easy path input interface for loading tilesets
 */

class PathInputUI {
    constructor() {
        this.initialized = false;
        this.init();
    }

    /**
     * Initialize path input UI
     */
    init() {
        if (this.initialized) return;
        
        // Setup quick access immediately - use requestAnimationFrame for DOM readiness
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.setupQuickAccess();
            });
        } else {
            requestAnimationFrame(() => {
                this.setupQuickAccess();
            });
        }
        
        this.initialized = true;
    }

    /**
     * Show path input dialog
     */
    async showPathInputDialog() {
        const result = await window.notification?.modal(
            'Load Tileset',
            `
                <div style="min-width: 500px;">
                    <div class="form-group" style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 600;">Enter Tileset Path or URL:</label>
                        <input type="text" id="tilesetPathInput" class="text-input" 
                               placeholder="e.g., data/Cesium_Ashkelon_2025_V1_split.json" 
                               style="width: 100%; padding: 10px; font-size: calc(14px * var(--ui-fs-mul, 1));">
                        <div style="margin-top: 8px; font-size: calc(12px * var(--ui-fs-mul, 1)); color: var(--text-secondary);">
                            <p>Examples:</p>
                            <ul style="margin: 5px 0; padding-left: 20px;">
                                <li>Relative: <code>data/file.json</code></li>
                                <li>Windows: <code>C:/path/to/file.json</code></li>
                                <li>HTTP: <code>http://localhost:8001/data/file.json</code></li>
                            </ul>
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom: 15px;">
                        <label style="display: flex; align-items: center; gap: 10px;">
                            <input type="checkbox" id="savePathCheckbox" checked>
                            <span>Save path for future use</span>
                        </label>
                    </div>
                </div>
            `,
            {
                buttons: [
                    { label: 'Browse File...', action: 'browse', class: 'btn' },
                    { label: 'Cancel', action: 'cancel', class: 'btn' },
                    { label: 'Load', action: 'load', class: 'btn-primary' }
                ],
                closable: true
            }
        );

        if (result === 'load') {
            const input = document.getElementById('tilesetPathInput');
            const savePath = document.getElementById('savePathCheckbox')?.checked;
            
            if (!input || !input.value) {
                window.notification?.warning('Please enter a tileset path');
                return;
            }

            const path = input.value.trim();
            
            // Validate input
            if (!window.inputValidator) {
                // Fallback if validator not loaded
                if (path.length === 0) {
                    window.notification?.warning('Please enter a tileset path');
                    return;
                }
            } else {
                const validation = window.inputValidator.validateFilePath(path);
                if (!validation.valid) {
                    window.notification?.error(validation.message || 'Invalid file path');
                    return;
                }
            }
            
            await this.loadTileset(path, savePath);
        } else if (result === 'browse') {
            await this.browseForFile();
        }
    }

    /**
     * Load tileset from path
     */
    async loadTileset(path, savePath = true) {
        try {
            // Save path if requested
            if (savePath && window.pathManager) {
                try {
                    await window.pathManager.addPath(path, 'tileset', true);
                } catch (e) {
                    console.warn('Failed to save path:', e);
                }
            }

            // Load tileset
            if (window.displayControl) {
                await window.displayControl.loadTileset(path);
            } else if (window.tilesetViewer) {
                await window.tilesetViewer.loadTileset(path);
                window.notification?.success('Tileset loaded successfully');
            } else {
                window.notification?.error('Display control not available');
            }
        } catch (error) {
            const errorMessage = error?.message || error?.toString() || 'Unknown error';
            window.notification?.error('Failed to load tileset: ' + errorMessage);
            console.error('Load tileset error:', error);
        }
    }

    /**
     * Browse for file
     */
    async browseForFile() {
        try {
            if (window.fileManager && window.fileManager.isAvailable()) {
                const fileHandle = await window.fileManager.selectFile({
                    types: [
                        {
                            description: 'JSON Files',
                            accept: { 'application/json': ['.json'] }
                        }
                    ]
                });

                if (fileHandle) {
                    // Get path from handle
                    const path = await window.fileHandleRegistry?.getPathFromHandle(fileHandle);
                    
                    // Store handle
                    if (path && window.fileHandleRegistry) {
                        window.fileHandleRegistry.storeHandle(path, fileHandle);
                    }

                    // Load tileset
                    await this.loadTileset(path || fileHandle.name, true);
                }
            } else {
                window.notification?.warning('File System Access API not available. Please enter path manually.');
            }
        } catch (error) {
            window.notification?.error('Failed to browse file: ' + error.message);
        }
    }

    /**
     * Setup quick access from display control
     */
    setupQuickAccess() {
        const displaySection = document.getElementById('displayControlSection');
        if (!displaySection) {
            requestAnimationFrame(() => this.setupQuickAccess());
            return;
        }

        const contentWrapper = displaySection.querySelector('.section-content-wrapper');
        if (!contentWrapper) {
            requestAnimationFrame(() => this.setupQuickAccess());
            return;
        }

        // Remove duplicate quick-load rows (legacy injectors or hot reload)
        const rows = contentWrapper.querySelectorAll('[data-display-quick-load]');
        rows.forEach((row, i) => {
            if (i > 0) row.remove();
        });

        let button = document.getElementById('quickLoadTilesetBtn');
        if (!button) {
            let row = contentWrapper.querySelector('[data-display-quick-load]');
            if (!row) {
                row = document.createElement('div');
                row.className = 'display-control-quick-load rs-quick-load';
                row.setAttribute('data-display-quick-load', 'true');
                contentWrapper.insertBefore(row, contentWrapper.firstChild);
            } else {
                row.classList.add('rs-quick-load');
            }
            button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-primary btn-icon btn-icon--tileset';
            button.id = 'quickLoadTilesetBtn';
            button.setAttribute('data-i18n-title', 'ui.rightSidebar.quickLoadTileset');
            button.setAttribute('data-i18n-aria', 'ui.rightSidebar.quickLoadTileset');
            button.innerHTML =
                '<i class="fas fa-folder-open" aria-hidden="true"></i><span class="visually-hidden" data-i18n="ui.rightSidebar.quickLoadTileset">Load tileset</span>';
            row.appendChild(button);
            if (window.appI18n && typeof window.appI18n.applyDom === 'function') {
                window.appI18n.applyDom(button);
            }
        }
        /* click: wired by frontendIntegration.connectButton('quickLoadTilesetBtn', ...) */
    }
}

// Export singleton instance
window.pathInputUI = new PathInputUI();
