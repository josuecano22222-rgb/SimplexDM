/**
 * FeatureManager
 * Feature (points, lines, polygons) management
 */

class FeatureManager {
    constructor() {
        this.features = new Map();
        this.tilesetViewer = null;
        this.entities = [];
        this.entityByFeatureId = new Map();
        this.dataSource = null;
        this._storageKey = 'simplex_features_v1';
        /** Prevents nested _rebuildEntities; see _ensureDataSourceBound */
        this._rebuilding = false;
        /** Skip per-row persist/refresh during bulk import (Excel, GeoJSON batch) */
        this._bulkImport = false;
        this.init();
    }

    _afterFeatureMutation() {
        if (this._bulkImport) return;
        this._persistToStorage();
        if (window.featureManagerUI) {
            window.featureManagerUI.refresh();
        }
    }

    /**
     * Initialize with dependencies
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this._loadFromStorage();
        this._ensureDataSourceBound();
    }

    /**
     * Create CustomDataSource and add to viewer without using `dataSources.contains()` —
     * some Cesium/Ion builds recurse in contains() and overflow the stack.
     */
    _attachDataSourceOnly() {
        const viewer = this.tilesetViewer?.viewer;
        if (!viewer || typeof Cesium === 'undefined') return false;

        if (!this.dataSource) {
            this.dataSource = new Cesium.CustomDataSource('SimplexFeatures');
        }

        const coll = viewer.dataSources;
        const n = coll.length;
        for (let i = 0; i < n; i++) {
            if (coll.get(i) === this.dataSource) return true;
        }
        coll.add(this.dataSource);
        return true;
    }

    /**
     * Attach datasource to the current viewer, then rebuild entities from memory/storage.
     * Do not call from addPointToViewer — that path uses _attachDataSourceOnly only.
     */
    _ensureDataSourceBound() {
        const viewer = this.tilesetViewer?.viewer;
        if (!viewer || typeof Cesium === 'undefined') {
            setTimeout(() => this._ensureDataSourceBound(), 250);
            return;
        }
        if (!this._attachDataSourceOnly()) return;
        if (!this._rebuilding) {
            this._rebuildEntities();
        }
    }

    _persistToStorage() {
        try {
            const features = Array.from(this.features.values());
            localStorage.setItem(this._storageKey, JSON.stringify(features));
        } catch (e) {
            // Storage may be unavailable; ignore but keep in-memory state
        }
    }

    _loadFromStorage() {
        try {
            const raw = localStorage.getItem(this._storageKey);
            if (!raw) return;
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return;
            arr.forEach(f => {
                if (f && f.id && f.type) {
                    this.features.set(f.id, f);
                }
            });
        } catch (e) {
            // Ignore corrupted storage
        }
    }

    /** Reload features from localStorage (e.g. after full settings import). */
    reloadFromStorage() {
        this.features.clear();
        this._loadFromStorage();
        this._ensureDataSourceBound();
    }

    _rebuildEntities() {
        if (!this._attachDataSourceOnly() || !this.dataSource) return;

        this._rebuilding = true;
        try {
            this.dataSource.entities.removeAll();
            this.entities = [];
            this.entityByFeatureId.clear();

            for (const feature of this.features.values()) {
                if (feature.type === 'point') this.addPointToViewer(feature);
                else if (feature.type === 'line') this.addLineToViewer(feature);
                else if (feature.type === 'polygon') this.addPolygonToViewer(feature);
            }
        } finally {
            this._rebuilding = false;
        }
    }

    /** On-map name label — use NONE height so labels match geometry (not terrain-only clamp). */
    _labelForName(name) {
        const text = (name || 'Feature').slice(0, 120);
        return {
            text,
            font: '600 11px system-ui, Segoe UI, sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -14),
            heightReference: Cesium.HeightReference.NONE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        };
    }

