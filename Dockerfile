# Build stage - frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install frontend dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN npm run build

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
COPY --from=frontend-builder /app/frontend/dist ./public-react/

# Create directories for data persistence
RUN mkdir -p /app/downloads /app/logs /config

# Set environment variables
ENV NODE_ENV=production
ENV PORT=6565

# Expose port
EXPOSE 6565

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:6565/ || exit 1

# Start the application
CMD ["node", "server/index.js"]
