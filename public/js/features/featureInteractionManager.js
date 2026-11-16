/**
 * Feature Interaction Manager
 * Handles clicks on .b3dm geometric shapes and displays action buttons
 * Works with tiles, features, and measurement shapes
 */

class FeatureInteractionManager {
    constructor() {
        this.tilesetViewer = null;
        this.viewer = null;
        this.clickHandler = null;
        this.selectedFeature = null;
        this.selectedMeasurement = null;
        this.actionPanel = null;
        this.isInitialized = false;
        /** @type {{ tileset: Cesium.Cesium3DTileset, originalStyle: Cesium.Cesium3DTileStyle|undefined|null } | null} */
        this._isolateState = null;
    }

    /**
     * Initialize feature interaction manager
     */
    init() {
        if (this.isInitialized) return;
        
        this.tilesetViewer = window.tilesetViewer;
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) {
            // Wait for viewer to be ready
            setTimeout(() => this.init(), 500);
            return;
        }

        this.viewer = this.tilesetViewer.viewer;
        this.createActionPanel();
        this.setupClickHandler();
        this.isInitialized = true;
    }

    /**
     * Create action panel for feature/measurement actions
     */
    createActionPanel() {
        // Remove existing if any
        const existing = document.getElementById('featureActionPanel');
        if (existing) {
            existing.remove();
        }

        const panel = document.createElement('div');
        panel.id = 'featureActionPanel';
        panel.className = 'feature-action-panel';
        panel.style.display = 'none';

        panel.innerHTML = `
            <div class="feature-action-header">
                <span class="feature-action-title" id="featureActionTitle">Feature Actions</span>
                <button class="feature-action-close" id="featureActionClose">×</button>
            </div>
            <div class="feature-action-buttons" id="featureActionButtons">
                <!-- Buttons will be populated dynamically -->
            </div>
        `;

        document.body.appendChild(panel);
        this.actionPanel = panel;

        // Close button handler
        document.getElementById('featureActionClose')?.addEventListener('click', () => {
            this.hideActionPanel();
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && !e.target.closest('.toolbar-btn')) {
                // Don't close if clicking on toolbar buttons
                if (!e.target.closest('.feature-action-panel')) {
                    this.hideActionPanel();
                }
            }
        });
    }

    /**
     * Setup click handler for features and measurements
     */
    setupClickHandler() {
        if (!this.viewer) return;

        // Remove existing handler
        if (this.clickHandler) {
            this.viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
                Cesium.ScreenSpaceEventType.LEFT_CLICK
            );
        }

        // Add click handler
        this.clickHandler = this.viewer.cesiumWidget.screenSpaceEventHandler.setInputAction(
            (click) => {
                this.handleClick(click);
            },
            Cesium.ScreenSpaceEventType.LEFT_CLICK
        );
    }

    /**
     * Handle click on scene
     * Integrated with control governance system
     */
    handleClick(click) {
        if (!this.viewer) return;

        if (window.featureManagerUI?.isBlockingFeatureSelection?.()) {
            return;
        }

        // Use control governance if available (it will check modes)
        if (window.controlGovernance) {
            const state = window.controlGovernance.getControlState();
            if (!state.featureControls.enabled || !state.featureControls.selectionEnabled) {
                return; // Feature controls disabled
            }
        }

        // Check if we're in measurement mode (let measurement manager handle it)
        if (window.enhancedMeasurementManager && window.enhancedMeasurementManager.isMeasuring) {
            return; // Let measurement manager handle clicks
        }

        // Check if we're in cut mode (let cut manager handle it)
        if (window.cutByPolygonManager && window.cutByPolygonManager.isActive) {
            return; // Let cut manager handle clicks
        }

        // Convert DOM event to Cesium position if needed
        let position;
        if (click.position) {
            // Cesium ScreenSpaceEvent - already has position
            position = click.position;
        } else if (click.clientX !== undefined) {
            const canvas = this.viewer.canvas;
            position =
                typeof window.cesiumPointerToCanvasPixels === 'function'
                    ? window.cesiumPointerToCanvasPixels(canvas, click.clientX, click.clientY)
                    : new Cesium.Cartesian2(
                          click.clientX - canvas.getBoundingClientRect().left,
                          click.clientY - canvas.getBoundingClientRect().top
                      );
            if (!position) return;
        } else {
            console.warn('FeatureInteractionManager: Invalid click event type', click);
            return;
        }

        const pickedObject = this.viewer.scene.pick(position);
        
        if (!Cesium.defined(pickedObject)) {
            // Check if clicking on measurement shape
            this.checkMeasurementClick(position);
            return;
        }

        // Cesium returns Cesium3DTileFeature directly; legacy pick used { primitive, id }
        if (pickedObject instanceof Cesium.Cesium3DTileFeature) {
            this.selectFeature(pickedObject, pickedObject, position);
            return;
        }

        if (pickedObject.primitive instanceof Cesium.Cesium3DTileset) {
            const feature = pickedObject.id;
            if (feature instanceof Cesium.Cesium3DTileFeature) {
                this.selectFeature(feature, pickedObject, position);
                return;
            }
        }

        // Check if it's a Cesium entity (measurement, feature, etc.)
        if (pickedObject.id && pickedObject.id instanceof Cesium.Entity) {
            const entity = pickedObject.id;
            
            // Check if it's a measurement entity
            if (window.enhancedMeasurementManager) {
                if (typeof window.enhancedMeasurementManager.findMeasurementByEntity === 'function') {
                    const measurement = window.enhancedMeasurementManager.findMeasurementByEntity(entity);
                    if (measurement) {
                        this.selectMeasurement(measurement, position);
                        return;
                    }
                }
            }

            // Check if it's a feature manager entity
            if (window.featureManager) {
                const feature = window.featureManager.findFeatureByEntity(entity);
                if (feature) {
                    this.selectFeatureEntity(feature, position);
                    return;
                }
            }
        }

        // No feature selected, hide panel
        this.hideActionPanel();
    }

    /**
     * Check if clicking on measurement shape
     */
    checkMeasurementClick(screenPosition) {
        if (!window.enhancedMeasurementManager) return;

        // Check all measurements for proximity
        const measurements = window.enhancedMeasurementManager.measurements || [];
        
        for (const measurement of measurements) {
            if (!measurement.entities || measurement.entities.length === 0) continue;

            // Check if click is near any measurement entity
            for (const entity of measurement.entities) {
                if (!entity.position) continue;

                const position = entity.position.getValue 
                    ? entity.position.getValue(this.viewer.clock.currentTime)
                    : entity.position;

                if (!position) continue;

                let screenPos;
                if (typeof window.cesiumWorldToWindowCoordinates === 'function') {
                    screenPos = window.cesiumWorldToWindowCoordinates(this.viewer.scene, position);
                } else if (Cesium.SceneTransforms?.worldToWindowCoordinates) {
                    screenPos = Cesium.SceneTransforms.worldToWindowCoordinates(this.viewer.scene, position);
                } else if (typeof Cesium.SceneTransforms?.wgs84ToWindowCoordinates === 'function') {
                    screenPos = Cesium.SceneTransforms.wgs84ToWindowCoordinates(this.viewer.scene, position);
                }

                if (Cesium.defined(screenPos)) {
                    const distance = Math.sqrt(
                        Math.pow(screenPos.x - screenPosition.x, 2) +
                        Math.pow(screenPos.y - screenPosition.y, 2)
                    );

                    // If within 50 pixels, consider it a click
                    if (distance < 50) {
                        this.selectMeasurement(measurement, screenPosition);
                        return;
                    }
                }
            }
        }
    }

    /**
     * Select a 3D tileset feature (.b3dm)
     */
    selectFeature(feature, pickedObject, screenPosition) {
        this.selectedFeature = {
            type: 'tileset-feature',
            feature: feature,
            pickedObject: pickedObject,
            properties: this.getFeatureProperties(feature)
        };
        this.selectedMeasurement = null;

        // Update tileset viewer selection
        if (window.tilesetViewer && window.tilesetViewer.selectFeature) {
            window.tilesetViewer.selectFeature(feature);
        }

        // Show action panel
        this.showActionPanel(screenPosition, 'tileset-feature');
    }

    /**
     * Select a feature manager entity
     */
    selectFeatureEntity(feature, screenPosition) {
        this.selectedFeature = {
            type: 'feature-manager',
            feature: feature
        };
        this.selectedMeasurement = null;

        this.showActionPanel(screenPosition, 'feature-manager');
    }

    /**
     * Select a measurement
     */
    selectMeasurement(measurement, screenPosition) {
        this.selectedMeasurement = measurement;
        this.selectedFeature = null;

        this.showActionPanel(screenPosition, 'measurement');
    }

    /**
     * Show action panel with appropriate buttons
     */
    showActionPanel(screenPosition, type) {
        if (!this.actionPanel) return;

        const buttonsContainer = document.getElementById('featureActionButtons');
        const titleElement = document.getElementById('featureActionTitle');
        
        if (!buttonsContainer || !titleElement) return;

        // Clear existing buttons
        buttonsContainer.innerHTML = '';

        // Set title
        if (type === 'tileset-feature') {
            titleElement.textContent = 'Feature Actions';
            this.addTilesetFeatureButtons(buttonsContainer);
        } else if (type === 'feature-manager') {
            titleElement.textContent = 'Shape Actions';
            this.addFeatureManagerButtons(buttonsContainer);
        } else if (type === 'measurement') {
            titleElement.textContent = 'Measurement Actions';
            this.addMeasurementButtons(buttonsContainer);
        }

        // Position panel near click position
        const panel = this.actionPanel;
        panel.style.display = 'block';
        panel.style.left = `${screenPosition.x + 10}px`;
        panel.style.top = `${screenPosition.y + 10}px`;
        panel.style.zIndex = window.simplexUILayer
            ? window.simplexUILayer.zIndex('FEATURE_ACTION_PANEL')
            : '10002';
    }

    /**
     * Add buttons for tileset features
     */
    addTilesetFeatureButtons(container) {
        const buttons = [];

        if (this._isolateState) {
            buttons.push({
                icon: '🔲',
                label: 'Show all features',
                action: () => this.clearFeatureIsolation()
            });
        }

        buttons.push(
            {
                icon: '📋',
                label: 'Properties',
                action: () => this.showFeatureProperties()
            },
            {
                icon: '📊',
                label: 'Analyze',
                action: () => this.analyzeFeature()
            },
            {
                icon: '🎨',
                label: 'Style',
                action: () => this.styleFeature()
            },
            {
                icon: '📤',
                label: 'Export',
                action: () => this.exportFeature()
            },
            {
                icon: '🔍',
                label: 'Focus',
                action: () => this.focusFeature()
            },
            {
                icon: '👁️',
                label: 'Isolate',
                action: () => this.isolateFeature()
            }
        );

        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.className = 'feature-action-btn';
            button.innerHTML = `<span class="feature-action-icon">${btn.icon}</span><span>${btn.label}</span>`;
            button.addEventListener('click', btn.action);
            container.appendChild(button);
        });
    }

    /**
     * Add buttons for feature manager shapes
     */
    addFeatureManagerButtons(container) {
        const buttons = [
            {
                icon: '✏️',
                label: 'Edit',
                action: () => this.editFeature()
            },
            {
                icon: '📋',
                label: 'Properties',
                action: () => this.showFeatureProperties()
            },
            {
                icon: '📋',
                label: 'Copy',
                action: () => this.copyFeature()
            },
            {
                icon: '📤',
                label: 'Export',
                action: () => this.exportFeature()
            },
            {
                icon: '🗑️',
                label: 'Delete',
                action: () => this.deleteFeature(),
                danger: true
            }
        ];

        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.className = `feature-action-btn ${btn.danger ? 'danger' : ''}`;
            button.innerHTML = `<span class="feature-action-icon">${btn.icon}</span><span>${btn.label}</span>`;
            button.addEventListener('click', btn.action);
            container.appendChild(button);
        });
    }

    /**
     * Add buttons for measurements
     */
    addMeasurementButtons(container) {
        const buttons = [
            {
                icon: '✏️',
                label: 'Edit',
                action: () => this.editMeasurement()
            },
            {
                icon: '📋',
                label: 'Properties',
                action: () => this.showMeasurementProperties()
            },
            {
                icon: '📋',
                label: 'Copy',
                action: () => this.copyMeasurement()
            },
            {
                icon: '📤',
                label: 'Export',
                action: () => this.exportMeasurement()
            },
            {
                icon: '🗑️',
                label: 'Delete',
                action: () => this.deleteMeasurement(),
                danger: true
            }
        ];

        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.className = `feature-action-btn ${btn.danger ? 'danger' : ''}`;
            button.innerHTML = `<span class="feature-action-icon">${btn.icon}</span><span>${btn.label}</span>`;
            button.addEventListener('click', btn.action);
            container.appendChild(button);
        });
    }

    /**
     * Hide action panel
     */
    hideActionPanel() {
        if (this.actionPanel) {
            this.actionPanel.style.display = 'none';
        }
        this.selectedFeature = null;
        this.selectedMeasurement = null;
    }

    /**
     * Get feature properties
     */
    getFeatureProperties(feature) {
        const properties = {};

        if (!feature) return properties;

        const propertyIds =
            typeof feature.getPropertyIds === 'function'
                ? feature.getPropertyIds()
                : typeof feature.getPropertyNames === 'function'
                  ? feature.getPropertyNames()
                  : [];

        propertyIds.forEach((name) => {
            try {
                const value = feature.getProperty(name);
                properties[name] = value?.getValue ? value.getValue() : value;
            } catch (e) {
                // Property might not be available
            }
        });

        return properties;
    }

    /**
     * Action handlers
     */
    showFeatureProperties() {
        if (!this.selectedFeature) return;
        
        if (this.selectedFeature.type === 'tileset-feature') {
            // Show in metadata panel
            if (window.metadataManager) {
                window.metadataManager.displayFeatureMetadata(
                    this.selectedFeature.properties,
                    this.selectedFeature.feature
                );
            }
            
            // Switch to metadata tab
            if (window.app) {
                window.app.switchTab('metadata');
            }
        }
        
        this.hideActionPanel();
    }

    analyzeFeature() {
        if (!this.selectedFeature || this.selectedFeature.type !== 'tileset-feature') return;
        
        // Use tile inspector to analyze
        if (window.tileInspectorUI) {
            window.tileInspectorUI.analyzeFeature(this.selectedFeature.feature);
        }
        
        this.hideActionPanel();
    }

    styleFeature() {
        if (!this.selectedFeature || this.selectedFeature.type !== 'tileset-feature') return;
        
        // Show style options
        if (window.tileInspectorUI) {
            window.tileInspectorUI.showStyleOptions(this.selectedFeature.feature);
        }
        
        this.hideActionPanel();
    }

    exportFeature() {
        if (!this.selectedFeature) return;
        
        const data = {
            type: this.selectedFeature.type,
            properties: this.selectedFeature.properties || {},
            feature: this.selectedFeature.feature
        };
        
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `feature_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        if (window.notification) {
            window.notification.success(
                window.appI18n?.nt ? window.appI18n.nt('featureExported') : 'Feature exported'
            );
        }
        
        this.hideActionPanel();
    }

    focusFeature() {
        if (!this.selectedFeature || !this.viewer) return;
        
        try {
            const feature = this.selectedFeature.feature;
            if (feature && feature.content) {
                // Get bounding sphere
                const boundingSphere = feature.content.boundingSphere;
                if (boundingSphere && this.viewer.camera && typeof this.viewer.camera.flyToBoundingSphere === 'function') {
                    this.viewer.camera.flyToBoundingSphere(boundingSphere, {
                        duration: 1.0
                    });
                }
            }
        } catch (error) {
            console.warn('Failed to focus feature:', error);
        }
        
        this.hideActionPanel();
    }

    /**
     * @param {boolean} [silent] - if true, no toast (e.g. when switching isolate to another tileset)
     */
    _restoreIsolationStyle(silent) {
        if (!this._isolateState) return;
        const { tileset, originalStyle } = this._isolateState;
        try {
            tileset.style = originalStyle !== undefined ? originalStyle : undefined;
        } catch (e) {
            console.warn('_restoreIsolationStyle:', e);
        }
        this._isolateState = null;
        if (!silent && window.notification) {
            window.notification.success(
                window.appI18n?.nt ? window.appI18n.nt('allFeaturesVisible') : 'All tileset features visible again'
            );
        }
    }

    clearFeatureIsolation() {
        this._restoreIsolationStyle(false);
        this.hideActionPanel();
    }

    isolateFeature() {
        if (!this.selectedFeature || this.selectedFeature.type !== 'tileset-feature') return;

        const feature = this.selectedFeature.feature;
        if (!(feature instanceof Cesium.Cesium3DTileFeature)) {
            if (window.notification) {
                window.notification.warning(
                    window.appI18n?.nt ? window.appI18n.nt('isolationBatchOnly') : 'Isolation is only available for batched 3D Tiles features'
                );
            }
            this.hideActionPanel();
            return;
        }

        const content = feature.content;
        const tileset = content && content.tileset;
        if (!tileset) {
            if (window.notification) {
                window.notification.warning(
                    window.appI18n?.nt ? window.appI18n.nt('isolationNoTileset') : 'Could not resolve tileset for this feature'
                );
            }
            this.hideActionPanel();
            return;
        }

        const batchId = feature.batchId;
        if (batchId === undefined || batchId === null) {
            if (window.notification) {
                window.notification.warning(
                    window.appI18n?.nt ? window.appI18n.nt('isolationNoBatch') : 'This feature has no batch id; isolation is not supported'
                );
            }
            this.hideActionPanel();
            return;
        }

        if (this._isolateState && this._isolateState.tileset !== tileset) {
            this._restoreIsolationStyle(true);
        }

        if (!this._isolateState) {
            this._isolateState = {
                tileset,
                originalStyle: tileset.style
            };
        }

        try {
            tileset.style = new Cesium.Cesium3DTileStyle({
                show: `\${id} === ${batchId}`
            });
            if (window.notification) {
                window.notification.success(
                    window.appI18n?.nt ? window.appI18n.nt('isolationOk') : 'Isolated: only this feature is visible (use Show all features to reset)'
                );
            }
        } catch (e) {
            console.warn('isolateFeature:', e);
            this._isolateState = null;
            if (window.notification) {
                window.notification.error(
                    window.appI18n?.nt ? window.appI18n.nt('isolationFailed') : 'Could not isolate feature'
                );
            }
        }

        this.hideActionPanel();
    }

    editFeature() {
        if (!this.selectedFeature) return;
        
        if (this.selectedFeature.type === 'feature-manager') {
            // Edit feature manager feature
            if (window.featureManagerUI) {
                window.featureManagerUI.editFeature(this.selectedFeature.feature.id);
            }
        }
        
        this.hideActionPanel();
    }

    copyFeature() {
        if (!this.selectedFeature) return;
        
        const data = {
            type: this.selectedFeature.type,
            properties: this.selectedFeature.properties || {}
        };
        
        navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
            if (window.notification) {
                window.notification.success(
                    window.appI18n?.nt ? window.appI18n.nt('featureCopied') : 'Feature copied to clipboard'
                );
            }
        });
        
        this.hideActionPanel();
    }

    deleteFeature() {
        if (!this.selectedFeature) return;
        
        if (confirm('Are you sure you want to delete this feature?')) {
            if (this.selectedFeature.type === 'feature-manager' && window.featureManager) {
                window.featureManager.removeFeature(this.selectedFeature.feature.id);
                if (window.notification) {
                    window.notification.success(
                        window.appI18n?.nt ? window.appI18n.nt('featureDeleted') : 'Feature deleted'
                    );
                }
            }
        }
        
        this.hideActionPanel();
    }

    editMeasurement() {
        if (!this.selectedMeasurement || !window.enhancedMeasurementManager) return;

        const ok = window.enhancedMeasurementManager.beginEditMeasurement(this.selectedMeasurement);
        if (ok && window.notification) {
            window.notification.success(
                window.appI18n?.nt ? window.appI18n.nt('editModeHint') : 'Edit mode: add points or double-click / right-click to finish'
            );
        }

        this.hideActionPanel();
    }

    showMeasurementProperties() {
        if (!this.selectedMeasurement) return;
        
        // Show measurement details
        const details = {
            type: this.selectedMeasurement.type,
            result: this.selectedMeasurement.result,
            points: this.selectedMeasurement.points.length
        };
        
        alert(`Measurement Details:\nType: ${details.type}\nResult: ${details.result}\nPoints: ${details.points}`);
        
        this.hideActionPanel();
    }

    copyMeasurement() {
        if (!this.selectedMeasurement) return;
        
        const data = {
            type: this.selectedMeasurement.type,
            result: this.selectedMeasurement.result,
            points: this.selectedMeasurement.points.map(p => {
                const cart = Cesium.Cartographic.fromCartesian(p);
                return {
                    lon: Cesium.Math.toDegrees(cart.longitude),
                    lat: Cesium.Math.toDegrees(cart.latitude),
                    height: cart.height
                };
            })
        };
        
        navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
            if (window.notification) {
                window.notification.success(
                    window.appI18n?.nt ? window.appI18n.nt('measurementCopied') : 'Measurement copied to clipboard'
                );
            }
        });
        
        this.hideActionPanel();
    }

    exportMeasurement() {
        if (!this.selectedMeasurement) return;
        
        const data = {
            type: this.selectedMeasurement.type,
            result: this.selectedMeasurement.result,
            points: this.selectedMeasurement.points.map(p => {
                const cart = Cesium.Cartographic.fromCartesian(p);
                return {
                    lon: Cesium.Math.toDegrees(cart.longitude),
                    lat: Cesium.Math.toDegrees(cart.latitude),
                    height: cart.height
                };
            })
        };
        
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `measurement_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        if (window.notification) {
            window.notification.success(
                window.appI18n?.nt ? window.appI18n.nt('measurementExported') : 'Measurement exported'
            );
        }
        
        this.hideActionPanel();
    }

    deleteMeasurement() {
        if (!this.selectedMeasurement || !window.enhancedMeasurementManager) return;
        
        if (confirm('Are you sure you want to delete this measurement?')) {
            // Find and remove measurement
            const index = window.enhancedMeasurementManager.measurements.indexOf(this.selectedMeasurement);
            if (index !== -1) {
                // Remove entities
                const viewer = window.enhancedMeasurementManager.tilesetViewer.viewer;
                this.selectedMeasurement.entities.forEach(entity => {
                    viewer.entities.remove(entity);
                });
                this.selectedMeasurement.labels.forEach(label => {
                    viewer.entities.remove(label);
                });
                
                // Remove from array
                window.enhancedMeasurementManager.measurements.splice(index, 1);
                
                if (window.notification) {
                    window.notification.success(
                        window.appI18n?.nt ? window.appI18n.nt('measurementDeleted') : 'Measurement deleted'
                    );
                }
            }
        }
        
        this.hideActionPanel();
    }
}

// Export singleton instance
if (typeof window !== 'undefined') {
    window.featureInteractionManager = new FeatureInteractionManager();
}
