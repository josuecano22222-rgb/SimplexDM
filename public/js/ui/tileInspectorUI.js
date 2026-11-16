/**
 * Tile Inspector UI
 * User interface for tile content inspection and analysis
 */

class TileInspectorUI {
    constructor() {
        this.initialized = false;
        this.isEnabled = false;
    }

    /**
     * Initialize the tile inspector UI
     */
    init() {
        if (this.initialized) return;
        
        // Wait for tilesetViewer to be ready
        setTimeout(() => {
            if (window.tilesetViewer && window.tilesetViewer.viewer && window.tileInspector) {
                window.tileInspector.init(window.tilesetViewer.viewer);
                this.setupEventListeners();
                this.initialized = true;
            } else {
                // Retry after a short delay
                setTimeout(() => this.init(), 500);
            }
        }, 1000);
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Listen for tileset loaded events
        window.addEventListener('tilesetLoaded', (event) => {
            if (window.tileInspector && event.detail.tileset) {
                window.tileInspector.setTileset(event.detail.tileset);
            }
        });

        // Listen for stats updates
        window.addEventListener('tileInspectorStatsUpdated', (event) => {
            this.updateStats(event.detail);
        });

        // Listen for properties updates
        window.addEventListener('tileInspectorPropertiesUpdated', (event) => {
            this.updatePropertyList(event.detail.properties);
        });

        // Listen for feature inspection
        window.addEventListener('featureInspected', (event) => {
            this.displayFeatureInfo(event.detail);
        });

        // Set up inspector button event handlers
        document.getElementById('inspectorResetViewBtn')?.addEventListener('click', () => {
            this.resetView();
        });
        document.getElementById('inspectorToggleTilesetBtn')?.addEventListener('click', () => {
            this.toggleTileset();
        });
        document.getElementById('inspectorAnalyzeBtn')?.addEventListener('click', () => {
            this.analyzeTiles();
        });
        document.getElementById('inspectorAnalyzePropertiesBtn')?.addEventListener('click', () => {
            this.analyzeProperties();
        });
        document.getElementById('inspectorApplyStyleBtn')?.addEventListener('click', () => {
            this.applyPropertyStyle();
        });
        document.getElementById('inspectorResetStyleBtn')?.addEventListener('click', () => {
            this.resetStyle();
        });
        document.getElementById('inspectorExportFeaturesBtn')?.addEventListener('click', () => {
            this.exportFeatures();
        });
        document.getElementById('inspectorExportPropertiesBtn')?.addEventListener('click', () => {
            this.exportProperties();
        });
    }

    /**
     * Show the inspector panel
     */
    show() {
        const section = document.getElementById('tileInspectorSection');
        if (section) {
            section.classList.remove('collapsed');
            const toggleIcon = section.querySelector('.section-toggle-icon');
            if (toggleIcon) {
                toggleIcon.textContent = '▼';
            }
            
            // Enable click handler
            if (window.tileInspector) {
                window.tileInspector.setupClickHandler();
            }
            this.isEnabled = true;
        }
    }

    /**
     * Hide the inspector panel
     */
    hide() {
        const section = document.getElementById('tileInspectorSection');
        if (section) {
            section.classList.add('collapsed');
            // Disable click handler
            if (window.tileInspector) {
                window.tileInspector.removeClickHandler();
            }
            this.isEnabled = false;
        }
    }

