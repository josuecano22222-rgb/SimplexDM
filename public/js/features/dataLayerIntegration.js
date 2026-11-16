/**
 * DataLayerIntegration
 * Comprehensive data layer integration system
 * Features:
 * - Urban planning layers (zoning, land use, building plans)
 * - Infrastructure layers (transportation, utilities)
 * - Financial and market data layers
 * - Environmental and cultural layers
 * - User-defined layer upload and visualization
 * - AI-enhanced data classification
 */

class DataLayerIntegration {
    constructor(viewer) {
        this.viewer = viewer;
        this.scene = viewer ? viewer.scene : null;
        this.layers = new Map();
        this.layerCategories = {
            urbanPlanning: [],
            infrastructure: [],
            financial: [],
            environmental: [],
            userDefined: []
        };
        this.enabled = true;
        this.visibleLayers = new Set();
        
        // Layer styling
        this.defaultStyles = {
            urbanPlanning: {
                color: Cesium.Color.BLUE.withAlpha(0.3),
                outlineColor: Cesium.Color.BLUE,
                outlineWidth: 2
            },
            infrastructure: {
                color: Cesium.Color.ORANGE.withAlpha(0.3),
                outlineColor: Cesium.Color.ORANGE,
                outlineWidth: 2
            },
            financial: {
                color: Cesium.Color.GREEN.withAlpha(0.3),
                outlineColor: Cesium.Color.GREEN,
                outlineWidth: 2
            },
            environmental: {
                color: Cesium.Color.YELLOW.withAlpha(0.3),
                outlineColor: Cesium.Color.YELLOW,
                outlineWidth: 2
            },
            userDefined: {
                color: Cesium.Color.PURPLE.withAlpha(0.3),
                outlineColor: Cesium.Color.PURPLE,
                outlineWidth: 2
            }
        };
        
        this.init();
    }

    /**
     * Initialize data layer integration
     */
    init() {
        if (!this.viewer || !this.scene) {
            console.warn('DataLayerIntegration: Viewer not available');
            return;
        }

        console.log('DataLayerIntegration initialized');
    }

    /**
     * Add urban planning layer
     * @param {string} id - Layer ID
     * @param {Object} data - Layer data (GeoJSON, KML, or custom format)
     * @param {Object} options - Layer options
     */
    addUrbanPlanningLayer(id, data, options = {}) {
        return this.addLayer(id, data, 'urbanPlanning', {
            name: options.name || id,
            description: options.description || '',
            style: options.style || this.defaultStyles.urbanPlanning,
            ...options
        });
    }

    /**
     * Add infrastructure layer
     * @param {string} id - Layer ID
     * @param {Object} data - Layer data
     * @param {Object} options - Layer options
     */
    addInfrastructureLayer(id, data, options = {}) {
        return this.addLayer(id, data, 'infrastructure', {
            name: options.name || id,
            description: options.description || '',
            style: options.style || this.defaultStyles.infrastructure,
            ...options
        });
    }

    /**
     * Add financial layer
     * @param {string} id - Layer ID
     * @param {Object} data - Layer data
     * @param {Object} options - Layer options
     */
    addFinancialLayer(id, data, options = {}) {
        return this.addLayer(id, data, 'financial', {
            name: options.name || id,
            description: options.description || '',
            style: options.style || this.defaultStyles.financial,
            ...options
        });
    }

    /**
     * Add environmental layer
     * @param {string} id - Layer ID
     * @param {Object} data - Layer data
     * @param {Object} options - Layer options
     */
    addEnvironmentalLayer(id, data, options = {}) {
        return this.addLayer(id, data, 'environmental', {
            name: options.name || id,
            description: options.description || '',
            style: options.style || this.defaultStyles.environmental,
            ...options
        });
    }

    /**
     * Add user-defined layer
     * @param {string} id - Layer ID
     * @param {Object} data - Layer data
     * @param {Object} options - Layer options
     */
    addUserDefinedLayer(id, data, options = {}) {
        return this.addLayer(id, data, 'userDefined', {
            name: options.name || id,
            description: options.description || '',
            style: options.style || this.defaultStyles.userDefined,
            ...options
        });
    }

