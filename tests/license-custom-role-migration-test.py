from __future__ import annotations

import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "source" / "license-server" / "schema.sql"
MIGRATION = ROOT / "source" / "license-server" / "migrations" / "004-custom-roles.sql"


def legacy_schema(current_schema: str) -> str:
    return (
        current_schema
        .replace("role TEXT NOT NULL CHECK (length(trim(role)) BETWEEN 2 AND 50),", "role TEXT NOT NULL CHECK (role IN ('owner','admin','manager','logistician','warehouse','viewer')),")
        .replace("role TEXT NOT NULL CHECK (lower(trim(role)) <> 'owner' AND length(trim(role)) BETWEEN 2 AND 50),", "role TEXT NOT NULL CHECK (role IN ('admin','manager','logistician','warehouse','viewer')),")
        .replace("CREATE TABLE IF NOT EXISTS schema_migrations (\n  version TEXT PRIMARY KEY,\n  applied_at TEXT NOT NULL\n);\nINSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES\n  ('002-company-data-service', 'schema-baseline-7.8.3'),\n  ('003-company-telegram-service', 'schema-baseline-7.8.3'),\n  ('004-custom-roles', 'schema-baseline-7.8.3'),\n  ('005-granular-permissions-audit', 'schema-baseline-7.8.3'),\n  ('006-exact-permissions', 'schema-baseline-7.8.3');\n", "")
    )


db = sqlite3.connect(":memory:")
db.executescript(legacy_schema(SCHEMA.read_text(encoding="utf-8")))
db.execute("INSERT INTO companies(id,code,name,status,created_at) VALUES('cmp','TEST','Test','active','now')")
db.execute("INSERT INTO licenses VALUES('lic','hash','cmp','active',25,3,'now')")
user_values = ("owner", "cmp", "owner", "Owner", "owner", "[\"*\"]", "salt", "hash", 1, "active", "now", "now")
db.execute("INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", user_values)
db.execute("INSERT INTO invitations VALUES('inv','cmp','code','user','User','manager','[]','owner','now','later')")
db.commit()

db.executescript(MIGRATION.read_text(encoding="utf-8"))
db.execute("UPDATE users SET role='Старший логист' WHERE id='owner'")
db.execute("UPDATE invitations SET role='Кладовщик ночной смены' WHERE id='inv'")
assert db.execute("SELECT role FROM users WHERE id='owner'").fetchone()[0] == "Старший логист"
assert db.execute("SELECT role FROM invitations WHERE id='inv'").fetchone()[0] == "Кладовщик ночной смены"
assert db.execute("SELECT version FROM schema_migrations WHERE version='004-custom-roles'").fetchone()
assert db.execute("PRAGMA foreign_key_check").fetchall() == []
print('{"ok":true,"customRoleMigration":true,"foreignKeys":true,"baselineRecorded":true}')
