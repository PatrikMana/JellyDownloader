/**
 * Downloader Service
 * Handles file downloads with progress tracking
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);

const config = require('../config');
const { logger, sanitizeFilename } = require('../utils');
const { createJob, emitJobEvent, scheduleJobCleanup } = require('../utils/jobs');
const omdb = require('./omdb');

/**
 * Generate Jellyfin-compatible filename
 * @param {string} title - Title
 * @param {Object} imdbData - IMDB data
 * @param {string} type - 'movie' or 'series'
 * @param {number} season - Season number (for series)
 * @param {number} episode - Episode number (for series)
 * @returns {string} Filename without extension
 */
function generateFilename(title, imdbData, type = 'movie', season = null, episode = null) {
    const rawTitle = imdbData?.Title || title || 'Unknown';
    const cleanTitle = sanitizeFilename(rawTitle);
    
    if (type === 'movie') {
        const year = imdbData?.Year || 'Unknown';
        const imdbId = imdbData?.imdbID || '';
        const suffix = imdbId ? ` [imdbid-${imdbId}]` : '';
        return `${cleanTitle} (${year})${suffix}`;
    } else if (type === 'series') {
        const imdbId = imdbData?.imdbID || '';
        const suffix = imdbId ? ` [imdbid-${imdbId}]` : '';
        
        if (season !== null && episode !== null) {
            const s = String(season).padStart(2, '0');
            const e = String(episode).padStart(2, '0');
            return `${cleanTitle}${suffix} - s${s}e${e}`;
        }
        return `${cleanTitle}${suffix}`;
    }
    return cleanTitle;
}

/**
 * Get download directory path
 * @param {string} title - Title
 * @param {Object} imdbData - IMDB data
 * @param {string} type - 'movie' or 'series'
 * @param {number} season - Season number (for series)
 * @returns {string} Directory path
 */
function getDownloadDir(title, imdbData, type = 'movie', season = null) {
    const paths = config.getDownloadPaths();
    const rawTitle = imdbData?.Title || title || 'Unknown';
    const cleanTitle = sanitizeFilename(rawTitle);
    
    if (type === 'movie') {
        return paths.movies;
    } else if (type === 'series') {
        const imdbId = imdbData?.imdbID || '';
        const suffix = imdbId ? ` [imdbid-${imdbId}]` : '';
        const seriesDir = `${cleanTitle}${suffix}`;
        
        if (season !== null) {
            const seasonDir = `Season ${String(season).padStart(2, '0')}`;
            return path.join(paths.series, seriesDir, seasonDir);
        }
        return path.join(paths.series, seriesDir);
    }
    return paths.movies;
}

/**
 * Remove empty directories up to stop directory
 * @param {string} startDir - Starting directory
 * @param {string} stopAtDir - Stop at this directory
 */
function removeEmptyDirsUp(startDir, stopAtDir) {
    if (!startDir || !stopAtDir) return;
    
    const stop = path.resolve(stopAtDir);
    let cur = path.resolve(startDir);
    
    while (cur.startsWith(stop) && cur !== stop) {
        try {
            if (!fs.existsSync(cur)) break;
            const entries = fs.readdirSync(cur);
            if (entries.length > 0) break;
            fs.rmdirSync(cur);
            cur = path.dirname(cur);
        } catch {
            break;
        }
    }
}

/**
 * Download a single file with progress
 * @param {Object} options - Download options
 * @returns {Promise<Object>} Download result
 */
async function downloadFile(options) {
    const { videoUrl, title, imdbData, type = 'movie', season = null, episode = null } = options;
    
    // Create job
    const job = createJob({ title, type });
    scheduleJobCleanup(job.jobId);
    
    // Start async download
    processDownload(job, options);
    
    return { jobId: job.jobId };
}

/**
 * Process download in background
 * @param {Object} job - Job object
 * @param {Object} options - Download options
 */
