'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const RELEASE = require('../../release.json');

const CLOUDFLARE_HOST = 'api.cloudflare.com';
const TELEGRAM_HOST = 'api.telegram.org';
const DEPLOYMENT_VERSION = RELEASE.version;
const SCHEMA_VERSION = 2;
const DEFAULT_WORKER_NAME = 'justfun-logistics-bot';
const DEFAULT_DATABASE_NAME = 'justfun-logistics-bot-db';
const REQUEST_TIMEOUT_MS = 30_000;

class ProvisioningError extends Error {
  constructor(stage, code, message, details = '') {
    super(String(message || 'Неизвестная ошибка настройки'));
    this.name = 'ProvisioningError';
    this.stage = String(stage || 'unknown');
    this.code = String(code || 'TG-CF-UNKNOWN');
    this.details = String(details || '');
  }
}

function safeText(value, max = 800) {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function randomSecret(bytes = 36) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function validResourceName(value, fallback) {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(text) ? text : fallback;
}

function scopedResourceName(baseName, resourceScope) {
  const base = validResourceName(baseName, 'justfun').replace(/_/g, '-');
  const scope = String(resourceScope || '').trim();
  if (!scope) return base;
  const suffix = crypto.createHash('sha256').update(scope, 'utf8').digest('hex').slice(0, 12);
  return `${base.slice(0, 50).replace(/-+$/g, '')}-${suffix}`;
}

function sharedDatabaseName() {
  return DEFAULT_DATABASE_NAME;
}

function emit(onProgress, stage, title, detail, percent) {
  try {
    onProgress?.({
      stage: String(stage),
      title: String(title),
      detail: String(detail || ''),
      percent: Math.max(0, Math.min(100, Number(percent) || 0)),
      at: new Date().toISOString()
    });
  } catch (error) {
    process.emitWarning(`Telegram setup progress callback failed: ${safeText(error?.message || error)}`);
  }
}

function requestBuffer({hostname, method = 'GET', requestPath = '/', headers = {}, body = null, timeoutMs = REQUEST_TIMEOUT_MS, maxBytes = 8 * 1024 * 1024}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : (Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8'));
    const req = https.request({
      hostname,
      port: 443,
      method,
      path: requestPath,
      headers: {
        Accept: 'application/json',
        'User-Agent': `JustFunOrdersLogistics/${DEPLOYMENT_VERSION}`,
        ...(payload ? {'Content-Length': String(payload.length)} : {}),
        ...headers
      },
      timeout: timeoutMs,
      servername: hostname
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new Error('Ответ сервера превышает допустимый размер.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status: Number(response.statusCode || 0),
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.once('timeout', () => req.destroy(new Error('Сервер не ответил за отведённое время.')));
    req.once('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function parseJsonResponse(response, service) {
  let parsed;
  try { parsed = JSON.parse(response.body.toString('utf8') || '{}'); }
  catch { throw new ProvisioningError('network', `${service}-INVALID-JSON`, `${service} вернул повреждённый ответ (HTTP ${response.status}).`); }
  return parsed;
}

function cloudflareError(parsed, status) {
  const first = Array.isArray(parsed?.errors) ? parsed.errors[0] : null;
  const code = first?.code ? `CF-${first.code}` : `CF-HTTP-${status}`;
  const rawMessage = safeText(first?.message || parsed?.message || `Cloudflare вернул HTTP ${status}.`);
  const localized = {
    'CF-7406': 'Достигнут лимит баз D1 в Cloudflare. JustFun больше не создаёт отдельную D1 для каждого склада и должен повторно использовать общую Telegram-базу.'
  };
  return {code, message: localized[code] || rawMessage, details: rawMessage};
}

async function cfRequest(token, method, requestPath, body = null, extraHeaders = {}) {
  const payload = body == null || Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body), 'utf8');
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(body != null && !Buffer.isBuffer(body) ? {'Content-Type': 'application/json; charset=utf-8'} : {}),
    ...extraHeaders
  };
  const response = await requestBuffer({hostname: CLOUDFLARE_HOST, method, requestPath: `/client/v4${requestPath}`, headers, body: payload});
  const parsed = parseJsonResponse(response, 'Cloudflare');
  if (response.status < 200 || response.status >= 300 || parsed?.success === false) {
    const error = cloudflareError(parsed, response.status);
    throw new ProvisioningError('cloudflare', error.code, error.message, error.details);
  }
  return parsed?.result;
}

async function telegramRequest(botToken, method, body = null) {
  const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
  const response = await requestBuffer({
    hostname: TELEGRAM_HOST,
    method: body == null ? 'GET' : 'POST',
    requestPath: `/bot${botToken}/${method}`,
    headers: payload ? {'Content-Type': 'application/json; charset=utf-8'} : {},
    body: payload,
    timeoutMs: 25_000,
    maxBytes: 2 * 1024 * 1024
  });
  const parsed = parseJsonResponse(response, 'Telegram');
  if (response.status < 200 || response.status >= 300 || parsed?.ok !== true) {
    const description = safeText(parsed?.description || `Telegram вернул HTTP ${response.status}.`);
    throw new ProvisioningError('telegram', `TG-${parsed?.error_code || response.status || 'ERROR'}`, description);
  }
  return parsed.result;
}

async function verifyCloudflareToken(token) {
  const result = await cfRequest(token, 'GET', '/user/tokens/verify');
  if (String(result?.status || '') !== 'active') {
    throw new ProvisioningError('token_verification', 'CF-TOKEN-INACTIVE', 'Cloudflare API-токен не активен. Создайте новый временный токен.');
  }
  return result;
}

async function probeAccount(token, account) {
  const id = String(account?.id || '');
  if (!/^[a-f0-9]{32}$/i.test(id)) return {ok: false, account, errors: ['Некорректный Account ID']};
  const errors = [];
  try { await cfRequest(token, 'GET', `/accounts/${id}/d1/database?per_page=5`); }
  catch (error) { errors.push(`D1: ${safeText(error.message, 250)}`); }
  try { await cfRequest(token, 'GET', `/accounts/${id}/workers/scripts`); }
  catch (error) { errors.push(`Workers: ${safeText(error.message, 250)}`); }
  return {ok: errors.length === 0, account, errors};
}

async function selectAccount(token, existingState) {
  const savedId = String(existingState?.account_id || '');
  if (/^[a-f0-9]{32}$/i.test(savedId)) {
    try {
      const saved = await cfRequest(token, 'GET', `/accounts/${savedId}`);
      const probe = await probeAccount(token, saved || {id: savedId, name: existingState?.account_name || ''});
      if (probe.ok) return probe.account;
      throw new ProvisioningError('account_selection', 'CF-SAVED-ACCOUNT-PERMISSIONS', `Токен не имеет нужных прав в ранее подключённом аккаунте: ${probe.errors.join('; ')}`);
    } catch (error) {
      if (error instanceof ProvisioningError && error.code === 'CF-SAVED-ACCOUNT-PERMISSIONS') throw error;
      throw new ProvisioningError('account_selection', 'CF-SAVED-ACCOUNT-UNAVAILABLE', 'Временный токен создан не для ранее подключённого Cloudflare-аккаунта. Создайте токен именно для него.');
    }
  }

  const accounts = await cfRequest(token, 'GET', '/accounts?per_page=50');
  const list = Array.isArray(accounts) ? accounts : [];
  if (!list.length) {
    throw new ProvisioningError('account_selection', 'CF-NO-ACCOUNTS', 'Cloudflare не вернул доступный аккаунт. В токене выберите один конкретный Account resource.');
  }
  const probes = [];
  for (const account of list) probes.push(await probeAccount(token, account));
  const allowed = probes.filter(item => item.ok).map(item => item.account);
  if (allowed.length === 1) return allowed[0];
  if (allowed.length > 1) {
    throw new ProvisioningError('account_selection', 'CF-MULTIPLE-ACCOUNTS', 'Токен имеет доступ сразу к нескольким Cloudflare-аккаунтам. Для безопасности создайте временный токен только для одного аккаунта.');
  }
  const details = probes.flatMap(item => item.errors).slice(0, 4).join('; ');
  throw new ProvisioningError('account_selection', 'CF-PERMISSIONS-MISSING', `Недостаточно прав. Нужны Account → Workers Scripts → Edit, Account → D1 → Edit и Account → Account Settings → Read. ${details}`.trim());
}

async function ensureWorkersSubdomain(token, accountId) {
  try {
    const result = await cfRequest(token, 'GET', `/accounts/${accountId}/workers/subdomain`);
    if (result?.subdomain) return String(result.subdomain);
  } catch (error) {
    if (!String(error?.code || '').startsWith('CF-')) throw error;
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const suffix = crypto.randomBytes(5).toString('hex');
    const candidate = `justfun-${suffix}`;
    try {
      const result = await cfRequest(token, 'PUT', `/accounts/${accountId}/workers/subdomain`, {subdomain: candidate});
      if (result?.subdomain) return String(result.subdomain);
      return candidate;
    } catch (error) {
      if (attempt === 5) throw new ProvisioningError('subdomain', 'CF-WORKERS-DEV-FAILED', `Не удалось создать бесплатный адрес workers.dev: ${safeText(error.message)}`);
    }
  }
  throw new ProvisioningError('subdomain', 'CF-WORKERS-DEV-FAILED', 'Не удалось подготовить бесплатный адрес workers.dev.');
}

function selectSharedDatabase(databases, savedId, databaseName = DEFAULT_DATABASE_NAME) {
  const list = Array.isArray(databases) ? databases : [];
  const savedDatabase = list.find(item => String(item?.uuid || '') === String(savedId || '')) || null;
  const exact = list.find(item => String(item?.name || '') === databaseName) || null;
  const compatible = list
    .filter(item => String(item?.name || '').startsWith(`${DEFAULT_DATABASE_NAME}-`))
    .sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || ''), 'en'))[0] || null;
  const database = exact || compatible;
  if (!database) return null;
  return {
    database,
    savedDatabase,
    legacySourceDatabaseId: savedDatabase?.uuid && savedDatabase.uuid !== database.uuid ? savedDatabase.uuid : '',
    selectedSavedDatabase: Boolean(savedDatabase?.uuid && savedDatabase.uuid === database.uuid),
    legacyName: !exact
  };
}

