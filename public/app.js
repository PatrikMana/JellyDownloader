/**
 * PREHRAJTO DOWNLOADER - MAIN APPLICATION
 * Futuristic download manager for Jellyfin media server
 */

// ===============================================
// GLOBAL VARIABLES
// ===============================================

let currentMode = 'movie';
let currentLanguage = 'cz';
let searchResults = [];
let selectedItems = [];
let downloadQueue = [];

// API Configuration
const API_CONFIG = {
    imdb: 'https://www.omdbapi.com/?apikey=YOUR_API_KEY',
    titulky: 'https://titulky.com',
    prehrajto: '/api'
};

// ===============================================
// UTILITY FUNCTIONS
// ===============================================

/**
 * Show toast notification
 */
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.5rem;">
            <i class="fas fa-${getToastIcon(type)}"></i>
            <span>${message}</span>
        </div>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease-out forwards';
        setTimeout(() => container.removeChild(toast), 300);
    }, duration);
}

function getToastIcon(type) {
    const icons = {
        success: 'check-circle',
        error: 'exclamation-circle',
        warning: 'exclamation-triangle',
        info: 'info-circle'
    };
    return icons[type] || 'info-circle';
}

function formatBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B','KB','MB','GB','TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatSeconds(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '—';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
}

function ensureHud() {
    let hud = document.getElementById('download-hud');
    if (!hud) {
        hud = document.createElement('div');
        hud.id = 'download-hud';
        hud.className = 'download-hud';
        document.body.appendChild(hud);
    }
    return hud;
}

function createHudCard(jobId, title) {
    const hud = ensureHud();

    const card = document.createElement('div');
    card.className = 'download-hud-card';
    card.dataset.jobId = jobId;

    card.innerHTML = `
      <div class="download-hud-top">
        <div style="min-width: 0;">
          <div class="download-hud-title">${escapeHtml(title || 'Stahování')}</div>
          <div class="download-hud-sub" data-sub>Inicializuji…</div>
        </div>
        <div class="download-hud-actions">
          <button class="download-hud-iconbtn" data-close title="Skrýt">
            <i class="fas fa-xmark"></i>
          </button>
        </div>
      </div>

      <div class="download-hud-bar">
        <div class="download-hud-fill" data-fill></div>
      </div>

      <div class="download-hud-meta">
        <div><span class="download-hud-status" data-status>ČEKÁM</span></div>
        <div data-meta>0% • 0 B/s • ETA —</div>
      </div>
    `;

    card.querySelector('[data-close]').addEventListener('click', () => {
        card.remove();
    });

    hud.prepend(card);
    return card;
}

function updateHudCard(jobId, patch) {
    const card = document.querySelector(`.download-hud-card[data-job-id="${jobId}"]`);
    if (!card) return;

    const fill = card.querySelector('[data-fill]');
    const sub = card.querySelector('[data-sub]');
    const statusEl = card.querySelector('[data-status]');
    const meta = card.querySelector('[data-meta]');

    if (typeof patch.progress === 'number') {
        fill.style.width = `${Math.max(0, Math.min(100, patch.progress))}%`;
    }
    if (patch.subText) sub.textContent = patch.subText;

    if (patch.statusText) {
        statusEl.textContent = patch.statusText;
        statusEl.classList.toggle('ok', patch.statusKind === 'ok');
        statusEl.classList.toggle('err', patch.statusKind === 'err');
    }

    if (patch.metaText) meta.textContent = patch.metaText;
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Parse file size from string
 */
function parseFileSize(movie) {
    let text;
    if (typeof movie === 'object' && movie.size) {
        text = movie.size;
    } else if (typeof movie === 'object' && movie.title) {
        text = movie.title;
    } else {
        text = movie;
    }
    
    if (!text) return null;
    
    const patterns = [
        /(\d+(?:[.,]\d+)?)\s*(gb|mb|kb|g|m|k)\b/i,
        /(\d+(?:[.,]\d+)?)(gb|mb|kb|g|m|k)/i,
        /\[(\d+(?:[.,]\d+)?)\s*(gb|mb|kb|g|m|k)\]/i,
        /\((\d+(?:[.,]\d+)?)\s*(gb|mb|kb|g|m|k)\)/i
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const value = parseFloat(match[1].replace(',', '.'));
            const unit = match[2].toLowerCase();
            switch(unit) {
                case 'gb':
                case 'g':
                    return value * 1024;
                case 'mb':
                case 'm':
                    return value;
                case 'kb':
                case 'k':
                    return value / 1024;
            }
        }
    }
    return null;
}

/**
 * Sort results by size
 */
function sortResults(results, sortType) {
    if (!results || results.length === 0) return results;
    
    const sortedResults = [...results];
    
    switch (sortType) {
        case 'largest':
            return sortedResults.sort((a, b) => {
                const sizeA = parseFileSize(a) || 0;
                const sizeB = parseFileSize(b) || 0;
                return sizeB - sizeA;
            });
            
        case 'smallest':
            return sortedResults.sort((a, b) => {
                const sizeA = parseFileSize(a) || 0;
                const sizeB = parseFileSize(b) || 0;
                return sizeA - sizeB;
            });
            
        case 'middle':
            const sizes = results
                .map(movie => parseFileSize(movie))
                .filter(size => size !== null && size > 0)
                .sort((a, b) => a - b);
                
            if (sizes.length === 0) return sortedResults;
            
            const avgSize = (sizes[0] + sizes[sizes.length - 1]) / 2;
            
            return sortedResults.sort((a, b) => {
                const sizeA = parseFileSize(a) || 0;
                const sizeB = parseFileSize(b) || 0;
                const distA = Math.abs(sizeA - avgSize);
                const distB = Math.abs(sizeB - avgSize);
                return distA - distB;
            });
            
        default: // smart
            return sortedResults.sort((a, b) => {
                // Calculate quality score
                let scoreA = 0, scoreB = 0;
                
                // Size score (1-8GB is optimal)
                const sizeA = parseFileSize(a) || 0;
                const sizeB = parseFileSize(b) || 0;
                
                if (sizeA >= 1024 && sizeA <= 8192) scoreA += 3;
                if (sizeB >= 1024 && sizeB <= 8192) scoreB += 3;
                
                // Quality score
                const qualityPatterns = {
                    '4k': { pattern: /4k|2160p|uhd/i, score: 5 },
                    '1080p': { pattern: /1080p|full.*hd|fhd/i, score: 4 },
                    '720p': { pattern: /720p|hd(?!.*1080)/i, score: 3 },
                    '480p': { pattern: /480p|sd|dvd/i, score: 2 }
                };
                
                for (const quality of Object.values(qualityPatterns)) {
                    if (quality.pattern.test(a.title)) scoreA += quality.score;
                    if (quality.pattern.test(b.title)) scoreB += quality.score;
                }
                
                // Language score
                const langPatterns = {
                    czech: /(?:cz|czech|čeština|cesky|české)/i,
                    slovak: /(?:sk|slovak|slovenčina|slovensky|slovenské)/i
                };
                
                if (langPatterns.czech.test(a.title) || langPatterns.slovak.test(a.title)) scoreA += 2;
                if (langPatterns.czech.test(b.title) || langPatterns.slovak.test(b.title)) scoreB += 2;
                
                return scoreB - scoreA;
            });
    }
}

