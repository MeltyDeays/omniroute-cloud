FROM node:22-bookworm-slim

WORKDIR /app

# Copy application files
COPY package.json ./
COPY server.js ./
COPY seed/ ./seed/

# Set production environment and default port
ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

# Built-in lightweight Node healthcheck (zero curl dependency)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 10000) + '/api/monitoring/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