async function ensureDatabase(token, accountId, existingState, defaultDatabaseName = DEFAULT_DATABASE_NAME, onProgress = null) {
  const databaseName = validResourceName(defaultDatabaseName, DEFAULT_DATABASE_NAME);
  const list = await cfRequest(token, 'GET', `/accounts/${accountId}/d1/database?per_page=100`);
  const databases = Array.isArray(list) ? list : [];
  const savedId = String(existingState?.database_id || '');
  const selection = selectSharedDatabase(databases, savedId, databaseName);
  const withSelection = selected => ({
    ...selected.database,
    justfun_created: false,
    justfun_shared: true,
    legacy_source_database_id: selected.legacySourceDatabaseId,
    justfun_selected_saved: selected.selectedSavedDatabase
  });
  if (selection?.database?.uuid) {
    if (!selection.legacyName) return withSelection(selection);
    emit(
      onProgress,
      'database_reuse',
      'Используем общую Telegram-базу D1',
      `Новая D1 не создаётся. Выбрана существующая база ${safeText(selection.database.name, 80)}.`,
      42
    );
    return {...withSelection(selection), justfun_legacy_name: true};
  }

  if (/^[a-f0-9-]{32,40}$/i.test(savedId)) {
    emit(onProgress, 'database_recovery', 'Сохранённая D1 не является общей', 'Создаём одну общую Telegram-базу для всех складов аккаунта.', 42);
  }
  try {
    const created = await cfRequest(token, 'POST', `/accounts/${accountId}/d1/database`, {name: databaseName, jurisdiction: 'eu'});
    return {...created, justfun_created: true, justfun_shared: true, justfun_selected_saved: false};
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('jurisdiction')) {
      const created = await cfRequest(token, 'POST', `/accounts/${accountId}/d1/database`, {name: databaseName});
      return {...created, justfun_created: true, justfun_shared: true, justfun_selected_saved: false};
    }
    throw error;
  }
}

