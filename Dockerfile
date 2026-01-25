# Use official Node.js LTS (Long Term Support) image with Debian slim
FROM node:20-slim AS base

# Install security updates and necessary packages
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends dumb-init && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Create non-root user for security
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -s /bin/bash -m nodejs

# Copy package files
COPY --chown=nodejs:nodejs package*.json ./

# Install dependencies
# Use --omit=dev in production, but include all for flexibility
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application source code
COPY --chown=nodejs:nodejs . .

# Create screenshots directory with proper permissions
RUN mkdir -p /usr/src/app/screenshots/verified && \
    mkdir -p /usr/src/app/screenshots/rejected && \
    chown -R nodejs:nodejs /usr/src/app/screenshots

# Switch to non-root user
USER nodejs

# Expose port (Railway will set PORT via environment variable)
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${PORT:-3000}/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Start the application
CMD ["node", "src/botfetch.js"]
