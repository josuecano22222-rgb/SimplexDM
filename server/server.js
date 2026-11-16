/**
 * Local Loopback HTTP Server (`server/server.js`)
 *
 * Serves static assets from `public-bundled/` (or `public/`), offline tiles/data
 * from `data/`, and local 3D Tiles / GIS files via `/file?path=<absPath>`.
 *
 * Security & performance guarantees:
 * - Binds strictly to loopback (`127.0.0.1` by default; override via `HOST`)
 * - Loopback-scoped CORS (`http://localhost:*`, `http://127.0.0.1:*`, `http://[::1]:*`)
 * - Boundary-safe path containment (`isPathWithinRoot`) preventing prefix traversal
 * - Single-pass safe URI decoding and null-byte rejection
 * - Cross-platform Windows drive + Unix/macOS absolute path support on `/file`
 * - Streaming file delivery with HTTP `HEAD` and `Range: bytes=...` (`206 Partial Content`)
 * - Case-insensitive path & filename fallback for cross-OS 3D Tiles compatibility
 *
 * @module Server
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGisApiHandler } = require('./gisApiRoutes');

const SERVER_VERBOSE =
    process.env.SIMPLEX_SERVER_VERBOSE === '1' ||
    process.env.NODE_ENV === 'development';

function serverLog(...args) {
    if (SERVER_VERBOSE) {
        console.log(...args);
    }
}

function getPort() {
    if (process.env.PORT !== undefined && process.env.PORT !== '') {
        const parsed = parseInt(process.env.PORT, 10);
        if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
            return parsed;
        }
    }
    return 8000;
}

function getHost() {
    return process.env.HOST || '127.0.0.1';
}

const APP_PATH = process.env.APP_PATH || path.join(__dirname, '..');
const IS_PACKAGED = process.env.IS_PACKAGED === 'true';

function resolveDirectories(appPath = APP_PATH, isPackaged = IS_PACKAGED) {
    let publicDir = path.join(appPath, 'public-bundled');
    if (!fs.existsSync(publicDir)) {
        publicDir = path.join(appPath, 'public');
    }

    let dataDir = path.join(appPath, 'data');
    const simProjectDir = process.env.SIM_PROJECT_DIR || path.join(appPath, 'sim');
    const hasSimProject = Boolean(simProjectDir) && fs.existsSync(simProjectDir);

    if (isPackaged) {
        const resourcesDir = path.dirname(appPath);
        const installDir = path.dirname(resourcesDir);
        const possibleDataDirs = [
            path.join(installDir, 'data'), // electron-builder extraFiles { from: 'data', to: 'data' }
            path.join(resourcesDir, 'data'), // resources/data/
            path.join(resourcesDir, 'app.asar.unpacked', 'data'),
            path.join(resourcesDir, 'app', 'data'),
            path.join(appPath, 'data'),
        ];
        for (const candidate of possibleDataDirs) {
            if (fs.existsSync(candidate)) {
                dataDir = candidate;
                break;
            }
        }
    }

    return { publicDir, dataDir, simProjectDir, hasSimProject };
}

const defaultDirs = resolveDirectories();
const PUBLIC_DIR = defaultDirs.publicDir;
const DATA_DIR = defaultDirs.dataDir;

const LOOPBACK_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

/**
 * Compute safe CORS headers restricted to loopback origins (or matching Host when
 * explicitly bound to 0.0.0.0 for containerized web previews).
 * Same-origin requests (no `Origin` header) succeed natively without wildcard exposure.
 */
function getCorsHeaders(req) {
    const origin = req && req.headers ? req.headers.origin : undefined;
    const reqHost = req && req.headers ? req.headers.host : undefined;
    const headers = {
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    };
    if (origin) {
        let allow = LOOPBACK_ORIGIN_RE.test(origin);
        if (!allow && getHost() === '0.0.0.0' && reqHost) {
            try {
                allow = new URL(origin).host.toLowerCase() === String(reqHost).toLowerCase();
            } catch (_) {
                allow = false;
            }
        }
        if (allow) {
            headers['Access-Control-Allow-Origin'] = origin;
            headers['Vary'] = 'Origin';
        }
    }
    return headers;
}

