/**
 * TileHierarchyLayersOverlay
 * Scene overlay for 3D Tiles hierarchy: sphere / box / region volumes with distinct colors,
 * LOD-depth coloring, leaf-only mode, zoom to final (leaf) tiles, and full-detail loading.
 * Separate from the JSON Tree panel (text) — this is spatial, basic layer visualization.
 */

class TileHierarchyLayersOverlay {
    constructor() {
        this.viewer = null;
        this.entities = [];
        this.enabled = false;
        this.colorBy = 'volumeType';
        this.volumeFilter = 'all';
        this.depthMode = 'all';
        this.maxShapes = 160;
        this._sseBackup = new Map();
        this._fullDetailActive = false;
        this._selectedTilesetId = null;
    }

    attachViewer(viewer) {
        this.viewer = viewer;
    }

    _t(key) {
        if (window.appI18n && typeof window.appI18n.t === 'function') {
            const v = window.appI18n.t(key);
            if (v !== key) return v;
        }
        return key;
    }

    _getVolumeType(tile) {
        try {
            const bv = tile._header && tile._header.boundingVolume;
            if (!bv) return 'sphere';
            if (bv.sphere) return 'sphere';
            if (bv.box) return 'box';
            if (bv.region) return 'region';
        } catch (_) {
            /* ignore */
        }
        return 'sphere';
    }

    _colorForTile(tile, depth, volumeType) {
        if (this.colorBy === 'lodLevel') {
            const hue = (depth * 0.11) % 1.0;
            return Cesium.Color.fromHsl(hue, 0.82, 0.52, 0.38);
        }
        switch (volumeType) {
            case 'box':
                return Cesium.Color.ORANGE.withAlpha(0.38);
            case 'region':
                return Cesium.Color.MEDIUMPURPLE.withAlpha(0.32);
            default:
                return Cesium.Color.CYAN.withAlpha(0.35);
        }
    }

    _passesVolumeFilter(type) {
        if (this.volumeFilter === 'all') return true;
        return type === this.volumeFilter;
    }

    _passesDepthMode(tile, depth) {
        if (this.depthMode === 'leaves') {
            return !tile.children || tile.children.length === 0;
        }
        return true;
    }

    clear() {
        if (!this.viewer || !this.viewer.entities) return;
        this.entities.forEach((e) => {
            try {
                this.viewer.entities.remove(e);
            } catch (_) {
                /* ignore */
            }
        });
        this.entities = [];
        this.viewer.scene.requestRender?.();
    }

    _addSphereEntity(center, radius, color, label) {
        const e = this.viewer.entities.add({
            position: center,
            ellipsoid: {
                radii: new Cesium.Cartesian3(radius, radius, radius),
                material: color,
                outline: true,
                outlineColor: color.withAlpha(0.95),
                outlineWidth: 1
            },
            label: label
                ? {
                      text: label,
                      font: '11px sans-serif',
                      fillColor: Cesium.Color.WHITE,
                      outlineColor: Cesium.Color.BLACK,
                      outlineWidth: 3,
                      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                      pixelOffset: new Cesium.Cartesian2(0, -12),
                      disableDepthTestDistance: Number.POSITIVE_INFINITY
                  }
                : undefined
        });
        this.entities.push(e);
    }

