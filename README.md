# SimplexDM - Complete Project Documentation

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Installation & Setup](#installation--setup)
4. [Architecture](#architecture)
5. [Usage Guide](#usage-guide)
6. [Configuration](#configuration)
7. [Development Guide](#development-guide) — includes [offline map labels](#offline-map-labels-data-pipeline)
8. [Building & Distribution](#building--distribution)
9. [API Reference](#api-reference)
10. [Troubleshooting](#troubleshooting)
11. [Contributing](#contributing)
12. [License](#license)

---

## Overview

**SimplexDM** is a professional desktop application for viewing, analyzing, and managing 3D Tiles (Cesium 3D Tiles) data. Built with Electron and CesiumJS, it provides a comprehensive platform for visualizing high-resolution 3D reality models with advanced geospatial analysis tools.

### Key Capabilities

- **3D Tiles Visualization**: Load and view Cesium 3D Tiles (.b3dm, .i3dm, .pnts, .cmpt)
- **Offline Operation**: Fully functional offline mode with local map tiles
- **Offline Map Labels** (desktop): Place-name labels from local SQLite (`data/labels-world-base.db`) and optional regional packs (`.rlp`), queried via Electron IPC
- **Advanced Analysis**: Measurement, line-of-sight, shade analysis, and more
- **Data Management**: Import, manage, and analyze geospatial data layers
- **Collaboration**: Share locations, bookmarks, and collaborate on projects
- **Professional Tools**: Comprehensive measurement, annotation, and analysis tools

### Technology Stack

- **Framework**: Electron 40.0+
- **3D Engine**: CesiumJS 1.137.0
- **Runtime**: Node.js 16.0+
- **Build Tool**: electron-builder, webpack (bundled renderer)
- **Native addon**: `better-sqlite3` (main process, labels + GIS)
- **Platforms**: Windows, macOS, Linux

---

## Features

### Core Features

#### 1. **3D Tiles Viewer**
- Load and visualize Cesium 3D Tiles formats (.b3dm, .i3dm, .pnts, .cmpt)
- Support for hierarchical tilesets with automatic LOD (Level of Detail)
- Advanced tile loading strategies (LRU cache, priority loading, horizon culling)
- Network optimization and performance monitoring
- Tile inspector and debug tools

#### 2. **Offline Maps**
- Download and cache OpenStreetMap tiles for offline use
- Automatic fallback to online tiles when offline tiles unavailable
- Configurable zoom levels and regions
- Support for raster (PNG) and vector tiles

#### 2b. **Offline Map Labels** (Electron)
- **Left sidebar → Map labels (offline)**: toggle visibility, label types, language (native / English / Arabic), import `.rlp` region packs
- **Control Center → Local**: shortcut to open the labels panel; master “show labels” syncs with the sidebar
- **Runtime module** `labelManager`: disable under Control Center → Features → runtime modules to hide the sidebar block and skip initialization (after save / `jsonConfigUpdated`)
- **Data**: optional shipped `data/labels-world-base.db`; extra detail via user-installed packs in `%APPDATA%`-style `label-data` (see development section)

#### 3. **Navigation & Camera Controls**
- Smooth camera navigation (orbit, pan, zoom)
- Navigation history with undo/redo
- Bookmark system for saving camera positions
- Flight mode for animated camera movements
- Superman flight mode for free-form navigation
- Street view mode for ground-level exploration

#### 4. **Measurement Tools**
- **Distance Measurement**: Point-to-point distance with 3D coordinates
- **Area Measurement**: Polygon area calculation
- **Height Measurement**: Vertical distance measurements
- **Plane/Surface Measurement**: Surface area calculations
- **Ruler Tool**: Quick distance measurements
- High accuracy (10cm precision)

#### 5. **Analysis Tools**

##### Line of Sight
- Calculate visibility between two points
- Visualize line-of-sight analysis
- Obstruction detection

##### Shade Analysis
- Sun path simulation
- Shadow casting and analysis
- Time-based shadow visualization
- Solar position calculations

##### Visible/Hidden Areas
- Calculate visible and hidden areas from a viewpoint
- Visualize visibility zones
- Coverage analysis

#### 6. **Data Management**

##### Regions Management
- Discover and manage geographic regions
- Region-based navigation
- Region metadata and properties

##### Layers Management
- Multiple data layer support
- Toggle visibility of layers
- Layer ordering and organization
- Import custom data layers

##### Models & Layers Upload
- Upload 3D models (GLTF/GLB)
- Import custom data layers
- Real-time integration

#### 7. **Display Modes**
- Multiple visualization modes
- Display control and customization
- Tileset positioning and transformation
- Split screen for comparison views
- Oblique views for angled perspectives

#### 8. **Editing & Cutting Tools**

##### Cut by Polygon
- Define polygon boundaries
- Cut tilesets by polygon regions
- Extract specific areas

##### Split Screen
- Side-by-side comparison
- Synchronized or independent views
- Compare different time periods or scenarios

#### 9. **Search & Location**

##### Search Manager
- Geographic search functionality
- Coordinate-based search
- Location lookup and navigation

##### Coordinate Management
- Multiple coordinate system support
- Coordinate conversion (WGS84, UTM, etc.)
- Coordinate research and validation
- Share location functionality

#### 10. **Collaboration Features**
- Share locations with coordinates
- Bookmark sharing
- Collaboration manager for team workflows

#### 11. **Screenshot & Export**
- High-quality screenshot capture
- Export views and analysis results
- Multiple format support

#### 12. **Performance Optimization**
- LRU cache for tiles
- Advanced tile loading strategies
- Network optimization
- Render loop management
- Performance monitoring

### Advanced Features

- **B3DM Feature Extraction**: Extract and analyze features from B3DM tiles
- **JSON Tree Explorer**: Visualize tileset JSON structure
- **Metadata Manager**: View and manage feature metadata
- **Tile Inspector**: Debug and inspect tile properties
- **File Editor**: Edit tileset JSON files
- **Path Manager**: Manage file paths and tileset locations
- **Database Integration**: Tileset metadata database

---

## Installation & Setup

### Prerequisites

- **Node.js**: Version 16.0 or higher
- **npm**: Version 7.0 or higher
- **Python**: Version 3.9+ recommended (offline map tile scripts; **label ETL** for `labels-world-base.db`)
- **Osmium Tool** (optional): required only to **build** `data/labels-world-base.db` from `.osm.pbf` — not needed to run the app if you ship a prebuilt DB (see [Offline map labels](#offline-map-labels-data-pipeline))
- **Operating System**: Windows 10+, macOS 10.13+, or Linux (Ubuntu 18.04+)

### Step 1: Clone or Download the Project

```bash
git clone <repository-url>
cd <project-root>   # e.g. Simplex_
```

### Step 2: Install Dependencies

```bash
npm install
```

This will:
- Install Node.js dependencies (Electron, electron-builder, etc.)
- Run the post-install setup script
- Create required directories

### Step 3: Install CesiumJS Library

CesiumJS must be downloaded and extracted manually due to its large size:

1. **Download CesiumJS**:
   - Version: 1.137.0 (or compatible)
   - Download from: https://github.com/CesiumGS/cesium/releases
   - Or use: `https://github.com/CesiumGS/cesium/releases/download/1.137.0/Cesium-1.137.0.zip`

2. **Extract to Project**:
   ```bash
   # Extract the zip file
   # Copy the contents to: public/lib/cesium/
   # The structure should be:
   # public/lib/cesium/
   #   ├── Cesium.js
   #   ├── Widgets/
   #   ├── Workers/
   #   └── Assets/
   ```

### Step 4: (Optional) Offline label database

If you need **on-globe text labels** from OSM-derived data:

1. Build or obtain `data/labels-world-base.db` (see [Offline map labels](#offline-map-labels-data-pipeline)).
2. `electron-builder` already copies `data/**` into the app payload (see `package.json` → `build.extraFiles`); large DBs increase installer size.

The app runs without this file; labels simply stay empty until data exists or a user imports a `.rlp` pack (desktop only).

### Step 5: (Optional) Download Offline Map Tiles

For offline operation, download map tiles:

```bash
cd data
python map_offline.py
```

When prompted:
- **Tile type**: Choose `2` for Raster (PNG) tiles
- **Bounding box**: Enter `world` for entire world, or specific coordinates
- **Zoom levels**: Enter `0-7` for good balance (~50GB) or `0-5` for smaller size (~200MB)
- **Workers**: Use default (6) or increase for faster downloads

### Step 6: Run the Application

#### Development Mode

```bash
npm run dev
```

or

```bash
npm run electron:dev
```

This starts the application in development mode with DevTools enabled.

#### Production Mode

```bash
npm run electron
```

### Step 7: Verify Installation

1. The application window should open
2. You should see the Meridian interface
3. Check the console for any errors
4. Try loading a tileset to verify functionality

---

## Architecture

### Project Structure

```
<project-root>/
├── electron-main.js          # Electron main process
├── preload.js                # Preload script (IPC bridge)
├── package.json              # Project configuration (includes electron-builder "build" key)
│
├── main/                     # Main-process GIS services (Node)
│   └── gis/
│       ├── registerGisIpc.js # Registers GIS + label IPC
│       └── services/
│           ├── labelDatabaseService.js   # SQLite viewport queries (better-sqlite3)
│           ├── labelRegionImporter.js    # .rlp import (unzipper)
│           └── labelIpcHandlers.js       # gis.labels.* handlers
│
├── public/                   # Frontend application
│   ├── index.html           # Main application HTML
│   ├── landing.html         # Landing page
│   │
│   ├── css/                 # Stylesheets
│   │   ├── main.css        # Main styles
│   │   ├── dashboard.css   # Dashboard styles
│   │   ├── sidebare.css    # Sidebar styles
│   │   └── json-tree.css   # JSON tree styles
│   │
│   ├── js/                  # JavaScript modules
│   │   ├── app.js          # Main application coordinator
│   │   │
│   │   ├── core/           # Core functionality
│   │   │   ├── tilesetViewer.js        # CesiumJS viewer wrapper
│   │   │   ├── tilesetProcessor.js     # Tileset processing
│   │   │   ├── fileManager.js          # File operations
│   │   │   ├── pathManager.js           # Path management
│   │   │   ├── jsonConfigManager.js     # Configuration management
│   │   │   ├── b3dmFeatureExtractor.js  # B3DM parsing
│   │   │   ├── advancedTileLoading.js  # Advanced loading
│   │   │   └── ...
│   │   │
│   │   ├── features/        # Feature modules
│   │   │   ├── searchManager.js         # Search functionality
│   │   │   ├── coordinateManager.js     # Coordinate management
│   │   │   ├── enhancedMeasurementManager.js  # Measurement tools
│   │   │   ├── lineOfSightManager.js    # Line of sight
│   │   │   ├── shadeAnalysisManager.js   # Shade analysis
│   │   │   ├── regions.js               # Regions management
│   │   │   ├── bookmarkManager.js       # Bookmarks
│   │   │   └── ...
│   │   │
│   │   ├── gis/             # GIS + offline labels (renderer)
│   │   │   ├── labelManager.js           # Cesium LabelCollection + IPC refresh
│   │   │   ├── labelQueryService.js      # Camera → viewport for main query
│   │   │   ├── labelCollisionEngine.js   # Screen-space culling
│   │   │   ├── layerRuntime.js           # Vector / layer runtime
│   │   │   └── ...
│   │   │
│   │   ├── ui/              # UI modules
│   │   │   ├── labelManagerUI.js        # Sidebar labels panel
│   │   │   ├── dashboardUI.js           # Dashboard interface
│   │   │   ├── toolbarManager.js        # Toolbar management
│   │   │   ├── navigationHelpUI.js     # Navigation help
│   │   │   └── ...
│   │   │
│   │   ├── utils/           # Utility modules
│   │   │   ├── pathResolver.js         # Path resolution
│   │   │   ├── fileHandleRegistry.js    # File handle management
│   │   │   ├── notification.js          # Notifications
│   │   │   ├── logger.js                # Logging
│   │   │   └── ...
│   │   │
│   │   └── navigation/      # Navigation modules
│   │       └── navigationManager.js    # Camera navigation
│   │
│   └── lib/                 # Third-party libraries
│       ├── cesium/          # CesiumJS library
│       └── fontawesome/     # Font Awesome icons
│
├── server/                   # Local HTTP server
│   └── server.js            # File serving server
│
├── data/                     # Data directory (bundled via electron-builder extraFiles)
│   ├── tiles/               # Offline map tiles
│   ├── labels-world-base.db # Optional: global/coarse label SQLite (see scripts)
│   ├── map_offline.py       # Tile download script
│   └── update_meta.py       # Metadata updater
│
├── scripts/                  # Tooling
│   ├── setup.js             # npm postinstall
│   ├── generate-webpack-entry.js  # Builds webpack-entry.js from index.html script order
│   ├── emit-locale.mjs      # Merges locale parts → appI18n.locale-*.js
│   ├── build_world_labels.py    # ETL: OSM PBF → labels-world-base.db (needs Osmium)
│   └── pack_region.py       # Export bbox from world DB → .rlp (zip: meta.json + data.db)
│
├── build/                    # Build resources
│   └── installer.nsh        # NSIS installer script
│
└── dist/                     # Build output directory
```

### Architecture Overview

#### Main Process (electron-main.js)

The Electron main process handles:
- **Application Lifecycle**: Startup, shutdown, window management
- **HTTP Server**: Starts local server for file serving (required for CesiumJS)
- **IPC Handlers**: Communication bridge between main and renderer processes
- **GIS / offline labels**: SQLite world + region databases (`better-sqlite3`), `.rlp` pack import, IPC `gis.labels.*` (see [Offline map labels](#offline-map-labels-data-pipeline))
- **Security**: Content Security Policy, permission management
- **Window Management**: Creates and manages the main application window

#### Renderer Process (public/index.html + JS modules)

The renderer process contains:
- **UI Layer**: HTML, CSS, and UI components
- **CesiumJS Viewer**: 3D visualization engine
- **Feature Modules**: All application features and tools
- **State Management**: Application state and data management

#### Preload Script (preload.js)

Provides secure IPC bridge:
- Exposes limited Electron API to renderer
- Prevents direct Node.js access for security
- Context isolation enabled

#### Local HTTP Server (server/server.js)

Serves files via HTTP (required by CesiumJS):
- Serves static files from `public/` directory
- Serves tileset files from `data/` directory
- Handles `/file` endpoint for arbitrary file paths
- Case-insensitive path resolution (Windows compatibility)
- CORS headers for local development

### Module System

The application uses a modular architecture:

1. **Core Modules**: Fundamental functionality (viewer, file management)
2. **Feature Modules**: Specific features (measurement, analysis)
3. **UI Modules**: User interface components
4. **Utility Modules**: Shared utilities (logging, notifications)

Modules follow a singleton pattern and are attached to `window` for global access.

### Data Flow

```
User Interaction
    ↓
UI Module
    ↓
Feature Module
    ↓
Core Module (TilesetViewer, FileManager)
    ↓
CesiumJS / File System
    ↓
Response / Update
    ↓
UI Update
```

---

## Usage Guide

### Getting Started

#### 1. Launch the Application

```bash
npm run dev
```

#### 2. Load a Tileset

**Method 1: Using File Dialog**
1. Click the **"Open Tileset"** button in the toolbar
2. Navigate to your tileset JSON file (e.g., `tileset.json`)
3. Select and open the file

**Method 2: Drag and Drop**
1. Drag a tileset JSON file onto the application window
2. The tileset will load automatically

**Method 3: Using Path Input**
1. Open the **Path Input** panel (if available)
2. Enter the path to your tileset JSON file
3. Click **Load**

#### 3. Navigate the 3D View

- **Rotate**: Left-click and drag
- **Pan**: Middle-click and drag (or Ctrl + Left-click)
- **Zoom**: Mouse wheel (or Right-click and drag)
- **Reset View**: Click the home button in the navigation controls

#### 4. Use Tools

Access tools from the toolbar at the top of the application:

- **Measurement Tools**: Click the ruler icon
- **Analysis Tools**: Click analysis icons (line of sight, shade, etc.)
- **Editing Tools**: Click editing icons (cut, upload, etc.)

### Common Tasks

#### Measuring Distance

1. Click the **Measure** tool (ruler icon)
2. Click on the first point in the 3D view
3. Click on the second point
4. Distance and coordinates are displayed

#### Creating a Bookmark

1. Navigate to the desired view
2. Click the **Bookmark** button
3. Enter a name for the bookmark
4. Click **Save**
5. Access bookmarks from the bookmarks menu

#### Searching for a Location

1. Click the **Search** button (or open Search panel)
2. Enter coordinates or location name
3. Click **Search**
4. The view will fly to the location

#### Analyzing Shadows

1. Click the **Shade Analysis** tool
2. Set the date and time
3. Click **Calculate Shadows**
4. Shadows are visualized on the 3D model

#### Cutting by Polygon

1. Click the **Cut by Polygon** tool
2. Click points on the map to define polygon vertices
3. Double-click to complete the polygon
4. The tileset is cut to the polygon boundary

#### Taking a Screenshot

1. Navigate to the desired view
2. Click the **Screenshot** button
3. Choose save location
4. Screenshot is saved

### Keyboard Shortcuts

- **W/A/S/D**: Pan camera
- **Q/E**: Rotate camera
- **R**: Reset view
- **F**: Fit to tileset
- **Space**: Toggle play/pause (for animations)
- **Esc**: Cancel current tool/operation

### Sidebar Panels

#### Left Sidebar: Layers & Regions

- **Layers Menu**: Manage data layers
- **Search**: Search for locations
- **Regions**: Manage geographic regions
- **Map labels (offline)** (when module enabled): Toggle labels, filter types, language, import `.rlp` region packs
- **Quick Actions**: Common actions

#### Right Sidebar: Controls

- **Display Controls**: Tileset display options
- **Measurement Results**: View measurement data
- **Bookmarks**: Manage bookmarks
- **Settings**: Application settings

### Advanced Usage

#### Loading Multiple Tilesets

1. Load the first tileset normally
2. Use **Upload Models & Layers** to add additional tilesets
3. Toggle visibility in the Layers menu

#### Offline Mode

1. Ensure offline tiles are downloaded (see Installation)
2. Disconnect from internet
3. Application automatically uses offline tiles
4. Online tiles used as fallback if offline tiles unavailable

#### Performance Optimization

- Use **Performance Monitor** to track FPS and memory
- Adjust tile loading settings in configuration
- Reduce visible layers for better performance
- Use lower zoom levels for large areas

---

## Configuration

### Application Configuration

Configuration is managed through `jsonConfigManager.js` and can be customized:

#### Default Configuration Location

Configuration files can be placed in:
- `data/config/app-config.json` (application-wide)
- Tileset-specific config files (alongside tileset.json)

#### Configuration Structure

```json
{
  "tools": {
    "measurement": { "enabled": true, "accuracy": 0.1 },
    "navigation": { "enabled": true, "historySize": 50 },
    "layers": { "enabled": true }
  },
  "ui": {
    "sidebars": {
      "left": { "defaultCollapsed": true },
      "right": { "defaultCollapsed": true }
    },
    "theme": "dark",
    "language": "en"
  },
  "performance": {
    "tileCacheSize": 100,
    "maxConcurrentRequests": 6
  },
  "modules": {
    "labelManager": { "enabled": true }
  }
}
```

`modules.labelManager.enabled` controls whether the offline labels sidebar block and runtime manager initialize. After changing config (Control Center save), the UI syncs via `jsonConfigUpdated` without a full reload.

### Server Configuration

Server settings are configured in `electron-main.js`:

- **Port**: Default 8000 (auto-finds available port)
- **Public Directory**: `public/`
- **Data Directory**: `data/`

### Build Configuration

**Canonical** settings are in `package.json` → `"build"` (what `npm run build:win` / `electron-builder` uses): app id, Windows/macOS/Linux targets, `files` (includes `main/**/*`, `preload.js`, bundled `public-bundled/**/*`, `server/**/*`, etc.), and `extraFiles` to ship `data/**` beside the app (optional `data/labels-world-base.db`, tiles exclusions per `filter`).

A separate `electron-builder.json` exists in the repo; keep it in sync with `package.json` if your tooling references it explicitly.

- **App ID**: `com.meridian.viewer`
- **Product Name**: `SimplexDM`
- **Output Directory**: `dist/`

### Environment Variables

- `NODE_ENV`: Set to `development` for dev mode
- `PORT`: Server port (default: 8000)
- `APP_PATH`: Application path (set automatically)
- `IS_PACKAGED`: Whether app is packaged (set automatically)

Label **ETL** (host machine only): `scripts/build_world_labels.py` invokes the `osmium` CLI. Install [osmium-tool](https://osmcode.org/osmium-tool/) and ensure `osmium` is on `PATH` (on Windows, add the install folder to the system or user PATH).

---

## Development Guide

### Development Setup

1. **Clone the repository**
2. **Install dependencies**: `npm install`
3. **Install CesiumJS** (see Installation)
4. **Run in development mode**: `npm run dev`

### Code Structure

#### Adding a New Feature

1. **Create feature module** in `public/js/features/`:
   ```javascript
   class MyFeatureManager {
       constructor(viewer) {
           this.viewer = viewer;
       }
       
       init() {
           // Initialization code
       }
   }
   
   // Export as singleton
   window.myFeatureManager = new MyFeatureManager(window.viewer);
   ```

2. **Register in app.js**:
   ```javascript
   await this.initFeatures();
   // Add your feature initialization
   ```

3. **Add UI** (if needed) in `public/js/ui/`

4. **Add styles** in `public/css/`

#### Module Pattern

All modules follow this pattern:

```javascript
class MyModule {
    constructor(dependencies) {
        // Store dependencies
    }
    
    async init() {
        // Initialize module
    }
    
    // Public methods
}

// Export as singleton
window.myModule = new MyModule(dependencies);
```

### Debugging

#### Development Mode

- DevTools automatically open in development mode
- Console logging available
- Error handling with stack traces

#### Debugging Tips

1. **Check Console**: Most errors logged to console
2. **Network Tab**: Check file requests in DevTools
3. **Performance Tab**: Monitor performance metrics
4. **Cesium Inspector**: Use Cesium's built-in inspector

### Testing

Currently, testing is manual. To add automated tests:

1. Install testing framework (Jest, Mocha, etc.)
2. Create `tests/` directory
3. Write tests for modules
4. Run tests: `npm test`

### Code Style

- **JavaScript**: ES6+ syntax
- **Indentation**: 4 spaces
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Comments**: JSDoc comments for public methods
- **Error Handling**: Use errorHandler utility

### Git Workflow

1. Create feature branch
2. Make changes
3. Test thoroughly
4. Commit with descriptive messages
5. Push and create pull request

<a id="offline-map-labels-data-pipeline"></a>

### Offline map labels (data & pipeline)

End-to-end flow: optional **world** SQLite at `data/labels-world-base.db` plus optional **region** packs (`.rlp` zip: `meta.json` + `data.db`) imported in-app and stored under the app user data directory. The renderer queries the main process over IPC; Cesium `LabelCollection` draws results with screen-space culling.

| Layer | Role |
|--------|------|
| Main | `main/gis/services/labelDatabaseService.js` — open DBs, R-tree viewport query; `labelRegionImporter.js` — verify/import packs; `labelIpcHandlers.js` — handlers; wired from `main/gis/registerGisIpc.js` |
| Preload | `window.electronAPI.gis.labels` (see [API Reference](#api-reference)) |
| Renderer | `public/js/gis/labelManager.js`, `labelQueryService.js`, `labelCollisionEngine.js`; UI `public/js/ui/labelManagerUI.js`; styles `public/css/labelManager.css` |

**Build world DB from OSM PBF** (developer machine; not required for end users if you ship a prebuilt DB):

```bash
pip install tqdm   # optional progress bar
python scripts/build_world_labels.py --pbf C:/Users/Dev/Downloads/asia-260402.osm.pbf --out data/labels-world-base.db
```

Requires **osmium-tool** (`osmium export` on PATH). Planet-sized extracts are large and slow; start with a regional `.osm.pbf`.

**Cut a distributable region pack**:

```bash
python scripts/pack_region.py --db data/labels-world-base.db --id my-region ^
  --west -10 --south 35 --east 15 --north 55 --out dist/my-region.rlp
```

(On Unix shells, use `\` line continuation instead of `^`.)

#### Reference: free sources for world regions and map labels

Meridian’s bundled **offline labels** pipeline uses **OpenStreetMap** extracts (see above). The sources below are common **complementary** options when you need administrative boundaries, cartographic label layers, or GIS-friendly files for QGIS, custom ETL, or web maps—they are **not** imported automatically by the app today.

| Source | License / notes | Formats | Link |
|--------|-----------------|---------|------|
| **Natural Earth** | Public domain; country and place names, physical features; 1:10m / 1:50m / 1:110m | Shapefile (convert to GeoJSON, e.g. [martynafford/natural-earth-geojson](https://github.com/martynafford/natural-earth-geojson)) | [naturalearthdata.com/downloads](https://www.naturalearthdata.com/downloads/) |
| **geoBoundaries** | CC BY 4.0; broad UN-level coverage | GeoJSON, Shapefile, others | [geoboundaries.org](https://www.geoboundaries.org/) |
| **World Bank Official Boundaries** | Official WB admin layers | Shapefile, GeoPackage, GeoJSON | [World Bank data catalog](https://datacatalog.worldbank.org/dataset/world-bank-official-boundaries) |
| **GADM** | Detailed admin boundaries (often to municipality level) | GeoPackage, Shapefile, GeoJSON | [gadm.org/download_world.html](https://gadm.org/download_world.html) |
| **MapScaping (country GeoJSON overview)** | Pointers and browser-style tools for per-country boundaries | GeoJSON, Shapefile, KML, GeoPackage, TopoJSON, FlatGeobuf (varies by tool) | [mapscaping.com/geojson-every-country-in-the-world](https://mapscaping.com/geojson-every-country-in-the-world/) |

**Choosing a format:** **GeoJSON** for web maps (Leaflet, Mapbox, D3.js). **Shapefile** for desktop GIS (QGIS, ArcGIS). **KML** for Google Earth / Google Maps.

**IPC surface** (main): `gis.labels.queryViewport`, `gis.labels.listRegions`, `gis.labels.importRegion`, `gis.labels.setRegionEnabled`, `gis.labels.removeRegion`; progress updates on channel `gis.labels.importProgress`.

**i18n**: Label strings for UI live in `scripts/locale-*-part*.mjs`. After edits, run `node scripts/emit-locale.mjs` to regenerate `public/js/appI18n/locale-*.js`.

---

## Building & Distribution

### Brand assets (logo & icons)

Meridian branding is centralized under `build/`:

| File | Role |
|------|------|
| `build/meridian-icon.svg` | Canonical square mark (source for all raster icons) |
| `build/meridian_worldclass_logo.svg` | Full brand sheet (wordmark, legend, size variants) |
| `build/icon.png` / `build/icon.ico` / `build/icon.icns` | Electron window icon and **electron-builder** installers (regenerated from the SVG) |
| `build/icons/icon-*.png` | Exported sizes (16–512 px) for tooling or manual use |
| `public/assets/meridian-icon.svg` | Copy of the canonical icon for dev and static serving (updated by `npm run build:brand`) |

After editing `build/meridian-icon.svg`, run `npm run build:brand` to refresh PNG/ICO/ICNS and the `public/assets` copy. Production `npm run webpack` runs `build:brand` first so packaged builds stay in sync.

The renderer loads the favicon from `assets/meridian-icon.svg`.

### Building for Development

```bash
# Build for current platform
npm run build

# Build for specific platform
npm run build:win      # Windows
npm run build:mac      # macOS
npm run build:linux    # Linux

# Build for all platforms
npm run build:all
```

### Building for Production

#### Windows

```bash
npm run build:win
```

Creates:
- **NSIS Installer**: `dist/SimplexDM-2.0.0-Setup.exe`
- **Portable**: `dist/SimplexDM-2.0.0-Portable.exe`

#### macOS

```bash
npm run build:mac
```

Creates:
- **DMG**: `dist/SimplexDM-2.0.0.dmg`
- **ZIP**: `dist/SimplexDM-2.0.0-mac.zip`

#### Linux

```bash
npm run build:linux
```

Creates:
- **AppImage**: `dist/SimplexDM-2.0.0.AppImage`
- **DEB**: `dist/SimplexDM-2.0.0.deb`
- **RPM**: `dist/SimplexDM-2.0.0.rpm`

### Build Output

Built applications are in `dist/` directory:

```
dist/
├── SimplexDM-2.0.0-Setup.exe    # Windows installer
├── SimplexDM-2.0.0-Portable.exe # Windows portable
├── SimplexDM-2.0.0.dmg           # macOS DMG
└── SimplexDM-2.0.0.AppImage     # Linux AppImage
```

### Distribution Checklist

- [ ] Update version in `package.json`
- [ ] Test on target platform
- [ ] Verify all dependencies included
- [ ] Test offline functionality
- [ ] Verify CesiumJS included
- [ ] Test tileset loading
- [ ] If shipping labels: confirm `data/labels-world-base.db` or `.rlp` import path, and smoke-test `gis.labels` in packaged build
- [ ] Check file sizes (should include all assets)

### Code Signing (Optional)

For production releases, configure code signing under `package.json` → `"build"` (same keys `win` / `mac` as [electron-builder](https://www.electron.build/configuration/configuration)); a duplicate `electron-builder.json` may exist for reference.

```json
{
  "win": {
    "certificateFile": "path/to/certificate.pfx",
    "certificatePassword": "password"
  },
  "mac": {
    "identity": "Developer ID Application: Your Name"
  }
}
```

---

## API Reference

### Electron API (Preload)

Available via `window.electronAPI`:

#### `getServerPort()`
Returns the HTTP server port number.

```javascript
const port = await window.electronAPI.getServerPort();
```

#### `getAppVersion()`
Returns the application version.

```javascript
const version = await window.electronAPI.getAppVersion();
```

#### `getAppPath()`
Returns the user data directory path.

```javascript
const path = await window.electronAPI.getAppPath();
```

#### `platform`
Platform identifier (`'win32'`, `'darwin'`, `'linux'`).

```javascript
const platform = window.electronAPI.platform;
```

#### `isDev`
Development mode flag.

```javascript
if (window.electronAPI.isDev) {
    // Development-only code
}
```

#### `gis.labels` (offline map labels)

Exposed when GIS IPC is registered. All methods return Promises unless noted.

```javascript
const L = window.electronAPI.gis.labels;

// Query labels for a geographic viewport (see labelQueryService for shape)
const rows = await L.queryViewport(viewport, activeRegionIds, options);

const regions = await L.listRegions();
const { canceled, meta } = await L.importRegion(); // or importRegion('/path/to/file.rlp')
await L.setRegionEnabled(regionId, true);
await L.removeRegion(regionId);

const off = L.onImportProgress(({ pct, msg }) => { /* ... */ });
// off(); // unsubscribe
```

### Core Modules API

#### TilesetViewer

```javascript
// Get viewer instance
const viewer = window.tilesetViewer.viewer;

// Load tileset
await window.tilesetViewer.loadTileset(url);

// Get camera position
const position = window.tilesetViewer.getCameraPosition();

// Fly to location
await window.tilesetViewer.flyTo(longitude, latitude, height);
```

#### FileManager

```javascript
// Open file dialog
const file = await window.fileManager.openFileDialog();

// Read file
const content = await window.fileManager.readFile(path);

// Write file
await window.fileManager.writeFile(path, content);
```

#### MeasurementManager

```javascript
// Start measurement
window.enhancedMeasurementManager.startMeasurement(type);

// Get measurement results
const results = window.enhancedMeasurementManager.getResults();

// Clear measurements
window.enhancedMeasurementManager.clear();
```

### Server API

#### File Endpoint

```
GET /file?path=<file_path>
```

Serves arbitrary files from the file system.

Example:
```
http://localhost:8000/file?path=C:/Data/tileset.json
```

#### Static Files

```
GET /<relative_path>
```

Serves files from `public/` directory.

Example:
```
http://localhost:8000/index.html
http://localhost:8000/css/main.css
```

#### Data Files

```
GET /data/<relative_path>
```

Serves files from `data/` directory.

Example:
```
http://localhost:8000/data/tiles/raster/0/0/0.png
```

---

## Troubleshooting

### Common Issues

#### Application Won't Start

**Problem**: Application window doesn't open or crashes immediately.

**Solutions**:
1. Check Node.js version: `node --version` (should be 16.0+)
2. Verify dependencies: `npm install`
3. Check console for errors
4. Verify CesiumJS is installed in `public/lib/cesium/`
5. Check if port 8000 is available

#### Tileset Won't Load

**Problem**: Tileset fails to load or shows errors.

**Solutions**:
1. Verify tileset JSON file is valid
2. Check file paths in tileset JSON (relative vs absolute)
3. Ensure all referenced files exist
4. Check server console for 404 errors
5. Verify file permissions
6. Try using absolute paths in tileset JSON

#### Map Tiles Not Showing

**Problem**: Base map tiles don't display.

**Solutions**:
1. Check internet connection (for online tiles)
2. Verify offline tiles exist in `data/tiles/`
3. Check `data/tiles/meta.json` for correct zoom levels
4. Verify server is serving from `data/` directory
5. Check browser console for CORS or loading errors

#### Performance Issues

**Problem**: Application is slow or laggy.

**Solutions**:
1. Reduce visible layers
2. Lower tile cache size in configuration
3. Use performance monitor to identify bottlenecks
4. Reduce zoom level for large areas
5. Close other applications to free memory
6. Check system requirements (RAM, GPU)

#### File Path Issues (Windows)

**Problem**: File paths not resolving correctly on Windows.

**Solutions**:
1. Use forward slashes or backslashes consistently
2. Check case sensitivity (Windows is case-insensitive)
3. Verify path resolution in PathResolver
4. Use absolute paths when possible
5. Check file handle registry for locked files

#### Build Fails

**Problem**: `npm run build` fails with errors.

**Solutions**:
1. Check Node.js and npm versions
2. Clear cache: `npm cache clean --force`
3. Delete `node_modules` and reinstall
4. Check `package.json` → `"build"` (and any `electron-builder.json` if used)
5. Verify all required files exist
6. Check disk space

#### DevTools Not Opening

**Problem**: DevTools don't open in development mode.

**Solutions**:
1. Verify `NODE_ENV=development` is set
2. Check `electron-main.js` for DevTools configuration
3. Manually open: `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (macOS)

#### Offline labels empty or “osmium” errors when building data

**Problem**: No labels on the globe, or `build_world_labels.py` fails when spawning `osmium`.

**Solutions**:
1. Confirm `data/labels-world-base.db` exists if you expect a bundled world dataset, or import a `.rlp` from the Map labels panel.
2. Install [osmium-tool](https://osmcode.org/osmium-tool/) and ensure `osmium` is on `PATH` (Windows: `where osmium` in a new terminal after updating PATH).
3. Check DevTools / main process logs for IPC or SQLite errors (`better-sqlite3` must match your Electron/Node ABI after `npm install`).
4. If the **Map labels** section is missing, enable **Control Center → Features →** runtime module **labelManager** and save (or set `modules.labelManager.enabled` in config).

### Getting Help

1. **Check Logs**: Console output in DevTools
2. **Check Server Logs**: Terminal output from server
3. **Review Documentation**: This README and code comments
4. **Check Issues**: GitHub issues (if applicable)
5. **Debug Mode**: Run with `NODE_ENV=development` for verbose logging

---

## Contributing

### How to Contribute

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/my-feature`
3. **Make your changes**
4. **Test thoroughly**
5. **Commit with clear messages**: `git commit -m "Add feature X"`
6. **Push to your fork**: `git push origin feature/my-feature`
7. **Create a pull request**

### Contribution Guidelines

- **Code Style**: Follow existing code style
- **Documentation**: Update documentation for new features
- **Testing**: Test on multiple platforms if possible
- **Error Handling**: Include proper error handling
- **Comments**: Add JSDoc comments for public methods

### Reporting Bugs

When reporting bugs, include:

1. **Description**: Clear description of the issue
2. **Steps to Reproduce**: Detailed steps to reproduce
3. **Expected Behavior**: What should happen
4. **Actual Behavior**: What actually happens
5. **Environment**: OS, Node.js version, application version
6. **Logs**: Console logs and error messages
7. **Screenshots**: If applicable

### Feature Requests

When requesting features:

1. **Description**: Clear description of the feature
2. **Use Case**: Why this feature is needed
3. **Proposed Solution**: How it should work
4. **Alternatives**: Other solutions considered

---

## License

This project is licensed under the MIT License.

### Third-Party Licenses

- **CesiumJS**: Apache 2.0 License
- **Electron**: MIT License
- **OpenStreetMap Tiles**: ODbL (Open Database License)

See individual license files for details.

---

## Additional Resources

### Documentation Files

- [Offline map labels](#offline-map-labels-data-pipeline) (this README) — ETL scripts, IPC, config
- Code comments - Inline documentation in source files

### External Resources

- **CesiumJS Documentation**: https://cesium.com/learn/cesiumjs/
- **Electron Documentation**: https://www.electronjs.org/docs
- **3D Tiles Specification**: https://github.com/CesiumGS/3d-tiles
- **OpenStreetMap**: https://www.openstreetmap.org/

### Support

For support, questions, or issues:

1. Check this documentation
2. Review code comments
3. Check GitHub issues (if applicable)
4. Contact project maintainers

---

## Version History

### Version 2.0.0

- Initial release
- Core 3D Tiles viewing functionality
- Offline map support
- Measurement and analysis tools
- Multiple feature modules
- Cross-platform support (Windows, macOS, Linux)

### Documentation updates (2026)

- Offline map labels: main-process SQLite + IPC, `.rlp` packs, renderer `labelManager`, Control Center module gate, ETL scripts `build_world_labels.py` / `pack_region.py`

---

**Last Updated**: April 2026

**Documentation Version**: 2.0.0
