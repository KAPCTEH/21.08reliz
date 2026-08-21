PRAGMA foreign_keys = OFF;

ALTER TABLE company_telegram_services RENAME TO company_telegram_services_legacy;

CREATE TABLE company_telegram_services (
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

INSERT INTO company_telegram_services(
  company_id,warehouse_id,telegram_worker_url,telegram_client_key_ciphertext,
  telegram_bot_username,telegram_installation_id,telegram_deployment_version,updated_at
)
SELECT
  company_id,'*',telegram_worker_url,telegram_client_key_ciphertext,
  telegram_bot_username,telegram_installation_id,telegram_deployment_version,updated_at
FROM company_telegram_services_legacy;

DROP TABLE company_telegram_services_legacy;

CREATE INDEX idx_company_telegram_services_company
  ON company_telegram_services(company_id);

PRAGMA foreign_keys = ON;
