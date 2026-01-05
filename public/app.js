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
let lastSearchQuery = ''; // Uchová poslední hledaný výraz od uživatele

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
    
    if (h > 0) return `${h}h ${m}min`;
    if (m > 0) return `${m}min`;
    return `${s}s`;
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
          <button class="download-hud-iconbtn danger" data-cancel title="Zrušit a smazat">
            <i class="fas fa-trash"></i>
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

    // cancel
    card.querySelector('[data-cancel]').addEventListener('click', async () => {
        try {
            updateHudCard(jobId, {
                statusText: 'RUŠÍM',
                statusKind: 'err',
                subText: 'Odesílám požadavek na zrušení…',
                metaText: '—'
            });

            const r = await fetch(`${API_CONFIG.prehrajto}/download/cancel/${encodeURIComponent(jobId)}`, {
                method: 'POST'
            });

            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j.success) throw new Error(j.error || 'Cancel selhal');

            updateHudCard(jobId, {
                statusText: 'ZRUŠENO',
                statusKind: 'err',
                subText: 'Stahování zrušeno, soubory smazány.',
                metaText: ''
            });

            showToast('Stahování zrušeno', 'warning', 3000);

            // Automaticky smaž widget po 5 sekundách s animací
            setTimeout(() => {
                card.classList.add('removing');
                setTimeout(() => card.remove(), 300); // počkej na animaci
            }, 5000);
        } catch (e) {
            showToast(`Nepodařilo se zrušit: ${e.message}`, 'error', 5000);
        }
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
    if ('subText' in patch) sub.textContent = patch.subText ?? '';

    if (patch.statusText) {
        statusEl.textContent = patch.statusText;
        statusEl.classList.toggle('ok', patch.statusKind === 'ok');
        statusEl.classList.toggle('err', patch.statusKind === 'err');
    }

    if ('metaText' in patch) meta.textContent = patch.metaText ?? '';
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
 * Select a series and show seasons with episodes tree
 */
async function selectSeries(imdbId, seriesTitle) {
    try {
        showToast('Načítám sezóny a díly...', 'info');
        
        // Hide series cards (search results)
        const seriesInfo = document.getElementById('series-info');
        if (seriesInfo) {
            seriesInfo.style.display = 'none';
        }
        
        // Show the series selection section
        const selectionSection = document.getElementById('series-selection');
        if (selectionSection) {
            selectionSection.style.display = 'block';
        }
        
        // Show loading in seasons container
        const container = document.getElementById('seasons-grid');
        container.style.display = 'block';
        container.innerHTML = `
            <div class="series-tree-loading">
                <i class="fas fa-spinner"></i>
                <p>Načítám sezóny a díly z IMDB...</p>
            </div>
        `;
        
        // Scroll to the selection section
        selectionSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        // Fetch all seasons with episodes
        const response = await fetch(`${API_CONFIG.prehrajto}/imdb/series/${imdbId}/seasons`);
        const data = await response.json();
        
        console.log('📺 Seasons API response:', data);
        
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Nepodařilo se načíst sezóny');
        }
        
        // Store selected series data
        window.selectedSeries = {
            imdbId: imdbId,
            title: seriesTitle || data.seriesTitle,
            seasons: data.seasons
        };
        
        console.log('📺 Calling displaySeasonsTree with:', data.seasons.length, 'seasons');
        displaySeasonsTree(data.seasons, seriesTitle || data.seriesTitle);
        showToast(`Načteno ${data.seasons.length} sezón`, 'success');
        
    } catch (error) {
        console.error('Error selecting series:', error);
        showToast('Chyba při načítání sezón: ' + error.message, 'error');
    }
}

/**
 * Display seasons and episodes in tree structure with checkboxes
 */
