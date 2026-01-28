/**
 * Settings Routes
 * Application settings and directory browser
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { logger } = require('../utils');

/**
 * GET /api/settings
 * Get current settings
 */
router.get('/', (req, res) => {
    try {
        logger.request('GET', '/api/settings');
        
        // Read current .env values
        let env = {};
        if (fs.existsSync(config.envPath)) {
            const content = fs.readFileSync(config.envPath, 'utf8');
            content.split('\n').forEach(line => {
                const match = line.match(/^([^=]+)=(.*)$/);
                if (match) {
                    env[match[1].trim()] = match[2].trim();
                }
            });
        }
        
        // Return settings directly (not nested) for frontend compatibility
        res.json({
            success: true,
            moviesDir: env.MOVIES_DIR || env.JELLYFIN_DIR || path.join(config.downloadsDir, 'movies'),
            seriesDir: env.SERIES_DIR || env.JELLYFIN_DIR || path.join(config.downloadsDir, 'tvshows'),
            animeDir: env.ANIME_DIR || env.SERIES_DIR || env.JELLYFIN_DIR || path.join(config.downloadsDir, 'anime'),
            jellyfinDir: env.JELLYFIN_DIR || '',
            omdbApiKey: env.OMDB_API_KEY ? '****' + env.OMDB_API_KEY.slice(-4) : '',
            tmdbApiKey: env.TMDB_API_KEY ? '****' + env.TMDB_API_KEY.slice(-4) : '',
            hasOmdbKey: config.hasOmdbKey(),
            hasTmdbKey: config.hasTmdbKey()
        });
        
    } catch (error) {
        logger.error('Settings get failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/settings
 * Update settings
 */
router.post('/', (req, res) => {
    try {
        logger.request('POST', '/api/settings');
        
        const { moviesDir, seriesDir, animeDir, jellyfinDir, omdbApiKey, tmdbApiKey } = req.body;
        
        // Read current .env
        let envContent = '';
        if (fs.existsSync(config.envPath)) {
            envContent = fs.readFileSync(config.envPath, 'utf8');
        }
        
        // Update values
        const updateEnvValue = (content, key, value) => {
            if (value === undefined) return content;
            
            const regex = new RegExp(`^${key}=.*$`, 'm');
            const newLine = `${key}=${value}`;
            
            if (regex.test(content)) {
                return content.replace(regex, newLine);
            } else {
                return content + (content.endsWith('\n') ? '' : '\n') + newLine;
            }
        };
        
        if (moviesDir) envContent = updateEnvValue(envContent, 'MOVIES_DIR', moviesDir);
        if (seriesDir) envContent = updateEnvValue(envContent, 'SERIES_DIR', seriesDir);
        if (animeDir) envContent = updateEnvValue(envContent, 'ANIME_DIR', animeDir);
        if (jellyfinDir !== undefined) envContent = updateEnvValue(envContent, 'JELLYFIN_DIR', jellyfinDir);
        if (omdbApiKey && !omdbApiKey.startsWith('****')) {
            envContent = updateEnvValue(envContent, 'OMDB_API_KEY', omdbApiKey);
        }
        if (tmdbApiKey && !tmdbApiKey.startsWith('****')) {
            envContent = updateEnvValue(envContent, 'TMDB_API_KEY', tmdbApiKey);
        }
        
        // Write .env
        fs.writeFileSync(config.envPath, envContent, 'utf8');
        
        logger.info('Settings updated');
        
        res.json({
            success: true,
            message: 'Settings saved'
        });
        
    } catch (error) {
        logger.error('Settings save failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/browse-directory
 * Browse directory structure
 */
router.get('/browse-directory', (req, res) => {
    try {
        const requestedPath = req.query.path || '';
        logger.request('GET', `/api/browse-directory?path=${requestedPath}`);
        
        // Determine base path
        let browsePath;
        if (requestedPath) {
            browsePath = path.resolve(requestedPath);
        } else {
            // Default to home directory or root
            browsePath = process.env.HOME || process.env.USERPROFILE || '/';
        }
        
        // Check if path exists
        if (!fs.existsSync(browsePath)) {
            return res.status(400).json({
                success: false,
                error: 'Path does not exist'
            });
        }
        
        // Read directory
        const entries = fs.readdirSync(browsePath, { withFileTypes: true });
        
        const items = entries
            .filter(entry => entry.isDirectory())
            .filter(entry => !entry.name.startsWith('.'))
            .map(entry => ({
                name: entry.name,
                path: path.join(browsePath, entry.name),
                isDirectory: true
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        
        res.json({
            success: true,
            currentPath: browsePath,
            parentPath: path.dirname(browsePath),
            items
        });
        
    } catch (error) {
        logger.error('Browse directory failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
