/**
 * HelpUI
 * Comprehensive help system for SimplexDM
 * Displays help documentation and guides
 */

class HelpUI {
    constructor() {
        this.helpModal = null;
        this.isVisible = false;
        this.currentTab = 'getting-started';
        this._handlersBound = false;
    }

    /**
     * Initialize help UI
     */
    init() {
        this.createHelpModal();
        this.setupEventHandlers();
        if (!this._localeListenerBound) {
            this._localeListenerBound = true;
            window.addEventListener('simplex:localeChanged', () => {
                const wasVisible = this.isVisible;
                const tab = this.currentTab;
                this.createHelpModal();
                this.switchTab(tab);
                if (wasVisible && this.helpModal) {
                    this.helpModal.style.display = 'flex';
                    this.isVisible = true;
                }
            });
        }
    }

    _t(path) {
        if (window.appI18n && typeof window.appI18n.t === 'function') {
            return window.appI18n.t(path);
        }
        return path;
    }

    /**
     * Tab body: optional override via locale `helpHtml.<key>` (string HTML).
     * Default content is generated below so it stays aligned with the running app.
     */
    _tabBody(htmlKey) {
        const path = 'helpHtml.' + htmlKey;
        const v = this._t(path);
        if (v && v !== path) return v;
        const fallbacks = {
            gettingStarted: () => this.renderGettingStarted(),
            navigation: () => this.renderNavigation(),
            tools: () => this.renderTools(),
            keyboard: () => this.renderKeyboardShortcuts(),
            troubleshooting: () => this.renderTroubleshooting()
        };
        return fallbacks[htmlKey] ? fallbacks[htmlKey]() : '';
    }

