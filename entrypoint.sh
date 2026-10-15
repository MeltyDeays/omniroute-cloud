#!/bin/sh
set -e

# Memory tuning for Render 512MB free tier container (single process mode)
# 280MB heap + ~178MB native/Next.js overhead ≈ 458MB RSS (safe under 512MB limit)
export OMNIROUTE_MEMORY_MB=280
export NODE_OPTIONS="--max-old-space-size=280"
export HEAP_PRESSURE_THRESHOLD_MB=260
export NEXT_TELEMETRY_DISABLED=1

# Disable memory-hungry background subsystems
export ARENA_ELO_SYNC_ENABLED=false
export HOT_RELOAD_ENABLED=false

# Ensure data directory exists
mkdir -p /data

# If no storage exists in persistent volume, seed from pre-configured database
if [ ! -f /data/storage.sqlite ]; then
  if [ -f /app/seed/storage.sqlite ]; then
    echo "Seeding pre-configured OmniRoute database (combos, models, settings)..."
    cp /app/seed/storage.sqlite /data/storage.sqlite
  fi
  chmod -R 777 /data
fi

# Reduce SQLite page cache from 16MB to 2MB before boot (saves ~14MB native RSS)
BETTER_SQLITE3="/usr/local/lib/node_modules/omniroute/node_modules/better-sqlite3"
if [ -d "$BETTER_SQLITE3" ] && [ -f /data/storage.sqlite ]; then
  node -e "
    const Database = require('$BETTER_SQLITE3');
    const db = new Database('/data/storage.sqlite');
    try {
      db.pragma('cache_size = -2048');
      // Persist cache_size setting in the app's key_value table
      const stmt = db.prepare(\"INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('databaseSettings', 'optimization.cacheSize', '2048')\");
      stmt.run();
      console.log('[PRE-BOOT] SQLite cache_size set to 2048KB');
    } catch(e) { console.warn('[PRE-BOOT] cache tweak skipped:', e.message); }
    db.close();
  " 2>/dev/null || echo "[PRE-BOOT] SQLite cache tweak skipped (non-fatal)"
fi

# Always regenerate .env to pick up latest feature flags
cat <<EOF > /data/.env
STORAGE_ENCRYPTION_KEY=${STORAGE_ENCRYPTION_KEY:-83d974394c63a347677535f4779ebe5dc9ba1195eecd62e697c2c1c9ac2d9444}
OMNIROUTE_API_KEY=${OMNIROUTE_API_KEY:-sk-bbe727d4356f358d-e5577d-28c89ab5}
OMNIROUTE_BASE_URL=http://0.0.0.0:${PORT:-10000}
ARENA_ELO_SYNC_ENABLED=false
HOT_RELOAD_ENABLED=false
EOF

chmod -R 777 /data

PORT="${PORT:-10000}"
export PORT
export OMNIROUTE_PORT="$PORT"
export DASHBOARD_PORT="$PORT"
export API_PORT="$PORT"
export HOSTNAME="0.0.0.0"
export NODE_ENV="production"

SERVER_FILE="/usr/local/lib/node_modules/omniroute/dist/server-ws.mjs"
if [ ! -f "$SERVER_FILE" ]; then
  SERVER_FILE="/usr/local/lib/node_modules/omniroute/dist/server.js"
fi

echo "Starting OmniRoute standalone (single process) on port $PORT..."
exec node "$SERVER_FILE"
