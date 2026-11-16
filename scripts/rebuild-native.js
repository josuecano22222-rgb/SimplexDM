#!/usr/bin/env node
'use strict';

/**
 * SimplexDM Cross-Platform Native SQLite Helper (`scripts/rebuild-native.js`)
 *
 * Manages `better-sqlite3` prebuilt binaries cleanly across Windows, macOS, and
 * Linux WITHOUT requiring Visual Studio C++ Build Tools, Xcode, Python, or
 * shell interpolation (avoids Node 24+ DEP0190 warnings).
 *
 * Strategy:
 *   1. Prefer official precompiled binaries via `prebuild-install` (supports
 *      both `--runtime=node` for `npm start` / `npm test` and
 *      `--runtime=electron` for `npm run dev` / `npm run build`). Prebuilds are
 *      cached by npm, so switching between Node and Electron ABIs takes ~40 ms.
 *   2. Optionally compile from source (`--from-source` or `FORCE_SOURCE_REBUILD=1`)
 *      when a local C++ toolchain is installed.
 *   3. If no prebuild or compiler is available (offline, blocked network, or
 *      bleeding-edge ABI), succeed cleanly — `sqliteDriver.js` and
 *      `GeoPackageService.js` fall back automatically to Node's built-in
 *      `node:sqlite` and bundled WebAssembly (`rtree-sql.js`).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const MARKER_FILE = '.meridian-runtime-target';

function resolvePrebuildInstallBin(bs3Dir) {
    const candidates = [
        path.join(bs3Dir, 'node_modules', 'prebuild-install', 'bin.js'),
        path.join(ROOT_DIR, 'node_modules', 'prebuild-install', 'bin.js'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function getElectronVersion() {
    try {
        const pkgPath = path.join(ROOT_DIR, 'node_modules', 'electron', 'package.json');
        if (!fs.existsSync(pkgPath)) return null;
        return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || null;
    } catch (_) {
        return null;
    }
}

function findCompiledNodeAddon(bs3Dir) {
    const candidates = [
        path.join(bs3Dir, 'build', 'Release', 'better_sqlite3.node'),
        path.join(bs3Dir, 'build', 'Debug', 'better_sqlite3.node'),
        path.join(bs3Dir, 'build', 'better_sqlite3.node'),
    ];
    return candidates.find((p) => fs.existsSync(p)) || null;
}

function canLoadBetterSqlite3InCurrentNode() {
    try {
        const bs3Entry = path.join(ROOT_DIR, 'node_modules', 'better-sqlite3');
        // Clear cached module entry so ABI swaps in the same process are visible
        for (const key of Object.keys(require.cache)) {
            if (key.includes(`${path.sep}better-sqlite3${path.sep}`)) {
                delete require.cache[key];
            }
        }
        const Database = require(bs3Entry);
        const db = new Database(':memory:');
        db.close();
        return true;
    } catch (_) {
        return false;
    }
}

function readMarker(bs3Dir) {
    try {
        return fs.readFileSync(path.join(bs3Dir, MARKER_FILE), 'utf8').trim();
    } catch (_) {
        return '';
    }
}

function writeMarker(bs3Dir, value) {
    try {
        fs.writeFileSync(path.join(bs3Dir, MARKER_FILE), `${value}\n`, 'utf8');
    } catch (_) {
        // Non-fatal on read-only filesystems
    }
}

function tryPrebuildInstall(bs3Dir, runtime, target, env, quiet) {
    const bin = resolvePrebuildInstallBin(bs3Dir);
    if (!bin || !target) {
        return { ok: false, reason: 'missing-prebuild-install' };
    }
    const res = spawnSync(
        process.execPath,
        [bin, `--runtime=${runtime}`, `--target=${target}`, `--arch=${env.npm_config_arch || process.arch}`, `--platform=${env.npm_config_platform || process.platform}`],
        {
            cwd: bs3Dir,
            stdio: quiet ? 'pipe' : ['ignore', 'pipe', 'pipe'],
            env,
            timeout: 60000,
        }
    );
    if (res.status === 0 && findCompiledNodeAddon(bs3Dir)) {
        writeMarker(bs3Dir, `${runtime}:${target}:${process.platform}:${process.arch}`);
        return { ok: true };
    }
    return {
        ok: false,
        exitCode: res.status,
        stderr: res.stderr ? res.stderr.toString('utf8').trim() : '',
    };
}

function tryPosixLocalHeaderCompile(bs3Dir, env, quiet) {
    if (process.platform === 'win32') {
        return false;
    }
    const nodeGypJs = path.join(ROOT_DIR, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
    const localPrefix = path.resolve(process.execPath, '..', '..');
    const localHeader = path.join(localPrefix, 'include', 'node', 'node.h');
    if (!fs.existsSync(nodeGypJs) || !fs.existsSync(localHeader)) {
        return false;
    }
    const res = spawnSync(
        process.execPath,
        [nodeGypJs, 'rebuild', '--release', `--nodedir=${localPrefix}`],
        {
            cwd: bs3Dir,
            stdio: quiet ? 'pipe' : 'inherit',
            env,
            timeout: 180000,
        }
    );
    if (res.status === 0 && canLoadBetterSqlite3InCurrentNode()) {
        writeMarker(bs3Dir, `node:${process.versions.node}:${process.platform}:${process.arch}`);
        return true;
    }
    return false;
}

function tryElectronSourceRebuild(env) {
    const cliCandidates = [
        path.join(ROOT_DIR, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js'),
    ];
    const cli = cliCandidates.find((p) => fs.existsSync(p));
    if (!cli) return false;
    const res = spawnSync(process.execPath, [cli, '-f', '-w', 'better-sqlite3'], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        env,
    });
    return res.status === 0;
}

function runRebuild(options = {}) {
    const env = options.env || process.env;
    const force = Boolean(options.force) || env.FORCE_ELECTRON_REBUILD === '1';
    const fromSource = Boolean(options.fromSource) || env.FORCE_SOURCE_REBUILD === '1';
    const quiet = Boolean(options.quiet);
    const log = quiet ? () => {} : (...a) => console.log(...a);
    const warn = quiet ? () => {} : (...a) => console.warn(...a);

    if (env.SKIP_NATIVE_REBUILD === '1') {
        log('[rebuild] SKIP_NATIVE_REBUILD=1 — skipping native SQLite setup.');
        return { status: 'skipped', reason: 'env' };
    }

    // Legacy compatibility: SKIP_ELECTRON_REBUILD=1 defaults target to Node ABI
    let targetRuntime = options.runtime || 'node';
    if (env.SKIP_ELECTRON_REBUILD === '1' && !options.runtime) {
        log('[rebuild] SKIP_ELECTRON_REBUILD=1 — ensuring Node.js SQLite runtime.');
        return { status: 'skipped', reason: 'env' };
    }

    const bs3Dir = path.join(ROOT_DIR, 'node_modules', 'better-sqlite3');
    if (!fs.existsSync(path.join(bs3Dir, 'package.json'))) {
        log('[rebuild] better-sqlite3 not installed — using built-in SQLite fallback.');
        return { status: 'skipped', reason: 'missing-better-sqlite3' };
    }

    if (targetRuntime === 'electron') {
        const electronVersion = getElectronVersion();
        if (!electronVersion) {
            log('[rebuild] Electron not installed — skipping Electron SQLite binary setup.');
            return { status: 'skipped', reason: 'missing-electron' };
        }

        const expectedMarker = `electron:${electronVersion}:${process.platform}:${process.arch}`;
        if (!fromSource && readMarker(bs3Dir) === expectedMarker && findCompiledNodeAddon(bs3Dir)) {
            return { status: 'ok', runtime: 'electron', cached: true };
        }

        if (!fromSource) {
            log(`[rebuild] Fetching prebuilt better-sqlite3 for Electron v${electronVersion} (${process.platform}-${process.arch})...`);
            const pre = tryPrebuildInstall(bs3Dir, 'electron', electronVersion, env, quiet);
            if (pre.ok) {
                log(`[rebuild] better-sqlite3 ready for Electron v${electronVersion} (prebuilt binary).`);
                return { status: 'ok', runtime: 'electron', method: 'prebuild' };
            }
        }

        if (fromSource) {
            log(`[rebuild] Building better-sqlite3 from source for Electron v${electronVersion}...`);
            if (tryElectronSourceRebuild(env)) {
                writeMarker(bs3Dir, expectedMarker);
                log(`[rebuild] better-sqlite3 built from source for Electron v${electronVersion}.`);
                return { status: 'ok', runtime: 'electron', method: 'source' };
            }
        }

        const msg =
            `[rebuild] Prebuilt better-sqlite3 for Electron v${electronVersion} was not downloaded ` +
            '(using built-in node:sqlite / WebAssembly fallback; no Visual Studio required).';
        if (force) {
            console.error(msg);
            process.exit(1);
        }
        warn(msg);
        return { status: 'fallback', runtime: 'electron' };
    }

    // Target runtime: host Node.js (used by `postinstall`, `npm start`, `npm test`)
    if (!fromSource && canLoadBetterSqlite3InCurrentNode()) {
        writeMarker(bs3Dir, `node:${process.versions.node}:${process.platform}:${process.arch}`);
        log(`[rebuild] better-sqlite3 ready for Node.js v${process.versions.node}.`);
        return { status: 'ok', runtime: 'node', cached: true };
    }

    log(`[rebuild] Ensuring better-sqlite3 for Node.js v${process.versions.node} (${process.platform}-${process.arch})...`);
    const pre = tryPrebuildInstall(bs3Dir, 'node', process.versions.node, env, quiet);
    if (pre.ok && canLoadBetterSqlite3InCurrentNode()) {
        log(`[rebuild] better-sqlite3 ready for Node.js v${process.versions.node} (prebuilt binary).`);
        return { status: 'ok', runtime: 'node', method: 'prebuild' };
    }

    if (fromSource && tryPosixLocalHeaderCompile(bs3Dir, env, quiet)) {
        log(`[rebuild] better-sqlite3 compiled for Node.js v${process.versions.node}.`);
        return { status: 'ok', runtime: 'node', method: 'source' };
    }

    const fallbackMsg =
        `[rebuild] Using built-in SQLite + WebAssembly engine for Node.js v${process.versions.node} ` +
        '(no C++ build tools required).';
    if (force) {
        console.error(fallbackMsg);
        process.exit(1);
    }
    log(fallbackMsg);
    return { status: 'fallback', runtime: 'node' };
}

if (require.main === module) {
    const args = new Set(process.argv.slice(2));
    const runtime = args.has('--electron') ? 'electron' : 'node';
    runRebuild({
        runtime,
        force: args.has('--force'),
        fromSource: args.has('--from-source'),
        quiet: args.has('--quiet'),
    });
}

module.exports = { runRebuild, canLoadBetterSqlite3InCurrentNode };