async function processDownload(job, options) {
    const { videoUrl, title, imdbData, type = 'movie', season = null, episode = null } = options;
    let videoPath = null;
    
    try {
        job.status = 'downloading';
        emitJobEvent(job, { 
            type: 'progress', 
            jobId: job.jobId, 
            progress: 0, 
            downloadedBytes: 0, 
            totalBytes: 0, 
            speedBps: 0, 
            etaSec: null 
        });
        
        // Get extension from URL
        const urlExt = videoUrl.match(/\.(mp4|mkv|avi|webm)(?:[?#]|$)/i);
        const videoExt = urlExt ? urlExt[1] : 'mp4';
        
        // Setup paths
        const downloadDir = getDownloadDir(title, imdbData, type, season);
        job.downloadDir = downloadDir;
        
        const baseFilename = generateFilename(title, imdbData, type, season, episode);
        const videoFilename = `${baseFilename}.${videoExt}`;
        videoPath = path.join(downloadDir, videoFilename);
        
        // Create directory
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }
        
        // Setup abort controller
        job.abortController = new AbortController();
        
        logger.info(`Starting download: ${videoFilename}`);
        
        // Start download
        const response = await axios({
            method: 'GET',
            url: videoUrl,
            responseType: 'stream',
            timeout: 0,
            maxRedirects: 5,
            signal: job.abortController.signal,
            headers: {
                'User-Agent': config.axios.userAgent,
                'Referer': 'https://prehrajto.cz/',
                'Accept': '*/*',
                'Connection': 'keep-alive'
            }
        });
        
        job.httpStream = response.data;
        
        const writeStream = fs.createWriteStream(videoPath);
        job.writeStream = writeStream;
        job.videoPath = videoPath;
        
        const totalBytes = parseInt(response.headers['content-length']) || 0;
        let downloadedBytes = 0;
        let lastTickBytes = 0;
        let lastTickTime = Date.now();
        const startTime = Date.now();
        
        // Track progress
        response.data.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            
            const now = Date.now();
            if (now - lastTickTime >= 1000) {
                const dt = (now - lastTickTime) / 1000;
                const dB = downloadedBytes - lastTickBytes;
                const speed = dt > 0 ? (dB / dt) : 0;
                const etaSec = (totalBytes > 0 && speed > 0) 
                    ? ((totalBytes - downloadedBytes) / speed) 
                    : null;
                const progress = totalBytes > 0 
                    ? (downloadedBytes / totalBytes * 100) 
                    : 0;
                
                emitJobEvent(job, {
                    type: 'progress',
                    jobId: job.jobId,
                    downloadedBytes,
                    totalBytes,
                    progress,
                    speedBps: speed,
                    etaSec,
                    elapsedSec: (now - startTime) / 1000
                });
                
                lastTickBytes = downloadedBytes;
                lastTickTime = now;
            }
        });
        
        await pipelineAsync(response.data, writeStream);
        
        job.status = 'done';
        logger.info(`Download complete: ${videoFilename}`);
        
        emitJobEvent(job, {
            type: 'done',
            jobId: job.jobId,
            filename: videoFilename,
            path: downloadDir
        });
        
    } catch (error) {
        if (job.status === 'canceled') {
            const paths = config.getDownloadPaths();
            removeEmptyDirsUp(job.downloadDir, paths.movies);
            
            emitJobEvent(job, {
                type: 'canceled',
                jobId: job.jobId,
                message: 'Download canceled'
            });
            return;
        }
        
        job.status = 'error';
        logger.error(`Download failed: ${error.message}`);
        
        // Clean up partial file
        if (videoPath && fs.existsSync(videoPath)) {
            try { fs.unlinkSync(videoPath); } catch {}
        }
        
        emitJobEvent(job, {
            type: 'error',
            jobId: job.jobId,
            error: error?.message || 'Download failed'
        });
    }
}

/**
 * Download series episodes
 * @param {Object} options - Series download options
 * @returns {Promise<Object>} Download result
 */
async function downloadSeries(options) {
    const { seriesTitle, seriesImdbId, seriesImdbData, episodes } = options;
    
    // Create job
    const job = createJob({ 
        title: seriesTitle, 
        type: 'series-batch',
        totalEpisodes: episodes.length,
        completedEpisodes: 0
    });
    scheduleJobCleanup(job.jobId, 2 * 60 * 60 * 1000); // 2 hours for series
    
    // Start async download
    processSeriesDownload(job, options);
    
    return { jobId: job.jobId };
}

/**
 * Process series download in background
 * @param {Object} job - Job object
 * @param {Object} options - Download options
 */
