import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { _internals } from '../source/company-telegram-broker/worker.mjs';

const secret = 'integration-secret-for-tests-0123456789abcdef';
const encrypted = await _internals.encryptClientKey({ INTEGRATION_SECRET: secret }, 'cmp_one', 'K'.repeat(48));
assert.match(encrypted, /^v1\./);
assert.equal(
  await _internals.decryptClientKey({ INTEGRATION_SECRET: secret }, 'cmp_one', encrypted),
  'K'.repeat(48),
);
await assert.rejects(
  _internals.decryptClientKey({ INTEGRATION_SECRET: secret }, 'cmp_other', encrypted),
  error => error.code === 'TELEGRAM_CONFIGURATION_REQUIRED',
);

await assert.rejects(
  _internals.telegramUpstreamFetch(
    'https://telegram-worker.test',
    'K'.repeat(48),
    'POST',
    '/v1/send',
    { text: 'test' },
    async () => new Response(JSON.stringify({
      ok: false,
      error: 'Telegram-группа склада ещё не подключена',
      code: 'chat_not_bound',
    }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }),
  ),
  error => error.code === 'TELEGRAM_UPSTREAM_ERROR'
    && error.details?.upstream_code === 'chat_not_bound'
    && error.details?.upstream_message === 'Telegram-группа склада ещё не подключена',
);

assert.equal(
  _internals.canAccessWarehouse({ role: 'viewer', permissions: ['jf.warehouse:wh_main'] }, 'wh_main'),
  true,
);
assert.equal(
  _internals.canAccessWarehouse({ role: 'viewer', permissions: ['jf.warehouse:wh_main'] }, 'wh_other'),
  false,
);
assert.equal(
  _internals.canAccessWarehouse({ role: 'owner', permissions: [] }, 'wh_other'),
  true,
);
assert.equal(_internals.canManageIntegrations({ role: 'manager', permissions: ['integrations.manage'] }), true);
assert.equal(_internals.canManageIntegrations({ role: 'manager', permissions: ['company.update'] }), true);
assert.equal(_internals.canManageIntegrations({ role: 'manager', permissions: ['users.read'] }), false);

const health = await worker.fetch(new Request('https://broker.test/health'), {
  LICENSE_API_ORIGIN: 'https://license.test',
});
assert.equal(health.status, 200);
const healthPayload = await health.json();
assert.equal(healthPayload.broker_contract, 1);
assert.equal(healthPayload.version, '1.0.2');

const upstreamOk = await _internals.telegramUpstreamFetch(
  'https://telegram-worker.test',
  'K'.repeat(48),
  'GET',
  '/v1/status',
  null,
  async () => new Response(JSON.stringify({ ok: true, bot: { username: 'test_bot' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }),
);
assert.equal(upstreamOk.bot.username, 'test_bot');

await assert.rejects(
  _internals.telegramUpstreamFetch(
    'https://telegram-worker.test',
    'K'.repeat(48),
    'GET',
    '/v1/status',
    null,
    async () => new Response('<html>Cloudflare error code: 1042</html>', {
      status: 530,
      headers: { 'content-type': 'text/html', 'cf-ray': 'test-ray' },
    }),
  ),
  error => error.code === 'TELEGRAM_WORKER_ROUTING_BLOCKED'
    && error.status === 503
    && error.details?.upstream_status === 530
    && error.details?.upstream_cf_ray === 'test-ray',
);

await assert.rejects(
  _internals.telegramUpstreamFetch(
    'https://telegram-worker.test',
    'K'.repeat(48),
    'GET',
    '/v1/status',
    null,
    async () => new Response('not-json', {
      status: 502,
      headers: { 'content-type': 'text/plain' },
    }),
  ),
  error => error.code === 'TELEGRAM_UPSTREAM_INVALID'
    && error.details?.upstream_status === 502
    && error.details?.upstream_content_type === 'text/plain',
);

for (const configName of ['wrangler.jsonc', 'wrangler.jsonc.example', 'wrangler.toml.example']) {
  const config = fs.readFileSync(new URL(`../source/company-telegram-broker/${configName}`, import.meta.url), 'utf8');
  assert.match(config, /global_fetch_strictly_public/);
  assert.match(config, /observability/);
}

let serviceBindingCalls = 0;
const serviceBindingAuth = await _internals.introspectLicense(
  new Proxy({
    LICENSE_API_ORIGIN: 'https://license.test',
    AUTH_SERVICE: {
      async fetch() {
        serviceBindingCalls += 1;
        return new Response(JSON.stringify({
          ok: true,
          active: true,
          user_id: 'usr_employee',
          company_id: 'cmp_company',
          role: 'manager',
          permissions: ['jf.warehouse:wh_main'],
          company: { id: 'cmp_company' },
          device_id: 'dev_test',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
  }, {
    get(target, property) {
      return target[property];
    },
  }),
  new Request('https://broker.test/v1/company/telegram/status', {
    headers: { authorization: 'Bearer service-binding-test-token' },
  }),
);
assert.equal(serviceBindingCalls, 1);
assert.equal(serviceBindingAuth.company_id, 'cmp_company');

const scopedConfigCalls = [];
const scopedConfigDb = {
  prepare(sql) {
    assert.match(sql, /warehouse_id=\?/);
    return {
      bind(...values) {
        scopedConfigCalls.push(values);
        return {
          async first() {
            return {
              company_id: values[0],
              warehouse_id: values[1],
              telegram_worker_url: 'https://warehouse.example.workers.dev',
              telegram_client_key_ciphertext: encrypted,
              telegram_bot_username: 'warehouse_bot',
            };
          },
        };
      },
    };
  },
};
const scopedConfig = await _internals.companyTelegramConfig(
  { DB: scopedConfigDb, INTEGRATION_SECRET: secret },
  'cmp_one',
  'wh_main',
);
assert.equal(scopedConfig.warehouse_id, 'wh_main');
assert.deepEqual(scopedConfigCalls, [['cmp_one', 'wh_main']]);
assert.equal(scopedConfig.client_api_key, 'K'.repeat(48));

const originalFetch = globalThis.fetch;
const database = {
  prepare(sql) {
    return {
      bind() {
        return {
          async first() {
            if (sql.includes('broker_rate_limits')) return { hits: 1 };
            return null;
          },
          async run() { return { meta: { changes: 1 } }; },
        };
      },
    };
  },
};
globalThis.fetch = async url => {
  if (String(url).includes('/v1/auth/introspect')) {
    return new Response(JSON.stringify({
      ok: true,
      active: true,
      user_id: 'usr_employee',
      company_id: 'cmp_company',
      role: 'viewer',
      permissions: ['jf.warehouse:wh_main'],
      company: { id: 'cmp_company' },
      device_id: 'dev_test',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`Unexpected fetch: ${url}`);
};
try {
  const denied = await worker.fetch(new Request(
    'https://broker.test/v1/company/telegram/events?warehouse_id=wh_other&environment=live',
    { headers: { authorization: 'Bearer valid-test-token' } },
  ), { DB: database, INTEGRATION_SECRET: secret, LICENSE_API_ORIGIN: 'https://license.test' });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, 'WAREHOUSE_ACCESS_DENIED');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Company Telegram broker unit tests: PASS');
