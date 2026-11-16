/**
 * SplitScreenManager
 * Split screen for temporal comparison (Meridian Design - Pages 51-52)
 * Features: Screen splitting, year selection, side-by-side comparison, interactive slider
 */

class SplitScreenManager {
    constructor() {
        this.tilesetViewer = null;
        this.modal = null;
        this.isActive = false;
        this.splitPosition = 0.5; // 0.0 to 1.0
        this.leftYear = null;
        this.rightYear = null;
        this.leftViewer = null;
        this.rightViewer = null;
        this.splitContainer = null;
        this.slider = null;
        this._dividerDragging = false;
        this._dividerMouseMoveHandler = null;
        this._dividerMouseUpHandler = null;
        this.init();
    }

    /**
     * Initialize split screen manager
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.createSplitScreenModal();
        this.setupEventHandlers();
    }

    /**
     * Create split screen modal
     */
    createSplitScreenModal() {
        // Remove existing if any
        const existing = document.getElementById('splitScreenModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'splitScreenModal';
        modal.className = 'split-screen-modal map-tool-panel-overlay';
        modal.style.display = 'none';

        const currentYear = new Date().getFullYear();
        const availableYears = [];
        for (let i = currentYear; i >= currentYear - 10; i--) {
            availableYears.push(i);
        }

        modal.innerHTML = `
            <div class="split-screen-content">
                <div class="split-screen-header">
                    <h2>Split Screen</h2>
                    <button class="close-btn" id="closeSplitScreenBtn">×</button>
                </div>
                <div class="split-screen-body">
                    <div class="split-screen-icon-container">
                        <div class="split-screen-icon">⛶</div>
                    </div>
                    
                    <div class="split-screen-instructions">
                        <p>Compare different years side-by-side to see changes over time.</p>
                        <p>Use the slider to adjust the split position.</p>
                    </div>

                    <div class="split-screen-controls">
                        <div class="year-selection-group">
                            <div class="year-selector">
                                <label>Left Side Year:</label>
                                <select id="leftYearSelect" class="select-input">
                                    <option value="">Select Year...</option>
                                    ${availableYears.map(year => `<option value="${year}">${year}</option>`).join('')}
                                </select>
                            </div>
                            <div class="year-selector">
                                <label>Right Side Year:</label>
                                <select id="rightYearSelect" class="select-input">
                                    <option value="">Select Year...</option>
                                    ${availableYears.map(year => `<option value="${year}">${year}</option>`).join('')}
                                </select>
                            </div>
                        </div>

                        <div class="split-control-group">
                            <label>Split Position:</label>
                            <div class="split-slider-container">
                                <input type="range" id="splitPositionSlider" 
                                       class="split-slider" 
                                       min="0" max="100" value="50" step="1">
                                <div class="split-slider-labels">
                                    <span>Left</span>
                                    <span>Right</span>
                                </div>
                            </div>
                        </div>

                        <div class="split-toggle-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="syncCameraCheckbox" checked>
                                <span>Sync Camera Movement</span>
                            </label>
                        </div>
                    </div>

                    <div class="split-screen-actions">
                        <button class="btn btn-primary" id="activateSplitScreenBtn">
                            <span>▶</span> Activate Split Screen
                        </button>
                        <button class="btn" id="deactivateSplitScreenBtn" style="display: none;">
                            <span>⏹</span> Deactivate
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        this.modal?.querySelector('#closeSplitScreenBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
        });

        if (!this._escapeListener) {
            this._escapeListener = (e) => {
                if (e.code !== 'Escape') return;
                if (!this.modal || window.getComputedStyle(this.modal).display === 'none') return;
                e.preventDefault();
                this.hide();
            };
            document.addEventListener('keydown', this._escapeListener, { passive: false });
        }

        // Activate split screen
        document.getElementById('activateSplitScreenBtn')?.addEventListener('click', () => {
            this.activateSplitScreen();
        });

        // Deactivate split screen
        document.getElementById('deactivateSplitScreenBtn')?.addEventListener('click', () => {
            this.deactivateSplitScreen();
        });

        // Split position slider
        const slider = document.getElementById('splitPositionSlider');
        if (slider) {
            slider.addEventListener('input', (e) => {
                this.splitPosition = parseFloat(e.target.value) / 100;
                this.updateSplitPosition();
            });
        }

        // Year selections
        document.getElementById('leftYearSelect')?.addEventListener('change', (e) => {
            this.leftYear = e.target.value ? parseInt(e.target.value) : null;
            if (this.isActive) {
                this.updateLeftView();
            }
        });

        document.getElementById('rightYearSelect')?.addEventListener('change', (e) => {
            this.rightYear = e.target.value ? parseInt(e.target.value) : null;
            if (this.isActive) {
                this.updateRightView();
            }
        });
    }

    /**
     * Show split screen modal
     */
    show() {
        if (this.modal) {
            this.modal.style.display = 'flex';
        }
    }

    /**
     * Hide split screen modal
     */
    hide() {
        if (this.isActive) {
            this.deactivateSplitScreen();
        }
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }

    /**
     * Toggle split screen modal
     */
    toggle() {
        if (this.modal && this.modal.style.display === 'none') {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Activate split screen
     */
    activateSplitScreen() {
        if (!this.leftYear || !this.rightYear) {
            if (window.notification) {
                window.notification.warning(
                    window.appI18n?.nt ? window.appI18n.nt('splitYearsBoth') : 'Please select years for both sides'
                );
            }
            return;
        }

        if (!this.tilesetViewer || !this.tilesetViewer.viewer) {
            if (window.notification) {
                window.notification.error(
                    window.appI18n?.nt ? window.appI18n.nt('viewerNotReady') : 'Viewer not ready'
                );
            }
            return;
        }

        this.isActive = true;
        this.createSplitView();

        // Update UI
        document.getElementById('activateSplitScreenBtn').style.display = 'none';
        document.getElementById('deactivateSplitScreenBtn').style.display = 'inline-flex';

        if (window.notification) {
            window.notification.success(
                window.appI18n?.nt ? window.appI18n.nt('splitActivated') : 'Split screen activated'
            );
        }
    }

    /**
     * Create split view
     */
    createSplitView() {
        const viewerContainer = document.getElementById('cesiumContainer');
        if (!viewerContainer) return;

        // Hide original viewer
        viewerContainer.style.display = 'none';

        // Create split container
        this.splitContainer = document.createElement('div');
        this.splitContainer.id = 'splitScreenContainer';
        this.splitContainer.className = 'split-screen-container';
        this.splitContainer.innerHTML = `
            <div class="split-screen-left" id="splitScreenLeft">
                <div class="split-screen-label">${this.leftYear}</div>
            </div>
            <div class="split-screen-divider" id="splitScreenDivider">
                <div class="split-screen-handle"></div>
            </div>
            <div class="split-screen-right" id="splitScreenRight">
                <div class="split-screen-label">${this.rightYear}</div>
            </div>
        `;

        viewerContainer.parentElement.appendChild(this.splitContainer);

        // Create left viewer
        this.createLeftViewer();
        
        // Create right viewer
        this.createRightViewer();

        // Setup divider interaction
        this.setupDividerInteraction();

        // Update split position
        this.updateSplitPosition();
    }

    /**
     * Create left viewer
     */
    createLeftViewer() {
        const leftContainer = document.getElementById('splitScreenLeft');
        if (!leftContainer) return;

        // Create container for Cesium viewer
        const viewerDiv = document.createElement('div');
        viewerDiv.id = 'leftCesiumContainer';
        viewerDiv.className = 'cesium-viewer';
        viewerDiv.style.width = '100%';
        viewerDiv.style.height = '100%';
        viewerDiv.style.position = 'relative';
        leftContainer.appendChild(viewerDiv);

        // Initialize Cesium viewer for left side
        this.initializeViewerForYear('leftCesiumContainer', this.leftYear);
    }

    /**
     * Create right viewer
     */
    createRightViewer() {
        const rightContainer = document.getElementById('splitScreenRight');
        if (!rightContainer) return;

        // Create container for Cesium viewer
        const viewerDiv = document.createElement('div');
        viewerDiv.id = 'rightCesiumContainer';
        viewerDiv.className = 'cesium-viewer';
        viewerDiv.style.width = '100%';
        viewerDiv.style.height = '100%';
        viewerDiv.style.position = 'relative';
        rightContainer.appendChild(viewerDiv);

        // Initialize Cesium viewer for right side
        this.initializeViewerForYear('rightCesiumContainer', this.rightYear);
    }

    /**
     * Initialize viewer for specific year
     * Creates a new Cesium viewer instance for the split screen
     */
    async initializeViewerForYear(containerId, year) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Clear container
        container.innerHTML = '';

        // Check if Cesium is available
        if (typeof Cesium === 'undefined') {
            container.innerHTML = `
                <div class="split-viewer-placeholder">
                    <div class="placeholder-year">${year}</div>
                    <div class="placeholder-note">CesiumJS not available</div>
                </div>
            `;
            return;
        }

        try {
            // Set Cesium base URL
            if (window.CESIUM_BASE_URL) {
                Cesium.buildModuleUrl.setBaseUrl(window.CESIUM_BASE_URL);
            }

            // Disable Ion
            if (Cesium.Ion) {
                Cesium.Ion.defaultAccessToken = '';
            }

            // Get base URL for tile loading
            const raw = await window.electronAPI?.getServerPort();
            const serverPort =
                Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : 8000;
            const baseUrl = `http://localhost:${serverPort}`;

            // Create new Cesium viewer
            const viewer = new Cesium.Viewer(container, {
                terrainProvider: new Cesium.EllipsoidTerrainProvider(),
                imageryProvider: new Cesium.SingleTileImageryProvider({
                    url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                    rectangle: Cesium.Rectangle.MAX_VALUE
                }),
                baseLayerPicker: false,
                geocoder: false,
                homeButton: false,
                sceneModePicker: false,
                navigationHelpButton: false,
                animation: false,
                timeline: false,
                fullscreenButton: false,
                vrButton: false,
                infoBox: false,
                selectionIndicator: false,
                creditContainer: container, // Hide credits
                requestRenderMode: false,
                maximumRenderTimeChange: Infinity
            });

            // Hide Cesium credits
            const creditContainer = viewer.creditContainer;
            if (creditContainer) {
                creditContainer.style.display = 'none';
            }

            // Try to load tileset for this year
            // Look for tilesets that match the year pattern
            if (window.displayControl) {
                const allTilesets = window.displayControl.getAllTilesets();
                const yearTilesets = allTilesets.filter(tileset => {
                    // Check if tileset name or path contains the year
                    const name = tileset.name || tileset.url || '';
                    return name.includes(year.toString());
                });

                if (yearTilesets.length > 0) {
                    // Load the first matching tileset
                    const tilesetUrl = yearTilesets[0].url;
                    try {
                        const tileset = await viewer.scene.primitives.add(
                            await Cesium.Cesium3DTileset.fromUrl(tilesetUrl)
                        );
                        
                        // Fly to tileset bounds
                        await viewer.zoomTo(tileset);
                    } catch (error) {
                        console.warn(`Failed to load tileset for year ${year}:`, error);
                    }
                }
            }

            // Store viewer reference
            if (containerId === 'leftCesiumContainer') {
                this.leftViewer = viewer;
            } else if (containerId === 'rightCesiumContainer') {
                this.rightViewer = viewer;
            }

            // Set up camera synchronization if enabled
            this.setupCameraSync();

            requestAnimationFrame(() => {
                try {
                    viewer.resize();
                } catch (resizeErr) {
                    /* ignore */
                }
            });

        } catch (error) {
            console.error(`Failed to initialize viewer for year ${year}:`, error);
            container.innerHTML = `
                <div class="split-viewer-placeholder">
                    <div class="placeholder-year">${year}</div>
                    <div class="placeholder-note">Failed to initialize viewer</div>
                    <div class="placeholder-hint">${error.message}</div>
                </div>
            `;
        }
    }

