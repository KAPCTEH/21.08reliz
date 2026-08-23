CREATE TABLE IF NOT EXISTS company_telegram_deprovision_operations (
  company_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  warehouse_code TEXT NOT NULL COLLATE BINARY,
  delete_command_id TEXT NOT NULL COLLATE BINARY,
  delete_base_version INTEGER NOT NULL CHECK(delete_base_version > 0),
  actor_user_id TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  installation_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('running','failed','deprovisioned')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK(attempt_count > 0),
  last_error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY(company_id, warehouse_id),
  CHECK(
    (status='deprovisioned' AND completed_at IS NOT NULL)
    OR (status!='deprovisioned' AND completed_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_company_telegram_deprovision_status
  ON company_telegram_deprovision_operations(status, updated_at);

CREATE TRIGGER IF NOT EXISTS reject_invalid_terminal_telegram_deprovision_insert
BEFORE INSERT ON company_telegram_deprovision_operations
WHEN NEW.status='deprovisioned'
 AND (
   NEW.installation_id!=''
   OR EXISTS (
     SELECT 1 FROM company_telegram_services AS service
     WHERE service.company_id=NEW.company_id AND service.warehouse_id=NEW.warehouse_id
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_DEPROVISION_TERMINAL_INSERT_INVALID');
END;

CREATE TRIGGER IF NOT EXISTS reject_company_telegram_service_after_deprovision_insert
BEFORE INSERT ON company_telegram_services
WHEN EXISTS (
  SELECT 1 FROM company_telegram_deprovision_operations AS operation
  WHERE operation.company_id=NEW.company_id AND operation.warehouse_id=NEW.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_SERVICE_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_company_telegram_service_after_deprovision_update
BEFORE UPDATE ON company_telegram_services
WHEN EXISTS (
  SELECT 1 FROM company_telegram_deprovision_operations AS operation
  WHERE operation.company_id=NEW.company_id AND operation.warehouse_id=NEW.warehouse_id
)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_SERVICE_DEPROVISIONED');
END;

CREATE TRIGGER IF NOT EXISTS reject_company_telegram_deprovision_delete
BEFORE DELETE ON company_telegram_deprovision_operations
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_DEPROVISION_OPERATION_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS reject_company_telegram_deprovision_rescope
BEFORE UPDATE OF company_id, warehouse_id, warehouse_code, delete_command_id, delete_base_version, actor_user_id, lease_id, operation_id, installation_id
ON company_telegram_deprovision_operations
WHEN NEW.company_id!=OLD.company_id
  OR NEW.warehouse_id!=OLD.warehouse_id
  OR NEW.warehouse_code!=OLD.warehouse_code
  OR NEW.delete_command_id!=OLD.delete_command_id
  OR NEW.delete_base_version!=OLD.delete_base_version
  OR NEW.actor_user_id!=OLD.actor_user_id
  OR NEW.lease_id!=OLD.lease_id
  OR NEW.operation_id!=OLD.operation_id
  OR NEW.installation_id=''
  OR (OLD.installation_id!='' AND NEW.installation_id!=OLD.installation_id)
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_DEPROVISION_OPERATION_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS reject_company_telegram_deprovision_reopen
BEFORE UPDATE OF status ON company_telegram_deprovision_operations
WHEN OLD.status='deprovisioned' AND NEW.status!='deprovisioned'
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_DEPROVISION_OPERATION_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS require_company_telegram_service_before_deprovision_complete
BEFORE UPDATE OF status ON company_telegram_deprovision_operations
WHEN OLD.status!='deprovisioned' AND NEW.status='deprovisioned'
 AND NOT EXISTS (
   SELECT 1 FROM company_telegram_services AS service
   WHERE service.company_id=NEW.company_id AND service.warehouse_id=NEW.warehouse_id
     AND (service.telegram_installation_id=NEW.installation_id OR service.telegram_installation_id='')
 )
BEGIN
  SELECT RAISE(ABORT, 'TELEGRAM_DEPROVISION_SERVICE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS delete_company_telegram_service_after_deprovision_complete
AFTER UPDATE OF status ON company_telegram_deprovision_operations
WHEN OLD.status!='deprovisioned' AND NEW.status='deprovisioned'
BEGIN
  DELETE FROM company_telegram_services
  WHERE company_id=NEW.company_id AND warehouse_id=NEW.warehouse_id
    AND (telegram_installation_id=NEW.installation_id OR telegram_installation_id='');
END;
