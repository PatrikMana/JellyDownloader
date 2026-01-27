/**
 * Search Routes
 * Prehrajto.cz search endpoints
 */

const express = require('express');
const router = express.Router();
const { prehrajto } = require('../services');
const { logger } = require('../utils');

/**
 * GET /api/search/:searchTerm
 * Search for videos on prehrajto.cz
 */
router.get('/:searchTerm', async (req, res) => {
    try {
        const searchTerm = req.params.searchTerm;
        logger.request('GET', `/api/search/${searchTerm}`);
        
        const results = await prehrajto.search(searchTerm);
        
        res.json({
            success: true,
            results,
            count: results.length
        });
        
    } catch (error) {
        logger.error('Search failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Search failed',
            details: error.message
        });
    }
});

module.exports = router;
