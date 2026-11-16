/**
 * Feature Picking Utilities
 * Utility functions for picking 3D positions from tileset features and geometric shapes
 */

class FeaturePickingUtils {
    /**
     * Pick 3D position from scene, prioritizing tileset features
     * @param {Cesium.Viewer} viewer - Cesium viewer instance
     * @param {Cesium.Cartesian2} screenPosition - Screen position (pixel coordinates)
     * @returns {Cesium.Cartesian3|null} - 3D position or null if nothing picked
     */
    static pick3DPosition(viewer, screenPosition) {
        if (!viewer || !screenPosition) return null;

        // First, try to pick from 3D tileset features (buildings, objects, etc.)
        const pickedObject = viewer.scene.pick(screenPosition);
        
        if (Cesium.defined(pickedObject)) {
            if (pickedObject instanceof Cesium.Cesium3DTileFeature) {
                const position = viewer.scene.pickPosition(screenPosition);
                if (Cesium.defined(position)) {
                    return position;
                }
            }

            // Check if it's a 3D tileset feature
            if (pickedObject.primitive && pickedObject.primitive instanceof Cesium.Cesium3DTileset) {
                // Use pickPosition to get the actual 3D intersection point on the geometry
                const position = viewer.scene.pickPosition(screenPosition);
                if (Cesium.defined(position)) {
                    return position;
                }
            }
            
            // Check if it's a Cesium3DTileFeature
            if (pickedObject.content && pickedObject.content instanceof Cesium.Cesium3DTileContent) {
                const position = viewer.scene.pickPosition(screenPosition);
                if (Cesium.defined(position)) {
                    return position;
                }
            }
            
            // Check if picked object has a position property
            if (pickedObject.id) {
                if (pickedObject.id.position) {
                    const pos = pickedObject.id.position.getValue ? 
                               pickedObject.id.position.getValue(viewer.clock.currentTime) : 
                               pickedObject.id.position;
                    if (Cesium.defined(pos)) {
                        return pos;
                    }
                }
                
                // Try to get position from feature properties
                if (pickedObject.id instanceof Cesium.Cesium3DTileFeature) {
                    const position = viewer.scene.pickPosition(screenPosition);
                    if (Cesium.defined(position)) {
                        return position;
                    }
                }
            }
        }
        
        // Try pickPosition directly (works for 3D tileset geometry)
        const pickPosition = viewer.scene.pickPosition(screenPosition);
        if (Cesium.defined(pickPosition)) {
            return pickPosition;
        }
        
        // Fallback to ellipsoid pick (terrain/ground)
        const ellipsoidPosition = viewer.camera.pickEllipsoid(screenPosition, viewer.scene.globe.ellipsoid);
        if (Cesium.defined(ellipsoidPosition)) {
            return ellipsoidPosition;
        }
        
        return null;
    }

    /**
     * Pick feature from scene
     * @param {Cesium.Viewer} viewer - Cesium viewer instance
     * @param {Cesium.Cartesian2} screenPosition - Screen position (pixel coordinates)
     * @returns {Object|null} - Picked object with feature and position, or null
     */
    static pickFeature(viewer, screenPosition) {
        if (!viewer || !screenPosition) return null;

        const pickedObject = viewer.scene.pick(screenPosition);
        if (!Cesium.defined(pickedObject)) return null;

        const position = this.pick3DPosition(viewer, screenPosition);

        let feature = null;
        if (pickedObject instanceof Cesium.Cesium3DTileFeature) {
            feature = pickedObject;
        } else if (pickedObject.id instanceof Cesium.Cesium3DTileFeature) {
            feature = pickedObject.id;
        }

        return {
            pickedObject: pickedObject,
            position: position,
            feature: feature,
            content: pickedObject.content || null
        };
    }

    /**
     * Get feature properties from picked object
     * @param {Object} pickedObject - Picked object from scene
     * @returns {Object} - Feature properties
     */
    static getFeatureProperties(pickedObject) {
        if (!pickedObject) return {};

        let feature = null;
        if (pickedObject instanceof Cesium.Cesium3DTileFeature) {
            feature = pickedObject;
        } else if (pickedObject.id instanceof Cesium.Cesium3DTileFeature) {
            feature = pickedObject.id;
        }
        if (!feature) return {};

        const properties = {};
        const ids =
            typeof feature.getPropertyIds === 'function'
                ? feature.getPropertyIds()
                : typeof feature.getPropertyNames === 'function'
                  ? feature.getPropertyNames()
                  : [];
        ids.forEach((name) => {
            try {
                const value = feature.getProperty(name);
                properties[name] = value?.getValue ? value.getValue() : value;
            } catch (e) {
                // Property might not be available
            }
        });

        return properties;
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.featurePickingUtils = FeaturePickingUtils;
}
