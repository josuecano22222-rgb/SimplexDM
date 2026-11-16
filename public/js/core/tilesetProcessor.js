/**
 * TilesetProcessor
 * Tileset validation and optimization
 */

class TilesetProcessor {
    constructor() {
        this.qualityLevels = {
            low: { maximumScreenSpaceError: 32, skipLevelOfDetail: true },
            medium: { maximumScreenSpaceError: 16, skipLevelOfDetail: false },
            high: { maximumScreenSpaceError: 16, maximumMemoryUsage: 256 },
            ultra: { maximumScreenSpaceError: 4, skipLevelOfDetail: false }
        };
    }

    /**
     * Validate tileset JSON structure
     * @param {Object} tilesetJson - Tileset JSON object
     * @returns {Object} Validation results
     */
    validateTileset(tilesetJson) {
        // Input validation
        if (!tilesetJson || typeof tilesetJson !== 'object') {
            return {
                valid: false,
                errors: ['Invalid tileset JSON: must be an object'],
                warnings: [],
                info: []
            };
        }

        const results = {
            valid: true,
            errors: [],
            warnings: [],
            info: []
        };

        // Check required properties
        if (!tilesetJson.asset) {
            results.errors.push('Missing required property: asset');
            results.valid = false;
        } else {
            if (!tilesetJson.asset.version) {
                results.warnings.push('Missing asset.version');
            }
        }

        if (!tilesetJson.root) {
            results.errors.push('Missing required property: root');
            results.valid = false;
        } else {
            // Use cycle detection set
            const visitedTiles = new Set();
            this.validateTile(tilesetJson.root, results, 'root', visitedTiles);
        }

        if (!tilesetJson.geometricError && tilesetJson.geometricError !== 0) {
            results.warnings.push('Missing geometricError at root level');
        }

        return results;
    }

    /**
     * Validate tile recursively with cycle detection
     * @param {Object} tile - Tile object to validate
     * @param {Object} results - Results object to populate
     * @param {string} path - Current path in hierarchy
     * @param {Set} visitedTiles - Set of visited tiles for cycle detection
     */
    validateTile(tile, results, path, visitedTiles = new Set()) {
        // Input validation
        if (!tile || typeof tile !== 'object') {
            results.errors.push(`Invalid tile at ${path}: must be an object`);
            results.valid = false;
            return;
        }

        // Cycle detection: check if we've already visited this tile object
        if (visitedTiles.has(tile)) {
            results.warnings.push(`Cycle detected at ${path}, skipping further validation`);
            return;
        }

        // Mark as visited
        visitedTiles.add(tile);

        // Validate bounding volume
        if (!tile.boundingVolume) {
            results.warnings.push(`Missing boundingVolume at ${path}`);
        } else {
            const bv = tile.boundingVolume;
            if (!bv.sphere && !bv.box && !bv.region) {
                results.errors.push(`Invalid boundingVolume at ${path}: must have sphere, box, or region`);
                results.valid = false;
            }
        }

        // Validate geometric error
        if (tile.geometricError === undefined || tile.geometricError === null) {
            results.warnings.push(`Missing geometricError at ${path}`);
        } else if (typeof tile.geometricError !== 'number' || tile.geometricError < 0) {
            results.errors.push(`Invalid geometricError at ${path}: must be a non-negative number`);
            results.valid = false;
        }

        // Validate children
        if (tile.children && Array.isArray(tile.children)) {
            tile.children.forEach((child, index) => {
                // Pass visitedTiles set to detect cycles
                this.validateTile(child, results, `${path}.children[${index}]`, visitedTiles);
            });
        }

        // Remove from visited set after processing (allows revisiting in different branches)
        visitedTiles.delete(tile);
    }

    /**
     * Get quality settings
     * @param {string} quality - Quality level: 'low', 'medium', 'high', or 'ultra'
     * @returns {Object} Quality settings
     */
    getQualitySettings(quality) {
        if (!quality || typeof quality !== 'string') {
            return this.qualityLevels.medium;
        }
        return this.qualityLevels[quality.toLowerCase()] || this.qualityLevels.medium;
    }

    /**
     * Optimize tileset settings
     * @param {Object} tilesetJson - Tileset JSON object
     * @param {string} quality - Quality level
     * @returns {Object} Optimized settings
     */
    optimizeSettings(tilesetJson, quality = 'medium') {
        // Input validation
        if (!tilesetJson || typeof tilesetJson !== 'object') {
            throw new Error('Invalid tilesetJson: must be an object');
        }

        const settings = this.getQualitySettings(quality);
        return {
            ...settings,
            basePath: tilesetJson.basePath || ''
        };
    }

