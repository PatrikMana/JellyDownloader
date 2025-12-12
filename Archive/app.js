// Globální proměnné
let currentResults = [];
let allResults = [];  // Původní nefiltrované výsledky
let currentVideoUrl = null;
let currentMovieTitle = null;

// Konfigurácia filtrov
const FILTER_CONFIG = {
    quality: {
        patterns: {
            '4k': /4k|2160p|uhd/i,
            '1080p': /1080p|full.*hd|fhd/i,
            '720p': /720p|hd(?!.*1080)/i,
            '480p': /480p|sd|dvd/i,
            '360p': /360p|mobile/i
        },
        scores: { '4k': 5, '1080p': 4, '720p': 3, '480p': 2, '360p': 1 }
    },
    size: {
        // Extrahování velikosti ze stringů jako "1.2 GB", "850 MB" atd.
        parseSize: (movie) => {
            // Pokud je movie objekt s polem size, použij to
            let text;
            if (typeof movie === 'object' && movie.size) {
                text = movie.size;
            } else if (typeof movie === 'object' && movie.title) {
                text = movie.title;
            } else if (typeof movie === 'string') {
                text = movie;
            } else {
                return null;
            }
            
            if (!text) return null;
            
            // Vylepšené regex pro různé formáty velikostí
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
                        default: 
                            return null;
                    }
                }
            }
            return null;
        }
    },
    language: {
        patterns: {
            czech: /(?:cz|czech|čeština|cesky|české)/i,
            slovak: /(?:sk|slovak|slovenčina|slovensky|slovenské)/i,
            english: /(?:en|eng|english|anglický)/i,
            dubbed: /(?:dabing|dabovaný|dub)/i,
            subtitled: /(?:titulky|sub|subs)/i
        }
    }
};

// Event listenery
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Prehrajto Stahování načteno');
    
    // Focus na search input
    document.getElementById('searchInput').focus();
    
    // Zkontroluj všechny elementy
    console.log('🔍 Kontroluji elementy:');
    ['languageFilter', 'sizeSort', 'hideMultipart', 'showQualityTags', 'showSizeTags'].forEach(id => {
        const element = document.getElementById(id);
        console.log(`${id}: ${element ? '✅ OK' : '❌ Nenalezen'}`);
    });
    
    // Event listenery pro filtry
    ['languageFilter', 'sizeSort', 'hideMultipart', 'showQualityTags', 'showSizeTags'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            console.log(`✅ Registruji event listener pro: ${id}`);
            element.addEventListener('change', () => {
                console.log(`🔧 Filter changed: ${id}, value: ${element.value}`);
                if (allResults.length > 0) {
                    const filtered = applyFiltersAndSort(allResults);
                    currentResults = filtered;
                    displayResults(filtered);
                    
                    const filteredCount = filtered.length;
                    const totalCount = allResults.length;
                    
                    if (filteredCount === totalCount) {
                        showToast(`Zobrazeno ${filteredCount} výsledků`, 'info');
                    } else {
                        showToast(`Zobrazeno ${filteredCount} z ${totalCount} výsledků`, 'info');
                    }
                }
            });
        } else {
            console.log(`❌ Element nenalezen: ${id}`);
        }
    });
});

// Funkce pro zpracování Enter klávesy
function handleEnterPress(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        searchMovies();
    }
}

