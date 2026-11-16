/**
 * ObliqueViewsManager
 * Multi-angle 3D aerial oblique inspection workstation (North / East / South / West / Nadir).
 *
 * Works 100% offline directly against loaded 3D Tiles and terrain:
 * - Pick any target point on the 3D scene or lock onto the current camera target
 * - Smoothly pivot to North, East, South, West (configurable pitch 15°–85°, default 45°) or Nadir (90°)
 * - Step 90° counter-clockwise / clockwise while maintaining exact target lock and slant range
 * - Capture live 4-quadrant WebGL oblique snapshots and export a labeled high-res PNG contact sheet
 */

class ObliqueViewsManager {
    constructor() {
        this.tilesetViewer = null;
        this.modal = null;
        this.isSelecting = false;
        /** @type {{ lon:number, lat:number, height:number }|null} */
        this.selectedPoint = null;
        this.activeDirection = 'north';
        this.pitchDeg = 45;
        this.rangeMeters = 260;
        this.handler = null;
        this._targetMarker = null;
        /** @type {Record<string, string>} data URLs keyed by north|east|south|west */
        this.snapshots = {};
        this._escHandler = null;
        this.init();
    }

    static get DIRECTIONS() {
        return {
            north: { label: 'North', headingDeg: 0, icon: 'fa-arrow-up' },
            east: { label: 'East', headingDeg: 90, icon: 'fa-arrow-right' },
            south: { label: 'South', headingDeg: 180, icon: 'fa-arrow-down' },
            west: { label: 'West', headingDeg: 270, icon: 'fa-arrow-left' },
            nadir: { label: 'Nadir', headingDeg: 0, pitchDeg: 89.5, icon: 'fa-dot-circle' },
        };
    }

    /**
     * Compute camera offset parameters for a given oblique direction.
     */
    static computeViewSpec(direction, pitchDeg = 45, rangeMeters = 260) {
        const dirs = ObliqueViewsManager.DIRECTIONS;
        const entry = dirs[direction] || dirs.north;
        const effectivePitch =
            direction === 'nadir'
                ? -89.5
                : -Math.max(15, Math.min(85, Math.abs(Number(pitchDeg) || 45)));
        const effectiveRange = Math.max(20, Math.min(10000, Number(rangeMeters) || 260));
        return {
            direction: dirs[direction] ? direction : 'north',
            label: entry.label,
            headingDeg: entry.headingDeg,
            pitchDeg: effectivePitch,
            rangeMeters: effectiveRange,
        };
    }

    init() {
        this.tilesetViewer = typeof window !== 'undefined' ? window.tilesetViewer : null;
        if (typeof document !== 'undefined') {
            this.createObliqueViewsModal();
            this.setupEventHandlers();
        }
    }

    _getViewer() {
        if (!this.tilesetViewer && typeof window !== 'undefined') {
            this.tilesetViewer = window.tilesetViewer;
        }
        return this.tilesetViewer?.viewer || null;
    }

