#!/usr/bin/env python3
"""JustFun Orders Logistics server-authoritative business data service 7.8.4."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import math
import os
import re
import secrets
import threading
import time
import unicodedata
from contextlib import AbstractContextManager
from datetime import datetime, timezone
from difflib import SequenceMatcher
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode, urlparse
from urllib.request import Request, urlopen

VERSION = "7.8.4"
API_CONTRACT = 3
ADDRESS_API_CONTRACT = 1
FIAS_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
MIN_CLIENT_VERSION = "7.8.3"
REQUIRE_API_CONTRACT = os.environ.get("JF_REQUIRE_API_CONTRACT", "0").strip() == "1"
MAX_BODY = int(os.environ.get("JF_MAX_BODY", str(30 * 1024 * 1024)))
AUTH_ORIGIN = os.environ.get(
    "JF_AUTH_ORIGIN", "https://justfun-license-api.l2maloy47rus.workers.dev"
).rstrip("/")
TELEGRAM_BROKER_ORIGIN = os.environ.get(
    "JF_TELEGRAM_BROKER_ORIGIN", "https://justfun-company-telegram.l2maloy47rus.workers.dev"
).rstrip("/")
VPS_ATTESTATION_SECRET_RE = re.compile(r"^jfvps_[A-Za-z0-9_-]{43,120}$")
VPS_ATTESTATION_CONTRACT = 1
WAREHOUSE_DELETE_RELEASE_OUTBOX_CONTRACT = 1
WAREHOUSE_DELETE_RELEASE_RETRY_SECONDS = 30
AUTH_CACHE_SECONDS = max(5, min(60, int(os.environ.get("JF_AUTH_CACHE_SECONDS", "20"))))
NOMINATIM_ORIGIN = os.environ.get("JF_NOMINATIM_ORIGIN", "https://nominatim.openstreetmap.org").rstrip("/")
PHOTON_ORIGIN = os.environ.get("JF_PHOTON_ORIGIN", "https://photon.komoot.io").rstrip("/")
OSRM_ORIGIN = os.environ.get("JF_OSRM_ORIGIN", "https://router.project-osrm.org").rstrip("/")
DADATA_ORIGIN = os.environ.get("JF_DADATA_ORIGIN", "https://suggestions.dadata.ru").rstrip("/")
DADATA_API_KEY = os.environ.get("JF_DADATA_API_KEY", "").strip()
MAP_CONTACT = os.environ.get("JF_MAP_CONTACT", "").strip()[:160]
MAP_CACHE_LIMIT = max(100, min(10000, int(os.environ.get("JF_MAP_CACHE_LIMIT", "2000"))))
MAP_RATE_PER_MINUTE = max(30, min(1000, int(os.environ.get("JF_MAP_RATE_PER_MINUTE", "180"))))
ADDRESS_CACHE_SECONDS = max(60, min(86400, int(os.environ.get("JF_ADDRESS_CACHE_SECONDS", "900"))))
WORKSPACE_RE = re.compile(r"^[A-Za-z0-9_-]{16,80}$")
WAREHOUSE_RE = re.compile(r"^[A-Za-z0-9_-]{1,120}$")
ADDRESS_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,80}$")
ENTITY_COLLECTION_PATH_RE = re.compile(
    r"^/v1/workspaces/([A-Za-z0-9_-]{16,80})/warehouses/([A-Za-z0-9_-]{1,120})/entities/(live|demo)$"
)
ENTITY_BATCH_PATH_RE = re.compile(
    r"^/v1/workspaces/([A-Za-z0-9_-]{16,80})/warehouses/([A-Za-z0-9_-]{1,120})/entities/(live|demo)/batch$"
)
WAREHOUSE_DELETE_PREPARE_PATH_RE = re.compile(
    r"^/v1/workspaces/([A-Za-z0-9_-]{16,80})/warehouses/([A-Za-z0-9_-]{1,120})/delete-prepare$"
)
ENTITY_CHANGES_PATH_RE = re.compile(
    r"^/v1/workspaces/([A-Za-z0-9_-]{16,80})/warehouses/([A-Za-z0-9_-]{1,120})/changes/(live|demo)$"
)
ADDRESS_SEARCH_PATH_RE = re.compile(
    r"^/v1/workspaces/([A-Za-z0-9_-]{16,80})/warehouses/([A-Za-z0-9_-]{1,120})/address-search/(live|demo)$"
)
ENTITY_TYPE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
ENTITY_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,160}$")
COMMAND_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{16,180}$")
LOCAL_MIGRATION_FINGERPRINT_RE = re.compile(r"^[0-9a-z]{1,7}:[0-9a-z]{1,7}:[1-9][0-9]{0,9}$")
LOCAL_MIGRATION_MAX_CHUNKS = 10000
LOCAL_MIGRATION_INTENT_KIND = "local_migration_import"
WAREHOUSE_CODE_RE = re.compile(r"^[A-ZА-ЯЁ0-9]{1,3}$")
WAREHOUSE_DELETE_LEASE_TOKEN_RE = re.compile(r"^jfdl_[A-Za-z0-9_-]{32,220}$")
TELEGRAM_INSTALLATION_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{8,160}$")
WAREHOUSE_DELETE_LEASE_MIN_REMAINING = 30
WAREHOUSE_DELETE_PREPARE_CONTRACT = 1
WAREHOUSE_CODE_UNIQUE_INDEX = "business_records_v3_live_warehouse_code_uidx"
ENTITY_ARRAYS = ("orders", "products", "inventoryMovements", "drivers", "routeArchives")
ENTITY_SECTIONS = {
    "warehouse",
    "orders",
    "products",
    "inventoryMovements",
    "drivers",
    "settings",
    "reportingData",
    "company",
    "routePlans",
    "routeAssignments",
    "routeCatalog",
    "routeDriverAssignments",
    "routeLocks",
    "routeOverrides",
    "routeExecutions",
    "routeArchives",
    "warehouseReservations",
    "manualRouteSequences",
}
ENTITY_PERMISSION_MAP = {
    "warehouse": ("company.read", ("warehouses.manage",)),
    "orders": ("orders.read", ("orders.create", "orders.update", "orders.status", "orders.payment", "orders.pricing", "orders.delete")),
    "products": ("inventory.read", ("inventory.catalog", "inventory.stock", "inventory.pricing", "inventory.delete")),
    "inventoryMovements": ("inventory.read", ("inventory.stock",)),
    "drivers": ("drivers.read", ("drivers.update", "drivers.delete")),
    "settings": ("company.read", ("warehouses.manage", "routes.settings", "integrations.manage")),
    "company": ("company.read", ("company.update",)),
    "reportingData": ("reports.read", ("reports.settings", "reports.expenses")),
    "routePlans": ("routes.read", ("routes.plan",)),
    "routeAssignments": ("routes.read", ("routes.plan",)),
    "routeCatalog": ("routes.read", ("routes.plan",)),
    "routeDriverAssignments": ("routes.read", ("drivers.assign",)),
    "routeLocks": ("routes.read", ("routes.plan",)),
    "routeOverrides": ("routes.read", ("routes.settings",)),
    "routeExecutions": ("routes.read", ()),
    "routeArchives": ("routes.read", ()),
    "warehouseReservations": ("inventory.read", ()),
    "manualRouteSequences": ("routes.read", ("routes.plan",)),
}
# These records describe the warehouse context itself. Reaching an entity
# endpoint already requires access to that exact warehouse, so every assigned
# employee may read them. Mutations still use ENTITY_PERMISSION_MAP below.
WAREHOUSE_SCOPE_READABLE_ENTITY_TYPES = frozenset({"warehouse", "company"})
ENTITY_INTENT_KINDS = {
    "route_approve",
    "route_picking",
    "route_cancel",
    "route_start",
    "route_return",
    "route_close",
    "pickup_ready",
    "pickup_collected",
    LOCAL_MIGRATION_INTENT_KIND,
}
ENTITY_INTENT_PERMISSIONS = {
    "route_approve": "routes.approve",
    "route_picking": "routes.pick",
    "route_cancel": "routes.cancel",
    "route_start": "routes.start",
    "route_return": "routes.return",
    "route_close": "routes.close",
    "pickup_ready": "inventory.pick",
    "pickup_collected": "inventory.pick",
}
ENTITY_INTENT_TYPES = {
    "route_approve": {"routePlans", "routeAssignments", "routeCatalog", "routeLocks"},
    "route_picking": {"routePlans", "orders"},
    "route_cancel": {"routePlans", "orders", "routeLocks", "routeAssignments", "routeCatalog", "routeDriverAssignments", "routeOverrides", "manualRouteSequences"},
    "route_start": {"routePlans", "routeExecutions", "orders"},
    "route_return": {"routePlans", "routeExecutions", "orders"},
    "route_close": {"routeExecutions", "routeArchives", "orders", "inventoryMovements", "routeLocks", "routeAssignments", "routePlans", "routeDriverAssignments", "routeCatalog", "warehouseReservations"},
    "pickup_ready": {"orders", "warehouseReservations"},
    "pickup_collected": {"orders", "warehouseReservations", "inventoryMovements"},
}
ORDER_STATUS_FIELDS = {
    "fulfillmentStatus", "warehouseFlowStatus", "archived", "archivedAt", "closedAt",
    "requiresAction", "statusHistory", "deliveryAttempts", "fulfillmentResult",
    "parentOrderId", "childOrderIds", "archiveReason", "isFulfillmentContinuation",
}
ORDER_PAYMENT_FIELDS = {"paymentMethod", "paymentStatus", "paidAt", "refundedAt"}
ORDER_PRICING_FIELDS = {
    "total", "goodsTotal", "deliveryDistanceKm", "deliveryRate", "deliveryCost",
    "deliveryAutoCost", "deliveryStandaloneCost", "deliveryCostManual", "deliveryCalcSource",
    "deliveryWarehouseKey", "grandTotal", "deliveryPricingMode", "deliveryPricingRouteId",
    "deliveryPricingAppliedAt", "deliveryPricingDetails", "deliveryPriceLocked",
}
ORDER_ITEM_PRICING_FIELDS = {
    "price", "catalogPrice", "suggestedPrice", "priceOverridden", "purchasePrice", "total",
}
PRODUCT_PRICING_FIELDS = {"purchasePrice", "price", "buyM2", "sellM2"}
PRODUCT_STOCK_FIELDS = {
    "stockTracked", "openingStock", "minStock", "targetStock", "binLocation", "supplier", "leadTimeDays",
}
SETTINGS_WAREHOUSE_FIELDS = {"warehouse"}
SETTINGS_INTEGRATION_FIELDS = {"nominatimUrl", "osrmUrl", "tileUrl"}
SETTINGS_ROUTE_FIELDS = {
    "routeStartTime", "serviceMinutes", "serviceMinMinutes", "serviceMaxMinutes", "minRouteHours",
    "maxRouteHours", "maxRoundKm", "maxStops", "routeMode", "returnToDepot", "routeProfile",
    "routeHintsEnabled", "driverPayment", "deliveryPricing", "driverRatePerKm", "loadingStartTime",
    "loadingBayCount", "loadingMinutes", "loadingIntervalMinutes", "driverArrivalLeadMinutes",
    "arrivalWindowMinutes", "loadingPriority",
}
ENTITY_IMMUTABLE_FIELDS = {"id", "warehouseId", "warehouse_id", "environment", "createdAt"}
ENTITY_CANONICAL_RECORD_TYPES = {"warehouse", *ENTITY_ARRAYS}
ENTITY_AUXILIARY_FIELDS = {"updatedAt"}
INTENT_ORDER_FIELDS = ORDER_STATUS_FIELDS | ORDER_PAYMENT_FIELDS | ENTITY_AUXILIARY_FIELDS
INTENT_PLAN_FIELDS = {
    "route_approve": {"manualApproval", "lifecycleStatus", "lifecycleUpdatedAt"},
    "route_picking": {"lifecycleStatus", "lifecycleUpdatedAt", "pickingStartedAt"},
    "route_start": {"lifecycleStatus", "lifecycleUpdatedAt"},
    "route_return": {"lifecycleStatus", "lifecycleUpdatedAt"},
}
LEGACY_V1_COLUMNS = {
    "workspace_id", "warehouse_id", "environment", "revision", "digest_sha256",
    "snapshot", "created_at", "updated_at",
}
LEGACY_V2_COLUMNS = {
    "workspace_entities": {
        "workspace_id", "warehouse_id", "environment", "entity_type", "entity_id",
        "version", "payload_sha256", "payload", "is_deleted", "last_event_id",
        "created_at", "updated_at",
    },
    "workspace_change_events": {
        "event_id", "workspace_id", "warehouse_id", "environment", "entity_type",
        "entity_id", "entity_version", "operation", "payload_sha256", "payload",
        "changed_by", "device_id", "command_id", "created_at",
    },
    "processed_commands": {
        "workspace_id", "warehouse_id", "environment", "command_id", "actor_id",
        "result", "created_at",
    },
}
LEGACY_COLUMN_TYPES = {
    "warehouse_snapshots": {
        "workspace_id": "character varying", "warehouse_id": "character varying",
        "environment": "character varying", "revision": "bigint",
        "digest_sha256": "character", "snapshot": "jsonb",
        "created_at": "timestamp with time zone", "updated_at": "timestamp with time zone",
    },
    "workspace_entities": {
        "workspace_id": "character varying", "warehouse_id": "character varying",
        "environment": "character varying", "entity_type": "character varying",
        "entity_id": "character varying", "version": "bigint",
        "payload_sha256": "character", "payload": "jsonb", "is_deleted": "boolean",
        "last_event_id": "bigint", "created_at": "timestamp with time zone",
        "updated_at": "timestamp with time zone",
    },
    "workspace_change_events": {
        "event_id": "bigint", "workspace_id": "character varying",
        "warehouse_id": "character varying", "environment": "character varying",
        "entity_type": "character varying", "entity_id": "character varying",
        "entity_version": "bigint", "operation": "character varying",
        "payload_sha256": "character", "payload": "jsonb",
        "changed_by": "character varying", "device_id": "character varying",
        "command_id": "character varying", "created_at": "timestamp with time zone",
    },
    "processed_commands": {
        "workspace_id": "character varying", "warehouse_id": "character varying",
        "environment": "character varying", "command_id": "character varying",
        "actor_id": "character varying", "result": "jsonb",
        "created_at": "timestamp with time zone",
    },
}
LEGACY_V1_MIGRATION_CHECKSUM = hashlib.sha256(
    b"justfun-reg-vps:warehouse-snapshots-v1-to-business-storage-v3:1"
).hexdigest()
LEGACY_V2_MIGRATION_CHECKSUM = hashlib.sha256(
    b"justfun-reg-vps:workspace-entities-v2-to-business-storage-v3:1"
).hexdigest()
REGISTERED_LEGACY_MIGRATIONS = {
    290: ("verified V1 snapshot storage to V3 migration", LEGACY_V1_MIGRATION_CHECKSUM),
    291: ("verified V2 row storage to V3 migration", LEGACY_V2_MIGRATION_CHECKSUM),
}
REGISTERED_CURRENT_MIGRATIONS = {
    300: (
        "server authoritative business storage v3",
        hashlib.sha256(b"justfun-reg-vps:business-storage-v3:1").hexdigest(),
    ),
    301: (
        "durable warehouse delete prepare gate",
        hashlib.sha256(b"justfun-reg-vps:warehouse-delete-prepare-v3:1").hexdigest(),
    ),
    302: (
        "durable warehouse delete lease release outbox",
        hashlib.sha256(b"justfun-reg-vps:warehouse-delete-release-outbox-v3:1").hexdigest(),
    ),
}
REGISTERED_SCHEMA_MIGRATIONS = {**REGISTERED_LEGACY_MIGRATIONS, **REGISTERED_CURRENT_MIGRATIONS}
LEGACY_SINGLETON_SECTIONS = ("settings", "reportingData", "company")
LEGACY_MAP_SECTIONS = (
    "routePlans", "routeAssignments", "routeCatalog", "routeDriverAssignments",
    "routeLocks", "routeOverrides", "routeExecutions", "warehouseReservations",
    "manualRouteSequences",
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("orders-logistics")
AUTH_CACHE: dict[str, tuple[float, dict]] = {}
AUTH_CACHE_LOCK = threading.Lock()
MAP_CACHE: dict[str, tuple[float, object]] = {}
MAP_CACHE_LOCK = threading.Lock()
MAP_RATE_BUCKETS: dict[str, tuple[int, int]] = {}
MAP_RATE_LOCK = threading.Lock()
NOMINATIM_LOCK = threading.Lock()
NOMINATIM_LAST_REQUEST = 0.0


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


DB_POOL_MIN = max(1, min(8, int(os.environ.get("JF_DB_POOL_MIN", "2"))))
DB_POOL_MAX = max(DB_POOL_MIN, min(64, int(os.environ.get("JF_DB_POOL_MAX", "48"))))
DB_POOL = None
DB_POOL_LOCK = threading.Lock()
DB_POOL_SLOTS = threading.BoundedSemaphore(DB_POOL_MAX)


def db_pool():
    global DB_POOL
    if DB_POOL is not None:
        return DB_POOL
    with DB_POOL_LOCK:
        if DB_POOL is None:
            from psycopg2.pool import ThreadedConnectionPool

            DB_POOL = ThreadedConnectionPool(DB_POOL_MIN, DB_POOL_MAX, os.environ["JF_DB_DSN"])
    return DB_POOL


class DatabaseLease(AbstractContextManager):
    """Returns a pooled connection and always resets it before reuse."""

    def __init__(self):
        if not DB_POOL_SLOTS.acquire(timeout=10):
            raise ApiError(503, "database_busy", "Сервер занят. Повторите операцию через несколько секунд")
        self.pool = db_pool()
        try:
            self.connection = self.pool.getconn()
        except Exception:
            DB_POOL_SLOTS.release()
            raise

    def __enter__(self):
        self.connection.autocommit = False
        return self.connection

    def __exit__(self, exc_type, exc_value, traceback):
        discard = bool(self.connection.closed)
        try:
            if not discard:
                if exc_type is None:
                    self.connection.commit()
                else:
                    self.connection.rollback()
        finally:
            self.pool.putconn(self.connection, close=discard)
            DB_POOL_SLOTS.release()
        return False


def db_connect():
    return DatabaseLease()


def canonical_warehouse_code_permissions(auth: dict) -> set[str]:
    """Return only syntactically valid warehouse codes from trusted auth data."""
    codes: set[str] = set()
    for value in auth.get("permissions", set()):
        permission = str(value)
        if not permission.startswith("jf.warehouse-code:"):
            continue
        code = permission.partition("jf.warehouse-code:")[2].strip().upper()
        if WAREHOUSE_CODE_RE.fullmatch(code):
            codes.add(code)
    return codes


def set_database_scope(cur, workspace_id: str, environment: str, auth: dict) -> None:
    """Apply the final transaction-local RLS context without leaking through the pool.

    Legacy code permissions are resolved only against the active LIVE registry in
    the authenticated workspace. The temporary resolver context is immediately
    replaced with the caller's real environment and warehouse IDs before this
    function returns, so no business query runs with elevated scope.
    """
    if not WORKSPACE_RE.fullmatch(workspace_id) or environment not in {"live", "demo"}:
        raise ApiError(400, "invalid_scope", "Некорректная область данных")
    if not hmac.compare_digest(str(auth.get("company_id", "")), workspace_id):
        raise ApiError(403, "workspace_mismatch", "Данные другой компании недоступны")

    permissions = {str(value) for value in auth.get("permissions", set())}
    owner = auth.get("role") == "owner" or "*" in permissions or "jf.warehouse:*" in permissions
    allowed = {
        warehouse_id
        for value in permissions
        if value.startswith("jf.warehouse:")
        for warehouse_id in (value.partition("jf.warehouse:")[2],)
        if WAREHOUSE_RE.fullmatch(warehouse_id)
    }
    code_permissions = canonical_warehouse_code_permissions(auth)
    if not owner and code_permissions:
        # RLS otherwise hides the registry row required to translate the legacy
        # code permission. This resolver scope is limited twice: by transaction-
        # local RLS settings and by exact predicates in the query itself.
        cur.execute(
            """
            SELECT set_config('jf.workspace_id', %s, true),
                   set_config('jf.environment', 'live', true),
                   set_config('jf.owner', '1', true),
                   set_config('jf.allowed_warehouses', '', true)
            """,
            (workspace_id,),
        )
        cur.execute(
            """
            SELECT warehouse_id
            FROM business_records_v3
            WHERE workspace_id=%s AND environment='live'
              AND entity_type='warehouse' AND is_deleted=false
              AND COALESCE(NULLIF(lower(btrim(payload->>'status')), ''), 'active')='active'
              AND upper(btrim(payload->>'code'))=ANY(%s::text[])
            """,
            (workspace_id, sorted(code_permissions)),
        )
        allowed.update(str(row[0]) for row in cur.fetchall() if WAREHOUSE_RE.fullmatch(str(row[0])))

    cur.execute(
        """
        SELECT set_config('jf.workspace_id', %s, true),
               set_config('jf.environment', %s, true),
               set_config('jf.owner', %s, true),
               set_config('jf.allowed_warehouses', %s, true)
        """,
        (workspace_id, environment, "1" if owner else "0", ",".join(sorted(allowed))),
    )


def ensure_warehouse_code_unique_index(cur) -> None:
    """Enforce the same trim+uppercase warehouse-code key used by writes."""
    cur.execute(
        """
        SELECT workspace_id, upper(btrim(payload->>'code')) AS canonical_code, COUNT(*)
        FROM business_records_v3
        WHERE environment='live' AND entity_type='warehouse' AND is_deleted=false
          AND payload->>'code' IS NOT NULL
        GROUP BY workspace_id, upper(btrim(payload->>'code'))
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, workspace_id, canonical_code
        LIMIT 10
        """
    )
    duplicates = cur.fetchall()
    if duplicates:
        samples = [
            {
                "workspace_id": str(workspace_id),
                "code": str(code),
                "count": int(count),
            }
            for workspace_id, code, count in duplicates
        ]
        raise RuntimeError(
            "warehouse_code_duplicate_preflight: canonical duplicate live warehouse codes must be resolved before startup; "
            + json.dumps(samples, ensure_ascii=False, separators=(",", ":"))
        )

    cur.execute(
        """
        SELECT pg_get_expr(indexes.indexprs, indexes.indrelid), indexes.indisunique
        FROM pg_index AS indexes
        JOIN pg_class AS index_class ON index_class.oid=indexes.indexrelid
        JOIN pg_namespace AS index_schema ON index_schema.oid=index_class.relnamespace
        WHERE index_schema.nspname=current_schema() AND index_class.relname=%s
        """,
        (WAREHOUSE_CODE_UNIQUE_INDEX,),
    )
    existing = cur.fetchone()
    if existing:
        expression = re.sub(r"\s+", "", str(existing[0] or "")).lower()
        if not bool(existing[1]) or "upper(btrim(" not in expression:
            cur.execute(f"DROP INDEX {WAREHOUSE_CODE_UNIQUE_INDEX}")

    try:
        cur.execute(
            f"""
            CREATE UNIQUE INDEX IF NOT EXISTS {WAREHOUSE_CODE_UNIQUE_INDEX}
            ON business_records_v3(workspace_id, (upper(btrim(payload->>'code'))))
            WHERE environment='live' AND entity_type='warehouse' AND is_deleted=false
            """
        )
    except Exception as exc:
        if str(getattr(exc, "pgcode", "") or "") == "23505":
            raise RuntimeError(
                "warehouse_code_duplicate_preflight: canonical duplicate live warehouse codes must be resolved before startup"
            ) from exc
        raise


def _schema_table_exists(cur, table_name: str) -> bool:
    cur.execute("SELECT to_regclass(current_schema() || '.' || %s) IS NOT NULL", (table_name,))
    return bool(cur.fetchone()[0])


def _schema_table_columns(cur, table_name: str) -> set[str]:
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name=%s
        ORDER BY ordinal_position
        """,
        (table_name,),
    )
    return {str(row[0]) for row in cur.fetchall()}


