/**
 * FrontendIntegration
 * Comprehensive integration system connecting all features, tools, and managers to UI elements
 * Ensures all buttons, controls, and UI elements are properly connected to their functionality
 */

class FrontendIntegration {
    constructor() {
        this.initialized = false;
        this.eventHandlers = new Map();
    }

    /**
     * Initialize all frontend integrations
     */
    async init() {
        if (this.initialized) {
            return;
        }

        // Wait for DOM and essential modules
        if (document.readyState === 'loading') {
            await new Promise(resolve => {
                document.addEventListener('DOMContentLoaded', resolve);
            });
        }

        // Wait for essential modules to be available
        await this.waitForModules();

        await this.waitForViewerDom(2000);

        if (window.directionsManager && typeof window.directionsManager.init === 'function') {
            window.directionsManager.init();
        }

        // Integrate all features
        this.integrateToolbarButtons();
        this.integrateAnalysisDock();
        if (window.navigationManager && typeof window.navigationManager.initBrowseToolbar === 'function') {
            window.navigationManager.initBrowseToolbar();
        }
        this.integrateSidebarControls();
        this.integrateModalControls();
        this.integrateNestedToolbars();
        this.integrateAdvancedFeatures();
        this.integrateSearchAndFilters();

        this.initialized = true;
        if (window.logger) {
            window.logger.info('FrontendIntegration: All features integrated');
        }
    }

    /**
     * Wait for essential modules to be available
     * Uses requestAnimationFrame for faster checks (immediate if ready, otherwise ~16ms intervals)
     */
    async waitForModules() {
        const maxWait = 10000; // 10 seconds max
        const startTime = Date.now();

        return new Promise((resolve) => {
            const check = () => {
                if (window.tilesetViewer && window.toolbarManager) {
                    resolve();
                    return;
                }
                
                if (Date.now() - startTime < maxWait) {
                    // Use requestAnimationFrame for faster checks (~16ms vs 100ms)
                    requestAnimationFrame(check);
                } else {
                    // Timeout - proceed anyway (modules may initialize later)
                    resolve();
                }
            };
            check();
        });
    }

    /**
     * Wait until the viewer mount exists (custom #primaryToolbar is optional).
     */
    async waitForViewerDom(maxWaitMs) {
        const start = Date.now();
        return new Promise((resolve) => {
            const tick = () => {
                if (document.getElementById('cesiumContainer')) {
                    resolve();
                    return;
                }
                if (Date.now() - start >= maxWaitMs) {
                    resolve();
                    return;
                }
                requestAnimationFrame(tick);
            };
            tick();
        });
    }