/**
 * Boundary-safe directory containment check.
 * Prevents sibling-prefix bypass (e.g. `/app/public-secret` vs `/app/public`).
 */
function isPathWithinRoot(candidatePath, rootDir) {
    const resolvedCandidate = path.resolve(candidatePath);
    const resolvedRoot = path.resolve(rootDir);
    if (resolvedCandidate === resolvedRoot) {
        return true;
    }
    const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    if (process.platform === 'win32') {
        return resolvedCandidate.toLowerCase().startsWith(prefix.toLowerCase());
    }
    return resolvedCandidate.startsWith(prefix);
}

/**
 * True if `p` is a Windows drive path (`C:\...` / `C:/...`), UNC path, or POSIX absolute path.
 */
function isAbsoluteFilesystemPath(p) {
    if (!p || typeof p !== 'string') return false;
    return /^[A-Za-z]:[\\/]/.test(p) || /^[A-Za-z]:$/.test(p) || p.startsWith('\\\\') || path.isAbsolute(p);
}

/**
 * Case-insensitive relative segment lookup inside `baseDir`.
 */
function findCaseInsensitivePath(baseDir, pathParts) {
    let currentPath = baseDir;

    for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        if (!part || part === '.') continue;
        if (part === '..') return null;

        try {
            if (!fs.existsSync(currentPath)) return null;
            const stats = fs.statSync(currentPath);
            if (!stats.isDirectory()) return null;

            const entries = fs.readdirSync(currentPath);
            const partLower = part.toLowerCase();
            let found = entries.find((e) => e.toLowerCase() === partLower);
            if (!found) {
                const stripped = partLower.replace(/_/g, '');
                found = entries.find((e) => e.toLowerCase().replace(/_/g, '') === stripped);
            }
            if (!found) return null;
            currentPath = path.join(currentPath, found);
        } catch (_) {
            return null;
        }
    }

    return isPathWithinRoot(currentPath, baseDir) ? currentPath : null;
}

/**
 * Fallback lookup for tile filenames with case, apostrophe, or underscore mismatches.
 */
