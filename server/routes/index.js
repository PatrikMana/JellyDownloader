/**
 * Routes Index
 * Aggregates all route modules
 */

const searchRoutes = require('./search');
const videoRoutes = require('./video');
const downloadRoutes = require('./download');
const imdbRoutes = require('./imdb');
const tmdbRoutes = require('./tmdb');
const settingsRoutes = require('./settings');
const animeRoutes = require('./anime');

module.exports = {
    searchRoutes,
    videoRoutes,
    downloadRoutes,
    imdbRoutes,
    tmdbRoutes,
    settingsRoutes,
    animeRoutes
};
