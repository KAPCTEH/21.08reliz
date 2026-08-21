import assert from 'node:assert/strict';
import worker, { _internals } from '../source/license-server/worker.mjs';

assert.equal(_internals.normalizeKey(' jf-abcd-1234 '), 'JF-ABCD-1234');
assert.equal(_internals.normalizeLogin('  Owner.Name  '), 'owner.name');
assert.equal(_internals.timingEqual('same', 'same'), true);
assert.equal(_internals.timingEqual('same', 'other'), false);

const password = 'НадёжныйПароль783';
const record = await _internals.hashPassword(password);
assert.equal(record.iterations, 100000);
assert.equal(await _internals.verifyPassword(password, {
  password_salt: record.salt,
  password_hash: record.hash,
  password_iterations: record.iterations,
}), true);
assert.equal(await _internals.verifyPassword('НеверныйПароль783', {
  password_salt: record.salt,
  password_hash: record.hash,
  password_iterations: record.iterations,
}), false);

const env = {
  JWT_SECRET: 'JustFun-test-secret-that-is-longer-than-thirty-two-characters',
  INTEGRATION_SECRET: 'JustFun-test-integration-secret-that-is-longer-than-thirty-two-characters',
};
const token = await _internals.signJwt(env, { typ: 'access', sub: 'usr_test', cid: 'cmp_test' }, 60);
const claims = await _internals.verifyJwt(env, token, 'access');
assert.equal(claims.sub, 'usr_test');
assert.equal(claims.cid, 'cmp_test');

const keys = new Set(Array.from({ length: 100 }, () => _internals.newLicenseKey()));
assert.equal(keys.size, 100);
for (const key of keys) assert.match(key, /^JF-(?:[A-Z0-9]{4}-){4}[A-Z0-9]{4}$/);

assert.deepEqual(
  _internals.safePermissions(['orders.read', 'jf.warehouse-code:MAIN-01', 'bad permission', 'orders.read']),
  ['orders.read', 'jf.warehouse-code:MAIN-01'],
);
assert.deepEqual(
  _internals.permissionsForRole('Кладовщик смены', ['*', 'company.update', 'orders.read', 'jf.warehouse:wh_main']),
  ['company.update', 'orders.read', 'jf.warehouse:wh_main'],
);
assert.deepEqual(
  _internals.permissionsForRole('Старший администратор', ['*', 'company.update', 'users.update', 'jf.warehouse:*']),
  ['company.update', 'users.update', 'jf.warehouse:*'],
);
assert.deepEqual(_internals.permissionsForRole('owner', []), ['*']);
assert.equal(_internals.validateRoleName('  Старший   логист  '), 'Старший логист');
assert.throws(() => _internals.validateRoleName('owner'), /INVALID_ROLE_NAME/);
assert.equal(
  _internals.permissionCoveredBy(['orders.*', 'jf.warehouse:*'], 'orders.update'),
  true,
);
assert.equal(_internals.permissionCoveredBy(['orders.read'], 'orders.update'), false);
assert.equal(_internals.permissionCoveredBy(['routes.update'], 'routes.start'), false);
assert.deepEqual(
  _internals.permissionsForRole('Старый логист', ['routes.update']),
  ['routes.update','routes.plan','routes.approve','routes.pick','routes.start','routes.return','routes.close','routes.cancel','routes.settings'],
);
assert.throws(() =>
  _internals.permissionsGrantableBy(
    { role: 'Администратор филиала', permissions: ['users.create', 'orders.read', 'jf.warehouse:wh_main'] },
    'Новая роль',
    ['company.update', 'users.update', 'orders.read', 'orders.update', 'jf.warehouse:wh_main', 'jf.warehouse:wh_other'],
  ),
  /CANNOT_GRANT_PERMISSION/,
);
assert.deepEqual(
  _internals.permissionsGrantableBy(
    { role: 'Администратор филиала', permissions: ['users.create', 'orders.read', 'jf.warehouse:wh_main'] },
    'Новая роль',
    ['orders.read', 'jf.warehouse:wh_main'],
  ),
  ['orders.read', 'jf.warehouse:wh_main'],
);
assert.throws(() =>
  _internals.permissionsGrantableBy(
    { role: 'Администратор филиала', permissions: ['users.create', 'users.update', 'jf.warehouse:wh_main'] },
    'Администратор всех складов',
    ['users.read', 'jf.warehouse:*'],
  ),
  /CANNOT_GRANT_PERMISSION/,
);
assert.deepEqual(
  _internals.permissionsGrantableBy(
    { role: 'owner', permissions: ['*'] },
    'Новая роль',
    ['company.update', 'users.update', 'jf.warehouse:*'],
  ),
  ['company.update', 'users.update', 'jf.warehouse:*'],
);
assert.deepEqual(
  _internals.permissionsFromRow({ role: 'Наблюдатель', permissions_json: '["*","orders.read"]' }),
  ['orders.read'],
);
assert.deepEqual(_internals.permissionsFromRow({ role: 'Наблюдатель', permissions_json: 'not-json' }), []);
assert.deepEqual(
  _internals.publicCompany({
    company_id: 'cmp_shared',
    company_code: 'JFSHARED',
    company_name: 'Shared company',
    company_status: 'active',
    data_api_address: '203.0.113.10',
    data_api_port: 443,
    data_api_tls_sha256: 'A'.repeat(64),
    data_api_updated_at: '2026-07-27T00:00:00Z',
  }).data_service,
  {
    address: '203.0.113.10',
    api_port: 443,
    tls_sha256: 'A'.repeat(64),
    updated_at: '2026-07-27T00:00:00Z',
  },
);
const telegramCompany = _internals.publicCompany({
  company_id: 'cmp_shared',
  company_code: 'JFSHARED',
  company_name: 'Shared company',
  company_status: 'active',
  telegram_worker_url: 'https://justfun-telegram.example.workers.dev',
  telegram_bot_username: 'justfun_test_bot',
  telegram_installation_id: 'cmp_shared',
  telegram_deployment_version: '7.8.3',
  telegram_updated_at: '2026-07-30T00:00:00Z',
});
assert.deepEqual(telegramCompany.telegram_service, {
  base_url: 'https://justfun-telegram.example.workers.dev',
  bot_username: 'justfun_test_bot',
  installation_id: 'cmp_shared',
  deployment_version: '7.8.3',
  updated_at: '2026-07-30T00:00:00Z',
});
assert.equal(Object.hasOwn(telegramCompany.telegram_service, 'client_api_key'), false);

