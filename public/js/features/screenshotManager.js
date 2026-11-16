/**
 * ScreenshotManager
 * High-resolution screenshot with date stamp (Meridian Design - Pages 20-21)
 * Features: Clean menus, date stamp, high-res capture, download
 */

class ScreenshotManager {
    constructor() {
        this.tilesetViewer = null;
        this.modal = null;
        this.isCapturing = false;
        this.hiddenElements = [];
        this.init();
    }

    /**
     * Initialize screenshot manager
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.createScreenshotModal();
        this.setupEventHandlers();
    }

    /**
     * Create screenshot modal
     */
    createScreenshotModal() {
        // Remove existing if any
        const existing = document.getElementById('screenshotModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'screenshotModal';
        modal.className = 'screenshot-modal';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="screenshot-modal-content">
                <div class="screenshot-modal-header">
                    <h2>Screenshot</h2>
                    <button class="close-btn" id="closeScreenshotBtn">×</button>
                </div>
                <div class="screenshot-modal-body">
                    <div class="screenshot-preview-container">
                        <div class="screenshot-preview" id="screenshotPreview">
                            <div class="screenshot-placeholder">
                                <div class="screenshot-icon">📷</div>
                                <p>Preview will appear here</p>
                            </div>
                        </div>
                    </div>
                    <div class="screenshot-options">
                        <div class="screenshot-option-group">
                            <label class="screenshot-checkbox">
                                <input type="checkbox" id="hideMenusCheckbox" checked>
                                <span>Hide menus and controls</span>
                            </label>
                        </div>
                        <div class="screenshot-option-group">
                            <label class="screenshot-checkbox">
                                <input type="checkbox" id="includeDateStampCheckbox" checked>
                                <span>Include date stamp</span>
                            </label>
                        </div>
                        <div class="screenshot-option-group">
                            <label>Resolution:</label>
                            <select id="screenshotResolution" class="select-input">
                                <option value="1">Standard (1x)</option>
                                <option value="2" selected>High (2x)</option>
                                <option value="4">Ultra High (4x)</option>
                            </select>
                        </div>
                    </div>
                    <div class="screenshot-actions">
                        <button class="btn btn-primary" id="captureScreenshotBtn">
                            <span class="btn-icon">📷</span>
                            Capture Screenshot
                        </button>
                        <button class="btn" id="downloadScreenshotBtn" style="display: none;">
                            <span class="btn-icon">💾</span>
                            Download
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Close button
        document.addEventListener('click', (e) => {
            if (e.target.id === 'closeScreenshotBtn' || (e.target === this.modal)) {
                this.hide();
            }
        });

        // Capture button
        document.getElementById('captureScreenshotBtn')?.addEventListener('click', () => {
            this.captureScreenshot();
        });

        // Download button
        document.getElementById('downloadScreenshotBtn')?.addEventListener('click', () => {
            this.downloadScreenshot();
        });
    }

    /**
     * Show screenshot modal
     */
    show() {
        if (this.modal) {
            this.modal.style.display = 'flex';
        }
    }

    /**
     * Hide screenshot modal
     */
    hide() {
        if (this.modal) {
            this.modal.style.display = 'none';
            // Clear preview
            const preview = document.getElementById('screenshotPreview');
            if (preview) {
                preview.innerHTML = `
                    <div class="screenshot-placeholder">
                        <div class="screenshot-icon">📷</div>
                        <p>Preview will appear here</p>
                    </div>
                `;
            }
            document.getElementById('downloadScreenshotBtn').style.display = 'none';
        }
    }

    /**
     * Toggle screenshot modal
     */
    toggle() {
        if (this.modal && this.modal.style.display === 'none') {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Capture screenshot
     */
    async captureScreenshot() {
        if (this.isCapturing || !this.tilesetViewer || !this.tilesetViewer.viewer) {
            return;
        }

        this.isCapturing = true;
        const captureBtn = document.getElementById('captureScreenshotBtn');
        if (captureBtn) {
            captureBtn.disabled = true;
            captureBtn.innerHTML = '<span class="btn-icon">⏳</span> Capturing...';
        }

        try {
            // Get options
            const hideMenus = document.getElementById('hideMenusCheckbox')?.checked || false;
            const includeDateStamp = document.getElementById('includeDateStampCheckbox')?.checked || false;
            const resolution = parseFloat(document.getElementById('screenshotResolution')?.value || '2');

            // Hide UI elements if requested
            if (hideMenus) {
                this.hideUIElements();
            }

            // Wait a moment for UI to hide
            await new Promise(resolve => setTimeout(resolve, 100));

            // Capture screenshot
            const screenshot = await this.captureCanvas(resolution);

            // Show UI elements again
            if (hideMenus) {
                this.showUIElements();
            }

            // Add date stamp if requested
            let finalScreenshot = screenshot;
            if (includeDateStamp) {
                finalScreenshot = await this.addDateStamp(screenshot);
            }

            // Display preview
            this.displayPreview(finalScreenshot);

            // Store screenshot for download
            this.currentScreenshot = finalScreenshot;

            // Show download button
            document.getElementById('downloadScreenshotBtn').style.display = 'inline-flex';

            if (window.notification) {
                window.notification.success('Screenshot captured successfully');
            }
        } catch (error) {
            console.error('Failed to capture screenshot:', error);
            if (window.notification) {
                window.notification.error('Failed to capture screenshot: ' + error.message);
            }
        } finally {
            this.isCapturing = false;
            if (captureBtn) {
                captureBtn.disabled = false;
                captureBtn.innerHTML = '<span class="btn-icon">📷</span> Capture Screenshot';
            }
        }
    }

    /**
     * Capture canvas at specified resolution
     * Uses Cesium's render method to ensure scene is fully rendered
     */
    async captureCanvas(resolution = 2) {
        const viewer = this.tilesetViewer.viewer;
        const canvas = viewer.scene.canvas;

        // Ensure scene is rendered before capture
        viewer.render();

        // Wait a frame to ensure rendering is complete
        await new Promise(resolve => requestAnimationFrame(resolve));

        // Create offscreen canvas for high-res capture
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = canvas.width * resolution;
        offscreenCanvas.height = canvas.height * resolution;

        const ctx = offscreenCanvas.getContext('2d');

        // Use image smoothing for better quality
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw the canvas scaled up
        ctx.drawImage(canvas, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

        // Convert to blob
        return new Promise((resolve, reject) => {
            offscreenCanvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Failed to create blob'));
                }
            }, 'image/png', 1.0);
        });
    }

    /**
     * Add date stamp to screenshot
     */
    async addDateStamp(imageBlob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');

                // Draw original image
                ctx.drawImage(img, 0, 0);

                // Add date stamp in bottom left
                const date = new Date();
                const dateString = date.toLocaleString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });

