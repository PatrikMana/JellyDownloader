import React from 'react';

const Hero = () => {
    return (
        <section className="hero">
            <div className="hero-content">
                <span className="hero-badge">
                    <i className="fas fa-bolt"></i>
                    PREHRAJTO.CZ DOWNLOADER
                </span>
                
                <h1 className="hero-title">
                    STAHUJ<br />
                    <span className="hero-title-accent">FILMY & SERIÁLY</span>
                </h1>
                
                <p className="hero-description">
                    Jednoduché stahování filmů a seriálů z prehrajto.cz přímo do Jellyfin knihovny s automatickým pojmenováním souborů.
                </p>
                
                <div className="hero-stats">
                    <div className="stat-item">
                        <span className="stat-number">∞</span>
                        <span className="stat-label">Filmů</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-number">∞</span>
                        <span className="stat-label">Seriálů</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-number">HD</span>
                        <span className="stat-label">Kvalita</span>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Hero;