/**
 * Filter results by language
 */
function filterByLanguage(results, language) {
    if (!results || results.length === 0) return results;
    
    console.log(`🎯 Filtering ${results.length} results for language: ${language}`);
    
    if (language === 'cz') {
        // Czech - prefer Czech dubbing, include unclear cases
        return results.filter(movie => {
            const title = movie.title.toLowerCase();
            
            // Exclude clear English with subtitles (we want dubbing for CZ)
            if (/(?:eng|english)/.test(title) && /(?:titulky|sub)/.test(title)) return false;
            if (/\b(?:original)/.test(title) && /(?:titulky|sub)/.test(title)) return false;
            
            // Include everything else (most content on prehrajto is Czech or has Czech audio)
            return true;
        });
    } else if (language === 'en') {
        // English - STRICT: Only content explicitly marked as EN or with subtitles
        const filtered = results.filter(movie => {
            const title = movie.title.toLowerCase();
            
            // STRICT EXCLUDE - Any Czech/Slovak indicators
            if (/(?:cz|czech|český|české|cesky|čeština|sk|slovak|sloven)/.test(title)) {
                console.log(`  ❌ Excluded (CZ/SK markers): ${movie.title}`);
                return false;
            }
            
            // STRICT EXCLUDE - Czech dubbing
            if (/(?:dabing|dab\b|dabovaný|dabováno)/.test(title)) {
                console.log(`  ❌ Excluded (Dubbing): ${movie.title}`);
                return false;
            }
            
            // INCLUDE - Explicit English markers
            if (/\b(?:eng|english)\b/.test(title)) {
                console.log(`  ✅ Included (English): ${movie.title}`);
                return true;
            }
            
            // INCLUDE - Original content
            if (/\b(?:original|orig)\b/.test(title)) {
                console.log(`  ✅ Included (Original): ${movie.title}`);
                return true;
            }
            
            // INCLUDE - Content with subtitles (but no CZ markers)
            if (/(?:titulky|tit\b|sub|subs|subtitle)\b/.test(title)) {
                console.log(`  ✅ Included (Subtitles): ${movie.title}`);
                return true;
            }
            
            // EXCLUDE everything else (be strict)
            console.log(`  ❌ Excluded (No EN markers): ${movie.title}`);
            return false;
        });
        
        console.log(`🌍 EN Filter: ${results.length} → ${filtered.length} results`);
        return filtered;
    }
    
    return results;
}

// ===============================================
// SERIES WORKFLOW FUNCTIONS
// ===============================================

/**
 * Search for series on IMDB
 */
async function searchIMDBSeries(query) {
    try {
        console.log('🔍 Searching IMDB for series:', query);
        console.log('🌐 Making request to:', `${API_CONFIG.prehrajto}/imdb/series/search/${encodeURIComponent(query)}`);
        
        const response = await fetch(`${API_CONFIG.prehrajto}/imdb/series/search/${encodeURIComponent(query)}`);
        
        console.log('📨 Response status:', response.status, response.statusText);
        
        const data = await response.json();
        console.log('📊 Response data:', data);
        
        if (!response.ok) {
            console.error('❌ Response not OK:', response.status, data);
            throw new Error(data.error || 'IMDB search chyba');
        }
        
        if (data.success) {
            console.log(`✅ Found ${data.results.length} series on IMDB:`, data.results);
            return data.results;
        } else {
            console.log('❌ No results in response:', data);
            throw new Error(data.error || 'Žádné seriály nebyly nalezeny');
        }
    } catch (error) {
        console.error('❌ IMDB series search error:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            query: query,
            apiConfig: API_CONFIG
        });
        showToast(`Chyba při vyhledávání seriálů: ${error.message}`, 'error');
        return [];
    }
}

/**
 * Get series details from IMDB
 */
