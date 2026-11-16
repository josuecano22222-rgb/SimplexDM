/**
 * Electron Main Process
 *
 * Handles application lifecycle, BrowserWindow security configuration,
 * local loopback HTTP server startup, Content Security Policy, and
 * IPC registration (including offline GIS and map-label services).
 *
 * @module ElectronMain
 * @requires electron
 * @requires path
 * @requires fs
 * @requires http
 */

const { app, BrowserWindow, ipcMain, session, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { registerGisIpc } = require('./main/gis/registerGisIpc');

/** @type {BrowserWindow|null} Main application window instance */
let mainWindow = null;

/** @type {http.Server|null} HTTP server instance for serving static files */
let serverProcess = null;

/** @type {number} Port number for the local HTTP server (default: 8000) */
let serverPort = 8000;

/** Hostnames allowed for online OSM basemap & geocoding fallback when offline assets are absent */
const OSM_TILE_HOSTS = new Set([
    'tile.openstreetmap.org',
    'a.tile.openstreetmap.org',
    'b.tile.openstreetmap.org',
    'c.tile.openstreetmap.org',
    'nominatim.openstreetmap.org',
]);

/** Safe URL schemes permitted through webRequest without hostname checks */
const INTERNAL_SAFE_PROTOCOLS = new Set(['blob:', 'data:', 'devtools:', 'chrome-extension:']);

/** Permissions granted only to the local loopback viewer origin */
const LOCAL_ALLOWED_PERMISSIONS = new Set([
    'fullscreen',
    'pointerLock',
    'clipboard-sanitized-write',
]);

function isLocalAppOrigin(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'http:') return false;
        const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
        if (!isLoopback) return false;
        return Number(parsed.port) === Number(serverPort);
    } catch (_) {
        return false;
    }
}

function getSimProjectDir() {
    return process.env.SIM_PROJECT_DIR || path.join(getAppPath(), 'sim');
}

function getSimIndexFile() {
    return path.join(getSimProjectDir(), 'index.html');
}

function isSimInterfaceEnabled() {
    const flag = process.env.SIMPLEX_USE_SIM_INTERFACE === '1';
    return flag && fs.existsSync(getSimIndexFile());
}

/**
 * Get the application path (handles both development and ASAR-packaged builds).
 * @returns {string}
 */
function getAppPath() {
    if (app.isPackaged) {
        return app.getAppPath();
    }
    return __dirname;
}

/**
 * Start the local loopback HTTP server inline in the main process.
 * Automatically probes from port 8000 upward until a free loopback port is found.
 *
 * @returns {Promise<number>} Listening port number
 */
function startServer() {
    return new Promise((resolve, reject) => {
        const appPath = getAppPath();

        if (process.env.NODE_ENV === 'development') {
            console.log('App path:', appPath);
            console.log('Is packaged:', app.isPackaged);
        }

        process.env.APP_PATH = appPath;
        process.env.HOST = '127.0.0.1';
        process.env.IS_PACKAGED = app.isPackaged ? 'true' : 'false';

        const MAX_PORT = 8100;

        const checkPort = (port) => {
            if (port > MAX_PORT) {
                reject(new Error(`No free loopback port found between 8000 and ${MAX_PORT}`));
                return;
            }
            const testServer = http.createServer();
            testServer.once('error', () => {
                checkPort(port + 1);
            });
            testServer.listen(port, '127.0.0.1', () => {
                testServer.close(() => {
                    serverPort = port;
                    process.env.PORT = port.toString();

                    try {
                        let serverModulePath = path.join(appPath, 'server', 'server.js');
                        if (app.isPackaged) {
                            const unpackedServerPath = path.join(
                                path.dirname(appPath),
                                'app.asar.unpacked',
                                'server',
                                'server.js'
                            );
                            if (fs.existsSync(unpackedServerPath)) {
                                serverModulePath = unpackedServerPath;
                            }
                        }

                        delete require.cache[serverModulePath];
                        const serverModule = require(serverModulePath);

                        serverModule.startServer((err, serverInstance) => {
                            if (err) {
                                console.error('Failed to start server:', err);
                                reject(err);
                                return;
                            }

                            serverProcess = serverInstance;

                            const checkServer = (attempts = 0) => {
                                if (attempts > 20) {
                                    reject(new Error('Server failed to respond before timeout'));
                                    return;
                                }

                                const testReq = http.get(`http://127.0.0.1:${serverPort}/`, (res) => {
                                    res.resume();
                                    if (process.env.NODE_ENV === 'development') {
                                        console.log(`HTTP server started on http://127.0.0.1:${serverPort}`);
                                    }
                                    resolve(serverPort);
                                });

                                testReq.on('error', () => {
                                    setTimeout(() => checkServer(attempts + 1), 250);
                                });
                            };

                            setTimeout(() => checkServer(), 100);
                        });
                    } catch (err) {
                        console.error('Failed to load server module:', err);
                        reject(err);
                    }
                });
            });
        };

        checkPort(8000);
    });
}

