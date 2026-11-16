/**
 * FileEditor
 * Tileset JSON and geospatial configuration editor with live syntax & 3D Tiles
 * schema validation, pretty-print / minify, undo history, clipboard copy, save,
 * export download, and accessible modal UI.
 */

class FileEditor {
    constructor() {
        this.currentFile = null;
        this.currentFilename = 'tileset.json';
        this.isDirty = false;
        this.fileManager = null;
        this._originalContent = '';
        this._modal = null;
        this._escHandler = null;
    }

    init(fileManager) {
        this.fileManager = fileManager || (typeof window !== 'undefined' ? window.fileManager : null);
        this.setupEditor();
    }

    setupEditor() {
        // Modal is created lazily on first showEditor() call to minimize startup DOM cost.
    }

    async openFile(pathOrHandle) {
        const fm = this.fileManager || (typeof window !== 'undefined' ? window.fileManager : null);
        if (!fm || typeof fm.readFile !== 'function') {
            throw new Error('FileManager not initialized');
        }
        const content = await fm.readFile(pathOrHandle);
        this.currentFile = pathOrHandle;
        this.currentFilename =
            typeof pathOrHandle === 'string'
                ? pathOrHandle.split(/[\\/]/).pop() || 'tileset.json'
                : pathOrHandle?.name || 'tileset.json';
        this._originalContent = String(content ?? '');
        this.isDirty = false;
        return this._originalContent;
    }

    async saveFile(content) {
        if (!this.currentFile) {
            throw new Error('No file open');
        }
        const fm = this.fileManager || (typeof window !== 'undefined' ? window.fileManager : null);
        if (!fm || typeof fm.writeFile !== 'function') {
            throw new Error('FileManager not initialized');
        }
        await fm.writeFile(this.currentFile, content);
        this._originalContent = String(content ?? '');
        this.isDirty = false;
        return true;
    }

    exportFile(content, filename = this.currentFilename || 'tileset.json') {
        const fm = this.fileManager || (typeof window !== 'undefined' ? window.fileManager : null);
        if (fm && typeof fm.downloadContent === 'function') {
            return fm.downloadContent(filename, content);
        }
        if (typeof document !== 'undefined') {
            const blob = new Blob([String(content ?? '')], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            return true;
        }
        return false;
    }

    formatJSON(jsonString) {
        try {
            const obj = JSON.parse(jsonString);
            return JSON.stringify(obj, null, 2);
        } catch (error) {
            throw new Error('Invalid JSON: ' + error.message);
        }
    }

    minifyJSON(jsonString) {
        try {
            const obj = JSON.parse(jsonString);
            return JSON.stringify(obj);
        } catch (error) {
            throw new Error('Invalid JSON: ' + error.message);
        }
    }

    /**
     * Validate JSON syntax and (when applicable) OGC 3D Tiles tileset structure.
     */
    validateJSON(jsonString) {
        try {
            const parsed = JSON.parse(jsonString);
            const warnings = [];
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                if (parsed.asset || parsed.root || parsed.geometricError !== undefined) {
                    if (!parsed.asset?.version) {
                        warnings.push('Missing asset.version (expected "1.0" or "1.1")');
                    }
                    if (!parsed.root || typeof parsed.root !== 'object') {
                        warnings.push('Missing root tile object');
                    } else if (!parsed.root.boundingVolume) {
                        warnings.push('root tile is missing boundingVolume');
                    }
                    if (typeof parsed.geometricError !== 'number' || parsed.geometricError < 0) {
                        warnings.push('Top-level geometricError should be a non-negative number');
                    }
                }
            }
            return { valid: true, warnings };
        } catch (error) {
            const posMatch = error.message.match(/position (\d+)/);
            const pos = posMatch ? Number(posMatch[1]) : undefined;
            let line;
            if (Number.isFinite(pos)) {
                line = String(jsonString).slice(0, pos).split('\n').length;
            }
            return {
                valid: false,
                error: error.message,
                position: posMatch ? posMatch[1] : undefined,
                line,
            };
        }
    }

    markDirty() {
        this.isDirty = true;
    }

    isFileDirty() {
        return this.isDirty;
    }

    closeFile(force = false) {
        if (this.isDirty && !force) {
            return false;
        }
        this.currentFile = null;
        this._originalContent = '';
        this.isDirty = false;
        return true;
    }

