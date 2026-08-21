'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');

const LICENSE_ORIGIN = 'https://justfun-license-api.l2maloy47rus.workers.dev';
const BROKER_ORIGIN = 'https://justfun-company-telegram.l2maloy47rus.workers.dev';
const secretsPath = process.env.JF_TEST_SECRETS_PATH || 'C:\\Users\\zvd1\\.justfun-test-secrets.json';
const reportPath = process.env.JF_TELEGRAM_AUDIT_REPORT || '';
const secrets = JSON.parse(fs.readFileSync(path.resolve(secretsPath), 'utf8'));
const vpsHost = String(secrets?.vps?.host || '').trim();
const accounts = [secrets?.license, secrets?.license2].map((entry, index) => ({
  number: index + 1,
  key: String(entry?.key || '').trim(),
  login: String(entry?.ownerLogin || '').trim(),
  password: String(entry?.ownerPassword || ''),
  deviceName: String(entry?.deviceName || `Telegram audit ${index + 1}`).trim(),
}));
const telegramPairs = [secrets?.telegramSPB, secrets?.telegramMSK].map((entry, index) => ({
  label: index === 0 ? 'SPB' : 'MSK',
  token: String(entry?.botToken || '').trim(),
  groupId: String(entry?.groupId || '').trim(),
}));

if (!vpsHost || telegramPairs.some(item => !item.token)) {
  throw new Error('Telegram audit credentials are incomplete');
}

function machineCode() {
  const source = [
    os.hostname(), os.arch(), os.platform(), process.env.USERDOMAIN || '',
    process.env.COMPUTERNAME || '', process.env.SystemDrive || '',
    os.cpus()?.[0]?.model || '', os.totalmem().toString(),
  ].join('|').toUpperCase();
  const hash = crypto.createHash('sha256').update(`JUSTFUN-ORDERS-LOGISTICS-750|${source}`).digest('base64url').toUpperCase();
  return `JF75-${hash.slice(0, 5)}-${hash.slice(5, 10)}-${hash.slice(10, 15)}-${hash.slice(15, 20)}-${hash.slice(20, 25)}`;
}

async function jsonRequest(origin, requestPath, { method = 'GET', token = '', body = null } = {}) {
  const response = await fetch(`${origin}${requestPath}`, {
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

async function ownerSession(account) {
  const check = await jsonRequest(LICENSE_ORIGIN, '/v1/license/check', {
    method: 'POST', body: { license_key: account.key },
  });
  if (!check.ok || check.payload?.can_create_owner) {
    throw new Error(`Account ${account.number} is not ready for login: ${check.payload?.error || check.status}`);
  }
  const login = await jsonRequest(LICENSE_ORIGIN, '/v1/auth/login', {
    method: 'POST',
    body: {
      company_code: check.payload.company.code,
      login: account.login,
      password: account.password,
      device_id: machineCode(),
      device_name: account.deviceName,
    },
  });
  if (!login.ok || !login.payload?.access_token) {
    throw new Error(`Account ${account.number} login failed: ${login.payload?.error || login.status}`);
  }
  return {
    number: account.number,
    token: login.payload.access_token,
    companyId: String(login.payload.company?.id || check.payload.company.id),
    companyCode: String(login.payload.company?.code || check.payload.company.code),
    expectedTls: String(login.payload.company?.data_api_tls_sha256 || '').replace(/:/g, '').toUpperCase(),
  };
}

function currentTlsFingerprint() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: vpsHost,
      port: 443,
      servername: net.isIP(vpsHost) ? undefined : vpsHost,
      rejectUnauthorized: false,
    });
    const timer = setTimeout(() => socket.destroy(new Error('VPS TLS timeout')), 15000);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const fingerprint = String(socket.getPeerCertificate()?.fingerprint256 || '').replace(/:/g, '').toUpperCase();
      socket.end();
      if (!/^[A-F0-9]{64}$/.test(fingerprint)) reject(new Error('VPS TLS fingerprint is unavailable'));
      else resolve(fingerprint);
    });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

function vpsRequest(fingerprint, token, requestPath) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      host: vpsHost,
      port: 443,
      path: requestPath,
      method: 'GET',
      rejectUnauthorized: false,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'x-justfun-api-contract': '2',
        'x-justfun-client-version': '7.8.3',
      },
      timeout: 30000,
    }, response => {
      const peer = String(response.socket.getPeerCertificate()?.fingerprint256 || '').replace(/:/g, '').toUpperCase();
      if (peer !== fingerprint) {
        response.resume();
        reject(new Error('VPS TLS fingerprint changed during request'));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('end', () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        resolve({ status: Number(response.statusCode), ok: Number(response.statusCode) === 200 && payload?.ok !== false, payload });
      });
    });
    request.once('timeout', () => request.destroy(new Error('VPS request timeout')));
    request.once('error', reject);
    request.end();
  });
}

async function telegramPairStatus(pair) {
  const api = `https://api.telegram.org/bot${pair.token}`;
  const me = await jsonRequest(api, '/getMe');
  const webhook = await jsonRequest(api, '/getWebhookInfo');
  const chat = pair.groupId
    ? await jsonRequest(api, `/getChat?chat_id=${encodeURIComponent(pair.groupId)}`)
    : { ok: false, payload: {} };
  return {
    label: pair.label,
    botReachable: me.ok && me.payload?.result?.is_bot === true,
    botUsername: String(me.payload?.result?.username || ''),
    groupIdProvided: Boolean(pair.groupId),
    groupReachable: pair.groupId ? chat.ok && Boolean(chat.payload?.result?.id) : null,
    groupType: String(chat.payload?.result?.type || ''),
    webhookSet: webhook.ok && Boolean(webhook.payload?.result?.url),
    webhookHost: (() => { try { return new URL(webhook.payload?.result?.url || '').host; } catch { return ''; } })(),
    pendingUpdates: Number(webhook.payload?.result?.pending_update_count || 0),
    lastWebhookError: String(webhook.payload?.result?.last_error_message || ''),
  };
}

