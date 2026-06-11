/**
 * Anime API Service - Direct HiAnime-compatible scraper
 *
 * The site family has changed domains several times. Keep the base URL
 * configurable, and resolve streams through the site's server data-id flow.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { logger } = require('../utils');

const DEFAULT_BASE_URL = process.env.ANIME_BASE_URL || process.env.HIANIME_BASE_URL || 'https://www.hianimes.to';
const LEGACY_EMBED_URL = process.env.ANIME_LEGACY_EMBED_URL || 'https://megaplay.buzz';
const ANIWATCH_BASE_URL = process.env.ANIWATCH_BASE_URL || 'https://aniwatch.co.at';

const SOURCE_DEFINITIONS = {
    hianime: { id: 'hianime', name: 'HiAnime' },
    aniwatch: { id: 'aniwatch', name: 'Aniwatch' }
};

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

function normalizeBaseUrl(url) {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');
    if (!trimmed) return 'https://www.hianimes.to';
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function getBaseUrl() {
    return normalizeBaseUrl(process.env.ANIME_BASE_URL || process.env.HIANIME_BASE_URL || DEFAULT_BASE_URL);
}

function buildUrl(pathname) {
    return `${getBaseUrl()}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function getAniwatchBaseUrl() {
    return normalizeBaseUrl(process.env.ANIWATCH_BASE_URL || ANIWATCH_BASE_URL);
}

function buildAniwatchUrl(pathname) {
    return `${getAniwatchBaseUrl()}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function getAniwatchRestUrl(pathname) {
    return buildAniwatchUrl(`/wp-json/hianime/v1/${String(pathname || '').replace(/^\/+/, '')}`);
}

function absoluteUrl(url, base = getBaseUrl()) {
    if (!url) return null;
    try {
        return new URL(String(url).replace(/&#038;/g, '&'), base).toString();
    } catch {
        return url;
    }
}

function decodeBase64(value) {
    if (!value) return null;
    try {
        return Buffer.from(value, 'base64').toString('utf8');
    } catch {
        return null;
    }
}

function normalizeSource(source) {
    const normalized = String(source || 'hianime').trim().toLowerCase();
    return SOURCE_DEFINITIONS[normalized] ? normalized : 'hianime';
}

function getSourceName(source) {
    return SOURCE_DEFINITIONS[normalizeSource(source)].name;
}

function parseSourceList(sources) {
    const rawSources = Array.isArray(sources)
        ? sources
        : String(sources || 'hianime').split(',');

    const uniqueSources = [...new Set(rawSources.map(normalizeSource))];
    return uniqueSources.length > 0 ? uniqueSources : ['hianime'];
}

function addSourceMetadata(item, source) {
    return {
        ...item,
        source: normalizeSource(source),
        sourceName: getSourceName(source)
    };
}

function getOrigin(url) {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}

function normalizeAnimeId(href) {
    if (!href) return null;
    return href.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '').split('?')[0];
}

function extractEpisodeId(episodeId) {
    const epMatch = String(episodeId || '').match(/(?:\?|&)ep=(\d+)/);
    return epMatch ? epMatch[1] : String(episodeId || '').trim();
}

function extractUpstreamEpisodeId(value) {
    const text = String(value || '');
    return text.match(/[?&]ep=(\d+)/)?.[1]
        || text.match(/\/s-2\/(\d+)\//)?.[1]
        || text.match(/\/s-2\/(\d+)$/)?.[1]
        || null;
}

function extractShowId(animeId) {
    return String(animeId || '').replace(/^\/+/, '').split('?')[0].split('-').pop();
}

function getWatchPath(animeId) {
    const normalizedId = normalizeAnimeId(animeId);
    if (!normalizedId) return null;
    return normalizedId.startsWith('watch/') ? normalizedId : `watch/${normalizedId}`;
}

function getWatchUrl(animeId, episodeId = null) {
    const watchPath = getWatchPath(animeId);
    if (!watchPath) return null;

    if (episodeId) {
        return buildUrl(`/${watchPath}?ep=${extractEpisodeId(episodeId)}`);
    }

    return buildUrl(`/${watchPath}?w=latest`);
}

function getAjaxHeaders(referer = getBaseUrl()) {
    return {
        ...DEFAULT_HEADERS,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': referer
    };
}

function normalizeServerName(serverName) {
    return String(serverName || '').trim().toLowerCase().replace(/\s+/g, '-');
}

function serverMatches(server, requestedName) {
    const requested = normalizeServerName(requestedName);
    const name = normalizeServerName(server.serverName || server.name);
    const serverId = String(server.serverId || '');

    if (!requested || name === requested) return true;

    const aliases = {
        'hd-1': ['hd-1', 'megacloud'],
        'megacloud': ['hd-1', 'megacloud'],
        'hd-2': ['hd-2', 'vidstreaming', 'vidsrc'],
        'vidsrc': ['hd-2', 'vidstreaming', 'vidsrc'],
        'hd-3': ['hd-3', 't-cloud', 'tcloud'],
        't-cloud': ['hd-3', 't-cloud', 'tcloud']
    };

    if (aliases[requested]?.includes(name)) return true;

    return (requested === 'hd-1' || requested === 'megacloud') && serverId === '4'
        || (requested === 'hd-2' || requested === 'vidsrc') && serverId === '1'
        || (requested === 'hd-3' || requested === 't-cloud') && serverId === '6';
}

function pickServer(servers, serverName, type) {
    const typedServers = servers.filter(server => server.type === type);
    if (typedServers.length === 0) return null;

    return typedServers.find(server => serverMatches(server, serverName))
        || typedServers.find(server => serverMatches(server, 'hd-1'))
        || typedServers.find(server => serverMatches(server, 'hd-3'))
        || typedServers.find(server => serverMatches(server, 'hd-2'))
        || typedServers[0];
}

function extractEmbedDataId(html) {
    const $ = cheerio.load(html);

    return $('#megacloud-player').attr('data-id')
        || $('#megaplay-player').attr('data-id')
        || $('.player').attr('data-id')
        || $('[data-id]').first().attr('data-id')
        || html.match(/data-id=["']([^"']+)["']/i)?.[1]
        || null;
}

function extractNestedIframe(html, baseUrl) {
    const $ = cheerio.load(html);
    const src = $('iframe').first().attr('src') || $('iframe').first().attr('data-src');
    return src ? absoluteUrl(src, baseUrl) : null;
}

function cleanEmbedUrl(url) {
    try {
        const parsed = new URL(url);
        parsed.searchParams.delete('autostart');
        return parsed.toString();
    } catch {
        return url;
    }
}

function extractNonce(html) {
    const match48 = html.match(/\b[a-zA-Z0-9]{48}\b/);
    if (match48?.[0]) return match48[0];

    const parts = [];
    const regex16 = /"([a-zA-Z0-9]{16})"/g;
    let match;
    while ((match = regex16.exec(html)) !== null) {
        parts.push(match[1]);
    }

    return parts.length > 0 ? parts.join('') : null;
}

function getEmbedSourceEndpoints(embedLink) {
    const origin = getOrigin(embedLink);
    if (!origin) return [];

    return [
        `${origin}/embed-2/v3/e-1/getSources`,
        `${origin}/embed-2/ajax/e-1/getSources`,
        `${origin}/stream/getSources`
    ];
}

function normalizeSourceResponse(data, embedLink, server) {
    const sources = data?.sources;
    const source = Array.isArray(sources)
        ? sources.find(item => item?.file) || sources[0]
        : sources;

    const file = source?.file || data?.source || data?.file || null;
    if (!file) {
        return null;
    }

    if (data.encrypted === true && typeof file === 'string' && !file.includes('.m3u8')) {
        throw new Error('Encrypted anime source returned. The embed extractor needs an updated decryption method.');
    }

    const embedOrigin = getOrigin(embedLink);
    return {
        type: server.type,
        url: file,
        fileType: source?.type || 'hls',
        tracks: data.tracks || [],
        intro: data.intro || null,
        outro: data.outro || null,
        server: server.serverName,
        referer: data.headers?.Referer || (embedOrigin ? `${embedOrigin}/` : embedLink)
    };
}

async function fetchSourcesFromEmbed(embedLink, server, depth = 0) {
    if (depth > 3) {
        throw new Error('Too many nested anime iframes');
    }

    const cleanedEmbedLink = cleanEmbedUrl(embedLink);
    const embedOrigin = getOrigin(cleanedEmbedLink);
    const embedResponse = await api.get(cleanedEmbedLink, {
        headers: {
            ...DEFAULT_HEADERS,
            'Referer': getBaseUrl()
        }
    });

    const html = String(embedResponse.data || '');
    const dataId = extractEmbedDataId(html);
    if (!dataId) {
        const nestedIframe = extractNestedIframe(html, cleanedEmbedLink);
        if (nestedIframe) {
            return fetchSourcesFromEmbed(nestedIframe, server, depth + 1);
        }

        throw new Error('Could not get embed data-id from player page');
    }

    const nonce = extractNonce(html);
    const endpoints = getEmbedSourceEndpoints(cleanedEmbedLink);
    let lastError = null;

    for (const endpoint of endpoints) {
        const attempts = nonce
            ? [{ id: dataId, _k: nonce }, { id: dataId }]
            : [{ id: dataId }];

        for (const params of attempts) {
            try {
                const response = await api.get(endpoint, {
                    params,
                    headers: {
                        ...getAjaxHeaders(cleanedEmbedLink),
                        'Origin': embedOrigin || undefined
                    }
                });

                const stream = normalizeSourceResponse(response.data, cleanedEmbedLink, server);
                if (stream?.url) return stream;
            } catch (error) {
                lastError = error;
            }
        }
    }

    throw lastError || new Error('No source endpoint returned a playable HLS URL');
}

async function fetchEmbedLink(serverDataId, episodeId) {
    const response = await api.get(buildUrl('/ajax/v2/episode/sources'), {
        params: { id: serverDataId },
        headers: getAjaxHeaders(`${getBaseUrl()}/watch/${episodeId}`)
    });

    const link = response.data?.link || response.data?.url || response.data?.src;
    if (!link) {
        throw new Error(`No embed link returned for server data-id ${serverDataId}`);
    }

    return link;
}

async function fetchLegacyStream(epId, serverName, type) {
    const legacyBase = normalizeBaseUrl(LEGACY_EMBED_URL);
    const streamUrl = `${legacyBase}/stream/s-2/${epId}/${type}`;
    let dataId = epId;

    try {
        const streamResponse = await api.get(streamUrl, {
            headers: {
                ...DEFAULT_HEADERS,
                'Referer': `${legacyBase}/`
            }
        });

        dataId = extractEmbedDataId(String(streamResponse.data || '')) || epId;
    } catch (error) {
        logger.warn('Legacy player page failed, trying direct source lookup', {
            epId,
            error: error.message
        });
    }

    const sourcesResponse = await api.get(`${legacyBase}/stream/getSources`, {
        params: { id: dataId },
        headers: getAjaxHeaders(streamUrl)
    });

    const stream = normalizeSourceResponse(sourcesResponse.data, streamUrl, {
        type,
        serverName
    });

    if (!stream?.url) {
        throw new Error('Legacy player did not return a playable HLS URL');
    }

    stream.referer = `${legacyBase}/`;
    return stream;
}

async function getEpisodesFromWatchPage(animeId) {
    const watchUrl = getWatchUrl(animeId);
    if (!watchUrl) return [];

    const response = await api.get(watchUrl);
    const $ = cheerio.load(response.data);
    const episodes = [];

    $('a[href*="ep="]').each((_, el) => {
        const item = $(el);
        const href = item.attr('href') || '';
        const dataId = item.attr('data-id') || href.match(/[?&]ep=(\d+)/)?.[1];
        const episodeNo = Number(item.attr('data-number') || dataId);

        if (!dataId || !episodeNo) return;

        episodes.push({
            episodeNo,
            id: normalizeAnimeId(href) || dataId,
            dataId,
            title: item.attr('title')?.trim() || item.text().trim().replace(/\s+/g, ' ') || null,
            japaneseTitle: item.attr('data-jname')?.trim() || null,
            isFiller: item.hasClass('ssl-item-filler')
        });
    });

    const unique = new Map();
    for (const episode of episodes) {
        unique.set(episode.episodeNo, episode);
    }

    return [...unique.values()].sort((a, b) => a.episodeNo - b.episodeNo);
}

async function getServersFromWatchPage(episodeId) {
    const epId = extractEpisodeId(episodeId);
    const animeId = String(episodeId || '').split('?')[0];
    const watchUrl = getWatchUrl(animeId, epId);
    if (!watchUrl || animeId === epId) return [];

    const response = await api.get(watchUrl);
    const $ = cheerio.load(response.data);
    const servers = [];

    $('.server-item, [data-src]').each((_, el) => {
        const item = $(el);
        const embedUrl = item.attr('data-src');
        if (!embedUrl) return;

        const resolvedEmbedUrl = absoluteUrl(embedUrl, watchUrl);
        const type = item.attr('data-type') || new URL(resolvedEmbedUrl).searchParams.get('category') || 'sub';
        const serverName = item.find('a, button, .server-item-btn').text().trim()
            || item.text().trim()
            || new URL(resolvedEmbedUrl).searchParams.get('type')
            || 'HD-2';
        const upstreamEpisodeId = extractUpstreamEpisodeId(resolvedEmbedUrl);

        servers.push({
            type,
            dataId: upstreamEpisodeId || epId,
            serverId: item.attr('data-server-id') || null,
            serverName,
            embedUrl: resolvedEmbedUrl
        });
    });

    return servers;
}

/**
 * Search for anime
 * @param {string} keyword - Search query
 * @returns {Promise<Object>} Search results
 */
