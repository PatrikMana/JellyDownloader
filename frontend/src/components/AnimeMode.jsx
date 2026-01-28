import React, { useState, useEffect } from 'react';
import { useToast } from '../context/ToastContext';
import { useDownload } from '../context/DownloadContext';

const AnimeMode = ({ isActive }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [animeResults, setAnimeResults] = useState([]);
    const [selectedAnime, setSelectedAnime] = useState(null);
    const [episodes, setEpisodes] = useState([]);
    const [loadingEpisodes, setLoadingEpisodes] = useState(false);
    const [selectedEpisodes, setSelectedEpisodes] = useState([]);
    const [downloading, setDownloading] = useState(false);
    const [apiStatus, setApiStatus] = useState(null);
    
    const { showError, showInfo, showWarning, showSuccess } = useToast();
    const { addDownload } = useDownload();

    // Check anime API status on mount
    useEffect(() => {
        if (isActive) {
            checkApiStatus();
        }
    }, [isActive]);

    const checkApiStatus = async () => {
        try {
            const response = await fetch('/api/anime/health');
            const data = await response.json();
            setApiStatus(data);
            if (!data.success) {
                showWarning('Anime API nedostupné', `Nastav ANIME_API_URL v .env (aktuálně: ${data.apiUrl})`);
            }
        } catch (error) {
            setApiStatus({ success: false, message: 'Could not check API status' });
        }
    };

    // Krok 1: Vyhledání anime
    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;

        setSearching(true);
        setAnimeResults([]);
        setSelectedAnime(null);
        setEpisodes([]);
        setSelectedEpisodes([]);

        try {
            showInfo('Vyhledávám', `Hledám anime "${searchQuery}"...`);

            const response = await fetch(`/api/anime/search/${encodeURIComponent(searchQuery)}`);
            const data = await response.json();
            
            if (data.success && data.results && data.results.length > 0) {
                setAnimeResults(data.results);
                showSuccess('Nalezeno', `${data.results.length} výsledků`);
            } else {
                showWarning('Nenalezeno', data.error || 'Žádné anime nebylo nalezeno');
            }

        } catch (error) {
            showError('Chyba', error.message);
        } finally {
            setSearching(false);
        }
    };

    // Krok 2: Výběr anime a načtení epizod
    const selectAnime = async (anime) => {
        try {
            setSelectedAnime(anime);
            setAnimeResults([]);
            setLoadingEpisodes(true);
            
            showInfo('Načítám', `Načítám epizody pro ${anime.title}...`);

            const response = await fetch(`/api/anime/episodes/${encodeURIComponent(anime.id)}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Nepodařilo se načíst epizody');
            }

            setEpisodes(data.episodes);
            showSuccess('Načteno', `${data.totalEpisodes} epizod`);

        } catch (error) {
            showError('Chyba', error.message);
            setSelectedAnime(null);
        } finally {
            setLoadingEpisodes(false);
        }
    };

    const toggleEpisodeSelection = (episodeNo) => {
        setSelectedEpisodes(prev => 
            prev.includes(episodeNo) 
                ? prev.filter(e => e !== episodeNo)
                : [...prev, episodeNo]
        );
    };

    const selectAllEpisodes = () => {
        setSelectedEpisodes(episodes.map(ep => ep.episodeNo));
    };

    const deselectAllEpisodes = () => {
        setSelectedEpisodes([]);
    };

    const selectRange = (start, end) => {
        const range = [];
        for (let i = start; i <= Math.min(end, episodes.length); i++) {
            range.push(i);
        }
        setSelectedEpisodes(range);
    };

    // Krok 3: Stažení vybraných epizod
    const handleDownload = async () => {
        if (selectedEpisodes.length === 0) {
            showWarning('Nic nevybráno', 'Vyber alespoň jednu epizodu');
            return;
        }

        setDownloading(true);
        showInfo('Zahajuji stahování', `${selectedEpisodes.length} epizod`);

        try {
            // Prepare episodes data
            const episodesToDownload = selectedEpisodes
                .map(epNo => episodes.find(ep => ep.episodeNo === epNo))
                .filter(Boolean)
                .sort((a, b) => a.episodeNo - b.episodeNo);

            const downloadData = {
                animeTitle: selectedAnime.title,
                animeId: selectedAnime.id,
                episodes: episodesToDownload.map(ep => ({
                    episodeNo: ep.episodeNo,
                    dataId: ep.dataId,
                    title: ep.title
                }))
            };

            const response = await fetch('/api/anime/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(downloadData)
            });

            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Stahování selhalo');
            }

            // Add to download HUD
            addDownload({
                downloadId: result.jobId,
                title: `${selectedAnime.title} (${selectedEpisodes.length} epizod)`,
                size: 0,
                type: 'anime'
            });

            showSuccess('Stahování zahájeno', result.message);
            
            // Reset selection
            setSelectedEpisodes([]);

        } catch (error) {
            showError('Chyba', error.message);
        } finally {
            setDownloading(false);
        }
    };

    if (!isActive) return null;

    return (
        <section className="download-section active" id="anime-section">
            <div className="container">
                <h2 className="step-title">Stáhnout anime</h2>
                
                {/* API Status Warning */}
                {apiStatus && !apiStatus.success && (
                    <div className="api-warning" style={{
                        background: 'rgba(255, 193, 7, 0.1)',
                        border: '1px solid #ffc107',
                        borderRadius: '8px',
                        padding: '15px',
                        marginBottom: '20px'
                    }}>
                        <i className="fas fa-exclamation-triangle" style={{ color: '#ffc107', marginRight: '10px' }}></i>
                        <strong>Anime API není dostupné.</strong>
                        <p style={{ margin: '10px 0 0', fontSize: '14px' }}>
                            Nastav <code>ANIME_API_URL</code> v souboru <code>.env</code> na URL tvé instance anime-api.
                            <br />
                            <a href="https://github.com/itzzzme/anime-api" target="_blank" rel="noopener noreferrer">
                                Návod na instalaci anime-api →
                            </a>
                        </p>
                    </div>
                )}

                {/* Search Box */}
                <div className="search-box">
                    <div className="search-header">
                        <div className="search-icon"><i className="fas fa-search"></i></div>
                        <div className="search-title">Vyhledej anime (anglický název)</div>
                    </div>
                    <form className="search-form" onSubmit={handleSearch}>
                        <div className="search-input-wrapper">
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Např. Naruto, One Piece, Attack on Titan..."
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
                </div>

                {/* Search Results */}
                {animeResults.length > 0 && !selectedAnime && (
                    <div className="series-search-results">
                        <h3>Výsledky vyhledávání</h3>
                        <div className="series-cards">
                            {animeResults.map((anime, index) => (
                                <div 
                                    key={anime.id || index} 
                                    className="series-card"
                                    onClick={() => selectAnime(anime)}
                                >
                                    <div className="series-poster">
                                        {anime.poster ? (
                                            <img src={anime.poster} alt={anime.title} />
                                        ) : (
                                            <i className="fas fa-film"></i>
                                        )}
                                    </div>
                                    <div className="series-info">
                                        <h4>{anime.title}</h4>
                                        {anime.japaneseTitle && (
                                            <p className="japanese-title" style={{ 
                                                fontSize: '12px', 
                                                color: 'var(--text-secondary)' 
                                            }}>
                                                {anime.japaneseTitle}
                                            </p>
                                        )}
                                        {anime.tvInfo && (
                                            <p className="anime-info">
                                                {anime.tvInfo.showType && <span>{anime.tvInfo.showType}</span>}
                                                {anime.tvInfo.sub && <span> | SUB: {anime.tvInfo.sub}</span>}
                                                {anime.tvInfo.dub && <span> | DUB: {anime.tvInfo.dub}</span>}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Selected Anime - Episode Selection */}
                {selectedAnime && (
                    <div className="series-detail">
                        <div className="series-header-card">
                            <div className="series-poster">
                                {selectedAnime.poster ? (
                                    <img src={selectedAnime.poster} alt={selectedAnime.title} />
                                ) : (
                                    <i className="fas fa-film"></i>
                                )}
                            </div>
                            <div className="series-info">
                                <h3>{selectedAnime.title}</h3>
                                {selectedAnime.japaneseTitle && (
                                    <p style={{ color: 'var(--text-secondary)', marginBottom: '10px' }}>
                                        {selectedAnime.japaneseTitle}
                                    </p>
                                )}
                                {selectedAnime.tvInfo && (
                                    <p>
                                        <span className="badge">{selectedAnime.tvInfo.showType || 'TV'}</span>
                                        {selectedAnime.tvInfo.dub && (
                                            <span className="badge badge-success" style={{ marginLeft: '5px' }}>
                                                DUB dostupný
                                            </span>
                                        )}
                                    </p>
                                )}
                                <button 
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => {
                                        setSelectedAnime(null);
                                        setEpisodes([]);
                                        setSelectedEpisodes([]);
                                    }}
                                    style={{ marginTop: '10px' }}
                                >
                                    <i className="fas fa-arrow-left"></i> Zpět na vyhledávání
                                </button>
                            </div>
                        </div>

                        {loadingEpisodes ? (
                            <div className="loading-state" style={{ textAlign: 'center', padding: '40px' }}>
                                <i className="fas fa-spinner fa-spin fa-2x"></i>
                                <p>Načítám epizody...</p>
                            </div>
                        ) : episodes.length > 0 ? (
                            <>
                                {/* Selection Actions */}
                                <div className="selection-actions">
                                    <button className="btn btn-secondary" onClick={selectAllEpisodes}>
                                        <i className="fas fa-check-double"></i> Vybrat vše
                                    </button>
                                    <button className="btn btn-secondary" onClick={deselectAllEpisodes}>
                                        <i className="fas fa-times"></i> Zrušit výběr
                                    </button>
                                    <button className="btn btn-secondary" onClick={() => selectRange(1, 12)}>
                                        <i className="fas fa-list"></i> 1-12
                                    </button>
                                    <button className="btn btn-secondary" onClick={() => selectRange(13, 24)}>
                                        <i className="fas fa-list"></i> 13-24
                                    </button>
                                    {selectedEpisodes.length > 0 && (
                                        <span className="selection-count">
                                            {selectedEpisodes.length} epizod vybráno
                                        </span>
                                    )}
                                </div>

                                {/* Episode Grid - Season 1 */}
                                <div className="season-block">
                                    <div className="season-header">
                                        <span className="season-title">
                                            <i className="fas fa-layer-group"></i> Sezóna 1
                                        </span>
                                        <span className="episode-count">{episodes.length} epizod</span>
                                    </div>
                                    <div className="episode-grid">
                                        {episodes.map((ep) => (
                                            <div 
                                                key={ep.episodeNo}
                                                className={`episode-card ${selectedEpisodes.includes(ep.episodeNo) ? 'selected' : ''}`}
                                                onClick={() => toggleEpisodeSelection(ep.episodeNo)}
                                            >
                                                <div className="episode-number">E{ep.episodeNo}</div>
                                                <div className="episode-title" title={ep.title}>
                                                    {ep.title || `Epizoda ${ep.episodeNo}`}
                                                </div>
                                                {selectedEpisodes.includes(ep.episodeNo) && (
                                                    <i className="fas fa-check episode-check"></i>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Download Button */}
                                {selectedEpisodes.length > 0 && (
                                    <div className="proceed-section">
                                        <button 
                                            className="btn btn-primary btn-lg"
                                            onClick={handleDownload}
                                            disabled={downloading}
                                        >
                                            {downloading ? (
                                                <><i className="fas fa-spinner fa-spin"></i> Stahuji...</>
                                            ) : (
                                                <>
                                                    <i className="fas fa-download"></i> 
                                                    Stáhnout {selectedEpisodes.length} epizod (anglický dabing)
                                                </>
                                            )}
                                        </button>
                                        <p style={{ 
                                            marginTop: '10px', 
                                            fontSize: '12px', 
                                            color: 'var(--text-secondary)' 
                                        }}>
                                            Epizody budou uloženy ve formátu kompatibilním s Jellyfin/Plex
                                        </p>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="empty-state" style={{ textAlign: 'center', padding: '40px' }}>
                                <i className="fas fa-exclamation-circle fa-2x" style={{ color: 'var(--text-secondary)' }}></i>
                                <p>Žádné epizody nenalezeny</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
};

export default AnimeMode;
