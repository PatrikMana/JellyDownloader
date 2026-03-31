# Build stage - frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Copy frontend package files
COPY frontend/package*.json ./frontend/

# Install frontend dependencies
WORKDIR /app/frontend
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build frontend (outputs to /app/public-react)
WORKDIR /app
RUN cd frontend && npm run build

# Production stage
FROM node:20-alpine

# Install ffmpeg for HLS downloads
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy backend package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy backend source
COPY server/ ./server/

# Copy built frontend from builder stage
COPY --from=frontend-builder /app/public-react ./public-react/

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create directories for data persistence
RUN mkdir -p /downloads/movies /downloads/tvshows /downloads/anime /config /app/logs

# Create symlink for backward compatibility
RUN ln -sf /downloads /app/downloads

# Set environment variables
ENV NODE_ENV=production
ENV PORT=6565
ENV DOCKER_CONTAINER=true
ENV DOWNLOADS_DIR=/downloads
ENV CONFIG_DIR=/config
ENV MOVIES_DIR=/downloads/movies
ENV SERIES_DIR=/downloads/tvshows
ENV ANIME_DIR=/downloads/anime

# Expose port
EXPOSE 6565

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:6565/ || exit 1

# Use entrypoint script to create directories after volume mount
ENTRYPOINT ["/docker-entrypoint.sh"]
