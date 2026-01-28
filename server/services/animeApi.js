/**
 * Anime API Service - Direct Scraper
 * Scrapes anime from hianime.to (formerly zoro.to)
 * Based on: https://github.com/itzzzme/anime-api
 */

const axios = require('axios');
const cheerio = require('cheerio');
const CryptoJS = require('crypto-js');
const { logger } = require('../utils');

// Base URLs
const BASE_URL = 'hianime.to';
const FALLBACK_URL_1 = 'megaplay.buzz';
const FALLBACK_URL_2 = 'vidwish.live';

// Default headers
const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br'
};

const api = axios.create({
    timeout: 30000,
    headers: DEFAULT_HEADERS
});

/**
 * Search for anime
 * @param {string} keyword - Search query
 * @returns {Promise<Object>} Search results
 */
async function searchAnime(keyword) {
    try {
        logger.info(`Anime Scraper: Searching for "${keyword}"`);
        
        const response = await api.get(`https://${BASE_URL}/search`, {
            params: { keyword }
        });

        const $ = cheerio.load(response.data);
        const results = [];

        $('#main-content .film_list-wrap .flw-item').each((_, element) => {
            const el = $(element);
            
            const id = el.find('.film-poster .film-poster-ahref').attr('href')?.replace('/', '').split('?')[0] || null;
            const dataId = el.find('.film-poster .film-poster-ahref').attr('data-id');
            const poster = el.find('.film-poster img').attr('data-src');
            const title = el.find('.film-detail .film-name .dynamic-name').text().trim();
            const japaneseTitle = el.find('.film-detail .film-name .dynamic-name').attr('data-jname');
            
            const tvInfo = {};
            const fdiItems = el.find('.film-detail .fd-infor .fdi-item');
            fdiItems.each((_, item) => {
                const text = $(item).text().trim().toLowerCase();
                if (['tv', 'ona', 'movie', 'ova', 'special', 'music'].some(type => text.includes(type))) {
                    tvInfo.showType = $(item).text().trim();
                }
            });

            // Get sub/dub info
            const tickSub = el.find('.tick-sub').text().trim();
            const tickDub = el.find('.tick-dub').text().trim();
            const tickEps = el.find('.tick-eps').text().trim();
            
            if (tickSub) tvInfo.sub = tickSub;
            if (tickDub) tvInfo.dub = tickDub;
            if (tickEps) tvInfo.eps = tickEps;

            if (id) {
                results.push({
                    id,
                    dataId,
                    title,
                    japaneseTitle,
                    poster,
                    tvInfo
                });
            }
        });

        return { success: true, results };
    } catch (error) {
        logger.error('Anime search failed', { error: error.message });
        return { success: false, error: error.message, results: [] };
    }
}

/**
 * Get anime info by ID
 * @param {string} animeId - Anime ID (e.g., "naruto-shippuden-355")
 * @returns {Promise<Object>} Anime info
 */
async function getAnimeInfo(animeId) {
    try {
        logger.info(`Anime Scraper: Getting info for "${animeId}"`);
        
        const response = await api.get(`https://${BASE_URL}/${animeId}`);
        const $ = cheerio.load(response.data);

        const dataId = animeId.split('-').pop();
        const titleElement = $('#ani_detail .film-name');
        const title = titleElement.text().trim();
        const japaneseTitle = titleElement.attr('data-jname');
        
        const posterElement = $('#ani_detail .film-poster');
        const poster = posterElement.find('img').attr('src');
        
        const showType = $('#ani_detail .prebreadcrumb ol li').eq(1).find('a').text().trim();

        // Get TV info
        const tvInfo = {};
        const tvInfoElement = $('#ani_detail .film-stats');
        tvInfoElement.find('.tick-item, span.item').each((_, element) => {
            const el = $(element);
            const text = el.text().trim();
            if (el.hasClass('tick-quality')) tvInfo.quality = text;
            else if (el.hasClass('tick-sub')) tvInfo.sub = text;
            else if (el.hasClass('tick-dub')) tvInfo.dub = text;
            else if (el.hasClass('tick-eps')) tvInfo.eps = text;
            else if (el.hasClass('tick-pg')) tvInfo.rating = text;
            else if (el.is('span.item')) {
                if (!tvInfo.showType) tvInfo.showType = text;
                else if (!tvInfo.duration) tvInfo.duration = text;
            }
        });

        // Get anime info details
        const animeInfo = {};
        const infoElement = $('#ani_detail .anisc-info .item');
        infoElement.each((_, el) => {
            const key = $(el).find('.item-head').text().trim().replace(':', '');
            const value = key === 'Genres' || key === 'Producers'
                ? $(el).find('a').map((_, a) => $(a).text().trim()).get()
                : $(el).find('.name').text().trim();
            animeInfo[key] = value;
        });

        const overviewElement = $('#ani_detail .film-description .text');
        animeInfo['Overview'] = overviewElement.text().trim();

        return {
            success: true,
            data: {
                id: animeId,
                dataId,
                title,
                japaneseTitle,
                poster,
                showType,
                tvInfo,
                animeInfo
            }
        };
    } catch (error) {
        logger.error('Get anime info failed', { error: error.message });
        return { success: false, error: error.message };
    }
}

