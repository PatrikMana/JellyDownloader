/**
 * Utility Helper Functions
 */

/**
 * Convert duration string to seconds
 * @param {string} durationStr - Duration like "01:45:30" or "45:30"
 * @returns {number} Duration in seconds
 */
function durationToSeconds(durationStr) {
    if (!durationStr) return 0;
    const parts = durationStr.split(':').map(Number);
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }
    return 0;
}

/**
 * Convert filesize string to MB
 * @param {string} sizeStr - Size like "1.5 GB" or "500 MB"
 * @returns {number} Size in MB
 */
function filesizeToMB(sizeStr) {
    if (!sizeStr) return 0;
    const match = sizeStr.match(/([\d.,]+)\s*(B|KB|MB|GB|TB)/i);
    if (!match) return 0;
    
    const value = parseFloat(match[1].replace(',', '.'));
    const unit = match[2].toUpperCase();
    
    const multipliers = {
        'B': 1 / (1024 * 1024),
        'KB': 1 / 1024,
        'MB': 1,
        'GB': 1024,
        'TB': 1024 * 1024
    };
    
    return value * (multipliers[unit] || 1);
}

/**
 * Sanitize filename for filesystem
 * @param {string} filename - Original filename
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(filename) {
    return filename
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Format bytes to human readable string
 * @param {number} bytes - Bytes
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format seconds to human readable string
 * @param {number} seconds - Seconds
 * @returns {string} Formatted string like "5m 30s"
 */
function formatDuration(seconds) {
    if (!seconds || seconds === Infinity) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum retries
 * @param {number} baseDelay - Base delay in ms
 * @returns {Promise<any>}
 */
async function retry(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (i < maxRetries - 1) {
                await sleep(baseDelay * Math.pow(2, i));
            }
        }
    }
    throw lastError;
}

module.exports = {
    durationToSeconds,
    filesizeToMB,
    sanitizeFilename,
    formatBytes,
    formatDuration,
    sleep,
    retry
};
