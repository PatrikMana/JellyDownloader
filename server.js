// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { pipeline } = require('stream');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);
const crypto = require('crypto');
const { EventEmitter } = require('events');

const downloadJobs = new Map(); // jobId -> { emitter, ...state }

const app = express();
const PORT = process.env.PORT || 3000;

// IMDB API Configuration
const OMDB_API_KEY = process.env.OMDB_API_KEY || 'your-api-key-here'; // Get from http://www.omdbapi.com/apikey.aspx
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const JELLYFIN_DIR = process.env.JELLYFIN_DIR || null; // Set to your Jellyfin media path, e.g., '/path/to/jellyfin/movies'

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function createJob(initial) {
    const jobId = crypto.randomUUID();
    const emitter = new EventEmitter();
    const job = {
        jobId,
        emitter,
        status: 'queued',
        createdAt: Date.now(),
        ...initial
    };
    downloadJobs.set(jobId, job);
    return job;
}

function emitJob(job, payload) {
    job.emitter.emit('evt', payload);
}

function cleanupJobLater(jobId, ms = 60 * 60 * 1000) { // 1h
    setTimeout(() => downloadJobs.delete(jobId), ms).unref?.();
}

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint pro vyhledávání filmů
app.get('/api/search/:searchTerm', async (req, res) => {
  try {
    const searchTerm = encodeURIComponent(req.params.searchTerm);
    const url = `https://prehrajto.cz/hledej/${searchTerm}`;
    
    console.log(`🔍 Vyhledávám: ${req.params.searchTerm}`);
    console.log(`📡 URL: ${url}`);
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });
    
    const $ = cheerio.load(response.data);
    const results = [];
    
    // Parsování výsledků (stejné jako v Ruby verzi)
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
          href: href,
          title: title,
          imageSrc: imageSrc || '',
          duration: duration || '',
          size: size || '',
          durationNumeric: durationToSeconds(duration),
          sizeNumeric: filesizeToMB(size)
        });
      }
    });
    
    console.log(`✅ Nalezeno ${results.length} výsledků`);
    res.json({
      success: true,
      results: results,
      count: results.length
    });
    
  } catch (error) {
    console.error('❌ Chyba při vyhledávání:', error.message);
    res.status(500).json({
      success: false,
      error: 'Chyba při vyhledávání filmů',
      details: error.message
    });
  }
});

app.get('/api/download/progress/:jobId', (req, res) => {
    const job = downloadJobs.get(req.params.jobId);
    if (!job) return res.status(404).end();

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    // initial snapshot
    send({ type: 'hello', jobId: job.jobId, status: job.status });

    const onEvt = (payload) => send(payload);
    job.emitter.on('evt', onEvt);

    // keepalive
    const ka = setInterval(() => res.write(`: ping\n\n`), 15000);

    req.on('close', () => {
        clearInterval(ka);
        job.emitter.off('evt', onEvt);
        res.end();
    });
});

