const SERVICE = 'justfun-update-catalog';
const VERSION = '1.0.0';
const CHANNELS = new Set(['internal', 'staging', 'stable']);
const DEFAULT_MAX_CATALOG_BYTES = 262_144;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function responseHeaders(extra = {}) {
  return {
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'cross-origin-resource-policy': 'cross-origin',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...extra,
  };
}

function json(value, status, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders({
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
    }),
  });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function boundedMaximum(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1_024 && parsed <= 1_048_576
    ? parsed
    : DEFAULT_MAX_CATALOG_BYTES;
}

function validateStoredCatalog(value, expectedChannel) {
  if (!exactKeys(value, ['schema_version', 'product_id', 'channel', 'catalog_sequence', 'generated_at', 'expires_at', 'directive', 'release', 'signature'])) return false;
  if (value.schema_version !== 1 || value.product_id !== 'justfun-logistics' || value.channel !== expectedChannel) return false;
  if (!Number.isSafeInteger(value.catalog_sequence) || value.catalog_sequence < 1) return false;
  if (Number.isNaN(Date.parse(value.generated_at)) || Number.isNaN(Date.parse(value.expires_at))) return false;
  if (!exactKeys(value.signature, ['algorithm', 'key_id', 'value'])) return false;
  if (value.signature.algorithm !== 'Ed25519' || !/^[A-Za-z0-9._-]{1,80}$/.test(value.signature.key_id) || typeof value.signature.value !== 'string') return false;
  if (!exactKeys(value.directive, ['mode', 'withdrawn_build_ids', 'rollback_from_versions', 'message'])) return false;
  if (!['release', 'halt', 'rollback'].includes(value.directive.mode) || !Array.isArray(value.directive.withdrawn_build_ids) || !Array.isArray(value.directive.rollback_from_versions)) return false;
  if (!plainObject(value.release) || !Number.isInteger(value.release.rollout_percent) || value.release.rollout_percent < 0 || value.release.rollout_percent > 100) return false;
  if (typeof value.release.build_id !== 'string' || value.release.build_id.length < 1 || typeof value.release.version !== 'string' || typeof value.release.summary !== 'string' || value.release.summary.trim().length < 1 || value.release.summary.length > 500) return false;
  if (value.directive.mode === 'halt' && (value.release.rollout_percent !== 0 || !value.directive.withdrawn_build_ids.includes(value.release.build_id))) return false;
  return true;
}

async function digestHex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}

function requestChannel(url) {
  const match = /^\/v1\/catalog\/([^/]+)$/.exec(url.pathname);
  if (!match || url.search || url.hash) return null;
  let channel;
  try { channel = decodeURIComponent(match[1]); }
  catch { return null; }
  return CHANNELS.has(channel) ? channel : null;
}

async function catalogResponse(request, env, channel, requestId) {
  if (!env.UPDATE_CATALOGS || typeof env.UPDATE_CATALOGS.get !== 'function') {
    console.error(JSON.stringify({ service: SERVICE, request_id: requestId, event: 'binding_missing' }));
    return json({ ok: false, error: 'SERVICE_NOT_CONFIGURED', request_id: requestId }, 503);
  }
  const stored = await env.UPDATE_CATALOGS.get(`catalog:${channel}`, { type: 'arrayBuffer' });
  if (stored === null) return json({ ok: false, error: 'CATALOG_NOT_PUBLISHED', request_id: requestId }, 404);
  const bytes = stored instanceof ArrayBuffer ? new Uint8Array(stored) : new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength);
  if (bytes.byteLength < 2 || bytes.byteLength > boundedMaximum(env.MAX_CATALOG_BYTES)) {
    console.error(JSON.stringify({ service: SERVICE, request_id: requestId, event: 'catalog_size_rejected', channel, bytes: bytes.byteLength }));
    return json({ ok: false, error: 'CATALOG_INVALID', request_id: requestId }, 503);
  }
  let text;
  let catalog;
  try {
    text = decoder.decode(bytes);
    catalog = JSON.parse(text);
  } catch {
    console.error(JSON.stringify({ service: SERVICE, request_id: requestId, event: 'catalog_json_rejected', channel }));
    return json({ ok: false, error: 'CATALOG_INVALID', request_id: requestId }, 503);
  }
  if (!validateStoredCatalog(catalog, channel)) {
    console.error(JSON.stringify({ service: SERVICE, request_id: requestId, event: 'catalog_shape_rejected', channel }));
    return json({ ok: false, error: 'CATALOG_INVALID', request_id: requestId }, 503);
  }
  const digest = await digestHex(bytes);
  const etag = `"sha256-${digest}"`;
  const headers = responseHeaders({
    'cache-control': 'public, max-age=0, must-revalidate',
    'content-length': String(bytes.byteLength),
    'content-type': 'application/json; charset=utf-8',
    etag,
  });
  console.log(JSON.stringify({
    service: SERVICE,
    request_id: requestId,
    event: 'catalog_served',
    channel,
    catalog_sequence: catalog.catalog_sequence,
    build_id: catalog.release.build_id,
    digest,
  }));
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(bytes, { status: 200, headers });
}

async function route(request, env, requestId) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health' && !url.search) {
    return json({
      ok: true,
      service: SERVICE,
      version: VERSION,
      environment: String(env.DEPLOYMENT_ENVIRONMENT || 'unknown'),
      catalog_contract: 1,
      storage_consistency: 'eventual',
    }, 200);
  }
  const channel = requestChannel(url);
  if (channel && ['GET', 'HEAD'].includes(request.method)) return catalogResponse(request, env, channel, requestId);
  if (channel) return json({ ok: false, error: 'METHOD_NOT_ALLOWED', request_id: requestId }, 405, { allow: 'GET, HEAD' });
  return json({ ok: false, error: 'NOT_FOUND', request_id: requestId }, 404);
}

export const _internals = { boundedMaximum, digestHex, requestChannel, validateStoredCatalog };

export default {
  async fetch(request, env) {
    const requestId = crypto.randomUUID();
    try {
      return await route(request, env, requestId);
    } catch (error) {
      console.error(JSON.stringify({
        service: SERVICE,
        request_id: requestId,
        event: 'unhandled_error',
        error_name: String(error?.name || 'Error').slice(0, 80),
      }));
      return json({ ok: false, error: 'INTERNAL_ERROR', request_id: requestId }, 500);
    }
  },
};
