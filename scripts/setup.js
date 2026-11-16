#!/usr/bin/env node
'use strict';

/**
 * SimplexDM Post-Install Setup Script
 *
 * Ensures required project directories exist, validates runtime prerequisites,
 * and checks optional assets (CesiumJS, offline tiles, offline label database).
 *
 * Flags:
 *   --copy-cesium   Copy CesiumJS build output from node_modules/cesium/Build/Cesium
 *                   into public/lib/cesium/ if not already installed.
 *   --quiet         Suppress informational output.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const QUIET = args.has('--quiet');
const COPY_CESIUM = args.has('--copy-cesium') || process.env.SIMPLEX_COPY_CESIUM === '1';

function log(msg) {
    if (!QUIET) {
        console.log(msg);
    }
}

function parseMajor(versionStr) {
    const clean = String(versionStr || '').replace(/^v/, '');
    const major = parseInt(clean.split('.')[0], 10);
    return Number.isFinite(major) ? major : 0;
}

function checkNodeVersion() {
    const major = parseMajor(process.versions.node);
    if (major < 16) {
        console.warn(
            `[setup] Warning: Node.js ${process.versions.node} detected; SimplexDM requires Node.js >= 16.0.0.`
        );
        return false;
    }
    return true;
}

const REQUIRED_DIRS = [
    'data',
    'data/config',
    'data/site',
    'data/tiles',
    'data/tiles/raster',
    'data/tiles/vector',
    'public/assets',
    'public/lib',
    'build',
    'build/icons',
];

function ensureDirectories(rootDir = ROOT_DIR) {
    const created = [];
    for (const rel of REQUIRED_DIRS) {
        const full = path.join(rootDir, rel);
        if (!fs.existsSync(full)) {
            fs.mkdirSync(full, { recursive: true });
            created.push(rel);
        }
    }
    return created;
}

function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function ensureBrandIconCopy(rootDir = ROOT_DIR) {
    const srcSvg = path.join(rootDir, 'build', 'meridian-icon.svg');
    const dstSvg = path.join(rootDir, 'public', 'assets', 'meridian-icon.svg');
    if (fs.existsSync(srcSvg) && !fs.existsSync(dstSvg)) {
        fs.mkdirSync(path.dirname(dstSvg), { recursive: true });
        fs.copyFileSync(srcSvg, dstSvg);
        return true;
    }
    return false;
}

function ensureDefaultAppConfig(rootDir = ROOT_DIR) {
    const pubCfg = path.join(rootDir, 'public', 'data', 'config', 'app-config.json');
    const dataCfg = path.join(rootDir, 'data', 'config', 'app-config.json');
    if (fs.existsSync(pubCfg) && !fs.existsSync(dataCfg)) {
        fs.mkdirSync(path.dirname(dataCfg), { recursive: true });
        fs.copyFileSync(pubCfg, dataCfg);
        return true;
    }
    return false;
}

function checkCesiumInstallation(rootDir = ROOT_DIR, copyIfMissing = COPY_CESIUM) {
    const cesiumDest = path.join(rootDir, 'public', 'lib', 'cesium');
    const cesiumEntry = path.join(cesiumDest, 'Cesium.js');
    if (fs.existsSync(cesiumEntry)) {
        return { installed: true, copied: false, path: cesiumDest };
    }

    const npmCesiumBuild = path.join(rootDir, 'node_modules', 'cesium', 'Build', 'Cesium');
    if (copyIfMissing && fs.existsSync(path.join(npmCesiumBuild, 'Cesium.js'))) {
        copyDirRecursive(npmCesiumBuild, cesiumDest);
        return { installed: true, copied: true, path: cesiumDest };
    }

    return {
        installed: false,
        copied: false,
        path: cesiumDest,
        npmSourceAvailable: fs.existsSync(path.join(npmCesiumBuild, 'Cesium.js')),
    };
}

function checkOptionalData(rootDir = ROOT_DIR) {
    const worldLabelsDb = path.join(rootDir, 'data', 'labels-world-base.db');
    const tilesMeta = path.join(rootDir, 'data', 'tiles', 'meta.json');
    const sampleTile = path.join(rootDir, 'data', 'tiles', 'raster', '0', '0', '0.png');
    return {
        hasWorldLabelsDb: fs.existsSync(worldLabelsDb),
        hasTilesMeta: fs.existsSync(tilesMeta),
        hasSampleRasterTile: fs.existsSync(sampleTile),
    };
}

function runSetup(options = {}) {
    const rootDir = options.rootDir || ROOT_DIR;
    const copyCesium = options.copyCesium !== undefined ? options.copyCesium : COPY_CESIUM;

    log('[setup] Configuring SimplexDM workspace...');
    const nodeOk = checkNodeVersion();
    const createdDirs = ensureDirectories(rootDir);
    if (createdDirs.length > 0) {
        log(`[setup] Created directories: ${createdDirs.join(', ')}`);
    }

    if (ensureBrandIconCopy(rootDir)) {
        log('[setup] Synced build/meridian-icon.svg -> public/assets/meridian-icon.svg');
    }

    if (ensureDefaultAppConfig(rootDir)) {
        log('[setup] Initialized data/config/app-config.json from public/data/config/app-config.json');
    }

    const cesium = checkCesiumInstallation(rootDir, copyCesium);
    if (cesium.copied) {
        log('[setup] Copied CesiumJS from node_modules/cesium/Build/Cesium -> public/lib/cesium/');
    } else if (cesium.installed) {
        log('[setup] CesiumJS found at public/lib/cesium/');
    } else if (cesium.npmSourceAvailable) {
        log(
            '[setup] Note: public/lib/cesium/Cesium.js not found. ' +
                'Run "node scripts/setup.js --copy-cesium" or extract Cesium-1.137.0.zip into public/lib/cesium/.'
        );
    } else {
        log(
            '[setup] Note: Download CesiumJS 1.137.0 and extract it into public/lib/cesium/ before running the viewer.'
        );
    }

    const dataStatus = checkOptionalData(rootDir);
    if (!dataStatus.hasSampleRasterTile) {
        log('[setup] Optional: run "python data/map_offline.py" to download offline map tiles.');
    }
    if (!dataStatus.hasWorldLabelsDb) {
        log(
            '[setup] Optional: place data/labels-world-base.db or run "python scripts/build_world_labels.py" for world labels.'
        );
    }

    log('[setup] Setup complete.');
    return { nodeOk, createdDirs, cesium, dataStatus };
}

if (require.main === module) {
    try {
        runSetup();
    } catch (err) {
        console.error('[setup] Setup failed:', err.message);
        process.exit(1);
    }
}

module.exports = {
    REQUIRED_DIRS,
    checkNodeVersion,
    ensureDirectories,
    ensureBrandIconCopy,
    ensureDefaultAppConfig,
    checkCesiumInstallation,
    checkOptionalData,
    runSetup,
};
