/**
 * LayersMenuManager
 * Enhanced Layers Menu with clickable layers and property info (Meridian Design - Pages 13-14)
 * Features: Layer toggling, clickable polygons, property information panel, external links
 */

class LayersMenuManager {
    constructor() {
        this.tilesetViewer = null;
        this.modal = null;
        this.propertyPanel = null;
        this.layers = new Map();
        this.activeLayers = new Set();
        this.clickableEntities = new Map();
        this.selectedEntity = null;
        this.handler = null;
        this.init();
    }

    /**
     * Initialize layers menu manager
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        
        // Initialize layers (will use defaults if config not ready)
        this.initializeDefaultLayers();
        this.createLayersModal();
        this.createPropertyPanel();
        
        this.setupEventHandlers();
        this.setupClickHandlers();
        
        // Listen for config updates to reinitialize layers
        window.addEventListener('jsonConfigUpdated', () => {
            this.initializeDefaultLayers();
            this.renderLayersList();
        });
        
        // Also check config after a delay in case it loads later
        setTimeout(() => {
            if (window.jsonConfigManager && window.jsonConfigManager.initialized) {
                this.initializeDefaultLayers();
                this.renderLayersList();
            }
        }, 500);
    }

    /**
     * Initialize default layers
     * Now reads configuration from JSON
     */
    initializeDefaultLayers() {
        // Get layer configuration from JSON
        let defaultVisible = ['background', '3d'];
        let defaultHidden = ['streets', 'house-number', 'blocks', 'parcels', 'land-uses'];
        
        if (window.jsonConfigManager) {
            const layerConfig = window.jsonConfigManager.getFeatureConfig('layers');
            if (layerConfig) {
                if (layerConfig.defaultVisible) {
                    defaultVisible = layerConfig.defaultVisible;
                }
                if (layerConfig.defaultHidden) {
                    defaultHidden = layerConfig.defaultHidden;
                }
            }
        }

        // Base layers
        this.layers.set('background', {
            id: 'background',
            name: 'Background',
            visible: defaultVisible.includes('background'),
            type: 'base',
            category: 'base'
        });

        this.layers.set('3d', {
            id: '3d',
            name: '3D',
            visible: defaultVisible.includes('3d') || defaultVisible.includes('3D'),
            type: 'base',
            category: 'base'
        });

        // Information layers
        this.layers.set('streets', {
            id: 'streets',
            name: 'Streets',
            visible: !defaultHidden.includes('streets') && defaultVisible.includes('streets'),
            type: 'information',
            category: 'information'
        });

        this.layers.set('house-number', {
            id: 'house-number',
            name: 'House Number',
            visible: !defaultHidden.includes('house-number') && defaultVisible.includes('house-number'),
            type: 'information',
            category: 'information'
        });

        this.layers.set('blocks', {
            id: 'blocks',
            name: 'Blocks',
            visible: !defaultHidden.includes('blocks') && defaultVisible.includes('blocks'),
            type: 'information',
            category: 'information',
            clickable: true
        });

        this.layers.set('parcels', {
            id: 'parcels',
            name: 'Parcels',
            visible: !defaultHidden.includes('parcels') && defaultVisible.includes('parcels'),
            type: 'information',
            category: 'information',
            clickable: true
        });

        this.layers.set('land-uses', {
            id: 'land-uses',
            name: 'Land Uses',
            visible: !defaultHidden.includes('land-uses') && defaultVisible.includes('land-uses'),
            type: 'information',
            category: 'information'
        });

        // User-uploaded layers (empty initially)
        this.layers.set('models', {
            id: 'models',
            name: 'Models',
            visible: false,
            type: 'folder',
            category: 'user',
            children: []
        });

        this.layers.set('my-layers', {
            id: 'my-layers',
            name: 'My Layers',
            visible: false,
            type: 'folder',
            category: 'user',
            children: []
        });

        // Set active layers based on visibility
        this.activeLayers.clear();
        this.layers.forEach((layer, id) => {
            if (layer.visible) {
                this.activeLayers.add(id);
            }
        });
    }