const encryptedTelegramKey = await _internals.encryptIntegrationSecret(env, 'cmp_shared', 'A'.repeat(48));
assert.match(encryptedTelegramKey, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
assert.equal(await _internals.decryptIntegrationSecret(env, 'cmp_shared', encryptedTelegramKey), 'A'.repeat(48));
const jwtFallbackCiphertext = await _internals.encryptIntegrationSecret(
  { JWT_SECRET: env.JWT_SECRET },
  'cmp_shared',
  'C'.repeat(48),
);
assert.equal(await _internals.decryptIntegrationSecret(env, 'cmp_shared', jwtFallbackCiphertext), 'C'.repeat(48));
await assert.rejects(
  _internals.decryptIntegrationSecret(env, 'cmp_other', encryptedTelegramKey),
  error => error?.code === 'TELEGRAM_CONFIGURATION_REQUIRED',
);
assert.equal(_internals.canAccessWarehouse({ role: 'viewer', permissions: ['jf.warehouse:wh_main'] }, 'wh_main'), true);
assert.equal(_internals.canAccessWarehouse({ role: 'viewer', permissions: ['jf.warehouse:wh_main'] }, 'wh_other'), false);
assert.equal(_internals.canAccessWarehouse({ role: 'owner', permissions: [] }, 'wh_other'), true);

// Rate limiting combines a broad IP ceiling with an account bucket that is
// independent of the attacker's IP. Bucket values contain hashes, never a
// login, company code or raw network address.
const rateHits = new Map();
const rateBuckets = [];
const rateDb = {
  prepare(sql) {
    assert.match(sql, /INSERT INTO rate_limits/);
    return {
      bind(bucket, windowStart) {
        rateBuckets.push(bucket);
        return {
          async first() {
            const previous = rateHits.get(bucket);
            const hits = previous?.windowStart === windowStart ? previous.hits + 1 : 1;
            rateHits.set(bucket, { windowStart, hits });
            return { hits };
          },
        };
      },
    };
  },
};
const rateRequestA = new Request('https://license.test/v1/auth/login', {
  headers: { 'cf-connecting-ip': '203.0.113.10' },
});
const rateRequestB = new Request('https://license.test/v1/auth/login', {
  headers: { 'cf-connecting-ip': '198.51.100.20' },
});
await _internals.rateLimit({ DB: rateDb }, rateRequestA, 'login-account-test', 2, 900, {
  includeAddress: false,
  subject: 'JFTEST:owner',
});
await _internals.rateLimit({ DB: rateDb }, rateRequestB, 'login-account-test', 2, 900, {
  includeAddress: false,
  subject: 'JFTEST:owner',
});
await assert.rejects(
  _internals.rateLimit({ DB: rateDb }, rateRequestB, 'login-account-test', 2, 900, {
    includeAddress: false,
    subject: 'JFTEST:owner',
  }),
  error => error?.code === 'TOO_MANY_ATTEMPTS',
);
assert.equal(new Set(rateBuckets).size, 1);
assert.equal(rateBuckets[0].includes('JFTEST'), false);
assert.equal(rateBuckets[0].includes('203.0.113.10'), false);
await _internals.rateLimit({ DB: rateDb }, rateRequestA, 'login-ip-test', 1, 900);
await assert.rejects(
  _internals.rateLimit({ DB: rateDb }, rateRequestA, 'login-ip-test', 1, 900),
  error => error?.code === 'TOO_MANY_ATTEMPTS',
);
await _internals.rateLimit({ DB: rateDb }, rateRequestB, 'login-ip-test', 1, 900);

// The server owns the canonical 72-hour window. Repeated starts update only
// last_seen_at and must never create a fresh expiry for the same device.
let demoRow = null;
const demoDb = {
  prepare(sql) {
    return {
      bind(...args) {
        return {
          async first() {
            if (sql.includes('INSERT INTO rate_limits')) return { hits: 1 };
            if (sql.includes('SELECT * FROM demo_devices')) return demoRow;
            throw new Error(`Unexpected demo first query: ${sql}`);
          },
          async run() {
            if (sql.includes('INSERT INTO demo_devices')) {
              demoRow = {
                device_hash: args[0],
                first_started_at: args[1],
                expires_at: args[2],
                last_seen_at: args[3],
              };
              return { success: true };
            }
            if (sql.includes('UPDATE demo_devices SET last_seen_at')) {
              demoRow.last_seen_at = args[0];
              return { success: true };
            }
            throw new Error(`Unexpected demo run query: ${sql}`);
          },
        };
      },
    };
  },
};
const demoRequest = new Request('https://license.test/v1/demo/start', {
  method: 'POST',
  headers: { 'cf-connecting-ip': '203.0.113.7' },
});
const demoStartBefore = Date.now();
const firstDemo = await _internals.demoStart({ DB: demoDb }, demoRequest, { device_id: 'JF75-TEST-DEVICE' });
const firstExpiry = Date.parse(firstDemo.expires_at);
assert.ok(firstExpiry >= demoStartBefore + 72 * 60 * 60 * 1000);
assert.ok(firstExpiry <= Date.now() + 72 * 60 * 60 * 1000);
assert.ok(Number.isFinite(Date.parse(firstDemo.server_time)));
const secondDemo = await _internals.demoStart({ DB: demoDb }, demoRequest, { device_id: 'JF75-TEST-DEVICE' });
assert.equal(secondDemo.expires_at, firstDemo.expires_at);
demoRow.expires_at = new Date(Date.now() - 1000).toISOString();
await assert.rejects(
  _internals.demoStart({ DB: demoDb }, demoRequest, { device_id: 'JF75-TEST-DEVICE' }),
  error => error?.code === 'DEMO_EXPIRED',
);



const healthResponse = await worker.fetch(new Request('https://license.test/v1/health'), { DB: {} });
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.auth_contract, 4);

