from __future__ import annotations

import importlib.util
from datetime import datetime, timezone
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

SPEC = importlib.util.spec_from_file_location("justfun_reg_entity_server", SERVER_PATH)
SERVER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(SERVER)


class EntityCursor:
    def __init__(self, rows):
        self.rows = rows
        self.current = None

    def execute(self, _query, params):
        entity_type, entity_id = str(params[-2]), str(params[-1])
        payload = self.rows.get((entity_type, entity_id))
        self.current = (payload, False) if payload is not None else None

    def fetchone(self):
        return self.current


class EntityProtocolTests(unittest.TestCase):
    def setUp(self):
        self.warehouse_id = "warehouse-1"
        self.environment = "live"
        self.snapshot = {
            "warehouse": {
                "id": self.warehouse_id,
                "code": "MAIN-01",
                "name": "Основной склад",
                "environment": self.environment,
            },
            "data": {
                "warehouseId": self.warehouse_id,
                "orders": [{"id": "order-1", "warehouseId": self.warehouse_id, "status": "new"}],
                "products": [{"id": "product-1", "warehouseId": self.warehouse_id, "name": "Товар"}],
                "inventoryMovements": [],
                "drivers": [],
                "routeArchives": [],
                "settings": {"routeMode": "round"},
                "reportingData": {"expenses": []},
                "company": {"name": "Компания"},
                "routePlans": {"route-1": {"id": "route-1", "warehouseId": self.warehouse_id}},
                "routeAssignments": {"order-1": "route-1"},
                "routeCatalog": {},
                "routeDriverAssignments": {},
                "routeLocks": {},
                "routeOverrides": {},
                "routeExecutions": {},
                "warehouseReservations": {},
                "manualRouteSequences": {},
            },
        }

    def test_independent_entities_are_validated_without_a_snapshot(self):
        order = SERVER.validate_entity_change(
            {"type": "orders", "id": "order-1", "base_version": 0, "payload": self.snapshot["data"]["orders"][0]},
            self.warehouse_id,
            self.environment,
        )
        product = SERVER.validate_entity_change(
            {"type": "products", "id": "product-1", "base_version": 0, "payload": self.snapshot["data"]["products"][0]},
            self.warehouse_id,
            self.environment,
        )
        self.assertEqual((order["type"], order["id"]), ("orders", "order-1"))
        self.assertEqual((product["type"], product["id"]), ("products", "product-1"))

    def test_scalar_map_value_is_wrapped_without_data_loss(self):
        assignment = SERVER.validate_entity_change(
            {
                "type": "routeAssignments",
                "id": "order-1",
                "base_version": 0,
                "payload": {"__jf_wrapped_value": True, "value": "route-1"},
            },
            self.warehouse_id,
            self.environment,
        )
        self.assertEqual(assignment["payload"], {"__jf_wrapped_value": True, "value": "route-1"})

    def test_entity_change_requires_row_version(self):
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_change(
                {"type": "orders", "id": "order-1", "payload": {"id": "order-1"}},
                self.warehouse_id,
                self.environment,
            )
        self.assertEqual(caught.exception.code, "base_version_required")

    def test_cross_warehouse_entity_is_rejected(self):
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_change(
                {
                    "type": "orders",
                    "id": "order-1",
                    "base_version": 0,
                    "payload": {"id": "order-1", "warehouseId": "warehouse-2"},
                },
                self.warehouse_id,
                self.environment,
            )
        self.assertEqual(caught.exception.code, "warehouse_mismatch")

    def test_entity_change_canonicalizes_missing_record_identity(self):
        checked = SERVER.validate_entity_change(
            {
                "type": "orders",
                "id": "order-1",
                "base_version": 0,
                "payload": {"status": "new"},
            },
            self.warehouse_id,
            self.environment,
        )
        self.assertEqual(checked["payload"]["id"], "order-1")
        self.assertEqual(checked["payload"]["warehouseId"], self.warehouse_id)

    def test_legacy_created_at_uses_stable_entity_row_timestamp(self):
        created_at = datetime(2026, 8, 1, 10, 30, tzinfo=timezone.utc)
        canonical = SERVER.canonical_entity_payload(
            "orders",
            "order-1",
            {"status": "new"},
            self.warehouse_id,
            self.environment,
            created_at,
        )
        self.assertEqual(canonical["createdAt"], created_at.isoformat())
        self.assertEqual(canonical["id"], "order-1")
        self.assertEqual(canonical["warehouseId"], self.warehouse_id)

    def test_immutable_protection_still_rejects_real_identity_change(self):
        auth = {"role": "owner", "permissions": {"*"}}
        current = {"id": "order-1", "warehouseId": self.warehouse_id, "createdAt": "2026-08-01T00:00:00Z"}
        item = {
            "type": "orders",
            "id": "order-1",
            "deleted": False,
            "payload": {**current, "createdAt": "2026-08-02T00:00:00Z"},
        }
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_field_permissions(auth, item, current, False, None)
        self.assertEqual(caught.exception.code, "immutable_entity_field")

    def test_omitted_created_at_is_restored_before_update_validation(self):
        auth = {"role": "owner", "permissions": {"*"}}
        current = {"id": "product-1", "warehouseId": self.warehouse_id, "createdAt": "2026-08-01T00:00:00Z", "name": "Товар"}
        item = {
            "type": "products",
            "id": "product-1",
            "deleted": False,
            "payload": {"id": "product-1", "warehouseId": self.warehouse_id, "name": "Товар 2"},
            "digest_sha256": "stale",
        }
        SERVER.normalize_client_immutable_fields(item, current)
        self.assertEqual(item["payload"]["createdAt"], current["createdAt"])
        self.assertEqual(item["digest_sha256"], SERVER.entity_payload_digest(item["payload"]))
        SERVER.validate_entity_field_permissions(auth, item, current, False, None)

    def test_stale_client_created_at_is_replaced_by_authoritative_value(self):
        auth = {"role": "owner", "permissions": {"*"}}
        current = {"id": "product-1", "warehouseId": self.warehouse_id, "createdAt": "2026-08-01T00:00:00Z", "name": "Товар"}
        item = {
            "type": "products",
            "id": "product-1",
            "deleted": False,
            "payload": {**current, "createdAt": "2026-07-31T20:30:00Z", "name": "Товар 2"},
            "digest_sha256": "stale",
        }
        SERVER.normalize_client_immutable_fields(item, current)
        self.assertEqual(item["payload"]["createdAt"], current["createdAt"])
        self.assertEqual(item["payload"]["name"], "Товар 2")
        self.assertEqual(item["digest_sha256"], SERVER.entity_payload_digest(item["payload"]))
        SERVER.validate_entity_field_permissions(auth, item, current, False, None)

    def test_custom_role_can_only_write_granted_section(self):
        auth = {"role": "Старший кладовщик", "permissions": {"inventory.catalog"}}
        self.assertTrue(SERVER.entity_permission_allowed(auth, "products", write=True))
        self.assertFalse(SERVER.entity_permission_allowed(auth, "orders", write=True))

    def test_legacy_coarse_permission_is_not_expanded_at_runtime(self):
        auth = {"role": "Старший кладовщик", "permissions": {"inventory.update"}}
        self.assertFalse(SERVER.permission_allowed(auth, "inventory.catalog"))
        self.assertFalse(SERVER.permission_allowed(auth, "inventory.delete"))

    def test_read_permission_does_not_grant_write(self):
        auth = {"role": "Наблюдатель", "permissions": {"orders.read"}}
        self.assertTrue(SERVER.entity_permission_allowed(auth, "orders", write=False))
        self.assertFalse(SERVER.entity_permission_allowed(auth, "orders", write=True))

    def test_readable_types_change_with_custom_permissions(self):
        before = {"role": "Кладовщик", "permissions": {"orders.read", "inventory.read"}}
        after = {"role": "Кладовщик", "permissions": {"inventory.read"}}
        before_types = {
            entity_type
            for entity_type in SERVER.ENTITY_SECTIONS
            if SERVER.entity_permission_allowed(before, entity_type, write=False)
        }
        after_types = {
            entity_type
            for entity_type in SERVER.ENTITY_SECTIONS
            if SERVER.entity_permission_allowed(after, entity_type, write=False)
        }
        self.assertIn("orders", before_types)
        self.assertNotIn("orders", after_types)
        self.assertIn("products", after_types)

    def test_entity_paths_are_company_and_warehouse_scoped(self):
        path = "/v1/workspaces/company_12345678/warehouses/warehouse-1/entities/live/batch"
        match = SERVER.ENTITY_BATCH_PATH_RE.fullmatch(path)
        self.assertIsNotNone(match)
        self.assertEqual(match.groups(), ("company_12345678", "warehouse-1", "live"))

    def test_delete_payload_has_stable_digest(self):
        first = SERVER.validate_entity_change(
            {"type": "orders", "id": "order-1", "base_version": 2, "deleted": True},
            self.warehouse_id,
            self.environment,
        )
        second = SERVER.validate_entity_change(
            {"type": "orders", "id": "order-1", "base_version": 2, "deleted": True, "payload": {"ignored": True}},
            self.warehouse_id,
            self.environment,
        )
        self.assertEqual(first["digest_sha256"], second["digest_sha256"])

    def test_route_start_intent_requires_execution_and_orders_in_transit(self):
        changes = [
            SERVER.validate_entity_change(
                {
                    "type": "routePlans",
                    "id": "route-1",
                    "base_version": 1,
                    "payload": {"id": "route-1", "finalized": True, "lifecycleStatus": "in_transit", "orderedIds": ["order-1"], "warehouseId": self.warehouse_id},
                },
                self.warehouse_id,
                self.environment,
            ),
            SERVER.validate_entity_change(
                {
                    "type": "routeExecutions",
                    "id": "route-1",
                    "base_version": 0,
                    "payload": {
                        "id": "route-1",
                        "status": "in_transit",
                        "warehouseId": self.warehouse_id,
                        "readinessSnapshot": {"checks": [{"ok": True, "label": "Готов"}]},
                    },
                },
                self.warehouse_id,
                self.environment,
            ),
            SERVER.validate_entity_change(
                {
                    "type": "orders",
                    "id": "order-1",
                    "base_version": 1,
                    "payload": {"id": "order-1", "fulfillmentStatus": "in_transit", "warehouseId": self.warehouse_id},
                },
                self.warehouse_id,
                self.environment,
            ),
        ]
        intent = SERVER.validate_entity_intent({"kind": "route_start", "target_id": "route-1"}, changes)
        self.assertEqual(intent, {"kind": "route_start", "target_id": "route-1"})

    def test_route_close_intent_rejects_missing_archive(self):
        changes = [
            SERVER.validate_entity_change(
                {"type": "routeExecutions", "id": "route-1", "base_version": 2, "deleted": True},
                self.warehouse_id,
                self.environment,
            )
        ]
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_intent({"kind": "route_close", "target_id": "route-1"}, changes)
        self.assertEqual(caught.exception.code, "invalid_route_transition")

    def test_pickup_collected_intent_requires_reservation_release(self):
        changes = [
            SERVER.validate_entity_change(
                {
                    "type": "orders",
                    "id": "order-1",
                    "base_version": 1,
                    "payload": {"id": "order-1", "fulfillmentStatus": "pickup_collected", "warehouseId": self.warehouse_id},
                },
                self.warehouse_id,
                self.environment,
            ),
            SERVER.validate_entity_change(
                {"type": "warehouseReservations", "id": "order-1", "base_version": 1, "deleted": True},
                self.warehouse_id,
                self.environment,
            ),
        ]
        intent = SERVER.validate_entity_intent({"kind": "pickup_collected", "target_id": "order-1"}, changes)
        self.assertEqual(intent["kind"], "pickup_collected")

    def local_migration_changes(self):
        return [
            SERVER.validate_entity_change(
                {
                    "type": entity_type,
                    "id": entity_id,
                    "base_version": 0,
                    "payload": {"id": entity_id, "warehouseId": self.warehouse_id},
                },
                self.warehouse_id,
                self.environment,
            )
            for entity_type, entity_id in (
                ("routeExecutions", "route-1"),
                ("routeArchives", "archive-1"),
                ("warehouseReservations", "reservation-1"),
            )
        ]

    def local_migration_intent(self, **metadata_overrides):
        metadata = {
            "snapshot_fingerprint": "1a2b3c:4d5e6f:12345",
            "chunk_index": 0,
            "chunk_count": 1,
            **metadata_overrides,
        }
        return {
            "kind": SERVER.LOCAL_MIGRATION_INTENT_KIND,
            "target_id": self.warehouse_id,
            "metadata": metadata,
        }

    def test_owner_local_migration_can_create_protected_entities(self):
        changes = self.local_migration_changes()
        intent = SERVER.validate_entity_intent(self.local_migration_intent(), changes)
        auth = {
            "role": "owner",
            "permissions": {"warehouses.manage", "jf.warehouse:*"},
            "legacy": False,
        }
        SERVER.validate_local_migration_import_request(
            intent,
            auth,
            self.warehouse_id,
            self.environment,
            changes,
        )
        for item in changes:
            SERVER.validate_entity_field_permissions(auth, item, None, False, intent)

    def test_ordinary_write_still_rejects_protected_entity(self):
        item = self.local_migration_changes()[0]
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_field_permissions(
                {"role": "owner", "permissions": {"*"}},
                item,
                None,
                False,
                None,
            )
        self.assertEqual(caught.exception.code, "server_intent_required")

    def test_local_migration_rejects_non_owner_even_with_global_permissions(self):
        changes = self.local_migration_changes()
        intent = SERVER.validate_entity_intent(self.local_migration_intent(), changes)
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_local_migration_import_request(
                intent,
                {"role": "administrator", "permissions": {"*"}, "legacy": False},
                self.warehouse_id,
                self.environment,
                changes,
            )
        self.assertEqual(caught.exception.code, "local_migration_access_denied")

    def test_local_migration_rejects_owner_without_global_warehouse_scope(self):
        changes = self.local_migration_changes()
        intent = SERVER.validate_entity_intent(self.local_migration_intent(), changes)
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_local_migration_import_request(
                intent,
                {"role": "owner", "permissions": {"warehouses.manage"}, "legacy": False},
                self.warehouse_id,
                self.environment,
                changes,
            )
        self.assertEqual(caught.exception.code, "local_migration_access_denied")

    def test_local_migration_rejects_malformed_metadata(self):
        changes = self.local_migration_changes()
        malformed = [
            self.local_migration_intent(snapshot_fingerprint="ABC:def:1"),
            self.local_migration_intent(chunk_index=True),
            self.local_migration_intent(chunk_index=1, chunk_count=1),
            self.local_migration_intent(chunk_count=0),
            self.local_migration_intent(chunk_count=SERVER.LOCAL_MIGRATION_MAX_CHUNKS + 1),
            {**self.local_migration_intent(), "unexpected": True},
            {**self.local_migration_intent(), "metadata": {"snapshot_fingerprint": "a:b:1"}},
        ]
        for raw_intent in malformed:
            with self.subTest(raw_intent=raw_intent):
                with self.assertRaises(SERVER.ApiError) as caught:
                    SERVER.validate_entity_intent(raw_intent, changes)
                self.assertEqual(caught.exception.code, "invalid_local_migration_metadata")

    def test_local_migration_requires_exact_live_warehouse_and_create_only_changes(self):
        changes = self.local_migration_changes()
        intent = SERVER.validate_entity_intent(self.local_migration_intent(), changes)
        auth = {"role": "owner", "permissions": {"*"}, "legacy": False}
        cases = [
            ("warehouse-2", "live", changes, "local_migration_scope_mismatch"),
            (self.warehouse_id, "demo", changes, "local_migration_live_only"),
            (
                self.warehouse_id,
                "live",
                [{**changes[0], "base_version": 1}],
                "local_migration_create_only",
            ),
            (
                self.warehouse_id,
                "live",
                [{**changes[0], "deleted": True, "payload": None}],
                "local_migration_create_only",
            ),
        ]
        for warehouse_id, environment, candidate_changes, code in cases:
            with self.subTest(code=code):
                with self.assertRaises(SERVER.ApiError) as caught:
                    SERVER.validate_local_migration_import_request(
                        intent,
                        auth,
                        warehouse_id,
                        environment,
                        candidate_changes,
                    )
                self.assertEqual(caught.exception.code, code)

    def test_inventory_conflict_includes_route_and_pickup_reservations(self):
        maps = {
            "products": {
                "product-1": {"id": "product-1", "name": "Лист", "stockTracked": True, "openingStock": 10}
            },
            "inventoryMovements": {},
            "orders": {
                "order-1": {"id": "order-1", "items": [{"productId": "product-1", "qty": 6}]}
            },
            "routeLocks": {"order-1": {"__jf_wrapped_value": True, "value": "route-1"}},
            "warehouseReservations": {
                "pickup-1": {"orderId": "pickup-1", "lines": [{"productId": "product-1", "qty": 5}]}
            },
        }
        conflicts = SERVER.inventory_conflicts_from_entity_maps(maps)
        self.assertEqual(conflicts[0]["product_id"], "product-1")
        self.assertEqual(conflicts[0]["reserved"], 11)
        self.assertEqual(conflicts[0]["missing"], 1)

    def test_inventory_expense_and_reservation_release_are_balanced_together(self):
        maps = {
            "products": {
                "product-1": {"id": "product-1", "name": "Лист", "stockTracked": True, "openingStock": 10}
            },
            "inventoryMovements": {
                "expense-1": {"id": "expense-1", "productId": "product-1", "delta": -6}
            },
            "orders": {},
            "routeLocks": {},
            "warehouseReservations": {
                "pickup-1": {"orderId": "pickup-1", "lines": [{"productId": "product-1", "qty": 4}]}
            },
        }
        self.assertEqual(SERVER.inventory_conflicts_from_entity_maps(maps), [])

    def route_start_rows(self):
        return {
            ("warehouse", self.warehouse_id): {"id": self.warehouse_id, "address": "Москва", "lat": 55.75, "lon": 37.61},
            ("routePlans", "route-1"): {"id": "route-1", "finalized": True, "lifecycleStatus": "loading", "orderedIds": ["order-1"]},
            ("routeDriverAssignments", "route-1"): {"__jf_wrapped_value": True, "value": "driver-1"},
            ("drivers", "driver-1"): {"id": "driver-1", "active": True},
            ("routeLocks", "order-1"): {"__jf_wrapped_value": True, "value": "route-1"},
            ("orders", "order-1"): {"id": "order-1", "fulfillmentStatus": "picking", "warehouseFlowStatus": "picking"},
        }

    def route_start_changes(self):
        return [
            {"type": "routePlans", "id": "route-1", "deleted": False, "payload": {"id": "route-1", "finalized": True, "lifecycleStatus": "in_transit", "orderedIds": ["order-1"]}},
            {"type": "routeExecutions", "id": "route-1", "deleted": False, "payload": {"id": "route-1", "status": "in_transit", "orderIds": ["order-1"], "readinessSnapshot": {"checks": [{"label": "Готов", "ok": True}]}}},
            {"type": "orders", "id": "order-1", "deleted": False, "payload": {"id": "order-1", "fulfillmentStatus": "in_transit", "warehouseFlowStatus": "loaded", "deliveryAddress": "Подольск", "geo": {"lat": 55.43, "lon": 37.55}, "items": [{"productId": "product-1", "qty": 2}]}},
        ]

    def route_picking_rows(self):
        return {
            ("routePlans", "route-1"): {"id": "route-1", "finalized": True, "lifecycleStatus": "ready_to_release", "orderedIds": ["order-1"]},
            ("routeDriverAssignments", "route-1"): {"__jf_wrapped_value": True, "value": "driver-1"},
            ("drivers", "driver-1"): {"id": "driver-1", "active": True},
            ("routeLocks", "order-1"): {"__jf_wrapped_value": True, "value": "route-1"},
            ("orders", "order-1"): {"id": "order-1", "fulfillmentStatus": "active", "warehouseFlowStatus": "reserved"},
        }

    def route_picking_changes(self):
        return [
            {"type": "routePlans", "id": "route-1", "deleted": False, "payload": {"id": "route-1", "finalized": True, "lifecycleStatus": "loading", "orderedIds": ["order-1"]}},
            {"type": "orders", "id": "order-1", "deleted": False, "payload": {"id": "order-1", "fulfillmentStatus": "picking", "warehouseFlowStatus": "picking"}},
        ]

    def route_approval_rows(self):
        return {
            ("routePlans", "route-1"): {"id": "route-1", "finalized": False, "lifecycleStatus": "needs_decision", "orderedIds": ["order-1"], "reviewFingerprint": "review-1"},
            ("orders", "order-1"): {"id": "order-1", "fulfillmentStatus": "active"},
        }

    def route_approval_changes(self, actor="user-1"):
        return [
            {"type": "routePlans", "id": "route-1", "deleted": False, "payload": {"id": "route-1", "finalized": True, "lifecycleStatus": "ready_to_release", "orderedIds": ["order-1"], "requiresManualApproval": True, "reviewFingerprint": "review-1", "manualApproval": {"approved": True, "note": "Проверено ответственным", "approvedBy": actor, "approvedAt": "2026-08-09T00:00:00Z", "reviewFingerprint": "review-1"}}},
            {"type": "routeLocks", "id": "order-1", "deleted": False, "payload": {"__jf_wrapped_value": True, "value": "route-1"}},
            {"type": "routeAssignments", "id": "order-1", "deleted": False, "payload": {"__jf_wrapped_value": True, "value": "route-1"}},
            {"type": "routeCatalog", "id": "route-1", "deleted": False, "payload": {"id": "route-1", "title": "Рейс"}},
        ]

    def test_server_route_approval_records_matching_actor_and_version(self):
        changes = self.route_approval_changes()
        intent = SERVER.validate_entity_intent({"kind": "route_approve", "target_id": "route-1"}, changes)
        SERVER.validate_entity_intent_current(EntityCursor(self.route_approval_rows()), "company-1", self.warehouse_id, self.environment, intent, changes, {"user_id": "user-1"})

    def test_server_route_approval_rejects_actor_substitution(self):
        changes = self.route_approval_changes(actor="user-2")
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_intent_current(EntityCursor(self.route_approval_rows()), "company-1", self.warehouse_id, self.environment, {"kind": "route_approve", "target_id": "route-1"}, changes, {"user_id": "user-1"})
        self.assertEqual(caught.exception.code, "route_approval_actor_mismatch")

    def test_granular_route_permissions_stay_independent(self):
        self.assertTrue(SERVER.permission_allowed({"role": "Логист", "permissions": {"routes.start"}}, "routes.start"))
        self.assertFalse(SERVER.permission_allowed({"role": "Логист", "permissions": {"routes.start"}}, "routes.close"))
        self.assertFalse(SERVER.permission_allowed({"role": "Старая роль", "permissions": {"routes.update"}}, "routes.close"))

    def test_route_start_intent_cannot_change_order_price(self):
        auth = {"role": "Логист", "permissions": {"routes.start"}}
        current = {"id": "order-1", "warehouseId": self.warehouse_id, "fulfillmentStatus": "picking", "warehouseFlowStatus": "picking", "goodsTotal": 100}
        item = {"type": "orders", "id": "order-1", "deleted": False, "payload": {**current, "fulfillmentStatus": "in_transit", "warehouseFlowStatus": "loaded", "goodsTotal": 1}}
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_field_permissions(auth, item, current, False, {"kind": "route_start", "target_id": "route-1"})
        self.assertEqual(caught.exception.code, "intent_field_access_denied")

    def test_catalog_permission_cannot_change_product_price(self):
        auth = {"role": "Каталог", "permissions": {"inventory.catalog"}}
        current = {"id": "product-1", "warehouseId": self.warehouse_id, "name": "Товар", "price": 100}
        item = {"type": "products", "id": "product-1", "deleted": False, "payload": {**current, "price": 200}}
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_field_permissions(auth, item, current, False, None)
        self.assertEqual(caught.exception.code, "entity_field_access_denied")
        self.assertEqual(caught.exception.details["required_permissions"], ["inventory.pricing"])

    def test_pricing_permission_cannot_change_product_passport(self):
        auth = {"role": "Ценообразование", "permissions": {"inventory.pricing"}}
        current = {"id": "product-1", "warehouseId": self.warehouse_id, "name": "Товар", "price": 100}
        item = {"type": "products", "id": "product-1", "deleted": False, "payload": {**current, "name": "Другой товар"}}
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_field_permissions(auth, item, current, False, None)
        self.assertEqual(caught.exception.code, "entity_field_access_denied")
        self.assertEqual(caught.exception.details["required_permissions"], ["inventory.catalog"])

    def test_report_settings_permission_cannot_change_expenses(self):
        auth = {"role": "Аналитик", "permissions": {"reports.settings"}}
        current = {"settings": {"dateBasis": "deliveryDate"}, "employees": [], "expenses": []}
        item = {"type": "reportingData", "id": "reportingData", "deleted": False, "payload": {**current, "expenses": [{"id": "expense-1", "name": "Аренда"}]}}
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_field_permissions(auth, item, current, False, None)
        self.assertEqual(caught.exception.code, "entity_field_access_denied")
        self.assertEqual(caught.exception.details["required_permissions"], ["reports.expenses"])

    def route_cancel_rows(self):
        return {
            ("routePlans", "route-1"): {"id": "route-1", "finalized": True, "lifecycleStatus": "ready_to_release", "orderedIds": ["order-1"]},
            ("routeLocks", "order-1"): {"__jf_wrapped_value": True, "value": "route-1"},
            ("routeAssignments", "order-1"): {"__jf_wrapped_value": True, "value": "route-1"},
            ("routeCatalog", "route-1"): {"id": "route-1", "title": "Рейс"},
            ("orders", "order-1"): {"id": "order-1", "fulfillmentStatus": "active", "warehouseFlowStatus": "reserved"},
        }

    def route_cancel_changes(self):
        return [
            {"type": "routePlans", "id": "route-1", "deleted": True, "payload": None},
            {"type": "orders", "id": "order-1", "deleted": False, "payload": {"id": "order-1", "fulfillmentStatus": "active", "warehouseFlowStatus": "planned"}},
            {"type": "routeLocks", "id": "order-1", "deleted": True, "payload": None},
            {"type": "routeAssignments", "id": "order-1", "deleted": False, "payload": {"__jf_wrapped_value": True, "value": "__unassigned__"}},
            {"type": "routeCatalog", "id": "route-1", "deleted": True, "payload": None},
        ]

    def test_server_route_picking_accepts_complete_transition(self):
        SERVER.validate_entity_intent_current(EntityCursor(self.route_picking_rows()), "company-1", self.warehouse_id, self.environment, {"kind": "route_picking", "target_id": "route-1"}, self.route_picking_changes())

    def test_server_route_picking_rejects_stale_manual_approval(self):
        rows = self.route_picking_rows()
        rows[("routePlans", "route-1")].update({"requiresManualApproval": True, "reviewFingerprint": "current"})
        changes = self.route_picking_changes()
        changes[0]["payload"].update({"requiresManualApproval": True, "reviewFingerprint": "current", "manualApproval": {"approved": True, "reviewFingerprint": "stale"}})
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_intent_current(EntityCursor(rows), "company-1", self.warehouse_id, self.environment, {"kind": "route_picking", "target_id": "route-1"}, changes)
        self.assertEqual(caught.exception.code, "route_approval_required")

    def test_server_route_cancel_releases_orders_and_reservations(self):
        SERVER.validate_entity_intent_current(EntityCursor(self.route_cancel_rows()), "company-1", self.warehouse_id, self.environment, {"kind": "route_cancel", "target_id": "route-1"}, self.route_cancel_changes())

    def test_server_route_cancel_rejects_departed_route(self):
        rows = self.route_cancel_rows()
        rows[("routeExecutions", "route-1")] = {"id": "route-1", "status": "in_transit", "orderIds": ["order-1"]}
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_intent_current(EntityCursor(rows), "company-1", self.warehouse_id, self.environment, {"kind": "route_cancel", "target_id": "route-1"}, self.route_cancel_changes())
        self.assertEqual(caught.exception.code, "route_already_started")

    def test_server_route_start_accepts_complete_state_machine_transition(self):
        SERVER.validate_entity_intent_current(EntityCursor(self.route_start_rows()), "company-1", self.warehouse_id, self.environment, {"kind": "route_start", "target_id": "route-1"}, self.route_start_changes())

    def test_server_route_start_rejects_missing_route_reservation(self):
        rows = self.route_start_rows()
        rows.pop(("routeLocks", "order-1"))
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_intent_current(EntityCursor(rows), "company-1", self.warehouse_id, self.environment, {"kind": "route_start", "target_id": "route-1"}, self.route_start_changes())
        self.assertEqual(caught.exception.code, "route_reservation_missing")

    def test_server_route_close_rejects_missing_stock_expense(self):
        rows = {
            ("routeExecutions", "route-1"): {"id": "route-1", "status": "awaiting_close", "orderIds": ["order-1"]},
            ("products", "product-1"): {"id": "product-1", "stockTracked": True},
        }
        changes = [
            {"type": "routeExecutions", "id": "route-1", "deleted": True, "payload": None},
            {"type": "routeArchives", "id": "route-1", "deleted": False, "payload": {"id": "route-1", "status": "closed", "outcomes": [{"orderId": "order-1", "outcome": "delivered"}]}},
            {"type": "orders", "id": "order-1", "deleted": False, "payload": {"id": "order-1", "fulfillmentStatus": "delivered", "warehouseFlowStatus": "shipped", "fulfillmentResult": {"deliveredItems": [{"productId": "product-1", "qty": 2}]}}},
            {"type": "routeLocks", "id": "order-1", "deleted": True, "payload": None},
            {"type": "routeAssignments", "id": "order-1", "deleted": True, "payload": None},
            {"type": "routePlans", "id": "route-1", "deleted": True, "payload": None},
            {"type": "routeDriverAssignments", "id": "route-1", "deleted": True, "payload": None},
            {"type": "routeCatalog", "id": "route-1", "deleted": True, "payload": None},
        ]
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_intent_current(EntityCursor(rows), "company-1", self.warehouse_id, self.environment, {"kind": "route_close", "target_id": "route-1"}, changes)
        self.assertEqual(caught.exception.code, "route_stock_expense_mismatch")

    def test_server_pickup_collected_rejects_missing_stock_expense(self):
        rows = {
            ("orders", "order-1"): {"id": "order-1", "fulfillmentStatus": "pickup_ready"},
            ("products", "product-1"): {"id": "product-1", "stockTracked": True},
        }
        changes = [
            {"type": "orders", "id": "order-1", "deleted": False, "payload": {"id": "order-1", "fulfillmentStatus": "pickup_collected", "items": [{"productId": "product-1", "qty": 1}]}},
            {"type": "warehouseReservations", "id": "order-1", "deleted": True, "payload": None},
        ]
        with self.assertRaises(SERVER.ApiError) as caught:
            SERVER.validate_entity_intent_current(EntityCursor(rows), "company-1", self.warehouse_id, self.environment, {"kind": "pickup_collected", "target_id": "order-1"}, changes)
        self.assertEqual(caught.exception.code, "pickup_stock_expense_mismatch")


if __name__ == "__main__":
    unittest.main(verbosity=2)
