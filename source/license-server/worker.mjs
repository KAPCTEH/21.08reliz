const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ACCESS_SECONDS = 15 * 60;
const OFFLINE_SECONDS = 3 * 24 * 60 * 60;
const REFRESH_SECONDS = 30 * 24 * 60 * 60;
const DEMO_SECONDS = 72 * 60 * 60;
const WAREHOUSE_DELETE_LEASE_SECONDS = 120;
const WAREHOUSE_DELETE_LEASE_ACQUIRE_LIMIT = 12;
const WAREHOUSE_DELETE_LEASE_ACQUIRE_WINDOW_SECONDS = 15 * 60;
const VPS_ATTESTATION_MAX_SKEW_SECONDS = 90;
const INVALID_SHA256_HASH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const INVALID_VPS_ATTESTATION_SECRET = `jfvps_${'A'.repeat(43)}`;
const INTEGRATION_SECRET_CONTEXTS = Object.freeze({
  telegramClientKey: 'telegram-client-key-v1',
  dataApiAttestation: 'data-api-attestation-secret-v1',
});
// Cloudflare Workers WebCrypto rejects PBKDF2 iteration counts above 100000.
// Store the iteration count with each password so existing hashes remain
// verifiable while all newly created accounts use the strongest supported
// value on this runtime.
const PASSWORD_ITERATIONS = 100000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_UPSTREAM_BYTES = 3 * 1024 * 1024;

class ApiError extends Error {
  constructor(status, code, message = code, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details && typeof details === 'object' && !Array.isArray(details) ? details : null;
  }
}

