/**
 * FeatureManagerUI — map-first drawing, GeoJSON I/O, delegated list actions
 */

class FeatureManagerUI {
    constructor() {
        this.featureManager = null;
        this._activeHandler = null;
        this._activeMode = null;
        this._tempEntities = [];
        this._snapPxTolerance = 10;
        this._drawPositions = null;
        this._drawEnterHandler = null;
        this._listBound = false;
        this.init();
    }

    init() {
        this.featureManager = window.featureManager;
        this.setupEventHandlers();
        this._setHint(this._defaultHint());
        this.refresh();
    }

    /** Resolves after FeatureManager constructor completes (avoids undefined during stack errors). */
    _fm() {
        return this.featureManager || window.featureManager;
    }

    _worldToScreen(scene, cartesian) {
        if (typeof window.cesiumWorldToWindowCoordinates === 'function') {
            return window.cesiumWorldToWindowCoordinates(scene, cartesian);
        }
        const ST = Cesium.SceneTransforms;
        if (ST?.worldToWindowCoordinates) return ST.worldToWindowCoordinates(scene, cartesian);
        if (ST?.wgs84ToWindowCoordinates) return ST.wgs84ToWindowCoordinates(scene, cartesian);
        return undefined;
    }

    /** While true, map clicks should not open the feature / tileset action panel */
    isBlockingFeatureSelection() {
        return this._activeHandler != null || this._activeMode != null;
    }

    _setHint(text) {
        const el = document.getElementById('featureManagerHint');
        if (el) el.textContent = text;
    }

    _defaultHint() {
        return 'Place point: click the map, then name it. The marker uses your picked height (visible on buildings/terrain). Coordinates show on the marker and in this list. Cursor position: status bar below.';
    }

    _requestRender() {
        const viewer = window.tilesetViewer?.viewer;
        viewer?.scene?.requestRender?.();
    }

    _cleanupTempEntities() {
        const viewer = window.tilesetViewer?.viewer;
        if (!viewer) return;
        this._tempEntities.forEach((e) => viewer.entities.remove(e));
        this._tempEntities = [];
        this._requestRender();
    }

    deactivateCurrentMode(reasonMessage) {
        const viewer = window.tilesetViewer?.viewer;
        if (this._drawEnterHandler) {
            document.removeEventListener('keydown', this._drawEnterHandler, true);
            this._drawEnterHandler = null;
        }
        if (this._activeHandler) {
            this._activeHandler.destroy();
            this._activeHandler = null;
        }
        this._cleanupTempEntities();
        this._drawPositions = null;
        document.removeEventListener('keydown', this._escKeyHandler, true);
        if (viewer?.canvas) viewer.canvas.style.cursor = 'default';
        this._activeMode = null;
        if (reasonMessage) window.notification?.info(reasonMessage);
    }

    _escKeyHandler = (e) => {
        if (e.key === 'Escape') {
            this.deactivateCurrentMode();
            this._setHint(this._defaultHint());
        }
    };

    _getPickCartesian(screenPosition) {
        const viewer = window.tilesetViewer?.viewer;
        if (!viewer) return null;
        const scene = viewer.scene;

        if (scene.pickPositionSupported) {
            const picked = scene.pick(screenPosition);
            if (Cesium.defined(picked)) {
                const p = scene.pickPosition(screenPosition);
                if (Cesium.defined(p)) return p;
            }
        }

        const ray = viewer.camera.getPickRay(screenPosition);
        if (ray) {
            const globeHit = scene.globe.pick(ray, scene);
            if (Cesium.defined(globeHit)) return globeHit;
        }

        return viewer.camera.pickEllipsoid(screenPosition, scene.globe.ellipsoid) || null;
    }

    _getSnappedCartesian(screenPosition) {
        const viewer = window.tilesetViewer?.viewer;
        if (!viewer) return { cartesian: null, snapped: false };
        const scene = viewer.scene;
        const tolerance = this._snapPxTolerance;

        let best = { dist: Infinity, cartesian: null };
        const features = this._fm()?.getAllFeatures?.() || [];
        for (const f of features) {
            if (f.type === 'point') {
                const p = Cesium.Cartesian3.fromDegrees(f.longitude, f.latitude, f.height || 0);
                const sp = this._worldToScreen(scene, p);
                if (!Cesium.defined(sp)) continue;
                const d = Math.hypot(sp.x - screenPosition.x, sp.y - screenPosition.y);
                if (d < best.dist) best = { dist: d, cartesian: p };
            } else if (Array.isArray(f.coordinates)) {
                for (const c of f.coordinates) {
                    const p = Cesium.Cartesian3.fromDegrees(c.longitude, c.latitude, c.height || 0);
                    const sp = this._worldToScreen(scene, p);
                    if (!Cesium.defined(sp)) continue;
                    const d = Math.hypot(sp.x - screenPosition.x, sp.y - screenPosition.y);
                    if (d < best.dist) best = { dist: d, cartesian: p };
                }
            }
        }

        if (best.cartesian && best.dist <= tolerance) {
            return { cartesian: best.cartesian, snapped: true };
        }

        const cartesian = this._getPickCartesian(screenPosition);
        return { cartesian, snapped: false };
    }

