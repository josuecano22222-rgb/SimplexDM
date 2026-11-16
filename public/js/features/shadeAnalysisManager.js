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
        modal.className = 'shade-analysis-modal map-tool-panel-overlay';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'shadeAnalysisHeading');
        modal.style.display = 'none';

        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        const timeStr = today.toTimeString().split(' ')[0].slice(0, 5);
        const curMinutes = today.getHours() * 60 + today.getMinutes();

        modal.innerHTML = `
            <div class="shade-analysis-content sdm-tool-dialog">
                <div class="shade-analysis-header sdm-tool-header">
                    <h2 id="shadeAnalysisHeading">
                        <i class="fas fa-sun" aria-hidden="true"></i>
                        <span>Sun-Path &amp; Shade Analysis</span>
                    </h2>
                    <button type="button" class="close-btn" id="closeShadeAnalysisBtn" aria-label="Close Shade Analysis">×</button>
                </div>
                <div class="shade-analysis-body sdm-tool-body">
                    <div class="shade-control-section">
                        <div class="shade-toggle-section">
                            <label class="shade-toggle-label">
                                <input type="checkbox" id="shadeAnalysisToggle" class="shade-toggle-checkbox">
                                <span class="shade-toggle-slider"></span>
                                <span class="shade-toggle-text">Enable Real-Time Sun Shadows</span>
                            </label>
                        </div>

                        <div class="shade-solar-readout" id="shadeSolarReadout" aria-live="polite">
                            <div class="shade-solar-metric">
                                <span class="shade-solar-label">Elevation</span>
                                <strong id="shadeAltVal">—°</strong>
                            </div>
                            <div class="shade-solar-metric">
                                <span class="shade-solar-label">Azimuth</span>
                                <strong id="shadeAzVal">—°</strong>
                            </div>
                            <div class="shade-solar-metric">
                                <span class="shade-solar-label">Phase</span>
                                <strong id="shadePhaseVal">Standby</strong>
                            </div>
                        </div>

                        <div class="shade-date-time-section">
                            <div class="shade-date-group">
                                <label for="shadeDateInput">Date</label>
                                <input type="date" id="shadeDateInput" class="date-input" value="${dateStr}">
                            </div>
                            <div class="shade-time-group">
                                <label for="shadeTimeInput">Time</label>
                                <input type="time" id="shadeTimeInput" class="time-input" value="${timeStr}">
                            </div>
                        </div>

                        <label class="oblique-slider-field" for="shadeTimeScrub">
                            <span>Solar Time Scrubber</span>
                            <input type="range" id="shadeTimeScrub" min="0" max="1439" step="5" value="${curMinutes}">
                        </label>

                        <div class="shade-season-presets" role="group" aria-label="Solar solstice and equinox presets">
                            <button type="button" class="btn btn-xs" data-shade-preset="03-20">Mar Equinox</button>
                            <button type="button" class="btn btn-xs" data-shade-preset="06-21">Jun Solstice</button>
                            <button type="button" class="btn btn-xs" data-shade-preset="09-22">Sep Equinox</button>
                            <button type="button" class="btn btn-xs" data-shade-preset="12-21">Dec Solstice</button>
                        </div>

                        <div class="shade-animation-section">
                            <h3>Diurnal Animation</h3>
                            <div class="shade-animation-controls">
                                <button type="button" class="btn btn-primary btn-sm" id="playAnimationBtn">
                                    <i class="fas fa-play" aria-hidden="true"></i> Play
                                </button>
                                <button type="button" class="btn btn-secondary btn-sm" id="pauseAnimationBtn" style="display: none;">
                                    <i class="fas fa-pause" aria-hidden="true"></i> Pause
                                </button>
                                <button type="button" class="btn btn-secondary btn-sm" id="stopAnimationBtn">
                                    <i class="fas fa-stop" aria-hidden="true"></i> Stop
                                </button>
                            </div>
                            <div class="shade-animation-options">
                                <label class="shade-checkbox">
                                    <input type="checkbox" id="loopAnimationCheckbox">
                                    <span>Loop Day</span>
                                </label>
                                <div class="shade-speed-control">
                                    <label for="animationSpeedSlider">Speed:</label>
                                    <input type="range" id="animationSpeedSlider" min="0.5" max="10" step="0.5" value="${this.animationSpeed}">
                                    <span id="speedValue">${this.animationSpeed}x</span>
                                </div>
                            </div>
                        </div>

                        <div class="shade-info-section">
                            <p class="shade-info-text" id="shadeDaylightSummary">
                                Computes exact astronomical solar geometry and casts soft 3D shadow maps across loaded 3D Tiles and terrain.
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

        // Time input
        document.getElementById('shadeTimeInput')?.addEventListener('change', (e) => {
            this.updateTime(e.target.value);
        });

        // Continuous solar time scrubber
        document.getElementById('shadeTimeScrub')?.addEventListener('input', (e) => {
            const totalMin = Math.max(0, Math.min(1439, Number(e.target.value) || 0));
            const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
            const mm = String(totalMin % 60).padStart(2, '0');
            const timeInput = document.getElementById('shadeTimeInput');
            if (timeInput) timeInput.value = `${hh}:${mm}`;
            this.updateTime(`${hh}:${mm}`);
            if (!this.isActive) this._refreshSolarReadout();
        });

        // Solstice & equinox quick presets
        this.modal?.querySelectorAll('[data-shade-preset]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const md = btn.getAttribute('data-shade-preset');
                if (!md) return;
                const year = this.currentDate.getFullYear();
                const iso = `${year}-${md}`;
                const dateInput = document.getElementById('shadeDateInput');
                if (dateInput) dateInput.value = iso;
                this.updateDate(iso);
                if (!this.isActive) this._refreshSolarReadout();
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal && this.modal.style.display !== 'none') {
                this.hide();
            }
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
            this._refreshSolarReadout();
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
     * NOAA solar position & sunrise/sunset calculator (accuracy ~0.1°).
     */
    static computeSolarPosition(date, latDeg, lonDeg) {
        const d = date instanceof Date ? date : new Date(date);
        const rad = Math.PI / 180;
        const deg = 180 / Math.PI;
        const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
        const dayOfYear = Math.floor((d.getTime() - startOfYear) / 86400000) + 1;
        const utcHours =
            d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;

        // Fractional year (radians)
        const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);

        // Equation of time (minutes) and solar declination (radians)
        const eqTime =
            229.18 *
            (0.000075 +
                0.001868 * Math.cos(gamma) -
                0.032077 * Math.sin(gamma) -
                0.014615 * Math.cos(2 * gamma) -
                0.040849 * Math.sin(2 * gamma));
        const decl =
            0.006918 -
            0.399912 * Math.cos(gamma) +
            0.070257 * Math.sin(gamma) -
            0.006758 * Math.cos(2 * gamma) +
            0.000907 * Math.sin(2 * gamma) -
            0.002697 * Math.cos(3 * gamma) +
            0.00148 * Math.sin(3 * gamma);

        const trueSolarMinutes = ((utcHours * 60 + eqTime + 4 * lonDeg) % 1440 + 1440) % 1440;
        const hourAngleDeg = trueSolarMinutes / 4 - 180;
        const ha = hourAngleDeg * rad;
        const lat = Math.max(-89.9, Math.min(89.9, Number(latDeg) || 0)) * rad;

        const sinAlt =
            Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
        const altRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
        const altitudeDeg = altRad * deg;

        const cosAz =
            (Math.sin(decl) - Math.sin(lat) * Math.sin(altRad)) /
            Math.max(1e-9, Math.cos(lat) * Math.cos(altRad));
        let azimuthDeg = Math.acos(Math.max(-1, Math.min(1, cosAz))) * deg;
        if (Math.sin(ha) > 0) {
            azimuthDeg = 360 - azimuthDeg;
        }

        // Sunrise / sunset hour angle (zenith 90.833° including atmospheric refraction)
        const cosH0 =
            (Math.cos(90.833 * rad) - Math.sin(lat) * Math.sin(decl)) /
            Math.max(1e-9, Math.cos(lat) * Math.cos(decl));
        let sunriseUtcMin = null;
        let sunsetUtcMin = null;
        if (cosH0 >= -1 && cosH0 <= 1) {
            const h0Deg = Math.acos(cosH0) * deg;
            sunriseUtcMin = ((720 - 4 * (lonDeg + h0Deg) - eqTime) % 1440 + 1440) % 1440;
            sunsetUtcMin = ((720 - 4 * (lonDeg - h0Deg) - eqTime) % 1440 + 1440) % 1440;
        }

        let phase = 'Night';
        if (altitudeDeg > 0) phase = 'Daylight';
        else if (altitudeDeg > -6) phase = 'Civil Twilight';
        else if (altitudeDeg > -12) phase = 'Nautical Twilight';

        return {
            altitudeDeg: Number(altitudeDeg.toFixed(2)),
            azimuthDeg: Number((azimuthDeg % 360).toFixed(2)),
            phase,
            sunriseUtcMin,
            sunsetUtcMin,
        };
    }

    _refreshSolarReadout() {
        let lon = 4.9041;
        let lat = 52.3676;
        const viewer = this.tilesetViewer?.viewer || window.tilesetViewer?.viewer;
        if (viewer?.camera && typeof Cesium !== 'undefined') {
            try {
                const c = viewer.camera.positionCartographic;
                if (c) {
                    lon = Cesium.Math.toDegrees(c.longitude);
                    lat = Cesium.Math.toDegrees(c.latitude);
                }
            } catch (_) {
                /* keep default */
            }
        }
        const solar = ShadeAnalysisManager.computeSolarPosition(this.currentDate, lat, lon);
        const altEl = typeof document !== 'undefined' ? document.getElementById('shadeAltVal') : null;
        const azEl = typeof document !== 'undefined' ? document.getElementById('shadeAzVal') : null;
        const phEl = typeof document !== 'undefined' ? document.getElementById('shadePhaseVal') : null;
        const sumEl = typeof document !== 'undefined' ? document.getElementById('shadeDaylightSummary') : null;
        const scrub = typeof document !== 'undefined' ? document.getElementById('shadeTimeScrub') : null;

        if (altEl) altEl.textContent = `${solar.altitudeDeg.toFixed(1)}°`;
        if (azEl) azEl.textContent = `${solar.azimuthDeg.toFixed(1)}°`;
        if (phEl) phEl.textContent = solar.phase;
        if (scrub) {
            scrub.value = String(this.currentDate.getHours() * 60 + this.currentDate.getMinutes());
        }
        if (sumEl && solar.sunriseUtcMin !== null && solar.sunsetUtcMin !== null) {
            const fmtUtc = (mins) => {
                const d = new Date(this.currentDate);
                d.setUTCHours(Math.floor(mins / 60), Math.round(mins % 60), 0, 0);
                return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            };
            const daylightHrs = (((solar.sunsetUtcMin - solar.sunriseUtcMin + 1440) % 1440) / 60).toFixed(1);
            sumEl.textContent = `Sunrise ${fmtUtc(solar.sunriseUtcMin)} · Sunset ${fmtUtc(solar.sunsetUtcMin)} · ${daylightHrs} h daylight at ${lat.toFixed(3)}°, ${lon.toFixed(3)}°`;
        }
        return solar;
    }

    /**
     * Update Cesium scene sun ephemeris, soft shadow maps, and solar telemetry readout.
     */
    updateSunPosition() {
        if (!this.tilesetViewer && typeof window !== 'undefined') {
            this.tilesetViewer = window.tilesetViewer;
        }
        this._refreshSolarReadout();
        if (!this.tilesetViewer?.viewer || !this.isActive || typeof Cesium === 'undefined') return;

        const viewer = this.tilesetViewer.viewer;
        const julianDate = Cesium.JulianDate.fromDate(this.currentDate);

        viewer.clock.currentTime = julianDate;
        viewer.clock.shouldAnimate = false;

        // Cesium.SunLight computes exact Simon1994 solar ephemeris from viewer.clock.currentTime
        if (!(viewer.scene.light instanceof Cesium.SunLight)) {
            viewer.scene.light = new Cesium.SunLight({ intensity: 2.0 });
        }
        viewer.scene.globe.enableLighting = true;
        viewer.scene.globe.dynamicAtmosphereLighting = true;
        viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
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
        
        const di = typeof document !== 'undefined' ? document.getElementById('shadeDateInput') : null;
        const ti = typeof document !== 'undefined' ? document.getElementById('shadeTimeInput') : null;
        if (di) di.value = date;
        if (ti) ti.value = time;
        this._refreshSolarReadout();
        if (this.isActive) {
            this.updateSunPosition();
        }
    }
}

if (typeof window !== 'undefined') {
    window.ShadeAnalysisManager = ShadeAnalysisManager;
    window.shadeAnalysisManager = new ShadeAnalysisManager();
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ShadeAnalysisManager };
}
