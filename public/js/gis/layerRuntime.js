/**
 * LayerRuntime
 * Renders vector layers from GeoPackage into Cesium using DataLayerIntegration.
 * Stage-1: pulls GeoJSON features via IPC and renders as Cesium entities.
 */
class LayerRuntime {
    constructor() {
        this.viewer = null;
        this.dataLayerIntegration = null;
        this.loaded = new Map(); // layerId -> {layer, lastQuery}
    }

    init(viewer) {
        this.viewer = viewer;
        // Reuse existing DataLayerIntegration patterns
        this.dataLayerIntegration = window.dataLayerIntegration || new DataLayerIntegration(viewer);
        window.dataLayerIntegration = this.dataLayerIntegration;

        try {
            if (window.layerRenderingQuality && typeof window.layerRenderingQuality.applyPresentation === 'function') {
                window.layerRenderingQuality.applyPresentation(viewer);
            }
        } catch (e) {
            console.warn('layerRenderingQuality.applyPresentation failed', e);
        }

        if (window.editingManager && window.editingManager.init) {
            window.editingManager.init(viewer);
        }
        if (window.rasterSamplingManager && window.rasterSamplingManager.init) {
            window.rasterSamplingManager.init(viewer);
        }

        window.addEventListener('simplex:projectChanged', async () => {
            await window.layerStore?.refresh();
            await this.reloadAll();
        });
        window.addEventListener('simplex:layersChanged', async () => {
            await this.applyVisibility();
        });
    }

    async reloadAll() {
        if (!this.viewer || !window.projectManager?.currentProjectPath) return;
        // Remove all current entities for known layers
        for (const layerId of this.loaded.keys()) {
            this._removeLayerEntities(layerId);
        }
        this.loaded.clear();

        await window.layerStore?.refresh();
        for (const l of window.layerStore.layers) {
            if (l.type !== 'vector') continue;
            await this.loadVectorLayer(l.id);
        }
        await this.applyVisibility();
    }

    async loadVectorLayer(layerId) {
        const projectPath = window.projectManager?.currentProjectPath;
        if (!projectPath) return;

        const res = await window.electronAPI.gis.features.query(projectPath, {
            layerId,
            limit: 5000,
            offset: 0
        });
        const fc = { type: 'FeatureCollection', features: res.features || [] };

        // Use DataLayerIntegration to render
        const layer = this.dataLayerIntegration.addUserDefinedLayer(layerId, fc, {
            name: layerId,
            visible: true
        });

        // Attach layerId + featureId to entities for selection/editing
        try {
            for (const ent of layer.entities || []) {
                if (!ent.properties) ent.properties = new Cesium.PropertyBag();
                if (ent.properties.addProperty) {
                    ent.properties.addProperty('__layerId');
                    ent.properties.addProperty('__featureId');
                }
                ent.properties.__layerId = layerId;
                // feature id is not guaranteed in entities; best-effort from GeoJSON properties
                const fid = ent?.properties?.id || ent?.id;
                ent.properties.__featureId = fid;
            }
        } catch {}
        this.loaded.set(layerId, { layer, lastQuery: Date.now() });
    }

    async applyVisibility() {
        for (const [layerId, rec] of this.loaded.entries()) {
            const visible = window.layerStore?.isVisible(layerId);
            if (visible) this.dataLayerIntegration.showLayer(layerId);
            else this.dataLayerIntegration.hideLayer(layerId);
        }
    }

    _removeLayerEntities(layerId) {
        const rec = this.loaded.get(layerId);
        if (!rec?.layer) return;
        try {
            this.dataLayerIntegration.removeLayer?.(layerId);
        } catch {
            // Fallback: remove entities manually if stored
            const entities = rec.layer.entities || [];
            for (const e of entities) {
                try {
                    this.viewer.entities.remove(e);
                } catch {}
            }
        }
    }
}

if (typeof window !== 'undefined') {
    window.layerRuntime = window.layerRuntime || new LayerRuntime();
}

