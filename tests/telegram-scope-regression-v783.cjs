'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const provisioner = require('../source/application/integrations/telegram-cloudflare-native/provisioner.cjs');

const mskScope = 'cmp_company:live:warehouse_msk';
const spbScope = 'cmp_company:live:warehouse_spb';
const otherCompanyScope = 'cmp_other:live:warehouse_msk';
const mskWorker = provisioner.scopedResourceName('justfun-logistics-bot', mskScope);
const spbWorker = provisioner.scopedResourceName('justfun-logistics-bot', spbScope);
const otherCompanyWorker = provisioner.scopedResourceName('justfun-logistics-bot', otherCompanyScope);

assert.notEqual(mskWorker, spbWorker);
assert.notEqual(mskWorker, otherCompanyWorker);
assert.match(mskWorker, /^justfun-logistics-bot-[a-f0-9]{12}$/);
assert.ok(mskWorker.length <= 63);
assert.equal(provisioner.sharedDatabaseName(mskScope), provisioner.sharedDatabaseName(spbScope));
assert.equal(provisioner.sharedDatabaseName(), 'justfun-logistics-bot-db');
const databases = [
  {uuid: 'db-bbb', name: 'justfun-logistics-bot-db-bbb'},
  {uuid: 'db-aaa', name: 'justfun-logistics-bot-db-aaa'},
];
const mskDatabase = provisioner.selectSharedDatabase(databases, 'db-bbb');
const spbDatabase = provisioner.selectSharedDatabase(databases, 'db-aaa');
assert.equal(mskDatabase.database.uuid, 'db-aaa');
assert.equal(spbDatabase.database.uuid, 'db-aaa');
assert.equal(mskDatabase.legacySourceDatabaseId, 'db-bbb');
assert.equal(spbDatabase.legacySourceDatabaseId, '');

const main = fs.readFileSync(path.resolve(__dirname, '../source/application/main.js'), 'utf8');
const renderer = fs.readFileSync(path.resolve(__dirname, '../source/application/web/assets/js/110-desktop-platform-v750.js'), 'utf8');
assert.match(main, /company-\$\{scope\.companyId\}/);
assert.match(main, /warehouse-\$\{scope\.environment\}-\$\{scope\.warehouseId\}/);
assert.match(main, /telegramClientApiKey\.\$\{scope\.companyId\}\.\$\{scope\.environment\}\.\$\{scope\.warehouseId\}/);
assert.match(main, /String\(legacy\.company_id\|\|''\)!==scope\.companyId/);
assert.match(main, /String\(legacy\.warehouse_id\|\|''\)!==scope\.warehouseId/);
assert.match(main, /company\.telegram_services/);
assert.match(main, /services\[scopedWarehouseId\]=published\.service/);
assert.match(main, /String\(legacy\.warehouse_id\|\|''\)===requested\?legacy:null/);
assert.doesNotMatch(main, /scoped==='\*'/);
assert.match(main, /resourceScope:scope\.key/);
assert.match(main, /warehouseId:telegramWarehouseScope\(scope\.warehouseId,scope\.environment\)/);
assert.match(main, /0002_shared_installations\.sql/);
assert.match(main, /code:String\(error\?\.code\|\|'TELEGRAM_POLL_FAILED'\)/);
assert.match(renderer, /if\(!result\?\.ok\)throw Object\.assign\(new Error/);
assert.match(renderer, /telegramPollFailures>=7/);

console.log(JSON.stringify({
  ok: true,
  perCompanyWarehouseState: true,
  perCompanyWarehouseSecret: true,
  uniqueWorkerNames: true,
  sharedDatabase: true,
  unsafeLegacyAutolinkBlocked: true,
  boundedPolling: true,
}));
