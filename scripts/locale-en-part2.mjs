/**
 * SimplexDM English locale — Part 2 (registry, Control Center)
 * Source module consumed by `scripts/emit-locale.mjs`.
 */
export default {
  "registry": {
    "sceneModes": {
      "transparency": {
        "label": "Transparency",
        "hint": "Overlay alpha on tiles"
      },
      "fog": {
        "label": "Fog",
        "hint": "Atmospheric fog density & floor brightness"
      },
      "white": {
        "label": "White model",
        "hint": "Flat shading"
      },
      "slope": {
        "label": "Slope shading",
        "hint": "Terrain slope colors"
      },
      "height": {
        "label": "Height coloring",
        "hint": "By elevation"
      },
      "distance": {
        "label": "Depth map",
        "hint": "Camera-distance visualization"
      },
      "direction": {
        "label": "Direction / aspect",
        "hint": "Surface aspect"
      },
      "snow": {
        "label": "Snow",
        "hint": "Snow effect"
      },
      "clouds": {
        "label": "Clouds",
        "hint": "Cloud effect"
      },
      "ortho": {
        "label": "Orthographic",
        "hint": "Ortho camera width factor"
      },
      "remapColors": {
        "label": "Thematic colors",
        "hint": "Remap by height divisor"
      }
    },
    "analysis": {
      "Measure": {
        "label": "Measure",
        "hint": "Ion / toolbar measure tools (#measure)"
      },
      "LOS": {
        "label": "Line of sight",
        "hint": "LOS analysis (#lineofsight)"
      },
      "Viewshed": {
        "label": "Viewshed",
        "hint": "Visibility / view range (#viewshed)"
      }
    },
    "mapGroups": {
      "nav": {
        "label": "Navigation & camera"
      },
      "capture": {
        "label": "Capture & share"
      },
      "scene": {
        "label": "Scene tools"
      },
      "analysis": {
        "label": "Measurement strip"
      },
      "display": {
        "label": "Display"
      }
    },
    "mapTools": {
      "layersIC": {
        "label": "Layers menu"
      },
      "view_home": {
        "label": "Home view"
      },
      "history": {
        "label": "History (prev / next)"
      },
      "navNorth": {
        "label": "Rotate to north"
      },
      "topView": {
        "label": "Top view"
      },
      "share": {
        "label": "Share location"
      },
      "printscreen": {
        "label": "Screenshot"
      },
      "streetview": {
        "label": "Street view"
      },
      "flightmode": {
        "label": "Flight mode"
      },
      "clipplane": {
        "label": "Clip by polygon"
      },
      "split": {
        "label": "Split screen"
      },
      "elevationProfile": {
        "label": "Elevation profile"
      },
      "special_effects": {
        "label": "Display modes"
      }
    },
    "chrome": {
      "showNavigationHelp": "Navigation help",
      "showDatabase": "Database",
      "showDashboard": "Dashboard",
      "showDirections": "Directions",
      "showHelp": "Help"
    },
    "modules": {
      "searchManager": "Search",
      "modelsMapManager": "Models map",
      "shareLocationManager": "Share location",
      "layersMenuManager": "Layers menu",
      "shadeAnalysisManager": "Shade analysis",
      "coordinateResearchManager": "Coordinate research",
      "splitScreenManager": "Split screen",
      "streetViewManager": "Street view",
      "simVisualToolsBridge": "SIM visual / sensors",
      "simIntegrationManager": "SIM integration",
      "projectManager": "GIS project",
      "geoprocessingUI": "Geoprocessing",
      "offlineStatusUI": "Offline status",
      "tileInspectorUI": "Tile inspector",
      "bookmarkManager": "Bookmarks",
      "screenshotManager": "Screenshot",
      "enhancedMeasurementManager": "Measurement",
      "lineOfSightManager": "Line of sight",
      "visibleHiddenAreasManager": "View range",
      "cutByPolygonManager": "Cut by polygon",
      "displayModesManager": "Display modes",
      "supermanFlightModeManager": "Flight mode",
      "obliqueViewsManager": "Oblique views",
      "modelAndLayerUploadManager": "Model & layer upload",
      "coordinateManager": "Coordinates",
      "featureInteractionManager": "Feature interaction",
      "labelManager": "Map labels (offline)"
    },
    "modGroups": {
      "discovery": {
        "label": "Search, layers & coordinates"
      },
      "viz": {
        "label": "Visualization & camera modes"
      },
      "analysis": {
        "label": "Analysis & editing"
      },
      "gis": {
        "label": "GIS & data"
      },
      "sim": {
        "label": "SIM"
      },
      "utilities": {
        "label": "Utilities"
      }
    }
  },
  "cc": {
    "perf": {
      "lead": "Throughput and main-thread budgets. Values are clamped; they map to <code>performance</code> in app config and <code>window.__simplexPerformance</code>.",
      "frameBudget": "Render loop frame budget (ms)",
      "idleTimeout": "Idle callback timeout (ms)",
      "yield": "Deferred init yield (ms)",
      "maxReq": "Max requests per server",
      "resScale": "Viewer resolution scale max",
      "default": "default:",
      "browserRes": "Use browser recommended resolution (softer on HiDPI)",
      "subhead3d": "3D Tiles / mesh detail",
      "tileHint": "Maps to <code>layerRendering</code> in app config (saved with Control Center). <strong>Lower</strong> max SSE = sharper geometry and clearer grids; watch FPS. <strong>Higher</strong> (e.g. 12–16) = faster on weaker GPUs. Typical range 2–8.",
      "tileSse": "Tileset max screen-space error (cap)",
      "dynamicSse": "Dynamic screen-space error on tilesets (when supported)",
      "lrEnable": "Enable layer / tileset quality adjustments"
    },
    "features": {
      "heroLead": "Configure the app catalog, feature flags, layer defaults, UI theme, and which top-bar actions are visible. Saving applies through <code>AppSettingsFramework</code> and refreshes the map toolbar.",
      "toolCatalogSummary": "Tool catalog <span class=\"cc-tag\">tools.items</span>",
      "toolCatalogHint": "Controls which entries are available to the nested toolbar / app event bus.",
      "masterCatalog": "Master: enable tool catalog",
      "tableId": "Id",
      "tableLabel": "Label",
      "tableOn": "On",
      "featureModules": "Feature modules",
      "measurement": "Measurement",
      "accuracyM": "Accuracy (m)",
      "requireZoom": "Require zoom",
      "navigation": "Navigation",
      "cameraHistorySize": "Camera history size",
      "autoSaveHistory": "Auto-save camera history",
      "layersMenuFeature": "Layers menu feature",
      "collaborationSummary": "Collaboration <span class=\"cc-tag\">features.collaboration</span>",
      "collabEnable": "Enable collaboration hooks (bookmarks / annotations when module is loaded)",
      "backendUrl": "Backend base URL",
      "collabHint": "Health check uses <code>GET {baseUrl}/health</code>. The collaboration script is optional in the main bundle.",
      "runtimeModulesSummary": "Runtime module initialization <span class=\"cc-tag\">modules</span>",
      "runtimeModulesHint": "When off, that manager’s <code>init()</code> is skipped on the next load. The map toolbar wireup always runs. Saving also syncs matching <strong>tool catalog</strong> rows. Reload after changing modules.",
      "layerDefaultsSummary": "Layer defaults <span class=\"cc-tag\">features.layers</span>",
      "layerDefaultsHint": "Comma-separated layer ids (e.g. <code>background, 3d, streets</code>). Used when the layers menu initializes.",
      "defaultVisible": "Default visible",
      "defaultHidden": "Default hidden",
      "appearanceSummary": "Appearance & layout defaults",
      "theme": "Theme",
      "themeDark": "dark",
      "themeLight": "light",
      "languageCode": "Language code",
      "langPlaceholder": "en or ar",
      "langTitle": "en = English, ar = Arabic (RTL)",
      "langHint": "<code>en</code> English · <code>ar</code> العربية (layout switches to RTL)",
      "placeholderApi": "https://api.example.com",
      "placeholderLayersVis": "background, 3d",
      "placeholderLayersHid": "streets, parcels, …",
      "sbLeftCollapsed": "Left sidebar starts collapsed",
      "sbRightCollapsed": "Right sidebar starts collapsed",
      "toolsStripCollapsed": "Minimize bottom map tool strip on load",
      "topNavSummary": "Top navigation visibility <span class=\"cc-tag\">ui.chrome</span>",
      "qualityLow": "low",
      "qualityMedium": "medium",
      "qualityHigh": "high",
      "qualityUltra": "ultra",
      "langOptionEn": "English",
      "langOptionAr": "Arabic (العربية)"
    },
    "scene": {
      "heroLead": "Controls visibility and “PRO” gating for the sub-toolbar, analysis buttons, and the map tool strip. Matches <code>smart3dToolbarWireup.applyConfigVisibility</code>.",
      "analysisSummary": "Analysis tools <span class=\"cc-tag\">Measure · LOS · Viewshed</span>",
      "sceneModesSummary": "Scene modes <span class=\"cc-tag\">toolbarSE</span>",
      "mapStripSummary": "Map tool strip <span class=\"cc-tag\">#toolbar · .tools</span>",
      "jsonPreview": "JSON preview",
      "show": "Show",
      "active": "Active",
      "on": "On",
      "alpha": "α",
      "density": "density",
      "minBrightness": "min brightness",
      "heightDiv": "height÷",
      "widthFactor": "width factor",
      "gridSamples": "Grid samples",
      "imageryBrightness": "Imagery brightness",
      "imageryContrast": "Imagery contrast",
      "sceneTuningSummary": "Scene & imagery tuning",
      "thresholdDeg1": "Gentle threshold (°)",
      "thresholdDeg2": "Moderate threshold (°)",
      "thresholdDeg3": "Steep threshold (°)"
    },
    "project": {
      "notLoaded": "Project index not loaded. Ensure <code>projectIntegrationIndex.js</code> is included before Control Center.",
      "heroCountLine": "<strong>{count}</strong> first-party scripts under <code>public/js</code> (vendor excluded). ",
      "heroLead": "Each row shows how the module ties into Control Center, <code>jsonConfigManager</code>, <code>window.t</code>, or browser storage.",
      "storageKeysSummary": "Registered storage keys <span class=\"cc-tag\">AppSettingsFramework</span>",
      "thKey": "Key",
      "thCategory": "Category",
      "thRole": "Role",
      "htmlEntrySummary": "HTML, CSS, server & config entrypoints",
      "thPath": "Path",
      "thType": "Type",
      "thSettingsLink": "Settings link",
      "allJsSummary": "All first-party JavaScript modules",
      "thArea": "Area",
      "thIntegration": "Integration"
    },
    "local": {
      "mapLabelsSummary": "Offline map labels <span class=\"cc-tag\">SQLite · .rlp</span>",
      "mapLabelsEnable": "Show map labels on the globe",
      "mapLabelsHint": "Configure types, language, and region packs in the left sidebar under “Map labels”. Data is queried in the desktop app via Electron.",
      "mapLabelsOpenPanel": "Open labels panel in sidebar",
      "dashPrefs": "Dashboard / app prefs (<code>appSettings</code>)",
      "dataDir": "Data directory",
      "autoLoad": "Auto-load tilesets on startup",
      "notify": "Show notifications",
      "autoPath": "Auto-save paths",
      "defaultQuality": "Default quality",
      "memMb": "Memory limit (MB)",
      "platformHdr": "Platform controls",
      "site": "Site accessible",
      "land": "Land use",
      "sunLocal": "Sun position (local)",
      "simHdr": "SIM sensor (Ion SDK)",
      "radius": "Radius",
      "xHalf": "X half-angle °",
      "yHalf": "Y half-angle °",
      "lon": "Lon",
      "lat": "Lat",
      "height": "Height"
    },
    "save": {
      "allSaved": "All settings saved (runtime)",
      "resetRuntimeConfirm": "Clear Control Center runtime overrides? Toolbar/app JSON files are unchanged. Reload recommended.",
      "resetRuntimeInfo": "Runtime overrides cleared. Reload the page to apply defaults from disk.",
      "resetAllConfirm": "Clear runtime overrides AND reset appSettings, platform controls, and SIM sensor stored prefs?",
      "resetAllInfo": "Local preference keys cleared. Reload the page.",
      "importFullOk": "Full snapshot imported. Reload if anything looks stale.",
      "importOk": "Imported. Some changes apply fully after reload.",
      "invalidJson": "Invalid JSON: "
    }
  }
};
