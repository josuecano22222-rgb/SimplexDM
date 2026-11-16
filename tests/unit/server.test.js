/**
 * @jest-environment node
 *
 * Unit & HTTP integration tests for `server/server.js`.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const {
    createServer,
    isPathWithinRoot,
    getCorsHeaders,
    getMimeType,
    parseByteRange,
} = require('../../server/server');

function httpRequest(port, reqPath, options = {}) {
    return new Promise((resolve, reject) => {
        const body = options.body !== undefined ? Buffer.from(options.body) : null;
        const headers = { ...(options.headers || {}) };
        if (body && headers['Content-Length'] === undefined) {
            headers['Content-Length'] = body.length;
        }
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path: reqPath,
                method: options.method || 'GET',
                headers,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        buffer: buf,
                        text: buf.toString('utf8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

describe('server/server.js security & HTTP endpoints', () => {
    let server;
    let port;
    let tmpDir;
    let siteContentBackup;
    let appConfigBackup;
    const siteContentPath = path.resolve(__dirname, '../../data/site/site-content.json');
    const appConfigPath = path.resolve(__dirname, '../../data/config/app-config.json');

    beforeAll(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-server-test-'));
        fs.writeFileSync(
            path.join(tmpDir, 'tileset.json'),
            JSON.stringify({ asset: { version: '1.1' }, geometricError: 64, root: {} })
        );
        fs.writeFileSync(path.join(tmpDir, 'sample.bin'), Buffer.from('0123456789ABCDEFGHIJ'));

        siteContentBackup = fs.existsSync(siteContentPath)
            ? fs.readFileSync(siteContentPath, 'utf8')
            : null;
        appConfigBackup = fs.existsSync(appConfigPath)
            ? fs.readFileSync(appConfigPath, 'utf8')
            : null;

        server = createServer();
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
    });

    afterAll(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        if (siteContentBackup !== null) {
            fs.writeFileSync(siteContentPath, siteContentBackup, 'utf8');
        }
        if (appConfigBackup !== null) {
            fs.writeFileSync(appConfigPath, appConfigBackup, 'utf8');
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('isPathWithinRoot prevents sibling-prefix directory traversal', () => {
        expect(isPathWithinRoot('/srv/data/tiles/0/0/0.png', '/srv/data')).toBe(true);
        expect(isPathWithinRoot('/srv/data', '/srv/data')).toBe(true);
        expect(isPathWithinRoot('/srv/data-secret/keys.json', '/srv/data')).toBe(false);
        expect(isPathWithinRoot('/srv/data/../etc/passwd', '/srv/data')).toBe(false);
    });

    test('getCorsHeaders allows loopback only and rejects third-party origins; parseByteRange validates ranges', () => {
        expect(getCorsHeaders({ headers: { origin: 'http://localhost:8080' } })['Access-Control-Allow-Origin']).toBe(
            'http://localhost:8080'
        );
        expect(getCorsHeaders({ headers: { origin: 'http://127.0.0.1:51234' } })['Access-Control-Allow-Origin']).toBe(
            'http://127.0.0.1:51234'
        );
        expect(
            getCorsHeaders({ headers: { origin: 'https://evil.example.com' } })['Access-Control-Allow-Origin']
        ).toBeUndefined();
        expect(
            getCorsHeaders({ headers: { origin: 'http://localhost.evil.com' } })['Access-Control-Allow-Origin']
        ).toBeUndefined();

        expect(parseByteRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
        expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
        expect(parseByteRange('bytes=200-300', 100)).toBe('unsatisfiable');
        expect(parseByteRange('invalid-header', 100)).toBeNull();
    });

    test('getMimeType covers 3D Tiles, vector PBF, GeoTIFF, GeoPackage, and icons', () => {
        expect(getMimeType('tile.b3dm')).toBe('application/octet-stream');
        expect(getMimeType('tile.pbf')).toBe('application/x-protobuf');
        expect(getMimeType('model.glb')).toBe('model/gltf-binary');
        expect(getMimeType('dem.tif')).toBe('image/tiff');
        expect(getMimeType('layers.gpkg')).toBe('application/geopackage+sqlite3');
        expect(getMimeType('scene.geojson')).toContain('application/geo+json');
    });

    test('GET /health and GET /api/config respond with valid JSON and loopback CORS headers', async () => {
        const health = await httpRequest(port, '/health', {
            headers: { Origin: `http://127.0.0.1:${port}` },
        });
        expect(health.status).toBe(200);
        expect(health.headers['access-control-allow-origin']).toBe(`http://127.0.0.1:${port}`);
        expect(health.headers['x-content-type-options']).toBe('nosniff');
        const body = JSON.parse(health.text);
        expect(body.status).toBe('ok');

        const evil = await httpRequest(port, '/health', {
            headers: { Origin: 'https://attacker.example' },
        });
        expect(evil.headers['access-control-allow-origin']).toBeUndefined();

        const site = await httpRequest(port, '/api/site-content');
        expect(site.status).toBe(200);
        expect(typeof JSON.parse(site.text)).toBe('object');
    });

    test('GET /file streams absolute local tileset JSON, supports HEAD and HTTP Range (206)', async () => {
        const absTileset = path.join(tmpDir, 'tileset.json');
        const res = await httpRequest(port, `/file?path=${encodeURIComponent(absTileset)}`);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.text).asset.version).toBe('1.1');

        const absBin = path.join(tmpDir, 'sample.bin');
        const head = await httpRequest(port, `/file?path=${encodeURIComponent(absBin)}`, {
            method: 'HEAD',
        });
        expect(head.status).toBe(200);
        expect(head.headers['content-length']).toBe('20');
        expect(head.buffer.length).toBe(0);

        const range = await httpRequest(port, `/file?path=${encodeURIComponent(absBin)}`, {
            headers: { Range: 'bytes=5-9' },
        });
        expect(range.status).toBe(206);
        expect(range.text).toBe('56789');
        expect(range.headers['content-range']).toBe('bytes 5-9/20');
    });

    test('blocks directory traversal on static routes and relative /file?path=', async () => {
        const r1 = await httpRequest(port, '/file?path=../../package.json');
        expect([403, 404]).toContain(r1.status);

        const r2 = await httpRequest(port, '/data/../../package.json');
        expect([403, 404]).toContain(r2.status);

        const r3 = await httpRequest(port, '/file?path=' + encodeURIComponent('/tmp/bad\0file.json'));
        expect(r3.status).toBe(400);
    });

    test('GET /PUT /api/app-config validates JSON and rejects invalid payloads', async () => {
        const getRes = await httpRequest(port, '/api/app-config');
        expect(getRes.status).toBe(200);
        const current = JSON.parse(getRes.text);
        expect(typeof current).toBe('object');
        expect(current.app || current.features || current.modules).toBeDefined();

        const badJson = await httpRequest(port, '/api/app-config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: '{broken-json',
        });
        expect(badJson.status).toBe(400);

        const arrayJson = await httpRequest(port, '/api/app-config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: '[1,2,3]',
        });
        expect(arrayJson.status).toBe(400);

        const putRes = await httpRequest(port, '/api/app-config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(current),
        });
        expect(putRes.status).toBe(200);
        expect(JSON.parse(putRes.text).ok).toBe(true);
    });
});
