/**
 * OfflineStatusUI
 * Displays live offline labels, raster/vector tile cache, and project bundle integrity
 * in the bottom status bar. Clicking the indicator opens the Offline Label Manager.
 */
class OfflineStatusUI {
    constructor() {
        this.el = null;
        this.lastStatus = null;
    }

    init() {
        this._ensureEl();
        window.addEventListener('simplex:projectChanged', () => void this.refresh());
        window.addEventListener('offlineRasterSourceChanged', () => void this.refresh());
        window.addEventListener('online', () => void this.refresh());
        window.addEventListener('offline', () => void this.refresh());
        void this.refresh();
    }

    _ensureEl() {
        const statusRight = document.querySelector('.status-right');
        if (!statusRight) return;
        let el = document.getElementById('offlineStatus');
        if (!el) {
            el = document.createElement('button');
            el.type = 'button';
            el.id = 'offlineStatus';
            el.className = 'status-offline-pill';
            el.textContent = 'Offline: Ready';
            el.title = 'Offline data & place labels status — click to manage offline labels';
            el.addEventListener('click', () => {
                if (window.labelManagerUI?.toggle) {
                    window.labelManagerUI.toggle();
                } else if (window.labelManagerUI?.open) {
                    window.labelManagerUI.open();
                } else {
                    document.getElementById('labelsToolbarBtn')?.click();
                }
            });
            statusRight.insertBefore(el, statusRight.firstChild);
        }
        this.el = el;
    }

    async refresh() {
        if (!this.el) this._ensureEl();
        if (!this.el) return;

        // 1. If a .simplex GIS project bundle is active, verify its integrity first
        const projectPath = window.projectManager?.currentProjectPath;
        if (projectPath && window.electronAPI?.gis?.offline?.integrityCheck) {
            try {
                const integrity = await window.electronAPI.gis.offline.integrityCheck(projectPath);
                if (!integrity.ok) {
                    this.el.textContent = `Project: Missing ${integrity.missing.join(', ')}`;
                    this.el.dataset.state = 'warn';
                    return;
                }
            } catch (_) {
                /* continue to global readiness check */
            }
        }

        // 2. Check offline world labels + offline raster/vector cache
        let labelCount = 0;
        let hasWorldLabels = false;
        let hasRasterTiles = false;
        let regionCount = 0;

        try {
            const resp = await fetch('/api/offline-maps/status', { cache: 'no-store' });
            if (resp.ok) {
                const status = await resp.json();
                this.lastStatus = status;
                hasWorldLabels = Boolean(status.labels?.present || status.labels?.worldBase?.exists);
                labelCount = Number(status.labels?.labelCount ?? status.labels?.worldBase?.labelCount) || 0;
                regionCount = Number(status.labels?.installedRegions ?? status.labels?.installedRegionCount) || 0;
                hasRasterTiles = Boolean(status.raster?.available || status.rasterTiles?.hasTiles);
            }
        } catch (_) {
            // Fallback to Electron IPC when running against an embedded server without REST status
            try {
                const info = await window.electronAPI?.gis?.labels?.getWorldBaseInfo?.();
                hasWorldLabels = Boolean(info?.exists);
                labelCount = Number(info?.labelCount) || 0;
            } catch (_) {
                /* ignore */
            }
        }

        if (hasWorldLabels && hasRasterTiles) {
            this.el.textContent = 'Offline: Full';
            this.el.dataset.state = 'ready';
            this.el.title = `Offline raster tiles + ${labelCount} world labels${regionCount ? ` + ${regionCount} region pack(s)` : ''} ready`;
        } else if (hasWorldLabels) {
            const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
            this.el.textContent = online
                ? `Labels: ${labelCount}${regionCount ? ` +${regionCount}` : ''}`
                : 'Offline: Labels';
            this.el.dataset.state = 'ready';
            this.el.title = `SQLite world labels ready (${labelCount} places, EN/AR/native)${regionCount ? `, ${regionCount} region pack(s)` : ''} · Click to manage offline labels & packs`;
        } else {
            this.el.textContent = navigator?.onLine === false ? 'Offline' : 'Online Fallback';
            this.el.dataset.state = 'fallback';
            this.el.title = 'Using online OpenStreetMap fallback — click to set up offline label packs';
        }
    }
}

if (typeof window !== 'undefined') {
    window.OfflineStatusUI = OfflineStatusUI;
    window.offlineStatusUI = window.offlineStatusUI || new OfflineStatusUI();
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OfflineStatusUI };
}