async function getSeriesDetails(imdbId) {
    try {
        console.log('📺 Getting series details for:', imdbId);
        const response = await fetch(`${API_CONFIG.prehrajto}/imdb/series/${imdbId}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Series details chyba');
        }
        
        if (data.success) {
            console.log('✅ Series details retrieved:', data.data.Title);
            return data.data;
        } else {
            throw new Error(data.error || 'Detaily seriálu nebyly nalezeny');
        }
    } catch (error) {
        console.error('Series details error:', error);
        showToast(`Chyba při získávání detailů seriálu: ${error.message}`, 'error');
        return null;
    }
}

/**
 * Search for episodes on prehrajto.cz
 */
async function searchSeriesEpisodes(seriesTitle, season, episode) {
    const searchQueries = [
        `${seriesTitle} S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`,
        `${seriesTitle} s${season}e${episode}`,
        `${seriesTitle} ${season}x${episode}`,
        `${seriesTitle} season ${season} episode ${episode}`
    ];
    
    for (const query of searchQueries) {
        try {
            console.log(`🔍 Searching episodes: ${query}`);
            const results = await searchPrehrajto(query);
            
            if (results.length > 0) {
                // Filter results that look like the specific episode
                const filteredResults = results.filter(result => {
                    const title = result.title.toLowerCase();
                    return (
                        title.includes(`s${season.toString().padStart(2, '0')}e${episode.toString().padStart(2, '0')}`) ||
                        title.includes(`s${season}e${episode}`) ||
                        title.includes(`${season}x${episode}`)
                    );
                });
                
                if (filteredResults.length > 0) {
                    return filteredResults;
                }
            }
        } catch (error) {
            console.error(`Episode search failed for query: ${query}`, error);
        }
    }
    
    return [];
}

/**
 * Display IMDB series search results
 */
function displaySeriesSearchResults(results) {
    const container = document.getElementById('series-selection');
    const infoContainer = document.getElementById('series-info');
    
    if (!results || results.length === 0) {
        infoContainer.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <i class="fas fa-search" style="font-size: 3rem; color: var(--color-text-muted); margin-bottom: 1rem;"></i>
                <h3 style="color: var(--color-text-secondary);">ŽÁDNÉ SERIÁLY NALEZENY</h3>
                <p style="color: var(--color-text-muted);">Zkuste jiný název seriálu</p>
            </div>
        `;
        container.style.display = 'block';
        return;
    }
    
    infoContainer.innerHTML = results.map(series => `
        <div class="series-card" onclick="selectSeries('${series.imdbID}', '${escapeHtml(series.Title)}')">
            <div class="series-poster">
                ${series.Poster && series.Poster !== 'N/A' ? 
                    `<img src="${series.Poster}" alt="${escapeHtml(series.Title)}">` :
                    `<i class="fas fa-tv" style="font-size: 3rem; color: var(--color-text-muted);"></i>`
                }
            </div>
            <div class="series-info">
                <h3>${escapeHtml(series.Title)}</h3>
                <p>IMDB ID: ${series.imdbID}</p>
                <p>Rok: ${series.Year}</p>
                <button class="btn btn-primary">VYBRAT SERIÁL</button>
            </div>
        </div>
    `).join('');
    
    container.style.display = 'block';
}

/**
 * Select a series and show seasons
 */
async function selectSeries(imdbId, seriesTitle) {
    try {
        showToast('Načítám sezóny...', 'info');
        
        const seriesData = await getSeriesDetails(imdbId);
        if (!seriesData) return;
        
        // Store selected series data
        window.selectedSeries = {
            imdbId: imdbId,
            title: seriesTitle,
            data: seriesData
        };
        
        displaySeasons(seriesData);
        
    } catch (error) {
        console.error('Error selecting series:', error);
        showToast('Chyba při načítání sezón', 'error');
    }
}

/**
 * Display seasons for selection
 */
function displaySeasons(seriesData) {
    const container = document.getElementById('seasons-grid');
    
    if (!seriesData.seasons || seriesData.seasons.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <p style="color: var(--color-text-muted);">Žádné sezóny nenalezeny</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = seriesData.seasons.map(season => `
        <div class="season-card" data-season="${season.season}">
            <div class="season-header">
                <h3>SEZÓNA ${season.season}</h3>
                <p>${season.episodes} epizod (${season.year})</p>
            </div>
            <div class="season-actions">
                <label class="checkbox-label">
                    <input type="checkbox" class="season-checkbox" value="${season.season}">
                    <span>Vybrat sezónu</span>
                </label>
            </div>
        </div>
    `).join('');
    
    // Add continue button
    container.innerHTML += `
        <div style="grid-column: 1 / -1; text-align: center; margin-top: 2rem;">
            <button class="btn btn-primary" onclick="continueWithSelectedSeasons()" style="font-size: 1.2rem; padding: 1rem 2rem;">
                POKRAČOVAT S VYBRANÝMI SEZÓNAMI
            </button>
        </div>
    `;
}

// ===============================================
// API FUNCTIONS
// ===============================================

/**
 * Search movies/series on prehrajto.cz
 */
async function searchPrehrajto(query) {
    try {
        const response = await fetch(`${API_CONFIG.prehrajto}/search/${encodeURIComponent(query)}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Chyba serveru');
        }
        
        if (data.success) {
            console.log(`📊 Raw results (${data.results.length}):`, data.results.slice(0, 3));
            console.log(`🔤 Current language: ${currentLanguage}`);
            
            // Filter results by selected language
            const filteredResults = filterByLanguage(data.results, currentLanguage);
            console.log(`🌍 Filtered ${data.results.length} → ${filteredResults.length} results for language: ${currentLanguage}`);
            
            if (filteredResults.length === 0 && data.results.length > 0) {
                console.warn('⚠️ All results were filtered out! Showing first 5 original titles:');
                data.results.slice(0, 5).forEach((result, i) => {
                    console.log(`  ${i + 1}. "${result.title}"`);
                });
                
                // EMERGENCY FALLBACK - if filtering eliminates everything, return some results
                console.warn('🆘 Emergency fallback: returning unfiltered results');
                showToast(`Jazykové filtrování příliš striktní - zobrazuji všechny výsledky`, 'warning');
                return data.results;
            }
            
            return filteredResults;
        } else {
            throw new Error(data.error || 'Neznámá chyba');
        }
    } catch (error) {
        console.error('Search error:', error);
        showToast(`Chyba při vyhledávání: ${error.message}`, 'error');
        return [];
    }
}

/**
 * Get IMDB information
 */
async function getIMDBInfo(title, year = null) {
    try {
        console.log('🔍 Getting IMDB info for:', title, year);
        
        const yearParam = year ? `/${year}` : '';
        const response = await fetch(`${API_CONFIG.prehrajto}/imdb/${encodeURIComponent(title)}${yearParam}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'IMDB API chyba');
        }
        
        if (data.success) {
            console.log('✅ IMDB data retrieved:', data.data.Title);
            return data.data;
        } else {
            throw new Error(data.error || 'IMDB data nebyly nalezeny');
        }
    } catch (error) {
        console.error('IMDB error:', error);
        showToast(`IMDB chyba: ${error.message}`, 'warning');
        
        // Return basic mock data as fallback
        return {
            imdbID: 'tt' + Math.random().toString().substring(2, 9),
            Title: title,
            Year: year || new Date().getFullYear().toString(),
            Type: currentMode === 'movie' ? 'movie' : 'series'
        };
    }
}

/**
 * Get video URL from prehrajto.cz
 */
async function getVideoUrl(moviePath) {
    try {
        const cleanPath = moviePath.startsWith('/') ? moviePath.substring(1) : moviePath;
        const response = await fetch(`${API_CONFIG.prehrajto}/video/${cleanPath}`);
        const data = await response.json();
        
        if (data.success && data.videoUrl) {
            return data.videoUrl;
        } else {
            throw new Error(data.error || 'Video URL nebylo nalezeno');
        }
    } catch (error) {
        console.error('Video URL error:', error);
        throw error;
    }
}

/**
 * Download subtitles from titulky.com
 */
async function downloadSubtitles(title, year) {
    try {
        console.log('📝 Searching subtitles for:', title, year);
        showToast('Vyhledávám titulky...', 'info');
        
        const yearParam = year ? `/${year}` : '';
        const response = await fetch(`${API_CONFIG.prehrajto}/subtitles/${encodeURIComponent(title)}${yearParam}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Subtitles API chyba');
        }
        
        if (data.success && data.subtitles.length > 0) {
            console.log(`✅ Found ${data.subtitles.length} subtitles`);
            showToast(`Nalezeno ${data.subtitles.length} titulků`, 'success');
            
            // Filter Czech/Slovak subtitles
            const czechSubtitles = data.subtitles.filter(sub => 
                sub.language.toLowerCase().includes('čes') || 
                sub.language.toLowerCase().includes('czech') ||
                sub.language.toLowerCase().includes('sloven')
            );
            
            return czechSubtitles.length > 0 ? czechSubtitles : data.subtitles.slice(0, 2);
        } else {
            showToast('Žádné titulky nebyly nalezeny', 'warning');
            return [];
        }
    } catch (error) {
        console.error('Subtitles error:', error);
        showToast(`Chyba při vyhledávání titulků: ${error.message}`, 'warning');
        return [];
    }
}

/**
 * Generate Jellyfin-compatible filename
 */
function generateJellyfinName(item, imdbInfo) {
    const cleanTitle = (item.title || 'Unknown').replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
    
    if (currentMode === 'movie') {
        // Movies: Movie Title (Year) [imdbid-ttXXXXXXX]
        const year = imdbInfo?.Year || imdbInfo?.year || 'Unknown';
        const imdbId = imdbInfo?.imdbID || 'unknown';
        return `${cleanTitle} (${year}) [imdbid-${imdbId}]`;
    } else {
        // Series: Series Name [imdbid-ttXXXXXXX]
        // For episodes: Series Name/Season XX/Series Name - sXXeYY - Episode Title [imdbid-ttXXXXXXX]
        const imdbId = imdbInfo?.imdbID || 'unknown';
        
        // Try to detect season/episode from title
        const seasonMatch = cleanTitle.match(/(?:season|série|řada)\s*(\d+)/i);
        const episodeMatch = cleanTitle.match(/(?:episode|epizoda|díl)\s*(\d+)/i) || 
                            cleanTitle.match(/s(\d+)e(\d+)/i);
        
        if (seasonMatch && episodeMatch) {
            const season = seasonMatch[1].padStart(2, '0');
            const episode = (episodeMatch[2] || episodeMatch[1]).padStart(2, '0');
            const seriesName = cleanTitle.replace(/(?:season|série|řada|episode|epizoda|díl).*$/i, '').trim();
            return `${seriesName}/Season ${season}/${seriesName} - s${season}e${episode} [imdbid-${imdbId}]`;
        } else {
            return `${cleanTitle} [imdbid-${imdbId}]`;
        }
    }
}

// ===============================================
// UI FUNCTIONS
// ===============================================

/**
 * Switch between movie and series mode
 */
function switchMode(mode) {
    currentMode = mode;
    
    // Update navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.mode === mode);
    });
    
    // Update mode cards
    document.querySelectorAll('.mode-card').forEach(card => {
        card.classList.toggle('active', card.dataset.mode === mode);
    });
    
    // Show/hide sections
    document.getElementById('movie-mode').style.display = mode === 'movie' ? 'block' : 'none';
    document.getElementById('series-mode').style.display = mode === 'series' ? 'block' : 'none';
    
    // Reset results
    clearResults();
}

/**
 * Set language preference
 */
function setLanguage(lang) {
    const previousLanguage = currentLanguage;
    currentLanguage = lang;
    
    // Update language cards for current mode
    const selector = currentMode === 'movie' ? '#movie-mode' : '#series-mode';
    document.querySelectorAll(`${selector} .language-card`).forEach(card => {
        card.classList.toggle('active', card.dataset.lang === lang);
    });
    
    // If language changed and we have search results, refilter them
    if (previousLanguage !== lang && searchResults.length > 0) {
        console.log(`🔄 Language changed from ${previousLanguage} to ${lang}, refiltering results`);
        
        // Get original search query and search again
        const searchInput = currentMode === 'movie' 
            ? document.getElementById('movie-search') 
            : document.getElementById('series-search');
            
        if (searchInput && searchInput.value.trim()) {
            const languageText = lang === 'en' ? 'anglickém' : 'českém';
            showToast(`Přefiltrování výsledků pro ${languageText} jazyk...`, 'info');
            
            // Trigger new search with current language
            setTimeout(async () => {
                const results = await searchPrehrajto(searchInput.value.trim());
                searchResults = results;
                displayResults(results);
                
                if (results.length === 0) {
                    showToast(`Žádné výsledky v ${languageText} jazyce`, 'warning');
                } else {
                    showToast(`${results.length} výsledků v ${languageText} jazyce`, 'success');
                }
            }, 100);
        }
    }
}

/**
 * Clear all results
 */
function clearResults() {
    searchResults = [];
    document.getElementById('movie-results').style.display = 'none';
    document.getElementById('movie-results-grid').innerHTML = '';
    document.getElementById('series-results').style.display = 'none';
    document.getElementById('series-results-grid').innerHTML = '';
}

/**
 * Display search results
 */
function displayResults(results) {
    // Determine which containers to use based on current mode
    const containerId = currentMode === 'movie' ? 'movie-results-grid' : 'series-results-grid';
    const sectionId = currentMode === 'movie' ? 'movie-results' : 'series-results';
    
    const container = document.getElementById(containerId);
    const section = document.getElementById(sectionId);
    
    if (!results || results.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 2rem;">
                <i class="fas fa-search" style="font-size: 3rem; color: var(--color-text-muted); margin-bottom: 1rem;"></i>
                <h3 style="color: var(--color-text-secondary);">ŽÁDNÉ VÝSLEDKY</h3>
                <p style="color: var(--color-text-muted);">Zkuste jiný hledaný výraz</p>
            </div>
        `;
        section.style.display = 'block';
        return;
    }
    
    container.innerHTML = results.map((movie, index) => `
        <div class="result-card" data-href="${escapeHtml(movie.href)}" data-title="${escapeHtml(movie.title)}" data-index="${index}">
            <div class="result-image">
                ${movie.imageSrc ? 
                    `<img src="${movie.imageSrc}" alt="${escapeHtml(movie.title)}" onerror="this.style.display='none'">` :
                    `<i class="fas fa-film" style="font-size: 3rem; color: var(--color-text-muted);"></i>`
                }
            </div>
            <div class="result-content">
                <h4 class="result-title">${escapeHtml(movie.title)}</h4>
                <div class="result-meta">
                    ${getQualityBadge(movie.title)}
                    ${getSizeBadge(movie)}
                    ${getLanguageBadge(movie.title)}
                    ${movie.duration ? `<span class="result-badge">${movie.duration}</span>` : ''}
                </div>
                <div class="result-actions">
                    <button class="btn btn-preview" data-action="preview">
                        <i class="fas fa-play"></i>
                        ZKONTROLOVAT
                    </button>
                    <button class="btn btn-primary btn-download" data-action="download">
                        <i class="fas fa-download"></i>
                        VYBRAT
                    </button>
                </div>
            </div>
        </div>
    `).join('');
    
    // Add event listeners to all buttons
    container.querySelectorAll('.result-card').forEach((card) => {
        const href = card.dataset.href;
        const title = card.dataset.title;
        
        const previewBtn = card.querySelector('.btn-preview');
        const downloadBtn = card.querySelector('.btn-download');
        
        if (previewBtn) {
            previewBtn.addEventListener('click', () => previewVideo(href, title));
        }
        
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => selectForDownload(href, title));
        }
    });
    
    section.style.display = 'block';
}

