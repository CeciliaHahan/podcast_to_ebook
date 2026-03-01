#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
PG_ISREADY="$PG_BIN/pg_isready"

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

echo "Waiting for PostgreSQL readiness..."
for _ in $(seq 1 30); do
  if "$PG_ISREADY" -q; then
    break
  fi
  sleep 1
done
if ! "$PG_ISREADY" -q; then
  echo "PostgreSQL did not become ready in time."
  echo "Check: brew services list"
  exit 1
fi

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
    if command -v setsid >/dev/null 2>&1; then
      nohup setsid node dist/index.js </dev/null >/tmp/podcasts_to_ebooks_backend.log 2>&1 &
    else
      nohup node dist/index.js </dev/null >/tmp/podcasts_to_ebooks_backend.log 2>&1 &
    fi
  )
fi

echo "Waiting for backend health..."
for _ in $(seq 1 30); do
  if curl -fsS http://localhost:8080/healthz >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! curl -fsS http://localhost:8080/healthz >/dev/null 2>&1; then
  echo "Backend did not pass health check in time."
  echo "Log tail (/tmp/podcasts_to_ebooks_backend.log):"
  tail -n 80 /tmp/podcasts_to_ebooks_backend.log || true
  exit 1
fi

echo "Done. Health:"
curl -fsS http://localhost:8080/healthz
echo