async function searchHiAnime(keyword) {
    try {
        logger.info(`Anime Scraper: Searching for "${keyword}"`);

        const response = await api.get(buildUrl('/search'), {
            params: { keyword }
        });

        const $ = cheerio.load(response.data);
        const results = [];

        $('#main-content .film_list-wrap .flw-item, .tab-content .film_list-wrap .flw-item').each((_, element) => {
            const el = $(element);
            const link = el.find('.film-poster .film-poster-ahref, a[data-id]').first();
            const titleLink = el.find('.film-detail .film-name .dynamic-name, .film-detail .film-name a').first();

            const id = normalizeAnimeId(titleLink.attr('href')) || normalizeAnimeId(link.attr('href'));
            const dataId = link.attr('data-id') || titleLink.attr('data-id');
            const poster = absoluteUrl(el.find('.film-poster img').attr('data-src') || el.find('.film-poster img').attr('src'));
            const title = titleLink.text().trim() || titleLink.attr('title') || null;
            const japaneseTitle = titleLink.attr('data-jname');

            const tvInfo = {};
            el.find('.film-detail .fd-infor .fdi-item').each((_, item) => {
                const text = $(item).text().trim();
                const lower = text.toLowerCase();
                if (['tv', 'ona', 'movie', 'ova', 'special', 'music'].some(showType => lower.includes(showType))) {
                    tvInfo.showType = text;
                }
            });

            const tickSub = el.find('.tick-sub').text().trim();
            const tickDub = el.find('.tick-dub').text().trim();
            const tickEps = el.find('.tick-eps').text().trim();

            if (tickSub) tvInfo.sub = tickSub;
            if (tickDub) tvInfo.dub = tickDub;
            if (tickEps) tvInfo.eps = tickEps;

            if (id && title) {
                results.push(addSourceMetadata({
                    id,
                    dataId,
                    title,
                    japaneseTitle,
                    poster,
                    tvInfo
                }, 'hianime'));
            }
        });

        return { success: true, results };
    } catch (error) {
        logger.error('Anime search failed', { error: error.message });
        return { success: false, error: error.message, results: [] };
    }
}