    /** Compact 2-line label — full precision stays in the sidebar list */
    _pointLabelText(feature) {
        const name = (feature.name || 'Point').slice(0, 48);
        const lat = feature.latitude;
        const lon = feature.longitude;
        const h = feature.height ?? 0;
        return `${name}\n${lat.toFixed(5)}° ${lon.toFixed(5)}° · H ${h.toFixed(1)} m`;
    }

    _pointLabelGraphics(feature) {
        return {
            text: this._pointLabelText(feature),
            font: '600 9px Consolas, "Segoe UI Mono", ui-monospace, monospace',
            fillColor: Cesium.Color.fromCssColorString('#FFFACD'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -12),
            heightReference: Cesium.HeightReference.NONE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            showBackground: true,
            backgroundColor: new Cesium.Color(0.02, 0.06, 0.12, 0.82),
            backgroundPadding: new Cesium.Cartesian2(5, 3)
        };
    }

    _polygonLabelPosition(feature) {
        const coords = feature.coordinates || [];
        if (coords.length === 0) return null;
        const positions = coords.map((c) => Cesium.Cartesian3.fromDegrees(c.longitude, c.latitude, c.height || 0));
        return Cesium.BoundingSphere.fromPoints(positions).center;
    }

    /**
     * Add point feature
     */
    addPoint(name, longitude, latitude, height = 0, properties = {}, id = null) {
        const featureId = id || this.generateId();
        const feature = {
            id: featureId,
            type: 'point',
            name: name,
            longitude: longitude,
            latitude: latitude,
            height: height,
            properties: properties,
            timestamp: Date.now()
        };

        this.features.set(featureId, feature);
        this.addPointToViewer(feature);
        this._afterFeatureMutation();

        return featureId;
    }

    /**
     * Add line feature
     */
    addLine(name, coordinates, properties = {}, id = null) {
        const featureId = id || this.generateId();
        const feature = {
            id: featureId,
            type: 'line',
            name: name,
            coordinates: coordinates,
            properties: properties,
            timestamp: Date.now()
        };

        this.features.set(featureId, feature);
        this.addLineToViewer(feature);
        this._afterFeatureMutation();

        return featureId;
    }

    /**
     * Add polygon feature
     */
    addPolygon(name, coordinates, properties = {}, id = null) {
        const featureId = id || this.generateId();
        const feature = {
            id: featureId,
            type: 'polygon',
            name: name,
            coordinates: coordinates,
            properties: properties,
            timestamp: Date.now()
        };

        this.features.set(featureId, feature);
        this.addPolygonToViewer(feature);
        this._afterFeatureMutation();

        return featureId;
    }

