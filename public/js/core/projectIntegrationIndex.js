/**
 * Complete inventory of first-party sources under public/js (excludes vendor/*)
 * plus key non-JS entrypoints. Used by Control Center → Project tab.
 */
(function () {
    'use strict';

    const FILE_PATHS = [
        'js/simplexThemeSync.js',
        'js/app.js',
        'js/core/advancedTileLoading.js',
        'js/core/appI18n.js',
        'js/core/appI18n.locale-ar.js',
        'js/core/appI18n.locale-en.js',
        'js/core/appSettingsFramework.js',
        'js/core/b3dmFeatureExtractor.js',
        'js/core/controlGovernance.js',
        'js/core/fileEditor.js',
        'js/core/fileManager.js',
        'js/core/jsonConfigManager.js',
        'js/core/moduleRuntimeGate.js',
        'js/core/pathManager.js',
        'js/core/projectIntegrationIndex.js',
        'js/core/renderLoopManager.js',
        'js/core/smart3dI18n.js',
        'js/core/tilesetProcessor.js',
        'js/core/tilesetViewer.js',
        'js/core/toolManager.js',
        'js/core/unitHelpers.js',
        'js/core/webGisBridge.js',
        'js/features/bookmarkManager.js',
        'js/features/collaborationManager.js',
        'js/features/directionsManager.js',
        'js/features/coordinateManager.js',
        'js/features/coordinateResearchManager.js',
        'js/features/cutByPolygonManager.js',
        'js/features/dataLayerIntegration.js',
        'js/features/displayControl.js',
        'js/features/displayModesManager.js',
        'js/features/enhancedMeasurementManager.js',
        'js/features/featureInteractionManager.js',
        'js/features/featureManager.js',
        'js/features/jsonTree.js',
        'js/features/layersMenuManager.js',
        'js/features/lineOfSightManager.js',
        'js/features/mapCompassManager.js',
        'js/features/metadata.js',
        'js/features/modelAndLayerUploadManager.js',
        'js/features/modelsMapManager.js',
        'js/features/obliqueViewsManager.js',
        'js/features/regions.js',
        'js/features/screenshotManager.js',
        'js/features/searchManager.js',
        'js/features/shadeAnalysisManager.js',
        'js/features/shareLocationManager.js',
        'js/features/simIntegrationManager.js',
        'js/features/simVisualToolsBridge.js',
        'js/features/splitScreenManager.js',
        'js/features/streetViewManager.js',
        'js/features/supermanFlightModeManager.js',
        'js/features/tileInspector.js',
        'js/features/tileHierarchyLayersOverlay.js',
        'js/features/tilePositioning.js',
        'js/features/visibleHiddenAreasManager.js',
        'js/features/vshd.js',
        'js/gis/editingManager.js',
        'js/gis/geoprocessingUI.js',
        'js/gis/labelCollisionEngine.js',
        'js/gis/labelManager.js',
        'js/gis/labelQueryService.js',
        'js/gis/layerRenderingQuality.js',
        'js/gis/layerRuntime.js',
        'js/gis/layerStore.js',
        'js/gis/offlineStatusUI.js',
        'js/gis/offlineVectorTileProvider.js',
        'js/gis/projectManager.js',
        'js/gis/rasterSamplingManager.js',
        'js/navigation/navigationManager.js',
        'js/siteContentAdmin.js',
        'js/siteContentClient.js',
        'js/tools/viewControls.js',
        'js/ui/comprehensiveSettingsUI.js',
        'js/ui/controlCenterRegistry.js',
        'js/ui/dashboardUI.js',
        'js/ui/databaseUI.js',
        'js/ui/displayControlUI.js',
        'js/ui/featureManagerUI.js',
        'js/ui/floatingControlsUI.js',
        'js/ui/frontendIntegration.js',
        'js/ui/helpUI.js',
        'js/ui/ionSdkToolsFacade.js',
        'js/ui/labelManagerUI.js',
        'js/ui/navigationHelpUI.js',
        'js/ui/offlineRasterSourceUI.js',
        'js/ui/pathInputUI.js',
        'js/ui/platformControlsUI.js',
        'js/ui/regionsManagerUI.js',
        'js/ui/sceneModesParameterPanel.js',
        'js/ui/smart3dToolbarWireup.js',
        'js/ui/tileInspectorUI.js',
        'js/ui/toolbarManager.js',
        'js/ui/uiLayerStack.js',
        'js/ui/viewRangeToolbarInject.js',
        'js/utils/cesiumCanvasPointer.js',
        'js/utils/coordinateConverter.js',
        'js/utils/errorHandler.js',
        'js/utils/featurePickingUtils.js',
        'js/utils/fileHandleRegistry.js',
        'js/utils/initializationManager.js',
        'js/utils/inputValidator.js',
        'js/utils/logger.js',
        'js/utils/nestedToolbarManager.js',
        'js/utils/notification.js',
        'js/utils/pathResolver.js',
        'js/utils/safePickPosition.js',
        'js/utils/simUtils.js',
        'js/utils/tilesetDatabase.js'
    ];

    const EXTRA_SOURCES = [
        {
            path: 'index.html',
            category: 'html',
            role: 'Main viewer shell: nav, sidebars, Cesium host, toolbars, Control Center modal',
            integration: 'Loads script graph; Control Center + Dashboard modals'
        },
        {
            path: 'landing.html',
            category: 'html',
            role: 'Marketing / entry route',
            integration: 'No app settings'
        },
        {
            path: 'admin.html',
            category: 'html',
            role: 'Admin / site content',
            integration: 'Separate from viewer settings'
        },
        {
            path: 'css/main.css',
            category: 'style',
            role: 'Global layout, Control Center, dock UI',
            integration: 'Theming via body classes; pair with ui.theme in config'
        },
        {
            path: 'data/config/app-config.json',
            category: 'config',
            role: 'Default app JSON merged with runtime overrides',
            integration: 'jsonConfigManager.loadDefaultConfig'
        },
        {
            path: 'server/server.js',
            category: 'server',
            role: 'Node static/tile server (Electron or npm start:server)',
            integration: 'Not in Control Center; host/port via env/process'
        }
    ];

    function integrationFor(path) {
        const p = path.toLowerCase();
        if (p.includes('moduleruntimegate.js'))
            return 'modules.* enabled flags; gates feature manager init() with jsonConfigManager.getModuleConfig';
        if (p.includes('jsonconfigmanager.js'))
            return 'Authoritative app config, window.t, runtime LS key simplex_runtime_overrides_v1';
        if (p.includes('appsettingsframework.js'))
            return 'Apply hooks, chrome, toolbar refresh, full export/import';
        if (p.includes('comprehensivesettingsui.js') || p.includes('controlcenterregistry.js'))
            return 'Control Center UI + labels/tool mapping';
        if (p.includes('pathmanager.js')) return 'Paths: IndexedDB; fallback localStorage meridian_paths';
        if (p.includes('bookmarkmanager.js')) return 'localStorage simplex_bookmarks_v1';
        if (p.includes('featuremanager.js')) return 'localStorage simplex_features_v1';
        if (p.includes('modelandlayeruploadmanager.js'))
            return 'localStorage uploadedModels / uploadedLayers';
        if (p.includes('simvisualtoolsbridge.js')) return 'localStorage simSensorConfig + Ion SDK';
        if (p.includes('platformcontrolsui.js')) return 'localStorage platformControlsSettings + ui';
        if (p.includes('displaycontrol.js')) return 'appSettings defaultQuality; tileset load options';
        if (p.includes('dashboardui.js')) return 'appSettings; paths/files UI';
        if (p.includes('smart3dtoolbarwireup.js')) return 'window.t Tools/SceneModes; toolbar visibility';
        if (p.includes('layersmenumanager.js')) return 'jsonConfig.features.layers; layers modal';
        if (p.includes('renderloopmanager.js')) return 'jsonConfig.performance frame budget';
        if (p.includes('tilesetviewer.js')) return 'jsonConfig.performance + Cesium viewer';
        if (p.includes('frontendintegration.js')) return 'Wires buttons; listens app events';
        if (p.includes('navigationmanager.js')) return 'Camera history; browse toolbar';
        if (p.includes('toolmanager.js')) return 'Exclusive measure/LOS/viewshed tools';
        if (p.startsWith('js/features/')) return 'Feature module: toolbar / events / jsonConfig.features as applicable';
        if (p.startsWith('js/ui/')) return 'UI layer: DOM + managers; many read globals & appSettings';
        if (p.startsWith('js/utils/')) return 'Utilities; indirect via callers';
        if (p.startsWith('js/gis/')) return 'GIS stack; layerStore / projectManager';
        if (p.startsWith('js/core/')) return 'Core pipeline; tileset, files, performance hooks';
        if (p === 'js/app.js') return 'Shell: status bar, coordinates, integrates app singleton';
        return 'Loaded from index.html; globals and custom events';
    }

    function categoryOf(path) {
        const p = path.replace(/^js\//, '');
        if (!p.includes('/')) return p === 'app.js' ? 'app' : 'root';
        return p.split('/')[0];
    }

    function roleFor(path) {
        const cat = categoryOf(path);
        const map = {
            app: 'Application coordinator',
            core: 'Core engine — viewer, IO, performance, tile pipeline',
            features: 'Product features — tools, analysis, regions, SIM',
            ui: 'Presentation — modals, panels, toolbar wiring',
            utils: 'Shared helpers — paths, errors, math, init',
            gis: 'GIS — layers, editing, offline, geoprocessing',
            navigation: 'Navigation — history, camera, keyboard',
            tools: 'Small tool adapters',
            root: 'Root scripts'
        };
        return map[cat] || 'Application script';
    }

    const files = FILE_PATHS.map((path) => ({
        path,
        category: categoryOf(path),
        role: roleFor(path),
        integration: integrationFor(path)
    }));

    window.projectIntegrationIndex = {
        version: 1,
        firstPartyScriptCount: files.length,
        files,
        extraSources: EXTRA_SOURCES,
        note:
            'Vendor (e.g. js/vendor/knockout, lib/cesium) excluded. Settings surface: Control Center, Dashboard, AppSettingsFramework.getKnownKeys().'
    };
})();
