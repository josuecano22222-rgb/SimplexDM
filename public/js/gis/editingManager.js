/**
 * EditingManager (Stage-1)
 * Provides basic draw + select + delete for vector layers stored in GeoPackage.
 *
 * Tools:
 * - drawPoint
 * - select (click)
 * - deleteSelected
 *
 * Stage-1 intentionally keeps geometry ops minimal; topology rules are added later.
 */
class EditingManager {
    constructor() {
        this.viewer = null;
        this.activeTool = 'select';
        this.activeLayerId = null;
        this.selected = null; // {layerId, feature}
        this._handler = null;
    }

    init(viewer) {
        this.viewer = viewer;
        this._installHandlers();
        window.addEventListener('simplex:projectChanged', () => {
            this.selected = null;
        });
    }

    setActiveLayer(layerId) {
        this.activeLayerId = layerId;
    }

    setTool(tool) {
        this.activeTool = tool;
    }

    async deleteSelected() {
        if (!this.selected) return;
        const projectPath = window.projectManager?.currentProjectPath;
        if (!projectPath) return;
        await window.electronAPI.gis.features.delete(projectPath, this.selected.layerId, this.selected.feature.id);
        this.selected = null;
        await window.layerRuntime?.reloadAll();
    }

    _installHandlers() {
        if (!this.viewer) return;
        const canvas = this.viewer.scene.canvas;
        canvas.addEventListener('click', async (e) => {
            if (!this.viewer) return;
            const pos =
                typeof window.cesiumPointerToCanvasPixels === 'function'
                    ? window.cesiumPointerToCanvasPixels(canvas, e.clientX, e.clientY)
                    : new Cesium.Cartesian2(
                          e.clientX - canvas.getBoundingClientRect().left,
                          e.clientY - canvas.getBoundingClientRect().top
                      );
            if (!pos) return;

            if (this.activeTool === 'drawPoint') {
                if (!this.activeLayerId) {
                    window.notification?.warning('Select an active layer to edit');
                    return;
                }
                const cartesian = this.viewer.scene.pickPosition(pos) ||
                    this.viewer.camera.pickEllipsoid(pos, this.viewer.scene.globe.ellipsoid);
                if (!cartesian) return;
                const carto = Cesium.Cartographic.fromCartesian(cartesian);
                const lon = Cesium.Math.toDegrees(carto.longitude);
                const lat = Cesium.Math.toDegrees(carto.latitude);
                const feature = {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [lon, lat] },
                    properties: {}
                };
                const projectPath = window.projectManager?.currentProjectPath;
                await window.electronAPI.gis.features.insert(projectPath, this.activeLayerId, feature);
                await window.layerRuntime?.reloadAll();
                return;
            }

            // select tool: pick entity then map to layerId by id prefix
            if (this.activeTool === 'select') {
                const picked = this.viewer.scene.pick(pos);
                if (!picked || !picked.id) {
                    this.selected = null;
                    return;
                }
                const ent = picked.id;
                const layerId = ent?.properties?.__layerId?.getValue?.() || ent?.properties?.__layerId;
                const featureId = ent?.properties?.__featureId?.getValue?.() || ent?.properties?.__featureId;
                if (!layerId || featureId == null) return;

                const projectPath = window.projectManager?.currentProjectPath;
                const res = await window.electronAPI.gis.features.query(projectPath, { layerId, limit: 1, offset: 0, where: `id = ${Number(featureId)}` });
                const feature = res.features?.[0];
                if (feature) {
                    this.selected = { layerId, feature };
                    window.notification?.info(`Selected ${layerId}:${featureId}`);
                }
            }
        }, true);

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Delete') {
                this.deleteSelected().catch(() => {});
            }
            // Quick tool toggles
            if ((e.ctrlKey || e.metaKey) && e.key === '1') {
                this.setTool('select');
                window.notification?.info('Tool: Select');
            }
            if ((e.ctrlKey || e.metaKey) && e.key === '2') {
                this.setTool('drawPoint');
                window.notification?.info('Tool: Draw Point');
            }
        });
    }
}

if (typeof window !== 'undefined') {
    window.editingManager = window.editingManager || new EditingManager();
}