    /**
     * Find nested tilesets
     * @param {Object} tilesetJson - Tileset JSON object
     * @returns {Array} Array of nested tileset information
     */
    findNestedTilesets(tilesetJson) {
        // Input validation
        if (!tilesetJson || typeof tilesetJson !== 'object') {
            return [];
        }

        const nested = [];
        const visitedTiles = new Set(); // Cycle detection
        
        const traverse = (tile, path = 'root') => {
            // Cycle detection
            if (visitedTiles.has(tile)) {
                return;
            }
            visitedTiles.add(tile);

            if (tile.content && tile.content.uri) {
                const uri = tile.content.uri;
                if (typeof uri === 'string' && uri.endsWith('.json')) {
                    nested.push({
                        path: path,
                        uri: uri,
                        geometricError: tile.geometricError
                    });
                }
            }
            
            if (tile.children && Array.isArray(tile.children)) {
                tile.children.forEach((child, index) => {
                    traverse(child, `${path}.children[${index}]`);
                });
            }

            visitedTiles.delete(tile);
        };
        
        if (tilesetJson.root) {
            traverse(tilesetJson.root);
        }
        
        return nested;
    }

    /**
     * Find the last (deepest) tiles in the tileset JSON
     * Returns leaf nodes (tiles with no children) at maximum depth
     * @param {Object} tilesetJson - Tileset JSON object
     * @returns {Object} Object with tiles array, maxDepth, and count
     */
    findLastTiles(tilesetJson) {
        // Input validation
        if (!tilesetJson || typeof tilesetJson !== 'object') {
            return { tiles: [], maxDepth: 0, count: 0 };
        }

        const lastTiles = [];
        let maxDepth = 0;
        const visitedTiles = new Set(); // Cycle detection
        
        const traverse = (tile, path = 'root', depth = 0) => {
            // Cycle detection
            if (visitedTiles.has(tile)) {
                return;
            }
            visitedTiles.add(tile);

            // Check if this is a leaf node (no children or empty children array)
            const isLeaf = !tile.children || tile.children.length === 0;
            
            if (isLeaf) {
                // Store minimal data instead of full tile object to prevent memory leak
                const tileInfo = {
                    path: path,
                    depth: depth,
                    geometricError: tile.geometricError,
                    contentUri: tile.content?.uri || null
                };
                
                if (depth > maxDepth) {
                    maxDepth = depth;
                    lastTiles.length = 0; // Clear previous results
                    lastTiles.push(tileInfo);
                } else if (depth === maxDepth) {
                    lastTiles.push(tileInfo);
                }
            }
            
            // Continue traversing children
            if (tile.children && Array.isArray(tile.children) && tile.children.length > 0) {
                tile.children.forEach((child, index) => {
                    traverse(child, `${path}.children[${index}]`, depth + 1);
                });
            }

            visitedTiles.delete(tile);
        };
        
        if (tilesetJson.root) {
            traverse(tilesetJson.root);
        }
        
        return {
            tiles: lastTiles,
            maxDepth: maxDepth,
            count: lastTiles.length
        };
    }

    /**
     * Find the last nested tileset JSON file (deepest nested tileset)
     * @param {Object} tilesetJson - Tileset JSON object
     * @returns {Object} Object with lastTileset, allNested array, and maxDepth
     */
    findLastNestedTileset(tilesetJson) {
        // Input validation
        if (!tilesetJson || typeof tilesetJson !== 'object') {
            return { lastTileset: null, allNested: [], maxDepth: 0 };
        }

        const nestedTilesets = [];
        let maxDepth = 0;
        let lastTileset = null;
        const visitedTiles = new Set(); // Cycle detection
        
        const traverse = (tile, path = 'root', depth = 0) => {
            // Cycle detection
            if (visitedTiles.has(tile)) {
                return;
            }
            visitedTiles.add(tile);

            if (tile.content && tile.content.uri) {
                const uri = tile.content.uri;
                if (typeof uri === 'string' && uri.endsWith('.json')) {
                    // Store minimal data instead of full tile object
                    const tilesetInfo = {
                        path: path,
                        uri: uri,
                        depth: depth,
                        geometricError: tile.geometricError
                    };
                    
                    nestedTilesets.push(tilesetInfo);
                    
                    // Track the deepest nested tileset
                    if (depth >= maxDepth) {
                        maxDepth = depth;
                        lastTileset = tilesetInfo;
                    }
                }
            }
            
            if (tile.children && Array.isArray(tile.children)) {
                tile.children.forEach((child, index) => {
                    traverse(child, `${path}.children[${index}]`, depth + 1);
                });
            }

            visitedTiles.delete(tile);
        };
        
        if (tilesetJson.root) {
            traverse(tilesetJson.root);
        }
        
        return {
            lastTileset: lastTileset,
            allNested: nestedTilesets,
            maxDepth: maxDepth
        };
    }