    /**
     * Setup camera synchronization between left and right viewers
     */
    setupCameraSync() {
        const syncCheckbox = document.getElementById('syncCameraCheckbox');
        if (!syncCheckbox || !this.leftViewer || !this.rightViewer) return;

        // Remove existing handlers
        if (this._leftCameraHandler) {
            this.leftViewer.camera.changed.removeEventListener(this._leftCameraHandler);
        }
        if (this._rightCameraHandler) {
            this.rightViewer.camera.changed.removeEventListener(this._rightCameraHandler);
        }

        // Create new handlers
        this._leftCameraHandler = () => {
            if (syncCheckbox.checked && !this._syncing) {
                this._syncing = true;
                this.syncCamera(this.leftViewer, this.rightViewer);
                requestAnimationFrame(() => {
                    this._syncing = false;
                });
            }
        };

        this._rightCameraHandler = () => {
            if (syncCheckbox.checked && !this._syncing) {
                this._syncing = true;
                this.syncCamera(this.rightViewer, this.leftViewer);
                requestAnimationFrame(() => {
                    this._syncing = false;
                });
            }
        };

        // Add listeners
        this.leftViewer.camera.changed.addEventListener(this._leftCameraHandler);
        this.rightViewer.camera.changed.addEventListener(this._rightCameraHandler);
    }

