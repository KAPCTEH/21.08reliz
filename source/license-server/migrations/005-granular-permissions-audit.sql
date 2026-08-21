CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

ALTER TABLE audit_log ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}';

INSERT OR REPLACE INTO schema_migrations(version, applied_at)
VALUES ('005-granular-permissions-audit', datetime('now'));