    /**
     * Create help modal overlay
     */
    createHelpModal() {
        // Remove existing if any
        const existing = document.getElementById('helpModal');
        if (existing) {
            existing.remove();
        }

        const t = (k) => this._t(k);
        const modal = document.createElement('div');
        modal.id = 'helpModal';
        modal.className = 'modal';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="modal-content help-content" role="dialog" aria-modal="true" aria-labelledby="helpModalTitle">
                <div class="modal-header">
                    <h2 id="helpModalTitle"><i class="fas fa-question-circle"></i> ${t('ui.helpModal.title')}</h2>
                    <button type="button" class="close-btn" id="closeHelpBtn" title="${t('ui.helpModal.closeTitle')}" aria-label="${t('ui.helpModal.closeAria')}">×</button>
                </div>
                <div class="help-tabs">
                    <button class="help-tab-btn active" data-tab="getting-started">
                        <i class="fas fa-rocket"></i> ${t('ui.helpModal.tabGettingStarted')}
                    </button>
                    <button class="help-tab-btn" data-tab="navigation">
                        <i class="fas fa-mouse"></i> ${t('ui.helpModal.tabNavigation')}
                    </button>
                    <button class="help-tab-btn" data-tab="tools">
                        <i class="fas fa-tools"></i> ${t('ui.helpModal.tabTools')}
                    </button>
                    <button class="help-tab-btn" data-tab="keyboard">
                        <i class="fas fa-keyboard"></i> ${t('ui.helpModal.tabKeyboard')}
                    </button>
                    <button class="help-tab-btn" data-tab="troubleshooting">
                        <i class="fas fa-wrench"></i> ${t('ui.helpModal.tabTroubleshooting')}
                    </button>
                </div>
                <div class="help-tab-content active" id="helpGettingStartedTab">
                    ${this._tabBody('gettingStarted')}
                </div>
                <div class="help-tab-content" id="helpNavigationTab">
                    ${this._tabBody('navigation')}
                </div>
                <div class="help-tab-content" id="helpToolsTab">
                    ${this._tabBody('tools')}
                </div>
                <div class="help-tab-content" id="helpKeyboardTab">
                    ${this._tabBody('keyboard')}
                </div>
                <div class="help-tab-content" id="helpTroubleshootingTab">
                    ${this._tabBody('troubleshooting')}
                </div>
            </div>
        `;

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
        // Close button
        document.addEventListener('click', (e) => {
            if (e.target.id === 'closeHelpBtn' || e.target.closest('#closeHelpBtn')) {
                this.hide();
            }
        });

        // Tab switching
        document.addEventListener('click', (e) => {
            if (e.target.closest('.help-tab-btn')) {
                const btn = e.target.closest('.help-tab-btn');
                const tabName = btn.dataset.tab;
                this.switchTab(tabName);
            }
        });

        // Close on outside click
        if (this.helpModal) {
            this.helpModal.addEventListener('click', (e) => {
                if (e.target === this.helpModal) {
                    this.hide();
                }
            });
        }

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) {
                this.hide();
            }
        });
    }

    /**
     * Switch help tab
     */
    switchTab(tabName) {
        const tabContentIds = {
            'getting-started': 'helpGettingStartedTab',
            navigation: 'helpNavigationTab',
            tools: 'helpToolsTab',
            keyboard: 'helpKeyboardTab',
            troubleshooting: 'helpTroubleshootingTab'
        };

        document.querySelectorAll('.help-tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelectorAll('.help-tab-content').forEach(content => {
            content.classList.remove('active');
        });

        const tabBtn = document.querySelector(`.help-tab-btn[data-tab="${tabName}"]`);
        const contentId = tabContentIds[tabName] ||
            `help${tabName.charAt(0).toUpperCase() + tabName.slice(1)}Tab`;
        const tabContent = document.getElementById(contentId);

        if (tabBtn) tabBtn.classList.add('active');
        if (tabContent) tabContent.classList.add('active');

        this.currentTab = tabName;
    }

    /**
     * Render Getting Started content
     */
    renderGettingStarted() {
        return `
            <div class="help-section">
                <h3>Welcome to SimplexDM</h3>
                <p>SimplexDM is a desktop-first 3D globe application for viewing, analyzing, and managing <strong>Cesium 3D Tiles</strong> and related geospatial layers. It runs in <strong>Electron</strong> (full local paths and GIS projects) or in a <strong>browser</strong> (HTTP URLs and supported file APIs).</p>
                
                <h4>Quick Start</h4>
                <ol>
                    <li><strong>Load a tileset:</strong>
                        <ul>
                            <li>Bottom toolbar: <strong>Layers</strong> → open or add a <code>tileset.json</code> (wording may be <strong>Open Tileset</strong> / layer actions depending on build)</li>
                            <li>Right sidebar: <strong>Display Control</strong> → <strong>Load tileset</strong> for path/URL dialog (and optional file browse in Electron)</li>
                            <li>Drag and drop a <code>tileset.json</code> onto the viewer when the host supports it</li>
                        </ul>
                    </li>
                    <li><strong>Navigate:</strong>
                        <ul>
                            <li>Mouse: rotate, pan, zoom (Cesium defaults — see <strong>Navigation</strong>)</li>
                            <li>Optional <strong>flight mode</strong> adds keyboard movement in <strong>3D</strong> only (see <strong>Keyboard Shortcuts</strong>)</li>
                        </ul>
                    </li>
                    <li><strong>Use tools:</strong>
                        <ul>
                            <li>Bottom map toolbar and nested tools menu: measurement, LOS, viewshed, elevation profile, display modes, etc.</li>
                            <li>See <strong>Tools &amp; Features</strong> for a full map</li>
                        </ul>
                    </li>
                </ol>

                <h4>Supported formats (overview)</h4>
                <ul>
                    <li><strong>3D Tiles:</strong> load via root <code>tileset.json</code> (streamed LODs: e.g. <code>.b3dm</code>, <code>.pnts</code>, <code>.i3dm</code>, <code>.cmpt</code> as referenced by the tileset)</li>
                    <li><strong>Architectural upload</strong> (Models &amp; Layers): GLTF, GLB, OBJ, 3DS, FBX — plus folder-based workflows where offered</li>
                    <li><strong>Vector upload:</strong> GeoJSON, KML, KMZ, Shapefile (often as <code>.zip</code>)</li>
                    <li><strong>Basemap / offline imagery:</strong> local raster tiles under paths such as <code>data/tiles/</code> or <code>data/pro/</code> when configured</li>
                </ul>

                <h4>Loading a Tileset</h4>
                <div class="help-feature-list">
                    <div class="help-feature-item">
                        <i class="fas fa-folder-open"></i>
                        <div>
                            <strong>Layers menu</strong>
                            <p>Bottom toolbar <strong>Layers</strong> → open or add tileset; manage GIS layers and visibility.</p>
                        </div>
                    </div>
                    <div class="help-feature-item">
                        <i class="fas fa-hand-pointer"></i>
                        <div>
                            <strong>Drag &amp; Drop</strong>
                            <p>Drag <code>tileset.json</code> onto the 3D canvas when supported by the host.</p>
                        </div>
                    </div>
                    <div class="help-feature-item">
                        <i class="fas fa-keyboard"></i>
                        <div>
                            <strong>Path / URL dialog</strong>
                            <p>Right sidebar → <strong>Display Control</strong> → <strong>Load tileset</strong>: type a relative path, Windows path, or <code>http(s)</code> URL; use <strong>Browse</strong> when the File System Access API or Electron is available.</p>
                        </div>
                    </div>
                    <div class="help-feature-item">
                        <i class="fas fa-plus"></i>
                        <div>
                            <strong>Add tileset (URL)</strong>
                            <p>Next to the tileset selector, <strong>+</strong> opens a dialog to enter or browse for another tileset URL/path.</p>
                        </div>
                    </div>
                </div>

                <h4>GIS projects (Electron)</h4>
                <p class="help-note">When the GIS stack is enabled, <kbd>Ctrl</kbd>+<kbd>O</kbd> opens a project folder and <kbd>Ctrl</kbd>+<kbd>N</kbd> creates a new project (after <code>projectManager.init()</code>). Requires Electron GIS IPC.</p>

                <h4>Interface Overview</h4>
                <div class="help-interface-diagram">
                    <div class="diagram-item">
                        <strong>Top Navigation Bar</strong>
                        <p>Access Home, Navigation Help, Database, Dashboard, and Help</p>
                    </div>
                    <div class="diagram-item">
                        <strong>Primary Toolbar</strong>
                        <p>Quick access to layers, navigation, measurement, and analysis tools</p>
                    </div>
                    <div class="diagram-item">
                        <strong>Left Sidebar</strong>
                        <p>Layers & Regions management, search, and filters</p>
                    </div>
                    <div class="diagram-item">
                        <strong>Right Sidebar</strong>
                        <p>Display controls, feature manager, and tile inspector</p>
                    </div>
                    <div class="diagram-item">
                        <strong>Status Bar</strong>
                        <p>Shows status, coordinates, tile count, and FPS</p>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render Navigation content
     */
    renderNavigation() {
        return `
            <div class="help-section">
                <h3>Navigation Controls</h3>
                <p>Navigate the 3D view using mouse, keyboard, and toolbar controls.</p>

                <h4>Mouse (Cesium default controller)</h4>
                <p class="help-note">Behavior matches typical CesiumJS: <strong>left</strong> drag rotates/orbits; <strong>right</strong> drag or <strong>wheel</strong> zooms toward the cursor; <strong>middle</strong> drag pans when available. Some setups also allow <kbd>Ctrl</kbd>+left drag to pan — use whatever your build maps in <code>ScreenSpaceCameraController</code>.</p>
                <div class="help-control-list">
                    <div class="help-control-item">
                        <div class="control-icon"><i class="fas fa-mouse"></i> Left drag</div>
                        <div class="control-description">
                            <strong>Rotate / orbit</strong> the camera around the point of interest.
                        </div>
                    </div>
                    <div class="help-control-item">
                        <div class="control-icon"><i class="fas fa-mouse"></i> Right drag</div>
                        <div class="control-description">
                            <strong>Zoom</strong> (drag up/down) or use device-specific zoom gestures.
                        </div>
                    </div>
                    <div class="help-control-item">
                        <div class="control-icon"><i class="fas fa-mouse"></i> Middle drag</div>
                        <div class="control-description">
                            <strong>Pan</strong> the view when middle mouse is available.
                        </div>
                    </div>
                    <div class="help-control-item">
                        <div class="control-icon"><i class="fas fa-mouse"></i> Wheel</div>
                        <div class="control-description">
                            <strong>Zoom in and out</strong> toward the cursor.
                        </div>
                    </div>
                </div>

                <h4>Toolbar navigation (bottom strip)</h4>
                <div class="help-toolbar-list">
                    <div class="help-toolbar-item">
                        <i class="fas fa-layer-group"></i>
                        <div>
                            <strong>Layers</strong>
                            <p>Open the layers menu to load tilesets, GIS layers, and control visibility.</p>
                        </div>
                    </div>
                    <div class="help-toolbar-item">
                        <i class="fas fa-home"></i>
                        <div>
                            <strong>Home view</strong>
                            <p>Fly the camera to the saved home / default view for the scene.</p>
                        </div>
                    </div>
                    <div class="help-toolbar-item">
                        <i class="fas fa-arrow-left"></i>
                        <div>
                            <strong>Previous / Next view</strong>
                            <p>Step through camera history (like a browser). Disabled when there is no history in that direction.</p>
                        </div>
                    </div>
                    <div class="help-toolbar-item">
                        <i class="fas fa-compass"></i>
                        <div>
                            <strong>North &amp; top view</strong>
                            <p>Rotate to north; use <strong>Top view</strong> for a nadir (overhead) camera.</p>
                        </div>
                    </div>
                </div>

                <h4>Coordinate Display</h4>
                <p>The status bar at the bottom shows:</p>
                <ul>
                    <li><strong>Longitude:</strong> Geographic longitude coordinate</li>
                    <li><strong>Latitude:</strong> Geographic latitude coordinate</li>
                    <li><strong>Height:</strong> Elevation above sea level</li>
                </ul>
                <p><strong>Tip:</strong> Right-click on the map to copy coordinates in ITM or GEO format.</p>
            </div>
        `;
    }

    /**
     * Render Tools & Features content
     */
    renderTools() {
        return `
            <div class="help-section">
                <h3>Tools &amp; features</h3>
                <p>Meridian is built on <strong>CesiumJS</strong> with optional <strong>Cesium Ion SDK</strong> add-ons (measurement, sensors). Tools share one active “surface” at a time where noted, so panels do not overlap.</p>
                <p class="help-note"><strong>Configuration:</strong> Scene visualization (transparency, fog, height ramp divisors, etc.) can be tuned under <code>Project.Optional_tools.SceneModes</code> in your tileset JSON or in <code>public/data/config/app-config.json</code> → <code>Project.Optional_tools</code>. Restart or reload config where applicable.</p>

                <h4>Display modes rail (above the bottom toolbar)</h4>
                <p class="help-tool-detail">These modes affect rendering. <strong>Transparency, white model, height coloring, and thematic map</strong> replace each other’s tile styling. <strong>Fog</strong> and <strong>depth map</strong> both use atmospheric fog—only one can be active.</p>
                <div class="help-tool-list">
                    <div class="help-tool-item">
                        <i class="fas fa-adjust"></i>
                        <div>
                            <strong>Transparency</strong>
                            <p>Applies a semi-transparent style to loaded 3D Tiles. <em>How:</em> toggle on/off. Opacity comes from config (<code>SceneModes.transparency.alpha</code>).</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-smog"></i>
                        <div>
                            <strong>Fog</strong>
                            <p>Atmospheric fog for depth perception. <em>How:</em> toggle. Density/brightness: <code>SceneModes.fog</code>.</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-square"></i>
                        <div>
                            <strong>White model</strong>
                            <p>Uniform white styling on tilesets (design review). Restores previous styles when turned off.</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-mountain"></i>
                        <div>
                            <strong>Slope</strong>
                            <p>Slope visualization via the display-modes pipeline. <em>Requires</em> display-modes support in the build.</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-layer-group"></i>
                        <div>
                            <strong>Height coloring</strong>
                            <p>Color by elevation (blue→red ramp). Scale: <code>SceneModes.height.heightDivisor</code> (metres).</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-water"></i>
                        <div>
                            <strong>Depth map (distance)</strong>
                            <p>Stronger fog density for depth emphasis. <code>SceneModes.distance.density</code>.</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-compass"></i>
                        <div>
                            <strong>Direction / aspect</strong>
                            <p>Toggles globe lighting to emphasize directional shading (implementation-specific).</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-snowflake"></i>
                        <div>
                            <strong>Snow / Clouds</strong>
                            <p>Weather-style overlays when the display-modes manager exposes them.</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-vector-square"></i>
                        <div>
                            <strong>Orthographic</strong>
                            <p>Switches the camera to an orthographic frustum for plan-style views. Width scales with camera height; factor: <code>SceneModes.ortho.orthoWidthFactor</code>.</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-palette"></i>
                        <div>
                            <strong>Thematic color map</strong>
                            <p>Alternative height-based palette (cyan/magenta). Scale: <code>SceneModes.remapColors.heightDivisor</code>.</p>
                        </div>
                    </div>
                </div>

                <h4>Main map toolbar (bottom strip)</h4>
                <div class="help-tool-list">
                    <div class="help-tool-item">
                        <i class="fas fa-layer-group"></i>
                        <div>
                            <strong>Layers</strong>
                            <p>Open the layers menu: load <code>tileset.json</code>, manage GIS layers, visibility. Same entry point as drag-and-drop in many setups.</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-home"></i>
                        <div>
                            <strong>Home · History · North · Top</strong>
                            <p><strong>Home</strong> restores the default view. <strong>Previous/Next</strong> walk camera history. <strong>North</strong> aligns heading to north. <strong>Top</strong> nadir view.</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-share-alt"></i>
                        <div>
                            <strong>Share location</strong>
                            <p>Share the current camera / place (implementation opens a share UI).</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-camera"></i>
                        <div>
                            <strong>Screenshot</strong>
                            <p>Capture the current viewport (export path depends on host: browser vs Electron).</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-street-view"></i>
                        <div>
                            <strong>Street view</strong>
                            <p>Ground-level or street-aligned navigation when data/providers are available.</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-plane"></i>
                        <div>
                            <strong>Flight mode (Superman)</strong>
                            <p><strong>Keyboard-only</strong> free flight in <strong>3D scene mode</strong>: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> and arrows move; <kbd>Q</kbd>/<kbd>E</kbd> down/up along world vertical; <kbd>J</kbd><kbd>L</kbd><kbd>I</kbd><kbd>K</kbd> look left/right/up/down; <kbd>Shift</kbd> boosts speed. Globe mouse/touch is disabled until you turn flight off. Set base speed with the slider in the flight panel (not the mouse wheel). <kbd>Esc</kbd> exits flight.</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-draw-polygon"></i>
                        <div>
                            <strong>Clip with polygon</strong>
                            <p>Define a region to clip or cut the scene (manager workflow).</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-columns"></i>
                        <div>
                            <strong>Split screen</strong>
                            <p>Two synchronized or compared views side by side.</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-ruler-combined"></i>
                        <div>
                            <strong>Measure (Ion SDK)</strong>
                            <p>When Ion SDK measurement is attached, the strip opens Cesium-style tools: distance, area, heights, horizontal/vertical distances, component distance, radius (including custom radius/circle on terrain). Pick on the model surface; zoom improves precision. See <a href="https://cesium.com/learn/ion-sdk/ref-doc/Measure.html" target="_blank" rel="noopener">Cesium Ion Measure</a>.</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-eye"></i>
                        <div>
                            <strong>Line of sight</strong>
                            <p>Two clicks: start and end on the model/terrain. Shows whether the segment is blocked and can expose height offsets in the LOS panel. Exclusive with viewshed/measure strip while active.</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-broadcast-tower"></i>
                        <div>
                            <strong>Viewshed (view range)</strong>
                            <p>Uses a sensor-style frustum (Ion SDK Sensors when available) to color visible vs occluded regions. Follow on-screen steps to place observer and target. Exclusive with other analysis tools.</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-chart-area"></i>
                        <div>
                            <strong>Elevation profile</strong>
                            <p>Click points along a path on the terrain/model; <strong>double-click</strong> to finish. Samples terrain heights and draws a simple profile (min/max summary).</p>
                        </div>
                    </div>
                    <div class="help-tool-item">
                        <i class="fas fa-sliders-h"></i>
                        <div>
                            <strong>Display modes (special)</strong>
                            <p>Opens the secondary rail for the scene-mode buttons above. Also links to extended display-modes UI when present.</p>
                        </div>
                    </div>
                </div>

                <h4>Other entry points (nested toolbar / dashboard)</h4>
                <ul>
                    <li><strong>Bookmarks, Search, Models map, Shade analysis, Oblique views, Model upload, Map labels</strong> — from the nested tools menu or dashboard when enabled in config; they invoke the same managers as matching toolbar actions.</li>
                    <li><strong>Visible / hidden areas</strong> (view range / coverage-style analysis) — where exposed, complements line-of-sight and viewshed workflows.</li>
                    <li><strong>Coordinate research</strong> (sidebar): convert coordinates, fly to location, copy results.</li>
                    <li><strong>Tile inspector / Database / Dashboard</strong> — metadata, paths, and JSON inspection.</li>
                </ul>

                <h4>Measurement accuracy (industry practice)</h4>
                <p class="help-tool-detail">Cesium / Ion measurements rely on picks on the 3D Tiles surface. <strong>Zoom in</strong>, ensure the tileset is fully loaded, and click directly on geometry. For critical survey work, validate against known control points.</p>
            </div>
        `;
    }

    /**
     * Render Keyboard Shortcuts content
     */
    renderKeyboardShortcuts() {
        return `
            <div class="help-section">
                <h3>Keyboard shortcuts</h3>
                <p>Most of the time the viewer uses the <strong>mouse</strong> for the Cesium camera. Shortcuts below apply when a specific tool is active or when the GIS desktop stack wires global chords.</p>

                <h4>Flight mode (Superman — when enabled, 3D only)</h4>
                <p class="help-note">Keys are ignored while focus is in a text field. Speed is adjusted with the <strong>Base speed</strong> slider in the flight panel (10–200&nbsp;m/s), not the scroll wheel.</p>
                <div class="help-shortcut-list">
                    <div class="help-shortcut-item">
                        <kbd>W</kbd> <kbd>S</kbd> <kbd>A</kbd> <kbd>D</kbd>
                        <span>Move forward / back / strafe left / strafe right</span>
                    </div>
                    <div class="help-shortcut-item">
                        <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd>
                        <span>Same movement as WASD</span>
                    </div>
                    <div class="help-shortcut-item">
                        <kbd>Q</kbd> <kbd>E</kbd>
                        <span>Move down / up along ellipsoid “up” at the camera</span>
                    </div>
                    <div class="help-shortcut-item">
                        <kbd>J</kbd> <kbd>L</kbd> <kbd>I</kbd> <kbd>K</kbd>
                        <span>Look left / right / up / down (hold to turn)</span>
                    </div>
                    <div class="help-shortcut-item">
                        <kbd>Shift</kbd>
                        <span>Hold to boost speed (~2.25×) while moving</span>
                    </div>
                    <div class="help-shortcut-item">
                        <kbd>Esc</kbd>
                        <span>Exit flight mode; if flight is off but the flight panel is open, close the panel</span>
                    </div>
                </div>

                <h4>GIS project (Electron, when initialized)</h4>
                <div class="help-shortcut-list">
                    <div class="help-shortcut-item">
                        <kbd>Ctrl</kbd>+<kbd>O</kbd>
                        <span>Open GIS project folder</span>
                    </div>
                    <div class="help-shortcut-item">
                        <kbd>Ctrl</kbd>+<kbd>N</kbd>
                        <span>Create new GIS project</span>
                    </div>
                </div>

                <h4>Measurement &amp; analysis</h4>
                <div class="help-shortcut-list">
                    <div class="help-shortcut-item">
                        <kbd>Esc</kbd>
                        <span>Cancel radius/circle picking (Ion measure); cancel elevation profile digitizing; exit flight (see above)</span>
                    </div>
                </div>

                <h4>General</h4>
                <div class="help-shortcut-list">
                    <div class="help-shortcut-item">
                        <kbd>Esc</kbd>
                        <span>Close this Help window while it is open</span>
                    </div>
                    <div class="help-shortcut-item">
                        <kbd>F12</kbd>
                        <span>Developer tools (browser / Electron)</span>
                    </div>
                </div>
                <p class="help-note">There is no global <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> camera pan on the globe until <strong>flight mode</strong> is turned on. Flight mode is unavailable in <strong>2D</strong> scene mode — switch to 3D first.</p>
            </div>
        `;
    }

    /**
     * Render Troubleshooting content
     */
    renderTroubleshooting() {
        return `
            <div class="help-section">
                <h3>Troubleshooting</h3>
                <p>Common issues and solutions to help you get the most out of SimplexDM.</p>

                <h4>Application Won't Start</h4>
                <div class="help-issue">
                    <strong>Problem:</strong> Application window doesn't open or crashes immediately.
                    <div class="help-solution">
                        <strong>Solutions:</strong>
                        <ul>
                            <li>Check Node.js version (should be 16.0+)</li>
                            <li>Verify dependencies: <code>npm install</code></li>
                            <li>Check console for errors (F12)</li>
                            <li>Verify CesiumJS is installed in <code>public/lib/cesium/</code></li>
                            <li>Check if port 8000 is available</li>
                        </ul>
                    </div>
                </div>

                <h4>Tileset Won't Load</h4>
                <div class="help-issue">
                    <strong>Problem:</strong> Tileset fails to load or shows errors.
                    <div class="help-solution">
                        <strong>Solutions:</strong>
                        <ul>
                            <li>Verify tileset JSON file is valid</li>
                            <li>Check file paths in tileset JSON (relative vs absolute)</li>
                            <li>Ensure all referenced files exist</li>
                            <li>Check server console for 404 errors</li>
                            <li>Verify file permissions</li>
                            <li>Try using absolute paths in tileset JSON</li>
                        </ul>
                    </div>
                </div>

                <h4>Map Tiles Not Showing</h4>
                <div class="help-issue">
                    <strong>Problem:</strong> Base map tiles don't display.
                    <div class="help-solution">
                        <strong>Solutions:</strong>
                        <ul>
                            <li>Check internet connection (for online tiles)</li>
                            <li>Verify offline tiles exist in <code>data/tiles/</code></li>
                            <li>Check <code>data/tiles/meta.json</code> for correct zoom levels</li>
                            <li>Verify server is serving from <code>data/</code> directory</li>
                            <li>Check browser console for CORS or loading errors</li>
                        </ul>
                    </div>
                </div>

                <h4>Performance Issues</h4>
                <div class="help-issue">
                    <strong>Problem:</strong> Application is slow or laggy.
                    <div class="help-solution">
                        <strong>Solutions:</strong>
                        <ul>
                            <li>Reduce visible layers</li>
                            <li>Lower tile cache size in configuration</li>
                            <li>Use performance monitor to identify bottlenecks</li>
                            <li>Reduce zoom level for large areas</li>
                            <li>Close other applications to free memory</li>
                            <li>Check system requirements (RAM, GPU)</li>
                        </ul>
                    </div>
                </div>

                <h4>Measurements Inaccurate</h4>
                <div class="help-issue">
                    <strong>Problem:</strong> Measurement results are incorrect.
                    <div class="help-solution">
                        <strong>Solutions:</strong>
                        <ul>
                            <li><strong>Zoom in closer</strong> - This is critical for accuracy (10cm precision)</li>
                            <li>Check you're clicking on the model surface</li>
                            <li>Verify measurement tool is active</li>
                            <li>Ensure tileset is fully loaded</li>
                        </ul>
                    </div>
                </div>

                <h4>Measure toolbar missing or “not ready”</h4>
                <div class="help-issue">
                    <strong>Problem:</strong> Ion SDK measurement mixin did not attach or the toolbar stays collapsed.
                    <div class="help-solution">
                        <strong>Solutions:</strong>
                        <ul>
                            <li>Confirm <code>IonSdkMeasurements.js</code> loads before the app bundle and Cesium is available</li>
                            <li>Wait until the tileset has finished streaming initial tiles</li>
                            <li>Click the <strong>Measure</strong> map button to expand the strip (GIS-style default is collapsed)</li>
                        </ul>
                    </div>
                </div>

                <h4>Line of sight / viewshed picks nothing</h4>
                <div class="help-issue">
                    <strong>Problem:</strong> Clicks do not register on the model.
                    <div class="help-solution">
                        <strong>Solutions:</strong>
                        <ul>
                            <li>Ensure <code>viewer.scene.pickPositionSupported</code> is true (depth buffer picks)</li>
                            <li>Zoom to surfaces that have rendered geometry; avoid the sky</li>
                            <li>Turn off conflicting tools that capture the canvas first</li>
                        </ul>
                    </div>
                </div>

                <h4>Fog / depth map look wrong together</h4>
                <div class="help-issue">
                    <strong>Problem:</strong> Atmospheric effect is too strong or toggles fight each other.
                    <div class="help-solution">
                        <strong>Solutions:</strong>
                        <ul>
                            <li>Only one of <strong>Fog</strong> and <strong>Depth map</strong> can be active—they share the same fog settings</li>
                            <li>Tune <code>SceneModes.fog</code> and <code>SceneModes.distance</code> densities in config</li>
                        </ul>
                    </div>
                </div>

                <h4>Flight mode will not start</h4>
                <div class="help-issue">
                    <strong>Problem:</strong> Toggle turns off immediately or a warning says flight is only for 3D.
                    <div class="help-solution">
                        <strong>Solutions:</strong>
                        <ul>
                            <li>Switch the scene to <strong>3D</strong> (Columbus view / 2D mode disables Superman flight)</li>
                            <li>Ensure the viewer has finished initializing and a tileset or globe is active</li>
                            <li>After enabling flight, click the Cesium canvas so it receives keyboard focus</li>
                        </ul>
                    </div>
                </div>

                <h4>Getting More Help</h4>
                <ul>
                    <li>Check the <strong>README.md</strong> file for detailed documentation</li>
                    <li>Review <strong>QUICK_REFERENCE.md</strong> for quick tips</li>
                    <li>Open DevTools (F12) to check console for error messages</li>
                    <li>Check server logs in the terminal</li>
                </ul>
            </div>
        `;
    }

    /**
     * Show help modal
     */
    show() {
        if (this.helpModal) {
            this.helpModal.style.display = 'flex';
            this.isVisible = true;
            
            // Update nav button active state
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            const helpBtn = document.getElementById('helpBtn');
            if (helpBtn) {
                helpBtn.classList.add('active');
            }
        }
    }

    /**
     * Hide help modal
     */
    hide() {
        if (this.helpModal) {
            this.helpModal.style.display = 'none';
            this.isVisible = false;
            
            // Remove active state from nav button
            const helpBtn = document.getElementById('helpBtn');
            if (helpBtn) {
                helpBtn.classList.remove('active');
            }
        }
    }

    /**
     * Toggle help modal
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
    window.helpUI = new HelpUI();
}
