/**
 * Download Routes
 * File download endpoints with progress tracking
 */

const express = require('express');
const router = express.Router();
const { downloader } = require('../services');
const { logger, jobs } = require('../utils');

/**
 * POST /api/download
 * Start a movie download
 */
router.post('/', async (req, res) => {
    try {
        const { videoUrl, title, imdbData, type = 'movie', season = null, episode = null, subtitles = [] } = req.body;
        
        if (!videoUrl || !title) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required parameters (videoUrl, title)' 
            });
        }
        
        logger.info(`Starting download: ${title}${subtitles.length > 0 ? ` (with ${subtitles.length} subtitles)` : ''}`);
        
        const result = await downloader.downloadFile({
            videoUrl,
            title,
            imdbData,
            type,
            season,
            episode,
            subtitles
        });
        
        res.json({ success: true, jobId: result.jobId });
        
    } catch (error) {
        logger.error('Download start failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/download/series
 * Start a series batch download
 */
router.post('/series', async (req, res) => {
    try {
        const { seriesTitle, seriesImdbId, seriesImdbData, episodes } = req.body;
        
        if (!seriesTitle || !episodes || episodes.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required parameters' 
            });
        }
        
        logger.info(`Starting series download: ${seriesTitle} (${episodes.length} episodes)`);
        
        const result = await downloader.downloadSeries({
            seriesTitle,
            seriesImdbId,
            seriesImdbData,
            episodes
        });
        
        res.json({ success: true, jobId: result.jobId });
        
    } catch (error) {
        logger.error('Series download start failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/download/progress/:jobId
 * SSE endpoint for download progress
 */
router.get('/progress/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    const job = jobs.getJob(jobId);
    
    if (!job) {
        return res.status(404).json({ 
            success: false, 
            error: 'Job not found' 
        });
    }
    
    // Setup SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    
    // Send current state
    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    // Send initial state if already complete
    if (job.status === 'done') {
        sendEvent({ type: 'done', jobId, status: 'completed' });
        res.end();
        return;
    }
    
    if (job.status === 'error') {
        sendEvent({ type: 'error', jobId, error: job.error || 'Unknown error' });
        res.end();
        return;
    }
    
    // Listen for events
    const eventHandler = (payload) => {
        sendEvent(payload);
        
        if (['done', 'error', 'canceled'].includes(payload.type)) {
            res.end();
        }
    };
    
    job.emitter.on('event', eventHandler);
    
    // Cleanup on close
    req.on('close', () => {
        job.emitter.off('event', eventHandler);
    });
});

/**
 * POST /api/download/cancel/:jobId
 * Cancel a download
 */
router.post('/cancel/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    const job = jobs.getJob(jobId);
    
    if (!job) {
        return res.status(404).json({ 
            success: false, 
            error: 'Job not found' 
        });
    }
    
    logger.info(`Canceling download: ${jobId}`);
    
    const success = jobs.cancelJob(jobId);
    
    res.json({ success, jobId });
});

module.exports = router;
