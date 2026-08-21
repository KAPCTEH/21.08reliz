PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chat_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  UNIQUE(warehouse_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_bindings_target ON chat_bindings(warehouse_id, entity_type, entity_id, active);
CREATE INDEX IF NOT EXISTS idx_chat_bindings_chat ON chat_bindings(warehouse_id, chat_id, active);

CREATE TABLE IF NOT EXISTS link_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  warehouse_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('driver','warehouse')),
  entity_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_chat_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_link_codes_expiry ON link_codes(expires_at, used_at);
CREATE INDEX IF NOT EXISTS idx_link_codes_target ON link_codes(warehouse_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL,
  route_id TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL CHECK(actor IN ('driver','warehouse','system')),
  entity_type TEXT NOT NULL CHECK(entity_type IN ('driver','warehouse')),
  entity_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'sending',
  status_at TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_route ON notifications(warehouse_id, route_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(warehouse_id, entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_poll ON events(warehouse_id, id);

CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  claim_token TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT NOT NULL DEFAULT ''
);
