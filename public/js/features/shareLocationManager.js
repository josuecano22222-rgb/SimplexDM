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
        modal.className = 'share-location-modal';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="share-location-content">
                <div class="share-location-header">
                    <h2>Share Location</h2>
                    <button class="close-btn" id="closeShareLocationBtn">×</button>
                </div>
                <div class="share-location-body">
                    <div class="share-icon-container">
                        <div class="share-icon">🔗</div>
                    </div>
                    
                    <div class="share-description">
                        Clicking this button will open the share window:
                    </div>

                    <div class="share-link-container">
                        <button class="share-copy-btn" id="copyShareLinkBtn" title="Copy to Clipboard">
                            <span class="copy-icon">📋</span>
                        </button>
                        <input type="text" 
                               id="shareLinkInput" 
                               class="share-link-input" 
                               readonly
                               value="">
                        <div class="share-link-actions">
                            <button class="share-action-btn" id="shareBrowserBtn" title="Open in Browser">🌐</button>
                            <button class="share-action-btn" id="shareEmailBtn" title="Share via Email">✉️</button>
                        </div>
                    </div>

                    <div class="share-info-section">
                        <p>By copying and sharing this link, the model will open at the exact point and angle where the link was copied. You can also navigate to the point through the different navigation systems.</p>
                        <p class="share-note"><strong>Note:</strong> The URL also allows launching the viewer from external systems, if necessary.</p>
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
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) {
            if (window.notification) {
                window.notification.error(window.appI18n?.nt ? window.appI18n.nt('viewerNotReady') : 'Viewer not ready');
            }
            return;
        }

        const url = this.generateShareUrl();
        const input = document.getElementById('shareLinkInput');
        if (input) {
            input.value = url;
        }

        const modalDiv = document.getElementById('modalDiv');
        const modalMsg = document.getElementById('modalMsg');
        if (modalDiv) {
            if (modalMsg) modalMsg.textContent = url;
            modalDiv.style.display = 'flex';
        } else if (this.shareModal) {
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
