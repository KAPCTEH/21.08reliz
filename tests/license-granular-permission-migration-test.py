from __future__ import annotations

import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "source" / "license-server" / "migrations" / "005-granular-permissions-audit.sql"

db = sqlite3.connect(":memory:")
db.executescript(
    """
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      user_id TEXT,
      action TEXT NOT NULL,
      entity_id TEXT,
      request_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO audit_log VALUES('audit-1','cmp','owner','user.access','usr-1','req-1','now');
    """
)
db.executescript(MIGRATION.read_text(encoding="utf-8"))
columns = {row[1] for row in db.execute("PRAGMA table_info(audit_log)")}
assert "details_json" in columns
assert db.execute("SELECT details_json FROM audit_log WHERE id='audit-1'").fetchone()[0] == "{}"
assert db.execute("SELECT version FROM schema_migrations WHERE version='005-granular-permissions-audit'").fetchone()
print('{"ok":true,"granularPermissionAuditMigration":true,"legacyRowsPreserved":true}')
