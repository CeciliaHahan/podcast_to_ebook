#!/usr/bin/env bash
set -euo pipefail

echo "Stopping backend on :8080 (if running)..."
PIDS="$(lsof -tiTCP:8080 -sTCP:LISTEN || true)"
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill
  sleep 1
fi

echo "Stopping PostgreSQL service..."
brew services stop postgresql@16 >/dev/null || true

echo "Done."
