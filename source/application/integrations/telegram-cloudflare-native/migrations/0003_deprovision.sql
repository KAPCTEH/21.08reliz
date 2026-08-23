PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS telegram_deprovision_markers (
  installation_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('deprovisioning','deprovisioned')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK(attempt_count > 0),
  last_error_code TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  deprovisioned_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK(
    (status='deprovisioning' AND deprovisioned_at IS NULL)
    OR (status='deprovisioned' AND deprovisioned_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_deprovision_scope
  ON telegram_deprovision_markers(company_id, warehouse_id);

CREATE TRIGGER IF NOT EXISTS reject_telegram_deprovision_marker_delete
BEFORE DELETE ON telegram_deprovision_markers
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_DEPROVISION_MARKER_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS reject_telegram_deprovision_marker_rescope
BEFORE UPDATE OF installation_id, company_id, warehouse_id ON telegram_deprovision_markers
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_DEPROVISION_MARKER_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS reject_telegram_deprovision_marker_reopen
BEFORE UPDATE OF status ON telegram_deprovision_markers
WHEN OLD.status='deprovisioned' AND NEW.status!='deprovisioned'
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_DEPROVISION_MARKER_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS require_telegram_data_purge_before_deprovision_complete
BEFORE UPDATE OF status ON telegram_deprovision_markers
WHEN OLD.status!='deprovisioned' AND NEW.status='deprovisioned'
 AND (
   EXISTS (SELECT 1 FROM chat_bindings_v2 WHERE installation_id=NEW.installation_id AND company_id=NEW.company_id AND warehouse_id=NEW.warehouse_id)
   OR EXISTS (SELECT 1 FROM link_codes_v2 WHERE installation_id=NEW.installation_id AND company_id=NEW.company_id AND warehouse_id=NEW.warehouse_id)
   OR EXISTS (SELECT 1 FROM notifications_v2 WHERE installation_id=NEW.installation_id AND company_id=NEW.company_id AND warehouse_id=NEW.warehouse_id)
   OR EXISTS (SELECT 1 FROM events_v2 WHERE installation_id=NEW.installation_id AND company_id=NEW.company_id AND warehouse_id=NEW.warehouse_id)
   OR EXISTS (SELECT 1 FROM telegram_updates_v2 WHERE installation_id=NEW.installation_id AND company_id=NEW.company_id AND warehouse_id=NEW.warehouse_id)
   OR (
     EXISTS (
       SELECT 1 FROM telegram_legacy_claims
       WHERE source_key=('warehouse:' || NEW.company_id || ':' || NEW.warehouse_id)
         AND installation_id=NEW.installation_id
     )
     AND (
       EXISTS (SELECT 1 FROM chat_bindings WHERE warehouse_id=NEW.warehouse_id)
       OR EXISTS (SELECT 1 FROM link_codes WHERE warehouse_id=NEW.warehouse_id)
       OR EXISTS (SELECT 1 FROM notifications WHERE warehouse_id=NEW.warehouse_id)
       OR EXISTS (SELECT 1 FROM events WHERE warehouse_id=NEW.warehouse_id)
     )
   )
   OR (
     EXISTS (
       SELECT 1 FROM telegram_legacy_claims
       WHERE source_key='telegram_updates:global'
         AND installation_id=NEW.installation_id
     )
     AND EXISTS (SELECT 1 FROM telegram_updates)
   )
   OR EXISTS (
     SELECT 1 FROM telegram_provisioning_operations
     WHERE installation_id=NEW.installation_id
       AND company_id=NEW.company_id
       AND warehouse_id=NEW.warehouse_id
   )
   OR EXISTS (
     SELECT 1 FROM telegram_legacy_claims
     WHERE installation_id!=NEW.installation_id
       AND substr(source_key,1,10)='warehouse:'
       AND substr(source_key,-(length(NEW.warehouse_id)+1))=(':' || NEW.warehouse_id)
       AND EXISTS (
         SELECT 1 FROM telegram_legacy_claims
         WHERE source_key=('warehouse:' || NEW.company_id || ':' || NEW.warehouse_id)
           AND installation_id=NEW.installation_id
       )
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_DEPROVISION_PURGE_INCOMPLETE');
END;

-- The installation and ownership claims are deliberately retained as durable
-- tombstone metadata.  They prevent a stale provisioner/Worker from silently
-- resurrecting the same scope after its business data has been purged.
CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_installation_insert
BEFORE INSERT ON telegram_installations
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
     OR (marker.company_id=NEW.company_id AND marker.warehouse_id=NEW.warehouse_id)
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_installation_update
BEFORE UPDATE ON telegram_installations
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
     OR (marker.company_id=NEW.company_id AND marker.warehouse_id=NEW.warehouse_id)
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_installation_delete
BEFORE DELETE ON telegram_installations
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=OLD.installation_id
    AND marker.company_id=OLD.company_id
    AND marker.warehouse_id=OLD.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_provisioning_insert
BEFORE INSERT ON telegram_provisioning_operations
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
    AND marker.company_id=NEW.company_id
    AND marker.warehouse_id=NEW.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_provisioning_update
BEFORE UPDATE ON telegram_provisioning_operations
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
    AND marker.company_id=NEW.company_id
    AND marker.warehouse_id=NEW.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_legacy_claim_insert
BEFORE INSERT ON telegram_legacy_claims
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_legacy_claim_update
BEFORE UPDATE ON telegram_legacy_claims
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_legacy_claim_delete
BEFORE DELETE ON telegram_legacy_claims
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=OLD.installation_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_legacy_binding_insert
BEFORE INSERT ON chat_bindings
WHEN EXISTS (
  SELECT 1
  FROM telegram_legacy_claims AS claim
  JOIN telegram_deprovision_markers AS marker
    ON marker.installation_id=claim.installation_id
  WHERE claim.source_key=('warehouse:' || marker.company_id || ':' || NEW.warehouse_id)
    AND marker.warehouse_id=NEW.warehouse_id
    AND NOT EXISTS (
      SELECT 1 FROM telegram_legacy_claims AS other_claim
      WHERE other_claim.installation_id!=claim.installation_id
        AND substr(other_claim.source_key,1,10)='warehouse:'
        AND substr(other_claim.source_key,-(length(NEW.warehouse_id)+1))=(':' || NEW.warehouse_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_legacy_binding_update
BEFORE UPDATE ON chat_bindings
WHEN EXISTS (
  SELECT 1
  FROM telegram_legacy_claims AS claim
  JOIN telegram_deprovision_markers AS marker
    ON marker.installation_id=claim.installation_id
  WHERE claim.source_key=('warehouse:' || marker.company_id || ':' || NEW.warehouse_id)
    AND marker.warehouse_id=NEW.warehouse_id
    AND NOT EXISTS (
      SELECT 1 FROM telegram_legacy_claims AS other_claim
      WHERE other_claim.installation_id!=claim.installation_id
        AND substr(other_claim.source_key,1,10)='warehouse:'
        AND substr(other_claim.source_key,-(length(NEW.warehouse_id)+1))=(':' || NEW.warehouse_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_legacy_link_insert
BEFORE INSERT ON link_codes
WHEN EXISTS (
  SELECT 1
  FROM telegram_legacy_claims AS claim
  JOIN telegram_deprovision_markers AS marker
    ON marker.installation_id=claim.installation_id
  WHERE claim.source_key=('warehouse:' || marker.company_id || ':' || NEW.warehouse_id)
    AND marker.warehouse_id=NEW.warehouse_id
    AND NOT EXISTS (
      SELECT 1 FROM telegram_legacy_claims AS other_claim
      WHERE other_claim.installation_id!=claim.installation_id
        AND substr(other_claim.source_key,1,10)='warehouse:'
        AND substr(other_claim.source_key,-(length(NEW.warehouse_id)+1))=(':' || NEW.warehouse_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_legacy_link_update
BEFORE UPDATE ON link_codes
WHEN EXISTS (
  SELECT 1
  FROM telegram_legacy_claims AS claim
  JOIN telegram_deprovision_markers AS marker
    ON marker.installation_id=claim.installation_id
  WHERE claim.source_key=('warehouse:' || marker.company_id || ':' || NEW.warehouse_id)
    AND marker.warehouse_id=NEW.warehouse_id
    AND NOT EXISTS (
      SELECT 1 FROM telegram_legacy_claims AS other_claim
      WHERE other_claim.installation_id!=claim.installation_id
        AND substr(other_claim.source_key,1,10)='warehouse:'
        AND substr(other_claim.source_key,-(length(NEW.warehouse_id)+1))=(':' || NEW.warehouse_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_legacy_notification_insert
BEFORE INSERT ON notifications
WHEN EXISTS (
  SELECT 1
  FROM telegram_legacy_claims AS claim
  JOIN telegram_deprovision_markers AS marker
    ON marker.installation_id=claim.installation_id
  WHERE claim.source_key=('warehouse:' || marker.company_id || ':' || NEW.warehouse_id)
    AND marker.warehouse_id=NEW.warehouse_id
    AND NOT EXISTS (
      SELECT 1 FROM telegram_legacy_claims AS other_claim
      WHERE other_claim.installation_id!=claim.installation_id
        AND substr(other_claim.source_key,1,10)='warehouse:'
        AND substr(other_claim.source_key,-(length(NEW.warehouse_id)+1))=(':' || NEW.warehouse_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_legacy_notification_update
BEFORE UPDATE ON notifications
WHEN EXISTS (
  SELECT 1
  FROM telegram_legacy_claims AS claim
  JOIN telegram_deprovision_markers AS marker
    ON marker.installation_id=claim.installation_id
  WHERE claim.source_key=('warehouse:' || marker.company_id || ':' || NEW.warehouse_id)
    AND marker.warehouse_id=NEW.warehouse_id
    AND NOT EXISTS (
      SELECT 1 FROM telegram_legacy_claims AS other_claim
      WHERE other_claim.installation_id!=claim.installation_id
        AND substr(other_claim.source_key,1,10)='warehouse:'
        AND substr(other_claim.source_key,-(length(NEW.warehouse_id)+1))=(':' || NEW.warehouse_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_legacy_event_insert
BEFORE INSERT ON events
WHEN EXISTS (
  SELECT 1
  FROM telegram_legacy_claims AS claim
  JOIN telegram_deprovision_markers AS marker
    ON marker.installation_id=claim.installation_id
  WHERE claim.source_key=('warehouse:' || marker.company_id || ':' || NEW.warehouse_id)
    AND marker.warehouse_id=NEW.warehouse_id
    AND NOT EXISTS (
      SELECT 1 FROM telegram_legacy_claims AS other_claim
      WHERE other_claim.installation_id!=claim.installation_id
        AND substr(other_claim.source_key,1,10)='warehouse:'
        AND substr(other_claim.source_key,-(length(NEW.warehouse_id)+1))=(':' || NEW.warehouse_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_legacy_event_update
BEFORE UPDATE ON events
WHEN EXISTS (
  SELECT 1
  FROM telegram_legacy_claims AS claim
  JOIN telegram_deprovision_markers AS marker
    ON marker.installation_id=claim.installation_id
  WHERE claim.source_key=('warehouse:' || marker.company_id || ':' || NEW.warehouse_id)
    AND marker.warehouse_id=NEW.warehouse_id
    AND NOT EXISTS (
      SELECT 1 FROM telegram_legacy_claims AS other_claim
      WHERE other_claim.installation_id!=claim.installation_id
        AND substr(other_claim.source_key,1,10)='warehouse:'
        AND substr(other_claim.source_key,-(length(NEW.warehouse_id)+1))=(':' || NEW.warehouse_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_legacy_update_insert
BEFORE INSERT ON telegram_updates
WHEN EXISTS (
  SELECT 1
  FROM telegram_legacy_claims AS claim
  JOIN telegram_deprovision_markers AS marker
    ON marker.installation_id=claim.installation_id
  WHERE claim.source_key='telegram_updates:global'
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_legacy_update_update
BEFORE UPDATE ON telegram_updates
WHEN EXISTS (
  SELECT 1
  FROM telegram_legacy_claims AS claim
  JOIN telegram_deprovision_markers AS marker
    ON marker.installation_id=claim.installation_id
  WHERE claim.source_key='telegram_updates:global'
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_binding_insert
BEFORE INSERT ON chat_bindings_v2
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
    AND marker.company_id=NEW.company_id
    AND marker.warehouse_id=NEW.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_binding_update
BEFORE UPDATE ON chat_bindings_v2
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
    AND marker.company_id=NEW.company_id
    AND marker.warehouse_id=NEW.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_link_insert
BEFORE INSERT ON link_codes_v2
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
    AND marker.company_id=NEW.company_id
    AND marker.warehouse_id=NEW.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_link_update
BEFORE UPDATE ON link_codes_v2
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
    AND marker.company_id=NEW.company_id
    AND marker.warehouse_id=NEW.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_notification_insert
BEFORE INSERT ON notifications_v2
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
    AND marker.company_id=NEW.company_id
    AND marker.warehouse_id=NEW.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_notification_update
BEFORE UPDATE ON notifications_v2
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
    AND marker.company_id=NEW.company_id
    AND marker.warehouse_id=NEW.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_event_insert
BEFORE INSERT ON events_v2
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
    AND marker.company_id=NEW.company_id
    AND marker.warehouse_id=NEW.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_event_update
BEFORE UPDATE ON events_v2
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
    AND marker.company_id=NEW.company_id
    AND marker.warehouse_id=NEW.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_update_insert
BEFORE INSERT ON telegram_updates_v2
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
    AND marker.company_id=NEW.company_id
    AND marker.warehouse_id=NEW.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_deprovisioned_update_update
BEFORE UPDATE ON telegram_updates_v2
WHEN EXISTS (
  SELECT 1 FROM telegram_deprovision_markers AS marker
  WHERE marker.installation_id=NEW.installation_id
    AND marker.company_id=NEW.company_id
    AND marker.warehouse_id=NEW.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_INSTALLATION_DEPROVISIONED');
END;
