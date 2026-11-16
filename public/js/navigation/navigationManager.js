/**
 * NavigationManager
 * Camera navigation and history
 */

class NavigationManager {
    constructor() {
        this.tilesetViewer = null;
        this.history = [];
        this.historyIndex = -1;
        this.maxHistorySize = 50;
        this.autoSave = true;
        /** @type {'pan'|'explore'} explore = default Cesium 3D navigation; pan = GIS-style hand pan */
        this._browseMode = 'explore';
        /** Snapshot of ScreenSpaceCameraController before switching to pan */
        this._cameraControlSnapshot = null;
        this.init();
    }

    /**
     * Initialize with dependencies
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        
        this.applyNavigationFeatureConfig();
    }

    /** Re-read features.navigation after Control Center / runtime config updates. */
    applyNavigationFeatureConfig() {
        if (!window.jsonConfigManager) return;
        const config = window.jsonConfigManager.getFeatureConfig('navigation');
        if (!config || typeof config !== 'object') return;
        const raw = config.historySize;
        const n = typeof raw === 'number' && !Number.isNaN(raw) ? raw : 50;
        this.maxHistorySize = Math.max(1, Math.min(500, n));
        this.autoSave = config.autoSave !== false;
        if (this.history.length > this.maxHistorySize) {
            this.history = this.history.slice(-this.maxHistorySize);
            this.historyIndex = Math.min(this.historyIndex, this.history.length - 1);
        }
    }

    /**
     * Save current camera position
     */
    saveCameraPosition() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const camera = this.tilesetViewer.viewer.camera;
        const position = {
            position: Cesium.Cartesian3.clone(camera.position),
            heading: camera.heading,
            pitch: camera.pitch,
            roll: camera.roll,
            timestamp: Date.now()
        };

        // Remove any history after current index
        this.history = this.history.slice(0, this.historyIndex + 1);
        
        // Add new position
        this.history.push(position);
        this.historyIndex = this.history.length - 1;

