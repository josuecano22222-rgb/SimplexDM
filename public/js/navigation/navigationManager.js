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
        if (!this.tilesetViewer || !this.tilesetViewer.viewer || !position) return;

        const camera = this.tilesetViewer.viewer.camera;
        this._isRestoringHistory = true;
        try {
            camera.setView({
                destination: position.position,
                orientation: {
                    heading: position.heading,
                    pitch: position.pitch,
                    roll: position.roll
                }
            });
            this.tilesetViewer.viewer.scene?.requestRender?.();
        } finally {
            setTimeout(() => {
                this._isRestoringHistory = false;
            }, 80);
        }
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

    /** Call after DOM/viewer is ready so default active state, camera history, shortcuts, and drag-and-drop are active */
    initBrowseToolbar() {
        this.tilesetViewer = this.tilesetViewer || window.tilesetViewer;
        this._syncBrowseUi();
        this.bindCameraHistory();
        this.bindGlobalShortcuts();
        this.bindViewportDragAndDrop();
    }

    /**
     * Record camera positions automatically on `viewer.camera.moveEnd` when `autoSave` is enabled.
     */
    bindCameraHistory() {
        if (this._historyBound) return;
        const viewer = (this.tilesetViewer || window.tilesetViewer)?.viewer;
        if (!viewer?.camera?.moveEnd) return;
        this._historyBound = true;
        this.tilesetViewer = window.tilesetViewer;

        // Capture initial state
        if (this.autoSave && this.history.length === 0) {
            this.saveCameraPosition();
        }

        this._moveEndListener = () => {
            if (!this.autoSave || this._isRestoringHistory) return;
            const prev = this.history[this.historyIndex];
            if (prev && typeof Cesium !== 'undefined' && Cesium.Cartesian3?.distance) {
                const dist = Cesium.Cartesian3.distance(prev.position, viewer.camera.position);
                const dHead = Math.abs((prev.heading || 0) - (viewer.camera.heading || 0));
                const dPitch = Math.abs((prev.pitch || 0) - (viewer.camera.pitch || 0));
                if (dist < 0.5 && dHead < 0.005 && dPitch < 0.005) return;
            }
            this.saveCameraPosition();
        };
        viewer.camera.moveEnd.addEventListener(this._moveEndListener);
    }

    /**
     * Check whether keyboard focus is inside an editable form control or modal input.
     */
    static isEditableTarget(el) {
        if (!el) return false;
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return true;
        if (el.isContentEditable) return true;
        return Boolean(el.closest && el.closest('[contenteditable="true"]'));
    }

    /**
     * Bind standard 3D camera keyboard controls (`W/A/S/D`, `Q/E`, `R`, `F`, `Space`, `Escape`).
     */
    bindGlobalShortcuts() {
        if (this._shortcutsBound || typeof window === 'undefined') return;
        this._shortcutsBound = true;

        this._keydownHandler = (e) => {
            if (e.defaultPrevented) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (NavigationManager.isEditableTarget(e.target) || NavigationManager.isEditableTarget(document.activeElement)) {
                return;
            }

            // Universal Ctrl/Cmd+K focuses geographic search
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
                e.preventDefault();
                window.searchManager?.show?.();
                return;
            }

            // `?` toggles Navigation Help overlay
            if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                window.navigationHelpUI?.toggle?.();
                return;
            }

            // Camera history undo/redo: Alt+ArrowLeft / Alt+ArrowRight or [ / ]
            if (
                (e.altKey && e.code === 'ArrowLeft') ||
                (!e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'BracketLeft')
            ) {
                e.preventDefault();
                window.cameraHistory?.undo?.();
                return;
            }
            if (
                (e.altKey && e.code === 'ArrowRight') ||
                (!e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'BracketRight')
            ) {
                e.preventDefault();
                window.cameraHistory?.redo?.();
                return;
            }

            // Escape cancels active tool/measurement/cut/flight/street-view/orbit anywhere on the map
            if (e.code === 'Escape' || e.key === 'Escape') {
                if (window.streetViewManager?.isActive) {
                    window.streetViewManager.exitStreetView();
                    return;
                }
                if (window.supermanFlightModeManager?.isActive) {
                    window.supermanFlightModeManager.stop?.();
                    return;
                }
                if (window.flightModeManager?.isActive || window.flightModeManager?.isFlying) {
                    window.flightModeManager.stopFlight?.();
                    window.flightModeManager.hide?.();
                    return;
                }
                if (window.coordinateManager?.isFlyAroundActive) {
                    window.coordinateManager.stopFlyAround?.();
                    return;
                }
                window.enhancedMeasurementManager?.stopMeasurement?.();
                window.cutByPolygonManager?.cancelCutting?.();
                window.lineOfSightManager?.stopPicking?.();
                window.editingManager?.setTool?.('select');
                window.app?.clearToolStatus?.();
                return;
            }

            // Defer WASD/QE while Street View or Flight / Superman Flight Mode owns keyboard movement
            const activeFlight =
                window.supermanFlightModeManager?.isActive ||
                window.flightModeManager?.isFlying ||
                window.flightModeManager?.isActive;
            if (window.streetViewManager?.isActive || activeFlight) {
                if (e.code === 'Space' && activeFlight) {
                    e.preventDefault();
                    if (window.supermanFlightModeManager?.isActive) {
                        window.supermanFlightModeManager.stop?.();
                    } else if (typeof window.flightModeManager?.stopFlight === 'function') {
                        window.flightModeManager.stopFlight();
                    } else if (typeof window.flightModeManager?.hide === 'function') {
                        window.flightModeManager.hide();
                    }
                }
                return;
            }

            const viewer = (this.tilesetViewer || window.tilesetViewer)?.viewer;
            if (!viewer?.camera) return;

            const carto = viewer.camera.positionCartographic;
            const altitude = Math.max(10, Number(carto?.height) || 500);
            const moveStep = Math.max(2, Math.min(250000, altitude * 0.06));
            const rotateStep = 0.05; // ~2.9 degrees per press

            switch (e.code) {
                case 'KeyW':
                    e.preventDefault();
                    viewer.camera.moveForward(moveStep);
                    viewer.scene?.requestRender?.();
                    break;
                case 'KeyS':
                    e.preventDefault();
                    viewer.camera.moveBackward(moveStep);
                    viewer.scene?.requestRender?.();
                    break;
                case 'KeyA':
                    e.preventDefault();
                    viewer.camera.moveLeft(moveStep);
                    viewer.scene?.requestRender?.();
                    break;
                case 'KeyD':
                    e.preventDefault();
                    viewer.camera.moveRight(moveStep);
                    viewer.scene?.requestRender?.();
                    break;
                case 'KeyQ':
                    e.preventDefault();
                    viewer.camera.lookLeft(rotateStep);
                    viewer.scene?.requestRender?.();
                    break;
                case 'KeyE':
                    e.preventDefault();
                    viewer.camera.lookRight(rotateStep);
                    viewer.scene?.requestRender?.();
                    break;
                case 'KeyR':
                    e.preventDefault();
                    this.home();
                    break;
                case 'KeyF': {
                    e.preventDefault();
                    const all = (this.tilesetViewer || window.tilesetViewer)?.getAllTilesets?.() || [];
                    if (all.length > 0) {
                        (this.tilesetViewer || window.tilesetViewer).fitToView(all[0].id);
                    } else {
                        this.home();
                    }
                    break;
                }
                case 'Space': {
                    // Play/pause active shade animation, orbit fly-around, flight mode, or toggle fly-around
                    e.preventDefault();
                    if (window.shadeAnalysisManager?.isActive) {
                        if (window.shadeAnalysisManager.isAnimating) {
                            window.shadeAnalysisManager.pauseAnimation();
                        } else {
                            window.shadeAnalysisManager.playAnimation();
                        }
                    } else if (window.supermanFlightModeManager?.toggle) {
                        window.supermanFlightModeManager.toggle();
                    } else if (window.flightModeManager?.toggle) {
                        window.flightModeManager.toggle();
                    } else if (window.coordinateManager?.toggleFlyAround) {
                        window.coordinateManager.toggleFlyAround();
                    }
                    break;
                }
                default:
                    break;
            }
        };

        window.addEventListener('keydown', this._keydownHandler);
    }

    /**
     * Allow dragging & dropping 3D tilesets (`tileset.json`), 3D models (`.glb`/`.gltf`),
     * GIS vector/raster layers (`.geojson`, `.kml`, `.kmz`, `.czml`, `.csv`, `.gpkg`, `.shp`, `.tif`),
     * and offline label region packs (`.rlp`) directly onto the 3D viewport.
     */
    bindViewportDragAndDrop() {
        if (this._dndBound || typeof document === 'undefined') return;
        const target = document.getElementById('cesiumContainer') || document.body;
        if (!target) return;
        this._dndBound = true;

        target.addEventListener('dragover', (e) => {
            if (!e.dataTransfer?.types?.includes?.('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        target.addEventListener('drop', async (e) => {
            const files = Array.from(e.dataTransfer?.files || []);
            if (files.length === 0) return;
            e.preventDefault();
            e.stopPropagation();

            for (const file of files) {
                await this.handleDroppedFile(file);
            }
        });
    }

    async handleDroppedFile(file) {
        if (!file) return false;
        const name = String(file.name || '').toLowerCase();
        const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
        const nativePath =
            (window.electronAPI && typeof window.electronAPI.getPathForFile === 'function'
                ? window.electronAPI.getPathForFile(file)
                : '') ||
            file.path ||
            '';

        try {
            // 1. Offline label region pack (.rlp)
            if (ext === '.rlp') {
                if (nativePath && window.labelManagerUI?.importRegionFile) {
                    await window.labelManagerUI.importRegionFile(nativePath);
                    window.notification?.success?.(`Imported label pack: ${file.name}`);
                    return true;
                }
                if (nativePath && window.electronAPI?.gis?.labels?.importRegion) {
                    await window.electronAPI.gis.labels.importRegion(nativePath);
                    window.labelManager?.refresh?.();
                    window.notification?.success?.(`Imported label pack: ${file.name}`);
                    return true;
                }
            }

            // 2. 3D Tileset JSON vs GeoJSON
            if (ext === '.json') {
                const text = await file.text();
                const parsed = JSON.parse(text);
                if (parsed && (parsed.asset || parsed.root)) {
                    if (nativePath && window.displayControl?.loadTileset) {
                        await window.displayControl.loadTileset(nativePath, { fitToView: true });
                        window.notification?.success?.(`Loaded tileset: ${file.name}`);
                        return true;
                    }
                    if (window.modelAndLayerUploadManager?.loadLayerFile) {
                        await window.modelAndLayerUploadManager.loadLayerFile(file);
                        return true;
                    }
                } else if (parsed && (parsed.type === 'FeatureCollection' || parsed.type === 'Feature')) {
                    if (window.modelAndLayerUploadManager?.loadLayerFile) {
                        await window.modelAndLayerUploadManager.loadLayerFile(file);
                        return true;
                    }
                }
            }

            // 3. 3D models (.glb / .gltf)
            if (ext === '.glb' || ext === '.gltf') {
                if (window.modelAndLayerUploadManager?.loadModelFile) {
                    await window.modelAndLayerUploadManager.loadModelFile(file);
                    return true;
                }
            }

            // 4. Vector / tabular GIS layers (.geojson, .kml, .kmz, .czml, .csv)
            if (['.geojson', '.kml', '.kmz', '.czml', '.csv'].includes(ext)) {
                if (window.modelAndLayerUploadManager?.loadLayerFile) {
                    await window.modelAndLayerUploadManager.loadLayerFile(file);
                    return true;
                }
            }

            // 5. Desktop GIS files (.gpkg, .shp, .zip, .tif, .tiff)
            if (['.gpkg', '.shp', '.zip', '.tif', '.tiff'].includes(ext) && nativePath && window.electronAPI?.gis) {
                if (ext === '.tif' || ext === '.tiff') {
                    const meta = await window.electronAPI.gis.raster?.open?.(nativePath);
                    window.notification?.success?.(`Opened raster: ${file.name} (${meta?.width || '?'}×${meta?.height || '?'})`);
                    return true;
                }
                const proj = window.gisProjectManager?.currentProjectPath;
                if (proj && window.electronAPI.gis.io?.importFile) {
                    await window.electronAPI.gis.io.importFile(proj, { filePath: nativePath });
                    window.notification?.success?.(`Imported layer: ${file.name}`);
                    return true;
                }
            }
        } catch (err) {
            console.error('Drop import failed:', err);
            window.notification?.error?.(`Failed to load ${file.name}: ${err.message}`);
        }
        return false;
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
