ALTER TABLE invitations ADD COLUMN revoked_at TEXT;
ALTER TABLE invitations ADD COLUMN revoked_by TEXT;

CREATE TRIGGER reject_invalid_invitation_claim
BEFORE INSERT ON invitation_claims
WHEN EXISTS (
  SELECT 1 FROM invitations
  WHERE id=NEW.invitation_id
    AND (revoked_at IS NOT NULL OR expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)
BEGIN
  SELECT RAISE(ABORT, 'INVITATION_INVALID_OR_EXPIRED');
END;

DROP TRIGGER IF EXISTS reject_warehouse_delete_lease_insert_when_assigned;
CREATE TRIGGER reject_warehouse_delete_lease_insert_when_assigned
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

DROP TRIGGER IF EXISTS reject_warehouse_delete_lease_reactivation_when_assigned;
CREATE TRIGGER reject_warehouse_delete_lease_reactivation_when_assigned
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

INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES ('009-invitation-lifecycle', datetime('now'));
