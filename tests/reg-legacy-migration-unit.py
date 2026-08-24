from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "source" / "application" / "integrations" / "reg-vps" / "server" / "server.py"
SPEC = importlib.util.spec_from_file_location("justfun_reg_legacy_migration", SERVER_PATH)
SERVER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(SERVER)


def snapshot() -> dict:
    return {
        "warehouse": {
            "id": "warehouse-legacy-a",
            "environment": "live",
            "code": "СПБ",
            "name": "Старый склад",
        },
        "data": {
            "warehouseId": "warehouse-legacy-a",
            "orders": [
                {"id": "order-legacy-1", "warehouseId": "warehouse-legacy-a", "status": "new"}
            ],
            "products": [],
            "inventoryMovements": [],
            "drivers": [],
            "routeArchives": [
                {"routeId": "route-archive-1", "warehouseId": "warehouse-legacy-a"}
            ],
            "settings": {"warehouse": {"address": "Санкт-Петербург"}},
            "reportingData": {"employees": []},
            "company": {"shortName": "Тест"},
            "routePlans": {"route-1": {"distance": 10}},
            "routeAssignments": {},
            "routeCatalog": {},
            "routeDriverAssignments": {},
            "routeLocks": {},
            "routeOverrides": {},
            "routeExecutions": {},
            "warehouseReservations": {},
            "manualRouteSequences": {},
        },
    }


class LegacyMigrationUnitTests(unittest.TestCase):
    def test_v1_snapshot_is_split_without_cross_scope_loss(self):
        entities = SERVER.legacy_snapshot_entities(snapshot(), "warehouse-legacy-a", "live")
        keys = {(item["type"], item["id"]) for item in entities}
        self.assertEqual(len(keys), len(entities))
        self.assertIn(("warehouse", "warehouse-legacy-a"), keys)
        self.assertIn(("orders", "order-legacy-1"), keys)
        self.assertIn(("routeArchives", "route-archive-1"), keys)
        self.assertIn(("settings", "settings"), keys)
        self.assertIn(("routePlans", "route-1"), keys)

    def test_digest_matches_the_published_v1_contract(self):
        value = snapshot()
        stable = {"warehouse": value["warehouse"], "data": value["data"]}
        expected = hashlib.sha256(
            json.dumps(stable, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        self.assertEqual(SERVER._legacy_snapshot_digest(value), expected)
        self.assertEqual(sorted(SERVER.REGISTERED_SCHEMA_MIGRATIONS), [290, 291, 300, 301, 302])
        self.assertTrue(all(len(checksum) == 64 for _name, checksum in SERVER.REGISTERED_SCHEMA_MIGRATIONS.values()))

    def test_foreign_scope_and_duplicates_fail_closed(self):
        foreign = snapshot()
        foreign["data"]["orders"][0]["warehouseId"] = "warehouse-other"
        with self.assertRaisesRegex(RuntimeError, "another warehouse"):
            SERVER.legacy_snapshot_entities(foreign, "warehouse-legacy-a", "live")

        duplicate = snapshot()
        duplicate["data"]["orders"].append(dict(duplicate["data"]["orders"][0]))
        with self.assertRaisesRegex(RuntimeError, "duplicate legacy entity"):
            SERVER.legacy_snapshot_entities(duplicate, "warehouse-legacy-a", "live")

    def test_unknown_shapes_and_invalid_codes_are_not_guessed(self):
        invalid_map = snapshot()
        invalid_map["data"]["routePlans"] = []
        with self.assertRaisesRegex(RuntimeError, "is not an object map"):
            SERVER.legacy_snapshot_entities(invalid_map, "warehouse-legacy-a", "live")

        invalid_code = snapshot()
        invalid_code["warehouse"]["code"] = "TOO-LONG"
        with self.assertRaisesRegex(RuntimeError, "invalid warehouse code"):
            SERVER.legacy_snapshot_entities(invalid_code, "warehouse-legacy-a", "live")

    def test_source_archives_known_tables_and_never_drops_them(self):
        source = SERVER_PATH.read_text(encoding="utf-8")
        for table in ("warehouse_snapshots", "workspace_entities", "workspace_change_events", "processed_commands"):
            self.assertNotIn(f"DROP TABLE IF EXISTS {table}", source)
        self.assertIn("legacy_v1_warehouse_snapshots_archive", source)
        self.assertIn("legacy_v2_workspace_entities_archive", source)
        self.assertIn("UNSUPPORTED_SCHEMA", source)
        self.assertIn("CORRUPT_SCHEMA", source)
        self.assertIn('"schema_migrations": schema_migrations', source)

        installer = (SERVER_PATH.parent / "install.sh").read_text(encoding="utf-8")
        self.assertIn('pg_restore --list "$BACKUP_DIR/orderslogistics.dump"', installer)
        self.assertIn('orderslogistics.dump.sha256', installer)
        self.assertIn('pg_restore --exit-on-error --dbname=orderslogistics', installer)


if __name__ == "__main__":
    unittest.main()
