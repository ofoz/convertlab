-- ConvertLab schema (PostgreSQL 16+). All timestamps are unix milliseconds (bigint).

CREATE TABLE IF NOT EXISTS users (
  id                 UUID PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE,
  password_hash      TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  quota_jobs         INTEGER,
  quota_upload_bytes BIGINT,
  quota_output_bytes BIGINT,
  created_at         BIGINT NOT NULL,
  updated_at         BIGINT NOT NULL,
  last_login_at      BIGINT,
  disabled_reason    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  created_at   BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  expires_at   BIGINT NOT NULL,
  revoked_at   BIGINT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS jobs (
  id               UUID PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL CHECK (status IN ('queued','processing','success','partial','failed','cancelled')),
  target           TEXT NOT NULL,
  options          JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_files      INTEGER NOT NULL DEFAULT 0,
  done_files       INTEGER NOT NULL DEFAULT 0,
  failed_files     INTEGER NOT NULL DEFAULT 0,
  progress         INTEGER NOT NULL DEFAULT 0,
  error            TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       BIGINT NOT NULL,
  started_at       BIGINT,
  finished_at      BIGINT,
  expires_at       BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_user_created ON jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_expires ON jobs(expires_at);

CREATE TABLE IF NOT EXISTS job_files (
  id            UUID PRIMARY KEY,
  job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  source_ext    TEXT NOT NULL,
  source_mime   TEXT NOT NULL,
  source_size   BIGINT NOT NULL,
  source_path   TEXT NOT NULL,
  output_ext    TEXT,
  output_path   TEXT,
  output_size   BIGINT,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','success','failed','expired','cancelled')),
  progress      INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  duration_ms   INTEGER,
  created_at    BIGINT NOT NULL,
  expires_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_files_job ON job_files(job_id, position);
CREATE INDEX IF NOT EXISTS idx_job_files_expiry ON job_files(expires_at);

CREATE TABLE IF NOT EXISTS daily_usage (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day          DATE NOT NULL,
  jobs         INTEGER NOT NULL DEFAULT 0,
  upload_bytes BIGINT NOT NULL DEFAULT 0,
  output_bytes BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail      JSONB,
  ip          TEXT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