    /**
     * Synchronize camera from source to target viewer
     */
    syncCamera(sourceViewer, targetViewer) {
        if (!sourceViewer || !targetViewer) return;

        const sourceCamera = sourceViewer.camera;
        const targetCamera = targetViewer.camera;

        // Copy camera position and orientation
        targetCamera.position = sourceCamera.position.clone();
        targetCamera.direction = sourceCamera.direction.clone();
        targetCamera.up = sourceCamera.up.clone();
        targetCamera.right = sourceCamera.right.clone();
        targetViewer.scene.requestRender();
    }

    /**
     * Setup divider interaction
     */
    setupDividerInteraction() {
        const divider = document.getElementById('splitScreenDivider');
        if (!divider) return;

        divider.addEventListener('mousedown', (e) => {
            this._dividerDragging = true;
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });

        if (this._dividerMouseMoveHandler) {
            document.removeEventListener('mousemove', this._dividerMouseMoveHandler);
        }
        if (this._dividerMouseUpHandler) {
            document.removeEventListener('mouseup', this._dividerMouseUpHandler);
        }

        this._dividerMouseMoveHandler = (e) => {
            if (!this._dividerDragging) return;

            const container = this.splitContainer;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const position = Math.max(0.1, Math.min(0.9, x / rect.width));
            
            this.splitPosition = position;
            this.updateSplitPosition();

            // Update slider
            document.getElementById('splitPositionSlider').value = position * 100;
        };
        document.addEventListener('mousemove', this._dividerMouseMoveHandler);

        this._dividerMouseUpHandler = () => {
            this._dividerDragging = false;
            document.body.style.cursor = '';
        };
        document.addEventListener('mouseup', this._dividerMouseUpHandler);
    }

