ALTER TABLE companies ADD COLUMN telegram_worker_url TEXT;
ALTER TABLE companies ADD COLUMN telegram_client_key_ciphertext TEXT;
ALTER TABLE companies ADD COLUMN telegram_bot_username TEXT;
ALTER TABLE companies ADD COLUMN telegram_installation_id TEXT;
ALTER TABLE companies ADD COLUMN telegram_deployment_version TEXT;
ALTER TABLE companies ADD COLUMN telegram_updated_at TEXT;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
INSERT OR REPLACE INTO schema_migrations(version, applied_at)
VALUES ('003-company-telegram-service', datetime('now'));
