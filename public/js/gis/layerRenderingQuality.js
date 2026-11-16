/**
 * Layer rendering quality — crisp presentation + accurate geodesic vectors + tileset detail cap.
 * Works with Meridian GIS layers (GeoPackage → DataLayerIntegration) and 3D Tiles (e.g. Baana / project tilesets).
 */
(function () {
    'use strict';

    function getLayerRenderingConfig() {
        try {
            const jcm = window.jsonConfigManager;
            if (jcm && typeof jcm.mergeAppConfigWithDefaults === 'function') {
                const app = jcm.mergeAppConfigWithDefaults(jcm.configs.get('app'));
                if (app && app.layerRendering && typeof app.layerRendering === 'object') {
                    return app.layerRendering;
                }
            }
        } catch (e) {
            /* ignore */
        }
        return {};
    }

    /**
     * Viewer-level sharpness & depth (safe to call after Cesium.Viewer is ready).
     * @param {Cesium.Viewer} viewer
     */
    function applyPresentation(viewer) {
        if (!viewer || !viewer.scene) return;
        const cfg = getLayerRenderingConfig();
        if (cfg.enabled === false) return;

        const scene = viewer.scene;
        const jcm = window.jsonConfigManager;
        let perfMerged = {};
        try {
            if (jcm && typeof jcm.mergeAppConfigWithDefaults === 'function') {
                const app = jcm.mergeAppConfigWithDefaults(jcm.configs.get('app'));
                perfMerged = (app && app.performance) || {};
            }
        } catch (e) {
            /* ignore */
        }

        const useBrowser =
            typeof perfMerged.useBrowserRecommendedResolution === 'boolean'
                ? perfMerged.useBrowserRecommendedResolution
                : cfg.useBrowserRecommendedResolution === true;
        if (viewer.useBrowserRecommendedResolution !== undefined) {
            viewer.useBrowserRecommendedResolution = useBrowser;
        }
        if (!useBrowser && viewer.resolutionScale !== undefined) {
            const smax = Math.min(
                2.5,
                Math.max(
                    0.5,
                    Number(
                        perfMerged.viewerResolutionScaleMax != null
                            ? perfMerged.viewerResolutionScaleMax
                            : cfg.viewerResolutionScaleMax
                    ) || 2
                )
            );
            const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
            viewer.resolutionScale = Math.min(smax, dpr);
        }

        try {
            if (scene.postProcessStages && scene.postProcessStages.fxaa && cfg.fxaa !== false) {
                scene.postProcessStages.fxaa.enabled = true;
            }
        } catch (e) {
            /* ignore */
        }

        if (scene.globe && cfg.depthTestAgainstTerrain !== false) {
            scene.globe.depthTestAgainstTerrain = true;
        }

        const reqRaw =
            cfg.maximumRequestsPerServer != null && cfg.maximumRequestsPerServer !== ''
                ? cfg.maximumRequestsPerServer
                : perfMerged.maximumRequestsPerServer;
        const req = Number(reqRaw);
        if (Cesium.RequestScheduler && Number.isFinite(req)) {
            Cesium.RequestScheduler.maximumRequestsPerServer = Math.min(64, Math.max(6, req));
        }
    }

    /**
     * Tighten 3D Tiles detail when tileset SSE is loose (e.g. external Baana bundles). Does not raise SSE above current.
     * @param {Cesium.Cesium3DTileset} tileset
     */
    function applyToTileset(tileset) {
        if (!tileset || (typeof tileset.isDestroyed === 'function' && tileset.isDestroyed())) return;
        const cfg = getLayerRenderingConfig();
        if (cfg.enabled === false) return;
        const cap = Number(cfg.tilesetMaximumScreenSpaceError);
        if (!Number.isFinite(cap) || cap <= 0) return;
        const cur = tileset.maximumScreenSpaceError;
        if (Number.isFinite(cur)) {
            tileset.maximumScreenSpaceError = Math.min(cur, cap);
        } else {
            tileset.maximumScreenSpaceError = cap;
        }
        if (cfg.enableDynamicScreenSpaceError === true && tileset.dynamicScreenSpaceError !== undefined) {
            tileset.dynamicScreenSpaceError = true;
        }
    }

    function applyToAllTilesetsInScene(scene) {
        if (!scene || !scene.primitives) return;
        const n = scene.primitives.length;
        for (let i = 0; i < n; i++) {
            const p = scene.primitives.get(i);
            if (p instanceof Cesium.Cesium3DTileset) {
                applyToTileset(p);
            }
        }
    }

    /**
     * Refine vector entities created by DataLayerIntegration (geodesic polylines, classification, depth).
     * @param {Cesium.Entity[]} entities
     */
    function refineLayerEntities(entities) {
        if (!entities || !entities.length) return;
        const cfg = getLayerRenderingConfig();
        if (cfg.enabled === false) return;
        const granDeg = Number.isFinite(Number(cfg.polylineGranularityDeg))
            ? Number(cfg.polylineGranularityDeg)
            : 0.1;
        const gran = Cesium.Math.toRadians(Math.max(0.01, Math.min(2, granDeg)));

        entities.forEach(function (ent) {
            try {
                if (ent.polyline) {
                    if (ent.polyline.arcType === undefined) {
                        ent.polyline.arcType = Cesium.ArcType.GEODESIC;
                    }
                    if (ent.polyline.granularity === undefined) {
                        ent.polyline.granularity = gran;
                    }
                    if (ent.polyline.clampToGround && Cesium.ClassificationType && ent.polyline.classificationType === undefined) {
                        ent.polyline.classificationType = Cesium.ClassificationType.BOTH;
                    }
                }
                if (ent.polygon && Cesium.ClassificationType && ent.polygon.classificationType === undefined) {
                    ent.polygon.classificationType = Cesium.ClassificationType.BOTH;
                }
                if (ent.point && cfg.vectorPointsAlwaysOnTop && ent.point.disableDepthTestDistance === undefined) {
                    ent.point.disableDepthTestDistance = Number.POSITIVE_INFINITY;
                }
            } catch (e) {
                /* ignore per-entity */
            }
        });
    }

    /**
     * Re-apply after Control Center / jsonConfig runtime updates (viewer + all tilesets).
     */
    function applyFromMergedConfig() {
        const tv = window.tilesetViewer;
        const viewer = tv && tv.viewer;
        if (!viewer || !viewer.scene) return;
        applyPresentation(viewer);
        applyToAllTilesetsInScene(viewer.scene);
        viewer.scene.requestRender?.();
    }

    window.layerRenderingQuality = {
        applyPresentation,
        applyToTileset,
        applyToAllTilesetsInScene,
        refineLayerEntities,
        getLayerRenderingConfig,
        applyFromMergedConfig
    };
})();
