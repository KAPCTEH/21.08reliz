PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  data_api_address TEXT,
  data_api_port INTEGER CHECK (data_api_port IS NULL OR data_api_port BETWEEN 1 AND 65535),
  data_api_tls_sha256 TEXT,
  data_api_attestation_secret_ciphertext TEXT,
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
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT
);

CREATE TABLE IF NOT EXISTS invitation_claims (
  invitation_id TEXT PRIMARY KEY REFERENCES invitations(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL UNIQUE,
  claimed_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS reject_invalid_invitation_claim
BEFORE INSERT ON invitation_claims
WHEN EXISTS (
  SELECT 1 FROM invitations
  WHERE id=NEW.invitation_id
    AND (revoked_at IS NOT NULL OR expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)
BEGIN
  SELECT RAISE(ABORT, 'INVITATION_INVALID_OR_EXPIRED');
END;

CREATE TABLE IF NOT EXISTS warehouse_delete_leases (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL COLLATE BINARY,
  warehouse_code TEXT NOT NULL COLLATE BINARY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','prepared','released','expired')),
  expires_at INTEGER NOT NULL CHECK (expires_at > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(warehouse_id) BETWEEN 1 AND 120),
  CHECK (length(warehouse_code) BETWEEN 1 AND 3)
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
CREATE INDEX IF NOT EXISTS idx_sessions_active_user ON sessions(user_id, company_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_sessions_active_device ON sessions(device_id, company_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_invitations_company ON invitations(company_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_company_time ON audit_log(company_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_delete_leases_active_id
ON warehouse_delete_leases(company_id, warehouse_id)
WHERE status IN ('active','prepared');
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_delete_leases_active_code
ON warehouse_delete_leases(company_id, warehouse_code)
WHERE status IN ('active','prepared');
CREATE INDEX IF NOT EXISTS idx_warehouse_delete_leases_cleanup
ON warehouse_delete_leases(company_id, status, expires_at);

CREATE TRIGGER IF NOT EXISTS reject_noncanonical_warehouse_code_user_insert
BEFORE INSERT ON users
WHEN EXISTS (
  SELECT 1
  FROM json_each(CASE WHEN json_valid(NEW.permissions_json) THEN NEW.permissions_json ELSE '[]' END) AS permission
  WHERE substr(CAST(permission.value AS TEXT),1,18) = 'jf.warehouse-code:'
    AND (
      length(substr(CAST(permission.value AS TEXT),19)) NOT BETWEEN 1 AND 3
      OR instr('ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789', substr(CAST(permission.value AS TEXT),19,1)) = 0
      OR instr('ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789', substr(CAST(permission.value AS TEXT),20,1)) = 0
      OR instr('ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789', substr(CAST(permission.value AS TEXT),21,1)) = 0
    )
)
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_CODE_PERMISSION_NOT_CANONICAL');
END;

CREATE TRIGGER IF NOT EXISTS reject_noncanonical_warehouse_code_user_update
BEFORE UPDATE OF permissions_json ON users
WHEN EXISTS (
  SELECT 1
  FROM json_each(CASE WHEN json_valid(NEW.permissions_json) THEN NEW.permissions_json ELSE '[]' END) AS permission
  WHERE substr(CAST(permission.value AS TEXT),1,18) = 'jf.warehouse-code:'
    AND (
      length(substr(CAST(permission.value AS TEXT),19)) NOT BETWEEN 1 AND 3
      OR instr('ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789', substr(CAST(permission.value AS TEXT),19,1)) = 0
      OR instr('ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789', substr(CAST(permission.value AS TEXT),20,1)) = 0
      OR instr('ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789', substr(CAST(permission.value AS TEXT),21,1)) = 0
    )
)
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_CODE_PERMISSION_NOT_CANONICAL');
END;

CREATE TRIGGER IF NOT EXISTS reject_noncanonical_warehouse_code_invitation_insert
BEFORE INSERT ON invitations
WHEN EXISTS (
  SELECT 1
  FROM json_each(CASE WHEN json_valid(NEW.permissions_json) THEN NEW.permissions_json ELSE '[]' END) AS permission
  WHERE substr(CAST(permission.value AS TEXT),1,18) = 'jf.warehouse-code:'
    AND (
      length(substr(CAST(permission.value AS TEXT),19)) NOT BETWEEN 1 AND 3
      OR instr('ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789', substr(CAST(permission.value AS TEXT),19,1)) = 0
      OR instr('ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789', substr(CAST(permission.value AS TEXT),20,1)) = 0
      OR instr('ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789', substr(CAST(permission.value AS TEXT),21,1)) = 0
    )
)
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_CODE_PERMISSION_NOT_CANONICAL');
END;

CREATE TRIGGER IF NOT EXISTS reject_noncanonical_warehouse_code_invitation_update
BEFORE UPDATE OF permissions_json ON invitations
WHEN EXISTS (
  SELECT 1
  FROM json_each(CASE WHEN json_valid(NEW.permissions_json) THEN NEW.permissions_json ELSE '[]' END) AS permission
  WHERE substr(CAST(permission.value AS TEXT),1,18) = 'jf.warehouse-code:'
    AND (
      length(substr(CAST(permission.value AS TEXT),19)) NOT BETWEEN 1 AND 3
      OR instr('ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789', substr(CAST(permission.value AS TEXT),19,1)) = 0
      OR instr('ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789', substr(CAST(permission.value AS TEXT),20,1)) = 0
      OR instr('ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789', substr(CAST(permission.value AS TEXT),21,1)) = 0
    )
)
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_CODE_PERMISSION_NOT_CANONICAL');
END;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES
  ('002-company-data-service', 'schema-baseline-7.8.3'),
  ('003-company-telegram-service', 'schema-baseline-7.8.3'),
  ('004-custom-roles', 'schema-baseline-7.8.3'),
  ('005-granular-permissions-audit', 'schema-baseline-7.8.3'),
  ('006-exact-permissions', 'schema-baseline-7.8.3'),
  ('007-warehouse-delete-leases', 'schema-baseline-7.8.3'),
  ('008-vps-attestations', 'schema-baseline-7.8.3'),
  ('009-invitation-lifecycle', 'schema-baseline-7.8.3'),
  ('010-session-binding', 'schema-baseline-7.8.4');

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

CREATE TRIGGER IF NOT EXISTS reject_warehouse_delete_lease_when_assigned
BEFORE INSERT ON warehouse_delete_leases
WHEN (
   NEW.status = 'prepared'
   OR (NEW.status = 'active' AND NEW.expires_at > CAST(strftime('%s','now') AS INTEGER))
 )
 AND (
   EXISTS (
     SELECT 1
     FROM users AS u,
          json_each(CASE WHEN json_valid(u.permissions_json) THEN u.permissions_json ELSE '[]' END) AS permission
     WHERE u.company_id = NEW.company_id
       AND (
         CAST(permission.value AS TEXT) = 'jf.warehouse:' || NEW.warehouse_id
         OR CAST(permission.value AS TEXT) = 'jf.warehouse-code:' || NEW.warehouse_code
       )
   )
   OR EXISTS (
     SELECT 1
     FROM invitations AS invitation,
          json_each(CASE WHEN json_valid(invitation.permissions_json) THEN invitation.permissions_json ELSE '[]' END) AS permission
     WHERE invitation.company_id = NEW.company_id
       AND invitation.revoked_at IS NULL
       AND invitation.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
       AND NOT EXISTS (
         SELECT 1 FROM invitation_claims AS claim WHERE claim.invitation_id = invitation.id
       )
       AND (
         CAST(permission.value AS TEXT) = 'jf.warehouse:' || NEW.warehouse_id
         OR CAST(permission.value AS TEXT) = 'jf.warehouse-code:' || NEW.warehouse_code
       )
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_ASSIGNED');
END;

CREATE TRIGGER IF NOT EXISTS reject_warehouse_delete_lease_reactivation_when_assigned
BEFORE UPDATE OF company_id, warehouse_id, warehouse_code, status, expires_at ON warehouse_delete_leases
WHEN (
   NEW.status = 'prepared'
   OR (NEW.status = 'active' AND NEW.expires_at > CAST(strftime('%s','now') AS INTEGER))
 )
 AND (
   EXISTS (
     SELECT 1
     FROM users AS u,
          json_each(CASE WHEN json_valid(u.permissions_json) THEN u.permissions_json ELSE '[]' END) AS permission
     WHERE u.company_id = NEW.company_id
       AND (
         CAST(permission.value AS TEXT) = 'jf.warehouse:' || NEW.warehouse_id
         OR CAST(permission.value AS TEXT) = 'jf.warehouse-code:' || NEW.warehouse_code
       )
   )
   OR EXISTS (
     SELECT 1
     FROM invitations AS invitation,
          json_each(CASE WHEN json_valid(invitation.permissions_json) THEN invitation.permissions_json ELSE '[]' END) AS permission
     WHERE invitation.company_id = NEW.company_id
       AND invitation.revoked_at IS NULL
       AND invitation.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
       AND NOT EXISTS (
         SELECT 1 FROM invitation_claims AS claim WHERE claim.invitation_id = invitation.id
       )
       AND (
         CAST(permission.value AS TEXT) = 'jf.warehouse:' || NEW.warehouse_id
         OR CAST(permission.value AS TEXT) = 'jf.warehouse-code:' || NEW.warehouse_code
       )
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_ASSIGNED');
END;

CREATE TRIGGER IF NOT EXISTS reject_warehouse_delete_lease_terminal_reopen
BEFORE UPDATE OF status ON warehouse_delete_leases
WHEN OLD.status IN ('released','expired') AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_DELETE_LEASE_INVALID_TRANSITION');
END;

CREATE TRIGGER IF NOT EXISTS reject_warehouse_delete_lease_prepared_reopen
BEFORE UPDATE OF status ON warehouse_delete_leases
WHEN OLD.status = 'prepared' AND NEW.status NOT IN ('prepared','released')
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_DELETE_LEASE_INVALID_TRANSITION');
END;

CREATE TRIGGER IF NOT EXISTS reject_warehouse_delete_lease_rescope
BEFORE UPDATE OF company_id, warehouse_id, warehouse_code, created_at
ON warehouse_delete_leases
WHEN NEW.company_id <> OLD.company_id
  OR NEW.warehouse_id <> OLD.warehouse_id
  OR NEW.warehouse_code <> OLD.warehouse_code
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_DELETE_LEASE_SCOPE_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS reject_warehouse_delete_lease_actor_takeover_without_rotation
BEFORE UPDATE OF actor_user_id ON warehouse_delete_leases
WHEN NEW.actor_user_id <> OLD.actor_user_id
 AND (OLD.status <> 'prepared' OR NEW.status <> 'prepared' OR NEW.token_hash = OLD.token_hash)
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_DELETE_LEASE_ACTOR_TAKEOVER_INVALID');
END;

CREATE TRIGGER IF NOT EXISTS reject_warehouse_delete_lease_active_token_rotation
BEFORE UPDATE OF token_hash ON warehouse_delete_leases
WHEN OLD.status <> 'prepared' OR NEW.status <> 'prepared'
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_DELETE_LEASE_TOKEN_ROTATION_FORBIDDEN');
END;

CREATE TRIGGER IF NOT EXISTS reject_user_warehouse_assignment_during_delete_insert
BEFORE INSERT ON users
WHEN EXISTS (
  SELECT 1
  FROM warehouse_delete_leases AS lease,
       json_each(CASE WHEN json_valid(NEW.permissions_json) THEN NEW.permissions_json ELSE '[]' END) AS permission
  WHERE lease.company_id = NEW.company_id
    AND (
      lease.status = 'prepared'
      OR (lease.status = 'active' AND lease.expires_at > CAST(strftime('%s','now') AS INTEGER))
    )
    AND (
      CAST(permission.value AS TEXT) = 'jf.warehouse:' || lease.warehouse_id
      OR CAST(permission.value AS TEXT) = 'jf.warehouse-code:' || lease.warehouse_code
    )
)
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_DELETE_IN_PROGRESS');
END;

CREATE TRIGGER IF NOT EXISTS reject_user_warehouse_assignment_during_delete_update
BEFORE UPDATE OF company_id, permissions_json ON users
WHEN EXISTS (
  SELECT 1
  FROM warehouse_delete_leases AS lease,
       json_each(CASE WHEN json_valid(NEW.permissions_json) THEN NEW.permissions_json ELSE '[]' END) AS permission
  WHERE lease.company_id = NEW.company_id
    AND (
      lease.status = 'prepared'
      OR (lease.status = 'active' AND lease.expires_at > CAST(strftime('%s','now') AS INTEGER))
    )
    AND (
      CAST(permission.value AS TEXT) = 'jf.warehouse:' || lease.warehouse_id
      OR CAST(permission.value AS TEXT) = 'jf.warehouse-code:' || lease.warehouse_code
    )
)
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_DELETE_IN_PROGRESS');
END;

CREATE TRIGGER IF NOT EXISTS reject_invitation_warehouse_assignment_during_delete_insert
BEFORE INSERT ON invitations
WHEN EXISTS (
  SELECT 1
  FROM warehouse_delete_leases AS lease,
       json_each(CASE WHEN json_valid(NEW.permissions_json) THEN NEW.permissions_json ELSE '[]' END) AS permission
  WHERE lease.company_id = NEW.company_id
    AND (
      lease.status = 'prepared'
      OR (lease.status = 'active' AND lease.expires_at > CAST(strftime('%s','now') AS INTEGER))
    )
    AND (
      CAST(permission.value AS TEXT) = 'jf.warehouse:' || lease.warehouse_id
      OR CAST(permission.value AS TEXT) = 'jf.warehouse-code:' || lease.warehouse_code
    )
)
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_DELETE_IN_PROGRESS');
END;

CREATE TRIGGER IF NOT EXISTS reject_invitation_warehouse_assignment_during_delete_update
BEFORE UPDATE OF company_id, permissions_json, expires_at ON invitations
WHEN EXISTS (
  SELECT 1
  FROM warehouse_delete_leases AS lease,
       json_each(CASE WHEN json_valid(NEW.permissions_json) THEN NEW.permissions_json ELSE '[]' END) AS permission
  WHERE lease.company_id = NEW.company_id
    AND (
      lease.status = 'prepared'
      OR (lease.status = 'active' AND lease.expires_at > CAST(strftime('%s','now') AS INTEGER))
    )
    AND (
      CAST(permission.value AS TEXT) = 'jf.warehouse:' || lease.warehouse_id
      OR CAST(permission.value AS TEXT) = 'jf.warehouse-code:' || lease.warehouse_code
    )
)
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_DELETE_IN_PROGRESS');
END;