function displaySeasonsTree(seasons, seriesTitle) {
    console.log('📺 displaySeasonsTree called with:', seasons, seriesTitle);
    
    const container = document.getElementById('seasons-grid');
    console.log('📺 Container found:', container);
    
    if (!container) {
        console.error('❌ Container seasons-grid not found!');
        return;
    }
    
    if (!seasons || seasons.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <p style="color: var(--color-text-muted);">Žádné sezóny nenalezeny</p>
            </div>
        `;
        return;
    }
    
    // Build tree HTML
    let treeHtml = `
        <div class="series-tree">
            <div class="series-tree-header">
                <div class="series-tree-title">${escapeHtml(seriesTitle)}</div>
                <div class="series-tree-actions">
                    <button class="series-tree-btn" onclick="selectAllEpisodes()">
                        <i class="fas fa-check-double"></i> Vybrat vše
                    </button>
                    <button class="series-tree-btn" onclick="deselectAllEpisodes()">
                        <i class="fas fa-times"></i> Zrušit výběr
                    </button>
                </div>
            </div>
            <div class="series-tree-content">
    `;
    
    seasons.forEach(season => {
        const episodeCount = season.episodes ? season.episodes.length : 0;
        
        treeHtml += `
            <div class="season-node" data-season="${season.season}">
                <div class="season-header" onclick="toggleSeason(${season.season})">
                    <i class="fas fa-chevron-right season-toggle" id="toggle-${season.season}"></i>
                    <div class="season-checkbox-wrapper">
                        <input type="checkbox" class="season-checkbox" id="season-cb-${season.season}" 
                               data-season="${season.season}" onchange="toggleSeasonCheckbox(${season.season})"
                               onclick="event.stopPropagation()">
                    </div>
                    <span class="season-label">Série ${season.season.toString().padStart(2, '0')}</span>
                    <span class="season-count">${episodeCount} dílů</span>
                </div>
                <div class="episodes-list" id="episodes-${season.season}">
        `;
        
        if (season.episodes && season.episodes.length > 0) {
            season.episodes.forEach(episode => {
                const epNum = episode.Episode || '?';
                const epTitle = episode.Title || 'Bez názvu';
                const epRating = episode.imdbRating && episode.imdbRating !== 'N/A' ? episode.imdbRating : null;
                
                treeHtml += `
                    <div class="episode-item" data-season="${season.season}" data-episode="${epNum}">
                        <input type="checkbox" class="episode-checkbox" 
                               id="ep-cb-${season.season}-${epNum}"
                               data-season="${season.season}" 
                               data-episode="${epNum}"
                               data-title="${escapeHtml(epTitle)}"
                               onchange="updateSeasonCheckbox(${season.season})">
                        <span class="episode-number">${epNum}</span>
                        <span class="episode-title">${escapeHtml(epTitle)}</span>
                        ${epRating ? `<span class="episode-rating"><i class="fas fa-star"></i> ${epRating}</span>` : ''}
                    </div>
                `;
            });
        } else {
            treeHtml += `
                <div class="episode-item" style="color: var(--color-text-muted); justify-content: center;">
                    Žádné díly nenalezeny
                </div>
            `;
        }
        
        treeHtml += `
                </div>
            </div>
        `;
    });
    
    treeHtml += `
            </div>
        </div>
        
        <div class="selection-summary" id="selection-summary">
            <div class="selection-info">
                <span class="selection-count" id="selected-count">0 dílů vybráno</span>
                <span class="selection-detail" id="selected-detail">Vyberte díly ke stažení</span>
            </div>
            <div class="selection-actions">
                <button class="btn btn-primary" onclick="proceedWithSelectedEpisodes()" id="proceed-btn" disabled>
                    <i class="fas fa-download"></i> POKRAČOVAT KE STAŽENÍ
                </button>
            </div>
        </div>
    `;
    
    console.log('📺 Setting innerHTML, HTML length:', treeHtml.length);
    container.innerHTML = treeHtml;
    console.log('📺 innerHTML set, container children:', container.children.length);
    updateSelectionSummary();
}

/**
 * Toggle season expansion
 */
function toggleSeason(seasonNum) {
    const episodesList = document.getElementById(`episodes-${seasonNum}`);
    const toggleIcon = document.getElementById(`toggle-${seasonNum}`);
    
    if (episodesList.classList.contains('expanded')) {
        episodesList.classList.remove('expanded');
        toggleIcon.classList.remove('expanded');
    } else {
        episodesList.classList.add('expanded');
        toggleIcon.classList.add('expanded');
    }
}

/**
 * Toggle all episodes in a season when season checkbox is clicked
 */
function toggleSeasonCheckbox(seasonNum) {
    const seasonCheckbox = document.getElementById(`season-cb-${seasonNum}`);
    const episodeCheckboxes = document.querySelectorAll(`.episode-checkbox[data-season="${seasonNum}"]`);
    
    episodeCheckboxes.forEach(cb => {
        cb.checked = seasonCheckbox.checked;
    });
    
    // Expand the season if checking
    if (seasonCheckbox.checked) {
        const episodesList = document.getElementById(`episodes-${seasonNum}`);
        const toggleIcon = document.getElementById(`toggle-${seasonNum}`);
        episodesList.classList.add('expanded');
        toggleIcon.classList.add('expanded');
    }
    
    updateSelectionSummary();
}

/**
 * Update season checkbox based on episode selections
 */
function updateSeasonCheckbox(seasonNum) {
    const seasonCheckbox = document.getElementById(`season-cb-${seasonNum}`);
    const episodeCheckboxes = document.querySelectorAll(`.episode-checkbox[data-season="${seasonNum}"]`);
    
    const checkedCount = Array.from(episodeCheckboxes).filter(cb => cb.checked).length;
    const totalCount = episodeCheckboxes.length;
    
    if (checkedCount === 0) {
        seasonCheckbox.checked = false;
        seasonCheckbox.indeterminate = false;
    } else if (checkedCount === totalCount) {
        seasonCheckbox.checked = true;
        seasonCheckbox.indeterminate = false;
    } else {
        seasonCheckbox.checked = false;
        seasonCheckbox.indeterminate = true;
    }
    
    updateSelectionSummary();
}

/**
 * Select all episodes
 */
function selectAllEpisodes() {
    document.querySelectorAll('.episode-checkbox').forEach(cb => cb.checked = true);
    document.querySelectorAll('.season-checkbox').forEach(cb => {
        cb.checked = true;
        cb.indeterminate = false;
    });
    updateSelectionSummary();
}

/**
 * Deselect all episodes
 */
function deselectAllEpisodes() {
    document.querySelectorAll('.episode-checkbox').forEach(cb => cb.checked = false);
    document.querySelectorAll('.season-checkbox').forEach(cb => {
        cb.checked = false;
        cb.indeterminate = false;
    });
    updateSelectionSummary();
}

/**
 * Update selection summary
 */
function updateSelectionSummary() {
    const checkedEpisodes = document.querySelectorAll('.episode-checkbox:checked');
    const count = checkedEpisodes.length;
    
    const countEl = document.getElementById('selected-count');
    const detailEl = document.getElementById('selected-detail');
    const proceedBtn = document.getElementById('proceed-btn');
    
    if (!countEl) return;
    
    countEl.textContent = `${count} ${count === 1 ? 'díl vybrán' : count >= 2 && count <= 4 ? 'díly vybrány' : 'dílů vybráno'}`;
    
    if (count > 0) {
        // Group by seasons
        const seasonCounts = {};
        checkedEpisodes.forEach(cb => {
            const season = cb.dataset.season;
            seasonCounts[season] = (seasonCounts[season] || 0) + 1;
        });
        
        const seasonSummary = Object.entries(seasonCounts)
            .map(([s, c]) => `S${s.padStart(2, '0')}: ${c}`)
            .join(', ');
        
        detailEl.textContent = seasonSummary;
        proceedBtn.disabled = false;
    } else {
        detailEl.textContent = 'Vyberte díly ke stažení';
        proceedBtn.disabled = true;
    }
}

/**
 * Get selected episodes data
 */
function getSelectedEpisodes() {
    const selected = [];
    document.querySelectorAll('.episode-checkbox:checked').forEach(cb => {
        selected.push({
            season: parseInt(cb.dataset.season),
            episode: parseInt(cb.dataset.episode),
            title: cb.dataset.title || ''
        });
    });
    
    // Sort by season, then episode
    selected.sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season;
        return a.episode - b.episode;
    });
    
    return selected;
}

/**
 * Proceed with selected episodes - start episode selection workflow
 */
async function proceedWithSelectedEpisodes() {
    const selected = getSelectedEpisodes();
    
    if (selected.length === 0) {
        showToast('Vyberte alespoň jeden díl', 'warning');
        return;
    }
    
    console.log('📺 Selected episodes:', selected);
    console.log('📺 Series info:', window.selectedSeries);
    
    // First, try to get Czech title
    showToast('Načítám český název seriálu...', 'info');
    
    let czechTitle = window.selectedSeries.title; // Default to original
    let originalTitle = window.selectedSeries.title;
    
    try {
        const response = await fetch(`${API_CONFIG.prehrajto}/tmdb/czech-title/${window.selectedSeries.imdbId}`);
        const data = await response.json();
        
        if (data.success && data.czechTitle) {
            czechTitle = data.czechTitle;
            originalTitle = data.originalTitle || window.selectedSeries.title;
            console.log(`✅ Got Czech title: "${czechTitle}" (original: "${originalTitle}")`);
        }
    } catch (e) {
        console.warn('Could not fetch Czech title:', e);
    }
    
    // Show dialog to confirm/edit search title
    const searchTitle = await showSearchTitleDialog(originalTitle, czechTitle);
    
    if (!searchTitle) {
        showToast('Vyhledávání zrušeno', 'info');
        return;
    }
    
    // Initialize series download state
    window.seriesDownload = {
        series: window.selectedSeries,
        searchTitle: searchTitle, // Title to use for prehrajto search
        episodes: selected,
        currentIndex: 0,
        selectedEpisodes: [], // Will store { episode, prehrajtoResult, selectedQualityUrl }
        totalEpisodes: selected.length
    };
    
    // Show episode selection section
    showEpisodeSelectionUI();
    
    // Start with first episode
    await searchNextEpisode();
}

/**
 * Show dialog to confirm/edit search title for prehrajto
 */
function showSearchTitleDialog(originalTitle, czechTitle) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'quality-modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'quality-modal search-title-modal';
        
        modal.innerHTML = `
            <div class="quality-modal-header">
                <h2><i class="fas fa-search"></i> NÁZEV PRO VYHLEDÁVÁNÍ</h2>
                <button class="quality-modal-close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="quality-modal-body">
                <p class="search-title-info">
                    Zadejte název seriálu, pod kterým se bude vyhledávat na prehrajto.cz
                </p>
                
                <div class="search-title-original">
                    <label>Originální název:</label>
                    <span>${escapeHtml(originalTitle)}</span>
                </div>
                
                ${czechTitle !== originalTitle ? `
                <div class="search-title-czech">
                    <label>Český název (TMDB):</label>
                    <span>${escapeHtml(czechTitle)}</span>
                </div>
                ` : ''}
                
                <div class="search-title-input-group">
                    <label for="search-title-input">Název pro vyhledávání:</label>
                    <input type="text" id="search-title-input" class="search-input" 
                           value="${escapeHtml(czechTitle)}" 
                           placeholder="Zadejte název...">
                </div>
                
                <div class="search-title-suggestions">
                    <label>Rychlý výběr:</label>
                    <div class="search-title-buttons">
                        ${czechTitle !== originalTitle ? `
                        <button class="btn btn-secondary" onclick="document.getElementById('search-title-input').value='${escapeHtml(czechTitle)}'">
                            ${escapeHtml(czechTitle)}
                        </button>
                        ` : ''}
                        <button class="btn btn-secondary" onclick="document.getElementById('search-title-input').value='${escapeHtml(originalTitle)}'">
                            ${escapeHtml(originalTitle)}
                        </button>
                    </div>
                </div>
                
                <div class="search-title-actions">
                    <button class="btn btn-secondary" id="cancel-search-title">
                        <i class="fas fa-times"></i> ZRUŠIT
                    </button>
                    <button class="btn btn-primary" id="confirm-search-title">
                        <i class="fas fa-check"></i> POKRAČOVAT
                    </button>
                </div>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        const input = modal.querySelector('#search-title-input');
        input.focus();
        input.select();
        
        // Close button
        modal.querySelector('.quality-modal-close').addEventListener('click', () => {
            overlay.remove();
            resolve(null);
        });
        
        // Cancel button
        modal.querySelector('#cancel-search-title').addEventListener('click', () => {
            overlay.remove();
            resolve(null);
        });
        
        // Confirm button
        modal.querySelector('#confirm-search-title').addEventListener('click', () => {
            const value = input.value.trim();
            overlay.remove();
            resolve(value || null);
        });
        
        // Enter key
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const value = input.value.trim();
                overlay.remove();
                resolve(value || null);
            }
        });
        
        // Click outside
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(null);
            }
        });
    });
}