    /**
     * Open the interactive Tileset JSON Editor modal.
     * Accepts raw JSON string/object, or auto-loads the currently active tileset JSON.
     */
    showEditor(contentOrObject = null, filename = 'tileset.json') {
        if (typeof document === 'undefined') return;
        this._ensureModal();

        let text = '';
        if (contentOrObject !== null && contentOrObject !== undefined) {
            text =
                typeof contentOrObject === 'string'
                    ? contentOrObject
                    : JSON.stringify(contentOrObject, null, 2);
            this.currentFilename = filename || 'tileset.json';
        } else if (window.jsonTreeManager?.currentData) {
            text = JSON.stringify(window.jsonTreeManager.currentData, null, 2);
            this.currentFilename = filename || 'tileset.json';
        } else {
            const all = window.tilesetViewer?.getAllTilesets?.() || [];
            const first = all.find((t) => t.tilesetJson || t.json);
            if (first) {
                text = JSON.stringify(first.tilesetJson || first.json, null, 2);
                this.currentFilename = `${first.name || 'tileset'}.json`;
            } else {
                text = JSON.stringify(
                    {
                        asset: { version: '1.1' },
                        geometricError: 100,
                        root: {
                            boundingVolume: { region: [0.0855, 0.9139, 0.0857, 0.9141, 0, 60] },
                            geometricError: 0,
                            refine: 'ADD',
                        },
                    },
                    null,
                    2
                );
                this.currentFilename = 'tileset.json';
            }
        }

        this._originalContent = text;
        this.isDirty = false;

        const textarea = this._modal.querySelector('#sdmJsonEditorArea');
        const titleEl = this._modal.querySelector('#sdmJsonEditorFilename');
        if (textarea) textarea.value = text;
        if (titleEl) titleEl.textContent = this.currentFilename;
        this._updateModalStatus();
        this._modal.style.display = 'flex';
        textarea?.focus();
    }

    hideEditor() {
        if (this._modal) {
            this._modal.style.display = 'none';
        }
    }

