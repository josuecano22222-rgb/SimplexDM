const { Worker } = require('worker_threads');
const path = require('path');
const crypto = require('crypto');

class GeoprocessingService {
  /**
   * @param {object} deps
   * @param {import('./GeoPackageService').GeoPackageService} deps.gpkgService
   * @param {import('./CrsService').CrsService} deps.crsService
   */
  constructor({ gpkgService, crsService }) {
    this.gpkgService = gpkgService;
    this.crsService = crsService;
    this.jobs = new Map();
  }

  /**
   * Run a geoprocessing job in a worker thread.
   * @param {object} project
   * @param {object} jobSpec
   */
  async run(project, jobSpec) {
    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const worker = new Worker(path.join(__dirname, '../workers/geoprocess.worker.js'), {
      workerData: { project, jobSpec, jobId },
    });

    this.jobs.set(jobId, { worker, status: 'running', progress: 0 });

    const result = await new Promise((resolve, reject) => {
      worker.on('message', async (msg) => {
        if (!msg || msg.jobId !== jobId) return;
        if (msg.type === 'progress') {
          const j = this.jobs.get(jobId);
          if (j) j.progress = msg.progress || 0;
          return;
        }
        if (msg.type === 'result') resolve(msg.result);
        if (msg.type === 'error') reject(new Error(msg.error || 'Geoprocessing failed'));
      });
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0 && this.jobs.get(jobId)?.status === 'running') {
          reject(new Error(`Worker exited with code ${code}`));
        }
      });
    });

    this.jobs.delete(jobId);
    return { jobId, ...result };
  }

  async cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, message: 'Job not found' };
    job.status = 'cancelled';
    await job.worker.terminate();
    this.jobs.delete(jobId);
    return { ok: true };
  }
}

module.exports = { GeoprocessingService };