const tokenSet = await _internals.issueTokenSet(env, {
  id: 'usr_owner_contract',
  company_id: 'cmp_company_contract',
  company_code: 'JFCONTRACT',
  company_name: 'Contract company',
  company_status: 'active',
  full_name: 'Owner',
  login: 'owner',
  role: 'owner',
  permissions_json: '["*"]',
  status: 'active',
}, 'dev_contract', 'refresh-contract', '2026-08-28T00:00:00Z');
assert.equal(tokenSet.auth_context_version, 2);
assert.equal(tokenSet.user_id, 'usr_owner_contract');
assert.equal(tokenSet.company_id, 'cmp_company_contract');
assert.equal(tokenSet.device_id, 'dev_contract');
assert.equal(tokenSet.company.id, 'cmp_company_contract');

const brokerCiphertext = await _internals.encryptIntegrationSecret(env, 'cmp_broker', 'B'.repeat(48));
const brokerAuthRow = {
  id: 'usr_employee',
  company_id: 'cmp_broker',
  company_code: 'JFBROKER',
  company_name: 'Broker company',
  company_status: 'active',
  full_name: 'Employee',
  login: 'employee',
  role: 'warehouse',
  permissions_json: '["orders.read","jf.warehouse:wh_main"]',
  status: 'active',
  license_status: 'active',
  device_status: 'active',
  telegram_worker_url: 'https://justfun-telegram.example.workers.dev',
  telegram_client_key_ciphertext: brokerCiphertext,
  telegram_bot_username: 'justfun_test_bot',
  telegram_installation_id: 'cmp_broker',
  telegram_deployment_version: '7.8.3',
  telegram_updated_at: '2026-07-30T00:00:00Z',
};
const brokerDb = {
  prepare(sql) {
    return {
      bind() {
        return {
          async first() {
            if (sql.includes('FROM users u')) return brokerAuthRow;
            if (sql.includes('FROM companies WHERE id=?')) return brokerAuthRow;
            throw new Error(`Unexpected test query: ${sql}`);
          },
        };
      },
    };
  },
};
const employeeToken = await _internals.signJwt(env, {
  typ: 'access',
  sub: 'usr_employee',
  cid: 'cmp_broker',
  did: 'dev_employee',
  role: 'warehouse',
  permissions: ['orders.read', 'jf.warehouse:wh_main'],
}, 60);
let forwardedTelegramBody = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://justfun-telegram.example.workers.dev/v1/send');
  assert.equal(options.headers.authorization, `Bearer ${'B'.repeat(48)}`);
  forwardedTelegramBody = JSON.parse(options.body);
  return new Response(JSON.stringify({
    ok: true,
    notification: { id: 'nt_test', route_id: forwardedTelegramBody.route_id, status: 'sent', status_at: '2026-07-30T00:00:00Z' },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
try {
  const allowedResponse = await worker.fetch(new Request('https://license.test/v1/company/telegram/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${employeeToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      warehouse_id: 'wh_main',
      environment: 'live',
      entity_type: 'warehouse',
      entity_id: 'wh_main',
      route_id: 'route_1',
      idempotency_key: 'notify_route_1',
      text: 'Заказ готов',
    }),
  }), { ...env, DB: brokerDb });
  assert.equal(allowedResponse.status, 200);
  assert.equal(forwardedTelegramBody.warehouse_id, 'live--wh_main');
  assert.equal(forwardedTelegramBody.idempotency_key, 'live:notify_route_1');

  const deniedResponse = await worker.fetch(new Request('https://license.test/v1/company/telegram/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${employeeToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      warehouse_id: 'wh_other',
      environment: 'live',
      entity_type: 'warehouse',
      entity_id: 'wh_other',
      idempotency_key: 'notify_route_2',
      text: 'Недоступный склад',
    }),
  }), { ...env, DB: brokerDb });
  assert.equal(deniedResponse.status, 403);
  assert.equal((await deniedResponse.json()).error, 'WAREHOUSE_ACCESS_DENIED');
} finally {
  globalThis.fetch = originalFetch;
}

console.log(JSON.stringify({
  ok: true,
  passwordHash: 'PBKDF2-SHA256',
  jwt: 'HS256',
  generatedUniqueKeys: keys.size,
  warehousePermissions: true,
  companyDataService: true,
  companyTelegramBroker: true,
  employeeWarehouseBrokerAccess: true,
  authContextContract: 2,
}));
