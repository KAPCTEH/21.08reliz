PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS telegram_installations (
  installation_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS telegram_provisioning_operations (
  operation_id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','active','failed','rolled_back')),
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tg_provisioning_installation ON telegram_provisioning_operations(installation_id, updated_at);

CREATE TABLE IF NOT EXISTS telegram_legacy_claims (
  source_key TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_bindings_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('driver','warehouse')),
  entity_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  chat_type TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(installation_id, warehouse_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_bindings_v2_target ON chat_bindings_v2(installation_id, company_id, warehouse_id, entity_type, entity_id, active);
CREATE INDEX IF NOT EXISTS idx_chat_bindings_v2_chat ON chat_bindings_v2(installation_id, warehouse_id, chat_id, active);

CREATE TABLE IF NOT EXISTS link_codes_v2 (
  installation_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('driver','warehouse')),
  entity_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_chat_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(installation_id, id),
  UNIQUE(installation_id, code_hash)
);
CREATE INDEX IF NOT EXISTS idx_link_codes_v2_expiry ON link_codes_v2(installation_id, expires_at, used_at);
CREATE INDEX IF NOT EXISTS idx_link_codes_v2_target ON link_codes_v2(installation_id, warehouse_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS notifications_v2 (
  installation_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  id TEXT NOT NULL,
  route_id TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL CHECK(actor IN ('driver','warehouse','system')),
  entity_type TEXT NOT NULL CHECK(entity_type IN ('driver','warehouse')),
  entity_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id INTEGER,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sending',
  status_at TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(installation_id, id),
  UNIQUE(installation_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_v2_route ON notifications_v2(installation_id, warehouse_id, route_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_v2_target ON notifications_v2(installation_id, warehouse_id, entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS events_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  route_id TEXT NOT NULL DEFAULT '',
  notification_id TEXT NOT NULL DEFAULT '',
  chat_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  legacy_source_id TEXT,
  UNIQUE(installation_id, legacy_source_id)
);
CREATE INDEX IF NOT EXISTS idx_events_v2_poll ON events_v2(installation_id, company_id, warehouse_id, id);

CREATE TABLE IF NOT EXISTS telegram_updates_v2 (
  installation_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  update_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  claim_token TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(installation_id, update_id)
);
CREATE INDEX IF NOT EXISTS idx_telegram_updates_v2_retention ON telegram_updates_v2(installation_id, received_at);
