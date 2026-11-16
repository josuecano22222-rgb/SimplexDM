/**
 * NavigationHelpUI
 * Mouse controls help overlay (Meridian Design - Page 8)
 * Shows instructional overlay for navigation controls
 */

class NavigationHelpUI {
    constructor() {
        this.helpModal = null;
        this.isVisible = false;
        this._handlersBound = false;
    }

    /**
     * Initialize navigation help UI
     */
    init() {
        this.createHelpModal();
        this.setupEventHandlers();
        if (!this._localeListenerBound) {
            this._localeListenerBound = true;
            window.addEventListener('simplex:localeChanged', () => {
                const wasVisible = this.isVisible;
                this.createHelpModal();
                if (wasVisible && this.helpModal) {
                    this.helpModal.style.display = 'flex';
                    this.isVisible = true;
                }
            });
        }
    }

    _navHtml() {
        if (window.appI18n && typeof window.appI18n.t === 'function') {
            const v = window.appI18n.t('navHelpHtml');
            if (v && v !== 'navHelpHtml') return v;
        }
        return `
            <div class="navigation-help-content">
                <div class="navigation-help-header">
                    <h2>Navigation in 3D Model and Coordinates</h2>
                    <button class="close-btn" id="closeNavigationHelpBtn">×</button>
                </div>
                <div class="navigation-help-body">
                    <div class="navigation-help-section">
                        <h3>Mouse Controls</h3>
                        <div class="mouse-control-item">
                            <div class="mouse-icon">
                                <div class="mouse-left-click"></div>
                            </div>
                            <div class="mouse-description">
                                <strong>Left drag:</strong> Rotate / orbit the camera (Cesium default controller)
                            </div>
                        </div>
                        <div class="mouse-control-item">
                            <div class="mouse-icon">
                                <div class="mouse-right-click"></div>
                            </div>
                            <div class="mouse-description">
                                <strong>Right drag:</strong> Zoom in and out
                            </div>
                        </div>
                        <div class="mouse-control-item">
                            <div class="mouse-icon">
                                <div class="mouse-scroll-press"></div>
                            </div>
                            <div class="mouse-description">
                                <strong>Middle drag / wheel:</strong> Pan with middle button; scroll wheel zooms toward the cursor
                            </div>
                        </div>
                    </div>
                    <div class="navigation-help-section">
                        <h3>Coordinate Display</h3>
                        <p>In the lower right corner, you can see the exact coordinates where your mouse pointer is located.</p>
                        <p><strong>Right-click</strong> on the map to copy coordinates in ITM (Israel Transverse Mercator) or GEO (Geographic) format.</p>
                    </div>
                    <div class="navigation-help-section">
                        <h3>Fly Around</h3>
                        <div class="fly-around-control">
                            <label class="toggle-switch">
                                <input type="checkbox" id="flyAroundToggle">
                                <span class="toggle-slider"></span>
                            </label>
                            <span>Fly Around</span>
                        </div>
                        <p>When enabled, the camera will continuously orbit around the center of the screen.</p>
                    </div>
                    <div class="navigation-help-section">
                        <h3>Static Coordinates Example</h3>
                        <div class="coordinate-examples">
                            <div class="coordinate-example">
                                <strong>ITM:</strong> 180777.803, 665886.596, 35
                            </div>
                            <div class="coordinate-example">
                                <strong>GEO:</strong> 34.7947367, 32.0856213, 35
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Create help modal overlay
     */
    createHelpModal() {
        const existing = document.getElementById('navigationHelpModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'navigationHelpModal';
        modal.className = 'navigation-help-modal';
        modal.style.display = 'none';

        modal.innerHTML = this._navHtml();

        document.body.appendChild(modal);
        this.helpModal = modal;
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        if (this._handlersBound) {
            return;
        }
        this._handlersBound = true;

        document.addEventListener('click', (e) => {
            if (e.target.id === 'closeNavigationHelpBtn') {
                this.hide();
            }
            if (this.helpModal && e.target === this.helpModal) {
                this.hide();
            }
        });

        document.addEventListener('change', (e) => {
            if (e.target.id === 'flyAroundToggle') {
                if (window.coordinateManager) {
                    const isActive = window.coordinateManager.toggleFlyAround();
                    e.target.checked = isActive;
                }
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) {
                this.hide();
            }
        });
    }

    /**
     * Show navigation help
     */
    show() {
        if (this.helpModal) {
            this.helpModal.style.display = 'flex';
            this.isVisible = true;
        }
    }

    /**
     * Hide navigation help
     */
    hide() {
        if (this.helpModal) {
            this.helpModal.style.display = 'none';
            this.isVisible = false;
        }
    }

    /**
     * Toggle navigation help
     */
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.navigationHelpUI = new NavigationHelpUI();
}
