const fs = require('fs');
const path = require('path');

class OfflineService {
  /**
   * @param {object} deps
   * @param {import('electron').App} deps.app
   */
  constructor({ app }) {
    this.app = app;
  }

  async getOfflineStatus(projectFolderPath) {
    const cachePath = path.join(projectFolderPath, 'cache');
    const exists = fs.existsSync(cachePath);
    return {
      offlineDefault: true,
      cachePath,
      cacheExists: exists,
    };
  }

  async integrityCheck(projectFolderPath) {
    const gpkgPath = path.join(projectFolderPath, 'project.gpkg');
    const projectJsonPath = path.join(projectFolderPath, 'project.json');
    const cachePath = path.join(projectFolderPath, 'cache');

    const missing = [];
    if (!fs.existsSync(projectJsonPath)) missing.push('project.json');
    if (!fs.existsSync(gpkgPath)) missing.push('project.gpkg');
    if (!fs.existsSync(cachePath)) missing.push('cache/');

    return {
      ok: missing.length === 0,
      missing,
      paths: { gpkgPath, projectJsonPath, cachePath },
    };
  }
}

module.exports = { OfflineService };

