/**
 * PlatformControlsUI
 * Platform controls interface (Site Accessible, Land Use, Sun Position, Plan/Build, Comment, Share)
 */

class PlatformControlsUI {
    constructor() {
        this.siteAccessible = false;
        this.landUse = false;
        this.sunPosition = null;
        /* init() runs from InitializationManager after jsonConfigManager applies runtime overrides */
    }

    /**
     * Initialize
     */
    init() {
        this.setupEventHandlers();
        this.loadSettings();
    }

    /**
     * Set up event handlers
     */
    setupEventHandlers() {
        // Site Accessible toggle
        const siteAccessibleToggle = document.getElementById('siteAccessibleToggle');
        if (siteAccessibleToggle) {
            siteAccessibleToggle.addEventListener('change', (e) => {
                this.setSiteAccessible(e.target.checked);
            });
        }

        // Land Use toggle
        const landUseToggle = document.getElementById('landUseToggle');
        if (landUseToggle) {
            landUseToggle.addEventListener('change', (e) => {
                this.setLandUse(e.target.checked);
            });
        }

        // Sun Position input
        const sunPositionInput = document.getElementById('sunPositionInput');
        if (sunPositionInput) {
            // Set default to current date/time
            const now = new Date();
            now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
            sunPositionInput.value = now.toISOString().slice(0, 16);
            
            sunPositionInput.addEventListener('change', (e) => {
                this.setSunPosition(new Date(e.target.value));
            });
        }

        // Plan/Build button
        const planBuildBtn = document.getElementById('planBuildBtn');
        if (planBuildBtn) {
            planBuildBtn.addEventListener('click', () => {
                this.showPlanBuildDialog();
            });
        }

        // Comment button
        const commentBtn = document.getElementById('commentBtn');
        if (commentBtn) {
            commentBtn.addEventListener('click', () => {
                this.showCommentDialog();
            });
        }

        // Share — same as map toolbar #share (modalDiv + shareLocationManager; all-tools.md §12)
        const shareBtn = document.getElementById('shareBtn');
        if (shareBtn) {
            shareBtn.addEventListener('click', () => {
                if (window.smart3dToolbarWireup && typeof window.smart3dToolbarWireup.invokeMapToolAction === 'function') {
                    window.smart3dToolbarWireup.invokeMapToolAction('share');
                } else if (window.shareLocationManager && typeof window.shareLocationManager.show === 'function') {
                    window.shareLocationManager.show();
                }
            });
        }
    }

    /**
     * Set site accessible
     */
    setSiteAccessible(enabled) {
        this.siteAccessible = enabled;
        this.saveSettings();
        
        // Apply to viewer if available
        if (window.tilesetViewer && window.tilesetViewer.viewer) {
            // Apply site accessibility settings to viewer
            if (window.tilesetViewer.dataLayerIntegration) {
                const accessibilityLayer = window.tilesetViewer.dataLayerIntegration.layers.get('siteAccessibility');
                if (accessibilityLayer) {
                    if (enabled) {
                        window.tilesetViewer.dataLayerIntegration.showLayer('siteAccessibility');
                    } else {
                        window.tilesetViewer.dataLayerIntegration.hideLayer('siteAccessibility');
                    }
                }
            }
            window.notification?.info(`Site Accessible: ${enabled ? 'ON' : 'OFF'}`);
        }
    }

    /**
     * Set land use
     */
    setLandUse(enabled) {
        this.landUse = enabled;
        this.saveSettings();
        
        // Apply to viewer if available
        if (window.tilesetViewer && window.tilesetViewer.viewer) {
            // Apply land use display settings to viewer
            if (window.tilesetViewer.dataLayerIntegration) {
                const landUseLayers = window.tilesetViewer.dataLayerIntegration.getLayersByCategory('urbanPlanning');
                landUseLayers.forEach(layer => {
                    if (enabled) {
                        window.tilesetViewer.dataLayerIntegration.showLayer(layer.id);
                    } else {
                        window.tilesetViewer.dataLayerIntegration.hideLayer(layer.id);
                    }
                });
            }
            window.notification?.info(`Land Use: ${enabled ? 'ON' : 'OFF'}`);
        }
    }

    /**
     * Set sun position
     */
    setSunPosition(date) {
        this.sunPosition = date;
        this.saveSettings();
        
        // Apply to viewer if available
        if (window.tilesetViewer && window.tilesetViewer.viewer) {
            // Update sun position in Cesium
            const viewer = window.tilesetViewer.viewer;
            if (viewer && viewer.scene && viewer.scene.sun) {
                // Cesium uses JulianDate for time
                const julianDate = Cesium.JulianDate.fromDate(date);
                viewer.clock.currentTime = julianDate;
                viewer.clock.shouldAnimate = false;
                
                // Update sun position
                if (viewer.scene.globe) {
                    viewer.scene.globe.enableLighting = true;
                }
            }
            
            window.notification?.success(`Sun position set to ${date.toLocaleString()}`);
        }
    }

