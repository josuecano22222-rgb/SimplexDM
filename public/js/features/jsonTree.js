/**
 * JSONTreeExplorer
 * JSON structure visualization and analysis
 */

class JSONTreeExplorer {
    constructor() {
        this.data = null;
        /** @type {{ label: string, url: string, data: object }[]|null} */
        this.multiSources = null;
        this.expandedPaths = new Set();
        this.searchResults = [];
        this.currentSearchIndex = -1;
        this.searchTerm = '';
        this.container = null;
        this.viewMode = 'tree'; // tree, hierarchy, analysis, validation
        this.bookmarkedPaths = new Set();
        /** Full structure scan — computed lazily (Analysis / Validation tabs) */
        this.analysis = null;
        this._analysisComputing = false;
        this._validationComputing = false;
        this._validationRenderedKey = '';
        this.init();
    }

    /**
     * Resolve cached parsed tileset JSON (same object Cesium/jsonConfig used when available).
     * @param {string} userUrl
     * @param {string} resolvedUrl
     * @returns {object|undefined}
     */
    _getCachedTilesetJson(userUrl, resolvedUrl) {
        const c = window.tilesetJsonCache;
        if (!c || typeof c.get !== 'function') return undefined;
        const fromUser = c.get(userUrl);
        if (fromUser !== undefined) return fromUser;
        if (typeof resolvedUrl === 'string') return c.get(resolvedUrl);
        return undefined;
    }