    /**
     * Legacy optional rail `#primaryToolbar` (if present in a layout fork).
     * The default UI uses the bottom `.tools` strip; those buttons are wired in `smart3dToolbarWireup`.
     */
    integrateToolbarButtons() {
        const c = (id, handler) => this.connectButtonIfPresent(id, handler);

        c('toolbarHome', () => {
            if (window.navigationManager && window.navigationManager.home) {
                window.navigationManager.home();
            } else if (window.viewControls && window.viewControls.home) {
                window.viewControls.home();
            } else if (window.tilesetViewer && window.tilesetViewer.viewer) {
                window.tilesetViewer.viewer.camera.flyHome();
            }
        });

        c('toolbarSearch', () => {
            if (window.searchManager && typeof window.searchManager.show === 'function') {
                window.searchManager.show();
            }
        });

        c('toolbarGlobe', () => {
            if (window.tilesetViewer && window.tilesetViewer.viewer) {
                const viewer = window.tilesetViewer.viewer;
                viewer.scene.mode = Cesium.SceneMode.SCENE3D;
                if (typeof viewer.camera.flyHome === 'function') {
                    viewer.camera.flyHome(1.5);
                }
            }
        });

        c('toolbarPan', () => {
            if (window.navigationManager && typeof window.navigationManager.setBrowseModePan === 'function') {
                window.navigationManager.setBrowseModePan();
            }
        });

        c('toolbarBrowse', () => {
            if (window.navigationManager && typeof window.navigationManager.setBrowseModeExplore === 'function') {
                window.navigationManager.setBrowseModeExplore();
            }
        });

        c('toolbarHelp', () => {
            if (window.navigationHelpUI && typeof window.navigationHelpUI.show === 'function') {
                window.navigationHelpUI.show();
            } else if (window.helpUI && typeof window.helpUI.show === 'function') {
                window.helpUI.show();
            }
        });

        c('toolbarBack', () => {
            if (window.navigationManager && window.navigationManager.navigateBack) {
                window.navigationManager.navigateBack();
            } else if (window.viewControls && window.viewControls.back) {
                window.viewControls.back();
            }
        });

        c('toolbarForward', () => {
            if (window.navigationManager && window.navigationManager.navigateForward) {
                window.navigationManager.navigateForward();
            } else if (window.viewControls && window.viewControls.forward) {
                window.viewControls.forward();
            }
        });

        c('toolbarDown', () => {
            if (window.tilesetViewer && window.tilesetViewer.viewer) {
                try {
                    const viewer = window.tilesetViewer.viewer;
                    const camera = viewer.camera;
                    const cartographic = Cesium.Cartographic.fromCartesian(camera.position);
                    const currentHeight = cartographic.height;
                    const newHeight = Math.max(0, currentHeight - 100);
                    
                    camera.flyTo({
                        destination: Cesium.Cartesian3.fromRadians(
                            cartographic.longitude,
                            cartographic.latitude,
                            newHeight
                        ),
                        duration: 0.5
                    });
                } catch (error) {
                    console.warn('Failed to move camera down:', error);
                }
            }
        });

        c('toolbarCube', () => {
            if (window.tilesetViewer && window.tilesetViewer.viewer) {
                const viewer = window.tilesetViewer.viewer;
                const scene = viewer.scene;
                // Toggles Cesium scene mode: 3D globe vs 2D map
                if (scene.mode === Cesium.SceneMode.SCENE3D) {
                    viewer.scene.mode = Cesium.SceneMode.SCENE2D;
                } else {
                    viewer.scene.mode = Cesium.SceneMode.SCENE3D;
                }
            }
        });

        c('toolbarImage', () => {
            if (window.navigationManager && window.navigationManager.topView) {
                window.navigationManager.topView();
            } else if (window.viewControls && window.viewControls.topView) {
                window.viewControls.topView();
            }
        });

        /* Measurement UI: Cesium Ion SDK toolbar on the viewer (.cesium-measure-toolbar). */
    }

    /**
     * Legacy right-side analysis rail was removed; use the Ion measurement bar + sidebars.
     * Feature managers remain reachable via nestedToolbarItemClick / config / other UI.
     */
    integrateAnalysisDock() {
        /* no-op */
    }

    /**
     * Integrate sidebar controls
     */
    integrateSidebarControls() {
        // Open Layers Menu — same behavior as #layersIC (smart3dToolbarWireup.mapToolbarHandlers.layersIC)
        this.connectButton('openLayersMenuBtn', () => {
            if (window.smart3dToolbarWireup && typeof window.smart3dToolbarWireup.invokeMapToolAction === 'function') {
                window.smart3dToolbarWireup.invokeMapToolAction('layersIC');
            } else if (window.layersMenuManager) {
                if (window.layersMenuManager.show) {
                    window.layersMenuManager.show();
                } else if (window.layersMenuManager.toggle) {
                    window.layersMenuManager.toggle();
                }
            } else if (window.notification) {
                window.notification.warning(window.appI18n?.nt ? window.appI18n.nt('layersMenuInit') : 'Layers Menu is initializing. Please try again.');
            }
        });

        // Quick Load Tileset button
        this.connectButton('quickLoadTilesetBtn', () => {
            if (window.pathInputUI) {
                if (window.pathInputUI.showPathInputDialog) {
                    window.pathInputUI.showPathInputDialog();
                } else if (window.notification) {
                    window.notification.warning(window.appI18n?.nt ? window.appI18n.nt('pathInputInit') : 'Path Input is initializing. Please try again.');
                }
            } else if (window.notification) {
                window.notification.warning(window.appI18n?.nt ? window.appI18n.nt('pathInputUnavailable') : 'Path Input is not available. Please wait for initialization.');
            }
        });

        // Add Tileset button
        this.connectButton('addTilesetBtn', () => {
            if (window.displayControlUI) {
                if (window.displayControlUI.showAddTilesetDialog) {
                    window.displayControlUI.showAddTilesetDialog();
                } else if (window.notification) {
                    window.notification.warning(window.appI18n?.nt ? window.appI18n.nt('displayControlInit') : 'Display Control is initializing. Please try again.');
                }
            } else if (window.notification) {
                window.notification.warning(window.appI18n?.nt ? window.appI18n.nt('displayControlUnavailable') : 'Display Control is not available. Please wait for initialization.');
            }
        });

        // Coordinate Research Button (also in sidebar)
        this.connectButton('coordinateResearchBtn', () => {
            if (window.coordinateResearchManager) {
                if (window.coordinateResearchManager.show) {
                    window.coordinateResearchManager.show();
                } else {
                    console.warn('CoordinateResearchManager.show() not available');
                    if (window.notification) {
                        window.notification.warning(window.appI18n?.nt ? window.appI18n.nt('coordResearchInit') : 'Coordinate Research tool is initializing. Please try again.');
                    }
                }
            } else {
                console.warn('CoordinateResearchManager not available');
                if (window.notification) {
                    window.notification.warning(window.appI18n?.nt ? window.appI18n.nt('coordResearchUnavailable') : 'Coordinate Research tool is not available. Please wait for initialization.');
                }
            }
        });

        // Quality selector
        const qualitySelector = document.getElementById('qualitySelector');
        if (qualitySelector) {
            qualitySelector.addEventListener('change', (e) => {
                if (window.displayControl) {
                    const quality = e.target.value;
                    window.displayControl.setQuality(quality);
                }
            });
        }

        // Tileset selector
        const tilesetSelector = document.getElementById('tilesetSelector');
        if (tilesetSelector) {
            tilesetSelector.addEventListener('change', (e) => {
                if (window.displayControl && e.target.value) {
                    // Use fitToView instead of focusTileset
                    if (window.displayControl.fitToView) {
                        window.displayControl.fitToView(e.target.value);
                    } else if (window.displayControlUI && window.displayControlUI.fitToView) {
                        window.displayControlUI.fitToView(e.target.value);
                    }
                }
            });
        }
    }

