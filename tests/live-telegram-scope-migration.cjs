'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, safeStorage } = require('electron');
const provisioner = require('../source/application/integrations/telegram-cloudflare-native/provisioner.cjs');

const APPLY = process.env.JF_TELEGRAM_MIGRATION_APPLY === '1';
const secretsPath = process.env.JF_TEST_SECRETS_PATH || 'C:\\Users\\zvd1\\.justfun-test-secrets.json';
const nativeSecretsPath = process.env.JF_NATIVE_SECRETS_PATH || 'C:\\Users\\zvd1\\AppData\\Local\\JustFun\\OrdersLogistics\\integrations\\native-secrets.json';
const profilePath = process.env.JF_APP_USER_DATA_PATH || 'C:\\Users\\zvd1\\Documents\\JustFun\\Заказы и логистика\\.desktop-profile-v750';
const localIntegrationRoot = path.dirname(nativeSecretsPath);
const reportPath = process.env.JF_TELEGRAM_MIGRATION_REPORT || '';
const progressPath = reportPath ? `${reportPath}.progress.json` : '';
const secrets = JSON.parse(fs.readFileSync(path.resolve(secretsPath), 'utf8'));
const cloudflareToken = String(secrets?.cloudflare?.apiToken || '').trim();
let accountId = String(secrets?.cloudflare?.accountId || '').trim();
const companyId = 'cmp_60bae5ca57264515aa9daa9e6d8ad72f';
const targets = [
  {
    label: 'SPB',
    warehouseId: '2c09ae10-9b0f-44f3-a254-d0fb5c1d2a2c',
    warehouseName: 'Склад Санкт-Петербург',
    token: String(secrets?.telegramSPB?.botToken || '').trim(),
  },
  {
    label: 'MSK',
    warehouseId: 'e476f946-91e4-42a7-80d0-43aa17788020',
    warehouseName: 'Москва',
    token: String(secrets?.telegramMSK?.botToken || '').trim(),
  },
];
if (!cloudflareToken || targets.some(item => !item.token)) throw new Error('Telegram migration credentials are incomplete');

function sha(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
}

async function cf(method, requestPath, body = null) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${requestPath}`, {
    method,
    headers: {
      authorization: `Bearer ${cloudflareToken}`,
      accept: 'application/json',
      ...(body === null ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success !== true) {
    const code = payload?.errors?.[0]?.code || response.status;
    throw new Error(`Cloudflare request failed: ${code}`);
  }
  return payload.result;
}

function queryRows(result) {
  const first = Array.isArray(result) ? result[0] : result;
  return Array.isArray(first?.results) ? first.results : [];
}

async function query(databaseId, sql, params = []) {
  return queryRows(await cf('POST', `/accounts/${accountId}/d1/database/${databaseId}/query`, { sql, params }));
}

async function telegram(token, method, body = null) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body === null ? 'GET' : 'POST',
    headers: body === null ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) throw new Error(`Telegram ${method} failed: ${payload?.error_code || response.status}`);
  return payload.result;
}

async function worker(baseUrl, clientKey, requestPath) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    headers: { accept: 'application/json', authorization: `Bearer ${clientKey}` },
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(`Telegram Worker check failed: ${payload?.code || response.status}`);
  return payload;
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function checkpoint(stage, details = {}) {
  if (!progressPath) return;
  atomicJson(progressPath, { stage, at: new Date().toISOString(), ...details });
}

function clientKeyFromNativeStore() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows protected storage is unavailable');
  const store = JSON.parse(fs.readFileSync(nativeSecretsPath, 'utf8'));
  const encoded = String(store.telegramClientApiKey || '');
  if (!encoded) throw new Error('Legacy Telegram client key is unavailable');
  return { store, clientKey: safeStorage.decryptString(Buffer.from(encoded, 'base64')) };
}

async function databaseByName(name) {
  const databases = await cf('GET', `/accounts/${accountId}/d1/database?per_page=100`);
  const found = (Array.isArray(databases) ? databases : []).find(item => String(item?.name || '') === name);
  if (!found?.uuid) throw new Error(`Cloudflare D1 not found: ${name}`);
  return found;
}

async function backupDatabases(brokerDb, legacyDb, brokerRows, legacyBindings) {
  const backupRoot = path.join(path.dirname(localIntegrationRoot), 'backups');
  const backupPath = path.join(backupRoot, `telegram-scope-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const tableNames = ['chat_bindings', 'link_codes', 'notifications', 'events', 'telegram_updates', 'justfun_schema'];
  const legacyTables = {};
  for (const table of tableNames) legacyTables[table] = await query(legacyDb.uuid, `SELECT * FROM ${table}`);
  atomicJson(backupPath, {
    createdAt: new Date().toISOString(),
    reason: 'pre exact company+warehouse Telegram migration',
    accountId,
    brokerDatabase: { id: brokerDb.uuid, name: brokerDb.name, companyTelegramServices: brokerRows },
    legacyDatabase: { id: legacyDb.uuid, name: legacyDb.name, tables: legacyTables },
    selectedBindings: legacyBindings,
  });
  return backupPath;
}

