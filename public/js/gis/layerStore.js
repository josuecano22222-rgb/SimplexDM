/**
 * LayerStore (Renderer)
 * Keeps layer list and visibility state in sync with GeoPackage via IPC.
 */
class LayerStore {
    constructor() {
        this.layers = []; // {id,name,type}
        this.visibility = new Map(); // id -> boolean
    }

    async refresh() {
        const projectPath = window.projectManager?.currentProjectPath;
        if (!projectPath) return { vectors: [], rasters: [] };
        const { vectors, rasters } = await window.electronAPI.gis.layers.list(projectPath);
        this.layers = [...vectors, ...rasters];
        // default visible
        for (const l of this.layers) {
            if (!this.visibility.has(l.id)) this.visibility.set(l.id, true);
        }
        this._emit();
        return { vectors, rasters };
    }

    setVisible(layerId, visible) {
        this.visibility.set(layerId, !!visible);
        this._emit();
    }

    isVisible(layerId) {
        return this.visibility.get(layerId) !== false;
    }

    _emit() {
        window.dispatchEvent(new CustomEvent('simplex:layersChanged', {
            detail: {
                layers: this.layers,
                visibility: Object.fromEntries(this.visibility.entries())
            }
        }));
    }
}

if (typeof window !== 'undefined') {
    window.layerStore = window.layerStore || new LayerStore();
}