    /**
     * Integrate modal controls
     */
    integrateModalControls() {
        // Dashboard button
        this.connectButton('dashboardBtn', () => {
            if (window.app && window.app.showDashboard) {
                window.app.showDashboard();
            } else if (window.dashboardUI && window.dashboardUI.show) {
                window.dashboardUI.show();
            } else if (window.notification) {
                window.notification.warning(window.appI18n?.nt ? window.appI18n.nt('dashboardInit') : 'Dashboard is initializing. Please try again.');
            }
        });

        // Database button
        this.connectButton('databaseBtn', () => {
            if (window.app && window.app.showDatabase) {
                window.app.showDatabase();
            } else if (window.databaseUI && window.databaseUI.show) {
                window.databaseUI.show();
            } else if (window.notification) {
                window.notification.warning(window.appI18n?.nt ? window.appI18n.nt('databaseInit') : 'Database is initializing. Please try again.');
            }
        });

        // Help button
        this.connectButton('helpBtn', () => {
            if (window.app && window.app.showHelp) {
                window.app.showHelp();
            } else if (window.helpUI && window.helpUI.show) {
                window.helpUI.show();
            } else if (window.notification) {
                window.notification.warning(window.appI18n?.nt ? window.appI18n.nt('helpInit') : 'Help is initializing. Please try again.');
            }
        });

        // Navigation Help button
        this.connectButton('navigationHelpBtn', () => {
            if (window.navigationHelpUI) {
                if (window.navigationHelpUI.toggle) {
                    window.navigationHelpUI.toggle();
                } else if (window.navigationHelpUI.show) {
                    window.navigationHelpUI.show();
                }
            } else if (window.notification) {
                window.notification.warning(window.appI18n?.nt ? window.appI18n.nt('navHelpInit') : 'Navigation Help is initializing. Please try again.');
            }
        });

        this.connectButton('directionsBtn', () => {
            if (window.directionsManager && typeof window.directionsManager.open === 'function') {
                window.directionsManager.open();
            } else if (window.notification) {
                window.notification.warning(window.appI18n?.nt ? window.appI18n.nt('directionsInit') : 'Directions is initializing. Try again in a moment.');
            }
        });
    }

