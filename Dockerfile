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

# Directory for SQLite and runtime data
ENV DATA_DIR=/data
RUN mkdir -p /data

# Default port assigned by PaaS (Render, Koyeb, Railway)
ENV PORT=20128
EXPOSE 20128

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:${PORT:-20128}/health || exit 1

ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"]
