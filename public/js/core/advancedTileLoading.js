/**
 * Advanced 3D Tiles Loading, Caching, Culling & Performance Monitor
 * (`public/js/core/advancedTileLoading.js`)
 *
 * Implements the performance architecture documented in README.md:
 * - `LRUTileCache`            : O(1) least-recently-used tile cache with entry & byte caps + pinning
 * - `TilePriorityQueue`       : Binary max-heap prioritizing tiles by distance, SSE, frustum & LOD
 * - `HorizonAndFrustumCuller` : Exact WGS84 ellipsoid scaled-space horizon occlusion + frustum check
 * - `AdaptiveNetworkOptimizer`: Request concurrency limiter, in-flight dedup, latency/bandwidth EMA
 * - `PerformanceMonitor`      : Real-time FPS, frame-time p95, tile/memory/cache HUD & JSON export
 * - `AdvancedTileLoadingManager`: Wires CesiumJS 3D Tilesets, `RequestScheduler`, and `app-config.json`
 */
(function (root) {
    'use strict';

    const WGS84_A = 6378137.0;
    const WGS84_B = 6356752.3142451793;

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * O(1) Least-Recently-Used cache backed by JS `Map` insertion order.
     */
    class LRUTileCache {
        constructor(options = {}) {
            this.maxEntries = Math.max(1, Math.floor(Number(options.maxEntries ?? 500) || 500));
            const rawMaxBytes = Number(options.maxBytes);
            this.maxBytes =
                Number.isFinite(rawMaxBytes) && rawMaxBytes > 0
                    ? Math.max(256, Math.floor(rawMaxBytes))
                    : 512 * 1024 * 1024;
            this.onEvict = typeof options.onEvict === 'function' ? options.onEvict : null;
            this._map = new Map();
            this._pinned = new Set();
            this.currentBytes = 0;
            this.hits = 0;
            this.misses = 0;
            this.evictions = 0;
        }

        get size() {
            return this._map.size;
        }

        has(key) {
            return this._map.has(key);
        }

        get(key) {
            const entry = this._map.get(key);
            if (!entry) {
                this.misses++;
                return undefined;
            }
            this.hits++;
            entry.lastAccessed = Date.now();
            // Refresh recency order in O(1)
            this._map.delete(key);
            this._map.set(key, entry);
            return entry.value;
        }

        set(key, value, byteSize = 0) {
            const bytes = Math.max(0, Math.floor(Number(byteSize) || this._estimateBytes(value)));
            if (this._map.has(key)) {
                const prev = this._map.get(key);
                this.currentBytes = Math.max(0, this.currentBytes - prev.byteSize);
                this._map.delete(key);
            }

            const entry = {
                key,
                value,
                byteSize: bytes,
                lastAccessed: Date.now(),
            };
            this._map.set(key, entry);
            this.currentBytes += bytes;
            this._evictIfNeeded(key);
            return this;
        }

        pin(key) {
            if (this._map.has(key)) {
                this._pinned.add(key);
                return true;
            }
            return false;
        }

        unpin(key) {
            const removed = this._pinned.delete(key);
            if (removed) this._evictIfNeeded();
            return removed;
        }

        delete(key) {
            const entry = this._map.get(key);
            if (!entry) return false;
            this._map.delete(key);
            this._pinned.delete(key);
            this.currentBytes = Math.max(0, this.currentBytes - entry.byteSize);
            return true;
        }

        resize(maxEntries, maxBytes) {
            if (maxEntries !== undefined) {
                this.maxEntries = Math.max(1, Math.floor(Number(maxEntries) || this.maxEntries));
            }
            if (maxBytes !== undefined) {
                this.maxBytes = Math.max(1024 * 1024, Math.floor(Number(maxBytes) || this.maxBytes));
            }
            this._evictIfNeeded();
        }

        clear() {
            this._map.clear();
            this._pinned.clear();
            this.currentBytes = 0;
        }

        resetStats() {
            this.hits = 0;
            this.misses = 0;
            this.evictions = 0;
        }

        getStats() {
            const totalLookups = this.hits + this.misses;
            return {
                entries: this._map.size,
                maxEntries: this.maxEntries,
                pinnedEntries: this._pinned.size,
                currentBytes: this.currentBytes,
                maxBytes: this.maxBytes,
                utilizationPct: Number(((this._map.size / this.maxEntries) * 100).toFixed(1)),
                hits: this.hits,
                misses: this.misses,
                evictions: this.evictions,
                hitRate: totalLookups > 0 ? Number((this.hits / totalLookups).toFixed(4)) : 0,
            };
        }

        _estimateBytes(value) {
            if (!value) return 64;
            if (value instanceof ArrayBuffer) return value.byteLength;
            if (ArrayBuffer.isView(value)) return value.byteLength;
            if (typeof value.geometryByteLength === 'number' || typeof value.texturesByteLength === 'number') {
                return (
                    (value.geometryByteLength || 0) +
                    (value.texturesByteLength || 0) +
                    (value.batchTableByteLength || 0)
                );
            }
            if (typeof value === 'string') return value.length * 2;
            return 1024;
        }

        _evictIfNeeded(protectedKey = null) {
            if (this._map.size <= this.maxEntries && this.currentBytes <= this.maxBytes) return;

            for (const [candidateKey, entry] of this._map) {
                if (this._map.size <= this.maxEntries && this.currentBytes <= this.maxBytes) break;
                if (candidateKey === protectedKey || this._pinned.has(candidateKey)) continue;
                this._map.delete(candidateKey);
                this.currentBytes = Math.max(0, this.currentBytes - entry.byteSize);
                this.evictions++;
                if (this.onEvict) {
                    try {
                        this.onEvict(candidateKey, entry.value, entry.byteSize);
                    } catch (_) {
                        /* ignore */
                    }
                }
            }
        }
    }

    /**
     * Binary max-heap priority queue for camera-distance & SSE-based tile scheduling.
     */
    class TilePriorityQueue {
        constructor() {
            this._heap = [];
        }

        get size() {
            return this._heap.length;
        }

        static computePriority({ distanceMeters = 1000, screenSpaceError = 16, inFrustum = true, centerWeight = 1, depth = 0 } = {}) {
            if (!inFrustum) return -1;
            const clampedDist = Math.max(1, Number(distanceMeters) || 1);
            const sse = Math.max(0, Number(screenSpaceError) || 0);
            const focus = Math.max(0.1, Math.min(2.0, Number(centerWeight) || 1));
            const lodBonus = Math.min(20, Math.max(0, Number(depth) || 0) * 0.5);
            return (sse * 12.0 + 10000.0 / Math.sqrt(clampedDist)) * focus + lodBonus;
        }

        enqueue(item, priority) {
            const score = Number.isFinite(priority) ? priority : TilePriorityQueue.computePriority(item || {});
            this._heap.push({ item, priority: score });
            this._bubbleUp(this._heap.length - 1);
        }

        dequeue() {
            if (this._heap.length === 0) return undefined;
            const top = this._heap[0];
            const last = this._heap.pop();
            if (this._heap.length > 0) {
                this._heap[0] = last;
                this._sinkDown(0);
            }
            return top.item;
        }

        peek() {
            return this._heap.length > 0 ? this._heap[0].item : undefined;
        }

        clear() {
            this._heap.length = 0;
        }

        _bubbleUp(idx) {
            while (idx > 0) {
                const parent = (idx - 1) >> 1;
                if (this._heap[parent].priority >= this._heap[idx].priority) break;
                const tmp = this._heap[parent];
                this._heap[parent] = this._heap[idx];
                this._heap[idx] = tmp;
                idx = parent;
            }
        }

        _sinkDown(idx) {
            const n = this._heap.length;
            while (true) {
                const left = (idx << 1) + 1;
                const right = left + 1;
                let best = idx;
                if (left < n && this._heap[left].priority > this._heap[best].priority) best = left;
                if (right < n && this._heap[right].priority > this._heap[best].priority) best = right;
                if (best === idx) break;
                const tmp = this._heap[idx];
                this._heap[idx] = this._heap[best];
                this._heap[best] = tmp;
                idx = best;
            }
        }
    }

    /**
     * WGS84 Ellipsoidal Horizon Occluder + Bounding Sphere Frustum Culler
     * (Based on Cesium's Analytic Horizon Culling in Ellipsoid-Scaled Space).
     */
    class HorizonAndFrustumCuller {
        constructor() {
            this.culledByHorizon = 0;
            this.culledByFrustum = 0;
            this.testedCount = 0;
        }

        /**
         * Returns true if a bounding sphere at ECEF `targetCenter` with `radiusMeters`
         * is potentially visible above the WGS84 ellipsoid horizon from `cameraPositionEcef`.
         */
        isSphereVisibleOverHorizon(cameraPositionEcef, targetCenterEcef, radiusMeters = 0) {
            this.testedCount++;
            if (!cameraPositionEcef || !targetCenterEcef) return true;

            // Transform to unit-sphere scaled space (radii = [a, a, b])
            const r = Math.max(0, Number(radiusMeters) || 0);
            const scaledRadius = r / WGS84_B;

            const cvx = cameraPositionEcef.x / WGS84_A;
            const cvy = cameraPositionEcef.y / WGS84_A;
            const cvz = cameraPositionEcef.z / WGS84_B;
            const vhMagnitudeSquared = cvx * cvx + cvy * cvy + cvz * cvz - 1.0;

            // Camera below or on the ellipsoid surface — never occlude
            if (vhMagnitudeSquared <= 0.0) return true;

            const vhMagnitude = Math.sqrt(vhMagnitudeSquared);
            const vmMagnitude = Math.sqrt(vhMagnitudeSquared + 1.0);
            const invVm = 1.0 / vmMagnitude;

            // Unit vector from origin to camera in scaled space
            const ux = cvx * invVm;
            const uy = cvy * invVm;
            const uz = cvz * invVm;

            // Push target sphere toward camera by scaledRadius for conservative bounding check
            const tx = targetCenterEcef.x / WGS84_A + ux * scaledRadius;
            const ty = targetCenterEcef.y / WGS84_A + uy * scaledRadius;
            const tz = targetCenterEcef.z / WGS84_B + uz * scaledRadius;

            // Vector from camera to target in scaled space
            const vtx = tx - cvx;
            const vty = ty - cvy;
            const vtz = tz - cvz;

            const vtDotVc = -(vtx * cvx + vty * cvy + vtz * cvz);
            // If target lies in front of the horizon tangent plane, it is visible
            if (vtDotVc <= vhMagnitudeSquared) {
                return true;
            }

            // Check if target falls inside the shadow cone behind the ellipsoid
            const vtMagnitudeSquared = vtx * vtx + vty * vty + vtz * vtz;
            const cosConeSq = vhMagnitudeSquared / (vhMagnitudeSquared + 1.0);
            const occluded = vtDotVc * vtDotVc / vtMagnitudeSquared > cosConeSq && radiusMeters < WGS84_B * 0.25;
            if (occluded) {
                this.culledByHorizon++;
                return false;
            }
            return true;
        }

        /**
         * Test a Cesium BoundingSphere against a Cesium CullingVolume (camera frustum).
         */
        isSphereInFrustum(cullingVolume, boundingSphere) {
            if (!cullingVolume || !boundingSphere || typeof cullingVolume.computeVisibility !== 'function') {
                return true;
            }
            const visibility = cullingVolume.computeVisibility(boundingSphere);
            const outside = typeof root.Cesium !== 'undefined' && root.Cesium.Intersect
                ? root.Cesium.Intersect.OUTSIDE
                : -1;
            if (visibility === outside) {
                this.culledByFrustum++;
                return false;
            }
            return true;
        }

        getStats() {
            return {
                testedCount: this.testedCount,
                culledByHorizon: this.culledByHorizon,
                culledByFrustum: this.culledByFrustum,
            };
        }

        resetStats() {
            this.testedCount = 0;
            this.culledByHorizon = 0;
            this.culledByFrustum = 0;
        }
    }

    /**
     * Adaptive network optimizer with concurrency throttling, in-flight deduplication,
     * retry with backoff, and EMA latency/bandwidth estimation.
     */
    class AdaptiveNetworkOptimizer {
        constructor(options = {}) {
            this.maxConcurrent = Math.max(1, Math.min(32, Math.floor(Number(options.maxConcurrent ?? 6) || 6)));
            this.activeRequests = 0;
            this._queue = new TilePriorityQueue();
            this._inFlight = new Map();
            this.completedRequests = 0;
            this.failedRequests = 0;
            this.deduplicatedRequests = 0;
            this.totalBytesReceived = 0;
            this.avgLatencyMs = 0;
            this.estimatedBandwidthKbps = 0;
        }

        setMaxConcurrent(n) {
            this.maxConcurrent = Math.max(1, Math.min(32, Math.floor(Number(n) || 6)));
            this.applyToCesiumRequestScheduler();
            this._drain();
        }

        applyToCesiumRequestScheduler() {
            const RS = root.Cesium?.RequestScheduler;
            if (!RS) return;
            RS.throttleRequests = true;
            RS.maximumRequestsPerServer = this.maxConcurrent;
            RS.maximumRequests = Math.max(12, this.maxConcurrent * 4);
        }

        /**
         * Schedule an async request with priority ordering and optional URL deduplication.
         * @param {string} key
         * @param {() => Promise<any>} taskFn
         * @param {{ priority?: number, retries?: number }} [opts]
         */
        schedule(key, taskFn, opts = {}) {
            if (key && this._inFlight.has(key)) {
                this.deduplicatedRequests++;
                return this._inFlight.get(key);
            }

            const priority = Number.isFinite(opts.priority) ? opts.priority : 100;
            const retries = Math.max(0, Math.min(4, Math.floor(Number(opts.retries ?? 1) || 0)));

            const promise = new Promise((resolve, reject) => {
                this._queue.enqueue({ key, taskFn, retries, resolve, reject }, priority);
                this._drain();
            });

            if (key) {
                this._inFlight.set(key, promise);
                promise.finally(() => {
                    this._inFlight.delete(key);
                }).catch(() => {});
            }

            return promise;
        }

        recordTransfer(durationMs, byteLength = 0) {
            const ms = Math.max(1, Number(durationMs) || 1);
            const bytes = Math.max(0, Number(byteLength) || 0);
            const alpha = 0.2;
            this.avgLatencyMs = this.avgLatencyMs === 0 ? ms : this.avgLatencyMs * (1 - alpha) + ms * alpha;
            this.totalBytesReceived += bytes;
            if (bytes > 0) {
                const kbps = (bytes * 8) / ms; // bits/ms === kbit/s
                this.estimatedBandwidthKbps =
                    this.estimatedBandwidthKbps === 0
                        ? kbps
                        : this.estimatedBandwidthKbps * (1 - alpha) + kbps * alpha;
            }
        }

        /**
         * Recommend an optimal `maximumScreenSpaceError` based on current FPS and network latency.
         */
        recommendScreenSpaceError(baseSse = 8, currentFps = 60) {
            let sse = Math.max(1, Number(baseSse) || 8);
            if (currentFps > 0 && currentFps < 22) {
                sse *= 1.75;
            } else if (currentFps > 0 && currentFps < 35) {
                sse *= 1.25;
            }
            if (this.avgLatencyMs > 800) {
                sse *= 1.2;
            }
            return Math.min(64, Number(sse.toFixed(2)));
        }

        getStats() {
            return {
                maxConcurrent: this.maxConcurrent,
                activeRequests: this.activeRequests,
                queuedRequests: this._queue.size,
                inFlightKeys: this._inFlight.size,
                completedRequests: this.completedRequests,
                failedRequests: this.failedRequests,
                deduplicatedRequests: this.deduplicatedRequests,
                totalBytesReceived: this.totalBytesReceived,
                avgLatencyMs: Number(this.avgLatencyMs.toFixed(1)),
                estimatedBandwidthKbps: Number(this.estimatedBandwidthKbps.toFixed(1)),
            };
        }

        _drain() {
            while (this.activeRequests < this.maxConcurrent && this._queue.size > 0) {
                const job = this._queue.dequeue();
                if (!job) break;
                this._execute(job);
            }
        }

        async _execute(job) {
            this.activeRequests++;
            const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
            let attempt = 0;
            try {
                while (true) {
                    try {
                        const result = await job.taskFn();
                        const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
                        const size =
                            result instanceof ArrayBuffer
                                ? result.byteLength
                                : ArrayBuffer.isView(result)
                                  ? result.byteLength
                                  : 0;
                        this.completedRequests++;
                        this.recordTransfer(elapsed, size);
                        job.resolve(result);
                        break;
                    } catch (err) {
                        if (attempt >= job.retries) {
                            this.failedRequests++;
                            job.reject(err);
                            break;
                        }
                        attempt++;
                        await new Promise((r) => setTimeout(r, Math.min(1500, 120 * Math.pow(2, attempt - 1))));
                    }
                }
            } finally {
                this.activeRequests--;
                this._drain();
            }
        }
    }

    /**
     * Real-time Performance Monitor & Floating HUD (`window.performanceMonitor`).
     */
    class PerformanceMonitor {
        constructor(tileManager) {
            this.tileManager = tileManager || null;
            this._frameTimes = [];
            this._maxSamples = 120;
            this._lastFrameTs = 0;
            this._rafId = null;
            this._hudTimer = null;
            this._panel = null;
            this.isVisible = false;
            this.fps = 0;
            this.avgFrameMs = 0;
            this.p95FrameMs = 0;
        }

        recordFrame(deltaMs) {
            if (!Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > 5000) return;
            this._frameTimes.push(deltaMs);
            if (this._frameTimes.length > this._maxSamples) {
                this._frameTimes.shift();
            }
            const sum = this._frameTimes.reduce((a, b) => a + b, 0);
            this.avgFrameMs = sum / this._frameTimes.length;
            this.fps = this.avgFrameMs > 0 ? Math.min(240, 1000 / this.avgFrameMs) : 0;

            const sorted = [...this._frameTimes].sort((a, b) => a - b);
            const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
            this.p95FrameMs = sorted[p95Idx] || 0;
        }

        getSnapshot() {
            const viewer = root.tilesetViewer?.viewer || null;
            const tilesetsMap = root.tilesetViewer?.tilesets;
            const tilesetEntries = tilesetsMap instanceof Map ? [...tilesetsMap.values()] : [];

            let tilesLoaded = 0;
            let tilesVisited = 0;
            let tilesSelected = 0;
            let pendingRequests = 0;
            let gpuMemoryBytes = 0;

            for (const entry of tilesetEntries) {
                const ts = entry?.tileset || entry;
                if (!ts || ts.isDestroyed?.()) continue;
                const stats = ts.statistics || ts._statistics || {};
                tilesVisited += Number(stats.visited || 0);
                tilesSelected += Number(stats.selected || ts._selectedTiles?.length || 0);
                tilesLoaded += Number(stats.numberOfTilesTotal || stats.numberOfLoadedTilesTotal || 0);
                pendingRequests += Number(stats.numberOfPendingRequests || 0);
                gpuMemoryBytes += Number(ts.totalMemoryUsageInBytes || 0);
            }

            const perfMem = typeof performance !== 'undefined' && performance.memory ? performance.memory : null;
            const jsHeapUsedMB = perfMem ? Number((perfMem.usedJSHeapSize / (1024 * 1024)).toFixed(1)) : null;
            const jsHeapLimitMB = perfMem ? Number((perfMem.jsHeapSizeLimit / (1024 * 1024)).toFixed(1)) : null;

            return {
                timestamp: new Date().toISOString(),
                fps: Number(this.fps.toFixed(1)),
                avgFrameMs: Number(this.avgFrameMs.toFixed(2)),
                p95FrameMs: Number(this.p95FrameMs.toFixed(2)),
                tilesetsCount: tilesetEntries.length,
                tilesLoaded,
                tilesVisited,
                tilesSelected,
                pendingRequests,
                gpuMemoryMB: Number((gpuMemoryBytes / (1024 * 1024)).toFixed(2)),
                jsHeapUsedMB,
                jsHeapLimitMB,
                requestRenderMode: Boolean(viewer?.scene?.requestRenderMode),
                cache: this.tileManager ? this.tileManager.cache.getStats() : null,
                network: this.tileManager ? this.tileManager.network.getStats() : null,
                culling: this.tileManager ? this.tileManager.culler.getStats() : null,
            };
        }

        show() {
            if (root.moduleRuntimeGate && !root.moduleRuntimeGate.isModuleEnabled('performanceMonitor')) {
                return;
            }
            this._ensurePanel();
            this._panel.style.display = 'block';
            this.isVisible = true;
            this._startSampling();
            this._renderHud();
        }

        hide() {
            if (this._panel) {
                this._panel.style.display = 'none';
            }
            this.isVisible = false;
            this._stopSampling();
        }

        toggle() {
            if (this.isVisible) this.hide();
            else this.show();
        }

        exportReport() {
            const report = this.getSnapshot();
            if (typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
                const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `simplexdm-performance-${Date.now()}.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                root.notification?.success?.('Performance report exported');
            }
            return report;
        }

        _startSampling() {
            if (typeof requestAnimationFrame === 'function' && this._rafId === null) {
                this._lastFrameTs = 0;
                const tick = (ts) => {
                    if (!this.isVisible) {
                        this._rafId = null;
                        return;
                    }
                    if (this._lastFrameTs > 0) {
                        this.recordFrame(ts - this._lastFrameTs);
                    }
                    this._lastFrameTs = ts;
                    this._rafId = requestAnimationFrame(tick);
                };
                this._rafId = requestAnimationFrame(tick);
            }
            if (this._hudTimer === null) {
                this._hudTimer = setInterval(() => this._renderHud(), 500);
            }
        }

        _stopSampling() {
            if (this._rafId !== null && typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(this._rafId);
                this._rafId = null;
            }
            if (this._hudTimer !== null) {
                clearInterval(this._hudTimer);
                this._hudTimer = null;
            }
        }

        _ensurePanel() {
            if (this._panel || typeof document === 'undefined') return;
            const panel = document.createElement('div');
            panel.id = 'simplexPerformanceMonitor';
            panel.setAttribute('role', 'region');
            panel.setAttribute('aria-label', 'Performance Monitor');
            panel.style.cssText =
                'position:fixed;bottom:52px;left:16px;z-index:2600;width:290px;' +
                'background:var(--surface-elevated,rgba(18,22,30,0.94));color:var(--text-primary,#f1f5f9);' +
                'border:1px solid var(--border-subtle,rgba(148,163,184,0.25));border-radius:10px;' +
                'box-shadow:0 12px 32px rgba(0,0,0,0.45);font-family:var(--font-sans,system-ui,sans-serif);' +
                'font-size:12px;padding:10px 12px;backdrop-filter:blur(10px);display:none;';
            panel.innerHTML =
                '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;border-bottom:1px solid rgba(148,163,184,0.18);padding-bottom:6px;">' +
                '<strong style="font-size:12.5px;letter-spacing:0.02em;">⚡ Performance Monitor</strong>' +
                '<div style="display:flex;gap:4px;">' +
                '<button type="button" id="perfMonClearCacheBtn" title="Clear LRU tile cache" style="background:rgba(148,163,184,0.16);color:inherit;border:none;border-radius:5px;padding:2px 6px;cursor:pointer;font-size:11px;">Purge</button>' +
                '<button type="button" id="perfMonExportBtn" title="Export JSON report" style="background:rgba(59,130,246,0.25);color:inherit;border:none;border-radius:5px;padding:2px 6px;cursor:pointer;font-size:11px;">Export</button>' +
                '<button type="button" id="perfMonCloseBtn" aria-label="Close performance monitor" style="background:transparent;color:inherit;border:none;cursor:pointer;font-size:15px;line-height:1;padding:0 4px;">×</button>' +
                '</div></div>' +
                '<div id="perfMonMetrics" style="display:grid;grid-template-columns:1fr auto;row-gap:4px;column-gap:8px;"></div>';

            document.body.appendChild(panel);
            panel.querySelector('#perfMonCloseBtn')?.addEventListener('click', () => this.hide());
            panel.querySelector('#perfMonExportBtn')?.addEventListener('click', () => this.exportReport());
            panel.querySelector('#perfMonClearCacheBtn')?.addEventListener('click', () => {
                this.tileManager?.clearCache();
                this._renderHud();
                root.notification?.info?.('Tile cache cleared');
            });
            this._panel = panel;
        }

        _renderHud() {
            if (!this._panel || !this.isVisible) return;
            const body = this._panel.querySelector('#perfMonMetrics');
            if (!body) return;
            const s = this.getSnapshot();
            const fpsColor = s.fps >= 45 ? '#4ade80' : s.fps >= 25 ? '#facc15' : '#f87171';
            const hitPct = s.cache ? `${(s.cache.hitRate * 100).toFixed(0)}%` : '—';
            const cacheStr = s.cache ? `${s.cache.entries}/${s.cache.maxEntries} (${hitPct})` : '—';
            const netStr = s.network
                ? `${s.network.activeRequests}/${s.network.maxConcurrent} (${s.network.avgLatencyMs} ms)`
                : '—';
            const heapStr = s.jsHeapUsedMB !== null ? `${s.jsHeapUsedMB} MB` : 'n/a';

            const rows = [
                ['Frame rate', `<span style="color:${fpsColor};font-weight:600;">${escapeHtml(s.fps)} FPS</span>`],
                ['Frame time (avg / p95)', `${escapeHtml(s.avgFrameMs)} / ${escapeHtml(s.p95FrameMs)} ms`],
                ['Tilesets / selected', `${escapeHtml(s.tilesetsCount)} / ${escapeHtml(s.tilesSelected)}`],
                ['GPU tile memory', `${escapeHtml(s.gpuMemoryMB)} MB`],
                ['JS heap used', escapeHtml(heapStr)],
                ['LRU tile cache', escapeHtml(cacheStr)],
                ['Network requests', escapeHtml(netStr)],
                ['Horizon culled', escapeHtml(s.culling ? s.culling.culledByHorizon : 0)],
            ];

            body.innerHTML = rows
                .map(
                    ([label, val]) =>
                        `<span style="opacity:0.78;">${escapeHtml(label)}</span><span style="text-align:right;font-variant-numeric:tabular-nums;">${val}</span>`
                )
                .join('');
        }
    }

    /**
     * Coordinates LRU caching, horizon/frustum culling, priority loading, and
     * Cesium3DTileset streaming optimization across all loaded 3D tilesets.
     */
    class AdvancedTileLoadingManager {
        constructor() {
            this.cache = new LRUTileCache({ maxEntries: 500, maxBytes: 512 * 1024 * 1024 });
            this.priorityQueue = new TilePriorityQueue();
            this.culler = new HorizonAndFrustumCuller();
            this.network = new AdaptiveNetworkOptimizer({ maxConcurrent: 6 });
            this.monitor = new PerformanceMonitor(this);
            this.enableHorizonCulling = true;
            this.enableFrustumCulling = true;
            this.adaptiveSseEnabled = false;
            this._initialized = false;
            this._attachedTilesets = new WeakSet();
        }

        init() {
            if (this._initialized) return;
            this._initialized = true;
            this.applyConfig(root.jsonConfigManager?.getConfig?.());
            this.network.applyToCesiumRequestScheduler();

            if (typeof root.addEventListener === 'function') {
                root.addEventListener('jsonConfigUpdated', (ev) => {
                    this.applyConfig(ev?.detail || root.jsonConfigManager?.getConfig?.());
                });
            }
        }

        applyConfig(cfg) {
            if (!cfg || typeof cfg !== 'object') return;
            const perf = cfg.performance || {};
            if (Number.isFinite(Number(perf.tileCacheSize)) && Number(perf.tileCacheSize) > 0) {
                this.cache.resize(Number(perf.tileCacheSize));
            }
            if (Number.isFinite(Number(perf.tileCacheMaxMB)) && Number(perf.tileCacheMaxMB) > 0) {
                this.cache.resize(undefined, Number(perf.tileCacheMaxMB) * 1024 * 1024);
            }
            if (Number.isFinite(Number(perf.maxConcurrentRequests)) && Number(perf.maxConcurrentRequests) > 0) {
                this.network.setMaxConcurrent(Number(perf.maxConcurrentRequests));
            }
            if (typeof perf.enableHorizonCulling === 'boolean') {
                this.enableHorizonCulling = perf.enableHorizonCulling;
            }
            if (typeof perf.enableFrustumCulling === 'boolean') {
                this.enableFrustumCulling = perf.enableFrustumCulling;
            }
            if (typeof perf.adaptiveSse === 'boolean') {
                this.adaptiveSseEnabled = perf.adaptiveSse;
            }
        }

        /**
         * Optimize a newly added `Cesium3DTileset` with cache sizing, horizon/frustum culling,
         * progressive foveated priority loading, and LRU tile lifecycle tracking.
         */
        optimizeTileset(tileset, options = {}) {
            if (!tileset || typeof tileset !== 'object') return tileset;

            const cacheMemoryMB = Math.max(128, Math.round(this.cache.maxBytes / (1024 * 1024)));
            if ('maximumMemoryUsage' in tileset) {
                tileset.maximumMemoryUsage = options.maximumMemoryUsage ?? cacheMemoryMB;
            }
            if ('cacheBytes' in tileset) {
                tileset.cacheBytes = options.cacheBytes ?? this.cache.maxBytes;
            }
            if ('maximumCacheOverflowBytes' in tileset) {
                tileset.maximumCacheOverflowBytes = Math.round(this.cache.maxBytes * 0.5);
            }

            // Camera-centric foveated priority loading & progressive LOD resolution
            tileset.cullWithChildrenBounds = this.enableFrustumCulling;
            tileset.cullRequestsWhileMoving = true;
            tileset.cullRequestsWhileMovingMultiplier = options.cullRequestsWhileMovingMultiplier ?? 60.0;
            tileset.foveatedScreenSpaceError = true;
            tileset.foveatedConeSize = 0.15;
            tileset.foveatedMinimumScreenSpaceErrorRelaxation = 0.0;
            tileset.progressiveResolutionHeightFraction = 0.3;
            tileset.preferLeaves = false;
            tileset.preloadWhenHidden = false;
            tileset.preloadFlightDestinations = true;

            if (this.enableHorizonCulling) {
                tileset.dynamicScreenSpaceError = Boolean(
                    options.enableDynamicScreenSpaceError ?? tileset.dynamicScreenSpaceError
                );
                tileset.dynamicScreenSpaceErrorDensity = 0.00278;
                tileset.dynamicScreenSpaceErrorFactor = 4.0;
                tileset.dynamicScreenSpaceErrorHeightFalloff = 0.25;
            }

            if (!this._attachedTilesets.has(tileset)) {
                this._attachedTilesets.add(tileset);
                this._wireTilesetEvents(tileset);
            }

            this.network.applyToCesiumRequestScheduler();
            return tileset;
        }

        _wireTilesetEvents(tileset) {
            if (tileset.tileLoad && typeof tileset.tileLoad.addEventListener === 'function') {
                tileset.tileLoad.addEventListener((tile) => {
                    const key = tile?._contentResource?.url || tile?.content?._resource?.url;
                    if (!key) return;
                    const content = tile.content || {};
                    const bytes =
                        Number(content.geometryByteLength || 0) +
                        Number(content.texturesByteLength || 0) +
                        Number(content.batchTableByteLength || 0);
                    this.cache.set(
                        key,
                        {
                            url: key,
                            geometricError: tile.geometricError ?? 0,
                            loadedAt: Date.now(),
                            bytes,
                        },
                        bytes || 4096
                    );
                });
            }

            if (tileset.tileUnload && typeof tileset.tileUnload.addEventListener === 'function') {
                tileset.tileUnload.addEventListener((tile) => {
                    const key = tile?._contentResource?.url || tile?.content?._resource?.url;
                    if (key) this.cache.delete(key);
                });
            }

            if (tileset.tileVisible && typeof tileset.tileVisible.addEventListener === 'function') {
                tileset.tileVisible.addEventListener((tile) => {
                    const key = tile?._contentResource?.url || tile?.content?._resource?.url;
                    if (key && this.cache.has(key)) {
                        this.cache.get(key); // bump LRU recency
                    }
                });
            }
        }

        /**
         * Rank candidate tiles for loading given camera state, pruning horizon- and frustum-culled tiles.
         */
        rankCandidateTiles(tiles, cameraState = {}) {
            if (!Array.isArray(tiles) || tiles.length === 0) return [];
            const { positionEcef, cullingVolume } = cameraState;
            const queue = new TilePriorityQueue();

            for (const tile of tiles) {
                const sphere = tile?.boundingSphere || tile?.boundingVolume?.boundingSphere;
                if (this.enableFrustumCulling && cullingVolume && sphere) {
                    if (!this.culler.isSphereInFrustum(cullingVolume, sphere)) continue;
                }
                if (this.enableHorizonCulling && positionEcef && sphere?.center) {
                    if (!this.culler.isSphereVisibleOverHorizon(positionEcef, sphere.center, sphere.radius || 0)) {
                        continue;
                    }
                }
                const priority = TilePriorityQueue.computePriority({
                    distanceMeters: tile?.distanceToCamera ?? tile?._distanceToCamera ?? 1000,
                    screenSpaceError: tile?.screenSpaceError ?? tile?._screenSpaceError ?? tile?.geometricError ?? 16,
                    inFrustum: true,
                    centerWeight: tile?.centerWeight ?? 1,
                    depth: tile?.depth ?? tile?._depth ?? 0,
                });
                queue.enqueue(tile, priority);
            }

            const ordered = [];
            while (queue.size > 0) {
                ordered.push(queue.dequeue());
            }
            return ordered;
        }

        clearCache() {
            this.cache.clear();
            root.b3dmFeatureExtractor?.clearCache?.();
        }

        getStats() {
            return this.monitor.getSnapshot();
        }
    }

    const manager = new AdvancedTileLoadingManager();

    if (root && typeof root === 'object') {
        root.LRUTileCache = LRUTileCache;
        root.TilePriorityQueue = TilePriorityQueue;
        root.HorizonAndFrustumCuller = HorizonAndFrustumCuller;
        root.AdaptiveNetworkOptimizer = AdaptiveNetworkOptimizer;
        root.PerformanceMonitor = PerformanceMonitor;
        root.AdvancedTileLoadingManager = AdvancedTileLoadingManager;
        root.advancedTileLoading = manager;
        root.performanceMonitor = manager.monitor;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            LRUTileCache,
            TilePriorityQueue,
            HorizonAndFrustumCuller,
            AdaptiveNetworkOptimizer,
            PerformanceMonitor,
            AdvancedTileLoadingManager,
            advancedTileLoading: manager,
            performanceMonitor: manager.monitor,
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
