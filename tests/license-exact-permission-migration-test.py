from __future__ import annotations

import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "source" / "license-server" / "migrations" / "006-exact-permissions.sql"

db = sqlite3.connect(":memory:")
db.executescript(
    """
    CREATE TABLE users (id TEXT PRIMARY KEY, permissions_json TEXT NOT NULL);
    CREATE TABLE invitations (id TEXT PRIMARY KEY, permissions_json TEXT NOT NULL);
    INSERT INTO users VALUES
      ('legacy', '["orders.read","orders.update","routes.update","jf.warehouse:wh_main"]'),
      ('exact', '["orders.read","orders.create"]'),
      ('invalid', 'not-json');
    INSERT INTO invitations VALUES
      ('invite', '["inventory.update","drivers.update","company.update"]');
    """
)
db.executescript(MIGRATION.read_text(encoding="utf-8"))

legacy = set(json.loads(db.execute("SELECT permissions_json FROM users WHERE id='legacy'").fetchone()[0]))
assert {"orders.update", "orders.create", "orders.status", "orders.payment", "orders.pricing", "orders.delete"} <= legacy
assert {"routes.update", "routes.plan", "routes.start", "routes.close", "routes.settings"} <= legacy
assert "jf.warehouse:wh_main" in legacy

exact = set(json.loads(db.execute("SELECT permissions_json FROM users WHERE id='exact'").fetchone()[0]))
assert exact == {"orders.read", "orders.create"}
assert json.loads(db.execute("SELECT permissions_json FROM users WHERE id='invalid'").fetchone()[0]) == []

invite = set(json.loads(db.execute("SELECT permissions_json FROM invitations WHERE id='invite'").fetchone()[0]))
assert {"inventory.update", "inventory.catalog", "inventory.stock", "inventory.delete"} <= invite
assert {"drivers.update", "drivers.assign", "drivers.delete"} <= invite
assert {"company.update", "warehouses.manage", "integrations.manage"} <= invite
assert db.execute("SELECT version FROM schema_migrations WHERE version='006-exact-permissions'").fetchone()
print('{"ok":true,"exactPermissionMigration":true,"legacyRowsExpandedOnce":true}')