    _addBoxEntity(box12, color) {
        try {
            const b = box12;
            const center = new Cesium.Cartesian3(b[0], b[1], b[2]);
            const hx = new Cesium.Cartesian3(b[3], b[4], b[5]);
            const hy = new Cesium.Cartesian3(b[6], b[7], b[8]);
            const hz = new Cesium.Cartesian3(b[9], b[10], b[11]);
            const lx = Cesium.Cartesian3.magnitude(hx);
            const ly = Cesium.Cartesian3.magnitude(hy);
            const lz = Cesium.Cartesian3.magnitude(hz);
            if (![lx, ly, lz].every((x) => Number.isFinite(x) && x > 0)) {
                return false;
            }
            Cesium.Cartesian3.normalize(hx, hx);
            Cesium.Cartesian3.normalize(hy, hy);
            Cesium.Cartesian3.normalize(hz, hz);
            const rot = Cesium.Matrix3.fromColumns(hx, hy, hz);
            const quat = Cesium.Quaternion.fromRotationMatrix(rot);
            const e = this.viewer.entities.add({
                position: center,
                orientation: quat,
                box: {
                    dimensions: new Cesium.Cartesian3(lx * 2, ly * 2, lz * 2),
                    fill: true,
                    material: color,
                    outline: true,
                    outlineColor: color.withAlpha(0.95)
                }
            });
            this.entities.push(e);
            return true;
        } catch (_) {
            return false;
        }
    }

    _addRegionEntity(region6, color) {
        const r = region6;
        if (!r || r.length < 6) return false;
        const rect = Cesium.Rectangle.fromRadians(r[0], r[1], r[2], r[3]);
        const e = this.viewer.entities.add({
            rectangle: {
                coordinates: rect,
                height: r[4],
                extrudedHeight: r[5],
                material: color,
                outline: true,
                outlineColor: color.withAlpha(0.9)
            }
        });
        this.entities.push(e);
        return true;
    }

    _addFromTile(tile, depth, showLodLabel) {
        const vType = this._getVolumeType(tile);
        if (!this._passesVolumeFilter(vType)) return;
        if (!this._passesDepthMode(tile, depth)) return;

        const color = this._colorForTile(tile, depth, vType);
        const label = showLodLabel ? `L${depth}` : undefined;

        try {
            const header = tile._header && tile._header.boundingVolume;
            if (header && header.sphere && vType === 'sphere') {
                const s = header.sphere;
                const center = new Cesium.Cartesian3(s[0], s[1], s[2]);
                this._addSphereEntity(center, s[3], color, label);
                return;
            }
            if (header && header.box && vType === 'box') {
                if (this._addBoxEntity(header.box, color)) return;
            }
            if (header && header.region && vType === 'region') {
                if (this._addRegionEntity(header.region, color)) return;
            }
        } catch (_) {
            /* fall through */
        }

        const bs = tile.boundingVolume && tile.boundingVolume.boundingSphere;
        if (bs && bs.center && bs.radius > 0) {
            this._addSphereEntity(bs.center, bs.radius, color, label);
        }
    }

    _traverse(tile, depth, showLodLabel) {
        if (this.entities.length >= this.maxShapes) return;

        const hasChildren = tile.children && tile.children.length > 0;

        if (this.depthMode === 'leaves') {
            if (hasChildren) {
                tile.children.forEach((c) => this._traverse(c, depth + 1, showLodLabel));
            } else {
                this._addFromTile(tile, depth, showLodLabel);
            }
            return;
        }

        this._addFromTile(tile, depth, showLodLabel);
        if (hasChildren && this.entities.length < this.maxShapes) {
            tile.children.forEach((c) => this._traverse(c, depth + 1, showLodLabel));
        }
    }

    rebuild() {
        this.clear();
        if (!this.enabled || !this.viewer) return;

        const ts = this._resolveTileset();
        if (!ts || !ts.root) return;

        const showLod = !!document.getElementById('tileHierarchyShowLodLabels')?.checked;
        this._traverse(ts.root, 0, showLod);
        this.viewer.scene.requestRender?.();
    }

    _resolveTileset() {
        const tv = window.tilesetViewer;
        if (!tv || !tv.tilesets || tv.tilesets.size === 0) return null;

        if (this._selectedTilesetId && tv.tilesets.has(this._selectedTilesetId)) {
            return tv.tilesets.get(this._selectedTilesetId).tileset;
        }
        const first = tv.tilesets.values().next().value;
        return first ? first.tileset : null;
    }