/**
 * Show the episode selection UI
 */
function showEpisodeSelectionUI() {
    const container = document.getElementById('episodes-selection');
    if (!container) return;
    
    container.style.display = 'block';
    
    const episodesContainer = document.getElementById('episodes-container');
    episodesContainer.innerHTML = `
        <div class="episode-selection-header">
            <h3>VÝBĚR KVALITY PRO JEDNOTLIVÉ DÍLY</h3>
            <p class="episode-selection-subtitle">Vyhledávání: <strong>${escapeHtml(window.seriesDownload.searchTitle)}</strong></p>
            <p class="episode-selection-progress">
                Díl <span id="current-episode-num">1</span> z <span id="total-episodes-num">${window.seriesDownload.totalEpisodes}</span>
            </p>
        </div>
        
        <div class="episode-search-status" id="episode-search-status">
            <div class="series-tree-loading">
                <i class="fas fa-spinner"></i>
                <p>Vyhledávám díl na prehrajto.cz...</p>
            </div>
        </div>
        
        <div class="episode-results-container" id="episode-results-container" style="display: none;">
            <!-- Results will be populated here -->
        </div>
        
        <div class="episode-selection-summary" id="episode-selection-summary">
            <div class="episode-summary-info">
                <span class="episode-summary-count" id="episode-summary-count">0 / ${window.seriesDownload.totalEpisodes} dílů vybráno</span>
            </div>
            <div class="episode-selection-actions">
                <button class="btn btn-secondary" onclick="skipCurrentEpisode()">
                    <i class="fas fa-forward"></i> PŘESKOČIT DÍL
                </button>
                <button class="btn btn-primary" onclick="startSeriesDownload()" id="start-series-download-btn" disabled>
                    <i class="fas fa-download"></i> STÁHNOUT VYBRANÉ
                </button>
            </div>
        </div>
    `;
    
    // Scroll to section
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Search for next episode on prehrajto.cz
 */
async function searchNextEpisode() {
    const state = window.seriesDownload;
    if (!state || state.currentIndex >= state.episodes.length) {
        // All episodes searched
        showToast('Všechny díly byly vyhledány', 'success');
        updateEpisodeSelectionSummary();
        return;
    }
    
    const episode = state.episodes[state.currentIndex];
    const searchTitle = state.searchTitle; // Use the search title (Czech or custom)
    
    // Update progress
    document.getElementById('current-episode-num').textContent = state.currentIndex + 1;
    
    // Build search query: "Název seriálu sXXeXX"
    const seasonStr = episode.season.toString().padStart(2, '0');
    const episodeStr = episode.episode.toString().padStart(2, '0');
    const searchQuery = `${searchTitle} s${seasonStr}e${episodeStr}`;
    
    console.log(`🔍 Searching for episode: ${searchQuery}`);
    
    // Show loading
    const statusContainer = document.getElementById('episode-search-status');
    statusContainer.innerHTML = `
        <div class="series-tree-loading">
            <i class="fas fa-spinner"></i>
            <p>Vyhledávám: <strong>${escapeHtml(searchQuery)}</strong></p>
        </div>
    `;
    statusContainer.style.display = 'block';
    document.getElementById('episode-results-container').style.display = 'none';
    
    try {
        // Search on prehrajto.cz
        const results = await searchPrehrajto(searchQuery);
        
        if (results.length === 0) {
            // Try alternative search format
            const altQuery = `${searchTitle} ${episode.season}x${episodeStr}`;
            console.log(`🔍 No results, trying alternative: ${altQuery}`);
            const altResults = await searchPrehrajto(altQuery);
            
            if (altResults.length === 0) {
                showEpisodeNotFound(episode, searchQuery);
                return;
            }
            
            showEpisodeResults(episode, altResults, altQuery);
        } else {
            showEpisodeResults(episode, results, searchQuery);
        }
        
    } catch (error) {
        console.error('Episode search error:', error);
        showToast(`Chyba při vyhledávání: ${error.message}`, 'error');
        showEpisodeNotFound(episode, searchQuery);
    }
}

/**
 * Show episode search results
 */
function showEpisodeResults(episode, results, searchQuery) {
    const statusContainer = document.getElementById('episode-search-status');
    const resultsContainer = document.getElementById('episode-results-container');
    
    const seasonStr = episode.season.toString().padStart(2, '0');
    const episodeStr = episode.episode.toString().padStart(2, '0');
    
    statusContainer.innerHTML = `
        <div class="episode-current-info">
            <span class="episode-badge">S${seasonStr}E${episodeStr}</span>
            <span class="episode-name">${escapeHtml(episode.title || 'Bez názvu')}</span>
            <span class="episode-search-query">Hledáno: "${escapeHtml(searchQuery)}"</span>
        </div>
    `;
    
    // Sort results by smart algorithm (same as movies)
    const sortedResults = sortResults(results, 'smart');
    
    resultsContainer.innerHTML = `
        <div class="episode-results-grid">
            ${sortedResults.slice(0, 10).map((result, index) => `
                <div class="episode-result-card ${index === 0 ? 'recommended' : ''}" 
                     data-href="${escapeHtml(result.href)}"
                     data-title="${escapeHtml(result.title)}">
                    <div class="episode-result-thumb">
                        ${result.imageSrc ? `<img src="${result.imageSrc}" alt="">` : '<i class="fas fa-film"></i>'}
                    </div>
                    <div class="episode-result-info">
                        <h4>${escapeHtml(result.title)}</h4>
                        <div class="episode-result-meta">
                            ${result.duration ? `<span><i class="fas fa-clock"></i> ${result.duration}</span>` : ''}
                            ${result.size ? `<span><i class="fas fa-hdd"></i> ${result.size}</span>` : ''}
                        </div>
                    </div>
                    <button class="btn btn-primary episode-select-btn" onclick="selectEpisodeResult(this, '${escapeHtml(result.href)}', '${escapeHtml(result.title)}')">
                        VYBRAT
                    </button>
                </div>
            `).join('')}
        </div>
        ${results.length === 0 ? '<p class="no-results">Žádné výsledky nenalezeny</p>' : ''}
    `;
    
    resultsContainer.style.display = 'block';
}

/**
 * Show episode not found message
 */
function showEpisodeNotFound(episode, searchQuery) {
    const statusContainer = document.getElementById('episode-search-status');
    const resultsContainer = document.getElementById('episode-results-container');
    
    const seasonStr = episode.season.toString().padStart(2, '0');
    const episodeStr = episode.episode.toString().padStart(2, '0');
    
    statusContainer.innerHTML = `
        <div class="episode-current-info">
            <span class="episode-badge">S${seasonStr}E${episodeStr}</span>
            <span class="episode-name">${escapeHtml(episode.title || 'Bez názvu')}</span>
        </div>
    `;
    
    resultsContainer.innerHTML = `
        <div class="episode-not-found">
            <i class="fas fa-exclamation-triangle"></i>
            <h4>Díl nebyl nalezen na prehrajto.cz</h4>
            <p>Hledáno: "${escapeHtml(searchQuery)}"</p>
            <button class="btn btn-secondary" onclick="skipCurrentEpisode()">
                <i class="fas fa-forward"></i> PŘESKOČIT A POKRAČOVAT
            </button>
        </div>
    `;
    
    resultsContainer.style.display = 'block';
}

/**
 * Select a prehrajto result for current episode and get quality
 */
async function selectEpisodeResult(button, href, title) {
    const state = window.seriesDownload;
    const episode = state.episodes[state.currentIndex];
    
    // Show loading on button
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> NAČÍTÁM...';
    button.disabled = true;
    
    try {
        // Get video data (qualities)
        showToast('Načítám dostupné kvality...', 'info');
        const videoData = await getVideoData(href);
        
        if (!videoData.qualities || videoData.qualities.length === 0) {
            throw new Error('Žádné kvality nenalezeny');
        }
        
        // Show quality selector
        const selectedUrl = await showQualitySelector(videoData.qualities, title);
        
        // Store selected episode
        state.selectedEpisodes.push({
            episode: episode,
            prehrajtoHref: href,
            prehrajtoTitle: title,
            selectedQualityUrl: selectedUrl
        });
        
        console.log(`✅ Episode S${episode.season}E${episode.episode} selected with quality`);
        
        // Move to next episode
        state.currentIndex++;
        updateEpisodeSelectionSummary();
        
        // Search next episode
        if (state.currentIndex < state.episodes.length) {
            await searchNextEpisode();
        } else {
            showAllEpisodesSelected();
        }
        
    } catch (error) {
        if (error.message === 'Výběr kvality zrušen') {
            showToast('Výběr kvality zrušen', 'info');
        } else {
            console.error('Error selecting episode:', error);
            showToast(`Chyba: ${error.message}`, 'error');
        }
        
        // Restore button
        button.innerHTML = originalText;
        button.disabled = false;
    }
}

/**
 * Skip current episode
 */
async function skipCurrentEpisode() {
    const state = window.seriesDownload;
    
    console.log(`⏭️ Skipping episode ${state.currentIndex + 1}`);
    
    state.currentIndex++;
    
    if (state.currentIndex < state.episodes.length) {
        await searchNextEpisode();
    } else {
        showAllEpisodesSelected();
    }
}

/**
 * Show all episodes have been processed
 */
function showAllEpisodesSelected() {
    const statusContainer = document.getElementById('episode-search-status');
    const resultsContainer = document.getElementById('episode-results-container');
    const state = window.seriesDownload;
    
    statusContainer.innerHTML = `
        <div class="episode-selection-complete">
            <i class="fas fa-check-circle"></i>
            <h3>VÝBĚR DOKONČEN</h3>
            <p>Vybráno ${state.selectedEpisodes.length} z ${state.totalEpisodes} dílů</p>
        </div>
    `;
    
    // Show selected episodes summary
    if (state.selectedEpisodes.length > 0) {
        resultsContainer.innerHTML = `
            <div class="selected-episodes-summary">
                <h4>VYBRANÉ DÍLY:</h4>
                <div class="selected-episodes-list">
                    ${state.selectedEpisodes.map(ep => `
                        <div class="selected-episode-item">
                            <span class="episode-badge">S${ep.episode.season.toString().padStart(2, '0')}E${ep.episode.episode.toString().padStart(2, '0')}</span>
                            <span class="episode-name">${escapeHtml(ep.episode.title || ep.prehrajtoTitle)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        resultsContainer.style.display = 'block';
    } else {
        resultsContainer.innerHTML = `
            <div class="episode-not-found">
                <i class="fas fa-exclamation-triangle"></i>
                <h4>Žádné díly nebyly vybrány</h4>
            </div>
        `;
        resultsContainer.style.display = 'block';
    }
    
    updateEpisodeSelectionSummary();
}

/**
 * Update episode selection summary
 */
function updateEpisodeSelectionSummary() {
    const state = window.seriesDownload;
    if (!state) return;
    
    const countEl = document.getElementById('episode-summary-count');
    const downloadBtn = document.getElementById('start-series-download-btn');
    
    if (countEl) {
        countEl.textContent = `${state.selectedEpisodes.length} / ${state.totalEpisodes} dílů vybráno`;
    }
    
    if (downloadBtn) {
        downloadBtn.disabled = state.selectedEpisodes.length === 0;
    }
}

/**
 * Start downloading all selected episodes
 */
async function startSeriesDownload() {
    const state = window.seriesDownload;
    
    if (!state || state.selectedEpisodes.length === 0) {
        showToast('Žádné díly k stažení', 'warning');
        return;
    }
    
    console.log('📥 Starting series download:', state);
    
    // Get IMDB info for the series
    let seriesImdbData = null;
    try {
        const imdbResponse = await fetch(`${API_CONFIG.prehrajto}/imdb/series/${state.series.imdbId}`);
        const imdbResult = await imdbResponse.json();
        if (imdbResult.success) {
            seriesImdbData = imdbResult.data;
        }
    } catch (e) {
        console.warn('Could not fetch series IMDB data:', e);
    }
    
    // Create series download job
    const downloadData = {
        seriesTitle: state.series.title,
        seriesImdbId: state.series.imdbId,
        seriesImdbData: seriesImdbData,
        episodes: state.selectedEpisodes.map(ep => ({
            season: ep.episode.season,
            episode: ep.episode.episode,
            episodeTitle: ep.episode.title,
            prehrajtoTitle: ep.prehrajtoTitle,
            videoUrl: ep.selectedQualityUrl
        }))
    };
    
    showToast(`Zahajuji stahování ${state.selectedEpisodes.length} dílů...`, 'info');
    
    try {
        const response = await fetch(`${API_CONFIG.prehrajto}/download/series`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(downloadData)
        });
        
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Nepodařilo se zahájit stahování');
        }
        
        const jobId = result.jobId;
        
        // Create HUD card for series download
        createSeriesHudCard(jobId, state.series.title, state.selectedEpisodes.length);
        
        // Start SSE for progress
        const es = new EventSource(`${API_CONFIG.prehrajto}/download/progress/${encodeURIComponent(jobId)}`);
        
        es.onmessage = (ev) => {
            let data;
            try { data = JSON.parse(ev.data); } catch { return; }
            
            handleSeriesDownloadProgress(jobId, data);
        };
        
        es.onerror = () => {
            console.warn('SSE connection error for series download');
        };
        
        showToast('Stahování seriálu zahájeno!', 'success');
        
        // Hide episode selection UI
        document.getElementById('episodes-selection').style.display = 'none';
        
    } catch (error) {
        console.error('Series download error:', error);
        showToast(`Chyba: ${error.message}`, 'error');
    }
}

