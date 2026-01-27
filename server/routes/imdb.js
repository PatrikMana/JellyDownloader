/**
 * IMDB Routes
 * OMDB API endpoints for movie/series metadata
 */

const express = require('express');
const router = express.Router();
const { omdb } = require('../services');
const { logger } = require('../utils');

/**
 * GET /api/imdb/:title/:year?
 * Search for a movie by title
 */
router.get('/:title/:year?', async (req, res) => {
    try {
        const { title, year } = req.params;
        logger.request('GET', `/api/imdb/${title}${year ? `/${year}` : ''}`);
        
        if (!omdb.isAvailable()) {
            return res.json({
                success: false,
                error: 'OMDB API not configured',
                mockMode: true
            });
        }
        
        const data = await omdb.searchMovie(title, year);
        
        if (!data) {
            return res.json({
                success: false,
                error: 'Movie not found'
            });
        }
        
        res.json({
            success: true,
            data
        });
        
    } catch (error) {
        logger.error('IMDB search failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/imdb/by-id/:imdbId or /api/imdb-by-id/:imdbId
 * Get details by IMDB ID
 */
router.get('/by-id/:imdbId', async (req, res) => {
    try {
        const { imdbId } = req.params;
        logger.request('GET', `/api/imdb/by-id/${imdbId}`);
        
        if (!omdb.isAvailable()) {
            return res.json({
                success: false,
                error: 'OMDB API not configured'
            });
        }
        
        const data = await omdb.getById(imdbId);
        
        if (!data) {
            return res.json({
                success: false,
                error: 'Not found'
            });
        }
        
        res.json({
            success: true,
            data
        });
        
    } catch (error) {
        logger.error('IMDB by ID failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/imdb/series/search/:query
 * Search for series
 */
router.get('/series/search/:query', async (req, res) => {
    try {
        const { query } = req.params;
        logger.request('GET', `/api/imdb/series/search/${query}`);
        
        if (!omdb.isAvailable()) {
            return res.json({
                success: false,
                error: 'OMDB API not configured',
                results: []
            });
        }
        
        const results = await omdb.searchSeries(query);
        
        res.json({
            success: true,
            results
        });
        
    } catch (error) {
        logger.error('Series search failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message,
            results: []
        });
    }
});

/**
 * GET /api/imdb/series/:imdbId
 * Get series details
 */
router.get('/series/:imdbId', async (req, res) => {
    try {
        const { imdbId } = req.params;
        logger.request('GET', `/api/imdb/series/${imdbId}`);
        
        if (!omdb.isAvailable()) {
            return res.json({
                success: false,
                error: 'OMDB API not configured'
            });
        }
        
        const data = await omdb.getSeriesDetails(imdbId);
        
        if (!data) {
            return res.json({
                success: false,
                error: 'Series not found'
            });
        }
        
        res.json({
            success: true,
            data
        });
        
    } catch (error) {
        logger.error('Series details failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/imdb/series/:imdbId/seasons
 * Get all seasons with episodes
 */
router.get('/series/:imdbId/seasons', async (req, res) => {
    try {
        const { imdbId } = req.params;
        logger.request('GET', `/api/imdb/series/${imdbId}/seasons`);
        
        if (!omdb.isAvailable()) {
            return res.json({
                success: false,
                error: 'OMDB API not configured'
            });
        }
        
        const data = await omdb.getSeriesSeasons(imdbId);
        
        res.json({
            success: true,
            ...data
        });
        
    } catch (error) {
        logger.error('Series seasons failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
