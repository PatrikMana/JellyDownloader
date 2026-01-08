const API_BASE = '/api';

// Utility function for API calls
async function apiCall(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        ...options
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || error.message || 'API request failed');
    }

    return response.json();
}

// Settings API
export const settingsApi = {
    async get() {
        return apiCall('/settings');
    },

    async save(settings) {
        return apiCall('/settings', {
            method: 'POST',
            body: JSON.stringify(settings)
        });
    }
};

// File Browser API
export const fileBrowserApi = {
    async browse(path = '') {
        const params = path ? `?path=${encodeURIComponent(path)}` : '';
        return apiCall(`/browse-directory${params}`);
    }
};

// Search API
export const searchApi = {
    // Search prehrajto.cz
    async searchPrehrajto(query, page = 1) {
        return apiCall(`/search/${encodeURIComponent(query)}`);
    },

    // Get video details from prehrajto (done within search)
    async getVideoDetails(url) {
        // The search endpoint already returns full details
        return { files: [] };
    },

    // Search IMDB for movies
    async searchIMDBMovie(title, year = null) {
        const params = year ? `/${title}/${year}` : `/${title}`;
        return apiCall(`/imdb${params}`);
    },

    // Search IMDB for series
    async searchIMDBSeries(query) {
        return apiCall(`/imdb/series/search/${encodeURIComponent(query)}`);
    },

    // Get series details from IMDB
    async getSeriesDetails(imdbId) {
        return apiCall(`/imdb/series/${imdbId}`);
    },

    // Get all season episodes
    async getSeasonEpisodes(imdbId) {
        return apiCall(`/imdb/series/${imdbId}/seasons`);
    },

    // Translate Czech title to English using TMDB
    async translateTitle(czechTitle, year = null) {
        const params = new URLSearchParams({ query: czechTitle });
        if (year) params.append('year', year);
        return apiCall(`/tmdb/original-title?${params}`);
    }
};

// Download API
export const downloadApi = {
    // Start a download
    async start(downloadOptions) {
        return apiCall('/download', {
            method: 'POST',
            body: JSON.stringify(downloadOptions)
        });
    },

    // Start series episode download
    async startSeries(downloadOptions) {
        return apiCall('/download/series', {
            method: 'POST',
            body: JSON.stringify(downloadOptions)
        });
    },

    // Get download progress
    async getProgress(jobId) {
        return apiCall(`/download/progress/${jobId}`);
    },

    // Cancel a download
    async cancel(jobId) {
        return apiCall(`/download/cancel/${jobId}`, {
            method: 'POST'
        });
    },

    // Get all downloads
    async getAll() {
        return apiCall('/downloads');
    }
};

export default {
    settings: settingsApi,
    fileBrowser: fileBrowserApi,
    search: searchApi,
    download: downloadApi
};