function splitSql(sql) {
  const withoutComments = String(sql || '').replace(/^\s*--.*$/gm, '').trim();
  return withoutComments.split(';').map(statement => statement.trim()).filter(Boolean);
}

async function d1Query(token, accountId, databaseId, sql, params = []) {
  const result = await cfRequest(token, 'POST', `/accounts/${accountId}/d1/database/${databaseId}/query`, {sql, params});
  return Array.isArray(result) ? result[0] : result;
}

async function applyMigrations(token, accountId, databaseId, migrationFiles) {
  for (const migrationFile of migrationFiles) {
    const sql = fs.readFileSync(migrationFile, 'utf8');
    const statements = splitSql(sql);
    for (const statement of statements) {
      await d1Query(token, accountId, databaseId, statement);
    }
  }
  await d1Query(token, accountId, databaseId,
    'CREATE TABLE IF NOT EXISTS justfun_schema (component TEXT PRIMARY KEY, version TEXT NOT NULL, updated_at TEXT NOT NULL)');
  await d1Query(token, accountId, databaseId,
    'INSERT INTO justfun_schema(component,version,updated_at) VALUES(?1,?2,?3) ON CONFLICT(component) DO UPDATE SET version=excluded.version, updated_at=excluded.updated_at',
    ['telegram-cloudflare', String(SCHEMA_VERSION), new Date().toISOString()]);
}

function queryRows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

async function resolveInstallationId(token, accountId, databaseId, companyId, warehouseId, preferredId) {
  const existing = await d1Query(token, accountId, databaseId,
    'SELECT installation_id FROM telegram_installations WHERE company_id=?1 AND warehouse_id=?2 LIMIT 1',
    [companyId, warehouseId]);
  const existingId = String(queryRows(existing)[0]?.installation_id || '');
  if (/^[A-Za-z0-9_-]{12,80}$/.test(existingId)) return existingId;
  if (/^[A-Za-z0-9_-]{12,80}$/.test(String(preferredId || ''))) return String(preferredId);
  return `inst-${crypto.randomBytes(10).toString('hex')}`;
}

async function registerInstallation(token, accountId, databaseId, scope, workerName) {
  const now = new Date().toISOString();
  await d1Query(token, accountId, databaseId, `
    INSERT INTO telegram_installations(
      installation_id, company_id, warehouse_id, worker_name, schema_version, created_at, updated_at
    ) VALUES(?1,?2,?3,?4,?5,?6,?6)
    ON CONFLICT(company_id,warehouse_id) DO UPDATE SET
      worker_name=excluded.worker_name, schema_version=excluded.schema_version, updated_at=excluded.updated_at
  `, [scope.installationId, scope.companyId, scope.warehouseId, workerName, SCHEMA_VERSION, now]);
}

async function claimLegacySource(token, accountId, databaseId, sourceKey, installationId) {
  const result = await d1Query(token, accountId, databaseId, `
    INSERT OR IGNORE INTO telegram_legacy_claims(source_key,installation_id,claimed_at)
    VALUES(?1,?2,?3)
  `, [sourceKey, installationId, new Date().toISOString()]);
  return Number(result?.meta?.changes || 0) === 1;
}