// Hlavní funkce pro vyhledávání filmů
async function searchMovies() {
    const searchTerm = document.getElementById('searchInput').value.trim();
    
    if (!searchTerm) {
        showError('Zadejte název filmu nebo seriálu');
        return;
    }
    
    console.log(`🔍 Vyhledávám: "${searchTerm}"`);
    
    // Zobraz loading
    showLoading(true);
    clearResults();
    
    try {
        const response = await fetch(`/api/search/${encodeURIComponent(searchTerm)}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Chyba serveru');
        }
        
        if (data.success) {
            // Uložíme původní výsledky
            allResults = data.results;
            
            // Aplikujeme filtry a řazení
            const filteredResults = applyFiltersAndSort(data.results);
            currentResults = filteredResults;
            
            displayResults(filteredResults);
            
            const originalCount = data.results.length;
            const filteredCount = filteredResults.length;
            
            if (filteredCount === originalCount) {
                console.log(`✅ Nalezeno ${filteredCount} výsledků`);
                showSuccess(`Nalezeno ${filteredCount} výsledků`);
            } else {
                console.log(`✅ Nalezeno ${originalCount} výsledků, po filtrování zobrazeno ${filteredCount}`);
                showSuccess(`Nalezeno ${originalCount} výsledků, zobrazeno ${filteredCount} po filtrování`);
            }
        } else {
            throw new Error(data.error || 'Neznámá chyba');
        }
        
    } catch (error) {
        console.error('❌ Chyba při vyhledávání:', error);
        showError(`Chyba při vyhledávání: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

// Zobrazení výsledků vyhledávání
function displayResults(results) {
    const resultsContainer = document.getElementById('results');
    
    if (!results || results.length === 0) {
        resultsContainer.innerHTML = `
            <div class="col-12">
                <div class="no-results fade-in">
                    <i class="fas fa-search"></i>
                    <h3>Žádné výsledky</h3>
                    <p>Zkuste změnit hledaný výraz nebo filtry</p>
                </div>
            </div>
        `;
        return;
    }
    
    resultsContainer.innerHTML = results.map((movie, index) => `
        <div class="col-lg-3 col-md-4 col-sm-6 mb-4">
            <div class="card movie-card fade-in" style="animation-delay: ${index * 0.1}s">
                <img 
                    src="${movie.imageSrc || '/placeholder.jpg'}" 
                    class="card-img-top" 
                    alt="${escapeHtml(movie.title)}"
                    onerror="this.src='/placeholder.jpg'"
                >
                <div class="card-body">
                    <h6 class="card-title text-truncate" title="${escapeHtml(movie.title)}">
                        ${escapeHtml(movie.title)}
                    </h6>
                    <div class="movie-meta mt-2">
                        ${getQualityBadge(movie.title)}
                        ${getSizeBadge(movie)}
                        ${getLanguageBadge(movie.title)}
                    </div>
                    <div class="d-flex justify-content-between align-items-center mt-1">
                        ${movie.duration ? `<span class="movie-info"><i class="fas fa-clock me-1"></i>${movie.duration}</span>` : ''}
                        ${movie.size ? `<span class="movie-info"><i class="fas fa-hdd me-1"></i>${movie.size}</span>` : ''}
                    </div>
                    <div class="d-grid gap-2">
                        <button 
                            class="btn btn-primary btn-sm" 
                            onclick="event.stopPropagation(); playMovie('${movie.href}', '${escapeHtml(movie.title)}')"
                        >
                            <i class="fas fa-external-link-alt me-2"></i>Otevřít video
                        </button>
                        <button 
                            class="btn btn-outline-secondary btn-sm" 
                            onclick="event.stopPropagation(); copyMovieUrl('${movie.href}', '${escapeHtml(movie.title)}')"
                        >
                            <i class="fas fa-copy me-2"></i>Kopírovat odkaz
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

// Přehrání filmu - otevře video v nové kartě
async function playMovie(moviePath, movieTitle) {
    console.log(`🎬 Otevírám film v nové kartě: ${movieTitle}`);
    console.log(`📂 Cesta: ${moviePath}`);
    
    // Zobraz loading toast
    showToast('Získávám odkaz na video...', 'info');
    
    try {
        // API volání pro získání video URL
        const cleanPath = moviePath.startsWith('/') ? moviePath.substring(1) : moviePath;
        console.log(`🔧 Čistá cesta: ${cleanPath}`);
        
        const apiUrl = `/api/video/${cleanPath}`;
        console.log(`📡 API volání: ${apiUrl}`);
        
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        console.log(`📊 Response status: ${response.status}`);
        console.log(`📄 Response data:`, data);
        
        if (!response.ok) {
            throw new Error(data.error || `Server error: ${response.status}`);
        }
        
        if (data.success && data.videoUrl) {
            console.log(`✅ Video URL získáno: ${data.videoUrl}`);
            
            // Otevři video v nové kartě
            window.open(data.videoUrl, '_blank');
            showToast(`✅ Video otevřeno v nové kartě: ${movieTitle}`, 'success');
            
        } else {
            throw new Error(data.error || 'Video URL nebylo nalezeno');
        }
        
    } catch (error) {
        console.error('❌ Chyba při získávání video:', error);
        showToast(`❌ Chyba: ${error.message}`, 'error');
        
        // Jako fallback otevři původní stránku prehrajto.cz
        const fallbackUrl = `https://prehrajto.cz/${moviePath}`;
        console.log(`🔄 Fallback: otevírám ${fallbackUrl}`);
        window.open(fallbackUrl, '_blank');
        showToast(`⚠️ Otevřena originální stránka jako záložní plán`, 'warning');
    }
}

// Kopírování do schránky
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Odkaz byl zkopírován do schránky', 'success');
    } catch (error) {
        console.error('Chyba při kopírování:', error);
        
        // Fallback pro starší prohlížeče
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showToast('Odkaz byl zkopírován do schránky', 'success');
        } catch (fallbackError) {
            showToast('Chyba při kopírování odkazu', 'error');
        }
        document.body.removeChild(textArea);
    }
}

