#!/usr/bin/env python3
"""JustFun Orders Logistics server-authoritative business data service 7.8.3."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import math
import os
import re
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

VERSION = "7.8.3"
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
AUTH_CACHE_SECONDS = max(5, min(60, int(os.environ.get("JF_AUTH_CACHE_SECONDS", "20"))))
NOMINATIM_ORIGIN = os.environ.get("JF_NOMINATIM_ORIGIN", "https://nominatim.openstreetmap.org").rstrip("/")
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
ENTITY_CHANGES_PATH_RE = re.compile(
    r"^/v1/workspaces/([A-Za-z0-9_-]{16,80})/warehouses/([A-Za-z0-9_-]{1,120})/changes/(live|demo)$"
)
ADDRESS_SEARCH_PATH_RE = re.compile(
    r"^/v1/workspaces/([A-Za-z0-9_-]{16,80})/warehouses/([A-Za-z0-9_-]{1,120})/address-search/(live|demo)$"
)
ENTITY_TYPE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
ENTITY_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,160}$")
COMMAND_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{16,180}$")
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
ENTITY_INTENT_KINDS = {
    "route_approve",
    "route_picking",
    "route_cancel",
    "route_start",
    "route_return",
    "route_close",
    "pickup_ready",
    "pickup_collected",
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


def set_database_scope(cur, workspace_id: str, environment: str, auth: dict) -> None:
    """Applies transaction-local RLS context; it cannot leak through the pool."""
    permissions = {str(value) for value in auth.get("permissions", set())}
    owner = auth.get("role") == "owner" or "*" in permissions or "jf.warehouse:*" in permissions
    allowed = {
        value.partition("jf.warehouse:")[2]
        for value in permissions
        if value.startswith("jf.warehouse:") and value.partition("jf.warehouse:")[2]
    }
    cur.execute(
        """
        SELECT set_config('jf.workspace_id', %s, true),
               set_config('jf.environment', %s, true),
               set_config('jf.owner', %s, true),
               set_config('jf.allowed_warehouses', %s, true)
        """,
        (workspace_id, environment, "1" if owner else "0", ",".join(sorted(allowed))),
    )


def init_schema() -> None:
    with db_connect() as conn, conn.cursor() as cur:
        # Business data in the previous local/snapshot protocol is test-only and
        # intentionally not migrated. Dropping it also prevents accidental reads
        # from bypassing the authoritative record/event protocol.
        cur.execute("DROP TABLE IF EXISTS processed_commands CASCADE")
        cur.execute("DROP TABLE IF EXISTS workspace_change_events CASCADE")
        cur.execute("DROP TABLE IF EXISTS workspace_entities CASCADE")
        cur.execute("DROP TABLE IF EXISTS warehouse_snapshots CASCADE")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version integer PRIMARY KEY,
              name varchar(160) NOT NULL,
              applied_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
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
            "business_audit_v3",
        ):
            cur.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
            cur.execute(f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY")
            cur.execute(f"DROP POLICY IF EXISTS jf_scope_isolation ON {table_name}")
            cur.execute(
                f"CREATE POLICY jf_scope_isolation ON {table_name} FOR ALL USING ({scope_policy}) WITH CHECK ({scope_policy})"
            )
        cur.execute(
            """
            INSERT INTO schema_migrations(version, name)
            VALUES (300, 'server authoritative business storage v3')
            ON CONFLICT (version) DO NOTHING
            """
        )


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


def require_workspace(auth: dict, workspace_id: str) -> None:
    if not hmac.compare_digest(str(auth["company_id"]), workspace_id):
        raise ApiError(403, "workspace_mismatch", "Данные другой компании недоступны")


def warehouse_allowed(auth: dict, warehouse_id: str, snapshot: dict) -> bool:
    permissions = auth["permissions"]
    if auth["role"] == "owner" or "*" in permissions or "jf.warehouse:*" in permissions:
        return True
    if f"jf.warehouse:{warehouse_id}" in permissions:
        return True
    warehouse = snapshot.get("warehouse", {}) if isinstance(snapshot, dict) else {}
    code = str(warehouse.get("code", "")).strip().upper()
    return bool(code) and f"jf.warehouse-code:{code}" in permissions


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
    if entity_type == "warehouse" and not write:
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
    if current and changed & ENTITY_IMMUTABLE_FIELDS:
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
    if current_payload and changed & ENTITY_IMMUTABLE_FIELDS:
        raise ApiError(
            409,
            "immutable_entity_field",
            "Нельзя изменить идентификатор, склад, среду или дату создания записи",
            {"entity_type": entity_type, "entity_id": item["id"], "fields": sorted(changed & ENTITY_IMMUTABLE_FIELDS)},
        )
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
    payload = canonical_entity_payload(entity_type, entity_id, payload, warehouse_id, environment)
    return {
        "type": entity_type,
        "id": entity_id,
        "base_version": base_version,
        "deleted": deleted,
        "payload": payload,
        "digest_sha256": entity_payload_digest(payload, deleted),
    }


def list_warehouses(workspace_id: str, environment: str, auth: dict) -> list[dict]:
    with db_connect() as conn, conn.cursor() as cur:
        set_database_scope(cur, workspace_id, environment, auth)
        cur.execute(
            """
            SELECT warehouse_id, version, payload_sha256, payload, last_event_id, updated_at
            FROM business_records_v3
            WHERE workspace_id=%s AND environment=%s
              AND entity_type='warehouse' AND is_deleted=false
            ORDER BY updated_at DESC
            """,
            (workspace_id, environment),
        )
        entity_rows = cur.fetchall()
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
                "revision": 0,
                "entity_version": int(version),
                "change_cursor": int(event_id),
                "digest_sha256": str(digest),
                "updated_at": updated_at.isoformat(),
                "sync_mode": "server_authoritative_v3",
            }
        )
    return sorted(warehouses, key=lambda item: item["updated_at"], reverse=True)


def load_entity_access_snapshot(workspace_id: str, warehouse_id: str, environment: str, auth: dict) -> dict | None:
    with db_connect() as conn, conn.cursor() as cur:
        set_database_scope(cur, workspace_id, environment, auth)
        cur.execute(
            """
            SELECT payload
            FROM business_records_v3
            WHERE workspace_id=%s AND warehouse_id=%s AND environment=%s
              AND entity_type='warehouse' AND entity_id=%s AND is_deleted=false
            """,
            (workspace_id, warehouse_id, environment, warehouse_id),
        )
        row = cur.fetchone()
        if row and isinstance(row[0], dict):
            return {"warehouse": row[0], "data": {"warehouseId": warehouse_id}}
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
) -> None:
    snapshot = load_entity_access_snapshot(workspace_id, warehouse_id, environment, auth)
    if snapshot is None and isinstance(proposed_warehouse, dict):
        snapshot = {"warehouse": proposed_warehouse, "data": {"warehouseId": warehouse_id}}
    if snapshot is None:
        snapshot = {
            "warehouse": {"id": warehouse_id, "code": "", "environment": environment},
            "data": {"warehouseId": warehouse_id},
        }
    if not warehouse_allowed(auth, warehouse_id, snapshot):
        raise ApiError(403, "warehouse_access_denied", "Нет доступа к этому складу")


def save_entity_batch(
    workspace_id: str,
    warehouse_id: str,
    environment: str,
    request: dict,
    auth: dict,
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
    intent = validate_entity_intent(request.get("intent"), changes)
    proposed_warehouse = next(
        (item["payload"] for item in changes if item["type"] == "warehouse" and not item["deleted"]),
        None,
    )
    require_entity_scope_access(auth, workspace_id, warehouse_id, environment, proposed_warehouse)
    intent_types: set[str] = set()
    if intent:
        required_permission = ENTITY_INTENT_PERMISSIONS[intent["kind"]]
        if not permission_allowed(auth, required_permission):
            raise ApiError(403, "intent_access_denied", "Нет права выполнить этот переход состояния")
        intent_types = ENTITY_INTENT_TYPES[intent["kind"]]
    for item in changes:
        if item["type"] not in intent_types:
            require_entity_permission(auth, item["type"], write=True)

    actor_id = str(auth.get("user_id", ""))[:160] or "unknown-user"
    device_id = str(auth.get("device_id", ""))[:200]
    request_sha256 = hashlib.sha256(
        json.dumps(request, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    scope_lock = f"{workspace_id}:{warehouse_id}:{environment}"
    outcomes: list[dict] = []
    with db_connect() as conn, conn.cursor() as cur:
        set_database_scope(cur, workspace_id, environment, auth)
        cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s), hashtext(%s))", (scope_lock, command_id))
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
            "replayed": False,
        }
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
                str(intent.get("kind") if intent else "entity_batch"),
                len(outcomes),
                Json({"types": sorted({item["type"] for item in changes}), "cursor": cursor}),
            ),
        )
        cur.execute(
            "SELECT pg_notify('jf_business_events', %s)",
            (json.dumps({"workspace": workspace_id, "warehouse": warehouse_id, "environment": environment, "cursor": cursor}),),
        )
    return result


def load_current_entities(workspace_id: str, warehouse_id: str, environment: str, auth: dict) -> dict:
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
    readable_types = sorted(entity_type for entity_type in ENTITY_SECTIONS if entity_permission_allowed(auth, entity_type, write=False))
    return {"cursor": cursor, "entities": entities, "readable_types": readable_types}


def load_entity_changes(
    workspace_id: str,
    warehouse_id: str,
    environment: str,
    after_event_id: int,
    limit: int,
    auth: dict,
) -> dict:
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
        if entity_permission_allowed(auth, entity_type, write=False)
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
    elif request["interaction"] == "explicit":
        rows = nominatim_rows(proxy_geocode({"mode": "search", "query": request["original_query"], "limit": 10, "addressOnly": True}), request, queried_at)
        provider = {"name": "nominatim", "api_version": "search-jsonv2", "reference": "openstreetmap", "queried_at": queried_at.isoformat().replace("+00:00", "Z"), "cache_ttl_seconds": 24 * 60 * 60}
    else:
        raise ApiError(503, "address_autocomplete_not_configured", "Автоподсказки адресов ещё не подключены. Нажмите кнопку поиска")
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
    server_version = "JustFunOrdersLogistics/7.8.3"

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
                self.send_json(
                    200,
                    {
                        "ok": True,
                        "service": "orders-logistics-reg-vps",
                        "version": VERSION,
                        "database": "ready",
                        "api_contract": API_CONTRACT,
                        "address_contract": ADDRESS_API_CONTRACT,
                        "address_provider": "dadata" if DADATA_API_KEY else "nominatim-explicit-only",
                        "address_autocomplete": bool(DADATA_API_KEY),
                        "address_storage": "transient-memory-cache",
                        "storage_mode": "server_authoritative_v3",
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
            self.send_json(
                200,
                {
                    "ok": True,
                    "workspace_id": workspace_id,
                    "environment": environment,
                    "warehouses": list_warehouses(workspace_id, environment, auth),
                },
            )
            return
        decoded_path = unquote(target.path)
        address_match = ADDRESS_SEARCH_PATH_RE.fullmatch(decoded_path)
        if address_match:
            if self.command != "POST":
                raise ApiError(405, "method_not_allowed", "Адресный поиск требует POST")
            workspace_id, warehouse_id, environment = address_match.groups()
            require_workspace(auth, workspace_id)
            require_entity_scope_access(auth, workspace_id, warehouse_id, environment)
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
                result = save_entity_batch(workspace_id, warehouse_id, environment, request, auth)
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
            require_entity_scope_access(auth, workspace_id, warehouse_id, environment)
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
    required = ("JF_DB_DSN", "JF_API_KEY_SHA256", "JF_INSTALLATION_ID")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise SystemExit("Missing required configuration: " + ", ".join(missing))
    init_schema()
    host = os.environ.get("JF_LISTEN_HOST", "127.0.0.1")
    port = int(os.environ.get("JF_LISTEN_PORT", "8792"))
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    LOG.info("service %s listening on %s:%s", VERSION, host, port)
    server.serve_forever()


if __name__ == "__main__":
    main()
