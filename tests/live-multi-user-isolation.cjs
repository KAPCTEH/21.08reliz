'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const tls = require('node:tls');

const LICENSE_ORIGIN = 'https://justfun-license-api.l2maloy47rus.workers.dev';
const API_CONTRACT = '2';
const CLIENT_VERSION = '7.8.3';
const secretsPath = process.env.JF_TEST_SECRETS_PATH || 'C:\\Users\\zvd1\\.justfun-test-secrets.json';
const secrets = JSON.parse(fs.readFileSync(path.resolve(secretsPath), 'utf8'));
const vpsHost = String(secrets?.vps?.host || '').trim();
const vpsPort = 443;
const vpsAgent = new https.Agent({ keepAlive: false, maxSockets: 12, maxCachedSessions: 0 });
const ownerConfigs = [1, 2].map(number => {
  const stored = number === 1 ? secrets?.license : secrets?.license2;
  return {
    key: String(process.env[`JF_QA_LICENSE${number}_KEY`] || stored?.key || '').trim(),
    ownerFullName: String(process.env[`JF_QA_LICENSE${number}_OWNER_NAME`] || stored?.ownerFullName || '').trim(),
    ownerLogin: String(process.env[`JF_QA_LICENSE${number}_OWNER_LOGIN`] || stored?.ownerLogin || '').trim(),
    ownerPassword: String(process.env[`JF_QA_LICENSE${number}_OWNER_PASSWORD`] || stored?.ownerPassword || ''),
  };
});
if (!vpsHost || ownerConfigs.some(config => !config.key || !config.ownerFullName || !config.ownerLogin || !config.ownerPassword)) {
  throw new Error('Test credentials are incomplete');
}

const stamp = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`.slice(-10);
const warehouseIds = ['qa-spb-v783', 'qa-msk-v783', 'qa-nn-v783'];
const warehouseProfiles = [
  { id: warehouseIds[0], code: 'QSPB', name: 'QA Санкт-Петербург', address: 'Павловск, Санкт-Петербург', lat: 59.685528, lon: 30.434454 },
  { id: warehouseIds[1], code: 'QMSK', name: 'QA Москва', address: 'Москва, Красная площадь, 1', lat: 55.75393, lon: 37.620795 },
  { id: warehouseIds[2], code: 'QNN', name: 'QA Нижний Новгород', address: 'Нижний Новгород, площадь Минина, 1', lat: 56.326887, lon: 44.005986 },
];

function safeError(error) {
  return String(error?.message || error || 'unknown')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer <redacted>')
    .replace(/JFI-[A-Z0-9-]+/g, '<invitation>')
    .slice(0, 1000);
}

async function cloudRequest(requestPath, { method = 'GET', token = '', body = null } = {}) {
  const response = await fetch(`${LICENSE_ORIGIN}${requestPath}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === null ? {} : { 'content-type': 'application/json; charset=utf-8' }),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok && payload?.ok !== false, payload };
}

async function ownerSession(config, number) {
  let checked;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    checked = await cloudRequest('/v1/license/check', { method: 'POST', body: { license_key: config.key } });
    if (checked.ok || checked.payload?.error !== 'LICENSE_NOT_FOUND' || attempt === 6) break;
    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
  }
  if (!checked.ok) throw new Error(`License ${number} check failed: ${checked.payload?.error || checked.status}`);
  const deviceId = `qa-owner-${number}-${stamp}`;
  let result;
  if (checked.payload.can_create_owner) {
    result = await cloudRequest('/v1/owner/register', {
      method: 'POST',
      body: {
        license_key: config.key,
        full_name: config.ownerFullName,
        login: config.ownerLogin,
        password: config.ownerPassword,
        device_id: deviceId,
        device_name: `QA owner ${number}`,
      },
    });
  } else {
    result = await cloudRequest('/v1/auth/login', {
      method: 'POST',
      body: {
        company_code: checked.payload.company.code,
        login: config.ownerLogin,
        password: config.ownerPassword,
        device_id: deviceId,
        device_name: `QA owner ${number}`,
      },
    });
  }
  if (!result.ok || !result.payload?.access_token) throw new Error(`Owner ${number} authorization failed: ${result.payload?.error || result.status}`);
  return {
    token: result.payload.access_token,
    companyId: result.payload.company?.id || checked.payload.company.id,
    companyCode: result.payload.company?.code || checked.payload.company.code,
  };
}

function tlsFingerprint() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: vpsHost, port: vpsPort, servername: net.isIP(vpsHost) ? undefined : vpsHost, rejectUnauthorized: false });
    const timer = setTimeout(() => socket.destroy(new Error('TLS fingerprint timeout')), 15000);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const value = String(socket.getPeerCertificate()?.fingerprint256 || '').replace(/:/g, '').toUpperCase();
      socket.end();
      if (!/^[A-F0-9]{64}$/.test(value)) reject(new Error('VPS certificate fingerprint is unavailable'));
      else resolve(value);
    });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

