/**
 * Tile Inspector
 * Advanced tile content analysis and feature property extraction
 * Based on extract_tile_contents.js functionality
 */

class TileInspector {
    constructor() {
        this.discoveredProperties = new Set();
        this.featureStats = {
            totalFeatures: 0,
            loadedTiles: 0,
            properties: {}
        };
        this.selectedFeature = null;
        this.tileset = null;
        this.viewer = null;
        this.clickHandler = null;
    }

    /**
     * Initialize the tile inspector
     * @param {Cesium.Viewer} viewer - Cesium viewer instance
     */
    init(viewer) {
        this.viewer = viewer;
        
        // Get tileset from tilesetViewer if available
        if (window.tilesetViewer) {
            // Listen for tileset loaded events
            window.addEventListener('tilesetLoaded', (event) => {
                this.setTileset(event.detail.tileset);
            });
            
            // Check if tilesets are already loaded
            if (window.tilesetViewer.tilesets && window.tilesetViewer.tilesets.size > 0) {
                const firstEntry = window.tilesetViewer.tilesets.values().next().value;
                if (firstEntry && firstEntry.tileset) {
                    this.setTileset(firstEntry.tileset);
                }
            }
        }
    }

    /**
     * Set the tileset to inspect
     * @param {Cesium.Cesium3DTileset} tileset - Tileset to inspect
     */
    setTileset(tileset) {
        if (this.tileset === tileset) return;
        
        this.tileset = tileset;
        this.discoveredProperties.clear();
        this.featureStats = {
            totalFeatures: 0,
            loadedTiles: 0,
            properties: {}
        };
        
        if (tileset) {
            this.setupEventListeners();
        }
    }

    /**
     * Setup event listeners for tile loading and feature discovery
     */
    setupEventListeners() {
        if (!this.tileset) return;

        // Tile load progress
        if (this.tileset.tileLoadProgressEvent) {
            this.tileset.tileLoadProgressEvent.addEventListener((length) => {
                this.featureStats.loadedTiles = length;
                this.updateStats();
            });
        }

        // Tile visible - discover properties
        if (this.tileset.tileVisible) {
            this.tileset.tileVisible.addEventListener((tile) => {
                if (tile.content && tile.content.featuresLength) {
                    const length = tile.content.featuresLength;
                    this.featureStats.totalFeatures += length;
                    this.updateStats();
                    
                    // Sample properties from first feature
                    if (length > 0) {
                        try {
                            const feature = tile.content.getFeature(0);
                            if (feature) {
                                const propertyIds = feature.getPropertyIds();
                                propertyIds.forEach((propertyId) => {
                                    this.discoveredProperties.add(propertyId);
                                });
                                this.updatePropertyList();
                            }
                        } catch (e) {
                            console.warn('Error accessing feature:', e);
                        }
                    }
                }
            });
        }
    }

