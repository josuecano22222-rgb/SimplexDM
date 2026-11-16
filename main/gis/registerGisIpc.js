const path = require('path');
const { ProjectService } = require('./services/ProjectService');
const { GeoPackageService } = require('./services/GeoPackageService');
const { CrsService } = require('./services/CrsService');
const { ImportExportService } = require('./services/ImportExportService');
const { GeoprocessingService } = require('./services/GeoprocessingService');
const { OfflineService } = require('./services/OfflineService');
const { RasterService } = require('./services/RasterService');
const { registerLabelIpc } = require('./services/labelIpcHandlers');

/**
 * Register GIS IPC handlers in the Electron main process.
 * @param {object} deps
 * @param {import('electron').IpcMain} deps.ipcMain
 * @param {import('electron').App} deps.app
 * @param {import('electron').Dialog} deps.dialog
 */
function registerGisIpc({ ipcMain, app, dialog }) {
  const projectService = new ProjectService({ app });
  const crsService = new CrsService();
  const gpkgService = new GeoPackageService({ crsService });
  const importExportService = new ImportExportService({ gpkgService, crsService });
  const geoprocessingService = new GeoprocessingService({ gpkgService, crsService });
  const offlineService = new OfflineService({ app });
  const rasterService = new RasterService({ crsService });

  // -------------------------
  // Project dialogs + lifecycle
  // -------------------------
  ipcMain.handle('gis.project.new', async (_evt, args) => {
    const folder = await projectService.promptNewProjectFolder(dialog, args);
    if (!folder) return null;
    const project = await projectService.createProject(folder, args);
    await gpkgService.ensureProjectGeoPackage(project.gpkgPath, project.metadata);
    await projectService.addRecentProject(project.projectPath);
    return project;
  });

  ipcMain.handle('gis.project.open', async (_evt) => {
    const folder = await projectService.promptOpenProjectFolder(dialog);
    if (!folder) return null;
    const project = await projectService.openProject(folder);
    await gpkgService.ensureProjectGeoPackage(project.gpkgPath, project.metadata);
    await projectService.addRecentProject(project.projectPath);
    return project;
  });

  ipcMain.handle('gis.project.openPath', async (_evt, projectFolderPath) => {
    const project = await projectService.openProject(projectFolderPath);
    await gpkgService.ensureProjectGeoPackage(project.gpkgPath, project.metadata);
    await projectService.addRecentProject(project.projectPath);
    return project;
  });

  ipcMain.handle('gis.project.saveMetadata', async (_evt, projectFolderPath, metadataPatch) => {
    const project = await projectService.openProject(projectFolderPath);
    const updated = await projectService.saveProjectMetadata(project.projectPath, metadataPatch);
    // keep CRS + metadata also in gpkg (best-effort)
    await gpkgService.updateProjectMetadata(project.gpkgPath, updated);
    return updated;
  });

  ipcMain.handle('gis.project.getRecent', async () => {
    return await projectService.getRecentProjects();
  });

  // -------------------------
  // Layer + feature operations (GeoPackage)
  // -------------------------
  ipcMain.handle('gis.layers.list', async (_evt, projectFolderPath) => {
    const project = await projectService.openProject(projectFolderPath);
    return await gpkgService.listLayers(project.gpkgPath);
  });

  ipcMain.handle('gis.layers.createVector', async (_evt, projectFolderPath, layerDef) => {
    const project = await projectService.openProject(projectFolderPath);
    return await gpkgService.createVectorLayer(project.gpkgPath, layerDef);
  });

  ipcMain.handle('gis.layers.delete', async (_evt, projectFolderPath, layerId) => {
    const project = await projectService.openProject(projectFolderPath);
    return await gpkgService.deleteLayer(project.gpkgPath, layerId);
  });

  ipcMain.handle('gis.features.query', async (_evt, projectFolderPath, query) => {
    const project = await projectService.openProject(projectFolderPath);
    return await gpkgService.queryFeatures(project.gpkgPath, query);
  });

  ipcMain.handle('gis.features.insert', async (_evt, projectFolderPath, layerId, feature) => {
    const project = await projectService.openProject(projectFolderPath);
    return await gpkgService.insertFeature(project.gpkgPath, layerId, feature);
  });

  ipcMain.handle('gis.features.update', async (_evt, projectFolderPath, layerId, featureId, patch) => {
    const project = await projectService.openProject(projectFolderPath);
    return await gpkgService.updateFeature(project.gpkgPath, layerId, featureId, patch);
  });

  ipcMain.handle('gis.features.delete', async (_evt, projectFolderPath, layerId, featureId) => {
    const project = await projectService.openProject(projectFolderPath);
    return await gpkgService.deleteFeature(project.gpkgPath, layerId, featureId);
  });

  // -------------------------
  // Import / Export
  // -------------------------
  ipcMain.handle('gis.import.file', async (_evt, projectFolderPath, importSpec) => {
    const project = await projectService.openProject(projectFolderPath);
    return await importExportService.importFile(project, importSpec);
  });

  ipcMain.handle('gis.export.layer', async (_evt, projectFolderPath, exportSpec) => {
    const project = await projectService.openProject(projectFolderPath);
    return await importExportService.exportLayer(project, exportSpec);
  });

  // -------------------------
  // CRS services
  // -------------------------
  ipcMain.handle('gis.crs.lookup', async (_evt, query) => {
    return crsService.lookup(query);
  });

  ipcMain.handle('gis.crs.transform', async (_evt, transformSpec) => {
    return crsService.transform(transformSpec);
  });

  // -------------------------
  // Geoprocessing jobs
  // -------------------------
  ipcMain.handle('gis.geoprocess.run', async (_evt, projectFolderPath, jobSpec) => {
    const project = await projectService.openProject(projectFolderPath);
    return await geoprocessingService.run(project, jobSpec);
  });

  ipcMain.handle('gis.geoprocess.cancel', async (_evt, jobId) => {
    return await geoprocessingService.cancel(jobId);
  });

  // -------------------------
  // Offline / integrity
  // -------------------------
  ipcMain.handle('gis.offline.status', async (_evt, projectFolderPath) => {
    return await offlineService.getOfflineStatus(projectFolderPath);
  });

  ipcMain.handle('gis.offline.integrityCheck', async (_evt, projectFolderPath) => {
    return await offlineService.integrityCheck(projectFolderPath);
  });

  // -------------------------
  // Raster (stage-1 sampling)
  // -------------------------
  ipcMain.handle('gis.raster.sample', async (_evt, rasterPath, lonLat) => {
    return await rasterService.sampleValue(rasterPath, lonLat);
  });

  registerLabelIpc({ ipcMain, app, dialog });
}

module.exports = { registerGisIpc };