async function searchAniwatch(keyword) {
    try {
        logger.info(`Aniwatch Scraper: Searching for "${keyword}"`);

        const response = await api.get(buildAniwatchUrl('/'), {
            params: { s: keyword },
            headers: {
                ...DEFAULT_HEADERS,
                'Referer': getAniwatchBaseUrl()
            }
        });

        const $ = cheerio.load(response.data);
        const results = [];

        $('.film_list-wrap .flw-item').each((_, element) => {
            const el = $(element);
            const link = el.find('.film-poster .film-poster-ahref, a[data-id]').first();
            const titleLink = el.find('.film-detail .film-name .dynamic-name, .film-detail .film-name a').first();

            const animeId = link.attr('data-id');
            const title = titleLink.text().trim() || titleLink.attr('title') || link.attr('title') || null;
            const japaneseTitle = titleLink.attr('data-jname') || null;
            const poster = absoluteUrl(
                el.find('.film-poster img').attr('data-src') || el.find('.film-poster img').attr('src'),
                getAniwatchBaseUrl()
            );

            const tvInfo = {};
            el.find('.film-detail .fd-infor .fdi-item').each((_, item) => {
                const text = $(item).text().trim();
                const lower = text.toLowerCase();

                if (['tv', 'ona', 'movie', 'ova', 'special', 'music'].some(showType => lower.includes(showType))) {
                    tvInfo.showType = text;
                } else if (lower.includes('min')) {
                    tvInfo.duration = text;
                }
            });

            const tickSub = el.find('.tick-sub').text().trim();
            const tickDub = el.find('.tick-dub').text().trim();
            const tickEps = el.find('.tick-eps').text().trim();

            if (tickSub) tvInfo.sub = tickSub;
            if (tickDub) tvInfo.dub = tickDub;
            if (tickEps) tvInfo.eps = tickEps;

            if (animeId && title) {
                results.push(addSourceMetadata({
                    id: String(animeId),
                    dataId: String(animeId),
                    title,
                    japaneseTitle,
                    poster,
                    tvInfo,
                    detailUrl: absoluteUrl(titleLink.attr('href') || link.attr('href'), getAniwatchBaseUrl())
                }, 'aniwatch'));
            }
        });

        return { success: true, results };
    } catch (error) {
        logger.error('Aniwatch search failed', { error: error.message });
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

        const normalizedId = normalizeAnimeId(animeId);
        const response = await api.get(buildUrl(`/${normalizedId}`));
        const $ = cheerio.load(response.data);

        const dataId = extractShowId(normalizedId);
        const titleElement = $('#ani_detail .film-name');
        const title = titleElement.text().trim();
        const japaneseTitle = titleElement.attr('data-jname');
        const poster = absoluteUrl($('#ani_detail .film-poster img').attr('src') || $('#ani_detail .film-poster img').attr('data-src'));
        const showType = $('#ani_detail .prebreadcrumb ol li').eq(1).find('a').text().trim();

        const tvInfo = {};
        $('#ani_detail .film-stats').find('.tick-item, span.item').each((_, element) => {
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

        const animeInfo = {};
        $('#ani_detail .anisc-info .item').each((_, el) => {
            const key = $(el).find('.item-head').text().trim().replace(':', '');
            const value = key === 'Genres' || key === 'Producers'
                ? $(el).find('a').map((_, a) => $(a).text().trim()).get()
                : $(el).find('.name').text().trim();
            if (key) animeInfo[key] = value;
        });

        animeInfo.Overview = $('#ani_detail .film-description .text').text().trim();

        return {
            success: true,
            data: {
                id: normalizedId,
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
async function getHiAnimeEpisodes(animeId) {
    try {
        logger.info(`Anime Scraper: Getting episodes for "${animeId}"`);

        const normalizedId = normalizeAnimeId(animeId);
        const showId = extractShowId(normalizedId);
        const episodes = [];

        try {
            const response = await api.get(buildUrl(`/ajax/v2/episode/list/${showId}`), {
                headers: getAjaxHeaders(`${getBaseUrl()}/watch/${normalizedId}`)
            });

            if (response.data?.html) {
                const $ = cheerio.load(response.data.html);

                $('.detail-infor-content .ss-list a, .ss-list a.ep-item').each((_, el) => {
                    const item = $(el);
                    const episodeNo = Number(item.attr('data-number'));
                    const href = item.attr('href') || '';
                    const dataId = item.attr('data-id') || href.match(/[?&]ep=(\d+)/)?.[1];

                    episodes.push({
                        episodeNo,
                        id: href.split('/')?.pop() || dataId || null,
                        dataId,
                        title: item.attr('title')?.trim() || null,
                        japaneseTitle: item.attr('data-jname')?.trim() || null,
                        isFiller: item.hasClass('ssl-item-filler')
                    });
                });
            }
        } catch (ajaxError) {
            logger.warn('Anime AJAX episode list failed, trying watch-page parser', {
                animeId: normalizedId,
                error: ajaxError.message
            });
        }

        if (episodes.length === 0) {
            episodes.push(...await getEpisodesFromWatchPage(normalizedId));
        }

        if (episodes.length === 0) {
            return { success: false, error: 'No episodes found', episodes: [] };
        }

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

async function getAniwatchEpisodes(animeId) {
    try {
        const normalizedId = String(animeId || '').replace(/^aniwatch:/i, '').trim();
        logger.info(`Aniwatch Scraper: Getting episodes for "${normalizedId}"`);

        const response = await api.get(getAniwatchRestUrl(`episode/list/${normalizedId}`), {
            headers: {
                ...DEFAULT_HEADERS,
                'Accept': 'application/json',
                'Referer': getAniwatchBaseUrl()
            }
        });

        const $ = cheerio.load(response.data?.html || '');
        const episodes = [];

        $('.detail-infor-content .ss-list a, .ss-list a.ep-item').each((_, el) => {
            const item = $(el);
            const episodeNo = Number(item.attr('data-number'));
            const dataId = item.attr('data-id');
            const href = item.attr('href') || '';

            if (!dataId || !episodeNo) return;

            episodes.push(addSourceMetadata({
                episodeNo,
                id: String(dataId),
                dataId: String(dataId),
                title: item.attr('title')?.trim()
                    || item.find('.ep-name').text().trim().replace(/\s+/g, ' ')
                    || `Episode ${episodeNo}`,
                japaneseTitle: item.attr('data-jname')?.trim() || null,
                isFiller: item.hasClass('ssl-item-filler'),
                url: absoluteUrl(href, getAniwatchBaseUrl())
            }, 'aniwatch'));
        });

        if (episodes.length === 0) {
            return { success: false, error: 'No episodes found', episodes: [] };
        }

        return {
            success: true,
            totalEpisodes: episodes.length,
            episodes
        };
    } catch (error) {
        logger.error('Aniwatch get episodes failed', { error: error.message });
        return { success: false, error: error.message, episodes: [] };
    }
}

/**
 * Get available servers for an episode
 * @param {string} episodeId - Episode ID (the number after ?ep=)
 * @returns {Promise<Object>} Available servers
 */
async function getHiAnimeServers(episodeId) {
    try {
        const epId = extractEpisodeId(episodeId);
        logger.info(`Anime Scraper: Getting servers for episode "${epId}"`);

        const servers = [];

        try {
            const response = await api.get(buildUrl('/ajax/v2/episode/servers'), {
                params: { episodeId: epId },
                headers: getAjaxHeaders(getBaseUrl())
            });

            const $ = cheerio.load(response.data?.html || '');

            $('.server-item').each((_, element) => {
                const dataId = $(element).attr('data-id');
                const serverId = $(element).attr('data-server-id');
                const type = $(element).attr('data-type');
                const serverName = $(element).find('a').text().trim();

                if (dataId && type) {
                    servers.push({
                        type,
                        dataId,
                        serverId,
                        serverName
                    });
                }
            });
        } catch (ajaxError) {
            logger.warn('Anime AJAX server list failed, trying watch-page parser', {
                episodeId,
                error: ajaxError.message
            });
        }

        if (servers.length === 0) {
            servers.push(...await getServersFromWatchPage(episodeId));
        }

        return { success: true, servers };
    } catch (error) {
        logger.error('Get servers failed', { error: error.message });
        return { success: false, error: error.message, servers: [] };
    }
}

async function getAniwatchServers(episodeId) {
    try {
        const epId = extractEpisodeId(episodeId);
        logger.info(`Aniwatch Scraper: Getting servers for episode "${epId}"`);

        const response = await api.get(getAniwatchRestUrl(`episode/servers/${epId}`), {
            headers: {
                ...DEFAULT_HEADERS,
                'Accept': 'application/json',
                'Referer': getAniwatchBaseUrl()
            }
        });

        const $ = cheerio.load(response.data?.html || '');
        const servers = [];

        $('.server-item').each((_, element) => {
            const item = $(element);
            const embedUrl = decodeBase64(item.attr('data-hash'));
            const type = item.attr('data-type') || 'sub';
            const serverName = item.attr('data-server-name') || item.find('a, button, .btn').text().trim() || 'HD-1';
            const upstreamEpisodeId = extractUpstreamEpisodeId(embedUrl);

            if (embedUrl && type) {
                servers.push(addSourceMetadata({
                    type,
                    dataId: upstreamEpisodeId || epId,
                    serverId: item.attr('data-server-id') || null,
                    serverName,
                    embedUrl
                }, 'aniwatch'));
            }
        });

        return { success: true, servers };
    } catch (error) {
        logger.error('Aniwatch get servers failed', { error: error.message });
        return { success: false, error: error.message, servers: [] };
    }
}

/**
 * Get streaming info for an episode
 * @param {string} episodeId - Episode ID with ep param
 * @param {string} serverName - Server name (default: hd-1)
 * @param {string} type - 'sub' or 'dub'
 * @returns {Promise<Object>} Streaming info with HLS URL
 */
async function getHiAnimeStreamingInfo(episodeId, serverName = 'hd-1', type = 'dub') {
    const epId = extractEpisodeId(episodeId);

    try {
        logger.info(`Anime Scraper: Getting stream for ep "${epId}" (server: ${serverName}, type: ${type})`);

        const serversResult = await getHiAnimeServers(episodeId);
        if (!serversResult.success || serversResult.servers.length === 0) {
            throw new Error(serversResult.error || 'No episode servers found');
        }

        const server = pickServer(serversResult.servers, serverName, type);
        if (!server) {
            return { success: false, error: `No ${type} server found for episode ${epId}` };
        }

        try {
            const stream = server.embedUrl
                ? await fetchSourcesFromEmbed(server.embedUrl, server)
                : await fetchSourcesFromEmbed(await fetchEmbedLink(server.dataId, episodeId), server);

            return { success: true, stream };
        } catch (sourceError) {
            logger.warn('Primary anime source resolver failed, trying legacy embed fallback', {
                error: sourceError.message,
                episodeId: epId,
                server: server.serverName,
                type
            });

            const fallbackEpId = extractUpstreamEpisodeId(server.embedUrl) || server.dataId || epId;
            const stream = await fetchLegacyStream(fallbackEpId, server.serverName || serverName, type);
            return {
                success: true,
                stream
            };
        }
    } catch (error) {
        logger.error('Get streaming info failed', { error: error.message });
        return { success: false, error: error.message };
    }
}

async function getAniwatchStreamingInfo(episodeId, serverName = 'hd-1', type = 'dub') {
    const epId = extractEpisodeId(episodeId);

    try {
        logger.info(`Aniwatch Scraper: Getting stream for ep "${epId}" (server: ${serverName}, type: ${type})`);

        const serversResult = await getAniwatchServers(epId);
        if (!serversResult.success || serversResult.servers.length === 0) {
            throw new Error(serversResult.error || 'No episode servers found');
        }

        const server = pickServer(serversResult.servers, serverName, type);
        if (!server) {
            return { success: false, error: `No ${type} server found for episode ${epId}` };
        }

        try {
            const upstreamEpisodeId = extractUpstreamEpisodeId(server.embedUrl);
            const stream = upstreamEpisodeId
                ? await fetchLegacyStream(upstreamEpisodeId, server.serverName || serverName, server.type || type)
                : await fetchSourcesFromEmbed(server.embedUrl, server);

            return { success: true, stream };
        } catch (sourceError) {
            logger.warn('Aniwatch direct source resolver failed, trying embed resolver', {
                error: sourceError.message,
                episodeId: epId,
                server: server.serverName,
                type
            });

            const stream = await fetchSourcesFromEmbed(server.embedUrl, server);
            return { success: true, stream };
        }
    } catch (error) {
        logger.error('Aniwatch get streaming info failed', { error: error.message });
        return { success: false, error: error.message };
    }
}

/**
 * Get best streaming URL for an episode (prefers dub, falls back to sub)
 * @param {string} episodeId - Episode ID with ep param
 * @returns {Promise<Object>} Best streaming URL
 */
async function getHiAnimeBestStreamUrl(episodeId) {
    const attempts = [
        { server: 'hd-1', type: 'dub' },
        { server: 'hd-3', type: 'dub' },
        { server: 'hd-2', type: 'dub' },
        { server: 'hd-1', type: 'sub' },
        { server: 'hd-3', type: 'sub' },
        { server: 'hd-2', type: 'sub' }
    ];

    for (const attempt of attempts) {
        const result = await getHiAnimeStreamingInfo(episodeId, attempt.server, attempt.type);
        if (result.success && result.stream?.url) {
            return {
                success: true,
                url: result.stream.url,
                type: result.stream.type,
                server: result.stream.server,
                tracks: result.stream.tracks,
                referer: result.stream.referer
            };
        }
    }

    return { success: false, error: 'No stream available' };
}

async function getAniwatchBestStreamUrl(episodeId) {
    const attempts = [
        { server: 'hd-1', type: 'dub' },
        { server: 'hd-3', type: 'dub' },
        { server: 'hd-2', type: 'dub' },
        { server: 'hd-1', type: 'sub' },
        { server: 'hd-3', type: 'sub' },
        { server: 'hd-2', type: 'sub' }
    ];

    for (const attempt of attempts) {
        const result = await getAniwatchStreamingInfo(episodeId, attempt.server, attempt.type);
        if (result.success && result.stream?.url) {
            return {
                success: true,
                url: result.stream.url,
                type: result.stream.type,
                server: result.stream.server,
                tracks: result.stream.tracks,
                referer: result.stream.referer
            };
        }
    }

    return { success: false, error: 'No stream available' };
}

async function searchAnime(keyword, options = {}) {
    const sources = parseSourceList(options.sources || options.source);
    const sourceSearchers = {
        hianime: searchHiAnime,
        aniwatch: searchAniwatch
    };

    const settledResults = await Promise.all(sources.map(async source => {
        const result = await sourceSearchers[source](keyword);
        return { source, result };
    }));

    const results = [];
    const sourceStatus = {};
    const errors = [];

    for (const { source, result } of settledResults) {
        sourceStatus[source] = {
            success: !!result.success,
            count: result.results?.length || 0,
            error: result.error || null
        };

        if (result.success && result.results?.length) {
            results.push(...result.results);
        } else if (result.error) {
            errors.push(`${getSourceName(source)}: ${result.error}`);
        }
    }

    return {
        success: results.length > 0 || settledResults.some(item => item.result.success),
        results,
        sources: sourceStatus,
        error: results.length > 0 ? null : errors.join('; ') || 'No anime found'
    };
}

async function getEpisodes(animeId, source = 'hianime') {
    return normalizeSource(source) === 'aniwatch'
        ? getAniwatchEpisodes(animeId)
        : getHiAnimeEpisodes(animeId);
}

async function getServers(episodeId, source = 'hianime') {
    return normalizeSource(source) === 'aniwatch'
        ? getAniwatchServers(episodeId)
        : getHiAnimeServers(episodeId);
}

async function getStreamingInfo(episodeId, serverName = 'hd-1', type = 'dub', source = 'hianime') {
    return normalizeSource(source) === 'aniwatch'
        ? getAniwatchStreamingInfo(episodeId, serverName, type)
        : getHiAnimeStreamingInfo(episodeId, serverName, type);
}

async function getBestStreamUrl(episodeId, source = 'hianime') {
    return normalizeSource(source) === 'aniwatch'
        ? getAniwatchBestStreamUrl(episodeId)
        : getHiAnimeBestStreamUrl(episodeId);
}

/**
 * Check if anime scraper is working
 * @returns {Promise<boolean>}
 */
async function checkHiAnimeHealth() {
    try {
        const response = await api.get(buildUrl('/home'), { timeout: 5000 });
        return response.status === 200;
    } catch {
        return false;
    }
}

async function checkAniwatchHealth() {
    try {
        const response = await api.get(buildAniwatchUrl('/'), { timeout: 5000 });
        return response.status === 200;
    } catch {
        return false;
    }
}

async function checkHealth(source = 'hianime') {
    return normalizeSource(source) === 'aniwatch'
        ? checkAniwatchHealth()
        : checkHiAnimeHealth();
}

async function checkSourcesHealth() {
    const [hianime, aniwatch] = await Promise.all([
        checkHiAnimeHealth(),
        checkAniwatchHealth()
    ]);

    return {
        success: hianime || aniwatch,
        sources: {
            hianime: {
                success: hianime,
                name: SOURCE_DEFINITIONS.hianime.name,
                baseUrl: getBaseUrl()
            },
            aniwatch: {
                success: aniwatch,
                name: SOURCE_DEFINITIONS.aniwatch.name,
                baseUrl: getAniwatchBaseUrl()
            }
        }
    };
}

module.exports = {
    searchAnime,
    getAnimeInfo,
    getEpisodes,
    getServers,
    getStreamingInfo,
    getBestStreamUrl,
    checkHealth,
    checkSourcesHealth,
    getBaseUrl,
    getAniwatchBaseUrl,
    getSourceName
};
