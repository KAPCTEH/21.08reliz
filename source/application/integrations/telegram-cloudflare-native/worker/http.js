export class HttpError extends Error {
  constructor(status, message, code = 'request_error', details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const BASE_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer'
});

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders }
  });
}

export function corsPreflight(request) {
  const requestedHeaders = request.headers.get('access-control-request-headers') || 'authorization, content-type';
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': requestedHeaders,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-max-age': '600',
      'vary': 'access-control-request-headers'
    }
  });
}

export function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function errorResponse(error) {
  if (error instanceof HttpError) {
    return json({ ok: false, error: error.message, code: error.code, details: error.details }, error.status);
  }
  console.error('Unhandled error', error instanceof Error ? error.message : String(error));
  return json({ ok: false, error: 'Внутренняя ошибка сервиса', code: 'internal_error' }, 500);
}

export async function readJson(request, maxBytes = 256 * 1024) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new HttpError(413, 'Слишком большой запрос', 'payload_too_large');
  }
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new HttpError(413, 'Слишком большой запрос', 'payload_too_large');
  if (!buffer.byteLength) return {};
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new HttpError(400, 'Некорректный JSON', 'invalid_json');
  }
}

export function requireString(value, field, { max = 500, allowEmpty = false } = {}) {
  const out = String(value ?? '').trim();
  if (!allowEmpty && !out) throw new HttpError(400, `Не заполнено поле ${field}`, 'validation_error', { field });
  if (out.length > max) throw new HttpError(400, `Поле ${field} слишком длинное`, 'validation_error', { field, max });
  return out;
}

export function requireWarehouseId(value) {
  const warehouseId = requireString(value, 'warehouse_id', { max: 120 });
  if (!/^[A-Za-z0-9А-Яа-яЁё._:-]{1,120}$/u.test(warehouseId)) {
    throw new HttpError(400, 'warehouse_id содержит недопустимые символы', 'validation_error', { field: 'warehouse_id' });
  }
  return warehouseId;
}

export function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export function routeParts(url) {
  return new URL(url).pathname.split('/').filter(Boolean);
}
