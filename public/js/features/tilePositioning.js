/**
 * TilePositioning
 * Tileset positioning and transformation
 */

class TilePositioning {
    constructor() {
        this.tilesetViewer = null;
        this.init();
    }

    /**
     * Initialize with dependencies
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
    }

    /**
     * Rotate tileset
     */
    rotateTileset(id, direction, degrees) {
        if (!this.tilesetViewer) return false;

        const tilesetData = this.tilesetViewer.tilesets.get(id);
        if (!tilesetData) return false;

        const tileset = tilesetData.tileset;
        const matrix = tileset.root.transform;

        // Create rotation matrix
        const rotation = Cesium.Matrix3.fromRotationZ(
            Cesium.Math.toRadians(direction === 'left' ? -degrees : degrees)
        );

        // Apply rotation
        const newMatrix = Cesium.Matrix4.multiplyByMatrix3(
            matrix,
            rotation,
            new Cesium.Matrix4()
        );

        tileset.root.transform = newMatrix;
        return true;
    }

    /**
     * Tilt tileset
     */
    tiltTileset(id, direction, degrees) {
        if (!this.tilesetViewer) return false;

        const tilesetData = this.tilesetViewer.tilesets.get(id);
        if (!tilesetData) return false;

        const tileset = tilesetData.tileset;
        const matrix = tileset.root.transform;

        // Create tilt rotation (around X axis)
        const rotation = Cesium.Matrix3.fromRotationX(
            Cesium.Math.toRadians(direction === 'up' ? degrees : -degrees)
        );

        // Apply rotation
        const newMatrix = Cesium.Matrix4.multiplyByMatrix3(
            matrix,
            rotation,
            new Cesium.Matrix4()
        );

        tileset.root.transform = newMatrix;
        return true;
    }

    /**
     * Move tileset
     */
    moveTileset(id, direction, distance) {
        if (!this.tilesetViewer) return false;

        const tilesetData = this.tilesetViewer.tilesets.get(id);
        if (!tilesetData) return false;

        const tileset = tilesetData.tileset;
        const matrix = tileset.root.transform;

        // Get current translation
        const translation = Cesium.Matrix4.getTranslation(matrix, new Cesium.Cartesian3());

        // Calculate new translation based on direction
        const offset = this.getDirectionOffset(direction, distance);
        const newTranslation = Cesium.Cartesian3.add(
            translation,
            offset,
            new Cesium.Cartesian3()
        );

        // Create new matrix with updated translation
        const newMatrix = Cesium.Matrix4.fromTranslation(newTranslation);
        tileset.root.transform = newMatrix;

        return true;
    }

    /**
     * Get direction offset vector
     */
    getDirectionOffset(direction, distance) {
        const directions = {
            north: new Cesium.Cartesian3(0, distance, 0),
            south: new Cesium.Cartesian3(0, -distance, 0),
            east: new Cesium.Cartesian3(distance, 0, 0),
            west: new Cesium.Cartesian3(-distance, 0, 0),
            up: new Cesium.Cartesian3(0, 0, distance),
            down: new Cesium.Cartesian3(0, 0, -distance)
        };

        return directions[direction] || new Cesium.Cartesian3(0, 0, 0);
    }

    /**
     * Rotate all tilesets
     */
    rotateAllTilesets(direction, degrees) {
        if (!this.tilesetViewer) return false;

        const tilesets = this.tilesetViewer.getAllTilesets();
        tilesets.forEach(tileset => {
            this.rotateTileset(tileset.id, direction, degrees);
        });

        return true;
    }

    /**
     * Tilt all tilesets
     */
    tiltAllTilesets(direction, degrees) {
        if (!this.tilesetViewer) return false;

        const tilesets = this.tilesetViewer.getAllTilesets();
        tilesets.forEach(tileset => {
            this.tiltTileset(tileset.id, direction, degrees);
        });

        return true;
    }

    /**
     * Move all tilesets
     */
    moveAllTilesets(direction, distance) {
        if (!this.tilesetViewer) return false;

        const tilesets = this.tilesetViewer.getAllTilesets();
        tilesets.forEach(tileset => {
            this.moveTileset(tileset.id, direction, distance);
        });

        return true;
    }

    /**
     * Reset tileset position
     */
    resetTilesetPosition(id) {
        if (!this.tilesetViewer) return false;

        const tilesetData = this.tilesetViewer.tilesets.get(id);
        if (!tilesetData) return false;

        const tileset = tilesetData.tileset;
        tileset.root.transform = Cesium.Matrix4.IDENTITY;
        return true;
    }
}

// Export singleton instance
window.tilePositioning = new TilePositioning();