    _escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    setupEventHandlers() {
        document.getElementById('placePointBtn')?.addEventListener('click', () => this.startPlacePointOnMap());
        document.getElementById('drawLineBtn')?.addEventListener('click', () => this.startLineDrawing());
        document.getElementById('drawPolygonBtn')?.addEventListener('click', () => this.startPolygonDrawing());
        document.getElementById('importFeaturesBtn')?.addEventListener('click', () => this.importFeatures());
        document.getElementById('exportFeaturesBtn')?.addEventListener('click', () => this.exportFeatures());
        document.getElementById('importExcelBtn')?.addEventListener('click', () => this.importFeaturesExcel());
        document.getElementById('exportExcelBtn')?.addEventListener('click', () => this.exportFeaturesExcel());
        document.getElementById('clearFeaturesBtn')?.addEventListener('click', () => this.clearAll());

        const list = document.getElementById('featureList');
        if (list && !this._listBound) {
            this._listBound = true;
            list.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-fm-action]');
                if (!btn) return;
                const action = btn.getAttribute('data-fm-action');
                if (!action) return;
                e.preventDefault();
                if (action === 'copy-coords') {
                    const lat = btn.getAttribute('data-lat');
                    const lon = btn.getAttribute('data-lon');
                    const h = btn.getAttribute('data-h') || '0';
                    const line = `${lon}, ${lat}, ${h}`;
                    if (navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(line).then(
                            () => window.notification?.success('Copied: ' + line),
                            () => window.notification?.warning('Could not copy')
                        );
                    }
                    return;
                }
                const id = btn.getAttribute('data-feature-id');
                if (!id) return;
                if (action === 'edit') this.editFeature(id);
                else if (action === 'delete') this.deleteFeature(id);
                else if (action === 'zoom') this.zoomToFeature(id);
            });
        }
    }

    refresh() {
        const fm = this._fm();
        const features = fm ? fm.getAllFeatures() : [];
        const list = document.getElementById('featureList');

        if (list) {
            if (features.length === 0) {
                list.innerHTML = '<div class="feature-card feature-card-empty">No shapes yet. Use Place point or draw a line/area.</div>';
            } else {
                list.innerHTML = features
                    .map((feature) => {
                        const typeLabel = feature.type === 'point' ? 'Point' : feature.type === 'line' ? 'Line' : 'Area';
                        const pillClass = feature.type === 'point' ? 'point' : feature.type === 'line' ? 'line' : 'polygon';
                        let meta = '';
                        let coordBlock = '';
                        if (feature.type === 'point') {
                            const lat = feature.latitude;
                            const lon = feature.longitude;
                            const ht = feature.height ?? 0;
                            meta = `WGS84 · ellipsoid height`;
                            coordBlock = `
                        <div class="feature-card-coords" aria-label="Coordinates">
                            <span class="coord-chip" title="Latitude">Lat <strong>${lat.toFixed(6)}°</strong></span>
                            <span class="coord-chip" title="Longitude">Lon <strong>${lon.toFixed(6)}°</strong></span>
                            <span class="coord-chip" title="Height">H <strong>${ht.toFixed(1)} m</strong></span>
                            <button type="button" class="btn btn-xs coord-copy-btn" data-fm-action="copy-coords" data-lat="${lat}" data-lon="${lon}" data-h="${ht}" title="Copy lon, lat, height">Copy</button>
                        </div>`;
                        } else if (Array.isArray(feature.coordinates)) {
                            meta = `${feature.coordinates.length} vertices`;
                        }
                        const safeName = this._escapeHtml(feature.name);
                        const safeId = this._escapeHtml(feature.id);
                        return `
                <div class="feature-card" data-feature-id="${safeId}">
                    <div class="feature-card-main">
                        <div class="feature-card-title">
                            <span class="feature-type-pill ${pillClass}">${typeLabel}</span>${safeName}
                        </div>
                        <div class="feature-card-meta">${this._escapeHtml(meta)}</div>
                        ${coordBlock}
                    </div>
                    <div class="feature-card-actions">
                        <button type="button" class="btn btn-xs" data-fm-action="zoom" data-feature-id="${safeId}" title="Fly to">View</button>
                        <button type="button" class="btn btn-xs" data-fm-action="edit" data-feature-id="${safeId}">Edit</button>
                        <button type="button" class="btn btn-xs btn-danger" data-fm-action="delete" data-feature-id="${safeId}">Delete</button>
                    </div>
                </div>`;
                    })
                    .join('');
            }
        }

        if (window.app) {
            window.app.updateFeatureCount(features.length);
        }
    }

    /**
     * Click map once → capture position → name (optional manual coordinates)
     */
    startPlacePointOnMap() {
        if (!window.tilesetViewer?.viewer) {
            window.notification?.error('Viewer not available');
            return;
        }

        this.deactivateCurrentMode();
        const viewer = window.tilesetViewer.viewer;
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        this._activeHandler = handler;
        this._activeMode = 'place-point';
        viewer.canvas.style.cursor = 'crosshair';
        this._setHint('Click the map to set the point. Press ESC to cancel.');
        document.addEventListener('keydown', this._escKeyHandler, true);

        const onClick = async (click) => {
            const { cartesian } = this._getSnappedCartesian(click.position);
            if (!cartesian) {
                window.notification?.warning('Could not resolve a position. Try another location.');
                return;
            }
            handler.destroy();
            this._activeHandler = null;
            this._activeMode = null;
            document.removeEventListener('keydown', this._escKeyHandler, true);
            viewer.canvas.style.cursor = 'default';

            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            let lon = Cesium.Math.toDegrees(carto.longitude);
            let lat = Cesium.Math.toDegrees(carto.latitude);
            let height = carto.height;

            await this._promptPointNameModal(lon, lat, height);
            this._setHint(this._defaultHint());
        };

        handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }

    async _promptPointNameModal(lon, lat, height) {
        const body = `
            <div class="form-group">
                <label for="fmPointName">Name</label>
                <input type="text" id="fmPointName" class="text-input" placeholder="Label for this location" maxlength="200" autocomplete="off">
            </div>
            <div class="fm-coord-readout" role="group" aria-label="Captured coordinates">
                <div class="fm-coord-readout-title">Captured position (WGS84)</div>
                <div class="fm-coord-grid">
                    <div><span class="fm-coord-k">Latitude</span><span class="fm-coord-v">${this._escapeHtml(lat.toFixed(6))}°</span></div>
                    <div><span class="fm-coord-k">Longitude</span><span class="fm-coord-v">${this._escapeHtml(lon.toFixed(6))}°</span></div>
                    <div><span class="fm-coord-k">Height</span><span class="fm-coord-v">${this._escapeHtml(height.toFixed(2))} m</span></div>
                </div>
                <p class="fm-coord-note">Shown on the map marker and in the list after save.</p>
            </div>
            <details id="fmManualCoords" style="font-size:calc(12px * var(--ui-fs-mul, 1));">
                <summary style="cursor:pointer;margin-bottom:8px;">Edit coordinates manually</summary>
                <div class="form-group">
                    <label>Longitude</label>
                    <input type="number" id="fmPointLon" class="number-input" step="any" value="${lon}">
                </div>
                <div class="form-group">
                    <label>Latitude</label>
                    <input type="number" id="fmPointLat" class="number-input" step="any" value="${lat}">
                </div>
                <div class="form-group">
                    <label>Height (m)</label>
                    <input type="number" id="fmPointH" class="number-input" step="any" value="${height}">
                </div>
            </details>
        `;

        const result = await window.notification?.modal('Name this point', body, {
            buttons: [
                { label: 'Cancel', action: 'cancel', class: 'btn' },
                { label: 'Save point', action: 'save', class: 'btn-primary' }
            ],
            onMount: () => {
                document.getElementById('fmPointName')?.focus();
            }
        });

        if (result !== 'save') return;

        const nameInput = document.getElementById('fmPointName');
        let name = nameInput?.value?.trim() || '';
        let lonF = lon;
        let latF = lat;
        let hF = height;

        const lonEl = document.getElementById('fmPointLon');
        const latEl = document.getElementById('fmPointLat');
        const hEl = document.getElementById('fmPointH');
        if (lonEl && latEl) {
            const ln = parseFloat(lonEl.value);
            const lt = parseFloat(latEl.value);
            if (!Number.isNaN(ln)) lonF = ln;
            if (!Number.isNaN(lt)) latF = lt;
        }
        if (hEl) {
            const hh = parseFloat(hEl.value);
            if (!Number.isNaN(hh)) hF = hh;
        }

        const errors = [];
        if (!name) errors.push('Name is required');
        if (name.length > 200) errors.push('Name is too long');
        if (Number.isNaN(lonF) || lonF < -180 || lonF > 180) errors.push('Invalid longitude');
        if (Number.isNaN(latF) || latF < -90 || latF > 90) errors.push('Invalid latitude');

        if (errors.length) {
            window.notification?.error(errors.join('; '));
            return;
        }

        const fm = this._fm();
        if (!fm) {
            window.notification?.error('Feature manager is not ready. Try refreshing the page.');
            return;
        }
        fm.addPoint(name, lonF, latF, hF);
        window.notification?.success(
            `Saved “${name}”: ${latF.toFixed(6)}°, ${lonF.toFixed(6)}°, ${hF.toFixed(1)} m`
        );
    }

    async _promptShapeName(defaultBase) {
        const suggest = `${defaultBase} ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
        const body = `
            <div class="form-group">
                <label for="fmShapeName">Name</label>
                <input type="text" id="fmShapeName" class="text-input" maxlength="200" value="${this._escapeHtml(suggest)}">
            </div>
        `;
        const result = await window.notification?.modal(`Name this ${defaultBase.toLowerCase()}`, body, {
            buttons: [
                { label: 'Cancel', action: 'cancel', class: 'btn' },
                { label: 'Save', action: 'save', class: 'btn-primary' }
            ],
            onMount: () => {
                const el = document.getElementById('fmShapeName');
                if (el) {
                    el.focus();
                    el.select();
                }
            }
        });
        if (result !== 'save') return null;
        const v = document.getElementById('fmShapeName')?.value?.trim();
        return v || null;
    }

    startLineDrawing() {
        if (!window.tilesetViewer?.viewer) {
            window.notification?.error('Viewer not available');
            return;
        }
        this.deactivateCurrentMode();
        this._startPolylineLikeDrawing('draw-line', 'Line');
    }

    startPolygonDrawing() {
        if (!window.tilesetViewer?.viewer) {
            window.notification?.error('Viewer not available');
            return;
        }
        this.deactivateCurrentMode();
        this._startPolylineLikeDrawing('draw-polygon', 'Area');
    }

    _startPolylineLikeDrawing(mode, label) {
        const viewer = window.tilesetViewer.viewer;
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        this._activeHandler = handler;
        this._activeMode = mode;
        viewer.canvas.style.cursor = 'crosshair';

        const positions = [];
        this._drawPositions = positions;

        const isLine = mode === 'draw-line';
        this._setHint(
            isLine
                ? `${label}: left-click to add vertices. Right-click or Enter to finish. ESC to cancel.`
                : `${label}: left-click to add vertices. Right-click or Enter to close the ring. ESC to cancel.`
        );

        let activeMouseCartesian = null;

        const dynamicPositions = new Cesium.CallbackProperty(() => {
            const out = positions.map((p) => Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, p.height || 0));
            if (activeMouseCartesian && positions.length > 0) out.push(activeMouseCartesian);
            return out;
        }, false);

        if (isLine) {
            const tempLine = viewer.entities.add({
                polyline: {
                    positions: dynamicPositions,
                    width: 3,
                    material: Cesium.Color.CYAN,
                    clampToGround: true
                }
            });
            this._tempEntities.push(tempLine);
        } else {
            const dynamicHierarchy = new Cesium.CallbackProperty(() => {
                const out = positions.map((p) => Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, p.height || 0));
                if (activeMouseCartesian && positions.length > 0) out.push(activeMouseCartesian);
                return new Cesium.PolygonHierarchy(out);
            }, false);
            const tempPolygon = viewer.entities.add({
                polygon: {
                    hierarchy: dynamicHierarchy,
                    material: Cesium.Color.CYAN.withAlpha(0.25),
                    outline: true,
                    outlineColor: Cesium.Color.CYAN
                }
            });
            this._tempEntities.push(tempPolygon);
        }

        let finishing = false;
        const finish = async () => {
            if (finishing) return;
            finishing = true;
            const pts = this._drawPositions ? [...this._drawPositions] : [];
            this.deactivateCurrentMode(null);
            this._setHint(this._defaultHint());

            const min = isLine ? 2 : 3;
            if (pts.length < min) {
                window.notification?.warning(isLine ? 'A line needs at least two points.' : 'An area needs at least three points.');
                return;
            }

            const name = await this._promptShapeName(isLine ? 'Line' : 'Area');
            if (!name) return;

            const fm = this._fm();
            if (!fm) return;
            if (isLine) {
                fm.addLine(name, pts);
                window.notification?.success(`Line "${name}" added (${pts.length} vertices)`);
            } else {
                fm.addPolygon(name, pts);
                window.notification?.success(`Area "${name}" added (${pts.length} vertices)`);
            }
        };

        const clickHandler = (click) => {
            const { cartesian } = this._getSnappedCartesian(click.position);
            if (cartesian) {
                const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                positions.push({
                    longitude: Cesium.Math.toDegrees(cartographic.longitude),
                    latitude: Cesium.Math.toDegrees(cartographic.latitude),
                    height: cartographic.height
                });
                this._requestRender();
            }
        };

        const rightClickHandler = () => {
            finish();
        };

        const mouseMoveHandler = (movement) => {
            const { cartesian } = this._getSnappedCartesian(movement.endPosition);
            activeMouseCartesian = cartesian;
            this._requestRender();
        };

        this._drawEnterHandler = (e) => {
            if (e.key !== 'Enter' || e.repeat) return;
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            e.preventDefault();
            finish();
        };
        document.addEventListener('keydown', this._drawEnterHandler, true);
        document.addEventListener('keydown', this._escKeyHandler, true);

        handler.setInputAction(clickHandler, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        handler.setInputAction(rightClickHandler, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
        handler.setInputAction(mouseMoveHandler, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        window.notification?.info('Add vertices on the map. Right-click or Enter when done.');
    }

    async importFeatures() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.geojson,.csv,.xlsx,.xls,application/geo+json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const lower = file.name.toLowerCase();
                if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
                    const XLSX = this._ensureXlsx();
                    if (!XLSX || !this._fm()) return;
                    const buf = await file.arrayBuffer();
                    const wb = XLSX.read(buf, { type: 'array' });
                    const names = wb.SheetNames || [];
                    const sheetName = names.includes('Features') ? 'Features' : names[0];
                    if (!sheetName || !wb.Sheets[sheetName]) {
                        throw new Error('Workbook has no readable sheet');
                    }
                    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
                    if (!Array.isArray(rows) || rows.length === 0) {
                        throw new Error('Sheet is empty');
                    }
                    const { count, terrainPendingIds } = this._fm().importFromExcelRows(rows);
                    if (count === 0) {
                        window.notification?.warning('No valid feature rows were imported (check columns and types).');
                    } else {
                        window.notification?.success(`Imported ${count} feature(s) from Excel`);
                        if (terrainPendingIds?.length) {
                            await this._fm().applyTerrainHeightsToImportedPoints(terrainPendingIds);
                        }
                    }
                    return;
                }

                const text = await file.text();
                if (lower.endsWith('.csv')) {
                    const count = this.parseAndImportCSV(text);
                    window.notification?.success(`Imported ${count} row(s) from CSV`);
                    this.refresh();
                    return;
                }
                let count = 0;
                try {
                    const parsed = JSON.parse(text);
                    if (parsed && (parsed.type === 'FeatureCollection' || parsed.type === 'Feature')) {
                        count = this._fm().importFromGeoJSON(text);
                        window.notification?.success(`Imported ${count} feature(s) from GeoJSON`);
                    } else if (Array.isArray(parsed)) {
                        count = this._fm().importFromJSON(text);
                        window.notification?.success(`Imported ${count} feature(s) from JSON`);
                    } else {
                        throw new Error('Unrecognized JSON structure');
                    }
                } catch (err) {
                    window.notification?.error('Could not import file: ' + err.message);
                    return;
                }
                this.refresh();
            } catch (error) {
                window.notification?.error('Failed to import: ' + error.message);
            }
        };
        input.click();
    }

    parseAndImportCSV(csvText) {
        if (!this._fm()) {
            throw new Error('FeatureManager not available');
        }

        const lines = csvText.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
        if (lines.length === 0) {
            throw new Error('CSV file is empty');
        }

        const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
        const nameIndex = header.findIndex((h) => h === 'name' || h === 'title' || h === 'label');
        const typeIndex = header.findIndex((h) => h === 'type' || h === 'feature_type');
        const lonIndex = header.findIndex((h) => h === 'longitude' || h === 'lon' || h === 'lng' || h === 'x');
        const latIndex = header.findIndex((h) => h === 'latitude' || h === 'lat' || h === 'y');
        const heightIndex = header.findIndex((h) => h === 'height' || h === 'altitude' || h === 'alt' || h === 'z' || h === 'elevation' || h === 'elev');

        if (lonIndex === -1 || latIndex === -1) {
            throw new Error('CSV must include longitude (lon/lng) and latitude (lat) columns. Name and height are optional; height defaults to 0.');
        }

        let importedCount = 0;
        const errors = [];

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);

            const minCols = Math.max(lonIndex, latIndex) + 1;
            if (values.length < minCols) {
                errors.push(`Row ${i + 1}: not enough columns`);
                continue;
            }

            const name =
                nameIndex !== -1 && values[nameIndex]?.trim()
                    ? values[nameIndex].trim()
                    : `Point ${i}`;
            const lon = parseFloat(values[lonIndex]);
            const lat = parseFloat(values[latIndex]);
            let height = 0;
            if (heightIndex !== -1 && values[heightIndex] !== undefined && String(values[heightIndex]).trim() !== '') {
                const h = parseFloat(String(values[heightIndex]).trim());
                height = Number.isFinite(h) ? h : 0;
            }

            if (Number.isNaN(lon) || Number.isNaN(lat)) {
                errors.push(`Row ${i + 1}: invalid coordinates`);
                continue;
            }

            if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
                errors.push(`Row ${i + 1}: coordinates out of range`);
                continue;
            }

            try {
                let featureType = 'point';
                if (typeIndex !== -1 && values[typeIndex]) {
                    const typeValue = values[typeIndex].trim().toLowerCase();
                    if (typeValue === 'line' || typeValue === 'polyline') featureType = 'line';
                    else if (typeValue === 'polygon') featureType = 'polygon';
                }

                if (featureType === 'point') {
                    this._fm().addPoint(name, lon, lat, height);
                    importedCount++;
                } else {
                    this._fm().addPoint(name, lon, lat, height);
                    importedCount++;
                    if (errors.length < 5) {
                        errors.push(`Row ${i + 1}: only single-point import is supported from CSV`);
                    }
                }
            } catch (error) {
                errors.push(`Row ${i + 1}: ${error.message}`);
            }
        }

        if (errors.length > 0 && errors.length <= 10) {
            console.warn('CSV import warnings:', errors);
            window.notification?.warning(`Imported ${importedCount} row(s) with warnings (see console).`);
        } else if (errors.length > 10) {
            console.warn('CSV import warnings:', errors.slice(0, 10));
            window.notification?.warning(`Imported ${importedCount} row(s) with many warnings (see console).`);
        }

        return importedCount;
    }

    parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        values.push(current.trim());
        return values;
    }

    exportFeatures() {
        try {
            const json = this._fm().exportToGeoJSON();
            const blob = new Blob([json], { type: 'application/geo+json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'simplex_features.geojson';
            a.click();
            URL.revokeObjectURL(url);
            window.notification?.success('Exported GeoJSON');
        } catch (error) {
            window.notification?.error('Export failed: ' + error.message);
        }
    }

    _ensureXlsx() {
        if (typeof window.XLSX !== 'undefined' && window.XLSX.utils && window.XLSX.writeFile) {
            return window.XLSX;
        }
        window.notification?.error(
            'Excel library failed to load. Ensure lib/xlsx/xlsx.full.min.js is present and reload.'
        );
        return null;
    }

    exportFeaturesExcel() {
        const XLSX = this._ensureXlsx();
        if (!XLSX || !this._fm()) return;
        try {
            const rows = this._fm().getExcelExportRows();
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Features');

            const help = [
                {
                    column: 'id',
                    description: 'Optional. If set, re-import can replace/update by id.'
                },
                {
                    column: 'name',
                    description:
                        'Optional for points. If empty, rows are named Point 1, Point 2, … Omit type column to import points.'
                },
                {
                    column: 'type',
                    description:
                        'point | line | polygon. Leave blank or omit for points. Points need longitude + latitude only; elevation is optional (defaults to 0).'
                },
                {
                    column: 'longitude / latitude / height (or elevation)',
                    description:
                        'WGS84 decimal degrees. Required: longitude and latitude. If height is omitted or blank, it is taken from terrain after import (same idea as clicking the map). If you set height, it is ellipsoid meters (WGS84).'
                },
                {
                    column: 'coordinates_json',
                    description:
                        'Lines/polygons only: JSON array of vertices. Vertex height optional (defaults to 0). Leave empty for points.'
                },
                {
                    column: 'properties_json',
                    description: 'Optional JSON object for custom attributes.'
                }
            ];
            const wsHelp = XLSX.utils.json_to_sheet(help);
            XLSX.utils.book_append_sheet(wb, wsHelp, 'Instructions');

            XLSX.writeFile(wb, 'simplex_features.xlsx');
            window.notification?.success(`Exported ${rows.length} feature(s) to Excel`);
        } catch (error) {
            window.notification?.error('Excel export failed: ' + error.message);
        }
    }

    async importFeaturesExcel() {
        const XLSX = this._ensureXlsx();
        if (!XLSX || !this._fm()) return;

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const buf = await file.arrayBuffer();
                const wb = XLSX.read(buf, { type: 'array' });
                const names = wb.SheetNames || [];
                const sheetName = names.includes('Features') ? 'Features' : names[0];
                if (!sheetName || !wb.Sheets[sheetName]) {
                    throw new Error('Workbook has no readable sheet');
                }
                const sheet = wb.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
                if (!Array.isArray(rows) || rows.length === 0) {
                    throw new Error('Sheet is empty or has no data rows');
                }
                const { count, terrainPendingIds } = this._fm().importFromExcelRows(rows);
                if (count === 0) {
                    window.notification?.warning('No valid feature rows were imported (check columns and types).');
                } else {
                    window.notification?.success(`Imported ${count} feature(s) from Excel`);
                    if (terrainPendingIds?.length) {
                        await this._fm().applyTerrainHeightsToImportedPoints(terrainPendingIds);
                    }
                }
            } catch (err) {
                window.notification?.error('Excel import failed: ' + err.message);
            }
        };
        input.click();
    }

    async clearAll() {
        const confirmed = await window.notification?.confirm('Delete all drawn shapes? This cannot be undone.');
        if (confirmed === 'ok') {
            this._fm().clearAll();
            window.notification?.success('All shapes cleared');
        }
    }

    deleteFeature(id) {
        this._fm().removeFeature(id);
        this.refresh();
    }

    zoomToFeature(id) {
        const feature = this._fm().getFeature(id);
        const viewer = window.tilesetViewer?.viewer;
        if (!feature || !viewer) return;

        if (feature.type === 'point') {
            const h = feature.height || 0;
            const dest = Cesium.Cartesian3.fromDegrees(
                feature.longitude,
                feature.latitude,
                h + 120
            );
            viewer.camera.flyTo({
                destination: dest,
                orientation: {
                    heading: Cesium.Math.toRadians(0),
                    pitch: Cesium.Math.toRadians(-55),
                    roll: 0
                },
                duration: 1.35
            });
            return;
        }

        const coords = feature.coordinates || [];
        if (coords.length === 0) return;
        const positions = coords.map((c) => Cesium.Cartesian3.fromDegrees(c.longitude, c.latitude, c.height || 0));
        const bs = Cesium.BoundingSphere.fromPoints(positions);
        viewer.camera.flyToBoundingSphere(bs, { duration: 1.2 });
    }

    editFeature(id) {
        const feature = this._fm().getFeature(id);
        if (!feature) return;
        this.showEditFeatureDialog(feature);
    }

    async showEditFeatureDialog(feature) {
        const props = feature.properties || {};
        const propsJson = JSON.stringify(props, null, 2);
        const safeName = this._escapeHtml(feature.name);

        const result = await window.notification?.modal(
            `Edit: ${feature.name}`,
            `
                <div class="form-group">
                    <label for="fmEditName">Display name</label>
                    <input type="text" id="fmEditName" class="text-input" maxlength="200" value="${safeName}">
                </div>
                <div class="form-group">
                    <label>Custom attributes (JSON)</label>
                    <textarea id="featurePropsJson" class="text-input" style="width:100%;min-height:100px;font-family:var(--f-data,monospace);font-size:calc(11px * var(--ui-fs-mul, 1));">${this._escapeHtml(propsJson)}</textarea>
                </div>
                ${feature.type === 'point' ? '' : `
                <div class="form-group" style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" class="btn btn-xs" id="startVertexMoveBtn">Move vertex</button>
                    <button type="button" class="btn btn-xs" id="startVertexAddBtn">Add vertex</button>
                    <button type="button" class="btn btn-xs" id="startVertexDeleteBtn">Delete vertex</button>
                </div>`}
                <p style="font-size:calc(11px * var(--ui-fs-mul, 1));color:var(--text-secondary);margin:0;">ESC cancels vertex editing on the map.</p>
            `,
            {
                buttons: [
                    { label: 'Cancel', action: 'cancel', class: 'btn' },
                    { label: 'Save', action: 'save', class: 'btn-primary' }
                ],
                onMount: (modalEl) => {
                    modalEl.querySelector('#startVertexMoveBtn')?.addEventListener('click', () => this.startVertexEdit(feature.id, 'move'));
                    modalEl.querySelector('#startVertexAddBtn')?.addEventListener('click', () => this.startVertexEdit(feature.id, 'add'));
                    modalEl.querySelector('#startVertexDeleteBtn')?.addEventListener('click', () => this.startVertexEdit(feature.id, 'delete'));
                }
            }
        );

        if (result === 'save') {
            const nameVal = document.getElementById('fmEditName')?.value?.trim();
            if (nameVal) {
                this._fm().updateFeatureName(feature.id, nameVal);
            }
            const textarea = document.getElementById('featurePropsJson');
            try {
                const nextProps = textarea?.value ? JSON.parse(textarea.value) : {};
                this._fm().updateFeatureProperties(feature.id, nextProps);
                window.notification?.success('Saved');
                this.refresh();
            } catch (e) {
                window.notification?.error('Invalid JSON in attributes');
            }
        }
    }

    startVertexEdit(featureId, mode) {
        const viewer = window.tilesetViewer?.viewer;
        if (!viewer) {
            window.notification?.error('Viewer not available');
            return;
        }

        this.deactivateCurrentMode();

        const feature = this._fm().getFeature(featureId);
        if (!feature) return;
        if (feature.type === 'point') {
            window.notification?.warning('Vertex editing applies to lines and areas only');
            return;
        }

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        this._activeHandler = handler;
        this._activeMode = 'edit';
        viewer.canvas.style.cursor = 'crosshair';
        document.addEventListener('keydown', this._escKeyHandler, true);

        const coords = Array.isArray(feature.coordinates) ? feature.coordinates.map((c) => ({ ...c })) : [];

        const getNearestVertexIndex = (screenPos) => {
            const scene = viewer.scene;
            let bestIdx = -1;
            let bestDist = Infinity;
            for (let i = 0; i < coords.length; i++) {
                const c = coords[i];
                const p = Cesium.Cartesian3.fromDegrees(c.longitude, c.latitude, c.height || 0);
                const sp = this._worldToScreen(scene, p);
                if (!Cesium.defined(sp)) continue;
                const d = Math.hypot(sp.x - screenPos.x, sp.y - screenPos.y);
                if (d < bestDist) {
                    bestDist = d;
                    bestIdx = i;
                }
            }
            return bestDist <= this._snapPxTolerance ? bestIdx : -1;
        };

        const entity = this._fm().entityByFeatureId?.get?.(featureId);
        let dragging = false;
        let dragIndex = -1;

        const toCartesianArray = () => coords.map((c) => Cesium.Cartesian3.fromDegrees(c.longitude, c.latitude, c.height || 0));

        if (entity) {
            if (feature.type === 'line') {
                entity.polyline.positions = new Cesium.CallbackProperty(() => toCartesianArray(), false);
            } else if (feature.type === 'polygon') {
                entity.polygon.hierarchy = new Cesium.CallbackProperty(() => new Cesium.PolygonHierarchy(toCartesianArray()), false);
            }
        }

        const onLeftDown = (click) => {
            const idx = getNearestVertexIndex(click.position);
            if (mode === 'move') {
                if (idx === -1) return;
                dragging = true;
                dragIndex = idx;
                window.notification?.info('Drag to move; release to apply');
            } else if (mode === 'delete') {
                if (idx === -1) return;
                if (coords.length <= (feature.type === 'line' ? 2 : 3)) {
                    window.notification?.warning('Minimum vertices reached');
                    return;
                }
                coords.splice(idx, 1);
                this._fm().updateFeatureGeometry(featureId, { coordinates: coords });
                this.refresh();
                this._requestRender();
                window.notification?.success('Vertex removed');
                this.deactivateCurrentMode(null);
            } else if (mode === 'add') {
                const { cartesian } = this._getSnappedCartesian(click.position);
                if (!cartesian) return;
                const carto = Cesium.Cartographic.fromCartesian(cartesian);
                const newC = {
                    longitude: Cesium.Math.toDegrees(carto.longitude),
                    latitude: Cesium.Math.toDegrees(carto.latitude),
                    height: carto.height
                };
                const near = getNearestVertexIndex(click.position);
                const insertAt = near === -1 ? coords.length : near + 1;
                coords.splice(insertAt, 0, newC);
                this._fm().updateFeatureGeometry(featureId, { coordinates: coords });
                this.refresh();
                this._requestRender();
                window.notification?.success('Vertex added');
                this.deactivateCurrentMode(null);
            }
        };

        const onMouseMove = (movement) => {
            if (!dragging || dragIndex === -1) return;
            const { cartesian } = this._getSnappedCartesian(movement.endPosition);
            if (!cartesian) return;
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            coords[dragIndex] = {
                longitude: Cesium.Math.toDegrees(carto.longitude),
                latitude: Cesium.Math.toDegrees(carto.latitude),
                height: carto.height
            };
            this._requestRender();
        };

        const onLeftUp = () => {
            if (!dragging) return;
            dragging = false;
            const updated = coords.map((c) => ({ ...c }));
            this._fm().updateFeatureGeometry(featureId, { coordinates: updated });
            this.refresh();
            this._requestRender();
            window.notification?.success('Vertex moved');
            this.deactivateCurrentMode(null);
        };

        handler.setInputAction(onLeftDown, Cesium.ScreenSpaceEventType.LEFT_DOWN);
        handler.setInputAction(onMouseMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        handler.setInputAction(onLeftUp, Cesium.ScreenSpaceEventType.LEFT_UP);
    }
}

window.featureManagerUI = new FeatureManagerUI();