    /**
     * Fetch JSON with optional cache; prefers response.json() for native parsing.
     * @param {string} userUrl
     * @param {string} resolvedUrl
     */
    async _fetchJsonResolved(userUrl, resolvedUrl) {
        const cached = this._getCachedTilesetJson(userUrl, resolvedUrl);
        if (cached !== undefined) return cached;
        if (resolvedUrl && typeof resolvedUrl === 'object' && resolvedUrl.type === 'fileHandle') {
            const file = await resolvedUrl.handle.getFile();
            const text = await file.text();
            const data = JSON.parse(text);
            if (window.tilesetJsonCache && typeof window.tilesetJsonCache.set === 'function') {
                window.tilesetJsonCache.set(userUrl, data);
            }
            return data;
        }
        const response = await fetch(resolvedUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
    }

    _invalidateDerivedState() {
        this.analysis = null;
        this._analysisComputing = false;
        this._validationComputing = false;
        this._validationRenderedKey = '';
        this._validationResults = null;
    }

    /** Escape for double-quoted HTML attributes (paths may contain & and quotes) */
    _escapeAttr(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
    }

    /**
     * Initialize
     */
    init() {
        // Container will be set when needed
    }

    /**
     * Load JSON from URL or data
     */
    _labelFromUrl(url) {
        if (!url || typeof url !== 'string') return 'tileset';
        const q = url.indexOf('?');
        const base = q >= 0 ? url.slice(0, q) : url;
        const parts = base.replace(/\\/g, '/').split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : base;
    }

    /**
     * Load every tileset JSON currently in the scene (all trees visible; none replaced).
     * @param {string[]} urls
     */
    async loadAllFromUrls(urls) {
        const unique = [...new Set((urls || []).filter(Boolean))];
        if (unique.length === 0) {
            this.multiSources = null;
            this.data = null;
            this._invalidateDerivedState();
            this.render();
            return;
        }
        if (unique.length === 1) {
            this.multiSources = null;
            return this.loadJSON(unique[0]);
        }

        try {
            const resolver = window.pathResolver;
            const loaded = await Promise.all(
                unique.map(async (u) => {
                    const resolvedUrl =
                        resolver && typeof resolver.resolvePath === 'function'
                            ? await resolver.resolvePath(u)
                            : u;
                    const data = await this._fetchJsonResolved(
                        u,
                        typeof resolvedUrl === 'string' ? resolvedUrl : resolvedUrl
                    );
                    return {
                        label: this._labelFromUrl(u),
                        url: u,
                        data
                    };
                })
            );

            this.multiSources = loaded;
            this.data = loaded[0].data;

            this.expandedPaths.clear();
            this.searchResults = [];
            this.currentSearchIndex = -1;

            this._invalidateDerivedState();
            this.render();
            return loaded;
        } catch (error) {
            console.error('Failed to load multi JSON:', error);
            this.multiSources = null;
            if (this.container) {
                this.container.innerHTML = `<div class="json-error">Error loading JSON: ${error.message}</div>`;
            }
            throw error;
        }
    }

    async loadJSON(urlOrData) {
        try {
            this.multiSources = null;
            if (typeof urlOrData === 'string') {
                const resolvedUrl = await window.pathResolver.resolvePath(urlOrData);
                this.data = await this._fetchJsonResolved(
                    urlOrData,
                    typeof resolvedUrl === 'string' ? resolvedUrl : resolvedUrl
                );
            } else {
                this.data = urlOrData;
            }
            
            // Reset state
            this.expandedPaths.clear();
            this.searchResults = [];
            this.currentSearchIndex = -1;
            
            this._invalidateDerivedState();
            this.render();
            return this.data;
        } catch (error) {
            console.error('Failed to load JSON:', error);
            if (this.container) {
                this.container.innerHTML = `<div class="json-error">Error loading JSON: ${error.message}</div>`;
            }
            throw error;
        }
    }

    /**
     * Set container element
     */
    setContainer(container) {
        this.container = container;
        
        // Check if we're in dashboard or sidebar
        const isDashboard = container.closest('#dashboardJsonTreeTab');
        const controlsContainer = isDashboard ? 
            document.getElementById('dashboardJsonTreeControls') : 
            document.getElementById('jsonTreeControls');
        
        if (controlsContainer) {
            // Temporarily set container to controls container for rendering
            const originalContainer = this.container;
            this.container = controlsContainer;
            this.renderControls();
            this.container = originalContainer;
        } else {
            this.renderControls();
        }
        
        if (this.data) {
            this.render();
        }
    }

    /**
     * Render control panel
     */
    renderControls() {
        const controlsContainer = document.getElementById('jsonTreeControls');
        if (!controlsContainer) return;

        controlsContainer.innerHTML = `
            <div class="json-tree-controls">
                <!-- View Mode Selector -->
                <div class="view-mode-section">
                    <div class="view-mode-buttons">
                        <button class="view-mode-btn ${this.viewMode === 'tree' ? 'active' : ''}" data-mode="tree">Tree</button>
                        <button class="view-mode-btn ${this.viewMode === 'hierarchy' ? 'active' : ''}" data-mode="hierarchy">Hierarchy</button>
                        <button class="view-mode-btn ${this.viewMode === 'analysis' ? 'active' : ''}" data-mode="analysis">Analysis</button>
                        <button class="view-mode-btn ${this.viewMode === 'validation' ? 'active' : ''}" data-mode="validation">Validation</button>
                    </div>
                </div>

                <!-- Search Section -->
                <div class="search-section">
                    <input type="text" id="jsonSearchInput" class="search-input" placeholder="Search JSON..." />
                    <button id="jsonSearchClear" class="btn-small" style="display: none;">Clear</button>
                    <div class="search-results" id="jsonSearchResults" style="display: none;">
                        <span id="jsonSearchCounter"></span>
                        <button id="jsonSearchPrev" class="btn-small">◀</button>
                        <button id="jsonSearchNext" class="btn-small">▶</button>
                    </div>
                </div>

                <!-- Filter Section -->
                <div class="filter-section">
                    <label><input type="checkbox" id="jsonFilterNull" checked> Show Null</label>
                    <label><input type="checkbox" id="jsonFilterEmpty" checked> Show Empty</label>
                    <label><input type="checkbox" id="jsonFilterCaseSensitive"> Case Sensitive</label>
                </div>

                <!-- Quick Actions -->
                <div class="quick-actions-section">
                    <button id="jsonExpandAll" class="btn-small">Expand All</button>
                    <button id="jsonCollapseAll" class="btn-small">Collapse All</button>
                    <button id="jsonDownload" class="btn-small">Download</button>
                </div>
            </div>
        `;

        // Set up control panel event handlers
        this.setupControlPanelHandlers();
    }

    /**
     * Set up control panel event handlers
     */
    setupControlPanelHandlers() {
        // View mode buttons
        document.querySelectorAll('.view-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.target.dataset.mode;
                this.setViewMode(mode);
                // Update active state
                document.querySelectorAll('.view-mode-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
            });
        });

