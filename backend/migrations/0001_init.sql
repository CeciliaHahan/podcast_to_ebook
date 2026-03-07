-- Podcasts_to_ebooks V1 database schema (PostgreSQL)
-- Simplified: only the users table is actively used by the backend dev tools.

CREATE TABLE users (
  id TEXT PRIMARY KEY CHECK (id ~ '^usr_[a-zA-Z0-9]+$'),
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_ux ON users ((LOWER(email)));