    /**
     * Flyout host #nestedToolbarContainer removed from index; wiring kept if markup is injected later.
     */
    integrateNestedToolbars() {
        if (!document.getElementById('nestedToolbarContainer')) {
            return;
        }

        // Layers toolbar actions
        this.connectNestedToolbarAction('layersToolbar', 'show-all', () => {
            if (window.displayControl) {
                const tilesets = window.displayControl.getAllTilesets();
                tilesets.forEach(tileset => {
                    if (tileset.primitive) {
                        tileset.primitive.show = true;
                    }
                });
                if (window.notification) {
                    window.notification.success(window.appI18n?.nt ? window.appI18n.nt('allLayersShown') : 'All layers shown');
                }
            } else if (window.layersMenuManager && window.layersMenuManager.layers) {
                // Show all layers if layersMenuManager has layers
                window.layersMenuManager.layers.forEach((layer, layerId) => {
                    if (layer.type !== 'folder' && window.layersMenuManager.showLayer) {
                        window.layersMenuManager.showLayer(layerId);
                    }
                });
            }
        });

        this.connectNestedToolbarAction('layersToolbar', 'hide-all', () => {
            if (window.displayControl) {
                const tilesets = window.displayControl.getAllTilesets();
                tilesets.forEach(tileset => {
                    if (tileset.primitive) {
                        tileset.primitive.show = false;
                    }
                });
                if (window.notification) {
                    window.notification.success(window.appI18n?.nt ? window.appI18n.nt('allLayersHidden') : 'All layers hidden');
                }
            } else if (window.layersMenuManager && window.layersMenuManager.layers) {
                // Hide all layers if layersMenuManager has layers
                window.layersMenuManager.layers.forEach((layer, layerId) => {
                    if (layer.type !== 'folder' && window.layersMenuManager.hideLayer) {
                        window.layersMenuManager.hideLayer(layerId);
                    }
                });
            }
        });

        this.connectNestedToolbarAction('layersToolbar', 'toggle-layers-menu', () => {
            if (window.layersMenuManager) {
                window.layersMenuManager.toggle();
            }
        });

        // City toolbar actions
        this.connectNestedToolbarAction('cityToolbar', 'show-buildings', () => {
            if (window.displayModesManager) {
                window.displayModesManager.showBuildings();
            }
        });

        this.connectNestedToolbarAction('cityToolbar', 'hide-buildings', () => {
            if (window.displayModesManager) {
                window.displayModesManager.hideBuildings();
            }
        });

        this.connectNestedToolbarAction('cityToolbar', 'toggle-buildings', () => {
            if (window.displayModesManager) {
                window.displayModesManager.toggleBuildings();
            }
        });

        // Cut toolbar actions
        this.connectNestedToolbarAction('cutToolbar', 'start-cut', () => {
            if (window.cutByPolygonManager) {
                window.cutByPolygonManager.startCutting();
            }
        });

        this.connectNestedToolbarAction('cutToolbar', 'cancel-cut', () => {
            if (window.cutByPolygonManager) {
                window.cutByPolygonManager.cancelCutting();
            }
        });

        this.connectNestedToolbarAction('cutToolbar', 'cut-options', () => {
            if (window.cutByPolygonManager) {
                if (window.cutByPolygonManager.show) {
                    window.cutByPolygonManager.show();
                }
            }
        });

        // Bookmark toolbar actions
        this.connectNestedToolbarAction('bookmarkToolbar', 'add-bookmark', () => {
            if (window.bookmarkManager) {
                window.bookmarkManager.addBookmark();
                if (window.notification) {
                    window.notification.success(window.appI18n?.nt ? window.appI18n.nt('bookmarkAdded') : 'Bookmark added');
                }
            }
        });

        this.connectNestedToolbarAction('bookmarkToolbar', 'show-bookmarks', () => {
            if (window.bookmarkManager) {
                if (window.bookmarkManager.toggleGallery) {
                    window.bookmarkManager.toggleGallery();
                } else if (window.bookmarkManager.showGallery) {
                    window.bookmarkManager.showGallery();
                }
            }
        });

        this.connectNestedToolbarAction('bookmarkToolbar', 'virtual-tour', () => {
            if (window.bookmarkManager) {
                if (window.bookmarkManager.startVirtualTour) {
                    window.bookmarkManager.startVirtualTour();
                    if (window.notification) {
                        window.notification.info(window.appI18n?.nt ? window.appI18n.nt('virtualTourStarted') : 'Virtual tour started');
                    }
                } else {
                    if (window.notification) {
                        window.notification.warning(window.appI18n?.nt ? window.appI18n.nt('tourNeedTwo') : 'Need at least 2 bookmarks for virtual tour');
                    }
                }
            }
        });
    }

