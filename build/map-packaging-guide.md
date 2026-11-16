# Map File Packaging Guide

## Meridian logo and installer icons

Branding for installers and shortcuts is unified with the in-app window icon:

- **Source vector**: `build/meridian-icon.svg` (canonical square mark; also copied to `public/assets/meridian-icon.svg` when you run `npm run build:brand`).
- **electron-builder**: `package.json` points Windows to `build/icon.ico`, macOS to `build/icon.icns`, and Linux to `build/icon.png`, all generated from that SVG.
- **Full brand sheet** (legend, wordmark, size variants): `build/meridian_worldclass_logo.svg`.
- **Regenerate rasters**: `npm run build:brand` (also runs automatically before production `npm run webpack`).

The NSIS include file `build/installer.nsh` is referenced from `package.json` → `build.nsis.include`; it does not embed artwork paths—icons come from the `build` resources above.

## Overview

The offline map tiles (~1 GB) can be packaged in several ways. Choose the approach that best fits your distribution strategy.

## Option 1: Exclude from Main Installer (Recommended)

**Best for**: Smaller installer size, faster downloads, optional offline maps

### Configuration

The map tiles are excluded from the main installer by default. Users can:
- Use the app without maps (shows blue globe)
- Download maps separately if needed
- Copy maps manually to the installation directory

### Build Configuration

```json
{
  "build": {
    "files": [
      "electron-main.js",
      "preload.js",
      "public-bundled/**/*",
      "server/**/*",
      "scripts/**/*",
      "package.json",
      "!data/tiles/raster/**/*",  // Exclude large map tiles
      "!data/tiles/raster.zip"     // Exclude zip file
    ],
    "extraFiles": [
      {
        "from": "data",
        "to": "data",
        "filter": [
          "**/*",
          "!tiles/raster/**/*",    // Exclude raster tiles
          "!tiles/raster.zip"       // Exclude zip file
        ]
      }
    ]
  }
}
```

## Option 2: Include as Optional Component

**Best for**: Single installer with optional map component

### Using NSIS Optional Components

Create `build/installer.nsh`:

```nsis
!macro customInstall
  ; Check if user wants to install maps
  MessageBox MB_YESNO "Install offline map tiles (~1 GB)?$\n$\nThis will increase installation time." IDNO skipMaps
  
  ; Extract map tiles
  SetOutPath "$INSTDIR\data\tiles"
  File /r "..\data\tiles\raster"
  File "..\data\tiles\meta.json"
  
  skipMaps:
!macroend
```

## Option 3: Separate Installer Package

**Best for**: Two separate installers (main app + maps)

### Build Scripts

Create `scripts/build-with-maps.js`:

```javascript
const builder = require('electron-builder');
const path = require('path');

// Build main app (without maps)
builder.build({
  config: {
    files: [
      "electron-main.js",
      "preload.js",
      "public-bundled/**/*",
      "server/**/*",
      "scripts/**/*",
      "package.json",
      "!data/tiles/raster/**/*"
    ]
  }
}).then(() => {
  console.log('Main app built successfully');
  
  // Build maps package separately
  return builder.build({
    config: {
      appId: "com.Meridian.viewer.maps",
      productName: "SimplexDM - Offline Maps",
      files: [
        "data/tiles/**/*"
      ],
      win: {
        target: "zip"
      }
    }
  });
});
```

## Option 4: Copy During Installation (Manual)

**Best for**: Enterprise deployments, controlled distribution

### Installation Instructions

1. Build the main app without maps
2. Provide `data/tiles/raster/` directory separately
3. Users copy it to: `[InstallDir]\resources\app\data\tiles\raster\`

### Automated Copy Script

Create `scripts/install-maps.js`:

```javascript
const fs = require('fs');
const path = require('path');

const mapsSource = process.argv[2]; // Path to maps directory
const appPath = process.argv[3] || process.resourcesPath;

if (!mapsSource) {
  console.error('Usage: node install-maps.js <maps-path> [app-path]');
  process.exit(1);
}

const targetPath = path.join(appPath, 'app', 'data', 'tiles', 'raster');

if (!fs.existsSync(mapsSource)) {
  console.error(`Maps source not found: ${mapsSource}`);
  process.exit(1);
}

// Copy maps
console.log(`Copying maps from ${mapsSource} to ${targetPath}...`);
// Use fs-extra or similar for recursive copy
```

## Recommended Approach

**For most users**: **Option 1** (Exclude from installer)

### Benefits:
- ✅ Smaller installer (~50-100 MB vs ~1.1 GB)
- ✅ Faster downloads
- ✅ Faster installation
- ✅ Users can choose to add maps later
- ✅ App works without maps (shows blue globe)

### Implementation:

1. Update `package.json` to exclude maps from build
2. Provide maps as separate download (ZIP file)
3. Include instructions for manual installation
4. Optionally create a helper script to extract maps

## Current Configuration

The current build configuration includes maps by default. To exclude them:

1. Update `package.json` build.files to exclude `data/tiles/raster/**/*`
2. Update `package.json` build.extraFiles filter to exclude raster tiles
3. Rebuild the application

## Map File Location

Maps are expected at:
- **Development**: `data/tiles/raster/`
- **Packaged**: `resources/app/data/tiles/raster/` or `resources/app.asar.unpacked/data/tiles/raster/`

The application will automatically detect and use maps if they exist.
