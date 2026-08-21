'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, safeStorage } = require('electron');

const LICENSE_ORIGIN = 'https://justfun-license-api.l2maloy47rus.workers.dev';
const TELEGRAM_ORIGIN = 'https://justfun-company-telegram.l2maloy47rus.workers.dev';

function machineCode() {
  const source = [
    os.hostname(), os.arch(), os.platform(), process.env.USERDOMAIN || '',
    process.env.COMPUTERNAME || '', process.env.SystemDrive || '',
    os.cpus()?.[0]?.model || '', os.totalmem().toString(),
  ].join('|').toUpperCase();
  const hash = crypto.createHash('sha256').update(`JUSTFUN-ORDERS-LOGISTICS-750|${source}`).digest('base64url').toUpperCase();
  return `JF75-${hash.slice(0, 5)}-${hash.slice(5, 10)}-${hash.slice(10, 15)}-${hash.slice(15, 20)}-${hash.slice(20, 25)}`;
}

function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return Number(payload.exp || 0) * 1000;
  } catch { return 0; }
}

async function request(origin, requestPath, { method = 'GET', token = '', body = null } = {}) {
  const response = await fetch(`${origin}${requestPath}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function saveProtectedState(secretPath, store, state) {
  store.licenseCloudAuthV1 = safeStorage.encryptString(JSON.stringify(state)).toString('base64');
  store.updated_at = new Date().toISOString();
  const temporary = `${secretPath}.refresh-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, secretPath);
}

async function main() {
  const secretPath = process.env.JF_NATIVE_SECRETS_PATH;
  if (!secretPath || !path.isAbsolute(secretPath)) throw new Error('JF_NATIVE_SECRETS_PATH is required');
  const appUserData = process.env.JF_APP_USER_DATA_PATH;
  app.setName('JustFun Логистика');
  if (appUserData && path.isAbsolute(appUserData)) {
    // Match main.js exactly: safeStorage is initialized only after the
    // application's persistent profile and its session directory are set.
    app.setPath('userData', appUserData);
    app.setPath('sessionData', path.join(appUserData, 'session'));
  }
  await app.whenReady();
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows protected storage is unavailable');
  const store = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
  const encrypted = String(store.licenseCloudAuthV1 || '');
  if (!encrypted) throw new Error('Saved cloud session was not found');
  let state = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64')));
  let token = String(state.access_token || '');
  let refreshed = false;
  let introspection = await request(LICENSE_ORIGIN, '/v1/auth/introspect', { method: 'POST', token });
  if (introspection.response.status === 401 && state.refresh_token) {
    const refresh = await request(LICENSE_ORIGIN, '/v1/auth/refresh', {
      method: 'POST',
      body: { refresh_token: state.refresh_token, device_id: machineCode() },
    });
    if (!refresh.response.ok || !refresh.payload.access_token) {
      throw new Error(`Saved session refresh failed: ${refresh.payload.error || refresh.response.status}`);
    }
    state = {
      ...state,
      ...refresh.payload,
      user: { ...(state.user || {}), ...(refresh.payload.user || {}) },
      company: { ...(state.company || {}), ...(refresh.payload.company || {}) },
      access_expires_at: tokenExpiry(refresh.payload.access_token),
      offline_expires_at: tokenExpiry(refresh.payload.offline_token),
      last_verified_at: new Date().toISOString(),
      offline: false,
    };
    saveProtectedState(secretPath, store, state);
    token = state.access_token;
    refreshed = true;
    introspection = await request(LICENSE_ORIGIN, '/v1/auth/introspect', { method: 'POST', token });
  }
  if (!introspection.response.ok || !introspection.payload.active) {
    throw new Error(`Saved session is invalid: ${introspection.payload.error || introspection.response.status}`);
  }
  const users = await request(LICENSE_ORIGIN, '/v1/users', { token });
  const telegram = await request(TELEGRAM_ORIGIN, '/v1/company/telegram/status?warehouse_id=warehouse_probe&environment=live', { token });
  const auth = introspection.payload;
  if (!users.response.ok || !Array.isArray(users.payload.users)) throw new Error(`User list failed: ${users.payload.error || users.response.status}`);
  if (telegram.response.status !== 409 || telegram.payload.error !== 'TELEGRAM_NOT_CONFIGURED') {
    throw new Error(`Unsafe Telegram fallback detected: ${telegram.payload.error || telegram.response.status}`);
  }
  const report = {
    ok: true,
    refreshed,
    companyId: auth.company_id,
    role: auth.role,
    permissionCount: Array.isArray(auth.permissions) ? auth.permissions.length : 0,
    userListOk: users.response.ok,
    userCount: Array.isArray(users.payload.users) ? users.payload.users.length : null,
    exactWarehouseFallbackBlocked: telegram.response.status === 409 && telegram.payload.error === 'TELEGRAM_NOT_CONFIGURED',
    telegramProbeStatus: telegram.response.status,
    telegramProbeCode: telegram.payload.error || 'OK',
  };
  const reportPath = process.env.JF_LIVE_SESSION_REPORT;
  if (reportPath) fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main().then(() => {
  process.exit(0);
}).catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(error?.message || error) })}\n`);
  process.exit(1);
});
