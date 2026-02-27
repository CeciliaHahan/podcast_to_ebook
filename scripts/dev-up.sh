#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
PG_BIN="/opt/homebrew/opt/postgresql@16/bin"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required."
  exit 1
fi

if ! brew list --versions postgresql@16 >/dev/null 2>&1; then
  echo "postgresql@16 is not installed. Installing..."
  brew install postgresql@16
fi

echo "Starting PostgreSQL service..."
brew services start postgresql@16 >/dev/null || true

if [ ! -f "$BACKEND_DIR/.env" ]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
fi

if ! grep -q '^DATABASE_URL=' "$BACKEND_DIR/.env"; then
  echo "DATABASE_URL=postgresql:///podcasts_to_ebooks" >>"$BACKEND_DIR/.env"
fi

echo "Ensuring database exists..."
"$PG_BIN"/createdb podcasts_to_ebooks >/dev/null 2>&1 || true

echo "Running migration..."
(
  cd "$BACKEND_DIR"
  source .env
  "$PG_BIN"/psql "$DATABASE_URL" -f migrations/0001_init.sql >/dev/null
)

echo "Installing backend dependencies..."
(
  cd "$BACKEND_DIR"
  npm install >/dev/null
  npm run build >/dev/null
)

if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Backend already running on :8080"
else
  echo "Starting backend..."
  (
    cd "$BACKEND_DIR"
    nohup node dist/index.js </dev/null >/tmp/podcasts_to_ebooks_backend.log 2>&1 &
  )
  sleep 1
fi

echo "Done. Health:"
curl -sS http://localhost:8080/healthz || true
echo
