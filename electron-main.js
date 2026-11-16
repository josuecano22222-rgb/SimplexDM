/**
 * Electron Main Process
 * 
 * This module handles the Electron main process responsibilities including:
 * - Application lifecycle management
 * - Window creation and management
 * - IPC (Inter-Process Communication) handlers
 * - Local HTTP server lifecycle
 * - Content Security Policy configuration
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
 * Get the correct application path (handles both development and packaged apps)
 * 
 * In packaged apps, app.getAppPath() returns the path to app.asar or resources/app.
 * In development, __dirname works fine.
 * 
 * @returns {string} Absolute path to the application directory
 */
function getAppPath() {
    // In packaged apps, app.getAppPath() returns the path to app.asar or resources/app
    // In development, __dirname works fine
    if (app.isPackaged) {
        return app.getAppPath();
    }
    return __dirname;
}

/**
 * Start local HTTP server (runs inline in main process)
 * 
 * The server is started directly in the main process (not as a separate process)
 * to avoid issues with ASAR packaging and file system access. The server handles:
 * - Serving static files from the public/ directory
 * - Serving tileset files from the data/ directory
 * - Handling file requests via /file endpoint
 * - CORS headers for local development
 * 
 * The function automatically finds an available port starting from 8000.
 * 
 * @returns {Promise<number>} Promise that resolves with the server port number
 * @throws {Error} If server fails to start or times out
 */
function startServer() {
    return new Promise((resolve, reject) => {
        const appPath = getAppPath();
        
        if (process.env.NODE_ENV === 'development') {
            console.log('App path:', appPath);
            console.log('Is packaged:', app.isPackaged);
        }
        
        // Set environment variables for the server module
        process.env.APP_PATH = appPath;
        process.env.IS_PACKAGED = app.isPackaged ? 'true' : 'false';
        
        // Try to find available port
        const checkPort = (port) => {
            const testServer = http.createServer();
            testServer.listen(port, () => {
                testServer.close(() => {
                    serverPort = port;
                    process.env.PORT = port.toString();
                    
                    // Try to load and start server inline
                    try {
                        // Try unpacked location first (if exists), then regular location
                        let serverModule;
                        if (app.isPackaged) {
                            const unpackedServerPath = path.join(path.dirname(appPath), 'app.asar.unpacked', 'server', 'server.js');
                            if (fs.existsSync(unpackedServerPath)) {
                                // Clear require cache to ensure fresh load
                                delete require.cache[unpackedServerPath];
                                serverModule = require(unpackedServerPath);
                            } else {
                                // Try regular location (inside asar)
                                const regularServerPath = path.join(appPath, 'server', 'server.js');
                                delete require.cache[regularServerPath];
                                serverModule = require(regularServerPath);
                            }
                        } else {
                            // Development mode
                            const serverPath = path.join(appPath, 'server', 'server.js');
                            delete require.cache[serverPath];
                            serverModule = require(serverPath);
                        }
                        
                        // Start the server
                        serverModule.startServer((err, serverInstance) => {
                            if (err) {
                                console.error('Failed to start server:', err);
                                reject(err);
                                return;
                            }
                            
                            // Store reference to server for cleanup
                            serverProcess = serverInstance;
                            
                            // Verify server is responding
                            const checkServer = (attempts = 0) => {
                                if (attempts > 20) { // 10 seconds max wait
                                    reject(new Error('Server failed to start - timeout'));
                                    return;
                                }
                                
                                // Try to connect to the server
                                const testReq = http.get(`http://localhost:${serverPort}`, (res) => {
                                    if (process.env.NODE_ENV === 'development') {
                                        console.log(`HTTP server started successfully on port ${serverPort}`);
                                    }
                                    resolve(serverPort);
                                });
                                
                                testReq.on('error', () => {
                                    // Server not ready yet, try again
                                    setTimeout(() => checkServer(attempts + 1), 500);
                                });
                            };
                            
                            // Start checking after a short delay
                            setTimeout(() => checkServer(), 500);
                        });
                    } catch (err) {
                        console.error('Failed to load server module:', err);
                        reject(err);
                    }
                });
            });
            
            testServer.on('error', () => {
                // Port in use, try next port
                checkPort(port + 1);
            });
        };
        
        checkPort(8000);
    });
}

