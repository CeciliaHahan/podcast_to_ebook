#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
PG_PREFIX="/opt/homebrew/opt/postgresql@16"
PG_DATA_DIR="/opt/homebrew/var/postgresql@16"
PG_CTL="$PG_PREFIX/bin/pg_ctl"
PG_ISREADY="$PG_PREFIX/bin/pg_isready"
PG_PSQL="$PG_PREFIX/bin/psql"
PG_CREATEDB="$PG_PREFIX/bin/createdb"
PG_LOG="/tmp/postgresql16.log"
BACKEND_LOG="/tmp/podcasts_to_ebooks_backend.log"

BASE_URL="${BASE_URL:-http://localhost:8080}"
DASHBOARD_PORT="${DASHBOARD_PORT:-4174}"
DASHBOARD_HOST="${DASHBOARD_HOST:-127.0.0.1}"
DASHBOARD_ARGS="${DASHBOARD_ARGS:-}"

if [ ! -x "$PG_CTL" ]; then
  echo "PostgreSQL 16 not found at $PG_PREFIX"
  echo "Install with: brew install postgresql@16"
  exit 1
fi

if [ ! -d "$PG_DATA_DIR" ]; then
  echo "Postgres data directory missing: $PG_DATA_DIR"
  echo "Initialize once with: initdb \"$PG_DATA_DIR\""
  exit 1
fi

echo "[1/6] Ensure PostgreSQL is running"
if ! "$PG_ISREADY" -h localhost -p 5432 >/dev/null 2>&1; then
  if [ -f "$PG_DATA_DIR/postmaster.pid" ]; then
    STALE_PID="$(head -n 1 "$PG_DATA_DIR/postmaster.pid" 2>/dev/null || true)"
    if [ -n "$STALE_PID" ] && ! ps -p "$STALE_PID" >/dev/null 2>&1; then
      echo "Removing stale postmaster.pid (pid=$STALE_PID)"
      rm -f "$PG_DATA_DIR/postmaster.pid"
    fi
  fi

  "$PG_CTL" -D "$PG_DATA_DIR" -l "$PG_LOG" start
fi

for _ in $(seq 1 30); do
  if "$PG_ISREADY" -h localhost -p 5432 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! "$PG_ISREADY" -h localhost -p 5432 >/dev/null 2>&1; then
  echo "PostgreSQL did not become ready in time."
  [ -f "$PG_LOG" ] && tail -n 80 "$PG_LOG" || true
  exit 1
fi

echo "[2/6] Ensure backend env + role + database"
if [ ! -f "$BACKEND_DIR/.env" ]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
fi
if ! grep -q '^DATABASE_URL=' "$BACKEND_DIR/.env"; then
  echo "DATABASE_URL=postgres://postgres:postgres@localhost:5432/podcasts_to_ebooks" >>"$BACKEND_DIR/.env"
fi

(
  cd "$BACKEND_DIR"
  set -a
  source .env
  set +a

  "$PG_PSQL" -d postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres LOGIN SUPERUSER PASSWORD 'postgres';
  ELSE
    ALTER ROLE postgres WITH LOGIN SUPERUSER PASSWORD 'postgres';
  END IF;
END$$;
SQL

  DB_NAME="$(printf '%s\n' "$DATABASE_URL" | sed -E 's|.*/([^/?]+).*|\1|')"
  "$PG_CREATEDB" -U postgres "$DB_NAME" >/dev/null 2>&1 || true
  "$PG_PSQL" "$DATABASE_URL" -f migrations/0001_init.sql >/dev/null
)

echo "[3/6] Build backend"
(
  cd "$BACKEND_DIR"
  npm install >/dev/null
  npm run build >/dev/null
)

echo "[4/6] Start backend"
if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Backend already listening on :8080"
else
  (
    cd "$BACKEND_DIR"
    nohup node dist/index.js </dev/null >"$BACKEND_LOG" 2>&1 &
  )
fi

for _ in $(seq 1 30); do
  if curl -fsS "$BASE_URL/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! curl -fsS "$BASE_URL/healthz" >/dev/null 2>&1; then
  echo "Backend failed health check."
  [ -f "$BACKEND_LOG" ] && tail -n 120 "$BACKEND_LOG" || true
  exit 1
fi

echo "[5/6] Backend healthy at $BASE_URL"
curl -fsS "$BASE_URL/healthz"
echo

echo "[6/6] Launch dashboard (Ctrl+C to stop dashboard)"
cd "$ROOT_DIR"
exec node scripts/observe-staged-booklet-run.mjs --base-url "$BASE_URL" --host "$DASHBOARD_HOST" --port "$DASHBOARD_PORT" $DASHBOARD_ARGS