                // Style for date stamp
                const fontSize = Math.max(16, img.width / 60);
                ctx.font = `bold ${fontSize}px Arial`;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.lineWidth = Math.max(2, fontSize / 8);

                // Calculate text position (bottom left with padding)
                const padding = fontSize;
                const x = padding;
                const y = img.height - padding;

                // Draw text with stroke for visibility
                ctx.strokeText(dateString, x, y);
                ctx.fillText(dateString, x, y);

                // Convert to blob
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to add date stamp'));
                    }
                }, 'image/png', 1.0);
            };

            img.onerror = reject;
            img.src = URL.createObjectURL(imageBlob);
        });
    }

    /**
     * Display preview
     */
    displayPreview(imageBlob) {
        const preview = document.getElementById('screenshotPreview');
        if (!preview) return;

        const img = document.createElement('img');
        img.src = URL.createObjectURL(imageBlob);
        img.style.maxWidth = '100%';
        img.style.maxHeight = '400px';
        img.style.borderRadius = 'var(--radius-sm)';
        img.style.boxShadow = 'var(--shadow-md)';

        preview.innerHTML = '';
        preview.appendChild(img);
    }

    /**
     * Hide UI elements for clean screenshot
     */
    hideUIElements() {
        this.hiddenElements = [];

        // Elements to hide
        const selectors = [
            '.top-navbar',
            '.left-sidebar:not(.collapsed)',
            '.right-sidebar:not(.collapsed)',
            '.tools-menu-sidebar:not(.collapsed)',
            '.viewer-overlay-controls',
            '.bookmark-gallery',
            '.property-info-panel',
            '.status-bar',
            '.selected-coordinate-overlay',
            '.floating-controls-container'
        ];

        selectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                if (el.style.display !== 'none') {
                    this.hiddenElements.push({
                        element: el,
                        originalDisplay: el.style.display
                    });
                    el.style.display = 'none';
                }
            });
        });
    }

    /**
     * Show UI elements again
     */
    showUIElements() {
        this.hiddenElements.forEach(({ element, originalDisplay }) => {
            element.style.display = originalDisplay || '';
        });
        this.hiddenElements = [];
    }

    /**
     * Download screenshot
     */
    downloadScreenshot() {
        if (!this.currentScreenshot) return;

        const date = new Date();
        const dateString = date.toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `meridian-screenshot-${dateString}.png`;

        const url = URL.createObjectURL(this.currentScreenshot);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        if (window.notification) {
            window.notification.success('Screenshot downloaded');
        }
    }

    /**
     * Quick capture (without modal)
     */
    async quickCapture(options = {}) {
        const {
            hideMenus = true,
            includeDateStamp = true,
            resolution = 2
        } = options;

        if (this.isCapturing || !this.tilesetViewer || !this.tilesetViewer.viewer) {
            return null;
        }

        this.isCapturing = true;

        try {
            if (hideMenus) {
                this.hideUIElements();
            }

            await new Promise(resolve => setTimeout(resolve, 100));

            let screenshot = await this.captureCanvas(resolution);

            if (includeDateStamp) {
                screenshot = await this.addDateStamp(screenshot);
            }

            if (hideMenus) {
                this.showUIElements();
            }

            return screenshot;
        } catch (error) {
            console.error('Quick capture failed:', error);
            if (hideMenus) {
                this.showUIElements();
            }
            return null;
        } finally {
            this.isCapturing = false;
        }
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.screenshotManager = new ScreenshotManager();
}