/**
 * Create and configure the main application window
 * 
 * Creates a BrowserWindow with appropriate settings for the 3D viewer:
 * - Large default size (1920x1080) with minimum constraints
 * - Context isolation enabled for security
 * - Preload script for secure IPC bridge
 * - Content Security Policy configured for CesiumJS
 * - DevTools enabled in development mode
 * 
 * The window loads the application from the local HTTP server.
 * 
 * @returns {void}
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
            webSecurity: true,
            // Allow unsafe-eval for CesiumJS (required for WebGL shaders)
            // This is acceptable for a desktop application
            allowRunningInsecureContent: false
        },
        icon: path.join(getAppPath(), 'build', 'icon.png'),
        show: false // Don't show until ready
    });

    // Keep base Meridian interface by default.
    // Enable SIM interface only when SIMPLEX_USE_SIM_INTERFACE=1.
    const simModeEnabled = isSimInterfaceEnabled();
    const targetUrl = simModeEnabled
        ? `http://localhost:${serverPort}/sim/index.html`
        : `http://localhost:${serverPort}/index.html`;
    if (process.env.NODE_ENV === 'development') {
        console.log(`Loading UI: ${targetUrl}${simModeEnabled ? ' (set SIMPLEX_USE_SIM_INTERFACE=0 for full Meridian toolbar)' : ''}`);
    }
    mainWindow.loadURL(targetUrl);

    // Avoid extra Electron windows: navigate the main window or use the system browser
    mainWindow.webContents.setWindowOpenHandler((details) => {
        const url = details.url || '';
        try {
            const u = new URL(url);
            const isLocal =
                u.hostname === 'localhost' ||
                u.hostname === '127.0.0.1' ||
                u.protocol === 'file:';
            if (isLocal) {
                setImmediate(() => {
                    if (!mainWindow.isDestroyed()) {
                        mainWindow.loadURL(url);
                    }
                });
                return { action: 'deny' };
            }
            shell.openExternal(url);
        } catch {
            if (url) {
                shell.openExternal(url);
            }
        }
        return { action: 'deny' };
    });

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        
        // Open DevTools in development
        if (process.env.NODE_ENV === 'development') {
            mainWindow.webContents.openDevTools();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Handle window errors
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('Failed to load:', errorCode, errorDescription);
        console.error('URL:', validatedURL);
        
        // Show error to user if server isn't running
        if (errorCode === -105 || errorCode === -106) { // ERR_NAME_NOT_RESOLVED or ERR_INTERNET_DISCONNECTED
            mainWindow.webContents.executeJavaScript(`
                document.body.innerHTML = \`
                    <div style="display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; font-family: Arial, sans-serif; color: white; background: #1a1a1a;">
                        <h1 style="color: #ff4444;">Failed to Connect to Server</h1>
                        <p>Error: ${errorDescription}</p>
                        <p>Server Port: ${serverPort}</p>
                        <p style="margin-top: 20px;">Please check:</p>
                        <ul style="text-align: left;">
                            <li>Server is running (check main console)</li>
                            <li>Port ${serverPort} is not blocked</li>
                            <li>Open DevTools (F12) for details</li>
                        </ul>
                    </div>
                \`;
            `);
        }
    });
    
    // Log console messages from renderer for debugging
    // Filter out CSP warnings since we intentionally use unsafe-eval for CesiumJS
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        // Skip CSP warnings - we intentionally use unsafe-eval for CesiumJS WebGL shaders
        const messageStr = String(message || '');
        if (messageStr.includes('Content Security Policy') || 
            messageStr.includes('Insecure Content-Security-Policy') ||
            (messageStr.includes('unsafe-eval') && messageStr.includes('Security Warning'))) {
            return; // Suppress CSP warnings - intentional for CesiumJS
        }
        if (level >= 2) { // Warning or error
            console.log(`[Renderer ${level === 2 ? 'WARN' : 'ERROR'}]`, message);
        }
    });
    
    // Handle JavaScript errors in renderer
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('Renderer process crashed:', details);
    });
    
    mainWindow.webContents.setDevToolsWebContents = () => {}; // Prevent errors
}

/**
 * Application initialization
 * 
 * Sets up the application when Electron is ready:
 * 1. Configures Content Security Policy for CesiumJS workers
 * 2. Starts the local HTTP server
 * 3. Creates the main application window
 * 4. Sets up window activation handlers
 * 
 * @event app#whenReady
 */
