from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "source" / "application" / "integrations" / "reg-vps" / "server" / "server.py"
ADMIN_DSN = os.environ.get("JF_TEST_POSTGRES_ADMIN_DSN", "").strip()


@unittest.skipUnless(ADMIN_DSN, "JF_TEST_POSTGRES_ADMIN_DSN is not configured")
class LegacyMigrationIntegrationTests(unittest.TestCase):
    def setUp(self):
        import psycopg2
        from psycopg2.extensions import make_dsn

        self.psycopg2 = psycopg2
        self.schema = f"jf_legacy_migration_{os.getpid()}_{self._testMethodName[-24:]}".lower()
        self.schema = re.sub(r"[^a-z0-9_]", "_", self.schema)[:63]
        with psycopg2.connect(ADMIN_DSN) as conn, conn.cursor() as cur:
            cur.execute(f'DROP SCHEMA IF EXISTS "{self.schema}" CASCADE')
            cur.execute(f'CREATE SCHEMA "{self.schema}"')
        self.dsn = make_dsn(ADMIN_DSN, options=f"-c search_path={self.schema}")
        os.environ["JF_DB_DSN"] = self.dsn
        os.environ["JF_DB_POOL_MIN"] = "1"
        os.environ["JF_DB_POOL_MAX"] = "2"
        spec = importlib.util.spec_from_file_location(f"justfun_legacy_{self.schema}", SERVER_PATH)
        self.server = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(self.server)

    def tearDown(self):
        if getattr(self.server, "DB_POOL", None) is not None:
            self.server.DB_POOL.closeall()
            self.server.DB_POOL = None
        with self.psycopg2.connect(ADMIN_DSN) as conn, conn.cursor() as cur:
            cur.execute(f'DROP SCHEMA IF EXISTS "{self.schema}" CASCADE')

    def _snapshot(self, order_status="v1"):
        return {
            "warehouse": {
                "id": "warehouse-legacy-a",
                "environment": "live",
                "code": "СПБ",
                "name": "Старый склад",
            },
            "data": {
                "warehouseId": "warehouse-legacy-a",
                "orders": [{"id": "order-legacy-1", "warehouseId": "warehouse-legacy-a", "status": order_status}],
                "products": [{"id": "product-legacy-1", "warehouseId": "warehouse-legacy-a", "name": "Старый товар"}],
                "inventoryMovements": [],
                "drivers": [],
                "routeArchives": [],
                "settings": {"warehouse": {"address": "Санкт-Петербург"}},
                "reportingData": {},
                "company": {"shortName": "Старая компания"},
            },
        }

    def _create_v1(self, snapshot):
        from psycopg2.extras import Json

        digest = self.server._legacy_snapshot_digest(snapshot)
        with self.psycopg2.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE warehouse_snapshots (
                  workspace_id varchar(80) NOT NULL,
                  warehouse_id varchar(120) NOT NULL,
                  environment varchar(8) NOT NULL CHECK (environment IN ('live','demo')),
                  revision bigint NOT NULL DEFAULT 1,
                  digest_sha256 char(64) NOT NULL,
                  snapshot jsonb NOT NULL,
                  created_at timestamptz NOT NULL DEFAULT now(),
                  updated_at timestamptz NOT NULL DEFAULT now(),
                  PRIMARY KEY (workspace_id, warehouse_id, environment)
                )
                """
            )
            cur.execute(
                "INSERT INTO warehouse_snapshots(workspace_id,warehouse_id,environment,revision,digest_sha256,snapshot) VALUES (%s,%s,'live',4,%s,%s)",
                ("workspace-legacy-a", "warehouse-legacy-a", digest, Json(snapshot)),
            )

    def _create_v2(self):
        from psycopg2.extras import Json

        warehouse = {"id": "warehouse-legacy-a", "environment": "live", "code": "СПБ", "name": "V2 склад"}
        order = {"id": "order-legacy-1", "warehouseId": "warehouse-legacy-a", "status": "v2"}
        rows = [("warehouse", "warehouse-legacy-a", warehouse, 7), ("orders", "order-legacy-1", order, 8)]
        with self.psycopg2.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute("CREATE TABLE schema_migrations(version integer PRIMARY KEY,name varchar(160) NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())")
            cur.execute("INSERT INTO schema_migrations(version,name) VALUES (2,'row-level workspace entities and change stream')")
            cur.execute(
                """CREATE TABLE workspace_entities (
                  workspace_id varchar(80) NOT NULL, warehouse_id varchar(120) NOT NULL,
                  environment varchar(8) NOT NULL CHECK (environment IN ('live','demo')),
                  entity_type varchar(64) NOT NULL, entity_id varchar(160) NOT NULL,
                  version bigint NOT NULL CHECK (version > 0), payload_sha256 char(64) NOT NULL,
                  payload jsonb, is_deleted boolean NOT NULL DEFAULT false, last_event_id bigint NOT NULL DEFAULT 0,
                  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
                  PRIMARY KEY (workspace_id,warehouse_id,environment,entity_type,entity_id),
                  CHECK ((is_deleted AND payload IS NULL) OR (NOT is_deleted AND payload IS NOT NULL)))"""
            )
            cur.execute(
                """CREATE TABLE workspace_change_events (
                  event_id bigserial PRIMARY KEY, workspace_id varchar(80) NOT NULL,
                  warehouse_id varchar(120) NOT NULL, environment varchar(8) NOT NULL CHECK (environment IN ('live','demo')),
                  entity_type varchar(64) NOT NULL, entity_id varchar(160) NOT NULL,
                  entity_version bigint NOT NULL CHECK (entity_version > 0), operation varchar(12) NOT NULL CHECK (operation IN ('upsert','delete')),
                  payload_sha256 char(64) NOT NULL, payload jsonb, changed_by varchar(160) NOT NULL,
                  device_id varchar(200) NOT NULL DEFAULT '', command_id varchar(180) NOT NULL,
                  created_at timestamptz NOT NULL DEFAULT now()))"""
            )
            cur.execute(
                """CREATE TABLE processed_commands (
                  workspace_id varchar(80) NOT NULL, warehouse_id varchar(120) NOT NULL,
                  environment varchar(8) NOT NULL CHECK (environment IN ('live','demo')),
                  command_id varchar(180) NOT NULL, actor_id varchar(160) NOT NULL,
                  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
                  PRIMARY KEY (workspace_id,warehouse_id,environment,command_id))"""
            )
            for entity_type, entity_id, payload, event_id in rows:
                digest = self.server.entity_payload_digest(payload)
                cur.execute(
                    "INSERT INTO workspace_change_events(event_id,workspace_id,warehouse_id,environment,entity_type,entity_id,entity_version,operation,payload_sha256,payload,changed_by,device_id,command_id) VALUES (%s,%s,%s,'live',%s,%s,2,'upsert',%s,%s,'owner','old-device',%s)",
                    (event_id, "workspace-legacy-a", "warehouse-legacy-a", entity_type, entity_id, digest, Json(payload), f"client:legacy:{entity_type}:0001"),
                )
                cur.execute(
                    "INSERT INTO workspace_entities(workspace_id,warehouse_id,environment,entity_type,entity_id,version,payload_sha256,payload,last_event_id) VALUES (%s,%s,'live',%s,%s,2,%s,%s,%s)",
                    ("workspace-legacy-a", "warehouse-legacy-a", entity_type, entity_id, digest, Json(payload), event_id),
                )
            cur.execute(
                "INSERT INTO processed_commands(workspace_id,warehouse_id,environment,command_id,actor_id,result) VALUES (%s,%s,'live','client:legacy:command:0001','owner',%s)",
                ("workspace-legacy-a", "warehouse-legacy-a", Json({"ok": True})),
            )

    def test_v1_snapshot_migrates_and_replays_idempotently(self):
        self._create_v1(self._snapshot())
        self.server.init_schema()
        with self.psycopg2.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM business_records_v3")
            first_count = int(cur.fetchone()[0])
            self.assertGreaterEqual(first_count, 5)
            cur.execute("SELECT to_regclass('warehouse_snapshots'),to_regclass('legacy_v1_warehouse_snapshots_archive')")
            self.assertEqual(cur.fetchone(), (None, "legacy_v1_warehouse_snapshots_archive"))
            cur.execute("SELECT checksum_sha256 FROM schema_migrations WHERE version=290")
            self.assertEqual(str(cur.fetchone()[0]), self.server.LEGACY_V1_MIGRATION_CHECKSUM)
        self.server.init_schema()
        with self.psycopg2.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM business_records_v3")
            self.assertEqual(int(cur.fetchone()[0]), first_count)

    def test_v2_wins_per_entity_and_v1_fills_missing_records(self):
        self._create_v2()
        self._create_v1(self._snapshot(order_status="v1-stale"))
        self.server.init_schema()
        with self.psycopg2.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT payload->>'status' FROM business_records_v3 WHERE entity_type='orders' AND entity_id='order-legacy-1'")
            self.assertEqual(cur.fetchone()[0], "v2")
            cur.execute("SELECT payload->>'name' FROM business_records_v3 WHERE entity_type='products' AND entity_id='product-legacy-1'")
            self.assertEqual(cur.fetchone()[0], "Старый товар")
            for table in (
                "legacy_v1_warehouse_snapshots_archive", "legacy_v2_workspace_entities_archive",
                "legacy_v2_workspace_change_events_archive", "legacy_v2_processed_commands_archive",
            ):
                cur.execute("SELECT to_regclass(%s)", (table,))
                self.assertEqual(cur.fetchone()[0], table)
            cur.execute("SELECT COUNT(*) FROM legacy_v2_processed_commands_archive")
            self.assertEqual(int(cur.fetchone()[0]), 1)
            cur.execute("SELECT version,checksum_sha256 FROM schema_migrations WHERE version IN (290,291) ORDER BY version")
            self.assertEqual(cur.fetchall(), [
                (290, self.server.LEGACY_V1_MIGRATION_CHECKSUM),
                (291, self.server.LEGACY_V2_MIGRATION_CHECKSUM),
            ])


if __name__ == "__main__":
    unittest.main(verbosity=2)
