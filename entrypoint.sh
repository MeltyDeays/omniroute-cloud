#!/bin/sh
set -e

# Ensure data directory exists
mkdir -p /data

# If no storage exists in persistent volume, seed from pre-configured database
if [ ! -f /data/storage.sqlite ]; then
  if [ -f /app/seed/storage.sqlite ]; then
    echo "Seeding pre-configured OmniRoute database (combos, models, settings)..."
    cp /app/seed/storage.sqlite /data/storage.sqlite
  fi
fi

# Ensure .env in DATA_DIR has keys if passed via container env
if [ ! -f /data/.env ]; then
  cat <<EOF > /data/.env
STORAGE_ENCRYPTION_KEY=${STORAGE_ENCRYPTION_KEY:-83d974394c63a347677535f4779ebe5dc9ba1195eecd62e697c2c1c9ac2d9444}
OMNIROUTE_API_KEY=${OMNIROUTE_API_KEY:-sk-bbe727d4356f358d-e5577d-28c89ab5}
OMNIROUTE_BASE_URL=http://0.0.0.0:${PORT:-20128}
EOF
fi

echo "Starting OmniRoute on port ${PORT:-20128}..."
exec omniroute serve --port "${PORT:-20128}" --no-open
