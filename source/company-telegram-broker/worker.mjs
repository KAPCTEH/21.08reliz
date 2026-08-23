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

async function verifyPreparedWarehouseDeleteLease(env, request, data, auth, fetchImpl = null) {
  const allowedFields = new Set([
    'warehouse_id',
    'warehouse_code',
    'warehouse_delete_lease_token',
    'delete_command_id',
    'delete_base_version',
  ]);
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowedFields.has(key))) {
    throw new ApiError(400, 'WAREHOUSE_DELETE_PROOF_INVALID');
  }
  const warehouseId = validateWarehouseId(data.warehouse_id);
  const warehouseCode = validateWarehouseCode(data.warehouse_code);
  const leaseToken = validateWarehouseDeleteLeaseToken(data.warehouse_delete_lease_token);
  const deleteCommandId = validateDeleteCommandId(data.delete_command_id);
  const deleteBaseVersion = validateDeleteBaseVersion(data.delete_base_version);
  const authorization = clean(request.headers.get('authorization'));
  if (!authorization.startsWith('Bearer ')) throw new ApiError(401, 'INVALID_TOKEN');
  const authFetch = fetchImpl
    || (env.AUTH_SERVICE && typeof env.AUTH_SERVICE.fetch === 'function'
      ? env.AUTH_SERVICE.fetch.bind(env.AUTH_SERVICE)
      : fetch);
  let response;
  try {
    response = await authFetch(`${licenseApiOrigin(env)}/v1/warehouse-delete-leases/verify`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization,
        'content-type': 'application/json; charset=utf-8',
        'user-agent': 'JustFunCompanyTelegramBroker/1',
      },
      body: JSON.stringify({ warehouse_id: warehouseId, warehouse_code: warehouseCode, lease_token: leaseToken }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new ApiError(503, 'WAREHOUSE_DELETE_LEASE_SERVICE_UNAVAILABLE');
  }
  const text = await response.text();
  if (encoder.encode(text).length > 512 * 1024) throw new ApiError(502, 'WAREHOUSE_DELETE_LEASE_SERVICE_INVALID');
  let result;
  try { result = text ? JSON.parse(text) : {}; }
  catch { throw new ApiError(502, 'WAREHOUSE_DELETE_LEASE_SERVICE_INVALID'); }
  if (!response.ok || result?.ok !== true) {
    const upstreamCode = clean(result?.error || result?.code).slice(0, 120);
    if ([401, 403].includes(response.status)) throw new ApiError(response.status, upstreamCode || 'ACCESS_BLOCKED');
    if (response.status === 409) throw new ApiError(409, upstreamCode || 'WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED');
    throw new ApiError(503, 'WAREHOUSE_DELETE_LEASE_SERVICE_INVALID');
  }
  const lease = result?.lease;
  if (
    result.active !== true
    || result.prepared !== true
    || clean(result.status) !== 'prepared'
    || result.remaining_seconds !== null
    || !lease
    || typeof lease !== 'object'
    || clean(lease.status) !== 'prepared'
    || lease.expires_at !== null
    || clean(lease.company_id) !== auth.company_id
    || clean(lease.actor_user_id) !== auth.user_id
    || clean(lease.warehouse_id) !== warehouseId
    || clean(lease.warehouse_code) !== warehouseCode
    || !/^[A-Za-z0-9_-]{3,160}$/.test(clean(lease.id))
  ) {
    throw new ApiError(409, 'WAREHOUSE_DELETE_LEASE_PREPARED_REQUIRED');
  }
  return {
    companyId: auth.company_id,
    warehouseId,
    warehouseCode,
    deleteCommandId,
    deleteBaseVersion,
    actorUserId: auth.user_id,
    leaseId: clean(lease.id),
  };
}