function resolveTilesetFileWithFallbacks(absolutePath) {
    const dirPath = path.dirname(absolutePath);
    const baseName = path.basename(absolutePath);
    if (!baseName || !fs.existsSync(dirPath)) return null;

    try {
        if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
            return absolutePath;
        }
    } catch (_) {
        /* continue */
    }

    const tryExact = findCaseInsensitivePath(dirPath, [baseName]);
    try {
        if (tryExact && fs.statSync(tryExact).isFile()) {
            return tryExact;
        }
    } catch (_) {
        /* continue */
    }

    let entries;
    try {
        entries = fs.readdirSync(dirPath);
    } catch (_) {
        return null;
    }

    const normalizeLoose = (s) => s.toLowerCase().replace(/['\u2019_]/g, '');
    const looseTarget = normalizeLoose(baseName);
    for (const entry of entries) {
        if (normalizeLoose(entry) === looseTarget) {
            const candidate = path.join(dirPath, entry);
            try {
                if (fs.statSync(candidate).isFile()) {
                    return candidate;
                }
            } catch (_) {
                /* continue */
            }
        }
    }

    return null;
}

const MIME_TYPES = Object.freeze({
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.cjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.geojson': 'application/geo+json; charset=utf-8',
    '.topojson': 'application/json; charset=utf-8',
    '.czml': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.kml': 'application/vnd.google-earth.kml+xml',
    '.kmz': 'application/vnd.google-earth.kmz',
    '.csv': 'text/csv; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.ktx2': 'image/ktx2',
    '.pbf': 'application/x-protobuf',
    '.mvt': 'application/vnd.mapbox-vector-tile',
    '.b3dm': 'application/octet-stream',
    '.i3dm': 'application/octet-stream',
    '.pnts': 'application/octet-stream',
    '.cmpt': 'application/octet-stream',
    '.subtree': 'application/octet-stream',
    '.terrain': 'application/octet-stream',
    '.rlp': 'application/zip',
    '.gpkg': 'application/geopackage+sqlite3',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.eot': 'application/vnd.ms-fontobject',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
});

function getMimeType(filePath) {
    const ext = path.extname(String(filePath || '')).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Parse a single-range `Range: bytes=start-end` header against `totalSize`.
 * Returns `{ start, end }`, `'unsatisfiable'`, or `null` if no Range requested.
 */
function parseByteRange(rangeHeader, totalSize) {
    if (!rangeHeader || typeof rangeHeader !== 'string' || !rangeHeader.startsWith('bytes=')) {
        return null;
    }
    const spec = rangeHeader.slice(6).split(',')[0].trim();
    const match = /^(\d*)-(\d*)$/.exec(spec);
    if (!match || (match[1] === '' && match[2] === '')) {
        return 'unsatisfiable';
    }
    let start;
    let end;
    if (match[1] === '') {
        const suffixLen = parseInt(match[2], 10);
        if (!Number.isFinite(suffixLen) || suffixLen <= 0) return 'unsatisfiable';
        start = Math.max(0, totalSize - suffixLen);
        end = totalSize - 1;
    } else {
        start = parseInt(match[1], 10);
        end = match[2] === '' ? totalSize - 1 : parseInt(match[2], 10);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= totalSize) {
        return 'unsatisfiable';
    }
    return { start, end: Math.min(end, totalSize - 1) };
}

/**
 * Stream a file to `res` with support for `HEAD` and HTTP `Range` (`206 Partial Content`).
 */
function serveFile(filePath, req, res) {
    const cors = getCorsHeaders(req);
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            if (!res.headersSent) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
            }
            res.end('File not found');
            return;
        }

        const totalSize = stats.size;
        const mimeType = getMimeType(filePath);
        const baseHeaders = {
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes',
            ...cors,
        };

        const range = parseByteRange(req && req.headers ? req.headers.range : undefined, totalSize);
        if (range === 'unsatisfiable') {
            res.writeHead(416, {
                ...baseHeaders,
                'Content-Range': `bytes */${totalSize}`,
            });
            res.end();
            return;
        }

        if (range) {
            const chunkSize = range.end - range.start + 1;
            res.writeHead(206, {
                ...baseHeaders,
                'Content-Range': `bytes ${range.start}-${range.end}/${totalSize}`,
                'Content-Length': chunkSize,
            });
            if (req && req.method === 'HEAD') {
                res.end();
                return;
            }
            const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
            stream.on('error', () => {
                if (!res.headersSent) res.writeHead(500);
                res.end();
            });
            stream.pipe(res);
            return;
        }

        res.writeHead(200, {
            ...baseHeaders,
            'Content-Length': totalSize,
        });
        if (req && req.method === 'HEAD') {
            res.end();
            return;
        }
        const stream = fs.createReadStream(filePath);
        stream.on('error', () => {
            if (!res.headersSent) res.writeHead(500);
            res.end();
        });
        stream.pipe(res);
    });
}