function vpsRequest(fingerprint, token, requestPath, { method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const encoded = body === null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const request = https.request({
      host: vpsHost,
      port: vpsPort,
      path: requestPath,
      method,
      agent: vpsAgent,
      rejectUnauthorized: false,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'x-justfun-api-contract': API_CONTRACT,
        'x-justfun-client-version': CLIENT_VERSION,
        ...(encoded ? { 'content-type': 'application/json; charset=utf-8', 'content-length': encoded.length } : {}),
      },
      timeout: 30000,
    }, response => {
      const peer = String(response.socket.getPeerCertificate()?.fingerprint256 || '').replace(/:/g, '').toUpperCase();
      if (peer !== fingerprint) {
        response.resume();
        reject(new Error('VPS TLS fingerprint changed during the test'));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) request.destroy(new Error('VPS response is too large'));
        else chunks.push(chunk);
      });
      response.once('end', () => {
        let payload = {};
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
        catch { reject(new Error(`VPS returned invalid JSON (${response.statusCode})`)); return; }
        resolve({ status: Number(response.statusCode), ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 300 && payload?.ok !== false, payload });
      });
    });
    request.once('timeout', () => request.destroy(new Error('VPS request timeout')));
    request.once('error', reject);
    if (encoded) request.write(encoded);
    request.end();
  });
}

function entityPath(companyId, warehouseId, suffix = '') {
  return `/v1/workspaces/${encodeURIComponent(companyId)}/warehouses/${encodeURIComponent(warehouseId)}/entities/live${suffix}`;
}

async function currentEntities(fingerprint, session, warehouseId) {
  const result = await vpsRequest(fingerprint, session.token, entityPath(session.companyId, warehouseId));
  if (!result.ok) throw new Error(`Entity bootstrap failed for ${warehouseId}: ${result.payload?.error || result.status}`);
  return result.payload;
}

async function writeBatch(fingerprint, session, warehouseId, commandId, changes) {
  return vpsRequest(fingerprint, session.token, entityPath(session.companyId, warehouseId, '/batch'), {
    method: 'POST',
    body: { command_id: commandId, changes },
  });
}

async function ensureWarehouses(fingerprint, owner) {
  for (const profile of warehouseProfiles) {
    const existing = await currentEntities(fingerprint, owner, profile.id).catch(error => {
      if (/warehouse_access_denied/i.test(error.message)) throw error;
      return { entities: [] };
    });
    const current = (existing.entities || []).find(item => item.type === 'warehouse' && item.id === profile.id);
    const payload = { ...profile, warehouseId: profile.id, timezone: 'Europe/Moscow', status: 'active', updatedAt: new Date().toISOString() };
    const result = await writeBatch(fingerprint, owner, profile.id, `qa-warehouse-${profile.id}-${stamp}`, [{
      type: 'warehouse', id: profile.id, base_version: Number(current?.version || 0), deleted: false, payload,
    }]);
    if (!result.ok) throw new Error(`Warehouse ${profile.id} save failed: ${result.payload?.error || result.status}`);
  }
}

async function inviteEmployee(owner, index, warehouseId, permissions) {
  const login = `qa${stamp}${String(index).padStart(2, '0')}`.slice(0, 36);
  const password = `Qa!${crypto.randomBytes(12).toString('base64url')}9z`;
  const role = `QA роль ${index + 1}`;
  const invitation = await cloudRequest('/v1/users/invite', {
    method: 'POST', token: owner.token,
    body: { full_name: `QA сотрудник ${index + 1}`, login, role, permissions: [...permissions, `jf.warehouse:${warehouseId}`], expires_in_hours: 2 },
  });
  if (!invitation.ok) throw new Error(`Invitation ${index + 1} failed: ${invitation.payload?.error || invitation.status}`);
  const accepted = await cloudRequest('/v1/invitations/accept', {
    method: 'POST',
    body: { invitation_code: invitation.payload.invitation.code, password, device_id: `qa-device-${stamp}-${index}`, device_name: `QA PC ${index + 1}` },
  });
  if (!accepted.ok || !accepted.payload?.access_token) throw new Error(`Invitation ${index + 1} acceptance failed: ${accepted.payload?.error || accepted.status}`);
  return { token: accepted.payload.access_token, userId: accepted.payload.user?.id, role, warehouseId, permissions };
}

