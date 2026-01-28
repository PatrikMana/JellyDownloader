/**
 * Anime Routes
 * Handles anime search, episodes, and downloads
 */

const express = require('express');
const router = express.Router();
const animeApi = require('../services/animeApi');
const { downloadAnimeSeries } = require('../services/downloader');
const omdb = require('../services/omdb');
const { logger } = require('../utils');

/**
 * GET /api/anime/health
 * Check if anime scraper is working
 */
router.get('/health', async (req, res) => {
    const healthy = await animeApi.checkHealth();
    res.json({ 
        success: healthy, 
        message: healthy ? 'Anime scraper is working (hianime.to)' : 'Anime scraper is not working'
    });
});

/**
 * GET /api/anime/search/:query
 * Search for anime
 */
router.get('/search/:query', async (req, res) => {
    try {
        const { query } = req.params;
        logger.info(`GET /api/anime/search/${query}`);

        const result = await animeApi.searchAnime(query);
        res.json(result);
    } catch (error) {
        logger.error('Anime search failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/anime/info/:animeId
 * Get anime details
 */
router.get('/info/:animeId', async (req, res) => {
    try {
        const { animeId } = req.params;
        logger.info(`GET /api/anime/info/${animeId}`);

        const result = await animeApi.getAnimeInfo(animeId);
        res.json(result);
    } catch (error) {
        logger.error('Get anime info failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/anime/episodes/:animeId
 * Get episodes for an anime
 */
router.get('/episodes/:animeId', async (req, res) => {
    try {
        const { animeId } = req.params;
        logger.info(`GET /api/anime/episodes/${animeId}`);

        const result = await animeApi.getEpisodes(animeId);
        res.json(result);
    } catch (error) {
        logger.error('Get episodes failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/anime/servers/:episodeId
 * Get available servers for episode
 */
router.get('/servers/:episodeId(*)', async (req, res) => {
    try {
        const episodeId = req.params.episodeId;
        logger.info(`GET /api/anime/servers/${episodeId}`);

        const result = await animeApi.getServers(episodeId);
        res.json(result);
    } catch (error) {
        logger.error('Get servers failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/anime/stream/:episodeId
 * Get streaming URL for episode
 */
router.get('/stream/:episodeId(*)', async (req, res) => {
    try {
        const episodeId = req.params.episodeId;
        const { server = 'hd-1', type = 'dub' } = req.query;
        logger.info(`GET /api/anime/stream/${episodeId}?server=${server}&type=${type}`);

        const result = await animeApi.getStreamingInfo(episodeId, server, type);
        res.json(result);
    } catch (error) {
        logger.error('Get stream failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/anime/download
 * Download anime episodes (batch)
 */
router.post('/download', async (req, res) => {
    try {
        const { animeTitle, animeId, episodes } = req.body;
        logger.info(`POST /api/anime/download - ${animeTitle} (${episodes.length} episodes)`);

        // Validate input
        if (!animeTitle || !animeId || !episodes || episodes.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields: animeTitle, animeId, episodes' 
            });
        }

        // Try to get real IMDB data using OMDB
        let seriesImdbId = null;
        let seriesImdbData = null;
        
        if (omdb.isAvailable()) {
            logger.info(`Searching OMDB for: ${animeTitle}`);
            
            // Search for series first
            const searchResults = await omdb.searchSeries(animeTitle);
            
            if (searchResults && searchResults.length > 0) {
                // Get the first result's IMDB ID
                seriesImdbId = searchResults[0].imdbID;
                // Get full details
                seriesImdbData = await omdb.getById(seriesImdbId);
                logger.info(`Found IMDB ID for anime: ${seriesImdbId}`);
            } else {
                // Try searching as movie (some anime movies)
                seriesImdbData = await omdb.searchMovie(animeTitle);
                if (seriesImdbData && seriesImdbData.imdbID) {
                    seriesImdbId = seriesImdbData.imdbID;
                    logger.info(`Found IMDB ID for anime (as movie): ${seriesImdbId}`);
                }
            }
        }
        
        if (!seriesImdbId) {
            logger.warn(`Could not find IMDB ID for: ${animeTitle}`);
        }

        // Process episodes - get streaming URLs
        logger.info(`Getting stream URLs for ${episodes.length} episodes...`);
        const episodesWithUrls = [];
        
        for (const ep of episodes) {
            // Episode ID format: animeId?ep=dataId
            const episodeId = `${animeId}?ep=${ep.dataId}`;
            
            logger.info(`Getting stream URL for episode ${ep.episodeNo}`);
            const streamResult = await animeApi.getBestStreamUrl(episodeId);
            
            if (streamResult.success && streamResult.url) {
                episodesWithUrls.push({
                    season: 1, // Anime typically has 1 season per entry
                    episode: ep.episodeNo,
                    episodeTitle: ep.title || `Episode ${ep.episodeNo}`,
                    videoUrl: streamResult.url,
                    audioType: streamResult.type, // 'dub' or 'sub'
                    referer: streamResult.referer
                });
            } else {
                logger.warn(`Could not get stream URL for episode ${ep.episodeNo}`);
            }
        }

        if (episodesWithUrls.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Could not get streaming URLs for any episode' 
            });
        }

        logger.info(`Got URLs for ${episodesWithUrls.length}/${episodes.length} episodes`);
        logger.info(`Starting batch download of ${episodesWithUrls.length} episodes`);

        // Start batch download (single job for all episodes)
        const result = await downloadAnimeSeries({
            animeTitle,
            seriesImdbId,
            seriesImdbData,
            episodes: episodesWithUrls
        });

        res.json({
            success: true,
            message: `Started download for ${episodesWithUrls.length} episodes`,
            jobId: result.jobId,
            totalEpisodes: episodesWithUrls.length,
            imdbId: seriesImdbId
        });

    } catch (error) {
        logger.error('Anime download failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
