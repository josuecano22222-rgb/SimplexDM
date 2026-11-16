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
                        <div class="screenshot-option-group">
                            <label>Format:</label>
                            <select id="screenshotFormat" class="select-input">
                                <option value="png" selected>PNG (Lossless)</option>
                                <option value="jpeg">JPEG (Compact)</option>
                                <option value="webp">WebP (Modern)</option>
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
                        <button class="btn" id="exportScreenshotReportBtn" style="display: none;">
                            <span class="btn-icon">📄</span>
                            Export Report
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

        // Export HTML report button
        document.getElementById('exportScreenshotReportBtn')?.addEventListener('click', () => {
            this.exportReport();
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
            const format = String(document.getElementById('screenshotFormat')?.value || 'png').toLowerCase();
            this.currentFormat = ['png', 'jpeg', 'webp'].includes(format) ? format : 'png';

            // Hide UI elements if requested
            if (hideMenus) {
                this.hideUIElements();
            }

            // Wait a moment for UI to hide
            await new Promise(resolve => setTimeout(resolve, 100));

            // Capture screenshot
            const screenshot = await this.captureCanvas(resolution, this.currentFormat);

            // Show UI elements again
            if (hideMenus) {
                this.showUIElements();
            }

            // Add date stamp if requested
            let finalScreenshot = screenshot;
            if (includeDateStamp) {
                finalScreenshot = await this.addDateStamp(screenshot, this.currentFormat);
            }

            // Display preview
            this.displayPreview(finalScreenshot);

            // Store screenshot and metadata for download/report
            this.currentScreenshot = finalScreenshot;
            this.currentMetadata = {
                capturedAt: new Date().toISOString(),
                resolution,
                format: this.currentFormat,
                camera: this.tilesetViewer?.getCameraPosition?.() || null,
                tilesetCount: this.tilesetViewer?.getAllTilesets?.()?.length || 0,
                measurements: window.enhancedMeasurementManager?.getResults?.() || [],
            };

            // Show download and report buttons
            const dlBtn = document.getElementById('downloadScreenshotBtn');
            const rpBtn = document.getElementById('exportScreenshotReportBtn');
            if (dlBtn) dlBtn.style.display = 'inline-flex';
            if (rpBtn) rpBtn.style.display = 'inline-flex';

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
    async captureCanvas(resolution = 2, format = 'png') {
        const viewer = this.tilesetViewer.viewer;
        const canvas = viewer.scene.canvas;
        const fmt = ['png', 'jpeg', 'webp'].includes(String(format).toLowerCase())
            ? String(format).toLowerCase()
            : 'png';
        const mimeType = `image/${fmt}`;
        const quality = fmt === 'png' ? 1.0 : 0.92;

        // Ensure scene is rendered before capture
        viewer.render();

        // Wait a frame to ensure rendering is complete
        await new Promise(resolve => requestAnimationFrame(resolve));

        // Create offscreen canvas for high-res capture
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = Math.max(1, Math.round(canvas.width * resolution));
        offscreenCanvas.height = Math.max(1, Math.round(canvas.height * resolution));

        const ctx = offscreenCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (fmt === 'jpeg') {
            ctx.fillStyle = '#0b1120';
            ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        }
        ctx.drawImage(canvas, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

        return new Promise((resolve, reject) => {
            offscreenCanvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Failed to create blob'));
                }
            }, mimeType, quality);
        });
    }

    /**
     * Add date stamp to screenshot
     */
    async addDateStamp(imageBlob, format = 'png') {
        const fmt = ['png', 'jpeg', 'webp'].includes(String(format).toLowerCase())
            ? String(format).toLowerCase()
            : 'png';
        const mimeType = `image/${fmt}`;
        const quality = fmt === 'png' ? 1.0 : 0.92;
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
                }, mimeType, quality);
            };

            img.onerror = (err) => {
                URL.revokeObjectURL(objUrl);
                reject(err);
            };
            const objUrl = URL.createObjectURL(imageBlob);
            img.addEventListener('load', () => URL.revokeObjectURL(objUrl), { once: true });
            img.src = objUrl;
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

        // Elements to hide (covers both modern dock chrome and legacy classes)
        const selectors = [
            '.top-navbar',
            '.smart3d-top-chrome',
            '.smart3d-tools-dock',
            '.dock-left:not(.collapsed)',
            '.dock-right:not(.collapsed)',
            '.left-sidebar:not(.collapsed)',
            '.right-sidebar:not(.collapsed)',
            '.tools-menu-sidebar:not(.collapsed)',
            '.viewer-overlay-controls',
            '.bookmark-gallery',
            '.property-info-panel',
            '.status-bar',
            '.selected-coordinate-overlay',
            '.floating-controls-container',
            '#screenshotModal'
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

        const extMap = { png: 'png', jpeg: 'jpg', webp: 'webp' };
        const ext = extMap[this.currentFormat] || 'png';
        const date = new Date();
        const dateString = date.toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `meridian-screenshot-${dateString}.${ext}`;

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
     * Export a self-contained HTML inspection report with screenshot, camera coordinates, and measurements.
     */
    async exportReport() {
        if (!this.currentScreenshot) return null;
        const dataUrl = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result || ''));
            r.onerror = () => reject(r.error || new Error('Failed to encode screenshot'));
            r.readAsDataURL(this.currentScreenshot);
        });
        const meta = this.currentMetadata || {
            capturedAt: new Date().toISOString(),
            camera: this.tilesetViewer?.getCameraPosition?.() || null,
            tilesetCount: this.tilesetViewer?.getAllTilesets?.()?.length || 0,
            measurements: [],
        };
        const esc = (s) =>
            String(s ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        const cam = meta.camera;
        const camLine = cam
            ? `${cam.lat}°, ${cam.lon}° · Altitude ${cam.height} m · Heading ${cam.heading}° · Pitch ${cam.pitch}°`
            : 'Unavailable';
        const measRows = (meta.measurements || [])
            .map(
                (m) =>
                    `<tr><td>${esc(m.type)}</td><td>${esc(m.formatted || m.value || '—')}</td><td>${esc(m.pointCount)}</td></tr>`
            )
            .join('');

        const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Meridian 3D Scene Report</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;margin:32px;background:#0f172a;color:#e2e8f0}
h1{margin:0 0 6px;font-size:22px}p.meta{color:#94a3b8;font-size:13px;margin:4px 0}
img{max-width:100%;border-radius:8px;border:1px solid #334155;margin:16px 0}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
th,td{border:1px solid #334155;padding:8px 10px;text-align:left}th{background:#1e293b}</style></head>
<body><h1>Meridian 3D Scene Report</h1>
<p class="meta"><strong>Captured:</strong> ${esc(meta.capturedAt)}</p>
<p class="meta"><strong>Camera:</strong> ${esc(camLine)}</p>
<p class="meta"><strong>Loaded Tilesets:</strong> ${esc(meta.tilesetCount)}</p>
<img src="${dataUrl}" alt="3D Scene Capture"/>
${measRows ? `<h2>Measurements</h2><table><thead><tr><th>Type</th><th>Value</th><th>Points</th></tr></thead><tbody>${measRows}</tbody></table>` : ''}
</body></html>`;

        const dateString = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `meridian-report-${dateString}.html`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        window.notification?.success?.('Scene report exported');
        return html;
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