    createObliqueViewsModal() {
        const existing = document.getElementById('obliqueViewsModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'obliqueViewsModal';
        modal.className = 'oblique-views-modal map-tool-panel-overlay';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'obliqueViewsTitle');
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="oblique-views-content sdm-tool-dialog">
                <div class="oblique-views-header sdm-tool-header">
                    <h2 id="obliqueViewsTitle">
                        <i class="fas fa-camera-retro" aria-hidden="true"></i>
                        <span>Oblique Aerial Views</span>
                    </h2>
                    <button type="button" class="close-btn" id="closeObliqueViewsBtn" aria-label="Close oblique views">×</button>
                </div>
                <div class="oblique-views-body sdm-tool-body">
                    <p class="sdm-tool-lead">
                        Inspect any 3D model target from calibrated North, East, South, West, and Nadir survey angles — fully offline.
                    </p>

                    <div class="oblique-target-bar">
                        <button type="button" class="btn btn-primary btn-sm" id="selectPointBtn">
                            <i class="fas fa-crosshairs" aria-hidden="true"></i>
                            <span>Pick Target on Map</span>
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm" id="obliqueUseCenterBtn">
                            <i class="fas fa-bullseye" aria-hidden="true"></i>
                            <span>Use View Center</span>
                        </button>
                    </div>

                    <div class="oblique-coord-pill" id="obliqueTargetReadout" aria-live="polite">
                        <i class="fas fa-map-pin" aria-hidden="true"></i>
                        <span id="obliqueTargetText">No target locked — pick a point or use view center</span>
                    </div>

                    <div class="oblique-compass-strip" role="group" aria-label="Oblique camera directions">
                        <button type="button" class="btn btn-xs oblique-dir-btn active" data-oblique-dir="north" title="View looking North (0°)">
                            <i class="fas fa-arrow-up" aria-hidden="true"></i> North
                        </button>
                        <button type="button" class="btn btn-xs oblique-dir-btn" data-oblique-dir="east" title="View looking East (90°)">
                            <i class="fas fa-arrow-right" aria-hidden="true"></i> East
                        </button>
                        <button type="button" class="btn btn-xs oblique-dir-btn" data-oblique-dir="south" title="View looking South (180°)">
                            <i class="fas fa-arrow-down" aria-hidden="true"></i> South
                        </button>
                        <button type="button" class="btn btn-xs oblique-dir-btn" data-oblique-dir="west" title="View looking West (270°)">
                            <i class="fas fa-arrow-left" aria-hidden="true"></i> West
                        </button>
                        <button type="button" class="btn btn-xs oblique-dir-btn" data-oblique-dir="nadir" title="Vertical nadir view (90°)">
                            <i class="fas fa-dot-circle" aria-hidden="true"></i> Nadir
                        </button>
                        <button type="button" class="btn btn-xs" id="obliqueRotateCcwBtn" title="Rotate 90° counter-clockwise" aria-label="Rotate 90 degrees counter-clockwise">
                            <i class="fas fa-undo" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="btn btn-xs" id="obliqueRotateCwBtn" title="Rotate 90° clockwise" aria-label="Rotate 90 degrees clockwise">
                            <i class="fas fa-redo" aria-hidden="true"></i>
                        </button>
                    </div>

                    <div class="oblique-sliders-grid">
                        <label class="oblique-slider-field" for="obliquePitchSlider">
                            <span>Oblique Angle: <strong id="obliquePitchValue">45°</strong></span>
                            <input type="range" id="obliquePitchSlider" min="15" max="85" step="1" value="45">
                        </label>
                        <label class="oblique-slider-field" for="obliqueRangeSlider">
                            <span>Slant Range: <strong id="obliqueRangeValue">260 m</strong></span>
                            <input type="range" id="obliqueRangeSlider" min="40" max="2500" step="10" value="260">
                        </label>
                    </div>

                    <div class="oblique-sheet-actions">
                        <button type="button" class="btn btn-secondary btn-xs" id="obliqueCaptureAllBtn">
                            <i class="fas fa-th-large" aria-hidden="true"></i>
                            <span>Capture 4-Angle Sheet</span>
                        </button>
                        <button type="button" class="btn btn-secondary btn-xs" id="obliqueExportSheetBtn" disabled>
                            <i class="fas fa-file-download" aria-hidden="true"></i>
                            <span>Export PNG</span>
                        </button>
                    </div>

                    <div class="oblique-views-preview">
                        <div class="preview-grid" id="obliquePreviewGrid">
                            ${['north', 'east', 'south', 'west']
                                .map((dir) => {
                                    const d = ObliqueViewsManager.DIRECTIONS[dir];
                                    return `
                                    <button type="button" class="preview-panel oblique-quad" data-quad-dir="${dir}" title="Fly to ${d.label} oblique (${d.headingDeg}°)">
                                        <span class="oblique-quad-badge">${d.label} · ${d.headingDeg}°</span>
                                        <div class="oblique-quad-media" id="obliqueQuad_${dir}">
                                            <i class="fas ${d.icon}" aria-hidden="true"></i>
                                            <span>Click to aim ${d.label}</span>
                                        </div>
                                    </button>`;
                                })
                                .join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
    }

    setupEventHandlers() {
        if (!this.modal) return;

        this.modal.querySelector('#closeObliqueViewsBtn')?.addEventListener('click', () => this.hide());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.hide();
        });

        this.modal.querySelector('#selectPointBtn')?.addEventListener('click', () => this.startPointSelection());
        this.modal.querySelector('#obliqueUseCenterBtn')?.addEventListener('click', () => {
            const pt = this.lockCurrentViewTarget();
            if (pt) {
                this.flyToOblique(this.activeDirection);
            }
        });