        // Limit history size
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
            this.historyIndex--;
        }
    }

    /**
     * Navigate back
     */
    navigateBack() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.restoreCameraPosition(this.history[this.historyIndex]);
            return true;
        }
        return false;
    }

    /**
     * Navigate forward
     */
    navigateForward() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.restoreCameraPosition(this.history[this.historyIndex]);
            return true;
        }
        return false;
    }

    /**
     * Restore camera position
     */
    restoreCameraPosition(position) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const camera = this.tilesetViewer.viewer.camera;
        camera.setView({
            destination: position.position,
            orientation: {
                heading: position.heading,
                pitch: position.pitch,
                roll: position.roll
            }
        });
    }

    /**
     * Home view - fit all tilesets
     */
    async home() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const tilesets = this.tilesetViewer.getAllTilesets();
        if (tilesets.length > 0) {
            // Fit to first tileset
            await this.tilesetViewer.fitToView(tilesets[0].id);
        } else {
            // Default view
            this.tilesetViewer.viewer.camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(0, 0, 20000000)
            });
        }
    }

    /**
     * Point to north
     */
    pointToNorth() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const camera = this.tilesetViewer.viewer.camera;
        camera.setView({
            orientation: {
                heading: 0,
                pitch: camera.pitch,
                roll: 0
            }
        });
    }

    /**
     * Set camera heading (degrees clockwise from north, 0–360). Preserves pitch and roll.
     */
    setHeadingDegrees(deg) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;
        const camera = this.tilesetViewer.viewer.camera;
        const d = ((Number(deg) % 360) + 360) % 360;
        camera.setView({
            orientation: {
                heading: Cesium.Math.toRadians(d),
                pitch: camera.pitch,
                roll: camera.roll
            }
        });
    }

    /**
     * Top view
     */
    topView() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const camera = this.tilesetViewer.viewer.camera;
        const position = camera.position;
        const cartographic = Cesium.Cartographic.fromCartesian(position);
        
        camera.setView({
            destination: Cesium.Cartesian3.fromRadians(
                cartographic.longitude,
                cartographic.latitude,
                cartographic.height
            ),
            orientation: {
                heading: 0,
                pitch: -Cesium.Math.PI_OVER_TWO,
                roll: 0
            }
        });
    }

    /**
     * Fly around (orbit) - continuous orbiting around center of screen
     */
    flyAround() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        // Use coordinate manager for fly around if available
        if (window.coordinateManager) {
            return window.coordinateManager.toggleFlyAround();
        }

        // Fallback implementation
        const camera = this.tilesetViewer.viewer.camera;
        const position = camera.position;
        const cartographic = Cesium.Cartographic.fromCartesian(position);
        
        // Create circular path
        const radius = cartographic.height;
        const center = Cesium.Cartesian3.fromRadians(
            cartographic.longitude,
            cartographic.latitude,
            0
        );

        // Animate camera in circle
        let angle = 0;
        const animate = () => {
            angle += 0.01;
            const x = center.x + radius * Math.cos(angle);
            const y = center.y + radius * Math.sin(angle);
            const z = center.z + radius * 0.5;
            
            camera.setView({
                destination: new Cesium.Cartesian3(x, y, z),
                orientation: {
                    heading: angle + Cesium.Math.PI_OVER_TWO,
                    pitch: -Cesium.Math.PI_OVER_FOUR,
                    roll: 0
                }
            });

            if (angle < Math.PI * 2) {
                requestAnimationFrame(animate);
            }
        };
        animate();
    }

    _getCameraController() {
        this.tilesetViewer = window.tilesetViewer;
        return this.tilesetViewer?.viewer?.scene?.screenSpaceCameraController;
    }

    _cloneEventTypes(et) {
        if (et == null) return [];
        return Array.isArray(et) ? et.slice() : [et];
    }

    _ensureCameraControllerSnapshot() {
        const c = this._getCameraController();
        if (!c || this._cameraControlSnapshot) return;
        this._cameraControlSnapshot = {
            rotateEventTypes: this._cloneEventTypes(c.rotateEventTypes),
            translateEventTypes: this._cloneEventTypes(c.translateEventTypes),
            tiltEventTypes: this._cloneEventTypes(c.tiltEventTypes),
            lookEventTypes: this._cloneEventTypes(c.lookEventTypes),
            enableRotate: c.enableRotate,
            enableTranslate: c.enableTranslate,
            enableZoom: c.enableZoom,
            enableTilt: c.enableTilt,
            enableLook: c.enableLook
        };
    }

    _applyCameraSnapshot(snapshot) {
        const c = this._getCameraController();
        if (!c || !snapshot) return;
        c.rotateEventTypes = this._cloneEventTypes(snapshot.rotateEventTypes);
        c.translateEventTypes = this._cloneEventTypes(snapshot.translateEventTypes);
        c.tiltEventTypes = this._cloneEventTypes(snapshot.tiltEventTypes);
        c.lookEventTypes = this._cloneEventTypes(snapshot.lookEventTypes);
        c.enableRotate = snapshot.enableRotate;
        c.enableTranslate = snapshot.enableTranslate;
        c.enableZoom = snapshot.enableZoom;
        c.enableTilt = snapshot.enableTilt;
        c.enableLook = snapshot.enableLook;
    }

    /**
     * GIS-style pan: left-drag translates the view (no rotate on primary drag).
     */
    setBrowseModePan() {
        this._ensureCameraControllerSnapshot();
        const c = this._getCameraController();
        if (!c) return;
        c.rotateEventTypes = [];
        c.tiltEventTypes = [];
        c.lookEventTypes = [];
        c.translateEventTypes = [Cesium.CameraEventType.LEFT_DRAG];
        c.enableRotate = false;
        c.enableTilt = false;
        c.enableLook = false;
        c.enableTranslate = true;
        if (c.enableZoom !== false) c.enableZoom = true;
        this._browseMode = 'pan';
        this._syncBrowseUi();
    }

    /**
     * Default Cesium 3D browse (rotate with left drag, pan with middle/right / gestures).
     */
    setBrowseModeExplore() {
        this._ensureCameraControllerSnapshot();
        if (this._cameraControlSnapshot) {
            this._applyCameraSnapshot(this._cameraControlSnapshot);
        }
        this._browseMode = 'explore';
        this._syncBrowseUi();
    }

    _syncBrowseUi() {
        const panBtn = document.getElementById('toolbarPan');
        const browseBtn = document.getElementById('toolbarBrowse');
        const canvas = window.tilesetViewer?.viewer?.canvas;
        if (panBtn) panBtn.classList.toggle('active', this._browseMode === 'pan');
        if (browseBtn) browseBtn.classList.toggle('active', this._browseMode === 'explore');
        if (canvas) {
            canvas.style.cursor = this._browseMode === 'pan' ? 'grab' : '';
        }
    }

    /** Call after DOM is ready so default active state matches explore mode */
    initBrowseToolbar() {
        this._syncBrowseUi();
    }
}

// Export singleton instance
window.navigationManager = new NavigationManager();

window.addEventListener('jsonConfigUpdated', () => {
    const nm = window.navigationManager;
    if (nm && typeof nm.applyNavigationFeatureConfig === 'function') {
        nm.applyNavigationFeatureConfig();
    }
});
