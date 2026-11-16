const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function resolveWorkerScript(baseDir = __dirname, existsFn = fs.existsSync) {
  const defaultPath = path.join(baseDir, '..', 'workers', 'geoprocess.worker.js');
  if (defaultPath.includes('app.asar') && !defaultPath.includes('app.asar.unpacked')) {
    const unpacked = defaultPath.replace('app.asar', 'app.asar.unpacked');
    if (existsFn(unpacked)) {
      return unpacked;
    }
  }
  return defaultPath;
}

class GeoprocessingService {
  constructor({ gpkgService, crsService }) {
    this.gpkgService = gpkgService;
    this.crsService = crsService;
    this.jobs = new Map();
  }

  /**
   * Run a geoprocessing job in a background worker thread.
   * @param {object} project
   * @param {object} jobSpec
   */
  async run(project, jobSpec) {
    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const worker = new Worker(resolveWorkerScript(), {
      workerData: { project, jobSpec, jobId },
    });

    this.jobs.set(jobId, { worker, status: 'running', progress: 0 });

    try {
      const result = await new Promise((resolve, reject) => {
        worker.on('message', (msg) => {
          if (!msg || msg.jobId !== jobId) return;
          if (msg.type === 'progress') {
            const j = this.jobs.get(jobId);
            if (j) j.progress = msg.progress || 0;
            return;
          }
          if (msg.type === 'result') {
            const j = this.jobs.get(jobId);
            if (j) j.status = 'completed';
            resolve(msg.result);
          }
          if (msg.type === 'error') {
            const j = this.jobs.get(jobId);
            if (j) j.status = 'failed';
            reject(new Error(msg.error || 'Geoprocessing failed'));
          }
        });
        worker.on('error', reject);
        worker.on('exit', (code) => {
          const j = this.jobs.get(jobId);
          if (j && j.status === 'cancelled') {
            reject(new Error('Job cancelled'));
          } else if (code !== 0 && j?.status === 'running') {
            reject(new Error(`Worker exited with code ${code}`));
          }
        });
      });

      return { jobId, ...result };
    } finally {
      this.jobs.delete(jobId);
    }
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

module.exports = { GeoprocessingService, resolveWorkerScript };
