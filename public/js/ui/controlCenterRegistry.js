/**
 * Control Center — labels and grouping for map tools, scene modes, and analysis.
 * Keeps UI copy aligned with smart3dToolbarWireup / index.html DOM ids.
 */
(function () {
    'use strict';

    const SCENE_MODE_META = {
        transparency: { label: 'Transparency', hint: 'Overlay alpha on tiles' },
        fog: { label: 'Fog', hint: 'Atmospheric fog density & floor brightness' },
        white: { label: 'White model', hint: 'Flat shading' },
        slope: { label: 'Slope shading', hint: 'Terrain slope colors' },
        height: { label: 'Height coloring', hint: 'By elevation' },
        distance: { label: 'Depth map', hint: 'Camera-distance visualization' },
        direction: { label: 'Direction / aspect', hint: 'Surface aspect' },
        snow: { label: 'Snow', hint: 'Snow effect (toolbar; fog density in SceneModes.snow)' },
        rain: { label: 'Rain', hint: 'Rain fog defaults (Display Modes weather; SceneModes.rain)' },
        clouds: { label: 'Clouds', hint: 'Cloud effect' },
        ortho: { label: 'Orthographic', hint: 'Ortho camera width factor' },
        remapColors: { label: 'Thematic colors', hint: 'Remap by height divisor' }
    };

    const ANALYSIS_META = [
        { tKey: 'Measure', label: 'Measure', hint: 'Ion / toolbar measure tools (#measure)' },
        { tKey: 'LOS', label: 'Line of sight', hint: 'LOS analysis (#lineofsight)' },
        { tKey: 'Viewshed', label: 'Viewshed', hint: 'Visibility / view range (#viewshed)' }
    ];

    /** Groups match the map toolbar strip in index.html */
    const MAP_TOOL_GROUPS = [
        {
            id: 'nav',
            label: 'Navigation & camera',
            tools: [
                { tKey: 'layersIC', label: 'Layers menu', domId: 'layersIC' },
                { tKey: 'view_home', label: 'Home view', domId: 'view_home' },
                { tKey: 'history', label: 'History (prev / next)', domId: 'gotoPrevView' },
                { tKey: 'navNorth', label: 'Rotate to north', domId: 'navNorth' },
                { tKey: 'topView', label: 'Top view', domId: 'topView' }
            ]
        },
        {
            id: 'capture',
            label: 'Capture & share',
            tools: [
                { tKey: 'share', label: 'Share location', domId: 'share' },
                { tKey: 'printscreen', label: 'Screenshot', domId: 'printscreen' }
            ]
        },
        {
            id: 'scene',
            label: 'Scene tools',
            tools: [
                { tKey: 'streetview', label: 'Street view', domId: 'streetview' },
                { tKey: 'flightmode', label: 'Flight mode', domId: 'flightmode' },
                { tKey: 'clipplane', label: 'Clip by polygon', domId: 'clipplane' },
                { tKey: 'split', label: 'Split screen', domId: 'split' }
            ]
        },
        {
            id: 'analysis',
            label: 'Measurement strip',
            tools: [
                { tKey: 'elevationProfile', label: 'Elevation profile', domId: 'elevationProfileButton' }
            ]
        },
        {
            id: 'display',
            label: 'Display',
            tools: [{ tKey: 'special_effects', label: 'Display modes', domId: 'special_effects' }]
        }
    ];

    /** Control Center button is not listed — hiding it can lock you out of these settings. */
    const NAV_CHROME_IDS = [
        { id: 'navigationHelpBtn', configKey: 'showNavigationHelp', label: 'Navigation help' },
        { id: 'databaseBtn', configKey: 'showDatabase', label: 'Database' },
        { id: 'dashboardBtn', configKey: 'showDashboard', label: 'Dashboard' },
        { id: 'directionsBtn', configKey: 'showDirections', label: 'Directions' },
        { id: 'helpBtn', configKey: 'showHelp', label: 'Help' }
    ];

    /**
     * Maps `tools.items[].action` (nested toolbar / catalog) to `modules.*` runtime gate keys.
     * Used to keep the tool catalog and module init flags aligned when saving.
     */
    const TOOL_ACTION_TO_MODULE = {
        search: 'searchManager',
        modelsMap: 'modelsMapManager',
        share: 'shareLocationManager',
        layers: 'layersMenuManager',
        shadeAnalysis: 'shadeAnalysisManager',
        splitScreen: 'splitScreenManager',
        streetView: 'streetViewManager',
        lineOfSight: 'lineOfSightManager',
        visibleHidden: 'visibleHiddenAreasManager',
        cutPolygon: 'cutByPolygonManager',
        displayModes: 'displayModesManager',
        flightMode: 'supermanFlightModeManager',
        obliqueViews: 'obliqueViewsManager',
        modelUpload: 'modelAndLayerUploadManager',
        mapLabels: 'labelManager',
        screenshot: 'screenshotManager',
        bookmarks: 'bookmarkManager',
        measure: 'enhancedMeasurementManager'
    };

    const MODULE_LABELS = {
        searchManager: 'Search',
        modelsMapManager: 'Models map',
        shareLocationManager: 'Share location',
        layersMenuManager: 'Layers menu',
        shadeAnalysisManager: 'Shade analysis',
        coordinateResearchManager: 'Coordinate research',
        splitScreenManager: 'Split screen',
        streetViewManager: 'Street view',
        simVisualToolsBridge: 'SIM visual / sensors',
        simIntegrationManager: 'SIM integration',
        projectManager: 'GIS project',
        geoprocessingUI: 'Geoprocessing',
        offlineStatusUI: 'Offline status',
        tileInspectorUI: 'Tile inspector',
        bookmarkManager: 'Bookmarks',
        screenshotManager: 'Screenshot',
        enhancedMeasurementManager: 'Measurement',
        lineOfSightManager: 'Line of sight',
        visibleHiddenAreasManager: 'View range',
        cutByPolygonManager: 'Cut by polygon',
        displayModesManager: 'Display modes',
        supermanFlightModeManager: 'Flight mode',
        obliqueViewsManager: 'Oblique views',
        modelAndLayerUploadManager: 'Model & layer upload',
        coordinateManager: 'Coordinates',
        featureInteractionManager: 'Feature interaction',
        labelManager: 'Map labels (offline)'
    };

    /** Workspace tab: grouped checkboxes for runtime module init */
    const MODULE_INIT_GROUPS = [
        {
            id: 'discovery',
            label: 'Search, layers & coordinates',
            keys: [
                'searchManager',
                'modelsMapManager',
                'shareLocationManager',
                'layersMenuManager',
                'coordinateResearchManager',
                'coordinateManager',
                'labelManager'
            ]
        },
        {
            id: 'viz',
            label: 'Visualization & camera modes',
            keys: [
                'shadeAnalysisManager',
                'splitScreenManager',
                'streetViewManager',
                'displayModesManager',
                'supermanFlightModeManager',
                'obliqueViewsManager'
            ]
        },
        {
            id: 'analysis',
            label: 'Analysis & editing',
            keys: [
                'enhancedMeasurementManager',
                'lineOfSightManager',
                'visibleHiddenAreasManager',
                'cutByPolygonManager',
                'featureInteractionManager'
            ]
        },
        {
            id: 'gis',
            label: 'GIS & data',
            keys: ['projectManager', 'geoprocessingUI', 'offlineStatusUI', 'modelAndLayerUploadManager']
        },
        {
            id: 'sim',
            label: 'SIM',
            keys: ['simVisualToolsBridge', 'simIntegrationManager']
        },
        {
            id: 'utilities',
            label: 'Utilities',
            keys: ['tileInspectorUI', 'bookmarkManager', 'screenshotManager']
        }
    ];

    window.controlCenterRegistry = {
        SCENE_MODE_META,
        ANALYSIS_META,
        MAP_TOOL_GROUPS,
        NAV_CHROME_IDS,
        TOOL_ACTION_TO_MODULE,
        MODULE_LABELS,
        MODULE_INIT_GROUPS
    };
})();
