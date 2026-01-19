import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { useToast } from './ToastContext';

const DownloadContext = createContext();

export const useDownload = () => {
    const context = useContext(DownloadContext);
    if (!context) {
        throw new Error('useDownload must be used within a DownloadProvider');
    }
    return context;
};

export const DownloadProvider = ({ children }) => {
    const [downloads, setDownloads] = useState([]);
    const [hudVisible, setHudVisible] = useState(false);
    const pollIntervals = useRef({});
    const { showSuccess, showError, showInfo } = useToast();

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatSeconds = (seconds) => {
        if (!seconds || seconds === Infinity) return '--:--';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const addDownload = useCallback((downloadInfo) => {
        const download = {
            id: downloadInfo.downloadId || Date.now().toString(),
            title: downloadInfo.title,
            size: downloadInfo.size || 0,
            progress: 0,
            downloaded: 0,
            speed: 0,
            eta: null,
            status: 'downloading',
            ...downloadInfo
        };

        setDownloads(prev => [...prev, download]);
        setHudVisible(true);

        // Start polling for progress
        startPolling(download.id);

        return download.id;
    }, []);

    const updateDownload = useCallback((id, updates) => {
        setDownloads(prev => prev.map(d => 
            d.id === id ? { ...d, ...updates } : d
        ));
    }, []);

    const removeDownload = useCallback((id) => {
        stopPolling(id);
        setDownloads(prev => prev.filter(d => d.id !== id));
    }, []);

    const startPolling = (downloadId) => {
        if (pollIntervals.current[downloadId]) return;

        // Use Server-Sent Events for progress updates
        const eventSource = new EventSource(`/api/download/progress/${downloadId}`);
        pollIntervals.current[downloadId] = eventSource;

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'complete' || data.type === 'done' || data.status === 'completed') {
                    updateDownload(downloadId, {
                        status: 'completed',
                        progress: 100,
                        downloaded: data.downloadedBytes || data.totalBytes || 0
                    });
                    stopPolling(downloadId);
                    // Check if it's series completion
                    if (data.totalEpisodes) {
                        showSuccess('Seriál stažen', `${data.completedEpisodes || data.totalEpisodes} epizod uloženo`);
                    } else {
                        showSuccess('Staženo', data.filename || 'Soubor byl úspěšně stažen');
                    }
                } else if (data.type === 'error' || data.status === 'error' || data.status === 'failed') {
                    updateDownload(downloadId, {
                        status: 'error',
                        error: data.error
                    });
                    stopPolling(downloadId);
                    showError('Chyba', data.error || 'Stahování selhalo');
                } else if (data.type === 'progress') {
                    // Map backend field names to frontend
                    updateDownload(downloadId, {
                        progress: data.progress || 0,
                        downloaded: data.downloadedBytes || 0,
                        speed: data.speedBps || 0,
                        eta: data.etaSec,
                        size: data.totalBytes || 0,
                        // Series specific
                        currentEpisode: data.currentEpisode,
                        totalEpisodes: data.totalEpisodes
                    });
                } else if (data.type === 'episode-start') {
                    updateDownload(downloadId, {
                        status: 'downloading',
                        currentEpisode: data.currentIndex,
                        totalEpisodes: data.totalEpisodes,
                        episodeTitle: data.episodeTitle
                    });
                } else if (data.type === 'episode-done') {
                    updateDownload(downloadId, {
                        completedEpisodes: data.completedEpisodes,
                        totalEpisodes: data.totalEpisodes
                    });
                }
            } catch (error) {
                console.error('SSE parse error:', error);
            }
        };

        eventSource.onerror = (error) => {
            console.error('SSE error:', error);
            stopPolling(downloadId);
        };
    };

    const stopPolling = (downloadId) => {
        if (pollIntervals.current[downloadId]) {
            pollIntervals.current[downloadId].close();
            delete pollIntervals.current[downloadId];
        }
    };

    const startDownload = useCallback(async (item, type = 'movie') => {
        try {
            showInfo('Zahajuji stahování', item.title || item.name);

            // First, get the actual video URL from prehrajto page
            let videoUrl = item.videoUrl; // If already have direct URL
            
            if (!videoUrl && item.url) {
                // Extract path from prehrajto URL (e.g., "https://prehrajto.cz/video/xyz" -> "video/xyz")
                let moviePath = item.url;
                if (moviePath.includes('prehrajto.cz/')) {
                    moviePath = moviePath.split('prehrajto.cz/')[1];
                }
                if (moviePath.startsWith('/')) {
                    moviePath = moviePath.substring(1);
                }
                
                showInfo('Získávám video', 'Načítám přímý odkaz na video...');
                
                const videoResponse = await fetch(`/api/video/${moviePath}`);
                if (!videoResponse.ok) {
                    throw new Error('Nepodařilo se získat odkaz na video');
                }
                const videoData = await videoResponse.json();
                
                if (!videoData.success || !videoData.videoUrl) {
                    throw new Error(videoData.error || 'Video URL nebyla nalezena');
                }
                
                videoUrl = videoData.videoUrl;
            }

            if (!videoUrl) {
                throw new Error('Chybí URL videa');
            }

            // Now start the actual download
            const endpoint = type === 'series' ? '/api/download/series' : '/api/download';
            
            // Use full imdbData if available, otherwise construct from individual fields
            const imdbDataPayload = item.imdbData || (item.imdbId ? {
                imdbID: item.imdbId,
                Year: item.year,
                Title: item.title || item.name,
                Genre: item.genres
            } : null);
            
            const body = {
                videoUrl: videoUrl,
                title: item.title || item.name,
                imdbData: imdbDataPayload,
                type: type,
                season: item.seasonNumber || null,
                episode: item.episodeNumber || null
            };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Stahování selhalo');
            }

            const data = await response.json();
            
            addDownload({
                downloadId: data.jobId,
                title: item.title || item.name,
                size: item.size || 0
            });

            return data.jobId;
        } catch (error) {
            showError('Chyba', error.message);
            throw error;
        }
    }, [addDownload, showInfo, showError]);

    const clearCompleted = useCallback(() => {
        setDownloads(prev => prev.filter(d => d.status !== 'completed' && d.status !== 'error'));
    }, []);

    return (
        <DownloadContext.Provider value={{
            downloads,
            hudVisible,
            setHudVisible,
            addDownload,
            updateDownload,
            removeDownload,
            startDownload,
            clearCompleted,
            formatBytes,
            formatSeconds
        }}>
            {children}
        </DownloadContext.Provider>
    );
};
