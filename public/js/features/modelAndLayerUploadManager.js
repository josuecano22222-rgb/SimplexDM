/**
 * ModelAndLayerUploadManager
 * Architectural model and vector layer upload (Meridian Design - Pages 33-44)
 * Features: File/folder selection, model naming, elevation settings, layer management
 */

class ModelAndLayerUploadManager {
    constructor() {
        this.tilesetViewer = null;
        this.modal = null;
        this.activeTab = 'architectural'; // 'architectural' or 'vector'
        this.uploadedModels = [];
        this.uploadedLayers = [];
        /** @type {File|null} */
        this._folderPrimaryModelFile = null;
        this.init();
    }

    /**
     * Initialize model and layer upload manager
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.createUploadModal();
        this.setupEventHandlers();
        this.loadUploadedItems();
    }

    /**
     * Create upload modal
     */
    createUploadModal() {
        // Remove existing if any
        const existing = document.getElementById('modelLayerUploadModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'modelLayerUploadModal';
        modal.className = 'model-layer-upload-modal';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="model-layer-upload-content">
                <div class="model-layer-upload-header">
                    <h2>Upload Models & Layers</h2>
                    <button class="close-btn" id="closeModelLayerUploadBtn">×</button>
                </div>
                <div class="model-layer-upload-body">
                    <div class="upload-tabs">
                        <button class="upload-tab active" data-tab="architectural" id="architecturalTab">
                            <span>🏗️</span> Architectural Model
                        </button>
                        <button class="upload-tab" data-tab="vector" id="vectorTab">
                            <span>📐</span> Vector Layer
                        </button>
                    </div>

                    <div class="upload-tab-content" id="architecturalContent">
                        <div class="upload-icon-container">
                            <div class="upload-icon">⬆️</div>
                        </div>
                        
                        <div class="upload-instructions">
                            <p>Upload 3D architectural models to the system.</p>
                            <p>Supported formats: GLTF, GLB, OBJ, 3DS, FBX</p>
                        </div>

                        <div class="upload-form">
                            <div class="form-group">
                                <label>
                                    <span class="form-icon">📁</span>
                                    Choose File
                                </label>
                                <input type="file" id="architecturalFileInput" 
                                       accept=".gltf,.glb,.obj,.3ds,.fbx" 
                                       style="display: none;">
                                <button class="btn btn-secondary" id="selectArchitecturalFileBtn">
                                    <span>📁</span> Select File
                                </button>
                                <span class="file-name" id="architecturalFileName">No file selected</span>
                            </div>

                            <div class="form-group">
                                <label>
                                    <span class="form-icon">✏️</span>
                                    Model Name
                                </label>
                                <input type="text" id="architecturalModelName" 
                                       class="text-input" 
                                       placeholder="Enter model name">
                            </div>

                            <div class="form-group">
                                <label>
                                    <span class="form-icon">📏</span>
                                    Elevation (meters)
                                </label>
                                <input type="number" id="architecturalElevation" 
                                       class="number-input" 
                                       value="0" 
                                       step="0.1">
                            </div>

                            <div class="form-group">
                                <label>
                                    <span class="form-icon">🔄</span>
                                    Rotation (degrees)
                                </label>
                                <input type="number" id="architecturalRotation" 
                                       class="number-input" 
                                       value="0" 
                                       step="1">
                            </div>

                            <div class="form-actions">
                                <button class="btn btn-primary" id="uploadArchitecturalBtn">
                                    <span>⬆️</span> Upload Model
                                </button>
                            </div>

                            <div class="form-divider">
                                <span>OR</span>
                            </div>

                            <div class="form-group">
                                <label>
                                    <span class="form-icon">📂</span>
                                    Choose Folder
                                </label>
                                <input type="file" id="architecturalFolderInput" webkitdirectory directory multiple style="display: none;">
                                <button type="button" class="btn btn-secondary" id="selectArchitecturalFolderBtn">
                                    <span>📂</span> Select Folder
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="upload-tab-content" id="vectorContent" style="display: none;">
                        <div class="upload-icon-container">
                            <div class="upload-icon">📐</div>
                        </div>
                        
                        <div class="upload-instructions">
                            <p>Upload vector layers (GeoJSON, KML, Shapefile) to overlay on the map.</p>
                            <p>Supported formats: GeoJSON, KML, KMZ, Shapefile (ZIP)</p>
                        </div>

                        <div class="upload-form">
                            <div class="form-group">
                                <label>
                                    <span class="form-icon">📁</span>
                                    Choose File
                                </label>
                                <input type="file" id="vectorFileInput" 
                                       accept=".geojson,.json,.kml,.kmz,.czml,.csv,.gpkg,.zip,.shp" 
                                       style="display: none;">
                                <button class="btn btn-secondary" id="selectVectorFileBtn">
                                    <span>📁</span> Select File
                                </button>
                                <span class="file-name" id="vectorFileName">No file selected</span>
                            </div>

                            <div class="form-group">
                                <label>
                                    <span class="form-icon">✏️</span>
                                    Layer Name
                                </label>
                                <input type="text" id="vectorLayerName" 
                                       class="text-input" 
                                       placeholder="Enter layer name">
                            </div>

                            <div class="form-group">
                                <label>
                                    <span class="form-icon">🎨</span>
                                    Style
                                </label>
                                <select id="vectorStyleSelect" class="select-input">
                                    <option value="default">Default</option>
                                    <option value="outline">Outline Only</option>
                                    <option value="filled">Filled</option>
                                    <option value="points">Points</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label>
                                    <span class="form-icon">🌈</span>
                                    Color
                                </label>
                                <input type="color" id="vectorColorInput" 
                                       class="color-input" 
                                       value="#00ff00">
                            </div>

                            <div class="form-actions">
                                <button class="btn btn-primary" id="uploadVectorBtn">
                                    <span>⬆️</span> Upload Layer
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="uploaded-items-section">
                        <h3>Uploaded Items</h3>
                        <div class="uploaded-items-list" id="uploadedItemsList">
                            <!-- Items will be dynamically added here -->
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Close button
        document.addEventListener('click', (e) => {
            if (e.target.id === 'closeModelLayerUploadBtn' || (e.target === this.modal && e.target === this.modal)) {
                this.hide();
            }
        });

        // Tab switching
        document.querySelectorAll('.upload-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabName = e.currentTarget.dataset.tab;
                this.switchTab(tabName);
            });
        });

        // Architectural file selection
        document.getElementById('selectArchitecturalFileBtn')?.addEventListener('click', () => {
            document.getElementById('architecturalFileInput')?.click();
        });

        document.getElementById('architecturalFileInput')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                document.getElementById('architecturalFileName').textContent = file.name;
            }
        });

        // Architectural folder selection (directory picker — prefers .glb, then .gltf, then first supported model)
        document.getElementById('selectArchitecturalFolderBtn')?.addEventListener('click', () => {
            document.getElementById('architecturalFolderInput')?.click();
        });

        document.getElementById('architecturalFolderInput')?.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            if (!files.length) {
                this._folderPrimaryModelFile = null;
                return;
            }
            const lower = (n) => n.toLowerCase();
            const pick = (re) => files.find((f) => re.test(lower(f.name)));
            const primary =
                pick(/\.glb$/) ||
                pick(/\.gltf$/) ||
                pick(/\.obj$/) ||
                pick(/\.fbx$/) ||
                pick(/\.3ds$/) ||
                files[0];
            this._folderPrimaryModelFile = primary;
            const nameEl = document.getElementById('architecturalFileName');
            if (nameEl) {
                nameEl.textContent = `${primary.name} (${files.length} files from folder)`;
            }
            const fileInput = document.getElementById('architecturalFileInput');
            if (fileInput) fileInput.value = '';
            if (window.notification) {
                window.notification.success(
                    `Folder loaded — will upload ${primary.name} (GLB preferred when assets are split across files)`
                );
            }
        });

        // Architectural upload
        document.getElementById('uploadArchitecturalBtn')?.addEventListener('click', () => {
            this.uploadArchitecturalModel();
        });

        // Vector file selection
        document.getElementById('selectVectorFileBtn')?.addEventListener('click', () => {
            document.getElementById('vectorFileInput')?.click();
        });

        document.getElementById('vectorFileInput')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                document.getElementById('vectorFileName').textContent = file.name;
            }
        });

        // Vector upload
        document.getElementById('uploadVectorBtn')?.addEventListener('click', () => {
            this.uploadVectorLayer();
        });
    }

    /**
     * Switch tab
     */
    switchTab(tabName) {
        this.activeTab = tabName;

        // Update tab buttons
        document.querySelectorAll('.upload-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.getElementById(`${tabName}Tab`)?.classList.add('active');

        // Update tab content
        document.getElementById('architecturalContent').style.display = 
            tabName === 'architectural' ? 'block' : 'none';
        document.getElementById('vectorContent').style.display = 
            tabName === 'vector' ? 'block' : 'none';
    }

    /**
     * Upload architectural model
     */
    uploadArchitecturalModel() {
        const fileInput = document.getElementById('architecturalFileInput');
        const nameInput = document.getElementById('architecturalModelName');
        const elevationInput = document.getElementById('architecturalElevation');
        const rotationInput = document.getElementById('architecturalRotation');

        const file = fileInput && fileInput.files[0] ? fileInput.files[0] : this._folderPrimaryModelFile;
        if (!file) {
            if (window.notification) {
                window.notification.warning(
                    window.appI18n?.nt ? window.appI18n.nt('selectFileOrFolder') : 'Please select a file or folder'
                );
            }
            return;
        }

        const name = nameInput.value.trim() || file.name.replace(/\.[^/.]+$/, '');
        const elevation = parseFloat(elevationInput.value) || 0;
        const rotation = parseFloat(rotationInput.value) || 0;

        // Create model data
        const modelData = {
            id: Date.now().toString(),
            name: name,
            file: file,
            elevation: elevation,
            rotation: rotation,
            type: 'architectural',
            uploadedAt: new Date().toISOString(),
            visible: true
        };

        // Process and add to viewer
        this.processArchitecturalModel(modelData);

        // Save to localStorage
        this.uploadedModels.push(modelData);
        this.saveUploadedItems();

        // Update UI
        this.updateUploadedItemsList();

        // Reset form
        if (fileInput) fileInput.value = '';
        const folderInput = document.getElementById('architecturalFolderInput');
        if (folderInput) folderInput.value = '';
        this._folderPrimaryModelFile = null;
        nameInput.value = '';
        elevationInput.value = '0';
        rotationInput.value = '0';
        document.getElementById('architecturalFileName').textContent = 'No file selected';

        if (window.notification) {
            window.notification.success(
                window.appI18n?.nt
                    ? window.appI18n.nt('modelUploaded').replace('{name}', name)
                    : `Model "${name}" uploaded successfully`
            );
        }
    }

    /**
     * Process architectural model
     */
    processArchitecturalModel(modelData) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;

        // Read file and create entity
        const reader = new FileReader();
        reader.onload = (e) => {
            const fileContent = e.target.result;

            // For GLTF/GLB files, use Cesium's Model API
            if (modelData.file.name.endsWith('.gltf') || modelData.file.name.endsWith('.glb')) {
                const modelUrl = URL.createObjectURL(modelData.file);
                
                // Get current camera position for placement
                const camera = viewer.camera;
                const center = camera.pickEllipsoid(
                    new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2),
                    viewer.scene.globe.ellipsoid
                );

                if (center) {
                    const cartographic = Cesium.Cartographic.fromCartesian(center);
                    const height = viewer.scene.globe.getHeight(cartographic) || 0;

                    const position = Cesium.Cartesian3.fromRadians(
                        cartographic.longitude,
                        cartographic.latitude,
                        height + modelData.elevation
                    );

                    const heading = Cesium.Math.toRadians(modelData.rotation);

                    viewer.entities.add({
                        id: modelData.id,
                        name: modelData.name,
                        position: position,
                        model: {
                            uri: modelUrl,
                            minimumPixelSize: 128,
                            maximumScale: 20000
                        },
                        orientation: Cesium.Transforms.headingPitchRollQuaternion(
                            position,
                            new Cesium.HeadingPitchRoll(heading, 0, 0)
                        )
                    });
                    modelData.visible = true;
                    this.saveUploadedItems();
                }
            } else {
                // For other formats, show a placeholder
                if (window.notification) {
                    window.notification.info(
                        window.appI18n?.nt ? window.appI18n.nt('gltfHint') : 'GLTF/GLB format recommended. Other formats require conversion.'
                    );
                }
            }
        };

        reader.readAsDataURL(modelData.file);
    }

    /**
     * Upload vector layer
     */
    uploadVectorLayer() {
        const fileInput = document.getElementById('vectorFileInput');
        const nameInput = document.getElementById('vectorLayerName');
        const styleSelect = document.getElementById('vectorStyleSelect');
        const colorInput = document.getElementById('vectorColorInput');

        if (!fileInput || !fileInput.files[0]) {
            if (window.notification) {
                window.notification.warning(
                    window.appI18n?.nt ? window.appI18n.nt('selectFile') : 'Please select a file'
                );
            }
            return;
        }

        const file = fileInput.files[0];
        const name = nameInput.value.trim() || file.name.replace(/\.[^/.]+$/, '');
        const style = styleSelect.value;
        const color = colorInput.value;

        // Create layer data
        const layerData = {
            id: Date.now().toString(),
            name: name,
            file: file,
            style: style,
            color: color,
            type: 'vector',
            uploadedAt: new Date().toISOString(),
            visible: true
        };

        // Process and add to viewer
        this.processVectorLayer(layerData);

        // Save to localStorage
        this.uploadedLayers.push(layerData);
        this.saveUploadedItems();

        // Update UI
        this.updateUploadedItemsList();

        // Reset form
        fileInput.value = '';
        nameInput.value = '';
        styleSelect.value = 'default';
        colorInput.value = '#00ff00';
        document.getElementById('vectorFileName').textContent = 'No file selected';

        if (window.notification) {
            window.notification.success(
                window.appI18n?.nt
                    ? window.appI18n.nt('layerUploaded').replace('{name}', name)
                    : `Layer "${name}" uploaded successfully`
            );
        }
    }

    /**
     * Process vector layer
     */
    processVectorLayer(layerData) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const lowerName = String(layerData.file.name || '').toLowerCase();
                if (lowerName.endsWith('.geojson') || lowerName.endsWith('.json')) {
                    const data = JSON.parse(text);
                    this.addGeoJSONToViewer(data, layerData);
                } else if (lowerName.endsWith('.czml')) {
                    const czml = JSON.parse(text);
                    this.addCzmlToViewer(czml, layerData);
                } else if (lowerName.endsWith('.csv')) {
                    const geojson = this.parseCsvToGeoJSON(text);
                    this.addGeoJSONToViewer(geojson, layerData);
                } else if (lowerName.endsWith('.kml') || lowerName.endsWith('.kmz')) {
                    this.addKmlToViewer(layerData.file, layerData);
                } else if (
                    (lowerName.endsWith('.shp') || lowerName.endsWith('.zip') || lowerName.endsWith('.gpkg')) &&
                    window.electronAPI?.gis?.io?.importFile &&
                    window.gisProjectManager?.currentProjectPath
                ) {
                    const nativePath =
                        window.electronAPI?.getPathForFile?.(layerData.file) || layerData.file.path || '';
                    if (nativePath) {
                        window.electronAPI.gis.io
                            .importFile(window.gisProjectManager.currentProjectPath, {
                                filePath: nativePath,
                                layerName: layerData.name,
                            })
                            .then(() => {
                                window.notification?.success?.(`Imported ${layerData.name}`);
                            })
                            .catch((err) => {
                                console.error('GIS layer import failed:', err);
                                window.notification?.error?.(err.message || 'GIS layer import failed');
                            });
                    }
                } else {
                    window.notification?.info?.(
                        window.appI18n?.nt ? window.appI18n.nt('shpHint') : 'Open a GIS project to import Shapefile/GeoPackage layers'
                    );
                }
            } catch (error) {
                console.error('Error processing vector layer:', error);
                if (window.notification) {
                    window.notification.error(
                        window.appI18n?.nt ? window.appI18n.nt('vectorProcessError') : 'Error processing vector layer'
                    );
                }
            }
        };

        const fname = String(layerData.file?.name || '').toLowerCase();
        if (fname.endsWith('.kmz')) {
            this.addKmlToViewer(layerData.file, layerData);
            return;
        }
        reader.readAsText(layerData.file);
    }

    /**
     * Load KML or KMZ directly into CesiumJS via `Cesium.KmlDataSource`.
     */
    addKmlToViewer(fileOrBlob, layerData) {
        const viewer = this.tilesetViewer?.viewer;
        if (!viewer || typeof Cesium === 'undefined' || !Cesium.KmlDataSource) return;
        Cesium.KmlDataSource.load(fileOrBlob, {
            camera: viewer.scene.camera,
            canvas: viewer.scene.canvas,
            clampToGround: true,
        })
            .then((dataSource) => {
                viewer.dataSources.add(dataSource);
                layerData.dataSource = dataSource;
                dataSource.show = layerData.visible !== false;
                layerData.visible = dataSource.show;
                if (dataSource.entities?.values?.length > 0) {
                    viewer.flyTo(dataSource.entities.values);
                }
                viewer.scene?.requestRender?.();
            })
            .catch((err) => {
                console.error('Error loading KML/KMZ:', err);
                window.notification?.error?.(`Failed to load KML/KMZ: ${err.message}`);
            });
    }

    /**
     * Load CZML directly into CesiumJS via `Cesium.CzmlDataSource`.
     */
    addCzmlToViewer(czml, layerData) {
        const viewer = this.tilesetViewer?.viewer;
        if (!viewer || typeof Cesium === 'undefined' || !Cesium.CzmlDataSource) return;
        Cesium.CzmlDataSource.load(czml)
            .then((dataSource) => {
                viewer.dataSources.add(dataSource);
                layerData.dataSource = dataSource;
                dataSource.show = layerData.visible !== false;
                layerData.visible = dataSource.show;
                if (dataSource.entities?.values?.length > 0) {
                    viewer.flyTo(dataSource.entities.values);
                }
                viewer.scene?.requestRender?.();
            })
            .catch((err) => {
                console.error('Error loading CZML:', err);
                window.notification?.error?.(`Failed to load CZML: ${err.message}`);
            });
    }

    /**
     * Parse CSV with lon/lat (and optional height/elevation) columns into a GeoJSON FeatureCollection.
     */
    parseCsvToGeoJSON(text) {
        const lines = String(text || '')
            .replace(/^\uFEFF/, '')
            .split(/\r?\n/)
            .filter((l) => l.trim().length > 0);
        if (lines.length < 2) return { type: 'FeatureCollection', features: [] };

        const parseRow = (line) => {
            const cells = [];
            let cur = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (inQuotes) {
                    if (ch === '"' && line[i + 1] === '"') {
                        cur += '"';
                        i++;
                    } else if (ch === '"') {
                        inQuotes = false;
                    } else {
                        cur += ch;
                    }
                } else if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    cells.push(cur.trim());
                    cur = '';
                } else {
                    cur += ch;
                }
            }
            cells.push(cur.trim());
            return cells;
        };

        const headers = parseRow(lines[0]);
        const lower = headers.map((h) => h.toLowerCase());
        const lonIdx = lower.findIndex((h) => ['lon', 'lng', 'long', 'longitude', 'x'].includes(h));
        const latIdx = lower.findIndex((h) => ['lat', 'latitude', 'y'].includes(h));
        const zIdx = lower.findIndex((h) => ['z', 'alt', 'altitude', 'elev', 'elevation', 'height'].includes(h));
        if (lonIdx < 0 || latIdx < 0) {
            throw new Error('CSV must include longitude (lon/lng/x) and latitude (lat/y) columns');
        }

        const features = [];
        for (let r = 1; r < lines.length; r++) {
            const vals = parseRow(lines[r]);
            const lon = Number(vals[lonIdx]);
            const lat = Number(vals[latIdx]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
            const z = zIdx >= 0 ? Number(vals[zIdx]) : NaN;
            const coords = Number.isFinite(z) ? [lon, lat, z] : [lon, lat];
            const props = {};
            headers.forEach((h, idx) => {
                if (idx !== lonIdx && idx !== latIdx) props[h] = vals[idx] ?? '';
            });
            features.push({
                type: 'Feature',
                properties: props,
                geometry: { type: 'Point', coordinates: coords },
            });
        }
        return { type: 'FeatureCollection', features };
    }

    /**
     * Programmatic entry point for loading a vector/tabular file (e.g. from viewport drag-and-drop).
     */
    async loadLayerFile(file, options = {}) {
        if (!file) return null;
        const layerData = {
            id: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            type: 'vector',
            name: options.name || file.name.replace(/\.[^.]+$/, ''),
            file,
            style: options.style || 'default',
            color: options.color || '#00e5ff',
            visible: true,
            uploadedAt: new Date().toISOString(),
        };
        this.uploadedLayers.push(layerData);
        this.loadVectorLayerToViewer(layerData);
        this.updateUploadedItemsList();
        window.notification?.success?.(`Loaded layer: ${layerData.name}`);
        return layerData;
    }

    /**
     * Programmatic entry point for loading a `.glb`/`.gltf` model file at the current camera target.
     */
    async loadModelFile(file, options = {}) {
        if (!file) return null;
        const cam = this.tilesetViewer?.getCameraPosition?.() || { lon: 0, lat: 0, height: 0 };
        const modelData = {
            id: `model_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            type: 'architectural',
            name: options.name || file.name.replace(/\.[^.]+$/, ''),
            file,
            position: {
                lon: Number.isFinite(options.lon) ? options.lon : cam.lon,
                lat: Number.isFinite(options.lat) ? options.lat : cam.lat,
                height: Number.isFinite(options.height) ? options.height : 0,
            },
            scale: Number.isFinite(options.scale) ? options.scale : 1,
            rotation: Number.isFinite(options.rotation) ? options.rotation : 0,
            visible: true,
            uploadedAt: new Date().toISOString(),
        };
        this.uploadedModels.push(modelData);
        if (typeof this.loadModelToViewer === 'function') {
            await this.loadModelToViewer(modelData);
        }
        this.updateUploadedItemsList();
        window.notification?.success?.(`Loaded 3D model: ${modelData.name}`);
        return modelData;
    }

    /**
     * Add GeoJSON to viewer
     */
    addGeoJSONToViewer(geojson, layerData) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const color = Cesium.Color.fromCssColorString(layerData.color);

        // Load GeoJSON data source
        Cesium.GeoJsonDataSource.load(geojson, {
            stroke: color,
            fill: layerData.style === 'filled' ? color.withAlpha(0.5) : Cesium.Color.TRANSPARENT,
            strokeWidth: 2
        }).then(dataSource => {
            viewer.dataSources.add(dataSource);
            
            // Store reference
            layerData.dataSource = dataSource;
            if (layerData.visible === false) {
                dataSource.show = false;
            } else {
                layerData.visible = true;
            }
            
            // Fly to bounds
            const entities = dataSource.entities.values;
            if (entities.length > 0) {
                viewer.flyTo(entities);
            }
        }).catch(error => {
            console.error('Error loading GeoJSON:', error);
            if (window.notification) {
                window.notification.error(
                    window.appI18n?.nt ? window.appI18n.nt('geojsonLoadError') : 'Error loading GeoJSON data'
                );
            }
        });
    }

    /**
     * Update uploaded items list
     */
    updateUploadedItemsList() {
        const list = document.getElementById('uploadedItemsList');
        if (!list) return;

        const allItems = [...this.uploadedModels, ...this.uploadedLayers];
        
        if (allItems.length === 0) {
            list.innerHTML = '<div class="empty-state">No items uploaded yet</div>';
            return;
        }

        const nt = window.appI18n?.nt ? window.appI18n.nt.bind(window.appI18n) : null;
        const titleShow = nt ? nt('uploadItemShow') : 'Show on map';
        const titleHide = nt ? nt('uploadItemHide') : 'Hide on map';

        const esc = (s) =>
            String(s ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');

        list.innerHTML = allItems.map(item => {
            const vis = item.visible !== false;
            const hiddenClass = vis ? '' : ' uploaded-item--hidden';
            return `
            <div class="uploaded-item${hiddenClass}" data-id="${esc(item.id)}" data-visible="${vis}">
                <div class="item-info">
                    <span class="item-icon">${item.type === 'architectural' ? '🏗️' : '📐'}</span>
                    <div class="item-details">
                        <div class="item-name">${esc(item.name)}</div>
                        <div class="item-meta">${item.type === 'architectural' ? 'Architectural Model' : 'Vector Layer'} • ${new Date(item.uploadedAt).toLocaleDateString()}</div>
                    </div>
                </div>
                <div class="item-actions">
                    <button type="button" class="btn-icon btn-icon-toggle" data-action="toggle" title="${vis ? titleHide : titleShow}" aria-pressed="${vis ? 'true' : 'false'}" aria-label="${vis ? titleHide : titleShow}">
                        <span aria-hidden="true">👁️</span>
                    </button>
                    <button type="button" class="btn-icon" data-action="delete" title="Delete" aria-label="Delete">
                        <span aria-hidden="true">🗑️</span>
                    </button>
                </div>
            </div>
        `;
        }).join('');

        // Attach event handlers
        list.querySelectorAll('.btn-icon').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const itemId = e.currentTarget.closest('.uploaded-item').dataset.id;
                const action = e.currentTarget.dataset.action;
                
                if (action === 'toggle') {
                    this.toggleItemVisibility(itemId);
                } else if (action === 'delete') {
                    this.deleteItem(itemId);
                }
            });
        });
    }

    /**
     * Toggle item visibility
     */
    toggleItemVisibility(itemId) {
        const viewer = this.tilesetViewer && this.tilesetViewer.viewer;
        const nt = window.appI18n?.nt ? window.appI18n.nt.bind(window.appI18n) : null;
        if (!viewer) {
            if (window.notification) {
                window.notification.warning(nt ? nt('uploadViewerNotReady') : 'Viewer is not ready.');
            }
            return;
        }

        const model = this.uploadedModels.find((m) => m.id === itemId);
        const layer = this.uploadedLayers.find((l) => l.id === itemId);

        if (model) {
            const entity = viewer.entities.getById(itemId);
            if (!entity) {
                if (window.notification) {
                    window.notification.warning(
                        nt ? nt('uploadItemNotInScene') : 'This model is not in the current scene. Upload it again in this session.'
                    );
                }
                return;
            }
            const next = !entity.show;
            entity.show = next;
            model.visible = next;
            this.saveUploadedItems();
            this.updateUploadedItemsList();
            return;
        }

        if (layer) {
            if (!layer.dataSource) {
                if (window.notification) {
                    window.notification.warning(
                        nt ? nt('uploadLayerNotInScene') : 'This layer is not loaded. Re-upload the vector file in this session.'
                    );
                }
                return;
            }
            const next = !layer.dataSource.show;
            layer.dataSource.show = next;
            layer.visible = next;
            this.saveUploadedItems();
            this.updateUploadedItemsList();
            return;
        }
    }

    /**
     * Delete item
     */
    deleteItem(itemId) {
        // Remove from arrays
        this.uploadedModels = this.uploadedModels.filter(m => m.id !== itemId);
        this.uploadedLayers = this.uploadedLayers.filter(l => l.id !== itemId);

        // Remove from viewer
        if (this.tilesetViewer && this.tilesetViewer.viewer) {
            const viewer = this.tilesetViewer.viewer;
            viewer.entities.removeById(itemId);
            
            // Remove data source if exists
            const layer = this.uploadedLayers.find(l => l.id === itemId);
            if (layer && layer.dataSource) {
                viewer.dataSources.remove(layer.dataSource);
            }
        }

        // Save and update UI
        this.saveUploadedItems();
        this.updateUploadedItemsList();

        if (window.notification) {
            window.notification.success(
                window.appI18n?.nt ? window.appI18n.nt('itemDeleted') : 'Item deleted'
            );
        }
    }

    /**
     * Save uploaded items to localStorage
     */
    saveUploadedItems() {
        try {
            localStorage.setItem('uploadedModels', JSON.stringify(this.uploadedModels.map(m => ({
                ...m,
                file: null // Don't store file object
            }))));
            localStorage.setItem('uploadedLayers', JSON.stringify(this.uploadedLayers.map(l => ({
                ...l,
                file: null,
                dataSource: null
            }))));
        } catch (error) {
            console.error('Error saving uploaded items:', error);
        }
    }

    /**
     * Load uploaded items from localStorage
     */
    loadUploadedItems() {
        try {
            const models = localStorage.getItem('uploadedModels');
            const layers = localStorage.getItem('uploadedLayers');
            
            if (models) {
                this.uploadedModels = JSON.parse(models);
            }
            if (layers) {
                this.uploadedLayers = JSON.parse(layers);
            }
        } catch (error) {
            console.error('Error loading uploaded items:', error);
        }
    }

    /**
     * Show upload modal
     */
    show() {
        if (this.modal) {
            this.modal.style.display = 'flex';
            this.updateUploadedItemsList();
        }
    }

    /**
     * Hide upload modal
     */
    hide() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }

    /**
     * Toggle upload modal
     */
    toggle() {
        if (this.modal && this.modal.style.display === 'none') {
            this.show();
        } else {
            this.hide();
        }
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.modelAndLayerUploadManager = new ModelAndLayerUploadManager();
}
