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
        qualities: [{ src: videoUrl, res: 0, label: 'Default' }],
        maxResolution: null,
        moviePath: moviePath,
        method: 'alternative'
      });
      return;
    }
    
    const jsSection = html.substring(sourcesStart, tracksStart);
    console.log('🔍 JavaScript sekce:', jsSection.substring(0, 200) + '...');
    
    // Parse sources array podle tvého skriptu
    let qualities = [];
    let videoUrl = null;
    let maxResolution = 0;
    
    try {
      console.log('📦 Parsing sources using browser-like logic...');
      
      // Extrahi celý sources = [...] block
      const sourcesMatch = jsSection.match(/var\s+sources\s*=\s*(\[[\s\S]*?\]);/);
      
      if (sourcesMatch) {
        const sourcesArrayText = sourcesMatch[1];
        console.log('🔍 Found sources array, length:', sourcesArrayText.length);
        
        try {
          // Bezpečnější parsing - použij Function constructor místo eval
          const sourcesArray = new Function('return ' + sourcesArrayText)();
          
          if (Array.isArray(sourcesArray) && sourcesArray.length > 0) {
            console.log(`📋 Sources array has ${sourcesArray.length} items`);
            
            // Simulate your script logic: sources.videos.map((item) => ...)
            // But prehrajto uses sources directly as array of video objects
            const foundQualities = [];
            
            sourcesArray.forEach((item, index) => {
              if (item.file || item.src) {
                const src = item.file || item.src;
                
                console.log(`📹 Video ${index}: checking item:`, { 
                  hasRes: !!item.res, 
                  hasQuality: !!item.quality,
                  hasSize: !!item.size,
                  urlLength: src.length
                });
                
                // Zkus získat res z objektu
                let res = 0;
                let label = `Video ${index + 1}`;
                
                if (item.res) {
                  res = parseInt(item.res);
                  label = `${res}p`;
                  console.log(`  ✅ Found explicit res: ${res}p`);
                } else if (item.quality) {
                  // Někdy je quality místo res
                  if (item.quality.includes('1080')) res = 1080;
                  else if (item.quality.includes('720')) res = 720;
                  else if (item.quality.includes('480')) res = 480;
                  label = item.quality;
                  console.log(`  ✅ Found quality property: ${label}`);
                } else {
                  // Lepší heuristika - zkus více indikátorů
                  console.log(`  🔍 Using heuristics for quality detection...`);
                  
                  // 1) Hledej pattern v URL (např. "720p", "1080p")
                  const urlQualityMatch = src.match(/(\d{3,4})p/i);
                  if (urlQualityMatch) {
                    res = parseInt(urlQualityMatch[1]);
                    label = `${res}p`;
                    console.log(`    📍 URL pattern: ${label}`);
                  }
                  // 2) Hledej keywords v URL
                  else if (src.includes('1080') || src.includes('fullhd') || src.includes('fhd')) {
                    res = 1080;
                    label = '1080p';
                    console.log(`    📍 URL keyword: 1080p`);
                  }
                  else if (src.includes('720') || src.includes('hd')) {
                    res = 720;
                    label = '720p';
                    console.log(`    📍 URL keyword: 720p`);
                  }
                  // 3) Fallback: rozliš podle indexu (první = horší, poslední = lepší)
                  else {
                    // V prehrajto.cz je obvykle první video HORŠÍ kvalita, druhé LEPŠÍ
                    if (index === 0) {
                      res = 720;   // První = 720p
                      label = '720p';
                      console.log(`    📍 Index fallback: 720p (first video)`);
                    } else {
                      res = 1080;  // Druhý/další = 1080p
                      label = '1080p';
                      console.log(`    📍 Index fallback: 1080p (later video)`);
                    }
                  }
                }
                
                foundQualities.push({
                  src: src,
                  res: res,
                  label: label,
                  index: index
                });
                
                console.log(`  💾 Added: ${label} (${res}p)`);
              }
            });
            
            // Seřaď podle rozlišení (nejvyšší první)
            qualities = foundQualities
              .filter(q => q.src && q.src.startsWith('http'))
              .sort((a, b) => b.res - a.res);
              
            if (qualities.length > 0) {
              console.log(`✅ Nalezeno ${qualities.length} kvalit:`, qualities.map(q => `${q.label}(${q.res})`).join(', '));
              videoUrl = qualities[0].src;
              maxResolution = qualities[0].res;
            }
          }
        } catch (evalError) {
          console.warn('⚠️ Nepodařilo se parsovat sources array:', evalError.message);
        }
      }
      
      if (qualities.length === 0) {
        console.log('⚠️ Žádné kvality nenalezeny, zkusím fallback...');
      }
    } catch (parseError) {
      console.warn('⚠️ Nepodařilo se parsovat sources:', parseError.message);
    }
    
    // Fallback: použij regex na extrakci první URL
    if (!videoUrl) {
      const urlPatterns = [
        /"([^"]*\.(mp4|mkv|avi|webm)[^"]*)"/g,
        /'([^']*\.(mp4|mkv|avi|webm)[^']*)'/g,
        /file\s*:\s*"([^"]*\.(mp4|mkv|avi|webm)[^"]*)"/g
      ];
      
      for (const pattern of urlPatterns) {
        const matches = jsSection.match(pattern);
        if (matches && matches.length > 0) {
          videoUrl = matches[0].replace(/['"]/g, '');
          if (videoUrl.startsWith('http')) {
            console.log(`✅ Video URL nalezena vzorem (fallback): ${videoUrl}`);
            break;
          }
        }
      }
    }
    
    if (!videoUrl || !videoUrl.startsWith('http')) {
      throw new Error('Video URL nebyla nalezena v JavaScript kódu nebo není validní HTTP URL');
    }
    
    // Pokud jsme nenašli žádné kvality, vytvoř alespoň jednu
    if (qualities.length === 0) {
      qualities.push({
        src: videoUrl,
        res: 0,
        label: 'Default'
      });
    }
    
    res.json({
      success: true,
      videoUrl: videoUrl,  // nejvyšší kvalita jako default
      qualities: qualities,
      maxResolution: maxResolution || null,
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
        const rawTitle = req.params.title;
        const yearParam = req.params.year || null;
        const originalQuery = req.query.originalQuery || null; // Původní hledaný výraz od uživatele
        
        if (OMDB_API_KEY === 'your-api-key-here') {
            // Mock IMDB data for development
            const mockData = {
                imdbID: 'tt' + Math.random().toString().substring(2, 9),
                Title: rawTitle,
                Year: yearParam || new Date().getFullYear().toString(),
                Type: 'movie',
                Genre: 'Action, Drama',
                Director: 'Unknown Director',
                Actors: 'Unknown Actors',
                Plot: 'Plot not available',
                Poster: 'N/A',
                imdbRating: '7.5'
            };
            
            console.log('📺 [IMDB][MOCK] raw="%s" | returning mock', rawTitle);
            return res.json({ success: true, data: mockData });
        }
        
        // === NOVÝ PŘÍSTUP: Nejprve zkusíme originalQuery (bez regexu) ===
        if (originalQuery && originalQuery.trim()) {
            console.log(`[IMDB][STEP1] Zkouším původní query uživatele: "${originalQuery}"`);
            const queryResult = await resolveImdbSimple(originalQuery.trim(), yearParam);
            
            if (queryResult.found) {
                const d = queryResult.data;
                console.log(
                    `[IMDB][FOUND-QUERY] originalQuery="${originalQuery}" | ` +
                    `-> "${d.Title}" (${d.Year}) ${d.imdbID}`
                );
                return res.json({ success: true, data: queryResult.data });
            } else {
                console.log(`[IMDB][STEP1-MISS] Původní query "${originalQuery}" nenašlo nic, pokračuji s názvem z Prehrajto...`);
            }
        }
        
        // === FALLBACK: Použij rawTitle s regex čištěním ===
        console.log(`[IMDB][STEP2] Zkouším název z Prehrajto s regex: "${rawTitle}"`);
        const result = await resolveImdb(rawTitle, yearParam);
        
        // Logování do Node konzole
        if (result.found) {
            const d = result.data;
            console.log(
                `[IMDB][FOUND] raw="${rawTitle}" | clean="${result.queryTitle}" | ` +
                `year=${result.year || 'N/A'} | type=${result.type} | method=${result.method} | ` +
                `alias=${result.alias || 'none'} | ep=${result.ep ? `S${result.ep.season}E${result.ep.episode}` : 'none'} | ` +
                `-> "${d.Title}" (${d.Year}) ${d.imdbID}`
            );
            
            // Pokud byla search fallback, ukaž kandidáty
            if (result.pickedFromSearch) {
                console.log(`  [IMDB][SEARCH] score=${result.pickedFromSearch.bestScore} | candidates=[${result.pickedFromSearch.candidates.join(', ')}]`);
            }
            
            return res.json({ success: true, data: result.data });
        } else {
            console.log(
                `[IMDB][NOTFOUND] raw="${rawTitle}" | clean="${result.queryTitle}" | ` +
                `year=${result.year || 'N/A'} | type=${result.type} | method=${result.method} | ` +
                `alias=${result.alias || 'none'} | ep=${result.ep ? `S${result.ep.season}E${result.ep.episode}` : 'none'}`
            );
            
            if (result.candidates) {
                console.log(`  [IMDB][SEARCH] no pick, candidates=[${result.candidates.join(', ')}]`);
            }
            
            return res.status(404).json({
                success: false,
                error: 'Film nebyl v IMDB databázi nalezen'
            });
        }
    } catch (error) {
        console.error('[IMDB][ERROR]', error.message);
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

// Get all seasons with episodes for a series
app.get('/api/imdb/series/:imdbId/seasons', async (req, res) => {
    try {
        const imdbId = req.params.imdbId;
        
        if (OMDB_API_KEY === 'your-api-key-here') {
            // Mock data for development
            const mockSeasons = [];
            for (let s = 1; s <= 3; s++) {
                const episodes = [];
                const episodeCount = Math.floor(Math.random() * 8) + 6; // 6-13 episodes
                for (let e = 1; e <= episodeCount; e++) {
                    episodes.push({
                        Episode: e.toString(),
                        Title: `Epizoda ${e} - Mock název`,
                        Released: `2020-0${s}-${e.toString().padStart(2, '0')}`,
                        imdbRating: (Math.random() * 3 + 7).toFixed(1),
                        imdbID: `tt${Math.random().toString().substring(2, 9)}`
                    });
                }
                mockSeasons.push({
                    season: s,
                    episodes: episodes
                });
            }
            
            console.log('📺 Returning mock seasons with episodes for:', imdbId);
            return res.json({ success: true, seasons: mockSeasons });
        }
        
        // First get series details to know how many seasons
        const detailsUrl = `http://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${imdbId}`;
        const detailsResponse = await axios.get(detailsUrl, { timeout: 10000 });
        
        if (detailsResponse.data.Response !== 'True') {
            return res.status(404).json({
                success: false,
                error: 'Seriál nebyl nalezen'
            });
        }
        
        const totalSeasons = parseInt(detailsResponse.data.totalSeasons) || 1;
        const seriesTitle = detailsResponse.data.Title;
        
        console.log(`📺 Loading ${totalSeasons} seasons for: ${seriesTitle}`);
        
        // Fetch all seasons in parallel
        const seasonPromises = [];
        for (let s = 1; s <= totalSeasons; s++) {
            const seasonUrl = `http://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${imdbId}&Season=${s}`;
            seasonPromises.push(
                axios.get(seasonUrl, { timeout: 10000 })
                    .then(response => ({
                        season: s,
                        data: response.data
                    }))
                    .catch(err => ({
                        season: s,
                        error: err.message
                    }))
            );
        }
        
        const seasonResults = await Promise.all(seasonPromises);
        
        const seasons = seasonResults
            .filter(result => result.data && result.data.Response === 'True')
            .map(result => ({
                season: result.season,
                episodes: (result.data.Episodes || []).map(ep => ({
                    Episode: ep.Episode,
                    Title: ep.Title,
                    Released: ep.Released,
                    imdbRating: ep.imdbRating,
                    imdbID: ep.imdbID
                }))
            }));
        
        console.log(`✅ Loaded ${seasons.length} seasons with episodes`);
        
        res.json({
            success: true,
            seriesTitle: seriesTitle,
            totalSeasons: totalSeasons,
            seasons: seasons
        });
        
    } catch (error) {
        console.error('Chyba při získávání sezón:', error.message);
        res.status(500).json({
            success: false,
            error: 'Nepodařilo se získat sezóny seriálu'
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

// Advanced IMDB resolver with aliases and fallback
// === ROBUST TITLE PARSING PIPELINE ===

function stripDiacritics(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const EP_RE = /\bS(\d{1,2})E(\d{1,2})\b|\b(\d{1,2})x(\d{1,2})\b/i;
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/;

// všechen "bordel" co se typicky objevuje v názvech z prehrajto
const JUNK_RE = new RegExp(
    String.raw`\b(` +
    [
        // jazyk/audio
        `cz`, `czech`, `cesky`, `česky`, `čeština`,
        `sk`, `slovak`, `slovensky`, `slovenčina`,
        `en`, `eng`, `english`, `dual`, `multi`,
        `dab`, `dabing`, `dubbing`, `czdab`, `czdabing`, `dub`,
        `titulky`, `tit`, `sub`, `subs`, `subtitle`, `forced`,

        // kvalita / rozlišení
        `4k`, `uhd`, `fhd`, `hdr`, `dv`, `dolby\\s*vision`,
        `2160p`, `1080p`, `720p`, `480p`,

        // zdroj
        `web[-_. ]?dl`, `webrip`, `bluray`, `brrip`, `bdrip`, `dvdrip`, `hdtv`, `cam`, `ts`,

        // kodeky
        `x264`, `x265`, `h\\.?264`, `h\\.?265`, `hevc`,
        `aac`, `ac3`, `dts`, `truehd`, `atmos`,

        // "marketing" slova z uploadů
        `topkvalita`, `super\\s*film`, `uhdrdv`, `tuta`
    ].join('|') +
    String.raw`)\b`,
    'ig'
);

// odstranění file extensions a divných oddělovačů
function normalizeSeparators(s) {
    return s
        .replace(/\.(mp4|mkv|avi|webm)\b/ig, ' ')
        .replace(/[+_.]/g, ' ')
        .replace(/[-–—]/g, ' ')
        .replace(/[!?~]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// odstranit závorky/hranaté závorky, ALE nevyhodit rok když je uvnitř
function stripBracketsButKeepYear(s) {
    // (2022) -> nech rok, (CZ Dabing) -> pryč
    s = s.replace(/\(([^)]*)\)/g, (m, inside) => {
        const y = inside.match(YEAR_RE);
        return y ? ` ${y[1]} ` : ' ';
    });
    s = s.replace(/\[([^\]]*)\]/g, ' '); // [1830] apod pryč
    return s;
}

function cleanForOmdb(raw) {
    const original = (raw || '').toString().trim();
    if (!original) return { original, clean: '', year: null, season: null, episode: null, isEpisode: false };

    // 1) basic normalize
    let s = original;
    s = stripBracketsButKeepYear(s);
    s = normalizeSeparators(s);
    s = stripDiacritics(s);

    // 2) episode detection (seriály)
    let season = null, episode = null, isEpisode = false;
    const epm = s.match(EP_RE);
    if (epm) {
        isEpisode = true;
        season = parseInt(epm[1] || epm[3], 10);
        episode = parseInt(epm[2] || epm[4], 10);
        // odstraň SxxEyy / 1x02 z názvu
        s = s.replace(EP_RE, ' ');
    }

    // 3) year extraction (a potom ho z názvu pryč)
    let year = null;
    const ym = s.match(YEAR_RE);
    if (ym) year = parseInt(ym[1], 10);
    s = s.replace(YEAR_RE, ' ');

    // 4a) vyházej slepené jazyk+audio tagy typu "CZdabing", "CZDub", "ENsubs" apod.
    s = s.replace(/\b(?:cz|sk|en)(?:\s*)?(?:dabing|dab|dub|dubbing|subs?|subtitle|titulky|tit)\b/ig, ' ');

    // 4) vyházej junk tagy
    s = s.replace(JUNK_RE, ' ');

    // 5) poslední dočištění
    s = s.replace(/\b(sezona|serie|rada)\b/ig, ' '); // "1-série" apod
    s = s.replace(/\b\d+\s*serie\b/ig, ' ');
    s = s.replace(/\s+/g, ' ').trim();

    return { original, clean: s, year, season, episode, isEpisode };
}

/**
 * Kandidáti pro OMDb v pořadí (od nejlepších po fallbacky)
 * - vždy nakonec raw input uživatele
 * - navíc: pokud titul končí " 1", zkus i verzi bez té jedničky (Avatar 1 -> Avatar)
 */
function buildOmdbCandidates(raw) {
    const p = cleanForOmdb(raw);

    const candidates = [];
    const push = (title, year) => {
        title = (title || '').trim();
        if (!title) return;
        const key = `${title.toLowerCase()}|${year || ''}`;
        if (!candidates.some(c => `${c.title.toLowerCase()}|${c.year || ''}` === key)) {
            candidates.push({ title, year: year || null });
        }
    };

    // hlavní čistý název
    push(p.clean, p.year);

    // pokud končí "... 1", zkus i bez 1 (typicky Avatar 1)
    if (/\b1$/.test(p.clean)) push(p.clean.replace(/\b1$/, '').trim(), p.year);

    // bez roku (když rok byl špatně/nejistý)
    push(p.clean, null);

    // fallback: raw input (uživatel často napíše "správný" název)
    // lehce normalizovaný (bez přípon), ale nechám obsah
    const rawNorm = normalizeSeparators(stripDiacritics(raw));
    push(rawNorm, null);

    return { parsed: p, candidates };
}

// Legacy helpers (pro kompatibilitu)
function normalizeBasic(s) {
    return stripDiacritics(String(s || ''))
        .toLowerCase()
        .replace(/\+/g, ' ')
        .replace(/[._]+/g, ' ')
        .replace(/[\[\]{}()]/g, ' ')
        .replace(/[^a-z0-9\s:,-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractYearAny(raw) {
    const m = String(raw || '').match(YEAR_RE);
    return m ? m[1] : null;
}

function detectEpisode(raw) {
    const s = String(raw || '');
    let m = s.match(EP_RE);
    if (m) return { season: +(m[1] || m[3]), episode: +(m[2] || m[4]) };
    return null;
}

function cleanTitleForSearch(raw) {
    return cleanForOmdb(raw).clean;
}

// CZ -> EN aliases
const TITLE_ALIASES = [
    { match: /avatar.*legenda.*aangovi/i, title: 'Avatar: The Last Airbender', type: 'series' },
    { match: /hra.*olihe[nň]/i, title: 'Squid Game', type: 'series' },
    { match: /hra.*tr[uů]ny/i, title: 'Game of Thrones', type: 'series' },
    { match: /ml[cč]en[ií].*jeh[nň][aá]tek/i, title: 'The Silence of the Lambs', type: 'movie' },
    { match: /pod.*tosk[aá]nsk[yý]m.*sluncem/i, title: 'Under the Tuscan Sun', type: 'movie' },
    { match: /j[ií]st.*meditovat.*milovat/i, title: 'Eat Pray Love', type: 'movie' },
    { match: /hr[aá][cč]i.*se.*smrt[ií]/i, title: 'Flatliners', type: 'movie' },
];

function tokenOverlapScore(a, b) {
    const A = new Set(normalizeBasic(a).split(' ').filter(Boolean));
    const B = new Set(normalizeBasic(b).split(' ').filter(Boolean));
    let hit = 0;
    for (const t of A) if (B.has(t)) hit++;
    return hit;
}

async function omdbGet(params) {
    const url = `https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&${params}`;
    const r = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    
    if (r.data?.Response === 'False' && r.data?.Error) {
        console.log(`[OMDb] Response=False | params="${params}" | error="${r.data.Error}"`);
    }
    return r;
}

function pickImdbSuggestKey(q) {
    const s = stripDiacritics(String(q || '').trim().toLowerCase());
    const ch = s[0] || 'a';
    return /[a-z0-9]/.test(ch) ? ch : 'a';
}

async function imdbSuggest(query) {
    const q = stripDiacritics(String(query || '').trim());
    if (!q) return [];

    const key = pickImdbSuggestKey(q);
    const url = `https://v2.sg.media-imdb.com/suggestion/${key}/${encodeURIComponent(q)}.json`;

    try {
        const r = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        return Array.isArray(r.data?.d) ? r.data.d : [];
    } catch {
        return [];
    }
}

/**
 * Jednoduchý IMDB resolver - bez regex čištění
 * Použije se pro původní hledaný výraz od uživatele
 * Strategie: t= exact match -> s= search -> imdb suggest
 */
async function resolveImdbSimple(query, yearHint = null, typeHint = 'movie') {
    const cleanQuery = stripDiacritics(String(query || '').trim());
    if (!cleanQuery) return { found: false };
    
    // Extrakce roku z query (pokud je přítomen)
    const yearMatch = cleanQuery.match(/\b(19\d{2}|20\d{2})\b/);
    const year = yearHint || (yearMatch ? yearMatch[1] : null);
    
    // Odstranění roku z query pro čistší hledání
    const titleWithoutYear = cleanQuery.replace(/\s*\b(19\d{2}|20\d{2})\b\s*/g, ' ').trim();
    
    console.log(`[IMDB-SIMPLE] query="${cleanQuery}" | titleWithoutYear="${titleWithoutYear}" | year=${year || 'N/A'}`);
    
    // 1) Zkus t= exact match (nejrychlejší a nejpřesnější)
    const params = `t=${encodeURIComponent(titleWithoutYear)}${year ? `&y=${year}` : ''}&type=${typeHint}`;
    try {
        const r = await omdbGet(params);
        if (r.data?.Response === 'True') {
            console.log(`[IMDB-SIMPLE][HIT-T] "${titleWithoutYear}" -> "${r.data.Title}" (${r.data.Year}) ${r.data.imdbID}`);
            return { found: true, data: r.data, method: 't-simple' };
        }
    } catch (err) {
        console.log(`[IMDB-SIMPLE][ERROR-T] ${err.message}`);
    }
    
    // 2) Zkus s= search fallback
    const sParams = `s=${encodeURIComponent(titleWithoutYear)}&type=${typeHint}`;
    try {
        const r2 = await omdbGet(sParams);
        if (r2.data?.Response === 'True' && Array.isArray(r2.data.Search)) {
            const searchResults = r2.data.Search.slice(0, 8);
            
            // Najdi nejlepší shodu podle skóre
            let best = null;
            let bestScore = -1;
            
            for (const sr of searchResults) {
                let score = 0;
                score += tokenOverlapScore(titleWithoutYear, sr.Title) * 2;
                if (year && sr.Year && String(sr.Year).includes(String(year))) score += 5;
                if (typeHint && sr.Type === typeHint) score += 1;
                if (score > bestScore) { bestScore = score; best = sr; }
            }
            
            if (best?.imdbID && bestScore >= 2) { // Minimální skóre pro přijetí
                const r3 = await omdbGet(`i=${encodeURIComponent(best.imdbID)}&plot=short`);
                if (r3.data?.Response === 'True') {
                    console.log(`[IMDB-SIMPLE][HIT-S] "${titleWithoutYear}" -> "${r3.data.Title}" (${r3.data.Year}) ${r3.data.imdbID} score=${bestScore}`);
                    return { found: true, data: r3.data, method: 's-simple' };
                }
            }
        }
    } catch {}
    
    // 3) IMDb Suggest API jako poslední možnost
    const sugg = await imdbSuggest(titleWithoutYear);
    if (sugg.length) {
        let best = null, bestScore = -1;
        
        for (const it of sugg.slice(0, 8)) {
            if (!it?.id?.startsWith('tt')) continue;
            const title = it.l || '';
            const y = it.y ? String(it.y) : '';
            
            let score = tokenOverlapScore(titleWithoutYear, title) * 3;
            if (year && y && y.includes(String(year))) score += 8;
            if (typeHint === 'movie' && it.q === 'feature') score += 1;
            
            if (score > bestScore) { bestScore = score; best = it; }
        }
        
        if (best?.id && bestScore >= 3) { // Minimální skóre pro přijetí
            const r4 = await omdbGet(`i=${encodeURIComponent(best.id)}&plot=short`);
            if (r4.data?.Response === 'True') {
                console.log(`[IMDB-SIMPLE][HIT-SUGGEST] "${titleWithoutYear}" -> "${r4.data.Title}" (${r4.data.Year}) ${r4.data.imdbID} score=${bestScore}`);
                return { found: true, data: r4.data, method: 'suggest-simple' };
            }
        }
    }
    
    console.log(`[IMDB-SIMPLE][NOTFOUND] "${cleanQuery}"`);
    return { found: false };
}

async function resolveImdb(rawTitle, yearHint = null, typeHint = null) {
    // Build candidates with new pipeline
    const { parsed, candidates } = buildOmdbCandidates(rawTitle);
    
    // Check for alias match
    let aliased = null;
    for (const a of TITLE_ALIASES) {
        if (a.match.test(rawTitle)) {
            aliased = a;
            // Add alias as first candidate
            candidates.unshift({ title: a.title, year: parsed.year });
            if (!typeHint) typeHint = a.type;
            break;
        }
    }
    
    // Determine type
    const finalType = typeHint || (parsed.isEpisode ? 'series' : 'movie');
    
    // Log parsing
    console.log(
        `[IMDB][PARSE] raw="${parsed.original}" | clean="${parsed.clean}" | year=${parsed.year || 'none'} | ep=${parsed.isEpisode ? `S${parsed.season}E${parsed.episode}` : 'none'}`
    );
    console.log(`[IMDB][TRY] ${candidates.map(c => `"${c.title}"${c.year ? `(${c.year})` : ''}`).join(' -> ')}`);
    
    // Try each candidate with t= (exact match)
    for (const c of candidates) {
        const params = `t=${encodeURIComponent(c.title)}${c.year ? `&y=${c.year}` : ''}&type=${finalType}`;
        try {
            const r = await omdbGet(params);
            const d = r.data;
            
            if (d?.Response === 'True') {
                console.log(`[IMDB][HIT] using="${c.title}"${c.year ? `(${c.year})` : ''} -> "${d.Title}" (${d.Year}) ${d.imdbID}`);
                return {
                    found: true,
                    method: 't',
                    queryTitle: c.title,
                    year: c.year,
                    type: finalType,
                    data: d,
                    ep: parsed.isEpisode ? { season: parsed.season, episode: parsed.episode } : null,
                    alias: aliased?.title || null
                };
            } else {
                console.log(`[IMDB][MISS] using="${c.title}"${c.year ? `(${c.year})` : ''} err="${d?.Error || 'unknown'}"`);
            }
        } catch (err) {
            console.log(`[IMDB][ERROR] candidate="${c.title}" | ${err.message}`);
        }
    }
    
    // Last resort: search fallback with best candidate
    const bestCandidate = candidates[0];
    if (bestCandidate) {
        const sParams = `s=${encodeURIComponent(bestCandidate.title)}&type=${finalType}`;
        try {
            const r2 = await omdbGet(sParams);
            if (r2.data?.Response === 'True' && Array.isArray(r2.data.Search)) {
                const searchResults = r2.data.Search.slice(0, 8);
                
                let best = null;
                let bestScore = -1;
                
                for (const sr of searchResults) {
                    let score = 0;
                    score += tokenOverlapScore(bestCandidate.title, sr.Title) * 2;
                    if (bestCandidate.year && sr.Year && String(sr.Year).includes(String(bestCandidate.year))) score += 5;
                    if (finalType && sr.Type === finalType) score += 1;
                    if (score > bestScore) { bestScore = score; best = sr; }
                }
                
                if (best?.imdbID) {
                    const r3 = await omdbGet(`i=${encodeURIComponent(best.imdbID)}&plot=short`);
                    if (r3.data?.Response === 'True') {
                        console.log(`[IMDB][SEARCH-HIT] best="${best.Title}" (${best.Year}) score=${bestScore}`);
                        return {
                            found: true,
                            method: 's->i',
                            queryTitle: bestCandidate.title,
                            year: bestCandidate.year,
                            type: finalType,
                            data: r3.data,
                            ep: parsed.isEpisode ? { season: parsed.season, episode: parsed.episode } : null,
                            alias: aliased?.title || null,
                            pickedFromSearch: { bestScore, best, candidates: searchResults.map(c => `${c.Title} (${c.Year}) ${c.imdbID}`) }
                        };
                    }
                }
            }
        } catch {}
    }
    
    // === IMDb Suggest fallback (alternativní/lokalizované názvy) ===
    const suggestQuery = parsed.clean || parsed.original;
    const sugg = await imdbSuggest(suggestQuery);
    
    if (sugg.length) {
        // vyber nejlepšího kandidáta
        let best = null, bestScore = -1;
        
        for (const it of sugg.slice(0, 12)) {
            if (!it?.id?.startsWith('tt')) continue;
            const title = it.l || '';
            const y = it.y ? String(it.y) : '';
            
            let score = tokenOverlapScore(suggestQuery, title) * 3;
            if (parsed.year && y && y.includes(String(parsed.year))) score += 8;
            if (finalType && it.q === 'feature' && finalType === 'movie') score += 1;
            
            if (score > bestScore) { bestScore = score; best = it; }
        }
        
        if (best?.id) {
            console.log(`[IMDB][SUGGEST] query="${suggestQuery}" -> pick="${best.l}" (${best.y || 'N/A'}) ${best.id} score=${bestScore}`);
            const r4 = await omdbGet(`i=${encodeURIComponent(best.id)}&plot=short`);
            if (r4.data?.Response === 'True') {
                console.log(`[IMDB][SUGGEST-HIT] ${best.id} -> "${r4.data.Title}" (${r4.data.Year})`);
                return {
                    found: true,
                    method: 'imdb-suggest->i',
                    queryTitle: suggestQuery,
                    year: parsed.year,
                    type: finalType,
                    data: r4.data,
                    ep: parsed.isEpisode ? { season: parsed.season, episode: parsed.episode } : null,
                    alias: aliased?.title || null
                };
            }
        }
    }
    
    console.log(`[IMDB][NOTFOUND] raw="${parsed.original}"`);
    return {
        found: false,
        method: 'none',
        queryTitle: parsed.clean,
        year: parsed.year,
        type: finalType,
        ep: parsed.isEpisode ? { season: parsed.season, episode: parsed.episode } : null,
        alias: aliased?.title || null
    };
}

function extractYear(raw) {
    const m = String(raw).match(/\b(19\d{2}|20\d{2})\b/);
    return m ? m[1] : null;
}

function removeEmptyDirsUp(startDir, stopAtDir) {
  if (!startDir || !stopAtDir) return;

  const stop = path.resolve(stopAtDir);
  let cur = path.resolve(startDir);

  while (cur.startsWith(stop)) {
    if (cur === stop) break;

    try {
      if (!fs.existsSync(cur)) break;

      const entries = fs.readdirSync(cur);
      if (entries.length > 0) break;      // není prázdná -> končíme

      fs.rmdirSync(cur);                  // smaž jen prázdnou
      cur = path.dirname(cur);            // jdi o level výš
    } catch {
      break;
    }
  }
}

// Helper function to generate Jellyfin-compatible filename
function generateJellyfinFilename(title, imdbData, type = 'movie', season = null, episode = null) {
    // Použij název z IMDB pokud je k dispozici, jinak z původního titulu
    const rawTitle = imdbData?.Title || title || 'Unknown';
    // Clean title (remove invalid filename characters)
    const cleanTitle = rawTitle.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
    
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
    // Použij název z IMDB pokud je k dispozici, jinak z původního titulu
    const rawTitle = imdbData?.Title || title || 'Unknown';
    const cleanTitle = rawTitle.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
    
    if (type === 'movie') {
        // Filmy se ukládají přímo do movies/ bez podsložky
        return path.join(baseDir, 'movies');
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
            job.downloadDir = downloadDir; // aby to cancel endpoint vždycky znal
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

            // Pro seriály vytvoř metadata NFO soubor
            let metadataFilename = null;
            if (type === 'series') {
                metadataFilename = `${baseFilename}.nfo`;
                const metadataPath = path.join(downloadDir, metadataFilename);

                const metadata = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<tvshow>
  <title>${escapeXml(imdbData?.Title || title)}</title>
  <year>${imdbData?.Year || ''}</year>
  <plot><![CDATA[${imdbData?.Plot || ''}]]></plot>
  <genre>${imdbData?.Genre || ''}</genre>
  <uniqueid type="imdb" default="true">${imdbData?.imdbID || ''}</uniqueid>
  <id>${imdbData?.imdbID || ''}</id>
  <imdbid>${imdbData?.imdbID || ''}</imdbid>
  <rating>${imdbData?.imdbRating || ''}</rating>
</tvshow>`;

                fs.writeFileSync(metadataPath, metadata, 'utf8');
                job.createdFiles.push(metadataPath);
            }
            // Pro filmy se NFO nevytváří - Jellyfin používá [imdbid-xxx] v názvu souboru

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
                // smaž prázdnou složku (soubory už endpoint cancel zkusil mazat)
                const baseDir = JELLYFIN_DIR || DOWNLOADS_DIR;
                removeEmptyDirsUp(job.downloadDir, baseDir);

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

    // ✅ smaž prázdnou složku (a prázdné rodiče)
    const baseDir = JELLYFIN_DIR || DOWNLOADS_DIR;
    removeEmptyDirsUp(job.downloadDir, baseDir);

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