    refreshTilesetSelect() {
        const sel = document.getElementById('tileHierarchyTilesetSelect');
        if (!sel) return;

        const tv = window.tilesetViewer;
        const entries = tv && tv.tilesets ? Array.from(tv.tilesets.entries()) : [];

        const prev = this._selectedTilesetId;
        sel.innerHTML = '';
        entries.forEach(([id, data]) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = data.url
                ? String(data.url).split(/[/\\]/).filter(Boolean).pop() || id
                : id;
            sel.appendChild(opt);
        });

        if (prev && entries.some(([id]) => id === prev)) {
            sel.value = prev;
            this._selectedTilesetId = prev;
        } else if (entries.length > 0) {
            sel.value = entries[0][0];
            this._selectedTilesetId = entries[0][0];
        } else {
            this._selectedTilesetId = null;
        }
    }

    collectLeafTiles(tile, out) {
        if (!tile) return;
        if (!tile.children || tile.children.length === 0) {
            out.push(tile);
            return;
        }
        tile.children.forEach((c) => this.collectLeafTiles(c, out));
    }

    async zoomToLeafLayer() {
        const viewer = this.viewer;
        const ts = this._resolveTileset();
        if (!viewer || !ts || !ts.root) {
            window.notification?.warning(this._t('ui.rightSidebar.tileHierarchyNoTileset'));
            return;
        }

        const leaves = [];
        this.collectLeafTiles(ts.root, leaves);
        const spheres = [];
        leaves.forEach((t) => {
            const bs = t.boundingVolume && t.boundingVolume.boundingSphere;
            if (bs && bs.radius > 0) spheres.push(bs);
        });

        if (spheres.length === 0) {
            window.notification?.warning(this._t('ui.rightSidebar.tileHierarchyNoLeaves'));
            return;
        }

        let merged = Cesium.BoundingSphere.clone(spheres[0], new Cesium.BoundingSphere());
        for (let i = 1; i < spheres.length; i++) {
            merged = Cesium.BoundingSphere.union(merged, spheres[i], new Cesium.BoundingSphere());
        }

        const range = Math.max(merged.radius * 2.2, 50);
        await viewer.camera.flyToBoundingSphere(merged, {
            duration: 1.45,
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), range)
        });
        window.app?.setTransientStatus?.(this._t('ui.rightSidebar.tileHierarchyZoomedLeaf'), 2200);
    }

    applyLoadAllLayers() {
        const tv = window.tilesetViewer;
        if (!tv || !tv.tilesets || tv.tilesets.size === 0) {
            window.notification?.warning(this._t('ui.rightSidebar.tileHierarchyNoTileset'));
            return;
        }

        this._sseBackup.clear();
        tv.tilesets.forEach((data, id) => {
            const t = data.tileset;
            if (!t) return;
            this._sseBackup.set(id, {
                maximumScreenSpaceError: t.maximumScreenSpaceError,
                foveatedScreenSpaceError: t.foveatedScreenSpaceError,
                immediatelyLoadDesiredLevelOfDetail: t.immediatelyLoadDesiredLevelOfDetail
            });
            t.maximumScreenSpaceError = 0.02;
            if (t.foveatedScreenSpaceError !== undefined) t.foveatedScreenSpaceError = false;
            if (t.immediatelyLoadDesiredLevelOfDetail !== undefined) {
                t.immediatelyLoadDesiredLevelOfDetail = true;
            }
        });

        this._fullDetailActive = true;
        const btn = document.getElementById('tileHierarchyRestoreLodBtn');
        if (btn) btn.disabled = false;

        tv.viewer?.scene?.requestRender?.();
        window.notification?.info(this._t('ui.rightSidebar.tileHierarchyLoadAllDone'));
    }

    restoreLodSettings() {
        const tv = window.tilesetViewer;
        if (!tv || !tv.tilesets) return;

        tv.tilesets.forEach((data, id) => {
            const prev = this._sseBackup.get(id);
            const t = data.tileset;
            if (!t || !prev) return;
            t.maximumScreenSpaceError = prev.maximumScreenSpaceError;
            if (prev.foveatedScreenSpaceError !== undefined && t.foveatedScreenSpaceError !== undefined) {
                t.foveatedScreenSpaceError = prev.foveatedScreenSpaceError;
            }
            if (
                prev.immediatelyLoadDesiredLevelOfDetail !== undefined &&
                t.immediatelyLoadDesiredLevelOfDetail !== undefined
            ) {
                t.immediatelyLoadDesiredLevelOfDetail = prev.immediatelyLoadDesiredLevelOfDetail;
            }
        });

        this._sseBackup.clear();
        this._fullDetailActive = false;
        const btn = document.getElementById('tileHierarchyRestoreLodBtn');
        if (btn) btn.disabled = true;

        tv.viewer?.scene?.requestRender?.();
        window.notification?.info(this._t('ui.rightSidebar.tileHierarchyRestoredLod'));
    }

    bindUI() {
        if (this._uiBound) return;
        this._uiBound = true;

        const toggle = document.getElementById('tileHierarchyOverlayToggle');
        const colorSel = document.getElementById('tileHierarchyColorBy');
        const volSel = document.getElementById('tileHierarchyVolumeFilter');
        const depthSel = document.getElementById('tileHierarchyDepthMode');
        const maxInput = document.getElementById('tileHierarchyMaxShapes');
        const lodLabels = document.getElementById('tileHierarchyShowLodLabels');
        const tsSel = document.getElementById('tileHierarchyTilesetSelect');
        const refreshBtn = document.getElementById('tileHierarchyRefreshBtn');
        const zoomLeafBtn = document.getElementById('tileHierarchyZoomLeafBtn');
        const loadAllBtn = document.getElementById('tileHierarchyLoadAllBtn');
        const restoreBtn = document.getElementById('tileHierarchyRestoreLodBtn');

        if (toggle) {
            toggle.addEventListener('change', () => {
                this.enabled = toggle.checked;
                if (this.enabled) this.rebuild();
                else this.clear();
            });
        }
        const syncFromDom = () => {
            if (colorSel) this.colorBy = colorSel.value === 'lodLevel' ? 'lodLevel' : 'volumeType';
            if (volSel) this.volumeFilter = volSel.value;
            if (depthSel) this.depthMode = depthSel.value === 'leaves' ? 'leaves' : 'all';
            if (maxInput) {
                const n = parseInt(maxInput.value, 10);
                if (Number.isFinite(n) && n >= 8 && n <= 2000) this.maxShapes = n;
            }
        };

        [colorSel, volSel, depthSel, maxInput, lodLabels].forEach((el) => {
            el?.addEventListener('change', () => {
                syncFromDom();
                if (this.enabled) this.rebuild();
            });
        });

        tsSel?.addEventListener('change', () => {
            this._selectedTilesetId = tsSel.value || null;
            if (this.enabled) this.rebuild();
        });

        refreshBtn?.addEventListener('click', () => {
            syncFromDom();
            if (this.enabled) this.rebuild();
        });

        zoomLeafBtn?.addEventListener('click', () => this.zoomToLeafLayer());
        loadAllBtn?.addEventListener('click', () => this.applyLoadAllLayers());
        restoreBtn?.addEventListener('click', () => this.restoreLodSettings());

        window.addEventListener('tilesetLoaded', () => {
            this.refreshTilesetSelect();
            if (this.enabled) this.rebuild();
        });

        syncFromDom();
        this.refreshTilesetSelect();
    }
}

window.tileHierarchyLayersOverlay = new TileHierarchyLayersOverlay();

(function bootTileHierarchyLayers() {
    const tryAttach = () => {
        if (!window.tileHierarchyLayersOverlay) return;
        if (window.tilesetViewer && window.tilesetViewer.viewer) {
            window.tileHierarchyLayersOverlay.attachViewer(window.tilesetViewer.viewer);
            window.tileHierarchyLayersOverlay.bindUI();
        } else {
            setTimeout(tryAttach, 400);
        }
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryAttach);
    } else {
        tryAttach();
    }
})();