/**
 * Create HUD card for series download
 */
function createSeriesHudCard(jobId, seriesTitle, episodeCount) {
    const hud = ensureHud();
    
    const card = document.createElement('div');
    card.className = 'download-hud-card series-download';
    card.dataset.jobId = jobId;
    
    card.innerHTML = `
        <div class="download-hud-top">
            <div style="min-width: 0;">
                <div class="download-hud-title">${escapeHtml(seriesTitle)}</div>
                <div class="download-hud-sub" data-sub>${episodeCount} dílů</div>
            </div>
            <div class="download-hud-actions">
                <button class="download-hud-iconbtn danger" data-cancel title="Zrušit a smazat">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
        
        <div class="download-hud-episode" data-current-episode>
            <span class="episode-badge" data-episode-badge>S01E01</span>
            <span data-episode-name>Inicializuji...</span>
        </div>
        
        <div class="download-hud-bar">
            <div class="download-hud-fill" data-fill></div>
        </div>
        
        <div class="download-hud-meta">
            <div><span class="download-hud-status" data-status>ČEKÁM</span></div>
            <div data-meta>0% • 0 B/s • ETA —</div>
        </div>
        
        <div class="download-hud-episodes-progress" data-episodes-progress>
            0 / ${episodeCount} dílů staženo
        </div>
    `;
    
    // Cancel button handler
    card.querySelector('[data-cancel]').addEventListener('click', async () => {
        try {
            const r = await fetch(`${API_CONFIG.prehrajto}/download/cancel/${encodeURIComponent(jobId)}`, {
                method: 'POST'
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j.success) throw new Error(j.error || 'Cancel failed');
            
            showToast('Stahování seriálu zrušeno', 'warning');
        } catch (e) {
            showToast(`Nepodařilo se zrušit: ${e.message}`, 'error');
        }
    });
    
    hud.prepend(card);
    return card;
}

/**
 * Handle series download progress updates
 */
function handleSeriesDownloadProgress(jobId, data) {
    const card = document.querySelector(`.download-hud-card[data-job-id="${jobId}"]`);
    if (!card) return;
    
    const fill = card.querySelector('[data-fill]');
    const sub = card.querySelector('[data-sub]');
    const statusEl = card.querySelector('[data-status]');
    const meta = card.querySelector('[data-meta]');
    const episodeBadge = card.querySelector('[data-episode-badge]');
    const episodeName = card.querySelector('[data-episode-name]');
    const episodesProgress = card.querySelector('[data-episodes-progress]');
    
    if (data.type === 'episode-start') {
        episodeBadge.textContent = `S${data.season.toString().padStart(2, '0')}E${data.episode.toString().padStart(2, '0')}`;
        episodeName.textContent = data.episodeTitle || 'Stahování...';
        statusEl.textContent = 'STAHUJU';
        statusEl.classList.remove('ok', 'err');
    }
    
    if (data.type === 'progress') {
        const pct = data.progress || 0;
        fill.style.width = `${pct}%`;
        
        const speed = data.speedBps || 0;
        const eta = data.etaSec;
        
        meta.textContent = `${Math.round(pct)}% • ${formatBytes(speed)}/s • ${formatSeconds(eta)}`;
        sub.textContent = `${formatBytes(data.downloadedBytes)} / ${formatBytes(data.totalBytes)}`;
    }
    
    if (data.type === 'episode-done') {
        episodesProgress.textContent = `${data.completedEpisodes} / ${data.totalEpisodes} dílů staženo`;
    }
    
    if (data.type === 'done') {
        fill.style.width = '100%';
        statusEl.textContent = 'HOTOVO';
        statusEl.classList.add('ok');
        statusEl.classList.remove('err');
        meta.textContent = '100%';
        episodesProgress.textContent = `${data.totalEpisodes} / ${data.totalEpisodes} dílů staženo`;
        sub.textContent = '✅ Všechny díly staženy';
        
        showToast('✅ Seriál úspěšně stažen!', 'success', 5000);
    }
    
    if (data.type === 'error') {
        statusEl.textContent = 'CHYBA';
        statusEl.classList.add('err');
        statusEl.classList.remove('ok');
        sub.textContent = data.error || 'Stahování selhalo';
        
        showToast(`Chyba: ${data.error}`, 'error');
    }
    
    if (data.type === 'canceled') {
        statusEl.textContent = 'ZRUŠENO';
        statusEl.classList.add('err');
        statusEl.classList.remove('ok');
        sub.textContent = 'Stahování zrušeno';
    }
}

/**
 * Display seasons for selection (legacy function - kept for compatibility)
 */
function displaySeasons(seriesData) {
    // Redirect to new tree view if we have detailed episodes
    if (seriesData.seasons && seriesData.seasons[0] && seriesData.seasons[0].episodes) {
        displaySeasonsTree(seriesData.seasons, seriesData.Title || window.selectedSeries?.title);
        return;
    }
    
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
 * @param {string} title - Název filmu z výsledků Prehrajto
 * @param {string|null} year - Rok filmu
 * @param {string|null} originalQuery - Původní vyhledávací dotaz od uživatele (prioritní pro IMDB)
 */
async function getIMDBInfo(title, year = null, originalQuery = null) {
    try {
        console.log('🔎 [IMDB][REQUEST] title="%s" | year=%s | originalQuery="%s"', title, year || 'N/A', originalQuery || 'N/A');
        
        const yearParam = year ? `/${year}` : '';
        // Přidáme originalQuery jako query parametr, pokud existuje
        const queryParam = originalQuery ? `?originalQuery=${encodeURIComponent(originalQuery)}` : '';
        const response = await fetch(`${API_CONFIG.prehrajto}/imdb/${encodeURIComponent(title)}${yearParam}${queryParam}`);
        const data = await response.json();
        
        if (!response.ok) {
            console.log('❌ [IMDB][FAIL] status=%d | error="%s"', response.status, data.error || 'unknown');
            showToast(`IMDB nenalezen pro: ${title}`, 'warning');
            throw new Error(data.error || 'IMDB API chyba');
        }
        
        if (data.success && data.data) {
            const d = data.data;
            console.log(
                '✅ [IMDB][SUCCESS] found="%s" (%s) | imdbID=%s | type=%s | genre=%s',
                d.Title, d.Year, d.imdbID, d.Type, d.Genre || 'N/A'
            );
            showToast(`✅ IMDB nalezen: ${d.Title} (${d.Year})`, 'success');
            return d;
        } else {
            console.log('❌ [IMDB][FAIL] success=false | title="%s"', title);
            showToast(`IMDB nenalezen pro: ${title}`, 'warning');
            throw new Error(data.error || 'IMDB data nebyly nalezeny');
        }
    } catch (error) {
        console.error('💥 [IMDB][ERROR] title="%s" | error="%s"', title, error.message);
        return null;
    }
}

/**
 * Get IMDB information by IMDB ID directly
 * @param {string} imdbId - IMDB ID (e.g., tt0120338)
 */
async function getIMDBInfoById(imdbId) {
    try {
        console.log('🔎 [IMDB][BY-ID] imdbId="%s"', imdbId);
        
        const response = await fetch(`${API_CONFIG.prehrajto}/imdb-by-id/${encodeURIComponent(imdbId)}`);
        const data = await response.json();
        
        if (data.success && data.data) {
            const d = data.data;
            console.log('✅ [IMDB][BY-ID] found="%s" (%s)', d.Title, d.Year);
            return d;
        }
        return null;
    } catch (error) {
        console.error('💥 [IMDB][BY-ID] error="%s"', error.message);
        return null;
    }
}

/**
 * Get original title from Czech title using TMDB
 * @param {string} czechTitle - Czech movie title
 * @param {string|null} year - Year (optional)
 */
async function getOriginalTitleFromTMDB(czechTitle, year = null) {
    try {
        console.log('🔍 [TMDB] Looking up original title for: "%s"', czechTitle);
        
        let url = `${API_CONFIG.prehrajto}/tmdb/original-title?title=${encodeURIComponent(czechTitle)}`;
        if (year) {
            url += `&year=${year}`;
        }
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ [TMDB] Original title: "%s" -> "%s" [%s]', czechTitle, data.originalTitle, data.imdbId || 'no imdb');
            return {
                originalTitle: data.originalTitle,
                czechTitle: data.czechTitle,
                year: data.year,
                imdbId: data.imdbId,
                tmdbId: data.tmdbId
            };
        }
        
        console.log('❌ [TMDB] No results for: "%s"', czechTitle);
        return null;
    } catch (error) {
        console.error('💥 [TMDB] Error:', error.message);
        return null;
    }
}

/**
 * Get video data from prehrajto.cz (URL + all available qualities)
 */
async function getVideoData(moviePath) {
    try {
        const cleanPath = moviePath.startsWith('/') ? moviePath.substring(1) : moviePath;
        const response = await fetch(`${API_CONFIG.prehrajto}/video/${cleanPath}`);
        const data = await response.json();
        
        if (data.success && data.videoUrl) {
            return {
                videoUrl: data.videoUrl,
                qualities: data.qualities || [{ src: data.videoUrl, res: 0, label: 'Default' }],
                maxResolution: data.maxResolution || null
            };
        } else {
            throw new Error(data.error || 'Video URL nebylo nalezeno');
        }
    } catch (error) {
        console.error('Video data error:', error);
        throw error;
    }
}

/**
 * Get video URL from prehrajto.cz (backwards compatibility)
 */
async function getVideoUrl(moviePath) {
    const data = await getVideoData(moviePath);
    return data.videoUrl;
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
    // Použij název z IMDB pokud je k dispozici, jinak z původního titulu
    const rawTitle = imdbInfo?.Title || item.title || 'Unknown';
    const cleanTitle = rawTitle.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
    
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
    const patterns = [
        { quality: '8K', pattern: /8k|4320p/i, color: 'var(--color-glitch-magenta)' },
        { quality: '4K', pattern: /4k|2160p|uhd/i, color: 'var(--color-glitch-cyan)' },
        { quality: '1080p', pattern: /1080p|full.*hd|fhd/i, color: 'var(--color-glitch-green)' },
        { quality: '720p', pattern: /720p|hd(?!.*1080)/i, color: 'var(--color-glitch-cyan)' },
        { quality: '480p', pattern: /480p|sd|dvd/i, color: 'var(--color-text-secondary)' }
    ];
    
    // Najdi nejvyšší kvalitu (první match)
    for (const { quality, pattern, color } of patterns) {
        if (pattern.test(title)) {
            return `<span class="result-badge" style="border-color: ${color};">${quality}</span>`;
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
 * Show quality selector modal
 * @returns {Promise<string>} Selected quality URL
 */
async function showQualitySelector(qualities, movieTitle) {
    return new Promise((resolve, reject) => {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'quality-modal-overlay';
        
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'quality-modal';
        
        // Header
        const header = document.createElement('div');
        header.className = 'quality-modal-header';
        header.innerHTML = `
            <h2><i class="fas fa-cog"></i> VÝBĚR KVALITY</h2>
            <button class="quality-modal-close">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        // Body
        const body = document.createElement('div');
        body.className = 'quality-modal-body';
        
        // Sort qualities from highest to lowest
        const sortedQualities = [...qualities].sort((a, b) => b.res - a.res);
        
        // Generate quality options
        sortedQualities.forEach((quality, index) => {
            const option = document.createElement('div');
            option.className = 'quality-option';
            if (index === 0) option.classList.add('recommended'); // First = highest quality
            
            option.innerHTML = `
                <div class="quality-label">
                    <div class="quality-resolution">${quality.label}</div>
                    <div class="quality-description">
                        ${getQualityDescription(quality.res)}
                    </div>
                </div>
            `;
            
            option.addEventListener('click', () => {
                overlay.remove();
                resolve(quality.src);
            });
            
            body.appendChild(option);
        });
        
        // Assemble modal
        modal.appendChild(header);
        modal.appendChild(body);
        overlay.appendChild(modal);
        
        // Close button
        header.querySelector('.quality-modal-close').addEventListener('click', () => {
            overlay.remove();
            reject(new Error('Výběr kvality zrušen'));
        });
        
        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                reject(new Error('Výběr kvality zrušen'));
            }
        });
        
        // Add to DOM
        document.body.appendChild(overlay);
    });
}

/**
 * Get quality description
 */
function getQualityDescription(resolution) {
    if (resolution >= 2160) return '4K Ultra HD - Nejvyšší kvalita';
    if (resolution >= 1080) return 'Full HD - Vysoká kvalita';
    if (resolution >= 720) return 'HD - Dobrá kvalita';
    if (resolution >= 480) return 'SD - Standardní kvalita';
    return 'Neznámá kvalita';
}

/**
 * Preview video quality
 */
async function previewVideo(moviePath, movieTitle) {
    try {
        // Show loading toast
        showToast('Načítám dostupné kvality...', 'info');
        
        // Get video data FIRST
        const videoData = await getVideoData(moviePath);
        
        // Always show selector (even for single quality for testing)
        console.log('🎬 Video data received:', videoData);
        
        if (videoData.qualities && videoData.qualities.length > 0) {
            const selectedUrl = await showQualitySelector(videoData.qualities, movieTitle);
            window.open(selectedUrl, '_blank');
            showToast(`Video otevřeno: ${movieTitle}`, 'success');
        } else {
            console.error('❌ No qualities found in videoData:', videoData);
            window.open(videoData.videoUrl, '_blank');
            showToast(`Video otevřeno (fallback): ${movieTitle}`, 'success');
        }
    } catch (error) {
        if (error.message === 'Výběr kvality zrušen') {
            showToast('Náhled zrušen', 'info');
            return;
        }
        
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
        // KROK 1: Načti kvality a HNED zobraz selector
        showToast('Načítám dostupné kvality...', 'info');
        const videoData = await getVideoData(moviePath);
        
        // KROK 2: Zobraz modal pro výběr kvality (vždy, i pro debug)
        console.log('📥 Video data for download:', videoData);
        
        let selectedUrl = videoData.videoUrl; // default to highest quality
        if (videoData.qualities && videoData.qualities.length > 0) {
            try {
                selectedUrl = await showQualitySelector(videoData.qualities, movieTitle);
            } catch (selectError) {
                if (selectError.message === 'Výběr kvality zrušen') {
                    showToast('Stahování zrušeno', 'info');
                    return;
                }
                throw selectError;
            }
        } else {
            console.error('❌ No qualities available for download:', videoData);
            showToast('⚠️ Žádné kvality nenalezeny, použiji fallback URL', 'warning');
        }
        
        // KROK 3: Pokud je jazyk čeština, nejdřív najdi originální název přes TMDB
        let searchTitle = lastSearchQuery || movieTitle;
        let imdbInfo = null;
        
        if (currentLanguage === 'cz') {
            showToast('Hledám originální název filmu...', 'info');
            const originalTitleData = await getOriginalTitleFromTMDB(searchTitle);
            
            if (originalTitleData && originalTitleData.originalTitle) {
                console.log(`🎬 Found original title: "${originalTitleData.originalTitle}" for Czech: "${searchTitle}"`);
                searchTitle = originalTitleData.originalTitle;
                
                // Pokud TMDB vrátil i IMDB ID, použijeme ho přímo
                if (originalTitleData.imdbId) {
                    showToast('Získávám metadata z IMDB...', 'info');
                    imdbInfo = await getIMDBInfoById(originalTitleData.imdbId);
                }
            }
        }
        
        // KROK 4: Pokud nemáme IMDB info, získej ho pomocí názvu
        if (!imdbInfo) {
            showToast('Získávám metadata z IMDB...', 'info');
            imdbInfo = await getIMDBInfo(searchTitle, null, lastSearchQuery);
        }
        
        // Generate filename
        const filename = generateJellyfinName({ title: movieTitle }, imdbInfo);
        
        // Download subtitles if needed
        let subtitles = [];
        if (imdbInfo && imdbInfo.Title) {
            subtitles = await downloadSubtitles(imdbInfo.Title, imdbInfo.Year);
        }
        
        // Start download with selected quality
        await startDownload({
            title: movieTitle,
            url: selectedUrl,
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
                
                // Přidáme originalQuery pokud existuje
                const queryParam = lastSearchQuery ? `?originalQuery=${encodeURIComponent(lastSearchQuery)}` : '';
                const imdbResponse = await fetch(`${API_CONFIG.prehrajto}/imdb/${encodeURIComponent(searchTitle)}${year ? `/${year}` : ''}${queryParam}`);
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
            imdbData: imdbData || null,  // ✅ použij to co ses opravdu dotáhl
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
                    metaText: `${Math.round(pct)}% • ${formatBytes(speed)}/s • ${formatSeconds(eta)}`
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

            if (data.type === 'canceled') {
                es.close();
                updateHudCard(jobId, {
                    statusText: 'ZRUŠENO',
                    statusKind: 'err',
                    subText: data.message || 'Stahování zrušeno a smazáno.',
                    metaText: ''
                });
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
        
        // Uložit původní hledaný výraz pro IMDB lookup
        lastSearchQuery = query;
        
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
    
    // Settings modal functionality
    initSettingsModal();
    
    // File browser functionality
    initFileBrowser();
    
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

// ===============================================
// SETTINGS MODAL FUNCTIONS
// ===============================================

/**
 * Initialize settings modal functionality
 */
function initSettingsModal() {
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const settingsClose = document.getElementById('settings-close');
    const settingsCancel = document.getElementById('settings-cancel');
    const settingsSave = document.getElementById('settings-save');
    
    // Open modal
    settingsBtn?.addEventListener('click', () => {
        openSettingsModal();
    });
    
    // Close modal
    settingsClose?.addEventListener('click', () => {
        closeSettingsModal();
    });
    
    settingsCancel?.addEventListener('click', () => {
        closeSettingsModal();
    });
    
    // Close on overlay click
    settingsModal?.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            closeSettingsModal();
        }
    });
    
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && settingsModal?.style.display !== 'none') {
            closeSettingsModal();
        }
    });
    
    // Save settings
    settingsSave?.addEventListener('click', () => {
        saveSettings();
    });
}

/**
 * Open settings modal and load current settings
 */
async function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    const moviesDirInput = document.getElementById('movies-dir-input');
    const seriesDirInput = document.getElementById('series-dir-input');
    
    try {
        // Load current settings
        const response = await fetch('/api/settings');
        const data = await response.json();
        
        if (data.success) {
            moviesDirInput.value = data.settings.moviesDir || '';
            seriesDirInput.value = data.settings.seriesDir || '';
        }
    } catch (error) {
        console.error('Error loading settings:', error);
        showToast('Chyba při načítání nastavení', 'error');
    }
    
    modal.style.display = 'flex';
}

/**
 * Close settings modal
 */
function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.style.display = 'none';
}

/**
 * Save settings to server
 */
async function saveSettings() {
    const moviesDirInput = document.getElementById('movies-dir-input');
    const seriesDirInput = document.getElementById('series-dir-input');
    
    const moviesDir = moviesDirInput.value.trim();
    const seriesDir = seriesDirInput.value.trim();
    
    if (!moviesDir || !seriesDir) {
        showToast('Vyplňte obě cesty', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ moviesDir, seriesDir })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Nastavení bylo uloženo', 'success');
            closeSettingsModal();
        } else {
            showToast(data.error || 'Chyba při ukládání', 'error');
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        showToast('Chyba při ukládání nastavení', 'error');
    }
}

// ===============================================
// FILE BROWSER MODAL FUNCTIONS
// ===============================================

let fileBrowserTargetInput = null;
let fileBrowserCurrentPath = '';
let fileBrowserParentPath = null;

/**
 * Initialize file browser modal functionality
 */
function initFileBrowser() {
    const modal = document.getElementById('file-browser-modal');
    const closeBtn = document.getElementById('file-browser-close');
    const cancelBtn = document.getElementById('file-browser-cancel');
    const selectBtn = document.getElementById('file-browser-select');
    const upBtn = document.getElementById('path-up-btn');
    
    // Browse buttons
    document.querySelectorAll('.browse-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            openFileBrowser(targetId);
        });
    });
    
    // Close modal
    closeBtn?.addEventListener('click', closeFileBrowser);
    cancelBtn?.addEventListener('click', closeFileBrowser);
    
    // Close on overlay click
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeFileBrowser();
        }
    });
    
    // Navigate up
    upBtn?.addEventListener('click', () => {
        if (fileBrowserParentPath !== null) {
            browseDirectory(fileBrowserParentPath);
        }
    });
    
    // Select folder
    selectBtn?.addEventListener('click', () => {
        if (fileBrowserCurrentPath && fileBrowserTargetInput) {
            const targetInput = document.getElementById(fileBrowserTargetInput);
            if (targetInput) {
                targetInput.value = fileBrowserCurrentPath;
            }
            closeFileBrowser();
        }
    });
}

/**
 * Open file browser modal
 */
function openFileBrowser(targetInputId) {
    fileBrowserTargetInput = targetInputId;
    
    // Get current value from target input as starting path
    const targetInput = document.getElementById(targetInputId);
    const startPath = targetInput?.value || '';
    
    const modal = document.getElementById('file-browser-modal');
    modal.style.display = 'flex';
    
    // Browse to starting path or root
    browseDirectory(startPath);
}

/**
 * Close file browser modal
 */
function closeFileBrowser() {
    const modal = document.getElementById('file-browser-modal');
    modal.style.display = 'none';
    fileBrowserTargetInput = null;
}

/**
 * Browse directory and display contents
 */
async function browseDirectory(dirPath) {
    const content = document.getElementById('file-browser-content');
    const pathInput = document.getElementById('current-path-input');
    const upBtn = document.getElementById('path-up-btn');
    
    // Show loading
    content.innerHTML = `
        <div class="file-browser-loading">
            <i class="fas fa-spinner"></i>
        </div>
    `;
    
    try {
        const response = await fetch(`/api/browse-directory?path=${encodeURIComponent(dirPath)}`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Chyba při načítání složky');
        }
        
        fileBrowserCurrentPath = data.currentPath;
        fileBrowserParentPath = data.parentPath;
        
        // Update path input
        pathInput.value = data.currentPath || 'Tento počítač';
        
        // Update up button
        upBtn.disabled = data.parentPath === null;
        
        // Display folders
        if (data.items.length === 0) {
            content.innerHTML = `
                <div class="file-browser-empty">
                    <i class="fas fa-folder-open"></i>
                    <p>Prázdná složka</p>
                </div>
            `;
        } else {
            content.innerHTML = data.items.map(item => `
                <div class="folder-item ${!data.currentPath ? 'drive' : ''}" 
                     data-path="${escapeHtml(item.path)}"
                     ondblclick="browseDirectory('${escapeHtml(item.path).replace(/\\/g, '\\\\')}')">
                    <i class="fas ${!data.currentPath ? 'fa-hdd' : 'fa-folder'}"></i>
                    <span class="folder-name">${escapeHtml(item.name)}</span>
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.error('Error browsing directory:', error);
        content.innerHTML = `
            <div class="file-browser-empty">
                <i class="fas fa-exclamation-triangle"></i>
                <p>${error.message}</p>
            </div>
        `;
    }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make browseDirectory available globally for ondblclick
window.browseDirectory = browseDirectory;