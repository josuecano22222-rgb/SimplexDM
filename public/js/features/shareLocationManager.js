/**
 * ShareLocationManager
 * Share location with URL generation (Meridian Design - Page 19)
 * Generates URL with position (pos) and orientation (ori) parameters
 */

class ShareLocationManager {
    constructor() {
        this.tilesetViewer = null;
        this.shareModal = null;
        this.baseUrl = window.location.origin + window.location.pathname;
        this._restorePostRenderListener = null;
        this.init();
    }

    /**
     * Initialize share location manager
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.createShareModal();
        this.setupEventHandlers();
        this.checkUrlParameters();
    }

    /**
     * Create share modal
     */
    createShareModal() {
        // Remove existing if any
        const existing = document.getElementById('shareLocationModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'shareLocationModal';
        modal.className = 'share-location-modal map-tool-panel-overlay';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'shareLocationHeading');
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="share-location-content sdm-tool-dialog">
                <div class="share-location-header sdm-tool-header">
                    <h2 id="shareLocationHeading">
                        <i class="fas fa-share-alt" aria-hidden="true"></i>
                        <span>Share Camera Location</span>
                    </h2>
                    <button type="button" class="close-btn" id="closeShareLocationBtn" aria-label="Close Share Location">×</button>
                </div>
                <div class="share-location-body sdm-tool-body">
                    <div class="share-telemetry-card" id="shareTelemetryCard" aria-live="polite">
                        <div class="share-tel-row"><span>WGS84</span><strong id="shareTelWgs84">—</strong></div>
                        <div class="share-tel-row"><span>UTM</span><strong id="shareTelUtm">—</strong></div>
                        <div class="share-tel-row"><span>Camera</span><strong id="shareTelOri">—</strong></div>
                    </div>

                    <div class="share-link-container">
                        <button type="button" class="share-copy-btn" id="copyShareLinkBtn" title="Copy Share Link" aria-label="Copy share link">
                            <i class="fas fa-copy" aria-hidden="true"></i>
                        </button>
                        <input type="text"
                               id="shareLinkInput"
                               class="share-link-input"
                               aria-label="Shareable camera URL"
                               readonly
                               value="">
                        <div class="share-link-actions">
                            <button type="button" class="share-action-btn" id="shareBrowserBtn" title="Open in New Window" aria-label="Open in new window">
                                <i class="fas fa-external-link-alt" aria-hidden="true"></i>
                            </button>
                            <button type="button" class="share-action-btn" id="shareEmailBtn" title="Share via Email" aria-label="Share via email">
                                <i class="fas fa-envelope" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>

                    <div class="share-export-strip">
                        <button type="button" class="btn btn-xs btn-secondary" id="shareCopyGeoJsonBtn">
                            <i class="fas fa-code" aria-hidden="true"></i> Copy GeoJSON
                        </button>
                        <button type="button" class="btn btn-xs btn-secondary" id="shareExportKmlBtn">
                            <i class="fas fa-globe" aria-hidden="true"></i> Export KML
                        </button>
                        <button type="button" class="btn btn-xs btn-secondary" id="shareSaveBookmarkBtn">
                            <i class="fas fa-bookmark" aria-hidden="true"></i> Bookmark View
                        </button>
                    </div>

                    <div class="share-info-section">
                        <p>Opening this link restores the exact 3D camera position, altitude, heading, pitch, and roll for reproducible inspection across workstations.</p>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.shareModal = modal;
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Close button
        document.addEventListener('click', (e) => {
            if (e.target.id === 'closeShareLocationBtn' || (e.target === this.shareModal)) {
                this.hide();
            }
        });

        // Copy to clipboard
        document.getElementById('copyShareLinkBtn')?.addEventListener('click', () => {
            this.copyToClipboard();
        });

        // Share actions (Map button removed for offline mode)
        document.getElementById('shareBrowserBtn')?.addEventListener('click', () => {
            this.shareViaBrowser();
        });

        document.getElementById('shareEmailBtn')?.addEventListener('click', () => {
            this.shareViaEmail();
        });

        document.getElementById('modalCloseBtn')?.addEventListener('click', () => this.hide());
        document.getElementById('shareCopy')?.addEventListener('click', () => this.copyToClipboard());
        document.getElementById('shareOSM')?.addEventListener('click', () => this.openOpenStreetMap());
        document.getElementById('shareCopyGeoJsonBtn')?.addEventListener('click', () => this.copyGeoJson());
        document.getElementById('shareExportKmlBtn')?.addEventListener('click', () => this.exportKml());
        document.getElementById('shareSaveBookmarkBtn')?.addEventListener('click', () => {
            window.bookmarkManager?.addBookmark?.();
            window.notification?.success?.('Saved camera view to Bookmarks');
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const open =
                    (this.shareModal && this.shareModal.style.display !== 'none') ||
                    (document.getElementById('modalDiv')?.style.display === 'flex');
                if (open) this.hide();
            }
        });
    }

    _getCameraSnapshot() {
        if (!this.tilesetViewer && typeof window !== 'undefined') {
            this.tilesetViewer = window.tilesetViewer;
        }
        const camera = this.tilesetViewer?.viewer?.camera;
        if (!camera || typeof Cesium === 'undefined') return null;
        const c = Cesium.Cartographic.fromCartesian(camera.position);
        const lon = Cesium.Math.toDegrees(c.longitude);
        const lat = Cesium.Math.toDegrees(c.latitude);
        const height = c.height || 0;
        const heading = ((Cesium.Math.toDegrees(camera.heading) % 360) + 360) % 360;
        const pitch = Cesium.Math.toDegrees(camera.pitch);
        const roll = Cesium.Math.toDegrees(camera.roll);
        const utm = window.CoordinateManager?.wgs84ToUtm?.(lon, lat) || null;
        return { lon, lat, height, heading, pitch, roll, utm };
    }

    async copyGeoJson() {
        const snap = this._getCameraSnapshot();
        if (!snap) return false;
        const feature = {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [
                    Number(snap.lon.toFixed(7)),
                    Number(snap.lat.toFixed(7)),
                    Number(snap.height.toFixed(2)),
                ],
            },
            properties: {
                heading: Number(snap.heading.toFixed(2)),
                pitch: Number(snap.pitch.toFixed(2)),
                roll: Number(snap.roll.toFixed(2)),
                utm: snap.utm ? snap.utm.formatted : undefined,
                shareUrl: this.generateShareUrl(),
                exportedAt: new Date().toISOString(),
            },
        };
        try {
            await navigator.clipboard?.writeText(JSON.stringify(feature, null, 2));
            window.notification?.success?.('Copied camera GeoJSON to clipboard');
            return true;
        } catch (_) {
            return false;
        }
    }

    exportKml() {
        const snap = this._getCameraSnapshot();
        if (!snap) return false;
        const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Meridian Camera Viewpoint</name>
    <Placemark>
      <name>Viewpoint (${snap.lat.toFixed(5)}, ${snap.lon.toFixed(5)})</name>
      <Camera>
        <longitude>${snap.lon.toFixed(7)}</longitude>
        <latitude>${snap.lat.toFixed(7)}</latitude>
        <altitude>${snap.height.toFixed(2)}</altitude>
        <heading>${snap.heading.toFixed(2)}</heading>
        <tilt>${Math.max(0, Math.min(180, 90 + snap.pitch)).toFixed(2)}</tilt>
        <roll>${snap.roll.toFixed(2)}</roll>
        <altitudeMode>absolute</altitudeMode>
      </Camera>
      <Point>
        <coordinates>${snap.lon.toFixed(7)},${snap.lat.toFixed(7)},${snap.height.toFixed(2)}</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
        const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `meridian-viewpoint-${Date.now()}.kml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        window.notification?.success?.('Exported KML viewpoint');
        return true;
    }

    /**
     * Open OpenStreetMap at current camera position (external site; not affiliated with Meridian).
     */
    openOpenStreetMap() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;
        const camera = this.tilesetViewer.viewer.camera;
        const carto = Cesium.Cartographic.fromCartesian(camera.position);
        const lat = Cesium.Math.toDegrees(carto.latitude);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        const zoom = 17;
        const u = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=${zoom}/${lat}/${lon}`;
        window.open(u, '_blank', 'noopener,noreferrer');
    }

    /**
     * Show share modal and generate URL
     */
    show() {
        if (!this.tilesetViewer && typeof window !== 'undefined') {
            this.tilesetViewer = window.tilesetViewer;
        }
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) {
            window.notification?.error?.(
                window.appI18n?.nt ? window.appI18n.nt('viewerNotReady') : 'Viewer not ready'
            );
            return;
        }

        const url = this.generateShareUrl();
        const input = document.getElementById('shareLinkInput');
        if (input) input.value = url;

        const snap = this._getCameraSnapshot();
        if (snap) {
            const wgs = document.getElementById('shareTelWgs84');
            const utm = document.getElementById('shareTelUtm');
            const ori = document.getElementById('shareTelOri');
            if (wgs) wgs.textContent = `${snap.lat.toFixed(6)}°, ${snap.lon.toFixed(6)}° · ${snap.height.toFixed(1)} m`;
            if (utm) utm.textContent = snap.utm ? `${snap.utm.formatted} (${snap.utm.epsg})` : 'Polar zone';
            if (ori) ori.textContent = `Hdg ${snap.heading.toFixed(1)}° · Pitch ${snap.pitch.toFixed(1)}°`;
        }

        if (this.shareModal) {
            this.shareModal.style.display = 'flex';
        }
    }

    /**
     * Hide share modal
     */
    hide() {
        const modalDiv = document.getElementById('modalDiv');
        if (modalDiv) {
            modalDiv.style.display = 'none';
        }
        if (this.shareModal) {
            this.shareModal.style.display = 'none';
        }
    }

    /**
     * Toggle share modal
     */
    toggle() {
        if (this.shareModal && this.shareModal.style.display === 'none') {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Generate share URL with position and orientation
     */
    generateShareUrl() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) {
            return this.baseUrl;
        }

        const viewer = this.tilesetViewer.viewer;
        const camera = viewer.camera;

        const carto = Cesium.Cartographic.fromCartesian(camera.position);
        const state = {
            v: 1,
            lat: Cesium.Math.toDegrees(carto.latitude),
            lon: Cesium.Math.toDegrees(carto.longitude),
            alt: carto.height,
            heading: Cesium.Math.toDegrees(camera.heading),
            pitch: Cesium.Math.toDegrees(camera.pitch),
            roll: Cesium.Math.toDegrees(camera.roll),
            ts: Date.now()
        };

        const encoded = btoa(JSON.stringify(state));
        const fragment = `#view=${encoded}`;
        return `${this.baseUrl}${fragment}`;
    }

    /**
     * Copy share URL to clipboard
     */
    async copyToClipboard() {
        const input = document.getElementById('shareLinkInput');
        const modalMsg = document.getElementById('modalMsg');
        const url = (input && input.value) || (modalMsg && modalMsg.textContent) || '';
        if (!url) return;

        try {
            await navigator.clipboard.writeText(url);
            window.notification?.success(
                window.appI18n?.nt ? window.appI18n.nt('shareLocationCopied') : 'Location copied to clipboard'
            );
        } catch (error) {
            try {
                const el = document.createElement('textarea');
                el.value = url;
                document.body.appendChild(el);
                el.select();
                document.execCommand('copy');
                document.body.removeChild(el);
                window.notification?.success(
                    window.appI18n?.nt ? window.appI18n.nt('shareLocationCopied') : 'Location copied to clipboard'
                );
            } catch {
                window.notification?.error(
                    window.appI18n?.nt ? window.appI18n.nt('shareCopyFailed') : 'Failed to copy location'
                );
                return;
            }
        }

        // Visual feedback
        const copyBtn = document.getElementById('copyShareLinkBtn');
        if (copyBtn) {
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = '<span class="copy-icon">✓</span>';
            setTimeout(() => {
                copyBtn.innerHTML = originalText;
            }, 2000);
        }
    }

    /**
     * Share via map (disabled in offline mode)
     */
    shareViaMap() {
        if (window.notification) {
            window.notification.info(
                window.appI18n?.nt ? window.appI18n.nt('mapOfflineHint') : 'Map view requires internet connection. This application runs offline.'
            );
        }
    }

    /**
     * Share via browser (open link in new tab)
     */
    shareViaBrowser() {
        const input = document.getElementById('shareLinkInput');
        if (!input) return;

        window.open(input.value, '_blank');
    }

    /**
     * Share via email
     */
    shareViaEmail() {
        const input = document.getElementById('shareLinkInput');
        if (!input) return;

        const subject = encodeURIComponent('Shared Location - SimplexDM');
        const body = encodeURIComponent(`Check out this location:\n\n${input.value}`);
        const mailtoUrl = `mailto:?subject=${subject}&body=${body}`;
        
        window.location.href = mailtoUrl;
    }

    /**
     * Check URL parameters on load and restore camera position
     */
    checkUrlParameters() {
        const hash = window.location.hash || '';
        if (!hash.includes('#view=')) return;

        // Wait for viewer to be ready: bind once to postRender then unbind
        const tryBind = () => {
            const viewer = this.tilesetViewer?.viewer;
            if (!viewer || !viewer.scene) {
                setTimeout(tryBind, 250);
                return;
            }
            if (this._restorePostRenderListener) return;
            this._restorePostRenderListener = () => {
                viewer.scene.postRender.removeEventListener(this._restorePostRenderListener);
                this._restorePostRenderListener = null;
                this.parseAndRestoreLocation(window.location.hash);
            };
            viewer.scene.postRender.addEventListener(this._restorePostRenderListener);
        };
        tryBind();
    }

    /**
     * Restore camera position from URL fragment (#view=...)
     */
    parseAndRestoreLocation(fragment) {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;
        const viewer = this.tilesetViewer.viewer;
        const camera = viewer.camera;

        try {
            const encoded = (fragment || '').replace('#view=', '');
            const state = JSON.parse(atob(encoded));

            if (!state || typeof state.lat !== 'number' || typeof state.lon !== 'number') {
                throw new Error('Invalid state');
            }
            if (state.lat < -90 || state.lat > 90) throw new Error('Invalid lat');
            if (state.lon < -180 || state.lon > 180) throw new Error('Invalid lon');

            camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(state.lon, state.lat, state.alt ?? 1000),
                orientation: {
                    heading: Cesium.Math.toRadians(state.heading ?? 0),
                    pitch: Cesium.Math.toRadians(state.pitch ?? -45),
                    roll: Cesium.Math.toRadians(state.roll ?? 0)
                }
            });
            viewer.scene.requestRender();
            window.notification?.info(
                window.appI18n?.nt ? window.appI18n.nt('shareViewRestored') : 'View restored from shared location'
            );
        } catch (e) {
            window.notification?.error(
                window.appI18n?.nt ? window.appI18n.nt('shareInvalidLink') : 'Invalid or expired location link'
            );
        }
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.shareLocationManager = new ShareLocationManager();
}
