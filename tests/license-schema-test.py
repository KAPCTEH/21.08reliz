from __future__ import annotations

import json
import sqlite3
import time
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "source" / "license-server" / "schema.sql"
WAREHOUSE_LEASE_MIGRATION = (
    ROOT / "source" / "license-server" / "migrations" / "007-warehouse-delete-leases.sql"
)
VPS_ATTESTATION_MIGRATION = (
    ROOT / "source" / "license-server" / "migrations" / "008-vps-attestations.sql"
)
INVITATION_LIFECYCLE_MIGRATION = (
    ROOT / "source" / "license-server" / "migrations" / "009-invitation-lifecycle.sql"
)


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

    def user(self, user_id: str, login: str, role: str = "owner", permissions=None):
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
                json.dumps(permissions or [], ensure_ascii=False),
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
            {
                "002-company-data-service",
                "003-company-telegram-service",
                "004-custom-roles",
                "005-granular-permissions-audit",
                "006-exact-permissions",
                "007-warehouse-delete-leases",
                "008-vps-attestations",
                "009-invitation-lifecycle",
            },
        )

    def test_revoked_or_expired_invitation_cannot_be_claimed(self):
        self.user("owner", "owner")
        self.db.execute(
            """INSERT INTO invitations
               (id,company_id,code_hash,login,full_name,role,permissions_json,created_by,created_at,expires_at,revoked_at,revoked_by)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("revoked", "cmp", "hash-revoked", "revoked", "Revoked", "Логист", "[]", "owner", "2026-08-24T10:00:00Z", "2099-08-25T10:00:00Z", "2026-08-24T11:00:00Z", "owner"),
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "INVITATION_INVALID_OR_EXPIRED"):
            self.db.execute("INSERT INTO invitation_claims VALUES(?,?,?)", ("revoked", "employee-revoked", "2026-08-24T12:00:00Z"))
        self.db.execute(
            """INSERT INTO invitations
               (id,company_id,code_hash,login,full_name,role,permissions_json,created_by,created_at,expires_at)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            ("expired", "cmp", "hash-expired", "expired", "Expired", "Логист", "[]", "owner", "2020-08-24T10:00:00Z", "2020-08-25T10:00:00Z"),
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "INVITATION_INVALID_OR_EXPIRED"):
            self.db.execute("INSERT INTO invitation_claims VALUES(?,?,?)", ("expired", "employee-expired", "2026-08-24T12:00:00Z"))

    def test_vps_attestation_secret_has_only_an_encrypted_storage_column(self):
        columns = {row[1] for row in self.db.execute("PRAGMA table_info(companies)")}
        self.assertIn("data_api_attestation_secret_ciphertext", columns)
        self.assertNotIn("data_api_attestation_secret", columns)

    def test_migration_008_applies_to_an_existing_database(self):
        db = sqlite3.connect(":memory:")
        db.executescript(
            """
            CREATE TABLE companies(id TEXT PRIMARY KEY);
            CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
            """
        )
        db.executescript(VPS_ATTESTATION_MIGRATION.read_text(encoding="utf-8"))
        columns = {row[1] for row in db.execute("PRAGMA table_info(companies)")}
        self.assertEqual(columns, {"id", "data_api_attestation_secret_ciphertext"})
        self.assertEqual(
            db.execute(
                "SELECT version FROM schema_migrations WHERE version='008-vps-attestations'"
            ).fetchone()[0],
            "008-vps-attestations",
        )

    def test_migration_009_applies_to_an_existing_database_without_losing_invitations(self):
        db = sqlite3.connect(":memory:")
        db.executescript(
            """
            CREATE TABLE users(id TEXT PRIMARY KEY, company_id TEXT NOT NULL, permissions_json TEXT NOT NULL DEFAULT '[]');
            CREATE TABLE invitations(
              id TEXT PRIMARY KEY, company_id TEXT NOT NULL, permissions_json TEXT NOT NULL DEFAULT '[]', expires_at TEXT NOT NULL
            );
            CREATE TABLE invitation_claims(invitation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, claimed_at TEXT NOT NULL);
            CREATE TABLE warehouse_delete_leases(
              id TEXT PRIMARY KEY, company_id TEXT NOT NULL, warehouse_id TEXT NOT NULL, warehouse_code TEXT NOT NULL,
              status TEXT NOT NULL, expires_at INTEGER NOT NULL
            );
            CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
            INSERT INTO invitations(id,company_id,permissions_json,expires_at)
            VALUES('legacy-pending','cmp','["orders.read"]','2999-01-01T00:00:00.000Z');
            """
        )
        db.executescript(INVITATION_LIFECYCLE_MIGRATION.read_text(encoding="utf-8"))
        columns = {row[1] for row in db.execute("PRAGMA table_info(invitations)")}
        self.assertTrue({"revoked_at", "revoked_by"}.issubset(columns))
        self.assertEqual(db.execute("SELECT COUNT(*) FROM invitations WHERE id='legacy-pending'").fetchone()[0], 1)
        db.execute("UPDATE invitations SET revoked_at='2026-08-24T12:00:00.000Z', revoked_by='owner' WHERE id='legacy-pending'")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "INVITATION_INVALID_OR_EXPIRED"):
            db.execute("INSERT INTO invitation_claims VALUES('legacy-pending','employee','2026-08-24T12:01:00.000Z')")
        self.assertEqual(
            db.execute("SELECT version FROM schema_migrations WHERE version='009-invitation-lifecycle'").fetchone()[0],
            "009-invitation-lifecycle",
        )

    def insert_invitation(self, invitation_id: str, permissions, expires_at="2999-01-01T00:00:00.000Z"):
        self.db.execute(
            """INSERT INTO invitations
               (id,company_id,code_hash,login,full_name,role,permissions_json,created_by,created_at,expires_at)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (
                invitation_id,
                "cmp",
                f"hash-{invitation_id}",
                f"login-{invitation_id}",
                invitation_id,
                "manager",
                json.dumps(permissions, ensure_ascii=False),
                "owner",
                "2026-08-23T00:00:00.000Z",
                expires_at,
            ),
        )

    def insert_lease(
        self,
        lease_id: str,
        warehouse_id="wh_spb",
        warehouse_code="СПБ",
        status="active",
        expires_at=None,
    ):
        expiry = int(time.time()) + 120 if expires_at is None else expires_at
        self.db.execute(
            """INSERT INTO warehouse_delete_leases
               (id,company_id,warehouse_id,warehouse_code,actor_user_id,token_hash,status,expires_at,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (
                lease_id,
                "cmp",
                warehouse_id,
                warehouse_code,
                "owner",
                f"token-{lease_id}",
                status,
                expiry,
                "2026-08-23T00:00:00.000Z",
                "2026-08-23T00:00:00.000Z",
            ),
        )

    def test_delete_lease_rejects_exact_user_assignment_by_id(self):
        self.user("owner", "owner", permissions=["*"])
        self.user("employee", "employee", "manager", ["jf.warehouse:wh_spb"])
        with self.assertRaisesRegex(sqlite3.IntegrityError, "WAREHOUSE_ASSIGNED"):
            self.insert_lease("lease-user")

    def test_delete_lease_rejects_pending_invitation_assignment_by_cyrillic_code(self):
        self.user("owner", "owner", permissions=["*"])
        self.insert_invitation("invite-spb", ["jf.warehouse-code:СПБ"])
        with self.assertRaisesRegex(sqlite3.IntegrityError, "WAREHOUSE_ASSIGNED"):
            self.insert_lease("lease-invite")

    def test_database_rejects_noncanonical_warehouse_code_permissions(self):
        self.user("owner", "owner", permissions=["*"])
        with self.assertRaisesRegex(
            sqlite3.IntegrityError,
            "WAREHOUSE_CODE_PERMISSION_NOT_CANONICAL",
        ):
            self.user("legacy-cyrillic", "legacy-cyrillic", "manager", ["jf.warehouse-code:спб"])
        with self.assertRaisesRegex(
            sqlite3.IntegrityError,
            "WAREHOUSE_CODE_PERMISSION_NOT_CANONICAL",
        ):
            self.insert_invitation("legacy-latin", ["jf.warehouse-code:sPb"])

    def test_global_permissions_are_not_exact_warehouse_assignments(self):
        self.user("owner", "owner", permissions=["*"])
        self.user("manager", "manager", "manager", ["*", "jf.warehouse:*"])
        self.insert_invitation("invite-global", ["*", "jf.warehouse:*"])
        self.insert_lease("lease-global")
        self.assertEqual(
            self.db.execute(
                "SELECT warehouse_code,status FROM warehouse_delete_leases WHERE id='lease-global'"
            ).fetchone(),
            ("СПБ", "active"),
        )

    def test_claimed_invitation_is_not_pending_and_does_not_block_lease(self):
        self.user("owner", "owner", permissions=["*"])
        self.insert_invitation("invite-claimed", ["jf.warehouse-code:СПБ"])
        self.db.execute(
            "INSERT INTO invitation_claims(invitation_id,user_id,claimed_at) VALUES(?,?,?)",
            ("invite-claimed", "already-created-user", "2026-08-23T00:01:00.000Z"),
        )
        self.insert_lease("lease-after-claim")
        self.assertEqual(
            self.db.execute(
                "SELECT status FROM warehouse_delete_leases WHERE id='lease-after-claim'"
            ).fetchone()[0],
            "active",
        )

    def test_active_delete_lease_blocks_new_exact_user_and_invitation_assignments(self):
        self.user("owner", "owner", permissions=["*"])
        self.insert_lease("lease-active")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "WAREHOUSE_DELETE_IN_PROGRESS"):
            self.user("employee", "employee", "manager", ["jf.warehouse:wh_spb"])
        with self.assertRaisesRegex(sqlite3.IntegrityError, "WAREHOUSE_DELETE_IN_PROGRESS"):
            self.insert_invitation("invite-exact", ["jf.warehouse-code:СПБ"])

    def test_active_delete_lease_blocks_exact_assignment_updates(self):
        self.user("owner", "owner", permissions=["*"])
        self.user("employee", "employee", "manager", ["orders.read"])
        self.insert_invitation("invite-update", ["orders.read"])
        self.insert_lease("lease-update")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "WAREHOUSE_DELETE_IN_PROGRESS"):
            self.db.execute(
                "UPDATE users SET permissions_json=? WHERE id='employee'",
                (json.dumps(["jf.warehouse-code:СПБ"], ensure_ascii=False),),
            )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "WAREHOUSE_DELETE_IN_PROGRESS"):
            self.db.execute(
                "UPDATE invitations SET permissions_json=? WHERE id='invite-update'",
                (json.dumps(["jf.warehouse:wh_spb"], ensure_ascii=False),),
            )

    def test_prepared_lease_blocks_assignments_indefinitely_and_cleanup_skips_it(self):
        self.user("owner", "owner", permissions=["*"])
        self.insert_lease(
            "lease-prepared",
            status="prepared",
            expires_at=int(time.time()) - 3600,
        )
        self.db.execute(
            """UPDATE warehouse_delete_leases SET status='expired',updated_at=?
               WHERE company_id=? AND status='active' AND expires_at<=?""",
            ("2026-08-23T00:01:00.000Z", "cmp", int(time.time())),
        )
        self.assertEqual(
            self.db.execute(
                "SELECT status FROM warehouse_delete_leases WHERE id='lease-prepared'"
            ).fetchone()[0],
            "prepared",
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "WAREHOUSE_DELETE_IN_PROGRESS"):
            self.user("employee", "employee", "manager", ["jf.warehouse:wh_spb"])
        with self.assertRaisesRegex(sqlite3.IntegrityError, "WAREHOUSE_DELETE_IN_PROGRESS"):
            self.insert_invitation("invite-prepared", ["jf.warehouse-code:СПБ"])

    def test_prepare_transition_atomically_rechecks_assignments(self):
        self.user("owner", "owner", permissions=["*"])
        self.insert_lease("lease-expired-active", expires_at=int(time.time()) - 1)
        self.user("employee", "employee", "manager", ["jf.warehouse:wh_spb"])
        with self.assertRaisesRegex(sqlite3.IntegrityError, "WAREHOUSE_ASSIGNED"):
            self.db.execute(
                "UPDATE warehouse_delete_leases SET status='prepared' WHERE id='lease-expired-active'"
            )

    def test_prepared_lease_is_unique_until_released_and_cannot_be_reopened(self):
        self.user("owner", "owner", permissions=["*"])
        self.insert_lease("lease-prepared", status="prepared")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_lease("lease-same-id", warehouse_code="SPB")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_lease("lease-same-code", warehouse_id="wh_other")
        with self.assertRaisesRegex(
            sqlite3.IntegrityError,
            "WAREHOUSE_DELETE_LEASE_INVALID_TRANSITION",
        ):
            self.db.execute(
                "UPDATE warehouse_delete_leases SET status='expired' WHERE id='lease-prepared'"
            )
        self.db.execute(
            "UPDATE warehouse_delete_leases SET status='released' WHERE id='lease-prepared'"
        )
        self.insert_lease("lease-after-release")

    def test_only_prepared_lease_token_can_rotate(self):
        self.user("owner", "owner", permissions=["*"])
        self.insert_lease("lease-active")
        with self.assertRaisesRegex(
            sqlite3.IntegrityError,
            "WAREHOUSE_DELETE_LEASE_TOKEN_ROTATION_FORBIDDEN",
        ):
            self.db.execute(
                "UPDATE warehouse_delete_leases SET token_hash='rotated-active' WHERE id='lease-active'"
            )
        self.db.execute(
            "UPDATE warehouse_delete_leases SET status='prepared' WHERE id='lease-active'"
        )
        self.db.execute(
            "UPDATE warehouse_delete_leases SET token_hash='rotated-prepared' WHERE id='lease-active'"
        )
        self.assertEqual(
            self.db.execute(
                "SELECT token_hash FROM warehouse_delete_leases WHERE id='lease-active'"
            ).fetchone()[0],
            "rotated-prepared",
        )

    def test_prepared_lease_actor_takeover_requires_token_rotation(self):
        self.user("owner", "owner", permissions=["*"])
        self.user("recovery-owner", "recovery-owner", permissions=["*"])
        self.insert_lease("lease-takeover")
        with self.assertRaisesRegex(
            sqlite3.IntegrityError,
            "WAREHOUSE_DELETE_LEASE_ACTOR_TAKEOVER_INVALID",
        ):
            self.db.execute(
                """UPDATE warehouse_delete_leases SET actor_user_id='recovery-owner'
                   WHERE id='lease-takeover'"""
            )
        self.db.execute(
            "UPDATE warehouse_delete_leases SET status='prepared' WHERE id='lease-takeover'"
        )
        with self.assertRaisesRegex(
            sqlite3.IntegrityError,
            "WAREHOUSE_DELETE_LEASE_ACTOR_TAKEOVER_INVALID",
        ):
            self.db.execute(
                """UPDATE warehouse_delete_leases SET actor_user_id='recovery-owner'
                   WHERE id='lease-takeover'"""
            )
        self.db.execute(
            """UPDATE warehouse_delete_leases
               SET actor_user_id='recovery-owner',token_hash='prepared-takeover'
               WHERE id='lease-takeover'"""
        )
        self.assertEqual(
            self.db.execute(
                """SELECT actor_user_id,token_hash FROM warehouse_delete_leases
                   WHERE id='lease-takeover'"""
            ).fetchone(),
            ("recovery-owner", "prepared-takeover"),
        )

    def test_expired_lease_can_be_cleaned_before_reacquire(self):
        self.user("owner", "owner", permissions=["*"])
        self.insert_lease("lease-expired", expires_at=int(time.time()) - 1)
        self.db.execute(
            """UPDATE warehouse_delete_leases SET status='expired',updated_at=?
               WHERE company_id=? AND status='active' AND expires_at<=?""",
            ("2026-08-23T00:01:00.000Z", "cmp", int(time.time())),
        )
        self.insert_lease("lease-new")
        self.assertEqual(
            self.db.execute(
                "SELECT status FROM warehouse_delete_leases WHERE id='lease-expired'"
            ).fetchone()[0],
            "expired",
        )

    def test_expired_invitation_cannot_be_reactivated_during_delete(self):
        self.user("owner", "owner", permissions=["*"])
        self.insert_invitation(
            "invite-expired",
            ["jf.warehouse-code:СПБ"],
            expires_at="2020-01-01T00:00:00.000Z",
        )
        self.insert_lease("lease-invitation-expiry")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "WAREHOUSE_DELETE_IN_PROGRESS"):
            self.db.execute(
                "UPDATE invitations SET expires_at=? WHERE id='invite-expired'",
                ("2999-01-01T00:00:00.000Z",),
            )

    def test_migration_007_applies_to_an_existing_database(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript(
            """
            CREATE TABLE companies(id TEXT PRIMARY KEY);
            CREATE TABLE users(
              id TEXT PRIMARY KEY,
              company_id TEXT NOT NULL REFERENCES companies(id),
              permissions_json TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE invitations(
              id TEXT PRIMARY KEY,
              company_id TEXT NOT NULL REFERENCES companies(id),
              permissions_json TEXT NOT NULL DEFAULT '[]',
              expires_at TEXT NOT NULL
            );
            CREATE TABLE invitation_claims(
              invitation_id TEXT PRIMARY KEY REFERENCES invitations(id),
              user_id TEXT NOT NULL,
              claimed_at TEXT NOT NULL
            );
            CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
            """
        )
        db.execute("INSERT INTO companies(id) VALUES('cmp')")
        db.execute(
            "INSERT INTO users(id,company_id,permissions_json) VALUES(?,?,?)",
            ("owner", "cmp", '["*"]'),
        )
        db.execute(
            "INSERT INTO users(id,company_id,permissions_json) VALUES(?,?,?)",
            (
                "legacy-cyrillic",
                "cmp",
                '["orders.read","jf.warehouse:*","jf.warehouse-code:спб"]',
            ),
        )
        db.execute(
            "INSERT INTO invitations(id,company_id,permissions_json,expires_at) VALUES(?,?,?,?)",
            (
                "legacy-latin",
                "cmp",
                '["*","jf.warehouse-code:sPb"]',
                "2999-01-01T00:00:00.000Z",
            ),
        )
        db.executescript(WAREHOUSE_LEASE_MIGRATION.read_text(encoding="utf-8"))
        self.assertEqual(
            db.execute(
                "SELECT version FROM schema_migrations WHERE version='007-warehouse-delete-leases'"
            ).fetchone()[0],
            "007-warehouse-delete-leases",
        )
        columns = {row[1] for row in db.execute("PRAGMA table_info(warehouse_delete_leases)")}
        self.assertTrue(
            {
                "company_id",
                "warehouse_id",
                "warehouse_code",
                "actor_user_id",
                "token_hash",
                "status",
                "expires_at",
            }.issubset(columns)
        )
        table_sql = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='warehouse_delete_leases'"
        ).fetchone()[0]
        self.assertIn("'prepared'", table_sql)
        unique_indexes = {
            row[0]: row[1]
            for row in db.execute(
                "SELECT name,sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_warehouse_delete_leases_active_%'"
            )
        }
        self.assertTrue(unique_indexes)
        self.assertTrue(all("'prepared'" in sql for sql in unique_indexes.values()))
        self.assertEqual(
            json.loads(
                db.execute("SELECT permissions_json FROM users WHERE id='legacy-cyrillic'").fetchone()[0]
            ),
            ["orders.read", "jf.warehouse:*", "jf.warehouse-code:СПБ"],
        )
        self.assertEqual(
            json.loads(
                db.execute("SELECT permissions_json FROM invitations WHERE id='legacy-latin'").fetchone()[0]
            ),
            ["*", "jf.warehouse-code:SPB"],
        )
        lease_values = (
            "lease-legacy",
            "cmp",
            "wh-cyrillic",
            "СПБ",
            "owner",
            "token-legacy",
            "active",
            int(time.time()) + 120,
            "2026-08-23T00:00:00.000Z",
            "2026-08-23T00:00:00.000Z",
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "WAREHOUSE_ASSIGNED"):
            db.execute(
                """INSERT INTO warehouse_delete_leases
                   (id,company_id,warehouse_id,warehouse_code,actor_user_id,token_hash,status,expires_at,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                lease_values,
            )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "WAREHOUSE_ASSIGNED"):
            db.execute(
                """INSERT INTO warehouse_delete_leases
                   (id,company_id,warehouse_id,warehouse_code,actor_user_id,token_hash,status,expires_at,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (
                    "lease-mixed-latin",
                    "cmp",
                    "wh-latin",
                    "SPB",
                    "owner",
                    "token-mixed-latin",
                    "active",
                    int(time.time()) + 120,
                    "2026-08-23T00:00:00.000Z",
                    "2026-08-23T00:00:00.000Z",
                ),
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