// API endpoint pre získanie video URL
app.get('/api/video/:moviePath(*)', async (req, res) => {
  try {
    const moviePath = req.params.moviePath;
    const url = `https://prehrajto.cz/${moviePath}`;
    
    console.log(`🎬 Získavam video URL pre: ${moviePath}`);
    console.log(`📡 URL: ${url}`);
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://prehrajto.cz/',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 15000
    });
    
    const html = response.data;
    console.log(`📄 HTML délka: ${html.length} znaků`);
    
    // Najdi JavaScript sekci s video sources (stejná logika jako Ruby)
    const sourcesStart = html.indexOf('var sources');
    const tracksStart = html.indexOf('var tracks');
    
    if (sourcesStart === -1 || tracksStart === -1) {
      console.log('🔍 Hledám alternativní vzory...');
      
      // Zkus alternativní vzory
      const altPatterns = [
        /"file"\s*:\s*"([^"]*\.(mp4|mkv|avi|webm)[^"]*)"/g,
        /"src"\s*:\s*"([^"]*\.(mp4|mkv|avi|webm)[^"]*)"/g,
        /source\s*:\s*"([^"]*\.(mp4|mkv|avi|webm)[^"]*)"/g
      ];
      
      let videoUrl = null;
      for (const pattern of altPatterns) {
        const match = html.match(pattern);
        if (match && match[0]) {
          videoUrl = match[0].replace(/.*"([^"]+)".*/, '$1');
          console.log(`✅ Video URL nalezena alternativním vzorem: ${videoUrl}`);
          break;
        }
      }
      
      if (!videoUrl) {
        throw new Error('Video sources nebyly nalezeny v HTML - ani standardním ani alternativním způsobem');
      }
      
      res.json({
        success: true,
        videoUrl: videoUrl,
        moviePath: moviePath,
        method: 'alternative'
      });
      return;
    }
    
    const jsSection = html.substring(sourcesStart, tracksStart);
    console.log('🔍 JavaScript sekce:', jsSection.substring(0, 200) + '...');
    
    // Extrakce video URL pomocí regex - vylepšené
    const urlPatterns = [
      /"([^"]*\.(mp4|mkv|avi|webm)[^"]*)"/g,
      /'([^']*\.(mp4|mkv|avi|webm)[^']*)'/g,
      /file\s*:\s*"([^"]*\.(mp4|mkv|avi|webm)[^"]*)"/g
    ];
    
    let videoUrl = null;
    for (const pattern of urlPatterns) {
      const matches = jsSection.match(pattern);
      if (matches && matches.length > 0) {
        videoUrl = matches[0].replace(/['"]/g, '');
        if (videoUrl.startsWith('http')) {
          console.log(`✅ Video URL nalezena vzorem: ${videoUrl}`);
          break;
        }
      }
    }
    
    if (!videoUrl || !videoUrl.startsWith('http')) {
      throw new Error('Video URL nebyla nalezena v JavaScript kódu nebo není validní HTTP URL');
    }
    
    res.json({
      success: true,
      videoUrl: videoUrl,
      moviePath: moviePath,
      method: 'standard'
    });
    
  } catch (error) {
    console.error('❌ Chyba při získávání video URL:', error.message);
    res.status(500).json({
      success: false,
      error: 'Chyba při získávání video odkazu',
      details: error.message,
      moviePath: req.params.moviePath
    });
  }
});