    /**
     * Show Plan/Build dialog
     */
    async showPlanBuildDialog() {
        const result = await window.notification?.modal(
            'Plan/Build Mode',
            `
                <div class="form-group">
                    <label>Mode:</label>
                    <select id="planBuildMode" class="select-input">
                        <option value="plan">Plan</option>
                        <option value="build">Build</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Description:</label>
                    <textarea id="planBuildDescription" class="text-input" rows="3" placeholder="Enter plan/build description..."></textarea>
                </div>
            `,
            {
                buttons: [
                    { label: 'Cancel', action: 'cancel', class: 'btn' },
                    { label: 'Save', action: 'save', class: 'btn-primary' }
                ]
            }
        );

        if (result === 'save') {
            const mode = document.getElementById('planBuildMode')?.value || 'plan';
            window.notification?.info(`Plan/Build mode set to: ${mode}`);
        }
    }

    /**
     * Show Comment dialog
     */
    async showCommentDialog() {
        const result = await window.notification?.modal(
            'Add Comment',
            `
                <div class="form-group">
                    <label>Comment:</label>
                    <textarea id="commentText" class="text-input" rows="5" placeholder="Enter your comment..."></textarea>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="commentZoomToLocation">
                        Zoom to location
                    </label>
                </div>
            `,
            {
                buttons: [
                    { label: 'Cancel', action: 'cancel', class: 'btn' },
                    { label: 'Add Comment', action: 'add', class: 'btn-primary' }
                ]
            }
        );

        if (result === 'add') {
            const el = document.getElementById('commentText');
            if (el && el.value) el.value = '';
            window.notification?.success('Comment added');
        }
    }

    /**
     * Apply settings from object (e.g. after import or AppSettingsFramework) and sync viewer without duplicate toasts.
     * @param {Object} settings
     * @param {{ silent?: boolean }} [options]
     */
    applyFromObject(settings, options) {
        if (!settings || typeof settings !== 'object') return;
        const silent = options && options.silent;
        this.siteAccessible = !!settings.siteAccessible;
        this.landUse = !!settings.landUse;
        this.sunPosition = settings.sunPosition ? new Date(settings.sunPosition) : null;

        const siteAccessibleToggle = document.getElementById('siteAccessibleToggle');
        if (siteAccessibleToggle) siteAccessibleToggle.checked = this.siteAccessible;
        const landUseToggle = document.getElementById('landUseToggle');
        if (landUseToggle) landUseToggle.checked = this.landUse;
        const sunPositionInput = document.getElementById('sunPositionInput');
        if (sunPositionInput && this.sunPosition) {
            sunPositionInput.value = this.sunPosition.toISOString().slice(0, 16);
        }

        try {
            localStorage.setItem(
                'platformControlsSettings',
                JSON.stringify({
                    siteAccessible: this.siteAccessible,
                    landUse: this.landUse,
                    sunPosition: this.sunPosition ? this.sunPosition.toISOString() : null
                })
            );
        } catch (e) {
            /* ignore */
        }

        if (!window.tilesetViewer || !window.tilesetViewer.viewer) return;

        const integration = window.tilesetViewer.dataLayerIntegration;
        if (integration) {
            const accessibilityLayer = integration.layers.get('siteAccessibility');
            if (accessibilityLayer) {
                if (this.siteAccessible) integration.showLayer('siteAccessibility');
                else integration.hideLayer('siteAccessibility');
            }
            const landUseLayers = integration.getLayersByCategory('urbanPlanning');
            landUseLayers.forEach((layer) => {
                if (this.landUse) integration.showLayer(layer.id);
                else integration.hideLayer(layer.id);
            });
        }

        if (this.sunPosition && window.tilesetViewer.viewer.scene && window.tilesetViewer.viewer.scene.sun) {
            const viewer = window.tilesetViewer.viewer;
            const julianDate = Cesium.JulianDate.fromDate(this.sunPosition);
            viewer.clock.currentTime = julianDate;
            viewer.clock.shouldAnimate = false;
            if (viewer.scene.globe) viewer.scene.globe.enableLighting = true;
        }

        if (!silent) {
            window.notification?.info('Platform controls updated');
        }
    }

    /**
     * Load settings from localStorage
     */
    loadSettings() {
        try {
            const settings = localStorage.getItem('platformControlsSettings');
            if (settings) {
                const parsed = JSON.parse(settings);
                this.siteAccessible = parsed.siteAccessible || false;
                this.landUse = parsed.landUse || false;
                
                // Update UI
                const siteAccessibleToggle = document.getElementById('siteAccessibleToggle');
                if (siteAccessibleToggle) {
                    siteAccessibleToggle.checked = this.siteAccessible;
                }
                
                const landUseToggle = document.getElementById('landUseToggle');
                if (landUseToggle) {
                    landUseToggle.checked = this.landUse;
                }
                
                if (parsed.sunPosition) {
                    this.sunPosition = new Date(parsed.sunPosition);
                    const sunPositionInput = document.getElementById('sunPositionInput');
                    if (sunPositionInput) {
                        sunPositionInput.value = this.sunPosition.toISOString().slice(0, 16);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load platform controls settings:', error);
        }
    }

    /**
     * Save settings to localStorage
     */
    saveSettings() {
        try {
            const settings = {
                siteAccessible: this.siteAccessible,
                landUse: this.landUse,
                sunPosition: this.sunPosition ? this.sunPosition.toISOString() : null
            };
            localStorage.setItem('platformControlsSettings', JSON.stringify(settings));
        } catch (error) {
            console.error('Failed to save platform controls settings:', error);
        }
    }
}

// Export singleton instance
window.platformControlsUI = new PlatformControlsUI();
