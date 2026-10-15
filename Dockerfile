FROM node:22-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install stable omniroute (3.8.48 without the 3.8.51 cgroup_ratio shed bug)
RUN npm install -g omniroute@3.8.48

# Copy pre-configured seed database (combos, models, settings)
COPY seed/ /app/seed/

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Directory for SQLite and runtime data (allow non-root user on Hugging Face)
ENV DATA_DIR=/data
RUN mkdir -p /data && chmod -R 777 /data

# Default port for Render is 10000 (can be overridden by $PORT)
ENV PORT=10000
ENV OMNIROUTE_MEMORY_MB=320
ENV NODE_OPTIONS="--max-old-space-size=320"
ENV HEAP_PRESSURE_THRESHOLD_MB=310
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 10000 7860 20128

# Health check (OmniRoute health route is /api/monitoring/health)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:${PORT:-10000}/api/monitoring/health || exit 1

ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"]