function handleJsonFileEndpoint(req, res, targetPath, fallbackReadPath, maxBytes = 2_000_000) {
    const cors = getCorsHeaders(req);

    if (req.method === 'GET' || req.method === 'HEAD') {
        const readCandidate =
            fs.existsSync(targetPath) ? targetPath : fallbackReadPath && fs.existsSync(fallbackReadPath) ? fallbackReadPath : targetPath;
        fs.readFile(readCandidate, 'utf8', (err, raw) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
                res.end(JSON.stringify({ error: 'resource not found' }));
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
                ...cors,
            });
            res.end(req.method === 'HEAD' ? undefined : raw);
        });
        return;
    }

    if (req.method === 'POST' || req.method === 'PUT') {
        let aborted = false;
        let totalBytes = 0;
        const chunks = [];

        req.on('data', (chunk) => {
            if (aborted) return;
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
                aborted = true;
                if (!res.headersSent) {
                    res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
                    res.end(JSON.stringify({ error: 'payload too large' }));
                }
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            if (aborted || res.headersSent) return;
            try {
                const rawBody = Buffer.concat(chunks).toString('utf8');
                const parsed = JSON.parse(rawBody || '{}');
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
                    res.end(JSON.stringify({ error: 'expected JSON object' }));
                    return;
                }
                const dir = path.dirname(targetPath);
                fs.mkdirSync(dir, { recursive: true });
                const tmpPath = `${targetPath}.${process.pid}.tmp`;
                fs.writeFileSync(tmpPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
                fs.renameSync(tmpPath, targetPath);
                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': 'no-store',
                    ...cors,
                });
                res.end(JSON.stringify({ ok: true }));
            } catch (err) {
                if (!res.headersSent) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
                    res.end(JSON.stringify({ error: 'invalid json', message: err.message }));
                }
            }
        });
        return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
    res.end(JSON.stringify({ error: 'method not allowed' }));
}

function safeDecodeURIComponent(value) {
    try {
        return { ok: true, value: decodeURIComponent(value) };
    } catch (_) {
        return { ok: false, value: '' };
    }
}

/**
 * Create a request handler scoped to given `publicDir`, `dataDir`, and optional `simProjectDir`.
 */