def _require_exact_legacy_schema(cur, table_name: str, expected: set[str]) -> None:
    actual = _schema_table_columns(cur, table_name)
    if actual != expected:
        raise RuntimeError(
            "UNSUPPORTED_SCHEMA: legacy table "
            + table_name
            + " has columns "
            + json.dumps(sorted(actual), ensure_ascii=False, separators=(",", ":"))
        )
    cur.execute(
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name=%s
        ORDER BY ordinal_position
        """,
        (table_name,),
    )
    actual_types = {str(row[0]): str(row[1]) for row in cur.fetchall()}
    if actual_types != LEGACY_COLUMN_TYPES.get(table_name):
        raise RuntimeError(
            "UNSUPPORTED_SCHEMA: legacy table "
            + table_name
            + " has unknown column types "
            + json.dumps(actual_types, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        )


def _iter_migration_rows(cur, query: str, parameters: tuple = (), batch_size: int = 1000):
    """Read a large legacy table in bounded batches while writes use the main cursor."""
    with cur.connection.cursor() as reader:
        reader.execute(query, parameters)
        while True:
            rows = reader.fetchmany(batch_size)
            if not rows:
                return
            yield from rows


def _legacy_scope(workspace_id: object, warehouse_id: object, environment: object) -> tuple[str, str, str]:
    workspace = str(workspace_id)
    warehouse = str(warehouse_id)
    env = str(environment).lower()
    if not WORKSPACE_RE.fullmatch(workspace) or not WAREHOUSE_RE.fullmatch(warehouse) or env not in {"live", "demo"}:
        raise RuntimeError("CORRUPT_SCHEMA: legacy record has an invalid company, warehouse or environment scope")
    return workspace, warehouse, env


def _legacy_snapshot_digest(snapshot: dict) -> str:
    stable = {"warehouse": snapshot.get("warehouse"), "data": snapshot.get("data")}
    encoded = json.dumps(stable, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _legacy_wrapped_payload(value: object) -> dict:
    return value if isinstance(value, dict) else {"__jf_wrapped_value": True, "value": value}


def legacy_snapshot_entities(snapshot: object, warehouse_id: str, environment: str) -> list[dict]:
    """Convert the exact supported V1 snapshot contract into V3 entity rows."""
    if not isinstance(snapshot, dict):
        raise RuntimeError("CORRUPT_SCHEMA: legacy warehouse snapshot is not a JSON object")
    warehouse = snapshot.get("warehouse")
    data = snapshot.get("data")
    if not isinstance(warehouse, dict) or not isinstance(data, dict):
        raise RuntimeError("CORRUPT_SCHEMA: legacy warehouse snapshot has no warehouse/data objects")
    if str(warehouse.get("id", "")) != warehouse_id or str(data.get("warehouseId", "")) != warehouse_id:
        raise RuntimeError("CORRUPT_SCHEMA: legacy warehouse snapshot contains a foreign warehouse id")
    if str(warehouse.get("environment", "")).lower() != environment:
        raise RuntimeError("CORRUPT_SCHEMA: legacy warehouse snapshot mixes LIVE and DEMO")
    if not WAREHOUSE_CODE_RE.fullmatch(str(warehouse.get("code", "")).strip().upper()):
        raise RuntimeError("CORRUPT_SCHEMA: legacy warehouse snapshot has an invalid warehouse code")

    entities: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def add(entity_type: str, entity_id: object, payload: object) -> None:
        entity = str(entity_id)
        if entity_type not in ENTITY_SECTIONS or not ENTITY_ID_RE.fullmatch(entity):
            raise RuntimeError(f"CORRUPT_SCHEMA: legacy section {entity_type} has an invalid entity id")
        key = (entity_type, entity)
        if key in seen:
            raise RuntimeError(f"CORRUPT_SCHEMA: duplicate legacy entity {entity_type}/{entity}")
        seen.add(key)
        body = _legacy_wrapped_payload(payload)
        if isinstance(payload, dict):
            declared_id = str(payload.get("id", ""))
            if declared_id and declared_id != entity:
                raise RuntimeError(f"CORRUPT_SCHEMA: legacy entity {entity_type}/{entity} declares another id")
            declared_warehouse = str(payload.get("warehouseId", payload.get("warehouse_id", "")))
            if declared_warehouse and declared_warehouse != warehouse_id:
                raise RuntimeError(f"CORRUPT_SCHEMA: legacy entity {entity_type}/{entity} belongs to another warehouse")
        entities.append({"type": entity_type, "id": entity, "payload": body})

    add("warehouse", warehouse_id, warehouse)
    for section in LEGACY_SINGLETON_SECTIONS:
        value = data.get(section)
        if isinstance(value, dict):
            add(section, section, value)
    for section in ENTITY_ARRAYS:
        values = data.get(section, [])
        if not isinstance(values, list):
            raise RuntimeError(f"CORRUPT_SCHEMA: legacy section {section} is not an array")
        for value in values:
            if not isinstance(value, dict):
                raise RuntimeError(f"CORRUPT_SCHEMA: legacy section {section} contains a non-object record")
            fallback = value.get("routeId", value.get("executionId", "")) if section == "routeArchives" else ""
            add(section, value.get("id", fallback), value)
    for section in LEGACY_MAP_SECTIONS:
        values = data.get(section, {})
        if not isinstance(values, dict):
            raise RuntimeError(f"CORRUPT_SCHEMA: legacy section {section} is not an object map")
        for entity_id, value in values.items():
            add(section, entity_id, value)
    return entities


def _archive_legacy_table(cur, source: str, archive: str) -> None:
    if not _schema_table_exists(cur, source):
        return
    if _schema_table_exists(cur, archive):
        raise RuntimeError(f"UNSUPPORTED_SCHEMA: both {source} and its archive {archive} exist")
    if not re.fullmatch(r"[a-z0-9_]{1,63}", source) or not re.fullmatch(r"[a-z0-9_]{1,63}", archive):
        raise RuntimeError("UNSUPPORTED_SCHEMA: unsafe legacy table name")
    cur.execute(f"ALTER TABLE {source} RENAME TO {archive}")
    cur.execute(f"ALTER TABLE {archive} ENABLE ROW LEVEL SECURITY")
    cur.execute(f"ALTER TABLE {archive} FORCE ROW LEVEL SECURITY")
    cur.execute(f"REVOKE ALL ON {archive} FROM PUBLIC")


def _insert_migrated_event(
    cur,
    workspace_id: str,
    warehouse_id: str,
    environment: str,
    entity_type: str,
    entity_id: str,
    version: int,
    payload: dict | None,
    deleted: bool,
    changed_by: str,
    device_id: str,
    command_id: str,
    created_at: object,
    event_id: int | None = None,
) -> int:
    from psycopg2.extras import Json

    digest = entity_payload_digest(payload, deleted)
    operation = "delete" if deleted else "upsert"
    if event_id is None:
        cur.execute(
            """
            INSERT INTO business_events_v3
              (workspace_id, warehouse_id, environment, entity_type, entity_id,
               entity_version, operation, payload_sha256, payload, changed_by,
               device_id, command_id, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING event_id
            """,
            (workspace_id, warehouse_id, environment, entity_type, entity_id, version,
             operation, digest, None if deleted else Json(payload), changed_by, device_id,
             command_id, created_at),
        )
        return int(cur.fetchone()[0])
    cur.execute(
        """
        INSERT INTO business_events_v3
          (event_id, workspace_id, warehouse_id, environment, entity_type, entity_id,
           entity_version, operation, payload_sha256, payload, changed_by,
           device_id, command_id, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (event_id) DO NOTHING
        """,
        (event_id, workspace_id, warehouse_id, environment, entity_type, entity_id,
         version, operation, digest, None if deleted else Json(payload), changed_by,
         device_id, command_id, created_at),
    )
    cur.execute(
        """
        SELECT workspace_id, warehouse_id, environment, entity_type, entity_id,
               entity_version, operation, payload_sha256
        FROM business_events_v3 WHERE event_id=%s
        """,
        (event_id,),
    )
    stored = cur.fetchone()
    expected = (workspace_id, warehouse_id, environment, entity_type, entity_id, version, operation, digest)
    if not stored or tuple(stored) != expected:
        raise RuntimeError(f"CORRUPT_SCHEMA: legacy event id {event_id} conflicts with V3 history")
    return event_id


def _insert_migrated_record(
    cur,
    workspace_id: str,
    warehouse_id: str,
    environment: str,
    entity_type: str,
    entity_id: str,
    version: int,
    payload: dict | None,
    deleted: bool,
    last_event_id: int,
    created_at: object,
    updated_at: object,
    actor_id: str,
    device_id: str = "legacy-migration",
) -> None:
    from psycopg2.extras import Json

    digest = entity_payload_digest(payload, deleted)
    cur.execute(
        """
        INSERT INTO business_records_v3
          (workspace_id, warehouse_id, environment, entity_type, entity_id,
           version, payload_sha256, payload, is_deleted, last_event_id,
           created_by, updated_by, device_id, created_at, updated_at, deleted_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (workspace_id, warehouse_id, environment, entity_type, entity_id) DO NOTHING
        """,
        (workspace_id, warehouse_id, environment, entity_type, entity_id, version,
         digest, None if deleted else Json(payload), deleted, last_event_id, actor_id,
         actor_id, device_id, created_at, updated_at, updated_at if deleted else None),
    )
    cur.execute(
        """
        SELECT version, payload_sha256, is_deleted, last_event_id
        FROM business_records_v3
        WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
          AND entity_type=%s AND entity_id=%s
        """,
        (workspace_id, warehouse_id, environment, entity_type, entity_id),
    )
    stored = cur.fetchone()
    if not stored or tuple(stored) != (version, digest, deleted, last_event_id):
        raise RuntimeError(f"CORRUPT_SCHEMA: legacy entity {entity_type}/{entity_id} conflicts with V3 storage")


def _repair_business_event_sequence(cur) -> None:
    cur.execute(
        """
        SELECT setval(
          pg_get_serial_sequence('business_events_v3','event_id'),
          GREATEST(COALESCE((SELECT MAX(event_id) FROM business_events_v3), 1), 1),
          EXISTS(SELECT 1 FROM business_events_v3)
        )
        """
    )


def _record_schema_migration(cur, version: int, name: str, checksum: str) -> None:
    cur.execute("SELECT name, checksum_sha256 FROM schema_migrations WHERE version=%s FOR UPDATE", (version,))
    current = cur.fetchone()
    if current and current[1] and str(current[1]) != checksum:
        raise RuntimeError(f"UNSUPPORTED_SCHEMA: migration {version} checksum changed")
    if current:
        cur.execute(
            "UPDATE schema_migrations SET name=%s, checksum_sha256=%s WHERE version=%s",
            (name, checksum, version),
        )
    else:
        cur.execute(
            "INSERT INTO schema_migrations(version, name, checksum_sha256) VALUES (%s,%s,%s)",
            (version, name, checksum),
        )


def _write_legacy_migration_audit(
    cur,
    source_schema: str,
    checksum: str,
    counts: dict[tuple[str, str, str], int],
) -> None:
    from psycopg2.extras import Json

    for (workspace, warehouse, environment), count in sorted(counts.items()):
        cur.execute(
            """
            INSERT INTO business_audit_v3
              (workspace_id, warehouse_id, environment, actor_id, device_id,
               command_id, action, entity_count, details)
            VALUES (%s,%s,%s,'system','legacy-migration',%s,'legacy_storage_migration',%s,%s)
            """,
            (
                workspace,
                warehouse,
                environment,
                f"migration:{source_schema}:{warehouse}"[:180],
                int(count),
                Json({"source_schema": source_schema, "checksum_sha256": checksum}),
            ),
        )


def _verify_registered_migration_checksums(cur) -> None:
    for version, (_name, checksum) in REGISTERED_SCHEMA_MIGRATIONS.items():
        cur.execute("SELECT checksum_sha256 FROM schema_migrations WHERE version=%s", (version,))
        row = cur.fetchone()
        if row and row[0] and str(row[0]) != checksum:
            raise RuntimeError(f"UNSUPPORTED_SCHEMA: migration {version} has an unknown checksum")


def _migrate_legacy_v2(cur) -> set[tuple[str, str, str]]:
    present = [name for name in LEGACY_V2_COLUMNS if _schema_table_exists(cur, name)]
    if not present:
        return set()
    if set(present) != set(LEGACY_V2_COLUMNS):
        raise RuntimeError("UNSUPPORTED_SCHEMA: incomplete V2 row-storage table family")
    for table_name, columns in LEGACY_V2_COLUMNS.items():
        _require_exact_legacy_schema(cur, table_name, columns)

    event_rows = _iter_migration_rows(
        cur,
        """
        SELECT event_id, workspace_id, warehouse_id, environment, entity_type, entity_id,
               entity_version, operation, payload_sha256, payload, changed_by,
               device_id, command_id, created_at
        FROM workspace_change_events ORDER BY event_id
        """,
    )
    for row in event_rows:
        (event_id, workspace, warehouse, environment, entity_type, entity_id, version,
         operation, source_digest, payload, changed_by, device_id, command_id, created_at) = row
        workspace, warehouse, environment = _legacy_scope(workspace, warehouse, environment)
        entity_type, entity_id = str(entity_type), str(entity_id)
        deleted = str(operation) == "delete"
        if entity_type not in ENTITY_SECTIONS or not ENTITY_ID_RE.fullmatch(entity_id) or str(operation) not in {"upsert", "delete"}:
            raise RuntimeError("CORRUPT_SCHEMA: V2 event contains an unsupported entity")
        if entity_payload_digest(payload if isinstance(payload, dict) else None, deleted) != str(source_digest):
            raise RuntimeError(f"CORRUPT_SCHEMA: V2 event {event_id} digest mismatch")
        canonical = canonical_entity_payload(entity_type, entity_id, payload, warehouse, environment, created_at)
        _insert_migrated_event(
            cur, workspace, warehouse, environment, entity_type, entity_id, int(version),
            canonical, deleted, str(changed_by), str(device_id or ""), str(command_id),
            created_at, int(event_id),
        )
    _repair_business_event_sequence(cur)

    scopes: set[tuple[str, str, str]] = set()
    migrated_counts: dict[tuple[str, str, str], int] = {}
    entity_rows = _iter_migration_rows(
        cur,
        """
        SELECT workspace_id, warehouse_id, environment, entity_type, entity_id, version,
               payload_sha256, payload, is_deleted, last_event_id, created_at, updated_at
        FROM workspace_entities
        ORDER BY workspace_id, warehouse_id, environment, entity_type, entity_id
        """,
    )
    for row in entity_rows:
        (workspace, warehouse, environment, entity_type, entity_id, version, source_digest,
         payload, deleted, last_event_id, created_at, updated_at) = row
        workspace, warehouse, environment = _legacy_scope(workspace, warehouse, environment)
        scope = (workspace, warehouse, environment)
        scopes.add(scope)
        entity_type, entity_id = str(entity_type), str(entity_id)
        if entity_type not in ENTITY_SECTIONS or not ENTITY_ID_RE.fullmatch(entity_id):
            raise RuntimeError("CORRUPT_SCHEMA: V2 record contains an unsupported entity")
        deleted = bool(deleted)
        if entity_payload_digest(payload if isinstance(payload, dict) else None, deleted) != str(source_digest):
            raise RuntimeError(f"CORRUPT_SCHEMA: V2 record {entity_type}/{entity_id} digest mismatch")
        canonical = canonical_entity_payload(entity_type, entity_id, payload, warehouse, environment, created_at)
        event_id = int(last_event_id or 0)
        cur.execute(
            """
            SELECT entity_version, payload_sha256, operation
            FROM business_events_v3 WHERE event_id=%s
              AND workspace_id=%s AND warehouse_id=%s AND environment=%s
              AND entity_type=%s AND entity_id=%s
            """,
            (event_id, workspace, warehouse, environment, entity_type, entity_id),
        )
        event = cur.fetchone() if event_id > 0 else None
        canonical_digest = entity_payload_digest(canonical, deleted)
        if not event or tuple(event) != (int(version), canonical_digest, "delete" if deleted else "upsert"):
            event_id = _insert_migrated_event(
                cur, workspace, warehouse, environment, entity_type, entity_id, int(version),
                canonical, deleted, "legacy-v2-migration", "legacy-migration",
                f"migration:v2:{warehouse}:{entity_type}:{entity_id}"[:180], updated_at,
            )
        _insert_migrated_record(
            cur, workspace, warehouse, environment, entity_type, entity_id, int(version),
            canonical, deleted, event_id, created_at, updated_at, "legacy-v2-migration",
        )
        migrated_counts[scope] = migrated_counts.get(scope, 0) + 1

    _write_legacy_migration_audit(cur, "v2", LEGACY_V2_MIGRATION_CHECKSUM, migrated_counts)
    _archive_legacy_table(cur, "workspace_entities", "legacy_v2_workspace_entities_archive")
    _archive_legacy_table(cur, "workspace_change_events", "legacy_v2_workspace_change_events_archive")
    _archive_legacy_table(cur, "processed_commands", "legacy_v2_processed_commands_archive")
    _record_schema_migration(
        cur, 291, "verified V2 row storage to V3 migration", LEGACY_V2_MIGRATION_CHECKSUM
    )
    return scopes


def _migrate_legacy_v1(cur) -> None:
    if not _schema_table_exists(cur, "warehouse_snapshots"):
        return
    _require_exact_legacy_schema(cur, "warehouse_snapshots", LEGACY_V1_COLUMNS)
    snapshot_rows = _iter_migration_rows(
        cur,
        """
        SELECT workspace_id, warehouse_id, environment, revision, digest_sha256,
               snapshot, created_at, updated_at
        FROM warehouse_snapshots
        ORDER BY workspace_id, warehouse_id, environment
        """,
    )
    migrated_counts: dict[tuple[str, str, str], int] = {}
    for workspace, warehouse, environment, revision, source_digest, snapshot, created_at, updated_at in snapshot_rows:
        workspace, warehouse, environment = _legacy_scope(workspace, warehouse, environment)
        scope = (workspace, warehouse, environment)
        migrated_counts.setdefault(scope, 0)
        if not isinstance(snapshot, dict) or _legacy_snapshot_digest(snapshot) != str(source_digest):
            raise RuntimeError(f"CORRUPT_SCHEMA: V1 snapshot digest mismatch for {workspace}/{warehouse}/{environment}")
        version = max(1, int(revision))
        for index, entity in enumerate(legacy_snapshot_entities(snapshot, warehouse, environment)):
            entity_type, entity_id = entity["type"], entity["id"]
            cur.execute(
                """
                SELECT 1 FROM business_records_v3
                WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
                  AND entity_type=%s AND entity_id=%s
                """,
                (workspace, warehouse, environment, entity_type, entity_id),
            )
            if cur.fetchone():
                continue
            payload = canonical_entity_payload(entity_type, entity_id, entity["payload"], warehouse, environment, created_at)
            event_id = _insert_migrated_event(
                cur, workspace, warehouse, environment, entity_type, entity_id, version,
                payload, False, "legacy-v1-migration", "legacy-migration",
                f"migration:v1:{warehouse}:{index}"[:180], updated_at,
            )
            _insert_migrated_record(
                cur, workspace, warehouse, environment, entity_type, entity_id, version,
                payload, False, event_id, created_at, updated_at, "legacy-v1-migration",
            )
            migrated_counts[scope] += 1
    _write_legacy_migration_audit(cur, "v1", LEGACY_V1_MIGRATION_CHECKSUM, migrated_counts)
    _archive_legacy_table(cur, "warehouse_snapshots", "legacy_v1_warehouse_snapshots_archive")
    _record_schema_migration(
        cur, 290, "verified V1 snapshot storage to V3 migration", LEGACY_V1_MIGRATION_CHECKSUM
    )


def migrate_supported_legacy_storage(cur) -> None:
    """Migrate only registered V1/V2 schemas; retain their exact tables as archives."""
    cur.execute("SELECT pg_advisory_xact_lock(hashtext('justfun-reg-vps'), hashtext('schema-migration-v3'))")
    _migrate_legacy_v2(cur)
    _migrate_legacy_v1(cur)
    _repair_business_event_sequence(cur)


def init_schema() -> None:
    with db_connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version integer PRIMARY KEY,
              name varchar(160) NOT NULL,
              applied_at timestamptz NOT NULL DEFAULT now(),
              checksum_sha256 char(64)
            )
            """
        )
        cur.execute("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum_sha256 char(64)")
        _verify_registered_migration_checksums(cur)
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS business_records_v3 (
              workspace_id varchar(80) NOT NULL,
              warehouse_id varchar(120) NOT NULL,
              environment varchar(8) NOT NULL CHECK (environment IN ('live','demo')),
              entity_type varchar(64) NOT NULL,
              entity_id varchar(160) NOT NULL,
              version bigint NOT NULL CHECK (version > 0),
              payload_sha256 char(64) NOT NULL,
              payload jsonb,
              is_deleted boolean NOT NULL DEFAULT false,
              last_event_id bigint NOT NULL DEFAULT 0,
              created_by varchar(160) NOT NULL DEFAULT 'system',
              updated_by varchar(160) NOT NULL DEFAULT 'system',
              device_id varchar(200) NOT NULL DEFAULT '',
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              deleted_at timestamptz,
              PRIMARY KEY (workspace_id, warehouse_id, environment, entity_type, entity_id),
              CHECK ((is_deleted AND payload IS NULL AND deleted_at IS NOT NULL)
                  OR (NOT is_deleted AND payload IS NOT NULL AND deleted_at IS NULL))
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS business_events_v3 (
              event_id bigserial PRIMARY KEY,
              workspace_id varchar(80) NOT NULL,
              warehouse_id varchar(120) NOT NULL,
              environment varchar(8) NOT NULL CHECK (environment IN ('live','demo')),
              entity_type varchar(64) NOT NULL,
              entity_id varchar(160) NOT NULL,
              entity_version bigint NOT NULL CHECK (entity_version > 0),
              operation varchar(12) NOT NULL CHECK (operation IN ('upsert','delete')),
              payload_sha256 char(64) NOT NULL,
              payload jsonb,
              changed_by varchar(160) NOT NULL,
              device_id varchar(200) NOT NULL DEFAULT '',
              command_id varchar(180) NOT NULL,
              created_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS business_records_v3_scope_idx
            ON business_records_v3(workspace_id, warehouse_id, environment, entity_type, is_deleted, updated_at DESC)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS business_events_v3_scope_idx
            ON business_events_v3(workspace_id, warehouse_id, environment, event_id)
            """
        )
        ensure_warehouse_code_unique_index(cur)
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS business_commands_v3 (
              workspace_id varchar(80) NOT NULL,
              warehouse_id varchar(120) NOT NULL,
              environment varchar(8) NOT NULL CHECK (environment IN ('live','demo')),
              command_id varchar(180) NOT NULL,
              actor_id varchar(160) NOT NULL,
              device_id varchar(200) NOT NULL DEFAULT '',
              request_sha256 char(64) NOT NULL DEFAULT repeat('0', 64),
              result jsonb NOT NULL,
              created_at timestamptz NOT NULL DEFAULT now(),
              PRIMARY KEY (workspace_id, warehouse_id, environment, command_id)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS warehouse_delete_operations_v3 (
              workspace_id varchar(80) NOT NULL,
              warehouse_id varchar(120) NOT NULL,
              environment varchar(8) NOT NULL DEFAULT 'live' CHECK (environment = 'live'),
              command_id varchar(180) NOT NULL,
              warehouse_code varchar(3) NOT NULL,
              base_version bigint NOT NULL CHECK (base_version > 0),
              status varchar(16) NOT NULL CHECK (status IN ('prepared','completed')),
              actor_id varchar(160) NOT NULL,
              device_id varchar(200) NOT NULL DEFAULT '',
              prepared_at timestamptz NOT NULL DEFAULT now(),
              completed_at timestamptz,
              result jsonb,
              PRIMARY KEY (workspace_id, warehouse_id),
              UNIQUE (workspace_id, warehouse_id, command_id),
              CHECK (
                (status = 'prepared' AND completed_at IS NULL AND result IS NULL)
                OR (status = 'completed' AND completed_at IS NOT NULL AND result IS NOT NULL)
              )
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS warehouse_delete_operations_v3_status_idx
            ON warehouse_delete_operations_v3(workspace_id, status, prepared_at DESC)
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS warehouse_delete_release_outbox_v3 (
              outbox_id bigserial PRIMARY KEY,
              workspace_id varchar(80) NOT NULL,
              warehouse_id varchar(120) NOT NULL,
              environment varchar(8) NOT NULL DEFAULT 'live' CHECK (environment = 'live'),
              warehouse_code varchar(3) NOT NULL,
              command_id varchar(180) NOT NULL,
              base_version bigint NOT NULL CHECK (base_version > 0),
              status varchar(16) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','retry','delivered')),
              attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
              next_attempt_at timestamptz NOT NULL DEFAULT now(),
              last_attempt_at timestamptz,
              last_error varchar(120),
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              delivered_at timestamptz,
              UNIQUE (workspace_id, warehouse_id, command_id),
              CHECK (
                (status = 'delivered' AND delivered_at IS NOT NULL AND last_error IS NULL)
                OR (status <> 'delivered' AND delivered_at IS NULL)
              )
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS warehouse_delete_release_outbox_v3_due_idx
            ON warehouse_delete_release_outbox_v3(status, next_attempt_at, outbox_id)
            WHERE status IN ('pending','processing','retry')
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS business_audit_v3 (
              audit_id bigserial PRIMARY KEY,
              workspace_id varchar(80) NOT NULL,
              warehouse_id varchar(120) NOT NULL,
              environment varchar(8) NOT NULL CHECK (environment IN ('live','demo')),
              actor_id varchar(160) NOT NULL,
              device_id varchar(200) NOT NULL DEFAULT '',
              command_id varchar(180) NOT NULL,
              action varchar(80) NOT NULL,
              entity_count integer NOT NULL DEFAULT 0 CHECK (entity_count >= 0),
              details jsonb NOT NULL DEFAULT '{}'::jsonb,
              created_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS business_audit_v3_scope_idx
            ON business_audit_v3(workspace_id, warehouse_id, environment, created_at DESC)
            """
        )
        for table_name in (
            "business_records_v3",
            "business_events_v3",
            "business_commands_v3",
            "warehouse_delete_operations_v3",
            "warehouse_delete_release_outbox_v3",
            "business_audit_v3",
        ):
            cur.execute(f"ALTER TABLE {table_name} DISABLE ROW LEVEL SECURITY")
        migrate_supported_legacy_storage(cur)
        ensure_warehouse_code_unique_index(cur)
        scope_policy = """
          workspace_id = current_setting('jf.workspace_id', true)
          AND environment = current_setting('jf.environment', true)
          AND (
            current_setting('jf.owner', true) = '1'
            OR warehouse_id = ANY(string_to_array(current_setting('jf.allowed_warehouses', true), ','))
          )
        """
        for table_name in (
            "business_records_v3",
            "business_events_v3",
            "business_commands_v3",
            "warehouse_delete_operations_v3",
            "warehouse_delete_release_outbox_v3",
            "business_audit_v3",
        ):
            cur.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
            cur.execute(f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY")
            cur.execute(f"DROP POLICY IF EXISTS jf_scope_isolation ON {table_name}")
            cur.execute(
                f"CREATE POLICY jf_scope_isolation ON {table_name} FOR ALL USING ({scope_policy}) WITH CHECK ({scope_policy})"
            )
        cur.execute("DROP POLICY IF EXISTS jf_system_outbox ON warehouse_delete_release_outbox_v3")
        cur.execute(
            """
            CREATE POLICY jf_system_outbox ON warehouse_delete_release_outbox_v3
            FOR ALL
            USING (current_setting('jf.system_worker', true) = 'warehouse-delete-release')
            WITH CHECK (current_setting('jf.system_worker', true) = 'warehouse-delete-release')
            """
        )
        cur.execute("REVOKE ALL ON warehouse_delete_release_outbox_v3 FROM PUBLIC")
        cur.execute("REVOKE ALL ON SEQUENCE warehouse_delete_release_outbox_v3_outbox_id_seq FROM PUBLIC")
        for version, (name, checksum) in REGISTERED_CURRENT_MIGRATIONS.items():
            _record_schema_migration(cur, version, name, checksum)


def api_key_valid(value: str) -> bool:
    if not value.startswith("Bearer "):
        return False
    token = value[7:].strip()
    expected = os.environ.get("JF_API_KEY_SHA256", "")
    actual = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return bool(expected) and hmac.compare_digest(actual, expected)


def _auth_cache_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _normalize_auth_context(payload: object) -> dict:
    if not isinstance(payload, dict) or payload.get("ok") is not True or payload.get("active") is not True:
        raise ApiError(401, "unauthorized", "Учётная запись не подтверждена")
    company = payload.get("company")
    user = payload.get("user")
    if not isinstance(company, dict) or not isinstance(user, dict):
        raise ApiError(401, "unauthorized", "Сервер входа вернул неполные данные")
    company_id = str(company.get("id", ""))
    if not WORKSPACE_RE.fullmatch(company_id):
        raise ApiError(401, "unauthorized", "Идентификатор компании не подтверждён")
    permissions = user.get("permissions", [])
    if not isinstance(permissions, list):
        permissions = []
    return {
        "legacy": False,
        "company_id": company_id,
        "user_id": str(user.get("id", "")),
        "role": str(user.get("role", "viewer")),
        "permissions": {str(item) for item in permissions if isinstance(item, str)},
        "device_id": str(payload.get("device_id", "")),
    }


def authenticate_request(value: str) -> dict:
    if not value.startswith("Bearer "):
        raise ApiError(401, "unauthorized", "Сначала выполните вход")
    token = value[7:].strip()
    if not token:
        raise ApiError(401, "unauthorized", "Сначала выполните вход")
    if api_key_valid(value):
        return {
            "legacy": True,
            "company_id": os.environ["JF_INSTALLATION_ID"],
            "user_id": "legacy-bootstrap",
            "role": "owner",
            "permissions": {"*"},
            "device_id": "",
        }

    cache_key = _auth_cache_key(token)
    now = time.monotonic()
    with AUTH_CACHE_LOCK:
        cached = AUTH_CACHE.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]
        if cached:
            AUTH_CACHE.pop(cache_key, None)

    request = Request(
        f"{AUTH_ORIGIN}/v1/auth/introspect",
        data=b"{}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": f"JustFun-Orders-Logistics/{VERSION}",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            raw = response.read(256 * 1024)
        payload = json.loads(raw.decode("utf-8"))
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise ApiError(401, "unauthorized", "Сессия пользователя недействительна") from exc
        raise ApiError(503, "auth_service_unavailable", "Сервер входа временно недоступен") from exc
    except (URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ApiError(503, "auth_service_unavailable", "Сервер входа временно недоступен") from exc

    context = _normalize_auth_context(payload)
    with AUTH_CACHE_LOCK:
        if len(AUTH_CACHE) >= 512:
            oldest = min(AUTH_CACHE, key=lambda key: AUTH_CACHE[key][0])
            AUTH_CACHE.pop(oldest, None)
        AUTH_CACHE[cache_key] = (now + AUTH_CACHE_SECONDS, context)
    return context


def _warehouse_delete_lease_error(status: int, code: str) -> ApiError:
    messages = {
        "WAREHOUSE_ASSIGNED": "Склад назначен сотрудникам или есть в действующем приглашении",
        "WAREHOUSE_DELETE_LEASE_ACTIVE": "Удаление этого склада уже выполняется",
        "WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED": "Защитное разрешение на удаление недействительно или устарело",
        "WAREHOUSE_DELETE_LEASE_REACQUIRE_REQUIRED": "Защитное разрешение скоро истечёт; повторите удаление",
        "ACCESS_BLOCKED": "Нет права удалять склады",
    }
    safe_code = str(code or "WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED")[:120]
    return ApiError(status, safe_code, messages.get(safe_code, "Сервер входа не подтвердил безопасное удаление склада"))


def _warehouse_delete_lease_request(
    action: str,
    authorization: str,
    warehouse_id: str,
    warehouse_code: str,
    lease_token: str,
) -> dict:
    if action not in {"prepare", "verify", "release"}:
        raise ValueError("invalid warehouse delete lease action")
    if not authorization.startswith("Bearer ") or not WAREHOUSE_DELETE_LEASE_TOKEN_RE.fullmatch(lease_token):
        raise _warehouse_delete_lease_error(409, "WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED")
    code = str(warehouse_code).strip().upper()
    if not WAREHOUSE_RE.fullmatch(warehouse_id) or not WAREHOUSE_CODE_RE.fullmatch(code):
        raise _warehouse_delete_lease_error(409, "WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED")
    encoded = json.dumps(
        {"warehouse_id": warehouse_id, "warehouse_code": code, "lease_token": lease_token},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    request = Request(
        f"{AUTH_ORIGIN}/v1/warehouse-delete-leases/{action}",
        data=encoded,
        headers={
            "Authorization": authorization,
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
            "User-Agent": f"JustFun-Orders-Logistics/{VERSION}",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            raw = response.read(256 * 1024)
        payload = json.loads(raw.decode("utf-8"))
    except HTTPError as exc:
        try:
            payload = json.loads(exc.read(256 * 1024).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload = {}
        raise _warehouse_delete_lease_error(int(exc.code), str(payload.get("error", ""))) from exc
    except (URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ApiError(503, "warehouse_delete_lease_service_unavailable", "Сервер входа недоступен; удаление остановлено") from exc
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise ApiError(503, "warehouse_delete_lease_service_invalid", "Сервер входа вернул неподтверждённый ответ; удаление остановлено")
    return payload


def verify_warehouse_delete_lease(
    authorization: str,
    workspace_id: str,
    warehouse_id: str,
    warehouse_code: str,
    lease_token: str,
    require_prepared: bool = False,
) -> dict:
    payload = _warehouse_delete_lease_request("verify", authorization, warehouse_id, warehouse_code, lease_token)
    lease = payload.get("lease")
    remaining = payload.get("remaining_seconds")
    prepared_confirmed = payload.get("prepared") is True and str(payload.get("status", "")) == "prepared"
    finite_remaining_valid = (
        isinstance(remaining, int)
        and not isinstance(remaining, bool)
        and remaining >= WAREHOUSE_DELETE_LEASE_MIN_REMAINING
    )
    remaining_valid = finite_remaining_valid or (require_prepared and prepared_confirmed and remaining is None)
    if (
        payload.get("active") is not True
        or not isinstance(lease, dict)
        or not hmac.compare_digest(str(lease.get("company_id", "")), workspace_id)
        or not hmac.compare_digest(str(lease.get("warehouse_id", "")), warehouse_id)
        or not hmac.compare_digest(
            str(lease.get("warehouse_code", "")).encode("utf-8"),
            warehouse_code.encode("utf-8"),
        )
        or not remaining_valid
        or (require_prepared and not prepared_confirmed)
    ):
        raise ApiError(503, "warehouse_delete_lease_service_invalid", "Сервер входа не подтвердил область и срок защитного разрешения")
    return payload


def prepare_warehouse_delete_lease(
    authorization: str,
    workspace_id: str,
    warehouse_id: str,
    warehouse_code: str,
    lease_token: str,
) -> dict:
    payload = _warehouse_delete_lease_request("prepare", authorization, warehouse_id, warehouse_code, lease_token)
    lease = payload.get("lease")
    if (
        payload.get("active") is not True
        or payload.get("prepared") is not True
        or str(payload.get("status", "")) != "prepared"
        or not isinstance(lease, dict)
        or not hmac.compare_digest(str(lease.get("company_id", "")), workspace_id)
        or not hmac.compare_digest(str(lease.get("warehouse_id", "")), warehouse_id)
        or not hmac.compare_digest(
            str(lease.get("warehouse_code", "")).encode("utf-8"),
            warehouse_code.encode("utf-8"),
        )
    ):
        raise ApiError(503, "warehouse_delete_lease_service_invalid", "Сервер входа не подтвердил подготовку защитного разрешения")
    return payload


def release_warehouse_delete_lease(
    authorization: str,
    warehouse_id: str,
    warehouse_code: str,
    lease_token: str,
) -> None:
    try:
        _warehouse_delete_lease_request("release", authorization, warehouse_id, warehouse_code, lease_token)
    except Exception as exc:
        LOG.warning("warehouse delete lease release failed code=%s", str(getattr(exc, "code", "release_failed"))[:120])


def _require_vps_attestation_secret() -> str:
    secret = os.environ.get("JF_VPS_ATTESTATION_SECRET", "").strip()
    if not VPS_ATTESTATION_SECRET_RE.fullmatch(secret):
        raise ApiError(
            500,
            "vps_attestation_configuration_invalid",
            "Секрет подтверждения VPS не настроен",
        )
    return secret


def _validated_https_origin(origin: str, error_code: str, message: str) -> str:
    parsed = urlparse(origin)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ApiError(500, error_code, message)
    return origin.rstrip("/")


def _vps_attestation_headers(
    workspace_id: str,
    warehouse_id: str,
    warehouse_code: str,
    command_id: str,
    base_version: int,
    lease_token: str = "",
) -> dict[str, str]:
    if (
        not WORKSPACE_RE.fullmatch(workspace_id)
        or not WAREHOUSE_RE.fullmatch(warehouse_id)
        or not WAREHOUSE_CODE_RE.fullmatch(warehouse_code)
        or not COMMAND_ID_RE.fullmatch(command_id)
        or not isinstance(base_version, int)
        or isinstance(base_version, bool)
        or base_version < 1
        or (lease_token != "" and not WAREHOUSE_DELETE_LEASE_TOKEN_RE.fullmatch(lease_token))
    ):
        raise ApiError(409, "vps_attestation_payload_invalid", "Подтверждение VPS повреждено")
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(24)
    token_sha256 = hashlib.sha256(lease_token.encode("utf-8")).hexdigest()
    canonical = "\n".join(
        (
            "justfun-vps-telegram-deprovision-v1",
            workspace_id,
            warehouse_id,
            warehouse_code,
            command_id,
            str(base_version),
            token_sha256,
            timestamp,
            nonce,
        )
    )
    signature = hmac.new(
        _require_vps_attestation_secret().encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "x-justfun-vps-timestamp": timestamp,
        "x-justfun-vps-nonce": nonce,
        "x-justfun-vps-signature": f"v1={signature}",
    }


def confirm_warehouse_telegram_deprovision(
    authorization: str,
    workspace_id: str,
    warehouse_id: str,
    warehouse_code: str,
    lease_token: str,
    command_id: str,
    base_version: int,
) -> dict:
    delete_command_id = command_id
    broker_origin = _validated_https_origin(
        TELEGRAM_BROKER_ORIGIN,
        "telegram_broker_configuration_invalid",
        "Адрес Telegram-broker настроен неверно",
    )
    if (
        not authorization.startswith("Bearer ")
        or not WORKSPACE_RE.fullmatch(workspace_id)
        or not WAREHOUSE_RE.fullmatch(warehouse_id)
        or not WAREHOUSE_CODE_RE.fullmatch(warehouse_code)
        or not WAREHOUSE_DELETE_LEASE_TOKEN_RE.fullmatch(lease_token)
        or not COMMAND_ID_RE.fullmatch(delete_command_id)
        or not isinstance(base_version, int)
        or isinstance(base_version, bool)
        or base_version < 1
    ):
        raise ApiError(409, "telegram_deprovision_proof_invalid", "Подтверждение отключения Telegram повреждено")
    encoded = json.dumps(
        {
            "warehouse_id": warehouse_id,
            "warehouse_code": warehouse_code,
            "warehouse_delete_lease_token": lease_token,
            "delete_command_id": delete_command_id,
            "delete_base_version": base_version,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    attestation_headers = _vps_attestation_headers(
        workspace_id,
        warehouse_id,
        warehouse_code,
        delete_command_id,
        base_version,
        lease_token,
    )
    request = Request(
        f"{broker_origin}/v1/company/telegram-service/deprovision",
        data=encoded,
        headers={
            "Authorization": authorization,
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
            "User-Agent": f"JustFunVPS/{VERSION}",
            **attestation_headers,
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read(256 * 1024)
        payload = json.loads(raw.decode("utf-8"))
    except HTTPError as exc:
        try:
            payload = json.loads(exc.read(256 * 1024).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        safe_code = str(payload.get("error", "telegram_deprovision_rejected"))[:120]
        raise ApiError(int(exc.code), safe_code, "Telegram-broker не подтвердил отключение склада") from exc
    except (URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ApiError(503, "telegram_broker_unavailable", "Telegram-broker временно недоступен; удаление остановлено") from exc
    installation_id = str(payload.get("installation_id", "")) if isinstance(payload, dict) else ""
    if (
        not isinstance(payload, dict)
        or payload.get("ok") is not True
        or payload.get("deprovisioned") is not True
        or not hmac.compare_digest(str(payload.get("warehouse_id", "")), warehouse_id)
        or not hmac.compare_digest(str(payload.get("warehouse_code", "")).encode("utf-8"), warehouse_code.encode("utf-8"))
        or not hmac.compare_digest(str(payload.get("delete_command_id", "")), delete_command_id)
        or not isinstance(payload.get("delete_base_version"), int)
        or isinstance(payload.get("delete_base_version"), bool)
        or payload.get("delete_base_version") != base_version
        or (installation_id != "" and not TELEGRAM_INSTALLATION_ID_RE.fullmatch(installation_id))
    ):
        raise ApiError(503, "telegram_deprovision_confirmation_invalid", "Telegram-broker вернул неподтверждённый результат")
    return {
        "deprovisioned": True,
        "already_deprovisioned": payload.get("already_deprovisioned") is True,
        "installation_id": installation_id,
    }


def _set_warehouse_delete_release_worker_scope(cur) -> None:
    cur.execute(
        "SELECT set_config('jf.system_worker', 'warehouse-delete-release', true)"
    )


def _claim_warehouse_delete_release_outbox(
    limit: int = 10,
    exact_key: tuple[str, str, str] | None = None,
) -> list[dict]:
    safe_limit = max(1, min(50, int(limit)))
    exact_workspace, exact_warehouse, exact_command = exact_key or (None, None, None)
    with db_connect() as conn, conn.cursor() as cur:
        _set_warehouse_delete_release_worker_scope(cur)
        cur.execute(
            """
            WITH candidates AS (
              SELECT outbox_id
              FROM warehouse_delete_release_outbox_v3
              WHERE (
                (status IN ('pending','retry') AND next_attempt_at <= now())
                OR (status='processing' AND updated_at <= now() - interval '5 minutes')
              )
                AND (
                  %s::text IS NULL
                  OR (workspace_id=%s AND warehouse_id=%s AND command_id=%s)
                )
              ORDER BY next_attempt_at, outbox_id
              FOR UPDATE SKIP LOCKED
              LIMIT %s
            )
            UPDATE warehouse_delete_release_outbox_v3 AS outbox
            SET status='processing', attempts=outbox.attempts + 1,
                last_attempt_at=now(), updated_at=now(), last_error=NULL
            FROM candidates
            WHERE outbox.outbox_id=candidates.outbox_id
            RETURNING outbox.outbox_id, outbox.workspace_id, outbox.warehouse_id,
                      outbox.warehouse_code, outbox.command_id, outbox.base_version,
                      outbox.attempts
            """,
            (
                exact_workspace,
                exact_workspace,
                exact_warehouse,
                exact_command,
                safe_limit,
            ),
        )
        rows = cur.fetchall()
    return [
        {
            "outbox_id": int(row[0]),
            "workspace_id": str(row[1]),
            "warehouse_id": str(row[2]),
            "warehouse_code": str(row[3]),
            "command_id": str(row[4]),
            "base_version": int(row[5]),
            "attempts": int(row[6]),
        }
        for row in rows
    ]


def _deliver_warehouse_delete_release(item: dict) -> dict:
    auth_origin = _validated_https_origin(
        AUTH_ORIGIN,
        "auth_service_configuration_invalid",
        "Адрес сервера входа настроен неверно",
    )
    workspace_id = str(item.get("workspace_id", ""))
    warehouse_id = str(item.get("warehouse_id", ""))
    warehouse_code = str(item.get("warehouse_code", ""))
    command_id = str(item.get("command_id", ""))
    base_version = item.get("base_version")
    attestation_headers = _vps_attestation_headers(
        workspace_id,
        warehouse_id,
        warehouse_code,
        command_id,
        base_version,
        "",
    )
    encoded = json.dumps(
        {
            "company_id": workspace_id,
            "warehouse_id": warehouse_id,
            "warehouse_code": warehouse_code,
            "delete_command_id": command_id,
            "delete_base_version": base_version,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    request = Request(
        f"{auth_origin}/v1/vps-attestations/release-warehouse-delete",
        data=encoded,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
            "User-Agent": f"JustFunVPS/{VERSION}",
            **attestation_headers,
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=12) as response:
            raw = response.read(256 * 1024)
        payload = json.loads(raw.decode("utf-8"))
    except HTTPError as exc:
        try:
            payload = json.loads(exc.read(256 * 1024).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        safe_code = re.sub(r"[^A-Za-z0-9_.:-]", "_", str(payload.get("error", "release_rejected")))[:120]
        raise ApiError(int(exc.code), safe_code or "release_rejected", "Сервер входа не снял защитную блокировку") from exc
    except (URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ApiError(503, "warehouse_delete_release_service_unavailable", "Сервер входа временно недоступен") from exc
    if (
        not isinstance(payload, dict)
        or payload.get("ok") is not True
        or payload.get("released") is not True
        or str(payload.get("status", "")) != "released"
        or not hmac.compare_digest(str(payload.get("company_id", "")), workspace_id)
        or not hmac.compare_digest(str(payload.get("warehouse_id", "")), warehouse_id)
        or not hmac.compare_digest(
            str(payload.get("warehouse_code", "")).encode("utf-8"),
            warehouse_code.encode("utf-8"),
        )
        or not hmac.compare_digest(str(payload.get("delete_command_id", "")), command_id)
        or not isinstance(payload.get("delete_base_version"), int)
        or isinstance(payload.get("delete_base_version"), bool)
        or payload.get("delete_base_version") != base_version
    ):
        raise ApiError(503, "warehouse_delete_release_service_invalid", "Сервер входа вернул неподтверждённый ответ")
    return payload


def _finish_warehouse_delete_release_outbox(item: dict, delivered: bool, error_code: str = "") -> None:
    outbox_id = int(item["outbox_id"])
    if delivered:
        with db_connect() as conn, conn.cursor() as cur:
            _set_warehouse_delete_release_worker_scope(cur)
            cur.execute(
                """
                UPDATE warehouse_delete_release_outbox_v3
                SET status='delivered', delivered_at=now(), updated_at=now(),
                    next_attempt_at=now(), last_error=NULL
                WHERE outbox_id=%s AND status='processing'
                """,
                (outbox_id,),
            )
        return
    attempts = max(1, int(item.get("attempts", 1)))
    retry_seconds = min(3600, 5 * (2 ** min(attempts - 1, 10)))
    safe_error = re.sub(r"[^A-Za-z0-9_.:-]", "_", str(error_code or "release_failed"))[:120]
    with db_connect() as conn, conn.cursor() as cur:
        _set_warehouse_delete_release_worker_scope(cur)
        cur.execute(
            """
            UPDATE warehouse_delete_release_outbox_v3
            SET status='retry', next_attempt_at=now() + (%s * interval '1 second'),
                updated_at=now(), last_error=%s
            WHERE outbox_id=%s AND status='processing'
            """,
            (retry_seconds, safe_error or "release_failed", outbox_id),
        )


def process_warehouse_delete_release_outbox(
    limit: int = 10,
    exact_key: tuple[str, str, str] | None = None,
) -> dict:
    claimed = _claim_warehouse_delete_release_outbox(limit, exact_key)
    delivered = 0
    retried = 0
    for item in claimed:
        try:
            _deliver_warehouse_delete_release(item)
        except Exception as exc:
            error_code = str(getattr(exc, "code", exc.__class__.__name__))
            _finish_warehouse_delete_release_outbox(item, False, error_code)
            retried += 1
            LOG.warning(
                "warehouse delete release deferred outbox_id=%s attempt=%s code=%s",
                item["outbox_id"],
                item["attempts"],
                re.sub(r"[^A-Za-z0-9_.:-]", "_", error_code)[:120],
            )
        else:
            _finish_warehouse_delete_release_outbox(item, True)
            delivered += 1
    return {"claimed": len(claimed), "delivered": delivered, "retried": retried}


def _warehouse_delete_release_worker() -> None:
    while True:
        try:
            process_warehouse_delete_release_outbox()
        except Exception:
            LOG.exception("warehouse delete release outbox worker failure")
        time.sleep(WAREHOUSE_DELETE_RELEASE_RETRY_SECONDS)


def start_warehouse_delete_release_worker() -> threading.Thread:
    worker = threading.Thread(
        target=_warehouse_delete_release_worker,
        name="warehouse-delete-release-outbox",
        daemon=True,
    )
    worker.start()
    return worker


def _lock_warehouse_delete_scopes(cur, workspace_id: str, warehouse_id: str) -> None:
    for environment in ("demo", "live"):
        cur.execute(
            "SELECT pg_advisory_xact_lock(hashtext(%s), hashtext(%s))",
            (f"{workspace_id}:{warehouse_id}:{environment}", "entity-write-scope"),
        )


def _select_warehouse_delete_operation(cur, workspace_id: str, warehouse_id: str):
    cur.execute(
        """
        SELECT command_id, warehouse_code, base_version, status, actor_id, device_id,
               prepared_at, completed_at, result
        FROM warehouse_delete_operations_v3
        WHERE workspace_id=%s AND warehouse_id=%s AND environment='live'
        FOR UPDATE
        """,
        (workspace_id, warehouse_id),
    )
    return cur.fetchone()


def _warehouse_delete_prepare_result(row, replayed: bool, recovered_existing: bool = False) -> dict:
    command_id, warehouse_code, base_version, status, _actor_id, _device_id, prepared_at, completed_at, result = row
    prepared_iso = prepared_at.isoformat() if hasattr(prepared_at, "isoformat") else str(prepared_at)
    completed_iso = completed_at.isoformat() if hasattr(completed_at, "isoformat") else None
    return {
        "delete_prepare_contract": WAREHOUSE_DELETE_PREPARE_CONTRACT,
        "operation": "warehouse_delete",
        "status": str(status),
        "command_id": str(command_id),
        "warehouse_code": str(warehouse_code),
        "base_version": int(base_version),
        "prepared_at": prepared_iso,
        "completed_at": completed_iso,
        "replayed": bool(replayed),
        "recovered_existing": bool(recovered_existing),
        "final_result": result if str(status) == "completed" and isinstance(result, dict) else None,
    }


def prepare_warehouse_delete(
    workspace_id: str,
    warehouse_id: str,
    request: dict,
    auth: dict,
    authorization: str,
) -> dict:
    allowed_fields = {
        "command_id",
        "base_version",
        "warehouse_code",
        "warehouse_delete_lease_token",
    }
    if set(request) - allowed_fields:
        raise ApiError(400, "warehouse_delete_prepare_invalid", "Запрос подготовки удаления содержит неизвестные поля")
    command_id = str(request.get("command_id", ""))
    raw_code = request.get("warehouse_code")
    warehouse_code = str(raw_code or "")
    base_version = request.get("base_version")
    lease_token = str(request.get("warehouse_delete_lease_token", ""))
    if not COMMAND_ID_RE.fullmatch(command_id):
        raise ApiError(400, "command_id_required", "Для удаления требуется безопасный уникальный command_id")
    if not isinstance(base_version, int) or isinstance(base_version, bool) or base_version < 1:
        raise ApiError(400, "warehouse_delete_base_version_invalid", "Версия удаляемого склада повреждена")
    if warehouse_code != warehouse_code.strip().upper() or not WAREHOUSE_CODE_RE.fullmatch(warehouse_code):
        raise ApiError(400, "invalid_warehouse_code", "Код удаляемого склада должен быть передан точно")
    if not WAREHOUSE_DELETE_LEASE_TOKEN_RE.fullmatch(lease_token):
        raise _warehouse_delete_lease_error(409, "WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED")

    require_workspace(auth, workspace_id)
    require_global_warehouse_delete_access(auth)
    actor_id = str(auth.get("user_id", ""))[:160] or "unknown-user"
    device_id = str(auth.get("device_id", ""))[:200]

    with db_connect() as conn, conn.cursor() as cur:
        set_database_scope(cur, workspace_id, "live", auth)
        _lock_warehouse_delete_scopes(cur, workspace_id, warehouse_id)
        operation = _select_warehouse_delete_operation(cur, workspace_id, warehouse_id)
        if operation:
            same_command = hmac.compare_digest(str(operation[0]), command_id)
            same_code = hmac.compare_digest(str(operation[1]).encode("utf-8"), warehouse_code.encode("utf-8"))
            same_version = int(operation[2]) == base_version
            same_actor = hmac.compare_digest(str(operation[4]), actor_id)
            if str(operation[3]) == "completed":
                if same_command and same_code and same_version:
                    return _warehouse_delete_prepare_result(operation, True)
                if same_actor and same_code:
                    return _warehouse_delete_prepare_result(operation, True, True)
                raise ApiError(409, "warehouse_delete_completed", "Удаление склада уже завершено; повторная подготовка запрещена")
            if not same_code:
                raise ApiError(409, "warehouse_delete_prepare_mismatch", "Параметры подготовленного удаления не совпадают")
            try:
                prepare_warehouse_delete_lease(authorization, workspace_id, warehouse_id, warehouse_code, lease_token)
            except ApiError as exc:
                if str(exc.code).upper() in {
                    "WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED",
                    "WAREHOUSE_DELETE_LEASE_REACQUIRE_REQUIRED",
                }:
                    raise ApiError(
                        409,
                        "warehouse_delete_lease_superseded",
                        "Подготовленное удаление уже принадлежит другому защитному разрешению",
                    ) from exc
                raise
            recovered_existing = not (same_actor and same_command and same_version)
            if not same_actor:
                cur.execute(
                    """
                    UPDATE warehouse_delete_operations_v3
                    SET actor_id=%s, device_id=%s
                    WHERE workspace_id=%s AND warehouse_id=%s AND environment='live' AND status='prepared'
                    RETURNING command_id, warehouse_code, base_version, status, actor_id, device_id,
                              prepared_at, completed_at, result
                    """,
                    (actor_id, device_id, workspace_id, warehouse_id),
                )
                operation = cur.fetchone()
                if not operation:
                    raise ApiError(409, "warehouse_delete_in_progress", "Подготовленное удаление изменилось во время восстановления")
            return _warehouse_delete_prepare_result(operation, True, recovered_existing)

        cur.execute(
            """
            SELECT result, request_sha256
            FROM business_commands_v3
            WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s AND command_id=%s
            FOR UPDATE
            """,
            (workspace_id, warehouse_id, "live", command_id),
        )
        if cur.fetchone():
            raise ApiError(409, "command_id_reused", "Идентификатор команды уже использован для другой операции")

        cur.execute(
            """
            SELECT version, payload, is_deleted
            FROM business_records_v3
            WHERE workspace_id=%s AND warehouse_id=%s AND environment='live'
              AND entity_type='warehouse' AND entity_id=%s
            FOR UPDATE
            """,
            (workspace_id, warehouse_id, warehouse_id),
        )
        warehouse_row = cur.fetchone()
        if not warehouse_row or bool(warehouse_row[2]):
            raise ApiError(409, "warehouse_deleted", "Склад уже удалён или отсутствует в реестре")
        current_version = int(warehouse_row[0])
        payload = warehouse_row[1] if isinstance(warehouse_row[1], dict) else {}
        if current_version != base_version:
            raise ApiError(
                409,
                "entity_version_conflict",
                "Версия склада изменилась до подготовки удаления",
                {"entity_type": "warehouse", "entity_id": warehouse_id, "current_version": current_version},
            )
        if payload.get("status") != "archived":
            raise ApiError(409, "warehouse_delete_requires_archived", "Активный склад удалить нельзя: сначала переведите его в архив")
        current_code = str(payload.get("code", "")).strip().upper()
        if not WAREHOUSE_CODE_RE.fullmatch(current_code) or not hmac.compare_digest(
            current_code.encode("utf-8"), warehouse_code.encode("utf-8")
        ):
            raise ApiError(409, "warehouse_delete_prepare_mismatch", "Код склада изменился до подготовки удаления")

        prepare_warehouse_delete_lease(authorization, workspace_id, warehouse_id, warehouse_code, lease_token)
        if operation:
            return _warehouse_delete_prepare_result(operation, True)

        cur.execute(
            """
            INSERT INTO warehouse_delete_operations_v3
              (workspace_id, warehouse_id, environment, command_id, warehouse_code,
               base_version, status, actor_id, device_id)
            VALUES (%s,%s,'live',%s,%s,%s,'prepared',%s,%s)
            RETURNING prepared_at
            """,
            (workspace_id, warehouse_id, command_id, warehouse_code, base_version, actor_id, device_id),
        )
        prepared_at = cur.fetchone()[0]
        return _warehouse_delete_prepare_result(
            (command_id, warehouse_code, base_version, "prepared", actor_id, device_id, prepared_at, None, None),
            False,
        )


def require_workspace(auth: dict, workspace_id: str) -> None:
    if not hmac.compare_digest(str(auth["company_id"]), workspace_id):
        raise ApiError(403, "workspace_mismatch", "Данные другой компании недоступны")


def require_global_warehouse_delete_access(auth: dict) -> None:
    permissions = {str(value) for value in auth.get("permissions", set())}
    global_access = auth.get("role") == "owner" or "*" in permissions or "jf.warehouse:*" in permissions
    if not global_access or not permission_allowed(auth, "warehouses.manage"):
        raise ApiError(403, "warehouse_delete_access_denied", "Нет глобального права удалять склады")


def require_local_migration_import_access(auth: dict) -> None:
    permissions = {str(value) for value in auth.get("permissions", set())}
    owner = auth.get("role") == "owner" and auth.get("legacy") is not True
    all_warehouses = "*" in permissions or "jf.warehouse:*" in permissions
    manages_warehouses = (
        "*" in permissions
        or "warehouses.manage" in permissions
        or "warehouses.*" in permissions
    )
    if not owner or not all_warehouses or not manages_warehouses:
        raise ApiError(
            403,
            "local_migration_access_denied",
            "Перенос локальной базы может выполнить только владелец с доступом ко всем складам",
        )


def validate_local_migration_import_request(
    intent: dict,
    auth: dict,
    warehouse_id: str,
    environment: str,
    changes: list[dict],
) -> None:
    require_local_migration_import_access(auth)
    if not hmac.compare_digest(str(intent.get("target_id", "")), warehouse_id):
        raise ApiError(
            409,
            "local_migration_scope_mismatch",
            "Пакет переноса относится к другому складу",
        )
    if environment != "live":
        raise ApiError(
            400,
            "local_migration_live_only",
            "Перенос локальной базы разрешён только в рабочую среду live",
        )
    if any(item["base_version"] != 0 or item["deleted"] for item in changes):
        raise ApiError(
            409,
            "local_migration_create_only",
            "Пакет переноса может только первично создать локальные записи",
        )


def warehouse_allowed(auth: dict, warehouse_id: str, snapshot: dict) -> bool:
    permissions = auth["permissions"]
    if auth["role"] == "owner" or "*" in permissions or "jf.warehouse:*" in permissions:
        return True
    if f"jf.warehouse:{warehouse_id}" in permissions:
        return True
    warehouse = snapshot.get("warehouse", {}) if isinstance(snapshot, dict) else {}
    code = str(warehouse.get("code", "")).strip().upper()
    return bool(WAREHOUSE_CODE_RE.fullmatch(code)) and code in canonical_warehouse_code_permissions(auth)


def permission_allowed(auth: dict, permission: str) -> bool:
    permissions = auth["permissions"]
    domain = permission.partition(".")[0]
    return (
        auth["role"] == "owner"
        or "*" in permissions
        or permission in permissions
        or f"{domain}.*" in permissions
    )


def entity_permission_allowed(auth: dict, entity_type: str, write: bool) -> bool:
    permissions = ENTITY_PERMISSION_MAP.get(entity_type)
    if not permissions:
        return False
    if entity_type in WAREHOUSE_SCOPE_READABLE_ENTITY_TYPES and not write:
        return True
    read_permission, write_permissions = permissions
    if write:
        return any(permission_allowed(auth, permission) for permission in write_permissions)
    return permission_allowed(auth, read_permission) or any(
        permission_allowed(auth, permission) for permission in write_permissions
    )


def require_entity_permission(auth: dict, entity_type: str, write: bool) -> None:
    if entity_permission_allowed(auth, entity_type, write):
        return
    action = "изменять" if write else "просматривать"
    raise ApiError(
        403,
        "entity_access_denied",
        f"Нет права {action} раздел {entity_type}",
        {"entity_type": entity_type, "write": write},
    )


def changed_payload_fields(current: dict | None, proposed: dict | None) -> set[str]:
    before = current if isinstance(current, dict) else {}
    after = proposed if isinstance(proposed, dict) else {}
    return {key for key in set(before) | set(after) if before.get(key) != after.get(key)}


def order_items_without_pricing(value: object) -> object:
    if not isinstance(value, list):
        return value
    return [
        {key: item[key] for key in sorted(item) if key not in ORDER_ITEM_PRICING_FIELDS}
        if isinstance(item, dict)
        else item
        for item in value
    ]


def order_item_pricing_view(value: object) -> object:
    if not isinstance(value, list):
        return value
    identity = {"productId", "article", "name"}
    return [
        {key: item[key] for key in sorted(item) if key in ORDER_ITEM_PRICING_FIELDS | identity}
        if isinstance(item, dict)
        else item
        for item in value
    ]


def require_field_permissions(auth: dict, entity_type: str, fields: set[str], required: set[str]) -> None:
    missing = sorted(permission for permission in required if not permission_allowed(auth, permission))
    if not missing:
        return
    raise ApiError(
        403,
        "entity_field_access_denied",
        f"Нет права изменять поля раздела {entity_type}",
        {"entity_type": entity_type, "fields": sorted(fields), "required_permissions": missing},
    )


def validate_intent_entity_fields(
    auth: dict,
    item: dict,
    current: dict | None,
    intent: dict,
) -> None:
    kind, entity_type = intent["kind"], item["type"]
    changed = changed_payload_fields(current, item.get("payload"))
    if not item["deleted"] and current and changed & ENTITY_IMMUTABLE_FIELDS:
        raise ApiError(409, "immutable_entity_field", "Нельзя изменить идентификатор или принадлежность записи")
    if item["deleted"]:
        allowed_deletes = {
            "route_cancel": {"routePlans", "routeLocks", "routeCatalog", "routeDriverAssignments", "routeOverrides", "manualRouteSequences"},
            "route_close": {"routeExecutions", "routePlans", "routeLocks", "routeAssignments", "routeCatalog", "routeDriverAssignments", "warehouseReservations"},
            "pickup_collected": {"warehouseReservations"},
        }
        if entity_type in allowed_deletes.get(kind, set()):
            return
    elif current is None:
        allowed_creates = {
            "route_approve": {"routeLocks"},
            "route_start": {"routeExecutions"},
            "route_close": {"routeArchives", "inventoryMovements"},
            "pickup_ready": {"warehouseReservations"},
            "pickup_collected": {"inventoryMovements"},
        }
        if entity_type in allowed_creates.get(kind, set()):
            return
    else:
        allowed_fields: set[str] = set()
        if entity_type == "orders":
            allowed_fields = INTENT_ORDER_FIELDS
        elif entity_type == "routePlans":
            allowed_fields = INTENT_PLAN_FIELDS.get(kind, set())
        elif entity_type == "routeExecutions" and kind == "route_return":
            allowed_fields = {"status", "returnedAt", "actualKm", "note"}
        elif entity_type == "routeAssignments" and kind == "route_cancel":
            allowed_fields = {"__jf_wrapped_value", "value"}
        if changed <= allowed_fields:
            return
    raise ApiError(
        403,
        "intent_field_access_denied",
        "Критическая команда пытается изменить данные вне своего назначения",
        {"kind": kind, "entity_type": entity_type, "entity_id": item["id"], "fields": sorted(changed)},
    )


def validate_entity_field_permissions(
    auth: dict,
    item: dict,
    current: dict | None,
    current_deleted: bool,
    intent: dict | None,
) -> None:
    entity_type = item["type"]
    current_payload = current if isinstance(current, dict) and not current_deleted else None
    changed = changed_payload_fields(current_payload, item.get("payload"))
    if not item["deleted"] and current_payload and changed & ENTITY_IMMUTABLE_FIELDS:
        raise ApiError(
            409,
            "immutable_entity_field",
            "Нельзя изменить идентификатор, склад, среду или дату создания записи",
            {"entity_type": entity_type, "entity_id": item["id"], "fields": sorted(changed & ENTITY_IMMUTABLE_FIELDS)},
        )
    if intent and intent["kind"] == LOCAL_MIGRATION_INTENT_KIND:
        if item["deleted"] or item.get("base_version") != 0 or current is not None or current_deleted:
            raise ApiError(
                409,
                "local_migration_create_only",
                "Пакет переноса может только первично создать локальные записи",
            )
        return
    if intent and entity_type in ENTITY_INTENT_TYPES[intent["kind"]]:
        validate_intent_entity_fields(auth, item, current_payload, intent)
        return
    if entity_type in {"routeExecutions", "routeArchives", "warehouseReservations"}:
        raise ApiError(403, "server_intent_required", "Эта запись изменяется только подтверждённой серверной командой")
    if auth["role"] == "owner" or "*" in auth["permissions"]:
        return

    if entity_type == "orders":
        if item["deleted"]:
            require_field_permissions(auth, entity_type, changed, {"orders.delete"})
            return
        if current_payload is None:
            require_field_permissions(auth, entity_type, changed, {"orders.create"})
            return
        required: set[str] = set()
        substantive = changed - ENTITY_AUXILIARY_FIELDS - {"items"}
        if substantive & ORDER_STATUS_FIELDS:
            required.add("orders.status")
        if substantive & ORDER_PAYMENT_FIELDS:
            required.add("orders.payment")
        if substantive & ORDER_PRICING_FIELDS:
            required.add("orders.pricing")
        known = ORDER_STATUS_FIELDS | ORDER_PAYMENT_FIELDS | ORDER_PRICING_FIELDS
        if substantive - known:
            required.add("orders.update")
        if "items" in changed:
            before_items, after_items = current_payload.get("items"), item["payload"].get("items")
            if order_items_without_pricing(before_items) != order_items_without_pricing(after_items):
                required.add("orders.update")
            if order_item_pricing_view(before_items) != order_item_pricing_view(after_items):
                required.add("orders.pricing")
        if not required and changed:
            required.add("orders.update")
        require_field_permissions(auth, entity_type, changed, required)
        return

    if entity_type == "products":
        if item["deleted"]:
            require_field_permissions(auth, entity_type, changed, {"inventory.delete"})
            return
        if current_payload is None:
            require_field_permissions(auth, entity_type, changed, {"inventory.catalog"})
            return
        substantive = changed - ENTITY_AUXILIARY_FIELDS
        required = set()
        if substantive & PRODUCT_PRICING_FIELDS:
            required.add("inventory.pricing")
        if substantive & PRODUCT_STOCK_FIELDS:
            required.add("inventory.stock")
        if substantive - PRODUCT_PRICING_FIELDS - PRODUCT_STOCK_FIELDS:
            required.add("inventory.catalog")
        if not required and changed:
            required.add("inventory.catalog")
        require_field_permissions(auth, entity_type, changed, required)
        return

    if entity_type == "inventoryMovements":
        if item["deleted"]:
            raise ApiError(409, "inventory_ledger_immutable", "Складские движения не удаляются; создайте обратную операцию")
        require_field_permissions(auth, entity_type, changed, {"inventory.stock"})
        return

    if entity_type == "drivers":
        permission = "drivers.delete" if item["deleted"] else "drivers.update"
        require_field_permissions(auth, entity_type, changed, {permission})
        return

    if entity_type == "reportingData":
        if item["deleted"]:
            raise ApiError(409, "singleton_delete_denied", "Раздел отчётности нельзя удалить целиком")
        required = set()
        if "settings" in changed:
            required.add("reports.settings")
        if changed & {"employees", "expenses"}:
            required.add("reports.expenses")
        if changed - {"settings", "employees", "expenses"}:
            raise ApiError(409, "unknown_reporting_field", "Отчётность содержит неизвестные поля")
        require_field_permissions(auth, entity_type, changed, required)
        return

    if entity_type == "settings":
        if item["deleted"]:
            raise ApiError(409, "singleton_delete_denied", "Настройки склада нельзя удалить целиком")
        required = set()
        if changed & SETTINGS_WAREHOUSE_FIELDS:
            required.add("warehouses.manage")
        if changed & SETTINGS_ROUTE_FIELDS:
            required.add("routes.settings")
        if changed & SETTINGS_INTEGRATION_FIELDS:
            required.add("integrations.manage")
        unknown = changed - SETTINGS_WAREHOUSE_FIELDS - SETTINGS_ROUTE_FIELDS - SETTINGS_INTEGRATION_FIELDS
        if unknown:
            raise ApiError(409, "unknown_settings_field", "Настройки содержат неизвестные поля", {"fields": sorted(unknown)})
        require_field_permissions(auth, entity_type, changed, required)
        return

    direct_permissions = {
        "warehouse": "warehouses.manage",
        "company": "company.update",
        "routePlans": "routes.plan",
        "routeAssignments": "routes.plan",
        "routeCatalog": "routes.plan",
        "routeDriverAssignments": "drivers.assign",
        "routeLocks": "routes.plan",
        "routeOverrides": "routes.settings",
        "manualRouteSequences": "routes.plan",
    }
    permission = direct_permissions.get(entity_type)
    if not permission:
        raise ApiError(403, "entity_access_denied", f"Изменение раздела {entity_type} не разрешено")
    require_field_permissions(auth, entity_type, changed, {permission})


def entity_payload_digest(payload: dict | None, deleted: bool = False) -> str:
    stable = None if deleted else payload
    encoded = json.dumps(stable, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def normalize_client_immutable_fields(item: dict, current: dict | None) -> dict:
    """Keep server-owned immutable metadata canonical on ordinary updates.

    Record identity is validated against the route scope before this point.  A
    client may legitimately carry an old ``createdAt`` generated before the
    first row upload, while the server may already have canonicalized a legacy
    row timestamp.  That metadata mismatch must not block updates to mutable
    business fields.  ``createdAt`` is therefore always copied from the
    authoritative row; identity and scope fields remain strictly validated.
    """
    if item.get("deleted") or not isinstance(current, dict) or not isinstance(item.get("payload"), dict):
        return item
    payload = dict(item["payload"])
    for field in ENTITY_IMMUTABLE_FIELDS - {"createdAt"}:
        if field not in payload and field in current:
            payload[field] = current[field]
    if "createdAt" in current:
        payload["createdAt"] = current["createdAt"]
    if payload != item["payload"]:
        item["payload"] = payload
        item["digest_sha256"] = entity_payload_digest(payload)
    return item


def canonical_entity_payload(
    entity_type: str,
    entity_id: str,
    payload: dict | None,
    warehouse_id: str,
    environment: str,
    created_at: object | None = None,
) -> dict | None:
    """Bind JSON identity to the authoritative entity-row scope."""
    if not isinstance(payload, dict):
        return payload
    canonical = dict(payload)
    if entity_type == "warehouse":
        canonical["id"] = warehouse_id
        canonical["environment"] = environment
    elif entity_type in ENTITY_ARRAYS:
        canonical["id"] = entity_id
        canonical["warehouseId"] = warehouse_id
    if entity_type in ENTITY_CANONICAL_RECORD_TYPES and not canonical.get("createdAt") and created_at:
        canonical["createdAt"] = created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)
    return canonical


def validate_entity_change(change: object, warehouse_id: str, environment: str) -> dict:
    if not isinstance(change, dict):
        raise ApiError(400, "invalid_entity_change", "Изменение сущности должно быть объектом")
    entity_type = str(change.get("type", ""))
    entity_id = str(change.get("id", ""))
    if entity_type not in ENTITY_SECTIONS or not ENTITY_TYPE_RE.fullmatch(entity_type):
        raise ApiError(400, "invalid_entity_type", "Неизвестный тип сущности")
    if not ENTITY_ID_RE.fullmatch(entity_id):
        raise ApiError(400, "invalid_entity_id", "Идентификатор сущности имеет неверный формат")
    base_version = change.get("base_version")
    if isinstance(base_version, bool) or not isinstance(base_version, int) or base_version < 0:
        raise ApiError(400, "base_version_required", "Требуется целая неотрицательная base_version")
    deleted = change.get("deleted") is True
    payload = change.get("payload")
    if deleted:
        payload = None
    elif not isinstance(payload, dict):
        raise ApiError(400, "invalid_entity_payload", "Данные сущности должны быть объектом")
    if entity_type == "warehouse" and entity_id != warehouse_id:
        raise ApiError(409, "warehouse_mismatch", "Карточка склада относится к другому складу")
    if payload:
        declared_id = str(payload.get("id", ""))
        if declared_id and declared_id != entity_id:
            raise ApiError(409, "entity_id_mismatch", "Данные содержат другой идентификатор сущности")
        declared_warehouse = str(payload.get("warehouseId", payload.get("warehouse_id", "")))
        if declared_warehouse and declared_warehouse != warehouse_id:
            raise ApiError(409, "warehouse_mismatch", "Сущность относится к другому складу")
        declared_environment = str(payload.get("environment", "")).lower()
        if declared_environment and declared_environment != environment:
            raise ApiError(409, "environment_mismatch", "Сущность относится к другой среде")
    if entity_type == "warehouse" and not deleted:
        warehouse_code = str(payload.get("code", "")).strip().upper()
        if not WAREHOUSE_CODE_RE.fullmatch(warehouse_code):
            raise ApiError(
                400,
                "invalid_warehouse_code",
                "Код склада должен содержать от 1 до 3 заглавных букв или цифр",
            )
        payload = dict(payload)
        payload["code"] = warehouse_code
    payload = canonical_entity_payload(entity_type, entity_id, payload, warehouse_id, environment)
    return {
        "type": entity_type,
        "id": entity_id,
        "base_version": base_version,
        "deleted": deleted,
        "payload": payload,
        "digest_sha256": entity_payload_digest(payload, deleted),
    }


def warehouse_registry_snapshot(workspace_id: str, environment: str, auth: dict) -> dict:
    with db_connect() as conn, conn.cursor() as cur:
        set_database_scope(cur, workspace_id, "live", auth)
        cur.execute(
            """
            SELECT warehouse_id, version, payload_sha256, payload, last_event_id, updated_at
            FROM business_records_v3
            WHERE workspace_id=%s AND environment=%s
              AND entity_type='warehouse' AND is_deleted=false
            ORDER BY updated_at DESC
            """,
            (workspace_id, "live"),
        )
        entity_rows = cur.fetchall()
        cur.execute(
            """
            SELECT EXISTS(
              SELECT 1
              FROM business_records_v3
              WHERE workspace_id=%s AND environment='live' AND entity_type='warehouse'
            )
            """,
            (workspace_id,),
        )
        registry_initialized = bool(cur.fetchone()[0])
    warehouses = []
    for warehouse_id, version, digest, meta, event_id, updated_at in entity_rows:
        warehouse_id = str(warehouse_id)
        snapshot = {"warehouse": meta, "data": {"warehouseId": warehouse_id}}
        if not isinstance(meta, dict) or not warehouse_allowed(auth, warehouse_id, snapshot):
            continue
        warehouses.append(
            {
                "id": warehouse_id,
                "code": str(meta.get("code", ""))[:32],
                "name": str(meta.get("name", "Склад"))[:160],
                "address": str(meta.get("address", ""))[:500],
                "lat": meta.get("lat"),
                "lon": meta.get("lon"),
                "timezone": str(meta.get("timezone", "Europe/Moscow"))[:80],
                "status": "archived" if meta.get("status") == "archived" else "active",
                "catalog_mode": "empty" if meta.get("catalogMode") == "empty" else "catalog",
                "revision": 0,
                "entity_version": int(version),
                "change_cursor": int(event_id),
                "digest_sha256": str(digest),
                "updated_at": updated_at.isoformat(),
                "sync_mode": "server_authoritative_v3",
            }
        )
    return {
        "warehouses": sorted(warehouses, key=lambda item: item["updated_at"], reverse=True),
        "registry_initialized": registry_initialized,
    }


def list_warehouses(workspace_id: str, environment: str, auth: dict) -> list[dict]:
    return warehouse_registry_snapshot(workspace_id, environment, auth)["warehouses"]


def load_entity_access_snapshot(workspace_id: str, warehouse_id: str, environment: str, auth: dict) -> dict | None:
    with db_connect() as conn, conn.cursor() as cur:
        set_database_scope(cur, workspace_id, "live", auth)
        cur.execute(
            """
            SELECT payload, is_deleted
            FROM business_records_v3
            WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
              AND entity_type='warehouse' AND entity_id=%s
            """,
            (workspace_id, warehouse_id, "live", warehouse_id),
        )
        row = cur.fetchone()
        if row:
            return {
                "warehouse": row[0] if isinstance(row[0], dict) else {},
                "data": {"warehouseId": warehouse_id},
                "deleted": bool(row[1]),
            }
    return None


def validate_entity_intent(raw_intent: object, changes: list[dict]) -> dict | None:
    if raw_intent in (None, {}):
        return None
    if not isinstance(raw_intent, dict):
        raise ApiError(400, "invalid_entity_intent", "Назначение команды должно быть объектом")
    kind = str(raw_intent.get("kind", ""))
    target_id = str(raw_intent.get("target_id", ""))
    if kind not in ENTITY_INTENT_KINDS or not ENTITY_ID_RE.fullmatch(target_id):
        raise ApiError(400, "invalid_entity_intent", "Неизвестное назначение серверной команды")
    if kind == LOCAL_MIGRATION_INTENT_KIND:
        if set(raw_intent) != {"kind", "target_id", "metadata"}:
            raise ApiError(400, "invalid_local_migration_metadata", "Метаданные пакета переноса имеют неверный формат")
        metadata = raw_intent.get("metadata")
        if not isinstance(metadata, dict) or set(metadata) != {
            "snapshot_fingerprint",
            "chunk_index",
            "chunk_count",
        }:
            raise ApiError(400, "invalid_local_migration_metadata", "Метаданные пакета переноса имеют неверный формат")
        snapshot_fingerprint = metadata.get("snapshot_fingerprint")
        chunk_index = metadata.get("chunk_index")
        chunk_count = metadata.get("chunk_count")
        valid_chunks = (
            type(chunk_index) is int
            and type(chunk_count) is int
            and 1 <= chunk_count <= LOCAL_MIGRATION_MAX_CHUNKS
            and 0 <= chunk_index < chunk_count
        )
        if (
            not isinstance(snapshot_fingerprint, str)
            or not LOCAL_MIGRATION_FINGERPRINT_RE.fullmatch(snapshot_fingerprint)
            or not valid_chunks
        ):
            raise ApiError(400, "invalid_local_migration_metadata", "Метаданные пакета переноса имеют неверный формат")
        return {
            "kind": kind,
            "target_id": target_id,
            "metadata": {
                "snapshot_fingerprint": snapshot_fingerprint,
                "chunk_index": chunk_index,
                "chunk_count": chunk_count,
            },
        }
    indexed = {(item["type"], item["id"]): item for item in changes}

    def changed(entity_type: str, entity_id: str = target_id) -> dict | None:
        return indexed.get((entity_type, entity_id))

    def payload(entity_type: str, entity_id: str = target_id) -> dict:
        item = changed(entity_type, entity_id)
        value = item.get("payload") if item and not item.get("deleted") else None
        return value if isinstance(value, dict) else {}

    order_payloads = [
        item.get("payload")
        for item in changes
        if item["type"] == "orders" and not item.get("deleted") and isinstance(item.get("payload"), dict)
    ]
    plan_change = changed("routePlans")
    plan_payload = payload("routePlans")
    execution = changed("routeExecutions")
    execution_payload = payload("routeExecutions")
    if kind == "route_approve":
        approval = plan_payload.get("manualApproval") if isinstance(plan_payload.get("manualApproval"), dict) else {}
        if not plan_change or plan_change.get("deleted") or plan_payload.get("lifecycleStatus") != "ready_to_release":
            raise ApiError(409, "invalid_route_transition", "Согласование должно перевести рейс в состояние «Готов к выпуску»")
        if approval.get("approved") is not True or not str(approval.get("note") or "").strip() or str(approval.get("reviewFingerprint") or "") != str(plan_payload.get("reviewFingerprint") or ""):
            raise ApiError(409, "route_approval_invalid", "Согласование не содержит причины или относится к старой версии рейса")
    elif kind == "route_cancel":
        if not plan_change or plan_change.get("deleted") is not True:
            raise ApiError(409, "invalid_route_transition", "Отмена рейса должна удалить активный маршрутный лист")
        if not order_payloads or any(order.get("fulfillmentStatus") != "active" or order.get("warehouseFlowStatus") != "planned" for order in order_payloads):
            raise ApiError(409, "invalid_route_transition", "Отмена рейса должна вернуть все заказы в распределение")
    elif kind == "route_picking":
        if not plan_change or plan_change.get("deleted") or plan_payload.get("lifecycleStatus") != "loading":
            raise ApiError(409, "invalid_route_transition", "Начало комплектации должно перевести рейс в состояние «Погрузка»")
        if not order_payloads or any(order.get("fulfillmentStatus") != "picking" or order.get("warehouseFlowStatus") != "picking" for order in order_payloads):
            raise ApiError(409, "invalid_route_transition", "Все заказы рейса должны перейти в комплектацию одной командой")
    elif kind == "route_start":
        if not execution or execution.get("deleted") or execution_payload.get("status") != "in_transit":
            raise ApiError(409, "invalid_route_transition", "Команда выезда не переводит рейс в состояние «В пути»")
        if not plan_change or plan_change.get("deleted") or plan_payload.get("lifecycleStatus") != "in_transit":
            raise ApiError(409, "invalid_route_transition", "Маршрутный лист не переведён в состояние «В пути»")
        readiness = execution_payload.get("readinessSnapshot")
        readiness_checks = readiness.get("checks") if isinstance(readiness, dict) else None
        if not isinstance(readiness_checks, list) or not readiness_checks or any(not isinstance(check, dict) or check.get("ok") is not True for check in readiness_checks):
            raise ApiError(409, "route_not_ready", "Выезд запрещён: обязательные проверки рейса не подтверждены")
        if not order_payloads or any(order.get("fulfillmentStatus") != "in_transit" for order in order_payloads):
            raise ApiError(409, "invalid_route_transition", "Все заказы рейса должны перейти в состояние «В пути» одной командой")
    elif kind == "route_return":
        if not execution or execution.get("deleted") or execution_payload.get("status") != "awaiting_close":
            raise ApiError(409, "invalid_route_transition", "Возврат водителя должен перевести рейс в ожидание закрытия")
        if not plan_change or plan_change.get("deleted") or plan_payload.get("lifecycleStatus") != "awaiting_close":
            raise ApiError(409, "invalid_route_transition", "Маршрутный лист не переведён в ожидание закрытия")
        if order_payloads and any(order.get("fulfillmentStatus") != "awaiting_close" for order in order_payloads):
            raise ApiError(409, "invalid_route_transition", "Заказы возвращённого рейса имеют несогласованные статусы")
    elif kind == "route_close":
        archive = payload("routeArchives")
        if not execution or not execution.get("deleted") or archive.get("status") != "closed":
            raise ApiError(409, "invalid_route_transition", "Закрытие должно удалить активный рейс и создать архивную запись")
        allowed = {"delivered", "partial", "not_delivered"}
        if not order_payloads or any(order.get("fulfillmentStatus") not in allowed for order in order_payloads):
            raise ApiError(409, "invalid_route_transition", "Для каждой точки требуется итог доставки")
    elif kind == "pickup_ready":
        order = payload("orders")
        reservation = changed("warehouseReservations")
        if order.get("fulfillmentStatus") != "pickup_ready" or not reservation or reservation.get("deleted"):
            raise ApiError(409, "invalid_pickup_transition", "Подготовка самовывоза должна создать резерв товара")
    elif kind == "pickup_collected":
        order = payload("orders")
        reservation = changed("warehouseReservations")
        if order.get("fulfillmentStatus") != "pickup_collected" or not reservation or not reservation.get("deleted"):
            raise ApiError(409, "invalid_pickup_transition", "Выдача самовывоза должна снять резерв товара")
    return {"kind": kind, "target_id": target_id}


def validate_entity_intent_current(
    cur,
    workspace_id: str,
    warehouse_id: str,
    environment: str,
    intent: dict | None,
    changes: list[dict] | None = None,
    auth: dict | None = None,
) -> None:
    if not intent:
        return
    if intent["kind"] == LOCAL_MIGRATION_INTENT_KIND:
        return
    kind, target_id = intent["kind"], intent["target_id"]
    indexed = {(item["type"], item["id"]): item for item in changes or []}

    def load_current(entity_type: str, entity_id: str) -> dict | None:
        cur.execute(
            """
            SELECT payload, is_deleted
            FROM business_records_v3
            WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
              AND entity_type=%s AND entity_id=%s
            FOR UPDATE
            """,
            (workspace_id, warehouse_id, environment, entity_type, entity_id),
        )
        row = cur.fetchone()
        return row[0] if row and not bool(row[1]) and isinstance(row[0], dict) else None

    def proposed(entity_type: str, entity_id: str) -> dict | None:
        change = indexed.get((entity_type, entity_id))
        if change:
            return None if change.get("deleted") else change.get("payload") if isinstance(change.get("payload"), dict) else None
        return load_current(entity_type, entity_id)

    def unwrapped(value: dict | None) -> object:
        return value.get("value") if isinstance(value, dict) and value.get("__jf_wrapped_value") is True else value

    entity_type = "routePlans" if kind in {"route_approve", "route_picking", "route_cancel"} else "routeExecutions" if kind.startswith("route_") else "orders"
    current = load_current(entity_type, target_id)
    status_field = "lifecycleStatus" if entity_type == "routePlans" else "status" if entity_type == "routeExecutions" else "fulfillmentStatus"
    current_status = str(current.get(status_field, "")) if current else ""
    expected = {
        "route_approve": {"needs_decision"},
        "route_picking": {"", "ready_to_release"},
        "route_cancel": {"ready_to_release", "loading"},
        "route_start": {""},
        "route_return": {"in_transit"},
        "route_close": {"awaiting_close"},
        "pickup_ready": {"active"},
        "pickup_collected": {"pickup_ready"},
    }[kind]
    if current_status not in expected:
        raise ApiError(
            409,
            "invalid_entity_state",
            "Операция отклонена: состояние объекта уже изменилось на другом компьютере",
            {"kind": kind, "target_id": target_id, "current_status": current_status or "missing"},
        )
    if kind == "route_approve":
        plan = proposed("routePlans", target_id)
        approval = plan.get("manualApproval") if isinstance(plan, dict) and isinstance(plan.get("manualApproval"), dict) else {}
        order_ids = [str(value) for value in plan.get("orderedIds", [])] if isinstance(plan, dict) and isinstance(plan.get("orderedIds"), list) else []
        if not isinstance(plan, dict) or plan.get("finalized") is not True or plan.get("lifecycleStatus") != "ready_to_release" or not order_ids:
            raise ApiError(409, "route_approval_invalid", "Согласование не завершило проверку маршрутного листа")
        if approval.get("approved") is not True or not str(approval.get("note") or "").strip() or str(approval.get("reviewFingerprint") or "") != str(plan.get("reviewFingerprint") or ""):
            raise ApiError(409, "route_approval_invalid", "Согласование не содержит причины или относится к старой версии рейса")
        actor_id = str((auth or {}).get("user_id") or "")
        if actor_id and str(approval.get("approvedBy") or "") != actor_id:
            raise ApiError(403, "route_approval_actor_mismatch", "Согласование подписано другой учётной записью")
        for order_id in order_ids:
            previous_order = load_current("orders", order_id)
            if not isinstance(previous_order, dict) or previous_order.get("fulfillmentStatus") != "active":
                raise ApiError(409, "invalid_order_state", "Согласование запрещено: состояние одного из заказов уже изменилось")
            if str(unwrapped(proposed("routeLocks", order_id)) or "") != target_id:
                raise ApiError(409, "route_reservation_missing", "Согласование должно зафиксировать резерв каждого заказа")
    elif kind == "route_cancel":
        if not isinstance(current, dict):
            raise ApiError(409, "route_cancel_missing", "Отмена запрещена: маршрутный лист уже отсутствует")
        order_ids = [str(value) for value in current.get("orderedIds", [])] if isinstance(current.get("orderedIds"), list) else []
        changed_orders = {item["id"]: item["payload"] for item in changes or [] if item["type"] == "orders" and not item["deleted"] and isinstance(item.get("payload"), dict)}
        plan_release = indexed.get(("routePlans", target_id))
        if not order_ids or set(changed_orders) != set(order_ids) or not plan_release or plan_release.get("deleted") is not True:
            raise ApiError(409, "route_cancel_incomplete", "Отмена рейса должна одной командой освободить весь его состав")
        if any(order.get("fulfillmentStatus") != "active" or order.get("warehouseFlowStatus") != "planned" for order in changed_orders.values()):
            raise ApiError(409, "invalid_route_transition", "Заказы отменённого рейса не возвращены в распределение")
        if load_current("routeExecutions", target_id) is not None:
            raise ApiError(409, "route_already_started", "Отмена запрещена: машина уже выехала")
        for order_id in order_ids:
            previous_order = load_current("orders", order_id)
            if not isinstance(previous_order, dict) or previous_order.get("fulfillmentStatus") not in {"active", "picking"}:
                raise ApiError(409, "invalid_order_state", "Отмена запрещена: состояние одного из заказов уже изменилось")
            lock_release = indexed.get(("routeLocks", order_id))
            if not lock_release or lock_release.get("deleted") is not True:
                raise ApiError(409, "route_reservation_not_released", "Отмена рейса должна снять каждый складской резерв")
            assignment = unwrapped(proposed("routeAssignments", order_id))
            if assignment not in (None, "__unassigned__"):
                raise ApiError(409, "route_assignment_not_released", "Отмена рейса должна вернуть заказ в нераспределённые")
        if proposed("routeCatalog", target_id) is not None or proposed("routeDriverAssignments", target_id) is not None:
            raise ApiError(409, "route_state_not_cancelled", "Активные данные отменённого рейса удалены не полностью")
    elif kind == "route_picking":
        plan = proposed("routePlans", target_id)
        order_ids = [str(value) for value in plan.get("orderedIds", [])] if isinstance(plan, dict) and isinstance(plan.get("orderedIds"), list) else []
        changed_orders = {item["id"]: item["payload"] for item in changes or [] if item["type"] == "orders" and not item["deleted"] and isinstance(item.get("payload"), dict)}
        if not isinstance(plan, dict) or plan.get("finalized") is not True or not order_ids or set(changed_orders) != set(order_ids):
            raise ApiError(409, "route_picking_incomplete", "Комплектация запрещена: маршрутный лист или состав заказов не подтверждён")
        approval = plan.get("manualApproval") if isinstance(plan.get("manualApproval"), dict) else {}
        if plan.get("requiresManualApproval") is True and (approval.get("approved") is not True or str(approval.get("reviewFingerprint") or "") != str(plan.get("reviewFingerprint") or "")):
            raise ApiError(409, "route_approval_required", "Комплектация запрещена: решение по нестандартному грузу отсутствует или устарело")
        driver_id = str(unwrapped(proposed("routeDriverAssignments", target_id)) or "")
        driver = proposed("drivers", driver_id) if driver_id else None
        if not driver_id or not isinstance(driver, dict) or driver.get("active") is False:
            raise ApiError(409, "route_driver_missing", "Комплектация запрещена: активный водитель не назначен")
        for order_id in order_ids:
            previous_order = load_current("orders", order_id)
            if not isinstance(previous_order, dict) or previous_order.get("fulfillmentStatus") != "active":
                raise ApiError(409, "invalid_order_state", "Комплектация запрещена: состояние одного из заказов уже изменилось")
            if str(unwrapped(proposed("routeLocks", order_id)) or "") != target_id:
                raise ApiError(409, "route_reservation_missing", "Комплектация запрещена: резерв заказа отсутствует или относится к другому рейсу")
    elif kind == "route_start":
        execution = proposed("routeExecutions", target_id)
        order_ids = [str(value) for value in execution.get("orderIds", [])] if isinstance(execution, dict) and isinstance(execution.get("orderIds"), list) else []
        changed_orders = {item["id"]: item["payload"] for item in changes or [] if item["type"] == "orders" and not item["deleted"] and isinstance(item.get("payload"), dict)}
        if not order_ids or set(changed_orders) != set(order_ids):
            raise ApiError(409, "route_orders_incomplete", "Выезд запрещён: состав заказов рейса изменён не одной командой")
        if any(order.get("fulfillmentStatus") != "in_transit" or order.get("warehouseFlowStatus") != "loaded" for order in changed_orders.values()):
            raise ApiError(409, "invalid_route_transition", "Все заказы рейса должны быть переданы водителю одной командой")
        current_plan = load_current("routePlans", target_id)
        plan = proposed("routePlans", target_id)
        if not isinstance(current_plan, dict) or current_plan.get("lifecycleStatus") != "loading" or not isinstance(plan, dict) or plan.get("lifecycleStatus") != "in_transit":
            raise ApiError(409, "route_not_loaded", "Выезд запрещён: комплектация и погрузка рейса не подтверждены")
        if not isinstance(plan, dict) or plan.get("finalized") is not True:
            raise ApiError(409, "route_not_ready", "Выезд запрещён: маршрутный лист не принят")
        planned_ids = [str(value) for value in plan.get("orderedIds", [])] if isinstance(plan.get("orderedIds"), list) else []
        if set(planned_ids) != set(order_ids):
            raise ApiError(409, "route_plan_outdated", "Выезд запрещён: состав рассчитанного маршрута устарел")
        if plan.get("requiresManualApproval") is True:
            approval = plan.get("manualApproval") if isinstance(plan.get("manualApproval"), dict) else {}
            if approval.get("approved") is not True or str(approval.get("reviewFingerprint") or "") != str(plan.get("reviewFingerprint") or ""):
                raise ApiError(409, "route_approval_required", "Выезд запрещён: решение по нестандартному грузу отсутствует или устарело")
        warehouse = proposed("warehouse", warehouse_id)
        try:
            latitude, longitude = float(warehouse.get("lat")), float(warehouse.get("lon"))
        except (AttributeError, TypeError, ValueError):
            latitude, longitude = float("nan"), float("nan")
        if not isinstance(warehouse, dict) or not str(warehouse.get("address") or "").strip() or not math.isfinite(latitude) or not math.isfinite(longitude) or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            raise ApiError(409, "warehouse_point_missing", "Выезд запрещён: точка активного склада не подтверждена")
        driver_id = str(unwrapped(proposed("routeDriverAssignments", target_id)) or "")
        driver = proposed("drivers", driver_id) if driver_id else None
        if not driver_id or not isinstance(driver, dict) or driver.get("active") is False:
            raise ApiError(409, "route_driver_missing", "Выезд запрещён: активный водитель не назначен")
        for order_id in order_ids:
            previous_order = load_current("orders", order_id)
            if not isinstance(previous_order, dict) or previous_order.get("fulfillmentStatus") != "picking" or previous_order.get("warehouseFlowStatus") != "picking":
                raise ApiError(409, "invalid_order_state", "Выезд запрещён: состояние одного из заказов уже изменилось")
            geo = changed_orders[order_id].get("geo") if isinstance(changed_orders[order_id].get("geo"), dict) else {}
            try:
                order_latitude, order_longitude = float(geo.get("lat")), float(geo.get("lon"))
            except (TypeError, ValueError):
                order_latitude, order_longitude = float("nan"), float("nan")
            if not str(changed_orders[order_id].get("deliveryAddress") or "").strip() or not math.isfinite(order_latitude) or not math.isfinite(order_longitude) or not -90 <= order_latitude <= 90 or not -180 <= order_longitude <= 180:
                raise ApiError(409, "route_address_missing", "Выезд запрещён: адрес одной из точек не подтверждён")
            if str(unwrapped(proposed("routeLocks", order_id)) or "") != target_id:
                raise ApiError(409, "route_reservation_missing", "Выезд запрещён: резерв заказа отсутствует или относится к другому рейсу")
    elif kind == "route_return":
        order_ids = {str(value) for value in current.get("orderIds", [])} if isinstance(current, dict) and isinstance(current.get("orderIds"), list) else set()
        changed_orders = {item["id"]: item["payload"] for item in changes or [] if item["type"] == "orders" and not item["deleted"] and isinstance(item.get("payload"), dict)}
        if not order_ids or set(changed_orders) != order_ids or any(order.get("fulfillmentStatus") != "awaiting_close" for order in changed_orders.values()):
            raise ApiError(409, "route_return_incomplete", "Возврат машины должен перевести все точки рейса в ожидание закрытия")
        current_plan, next_plan = load_current("routePlans", target_id), proposed("routePlans", target_id)
        if not isinstance(current_plan, dict) or current_plan.get("lifecycleStatus") != "in_transit" or not isinstance(next_plan, dict) or next_plan.get("lifecycleStatus") != "awaiting_close":
            raise ApiError(409, "invalid_route_transition", "Возврат машины нарушает последовательность состояний рейса")
    elif kind == "route_close":
        order_ids = {str(value) for value in current.get("orderIds", [])} if isinstance(current, dict) and isinstance(current.get("orderIds"), list) else set()
        changed_orders = {item["id"]: item["payload"] for item in changes or [] if item["type"] == "orders" and not item["deleted"] and isinstance(item.get("payload"), dict)}
        if not order_ids or set(changed_orders) != order_ids:
            raise ApiError(409, "route_close_incomplete", "Закрытие рейса должно зафиксировать результат каждой точки")
        archive = proposed("routeArchives", target_id)
        outcomes = archive.get("outcomes") if isinstance(archive, dict) and isinstance(archive.get("outcomes"), list) else []
        if {str(item.get("orderId") or "") for item in outcomes if isinstance(item, dict)} != order_ids:
            raise ApiError(409, "route_archive_incomplete", "Архив рейса не содержит результат каждой точки")
        required_expense: dict[str, float] = {}
        for order_id, order in changed_orders.items():
            status, flow = str(order.get("fulfillmentStatus") or ""), str(order.get("warehouseFlowStatus") or "")
            if status not in {"delivered", "partial", "not_delivered"} or flow != ("shipped" if status == "delivered" else "returned"):
                raise ApiError(409, "invalid_route_result", "Итог доставки не согласован со складским состоянием")
            result = order.get("fulfillmentResult") if isinstance(order.get("fulfillmentResult"), dict) else {}
            for product_id, quantity in inventory_demand_from_items(result.get("deliveredItems")).items():
                product = proposed("products", product_id)
                if isinstance(product, dict) and product.get("stockTracked") is True:
                    required_expense[product_id] = required_expense.get(product_id, 0.0) + quantity
            for link_type in ("routeLocks", "routeAssignments"):
                release = indexed.get((link_type, order_id))
                if not release or release.get("deleted") is not True:
                    raise ApiError(409, "route_links_not_released", "Закрытие рейса должно снять все маршрутные резервы")
        actual_expense: dict[str, float] = {}
        for item in changes or []:
            movement = item.get("payload") if item["type"] == "inventoryMovements" and not item["deleted"] and isinstance(item.get("payload"), dict) else None
            if item["type"] != "inventoryMovements":
                continue
            if not movement or movement.get("type") != "expense" or safe_inventory_number(movement.get("delta")) >= 0:
                raise ApiError(409, "route_stock_movement_invalid", "Закрытие рейса может создать только расход по фактически доставленному товару")
            product_id = str(movement.get("productId") or "")
            actual_expense[product_id] = actual_expense.get(product_id, 0.0) - safe_inventory_number(movement.get("delta"))
        if set(actual_expense) != set(required_expense) or any(abs(actual_expense[key] - required_expense[key]) > 0.0005 for key in required_expense):
            raise ApiError(409, "route_stock_expense_mismatch", "Списание товара не соответствует фактически доставленным позициям")
        for route_type in ("routePlans", "routeDriverAssignments", "routeCatalog"):
            release = indexed.get((route_type, target_id))
            if not release or release.get("deleted") is not True:
                raise ApiError(409, "route_state_not_closed", "Активные данные закрытого рейса удалены не полностью")
    elif kind == "pickup_ready":
        order = proposed("orders", target_id)
        reservation = proposed("warehouseReservations", target_id)
        expected_lines = inventory_demand_from_items(order.get("items") if isinstance(order, dict) else None)
        actual_lines: dict[str, float] = {}
        for line in reservation.get("lines", []) if isinstance(reservation, dict) and isinstance(reservation.get("lines"), list) else []:
            if isinstance(line, dict):
                product_id = str(line.get("productId") or "")
                actual_lines[product_id] = actual_lines.get(product_id, 0.0) + max(0.0, safe_inventory_number(line.get("qty")))
        if set(actual_lines) != set(expected_lines) or any(abs(actual_lines[key] - expected_lines[key]) > 0.0005 for key in expected_lines):
            raise ApiError(409, "pickup_reservation_mismatch", "Резерв самовывоза не соответствует составу заказа")
    elif kind == "pickup_collected":
        order = proposed("orders", target_id)
        expected_expense: dict[str, float] = {}
        for product_id, quantity in inventory_demand_from_items(order.get("items") if isinstance(order, dict) else None).items():
            product = proposed("products", product_id)
            if isinstance(product, dict) and product.get("stockTracked") is True:
                expected_expense[product_id] = quantity
        actual_expense: dict[str, float] = {}
        for item in changes or []:
            movement = item.get("payload") if item["type"] == "inventoryMovements" and not item["deleted"] and isinstance(item.get("payload"), dict) else None
            if item["type"] != "inventoryMovements":
                continue
            if not movement or movement.get("type") != "expense" or safe_inventory_number(movement.get("delta")) >= 0:
                raise ApiError(409, "pickup_stock_movement_invalid", "Выдача самовывоза может создать только расход по выданному товару")
            product_id = str(movement.get("productId") or "")
            actual_expense[product_id] = actual_expense.get(product_id, 0.0) - safe_inventory_number(movement.get("delta"))
        if set(actual_expense) != set(expected_expense) or any(abs(actual_expense[key] - expected_expense[key]) > 0.0005 for key in expected_expense):
            raise ApiError(409, "pickup_stock_expense_mismatch", "Списание самовывоза не соответствует составу заказа")


def inventory_demand_from_items(items: object) -> dict[str, float]:
    demand: dict[str, float] = {}
    if not isinstance(items, list):
        return demand
    for item in items:
        if not isinstance(item, dict):
            continue
        quantity = max(0.0, safe_inventory_number(item.get("qty")))
        product_id = str(item.get("productId") or "")
        if product_id and quantity:
            demand[product_id] = demand.get(product_id, 0.0) + quantity
        composition = item.get("composition")
        if not isinstance(composition, list):
            continue
        for component in composition:
            if not isinstance(component, dict) or str(component.get("role") or "") != "polycarbonate":
                continue
            component_id = str(component.get("productId") or "")
            component_quantity = quantity * max(0.0, safe_inventory_number(component.get("qty")))
            if component_id and component_quantity:
                demand[component_id] = demand.get(component_id, 0.0) + component_quantity
    return demand


def safe_inventory_number(value: object) -> float:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return number if math.isfinite(number) else 0.0


def inventory_conflicts_from_entity_maps(entity_maps: dict[str, dict[str, dict]]) -> list[dict]:
    products = entity_maps.get("products", {})
    movements = entity_maps.get("inventoryMovements", {})
    orders = entity_maps.get("orders", {})
    locks = entity_maps.get("routeLocks", {})
    reservations = entity_maps.get("warehouseReservations", {})
    on_hand: dict[str, float] = {}
    names: dict[str, str] = {}
    tracked: set[str] = set()
    for product_id, product in products.items():
        if not isinstance(product, dict) or product.get("stockTracked") is not True:
            continue
        tracked.add(product_id)
        names[product_id] = str(product.get("name") or product_id)
        on_hand[product_id] = safe_inventory_number(product.get("openingStock"))
    for movement in movements.values():
        if not isinstance(movement, dict):
            continue
        product_id = str(movement.get("productId") or "")
        if product_id in tracked:
            on_hand[product_id] = on_hand.get(product_id, 0.0) + safe_inventory_number(movement.get("delta"))
    reserved: dict[str, float] = {}
    for order_id in locks:
        order = orders.get(order_id)
        if not isinstance(order, dict):
            continue
        for product_id, quantity in inventory_demand_from_items(order.get("items")).items():
            if product_id in tracked:
                reserved[product_id] = reserved.get(product_id, 0.0) + quantity
    for reservation in reservations.values():
        if not isinstance(reservation, dict):
            continue
        lines = reservation.get("lines")
        if not isinstance(lines, list):
            continue
        for line in lines:
            if not isinstance(line, dict):
                continue
            product_id = str(line.get("productId") or "")
            quantity = max(0.0, safe_inventory_number(line.get("qty")))
            if product_id in tracked and quantity:
                reserved[product_id] = reserved.get(product_id, 0.0) + quantity
    conflicts = []
    for product_id in sorted(tracked):
        physical = round(on_hand.get(product_id, 0.0), 3)
        committed = round(reserved.get(product_id, 0.0), 3)
        if physical < -0.0005 or committed > physical + 0.0005:
            conflicts.append(
                {
                    "product_id": product_id,
                    "product_name": names.get(product_id, product_id),
                    "on_hand": physical,
                    "reserved": committed,
                    "missing": round(max(0.0, committed - physical), 3),
                }
            )
    return conflicts


def validate_entity_inventory_current(
    cur,
    workspace_id: str,
    warehouse_id: str,
    environment: str,
    changes: list[dict],
    intent: dict | None,
) -> None:
    if not intent:
        return
    if intent["kind"] == LOCAL_MIGRATION_INTENT_KIND:
        return
    scope_lock = f"{workspace_id}:{warehouse_id}:{environment}"
    cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s), hashtext(%s))", (scope_lock, "stock-state"))
    relevant = ["products", "inventoryMovements", "orders", "routeLocks", "warehouseReservations"]
    cur.execute(
        """
        SELECT entity_type, entity_id, payload
        FROM business_records_v3
        WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
          AND entity_type=ANY(%s) AND is_deleted=false
        FOR UPDATE
        """,
        (workspace_id, warehouse_id, environment, relevant),
    )
    entity_maps: dict[str, dict[str, dict]] = {entity_type: {} for entity_type in relevant}
    for entity_type, entity_id, payload in cur.fetchall():
        if isinstance(payload, dict):
            entity_maps[str(entity_type)][str(entity_id)] = payload
    for change in changes:
        entity_type = change["type"]
        if entity_type not in entity_maps:
            continue
        if change["deleted"]:
            entity_maps[entity_type].pop(change["id"], None)
        elif isinstance(change["payload"], dict):
            entity_maps[entity_type][change["id"]] = change["payload"]
    conflicts = inventory_conflicts_from_entity_maps(entity_maps)
    if conflicts:
        raise ApiError(
            409,
            "inventory_reservation_conflict",
            "Операция отклонена: товара недостаточно с учётом резервов других сотрудников",
            {"products": conflicts},
        )


def require_entity_scope_access(
    auth: dict,
    workspace_id: str,
    warehouse_id: str,
    environment: str,
    proposed_warehouse: dict | None = None,
    allow_missing: bool = False,
    allow_global_without_snapshot: bool = False,
) -> None:
    snapshot = load_entity_access_snapshot(workspace_id, warehouse_id, environment, auth)
    if snapshot is not None and snapshot.get("deleted") is True:
        if allow_missing:
            return
        raise ApiError(409, "warehouse_deleted", "Склад удалён или отсутствует в реестре")
    if snapshot is None and isinstance(proposed_warehouse, dict):
        permissions = {str(value) for value in auth.get("permissions", set())}
        can_address_new_id = (
            auth.get("role") == "owner"
            or "*" in permissions
            or "jf.warehouse:*" in permissions
        )
        if can_address_new_id:
            snapshot = {"warehouse": proposed_warehouse, "data": {"warehouseId": warehouse_id}}
    if snapshot is None and allow_global_without_snapshot:
        permissions = {str(value) for value in auth.get("permissions", set())}
        if auth.get("role") == "owner" or "*" in permissions or "jf.warehouse:*" in permissions:
            return
    if snapshot is None:
        if allow_missing:
            return
        raise ApiError(403, "warehouse_access_denied", "Нет доступа к этому складу")
    if not warehouse_allowed(auth, warehouse_id, snapshot):
        raise ApiError(403, "warehouse_access_denied", "Нет доступа к этому складу")


def save_entity_batch(
    workspace_id: str,
    warehouse_id: str,
    environment: str,
    request: dict,
    auth: dict,
    authorization: str = "",
) -> dict:
    from psycopg2.extras import Json

    command_id = str(request.get("command_id", ""))
    if not COMMAND_ID_RE.fullmatch(command_id):
        raise ApiError(400, "command_id_required", "Для записи требуется безопасный уникальный command_id")
    raw_changes = request.get("changes")
    if not isinstance(raw_changes, list) or not raw_changes or len(raw_changes) > 1000:
        raise ApiError(400, "invalid_changes", "Передайте от 1 до 1000 изменений")
    changes = [validate_entity_change(item, warehouse_id, environment) for item in raw_changes]
    changes.sort(key=lambda item: (item["type"], item["id"]))
    keys = [(item["type"], item["id"]) for item in changes]
    if len(keys) != len(set(keys)):
        raise ApiError(400, "duplicate_entity", "Одна сущность указана в команде несколько раз")
    warehouse_changes = [item for item in changes if item["type"] == "warehouse"]
    if warehouse_changes and environment != "live":
        raise ApiError(
            400,
            "warehouse_registry_live_only",
            "Реестр складов изменяется только в рабочей среде live",
        )
    warehouse_delete = any(item["type"] == "warehouse" and item["deleted"] for item in changes)
    warehouse_delete_lease_token = str(request.get("warehouse_delete_lease_token", ""))
    warehouse_delete_declared_code = str(request.get("warehouse_delete_warehouse_code", ""))
    if warehouse_delete and (
        not WAREHOUSE_DELETE_LEASE_TOKEN_RE.fullmatch(warehouse_delete_lease_token)
        or warehouse_delete_declared_code != warehouse_delete_declared_code.strip().upper()
        or not WAREHOUSE_CODE_RE.fullmatch(warehouse_delete_declared_code)
    ):
        raise _warehouse_delete_lease_error(409, "WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED")
    if warehouse_delete and (len(changes) != 1 or changes[0]["type"] != "warehouse"):
        raise ApiError(
            400,
            "warehouse_delete_must_be_single_change",
            "Удаление склада должно быть отдельной командой",
        )
    intent = validate_entity_intent(request.get("intent"), changes)
    if intent and intent["kind"] == LOCAL_MIGRATION_INTENT_KIND:
        validate_local_migration_import_request(intent, auth, warehouse_id, environment, changes)
    proposed_warehouse = next(
        (item["payload"] for item in changes if item["type"] == "warehouse" and not item["deleted"]),
        None,
    )
    require_entity_scope_access(
        auth,
        workspace_id,
        warehouse_id,
        environment,
        proposed_warehouse,
        allow_missing=warehouse_delete,
    )
    intent_types: set[str] = set()
    if intent:
        if intent["kind"] == LOCAL_MIGRATION_INTENT_KIND:
            intent_types = set(ENTITY_SECTIONS)
        else:
            required_permission = ENTITY_INTENT_PERMISSIONS[intent["kind"]]
            if not permission_allowed(auth, required_permission):
                raise ApiError(403, "intent_access_denied", "Нет права выполнить этот переход состояния")
            intent_types = ENTITY_INTENT_TYPES[intent["kind"]]
    for item in changes:
        if item["type"] not in intent_types:
            require_entity_permission(auth, item["type"], write=True)

    actor_id = str(auth.get("user_id", ""))[:160] or "unknown-user"
    device_id = str(auth.get("device_id", ""))[:200]
    request_without_transport_secrets = {
        key: value
        for key, value in request.items()
        if key not in {"warehouse_delete_lease_token", "warehouse_delete_warehouse_code"}
    }
    request_sha256 = hashlib.sha256(
        json.dumps(request_without_transport_secrets, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    scope_lock = f"{workspace_id}:{warehouse_id}:{environment}"
    outcomes: list[dict] = []
    cascade_deleted = 0
    cascade_by_environment = {"live": 0, "demo": 0}
    cascade_types: list[str] = []
    cascade_cursors: dict[str, int] = {}
    history_payloads_redacted = 0
    telegram_deprovision = None
    release_outbox_exact_key: tuple[str, str, str] | None = None
    with db_connect() as conn, conn.cursor() as cur:
        set_database_scope(cur, workspace_id, environment, auth)
        # Every registry mutation owns both environments in a stable order.
        # Ordinary writes own their environment, so archive/delete is ordered
        # before or after every LIVE/DEMO business mutation without deadlocks.
        lock_environments = ("demo", "live") if warehouse_changes else (environment,)
        for lock_environment in lock_environments:
            lock_scope = f"{workspace_id}:{warehouse_id}:{lock_environment}"
            cur.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s), hashtext(%s))",
                (lock_scope, "entity-write-scope"),
            )
        set_database_scope(cur, workspace_id, "live", auth)
        delete_operation = _select_warehouse_delete_operation(cur, workspace_id, warehouse_id)
        set_database_scope(cur, workspace_id, environment, auth)
        if delete_operation:
            operation_command = str(delete_operation[0])
            operation_code = str(delete_operation[1])
            operation_version = int(delete_operation[2])
            operation_status = str(delete_operation[3])
            exact_final_delete = (
                warehouse_delete
                and environment == "live"
                and hmac.compare_digest(operation_command, command_id)
                and hmac.compare_digest(operation_code.encode("utf-8"), warehouse_delete_declared_code.encode("utf-8"))
                and changes[0]["base_version"] == operation_version
            )
            if operation_status == "completed":
                if exact_final_delete:
                    cur.execute(
                        """
                        SELECT result, request_sha256
                        FROM business_commands_v3
                        WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s AND command_id=%s
                        FOR UPDATE
                        """,
                        (workspace_id, warehouse_id, "live", command_id),
                    )
                    completed_command = cur.fetchone()
                    if completed_command and hmac.compare_digest(str(completed_command[1]), request_sha256):
                        stored_result = completed_command[0] if isinstance(completed_command[0], dict) else delete_operation[8]
                        if isinstance(stored_result, dict):
                            return {**stored_result, "replayed": True}
                    raise ApiError(409, "command_id_reused", "Идентификатор команды уже использован для другой операции")
                raise ApiError(409, "warehouse_delete_completed", "Удаление склада уже завершено; новые записи запрещены")
            if not exact_final_delete:
                raise ApiError(
                    409,
                    "warehouse_delete_prepared",
                    "Удаление склада подготовлено; разрешена только точная завершающая команда",
                    {"command_id": operation_command, "status": "prepared"},
                )
            telegram_deprovision = confirm_warehouse_telegram_deprovision(
                authorization,
                workspace_id,
                warehouse_id,
                operation_code,
                warehouse_delete_lease_token,
                operation_command,
                operation_version,
            )
        elif warehouse_delete:
            raise ApiError(
                409,
                "warehouse_delete_not_prepared",
                "Сначала зафиксируйте подготовку удаления склада на VPS",
            )
        cur.execute(
            """
            SELECT result, request_sha256
            FROM business_commands_v3
            WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s AND command_id=%s
            FOR UPDATE
            """,
            (workspace_id, warehouse_id, environment, command_id),
        )
        replay = cur.fetchone()
        if replay:
            if not hmac.compare_digest(str(replay[1]), request_sha256):
                raise ApiError(409, "command_id_reused", "Идентификатор команды уже использован для другой операции")
            stored = replay[0] if isinstance(replay[0], dict) else {}
            return {**stored, "replayed": True}

        set_database_scope(cur, workspace_id, "live", auth)
        cur.execute(
            """
            SELECT version, payload, is_deleted
            FROM business_records_v3
            WHERE workspace_id=%s AND warehouse_id=%s AND environment='live'
              AND entity_type='warehouse' AND entity_id=%s
            FOR UPDATE
            """,
            (workspace_id, warehouse_id, warehouse_id),
        )
        warehouse_row = cur.fetchone()
        set_database_scope(cur, workspace_id, environment, auth)
        warehouse_payload = warehouse_row[1] if warehouse_row and isinstance(warehouse_row[1], dict) else None
        warehouse_is_deleted = bool(warehouse_row[2]) if warehouse_row else False
        if warehouse_changes:
            warehouse_change = warehouse_changes[0]
            if warehouse_change["deleted"]:
                if warehouse_row and not warehouse_is_deleted and (warehouse_payload or {}).get("status") != "archived":
                    raise ApiError(
                        409,
                        "warehouse_delete_requires_archived",
                        "Активный склад удалить нельзя: сначала переведите его в архив",
                    )
                if not warehouse_row or warehouse_is_deleted:
                    raise ApiError(409, "warehouse_deleted", "Склад уже удалён или отсутствует в реестре")
                warehouse_code = str((warehouse_payload or {}).get("code", "")).strip().upper()
                if not WAREHOUSE_CODE_RE.fullmatch(warehouse_code):
                    raise ApiError(409, "invalid_warehouse_code", "Код удаляемого склада повреждён")
                if not hmac.compare_digest(
                    warehouse_code.encode("utf-8"),
                    warehouse_delete_declared_code.encode("utf-8"),
                ):
                    raise _warehouse_delete_lease_error(409, "WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED")
                verify_warehouse_delete_lease(
                    authorization,
                    workspace_id,
                    warehouse_id,
                    warehouse_code,
                    warehouse_delete_lease_token,
                    require_prepared=True,
                )
            elif warehouse_row and warehouse_is_deleted:
                raise ApiError(409, "warehouse_deleted", "Удалённый склад нельзя восстановить записью поверх tombstone")
            elif warehouse_row:
                current_code = str((warehouse_payload or {}).get("code", "")).strip().upper()
                proposed_code = str((warehouse_change.get("payload") or {}).get("code", "")).strip().upper()
                if not hmac.compare_digest(current_code.encode("utf-8"), proposed_code.encode("utf-8")):
                    raise ApiError(
                        409,
                        "warehouse_code_immutable",
                        "Код существующего склада нельзя изменять: он защищает права доступа",
                    )
        elif not warehouse_row or warehouse_is_deleted:
            raise ApiError(409, "warehouse_deleted", "Склад удалён или отсутствует в реестре")
        elif (warehouse_payload or {}).get("status") == "archived":
            raise ApiError(409, "warehouse_archived", "Архивный склад закрыт для изменения бизнес-данных")

        validate_entity_intent_current(cur, workspace_id, warehouse_id, environment, intent, changes, auth)
        validate_entity_inventory_current(cur, workspace_id, warehouse_id, environment, changes, intent)

        for item in changes:
            entity_lock = f"{item['type']}:{item['id']}"
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s), hashtext(%s))", (scope_lock, entity_lock))
            cur.execute(
                """
                SELECT version, payload_sha256, is_deleted, last_event_id, payload
                FROM business_records_v3
                WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
                  AND entity_type=%s AND entity_id=%s
                FOR UPDATE
                """,
                (workspace_id, warehouse_id, environment, item["type"], item["id"]),
            )
            current = cur.fetchone()
            if current:
                current_version, current_digest, current_deleted, current_event_id, current_payload = current
                if item["base_version"] != int(current_version):
                    raise ApiError(
                        409,
                        "entity_version_conflict",
                        f"Сущность {item['type']}/{item['id']} уже изменена другим сотрудником",
                        {
                            "entity_type": item["type"],
                            "entity_id": item["id"],
                            "current_version": int(current_version),
                            "current_digest_sha256": str(current_digest),
                        },
                    )
                normalize_client_immutable_fields(
                    item,
                    current_payload if isinstance(current_payload, dict) and not bool(current_deleted) else None,
                )
                validate_entity_field_permissions(
                    auth,
                    item,
                    current_payload if isinstance(current_payload, dict) else None,
                    bool(current_deleted),
                    intent,
                )
                if bool(current_deleted) == item["deleted"] and hmac.compare_digest(str(current_digest), item["digest_sha256"]):
                    outcomes.append(
                        {
                            "type": item["type"],
                            "id": item["id"],
                            "version": int(current_version),
                            "digest_sha256": str(current_digest),
                            "deleted": bool(current_deleted),
                            "event_id": int(current_event_id),
                            "unchanged": True,
                        }
                    )
                    continue
                new_version = int(current_version) + 1
            else:
                if item["base_version"] != 0:
                    raise ApiError(
                        409,
                        "entity_version_conflict",
                        f"Сущность {item['type']}/{item['id']} на сервере отсутствует",
                        {"entity_type": item["type"], "entity_id": item["id"], "current_version": 0},
                    )
                if item["deleted"]:
                    outcomes.append(
                        {
                            "type": item["type"],
                            "id": item["id"],
                            "version": 0,
                            "digest_sha256": item["digest_sha256"],
                            "deleted": True,
                            "event_id": 0,
                            "unchanged": True,
                        }
                    )
                    continue
                validate_entity_field_permissions(auth, item, None, False, intent)
                new_version = 1

            operation = "delete" if item["deleted"] else "upsert"
            cur.execute(
                """
                INSERT INTO business_events_v3
                  (workspace_id, warehouse_id, environment, entity_type, entity_id,
                   entity_version, operation, payload_sha256, payload, changed_by, device_id, command_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING event_id, created_at
                """,
                (
                    workspace_id,
                    warehouse_id,
                    environment,
                    item["type"],
                    item["id"],
                    new_version,
                    operation,
                    item["digest_sha256"],
                    None if item["deleted"] else Json(item["payload"]),
                    actor_id,
                    device_id,
                    command_id,
                ),
            )
            event_id, created_at = cur.fetchone()
            try:
                if current:
                    cur.execute(
                        """
                        UPDATE business_records_v3
                        SET version=%s, payload_sha256=%s, payload=%s, is_deleted=%s,
                            last_event_id=%s, updated_by=%s, device_id=%s, updated_at=now(),
                            deleted_at=CASE WHEN %s THEN now() ELSE NULL END
                        WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
                          AND entity_type=%s AND entity_id=%s
                        """,
                        (
                            new_version,
                            item["digest_sha256"],
                            None if item["deleted"] else Json(item["payload"]),
                            item["deleted"],
                            event_id,
                            actor_id,
                            device_id,
                            item["deleted"],
                            workspace_id,
                            warehouse_id,
                            environment,
                            item["type"],
                            item["id"],
                        ),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO business_records_v3
                          (workspace_id, warehouse_id, environment, entity_type, entity_id,
                           version, payload_sha256, payload, is_deleted, last_event_id,
                           created_by, updated_by, device_id)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,false,%s,%s,%s,%s)
                        """,
                        (
                            workspace_id,
                            warehouse_id,
                            environment,
                            item["type"],
                            item["id"],
                            new_version,
                            item["digest_sha256"],
                            Json(item["payload"]),
                            event_id,
                            actor_id,
                            actor_id,
                            device_id,
                        ),
                    )
            except Exception as exc:
                constraint_name = str(getattr(getattr(exc, "diag", None), "constraint_name", "") or "")
                if (
                    item["type"] == "warehouse"
                    and not item["deleted"]
                    and str(getattr(exc, "pgcode", "") or "") == "23505"
                    and constraint_name == WAREHOUSE_CODE_UNIQUE_INDEX
                ):
                    raise ApiError(
                        409,
                        "warehouse_code_conflict",
                        "Этот код уже используется другим складом",
                        {"code": str((item.get("payload") or {}).get("code", ""))},
                    ) from exc
                raise
            outcomes.append(
                {
                    "type": item["type"],
                    "id": item["id"],
                    "version": new_version,
                    "digest_sha256": item["digest_sha256"],
                    "deleted": item["deleted"],
                    "event_id": int(event_id),
                    "changed_at": created_at.isoformat(),
                    "unchanged": False,
                }
            )

        if warehouse_delete:
            delete_digest = entity_payload_digest(None, True)
            all_cascaded: list[tuple] = []
            for cascade_environment in ("live", "demo"):
                set_database_scope(cur, workspace_id, cascade_environment, auth)
                cur.execute(
                    """
                    WITH targets AS (
                      SELECT entity_type, entity_id, version + 1 AS entity_version
                      FROM business_records_v3
                      WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
                        AND is_deleted=false
                      ORDER BY entity_type, entity_id
                      FOR UPDATE
                    ), inserted_events AS (
                      INSERT INTO business_events_v3
                        (workspace_id, warehouse_id, environment, entity_type, entity_id,
                         entity_version, operation, payload_sha256, payload,
                         changed_by, device_id, command_id)
                      SELECT %s, %s, %s, entity_type, entity_id,
                             entity_version, 'delete', %s, NULL, %s, %s, %s
                      FROM targets
                      RETURNING event_id, entity_type, entity_id, entity_version
                    ), updated_records AS (
                      UPDATE business_records_v3 AS records
                      SET version=events.entity_version,
                          payload_sha256=%s,
                          payload=NULL,
                          is_deleted=true,
                          last_event_id=events.event_id,
                          updated_by=%s,
                          device_id=%s,
                          updated_at=now(),
                          deleted_at=now()
                      FROM inserted_events AS events
                      WHERE records.workspace_id=%s
                        AND records.warehouse_id=%s
                        AND records.environment=%s
                        AND records.entity_type=events.entity_type
                        AND records.entity_id=events.entity_id
                      RETURNING records.entity_type, records.entity_id,
                                records.version, records.last_event_id
                    )
                    SELECT entity_type, entity_id, version, last_event_id
                    FROM updated_records
                    ORDER BY entity_type, entity_id
                    """,
                    (
                        workspace_id,
                        warehouse_id,
                        cascade_environment,
                        workspace_id,
                        warehouse_id,
                        cascade_environment,
                        delete_digest,
                        actor_id,
                        device_id,
                        command_id,
                        delete_digest,
                        actor_id,
                        device_id,
                        workspace_id,
                        warehouse_id,
                        cascade_environment,
                    ),
                )
                environment_cascaded = cur.fetchall()
                cascade_by_environment[cascade_environment] = len(environment_cascaded)
                all_cascaded.extend(environment_cascaded)
                # Keep the append-only security metadata, but remove all old
                # business payloads so a deleted warehouse cannot be rebuilt
                # from GET /changes or from the live event table.
                cur.execute(
                    """
                    UPDATE business_events_v3
                    SET payload=NULL
                    WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
                      AND payload IS NOT NULL
                    """,
                    (workspace_id, warehouse_id, cascade_environment),
                )
                history_payloads_redacted += max(0, int(cur.rowcount or 0))
                cur.execute(
                    """
                    SELECT COALESCE(MAX(event_id), 0)
                    FROM business_events_v3
                    WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
                    """,
                    (workspace_id, warehouse_id, cascade_environment),
                )
                cascade_cursors[cascade_environment] = int(cur.fetchone()[0])
            cascade_deleted = len(all_cascaded)
            cascade_types = sorted({str(row[0]) for row in all_cascaded})
            set_database_scope(cur, workspace_id, "live", auth)

            # The external lease can expire while a large warehouse is being
            # purged. Revalidate immediately before the transaction is allowed
            # to commit; any failure rolls the whole deletion back.
            verify_warehouse_delete_lease(
                authorization,
                workspace_id,
                warehouse_id,
                warehouse_code,
                warehouse_delete_lease_token,
                require_prepared=True,
            )

        cur.execute(
            """
            SELECT COALESCE(MAX(event_id), 0)
            FROM business_events_v3
            WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
            """,
            (workspace_id, warehouse_id, environment),
        )
        cursor = int(cur.fetchone()[0])
        result = {
            "command_id": command_id,
            "cursor": cursor,
            "entities": outcomes,
            "intent": intent,
            "cascade_deleted": cascade_deleted,
            "cascade_by_environment": cascade_by_environment,
            "history_payloads_redacted": history_payloads_redacted,
            "replayed": False,
        }
        if warehouse_delete:
            result.update(
                {
                    "delete_prepare_contract": WAREHOUSE_DELETE_PREPARE_CONTRACT,
                    "delete_operation_status": "completed",
                    "delete_operation_completed": True,
                    "delete_operation_base_version": int(changes[0]["base_version"]),
                    "delete_operation_warehouse_code": warehouse_code,
                    "telegram_deprovisioned": telegram_deprovision.get("deprovisioned") is True,
                    "telegram_already_deprovisioned": telegram_deprovision.get("already_deprovisioned") is True,
                    "telegram_installation_id": str(telegram_deprovision.get("installation_id", "")),
                }
            )
            cur.execute(
                """
                UPDATE warehouse_delete_operations_v3
                SET status='completed', completed_at=now(), result=%s
                WHERE workspace_id=%s AND warehouse_id=%s AND environment='live'
                  AND command_id=%s AND warehouse_code=%s AND base_version=%s
                  AND status='prepared'
                RETURNING completed_at
                """,
                (
                    Json(result),
                    workspace_id,
                    warehouse_id,
                    command_id,
                    warehouse_code,
                    int(changes[0]["base_version"]),
                ),
            )
            completed_row = cur.fetchone()
            if not completed_row:
                raise ApiError(409, "warehouse_delete_prepare_lost", "Подготовленная операция удаления больше не подтверждена")
            cur.execute(
                """
                INSERT INTO warehouse_delete_release_outbox_v3
                  (workspace_id, warehouse_id, environment, warehouse_code,
                   command_id, base_version, status)
                VALUES (%s,%s,'live',%s,%s,%s,'pending')
                ON CONFLICT (workspace_id, warehouse_id, command_id) DO NOTHING
                """,
                (
                    workspace_id,
                    warehouse_id,
                    warehouse_code,
                    command_id,
                    int(changes[0]["base_version"]),
                ),
            )
            release_outbox_exact_key = (workspace_id, warehouse_id, command_id)
        cur.execute(
            """
            INSERT INTO business_commands_v3
              (workspace_id, warehouse_id, environment, command_id, actor_id, device_id, request_sha256, result)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (workspace_id, warehouse_id, environment, command_id, actor_id, device_id, request_sha256, Json(result)),
        )
        cur.execute(
            """
            INSERT INTO business_audit_v3
              (workspace_id, warehouse_id, environment, actor_id, device_id,
               command_id, action, entity_count, details)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                workspace_id,
                warehouse_id,
                environment,
                actor_id,
                device_id,
                command_id,
                "warehouse_delete_cascade" if warehouse_delete else str(intent.get("kind") if intent else "entity_batch"),
                len(outcomes) + cascade_deleted,
                Json(
                    {
                        "types": sorted({item["type"] for item in changes}),
                        "cursor": cursor,
                        "cascade_deleted": cascade_deleted,
                        "cascade_by_environment": cascade_by_environment,
                        "cascade_types": cascade_types,
                        "history_payloads_redacted": history_payloads_redacted,
                    }
                ),
            ),
        )
        notify_environments = cascade_cursors if warehouse_delete else {environment: cursor}
        for notify_environment, notify_cursor in notify_environments.items():
            cur.execute(
                "SELECT pg_notify('jf_business_events', %s)",
                (
                    json.dumps(
                        {
                            "workspace": workspace_id,
                            "warehouse": warehouse_id,
                            "environment": notify_environment,
                            "cursor": notify_cursor,
                        }
                    ),
                ),
            )
    if release_outbox_exact_key:
        try:
            process_warehouse_delete_release_outbox(1, release_outbox_exact_key)
        except Exception:
            # The deletion is already committed atomically with its durable
            # outbox record. The daemon will retry without a client secret.
            LOG.exception("warehouse delete release opportunistic attempt failed")
    return result


def load_current_entities(workspace_id: str, warehouse_id: str, environment: str, auth: dict) -> dict:
    require_entity_scope_access(auth, workspace_id, warehouse_id, environment)
    with db_connect() as conn, conn.cursor() as cur:
        set_database_scope(cur, workspace_id, environment, auth)
        cur.execute(
            """
            SELECT COALESCE(MAX(event_id), 0)
            FROM business_events_v3
            WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
            """,
            (workspace_id, warehouse_id, environment),
        )
        cursor = int(cur.fetchone()[0])
        cur.execute(
            """
            SELECT entity_type, entity_id, version, payload_sha256, payload, last_event_id, created_at, updated_at
            FROM business_records_v3
            WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
              AND is_deleted=false AND last_event_id<=%s
            ORDER BY entity_type, entity_id
            """,
            (workspace_id, warehouse_id, environment, cursor),
        )
        rows = cur.fetchall()
    entities = []
    for entity_type, entity_id, version, digest, payload, event_id, created_at, updated_at in rows:
        if environment != "live" and str(entity_type) == "warehouse":
            continue
        if not entity_permission_allowed(auth, str(entity_type), write=False):
            continue
        entities.append(
            {
                "type": str(entity_type),
                "id": str(entity_id),
                "version": int(version),
                "digest_sha256": str(digest),
                "payload": payload,
                "event_id": int(event_id),
                "created_at": created_at.isoformat(),
                "updated_at": updated_at.isoformat(),
            }
        )
    readable_types = sorted(
        entity_type
        for entity_type in ENTITY_SECTIONS
        if (environment == "live" or entity_type != "warehouse")
        and entity_permission_allowed(auth, entity_type, write=False)
    )
    return {"cursor": cursor, "entities": entities, "readable_types": readable_types}


def load_entity_changes(
    workspace_id: str,
    warehouse_id: str,
    environment: str,
    after_event_id: int,
    limit: int,
    auth: dict,
) -> dict:
    require_entity_scope_access(auth, workspace_id, warehouse_id, environment)
    with db_connect() as conn, conn.cursor() as cur:
        set_database_scope(cur, workspace_id, environment, auth)
        cur.execute(
            """
            SELECT event_id, entity_type, entity_id, entity_version, operation,
                   payload_sha256, payload, changed_by, device_id, command_id, created_at
            FROM business_events_v3
            WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s AND event_id>%s
            ORDER BY event_id
            LIMIT %s
            """,
            (workspace_id, warehouse_id, environment, after_event_id, limit),
        )
        rows = cur.fetchall()
    events = []
    for row in rows:
        event_id, entity_type, entity_id, version, operation, digest, payload, actor_id, device_id, command_id, created_at = row
        if environment != "live" and str(entity_type) == "warehouse":
            continue
        if not entity_permission_allowed(auth, str(entity_type), write=False):
            continue
        events.append(
            {
                "event_id": int(event_id),
                "type": str(entity_type),
                "id": str(entity_id),
                "version": int(version),
                "operation": str(operation),
                "digest_sha256": str(digest),
                "payload": payload,
                "actor_id": str(actor_id),
                "device_id": str(device_id),
                "command_id": str(command_id),
                "created_at": created_at.isoformat(),
            }
        )
    cursor = int(rows[-1][0]) if rows else after_event_id
    readable_types = sorted(
        entity_type
        for entity_type in ENTITY_SECTIONS
        if (environment == "live" or entity_type != "warehouse")
        and entity_permission_allowed(auth, entity_type, write=False)
    )
    return {
        "cursor": cursor,
        "events": events,
        "has_more": len(rows) == limit,
        "readable_types": readable_types,
    }


def validated_provider_origin(value: str, label: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ApiError(503, "map_provider_invalid", f"Адрес сервиса {label} настроен небезопасно")
    return value.rstrip("/")


def enforce_map_rate(company_id: str) -> None:
    minute = int(time.monotonic() // 60)
    with MAP_RATE_LOCK:
        bucket_minute, count = MAP_RATE_BUCKETS.get(company_id, (minute, 0))
        if bucket_minute != minute:
            bucket_minute, count = minute, 0
        if count >= MAP_RATE_PER_MINUTE:
            raise ApiError(429, "map_rate_limited", "Слишком много запросов к картам. Повторите через минуту")
        MAP_RATE_BUCKETS[company_id] = (bucket_minute, count + 1)
        if len(MAP_RATE_BUCKETS) > 2048:
            for key, value in list(MAP_RATE_BUCKETS.items()):
                if value[0] != minute:
                    MAP_RATE_BUCKETS.pop(key, None)


def map_cache_get(key: str) -> object | None:
    now = time.monotonic()
    with MAP_CACHE_LOCK:
        cached = MAP_CACHE.get(key)
        if cached and cached[0] > now:
            return cached[1]
        if cached:
            MAP_CACHE.pop(key, None)
    return None


def map_cache_put(key: str, value: object, ttl_seconds: int) -> None:
    now = time.monotonic()
    with MAP_CACHE_LOCK:
        if len(MAP_CACHE) >= MAP_CACHE_LIMIT:
            expired = [item_key for item_key, item in MAP_CACHE.items() if item[0] <= now]
            for item_key in expired:
                MAP_CACHE.pop(item_key, None)
            while len(MAP_CACHE) >= MAP_CACHE_LIMIT:
                oldest = min(MAP_CACHE, key=lambda item_key: MAP_CACHE[item_key][0])
                MAP_CACHE.pop(oldest, None)
        MAP_CACHE[key] = (now + ttl_seconds, value)


def fetch_map_json(url: str, ttl_seconds: int, serialize_nominatim: bool = False) -> object:
    global NOMINATIM_LAST_REQUEST
    cached = map_cache_get(url)
    if cached is not None:
        return cached

    def perform() -> object:
        user_agent = f"JustFun-Orders-Logistics/{VERSION}"
        if MAP_CONTACT:
            user_agent += f" ({MAP_CONTACT})"
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "Accept-Language": "ru",
                "User-Agent": user_agent,
            },
            method="GET",
        )
        try:
            with urlopen(request, timeout=20) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise ApiError(502, "map_provider_payload_too_large", "Картографический сервис вернул слишком большой ответ")
            value = json.loads(raw.decode("utf-8"))
        except HTTPError as exc:
            raise ApiError(502, "map_provider_http_error", f"Картографический сервис ответил HTTP {exc.code}", {"status": exc.code}) from exc
        except (URLError, TimeoutError) as exc:
            raise ApiError(503, "map_provider_unavailable", "Картографический сервис временно недоступен") from exc
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ApiError(502, "map_provider_invalid_response", "Картографический сервис вернул повреждённый ответ") from exc
        if not isinstance(value, (dict, list)):
            raise ApiError(502, "map_provider_invalid_response", "Картографический сервис вернул неверный формат")
        map_cache_put(url, value, ttl_seconds)
        return value

    if not serialize_nominatim:
        return perform()
    with NOMINATIM_LOCK:
        cached = map_cache_get(url)
        if cached is not None:
            return cached
        wait = max(0.0, 1.1 - (time.monotonic() - NOMINATIM_LAST_REQUEST))
        if wait:
            time.sleep(wait)
        result = perform()
        NOMINATIM_LAST_REQUEST = time.monotonic()
        return result


def finite_coordinate(value: object, minimum: float, maximum: float, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ApiError(400, "invalid_map_coordinate", f"Координата {name} указана неверно") from exc
    if not math.isfinite(number) or number < minimum or number > maximum:
        raise ApiError(400, "invalid_map_coordinate", f"Координата {name} выходит за допустимый диапазон")
    return number


def map_points(value: object) -> list[tuple[float, float]]:
    if not isinstance(value, list) or len(value) < 2 or len(value) > 100:
        raise ApiError(400, "invalid_map_points", "Для маршрута требуется от 2 до 100 точек")
    result: list[tuple[float, float]] = []
    for point in value:
        if not isinstance(point, dict):
            raise ApiError(400, "invalid_map_points", "Точка маршрута должна содержать широту и долготу")
        lat = finite_coordinate(point.get("lat"), -90, 90, "широты")
        lon = finite_coordinate(point.get("lon"), -180, 180, "долготы")
        result.append((lat, lon))
    return result


ADDRESS_NORMALIZATION_RULES = (
    (r"\bлен\s+обл\b", "ленинградская область"),
    (r"\bмос\s+обл\b", "московская область"),
    (r"\bобл\b", "область"),
    (r"\bр\s*-?\s*н\b|\bр-он\b", "район"),
    (r"\bм\s+о\b", "муниципальный округ"),
    (r"\bг\s+о\b", "городской округ"),
    (r"\bспб\b", "санкт петербург"),
    (r"\bс\s*н\s*т\b|\bсадоводство\b|\bсадоводческое\s+товарищество\b", "снт"),
    (r"\bд\s*н\s*т\b", "днт"),
    (r"\bд\s*н\s*п\b", "днп"),
    (r"\bк\s*п\b", "коттеджный поселок"),
    (r"\bпр\s*-?\s*д\s*", "проезд "),
    (r"\bг\s+(?=[а-я])", "город "),
    (r"\bдер\s*", "деревня "),
    (r"\bд\s+(?=[а-я])", "деревня "),
    (r"\bпгт\s*", "поселок городского типа "),
    (r"\bпос\s*", "поселок "),
    (r"\bп\s+(?=[а-я])", "поселок "),
    (r"\bс\s+(?=[а-я])", "село "),
    (r"\bхут\s*", "хутор "),
    (r"\bст-?ца\s*", "станица "),
    (r"\bсл\s+(?=[а-я])", "слобода "),
    (r"\bтер\s*", "территория "),
    (r"\bкв-?л\s*", "квартал "),
    (r"\bмкр\s*", "микрорайон "),
    (r"\bпромзона\b", "промышленная зона"),
    (r"\bул\s*", "улица "),
    (r"\bпр\s*-?\s*кт\s*|\bпросп\s*", "проспект "),
    (r"\bпер\s*", "переулок "),
    (r"\bш\s+(?=[а-я])", "шоссе "),
    (r"\bнаб\s*", "набережная "),
    (r"\bлин\s*", "линия "),
    (r"\bалл\s*", "аллея "),
    (r"\bд\s*(?=\d)", "дом "),
    (r"\bдомовл\s*|\bвлад\s*", "владение "),
    (r"\bкорп\s*", "корпус "),
    (r"\bстр\s*", "строение "),
    (r"\bлит\s*", "литера "),
    (r"\bпом\s*", "помещение "),
    (r"\bуч\s*", "участок "),
)


def normalize_address_text(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).casefold().replace("ё", "е")
    text = re.sub(r"[.\\/|,;:()\[\]{}«»„“”\"'`]", " ", text)
    text = re.sub(r"[–—−]", "-", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = f" {text} "
    for pattern, replacement in ADDRESS_NORMALIZATION_RULES:
        text = re.sub(pattern, f" {replacement} ", text)
    text = re.sub(r"[^0-9a-zа-я-]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def validate_address_search_payload(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ApiError(400, "invalid_address_request", "Запрос адреса должен быть объектом")
    original_query = " ".join(str(payload.get("query", "")).split())
    if len(original_query) < 3 or len(original_query) > 300:
        raise ApiError(400, "invalid_address_query", "Введите адрес длиной от 3 до 300 символов")
    normalized_query = normalize_address_text(original_query)
    if len(normalized_query) < 3:
        raise ApiError(400, "invalid_address_query", "Адрес не содержит символов для поиска")
    request_id = str(payload.get("request_id", ""))
    if not ADDRESS_REQUEST_ID_RE.fullmatch(request_id):
        raise ApiError(400, "invalid_address_request_id", "Идентификатор адресного запроса повреждён")
    if payload.get("limit") != 3:
        raise ApiError(400, "invalid_address_limit", "Адресный контракт возвращает не более трёх вариантов")
    if payload.get("address_contract") != ADDRESS_API_CONTRACT:
        raise ApiError(426, "address_client_upgrade_required", "Версия адресного договора несовместима", {"address_contract": ADDRESS_API_CONTRACT})
    language = str(payload.get("language", "ru")).lower()
    if language != "ru":
        raise ApiError(400, "invalid_address_language", "Адресный поиск поддерживает русский язык")
    client_version = str(payload.get("client_version", ""))
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?", client_version):
        raise ApiError(400, "invalid_address_client_version", "Версия клиента адресного поиска повреждена")
    interaction = str(payload.get("interaction", ""))
    if interaction not in {"autocomplete", "explicit"}:
        raise ApiError(400, "invalid_address_interaction", "Режим адресного поиска повреждён")
    preferred_region = " ".join(str(payload.get("preferred_region", "")).split())[:160]
    return {
        "request_id": request_id,
        "original_query": original_query,
        "normalized_query": normalized_query,
        "preferred_region": preferred_region,
        "normalized_region": normalize_address_text(preferred_region),
        "language": language,
        "limit": 3,
        "client_version": client_version,
        "address_contract": ADDRESS_API_CONTRACT,
        "interaction": interaction,
    }


def address_row_key(row: dict) -> str:
    fias_id = str(row.get("fias_id") or "")
    if fias_id:
        return f"fias:{fias_id}"
    lat = row.get("latitude")
    lon = row.get("longitude")
    coordinates = ""
    if lat is not None and lon is not None:
        coordinates = f"{float(lat):.5f}:{float(lon):.5f}"
    return f"text:{normalize_address_text(row.get('display_name'))}|{coordinates}"


def rank_address_rows(rows: list[dict], request: dict) -> list[dict]:
    preferred_region = request["normalized_region"]
    ranked: list[tuple[float, str, str, dict]] = []
    for row in rows:
        text_score = max(0.0, min(1.0, float(row.get("text_score") or 0.0)))
        region_match = bool(preferred_region) and preferred_region in normalize_address_text(row.get("region"))
        has_coordinates = row.get("latitude") is not None and row.get("longitude") is not None
        has_fias = bool(row.get("fias_id"))
        score = text_score * 0.84
        score += 0.08 if region_match else 0.0
        score += 0.03 if row.get("official_status") else 0.0
        score += 0.03 if has_fias else 0.0
        score += 0.02 if has_coordinates else 0.0
        score = max(0.0, min(1.0, score))
        if score < 0.42:
            continue
        confidence = "high" if score >= 0.82 else "medium" if score >= 0.62 else "low"
        reasons = ["Нечёткое совпадение адреса" if text_score < 0.92 else "Точное текстовое совпадение"]
        if region_match:
            reasons.append("Совпадает приоритетный регион")
        if has_fias:
            reasons.append("Есть официальный идентификатор ГАР/ФИАС")
        warnings = [str(value)[:180] for value in row.get("provider_warnings", []) if str(value).strip()][:8]
        if confidence == "low":
            warnings.append("Совпадение требует ручной проверки")
        if not has_coordinates:
            warnings.append("Координаты не подтверждены")
        if not has_fias:
            warnings.append("Идентификатор ГАР/ФИАС отсутствует")
        source_date = row.get("source_date")
        result = {
            "id": str(row.get("internal_id", "")),
            "display_name": str(row.get("display_name", "")),
            "components": {
                "region": str(row.get("region", "")),
                "district": str(row.get("district", "")),
                "settlement": str(row.get("settlement", "")),
                "territory": str(row.get("territory", "")),
                "street": str(row.get("street", "")),
                "house": str(row.get("house", "")),
                "postal_code": str(row.get("postal_code", "")),
            },
            "object_type": str(row.get("object_type", "")),
            "coordinates": {
                "lat": float(row["latitude"]) if row.get("latitude") is not None else None,
                "lon": float(row["longitude"]) if row.get("longitude") is not None else None,
                "accuracy": str(row.get("coordinate_accuracy", "unknown")),
            },
            "fias_id": str(row.get("fias_id") or ""),
            "provider_ids": {str(row.get("source_name", "unknown")): str(row.get("source_id", ""))},
            "confidence": confidence,
            "match_score": round(score, 4),
            "match_reason": reasons,
            "warnings": warnings,
            "source": {
                "name": str(row.get("source_name", "")),
                "version": str(row.get("source_version", "")),
                "date": source_date.isoformat() if hasattr(source_date, "isoformat") else str(source_date or ""),
            },
        }
        ranked.append((score, result["id"], address_row_key(row), result))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    deduplicated: list[dict] = []
    by_key: dict[str, dict] = {}
    for _score, _internal_id, key, result in ranked:
        existing = by_key.get(key)
        if existing is not None:
            existing["provider_ids"].update(result["provider_ids"])
            existing["match_reason"] = list(dict.fromkeys(existing["match_reason"] + result["match_reason"]))
            existing["warnings"] = list(dict.fromkeys(existing["warnings"] + result["warnings"]))
            continue
        if len(deduplicated) >= 3:
            continue
        by_key[key] = result
        deduplicated.append(result)
    return deduplicated


def provider_coordinate(value: object, minimum: float, maximum: float) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and minimum <= number <= maximum else None


def provider_ratio(value: object) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, number)) if math.isfinite(number) else 0.0


def provider_text(value: object, limit: int) -> str:
    if value is None or isinstance(value, (dict, list, tuple, set, bool)):
        return ""
    return " ".join(str(value).split())[:limit]


def address_text_similarity(query: str, candidate: str) -> float:
    left = normalize_address_text(query)
    right = normalize_address_text(candidate)
    if not left or not right:
        return 0.0
    sequence = SequenceMatcher(None, left, right).ratio()
    query_tokens = {token for token in left.split() if len(token) > 1}
    candidate_tokens = {token for token in right.split() if len(token) > 1}
    overlap = len(query_tokens & candidate_tokens) / max(1, len(query_tokens))
    return max(sequence, overlap)


def address_token_similarity(query: str, candidate: str) -> float:
    generic = {"россия", "область", "район", "город", "деревня", "село", "поселок", "улица", "дом", "участок", "республика", "край"}
    query_tokens = [token for token in normalize_address_text(query).split() if len(token) >= 4 and token not in generic]
    candidate_tokens = [token for token in normalize_address_text(candidate).split() if len(token) >= 4 and token not in generic]
    if not query_tokens or not candidate_tokens:
        return 0.0
    scores = []
    for query_token in query_tokens:
        compatible = [SequenceMatcher(None, query_token, candidate_token).ratio() for candidate_token in candidate_tokens if candidate_token[0] == query_token[0]]
        scores.append(max(compatible, default=0.0))
    return sum(scores) / len(scores)


def dadata_house(data: dict) -> str:
    parts = []
    if data.get("stead"):
        parts.append(f"{provider_text(data.get('stead_type'), 20) or 'уч'} {provider_text(data['stead'], 50)}")
    if data.get("house"):
        parts.append(f"{provider_text(data.get('house_type'), 20) or 'д'} {provider_text(data['house'], 50)}")
    if data.get("block"):
        parts.append(f"{provider_text(data.get('block_type'), 20) or 'корп'} {provider_text(data['block'], 50)}")
    return " ".join(str(value).strip() for value in parts if str(value).strip())[:80]


def dadata_object_type(data: dict) -> str:
    return {
        "1": "region", "3": "district", "4": "city", "5": "city_district",
        "6": "settlement", "7": "street", "8": "house", "9": "room",
        "65": "planning_structure", "75": "land_plot",
    }.get(str(data.get("fias_level") or ""), "address")


def dadata_rows(suggestions: object, request: dict, queried_at: datetime) -> list[dict]:
    if not isinstance(suggestions, list):
        raise ApiError(502, "address_provider_invalid_response", "Сервис адресов вернул неверный список подсказок")
    rows = []
    for index, suggestion in enumerate(suggestions[:20]):
        if not isinstance(suggestion, dict) or not isinstance(suggestion.get("data"), dict):
            continue
        data = suggestion["data"]
        display_name = provider_text(suggestion.get("unrestricted_value") or suggestion.get("value"), 1000)
        if not display_name:
            continue
        fias_id = provider_text(data.get("fias_id"), 80).lower()
        if fias_id and not FIAS_UUID_RE.fullmatch(fias_id):
            fias_id = ""
        source_id = fias_id or hashlib.sha256(display_name.encode("utf-8")).hexdigest()[:32]
        actuality = str(data.get("fias_actuality_state") or "")
        warnings = []
        if actuality and actuality != "0":
            warnings.append("Поставщик сообщает, что адрес в ГАР/ФИАС был изменён")
        rows.append({
            "internal_id": f"dadata:{source_id}",
            "display_name": display_name,
            "object_type": dadata_object_type(data),
            "region": provider_text(data.get("region_with_type") or data.get("region"), 160),
            "district": provider_text(data.get("area_with_type") or data.get("city_district_with_type"), 200),
            "settlement": provider_text(data.get("settlement_with_type") or data.get("city_with_type"), 200),
            "territory": provider_text(data.get("planning_structure_with_type"), 200),
            "street": provider_text(data.get("street_with_type"), 240),
            "house": dadata_house(data),
            "postal_code": provider_text(data.get("postal_code"), 16),
            "latitude": provider_coordinate(data.get("geo_lat"), -90, 90),
            "longitude": provider_coordinate(data.get("geo_lon"), -180, 180),
            "coordinate_accuracy": {"0": "building", "1": "nearest_building", "2": "street", "3": "settlement", "4": "city", "5": "unknown"}.get(str(data.get("qc_geo") or ""), "unknown"),
            "fias_id": fias_id,
            "source_name": "dadata",
            "source_id": source_id,
            "source_version": "suggestions-api-4_1",
            "source_date": queried_at.date(),
            "official_status": bool(fias_id) and actuality in {"", "0"},
            "provider_warnings": warnings,
            "text_score": max(address_text_similarity(request["normalized_query"], display_name), max(0.55, 0.82 - index * 0.04)),
        })
    return rows


def nominatim_rows(suggestions: object, request: dict, queried_at: datetime) -> list[dict]:
    if not isinstance(suggestions, list):
        raise ApiError(502, "address_provider_invalid_response", "Сервис адресов вернул неверный список результатов")
    rows = []
    for index, item in enumerate(suggestions[:10]):
        if not isinstance(item, dict):
            continue
        address = item.get("address") if isinstance(item.get("address"), dict) else {}
        display_name = provider_text(item.get("display_name"), 1000)
        if not display_name:
            continue
        osm_type = re.sub(r"[^A-Za-z0-9_-]", "", str(item.get("osm_type") or "place"))[:30] or "place"
        osm_id = re.sub(r"[^A-Za-z0-9_-]", "", str(item.get("osm_id") or item.get("place_id") or ""))[:80]
        if not osm_id:
            osm_id = hashlib.sha256(display_name.encode("utf-8")).hexdigest()[:32]
        importance = provider_ratio(item.get("importance"))
        rows.append({
            "internal_id": f"nominatim:{osm_type}:{osm_id}",
            "display_name": display_name,
            "object_type": provider_text(item.get("type") or item.get("class") or "address", 80),
            "region": provider_text(address.get("state") or address.get("region") or address.get("province"), 160),
            "district": provider_text(address.get("state_district") or address.get("county") or address.get("city_district"), 200),
            "settlement": provider_text(address.get("city") or address.get("town") or address.get("village") or address.get("hamlet") or address.get("locality"), 200),
            "territory": provider_text(address.get("allotments") or address.get("quarter") or address.get("suburb"), 200),
            "street": provider_text(address.get("road") or address.get("pedestrian") or address.get("residential"), 240),
            "house": provider_text(address.get("house_number") or address.get("plot"), 80),
            "postal_code": provider_text(address.get("postcode"), 16),
            "latitude": provider_coordinate(item.get("lat"), -90, 90),
            "longitude": provider_coordinate(item.get("lon"), -180, 180),
            "coordinate_accuracy": "provider",
            "fias_id": "",
            "source_name": "nominatim",
            "source_id": f"{osm_type}:{osm_id}",
            "source_version": "search-jsonv2",
            "source_date": queried_at.date(),
            "official_status": False,
            "provider_warnings": ["Официальный идентификатор ГАР/ФИАС отсутствует"],
            "text_score": max(address_text_similarity(request["normalized_query"], display_name), min(0.78, importance + 0.25), max(0.48, 0.68 - index * 0.03)),
        })
    return rows


def photon_rows(collection: object, request: dict, queried_at: datetime) -> list[dict]:
    if not isinstance(collection, dict) or not isinstance(collection.get("features"), list):
        raise ApiError(502, "address_provider_invalid_response", "Нечёткий сервис адресов вернул неверный список результатов")
    rows = []
    for index, feature in enumerate(collection["features"][:20]):
        if not isinstance(feature, dict) or not isinstance(feature.get("properties"), dict):
            continue
        properties = feature["properties"]
        geometry = feature.get("geometry") if isinstance(feature.get("geometry"), dict) else {}
        coordinates = geometry.get("coordinates") if isinstance(geometry.get("coordinates"), list) else []
        longitude = provider_coordinate(coordinates[0] if len(coordinates) > 0 else None, -180, 180)
        latitude = provider_coordinate(coordinates[1] if len(coordinates) > 1 else None, -90, 90)
        object_type = provider_text(properties.get("type") or properties.get("osm_value") or "address", 80)
        name = provider_text(properties.get("name"), 300)
        region = provider_text(properties.get("state"), 160)
        district = provider_text(properties.get("county") or properties.get("district"), 200)
        city = provider_text(properties.get("city") or properties.get("town") or properties.get("village"), 200)
        settlement = city or (name if object_type in {"city", "town", "village", "hamlet", "locality"} else "")
        street = provider_text(properties.get("street"), 240)
        house = provider_text(properties.get("housenumber"), 80)
        display_parts = []
        for value in (name, street, house, city, district, region, properties.get("country")):
            text = provider_text(value, 300)
            if text and text not in display_parts:
                display_parts.append(text)
        display_name = ", ".join(display_parts)[:1000]
        if not display_name:
            continue
        osm_type = re.sub(r"[^A-Za-z0-9_-]", "", str(properties.get("osm_type") or "place"))[:30] or "place"
        osm_id = re.sub(r"[^A-Za-z0-9_-]", "", str(properties.get("osm_id") or properties.get("extent") or ""))[:80]
        if not osm_id:
            osm_id = hashlib.sha256(f"{display_name}|{latitude}|{longitude}".encode("utf-8")).hexdigest()[:32]
        rows.append({
            "internal_id": f"photon:{osm_type}:{osm_id}",
            "display_name": display_name,
            "object_type": object_type,
            "region": region,
            "district": district,
            "settlement": settlement,
            "territory": provider_text(properties.get("locality") or properties.get("district"), 200),
            "street": street,
            "house": house,
            "postal_code": provider_text(properties.get("postcode"), 16),
            "latitude": latitude,
            "longitude": longitude,
            "coordinate_accuracy": "provider",
            "fias_id": "",
            "source_name": "photon",
            "source_id": f"{osm_type}:{osm_id}",
            "source_version": "api_v1",
            "source_date": queried_at.date(),
            "official_status": False,
            "provider_warnings": ["Нечёткое совпадение OpenStreetMap необходимо проверить перед сохранением"],
            "text_score": max(address_text_similarity(request["normalized_query"], display_name), address_token_similarity(request["normalized_query"].replace(request["normalized_region"], " "), name) * 0.98, max(0.48, 0.78 - index * 0.025)),
        })
    return rows


def fetch_photon_suggestions(request: dict) -> object:
    origin = validated_provider_origin(PHOTON_ORIGIN, "нечёткого поиска адресов")
    params = urlencode({"q": request["original_query"], "limit": "20"})
    return fetch_map_json(f"{origin}/api/?{params}", ADDRESS_CACHE_SECONDS)


def fetch_dadata_suggestions(request: dict) -> object:
    if not re.fullmatch(r"[A-Za-z0-9._-]{16,240}", DADATA_API_KEY):
        raise ApiError(503, "address_autocomplete_not_configured", "Автоподсказки адресов ещё не подключены. Нажмите кнопку поиска")
    origin = validated_provider_origin(DADATA_ORIGIN, "подсказок адресов")
    body = json.dumps({"query": request["original_query"], "count": 10, "language": "ru", "division": "administrative"}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    cache_key = "address:dadata:" + hashlib.sha256(body).hexdigest()
    cached = map_cache_get(cache_key)
    if cached is not None:
        return cached
    upstream = Request(
        f"{origin}/suggestions/api/4_1/rs/suggest/address",
        data=body,
        headers={"Accept": "application/json", "Content-Type": "application/json; charset=utf-8", "Authorization": f"Token {DADATA_API_KEY}", "User-Agent": f"JustFun-Orders-Logistics/{VERSION}"},
        method="POST",
    )
    try:
        with urlopen(upstream, timeout=20) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise ApiError(502, "address_provider_payload_too_large", "Сервис адресов вернул слишком большой ответ")
        value = json.loads(raw.decode("utf-8"))
    except HTTPError as exc:
        if exc.code in {401, 403}:
            raise ApiError(503, "address_provider_auth_failed", "Ключ сервиса адресов не принят") from exc
        if exc.code == 429:
            raise ApiError(429, "address_provider_rate_limited", "Лимит сервиса адресов временно исчерпан") from exc
        raise ApiError(502, "address_provider_http_error", f"Сервис адресов ответил HTTP {exc.code}", {"status": exc.code}) from exc
    except (URLError, TimeoutError) as exc:
        raise ApiError(503, "address_provider_unavailable", "Сервис адресов временно недоступен") from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ApiError(502, "address_provider_invalid_response", "Сервис адресов вернул повреждённый ответ") from exc
    if not isinstance(value, dict) or not isinstance(value.get("suggestions"), list):
        raise ApiError(502, "address_provider_invalid_response", "Сервис адресов вернул неверный формат")
    map_cache_put(cache_key, value["suggestions"], ADDRESS_CACHE_SECONDS)
    return value["suggestions"]


def search_address_providers(payload: object) -> dict:
    request = validate_address_search_payload(payload)
    queried_at = datetime.now(timezone.utc)
    if DADATA_API_KEY:
        rows = dadata_rows(fetch_dadata_suggestions(request), request, queried_at)
        provider = {"name": "dadata", "api_version": "4_1", "reference": "gar-fias", "queried_at": queried_at.isoformat().replace("+00:00", "Z"), "cache_ttl_seconds": ADDRESS_CACHE_SECONDS}
    else:
        rows = []
        if request["interaction"] == "explicit":
            rows.extend(nominatim_rows(proxy_geocode({"mode": "search", "query": request["original_query"], "limit": 10, "addressOnly": True}), request, queried_at))
        rows.extend(photon_rows(fetch_photon_suggestions(request), request, queried_at))
        provider = {"name": "openstreetmap_federated", "api_version": "nominatim_photon_v1", "reference": "openstreetmap", "queried_at": queried_at.isoformat().replace("+00:00", "Z"), "cache_ttl_seconds": ADDRESS_CACHE_SECONDS}
    results = rank_address_rows(rows, request)
    LOG.info(
        "address search request=%s interaction=%s query_sha256=%s candidates=%d results=%d provider=%s",
        request["request_id"], request["interaction"], hashlib.sha256(request["normalized_query"].encode("utf-8")).hexdigest()[:16], len(rows), len(results), provider["name"],
    )
    return {
        "request_id": request["request_id"],
        "address_contract": ADDRESS_API_CONTRACT,
        "query": request["original_query"],
        "normalized_query": request["normalized_query"],
        "provider": provider,
        "results": results,
    }


def proxy_geocode(payload: dict) -> object:
    origin = validated_provider_origin(NOMINATIM_ORIGIN, "поиска адресов")
    mode = str(payload.get("mode", "search"))
    if mode == "search":
        query = " ".join(str(payload.get("query", "")).split())
        if len(query) < 3 or len(query) > 300:
            raise ApiError(400, "invalid_map_query", "Введите адрес длиной от 3 до 300 символов")
        limit = payload.get("limit", 10)
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1 or limit > 10:
            raise ApiError(400, "invalid_map_limit", "Лимит результатов должен быть от 1 до 10")
        params = {
            "q": query,
            "format": "jsonv2",
            "addressdetails": "1",
            "namedetails": "1",
            "limit": str(limit),
            "countrycodes": "ru",
            "accept-language": "ru",
            "dedupe": "1",
        }
        if payload.get("addressOnly") is not False:
            params["layer"] = "address"
        return fetch_map_json(f"{origin}/search?{urlencode(params)}", 24 * 60 * 60, True)
    if mode == "reverse":
        lat = finite_coordinate(payload.get("lat"), -90, 90, "широты")
        lon = finite_coordinate(payload.get("lon"), -180, 180, "долготы")
        params = {
            "lat": f"{lat:.7f}",
            "lon": f"{lon:.7f}",
            "format": "jsonv2",
            "addressdetails": "1",
            "zoom": "18",
            "accept-language": "ru",
            "layer": "address",
        }
        return fetch_map_json(f"{origin}/reverse?{urlencode(params)}", 24 * 60 * 60, True)
    raise ApiError(400, "invalid_map_mode", "Неизвестный режим поиска адреса")


def proxy_route(payload: dict) -> object:
    origin = validated_provider_origin(OSRM_ORIGIN, "дорожных маршрутов")
    operation = str(payload.get("operation", "route"))
    if operation not in {"route", "table"}:
        raise ApiError(400, "invalid_map_mode", "Неизвестный режим дорожного расчёта")
    points = map_points(payload.get("points"))
    coordinates = ";".join(f"{lon:.7f},{lat:.7f}" for lat, lon in points)
    if operation == "table":
        url = f"{origin}/table/v1/driving/{coordinates}?annotations=duration,distance"
    else:
        url = f"{origin}/route/v1/driving/{coordinates}?overview=full&geometries=geojson&steps=true&annotations=false"
    result = fetch_map_json(url, 10 * 60)
    if not isinstance(result, dict) or result.get("code") != "Ok":
        raise ApiError(502, "map_route_failed", "Дорожный сервис не смог построить маршрут")
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = f"JustFunOrdersLogistics/{VERSION}"

    def log_message(self, fmt: str, *args) -> None:
        LOG.info("%s %s", self.address_string(), fmt % args)

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-JustFun-API-Contract", str(API_CONTRACT))
        self.send_header("X-JustFun-Address-Contract", str(ADDRESS_API_CONTRACT))
        self.send_header("X-JustFun-Min-Client-Version", MIN_CLIENT_VERSION)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def require_auth(self) -> dict:
        return authenticate_request(self.headers.get("Authorization", ""))

    def require_compatible_client(self) -> None:
        raw_contract = self.headers.get("X-JustFun-API-Contract", "").strip()
        raw_version = self.headers.get("X-JustFun-Client-Version", "").strip()
        if not raw_contract:
            if REQUIRE_API_CONTRACT:
                raise ApiError(
                    426,
                    "client_upgrade_required",
                    "Версия программы не передала договор API. Установите актуальную сборку JustFun.",
                    {"api_contract": API_CONTRACT, "minimum_client_version": MIN_CLIENT_VERSION},
                )
            return
        try:
            client_contract = int(raw_contract)
        except ValueError as exc:
            raise ApiError(400, "invalid_api_contract", "Версия договора API повреждена") from exc
        if client_contract != API_CONTRACT:
            raise ApiError(
                426,
                "client_upgrade_required",
                "Версия программы несовместима с сервером компании.",
                {
                    "client_api_contract": client_contract,
                    "api_contract": API_CONTRACT,
                    "client_version": raw_version,
                    "minimum_client_version": MIN_CLIENT_VERSION,
                },
            )

    def read_json(self) -> dict:
        raw_length = self.headers.get("Content-Length", "")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ApiError(411, "length_required", "Не указан размер запроса") from exc
        if length < 2 or length > MAX_BODY:
            raise ApiError(413, "payload_too_large", "Запрос превышает допустимый размер")
        body = self.rfile.read(length)
        try:
            value = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ApiError(400, "invalid_json", "Повреждён JSON запроса") from exc
        if not isinstance(value, dict):
            raise ApiError(400, "invalid_json", "Тело запроса должно быть объектом")
        return value

    def dispatch(self) -> None:
        target = urlparse(self.path)
        if target.path == "/health" and self.command in ("GET", "HEAD"):
            try:
                with db_connect() as conn, conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    cur.fetchone()
                    cur.execute(
                        "SELECT version, name, COALESCE(checksum_sha256, '') FROM schema_migrations ORDER BY version"
                    )
                    schema_migrations = [
                        {"version": int(row[0]), "name": str(row[1]), "checksum_sha256": str(row[2])}
                        for row in cur.fetchall()
                    ]
                self.send_json(
                    200,
                    {
                        "ok": True,
                        "service": "orders-logistics-reg-vps",
                        "version": VERSION,
                        "database": "ready",
                        "api_contract": API_CONTRACT,
                        "address_contract": ADDRESS_API_CONTRACT,
                        "warehouse_delete_prepare_contract": WAREHOUSE_DELETE_PREPARE_CONTRACT,
                        "warehouse_delete_release_outbox_contract": WAREHOUSE_DELETE_RELEASE_OUTBOX_CONTRACT,
                        "vps_attestation_contract": VPS_ATTESTATION_CONTRACT,
                        "address_provider": "dadata" if DADATA_API_KEY else "nominatim-explicit-only",
                        "address_autocomplete": bool(DADATA_API_KEY),
                        "address_storage": "transient-memory-cache",
                        "storage_mode": "server_authoritative_v3",
                        "schema_version": max((item["version"] for item in schema_migrations), default=0),
                        "schema_migrations": schema_migrations,
                        "database_pool_max": DB_POOL_MAX,
                        "minimum_client_version": MIN_CLIENT_VERSION,
                        "contract_required": REQUIRE_API_CONTRACT,
                    },
                )
            except Exception:
                LOG.exception("health database failure")
                self.send_json(
                    503,
                    {
                        "ok": False,
                        "service": "orders-logistics-reg-vps",
                        "version": VERSION,
                        "database": "unavailable",
                        "api_contract": API_CONTRACT,
                        "address_contract": ADDRESS_API_CONTRACT,
                        "warehouse_delete_prepare_contract": WAREHOUSE_DELETE_PREPARE_CONTRACT,
                        "warehouse_delete_release_outbox_contract": WAREHOUSE_DELETE_RELEASE_OUTBOX_CONTRACT,
                        "vps_attestation_contract": VPS_ATTESTATION_CONTRACT,
                        "minimum_client_version": MIN_CLIENT_VERSION,
                    },
                )
            return
        self.require_compatible_client()
        auth = self.require_auth()
        if target.path == "/v1/status" and self.command in ("GET", "HEAD"):
            self.send_json(
                200,
                {
                    "ok": True,
                    "service": "orders-logistics-reg-vps",
                    "version": VERSION,
                    "api_contract": API_CONTRACT,
                    "address_contract": ADDRESS_API_CONTRACT,
                    "warehouse_delete_prepare_contract": WAREHOUSE_DELETE_PREPARE_CONTRACT,
                    "warehouse_delete_release_outbox_contract": WAREHOUSE_DELETE_RELEASE_OUTBOX_CONTRACT,
                    "vps_attestation_contract": VPS_ATTESTATION_CONTRACT,
                    "address_provider": "dadata" if DADATA_API_KEY else "nominatim-explicit-only",
                    "address_autocomplete": bool(DADATA_API_KEY),
                    "minimum_client_version": MIN_CLIENT_VERSION,
                    "workspace_id": auth["company_id"],
                },
            )
            return
        if target.path in {"/v1/maps/geocode", "/v1/maps/route"}:
            if self.command != "POST":
                raise ApiError(405, "method_not_allowed", "Картографический запрос требует POST")
            enforce_map_rate(str(auth["company_id"]))
            request = self.read_json()
            result = proxy_geocode(request) if target.path.endswith("/geocode") else proxy_route(request)
            self.send_json(200, {"ok": True, "data": result})
            return
        if target.path == "/v1/warehouses" and self.command == "GET":
            query = {}
            for item in target.query.split("&"):
                key, separator, value = item.partition("=")
                if separator:
                    query[unquote(key)] = unquote(value)
            environment = str(query.get("environment", "live")).lower()
            if environment not in ("live", "demo"):
                raise ApiError(400, "invalid_environment", "Среда должна быть LIVE или DEMO")
            workspace_id = str(auth["company_id"])
            registry = warehouse_registry_snapshot(workspace_id, environment, auth)
            self.send_json(
                200,
                {
                    "ok": True,
                    "workspace_id": workspace_id,
                    "environment": environment,
                    **registry,
                },
            )
            return
        decoded_path = unquote(target.path)
        delete_prepare_match = WAREHOUSE_DELETE_PREPARE_PATH_RE.fullmatch(decoded_path)
        if delete_prepare_match:
            if self.command != "POST":
                raise ApiError(405, "method_not_allowed", "Подготовка удаления склада требует POST")
            workspace_id, warehouse_id = delete_prepare_match.groups()
            require_workspace(auth, workspace_id)
            result = prepare_warehouse_delete(
                workspace_id,
                warehouse_id,
                self.read_json(),
                auth,
                self.headers.get("Authorization", ""),
            )
            self.send_json(
                200,
                {
                    "ok": True,
                    "workspace_id": workspace_id,
                    "warehouse_id": warehouse_id,
                    **result,
                },
            )
            return
        address_match = ADDRESS_SEARCH_PATH_RE.fullmatch(decoded_path)
        if address_match:
            if self.command != "POST":
                raise ApiError(405, "method_not_allowed", "Адресный поиск требует POST")
            workspace_id, warehouse_id, environment = address_match.groups()
            require_workspace(auth, workspace_id)
            require_entity_scope_access(
                auth,
                workspace_id,
                warehouse_id,
                environment,
                allow_global_without_snapshot=True,
            )
            enforce_map_rate(f"{workspace_id}:{warehouse_id}:address")
            result = search_address_providers(self.read_json())
            self.send_json(
                200,
                {
                    "ok": True,
                    "workspace_id": workspace_id,
                    "warehouse_id": warehouse_id,
                    "environment": environment,
                    **result,
                },
            )
            return
        batch_match = ENTITY_BATCH_PATH_RE.fullmatch(decoded_path)
        collection_match = ENTITY_COLLECTION_PATH_RE.fullmatch(decoded_path)
        changes_match = ENTITY_CHANGES_PATH_RE.fullmatch(decoded_path)
        entity_match = batch_match or collection_match or changes_match
        if entity_match:
            workspace_id, warehouse_id, environment = entity_match.groups()
            require_workspace(auth, workspace_id)
            if batch_match:
                if self.command != "POST":
                    raise ApiError(405, "method_not_allowed", "Для пакетной записи требуется POST")
                request = self.read_json()
                authorization = self.headers.get("Authorization", "")
                result = save_entity_batch(
                    workspace_id,
                    warehouse_id,
                    environment,
                    request,
                    auth,
                    authorization,
                )
                self.send_json(
                    200,
                    {
                        "ok": True,
                        "workspace_id": workspace_id,
                        "warehouse_id": warehouse_id,
                        "environment": environment,
                        **result,
                    },
                )
                return
            if collection_match:
                if self.command != "GET":
                    raise ApiError(405, "method_not_allowed", "Коллекция сущностей доступна только для чтения")
                result = load_current_entities(workspace_id, warehouse_id, environment, auth)
                self.send_json(
                    200,
                    {
                        "ok": True,
                        "workspace_id": workspace_id,
                        "warehouse_id": warehouse_id,
                        "environment": environment,
                        **result,
                    },
                )
                return
            if self.command != "GET":
                raise ApiError(405, "method_not_allowed", "Лента изменений доступна только для чтения")
            query = {}
            for item in target.query.split("&"):
                key, separator, value = item.partition("=")
                if separator:
                    query[unquote(key)] = unquote(value)
            try:
                after_event_id = int(query.get("after", "0"))
                limit = int(query.get("limit", "250"))
            except ValueError as exc:
                raise ApiError(400, "invalid_cursor", "Курсор и лимит должны быть целыми числами") from exc
            if after_event_id < 0 or limit < 1 or limit > 500:
                raise ApiError(400, "invalid_cursor", "Курсор должен быть неотрицательным, лимит — от 1 до 500")
            result = load_entity_changes(
                workspace_id,
                warehouse_id,
                environment,
                after_event_id,
                limit,
                auth,
            )
            self.send_json(
                200,
                {
                    "ok": True,
                    "workspace_id": workspace_id,
                    "warehouse_id": warehouse_id,
                    "environment": environment,
                    **result,
                },
            )
            return
        raise ApiError(404, "not_found", "Маршрут API не найден")

    def _run(self) -> None:
        try:
            self.dispatch()
        except ApiError as exc:
            payload = {"ok": False, "error": exc.code, "message": exc.message}
            if exc.details:
                payload["details"] = exc.details
            self.send_json(exc.status, payload)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            LOG.exception("unhandled request failure")
            self.send_json(500, {"ok": False, "error": "internal_error", "message": "Внутренняя ошибка сервера"})

    do_GET = _run
    do_HEAD = _run
    do_PUT = _run
    do_POST = _run
    do_DELETE = _run


def main() -> None:
    required = ("JF_DB_DSN", "JF_API_KEY_SHA256", "JF_INSTALLATION_ID", "JF_VPS_ATTESTATION_SECRET")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise SystemExit("Missing required configuration: " + ", ".join(missing))
    try:
        _require_vps_attestation_secret()
    except ApiError as exc:
        raise SystemExit("Invalid JF_VPS_ATTESTATION_SECRET configuration") from exc
    init_schema()
    start_warehouse_delete_release_worker()
    host = os.environ.get("JF_LISTEN_HOST", "127.0.0.1")
    port = int(os.environ.get("JF_LISTEN_PORT", "8792"))
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    LOG.info("service %s listening on %s:%s", VERSION, host, port)
    server.serve_forever()


if __name__ == "__main__":
    main()
