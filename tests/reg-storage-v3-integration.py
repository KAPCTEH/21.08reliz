from __future__ import annotations

import importlib.util
import json
import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
import re
import threading
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "source" / "application" / "integrations" / "reg-vps" / "server" / "server.py"
APP_DSN = os.environ.get("JF_TEST_POSTGRES_DSN", "").strip()
ADMIN_DSN = os.environ.get("JF_TEST_POSTGRES_ADMIN_DSN", "").strip()
REQUIRE_POSTGRES_TESTS = os.environ.get("JF_REQUIRE_POSTGRES_TESTS", "0").strip() == "1"
POSTGRES_CONFIGURED = bool(APP_DSN and ADMIN_DSN)

if REQUIRE_POSTGRES_TESTS and not POSTGRES_CONFIGURED:
    raise RuntimeError(
        "JF_REQUIRE_POSTGRES_TESTS=1 requires both JF_TEST_POSTGRES_ADMIN_DSN and JF_TEST_POSTGRES_DSN"
    )


@unittest.skipUnless(
    POSTGRES_CONFIGURED,
    "JF_TEST_POSTGRES_ADMIN_DSN and JF_TEST_POSTGRES_DSN are not configured",
)
class ServerAuthoritativeStorageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg2
        from psycopg2 import sql
        from psycopg2.extensions import parse_dsn

        app_parameters = parse_dsn(APP_DSN)
        admin_parameters = parse_dsn(ADMIN_DSN)
        app_role = str(app_parameters.get("user", ""))
        app_password = str(app_parameters.get("password", ""))
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,62}", app_role) or not app_password:
            raise RuntimeError("JF_TEST_POSTGRES_DSN must contain a safe non-superuser role and password")
        if app_role == str(admin_parameters.get("user", "")):
            raise RuntimeError("PostgreSQL admin and app test roles must be different")

        admin_connection = psycopg2.connect(ADMIN_DSN)
        admin_connection.autocommit = True
        try:
            with admin_connection.cursor() as cur:
                cur.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (app_role,))
                role_exists = cur.fetchone() is not None
                role_statement = "ALTER ROLE" if role_exists else "CREATE ROLE"
                cur.execute(
                    sql.SQL(
                        f"{role_statement} {{}} WITH LOGIN PASSWORD %s "
                        "NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS"
                    ).format(sql.Identifier(app_role)),
                    (app_password,),
                )
                database_name = str(admin_connection.get_dsn_parameters().get("dbname", ""))
                if database_name:
                    cur.execute(
                        sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                            sql.Identifier(database_name),
                            sql.Identifier(app_role),
                        )
                    )
        finally:
            admin_connection.close()

        os.environ["JF_DB_DSN"] = ADMIN_DSN
        os.environ["JF_DB_POOL_MIN"] = "2"
        os.environ["JF_DB_POOL_MAX"] = "48"
        os.environ["JF_VPS_ATTESTATION_SECRET"] = "jfvps_" + "i" * 43
        spec = importlib.util.spec_from_file_location("justfun_storage_v3_server", SERVER_PATH)
        cls.server = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(cls.server)
        cls.server.init_schema()
        cls.server.verify_warehouse_delete_lease = lambda *_args, **_kwargs: {
            "ok": True,
            "active": True,
            "prepared": True,
            "status": "prepared",
            "remaining_seconds": 120,
        }
        cls.server.prepare_warehouse_delete_lease = lambda *_args, **_kwargs: {
            "ok": True,
            "prepared": True,
            "status": "prepared",
        }
        cls.server.confirm_warehouse_telegram_deprovision = lambda *_args, **_kwargs: {
            "deprovisioned": True,
            "already_deprovisioned": False,
            "installation_id": "tg_integration_installation_001",
        }
        cls.original_outbox_delivery = cls.server._deliver_warehouse_delete_release
        cls.outbox_deliveries = []
        cls.server._deliver_warehouse_delete_release = (
            lambda item: cls.outbox_deliveries.append(dict(item)) or {"ok": True, "released": True, "status": "released"}
        )

        admin_connection = psycopg2.connect(ADMIN_DSN)
        admin_connection.autocommit = True
        try:
            with admin_connection.cursor() as cur:
                cur.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(app_role)))
                cur.execute(
                    sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {}").format(
                        sql.Identifier(app_role)
                    )
                )
                cur.execute(
                    sql.SQL("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {}").format(
                        sql.Identifier(app_role)
                    )
                )
        finally:
            admin_connection.close()

        if cls.server.DB_POOL is not None:
            cls.server.DB_POOL.closeall()
            cls.server.DB_POOL = None
        os.environ["JF_DB_DSN"] = APP_DSN
        cls.psycopg2 = psycopg2
        cls.admin_dsn = ADMIN_DSN
        cls.app_role = app_role

        with cls.server.db_connect() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user"
            )
            current_role, is_superuser, bypasses_rls = cur.fetchone()
            cur.execute("SHOW row_security")
            row_security = str(cur.fetchone()[0]).lower()
            cur.execute(
                "SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='business_records_v3'"
            )
            table_owner = str(cur.fetchone()[0])
            cur.execute(
                """
                SELECT tables.tableowner, classes.relrowsecurity, classes.relforcerowsecurity
                FROM pg_tables AS tables
                JOIN pg_class AS classes ON classes.relname=tables.tablename
                JOIN pg_namespace AS namespaces ON namespaces.oid=classes.relnamespace AND namespaces.nspname=tables.schemaname
                WHERE tables.schemaname='public' AND tables.tablename='warehouse_delete_operations_v3'
                """
            )
            delete_operation_owner, delete_operation_rls, delete_operation_force_rls = cur.fetchone()
            cur.execute(
                """
                SELECT tables.tableowner, classes.relrowsecurity, classes.relforcerowsecurity
                FROM pg_tables AS tables
                JOIN pg_class AS classes ON classes.relname=tables.tablename
                JOIN pg_namespace AS namespaces ON namespaces.oid=classes.relnamespace AND namespaces.nspname=tables.schemaname
                WHERE tables.schemaname='public' AND tables.tablename='warehouse_delete_release_outbox_v3'
                """
            )
            outbox_owner, outbox_rls, outbox_force_rls = cur.fetchone()
        if str(current_role) != app_role or bool(is_superuser) or bool(bypasses_rls):
            raise RuntimeError("PostgreSQL integration must run through the configured non-superuser app role")
        if row_security != "on" or table_owner == app_role:
            raise RuntimeError("PostgreSQL integration does not prove FORCE RLS through a separate app role")
        if str(delete_operation_owner) == app_role or not bool(delete_operation_rls) or not bool(delete_operation_force_rls):
            raise RuntimeError("warehouse delete prepare operations must use FORCE RLS under the separate app role")
        if str(outbox_owner) == app_role or not bool(outbox_rls) or not bool(outbox_force_rls):
            raise RuntimeError("warehouse delete release outbox must use FORCE RLS under the separate app role")

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "original_outbox_delivery"):
            cls.server._deliver_warehouse_delete_release = cls.original_outbox_delivery
        if getattr(cls.server, "DB_POOL", None) is not None:
            cls.server.DB_POOL.closeall()
            cls.server.DB_POOL = None

    def setUp(self):
        self.outbox_deliveries.clear()
        self.workspace = "workspace-company-a"
        self.warehouse = "warehouse-a"
        self.owner = {
            "company_id": self.workspace,
            "role": "owner",
            "permissions": {"*"},
            "user_id": "owner-a",
            "device_id": "integration-test",
        }
        with self.psycopg2.connect(self.admin_dsn) as conn, conn.cursor() as cur:
            cur.execute("TRUNCATE warehouse_delete_release_outbox_v3, warehouse_delete_operations_v3, business_audit_v3, business_commands_v3, business_events_v3, business_records_v3")
        self._save(
            "client:test:warehouse:create",
            [{
                "type": "warehouse",
                "id": self.warehouse,
                "base_version": 0,
                "payload": {"id": self.warehouse, "code": "СПБ", "name": "Склад СПБ", "environment": "live"},
            }],
        )

    def _save(self, command_id, changes, auth=None, warehouse=None, workspace=None, environment="live"):
        request = {"command_id": command_id, "changes": changes}
        delete_changes = [item for item in changes if item.get("type") == "warehouse" and item.get("deleted") is True]
        if delete_changes:
            current_warehouse = warehouse or self.warehouse
            code = "СПБ" if current_warehouse == self.warehouse else "МСК"
            request.update({
                "warehouse_delete_lease_token": "jfdl_" + "a" * 43,
                "warehouse_delete_warehouse_code": code,
            })
        if len(changes) == 1 and len(delete_changes) == 1 and environment == "live":
            self.server.prepare_warehouse_delete(
                workspace or self.workspace,
                warehouse or self.warehouse,
                {
                    "command_id": command_id,
                    "base_version": delete_changes[0]["base_version"],
                    "warehouse_code": request["warehouse_delete_warehouse_code"],
                    "warehouse_delete_lease_token": request["warehouse_delete_lease_token"],
                },
                auth or self.owner,
                "Bearer integration-test-access-token",
            )
        return self.server.save_entity_batch(
            workspace or self.workspace,
            warehouse or self.warehouse,
            environment,
            request,
            auth or self.owner,
            "Bearer integration-test-access-token",
        )

    def _prepare_delete(self, command_id, base_version, code="СПБ", token=None, auth=None, warehouse=None, workspace=None):
        return self.server.prepare_warehouse_delete(
            workspace or self.workspace,
            warehouse or self.warehouse,
            {
                "command_id": command_id,
                "base_version": base_version,
                "warehouse_code": code,
                "warehouse_delete_lease_token": token or ("jfdl_" + "a" * 43),
            },
            auth or self.owner,
            "Bearer integration-test-access-token",
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
        with self.assertRaises(self.server.ApiError) as hidden_warehouse:
            self.server.load_current_entities(self.workspace, self.warehouse, "live", restricted)
        self.assertEqual(hidden_warehouse.exception.code, "warehouse_access_denied")
        with self.assertRaises(self.server.ApiError) as hidden_company:
            self.server.load_current_entities(
                "workspace-company-b", self.warehouse, "live", {**self.owner, "company_id": "workspace-company-b"}
            )
        self.assertEqual(hidden_company.exception.code, "warehouse_access_denied")

    def test_assigned_viewer_reads_company_but_cannot_update_or_read_other_warehouse(self):
        other_warehouse = "warehouse-b"
        self._save(
            "client:test:warehouse:company-read-other",
            [{
                "type": "warehouse",
                "id": other_warehouse,
                "base_version": 0,
                "payload": {
                    "id": other_warehouse,
                    "code": "МСК",
                    "name": "Склад МСК",
                    "environment": "live",
                },
            }],
            warehouse=other_warehouse,
        )
        self._save(
            "client:test:company:create",
            [{
                "type": "company",
                "id": "company",
                "base_version": 0,
                "payload": {
                    "id": "company",
                    "warehouseId": self.warehouse,
                    "programSubtitle": "Исходное название",
                },
            }],
        )
        viewer = {
            "company_id": self.workspace,
            "role": "auditor",
            "permissions": {"orders.read", f"jf.warehouse:{self.warehouse}"},
            "user_id": "auditor-a",
            "device_id": "integration-test-auditor",
        }

        bootstrap = self.server.load_current_entities(self.workspace, self.warehouse, "live", viewer)
        company = next(item for item in bootstrap["entities"] if item["type"] == "company")
        self.assertEqual(company["payload"]["programSubtitle"], "Исходное название")
        self.assertIn("company", bootstrap["readable_types"])

        with self.assertRaises(self.server.ApiError) as denied_update:
            self._save(
                "client:test:company:viewer-update",
                [{
                    "type": "company",
                    "id": "company",
                    "base_version": company["version"],
                    "payload": {
                        **company["payload"],
                        "programSubtitle": "Запрещённое изменение",
                    },
                }],
                auth=viewer,
            )
        self.assertEqual(denied_update.exception.code, "entity_access_denied")

        with self.assertRaises(self.server.ApiError) as denied_warehouse:
            self.server.load_current_entities(self.workspace, other_warehouse, "live", viewer)
        self.assertEqual(denied_warehouse.exception.code, "warehouse_access_denied")

    def test_code_only_rls_resolves_active_live_warehouse_and_isolates_other_scopes(self):
        second_warehouse = "warehouse-b"
        other_workspace = "workspace-company-b"
        other_company_warehouse = "warehouse-company-b"
        self._save(
            "client:test:warehouse:code-scope-b",
            [{
                "type": "warehouse",
                "id": second_warehouse,
                "base_version": 0,
                "payload": {
                    "id": second_warehouse,
                    "code": "МСК",
                    "name": "Склад МСК",
                    "environment": "live",
                },
            }],
            warehouse=second_warehouse,
        )
        self._save(
            "client:test:order:code-scope-a",
            [{
                "type": "orders",
                "id": "order-code-scope-a",
                "base_version": 0,
                "payload": {"id": "order-code-scope-a", "warehouseId": self.warehouse},
            }],
        )
        self._save(
            "client:test:order:code-scope-b",
            [{
                "type": "orders",
                "id": "order-code-scope-b",
                "base_version": 0,
                "payload": {"id": "order-code-scope-b", "warehouseId": second_warehouse},
            }],
            warehouse=second_warehouse,
        )
        other_owner = {**self.owner, "company_id": other_workspace, "user_id": "owner-b"}
        self._save(
            "client:test:warehouse:code-scope-other-company",
            [{
                "type": "warehouse",
                "id": other_company_warehouse,
                "base_version": 0,
                "payload": {
                    "id": other_company_warehouse,
                    "code": "СПБ",
                    "name": "Чужой склад с тем же кодом",
                    "environment": "live",
                },
            }],
            auth=other_owner,
            warehouse=other_company_warehouse,
            workspace=other_workspace,
        )

        code_only = {
            "company_id": self.workspace,
            "role": "custom",
            "permissions": {"orders.read", "orders.create", "jf.warehouse-code:СПБ"},
            "user_id": "worker-code-only",
            "device_id": "integration-test-code-only",
        }
        with self.server.db_connect() as conn, conn.cursor() as cur:
            self.server.set_database_scope(cur, self.workspace, "live", code_only)
            cur.execute(
                """
                SELECT current_setting('jf.workspace_id', true),
                       current_setting('jf.environment', true),
                       current_setting('jf.owner', true),
                       current_setting('jf.allowed_warehouses', true)
                """
            )
            self.assertEqual(
                cur.fetchone(),
                (self.workspace, "live", "0", self.warehouse),
            )
            cur.execute(
                "SELECT DISTINCT workspace_id, warehouse_id FROM business_records_v3 ORDER BY workspace_id, warehouse_id"
            )
            self.assertEqual(cur.fetchall(), [(self.workspace, self.warehouse)])
        self.assertEqual(
            [item["id"] for item in self.server.list_warehouses(self.workspace, "live", code_only)],
            [self.warehouse],
        )
        assigned = self.server.load_current_entities(self.workspace, self.warehouse, "live", code_only)
        self.assertIn("order-code-scope-a", {item["id"] for item in assigned["entities"]})
        with self.assertRaises(self.server.ApiError) as hidden:
            self.server.load_current_entities(self.workspace, second_warehouse, "live", code_only)
        self.assertEqual(hidden.exception.code, "warehouse_access_denied")

        created = self._save(
            "client:test:order:code-only-write-assigned",
            [{
                "type": "orders",
                "id": "order-code-only-write-assigned",
                "base_version": 0,
                "payload": {"id": "order-code-only-write-assigned", "warehouseId": self.warehouse},
            }],
            auth=code_only,
        )
        self.assertEqual(created["entities"][0]["id"], "order-code-only-write-assigned")
        with self.assertRaises(self.server.ApiError) as denied_warehouse:
            self._save(
                "client:test:order:code-only-write-other",
                [{
                    "type": "orders",
                    "id": "order-code-only-write-other",
                    "base_version": 0,
                    "payload": {"id": "order-code-only-write-other", "warehouseId": second_warehouse},
                }],
                auth=code_only,
                warehouse=second_warehouse,
            )
        self.assertEqual(denied_warehouse.exception.code, "warehouse_access_denied")
        with self.assertRaises(self.server.ApiError) as denied_workspace:
            self.server.load_current_entities(
                other_workspace,
                other_company_warehouse,
                "live",
                code_only,
            )
        self.assertEqual(denied_workspace.exception.code, "workspace_mismatch")

        self._save(
            "client:test:warehouse:archive-code-scope",
            [{
                "type": "warehouse",
                "id": self.warehouse,
                "base_version": 1,
                "payload": {
                    "id": self.warehouse,
                    "code": "СПБ",
                    "name": "Склад СПБ",
                    "environment": "live",
                    "status": "archived",
                },
            }],
        )
        self.assertEqual(self.server.list_warehouses(self.workspace, "live", code_only), [])
        with self.assertRaises(self.server.ApiError) as archived_hidden:
            self.server.load_current_entities(self.workspace, self.warehouse, "live", code_only)
        self.assertEqual(archived_hidden.exception.code, "warehouse_access_denied")
        code_manager = {
            **code_only,
            "permissions": {*code_only["permissions"], "warehouses.manage"},
        }
        with self.assertRaises(self.server.ApiError) as denied_unarchive:
            self._save(
                "client:test:warehouse:code-only-unarchive",
                [{
                    "type": "warehouse",
                    "id": self.warehouse,
                    "base_version": 2,
                    "payload": {
                        "id": self.warehouse,
                        "code": "СПБ",
                        "name": "Склад СПБ",
                        "environment": "live",
                        "status": "active",
                    },
                }],
                auth=code_manager,
            )
        self.assertEqual(denied_unarchive.exception.code, "warehouse_access_denied")

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

    def test_warehouse_code_is_canonical_and_unique_under_concurrency(self):
        canonical = self._save(
            "client:test:warehouse:create:canonical-code",
            [{
                "type": "warehouse",
                "id": "warehouse-code-canonical",
                "base_version": 0,
                "payload": {
                    "id": "warehouse-code-canonical",
                    "code": " м1 ",
                    "name": "Канонический код",
                    "environment": "live",
                },
            }],
            warehouse="warehouse-code-canonical",
        )
        self.assertEqual(canonical["entities"][0]["version"], 1)
        listed = self.server.list_warehouses(self.workspace, "live", self.owner)
        self.assertEqual(
            next(item["code"] for item in listed if item["id"] == "warehouse-code-canonical"),
            "М1",
        )

        for index, invalid in enumerate(("", "ABCD", "A-1", "A B")):
            with self.subTest(code=invalid), self.assertRaises(self.server.ApiError) as rejected:
                self._save(
                    f"client:test:warehouse:invalid-code:{index}",
                    [{
                        "type": "warehouse",
                        "id": f"warehouse-invalid-code-{index}",
                        "base_version": 0,
                        "payload": {
                            "id": f"warehouse-invalid-code-{index}",
                            "code": invalid,
                            "environment": "live",
                        },
                    }],
                    warehouse=f"warehouse-invalid-code-{index}",
                )
            self.assertEqual(rejected.exception.code, "invalid_warehouse_code")

        with self.psycopg2.connect(self.admin_dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE business_records_v3
                SET payload=jsonb_set(payload, '{code}', to_jsonb(%s::text), true)
                WHERE workspace_id=%s AND warehouse_id=%s AND environment='live'
                  AND entity_type='warehouse' AND entity_id=%s
                """,
                (" СПБ ", self.workspace, self.warehouse, self.warehouse),
            )
        with self.assertRaises(self.server.ApiError) as legacy_trimmed_conflict:
            self._save(
                "client:test:warehouse:legacy-trimmed-conflict",
                [{
                    "type": "warehouse",
                    "id": "warehouse-legacy-trimmed-conflict",
                    "base_version": 0,
                    "payload": {
                        "id": "warehouse-legacy-trimmed-conflict",
                        "code": "спб",
                        "environment": "live",
                    },
                }],
                warehouse="warehouse-legacy-trimmed-conflict",
            )
        self.assertEqual(legacy_trimmed_conflict.exception.code, "warehouse_code_conflict")

        ready = threading.Barrier(2)

        def create_duplicate(index):
            warehouse_id = f"warehouse-duplicate-code-{index}"
            ready.wait(timeout=5)
            try:
                self._save(
                    f"client:test:warehouse:duplicate-code:{index}",
                    [{
                        "type": "warehouse",
                        "id": warehouse_id,
                        "base_version": 0,
                        "payload": {
                            "id": warehouse_id,
                            "code": "дуб",
                            "name": f"Дубль {index}",
                            "environment": "live",
                        },
                    }],
                    warehouse=warehouse_id,
                )
                return "ok"
            except self.server.ApiError as error:
                return error.code

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(create_duplicate, (1, 2)))
        self.assertEqual(sorted(outcomes), ["ok", "warehouse_code_conflict"])
        duplicate_codes = [item for item in self.server.list_warehouses(self.workspace, "live", self.owner) if item["code"] == "ДУБ"]
        self.assertEqual(len(duplicate_codes), 1)

    def test_warehouse_code_upgrade_preflight_reports_canonical_duplicates(self):
        second_warehouse = "warehouse-upgrade-duplicate"
        self._save(
            "client:test:warehouse:upgrade-duplicate-seed",
            [{
                "type": "warehouse",
                "id": second_warehouse,
                "base_version": 0,
                "payload": {
                    "id": second_warehouse,
                    "code": "ЛЕГ",
                    "environment": "live",
                },
            }],
            warehouse=second_warehouse,
        )

        conn = self.psycopg2.connect(self.admin_dsn)
        try:
            with conn.cursor() as cur:
                cur.execute(f"DROP INDEX {self.server.WAREHOUSE_CODE_UNIQUE_INDEX}")
                cur.execute(
                    """
                    UPDATE business_records_v3
                    SET payload=jsonb_set(
                        payload,
                        '{code}',
                        to_jsonb(CASE WHEN warehouse_id=%s THEN %s::text ELSE %s::text END),
                        true
                    )
                    WHERE workspace_id=%s AND environment='live' AND entity_type='warehouse'
                      AND warehouse_id IN (%s, %s)
                    """,
                    (self.warehouse, " ДУБ ", "дуб", self.workspace, self.warehouse, second_warehouse),
                )
                with self.assertRaises(RuntimeError) as rejected:
                    self.server.ensure_warehouse_code_unique_index(cur)
                self.assertIn("warehouse_code_duplicate_preflight", str(rejected.exception))
                self.assertIn('"code":"ДУБ"', str(rejected.exception))
        finally:
            conn.rollback()
            conn.close()

    def test_delete_prepare_is_durable_idempotent_secret_free_and_rls_scoped(self):
        archived = self._save(
            "client:test:warehouse:archive-before-prepare",
            [{
                "type": "warehouse",
                "id": self.warehouse,
                "base_version": 1,
                "payload": {
                    "id": self.warehouse,
                    "code": "СПБ",
                    "name": "Склад СПБ",
                    "environment": "live",
                    "status": "archived",
                },
            }],
        )
        self.assertEqual(archived["entities"][0]["version"], 2)
        command_id = "client:test:warehouse:delete:prepare-durable"
        token = "jfdl_" + "p" * 43
        first = self._prepare_delete(command_id, 2, token=token)
        replay = self._prepare_delete(command_id, 2, token="jfdl_" + "q" * 43)
        self.assertEqual(first["delete_prepare_contract"], 1)
        self.assertEqual(first["status"], "prepared")
        self.assertFalse(first["replayed"])
        self.assertTrue(replay["replayed"])
        self.assertIsNone(first["final_result"])

        with self.server.db_connect() as conn, conn.cursor() as cur:
            self.server.set_database_scope(cur, self.workspace, "live", self.owner)
            cur.execute(
                """
                SELECT command_id, warehouse_code, base_version, status, actor_id, device_id, result
                FROM warehouse_delete_operations_v3
                WHERE workspace_id=%s AND warehouse_id=%s
                """,
                (self.workspace, self.warehouse),
            )
            row = cur.fetchone()
            self.assertEqual(row[:4], (command_id, "СПБ", 2, "prepared"))
            self.assertEqual(row[4:6], ("owner-a", "integration-test"))
            self.assertIsNone(row[6])
            cur.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema='public' AND table_name='warehouse_delete_operations_v3'
                ORDER BY ordinal_position
                """
            )
            columns = {str(item[0]) for item in cur.fetchall()}
            self.assertFalse({"lease_token", "lease_token_sha256", "secret"} & columns)
            other_workspace = "workspace-company-b"
            self.server.set_database_scope(cur, other_workspace, "live", {**self.owner, "company_id": other_workspace})
            cur.execute(
                "SELECT COUNT(*) FROM warehouse_delete_operations_v3 WHERE workspace_id=%s",
                (self.workspace,),
            )
            self.assertEqual(int(cur.fetchone()[0]), 0, "FORCE RLS must hide prepared operations of another company")

    def test_prepared_delete_blocks_every_live_demo_write_until_exact_final(self):
        self._save(
            "client:test:warehouse:archive-before-prepare-block",
            [{
                "type": "warehouse",
                "id": self.warehouse,
                "base_version": 1,
                "payload": {
                    "id": self.warehouse,
                    "code": "СПБ",
                    "name": "Склад СПБ",
                    "environment": "live",
                    "status": "archived",
                },
            }],
        )
        command_id = "client:test:warehouse:delete:prepare-block"
        self._prepare_delete(command_id, 2)
        for environment in ("live", "demo"):
            with self.subTest(environment=environment), self.assertRaises(self.server.ApiError) as blocked:
                self.server.save_entity_batch(
                    self.workspace,
                    self.warehouse,
                    environment,
                    {
                        "command_id": f"client:test:order:blocked-by-prepare:{environment}",
                        "changes": [{
                            "type": "orders",
                            "id": f"order-blocked-{environment}",
                            "base_version": 0,
                            "payload": {"id": f"order-blocked-{environment}", "warehouseId": self.warehouse},
                        }],
                    },
                    self.owner,
                    "Bearer integration-test-access-token",
                )
            self.assertEqual(blocked.exception.code, "warehouse_delete_prepared")
        with self.assertRaises(self.server.ApiError) as registry_write:
            self._save(
                "client:test:warehouse:unarchive-blocked-by-prepare",
                [{
                    "type": "warehouse",
                    "id": self.warehouse,
                    "base_version": 2,
                    "payload": {
                        "id": self.warehouse,
                        "code": "СПБ",
                        "name": "Склад СПБ",
                        "environment": "live",
                        "status": "active",
                    },
                }],
            )
        self.assertEqual(registry_write.exception.code, "warehouse_delete_prepared")

    def test_existing_prepare_with_replaced_lease_is_superseded_without_actor_takeover(self):
        self._save(
            "client:test:warehouse:archive-before-superseded-lease",
            [{
                "type": "warehouse",
                "id": self.warehouse,
                "base_version": 1,
                "payload": {
                    "id": self.warehouse,
                    "code": "СПБ",
                    "name": "Склад СПБ",
                    "environment": "live",
                    "status": "archived",
                },
            }],
        )
        command_id = "client:test:warehouse:delete:superseded-lease"
        self._prepare_delete(command_id, 2)
        original_prepare = self.server.prepare_warehouse_delete_lease
        self.server.prepare_warehouse_delete_lease = lambda *_args, **_kwargs: (_ for _ in ()).throw(
            self.server.ApiError(409, "WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED", "expired")
        )
        other_owner = {**self.owner, "user_id": "owner-b", "device_id": "integration-test-b"}
        try:
            with self.assertRaises(self.server.ApiError) as rejected:
                self._prepare_delete(
                    "client:test:warehouse:delete:takeover",
                    2,
                    token="jfdl_" + "z" * 43,
                    auth=other_owner,
                )
        finally:
            self.server.prepare_warehouse_delete_lease = original_prepare
        self.assertEqual(rejected.exception.code, "warehouse_delete_lease_superseded")
        with self.server.db_connect() as conn, conn.cursor() as cur:
            self.server.set_database_scope(cur, self.workspace, "live", self.owner)
            cur.execute(
                """
                SELECT command_id, actor_id, device_id, status
                FROM warehouse_delete_operations_v3
                WHERE workspace_id=%s AND warehouse_id=%s
                """,
                (self.workspace, self.warehouse),
            )
            self.assertEqual(cur.fetchone(), (command_id, "owner-a", "integration-test", "prepared"))

    def test_valid_delete_lease_cannot_bypass_missing_prepare(self):
        self._save(
            "client:test:warehouse:archive-before-unprepared-final",
            [{
                "type": "warehouse",
                "id": self.warehouse,
                "base_version": 1,
                "payload": {"id": self.warehouse, "code": "СПБ", "environment": "live", "status": "archived"},
            }],
        )
        with self.assertRaises(self.server.ApiError) as rejected:
            self.server.save_entity_batch(
                self.workspace,
                self.warehouse,
                "live",
                {
                    "command_id": "client:test:warehouse:delete-without-prepare",
                    "changes": [{"type": "warehouse", "id": self.warehouse, "base_version": 2, "deleted": True}],
                    "warehouse_delete_lease_token": "jfdl_" + "z" * 43,
                    "warehouse_delete_warehouse_code": "СПБ",
                },
                self.owner,
                "Bearer integration-test-access-token",
            )
        self.assertEqual(rejected.exception.code, "warehouse_delete_not_prepared")

    def test_warehouse_delete_atomically_tombstones_scope_and_replays(self):
        self._save(
            "client:test:order:create:delete-scope",
            [{
                "type": "orders",
                "id": "order-delete-scope",
                "base_version": 0,
                "payload": {"id": "order-delete-scope", "warehouseId": self.warehouse, "status": "new"},
            }],
        )
        self._save(
            "client:test:product:create:delete-scope",
            [{
                "type": "products",
                "id": "product-delete-scope",
                "base_version": 0,
                "payload": {"id": "product-delete-scope", "warehouseId": self.warehouse, "name": "Удаляемый товар"},
            }],
        )
        self._save(
            "client:test:order:create:delete-scope-demo",
            [{
                "type": "orders",
                "id": "order-delete-scope-demo",
                "base_version": 0,
                "payload": {"id": "order-delete-scope-demo", "warehouseId": self.warehouse, "status": "new"},
            }],
            environment="demo",
        )
        archived = self._save(
            "client:test:warehouse:archive-before-delete",
            [{
                "type": "warehouse",
                "id": self.warehouse,
                "base_version": 1,
                "payload": {
                    "id": self.warehouse,
                    "code": "СПБ",
                    "name": "Склад СПБ",
                    "environment": "live",
                    "status": "archived",
                },
            }],
        )
        self.assertEqual(archived["entities"][0]["version"], 2)
        delete_change = {
            "type": "warehouse",
            "id": self.warehouse,
            "base_version": 2,
            "deleted": True,
        }
        command_id = "client:test:warehouse:delete-cascade"

        lease_verifications = []
        telegram_confirmations = []
        original_verify = self.server.verify_warehouse_delete_lease
        original_telegram_confirm = self.server.confirm_warehouse_telegram_deprovision
        self.server.verify_warehouse_delete_lease = lambda *args, **kwargs: lease_verifications.append((args, kwargs)) or {
            "ok": True,
            "active": True,
            "prepared": True,
            "status": "prepared",
            "remaining_seconds": 120,
        }
        self.server.confirm_warehouse_telegram_deprovision = lambda *args, **kwargs: telegram_confirmations.append((args, kwargs)) or {
            "deprovisioned": True,
            "already_deprovisioned": False,
            "installation_id": "tg_integration_installation_001",
        }
        try:
            deleted = self._save(command_id, [delete_change])
            replay_request = {
                "command_id": command_id,
                "changes": [delete_change],
                "warehouse_delete_lease_token": "jfdl_" + "b" * 43,
                "warehouse_delete_warehouse_code": "СПБ",
            }
            replay = self.server.save_entity_batch(
                self.workspace,
                self.warehouse,
                "live",
                replay_request,
                self.owner,
                "Bearer integration-test-access-token",
            )
        finally:
            self.server.verify_warehouse_delete_lease = original_verify
            self.server.confirm_warehouse_telegram_deprovision = original_telegram_confirm

        self.assertFalse(deleted["replayed"])
        self.assertEqual(deleted["delete_prepare_contract"], 1)
        self.assertEqual(deleted["delete_operation_status"], "completed")
        self.assertTrue(deleted["delete_operation_completed"])
        self.assertEqual(deleted["delete_operation_base_version"], 2)
        self.assertEqual(deleted["delete_operation_warehouse_code"], "СПБ")
        self.assertTrue(deleted["telegram_deprovisioned"])
        self.assertEqual(deleted["telegram_installation_id"], "tg_integration_installation_001")
        self.assertEqual(deleted["cascade_deleted"], 3)
        self.assertEqual(deleted["cascade_by_environment"], {"live": 2, "demo": 1})
        self.assertEqual(deleted["history_payloads_redacted"], 5)
        self.assertTrue(replay["replayed"])
        self.assertTrue(replay["delete_operation_completed"])
        self.assertEqual(replay["cascade_deleted"], 3)
        self.assertEqual(replay["cascade_by_environment"], {"live": 2, "demo": 1})
        self.assertEqual(replay["history_payloads_redacted"], 5)
        self.assertEqual(len(lease_verifications), 2)
        self.assertTrue(all(call[0][1:] == (self.workspace, self.warehouse, "СПБ", "jfdl_" + "a" * 43) for call in lease_verifications))
        self.assertTrue(all(call[1] == {"require_prepared": True} for call in lease_verifications))
        self.assertEqual(len(telegram_confirmations), 1)
        self.assertEqual(
            telegram_confirmations[0][0],
            (
                "Bearer integration-test-access-token",
                self.workspace,
                self.warehouse,
                "СПБ",
                "jfdl_" + "a" * 43,
                command_id,
                2,
            ),
        )
        completed_prepare = self._prepare_delete(command_id, 2, token="jfdl_" + "c" * 43)
        self.assertEqual(completed_prepare["status"], "completed")
        self.assertTrue(completed_prepare["replayed"])
        self.assertTrue(completed_prepare["final_result"]["delete_operation_completed"])
        recovered_after_commit = self._prepare_delete(
            "client:test:warehouse:delete:recover-after-commit",
            99,
            token="jfdl_" + "d" * 43,
        )
        self.assertTrue(recovered_after_commit["recovered_existing"])
        self.assertEqual(recovered_after_commit["status"], "completed")
        self.assertEqual(recovered_after_commit["command_id"], command_id)
        self.assertEqual(recovered_after_commit["base_version"], 2)
        self.assertEqual(self.server.list_warehouses(self.workspace, "live", self.owner), [])
        self.assertEqual(self.server.list_warehouses(self.workspace, "demo", self.owner), [])
        deleted_registry = self.server.warehouse_registry_snapshot(self.workspace, "live", self.owner)
        self.assertTrue(deleted_registry["registry_initialized"])
        self.assertEqual(deleted_registry["warehouses"], [])
        for checked_environment in ("live", "demo"):
            with self.assertRaises(self.server.ApiError) as current_denied:
                self.server.load_current_entities(self.workspace, self.warehouse, checked_environment, self.owner)
            self.assertEqual(current_denied.exception.code, "warehouse_deleted")
            with self.assertRaises(self.server.ApiError) as history_denied:
                self.server.load_entity_changes(self.workspace, self.warehouse, checked_environment, 0, 100, self.owner)
            self.assertEqual(history_denied.exception.code, "warehouse_deleted")

        with self.server.db_connect() as conn, conn.cursor() as cur:
            counts = {}
            delete_events = []
            for checked_environment in ("demo", "live"):
                self.server.set_database_scope(cur, self.workspace, checked_environment, self.owner)
                cur.execute(
                    """
                    SELECT COUNT(*), COUNT(*) FILTER (WHERE is_deleted),
                           COUNT(*) FILTER (WHERE payload IS NULL AND deleted_at IS NOT NULL)
                    FROM business_records_v3
                    WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
                    """,
                    (self.workspace, self.warehouse, checked_environment),
                )
                counts[checked_environment] = tuple(int(value) for value in cur.fetchone())
                cur.execute(
                    """
                    SELECT environment, entity_type, entity_version, changed_by, device_id, command_id
                    FROM business_events_v3
                    WHERE workspace_id=%s AND warehouse_id=%s
                      AND environment=%s AND command_id=%s AND operation='delete'
                    ORDER BY entity_type
                    """,
                    (self.workspace, self.warehouse, checked_environment, command_id),
                )
                delete_events.extend(cur.fetchall())
                cur.execute(
                    """
                    SELECT COUNT(*) FILTER (WHERE payload IS NOT NULL)
                    FROM business_events_v3
                    WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
                    """,
                    (self.workspace, self.warehouse, checked_environment),
                )
                self.assertEqual(int(cur.fetchone()[0]), 0)
            self.assertEqual(counts, {"demo": (1, 1, 1), "live": (3, 3, 3)})
            self.assertEqual(
                [(row[0], row[1], int(row[2])) for row in delete_events],
                [("demo", "orders", 2), ("live", "orders", 2), ("live", "products", 2), ("live", "warehouse", 3)],
            )
            self.assertTrue(all(row[3:] == ("owner-a", "integration-test", command_id) for row in delete_events))
            self.server.set_database_scope(cur, self.workspace, "live", self.owner)
            cur.execute(
                """
                SELECT action, entity_count, details
                FROM business_audit_v3
                WHERE workspace_id=%s AND warehouse_id=%s AND environment='live' AND command_id=%s
                """,
                (self.workspace, self.warehouse, command_id),
            )
            action, entity_count, details = cur.fetchone()
            self.assertEqual(action, "warehouse_delete_cascade")
            self.assertEqual(int(entity_count), 4)
            self.assertEqual(int(details["cascade_deleted"]), 3)
            self.assertEqual(details["cascade_by_environment"], {"live": 2, "demo": 1})
            self.assertEqual(details["cascade_types"], ["orders", "products"])
            self.assertEqual(int(details["history_payloads_redacted"]), 5)
            cur.execute(
                """
                SELECT warehouse_code, command_id, base_version, status, attempts,
                       last_error, delivered_at IS NOT NULL
                FROM warehouse_delete_release_outbox_v3
                WHERE workspace_id=%s AND warehouse_id=%s AND command_id=%s
                """,
                (self.workspace, self.warehouse, command_id),
            )
            outbox_row = cur.fetchone()
            self.assertEqual(outbox_row[:4], ("СПБ", command_id, 2, "delivered"))
            self.assertGreaterEqual(int(outbox_row[4]), 1)
            self.assertIsNone(outbox_row[5])
            self.assertTrue(outbox_row[6])
            cur.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema='public' AND table_name='warehouse_delete_release_outbox_v3'
                ORDER BY ordinal_position
                """
            )
            outbox_columns = {str(row[0]) for row in cur.fetchall()}
            self.assertFalse(
                {"lease_token", "lease_token_sha256", "authorization", "bearer", "secret"} & outbox_columns
            )

        self.assertEqual(len(self.outbox_deliveries), 1)
        self.assertEqual(self.outbox_deliveries[0]["workspace_id"], self.workspace)
        self.assertNotIn("lease_token", self.outbox_deliveries[0])
        self.assertNotIn("authorization", self.outbox_deliveries[0])

        for environment in ("live", "demo"):
            with self.assertRaises(self.server.ApiError) as stale:
                self._save(
                    f"client:test:order:after-delete:{environment}",
                    [{
                        "type": "orders",
                        "id": f"order-after-delete-{environment}",
                        "base_version": 0,
                        "payload": {"id": f"order-after-delete-{environment}", "warehouseId": self.warehouse},
                    }],
                    environment=environment,
                )
            self.assertEqual(stale.exception.code, "warehouse_deleted")

        with self.assertRaises(self.server.ApiError) as duplicate_delete:
            self._save(
                "client:test:warehouse:delete-cascade-cleanup",
                [{"type": "warehouse", "id": self.warehouse, "base_version": 3, "deleted": True}],
            )
        self.assertEqual(duplicate_delete.exception.code, "warehouse_delete_completed")

    def test_release_outbox_survives_network_failure_and_retries_without_client_token(self):
        self._save(
            "client:test:warehouse:archive-before-release-retry",
            [{
                "type": "warehouse",
                "id": self.warehouse,
                "base_version": 1,
                "payload": {
                    "id": self.warehouse,
                    "code": "СПБ",
                    "name": "Склад СПБ",
                    "environment": "live",
                    "status": "archived",
                },
            }],
        )
        command_id = "client:test:warehouse:delete:release-retry"
        original_delivery = self.server._deliver_warehouse_delete_release
        self.server._deliver_warehouse_delete_release = lambda _item: (_ for _ in ()).throw(
            self.server.ApiError(503, "license_temporarily_unavailable", "offline")
        )
        try:
            deleted = self._save(
                command_id,
                [{"type": "warehouse", "id": self.warehouse, "base_version": 2, "deleted": True}],
            )
        finally:
            self.server._deliver_warehouse_delete_release = original_delivery
        self.assertTrue(deleted["delete_operation_completed"])

        with self.server.db_connect() as conn, conn.cursor() as cur:
            self.server.set_database_scope(cur, self.workspace, "live", self.owner)
            cur.execute(
                """
                SELECT status, attempts, last_error, delivered_at
                FROM warehouse_delete_release_outbox_v3
                WHERE workspace_id=%s AND warehouse_id=%s AND command_id=%s
                """,
                (self.workspace, self.warehouse, command_id),
            )
            pending = cur.fetchone()
            self.assertEqual(pending[:3], ("retry", 1, "license_temporarily_unavailable"))
            self.assertIsNone(pending[3])
            self.server._set_warehouse_delete_release_worker_scope(cur)
            cur.execute(
                """
                UPDATE warehouse_delete_release_outbox_v3
                SET next_attempt_at=now()
                WHERE workspace_id=%s AND warehouse_id=%s AND command_id=%s
                """,
                (self.workspace, self.warehouse, command_id),
            )

        processed = self.server.process_warehouse_delete_release_outbox(
            1,
            (self.workspace, self.warehouse, command_id),
        )
        self.assertEqual(processed, {"claimed": 1, "delivered": 1, "retried": 0})
        self.assertEqual(len(self.outbox_deliveries), 1)
        self.assertNotIn("lease_token", self.outbox_deliveries[0])
        self.assertNotIn("authorization", self.outbox_deliveries[0])
        with self.server.db_connect() as conn, conn.cursor() as cur:
            self.server.set_database_scope(cur, self.workspace, "live", self.owner)
            cur.execute(
                """
                SELECT status, attempts, last_error, delivered_at IS NOT NULL
                FROM warehouse_delete_release_outbox_v3
                WHERE workspace_id=%s AND warehouse_id=%s AND command_id=%s
                """,
                (self.workspace, self.warehouse, command_id),
            )
            self.assertEqual(cur.fetchone(), ("delivered", 2, None, True))

    def test_active_warehouse_delete_is_rejected(self):
        with self.assertRaises(self.server.ApiError) as rejected:
            self._save(
                "client:test:warehouse:delete-active",
                [{"type": "warehouse", "id": self.warehouse, "base_version": 1, "deleted": True}],
            )
        self.assertEqual(rejected.exception.code, "warehouse_delete_requires_archived")

    def test_warehouse_delete_requires_valid_lease_transport(self):
        self._save(
            "client:test:warehouse:archive-before-missing-lease",
            [{
                "type": "warehouse",
                "id": self.warehouse,
                "base_version": 1,
                "payload": {
                    "id": self.warehouse,
                    "code": "СПБ",
                    "name": "Склад СПБ",
                    "environment": "live",
                    "status": "archived",
                },
            }],
        )
        with self.assertRaises(self.server.ApiError) as rejected:
            self.server.save_entity_batch(
                self.workspace,
                self.warehouse,
                "live",
                {
                    "command_id": "client:test:warehouse:delete-without-lease",
                    "changes": [{"type": "warehouse", "id": self.warehouse, "base_version": 2, "deleted": True}],
                },
                self.owner,
                "Bearer integration-test-access-token",
            )
        self.assertEqual(rejected.exception.code, "WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED")

    def test_expired_lease_before_commit_rolls_back_entire_delete(self):
        self._save(
            "client:test:order:before-expiring-lease",
            [{
                "type": "orders",
                "id": "order-before-expiring-lease",
                "base_version": 0,
                "payload": {"id": "order-before-expiring-lease", "warehouseId": self.warehouse},
            }],
        )
        self._save(
            "client:test:warehouse:archive-before-expiring-lease",
            [{
                "type": "warehouse",
                "id": self.warehouse,
                "base_version": 1,
                "payload": {
                    "id": self.warehouse,
                    "code": "СПБ",
                    "name": "Склад СПБ",
                    "environment": "live",
                    "status": "archived",
                },
            }],
        )
        calls = []
        original_verify = self.server.verify_warehouse_delete_lease

        def verify_then_expire(*args, **kwargs):
            calls.append(args)
            if len(calls) == 2:
                raise self.server.ApiError(
                    409,
                    "warehouse_delete_lease_invalid_or_expired",
                    "Защитное разрешение истекло",
                )
            return {"ok": True, "active": True, "remaining_seconds": 120}

        self.server.verify_warehouse_delete_lease = verify_then_expire
        try:
            with self.assertRaises(self.server.ApiError) as rejected:
                self._save(
                    "client:test:warehouse:delete-expired-before-commit",
                    [{"type": "warehouse", "id": self.warehouse, "base_version": 2, "deleted": True}],
                )
        finally:
            self.server.verify_warehouse_delete_lease = original_verify
        self.assertEqual(rejected.exception.code, "warehouse_delete_lease_invalid_or_expired")
        self.assertEqual(len(calls), 2)
        registry = self.server.warehouse_registry_snapshot(self.workspace, "live", self.owner)
        self.assertEqual(registry["warehouses"][0]["status"], "archived")
        current = self.server.load_current_entities(self.workspace, self.warehouse, "live", self.owner)
        self.assertIn("order-before-expiring-lease", {item["id"] for item in current["entities"]})

    def test_telegram_deprovision_failure_keeps_prepared_delete_and_all_data(self):
        self._save(
            "client:test:order:before-telegram-failure",
            [{
                "type": "orders",
                "id": "order-before-telegram-failure",
                "base_version": 0,
                "payload": {"id": "order-before-telegram-failure", "warehouseId": self.warehouse},
            }],
        )
        self._save(
            "client:test:warehouse:archive-before-telegram-failure",
            [{
                "type": "warehouse",
                "id": self.warehouse,
                "base_version": 1,
                "payload": {
                    "id": self.warehouse,
                    "code": "СПБ",
                    "name": "Склад СПБ",
                    "environment": "live",
                    "status": "archived",
                },
            }],
        )
        command_id = "client:test:warehouse:delete-telegram-failure"
        original_confirm = self.server.confirm_warehouse_telegram_deprovision
        self.server.confirm_warehouse_telegram_deprovision = lambda *_args, **_kwargs: (_ for _ in ()).throw(
            self.server.ApiError(503, "telegram_broker_unavailable", "Telegram broker unavailable")
        )
        try:
            with self.assertRaises(self.server.ApiError) as rejected:
                self._save(
                    command_id,
                    [{"type": "warehouse", "id": self.warehouse, "base_version": 2, "deleted": True}],
                )
        finally:
            self.server.confirm_warehouse_telegram_deprovision = original_confirm

        self.assertEqual(rejected.exception.code, "telegram_broker_unavailable")
        registry = self.server.warehouse_registry_snapshot(self.workspace, "live", self.owner)
        self.assertEqual(registry["warehouses"][0]["status"], "archived")
        current = self.server.load_current_entities(self.workspace, self.warehouse, "live", self.owner)
        self.assertIn("order-before-telegram-failure", {item["id"] for item in current["entities"]})
        with self.psycopg2.connect(self.admin_dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT status FROM warehouse_delete_operations_v3 WHERE workspace_id=%s AND warehouse_id=%s",
                (self.workspace, self.warehouse),
            )
            self.assertEqual(cur.fetchone()[0], "prepared")
            cur.execute(
                "SELECT COUNT(*) FROM business_commands_v3 WHERE workspace_id=%s AND warehouse_id=%s AND command_id=%s",
                (self.workspace, self.warehouse, command_id),
            )
            self.assertEqual(cur.fetchone()[0], 0)

    def test_archived_warehouse_rejects_live_and_demo_business_writes(self):
        archived = self._save(
            "client:test:warehouse:archive:block-writes",
            [{
                "type": "warehouse",
                "id": self.warehouse,
                "base_version": 1,
                "payload": {
                    "id": self.warehouse,
                    "code": "СПБ",
                    "name": "Склад СПб",
                    "environment": "live",
                    "status": "archived",
                },
            }],
        )
        self.assertEqual(archived["entities"][0]["version"], 2)
        for environment in ("live", "demo"):
            with self.subTest(environment=environment), self.assertRaises(self.server.ApiError) as rejected:
                self._save(
                    f"client:test:order:archived:{environment}",
                    [{
                        "type": "orders",
                        "id": f"order-archived-{environment}",
                        "base_version": 0,
                        "payload": {
                            "id": f"order-archived-{environment}",
                            "warehouseId": self.warehouse,
                            "status": "new",
                        },
                    }],
                    environment=environment,
                )
            self.assertEqual(rejected.exception.code, "warehouse_archived")

    def test_archive_is_serialized_before_stale_live_and_demo_writes(self):
        version = 1
        for environment in ("demo", "live"):
            archive_reached_locked_section = threading.Event()
            release_archive = threading.Event()
            writer_started = threading.Event()
            writer_write_connection_seen = threading.Event()
            writer_marker = threading.local()
            writer_backend_pids = []
            writer_backend_pids_lock = threading.Lock()
            original_validator = self.server.validate_entity_intent_current
            original_db_connect = self.server.db_connect

            @contextmanager
            def tracked_db_connect():
                with original_db_connect() as conn:
                    if getattr(writer_marker, "active", False):
                        with writer_backend_pids_lock:
                            writer_backend_pids.append(int(conn.get_backend_pid()))
                            if len(writer_backend_pids) >= 2:
                                writer_write_connection_seen.set()
                    yield conn

            def gated_validator(*args, **kwargs):
                changes = args[5] if len(args) > 5 else kwargs.get("changes")
                if any(item.get("type") == "warehouse" for item in (changes or [])):
                    archive_reached_locked_section.set()
                    if not release_archive.wait(timeout=5):
                        raise RuntimeError("archive race test timed out")
                return original_validator(*args, **kwargs)

            def stale_write():
                writer_started.set()
                writer_marker.active = True
                try:
                    return self._save(
                        f"client:test:order:archive-race:{environment}",
                        [{
                            "type": "orders",
                            "id": f"order-archive-race-{environment}",
                            "base_version": 0,
                            "payload": {
                                "id": f"order-archive-race-{environment}",
                                "warehouseId": self.warehouse,
                                "status": "new",
                            },
                        }],
                        environment=environment,
                    )
                except self.server.ApiError as error:
                    return error.code
                finally:
                    writer_marker.active = False

            self.server.validate_entity_intent_current = gated_validator
            self.server.db_connect = tracked_db_connect
            try:
                with ThreadPoolExecutor(max_workers=2) as pool:
                    archive_future = pool.submit(
                        self._save,
                        f"client:test:warehouse:archive-race:{environment}",
                        [{
                            "type": "warehouse",
                            "id": self.warehouse,
                            "base_version": version,
                            "payload": {
                                "id": self.warehouse,
                                "code": "СПБ",
                                "name": "Склад СПб",
                                "environment": "live",
                                "status": "archived",
                            },
                        }],
                    )
                    self.assertTrue(archive_reached_locked_section.wait(timeout=5))
                    writer_future = pool.submit(stale_write)
                    self.assertTrue(writer_started.wait(timeout=5))
                    self.assertTrue(writer_write_connection_seen.wait(timeout=5))
                    waiting_on_advisory_lock = False
                    deadline = time.monotonic() + 5
                    with self.psycopg2.connect(self.admin_dsn) as lock_conn, lock_conn.cursor() as lock_cur:
                        while time.monotonic() < deadline:
                            with writer_backend_pids_lock:
                                checked_pids = sorted(set(writer_backend_pids))
                            lock_cur.execute(
                                """
                                SELECT EXISTS (
                                  SELECT 1 FROM pg_locks
                                  WHERE pid=ANY(%s) AND locktype='advisory' AND granted=false
                                )
                                """,
                                (checked_pids,),
                            )
                            waiting_on_advisory_lock = bool(lock_cur.fetchone()[0])
                            if waiting_on_advisory_lock:
                                break
                            time.sleep(0.02)
                    self.assertTrue(
                        waiting_on_advisory_lock,
                        f"{environment} write did not wait on the registry advisory lock",
                    )
                    release_archive.set()
                    archived = archive_future.result(timeout=5)
                    self.assertEqual(writer_future.result(timeout=5), "warehouse_archived")
            finally:
                release_archive.set()
                self.server.validate_entity_intent_current = original_validator
                self.server.db_connect = original_db_connect

            version = int(archived["entities"][0]["version"])
            if environment == "demo":
                restored = self._save(
                    "client:test:warehouse:unarchive-between-races",
                    [{
                        "type": "warehouse",
                        "id": self.warehouse,
                        "base_version": version,
                        "payload": {
                            "id": self.warehouse,
                            "code": "СПБ",
                            "name": "Склад СПб",
                            "environment": "live",
                            "status": "active",
                        },
                    }],
                )
                version = int(restored["entities"][0]["version"])

    def test_warehouse_registry_is_live_only(self):
        registry = self.server.warehouse_registry_snapshot(self.workspace, "demo", self.owner)
        self.assertTrue(registry["registry_initialized"])
        self.assertEqual([item["id"] for item in registry["warehouses"]], [self.warehouse])
        with self.assertRaises(self.server.ApiError) as rejected:
            self._save(
                "client:test:warehouse:update-demo",
                [{
                    "type": "warehouse",
                    "id": self.warehouse,
                    "base_version": 1,
                    "payload": {"id": self.warehouse, "code": "ДМО", "environment": "demo"},
                }],
                environment="demo",
            )
        self.assertEqual(rejected.exception.code, "warehouse_registry_live_only")

    def test_never_initialized_registry_is_distinguished_from_deleted_registry(self):
        with self.psycopg2.connect(self.admin_dsn) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM business_records_v3 WHERE workspace_id=%s", (self.workspace,))
        registry = self.server.warehouse_registry_snapshot(self.workspace, "live", self.owner)
        self.assertFalse(registry["registry_initialized"])
        self.assertEqual(registry["warehouses"], [])

    def test_demo_reads_hide_legacy_warehouse_and_advance_cursor(self):
        payload = {"id": self.warehouse, "code": "OLD-DEMO", "environment": "demo"}
        digest = self.server.entity_payload_digest(payload)
        with self.server.db_connect() as conn, conn.cursor() as cur:
            self.server.set_database_scope(cur, self.workspace, "demo", self.owner)
            cur.execute(
                """
                INSERT INTO business_events_v3
                  (workspace_id, warehouse_id, environment, entity_type, entity_id,
                   entity_version, operation, payload_sha256, payload,
                   changed_by, device_id, command_id)
                VALUES (%s,%s,'demo','warehouse',%s,1,'upsert',%s,%s::jsonb,%s,%s,%s)
                RETURNING event_id
                """,
                (
                    self.workspace,
                    self.warehouse,
                    self.warehouse,
                    digest,
                    json.dumps(payload),
                    "legacy-test",
                    "legacy-device",
                    "legacy:demo:warehouse",
                ),
            )
            event_id = int(cur.fetchone()[0])
            cur.execute(
                """
                INSERT INTO business_records_v3
                  (workspace_id, warehouse_id, environment, entity_type, entity_id,
                   version, payload_sha256, payload, is_deleted, last_event_id,
                   created_by, updated_by, device_id)
                VALUES (%s,%s,'demo','warehouse',%s,1,%s,%s::jsonb,false,%s,%s,%s,%s)
                """,
                (
                    self.workspace,
                    self.warehouse,
                    self.warehouse,
                    digest,
                    json.dumps(payload),
                    event_id,
                    "legacy-test",
                    "legacy-test",
                    "legacy-device",
                ),
            )

        current = self.server.load_current_entities(self.workspace, self.warehouse, "demo", self.owner)
        changes = self.server.load_entity_changes(self.workspace, self.warehouse, "demo", 0, 100, self.owner)
        self.assertEqual(current["cursor"], event_id)
        self.assertEqual(current["entities"], [])
        self.assertNotIn("warehouse", current["readable_types"])
        self.assertEqual(changes["cursor"], event_id)
        self.assertEqual(changes["events"], [])
        self.assertNotIn("warehouse", changes["readable_types"])

    def test_warehouse_delete_rejects_mixed_client_batch(self):
        with self.assertRaises(self.server.ApiError) as rejected:
            self._save(
                "client:test:warehouse:delete-mixed",
                [
                    {"type": "warehouse", "id": self.warehouse, "base_version": 1, "deleted": True},
                    {"type": "orders", "id": "order-mixed", "base_version": 0, "deleted": True},
                ],
            )
        self.assertEqual(rejected.exception.code, "warehouse_delete_must_be_single_change")


if __name__ == "__main__":
    unittest.main(verbosity=2)
