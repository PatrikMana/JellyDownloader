/**
 * Prehrajto.cz Scraping Service
 */

const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');
const { logger, durationToSeconds, filesizeToMB } = require('../utils');

const BASE_URL = 'https://prehrajto.cz';

/**
 * Search for videos on prehrajto.cz
 * @param {string} searchTerm - Search query
 * @returns {Promise<Array>} Search results
 */
async function search(searchTerm) {
    const url = `${BASE_URL}/hledej/${encodeURIComponent(searchTerm)}`;
    logger.info(`Searching prehrajto: ${searchTerm}`);
    
    const response = await axios.get(url, {
        headers: { 'User-Agent': config.axios.userAgent },
        timeout: config.axios.timeout
    });
    
    const $ = cheerio.load(response.data);
    const results = [];
    
    $('.video__picture--container').each((index, element) => {
        const $el = $(element);
        const linkElement = $el.find('a').first();
        const imgElement = $el.find('img').first();
        const durationElement = $el.find('.video__tag--time').first();
        const sizeElement = $el.find('.video__tag--size').first();
        
        const href = linkElement.attr('href');
        const title = linkElement.attr('title');
        const imageSrc = imgElement.attr('src');
        const duration = durationElement.text().trim();
        const size = sizeElement.text().trim();
        
        if (href && title) {
            results.push({
                href,
                title,
                imageSrc: imageSrc || '',
                duration: duration || '',
                size: size || '',
                durationNumeric: durationToSeconds(duration),
                sizeNumeric: filesizeToMB(size)
            });
        }
    });
    
    logger.info(`Found ${results.length} results`);
    return results;
}

/**
 * Process sources array and extract qualities
 * @param {Array} sourcesArray - Array of video sources
 * @returns {Array} Array of quality objects
 */
function processSourcesArray(sourcesArray) {
    const foundQualities = [];
    
    sourcesArray.forEach((item, index) => {
        if (item.file || item.src) {
            const src = item.file || item.src;
            
            let res = 0;
            let label = `Video ${index + 1}`;
            
            // Try to get resolution from object properties
            if (item.res) {
                res = parseInt(item.res);
                label = `${res}p`;
            } else if (item.quality) {
                // Sometimes quality is used instead of res
                if (item.quality.includes('1080')) res = 1080;
                else if (item.quality.includes('720')) res = 720;
                else if (item.quality.includes('480')) res = 480;
                label = item.quality;
            } else {
                // Heuristics - detect from URL or index
                const urlQualityMatch = src.match(/(\d{3,4})p/i);
                if (urlQualityMatch) {
                    res = parseInt(urlQualityMatch[1]);
                    label = `${res}p`;
                } else if (src.includes('1080') || src.includes('fullhd') || src.includes('fhd')) {
                    res = 1080;
                    label = '1080p';
                } else if (src.includes('720') || src.includes('hd')) {
                    res = 720;
                    label = '720p';
                } else {
                    // Fallback by index (first = lower quality, later = higher)
                    if (index === 0) {
                        res = 720;
                        label = '720p';
                    } else {
                        res = 1080;
                        label = '1080p';
                    }
                }
            }
            
            foundQualities.push({ src, res, label, index });
        }
    });
    
    return foundQualities;
}

/**
 * Get video page and extract video URLs
 * @param {string} videoPath - Video path (e.g., "video/xxxxx")
 * @returns {Promise<Object>} Video data with qualities
 */