async function legacySourceClaimed(token, accountId, databaseId, sourceKey) {
  const result = await d1Query(token, accountId, databaseId,
    'SELECT installation_id FROM telegram_legacy_claims WHERE source_key=?1 LIMIT 1', [sourceKey]);
  return Boolean(queryRows(result)[0]?.installation_id);
}

async function migrateLegacyData(token, accountId, databaseId, scope, {includeGlobalUpdates = false} = {}) {
  const warehouseClaim = `warehouse:${scope.companyId}:${scope.warehouseId}`;
  if (!(await legacySourceClaimed(token, accountId, databaseId, warehouseClaim))) {
    await d1Query(token, accountId, databaseId, `
      INSERT OR IGNORE INTO chat_bindings_v2(
        installation_id,company_id,warehouse_id,entity_type,entity_id,chat_id,chat_type,
        title,username,user_id,active,created_at,updated_at
      ) SELECT ?1,?2,warehouse_id,entity_type,entity_id,chat_id,chat_type,title,username,
        user_id,active,created_at,updated_at FROM chat_bindings WHERE warehouse_id=?3
    `, [scope.installationId, scope.companyId, scope.warehouseId]);
    await d1Query(token, accountId, databaseId, `
      INSERT OR IGNORE INTO link_codes_v2(
        installation_id,company_id,warehouse_id,id,code_hash,entity_type,entity_id,label,
        expires_at,used_at,used_chat_id,created_at
      ) SELECT ?1,?2,warehouse_id,id,code_hash,entity_type,entity_id,label,expires_at,used_at,
        used_chat_id,created_at FROM link_codes WHERE warehouse_id=?3
    `, [scope.installationId, scope.companyId, scope.warehouseId]);
    await d1Query(token, accountId, databaseId, `
      INSERT OR IGNORE INTO notifications_v2(
        installation_id,company_id,warehouse_id,id,route_id,actor,entity_type,entity_id,
        chat_id,message_id,idempotency_key,status,status_at,lease_until,payload_json,error,
        created_at,updated_at
      ) SELECT ?1,?2,warehouse_id,id,route_id,actor,entity_type,entity_id,chat_id,message_id,
        idempotency_key,status,status_at,lease_until,payload_json,error,created_at,updated_at
        FROM notifications WHERE warehouse_id=?3
    `, [scope.installationId, scope.companyId, scope.warehouseId]);
    await d1Query(token, accountId, databaseId, `
      INSERT OR IGNORE INTO events_v2(
        installation_id,company_id,warehouse_id,event_type,actor,status,route_id,
        notification_id,chat_id,user_id,username,payload_json,created_at,legacy_source_id
      ) SELECT ?1,?2,warehouse_id,event_type,actor,status,route_id,notification_id,chat_id,
        user_id,username,payload_json,created_at,id FROM events WHERE warehouse_id=?3
    `, [scope.installationId, scope.companyId, scope.warehouseId]);
    await claimLegacySource(token, accountId, databaseId, warehouseClaim, scope.installationId);
  }

  if (includeGlobalUpdates && !(await legacySourceClaimed(token, accountId, databaseId, 'telegram_updates:global'))) {
    await d1Query(token, accountId, databaseId, `
      INSERT OR IGNORE INTO telegram_updates_v2(
        installation_id,company_id,warehouse_id,update_id,status,attempts,claim_token,
        received_at,completed_at,last_error
      ) SELECT ?1,?2,?3,update_id,status,attempts,claim_token,received_at,completed_at,last_error
        FROM telegram_updates
    `, [scope.installationId, scope.companyId, scope.warehouseId]);
    await claimLegacySource(token, accountId, databaseId, 'telegram_updates:global', scope.installationId);
  }
}