/**
 * Generate quality badge
 */
function getQualityBadge(title) {
    const patterns = {
        '4K': /4k|2160p|uhd/i,
        '1080p': /1080p|full.*hd|fhd/i,
        '720p': /720p|hd(?!.*1080)/i,
        '480p': /480p|sd|dvd/i
    };
    
    for (const [quality, pattern] of Object.entries(patterns)) {
        if (pattern.test(title)) {
            return `<span class="result-badge" style="border-color: var(--color-glitch-cyan);">${quality}</span>`;
        }
    }
    return '';
}

/**
 * Generate size badge
 */
function getSizeBadge(movie) {
    const sizeInMB = parseFileSize(movie);
    if (!sizeInMB) return '';
    
    const sizeInGB = (sizeInMB / 1024).toFixed(1);
    let borderColor = 'var(--color-border)';
    
    if (sizeInMB >= 1024 && sizeInMB <= 8192) {
        borderColor = 'var(--color-glitch-green)';
    } else if (sizeInMB > 8192) {
        borderColor = 'var(--color-glitch-magenta)';
    }
    
    return `<span class="result-badge" style="border-color: ${borderColor};">${sizeInGB}GB</span>`;
}

/**
 * Generate language badge
 */
function getLanguageBadge(title) {
    const badges = [];
    const patterns = {
        'CZ': /(?:cz|czech|čeština|cesky|české)/i,
        'SK': /(?:sk|slovak|slovenčina|slovensky|slovenské)/i,
        'EN': /(?:en|eng|english|anglický)/i,
        'DAB': /(?:dabing|dabovaný|dub)/i,
        'TIT': /(?:titulky|sub|subs)/i
    };
    
    for (const [lang, pattern] of Object.entries(patterns)) {
        if (pattern.test(title)) {
            badges.push(`<span class="result-badge" style="border-color: var(--color-glitch-green);">${lang}</span>`);
        }
    }
    
    return badges.join('');
}

