/**
 * Main Application Module
 * Coordinates all modules and handles initialization
 */

// Import all modules (they will be loaded via script tags in HTML)
// Modules are loaded in dependency order

class App {
    constructor() {
        this.modules = new Map();
        this.initialized = false;
        this._statusDefault = 'Ready';
        this._toolStatusLine = null;
        this._transientStatusTimer = null;
        this._domHandlersBound = false;
    }

    /**
     * Initialize application
     */
    async init() {
        if (this.initialized) {
            return;
        }

        console.log('Initializing SimplexDM...');

        try {
            // Wait for DOM to be ready
            if (document.readyState === 'loading') {
                await new Promise(resolve => {
                    document.addEventListener('DOMContentLoaded', resolve);
                });
            }

            /* Modal / sidebar tab wiring first so Dashboard, DB, and tabs work even if viewer init fails later. */
            this.setupEventHandlers();

            // Initialize utility modules first
            await this.initUtilities();
            
            // Initialize core modules
            await this.initCore();
            
            // Initialize feature modules
            await this.initFeatures();
            
            // Initialize UI modules
            await this.initUI();
            
            // Initialize viewer
            await this.initViewer();

            this.initialized = true;
            console.log('Application initialized successfully');
            
            // Show ready status
            if (window.notification) {
                window.notification.success(
                    window.appI18n && window.appI18n.nt ? window.appI18n.nt('appReady') : 'Application ready'
                );
            }
            
            this.updateStatus('Ready');
        } catch (error) {
            // Use error handler for consistent error handling
            if (window.errorHandler) {
                window.errorHandler.handle(error, {
                    component: 'App',
                    action: 'initialize'
                }, true);
            } else {
                console.error('Failed to initialize application:', error);
                if (window.notification) {
                    const p =
                        window.appI18n && window.appI18n.nt
                            ? window.appI18n.nt('appInitFailed')
                            : 'Failed to initialize application: ';
                    window.notification.error(p + error.message);
                }
            }
        }
    }

    /**
     * Initialize utility modules
     */
    async initUtilities() {
        console.log('Initializing utilities...');
        
        // PathResolver and FileHandleRegistry are already initialized as singletons
        // Just ensure they're connected
        if (window.pathResolver && window.fileHandleRegistry) {
            await window.pathResolver.init(window.fileHandleRegistry);
        }
        
        if (window.fileManager && window.pathResolver && window.fileHandleRegistry) {
            window.fileManager.init(window.fileHandleRegistry, window.pathResolver);
        }
    }

    /**
     * Initialize core modules
     */
    async initCore() {
        console.log('Initializing core modules...');
        
        // PathManager and FileManager are already initialized
        // Wait for PathManager to be ready
        if (window.pathManager) {
            await window.pathManager.init();
        }
    }

    /**
     * Initialize feature modules
     */
    async initFeatures() {
        console.log('Initializing feature modules...');
        
        // Feature modules will be initialized by their respective UI modules
        // This is a placeholder for future feature initialization
    }

    /**
     * Initialize UI modules
     */
    async initUI() {
        console.log('Initializing UI modules...');
        
        // UI modules will initialize themselves when their scripts load
        // This is a placeholder for UI initialization coordination
    }

    /**
     * Initialize viewer
     */
    async initViewer() {
        console.log('Initializing viewer...');
        
        // Viewer will be initialized by TilesetViewer module
        // This is a placeholder
    }