// Pomocné funkce
function showLoading(show) {
    const loading = document.getElementById('loading');
    const searchButton = document.getElementById('searchButton');
    
    if (show) {
        loading.classList.remove('d-none');
        searchButton.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Hledám...';
        searchButton.disabled = true;
    } else {
        loading.classList.add('d-none');
        searchButton.innerHTML = '<i class="fas fa-search me-2"></i>Hledat';
        searchButton.disabled = false;
    }
}

function clearResults() {
    document.getElementById('results').innerHTML = '';
}

function showError(message) {
    const resultsContainer = document.getElementById('results');
    resultsContainer.innerHTML = `
        <div class="col-12">
            <div class="error-message fade-in">
                <i class="fas fa-exclamation-triangle"></i>
                <h5>Chyba</h5>
                <p>${escapeHtml(message)}</p>
            </div>
        </div>
    `;
}

function showToast(message, type = 'success') {
    // Vylepšený toast s více typy
    const toast = document.createElement('div');
    const alertType = {
        'success': 'success',
        'error': 'danger', 
        'warning': 'warning',
        'info': 'info'
    }[type] || 'success';
    
    const iconType = {
        'success': 'check',
        'error': 'exclamation-triangle',
        'warning': 'exclamation-triangle', 
        'info': 'info-circle'
    }[type] || 'check';
    
    toast.className = `alert alert-${alertType} position-fixed fade-in`;
    toast.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px; max-width: 400px;';
    toast.innerHTML = `
        <i class="fas fa-${iconType} me-2"></i>
        ${escapeHtml(message)}
        <button type="button" class="btn-close float-end" onclick="this.parentElement.remove()"></button>
    `;
    
    document.body.appendChild(toast);
    
    // Auto remove po 5 sekundách (okrem error správ)
    const autoRemoveTime = type === 'error' ? 8000 : 5000;
    setTimeout(() => {
        if (document.body.contains(toast)) {
            document.body.removeChild(toast);
        }
    }, autoRemoveTime);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Retry funkcia pre video
async function retryVideo(moviePath, movieTitle) {
    console.log('🔄 Retry video loading');
    await playMovie(moviePath, movieTitle);
}

// Kopírování video URL bez otevření
async function copyMovieUrl(moviePath, movieTitle) {
    console.log(`📋 Kopíruji URL pro film: ${movieTitle}`);
    
    showToast('Získávám odkaz na video...', 'info');
    
    try {
        // API volání pro získání video URL
        const cleanPath = moviePath.startsWith('/') ? moviePath.substring(1) : moviePath;
        const apiUrl = `/api/video/${cleanPath}`;
        
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        if (data.success && data.videoUrl) {
            await copyToClipboard(data.videoUrl);
            showToast(`📋 Video odkaz zkopírován: ${movieTitle}`, 'success');
        } else {
            throw new Error(data.error || 'Video URL nebylo nalezeno');
        }
        
    } catch (error) {
        console.error('❌ Chyba při kopírování:', error);
        showToast(`❌ Chyba při kopírování: ${error.message}`, 'error');
    }
}

// === FILTROVACÍ SYSTÉM ===

// Hlavní funkce pro aplikování filtrů a řazení
function applyFiltersAndSort(results) {
    let filtered = [...results];
    
    // Aplikovat pouze jazykové filtry a základní filtry
    filtered = filtered.filter(movie => {
        return passesLanguageFilter(movie) && passesAdvancedFilters(movie);
    });
    
    // Aplikovat řazení podle velikosti
    const sizeSelect = document.getElementById('sizeSort');
    const sortType = sizeSelect?.value || 'smart';
    console.log(`🔄 Aplikuji řazení: ${sortType} (element exists: ${!!sizeSelect})`);
    
    if (sortType === 'smart') {
        console.log('🎯 Používám inteligentní řazení');
        // Inteligentní řazení - přidat skóre pro řazení
        filtered = filtered.map(movie => ({
            ...movie,
            score: calculateMovieScore(movie)
        }));
        filtered.sort((a, b) => b.score - a.score);
    } else {
        console.log(`📊 Používám řazení podle velikosti: ${sortType}`);
        // Řazení podle velikosti
        console.log(`📊 Před řazením: ${filtered.length} položek`);
        const sizesDebug = filtered.slice(0, 5).map(movie => ({
            title: movie.title.substring(0, 50),
            size: FILTER_CONFIG.size.parseSize(movie),
            rawSize: movie.size
        }));
        console.log('🔍 Velikosti prvních 5 položek:', sizesDebug);
        
        filtered = applySizeSort(filtered, sortType);
    }
    
    return filtered;
}

// Nová funkce pro řazení podle velikosti
function applySizeSort(results, sortType) {
    console.log(`🔍 applySizeSort called with sortType: ${sortType}, results: ${results.length}`);
    
    if (sortType === 'middle') {
        // Pro střední velikosti nejdříve vypočítáme průměr všech velikostí
        const allSizes = results
            .map(movie => FILTER_CONFIG.size.parseSize(movie))
            .filter(size => size !== null && size > 0)
            .sort((x, y) => x - y);
        
        console.log(`📊 Middle sort - valid sizes found: ${allSizes.length}`, allSizes.slice(0, 10));
        
        if (allSizes.length === 0) {
            console.log('⚠️ No sizes found, returning unsorted results');
            return results;
        }
        
        const minSize = allSizes[0];
        const maxSize = allSizes[allSizes.length - 1];
        const avgSize = (minSize + maxSize) / 2;
        console.log(`📊 Size stats - min: ${minSize}, max: ${maxSize}, avg: ${avgSize}`);
        
        return results.sort((a, b) => {
            const sizeA = FILTER_CONFIG.size.parseSize(a);
            const sizeB = FILTER_CONFIG.size.parseSize(b);
            
            // Pokud nemáme velikost, dáváme na konec
            if (!sizeA && !sizeB) return 0;
            if (!sizeA) return 1;
            if (!sizeB) return -1;
            
            // Seřadit podle vzdálenosti od průměru (nejblíže průměru první)
            const distanceA = Math.abs(sizeA - avgSize);
            const distanceB = Math.abs(sizeB - avgSize);
            return distanceA - distanceB;
        });
    }
    
    // Pro ostatní typy řazení
    console.log(`🔄 Sorting by ${sortType}`);
    
    const sortedResults = results.sort((a, b) => {
        const sizeA = FILTER_CONFIG.size.parseSize(a);
        const sizeB = FILTER_CONFIG.size.parseSize(b);
        
        // Pokud nemáme velikost, dáváme na konec
        if (!sizeA && !sizeB) return 0;
        if (!sizeA) return 1;
        if (!sizeB) return -1;
        
        switch(sortType) {
            case 'largest':
                return sizeB - sizeA; // Od největších
            case 'smallest':
                return sizeA - sizeB; // Od nejmenších
            default:
                return 0;
        }
    });
    
    console.log('✅ Sorting completed');
    return sortedResults;
}

// Kontrola kvality (už nepoužívá se, ale ponechám pro kompatibilitu)
function passesQualityFilter(movie) {
    const qualityFilter = document.getElementById('qualityFilter')?.value || 'balanced';
    if (qualityFilter === 'all') return true;
    
    const quality = detectQuality(movie.title);
    
    switch(qualityFilter) {
        case 'balanced':
            return quality === '720p' || quality === '1080p';
        case 'high':
            return quality === '1080p' || quality === '4k';
        case 'medium':
            return quality === '720p';
        case 'low':
            return quality === '480p' || quality === '360p';
        default:
            return true;
    }
}

// Kontrola veľkosti súboru
function passesSizeFilter(movie) {
    const sizeFilter = document.getElementById('sizeFilter')?.value || 'optimal';
    if (sizeFilter === 'all') return true;
    
    const sizeInMB = FILTER_CONFIG.size.parseSize(movie.title);
    if (!sizeInMB) return true; // Ak nevieme určiť veľkosť, necháme to prejsť
    
    switch(sizeFilter) {
        case 'optimal':
            return sizeInMB >= 1024 && sizeInMB <= 8192; // 1-8 GB
        case 'small':
            return sizeInMB <= 3072; // do 3 GB
        case 'medium':
            return sizeInMB >= 3072 && sizeInMB <= 10240; // 3-10 GB
        case 'large':
            return sizeInMB >= 10240; // 10+ GB
        default:
            return true;
    }
}

// Kontrola jazyka
function passesLanguageFilter(movie) {
    const languageFilter = document.getElementById('languageFilter')?.value || 'preferred';
    if (languageFilter === 'all') return true;
    
    const title = movie.title.toLowerCase();
    
    switch(languageFilter) {
        case 'preferred':
            return FILTER_CONFIG.language.patterns.czech.test(title) ||
                   FILTER_CONFIG.language.patterns.slovak.test(title);
        case 'czech':
            return FILTER_CONFIG.language.patterns.czech.test(title);
        case 'slovak':
            return FILTER_CONFIG.language.patterns.slovak.test(title);
        case 'english':
            return FILTER_CONFIG.language.patterns.english.test(title);
        case 'dubbed':
            return FILTER_CONFIG.language.patterns.dubbed.test(title);
        case 'subtitled':
            return FILTER_CONFIG.language.patterns.subtitled.test(title);
        default:
            return true;
    }
}

// Pokročilé filtry
function passesAdvancedFilters(movie) {
    const hideMultipart = document.getElementById('hideMultipart')?.checked ?? true;
    
    if (hideMultipart) {
        const multipartPattern = /(?:cd[\s]?[12]|part[\s]?[12]|disk[\s]?[12]|část[\s]?[12])/i;
        if (multipartPattern.test(movie.title)) {
            return false;
        }
    }
    
    return true;
}

// Detekcia kvality z názvu
function detectQuality(title) {
    for (const [quality, pattern] of Object.entries(FILTER_CONFIG.quality.patterns)) {
        if (pattern.test(title)) {
            return quality;
        }
    }
    return 'unknown';
}

// Výpočet skóre pre usporiadanie
function calculateMovieScore(movie) {
    let score = 0;
    const title = movie.title;
    
    // Skóre za kvalitu
    const quality = detectQuality(title);
    score += FILTER_CONFIG.quality.scores[quality] || 0;
    
    // Bonus za optimálnu veľkosť
    const sizeInMB = FILTER_CONFIG.size.parseSize(title);
    if (sizeInMB) {
        if (sizeInMB >= 1024 && sizeInMB <= 8192) { // 1-8 GB je ideálne
            score += 3;
        } else if (sizeInMB >= 512 && sizeInMB <= 12288) { // 0.5-12 GB je OK
            score += 1;
        }
    }
    
    // Bonus za slovenštinu/češtinu
    if (FILTER_CONFIG.language.patterns.czech.test(title) || 
        FILTER_CONFIG.language.patterns.slovak.test(title)) {
        score += 2;
    }
    
    // Malus za vícedílné soubory
    const multipartPattern = /(?:cd[\s]?[12]|part[\s]?[12]|disk[\s]?[12])/i;
    if (multipartPattern.test(title)) {
        score -= 1;
    }
    
    // Bonus za HD kvalitu v názvu
    if (/(?:1080p|720p|hd)/i.test(title)) {
        score += 1;
    }
    
    return score;
}

// Přepnutí pokročilých filtrů
function toggleAdvancedFilters() {
    const advancedFilters = document.getElementById('advancedFilters');
    const toggleButton = document.getElementById('advancedToggle');
    
    if (!advancedFilters || !toggleButton) return;
    
    if (advancedFilters.classList.contains('show')) {
        advancedFilters.classList.remove('show');
        toggleButton.innerHTML = '<i class="fas fa-tags me-1"></i>Štítky a filtry';
    } else {
        advancedFilters.classList.add('show');
        toggleButton.innerHTML = '<i class="fas fa-tags fa-spin me-1"></i>Skrýt štítky a filtry';
    }
}

// Helper funkce pro štítky
function getQualityBadge(title) {
    const showQualityTags = document.getElementById('showQualityTags')?.checked ?? true;
    if (!showQualityTags) return '';
    
    const quality = detectQuality(title);
    const badges = {
        '4k': '<span class="badge bg-danger me-1">4K</span>',
        '1080p': '<span class="badge bg-primary me-1">1080p</span>',
        '720p': '<span class="badge bg-info me-1">720p</span>',
        '480p': '<span class="badge bg-secondary me-1">480p</span>',
        '360p': '<span class="badge bg-dark me-1">360p</span>'
    };
    return badges[quality] || '';
}

function getSizeBadge(movie) {
    const showSizeTags = document.getElementById('showSizeTags')?.checked ?? true;
    if (!showSizeTags) return '';
    
    const sizeInMB = FILTER_CONFIG.size.parseSize(movie);
    if (!sizeInMB) return '';
    
    const sizeInGB = (sizeInMB / 1024).toFixed(1);
    let badgeClass = 'secondary';
    
    if (sizeInMB >= 1024 && sizeInMB <= 8192) {
        badgeClass = 'success'; // Optimální velikost
    } else if (sizeInMB < 1024) {
        badgeClass = 'warning'; // Malý soubor
    } else if (sizeInMB > 8192) {
        badgeClass = 'danger'; // Velký soubor
    }
    
    return `<span class="badge bg-${badgeClass} me-1">${sizeInGB}GB</span>`;
}

function getLanguageBadge(title) {
    const badges = [];
    
    if (FILTER_CONFIG.language.patterns.czech.test(title)) {
        badges.push('<span class="badge bg-success me-1">🇨🇿 CZ</span>');
    }
    if (FILTER_CONFIG.language.patterns.slovak.test(title)) {
        badges.push('<span class="badge bg-success me-1">🇸🇰 SK</span>');
    }
    if (FILTER_CONFIG.language.patterns.english.test(title)) {
        badges.push('<span class="badge bg-primary me-1">🇺🇸 EN</span>');
    }
    if (FILTER_CONFIG.language.patterns.dubbed.test(title)) {
        badges.push('<span class="badge bg-warning me-1">🎬 Dabing</span>');
    }
    if (FILTER_CONFIG.language.patterns.subtitled.test(title)) {
        badges.push('<span class="badge bg-info me-1">📝 Titulky</span>');
    }
    
    return badges.join('');
}