function expect(result, status, code, label) {
  if (result.status !== status || (code && result.payload?.error !== code)) {
    throw new Error(`${label}: expected ${status}/${code || 'any'}, received ${result.status}/${result.payload?.error || 'none'}`);
  }
}

async function main() {
  const fingerprint = await tlsFingerprint();
  const [companyOne, companyTwo] = await Promise.all([
    ownerSession(ownerConfigs[0], 1),
    ownerSession(ownerConfigs[1], 2),
  ]);
  if (companyOne.companyId === companyTwo.companyId) throw new Error('Two license keys unexpectedly resolve to one company');
  await ensureWarehouses(fingerprint, companyTwo);

  const profiles = [
    [warehouseIds[0], ['orders.read', 'orders.create', 'orders.update']],
    [warehouseIds[0], ['orders.read', 'orders.create', 'orders.update']],
    [warehouseIds[0], ['orders.read']],
    [warehouseIds[0], ['inventory.read']],
    [warehouseIds[1], ['orders.read', 'orders.create']],
    [warehouseIds[1], ['inventory.read', 'inventory.catalog']],
    [warehouseIds[1], ['routes.read', 'routes.plan']],
    [warehouseIds[2], ['reports.read']],
    [warehouseIds[2], ['drivers.read', 'drivers.update']],
    [warehouseIds[2], ['orders.read']],
  ];
  const employees = [];
  for (let index = 0; index < profiles.length; index += 1) {
    employees.push(await inviteEmployee(companyTwo, index, profiles[index][0], profiles[index][1]));
  }

  const simultaneous = await Promise.all([
    vpsRequest(fingerprint, companyTwo.token, '/v1/warehouses?environment=live'),
    ...employees.map(employee => vpsRequest(fingerprint, employee.token, '/v1/warehouses?environment=live')),
  ]);
  if (simultaneous.some(result => !result.ok)) throw new Error('At least one of 11 simultaneous sessions failed');
  for (let index = 0; index < employees.length; index += 1) {
    const visible = (simultaneous[index + 1].payload.warehouses || []).map(item => item.id);
    if (visible.length !== 1 || visible[0] !== employees[index].warehouseId) throw new Error(`Employee ${index + 1} sees foreign warehouses: ${visible.join(',')}`);
  }

  const crossCompany = await vpsRequest(fingerprint, companyOne.token, entityPath(companyTwo.companyId, warehouseIds[0]));
  expect(crossCompany, 403, 'workspace_mismatch', 'Cross-company read');
  const crossWarehouse = await vpsRequest(fingerprint, employees[4].token, entityPath(companyTwo.companyId, warehouseIds[0]));
  expect(crossWarehouse, 403, 'warehouse_access_denied', 'Cross-warehouse read');

  const companyViewer = { ...employees[9], companyId: companyTwo.companyId };
  const [ownerCompanyBootstrap, viewerCompanyBootstrap] = await Promise.all([
    currentEntities(fingerprint, companyTwo, warehouseIds[2]),
    currentEntities(fingerprint, companyViewer, warehouseIds[2]),
  ]);
  if (!viewerCompanyBootstrap.readable_types?.includes('company')) {
    throw new Error('Assigned viewer does not receive company as a readable entity type');
  }
  const ownerCompanyEntities = (ownerCompanyBootstrap.entities || []).filter(item => item.type === 'company');
  const viewerCompanyKeys = new Set((viewerCompanyBootstrap.entities || []).filter(item => item.type === 'company').map(item => `${item.id}:${item.digest_sha256}`));
  for (const item of ownerCompanyEntities) {
    if (!viewerCompanyKeys.has(`${item.id}:${item.digest_sha256}`)) throw new Error(`Assigned viewer does not receive company entity ${item.id}`);
  }
  const currentCompany = ownerCompanyEntities[0];
  const deniedCompanyId = currentCompany?.id || `qa-company-denied-${stamp}`;
  const deniedCompanyWrite = await writeBatch(fingerprint, companyViewer, warehouseIds[2], `qa-company-denied-${stamp}`, [{
    type: 'company', id: deniedCompanyId, base_version: Number(currentCompany?.version || 0), deleted: false,
    payload: { ...(currentCompany?.payload || {}), id: deniedCompanyId, warehouseId: warehouseIds[2], programSubtitle: 'Запрещённое изменение аудитора' },
  }]);
  expect(deniedCompanyWrite, 403, 'entity_access_denied', 'Read-only company write');
  const companyCrossWarehouse = await vpsRequest(fingerprint, companyViewer.token, entityPath(companyTwo.companyId, warehouseIds[1]));
  expect(companyCrossWarehouse, 403, 'warehouse_access_denied', 'Company viewer cross-warehouse read');

  const readOnlyCreate = await writeBatch(fingerprint, { ...employees[2], companyId: companyTwo.companyId }, warehouseIds[0], `qa-readonly-create-${stamp}`, [{
    type: 'orders', id: `qa-denied-${stamp}`, base_version: 0, deleted: false,
    payload: { id: `qa-denied-${stamp}`, warehouseId: warehouseIds[0], number: `QA-DENIED-${stamp}`, fulfillmentStatus: 'active', warehouseFlowStatus: 'planned', items: [], createdAt: new Date().toISOString() },
  }]);
  expect(readOnlyCreate, 403, 'entity_access_denied', 'Read-only write');

  const ownerBootstrap = await currentEntities(fingerprint, companyTwo, warehouseIds[0]);
  const concurrencyId = `qa-concurrency-${stamp}`;
  const basePayload = { id: concurrencyId, warehouseId: warehouseIds[0], number: `QA-CON-${stamp}`, fulfillmentStatus: 'active', warehouseFlowStatus: 'planned', internalNote: 'base', items: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const created = await writeBatch(fingerprint, companyTwo, warehouseIds[0], `qa-create-concurrency-${stamp}`, [{ type: 'orders', id: concurrencyId, base_version: 0, deleted: false, payload: basePayload }]);
  if (!created.ok) throw new Error(`Concurrency entity creation failed: ${created.payload?.error || created.status}`);
  const version = Number(created.payload.results?.find(item => item.type === 'orders' && item.id === concurrencyId)?.version || 1);
  const writers = employees.slice(0, 2).map(employee => ({ ...employee, companyId: companyTwo.companyId }));
  const concurrentResults = await Promise.all(writers.map((writer, index) => writeBatch(fingerprint, writer, warehouseIds[0], `qa-race-${index}-${stamp}`, [{
    type: 'orders', id: concurrencyId, base_version: version, deleted: false, payload: { ...basePayload, internalNote: `writer-${index}`, updatedAt: new Date(Date.now() + index + 1).toISOString() },
  }])));
  const raceStatuses = concurrentResults.map(result => result.status).sort((a, b) => a - b);
  if (raceStatuses[0] !== 200 || raceStatuses[1] !== 409 || concurrentResults.find(result => result.status === 409)?.payload?.error !== 'entity_version_conflict') {
    throw new Error(`Optimistic concurrency did not reject exactly one stale writer: ${raceStatuses.join(',')}`);
  }

  const idempotentId = `qa-idempotent-${stamp}`;
  const idempotentCommand = `qa-idempotent-command-${stamp}`;
  const idempotentChange = [{ type: 'orders', id: idempotentId, base_version: 0, deleted: false, payload: { id: idempotentId, warehouseId: warehouseIds[0], number: `QA-IDEM-${stamp}`, fulfillmentStatus: 'active', warehouseFlowStatus: 'planned', items: [], createdAt: new Date().toISOString() } }];
  const idempotentFirst = await writeBatch(fingerprint, companyTwo, warehouseIds[0], idempotentCommand, idempotentChange);
  const idempotentSecond = await writeBatch(fingerprint, companyTwo, warehouseIds[0], idempotentCommand, idempotentChange);
  if (!idempotentFirst.ok || !idempotentSecond.ok || JSON.stringify(idempotentFirst.payload.results) !== JSON.stringify(idempotentSecond.payload.results)) {
    throw new Error('Idempotent command replay changed the result');
  }

  const users = await cloudRequest('/v1/users', { token: companyTwo.token });
  if (!users.ok || (users.payload.users || []).length < 11) throw new Error('Company does not contain owner plus ten employees after the test');
  const warehouseList = await vpsRequest(fingerprint, companyTwo.token, '/v1/warehouses?environment=live');
  if (!warehouseList.ok || warehouseIds.some(id => !(warehouseList.payload.warehouses || []).some(item => item.id === id))) throw new Error('Owner cannot see all three QA warehouses');

  const report = {
    ok: true,
    checkedAt: new Date().toISOString(),
    companies: 2,
    warehouses: 3,
    simultaneousSessions: simultaneous.length,
    employeesCreated: employees.length,
    companyTwoUsers: users.payload.users.length,
    distinctCustomRoles: new Set(employees.map(item => item.role)).size,
    crossCompanyBlocked: crossCompany.status === 403,
    crossWarehouseBlocked: crossWarehouse.status === 403,
    readOnlyWriteBlocked: readOnlyCreate.status === 403,
    optimisticConcurrency: raceStatuses,
    idempotentReplay: true,
    apiContract: Number(API_CONTRACT),
    tlsPinned: true,
    preexistingEntities: Array.isArray(ownerBootstrap.entities) ? ownerBootstrap.entities.length : null,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: safeError(error) })}\n`);
  process.exitCode = 1;
});
