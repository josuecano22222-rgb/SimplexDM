/**
 * ShadeAnalysisManager
 * Sun simulation and shadow analysis (Meridian Design - Page 32)
 * Features: Date/time picker, animation, loop, speed control, shadow casting
 */

class ShadeAnalysisManager {
    constructor() {
        this.tilesetViewer = null;
        this.modal = null;
        this.isActive = false;
        this.isAnimating = false;
        this.animationFrameId = null; // Changed from animationInterval to use requestAnimationFrame
        this.currentDate = new Date();
        this.animationSpeed = 1; // hours per second
        this.loopAnimation = false;
        this.sunEntity = null;
        this.shadowMap = null;
        this.lastAnimationTime = 0; // Track last animation frame time
        this.init();
    }

    /**
     * Initialize shade analysis manager
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.createShadeAnalysisModal();
        this.setupEventHandlers();
    }

    /**
     * Create shade analysis modal
     */
    createShadeAnalysisModal() {
        // Remove existing if any
        const existing = document.getElementById('shadeAnalysisModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'shadeAnalysisModal';
        modal.className = 'shade-analysis-modal';
        modal.style.display = 'none';

        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        const timeStr = today.toTimeString().split(' ')[0].slice(0, 5);

        modal.innerHTML = `
            <div class="shade-analysis-content">
                <div class="shade-analysis-header">
                    <h2>Shade Analysis</h2>
                    <button class="close-btn" id="closeShadeAnalysisBtn">×</button>
                </div>
                <div class="shade-analysis-body">
                    <div class="shade-analysis-icon-container">
                        <div class="shade-analysis-icon">☀️</div>
                    </div>
                    
                    <div class="shade-control-section">
                        <div class="shade-toggle-section">
                            <label class="shade-toggle-label">
                                <input type="checkbox" id="shadeAnalysisToggle" class="shade-toggle-checkbox">
                                <span class="shade-toggle-slider"></span>
                                <span class="shade-toggle-text">Enable Shade Analysis</span>
                            </label>
                        </div>

                        <div class="shade-date-time-section">
                            <div class="shade-date-group">
                                <label>Date:</label>
                                <input type="date" id="shadeDateInput" class="date-input" value="${dateStr}">
                            </div>
                            <div class="shade-time-group">
                                <label>Time:</label>
                                <input type="time" id="shadeTimeInput" class="time-input" value="${timeStr}">
                            </div>
                        </div>

                        <div class="shade-animation-section">
                            <h3>Animation Controls</h3>
                            <div class="shade-animation-controls">
                                <button class="btn btn-primary" id="playAnimationBtn">
                                    <span>▶</span> Play
                                </button>
                                <button class="btn" id="pauseAnimationBtn" style="display: none;">
                                    <span>⏸</span> Pause
                                </button>
                                <button class="btn" id="stopAnimationBtn">
                                    <span>⏹</span> Stop
                                </button>
                            </div>
                            <div class="shade-animation-options">
                                <label class="shade-checkbox">
                                    <input type="checkbox" id="loopAnimationCheckbox">
                                    <span>Loop Animation</span>
                                </label>
                                <div class="shade-speed-control">
                                    <label>Speed:</label>
                                    <input type="range" id="animationSpeedSlider" min="0.5" max="10" step="0.5" value="${this.animationSpeed}">
                                    <span id="speedValue">${this.animationSpeed}x</span>
                                </div>
                            </div>
                        </div>

                        <div class="shade-info-section">
                            <p class="shade-info-text">
                                <strong>Shadow Impact Analysis:</strong> This tool simulates the sun's position and casts shadows based on the selected date and time. Use the animation controls to see how shadows change throughout the day.
                            </p>
                        </div>
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
            if (e.target.id === 'closeShadeAnalysisBtn' || (e.target === this.modal)) {
                this.hide();
            }
        });

        // Toggle shade analysis
        document.getElementById('shadeAnalysisToggle')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.enableShadeAnalysis();
            } else {
                this.disableShadeAnalysis();
            }
        });

        // Date/time inputs
        document.getElementById('shadeDateInput')?.addEventListener('change', (e) => {
            this.updateDate(e.target.value);
        });

        document.getElementById('shadeTimeInput')?.addEventListener('change', (e) => {
            this.updateTime(e.target.value);
        });

        // Animation controls
        document.getElementById('playAnimationBtn')?.addEventListener('click', () => {
            this.playAnimation();
        });

        document.getElementById('pauseAnimationBtn')?.addEventListener('click', () => {
            this.pauseAnimation();
        });

        document.getElementById('stopAnimationBtn')?.addEventListener('click', () => {
            this.stopAnimation();
        });

        // Loop checkbox
        document.getElementById('loopAnimationCheckbox')?.addEventListener('change', (e) => {
            this.loopAnimation = e.target.checked;
        });

        // Speed slider
        const speedSlider = document.getElementById('animationSpeedSlider');
        if (speedSlider) {
            speedSlider.addEventListener('input', (e) => {
                this.animationSpeed = parseFloat(e.target.value);
                document.getElementById('speedValue').textContent = `${this.animationSpeed}x`;
            });
        }
    }

    /**
     * Show shade analysis modal
     */
    show() {
        if (this.modal) {
            this.modal.style.display = 'flex';
        }
    }

    /**
     * Hide shade analysis modal
     */
    hide() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
        this.stopAnimation();
    }

    /**
     * Toggle shade analysis modal
     */
    toggle() {
        if (this.modal && this.modal.style.display === 'none') {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Enable shade analysis
     */
    enableShadeAnalysis() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) {
            if (window.notification) {
                window.notification.error('Viewer not ready');
            }
            return;
        }

        this.isActive = true;
        const viewer = this.tilesetViewer.viewer;

        // Enable shadows
        viewer.shadows = true;
        viewer.shadowMap.enabled = true;

        // Update sun position based on current date/time
        this.updateSunPosition();

        // Enable lighting
        viewer.scene.globe.enableLighting = true;
        viewer.scene.globe.dynamicAtmosphereLighting = true;

        if (window.notification) {
            window.notification.success('Shade analysis enabled');
        }
    }

    /**
     * Disable shade analysis
     */
    disableShadeAnalysis() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        this.isActive = false;
        this.stopAnimation();

        const viewer = this.tilesetViewer.viewer;

        // Disable shadows
        viewer.shadows = false;
        if (viewer.shadowMap) {
            viewer.shadowMap.enabled = false;
        }

        // Disable lighting
        viewer.scene.globe.enableLighting = false;
        viewer.scene.globe.dynamicAtmosphereLighting = false;

        if (window.notification) {
            window.notification.info('Shade analysis disabled');
        }
    }

    /**
     * Cleanup - ensure animation is stopped
     */
    cleanup() {
        this.stopAnimation();
    }

    /**
     * Update date
     */
    updateDate(dateString) {
        const [year, month, day] = dateString.split('-').map(Number);
        const currentTime = this.currentDate;
        this.currentDate = new Date(year, month - 1, day, 
            currentTime.getHours(), currentTime.getMinutes(), currentTime.getSeconds());
        
        if (this.isActive) {
            this.updateSunPosition();
        }
    }

    /**
     * Update time
     */
    updateTime(timeString) {
        const [hours, minutes] = timeString.split(':').map(Number);
        this.currentDate.setHours(hours, minutes, 0, 0);
        
        if (this.isActive) {
            this.updateSunPosition();
        }
    }

    /**
     * Update sun position based on date/time and location
     */
    updateSunPosition() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer || !this.isActive) return;

        const viewer = this.tilesetViewer.viewer;
        const camera = viewer.camera;

        // Get current camera position to determine location
        const cartographic = Cesium.Cartographic.fromCartesian(camera.position);
        const longitude = Cesium.Math.toDegrees(cartographic.longitude);
        const latitude = Cesium.Math.toDegrees(cartographic.latitude);

        // Calculate sun position using Cesium's sun calculations
        // Cesium uses JulianDate for time calculations
        const julianDate = Cesium.JulianDate.fromDate(this.currentDate);
        
        // Update clock to reflect the date/time
        viewer.clock.currentTime = julianDate;
        viewer.clock.shouldAnimate = false;

        // Calculate sun position
        const sunPosition = Cesium.Sun.computeSunPosition(julianDate, new Cesium.Cartesian3());
        
        // Update scene lighting
        viewer.scene.lightSource = new Cesium.DirectionalLight({
            direction: Cesium.Cartesian3.negate(sunPosition, new Cesium.Cartesian3()),
            intensity: 1.0
        });

        // Update globe lighting
        viewer.scene.globe.enableLighting = true;
        viewer.scene.globe.dynamicAtmosphereLighting = true;

        // Force scene update
        viewer.scene.requestRender();
    }

    /**
     * Play animation
     */
    playAnimation() {
        if (!this.isActive) {
            if (window.notification) {
                window.notification.warning('Please enable shade analysis first');
            }
            return;
        }

        if (this.animationFrameId) return; // Already animating

        this.isAnimating = true;
        this.lastAnimationTime = performance.now();
        
        // Update UI
        const playBtn = document.getElementById('playAnimationBtn');
        const pauseBtn = document.getElementById('pauseAnimationBtn');
        if (playBtn) playBtn.style.display = 'none';
        if (pauseBtn) pauseBtn.style.display = 'inline-flex';

        // Start animation loop using requestAnimationFrame for better performance
        const animate = (currentTime) => {
            if (!this.isAnimating) {
                this.animationFrameId = null;
                return;
            }

            // Calculate delta time in seconds
            const deltaTime = (currentTime - this.lastAnimationTime) / 1000;
            this.lastAnimationTime = currentTime;

            // Advance time by animation speed (hours per second)
            const hoursToAdd = this.animationSpeed * deltaTime;
            const currentHours = this.currentDate.getHours() + this.currentDate.getMinutes() / 60;
            const newHours = currentHours + hoursToAdd;

            // Check if we've passed midnight
            if (newHours >= 24) {
                if (this.loopAnimation) {
                    // Reset to start of day
                    const dateInput = document.getElementById('shadeDateInput');
                    if (dateInput) {
                        const startDate = new Date(dateInput.value);
                        startDate.setHours(0, 0, 0, 0);
                        this.currentDate = new Date(startDate);
                    }
                } else {
                    // Stop animation
                    this.stopAnimation();
                    return;
                }
            } else {
                // Update date with new hours
                const totalMinutes = Math.floor(newHours * 60);
                const hours = Math.floor(totalMinutes / 60) % 24;
                const minutes = totalMinutes % 60;
                this.currentDate.setHours(hours, minutes, 0, 0);
            }

            // Update time input
            const hours = String(this.currentDate.getHours()).padStart(2, '0');
            const minutes = String(this.currentDate.getMinutes()).padStart(2, '0');
            const timeInput = document.getElementById('shadeTimeInput');
            if (timeInput) {
                timeInput.value = `${hours}:${minutes}`;
            }

            // Update sun position
            this.updateSunPosition();

            // Continue animation loop
            this.animationFrameId = requestAnimationFrame(animate);
        };

        this.animationFrameId = requestAnimationFrame(animate);
    }

    /**
     * Pause animation
     */
    pauseAnimation() {
        this.isAnimating = false;
        
        // Update UI
        const playBtn = document.getElementById('playAnimationBtn');
        const pauseBtn = document.getElementById('pauseAnimationBtn');
        if (playBtn) playBtn.style.display = 'inline-flex';
        if (pauseBtn) pauseBtn.style.display = 'none';
    }

    /**
     * Stop animation
     */
    stopAnimation() {
        this.isAnimating = false;

        // Cancel animation frame
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Update UI
        const playBtn = document.getElementById('playAnimationBtn');
        const pauseBtn = document.getElementById('pauseAnimationBtn');
        if (playBtn) playBtn.style.display = 'inline-flex';
        if (pauseBtn) pauseBtn.style.display = 'none';

        // Reset to original time if needed
        const timeInput = document.getElementById('shadeTimeInput');
        if (timeInput) {
            const originalTime = timeInput.getAttribute('data-original-time');
            if (originalTime) {
                timeInput.value = originalTime;
                this.updateTime(originalTime);
            }
        }
    }

    /**
     * Get current date/time
     */
    getCurrentDateTime() {
        return {
            date: this.currentDate,
            dateString: this.currentDate.toISOString().split('T')[0],
            timeString: this.currentDate.toTimeString().split(' ')[0].slice(0, 5)
        };
    }

    /**
     * Set date/time programmatically
     */
    setDateTime(date, time) {
        const [year, month, day] = date.split('-').map(Number);
        const [hours, minutes] = time.split(':').map(Number);
        this.currentDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
        
        // Update inputs
        document.getElementById('shadeDateInput').value = date;
        document.getElementById('shadeTimeInput').value = time;
        
        if (this.isActive) {
            this.updateSunPosition();
        }
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.shadeAnalysisManager = new ShadeAnalysisManager();
}
