/**
 * Full-Repository Static Integrity, Security, IPC, i18n, Brand Asset,
 * Webpack Entry, and UI Interaction Integration Tests.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { generateWebpackEntry } = require('../../scripts/generate-webpack-entry');

describe('Full-Repository Integration, Security & Build Integrity', () => {
    test('all HTML asset references in index.html, landing.html, and admin.html exist on disk', () => {
        const htmlFiles = ['public/index.html', 'public/landing.html', 'public/admin.html'];
        const missing = [];

        for (const relHtml of htmlFiles) {
            const html = fs.readFileSync(path.join(ROOT, relHtml), 'utf8');
            const dir = path.dirname(path.join(ROOT, relHtml));

            for (const m of html.matchAll(/<(?:script|link|img)\b[^>]+?(?:src|href)="([^"]+)"/gi)) {
                const ref = m[1].split('?')[0].split('#')[0];
                if (!ref || /^(?:https?:|data:|blob:|mailto:|javascript:)/i.test(ref)) continue;
                // Cesium runtime is copied from node_modules by scripts/setup.js at runtime / build time
                if (ref.startsWith('lib/cesium/')) continue;
                const full = path.resolve(dir, ref);
                if (!fs.existsSync(full)) {
                    missing.push(`${relHtml} -> ${ref}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    test('public/index.html has zero duplicate element IDs and 100% EN/AR i18n key coverage', () => {
        const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

        // 1. Unique DOM IDs
        const counts = new Map();
        for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
            counts.set(m[1], (counts.get(m[1]) || 0) + 1);
        }
        const duplicates = [...counts.entries()].filter(([, n]) => n > 1);
        expect(duplicates).toEqual([]);

        // 2. All data-i18n* attributes resolve in both EN and AR
        require('../../public/js/core/appI18n.locale-en');
        require('../../public/js/core/appI18n.locale-ar');
        const en = window.__SIMPLEX_LOCALE_EN;
        const ar = window.__SIMPLEX_LOCALE_AR;
        const lookup = (obj, keyPath) =>
            keyPath.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);

        const keys = new Set();
        for (const m of html.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)) {
            keys.add(m[1]);
        }
        expect(keys.size).toBeGreaterThan(290);
        const missingEn = [...keys].filter((k) => lookup(en, k) === undefined);
        const missingAr = [...keys].filter((k) => lookup(ar, k) === undefined);
        expect(missingEn).toEqual([]);
        expect(missingAr).toEqual([]);
    });

    test('preload.js IPC channels match electron-main.js and main/gis/ handlers 100%', () => {
        const preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
        const invoked = new Set();
        for (const m of preloadSrc.matchAll(/ipcRenderer\.(?:invoke|on)\(\s*['"]([^'"]+)['"]/g)) {
            invoked.add(m[1]);
        }
        expect(invoked.size).toBeGreaterThanOrEqual(20);

        const mainFiles = [
            'electron-main.js',
            'main/gis/registerGisIpc.js',
            'main/gis/services/labelIpcHandlers.js',
            'main/gis/services/labelRegionImporter.js',
            'main/gis/services/labelDownloadService.js',
        ];
        const registered = new Set();
        for (const rel of mainFiles) {
            const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
            for (const m of src.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)) {
                registered.add(m[1]);
            }
            for (const m of src.matchAll(/(?:\.send|sendProgress)\(\s*['"]([^'"]+)['"]/g)) {
                registered.add(m[1]);
            }
            for (const m of src.matchAll(/['"](gis\.labels\.(?:import|download)Progress)['"]/g)) {
                registered.add(m[1]);
            }
        }

        const unhandled = [...invoked].filter((ch) => !registered.has(ch));
        expect(unhandled).toEqual([]);
    });

    test('Electron security configuration enforces contextIsolation, blocks nodeIntegration & insecure content', () => {
        const mainSrc = fs.readFileSync(path.join(ROOT, 'electron-main.js'), 'utf8');
        expect(mainSrc).toMatch(/contextIsolation:\s*true/);
        expect(mainSrc).toMatch(/nodeIntegration:\s*false/);
        expect(mainSrc).toMatch(/enableWebSQL:\s*false/);
        expect(mainSrc).not.toMatch(/webSecurity:\s*false/);
        expect(mainSrc).not.toMatch(/allowRunningInsecureContent:\s*true/);
        expect(mainSrc).not.toMatch(/ignore-certificate-errors/);
        expect(mainSrc).toMatch(/setWindowOpenHandler/);
        expect(mainSrc).toMatch(/setPermissionRequestHandler/);
    });

    test('brand assets exist with valid PNG, ICO, and ICNS binary signatures', () => {
        const pngHead = fs.readFileSync(path.join(ROOT, 'build/icon.png')).subarray(0, 8);
        expect(Array.from(pngHead)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

        const icoHead = fs.readFileSync(path.join(ROOT, 'build/icon.ico')).subarray(0, 4);
        expect(Array.from(icoHead)).toEqual([0x00, 0x00, 0x01, 0x00]);

        const icnsHead = fs.readFileSync(path.join(ROOT, 'build/icon.icns')).subarray(0, 4).toString('ascii');
        expect(icnsHead).toBe('icns');

        for (const size of [16, 32, 48, 64, 128, 256, 512, 1024, 2048, 4096]) {
            expect(fs.existsSync(path.join(ROOT, `build/icons/icon-${size}.png`))).toBe(true);
        }
        expect(fs.existsSync(path.join(ROOT, 'public/assets/meridian-icon.svg'))).toBe(true);
    });

    test('generate-webpack-entry preserves dependency order and isolates standalone UMD vendors', () => {
        const tmpEntry = path.join(ROOT, 'webpack-entry.test-tmp.js');
        try {
            const { scripts } = generateWebpackEntry({ outFile: tmpEntry, silent: true });
            expect(scripts.length).toBeGreaterThanOrEqual(100);
            expect(scripts).toContain('js/core/b3dmFeatureExtractor.js');
            expect(scripts).toContain('js/core/advancedTileLoading.js');
            expect(scripts).toContain('js/features/collaborationManager.js');
            expect(scripts).toContain('js/gis/offlineVectorTileProvider.js');
            expect(scripts).not.toContain('js/vendor/knockout-min.js');
            expect(scripts).not.toContain('lib/xlsx/xlsx.full.min.js');
            expect(scripts[scripts.length - 1]).toBe('js/app.js');
        } finally {
            if (fs.existsSync(tmpEntry)) fs.unlinkSync(tmpEntry);
        }
    });

    test('NavigationManager records camera history, handles WASD/QE/R/F shortcuts, and CSV upload parses cleanly', () => {
        require('../../public/js/navigation/navigationManager');
        require('../../public/js/features/modelAndLayerUploadManager');

        const moveEnd = new Cesium.Event();
        const calls = [];
        const camera = {
            position: Cesium.Cartesian3.fromDegrees(4.9, 52.37, 500),
            positionCartographic: { longitude: 0.085, latitude: 0.914, height: 500 },
            heading: 0,
            pitch: -0.5,
            roll: 0,
            moveEnd,
            setView(opts) {
                this.position = Cesium.Cartesian3.clone(opts.destination);
                this.heading = opts.orientation?.heading ?? this.heading;
            },
            moveForward: (d) => calls.push(['forward', d]),
            moveLeft: (d) => calls.push(['left', d]),
            lookRight: (a) => calls.push(['lookRight', a]),
        };

        window.tilesetViewer = {
            viewer: { camera, scene: { requestRender: () => {} } },
            getAllTilesets: () => [],
            fitToView: async () => true,
        };

        const nm = window.navigationManager;
        nm.history = [];
        nm.historyIndex = -1;
        nm._historyBound = false;
        nm.tilesetViewer = window.tilesetViewer;
        nm.bindCameraHistory();
        expect(nm.history).toHaveLength(1);

        // Simulate user panning to a second location
        camera.position = Cesium.Cartesian3.fromDegrees(4.95, 52.4, 600);
        camera.heading = 1.2;
        moveEnd.raiseEvent();
        expect(nm.history).toHaveLength(2);
        expect(nm.navigateBack()).toBe(true);
        expect(camera.heading).toBe(0);
        expect(nm.navigateForward()).toBe(true);
        expect(camera.heading).toBe(1.2);

        // Keyboard controls fire on viewport, ignored inside <input>
        nm.bindGlobalShortcuts();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' }));
        expect(calls.some((c) => c[0] === 'forward' && c[1] > 0)).toBe(true);
        expect(calls.some((c) => c[0] === 'lookRight')).toBe(true);

        const countBefore = calls.length;
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true }));
        expect(calls.length).toBe(countBefore);
        input.remove();

        // CSV upload parser
        const fc = window.modelAndLayerUploadManager.parseCsvToGeoJSON(
            'id,lat,lon,height,label\n1,52.37,4.90,14,"Tower, Main"\n2,52.38,4.91,9,"Annex"\n'
        );
        expect(fc.features).toHaveLength(2);
        expect(fc.features[0].geometry.coordinates).toEqual([4.9, 52.37, 14]);
        expect(fc.features[0].properties.label).toBe('Tower, Main');
    });
});