async function processSeriesDownload(job, options) {
    const { seriesTitle, seriesImdbId, seriesImdbData, episodes } = options;
    
    job.status = 'downloading';
    job.abortController = new AbortController();
    
    const paths = config.getDownloadPaths();
    const cleanSeriesTitle = sanitizeFilename(seriesTitle);
    const seriesSuffix = seriesImdbId ? ` [imdbid-${seriesImdbId}]` : '';
    const seriesDir = path.join(paths.series, `${cleanSeriesTitle}${seriesSuffix}`);
    
    job.downloadDir = seriesDir;
    
    let completedEpisodes = 0;
    
    try {
        for (let i = 0; i < episodes.length; i++) {
            if (job.status === 'canceled') {
                emitJobEvent(job, { type: 'canceled', jobId: job.jobId });
                return;
            }
            
            const ep = episodes[i];
            const seasonStr = String(ep.season).padStart(2, '0');
            const episodeStr = String(ep.episode).padStart(2, '0');
            
            // Emit episode start
            emitJobEvent(job, {
                type: 'episode-start',
                jobId: job.jobId,
                season: ep.season,
                episode: ep.episode,
                episodeTitle: ep.episodeTitle || ep.prehrajtoTitle,
                currentIndex: i + 1,
                totalEpisodes: episodes.length
            });
            
            // Get episode IMDB ID
            let episodeImdbId = null;
            if (omdb.isAvailable() && seriesImdbId) {
                episodeImdbId = await omdb.getEpisodeImdbId(seriesImdbId, ep.season, ep.episode);
                if (episodeImdbId) {
                    logger.info(`Got IMDB ID for S${seasonStr}E${episodeStr}: ${episodeImdbId}`);
                }
            }
            
            // Create season directory
            const seasonDir = path.join(seriesDir, `Season ${seasonStr}`);
            if (!fs.existsSync(seasonDir)) {
                fs.mkdirSync(seasonDir, { recursive: true });
            }
            
            // Generate filename
            const episodeSuffix = episodeImdbId ? ` [imdbid-${episodeImdbId}]` : '';
            const urlExt = ep.videoUrl.match(/\.(mp4|mkv|avi|webm)(?:[?#]|$)/i);
            const videoExt = urlExt ? urlExt[1] : 'mp4';
            const episodeFilename = `${cleanSeriesTitle} s${seasonStr}e${episodeStr}${episodeSuffix}.${videoExt}`;
            const episodePath = path.join(seasonDir, episodeFilename);
            
            logger.info(`Downloading: ${episodeFilename}`);
            
            // Download episode
            const response = await axios({
                method: 'GET',
                url: ep.videoUrl,
                responseType: 'stream',
                timeout: 0,
                maxRedirects: 5,
                signal: job.abortController.signal,
                headers: {
                    'User-Agent': config.axios.userAgent,
                    'Referer': 'https://prehrajto.cz/',
                    'Accept': '*/*',
                    'Connection': 'keep-alive'
                }
            });
            
            const writeStream = fs.createWriteStream(episodePath);
            const totalBytes = parseInt(response.headers['content-length']) || 0;
            
            let downloadedBytes = 0;
            let lastTickBytes = 0;
            let lastTickTime = Date.now();
            const startTime = Date.now();
            
            response.data.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                
                const now = Date.now();
                if (now - lastTickTime >= 1000) {
                    const dt = (now - lastTickTime) / 1000;
                    const dB = downloadedBytes - lastTickBytes;
                    const speed = dt > 0 ? (dB / dt) : 0;
                    const etaSec = (totalBytes > 0 && speed > 0) 
                        ? ((totalBytes - downloadedBytes) / speed) 
                        : null;
                    const progress = totalBytes > 0 
                        ? (downloadedBytes / totalBytes * 100) 
                        : 0;
                    
                    emitJobEvent(job, {
                        type: 'progress',
                        jobId: job.jobId,
                        downloadedBytes,
                        totalBytes,
                        progress,
                        speedBps: speed,
                        etaSec,
                        currentEpisode: i + 1,
                        totalEpisodes: episodes.length
                    });
                    
                    lastTickBytes = downloadedBytes;
                    lastTickTime = now;
                }
            });
            
            await pipelineAsync(response.data, writeStream);
            
            completedEpisodes++;
            job.completedEpisodes = completedEpisodes;
            
            logger.info(`Episode downloaded: ${episodeFilename}`);
            
            emitJobEvent(job, {
                type: 'episode-done',
                jobId: job.jobId,
                season: ep.season,
                episode: ep.episode,
                filename: episodeFilename,
                completedEpisodes,
                totalEpisodes: episodes.length
            });
        }
        
        // All done
        job.status = 'done';
        
        emitJobEvent(job, {
            type: 'done',
            jobId: job.jobId,
            seriesTitle,
            path: seriesDir,
            totalEpisodes: episodes.length,
            completedEpisodes
        });
        
        logger.info(`Series download complete: ${seriesTitle} (${completedEpisodes} episodes)`);
        
    } catch (error) {
        if (job.status === 'canceled') {
            emitJobEvent(job, { type: 'canceled', jobId: job.jobId });
            return;
        }
        
        job.status = 'error';
        logger.error(`Series download failed: ${error.message}`);
        
        emitJobEvent(job, {
            type: 'error',
            jobId: job.jobId,
            error: error.message || 'Download failed'
        });
    }
}

module.exports = {
    downloadFile,
    downloadSeries,
    generateFilename,
    getDownloadDir,
    removeEmptyDirsUp
};
