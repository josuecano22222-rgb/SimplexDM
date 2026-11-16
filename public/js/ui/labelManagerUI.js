/**
 * Sidebar UI: offline label types, language, region pack import.
 */
(function (global) {
    'use strict';

    const LABEL_TYPES = [
        'country',
        'state',
        'city',
        'town',
        'village',
        'suburb',
        'road',
        'motorway',
        'waterway',
        'lake',
        'mountain',
        'island',
        'airport',
        'railway',
        'hospital',
        'school',
        'poi',
        'custom',
    ];

    class LabelManagerUI {
        constructor() {
            /** @type {HTMLElement|null} */
            this._panel = null;
            this._enabledTypes = new Set(LABEL_TYPES);
            this._installedList = [];
            /** @type {(() => void)|null} */
            this._unsubProgress = null;
            /** @type {(() => void)|null} */
            this._unsubDownload = null;
            /** @type {boolean} */
            this._mounted = false;
        }

        _labelsApi() {
            return global.electronAPI && global.electronAPI.gis && global.electronAPI.gis.labels
                ? global.electronAPI.gis.labels
                : null;
        }

        /**
         * @param {HTMLElement} containerEl
         */
        mount(containerEl) {
            if (!containerEl) return;
            if (this._mounted && this._panel === containerEl) return;
            if (this._mounted) this.unmount();
            this._mounted = true;
            this._panel = containerEl;
            this._render();
            if (this._labelsApi()) {
                this._loadInstalledRegions();
                this._bindImportProgress();
                this._bindDownloadProgress();
            }
            global.addEventListener('simplex:localeChanged', this._onLocale);
            global.addEventListener('simplex:mapLabelsEnabledChanged', this._onMapLabelsEnabled);
        }

        unmount() {
            if (!this._mounted) return;
            this._mounted = false;
            global.removeEventListener('simplex:localeChanged', this._onLocale);
            global.removeEventListener('simplex:mapLabelsEnabledChanged', this._onMapLabelsEnabled);
            if (this._unsubProgress) {
                try {
                    this._unsubProgress();
                } catch (_) {
                    /* ignore */
                }
                this._unsubProgress = null;
            }
            if (this._unsubDownload) {
                try {
                    this._unsubDownload();
                } catch (_) {
                    /* ignore */
                }
                this._unsubDownload = null;
            }
            if (this._panel) {
                this._panel.innerHTML = '';
                this._panel = null;
            }
        }

        _onLocale = () => {
            if (this._panel && global.appI18n && typeof global.appI18n.applyDom === 'function') {
                global.appI18n.applyDom(this._panel);
            }
        };

        _onMapLabelsEnabled = (e) => {
            const en =
                e && e.detail && typeof e.detail.enabled === 'boolean'
                    ? e.detail.enabled
                    : global.labelManager && global.labelManager.isGloballyEnabled();
            this._syncMasterCheckbox();
            this._setControlsDisabled(!en);
        };

        /**
         * Opens the left sidebar and scrolls to the labels section (nested toolbar / shortcuts).
         */
        focusPanel() {
            const sec = global.document.getElementById('labelManagerSection');
            if (sec && (sec.style.display === 'none' || sec.getAttribute('aria-hidden') === 'true')) {
                return;
            }
            const left = global.document.getElementById('leftSidebar');
            if (left && left.classList.contains('collapsed')) {
                const t = global.document.getElementById('toggleLeftSidebar');
                if (t) t.click();
            }
            global.setTimeout(() => {
                const sec = global.document.getElementById('labelManagerSection');
                if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                const m = global.document.getElementById('labelManagerMount');
                if (m) {
                    m.classList.add('lm-flash');
                    global.setTimeout(() => m.classList.remove('lm-flash'), 1400);
                }
            }, 160);
        };

        _syncMasterCheckbox() {
            const cb = this._panel && this._panel.querySelector('#lm-master-en');
            if (!cb || !global.labelManager) return;
            cb.checked = global.labelManager.isGloballyEnabled();
        }

        /**
         * @param {boolean} disabled
         */
        _setControlsDisabled(disabled) {
            const root = this._panel && this._panel.querySelector('#lm-controls');
            if (!root) return;
            root.classList.toggle('lm-controls--disabled', disabled);
            root.querySelectorAll('input,select,button').forEach((el) => {
                if (el.id === 'lm-master-en') return;
                el.disabled = disabled;
            });
        }

        _render() {
            if (!this._panel) return;
            const api = this._labelsApi();

            if (!api) {
                this._panel.innerHTML =
                    '<div class="label-manager-ui">' +
                    '<div class="lm-banner lm-banner--muted" role="status">' +
                    '<i class="fas fa-info-circle" aria-hidden="true"></i> ' +
                    '<span data-i18n="ui.labels.electronOnly">Offline map labels require the Meridian desktop app (Electron).</span>' +
                    '</div></div>';
                if (global.appI18n && typeof global.appI18n.applyDom === 'function') {
                    global.appI18n.applyDom(this._panel);
                }
                return;
            }

            const typesHtml = LABEL_TYPES.map((id) => {
                const on = this._enabledTypes.has(id);
                return (
                    '<label class="lm-type-chip' +
                    (on ? ' active' : '') +
                    '" data-type="' +
                    id +
                    '">' +
                    '<input type="checkbox" class="lm-type-check" data-type="' +
                    id +
                    '"' +
                    (on ? ' checked' : '') +
                    '>' +
                    '<span data-i18n="ui.labels.type.' +
                    id +
                    '">' +
                    id +
                    '</span></label>'
                );
            }).join('');

            const masterOn =
                global.labelManager && typeof global.labelManager.isGloballyEnabled === 'function'
                    ? global.labelManager.isGloballyEnabled()
                    : true;

            this._panel.innerHTML =
                '<div class="label-manager-ui">' +
                '<div class="lm-section lm-master-section">' +
                '<label class="lm-master-toggle">' +
                '<input type="checkbox" id="lm-master-en"' +
                (masterOn ? ' checked' : '') +
                '/>' +
                '<span class="lm-master-label" data-i18n="ui.labels.masterToggle">Show labels on map</span>' +
                '</label>' +
                '<p class="lm-hint" data-i18n="ui.labels.masterHint">Uses bundled world data and optional region packs (.rlp).</p>' +
                '</div>' +
                '<div class="lm-section lm-download-section">' +
                '<div class="lm-section-header"><span data-i18n="ui.labels.downloadData">Label database</span></div>' +
                '<p class="lm-hint lm-hint-tight" data-i18n="ui.labels.downloadHint">Download label data over HTTPS into app storage (no manual Python/osmium step).</p>' +
                '<input type="url" id="lm-world-url" class="lm-select lm-url-input" autocomplete="off" data-i18n-placeholder="ui.labels.worldUrlPlaceholder" placeholder="https://…/labels-world-base.db" />' +
                '<div class="lm-download-actions">' +
                '<button type="button" class="lm-btn" id="lm-download-world-btn">' +
                '<i class="fas fa-cloud-download-alt" aria-hidden="true"></i> <span data-i18n="ui.labels.downloadWorld">Download world DB</span>' +
                '</button></div>' +
                '<input type="url" id="lm-region-url" class="lm-select lm-url-input" autocomplete="off" data-i18n-placeholder="ui.labels.regionUrlPlaceholder" placeholder="https://…/region.rlp" />' +
                '<div class="lm-download-actions">' +
                '<button type="button" class="lm-btn lm-btn-secondary" id="lm-download-region-btn">' +
                '<i class="fas fa-globe" aria-hidden="true"></i> <span data-i18n="ui.labels.downloadRegionUrl">Download region pack</span>' +
                '</button></div></div>' +
                '<div id="lm-controls" class="lm-controls">' +
                '<div class="lm-section">' +
                '<div class="lm-section-header">' +
                '<span data-i18n="ui.labels.types">Label types</span>' +
                '<button type="button" class="lm-btn-small" id="lm-types-all" data-i18n="ui.labels.all">All</button>' +
                '<button type="button" class="lm-btn-small" id="lm-types-none" data-i18n="ui.labels.none">None</button>' +
                '</div>' +
                '<div class="lm-type-grid" id="lm-type-grid">' +
                typesHtml +
                '</div></div>' +
                '<div class="lm-section">' +
                '<div class="lm-section-header"><span data-i18n="ui.labels.language">Label language</span></div>' +
                '<select id="lm-lang-select" class="lm-select" data-i18n-aria="ui.labels.languageAria">' +
                '<option value="default" data-i18n="ui.labels.langNative">Native (default)</option>' +
                '<option value="en">English</option>' +
                '<option value="ar">العربية</option>' +
                '</select></div>' +
                '<div class="lm-section">' +
                '<div class="lm-section-header">' +
                '<span data-i18n="ui.labels.regions">Installed regions</span>' +
                '<button type="button" class="lm-btn" id="lm-import-btn">' +
                '<i class="fas fa-plus" aria-hidden="true"></i> <span data-i18n="ui.labels.importRegion">Import pack (.rlp)</span>' +
                '</button></div>' +
                '<div id="lm-progress" class="lm-progress" style="display:none">' +
                '<div class="lm-progress-bar" id="lm-progress-bar" style="width:0%"></div>' +
                '<span id="lm-progress-msg"></span></div>' +
                '<div id="lm-region-list" class="lm-region-list">' +
                '<span class="lm-empty" data-i18n="ui.labels.noRegions">No regions installed</span>' +
                '</div></div></div></div>';

            if (global.appI18n && typeof global.appI18n.applyDom === 'function') {
                global.appI18n.applyDom(this._panel);
            }
            this._bindEvents();
            this._syncLabelManagerTypes();
            this._setControlsDisabled(!masterOn);
            this._prefillDownloadUrls();
        }

        _renderRegionList() {
            const list = this._panel && this._panel.querySelector('#lm-region-list');
            if (!list) return;

            if (!this._installedList.length) {
                list.innerHTML =
                    '<span class="lm-empty" data-i18n="ui.labels.noRegions">No regions installed</span>';
                if (global.appI18n && typeof global.appI18n.applyDom === 'function') {
                    global.appI18n.applyDom(list);
                }
                return;
            }

            list.innerHTML = this._installedList
                .map((r) => {
                    const en = r.enabled !== false;
                    const meta =
                        (r.count ? Number(r.count).toLocaleString() + ' · ' : '') +
                        (r.zoom && r.zoom.length === 2 ? 'z' + r.zoom[0] + '–' + r.zoom[1] : '');
                    return (
                        '<div class="lm-region-row" data-id="' +
                        String(r.id).replace(/"/g, '&quot;') +
                        '">' +
                        '<label class="lm-region-toggle">' +
                        '<input type="checkbox" class="lm-region-check" data-id="' +
                        String(r.id).replace(/"/g, '&quot;') +
                        '"' +
                        (en ? ' checked' : '') +
                        '>' +
                        '<span class="lm-region-name">' +
                        String(r.id) +
                        '</span>' +
                        (meta
                            ? '<span class="lm-region-meta">' + meta + '</span>'
                            : '') +
                        '</label>' +
                        '<button type="button" class="lm-btn-icon lm-region-remove" data-id="' +
                        String(r.id).replace(/"/g, '&quot;') +
                        '" data-i18n-title="ui.labels.removeRegionTitle" title="Remove">' +
                        '<i class="fas fa-trash" aria-hidden="true"></i></button></div>'
                    );
                })
                .join('');
            if (global.appI18n && typeof global.appI18n.applyDom === 'function') {
                global.appI18n.applyDom(list);
            }
        }

        _bindEvents() {
            const p = this._panel;
            if (!p) return;

            const master = p.querySelector('#lm-master-en');
            if (master) {
                master.addEventListener('change', () => {
                    if (global.labelManager && typeof global.labelManager.setGloballyEnabled === 'function') {
                        global.labelManager.setGloballyEnabled(!!master.checked);
                    }
                    this._setControlsDisabled(!master.checked);
                });
            }

            p.querySelectorAll('.lm-type-check').forEach((cb) => {
                cb.addEventListener('change', () => this._onTypeChange());
            });

            const allBtn = p.querySelector('#lm-types-all');
            if (allBtn) {
                allBtn.addEventListener('click', () => {
                    p.querySelectorAll('.lm-type-check').forEach((cb) => {
                        cb.checked = true;
                    });
                    this._onTypeChange();
                });
            }
            const noneBtn = p.querySelector('#lm-types-none');
            if (noneBtn) {
                noneBtn.addEventListener('click', () => {
                    p.querySelectorAll('.lm-type-check').forEach((cb) => {
                        cb.checked = false;
                    });
                    this._onTypeChange();
                });
            }

            const langSel = p.querySelector('#lm-lang-select');
            if (langSel) {
                langSel.addEventListener('change', (e) => {
                    if (global.labelManager) global.labelManager.setLanguage(e.target.value);
                });
            }

            const imp = p.querySelector('#lm-import-btn');
            if (imp) {
                imp.addEventListener('click', () => this._importRegion());
            }

            const dw = p.querySelector('#lm-download-world-btn');
            if (dw) {
                dw.addEventListener('click', () => this._downloadWorld());
            }
            const dr = p.querySelector('#lm-download-region-btn');
            if (dr) {
                dr.addEventListener('click', () => this._downloadRegionFromUrl());
            }

            const rlist = p.querySelector('#lm-region-list');
            if (rlist) {
                rlist.addEventListener('change', (e) => {
                    const t = e.target;
                    if (t && t.classList && t.classList.contains('lm-region-check')) {
                        this._onRegionToggle(t.getAttribute('data-id'), t.checked);
                    }
                });
                rlist.addEventListener('click', (e) => {
                    const btn = e.target && e.target.closest && e.target.closest('.lm-region-remove');
                    if (btn) this._removeRegion(btn.getAttribute('data-id'));
                });
            }
        }

        _bindImportProgress() {
            const api = this._labelsApi();
            if (!api || typeof api.onImportProgress !== 'function') return;
            if (this._unsubProgress) {
                this._unsubProgress();
                this._unsubProgress = null;
            }
            this._unsubProgress = api.onImportProgress(({ pct, msg }) => {
                const bar = this._panel && this._panel.querySelector('#lm-progress-bar');
                const msgEl = this._panel && this._panel.querySelector('#lm-progress-msg');
                const wrapper = this._panel && this._panel.querySelector('#lm-progress');
                if (!bar || !msgEl || !wrapper) return;
                wrapper.style.display = 'block';
                bar.style.width = pct + '%';
                msgEl.textContent = msg || '';
                if (pct >= 100) {
                    setTimeout(() => {
                        wrapper.style.display = 'none';
                    }, 2000);
                    this._loadInstalledRegions();
                    if (global.labelManager) global.labelManager.refresh();
                }
            });
        }

        _bindDownloadProgress() {
            const api = this._labelsApi();
            if (!api || typeof api.onDownloadProgress !== 'function') return;
            if (this._unsubDownload) {
                this._unsubDownload();
                this._unsubDownload = null;
            }
            this._unsubDownload = api.onDownloadProgress(({ pct, msg }) => {
                const bar = this._panel && this._panel.querySelector('#lm-progress-bar');
                const msgEl = this._panel && this._panel.querySelector('#lm-progress-msg');
                const wrapper = this._panel && this._panel.querySelector('#lm-progress');
                if (!bar || !msgEl || !wrapper) return;
                wrapper.style.display = 'block';
                bar.style.width = pct + '%';
                msgEl.textContent = msg || '';
                if (pct >= 100) {
                    setTimeout(() => {
                        wrapper.style.display = 'none';
                    }, 2200);
                    if (global.labelManager) global.labelManager.refresh();
                }
            });
        }

        async _prefillDownloadUrls() {
            const api = this._labelsApi();
            if (!api || typeof api.readDownloadManifest !== 'function' || !this._panel) return;
            try {
                const m = await api.readDownloadManifest();
                const w = this._panel.querySelector('#lm-world-url');
                if (w && m && typeof m.worldBaseUrl === 'string' && m.worldBaseUrl.trim()) {
                    w.value = m.worldBaseUrl.trim();
                }
            } catch (_) {
                /* ignore */
            }
        }

        /**
         * @param {boolean} busy
         */
        _setDownloadBusy(busy) {
            const p = this._panel;
            if (!p) return;
            ['#lm-download-world-btn', '#lm-download-region-btn', '#lm-import-btn'].forEach((sel) => {
                const b = p.querySelector(sel);
                if (b) b.disabled = !!busy;
            });
        }

        async _downloadWorld() {
            const api = this._labelsApi();
            if (!api || typeof api.downloadWorldBase !== 'function') return;
            const inp = this._panel && this._panel.querySelector('#lm-world-url');
            const u = inp && inp.value ? String(inp.value).trim() : '';
            this._setDownloadBusy(true);
            try {
                await api.downloadWorldBase(u ? { url: u } : {});
                if (global.notification && typeof global.notification.success === 'function') {
                    global.notification.success(
                        global.appI18n && typeof global.appI18n.t === 'function'
                            ? global.appI18n.t('ui.labels.downloadWorldDone')
                            : 'World label database installed.'
                    );
                }
                if (global.labelManager) global.labelManager.refresh();
            } catch (err) {
                console.error('[LabelManagerUI] download world:', err);
                if (global.notification && typeof global.notification.error === 'function') {
                    global.notification.error(err.message || String(err));
                }
            } finally {
                this._setDownloadBusy(false);
            }
        }

        async _downloadRegionFromUrl() {
            const api = this._labelsApi();
            if (!api || typeof api.downloadRegionPack !== 'function') return;
            const inp = this._panel && this._panel.querySelector('#lm-region-url');
            const u = inp && inp.value ? String(inp.value).trim() : '';
            if (!u) {
                if (global.notification && typeof global.notification.error === 'function') {
                    global.notification.error(
                        global.appI18n && typeof global.appI18n.t === 'function'
                            ? global.appI18n.t('ui.labels.regionUrlRequired')
                            : 'Enter a region pack URL (.rlp).'
                    );
                }
                return;
            }
            this._setDownloadBusy(true);
            try {
                await api.downloadRegionPack({ url: u });
                await this._loadInstalledRegions();
                if (global.notification && typeof global.notification.success === 'function') {
                    global.notification.success(
                        global.appI18n && typeof global.appI18n.t === 'function'
                            ? global.appI18n.t('ui.labels.downloadRegionDone')
                            : 'Region pack installed.'
                    );
                }
                if (global.labelManager) global.labelManager.refresh();
                if (inp) inp.value = '';
            } catch (err) {
                console.error('[LabelManagerUI] download region:', err);
                if (global.notification && typeof global.notification.error === 'function') {
                    global.notification.error(err.message || String(err));
                }
            } finally {
                this._setDownloadBusy(false);
            }
        }

        _onTypeChange() {
            if (!this._panel) return;
            const enabled = [];
            this._panel.querySelectorAll('.lm-type-check').forEach((cb) => {
                if (cb.checked) enabled.push(cb.getAttribute('data-type'));
            });
            this._enabledTypes = new Set(enabled);
            this._panel.querySelectorAll('.lm-type-chip').forEach((chip) => {
                const id = chip.getAttribute('data-type');
                chip.classList.toggle('active', this._enabledTypes.has(id));
            });
            this._syncLabelManagerTypes();
        }

        _syncLabelManagerTypes() {
            if (global.labelManager) {
                global.labelManager.setEnabledTypes(Array.from(this._enabledTypes));
            }
        }

        async _importRegion() {
            const api = this._labelsApi();
            if (!api) return;
            try {
                const result = await api.importRegion();
                if (result && !result.canceled) {
                    await this._loadInstalledRegions();
                    if (global.labelManager) global.labelManager.refresh();
                }
            } catch (err) {
                console.error('[LabelManagerUI] import error:', err);
                if (global.notification && typeof global.notification.error === 'function') {
                    global.notification.error(err.message || String(err));
                }
            }
        }

        async _onRegionToggle(regionId, enabled) {
            const api = this._labelsApi();
            if (!api || !regionId) return;
            await api.setRegionEnabled(regionId, enabled);
            const r = this._installedList.find((x) => x.id === regionId);
            if (r) r.enabled = enabled;
            const activeIds = this._installedList.filter((x) => x.enabled !== false).map((x) => x.id);
            if (global.labelManager) global.labelManager.setActiveRegions(activeIds);
        }

        async _removeRegion(regionId) {
            const api = this._labelsApi();
            if (!api || !regionId) return;
            const msg =
                global.appI18n && typeof global.appI18n.t === 'function'
                    ? global.appI18n.t('ui.labels.confirmRemove').replace('{id}', regionId)
                    : 'Remove region "' + regionId + '"?';
            if (typeof global.confirm === 'function' && !global.confirm(msg)) return;
            await api.removeRegion(regionId);
            this._installedList = this._installedList.filter((r) => r.id !== regionId);
            this._renderRegionList();
            const activeIds = this._installedList.filter((r) => r.enabled !== false).map((r) => r.id);
            if (global.labelManager) global.labelManager.setActiveRegions(activeIds);
        }

        async _loadInstalledRegions() {
            const api = this._labelsApi();
            if (!api) return;
            try {
                this._installedList = await api.listRegions();
                this._renderRegionList();
                const activeIds = this._installedList
                    .filter((r) => r.enabled !== false)
                    .map((r) => r.id);
                if (global.labelManager) global.labelManager.setActiveRegions(activeIds);
            } catch (err) {
                console.warn('[LabelManagerUI] listRegions:', err);
            }
        }
    }

    global.labelManagerUI = new LabelManagerUI();
})(typeof window !== 'undefined' ? window : this);