        this.modal.querySelectorAll('[data-oblique-dir]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const dir = btn.getAttribute('data-oblique-dir');
                if (dir) this.flyToOblique(dir);
            });
        });

        this.modal.querySelectorAll('[data-quad-dir]').forEach((quad) => {
            quad.addEventListener('click', () => {
                const dir = quad.getAttribute('data-quad-dir');
                if (dir) this.flyToOblique(dir);
            });
        });

        this.modal.querySelector('#obliqueRotateCwBtn')?.addEventListener('click', () => this.stepCardinal(1));
        this.modal.querySelector('#obliqueRotateCcwBtn')?.addEventListener('click', () => this.stepCardinal(-1));

        const pitchSlider = this.modal.querySelector('#obliquePitchSlider');
        const pitchVal = this.modal.querySelector('#obliquePitchValue');
        pitchSlider?.addEventListener('input', () => {
            this.pitchDeg = Number(pitchSlider.value) || 45;
            if (pitchVal) pitchVal.textContent = `${this.pitchDeg}°`;
            if (this.selectedPoint && this.activeDirection !== 'nadir') {
                this.flyToOblique(this.activeDirection, { duration: 0 });
            }
        });

        const rangeSlider = this.modal.querySelector('#obliqueRangeSlider');
        const rangeVal = this.modal.querySelector('#obliqueRangeValue');
        rangeSlider?.addEventListener('input', () => {
            this.rangeMeters = Number(rangeSlider.value) || 260;
            if (rangeVal) rangeVal.textContent = `${this.rangeMeters} m`;
            if (this.selectedPoint) {
                this.flyToOblique(this.activeDirection, { duration: 0 });
            }
        });

        this.modal.querySelector('#obliqueCaptureAllBtn')?.addEventListener('click', () => {
            void this.captureFourAngleSheet();
        });
        this.modal.querySelector('#obliqueExportSheetBtn')?.addEventListener('click', () => {
            this.exportContactSheetPng();
        });

        this._escHandler = (e) => {
            if (e.key !== 'Escape') return;
            if (this.isSelecting) {
                e.preventDefault();
                this.stopPointSelection();
                this.show();
            } else if (this.modal && this.modal.style.display !== 'none') {
                e.preventDefault();
                this.hide();
            }
        };
        document.addEventListener('keydown', this._escHandler);
    }

    show() {
        if (!this.modal) this.createObliqueViewsModal();
        this.modal.style.display = 'flex';
        if (!this.selectedPoint) {
            this.lockCurrentViewTarget(true);
        }
    }

    hide() {
        this.stopPointSelection();
        this._unlockCameraLookAt();
        this._removeTargetMarker();
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }

    toggle() {
        if (this.modal && this.modal.style.display !== 'none') {
            this.hide();
        } else {
            this.show();
        }
    }

    _unlockCameraLookAt() {
        const viewer = this._getViewer();
        if (viewer?.camera && typeof Cesium !== 'undefined') {
            try {
                viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
            } catch (_) {
                /* ignore */
            }
        }
    }

    _removeTargetMarker() {
        const viewer = this._getViewer();
        if (this._targetMarker && viewer?.entities) {
            try {
                viewer.entities.remove(this._targetMarker);
            } catch (_) {
                /* ignore */
            }
        }
        this._targetMarker = null;
    }

    setTargetPoint(lon, lat, height = 0) {
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
        const h = Number.isFinite(height) ? height : 0;
        this.selectedPoint = { lon, lat, height: h };

        const label = document.getElementById('obliqueTargetText');
        if (label) {
            label.textContent = `${lat.toFixed(6)}°, ${lon.toFixed(6)}° · Elev ${h.toFixed(1)} m`;
        }

        const viewer = this._getViewer();
        if (viewer?.entities && typeof Cesium !== 'undefined') {
            this._removeTargetMarker();
            this._targetMarker = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(lon, lat, h),
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.fromCssColorString('#00b9ff'),
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            });
            viewer.scene?.requestRender?.();
        }
        return this.selectedPoint;
    }

    /**
     * Lock target onto the active tileset center or current screen-center ground intersection.
     */
    lockCurrentViewTarget(silent = false) {
        const viewer = this._getViewer();
        if (!viewer || typeof Cesium === 'undefined') {
            if (!silent) window.notification?.warning?.('3D viewer is not ready yet');
            return null;
        }

        const canvas = viewer.scene.canvas;
        const centerPx = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
        let cartesian = null;
        if (viewer.scene.pickPositionSupported) {
            try {
                cartesian = viewer.scene.pickPosition(centerPx);
            } catch (_) {
                cartesian = null;
            }
        }
        if (!cartesian) {
            cartesian = viewer.camera.pickEllipsoid(centerPx, viewer.scene.globe.ellipsoid);
        }
        if (!cartesian) {
            const all = this.tilesetViewer?.getAllTilesets?.() || [];
            if (all[0]?.tileset?.boundingSphere?.center) {
                cartesian = all[0].tileset.boundingSphere.center;
            }
        }
        if (!cartesian) {
            const c = viewer.camera.positionCartographic;
            if (c) {
                return this.setTargetPoint(
                    Cesium.Math.toDegrees(c.longitude),
                    Cesium.Math.toDegrees(c.latitude),
                    0
                );
            }
            return null;
        }

        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        return this.setTargetPoint(
            Cesium.Math.toDegrees(carto.longitude),
            Cesium.Math.toDegrees(carto.latitude),
            Math.max(-500, carto.height || 0)
        );
    }

    startPointSelection() {
        const viewer = this._getViewer();
        if (!viewer || typeof Cesium === 'undefined') {
            window.notification?.error?.('3D viewer not ready');
            return;
        }
        this.stopPointSelection();
        this.isSelecting = true;
        if (this.modal) this.modal.style.display = 'none';
        viewer.canvas.style.cursor = 'crosshair';
        window.notification?.info?.('Click any building or ground point to inspect oblique angles (Esc to cancel)');

        this.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        this.handler.setInputAction((click) => {
            let cartesian = null;
            if (viewer.scene.pickPositionSupported) {
                try {
                    cartesian = viewer.scene.pickPosition(click.position);
                } catch (_) {
                    cartesian = null;
                }
            }
            if (!cartesian) {
                cartesian = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
            }
            this.stopPointSelection();
            this.show();
            if (cartesian) {
                const carto = Cesium.Cartographic.fromCartesian(cartesian);
                this.setTargetPoint(
                    Cesium.Math.toDegrees(carto.longitude),
                    Cesium.Math.toDegrees(carto.latitude),
                    carto.height || 0
                );
                this.flyToOblique(this.activeDirection);
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }

    stopPointSelection() {
        this.isSelecting = false;
        if (this.handler) {
            try {
                this.handler.destroy();
            } catch (_) {
                /* ignore */
            }
            this.handler = null;
        }
        const viewer = this._getViewer();
        if (viewer?.canvas) {
            viewer.canvas.style.cursor = '';
        }
    }

    stepCardinal(deltaSteps) {
        const ring = ['north', 'east', 'south', 'west'];
        const curIdx = Math.max(0, ring.indexOf(this.activeDirection));
        const next = ring[(curIdx + deltaSteps + ring.length) % ring.length];
        this.flyToOblique(next);
    }

    flyToOblique(direction, opts = {}) {
        const spec = ObliqueViewsManager.computeViewSpec(direction, this.pitchDeg, this.rangeMeters);
        this.activeDirection = spec.direction;

        this.modal?.querySelectorAll('[data-oblique-dir]').forEach((btn) => {
            const active = btn.getAttribute('data-oblique-dir') === spec.direction;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        if (!this.selectedPoint) {
            this.lockCurrentViewTarget(true);
        }
        const viewer = this._getViewer();
        if (!viewer || !this.selectedPoint || typeof Cesium === 'undefined') return false;

        const target = Cesium.Cartesian3.fromDegrees(
            this.selectedPoint.lon,
            this.selectedPoint.lat,
            this.selectedPoint.height || 0
        );
        const offset = new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(spec.headingDeg),
            Cesium.Math.toRadians(spec.pitchDeg),
            spec.rangeMeters
        );

        const duration = opts.duration !== undefined ? opts.duration : 0.75;
        if (duration <= 0) {
            viewer.camera.lookAt(target, offset);
            viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
            viewer.scene?.requestRender?.();
            return true;
        }

        const sphere = new Cesium.BoundingSphere(target, 1.0);
        viewer.camera.flyToBoundingSphere(sphere, {
            offset,
            duration,
            complete: () => {
                this._unlockCameraLookAt();
                viewer.scene?.requestRender?.();
                opts.onComplete?.();
            },
        });
        return true;
    }

    /**
     * Step through North, East, South, West oblique views and render live canvas thumbnails.
     */
    async captureFourAngleSheet() {
        const viewer = this._getViewer();
        if (!viewer || typeof Cesium === 'undefined') {
            window.notification?.warning?.('3D viewer is not ready');
            return false;
        }
        if (!this.selectedPoint && !this.lockCurrentViewTarget()) {
            return false;
        }

        const ring = ['north', 'east', 'south', 'west'];
        const prevDir = this.activeDirection;

        for (const dir of ring) {
            this.flyToOblique(dir, { duration: 0 });
            try {
                viewer.scene.render();
                const dataUrl = viewer.scene.canvas.toDataURL('image/png');
                this.snapshots[dir] = dataUrl;
                const slot = document.getElementById(`obliqueQuad_${dir}`);
                if (slot) {
                    slot.innerHTML = `<img src="${dataUrl}" alt="${dir} oblique view" class="oblique-quad-img">`;
                }
            } catch (_) {
                /* preserveDrawingBuffer fallback */
            }
        }

        this.flyToOblique(prevDir, { duration: 0 });
        const exportBtn = this.modal?.querySelector('#obliqueExportSheetBtn');
        if (exportBtn && Object.keys(this.snapshots).length > 0) {
            exportBtn.disabled = false;
        }
        window.notification?.success?.('Captured North, East, South & West oblique views');
        return true;
    }

    exportContactSheetPng() {
        const ring = ['north', 'east', 'south', 'west'];
        if (!ring.some((d) => this.snapshots[d])) return false;

        const tileW = 640;
        const tileH = 380;
        const headerH = 52;
        const sheet = document.createElement('canvas');
        sheet.width = tileW * 2;
        sheet.height = tileH * 2 + headerH;
        const ctx = sheet.getContext('2d');
        if (!ctx) return false;

        ctx.fillStyle = '#080b14';
        ctx.fillRect(0, 0, sheet.width, sheet.height);

        ctx.fillStyle = '#d4e4f8';
        ctx.font = '600 18px system-ui, sans-serif';
        const pt = this.selectedPoint;
        const coordLabel = pt
            ? `${pt.lat.toFixed(6)}°, ${pt.lon.toFixed(6)}° (${pt.height.toFixed(1)} m) · Pitch ${this.pitchDeg}° · Range ${this.rangeMeters} m`
            : 'Oblique Contact Sheet';
        ctx.fillText(`Meridian Oblique Inspection — ${coordLabel}`, 20, 32);

        let pending = 0;
        const finalize = () => {
            const link = document.createElement('a');
            link.download = `meridian-oblique-${Date.now()}.png`;
            link.href = sheet.toDataURL('image/png');
            link.click();
        };

        ring.forEach((dir, idx) => {
            const url = this.snapshots[dir];
            if (!url) return;
            pending++;
            const img = new Image();
            img.onload = () => {
                const col = idx % 2;
                const row = Math.floor(idx / 2);
                const x = col * tileW;
                const y = headerH + row * tileH;
                ctx.drawImage(img, x + 4, y + 4, tileW - 8, tileH - 8);
                ctx.fillStyle = 'rgba(6, 8, 16, 0.78)';
                ctx.fillRect(x + 14, y + 14, 140, 28);
                ctx.fillStyle = '#00b9ff';
                ctx.font = '600 13px system-ui, sans-serif';
                const d = ObliqueViewsManager.DIRECTIONS[dir];
                ctx.fillText(`${d.label.toUpperCase()} (${d.headingDeg}°)`, x + 24, y + 33);
                pending--;
                if (pending === 0) finalize();
            };
            img.onerror = () => {
                pending--;
                if (pending === 0) finalize();
            };
            img.src = url;
        });

        return true;
    }

    cleanup() {
        this.stopPointSelection();
        this._unlockCameraLookAt();
        this._removeTargetMarker();
        if (this._escHandler && typeof document !== 'undefined') {
            document.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }
    }
}

if (typeof window !== 'undefined') {
    window.ObliqueViewsManager = ObliqueViewsManager;
    window.obliqueViewsManager = new ObliqueViewsManager();
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ObliqueViewsManager };
}
