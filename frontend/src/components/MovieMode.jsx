import React, { useState, useMemo, useRef } from 'react';
import { searchApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useDownload } from '../context/DownloadContext';
import QualityModal from './QualityModal';

const MovieMode = ({ isActive }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState([]);
    const [selectedItems, setSelectedItems] = useState([]);
    const [sortBy, setSortBy] = useState('smart');
    const [qualityModal, setQualityModal] = useState({ open: false, movie: null, loading: false });
    const { showError, showInfo, showWarning, showSuccess } = useToast();
    const { startDownload } = useDownload();
    
    // Store last search query for IMDB lookup
    const lastSearchQueryRef = useRef('');

    // Parse file size to MB for sorting
    const parseFileSize = (sizeStr) => {
        if (!sizeStr) return 0;
        const match = sizeStr.match(/([\d.,]+)\s*(B|KB|MB|GB|TB)/i);
        if (!match) return 0;
        const value = parseFloat(match[1].replace(',', '.'));
        const unit = match[2].toUpperCase();
        const multipliers = { B: 1/(1024*1024), KB: 1/1024, MB: 1, GB: 1024, TB: 1024*1024 };
        return value * (multipliers[unit] || 1);
    };

    // Sort results
    const processedResults = useMemo(() => {
        let filtered = [...results];

        // Sort results
        filtered.sort((a, b) => {
            const sizeA = a.sizeNumeric || parseFileSize(a.size);
            const sizeB = b.sizeNumeric || parseFileSize(b.size);
            
            switch (sortBy) {
                case 'largest': return sizeB - sizeA;
                case 'smallest': return sizeA - sizeB;
                case 'smart':
                default:
                    // Smart sort: quality scoring
                    let scoreA = 0, scoreB = 0;
                    
                    // Size score (1-8GB is optimal)
                    if (sizeA >= 1024 && sizeA <= 8192) scoreA += 3;
                    if (sizeB >= 1024 && sizeB <= 8192) scoreB += 3;
                    
                    // Quality patterns
                    const titleA = a.title || '';
                    const titleB = b.title || '';
                    
                    if (/4k|2160p|uhd/i.test(titleA)) scoreA += 5;
                    if (/4k|2160p|uhd/i.test(titleB)) scoreB += 5;
                    if (/1080p|full.*hd|fhd/i.test(titleA)) scoreA += 4;
                    if (/1080p|full.*hd|fhd/i.test(titleB)) scoreB += 4;
                    if (/720p|hd(?!.*1080)/i.test(titleA)) scoreA += 3;
                    if (/720p|hd(?!.*1080)/i.test(titleB)) scoreB += 3;
                    
                    return scoreB - scoreA;
            }
        });

        return filtered;
    }, [results, sortBy]);

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;

        setSearching(true);
        setResults([]);
        setSelectedItems([]);
        
        // Store the original search query
        lastSearchQueryRef.current = searchQuery.trim();

        try {
            showInfo('Vyhledávám', `Hledám "${searchQuery}" na prehrajto.cz...`);
            
            // KROK 1: Najdi originální název přes TMDB
            let imdbData = null;
            let originalTitle = searchQuery.trim();
            
            try {
                showInfo('TMDB', 'Hledám originální název...');
                const tmdbResult = await searchApi.translateTitle(searchQuery);
                
                if (tmdbResult.success && tmdbResult.originalTitle) {
                    originalTitle = tmdbResult.originalTitle;
                    showInfo('TMDB', `Originální název: ${originalTitle}`);
                    
                    // Pokud TMDB vrátil IMDB ID, použij ho
                    if (tmdbResult.imdbId) {
                        try {
                            const response = await fetch(`/api/imdb-by-id/${tmdbResult.imdbId}`);
                            const data = await response.json();
                            if (data.success && data.data) {
                                imdbData = data.data;
                                showSuccess('IMDB', `Nalezen: ${imdbData.Title} (${imdbData.Year})`);
                            }
                        } catch (e) {
                            console.warn('IMDB by ID lookup failed:', e);
                        }
                    }
                }
            } catch (e) {
                console.warn('TMDB translation failed:', e);
            }
            
            // KROK 2: Pokud nemáme IMDB data, zkus hledat podle názvu
            if (!imdbData) {
                try {
                    showInfo('IMDB', 'Hledám metadata...');
                    const imdbResult = await searchApi.searchIMDBMovie(originalTitle);
                    if (imdbResult.success && imdbResult.data) {
                        imdbData = imdbResult.data;
                        showSuccess('IMDB', `Nalezen: ${imdbData.Title} (${imdbData.Year})`);
                    }
                } catch (e) {
                    console.warn('IMDB lookup failed:', e);
                }
            }

            // KROK 3: Hledej na prehrajto
            const data = await searchApi.searchPrehrajto(searchQuery);
            
            if (data.results && data.results.length > 0) {
                // Transform results to include IMDB data
                const transformedResults = data.results.map(result => ({
                    ...result,
                    url: result.href,
                    poster: result.imageSrc,
                    imdbData: imdbData,
                    imdbId: imdbData?.imdbID,
                    imdbTitle: imdbData?.Title,
                    year: imdbData?.Year,
                    rating: imdbData?.imdbRating,
                    genres: imdbData?.Genre
                }));

                setResults(transformedResults);
                
                showSuccess('Nalezeno', `${transformedResults.length} výsledků`);
            } else {
                showWarning('Nenalezeno', 'Žádné výsledky pro tento dotaz');
            }
        } catch (error) {
            showError('Chyba vyhledávání', error.message);
        } finally {
            setSearching(false);
        }
    };

    const toggleSelection = (index) => {
        setSelectedItems(prev => 
            prev.includes(index) 
                ? prev.filter(i => i !== index)
                : [...prev, index]
        );
    };

    const handleDownloadSelected = async () => {
        if (selectedItems.length === 0) {
            showWarning('Nic nevybráno', 'Vyber alespoň jeden soubor ke stažení');
            return;
        }

        const movie = processedResults[selectedItems[0]];
        await openQualityModal(movie);
    };

    const openQualityModal = async (movie) => {
        // Show modal with loading state
        setQualityModal({ open: true, movie: { ...movie, qualities: [] }, loading: true });

        try {
            // Get video path from href
            let moviePath = movie.href;
            if (moviePath.startsWith('/')) {
                moviePath = moviePath.substring(1);
            }

            // Fetch available qualities
            const response = await fetch(`/api/video/${moviePath}`);
            if (!response.ok) {
                throw new Error('Nepodařilo se načíst kvality');
            }
            const data = await response.json();

            if (!data.success || !data.qualities) {
                throw new Error('Žádné kvality nejsou dostupné');
            }

            // Update modal with qualities
            setQualityModal({ 
                open: true, 
                movie: { 
                    ...movie, 
                    qualities: data.qualities,
                    videoUrl: data.videoUrl 
                }, 
                loading: false 
            });
        } catch (error) {
            showError('Chyba', error.message);
            setQualityModal({ open: false, movie: null, loading: false });
        }
    };

    const handleQualitySelect = async (movie, selectedQuality) => {
        setQualityModal({ open: false, movie: null, loading: false });
        
        try {
            // Připrav imdbData pro backend
            const imdbData = movie.imdbData || (movie.imdbId ? {
                imdbID: movie.imdbId,
                Title: movie.imdbTitle || movie.title,
                Year: movie.year,
                Genre: movie.genres
            } : null);
            
            await startDownload({
                url: movie.href,
                videoUrl: selectedQuality.src,
                title: movie.title,
                size: parseFileSize(movie.size),
                type: 'movie',
                imdbData: imdbData,
                quality: selectedQuality.label,
                originalQuery: lastSearchQueryRef.current
            }, 'movie');
        } catch (error) {
            // Error handled in startDownload
        }
        setSelectedItems([]);
    };

    const handlePreview = async (movie) => {
        // Show modal with loading state
        setQualityModal({ open: true, movie: { ...movie, qualities: [], isPreview: true }, loading: true });

        try {
            let moviePath = movie.href;
            if (moviePath.startsWith('/')) {
                moviePath = moviePath.substring(1);
            }

            const response = await fetch(`/api/video/${moviePath}`);
            if (!response.ok) {
                throw new Error('Nepodařilo se načíst video');
            }
            const data = await response.json();

            if (!data.success || !data.qualities) {
                throw new Error('Video není dostupné');
            }

            // Update modal with qualities for preview
            setQualityModal({ 
                open: true, 
                movie: { 
                    ...movie, 
                    qualities: data.qualities,
                    videoUrl: data.videoUrl,
                    isPreview: true
                }, 
                loading: false 
            });
        } catch (error) {
            showError('Chyba', error.message);
            setQualityModal({ open: false, movie: null, loading: false });
        }
    };

    const handlePreviewSelect = (movie, selectedQuality) => {
        // Open video in new window
        window.open(selectedQuality.src, '_blank');
        setQualityModal({ open: false, movie: null, loading: false });
    };

    // Quality badge
    const getQualityBadge = (title) => {
        if (/4k|2160p|uhd/i.test(title)) return { label: '4K', color: 'var(--color-glitch-cyan)' };
        if (/1080p|full.*hd|fhd/i.test(title)) return { label: '1080p', color: 'var(--color-glitch-green)' };
        if (/720p|hd(?!.*1080)/i.test(title)) return { label: '720p', color: 'var(--color-glitch-cyan)' };
        if (/480p|sd|dvd/i.test(title)) return { label: '480p', color: 'var(--color-text-secondary)' };
        return null;
    };

    // Get available qualities from title
    const getAvailableQualities = (title) => {
        const qualities = [];
        if (/4k|2160p|uhd/i.test(title)) qualities.push('4K');
        if (/1080p|full.*hd|fhd/i.test(title)) qualities.push('1080p');
        if (/720p/i.test(title)) qualities.push('720p');
        if (/480p|sd|dvd/i.test(title)) qualities.push('480p');
        // If no quality detected, return empty
        return qualities;
    };

    if (!isActive) return null;

    return (
        <section className="download-section active" id="movie-section">
            <div className="container">
                <h2 className="step-title">Stáhnout film</h2>

                {/* Search Box */}
                <div className="search-box">
                    <div className="search-header">
                        <div className="search-icon">
                            <i className="fas fa-film"></i>
                        </div>
                        <div className="search-title">Vyhledej film na prehrajto.cz</div>
                    </div>
                    
                    <form onSubmit={handleSearch} className="search-form">
                        <div className="search-input-wrapper">
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Název filmu (např. Titanic, Matrix...)"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                disabled={searching}
                            />
                            <button 
                                type="submit" 
                                className="btn btn-primary search-btn"
                                disabled={searching || !searchQuery.trim()}
                            >
                                {searching ? (
                                    <><i className="fas fa-spinner fa-spin"></i> Hledám...</>
                                ) : (
                                    <><i className="fas fa-search"></i> Hledat</>
                                )}
                            </button>
                        </div>
                    </form>

                    {/* Sort Filter */}
                    <div className="filter-row">
                        <div className="filter-group">
                            <label>Řazení:</label>
                            <select 
                                className="filter-select"
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                            >
                                <option value="smart">Chytré (kvalita)</option>
                                <option value="largest">Největší</option>
                                <option value="smallest">Nejmenší</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* IMDB Info Banner */}
                {results.length > 0 && results[0].imdbData && (
                    <div className="imdb-info-banner">
                        <div className="imdb-badge">
                            <i className="fab fa-imdb"></i>
                            <span>{results[0].imdbData.Title} ({results[0].imdbData.Year})</span>
                        </div>
                        {results[0].imdbData.imdbRating && (
                            <div className="imdb-rating">
                                <i className="fas fa-star"></i>
                                <span>{results[0].imdbData.imdbRating}</span>
                            </div>
                        )}
                        {results[0].imdbData.Genre && (
                            <div className="imdb-genre">{results[0].imdbData.Genre}</div>
                        )}
                    </div>
                )}

                {/* Results */}
                {processedResults.length > 0 && (
                    <div className="results-section">
                        <div className="results-header">
                            <span className="results-count">{processedResults.length} výsledků</span>
                            {selectedItems.length > 0 && (
                                <button 
                                    className="btn btn-primary"
                                    onClick={handleDownloadSelected}
                                >
                                    <i className="fas fa-download"></i>
                                    Stáhnout vybrané ({selectedItems.length})
                                </button>
                            )}
                        </div>

                        <div className="results-grid">
                            {processedResults.map((movie, index) => {
                                const qualities = getAvailableQualities(movie.title);
                                const sizeMB = parseFileSize(movie.size);
                                const sizeGB = (sizeMB / 1024).toFixed(1);

                                return (
                                    <div 
                                        key={index} 
                                        className={`result-card ${selectedItems.includes(index) ? 'selected' : ''}`}
                                        onClick={() => toggleSelection(index)}
                                    >
                                        <div className="result-checkbox">
                                            <input 
                                                type="checkbox" 
                                                checked={selectedItems.includes(index)}
                                                onChange={() => {}}
                                            />
                                        </div>
                                        
                                        <div className="result-image">
                                            {movie.imageSrc ? (
                                                <img src={movie.imageSrc} alt={movie.title} />
                                            ) : (
                                                <i className="fas fa-film"></i>
                                            )}
                                        </div>
                                        
                                        <div className="result-content">
                                            <h4 className="result-title">{movie.title}</h4>
                                            <div className="result-meta">
                                                {qualities.length > 0 && qualities.map(q => (
                                                    <span key={q} className="result-badge quality-badge">{q}</span>
                                                ))}
                                                {sizeMB > 0 && (
                                                    <span className="result-badge size-badge">{sizeGB} GB</span>
                                                )}
                                                {movie.duration && (
                                                    <span className="result-badge">{movie.duration}</span>
                                                )}
                                            </div>
                                            <div className="result-actions" onClick={e => e.stopPropagation()}>
                                                <button 
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => handlePreview(movie)}
                                                >
                                                    <i className="fas fa-play"></i> Náhled
                                                </button>
                                                <button 
                                                    className="btn btn-primary btn-sm"
                                                    onClick={() => openQualityModal(movie)}
                                                >
                                                    <i className="fas fa-download"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Empty state */}
                {!searching && results.length === 0 && searchQuery && (
                    <div className="empty-state">
                        <i className="fas fa-search"></i>
                        <p>Žádné výsledky pro "{searchQuery}"</p>
                    </div>
                )}
            </div>

            {/* Quality Modal */}
            <QualityModal
                isOpen={qualityModal.open}
                movie={qualityModal.movie}
                loading={qualityModal.loading}
                onClose={() => setQualityModal({ open: false, movie: null, loading: false })}
                onSelect={qualityModal.movie?.isPreview ? handlePreviewSelect : handleQualitySelect}
                isPreview={qualityModal.movie?.isPreview}
            />
        </section>
    );
};

export default MovieMode;