/**
 * Get episodes for anime
 * @param {string} animeId - Anime ID
 * @returns {Promise<Object>} Episodes list
 */
async function getEpisodes(animeId) {
    try {
        logger.info(`Anime Scraper: Getting episodes for "${animeId}"`);
        
        const showId = animeId.split('-').pop();
        const response = await api.get(`https://${BASE_URL}/ajax/v2/episode/list/${showId}`, {
            headers: {
                ...DEFAULT_HEADERS,
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `https://${BASE_URL}/watch/${animeId}`
            }
        });

        if (!response.data.html) {
            return { success: false, error: 'No episodes found', episodes: [] };
        }

        const $ = cheerio.load(response.data.html);
        const episodes = [];

        $('.detail-infor-content .ss-list a').each((_, el) => {
            const episodeNo = Number($(el).attr('data-number'));
            const id = $(el).attr('href')?.split('/')?.pop() || null;
            const title = $(el).attr('title')?.trim() || null;
            const japaneseTitle = $(el).attr('data-jname')?.trim() || null;
            const dataId = $(el).attr('data-id');
            const isFiller = $(el).hasClass('ssl-item-filler');

            episodes.push({
                episodeNo,
                id,
                dataId,
                title,
                japaneseTitle,
                isFiller
            });
        });

        return {
            success: true,
            totalEpisodes: episodes.length,
            episodes
        };
    } catch (error) {
        logger.error('Get episodes failed', { error: error.message });
        return { success: false, error: error.message, episodes: [] };
    }
}

/**
 * Get available servers for an episode
 * @param {string} episodeId - Episode ID (the number after ?ep=)
 * @returns {Promise<Object>} Available servers
 */