    /**
     * Set up global event handlers
     */
    setupEventHandlers() {
        if (this._domHandlersBound) {
            return;
        }
        this._domHandlersBound = true;
        /* Navbar: dashboard / database / help — wired once in FrontendIntegration (calls app.show*). */

        // Sidebar toggles with restore button management
        const toggleLeftSidebar = document.getElementById('toggleLeftSidebar');
        const toggleRightSidebar = document.getElementById('toggleRightSidebar');
        const restoreLeftSidebar = document.getElementById('restoreLeftSidebar');
        const restoreRightSidebar = document.getElementById('restoreRightSidebar');
        const leftSidebar = document.getElementById('leftSidebar');
        const rightSidebar = document.getElementById('rightSidebar');

        const mainContainer = document.querySelector('.main-container');

        /** Navbar can wrap on narrow viewports; keep --nav-h in sync so .main-container is not covered. */
        const syncNavHeight = () => {
            const nav = document.querySelector('.top-navbar');
            if (!nav) return;
            const h = Math.ceil(nav.getBoundingClientRect().height);
            document.documentElement.style.setProperty('--nav-h', `${h}px`);
        };
        syncNavHeight();
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => syncNavHeight());
        }
        if (typeof ResizeObserver !== 'undefined') {
            const navEl = document.querySelector('.top-navbar');
            if (navEl) {
                const ro = new ResizeObserver(() => syncNavHeight());
                ro.observe(navEl);
            }
        }

        // Status bar fold — short ribbon so map tool strips stay clear; preference in localStorage ('0' = expanded)
        const STATUS_BAR_FOLD_KEY = 'simplex.statusBarFolded';
        const statusBarEl = document.getElementById('statusBar');
        const statusBarFoldBtn = document.getElementById('statusBarFoldBtn');
        const _t = (key) =>
            window.appI18n && typeof window.appI18n.t === 'function' ? window.appI18n.t(key) : key;
        const applyStatusBarFolded = (folded) => {
            document.body.classList.toggle('status-bar-folded', folded);
            if (statusBarEl) statusBarEl.classList.toggle('status-bar--folded', folded);
            if (statusBarFoldBtn) {
                statusBarFoldBtn.setAttribute('aria-expanded', folded ? 'false' : 'true');
                const label = folded ? _t('app.expandStatusBar') : _t('app.collapseStatusBar');
                statusBarFoldBtn.title = label;
                statusBarFoldBtn.setAttribute('aria-label', label);
                const srOnly = statusBarFoldBtn.querySelector('.visually-hidden');
                if (srOnly) srOnly.textContent = label;
            }
            try {
                localStorage.setItem(STATUS_BAR_FOLD_KEY, folded ? '1' : '0');
            } catch (_) { /* ignore */ }
            window.dispatchEvent(new Event('resize'));
            syncNavHeight();
            try {
                window.tilesetViewer?.viewer?.resize?.();
                window.tilesetViewer?.viewer?.scene?.requestRender?.();
            } catch (_) { /* ignore */ }
        };
        if (statusBarFoldBtn && statusBarEl) {
            // Default: collapsed (content hidden); only show full bar if user saved expanded ('0')
            let startFolded = true;
            try {
                if (localStorage.getItem(STATUS_BAR_FOLD_KEY) === '0') startFolded = false;
            } catch (_) { /* ignore */ }
            applyStatusBarFolded(startFolded);
            statusBarFoldBtn.addEventListener('click', () => {
                applyStatusBarFolded(!document.body.classList.contains('status-bar-folded'));
            });
        }

        // Edge peels: always visible; same control opens and closes (toggle)
        const updateRestoreButtons = () => {
            const leftCollapsed = leftSidebar && leftSidebar.classList.contains('collapsed');
            const rightCollapsed = rightSidebar && rightSidebar.classList.contains('collapsed');

            if (mainContainer) {
                mainContainer.classList.toggle('sidebar-left-open', !!leftSidebar && !leftCollapsed);
                mainContainer.classList.toggle('sidebar-right-open', !!rightSidebar && !rightCollapsed);
            }

            const peelLeft = document.getElementById('restoreLeftSidebar');
            const peelRight = document.getElementById('restoreRightSidebar');
            if (peelLeft && leftSidebar) {
                peelLeft.style.display = 'flex';
                peelLeft.classList.toggle('is-open', !leftCollapsed);
                peelLeft.title = leftCollapsed ? _t('app.showLayersRegions') : _t('app.hideLayersRegions');
                peelLeft.setAttribute('aria-expanded', leftCollapsed ? 'false' : 'true');
                peelLeft.setAttribute(
                    'aria-label',
                    leftCollapsed ? _t('app.showLayersRegionsPanel') : _t('app.hideLayersRegionsPanel')
                );
            }
            if (peelRight && rightSidebar) {
                peelRight.style.display = 'flex';
                peelRight.classList.toggle('is-open', !rightCollapsed);
                peelRight.title = rightCollapsed ? _t('app.showControls') : _t('app.hideControls');
                peelRight.setAttribute('aria-expanded', rightCollapsed ? 'false' : 'true');
                peelRight.setAttribute(
                    'aria-label',
                    rightCollapsed ? _t('app.showControlsPanel') : _t('app.hideControlsPanel')
                );
            }

            // Header chevrons: same toggle — keep labels in sync
            const tl = document.getElementById('toggleLeftSidebar');
            const tr = document.getElementById('toggleRightSidebar');
            if (tl && leftSidebar) {
                tl.title = leftCollapsed ? _t('app.expandSidebar') : _t('app.collapseSidebar');
                tl.setAttribute('aria-expanded', leftCollapsed ? 'false' : 'true');
            }
            if (tr && rightSidebar) {
                tr.title = rightCollapsed ? _t('app.expandSidebar') : _t('app.collapseSidebar');
                tr.setAttribute('aria-expanded', rightCollapsed ? 'false' : 'true');
            }

            updateFloatingControlsVisibility(leftCollapsed, rightCollapsed);
        };
        
        // Function to update floating controls visibility and position
        const updateFloatingControlsVisibility = (leftCollapsed, rightCollapsed) => {
            const tilesetsContainer = document.getElementById('floatingTilesetControls');
            
            // Floating tilesets: show only when left sidebar is collapsed
            if (tilesetsContainer) {
                if (leftCollapsed) {
                    tilesetsContainer.style.display = 'flex';
                    tilesetsContainer.style.left = '20px';
                } else {
                    tilesetsContainer.style.display = 'none';
                }
            }
        };

        window.addEventListener('simplex:sidebarLayoutChanged', () => {
            updateRestoreButtons();
            syncNavHeight();
        });

        // Initialize restore button visibility and floating controls visibility
        updateRestoreButtons();
        
        // Update floating controls when window resizes (throttled for performance)
        let resizeTimeout = null;
        window.addEventListener('resize', () => {
            syncNavHeight();
            if (resizeTimeout) {
                clearTimeout(resizeTimeout);
            }
            resizeTimeout = setTimeout(() => {
                const leftCollapsed = leftSidebar && leftSidebar.classList.contains('collapsed');
                const rightCollapsed = rightSidebar && rightSidebar.classList.contains('collapsed');
                updateFloatingControlsVisibility(leftCollapsed, rightCollapsed);
            }, 100);
        });

        if (toggleLeftSidebar && leftSidebar) {
            // Remove existing listeners to avoid duplicates
            const newToggleLeft = toggleLeftSidebar.cloneNode(true);
            toggleLeftSidebar.parentNode.replaceChild(newToggleLeft, toggleLeftSidebar);
            
            newToggleLeft.addEventListener('click', (e) => {
                e.stopPropagation();
                leftSidebar.classList.toggle('collapsed');
                updateRestoreButtons();
                console.log('Left sidebar toggled, collapsed:', leftSidebar.classList.contains('collapsed'));
            });
        }

        if (toggleRightSidebar && rightSidebar) {
            // Remove existing listeners to avoid duplicates
            const newToggleRight = toggleRightSidebar.cloneNode(true);
            toggleRightSidebar.parentNode.replaceChild(newToggleRight, toggleRightSidebar);
            
            newToggleRight.addEventListener('click', (e) => {
                e.stopPropagation();
                rightSidebar.classList.toggle('collapsed');
                updateRestoreButtons();
                console.log('Right sidebar toggled, collapsed:', rightSidebar.classList.contains('collapsed'));
            });
        }

        if (restoreLeftSidebar && leftSidebar) {
            const newRestoreLeft = restoreLeftSidebar.cloneNode(true);
            restoreLeftSidebar.parentNode.replaceChild(newRestoreLeft, restoreLeftSidebar);

            newRestoreLeft.addEventListener('click', (e) => {
                e.stopPropagation();
                leftSidebar.classList.toggle('collapsed');
                updateRestoreButtons();
                console.log('Left sidebar toggled, collapsed:', leftSidebar.classList.contains('collapsed'));
            });
        }

        if (restoreRightSidebar && rightSidebar) {
            const newRestoreRight = restoreRightSidebar.cloneNode(true);
            restoreRightSidebar.parentNode.replaceChild(newRestoreRight, restoreRightSidebar);

            newRestoreRight.addEventListener('click', (e) => {
                e.stopPropagation();
                rightSidebar.classList.toggle('collapsed');
                updateRestoreButtons();
                console.log('Right sidebar toggled, collapsed:', rightSidebar.classList.contains('collapsed'));
            });
        }

        // Collapsible sections in right sidebar
        document.querySelectorAll('.section-header-toggle').forEach(header => {
            header.addEventListener('click', () => {
                const sectionId = header.dataset.section;
                const section = document.getElementById(sectionId);
                if (section) {
                    section.classList.toggle('collapsed');
                }
            });
        });
        
        // Initial layout from merged app config (jsonConfig + runtime overrides), else legacy: both collapsed
        requestAnimationFrame(() => {
            if (window.appSettingsFramework && typeof window.appSettingsFramework.applyUiLayoutFromAppConfig === 'function') {
                window.appSettingsFramework.applyUiLayoutFromAppConfig();
            } else {
                if (leftSidebar && !leftSidebar.classList.contains('collapsed')) {
                    leftSidebar.classList.add('collapsed');
                }
                if (rightSidebar && !rightSidebar.classList.contains('collapsed')) {
                    rightSidebar.classList.add('collapsed');
                }
            }
            updateRestoreButtons();
            syncNavHeight();
        });

        // Feature Information tabs only (right sidebar). Do not use document-wide `.tab-btn`:
        // Coordinate Research and other panels reuse similar class names.
        const featureTabsHost = document.querySelector('#featureInfoSection .tabs');
        if (featureTabsHost) {
            featureTabsHost.querySelectorAll('.tab-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    const tabName = e.currentTarget && e.currentTarget.dataset.tab;
                    if (tabName) {
                        this.switchTab(tabName);
                    }
                });
            });
        }

        // Dashboard tab switching
        document.querySelectorAll('.dashboard-tab-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const tabName = e.currentTarget && e.currentTarget.dataset.tab;
                if (tabName) {
                    this.switchDashboardTab(tabName);
                }
            });
        });

        // Close modals
        const closeDashboardBtn = document.getElementById('closeDashboardBtn');
        if (closeDashboardBtn) {
            closeDashboardBtn.addEventListener('click', () => {
                this.hideDashboard();
            });
        }

        const closeDatabaseBtn = document.getElementById('closeDatabaseBtn');
        if (closeDatabaseBtn) {
            closeDatabaseBtn.addEventListener('click', () => {
                this.hideDatabase();
            });
        }

        window.addEventListener('simplex:localeChanged', () => {
            updateRestoreButtons();
            if (statusBarFoldBtn && statusBarEl) {
                applyStatusBarFolded(document.body.classList.contains('status-bar-folded'));
            }
        });
    }

    /**
     * Show dashboard modal
     */
    showDashboard() {
        // Update nav button active state
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const dashboardBtn = document.getElementById('dashboardBtn');
        if (dashboardBtn) {
            dashboardBtn.classList.add('active');
        }
        
        const modal = document.getElementById('dashboardModal');
        if (modal) {
            modal.style.display = 'flex';
            // Initialize dashboard content if needed
            if (window.dashboardUI) {
                // Get the active tab and render its content
                const activeTab = document.querySelector('.dashboard-tab-btn.active');
                const tabName = activeTab ? activeTab.dataset.tab : 'overview';
                window.dashboardUI.setCurrentTab(tabName);
            }
        }
    }
    
    /**
     * Show database modal
     */
    showDatabase() {
        // Update nav button active state
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const databaseBtn = document.getElementById('databaseBtn');
        if (databaseBtn) {
            databaseBtn.classList.add('active');
        }
        
        const modal = document.getElementById('databaseModal');
        if (modal) {
            modal.style.display = 'flex';
            // Initialize database content if needed
            if (window.databaseUI) {
                window.databaseUI.refresh();
            }
        }
    }

    /**
     * Hide dashboard modal
     */
    hideDashboard() {
        const modal = document.getElementById('dashboardModal');
        if (modal) {
            modal.style.display = 'none';
        }
        const dashboardBtn = document.getElementById('dashboardBtn');
        if (dashboardBtn) {
            dashboardBtn.classList.remove('active');
        }
    }


    /**
     * Hide database modal
     */
    hideDatabase() {
        const modal = document.getElementById('databaseModal');
        if (modal) {
            modal.style.display = 'none';
        }
        // Remove active state from nav button
        const databaseBtn = document.getElementById('databaseBtn');
        if (databaseBtn) {
            databaseBtn.classList.remove('active');
        }
    }

    /**
     * Hide help modal
     */
    hideHelp() {
        if (window.helpUI) {
            window.helpUI.hide();
        }
    }

    /**
     * Show help
     */
    showHelp() {
        // Update nav button active state
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const helpBtn = document.getElementById('helpBtn');
        if (helpBtn) {
            helpBtn.classList.add('active');
        }
        
        // Show help modal using helpUI
        if (window.helpUI) {
            window.helpUI.show();
        } else {
            // Fallback notification if helpUI not loaded
            if (window.notification) {
                window.notification.info(
                    window.appI18n && window.appI18n.nt ? window.appI18n.nt('helpDocHint') : 'Help documentation is available in the doc/ directory'
                );
            }
        }
    }

    /**
     * Switch tab in feature info section
     */
    switchTab(tabName) {
        if (!tabName) {
            return;
        }
        const root = document.getElementById('featureInfoSection');
        if (!root) {
            return;
        }
        root.querySelectorAll('.tabs .tab-btn').forEach((btn) => {
            btn.classList.remove('active');
            btn.setAttribute('aria-selected', 'false');
        });
        root.querySelectorAll('.tab-content').forEach((content) => {
            content.classList.remove('active');
        });

        // Activate selected tab
        const tabBtn = root.querySelector(`.tabs .tab-btn[data-tab="${tabName}"]`);
        const tabContent = document.getElementById(`${tabName}Tab`);
        
        if (tabBtn) {
            tabBtn.classList.add('active');
            tabBtn.setAttribute('aria-selected', 'true');
        }
        if (tabContent) {
            tabContent.classList.add('active');
        }

        // Handle JSON Tree tab activation
        if (tabName === 'json' && window.jsonTreeExplorer) {
            const container = document.getElementById('jsonTree');
            if (container) {
                window.jsonTreeExplorer.setContainer(container);
                
                // Load JSON if tileset is loaded
                if (window.displayControl) {
                    const tilesets = window.displayControl.getAllTilesets();
                    const urls = tilesets.map((t) => t.url).filter(Boolean);
                    if (urls.length > 1) {
                        window.jsonTreeExplorer.loadAllFromUrls(urls).catch((err) => {
                            console.error('Failed to load JSON trees:', err);
                        });
                    } else if (urls.length === 1) {
                        window.jsonTreeExplorer.loadJSON(urls[0]).catch((err) => {
                            console.error('Failed to load JSON:', err);
                        });
                    }
                }
            }
        }
    }

    /**
     * Switch dashboard tab
     */
    switchDashboardTab(tabName) {
        if (!tabName) {
            return;
        }
        // Remove active class from all tabs and content
        document.querySelectorAll('.dashboard-tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelectorAll('.dashboard-tab-content').forEach(content => {
            content.classList.remove('active');
        });

        // Activate selected tab
        const tabBtn = document.querySelector(`.dashboard-tab-btn[data-tab="${tabName}"]`);
        const tabContent = document.getElementById(`dashboard${tabName.charAt(0).toUpperCase() + tabName.slice(1)}Tab`);
        
        if (tabBtn) {
            tabBtn.classList.add('active');
            tabBtn.setAttribute('aria-selected', 'true');
        }
        if (tabContent) {
            tabContent.classList.add('active');
        }

        document.querySelectorAll('.dashboard-tab-btn').forEach((btn) => {
            if (btn !== tabBtn) {
                btn.setAttribute('aria-selected', 'false');
            }
        });
        
        // Update dashboard UI and render content
        if (window.dashboardUI) {
            window.dashboardUI.setCurrentTab(tabName);
        }
    }

    /**
     * Update status bar text
     */
    updateStatus(text) {
        this._statusDefault = text || 'Ready';
        this._applyStatusLine(
            this._toolStatusLine != null ? this._toolStatusLine : this._statusDefault
        );
    }

    /**
     * Long-running tool hint (measurements, visibility analysis, cut, etc.)
     */
    setToolStatus(text) {
        this._toolStatusLine = text || null;
        this._applyStatusLine(
            this._toolStatusLine != null ? this._toolStatusLine : (this._statusDefault || 'Ready')
        );
    }

    clearToolStatus() {
        this._toolStatusLine = null;
        this._applyStatusLine(this._statusDefault || 'Ready');
    }

    /**
     * Short-lived message (bookmarks, debug toggles); then restore tool line or default.
     */
    setTransientStatus(text, durationMs = 2800) {
        clearTimeout(this._transientStatusTimer);
        this._applyStatusLine(text);
        this._transientStatusTimer = setTimeout(() => {
            const restore =
                this._toolStatusLine != null ? this._toolStatusLine : (this._statusDefault || 'Ready');
            this._applyStatusLine(restore);
        }, durationMs);
    }

    _applyStatusLine(text) {
        const statusText = document.getElementById('statusText');
        if (statusText) {
            statusText.textContent = text;
        }
    }

    /**
     * Update mouse coordinates
     */
    updateMouseCoordinates(lon, lat, height) {
        if (window.coordinateManager) {
            return;
        }
        const coords = document.getElementById('mouseCoordinates');
        if (coords) {
            coords.classList.remove('status-coords-empty');
            const fmt = window.simplexFormatDistanceMeters || ((m) => (Number.isFinite(m) ? `${m.toFixed(1)} m` : '—'));
            const latAbs = Math.abs(lat);
            const lonAbs = Math.abs(lon);
            const latDir = lat >= 0 ? 'N' : 'S';
            const lonDir = lon >= 0 ? 'E' : 'W';
            coords.innerHTML =
                `<div class="status-coord-block">` +
                `<div class="status-coord-head">` +
                `<span class="status-crs-badge">WGS84</span>` +
                `<span class="status-coord-head-hint">ellipsoid</span>` +
                `</div>` +
                `<div class="status-coord-grid" role="group" aria-label="Cursor WGS84">` +
                `<span class="status-coord-dt">Latitude</span>` +
                `<span class="status-coord-dd">${latAbs.toFixed(5)}° ${latDir}</span>` +
                `<span class="status-coord-dt">Longitude</span>` +
                `<span class="status-coord-dd">${lonAbs.toFixed(5)}° ${lonDir}</span>` +
                `<span class="status-coord-dt">Surface</span>` +
                `<span class="status-coord-dd">${fmt(height)}</span>` +
                `</div></div>`;
            coords.removeAttribute('title');
        }
    }

    /**
     * Update tile count
     */
    updateTileCount(count) {
        const tileCount = document.getElementById('tileCount');
        if (tileCount) {
            const n = typeof count === 'number' && !Number.isNaN(count) ? count : 0;
            tileCount.textContent = String(n);
        }
    }

    /**
     * Update feature count
     */
    updateFeatureCount(count) {
        const featureCount = document.getElementById('featureCount');
        if (featureCount) {
            const n = typeof count === 'number' && !Number.isNaN(count) ? count : 0;
            featureCount.textContent = String(n);
        }
    }

    /**
     * Update FPS counter
     */
    updateFPS(fps) {
        const fpsCounter = document.getElementById('fpsCounter');
        if (fpsCounter) {
            fpsCounter.textContent =
                typeof fps === 'number' && Number.isFinite(fps) ? String(fps) : '—';
        }
    }
}

// Initialize application when script loads
const app = new App();
window.app = app;

// Start initialization
app.init().catch(console.error);
