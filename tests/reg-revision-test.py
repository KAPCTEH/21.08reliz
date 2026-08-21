from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "source" / "application" / "integrations" / "reg-vps" / "server" / "server.py"

psycopg2 = types.ModuleType("psycopg2")
extras = types.ModuleType("psycopg2.extras")
extras.Json = lambda value: value
psycopg2.extras = extras
sys.modules["psycopg2"] = psycopg2
sys.modules["psycopg2.extras"] = extras

SPEC = importlib.util.spec_from_file_location("justfun_reg_server", SERVER_PATH)
SERVER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(SERVER)


class FakeUpdatedAt:
    def isoformat(self):
        return "2026-07-27T00:00:00+00:00"


class FakeCursor:
    def __init__(self, current):
        self.current = current
        self.last_query = ""
        self.execute_calls = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query, params):
        self.last_query = " ".join(query.split())
        self.execute_calls.append((self.last_query, params))

    def fetchone(self):
        if self.last_query.startswith("SELECT revision"):
            return self.current
        if self.last_query.startswith("INSERT INTO"):
            return (1, self.execute_calls[-1][1][3], FakeUpdatedAt())
        if self.last_query.startswith("UPDATE warehouse_snapshots"):
            revision = int(self.current[0]) + 1
            return (revision, self.execute_calls[-1][1][0], FakeUpdatedAt())
        raise AssertionError(self.last_query)


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self.cursor_value


class RevisionTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = {
            "warehouse": {"id": "warehouse-1", "code": "MAIN-01", "environment": "live"},
            "data": {"warehouseId": "warehouse-1"},
        }
        self.owner = {"role": "owner", "permissions": {"*"}}

    def connect(self, current):
        cursor = FakeCursor(current)
        SERVER.db_connect = lambda: FakeConnection(cursor)
        return cursor

    def digest(self):
        return SERVER.snapshot_digest(self.snapshot)

    def test_first_snapshot_requires_zero_revision(self):
        cursor = self.connect(None)
        result = SERVER.save_snapshot("workspace-123456", "warehouse-1", "live", self.snapshot, 0, self.owner)
        self.assertEqual(result["revision"], 1)
        self.assertTrue(any(query.startswith("INSERT INTO") for query, _ in cursor.execute_calls))

    def test_same_digest_is_idempotent(self):
        cursor = self.connect((7, self.digest(), FakeUpdatedAt(), self.snapshot))
        result = SERVER.save_snapshot("workspace-123456", "warehouse-1", "live", self.snapshot, 3, self.owner)
        self.assertEqual(result["revision"], 7)
        self.assertTrue(result["unchanged"])
        self.assertEqual(len(cursor.execute_calls), 1)

    def test_stale_revision_is_rejected(self):
        self.connect((7, "0" * 64, FakeUpdatedAt(), self.snapshot))
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.save_snapshot("workspace-123456", "warehouse-1", "live", self.snapshot, 6, self.owner)
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(caught.exception.code, "revision_conflict")
        self.assertEqual(caught.exception.details["current_revision"], 7)

    def test_current_revision_updates_once(self):
        cursor = self.connect((7, "0" * 64, FakeUpdatedAt(), self.snapshot))
        result = SERVER.save_snapshot("workspace-123456", "warehouse-1", "live", self.snapshot, 7, self.owner)
        self.assertEqual(result["revision"], 8)
        self.assertTrue(any(query.startswith("UPDATE warehouse_snapshots") for query, _ in cursor.execute_calls))

    def test_export_timestamp_does_not_create_revision(self):
        first = {**self.snapshot, "exportedAt": "2026-07-27T10:00:00Z"}
        second = {**self.snapshot, "exportedAt": "2026-07-27T10:01:00Z"}
        self.assertEqual(SERVER.snapshot_digest(first), SERVER.snapshot_digest(second))

    def test_role_cannot_change_section_without_permission(self):
        current = {
            "warehouse": self.snapshot["warehouse"],
            "data": {"warehouseId": "warehouse-1", "settings": {"routeMode": "round"}},
        }
        incoming = {
            "warehouse": self.snapshot["warehouse"],
            "data": {"warehouseId": "warehouse-1", "settings": {"routeMode": "oneway"}},
        }
        warehouse_user = {
            "role": "warehouse",
            "permissions": {"orders.update", "inventory.*", "jf.warehouse-code:MAIN-01"},
        }
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.require_changed_sections_allowed(warehouse_user, current, incoming)
        self.assertEqual(caught.exception.code, "section_access_denied")
        self.assertIn("settings", caught.exception.details["sections"])

    def test_role_can_change_permitted_section(self):
        current = {
            "warehouse": self.snapshot["warehouse"],
            "data": {"warehouseId": "warehouse-1", "orders": [{"id": "order-1", "status": "new"}]},
        }
        incoming = {
            "warehouse": self.snapshot["warehouse"],
            "data": {"warehouseId": "warehouse-1", "orders": [{"id": "order-1", "status": "ready"}]},
        }
        warehouse_user = {
            "role": "warehouse",
            "permissions": {"orders.update", "inventory.*", "jf.warehouse-code:MAIN-01"},
        }
        SERVER.require_changed_sections_allowed(warehouse_user, current, incoming)

    def test_account_is_restricted_to_its_company(self):
        auth = {"company_id": "cmp_company_one_12345"}
        SERVER.require_workspace(auth, "cmp_company_one_12345")
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.require_workspace(auth, "cmp_company_two_12345")
        self.assertEqual(caught.exception.code, "workspace_mismatch")

    def test_employee_can_access_only_assigned_warehouse(self):
        auth = {
            "role": "manager",
            "permissions": {"orders.*", "jf.warehouse-code:MAIN-01"},
        }
        self.assertTrue(SERVER.warehouse_allowed(auth, "warehouse-1", self.snapshot))
        foreign = {
            "warehouse": {"id": "warehouse-2", "code": "OTHER", "environment": "live"},
            "data": {"warehouseId": "warehouse-2"},
        }
        self.assertFalse(SERVER.warehouse_allowed(auth, "warehouse-2", foreign))

    def test_viewer_cannot_write_snapshot(self):
        auth = {
            "role": "viewer",
            "permissions": {"orders.read", "jf.warehouse-code:MAIN-01"},
        }
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.require_snapshot_access(auth, "warehouse-1", self.snapshot, write=True)
        self.assertEqual(caught.exception.code, "write_access_denied")

    def test_owner_has_all_company_warehouses(self):
        auth = {"role": "owner", "permissions": {"*"}}
        SERVER.require_snapshot_access(auth, "warehouse-1", self.snapshot, write=True)

    def test_introspection_context_keeps_company_role_and_warehouse_permissions(self):
        context = SERVER._normalize_auth_context(
            {
                "ok": True,
                "active": True,
                "company": {"id": "cmp_company_one_12345"},
                "user": {
                    "id": "usr_employee",
                    "role": "manager",
                    "permissions": ["orders.*", "jf.warehouse-code:MAIN-01"],
                },
                "device_id": "dev_pc_two",
            }
        )
        self.assertEqual(context["company_id"], "cmp_company_one_12345")
        self.assertEqual(context["role"], "manager")
        self.assertIn("jf.warehouse-code:MAIN-01", context["permissions"])
        self.assertEqual(context["device_id"], "dev_pc_two")


if __name__ == "__main__":
    unittest.main(verbosity=2)
