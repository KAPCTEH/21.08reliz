'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const provisioner = require('../source/application/integrations/telegram-cloudflare-native/provisioner.cjs');

const migrations = ['0001_init.sql', '0002_shared_installations.sql', '0003_deprovision.sql'];
function createMigratedDatabase() {
  const result = new DatabaseSync(':memory:');
  for (const name of migrations) {
    const sql = fs.readFileSync(path.resolve(
      __dirname,
      '../source/application/integrations/telegram-cloudflare-native/migrations',
      name
    ), 'utf8');
    for (const statement of provisioner.splitSql(sql)) result.exec(statement);
  }
  return result;
}
const database = createMigratedDatabase();

const now = '2026-08-15T00:00:00.000Z';
const insertInstallation = database.prepare(`
  INSERT INTO telegram_installations(
    installation_id,company_id,warehouse_id,worker_name,schema_version,created_at,updated_at
  ) VALUES(?,?,?,?,2,?,?)
`);
insertInstallation.run('inst-spb-0001', 'company-01', 'live--spb', 'worker-spb', now, now);
insertInstallation.run('inst-msk-0001', 'company-01', 'live--msk', 'worker-msk', now, now);
assert.throws(
  () => insertInstallation.run('inst-spb-other', 'company-01', 'live--spb', 'worker-other', now, now),
  /UNIQUE/
);

const insertUpdate = database.prepare(`
  INSERT INTO telegram_updates_v2(
    installation_id,company_id,warehouse_id,update_id,status,attempts,claim_token,received_at,last_error
  ) VALUES(?,?,?,?, 'processing',1,?,?, '')
`);
insertUpdate.run('inst-spb-0001', 'company-01', 'live--spb', 777, 'claim-spb', now);
insertUpdate.run('inst-msk-0001', 'company-01', 'live--msk', 777, 'claim-msk', now);
assert.equal(database.prepare('SELECT COUNT(*) AS total FROM telegram_updates_v2 WHERE update_id=777').get().total, 2);

const insertNotification = database.prepare(`
  INSERT INTO notifications_v2(
    installation_id,company_id,warehouse_id,id,route_id,actor,entity_type,entity_id,chat_id,
    idempotency_key,status,status_at,lease_until,created_at,updated_at
  ) VALUES(?,?,?,?,?,'warehouse','warehouse',?,?,?,'sending',?,?,?,?)
`);
insertNotification.run('inst-spb-0001', 'company-01', 'live--spb', 'note-1', 'route-1', 'spb', '1001', 'same-key', now, now, now, now);
insertNotification.run('inst-msk-0001', 'company-01', 'live--msk', 'note-1', 'route-1', 'msk', '2001', 'same-key', now, now, now, now);
assert.equal(database.prepare('SELECT COUNT(*) AS total FROM notifications_v2 WHERE idempotency_key=?').get('same-key').total, 2);
assert.throws(
  () => insertNotification.run('inst-spb-0001', 'company-01', 'live--spb', 'note-2', 'route-2', 'spb', '1001', 'same-key', now, now, now, now),
  /UNIQUE/
);

database.exec(`
  INSERT INTO telegram_legacy_claims(source_key,installation_id,claimed_at)
    VALUES('warehouse:company-01:live--spb','inst-spb-0001','${now}');
  INSERT INTO telegram_legacy_claims(source_key,installation_id,claimed_at)
    VALUES('telegram_updates:global','inst-spb-0001','${now}');
  INSERT INTO chat_bindings(warehouse_id,entity_type,entity_id,chat_id,created_at,updated_at)
    VALUES('live--spb','driver','legacy-driver-spb','legacy-chat-spb','${now}','${now}');
  INSERT INTO link_codes(id,code_hash,warehouse_id,entity_type,entity_id,expires_at,created_at)
    VALUES('legacy-link-spb','legacy-hash-spb','live--spb','driver','legacy-driver-spb','${now}','${now}');
  INSERT INTO notifications(
    id,warehouse_id,actor,entity_type,entity_id,chat_id,idempotency_key,status_at,
    lease_until,payload_json,created_at,updated_at
  ) VALUES(
    'legacy-note-spb','live--spb','driver','driver','legacy-driver-spb','legacy-chat-spb',
    'legacy-idempotency-spb','${now}','${now}','{"private":"payload"}','${now}','${now}'
  );
  INSERT INTO events(warehouse_id,event_type,chat_id,user_id,payload_json,created_at)
    VALUES('live--spb','legacy_event','legacy-chat-spb','legacy-user-spb','{"private":"event"}','${now}');
  INSERT INTO telegram_updates(update_id,received_at,last_error)
    VALUES(991,'${now}','legacy private error');
  INSERT INTO chat_bindings(warehouse_id,entity_type,entity_id,chat_id,created_at,updated_at)
    VALUES('live--msk','driver','legacy-driver-msk','legacy-chat-msk','${now}','${now}');
  INSERT INTO events(warehouse_id,event_type,chat_id,user_id,payload_json,created_at)
    VALUES('live--msk','legacy_event','legacy-chat-msk','legacy-user-msk','{"keep":true}','${now}');
  INSERT INTO telegram_provisioning_operations(
    operation_id,installation_id,company_id,warehouse_id,worker_name,stage,status,
    error_code,error_message,created_at,updated_at
  ) VALUES(
    'operation-spb','inst-spb-0001','company-01','live--spb','worker-spb','active','active',
    '','','${now}','${now}'
  );
`);

