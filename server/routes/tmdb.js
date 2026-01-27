/**
 * TMDB Routes
 * TMDB API endpoints for title translation
 */

const express = require('express');
const router = express.Router();
const { tmdb } = require('../services');
const { logger } = require('../utils');

/**
 * GET /api/tmdb/czech-title/:imdbId
 * Get Czech title for an IMDB ID
 */
router.get('/czech-title/:imdbId', async (req, res) => {
    try {
        const { imdbId } = req.params;
        logger.request('GET', `/api/tmdb/czech-title/${imdbId}`);
        
        if (!tmdb.isAvailable()) {
            return res.json({
                success: false,
                error: 'TMDB API not configured'
            });
        }
        
        const data = await tmdb.getCzechTitle(imdbId);
        
        res.json({
            success: true,
            ...data
        });
        
    } catch (error) {
        logger.error('TMDB Czech title failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/tmdb/original-title
 * Translate Czech title to original
 */
router.get('/original-title', async (req, res) => {
    try {
        const { query, year } = req.query;
        logger.request('GET', `/api/tmdb/original-title?query=${query}`);
        
        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'Query parameter required'
            });
        }
        
        if (!tmdb.isAvailable()) {
            return res.json({
                success: false,
                error: 'TMDB API not configured'
            });
        }
        
        const data = await tmdb.translateToOriginal(query, year);
        
        res.json(data);
        
    } catch (error) {
        logger.error('TMDB translation failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
