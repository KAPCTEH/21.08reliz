CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- Legacy clients could persist a valid warehouse code in lower or mixed case.
-- SQLite upper()/NOCASE only know ASCII, so fold every Russian letter through
-- an explicit Unicode map and then use upper() for Latin before installing the
-- canonical-invariant triggers below.
WITH RECURSIVE
permission_rows(owner_id, permission_key, permission_value) AS (
  SELECT users.id, permission.key, CAST(permission.value AS TEXT)
  FROM users,
       json_each(CASE WHEN json_valid(users.permissions_json) THEN users.permissions_json ELSE '[]' END) AS permission
),
permission_seed(owner_id, permission_key, permission_value) AS (
  SELECT owner_id, permission_key, permission_value
  FROM permission_rows
  WHERE substr(permission_value,1,18) = 'jf.warehouse-code:'
),
permission_fold(owner_id, permission_key, step, permission_value) AS (
  SELECT owner_id, permission_key, 0, permission_value FROM permission_seed
  UNION ALL
  SELECT
    owner_id,
    permission_key,
    step + 1,
    CASE
      WHEN substr(permission_value,1,18) = 'jf.warehouse-code:' THEN
        'jf.warehouse-code:' || replace(
          substr(permission_value,19),
          substr('абвгдеёжзийклмнопрстуфхцчшщъыьэюя',step + 1,1),
          substr('АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',step + 1,1)
        )
      ELSE permission_value
    END
  FROM permission_fold
  WHERE step < 33
),
normalized_codes(owner_id, permission_key, permission_value) AS (
  SELECT
    owner_id,
    permission_key,
    CASE
      WHEN substr(permission_value,1,18) = 'jf.warehouse-code:' THEN
        'jf.warehouse-code:' || upper(substr(permission_value,19))
      ELSE permission_value
    END
  FROM permission_fold
  WHERE step = 33
),
normalized_permissions(owner_id, permission_key, permission_value) AS (
  SELECT
    permission_rows.owner_id,
    permission_rows.permission_key,
    COALESCE(normalized_codes.permission_value, permission_rows.permission_value)
  FROM permission_rows
  LEFT JOIN normalized_codes
    ON normalized_codes.owner_id = permission_rows.owner_id
   AND normalized_codes.permission_key = permission_rows.permission_key
),
normalized_users(owner_id, permissions_json) AS (
  SELECT owner_id, json_group_array(permission_value)
  FROM (
    SELECT owner_id, permission_key, permission_value
    FROM normalized_permissions
    ORDER BY owner_id, CAST(permission_key AS INTEGER)
  )
  GROUP BY owner_id
)
UPDATE users
SET permissions_json = COALESCE(
  (SELECT normalized_users.permissions_json FROM normalized_users WHERE normalized_users.owner_id = users.id),
  '[]'
);

WITH RECURSIVE
permission_rows(owner_id, permission_key, permission_value) AS (
  SELECT invitations.id, permission.key, CAST(permission.value AS TEXT)
  FROM invitations,
       json_each(CASE WHEN json_valid(invitations.permissions_json) THEN invitations.permissions_json ELSE '[]' END) AS permission
),
permission_seed(owner_id, permission_key, permission_value) AS (
  SELECT owner_id, permission_key, permission_value
  FROM permission_rows
  WHERE substr(permission_value,1,18) = 'jf.warehouse-code:'
),
permission_fold(owner_id, permission_key, step, permission_value) AS (
  SELECT owner_id, permission_key, 0, permission_value FROM permission_seed
  UNION ALL
  SELECT
    owner_id,
    permission_key,
    step + 1,
    CASE
      WHEN substr(permission_value,1,18) = 'jf.warehouse-code:' THEN
        'jf.warehouse-code:' || replace(
          substr(permission_value,19),
          substr('абвгдеёжзийклмнопрстуфхцчшщъыьэюя',step + 1,1),
          substr('АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',step + 1,1)
        )
      ELSE permission_value
    END
  FROM permission_fold
  WHERE step < 33
),
normalized_codes(owner_id, permission_key, permission_value) AS (
  SELECT
    owner_id,
    permission_key,
    CASE
      WHEN substr(permission_value,1,18) = 'jf.warehouse-code:' THEN
        'jf.warehouse-code:' || upper(substr(permission_value,19))
      ELSE permission_value
    END
  FROM permission_fold
  WHERE step = 33
),
normalized_permissions(owner_id, permission_key, permission_value) AS (
  SELECT
    permission_rows.owner_id,
    permission_rows.permission_key,
    COALESCE(normalized_codes.permission_value, permission_rows.permission_value)
  FROM permission_rows
  LEFT JOIN normalized_codes
    ON normalized_codes.owner_id = permission_rows.owner_id
   AND normalized_codes.permission_key = permission_rows.permission_key
),
normalized_invitations(owner_id, permissions_json) AS (
  SELECT owner_id, json_group_array(permission_value)
  FROM (
    SELECT owner_id, permission_key, permission_value
    FROM normalized_permissions
    ORDER BY owner_id, CAST(permission_key AS INTEGER)
  )
  GROUP BY owner_id
)
UPDATE invitations
SET permissions_json = COALESCE(
  (
    SELECT normalized_invitations.permissions_json
    FROM normalized_invitations
    WHERE normalized_invitations.owner_id = invitations.id
  ),
  '[]'
);

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

-- A lease is granted only if no account and no still-pending invitation has an
-- exact assignment to this warehouse. Global grants are intentionally ignored.
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

-- While active is unexpired or prepared is durable, exact assignments cannot
-- be inserted or added. '*' and 'jf.warehouse:*' remain non-exact grants.
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

INSERT OR REPLACE INTO schema_migrations(version, applied_at)
VALUES ('007-warehouse-delete-leases', datetime('now'));
