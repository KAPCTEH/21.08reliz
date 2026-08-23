from __future__ import annotations

import importlib.util
import hashlib
import hmac
import json
import os
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "source" / "application" / "integrations" / "reg-vps" / "server" / "server.py"
INSTALL_PATH = ROOT / "source" / "application" / "integrations" / "reg-vps" / "server" / "install.sh"

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
VERIFY_WAREHOUSE_DELETE_LEASE = SERVER.verify_warehouse_delete_lease
PREPARE_WAREHOUSE_DELETE_LEASE = SERVER.prepare_warehouse_delete_lease
CONFIRM_WAREHOUSE_TELEGRAM_DEPROVISION = SERVER.confirm_warehouse_telegram_deprovision


class FakeUpdatedAt:
    def isoformat(self):
        return "2026-08-22T00:00:00+00:00"


class FakeHttpResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit=-1):
        return self.payload


class FakeDatabase:
    def __init__(self):
        self.records = {}
        self.commands = {}
        self.delete_operations = {}
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
        elif normalized.startswith("SELECT command_id, warehouse_code, base_version, status, actor_id, device_id"):
            self.row = self.database.delete_operations.get((params[0], params[1]))
        elif normalized.startswith("SELECT version, payload, is_deleted FROM business_records_v3"):
            record = self.database.records.get(("live", "warehouse", params[2]))
            self.row = (record[0], record[4], record[2]) if record else None
        elif normalized.startswith("SELECT version, payload_sha256, is_deleted, last_event_id, payload FROM business_records_v3"):
            self.row = self.database.records.get((params[2], params[3], params[4]))
        elif normalized.startswith("INSERT INTO business_events_v3"):
            self.database.event_id += 1
            self.row = (self.database.event_id, FakeUpdatedAt())
        elif normalized.startswith("INSERT INTO business_records_v3"):
            key = (params[2], params[3], params[4])
            self.database.records[key] = (params[5], params[6], False, params[8], params[7])
        elif normalized.startswith("UPDATE business_records_v3"):
            key = (params[10], params[11], params[12])
            self.database.records[key] = (params[0], params[1], bool(params[3]), params[4], params[2])
        elif normalized.startswith("SELECT COALESCE(MAX(event_id), 0) FROM business_events_v3"):
            self.row = (self.database.event_id,)
        elif normalized.startswith("INSERT INTO business_commands_v3"):
            self.database.commands[params[3]] = (params[7], params[6])
        elif normalized.startswith("INSERT INTO warehouse_delete_operations_v3"):
            prepared_at = FakeUpdatedAt()
            self.database.delete_operations[(params[0], params[1])] = (
                params[2], params[3], params[4], "prepared", params[5], params[6], prepared_at, None, None
            )
            self.row = (prepared_at,)
        elif normalized.startswith("UPDATE warehouse_delete_operations_v3 SET actor_id"):
            key = (params[2], params[3])
            operation = self.database.delete_operations.get(key)
            if operation and operation[3] == "prepared":
                self.database.delete_operations[key] = (*operation[:4], params[0], params[1], *operation[6:])
                self.row = self.database.delete_operations[key]
        elif normalized.startswith("UPDATE warehouse_delete_operations_v3"):
            key = (params[1], params[2])
            operation = self.database.delete_operations.get(key)
            if operation and operation[3] == "prepared" and operation[0] == params[3] and operation[1] == params[4] and operation[2] == params[5]:
                completed_at = FakeUpdatedAt()
                self.database.delete_operations[key] = (*operation[:3], "completed", *operation[4:7], completed_at, params[0])
                self.row = (completed_at,)

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
            "warehouse": {"id": self.warehouse_id, "code": "ГЛВ", "environment": "live"},
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
        warehouse_payload = self.warehouse_snapshot["warehouse"]
        self.database.records[("live", "warehouse", self.warehouse_id)] = (
            1,
            SERVER.entity_payload_digest(warehouse_payload),
            False,
            0,
            warehouse_payload,
        )
        SERVER.db_connect = self.database.connect
        SERVER.set_database_scope = lambda *_args: None
        SERVER.load_entity_access_snapshot = lambda *_args: self.warehouse_snapshot
        SERVER.validate_entity_intent_current = lambda *_args: None
        SERVER.validate_entity_inventory_current = lambda *_args: None
        SERVER.verify_warehouse_delete_lease = lambda *_args, **_kwargs: {"ok": True, "active": True, "prepared": True, "status": "prepared", "remaining_seconds": 120}
        SERVER.prepare_warehouse_delete_lease = lambda *_args: {"ok": True, "prepared": True, "status": "prepared"}
        SERVER.confirm_warehouse_telegram_deprovision = lambda *_args, **_kwargs: {"deprovisioned": True, "already_deprovisioned": False, "installation_id": "tg_revision_installation_001"}
        os.environ["JF_VPS_ATTESTATION_SECRET"] = "jfvps_" + "s" * 43

    def order_change(self, base_version=0, status="new"):
        return {
            "type": "orders",
            "id": "order-1",
            "base_version": base_version,
            "payload": {"id": "order-1", "warehouseId": self.warehouse_id, "status": status},
        }

    def save(self, command_id, changes, auth=None, environment="live"):
        request = {"command_id": command_id, "changes": changes}
        delete_changes = [item for item in changes if item.get("type") == "warehouse" and item.get("deleted") is True]
        if delete_changes:
            request.update({
                "warehouse_delete_lease_token": "jfdl_" + "a" * 43,
                "warehouse_delete_warehouse_code": "ГЛВ",
            })
        if len(changes) == 1 and len(delete_changes) == 1 and environment == "live":
            SERVER.prepare_warehouse_delete(
                self.workspace,
                self.warehouse_id,
                {
                    "command_id": command_id,
                    "base_version": delete_changes[0]["base_version"],
                    "warehouse_code": "ГЛВ",
                    "warehouse_delete_lease_token": request["warehouse_delete_lease_token"],
                },
                auth or self.owner,
                "Bearer unit-test-access-token",
            )
        return SERVER.save_entity_batch(
            self.workspace,
            self.warehouse_id,
            environment,
            request,
            auth or self.owner,
            "Bearer unit-test-access-token",
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

    def test_tombstone_is_not_misclassified_as_immutable_field_mutation(self):
        current = {
            "id": "order-delete-1",
            "warehouseId": self.warehouse_id,
            "environment": "live",
            "status": "new",
        }
        item = {
            "type": "orders",
            "id": "order-delete-1",
            "deleted": True,
            "payload": None,
        }
        SERVER.validate_entity_field_permissions(
            {
                "role": "manager",
                "permissions": {"orders.delete"},
            },
            item,
            current,
            False,
            None,
        )
        SERVER.validate_intent_entity_fields(
            self.owner,
            {**item, "type": "routePlans"},
            current,
            {"kind": "route_cancel"},
        )

    def test_warehouse_code_is_canonicalized_and_validated(self):
        checked = SERVER.validate_entity_change(
            {
                "type": "warehouse",
                "id": self.warehouse_id,
                "base_version": 1,
                "payload": {"id": self.warehouse_id, "code": " м1 ", "environment": "live"},
            },
            self.warehouse_id,
            "live",
        )
        self.assertEqual(checked["payload"]["code"], "М1")
        for invalid in ("", "ABCD", "A-1", "A B", "склад"):
            with self.subTest(code=invalid), self.assertRaises(SERVER.ApiError) as caught:
                SERVER.validate_entity_change(
                    {
                        "type": "warehouse",
                        "id": self.warehouse_id,
                        "base_version": 1,
                        "payload": {"id": self.warehouse_id, "code": invalid, "environment": "live"},
                    },
                    self.warehouse_id,
                    "live",
                )
            self.assertEqual(caught.exception.code, "invalid_warehouse_code")

    def test_existing_warehouse_code_is_immutable(self):
        change = {
            "type": "warehouse",
            "id": self.warehouse_id,
            "base_version": 1,
            "payload": {"id": self.warehouse_id, "code": "НОВ", "environment": "live"},
        }
        with self.assertRaises(SERVER.ApiError) as caught:
            self.save("client:test:warehouse:code-immutable", [change])
        self.assertEqual(caught.exception.code, "warehouse_code_immutable")

    def test_role_cannot_change_settings_without_field_permission(self):
        auth = {
            "company_id": self.workspace,
            "role": "warehouse",
            "permissions": {"warehouses.manage", "jf.warehouse-code:ГЛВ"},
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
            "permissions": {"routes.settings", "jf.warehouse-code:ГЛВ"},
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
            "permissions": {"orders.*", "jf.warehouse-code:ГЛВ"},
        }
        SERVER.require_entity_scope_access(auth, self.workspace, self.warehouse_id, "live")
        SERVER.load_entity_access_snapshot = lambda *_args: {
            "warehouse": {"id": "warehouse-2", "code": "ДРГ", "environment": "live"},
            "data": {"warehouseId": "warehouse-2"},
        }
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.require_entity_scope_access(auth, self.workspace, "warehouse-2", "live")
        self.assertEqual(caught.exception.code, "warehouse_access_denied")

    def test_viewer_cannot_write_entity(self):
        auth = {
            "company_id": self.workspace,
            "role": "viewer",
            "permissions": {"orders.read", "jf.warehouse-code:ГЛВ"},
            "user_id": "viewer-1",
            "device_id": "revision-test",
        }
        with self.assertRaises(SERVER.ApiError) as caught:
            self.save("client:test:order:viewer:0001", [self.order_change()], auth)
        self.assertEqual(caught.exception.code, "entity_access_denied")

    def test_owner_can_write_entity(self):
        result = self.save("client:test:order:owner:0001", [self.order_change()])
        self.assertEqual(result["entities"][0]["version"], 1)

    def test_warehouse_delete_must_be_a_separate_command(self):
        changes = [
            {"type": "warehouse", "id": self.warehouse_id, "base_version": 1, "deleted": True},
            {"type": "orders", "id": "order-1", "base_version": 1, "deleted": True},
        ]
        with self.assertRaises(SERVER.ApiError) as caught:
            self.save("client:test:warehouse:delete:mixed", changes)
        self.assertEqual(caught.exception.status, 400)
        self.assertEqual(caught.exception.code, "warehouse_delete_must_be_single_change")

    def test_active_warehouse_cannot_be_deleted(self):
        change = {"type": "warehouse", "id": self.warehouse_id, "base_version": 1, "deleted": True}
        with self.assertRaises(SERVER.ApiError) as caught:
            self.save("client:test:warehouse:delete:active", [change])
        self.assertEqual(caught.exception.code, "warehouse_delete_requires_archived")

    def test_delete_prepare_is_durable_idempotent_and_secret_free(self):
        archived = {**self.warehouse_snapshot["warehouse"], "status": "archived"}
        self.database.records[("live", "warehouse", self.warehouse_id)] = (
            2, SERVER.entity_payload_digest(archived), False, 2, archived
        )
        request = {
            "command_id": "client:test:warehouse:delete:prepared",
            "base_version": 2,
            "warehouse_code": "ГЛВ",
            "warehouse_delete_lease_token": "jfdl_" + "p" * 43,
        }
        first = SERVER.prepare_warehouse_delete(
            self.workspace, self.warehouse_id, request, self.owner, "Bearer unit-test-access-token"
        )
        replay = SERVER.prepare_warehouse_delete(
            self.workspace, self.warehouse_id, request, self.owner, "Bearer unit-test-access-token"
        )
        self.assertEqual(first["status"], "prepared")
        self.assertFalse(first["replayed"])
        self.assertTrue(replay["replayed"])
        self.assertEqual(first["delete_prepare_contract"], 1)
        self.assertNotIn(request["warehouse_delete_lease_token"], repr(self.database.delete_operations))
        self.assertFalse(any(request["warehouse_delete_lease_token"] in repr(params) for _query, params in self.database.queries))
        prepare_locks = [
            params[0]
            for query, params in self.database.queries
            if query.startswith("SELECT pg_advisory_xact_lock") and len(params) == 2 and params[1] == "entity-write-scope"
        ]
        self.assertEqual(
            prepare_locks,
            [
                f"{self.workspace}:{self.warehouse_id}:demo",
                f"{self.workspace}:{self.warehouse_id}:live",
                f"{self.workspace}:{self.warehouse_id}:demo",
                f"{self.workspace}:{self.warehouse_id}:live",
            ],
        )

    def test_prepared_delete_blocks_live_and_demo_writes_and_other_command(self):
        archived = {**self.warehouse_snapshot["warehouse"], "status": "archived"}
        self.database.records[("live", "warehouse", self.warehouse_id)] = (
            2, SERVER.entity_payload_digest(archived), False, 2, archived
        )
        prepare = {
            "command_id": "client:test:warehouse:delete:blocking",
            "base_version": 2,
            "warehouse_code": "ГЛВ",
            "warehouse_delete_lease_token": "jfdl_" + "q" * 43,
        }
        SERVER.prepare_warehouse_delete(
            self.workspace, self.warehouse_id, prepare, self.owner, "Bearer unit-test-access-token"
        )
        for environment in ("live", "demo"):
            with self.subTest(environment=environment), self.assertRaises(SERVER.ApiError) as blocked:
                SERVER.save_entity_batch(
                    self.workspace,
                    self.warehouse_id,
                    environment,
                    {"command_id": f"client:test:blocked:{environment}", "changes": [self.order_change()]},
                    self.owner,
                    "Bearer unit-test-access-token",
                )
            self.assertEqual(blocked.exception.code, "warehouse_delete_prepared")
        recovered = SERVER.prepare_warehouse_delete(
            self.workspace,
            self.warehouse_id,
            {**prepare, "command_id": "client:test:warehouse:delete:other", "base_version": 99},
            self.owner,
            "Bearer unit-test-access-token",
        )
        self.assertTrue(recovered["recovered_existing"])
        self.assertEqual(recovered["command_id"], prepare["command_id"])
        self.assertEqual(recovered["base_version"], 2)
        other_actor = SERVER.prepare_warehouse_delete(
            self.workspace,
            self.warehouse_id,
            {**prepare, "command_id": "client:test:warehouse:delete:other-actor"},
            {**self.owner, "user_id": "owner-2"},
            "Bearer unit-test-access-token",
        )
        self.assertTrue(other_actor["recovered_existing"])
        self.assertEqual(other_actor["command_id"], prepare["command_id"])
        self.assertEqual(self.database.delete_operations[(self.workspace, self.warehouse_id)][4], "owner-2")

    def test_existing_prepare_rejects_superseded_lease_without_reassigning_operation(self):
        archived = {**self.warehouse_snapshot["warehouse"], "status": "archived"}
        self.database.records[("live", "warehouse", self.warehouse_id)] = (
            2, SERVER.entity_payload_digest(archived), False, 2, archived
        )
        request = {
            "command_id": "client:test:warehouse:delete:superseded",
            "base_version": 2,
            "warehouse_code": "ГЛВ",
            "warehouse_delete_lease_token": "jfdl_" + "m" * 43,
        }
        SERVER.prepare_warehouse_delete(
            self.workspace,
            self.warehouse_id,
            request,
            self.owner,
            "Bearer unit-test-access-token",
        )
        original_prepare = SERVER.prepare_warehouse_delete_lease
        SERVER.prepare_warehouse_delete_lease = lambda *_args: (_ for _ in ()).throw(
            SERVER.ApiError(409, "WAREHOUSE_DELETE_LEASE_REACQUIRE_REQUIRED", "expired")
        )
        try:
            with self.assertRaises(SERVER.ApiError) as rejected:
                SERVER.prepare_warehouse_delete(
                    self.workspace,
                    self.warehouse_id,
                    {**request, "command_id": "client:test:warehouse:delete:takeover"},
                    {**self.owner, "user_id": "owner-2"},
                    "Bearer unit-test-access-token",
                )
        finally:
            SERVER.prepare_warehouse_delete_lease = original_prepare
        self.assertEqual(rejected.exception.code, "warehouse_delete_lease_superseded")
        operation = self.database.delete_operations[(self.workspace, self.warehouse_id)]
        self.assertEqual(operation[0], request["command_id"])
        self.assertEqual(operation[4], "owner-1")
        self.assertNotIn(request["warehouse_delete_lease_token"], repr(operation))

    def test_final_delete_requires_durable_prepare(self):
        archived = {**self.warehouse_snapshot["warehouse"], "status": "archived"}
        self.database.records[("live", "warehouse", self.warehouse_id)] = (
            2, SERVER.entity_payload_digest(archived), False, 2, archived
        )
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.save_entity_batch(
                self.workspace,
                self.warehouse_id,
                "live",
                {
                    "command_id": "client:test:warehouse:delete:unprepared",
                    "changes": [{"type": "warehouse", "id": self.warehouse_id, "base_version": 2, "deleted": True}],
                    "warehouse_delete_lease_token": "jfdl_" + "r" * 43,
                    "warehouse_delete_warehouse_code": "ГЛВ",
                },
                self.owner,
                "Bearer unit-test-access-token",
            )
        self.assertEqual(caught.exception.code, "warehouse_delete_not_prepared")

    def test_final_lease_verification_requires_external_prepared_status(self):
        original_request = SERVER._warehouse_delete_lease_request
        base_payload = {
            "ok": True,
            "active": True,
            "remaining_seconds": 120,
            "lease": {
                "company_id": self.workspace,
                "warehouse_id": self.warehouse_id,
                "warehouse_code": "ГЛВ",
            },
        }
        try:
            SERVER._warehouse_delete_lease_request = lambda *_args: dict(base_payload)
            VERIFY_WAREHOUSE_DELETE_LEASE(
                "Bearer unit-test-access-token",
                self.workspace,
                self.warehouse_id,
                "ГЛВ",
                "jfdl_" + "u" * 43,
            )
            with self.assertRaises(SERVER.ApiError) as not_prepared:
                VERIFY_WAREHOUSE_DELETE_LEASE(
                    "Bearer unit-test-access-token",
                    self.workspace,
                    self.warehouse_id,
                    "ГЛВ",
                    "jfdl_" + "u" * 43,
                    require_prepared=True,
                )
            self.assertEqual(not_prepared.exception.code, "warehouse_delete_lease_service_invalid")
            SERVER._warehouse_delete_lease_request = lambda *_args: {
                **base_payload,
                "prepared": True,
                "status": "prepared",
                "remaining_seconds": None,
            }
            confirmed = VERIFY_WAREHOUSE_DELETE_LEASE(
                "Bearer unit-test-access-token",
                self.workspace,
                self.warehouse_id,
                "ГЛВ",
                "jfdl_" + "u" * 43,
                require_prepared=True,
            )
            self.assertTrue(confirmed["prepared"])
        finally:
            SERVER._warehouse_delete_lease_request = original_request

    def test_external_prepare_response_requires_active_exact_durable_lease(self):
        original_request = SERVER._warehouse_delete_lease_request
        payload = {
            "ok": True,
            "active": True,
            "prepared": True,
            "status": "prepared",
            "remaining_seconds": None,
            "lease": {
                "company_id": self.workspace,
                "warehouse_id": self.warehouse_id,
                "warehouse_code": "ГЛВ",
            },
        }
        try:
            SERVER._warehouse_delete_lease_request = lambda *_args: dict(payload)
            confirmed = PREPARE_WAREHOUSE_DELETE_LEASE(
                "Bearer unit-test-access-token",
                self.workspace,
                self.warehouse_id,
                "ГЛВ",
                "jfdl_" + "v" * 43,
            )
            self.assertTrue(confirmed["prepared"])
            SERVER._warehouse_delete_lease_request = lambda *_args: {**payload, "active": False}
            with self.assertRaises(SERVER.ApiError) as inactive:
                PREPARE_WAREHOUSE_DELETE_LEASE(
                    "Bearer unit-test-access-token",
                    self.workspace,
                    self.warehouse_id,
                    "ГЛВ",
                    "jfdl_" + "v" * 43,
                )
            self.assertEqual(inactive.exception.code, "warehouse_delete_lease_service_invalid")
        finally:
            SERVER._warehouse_delete_lease_request = original_request

    def test_telegram_deprovision_confirmation_is_bound_to_exact_delete_proof(self):
        original_urlopen = SERVER.urlopen
        original_time = SERVER.time.time
        original_nonce = SERVER.secrets.token_urlsafe
        captured = {}

        def fake_urlopen(request, timeout):
            captured["timeout"] = timeout
            captured["authorization"] = request.get_header("Authorization")
            captured["attestation_timestamp"] = request.get_header("X-justfun-vps-timestamp")
            captured["attestation_nonce"] = request.get_header("X-justfun-vps-nonce")
            captured["attestation_signature"] = request.get_header("X-justfun-vps-signature")
            captured["body"] = json.loads(request.data.decode("utf-8"))
            return FakeHttpResponse({
                "ok": True,
                "deprovisioned": True,
                "already_deprovisioned": False,
                "warehouse_id": self.warehouse_id,
                "warehouse_code": "ГЛВ",
                "delete_command_id": "client:test:warehouse:delete:broker-proof",
                "delete_base_version": 2,
                "installation_id": "tg_revision_installation_001",
            })

        try:
            SERVER.urlopen = fake_urlopen
            SERVER.time.time = lambda: 1787443200
            SERVER.secrets.token_urlsafe = lambda _size: "nonce-proof-contract-001"
            confirmed = CONFIRM_WAREHOUSE_TELEGRAM_DEPROVISION(
                "Bearer unit-test-access-token",
                self.workspace,
                self.warehouse_id,
                "ГЛВ",
                "jfdl_" + "w" * 43,
                "client:test:warehouse:delete:broker-proof",
                2,
            )
        finally:
            SERVER.urlopen = original_urlopen
            SERVER.time.time = original_time
            SERVER.secrets.token_urlsafe = original_nonce

        self.assertTrue(confirmed["deprovisioned"])
        self.assertEqual(captured["timeout"], 30)
        self.assertEqual(captured["authorization"], "Bearer unit-test-access-token")
        self.assertEqual(captured["body"]["warehouse_id"], self.warehouse_id)
        self.assertEqual(captured["body"]["warehouse_delete_lease_token"], "jfdl_" + "w" * 43)
        self.assertEqual(captured["body"]["delete_command_id"], "client:test:warehouse:delete:broker-proof")
        self.assertEqual(captured["body"]["delete_base_version"], 2)
        canonical = "\n".join((
            "justfun-vps-telegram-deprovision-v1",
            self.workspace,
            self.warehouse_id,
            "ГЛВ",
            "client:test:warehouse:delete:broker-proof",
            "2",
            hashlib.sha256(("jfdl_" + "w" * 43).encode("utf-8")).hexdigest(),
            "1787443200",
            "nonce-proof-contract-001",
        ))
        expected_signature = hmac.new(
            os.environ["JF_VPS_ATTESTATION_SECRET"].encode("utf-8"),
            canonical.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        self.assertEqual(captured["attestation_timestamp"], "1787443200")
        self.assertEqual(captured["attestation_nonce"], "nonce-proof-contract-001")
        self.assertEqual(captured["attestation_signature"], f"v1={expected_signature}")

    def test_telegram_deprovision_confirmation_rejects_mismatched_command(self):
        original_urlopen = SERVER.urlopen
        try:
            SERVER.urlopen = lambda *_args, **_kwargs: FakeHttpResponse({
                "ok": True,
                "deprovisioned": True,
                "warehouse_id": self.warehouse_id,
                "warehouse_code": "ГЛВ",
                "delete_command_id": "client:test:warehouse:delete:other-command",
                "delete_base_version": 2,
                "installation_id": "tg_revision_installation_001",
            })
            with self.assertRaises(SERVER.ApiError) as rejected:
                CONFIRM_WAREHOUSE_TELEGRAM_DEPROVISION(
                    "Bearer unit-test-access-token",
                    self.workspace,
                    self.warehouse_id,
                    "ГЛВ",
                    "jfdl_" + "x" * 43,
                    "client:test:warehouse:delete:expected-command",
                    2,
                )
        finally:
            SERVER.urlopen = original_urlopen
        self.assertEqual(rejected.exception.code, "telegram_deprovision_confirmation_invalid")

    def test_outbox_release_uses_empty_token_attestation_and_no_user_authorization(self):
        original_urlopen = SERVER.urlopen
        original_time = SERVER.time.time
        original_nonce = SERVER.secrets.token_urlsafe
        captured = {}
        item = {
            "workspace_id": self.workspace,
            "warehouse_id": self.warehouse_id,
            "warehouse_code": "ГЛВ",
            "command_id": "client:test:warehouse:delete:outbox-release",
            "base_version": 2,
        }

        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            captured["timeout"] = timeout
            captured["authorization"] = request.get_header("Authorization")
            captured["timestamp"] = request.get_header("X-justfun-vps-timestamp")
            captured["nonce"] = request.get_header("X-justfun-vps-nonce")
            captured["signature"] = request.get_header("X-justfun-vps-signature")
            captured["body"] = json.loads(request.data.decode("utf-8"))
            return FakeHttpResponse({
                "ok": True,
                "released": True,
                "status": "released",
                "company_id": self.workspace,
                "warehouse_id": self.warehouse_id,
                "warehouse_code": "ГЛВ",
                "delete_command_id": item["command_id"],
                "delete_base_version": 2,
            })

        try:
            SERVER.urlopen = fake_urlopen
            SERVER.time.time = lambda: 1787443201
            SERVER.secrets.token_urlsafe = lambda _size: "nonce-release-contract-001"
            released = SERVER._deliver_warehouse_delete_release(item)
        finally:
            SERVER.urlopen = original_urlopen
            SERVER.time.time = original_time
            SERVER.secrets.token_urlsafe = original_nonce

        self.assertTrue(released["released"])
        self.assertEqual(captured["timeout"], 12)
        self.assertIsNone(captured["authorization"])
        self.assertNotIn("lease_token", captured["body"])
        self.assertNotIn("authorization", captured["body"])
        canonical = "\n".join((
            "justfun-vps-telegram-deprovision-v1",
            self.workspace,
            self.warehouse_id,
            "ГЛВ",
            item["command_id"],
            "2",
            hashlib.sha256(b"").hexdigest(),
            "1787443201",
            "nonce-release-contract-001",
        ))
        expected_signature = hmac.new(
            os.environ["JF_VPS_ATTESTATION_SECRET"].encode("utf-8"),
            canonical.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        self.assertEqual(captured["timestamp"], "1787443201")
        self.assertEqual(captured["nonce"], "nonce-release-contract-001")
        self.assertEqual(captured["signature"], f"v1={expected_signature}")

    def test_completed_delete_operation_cannot_be_reopened(self):
        completed_at = FakeUpdatedAt()
        self.database.delete_operations[(self.workspace, self.warehouse_id)] = (
            "client:test:warehouse:delete:done",
            "ГЛВ",
            2,
            "completed",
            "owner-1",
            "revision-test",
            FakeUpdatedAt(),
            completed_at,
            {"command_id": "client:test:warehouse:delete:done", "delete_operation_completed": True},
        )
        self.database.records[("live", "warehouse", self.warehouse_id)] = (
            3, SERVER.entity_payload_digest(None, True), True, 3, None
        )
        SERVER.load_entity_access_snapshot = lambda *_args: {"deleted": True}
        same = SERVER.prepare_warehouse_delete(
            self.workspace,
            self.warehouse_id,
            {
                "command_id": "client:test:warehouse:delete:done",
                "base_version": 2,
                "warehouse_code": "ГЛВ",
                "warehouse_delete_lease_token": "jfdl_" + "s" * 43,
            },
            self.owner,
            "Bearer unit-test-access-token",
        )
        self.assertEqual(same["status"], "completed")
        self.assertTrue(same["replayed"])
        recovered = SERVER.prepare_warehouse_delete(
            self.workspace,
            self.warehouse_id,
            {
                "command_id": "client:test:warehouse:delete:new-after-complete",
                "base_version": 99,
                "warehouse_code": "ГЛВ",
                "warehouse_delete_lease_token": "jfdl_" + "t" * 43,
            },
            self.owner,
            "Bearer unit-test-access-token",
        )
        self.assertTrue(recovered["recovered_existing"])
        self.assertEqual(recovered["command_id"], "client:test:warehouse:delete:done")
        with self.assertRaises(SERVER.ApiError) as other_actor:
            SERVER.prepare_warehouse_delete(
                self.workspace,
                self.warehouse_id,
                {
                    "command_id": "client:test:warehouse:delete:other-actor",
                    "base_version": 2,
                    "warehouse_code": "ГЛВ",
                    "warehouse_delete_lease_token": "jfdl_" + "u" * 43,
                },
                {**self.owner, "user_id": "owner-2"},
                "Bearer unit-test-access-token",
            )
        self.assertEqual(other_actor.exception.code, "warehouse_delete_completed")

    def test_warehouse_registry_cannot_be_changed_in_demo(self):
        payload = {"id": self.warehouse_id, "code": "ГЛВ", "environment": "demo"}
        change = {"type": "warehouse", "id": self.warehouse_id, "base_version": 1, "payload": payload}
        with self.assertRaises(SERVER.ApiError) as caught:
            self.save("client:test:warehouse:update:demo", [change], environment="demo")
        self.assertEqual(caught.exception.code, "warehouse_registry_live_only")

    def test_deleted_live_registry_blocks_live_and_demo_business_writes(self):
        self.database.records[("live", "warehouse", self.warehouse_id)] = (
            2,
            SERVER.entity_payload_digest(None, True),
            True,
            2,
            None,
        )
        for environment in ("live", "demo"):
            with self.assertRaises(SERVER.ApiError) as caught:
                self.save(
                    f"client:test:order:after-delete:{environment}",
                    [self.order_change()],
                    environment=environment,
                )
            self.assertEqual(caught.exception.code, "warehouse_deleted")

    def test_archived_live_registry_blocks_live_and_demo_business_writes(self):
        archived = {**self.warehouse_snapshot["warehouse"], "status": "archived"}
        self.database.records[("live", "warehouse", self.warehouse_id)] = (
            2,
            SERVER.entity_payload_digest(archived),
            False,
            2,
            archived,
        )
        for environment in ("live", "demo"):
            with self.subTest(environment=environment), self.assertRaises(SERVER.ApiError) as caught:
                self.save(
                    f"client:test:order:after-archive:{environment}",
                    [self.order_change()],
                    environment=environment,
                )
            self.assertEqual(caught.exception.code, "warehouse_archived")

    def test_registry_mutation_locks_demo_then_live(self):
        payload = {**self.warehouse_snapshot["warehouse"], "status": "archived"}
        self.save(
            "client:test:warehouse:archive:locks",
            [{"type": "warehouse", "id": self.warehouse_id, "base_version": 1, "payload": payload}],
        )
        registry_locks = [
            params[0]
            for query, params in self.database.queries
            if query.startswith("SELECT pg_advisory_xact_lock")
            and len(params) == 2
            and params[1] == "entity-write-scope"
        ]
        self.assertEqual(
            registry_locks,
            [
                f"{self.workspace}:{self.warehouse_id}:demo",
                f"{self.workspace}:{self.warehouse_id}:live",
            ],
        )

    def test_warehouse_tombstone_cannot_be_resurrected(self):
        self.database.records[("live", "warehouse", self.warehouse_id)] = (
            2,
            SERVER.entity_payload_digest(None, True),
            True,
            2,
            None,
        )
        payload = {"id": self.warehouse_id, "code": "ГЛВ", "name": "Возврат", "environment": "live"}
        change = {"type": "warehouse", "id": self.warehouse_id, "base_version": 2, "payload": payload}
        with self.assertRaises(SERVER.ApiError) as caught:
            self.save("client:test:warehouse:resurrection", [change])
        self.assertEqual(caught.exception.code, "warehouse_deleted")

    def test_introspection_context_keeps_company_role_and_warehouse_permissions(self):
        context = SERVER._normalize_auth_context(
            {
                "ok": True,
                "active": True,
                "company": {"id": self.workspace},
                "user": {
                    "id": "usr_employee",
                    "role": "manager",
                    "permissions": ["orders.*", "jf.warehouse-code:ГЛВ"],
                },
                "device_id": "dev_pc_two",
            }
        )
        self.assertEqual(context["company_id"], self.workspace)
        self.assertEqual(context["role"], "manager")
        self.assertIn("jf.warehouse-code:ГЛВ", context["permissions"])
        self.assertEqual(context["device_id"], "dev_pc_two")

    def test_installer_requires_persists_and_clears_vps_attestation_bootstrap(self):
        source = INSTALL_PATH.read_text(encoding="utf-8")
        self.assertIn('VPS_ATTESTATION_SECRET="$(read_value VPS_ATTESTATION_SECRET_B64)"', source)
        self.assertIn('^jfvps_[A-Za-z0-9_-]{43,120}$', source)
        self.assertIn('JF_VPS_ATTESTATION_SECRET=$VPS_ATTESTATION_SECRET', source)
        self.assertIn('VPS_ATTESTATION_SECRET=""', source)
        self.assertIn('unset API_KEY VPS_ATTESTATION_SECRET DB_PASSWORD API_KEY_SHA256', source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
