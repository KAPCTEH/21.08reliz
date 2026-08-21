from __future__ import annotations

import importlib.util
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "source" / "application" / "integrations" / "reg-vps" / "server" / "server.py"
DSN = os.environ.get("JF_TEST_POSTGRES_DSN", "").strip()


@unittest.skipUnless(DSN, "JF_TEST_POSTGRES_DSN is not configured")
class ServerAuthoritativeStorageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["JF_DB_DSN"] = DSN
        os.environ["JF_DB_POOL_MIN"] = "2"
        os.environ["JF_DB_POOL_MAX"] = "48"
        spec = importlib.util.spec_from_file_location("justfun_storage_v3_server", SERVER_PATH)
        cls.server = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(cls.server)
        cls.server.init_schema()

    def setUp(self):
        self.workspace = "workspace-company-a"
        self.warehouse = "warehouse-a"
        self.owner = {
            "company_id": self.workspace,
            "role": "owner",
            "permissions": {"*"},
            "user_id": "owner-a",
            "device_id": "integration-test",
        }
        with self.server.db_connect() as conn, conn.cursor() as cur:
            cur.execute("TRUNCATE business_audit_v3, business_commands_v3, business_events_v3, business_records_v3 RESTART IDENTITY")
        self._save(
            "client:test:warehouse:create",
            [{
                "type": "warehouse",
                "id": self.warehouse,
                "base_version": 0,
                "payload": {"id": self.warehouse, "code": "СПБ", "name": "Склад СПБ", "environment": "live"},
            }],
        )

    def _save(self, command_id, changes, auth=None, warehouse=None, workspace=None):
        return self.server.save_entity_batch(
            workspace or self.workspace,
            warehouse or self.warehouse,
            "live",
            {"command_id": command_id, "changes": changes},
            auth or self.owner,
        )

    def test_idempotency_and_optimistic_version_are_enforced(self):
        change = {
            "type": "orders",
            "id": "order-1",
            "base_version": 0,
            "payload": {"id": "order-1", "warehouseId": self.warehouse, "status": "new"},
        }
        first = self._save("client:test:order:create:0001", [change])
        replay = self._save("client:test:order:create:0001", [change])
        self.assertFalse(first["replayed"])
        self.assertTrue(replay["replayed"])
        with self.assertRaises(self.server.ApiError) as reused:
            self._save("client:test:order:create:0001", [{**change, "payload": {**change["payload"], "status": "changed"}}])
        self.assertEqual(reused.exception.code, "command_id_reused")
        with self.assertRaises(self.server.ApiError) as stale:
            self._save("client:test:order:stale:0001", [{**change, "payload": {**change["payload"], "status": "changed"}}])
        self.assertEqual(stale.exception.code, "entity_version_conflict")

    def test_rls_hides_other_company_and_warehouse(self):
        self._save(
            "client:test:order:create:0002",
            [{"type": "orders", "id": "order-2", "base_version": 0, "payload": {"id": "order-2", "warehouseId": self.warehouse}}],
        )
        restricted = {
            "company_id": self.workspace,
            "role": "custom",
            "permissions": {"orders.read", "jf.warehouse:warehouse-b"},
            "user_id": "worker-b",
            "device_id": "integration-test-b",
        }
        other_warehouse = self.server.load_current_entities(self.workspace, self.warehouse, "live", restricted)
        other_company = self.server.load_current_entities(
            "workspace-company-b", self.warehouse, "live", {**self.owner, "company_id": "workspace-company-b"}
        )
        self.assertEqual(other_warehouse["entities"], [])
        self.assertEqual(other_company["entities"], [])

    def test_36_parallel_users_commit_distinct_orders(self):
        def create_order(index):
            order_id = f"parallel-order-{index}"
            auth = {**self.owner, "user_id": f"user-{index}", "device_id": f"pc-{index % 12}"}
            return self._save(
                f"client:parallel:create:{index:04d}",
                [{"type": "orders", "id": order_id, "base_version": 0, "payload": {"id": order_id, "warehouseId": self.warehouse, "status": "new"}}],
                auth=auth,
            )

        with ThreadPoolExecutor(max_workers=36) as pool:
            results = list(pool.map(create_order, range(36)))
        self.assertEqual(len(results), 36)
        current = self.server.load_current_entities(self.workspace, self.warehouse, "live", self.owner)
        orders = [item for item in current["entities"] if item["type"] == "orders"]
        self.assertEqual(len(orders), 36)
        with self.server.db_connect() as conn, conn.cursor() as cur:
            self.server.set_database_scope(cur, self.workspace, "live", self.owner)
            cur.execute(
                "SELECT COUNT(*) FROM business_audit_v3 WHERE workspace_id=%s AND warehouse_id=%s AND environment='live'",
                (self.workspace, self.warehouse),
            )
            self.assertEqual(int(cur.fetchone()[0]), 37)


if __name__ == "__main__":
    unittest.main(verbosity=2)
