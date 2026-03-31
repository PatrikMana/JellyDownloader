/**
 * Application Configuration
 * Centralized configuration management
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(ROOT_DIR, 'config');
const ENV_PATH = path.join(CONFIG_DIR, '.env');
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(ROOT_DIR, 'downloads');

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const config = {
    // Server
    port: parseInt(process.env.PORT, 10) || 6565,
    
    // API Keys
    omdbApiKey: process.env.OMDB_API_KEY || null,
    tmdbApiKey: process.env.TMDB_API_KEY || null,
    
    // Directories
    rootDir: ROOT_DIR,
    configDir: CONFIG_DIR,
    downloadsDir: DOWNLOADS_DIR,
    publicDir: path.join(ROOT_DIR, 'public-react'),
    envPath: ENV_PATH,
    
    // Feature flags
    hasOmdbKey: () => config.omdbApiKey && config.omdbApiKey !== 'your-api-key-here',
    hasTmdbKey: () => !!config.tmdbApiKey,
    
    // Get download paths (re-reads .env for latest values)
    getDownloadPaths: () => {
        let env = {};
        if (fs.existsSync(ENV_PATH)) {
            const content = fs.readFileSync(ENV_PATH, 'utf8');
            content.split('\n').forEach(line => {
                const match = line.match(/^([^=]+)=(.*)$/);
                if (match) {
                    env[match[1].trim()] = match[2].trim();
                }
            });
        }
        
        return {
            movies: env.MOVIES_DIR || env.JELLYFIN_DIR || path.join(DOWNLOADS_DIR, 'movies'),
            series: env.SERIES_DIR || env.JELLYFIN_DIR || path.join(DOWNLOADS_DIR, 'tvshows'),
            anime: env.ANIME_DIR || env.SERIES_DIR || env.JELLYFIN_DIR || path.join(DOWNLOADS_DIR, 'anime')
        };
    },
    
    // HTTP settings
    axios: {
        timeout: 10000,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
};

module.exports = config;
