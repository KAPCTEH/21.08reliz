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
        return "2026-08-22T00:00:00+00:00"


class FakeDatabase:
    def __init__(self):
        self.records = {}
        self.commands = {}
        self.event_id = 0
        self.queries = []

    def connect(self):
        return FakeConnection(self)


class FakeCursor:
    def __init__(self, database):
        self.database = database
        self.row = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query, params=()):
        normalized = " ".join(query.split())
        self.database.queries.append((normalized, params))
        self.row = None
        if normalized.startswith("SELECT result, request_sha256 FROM business_commands_v3"):
            self.row = self.database.commands.get(params[3])
        elif normalized.startswith("SELECT version, payload_sha256, is_deleted, last_event_id, payload FROM business_records_v3"):
            self.row = self.database.records.get((params[3], params[4]))
        elif normalized.startswith("INSERT INTO business_events_v3"):
            self.database.event_id += 1
            self.row = (self.database.event_id, FakeUpdatedAt())
        elif normalized.startswith("INSERT INTO business_records_v3"):
            key = (params[3], params[4])
            self.database.records[key] = (params[5], params[6], False, params[8], params[7])
        elif normalized.startswith("UPDATE business_records_v3"):
            key = (params[11], params[12])
            self.database.records[key] = (params[0], params[1], bool(params[3]), params[4], params[2])
        elif normalized.startswith("SELECT COALESCE(MAX(event_id), 0) FROM business_events_v3"):
            self.row = (self.database.event_id,)
        elif normalized.startswith("INSERT INTO business_commands_v3"):
            self.database.commands[params[3]] = (params[7], params[6])

    def fetchone(self):
        return self.row


class FakeConnection:
    def __init__(self, database):
        self.database = database

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return FakeCursor(self.database)