    /**
     * Add layer (generic)
     * @param {string} id - Layer ID
     * @param {Object} data - Layer data
     * @param {string} category - Layer category
     * @param {Object} options - Layer options
     */
    addLayer(id, data, category, options = {}) {
        if (!this.enabled) {
            console.warn('DataLayerIntegration is disabled');
            return null;
        }

        const layer = {
            id: id,
            category: category,
            data: data,
            name: options.name || id,
            description: options.description || '',
            style: options.style || this.defaultStyles[category] || this.defaultStyles.userDefined,
            visible: options.visible !== false,
            entities: [],
            dataSource: null,
            metadata: options.metadata || {}
        };

        // Parse and visualize data
        this.parseAndVisualizeLayer(layer);

        // Store layer
        this.layers.set(id, layer);
        this.layerCategories[category].push(layer);

        // Show if visible
        if (layer.visible) {
            this.showLayer(id);
        }

        return layer;
    }

    /**
     * Parse and visualize layer data
     * @param {Object} layer - Layer object
     */
    parseAndVisualizeLayer(layer) {
        if (!layer.data) return;

        // Check data format
        if (layer.data.type === 'FeatureCollection' || layer.data.features) {
            // GeoJSON format
            this.parseGeoJSON(layer);
        } else if (layer.data.document || layer.data.kml) {
            // KML format
            this.parseKML(layer);
        } else if (Array.isArray(layer.data)) {
            // Array of features
            this.parseFeatureArray(layer);
        } else {
            console.warn('Unknown data format for layer:', layer.id);
        }
    }

    /**
     * Parse GeoJSON data
     * @param {Object} layer - Layer object
     */
    parseGeoJSON(layer) {
        const features = layer.data.features || [];
        
        features.forEach((feature, index) => {
            const entity = this.createEntityFromFeature(feature, layer);
            if (entity) {
                layer.entities.push(entity);
            }
        });
        if (window.layerRenderingQuality && typeof window.layerRenderingQuality.refineLayerEntities === 'function') {
            window.layerRenderingQuality.refineLayerEntities(layer.entities);
        }
    }

    /**
     * Parse KML data
     * @param {Object} layer - Layer object
     */
    async parseKML(layer) {
        try {
            // Use Cesium KML data source
            const dataSource = await Cesium.KmlDataSource.load(layer.data, {
                camera: this.viewer.scene.camera,
                canvas: this.viewer.scene.canvas
            });
            
            layer.dataSource = dataSource;
            this.viewer.entities.add(dataSource.entities);
        } catch (error) {
            console.error('Failed to parse KML:', error);
        }
    }

    /**
     * Parse feature array
     * @param {Object} layer - Layer object
     */
    parseFeatureArray(layer) {
        layer.data.forEach((feature, index) => {
            const entity = this.createEntityFromFeature(feature, layer);
            if (entity) {
                layer.entities.push(entity);
            }
        });
        if (window.layerRenderingQuality && typeof window.layerRenderingQuality.refineLayerEntities === 'function') {
            window.layerRenderingQuality.refineLayerEntities(layer.entities);
        }
    }

    /**
     * Create entity from feature
     * @param {Object} feature - Feature object
     * @param {Object} layer - Layer object
     * @returns {Cesium.Entity} Entity or null
     */
    createEntityFromFeature(feature, layer) {
        if (!feature.geometry) return null;

        const geometry = feature.geometry;
        const properties = feature.properties || {};
        const style = layer.style;

        let entity = null;

        switch (geometry.type) {
            case 'Point':
                entity = this.viewer.entities.add({
                    position: this.geoJSONPositionToCartesian3(geometry.coordinates),
                    point: {
                        pixelSize: style.pointSize || 10,
                        color: style.color || Cesium.Color.WHITE,
                        outlineColor: style.outlineColor || Cesium.Color.BLACK,
                        outlineWidth: style.outlineWidth || 2
                    },
                    label: {
                        text: properties.name || properties.label || '',
                        font: '12px sans-serif',
                        fillColor: Cesium.Color.WHITE,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 2
                    },
                    properties: properties
                });
                break;

            case 'LineString':
            case 'MultiLineString':
                const positions = this.geoJSONCoordinatesToPositions(geometry.coordinates);
                entity = this.viewer.entities.add({
                    polyline: {
                        positions: positions,
                        width: style.outlineWidth || 2,
                        material: style.outlineColor || Cesium.Color.WHITE,
                        clampToGround: true,
                        arcType: Cesium.ArcType.GEODESIC,
                        granularity: Cesium.Math.toRadians(0.1),
                        ...(Cesium.ClassificationType
                            ? { classificationType: Cesium.ClassificationType.BOTH }
                            : {})
                    },
                    properties: properties
                });
                break;

            case 'Polygon':
            case 'MultiPolygon':
                const hierarchy = this.geoJSONCoordinatesToHierarchy(geometry.coordinates);
                entity = this.viewer.entities.add({
                    polygon: {
                        hierarchy: hierarchy,
                        material: style.color || Cesium.Color.WHITE.withAlpha(0.3),
                        outline: true,
                        outlineColor: style.outlineColor || Cesium.Color.WHITE,
                        outlineWidth: style.outlineWidth || 2,
                        ...(Cesium.ClassificationType
                            ? { classificationType: Cesium.ClassificationType.BOTH }
                            : {})
                    },
                    properties: properties
                });
                break;
        }

        return entity;
    }

