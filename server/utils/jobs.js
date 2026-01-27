/**
 * Download Jobs Manager
 * Manages SSE connections and job state for downloads
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');

// Store active download jobs
const jobs = new Map();

/**
 * Create a new download job
 * @param {Object} initial - Initial job data
 * @returns {Object} Job object
 */
function createJob(initial = {}) {
    const jobId = crypto.randomUUID();
    const emitter = new EventEmitter();
    
    const job = {
        jobId,
        emitter,
        status: 'queued',
        createdAt: Date.now(),
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        speedBps: 0,
        etaSec: null,
        abortController: null,
        ...initial
    };
    
    jobs.set(jobId, job);
    return job;
}

/**
 * Get job by ID
 * @param {string} jobId - Job ID
 * @returns {Object|undefined} Job object
 */
function getJob(jobId) {
    return jobs.get(jobId);
}

/**
 * Update job state
 * @param {string} jobId - Job ID
 * @param {Object} updates - Updates to apply
 */
function updateJob(jobId, updates) {
    const job = jobs.get(jobId);
    if (job) {
        Object.assign(job, updates);
    }
}

/**
 * Emit event to job's SSE listeners
 * @param {Object} job - Job object
 * @param {Object} payload - Event payload
 */
function emitJobEvent(job, payload) {
    if (job && job.emitter) {
        job.emitter.emit('event', payload);
    }
}

/**
 * Delete job after delay
 * @param {string} jobId - Job ID
 * @param {number} delayMs - Delay in milliseconds (default 1 hour)
 */
function scheduleJobCleanup(jobId, delayMs = 60 * 60 * 1000) {
    setTimeout(() => {
        const job = jobs.get(jobId);
        if (job) {
            job.emitter.removeAllListeners();
            jobs.delete(jobId);
        }
    }, delayMs).unref?.();
}

/**
 * Cancel a job
 * @param {string} jobId - Job ID
 * @returns {boolean} Success
 */
function cancelJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return false;
    
    job.status = 'canceled';
    
    if (job.abortController) {
        job.abortController.abort();
    }
    
    emitJobEvent(job, { type: 'canceled', jobId });
    return true;
}

/**
 * Get all active jobs
 * @returns {Array} Array of jobs
 */
function getAllJobs() {
    return Array.from(jobs.values()).map(job => ({
        jobId: job.jobId,
        status: job.status,
        title: job.title,
        progress: job.progress,
        createdAt: job.createdAt
    }));
}

module.exports = {
    createJob,
    getJob,
    updateJob,
    emitJobEvent,
    scheduleJobCleanup,
    cancelJob,
    getAllJobs
};