const nowIso = () => new Date().toISOString();
const unix = () => Math.floor(Date.now() / 1000);
const id = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const clean = value => String(value ?? '').trim();
const normalizeLogin = value => clean(value).toLowerCase();
const normalizeCode = value => clean(value).toUpperCase();
const normalizeKey = value => normalizeCode(value).replace(/\s+/g, '');
const b64url = bytes => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
};
const fromB64url = value => {
  const text = String(value).replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(text + '='.repeat((4 - text.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};
const randomToken = (bytes = 36) => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return b64url(value);
};
const timingEqual = (left, right) => {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
};
async function sha256(value) {
  return b64url(await crypto.subtle.digest('SHA-256', encoder.encode(String(value))));
}
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const fromHex = value => {
  const text = String(value);
  if (!/^(?:[0-9a-f]{2})+$/.test(text)) throw new ApiError(400, 'VPS_ATTESTATION_INVALID');
  return Uint8Array.from(text.match(/.{2}/g), pair => Number.parseInt(pair, 16));
};
async function sha256Hex(value) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(String(value))));
}
async function hashPassword(password, salt = randomToken(24), iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(salt), iterations },
    key,
    256,
  );
  return { salt, hash: b64url(bits), iterations };
}
async function verifyPassword(password, record) {
  const actual = await hashPassword(password, record.password_salt, Number(record.password_iterations));
  return timingEqual(actual.hash, record.password_hash);
}
async function jwtSecret(env) {
  const secret = clean(env.JWT_SECRET);
  if (secret.length < 32) throw new ApiError(500, 'SERVER_CONFIGURATION_ERROR');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function integrationKeyFromSecret(secretValue) {
  const secret = clean(secretValue);
  if (secret.length < 32) throw new ApiError(500, 'SERVER_CONFIGURATION_ERROR');
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(`justfun-company-integrations-v1:${secret}`));
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
function integrationSecrets(env) {
  const secrets = [...new Set([clean(env.INTEGRATION_SECRET), clean(env.JWT_SECRET)].filter(Boolean))];
  if (!secrets.some(secret => secret.length >= 32)) throw new ApiError(500, 'SERVER_CONFIGURATION_ERROR');
  return secrets.filter(secret => secret.length >= 32);
}
function validateIntegrationSecretContext(value) {
  const context = clean(value || INTEGRATION_SECRET_CONTEXTS.telegramClientKey);
  if (!Object.values(INTEGRATION_SECRET_CONTEXTS).includes(context)) {
    throw new ApiError(500, 'SERVER_CONFIGURATION_ERROR');
  }
  return context;
}
function integrationSecretConfigurationError(context) {
  return context === INTEGRATION_SECRET_CONTEXTS.dataApiAttestation
    ? 'VPS_ATTESTATION_CONFIGURATION_REQUIRED'
    : 'TELEGRAM_CONFIGURATION_REQUIRED';
}
async function encryptIntegrationSecret(env, companyId, value, contextValue = INTEGRATION_SECRET_CONTEXTS.telegramClientKey) {
  const context = validateIntegrationSecretContext(contextValue);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`${context}:${companyId}`) },
    await integrationKeyFromSecret(integrationSecrets(env)[0]),
    encoder.encode(String(value)),
  );
  return `v1.${b64url(iv)}.${b64url(ciphertext)}`;
}
async function decryptIntegrationSecret(env, companyId, value, contextValue = INTEGRATION_SECRET_CONTEXTS.telegramClientKey) {
  const context = validateIntegrationSecretContext(contextValue);
  const configurationError = integrationSecretConfigurationError(context);
  const parts = clean(value).split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new ApiError(500, configurationError);
  for (const secret of integrationSecrets(env)) {
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64url(parts[1]), additionalData: encoder.encode(`${context}:${companyId}`) },
        await integrationKeyFromSecret(secret),
        fromB64url(parts[2]),
      );
      return decoder.decode(plaintext);
    } catch {
      // Support a controlled migration from the JWT fallback to INTEGRATION_SECRET.
    }
  }
  throw new ApiError(500, configurationError);
}
async function signJwt(env, claims, seconds) {
  const header = b64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = unix();
  const payload = b64url(encoder.encode(JSON.stringify({ ...claims, iat: now, exp: now + seconds, iss: 'justfun-license-api' })));
  const input = `${header}.${payload}`;
  const signature = b64url(await crypto.subtle.sign('HMAC', await jwtSecret(env), encoder.encode(input)));
  return `${input}.${signature}`;
}
async function verifyJwt(env, token, type = 'access') {
  const parts = clean(token).split('.');
  if (parts.length !== 3) throw new ApiError(401, 'INVALID_TOKEN');
  const valid = await crypto.subtle.verify(
    'HMAC',
    await jwtSecret(env),
    fromB64url(parts[2]),
    encoder.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new ApiError(401, 'INVALID_TOKEN');
  let payload;
  try { payload = JSON.parse(decoder.decode(fromB64url(parts[1]))); }
  catch { throw new ApiError(401, 'INVALID_TOKEN'); }
  if (payload.iss !== 'justfun-license-api' || payload.typ !== type || Number(payload.exp) <= unix()) {
    throw new ApiError(401, 'INVALID_TOKEN');
  }
  return payload;
}
function json(payload, status = 200, requestId = '') {
  return new Response(JSON.stringify(requestId ? { ...payload, request_id: requestId } : payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}
async function body(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) throw new ApiError(413, 'REQUEST_TOO_LARGE');
  const text = await request.text();
  if (encoder.encode(text).length > MAX_BODY_BYTES) throw new ApiError(413, 'REQUEST_TOO_LARGE');
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new ApiError(400, 'INVALID_JSON'); }
}
function validatePassword(value) {
  const password = String(value ?? '');
  if (password.length < 10) throw new ApiError(400, 'PASSWORD_TOO_SHORT');
  if (password.length > 200) throw new ApiError(400, 'PASSWORD_TOO_LONG');
  if (!/[\p{L}]/u.test(password) || !/\d/.test(password)) {
    throw new ApiError(400, 'PASSWORD_MUST_CONTAIN_LETTERS_AND_NUMBERS');
  }
  return password;
}
function validateLogin(value) {
  const login = normalizeLogin(value);
  if (!/^[a-zа-яё0-9._-]{3,40}$/iu.test(login)) throw new ApiError(400, 'REQUIRED_FIELDS_MISSING');
  return login;
}
function validateFullName(value) {
  const fullName = clean(value);
  if (fullName.length < 2 || fullName.length > 100) throw new ApiError(400, 'REQUIRED_FIELDS_MISSING');
  return fullName;
}
function safePermissions(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(clean).map(permission => {
    const warehouseCode = permission.match(/^jf\.warehouse-code:([A-ZА-ЯЁ0-9]{1,3})$/iu);
    return warehouseCode ? `jf.warehouse-code:${normalizeCode(warehouseCode[1])}` : permission;
  }).filter(item => /^[\p{L}\p{N}.*_:-]{1,120}$/u.test(item)))].slice(0, 100);
}
const ASSIGNABLE_PERMISSIONS = new Set([
  'orders.read','orders.create','orders.update','orders.status','orders.payment','orders.pricing','orders.delete',
  'routes.read','routes.plan','routes.approve','routes.pick','routes.start','routes.return','routes.close','routes.cancel','routes.settings',
  'inventory.read','inventory.catalog','inventory.stock','inventory.pricing','inventory.pick','inventory.delete',
  'drivers.read','drivers.update','drivers.assign','drivers.delete',
  'reports.read','reports.settings','reports.expenses',
  'company.update','warehouses.manage','integrations.manage','users.read','users.create','users.update','devices.manage',
  'orders.update','routes.update','inventory.update','reports.update',
]);
const LEGACY_PERMISSION_EXPANSIONS = Object.freeze({
  'orders.update':['orders.create','orders.status','orders.payment','orders.pricing','orders.delete'],
  'routes.update':['routes.plan','routes.approve','routes.pick','routes.start','routes.return','routes.close','routes.cancel','routes.settings'],
  'inventory.update':['inventory.catalog','inventory.stock','inventory.pricing','inventory.pick','inventory.delete'],
  'drivers.update':['drivers.assign','drivers.delete'],
  'reports.update':['reports.settings','reports.expenses'],
});
function expandLegacyPermissions(value) {
  const result=[];
  for (const permission of safePermissions(value)) {
    if (!result.includes(permission)) result.push(permission);
    for (const expanded of LEGACY_PERMISSION_EXPANSIONS[permission] || []) {
      if (!result.includes(expanded)) result.push(expanded);
    }
  }
  return result;
}
function validateRoleName(value) {
  const role = clean(value).replace(/\s+/g, ' ');
  if (role.toLowerCase() === 'owner' || role.length < 2 || role.length > 50) {
    throw new ApiError(400, 'INVALID_ROLE_NAME');
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._()\/-]*$/u.test(role)) throw new ApiError(400, 'INVALID_ROLE_NAME');
  return role;
}
function permissionsForRole(role, value) {
  if (role === 'owner') return ['*'];
  return expandLegacyPermissions(value).filter(permission => (
    ASSIGNABLE_PERMISSIONS.has(permission)
    || permission === 'jf.warehouse:*'
    || /^jf\.warehouse:[A-Za-z0-9_-]{1,120}$/.test(permission)
    || /^jf\.warehouse-code:[A-ZА-ЯЁ0-9]{1,3}$/u.test(permission)
  ));
}
function permissionCoveredBy(grantorPermissions, permission) {
  const granted = new Set(safePermissions(grantorPermissions));
  if (granted.has('*') || granted.has(permission)) return true;
  const separator = permission.indexOf('.');
  if (separator > 0 && granted.has(`${permission.slice(0, separator)}.*`)) return true;
  if (permission.startsWith('jf.warehouse:') && granted.has('jf.warehouse:*')) return true;
  return false;
}
function permissionsGrantableBy(auth, role, value) {
  const rolePermissions = permissionsForRole(role, value);
  if (auth?.role === 'owner') return rolePermissions;
  const grantable = rolePermissions.filter(permission => permissionCoveredBy(auth?.permissions, permission));
  if (grantable.length !== rolePermissions.length) throw new ApiError(403, 'CANNOT_GRANT_PERMISSION');
  return grantable;
}
function permissionsFromRow(row) {
  let parsed = [];
  try { parsed = JSON.parse(row?.permissions_json || '[]'); }
  catch (error) { console.warn('Invalid permissions_json rejected', {userId:String(row?.id || ''), error:String(error?.message || error)}); }
  return permissionsForRole(clean(row?.role), parsed);
}
function hasPermission(auth, permission) {
  return auth.role === 'owner' || permissionCoveredBy(auth.permissions, permission);
}
function validateTelegramWorkerUrl(value) {
  let url;
  try { url = new URL(clean(value)); }
  catch { throw new ApiError(400, 'TELEGRAM_SERVICE_INVALID'); }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || url.pathname !== '/'
    || url.search
    || url.hash
    || !url.hostname.endsWith('.workers.dev')
  ) {
    throw new ApiError(400, 'TELEGRAM_SERVICE_INVALID');
  }
  return url.origin;
}
function validateWarehouseId(value) {
  const warehouseId = clean(value);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(warehouseId)) throw new ApiError(400, 'WAREHOUSE_REQUIRED');
  return warehouseId;
}
function validateWarehouseCode(value) {
  const warehouseCode = normalizeCode(value);
  if (!/^[A-ZА-ЯЁ0-9]{1,3}$/u.test(warehouseCode)) throw new ApiError(400, 'WAREHOUSE_CODE_REQUIRED');
  return warehouseCode;
}
function validateEnvironment(value) {
  const environment = clean(value).toLowerCase();
  if (!['live', 'demo'].includes(environment)) throw new ApiError(400, 'ENVIRONMENT_REQUIRED');
  return environment;
}
function canAccessWarehouse(auth, warehouseId) {
  return auth.role === 'owner'
    || auth.permissions.includes('*')
    || auth.permissions.includes('jf.warehouse:*')
    || auth.permissions.includes(`jf.warehouse:${warehouseId}`);
}
function requireWarehouseAccess(auth, warehouseId) {
  if (!canAccessWarehouse(auth, warehouseId)) throw new ApiError(403, 'WAREHOUSE_ACCESS_DENIED');
}
async function rateLimit(env, request, group, limit = 30, windowSeconds = 900, options = {}) {
  const address = clean(request.headers.get('cf-connecting-ip') || 'unknown').slice(0, 80);
  const subject = clean(options.subject).toLowerCase().slice(0, 200);
  const dimensions = [];
  if (options.includeAddress !== false) dimensions.push(`ip:${address}`);
  if (subject) dimensions.push(`subject:${subject}`);
  if (!dimensions.length) throw new ApiError(500, 'SERVER_CONFIGURATION_ERROR');
  const bucket = `${group}:${await sha256(dimensions.join('|'))}`;
  // Store a real epoch boundary rather than a window ordinal. Besides making
  // mixed window sizes comparable, this permits safe cleanup of abandoned
  // IP/account buckets created by Internet scans.
  const currentWindow = Math.floor(unix() / windowSeconds) * windowSeconds;
  const row = await env.DB.prepare(`
    INSERT INTO rate_limits(bucket, window_start, hits) VALUES(?,?,1)
    ON CONFLICT(bucket) DO UPDATE SET
      window_start=CASE WHEN window_start=excluded.window_start THEN window_start ELSE excluded.window_start END,
      hits=CASE WHEN window_start=excluded.window_start THEN hits+1 ELSE 1 END
    RETURNING hits
  `).bind(bucket, currentWindow).first();
  if (Number(row?.hits || 0) > limit) throw new ApiError(429, 'TOO_MANY_ATTEMPTS');
}
async function audit(env, requestId, action, companyId = null, userId = null, entityId = null, details = {}) {
  await env.DB.prepare(
    'INSERT INTO audit_log(id,company_id,user_id,action,entity_id,details_json,request_id,created_at) VALUES(?,?,?,?,?,?,?,?)',
  ).bind(id('audit'), companyId, userId, action, entityId, JSON.stringify(details && typeof details === 'object' ? details : {}), requestId, nowIso()).run();
}
function publicUser(row) {
  return {
    id: row.id,
    full_name: row.full_name,
    login: row.login,
    role: row.role,
    permissions: permissionsFromRow(row),
    status: row.status,
  };
}
function publicTelegramService(row) {
  if (!row?.telegram_worker_url) return null;
  return {
    base_url: row.telegram_worker_url,
    bot_username: row.telegram_bot_username || '',
    installation_id: row.telegram_installation_id || '',
    deployment_version: row.telegram_deployment_version || '',
    updated_at: row.telegram_updated_at || null,
  };
}
function publicCompany(row) {
  const company = { id: row.company_id, code: row.company_code, name: row.company_name, status: row.company_status };
  if (row.data_api_address && row.data_api_tls_sha256) {
    company.data_service = {
      address: row.data_api_address,
      api_port: Number(row.data_api_port) || 443,
      tls_sha256: row.data_api_tls_sha256,
      updated_at: row.data_api_updated_at || null,
    };
  }
  const telegramService = publicTelegramService(row);
  if (telegramService) company.telegram_service = telegramService;
  return company;
}
async function issueTokenSet(env, row, deviceId, refreshToken, refreshExpiresAt) {
  const permissions = permissionsFromRow(row);
  const claims = {
    sub: row.id,
    cid: row.company_id,
    did: deviceId,
    role: row.role,
    permissions,
  };
  return {
    ok: true,
    auth_context_version: 2,
    user_id: row.id,
    company_id: row.company_id,
    device_id: deviceId,
    role: row.role,
    permissions,
    access_token: await signJwt(env, { ...claims, typ: 'access' }, ACCESS_SECONDS),
    offline_token: await signJwt(env, { ...claims, typ: 'offline' }, OFFLINE_SECONDS),
    refresh_token: refreshToken,
    access_expires_in: ACCESS_SECONDS,
    offline_expires_in: OFFLINE_SECONDS,
    refresh_expires_at: refreshExpiresAt,
    user: publicUser(row),
    company: publicCompany(row),
  };
}
async function createSession(env, row, deviceId, parentSessionId = null) {
  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + REFRESH_SECONDS * 1000).toISOString();
  const sessionId = id('ses');
  await env.DB.prepare(
    'INSERT INTO sessions(id,company_id,user_id,device_id,refresh_hash,parent_session_id,status,created_at,expires_at) VALUES(?,?,?,?,?,?,\'active\',?,?)',
  ).bind(sessionId, row.company_id, row.id, deviceId, await sha256(refreshToken), parentSessionId, nowIso(), expiresAt).run();
  return issueTokenSet(env, row, deviceId, refreshToken, expiresAt);
}
async function authenticate(env, request) {
  const authorization = clean(request.headers.get('authorization'));
  if (!authorization.startsWith('Bearer ')) throw new ApiError(401, 'INVALID_TOKEN');
  const claims = await verifyJwt(env, authorization.slice(7), 'access');
  const row = await env.DB.prepare(`
    SELECT u.*, c.code company_code, c.name company_name, c.status company_status,
           c.data_api_address,c.data_api_port,c.data_api_tls_sha256,c.data_api_updated_at,
           c.telegram_worker_url,c.telegram_client_key_ciphertext,c.telegram_bot_username,
           c.telegram_installation_id,c.telegram_deployment_version,c.telegram_updated_at,
           l.status license_status, d.status device_status
    FROM users u
    JOIN companies c ON c.id=u.company_id
    JOIN licenses l ON l.company_id=c.id
    JOIN devices d ON d.id=? AND d.user_id=u.id
    WHERE u.id=? AND u.company_id=?
  `).bind(claims.did, claims.sub, claims.cid).first();
  if (!row) throw new ApiError(401, 'INVALID_SESSION');
  if (row.license_status !== 'active' || row.company_status !== 'active') throw new ApiError(403, 'LICENSE_BLOCKED');
  if (row.status !== 'active') throw new ApiError(403, 'USER_BLOCKED');
  if (row.device_status !== 'active') throw new ApiError(403, 'DEVICE_BLOCKED');
  return { ...publicUser(row), company_id: row.company_id, company: publicCompany(row), device_id: claims.did };
}
async function ensureDevice(env, row, deviceValue, deviceName) {
  const normalizedDevice = clean(deviceValue);
  if (!normalizedDevice) throw new ApiError(400, 'REQUIRED_FIELDS_MISSING');
  const deviceHash = await sha256(normalizedDevice);
  let device = await env.DB.prepare(
    'SELECT * FROM devices WHERE user_id=? AND device_hash=?',
  ).bind(row.id, deviceHash).first();
  if (device) {
    if (device.status !== 'active') throw new ApiError(403, 'DEVICE_BLOCKED');
    await env.DB.prepare('UPDATE devices SET device_name=?,last_seen_at=? WHERE id=?')
      .bind(clean(deviceName).slice(0, 120) || 'Компьютер', nowIso(), device.id).run();
    return device.id;
  }
  const deviceId = id('dev');
  try {
    await env.DB.prepare(
      'INSERT INTO devices(id,company_id,user_id,device_hash,device_name,status,created_at,last_seen_at) VALUES(?,?,?,?,?,\'active\',?,?)',
    ).bind(deviceId, row.company_id, row.id, deviceHash, clean(deviceName).slice(0, 120) || 'Компьютер', nowIso(), nowIso()).run();
  } catch (error) {
    if (String(error).includes('DEVICE_LIMIT_REACHED')) throw new ApiError(409, 'DEVICE_LIMIT_REACHED');
    throw error;
  }
  return deviceId;
}
async function licenseCheck(env, request, data) {
  await rateLimit(env, request, 'license-check', 120, 900);
  const key = normalizeKey(data.license_key);
  if (!key) throw new ApiError(400, 'LICENSE_KEY_REQUIRED');
  const row = await env.DB.prepare(`
    SELECT l.*,c.code company_code,c.name company_name,c.status company_status,
           c.data_api_address,c.data_api_port,c.data_api_tls_sha256,c.data_api_updated_at,
           c.telegram_worker_url,c.telegram_client_key_ciphertext,c.telegram_bot_username,
           c.telegram_installation_id,c.telegram_deployment_version,c.telegram_updated_at,
           EXISTS(SELECT 1 FROM license_claims lc WHERE lc.license_id=l.id) owner_created
    FROM licenses l JOIN companies c ON c.id=l.company_id WHERE l.key_hash=?
  `).bind(await sha256(key)).first();
  if (!row) throw new ApiError(404, 'LICENSE_NOT_FOUND');
  if (row.status !== 'active' || row.company_status !== 'active') throw new ApiError(403, 'LICENSE_BLOCKED');
  return {
    ok: true,
    owner_created: Boolean(row.owner_created),
    can_create_owner: !row.owner_created,
    company: { id: row.company_id, code: row.company_code, name: row.company_name },
  };
}
async function registerOwner(env, request, data, requestId) {
  await rateLimit(env, request, 'owner', 15);
  const key = normalizeKey(data.license_key);
  if (!key) throw new ApiError(400, 'LICENSE_KEY_REQUIRED');
  const fullName = validateFullName(data.full_name);
  const login = validateLogin(data.login);
  const password = validatePassword(data.password);
  const deviceValue = clean(data.device_id);
  if (!deviceValue) throw new ApiError(400, 'REQUIRED_FIELDS_MISSING');
  const license = await env.DB.prepare(`
    SELECT l.*,c.code company_code,c.name company_name,c.status company_status,
           c.data_api_address,c.data_api_port,c.data_api_tls_sha256,c.data_api_updated_at,
           c.telegram_worker_url,c.telegram_client_key_ciphertext,c.telegram_bot_username,
           c.telegram_installation_id,c.telegram_deployment_version,c.telegram_updated_at
    FROM licenses l JOIN companies c ON c.id=l.company_id WHERE l.key_hash=?
  `).bind(await sha256(key)).first();
  if (!license) throw new ApiError(404, 'LICENSE_NOT_FOUND');
  if (license.status !== 'active' || license.company_status !== 'active') throw new ApiError(403, 'LICENSE_BLOCKED');

  const passwordRecord = await hashPassword(password);
  const userId = id('usr');
  const deviceId = id('dev');
  const sessionId = id('ses');
  const refreshToken = randomToken(48);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_SECONDS * 1000).toISOString();
  const createdAt = nowIso();
  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users(id,company_id,login,full_name,role,permissions_json,password_salt,password_hash,password_iterations,status,created_at,updated_at)
        VALUES(?,?,?,?,\'owner\',\'["*"]\',?,?,?,\'active\',?,?)
      `).bind(userId, license.company_id, login, fullName, passwordRecord.salt, passwordRecord.hash, passwordRecord.iterations, createdAt, createdAt),
      env.DB.prepare('INSERT INTO license_claims(license_id,user_id,claimed_at) VALUES(?,?,?)').bind(license.id, userId, createdAt),
      env.DB.prepare(`
        INSERT INTO devices(id,company_id,user_id,device_hash,device_name,status,created_at,last_seen_at)
        VALUES(?,?,?,?,?,\'active\',?,?)
      `).bind(deviceId, license.company_id, userId, await sha256(deviceValue), clean(data.device_name).slice(0, 120) || 'Главный компьютер', createdAt, createdAt),
      env.DB.prepare(`
        INSERT INTO sessions(id,company_id,user_id,device_id,refresh_hash,status,created_at,expires_at)
        VALUES(?,?,?,?,?,\'active\',?,?)
      `).bind(sessionId, license.company_id, userId, deviceId, await sha256(refreshToken), createdAt, refreshExpiresAt),
    ]);
  } catch (error) {
    if (/UNIQUE|license_claims/i.test(String(error))) throw new ApiError(409, 'OWNER_ALREADY_CREATED_OR_LOGIN_EXISTS');
    throw error;
  }
  const row = {
    id: userId,
    company_id: license.company_id,
    company_code: license.company_code,
    company_name: license.company_name,
    company_status: license.company_status,
    data_api_address: license.data_api_address,
    data_api_port: license.data_api_port,
    data_api_tls_sha256: license.data_api_tls_sha256,
    data_api_updated_at: license.data_api_updated_at,
    telegram_worker_url: license.telegram_worker_url,
    telegram_client_key_ciphertext: license.telegram_client_key_ciphertext,
    telegram_bot_username: license.telegram_bot_username,
    telegram_installation_id: license.telegram_installation_id,
    telegram_deployment_version: license.telegram_deployment_version,
    telegram_updated_at: license.telegram_updated_at,
    full_name: fullName,
    login,
    role: 'owner',
    permissions_json: '["*"]',
    status: 'active',
  };
  await audit(env, requestId, 'owner.register', license.company_id, userId, license.id);
  return issueTokenSet(env, row, deviceId, refreshToken, refreshExpiresAt);
}
async function login(env, request, data, requestId) {
  // A generous IP ceiling stops request floods without locking an entire
  // office behind one NAT after a few honest mistakes. Invalid credentials
  // are additionally limited per company+login, independent of source IP,
  // to stop distributed password guessing.
  await rateLimit(env, request, 'login-ip', 120, 900);
  const companyCode = normalizeCode(data.company_code);
  const loginValue = validateLogin(data.login);
  const password = String(data.password ?? '');
  const row = await env.DB.prepare(`
    SELECT u.*,c.code company_code,c.name company_name,c.status company_status,
           c.data_api_address,c.data_api_port,c.data_api_tls_sha256,c.data_api_updated_at,
           c.telegram_worker_url,c.telegram_client_key_ciphertext,c.telegram_bot_username,
           c.telegram_installation_id,c.telegram_deployment_version,c.telegram_updated_at,
           l.status license_status
    FROM users u JOIN companies c ON c.id=u.company_id JOIN licenses l ON l.company_id=c.id
    WHERE c.code=? AND u.login=?
  `).bind(companyCode, loginValue).first();
  if (!row || !(await verifyPassword(password, row))) {
    await rateLimit(env, request, 'login-account', 10, 900, {
      includeAddress: false,
      subject: `${companyCode}:${loginValue}`,
    });
    throw new ApiError(401, 'INVALID_CREDENTIALS');
  }
  if (row.license_status !== 'active' || row.company_status !== 'active') throw new ApiError(403, 'LICENSE_BLOCKED');
  if (row.status !== 'active') throw new ApiError(403, 'USER_BLOCKED');
  const deviceId = await ensureDevice(env, row, data.device_id, data.device_name);
  const result = await createSession(env, row, deviceId);
  await audit(env, requestId, 'auth.login', row.company_id, row.id, deviceId);
  return result;
}
async function refresh(env, request, data) {
  await rateLimit(env, request, 'refresh', 600, 900);
  const refreshToken = clean(data.refresh_token);
  const deviceHash = await sha256(clean(data.device_id));
  if (!refreshToken || !clean(data.device_id)) throw new ApiError(401, 'INVALID_SESSION');
  const row = await env.DB.prepare(`
    SELECT s.id session_id,s.expires_at session_expires,u.*,c.code company_code,c.name company_name,c.status company_status,
           c.data_api_address,c.data_api_port,c.data_api_tls_sha256,c.data_api_updated_at,
           c.telegram_worker_url,c.telegram_client_key_ciphertext,c.telegram_bot_username,
           c.telegram_installation_id,c.telegram_deployment_version,c.telegram_updated_at,
           l.status license_status,d.id device_id,d.device_hash,d.status device_status
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    JOIN companies c ON c.id=s.company_id
    JOIN licenses l ON l.company_id=c.id
    JOIN devices d ON d.id=s.device_id
    WHERE s.refresh_hash=? AND s.status='active'
  `).bind(await sha256(refreshToken)).first();
  if (!row || Date.parse(row.session_expires) <= Date.now() || !timingEqual(row.device_hash, deviceHash)) {
    throw new ApiError(401, 'INVALID_SESSION');
  }
  if (row.license_status !== 'active' || row.company_status !== 'active') throw new ApiError(403, 'LICENSE_BLOCKED');
  if (row.status !== 'active') throw new ApiError(403, 'USER_BLOCKED');
  if (row.device_status !== 'active') throw new ApiError(403, 'DEVICE_BLOCKED');
  const newToken = randomToken(48);
  const expiresAt = new Date(Date.now() + REFRESH_SECONDS * 1000).toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE sessions SET status=\'revoked\' WHERE id=? AND status=\'active\'').bind(row.session_id),
      env.DB.prepare(`
        INSERT INTO sessions(id,company_id,user_id,device_id,refresh_hash,parent_session_id,status,created_at,expires_at)
        VALUES(?,?,?,?,?,?,\'active\',?,?)
      `).bind(id('ses'), row.company_id, row.id, row.device_id, await sha256(newToken), row.session_id, nowIso(), expiresAt),
      env.DB.prepare('UPDATE devices SET last_seen_at=? WHERE id=?').bind(nowIso(), row.device_id),
    ]);
  } catch {
    throw new ApiError(401, 'INVALID_SESSION');
  }
  return issueTokenSet(env, row, row.device_id, newToken, expiresAt);
}
async function createInvitation(env, request, data, requestId) {
  const auth = await authenticate(env, request);
  if (!hasPermission(auth, 'users.create')) throw new ApiError(403, 'ACCESS_BLOCKED');
  const fullName = validateFullName(data.full_name);
  const login = validateLogin(data.login);
  const role = validateRoleName(data.role);
  const duplicate = await env.DB.prepare('SELECT 1 found FROM users WHERE company_id=? AND login=?')
    .bind(auth.company_id, login).first();
  if (duplicate) throw new ApiError(409, 'LOGIN_ALREADY_EXISTS');
  const pending = await env.DB.prepare(`
    SELECT 1 found FROM invitations i
    LEFT JOIN invitation_claims c ON c.invitation_id=i.id
    WHERE i.company_id=? AND i.login=? AND i.expires_at>? AND c.invitation_id IS NULL
  `).bind(auth.company_id, login, nowIso()).first();
  if (pending) throw new ApiError(409, 'INVITATION_ALREADY_EXISTS');
  const rawCode = `JFI-${randomToken(12).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16).match(/.{1,4}/g).join('-')}`;
  const expiresHours = Math.max(1, Math.min(168, Number(data.expires_in_hours) || 24));
  const invitation = {
    id: id('inv'),
    full_name: fullName,
    login,
    role,
    permissions: permissionsGrantableBy(auth, role, data.permissions),
    expires_at: new Date(Date.now() + expiresHours * 3600000).toISOString(),
  };
  try {
    await env.DB.prepare(`
      INSERT INTO invitations(id,company_id,code_hash,login,full_name,role,permissions_json,created_by,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).bind(
      invitation.id,
      auth.company_id,
      await sha256(normalizeCode(rawCode)),
      invitation.login,
      invitation.full_name,
      invitation.role,
      JSON.stringify(invitation.permissions),
      auth.id,
      nowIso(),
      invitation.expires_at,
    ).run();
  } catch (error) {
    if (String(error).includes('WAREHOUSE_DELETE_IN_PROGRESS')) {
      throw new ApiError(409, 'WAREHOUSE_DELETE_IN_PROGRESS');
    }
    throw error;
  }
  await audit(env, requestId, 'invitation.create', auth.company_id, auth.id, invitation.id, { role, permissions: invitation.permissions });
  return { ok: true, invitation: { ...invitation, code: rawCode } };
}
async function acceptInvitation(env, request, data, requestId) {
  await rateLimit(env, request, 'invitation', 20);
  const code = normalizeCode(data.invitation_code);
  const password = validatePassword(data.password);
  const deviceValue = clean(data.device_id);
  if (!deviceValue) throw new ApiError(400, 'REQUIRED_FIELDS_MISSING');
  const row = await env.DB.prepare(`
    SELECT i.*,c.code company_code,c.name company_name,c.status company_status,
           c.data_api_address,c.data_api_port,c.data_api_tls_sha256,c.data_api_updated_at,
           c.telegram_worker_url,c.telegram_client_key_ciphertext,c.telegram_bot_username,
           c.telegram_installation_id,c.telegram_deployment_version,c.telegram_updated_at,
           l.status license_status,
           EXISTS(SELECT 1 FROM invitation_claims ic WHERE ic.invitation_id=i.id) already_used
    FROM invitations i JOIN companies c ON c.id=i.company_id JOIN licenses l ON l.company_id=c.id
    WHERE i.code_hash=?
  `).bind(await sha256(code)).first();
  if (!row || row.already_used || Date.parse(row.expires_at) <= Date.now()) throw new ApiError(404, 'INVITATION_INVALID_OR_EXPIRED');
  if (row.license_status !== 'active' || row.company_status !== 'active') throw new ApiError(403, 'LICENSE_BLOCKED');
  const passwordRecord = await hashPassword(password);
  const invitationPermissions = permissionsForRole(row.role, (()=>{try{return JSON.parse(row.permissions_json||'[]')}catch{return[]}})());
  const userId = id('usr');
  const deviceId = id('dev');
  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + REFRESH_SECONDS * 1000).toISOString();
  const createdAt = nowIso();
  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users(id,company_id,login,full_name,role,permissions_json,password_salt,password_hash,password_iterations,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,\'active\',?,?)
      `).bind(userId, row.company_id, row.login, row.full_name, row.role, JSON.stringify(invitationPermissions), passwordRecord.salt, passwordRecord.hash, passwordRecord.iterations, createdAt, createdAt),
      env.DB.prepare('INSERT INTO invitation_claims(invitation_id,user_id,claimed_at) VALUES(?,?,?)').bind(row.id, userId, createdAt),
      env.DB.prepare(`
        INSERT INTO devices(id,company_id,user_id,device_hash,device_name,status,created_at,last_seen_at)
        VALUES(?,?,?,?,?,\'active\',?,?)
      `).bind(deviceId, row.company_id, userId, await sha256(deviceValue), clean(data.device_name).slice(0, 120) || 'Компьютер сотрудника', createdAt, createdAt),
      env.DB.prepare(`
        INSERT INTO sessions(id,company_id,user_id,device_id,refresh_hash,status,created_at,expires_at)
        VALUES(?,?,?,?,?,\'active\',?,?)
      `).bind(id('ses'), row.company_id, userId, deviceId, await sha256(refreshToken), createdAt, expiresAt),
    ]);
  } catch (error) {
    if (String(error).includes('WAREHOUSE_DELETE_IN_PROGRESS')) {
      throw new ApiError(409, 'WAREHOUSE_DELETE_IN_PROGRESS');
    }
    if (/UNIQUE|EMPLOYEE_LIMIT_REACHED/i.test(String(error))) {
      if (String(error).includes('EMPLOYEE_LIMIT_REACHED')) throw new ApiError(409, 'EMPLOYEE_LIMIT_REACHED');
      throw new ApiError(409, 'LOGIN_ALREADY_EXISTS_OR_INVITATION_USED');
    }
    throw error;
  }
  const user = {
    id: userId,
    company_id: row.company_id,
    company_code: row.company_code,
    company_name: row.company_name,
    company_status: row.company_status,
    data_api_address: row.data_api_address,
    data_api_port: row.data_api_port,
    data_api_tls_sha256: row.data_api_tls_sha256,
    data_api_updated_at: row.data_api_updated_at,
    telegram_worker_url: row.telegram_worker_url,
    telegram_client_key_ciphertext: row.telegram_client_key_ciphertext,
    telegram_bot_username: row.telegram_bot_username,
    telegram_installation_id: row.telegram_installation_id,
    telegram_deployment_version: row.telegram_deployment_version,
    telegram_updated_at: row.telegram_updated_at,
    full_name: row.full_name,
    login: row.login,
    role: row.role,
    permissions_json: JSON.stringify(invitationPermissions),
    status: 'active',
  };
  await audit(env, requestId, 'invitation.accept', row.company_id, userId, row.id);
  return issueTokenSet(env, user, deviceId, refreshToken, expiresAt);
}
async function listUsers(env, request) {
  const auth = await authenticate(env, request);
  if (!hasPermission(auth, 'users.read')) throw new ApiError(403, 'ACCESS_BLOCKED');
  const result = await env.DB.prepare(`
    SELECT id,full_name,login,role,permissions_json,status,created_at,updated_at
    FROM users WHERE company_id=? ORDER BY role='owner' DESC,full_name COLLATE NOCASE
  `).bind(auth.company_id).all();
  return { ok: true, users: result.results.map(publicUser) };
}
async function setUserStatus(env, request, userId, data, requestId) {
  const auth = await authenticate(env, request);
  if (!hasPermission(auth, 'users.update')) throw new ApiError(403, 'ACCESS_BLOCKED');
  const status = clean(data.status);
  if (!['active', 'blocked'].includes(status)) throw new ApiError(400, 'INVALID_STATUS');
  if (userId === auth.id) throw new ApiError(409, 'CANNOT_BLOCK_SELF');
  const target = await env.DB.prepare('SELECT role FROM users WHERE id=? AND company_id=?').bind(userId, auth.company_id).first();
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND');
  if (target.role === 'owner') throw new ApiError(409, 'OWNER_CANNOT_BE_BLOCKED_HERE');
  await env.DB.prepare('UPDATE users SET status=?,updated_at=? WHERE id=? AND company_id=?')
    .bind(status, nowIso(), userId, auth.company_id).run();
  if (status === 'blocked') {
    await env.DB.prepare('UPDATE sessions SET status=\'revoked\' WHERE user_id=?').bind(userId).run();
  }
  await audit(env, requestId, 'user.status', auth.company_id, auth.id, userId);
  return { ok: true, user_id: userId, status };
}
async function setUserAccess(env, request, userId, data, requestId) {
  const auth = await authenticate(env, request);
  if (!hasPermission(auth, 'users.update')) throw new ApiError(403, 'ACCESS_BLOCKED');
  const role = validateRoleName(data.role);
  if (userId === auth.id) throw new ApiError(409, 'CANNOT_CHANGE_SELF');
  const target = await env.DB.prepare('SELECT role,permissions_json FROM users WHERE id=? AND company_id=?')
    .bind(userId, auth.company_id).first();
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND');
  if (target.role === 'owner') throw new ApiError(409, 'OWNER_CANNOT_BE_CHANGED_HERE');
  const permissions = permissionsGrantableBy(auth, role, data.permissions);
  try {
    await env.DB.prepare('UPDATE users SET role=?,permissions_json=?,updated_at=? WHERE id=? AND company_id=?')
      .bind(role, JSON.stringify(permissions), nowIso(), userId, auth.company_id).run();
  } catch (error) {
    if (String(error).includes('WAREHOUSE_DELETE_IN_PROGRESS')) {
      throw new ApiError(409, 'WAREHOUSE_DELETE_IN_PROGRESS');
    }
    throw error;
  }
  await audit(env, requestId, 'user.access', auth.company_id, auth.id, userId, {
    before: { role: target.role, permissions: permissionsFromRow(target) },
    after: { role, permissions },
  });
  return { ok: true, user_id: userId, role, permissions };
}
function normalizeWarehouseDeleteTarget(data) {
  return {
    warehouse_id: validateWarehouseId(data?.warehouse_id),
    warehouse_code: validateWarehouseCode(data?.warehouse_code),
  };
}
function normalizeVpsAttestationPayload(data, includeLeaseToken) {
  const rawCompanyId = typeof data?.company_id === 'string' ? data.company_id : '';
  const rawWarehouseId = typeof data?.warehouse_id === 'string' ? data.warehouse_id : '';
  const rawWarehouseCode = typeof data?.warehouse_code === 'string' ? data.warehouse_code : '';
  const rawDeleteCommandId = typeof data?.delete_command_id === 'string' ? data.delete_command_id : '';
  const rawLeaseToken = typeof data?.lease_token === 'string' ? data.lease_token : '';
  const companyId = clean(rawCompanyId);
  const warehouseId = clean(rawWarehouseId);
  const warehouseCode = normalizeCode(rawWarehouseCode);
  const deleteCommandId = clean(rawDeleteCommandId);
  const deleteBaseVersion = data?.delete_base_version;
  const leaseToken = includeLeaseToken ? clean(rawLeaseToken) : '';
  if (
    rawCompanyId !== companyId
    || rawWarehouseId !== warehouseId
    || rawWarehouseCode !== warehouseCode
    || rawDeleteCommandId !== deleteCommandId
    || (includeLeaseToken && rawLeaseToken !== leaseToken)
    || !/^[A-Za-z0-9_-]{1,120}$/.test(companyId)
    || !/^[A-Za-z0-9_-]{1,120}$/.test(warehouseId)
    || !/^[A-ZА-ЯЁ0-9]{1,3}$/u.test(warehouseCode)
    || !/^[A-Za-z0-9._:-]{1,220}$/.test(deleteCommandId)
    || !Number.isSafeInteger(deleteBaseVersion)
    || deleteBaseVersion < 1
    || (includeLeaseToken && !/^jfdl_[A-Za-z0-9_-]{32,220}$/.test(leaseToken))
    || (!includeLeaseToken && data?.lease_token !== undefined && data.lease_token !== '')
  ) {
    throw new ApiError(400, 'VPS_ATTESTATION_INVALID');
  }
  return {
    company_id: companyId,
    warehouse_id: warehouseId,
    warehouse_code: warehouseCode,
    delete_command_id: deleteCommandId,
    delete_base_version: deleteBaseVersion,
    lease_token: leaseToken,
  };
}
function vpsAttestationSignatureHeaders(request) {
  const timestampText = clean(request.headers.get('x-justfun-vps-timestamp'));
  const nonce = clean(request.headers.get('x-justfun-vps-nonce'));
  const signature = clean(request.headers.get('x-justfun-vps-signature'));
  if (
    !/^[1-9][0-9]{9,11}$/.test(timestampText)
    || !/^[A-Za-z0-9_-]{16,120}$/.test(nonce)
    || !/^v1=[0-9a-f]{64}$/.test(signature)
  ) {
    throw new ApiError(401, 'VPS_ATTESTATION_INVALID');
  }
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(unix() - timestamp) > VPS_ATTESTATION_MAX_SKEW_SECONDS) {
    throw new ApiError(401, 'VPS_ATTESTATION_INVALID');
  }
  return { timestamp, timestamp_text: timestampText, nonce, signature_hex: signature.slice(3) };
}
async function buildVpsAttestationCanonicalString(payload, timestamp, nonce) {
  return [
    'justfun-vps-telegram-deprovision-v1',
    payload.company_id,
    payload.warehouse_id,
    payload.warehouse_code,
    payload.delete_command_id,
    String(payload.delete_base_version),
    await sha256Hex(payload.lease_token || ''),
    String(timestamp),
    nonce,
  ].join('\n');
}
async function companyVpsAttestationSecret(env, companyId) {
  const row = await env.DB.prepare(`
    SELECT data_api_attestation_secret_ciphertext
    FROM companies WHERE id=?
  `).bind(companyId).first();
  let secret = INVALID_VPS_ATTESTATION_SECRET;
  let configured = false;
  if (row?.data_api_attestation_secret_ciphertext) {
    try {
      const decrypted = await decryptIntegrationSecret(
        env,
        companyId,
        row.data_api_attestation_secret_ciphertext,
        INTEGRATION_SECRET_CONTEXTS.dataApiAttestation,
      );
      if (/^jfvps_[A-Za-z0-9_-]{43,120}$/.test(decrypted)) {
        secret = decrypted;
        configured = true;
      }
    } catch {
      // Missing, corrupt, cross-company and cross-purpose ciphertext all fail identically.
    }
  }
  return { secret, configured };
}
async function verifyVpsAttestationRequest(env, request, data, includeLeaseToken) {
  const payload = normalizeVpsAttestationPayload(data, includeLeaseToken);
  const headers = vpsAttestationSignatureHeaders(request);
  const canonical = await buildVpsAttestationCanonicalString(payload, headers.timestamp_text, headers.nonce);
  const stored = await companyVpsAttestationSecret(env, payload.company_id);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(stored.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const verified = await crypto.subtle.verify(
    'HMAC',
    key,
    fromHex(headers.signature_hex),
    encoder.encode(canonical),
  );
  if (!stored.configured || !verified) throw new ApiError(401, 'VPS_ATTESTATION_INVALID');
  return payload;
}
function publicWarehouseDeleteLease(row) {
  const prepared = row.status === 'prepared';
  return {
    id: row.id,
    company_id: row.company_id,
    warehouse_id: row.warehouse_id,
    warehouse_code: row.warehouse_code,
    actor_user_id: row.actor_user_id,
    status: row.status,
    expires_at: prepared ? null : new Date(Number(row.expires_at) * 1000).toISOString(),
  };
}
function fixedSha256Bytes(value) {
  try {
    const bytes = fromB64url(value);
    if (bytes.length === 32) return { bytes, valid: true };
  } catch {
    // Corrupt stored data must fail closed after the same fixed-size compare.
  }
  return { bytes: new Uint8Array(32), valid: false };
}
function timingSafeHashEqual(left, right) {
  const a = fixedSha256Bytes(left);
  const b = fixedSha256Bytes(right);
  let equal;
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    equal = crypto.subtle.timingSafeEqual(a.bytes, b.bytes);
  } else {
    let difference = 0;
    for (let index = 0; index < 32; index++) difference |= a.bytes[index] ^ b.bytes[index];
    equal = difference === 0;
  }
  return a.valid && b.valid && equal;
}
async function warehouseDeleteLeaseTokenMatches(token, expectedHash) {
  return timingSafeHashEqual(await sha256(String(token ?? '')), expectedHash);
}
async function authorizeWarehouseDeleteLease(env, request) {
  const auth = await authenticate(env, request);
  const permissions = Array.isArray(auth.permissions) ? auth.permissions : [];
  const globalWarehouseAccess = auth.role === 'owner'
    || permissions.includes('*')
    || permissions.includes('jf.warehouse:*');
  if (!globalWarehouseAccess || !hasPermission(auth, 'warehouses.manage')) {
    throw new ApiError(403, 'ACCESS_BLOCKED');
  }
  return auth;
}
async function cleanupExpiredWarehouseDeleteLeases(env, companyId) {
  await env.DB.prepare(`
    UPDATE warehouse_delete_leases
    SET status='expired',updated_at=?
    WHERE company_id=? AND status='active' AND expires_at<=?
  `).bind(nowIso(), companyId, unix()).run();
}
async function warehouseAssignmentSummary(env, companyId, target) {
  const exactId = `jf.warehouse:${target.warehouse_id}`;
  const exactCode = `jf.warehouse-code:${target.warehouse_code}`;
  const row = await env.DB.prepare(`
    SELECT
      (
        SELECT COUNT(*)
        FROM users AS u
        WHERE u.company_id=?
          AND EXISTS (
            SELECT 1
            FROM json_each(CASE WHEN json_valid(u.permissions_json) THEN u.permissions_json ELSE '[]' END) AS permission
            WHERE CAST(permission.value AS TEXT)=? OR CAST(permission.value AS TEXT)=?
          )
      ) AS users,
      (
        SELECT COUNT(*)
        FROM invitations AS invitation
        WHERE invitation.company_id=?
          AND invitation.expires_at>?
          AND NOT EXISTS (
            SELECT 1 FROM invitation_claims AS claim WHERE claim.invitation_id=invitation.id
          )
          AND EXISTS (
            SELECT 1
            FROM json_each(CASE WHEN json_valid(invitation.permissions_json) THEN invitation.permissions_json ELSE '[]' END) AS permission
            WHERE CAST(permission.value AS TEXT)=? OR CAST(permission.value AS TEXT)=?
          )
      ) AS pending_invitations
  `).bind(
    companyId,
    exactId,
    exactCode,
    companyId,
    nowIso(),
    exactId,
    exactCode,
  ).first();
  const users = Math.max(0, Math.floor(Number(row?.users) || 0));
  const pendingInvitations = Math.max(0, Math.floor(Number(row?.pending_invitations) || 0));
  return { count: users + pendingInvitations, users, pending_invitations: pendingInvitations };
}
async function auditWarehouseDeleteLeaseConflict(env, requestId, auth, target, assigned) {
  await audit(
    env,
    requestId,
    'warehouse.delete-lease.conflict',
    auth.company_id,
    auth.id,
    target.warehouse_id,
    { ...target, assigned },
  );
}
function warehouseDeleteLeaseResponse(row, remainingSeconds, extra = {}) {
  const prepared = row.status === 'prepared';
  return {
    ok: true,
    active: true,
    prepared,
    status: row.status,
    lease: publicWarehouseDeleteLease(row),
    remaining_seconds: prepared ? null : remainingSeconds,
    ...extra,
  };
}
async function rotatePreparedWarehouseDeleteLease(env, auth, target, requestId) {
  const leaseToken = `jfdl_${randomToken(32)}`;
  const tokenHash = await sha256(leaseToken);
  const rotatedAt = nowIso();
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE warehouse_delete_leases
      SET token_hash=?,actor_user_id=?,updated_at=?
      WHERE company_id=? AND warehouse_id=? AND warehouse_code=?
        AND status='prepared'
      RETURNING id,company_id,warehouse_id,warehouse_code,actor_user_id,token_hash,status,expires_at,created_at,updated_at
    `).bind(
      tokenHash,
      auth.id,
      rotatedAt,
      auth.company_id,
      target.warehouse_id,
      target.warehouse_code,
    ),
    env.DB.prepare(`
      INSERT INTO audit_log(id,company_id,user_id,action,entity_id,details_json,request_id,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE changes()=1
    `).bind(
      id('audit'),
      auth.company_id,
      auth.id,
      'warehouse.delete-lease.recover',
      target.warehouse_id,
      JSON.stringify({ ...target, status: 'prepared', actor_takeover_allowed: true }),
      requestId,
      rotatedAt,
    ),
  ]);
  const row = results?.[0]?.results?.[0] || null;
  return row ? { row, leaseToken } : null;
}
async function acquireWarehouseDeleteLease(env, request, data, requestId) {
  const auth = await authorizeWarehouseDeleteLease(env, request);
  await rateLimit(
    env,
    request,
    'warehouse-delete-lease-acquire',
    WAREHOUSE_DELETE_LEASE_ACQUIRE_LIMIT,
    WAREHOUSE_DELETE_LEASE_ACQUIRE_WINDOW_SECONDS,
    { subject: `${auth.company_id}:${auth.id}` },
  );
  const target = normalizeWarehouseDeleteTarget(data);
  await cleanupExpiredWarehouseDeleteLeases(env, auth.company_id);
  const recovered = await rotatePreparedWarehouseDeleteLease(env, auth, target, requestId);
  if (recovered) {
    return warehouseDeleteLeaseResponse(recovered.row, null, {
      recovered: true,
      lease_token: recovered.leaseToken,
    });
  }
  let assigned = await warehouseAssignmentSummary(env, auth.company_id, target);
  if (assigned.count) {
    await auditWarehouseDeleteLeaseConflict(env, requestId, auth, target, assigned);
    throw new ApiError(409, 'WAREHOUSE_ASSIGNED', 'WAREHOUSE_ASSIGNED', { assigned });
  }

  const leaseToken = `jfdl_${randomToken(32)}`;
  const lease = {
    id: id('wdl'),
    company_id: auth.company_id,
    warehouse_id: target.warehouse_id,
    warehouse_code: target.warehouse_code,
    actor_user_id: auth.id,
    token_hash: await sha256(leaseToken),
    status: 'active',
    expires_at: unix() + WAREHOUSE_DELETE_LEASE_SECONDS,
    created_at: nowIso(),
  };
  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO warehouse_delete_leases(
          id,company_id,warehouse_id,warehouse_code,actor_user_id,token_hash,status,expires_at,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,'active',?,?,?)
      `).bind(
        lease.id,
        lease.company_id,
        lease.warehouse_id,
        lease.warehouse_code,
        lease.actor_user_id,
        lease.token_hash,
        lease.expires_at,
        lease.created_at,
        lease.created_at,
      ),
      env.DB.prepare(`
        INSERT INTO audit_log(id,company_id,user_id,action,entity_id,details_json,request_id,created_at)
        VALUES(?,?,?,?,?,?,?,?)
      `).bind(
        id('audit'),
        lease.company_id,
        lease.actor_user_id,
        'warehouse.delete-lease.acquire',
        lease.id,
        JSON.stringify({
          warehouse_id: lease.warehouse_id,
          warehouse_code: lease.warehouse_code,
          expires_at: publicWarehouseDeleteLease(lease).expires_at,
        }),
        requestId,
        lease.created_at,
      ),
    ]);
  } catch (error) {
    const message = String(error);
    if (message.includes('WAREHOUSE_ASSIGNED')) {
      assigned = await warehouseAssignmentSummary(env, auth.company_id, target);
      await auditWarehouseDeleteLeaseConflict(env, requestId, auth, target, assigned);
      throw new ApiError(409, 'WAREHOUSE_ASSIGNED', 'WAREHOUSE_ASSIGNED', { assigned });
    }
    if (/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message)) {
      throw new ApiError(409, 'WAREHOUSE_DELETE_LEASE_ACTIVE');
    }
    throw error;
  }
  return warehouseDeleteLeaseResponse(lease, WAREHOUSE_DELETE_LEASE_SECONDS, {
    recovered: false,
    lease_token: leaseToken,
  });
}
async function resolveWarehouseDeleteLease(env, auth, data, minimumRemainingSeconds = 0) {
  const target = normalizeWarehouseDeleteTarget(data);
  await cleanupExpiredWarehouseDeleteLeases(env, auth.company_id);
  const row = await env.DB.prepare(`
    SELECT id,company_id,warehouse_id,warehouse_code,actor_user_id,token_hash,status,expires_at,created_at,updated_at
    FROM warehouse_delete_leases
    WHERE company_id=? AND warehouse_id=? AND warehouse_code=? AND actor_user_id=?
      AND (
        status='prepared'
        OR (status='active' AND expires_at>?)
      )
    ORDER BY CASE status WHEN 'prepared' THEN 0 ELSE 1 END, created_at DESC LIMIT 1
  `).bind(
    auth.company_id,
    target.warehouse_id,
    target.warehouse_code,
    auth.id,
    unix(),
  ).first();
  const tokenMatches = await warehouseDeleteLeaseTokenMatches(
    data?.lease_token,
    row?.token_hash || INVALID_SHA256_HASH,
  );
  if (!row || !tokenMatches) {
    throw new ApiError(409, 'WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED');
  }
  const durable = row.status === 'prepared' || row.status === 'released';
  const remainingSeconds = durable ? null : Number(row.expires_at) - unix();
  if (!durable && remainingSeconds < minimumRemainingSeconds) {
    throw new ApiError(409, 'WAREHOUSE_DELETE_LEASE_REACQUIRE_REQUIRED');
  }
  return { row, target, remaining_seconds: remainingSeconds };
}
async function resolveWarehouseDeleteLeaseForRelease(env, auth, data) {
  const target = normalizeWarehouseDeleteTarget(data);
  await cleanupExpiredWarehouseDeleteLeases(env, auth.company_id);
  const result = await env.DB.prepare(`
    SELECT id,company_id,warehouse_id,warehouse_code,actor_user_id,token_hash,status,expires_at,created_at,updated_at
    FROM warehouse_delete_leases
    WHERE company_id=? AND warehouse_id=? AND warehouse_code=? AND actor_user_id=?
      AND (status='prepared' OR status='released' OR (status='active' AND expires_at>?))
    ORDER BY created_at DESC
  `).bind(
    auth.company_id,
    target.warehouse_id,
    target.warehouse_code,
    auth.id,
    unix(),
  ).all();
  const rows = Array.isArray(result?.results) ? result.results : [];
  const actualHash = await sha256(String(data?.lease_token ?? ''));
  let row = null;
  if (!rows.length) timingSafeHashEqual(actualHash, INVALID_SHA256_HASH);
  for (const candidate of rows) {
    const matches = timingSafeHashEqual(actualHash, candidate?.token_hash || INVALID_SHA256_HASH);
    if (matches && !row) row = candidate;
  }
  if (!row) throw new ApiError(409, 'WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED');
  return { row, target };
}
async function prepareWarehouseDeleteLease(env, request, data, requestId) {
  const auth = await authorizeWarehouseDeleteLease(env, request);
  const resolved = await resolveWarehouseDeleteLease(env, auth, data);
  if (resolved.row.status === 'prepared') {
    return warehouseDeleteLeaseResponse(resolved.row, null, { idempotent: true });
  }

  const preparedAt = nowIso();
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE warehouse_delete_leases
      SET status='prepared',updated_at=?
      WHERE id=? AND company_id=? AND warehouse_id=? AND warehouse_code=? AND actor_user_id=?
        AND token_hash=? AND status='active' AND expires_at>?
    `).bind(
      preparedAt,
      resolved.row.id,
      auth.company_id,
      resolved.target.warehouse_id,
      resolved.target.warehouse_code,
      auth.id,
      resolved.row.token_hash,
      unix(),
    ),
    env.DB.prepare(`
      INSERT INTO audit_log(id,company_id,user_id,action,entity_id,details_json,request_id,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE changes()=1
    `).bind(
      id('audit'),
      auth.company_id,
      auth.id,
      'warehouse.delete-lease.prepare',
      resolved.row.id,
      JSON.stringify({ ...resolved.target, status: 'prepared', idempotent: false }),
      requestId,
      preparedAt,
    ),
  ]);
  if (!Number(results?.[0]?.meta?.changes || 0)) {
    const concurrent = await resolveWarehouseDeleteLease(env, auth, data);
    if (concurrent.row.status !== 'prepared') {
      throw new ApiError(409, 'WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED');
    }
    return warehouseDeleteLeaseResponse(concurrent.row, null, { idempotent: true });
  }
  return warehouseDeleteLeaseResponse(
    { ...resolved.row, status: 'prepared', updated_at: preparedAt },
    null,
    { idempotent: false },
  );
}
async function verifyWarehouseDeleteLease(env, request, data, requestId) {
  const auth = await authorizeWarehouseDeleteLease(env, request);
  const resolved = await resolveWarehouseDeleteLease(env, auth, data, 30);
  await audit(
    env,
    requestId,
    'warehouse.delete-lease.verify',
    auth.company_id,
    auth.id,
    resolved.row.id,
    { ...resolved.target, remaining_seconds: resolved.remaining_seconds },
  );
  return warehouseDeleteLeaseResponse(resolved.row, resolved.remaining_seconds);
}
async function releaseWarehouseDeleteLease(env, request, data, requestId) {
  const auth = await authorizeWarehouseDeleteLease(env, request);
  const resolved = await resolveWarehouseDeleteLeaseForRelease(env, auth, data);
  if (resolved.row.status === 'released') {
    return {
      ok: true,
      released: true,
      prepared: false,
      status: 'released',
      idempotent: true,
      lease: publicWarehouseDeleteLease(resolved.row),
    };
  }
  const releasedAt = nowIso();
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE warehouse_delete_leases
      SET status='released',updated_at=?
      WHERE id=? AND company_id=? AND actor_user_id=? AND token_hash=?
        AND (status='prepared' OR (status='active' AND expires_at>?))
    `).bind(
      releasedAt,
      resolved.row.id,
      auth.company_id,
      auth.id,
      resolved.row.token_hash,
      unix(),
    ),
    env.DB.prepare(`
      INSERT INTO audit_log(id,company_id,user_id,action,entity_id,details_json,request_id,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE changes()=1
    `).bind(
      id('audit'),
      auth.company_id,
      auth.id,
      'warehouse.delete-lease.release',
      resolved.row.id,
      JSON.stringify(resolved.target),
      requestId,
      releasedAt,
    ),
  ]);
  if (!Number(results?.[0]?.meta?.changes || 0)) {
    throw new ApiError(409, 'WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED');
  }
  return {
    ok: true,
    released: true,
    prepared: false,
    status: 'released',
    idempotent: false,
    lease: publicWarehouseDeleteLease({ ...resolved.row, status: 'released', updated_at: releasedAt }),
  };
}
async function resolveVpsAttestedPreparedLease(env, payload) {
  const row = await env.DB.prepare(`
    SELECT id,company_id,warehouse_id,warehouse_code,actor_user_id,token_hash,status,expires_at,created_at,updated_at
    FROM warehouse_delete_leases
    WHERE company_id=? AND warehouse_id=? AND warehouse_code=? AND status='prepared'
    ORDER BY created_at DESC LIMIT 1
  `).bind(
    payload.company_id,
    payload.warehouse_id,
    payload.warehouse_code,
  ).first();
  const tokenMatches = await warehouseDeleteLeaseTokenMatches(
    payload.lease_token,
    row?.token_hash || INVALID_SHA256_HASH,
  );
  if (!row || !tokenMatches) throw new ApiError(409, 'WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED');
  return row;
}
async function verifyVpsAttestation(env, request, data, requestId) {
  const payload = await verifyVpsAttestationRequest(env, request, data, true);
  const row = await resolveVpsAttestedPreparedLease(env, payload);
  await audit(
    env,
    requestId,
    'warehouse.delete-lease.verify-vps-attestation',
    payload.company_id,
    null,
    row.id,
    {
      system_actor: 'vps-attestation',
      warehouse_id: payload.warehouse_id,
      warehouse_code: payload.warehouse_code,
      delete_command_id: payload.delete_command_id,
      delete_base_version: payload.delete_base_version,
    },
  );
  return {
    ok: true,
    verified: true,
    active: true,
    prepared: true,
    status: 'prepared',
    company_id: payload.company_id,
    warehouse_id: payload.warehouse_id,
    warehouse_code: payload.warehouse_code,
    delete_command_id: payload.delete_command_id,
    delete_base_version: payload.delete_base_version,
    lease: publicWarehouseDeleteLease(row),
  };
}
async function resolveVpsAttestedLeaseForRelease(env, payload) {
  return env.DB.prepare(`
    SELECT id,company_id,warehouse_id,warehouse_code,actor_user_id,token_hash,status,expires_at,created_at,updated_at
    FROM warehouse_delete_leases
    WHERE company_id=? AND warehouse_id=? AND warehouse_code=?
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).bind(
    payload.company_id,
    payload.warehouse_id,
    payload.warehouse_code,
  ).first();
}
async function resolveExactVpsAttestedLease(env, payload, leaseId) {
  return env.DB.prepare(`
    SELECT id,company_id,warehouse_id,warehouse_code,actor_user_id,token_hash,status,expires_at,created_at,updated_at
    FROM warehouse_delete_leases
    WHERE id=? AND company_id=? AND warehouse_id=? AND warehouse_code=?
    LIMIT 1
  `).bind(
    leaseId,
    payload.company_id,
    payload.warehouse_id,
    payload.warehouse_code,
  ).first();
}
async function releaseWarehouseDeleteLeaseByVpsAttestation(env, request, data, requestId) {
  const payload = await verifyVpsAttestationRequest(env, request, data, false);
  let row = await resolveVpsAttestedLeaseForRelease(env, payload);
  if (!row || !['prepared', 'released'].includes(row.status)) {
    throw new ApiError(409, 'WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED');
  }
  if (row.status === 'released') {
    return {
      ok: true,
      released: true,
      status: 'released',
      idempotent: true,
      company_id: payload.company_id,
      warehouse_id: payload.warehouse_id,
      warehouse_code: payload.warehouse_code,
      delete_command_id: payload.delete_command_id,
      delete_base_version: payload.delete_base_version,
      lease: publicWarehouseDeleteLease(row),
    };
  }

  const releasedAt = nowIso();
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE warehouse_delete_leases
      SET status='released',updated_at=?
      WHERE id=? AND company_id=? AND warehouse_id=? AND warehouse_code=? AND status='prepared'
    `).bind(
      releasedAt,
      row.id,
      payload.company_id,
      payload.warehouse_id,
      payload.warehouse_code,
    ),
    env.DB.prepare(`
      INSERT INTO audit_log(id,company_id,user_id,action,entity_id,details_json,request_id,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE changes()=1
    `).bind(
      id('audit'),
      payload.company_id,
      null,
      'warehouse.delete-lease.release-vps-attestation',
      row.id,
      JSON.stringify({
        system_actor: 'vps-attestation',
        warehouse_id: payload.warehouse_id,
        warehouse_code: payload.warehouse_code,
        delete_command_id: payload.delete_command_id,
        delete_base_version: payload.delete_base_version,
      }),
      requestId,
      releasedAt,
    ),
  ]);
  if (!Number(results?.[0]?.meta?.changes || 0)) {
    row = await resolveExactVpsAttestedLease(env, payload, row.id);
    if (!row || row.status !== 'released') {
      throw new ApiError(409, 'WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED');
    }
    return {
      ok: true,
      released: true,
      status: 'released',
      idempotent: true,
      company_id: payload.company_id,
      warehouse_id: payload.warehouse_id,
      warehouse_code: payload.warehouse_code,
      delete_command_id: payload.delete_command_id,
      delete_base_version: payload.delete_base_version,
      lease: publicWarehouseDeleteLease(row),
    };
  }
  row = { ...row, status: 'released', updated_at: releasedAt };
  return {
    ok: true,
    released: true,
    status: 'released',
    idempotent: false,
    company_id: payload.company_id,
    warehouse_id: payload.warehouse_id,
    warehouse_code: payload.warehouse_code,
    delete_command_id: payload.delete_command_id,
    delete_base_version: payload.delete_base_version,
    lease: publicWarehouseDeleteLease(row),
  };
}
async function listDevices(env, request) {
  const auth = await authenticate(env, request);
  if (!hasPermission(auth, 'devices.manage')) throw new ApiError(403, 'ACCESS_BLOCKED');
  const result = await env.DB.prepare(`
    SELECT d.id,d.user_id,d.device_name,d.status,d.created_at,d.last_seen_at,u.full_name,u.login
    FROM devices d JOIN users u ON u.id=d.user_id WHERE d.company_id=?
    ORDER BY d.last_seen_at DESC
  `).bind(auth.company_id).all();
  return { ok: true, devices: result.results };
}
async function setDeviceStatus(env, request, deviceId, data, requestId) {
  const auth = await authenticate(env, request);
  if (!hasPermission(auth, 'devices.manage')) throw new ApiError(403, 'ACCESS_BLOCKED');
  const status = clean(data.status);
  if (!['active', 'blocked'].includes(status)) throw new ApiError(400, 'INVALID_STATUS');
  if (deviceId === auth.device_id && status === 'blocked') throw new ApiError(409, 'CANNOT_BLOCK_SELF');
  const result = await env.DB.prepare('UPDATE devices SET status=? WHERE id=? AND company_id=?')
    .bind(status, deviceId, auth.company_id).run();
  if (!result.meta?.changes) throw new ApiError(404, 'DEVICE_NOT_FOUND');
  if (status === 'blocked') {
    await env.DB.prepare('UPDATE sessions SET status=\'revoked\' WHERE device_id=?').bind(deviceId).run();
  }
  await audit(env, requestId, 'device.status', auth.company_id, auth.id, deviceId);
  return { ok: true, device_id: deviceId, status };
}
async function introspect(env, request) {
  const auth = await authenticate(env, request);
  return {
    ok: true,
    active: true,
    auth_context_version: 2,
    user_id: auth.id,
    company_id: auth.company_id,
    role: auth.role,
    permissions: auth.permissions,
    user: {
      id: auth.id,
      login: auth.login,
      full_name: auth.full_name,
      role: auth.role,
      permissions: auth.permissions,
    },
    company: auth.company,
    device_id: auth.device_id,
  };
}
async function setCompanyDataService(env, request, data, requestId) {
  const auth = await authenticate(env, request);
  if (auth.role !== 'owner' && !hasPermission(auth, 'integrations.manage') && !hasPermission(auth, 'company.update')) throw new ApiError(403, 'ACCESS_BLOCKED');
  const address = clean(data.address);
  const port = Number(data.api_port) || 443;
  const fingerprint = normalizeCode(data.tls_sha256).replace(/[^A-F0-9]/g, '');
  const attestationSecret = typeof data.attestation_secret === 'string' ? data.attestation_secret : '';
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(address) && !/^[A-Fa-f0-9:]{2,80}$/.test(address)) {
    throw new ApiError(400, 'REQUIRED_FIELDS_MISSING');
  }
  if (
    !Number.isInteger(port)
    || port < 1
    || port > 65535
    || !/^[A-F0-9]{64}$/.test(fingerprint)
    || !/^jfvps_[A-Za-z0-9_-]{43,120}$/.test(attestationSecret)
  ) {
    throw new ApiError(400, 'REQUIRED_FIELDS_MISSING');
  }
  const updatedAt = nowIso();
  const attestationSecretCiphertext = await encryptIntegrationSecret(
    env,
    auth.company_id,
    attestationSecret,
    INTEGRATION_SECRET_CONTEXTS.dataApiAttestation,
  );
  await env.DB.prepare(`
    UPDATE companies
    SET data_api_address=?,data_api_port=?,data_api_tls_sha256=?,
        data_api_attestation_secret_ciphertext=?,data_api_updated_at=?
    WHERE id=?
  `).bind(
    address,
    port,
    fingerprint,
    attestationSecretCiphertext,
    updatedAt,
    auth.company_id,
  ).run();
  await audit(env, requestId, 'company.data-service', auth.company_id, auth.id, auth.company_id);
  return {
    ok: true,
    company: {
      ...auth.company,
      data_service: { address, api_port: port, tls_sha256: fingerprint, updated_at: updatedAt },
    },
  };
}
async function telegramUpstreamFetch(baseUrl, clientApiKey, method, requestPath, payload = null) {
  let response;
  try {
    response = await fetch(`${baseUrl}${requestPath}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${clientApiKey}`,
        ...(payload === null ? {} : { 'content-type': 'application/json; charset=utf-8' }),
      },
      body: payload === null ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError(502, 'TELEGRAM_UPSTREAM_UNAVAILABLE');
  }
  const text = await response.text();
  if (encoder.encode(text).length > MAX_UPSTREAM_BYTES) throw new ApiError(502, 'TELEGRAM_UPSTREAM_INVALID');
  let result;
  try { result = text ? JSON.parse(text) : {}; }
  catch { throw new ApiError(502, 'TELEGRAM_UPSTREAM_INVALID'); }
  if (!response.ok || result?.ok === false) {
    if (response.status === 401 || response.status === 403) throw new ApiError(502, 'TELEGRAM_CONFIGURATION_REQUIRED');
    throw new ApiError(502, 'TELEGRAM_UPSTREAM_ERROR');
  }
  return result;
}
async function companyTelegramConfig(env, companyId) {
  const row = await env.DB.prepare(`
    SELECT telegram_worker_url,telegram_client_key_ciphertext,telegram_bot_username,
           telegram_installation_id,telegram_deployment_version,telegram_updated_at
    FROM companies WHERE id=?
  `).bind(companyId).first();
  if (!row?.telegram_worker_url || !row?.telegram_client_key_ciphertext) {
    throw new ApiError(409, 'TELEGRAM_NOT_CONFIGURED');
  }
  return {
    ...row,
    client_api_key: await decryptIntegrationSecret(env, companyId, row.telegram_client_key_ciphertext),
  };
}
async function companyTelegramRequest(env, auth, method, requestPath, payload = null) {
  const config = await companyTelegramConfig(env, auth.company_id);
  return telegramUpstreamFetch(config.telegram_worker_url, config.client_api_key, method, requestPath, payload);
}
async function setCompanyTelegramService(env, request, data, requestId) {
  const auth = await authenticate(env, request);
  if (auth.role !== 'owner' && !hasPermission(auth, 'integrations.manage') && !hasPermission(auth, 'company.update')) throw new ApiError(403, 'ACCESS_BLOCKED');
  const baseUrl = validateTelegramWorkerUrl(data.base_url);
  const clientApiKey = clean(data.client_api_key);
  if (!/^[A-Za-z0-9_-]{40,160}$/.test(clientApiKey)) throw new ApiError(400, 'TELEGRAM_SERVICE_INVALID');
  const status = await telegramUpstreamFetch(baseUrl, clientApiKey, 'GET', '/v1/status');
  const reportedBot = clean(status?.bot?.username).replace(/^@/, '').slice(0, 80);
  const requestedBot = clean(data.bot_username).replace(/^@/, '').slice(0, 80);
  if (requestedBot && reportedBot && requestedBot.toLowerCase() !== reportedBot.toLowerCase()) {
    throw new ApiError(409, 'TELEGRAM_BOT_MISMATCH');
  }
  const installationId = clean(data.installation_id).slice(0, 120);
  const deploymentVersion = clean(data.deployment_version).slice(0, 80);
  const updatedAt = nowIso();
  const ciphertext = await encryptIntegrationSecret(env, auth.company_id, clientApiKey);
  await env.DB.prepare(`
    UPDATE companies
    SET telegram_worker_url=?,telegram_client_key_ciphertext=?,telegram_bot_username=?,
        telegram_installation_id=?,telegram_deployment_version=?,telegram_updated_at=?
    WHERE id=?
  `).bind(
    baseUrl,
    ciphertext,
    reportedBot || requestedBot,
    installationId,
    deploymentVersion,
    updatedAt,
    auth.company_id,
  ).run();
  await audit(env, requestId, 'company.telegram-service', auth.company_id, auth.id, auth.company_id);
  return {
    ok: true,
    company: {
      ...auth.company,
      telegram_service: {
        base_url: baseUrl,
        bot_username: reportedBot || requestedBot,
        installation_id: installationId,
        deployment_version: deploymentVersion,
        updated_at: updatedAt,
      },
    },
  };
}
async function telegramStatus(env, request) {
  const auth = await authenticate(env, request);
  const config = await companyTelegramConfig(env, auth.company_id);
  const status = await telegramUpstreamFetch(config.telegram_worker_url, config.client_api_key, 'GET', '/v1/status');
  return { ...status, service: publicTelegramService(config) };
}
async function telegramLinkCode(env, request, data) {
  const auth = await authenticate(env, request);
  const warehouseId = validateWarehouseId(data.warehouse_id);
  const environment = validateEnvironment(data.environment);
  requireWarehouseAccess(auth, warehouseId);
  const entityType = clean(data.entity_type);
  const entityId = clean(data.entity_id);
  const label = clean(data.label).slice(0, 120);
  if (!['driver', 'warehouse'].includes(entityType) || !/^[A-Za-z0-9_-]{1,120}$/.test(entityId)) {
    throw new ApiError(400, 'TELEGRAM_REQUEST_INVALID');
  }
  return companyTelegramRequest(env, auth, 'POST', '/v1/link-code', {
    warehouse_id: `${environment}--${warehouseId}`,
    entity_type: entityType,
    entity_id: entityId,
    label,
    ttl_minutes: 20,
  });
}
async function telegramSend(env, request, data) {
  const auth = await authenticate(env, request);
  const warehouseId = validateWarehouseId(data.warehouse_id);
  const environment = validateEnvironment(data.environment);
  requireWarehouseAccess(auth, warehouseId);
  const entityType = clean(data.entity_type);
  const entityId = clean(data.entity_id);
  const idempotencyKey = clean(data.idempotency_key);
  const text = clean(data.text);
  if (
    !['driver', 'warehouse'].includes(entityType)
    || !/^[A-Za-z0-9_-]{1,120}$/.test(entityId)
    || !/^[A-Za-z0-9:._-]{10,160}$/.test(idempotencyKey)
    || !text
    || text.length > 3500
  ) {
    throw new ApiError(400, 'TELEGRAM_REQUEST_INVALID');
  }
  return companyTelegramRequest(env, auth, 'POST', '/v1/send', {
    warehouse_id: `${environment}--${warehouseId}`,
    entity_type: entityType,
    entity_id: entityId,
    actor: entityType,
    route_id: clean(data.route_id).slice(0, 160),
    idempotency_key: `${environment}:${idempotencyKey}`,
    title: clean(data.title).slice(0, 300),
    metadata: data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata) ? data.metadata : {},
    text,
    status_buttons: data.status_buttons !== false,
  });
}
async function telegramBindings(env, request, url) {
  const auth = await authenticate(env, request);
  const warehouseId = validateWarehouseId(url.searchParams.get('warehouse_id'));
  const environment = validateEnvironment(url.searchParams.get('environment'));
  requireWarehouseAccess(auth, warehouseId);
  return companyTelegramRequest(
    env,
    auth,
    'GET',
    `/v1/bindings?warehouse_id=${encodeURIComponent(`${environment}--${warehouseId}`)}`,
  );
}
async function telegramEvents(env, request, url) {
  const auth = await authenticate(env, request);
  const warehouseId = validateWarehouseId(url.searchParams.get('warehouse_id'));
  const environment = validateEnvironment(url.searchParams.get('environment'));
  requireWarehouseAccess(auth, warehouseId);
  const afterId = Math.max(0, Math.floor(Number(url.searchParams.get('after_id')) || 0));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(url.searchParams.get('limit')) || 100)));
  return companyTelegramRequest(
    env,
    auth,
    'GET',
    `/v1/events?warehouse_id=${encodeURIComponent(`${environment}--${warehouseId}`)}&after_id=${afterId}&limit=${limit}`,
  );
}
async function demoStart(env, request, data) {
  await rateLimit(env, request, 'demo', 60, 3600);
  const device = clean(data.device_id);
  if (!device) throw new ApiError(400, 'REQUIRED_FIELDS_MISSING');
  const hash = await sha256(device);
  let row = await env.DB.prepare('SELECT * FROM demo_devices WHERE device_hash=?').bind(hash).first();
  if (!row) {
    const started = nowIso();
    const expiresAt = new Date(Date.now() + DEMO_SECONDS * 1000).toISOString();
    await env.DB.prepare('INSERT INTO demo_devices(device_hash,first_started_at,expires_at,last_seen_at) VALUES(?,?,?,?)')
      .bind(hash, started, expiresAt, started).run();
    row = { first_started_at: started, expires_at: expiresAt };
  } else {
    await env.DB.prepare('UPDATE demo_devices SET last_seen_at=? WHERE device_hash=?').bind(nowIso(), hash).run();
  }
  if (Date.parse(row.expires_at) <= Date.now()) throw new ApiError(403, 'DEMO_EXPIRED');
  return { ok: true, first_started_at: row.first_started_at, expires_at: row.expires_at, server_time: nowIso() };
}
function newLicenseKey() {
  const compact = randomToken(18).toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(20, 'X').slice(0, 20);
  return `JF-${compact.match(/.{1,4}/g).join('-')}`;
}
async function adminCreateLicense(env, request, data, requestId) {
  const authorization = clean(request.headers.get('authorization'));
  if (!clean(env.ADMIN_TOKEN) || !timingEqual(authorization, `Bearer ${env.ADMIN_TOKEN}`)) throw new ApiError(403, 'ACCESS_BLOCKED');
  const companyName = validateFullName(data.company_name);
  const companyCode = normalizeCode(data.company_code || `JF${randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)}`);
  if (!/^JF[A-Z0-9]{6,12}$/.test(companyCode)) throw new ApiError(400, 'REQUIRED_FIELDS_MISSING');
  const licenseKey = newLicenseKey();
  const companyId = id('cmp');
  const licenseId = id('lic');
  const createdAt = nowIso();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO companies(id,code,name,status,created_at) VALUES(?,?,?,\'active\',?)')
      .bind(companyId, companyCode, companyName, createdAt),
    env.DB.prepare(`
      INSERT INTO licenses(id,key_hash,company_id,status,max_employees,max_devices_per_user,created_at)
      VALUES(?,?,?,\'active\',?,?,?)
    `).bind(
      licenseId,
      await sha256(licenseKey),
      companyId,
      Math.max(1, Math.min(1000, Number(data.max_employees) || 25)),
      Math.max(1, Math.min(100, Number(data.max_devices_per_user) || 3)),
      createdAt,
    ),
  ]);
  await audit(env, requestId, 'license.create', companyId, null, licenseId);
  return { ok: true, license_key: licenseKey, company: { id: companyId, code: companyCode, name: companyName } };
}
async function route(env, request, requestId) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (method === 'GET' && (path === '/health' || path === '/v1/health')) {
    return {
      ok: true,
      service: 'justfun-license-api',
      version: '7.8.3',
      auth_contract: 4,
      warehouse_delete_lease_contract: 3,
    };
  }
  const data = method === 'GET' ? {} : await body(request);
  if (method === 'POST' && path === '/v1/license/check') return licenseCheck(env, request, data);
  if (method === 'POST' && path === '/v1/owner/register') return registerOwner(env, request, data, requestId);
  if (method === 'POST' && path === '/v1/auth/login') return login(env, request, data, requestId);
  if (method === 'POST' && path === '/v1/auth/refresh') return refresh(env, request, data);
  if (method === 'POST' && path === '/v1/auth/introspect') return introspect(env, request);
  if (method === 'POST' && path === '/v1/invitations/accept') return acceptInvitation(env, request, data, requestId);
  if (method === 'POST' && path === '/v1/demo/start') return demoStart(env, request, data);
  if (method === 'GET' && path === '/v1/users') return listUsers(env, request);
  if (method === 'POST' && path === '/v1/users/invite') return createInvitation(env, request, data, requestId);
  if (method === 'POST' && path === '/v1/warehouse-delete-leases/acquire') {
    return acquireWarehouseDeleteLease(env, request, data, requestId);
  }
  if (method === 'POST' && path === '/v1/warehouse-delete-leases/prepare') {
    return prepareWarehouseDeleteLease(env, request, data, requestId);
  }
  if (method === 'POST' && path === '/v1/warehouse-delete-leases/verify') {
    return verifyWarehouseDeleteLease(env, request, data, requestId);
  }
  if (method === 'POST' && path === '/v1/warehouse-delete-leases/release') {
    return releaseWarehouseDeleteLease(env, request, data, requestId);
  }
  if (method === 'POST' && path === '/v1/vps-attestations/verify') {
    return verifyVpsAttestation(env, request, data, requestId);
  }
  if (method === 'POST' && path === '/v1/vps-attestations/release-warehouse-delete') {
    return releaseWarehouseDeleteLeaseByVpsAttestation(env, request, data, requestId);
  }
  let match = path.match(/^\/v1\/users\/([^/]+)\/status$/);
  if (method === 'PATCH' && match) return setUserStatus(env, request, decodeURIComponent(match[1]), data, requestId);
  match = path.match(/^\/v1\/users\/([^/]+)\/access$/);
  if (method === 'PATCH' && match) return setUserAccess(env, request, decodeURIComponent(match[1]), data, requestId);
  if (method === 'GET' && path === '/v1/devices') return listDevices(env, request);
  match = path.match(/^\/v1\/devices\/([^/]+)\/status$/);
  if (method === 'PATCH' && match) return setDeviceStatus(env, request, decodeURIComponent(match[1]), data, requestId);
  if (method === 'PUT' && path === '/v1/company/data-service') return setCompanyDataService(env, request, data, requestId);
  if (method === 'PUT' && path === '/v1/company/telegram-service') return setCompanyTelegramService(env, request, data, requestId);
  if (method === 'GET' && path === '/v1/company/telegram/status') return telegramStatus(env, request);
  if (method === 'POST' && path === '/v1/company/telegram/link-code') return telegramLinkCode(env, request, data);
  if (method === 'POST' && path === '/v1/company/telegram/send') return telegramSend(env, request, data);
  if (method === 'GET' && path === '/v1/company/telegram/bindings') return telegramBindings(env, request, url);
  if (method === 'GET' && path === '/v1/company/telegram/events') return telegramEvents(env, request, url);
  if (method === 'POST' && path === '/v1/admin/licenses') return adminCreateLicense(env, request, data, requestId);
  throw new ApiError(404, 'NOT_FOUND');
}

export default {
  async fetch(request, env) {
    const requestId = crypto.randomUUID();
    if (!env.DB) return json({ ok: false, error: 'SERVER_CONFIGURATION_ERROR' }, 500, requestId);
    try {
      if (!['GET', 'POST', 'PATCH', 'PUT'].includes(request.method.toUpperCase())) throw new ApiError(405, 'METHOD_NOT_ALLOWED');
      return json(await route(env, request, requestId), 200, requestId);
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ ok: false, error: error.code, ...(error.details || {}) }, error.status, requestId);
      }
      console.error(JSON.stringify({ request_id: requestId, error: String(error?.stack || error) }));
      return json({ ok: false, error: 'INTERNAL_ERROR' }, 500, requestId);
    }
  },
};

export const _internals = {
  normalizeKey,
  normalizeLogin,
  validatePassword,
  timingEqual,
  hashPassword,
  verifyPassword,
  sha256,
  sha256Hex,
  signJwt,
  verifyJwt,
  newLicenseKey,
  safePermissions,
  expandLegacyPermissions,
  permissionsForRole,
  validateRoleName,
  permissionCoveredBy,
  permissionsGrantableBy,
  permissionsFromRow,
  canAccessWarehouse,
  validateWarehouseCode,
  normalizeWarehouseDeleteTarget,
  normalizeVpsAttestationPayload,
  vpsAttestationSignatureHeaders,
  buildVpsAttestationCanonicalString,
  verifyVpsAttestationRequest,
  publicWarehouseDeleteLease,
  warehouseDeleteLeaseResponse,
  timingSafeHashEqual,
  warehouseDeleteLeaseTokenMatches,
  warehouseAssignmentSummary,
  validateTelegramWorkerUrl,
  encryptIntegrationSecret,
  decryptIntegrationSecret,
  INTEGRATION_SECRET_CONTEXTS,
  publicCompany,
  issueTokenSet,
  rateLimit,
  demoStart,
};
