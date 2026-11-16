/**
 * DashboardUI
 * Main dashboard interface with tabs
 */

class DashboardUI {
    constructor() {
        this.pathManager = null;
        this.fileManager = null;
        this.currentTab = 'overview';
        /** @type {boolean} */
        this._loadPathBusy = false;
        this.init();
    }

    _t(path) {
        if (window.appI18n && typeof window.appI18n.t === 'function') {
            const v = window.appI18n.t(path);
            if (v !== path) return v;
        }
        return path;
    }

    _esc(val) {
        return String(val == null ? '' : val)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Font Awesome icon + label (decorative icon: aria-hidden). */
    _dashBtn(label, iconClass, classNames = '', attrs = '') {
        const extra = attrs ? ' ' + attrs.trim() : '';
        return `<button type="button" class="btn btn-dash ${classNames}"${extra}><i class="fas ${iconClass}" aria-hidden="true"></i><span>${label}</span></button>`;
    }

    /**
     * Check that a tileset path can be read (HTTP URL, /file?…, or registered file handle).
     * @param {string} rawPath
     * @returns {Promise<{ ok: boolean, detail?: string }>}
     */
    async _verifyTilesetPathReachable(rawPath) {
        if (!rawPath || typeof rawPath !== 'string') {
            return { ok: false, detail: this._t('dash.enterPath') };
        }
        const trimmed = rawPath.trim();
        if (!trimmed) {
            return { ok: false, detail: this._t('dash.enterPath') };
        }

        const pr = window.pathResolver;
        const timeoutMs = 20000;
        const fetchWithTimeout = async (url) => {
            const ctrl = new AbortController();
            const tid = window.setTimeout(() => ctrl.abort(), timeoutMs);
            try {
                return await fetch(url, { method: 'GET', cache: 'no-store', signal: ctrl.signal });
            } finally {
                window.clearTimeout(tid);
            }
        };

        try {
            if (pr && typeof pr.isHttpUrl === 'function' && pr.isHttpUrl(trimmed)) {
                const res = await fetchWithTimeout(trimmed);
                if (!res.ok) {
                    return { ok: false, detail: `${res.status} ${res.statusText || ''}`.trim() };
                }
                return { ok: true };
            }

            if (!pr || typeof pr.resolvePath !== 'function') {
                return { ok: true };
            }

            let resolved;
            try {
                resolved = await pr.resolvePath(trimmed);
            } catch (e) {
                return { ok: false, detail: e?.message || String(e) };
            }

            if (resolved && typeof resolved === 'object' && resolved.type === 'fileHandle' && resolved.handle) {
                try {
                    await resolved.handle.getFile();
                    return { ok: true };
                } catch (e) {
                    return { ok: false, detail: e?.message || String(e) };
                }
            }

            const url = typeof resolved === 'string' ? resolved : null;
            if (!url) {
                return { ok: false, detail: this._t('dash.couldNotResolve') };
            }

            const res = await fetchWithTimeout(url);
            if (!res.ok) {
                return { ok: false, detail: `${res.status} ${res.statusText || ''}`.trim() };
            }
            return { ok: true };
        } catch (e) {
            if (e && e.name === 'AbortError') {
                return { ok: false, detail: this._t('dash.pathVerifyTimeout') };
            }
            return { ok: false, detail: e?.message || String(e) };
        }
    }

    /**
     * Initialize dashboard UI
     */
    init() {
        this.pathManager = window.pathManager;
        this.fileManager = window.fileManager;
        this.setupEventHandlers();
        if (!this._localeBound) {
            this._localeBound = true;
            window.addEventListener('simplex:localeChanged', () => {
                const modal = document.getElementById('dashboardModal');
                if (modal && modal.style.display !== 'none') {
                    this.refresh();
                }
            });
        }
    }

    /**
     * Set up event handlers
     */
    setupEventHandlers() {
        // Tab switching is handled by App module
        // Add specific dashboard handlers here
    }

    /**
     * Refresh dashboard content
     */
    refresh() {
        // Get current active tab from UI
        const activeTabBtn = document.querySelector('.dashboard-tab-btn.active');
        if (activeTabBtn) {
            this.currentTab = activeTabBtn.dataset.tab || 'overview';
        }
        
        switch (this.currentTab) {
            case 'overview':
                this.renderOverview();
                break;
            case 'paths':
                this.renderPaths();
                break;
            case 'files':
                this.renderFiles();
                break;
            case 'jsonTree':
                this.renderJsonTree();
                break;
            case 'settings':
                this.renderSettings();
                break;
        }
    }
    
    /**
     * Set current tab
     */
    setCurrentTab(tabName) {
        this.currentTab = tabName;
        this.refresh();
    }

    /**
     * Render overview tab - Meridian Style
     */
    renderOverview() {
        const container = document.getElementById('dashboardOverviewTab');
        if (!container) return;

        const paths = this.pathManager ? this.pathManager.getAllPaths() : [];
        const enabledPaths = this.pathManager ? this.pathManager.getEnabledPaths() : [];
        const tilesets = window.displayControl ? window.displayControl.getAllTilesets() : [];
        const features = window.featureManager ? window.featureManager.getAllFeatures() : [];

        const t = (k) => this._t('dash.' + k);
        const stat = (icon, value, caption) => `
            <div class="stat-card">
                <div class="stat-card-icon" aria-hidden="true"><i class="fas ${icon}"></i></div>
                <div class="stat-card-body">
                    <h3>${value}</h3>
                    <p>${caption}</p>
                </div>
            </div>`;
        container.innerHTML = `
            <div class="dashboard-overview">
            <div class="statistics-grid">
                ${stat('fa-folder-tree', paths.length, t('totalPaths'))}
                ${stat('fa-check-circle', enabledPaths.length, t('enabledPaths'))}
                ${stat('fa-cubes', tilesets.length, t('loadedTilesets'))}
                ${stat('fa-draw-polygon', features.length, t('totalFeatures'))}
            </div>
            <div class="quick-actions">
                ${this._dashBtn(t('addPath'), 'fa-plus-circle', 'btn-primary', 'id="dashboardAddPathBtn"')}
                ${this._dashBtn(t('loadSampleCampus') === 'dash.loadSampleCampus' ? (window.appI18n?.getLang?.() === 'ar' ? 'نموذج الحرم ثلاثي الأبعاد' : 'Sample 3D Campus') : t('loadSampleCampus'), 'fa-city', 'btn-primary', 'id="dashboardLoadSampleBtn"')}
                ${this._dashBtn(t('uploadFile'), 'fa-cloud-upload-alt', '', 'id="dashboardUploadFileBtn"')}
                ${this._dashBtn(t('openJsonEditor') === 'dash.openJsonEditor' ? (window.appI18n?.getLang?.() === 'ar' ? 'محرر JSON' : 'JSON Editor') : t('openJsonEditor'), 'fa-file-code', '', 'id="dashboardJsonEditorBtn"')}
                ${this._dashBtn(t('importPaths'), 'fa-file-import', '', 'id="dashboardImportPathsBtn"')}
                ${this._dashBtn(t('exportPaths'), 'fa-file-export', '', 'id="dashboardExportPathsBtn"')}
                ${this._dashBtn(t('processLastTiles'), 'fa-microscope', 'btn-primary', `id="dashboardProcessLastTilesBtn" title="${this._esc(t('processLastTilesTitle'))}"`)}
            </div>
            <section class="dashboard-section recent-paths">
                <h3 class="dashboard-section-title"><i class="fas fa-history" aria-hidden="true"></i><span>${t('recentPaths')}</span></h3>
                <div class="path-list path-list--panel">
                    ${paths.length === 0 ?
                        `<p class="dashboard-empty"><i class="fas fa-inbox" aria-hidden="true"></i><span>${t('noPaths')}</span></p>` :
                        paths.slice(0, 5).map(path => `
                            <div class="path-item">
                                <div class="path-item-info">
                                    <div class="path-item-name">
                                        ${this._esc(path.name)}
                                        ${path.enabled !== false ? `<span class="path-status path-status--on" title="${this._esc(t('enabled'))}"><i class="fas fa-check-circle" aria-hidden="true"></i><span class="visually-hidden">${this._esc(t('enabled'))}</span></span>` : `<span class="path-status path-status--off" title="${this._esc(t('disabled'))}"><i class="far fa-circle" aria-hidden="true"></i><span class="visually-hidden">${this._esc(t('disabled'))}</span></span>`}
                                    </div>
                                    <div class="path-item-path"><i class="fas fa-link" aria-hidden="true"></i><span class="path-item-path-text">${this._esc(path.path)}</span></div>
                                    <div class="path-meta"><i class="fas fa-tag" aria-hidden="true"></i><span>${this._esc(t('pathMetaType'))} ${this._esc(path.type)}</span></div>
                                </div>
                                <div class="path-item-actions">
                                    ${this._dashBtn(t('load'), 'fa-play-circle', '', `data-load-path-id="${this._esc(path.id)}"`)}
                                </div>
                            </div>
                        `).join('')
                    }
                </div>
            </section>
            <section class="dashboard-section last-two-tiles-section">
                <h3 class="dashboard-section-title"><i class="fas fa-layer-group" aria-hidden="true"></i><span>${t('lastTwoTiles')}</span></h3>
                <p class="dashboard-lead">${t('lastTwoLead')}</p>
                ${this._dashBtn(t('refreshLastTwo'), 'fa-sync-alt', 'btn-primary', `id="dashboardRefreshLastTwoTilesBtn" title="${String(t('refreshLastTwoTitle')).replace(/"/g, '&quot;')}"`)}
                <div id="lastTwoTilesContainer" class="last-tiles-container dashboard-panel">
                    <p class="dashboard-empty"><i class="fas fa-map" aria-hidden="true"></i><span>${t('lastTwoEmpty')}</span></p>
                </div>
            </section>
            </div>
        `;

        // Set up event handlers
        document.getElementById('dashboardRefreshLastTwoTilesBtn')?.addEventListener('click', () => {
            this.refreshLastTwoTiles();
        });
        document.getElementById('dashboardAddPathBtn')?.addEventListener('click', () => {
            // Switch to Paths tab and show add form
            if (window.app) {
                window.app.switchDashboardTab('paths');
            }
            setTimeout(() => {
                const pathInput = document.getElementById('newPathInput');
                if (pathInput) {
                    pathInput.focus();
                }
            }, 100);
        });
        document.getElementById('dashboardUploadFileBtn')?.addEventListener('click', () => {
            // Switch to Files tab
            if (window.app) {
                window.app.switchDashboardTab('files');
            }
            setTimeout(() => {
                const selectBtn = document.getElementById('selectDirectoryBtn');
                if (selectBtn) {
                    selectBtn.click();
                }
            }, 100);
        });
        document.getElementById('dashboardImportPathsBtn')?.addEventListener('click', () => {
            this.importPaths();
        });
        document.getElementById('dashboardExportPathsBtn')?.addEventListener('click', () => {
            this.exportPaths();
        });
        document.getElementById('dashboardProcessLastTilesBtn')?.addEventListener('click', () => {
            this.processLastTilesWithHighAccuracy();
        });
        document.getElementById('dashboardLoadSampleBtn')?.addEventListener('click', async () => {
            const sampleUrl = '/data/samples/meridian-campus/tileset.json';
            if (window.app?.loadSampleTileset) {
                await window.app.loadSampleTileset();
            } else if (window.tilesetViewer?.loadTileset) {
                await window.tilesetViewer.loadTileset(sampleUrl, { title: 'Meridian Campus (Sample)', flyTo: true });
                window.app?.closeDashboard?.();
            }
        });
        document.getElementById('dashboardJsonEditorBtn')?.addEventListener('click', () => {
            if (window.fileEditor?.show) {
                window.fileEditor.show();
            } else {
                document.getElementById('openJsonEditorBtn')?.click();
            }
        });
        container.querySelectorAll('[data-load-path-id]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const pid = btn.getAttribute('data-load-path-id');
                if (pid) this.loadPath(pid);
            });
        });
    }

    /**
     * Render paths tab
     */
    renderPaths() {
        const container = document.getElementById('dashboardPathsTab');
        if (!container) return;

        const paths = this.pathManager ? this.pathManager.getAllPaths() : [];

        const t = (k) => this._t('dash.' + k);
        container.innerHTML = `
            <div class="dashboard-paths-layout">
            <div class="path-form dashboard-panel dashboard-panel--form">
                <h3 class="dashboard-panel-title"><i class="fas fa-plus-circle" aria-hidden="true"></i><span>${t('addNewPath')}</span></h3>
                <div class="form-group">
                    <label class="dashboard-label" for="newPathInput"><i class="fas fa-link" aria-hidden="true"></i><span>${t('pathLabel')}</span></label>
                    <textarea id="newPathInput" class="text-input dashboard-path-textarea" rows="5" spellcheck="false" placeholder="${t('pathPlaceholder')}"></textarea>
                </div>
                <div class="form-group">
                    <label class="dashboard-label" for="newPathType"><i class="fas fa-tag" aria-hidden="true"></i><span>${t('typeLabel')}</span></label>
                    <select id="newPathType" class="select-input">
                        <option value="tileset">${t('typeTileset')}</option>
                        <option value="config">${t('typeConfig')}</option>
                        <option value="data">${t('typeData')}</option>
                        <option value="other">${t('typeOther')}</option>
                    </select>
                </div>
                <div class="form-actions">
                    ${this._dashBtn(t('addPathBtn'), 'fa-save', 'btn-primary', 'id="savePathBtn"')}
                    ${this._dashBtn(t('browse'), 'fa-folder-open', '', 'id="browsePathBtn"')}
                </div>
            </div>
            <div class="path-list dashboard-panel">
                <h3 class="dashboard-panel-title"><i class="fas fa-bookmark" aria-hidden="true"></i><span>${t('savedPathsWithCount').replace(/\{count\}/g, String(paths.length))}</span></h3>
                ${paths.map(path => `
                    <div class="path-item">
                        <div class="path-item-info">
                            <div class="path-item-name">
                                ${path.name}
                                ${path.enabled !== false ? `<span class="path-status path-status--on" title="${t('enabled')}"><i class="fas fa-check-circle" aria-hidden="true"></i><span class="visually-hidden">${t('enabled')}</span></span>` : `<span class="path-status path-status--off" title="${t('disabled')}"><i class="far fa-circle" aria-hidden="true"></i><span class="visually-hidden">${t('disabled')}</span></span>`}
                            </div>
                            <div class="path-item-path"><i class="fas fa-file" aria-hidden="true"></i><span class="path-item-path-text">${path.path}</span></div>
                            <div class="path-meta"><i class="fas fa-tag" aria-hidden="true"></i><span>${t('pathMetaType')} ${path.type}</span></div>
                        </div>
                        <div class="path-item-actions">
                            ${this._dashBtn(path.enabled !== false ? t('disableVerb') : t('enableVerb'), path.enabled !== false ? 'fa-eye-slash' : 'fa-eye', '', `onclick="window.dashboardUI.togglePath('${path.id}')"`)}
                            ${this._dashBtn(t('load'), 'fa-play-circle', '', `onclick="window.dashboardUI.loadPath('${path.id}')"`)}
                            ${this._dashBtn(t('delete'), 'fa-trash-alt', 'btn-danger', `onclick="window.dashboardUI.deletePath('${path.id}')"`)}
                        </div>
                    </div>
                `).join('')}
            </div>
            </div>
        `;

        // Set up event handlers
        document.getElementById('savePathBtn')?.addEventListener('click', () => {
            this.addPath();
        });
        document.getElementById('browsePathBtn')?.addEventListener('click', () => {
            this.browsePath();
        });
    }

    /**
     * Render files tab - Meridian Style
     */
    renderFiles() {
        const container = document.getElementById('dashboardFilesTab');
        if (!container) return;

        const t = (k) => this._t('dash.' + k);
        container.innerHTML = `
            <div class="file-browser">
                <div class="file-tree dashboard-panel">
                    <h4 class="dashboard-subhead"><i class="fas fa-folder-tree" aria-hidden="true"></i><span>${t('fileBrowser')}</span></h4>
                    ${this._dashBtn(t('selectDirectory'), 'fa-folder-plus', 'btn-primary file-browser-select-btn', 'id="selectDirectoryBtn"')}
                    <div id="fileTreeList" class="file-tree-list">
                        <p class="dashboard-empty"><i class="fas fa-folder" aria-hidden="true"></i><span>${t('selectDirEmpty')}</span></p>
                    </div>
                </div>
                <div class="file-editor-container dashboard-panel">
                    <div class="file-editor-toolbar">
                        ${this._dashBtn(t('save'), 'fa-save', '', 'id="saveFileBtn" disabled')}
                        ${this._dashBtn(t('formatJson'), 'fa-magic', '', 'id="formatJsonBtn" disabled')}
                        ${this._dashBtn(t('validateJson'), 'fa-check-double', '', 'id="validateJsonBtn" disabled')}
                        <span id="fileNameDisplay" class="file-name-display" aria-live="polite"></span>
                    </div>
                    <textarea id="fileEditor" class="file-editor" placeholder="${t('fileEditorPlaceholder')}"></textarea>
                </div>
            </div>
        `;

        // Set up event handlers
        document.getElementById('selectDirectoryBtn')?.addEventListener('click', () => {
            this.selectDirectory();
        });
        document.getElementById('saveFileBtn')?.addEventListener('click', () => {
            this.saveFile();
        });
        document.getElementById('formatJsonBtn')?.addEventListener('click', () => {
            this.formatJson();
        });
        document.getElementById('validateJsonBtn')?.addEventListener('click', () => {
            this.validateJson();
        });
    }

    /**
     * Render JSON Tree tab - Meridian Style
     */
    renderJsonTree() {
        const container = document.getElementById('dashboardJsonTreeTab');
        if (!container) return;

        // Get available tilesets
        const tilesets = window.displayControl ? window.displayControl.getAllTilesets() : [];
        const paths = this.pathManager ? this.pathManager.getPathsByType('tileset') : [];
        
        const t = (k) => this._t('dash.' + k);
        let optionsHTML = `<option value="">${t('selectTileset')}</option>`;
        tilesets.forEach(tileset => {
            const name = tileset.url.split('/').pop() || tileset.url;
            optionsHTML += `<option value="${tileset.url}">${name}</option>`;
        });
        paths.forEach(path => {
            if (!tilesets.some(t => t.url === path.path)) {
                optionsHTML += `<option value="${path.path}">${path.name}</option>`;
            }
        });

        container.innerHTML = `
            <div class="json-tree-container dashboard-json-tree-wrap">
                <div class="tileset-selector-row dashboard-panel">
                    <i class="fas fa-cube tileset-selector-icon" aria-hidden="true"></i>
                    <div class="tileset-selector-actions">
                    <select id="dashboardTilesetSelector" class="select-input tileset-selector-input" aria-label="${String(t('selectTileset')).replace(/"/g, '&quot;')}">
                        ${optionsHTML}
                    </select>
                    ${this._dashBtn(t('loadJson'), 'fa-project-diagram', 'btn-primary', 'id="loadJsonTreeBtn"')}
                    </div>
                </div>
                <div id="dashboardJsonTree" class="json-tree dashboard-panel json-tree-view"></div>
                <div class="json-tree-controls-panel" id="dashboardJsonTreeControls"></div>
            </div>
        `;

        // Set up event handler
        document.getElementById('loadJsonTreeBtn')?.addEventListener('click', () => {
            this.loadJsonTree();
        });
    }

    /**
     * Render settings tab - Meridian Style
     */
    renderSettings() {
        const container = document.getElementById('dashboardSettingsTab');
        if (!container) return;

        // Load saved settings
        const savedSettings = localStorage.getItem('appSettings');
        const settings = savedSettings ? JSON.parse(savedSettings) : {
            dataDirectory: '',
            autoLoadEnabled: false,
            showNotifications: true,
            autoSavePaths: true,
            defaultQuality: 'medium',
            memoryLimit: 256
        };

        const t = (k) => this._t('dash.' + k);
        container.innerHTML = `
            <div class="dashboard-settings-grid">
            <div class="settings-section dashboard-panel">
                <h3 class="dashboard-panel-title"><i class="fas fa-cog" aria-hidden="true"></i><span>${t('appSettingsTitle')}</span></h3>
                <div class="setting-item setting-item--row">
                    <label class="setting-label"><i class="fas fa-database" aria-hidden="true"></i><span>${t('dataDirectory')}</span></label>
                    <div class="setting-inline">
                        <input type="text" id="dataDirectoryInput" class="text-input setting-input-grow" 
                               placeholder="${t('selectDataDirPlaceholder')}" value="${settings.dataDirectory || ''}">
                        ${this._dashBtn(t('browseDots'), 'fa-folder-open', '', 'id="selectDataDirectoryBtn"')}
                    </div>
                </div>
                <div class="setting-item">
                    <label class="dashboard-check">
                        <input type="checkbox" id="autoLoadEnabledToggle" ${settings.autoLoadEnabled ? 'checked' : ''}>
                        <i class="fas fa-bolt" aria-hidden="true"></i>
                        <span>${t('autoLoadTilesets')}</span>
                    </label>
                </div>
                <div class="setting-item">
                    <label class="dashboard-check">
                        <input type="checkbox" id="showNotificationsToggle" ${settings.showNotifications !== false ? 'checked' : ''}>
                        <i class="fas fa-bell" aria-hidden="true"></i>
                        <span>${t('showNotifications')}</span>
                    </label>
                </div>
                <div class="setting-item">
                    <label class="dashboard-check">
                        <input type="checkbox" id="autoSavePathsToggle" ${settings.autoSavePaths !== false ? 'checked' : ''}>
                        <i class="fas fa-save" aria-hidden="true"></i>
                        <span>${t('autoSavePaths')}</span>
                    </label>
                </div>
            </div>
            <div class="settings-section dashboard-panel">
                <h3 class="dashboard-panel-title"><i class="fas fa-tachometer-alt" aria-hidden="true"></i><span>${t('qualityTitle')}</span></h3>
                <div class="setting-item setting-item--row">
                    <label class="setting-label"><i class="fas fa-sliders-h" aria-hidden="true"></i><span>${t('defaultQuality')}</span></label>
                    <select id="defaultQualitySelect" class="select-input setting-input-fixed">
                        <option value="low" ${settings.defaultQuality === 'low' ? 'selected' : ''}>${t('low')}</option>
                        <option value="medium" ${settings.defaultQuality === 'medium' ? 'selected' : ''}>${t('medium')}</option>
                        <option value="high" ${settings.defaultQuality === 'high' ? 'selected' : ''}>${t('high')}</option>
                        <option value="ultra" ${settings.defaultQuality === 'ultra' ? 'selected' : ''}>${t('ultra')}</option>
                    </select>
                </div>
                <div class="setting-item setting-item--row">
                    <label class="setting-label"><i class="fas fa-memory" aria-hidden="true"></i><span>${t('memoryLimitMb')}</span></label>
                    <input type="number" id="memoryLimitInput" class="number-input setting-input-fixed" 
                           value="${settings.memoryLimit || 256}" min="64" max="2048">
                </div>
            </div>
            <div class="settings-section dashboard-panel settings-section--save">
                <div class="setting-item">
                    ${this._dashBtn(t('saveSettings'), 'fa-check-circle', 'btn-primary btn-block', 'id="saveSettingsBtn"')}
                </div>
            </div>
            </div>
        `;

        // Set up event handlers
        document.getElementById('selectDataDirectoryBtn')?.addEventListener('click', () => {
            this.selectDataDirectory();
        });
        
        document.getElementById('saveSettingsBtn')?.addEventListener('click', () => {
            this.saveSettings();
        });
        
        // Auto-save on change
        ['autoLoadEnabledToggle', 'showNotificationsToggle', 'autoSavePathsToggle', 
         'defaultQualitySelect', 'memoryLimitInput'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    if (document.getElementById('autoSavePathsToggle')?.checked) {
                        this.saveSettings();
                    }
                });
            }
        });
    }
    
    /**
     * Save settings
     */
    saveSettings() {
        const settings = {
            dataDirectory: document.getElementById('dataDirectoryInput')?.value || '',
            autoLoadEnabled: document.getElementById('autoLoadEnabledToggle')?.checked || false,
            showNotifications: document.getElementById('showNotificationsToggle')?.checked !== false,
            autoSavePaths: document.getElementById('autoSavePathsToggle')?.checked !== false,
            defaultQuality: document.getElementById('defaultQualitySelect')?.value || 'medium',
            memoryLimit: parseInt(document.getElementById('memoryLimitInput')?.value || 256)
        };
        
        localStorage.setItem('appSettings', JSON.stringify(settings));

        if (window.appSettingsFramework && typeof window.appSettingsFramework.applyAfterAppSettingsChange === 'function') {
            window.appSettingsFramework.applyAfterAppSettingsChange();
        } else if (window.displayControl && settings.defaultQuality) {
            window.displayControl.setDefaultQuality(settings.defaultQuality);
        }

        window.notification?.success(this._t('dash.settingsSaved'));
    }

    /**
     * Add path
     */
    async addPath() {
        const pathInput = document.getElementById('newPathInput');
        const typeSelect = document.getElementById('newPathType');
        
        if (!pathInput || !typeSelect) return;

        const path = pathInput.value.trim();
        const type = typeSelect.value;

        if (!path) {
            window.notification?.warning(this._t('dash.enterPath'));
            return;
        }

        try {
            await this.pathManager.addPath(path, type);
            window.notification?.success(this._t('dash.pathAdded'));
            this.renderPaths();
            pathInput.value = '';
            
            // Refresh display control selector
            if (window.displayControlUI) {
                window.displayControlUI.refreshSelector();
            }
        } catch (error) {
            window.notification?.error(this._t('dash.pathAddFailed') + error.message);
        }
    }

    /**
     * Browse for path
     */
    async browsePath() {
        try {
            const fileHandle = await this.fileManager.selectFile();
            if (fileHandle) {
                const pathInput = document.getElementById('newPathInput');
                if (pathInput) {
                    pathInput.value = fileHandle.name;
                }
            }
        } catch (error) {
            window.notification?.error(this._t('dash.browseFileFailed') + error.message);
        }
    }

    /**
     * Toggle path
     */
    async togglePath(id) {
        try {
            await this.pathManager.togglePath(id);
            this.renderPaths();
        } catch (error) {
            window.notification?.error(this._t('dash.togglePathFailed') + error.message);
        }
    }

    /**
     * Delete path
     */
    async deletePath(id) {
        const confirmed = await window.notification?.confirm(this._t('dash.deletePathConfirm'));
        if (confirmed === 'ok') {
            try {
                await this.pathManager.deletePath(id);
                window.notification?.success(this._t('dash.pathDeleted'));
                this.renderPaths();
            } catch (error) {
                window.notification?.error(this._t('dash.deletePathFailed') + error.message);
            }
        }
    }

    /**
     * Load path
     */
    async loadPath(id) {
        if (this._loadPathBusy) {
            return;
        }
        const path = this.pathManager.getPath(id);
        if (!path) return;

        this._loadPathBusy = true;
        try {
            if (path.type === 'tileset') {
                const check = await this._verifyTilesetPathReachable(path.path);
                if (!check.ok) {
                    const extra = check.detail ? ` ${check.detail}` : '';
                    window.notification?.error(this._t('dash.pathNotReachable') + extra);
                    return;
                }
                if (window.displayControl) {
                    await window.displayControl.loadTileset(path.path);
                } else if (window.tilesetViewer) {
                    await window.tilesetViewer.loadTileset(path.path);
                } else {
                    window.notification?.error(this._t('dash.dcNotAvailable'));
                    return;
                }
                if (window.app && typeof window.app.hideDashboard === 'function') {
                    window.app.hideDashboard();
                }
            }
        } catch (error) {
            const errorMessage = error?.message || error?.toString() || 'Unknown error';
            window.notification?.error(this._t('dash.loadTilesetFailed') + errorMessage);
            console.error('Load path error:', error);
        } finally {
            this._loadPathBusy = false;
        }
    }

    /**
     * Import paths
     */
    async importPaths() {
        // Create file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                await this.pathManager.importPaths(text);
                window.notification?.success(this._t('dash.pathsImported'));
                this.renderPaths();
            } catch (error) {
                window.notification?.error(this._t('dash.importPathsFailed') + error.message);
            }
        };
        input.click();
    }

    /**
     * Export paths
     */
    exportPaths() {
        try {
            const json = this.pathManager.exportPaths();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'meridian_paths.json';
            a.click();
            URL.revokeObjectURL(url);
            window.notification?.success(this._t('dash.pathsExported'));
        } catch (error) {
            window.notification?.error(this._t('dash.exportPathsFailed') + error.message);
        }
    }

    /**
     * Upload file
     */
    async uploadFile() {
        window.notification?.info(this._t('dash.uploadNotImplemented'));
    }

    /**
     * Select directory
     */
    async selectDirectory() {
        try {
            const dirHandle = await this.fileManager.selectDirectory();
            if (dirHandle) {
                await this.listFiles(dirHandle);
            }
        } catch (error) {
            window.notification?.error(this._t('dash.selectDirFailed') + error.message);
        }
    }

    /**
     * List files in directory
     */
    async listFiles(dirHandle) {
        try {
            const { files, directories } = await this.fileManager.listFiles(dirHandle);
            const list = document.getElementById('fileTreeList');
            if (!list) return;

            let html = '';
            directories.forEach(dir => {
                html += `<div class="file-tree-item" data-type="directory" data-name="${dir.name}">📁 ${dir.name}</div>`;
            });
            files.forEach(file => {
                html += `<div class="file-tree-item" data-type="file" data-name="${file.name}">📄 ${file.name}</div>`;
            });

            list.innerHTML = html;

            // Set up click handlers
            list.querySelectorAll('.file-tree-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const type = item.dataset.type;
                    const name = item.dataset.name;
                    if (type === 'file') {
                        await this.openFile(name, dirHandle);
                    }
                });
            });
        } catch (error) {
            window.notification?.error(this._t('dash.listFilesFailed') + error.message);
        }
    }

    /**
     * Open file
     */
    async openFile(filename, dirHandle) {
        try {
            const fileHandle = await dirHandle.getFileHandle(filename);
            const content = await this.fileManager.readFile(fileHandle);
            
            const editor = document.getElementById('fileEditor');
            const fileNameDisplay = document.getElementById('fileNameDisplay');
            const saveBtn = document.getElementById('saveFileBtn');
            const formatBtn = document.getElementById('formatJsonBtn');
            const validateBtn = document.getElementById('validateJsonBtn');

            if (editor) editor.value = content;
            if (fileNameDisplay) fileNameDisplay.textContent = filename;
            if (saveBtn) saveBtn.disabled = false;
            
            const isJson = this.fileManager.isJsonFile(filename);
            if (formatBtn) formatBtn.disabled = !isJson;
            if (validateBtn) validateBtn.disabled = !isJson;

            // Store current file handle
            this.currentFileHandle = fileHandle;
        } catch (error) {
            window.notification?.error(this._t('dash.openFileFailed') + error.message);
        }
    }

    /**
     * Save file
     */
    async saveFile() {
        const editor = document.getElementById('fileEditor');
        if (!editor || !this.currentFileHandle) return;

        try {
            await this.fileManager.writeFile(this.currentFileHandle, editor.value);
            window.notification?.success(this._t('dash.fileSaved'));
        } catch (error) {
            window.notification?.error(this._t('dash.saveFileFailed') + error.message);
        }
    }

    /**
     * Format JSON
     */
    formatJson() {
        const editor = document.getElementById('fileEditor');
        if (!editor) return;

        try {
            const formatted = window.fileEditor.formatJSON(editor.value);
            editor.value = formatted;
            window.notification?.success(this._t('dash.jsonFormattedOk'));
        } catch (error) {
            window.notification?.error(this._t('dash.formatJsonFailed') + error.message);
        }
    }

    /**
     * Validate JSON
     */
    validateJson() {
        const editor = document.getElementById('fileEditor');
        if (!editor) return;

        const result = window.fileEditor.validateJSON(editor.value);
        if (result.valid) {
            window.notification?.success(this._t('dash.jsonValidOk'));
        } else {
            window.notification?.error(this._t('dash.jsonInvalidMsg') + result.error);
        }
    }

    /**
     * Load JSON tree
     */
    async loadJsonTree() {
        try {
            if (!window.jsonTreeExplorer) return;

            const fromViewer =
                window.displayControl &&
                window.displayControl.getAllTilesets().map((t) => t.url).filter(Boolean);

            if (fromViewer && fromViewer.length > 0) {
                if (fromViewer.length > 1) {
                    await window.jsonTreeExplorer.loadAllFromUrls(fromViewer);
                } else {
                    await window.jsonTreeExplorer.loadJSON(fromViewer[0]);
                }
            } else {
                const selector = document.getElementById('dashboardTilesetSelector');
                const url = selector?.value;
                if (!url) {
                    window.notification?.warning(this._t('dash.selectTilesetOrLoad'));
                    return;
                }
                await window.jsonTreeExplorer.loadJSON(url);
            }

            const container = document.getElementById('dashboardJsonTree');
            if (container) {
                window.jsonTreeExplorer.setContainer(container);
                window.jsonTreeExplorer.render();
            }
        } catch (error) {
            window.notification?.error(this._t('dash.jsonTreeLoadFailed') + error.message);
        }
    }

    /**
     * Process last tiles with ultra-high accuracy
     */
    async processLastTilesWithHighAccuracy() {
        try {
            if (!window.displayControl) {
                window.notification?.error(this._t('dash.dcNotAvailable'));
                return;
            }

            // Get current loaded tilesets
            const tilesets = window.displayControl.getAllTilesets();
            if (tilesets.length === 0) {
                window.notification?.warning(this._t('dash.loadTilesetFirst'));
                return;
            }

            window.notification?.info(this._t('dash.processingLastTilesMsg'));

            // Use DisplayControl's method to process last tiles
            const results = await window.displayControl.processLastTilesWithHighAccuracy();

            // Show results
            const successCount = results.filter(r => !r.error).length;
            const totalLastTiles = results.reduce((sum, r) => sum + (r.lastTiles?.count || 0), 0);
            const maxDepth = Math.max(...results.map(r => r.lastTiles?.maxDepth || 0).filter(d => d > 0));
            
            if (successCount > 0) {
                const msg = this._t('dash.processLastTilesSuccess')
                    .replace(/\{successCount\}/g, String(successCount))
                    .replace(/\{totalTiles\}/g, String(totalLastTiles))
                    .replace(/\{depth\}/g, String(maxDepth));
                window.notification?.success(msg);
            } else {
                window.notification?.warning(this._t('dash.noTilesetsProcessed'));
            }

            console.log('Last tiles processing results:', results);
            
            // Refresh display and last-two-tiles section
            if (window.displayControlUI) {
                window.displayControlUI.refresh();
            }
            this.refreshLastTwoTiles();
        } catch (error) {
            window.notification?.error(this._t('dash.processLastTilesFailed') + error.message);
            console.error('Process last tiles error:', error);
        }
    }

    /**
     * WGS84 decimal places for high-precision copy/paste (sub-meter when pasted as lat, lon).
     */
    static get COORD_DECIMALS() {
        return 8;
    }

    /**
     * Refresh and display the very end and second-to-last leaf tiles with 100% accuracy.
     * Coordinates use 8 decimal places for consistent interchange with external GIS tools.
     */
    async refreshLastTwoTiles() {
        const container = document.getElementById('lastTwoTilesContainer');
        if (!container) return;

        try {
            if (!window.displayControl) {
                container.innerHTML = `<p class="dashboard-status dashboard-status--muted"><i class="fas fa-info-circle" aria-hidden="true"></i><span>${this._t('dash.dcNotAvailable')}</span></p>`;
                return;
            }
            const tilesets = window.displayControl.getAllTilesets();
            if (tilesets.length === 0) {
                container.innerHTML = `<p class="dashboard-status dashboard-status--muted"><i class="fas fa-map-marked-alt" aria-hidden="true"></i><span>${this._t('dash.loadTilesetFirst')}</span></p>`;
                return;
            }

            container.innerHTML = `<p class="dashboard-status dashboard-status--loading"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>${this._t('dash.loadingTiles')}</span></p>`;
            const tilesetInfo = tilesets[0];
            const resolvedUrl = window.pathResolver ? await window.pathResolver.resolvePath(tilesetInfo.url) : tilesetInfo.url;
            if (!resolvedUrl) {
                container.innerHTML = `<p class="dashboard-status dashboard-status--error"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i><span>${this._t('dash.couldNotResolve')}</span></p>`;
                return;
            }

            let tilesetJson;
            if (resolvedUrl && typeof resolvedUrl === 'object' && resolvedUrl.type === 'fileHandle' && resolvedUrl.handle) {
                const fileObj = await resolvedUrl.handle.getFile();
                tilesetJson = JSON.parse(await fileObj.text());
            } else {
                const response = await fetch(resolvedUrl);
                if (!response.ok) {
                    container.innerHTML = `<p class="dashboard-status dashboard-status--error"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i><span>${this._t('dash.failedLoadJson')}${response.status}</span></p>`;
                    return;
                }
                tilesetJson = await response.json();
            }
            // Get last two leaf tiles - use processLastTilesWithHighAccuracy if available
            let lastTwo = [];
            if (window.tilesetProcessor) {
                if (window.tilesetProcessor.getLastTwoLeafTiles) {
                    lastTwo = window.tilesetProcessor.getLastTwoLeafTiles(tilesetJson);
                } else if (window.tilesetProcessor.processLastTilesWithHighAccuracy) {
                    // Fallback: processLastTilesWithHighAccuracy returns last tiles info
                    try {
                        const result = await window.tilesetProcessor.processLastTilesWithHighAccuracy(tilesetJson, null);
                        if (result && result.lastTiles) {
                            lastTwo = Array.isArray(result.lastTiles) ? result.lastTiles.slice(-2) : [];
                        }
                    } catch (error) {
                        console.debug('Could not get last tiles:', error);
                    }
                }
            }
            const decimals = DashboardUI.COORD_DECIMALS;

            if (lastTwo.length === 0) {
                container.innerHTML = `<p class="dashboard-status dashboard-status--muted"><i class="fas fa-vector-square" aria-hidden="true"></i><span>${this._t('dash.noLeafTiles')}</span></p>`;
                return;
            }

            const labels =
                lastTwo.length === 2
                    ? [this._t('dash.tileSecondToLast'), this._t('dash.tileVeryEnd')]
                    : [this._t('dash.tileVeryEnd')];
            let html = '';
            lastTwo.forEach((item, index) => {
                const label = labels[index];
                const c = item.centerWGS84;
                const lat = c ? c.lat.toFixed(decimals) : '--';
                const lon = c ? c.lon.toFixed(decimals) : '--';
                const height = c ? c.height.toFixed(2) : '--';
                const latLonCopy = c ? `${c.lat.toFixed(decimals)}, ${c.lon.toFixed(decimals)}` : '';
                const uri = item.contentUri || this._t('dash.noContentUri');
                html += `
                    <div class="last-tile-card">
                        <div class="last-tile-card-label">${label}</div>
                        <div class="last-tile-card-uri">${uri}</div>
                        <div class="last-tile-card-coords">
                            <div>${this._t('dash.latShort')} ${lat} &nbsp; ${this._t('dash.lonShort')} ${lon}</div>
                            <div>${this._t('dash.heightShort')} ${height} m</div>
                        </div>
                        ${latLonCopy ? this._dashBtn(this._t('dash.copyLatLonDecimal'), 'fa-copy', 'btn-primary btn-sm copy-latlon-btn', `data-copy="${latLonCopy.replace(/"/g, '&quot;')}"`) : ''}
                    </div>
                `;
            });
            container.innerHTML = html;

            container.querySelectorAll('.copy-latlon-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const text = btn.getAttribute('data-copy');
                    if (!text) return;
                    try {
                        await navigator.clipboard.writeText(text);
                        if (window.notification) window.notification.success(this._t('dash.copiedLatLon'));
                    } catch (e) {
                        if (window.notification) window.notification.error(this._t('dash.copyFailed'));
                    }
                });
            });
        } catch (error) {
            container.innerHTML = `<p class="dashboard-status dashboard-status--error"><i class="fas fa-exclamation-circle" aria-hidden="true"></i><span>${this._t('dash.errorPrefix')}${error.message}</span></p>`;
            console.error('refreshLastTwoTiles error:', error);
        }
    }

    /**
     * Select data directory
     */
    async selectDataDirectory() {
        try {
            const dirHandle = await this.fileManager.selectDirectory();
            if (dirHandle) {
                const input = document.getElementById('dataDirectoryInput');
                if (input) {
                    input.value = dirHandle.name;
                }
            }
        } catch (error) {
            window.notification?.error(this._t('dash.selectDirFailed') + error.message);
        }
    }

    /**
     * Show add path form
     */
    showAddPathForm() {
        // Switch to paths tab
        if (window.app) {
            window.app.switchDashboardTab('paths');
        }
    }

    show(tabName = null) {
        if (window.app && typeof window.app.openDashboard === 'function') {
            window.app.openDashboard();
        } else {
            const modal = document.getElementById('dashboardModal');
            if (modal) modal.style.display = 'flex';
        }
        if (tabName && window.app && typeof window.app.switchDashboardTab === 'function') {
            window.app.switchDashboardTab(tabName);
        }
        this.refresh?.();
    }

    hide() {
        if (window.app && typeof window.app.closeDashboard === 'function') {
            window.app.closeDashboard();
        } else {
            const modal = document.getElementById('dashboardModal');
            if (modal) modal.style.display = 'none';
        }
    }
}

// Export singleton instance
window.dashboardUI = new DashboardUI();