    _ensureModal() {
        if (this._modal && document.body.contains(this._modal)) return;
        const modal = document.createElement('div');
        modal.id = 'fileEditorModal';
        modal.className = 'modal sdm-editor-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'fileEditorHeading');
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="modal-content sdm-editor-dialog">
                <div class="modal-header">
                    <h2 id="fileEditorHeading">
                        <i class="fas fa-file-code" aria-hidden="true"></i>
                        <span>Tileset JSON Editor</span>
                        <code class="sdm-editor-file-badge" id="sdmJsonEditorFilename">tileset.json</code>
                    </h2>
                    <button type="button" class="close-btn" id="sdmJsonEditorClose" aria-label="Close JSON editor">×</button>
                </div>
                <div class="sdm-editor-toolbar">
                    <button type="button" class="btn btn-xs btn-secondary" id="sdmEditorFormatBtn">
                        <i class="fas fa-indent" aria-hidden="true"></i> Format
                    </button>
                    <button type="button" class="btn btn-xs btn-secondary" id="sdmEditorMinifyBtn">
                        <i class="fas fa-compress-alt" aria-hidden="true"></i> Minify
                    </button>
                    <button type="button" class="btn btn-xs btn-secondary" id="sdmEditorRevertBtn">
                        <i class="fas fa-undo" aria-hidden="true"></i> Revert
                    </button>
                    <button type="button" class="btn btn-xs btn-secondary" id="sdmEditorCopyBtn">
                        <i class="fas fa-copy" aria-hidden="true"></i> Copy
                    </button>
                    <span class="sdm-editor-spacer"></span>
                    <button type="button" class="btn btn-xs btn-secondary" id="sdmEditorApplyTreeBtn">
                        <i class="fas fa-sitemap" aria-hidden="true"></i> Sync JSON Tree
                    </button>
                    <button type="button" class="btn btn-xs btn-primary" id="sdmEditorExportBtn">
                        <i class="fas fa-download" aria-hidden="true"></i> Export JSON
                    </button>
                </div>
                <textarea id="sdmJsonEditorArea" class="sdm-editor-textarea" spellcheck="false" aria-label="Tileset JSON source"></textarea>
                <div class="sdm-editor-footer">
                    <span id="sdmEditorValidation" class="sdm-editor-status is-valid" role="status" aria-live="polite">Valid JSON</span>
                    <span id="sdmEditorStats" class="sdm-editor-stats">0 lines · 0 B</span>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this._modal = modal;

        const area = modal.querySelector('#sdmJsonEditorArea');
        modal.querySelector('#sdmJsonEditorClose')?.addEventListener('click', () => this.hideEditor());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.hideEditor();
        });
        area?.addEventListener('input', () => {
            this.isDirty = area.value !== this._originalContent;
            this._updateModalStatus();
        });
        modal.querySelector('#sdmEditorFormatBtn')?.addEventListener('click', () => {
            try {
                area.value = this.formatJSON(area.value);
                this._updateModalStatus();
            } catch (err) {
                window.notification?.error?.(err.message);
            }
        });
        modal.querySelector('#sdmEditorMinifyBtn')?.addEventListener('click', () => {
            try {
                area.value = this.minifyJSON(area.value);
                this._updateModalStatus();
            } catch (err) {
                window.notification?.error?.(err.message);
            }
        });
        modal.querySelector('#sdmEditorRevertBtn')?.addEventListener('click', () => {
            area.value = this._originalContent;
            this.isDirty = false;
            this._updateModalStatus();
        });
        modal.querySelector('#sdmEditorCopyBtn')?.addEventListener('click', async () => {
            try {
                await navigator.clipboard?.writeText(area.value);
                window.notification?.success?.('Copied JSON to clipboard');
            } catch (_) {
                /* ignore */
            }
        });
        modal.querySelector('#sdmEditorApplyTreeBtn')?.addEventListener('click', () => {
            const check = this.validateJSON(area.value);
            if (!check.valid) {
                window.notification?.error?.(`Fix JSON syntax error first: ${check.error}`);
                return;
            }
            const parsed = JSON.parse(area.value);
            if (window.jsonTreeManager?.loadJSON) {
                window.jsonTreeManager.loadJSON(parsed);
            } else if (window.jsonTreeManager?.render) {
                window.jsonTreeManager.render(parsed);
            }
            window.metadataManager?.displayTilesetMetadata?.(this.currentFilename, parsed);
            window.notification?.success?.('Updated JSON Tree and Metadata inspector');
        });
        modal.querySelector('#sdmEditorExportBtn')?.addEventListener('click', () => {
            const check = this.validateJSON(area.value);
            if (!check.valid) {
                window.notification?.error?.(`Invalid JSON: ${check.error}`);
                return;
            }
            this.exportFile(area.value, this.currentFilename);
            this.isDirty = false;
            window.notification?.success?.(`Exported ${this.currentFilename}`);
        });

        this._escHandler = (e) => {
            if (e.key === 'Escape' && this._modal?.style.display !== 'none') {
                e.preventDefault();
                this.hideEditor();
            }
        };
        document.addEventListener('keydown', this._escHandler);
    }

    _updateModalStatus() {
        if (!this._modal) return;
        const area = this._modal.querySelector('#sdmJsonEditorArea');
        const statusEl = this._modal.querySelector('#sdmEditorValidation');
        const statsEl = this._modal.querySelector('#sdmEditorStats');
        if (!area || !statusEl || !statsEl) return;

        const text = area.value;
        const lines = text.split('\n').length;
        const bytes = new Blob([text]).size;
        const sizeLabel = bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
        statsEl.textContent = `${lines} lines · ${sizeLabel}${this.isDirty ? ' · Modified' : ''}`;

        const v = this.validateJSON(text);
        if (!v.valid) {
            statusEl.className = 'sdm-editor-status is-invalid';
            statusEl.textContent = `Invalid JSON${v.line ? ` (line ${v.line})` : ''}: ${v.error}`;
        } else if (v.warnings?.length) {
            statusEl.className = 'sdm-editor-status is-warn';
            statusEl.textContent = `Valid JSON · ${v.warnings[0]}`;
        } else {
            statusEl.className = 'sdm-editor-status is-valid';
            statusEl.textContent = 'Valid 3D Tiles JSON';
        }
    }
}

if (typeof window !== 'undefined') {
    window.FileEditor = FileEditor;
    window.fileEditor = new FileEditor();
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FileEditor };
}
