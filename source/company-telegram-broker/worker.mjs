const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_BODY_BYTES = 64 * 1024;
const MAX_UPSTREAM_BYTES = 3 * 1024 * 1024;
const DEFAULT_LICENSE_API = 'https://justfun-license-api.l2maloy47rus.workers.dev';

class ApiError extends Error {
  constructor(status, code, message = code, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details && typeof details === 'object' ? details : null;
  }
}

const clean = value => String(value ?? '').trim();
const nowIso = () => new Date().toISOString();
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

function licenseApiOrigin(env) {
  let url;
  try { url = new URL(clean(env.LICENSE_API_ORIGIN) || DEFAULT_LICENSE_API); }
  catch { throw new ApiError(500, 'SERVER_CONFIGURATION_ERROR'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new ApiError(500, 'SERVER_CONFIGURATION_ERROR');
  }
  return url.origin;
}

async function introspectLicense(env, request, fetchImpl = null) {
  const authorization = clean(request.headers.get('authorization'));
  if (!authorization.startsWith('Bearer ')) throw new ApiError(401, 'INVALID_TOKEN');
  const authFetch = fetchImpl
    || (env.AUTH_SERVICE && typeof env.AUTH_SERVICE.fetch === 'function'
      ? env.AUTH_SERVICE.fetch.bind(env.AUTH_SERVICE)
      : fetch);
  let response;
  try {
    response = await authFetch(`${licenseApiOrigin(env)}/v1/auth/introspect`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization,
        'content-type': 'application/json; charset=utf-8',
        'user-agent': 'JustFunCompanyTelegramBroker/1',
      },
      body: '{}',
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new ApiError(503, 'AUTH_SERVICE_UNAVAILABLE');
  }
  const text = await response.text();
  if (encoder.encode(text).length > 512 * 1024) throw new ApiError(502, 'AUTH_SERVICE_INVALID');
  let result;
  try { result = text ? JSON.parse(text) : {}; }
  catch { throw new ApiError(502, 'AUTH_SERVICE_INVALID'); }
  if (!response.ok || result?.ok === false || result?.active !== true) {
    if ([401, 403].includes(response.status)) throw new ApiError(401, 'INVALID_TOKEN');
    throw new ApiError(502, 'AUTH_SERVICE_INVALID');
  }
  const companyId = clean(result.company_id || result.company?.id);
  const userId = clean(result.user_id || result.user?.id);
  const role = clean(result.role || result.user?.role);
  const permissions = [...new Set(
    (Array.isArray(result.permissions) ? result.permissions : result.user?.permissions || [])
      .map(clean)
      .filter(value => /^[A-Za-z0-9.*_:-]{1,120}$/.test(value)),
  )];
  if (
    !/^[A-Za-z0-9_-]{3,120}$/.test(companyId)
    || !/^[A-Za-z0-9_-]{3,120}$/.test(userId)
    || !/^[A-Za-z0-9_-]{2,40}$/.test(role)
  ) {
    throw new ApiError(502, 'AUTH_SERVICE_INVALID');
  }
  return {
    company_id: companyId,
    user_id: userId,
    role,
    permissions,
    company: result.company || { id: companyId },
    device_id: clean(result.device_id),
  };
}

function hasPermission(auth, permission) {
  return auth.role === 'owner' || auth.permissions.includes('*') || auth.permissions.includes(permission);
}

function canManageIntegrations(auth) {
  return hasPermission(auth, 'integrations.manage') || hasPermission(auth, 'company.update');
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

function validateEnvironment(value) {
  const environment = clean(value).toLowerCase();
  if (!['live', 'demo'].includes(environment)) throw new ApiError(400, 'ENVIRONMENT_REQUIRED');
  return environment;
}

async function integrationKey(env) {
  const secret = clean(env.INTEGRATION_SECRET);
  if (secret.length < 32) throw new ApiError(500, 'SERVER_CONFIGURATION_ERROR');
  const material = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`justfun-company-telegram-broker-v1:${secret}`),
  );
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptClientKey(env, companyId, value) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`telegram-client-key-v1:${companyId}`) },
    await integrationKey(env),
    encoder.encode(String(value)),
  );
  return `v1.${b64url(iv)}.${b64url(ciphertext)}`;
}