    /**
     * Create layers menu modal
     */
    createLayersModal() {
        // Remove existing if any
        const existing = document.getElementById('layersMenuModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'layersMenuModal';
        /* Must include .modal for fixed fullscreen overlay + z-index (see main.css .modal) */
        modal.className = 'modal layers-menu-modal';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="layers-menu-content">
                <div class="layers-menu-header">
                    <h2>Layers Menu</h2>
                    <button class="close-btn" id="closeLayersMenuBtn">×</button>
                </div>
                <div class="layers-menu-body">
                    <div class="layers-menu-main">
                        <div class="layers-menu-icon-container">
                            <div class="layers-menu-icon">
                                <div class="layer-icon-layer"></div>
                                <div class="layer-icon-layer"></div>
                                <div class="layer-icon-layer"></div>
                            </div>
                        </div>
                        <div class="layers-menu-instructions">
                            <p>Clicking this button will open the layers menu.</p>
                            <p>By default, the background layer and the 3D layer will be on.</p>
                            <p>Additionally, it will be possible to turn on additional layers that have been added to the interface.</p>
                            <p>If the user has uploaded architectural models or layers, they will appear under 'Models' or 'Layers' folders.</p>
                        </div>
                    </div>
                    <div class="layers-menu-sidebar">
                        <div class="layers-sidebar-header">
                            <h3>Information Layers</h3>
                        </div>
                        <div class="layers-list" id="layersList">
                            <!-- Layers will be populated here -->
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
        this.renderLayersList();

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.hide();
            }
        });
    }

    /**
     * Render layers list
     */
    renderLayersList() {
        const list = document.getElementById('layersList');
        if (!list) return;

        // Group layers by category
        const baseLayers = [];
        const infoLayers = [];
        const userFolders = [];

        this.layers.forEach(layer => {
            if (layer.category === 'base') {
                baseLayers.push(layer);
            } else if (layer.category === 'information') {
                infoLayers.push(layer);
            } else if (layer.category === 'user') {
                userFolders.push(layer);
            }
        });

        let html = '';

        // Base layers
        baseLayers.forEach(layer => {
            html += this.renderLayerItem(layer);
        });

        // Information layers
        infoLayers.forEach(layer => {
            html += this.renderLayerItem(layer);
        });

        // User folders (expandable)
        userFolders.forEach(folder => {
            html += this.renderFolderItem(folder);
        });

        list.innerHTML = html;

        // Add event handlers
        list.querySelectorAll('.layer-item').forEach(item => {
            const layerId = item.dataset.layerId;
            const toggle = item.querySelector('.layer-toggle');
            const expandBtn = item.querySelector('.layer-expand-btn');

            // Toggle visibility
            toggle?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleLayer(layerId);
            });

            // Expand/collapse folder
            expandBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleFolder(layerId);
            });
        });
    }

    /**
     * Render layer item
     */
    renderLayerItem(layer) {
        const isActive = this.activeLayers.has(layer.id);
        return `
            <div class="layer-item ${isActive ? 'active' : ''}" data-layer-id="${layer.id}">
                <div class="layer-toggle ${isActive ? 'on' : 'off'}" title="Toggle ${layer.name}">
                    <span class="toggle-indicator"></span>
                </div>
                <div class="layer-name">${layer.name}</div>
            </div>
        `;
    }

    /**
     * Render folder item (expandable)
     */
    renderFolderItem(folder) {
        const isExpanded = folder.expanded || false;
        const hasChildren = folder.children && folder.children.length > 0;
        
        return `
            <div class="layer-folder" data-layer-id="${folder.id}">
                <div class="layer-item folder-header">
                    <button class="layer-expand-btn ${isExpanded ? 'expanded' : ''}" title="Expand/Collapse">
                        <span>▶</span>
                    </button>
                    <div class="layer-name">${folder.name}</div>
                </div>
                <div class="folder-children" style="display: ${isExpanded ? 'block' : 'none'}">
                    ${hasChildren ? folder.children.map(child => this.renderLayerItem(child)).join('') : 
                      '<div class="folder-empty">No items</div>'}
                </div>
            </div>
        `;
    }

    /**
     * Create property information panel
     */
    createPropertyPanel() {
        // Remove existing if any
        const existing = document.getElementById('propertyInfoPanel');
        if (existing) {
            existing.remove();
        }

        const panel = document.createElement('div');
        panel.id = 'propertyInfoPanel';
        panel.className = 'property-info-panel';
        panel.style.display = 'none';

        panel.innerHTML = `
            <div class="property-panel-header">
                <div class="property-panel-title">
                    <span class="property-icon">📷</span>
                    <h3 id="propertyTitle">Property Information</h3>
                </div>
                <button class="close-btn" id="closePropertyPanelBtn">×</button>
            </div>
            <div class="property-panel-content" id="propertyContent">
                <!-- Property details will be populated here -->
            </div>
        `;

        document.querySelector('.viewer-container')?.appendChild(panel);
        this.propertyPanel = panel;

        // Close button handler
        document.getElementById('closePropertyPanelBtn')?.addEventListener('click', () => {
            this.hidePropertyPanel();
        });
    }

    /**
     * Setup event handlers for modal (close button, ESC key, outside click)
     */
    setupEventHandlers() {
        if (LayersMenuManager._globalLayersUiBound) {
            return;
        }
        LayersMenuManager._globalLayersUiBound = true;

        document.addEventListener('click', (e) => {
            if (e.target.id === 'closeLayersMenuBtn' || e.target.closest('#closeLayersMenuBtn')) {
                e.stopPropagation();
                e.preventDefault();
                if (window.layersMenuManager) {
                    window.layersMenuManager.hide();
                }
            }
        });

        const escHandler = (e) => {
            const m = window.layersMenuManager?.modal;
            if (e.key === 'Escape' && m && m.style.display !== 'none') {
                window.layersMenuManager.hide();
            }
        };
        document.addEventListener('keydown', escHandler);
        this.escHandler = escHandler;
    }

    /**
     * Setup click handlers for clickable layers
     */
    setupClickHandlers() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        
        // Remove existing handler if any
        if (this.handler) {
            this.handler.destroy();
        }

        this.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

        // Handle left click on entities
        this.handler.setInputAction((click) => {
            const pickedObject = viewer.scene.pick(click.position);
            
            if (Cesium.defined(pickedObject) && pickedObject.id) {
                const entity = pickedObject.id;
                
                // Check if entity is clickable
                if (entity.properties && entity.properties._layerType) {
                    this.handleLayerClick(entity, click.position);
                }
            } else {
                // Click on empty space - hide property panel
                this.hidePropertyPanel();
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }

    /**
     * Handle click on layer entity
     */
    handleLayerClick(entity, screenPosition) {
        const layerType = entity.properties._layerType;
        const properties = entity.properties;

        // Show temporary pop-up
        this.showTemporaryPopup(entity, screenPosition);

        // Show property panel
        this.showPropertyPanel(entity, properties);
    }

    /**
     * Show temporary pop-up (quick info)
     */
    showTemporaryPopup(entity, screenPosition) {
        // Remove existing popup
        const existing = document.getElementById('tempPropertyPopup');
        if (existing) {
            existing.remove();
        }

        const popup = document.createElement('div');
        popup.id = 'tempPropertyPopup';
        popup.className = 'temp-property-popup';
        popup.style.position = 'fixed';
        popup.style.left = `${screenPosition.x + 10}px`;
        popup.style.top = `${screenPosition.y - 10}px`;
        popup.style.zIndex = window.simplexUILayer
            ? window.simplexUILayer.zIndex('LAYERS_MENU_POPUP')
            : '10003';

        // Get quick info from entity properties
        const quickInfo = this.getQuickInfo(entity.properties);
        popup.innerHTML = `<div class="popup-content">${quickInfo}</div>`;

        document.body.appendChild(popup);

        // Auto-hide after 2 seconds
        setTimeout(() => {
            popup.remove();
        }, 2000);
    }

    /**
     * Get quick info from properties
     */
    getQuickInfo(properties) {
        // Extract key properties for quick display
        const parcel = properties.parcel?.getValue() || properties.PARCEL?.getValue() || '--';
        const block = properties.block?.getValue() || properties.BLOCK?.getValue() || '--';
        const area = properties.area?.getValue() || properties.AREA?.getValue() || '--';
        
        return `${parcel} | ${block} | ${area}`;
    }

    /**
     * Show property information panel
     */
    showPropertyPanel(entity, properties) {
        if (!this.propertyPanel) return;

        this.selectedEntity = entity;

        // Highlight entity on map
        this.highlightEntity(entity);

        // Get detailed properties
        const propertyData = this.extractPropertyData(properties);

        // Update panel title
        const title = document.getElementById('propertyTitle');
        if (title) {
            title.textContent = propertyData.title || 'Property Information';
        }

        // Update panel content
        const content = document.getElementById('propertyContent');
        if (content) {
            content.innerHTML = this.renderPropertyContent(propertyData);
        }

        // Show panel
        this.propertyPanel.style.display = 'block';

        // Add external link handler if available
        const linkBtn = content?.querySelector('#openEngineeringLinkBtn');
        if (linkBtn && propertyData.engineeringLink) {
            linkBtn.addEventListener('click', () => {
                window.open(propertyData.engineeringLink, '_blank');
            });
        }
    }

    /**
     * Extract property data from Cesium properties
     */
    extractPropertyData(properties) {
        const data = {
            title: 'Property Information',
            fields: [],
            engineeringLink: null
        };

        // Extract common property fields
        const parcel = this.getPropertyValue(properties, ['parcel', 'PARCEL', 'Parcel']);
        const block = this.getPropertyValue(properties, ['block', 'BLOCK', 'Block', 'gush', 'GUSH']);
        const area = this.getPropertyValue(properties, ['area', 'AREA', 'Area', 'calculatedArea']);
        const landUse = this.getPropertyValue(properties, ['landUse', 'land_use', 'LAND_USE']);

        if (parcel) {
            data.title = `Parcel ${parcel}`;
            data.fields.push({ label: 'Parcel', value: parcel });
        }

        if (block) {
            data.fields.push({ label: 'Block', value: block });
        }

        if (area) {
            data.fields.push({ label: 'Calculated Area (sqm)', value: area });
        }

        if (landUse) {
            data.fields.push({ label: 'Land Use', value: landUse });
        }

        // Check for engineering link
        const link = this.getPropertyValue(properties, ['engineeringLink', 'engineering_link', 'link']);
        if (link) {
            data.engineeringLink = link;
        }

        return data;
    }

    /**
     * Get property value from Cesium properties
     */
    getPropertyValue(properties, keys) {
        for (const key of keys) {
            if (properties[key]) {
                const value = properties[key].getValue ? properties[key].getValue() : properties[key];
                if (value !== null && value !== undefined) {
                    return value;
                }
            }
        }
        return null;
    }

    /**
     * Render property content
     */
    renderPropertyContent(data) {
        let html = '<div class="property-details">';
        
        data.fields.forEach(field => {
            html += `
                <div class="property-field">
                    <div class="property-label">${field.label}:</div>
                    <div class="property-value">${field.value}</div>
                </div>
            `;
        });

        html += '</div>';

        if (data.engineeringLink) {
            html += `
                <div class="property-actions">
                    <button class="btn btn-primary" id="openEngineeringLinkBtn">
                        Open Link from Engineering Site
                    </button>
                </div>
            `;
        }

        return html;
    }

    /**
     * Highlight entity on map
     */
    highlightEntity(entity) {
        // Remove previous highlight
        if (this.selectedEntity && this.selectedEntity.polygon) {
            this.selectedEntity.polygon.outlineColor = Cesium.Color.CYAN;
            this.selectedEntity.polygon.material = Cesium.Color.CYAN.withAlpha(0.3);
        }

        // Highlight new entity
        if (entity.polygon) {
            entity.polygon.outlineColor = Cesium.Color.LIME;
            entity.polygon.material = Cesium.Color.LIME.withAlpha(0.5);
        }
    }

    /**
     * Hide property panel
     */
    hidePropertyPanel() {
        if (this.propertyPanel) {
            this.propertyPanel.style.display = 'none';
        }

        // Remove highlight
        if (this.selectedEntity && this.selectedEntity.polygon) {
            this.selectedEntity.polygon.outlineColor = Cesium.Color.CYAN;
            this.selectedEntity.polygon.material = Cesium.Color.CYAN.withAlpha(0.3);
        }

        this.selectedEntity = null;
    }

    /**
     * Toggle layer visibility
     */
    toggleLayer(layerId) {
        const layer = this.layers.get(layerId);
        if (!layer) return;

        const isActive = this.activeLayers.has(layerId);
        
        if (isActive) {
            this.activeLayers.delete(layerId);
            layer.visible = false;
            this.hideLayer(layerId);
        } else {
            this.activeLayers.add(layerId);
            layer.visible = true;
            this.showLayer(layerId);
        }

        this.renderLayersList();
    }

    /**
     * Show layer
     */
    showLayer(layerId) {
        if (window.layerStore) {
            window.layerStore.setVisible(layerId, true);
        }
        if (window.layerRuntime) {
            window.layerRuntime.applyVisibility?.();
        }
        this.tilesetViewer?.viewer?.scene?.requestRender?.();
    }

    /**
     * Hide layer
     */
    hideLayer(layerId) {
        if (window.layerStore) {
            window.layerStore.setVisible(layerId, false);
        }
        if (window.layerRuntime) {
            window.layerRuntime.applyVisibility?.();
        }
        this.tilesetViewer?.viewer?.scene?.requestRender?.();
    }

    /**
     * Toggle folder expansion
     */
    toggleFolder(folderId) {
        const folder = this.layers.get(folderId);
        if (!folder || folder.type !== 'folder') return;

        folder.expanded = !folder.expanded;
        this.renderLayersList();
    }

    /**
     * Show layers menu modal
     */
    show() {
        if (this.modal) {
            this.modal.style.display = 'flex';
            this.renderLayersList();
        }
    }

    /**
     * Hide layers menu modal
     */
    hide() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }

    /**
     * Toggle layers menu modal
     */
    toggle() {
        if (this.modal && this.modal.style.display === 'none') {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Add user-uploaded layer
     */
    addUserLayer(layerData) {
        // Add to "My Layers" folder
        const myLayers = this.layers.get('my-layers');
        if (myLayers && myLayers.children) {
            myLayers.children.push(layerData);
            this.renderLayersList();
        }
    }

    /**
     * Add user-uploaded model
     */
    addUserModel(modelData) {
        // Add to "Models" folder
        const models = this.layers.get('models');
        if (models && models.children) {
            models.children.push(modelData);
            this.renderLayersList();
        }
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.layersMenuManager = new LayersMenuManager();
}
