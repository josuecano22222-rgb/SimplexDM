/**
 * OfflineStatusUI
 * Shows offline readiness + integrity status in status bar.
 */
class OfflineStatusUI {
    constructor() {
        this.el = null;
    }

    init() {
        this._ensureEl();
        window.addEventListener('simplex:projectChanged', () => this.refresh());
        this.refresh().catch(() => {});
    }

    _ensureEl() {
        const statusRight = document.querySelector('.status-right');
        if (!statusRight) return;
        if (document.getElementById('offlineStatus')) {
            this.el = document.getElementById('offlineStatus');
            return;
        }
        const span = document.createElement('span');
        span.id = 'offlineStatus';
        span.textContent = 'Offline: --';
        statusRight.insertBefore(span, statusRight.firstChild);
        this.el = span;
    }

    async refresh() {
        if (!this.el) this._ensureEl();
        const projectPath = window.projectManager?.currentProjectPath;
        if (!projectPath || !window.electronAPI?.gis?.offline) {
            if (this.el) this.el.textContent = 'Offline: --';
            return;
        }
        const integrity = await window.electronAPI.gis.offline.integrityCheck(projectPath);
        if (integrity.ok) {
            this.el.textContent = 'Offline: Ready';
        } else {
            this.el.textContent = `Offline: Missing ${integrity.missing.join(', ')}`;
        }
    }
}

if (typeof window !== 'undefined') {
    window.offlineStatusUI = window.offlineStatusUI || new OfflineStatusUI();
}