    /**
     * Convert GeoJSON position to Cartesian3
     * @param {Array} coordinates - [longitude, latitude, height]
     * @returns {Cesium.Cartesian3} Cartesian3 position
     */
    geoJSONPositionToCartesian3(coordinates) {
        return Cesium.Cartesian3.fromDegrees(
            coordinates[0],
            coordinates[1],
            coordinates[2] || 0
        );
    }

    /**
     * Convert GeoJSON coordinates to positions array
     * @param {Array} coordinates - Coordinates array
     * @returns {Array} Positions array
     */
    geoJSONCoordinatesToPositions(coordinates) {
        if (coordinates[0][0] instanceof Array) {
            // MultiLineString
            return coordinates.flat().map(coord => this.geoJSONPositionToCartesian3(coord));
        } else {
            // LineString
            return coordinates.map(coord => this.geoJSONPositionToCartesian3(coord));
        }
    }

    /**
     * Convert GeoJSON coordinates to hierarchy
     * @param {Array} coordinates - Coordinates array
     * @returns {Cesium.PolygonHierarchy} Polygon hierarchy
     */
    geoJSONCoordinatesToHierarchy(coordinates) {
        // Handle MultiPolygon
        if (coordinates[0][0][0] instanceof Array) {
            // MultiPolygon - use first polygon
            coordinates = coordinates[0];
        }

        // Handle Polygon with holes
        const exterior = coordinates[0].map(coord => this.geoJSONPositionToCartesian3(coord));
        const holes = coordinates.slice(1).map(hole => 
            hole.map(coord => this.geoJSONPositionToCartesian3(coord))
        );

        return new Cesium.PolygonHierarchy(exterior, holes);
    }

    /**
     * Show layer
     * @param {string} id - Layer ID
     */
    showLayer(id) {
        const layer = this.layers.get(id);
        if (!layer) return;

        layer.visible = true;
        this.visibleLayers.add(id);

        // Show entities
        layer.entities.forEach(entity => {
            entity.show = true;
        });

        // Show data source
        if (layer.dataSource) {
            layer.dataSource.show = true;
        }
    }

    /**
     * Hide layer
     * @param {string} id - Layer ID
     */
    hideLayer(id) {
        const layer = this.layers.get(id);
        if (!layer) return;

        layer.visible = false;
        this.visibleLayers.delete(id);

        // Hide entities
        layer.entities.forEach(entity => {
            entity.show = false;
        });

        // Hide data source
        if (layer.dataSource) {
            layer.dataSource.show = false;
        }
    }

    /**
     * Remove layer
     * @param {string} id - Layer ID
     */
    removeLayer(id) {
        const layer = this.layers.get(id);
        if (!layer) return;

        // Remove entities
        layer.entities.forEach(entity => {
            this.viewer.entities.remove(entity);
        });

        // Remove data source
        if (layer.dataSource) {
            this.viewer.dataSources.remove(layer.dataSource);
        }

        // Remove from categories
        const category = this.layerCategories[layer.category];
        const index = category.indexOf(layer);
        if (index > -1) {
            category.splice(index, 1);
        }

        // Remove from layers map
        this.layers.delete(id);
        this.visibleLayers.delete(id);
    }

    /**
     * Get all layers
     * @returns {Array} Array of layer objects
     */
    getAllLayers() {
        return Array.from(this.layers.values());
    }

    /**
     * Get layers by category
     * @param {string} category - Category name
     * @returns {Array} Array of layers
     */
    getLayersByCategory(category) {
        return this.layerCategories[category] || [];
    }

