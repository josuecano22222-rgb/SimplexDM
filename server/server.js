/**
 * Local HTTP Server
 * 
 * This module provides a local HTTP server that runs in the Electron main process.
 * It serves static files from the public/ directory and handles file system access
 * for tileset data. The server is necessary because:
 * 
 * 1. CesiumJS requires files to be served via HTTP (not file:// protocol)
 * 2. File system access needs to work in both development and packaged modes
 * 3. ASAR packaging requires special handling for server files
 * 
 * Key features:
 * - Serves static files from public/ directory
 * - Serves tileset files from data/ directory
 * - Handles /file endpoint for arbitrary file paths
 * - Case-insensitive path resolution for Windows compatibility
 * - Tileset directory tracking for relative path resolution
 * - CORS headers for local development
 * 
 * @module Server
 * @requires http
 * @requires fs
 * @requires path
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

/** Verbose path/tile tracing (set SIMPLEX_SERVER_VERBOSE=1 or NODE_ENV=development) */
const SERVER_VERBOSE =
    process.env.SIMPLEX_SERVER_VERBOSE === '1' ||
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test';
function serverLog(...args) {
    if (SERVER_VERBOSE) {
        console.log(...args);
    }
}

/**
 * Get the server port from environment variable
 * 
 * The port is set by electron-main.js before requiring this module.
 * Defaults to 8000 if not specified.
 * 
 * @returns {number} Server port number
 */
function getPort() {
    return parseInt(process.env.PORT || '8000', 10);
}

/**
 * Application path (set by electron-main.js)
 * In packaged apps, this points to the correct location (app.asar or unpacked)
 * 
 * @type {string}
 */
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '..');

/**
 * Whether the application is packaged (ASAR)
 * 
 * @type {boolean}
 */
const IS_PACKAGED = process.env.IS_PACKAGED === 'true';

// Resolve directories based on app path
// In packaged builds, prefer public-bundled if it exists, otherwise fall back to public
let PUBLIC_DIR = path.join(APP_PATH, 'public-bundled');
if (!fs.existsSync(PUBLIC_DIR)) {
    PUBLIC_DIR = path.join(APP_PATH, 'public');
}

// Resolve DATA_DIR - in packaged apps, data might be in multiple locations
let DATA_DIR = path.join(APP_PATH, 'data');
const SIM_PROJECT_DIR = process.env.SIM_PROJECT_DIR || path.join(APP_PATH, 'sim');
const HAS_SIM_PROJECT = Boolean(SIM_PROJECT_DIR) && fs.existsSync(SIM_PROJECT_DIR);

if (IS_PACKAGED) {
    // In packaged apps, extraFiles places data at [InstallDir]/resources/data/
    // Check multiple possible locations:
    // 1. [InstallDir]/resources/data/ (where extraFiles puts it)
    // 2. [InstallDir]/resources/app.asar.unpacked/data/ (if unpacked)
    // 3. [InstallDir]/resources/app/data/ (fallback)
    // 4. [InstallDir]/resources/app.asar/data/ (inside asar, read-only)
    
    const resourcesDir = path.dirname(APP_PATH); // [InstallDir]/resources/
    const possibleDataDirs = [
        path.join(resourcesDir, 'data'), // extraFiles location
        path.join(resourcesDir, 'app.asar.unpacked', 'data'), // unpacked location
        path.join(resourcesDir, 'app', 'data'), // fallback location
        path.join(APP_PATH, 'data') // inside asar (read-only, but check anyway)
    ];
    
    // Find the first existing data directory
    for (const possibleDir of possibleDataDirs) {
        if (fs.existsSync(possibleDir)) {
            DATA_DIR = possibleDir;
            serverLog(`Found data directory at: ${DATA_DIR}`);
            break;
        }
    }
    
    // If none found, use the default but log a warning
    if (!fs.existsSync(DATA_DIR)) {
        console.warn(`Data directory not found in any expected location. Using default: ${DATA_DIR}`);
        console.warn('Expected locations:', possibleDataDirs);
    } else {
        // Verify offline maps directory exists
        const tilesDir = path.join(DATA_DIR, 'tiles', 'raster');
        const metaFile = path.join(DATA_DIR, 'tiles', 'meta.json');
        
        if (fs.existsSync(tilesDir)) {
            serverLog(`✓ Offline maps directory found: ${tilesDir}`);
            
            // Check for sample tile to verify structure
            const sampleTile = path.join(tilesDir, '0', '0', '0.png');
            if (fs.existsSync(sampleTile)) {
                serverLog(`✓ Sample tile found: ${sampleTile}`);
            } else {
                console.warn(`⚠ Sample tile not found at: ${sampleTile}`);
                console.warn('  Offline maps may not be properly installed.');
            }
        } else {
            console.warn(`⚠ Offline maps directory not found: ${tilesDir}`);
            console.warn('  Maps will not be available. Install maps to: [InstallDir]/resources/data/tiles/raster/');
        }
        
        if (fs.existsSync(metaFile)) {
            serverLog(`✓ Map metadata found: ${metaFile}`);
        } else {
            console.warn(`⚠ Map metadata not found: ${metaFile}`);
        }
    }
}