// ===============================================
// DOWNLOAD FUNCTIONS
// ===============================================

/**
 * Preview video quality
 */
async function previewVideo(moviePath, movieTitle) {
    try {
        const videoUrl = await getVideoUrl(moviePath);
        window.open(videoUrl, '_blank');
        
        showToast(`Video otevřeno: ${movieTitle}`, 'success');
    } catch (error) {
        console.error('Preview error:', error);
        showToast(`Chyba při otevírání videa: ${error.message}`, 'error');
        
        // Fallback - open original page
        const fallbackUrl = `https://prehrajto.cz/${moviePath}`;
        window.open(fallbackUrl, '_blank');
        showToast('Otevřena původní stránka', 'warning');
    }
}

/**
 * Select item for download
 */
async function selectForDownload(moviePath, movieTitle) {
    try {
        // Get IMDB info
        const imdbInfo = await getIMDBInfo(movieTitle);
        
        // Get video URL
        const videoUrl = await getVideoUrl(moviePath);
        
        // Generate filename
        const filename = generateJellyfinName({ title: movieTitle }, imdbInfo);
        
        // Download subtitles if needed
        let subtitles = null;
        if (currentLanguage === 'en' || currentLanguage === 'cz') {
            subtitles = await downloadSubtitles(movieTitle, imdbInfo?.Year || imdbInfo?.year);
        }
        
        // Start download
        await startDownload({
            title: movieTitle,
            url: videoUrl,
            filename: filename,
            imdbInfo: imdbInfo,
            subtitles: subtitles,
            language: currentLanguage
        });
        
        showToast(`Stahování zahájeno: ${movieTitle}`, 'success');
        
    } catch (error) {
        console.error('Download error:', error);
        showToast(`Chyba při stahování: ${error.message}`, 'error');
    }
}

/**
 * Start actual download
 */