async function brokerWarehouse(session, warehouse) {
  const query = `warehouse_id=${encodeURIComponent(warehouse.id)}&environment=live`;
  const status = await jsonRequest(BROKER_ORIGIN, `/v1/company/telegram/status?${query}`, { token: session.token });
  const bindings = status.ok
    ? await jsonRequest(BROKER_ORIGIN, `/v1/company/telegram/bindings?${query}`, { token: session.token })
    : { status: 0, ok: false, payload: {} };
  return {
    companyId: session.companyId,
    warehouseId: String(warehouse.id),
    warehouseName: String(warehouse.name || warehouse.code || warehouse.id),
    configured: status.ok,
    status: status.status,
    code: status.payload?.error || 'OK',
    botUsername: String(status.payload?.bot?.username || status.payload?.service?.bot_username || ''),
    serviceWarehouseExact: !status.ok || String(status.payload?.service?.warehouse_id || '') === String(warehouse.id),
    bindingCount: bindings.ok && Array.isArray(bindings.payload?.bindings) ? bindings.payload.bindings.length : 0,
    bindingsOk: !status.ok || bindings.ok,
  };
}

async function main() {
  const fingerprint = await currentTlsFingerprint();
  const completeAccounts = accounts.filter(item => item.key && item.login && item.password);
  const sessions = await Promise.all(completeAccounts.map(ownerSession));
  if (sessions.length === 2 && sessions[0].companyId === sessions[1].companyId) throw new Error('Two licenses resolve to one company');
  const tlsMatches = sessions.every(session => !session.expectedTls || session.expectedTls === fingerprint);
  if (!tlsMatches) throw new Error('Saved VPS TLS fingerprint does not match the live server');

  const telegram = await Promise.all(telegramPairs.map(telegramPairStatus));
  const warehouses = [];
  for (const session of sessions) {
    const response = await vpsRequest(fingerprint, session.token, '/v1/warehouses?environment=live');
    if (!response.ok) throw new Error(`Warehouse list failed for account ${session.number}: ${response.payload?.error || response.status}`);
    warehouses.push({ session, items: Array.isArray(response.payload?.warehouses) ? response.payload.warehouses : [] });
  }

  const services = [];
  for (const group of warehouses) {
    for (const warehouse of group.items) services.push(await brokerWarehouse(group.session, warehouse));
  }

  const leakage = [];
  for (let index = 0; index < warehouses.length; index += 1) {
    const other = warehouses[1 - index];
    if (!other) continue;
    for (const warehouse of other.items) {
      const probe = await jsonRequest(
        BROKER_ORIGIN,
        `/v1/company/telegram/status?warehouse_id=${encodeURIComponent(warehouse.id)}&environment=live`,
        { token: warehouses[index].session.token },
      );
      leakage.push({
        sourceCompanyId: warehouses[index].session.companyId,
        foreignWarehouseId: String(warehouse.id),
        blocked: !probe.ok,
        status: probe.status,
        code: probe.payload?.error || 'OK',
      });
    }
  }

  const configuredByCompany = new Map();
  for (const item of services.filter(service => service.configured && service.botUsername)) {
    const key = item.botUsername.toLowerCase();
    if (!configuredByCompany.has(key)) configuredByCompany.set(key, new Set());
    configuredByCompany.get(key).add(item.companyId);
  }
  const sharedBots = [...configuredByCompany.entries()]
    .filter(([, companyIds]) => companyIds.size > 1)
    .map(([botUsername, companyIds]) => ({ botUsername, companyCount: companyIds.size }));

  const findings = [];
  if (completeAccounts.length !== accounts.length) findings.push('ACCOUNT_CREDENTIALS_MISSING');
  if (telegram.some(item => !item.botReachable || item.groupReachable === false)) findings.push('TELEGRAM_SECRET_PAIR_UNREACHABLE');
  if (telegram.some(item => !item.groupIdProvided)) findings.push('TELEGRAM_GROUP_ID_MISSING');
  if (telegram.some(item => !item.webhookSet || item.lastWebhookError)) findings.push('TELEGRAM_WEBHOOK_UNHEALTHY');
  if (services.some(item => !item.serviceWarehouseExact)) findings.push('BROKER_WAREHOUSE_SCOPE_MISMATCH');
  if (services.some(item => !item.bindingsOk)) findings.push('BROKER_BINDINGS_FAILED');
  if (leakage.some(item => !item.blocked)) findings.push('CROSS_COMPANY_TELEGRAM_LEAK');
  if (sharedBots.length) findings.push('BOT_SHARED_BY_MULTIPLE_COMPANIES');
  if (!services.some(item => item.configured)) findings.push('NO_CURRENT_WAREHOUSE_TELEGRAM_CONFIGURATION');

  const report = {
    ok: findings.length === 0,
    checkedAt: new Date().toISOString(),
    companies: warehouses.map(group => ({
      companyId: group.session.companyId,
      warehouseCount: group.items.length,
      warehouseIds: group.items.map(item => String(item.id)),
    })),
    telegram,
    services,
    leakage,
    sharedBots,
    findings,
  };
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch(error => {
  const message = String(error?.message || error).replace(/\d{6,14}:[A-Za-z0-9_-]{25,120}/g, '<telegram-token>');
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
