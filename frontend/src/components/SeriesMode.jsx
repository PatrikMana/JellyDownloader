import React, { useState } from 'react';
import { searchApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useDownload } from '../context/DownloadContext';
import QualityModal from './QualityModal';

const SeriesMode = ({ isActive }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [imdbResults, setImdbResults] = useState([]);
    const [seriesInfo, setSeriesInfo] = useState(null);
    const [seasons, setSeasons] = useState([]);
    const [selectedEpisodes, setSelectedEpisodes] = useState([]);
    const [expandedSeasons, setExpandedSeasons] = useState({});
    
    // Episode search workflow
    const [searchTitle, setSearchTitle] = useState('');
    const [showTitleModal, setShowTitleModal] = useState(false);
    const [episodeSearchState, setEpisodeSearchState] = useState(null); // { currentIndex, episodes, results }
    const [qualityModal, setQualityModal] = useState({ open: false, episode: null, results: [], loading: false });
    
    // Quality selection for episode
    const [episodeQualityModal, setEpisodeQualityModal] = useState({ open: false, episode: null, result: null, qualities: [], loading: false });
    
    const { showError, showInfo, showWarning, showSuccess } = useToast();
    const { addDownload } = useDownload();

    // Krok 1: Vyhledání seriálu na IMDB
    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;

        setSearching(true);
        setImdbResults([]);
        setSeriesInfo(null);
        setSeasons([]);
        setSelectedEpisodes([]);

        try {
            showInfo('Vyhledávám', `Hledám seriál "${searchQuery}" na IMDB...`);

            const response = await fetch(`/api/imdb/series/search/${encodeURIComponent(searchQuery)}`);
            const data = await response.json();
            
            if (data.success && data.results && data.results.length > 0) {
                setImdbResults(data.results);
                showSuccess('Nalezeno', `${data.results.length} seriálů`);
            } else {
                showWarning('Nenalezeno', 'Žádný seriál nebyl nalezen na IMDB');
            }

        } catch (error) {
            showError('Chyba', error.message);
        } finally {
            setSearching(false);
        }
    };

    // Krok 2: Výběr seriálu a načtení sezón
    const selectSeries = async (series) => {
        try {
            showInfo('Načítám', `Načítám sezóny pro ${series.Title}...`);

            // Get seasons with episodes
            const response = await fetch(`/api/imdb/series/${series.imdbID}/seasons`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Nepodařilo se načíst sezóny');
            }

            setSeriesInfo({
                title: series.Title,
                year: series.Year,
                poster: series.Poster,
                imdbId: series.imdbID,
                totalSeasons: data.totalSeasons
            });

            const formattedSeasons = data.seasons.map(s => ({
                number: s.season,
                episodes: s.episodes.map(ep => ({
                    episodeNumber: parseInt(ep.Episode),
                    title: ep.Title,
                    imdbId: ep.imdbID,
                    rating: ep.imdbRating
                }))
            }));

            setSeasons(formattedSeasons);
            setImdbResults([]); // Hide search results
            showSuccess('Načteno', `${data.seasons.length} sezón`);

        } catch (error) {
            showError('Chyba', error.message);
        }
    };

    const toggleSeason = (seasonNumber) => {
        setExpandedSeasons(prev => ({
            ...prev,
            [seasonNumber]: !prev[seasonNumber]
        }));
    };

    const toggleSeasonSelection = (seasonNumber) => {
        const season = seasons.find(s => s.number === seasonNumber);
        if (!season) return;

        const seasonEpisodeIds = season.episodes.map(ep => `S${seasonNumber}E${ep.episodeNumber}`);
        const allSelected = seasonEpisodeIds.every(id => selectedEpisodes.includes(id));

        if (allSelected) {
            setSelectedEpisodes(prev => prev.filter(id => !seasonEpisodeIds.includes(id)));
        } else {
            setSelectedEpisodes(prev => [...new Set([...prev, ...seasonEpisodeIds])]);
            // Expand season when selecting
            setExpandedSeasons(prev => ({ ...prev, [seasonNumber]: true }));
        }
    };

    const toggleEpisodeSelection = (seasonNumber, episodeNumber) => {
        const id = `S${seasonNumber}E${episodeNumber}`;
        setSelectedEpisodes(prev => 
            prev.includes(id) 
                ? prev.filter(e => e !== id)
                : [...prev, id]
        );
    };

    const isSeasonSelected = (seasonNumber) => {
        const season = seasons.find(s => s.number === seasonNumber);
        if (!season || season.episodes.length === 0) return false;
        return season.episodes.every(ep => 
            selectedEpisodes.includes(`S${seasonNumber}E${ep.episodeNumber}`)
        );
    };

    const isSeasonPartiallySelected = (seasonNumber) => {
        const season = seasons.find(s => s.number === seasonNumber);
        if (!season) return false;
        const selected = season.episodes.filter(ep => 
            selectedEpisodes.includes(`S${seasonNumber}E${ep.episodeNumber}`)
        ).length;
        return selected > 0 && selected < season.episodes.length;
    };

    const selectAllEpisodes = () => {
        const allIds = seasons.flatMap(s => 
            s.episodes.map(ep => `S${s.number}E${ep.episodeNumber}`)
        );
        setSelectedEpisodes(allIds);
    };

    const deselectAllEpisodes = () => {
        setSelectedEpisodes([]);
    };

    // Krok 3: Před vyhledáváním - zobraz dialog pro název
    const proceedToSearch = async () => {
        if (selectedEpisodes.length === 0) {
            showWarning('Nic nevybráno', 'Vyber alespoň jednu epizodu');
            return;
        }

        // Try to get Czech title from TMDB
        let czechTitle = seriesInfo.title;
        try {
            showInfo('TMDB', 'Hledám český název...');
            const response = await fetch(`/api/tmdb/czech-title/${seriesInfo.imdbId}`);
            const data = await response.json();
            if (data.success && data.czechTitle) {
                czechTitle = data.czechTitle;
                showInfo('TMDB', `Český název: ${czechTitle}`);
            }
        } catch (e) {
            console.warn('Could not get Czech title:', e);
        }

        setSearchTitle(czechTitle);
        setShowTitleModal(true);
    };

    // Krok 4: Zahájení vyhledávání epizod
    const startEpisodeSearch = async (title) => {
        setShowTitleModal(false);
        
        // Parse selected episodes into array
        const episodes = selectedEpisodes.map(id => {
            const match = id.match(/S(\d+)E(\d+)/);
            return {
                id,
                season: parseInt(match[1]),
                episode: parseInt(match[2]),
                title: seasons.find(s => s.number === parseInt(match[1]))
                    ?.episodes.find(e => e.episodeNumber === parseInt(match[2]))?.title || ''
            };
        }).sort((a, b) => a.season !== b.season ? a.season - b.season : a.episode - b.episode);

        setEpisodeSearchState({
            searchTitle: title,
            episodes,
            currentIndex: 0,
            results: {} // { episodeId: { selectedUrl, prehrajtoResults } }
        });

        // Search first episode
        await searchEpisode(title, episodes[0], 0, episodes.length);
    };

    // Vyhledání jednotlivé epizody
    const searchEpisode = async (searchTitle, episode, index, total) => {
        const seasonStr = String(episode.season).padStart(2, '0');
        const episodeStr = String(episode.episode).padStart(2, '0');
        const query = `${searchTitle} s${seasonStr}e${episodeStr}`;

        showInfo('Vyhledávám', `${episode.id} (${index + 1}/${total})`);

        try {
            const response = await fetch(`/api/search/${encodeURIComponent(query)}`);
            const data = await response.json();

            if (data.success && data.results && data.results.length > 0) {
                // Show quality selection for this episode
                setQualityModal({
                    open: true,
                    episode: { ...episode, searchQuery: query },
                    results: data.results.slice(0, 10),
                    loading: false
                });
            } else {
                // No results - show modal to skip or retry
                setQualityModal({
                    open: true,
                    episode: { ...episode, searchQuery: query },
                    results: [],
                    loading: false
                });
            }
        } catch (error) {
            showError('Chyba', `Nepodařilo se vyhledat ${episode.id}`);
            skipEpisode();
        }
    };

    // Výběr souboru pro epizodu - zobrazí výběr kvality
    const selectEpisodeFile = async (result) => {
        const episode = qualityModal.episode;
        setEpisodeQualityModal({ open: true, episode, result, qualities: [], loading: true });

        try {
            // Get video URL and qualities
            let videoPath = result.href;
            if (videoPath.startsWith('/')) videoPath = videoPath.substring(1);

            const response = await fetch(`/api/video/${videoPath}`);
            const data = await response.json();

            if (!data.success || !data.qualities) {
                throw new Error('Nepodařilo se načíst kvality');
            }

            setEpisodeQualityModal(prev => ({
                ...prev,
                qualities: data.qualities,
                loading: false
            }));
        } catch (error) {
            showError('Chyba', error.message);
            setEpisodeQualityModal({ open: false, episode: null, result: null, qualities: [], loading: false });
        }
    };
    
    // Potvrzení výběru kvality pro epizodu
    const confirmEpisodeQuality = (selectedQuality) => {
        const { episode, result } = episodeQualityModal;
        
        // Store selection and move to next episode
        setEpisodeSearchState(prev => ({
            ...prev,
            results: {
                ...prev.results,
                [episode.id]: {
                    selectedUrl: selectedQuality.src,
                    selectedQuality: selectedQuality,
                    qualities: episodeQualityModal.qualities,
                    prehrajtoTitle: result.title,
                    prehrajtoHref: result.href,
                    imageSrc: result.imageSrc
                }
            },
            currentIndex: prev.currentIndex + 1
        }));

        setEpisodeQualityModal({ open: false, episode: null, result: null, qualities: [], loading: false });
        setQualityModal({ open: false, episode: null, results: [], loading: false });

        // Search next episode or finish
        const nextIndex = episodeSearchState.currentIndex + 1;
        if (nextIndex < episodeSearchState.episodes.length) {
            searchEpisode(
                episodeSearchState.searchTitle,
                episodeSearchState.episodes[nextIndex],
                nextIndex,
                episodeSearchState.episodes.length
            );
        } else {
            showSuccess('Hotovo', 'Všechny epizody vyhledány');
        }
    };

    const skipEpisode = () => {
        setQualityModal({ open: false, episode: null, results: [], loading: false });
        setEpisodeQualityModal({ open: false, episode: null, result: null, qualities: [], loading: false });

        setEpisodeSearchState(prev => ({
            ...prev,
            currentIndex: prev.currentIndex + 1
        }));

        const nextIndex = episodeSearchState.currentIndex + 1;
        if (nextIndex < episodeSearchState.episodes.length) {
            searchEpisode(
                episodeSearchState.searchTitle,
                episodeSearchState.episodes[nextIndex],
                nextIndex,
                episodeSearchState.episodes.length
            );
        } else {
            showSuccess('Hotovo', 'Vyhledávání dokončeno');
        }
    };

    // Stažení všech vybraných epizod
    const downloadAllSelected = async () => {
        const results = episodeSearchState.results;
        const selectedCount = Object.keys(results).length;

        if (selectedCount === 0) {
            showWarning('Nic ke stažení', 'Nevybrali jste žádné epizody');
            return;
        }

        showInfo('Zahajuji stahování', `${selectedCount} epizod`);

        // Get series IMDB data
        let seriesImdbData = null;
        try {
            const response = await fetch(`/api/imdb/series/${seriesInfo.imdbId}`);
            const data = await response.json();
            if (data.success) seriesImdbData = data.data;
        } catch (e) {}

        // Prepare download data
        const downloadData = {
            seriesTitle: seriesInfo.title,
            seriesImdbId: seriesInfo.imdbId,
            seriesImdbData: seriesImdbData,
            episodes: Object.entries(results).map(([episodeId, data]) => {
                const match = episodeId.match(/S(\d+)E(\d+)/);
                return {
                    season: parseInt(match[1]),
                    episode: parseInt(match[2]),
                    episodeTitle: episodeSearchState.episodes.find(e => e.id === episodeId)?.title || '',
                    prehrajtoTitle: data.prehrajtoTitle,
                    videoUrl: data.selectedUrl,
                    quality: data.selectedQuality?.label || 'Default'
                };
            })
        };

        try {
            const response = await fetch('/api/download/series', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(downloadData)
            });

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Stahování selhalo');
            }
            
            // Add to download HUD for progress tracking
            addDownload({
                downloadId: result.jobId,
                title: `${seriesInfo.title} (${selectedCount} epizod)`,
                size: 0,
                type: 'series'
            });

            showSuccess('Stahování zahájeno', `${selectedCount} epizod`);
            
            // Reset state
            setEpisodeSearchState(null);
            setSelectedEpisodes([]);

        } catch (error) {
            showError('Chyba', error.message);
        }
    };

    if (!isActive) return null;

    return (
        <section className="download-section active" id="series-section">
            <div className="container">
                <h2 className="step-title">Stáhnout seriál</h2>

                {/* Search Box */}
                <div className="search-box">
                    <div className="search-header">
                        <div className="search-icon"><i className="fas fa-tv"></i></div>
                        <div className="search-title">Vyhledej seriál na IMDB</div>
                    </div>
                    <form className="search-form" onSubmit={handleSearch}>
                        <div className="search-input-wrapper">
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Název seriálu (např. Breaking Bad, Friends...)"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                disabled={searching}
                            />
                            <button type="submit" className="btn btn-primary search-btn" disabled={searching || !searchQuery.trim()}>
                                {searching ? (
                                    <><i className="fas fa-spinner fa-spin"></i> Hledám...</>
                                ) : (
                                    <><i className="fas fa-search"></i> Hledat</>
                                )}
                            </button>
                        </div>
                    </form>
                </div>

                {/* IMDB Search Results */}
                {imdbResults.length > 0 && (
                    <div className="series-search-results">
                        <h3>Výsledky z IMDB</h3>
                        <div className="series-cards">
                            {imdbResults.map(series => (
                                <div key={series.imdbID} className="series-card" onClick={() => selectSeries(series)}>
                                    <div className="series-poster">
                                        {series.Poster && series.Poster !== 'N/A' ? (
                                            <img src={series.Poster} alt={series.Title} />
                                        ) : (
                                            <i className="fas fa-tv"></i>
                                        )}
                                    </div>
                                    <div className="series-info">
                                        <h4>{series.Title}</h4>
                                        <p>{series.Year}</p>
                                        <button className="btn btn-primary btn-sm">Vybrat</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Series Info & Season Tree */}
                {seriesInfo && (
                    <div className="series-detail">
                        <div className="series-header-card">
                            <div className="series-poster">
                                {seriesInfo.poster && seriesInfo.poster !== 'N/A' ? (
                                    <img src={seriesInfo.poster} alt={seriesInfo.title} />
                                ) : (
                                    <i className="fas fa-tv"></i>
                                )}
                            </div>
                            <div className="series-info">
                                <h3>{seriesInfo.title}</h3>
                                <p>{seriesInfo.year} • {seriesInfo.totalSeasons} sezón</p>
                                <p className="imdb-id">IMDB: {seriesInfo.imdbId}</p>
                            </div>
                        </div>

                        {/* Selection Actions */}
                        <div className="selection-actions">
                            <button className="btn btn-secondary" onClick={selectAllEpisodes}>
                                <i className="fas fa-check-double"></i> Vybrat vše
                            </button>
                            <button className="btn btn-secondary" onClick={deselectAllEpisodes}>
                                <i className="fas fa-times"></i> Zrušit výběr
                            </button>
                            {selectedEpisodes.length > 0 && (
                                <span className="selection-count">{selectedEpisodes.length} epizod vybráno</span>
                            )}
                        </div>

                        {/* Season Tree */}
                        <div className="season-tree">
                            {seasons.map(season => (
                                <div key={season.number} className="season-item">
                                    <div className="season-header" onClick={() => toggleSeason(season.number)}>
                                        <div 
                                            className={`season-checkbox ${isSeasonSelected(season.number) ? 'checked' : ''} ${isSeasonPartiallySelected(season.number) ? 'partial' : ''}`}
                                            onClick={(e) => { e.stopPropagation(); toggleSeasonSelection(season.number); }}
                                        >
                                            <i className={`fas ${isSeasonPartiallySelected(season.number) ? 'fa-minus' : 'fa-check'}`}></i>
                                        </div>
                                        <div className={`season-toggle ${expandedSeasons[season.number] ? 'expanded' : ''}`}>
                                            <i className="fas fa-chevron-right"></i>
                                        </div>
                                        <span className="season-name">Sezóna {season.number}</span>
                                        <span className="season-count">{season.episodes.length} epizod</span>
                                    </div>
                                    
                                    <div className={`episodes-list ${expandedSeasons[season.number] ? 'expanded' : ''}`}>
                                        {season.episodes.map(episode => (
                                            <div 
                                                key={episode.episodeNumber}
                                                className={`episode-item ${selectedEpisodes.includes(`S${season.number}E${episode.episodeNumber}`) ? 'selected' : ''}`}
                                                onClick={() => toggleEpisodeSelection(season.number, episode.episodeNumber)}
                                            >
                                                <div className={`episode-checkbox ${selectedEpisodes.includes(`S${season.number}E${episode.episodeNumber}`) ? 'checked' : ''}`}>
                                                    <i className="fas fa-check"></i>
                                                </div>
                                                <span className="episode-number">E{episode.episodeNumber}</span>
                                                <span className="episode-name">{episode.title || `Epizoda ${episode.episodeNumber}`}</span>
                                                {episode.rating && episode.rating !== 'N/A' && (
                                                    <span className="episode-rating"><i className="fas fa-star"></i> {episode.rating}</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Proceed Button */}
                        {selectedEpisodes.length > 0 && !episodeSearchState && (
                            <div className="proceed-section">
                                <button className="btn btn-primary btn-lg" onClick={proceedToSearch}>
                                    <i className="fas fa-search"></i>
                                    Vyhledat {selectedEpisodes.length} epizod na prehrajto.cz
                                </button>
                            </div>
                        )}

                        {/* Episode Search Results */}
                        {episodeSearchState && Object.keys(episodeSearchState.results).length > 0 && (
                            <div className="episode-results-section">
                                <h3>Vybrané epizody ({Object.keys(episodeSearchState.results).length})</h3>
                                <div className="episode-results-list">
                                    {Object.entries(episodeSearchState.results).map(([episodeId, data]) => (
                                        <div key={episodeId} className="episode-result-item">
                                            <span className="episode-badge">{episodeId}</span>
                                            <span className="episode-source">{data.prehrajtoTitle}</span>
                                            <i className="fas fa-check" style={{ color: 'var(--color-glitch-green)' }}></i>
                                        </div>
                                    ))}
                                </div>
                                <button className="btn btn-primary btn-lg" onClick={downloadAllSelected}>
                                    <i className="fas fa-download"></i>
                                    Stáhnout {Object.keys(episodeSearchState.results).length} epizod
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Search Title Modal */}
                {showTitleModal && (
                    <div className="modal-overlay quality-modal active" onClick={() => setShowTitleModal(false)}>
                        <div className="modal" onClick={e => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3><i className="fas fa-search"></i> Název pro vyhledávání</h3>
                                <button className="modal-close" onClick={() => setShowTitleModal(false)}>
                                    <i className="fas fa-times"></i>
                                </button>
                            </div>
                            <div className="modal-body">
                                <p>Zadejte název seriálu pro vyhledávání na prehrajto.cz:</p>
                                <input
                                    type="text"
                                    className="search-input"
                                    value={searchTitle}
                                    onChange={(e) => setSearchTitle(e.target.value)}
                                    style={{ width: '100%', marginTop: 'var(--spacing-sm)' }}
                                />
                                <div style={{ marginTop: 'var(--spacing-sm)', display: 'flex', gap: 'var(--spacing-xs)' }}>
                                    <button 
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setSearchTitle(seriesInfo.title)}
                                    >
                                        {seriesInfo.title}
                                    </button>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button className="btn btn-secondary" onClick={() => setShowTitleModal(false)}>Zrušit</button>
                                <button className="btn btn-primary" onClick={() => startEpisodeSearch(searchTitle)}>
                                    <i className="fas fa-search"></i> Pokračovat
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Episode Quality Modal */}
                {qualityModal.open && (
                    <div className="modal-overlay quality-modal active episode-select-modal" onClick={() => {}}>
                        <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3><i className="fas fa-film"></i> {qualityModal.episode?.id}</h3>
                            </div>
                            <div className="modal-body">
                                {qualityModal.loading ? (
                                    <div style={{ textAlign: 'center', padding: 'var(--spacing-lg)' }}>
                                        <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem' }}></i>
                                        <p>Načítám kvalitu...</p>
                                    </div>
                                ) : qualityModal.results.length > 0 ? (
                                    <div className="episode-results-grid">
                                        <p style={{ marginBottom: 'var(--spacing-sm)', color: 'var(--color-text-muted)', gridColumn: '1 / -1' }}>
                                            Hledáno: {qualityModal.episode?.searchQuery}
                                        </p>
                                        {qualityModal.results.map((result, idx) => {
                                            // Parse quality from title
                                            const getQualities = (title) => {
                                                const qualities = [];
                                                if (/4k|2160p|uhd/i.test(title)) qualities.push('4K');
                                                if (/1080p/i.test(title)) qualities.push('1080p');
                                                if (/720p/i.test(title)) qualities.push('720p');
                                                if (/480p/i.test(title)) qualities.push('480p');
                                                return qualities;
                                            };
                                            const qualities = getQualities(result.title);
                                            
                                            return (
                                                <div
                                                    key={idx}
                                                    className="episode-result-card"
                                                    onClick={() => selectEpisodeFile(result)}
                                                >
                                                    <div className="episode-card-image">
                                                        {result.imageSrc ? (
                                                            <img src={result.imageSrc} alt={result.title} />
                                                        ) : (
                                                            <i className="fas fa-film"></i>
                                                        )}
                                                    </div>
                                                    <div className="episode-card-content">
                                                        <h4 className="episode-card-title">{result.title}</h4>
                                                        <div className="episode-card-meta">
                                                            {qualities.map(q => (
                                                                <span key={q} className="result-badge quality-badge">{q}</span>
                                                            ))}
                                                            {result.size && (
                                                                <span className="result-badge size-badge">{result.size}</span>
                                                            )}
                                                            {result.duration && (
                                                                <span className="result-badge">{result.duration}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div style={{ textAlign: 'center', padding: 'var(--spacing-lg)' }}>
                                        <i className="fas fa-exclamation-triangle" style={{ fontSize: '2rem', color: 'var(--color-warning)' }}></i>
                                        <p>Epizoda nebyla nalezena na prehrajto.cz</p>
                                        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                                            Hledáno: {qualityModal.episode?.searchQuery}
                                        </p>
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button className="btn btn-secondary" onClick={skipEpisode}>
                                    <i className="fas fa-forward"></i> Přeskočit
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                
                {/* Episode Quality Selection Modal */}
                {episodeQualityModal.open && (
                    <div className="modal-overlay quality-modal active" onClick={() => {}}>
                        <div className="modal" onClick={e => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3><i className="fas fa-cog"></i> Vybrat kvalitu - {episodeQualityModal.episode?.id}</h3>
                            </div>
                            <div className="modal-body">
                                {episodeQualityModal.loading ? (
                                    <div style={{ textAlign: 'center', padding: 'var(--spacing-lg)' }}>
                                        <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: 'var(--color-glitch-cyan)' }}></i>
                                        <p style={{ marginTop: 'var(--spacing-sm)' }}>Načítám dostupné kvality...</p>
                                    </div>
                                ) : episodeQualityModal.qualities.length > 0 ? (
                                    <div className="quality-options">
                                        {episodeQualityModal.qualities.map((quality, idx) => (
                                            <div
                                                key={idx}
                                                className="quality-option"
                                                onClick={() => confirmEpisodeQuality(quality)}
                                            >
                                                <div className="quality-info">
                                                    <div className="quality-name">
                                                        {quality.label || `${quality.res}p` || 'Video'}
                                                    </div>
                                                    <div className="quality-meta">
                                                        {quality.res > 0 && <span>{quality.res}p</span>}
                                                    </div>
                                                </div>
                                                {idx === 0 && (
                                                    <span className="quality-best-badge">Nejvyšší</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ textAlign: 'center', padding: 'var(--spacing-md)' }}>
                                        <i className="fas fa-exclamation-triangle" style={{ color: 'var(--color-warning)' }}></i>
                                        <p>Nepodařilo se načíst kvality</p>
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button className="btn btn-secondary" onClick={() => {
                                    setEpisodeQualityModal({ open: false, episode: null, result: null, qualities: [], loading: false });
                                }}>
                                    <i className="fas fa-arrow-left"></i> Zpět
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
};

export default SeriesMode;