app.whenReady().then(async () => {
    try {
        // Deny all permission requests for security
        // This prevents the app from requesting camera, microphone, geolocation, notifications, network, etc.
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
            // Only log unexpected permission requests in development
            if (process.env.NODE_ENV === 'development' && 
                !['media', 'geolocation', 'notifications', 'background-sync', 'web-app-installation'].includes(permission)) {
                console.log(`Permission request denied: ${permission}`);
            }
            // Explicitly deny network-related permissions
            if (permission === 'media' || permission === 'geolocation' || permission === 'notifications' || 
                permission === 'midi' || permission === 'pointerLock' || permission === 'fullscreen' ||
                permission === 'openExternal') {
                callback(false);
                return;
            }
            // Deny all other permission requests
            callback(false);
        });
        
        // Deny all permission check results (for permissions that were previously granted)
        session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
            // Only log unexpected permission checks in development
            if (process.env.NODE_ENV === 'development' && 
                !['media', 'geolocation', 'notifications', 'background-sync', 'web-app-installation'].includes(permission)) {
                console.log(`Permission check denied: ${permission} from ${requestingOrigin}`);
            }
            // Deny all permission checks, especially network-related ones
            return false;
        });
        
        const simModeEnabled = isSimInterfaceEnabled();
        const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
        if (simModeEnabled) {
            // SIM uses Cesium CDN + OSM tiles in its stock index.html.
            allowedHosts.add('cesium.com');
            allowedHosts.add('tile.openstreetmap.org');
        }

        // Block all other network requests.
        session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
            const url = new URL(details.url);
            if (!allowedHosts.has(url.hostname)) {
                // Don't log devtools:// URLs as they're expected to be blocked
                if (!details.url.startsWith('devtools://') && process.env.NODE_ENV === 'development') {
                    console.log(`Blocked external network request: ${details.url}`);
                }
                callback({ cancel: true });
                return;
            }
            callback({});
        });
        
        // Configure Content Security Policy
        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            const cspConnect = simModeEnabled
                ? "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://cesium.com https://tile.openstreetmap.org data: blob:;"
                : "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* data: blob:;";
            const cspStyle = simModeEnabled
                ? "style-src 'self' 'unsafe-inline' https://cesium.com;"
                : "style-src 'self' 'unsafe-inline';";
            const cspScript = simModeEnabled
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cesium.com blob:;"
                : "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:;";
            const cspImage = simModeEnabled
                ? "img-src 'self' http://localhost:* http://127.0.0.1:* https://tile.openstreetmap.org https://cesium.com data: blob:;"
                : "img-src 'self' http://localhost:* http://127.0.0.1:* data: blob:;";
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
                        cspConnect
                    ]
                }
            });
        });
        
        // Expose SIM path override to the local server.
        process.env.SIM_PROJECT_DIR = getSimProjectDir();

        // Start HTTP server first
        await startServer();
        
        // Create window
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

// Quit when all windows are closed
app.on('window-all-closed', () => {
    // Stop server (it's now an HTTP server instance, not a process)
    if (serverProcess && typeof serverProcess.close === 'function') {
        serverProcess.close();
        serverProcess = null;
    }
    
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Handle application quit
app.on('before-quit', () => {
    if (serverProcess && typeof serverProcess.close === 'function') {
        serverProcess.close();
        serverProcess = null;
    }
});

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * IPC Handler: Get Server Port
 * 
 * Returns the port number on which the local HTTP server is running.
 * Used by the renderer process to construct URLs for file requests.
 * 
 * @returns {number} Server port number
 */
ipcMain.handle('get-server-port', () => {
    return serverPort;
});

/**
 * IPC Handler: Get Application Version
 * 
 * Returns the application version from package.json.
 * 
 * @returns {string} Application version string
 */
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

/**
 * IPC Handler: Get Application Path
 * 
 * Returns the user data directory path where application data is stored.
 * 
 * @returns {string} Absolute path to user data directory
 */
ipcMain.handle('get-app-path', () => {
    return app.getPath('userData');
});

// ============================================================================
// GIS IPC Handlers
// ============================================================================
registerGisIpc({ ipcMain, app, dialog });
