/**
 * Control Center — front-end access to app config, optional tools (window.t), performance,
 * dashboard prefs, platform controls, and SIM sensor settings. Persists to simplex_runtime_overrides_v1.
 */
(function () {
    'use strict';

    const TAB_IDS = ['guide', 'performance', 'features', 'scene', 'local', 'project', 'backup'];

    class ComprehensiveSettingsUI {
        constructor() {
            this._bound = false;
        }

        _t(path) {
            if (window.appI18n && typeof window.appI18n.t === 'function') {
                const v = window.appI18n.t(path);
                if (v !== path) return v;
            }
            return path;
        }

        _tOr(path, fallback) {
            const v = this._t(path);
            return v !== path ? v : fallback;
        }

        _moduleTitle(key, fallback) {
            return this._tOr('registry.modules.' + key, fallback);
        }

        _chromeLabel(configKey, fallback) {
            return this._tOr('registry.chrome.' + configKey, fallback);
        }

        init() {
            if (this._bound) return;
            this._bound = true;
            const openBtn = document.getElementById('controlCenterBtn');
            const closeBtn = document.getElementById('closeControlCenterBtn');
            const modal = document.getElementById('controlCenterModal');
            const search = document.getElementById('ccGlobalSearch');
            openBtn?.addEventListener('click', () => this.open());
            closeBtn?.addEventListener('click', () => this.close());
            modal?.addEventListener('click', (e) => {
                if (e.target === modal) this.close();
            });
            search?.addEventListener('input', (e) => this._filterSearch(e.target.value));
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modal && modal.style.display !== 'none') this.close();
            });
            TAB_IDS.forEach((id) => {
                document.getElementById(`ccTab_${id}`)?.addEventListener('click', () => this.switchTab(id));
            });
            document.getElementById('ccSaveAllBtn')?.addEventListener('click', () => this.saveAll());
            document.getElementById('ccResetRuntimeBtn')?.addEventListener('click', () =>
                this.resetRuntimeOverrides()
            );
            document.getElementById('ccResetAllPrefsBtn')?.addEventListener('click', () =>
                this.resetAllLocalPrefs()
            );
            document.getElementById('ccExportBtn')?.addEventListener('click', () => this.exportJson());
            document.getElementById('ccImportBtn')?.addEventListener('click', () => this.importJson());
            document.getElementById('ccImportFile')?.addEventListener('change', (e) => this.onImportFile(e));
            if (!this._localeBound) {
                this._localeBound = true;
                window.addEventListener('simplex:localeChanged', () => {
                    const modal = document.getElementById('controlCenterModal');
                    if (modal && modal.style.display !== 'none') {
                        this.renderAllTabs();
                        const search = document.getElementById('ccGlobalSearch');
                        this._filterSearch(search ? search.value : '');
                    }
                });
            }
        }

        open() {
            const modal = document.getElementById('controlCenterModal');
            if (!modal) return;
            const search = document.getElementById('ccGlobalSearch');
            if (search) search.value = '';
            this.renderAllTabs();
            this._filterSearch('');
            modal.style.display = 'flex';
            this.switchTab('guide');
        }

        _filterSearch(query) {
            const q = (query || '').trim().toLowerCase();
            document.querySelectorAll('.cc-searchable').forEach((el) => {
                const hay = (el.getAttribute('data-cc-search') || el.textContent || '').toLowerCase();
                const show = !q || hay.includes(q);
                el.classList.toggle('cc-search-hidden', !show);
            });
        }

        close() {
            const modal = document.getElementById('controlCenterModal');
            if (modal) modal.style.display = 'none';
        }

        switchTab(id) {
            TAB_IDS.forEach((tid) => {
                const btn = document.getElementById(`ccTab_${tid}`);
                const panel = document.getElementById(`ccPanel_${tid}`);
                const on = tid === id;
                if (btn) {
                    btn.classList.toggle('active', on);
                    btn.setAttribute('aria-selected', on ? 'true' : 'false');
                }
                if (panel) panel.classList.toggle('active', on);
            });
        }

        /** Icon + text for section headers (details summary, subheads). */
        _ccSum(iconClasses, text) {
            return `<span class="cc-sum"><i class="${iconClasses}" aria-hidden="true"></i><span>${text}</span></span>`;
        }

        _ccToggleLab(iconClasses, text, inputInner) {
            const t = this._esc(text);
            return `<label class="cc-toggle-label"><span class="cc-toggle-lhs"><i class="${iconClasses} cc-toggle-ico" aria-hidden="true"></i><span class="cc-toggle-txt">${t}</span></span><input type="checkbox" ${inputInner}/></label>`;
        }

        _jcm() {
            return window.jsonConfigManager;
        }

        renderAllTabs() {
            this._renderPerformance();
            this._renderFeatures();
            this._renderScene();
            this._renderLocal();
            this._renderProject();
        }

        _renderPerformance() {
            const el = document.getElementById('ccPanel_performance');
            if (!el || !this._jcm()) return;
            const jcm = this._jcm();
            const p = jcm.getPerformanceSettings();
            const d = jcm.getDefaultConfig().performance;
            const app = jcm.mergeAppConfigWithDefaults(jcm.configs.get('app'));
            const lr = app.layerRendering || jcm.getDefaultConfig().layerRendering || {};
            const lrDef = jcm.getDefaultConfig().layerRendering || {};
            el.innerHTML = `
                <div class="cc-hero cc-searchable" data-cc-search="performance render loop resolution requests idle">
                    <p class="cc-lead">${this._t('cc.perf.lead')}</p>
                </div>
                <div class="cc-grid cc-searchable" data-cc-search="frame budget idle yield requests resolution dpi browser">
                    ${this._num('perf_frame', 'cc.perf.frameBudget', p.renderLoopFrameBudgetMs, d.renderLoopFrameBudgetMs, 1, 16, 1)}
                    ${this._num('perf_idle', 'cc.perf.idleTimeout', p.idleCallbackTimeoutMs, d.idleCallbackTimeoutMs, 100, 10000, 50)}
                    ${this._num('perf_yield', 'cc.perf.yield', p.deferredInitYieldMs, d.deferredInitYieldMs, 0, 100, 1)}
                    ${this._num('perf_req', 'cc.perf.maxReq', p.maximumRequestsPerServer, d.maximumRequestsPerServer, 6, 64, 1)}
                    ${this._num('perf_res', 'cc.perf.resScale', p.viewerResolutionScaleMax, d.viewerResolutionScaleMax, 0.5, 2.5, 0.1)}
                </div>
                <label class="cc-check cc-check--ico cc-searchable" data-cc-search="browser recommended resolution hidpi dpi"><input type="checkbox" id="perf_browserRes" ${p.useBrowserRecommendedResolution ? 'checked' : ''}/><i class="fas fa-desktop cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.perf.browserRes')}</span></label>
                <div class="cc-subhead cc-subhead--ico cc-searchable" data-cc-search="3d tiles tileset sse mesh detail clarity grids baana">${this._ccSum('fas fa-cube', this._t('cc.perf.subhead3d'))}</div>
                <p class="cc-hint cc-searchable" data-cc-search="screen space error sse fps gpu sharp">${this._t('cc.perf.tileHint')}</p>
                <div class="cc-grid cc-searchable" data-cc-search="tileset maximum screen space error layer rendering">
                    ${this._num(
                        'perf_tile_sse',
                        'cc.perf.tileSse',
                        lr.tilesetMaximumScreenSpaceError,
                        lrDef.tilesetMaximumScreenSpaceError != null ? lrDef.tilesetMaximumScreenSpaceError : 8,
                        0.25,
                        64,
                        0.25
                    )}
                </div>
                <label class="cc-check cc-check--ico cc-searchable" data-cc-search="dynamic sse"><input type="checkbox" id="perf_lr_dyn" ${lr.enableDynamicScreenSpaceError ? 'checked' : ''}/><i class="fas fa-arrows-alt-v cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.perf.dynamicSse')}</span></label>
                <label class="cc-check cc-check--ico cc-searchable" data-cc-search="layer rendering quality module"><input type="checkbox" id="perf_lr_en" ${lr.enabled !== false ? 'checked' : ''}/><i class="fas fa-gem cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.perf.lrEnable')}</span></label>
            `;
        }

        _num(id, labelPath, val, def, min, max, step) {
            const label = this._t(labelPath);
            const defLbl = this._t('cc.perf.default');
            return `<div class="cc-field">
                <label for="${id}">${label} <span class="cc-def">${defLbl} ${def}</span></label>
                <input type="number" id="${id}" value="${val}" min="${min}" max="${max}" step="${step}"/>
            </div>`;
        }

        _renderFeatures() {
            const el = document.getElementById('ccPanel_features');
            if (!el || !this._jcm()) return;
            const jcm = this._jcm();
            const app = jcm.mergeAppConfigWithDefaults(jcm.configs.get('app'));
            const f = app.features || {};
            const ui = app.ui || {};
            const defUi = jcm.getDefaultConfig().ui || {};
            const chrome = { ...defUi.chrome, ...(ui.chrome || {}) };
            const tools = app.tools || {};
            const items = tools.items || jcm.getDefaultConfig().tools.items;
            const lay = f.layers || jcm.getDefaultConfig().features.layers;
            const visStr = Array.isArray(lay.defaultVisible) ? lay.defaultVisible.join(', ') : '';
            const hidStr = Array.isArray(lay.defaultHidden) ? lay.defaultHidden.join(', ') : '';
            const collab = f.collaboration || jcm.getDefaultConfig().features.collaboration || {
                enabled: false,
                backendUrl: ''
            };
            const reg = window.controlCenterRegistry;
            const modDefs = jcm.getDefaultConfig().modules || {};
            const modsMerged = app.modules || modDefs;
            const labels = reg && reg.MODULE_LABELS ? reg.MODULE_LABELS : {};
            const uiLangSel = String(ui.language || 'en').toLowerCase() === 'ar' ? 'ar' : 'en';
            const modGroupFn = (k) => {
                const m = modsMerged[k] || modDefs[k] || { enabled: true };
                const title = this._moduleTitle(k, labels[k] || k);
                return `<label class="cc-check cc-mod-row cc-searchable" data-cc-search="runtime module ${this._esc(k)} ${this._esc(title)} init load">
                    <input type="checkbox" class="cc-mod-en" data-key="${this._esc(k)}" ${m.enabled !== false ? 'checked' : ''}/>
                    <span class="cc-mod-title">${this._esc(title)}</span>
                    <code class="cc-mod-id">${this._esc(k)}</code>
                </label>`;
            };
            let modRows = '';
            if (reg && Array.isArray(reg.MODULE_INIT_GROUPS)) {
                modRows = reg.MODULE_INIT_GROUPS.map(
                    (g) => `
                    <div class="cc-mod-group cc-searchable" data-cc-search="module group ${this._esc(g.label)}">
                        <div class="cc-subhead cc-mod-group-title">${this._esc(this._tOr('registry.modGroups.' + g.id + '.label', g.label))}</div>
                        <div class="cc-chrome-grid">${g.keys.map((k) => modGroupFn(k)).join('')}</div>
                    </div>`
                ).join('');
            } else {
                modRows = `<div class="cc-chrome-grid">${Object.keys(modDefs).map((k) => modGroupFn(k)).join('')}</div>`;
            }
            const chromeRows =
                reg && Array.isArray(reg.NAV_CHROME_IDS)
                    ? reg.NAV_CHROME_IDS.map(
                          ({ id, configKey, label }) => `
                <label class="cc-check cc-check--ico cc-searchable" data-cc-search="chrome navbar ${this._esc(label)} ${this._esc(id)} ${this._esc(configKey)}">
                    <input type="checkbox" id="chrome_${this._esc(configKey)}" ${chrome[configKey] !== false ? 'checked' : ''}/>
                    <i class="fas fa-window-restore cc-check-ico" aria-hidden="true"></i><span>${this._esc(this._chromeLabel(configKey, label))} <span class="cc-mono">#${this._esc(id)}</span></span>
                </label>`
                      ).join('')
                    : '';
            const toolRows = items
                .map(
                    (it) => `
                <tr class="cc-searchable" data-cc-search="tool catalog ${this._esc(it.id)} ${this._esc(it.label || '')} ${this._esc(it.action || '')}">
                    <td><code>${it.id}</code></td>
                    <td>${this._esc(it.label || '')}</td>
                    <td><input type="checkbox" class="cc-tool-en" data-id="${this._esc(it.id)}" ${it.enabled !== false ? 'checked' : ''}/></td>
                </tr>`
                )
                .join('');
            el.innerHTML = `
                <div class="cc-hero cc-searchable" data-cc-search="workspace catalog tools features layers theme navbar">
                    <p class="cc-lead">${this._t('cc.features.heroLead')}</p>
                </div>
                <details class="cc-details cc-searchable" open data-cc-search="tools catalog nested toolbar actions">
                    <summary>${this._ccSum('fas fa-tools', this._t('cc.features.toolCatalogSummary'))}</summary>
                    <div class="cc-details-body">
                        <label class="cc-check cc-check--ico"><input type="checkbox" id="cc_tools_master" ${tools.enabled !== false ? 'checked' : ''}/><i class="fas fa-toggle-on cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.features.masterCatalog')}</span></label>
                        <p class="cc-hint">${this._t('cc.features.toolCatalogHint')}</p>
                        <div class="cc-table-wrap"><table class="cc-table"><thead><tr><th>${this._t('cc.features.tableId')}</th><th>${this._t('cc.features.tableLabel')}</th><th>${this._t('cc.features.tableOn')}</th></tr></thead><tbody>${toolRows}</tbody></table></div>
                    </div>
                </details>
                <details class="cc-details cc-searchable" open data-cc-search="measurement navigation history features">
                    <summary>${this._ccSum('fas fa-puzzle-piece', this._t('cc.features.featureModules'))}</summary>
                    <div class="cc-details-body cc-grid">
                        <label class="cc-check cc-check--ico"><input type="checkbox" id="feat_meas_en" ${f.measurement?.enabled !== false ? 'checked' : ''}/><i class="fas fa-ruler-combined cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.features.measurement')}</span></label>
                        <div class="cc-field"><label>${this._t('cc.features.accuracyM')}</label><input type="number" id="feat_meas_acc" step="0.01" value="${f.measurement?.accuracy ?? 0.1}"/></div>
                        <label class="cc-check cc-check--ico"><input type="checkbox" id="feat_meas_zoom" ${f.measurement?.requireZoom !== false ? 'checked' : ''}/><i class="fas fa-search-plus cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.features.requireZoom')}</span></label>
                        <label class="cc-check cc-check--ico"><input type="checkbox" id="feat_nav_en" ${f.navigation?.enabled !== false ? 'checked' : ''}/><i class="fas fa-compass cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.features.navigation')}</span></label>
                        <div class="cc-field"><label>${this._t('cc.features.cameraHistorySize')}</label><input type="number" id="feat_nav_hist" min="1" max="500" value="${f.navigation?.historySize ?? 50}"/></div>
                        <label class="cc-check cc-check--ico"><input type="checkbox" id="feat_nav_autosave" ${f.navigation?.autoSave !== false ? 'checked' : ''}/><i class="fas fa-save cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.features.autoSaveHistory')}</span></label>
                        <label class="cc-check cc-check--ico"><input type="checkbox" id="feat_layers_en" ${f.layers?.enabled !== false ? 'checked' : ''}/><i class="fas fa-stream cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.features.layersMenuFeature')}</span></label>
                    </div>
                </details>
                <details class="cc-details cc-searchable" open data-cc-search="collaboration backend shared workspace optional">
                    <summary>${this._ccSum('fas fa-users', this._t('cc.features.collaborationSummary'))}</summary>
                    <div class="cc-details-body">
                        <label class="cc-check cc-check--ico"><input type="checkbox" id="feat_collab_en" ${collab.enabled ? 'checked' : ''}/><i class="fas fa-plug cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.features.collabEnable')}</span></label>
                        <div class="cc-field"><label>${this._t('cc.features.backendUrl')}</label><input type="text" id="feat_collab_url" class="cc-wide" value="${this._esc(collab.backendUrl || '')}" placeholder="${this._esc(this._t('cc.features.placeholderApi'))}"/></div>
                        <p class="cc-hint">${this._t('cc.features.collabHint')}</p>
                    </div>
                </details>
                <details class="cc-details cc-searchable" open data-cc-search="runtime modules init initialization feature managers">
                    <summary>${this._ccSum('fas fa-microchip', this._t('cc.features.runtimeModulesSummary'))}</summary>
                    <div class="cc-details-body">
                        <p class="cc-hint">${this._t('cc.features.runtimeModulesHint')}</p>
                        <div class="cc-mod-stack">${modRows}</div>
                    </div>
                </details>
                <details class="cc-details cc-searchable" open data-cc-search="layers default visible hidden background streets parcels">
                    <summary>${this._ccSum('fas fa-layer-group', this._t('cc.features.layerDefaultsSummary'))}</summary>
                    <div class="cc-details-body">
                        <p class="cc-hint">${this._t('cc.features.layerDefaultsHint')}</p>
                        <div class="cc-field"><label>${this._t('cc.features.defaultVisible')}</label><input type="text" id="feat_layers_vis" class="cc-wide" value="${this._esc(visStr)}" placeholder="${this._esc(this._t('cc.features.placeholderLayersVis'))}"/></div>
                        <div class="cc-field"><label>${this._t('cc.features.defaultHidden')}</label><input type="text" id="feat_layers_hid" class="cc-wide" value="${this._esc(hidStr)}" placeholder="${this._esc(this._t('cc.features.placeholderLayersHid'))}"/></div>
                    </div>
                </details>
                <details class="cc-details cc-searchable" open data-cc-search="theme language sidebar collapsed ui">
                    <summary>${this._ccSum('fas fa-palette', this._t('cc.features.appearanceSummary'))}</summary>
                    <div class="cc-details-body cc-grid">
                        <div class="cc-field"><label>${this._t('cc.features.theme')}</label>
                            <select id="ui_theme"><option value="dark" ${(ui.theme || 'dark') === 'dark' ? 'selected' : ''}>${this._t('cc.features.themeDark')}</option><option value="light" ${ui.theme === 'light' ? 'selected' : ''}>${this._t('cc.features.themeLight')}</option></select>
                        </div>
                        <div class="cc-field"><label for="ui_lang">${this._t('cc.features.languageCode')}</label><select id="ui_lang" title="${this._esc(this._t('cc.features.langTitle'))}" aria-describedby="ui_lang_hint">
                            <option value="en" ${uiLangSel === 'en' ? 'selected' : ''}>${this._t('cc.features.langOptionEn')}</option>
                            <option value="ar" ${uiLangSel === 'ar' ? 'selected' : ''}>${this._t('cc.features.langOptionAr')}</option>
                        </select>
                            <p class="cc-hint" id="ui_lang_hint">${this._t('cc.features.langHint')}</p></div>
                        <label class="cc-check cc-check--ico"><input type="checkbox" id="ui_sb_left" ${ui.sidebars?.left?.defaultCollapsed !== false ? 'checked' : ''}/><i class="fas fa-chevron-left cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.features.sbLeftCollapsed')}</span></label>
                        <label class="cc-check cc-check--ico"><input type="checkbox" id="ui_sb_right" ${ui.sidebars?.right?.defaultCollapsed !== false ? 'checked' : ''}/><i class="fas fa-chevron-right cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.features.sbRightCollapsed')}</span></label>
                        <label class="cc-check cc-check--ico"><input type="checkbox" id="ui_sb_tools" ${ui.sidebars?.tools?.defaultCollapsed === true ? 'checked' : ''}/><i class="fas fa-compress-alt cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.features.toolsStripCollapsed')}</span></label>
                    </div>
                </details>
                <details class="cc-details cc-searchable" open data-cc-search="navbar top bar navigation database dashboard help control">
                    <summary>${this._ccSum('fas fa-bars', this._t('cc.features.topNavSummary'))}</summary>
                    <div class="cc-details-body cc-chrome-grid">
                        ${chromeRows}
                    </div>
                </details>
            `;
        }

        _renderScene() {
            const el = document.getElementById('ccPanel_scene');
            if (!el || !this._jcm()) return;
            const jcm = this._jcm();
            const t = window.t && typeof window.t === 'object' ? window.t : jcm.getDefaultOptionalToolsT();
            const raw = jcm.optionalToolsRawFromWindowT(t);
            const meta = window.controlCenterRegistry;
            const analysisMeta = meta && Array.isArray(meta.ANALYSIS_META) ? meta.ANALYSIS_META : [];
            const showLab = this._t('cc.scene.show');
            const activeLab = this._t('cc.scene.active');
            const onLab = this._t('cc.scene.on');
            const analysis = analysisMeta
                .map(({ tKey, label, hint }) => {
                    const o = t[tKey] || { Show: true, Active: true };
                    const lbl = this._tOr('registry.analysis.' + tKey + '.label', label);
                    const hnt = this._tOr('registry.analysis.' + tKey + '.hint', hint || '');
                    return `<div class="cc-card cc-searchable" data-cc-search="analysis ${tKey} ${lbl} measure lineofsight viewshed ${hnt}">
                        <div class="cc-card-title">${this._esc(lbl)} <span class="cc-mono">${tKey}</span></div>
                        <p class="cc-hint">${this._esc(hnt)}</p>
                        <div class="cc-toggle-row">
                            ${this._ccToggleLab('fas fa-eye', showLab, `class="cc-an" data-k="${tKey}" data-f="Show" ${o.Show ? 'checked' : ''}`)}
                            ${this._ccToggleLab('fas fa-check-circle', activeLab, `class="cc-an" data-k="${tKey}" data-f="Active" ${o.Active ? 'checked' : ''}`)}
                        </div>
                    </div>`;
                })
                .join('');
            const sceneIds = Object.keys(t.SceneModes || {});
            const smMeta = meta && meta.SCENE_MODE_META ? meta.SCENE_MODE_META : {};
            const sceneHtml = sceneIds
                .map((id) => {
                    const sm = t.SceneModes[id];
                    const m = smMeta[id] || {};
                    const mLabel = this._tOr('registry.sceneModes.' + id + '.label', m.label || id);
                    const mHint = this._tOr('registry.sceneModes.' + id + '.hint', m.hint || '');
                    let extra = '';
                    if (id === 'transparency') {
                        extra = `<label>${this._t('cc.scene.alpha')} <input type="number" class="cc-sm-num" data-id="${id}" data-f="alpha" step="0.01" min="0.05" max="1" value="${sm.alpha ?? 0.45}"/></label>`;
                    } else if (id === 'fog') {
                        extra = `<label>${this._t('cc.scene.density')} <input type="number" class="cc-sm-num" data-id="${id}" data-f="density" step="0.0001" value="${sm.density ?? 0.0004}"/></label>
                        <label>${this._t('cc.scene.minBrightness')} <input type="number" class="cc-sm-num" data-id="${id}" data-f="minimumBrightness" step="0.01" min="0" max="1" value="${sm.minimumBrightness ?? 0.35}"/></label>`;
                    } else if (id === 'distance') {
                        extra = `<label>${this._t('cc.scene.density')} <input type="number" class="cc-sm-num" data-id="${id}" data-f="density" step="0.0001" value="${sm.density ?? 0.0025}"/></label>`;
                    } else if (id === 'height' || id === 'remapColors') {
                        extra = `<label>${this._t('cc.scene.heightDiv')} <input type="number" class="cc-sm-num" data-id="${id}" data-f="heightDivisor" step="1" min="1" max="5000" value="${sm.heightDivisor ?? (id === 'height' ? 200 : 25)}"/></label>`;
                    } else if (id === 'ortho') {
                        extra = `<label>${this._t('cc.scene.widthFactor')} <input type="number" class="cc-sm-num" data-id="${id}" data-f="orthoWidthFactor" step="0.01" min="0.05" max="2" value="${sm.orthoWidthFactor ?? 0.35}"/></label>`;
                    } else if (id === 'slope') {
                        extra = `<label>${this._t('cc.scene.thresholdDeg1')} <input type="number" class="cc-sm-num" data-id="${id}" data-f="thresholdDeg1" step="1" min="1" max="89" value="${sm.thresholdDeg1 ?? 15}"/></label>
                        <label>${this._t('cc.scene.thresholdDeg2')} <input type="number" class="cc-sm-num" data-id="${id}" data-f="thresholdDeg2" step="1" min="1" max="89" value="${sm.thresholdDeg2 ?? 30}"/></label>
                        <label>${this._t('cc.scene.thresholdDeg3')} <input type="number" class="cc-sm-num" data-id="${id}" data-f="thresholdDeg3" step="1" min="1" max="89" value="${sm.thresholdDeg3 ?? 45}"/></label>
                        <label>${this._t('cc.scene.gridSamples')} <input type="number" class="cc-sm-num" data-id="${id}" data-f="gridSamples" step="1" min="6" max="80" value="${sm.gridSamples ?? 20}"/></label>`;
                    } else if (id === 'snow' || id === 'rain') {
                        extra = `<label>${this._t('cc.scene.density')} <input type="number" class="cc-sm-num" data-id="${id}" data-f="density" step="0.0001" min="0.0001" max="0.02" value="${sm.density ?? (id === 'snow' ? 0.0018 : 0.0012)}"/></label>
                        <label>${this._t('cc.scene.minBrightness')} <input type="number" class="cc-sm-num" data-id="${id}" data-f="minimumBrightness" step="0.01" min="0" max="1" value="${sm.minimumBrightness ?? (id === 'snow' ? 0.65 : 0.45)}"/></label>`;
                    }
                    const searchKw = `${id} ${mLabel} ${mHint} scene mode`;
                    return `<div class="cc-card cc-searchable" data-cc-search="${this._esc(searchKw)}">
                        <div class="cc-card-title">${this._esc(mLabel)} <span class="cc-mono">#${this._esc(id)}</span></div>
                        <p class="cc-hint">${this._esc(mHint)}</p>
                        <div class="cc-toggle-row">
                            ${this._ccToggleLab('fas fa-eye', showLab, `class="cc-sm-bool" data-id="${id}" data-f="Show" ${sm.Show ? 'checked' : ''}`)}
                            ${this._ccToggleLab('fas fa-check-circle', activeLab, `class="cc-sm-bool" data-id="${id}" data-f="Active" ${sm.Active ? 'checked' : ''}`)}
                        </div>
                        <div class="cc-num-row">${extra}</div>
                    </div>`;
                })
                .join('');
            const st = t.SceneTuning || { imageryContrast: 1, imageryBrightness: 1 };
            const sceneTuningHtml = `
                <details class="cc-details cc-searchable" open data-cc-search="contrast brightness imagery SceneTuning">
                    <summary>${this._ccSum('fas fa-adjust', this._t('cc.scene.sceneTuningSummary'))}</summary>
                    <div class="cc-details-body cc-grid">
                        <label>${this._t('cc.scene.imageryContrast')} <input type="number" class="cc-st-num" data-f="imageryContrast" step="0.05" min="0.2" max="3" value="${st.imageryContrast ?? 1}"/></label>
                        <label>${this._t('cc.scene.imageryBrightness')} <input type="number" class="cc-st-num" data-f="imageryBrightness" step="0.05" min="0.2" max="3" value="${st.imageryBrightness ?? 1}"/></label>
                    </div>
                </details>`;
            const groups = meta && Array.isArray(meta.MAP_TOOL_GROUPS) ? meta.MAP_TOOL_GROUPS : [];
            let toolsHtml = '';
            if (groups.length) {
                toolsHtml = groups
                    .map((g) => {
                        const rows = g.tools
                            .map((spec) => {
                                const k = spec.tKey;
                                const o = (t.Tools && t.Tools[k]) || { Show: true, Active: true };
                                const specLabel = this._tOr('registry.mapTools.' + k + '.label', spec.label);
                                const gLabel = this._tOr('registry.mapGroups.' + g.id + '.label', g.label);
                                const searchKw = `${gLabel} ${specLabel} ${k} ${spec.domId || ''} map tool`;
                                return `<div class="cc-tool-strip-row cc-searchable" data-cc-search="${this._esc(searchKw)}">
                                    <div class="cc-tool-strip-meta">
                                        <span class="cc-tool-name">${this._esc(specLabel)}</span>
                                        <div class="cc-tool-codes"><code class="cc-mono">${this._esc(k)}</code><span class="cc-mono cc-dim">#${this._esc(spec.domId || '')}</span></div>
                                    </div>
                                    <div class="cc-tool-strip-toggles">
                                        ${this._ccToggleLab('fas fa-eye', showLab, `class="cc-tl-bool" data-k="${this._esc(k)}" data-f="Show" ${o.Show ? 'checked' : ''}`)}
                                        ${this._ccToggleLab('fas fa-power-off', onLab, `class="cc-tl-bool" data-k="${this._esc(k)}" data-f="Active" ${o.Active ? 'checked' : ''}`)}
                                    </div>
                                </div>`;
                            })
                            .join('');
                        const gLabelTr = this._tOr('registry.mapGroups.' + g.id + '.label', g.label);
                        return `<details class="cc-details cc-searchable" open data-cc-search="${this._esc(gLabelTr)} map tools strip">
                            <summary>${this._esc(gLabelTr)}</summary>
                            <div class="cc-details-body cc-tool-strip">${rows}</div>
                        </details>`;
                    })
                    .join('');
            } else {
                toolsHtml = Object.keys(t.Tools || {})
                    .map((k) => {
                        const o = t.Tools[k];
                        return `<div class="cc-row cc-tool-fallback-row cc-searchable" data-cc-search="${this._esc(k)} tool">
                        <code>${this._esc(k)}</code>
                        <div class="cc-toggle-row">${this._ccToggleLab('fas fa-eye', showLab, `class="cc-tl-bool" data-k="${this._esc(k)}" data-f="Show" ${o.Show ? 'checked' : ''}`)}${this._ccToggleLab('fas fa-check-circle', activeLab, `class="cc-tl-bool" data-k="${this._esc(k)}" data-f="Active" ${o.Active ? 'checked' : ''}`)}</div>
                    </div>`;
                    })
                    .join('');
            }
            el.innerHTML = `
                <div class="cc-hero cc-searchable" data-cc-search="scene toolbar optional tools window.t measure elevation">
                    <p class="cc-lead">${this._t('cc.scene.heroLead')}</p>
                </div>
                <details class="cc-details cc-searchable" open data-cc-search="analysis measure LOS viewshed">
                    <summary>${this._ccSum('fas fa-chart-line', this._t('cc.scene.analysisSummary'))}</summary>
                    <div class="cc-card-grid">${analysis}</div>
                </details>
                ${sceneTuningHtml}
                <details class="cc-details cc-searchable" open data-cc-search="scene modes transparency fog ortho">
                    <summary>${this._ccSum('fas fa-mountain', this._t('cc.scene.sceneModesSummary'))}</summary>
                    <div class="cc-card-grid">${sceneHtml}</div>
                </details>
                <details class="cc-details cc-searchable" open data-cc-search="map tools navigation share screenshot flight split">
                    <summary>${this._ccSum('fas fa-grip-horizontal', this._t('cc.scene.mapStripSummary'))}</summary>
                    <div class="cc-stack">${toolsHtml}</div>
                </details>
                <details class="cc-details cc-searchable" data-cc-search="json raw optional tools">
                    <summary>${this._ccSum('fas fa-code', this._t('cc.scene.jsonPreview'))}</summary>
                    <textarea id="cc_scene_raw" readonly class="cc-json" rows="8">${this._esc(JSON.stringify(raw, null, 2))}</textarea>
                </details>
            `;
        }

        _renderProject() {
            const el = document.getElementById('ccPanel_project');
            if (!el) return;
            const idx = window.projectIntegrationIndex;
            if (!idx || !Array.isArray(idx.files)) {
                el.innerHTML = `<p class="cc-lead">${this._t('cc.project.notLoaded')}</p>`;
                return;
            }
            const fw = window.appSettingsFramework;
            const knownKeys =
                fw && typeof fw.getKnownKeys === 'function'
                    ? fw
                          .getKnownKeys()
                          .map(
                              (k) =>
                                  `<tr class="cc-searchable" data-cc-search="storage ${this._esc(k.key)} ${this._esc(k.category)} ${this._esc(k.description)}"><td><code>${this._esc(k.key)}</code></td><td>${this._esc(k.category)}</td><td>${this._esc(k.description)}</td></tr>`
                          )
                          .join('')
                    : '';
            const extraRows =
                Array.isArray(idx.extraSources) && idx.extraSources.length
                    ? idx.extraSources
                          .map(
                              (s) =>
                                  `<tr class="cc-searchable" data-cc-search="extra ${this._esc(s.path)} ${this._esc(s.category)} ${this._esc(s.role)}"><td><code>${this._esc(s.path)}</code></td><td>${this._esc(s.category)}</td><td>${this._esc(s.integration)}</td></tr>`
                          )
                          .join('')
                    : '';
            const fileRows = idx.files
                .map(
                    (f) =>
                        `<tr class="cc-searchable" data-cc-search="file ${this._esc(f.path)} ${this._esc(f.category)} ${this._esc(f.role)} ${this._esc(f.integration)}">
                            <td><code class="cc-path">${this._esc(f.path)}</code></td>
                            <td><span class="cc-cat">${this._esc(f.category)}</span></td>
                            <td>${this._esc(f.role)}</td>
                            <td class="cc-int">${this._esc(f.integration)}</td>
                        </tr>`
                )
                .join('');
            const heroIntro = this._t('cc.project.heroCountLine').replace(/\{count\}/g, String(idx.firstPartyScriptCount));
            el.innerHTML = `
                <div class="cc-hero cc-searchable" data-cc-search="project inventory files review architecture">
                    <p class="cc-lead">${heroIntro}${this._t('cc.project.heroLead')}</p>
                    <p class="cc-hint">${this._esc(idx.note || '')}</p>
                </div>
                <details class="cc-details cc-searchable" open data-cc-search="localStorage keys persistence">
                    <summary>${this._ccSum('fas fa-database', this._t('cc.project.storageKeysSummary'))}</summary>
                    <div class="cc-details-body">
                        <div class="cc-table-wrap"><table class="cc-table cc-proj-table"><thead><tr><th>${this._t('cc.project.thKey')}</th><th>${this._t('cc.project.thCategory')}</th><th>${this._t('cc.project.thRole')}</th></tr></thead><tbody>${knownKeys}</tbody></table></div>
                    </div>
                </details>
                <details class="cc-details cc-searchable" open data-cc-search="html server css landing admin">
                    <summary>${this._ccSum('fas fa-file-code', this._t('cc.project.htmlEntrySummary'))}</summary>
                    <div class="cc-details-body">
                        <div class="cc-table-wrap"><table class="cc-table cc-proj-table"><thead><tr><th>${this._t('cc.project.thPath')}</th><th>${this._t('cc.project.thType')}</th><th>${this._t('cc.project.thSettingsLink')}</th></tr></thead><tbody>${extraRows}</tbody></table></div>
                    </div>
                </details>
                <details class="cc-details cc-searchable" open data-cc-search="javascript modules every file">
                    <summary>${this._ccSum('fas fa-laptop-code', this._t('cc.project.allJsSummary'))}</summary>
                    <div class="cc-details-body">
                        <div class="cc-table-wrap cc-proj-scroll"><table class="cc-table cc-proj-table"><thead><tr><th>${this._t('cc.project.thPath')}</th><th>${this._t('cc.project.thArea')}</th><th>${this._t('cc.project.thRole')}</th><th>${this._t('cc.project.thIntegration')}</th></tr></thead><tbody>${fileRows}</tbody></table></div>
                    </div>
                </details>
            `;
        }

        _renderLocal() {
            const el = document.getElementById('ccPanel_local');
            if (!el) return;
            let appSettings = {};
            try {
                appSettings = JSON.parse(localStorage.getItem('appSettings') || '{}');
            } catch (e) {}
            let plat = {};
            try {
                plat = JSON.parse(localStorage.getItem('platformControlsSettings') || '{}');
            } catch (e) {}
            let sim = {};
            try {
                sim = JSON.parse(localStorage.getItem('simSensorConfig') || '{}');
            } catch (e) {}
            const now = new Date();
            now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
            const sunDefault = plat.sunPosition ? new Date(plat.sunPosition).toISOString().slice(0, 16) : now.toISOString().slice(0, 16);
            const qLow = this._t('cc.features.qualityLow');
            const qMed = this._t('cc.features.qualityMedium');
            const qHi = this._t('cc.features.qualityHigh');
            const qUltra = this._t('cc.features.qualityUltra');
            let mapLabelsOn = true;
            try {
                if (window.labelManager && typeof window.labelManager.isGloballyEnabled === 'function') {
                    mapLabelsOn = window.labelManager.isGloballyEnabled();
                } else {
                    mapLabelsOn = localStorage.getItem('simplex.mapLabels.enabled') !== '0';
                }
            } catch (e) {
                mapLabelsOn = true;
            }
            el.innerHTML = `
                <div class="cc-subhead cc-subhead--ico">${this._ccSum('fas fa-tachometer-alt', this._t('cc.local.dashPrefs'))}</div>
                <div class="cc-field"><label>${this._t('cc.local.dataDir')}</label><input type="text" id="ls_dataDir" class="cc-wide" value="${this._esc(appSettings.dataDirectory || '')}"/></div>
                <label class="cc-check cc-check--ico"><input type="checkbox" id="ls_autoLoad" ${appSettings.autoLoadEnabled ? 'checked' : ''}/><i class="fas fa-folder-open cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.local.autoLoad')}</span></label>
                <label class="cc-check cc-check--ico"><input type="checkbox" id="ls_notify" ${appSettings.showNotifications !== false ? 'checked' : ''}/><i class="fas fa-bell cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.local.notify')}</span></label>
                <label class="cc-check cc-check--ico"><input type="checkbox" id="ls_autopath" ${appSettings.autoSavePaths !== false ? 'checked' : ''}/><i class="fas fa-route cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.local.autoPath')}</span></label>
                <div class="cc-field"><label>${this._t('cc.local.defaultQuality')}</label>
                    <select id="ls_quality">
                        <option value="low" ${(appSettings.defaultQuality || 'medium') === 'low' ? 'selected' : ''}>${qLow}</option>
                        <option value="medium" ${(appSettings.defaultQuality || 'medium') === 'medium' ? 'selected' : ''}>${qMed}</option>
                        <option value="high" ${(appSettings.defaultQuality || 'medium') === 'high' ? 'selected' : ''}>${qHi}</option>
                        <option value="ultra" ${(appSettings.defaultQuality || 'medium') === 'ultra' ? 'selected' : ''}>${qUltra}</option>
                    </select>
                </div>
                <div class="cc-field"><label>${this._t('cc.local.memMb')}</label><input type="number" id="ls_mem" min="64" max="2048" value="${appSettings.memoryLimit ?? 256}"/></div>
                <details class="cc-details cc-searchable" open data-cc-search="labels offline map sqlite rlp electron">
                    <summary>${this._ccSum('fas fa-map-marked-alt', this._t('cc.local.mapLabelsSummary'))}</summary>
                    <div class="cc-details-body">
                        <label class="cc-check cc-check--ico"><input type="checkbox" id="cc_label_map_en" ${mapLabelsOn ? 'checked' : ''}/><i class="fas fa-tag cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.local.mapLabelsEnable')}</span></label>
                        <p class="cc-hint">${this._t('cc.local.mapLabelsHint')}</p>
                        <button type="button" class="btn btn-secondary btn-sm cc-btn-icon-text" id="cc_label_open_panel"><i class="fas fa-external-link-alt" aria-hidden="true"></i><span>${this._t('cc.local.mapLabelsOpenPanel')}</span></button>
                    </div>
                </details>
                <div class="cc-subhead cc-subhead--ico">${this._ccSum('fas fa-sun', this._t('cc.local.platformHdr'))}</div>
                <label class="cc-check cc-check--ico"><input type="checkbox" id="ls_site" ${plat.siteAccessible ? 'checked' : ''}/><i class="fas fa-universal-access cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.local.site')}</span></label>
                <label class="cc-check cc-check--ico"><input type="checkbox" id="ls_land" ${plat.landUse ? 'checked' : ''}/><i class="fas fa-map cc-check-ico" aria-hidden="true"></i><span>${this._t('cc.local.land')}</span></label>
                <div class="cc-field"><label>${this._t('cc.local.sunLocal')}</label><input type="datetime-local" id="ls_sun" value="${sunDefault}"/></div>
                <div class="cc-subhead cc-subhead--ico">${this._ccSum('fas fa-broadcast-tower', this._t('cc.local.simHdr'))}</div>
                <div class="cc-grid">
                    <div class="cc-field"><label>${this._t('cc.local.radius')}</label><input type="number" id="ls_sim_r" value="${sim.radius ?? 250}"/></div>
                    <div class="cc-field"><label>${this._t('cc.local.xHalf')}</label><input type="number" id="ls_sim_x" value="${sim.xHalfAngleDeg ?? 35}"/></div>
                    <div class="cc-field"><label>${this._t('cc.local.yHalf')}</label><input type="number" id="ls_sim_y" value="${sim.yHalfAngleDeg ?? 20}"/></div>
                    <div class="cc-field"><label>${this._t('cc.local.lon')}</label><input type="number" step="0.000001" id="ls_sim_lon" value="${sim.lon ?? 32.36}"/></div>
                    <div class="cc-field"><label>${this._t('cc.local.lat')}</label><input type="number" step="0.000001" id="ls_sim_lat" value="${sim.lat ?? 36.58}"/></div>
                    <div class="cc-field"><label>${this._t('cc.local.height')}</label><input type="number" id="ls_sim_h" value="${sim.height ?? 120}"/></div>
                </div>
            `;
            document.getElementById('cc_label_open_panel')?.addEventListener('click', () => {
                if (window.labelManagerUI && typeof window.labelManagerUI.focusPanel === 'function') {
                    window.labelManagerUI.focusPanel();
                }
                this.close();
            });
        }

        _esc(s) {
            return String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        _collectAppConfig() {
            const jcm = this._jcm();
            if (!jcm) return null;
            const base = jcm.mergeAppConfigWithDefaults(jcm.configs.get('app'));
            const p = base.performance || {};
            p.renderLoopFrameBudgetMs = parseFloat(document.getElementById('perf_frame')?.value) || p.renderLoopFrameBudgetMs;
            p.idleCallbackTimeoutMs = parseFloat(document.getElementById('perf_idle')?.value) || p.idleCallbackTimeoutMs;
            p.deferredInitYieldMs = parseFloat(document.getElementById('perf_yield')?.value) || p.deferredInitYieldMs;
            p.maximumRequestsPerServer = parseFloat(document.getElementById('perf_req')?.value) || p.maximumRequestsPerServer;
            p.viewerResolutionScaleMax = parseFloat(document.getElementById('perf_res')?.value) || p.viewerResolutionScaleMax;
            p.useBrowserRecommendedResolution = !!document.getElementById('perf_browserRes')?.checked;
            base.performance = p;

            const defLr = jcm.getDefaultConfig().layerRendering || {};
            const lrPrev = base.layerRendering && typeof base.layerRendering === 'object' ? base.layerRendering : {};
            const sseEl = document.getElementById('perf_tile_sse');
            let sse = sseEl ? parseFloat(sseEl.value) : NaN;
            if (!Number.isFinite(sse)) {
                sse = lrPrev.tilesetMaximumScreenSpaceError != null ? lrPrev.tilesetMaximumScreenSpaceError : defLr.tilesetMaximumScreenSpaceError;
            }
            sse = Math.min(64, Math.max(0.25, Number.isFinite(sse) ? sse : 8));
            base.layerRendering = {
                ...defLr,
                ...lrPrev,
                tilesetMaximumScreenSpaceError: sse,
                enableDynamicScreenSpaceError: !!document.getElementById('perf_lr_dyn')?.checked,
                enabled: document.getElementById('perf_lr_en') ? !!document.getElementById('perf_lr_en').checked : lrPrev.enabled !== false
            };

            base.tools = base.tools || {};
            base.tools.enabled = !!document.getElementById('cc_tools_master')?.checked;
            const items = [...(base.tools.items || jcm.getDefaultConfig().tools.items)];
            document.querySelectorAll('.cc-tool-en').forEach((inp) => {
                const id = inp.getAttribute('data-id');
                const row = items.find((x) => x.id === id);
                if (row) row.enabled = inp.checked;
            });
            base.tools.items = items;

            base.features = base.features || {};
            base.features.measurement = {
                enabled: !!document.getElementById('feat_meas_en')?.checked,
                accuracy: parseFloat(document.getElementById('feat_meas_acc')?.value) || 0.1,
                requireZoom: !!document.getElementById('feat_meas_zoom')?.checked
            };
            base.features.navigation = {
                enabled: !!document.getElementById('feat_nav_en')?.checked,
                historySize: parseInt(document.getElementById('feat_nav_hist')?.value, 10) || 50,
                autoSave: !!document.getElementById('feat_nav_autosave')?.checked
            };
            const visList = this._parseCsvList(document.getElementById('feat_layers_vis')?.value || '');
            const hidList = this._parseCsvList(document.getElementById('feat_layers_hid')?.value || '');
            const defL = jcm.getDefaultConfig().features.layers;
            base.features.layers = {
                ...defL,
                ...(base.features.layers || {}),
                enabled: !!document.getElementById('feat_layers_en')?.checked,
                defaultVisible: visList.length ? visList : defL.defaultVisible,
                defaultHidden: hidList.length ? hidList : defL.defaultHidden
            };
            const defCollab = jcm.getDefaultConfig().features.collaboration || { enabled: false, backendUrl: '' };
            base.features.collaboration = {
                ...defCollab,
                ...(base.features.collaboration || {}),
                enabled: !!document.getElementById('feat_collab_en')?.checked,
                backendUrl: String(document.getElementById('feat_collab_url')?.value || '').trim()
            };

            const defMods = jcm.getDefaultConfig().modules || {};
            base.modules = { ...defMods, ...(base.modules || {}) };
            document.querySelectorAll('.cc-mod-en').forEach((inp) => {
                const k = inp.getAttribute('data-key');
                if (!k) return;
                if (!base.modules[k]) base.modules[k] = { enabled: true };
                base.modules[k] = { ...base.modules[k], enabled: inp.checked };
            });

            this._syncToolCatalogAndModules(base, jcm);

            base.ui = base.ui || {};
            base.ui.theme = document.getElementById('ui_theme')?.value || 'dark';
            {
                const v = (document.getElementById('ui_lang')?.value || 'en').toLowerCase();
                base.ui.language = v === 'ar' ? 'ar' : 'en';
            }
            base.ui.sidebars = {
                left: { defaultCollapsed: !!document.getElementById('ui_sb_left')?.checked },
                right: { defaultCollapsed: !!document.getElementById('ui_sb_right')?.checked },
                tools: { defaultCollapsed: !!document.getElementById('ui_sb_tools')?.checked }
            };
            const defChrome = jcm.getDefaultConfig().ui.chrome || {};
            base.ui.chrome = { ...defChrome };
            if (window.controlCenterRegistry && Array.isArray(window.controlCenterRegistry.NAV_CHROME_IDS)) {
                window.controlCenterRegistry.NAV_CHROME_IDS.forEach(({ configKey }) => {
                    const inp = document.getElementById(`chrome_${configKey}`);
                    if (inp) base.ui.chrome[configKey] = !!inp.checked;
                });
            }

            return jcm.mergeAppConfigWithDefaults(base);
        }

        /**
         * Keep tools.items and modules.* consistent for mapped actions (see controlCenterRegistry.TOOL_ACTION_TO_MODULE).
         */
        _syncToolCatalogAndModules(base, jcm) {
            const map = window.controlCenterRegistry && window.controlCenterRegistry.TOOL_ACTION_TO_MODULE;
            if (!map || !base.tools || !Array.isArray(base.tools.items) || !base.modules) return;
            // Module enablement state is authoritative: sync catalog tool items both when disabling AND re-enabling
            base.tools.items.forEach((it) => {
                const mk = map[it.action];
                if (!mk || !base.modules[mk]) return;
                it.enabled = base.modules[mk].enabled !== false;
            });
        }

        _parseCsvList(str) {
            if (!str || typeof str !== 'string') return [];
            return str
                .split(/[,;]/)
                .map((s) => s.trim())
                .filter(Boolean);
        }

        _collectOptionalToolsPatch() {
            const jcm = this._jcm();
            if (!jcm) return {};
            const t0 = window.t && typeof window.t === 'object' ? window.t : jcm.getDefaultOptionalToolsT();
            const raw = jcm.optionalToolsRawFromWindowT(t0);
            ['Measure', 'LOS', 'Viewshed'].forEach((k) => {
                raw[k] = raw[k] || {};
                const show = document.querySelector(`.cc-an[data-k="${k}"][data-f="Show"]`);
                const act = document.querySelector(`.cc-an[data-k="${k}"][data-f="Active"]`);
                if (show) raw[k].Show = show.checked;
                if (act) raw[k].Active = act.checked;
            });
            raw.SceneModes = raw.SceneModes || {};
            document.querySelectorAll('.cc-sm-bool').forEach((inp) => {
                const id = inp.getAttribute('data-id');
                const f = inp.getAttribute('data-f');
                if (!id || !f) return;
                if (!raw.SceneModes[id]) raw.SceneModes[id] = {};
                raw.SceneModes[id][f] = inp.checked;
            });
            document.querySelectorAll('.cc-sm-num').forEach((inp) => {
                const id = inp.getAttribute('data-id');
                const f = inp.getAttribute('data-f');
                if (!id || !f) return;
                if (!raw.SceneModes[id]) raw.SceneModes[id] = {};
                const n = parseFloat(inp.value);
                if (!Number.isNaN(n)) raw.SceneModes[id][f] = n;
            });
            raw.Tools = raw.Tools || {};
            document.querySelectorAll('.cc-tl-bool').forEach((inp) => {
                const k = inp.getAttribute('data-k');
                const f = inp.getAttribute('data-f');
                if (!k || !f) return;
                if (!raw.Tools[k]) raw.Tools[k] = {};
                raw.Tools[k][f] = inp.checked;
            });
            raw.SceneTuning = raw.SceneTuning || {};
            document.querySelectorAll('.cc-st-num').forEach((inp) => {
                const f = inp.getAttribute('data-f');
                if (!f) return;
                const n = parseFloat(inp.value);
                if (!Number.isNaN(n)) raw.SceneTuning[f] = n;
            });
            return raw;
        }

        _collectLocal() {
            return {
                appSettings: {
                    dataDirectory: document.getElementById('ls_dataDir')?.value || '',
                    autoLoadEnabled: !!document.getElementById('ls_autoLoad')?.checked,
                    showNotifications: !!document.getElementById('ls_notify')?.checked,
                    autoSavePaths: !!document.getElementById('ls_autopath')?.checked,
                    defaultQuality: document.getElementById('ls_quality')?.value || 'medium',
                    memoryLimit: parseInt(document.getElementById('ls_mem')?.value, 10) || 256
                },
                platformControls: {
                    siteAccessible: !!document.getElementById('ls_site')?.checked,
                    landUse: !!document.getElementById('ls_land')?.checked,
                    sunPosition: document.getElementById('ls_sun')?.value
                        ? new Date(document.getElementById('ls_sun').value).toISOString()
                        : null
                },
                simSensorConfig: {
                    radius: parseFloat(document.getElementById('ls_sim_r')?.value) || 250,
                    xHalfAngleDeg: parseFloat(document.getElementById('ls_sim_x')?.value) || 35,
                    yHalfAngleDeg: parseFloat(document.getElementById('ls_sim_y')?.value) || 20,
                    lon: parseFloat(document.getElementById('ls_sim_lon')?.value) || 0,
                    lat: parseFloat(document.getElementById('ls_sim_lat')?.value) || 0,
                    height: parseFloat(document.getElementById('ls_sim_h')?.value) || 120
                }
            };
        }

        saveAll() {
            const jcm = this._jcm();
            const fw = window.appSettingsFramework;
            if (!jcm || !fw || typeof fw.persistControlCenterAndApply !== 'function') return;
            const appConfig = this._collectAppConfig();
            const optionalToolsPatch = this._collectOptionalToolsPatch();
            const local = this._collectLocal();
            fw.persistControlCenterAndApply({
                appConfig,
                optionalToolsPatch,
                appSettings: local.appSettings,
                platformControls: local.platformControls,
                simSensorConfig: local.simSensorConfig
            });
            const ccLab = document.getElementById('cc_label_map_en');
            if (ccLab && window.labelManager && typeof window.labelManager.setGloballyEnabled === 'function') {
                window.labelManager.setGloballyEnabled(!!ccLab.checked);
            }
            window.notification?.success(this._t('cc.save.allSaved'));
            this.close();
        }

        resetRuntimeOverrides() {
            if (!window.confirm(this._t('cc.save.resetRuntimeConfirm'))) return;
            this._jcm()?.clearRuntimeOverridesStorage();
            window.notification?.info(this._t('cc.save.resetRuntimeInfo'));
        }

        resetAllLocalPrefs() {
            if (!window.confirm(this._t('cc.save.resetAllConfirm'))) return;
            const fw = window.appSettingsFramework;
            this._jcm()?.clearRuntimeOverridesStorage();
            if (fw && typeof fw.clearPreferenceKeys === 'function') {
                fw.clearPreferenceKeys();
            } else {
                try {
                    localStorage.removeItem('appSettings');
                    localStorage.removeItem('platformControlsSettings');
                    localStorage.removeItem('simSensorConfig');
                } catch (e) {
                    /* ignore */
                }
            }
            window.notification?.info(this._t('cc.save.resetAllInfo'));
        }

        exportJson() {
            const fw = window.appSettingsFramework;
            if (fw && typeof fw.exportFullSnapshot === 'function') {
                const payload = fw.exportFullSnapshot();
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `simplex-full-settings-${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
                return;
            }
            const jcm = this._jcm();
            if (!jcm) return;
            const payload = {
                version: 1,
                exportedAt: new Date().toISOString(),
                appConfig: jcm.mergeAppConfigWithDefaults(jcm.configs.get('app')),
                optionalToolsPatch: jcm.optionalToolsRawFromWindowT(window.t || jcm.getDefaultOptionalToolsT()),
                appSettings: JSON.parse(localStorage.getItem('appSettings') || '{}'),
                platformControls: JSON.parse(localStorage.getItem('platformControlsSettings') || '{}'),
                simSensorConfig: JSON.parse(localStorage.getItem('simSensorConfig') || '{}')
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `simplex-control-center-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
        }

        importJson() {
            document.getElementById('ccImportFile')?.click();
        }

        onImportFile(e) {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data = JSON.parse(reader.result);
                    const fw = window.appSettingsFramework;
                    if (data && typeof data === 'object' && data.version === 2 && data.keys && fw && typeof fw.importFullSnapshot === 'function') {
                        fw.importFullSnapshot(data);
                        window.notification?.success(this._t('cc.save.importFullOk'));
                        this.renderAllTabs();
                        e.target.value = '';
                        return;
                    }
                    if (fw && typeof fw.importLegacyControlCenter === 'function') {
                        fw.importLegacyControlCenter(data);
                    } else {
                        const jcm = this._jcm();
                        if (!jcm) return;
                        jcm.saveRuntimeOverridesToStorage({
                            appConfig: data.appConfig,
                            optionalToolsPatch: data.optionalToolsPatch,
                            appSettings: data.appSettings,
                            platformControls: data.platformControls,
                            simSensorConfig: data.simSensorConfig
                        });
                        jcm.applyRuntimeOverridesFromStorage();
                    }
                    window.notification?.success(this._t('cc.save.importOk'));
                    this.renderAllTabs();
                } catch (err) {
                    window.notification?.error(this._t('cc.save.invalidJson') + err.message);
                }
                e.target.value = '';
            };
            reader.readAsText(f);
        }
    }

    window.comprehensiveSettingsUI = new ComprehensiveSettingsUI();
})();
