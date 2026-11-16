#!/usr/bin/env node
'use strict';

/**
 * SimplexDM Electron Binary Verifier (`scripts/ensure-electron.js`)
 *
 * Ensures `node_modules/electron` has downloaded and extracted its platform
 * runtime binary (`path.txt` + `dist/electron[.exe]`).
 *
 * Why this exists:
 *   npm v12+ blocks dependency lifecycle scripts unless covered by
 *   `allowScripts` or user `.npmrc` policy, and developers may run
 *   `npm install --ignore-scripts`. Running `ensure-electron.js` during
 *   `postinstall` (when not skipped) and automatically before `npm run dev` /
 *   `npm run electron` guarantees Electron is always ready to launch without
 *   manual `node_modules/electron` deletion.
 *
 * Environment flags:
 *   - `ELECTRON_SKIP_BINARY_DOWNLOAD=1` — skip binary download completely.
 *   - `SKIP_ELECTRON_INSTALL=1`         — skip during CI/headless installs.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

function isElectronBinaryInstalled(electronDir) {
    try {
        const pkgPath = path.join(electronDir, 'package.json');
        const pathTxt = path.join(electronDir, 'path.txt');
        if (!fs.existsSync(pkgPath) || !fs.existsSync(pathTxt)) {
            return false;
        }
        const { version } = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const relExec = fs.readFileSync(pathTxt, 'utf8').trim();
        if (!relExec) {
            return false;
        }
        const distDir = process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(electronDir, 'dist');
        const execPath = path.join(distDir, relExec);
        if (!fs.existsSync(execPath)) {
            return false;
        }
        const versionFile = path.join(distDir, 'version');
        if (fs.existsSync(versionFile)) {
            const installedVer = fs.readFileSync(versionFile, 'utf8').trim().replace(/^v/, '');
            if (version && installedVer && installedVer !== version) {
                return false;
            }
        }
        return true;
    } catch (_) {
        return false;
    }
}

function ensureElectron(options = {}) {
    const env = options.env || process.env;
    const required = Boolean(options.required);
    const electronDir = options.electronDir || path.join(ROOT_DIR, 'node_modules', 'electron');

    if (env.ELECTRON_SKIP_BINARY_DOWNLOAD || env.SKIP_ELECTRON_INSTALL === '1') {
        return { status: 'skipped', reason: 'env' };
    }

    // Skip automatic 100 MB Electron download in headless CI unless explicitly launching/building Electron
    if (!required && (env.CI === 'true' || env.CI === '1' || env.SKIP_ELECTRON_REBUILD === '1')) {
        return { status: 'skipped', reason: 'ci' };
    }

    const installScript = path.join(electronDir, 'install.js');
    if (!fs.existsSync(installScript)) {
        if (required) {
            console.error('[electron] Electron package is not installed. Run `npm install` first.');
            process.exit(1);
        }
        return { status: 'skipped', reason: 'not-installed' };
    }

    if (isElectronBinaryInstalled(electronDir)) {
        return { status: 'ok', cached: true };
    }

    console.log('[electron] Downloading Electron runtime binary for ' + `${process.platform}-${process.arch}...`);
    const result = spawnSync(process.execPath, [installScript], {
        cwd: electronDir,
        stdio: required ? 'inherit' : ['ignore', 'inherit', 'pipe'],
        env,
        windowsHide: true,
    });

    if (result.status === 0 && isElectronBinaryInstalled(electronDir)) {
        console.log('[electron] Electron runtime ready.');
        return { status: 'ok', cached: false };
    }

    const msg =
        '[electron] Could not download Electron binary (network may be offline or restricted). ' +
        'Web server mode (`npm start`) works without it; re-run `npm run dev` when online to fetch Electron.';
    if (required) {
        console.error(msg);
        process.exit(result.status || 1);
    }
    console.warn(msg);
    return { status: 'unavailable', exitCode: result.status };
}

if (require.main === module) {
    const args = new Set(process.argv.slice(2));
    ensureElectron({ required: args.has('--required') });
}

module.exports = { ensureElectron, isElectronBinaryInstalled };
