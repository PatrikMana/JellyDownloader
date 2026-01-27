import React, { useState, useEffect } from 'react';
import { settingsApi, fileBrowserApi } from '../services/api';
import { useToast } from '../context/ToastContext';

const SettingsModal = ({ isOpen, onClose }) => {
    const [settings, setSettings] = useState({
        moviesDir: '',
        seriesDir: ''
    });
    const [loading, setLoading] = useState(false);
    const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
    const [fileBrowserTarget, setFileBrowserTarget] = useState(null);
    const [currentPath, setCurrentPath] = useState('');
    const [items, setItems] = useState([]);
    const [browseLoading, setBrowseLoading] = useState(false);
    const { showSuccess, showError } = useToast();

    useEffect(() => {
        if (isOpen) {
            loadSettings();
        }
    }, [isOpen]);

    const loadSettings = async () => {
        try {
            const data = await settingsApi.get();
            setSettings({
                moviesDir: data.moviesDir || '',
                seriesDir: data.seriesDir || ''
            });
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    };

    const saveSettings = async () => {
        setLoading(true);
        try {
            await settingsApi.save(settings);
            showSuccess('Uloženo', 'Nastavení bylo úspěšně uloženo');
            onClose();
        } catch (error) {
            showError('Chyba', error.message);
        } finally {
            setLoading(false);
        }
    };

    const openFileBrowser = async (target) => {
        setFileBrowserTarget(target);
        setFileBrowserOpen(true);
        const startPath = settings[target] || '';
        await browsePath(startPath);
    };

    const browsePath = async (path) => {
        setBrowseLoading(true);
        try {
            const data = await fileBrowserApi.browse(path);
            setCurrentPath(data.currentPath || path);
            setItems(data.items || []);
        } catch (error) {
            showError('Chyba', 'Nepodařilo se načíst složku');
            setItems([]);
        } finally {
            setBrowseLoading(false);
        }
    };

    const navigateUp = () => {
        // Use parentPath from API response if available
        if (currentPath) {
            // For Windows paths like C:\Users\Patrik, go to parent
            const isWindows = currentPath.includes('\\') || /^[A-Z]:/.test(currentPath);
            
            if (isWindows) {
                const parts = currentPath.split('\\').filter(Boolean);
                if (parts.length > 1) {
                    parts.pop();
                    const newPath = parts.join('\\');
                    browsePath(newPath);
                }
            } else {
                // Unix paths
                const parts = currentPath.split('/').filter(Boolean);
                if (parts.length > 1) {
                    parts.pop();
                    const newPath = '/' + parts.join('/');
                    browsePath(newPath);
                } else if (parts.length === 1) {
                    browsePath('/');
                }
            }
        }
    };

    const selectFolder = (item) => {
        if (item.isDirectory) {
            browsePath(item.path);
        }
    };

    const confirmFolderSelection = () => {
        if (fileBrowserTarget) {
            setSettings(prev => ({
                ...prev,
                [fileBrowserTarget]: currentPath
            }));
        }
        setFileBrowserOpen(false);
    };

    if (!isOpen) return null;

    return (
        <>
            <div className={`modal-overlay ${isOpen ? 'active' : ''}`} onClick={onClose}>
                <div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h3 className="modal-title">
                            <i className="fas fa-cog"></i>
                            Nastavení
                        </h3>
                        <button className="modal-close" onClick={onClose}>
                            <i className="fas fa-times"></i>
                        </button>
                    </div>

                    <div className="modal-body">
                        <div className="settings-group">
                            <h4 className="settings-group-title">Cesty pro ukládání</h4>
                            
                            <div className="settings-item">
                                <label className="settings-label">Složka pro filmy</label>
                                <p className="settings-hint">Kam se budou ukládat stažené filmy</p>
                                <div className="settings-input-group">
                                    <input 
                                        type="text" 
                                        className="settings-input"
                                        value={settings.moviesDir}
                                        onChange={e => setSettings(prev => ({ ...prev, moviesDir: e.target.value }))}
                                        placeholder={settings.moviesDir || 'Klikněte na Procházet pro výběr složky'}
                                    />
                                    <button 
                                        className="settings-browse-btn"
                                        onClick={() => openFileBrowser('moviesDir')}
                                    >
                                        <i className="fas fa-folder-open"></i>
                                        Procházet
                                    </button>
                                </div>
                            </div>

                            <div className="settings-item">
                                <label className="settings-label">Složka pro seriály</label>
                                <p className="settings-hint">Kam se budou ukládat stažené seriály</p>
                                <div className="settings-input-group">
                                    <input 
                                        type="text" 
                                        className="settings-input"
                                        value={settings.seriesDir}
                                        onChange={e => setSettings(prev => ({ ...prev, seriesDir: e.target.value }))}
                                        placeholder={settings.seriesDir || 'Klikněte na Procházet pro výběr složky'}
                                    />
                                    <button 
                                        className="settings-browse-btn"
                                        onClick={() => openFileBrowser('seriesDir')}
                                    >
                                        <i className="fas fa-folder-open"></i>
                                        Procházet
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="modal-footer">
                        <button className="btn btn-secondary" onClick={onClose}>
                            Zrušit
                        </button>
                        <button 
                            className="btn btn-primary" 
                            onClick={saveSettings}
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <i className="fas fa-spinner fa-spin"></i>
                                    Ukládám...
                                </>
                            ) : (
                                <>
                                    <i className="fas fa-save"></i>
                                    Uložit
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* File Browser Modal */}
            {fileBrowserOpen && (
                <div className="modal-overlay active file-browser-modal" style={{ zIndex: 2100 }} onClick={() => setFileBrowserOpen(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">
                                <i className="fas fa-folder-open"></i>
                                Vybrat složku
                            </h3>
                            <button className="modal-close" onClick={() => setFileBrowserOpen(false)}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        <div className="file-browser-path">
                            <button 
                                className="file-browser-path-btn"
                                onClick={navigateUp}
                                disabled={!currentPath || currentPath === '/'}
                            >
                                <i className="fas fa-arrow-up"></i>
                            </button>
                            <span className="file-browser-path-text">{currentPath || '/'}</span>
                        </div>

                        <div className="file-browser-list" style={{ flex: 1, overflowY: 'auto' }}>
                            {browseLoading ? (
                                <div className="file-browser-loading">
                                    <i className="fas fa-spinner fa-spin"></i>
                                    <p>Načítám...</p>
                                </div>
                            ) : items.length === 0 ? (
                                <div className="file-browser-empty">
                                    <i className="fas fa-folder-open"></i>
                                    <p>Složka je prázdná</p>
                                </div>
                            ) : (
                                items.filter(item => item.isDirectory).map((item, index) => (
                                    <div 
                                        key={index}
                                        className="file-browser-item"
                                        onClick={() => selectFolder(item)}
                                    >
                                        <div className="file-browser-item-icon folder">
                                            <i className="fas fa-folder"></i>
                                        </div>
                                        <span className="file-browser-item-name">{item.name}</span>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setFileBrowserOpen(false)}>
                                Zrušit
                            </button>
                            <button className="btn btn-primary" onClick={confirmFolderSelection}>
                                <i className="fas fa-check"></i>
                                Vybrat tuto složku
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default SettingsModal;
