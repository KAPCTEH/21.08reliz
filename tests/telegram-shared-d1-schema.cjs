'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

const database = new DatabaseSync(':memory:');
const migrations = ['0001_init.sql', '0002_shared_installations.sql'];
for (const name of migrations) {
  database.exec(fs.readFileSync(path.resolve(
    __dirname,
    '../source/application/integrations/telegram-cloudflare-native/migrations',
    name
  ), 'utf8'));
}

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

database.close();
console.log(JSON.stringify({
  ok: true,
  migrationsApply: true,
  oneWarehousePerCompanyScope: true,
  telegramUpdateIsolation: true,
  idempotencyIsolation: true
}));