async function decryptClientKey(env, companyId, value) {
  const parts = clean(value).split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new ApiError(500, 'TELEGRAM_CONFIGURATION_REQUIRED');
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromB64url(parts[1]),
        additionalData: encoder.encode(`telegram-client-key-v1:${companyId}`),
      },
      await integrationKey(env),
      fromB64url(parts[2]),
    );
    return decoder.decode(plaintext);
  } catch {
    throw new ApiError(500, 'TELEGRAM_CONFIGURATION_REQUIRED');
  }
}

async function rateLimit(env, request, auth, group, limit = 300, windowSeconds = 900) {
  const address = clean(request.headers.get('cf-connecting-ip') || 'unknown').slice(0, 80);
  const bucket = `${auth.company_id}:${auth.user_id}:${group}:${address}`;
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds);
  const row = await env.DB.prepare(`
    INSERT INTO broker_rate_limits(bucket,window_start,hits) VALUES(?,?,1)
    ON CONFLICT(bucket) DO UPDATE SET
      window_start=CASE WHEN window_start=excluded.window_start THEN window_start ELSE excluded.window_start END,
      hits=CASE WHEN window_start=excluded.window_start THEN hits+1 ELSE 1 END
    RETURNING hits
  `).bind(bucket, windowStart).first();
  if (Number(row?.hits || 0) > limit) throw new ApiError(429, 'TOO_MANY_ATTEMPTS');
}

async function audit(env, requestId, auth, action, warehouseId = null) {
  await env.DB.prepare(`
    INSERT INTO broker_audit_log(request_id,company_id,user_id,action,warehouse_id,created_at)
    VALUES(?,?,?,?,?,?)
  `).bind(requestId, auth.company_id, auth.user_id, action, warehouseId, nowIso()).run();
}

function publicService(row) {
  if (!row?.telegram_worker_url) return null;
  return {
    base_url: row.telegram_worker_url,
    warehouse_id: row.warehouse_id || '*',
    bot_username: row.telegram_bot_username || '',
    installation_id: row.telegram_installation_id || '',
    deployment_version: row.telegram_deployment_version || '',
    updated_at: row.updated_at || null,
  };
}

