#!/usr/bin/env node
'use strict';

/**
 * SimplexDM Native Module Rebuild Helper (`scripts/rebuild-native.js`)
 *
 * Rebuilds `better-sqlite3` against the installed Electron ABI when Electron
 * headers are available. Supports offline / CI / Node-test environments cleanly:
 *   - Set `SKIP_ELECTRON_REBUILD=1` to keep the host Node.js ABI (used for `npm test`).
 *   - Set `FORCE_ELECTRON_REBUILD=1` to treat rebuild failure as a fatal exit code.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

function runRebuild(options = {}) {
    const env = options.env || process.env;
    const force = Boolean(options.force) || env.FORCE_ELECTRON_REBUILD === '1';

    if (env.SKIP_ELECTRON_REBUILD === '1') {
        console.log('[rebuild] SKIP_ELECTRON_REBUILD=1 — preserving Node.js ABI for better-sqlite3.');
        return { status: 'skipped', reason: 'env' };
    }

    const binName = process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild';
    const binPath = path.join(ROOT_DIR, 'node_modules', '.bin', binName);
    if (!fs.existsSync(binPath)) {
        console.log('[rebuild] @electron/rebuild not installed — skipping Electron native rebuild.');
        return { status: 'skipped', reason: 'missing-bin' };
    }

    const electronPkg = path.join(ROOT_DIR, 'node_modules', 'electron', 'package.json');
    if (!fs.existsSync(electronPkg)) {
        console.log('[rebuild] electron package not installed — skipping Electron native rebuild.');
        return { status: 'skipped', reason: 'missing-electron' };
    }

    console.log('[rebuild] Rebuilding better-sqlite3 for Electron...');
    const result = spawnSync(binPath, ['-f', '-w', 'better-sqlite3'], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env,
    });

    if (result.status === 0) {
        console.log('[rebuild] ✓ better-sqlite3 rebuilt for Electron.');
        return { status: 'ok' };
    }

    const msg =
        '[rebuild] Could not rebuild better-sqlite3 for Electron (headers may be offline). ' +
        'Host Node.js binary kept; run `npm run rebuild:electron` before launching Electron.';
    if (force) {
        console.error(msg);
        process.exit(result.status || 1);
    }
    console.warn(msg);
    return { status: 'fallback', exitCode: result.status };
}

if (require.main === module) {
    runRebuild({ force: process.argv.includes('--force') });
}

module.exports = { runRebuild };