async function migrateExternalLegacyData(token, accountId, sourceDatabaseId, targetDatabaseId, scope) {
  if (!sourceDatabaseId || sourceDatabaseId === targetDatabaseId) return;
  const sourceClaim = `database:${sourceDatabaseId}:warehouse:${scope.companyId}:${scope.warehouseId}`;
  if (await legacySourceClaimed(token, accountId, targetDatabaseId, sourceClaim)) return;

  const selectRows = async (sql, params = []) => queryRows(
    await d1Query(token, accountId, sourceDatabaseId, sql, params)
  );
  const bindings = await selectRows('SELECT * FROM chat_bindings WHERE warehouse_id=?1', [scope.warehouseId]);
  for (const row of bindings) {
    await d1Query(token, accountId, targetDatabaseId, `
      INSERT OR IGNORE INTO chat_bindings_v2(
        installation_id,company_id,warehouse_id,entity_type,entity_id,chat_id,chat_type,
        title,username,user_id,active,created_at,updated_at
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
    `, [
      scope.installationId, scope.companyId, scope.warehouseId, row.entity_type,
      row.entity_id, row.chat_id, row.chat_type, row.title, row.username, row.user_id,
      row.active, row.created_at, row.updated_at
    ]);
  }

  const links = await selectRows('SELECT * FROM link_codes WHERE warehouse_id=?1', [scope.warehouseId]);
  for (const row of links) {
    await d1Query(token, accountId, targetDatabaseId, `
      INSERT OR IGNORE INTO link_codes_v2(
        installation_id,company_id,warehouse_id,id,code_hash,entity_type,entity_id,label,
        expires_at,used_at,used_chat_id,created_at
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
    `, [
      scope.installationId, scope.companyId, scope.warehouseId, row.id, row.code_hash,
      row.entity_type, row.entity_id, row.label, row.expires_at, row.used_at,
      row.used_chat_id, row.created_at
    ]);
  }

  const notifications = await selectRows('SELECT * FROM notifications WHERE warehouse_id=?1', [scope.warehouseId]);
  for (const row of notifications) {
    await d1Query(token, accountId, targetDatabaseId, `
      INSERT OR IGNORE INTO notifications_v2(
        installation_id,company_id,warehouse_id,id,route_id,actor,entity_type,entity_id,
        chat_id,message_id,idempotency_key,status,status_at,lease_until,payload_json,error,
        created_at,updated_at
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
    `, [
      scope.installationId, scope.companyId, scope.warehouseId, row.id, row.route_id,
      row.actor, row.entity_type, row.entity_id, row.chat_id, row.message_id,
      row.idempotency_key, row.status, row.status_at, row.lease_until, row.payload_json,
      row.error, row.created_at, row.updated_at
    ]);
  }

  const events = await selectRows('SELECT * FROM events WHERE warehouse_id=?1', [scope.warehouseId]);
  for (const row of events) {
    await d1Query(token, accountId, targetDatabaseId, `
      INSERT OR IGNORE INTO events_v2(
        installation_id,company_id,warehouse_id,event_type,actor,status,route_id,
        notification_id,chat_id,user_id,username,payload_json,created_at,legacy_source_id
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
    `, [
      scope.installationId, scope.companyId, scope.warehouseId, row.event_type,
      row.actor, row.status, row.route_id, row.notification_id, row.chat_id,
      row.user_id, row.username, row.payload_json, row.created_at, `${sourceDatabaseId}:${row.id}`
    ]);
  }

  const updates = await selectRows('SELECT * FROM telegram_updates');
  for (const row of updates) {
    await d1Query(token, accountId, targetDatabaseId, `
      INSERT OR IGNORE INTO telegram_updates_v2(
        installation_id,company_id,warehouse_id,update_id,status,attempts,claim_token,
        received_at,completed_at,last_error
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
    `, [
      scope.installationId, scope.companyId, scope.warehouseId, row.update_id, row.status,
      row.attempts, row.claim_token, row.received_at, row.completed_at, row.last_error
    ]);
  }

  await claimLegacySource(token, accountId, targetDatabaseId, sourceClaim, scope.installationId);
}

async function writeProvisioningOperation(token, accountId, databaseId, operation) {
  await d1Query(token, accountId, databaseId, `
    INSERT INTO telegram_provisioning_operations(
      operation_id,installation_id,company_id,warehouse_id,worker_name,stage,status,
      error_code,error_message,created_at,updated_at
    ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
    ON CONFLICT(operation_id) DO UPDATE SET
      stage=excluded.stage,status=excluded.status,error_code=excluded.error_code,
      error_message=excluded.error_message,updated_at=excluded.updated_at
  `, [
    operation.operationId, operation.installationId, operation.companyId,
    operation.warehouseId, operation.workerName, operation.stage, operation.status,
    operation.errorCode || '', safeText(operation.errorMessage || '', 800),
    operation.createdAt || new Date().toISOString(), new Date().toISOString()
  ]);
}

async function workerExists(token, accountId, workerName) {
  const scripts = await cfRequest(token, 'GET', `/accounts/${accountId}/workers/scripts`);
  return (Array.isArray(scripts) ? scripts : []).some(item => String(item?.id || '') === workerName);
}