    /**
     * Toggle inspector panel
     */
    toggle() {
        if (this.isEnabled) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * Update stats display
     * @param {Object} stats - Stats object with tileCount and featureCount
     */
    updateStats(stats) {
        const tileCountEl = document.getElementById('inspectorTileCount');
        const featureCountEl = document.getElementById('inspectorFeatureCount');
        
        if (tileCountEl && stats) {
            tileCountEl.textContent = stats.tileCount || 0;
        }
        if (featureCountEl && stats) {
            featureCountEl.textContent = stats.featureCount || 0;
        }
    }

    /**
     * Update property list display
     * @param {Array<string>} properties - Array of property names
     */
    updatePropertyList(properties) {
        const propertyListEl = document.getElementById('inspectorPropertyList');
        const styleSelectEl = document.getElementById('inspectorStyleProperty');
        
        if (!propertyListEl) return;
        
        if (!properties || properties.length === 0) {
            propertyListEl.innerHTML = '<span class="sidebar-hint-text">Run <strong>Analyze</strong>, then <strong>Find properties</strong>.</span>';
            return;
        }
        
        let html = '';
        properties.forEach((propertyId) => {
            html += `<div class="property-item" onclick="window.tileInspectorUI.selectProperty('${propertyId}')">${propertyId}</div>`;
        });
        
        propertyListEl.innerHTML = html;
        
        // Update style select
        if (styleSelectEl) {
            styleSelectEl.innerHTML = '<option value="">Select property…</option>';
            properties.forEach((propertyId) => {
                styleSelectEl.innerHTML += `<option value="${propertyId}">${propertyId}</option>`;
            });
        }
    }

    /**
     * Display feature information
     * @param {Object} featureData - Feature data object
     */
    displayFeatureInfo(featureData) {
        const featureInfoEl = document.getElementById('inspectorFeatureInfo');
        if (!featureInfoEl) return;
        
        if (!featureData || featureData.error) {
            featureInfoEl.innerHTML = featureData?.error
                ? `<span class="inspector-error-text">Error: ${String(featureData.error).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`
                : '<span class="sidebar-hint-text">Click a feature in the 3D view.</span>';
            return;
        }

        const meta = featureData.tileMeta || null;
        const metaHtml = meta ? `
            <div style="margin-bottom: 10px; padding: 8px; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;">
                <div style="font-weight: 600; margin-bottom: 6px; color: #68CEF8;">Tile Metadata</div>
                <div>Geometric Error: ${meta.geometricError ?? '--'}</div>
                <div>Refine: ${meta.refine ?? '--'}</div>
                <div>Content URI: ${(meta.contentUri ?? '--').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
                <div>Bounding Volume: ${meta.boundingVolumeType ?? '--'}</div>
                <div>Children: ${meta.childrenCount ?? '--'}</div>
                <div>Depth: ${meta.depth ?? '--'}</div>
                <div>Features (content): ${meta.featuresLength ?? '--'}</div>
            </div>
        ` : '';
        
        const properties = featureData.properties || {};
        const propertyIds = Object.keys(properties);
        
        if (propertyIds.length === 0) {
            featureInfoEl.innerHTML = `${metaHtml}<span class="sidebar-hint-text">No properties on this feature.</span>`;
            return;
        }
        
        let html = '<table style="width: 100%; border-collapse: collapse;">';
        propertyIds.forEach((propertyId) => {
            const value = properties[propertyId];
            const formattedValue = this.formatValue(value);
            html += `<tr><th style="text-align: left; padding: 5px; border-bottom: 1px solid rgba(255, 255, 255, 0.2); color: #68CEF8;">${propertyId}</th><td style="padding: 5px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">${formattedValue}</td></tr>`;
        });
        html += '</table>';
        
        featureInfoEl.innerHTML = `${metaHtml}${html}`;
    }

    /**
     * Format value for display
     * @param {*} value - Value to format
     * @returns {string} Formatted HTML value
     */
    formatValue(value) {
        if (value === null || value === undefined) {
            return '<span style="color: #999;">null</span>';
        }
        if (typeof value === 'object') {
            return '<pre style="margin: 0; font-size: calc(10px * var(--ui-fs-mul, 1)); white-space: pre-wrap;">' + 
                   JSON.stringify(value, null, 2) + '</pre>';
        }
        if (typeof value === 'number') {
            return value.toLocaleString();
        }
        return String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /**
     * Select a property for styling
     * @param {string} propertyId - Property ID to select
     */
    selectProperty(propertyId) {
        const styleSelectEl = document.getElementById('inspectorStyleProperty');
        if (styleSelectEl) {
            styleSelectEl.value = propertyId;
            this.applyPropertyStyle();
        }
    }

    /**
     * Apply property-based style
     */
    applyPropertyStyle() {
        const styleSelectEl = document.getElementById('inspectorStyleProperty');
        if (!styleSelectEl || !window.tileInspector) return;
        
        const propertyName = styleSelectEl.value;
        if (!propertyName) {
            window.tileInspector.resetStyle();
            return;
        }
        
        window.tileInspector.applyPropertyStyle(propertyName);
    }

    /**
     * Reset style
     */
    resetStyle() {
        if (window.tileInspector) {
            window.tileInspector.resetStyle();
        }
        const styleSelectEl = document.getElementById('inspectorStyleProperty');
        if (styleSelectEl) {
            styleSelectEl.value = '';
        }
    }

    /**
     * Analyze properties
     */
    analyzeProperties() {
        if (window.tileInspector) {
            window.tileInspector.analyzeProperties();
        }
    }

    /**
     * Analyze tiles
     */
    analyzeTiles() {
        if (window.tileInspector) {
            window.tileInspector.analyzeTiles();
        }
    }

    /**
     * Export features
     */
    async exportFeatures() {
        if (!window.tileInspector) return;
        
        try {
            const features = await window.tileInspector.exportFeaturesToJSON(1000);
            const json = JSON.stringify(features, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'tile_features.json';
            a.click();
            URL.revokeObjectURL(url);
            
            if (window.notification) {
                window.notification.success(`Exported ${features.length} features`);
            }
        } catch (error) {
            console.error('Error exporting features:', error);
            if (window.notification) {
                window.notification.error('Error exporting features');
            }
        }
    }

    /**
     * Export properties
     */
    exportProperties() {
        if (!window.tileInspector) return;
        
        try {
            const data = window.tileInspector.exportProperties();
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'tile_properties.json';
            a.click();
            URL.revokeObjectURL(url);
            
            if (window.notification) {
                window.notification.success('Properties exported successfully');
            }
        } catch (error) {
            console.error('Error exporting properties:', error);
            if (window.notification) {
                window.notification.error('Error exporting properties');
            }
        }
    }

    /**
     * Reset view
     */
    resetView() {
        if (window.tilesetViewer && window.tilesetViewer.viewer && window.tileInspector && window.tileInspector.tileset) {
            window.tilesetViewer.viewer.zoomTo(window.tileInspector.tileset);
        }
    }

    /**
     * Toggle tileset visibility
     */
    toggleTileset() {
        if (window.tileInspector && window.tileInspector.tileset) {
            window.tileInspector.tileset.show = !window.tileInspector.tileset.show;
            window.tilesetViewer?.viewer?.scene?.requestRender?.();
        }
    }

    /**
     * Analyze active tile / selected feature using `tileInspector` and `b3dmFeatureExtractor`.
     */
    analyzeFeature(featureOrTile) {
        if (window.app && typeof window.app.switchInspectorTab === 'function') {
            window.app.switchInspectorTab('tile');
        }
        if (featureOrTile && window.b3dmFeatureExtractor) {
            try {
                const extracted = window.b3dmFeatureExtractor.extractFromCesiumTile(featureOrTile);
                if (extracted) {
                    const summary = window.b3dmFeatureExtractor.summarizeFeatures(extracted);
                    this.updateStats?.({
                        loadedTiles: 1,
                        totalFeatures: summary.featureCount,
                        totalProperties: summary.propertyCount,
                    });
                    if (summary.properties) {
                        this.updatePropertyList?.(Object.keys(summary.properties));
                    }
                    return summary;
                }
            } catch (err) {
                console.warn('B3DM feature extraction warning:', err);
            }
        }
        if (typeof this.analyzeTiles === 'function') {
            return this.analyzeTiles();
        }
        return null;
    }

    /**
     * Open the Tile Inspector tab and scroll/focus the style controls section.
     */
    showStyleOptions() {
        if (window.app && typeof window.app.switchInspectorTab === 'function') {
            window.app.switchInspectorTab('tile');
        }
        const styleTarget =
            document.getElementById('inspectorApplyStyleBtn') ||
            document.getElementById('inspectorPropertySelect') ||
            document.getElementById('tileTab');
        if (styleTarget && typeof styleTarget.scrollIntoView === 'function') {
            styleTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            styleTarget.focus?.();
        }
    }
}

// Export as global singleton
window.tileInspectorUI = new TileInspectorUI();