    /**
     * Update split position
     */
    updateSplitPosition() {
        if (!this.splitContainer) return;

        const leftPanel = document.getElementById('splitScreenLeft');
        const rightPanel = document.getElementById('splitScreenRight');
        const divider = document.getElementById('splitScreenDivider');

        if (leftPanel && rightPanel && divider) {
            leftPanel.style.width = `${this.splitPosition * 100}%`;
            rightPanel.style.width = `${(1 - this.splitPosition) * 100}%`;
            divider.style.left = `${this.splitPosition * 100}%`;
        }

        requestAnimationFrame(() => {
            try {
                if (this.leftViewer) this.leftViewer.resize();
                if (this.rightViewer) this.rightViewer.resize();
            } catch (e) {
                /* ignore */
            }
        });
    }

    /**
     * Update left view
     */
    async updateLeftView() {
        if (!this.isActive || !this.leftYear) return;
        
        // Destroy existing viewer
        if (this.leftViewer) {
            try {
                this.leftViewer.destroy();
            } catch (e) {
                console.warn('Error destroying left viewer:', e);
            }
            this.leftViewer = null;
        }

        // Reinitialize with new year
        await this.initializeViewerForYear('leftCesiumContainer', this.leftYear);
        this.setupCameraSync();
    }

    /**
     * Update right view
     */
    async updateRightView() {
        if (!this.isActive || !this.rightYear) return;
        
        // Destroy existing viewer
        if (this.rightViewer) {
            try {
                this.rightViewer.destroy();
            } catch (e) {
                console.warn('Error destroying right viewer:', e);
            }
            this.rightViewer = null;
        }

        // Reinitialize with new year
        await this.initializeViewerForYear('rightCesiumContainer', this.rightYear);
        this.setupCameraSync();
    }

    /**
     * Deactivate split screen
     */
    deactivateSplitScreen() {
        this.isActive = false;
        this._dividerDragging = false;

        // Remove camera sync handlers
        if (this._leftCameraHandler && this.leftViewer) {
            this.leftViewer.camera.changed.removeEventListener(this._leftCameraHandler);
        }
        if (this._rightCameraHandler && this.rightViewer) {
            this.rightViewer.camera.changed.removeEventListener(this._rightCameraHandler);
        }
        if (this._dividerMouseMoveHandler) {
            document.removeEventListener('mousemove', this._dividerMouseMoveHandler);
            this._dividerMouseMoveHandler = null;
        }
        if (this._dividerMouseUpHandler) {
            document.removeEventListener('mouseup', this._dividerMouseUpHandler);
            this._dividerMouseUpHandler = null;
        }

        // Destroy Cesium viewers
        if (this.leftViewer) {
            try {
                this.leftViewer.destroy();
            } catch (e) {
                console.warn('Error destroying left viewer:', e);
            }
            this.leftViewer = null;
        }

        if (this.rightViewer) {
            try {
                this.rightViewer.destroy();
            } catch (e) {
                console.warn('Error destroying right viewer:', e);
            }
            this.rightViewer = null;
        }

        // Remove split container
        if (this.splitContainer) {
            this.splitContainer.remove();
            this.splitContainer = null;
        }

        // Show original viewer
        const viewerContainer = document.getElementById('cesiumContainer');
        if (viewerContainer) {
            viewerContainer.style.display = 'block';
        }

        // Update UI
        document.getElementById('activateSplitScreenBtn').style.display = 'inline-flex';
        document.getElementById('deactivateSplitScreenBtn').style.display = 'none';

        if (window.notification) {
            window.notification.info(
                window.appI18n?.nt ? window.appI18n.nt('splitDeactivated') : 'Split screen deactivated'
            );
        }
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.splitScreenManager = new SplitScreenManager();
}