async function getVideoDetails(videoPath) {
    const url = `${BASE_URL}/${videoPath}`;
    logger.info(`Fetching video details: ${videoPath}`);
    
    const response = await axios.get(url, {
        headers: { 'User-Agent': config.axios.userAgent },
        timeout: config.axios.timeout
    });
    
    const html = response.data;
    let qualities = [];
    let videoUrl = null;
    let subtitles = [];
    
    // Method 1: Parse var videos = [...] and var tracks = [...] (primary method for prehrajto.cz)
    // The page typically has: var videos = [...]; var tracks = [...]; var sources = {videos: videos, tracks: tracks};
    
    // Extract videos array
    const videosMatch = html.match(/var\s+videos\s*=\s*(\[[\s\S]*?\]);/);
    // Extract tracks array
    const tracksMatch = html.match(/var\s+tracks\s*=\s*(\[[\s\S]*?\]);/);
    
    if (videosMatch) {
        try {
            logger.debug('Found videos array');
            const videosArray = new Function('return ' + videosMatch[1])();
            
            if (Array.isArray(videosArray) && videosArray.length > 0) {
                logger.info(`Found ${videosArray.length} video sources`);
                const foundQualities = processSourcesArray(videosArray);
                qualities = foundQualities.filter(q => q.src && q.src.startsWith('http')).sort((a, b) => b.res - a.res);
                if (qualities.length > 0) {
                    videoUrl = qualities[0].src;
                }
            }
        } catch (parseError) {
            logger.warn('Failed to parse videos array', { error: parseError.message });
        }
    }
    
    if (tracksMatch) {
        try {
            logger.debug('Found tracks array');
            const tracksArray = new Function('return ' + tracksMatch[1])();
            
            if (Array.isArray(tracksArray) && tracksArray.length > 0) {
                logger.info(`Found ${tracksArray.length} subtitle tracks`);
                // Debug: log first track structure
                logger.info('Track structure: ' + JSON.stringify(tracksArray[0]));
                
                subtitles = tracksArray
                    .filter(track => track.src || track.file)
                    .map(track => ({
                        src: track.src || track.file,
                        label: track.label || track.kind || 'Titulky',
                        language: track.srclang || track.language || 'cs'
                    }));
                logger.info(`Extracted ${subtitles.length} subtitles`);
            }
        } catch (parseError) {
            logger.warn('Failed to parse tracks array', { error: parseError.message });
        }
    }
    
    // Method 2: Try old format - var sources = [...] (direct array)
    if (!videoUrl) {
        const sourcesMatch = html.match(/var\s+sources\s*=\s*(\[[\s\S]*?\]);/);
        
        if (sourcesMatch) {
            try {
                logger.debug('Found sources array (old format)');
                const sourcesArray = new Function('return ' + sourcesMatch[1])();
                
                if (Array.isArray(sourcesArray) && sourcesArray.length > 0) {
                    const foundQualities = processSourcesArray(sourcesArray);
                    qualities = foundQualities.filter(q => q.src && q.src.startsWith('http')).sort((a, b) => b.res - a.res);
                    if (qualities.length > 0) {
                        videoUrl = qualities[0].src;
                    }
                }
            } catch (parseError) {
                logger.warn('Failed to parse sources array', { error: parseError.message });
            }
        }
    }
    
    // Method 3: Try Playerjs config if sources array not found
    if (!videoUrl) {
        const playerjsMatch = html.match(/new\s+Playerjs\s*\(\s*(\{[\s\S]*?\})\s*\)/);
        
        if (playerjsMatch) {
            try {
                const fileMatch = playerjsMatch[1].match(/file\s*:\s*"([^"]+)"/);
                
                if (fileMatch) {
                    const fileContent = fileMatch[1];
                    
                    // Check for multi-quality format: [Label]url,[Label]url
                    if (fileContent.includes('[') && fileContent.includes(']')) {
                        const qualityParts = fileContent.split(',');
                        
                        for (const part of qualityParts) {
                            const match = part.match(/\[([^\]]+)\](.+)/);
                            if (match) {
                                const label = match[1].trim();
                                let src = match[2].trim();
                                
                                if (src.includes('\\u')) {
                                    src = JSON.parse(`"${src}"`);
                                }
                                
                                if (src.startsWith('http')) {
                                    const resMatch = label.match(/(\d+)p?/i);
                                    const res = resMatch ? parseInt(resMatch[1]) : 0;
                                    qualities.push({ src, label, res });
                                }
                            }
                        }
                        
                        qualities.sort((a, b) => b.res - a.res);
                        if (qualities.length > 0) {
                            videoUrl = qualities[0].src;
                        }
                    } else {
                        // Single quality
                        let src = fileContent;
                        if (src.includes('\\u')) {
                            src = JSON.parse(`"${src}"`);
                        }
                        
                        if (src.startsWith('http')) {
                            videoUrl = src;
                            qualities.push({ src, res: 0, label: 'Default' });
                        }
                    }
                }
            } catch (parseError) {
                logger.warn('Failed to parse playerjs config', { error: parseError.message });
            }
        }
    }
    
    // Method 3: Fallback - search for direct video URLs
    if (!videoUrl) {
        const urlPatterns = [
            /https?:\/\/[^"'\s]+\.(?:mp4|mkv|avi|webm)(?:\?[^"'\s]*)?/gi,
            /"(https?:\/\/[^"]+(?:\.mp4|\.mkv|\.avi|\.webm)[^"]*)"/gi
        ];
        
        for (const pattern of urlPatterns) {
            const matches = html.match(pattern);
            if (matches && matches.length > 0) {
                videoUrl = matches[0].replace(/["']/g, '');
                if (videoUrl.startsWith('http')) {
                    qualities.push({ src: videoUrl, res: 0, label: 'Default' });
                    break;
                }
            }
        }
    }
    
    if (!videoUrl) {
        throw new Error('Video URL not found');
    }
    
    logger.info(`Found ${qualities.length} quality options`);
    
    return {
        videoUrl,
        qualities,
        subtitles,
        sourceUrl: url
    };
}

module.exports = {
    search,
    getVideoDetails,
    BASE_URL
};