async function startDownload(item) {
    try {
        console.log('📥 Starting server-side download:', item);
        
        // Get IMDB data if not already present
        let imdbData = item.imdbInfo;
        if (!imdbData && item.title) {
            try {
                const titleMatch = item.title.match(/(.+?)\s*\((\d{4})\)/);
                const searchTitle = titleMatch ? titleMatch[1] : item.title;
                const year = titleMatch ? titleMatch[2] : null;
                
                const imdbResponse = await fetch(`${API_CONFIG.prehrajto}/imdb/${encodeURIComponent(searchTitle)}${year ? `/${year}` : ''}`);
                const imdbResult = await imdbResponse.json();
                
                if (imdbResult.success) {
                    imdbData = imdbResult.data;
                    console.log('✅ IMDB data retrieved:', imdbData.Title);
                }
            } catch (imdbError) {
                console.warn('⚠️ Could not fetch IMDB data:', imdbError.message);
            }
        }
        
        const downloadData = {
            videoUrl: item.url,
            title: item.title,
            imdbData: item.imdbInfo || null,
            type: currentMode,
            subtitles: item.subtitles || [],
            season: item.season || null,
            episode: item.episode || null
        };

        showToast('Zahajuji stahování...', 'info');

        // 1) Start job (rychlá odpověď s jobId)
        const response = await fetch(`${API_CONFIG.prehrajto}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(downloadData)
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Download API chyba');
        if (!result.success || !result.jobId) throw new Error(result.error || 'Nepodařilo se vytvořit download job');

        const jobId = result.jobId;

        // 2) Widget vpravo dole
        createHudCard(jobId, item.title);
        updateHudCard(jobId, {
            progress: 0,
            subText: 'Navazuji spojení…',
            statusText: 'START',
            statusKind: ''
        });

        // 3) SSE stream (progress)
        const es = new EventSource(`${API_CONFIG.prehrajto}/download/progress/${encodeURIComponent(jobId)}`);

        es.onmessage = (ev) => {
            let data;
            try { data = JSON.parse(ev.data); } catch { return; }

            if (data.type === 'progress') {
                const pct = (data.totalBytes > 0) ? (data.downloadedBytes / data.totalBytes * 100) : data.progress || 0;
                const speed = data.speedBps || 0;
                const eta = data.etaSec;

                updateHudCard(jobId, {
                    progress: pct,
                    subText: `${formatBytes(data.downloadedBytes)} / ${data.totalBytes ? formatBytes(data.totalBytes) : '—'}`,
                    statusText: 'STAHUJU',
                    statusKind: '',
                    metaText: `${Math.round(pct)}% • ${formatBytes(speed)}/s • ETA ${formatSeconds(eta)}`
                });
            }

            if (data.type === 'done') {
                es.close();

                updateHudCard(jobId, {
                    progress: 100,
                    subText: data.files?.video ? `✅ ${data.files.video}` : '✅ Hotovo',
                    statusText: 'HOTOVO',
                    statusKind: 'ok',
                    metaText: `100% • ${data.path || ''}`.trim()
                });

                // zachovej tvoje “detailní” UI pokud chceš:
                showToast('✅ Staženo', 'success', 4000);
                showDownloadComplete({
                    ...item,
                    completed: true,
                    files: data.files,
                    path: data.path,
                    jellyfinReady: data.jellyfinReady,
                    instructions: data.instructions
                });
            }

            if (data.type === 'error') {
                es.close();

                updateHudCard(jobId, {
                    statusText: 'CHYBA',
                    statusKind: 'err',
                    subText: data.error || 'Stahování selhalo',
                    metaText: '—'
                });

                showToast(`Chyba při stahování: ${data.error || 'neznámá chyba'}`, 'error', 6000);
            }
        };

        es.onerror = () => {
            // pokud server zavře spojení bez done/error, necháme kartu a uživateli to řekneme
            updateHudCard(jobId, {
                statusText: 'SPOJENÍ',
                statusKind: 'err',
                subText: 'Ztraceno SSE spojení (server?)',
                metaText: '—'
            });
            try { es.close(); } catch {}
        };

        return jobId;

    } catch (error) {
        console.error('❌ Download error:', error);
        showToast(`Chyba při stahování: ${error.message}`, 'error', 5000);
        throw error;
    }
}

/**
 * Show download progress
 */
function showDownloadProgress(item) {
    const section = document.getElementById('download-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const queueContainer = document.getElementById('download-queue');
    
    section.style.display = 'block';
    
    // Add to queue
    const queueItem = document.createElement('div');
    queueItem.className = 'queue-item';
    queueItem.innerHTML = `
        <div style="padding: 1rem; background: var(--color-bg-tertiary); border: 1px solid var(--color-border); margin-bottom: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h4>${escapeHtml(item.title)}</h4>
                    <p style="color: var(--color-text-secondary); font-size: 0.9rem;">${item.filename}</p>
                </div>
                <div style="text-align: right;">
                    <div class="status">STAHOVÁNÍ...</div>
                </div>
            </div>
        </div>
    `;
    
    queueContainer.appendChild(queueItem);
    
    // Simulate progress
    let progress = 0;
    const interval = setInterval(() => {
        progress += Math.random() * 10;
        if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
            progressText.textContent = 'DOKONČENO';
            queueItem.querySelector('.status').textContent = 'DOKONČENO';
            queueItem.querySelector('.status').style.color = 'var(--color-glitch-green)';
        }
        
        progressFill.style.width = `${progress}%`;
        progressText.textContent = `Stahování... ${Math.round(progress)}%`;
    }, 500);
}

/**
 * Show download complete message
 */
function showDownloadComplete(item) {
    const section = document.getElementById('download-progress');
    const queueContainer = document.getElementById('download-queue');
    
    section.style.display = 'block';
    
    // Add completed item
    const completeItem = document.createElement('div');
    completeItem.className = 'queue-item';
    completeItem.innerHTML = `
        <div style="padding: 1.5rem; background: var(--color-bg-tertiary); border: 2px solid var(--color-glitch-green); margin-bottom: 1rem; border-radius: 8px;">
            <div style="margin-bottom: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h4 style="color: var(--color-glitch-green); margin-bottom: 0.5rem;">
                            <i class="fas fa-check-circle"></i> ${escapeHtml(item.title)}
                        </h4>
                        <p style="color: var(--color-text-secondary); font-size: 0.9rem; margin: 0;">
                            ${item.files ? item.files.video : 'Staženo'}
                        </p>
                    </div>
                </div>
            </div>
            <div style="padding: 1rem; background: rgba(0,255,159,0.05); border-left: 3px solid var(--color-glitch-green); margin-top: 1rem;">
                <p style="margin: 0; font-size: 0.9rem;">
                    <strong>${item.jellyfinReady ? '✅ PŘIPRAVENO PRO JELLYFIN' : '⚠️ VYŽADUJE RUČNÍ PŘESUN'}</strong><br>
                    ${escapeHtml(item.instructions || '')}
                </p>
                ${item.path ? `<p style="margin: 0.5rem 0 0 0; font-size: 0.85rem; color: var(--color-text-secondary);">
                    📁 ${escapeHtml(item.path)}
                </p>` : ''}
            </div>
            ${item.files && item.files.subtitles && item.files.subtitles.length > 0 ? `
                <div style="margin-top: 0.5rem; padding: 0.5rem; background: rgba(255,255,255,0.03);">
                    <small style="color: var(--color-text-secondary);">
                        📝 Titulky: ${item.files.subtitles.join(', ')}
                    </small>
                </div>
            ` : ''}
        </div>
    `;
    
    queueContainer.appendChild(completeItem);
}

// ===============================================
// EVENT LISTENERS
// ===============================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 PREHRAJTO DOWNLOADER LOADED');
    
    // Navigation links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const mode = link.dataset.mode;
            if (mode) switchMode(mode);
        });
    });
    
    // Mode cards
    document.querySelectorAll('.mode-card').forEach(card => {
        card.addEventListener('click', () => {
            const mode = card.dataset.mode;
            if (mode) switchMode(mode);
        });
    });
    
    // Language cards
    document.querySelectorAll('.language-card').forEach(card => {
        card.addEventListener('click', () => {
            const lang = card.dataset.lang;
            if (lang) setLanguage(lang);
        });
    });
    
    // Search functionality - Movies
    const movieSearchBtn = document.getElementById('movie-search-btn');
    const movieSearchInput = document.getElementById('movie-search');
    
    movieSearchBtn?.addEventListener('click', async () => {
        const query = movieSearchInput.value.trim();
        if (!query) {
            showToast('Zadejte název filmu', 'warning');
            return;
        }
        
        const languageText = currentLanguage === 'en' ? 'anglickém' : 'českém';
        showToast(`Vyhledávám filmy v ${languageText} jazyce...`, 'info');
        
        const results = await searchPrehrajto(query);
        searchResults = results;
        displayResults(results);
        
        if (results.length === 0) {
            showToast(`Žádné filmy v ${languageText} jazyce nebyly nalezeny`, 'warning');
        } else {
            showToast(`Nalezeno ${results.length} filmů v ${languageText} jazyce`, 'success');
        }
    });
    
    movieSearchInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            movieSearchBtn?.click();
        }
    });
    
    // Search functionality - Series (IMDB Search)
    const seriesSearchBtn = document.getElementById('series-search-btn');
    const seriesSearchInput = document.getElementById('series-search');
    
    seriesSearchBtn?.addEventListener('click', async () => {
        const query = seriesSearchInput.value.trim();
        if (!query) {
            showToast('Zadejte název seriálu', 'warning');
            return;
        }
        
        showToast('Vyhledávám seriály v IMDB databázi...', 'info');
        
        const results = await searchIMDBSeries(query);
        
        if (results.length === 0) {
            showToast('Žádné seriály nebyly nalezeny v IMDB', 'warning');
            // Hide series selection
            document.getElementById('series-selection').style.display = 'none';
        } else {
            showToast(`Nalezeno ${results.length} seriálů v IMDB`, 'success');
            displaySeriesSearchResults(results);
        }
    });
    
    seriesSearchInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            seriesSearchBtn?.click();
        }
    });
    
    // Sort functionality - Movies
    const movieSort = document.getElementById('movie-sort');
    movieSort?.addEventListener('change', () => {
        if (searchResults.length > 0) {
            const sortedResults = sortResults(searchResults, movieSort.value);
            displayResults(sortedResults);
        }
    });
    
    // Sort functionality - Series
    const seriesSort = document.getElementById('series-sort');
    seriesSort?.addEventListener('change', () => {
        if (searchResults.length > 0) {
            const sortedResults = sortResults(searchResults, seriesSort.value);
            displayResults(sortedResults);
        }
    });
    
    // Initialize
    switchMode('movie');
    setLanguage('cz');
});

// ===============================================
// GLOBAL FUNCTIONS (for onclick handlers)
// ===============================================

/**
 * Continue with selected seasons
 */
async function continueWithSelectedSeasons() {
    const selectedSeasons = [];
    document.querySelectorAll('.season-checkbox:checked').forEach(checkbox => {
        selectedSeasons.push(parseInt(checkbox.value));
    });
    
    if (selectedSeasons.length === 0) {
        showToast('Vyberte alespoň jednu sezónu', 'warning');
        return;
    }
    
    console.log('Selected seasons:', selectedSeasons);
    showToast(`Vyhledávám epizody pro ${selectedSeasons.length} sezón...`, 'info');
    
    // Search for episodes
    await searchAllEpisodes(selectedSeasons);
}

/**
 * Search for all episodes in selected seasons
 */
async function searchAllEpisodes(seasons) {
    const seriesData = window.selectedSeries;
    const episodesContainer = document.getElementById('episodes-container');
    const episodesSection = document.getElementById('episodes-selection');
    
    episodesContainer.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fas fa-spinner fa-spin"></i> Vyhledávám epizody...</div>';
    episodesSection.style.display = 'block';
    
    const allEpisodes = [];
    
    for (const seasonNum of seasons) {
        const seasonData = seriesData.data.seasons.find(s => s.season === seasonNum);
        if (!seasonData) continue;
        
        console.log(`🔍 Searching episodes for season ${seasonNum}`);
        
        const seasonEpisodes = [];
        for (let episode = 1; episode <= seasonData.episodes; episode++) {
            try {
                const episodeResults = await searchSeriesEpisodes(seriesData.title, seasonNum, episode);
                
                if (episodeResults.length > 0) {
                    seasonEpisodes.push({
                        season: seasonNum,
                        episode: episode,
                        results: episodeResults,
                        selected: null // Will store selected result
                    });
                }
            } catch (error) {
                console.error(`Error searching S${seasonNum}E${episode}:`, error);
            }
        }
        
        if (seasonEpisodes.length > 0) {
            allEpisodes.push({
                season: seasonNum,
                episodes: seasonEpisodes
            });
        }
    }
    
    if (allEpisodes.length === 0) {
        episodesContainer.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: var(--color-text-muted); margin-bottom: 1rem;"></i>
                <h3 style="color: var(--color-text-secondary);">ŽÁDNÉ EPIZODY NALEZENY</h3>
                <p style="color: var(--color-text-muted);">Zkuste jiný seriál nebo zkontrolujte název</p>
            </div>
        `;
        return;
    }
    
    // Store episodes data
    window.foundEpisodes = allEpisodes;
    
    // Display episodes
    displayEpisodes(allEpisodes);
    
    showToast(`Nalezeno ${allEpisodes.reduce((total, season) => total + season.episodes.length, 0)} epizod`, 'success');
}

/**
 * Display episodes for selection
 */
function displayEpisodes(allEpisodes) {
    const container = document.getElementById('episodes-container');
    
    let html = '';
    
    allEpisodes.forEach(seasonData => {
        html += `
            <div class="episode-group">
                <h3>SEZÓNA ${seasonData.season} (${seasonData.episodes.length} epizod nalezeno)</h3>
                <div class="episode-results">
        `;
        
        seasonData.episodes.forEach(episodeData => {
            const episodeNum = episodeData.episode.toString().padStart(2, '0');
            
            html += `
                <div class="episode-item">
                    <h4>S${seasonData.season.toString().padStart(2, '0')}E${episodeNum}</h4>
                    <div class="episode-options">
            `;
            
            episodeData.results.forEach((result, index) => {
                html += `
                    <div class="episode-card" onclick="selectEpisode(${seasonData.season}, ${episodeData.episode}, ${index})">
                        <div class="episode-title">${escapeHtml(result.title)}</div>
                        <div class="episode-meta">
                            ${getQualityBadge(result.title)}
                            ${getSizeBadge(result)}
                            ${getLanguageBadge(result.title)}
                        </div>
                        <div class="episode-actions">
                            <button class="btn btn-sm" onclick="event.stopPropagation(); previewVideo('${result.href}', '${escapeHtml(result.title)}')">
                                <i class="fas fa-play"></i> ZKONTROLOVAT
                            </button>
                        </div>
                    </div>
                `;
            });
            
            html += '</div></div>';
        });
        
        html += '</div></div>';
    });
    
    // Add download all button
    html += `
        <div style="text-align: center; margin-top: 2rem; padding-top: 2rem; border-top: 1px solid var(--color-border);">
            <button class="btn btn-primary" onclick="downloadSelectedEpisodes()" style="font-size: 1.2rem; padding: 1rem 2rem;">
                <i class="fas fa-download"></i> STÁHNOUT VYBRANÉ EPIZODY
            </button>
        </div>
    `;
    
    container.innerHTML = html;
}

/**
 * Select episode version
 */
function selectEpisode(season, episode, resultIndex) {
    // Remove previous selection for this episode
    document.querySelectorAll(`[data-episode="s${season}e${episode}"]`).forEach(card => {
        card.classList.remove('selected');
    });
    
    // Add selection to clicked card
    event.currentTarget.classList.add('selected');
    event.currentTarget.dataset.episode = `s${season}e${episode}`;
    
    // Store selection
    const seasonData = window.foundEpisodes.find(s => s.season === season);
    if (seasonData) {
        const episodeData = seasonData.episodes.find(e => e.episode === episode);
        if (episodeData) {
            episodeData.selected = episodeData.results[resultIndex];
            console.log(`Selected episode S${season}E${episode}:`, episodeData.selected.title);
        }
    }
}

/**
 * Download all selected episodes
 */
async function downloadSelectedEpisodes() {
    const selectedEpisodes = [];
    
    // Collect selected episodes
    window.foundEpisodes.forEach(seasonData => {
        seasonData.episodes.forEach(episodeData => {
            if (episodeData.selected) {
                selectedEpisodes.push({
                    season: seasonData.season,
                    episode: episodeData.episode,
                    data: episodeData.selected,
                    seriesInfo: window.selectedSeries
                });
            }
        });
    });
    
    if (selectedEpisodes.length === 0) {
        showToast('Vyberte alespoň jednu epizodu pro stažení', 'warning');
        return;
    }
    
    showToast(`Zahajuji stahování ${selectedEpisodes.length} epizod...`, 'info');
    
    // TODO: Implement bulk download with ZIP creation
    console.log('Selected episodes for download:', selectedEpisodes);
    
    // For now, download episodes one by one
    for (const episode of selectedEpisodes) {
        try {
            await downloadEpisode(episode);
        } catch (error) {
            console.error('Episode download failed:', error);
            showToast(`Chyba při stahování S${episode.season}E${episode.episode}: ${error.message}`, 'error');
        }
    }
    
    showToast('Stahování všech epizod dokončeno!', 'success');
}

/**
 * Download single episode
 */
async function downloadEpisode(episodeInfo) {
    const { season, episode, data, seriesInfo } = episodeInfo;
    
    console.log(`📥 Downloading S${season}E${episode}:`, data.title);
    
    // Get IMDB info for the series
    const imdbInfo = seriesInfo.data;
    
    // Get video URL
    const videoUrl = await getVideoUrl(data.href);
    
    // Download subtitles if needed
    let subtitles = [];
    if (currentLanguage === 'en' || currentLanguage === 'cz') {
        subtitles = await downloadSubtitles(seriesInfo.title, imdbInfo.Year);
    }
    
    // Start download with series naming
    await startDownload({
        title: `${seriesInfo.title} S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`,
        url: videoUrl,
        imdbInfo: imdbInfo,
        subtitles: subtitles,
        language: currentLanguage,
        isEpisode: true,
        season: season,
        episode: episode
    });
}

// ===============================================
// GLOBAL FUNCTIONS (for onclick handlers)
// ===============================================

window.previewVideo = previewVideo;
window.selectForDownload = selectForDownload;
window.selectSeries = selectSeries;
window.continueWithSelectedSeasons = continueWithSelectedSeasons;
window.selectEpisode = selectEpisode;
window.downloadSelectedEpisodes = downloadSelectedEpisodes;