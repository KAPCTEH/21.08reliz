from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "source" / "company-telegram-broker" / "schema.sql"


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