async function boundedResponseText(response, maxBytes, errorCode) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(502, errorCode);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ApiError(502, errorCode);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function telegramUpstreamFetch(baseUrl, clientApiKey, method, requestPath, payload = null, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${requestPath}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${clientApiKey}`,
        ...(payload === null ? {} : { 'content-type': 'application/json; charset=utf-8' }),
      },
      body: payload === null ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new ApiError(502, 'TELEGRAM_UPSTREAM_UNAVAILABLE', undefined, {
      upstream_network_error: clean(error?.name || 'fetch_failed').slice(0, 80),
    });
  }
  const details = {
    upstream_status: Number(response.status) || 0,
    upstream_content_type: clean(response.headers.get('content-type')).slice(0, 120),
    upstream_cf_ray: clean(response.headers.get('cf-ray')).slice(0, 80),
  };
  const text = await boundedResponseText(response, MAX_UPSTREAM_BYTES, 'TELEGRAM_UPSTREAM_INVALID');
  if (response.status === 530 && /(?:error\s*(?:code)?[:\s]*)?1042\b/i.test(text)) {
    throw new ApiError(503, 'TELEGRAM_WORKER_ROUTING_BLOCKED', undefined, details);
  }
  let result;
  try { result = text ? JSON.parse(text) : {}; }
  catch { throw new ApiError(502, 'TELEGRAM_UPSTREAM_INVALID', undefined, details); }
  if (!response.ok || result?.ok === false) {
    details.upstream_code = clean(result?.code || result?.error || '').slice(0, 120);
    details.upstream_message = clean(result?.error || result?.message || '').slice(0, 500);
    if (response.status === 401 || response.status === 403) throw new ApiError(502, 'TELEGRAM_CONFIGURATION_REQUIRED', details.upstream_message || undefined, details);
    throw new ApiError(502, 'TELEGRAM_UPSTREAM_ERROR', undefined, details);
  }
  return result;
}

async function verifyTelegramWorkerEventually(baseUrl, clientApiKey) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await telegramUpstreamFetch(baseUrl, clientApiKey, 'GET', '/v1/status');
    } catch (error) {
      lastError = error;
      if (error?.code !== 'TELEGRAM_CONFIGURATION_REQUIRED' || attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError || new ApiError(502, 'TELEGRAM_CONFIGURATION_REQUIRED');
}

async function companyTelegramConfig(env, companyId, warehouseId) {
  const exactWarehouseId = validateWarehouseId(warehouseId);
  const row = await env.DB.prepare(`
    SELECT company_id,warehouse_id,telegram_worker_url,telegram_client_key_ciphertext,telegram_bot_username,
           telegram_installation_id,telegram_deployment_version,updated_at
    FROM company_telegram_services
    WHERE company_id=? AND warehouse_id=?
    LIMIT 1
  `).bind(companyId, exactWarehouseId).first();
  if (!row?.telegram_worker_url || !row?.telegram_client_key_ciphertext) {
    throw new ApiError(409, 'TELEGRAM_NOT_CONFIGURED');
  }
  return { ...row, client_api_key: await decryptClientKey(env, companyId, row.telegram_client_key_ciphertext) };
}

async function companyTelegramRequest(env, auth, warehouseId, method, requestPath, payload = null) {
  const config = await companyTelegramConfig(env, auth.company_id, warehouseId);
  return telegramUpstreamFetch(config.telegram_worker_url, config.client_api_key, method, requestPath, payload);
}

async function setCompanyTelegramService(env, request, data, requestId, auth) {
  if (!canManageIntegrations(auth)) throw new ApiError(403, 'ACCESS_BLOCKED');
  const baseUrl = validateTelegramWorkerUrl(data.base_url);
  const clientApiKey = clean(data.client_api_key);
  if (!/^[A-Za-z0-9_-]{40,160}$/.test(clientApiKey)) throw new ApiError(400, 'TELEGRAM_SERVICE_INVALID');
  const warehouseId = validateWarehouseId(data.warehouse_id);
  requireWarehouseAccess(auth, warehouseId);
  await rateLimit(env, request, auth, `configure:${warehouseId}`, 20, 3600);
  const status = await verifyTelegramWorkerEventually(baseUrl, clientApiKey);
  const reportedBot = clean(status?.bot?.username).replace(/^@/, '').slice(0, 80);
  const requestedBot = clean(data.bot_username).replace(/^@/, '').slice(0, 80);
  if (requestedBot && reportedBot && requestedBot.toLowerCase() !== reportedBot.toLowerCase()) {
    throw new ApiError(409, 'TELEGRAM_BOT_MISMATCH');
  }
  const installationId = clean(data.installation_id).slice(0, 120);
  const deploymentVersion = clean(data.deployment_version).slice(0, 80);
  const updatedAt = nowIso();
  const ciphertext = await encryptClientKey(env, auth.company_id, clientApiKey);
  await env.DB.prepare(`
    INSERT INTO company_telegram_services(
      company_id,warehouse_id,telegram_worker_url,telegram_client_key_ciphertext,telegram_bot_username,
      telegram_installation_id,telegram_deployment_version,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(company_id,warehouse_id) DO UPDATE SET
      telegram_worker_url=excluded.telegram_worker_url,
      telegram_client_key_ciphertext=excluded.telegram_client_key_ciphertext,
      telegram_bot_username=excluded.telegram_bot_username,
      telegram_installation_id=excluded.telegram_installation_id,
      telegram_deployment_version=excluded.telegram_deployment_version,
      updated_at=excluded.updated_at
  `).bind(
    auth.company_id,
    warehouseId,
    baseUrl,
    ciphertext,
    reportedBot || requestedBot,
    installationId,
    deploymentVersion,
    updatedAt,
  ).run();
  await audit(env, requestId, auth, 'telegram.configure', warehouseId);
  return {
    ok: true,
    service: {
      base_url: baseUrl,
      warehouse_id: warehouseId,
      bot_username: reportedBot || requestedBot,
      installation_id: installationId,
      deployment_version: deploymentVersion,
      updated_at: updatedAt,
    },
  };
}

async function telegramStatus(env, url, auth) {
  const warehouseId = validateWarehouseId(url.searchParams.get('warehouse_id'));
  requireWarehouseAccess(auth, warehouseId);
  const config = await companyTelegramConfig(env, auth.company_id, warehouseId);
  const status = await telegramUpstreamFetch(config.telegram_worker_url, config.client_api_key, 'GET', '/v1/status');
  return { ...status, service: publicService(config) };
}

async function telegramLinkCode(env, request, data, requestId, auth) {
  await rateLimit(env, request, auth, 'link', 120, 900);
  const warehouseId = validateWarehouseId(data.warehouse_id);
  const environment = validateEnvironment(data.environment);
  requireWarehouseAccess(auth, warehouseId);
  const entityType = clean(data.entity_type);
  const entityId = clean(data.entity_id);
  const label = clean(data.label).slice(0, 120);
  if (!['driver', 'warehouse'].includes(entityType) || !/^[A-Za-z0-9_-]{1,120}$/.test(entityId)) {
    throw new ApiError(400, 'TELEGRAM_REQUEST_INVALID');
  }
  const result = await companyTelegramRequest(env, auth, warehouseId, 'POST', '/v1/link-code', {
    warehouse_id: `${environment}--${warehouseId}`,
    entity_type: entityType,
    entity_id: entityId,
    label,
    ttl_minutes: 20,
  });
  await audit(env, requestId, auth, 'telegram.link-code', warehouseId);
  return result;
}

async function telegramSend(env, request, data, requestId, auth) {
  await rateLimit(env, request, auth, 'send', 600, 900);
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
  const result = await companyTelegramRequest(env, auth, warehouseId, 'POST', '/v1/send', {
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
  await audit(env, requestId, auth, 'telegram.send', warehouseId);
  return result;
}

async function telegramBindings(env, url, auth) {
  const warehouseId = validateWarehouseId(url.searchParams.get('warehouse_id'));
  const environment = validateEnvironment(url.searchParams.get('environment'));
  requireWarehouseAccess(auth, warehouseId);
  return companyTelegramRequest(
    env,
    auth,
    warehouseId,
    'GET',
    `/v1/bindings?warehouse_id=${encodeURIComponent(`${environment}--${warehouseId}`)}`,
  );
}

async function telegramEvents(env, url, auth) {
  const warehouseId = validateWarehouseId(url.searchParams.get('warehouse_id'));
  const environment = validateEnvironment(url.searchParams.get('environment'));
  requireWarehouseAccess(auth, warehouseId);
  const afterId = Math.max(0, Math.floor(Number(url.searchParams.get('after_id')) || 0));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(url.searchParams.get('limit')) || 100)));
  return companyTelegramRequest(
    env,
    auth,
    warehouseId,
    'GET',
    `/v1/events?warehouse_id=${encodeURIComponent(`${environment}--${warehouseId}`)}&after_id=${afterId}&limit=${limit}`,
  );
}

async function route(env, request, requestId) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname;
  if (method === 'GET' && path === '/health') {
    return {
      ok: true,
      service: 'justfun-company-telegram-broker',
      version: '1.0.2',
      broker_contract: 1,
      license_service: licenseApiOrigin(env),
      auth_transport: env.AUTH_SERVICE && typeof env.AUTH_SERVICE.fetch === 'function'
        ? 'service-binding'
        : 'public-https',
    };
  }
  if (!env.DB) throw new ApiError(500, 'SERVER_CONFIGURATION_ERROR');
  const auth = await introspectLicense(env, request);
  const data = ['POST', 'PUT', 'PATCH'].includes(method) ? await body(request) : {};
  if (method === 'PUT' && path === '/v1/company/telegram-service') {
    return setCompanyTelegramService(env, request, data, requestId, auth);
  }
  if (method === 'GET' && path === '/v1/company/telegram/status') return telegramStatus(env, url, auth);
  if (method === 'POST' && path === '/v1/company/telegram/link-code') {
    return telegramLinkCode(env, request, data, requestId, auth);
  }
  if (method === 'POST' && path === '/v1/company/telegram/send') {
    return telegramSend(env, request, data, requestId, auth);
  }
  if (method === 'GET' && path === '/v1/company/telegram/bindings') return telegramBindings(env, url, auth);
  if (method === 'GET' && path === '/v1/company/telegram/events') return telegramEvents(env, url, auth);
  throw new ApiError(404, 'NOT_FOUND');
}

export const _internals = {
  ApiError,
  canManageIntegrations,
  canAccessWarehouse,
  decryptClientKey,
  encryptClientKey,
  introspectLicense,
  companyTelegramConfig,
  publicService,
  telegramUpstreamFetch,
  validateEnvironment,
  validateTelegramWorkerUrl,
  validateWarehouseId,
};

export default {
  async fetch(request, env) {
    const requestId = crypto.randomUUID();
    try {
      return json(await route(env, request, requestId), 200, requestId);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
      const details = error instanceof ApiError ? error.details || null : null;
      const message = clean(details?.upstream_message || '').slice(0, 500);
      console.error(JSON.stringify({ request_id: requestId, status, code, ...(details || {}) }));
      return json({ ok: false, error: code, ...(message ? { message } : {}), ...(details ? { details } : {}) }, status, requestId);
    }
  },
};
