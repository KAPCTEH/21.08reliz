PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  data_api_address TEXT,
  data_api_port INTEGER CHECK (data_api_port IS NULL OR data_api_port BETWEEN 1 AND 65535),
  data_api_tls_sha256 TEXT,
  data_api_updated_at TEXT,
  telegram_worker_url TEXT,
  telegram_client_key_ciphertext TEXT,
  telegram_bot_username TEXT,
  telegram_installation_id TEXT,
  telegram_deployment_version TEXT,
  telegram_updated_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL UNIQUE REFERENCES companies(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  max_employees INTEGER NOT NULL DEFAULT 25 CHECK (max_employees BETWEEN 1 AND 1000),
  max_devices_per_user INTEGER NOT NULL DEFAULT 3 CHECK (max_devices_per_user BETWEEN 1 AND 100),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  login TEXT NOT NULL COLLATE NOCASE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (length(trim(role)) BETWEEN 2 AND 50),
  permissions_json TEXT NOT NULL DEFAULT '[]',
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, login)
);

CREATE TABLE IF NOT EXISTS license_claims (
  license_id TEXT PRIMARY KEY REFERENCES licenses(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL UNIQUE,
  claimed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  device_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(user_id, device_hash)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  refresh_hash TEXT NOT NULL UNIQUE,
  parent_session_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  login TEXT NOT NULL COLLATE NOCASE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (lower(trim(role)) <> 'owner' AND length(trim(role)) BETWEEN 2 AND 50),
  permissions_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invitation_claims (
  invitation_id TEXT PRIMARY KEY REFERENCES invitations(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL UNIQUE,
  claimed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_devices (
  device_hash TEXT PRIMARY KEY,
  first_started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id, status);
CREATE INDEX IF NOT EXISTS idx_devices_company ON devices(company_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_refresh ON sessions(refresh_hash, status);
CREATE INDEX IF NOT EXISTS idx_invitations_company ON invitations(company_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_company_time ON audit_log(company_id, created_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES
  ('002-company-data-service', 'schema-baseline-7.8.3'),
  ('003-company-telegram-service', 'schema-baseline-7.8.3'),
  ('004-custom-roles', 'schema-baseline-7.8.3'),
  ('005-granular-permissions-audit', 'schema-baseline-7.8.3'),
  ('006-exact-permissions', 'schema-baseline-7.8.3');

CREATE TRIGGER IF NOT EXISTS enforce_employee_limit
BEFORE INSERT ON users
WHEN NEW.role <> 'owner' AND (
  SELECT COUNT(*) FROM users WHERE company_id = NEW.company_id AND role <> 'owner'
) >= (
  SELECT max_employees FROM licenses WHERE company_id = NEW.company_id
)
BEGIN
  SELECT RAISE(ABORT, 'EMPLOYEE_LIMIT_REACHED');
END;

CREATE TRIGGER IF NOT EXISTS enforce_device_limit
BEFORE INSERT ON devices
WHEN (
  SELECT COUNT(*) FROM devices WHERE user_id = NEW.user_id
) >= (
  SELECT max_devices_per_user FROM licenses WHERE company_id = NEW.company_id
)
BEGIN
  SELECT RAISE(ABORT, 'DEVICE_LIMIT_REACHED');
END;