serverLog('Server starting...');
serverLog('APP_PATH:', APP_PATH);
serverLog('IS_PACKAGED:', IS_PACKAGED);
serverLog('PUBLIC_DIR:', PUBLIC_DIR);
serverLog('DATA_DIR:', DATA_DIR);
serverLog('PUBLIC_DIR exists:', fs.existsSync(PUBLIC_DIR));
serverLog('DATA_DIR exists:', fs.existsSync(DATA_DIR));
serverLog('SIM_PROJECT_DIR:', SIM_PROJECT_DIR || '(not set)');
serverLog('SIM_PROJECT_DIR exists:', HAS_SIM_PROJECT);

/**
 * Find file path case-insensitively
 * 
 * This function performs case-insensitive path resolution, which is important
 * for Windows compatibility where file systems are case-insensitive but paths
 * in tileset JSON files may have different casing.
 * 
 * @param {string} baseDir - Base directory to start search from
 * @param {string[]} pathParts - Array of path components to resolve
 * @returns {string|null} Resolved path if found, null otherwise
 */
function findCaseInsensitivePath(baseDir, pathParts) {
    let currentPath = baseDir;
    
    for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        if (!part || part === '.') continue;
        
        try {
            if (!fs.existsSync(currentPath)) {
                return null;
            }
            
            const stats = fs.statSync(currentPath);
            if (!stats.isDirectory()) {
                return null; // Expected directory but found file
            }
            
            const entries = fs.readdirSync(currentPath);
            const found = entries.find(e => e.toLowerCase() === part.toLowerCase());
            
            if (!found) {
                // Try to find with different case patterns
                // Sometimes Windows preserves case differently
                const altFound = entries.find(e => {
                    const eLower = e.toLowerCase();
                    const partLower = part.toLowerCase();
                    return eLower === partLower || 
                           eLower.replace(/_/g, '') === partLower.replace(/_/g, '');
                });
                
                if (!altFound) {
                    return null; // Part not found
                }
                
                currentPath = path.join(currentPath, altFound);
            } else {
                currentPath = path.join(currentPath, found);
            }
        } catch (e) {
            // Directory read failed
            return null;
        }
    }
    
    return currentPath;
}

/**
 * If an exact tile path is missing (encoding, apostrophe in JSON vs disk, etc.),
 * try case-insensitive match and a few safe filename variants inside the same directory.
 *
 * @param {string} absolutePath - Normalized absolute path that failed stat()
 * @returns {string|null} An existing file path to serve, or null
 */