    /**
     * Setup click handler for feature inspection
     */
    setupClickHandler() {
        if (!this.viewer || !this.tileset) return;
        
        // Remove existing handler if any
        if (this.clickHandler) {
            this.clickHandler.destroy();
            this.clickHandler = null;
        }

        // Add new isolated click handler
        this.clickHandler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
        this.clickHandler.setInputAction((event) => {
                const picked = this.viewer.scene.pick(event.position);
                if (!Cesium.defined(picked)) {
                    this.clearFeatureInfo();
                    return;
                }

                // Prefer Cesium3DTileFeature directly
                if (picked instanceof Cesium.Cesium3DTileFeature) {
                    const pickedTs = picked.tileset || picked.primitive;
                    if (pickedTs && pickedTs !== this.tileset) {
                        this.setTileset(pickedTs);
                    }
                    this.inspectPickedFeature(picked);
                    return;
                }

                // Fallback: older pick structure {primitive, content, id}
                if (picked.primitive === this.tileset && picked.content && picked.content.getFeature) {
                    this.inspectPickedObject(picked);
                    return;
                }

                this.clearFeatureInfo();
            }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }

    /**
     * Remove click handler
     */
    removeClickHandler() {
        if (this.clickHandler && this.viewer) {
            this.clickHandler.destroy();
            this.clickHandler = null;
        }
    }

    inspectPickedObject(pickedObject) {
        try {
            const feature = pickedObject.content.getFeature(pickedObject.id);
            if (!feature) {
                this.clearFeatureInfo();
                return;
            }
            
            this.selectedFeature = {
                id: pickedObject.id,
                feature: feature,
                properties: this.getFeatureProperties(feature),
                tileMeta: this.getTileMetadataFromFeature(feature)
            };
            
            // Highlight feature (best-effort; many tilesets don't have an 'id' property)
            this.highlightFeature(pickedObject.id);
            
            // Dispatch event for UI update
            window.dispatchEvent(new CustomEvent('featureInspected', {
                detail: this.selectedFeature
            }));
            
        } catch (error) {
            console.error('Error inspecting feature:', error);
            window.dispatchEvent(new CustomEvent('featureInspected', {
                detail: { error: error.message }
            }));
        }
    }

    inspectPickedFeature(feature) {
        try {
            const properties = this.getFeatureProperties(feature);
            this.selectedFeature = {
                id: null,
                feature,
                properties,
                tileMeta: this.getTileMetadataFromFeature(feature)
            };

            window.dispatchEvent(new CustomEvent('featureInspected', {
                detail: this.selectedFeature
            }));
        } catch (error) {
            console.error('Error inspecting feature:', error);
            window.dispatchEvent(new CustomEvent('featureInspected', {
                detail: { error: error.message }
            }));
        }
    }

    getTileMetadataFromFeature(feature) {
        const meta = {
            geometricError: null,
            refine: null,
            contentUri: null,
            boundingVolumeType: null,
            childrenCount: null,
            depth: null,
            featuresLength: null
        };

        try {
            const content = feature?.content;
            const tile = content?.tile || content?._tile;
            const tileset = feature?.tileset || this.tileset;

            meta.featuresLength = (content && typeof content.featuresLength === 'number') ? content.featuresLength : null;

            // Geometric error / refine
            meta.geometricError = tile?.geometricError ?? tile?._geometricError ?? tileset?._root?.geometricError ?? null;
            meta.refine = tile?.refine ?? tile?._refine ?? tileset?._root?.refine ?? null;

            // Content URI
            meta.contentUri =
                tile?.content?.uri ||
                tile?.contentUri ||
                tile?._contentResource?.url ||
                tile?._header?.content?.uri ||
                tileset?._url ||
                null;

            // Bounding volume type
            const bv = tile?._header?.boundingVolume || tile?.boundingVolume?._boundingVolume || null;
            if (bv) {
                if (bv.region) meta.boundingVolumeType = 'region';
                else if (bv.box) meta.boundingVolumeType = 'box';
                else if (bv.sphere) meta.boundingVolumeType = 'sphere';
                else meta.boundingVolumeType = 'unknown';
            }

            meta.childrenCount = Array.isArray(tile?.children) ? tile.children.length : null;

            // Depth in tree
            let depth = 0;
            let t = tile;
            while (t && t.parent) {
                depth += 1;
                t = t.parent;
            }
            meta.depth = tile ? depth : null;
        } catch {
            // best-effort only
        }

        return meta;
    }

    /**
     * Get all properties from a feature
     * @param {Cesium.Cesium3DTileFeature} feature - Feature to get properties from
     * @returns {Object} Properties object
     */
    getFeatureProperties(feature) {
        const properties = {};
        const propertyIds = feature.getPropertyIds();
        
        propertyIds.forEach((propertyId) => {
            properties[propertyId] = feature.getProperty(propertyId);
        });
        
        return properties;
    }

    /**
     * Get specific property from feature
     * @param {Cesium.Cesium3DTileFeature} feature - Feature
     * @param {string} propertyName - Property name
     * @returns {*} Property value
     */
    getFeatureProperty(feature, propertyName) {
        if (feature && feature.hasProperty(propertyName)) {
            return feature.getProperty(propertyName);
        }
        return null;
    }

    /**
     * Highlight a feature by ID
     * @param {number} featureId - Feature ID to highlight
     */
    highlightFeature(featureId) {
        if (!this.tileset) return;
        
        // Create style that highlights selected feature
        this.tileset.style = new Cesium.Cesium3DTileStyle({
            color: {
                conditions: [
                    [`\${id} === ${featureId}`, 'color("yellow", 1.0)'],
                    ['true', 'color("white", 0.8)']
                ]
            }
        });
    }

    /**
     * Reset style to default
     */
    resetStyle() {
        if (this.tileset) {
            this.tileset.style = null;
        }
    }

    /**
     * Analyze feature properties from visible tiles
     */
    analyzeProperties() {
        if (!this.tileset) return;
        
        this.discoveredProperties.clear();
        this.featureStats.totalFeatures = 0;
        
        // Force re-analysis by checking visible tiles
        const visibleTiles = [];
        const processTile = (tile) => {
            if (tile.content && tile.content.featuresLength) {
                const length = tile.content.featuresLength;
                this.featureStats.totalFeatures += length;
                
                if (length > 0) {
                    try {
                        const feature = tile.content.getFeature(0);
                        if (feature) {
                            const propertyIds = feature.getPropertyIds();
                            propertyIds.forEach((propertyId) => {
                                this.discoveredProperties.add(propertyId);
                            });
                        }
                    } catch (e) {
                        console.warn('Error accessing feature:', e);
                    }
                }
            }
        };
        
        // Process all visible tiles
        if (this.tileset.root) {
            this.processTileRecursive(this.tileset.root, processTile);
        }
        
        setTimeout(() => {
            this.updatePropertyList();
            this.updateStats();
            console.log('Discovered properties:', Array.from(this.discoveredProperties));
        }, 1000);
    }

    /**
     * Recursively process tiles
     * @param {Cesium.Cesium3DTile} tile - Tile to process
     * @param {Function} callback - Callback function
     */
    processTileRecursive(tile, callback) {
        if (!tile) return;
        
        callback(tile);
        
        if (tile.children) {
            tile.children.forEach((child) => {
                this.processTileRecursive(child, callback);
            });
        }
    }

    /**
     * Analyze tiles and get comprehensive statistics
     */
    analyzeTiles() {
        if (!this.tileset) return;
        
        const stats = this.analyzeFeatureProperties(this.tileset);
        return stats;
    }

    /**
     * Analyze feature properties from tileset
     * @param {Cesium.Cesium3DTileset} tileset - Tileset to analyze
     * @returns {Object} Statistics object
     */
    analyzeFeatureProperties(tileset) {
        const stats = {};
        let totalFeatures = 0;
        
        const processTile = (tile) => {
            if (!tile.content || !tile.content.featuresLength) {
                return;
            }
            
            const length = tile.content.featuresLength;
            totalFeatures += length;
            
            if (length > 0) {
                try {
                    const sampleFeature = tile.content.getFeature(0);
                    const propertyIds = sampleFeature.getPropertyIds();
                    
                    propertyIds.forEach((propertyId) => {
                        if (!stats[propertyId]) {
                            stats[propertyId] = {
                                type: null,
                                min: null,
                                max: null,
                                values: new Set(),
                                count: 0
                            };
                        }
                        
                        // Sample values from this tile
                        for (let i = 0; i < Math.min(100, length); i++) {
                            const feature = tile.content.getFeature(i);
                            const value = feature.getProperty(propertyId);
                            
                            if (stats[propertyId].type === null) {
                                stats[propertyId].type = typeof value;
                            }
                            
                            if (typeof value === 'number') {
                                if (stats[propertyId].min === null || value < stats[propertyId].min) {
                                    stats[propertyId].min = value;
                                }
                                if (stats[propertyId].max === null || value > stats[propertyId].max) {
                                    stats[propertyId].max = value;
                                }
                            } else {
                                stats[propertyId].values.add(value);
                            }
                            
                            stats[propertyId].count++;
                        }
                    });
                } catch (e) {
                    console.warn('Error analyzing tile:', e);
                }
            }
        };
        
        if (tileset.root) {
            this.processTileRecursive(tileset.root, processTile);
        }
        
        // Convert Sets to Arrays for serialization
        const serializedStats = {};
        Object.keys(stats).forEach((key) => {
            serializedStats[key] = {
                ...stats[key],
                values: Array.from(stats[key].values)
            };
        });
        
        return {
            totalFeatures,
            properties: serializedStats
        };
    }

    /**
     * Apply style based on property
     * @param {string} propertyName - Property name to style by
     * @param {string} styleType - Style type ('color', 'show', etc.)
     */
    applyPropertyStyle(propertyName, styleType = 'color') {
        if (!this.tileset || !propertyName) {
            this.resetStyle();
            return;
        }
        
        // Try to create a style based on property type
        this.tileset.style = new Cesium.Cesium3DTileStyle({
            color: `color("cyan", 0.8)`,
            show: true
        });
        
        console.log(`Applied style based on property: ${propertyName}`);
    }

    /**
     * Export features to JSON
     * @param {number} maxFeatures - Maximum number of features to export
     * @returns {Promise<Array>} Array of feature data
     */
    async exportFeaturesToJSON(maxFeatures = 1000) {
        if (!this.tileset) return [];
        
        const allFeatures = [];
        let count = 0;
        
        const processTile = (tile) => {
            if (count >= maxFeatures || !tile.content || !tile.content.featuresLength) {
                return;
            }
            
            const length = tile.content.featuresLength;
            for (let i = 0; i < length && count < maxFeatures; i++) {
                try {
                    const feature = tile.content.getFeature(i);
                    if (feature) {
                        const properties = {};
                        const propertyIds = feature.getPropertyIds();
                        
                        propertyIds.forEach((propertyId) => {
                            properties[propertyId] = feature.getProperty(propertyId);
                        });
                        
                        allFeatures.push({
                            tileUri: tile.content.uri || 'unknown',
                            featureIndex: i,
                            properties: properties
                        });
                        
                        count++;
                    }
                } catch (e) {
                    console.warn('Error exporting feature:', e);
                }
            }
        };
        
        if (this.tileset.root) {
            this.processTileRecursive(this.tileset.root, processTile);
        }
        
        return allFeatures;
    }

    /**
     * Export properties list
     * @returns {Object} Properties and stats data
     */
    exportProperties() {
        return {
            properties: Array.from(this.discoveredProperties),
            stats: this.featureStats
        };
    }

    /**
     * Update stats display
     */
    updateStats() {
        window.dispatchEvent(new CustomEvent('tileInspectorStatsUpdated', {
            detail: {
                tileCount: this.featureStats.loadedTiles,
                featureCount: this.featureStats.totalFeatures
            }
        }));
    }

    /**
     * Update property list display
     */
    updatePropertyList() {
        window.dispatchEvent(new CustomEvent('tileInspectorPropertiesUpdated', {
            detail: {
                properties: Array.from(this.discoveredProperties).sort()
            }
        }));
    }

    /**
     * Clear feature info
     */
    clearFeatureInfo() {
        this.selectedFeature = null;
        window.dispatchEvent(new CustomEvent('featureInspected', {
            detail: null
        }));
    }

    /**
     * Format value for display
     * @param {*} value - Value to format
     * @returns {string} Formatted value
     */
    formatValue(value) {
        if (value === null || value === undefined) {
            return '<span style="color: #999;">null</span>';
        }
        if (typeof value === 'object') {
            return JSON.stringify(value, null, 2);
        }
        if (typeof value === 'number') {
            return value.toLocaleString();
        }
        return String(value);
    }
}

// Export as global
window.tileInspector = new TileInspector();
