CREATE TABLE IF NOT EXISTS company_telegram_services (
  company_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL DEFAULT '*',
  telegram_worker_url TEXT NOT NULL,
  telegram_client_key_ciphertext TEXT NOT NULL,
  telegram_bot_username TEXT NOT NULL DEFAULT '',
  telegram_installation_id TEXT NOT NULL DEFAULT '',
  telegram_deployment_version TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(company_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_company_telegram_services_company
  ON company_telegram_services(company_id);

CREATE TABLE IF NOT EXISTS broker_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  warehouse_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_broker_audit_company_created
  ON broker_audit_log(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS broker_rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL
);
