import React from 'react';
import { useDownload } from '../context/DownloadContext';

const Navbar = ({ onSettingsClick }) => {
    const { hudVisible, setHudVisible, downloads } = useDownload();
    const activeDownloads = downloads.filter(d => d.status === 'downloading').length;

    return (
        <nav className="navbar">
            <div className="nav-container">
                <div className="nav-logo">
                    <h1>PREHRAJTO</h1>
                    <span className="nav-version">v2.0</span>
                </div>
                
                <div className="nav-right">
                    <div className="nav-status">
                        <span className="status-dot"></span>
                        <span>ONLINE</span>
                    </div>
                    
                    <button 
                        className="nav-btn" 
                        onClick={() => setHudVisible(!hudVisible)}
                        title="Stahování"
                        style={activeDownloads > 0 ? { color: 'var(--color-glitch-cyan)', borderColor: 'var(--color-glitch-cyan)' } : {}}
                    >
                        <i className="fas fa-download"></i>
                        {activeDownloads > 0 && (
                            <span style={{ 
                                position: 'absolute', 
                                top: -5, 
                                right: -5, 
                                background: 'var(--color-glitch-cyan)', 
                                color: 'black', 
                                fontSize: '0.6rem', 
                                padding: '2px 5px', 
                                borderRadius: '10px' 
                            }}>
                                {activeDownloads}
                            </span>
                        )}
                    </button>
                    
                    <button 
                        className="nav-btn" 
                        onClick={onSettingsClick}
                        title="Nastavení"
                    >
                        <i className="fas fa-cog"></i>
                    </button>
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