async function getServers(episodeId) {
    try {
        // Extract episode number from episodeId if it contains ?ep=
        const epMatch = episodeId.match(/ep=(\d+)/);
        const epId = epMatch ? epMatch[1] : episodeId;
        
        logger.info(`Anime Scraper: Getting servers for episode "${epId}"`);
        
        const response = await api.get(`https://${BASE_URL}/ajax/v2/episode/servers`, {
            params: { episodeId: epId },
            headers: {
                ...DEFAULT_HEADERS,
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        const $ = cheerio.load(response.data.html);
        const servers = [];

        $('.server-item').each((_, element) => {
            const dataId = $(element).attr('data-id');
            const serverId = $(element).attr('data-server-id');
            const type = $(element).attr('data-type'); // sub, dub, raw
            const serverName = $(element).find('a').text().trim();

            servers.push({
                type,
                dataId,
                serverId,
                serverName
            });
        });

        return { success: true, servers };
    } catch (error) {
        logger.error('Get servers failed', { error: error.message });
        return { success: false, error: error.message, servers: [] };
    }
}

/**
 * Get streaming info for an episode using fallback server
 * @param {string} episodeId - Episode ID with ep param
 * @param {string} serverName - Server name (default: hd-1)
 * @param {string} type - 'sub' or 'dub'
 * @returns {Promise<Object>} Streaming info with HLS URL
 */
async function getStreamingInfo(episodeId, serverName = 'hd-1', type = 'dub') {
    try {
        // Extract episode number from episodeId
        const epMatch = episodeId.match(/ep=(\d+)/);
        const epId = epMatch ? epMatch[1] : episodeId;
        
        logger.info(`Anime Scraper: Getting stream for ep "${epId}" (server: ${serverName}, type: ${type})`);

        // Use fallback server directly to get stream
        const fallbackServer = ['hd-1', 'hd-3'].includes(serverName.toLowerCase()) 
            ? FALLBACK_URL_1 
            : FALLBACK_URL_2;

        try {
            const streamResponse = await api.get(`https://${fallbackServer}/stream/s-2/${epId}/${type}`, {
                headers: {
                    ...DEFAULT_HEADERS,
                    'Referer': `https://${fallbackServer}/`
                }
            });

            const $ = cheerio.load(streamResponse.data);
            const dataId = $('#megaplay-player').attr('data-id');

            if (!dataId) {
                return { success: false, error: 'Could not get data-id from player' };
            }

            // Get sources
            const sourcesResponse = await api.get(`https://${fallbackServer}/stream/getSources`, {
                params: { id: dataId },
                headers: {
                    ...DEFAULT_HEADERS,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': `https://${fallbackServer}/stream/s-2/${epId}/${type}`
                }
            });

            const sourcesData = sourcesResponse.data;

            if (sourcesData?.sources?.file) {
                return {
                    success: true,
                    stream: {
                        type: type,
                        url: sourcesData.sources.file,
                        fileType: 'hls',
                        tracks: sourcesData.tracks || [],
                        intro: sourcesData.intro || null,
                        outro: sourcesData.outro || null,
                        server: serverName,
                        referer: `https://${fallbackServer}/`
                    }
                };
            }
        } catch (fallbackError) {
            logger.error(`Fallback server ${fallbackServer} failed`, { error: fallbackError.message });
        }

        return { success: false, error: 'No streaming link found' };
    } catch (error) {
        logger.error('Get streaming info failed', { error: error.message });
        return { success: false, error: error.message };
    }
}

/**
 * Get best streaming URL for an episode (prefers dub, falls back to sub)
 * @param {string} episodeId - Episode ID with ep param
 * @returns {Promise<Object>} Best streaming URL
 */
async function getBestStreamUrl(episodeId) {
    // First try English dub with hd-1
    let result = await getStreamingInfo(episodeId, 'hd-1', 'dub');
    
    if (result.success && result.stream?.url) {
        return {
            success: true,
            url: result.stream.url,
            type: 'dub',
            server: result.stream.server,
            tracks: result.stream.tracks,
            referer: result.stream.referer
        };
    }

    // Try hd-2 server with dub
    result = await getStreamingInfo(episodeId, 'hd-2', 'dub');
    if (result.success && result.stream?.url) {
        return {
            success: true,
            url: result.stream.url,
            type: 'dub',
            server: result.stream.server,
            tracks: result.stream.tracks,
            referer: result.stream.referer
        };
    }

    // Fall back to sub if dub not available
    result = await getStreamingInfo(episodeId, 'hd-1', 'sub');
    if (result.success && result.stream?.url) {
        return {
            success: true,
            url: result.stream.url,
            type: 'sub',
            server: result.stream.server,
            tracks: result.stream.tracks,
            referer: result.stream.referer
        };
    }

    // Final fallback - try hd-2 sub
    result = await getStreamingInfo(episodeId, 'hd-2', 'sub');
    if (result.success && result.stream?.url) {
        return {
            success: true,
            url: result.stream.url,
            type: 'sub',
            server: result.stream.server,
            tracks: result.stream.tracks,
            referer: result.stream.referer
        };
    }

    return { success: false, error: 'No stream available' };
}

/**
 * Check if anime scraper is working
 * @returns {Promise<boolean>}
 */
async function checkHealth() {
    try {
        const response = await api.get(`https://${BASE_URL}/home`, { timeout: 5000 });
        return response.status === 200;
    } catch {
        return false;
    }
}

module.exports = {
    searchAnime,
    getAnimeInfo,
    getEpisodes,
    getServers,
    getStreamingInfo,
    getBestStreamUrl,
    checkHealth
};