async function deleteWorker(token, accountId, workerName) {
  await cfRequest(token, 'DELETE', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}`);
}

function multipartBody(metadata, modules) {
  const boundary = `----JustFun${crypto.randomBytes(18).toString('hex')}`;
  const chunks = [];
  const push = value => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8'));
  push(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n`);
  for (const module of modules) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${module.name}"; filename="${module.name}"\r\nContent-Type: application/javascript+module\r\n\r\n`);
    push(module.content);
    push('\r\n');
  }
  push(`--${boundary}--\r\n`);
  return {body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}`};
}

async function uploadWorker({
  token, accountId, workerName, databaseId, installationId, companyId, warehouseId,
  environment, botUsername, botToken, webhookSecret, clientApiKey, workerDir
}) {
  const moduleNames = ['index.js', 'crypto.js', 'db.js', 'http.js', 'status.js', 'telegram.js'];
  const modules = moduleNames.map(name => ({name, content: fs.readFileSync(path.join(workerDir, name))}));
  const metadata = {
    main_module: 'index.js',
    compatibility_date: '2026-08-15',
    bindings: [
      {type: 'd1', name: 'DB', id: databaseId},
      {type: 'plain_text', name: 'SERVICE_NAME', text: 'JustFun — Заказы и логистика · Telegram'},
      {type: 'plain_text', name: 'BOT_USERNAME', text: botUsername},
      {type: 'plain_text', name: 'INSTALLATION_ID', text: installationId},
      {type: 'plain_text', name: 'COMPANY_ID', text: companyId},
      {type: 'plain_text', name: 'WAREHOUSE_ID', text: warehouseId},
      {type: 'plain_text', name: 'ENVIRONMENT', text: environment},
      {type: 'plain_text', name: 'DEPLOYMENT_VERSION', text: DEPLOYMENT_VERSION},
      {type: 'secret_text', name: 'BOT_TOKEN', text: botToken},
      {type: 'secret_text', name: 'WEBHOOK_SECRET', text: webhookSecret},
      {type: 'secret_text', name: 'CLIENT_API_KEY', text: clientApiKey}
    ],
    observability: {enabled: true},
    annotations: {'workers/message': `JustFun Telegram ${DEPLOYMENT_VERSION}`, 'workers/tag': `justfun-${DEPLOYMENT_VERSION}`}
  };
  const multipart = multipartBody(metadata, modules);
  await cfRequest(token, 'PUT', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}`, multipart.body, {'Content-Type': multipart.contentType});
  await cfRequest(token, 'POST', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/subdomain`, {enabled: true, previews_enabled: false});
  const secrets = await cfRequest(token, 'GET', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/secrets`);
  const names = new Set((Array.isArray(secrets) ? secrets : []).map(item => String(item?.name || '')));
  for (const required of ['BOT_TOKEN', 'WEBHOOK_SECRET', 'CLIENT_API_KEY']) {
    if (!names.has(required)) throw new ProvisioningError('secrets', 'CF-SECRET-MISSING', `Cloudflare не подтвердил секрет ${required}.`);
  }
}

async function workerJson(baseUrl, requestPath, clientApiKey = '') {
  const url = new URL(requestPath, baseUrl);
  const response = await requestBuffer({
    hostname: url.hostname,
    method: 'GET',
    requestPath: `${url.pathname}${url.search}`,
    headers: clientApiKey ? {Authorization: `Bearer ${clientApiKey}`} : {},
    timeoutMs: 20_000,
    maxBytes: 2 * 1024 * 1024
  });
  const parsed = parseJsonResponse(response, 'Cloudflare Worker');
  if (response.status < 200 || response.status >= 300 || parsed?.ok === false) {
    throw new ProvisioningError('worker_check', `WORKER-HTTP-${response.status}`, safeText(parsed?.error?.message || parsed?.error || parsed?.message || `Worker вернул HTTP ${response.status}.`));
  }
  return parsed;
}

async function waitForWorker(baseUrl) {
  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const health = await workerJson(baseUrl, '/health');
      if (health?.ok) return health;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 1200 + attempt * 250));
  }
  throw new ProvisioningError('worker_check', 'WORKER-NOT-READY', `Опубликованный Worker не ответил: ${safeText(lastError?.message || 'нет ответа')}`);
}

async function waitForAuthorizedWorker(baseUrl, clientApiKey) {
  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const status = await workerJson(baseUrl, '/v1/status', clientApiKey);
      if (status?.ok) return status;
    } catch (error) {
      lastError = error;
      if (!['WORKER-HTTP-401', 'WORKER-HTTP-503'].includes(String(error?.code || ''))) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 1200 + attempt * 300));
  }
  throw new ProvisioningError(
    'final_check',
    'WORKER-AUTH-NOT-READY',
    `Cloudflare ещё не применил новый защищённый ключ: ${safeText(lastError?.message || 'нет подтверждения')}`
  );
}

function formatProvisioningError(error, stage) {
  if (error instanceof ProvisioningError) {
    if (!error.stage || error.stage === 'cloudflare' || error.stage === 'telegram') error.stage = stage || error.stage;
    return error;
  }
  return new ProvisioningError(stage || 'unknown', 'TG-CF-UNEXPECTED', safeText(error?.message || error));
}