function resolveTilesetFileWithFallbacks(absolutePath) {
    const dirPath = path.dirname(absolutePath);
    const baseName = path.basename(absolutePath);
    if (!baseName || !fs.existsSync(dirPath)) {
        return null;
    }

    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
        return absolutePath;
    }

    const tryExact = findCaseInsensitivePath(dirPath, [baseName]);
    if (tryExact && fs.statSync(tryExact).isFile()) {
        serverLog('Resolved tile file (case-insensitive):', tryExact);
        return tryExact;
    }

    const variantNames = new Set([baseName]);
    variantNames.add(baseName.replace(/'/g, ''));
    variantNames.add(baseName.replace(/'/g, '_'));
    variantNames.add(baseName.replace(/\u2019/g, '')); // Unicode right single quote

    let entries;
    try {
        entries = fs.readdirSync(dirPath);
    } catch {
        return null;
    }

    const lowerEntries = entries.map((e) => e.toLowerCase());
    for (const v of variantNames) {
        const idx = lowerEntries.indexOf(v.toLowerCase());
        if (idx >= 0) {
            const candidate = path.join(dirPath, entries[idx]);
            try {
                if (fs.statSync(candidate).isFile()) {
                    serverLog('Resolved tile file (variant name):', candidate, '(was', baseName + ')');
                    return candidate;
                }
            } catch {
                /* continue */
            }
        }
    }

    // Loose match: same characters ignoring apostrophe/underscore differences
    const normalizeLoose = (s) => s.toLowerCase().replace(/['’_]/g, '');
    const looseTarget = normalizeLoose(baseName);
    for (const e of entries) {
        if (normalizeLoose(e) === looseTarget) {
            const candidate = path.join(dirPath, e);
            try {
                if (fs.statSync(candidate).isFile()) {
                    serverLog('Resolved tile file (loose name match):', candidate);
                    return candidate;
                }
            } catch {
                /* continue */
            }
        }
    }

    return null;
}

/**
 * Get MIME type for file extension
 * 
 * Returns the appropriate MIME type for a given file path based on its extension.
 * Includes support for 3D Tiles formats (.b3dm, .i3dm, .pnts, .cmpt) and common
 * web formats.
 * 
 * @param {string} filePath - File path to get MIME type for
 * @returns {string} MIME type string
 */
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.b3dm': 'application/octet-stream',
        '.i3dm': 'application/octet-stream',
        '.pnts': 'application/octet-stream',
        '.cmpt': 'application/octet-stream',
        '.glb': 'model/gltf-binary',
        '.gltf': 'model/gltf+json',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Serve a static file
 * 
 * Reads a file from the file system and serves it with appropriate headers.
 * Sets CORS headers to allow local development and includes proper MIME types.
 * 
 * @param {string} filePath - Absolute path to the file to serve
 * @param {http.ServerResponse} res - HTTP response object
 * @returns {void}
 */
function serveFile(filePath, res) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found');
            return;
        }
        
        const mimeType = getMimeType(filePath);
        res.writeHead(200, { 
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end(data);
    });
}

/**
 * HTTP Server Request Handler
 * 
 * Handles all HTTP requests to the local server. Supports:
 * - Static file serving from public/ directory
 * - Tileset file serving from data/ directory
 * - /file endpoint for arbitrary file paths
 * - Case-insensitive path resolution
 * - Tileset directory tracking for relative paths
 * - CORS preflight requests
 * 
 * Security features:
 * - Path validation to prevent directory traversal
 * - File existence checks before serving
 * - Restricted to public/ and data/ directories
 * 
 * @param {http.IncomingMessage} req - HTTP request object
 * @param {http.ServerResponse} res - HTTP response object
 */
const server = http.createServer((req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }
    
    // Use WHATWG URL API instead of deprecated url.parse
    let filePath;
    let urlObj;
    try {
        urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        filePath = urlObj.pathname;
    } catch (e) {
        // Fallback for malformed URLs
        filePath = req.url.split('?')[0];
    }

    // Lightweight JSON API for editable website content
    // This is used by the marketing/landing pages so content can be updated from within the app.
    if (filePath === '/api/site-content') {
        const contentPath = path.join(DATA_DIR, 'site', 'site-content.json');

        if (req.method === 'GET') {
            fs.readFile(contentPath, 'utf8', (err, raw) => {
                if (err) {
                    res.writeHead(404, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(JSON.stringify({ error: 'site-content not found', path: contentPath }));
                    return;
                }

                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-store'
                });
                res.end(raw);
            });
            return;
        }

        if (req.method === 'POST' || req.method === 'PUT') {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
                if (body.length > 2_000_000) {
                    res.writeHead(413, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(JSON.stringify({ error: 'payload too large' }));
                    req.destroy();
                }
            });
            req.on('end', () => {
                try {
                    const parsed = JSON.parse(body || '{}');
                    const dir = path.dirname(contentPath);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(contentPath, JSON.stringify(parsed, null, 2), 'utf8');
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'Cache-Control': 'no-store'
                    });
                    res.end(JSON.stringify({ ok: true, path: contentPath }));
                } catch (err) {
                    res.writeHead(400, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(JSON.stringify({ error: 'invalid json', message: err.message }));
                }
            });
            return;
        }

        res.writeHead(405, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ error: 'method not allowed' }));
        return;
    }
    
    // Handle /file endpoint for arbitrary file paths
    if (filePath === '/file' || filePath.startsWith('/file/')) {
        let requestedPath;
        
        // Get path from query parameter (preferred) or path segment
        if (urlObj && urlObj.searchParams.has('path')) {
            requestedPath = decodeURIComponent(urlObj.searchParams.get('path'));
        } else if (filePath.startsWith('/file/')) {
            // Extract path from URL path segment (for /file/relative/path format)
            // This is used when Cesium constructs URLs using baseUrl
            const pathSegment = filePath.substring(6); // Remove '/file/'
            // Decode the path segment - handle multiple levels of encoding
            try {
                requestedPath = decodeURIComponent(pathSegment);
                // If still encoded, try again
                if (requestedPath.includes('%')) {
                    requestedPath = decodeURIComponent(requestedPath);
                }
            } catch (e) {
                // If decoding fails, use as-is
                requestedPath = pathSegment;
            }
            
            // Try to resolve relative path using stored tileset directories
            if (!requestedPath.match(/^[A-Za-z]:/)) {
                // Relative path - try to resolve using stored tileset directories
                let resolved = false;
                if (global._tilesetDirs && global._tilesetDirs.size > 0) {
                    for (const tilesetDir of global._tilesetDirs) {
                        const testPath = path.join(tilesetDir, requestedPath);
                        if (fs.existsSync(testPath)) {
                            requestedPath = testPath;
                            resolved = true;
                            serverLog('Resolved relative path using tileset directory:', testPath);
                            break;
                        }
                    }
                }
                
                if (!resolved) {
                    console.warn('Warning: /file/ path segment received (relative path):', pathSegment);
                    console.warn('  Tried to resolve using', global._tilesetDirs?.size || 0, 'tileset directories');
                    console.warn('  Consider using /file?path= format with absolute path');
                    // Try to resolve relative to current working directory as fallback
                    requestedPath = path.resolve(requestedPath);
                }
            }
        } else {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing path parameter. Use /file?path=<file_path>');
            return;
        }
        
        // Handle Windows paths - preserve backslashes for Windows absolute paths
        // For Windows paths (starting with drive letter), keep as-is
        // For relative paths, normalize separators
        // IMPORTANT: Don't modify the path format - Node.js path module handles both \ and /
        if (/^[A-Za-z]:/.test(requestedPath)) {
            // Windows absolute path - Node.js path.resolve handles both \ and / correctly
            // Don't force conversion - let Node.js handle it
        } else {
            // Relative path - normalize to platform separators
            requestedPath = requestedPath.replace(/\//g, path.sep);
        }
        
        // Resolve absolute path
        // For Windows absolute paths, path.resolve will use them as-is
        // For relative paths, resolve against current working directory
        // Use path.resolve which handles both forward and backslashes correctly on Windows
        let absolutePath;
        if (/^[A-Za-z]:/.test(requestedPath)) {
            // Windows absolute path - use as-is (path.resolve handles it correctly)
            absolutePath = path.resolve(requestedPath);
        } else {
            // Relative path - resolve against current working directory
            absolutePath = path.resolve(requestedPath);
        }
        
        // Normalize the resolved path (removes redundant separators, handles . and ..)
        absolutePath = path.normalize(absolutePath);
        
        // Store tileset directory for fallback resolution
        if (!global._tilesetDirs) global._tilesetDirs = new Set();
        try {
            const stats = fs.statSync(absolutePath);
            if (stats.isFile()) {
                // Store the directory containing this file for fallback lookups
                const fileDir = path.dirname(absolutePath);
                global._tilesetDirs.add(fileDir);
                // Keep many roots so split tilesets + multiple masters keep working
                if (global._tilesetDirs.size > 128) {
                    const dirsArray = Array.from(global._tilesetDirs);
                    global._tilesetDirs = new Set(dirsArray.slice(-128));
                }
            }
        } catch (e) {
            // File doesn't exist, continue
        }
        
        serverLog('File request:', {
            requested: requestedPath,
            resolved: absolutePath,
            exists: fs.existsSync(absolutePath),
            isWindows: /^[A-Za-z]:/.test(requestedPath)
        });
        
        // Security: Validate path exists and is a file (with tileset-aware fallbacks)
        let pathToServe = absolutePath;
        try {
            let stats;
            try {
                stats = fs.statSync(pathToServe);
            } catch (firstErr) {
                if (firstErr.code === 'ENOENT') {
                    const alt = resolveTilesetFileWithFallbacks(absolutePath);
                    if (alt) {
                        pathToServe = alt;
                        stats = fs.statSync(pathToServe);
                    } else {
                        throw firstErr;
                    }
                } else {
                    throw firstErr;
                }
            }
            if (!stats.isFile()) {
                console.error('Path is not a file:', pathToServe);
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Path is not a file: ' + pathToServe);
                return;
            }
            
            serverLog('Serving file:', pathToServe);
            serveFile(pathToServe, res);
            return;
        } catch (err) {
            // Enhanced error logging
            const errorDetails = {
                requested: requestedPath,
                resolved: absolutePath,
                error: err.message,
                code: err.code,
                exists: fs.existsSync(absolutePath)
            };
            
            console.error('File access error:', errorDetails);
            
            // Try to provide helpful diagnostics
            if (err.code === 'ENOENT') {
                // File not found - provide helpful diagnostics
                const dirPath = path.dirname(absolutePath);
                const fileName = path.basename(absolutePath);
                const dirExists = fs.existsSync(dirPath);
                
                let errorMessage = `File not found: ${absolutePath}\n`;
                errorMessage += `Requested: ${requestedPath}\n\n`;
                errorMessage += `Diagnostics:\n`;
                errorMessage += `  Directory exists: ${dirExists ? 'Yes' : 'No'}\n`;
                if (dirExists) {
                    try {
                        const files = fs.readdirSync(dirPath);
                        errorMessage += `  Files in directory: ${files.length}\n`;
                        if (files.length > 0 && files.length <= 10) {
                            errorMessage += `  Sample files: ${files.slice(0, 5).join(', ')}\n`;
                        }
                    } catch (e) {
                        errorMessage += `  Could not read directory: ${e.message}\n`;
                    }
                }
                errorMessage += `\nTip: Ensure the file path is correct and the file exists.`;
                errorMessage += `\nCheck that relative paths in tileset.json match the actual file structure.`;
                
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end(errorMessage);
            } else if (err.code === 'EACCES') {
                res.writeHead(403, { 'Content-Type': 'text/plain' });
                res.end(`Permission denied: ${absolutePath}\n\nTip: Check file permissions and ensure the application has read access.`);
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Error accessing file: ${err.message}\nPath: ${absolutePath}\nCode: ${err.code}`);
            }
            return;
        }
    }
    
    // Remove leading slash
    if (filePath.startsWith('/')) {
        filePath = filePath.substring(1);
    }
    
    // Default to index.html
    if (filePath === '' || filePath === '/') {
        filePath = 'index.html';
    }
    
    // Resolve file path
    let fullPath;
    
    // Check if this might be a tileset subdirectory path (like Data/L11_2.b3dm)
    // Try tileset directories first before falling back to DATA_DIR
    if (!global._tilesetDirs) global._tilesetDirs = new Set();
    
    // Check if filePath starts with Data/ (capital D) - likely a tileset subdirectory
    const isTilesetSubdir = filePath.startsWith('Data/') || filePath.startsWith('data/');
    
    if (isTilesetSubdir && global._tilesetDirs.size > 0) {
        // Try to find in tileset directories first
        const dataPart = filePath.substring(filePath.indexOf('/') + 1); // Everything after "Data/" or "data/"
        
        for (const tilesetDir of global._tilesetDirs) {
            // Try with original case first (Data/)
            let testPath = path.join(tilesetDir, filePath);
            if (fs.existsSync(testPath)) {
                try {
                    const stats = fs.statSync(testPath);
                    if (stats.isFile()) {
                        serverLog(`Found tileset subdirectory file: ${testPath}`);
                        serveFile(testPath, res);
                        return;
                    }
                } catch (e) {
                    // Continue
                }
            }
            
            // Try with dataPart (relative to tileset root)
            testPath = path.join(tilesetDir, dataPart);
            if (fs.existsSync(testPath)) {
                try {
                    const stats = fs.statSync(testPath);
                    if (stats.isFile()) {
                        serverLog(`Found tileset subdirectory file (relative): ${testPath}`);
                        serveFile(testPath, res);
                        return;
                    }
                } catch (e) {
                    // Continue
                }
            }
            
            // Try case-insensitive search
            const pathParts = filePath.split('/').filter(p => p);
            const foundPath = findCaseInsensitivePath(tilesetDir, pathParts);
            if (foundPath && fs.existsSync(foundPath)) {
                try {
                    const foundStats = fs.statSync(foundPath);
                    if (foundStats.isFile()) {
                        serverLog(`Found tileset subdirectory file (case-insensitive): ${foundPath}`);
                        serveFile(foundPath, res);
                        return;
                    }
                } catch (e) {
                    // Continue
                }
            }
        }
    }
    
    // Serve SIM project files under /sim/*
    const simPrefix = 'sim/';
    if (HAS_SIM_PROJECT && filePath.toLowerCase().startsWith(simPrefix)) {
        const relativeSimPath = filePath.substring(simPrefix.length);
        fullPath = path.join(SIM_PROJECT_DIR, relativeSimPath || 'index.html');
    } else if (HAS_SIM_PROJECT && filePath.toLowerCase() === 'sim') {
        fullPath = path.join(SIM_PROJECT_DIR, 'index.html');
    }

    // Check if it's a data file (case-insensitive)
    const lowerFilePath = filePath.toLowerCase();
    if (!fullPath && (lowerFilePath.startsWith('/data/') || lowerFilePath.startsWith('data/'))) {
        // Everything after "data/" - preserve case
        // Remove leading slash if present, then remove "data/"
        let dataPart = filePath.startsWith('/') ? filePath.substring(6) : filePath.substring(5);
        fullPath = path.join(DATA_DIR, dataPart);

        // Normalize path separators
        fullPath = fullPath.replace(/\\/g, path.sep);

        // Bundled app config and related files live under public/data/ in the repo; DATA_DIR is [app]/data.
        // jsonConfigManager + PathResolver request /data/config/app-config.json — serve from public when missing in DATA_DIR.
        try {
            const publicMirror = path.join(PUBLIC_DIR, 'data', dataPart);
            if (!fs.existsSync(fullPath) && fs.existsSync(publicMirror)) {
                fullPath = publicMirror;
            }
        } catch (e) {
            /* keep primary fullPath */
        }
    } else if (!fullPath) {
        fullPath = path.join(PUBLIC_DIR, filePath);
    }
    
    // Security: prevent directory traversal
    const resolvedPath = path.resolve(fullPath);
    const publicResolved = path.resolve(PUBLIC_DIR);
    const dataResolved = path.resolve(DATA_DIR);
    const simResolved = HAS_SIM_PROJECT ? path.resolve(SIM_PROJECT_DIR) : null;
    
    const allowedRoots = [publicResolved, dataResolved];
    if (simResolved) {
        allowedRoots.push(simResolved);
    }

    const isAllowed = allowedRoots.some(root => resolvedPath.startsWith(root));
    if (!isAllowed) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }
    
    // Check if file exists (case-insensitive for data directory)
    fs.stat(fullPath, (err, stats) => {
        if (err || !stats.isFile()) {
            // If it's in data directory and file not found, try case-insensitive search
            if (resolvedPath.startsWith(dataResolved)) {
                // Try case-insensitive directory and file lookup
                const dataPart = filePath.substring(5); // Remove "data/" prefix
                const pathParts = dataPart.split('/').filter(p => p); // Split and filter empty parts
                
                if (pathParts.length > 0) {
                    const foundPath = findCaseInsensitivePath(DATA_DIR, pathParts);
                    
                    if (foundPath && fs.existsSync(foundPath)) {
                        try {
                            const foundStats = fs.statSync(foundPath);
                            if (foundStats.isFile()) {
                                serveFile(foundPath, res);
                                return;
                            }
                        } catch (e) {
                            // Stat failed, continue to 404
                        }
                    }
                }
            }
            
            // Try fallback: check if this looks like a tileset file that should be resolved relative to a tileset directory
            // This handles cases where Cesium makes requests like /Cesium_Ashkelon_2025_V1.b3dm
            // or Data/L11_2.b3dm (relative paths within tileset)
            const filename = path.basename(filePath);
            
            // Check if we have any recent /file requests that might indicate a tileset directory
            // Store tileset directories from /file requests
            if (!global._tilesetDirs) global._tilesetDirs = new Set();
            
            // Try each known tileset directory
            for (const tilesetDir of global._tilesetDirs) {
                // First, try the filename directly in the tileset directory
                let fallbackPath = path.join(tilesetDir, filename);
                if (fs.existsSync(fallbackPath)) {
                    try {
                        const fallbackStats = fs.statSync(fallbackPath);
                        if (fallbackStats.isFile()) {
                            serverLog(`Found file in fallback location: ${fallbackPath}`);
                            serveFile(fallbackPath, res);
                            return;
                        }
                    } catch (e) {
                        // Continue to next fallback
                    }
                }
                
                // If filePath contains subdirectories (like Data/L11_2.b3dm), try that path relative to tileset
                if (filePath.includes('/') || filePath.includes('\\')) {
                    // Preserve the relative path structure
                    const relativePath = filePath.replace(/\\/g, path.sep);
                    fallbackPath = path.join(tilesetDir, relativePath);
                    
                    if (fs.existsSync(fallbackPath)) {
                        try {
                            const fallbackStats = fs.statSync(fallbackPath);
                            if (fallbackStats.isFile()) {
                                serverLog(`Found file in fallback location (with subdirectory): ${fallbackPath}`);
                                serveFile(fallbackPath, res);
                                return;
                            }
                        } catch (e) {
                            // Continue to next fallback
                        }
                    }
                    
                    // Also try case-insensitive search for the subdirectory path
                    const pathParts = relativePath.split(path.sep).filter(p => p);
                    if (pathParts.length > 1) {
                        const foundPath = findCaseInsensitivePath(tilesetDir, pathParts);
                        if (foundPath && fs.existsSync(foundPath)) {
                            try {
                                const foundStats = fs.statSync(foundPath);
                                if (foundStats.isFile()) {
                                    serverLog(`Found file in fallback location (case-insensitive): ${foundPath}`);
                                    serveFile(foundPath, res);
                                    return;
                                }
                            } catch (e) {
                                // Continue to next fallback
                            }
                        }
                    }
                }
            }
            
            // Log the attempted path for debugging (only first few to avoid spam)
            // Skip logging for common optional files to reduce noise
            const isOptionalFile = filePath.includes('config/app-config.json') || 
                                   filePath.includes('favicon.ico') ||
                                   filePath.includes('.map'); // source maps
            
            if (!isOptionalFile) {
                if (!global._404Count) global._404Count = 0;
                if (global._404Count < 10) {
                    serverLog(`404: File not found - ${filePath}`);
                    serverLog(`    Resolved path: ${fullPath}`);
                    serverLog(`    Tried ${global._tilesetDirs.size} fallback directories`);
                    global._404Count++;
                }
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found: ' + filePath);
            return;
        }
        
        serveFile(fullPath, res);
    });
});

/**
 * Start the HTTP server
 * 
 * Starts listening on the configured port. Can be called as a module export
 * or run directly if executed as a script.
 * 
 * @param {Function} [callback] - Optional callback(err, server) called when server starts
 * @returns {http.Server} The HTTP server instance
 */
function startServer(callback) {
    const port = getPort();
    server.listen(port, () => {
        serverLog(`HTTP server running on http://localhost:${port}`);
        serverLog(`Serving files from: ${PUBLIC_DIR}`);
        serverLog(`Data directory: ${DATA_DIR}`);
        if (callback) callback(null, server);
    });

    // Handle errors
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${port} is already in use`);
        } else {
            console.error('Server error:', err);
        }
        if (callback) callback(err);
    });
    
    return server;
}

// If run directly (not imported), start the server
// This allows the server to be started standalone for testing
if (require.main === module) {
    startServer();
}

/**
 * Module exports
 * 
 * @exports {Object}
 * @property {Function} startServer - Function to start the server
 * @property {http.Server} server - HTTP server instance
 */
module.exports = { startServer, server };