database.prepare(`
  INSERT INTO telegram_deprovision_markers(
    installation_id,company_id,warehouse_id,status,attempt_count,last_error_code,
    requested_at,deprovisioned_at,updated_at
  ) VALUES(?,?,?,'deprovisioning',1,'',?,NULL,?)
`).run('inst-spb-0001', 'company-01', 'live--spb', now, now);
assert.throws(
  () => insertNotification.run('inst-spb-0001', 'company-01', 'live--spb', 'note-blocked', 'route-3', 'spb', '1001', 'blocked-key', now, now, now, now),
  /TELEGRAM_INSTALLATION_DEPROVISIONED/
);
assert.throws(
  () => database.prepare(`
    INSERT INTO chat_bindings(warehouse_id,entity_type,entity_id,chat_id,created_at,updated_at)
    VALUES('live--spb','driver','blocked-legacy-driver','blocked-legacy-chat',?,?)
  `).run(now, now),
  /TELEGRAM_INSTALLATION_DEPROVISIONED/
);
assert.throws(
  () => database.prepare(`
    INSERT INTO telegram_updates(update_id,received_at)
    VALUES(992,?)
  `).run(now),
  /TELEGRAM_INSTALLATION_DEPROVISIONED/
);
assert.throws(
  () => database.prepare(`
    UPDATE telegram_deprovision_markers
    SET status='deprovisioned',deprovisioned_at=?,updated_at=?
    WHERE installation_id='inst-spb-0001'
  `).run(now, now),
  /TELEGRAM_DEPROVISION_PURGE_INCOMPLETE/
);
database.exec(`
  DELETE FROM notifications_v2 WHERE installation_id='inst-spb-0001';
  DELETE FROM telegram_updates_v2 WHERE installation_id='inst-spb-0001';
`);
assert.throws(
  () => database.prepare(`
    UPDATE telegram_deprovision_markers
    SET status='deprovisioned',deprovisioned_at=?,updated_at=?
    WHERE installation_id='inst-spb-0001'
  `).run(now, now),
  /TELEGRAM_DEPROVISION_PURGE_INCOMPLETE/
);
database.exec(`
  DELETE FROM chat_bindings
    WHERE warehouse_id='live--spb' AND EXISTS (
      SELECT 1 FROM telegram_legacy_claims
      WHERE source_key='warehouse:company-01:live--spb' AND installation_id='inst-spb-0001'
    );
  DELETE FROM link_codes
    WHERE warehouse_id='live--spb' AND EXISTS (
      SELECT 1 FROM telegram_legacy_claims
      WHERE source_key='warehouse:company-01:live--spb' AND installation_id='inst-spb-0001'
    );
  DELETE FROM notifications
    WHERE warehouse_id='live--spb' AND EXISTS (
      SELECT 1 FROM telegram_legacy_claims
      WHERE source_key='warehouse:company-01:live--spb' AND installation_id='inst-spb-0001'
    );
  DELETE FROM events
    WHERE warehouse_id='live--spb' AND EXISTS (
      SELECT 1 FROM telegram_legacy_claims
      WHERE source_key='warehouse:company-01:live--spb' AND installation_id='inst-spb-0001'
    );
  DELETE FROM telegram_updates
    WHERE EXISTS (
      SELECT 1 FROM telegram_legacy_claims
      WHERE source_key='telegram_updates:global' AND installation_id='inst-spb-0001'
    );
  DELETE FROM telegram_provisioning_operations
    WHERE installation_id='inst-spb-0001' AND company_id='company-01' AND warehouse_id='live--spb';
`);
database.prepare(`
  UPDATE telegram_deprovision_markers
  SET status='deprovisioned',deprovisioned_at=?,updated_at=?
  WHERE installation_id='inst-spb-0001'
`).run(now, now);
assert.equal(database.prepare("SELECT status FROM telegram_deprovision_markers WHERE installation_id='inst-spb-0001'").get().status, 'deprovisioned');
assert.equal(database.prepare("SELECT COUNT(*) AS total FROM notifications_v2 WHERE installation_id='inst-msk-0001'").get().total, 1);
assert.equal(database.prepare("SELECT COUNT(*) AS total FROM telegram_updates_v2 WHERE installation_id='inst-msk-0001'").get().total, 1);
assert.equal(database.prepare("SELECT COUNT(*) AS total FROM chat_bindings WHERE warehouse_id='live--spb'").get().total, 0);
assert.equal(database.prepare("SELECT COUNT(*) AS total FROM events WHERE warehouse_id='live--spb'").get().total, 0);
assert.equal(database.prepare("SELECT COUNT(*) AS total FROM telegram_updates").get().total, 0);
assert.equal(database.prepare("SELECT COUNT(*) AS total FROM chat_bindings WHERE warehouse_id='live--msk'").get().total, 1);
assert.equal(database.prepare("SELECT COUNT(*) AS total FROM events WHERE warehouse_id='live--msk'").get().total, 1);
assert.equal(database.prepare("SELECT COUNT(*) AS total FROM telegram_installations WHERE installation_id='inst-spb-0001'").get().total, 1);
assert.equal(database.prepare("SELECT COUNT(*) AS total FROM telegram_legacy_claims WHERE installation_id='inst-spb-0001'").get().total, 2);
assert.throws(
  () => database.prepare("DELETE FROM telegram_installations WHERE installation_id='inst-spb-0001'").run(),
  /TELEGRAM_INSTALLATION_DEPROVISIONED/
);
assert.throws(
  () => database.prepare("DELETE FROM telegram_legacy_claims WHERE installation_id='inst-spb-0001'").run(),
  /TELEGRAM_INSTALLATION_DEPROVISIONED/
);
assert.throws(
  () => insertInstallation.run('inst-spb-new', 'company-01', 'live--spb', 'worker-new', now, now),
  /TELEGRAM_INSTALLATION_DEPROVISIONED/
);
assert.throws(
  () => database.prepare("DELETE FROM telegram_deprovision_markers WHERE installation_id='inst-spb-0001'").run(),
  /TELEGRAM_DEPROVISION_MARKER_IMMUTABLE/
);