function createRequestHandler(options = {}) {
    const appPath = options.appPath || APP_PATH;
    const publicDir = options.publicDir || PUBLIC_DIR;
    const dataDir = options.dataDir || DATA_DIR;
    const simProjectDir = options.simProjectDir !== undefined ? options.simProjectDir : defaultDirs.simProjectDir;
    const hasSimProject = Boolean(simProjectDir) && fs.existsSync(simProjectDir);
    const cesiumNodeModulesDir = path.join(appPath, 'node_modules', 'cesium', 'Build', 'Cesium');
    const hasCesiumFallback = fs.existsSync(cesiumNodeModulesDir);
    const handleGisApi = createGisApiHandler({ appPath, dataDir });
    const tilesetDirs = new Set();

    function trackTilesetDir(fileDir) {
        tilesetDirs.add(fileDir);
        if (tilesetDirs.size > 128) {
            const oldest = tilesetDirs.values().next().value;
            tilesetDirs.delete(oldest);
        }
    }

    return function requestHandler(req, res) {
        const cors = getCorsHeaders(req);

        if (req.method === 'OPTIONS') {
            res.writeHead(204, cors);
            res.end();
            return;
        }

        let urlObj;
        let rawPathname;
        try {
            urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            rawPathname = urlObj.pathname;
        } catch (_) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
            res.end('Malformed request URL');
            return;
        }

        // Health endpoint for diagnostics & readiness probes
        if (rawPathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
            res.end(JSON.stringify({ status: 'ok', service: 'SimplexDM' }));
            return;
        }

        // Editable landing/site content JSON API
        if (rawPathname === '/api/site-content') {
            const contentPath = path.join(dataDir, 'site', 'site-content.json');
            handleJsonFileEndpoint(req, res, contentPath, null, 2_000_000);
            return;
        }

        // Application configuration JSON API (mirrors data/config/app-config.json & public/data/config/app-config.json)
        if (rawPathname === '/api/app-config') {
            const dataCfgPath = path.join(dataDir, 'config', 'app-config.json');
            const publicCfgPath = path.join(publicDir, 'data', 'config', 'app-config.json');
            handleJsonFileEndpoint(req, res, dataCfgPath, publicCfgPath, 1_000_000);
            return;
        }

        // Offline GIS, SQLite world/regional labels, CRS & JSTS REST endpoints
        if (rawPathname.startsWith('/api/gis/') || rawPathname === '/api/offline-maps/status') {
            handleGisApi(req, res, urlObj, rawPathname, cors).then((handled) => {
                if (!handled && !res.headersSent) {
                    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
                    res.end(JSON.stringify({ ok: false, error: 'Unknown GIS API route' }));
                }
            });
            return;
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
            res.end('Method not allowed');
            return;
        }

        // /file endpoint for local 3D Tiles and geospatial datasets
        if (rawPathname === '/file' || rawPathname.startsWith('/file/')) {
            let requestedPath;

            if (urlObj.searchParams.has('path')) {
                // URLSearchParams.get() already performs single-pass percent decoding
                requestedPath = urlObj.searchParams.get('path') || '';
            } else if (rawPathname.startsWith('/file/')) {
                const seg = rawPathname.substring(6);
                const decoded = safeDecodeURIComponent(seg);
                if (!decoded.ok) {
                    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
                    res.end('Invalid URL encoding in /file path');
                    return;
                }
                requestedPath = decoded.value;

                if (!isAbsoluteFilesystemPath(requestedPath)) {
                    // Reject parent-traversal in relative /file/<rel> requests
                    const normalizedRel = path.normalize(requestedPath);
                    if (normalizedRel.startsWith('..') || normalizedRel.includes('\0')) {
                        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
                        res.end('Forbidden');
                        return;
                    }
                    let matched = null;
                    for (const tilesetDir of tilesetDirs) {
                        const candidate = path.join(tilesetDir, normalizedRel);
                        if (isPathWithinRoot(candidate, tilesetDir) && fs.existsSync(candidate)) {
                            matched = candidate;
                            break;
                        }
                    }
                    if (!matched) {
                        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
                        res.end('File not found');
                        return;
                    }
                    requestedPath = matched;
                }
            } else {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
                res.end('Missing path parameter. Use /file?path=<file_path>');
                return;
            }

            if (!requestedPath || requestedPath.includes('\0')) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
                res.end('Invalid file path');
                return;
            }

            if (urlObj.searchParams.has('path') && !isAbsoluteFilesystemPath(requestedPath)) {
                // Allow relative lookup only within registered tileset directories or dataDir
                const normalizedRel = path.normalize(requestedPath);
                if (normalizedRel.startsWith('..')) {
                    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
                    res.end('Forbidden: relative traversal not allowed');
                    return;
                }
                let resolvedRel = null;
                for (const root of [...tilesetDirs, dataDir]) {
                    const candidate = path.join(root, normalizedRel);
                    if (isPathWithinRoot(candidate, root) && fs.existsSync(candidate)) {
                        resolvedRel = candidate;
                        break;
                    }
                }
                if (!resolvedRel) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
                    res.end('File not found');
                    return;
                }
                requestedPath = resolvedRel;
            }

            const absolutePath = path.normalize(path.resolve(requestedPath));
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
                    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
                    res.end('Path is not a file');
                    return;
                }

                trackTilesetDir(path.dirname(pathToServe));
                serveFile(pathToServe, req, res);
                return;
            } catch (err) {
                const status = err.code === 'ENOENT' ? 404 : err.code === 'EACCES' ? 403 : 500;
                const msg =
                    status === 404
                        ? `File not found: ${path.basename(absolutePath)}`
                        : status === 403
                          ? 'Permission denied'
                          : 'Error accessing file';
                res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
                res.end(msg);
                return;
            }
        }

        // Static file & /data/ handling — decode pathname once and reject null bytes
        const decodedPath = safeDecodeURIComponent(rawPathname);
        if (!decodedPath.ok || decodedPath.value.includes('\0')) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
            res.end('Invalid URL path');
            return;
        }

        // Explicitly block path traversal segments before joining
        const rawSegments = decodedPath.value.split('/');
        if (rawSegments.some((seg) => seg === '..')) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
            res.end('Forbidden');
            return;
        }

        let relUrlPath = decodedPath.value.replace(/^\/+/, '');
        if (relUrlPath === '') {
            relUrlPath = 'index.html';
        }

        // Check registered tileset subdirectories first for paths like `Data/L11_2.b3dm`
        if (relUrlPath.startsWith('Data/') && tilesetDirs.size > 0) {
            const subParts = relUrlPath.split('/').filter(Boolean);
            for (const tilesetDir of tilesetDirs) {
                const direct = path.join(tilesetDir, relUrlPath);
                if (isPathWithinRoot(direct, tilesetDir) && fs.existsSync(direct)) {
                    try {
                        if (fs.statSync(direct).isFile()) {
                            serveFile(direct, req, res);
                            return;
                        }
                    } catch (_) {
                        /* continue */
                    }
                }
                const ci = findCaseInsensitivePath(tilesetDir, subParts);
                if (ci && fs.existsSync(ci)) {
                    try {
                        if (fs.statSync(ci).isFile()) {
                            serveFile(ci, req, res);
                            return;
                        }
                    } catch (_) {
                        /* continue */
                    }
                }
            }
        }

        let fullPath = null;
        const lowerRel = relUrlPath.toLowerCase();

        if (hasSimProject && (lowerRel === 'sim' || lowerRel.startsWith('sim/'))) {
            const sub = lowerRel === 'sim' ? 'index.html' : relUrlPath.slice(4) || 'index.html';
            fullPath = path.join(simProjectDir, sub);
        } else if (lowerRel.startsWith('data/')) {
            const dataPart = relUrlPath.slice(5);
            fullPath = path.join(dataDir, dataPart);
            // Fall back to public/data/<part> when absent in data/ (e.g. bundled app-config.json)
            const publicMirror = path.join(publicDir, 'data', dataPart);
            if (!fs.existsSync(fullPath) && isPathWithinRoot(publicMirror, publicDir) && fs.existsSync(publicMirror)) {
                fullPath = publicMirror;
            }
        } else {
            fullPath = path.join(publicDir, relUrlPath);
        }

        const allowedRoots = [publicDir, dataDir];
        if (hasSimProject) allowedRoots.push(simProjectDir);

        if (!allowedRoots.some((root) => isPathWithinRoot(fullPath, root))) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
            res.end('Forbidden');
            return;
        }

        fs.stat(fullPath, (err, stats) => {
            if (!err && stats.isFile()) {
                serveFile(fullPath, req, res);
                return;
            }

            // Optional commercial Cesium Ion SDK addons: return clean empty stub when not installed
            // so startup has zero 404 console noise while preserving seamless loading when installed.
            if (lowerRel.startsWith('lib/cesium/packages/ion-sdk-')) {
                const isCss = lowerRel.endsWith('.css');
                const isJs = lowerRel.endsWith('.js');
                if (isCss || isJs) {
                    res.writeHead(200, {
                        'Content-Type': isCss
                            ? 'text/css; charset=utf-8'
                            : 'application/javascript; charset=utf-8',
                        'Cache-Control': 'public, max-age=300',
                        'X-Simplex-Optional-Addon': 'unavailable',
                        ...cors,
                    });
                    res.end(isCss ? '/* Ion SDK optional stylesheet not installed */\n' : '/* Ion SDK optional package not installed */\n');
                    return;
                }
            }

            // Transparent fallback to node_modules/cesium/Build/Cesium when public/lib/cesium/
            // has not been manually copied yet (development & standalone preview convenience).
            if (hasCesiumFallback && lowerRel.startsWith('lib/cesium/')) {
                const cesiumSub = relUrlPath.slice('lib/cesium/'.length);
                const cesiumCandidate = path.join(cesiumNodeModulesDir, cesiumSub);
                if (isPathWithinRoot(cesiumCandidate, cesiumNodeModulesDir) && fs.existsSync(cesiumCandidate)) {
                    try {
                        if (fs.statSync(cesiumCandidate).isFile()) {
                            serveFile(cesiumCandidate, req, res);
                            return;
                        }
                    } catch (_) {
                        /* continue */
                    }
                }
            }

            // Case-insensitive retry inside data/
            if (lowerRel.startsWith('data/')) {
                const parts = relUrlPath.slice(5).split('/').filter(Boolean);
                const ciPath = parts.length > 0 ? findCaseInsensitivePath(dataDir, parts) : null;
                if (ciPath && fs.existsSync(ciPath)) {
                    try {
                        if (fs.statSync(ciPath).isFile()) {
                            serveFile(ciPath, req, res);
                            return;
                        }
                    } catch (_) {
                        /* continue */
                    }
                }
            }

            // Fallback lookup inside active tileset directories for relative sibling tile requests
            for (const tilesetDir of tilesetDirs) {
                const candidate = path.join(tilesetDir, relUrlPath);
                if (isPathWithinRoot(candidate, tilesetDir) && fs.existsSync(candidate)) {
                    try {
                        if (fs.statSync(candidate).isFile()) {
                            serveFile(candidate, req, res);
                            return;
                        }
                    } catch (_) {
                        /* continue */
                    }
                }
                const parts = relUrlPath.split('/').filter(Boolean);
                if (parts.length > 0) {
                    const ci = findCaseInsensitivePath(tilesetDir, parts);
                    if (ci && fs.existsSync(ci)) {
                        try {
                            if (fs.statSync(ci).isFile()) {
                                serveFile(ci, req, res);
                                return;
                            }
                        } catch (_) {
                            /* continue */
                        }
                    }
                }
            }

            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
            res.end('File not found');
        });
    };
}