async function migrateBindings(databaseId, bindings) {
  for (const row of bindings) {
    await query(databaseId, `
      INSERT INTO chat_bindings(
        warehouse_id,entity_type,entity_id,chat_id,chat_type,title,username,user_id,active,created_at,updated_at
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
      ON CONFLICT(warehouse_id,entity_type,entity_id) DO UPDATE SET
        chat_id=excluded.chat_id,chat_type=excluded.chat_type,title=excluded.title,
        username=excluded.username,user_id=excluded.user_id,active=excluded.active,updated_at=excluded.updated_at
    `, [
      row.warehouse_id, row.entity_type, row.entity_id, row.chat_id, row.chat_type,
      row.title, row.username, row.user_id, row.active, row.created_at, row.updated_at,
    ]);
  }
}

async function upsertBrokerService(brokerDbId, sourceCiphertext, target, state) {
  await query(brokerDbId, `
    INSERT INTO company_telegram_services(
      company_id,warehouse_id,telegram_worker_url,telegram_client_key_ciphertext,telegram_bot_username,
      telegram_installation_id,telegram_deployment_version,updated_at
    ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
    ON CONFLICT(company_id,warehouse_id) DO UPDATE SET
      telegram_worker_url=excluded.telegram_worker_url,
      telegram_client_key_ciphertext=excluded.telegram_client_key_ciphertext,
      telegram_bot_username=excluded.telegram_bot_username,
      telegram_installation_id=excluded.telegram_installation_id,
      telegram_deployment_version=excluded.telegram_deployment_version,
      updated_at=excluded.updated_at
  `, [
    companyId, target.warehouseId, state.base_url, sourceCiphertext, state.bot_username,
    state.installation_id, state.deployment_version, new Date().toISOString(),
  ]);
}

function saveLocalScope(target, state, nativeStore, clientKey) {
  const scopeRoot = path.join(
    localIntegrationRoot,
    'telegram-cloudflare-native',
    `company-${companyId}`,
    `warehouse-live-${target.warehouseId}`,
  );
  atomicJson(path.join(scopeRoot, 'state.json'), {
    ...state,
    company_id: companyId,
    warehouse_id: target.warehouseId,
    environment: 'live',
  });
  const secretName = `telegramClientApiKey.${companyId}.live.${target.warehouseId}`;
  nativeStore[secretName] = safeStorage.encryptString(clientKey).toString('base64');
  nativeStore.updated_at = new Date().toISOString();
}