/**
 * Create and configure the main application BrowserWindow.
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        minWidth: 1280,
        minHeight: 720,
        webPreferences: {
            preload: path.join(getAppPath(), 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            enableWebSQL: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
        },
        icon: path.join(getAppPath(), 'build', 'icon.png'),
        show: false,
    });

    const simModeEnabled = isSimInterfaceEnabled();
    const targetUrl = simModeEnabled
        ? `http://localhost:${serverPort}/sim/index.html`
        : `http://localhost:${serverPort}/index.html`;
    if (process.env.NODE_ENV === 'development') {
        console.log(
            `Loading UI: ${targetUrl}${
                simModeEnabled ? ' (set SIMPLEX_USE_SIM_INTERFACE=0 for full Meridian toolbar)' : ''
            }`
        );
    }
    mainWindow.loadURL(targetUrl);

    // Restrict popups: same-origin local pages navigate in-place; only http(s) open externally.
    mainWindow.webContents.setWindowOpenHandler((details) => {
        const rawUrl = details.url || '';
        try {
            const parsed = new URL(rawUrl);
            if (isLocalAppOrigin(rawUrl)) {
                setImmediate(() => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.loadURL(rawUrl);
                    }
                });
                return { action: 'deny' };
            }
            if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
                shell.openExternal(parsed.toString()).catch(() => {});
            }
        } catch (_) {
            /* Reject malformed or dangerous schemes */
        }
        return { action: 'deny' };
    });

    // Block accidental top-level navigation to external or file:// URLs
    mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        if (!isLocalAppOrigin(navigationUrl)) {
            event.preventDefault();
            try {
                const parsed = new URL(navigationUrl);
                if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
                    shell.openExternal(parsed.toString()).catch(() => {});
                }
            } catch (_) {
                /* ignore */
            }
        }
    });

    mainWindow.once('ready-to-show', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            if (process.env.NODE_ENV === 'development') {
                mainWindow.webContents.openDevTools();
            }
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        console.error('Failed to load:', errorCode, errorDescription, 'URL:', validatedURL);

        // ERR_CONNECTION_REFUSED (-102), ERR_NAME_NOT_RESOLVED (-105), ERR_INTERNET_DISCONNECTED (-106)
        if ((errorCode === -102 || errorCode === -105 || errorCode === -106) && mainWindow && !mainWindow.isDestroyed()) {
            const safeDesc = JSON.stringify(String(errorDescription || 'Unknown error'));
            const safePort = Number(serverPort) || 8000;
            mainWindow.webContents
                .executeJavaScript(`
                    (function () {
                        const root = document.createElement('div');
                        root.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;font-family:system-ui,sans-serif;color:#fff;background:#1a1a1a;padding:24px;text-align:center;';
                        const h1 = document.createElement('h1');
                        h1.style.color = '#ff5252';
                        h1.textContent = 'Failed to Connect to Local Server';
                        const errP = document.createElement('p');
                        errP.textContent = 'Error: ' + ${safeDesc};
                        const portP = document.createElement('p');
                        portP.textContent = 'Server Port: ' + ${safePort};
                        const tipP = document.createElement('p');
                        tipP.style.marginTop = '16px';
                        tipP.textContent = 'Verify the local server is running and port ' + ${safePort} + ' is available (press F12 for DevTools).';
                        root.append(h1, errP, portP, tipP);
                        document.body.replaceChildren(root);
                    })();
                `)
                .catch(() => {});
        }
    });

    mainWindow.webContents.on('console-message', (_event, level, message) => {
        const messageStr = String(message || '');
        if (
            messageStr.includes('Content Security Policy') ||
            messageStr.includes('Insecure Content-Security-Policy') ||
            (messageStr.includes('unsafe-eval') && messageStr.includes('Security Warning'))
        ) {
            return;
        }
        if (level >= 2) {
            console.log(`[Renderer ${level === 2 ? 'WARN' : 'ERROR'}]`, message);
        }
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error('Renderer process crashed:', details);
    });

    mainWindow.webContents.setDevToolsWebContents = () => {};
}