    /**
     * Integrate advanced features
     */
    integrateAdvancedFeatures() {
        // Advanced Features UI handles most of this, but we ensure connections here

        // Shade Analysis - handled by shadeAnalysisManager UI
        // Line of Sight - handled by lineOfSightManager UI
        // Visible/Hidden Areas - handled by visibleHiddenAreasManager UI
        // Street View - handled by streetViewManager UI
        // Cut by Polygon - handled by cutByPolygonManager UI
        // Split Screen - handled by splitScreenManager UI
        // Display Modes - handled by displayModesManager UI
        // Superman Flight Mode - handled by supermanFlightModeManager UI
        // Oblique Views - handled by obliqueViewsManager UI

        // Screenshot — primary toolbar
        // Bookmarks — primary toolbar (gallery) + nested bookmark toolbar when present

        // Search
        const regionSearch = document.getElementById('regionSearch');
        if (regionSearch) {
            regionSearch.addEventListener('input', (e) => {
                const query = e.target.value;
                if (window.searchManager && query.length > 0) {
                    window.searchManager.searchRegions(query);
                } else if (window.regionsManager) {
                    window.regionsManager.clearSearch();
                }
            });
        }
    }

    /**
     * Integrate search and filters
     */
    integrateSearchAndFilters() {
        // Date filters
        const dateFilterStart = document.getElementById('dateFilterStart');
        const dateFilterEnd = document.getElementById('dateFilterEnd');

        const applyDateFilter = () => {
            if (dateFilterStart && dateFilterEnd && window.regionsManager) {
                const start = dateFilterStart.value;
                const end = dateFilterEnd.value;
                if (start && end) {
                    window.regionsManager.filterByDateRange(start, end);
                } else {
                    window.regionsManager.clearDateFilter();
                }
            }
        };

        if (dateFilterStart) {
            dateFilterStart.addEventListener('change', applyDateFilter);
        }
        if (dateFilterEnd) {
            dateFilterEnd.addEventListener('change', applyDateFilter);
        }
    }

    /**
     * Like connectButton but skips silently when the element is absent (no warn log).
     * Use for optional legacy rails that may not exist in every layout.
     */
    connectButtonIfPresent(buttonId, handler) {
        const button = document.getElementById(buttonId);
        if (!button) return;
        const wrappedHandler = (e) => {
            try {
                handler(e);
            } catch (error) {
                if (window.errorHandler) {
                    window.errorHandler.handle(error, {
                        component: 'FrontendIntegration',
                        action: `Button click: ${buttonId}`
                    });
                } else {
                    console.error(`Error handling button ${buttonId}:`, error);
                }
            }
        };
        button.addEventListener('click', wrappedHandler);
        this.eventHandlers.set(buttonId, { element: button, handler: wrappedHandler });
    }

    /**
     * Connect a button to a handler
     */
    connectButton(buttonId, handler) {
        const button = document.getElementById(buttonId);
        if (button) {
            const wrappedHandler = (e) => {
                try {
                    handler(e);
                } catch (error) {
                    if (window.errorHandler) {
                        window.errorHandler.handle(error, {
                            component: 'FrontendIntegration',
                            action: `Button click: ${buttonId}`
                        });
                    } else {
                        console.error(`Error handling button ${buttonId}:`, error);
                    }
                }
            };
            button.addEventListener('click', wrappedHandler);
            this.eventHandlers.set(buttonId, { element: button, handler: wrappedHandler });
        } else {
            if (window.logger) {
                window.logger.warn(`FrontendIntegration: Button ${buttonId} not found`);
            }
        }
    }

    /**
     * Connect nested toolbar action
     */
    connectNestedToolbarAction(toolbarId, action, handler) {
        const toolbar = document.getElementById(toolbarId);
        if (toolbar) {
            const button = toolbar.querySelector(`[data-action="${action}"]`);
            if (button) {
                const wrappedHandler = (e) => {
                    try {
                        handler(e);
                    } catch (error) {
                        if (window.errorHandler) {
                            window.errorHandler.handle(error, {
                                component: 'FrontendIntegration',
                                action: `Nested toolbar: ${toolbarId}.${action}`
                            });
                        }
                    }
                };
                button.addEventListener('click', wrappedHandler);
                this.eventHandlers.set(`${toolbarId}.${action}`, { element: button, handler: wrappedHandler });
            }
        }
    }

    /**
     * Cleanup all event handlers
     */
    cleanup() {
        for (const [key, handlerInfo] of this.eventHandlers.entries()) {
            try {
                handlerInfo.element.removeEventListener('click', handlerInfo.handler);
            } catch (error) {
                if (window.logger) {
                    window.logger.warn(`FrontendIntegration: Error removing handler ${key}:`, error);
                }
            }
        }
        this.eventHandlers.clear();
        this.initialized = false;
    }
}

// Export singleton instance
if (typeof window !== 'undefined') {
    window.frontendIntegration = window.frontendIntegration || new FrontendIntegration();
}
