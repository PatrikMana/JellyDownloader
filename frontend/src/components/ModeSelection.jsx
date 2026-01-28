import React from 'react';

const ModeSelection = ({ currentMode, onModeChange }) => {
    return (
        <section className="mode-selection">
            <div className="container">
                <h2 className="step-title">Vyber režim</h2>
                
                <div className="mode-cards">
                    <div 
                        className={`mode-card ${currentMode === 'movie' ? 'active' : ''}`}
                        onClick={() => onModeChange('movie')}
                    >
                        <div className="mode-card-icon">
                            <i className="fas fa-film"></i>
                        </div>
                        <h3 className="mode-card-title">Filmy</h3>
                        <p className="mode-card-desc">
                            Stahuj jednotlivé filmy. Vyhledej film na prehrajto.cz a vyber kvalitu ke stažení.
                        </p>
                        <span className="mode-card-arrow">
                            <i className="fas fa-arrow-right"></i>
                        </span>
                    </div>
                    
                    <div 
                        className={`mode-card ${currentMode === 'series' ? 'active' : ''}`}
                        onClick={() => onModeChange('series')}
                    >
                        <div className="mode-card-icon">
                            <i className="fas fa-tv"></i>
                        </div>
                        <h3 className="mode-card-title">Seriály</h3>
                        <p className="mode-card-desc">
                            Stahuj celé seriály nebo jednotlivé epizody. Vyber sezóny a díly, které chceš stáhnout.
                        </p>
                        <span className="mode-card-arrow">
                            <i className="fas fa-arrow-right"></i>
                        </span>
                    </div>
                    
                    <div 
                        className={`mode-card ${currentMode === 'anime' ? 'active' : ''}`}
                        onClick={() => onModeChange('anime')}
                    >
                        <div className="mode-card-icon">
                            <i className="fas fa-dragon"></i>
                        </div>
                        <h3 className="mode-card-title">Anime</h3>
                        <p className="mode-card-desc">
                            Stahuj anime v anglickém dabingu. Vyhledej anime a vyber epizody ke stažení.
                        </p>
                        <span className="mode-card-arrow">
                            <i className="fas fa-arrow-right"></i>
                        </span>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ModeSelection;
