#!/usr/bin/env node

import assert from 'node:assert/strict';
import worker, { _internals } from '../source/update-catalog-service/worker.mjs';

let checks = 0;
function check(value, message) {
  checks += 1;
  assert.ok(value, message);
}

function catalog(channel = 'stable') {
  return {
    schema_version: 1,
    product_id: 'justfun-logistics',
    channel,
    catalog_sequence: 42,
    generated_at: '2026-08-22T00:00:00.000Z',
    expires_at: '2026-08-29T00:00:00.000Z',
    directive: { mode: 'release', withdrawn_build_ids: [], rollback_from_versions: [], message: null },
    release: {
      version: '8.0.0',
      build_id: 'jf-8.0.0-0123456789012345678901234567890123456789',
      rollout_percent: 5,
      summary: 'Тестовое обновление.',
    },
    signature: { algorithm: 'Ed25519', key_id: 'release-2026-01', value: 'A'.repeat(88) },
  };
}

function environment(values = {}) {
  const encoder = new TextEncoder();
  return {
    DEPLOYMENT_ENVIRONMENT: 'test',
    MAX_CATALOG_BYTES: '262144',
    UPDATE_CATALOGS: {
      async get(key, options) {
        assert.equal(options.type, 'arrayBuffer');
        if (!Object.hasOwn(values, key)) return null;
        return encoder.encode(values[key]).buffer;
      },
    },
  };
}

async function request(path, options = {}, env = environment()) {
  return worker.fetch(new Request(`https://updates.example.test${path}`, options), env);
}

check(_internals.boundedMaximum('1024') === 1024, 'minimum configured size is accepted');
check(_internals.boundedMaximum('1') === 262144, 'unsafe configured size falls back');
check(_internals.requestChannel(new URL('https://x/v1/catalog/stable')) === 'stable', 'stable route is accepted');
check(_internals.requestChannel(new URL('https://x/v1/catalog/other')) === null, 'unknown route is rejected');
check(_internals.requestChannel(new URL('https://x/v1/catalog/stable?token=x')) === null, 'query parameters are rejected');
check(_internals.validateStoredCatalog(catalog(), 'stable'), 'minimal stored catalog shape is accepted');
check(!_internals.validateStoredCatalog({ ...catalog(), extra: true }, 'stable'), 'unexpected root field is rejected');
check(!_internals.validateStoredCatalog(catalog('staging'), 'stable'), 'channel confusion is rejected');

{
  const response = await request('/health');
  const payload = await response.json();
  check(response.status === 200 && payload.ok === true, 'health is available');
  check(payload.storage_consistency === 'eventual', 'health discloses KV consistency model');
  check(response.headers.get('cache-control') === 'no-store', 'health is not cached');
}

{
  const response = await request('/v1/catalog/stable');
  check(response.status === 404, 'missing catalog is explicit');
  check((await response.json()).error === 'CATALOG_NOT_PUBLISHED', 'missing catalog has stable error code');
}

{
  const text = `${JSON.stringify(catalog())}\n`;
  const env = environment({ 'catalog:stable': text });
  const response = await request('/v1/catalog/stable', {}, env);
  check(response.status === 200, 'published catalog is served');
  check(await response.text() === text, 'catalog bytes are not rewritten');
  check(/^"sha256-[0-9a-f]{64}"$/.test(response.headers.get('etag') || ''), 'strong content hash ETag is emitted');
  check(response.headers.get('cache-control') === 'public, max-age=0, must-revalidate', 'catalog requires revalidation');
  const head = await request('/v1/catalog/stable', { method: 'HEAD' }, env);
  check(head.status === 200 && (await head.text()) === '', 'HEAD returns headers without a body');
  const conditional = await request('/v1/catalog/stable', { headers: { 'if-none-match': response.headers.get('etag') } }, env);
  check(conditional.status === 304, 'matching ETag returns not modified');
}

{
  const invalid = environment({ 'catalog:stable': '{"broken":true}' });
  const response = await request('/v1/catalog/stable', {}, invalid);
  check(response.status === 503 && (await response.json()).error === 'CATALOG_INVALID', 'invalid stored value fails closed');
}

{
  const oversized = environment({ 'catalog:stable': JSON.stringify(catalog()) + ' '.repeat(2048) });
  oversized.MAX_CATALOG_BYTES = '1024';
  const response = await request('/v1/catalog/stable', {}, oversized);
  check(response.status === 503, 'oversized stored value is rejected');
}

{
  const response = await request('/v1/catalog/stable', { method: 'POST' }, environment({ 'catalog:stable': JSON.stringify(catalog()) }));
  check(response.status === 405 && response.headers.get('allow') === 'GET, HEAD', 'catalog endpoint is read-only');
}

{
  const response = await request('/v1/catalog/stable?x=1', {}, environment({ 'catalog:stable': JSON.stringify(catalog()) }));
  check(response.status === 404, 'query-bearing catalog route is not accepted');
}

process.stdout.write(`Update catalog Worker unit: ${checks}/${checks} checks passed.\n`);
