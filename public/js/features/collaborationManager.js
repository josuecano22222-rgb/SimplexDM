/**
 * Collaboration, Annotations & Presentation Manager (`public/js/features/collaborationManager.js`)
 *
 * Offline-first collaboration workflow with optional REST backend synchronization:
 * - Georeferenced 3D scene annotations/comments (with Cesium pin + label entities)
 * - Shared camera bookmarks (stored in `collaboration_bookmarks` & bridged with `bookmarkManager`)
 * - Guided camera presentations / storyboards (`collaboration_presentations`) with playback
 * - Portable `.json` collaboration package export & import for offline team sharing
 * - Optional REST sync (`backendUrl`, health check at `{backendUrl}/health`)
 */
(function (root) {
    'use strict';

    const STORAGE_KEYS = Object.freeze({
        bookmarks: 'collaboration_bookmarks',
        annotations: 'collaboration_annotations',
        presentations: 'collaboration_presentations',
        settings: 'collaboration_settings',
    });

    const CATEGORY_COLORS = Object.freeze({
        note: '#38bdf8',
        issue: '#f87171',
        review: '#facc15',
        approved: '#4ade80',
    });

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function makeId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function safeReadJson(key, fallback) {
        try {
            if (typeof localStorage === 'undefined') return fallback;
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return parsed ?? fallback;
        } catch (_) {
            return fallback;
        }
    }

    function safeWriteJson(key, value) {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(key, JSON.stringify(value));
            }
        } catch (err) {
            console.warn('[CollaborationManager] localStorage write failed:', err.message);
        }
    }

    class CollaborationManager {
        constructor() {
            this.annotations = [];
            this.sharedBookmarks = [];
            this.presentations = [];
            this.settings = {
                author: 'Reviewer',
                backendUrl: '',
                showPins: true,
            };
            this.activeTab = 'annotations';
            this.isVisible = false;
            this._isPlacing = false;
            this._clickHandler = null;
            this._entities = new Map();
            this._modal = null;
            this._tourTimer = null;
            this._activeTour = null;
            this._initialized = false;
        }

        init() {
            if (this._initialized) return;
            this._initialized = true;
            this._loadFromStorage();
            this._bindToolbarButton();
            this._syncAllEntities();
        }

        _isEnabled() {
            if (root.moduleRuntimeGate && typeof root.moduleRuntimeGate.isModuleEnabled === 'function') {
                return root.moduleRuntimeGate.isModuleEnabled('collaborationManager');
            }
            return true;
        }

        _loadFromStorage() {
            const anns = safeReadJson(STORAGE_KEYS.annotations, []);
            const bms = safeReadJson(STORAGE_KEYS.bookmarks, []);
            const pres = safeReadJson(STORAGE_KEYS.presentations, []);
            const cfg = safeReadJson(STORAGE_KEYS.settings, {});

            this.annotations = Array.isArray(anns) ? anns : [];
            this.sharedBookmarks = Array.isArray(bms) ? bms : [];
            this.presentations = Array.isArray(pres) ? pres : [];
            if (cfg && typeof cfg === 'object') {
                this.settings = { ...this.settings, ...cfg };
            }
        }

        _saveToStorage() {
            safeWriteJson(STORAGE_KEYS.annotations, this.annotations);
            safeWriteJson(STORAGE_KEYS.bookmarks, this.sharedBookmarks);
            safeWriteJson(STORAGE_KEYS.presentations, this.presentations);
            safeWriteJson(STORAGE_KEYS.settings, this.settings);
        }

        _bindToolbarButton() {
            if (typeof document === 'undefined') return;
            const commentBtn = document.getElementById('commentBtn');
            if (commentBtn && !commentBtn.dataset.collabWired) {
                commentBtn.dataset.collabWired = '1';
                commentBtn.addEventListener('click', () => this.toggle());
            }
        }

        _captureCameraState() {
            if (root.tilesetViewer && typeof root.tilesetViewer.getCameraPosition === 'function') {
                const pos = root.tilesetViewer.getCameraPosition();
                if (pos) return pos;
            }
            const viewer = root.tilesetViewer?.viewer;
            if (!viewer || typeof root.Cesium === 'undefined') return null;
            const cam = viewer.camera;
            const carto = cam.positionCartographic;
            if (!carto) return null;
            return {
                lon: Number(root.Cesium.Math.toDegrees(carto.longitude).toFixed(7)),
                lat: Number(root.Cesium.Math.toDegrees(carto.latitude).toFixed(7)),
                height: Number(carto.height.toFixed(2)),
                heading: Number(root.Cesium.Math.toDegrees(cam.heading).toFixed(2)),
                pitch: Number(root.Cesium.Math.toDegrees(cam.pitch).toFixed(2)),
                roll: Number(root.Cesium.Math.toDegrees(cam.roll).toFixed(2)),
            };
        }

        _flyToState(state, duration = 1.4) {
            if (!state) return false;
            if (root.tilesetViewer && typeof root.tilesetViewer.flyTo === 'function') {
                root.tilesetViewer.flyTo({ ...state, duration });
                return true;
            }
            const viewer = root.tilesetViewer?.viewer;
            const C = root.Cesium;
            if (!viewer || !C) return false;
            viewer.camera.flyTo({
                destination: C.Cartesian3.fromDegrees(
                    Number(state.lon ?? state.longitude ?? 0),
                    Number(state.lat ?? state.latitude ?? 0),
                    Number(state.height ?? 500)
                ),
                orientation: {
                    heading: C.Math.toRadians(Number(state.heading ?? 0)),
                    pitch: C.Math.toRadians(Number(state.pitch ?? -45)),
                    roll: C.Math.toRadians(Number(state.roll ?? 0)),
                },
                duration,
            });
            viewer.scene?.requestRender?.();
            return true;
        }

        // ------------------------------------------------------------------
        // Annotations CRUD + 3D Scene Pins
        // ------------------------------------------------------------------

        addAnnotation(data = {}) {
            const title = String(data.title || 'Untitled Note').trim();
            if (!title) throw new Error('Annotation title is required');
            const cam = this._captureCameraState();
            const lon = Number.isFinite(Number(data.lon)) ? Number(data.lon) : cam?.lon ?? 0;
            const lat = Number.isFinite(Number(data.lat)) ? Number(data.lat) : cam?.lat ?? 0;
            const height = Number.isFinite(Number(data.height)) ? Number(data.height) : Math.max(0, cam?.height ?? 0);
            const category = CATEGORY_COLORS[data.category] ? data.category : 'note';

            const annotation = {
                id: data.id || makeId('ann'),
                title,
                text: String(data.text || '').trim(),
                author: String(data.author || this.settings.author || 'Reviewer').trim(),
                category,
                resolved: Boolean(data.resolved),
                lon: Number(lon.toFixed(7)),
                lat: Number(lat.toFixed(7)),
                height: Number(height.toFixed(2)),
                camera: data.camera || cam || { lon, lat, height: Math.max(150, height + 150), heading: 0, pitch: -45, roll: 0 },
                createdAt: data.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            this.annotations.unshift(annotation);
            this._saveToStorage();
            this._upsertEntity(annotation);
            this._renderBody();
            return annotation;
        }

        updateAnnotation(id, patch = {}) {
            const ann = this.annotations.find((a) => a.id === id);
            if (!ann) return null;
            if (typeof patch.title === 'string' && patch.title.trim()) ann.title = patch.title.trim();
            if (typeof patch.text === 'string') ann.text = patch.text.trim();
            if (patch.category && CATEGORY_COLORS[patch.category]) ann.category = patch.category;
            if (typeof patch.resolved === 'boolean') ann.resolved = patch.resolved;
            ann.updatedAt = new Date().toISOString();
            this._saveToStorage();
            this._upsertEntity(ann);
            this._renderBody();
            return ann;
        }

        deleteAnnotation(id) {
            const before = this.annotations.length;
            this.annotations = this.annotations.filter((a) => a.id !== id);
            if (this.annotations.length === before) return false;
            this._removeEntity(id);
            this._saveToStorage();
            this._renderBody();
            return true;
        }

        flyToAnnotation(id) {
            const ann = this.annotations.find((a) => a.id === id);
            if (!ann) return false;
            return this._flyToState(
                ann.camera || { lon: ann.lon, lat: ann.lat, height: ann.height + 200, heading: 0, pitch: -45, roll: 0 }
            );
        }

        setPinsVisible(visible) {
            this.settings.showPins = Boolean(visible);
            this._saveToStorage();
            for (const ent of this._entities.values()) {
                ent.show = this.settings.showPins;
            }
            root.tilesetViewer?.viewer?.scene?.requestRender?.();
        }

        startInteractivePlacement(onPicked) {
            const viewer = root.tilesetViewer?.viewer;
            const C = root.Cesium;
            if (!viewer || !C) {
                root.notification?.warning?.('Viewer not initialized');
                return false;
            }
            this.cancelInteractivePlacement();
            this._isPlacing = true;
            root.notification?.info?.('Click a point in the 3D scene to place an annotation (Esc to cancel).');

            const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
            handler.setInputAction((movement) => {
                let cartesian = null;
                if (root.safePickPosition && typeof root.safePickPosition === 'function') {
                    cartesian = root.safePickPosition(viewer, movement.position);
                } else if (viewer.scene.pickPositionSupported) {
                    cartesian = viewer.scene.pickPosition(movement.position);
                }
                if (!cartesian) {
                    cartesian = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
                }
                this.cancelInteractivePlacement();
                if (!cartesian) {
                    root.notification?.warning?.('Could not resolve 3D coordinates at clicked point');
                    return;
                }
                const carto = C.Cartographic.fromCartesian(cartesian);
                const picked = {
                    lon: Number(C.Math.toDegrees(carto.longitude).toFixed(7)),
                    lat: Number(C.Math.toDegrees(carto.latitude).toFixed(7)),
                    height: Number(Math.max(0, carto.height).toFixed(2)),
                };
                if (typeof onPicked === 'function') {
                    onPicked(picked);
                }
            }, C.ScreenSpaceEventType.LEFT_CLICK);
            this._clickHandler = handler;
            return true;
        }

        cancelInteractivePlacement() {
            if (this._clickHandler) {
                try {
                    this._clickHandler.destroy();
                } catch (_) {
                    /* ignore */
                }
                this._clickHandler = null;
            }
            this._isPlacing = false;
        }

        _upsertEntity(ann) {
            const viewer = root.tilesetViewer?.viewer;
            const C = root.Cesium;
            if (!viewer?.entities || !C) return;
            this._removeEntity(ann.id);

            const colorHex = ann.resolved ? '#94a3b8' : CATEGORY_COLORS[ann.category] || '#38bdf8';
            const entity = viewer.entities.add({
                id: `collab_${ann.id}`,
                name: ann.title,
                description: escapeHtml(ann.text || ''),
                show: Boolean(this.settings.showPins),
                position: C.Cartesian3.fromDegrees(ann.lon, ann.lat, ann.height),
                point: {
                    pixelSize: 11,
                    color: C.Color.fromCssColorString(colorHex),
                    outlineColor: C.Color.WHITE,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
                label: {
                    text: ann.title,
                    font: '600 12px system-ui, sans-serif',
                    fillColor: C.Color.WHITE,
                    outlineColor: C.Color.BLACK,
                    outlineWidth: 3,
                    style: C.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new C.Cartesian2(0, -18),
                    verticalOrigin: C.VerticalOrigin.BOTTOM,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            });
            this._entities.set(ann.id, entity);
            viewer.scene?.requestRender?.();
        }

        _removeEntity(id) {
            const viewer = root.tilesetViewer?.viewer;
            const ent = this._entities.get(id);
            if (ent && viewer?.entities) {
                try {
                    viewer.entities.remove(ent);
                } catch (_) {
                    /* ignore */
                }
            }
            this._entities.delete(id);
            viewer?.scene?.requestRender?.();
        }

        _syncAllEntities() {
            for (const ann of this.annotations) {
                this._upsertEntity(ann);
            }
        }

        // ------------------------------------------------------------------
        // Shared Bookmarks
        // ------------------------------------------------------------------

        shareCurrentView(name, description = '') {
            const camera = this._captureCameraState();
            if (!camera) {
                throw new Error('Camera position unavailable');
            }
            const bm = {
                id: makeId('cbm'),
                name: String(name || `Shared View ${this.sharedBookmarks.length + 1}`).trim(),
                description: String(description || '').trim(),
                author: this.settings.author || 'Reviewer',
                camera,
                shareUrl: this._buildShareUrl(camera, name),
                createdAt: new Date().toISOString(),
            };
            this.sharedBookmarks.unshift(bm);
            this._saveToStorage();
            this._renderBody();
            return bm;
        }

        importFromBookmarkManager() {
            const list = root.bookmarkManager?.bookmarks;
            if (!Array.isArray(list) || list.length === 0) return 0;
            let added = 0;
            const existingNames = new Set(this.sharedBookmarks.map((b) => b.name));
            for (const b of list) {
                if (!b || existingNames.has(b.name)) continue;
                const pos = b.position || b.camera || {};
                const lon = Number(pos.lon ?? pos.longitude);
                const lat = Number(pos.lat ?? pos.latitude);
                if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
                this.sharedBookmarks.push({
                    id: makeId('cbm'),
                    name: b.name,
                    description: b.description || '',
                    author: this.settings.author || 'Reviewer',
                    camera: {
                        lon,
                        lat,
                        height: Number(pos.height ?? 500),
                        heading: Number(b.orientation?.heading ?? pos.heading ?? 0),
                        pitch: Number(b.orientation?.pitch ?? pos.pitch ?? -45),
                        roll: Number(b.orientation?.roll ?? pos.roll ?? 0),
                    },
                    createdAt: b.createdAt || new Date().toISOString(),
                });
                existingNames.add(b.name);
                added++;
            }
            if (added > 0) {
                this._saveToStorage();
                this._renderBody();
            }
            return added;
        }

        deleteSharedBookmark(id) {
            const before = this.sharedBookmarks.length;
            this.sharedBookmarks = this.sharedBookmarks.filter((b) => b.id !== id);
            if (this.sharedBookmarks.length === before) return false;
            this._saveToStorage();
            this._renderBody();
            return true;
        }

        _buildShareUrl(camera, label = '') {
            const base =
                typeof root.location !== 'undefined' && root.location.origin && root.location.origin !== 'null'
                    ? `${root.location.origin}${root.location.pathname}`
                    : 'http://localhost:8000/index.html';
            const params = new URLSearchParams({
                lat: String(camera.lat),
                lon: String(camera.lon),
                height: String(camera.height),
                heading: String(camera.heading ?? 0),
                pitch: String(camera.pitch ?? -45),
            });
            if (label) params.set('label', String(label));
            return `${base}?${params.toString()}`;
        }

        // ------------------------------------------------------------------
        // Presentations (Guided 3D Camera Tours)
        // ------------------------------------------------------------------

        createPresentation(title, slides = []) {
            const cleanTitle = String(title || '').trim();
            if (!cleanTitle) throw new Error('Presentation title is required');
            const pres = {
                id: makeId('pres'),
                title: cleanTitle,
                author: this.settings.author || 'Reviewer',
                slides: Array.isArray(slides) ? slides : [],
                createdAt: new Date().toISOString(),
            };
            this.presentations.unshift(pres);
            this._saveToStorage();
            this._renderBody();
            return pres;
        }

        addSlideToPresentation(presentationId, caption = '', dwellSeconds = 5) {
            const pres = this.presentations.find((p) => p.id === presentationId);
            if (!pres) throw new Error('Presentation not found');
            const camera = this._captureCameraState();
            if (!camera) throw new Error('Camera position unavailable');
            const slide = {
                id: makeId('slide'),
                caption: String(caption || `Slide ${pres.slides.length + 1}`).trim(),
                dwellSeconds: Math.max(2, Math.min(60, Number(dwellSeconds) || 5)),
                camera,
            };
            pres.slides.push(slide);
            this._saveToStorage();
            this._renderBody();
            return slide;
        }

        deletePresentation(presentationId) {
            if (this._activeTour?.presentationId === presentationId) {
                this.stopPresentation();
            }
            const before = this.presentations.length;
            this.presentations = this.presentations.filter((p) => p.id !== presentationId);
            if (this.presentations.length === before) return false;
            this._saveToStorage();
            this._renderBody();
            return true;
        }

        playPresentation(presentationId, startIndex = 0) {
            const pres = this.presentations.find((p) => p.id === presentationId);
            if (!pres || !Array.isArray(pres.slides) || pres.slides.length === 0) {
                root.notification?.warning?.('Presentation has no slides');
                return false;
            }
            this.stopPresentation();
            this._activeTour = { presentationId, index: Math.max(0, startIndex) };

            const step = () => {
                if (!this._activeTour) return;
                const slide = pres.slides[this._activeTour.index];
                if (!slide) {
                    this.stopPresentation();
                    root.notification?.info?.(`Finished "${pres.title}"`);
                    return;
                }
                this._flyToState(slide.camera, 1.5);
                root.notification?.info?.(
                    `[${this._activeTour.index + 1}/${pres.slides.length}] ${slide.caption}`
                );
                this._activeTour.index++;
                this._tourTimer = setTimeout(step, (slide.dwellSeconds || 5) * 1000);
            };
            step();
            return true;
        }

        stopPresentation() {
            if (this._tourTimer) {
                clearTimeout(this._tourTimer);
                this._tourTimer = null;
            }
            this._activeTour = null;
        }

        // ------------------------------------------------------------------
        // Portable JSON Package Export/Import + Optional REST Backend Sync
        // ------------------------------------------------------------------

        toPackage() {
            return {
                schema: 'simplexdm-collaboration-package',
                version: 1,
                exportedAt: new Date().toISOString(),
                author: this.settings.author,
                annotations: this.annotations,
                bookmarks: this.sharedBookmarks,
                presentations: this.presentations,
            };
        }

        exportPackage() {
            const pkg = this.toPackage();
            if (typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
                const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `simplexdm-collaboration-${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                root.notification?.success?.('Collaboration package exported');
            }
            return pkg;
        }

        importPackage(pkg, { merge = true } = {}) {
            const parsed = typeof pkg === 'string' ? JSON.parse(pkg) : pkg;
            if (!parsed || typeof parsed !== 'object') {
                throw new Error('Invalid collaboration package');
            }

            const mergeById = (existing, incoming) => {
                if (!merge) return Array.isArray(incoming) ? [...incoming] : [];
                const map = new Map(existing.map((item) => [item.id, item]));
                for (const item of Array.isArray(incoming) ? incoming : []) {
                    if (item && typeof item === 'object') {
                        const id = item.id || makeId('imp');
                        map.set(id, { ...item, id });
                    }
                }
                return [...map.values()];
            };

            this.annotations = mergeById(this.annotations, parsed.annotations);
            this.sharedBookmarks = mergeById(this.sharedBookmarks, parsed.bookmarks);
            this.presentations = mergeById(this.presentations, parsed.presentations);

            this._saveToStorage();
            this._syncAllEntities();
            this._renderBody();

            return {
                annotations: this.annotations.length,
                bookmarks: this.sharedBookmarks.length,
                presentations: this.presentations.length,
            };
        }

        async checkBackendHealth(customUrl) {
            const base = String(customUrl ?? this.settings.backendUrl ?? '').trim().replace(/\/+$/, '');
            if (!base) {
                return { ok: false, offline: true, message: 'No backend URL configured (offline mode)' };
            }
            try {
                const resp = await fetch(`${base}/health`, { method: 'GET' });
                return { ok: resp.ok, status: resp.status, url: `${base}/health` };
            } catch (err) {
                return { ok: false, error: err.message, url: `${base}/health` };
            }
        }

        async syncWithBackend() {
            const base = String(this.settings.backendUrl || '').trim().replace(/\/+$/, '');
            if (!base) {
                throw new Error('Configure a collaboration backend URL first, or use Export/Import JSON for offline sharing.');
            }
            const health = await this.checkBackendHealth(base);
            if (!health.ok) {
                throw new Error(`Collaboration backend unreachable (${health.error || health.status})`);
            }
            const resp = await fetch(`${base}/collaboration/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.toPackage()),
            });
            if (!resp.ok) {
                throw new Error(`Sync failed: HTTP ${resp.status}`);
            }
            const remotePkg = await resp.json();
            return this.importPackage(remotePkg, { merge: true });
        }

        // ------------------------------------------------------------------
        // Modal UI
        // ------------------------------------------------------------------

        show(tab) {
            if (!this._isEnabled()) {
                root.notification?.info?.('Collaboration module is disabled in Control Center.');
                return;
            }
            if (tab) this.activeTab = tab;
            this._ensureModal();
            this._modal.style.display = 'flex';
            this.isVisible = true;
            this._renderBody();
        }

        hide() {
            this.cancelInteractivePlacement();
            if (this._modal) {
                this._modal.style.display = 'none';
            }
            this.isVisible = false;
        }

        toggle() {
            if (this.isVisible) this.hide();
            else this.show();
        }

        clearAll() {
            this.stopPresentation();
            for (const id of [...this._entities.keys()]) {
                this._removeEntity(id);
            }
            this.annotations = [];
            this.sharedBookmarks = [];
            this.presentations = [];
            this._saveToStorage();
            this._renderBody();
        }

        _ensureModal() {
            if (this._modal || typeof document === 'undefined') return;
            const modal = document.createElement('div');
            modal.id = 'collaborationModal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-label', 'Collaboration & Annotations');
            modal.style.cssText =
                'position:fixed;top:68px;right:64px;z-index:2700;width:380px;max-height:calc(100vh - 120px);' +
                'display:none;flex-direction:column;background:var(--surface-elevated,#141923);' +
                'color:var(--text-primary,#f1f5f9);border:1px solid var(--border-subtle,rgba(148,163,184,0.25));' +
                'border-radius:12px;box-shadow:0 18px 42px rgba(0,0,0,0.5);font-family:var(--font-sans,system-ui,sans-serif);font-size:13px;overflow:hidden;';

            modal.innerHTML =
                '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(148,163,184,0.18);">' +
                '<strong>Collaboration & Annotations</strong>' +
                '<div style="display:flex;gap:6px;align-items:center;">' +
                '<button type="button" id="collabExportBtn" title="Export JSON package" style="background:rgba(59,130,246,0.22);color:inherit;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11.5px;">Export</button>' +
                '<button type="button" id="collabImportBtn" title="Import JSON package" style="background:rgba(148,163,184,0.18);color:inherit;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11.5px;">Import</button>' +
                '<input type="file" id="collabImportFile" accept=".json,application/json" style="display:none;" />' +
                '<button type="button" id="collabCloseBtn" aria-label="Close collaboration panel" style="background:transparent;color:inherit;border:none;font-size:18px;cursor:pointer;line-height:1;">×</button>' +
                '</div></div>' +
                '<div id="collabTabBar" style="display:flex;border-bottom:1px solid rgba(148,163,184,0.18);">' +
                '<button type="button" data-tab="annotations" style="flex:1;padding:8px;background:transparent;color:inherit;border:none;cursor:pointer;font-size:12px;">Notes</button>' +
                '<button type="button" data-tab="bookmarks" style="flex:1;padding:8px;background:transparent;color:inherit;border:none;cursor:pointer;font-size:12px;">Bookmarks</button>' +
                '<button type="button" data-tab="presentations" style="flex:1;padding:8px;background:transparent;color:inherit;border:none;cursor:pointer;font-size:12px;">Tours</button>' +
                '</div>' +
                '<div id="collabBody" style="padding:12px 14px;overflow-y:auto;flex:1;"></div>';

            document.body.appendChild(modal);

            modal.querySelector('#collabCloseBtn')?.addEventListener('click', () => this.hide());
            modal.querySelector('#collabExportBtn')?.addEventListener('click', () => this.exportPackage());
            const fileInput = modal.querySelector('#collabImportFile');
            modal.querySelector('#collabImportBtn')?.addEventListener('click', () => fileInput?.click());
            fileInput?.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    const counts = this.importPackage(text, { merge: true });
                    root.notification?.success?.(
                        `Imported (${counts.annotations} notes, ${counts.bookmarks} bookmarks, ${counts.presentations} tours)`
                    );
                } catch (err) {
                    root.notification?.error?.(`Import failed: ${err.message}`);
                } finally {
                    fileInput.value = '';
                }
            });

            modal.querySelectorAll('#collabTabBar button[data-tab]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this.activeTab = btn.dataset.tab;
                    this._renderBody();
                });
            });

            this._modal = modal;
        }

        _renderBody() {
            if (!this._modal || !this.isVisible) return;
            this._modal.querySelectorAll('#collabTabBar button[data-tab]').forEach((btn) => {
                const active = btn.dataset.tab === this.activeTab;
                btn.style.borderBottom = active ? '2px solid #38bdf8' : '2px solid transparent';
                btn.style.fontWeight = active ? '600' : '400';
            });

            const body = this._modal.querySelector('#collabBody');
            if (!body) return;

            if (this.activeTab === 'annotations') {
                body.innerHTML =
                    '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">' +
                    '<input id="collabAnnTitle" type="text" placeholder="Annotation title" style="padding:6px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.3);background:rgba(15,23,42,0.7);color:inherit;" />' +
                    '<textarea id="collabAnnText" rows="2" placeholder="Comment or observation…" style="padding:6px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.3);background:rgba(15,23,42,0.7);color:inherit;resize:vertical;"></textarea>' +
                    '<div style="display:flex;gap:6px;">' +
                    '<select id="collabAnnCat" style="padding:5px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.3);background:rgba(15,23,42,0.9);color:inherit;">' +
                    '<option value="note">Note</option><option value="issue">Issue</option><option value="review">Review</option><option value="approved">Approved</option></select>' +
                    '<button type="button" id="collabAddHereBtn" style="flex:1;padding:6px;border-radius:6px;border:none;background:#2563eb;color:#fff;cursor:pointer;font-size:12px;">Add at View</button>' +
                    '<button type="button" id="collabPickPtBtn" style="flex:1;padding:6px;border-radius:6px;border:none;background:rgba(56,189,248,0.22);color:inherit;cursor:pointer;font-size:12px;">Pick Point</button>' +
                    '</div></div>' +
                    (this.annotations.length === 0
                        ? '<p style="opacity:0.7;font-size:12px;margin:8px 0;">No annotations yet. Add one at the current view or pick a 3D point.</p>'
                        : this.annotations
                              .map(
                                  (a) =>
                                      `<div style="padding:8px;border-radius:8px;background:rgba(30,41,59,0.65);margin-bottom:6px;border-left:3px solid ${
                                          CATEGORY_COLORS[a.category] || '#38bdf8'
                                      };">` +
                                      `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">` +
                                      `<strong style="font-size:12.5px;">${escapeHtml(a.title)}</strong>` +
                                      `<div style="display:flex;gap:4px;">` +
                                      `<button type="button" data-fly-ann="${escapeHtml(a.id)}" style="background:rgba(59,130,246,0.22);color:inherit;border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px;">Go</button>` +
                                      `<button type="button" data-del-ann="${escapeHtml(a.id)}" style="background:rgba(239,68,68,0.22);color:inherit;border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px;">×</button>` +
                                      `</div></div>` +
                                      (a.text ? `<div style="opacity:0.85;font-size:12px;margin-top:3px;">${escapeHtml(a.text)}</div>` : '') +
                                      `<div style="opacity:0.6;font-size:11px;margin-top:4px;">${escapeHtml(a.lat.toFixed(5))}, ${escapeHtml(a.lon.toFixed(5))} · ${escapeHtml(a.category)}</div>` +
                                      `</div>`
                              )
                              .join(''));

                const readForm = () => ({
                    title: body.querySelector('#collabAnnTitle')?.value?.trim() || 'Scene Note',
                    text: body.querySelector('#collabAnnText')?.value?.trim() || '',
                    category: body.querySelector('#collabAnnCat')?.value || 'note',
                });
                body.querySelector('#collabAddHereBtn')?.addEventListener('click', () => {
                    this.addAnnotation(readForm());
                    root.notification?.success?.('Annotation added');
                });
                body.querySelector('#collabPickPtBtn')?.addEventListener('click', () => {
                    const form = readForm();
                    this.startInteractivePlacement((pt) => {
                        this.addAnnotation({ ...form, ...pt });
                        root.notification?.success?.('Annotation pinned to scene');
                    });
                });
                body.querySelectorAll('[data-fly-ann]').forEach((b) =>
                    b.addEventListener('click', () => this.flyToAnnotation(b.dataset.flyAnn))
                );
                body.querySelectorAll('[data-del-ann]').forEach((b) =>
                    b.addEventListener('click', () => this.deleteAnnotation(b.dataset.delAnn))
                );
                return;
            }

            if (this.activeTab === 'bookmarks') {
                body.innerHTML =
                    '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
                    '<input id="collabBmName" type="text" placeholder="Bookmark title" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.3);background:rgba(15,23,42,0.7);color:inherit;" />' +
                    '<button type="button" id="collabSaveBmBtn" style="padding:6px 10px;border-radius:6px;border:none;background:#2563eb;color:#fff;cursor:pointer;font-size:12px;">Save</button>' +
                    '<button type="button" id="collabSyncBmBtn" title="Import personal bookmarks" style="padding:6px 8px;border-radius:6px;border:none;background:rgba(148,163,184,0.2);color:inherit;cursor:pointer;font-size:12px;">Sync</button>' +
                    '</div>' +
                    (this.sharedBookmarks.length === 0
                        ? '<p style="opacity:0.7;font-size:12px;">No shared bookmarks yet.</p>'
                        : this.sharedBookmarks
                              .map(
                                  (bm) =>
                                      `<div style="padding:8px;border-radius:8px;background:rgba(30,41,59,0.65);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:6px;">` +
                                      `<div><strong style="font-size:12.5px;">${escapeHtml(bm.name)}</strong>` +
                                      `<div style="opacity:0.65;font-size:11px;">${escapeHtml(Number(bm.camera?.lat || 0).toFixed(4))}, ${escapeHtml(Number(bm.camera?.lon || 0).toFixed(4))}</div></div>` +
                                      `<div style="display:flex;gap:4px;">` +
                                      `<button type="button" data-fly-bm="${escapeHtml(bm.id)}" style="background:rgba(59,130,246,0.22);color:inherit;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:11px;">Fly</button>` +
                                      `<button type="button" data-copy-bm="${escapeHtml(bm.id)}" style="background:rgba(148,163,184,0.22);color:inherit;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:11px;">Link</button>` +
                                      `<button type="button" data-del-bm="${escapeHtml(bm.id)}" style="background:rgba(239,68,68,0.22);color:inherit;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:11px;">×</button>` +
                                      `</div></div>`
                              )
                              .join(''));

                body.querySelector('#collabSaveBmBtn')?.addEventListener('click', () => {
                    try {
                        const name = body.querySelector('#collabBmName')?.value?.trim();
                        this.shareCurrentView(name);
                        root.notification?.success?.('Shared bookmark saved');
                    } catch (err) {
                        root.notification?.warning?.(err.message);
                    }
                });
                body.querySelector('#collabSyncBmBtn')?.addEventListener('click', () => {
                    const count = this.importFromBookmarkManager();
                    root.notification?.info?.(`Imported ${count} bookmark(s)`);
                });
                body.querySelectorAll('[data-fly-bm]').forEach((b) =>
                    b.addEventListener('click', () => {
                        const bm = this.sharedBookmarks.find((x) => x.id === b.dataset.flyBm);
                        if (bm) this._flyToState(bm.camera);
                    })
                );
                body.querySelectorAll('[data-copy-bm]').forEach((b) =>
                    b.addEventListener('click', async () => {
                        const bm = this.sharedBookmarks.find((x) => x.id === b.dataset.copyBm);
                        if (!bm) return;
                        const url = bm.shareUrl || this._buildShareUrl(bm.camera, bm.name);
                        try {
                            await navigator.clipboard?.writeText?.(url);
                            root.notification?.success?.('Bookmark link copied to clipboard');
                        } catch (_) {
                            root.notification?.info?.(url);
                        }
                    })
                );
                body.querySelectorAll('[data-del-bm]').forEach((b) =>
                    b.addEventListener('click', () => this.deleteSharedBookmark(b.dataset.delBm))
                );
                return;
            }

            // Presentations tab
            body.innerHTML =
                '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
                '<input id="collabPresTitle" type="text" placeholder="New presentation title" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.3);background:rgba(15,23,42,0.7);color:inherit;" />' +
                '<button type="button" id="collabCreatePresBtn" style="padding:6px 10px;border-radius:6px;border:none;background:#2563eb;color:#fff;cursor:pointer;font-size:12px;">Create</button>' +
                '</div>' +
                (this.presentations.length === 0
                    ? '<p style="opacity:0.7;font-size:12px;">Create a guided camera tour to present viewpoints sequentially.</p>'
                    : this.presentations
                          .map(
                              (p) =>
                                  `<div style="padding:8px;border-radius:8px;background:rgba(30,41,59,0.65);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:6px;">` +
                                  `<div><strong style="font-size:12.5px;">${escapeHtml(p.title)}</strong>` +
                                  `<div style="opacity:0.65;font-size:11px;">${p.slides.length} slide(s)</div></div>` +
                                  `<div style="display:flex;gap:4px;">` +
                                  `<button type="button" data-slide-pres="${escapeHtml(p.id)}" style="background:rgba(148,163,184,0.22);color:inherit;border:none;border-radius:4px;padding:3px 6px;cursor:pointer;font-size:11px;">+Slide</button>` +
                                  `<button type="button" data-play-pres="${escapeHtml(p.id)}" style="background:rgba(34,197,94,0.25);color:inherit;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:11px;">Play</button>` +
                                  `<button type="button" data-del-pres="${escapeHtml(p.id)}" style="background:rgba(239,68,68,0.22);color:inherit;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:11px;">×</button>` +
                                  `</div></div>`
                          )
                          .join(''));

            body.querySelector('#collabCreatePresBtn')?.addEventListener('click', () => {
                const title = body.querySelector('#collabPresTitle')?.value?.trim() || `Tour ${this.presentations.length + 1}`;
                this.createPresentation(title);
            });
            body.querySelectorAll('[data-slide-pres]').forEach((b) =>
                b.addEventListener('click', () => {
                    try {
                        this.addSlideToPresentation(b.dataset.slidePres);
                        root.notification?.success?.('Captured current view as slide');
                    } catch (err) {
                        root.notification?.warning?.(err.message);
                    }
                })
            );
            body.querySelectorAll('[data-play-pres]').forEach((b) =>
                b.addEventListener('click', () => this.playPresentation(b.dataset.playPres))
            );
            body.querySelectorAll('[data-del-pres]').forEach((b) =>
                b.addEventListener('click', () => this.deletePresentation(b.dataset.delPres))
            );
        }
    }

    const instance = new CollaborationManager();

    if (root && typeof root === 'object') {
        root.CollaborationManager = CollaborationManager;
        root.collaborationManager = instance;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            CollaborationManager,
            collaborationManager: instance,
            STORAGE_KEYS,
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