    /**
     * Update layer style
     * @param {string} id - Layer ID
     * @param {Object} style - New style
     */
    updateLayerStyle(id, style) {
        const layer = this.layers.get(id);
        if (!layer) return;

        layer.style = { ...layer.style, ...style };

        // Update entities
        layer.entities.forEach(entity => {
            if (entity.polygon) {
                entity.polygon.material = style.color || layer.style.color;
                entity.polygon.outlineColor = style.outlineColor || layer.style.outlineColor;
            } else if (entity.polyline) {
                entity.polyline.material = style.outlineColor || layer.style.outlineColor;
            } else if (entity.point) {
                entity.point.color = style.color || layer.style.color;
            }
        });
    }

    /**
     * Upload and add user-defined layer from file
     * @param {File} file - File to upload (GeoJSON, KML, etc.)
     * @param {Object} options - Layer options
     * @returns {Promise<Object>} Layer object
     */
    async uploadLayer(file, options = {}) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    const id = options.id || `user_${Date.now()}`;
                    const layer = this.addUserDefinedLayer(id, data, {
                        name: options.name || file.name,
                        description: options.description || '',
                        ...options
                    });
                    resolve(layer);
                } catch (error) {
                    reject(new Error(`Failed to parse file: ${error.message}`));
                }
            };
            
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    /**
     * Export layer to GeoJSON
     * @param {string} id - Layer ID
     * @returns {Object} GeoJSON FeatureCollection
     */
    exportLayerToGeoJSON(id) {
        const layer = this.layers.get(id);
        if (!layer) return null;

        const features = layer.entities.map(entity => {
            const feature = {
                type: 'Feature',
                properties: entity.properties || {}
            };

            if (entity.polygon) {
                const hierarchy = entity.polygon.hierarchy.getValue();
                feature.geometry = {
                    type: 'Polygon',
                    coordinates: [this.cartesian3ArrayToGeoJSON(hierarchy.positions)]
                };
            } else if (entity.polyline) {
                const positions = entity.polyline.positions.getValue();
                feature.geometry = {
                    type: 'LineString',
                    coordinates: this.cartesian3ArrayToGeoJSON(positions)
                };
            } else if (entity.position) {
                const position = entity.position.getValue();
                const cartographic = Cesium.Cartographic.fromCartesian(position);
                feature.geometry = {
                    type: 'Point',
                    coordinates: [
                        Cesium.Math.toDegrees(cartographic.longitude),
                        Cesium.Math.toDegrees(cartographic.latitude),
                        cartographic.height || 0
                    ]
                };
            }

            return feature;
        });

        return {
            type: 'FeatureCollection',
            features: features
        };
    }

    /**
     * Convert Cartesian3 array to GeoJSON coordinates
     * @param {Array} positions - Array of Cartesian3 positions
     * @returns {Array} GeoJSON coordinates array
     */
    cartesian3ArrayToGeoJSON(positions) {
        return positions.map(pos => {
            const cartographic = Cesium.Cartographic.fromCartesian(pos);
            return [
                Cesium.Math.toDegrees(cartographic.longitude),
                Cesium.Math.toDegrees(cartographic.latitude),
                cartographic.height || 0
            ];
        });
    }

    /**
     * Filter layers by metadata
     * @param {Object} filter - Filter criteria
     * @returns {Array} Filtered layers
     */
    filterLayers(filter) {
        return Array.from(this.layers.values()).filter(layer => {
            if (filter.category && layer.category !== filter.category) return false;
            if (filter.visible !== undefined && layer.visible !== filter.visible) return false;
            if (filter.name && !layer.name.toLowerCase().includes(filter.name.toLowerCase())) return false;
            if (filter.metadata) {
                for (const key in filter.metadata) {
                    if (layer.metadata[key] !== filter.metadata[key]) return false;
                }
            }
            return true;
        });
    }

    /**
     * Get layer statistics
     * @param {string} id - Layer ID
     * @returns {Object} Layer statistics
     */
    getLayerStatistics(id) {
        const layer = this.layers.get(id);
        if (!layer) return null;

        return {
            id: layer.id,
            name: layer.name,
            category: layer.category,
            entityCount: layer.entities.length,
            visible: layer.visible,
            hasDataSource: !!layer.dataSource,
            metadata: layer.metadata
        };
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.DataLayerIntegration = DataLayerIntegration;
}
