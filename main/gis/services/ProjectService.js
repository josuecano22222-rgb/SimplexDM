const fs = require('fs');
const path = require('path');

/**
 * Project folder model.
 * Folder contains:
 * - project.gpkg (authoritative)
 * - project.json (UI state + metadata)
 * - cache/ (offline cache)
 */
class ProjectService {
  /**
   * @param {object} deps
   * @param {import('electron').App} deps.app
   */
  constructor({ app }) {
    this.app = app;
  }

  /**
   * Prompt for a folder to create a new project in.
   * @param {import('electron').Dialog} dialog
   * @param {object} args
   * @returns {Promise<string|null>}
   */
  async promptNewProjectFolder(dialog, args = {}) {
    const result = await dialog.showOpenDialog({
      title: 'Create New Project',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    return result.filePaths[0];
  }

  /**
   * Prompt for an existing project folder.
   * @param {import('electron').Dialog} dialog
   * @returns {Promise<string|null>}
   */
  async promptOpenProjectFolder(dialog) {
    const result = await dialog.showOpenDialog({
      title: 'Open Project Folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    return result.filePaths[0];
  }

  /**
   * Create project structure.
   * @param {string} projectFolderPath
   * @param {object} args
   */
  async createProject(projectFolderPath, args = {}) {
    await fs.promises.mkdir(projectFolderPath, { recursive: true });
    const cachePath = path.join(projectFolderPath, 'cache');
    await fs.promises.mkdir(cachePath, { recursive: true });

    const gpkgPath = path.join(projectFolderPath, 'project.gpkg');
    const projectJsonPath = path.join(projectFolderPath, 'project.json');

    const nowIso = new Date().toISOString();
    const metadata = {
      name: args.name || path.basename(projectFolderPath),
      description: args.description || '',
      createdAt: nowIso,
      updatedAt: nowIso,
      // Display CRS (for UI); data CRS are tracked per-layer.
      displayCrs: args.displayCrs || 'EPSG:4326',
    };

    const projectJson = {
      version: 1,
      metadata,
      ui: {
        panels: {
          leftCollapsed: true,
          rightCollapsed: false,
        },
      },
      layers: {
        visibility: {},
        order: [],
        styles: {},
      },
      bookmarks: [],
      recent: {
        lastOpenedAt: nowIso,
      },
    };

    await fs.promises.writeFile(projectJsonPath, JSON.stringify(projectJson, null, 2), 'utf8');

    return {
      projectPath: projectFolderPath,
      gpkgPath,
      projectJsonPath,
      cachePath,
      metadata,
    };
  }

  /**
   * Open a project folder and validate structure.
   * @param {string} projectFolderPath
   */
  async openProject(projectFolderPath) {
    const gpkgPath = path.join(projectFolderPath, 'project.gpkg');
    const projectJsonPath = path.join(projectFolderPath, 'project.json');
    const cachePath = path.join(projectFolderPath, 'cache');

    await fs.promises.mkdir(cachePath, { recursive: true });

    let projectJson = null;
    try {
      const content = await fs.promises.readFile(projectJsonPath, 'utf8');
      projectJson = JSON.parse(content);
    } catch {
      // If missing or invalid, create a minimal project.json to recover.
      const recovered = await this.createProject(projectFolderPath, {});
      return recovered;
    }

    const metadata = projectJson?.metadata || {
      name: path.basename(projectFolderPath),
      description: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      displayCrs: 'EPSG:4326',
    };

    // Touch last opened time
    projectJson.recent = projectJson.recent || {};
    projectJson.recent.lastOpenedAt = new Date().toISOString();
    await fs.promises.writeFile(projectJsonPath, JSON.stringify(projectJson, null, 2), 'utf8');

    return {
      projectPath: projectFolderPath,
      gpkgPath,
      projectJsonPath,
      cachePath,
      metadata,
    };
  }

  /**
   * Save project metadata into project.json.
   * @param {string} projectFolderPath
   * @param {object} metadataPatch
   * @returns {Promise<object>} Updated metadata
   */
  async saveProjectMetadata(projectFolderPath, metadataPatch = {}) {
    const projectJsonPath = path.join(projectFolderPath, 'project.json');
    const content = await fs.promises.readFile(projectJsonPath, 'utf8');
    const projectJson = JSON.parse(content);
    projectJson.metadata = projectJson.metadata || {};
    projectJson.metadata = {
      ...projectJson.metadata,
      ...metadataPatch,
      updatedAt: new Date().toISOString(),
    };
    await fs.promises.writeFile(projectJsonPath, JSON.stringify(projectJson, null, 2), 'utf8');
    return projectJson.metadata;
  }

  /**
   * Add a project to recents list.
   * @param {string} projectFolderPath
   */
  async addRecentProject(projectFolderPath) {
    const recentsPath = path.join(this.app.getPath('userData'), 'recentProjects.json');
    let recents = [];
    try {
      recents = JSON.parse(await fs.promises.readFile(recentsPath, 'utf8'));
    } catch {
      recents = [];
    }
    const now = new Date().toISOString();
    recents = recents.filter((p) => p.path !== projectFolderPath);
    recents.unshift({ path: projectFolderPath, lastOpenedAt: now });
    recents = recents.slice(0, 20);
    await fs.promises.mkdir(path.dirname(recentsPath), { recursive: true });
    await fs.promises.writeFile(recentsPath, JSON.stringify(recents, null, 2), 'utf8');
    return recents;
  }

  /**
   * Get recent projects list.
   */
  async getRecentProjects() {
    const recentsPath = path.join(this.app.getPath('userData'), 'recentProjects.json');
    try {
      return JSON.parse(await fs.promises.readFile(recentsPath, 'utf8'));
    } catch {
      return [];
    }
  }
}

module.exports = { ProjectService };