// IMDB API endpoint
app.get('/api/imdb/:title/:year?', async (req, res) => {
    try {
        const { title, year } = req.params;
        
        if (OMDB_API_KEY === 'your-api-key-here') {
            // Mock IMDB data for development
            const mockData = {
                imdbID: 'tt' + Math.random().toString().substring(2, 9),
                Title: title,
                Year: year || new Date().getFullYear().toString(),
                Type: 'movie',
                Genre: 'Action, Drama',
                Director: 'Unknown Director',
                Actors: 'Unknown Actors',
                Plot: 'Plot not available',
                Poster: 'N/A',
                imdbRating: '7.5'
            };
            
            console.log('📺 Returning mock IMDB data for:', title);
            return res.json({ success: true, data: mockData });
        }
        
        // Real OMDB API call
        const searchUrl = `http://www.omdbapi.com/?apikey=${OMDB_API_KEY}&t=${encodeURIComponent(title)}${year ? `&y=${year}` : ''}`;
        
        console.log('🔍 Searching IMDB for:', title, year ? `(${year})` : '');
        const response = await axios.get(searchUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (response.data.Response === 'True') {
            console.log('✅ IMDB data found:', response.data.Title);
            res.json({ success: true, data: response.data });
        } else {
            console.log('❌ IMDB not found:', response.data.Error);
            res.status(404).json({
                success: false,
                error: response.data.Error || 'Film nebyl v IMDB databázi nalezen'
            });
        }
    } catch (error) {
        console.error('Chyba při IMDB vyhledávání:', error.message);
        res.status(500).json({
            success: false,
            error: 'Nepodařilo se získat IMDB informace'
        });
    }
});

// IMDB Search API endpoint for series
app.get('/api/imdb/series/search/:query', async (req, res) => {
    try {
        const query = req.params.query;
        
        if (OMDB_API_KEY === 'your-api-key-here') {
            // Mock IMDB search data for development
            console.log('🎭 Mock IMDB search for query:', query);
            
            const mockResults = [
                {
                    imdbID: 'tt0903747',
                    Title: `${query} - Season 1`,
                    Year: '2008–2013',
                    Type: 'series',
                    Poster: 'N/A'
                },
                {
                    imdbID: 'tt1520211',
                    Title: `${query} - Alternative Series`,
                    Year: '2010–2017',
                    Type: 'series',
                    Poster: 'N/A'
                },
                {
                    imdbID: 'tt2234222',
                    Title: `${query} (2020)`,
                    Year: '2020–2023',
                    Type: 'series',
                    Poster: 'N/A'
                }
            ];
            
            console.log('📺 Returning mock IMDB search results:', mockResults);
            return res.json({ success: true, results: mockResults });
        }
        
        // Real OMDB API search
        const searchUrl = `http://www.omdbapi.com/?apikey=${OMDB_API_KEY}&s=${encodeURIComponent(query)}&type=series`;
        
        console.log('🔍 Searching IMDB for series:', query);
        const response = await axios.get(searchUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (response.data.Response === 'True') {
            console.log(`✅ Found ${response.data.Search.length} series results`);
            res.json({ success: true, results: response.data.Search });
        } else {
            console.log('❌ No series found:', response.data.Error);
            res.json({ success: true, results: [] });
        }
    } catch (error) {
        console.error('Chyba při IMDB vyhledávání seriálů:', error.message);
        res.status(500).json({
            success: false,
            error: 'Nepodařilo se vyhledat seriály v IMDB databázi'
        });
    }
});

// Get series details including seasons
app.get('/api/imdb/series/:imdbId', async (req, res) => {
    try {
        const imdbId = req.params.imdbId;
        
        if (OMDB_API_KEY === 'your-api-key-here') {
            // Mock series details
            const mockSeasons = [];
            for (let i = 1; i <= 5; i++) {
                mockSeasons.push({
                    season: i,
                    episodes: Math.floor(Math.random() * 15) + 8, // 8-22 episodes
                    year: 2020 + i - 1
                });
            }
            
            const mockData = {
                imdbID: imdbId,
                Title: 'Mock Series Title',
                totalSeasons: '5',
                seasons: mockSeasons
            };
            
            console.log('📺 Returning mock series details for:', imdbId);
            return res.json({ success: true, data: mockData });
        }
        
        // Real OMDB API call for series details
        const detailsUrl = `http://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${imdbId}`;
        
        console.log('🔍 Getting series details for:', imdbId);
        const response = await axios.get(detailsUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (response.data.Response === 'True') {
            const seriesData = response.data;
            const totalSeasons = parseInt(seriesData.totalSeasons) || 1;
            
            // Generate season info (OMDB doesn't provide episode counts per season easily)
            const seasons = [];
            for (let i = 1; i <= totalSeasons; i++) {
                seasons.push({
                    season: i,
                    episodes: 10, // Default, could be enhanced with more API calls
                    year: parseInt(seriesData.Year) + i - 1
                });
            }
            
            seriesData.seasons = seasons;
            
            console.log(`✅ Series details found: ${seriesData.Title} (${totalSeasons} seasons)`);
            res.json({ success: true, data: seriesData });
        } else {
            console.log('❌ Series details not found:', response.data.Error);
            res.status(404).json({
                success: false,
                error: response.data.Error || 'Detaily seriálu nebyly nalezeny'
            });
        }
    } catch (error) {
        console.error('Chyba při získávání detailů seriálu:', error.message);
        res.status(500).json({
            success: false,
            error: 'Nepodařilo se získat detaily seriálu'
        });
    }
});

// Titulky.com scraping endpoint
app.get('/api/subtitles/:title/:year?', async (req, res) => {
    try {
        const { title, year } = req.params;
        const searchQuery = `${title} ${year || ''}`.trim();
        
        console.log('📝 Searching subtitles for:', searchQuery);
        
        // Search on titulky.com
        const searchUrl = `https://titulky.com/hledej.php?search=${encodeURIComponent(searchQuery)}&action=search`;
        
        const response = await axios.get(searchUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'cs,sk;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });
        
        const $ = cheerio.load(response.data);
        const subtitles = [];
        
        // Parse subtitle results
        $('.table tr').each((index, element) => {
            if (index === 0) return; // Skip header
            
            const $row = $(element);
            const $link = $row.find('a[href*="detail.php"]');
            
            if ($link.length > 0) {
                const subtitleTitle = $link.text().trim();
                const subtitleUrl = 'https://titulky.com/' + $link.attr('href');
                const language = $row.find('td').eq(2).text().trim();
                const format = $row.find('td').eq(3).text().trim();
                
                subtitles.push({
                    title: subtitleTitle,
                    url: subtitleUrl,
                    language: language,
                    format: format
                });
            }
        });
        
        console.log(`✅ Found ${subtitles.length} subtitles`);
        
        res.json({
            success: true,
            subtitles: subtitles,
            searchQuery: searchQuery
        });
        
    } catch (error) {
        console.error('Chyba při vyhledávání titulků:', error.message);
        res.status(500).json({
            success: false,
            error: 'Nepodařilo se vyhledat titulky'
        });
    }
});

// Helper function to generate Jellyfin-compatible filename
function generateJellyfinFilename(title, imdbData, type = 'movie', season = null, episode = null) {
    // Clean title (remove invalid filename characters)
    const cleanTitle = title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
    
    if (type === 'movie') {
        // Movies: Movie Title (Year) [imdbid-ttXXXXXXX]
        // Jellyfin format: /movies/Movie Title (Year)/Movie Title (Year).ext
        const year = imdbData?.Year || 'Unknown';
        const imdbId = imdbData?.imdbID || '';
        const suffix = imdbId ? ` [imdbid-${imdbId}]` : '';
        return `${cleanTitle} (${year})${suffix}`;
    } else if (type === 'series') {
        // Series: Series Name [imdbid-ttXXXXXXX]/Season XX/SeriesName - sXXeYY - Episode Title.ext
        // Jellyfin format: /tvshows/Series Name (Year)/Season 01/Series Name - s01e01 - Episode Title.ext
        const imdbId = imdbData?.imdbID || '';
        const suffix = imdbId ? ` [imdbid-${imdbId}]` : '';
        
        if (season !== null && episode !== null) {
            const s = String(season).padStart(2, '0');
            const e = String(episode).padStart(2, '0');
            return `${cleanTitle}${suffix} - s${s}e${e}`;
        }
        return `${cleanTitle}${suffix}`;
    }
    return cleanTitle;
}

// Helper function to get Jellyfin directory structure
function getJellyfinPath(title, imdbData, type = 'movie', season = null) {
    const baseDir = JELLYFIN_DIR || DOWNLOADS_DIR;
    const cleanTitle = title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
    
    if (type === 'movie') {
        const year = imdbData?.Year || 'Unknown';
        const imdbId = imdbData?.imdbID || '';
        const suffix = imdbId ? ` [imdbid-${imdbId}]` : '';
        const movieDir = `${cleanTitle} (${year})${suffix}`;
        return path.join(baseDir, 'movies', movieDir);
    } else if (type === 'series') {
        const imdbId = imdbData?.imdbID || '';
        const suffix = imdbId ? ` [imdbid-${imdbId}]` : '';
        const seriesDir = `${cleanTitle}${suffix}`;
        
        if (season !== null) {
            const seasonDir = `Season ${String(season).padStart(2, '0')}`;
            return path.join(baseDir, 'tvshows', seriesDir, seasonDir);
        }
        return path.join(baseDir, 'tvshows', seriesDir);
    }
    return baseDir;
}

// Download endpoint
app.post('/api/download', async (req, res) => {
    const { videoUrl, title, imdbData, type = 'movie', subtitles = [], season = null, episode = null } = req.body;

    if (!videoUrl || !title) {
        return res.status(400).json({ success: false, error: 'Chybí povinné parametry (videoUrl, title)' });
    }

    // vytvoř job
    const job = createJob({ title, type });
    cleanupJobLater(job.jobId);

    // okamžitě vrať jobId
    res.json({ success: true, jobId: job.jobId });

    // a teď teprve dělej download
    (async () => {
        let videoPath = null;

        try {
            job.status = 'downloading';
            emitJob(job, { type: 'progress', jobId: job.jobId, progress: 0, downloadedBytes: 0, totalBytes: 0, speedBps: 0, etaSec: null });

            // Get video file extension from URL
            const urlExt = videoUrl.match(/\.(mp4|mkv|avi|webm)(?:[?#]|$)/i);
            const videoExt = urlExt ? urlExt[1] : 'mp4';

            const downloadDir = getJellyfinPath(title, imdbData, type, season);
            const baseFilename = generateJellyfinFilename(title, imdbData, type, season, episode);
            const videoFilename = `${baseFilename}.${videoExt}`;
            videoPath = path.join(downloadDir, videoFilename);

            if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

            job.abortController = new AbortController();
            job.createdFiles = [];

            const videoResponse = await axios({
                method: 'GET',
                url: videoUrl,
                responseType: 'stream',
                timeout: 0,
                maxRedirects: 5,
                signal: job.abortController.signal,   // <-- DŮLEŽITÉ
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Referer': 'https://prehrajto.cz/',
                    'Accept': '*/*',
                    'Connection': 'keep-alive'
                }
            });
            job.httpStream = videoResponse.data;

            const writeStream = fs.createWriteStream(videoPath);
            job.writeStream = writeStream;
            job.videoPath = videoPath;
            job.downloadDir = downloadDir;


            const totalBytes = parseInt(videoResponse.headers['content-length']) || 0;

            let downloadedBytes = 0;
            let lastTickBytes = 0;
            let lastTickTime = Date.now();
            const startTime = Date.now();

            videoResponse.data.on('data', (chunk) => {
                downloadedBytes += chunk.length;

                const now = Date.now();
                if (now - lastTickTime >= 1000) {
                    const dt = (now - lastTickTime) / 1000;
                    const dB = downloadedBytes - lastTickBytes;
                    const speed = dt > 0 ? (dB / dt) : 0;
                    const etaSec = (totalBytes > 0 && speed > 0) ? ((totalBytes - downloadedBytes) / speed) : null;
                    const progress = totalBytes > 0 ? (downloadedBytes / totalBytes * 100) : 0;

                    emitJob(job, {
                        type: 'progress',
                        jobId: job.jobId,
                        downloadedBytes,
                        totalBytes,
                        progress,
                        speedBps: speed,
                        etaSec,
                        elapsedSec: (now - startTime) / 1000
                    });

                    lastTickBytes = downloadedBytes;
                    lastTickTime = now;
                }
            });

            await pipelineAsync(videoResponse.data, writeStream);

            // titulky (ponechávám tvůj přístup; pokud titulky nejsou přímo stažitelné, může být potřeba upravit)
            const subtitleFiles = [];
            for (const subtitle of subtitles) {
                try {
                    const subtitleFilename = `${baseFilename}.${subtitle.language}.srt`;
                    const subtitlePath = path.join(downloadDir, subtitleFilename);

                    const subtitleResponse = await axios({
                        method: 'GET',
                        url: subtitle.url,
                        responseType: 'stream',
                        timeout: 15000,
                        headers: { 'User-Agent': 'Mozilla/5.0' }
                    });

                    const subtitleWriteStream = fs.createWriteStream(subtitlePath);
                    await pipelineAsync(subtitleResponse.data, subtitleWriteStream);
                    job.createdFiles.push(subtitlePath);
                    subtitleFiles.push(subtitleFilename);
                } catch (e) {
                    // ignore failed subtitles
                }
            }

            // metadata
            const metadataFilename = `${baseFilename}.nfo`;
            const metadataPath = path.join(downloadDir, metadataFilename);

            const metadata = type === 'movie'
                ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
  <title>${escapeXml(title)}</title>
  <originaltitle>${escapeXml(imdbData?.Title || title)}</originaltitle>
  <year>${imdbData?.Year || ''}</year>
  <plot><![CDATA[${imdbData?.Plot || ''}]]></plot>
  <runtime>${imdbData?.Runtime || ''}</runtime>
  <genre>${imdbData?.Genre || ''}</genre>
  <director>${imdbData?.Director || ''}</director>
  <actor>${imdbData?.Actors || ''}</actor>
  <id>${imdbData?.imdbID || ''}</id>
  <imdbid>${imdbData?.imdbID || ''}</imdbid>
  <rating>${imdbData?.imdbRating || ''}</rating>
  <poster>${imdbData?.Poster || ''}</poster>
</movie>`
                : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<tvshow>
  <title>${escapeXml(title)}</title>
  <year>${imdbData?.Year || ''}</year>
  <plot><![CDATA[${imdbData?.Plot || ''}]]></plot>
  <genre>${imdbData?.Genre || ''}</genre>
  <id>${imdbData?.imdbID || ''}</id>
  <imdbid>${imdbData?.imdbID || ''}</imdbid>
  <rating>${imdbData?.imdbRating || ''}</rating>
</tvshow>`;

            fs.writeFileSync(metadataPath, metadata, 'utf8');
            job.createdFiles.push(metadataPath);

            job.status = 'done';

            emitJob(job, {
                type: 'done',
                jobId: job.jobId,
                files: {
                    video: path.basename(videoPath),
                    subtitles: subtitleFiles,
                    metadata: metadataFilename
                },
                path: downloadDir,
                jellyfinReady: JELLYFIN_DIR !== null,
                instructions: JELLYFIN_DIR
                    ? 'Soubory jsou připravené pro Jellyfin. Spusťte Library Scan v Jellyfin.'
                    : `Soubory jsou v: ${downloadDir}. Přesuněte je do Jellyfin knihovny a spusťte Library Scan.`
            });

        } catch (error) {
            // Pokud už někdo mezitím dal cancel, ber to jako "canceled", ne jako error
            if (job.status === 'canceled') {
                // (soubory už endpoint cancel zkusil mazat, ale pro jistotu můžeš znovu)
                emitJob(job, {
                    type: 'canceled',
                    jobId: job.jobId,
                    message: 'Stahování bylo zrušeno.'
                });
                return;
            }

            job.status = 'error';

            // clean up partial file
            if (videoPath && fs.existsSync(videoPath)) {
                try { fs.unlinkSync(videoPath); } catch {}
            }

            emitJob(job, {
                type: 'error',
                jobId: job.jobId,
                error: error?.message || 'Stahování selhalo'
            });
        }
    })();
});

app.post('/api/download/cancel/:jobId', async (req, res) => {
    const job = downloadJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job nenalezen' });

    // pokud už je hotovo/failed, nemá co rušit
    if (job.status === 'done') {
        return res.status(409).json({ success: false, error: 'Download už je dokončen' });
    }

    job.status = 'canceled';

    // 1) abort HTTP request (axios)
    try { job.abortController?.abort(); } catch {}

    // 2) znič streamy
    try { job.httpStream?.destroy?.(); } catch {}
    try { job.writeStream?.destroy?.(); } catch {}

    // 3) smaž rozpracované soubory
    const toDelete = [];

    if (job.videoPath) toDelete.push(job.videoPath);

    if (Array.isArray(job.createdFiles)) {
        for (const fp of job.createdFiles) toDelete.push(fp);
    }

    for (const fp of toDelete) {
        try {
            if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
        } catch {}
    }

    emitJob(job, {
        type: 'canceled',
        jobId: job.jobId,
        message: 'Stahování zrušeno. Částečné soubory byly smazány.'
    });

    return res.json({ success: true });
});

// Get downloads list
app.get('/api/downloads', (req, res) => {
    try {
        if (!fs.existsSync(DOWNLOADS_DIR)) {
            return res.json({ success: true, files: [] });
        }
        
        const files = fs.readdirSync(DOWNLOADS_DIR).map(filename => {
            const filePath = path.join(DOWNLOADS_DIR, filename);
            const stats = fs.statSync(filePath);
            
            return {
                filename: filename,
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime
            };
        });
        
        res.json({ success: true, files: files });
    } catch (error) {
        console.error('Error listing downloads:', error.message);
        res.status(500).json({
            success: false,
            error: 'Nepodařilo se načíst seznam stažených souborů'
        });
    }
});

// Delete downloaded file
app.delete('/api/downloads/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(DOWNLOADS_DIR, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: 'Soubor nebyl nalezen'
            });
        }
        
        fs.unlinkSync(filePath);
        console.log('🗑️ File deleted:', filename);
        
        res.json({
            success: true,
            message: 'Soubor byl smazán'
        });
    } catch (error) {
        console.error('Error deleting file:', error.message);
        res.status(500).json({
            success: false,
            error: 'Nepodařilo se smazat soubor'
        });
    }
});

// Pomocné funkce (stejné jako v Ruby)
function escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function durationToSeconds(durationStr) {
  if (!durationStr || durationStr === '') return 0;
  
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]; // HH:MM:SS
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1]; // MM:SS
  }
  return 0;
}

function filesizeToMB(filesizeStr) {
  if (!filesizeStr || filesizeStr === '') return 0;
  
  const parts = filesizeStr.trim().toUpperCase().split(/\s+/);
  if (parts.length < 2) return 0;
  
  const number = parseFloat(parts[0]);
  const unit = parts[1];
  
  switch (unit) {
    case 'GB': return Math.round(number * 1024);
    case 'MB': return Math.round(number);
    case 'KB': return Math.ceil(number / 1024);
    default: return 0;
  }
}

// Spuštění serveru
app.listen(PORT, () => {
  console.log(`🚀 Prehrajto Downloader server běží na http://localhost:${PORT}`);
  console.log(`📁 Statické soubory se servírují z 'public' složky`);
  console.log(`📥 Downloads adresář: ${DOWNLOADS_DIR}`);
  console.log(`🎬 IMDB API: ${OMDB_API_KEY === 'your-api-key-here' ? 'MOCK MODE' : 'ACTIVE'}`);
});