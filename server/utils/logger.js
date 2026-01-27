/**
 * Simple Logger
 * Clean console logging without emojis
 */

const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

const currentLevel = process.env.LOG_LEVEL 
    ? LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()] || LOG_LEVELS.INFO
    : LOG_LEVELS.INFO;

function formatTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function formatMessage(level, message, meta = null) {
    const timestamp = formatTimestamp();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaStr}`;
}

const logger = {
    debug(message, meta) {
        if (currentLevel <= LOG_LEVELS.DEBUG) {
            console.log(formatMessage('DEBUG', message, meta));
        }
    },
    
    info(message, meta) {
        if (currentLevel <= LOG_LEVELS.INFO) {
            console.log(formatMessage('INFO', message, meta));
        }
    },
    
    warn(message, meta) {
        if (currentLevel <= LOG_LEVELS.WARN) {
            console.log(formatMessage('WARN', message, meta));
        }
    },
    
    error(message, meta) {
        if (currentLevel <= LOG_LEVELS.ERROR) {
            console.log(formatMessage('ERROR', message, meta));
        }
    },
    
    // Shorthand for request logging
    request(method, path) {
        this.info(`${method} ${path}`);
    }
};

module.exports = logger;
