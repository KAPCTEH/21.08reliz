from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "source" / "company-telegram-broker" / "schema.sql"
DEPROVISION_MIGRATION = (
    ROOT
    / "source"
    / "company-telegram-broker"
    / "migrations"
    / "0003-telegram-deprovision.sql"
)


class CompanyTelegramBrokerSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript(SCHEMA.read_text(encoding="utf-8"))

    def test_encrypted_service_can_be_scoped_per_warehouse(self):
        self.db.execute(
            """INSERT INTO company_telegram_services
               (company_id,warehouse_id,telegram_worker_url,telegram_client_key_ciphertext,
                telegram_bot_username,telegram_installation_id,
                telegram_deployment_version,updated_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            (
                "cmp_one",
                "wh_main",
                "https://telegram.example.workers.dev",
                "v1.iv.ciphertext",
                "justfun_bot",
                "install_one",
                "7.8.3",
                "2026-07-30T00:00:00Z",
            ),
        )
        self.db.execute(
            """INSERT INTO company_telegram_services
               (company_id,warehouse_id,telegram_worker_url,telegram_client_key_ciphertext,
                telegram_bot_username,telegram_installation_id,
                telegram_deployment_version,updated_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            (
                "cmp_one",
                "wh_other",
                "https://other.example.workers.dev",
                "v1.other.ciphertext",
                "other_bot",
                "install_two",
                "7.8.3",
                "2026-07-30T00:01:00Z",
            ),
        )
        self.assertEqual(
            self.db.execute(
                "SELECT COUNT(*) FROM company_telegram_services WHERE company_id='cmp_one'"
            ).fetchone()[0],
            2,
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO company_telegram_services
                   (company_id,warehouse_id,telegram_worker_url,telegram_client_key_ciphertext,
                    telegram_bot_username,telegram_installation_id,
                    telegram_deployment_version,updated_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                (
                    "cmp_one", "wh_main", "https://duplicate.example.workers.dev",
                    "v1.duplicate.ciphertext", "duplicate_bot", "install_three", "7.8.3",
                    "2026-07-30T00:02:00Z",
                ),
            )

    def test_schema_has_no_plaintext_client_key_column(self):
        columns = {
            row[1]
            for row in self.db.execute("PRAGMA table_info(company_telegram_services)")
        }
        self.assertIn("telegram_client_key_ciphertext", columns)
        self.assertNotIn("client_api_key", columns)
        self.assertNotIn("telegram_client_api_key", columns)

    def test_deprovision_schema_does_not_persist_request_secrets(self):
        columns = {
            row[1]
            for row in self.db.execute(
                "PRAGMA table_info(company_telegram_deprovision_operations)"
            )
        }
        self.assertNotIn("warehouse_delete_lease_token", columns)
        self.assertNotIn("lease_token", columns)
        self.assertNotIn("vps_timestamp", columns)
        self.assertNotIn("vps_nonce", columns)
        self.assertNotIn("vps_signature", columns)

    def test_deprovision_completion_atomically_deletes_encrypted_service(self):
        self.db.execute(
            """INSERT INTO company_telegram_services
               (company_id,warehouse_id,telegram_worker_url,telegram_client_key_ciphertext,
                telegram_bot_username,telegram_installation_id,
                telegram_deployment_version,updated_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            (
                "cmp_one",
                "wh_main",
                "https://telegram.example.workers.dev",
                "v1.iv.ciphertext",
                "justfun_bot",
                "install_one",
                "7.8.3",
                "2026-08-23T00:00:00Z",
            ),
        )
        operation = self.db.execute(
            """INSERT INTO company_telegram_deprovision_operations(
                 company_id,warehouse_id,warehouse_code,delete_command_id,delete_base_version,
                 actor_user_id,lease_id,operation_id,installation_id,status,attempt_count,
                 last_error_code,created_at,updated_at,completed_at
               )
               SELECT service.company_id,service.warehouse_id,?,?,?,?,?,?,service.telegram_installation_id,
                      'running',1,'',?,?,NULL
               FROM company_telegram_services AS service
               WHERE service.company_id=? AND service.warehouse_id=?
               ON CONFLICT(company_id,warehouse_id) DO UPDATE SET
                 status='running',
                 attempt_count=company_telegram_deprovision_operations.attempt_count+1,
                 last_error_code='',updated_at=excluded.updated_at,completed_at=NULL
               WHERE company_telegram_deprovision_operations.status!='deprovisioned'
               RETURNING operation_id,installation_id,status""",
            (
                "СПБ",
                "client:test:warehouse:delete:schema",
                3,
                "usr_owner",
                "wdl_schema_one",
                "tgdep_one",
                "2026-08-23T00:01:00Z",
                "2026-08-23T00:01:00Z",
                "cmp_one",
                "wh_main",
            ),
        ).fetchone()
        self.assertEqual(operation, ("tgdep_one", "install_one", "running"))
        with self.assertRaisesRegex(sqlite3.IntegrityError, "TELEGRAM_SERVICE_DEPROVISIONED"):
            self.db.execute(
                """UPDATE company_telegram_services SET updated_at=?
                   WHERE company_id=? AND warehouse_id=?""",
                ("2026-08-23T00:02:00Z", "cmp_one", "wh_main"),
            )
        self.db.execute(
            """UPDATE company_telegram_deprovision_operations
               SET status='deprovisioned',updated_at=?,completed_at=?
               WHERE company_id=? AND warehouse_id=?""",
            (
                "2026-08-23T00:03:00Z",
                "2026-08-23T00:03:00Z",
                "cmp_one",
                "wh_main",
            ),
        )
        self.assertEqual(
            self.db.execute(
                "SELECT COUNT(*) FROM company_telegram_services WHERE company_id=? AND warehouse_id=?",
                ("cmp_one", "wh_main"),
            ).fetchone()[0],
            0,
        )
        self.assertEqual(
            self.db.execute(
                """SELECT status FROM company_telegram_deprovision_operations
                   WHERE company_id=? AND warehouse_id=?""",
                ("cmp_one", "wh_main"),
            ).fetchone()[0],
            "deprovisioned",
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "TELEGRAM_SERVICE_DEPROVISIONED"):
            self.db.execute(
                """INSERT INTO company_telegram_services
                   (company_id,warehouse_id,telegram_worker_url,telegram_client_key_ciphertext,
                    telegram_bot_username,telegram_installation_id,
                    telegram_deployment_version,updated_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                (
                    "cmp_one", "wh_main", "https://replacement.example.workers.dev",
                    "v1.new.ciphertext", "replacement_bot", "install_two", "7.8.3",
                    "2026-08-23T00:04:00Z",
                ),
            )

    def test_absent_tombstone_blocks_later_configuration(self):
        self.db.execute(
            """INSERT INTO company_telegram_deprovision_operations(
                 company_id,warehouse_id,warehouse_code,delete_command_id,delete_base_version,
                 actor_user_id,lease_id,operation_id,installation_id,status,attempt_count,
                 last_error_code,created_at,updated_at,completed_at
               ) VALUES(?,?,?,?,?,?,?,?,?,'deprovisioned',1,'',?,?,?)""",
            (
                "cmp_one", "wh_absent", "СПБ", "client:test:warehouse:delete:absent", 1,
                "usr_owner", "wdl_absent_one", "tgdep_absent_one", "",
                "2026-08-23T01:00:00Z", "2026-08-23T01:00:00Z", "2026-08-23T01:00:00Z",
            ),
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "TELEGRAM_SERVICE_DEPROVISIONED"):
            self.db.execute(
                """INSERT INTO company_telegram_services
                   (company_id,warehouse_id,telegram_worker_url,telegram_client_key_ciphertext,
                    telegram_bot_username,telegram_installation_id,telegram_deployment_version,updated_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                (
                    "cmp_one", "wh_absent", "https://late.example.workers.dev", "v1.late.ciphertext",
                    "late_bot", "install_late", "7.8.3", "2026-08-23T01:01:00Z",
                ),
            )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "TELEGRAM_DEPROVISION_OPERATION_IMMUTABLE"):
            self.db.execute(
                """UPDATE company_telegram_deprovision_operations SET status='failed'
                   WHERE company_id='cmp_one' AND warehouse_id='wh_absent'"""
            )

    def test_existing_service_blocks_false_absent_tombstone(self):
        self.db.execute(
            """INSERT INTO company_telegram_services
               (company_id,warehouse_id,telegram_worker_url,telegram_client_key_ciphertext,
                telegram_bot_username,telegram_installation_id,telegram_deployment_version,updated_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            (
                "cmp_one", "wh_present", "https://present.example.workers.dev", "v1.present.ciphertext",
                "present_bot", "install_present", "7.8.3", "2026-08-23T02:00:00Z",
            ),
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "TELEGRAM_DEPROVISION_TERMINAL_INSERT_INVALID"):
            self.db.execute(
                """INSERT INTO company_telegram_deprovision_operations(
                     company_id,warehouse_id,warehouse_code,delete_command_id,delete_base_version,
                     actor_user_id,lease_id,operation_id,installation_id,status,attempt_count,
                     last_error_code,created_at,updated_at,completed_at
                   ) VALUES(?,?,?,?,?,?,?,?,?,'deprovisioned',1,'',?,?,?)""",
                (
                    "cmp_one", "wh_present", "СПБ", "client:test:warehouse:delete:present", 2,
                    "usr_owner", "wdl_present_one", "tgdep_present_one", "",
                    "2026-08-23T02:01:00Z", "2026-08-23T02:01:00Z", "2026-08-23T02:01:00Z",
                ),
            )
        self.assertEqual(
            self.db.execute(
                "SELECT COUNT(*) FROM company_telegram_services WHERE company_id='cmp_one' AND warehouse_id='wh_present'"
            ).fetchone()[0],
            1,
        )

    def test_existing_database_accepts_deprovision_migration(self):
        db = sqlite3.connect(":memory:")
        try:
            db.executescript(
                """CREATE TABLE company_telegram_services (
                     company_id TEXT NOT NULL, warehouse_id TEXT NOT NULL,
                     telegram_worker_url TEXT NOT NULL,
                     telegram_client_key_ciphertext TEXT NOT NULL,
                     telegram_bot_username TEXT NOT NULL DEFAULT '',
                     telegram_installation_id TEXT NOT NULL DEFAULT '',
                     telegram_deployment_version TEXT NOT NULL DEFAULT '',
                     updated_at TEXT NOT NULL,
                     PRIMARY KEY(company_id, warehouse_id)
                   );"""
            )
            db.executescript(DEPROVISION_MIGRATION.read_text(encoding="utf-8"))
            columns = {
                row[1]
                for row in db.execute(
                    "PRAGMA table_info(company_telegram_deprovision_operations)"
                )
            }
            self.assertIn("installation_id", columns)
            self.assertIn("last_error_code", columns)
            self.assertIn("warehouse_code", columns)
            self.assertIn("delete_command_id", columns)
            self.assertIn("delete_base_version", columns)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
