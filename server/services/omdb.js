/**
 * OMDB API Service (IMDB data)
 */

const axios = require('axios');
const config = require('../config');
const { logger } = require('../utils');

const BASE_URL = 'http://www.omdbapi.com/';

/**
 * Check if OMDB API is available
 * @returns {boolean}
 */
function isAvailable() {
    return config.hasOmdbKey();
}

/**
 * Search for a movie by title
 * @param {string} title - Movie title
 * @param {string|number} year - Optional year
 * @returns {Promise<Object>} Movie data
 */
async function searchMovie(title, year = null) {
    if (!isAvailable()) {
        throw new Error('OMDB API key not configured');
    }
    
    const params = {
        apikey: config.omdbApiKey,
        t: title,
        type: 'movie'
    };
    
    if (year) {
        params.y = year;
    }
    
    logger.info(`OMDB: Searching movie "${title}"${year ? ` (${year})` : ''}`);
    
    const response = await axios.get(BASE_URL, { params, timeout: config.axios.timeout });
    
    if (response.data.Response === 'False') {
        return null;
    }
    
    return response.data;
}

/**
 * Search for a series by title
 * @param {string} query - Search query
 * @returns {Promise<Array>} Search results
 */
async function searchSeries(query) {
    if (!isAvailable()) {
        throw new Error('OMDB API key not configured');
    }
    
    logger.info(`OMDB: Searching series "${query}"`);
    
    const response = await axios.get(BASE_URL, {
        params: {
            apikey: config.omdbApiKey,
            s: query,
            type: 'series'
        },
        timeout: config.axios.timeout
    });
    
    if (response.data.Response === 'False') {
        return [];
    }
    
    return response.data.Search || [];
}

/**
 * Get details by IMDB ID
 * @param {string} imdbId - IMDB ID
 * @returns {Promise<Object>} Details
 */
async function getById(imdbId) {
    if (!isAvailable()) {
        throw new Error('OMDB API key not configured');
    }
    
    logger.info(`OMDB: Getting details for ${imdbId}`);
    
    const response = await axios.get(BASE_URL, {
        params: {
            apikey: config.omdbApiKey,
            i: imdbId
        },
        timeout: config.axios.timeout
    });
    
    if (response.data.Response === 'False') {
        return null;
    }
    
    return response.data;
}

/**
 * Get series details including seasons
 * @param {string} imdbId - Series IMDB ID
 * @returns {Promise<Object>} Series details
 */
async function getSeriesDetails(imdbId) {
    const seriesData = await getById(imdbId);
    
    if (!seriesData || seriesData.Type !== 'series') {
        return null;
    }
    
    return seriesData;
}

/**
 * Get all episodes for a series
 * @param {string} imdbId - Series IMDB ID
 * @returns {Promise<Object>} Seasons with episodes
 */
async function getSeriesSeasons(imdbId) {
    if (!isAvailable()) {
        throw new Error('OMDB API key not configured');
    }
    
    // First get series info to know total seasons
    const seriesData = await getById(imdbId);
    
    if (!seriesData) {
        throw new Error('Series not found');
    }
    
    const totalSeasons = parseInt(seriesData.totalSeasons) || 1;
    const seasons = [];
    
    logger.info(`OMDB: Fetching ${totalSeasons} seasons for ${imdbId}`);
    
    // Fetch each season
    for (let seasonNum = 1; seasonNum <= totalSeasons; seasonNum++) {
        try {
            const response = await axios.get(BASE_URL, {
                params: {
                    apikey: config.omdbApiKey,
                    i: imdbId,
                    Season: seasonNum
                },
                timeout: config.axios.timeout
            });
            
            if (response.data.Response === 'True' && response.data.Episodes) {
                seasons.push({
                    season: seasonNum,
                    episodes: response.data.Episodes.map(ep => ({
                        Episode: ep.Episode,
                        Title: ep.Title,
                        imdbID: ep.imdbID,
                        imdbRating: ep.imdbRating,
                        Released: ep.Released
                    }))
                });
            }
        } catch (error) {
            logger.warn(`Failed to fetch season ${seasonNum}`, { error: error.message });
        }
    }
    
    return {
        series: seriesData,
        totalSeasons,
        seasons
    };
}

/**
 * Get specific episode IMDB ID
 * @param {string} seriesImdbId - Series IMDB ID
 * @param {number} season - Season number
 * @param {number} episode - Episode number
 * @returns {Promise<string|null>} Episode IMDB ID
 */
async function getEpisodeImdbId(seriesImdbId, season, episode) {
    if (!isAvailable()) {
        return null;
    }
    
    try {
        const response = await axios.get(BASE_URL, {
            params: {
                apikey: config.omdbApiKey,
                i: seriesImdbId,
                Season: season,
                Episode: episode
            },
            timeout: config.axios.timeout
        });
        
        if (response.data.Response === 'True') {
            return response.data.imdbID;
        }
    } catch (error) {
        logger.warn(`Failed to get episode IMDB ID`, { error: error.message });
    }
    
    return null;
}

module.exports = {
    isAvailable,
    searchMovie,
    searchSeries,
    getById,
    getSeriesDetails,
    getSeriesSeasons,
    getEpisodeImdbId
};
