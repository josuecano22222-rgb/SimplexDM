/**
 * DisplayControl
 * Display and tileset management logic
 */

class DisplayControl {
    constructor() {
        this.tilesetViewer = null;
        this.pathManager = null;
        this.currentTilesets = new Map();
        this.quality = 'ultra'; // Default to ultra-high resolution
        /* init() from InitializationManager after jsonConfigManager (runtime appSettings) */
    }

    /**
     * Initialize with dependencies
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.pathManager = window.pathManager;
        try {
            const raw = localStorage.getItem('appSettings');
            if (raw) {
                const s = JSON.parse(raw);
                if (s.defaultQuality) {
                    this.setDefaultQuality(s.defaultQuality);
                }
            }
        } catch (e) {
            /* ignore */
        }
    }

    /**
     * Load tileset
     */
    async loadTileset(url, options = {}) {
        if (!this.tilesetViewer) {
            throw new Error('TilesetViewer not initialized');
        }

        // Ensure viewer is initialized before loading tileset
        if (!this.tilesetViewer.viewer) {
            // Wait for initialization to complete
            await this.tilesetViewer.init();
        }

        try {
            const alreadyHasTilesets =
                this.currentTilesets && this.currentTilesets.size > 0;

            // Direct high resolution loading — additional masters stay on screen (no camera jump unless asked)
            const fitToView =
                options.fitToView !== undefined
                    ? options.fitToView
                    : !alreadyHasTilesets;

            const mergeRegionCatalog =
                options.mergeRegionCatalog !== undefined
                    ? options.mergeRegionCatalog
                    : alreadyHasTilesets;

            // High accuracy (low SSE, REPLACE, full LOD). View-first tile streaming (foveated SSE along
            // the view axis, no preloadWhenHidden) is applied inside TilesetViewer.getViewPriorityTilesetDefaults().
            const defaultSse =
                this.quality === 'ultra' ? 0.08 : 0.1;
            const loadOptions = {
                maximumScreenSpaceError:
                    options.maximumScreenSpaceError ?? defaultSse,
                maximumMemoryUsage: options.maximumMemoryUsage ?? 2048,
                refine: Cesium.Cesium3DTileRefine.REPLACE,
                skipLevelOfDetail: false,
                skipLevels: 0,
                baseScreenSpaceError: 0,
                immediatelyLoadDesiredLevelOfDetail: false,
                loadingDescendantLimit: 768,
                dynamicScreenSpaceError: false,
                fitToView,
                ...options
            };
            
            // Load tileset directly (no processing)
            const tilesetId = await this.tilesetViewer.loadTileset(url, loadOptions);

            // Store tileset info
            this.currentTilesets.set(tilesetId, {
                id: tilesetId,
                url: url,
                quality: this.quality,
                visible: true
            });

            if (
                window.regionsManager &&
                /\.json(\?|$)/i.test(String(url)) &&
                mergeRegionCatalog !== false
            ) {
                try {
                    await window.regionsManager.loadMasterTileset(url, {
                        merge: mergeRegionCatalog
                    });
                } catch (e) {
                    console.warn('Region catalog (master JSON):', e);
                }
            }

            // Update UI
            if (window.displayControlUI) {
                window.displayControlUI.refresh();
            }

            window.notification?.success('Tileset loaded successfully');
            return tilesetId;
        } catch (error) {
            const errorMessage = error?.message || error?.toString() || 'Unknown error';
            window.notification?.error('Failed to load tileset: ' + errorMessage);
            console.error('Tileset loading error:', error);
            throw error;
        }
    }


    /**
     * Remove tileset
     */
    removeTileset(id) {
        if (!this.tilesetViewer) return false;

        const prev = this.currentTilesets.get(id);
        const masterUrl = prev?.url;

        const removed = this.tilesetViewer.removeTileset(id);
        if (removed) {
            this.currentTilesets.delete(id);
            if (masterUrl && window.regionsManager) {
                window.regionsManager.removeRegionsForMasterUrl(masterUrl);
            }
            if (window.displayControlUI) {
                window.displayControlUI.refresh();
            }
        }
        return removed;
    }

    /**
     * Toggle tileset visibility
     */
    toggleTilesetVisibility(id, visible) {
        if (!this.tilesetViewer) return false;

        const toggled = this.tilesetViewer.toggleTilesetVisibility(id, visible);
        if (toggled) {
            const tileset = this.currentTilesets.get(id);
            if (tileset) {
                tileset.visible = visible;
            }
            this.tilesetViewer.viewer?.scene?.requestRender?.();
        }
        return toggled;
    }

    /**
     * Set quality for tileset (now just sets SSE directly)
     * CRITICAL: Always maintains REPLACE refinement to prevent distortion
     */
    async setQuality(id, quality) {
        const tileset = this.currentTilesets.get(id);
        if (!tileset) return false;

        // Map quality to SSE values (lower SSE = higher resolution)
        const qualityMap = {
            low: 16,
            medium: 4,
            high: 1,
            ultra: 0.08
        };
        
        const sse = qualityMap[quality] || qualityMap.ultra;
        
        // Update tileset directly with anti-distortion settings
        const tilesetData = this.tilesetViewer.tilesets.get(id);
        if (tilesetData && tilesetData.tileset) {
            const tileset = tilesetData.tileset;
            tilesetData.options = tilesetData.options || {};
            tilesetData.options.maximumScreenSpaceError = sse;
            const Ctor = this.tilesetViewer.constructor;
            const mult =
                typeof Ctor.getViewAngleSseMultiplier === 'function'
                    ? Ctor.getViewAngleSseMultiplier(
                          this.tilesetViewer.viewer.camera,
                          this.tilesetViewer.viewer.scene.mode
                      )
                    : 1;
            tileset.maximumScreenSpaceError = sse * mult;
            tileset.refine = Cesium.Cesium3DTileRefine.REPLACE; // Always use REPLACE to prevent distortion
            tileset.skipLevelOfDetail = false; // Never skip levels
            tileset.skipLevels = 0; // Don't skip any levels
            tileset.baseScreenSpaceError = 0; // Maximum accuracy
            this.quality = quality;
            this.tilesetViewer.viewer?.scene?.requestRender?.();
            return true;
        }
        
        return false;
    }

    /**
     * Fit tileset to view
     */
    async fitToView(id) {
        if (!this.tilesetViewer) return false;
        return await this.tilesetViewer.fitToView(id);
    }

    /**
     * Get all loaded tilesets
     */
    getAllTilesets() {
        return Array.from(this.currentTilesets.values());
    }

    /**
     * Set default quality
     */
    setDefaultQuality(quality) {
        this.quality = quality;
    }

    /**
     * Apply dashboard / Control Center appSettings object (quality, etc.).
     * @param {Object|null} settings
     */
    applyAppSettings(settings) {
        if (!settings || typeof settings !== 'object') return;
        if (settings.defaultQuality) {
            this.setDefaultQuality(settings.defaultQuality);
        }
    }
}

// Export singleton instance
window.displayControl = new DisplayControl();
