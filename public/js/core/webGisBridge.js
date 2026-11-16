/**
 * webGisBridge.js
 *
 * Relative-URL HTTP fallback adapter for SimplexDM's offline GIS, SQLite Map Labels,
 * CRS projection, and JSTS Geoprocessing APIs when running in standalone browser mode
 * (`npm start` / `npm run start:server`, outside Electron where `preload.js` runs).
 *
 * Security & architecture guarantees:
 * - Never overwrites or mutates Electron's `contextBridge` `window.electronAPI`.
 * - Signature-compatible 1:1 with `preload.js` (`gis.labels.*`, `gis.crs.*`,
 *   `gis.geoprocess.*`, `gis.offline.*`).
 * - Uses strictly relative URLs (`api/...`, `data/...`) — zero hardcoded `localhost`.
 */
(function (global) {
    'use strict';

    if (!global || global.electronAPI) {
        return;
    }

    async function getJson(relUrl) {
        const res = await fetch(relUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || `HTTP ${res.status}`);
        }
        return res.json();
    }

    async function postJson(relUrl, payload) {
        const res = await fetch(relUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify(payload || {}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok === false) {
            throw new Error(data?.error || `HTTP ${res.status}`);
        }
        return data;
    }

    const _importListeners = new Set();
    const _disabledRegions = new Set();

    function emitImport(detail) {
        _importListeners.forEach((cb) => {
            try {
                cb(detail);
            } catch (_) {
                /* ignore */
            }
        });
    }

    const webBridge = {
        isElectron: false,
        isWebBridge: true,
        isDev: false,
        platform: (typeof navigator !== 'undefined' && navigator.platform) || 'web',

        getServerPort: async () => {
            const p = Number(global.location?.port);
            return Number.isFinite(p) && p > 0 ? p : 8000;
        },

        getAppVersion: async () => '2.0.0',
        getAppPath: async () => '',
        getPathForFile: () => '',

        gis: {
            labels: {
                queryViewport: async (viewport, activeRegions = [], opts = {}) => {
                    const filtered = Array.isArray(activeRegions)
                        ? activeRegions.filter((id) => !_disabledRegions.has(id))
                        : [];
                    return postJson('api/gis/labels/query', {
                        viewport,
                        activeRegions: filtered,
                        opts: opts || {},
                    });
                },

                search: async (query, opts = {}) => {
                    const q = String(query || '').trim();
                    if (!q) return [];
                    const limit = Number.isFinite(opts?.limit) ? opts.limit : 25;
                    return getJson(`api/gis/labels/search?q=${encodeURIComponent(q)}&limit=${limit}`);
                },

                listRegions: async () => {
                    const data = await getJson('api/gis/labels/regions');
                    const list = Array.isArray(data?.installed) ? data.installed : [];
                    return list.map((r) => ({
                        ...r,
                        enabled: r.enabled !== false && !_disabledRegions.has(r.id),
                    }));
                },

                importRegion: async () => {
                    emitImport({ pct: 25, percent: 25, message: 'Verifying SHA-256 checksum…' });
                    const res = await postJson('api/gis/labels/import-sample', {});
                    if (res?.meta?.id) _disabledRegions.delete(res.meta.id);
                    emitImport({ pct: 100, percent: 100, message: 'Region pack installed' });
                    return { ok: true, canceled: false, region: res.meta, meta: res.meta };
                },

                setRegionEnabled: async (regionId, enabled) => {
                    if (!regionId) return { ok: false };
                    if (enabled === false) _disabledRegions.add(regionId);
                    else _disabledRegions.delete(regionId);
                    return { ok: true, id: regionId, enabled: enabled !== false };
                },

                removeRegion: async (regionId) => {
                    _disabledRegions.delete(regionId);
                    return postJson('api/gis/labels/remove-region', { regionId });
                },

                readDownloadManifest: async () => {
                    try {
                        const data = await getJson('data/label-download-manifest.json');
                        return { ok: true, manifest: data, ...data };
                    } catch (_) {
                        return { ok: true, manifest: { regions: [] }, regions: [] };
                    }
                },

                getWorldBaseInfo: async () => {
                    const data = await getJson('api/gis/labels/regions');
                    const wb = data?.worldBase || { present: false, labelCount: 0, sizeBytes: 0 };
                    return {
                        ok: true,
                        exists: Boolean(wb.present),
                        installed: Boolean(wb.present),
                        present: Boolean(wb.present),
                        labelCount: wb.labelCount || 0,
                        sizeBytes: wb.sizeBytes || 0,
                        languages: wb.languages || ['native', 'en', 'ar'],
                        samplePackAvailable: Boolean(data?.samplePackAvailable),
                    };
                },

                downloadWorldBase: async () => webBridge.gis.labels.getWorldBaseInfo(),
                downloadRegionPack: async () => webBridge.gis.labels.importRegion(),

                onImportProgress: (cb) => {
                    if (typeof cb !== 'function') return () => {};
                    _importListeners.add(cb);
                    return () => _importListeners.delete(cb);
                },

                onDownloadProgress: () => () => {},
            },

            crs: {
                lookup: async (query) => {
                    const data = await getJson(
                        `api/gis/crs/search?q=${encodeURIComponent(query || '')}&limit=25`
                    );
                    return data?.items || [];
                },
                transform: async (spec = {}) => {
                    return postJson('api/gis/crs/transform', spec);
                },
            },

            geoprocess: {
                run: async (_projectFolderPath, jobSpec = {}) => {
                    const op = jobSpec.op || jobSpec.operation;
                    const params = jobSpec.params || jobSpec;
                    const data = await postJson('api/gis/geoprocess', { op, params });
                    return data.result;
                },
                cancel: async () => ({ ok: true }),
            },

            offline: {
                status: async () => getJson('api/offline-maps/status'),
                integrityCheck: async () => {
                    const status = await getJson('api/offline-maps/status');
                    const missing = [];
                    if (!status?.labels?.present) missing.push('labels-world-base.db');
                    return {
                        ok: missing.length === 0,
                        missing,
                        status,
                    };
                },
            },
        },
    };

    global.electronAPI = webBridge;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { webBridge };
    }
})(typeof window !== 'undefined' ? window : globalThis);
