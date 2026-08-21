-- D1 rejects explicit BEGIN/COMMIT in remote imports. All tables that reference
-- users or invitations are moved to a legacy graph first, then rebuilt against
-- the new parent tables. This prevents ON DELETE CASCADE from losing devices,
-- sessions or invitation claims while the role CHECK constraints are replaced.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

DROP TRIGGER IF EXISTS enforce_employee_limit;
DROP TRIGGER IF EXISTS enforce_device_limit;

ALTER TABLE invitation_claims RENAME TO invitation_claims_legacy_v004;
ALTER TABLE sessions RENAME TO sessions_legacy_v004;
ALTER TABLE devices RENAME TO devices_legacy_v004;
ALTER TABLE invitations RENAME TO invitations_legacy_v004;
ALTER TABLE users RENAME TO users_legacy_v004;

CREATE TABLE users (
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
INSERT INTO users SELECT * FROM users_legacy_v004;

CREATE TABLE devices (
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
INSERT INTO devices SELECT * FROM devices_legacy_v004;

CREATE TABLE sessions (
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
INSERT INTO sessions SELECT * FROM sessions_legacy_v004;

CREATE TABLE invitations (
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
INSERT INTO invitations SELECT * FROM invitations_legacy_v004;

CREATE TABLE invitation_claims (
  invitation_id TEXT PRIMARY KEY REFERENCES invitations(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL UNIQUE,
  claimed_at TEXT NOT NULL
);
INSERT INTO invitation_claims SELECT * FROM invitation_claims_legacy_v004;

DROP TABLE invitation_claims_legacy_v004;
DROP TABLE sessions_legacy_v004;
DROP TABLE invitations_legacy_v004;
DROP TABLE devices_legacy_v004;
DROP TABLE users_legacy_v004;

CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id, status);
CREATE INDEX IF NOT EXISTS idx_devices_company ON devices(company_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_refresh ON sessions(refresh_hash, status);
CREATE INDEX IF NOT EXISTS idx_invitations_company ON invitations(company_id, expires_at);

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

INSERT OR REPLACE INTO schema_migrations(version, applied_at)
VALUES ('004-custom-roles', datetime('now'));