async function main() {
  checkpoint('starting', { apply: APPLY });
  app.setName('JustFun Логистика');
  app.setPath('userData', profilePath);
  app.setPath('sessionData', path.join(profilePath, 'session'));
  await app.whenReady();
  // Electron can finish a no-window process while a second Cloudflare
  // deployment is still awaiting propagation. A hidden window keeps this
  // bounded migration alive without exposing a UI or loading remote content.
  const keepAlive = new BrowserWindow({ show: false, skipTaskbar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  checkpoint('windows-protected-storage-ready');

  if (!accountId) {
    const accounts = await cf('GET', '/accounts?per_page=50');
    if (!Array.isArray(accounts) || accounts.length !== 1 || !accounts[0]?.id) throw new Error('Cloudflare account is ambiguous');
    accountId = String(accounts[0].id);
  }

  const { store: nativeStore, clientKey } = clientKeyFromNativeStore();
  checkpoint('legacy-client-key-ready');
  const [brokerDb, legacyDb] = await Promise.all([
    databaseByName('justfun-company-telegram'),
    databaseByName('justfun-logistics-bot-db'),
  ]);
  const brokerRows = await query(brokerDb.uuid, 'SELECT * FROM company_telegram_services ORDER BY company_id,warehouse_id');
  const sourceRow = brokerRows.find(row => String(row.company_id) === companyId && String(row.warehouse_id) === '*');
  if (!sourceRow?.telegram_client_key_ciphertext) throw new Error('Legacy broker row for the target company is unavailable');
  const allBindings = await query(legacyDb.uuid, 'SELECT * FROM chat_bindings ORDER BY warehouse_id,entity_type,entity_id');

  const legacyState = JSON.parse(fs.readFileSync(path.join(localIntegrationRoot, 'telegram-cloudflare-native', 'state.json'), 'utf8'));
  const oldStatus = await worker(String(legacyState.base_url), clientKey, '/v1/status');
  checkpoint('legacy-worker-validated', { bot: String(oldStatus?.bot?.username || '') });
  const preflight = [];
  for (const target of targets) {
    target.scopedWarehouse = `live--${target.warehouseId}`;
    target.bindings = allBindings.filter(row => String(row.warehouse_id) === target.scopedWarehouse);
    target.warehouseBinding = target.bindings.find(row => row.entity_type === 'warehouse' && String(row.entity_id) === target.warehouseId);
    if (!target.warehouseBinding?.chat_id) throw new Error(`Warehouse group binding is missing: ${target.label}`);
    const me = await telegram(target.token, 'getMe');
    const chat = await telegram(target.token, 'getChat', { chat_id: target.warehouseBinding.chat_id });
    preflight.push({
      label: target.label,
      warehouseId: target.warehouseId,
      botUsername: String(me.username || ''),
      groupAccessible: Boolean(chat?.id),
      groupHash: sha(target.warehouseBinding.chat_id),
      groupTitle: String(chat?.title || target.warehouseBinding.title || ''),
      bindingCount: target.bindings.length,
      plannedWorker: provisioner.scopedResourceName('justfun-logistics-bot', `${companyId}:live:${target.warehouseId}`),
      plannedDatabase: provisioner.scopedResourceName('justfun-logistics-bot-db', `${companyId}:live:${target.warehouseId}`),
    });
  }

  const report = {
    ok: true,
    applied: false,
    checkedAt: new Date().toISOString(),
    companyId,
    oldWorkerBot: String(oldStatus?.bot?.username || ''),
    wildcardRows: brokerRows.filter(row => String(row.warehouse_id) === '*').length,
    preflight,
    backupPath: '',
    results: [],
  };

  if (APPLY) {
    checkpoint('backup-starting');
    report.backupPath = await backupDatabases(brokerDb, legacyDb, brokerRows, targets.flatMap(item => item.bindings));
    checkpoint('backup-complete', { backupPath: report.backupPath });
    for (const target of targets) {
      checkpoint('provision-starting', { target: target.label });
      const result = await provisioner.provision({
        cloudflareToken,
        botToken: target.token,
        existingState: {},
        existingClientApiKey: clientKey,
        resourceScope: `${companyId}:live:${target.warehouseId}`,
        workerDir: path.resolve(__dirname, '../source/application/integrations/telegram-cloudflare-native/worker'),
        migrationFile: path.resolve(__dirname, '../source/application/integrations/telegram-cloudflare-native/migrations/0001_init.sql'),
      });
      checkpoint('provision-complete', { target: target.label, workerName: result.state.worker_name });
      await migrateBindings(result.state.database_id, target.bindings);
      checkpoint('bindings-migrated', { target: target.label, count: target.bindings.length });
      const status = await worker(result.state.base_url, clientKey, '/v1/status');
      const bindings = await worker(
        result.state.base_url,
        clientKey,
        `/v1/bindings?warehouse_id=${encodeURIComponent(target.scopedWarehouse)}`,
      );
      if (String(status?.bot?.username || '').toLowerCase() !== String(result.botUsername || '').toLowerCase()) {
        throw new Error(`Provisioned Worker bot mismatch: ${target.label}`);
      }
      if (!Array.isArray(bindings?.bindings) || bindings.bindings.length !== target.bindings.length) {
        throw new Error(`Provisioned Worker binding mismatch: ${target.label}`);
      }
      checkpoint('worker-verified', { target: target.label, count: bindings.bindings.length });
      await upsertBrokerService(brokerDb.uuid, sourceRow.telegram_client_key_ciphertext, target, result.state);
      checkpoint('broker-exact-row-written', { target: target.label });
      saveLocalScope(target, result.state, nativeStore, clientKey);
      checkpoint('local-scope-written', { target: target.label });
      report.results.push({
        label: target.label,
        warehouseId: target.warehouseId,
        botUsername: result.botUsername,
        workerName: result.state.worker_name,
        databaseName: result.state.database_name,
        bindingCount: bindings.bindings.length,
        workerOnline: true,
        brokerExactRowWritten: true,
      });
    }
    atomicJson(nativeSecretsPath, nativeStore);
    checkpoint('native-secrets-written');
    report.applied = true;
  }

  if (reportPath) atomicJson(reportPath, report);
  checkpoint('complete', { applied: report.applied });
  if (!keepAlive.isDestroyed()) keepAlive.destroy();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

main().catch(error => {
  const message = String(error?.message || error)
    .replace(/\d{6,14}:[A-Za-z0-9_-]{25,120}/g, '<telegram-token>')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer <redacted>');
  const failure = { ok: false, applied: false, error: message };
  if (progressPath) {
    try { atomicJson(progressPath, { stage: 'failed', at: new Date().toISOString(), ...failure }); }
    catch (progressError) { failure.progressWriteError = String(progressError?.message || progressError).slice(0, 240); }
  }
  if (reportPath) {
    try { atomicJson(reportPath, failure); }
    catch (reportError) { failure.reportWriteError = String(reportError?.message || reportError).slice(0, 240); }
  }
  process.stderr.write(`${JSON.stringify(failure)}\n`);
  process.exit(1);
});
