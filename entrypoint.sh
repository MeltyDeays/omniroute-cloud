#!/bin/sh
set -e

# Memory tuning for Render 512MB free tier container
export OMNIROUTE_MEMORY_MB=320
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=320}"
export HEAP_PRESSURE_THRESHOLD_MB=310
export NEXT_TELEMETRY_DISABLED=1

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

# Ensure .env in DATA_DIR has keys if passed via container env
if [ ! -f /data/.env ]; then
  cat <<EOF > /data/.env
STORAGE_ENCRYPTION_KEY=${STORAGE_ENCRYPTION_KEY:-83d974394c63a347677535f4779ebe5dc9ba1195eecd62e697c2c1c9ac2d9444}
OMNIROUTE_API_KEY=${OMNIROUTE_API_KEY:-sk-bbe727d4356f358d-e5577d-28c89ab5}
OMNIROUTE_BASE_URL=http://0.0.0.0:${PORT:-10000}
EOF
fi

chmod -R 777 /data

echo "Starting OmniRoute on port ${PORT:-10000}..."
exec omniroute serve --port "${PORT:-10000}" --no-open