async function provision(options) {
  let stage = 'starting';
  const onProgress = options?.onProgress;
  const token = String(options?.cloudflareToken || '').trim();
  const botToken = String(options?.botToken || '').trim();
  const existingState = options?.existingState && typeof options.existingState === 'object' ? options.existingState : {};
  const existingClientApiKey = String(options?.existingClientApiKey || '');
  const resourceScope = String(options?.resourceScope || '').trim();
  const defaultWorkerName = scopedResourceName(DEFAULT_WORKER_NAME, resourceScope);
  const defaultDatabaseName = DEFAULT_DATABASE_NAME;
  const companyId = String(options?.companyId || '').trim();
  const warehouseId = String(options?.warehouseId || '').trim();
  const environment = String(options?.environment || 'live').trim().toLowerCase();
  const workerDir = path.resolve(String(options?.workerDir || ''));
  const migrationFile = path.resolve(String(options?.migrationFile || ''));
  const migrationFiles = Array.from(new Set(
    (Array.isArray(options?.migrationFiles) && options.migrationFiles.length
      ? options.migrationFiles
      : [migrationFile, path.join(path.dirname(migrationFile), '0002_shared_installations.sql')])
      .map(file => path.resolve(String(file || '')))
  ));
  if (!/^[A-Za-z0-9_\-.]{20,300}$/.test(token)) throw new ProvisioningError('token_input', 'CF-TOKEN-FORMAT', 'Проверьте формат Cloudflare API-токена.');
  if (!/^\d{6,14}:[A-Za-z0-9_-]{25,120}$/.test(botToken)) throw new ProvisioningError('token_input', 'TG-TOKEN-FORMAT', 'Проверьте токен Telegram-бота от @BotFather.');
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(companyId)) throw new ProvisioningError('scope', 'TG-COMPANY-SCOPE', 'Не удалось определить компанию для Telegram-подключения.');
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(warehouseId)) throw new ProvisioningError('scope', 'TG-WAREHOUSE-SCOPE', 'Не удалось определить склад для Telegram-подключения.');
  if (!['live', 'demo'].includes(environment)) throw new ProvisioningError('scope', 'TG-ENVIRONMENT-SCOPE', 'Не удалось определить рабочую среду Telegram-подключения.');
  if (!fs.existsSync(path.join(workerDir, 'index.js')) || migrationFiles.some(file => !fs.existsSync(file))) {
    throw new ProvisioningError('local_files', 'TG-CF-FILES-MISSING', 'Компоненты нового модуля Telegram повреждены. Переустановите программу.');
  }

  let accountId = '';
  let databaseId = '';
  let installationId = '';
  let workerName = '';
  let workerWasExisting = false;
  let workerTouched = false;
  let webhookChanged = false;
  let previousWebhook = null;
  let operation = null;

  try {
    stage = 'token_verification';
    emit(onProgress, stage, 'Проверяем Cloudflare API-токен', 'Токен используется только в памяти и не будет сохранён.', 8);
    await verifyCloudflareToken(token);

    stage = 'account_selection';
    emit(onProgress, stage, 'Определяем Cloudflare-аккаунт', 'Проверяем доступ только к Workers и D1.', 16);
    const account = await selectAccount(token, existingState);
    accountId = String(account.id);

    stage = 'telegram_verification';
    emit(onProgress, stage, 'Проверяем Telegram-бота', 'Запрашиваем сведения у Telegram Bot API.', 24);
    const bot = await telegramRequest(botToken, 'getMe');
    const botUsername = String(bot?.username || '');
    if (!botUsername) throw new ProvisioningError(stage, 'TG-BOT-NO-USERNAME', 'У Telegram-бота отсутствует username. Создайте имя бота в @BotFather.');
    previousWebhook = await telegramRequest(botToken, 'getWebhookInfo');

    stage = 'subdomain';
    emit(onProgress, stage, 'Готовим бесплатный адрес workers.dev', 'Собственный домен не требуется.', 32);
    const subdomain = await ensureWorkersSubdomain(token, accountId);

    stage = 'database';
    emit(onProgress, stage, 'Создаём или проверяем D1', 'Рабочие заказы и финансы в эту базу не переносятся.', 42);
    const database = await ensureDatabase(token, accountId, existingState, defaultDatabaseName, onProgress);
    databaseId = String(database?.uuid || '');
    if (!databaseId) throw new ProvisioningError(stage, 'CF-D1-ID-MISSING', 'Cloudflare не вернул идентификатор D1-базы.');

    stage = 'migration';
    emit(onProgress, stage, 'Создаём таблицы Telegram', 'Применяем безопасные повторяемые миграции.', 52);
    await applyMigrations(token, accountId, databaseId, migrationFiles);

    installationId = await resolveInstallationId(
      token, accountId, databaseId, companyId, warehouseId, existingState?.installation_id
    );
    workerName = validResourceName(existingState?.worker_name, defaultWorkerName);
    const scope = {installationId, companyId, warehouseId};
    await registerInstallation(token, accountId, databaseId, scope, workerName);
    if (database?.legacy_source_database_id) {
      emit(onProgress, 'legacy_data', 'Переносим Telegram-привязки склада', 'Копируем данные из прежней отдельной D1 в общую базу без удаления источника.', 58);
      await migrateExternalLegacyData(
        token, accountId, String(database.legacy_source_database_id), databaseId, scope
      );
    }
    await migrateLegacyData(token, accountId, databaseId, scope, {
      includeGlobalUpdates: Boolean(database?.justfun_selected_saved || database?.justfun_created)
    });
    const databaseName = String(database?.name || defaultDatabaseName);
    const webhookSecret = randomSecret(32);
    const clientApiKey = /^[A-Za-z0-9_-]{40,160}$/.test(existingClientApiKey) ? existingClientApiKey : randomSecret(48);
    workerWasExisting = await workerExists(token, accountId, workerName);
    operation = {
      operationId: `op-${crypto.randomBytes(10).toString('hex')}`,
      installationId,
      companyId,
      warehouseId,
      workerName,
      stage,
      status: 'running',
      createdAt: new Date().toISOString()
    };
    await writeProvisioningOperation(token, accountId, databaseId, operation);

    stage = 'worker_upload';
    emit(onProgress, stage, 'Публикуем Cloudflare Worker', 'Подключаем D1 и передаём секреты напрямую в Cloudflare.', 65);
    operation.stage = stage;
    await writeProvisioningOperation(token, accountId, databaseId, operation);
    workerTouched = true;
    await uploadWorker({
      token, accountId, workerName, databaseId, installationId, companyId, warehouseId,
      environment, botUsername, botToken, webhookSecret, clientApiKey, workerDir
    });

    const baseUrl = `https://${workerName}.${subdomain}.workers.dev`;
    stage = 'worker_check';
    emit(onProgress, stage, 'Проверяем опубликованный Worker', 'Ожидаем распространение новой версии.', 76);
    const health = await waitForWorker(baseUrl);
    if (health?.configured !== true) throw new ProvisioningError(stage, 'WORKER-NOT-CONFIGURED', 'Worker опубликован, но не подтвердил D1 и секреты.');

    stage = 'webhook';
    emit(onProgress, stage, 'Подключаем защищённый webhook', 'Telegram будет принимать только запросы с секретной подписью.', 86);
    const webhookUrl = `${baseUrl}/telegram`;
    await telegramRequest(botToken, 'setWebhook', {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ['message', 'callback_query'],
      max_connections: 20,
      drop_pending_updates: false
    });
    webhookChanged = true;
    const webhook = await telegramRequest(botToken, 'getWebhookInfo');
    if (String(webhook?.url || '') !== webhookUrl) throw new ProvisioningError(stage, 'TG-WEBHOOK-MISMATCH', 'Telegram подтвердил другой адрес webhook.');

    stage = 'final_check';
    emit(onProgress, stage, 'Выполняем итоговую диагностику', 'Проверяем bot, webhook, Worker, D1 и защищённый клиентский ключ.', 94);
    const status = await waitForAuthorizedWorker(baseUrl, clientApiKey);
    if (String(status?.bot?.username || '') !== botUsername) throw new ProvisioningError(stage, 'TG-BOT-MISMATCH', 'Worker подтвердил другого Telegram-бота.');
    if (String(status?.installation_id || '') !== installationId) throw new ProvisioningError(stage, 'TG-INSTALLATION-MISMATCH', 'Worker подтвердил другую Telegram-установку.');

    const state = {
      architecture: 'native-cloudflare-api-v3-shared-d1',
      deployment_version: DEPLOYMENT_VERSION,
      schema_version: SCHEMA_VERSION,
      account_id: accountId,
      account_name: String(account?.name || ''),
      installation_id: installationId,
      company_id: companyId,
      warehouse_id: warehouseId,
      environment,
      worker_name: workerName,
      database_name: databaseName,
      database_id: databaseId,
      workers_subdomain: subdomain,
      base_url: baseUrl,
      webhook_url: webhookUrl,
      bot_username: botUsername,
      shared_database: true,
      configured_at: String(existingState?.configured_at || new Date().toISOString()),
      updated_at: new Date().toISOString(),
      cloudflare_token_saved: false
    };

    operation.stage = 'completed';
    operation.status = 'active';
    await writeProvisioningOperation(token, accountId, databaseId, operation);

    emit(onProgress, 'completed', 'Telegram подключён', `@${botUsername} · Worker, D1 и webhook работают. Временный Cloudflare API-токен можно удалить.`, 100);
    return {state, clientApiKey, botUsername, baseUrl, webhookUrl, pendingUpdates: Number(webhook?.pending_update_count || 0)};
  } catch (error) {
    const formatted = formatProvisioningError(error, stage);
    const rollbackErrors = [];
    let rolledBack = false;
    if (webhookChanged && !String(previousWebhook?.url || '')) {
      try {
        await telegramRequest(botToken, 'deleteWebhook', {drop_pending_updates: false});
        rolledBack = true;
      } catch (rollbackError) {
        rollbackErrors.push(`webhook: ${safeText(rollbackError?.message || rollbackError, 250)}`);
      }
    }
    if (workerTouched && !workerWasExisting && (!webhookChanged || !String(previousWebhook?.url || ''))) {
      try {
        await deleteWorker(token, accountId, workerName);
        rolledBack = true;
      } catch (rollbackError) {
        rollbackErrors.push(`Worker: ${safeText(rollbackError?.message || rollbackError, 250)}`);
      }
    }
    if (operation && accountId && databaseId) {
      operation.stage = stage;
      operation.status = rolledBack && rollbackErrors.length === 0 ? 'rolled_back' : 'failed';
      operation.errorCode = formatted.code;
      operation.errorMessage = formatted.message;
      try { await writeProvisioningOperation(token, accountId, databaseId, operation); }
      catch (journalError) { rollbackErrors.push(`журнал: ${safeText(journalError?.message || journalError, 250)}`); }
    }
    if (rollbackErrors.length) {
      formatted.details = [formatted.details, ...rollbackErrors].filter(Boolean).join('; ');
    }
    throw formatted;
  }
}

module.exports = {
  DEPLOYMENT_VERSION,
  SCHEMA_VERSION,
  ProvisioningError,
  provision,
  splitSql,
  multipartBody,
  validResourceName,
  scopedResourceName,
  sharedDatabaseName,
  selectSharedDatabase
};
