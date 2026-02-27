-- Podcasts_to_ebooks V1 database schema (PostgreSQL)
-- Date: 2026-02-26

-- Optional: required for gen_random_uuid() if you later use UUID ids.
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Reference enums
CREATE TYPE source_type AS ENUM ('transcript', 'audio', 'rss', 'link');
CREATE TYPE job_status AS ENUM ('queued', 'processing', 'succeeded', 'failed', 'canceled');
CREATE TYPE artifact_type AS ENUM ('epub', 'pdf', 'md');
CREATE TYPE event_level AS ENUM ('info', 'warn', 'error');

-- 2) User + access model (email magic link + allowlist)
CREATE TABLE users (
  id TEXT PRIMARY KEY CHECK (id ~ '^usr_[a-zA-Z0-9]+$'),
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX users_email_lower_ux ON users ((LOWER(email)));

CREATE TABLE invite_allowlist (
  id TEXT PRIMARY KEY CHECK (id ~ '^inv_[a-zA-Z0-9]+$'),
  email TEXT NOT NULL,
  note TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  invited_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX invite_allowlist_email_lower_ux ON invite_allowlist ((LOWER(email)));

CREATE TABLE magic_link_tokens (
  id TEXT PRIMARY KEY CHECK (id ~ '^mlt_[a-zA-Z0-9]+$'),
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_ip INET,
  user_agent TEXT
);
CREATE INDEX magic_link_tokens_user_id_idx ON magic_link_tokens (user_id);
CREATE INDEX magic_link_tokens_expires_at_idx ON magic_link_tokens (expires_at);

-- 3) Compliance acceptance record (immutable per job)
CREATE TABLE compliance_records (
  id TEXT PRIMARY KEY CHECK (id ~ '^cmp_[a-zA-Z0-9]+$'),
  user_id TEXT NOT NULL REFERENCES users(id),
  for_personal_or_authorized_use_only BOOLEAN NOT NULL,
  no_commercial_use BOOLEAN NOT NULL,
  acceptance_copy TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_ip INET,
  user_agent TEXT
);
CREATE INDEX compliance_records_user_id_idx ON compliance_records (user_id);

-- 4) Jobs
CREATE TABLE jobs (
  id TEXT PRIMARY KEY CHECK (id ~ '^job_[a-zA-Z0-9]+$'),
  user_id TEXT NOT NULL REFERENCES users(id),
  source_type source_type NOT NULL,
  status job_status NOT NULL DEFAULT 'queued',
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  stage TEXT NOT NULL DEFAULT 'queued',
  title TEXT,
  language TEXT,
  template_id TEXT NOT NULL DEFAULT 'templateA-v0-book',
  output_formats JSONB NOT NULL,
  source_ref TEXT,
  source_hash TEXT,
  input_char_count INTEGER,
  input_duration_seconds INTEGER,
  idempotency_key TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  compliance_record_id TEXT NOT NULL REFERENCES compliance_records(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(output_formats) = 'array')
);
CREATE UNIQUE INDEX jobs_user_id_idempotency_key_ux
  ON jobs (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX jobs_user_id_created_at_idx ON jobs (user_id, created_at DESC);
CREATE INDEX jobs_status_created_at_idx ON jobs (status, created_at);
CREATE INDEX jobs_source_type_created_at_idx ON jobs (source_type, created_at);

-- 5) Job input metadata (raw data should live in object storage)
CREATE TABLE job_inputs (
  id TEXT PRIMARY KEY CHECK (id ~ '^inp_[a-zA-Z0-9]+$'),
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  transcript_storage_uri TEXT,
  audio_storage_uri TEXT,
  rss_url TEXT,
  rss_episode_id TEXT,
  episode_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX job_inputs_rss_url_idx ON job_inputs (rss_url);

-- 6) Artifacts
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY CHECK (id ~ '^art_[a-zA-Z0-9]+$'),
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type artifact_type NOT NULL,
  file_name TEXT NOT NULL,
  storage_uri TEXT NOT NULL,
  download_url_last_issued_at TIMESTAMPTZ,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, type)
);
CREATE INDEX artifacts_job_id_idx ON artifacts (job_id);
CREATE INDEX artifacts_expires_at_idx ON artifacts (expires_at);

-- 7) Job events for timeline + debugging
CREATE TABLE job_events (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_level event_level NOT NULL DEFAULT 'info',
  stage TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX job_events_job_id_created_at_idx ON job_events (job_id, created_at);

-- 8) Daily quota snapshots (beta control)
CREATE TABLE user_daily_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  submitted_jobs INTEGER NOT NULL DEFAULT 0 CHECK (submitted_jobs >= 0),
  succeeded_jobs INTEGER NOT NULL DEFAULT 0 CHECK (succeeded_jobs >= 0),
  failed_jobs INTEGER NOT NULL DEFAULT 0 CHECK (failed_jobs >= 0),
  PRIMARY KEY (user_id, usage_date)
);

-- 9) Recommended triggers/jobs handled by app layer:
-- - update jobs.updated_at on state changes
-- - append job_events on each major transition
-- - enforce max active jobs per user (2) and daily jobs (10)
-- - enforce transcript/audio limits before enqueue
