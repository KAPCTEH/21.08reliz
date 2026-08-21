ALTER TABLE companies ADD COLUMN data_api_address TEXT;
ALTER TABLE companies ADD COLUMN data_api_port INTEGER;
ALTER TABLE companies ADD COLUMN data_api_tls_sha256 TEXT;
ALTER TABLE companies ADD COLUMN data_api_updated_at TEXT;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
INSERT OR REPLACE INTO schema_migrations(version, applied_at)
VALUES ('002-company-data-service', datetime('now'));