        // Search input
        const searchInput = document.getElementById('jsonSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value;
                if (term) {
                    this.performSearch(term);
                    document.getElementById('jsonSearchClear').style.display = 'inline-block';
                    if (this.searchResults.length > 0) {
                        document.getElementById('jsonSearchResults').style.display = 'flex';
                        document.getElementById('jsonSearchCounter').textContent = 
                            `${this.currentSearchIndex + 1}/${this.searchResults.length}`;
                    }
                } else {
                    this.performSearch('');
                    document.getElementById('jsonSearchClear').style.display = 'none';
                    document.getElementById('jsonSearchResults').style.display = 'none';
                }
            });

            // Keyboard shortcuts
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.nextSearchResult();
                } else if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    this.previousSearchResult();
                } else if (e.key === 'Escape') {
                    e.target.value = '';
                    this.performSearch('');
                    document.getElementById('jsonSearchClear').style.display = 'none';
                    document.getElementById('jsonSearchResults').style.display = 'none';
                }
            });
        }

        // Search clear button
        document.getElementById('jsonSearchClear')?.addEventListener('click', () => {
            const searchInput = document.getElementById('jsonSearchInput');
            if (searchInput) {
                searchInput.value = '';
                this.performSearch('');
                document.getElementById('jsonSearchClear').style.display = 'none';
                document.getElementById('jsonSearchResults').style.display = 'none';
            }
        });

        // Search navigation
        document.getElementById('jsonSearchPrev')?.addEventListener('click', () => {
            this.previousSearchResult();
            if (this.searchResults.length > 0) {
                document.getElementById('jsonSearchCounter').textContent = 
                    `${this.currentSearchIndex + 1}/${this.searchResults.length}`;
            }
        });

        document.getElementById('jsonSearchNext')?.addEventListener('click', () => {
            this.nextSearchResult();
            if (this.searchResults.length > 0) {
                document.getElementById('jsonSearchCounter').textContent = 
                    `${this.currentSearchIndex + 1}/${this.searchResults.length}`;
            }
        });

        // Expand/Collapse buttons
        document.getElementById('jsonExpandAll')?.addEventListener('click', () => {
            this.expandAll();
        });

        document.getElementById('jsonCollapseAll')?.addEventListener('click', () => {
            this.collapseAll();
        });

        // Download button
        document.getElementById('jsonDownload')?.addEventListener('click', () => {
            this.downloadJSON('pretty');
        });
    }

    /**
     * Render JSON tree
     */
    render() {
        if (!this.container) return;

        if (this.viewMode === 'tree') {
            this.renderTreeView();
        } else if (this.viewMode === 'hierarchy') {
            this.renderHierarchyView();
        } else if (this.viewMode === 'analysis') {
            this.renderAnalysisView();
        } else if (this.viewMode === 'validation') {
            this.renderValidationView();
        }
    }

    /**
     * Render tree view
     */
    renderTreeView() {
        if (!this.container) return;

        if (this.multiSources && this.multiSources.length > 0) {
            let html = '<div class="json-tree-multi">';
            this.multiSources.forEach((src, i) => {
                const basePath = `src${i}`;
                html += '<section class="json-tree-source-block">';
                html += '<div class="json-tree-source-head">';
                html += `<span class="json-tree-source-title">${this.escapeHtml(src.label)}</span>`;
                html += `<span class="json-tree-source-path">${this.escapeHtml(src.url)}</span>`;
                html += '</div><div class="json-tree">';
                html += this.renderNode(src.data, basePath, 'root');
                html += '</div></section>';
            });
            html += '</div>';
            this.container.innerHTML = html;
            this.setupTreeEventHandlers();
            return;
        }

        let html = '<div class="json-tree">';
        html += this.renderNode(this.data, '', 'root');
        html += '</div>';

        this.container.innerHTML = html;

        // Set up event handlers
        this.setupTreeEventHandlers();
    }

    /**
     * Render node recursively
     */
    renderNode(value, path, key) {
        const isExpanded = this.expandedPaths.has(path);
        const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
        const isArray = Array.isArray(value);
        const isExpandable = isObject || isArray;

        let html = '<div class="tree-node">';
        html += '<div class="tree-node-line" data-path="' + path + '">';
        
        // Indent
        const depth = path.split('.').length - 1;
        html += '<span class="tree-indent" style="width: ' + (depth * 20) + 'px;"></span>';
        
        // Toggle button
        if (isExpandable) {
            html += '<span class="tree-toggle">' + (isExpanded ? '▼' : '▶') + '</span>';
        } else {
            html += '<span class="tree-indent" style="width: 16px;"></span>';
        }

        // Key
        if (key !== 'root') {
            html += '<span class="tree-key">' + this.escapeHtml(key) + ':</span> ';
        }

        // Value
        if (isExpandable) {
            const count = isArray ? value.length : Object.keys(value).length;
            html += '<span class="tree-count">(' + count + ' ' + (isArray ? 'items' : 'properties') + ')</span>';
        } else {
            html += '<span class="tree-value ' + this.getValueType(value) + '">' + 
                    this.formatValue(value) + '</span>';
        }

        // Bookmark
        if (this.bookmarkedPaths.has(path)) {
            html += ' <span class="tree-bookmark">★</span>';
        }

        // Copy button (data-path avoids broken HTML when path contains quotes)
        html +=
            '<button type="button" class="copy-btn" data-path="' +
            this._escapeAttr(path) +
            '">Copy</button>';

        html += '</div>';

        // Children
        if (isExpandable && isExpanded) {
            if (isArray) {
                value.forEach((item, index) => {
                    const childPath = path ? path + '[' + index + ']' : '[' + index + ']';
                    html += this.renderNode(item, childPath, index);
                });
            } else {
                Object.keys(value).forEach(subKey => {
                    const childPath = path ? path + '.' + subKey : subKey;
                    html += this.renderNode(value[subKey], childPath, subKey);
                });
            }
        }

        html += '</div>';
        return html;
    }

    /**
     * Format value for display
     */
    formatValue(value) {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) return String(value);
            if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) return String(value);
            const ax = Math.abs(value);
            if (ax >= 1e15 || (ax > 0 && ax < 1e-15)) return String(value.toPrecision(16));
            const fixed = value.toFixed(12);
            return fixed.replace(/\.?0+$/, '') || '0';
        }
        if (typeof value === 'string') {
            if (value.length > 200) {
                return '"' + value.substring(0, 200) + '..." (' + value.length + ' chars)';
            }
            return '"' + this.escapeHtml(value) + '"';
        }
        return String(value);
    }

    /**
     * Resolve a tree row by path (avoids CSS selector breakage from [], quotes, etc.)
     */
    _findTreeNodeLineByPath(path) {
        if (!this.container) return null;
        const lines = this.container.querySelectorAll('.tree-node-line[data-path]');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].getAttribute('data-path') === path) return lines[i];
        }
        return null;
    }

    /**
     * Get value type for CSS class
     */
    getValueType(value) {
        if (value === null) return 'null';
        return typeof value;
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Set up tree event handlers
     */
    setupTreeEventHandlers() {
        if (!this.container) return;

        // Toggle expand/collapse
        this.container.querySelectorAll('.tree-toggle').forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const line = toggle.closest('.tree-node-line');
                const path = line.dataset.path;
                this.toggleNode(path);
            });
        });

        this.container.querySelectorAll('.copy-btn[data-path]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const p = btn.getAttribute('data-path');
                if (p != null) this.copyPath(p);
            });
        });

        // Highlight search results
        if (this.searchTerm) {
            this.highlightSearchResults();
        }
    }

    /**
     * Toggle node expand/collapse
     */
    toggleNode(path) {
        if (this.expandedPaths.has(path)) {
            this.expandedPaths.delete(path);
        } else {
            this.expandedPaths.add(path);
        }
        this.render();
    }

    /**
     * Expand all
     */
    expandAll() {
        if (this.multiSources && this.multiSources.length > 0) {
            this.multiSources.forEach((src, i) => {
                this.expandNode(src.data, `src${i}`);
            });
        } else {
            this.expandNode(this.data, '');
        }
        this.render();
    }

    /**
     * Expand node recursively
     */
    expandNode(value, path) {
        this.expandedPaths.add(path);
        
        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                const childPath = path ? path + '[' + index + ']' : '[' + index + ']';
                this.expandNode(item, childPath);
            });
        } else if (typeof value === 'object' && value !== null) {
            Object.keys(value).forEach(key => {
                const childPath = path ? path + '.' + key : key;
                this.expandNode(value[key], childPath);
            });
        }
    }

    /**
     * Collapse all
     */
    collapseAll() {
        this.expandedPaths.clear();
        this.render();
    }

    /**
     * Perform search
     */
    performSearch(term) {
        this.searchTerm = term.toLowerCase();
        this.searchResults = [];
        this.currentSearchIndex = -1;

        if (!term) {
            this.render();
            return;
        }

        if (this.multiSources && this.multiSources.length > 0) {
            this.multiSources.forEach((src, i) => {
                this.searchNode(src.data, `src${i}`, 'root', term);
            });
        } else {
            this.searchNode(this.data, '', 'root', term);
        }
        this.render();
        this.highlightSearchResults();
    }

    /**
     * Search node recursively
     */
    searchNode(value, path, key, term) {
        const searchKey = String(key).toLowerCase();
        let haystack = '';
        if (value === null || value === undefined) {
            haystack = String(value).toLowerCase();
        } else if (typeof value === 'object') {
            haystack = searchKey;
        } else {
            haystack = String(value).toLowerCase();
        }

        if (searchKey.includes(term) || haystack.includes(term)) {
            this.searchResults.push(path);
        }

        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                const childPath = path ? path + '[' + index + ']' : '[' + index + ']';
                this.searchNode(item, childPath, index, term);
            });
        } else if (typeof value === 'object' && value !== null) {
            Object.keys(value).forEach(subKey => {
                const childPath = path ? path + '.' + subKey : subKey;
                this.searchNode(value[subKey], childPath, subKey, term);
            });
        }
    }

    /**
     * Highlight search results
     */
    highlightSearchResults() {
        if (!this.container || this.searchResults.length === 0) return;

        this.container.querySelectorAll('.tree-node-line.highlighted, .tree-node-line.current-match').forEach((el) => {
            el.classList.remove('highlighted', 'current-match');
        });

        this.searchResults.forEach((path, index) => {
            const element = this._findTreeNodeLineByPath(path);
            if (element) {
                element.classList.add('highlighted');
                if (index === this.currentSearchIndex) {
                    element.classList.add('current-match');
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });
    }

    /**
     * Navigate to next search result
     */
    nextSearchResult() {
        if (this.searchResults.length === 0) return;
        this.currentSearchIndex = (this.currentSearchIndex + 1) % this.searchResults.length;
        this.highlightSearchResults();
    }

    /**
     * Navigate to previous search result
     */
    previousSearchResult() {
        if (this.searchResults.length === 0) return;
        this.currentSearchIndex = (this.currentSearchIndex - 1 + this.searchResults.length) % this.searchResults.length;
        this.highlightSearchResults();
    }

    /**
     * Perform analysis
     */
    performAnalysis() {
        if (this.multiSources && this.multiSources.length > 0) {
            const nested = [];
            const cref = { b3dm: [], tileset: [], other: [] };
            const bv = { sphere: [], box: [], region: [] };
            const errLists = [];
            this.multiSources.forEach((src, i) => {
                const tag = src.label || `src${i}`;
                nested.push(
                    ...this.findNestedTilesets(src.data).map((n) => ({
                        ...n,
                        source: tag,
                        path: `[${tag}] ${n.path}`
                    }))
                );
                const c = this.analyzeContentReferences(src.data);
                cref.b3dm.push(...c.b3dm.map((u) => `[${tag}] ${u}`));
                cref.tileset.push(...c.tileset.map((u) => `[${tag}] ${u}`));
                cref.other.push(...c.other.map((u) => `[${tag}] ${u}`));
                const v = this.analyzeBoundingVolumes(src.data);
                bv.sphere.push(...v.sphere.map((x) => ({ ...x, path: `[${tag}] ${x.path}` })));
                bv.box.push(...v.box.map((x) => ({ ...x, path: `[${tag}] ${x.path}` })));
                bv.region.push(...v.region.map((x) => ({ ...x, path: `[${tag}] ${x.path}` })));
                errLists.push(this.analyzeGeometricErrors(src.data).errors);
            });
            const flatErr = errLists.flat();
            const vals = flatErr.map((e) => e.value);
            const geometricErrors =
                vals.length > 0
                    ? {
                          errors: flatErr.sort((a, b) => b.value - a.value),
                          min: Math.min(...vals),
                          max: Math.max(...vals),
                          avg: vals.reduce((a, b) => a + b, 0) / vals.length,
                          count: vals.length
                      }
                    : { errors: [], min: 0, max: 0, avg: 0, count: 0 };
            return {
                nestedTilesets: nested,
                contentReferences: cref,
                boundingVolumes: bv,
                geometricErrors
            };
        }

        if (!this.data) return null;

        return {
            nestedTilesets: this.findNestedTilesets(this.data),
            contentReferences: this.analyzeContentReferences(this.data),
            boundingVolumes: this.analyzeBoundingVolumes(this.data),
            geometricErrors: this.analyzeGeometricErrors(this.data)
        };
    }

    /**
     * Find nested tilesets
     * @param {object} [data] - defaults to this.data
     */
    findNestedTilesets(data) {
        const root = data !== undefined ? data : this.data;
        const nested = [];

        const traverse = (value, path) => {
            if (typeof value === 'object' && value !== null) {
                if (value.content && value.content.uri && value.content.uri.endsWith('.json')) {
                    nested.push({
                        path: path,
                        uri: value.content.uri,
                        geometricError: value.geometricError
                    });
                }

                if (Array.isArray(value)) {
                    value.forEach((item, index) => {
                        traverse(item, path + '[' + index + ']');
                    });
                } else {
                    Object.keys(value).forEach((key) => {
                        traverse(value[key], path ? path + '.' + key : key);
                    });
                }
            }
        };

        if (root) traverse(root, 'root');
        return nested;
    }

    /**
     * Analyze content references
     * @param {object} [data]
     */
    analyzeContentReferences(data) {
        const root = data !== undefined ? data : this.data;
        const references = { b3dm: [], tileset: [], other: [] };

        const traverse = (value) => {
            if (typeof value === 'object' && value !== null) {
                if (value.content && value.content.uri) {
                    const uri = value.content.uri;
                    if (uri.endsWith('.b3dm')) {
                        references.b3dm.push(uri);
                    } else if (uri.endsWith('.json')) {
                        references.tileset.push(uri);
                    } else {
                        references.other.push(uri);
                    }
                }

                if (Array.isArray(value)) {
                    value.forEach((item) => traverse(item));
                } else {
                    Object.values(value).forEach((item) => traverse(item));
                }
            }
        };

        if (root) traverse(root);
        return references;
    }

    /**
     * Analyze bounding volumes
     * @param {object} [data]
     */
    analyzeBoundingVolumes(data) {
        const root = data !== undefined ? data : this.data;
        const volumes = { sphere: [], box: [], region: [] };

        const traverse = (value, path) => {
            if (typeof value === 'object' && value !== null) {
                if (value.boundingVolume) {
                    const bv = value.boundingVolume;
                    if (bv.sphere) {
                        volumes.sphere.push({ path, data: bv.sphere });
                    } else if (bv.box) {
                        volumes.box.push({ path, data: bv.box });
                    } else if (bv.region) {
                        volumes.region.push({ path, data: bv.region });
                    }
                }

                if (Array.isArray(value)) {
                    value.forEach((item, index) => traverse(item, path + '[' + index + ']'));
                } else {
                    Object.keys(value).forEach((key) =>
                        traverse(value[key], path ? path + '.' + key : key)
                    );
                }
            }
        };

        if (root) traverse(root, 'root');
        return volumes;
    }

    /**
     * Analyze geometric errors
     * @param {object} [data]
     */
    analyzeGeometricErrors(data) {
        const root = data !== undefined ? data : this.data;
        const errors = [];

        const traverse = (value, path) => {
            if (typeof value === 'object' && value !== null) {
                if (typeof value.geometricError === 'number') {
                    errors.push({ path, value: value.geometricError });
                }

                if (Array.isArray(value)) {
                    value.forEach((item, index) => traverse(item, path + '[' + index + ']'));
                } else {
                    Object.keys(value).forEach((key) =>
                        traverse(value[key], path ? path + '.' + key : key)
                    );
                }
            }
        };

        if (root) traverse(root, 'root');

        const values = errors.map((e) => e.value);
        if (values.length === 0) {
            return {
                errors: [],
                min: 0,
                max: 0,
                avg: 0,
                count: 0
            };
        }
        return {
            errors: errors.sort((a, b) => b.value - a.value),
            min: Math.min(...values),
            max: Math.max(...values),
            avg: values.reduce((a, b) => a + b, 0) / values.length,
            count: values.length
        };
    }

    /**
     * Render hierarchy view
     */
    renderHierarchyView() {
        // Simplified hierarchy view
        this.renderTreeView();
    }

    /**
     * Render analysis view
     */
    renderAnalysisView() {
        if (!this.container) return;
        if (!this.multiSources?.length && !this.data) return;

        if (!this.analysis) {
            if (this._analysisComputing) return;
            this._analysisComputing = true;
            this.container.innerHTML =
                '<div class="json-tree-loading">Analyzing structure…</div>';
            const run = () => {
                try {
                    this.analysis = this.performAnalysis();
                } finally {
                    this._analysisComputing = false;
                }
                if (this.viewMode === 'analysis' && this.container) {
                    this.renderAnalysisView();
                }
            };
            if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(run, { timeout: 2000 });
            } else {
                setTimeout(run, 0);
            }
            return;
        }

        let html = '<div class="analysis-view">';
        
        // Nested Tilesets
        html += '<div class="analysis-panel"><h5>Nested Tilesets</h5>';
        html += '<div class="analysis-list">';
        this.analysis.nestedTilesets.forEach(nested => {
            html += `<div class="analysis-item">${nested.uri}<div class="analysis-item-path">${nested.path}</div></div>`;
        });
        html += '</div></div>';

        // Content References
        html += '<div class="analysis-panel"><h5>Content References</h5>';
        html += '<div class="analysis-list">';
        html += `<div>B3DM: ${this.analysis.contentReferences.b3dm.length}</div>`;
        html += `<div>Tilesets: ${this.analysis.contentReferences.tileset.length}</div>`;
        html += `<div>Other: ${this.analysis.contentReferences.other.length}</div>`;
        html += '</div></div>';

        // Geometric Errors
        html += '<div class="analysis-panel"><h5>Geometric Errors</h5>';
        const ge = this.analysis.geometricErrors;
        const n = ge && ge.count > 0;
        html += `<div>Min: ${n ? ge.min.toFixed(2) : '—'}</div>`;
        html += `<div>Max: ${n ? ge.max.toFixed(2) : '—'}</div>`;
        html += `<div>Avg: ${n ? ge.avg.toFixed(2) : '—'}</div>`;
        html += `<div>Count: ${ge ? ge.count : 0}</div>`;
        html += '</div>';

        html += '</div>';
        this.container.innerHTML = html;
    }

    /**
     * Render validation view
     */
    renderValidationView() {
        if (!this.container) return;

        if (!this.multiSources?.length && !this.data) {
            this.container.innerHTML =
                '<div class="json-error">No JSON loaded</div>';
            return;
        }

        const key =
            this.multiSources?.length > 0
                ? this.multiSources.map((s) => s.url + '\0' + s.label).join('|')
                : 'single:' + (this.data && typeof this.data === 'object' ? 'obj' : '');

        if (this._validationRenderedKey !== key) {
            if (this._validationComputing) return;
            this._validationComputing = true;
            this.container.innerHTML =
                '<div class="json-tree-loading">Validating tileset…</div>';
            const run = () => {
                try {
                    const runOne = (data, label) => {
                        const validation = window.tilesetProcessor
                            ? window.tilesetProcessor.validateTileset(data)
                            : { valid: true, errors: [], warnings: [] };
                        return { label, ...validation };
                    };

                    this._validationResults =
                        this.multiSources && this.multiSources.length > 0
                            ? this.multiSources.map((s) => runOne(s.data, s.label))
                            : [runOne(this.data, null)];
                    this._validationRenderedKey = key;
                } finally {
                    this._validationComputing = false;
                }
                if (this.viewMode === 'validation' && this.container) {
                    this.renderValidationView();
                }
            };
            if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(run, { timeout: 2000 });
            } else {
                setTimeout(run, 0);
            }
            return;
        }

        const results = this._validationResults;
        if (!results) return;

        let html = '<div class="validation-view">';
        results.forEach((validation, idx) => {
            if (validation.label) {
                html += `<div class="json-tree-source-head validation-source-head"><span class="json-tree-source-title">${this.escapeHtml(validation.label)}</span></div>`;
            }
            html += `<div class="validation-summary">`;
            html += `<div class="validation-status ${validation.valid ? 'valid' : 'invalid'}">`;
            html += validation.valid ? '✓ Valid' : '✕ Invalid';
            html += `</div>`;
            html += `<div class="validation-counts">`;
            html += `<span class="validation-count error">Errors: ${validation.errors.length}</span>`;
            html += `<span class="validation-count warning">Warnings: ${validation.warnings.length}</span>`;
            html += `</div></div>`;

            if (validation.errors.length > 0) {
                html += '<div class="validation-list">';
                validation.errors.forEach((error) => {
                    html += `<div class="validation-item error">${this.escapeHtml(String(error))}</div>`;
                });
                html += '</div>';
            }

            if (validation.warnings.length > 0) {
                html += '<div class="validation-list">';
                validation.warnings.forEach((warning) => {
                    html += `<div class="validation-item warning">${this.escapeHtml(String(warning))}</div>`;
                });
                html += '</div>';
            }
            if (idx < results.length - 1) {
                html += '<hr class="validation-between-sources" />';
            }
        });
        html += '</div>';
        this.container.innerHTML = html;
    }

    /**
     * Set view mode
     */
    setViewMode(mode) {
        this.viewMode = mode;
        this.render();
    }

    /**
     * Copy path to clipboard
     */
    copyPath(path) {
        navigator.clipboard.writeText(path).then(() => {
            window.notification?.success('Path copied to clipboard');
        });
    }

    /**
     * Download JSON
     */
    downloadJSON(format = 'pretty') {
        let payload = this.data;
        let filename = 'tileset.json';
        if (this.multiSources && this.multiSources.length > 0) {
            payload = {};
            this.multiSources.forEach((s) => {
                payload[s.label] = s.data;
            });
            filename = 'tilesets-bundle.json';
        }
        if (!payload) return;

        let jsonString;
        switch (format) {
            case 'minified':
                jsonString = JSON.stringify(payload);
                break;
            case 'sorted':
                jsonString = JSON.stringify(payload, this.sortKeys, 2);
                break;
            default:
                jsonString = JSON.stringify(payload, null, 2);
        }

        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Sort keys for JSON
     */
    sortKeys(key, value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return Object.keys(value).sort().reduce((result, key) => {
                result[key] = value[key];
                return result;
            }, {});
        }
        return value;
    }
}

// Export singleton instance
window.jsonTreeExplorer = new JSONTreeExplorer();
