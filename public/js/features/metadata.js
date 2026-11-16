/**
 * MetadataManager
 * XSS-safe 3D feature & tileset metadata inspector with live search filter,
 * type-aware formatting, JSON clipboard copy, and CSV/JSON file export.
 */

class MetadataManager {
    constructor() {
        this.currentMetadata = null;
        this._filterQuery = '';
        if (typeof document !== 'undefined') {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.renderEmptyState());
            } else {
                this.renderEmptyState();
            }
        }
    }

    static escapeHtml(raw) {
        return String(raw ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    renderEmptyState() {
        const container = typeof document !== 'undefined' ? document.getElementById('metadataContent') : null;
        if (!container || this.currentMetadata) return;
        container.innerHTML = `
            <div class="metadata-empty-state">
                <i class="fas fa-cube" aria-hidden="true"></i>
                <p>Click any 3D feature or load a tileset to inspect its attributes, batch table properties, and spatial metadata.</p>
            </div>
        `;
    }

    /**
     * Display 3D feature or batch-table metadata with search & export toolbar.
     */
    displayFeatureMetadata(properties, feature = null, title = 'Feature Attributes') {
        const safeProps =
            properties && typeof properties === 'object' && !Array.isArray(properties)
                ? properties
                : {};
        this.currentMetadata = { properties: safeProps, feature, title, timestamp: Date.now() };
        this._filterQuery = '';
        this._render();
    }

    /**
     * Display summary metadata for a loaded 3D Tileset (`tileset.json`).
     */
    displayTilesetMetadata(tilesetName, tilesetJson) {
        if (!tilesetJson || typeof tilesetJson !== 'object') return;
        const summary = {
            tileset: tilesetName || 'Tileset',
            specVersion: tilesetJson.asset?.version || '1.0',
        };
        if (tilesetJson.asset?.tilesetVersion) {
            summary.tilesetVersion = tilesetJson.asset.tilesetVersion;
        }
        if (tilesetJson.asset?.gltfUpAxis) {
            summary.upAxis = tilesetJson.asset.gltfUpAxis;
        }
        if (typeof tilesetJson.geometricError === 'number') {
            summary.rootGeometricError = `${tilesetJson.geometricError} m`;
        }
        if (tilesetJson.root?.refine) {
            summary.refinement = tilesetJson.root.refine;
        }
        if (tilesetJson.properties && typeof tilesetJson.properties === 'object') {
            summary.schemaProperties = Object.keys(tilesetJson.properties).join(', ');
        }
        if (tilesetJson.asset?.extras && typeof tilesetJson.asset.extras === 'object') {
            for (const [k, v] of Object.entries(tilesetJson.asset.extras)) {
                summary[k] = Array.isArray(v) ? v.join(', ') : v;
            }
        }
        this.displayFeatureMetadata(summary, null, 'Tileset Metadata');
    }

    clear() {
        this.currentMetadata = null;
        this._filterQuery = '';
        this.renderEmptyState();
    }

    _render() {
        const container = typeof document !== 'undefined' ? document.getElementById('metadataContent') : null;
        if (!container) return;
        if (!this.currentMetadata) {
            this.renderEmptyState();
            return;
        }

        const entries = Object.entries(this.currentMetadata.properties || {});
        const q = this._filterQuery.trim().toLowerCase();
        const filtered = q
            ? entries.filter(
                  ([k, v]) =>
                      k.toLowerCase().includes(q) ||
                      String(v ?? '')
                          .toLowerCase()
                          .includes(q)
              )
            : entries;

        const esc = MetadataManager.escapeHtml;
        const rowsHtml =
            filtered.length === 0
                ? `<div class="metadata-empty-row">No matching properties</div>`
                : filtered
                      .map(
                          ([key, value]) => `
                    <div class="metadata-item">
                        <span class="metadata-key" title="${esc(key)}">${esc(key)}</span>
                        <span class="metadata-val">${this.formatValue(value)}</span>
                    </div>`
                      )
                      .join('');

        container.innerHTML = `
            <div class="metadata-toolbar">
                <div class="metadata-toolbar-top">
                    <span class="metadata-badge">${esc(this.currentMetadata.title || 'Metadata')} · ${entries.length}</span>
                    <div class="metadata-actions">
                        <button type="button" class="btn btn-xs" data-meta-action="copy" title="Copy metadata as JSON" aria-label="Copy metadata as JSON">
                            <i class="fas fa-copy" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="btn btn-xs" data-meta-action="csv" title="Export metadata as CSV" aria-label="Export metadata as CSV">
                            <i class="fas fa-file-csv" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
                ${
                    entries.length > 4
                        ? `<input type="search" class="metadata-filter-input search-input" placeholder="Filter attributes…" value="${esc(this._filterQuery)}" aria-label="Filter metadata attributes">`
                        : ''
                }
            </div>
            <div class="metadata-list">${rowsHtml}</div>
        `;

        container.querySelector('[data-meta-action="copy"]')?.addEventListener('click', () => {
            void this.copyAsJson();
        });
        container.querySelector('[data-meta-action="csv"]')?.addEventListener('click', () => {
            this.exportAsCsv();
        });
        const filterInput = container.querySelector('.metadata-filter-input');
        filterInput?.addEventListener('input', (e) => {
            const pos = e.target.selectionStart;
            this._filterQuery = e.target.value;
            this._render();
            const next = container.querySelector('.metadata-filter-input');
            if (next) {
                next.focus();
                try {
                    next.setSelectionRange(pos, pos);
                } catch (_) {
                    /* ignore */
                }
            }
        });
    }

    /**
     * Format a property value safely (always HTML-escaped).
     */
    formatValue(value) {
        const esc = MetadataManager.escapeHtml;
        if (value === null || value === undefined) {
            return '<em class="metadata-null">null</em>';
        }
        if (typeof value === 'boolean') {
            return `<span class="metadata-bool">${value ? 'true' : 'false'}</span>`;
        }
        if (typeof value === 'number') {
            const formatted = Number.isInteger(value)
                ? value.toLocaleString('en-US')
                : Number(value.toFixed(6)).toString();
            return `<span class="metadata-num">${esc(formatted)}</span>`;
        }
        if (typeof value === 'object') {
            try {
                return `<code class="metadata-json">${esc(JSON.stringify(value, null, 2))}</code>`;
            } catch (_) {
                return esc(String(value));
            }
        }
        return esc(String(value));
    }

    toCsvString() {
        const props = this.currentMetadata?.properties || {};
        const csvCell = (val) => {
            const raw =
                val === null || val === undefined
                    ? ''
                    : typeof val === 'object'
                      ? JSON.stringify(val)
                      : String(val);
            return `"${raw.replace(/"/g, '""')}"`;
        };
        const lines = ['"property","value"'];
        for (const [k, v] of Object.entries(props)) {
            lines.push(`${csvCell(k)},${csvCell(v)}`);
        }
        return lines.join('\n');
    }

    async copyAsJson() {
        if (!this.currentMetadata) return false;
        const json = JSON.stringify(this.currentMetadata.properties, null, 2);
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(json);
                window.notification?.success?.('Metadata copied to clipboard');
                return true;
            }
        } catch (_) {
            /* fall through */
        }
        return false;
    }

    exportAsCsv(filename = 'feature-metadata.csv') {
        if (!this.currentMetadata || typeof document === 'undefined') return false;
        const csv = this.toCsvString();
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        window.notification?.success?.(`Exported ${filename}`);
        return true;
    }
}

if (typeof window !== 'undefined') {
    window.MetadataManager = MetadataManager;
    window.metadataManager = new MetadataManager();
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MetadataManager };
}