function requireVpsAttestationHeaders(request) {
  const timestamp = clean(request.headers.get('x-justfun-vps-timestamp'));
  const nonce = clean(request.headers.get('x-justfun-vps-nonce'));
  const signature = clean(request.headers.get('x-justfun-vps-signature'));
  if (!timestamp || !nonce || !signature) throw new ApiError(401, 'VPS_ATTESTATION_REQUIRED');
  if (
    !/^\d{10,12}$/.test(timestamp)
    || !/^[A-Za-z0-9_-]{16,120}$/.test(nonce)
    || !/^v1=[a-f0-9]{64}$/.test(signature)
  ) {
    throw new ApiError(401, 'VPS_ATTESTATION_INVALID');
  }
  return { timestamp, nonce, signature };
}

async function verifyVpsWarehouseDeleteAttestation(env, request, data, auth, fetchImpl = null) {
  const warehouseId = validateWarehouseId(data?.warehouse_id);
  const warehouseCode = validateWarehouseCode(data?.warehouse_code);
  const leaseToken = validateWarehouseDeleteLeaseToken(data?.warehouse_delete_lease_token);
  const deleteCommandId = validateDeleteCommandId(data?.delete_command_id);
  const deleteBaseVersion = validateDeleteBaseVersion(data?.delete_base_version);
  const attestation = requireVpsAttestationHeaders(request);
  const authorization = clean(request.headers.get('authorization'));
  if (!authorization.startsWith('Bearer ')) throw new ApiError(401, 'INVALID_TOKEN');
  const authFetch = fetchImpl
    || (env.AUTH_SERVICE && typeof env.AUTH_SERVICE.fetch === 'function'
      ? env.AUTH_SERVICE.fetch.bind(env.AUTH_SERVICE)
      : fetch);
  let response;
  try {
    response = await authFetch(`${licenseApiOrigin(env)}/v1/vps-attestations/verify`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization,
        'content-type': 'application/json; charset=utf-8',
        'user-agent': 'JustFunCompanyTelegramBroker/1',
        'x-justfun-vps-timestamp': attestation.timestamp,
        'x-justfun-vps-nonce': attestation.nonce,
        'x-justfun-vps-signature': attestation.signature,
      },
      body: JSON.stringify({
        company_id: auth.company_id,
        warehouse_id: warehouseId,
        warehouse_code: warehouseCode,
        delete_command_id: deleteCommandId,
        delete_base_version: deleteBaseVersion,
        lease_token: leaseToken,
      }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new ApiError(503, 'VPS_ATTESTATION_SERVICE_UNAVAILABLE');
  }
  const text = await response.text();
  if (encoder.encode(text).length > 512 * 1024) throw new ApiError(502, 'VPS_ATTESTATION_SERVICE_INVALID');
  let result;
  try { result = text ? JSON.parse(text) : {}; }
  catch { throw new ApiError(502, 'VPS_ATTESTATION_SERVICE_INVALID'); }
  if (!response.ok || result?.ok !== true || result?.verified !== true) {
    const upstreamCode = clean(result?.error || result?.code).slice(0, 120);
    if ([400, 401, 403].includes(response.status)) {
      throw new ApiError(response.status === 400 ? 400 : 401, upstreamCode || 'VPS_ATTESTATION_INVALID');
    }
    if (response.status === 409) {
      throw new ApiError(409, upstreamCode || 'WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED');
    }
    throw new ApiError(503, 'VPS_ATTESTATION_SERVICE_INVALID');
  }
  if (
    result.active !== true
    || result.prepared !== true
    || clean(result.status) !== 'prepared'
    || clean(result.company_id) !== auth.company_id
    || clean(result.warehouse_id) !== warehouseId
    || clean(result.warehouse_code) !== warehouseCode
    || clean(result.delete_command_id) !== deleteCommandId
    || !Number.isSafeInteger(result.delete_base_version)
    || result.delete_base_version !== deleteBaseVersion
  ) {
    throw new ApiError(409, 'VPS_ATTESTATION_SCOPE_MISMATCH');
  }
  return {
    companyId: auth.company_id,
    warehouseId,
    warehouseCode,
    deleteCommandId,
    deleteBaseVersion,
  };
}

function hasPermission(auth, permission) {
  return auth.role === 'owner' || auth.permissions.includes('*') || auth.permissions.includes(permission);
}

function canManageIntegrations(auth) {
  return hasPermission(auth, 'integrations.manage') || hasPermission(auth, 'company.update');
}

function canDeprovisionWarehouseTelegram(auth, warehouseId) {
  return auth.role === 'owner'
    || (
      hasPermission(auth, 'warehouses.manage')
      && (auth.permissions.includes('*') || auth.permissions.includes('jf.warehouse:*'))
    );
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

function validateWarehouseCode(value) {
  const warehouseCode = clean(value).toUpperCase();
  if (!/^[A-ZА-ЯЁ0-9]{1,3}$/u.test(warehouseCode)) throw new ApiError(400, 'WAREHOUSE_CODE_REQUIRED');
  return warehouseCode;
}

function validateWarehouseDeleteLeaseToken(value) {
  const leaseToken = clean(value);
  if (!/^jfdl_[A-Za-z0-9_-]{32,220}$/.test(leaseToken)) {
    throw new ApiError(409, 'WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED');
  }
  return leaseToken;
}

function validateDeleteCommandId(value) {
  const commandId = clean(value);
  if (!/^[A-Za-z0-9_.:-]{16,180}$/.test(commandId)) throw new ApiError(400, 'WAREHOUSE_DELETE_COMMAND_REQUIRED');
  return commandId;
}

function validateDeleteBaseVersion(value) {
  const baseVersion = Number(value);
  if (!Number.isSafeInteger(baseVersion) || baseVersion < 1) throw new ApiError(400, 'WAREHOUSE_DELETE_VERSION_REQUIRED');
  return baseVersion;
}

function validateInstallationId(value) {
  const installationId = clean(value);
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(installationId)) {
    throw new ApiError(502, 'TELEGRAM_DEPROVISION_CONFIRMATION_INVALID');
  }
  return installationId;
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

async function telegramDeprovisionOperation(env, companyId, warehouseId) {
  return env.DB.prepare(`
    SELECT company_id,warehouse_id,warehouse_code,delete_command_id,delete_base_version,
           actor_user_id,lease_id,operation_id,installation_id,status,attempt_count,
           last_error_code,created_at,updated_at,completed_at
    FROM company_telegram_deprovision_operations
    WHERE company_id=? AND warehouse_id=?
    LIMIT 1
  `).bind(companyId, warehouseId).first();
}

function publicTelegramDeprovision(operation, alreadyDeprovisioned) {
  const installationId = clean(operation.installation_id);
  if (!installationId && clean(operation.status) !== 'deprovisioned') {
    throw new ApiError(502, 'TELEGRAM_DEPROVISION_CONFIRMATION_INVALID');
  }
  return {
    ok: true,
    warehouse_id: String(operation.warehouse_id),
    warehouse_code: validateWarehouseCode(operation.warehouse_code),
    delete_command_id: validateDeleteCommandId(operation.delete_command_id),
    delete_base_version: validateDeleteBaseVersion(operation.delete_base_version),
    installation_id: installationId ? validateInstallationId(installationId) : '',
    deprovisioned: true,
    already_deprovisioned: alreadyDeprovisioned === true,
  };
}

function telegramDeprovisionOperationMatches(operation, proof) {
  return Boolean(operation)
    && clean(operation.company_id) === clean(proof.companyId)
    && clean(operation.warehouse_id) === proof.warehouseId
    && clean(operation.warehouse_code) === proof.warehouseCode
    && clean(operation.delete_command_id) === proof.deleteCommandId
    && Number(operation.delete_base_version) === proof.deleteBaseVersion;
}

function telegramDeprovisionBlocked(operation) {
  if (!operation) return;
  throw new ApiError(
    operation.status === 'deprovisioned' ? 410 : 409,
    operation.status === 'deprovisioned'
      ? 'TELEGRAM_SERVICE_DEPROVISIONED'
      : 'TELEGRAM_SERVICE_DEPROVISIONING',
  );
}

async function companyTelegramConfig(env, companyId, warehouseId) {
  const exactWarehouseId = validateWarehouseId(warehouseId);
  const row = await env.DB.prepare(`
    SELECT service.company_id,service.warehouse_id,service.telegram_worker_url,
           service.telegram_client_key_ciphertext,service.telegram_bot_username,
           service.telegram_installation_id,service.telegram_deployment_version,service.updated_at,
           operation.status AS deprovision_status
    FROM company_telegram_services AS service
    LEFT JOIN company_telegram_deprovision_operations AS operation
      ON operation.company_id=service.company_id AND operation.warehouse_id=service.warehouse_id
    WHERE service.company_id=? AND service.warehouse_id=?
    LIMIT 1
  `).bind(companyId, exactWarehouseId).first();
  if (row?.deprovision_status) telegramDeprovisionBlocked({ status: row.deprovision_status });
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
  telegramDeprovisionBlocked(await telegramDeprovisionOperation(env, auth.company_id, warehouseId));
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
  try {
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
  } catch (error) {
    if (String(error).includes('TELEGRAM_SERVICE_DEPROVISIONED')) {
      const operation = await telegramDeprovisionOperation(env, auth.company_id, warehouseId);
      telegramDeprovisionBlocked(operation || { status: 'running' });
    }
    throw error;
  }
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

async function claimTelegramDeprovisionOperation(env, proof) {
  const timestamp = nowIso();
  const operationId = `tgdep_${crypto.randomUUID()}`;
  const claimed = await env.DB.prepare(`
    INSERT INTO company_telegram_deprovision_operations(
      company_id,warehouse_id,warehouse_code,delete_command_id,delete_base_version,
      actor_user_id,lease_id,operation_id,installation_id,status,attempt_count,
      last_error_code,created_at,updated_at,completed_at
    )
    SELECT service.company_id,service.warehouse_id,?,?,?,?,?,?,service.telegram_installation_id,
           'running',1,'',?,?,NULL
    FROM company_telegram_services AS service
    WHERE service.company_id=? AND service.warehouse_id=?
    ON CONFLICT(company_id,warehouse_id) DO UPDATE SET
      status='running',attempt_count=company_telegram_deprovision_operations.attempt_count+1,
      last_error_code='',updated_at=excluded.updated_at,completed_at=NULL
    WHERE company_telegram_deprovision_operations.status!='deprovisioned'
      AND company_telegram_deprovision_operations.warehouse_code=excluded.warehouse_code
      AND company_telegram_deprovision_operations.delete_command_id=excluded.delete_command_id
      AND company_telegram_deprovision_operations.delete_base_version=excluded.delete_base_version
    RETURNING company_id,warehouse_id,warehouse_code,delete_command_id,delete_base_version,
              actor_user_id,lease_id,operation_id,installation_id,status,attempt_count,
              last_error_code,created_at,updated_at,completed_at
  `).bind(
    proof.warehouseCode,
    proof.deleteCommandId,
    proof.deleteBaseVersion,
    proof.actorUserId,
    proof.leaseId,
    operationId,
    timestamp,
    timestamp,
    proof.companyId,
    proof.warehouseId,
  ).first();
  if (claimed) return claimed;
  return telegramDeprovisionOperation(env, proof.companyId, proof.warehouseId);
}

async function claimAbsentTelegramDeprovisionOperation(env, proof) {
  const timestamp = nowIso();
  const operationId = `tgdep_${crypto.randomUUID()}`;
  return env.DB.prepare(`
    INSERT INTO company_telegram_deprovision_operations(
      company_id,warehouse_id,warehouse_code,delete_command_id,delete_base_version,
      actor_user_id,lease_id,operation_id,installation_id,status,attempt_count,
      last_error_code,created_at,updated_at,completed_at
    )
    SELECT ?,?,?,?,?,?,?,?,'','deprovisioned',1,'',?,?,?
    WHERE NOT EXISTS (
      SELECT 1 FROM company_telegram_services AS service
      WHERE service.company_id=? AND service.warehouse_id=?
    )
    ON CONFLICT(company_id,warehouse_id) DO NOTHING
    RETURNING company_id,warehouse_id,warehouse_code,delete_command_id,delete_base_version,
              actor_user_id,lease_id,operation_id,installation_id,status,attempt_count,
              last_error_code,created_at,updated_at,completed_at
  `).bind(
    proof.companyId,
    proof.warehouseId,
    proof.warehouseCode,
    proof.deleteCommandId,
    proof.deleteBaseVersion,
    proof.actorUserId,
    proof.leaseId,
    operationId,
    timestamp,
    timestamp,
    timestamp,
    proof.companyId,
    proof.warehouseId,
  ).first();
}

async function companyTelegramConfigForDeprovision(env, companyId, warehouseId) {
  return env.DB.prepare(`
    SELECT company_id,warehouse_id,telegram_worker_url,telegram_client_key_ciphertext,
           telegram_installation_id
    FROM company_telegram_services
    WHERE company_id=? AND warehouse_id=?
    LIMIT 1
  `).bind(companyId, warehouseId).first();
}

async function recordTelegramDeprovisionFailure(env, companyId, warehouseId, error) {
  const code = clean(error?.code || 'TELEGRAM_DEPROVISION_FAILED')
    .replace(/[^A-Za-z0-9_.:-]/g, '_')
    .slice(0, 120);
  await env.DB.prepare(`
    UPDATE company_telegram_deprovision_operations
    SET status='failed',last_error_code=?,updated_at=?,completed_at=NULL
    WHERE company_id=? AND warehouse_id=? AND status!='deprovisioned'
  `).bind(code, nowIso(), companyId, warehouseId).run();
}

function validateNativeDeprovisionConfirmation(result, auth, warehouseId, expectedInstallationId = '') {
  const installationId = validateInstallationId(result?.installation_id);
  const expected = clean(expectedInstallationId);
  const scopedWarehouseIds = new Set([`live--${warehouseId}`, `demo--${warehouseId}`]);
  if (
    result?.ok !== true
    || result?.deprovisioned !== true
    || clean(result?.company_id) !== auth.company_id
    || !scopedWarehouseIds.has(clean(result?.warehouse_id))
    || (expected && installationId !== expected)
  ) {
    throw new ApiError(502, 'TELEGRAM_DEPROVISION_CONFIRMATION_INVALID');
  }
  return installationId;
}

async function deprovisionCompanyTelegramService(env, request, data, requestId, auth) {
  const warehouseId = validateWarehouseId(data.warehouse_id);
  if (!canDeprovisionWarehouseTelegram(auth, warehouseId)) throw new ApiError(403, 'ACCESS_BLOCKED');
  await verifyVpsWarehouseDeleteAttestation(env, request, data, auth);
  const proof = await verifyPreparedWarehouseDeleteLease(env, request, data, auth);
  await rateLimit(env, request, auth, `deprovision:${warehouseId}`, 20, 3600);

  const existing = await telegramDeprovisionOperation(env, auth.company_id, warehouseId);
  if (existing && !telegramDeprovisionOperationMatches(existing, proof)) {
    throw new ApiError(409, 'TELEGRAM_DEPROVISION_OPERATION_MISMATCH');
  }
  if (existing?.status === 'deprovisioned') return publicTelegramDeprovision(existing, true);
  if (!existing) {
    const absent = await claimAbsentTelegramDeprovisionOperation(env, proof);
    if (absent) {
      await audit(env, requestId, auth, 'telegram.deprovision-absent', warehouseId);
      return publicTelegramDeprovision(absent, true);
    }
    const concurrent = await telegramDeprovisionOperation(env, auth.company_id, warehouseId);
    if (concurrent && !telegramDeprovisionOperationMatches(concurrent, proof)) {
      throw new ApiError(409, 'TELEGRAM_DEPROVISION_OPERATION_MISMATCH');
    }
    if (concurrent?.status === 'deprovisioned') return publicTelegramDeprovision(concurrent, true);
  }

  const operation = await claimTelegramDeprovisionOperation(env, proof);
  if (operation && !telegramDeprovisionOperationMatches(operation, proof)) {
    throw new ApiError(409, 'TELEGRAM_DEPROVISION_OPERATION_MISMATCH');
  }
  if (operation?.status === 'deprovisioned') return publicTelegramDeprovision(operation, true);
  const config = await companyTelegramConfigForDeprovision(env, auth.company_id, warehouseId);
  if (!operation || !config?.telegram_worker_url || !config?.telegram_client_key_ciphertext) {
    const concurrent = await telegramDeprovisionOperation(env, auth.company_id, warehouseId);
    if (concurrent?.status === 'deprovisioned') return publicTelegramDeprovision(concurrent, true);
    throw new ApiError(409, 'TELEGRAM_DEPROVISION_RECONCILIATION_REQUIRED');
  }

  try {
    const clientApiKey = await decryptClientKey(env, auth.company_id, config.telegram_client_key_ciphertext);
    const result = await telegramUpstreamFetch(
      config.telegram_worker_url,
      clientApiKey,
      'POST',
      '/v1/deprovision',
      {},
    );
    const installationId = validateNativeDeprovisionConfirmation(
      result,
      auth,
      warehouseId,
      operation.installation_id || config.telegram_installation_id,
    );
    const completedAt = nowIso();
    const committed = await env.DB.prepare(`
      UPDATE company_telegram_deprovision_operations
      SET installation_id=?,status='deprovisioned',last_error_code='',
          updated_at=?,completed_at=?
      WHERE company_id=? AND warehouse_id=? AND status!='deprovisioned'
    `).bind(installationId, completedAt, completedAt, auth.company_id, warehouseId).run();
    if (Number(committed?.meta?.changes || 0) !== 1) {
      const concurrent = await telegramDeprovisionOperation(env, auth.company_id, warehouseId);
      if (concurrent?.status === 'deprovisioned') return publicTelegramDeprovision(concurrent, true);
      throw new ApiError(503, 'TELEGRAM_DEPROVISION_COMMIT_FAILED');
    }
    await audit(env, requestId, auth, 'telegram.deprovision', warehouseId);
    return publicTelegramDeprovision({ ...operation, status: 'deprovisioned', installation_id: installationId }, false);
  } catch (error) {
    await recordTelegramDeprovisionFailure(env, auth.company_id, warehouseId, error);
    throw error;
  }
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
      version: '1.3.0',
      broker_contract: 4,
      telegram_deprovision_contract: 3,
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
  if (method === 'POST' && path === '/v1/company/telegram-service/deprovision') {
    return deprovisionCompanyTelegramService(env, request, data, requestId, auth);
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
  canDeprovisionWarehouseTelegram,
  canManageIntegrations,
  canAccessWarehouse,
  decryptClientKey,
  encryptClientKey,
  introspectLicense,
  companyTelegramConfig,
  deprovisionCompanyTelegramService,
  publicService,
  telegramUpstreamFetch,
  validateNativeDeprovisionConfirmation,
  verifyPreparedWarehouseDeleteLease,
  verifyVpsWarehouseDeleteAttestation,
  validateEnvironment,
  validateTelegramWorkerUrl,
  validateWarehouseCode,
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
