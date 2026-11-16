/**
 * ProjectManager (Renderer)
 * Manages current project + recent projects, backed by main-process GIS IPC.
 */
class ProjectManager {
    constructor() {
        this.currentProjectPath = null;
        this.metadata = null;
        this.recent = [];
    }

    /**
     * Initialize project manager.
     */
    async init() {
        await this.refreshRecent();
        // Auto-open last project if present
        const last = this.recent?.[0]?.path;
        if (last) {
            try {
                await this.openPath(last);
            } catch (e) {
                // Ignore; user can open manually
            }
        }
        this._wireShortcuts();
    }

    async refreshRecent() {
        if (!window.electronAPI?.gis?.project?.getRecent) return [];
        this.recent = await window.electronAPI.gis.project.getRecent();
        return this.recent;
    }

    /**
     * Create a new project in a selected folder.
     */
    async createNew(args = {}) {
        const project = await window.electronAPI.gis.project.new(args);
        if (!project) return null;
        this.currentProjectPath = project.projectPath;
        this.metadata = project.metadata;
        await this.refreshRecent();
        this._notifyProjectChanged();
        return project;
    }

    /**
     * Open a project via folder picker.
     */
    async open() {
        const project = await window.electronAPI.gis.project.open();
        if (!project) return null;
        this.currentProjectPath = project.projectPath;
        this.metadata = project.metadata;
        await this.refreshRecent();
        this._notifyProjectChanged();
        return project;
    }

    /**
     * Open a project by path (recents).
     */
    async openPath(projectFolderPath) {
        const project = await window.electronAPI.gis.project.openPath(projectFolderPath);
        if (!project) return null;
        this.currentProjectPath = project.projectPath;
        this.metadata = project.metadata;
        await this.refreshRecent();
        this._notifyProjectChanged();
        return project;
    }

    async saveMetadata(metadataPatch) {
        if (!this.currentProjectPath) throw new Error('No project open');
        const updated = await window.electronAPI.gis.project.saveMetadata(this.currentProjectPath, metadataPatch);
        this.metadata = updated;
        this._notifyProjectChanged();
        return updated;
    }

    _notifyProjectChanged() {
        window.dispatchEvent(new CustomEvent('simplex:projectChanged', {
            detail: {
                projectPath: this.currentProjectPath,
                metadata: this.metadata
            }
        }));
    }

    _wireShortcuts() {
        if (this._shortcutsWired) return;
        this._shortcutsWired = true;
        window.addEventListener('keydown', (e) => {
            const key = e.key?.toLowerCase?.() || '';
            const mod = e.ctrlKey || e.metaKey;
            if (!mod) return;
            if (key === 'o') {
                e.preventDefault();
                this.open().catch(() => {});
            }
            if (key === 'n') {
                e.preventDefault();
                this.createNew({}).catch(() => {});
            }
        });
    }
}

if (typeof window !== 'undefined') {
    window.projectManager = window.projectManager || new ProjectManager();
}