    /**
     * Add point to viewer
     */
    addPointToViewer(feature) {
        this._attachDataSourceOnly();
        if (!this.dataSource) return;

        const entity = this.dataSource.entities.add({
            id: feature.id,
            name: feature.name,
            position: Cesium.Cartesian3.fromDegrees(
                feature.longitude,
                feature.latitude,
                feature.height ?? 0
            ),
            point: {
                pixelSize: 10,
                color: Cesium.Color.fromCssColorString('#FF3355'),
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.NONE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: this._pointLabelGraphics(feature),
            properties: feature.properties
        });

        this.entities.push({ featureId: feature.id, entity: entity });
        this.entityByFeatureId.set(feature.id, entity);
    }

    /**
     * Add line to viewer
     */
    addLineToViewer(feature) {
        this._attachDataSourceOnly();
        if (!this.dataSource) return;

        const positions = feature.coordinates.map(coord => 
            Cesium.Cartesian3.fromDegrees(coord.longitude, coord.latitude, coord.height || 0)
        );
        const c0 = feature.coordinates[0];

        const entity = this.dataSource.entities.add({
            id: feature.id,
            name: feature.name,
            position: Cesium.Cartesian3.fromDegrees(c0.longitude, c0.latitude, c0.height || 0),
            polyline: {
                positions: positions,
                width: 3,
                material: Cesium.Color.CYAN,
                clampToGround: true
            },
            label: this._labelForName(feature.name),
            properties: feature.properties
        });

        this.entities.push({ featureId: feature.id, entity: entity });
        this.entityByFeatureId.set(feature.id, entity);
    }

    /**
     * Add polygon to viewer
     */
    addPolygonToViewer(feature) {
        this._attachDataSourceOnly();
        if (!this.dataSource) return;

        const positions = feature.coordinates.map(coord => 
            Cesium.Cartesian3.fromDegrees(coord.longitude, coord.latitude, coord.height || 0)
        );
        const labelPos = this._polygonLabelPosition(feature);

        const entity = this.dataSource.entities.add({
            id: feature.id,
            name: feature.name,
            position: labelPos || positions[0],
            polygon: {
                hierarchy: positions,
                material: Cesium.Color.CYAN.withAlpha(0.5),
                outline: true,
                outlineColor: Cesium.Color.CYAN
            },
            label: this._labelForName(feature.name),
            properties: feature.properties
        });

        this.entities.push({ featureId: feature.id, entity: entity });
        this.entityByFeatureId.set(feature.id, entity);
    }

    /**
     * Remove feature
     */
    removeFeature(id) {
        const feature = this.features.get(id);
        if (!feature) return false;

        // Remove from viewer
        const entity = this.entityByFeatureId.get(id);
        if (entity && this.dataSource) {
            this.dataSource.entities.remove(entity);
        }
        this.entityByFeatureId.delete(id);
        this.entities = this.entities.filter(e => e.featureId !== id);

        this.features.delete(id);
        this._persistToStorage();
        
        if (window.featureManagerUI) {
            window.featureManagerUI.refresh();
        }

        return true;
    }

    /**
     * Get feature
     */
    getFeature(id) {
        return this.features.get(id);
    }

    /**
     * Get all features
     */
    getAllFeatures() {
        return Array.from(this.features.values());
    }

    /**
     * Clear all features
     */
    clearAll() {
        // Remove all entities from viewer
        if (this.dataSource) {
            this.dataSource.entities.removeAll();
        }

        this.features.clear();
        this.entities = [];
        this.entityByFeatureId.clear();
        this._persistToStorage();
        
        if (window.featureManagerUI) {
            window.featureManagerUI.refresh();
        }
    }

    /**
     * Export features to JSON
     */
    exportToJSON() {
        const features = Array.from(this.features.values());
        return JSON.stringify(features, null, 2);
    }

    /**
     * Import features from JSON
     */
    importFromJSON(jsonString) {
        try {
            const features = JSON.parse(jsonString);
            if (!Array.isArray(features)) {
                throw new Error('Invalid format: expected array');
            }

            features.forEach(feature => {
                switch (feature.type) {
                    case 'point':
                        this.addPoint(
                            feature.name,
                            feature.longitude,
                            feature.latitude,
                            feature.height,
                            feature.properties,
                            feature.id
                        );
                        break;
                    case 'line':
                        this.addLine(feature.name, feature.coordinates, feature.properties, feature.id);
                        break;
                    case 'polygon':
                        this.addPolygon(feature.name, feature.coordinates, feature.properties, feature.id);
                        break;
                }
            });

            this._persistToStorage();
            return features.length;
        } catch (error) {
            throw new Error('Failed to import features: ' + error.message);
        }
    }

    /**
     * Export to CSV
     */
    exportToCSV() {
        const features = Array.from(this.features.values());
        const headers = ['ID', 'Type', 'Name', 'Longitude', 'Latitude', 'Height'];
        const rows = features.map(f => [
            f.id,
            f.type,
            f.name,
            f.longitude || '',
            f.latitude || '',
            f.height || ''
        ]);

        return [headers, ...rows].map(row => row.join(',')).join('\n');
    }

    /**
     * Generate unique ID
     */
    generateId() {
        return `feature_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Find feature by Cesium entity reference
     */
    findFeatureByEntity(entity) {
        if (!entity) return null;
        const featureId = typeof entity.id === 'string' ? entity.id : null;
        if (featureId && this.features.has(featureId)) {
            return this.features.get(featureId);
        }
        // Fallback: match by instance reference
        const entry = this.entities.find(e => e.entity === entity);
        if (entry) return this.features.get(entry.featureId) || null;
        return null;
    }

    /**
     * Update feature geometry and keep stable entity ID
     */
    updateFeatureGeometry(id, geometryUpdate) {
        const feature = this.features.get(id);
        if (!feature) return false;

        if (feature.type === 'point') {
            const { longitude, latitude, height } = geometryUpdate;
            feature.longitude = longitude;
            feature.latitude = latitude;
            feature.height = height ?? feature.height ?? 0;
        } else {
            feature.coordinates = geometryUpdate.coordinates;
        }

        feature.timestamp = Date.now();
        this.features.set(id, feature);

        const entity = this.entityByFeatureId.get(id);
        if (entity) {
            if (feature.type === 'point') {
                entity.position = Cesium.Cartesian3.fromDegrees(feature.longitude, feature.latitude, feature.height || 0);
                if (entity.label) {
                    entity.label.text = this._pointLabelText(feature);
                }
            } else if (feature.type === 'line') {
                const arr = feature.coordinates.map((c) => Cesium.Cartesian3.fromDegrees(c.longitude, c.latitude, c.height || 0));
                entity.polyline.positions = arr;
                if (feature.coordinates[0]) {
                    const c0 = feature.coordinates[0];
                    entity.position = Cesium.Cartesian3.fromDegrees(c0.longitude, c0.latitude, c0.height || 0);
                }
            } else if (feature.type === 'polygon') {
                const arr = feature.coordinates.map((c) => Cesium.Cartesian3.fromDegrees(c.longitude, c.latitude, c.height || 0));
                entity.polygon.hierarchy = arr;
                const lp = this._polygonLabelPosition(feature);
                if (lp) entity.position = lp;
            }
        }

        this._persistToStorage();
        return true;
    }

    /**
     * Update feature attributes/properties and persist
     */
    updateFeatureProperties(id, properties) {
        const feature = this.features.get(id);
        if (!feature) return false;
        feature.properties = properties || {};
        feature.timestamp = Date.now();
        this.features.set(id, feature);

        const entity = this.entityByFeatureId.get(id);
        if (entity) {
            entity.properties = properties || {};
        }
        this._persistToStorage();
        return true;
    }

    /**
     * Rename feature (display name)
     */
    updateFeatureName(id, name) {
        const feature = this.features.get(id);
        if (!feature || typeof name !== 'string') return false;
        const trimmed = name.trim();
        if (!trimmed) return false;
        feature.name = trimmed.slice(0, 200);
        feature.timestamp = Date.now();
        this.features.set(id, feature);
        const entity = this.entityByFeatureId.get(id);
        if (entity) {
            entity.name = feature.name;
            if (entity.label) {
                entity.label.text =
                    feature.type === 'point' ? this._pointLabelText(feature) : feature.name;
            }
        }
        this._persistToStorage();
        if (window.featureManagerUI) window.featureManagerUI.refresh();
        return true;
    }

    /**
     * Export as GeoJSON FeatureCollection (RFC 7946)
     */
    exportToGeoJSON() {
        const features = Array.from(this.features.values());
        const gjFeatures = features.map((f) => this._featureToGeoJSON(f));
        return JSON.stringify({ type: 'FeatureCollection', features: gjFeatures }, null, 2);
    }

    _featureToGeoJSON(f) {
        const props = {
            id: f.id,
            name: f.name,
            featureType: f.type,
            ...(f.properties && typeof f.properties === 'object' ? f.properties : {})
        };
        if (f.type === 'point') {
            return {
                type: 'Feature',
                properties: props,
                geometry: {
                    type: 'Point',
                    coordinates: [f.longitude, f.latitude, f.height || 0]
                }
            };
        }
        if (f.type === 'line') {
            const coords = (f.coordinates || []).map((c) => [c.longitude, c.latitude, c.height || 0]);
            return {
                type: 'Feature',
                properties: props,
                geometry: { type: 'LineString', coordinates: coords }
            };
        }
        if (f.type === 'polygon') {
            let ring = (f.coordinates || []).map((c) => [c.longitude, c.latitude, c.height || 0]);
            if (ring.length >= 3) {
                const a = ring[0];
                const b = ring[ring.length - 1];
                if (a[0] !== b[0] || a[1] !== b[1] || (a[2] || 0) !== (b[2] || 0)) {
                    ring = [...ring, [...a]];
                }
            }
            return {
                type: 'Feature',
                properties: props,
                geometry: { type: 'Polygon', coordinates: [ring] }
            };
        }
        return { type: 'Feature', properties: props, geometry: null };
    }

    _geoJsonProps(props) {
        const rest = { ...(props || {}) };
        delete rest.id;
        delete rest.name;
        delete rest.featureType;
        return rest;
    }

    /**
     * Import GeoJSON (FeatureCollection or single Feature). Returns count added.
     */
    importFromGeoJSON(text) {
        const data = JSON.parse(text);
        let collection = data;
        if (data && data.type === 'Feature' && data.geometry) {
            collection = { type: 'FeatureCollection', features: [data] };
        }
        if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
            throw new Error('Expected GeoJSON FeatureCollection or Feature');
        }
        let n = 0;
        this._bulkImport = true;
        try {
            for (const feat of collection.features) {
                if (!feat || feat.type !== 'Feature' || !feat.geometry) continue;
                const g = feat.geometry;
                const props = feat.properties || {};
                const name = (props.name && String(props.name).trim()) || `Feature ${n + 1}`;
                const id = props.id && typeof props.id === 'string' ? props.id : null;
                const extra = this._geoJsonProps(props);

                if (g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
                    const [lon, lat, h] = g.coordinates;
                    this.addPoint(name, lon, lat, h || 0, extra, id);
                    n++;
                } else if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
                    const coords = g.coordinates.map((c) => ({
                        longitude: c[0],
                        latitude: c[1],
                        height: c[2] || 0
                    }));
                    if (coords.length >= 2) {
                        this.addLine(name, coords, extra, id);
                        n++;
                    }
                } else if (g.type === 'Polygon' && Array.isArray(g.coordinates) && g.coordinates[0]) {
                    let ring = g.coordinates[0].map((c) => ({
                        longitude: c[0],
                        latitude: c[1],
                        height: c[2] || 0
                    }));
                    if (ring.length >= 4) {
                        const f = ring[0];
                        const l = ring[ring.length - 1];
                        if (f.longitude === l.longitude && f.latitude === l.latitude) {
                            ring = ring.slice(0, -1);
                        }
                    }
                    if (ring.length >= 3) {
                        this.addPolygon(name, ring, extra, id);
                        n++;
                    }
                }
            }
        } finally {
            this._bulkImport = false;
            this._persistToStorage();
            if (window.featureManagerUI) window.featureManagerUI.refresh();
        }
        return n;
    }

    /**
     * Rows for Excel export (SheetJS), one row per feature.
     */
    getExcelExportRows() {
        return Array.from(this.features.values()).map((f) => ({
            id: f.id,
            name: f.name,
            type: f.type,
            longitude: f.type === 'point' ? f.longitude : '',
            latitude: f.type === 'point' ? f.latitude : '',
            height: f.type === 'point' ? f.height ?? 0 : '',
            coordinates_json: f.type !== 'point' ? JSON.stringify(f.coordinates || []) : '',
            properties_json: JSON.stringify(f.properties || {})
        }));
    }

    _normalizeExcelRowKeys(row) {
        if (!row || typeof row !== 'object') return null;
        const o = {};
        for (const [k, v] of Object.entries(row)) {
            const key = String(k).trim().toLowerCase().replace(/\s+/g, '_');
            o[key] = v;
        }
        if (o.lon !== undefined && o.longitude === undefined) o.longitude = o.lon;
        if (o.lng !== undefined && o.longitude === undefined) o.longitude = o.lng;
        if (o.lat !== undefined && o.latitude === undefined) o.latitude = o.lat;
        if (o.alt !== undefined && o.height === undefined) o.height = o.alt;
        if (o.z !== undefined && o.height === undefined) o.height = o.z;
        if (o.elevation !== undefined && o.height === undefined) o.height = o.elevation;
        if (o.elev !== undefined && o.height === undefined) o.height = o.elev;
        if (o.coords_json !== undefined && o.coordinates_json === undefined) o.coordinates_json = o.coords_json;
        if (o.coordinates !== undefined && o.coordinates_json === undefined && typeof o.coordinates === 'string') {
            o.coordinates_json = o.coordinates;
        }
        if (o.feature_type !== undefined && o.type === undefined) o.type = o.feature_type;
        return o;
    }

    /** Elevation optional on import; empty or invalid → 0 */
    _parseOptionalHeight(value) {
        if (value === undefined || value === null || value === '') return 0;
        const h = parseFloat(String(value).trim());
        return Number.isFinite(h) ? h : 0;
    }

    /** True when Excel row has no height (column missing or blank). Explicit 0 is not omitted. */
    _isExcelHeightOmitted(value) {
        if (value === undefined || value === null) return true;
        if (typeof value === 'string' && value.trim() === '') return true;
        return false;
    }

    /**
     * Set ellipsoid heights from terrain for points imported without a height column/cell.
     * Matches map-placed points (terrain pick) so lat/lon-only imports sit on the surface.
     */
    async applyTerrainHeightsToImportedPoints(featureIds) {
        if (!Array.isArray(featureIds) || featureIds.length === 0) return;
        const viewer = this.tilesetViewer?.viewer;
        if (!viewer || typeof Cesium === 'undefined') return;
        const tp = viewer.terrainProvider;
        if (!tp) return;

        const cartos = [];
        const idByIndex = [];
        for (const id of featureIds) {
            const f = this.features.get(id);
            if (!f || f.type !== 'point') continue;
            cartos.push(Cesium.Cartographic.fromDegrees(f.longitude, f.latitude));
            idByIndex.push(id);
        }
        if (cartos.length === 0) return;

        try {
            // sampleTerrainMostDetailed needs CesiumTerrainProvider + availability (tiled terrain).
            // EllipsoidTerrainProvider has no availability — use sampleTerrain instead.
            const canSampleMostDetailed =
                tp.availability &&
                typeof tp.availability.computeMaximumLevelAtPosition === 'function';
            let updated;
            if (canSampleMostDetailed) {
                updated = await Cesium.sampleTerrainMostDetailed(tp, cartos);
            } else {
                const level =
                    typeof tp.maximumLevel === 'number' && tp.maximumLevel >= 0
                        ? Math.min(11, tp.maximumLevel)
                        : 11;
                updated = await Cesium.sampleTerrain(tp, level, cartos);
            }
            for (let i = 0; i < updated.length; i++) {
                const id = idByIndex[i];
                const f = this.features.get(id);
                if (!f) continue;
                f.height = updated[i].height;
                this.features.set(id, f);
                const entity = this.entityByFeatureId.get(id);
                if (entity) {
                    entity.position = Cesium.Cartesian3.fromDegrees(
                        f.longitude,
                        f.latitude,
                        f.height ?? 0
                    );
                    if (entity.label) {
                        entity.label.text = this._pointLabelText(f);
                    }
                }
            }
            this._persistToStorage();
            if (window.featureManagerUI) window.featureManagerUI.refresh();
        } catch (e) {
            console.warn('FeatureManager: terrain height sampling failed:', e);
        }
    }

    _parseExcelCoordinatesJson(raw) {
        if (raw == null || raw === '') return [];
        let arr;
        if (typeof raw === 'string') {
            try {
                const j = JSON.parse(raw);
                arr = Array.isArray(j) ? j : [];
            } catch (e) {
                return [];
            }
        } else if (Array.isArray(raw)) {
            arr = raw;
        } else {
            return [];
        }
        return arr
            .map((c) => {
                if (c && typeof c === 'object' && !Array.isArray(c)) {
                    return {
                        longitude: Number(c.longitude ?? c.lon ?? c.lng),
                        latitude: Number(c.latitude ?? c.lat),
                        height: Number(c.height ?? c.h ?? c.z ?? 0) || 0
                    };
                }
                if (Array.isArray(c) && c.length >= 2) {
                    return {
                        longitude: Number(c[0]),
                        latitude: Number(c[1]),
                        height: Number(c[2] ?? 0) || 0
                    };
                }
                return null;
            })
            .filter((c) => c && Number.isFinite(c.longitude) && Number.isFinite(c.latitude));
    }

    /**
     * Import from Excel sheet rows (plain objects from SheetJS sheet_to_json).
     * Columns: name, type, longitude, latitude, height, coordinates_json, properties_json, id (see template).
     */
    importFromExcelRows(rows) {
        if (!Array.isArray(rows)) throw new Error('Expected an array of rows');
        let n = 0;
        const terrainPendingIds = [];
        this._bulkImport = true;
        try {
            for (let i = 0; i < rows.length; i++) {
                const raw = rows[i];
                if (!raw || typeof raw !== 'object') continue;
                const r = this._normalizeExcelRowKeys(raw);
                const name =
                    r.name != null && String(r.name).trim() ? String(r.name).trim() : `Point ${i + 1}`;
                const typeStr = String(r.type || 'point').trim().toLowerCase();
                const id = r.id != null && String(r.id).trim() ? String(r.id).trim() : null;
                let props = {};
                if (r.properties_json != null && String(r.properties_json).trim()) {
                    try {
                        props = JSON.parse(String(r.properties_json));
                    } catch (e) {
                        props = {};
                    }
                }

                if (typeStr === 'point' || typeStr === '') {
                    const lon = parseFloat(r.longitude);
                    const lat = parseFloat(r.latitude);
                    const heightOmitted = this._isExcelHeightOmitted(r.height);
                    const h = heightOmitted ? 0 : this._parseOptionalHeight(r.height);
                    if (Number.isNaN(lon) || Number.isNaN(lat)) continue;
                    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) continue;
                    const fid = this.addPoint(name, lon, lat, h, props, id);
                    if (heightOmitted) terrainPendingIds.push(fid);
                    n++;
                } else if (typeStr === 'line' || typeStr === 'polyline') {
                    const coords = this._parseExcelCoordinatesJson(r.coordinates_json);
                    if (coords.length >= 2) {
                        this.addLine(name, coords, props, id);
                        n++;
                    }
                } else if (typeStr === 'polygon' || typeStr === 'area') {
                    const coords = this._parseExcelCoordinatesJson(r.coordinates_json);
                    if (coords.length >= 3) {
                        this.addPolygon(name, coords, props, id);
                        n++;
                    }
                }
            }
        } finally {
            this._bulkImport = false;
            this._persistToStorage();
            if (window.featureManagerUI) window.featureManagerUI.refresh();
        }
        return { count: n, terrainPendingIds };
    }
}

// Export singleton instance
window.featureManager = new FeatureManager();
