/**
 * TMDB API Service
 * Used for translating titles between languages
 */

const axios = require('axios');
const config = require('../config');
const { logger } = require('../utils');

const BASE_URL = 'https://api.themoviedb.org/3';

/**
 * Check if TMDB API is available
 * @returns {boolean}
 */
function isAvailable() {
    return config.hasTmdbKey();
}

/**
 * Get Czech title for an IMDB ID
 * @param {string} imdbId - IMDB ID
 * @returns {Promise<Object>} Title data
 */
async function getCzechTitle(imdbId) {
    if (!isAvailable()) {
        throw new Error('TMDB API key not configured');
    }
    
    logger.info(`TMDB: Getting Czech title for ${imdbId}`);
    
    // First find the TMDB ID
    const findResponse = await axios.get(`${BASE_URL}/find/${imdbId}`, {
        params: {
            api_key: config.tmdbApiKey,
            external_source: 'imdb_id'
        },
        timeout: config.axios.timeout
    });
    
    const results = findResponse.data;
    let tmdbId = null;
    let mediaType = null;
    
    if (results.movie_results && results.movie_results.length > 0) {
        tmdbId = results.movie_results[0].id;
        mediaType = 'movie';
    } else if (results.tv_results && results.tv_results.length > 0) {
        tmdbId = results.tv_results[0].id;
        mediaType = 'tv';
    }
    
    if (!tmdbId) {
        return { czechTitle: null, originalTitle: null };
    }
    
    // Get Czech translations
    const detailsResponse = await axios.get(`${BASE_URL}/${mediaType}/${tmdbId}`, {
        params: {
            api_key: config.tmdbApiKey,
            language: 'cs-CZ'
        },
        timeout: config.axios.timeout
    });
    
    const details = detailsResponse.data;
    
    return {
        czechTitle: details.title || details.name || null,
        originalTitle: details.original_title || details.original_name || null,
        tmdbId,
        mediaType
    };
}

/**
 * Translate Czech title to original/English
 * @param {string} czechTitle - Czech title to translate
 * @param {string|number} year - Optional year
 * @returns {Promise<Object>} Translation result
 */
async function translateToOriginal(czechTitle, year = null) {
    if (!isAvailable()) {
        throw new Error('TMDB API key not configured');
    }
    
    logger.info(`TMDB: Translating "${czechTitle}" to original`);
    
    // Search in Czech
    const params = {
        api_key: config.tmdbApiKey,
        query: czechTitle,
        language: 'cs-CZ'
    };
    
    if (year) {
        params.year = year;
    }
    
    // Try movies first
    let response = await axios.get(`${BASE_URL}/search/movie`, {
        params,
        timeout: config.axios.timeout
    });
    
    let results = response.data.results || [];
    let mediaType = 'movie';
    
    // If no movies, try TV shows
    if (results.length === 0) {
        response = await axios.get(`${BASE_URL}/search/tv`, {
            params,
            timeout: config.axios.timeout
        });
        results = response.data.results || [];
        mediaType = 'tv';
    }
    
    if (results.length === 0) {
        return { success: false, originalTitle: null };
    }
    
    const match = results[0];
    
    // Get external IDs (IMDB)
    const externalResponse = await axios.get(`${BASE_URL}/${mediaType}/${match.id}/external_ids`, {
        params: { api_key: config.tmdbApiKey },
        timeout: config.axios.timeout
    });
    
    return {
        success: true,
        originalTitle: match.original_title || match.original_name,
        czechTitle: match.title || match.name,
        year: (match.release_date || match.first_air_date || '').substring(0, 4),
        imdbId: externalResponse.data.imdb_id || null,
        tmdbId: match.id,
        mediaType
    };
}

module.exports = {
    isAvailable,
    getCzechTitle,
    translateToOriginal
};