    /**
     * Get ultra-high accuracy settings for processing last tiles
     * Old method: Very high accuracy with no distortion, simple direct configuration
     * These settings ensure maximum detail and accuracy for last tiles
     */
    getUltraHighAccuracySettings() {
        return {
            maximumScreenSpaceError: 0.1, // Very low error = very high detail (old method: maximum accuracy)
            dynamicScreenSpaceError: false, // Keep LOD consistent with top-down; oblique matched via viewer SSE
            skipLevelOfDetail: false, // Don't skip any levels - load all detail
            maximumMemoryUsage: 2048, // MB (Cesium API) — ~2GB GPU budget for tiles
            preferLeaves: true, // Prefer leaf tiles (finest detail)
            loadSiblings: true, // Load sibling tiles for context
            cullWithChildrenBounds: false, // Don't cull based on children bounds
            baseScreenSpaceError: 0, // Base error of 0 for maximum accuracy
            refine: Cesium.Cesium3DTileRefine.REPLACE // Use REPLACE (not ADD) to avoid layer blending/distortion
        };
    }

    /**
     * Process last tiles with ultra-high accuracy
     * Applies maximum accuracy settings to the deepest tiles in the tileset
     * @param {Object} tilesetJson - Tileset JSON object
     * @param {Cesium.Cesium3DTileset} tilesetInstance - Optional Cesium tileset instance
     * @returns {Promise<Object>} Processing results
     */
    async processLastTilesWithHighAccuracy(tilesetJson, tilesetInstance = null) {
        // Input validation
        if (!tilesetJson || typeof tilesetJson !== 'object') {
            throw new Error('Invalid tilesetJson: must be an object');
        }

        const lastTilesInfo = this.findLastTiles(tilesetJson);
        const lastNestedInfo = this.findLastNestedTileset(tilesetJson);
        
        console.log('Processing last tiles with ultra-high accuracy:', {
            lastTilesCount: lastTilesInfo.count,
            maxDepth: lastTilesInfo.maxDepth,
            lastNestedTileset: lastNestedInfo.lastTileset?.uri || 'none'
        });
        
        // Get ultra-high accuracy settings
        const ultraSettings = this.getUltraHighAccuracySettings();
        
        // If we have a tileset instance, apply settings using public API only
        // Old method: Direct simple configuration for maximum accuracy without distortion
        if (tilesetInstance) {
            // Apply maximum accuracy settings using public API
            tilesetInstance.maximumScreenSpaceError = ultraSettings.maximumScreenSpaceError;
            tilesetInstance.skipLevelOfDetail = ultraSettings.skipLevelOfDetail;
            
            // Set high memory usage to prevent tile eviction and distortion
            tilesetInstance.maximumMemoryUsage = ultraSettings.maximumMemoryUsage;
            
            // Use REPLACE refinement to avoid layer blending/distortion
            if (ultraSettings.refine !== undefined) {
                tilesetInstance.refine = ultraSettings.refine;
            }
            
            // Disable level skipping completely for maximum detail
            tilesetInstance.skipLevels = 0;
            tilesetInstance.baseScreenSpaceError = ultraSettings.baseScreenSpaceError || 0;
            
            // Prevent tiles from being unloaded when zooming out (old method: keep tiles loaded)
            tilesetInstance.immediatelyLoadDesiredLevelOfDetail = false;
            tilesetInstance.loadingDescendantLimit = 2000; // High limit to load all detail
            if (tilesetInstance.dynamicScreenSpaceError !== undefined) {
                tilesetInstance.dynamicScreenSpaceError = ultraSettings.dynamicScreenSpaceError;
            }

            // Use public API to request maximum detail
            // Note: We avoid accessing private properties like _tilesToRender or _shouldRender
            // Instead, we rely on Cesium's public API to handle tile loading
            
            console.log('Applied old method ultra-high accuracy settings to tileset:', {
                maximumScreenSpaceError: tilesetInstance.maximumScreenSpaceError,
                skipLevelOfDetail: tilesetInstance.skipLevelOfDetail,
                maximumMemoryUsage: tilesetInstance.maximumMemoryUsage,
                refine: tilesetInstance.refine,
                skipLevels: tilesetInstance.skipLevels,
                baseScreenSpaceError: tilesetInstance.baseScreenSpaceError
            });
        }
        
        return {
            lastTiles: lastTilesInfo,
            lastNestedTileset: lastNestedInfo,
            settings: ultraSettings,
            applied: tilesetInstance !== null
        };
    }
}

// Export singleton instance
window.tilesetProcessor = new TilesetProcessor();