class RevisionTests(unittest.TestCase):
    def setUp(self):
        self.workspace = "workspace-123456"
        self.warehouse_id = "warehouse-1"
        self.warehouse_snapshot = {
            "warehouse": {"id": self.warehouse_id, "code": "MAIN-01", "environment": "live"},
            "data": {"warehouseId": self.warehouse_id},
        }
        self.owner = {
            "company_id": self.workspace,
            "role": "owner",
            "permissions": {"*"},
            "user_id": "owner-1",
            "device_id": "revision-test",
        }
        self.database = FakeDatabase()
        SERVER.db_connect = self.database.connect
        SERVER.set_database_scope = lambda *_args: None
        SERVER.load_entity_access_snapshot = lambda *_args: self.warehouse_snapshot
        SERVER.validate_entity_intent_current = lambda *_args: None
        SERVER.validate_entity_inventory_current = lambda *_args: None

    def order_change(self, base_version=0, status="new"):
        return {
            "type": "orders",
            "id": "order-1",
            "base_version": base_version,
            "payload": {"id": "order-1", "warehouseId": self.warehouse_id, "status": status},
        }

    def save(self, command_id, changes, auth=None):
        return SERVER.save_entity_batch(
            self.workspace,
            self.warehouse_id,
            "live",
            {"command_id": command_id, "changes": changes},
            auth or self.owner,
        )

    def test_first_entity_requires_zero_version(self):
        result = self.save("client:test:order:create:0001", [self.order_change()])
        self.assertEqual(result["entities"][0]["version"], 1)
        self.assertTrue(any(query.startswith("INSERT INTO business_records_v3") for query, _ in self.database.queries))

    def test_same_command_is_idempotent(self):
        first = self.save("client:test:order:create:0002", [self.order_change()])
        replay = self.save("client:test:order:create:0002", [self.order_change()])
        self.assertFalse(first["replayed"])
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["entities"][0]["version"], 1)
        self.assertEqual(self.database.event_id, 1)

    def test_reused_command_with_different_payload_is_rejected(self):
        self.save("client:test:order:create:0003", [self.order_change()])
        with self.assertRaises(SERVER.ApiError) as caught:
            self.save("client:test:order:create:0003", [self.order_change(status="changed")])
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(caught.exception.code, "command_id_reused")

    def test_stale_entity_version_is_rejected(self):
        self.save("client:test:order:create:0004", [self.order_change()])
        with self.assertRaises(SERVER.ApiError) as caught:
            self.save("client:test:order:stale:0004", [self.order_change(base_version=0, status="changed")])
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(caught.exception.code, "entity_version_conflict")
        self.assertEqual(caught.exception.details["current_version"], 1)

    def test_current_entity_version_updates_once(self):
        self.save("client:test:order:create:0005", [self.order_change()])
        result = self.save("client:test:order:update:0005", [self.order_change(base_version=1, status="ready")])
        self.assertEqual(result["entities"][0]["version"], 2)
        self.assertFalse(result["entities"][0]["unchanged"])
        self.assertTrue(any(query.startswith("UPDATE business_records_v3") for query, _ in self.database.queries))

    def test_same_entity_digest_does_not_create_new_version(self):
        self.save("client:test:order:create:0006", [self.order_change()])
        result = self.save("client:test:order:confirm:0006", [self.order_change(base_version=1)])
        self.assertEqual(result["entities"][0]["version"], 1)
        self.assertTrue(result["entities"][0]["unchanged"])
        self.assertEqual(self.database.event_id, 1)

    def test_entity_digest_is_stable_for_key_order(self):
        first = {"id": "order-1", "warehouseId": self.warehouse_id, "status": "new"}
        second = {"status": "new", "warehouseId": self.warehouse_id, "id": "order-1"}
        self.assertEqual(SERVER.entity_payload_digest(first), SERVER.entity_payload_digest(second))

    def test_role_cannot_change_settings_without_field_permission(self):
        auth = {
            "company_id": self.workspace,
            "role": "warehouse",
            "permissions": {"warehouses.manage", "jf.warehouse-code:MAIN-01"},
            "user_id": "warehouse-1",
            "device_id": "revision-test",
        }
        change = {"type": "settings", "id": "settings", "base_version": 0, "payload": {"routeMode": "round"}}
        with self.assertRaises(SERVER.ApiError) as caught:
            self.save("client:test:settings:denied:0001", [change], auth)
        self.assertEqual(caught.exception.code, "entity_field_access_denied")
        self.assertIn("routes.settings", caught.exception.details["required_permissions"])

    def test_role_can_change_permitted_settings_field(self):
        auth = {
            "company_id": self.workspace,
            "role": "warehouse",
            "permissions": {"routes.settings", "jf.warehouse-code:MAIN-01"},
            "user_id": "warehouse-1",
            "device_id": "revision-test",
        }
        change = {"type": "settings", "id": "settings", "base_version": 0, "payload": {"routeMode": "round"}}
        result = self.save("client:test:settings:allowed:0001", [change], auth)
        self.assertEqual(result["entities"][0]["version"], 1)

    def test_account_is_restricted_to_its_company(self):
        SERVER.require_workspace(self.owner, self.workspace)
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.require_workspace(self.owner, "workspace-other-123456")
        self.assertEqual(caught.exception.code, "workspace_mismatch")

    def test_employee_can_access_only_assigned_warehouse(self):
        auth = {
            "role": "manager",
            "permissions": {"orders.*", "jf.warehouse-code:MAIN-01"},
        }
        SERVER.require_entity_scope_access(auth, self.workspace, self.warehouse_id, "live")
        SERVER.load_entity_access_snapshot = lambda *_args: {
            "warehouse": {"id": "warehouse-2", "code": "OTHER", "environment": "live"},
            "data": {"warehouseId": "warehouse-2"},
        }
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.require_entity_scope_access(auth, self.workspace, "warehouse-2", "live")
        self.assertEqual(caught.exception.code, "warehouse_access_denied")

    def test_viewer_cannot_write_entity(self):
        auth = {
            "company_id": self.workspace,
            "role": "viewer",
            "permissions": {"orders.read", "jf.warehouse-code:MAIN-01"},
            "user_id": "viewer-1",
            "device_id": "revision-test",
        }
        with self.assertRaises(SERVER.ApiError) as caught:
            self.save("client:test:order:viewer:0001", [self.order_change()], auth)
        self.assertEqual(caught.exception.code, "entity_access_denied")

    def test_owner_can_write_entity(self):
        result = self.save("client:test:order:owner:0001", [self.order_change()])
        self.assertEqual(result["entities"][0]["version"], 1)

    def test_introspection_context_keeps_company_role_and_warehouse_permissions(self):
        context = SERVER._normalize_auth_context(
            {
                "ok": True,
                "active": True,
                "company": {"id": self.workspace},
                "user": {
                    "id": "usr_employee",
                    "role": "manager",
                    "permissions": ["orders.*", "jf.warehouse-code:MAIN-01"],
                },
                "device_id": "dev_pc_two",
            }
        )
        self.assertEqual(context["company_id"], self.workspace)
        self.assertEqual(context["role"], "manager")
        self.assertIn("jf.warehouse-code:MAIN-01", context["permissions"])
        self.assertEqual(context["device_id"], "dev_pc_two")


if __name__ == "__main__":
    unittest.main(verbosity=2)