function createServer(options = {}) {
    return http.createServer(createRequestHandler(options));
}

const server = createServer();

function startServer(callback, options = {}) {
    const startPort = getPort();
    const host = getHost();
    const autoFind = options.autoFindPort !== false && process.env.SIMPLEX_STRICT_PORT !== '1';
    const maxAttempts = autoFind && startPort > 0 ? 25 : 1;
    let attempt = 0;

    const tryListen = (candidatePort) => {
        attempt += 1;
        const onError = (err) => {
            if (err.code === 'EADDRINUSE' && attempt < maxAttempts && candidatePort < 65535) {
                serverLog(`Port ${candidatePort} busy on ${host}; trying ${candidatePort + 1}…`);
                tryListen(candidatePort + 1);
                return;
            }
            if (err.code === 'EADDRINUSE') {
                console.error(`Port ${candidatePort} is already in use on ${host}`);
            } else {
                console.error('Server error:', err);
            }
            if (callback) callback(err);
        };

        server.once('error', onError);
        server.listen(candidatePort, host, () => {
            server.removeListener('error', onError);
            const addr = server.address();
            const actualPort = addr && typeof addr === 'object' ? addr.port : candidatePort;
            const displayHost = host === '0.0.0.0' ? 'localhost' : host;
            if (require.main === module || SERVER_VERBOSE) {
                console.log(`SimplexDM server listening on http://${displayHost}:${actualPort} (bound ${host})`);
                serverLog(`Serving files from: ${PUBLIC_DIR}`);
                serverLog(`Data directory: ${DATA_DIR}`);
            }
            if (callback) callback(null, server);
        });
    };

    tryListen(startPort);
    return server;
}

if (require.main === module) {
    startServer();
}

module.exports = {
    startServer,
    createServer,
    createRequestHandler,
    resolveDirectories,
    getMimeType,
    getCorsHeaders,
    isPathWithinRoot,
    isAbsoluteFilesystemPath,
    parseByteRange,
    findCaseInsensitivePath,
    server,
};
