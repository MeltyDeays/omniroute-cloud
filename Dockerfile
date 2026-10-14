FROM node:20-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install omniroute
RUN npm install -g omniroute@latest

# Copy pre-configured seed database (combos, models, settings)
COPY seed/ /app/seed/

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Directory for SQLite and runtime data (allow non-root user on Hugging Face)
ENV DATA_DIR=/data
RUN mkdir -p /data && chmod -R 777 /data

# Default port for Hugging Face Spaces is 7860
ENV PORT=7860
EXPOSE 7860

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:${PORT:-7860}/health || exit 1

ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"]
