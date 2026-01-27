/**
 * Video Routes
 * Get video details and streaming URLs
 */

const express = require('express');
const router = express.Router();
const { prehrajto } = require('../services');
const { logger } = require('../utils');

/**
 * GET /api/video/:moviePath
 * Get video details including streaming URLs and qualities
 */
router.get('/:moviePath(*)', async (req, res) => {
    try {
        const moviePath = req.params.moviePath;
        logger.request('GET', `/api/video/${moviePath}`);
        
        const videoData = await prehrajto.getVideoDetails(moviePath);
        
        res.json({
            success: true,
            videoUrl: videoData.videoUrl,
            qualities: videoData.qualities,
            sourceUrl: videoData.sourceUrl
        });
        
    } catch (error) {
        logger.error('Failed to get video details', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to get video details',
            details: error.message
        });
    }
});

module.exports = router;
