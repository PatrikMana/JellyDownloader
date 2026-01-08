import React from 'react';
import { useDownload } from '../context/DownloadContext';

const DownloadHUD = () => {
    const { 
        downloads, 
        hudVisible, 
        setHudVisible, 
        clearCompleted,
        formatBytes,
        formatSeconds
    } = useDownload();

    if (!hudVisible) return null;

    const getStatusIcon = (status) => {
        switch (status) {
            case 'downloading': return 'fa-spinner fa-spin';
            case 'completed': return 'fa-check';
            case 'error': return 'fa-times';
            default: return 'fa-clock';
        }
    };

    const getStatusText = (status) => {
        switch (status) {
            case 'downloading': return 'Stahování...';
            case 'completed': return 'Dokončeno';
            case 'error': return 'Chyba';
            default: return 'Čekání';
        }
    };

    return (
        <div className={`download-hud ${hudVisible ? 'active' : ''}`}>
            <div className="hud-header">
                <div className="hud-title">
                    <i className="fas fa-download"></i>
                    Stahování
                </div>
                <button className="hud-close" onClick={() => setHudVisible(false)}>
                    <i className="fas fa-times"></i>
                </button>
            </div>

            <div className="hud-content">
                {downloads.length === 0 ? (
                    <div className="hud-empty">
                        <i className="fas fa-inbox"></i>
                        <p>Žádná aktivní stahování</p>
                    </div>
                ) : (
                    downloads.map(download => (
                        <div key={download.id} className={`hud-card ${download.status}`}>
                            <div className="hud-card-header">
                                <div className="hud-card-icon">
                                    <i className={`fas ${download.status === 'downloading' ? 'fa-film' : (download.status === 'completed' ? 'fa-check' : 'fa-times')}`}></i>
                                </div>
                                <div className="hud-card-info">
                                    <div className="hud-card-title">{download.title}</div>
                                    <div className="hud-card-meta">
                                        {download.size > 0 && formatBytes(download.size)}
                                    </div>
                                </div>
                            </div>
                            <div className="hud-card-body">
                                <div className="hud-progress">
                                    <div className="hud-progress-bar">
                                        <div 
                                            className="hud-progress-fill" 
                                            style={{ width: `${download.progress || 0}%` }}
                                        ></div>
                                    </div>
                                    <div className="hud-progress-text">
                                        <span>{Math.round(download.progress || 0)}%</span>
                                        <span>
                                            {download.downloaded > 0 && `${formatBytes(download.downloaded)}`}
                                            {download.size > 0 && ` / ${formatBytes(download.size)}`}
                                        </span>
                                    </div>
                                </div>
                                <div className="hud-stats">
                                    <div className="hud-stat">
                                        <span className="hud-stat-label">Rychlost</span>
                                        <span className="hud-stat-value">
                                            {download.speed > 0 ? `${formatBytes(download.speed)}/s` : '--'}
                                        </span>
                                    </div>
                                    <div className="hud-stat">
                                        <span className="hud-stat-label">Zbývá</span>
                                        <span className="hud-stat-value">
                                            {download.eta ? formatSeconds(download.eta) : '--:--'}
                                        </span>
                                    </div>
                                </div>
                                <div className={`hud-card-status ${download.status}`}>
                                    <i className={`fas ${getStatusIcon(download.status)}`}></i>
                                    <span>{getStatusText(download.status)}</span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {downloads.some(d => d.status === 'completed' || d.status === 'error') && (
                <div style={{ 
                    padding: 'var(--spacing-sm)', 
                    borderTop: '1px solid var(--color-border)',
                    textAlign: 'center'
                }}>
                    <button className="btn btn-secondary" onClick={clearCompleted}>
                        <i className="fas fa-trash"></i>
                        Vymazat dokončené
                    </button>
                </div>
            )}
        </div>
    );
};

export default DownloadHUD;
