import React, { useState, useEffect } from 'react';

const QualityModal = ({ isOpen, movie, onClose, onSelect, loading = false, isPreview = false }) => {
    const [selectedQuality, setSelectedQuality] = useState(null);
    const [includeSubtitles, setIncludeSubtitles] = useState(true);
    const [selectedSubtitles, setSelectedSubtitles] = useState([]);

    // Reset selection when modal opens with new movie
    useEffect(() => {
        if (isOpen && movie?.qualities?.length > 0) {
            setSelectedQuality(movie.qualities[0]); // Select highest quality by default
        } else {
            setSelectedQuality(null);
        }
        
        // Initialize subtitle selection - select all by default
        if (isOpen && movie?.subtitles?.length > 0) {
            setIncludeSubtitles(true);
            setSelectedSubtitles(movie.subtitles.map(s => s.src));
        } else {
            setIncludeSubtitles(false);
            setSelectedSubtitles([]);
        }
    }, [isOpen, movie]);

    if (!isOpen) return null;

    const qualities = movie?.qualities || [];
    const subtitles = movie?.subtitles || [];

    const handleSubtitleToggle = (src) => {
        setSelectedSubtitles(prev => 
            prev.includes(src) 
                ? prev.filter(s => s !== src)
                : [...prev, src]
        );
    };

    const handleConfirm = () => {
        if (selectedQuality) {
            // Get selected subtitle objects
            const subtitlesToDownload = includeSubtitles 
                ? subtitles.filter(s => selectedSubtitles.includes(s.src))
                : [];
            onSelect(movie, selectedQuality, subtitlesToDownload);
        }
    };

    const formatSize = (bytes) => {
        if (!bytes) return '';
        const gb = bytes / (1024 * 1024 * 1024);
        if (gb >= 1) return `~${gb.toFixed(1)} GB`;
        const mb = bytes / (1024 * 1024);
        return `~${mb.toFixed(0)} MB`;
    };

    return (
        <div className={`modal-overlay quality-modal ${isOpen ? 'active' : ''}`} onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="modal-title">
                        <i className={`fas ${isPreview ? 'fa-play' : 'fa-film'}`}></i>
                        {isPreview ? 'Přehrát video' : 'Vybrat kvalitu'}
                    </h3>
                    <button className="modal-close" onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="modal-body">
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        <h4 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>{movie?.title}</h4>
                        {movie?.year && (
                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                                {movie.year}
                            </span>
                        )}
                    </div>

                    {loading ? (
                        <div style={{ textAlign: 'center', padding: 'var(--spacing-lg)' }}>
                            <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: 'var(--color-glitch-cyan)' }}></i>
                            <p style={{ marginTop: 'var(--spacing-sm)', color: 'var(--color-text-muted)' }}>
                                Načítám dostupné kvality...
                            </p>
                        </div>
                    ) : qualities.length > 0 ? (
                        <div className="quality-options">
                            {qualities.map((quality, index) => (
                                <div
                                    key={index}
                                    className={`quality-option ${selectedQuality === quality ? 'selected' : ''}`}
                                    onClick={() => setSelectedQuality(quality)}
                                >
                                    <div className="quality-radio"></div>
                                    <div className="quality-info">
                                        <div className="quality-name">
                                            {quality.label || `${quality.res}p` || 'Video'}
                                        </div>
                                        <div className="quality-meta">
                                            {quality.res > 0 && <span>{quality.res}p</span>}
                                        </div>
                                    </div>
                                    {index === 0 && (
                                        <span style={{ 
                                            fontSize: '0.65rem', 
                                            padding: '2px 6px', 
                                            background: 'var(--color-glitch-cyan)', 
                                            color: 'black',
                                            borderRadius: '2px',
                                            marginRight: '0.5rem'
                                        }}>
                                            Nejvyšší
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ textAlign: 'center', padding: 'var(--spacing-md)', color: 'var(--color-text-muted)' }}>
                            <i className="fas fa-exclamation-triangle" style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}></i>
                            <p>Nepodařilo se načíst kvality videa</p>
                        </div>
                    )}

                    {/* Subtitles section */}
                    {!isPreview && subtitles.length > 0 && (
                        <div style={{ marginTop: 'var(--spacing-md)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-md)' }}>
                            <label 
                                style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '0.5rem', 
                                    cursor: 'pointer',
                                    marginBottom: 'var(--spacing-sm)'
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={includeSubtitles}
                                    onChange={(e) => setIncludeSubtitles(e.target.checked)}
                                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                />
                                <span style={{ fontWeight: '500' }}>
                                    <i className="fas fa-closed-captioning" style={{ marginRight: '0.5rem' }}></i>
                                    Stáhnout titulky
                                </span>
                            </label>
                            
                            {includeSubtitles && (
                                <div style={{ marginLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {subtitles.map((sub, index) => (
                                        <label 
                                            key={index}
                                            style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                gap: '0.5rem', 
                                                cursor: 'pointer',
                                                color: 'var(--color-text-muted)',
                                                fontSize: '0.9rem'
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedSubtitles.includes(sub.src)}
                                                onChange={() => handleSubtitleToggle(sub.src)}
                                                style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                                            />
                                            <span>{sub.label || sub.language || 'Titulky'}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>
                        Zrušit
                    </button>
                    <button 
                        className="btn btn-primary" 
                        onClick={handleConfirm}
                        disabled={!selectedQuality || loading}
                    >
                        <i className={`fas ${isPreview ? 'fa-play' : 'fa-download'}`}></i>
                        {isPreview ? 'Přehrát' : 'Stáhnout'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default QualityModal;