database.close();

const ambiguousDatabase = createMigratedDatabase();
ambiguousDatabase.exec(`
  INSERT INTO telegram_installations(
    installation_id,company_id,warehouse_id,worker_name,schema_version,created_at,updated_at
  ) VALUES('inst-company-a','company-a','live--shared','worker-a',3,'${now}','${now}');
  INSERT INTO telegram_installations(
    installation_id,company_id,warehouse_id,worker_name,schema_version,created_at,updated_at
  ) VALUES('inst-company-b','company-b','live--shared','worker-b',3,'${now}','${now}');
  INSERT INTO telegram_legacy_claims(source_key,installation_id,claimed_at)
    VALUES('warehouse:company-a:live--shared','inst-company-a','${now}');
  INSERT INTO telegram_legacy_claims(source_key,installation_id,claimed_at)
    VALUES('warehouse:company-b:live--shared','inst-company-b','${now}');
  INSERT INTO events(warehouse_id,event_type,chat_id,user_id,payload_json,created_at)
    VALUES('live--shared','legacy_event','shared-chat','shared-user','{"ambiguous":true}','${now}');
  INSERT INTO telegram_deprovision_markers(
    installation_id,company_id,warehouse_id,status,attempt_count,last_error_code,
    requested_at,deprovisioned_at,updated_at
  ) VALUES('inst-company-a','company-a','live--shared','deprovisioning',1,'','${now}',NULL,'${now}');
  INSERT INTO chat_bindings(warehouse_id,entity_type,entity_id,chat_id,created_at,updated_at)
    VALUES('live--shared','driver','company-b-driver','company-b-chat','${now}','${now}');
  DELETE FROM events
  WHERE warehouse_id='live--shared'
    AND EXISTS (
      SELECT 1 FROM telegram_legacy_claims
      WHERE source_key='warehouse:company-a:live--shared' AND installation_id='inst-company-a'
    )
    AND NOT EXISTS (
      SELECT 1 FROM telegram_legacy_claims
      WHERE installation_id!='inst-company-a'
        AND substr(source_key,1,10)='warehouse:'
        AND substr(source_key,-(length('live--shared')+1))=(':' || 'live--shared')
    );
`);
assert.equal(ambiguousDatabase.prepare("SELECT COUNT(*) AS total FROM events WHERE warehouse_id='live--shared'").get().total, 1);
assert.equal(ambiguousDatabase.prepare("SELECT COUNT(*) AS total FROM chat_bindings WHERE warehouse_id='live--shared'").get().total, 1);
assert.throws(
  () => ambiguousDatabase.prepare(`
    UPDATE telegram_deprovision_markers
    SET status='deprovisioned',deprovisioned_at=?,updated_at=?
    WHERE installation_id='inst-company-a'
  `).run(now, now),
  /TELEGRAM_DEPROVISION_PURGE_INCOMPLETE/
);
ambiguousDatabase.close();

console.log(JSON.stringify({
  ok: true,
  migrationsApply: true,
  oneWarehousePerCompanyScope: true,
  telegramUpdateIsolation: true,
  idempotencyIsolation: true,
  deprovisionMarkerDurable: true,
  deprovisionWriteBarrier: true,
  exactInstallationPurge: true,
  claimedLegacyDataPurged: true,
  unclaimedLegacyDataPreserved: true,
  ambiguousLegacyOwnershipFailsClosed: true,
  deprovisionTombstoneBlocksReprovision: true
}));
