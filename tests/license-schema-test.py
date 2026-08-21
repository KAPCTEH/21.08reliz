from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "source" / "license-server" / "schema.sql"


class LicenseSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(SCHEMA.read_text(encoding="utf-8"))
        self.db.execute(
            "INSERT INTO companies(id,code,name,status,created_at) VALUES(?,?,?,?,?)",
            ("cmp", "JFTEST01", "Test", "active", "2026-07-27T00:00:00Z"),
        )
        self.db.execute(
            "INSERT INTO licenses VALUES(?,?,?,?,?,?,?)",
            ("lic", "hash", "cmp", "active", 1, 3, "2026-07-27T00:00:00Z"),
        )

    def user(self, user_id: str, login: str, role: str = "owner"):
        self.db.execute(
            """INSERT INTO users
               (id,company_id,login,full_name,role,permissions_json,password_salt,password_hash,password_iterations,status,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                user_id,
                "cmp",
                login,
                login,
                role,
                "[]",
                "salt",
                "hash",
                1,
                "active",
                "2026-07-27T00:00:00Z",
                "2026-07-27T00:00:00Z",
            ),
        )

    def test_license_can_be_claimed_only_once(self):
        self.user("owner1", "owner1")
        self.user("owner2", "owner2")
        self.db.execute("INSERT INTO license_claims VALUES(?,?,?)", ("lic", "owner1", "2026-07-27T00:00:00Z"))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO license_claims VALUES(?,?,?)", ("lic", "owner2", "2026-07-27T00:00:01Z"))

    def test_employee_limit_is_enforced_in_database(self):
        self.user("owner", "owner")
        self.user("employee1", "employee1", "Старший логист")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "EMPLOYEE_LIMIT_REACHED"):
            self.user("employee2", "employee2", "Стажёр склада")

    def test_custom_role_name_is_persisted_without_fixed_role_catalog(self):
        self.user("owner", "owner")
        self.user("employee", "employee", "Старший кладовщик СПБ")
        role = self.db.execute("SELECT role FROM users WHERE id='employee'").fetchone()[0]
        self.assertEqual(role, "Старший кладовщик СПБ")

    def test_owner_role_is_forbidden_in_employee_invitation(self):
        self.user("owner", "owner")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO invitations
                   (id,company_id,code_hash,login,full_name,role,permissions_json,created_by,created_at,expires_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                ("inv", "cmp", "code", "employee", "Employee", "owner", "[]", "owner", "now", "later"),
            )

    def test_schema_baseline_marks_migrations_as_applied(self):
        versions = {row[0] for row in self.db.execute("SELECT version FROM schema_migrations")}
        self.assertEqual(
            versions,
            {"002-company-data-service", "003-company-telegram-service", "004-custom-roles", "005-granular-permissions-audit", "006-exact-permissions"},
        )

    def test_device_limit_is_enforced_in_database(self):
        self.user("owner", "owner")
        for index in range(1, 4):
            self.db.execute(
                "INSERT INTO devices VALUES(?,?,?,?,?,?,?,?)",
                (
                    f"dev{index}",
                    "cmp",
                    "owner",
                    f"hash{index}",
                    f"PC{index}",
                    "active",
                    "2026-07-27T00:00:00Z",
                    "2026-07-27T00:00:00Z",
                ),
            )
        count = self.db.execute("SELECT COUNT(*) FROM devices WHERE user_id='owner'").fetchone()[0]
        self.assertEqual(count, 3)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "DEVICE_LIMIT_REACHED"):
            self.db.execute(
                "INSERT INTO devices VALUES(?,?,?,?,?,?,?,?)",
                ("dev4", "cmp", "owner", "hash4", "PC4", "active", "2026-07-27T00:00:00Z", "2026-07-27T00:00:00Z"),
            )

    def test_refresh_rotation_allows_only_one_child_session(self):
        self.user("owner", "owner")
        self.db.execute(
            "INSERT INTO devices VALUES(?,?,?,?,?,?,?,?)",
            ("dev", "cmp", "owner", "device-hash", "PC", "active", "2026-07-27T00:00:00Z", "2026-07-27T00:00:00Z"),
        )
        self.db.execute(
            """INSERT INTO sessions
               (id,company_id,user_id,device_id,refresh_hash,parent_session_id,status,created_at,expires_at)
               VALUES(?,?,?,?,?,NULL,'active',?,?)""",
            ("parent", "cmp", "owner", "dev", "refresh-parent", "2026-07-27T00:00:00Z", "2026-08-27T00:00:00Z"),
        )
        self.db.commit()

        def rotate(child_id: str, refresh_hash: str):
            with self.db:
                self.db.execute("UPDATE sessions SET status='revoked' WHERE id=? AND status='active'", ("parent",))
                self.db.execute(
                    """INSERT INTO sessions
                       (id,company_id,user_id,device_id,refresh_hash,parent_session_id,status,created_at,expires_at)
                       VALUES(?,?,?,?,?,?,'active',?,?)""",
                    (
                        child_id,
                        "cmp",
                        "owner",
                        "dev",
                        refresh_hash,
                        "parent",
                        "2026-07-27T00:01:00Z",
                        "2026-08-27T00:01:00Z",
                    ),
                )

        rotate("child-1", "refresh-child-1")
        with self.assertRaises(sqlite3.IntegrityError):
            rotate("child-2", "refresh-child-2")
        children = self.db.execute(
            "SELECT id,status FROM sessions WHERE parent_session_id='parent'"
        ).fetchall()
        self.assertEqual(children, [("child-1", "active")])
        self.assertEqual(
            self.db.execute("SELECT status FROM sessions WHERE id='parent'").fetchone()[0],
            "revoked",
        )

    def test_company_data_service_is_shared_with_all_accounts(self):
        self.user("owner", "owner")
        self.db.execute(
            """UPDATE companies
               SET data_api_address=?,data_api_port=?,data_api_tls_sha256=?,data_api_updated_at=?
               WHERE id=?""",
            ("203.0.113.10", 443, "A" * 64, "2026-07-27T00:01:00Z", "cmp"),
        )
        self.user("employee", "employee", "manager")
        owner = self.db.execute(
            """SELECT c.data_api_address,c.data_api_port,c.data_api_tls_sha256
               FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=?""",
            ("owner",),
        ).fetchone()
        employee = self.db.execute(
            """SELECT c.data_api_address,c.data_api_port,c.data_api_tls_sha256
               FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=?""",
            ("employee",),
        ).fetchone()
        self.assertEqual(owner, employee)

    def test_company_telegram_service_is_shared_without_exposing_plain_key(self):
        self.user("owner", "owner")
        self.db.execute(
            """UPDATE companies
               SET telegram_worker_url=?,telegram_client_key_ciphertext=?,
                   telegram_bot_username=?,telegram_installation_id=?,
                   telegram_deployment_version=?,telegram_updated_at=?
               WHERE id=?""",
            (
                "https://justfun-telegram.example.workers.dev",
                "v1.iv.ciphertext",
                "justfun_test_bot",
                "cmp",
                "7.8.3",
                "2026-07-30T00:01:00Z",
                "cmp",
            ),
        )
        self.user("employee", "employee", "warehouse")
        rows = self.db.execute(
            """SELECT u.id,c.telegram_worker_url,c.telegram_client_key_ciphertext,c.telegram_bot_username
               FROM users u JOIN companies c ON c.id=u.company_id
               WHERE u.id IN ('owner','employee') ORDER BY u.id"""
        ).fetchall()
        self.assertEqual(rows[0][1:], rows[1][1:])
        self.assertNotIn("client_api_key", {row[1] for row in self.db.execute("PRAGMA table_info(companies)")})


if __name__ == "__main__":
    unittest.main(verbosity=2)