app.whenReady().then(async () => {
    try {
        // Permit only safe UI permissions (fullscreen, pointer lock for flight mode, clipboard copy)
        // for the local loopback viewer; deny camera, microphone, geolocation, MIDI, notifications, etc.
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
            const originUrl = webContents ? webContents.getURL() : '';
            if (LOCAL_ALLOWED_PERMISSIONS.has(permission) && isLocalAppOrigin(originUrl)) {
                callback(true);
                return;
            }
            callback(false);
        });

        session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
            return LOCAL_ALLOWED_PERMISSIONS.has(permission) && isLocalAppOrigin(requestingOrigin);
        });

        const simModeEnabled = isSimInterfaceEnabled();
        const offlineStrict = process.env.SIMPLEX_STRICT_OFFLINE === '1';
        const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
        if (!offlineStrict) {
            for (const host of OSM_TILE_HOSTS) {
                allowedHosts.add(host);
            }
        }
        if (simModeEnabled) {
            allowedHosts.add('cesium.com');
        }

        // Restrict outbound renderer traffic to local loopback, safe internal schemes (blob:/data:/devtools:),
        // and optional OpenStreetMap tile hosts for documented online basemap fallback.
        session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
            try {
                const parsed = new URL(details.url);
                if (INTERNAL_SAFE_PROTOCOLS.has(parsed.protocol)) {
                    callback({});
                    return;
                }
                if (allowedHosts.has(parsed.hostname)) {
                    callback({});
                    return;
                }
            } catch (_) {
                /* Cancel unparseable URLs */
            }
            if (process.env.NODE_ENV === 'development') {
                console.log(`Blocked external network request: ${details.url}`);
            }
            callback({ cancel: true });
        });

        const osmCsp = offlineStrict
            ? ''
            : ' https://tile.openstreetmap.org https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org';
        const nominatimCsp = offlineStrict ? '' : ' https://nominatim.openstreetmap.org';

        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            const cspConnect = simModeEnabled
                ? `connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://cesium.com${osmCsp}${nominatimCsp} data: blob:;`
                : `connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*${osmCsp}${nominatimCsp} data: blob:;`;
            const cspStyle = simModeEnabled
                ? "style-src 'self' 'unsafe-inline' https://cesium.com;"
                : "style-src 'self' 'unsafe-inline';";
            const cspScript = simModeEnabled
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cesium.com blob:;"
                : "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:;";
            const cspImage = simModeEnabled
                ? `img-src 'self' http://localhost:* http://127.0.0.1:* https://cesium.com${osmCsp} data: blob:;`
                : `img-src 'self' http://localhost:* http://127.0.0.1:*${osmCsp} data: blob:;`;
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    'Content-Security-Policy': [
                        "default-src 'self' http://localhost:* http://127.0.0.1:* data: blob:; " +
                            `${cspScript} ` +
                            "worker-src 'self' blob:; " +
                            `${cspStyle} ` +
                            `${cspImage} ` +
                            "font-src 'self' data:; " +
                            cspConnect,
                    ],
                },
            });
        });

        process.env.SIM_PROJECT_DIR = getSimProjectDir();

        await startServer();
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    } catch (error) {
        console.error('Failed to start application:', error);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (serverProcess && typeof serverProcess.close === 'function') {
        serverProcess.close();
        serverProcess = null;
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    if (serverProcess && typeof serverProcess.close === 'function') {
        serverProcess.close();
        serverProcess = null;
    }
});

// ============================================================================
// IPC Handlers
// ============================================================================

ipcMain.handle('get-server-port', () => serverPort);
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-app-path', () => app.getPath('userData'));

ipcMain.handle('dialog:open-file', async (_event, opts = {}) => {
    const allowedProps = new Set(['openFile', 'openDirectory', 'multiSelections']);
    const requestedProps = Array.isArray(opts?.properties)
        ? opts.properties.filter((p) => allowedProps.has(p))
        : ['openFile'];
    const dialogOpts = {
        title: typeof opts?.title === 'string' ? opts.title : 'Select File',
        properties: requestedProps.length ? requestedProps : ['openFile'],
    };
    if (Array.isArray(opts?.filters) && opts.filters.length > 0) {
        dialogOpts.filters = opts.filters
            .filter((f) => f && typeof f.name === 'string' && Array.isArray(f.extensions))
            .map((f) => ({
                name: f.name,
                extensions: f.extensions.map((e) => String(e).replace(/^\./, '')),
            }));
    }
    const result = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, dialogOpts)
        : await dialog.showOpenDialog(dialogOpts);
    return {
        canceled: Boolean(result.canceled),
        filePaths: Array.isArray(result.filePaths) ? result.filePaths : [],
    };
});

// ============================================================================
// GIS IPC Handlers
// ============================================================================
registerGisIpc({ ipcMain, app, dialog });
