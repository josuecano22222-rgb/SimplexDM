# SimplexDM v2.0.0 — Meridian 3D Reality Planning Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-00b9ff.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-40%2B-47848F.svg)](https://www.electronjs.org/)
[![CesiumJS](https://img.shields.io/badge/CesiumJS-3D%20Tiles%201.0%2F1.1-6CADDF.svg)](https://cesium.com/platform/cesiumjs/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-1ec87e.svg)](#building--cross-platform-packaging)

**SimplexDM** (branded in-app as **Meridian**) is a desktop and local-web 3D Tiles visualization, spatial analysis, and offline GIS workstation built with **Electron 40+** and **CesiumJS**. It runs fully offline on air-gapped networks with zero cloud accounts or API keys required, while supporting automatic OpenStreetMap tile and geocoding fallback when connected.

---

## Core Capabilities

### 3D Tiles Engine & Bundled Showcase
- Full support for OGC 3D Tiles **1.0 & 1.1**: Batched 3D Models (`.b3dm`), Instanced 3D Models (`.i3dm`), Point Clouds (`.pnts`), Composite Tiles (`.cmpt`), and nested `tileset.json` hierarchies.
- Hierarchical LOD management, LRU tile cache controller, foveated view-frustum priority loading, horizon culling, LOD/volume hierarchy overlay, tile debug inspector, and real-time FPS/memory performance monitor.
- Includes a ready-to-inspect **Meridian Campus (Amsterdam)** multi-format sample tileset (`data/samples/meridian-campus/tileset.json`) combining `.b3dm` buildings with batch tables, `.i3dm` instanced trees, `.pnts` point cloud canopy, and `.cmpt` composite street furniture — launch via **Sample 3D** in the right sidebar or `index.html?sample=1`.

### Offline Basemaps & Multilingual SQLite Labels
- **Offline Raster & Vector Basemaps:** Standard raster (`data/tiles`), aerial raster (`data/pro`), Mapbox Vector Tiles (`.pbf`/`.mvt` via `OfflineVectorTileProvider`), and automatic online OpenStreetMap fallback. Python cache generator (`data/map_offline.py`) supports custom regions and zoom ranges.
- **Offline Place Labels:** R*Tree-indexed SQLite world base (`data/labels-world-base.db`, 170 multilingual starter labels shipped out of the box) plus importable regional `.rlp` archives (bundled `data/samples/amsterdam-labels.rlp` sample), visibility toggle, category filters, search, and **Native / English / Arabic** label display modes.
- **Custom Label ETL:** `scripts/seed_world_labels.py`, `scripts/build_world_labels.py`, and `scripts/pack_region.py` (supports `.osm.pbf` via optional Osmium as well as GeoJSON/CSV inputs).

### Navigation, Flight & Immersive 3D Street View
- Smooth orbit, pan, zoom, home reset, fit-to-tileset, camera history undo/redo, visual bookmarks gallery, guided Flight Mode, free-roam Superman Flight Mode, continuous orbit fly-around, and offline first-person **3D Street View** (configurable eye height 1.2–15 m, 45°–110° FOV, 360° drag look, WASD walking, live compass HUD).
- Full keyboard shortcuts: `W A S D` pan/move, `Q / E` rotate, `R` reset view, `F` fit to tileset, `Space` play/pause animation or flight, `Alt+←/→` or `[ / ]` camera undo/redo, `Ctrl/Cmd+K` search, `?` navigation help, `Esc` cancel/exit.

### Measurement, Spatial Analysis & Editing
- **High-Precision 3D Measurements (~10 cm):** Point-to-point distance, polygonal surface area, vertical height, plane/surface measurement, and interactive 3D ruler with live WGS84/UTM coordinate readouts.
- **Analysis Suite:** 3D Line-of-Sight with obstruction detection, astronomical **Sun-Path & Shade Analysis** (NOAA solar elevation/azimuth, sunrise/sunset, equinox/solstice presets, diurnal shadow animation), and visible/hidden area (viewshed) analysis.
- **Display, Transform & Cutting:** Geodesic East-North-Up (ENU) tileset positioning, heading rotation, pitch tilt, uniform scale, reset & 4×4 matrix JSON export; interactive polygon tileset cutting; split-screen time/scenario comparison; and calibrated **5-Angle Aerial Oblique Views** (North/East/South/West/Nadir + 4-quadrant PNG contact sheet export).

### GIS Data Pipelines, Search, Collaboration & Advanced Tools
- **Desktop & REST GIS Stack:** GeoPackage (`@ngageoint/geopackage`), GeoTIFF (`geotiff`), Shapefile (`shapefile`), KML/GPX (`@tmcw/togeojson`, `@xmldom/xmldom`), CSV (`papaparse`), Excel (`xlsx`), 3D GLTF/GLB models, full EPSG projection registry (`proj4` + `epsg-index`), and JSTS geoprocessing (`buffer`, `union`, `intersection`, `difference`, `clip`, `simplify`).
- **Search, Coordinates & Sharing:** Offline label + region + Nominatim address search; WGS84 decimal, DMS, MGRS, ITM, and UTM coordinate search & live status-bar conversion; camera deep-link URL sharing with GeoJSON and KML export.
- **Team Collaboration & Inspection:** Collaboration workspaces (shared annotations, pinned viewpoints, JSON bundle import/export), high-resolution screenshot & view export, binary B3DM/I3DM/PNTS/CMPT feature extractor, JSON Tree Explorer, XSS-safe Metadata Inspector (filter + JSON/CSV export), Tileset JSON File Editor (live validation, format/minify, export), Path Manager, Tileset Metadata Database, bilingual **English / Arabic (RTL)** interface (999 synchronized locale keys), Landing Page (`landing.html`), and Site Content Admin Studio (`admin.html`).

---

## Quick Start

### Prerequisites
- **Node.js** `>= 18.0.0` (Node 20, 22, and 24 LTS supported on Windows, macOS, and Linux) and **npm** `>= 9.0.0` (including npm v11/v12 `allowScripts`)
- **No C++ compiler / Visual Studio Build Tools required:** `better-sqlite3` fetches official prebuilt binaries automatically for both Node.js and Electron, and cleanly falls back to Node's built-in `node:sqlite` + bundled WebAssembly `rtree-sql.js` (for OGC GeoPackage) when offline.
- **No Python required** to install, launch, run `npm test` / `npm run test:coverage`, or build label packs and tile metadata (`npm run labels:build`, `npm run labels:pack`, `npm run tiles:meta`). Python `>= 3.8` is optional for downloading live OSM raster tiles (`data/map_offline.py`) or running the Python ETL scripts directly.

### Installation & Running

```bash
# 1. Install dependencies (initializes data directories, Cesium, Electron runtime & SQLite prebuilds)
npm install

# 2. Launch the desktop app (Electron — automatically verifies Electron binary & Electron SQLite prebuild)
npm run dev
# (alias: npm run electron:dev)

# — OR — Launch as a standalone local web server (default port 8000, auto-finds open port)
npm start
# Open http://localhost:8000/index.html        (3D Workstation)
# Open http://localhost:8000/index.html?sample=1 (3D Workstation + Sample 3D Campus)
# Open http://localhost:8000/landing.html      (Product Landing Page)
# Open http://localhost:8000/admin.html        (Site Content Admin Studio)
```

Environment variables for `server/server.js` / Electron:
| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8000` | Preferred HTTP port (automatically increments if busy unless `SIMPLEX_STRICT_PORT=1`) |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` for container/LAN preview) |
| `SIMPLEX_STRICT_OFFLINE` | `0` | Set to `1` in Electron to block online OSM tile & Nominatim fallback |
| `DATA_DIR` | `./data` | Override data root directory |

---

## Offline Maps & Label Pack Workflows

```bash
# Compile a custom world label DB or regional .rlp pack (Node.js — zero Python needed)
npm run labels:build -- --geojson places.geojson --out data/labels-world-base.db
npm run labels:pack -- --db data/labels-world-base.db --id my-city --name "My City" --west 4.7 --south 52.2 --east 5.1 --north 52.5 --out my-city.rlp
npm run tiles:meta -- --dir data/tiles

# Optional Python tools: download offline OpenStreetMap raster tiles (use `python` on Windows, `python3` on macOS/Linux)
python3 data/map_offline.py --bbox 4.72,52.28,5.08,52.44 --min-zoom 0 --max-zoom 13 --out data/tiles
python3 data/update_meta.py

# Regenerate the bundled world label SQLite DB + Amsterdam sample .rlp pack (requires Python 3.8+)
npm run seed:labels

# Regenerate the bundled Meridian Campus 3D Tiles 1.1 sample (.b3dm/.i3dm/.pnts/.cmpt)
npm run seed:samples
```

---

## Configuration & Internationalization

- **Runtime configuration:** `data/config/app-config.json` (synced with `public/data/config/app-config.json` via `/api/app-config` and `jsonConfigManager.js`). Toggle feature modules dynamically (e.g., `modules.labelManager.enabled`) — modules listen for `jsonConfigUpdated`.
- **Landing page content:** `data/site/site-content.json`, editable visually via `admin.html` (`/api/site-content`).
- **Localization:** Edit `scripts/locale-{en,ar}-part{1,2,3}.mjs`, then run `npm run i18n:emit` and verify parity with `npm run i18n:check`.

---

## Testing, Bundling & Cross-Platform Packaging

```bash
# Run unit & integration test suites (Jest)
npm test
npm run test:coverage

# Verify EN/AR localization parity
npm run i18n:check

# Copy CesiumJS into public/lib/cesium (required before packaging installers)
npm run setup

# Export brand icons & build production Webpack + Babel bundle (public-bundled/)
npm run build:brand
npm run webpack

# Build Electron installers into dist/ (App ID: com.meridian.viewer)
npm run build:win     # Windows NSIS installer + Portable .exe (x64)
npm run build:mac     # macOS DMG + ZIP (x64, arm64)
npm run build:linux   # Linux AppImage, DEB, RPM (x64)
npm run build:all     # Multi-platform release build
```

---

## Project Layout

```text
SimplexDM/
├── electron-main.js          # Hardened Electron main process, CSP, port discovery & IPC
├── preload.js                # Context-isolated renderer IPC bridge (window.electronAPI)
├── electron-builder.json     # Cross-platform installer config (com.meridian.viewer -> dist/)
├── webpack.config.js         # Production renderer bundler + Babel transpilation
├── server/
│   ├── server.js             # Local HTTP server (range streaming, security, Cesium fallback)
│   └── gisApiRoutes.js       # REST gateway for offline labels, CRS, JSTS & offline status
├── main/gis/                 # SQLite R*Tree labels, .rlp importer, GeoPackage, GeoTIFF, CRS, JSTS
├── public/
│   ├── index.html            # Meridian 3D workstation UI
│   ├── landing.html          # Product landing page & operator workspace launcher
│   ├── admin.html            # Live site-content JSON studio
│   ├── css/ & Style/         # Design tokens, dark/light themes, RTL & toolbar stylesheets
│   └── js/                   # Modular core, features, gis, navigation, ui & utils scripts
├── data/                     # labels-world-base.db, samples/ (3D Tiles + .rlp), config, tiles
├── scripts/                  # Setup, native rebuild, label ETL, sample 3D generator, i18n
└── tests/                    # Jest unit & integration test suites
```

---

## Contributing & License

Contributions are welcome — please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.  
Released under the [MIT License](LICENSE).
