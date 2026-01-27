/**
 * Prehrajto Downloader - Server
 * Modular Express server for media downloading
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const { logger } = require('./utils');
const {
    searchRoutes,
    videoRoutes,
    downloadRoutes,
    imdbRoutes,
    tmdbRoutes,
    settingsRoutes
} = require('./routes');

// Initialize Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (!req.path.includes('/api/download/progress')) {
            // Skip logging SSE progress requests to reduce noise
            logger.debug(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
        }
    });
    
    next();
});

// API Routes
app.use('/api/search', searchRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/imdb', imdbRoutes);
app.use('/api/tmdb', tmdbRoutes);
app.use('/api/settings', settingsRoutes);

// Direct route aliases for backward compatibility
app.get('/api/imdb-by-id/:imdbId', (req, res, next) => {
    req.url = `/by-id/${req.params.imdbId}`;
    imdbRoutes(req, res, next);
});

app.get('/api/browse-directory', (req, res, next) => {
    req.url = '/browse-directory';
    settingsRoutes(req, res, next);
});

// Static files - React frontend
const reactBuildPath = path.join(__dirname, '..', 'public-react');
if (fs.existsSync(reactBuildPath)) {
    app.use(express.static(reactBuildPath));
    
    // SPA fallback - serve index.html for all non-API routes
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) {
            return next();
        }
        res.sendFile(path.join(reactBuildPath, 'index.html'));
    });
    
    logger.info('Serving React frontend from public-react/');
} else {
    logger.warn('React build not found at public-react/');
}

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });
    
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        error: `API endpoint not found: ${req.method} ${req.path}`
    });
});

// Startup
const startServer = () => {
    // Ensure downloads directories exist
    const moviesDir = path.join(config.downloadsDir, 'movies');
    const seriesDir = path.join(config.downloadsDir, 'tvshows');
    
    [config.downloadsDir, moviesDir, seriesDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            logger.info(`Created directory: ${dir}`);
        }
    });
    
    app.listen(config.port, () => {
        logger.info('='.repeat(50));
        logger.info('Prehrajto Downloader Server');
        logger.info('='.repeat(50));
        logger.info(`Port: ${config.port}`);
        logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
        logger.info(`Downloads: ${config.downloadsDir}`);
        logger.info(`OMDB API: ${config.hasOmdbKey() ? 'Configured' : 'Not configured'}`);
        logger.info(`TMDB API: ${config.hasTmdbKey() ? 'Configured' : 'Not configured'}`);
        logger.info('='.repeat(50));
        logger.info(`Server running at http://localhost:${config.port}`);
    });
};

startServer();

module.exports = app;
