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
  _internals.safePermissions(['jf.warehouse-code:спб', 'jf.warehouse-code:СПБ', 'jf.warehouse-code:sPb']),
  ['jf.warehouse-code:СПБ', 'jf.warehouse-code:SPB'],
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
assert.deepEqual(
  _internals.permissionsForRole('Кладовщик СПБ', ['jf.warehouse-code:спб']),
  ['jf.warehouse-code:СПБ'],
);
assert.equal(_internals.validateWarehouseCode(' спб '), 'СПБ');
assert.throws(() => _internals.validateWarehouseCode('MAIN'), /WAREHOUSE_CODE_REQUIRED/);
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
const vpsAttestationSecret = `jfvps_${'V'.repeat(43)}`;
const encryptedVpsAttestationSecret = await _internals.encryptIntegrationSecret(
  env,
  'cmp_shared',
  vpsAttestationSecret,
  _internals.INTEGRATION_SECRET_CONTEXTS.dataApiAttestation,
);
assert.equal(
  await _internals.decryptIntegrationSecret(
    env,
    'cmp_shared',
    encryptedVpsAttestationSecret,
    _internals.INTEGRATION_SECRET_CONTEXTS.dataApiAttestation,
  ),
  vpsAttestationSecret,
);
await assert.rejects(
  _internals.decryptIntegrationSecret(env, 'cmp_shared', encryptedVpsAttestationSecret),
  error => error?.code === 'TELEGRAM_CONFIGURATION_REQUIRED',
);
await assert.rejects(
  _internals.decryptIntegrationSecret(
    env,
    'cmp_shared',
    encryptedTelegramKey,
    _internals.INTEGRATION_SECRET_CONTEXTS.dataApiAttestation,
  ),
  error => error?.code === 'VPS_ATTESTATION_CONFIGURATION_REQUIRED',
);
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
const pendingInvitation=_internals.publicInvitation({id:'inv_pending',login:'user',full_name:'User',role:'Логист',permissions_json:'["orders.read"]',created_at:'2026-08-24T10:00:00.000Z',expires_at:'2026-08-25T10:00:00.000Z'},Date.parse('2026-08-24T11:00:00.000Z'));
assert.equal(pendingInvitation.status,'pending');
assert.deepEqual(pendingInvitation.permissions,['orders.read']);
assert.equal(Object.hasOwn(pendingInvitation,'code_hash'),false);
assert.equal(_internals.publicInvitation({...pendingInvitation,permissions_json:'[]',claimed_at:'2026-08-24T12:00:00.000Z'},Date.parse('2026-08-24T13:00:00.000Z')).status,'used');
assert.equal(_internals.publicInvitation({...pendingInvitation,permissions_json:'[]',revoked_at:'2026-08-24T12:00:00.000Z'},Date.parse('2026-08-24T13:00:00.000Z')).status,'revoked');
assert.equal(_internals.publicInvitation({...pendingInvitation,permissions_json:'[]',expires_at:'2026-08-24T10:30:00.000Z'},Date.parse('2026-08-24T13:00:00.000Z')).status,'expired');

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
assert.equal(health.auth_contract, 5);
assert.equal(health.warehouse_delete_lease_contract, 3);

const leaseTokenUnit = 'jfdl_unit-token';
const leaseTokenHashUnit = await _internals.sha256(leaseTokenUnit);
assert.equal(await _internals.warehouseDeleteLeaseTokenMatches(leaseTokenUnit, leaseTokenHashUnit), true);
assert.equal(await _internals.warehouseDeleteLeaseTokenMatches(`${leaseTokenUnit}-wrong`, leaseTokenHashUnit), false);
assert.equal(_internals.timingSafeHashEqual(leaseTokenHashUnit, 'corrupt'), false);

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

// Company VPS attestation secrets are mandatory for data-service setup, are
// encrypted with a purpose-bound context and never enter public/audit data.
const dataServiceAuthRow = {
  id: 'usr_data_owner',
  company_id: 'cmp_data',
  company_code: 'JFDATA',
  company_name: 'Data company',
  company_status: 'active',
  full_name: 'Data owner',
  login: 'data-owner',
  role: 'owner',
  permissions_json: '["*"]',
  status: 'active',
  license_status: 'active',
  device_status: 'active',
};
let dataServiceUpdateArgs = null;
const dataServiceAuditArgs = [];
const dataServiceDb = {
  prepare(sql) {
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() {
        if (sql.includes('FROM users u')) return dataServiceAuthRow;
        throw new Error(`Unexpected data-service first query: ${sql}`);
      },
      async run() {
        if (sql.includes('UPDATE companies')) {
          dataServiceUpdateArgs = [...this.args];
          return { meta: { changes: 1 } };
        }
        if (sql.includes('INSERT INTO audit_log')) {
          dataServiceAuditArgs.push([...this.args]);
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unexpected data-service run query: ${sql}`);
      },
    };
  },
};
const dataServiceAccessToken = await _internals.signJwt(env, {
  typ: 'access', sub: dataServiceAuthRow.id, cid: dataServiceAuthRow.company_id, did: 'dev_data_owner',
}, 60);
const dataServiceRequest = attestationSecret => worker.fetch(new Request('https://license.test/v1/company/data-service', {
  method: 'PUT',
  headers: { authorization: `Bearer ${dataServiceAccessToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    address: '203.0.113.20',
    api_port: 443,
    tls_sha256: 'D'.repeat(64),
    attestation_secret: attestationSecret,
  }),
}), { ...env, DB: dataServiceDb });
const invalidDataServiceSecret = await dataServiceRequest('jfvps_too-short');
assert.equal(invalidDataServiceSecret.status, 400);
assert.equal(dataServiceUpdateArgs, null);
const configuredDataServiceSecret = `jfvps_${'S'.repeat(43)}`;
const paddedDataServiceSecret = await dataServiceRequest(` ${configuredDataServiceSecret}`);
assert.equal(paddedDataServiceSecret.status, 400);
assert.equal(dataServiceUpdateArgs, null);
const configuredDataServiceResponse = await dataServiceRequest(configuredDataServiceSecret);
assert.equal(configuredDataServiceResponse.status, 200);
const configuredDataService = await configuredDataServiceResponse.json();
assert.equal(JSON.stringify(configuredDataService).includes(configuredDataServiceSecret), false);
assert.equal(dataServiceUpdateArgs.length, 6);
assert.notEqual(dataServiceUpdateArgs[3], configuredDataServiceSecret);
assert.match(dataServiceUpdateArgs[3], /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
assert.equal(
  await _internals.decryptIntegrationSecret(
    env,
    dataServiceAuthRow.company_id,
    dataServiceUpdateArgs[3],
    _internals.INTEGRATION_SECRET_CONTEXTS.dataApiAttestation,
  ),
  configuredDataServiceSecret,
);
assert.equal(JSON.stringify(dataServiceAuditArgs).includes(configuredDataServiceSecret), false);
assert.equal(JSON.stringify(dataServiceAuditArgs).includes(dataServiceUpdateArgs[3]), false);

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

// Warehouse deletion is global-only. An active lease can be promoted to an
// indefinitely durable prepared state, recovered with token rotation, and
// released idempotently without ever auditing the token or its hash.
const leaseAuthRow = (id, permissions) => ({
  id,
  company_id: 'cmp_lease',
  company_code: 'JFLEASE',
  company_name: 'Lease company',
  company_status: 'active',
  full_name: id,
  login: id,
  role: 'warehouse-manager',
  permissions_json: JSON.stringify(permissions),
  status: 'active',
  license_status: 'active',
  device_status: 'active',
});
const leaseAuthRows = new Map([
  ['usr_global_manager', leaseAuthRow('usr_global_manager', ['warehouses.manage', 'jf.warehouse:*'])],
  ['usr_other_global', leaseAuthRow('usr_other_global', ['warehouses.manage', 'jf.warehouse:*'])],
  ['usr_scoped_manager', leaseAuthRow('usr_scoped_manager', ['warehouses.manage', 'jf.warehouse:wh_spb'])],
  ['usr_global_reader', leaseAuthRow('usr_global_reader', ['jf.warehouse:*'])],
]);
let activeLease = null;
let leaseAssignmentCounts = { users: 0, pending_invitations: 0 };
const leaseAuditRows = [];
const leaseTokenHashes = [];
const leaseRateHits = new Map();
const leaseRateBuckets = [];
const leaseDb = {
  prepare(sql) {
    const statement = {
      sql,
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async first() {
        if (sql.includes('FROM users u')) return leaseAuthRows.get(this.args[1]) || null;
        if (sql.includes('INSERT INTO rate_limits')) {
          const [bucket, windowStart] = this.args;
          leaseRateBuckets.push(bucket);
          const previous = leaseRateHits.get(bucket);
          const hits = previous?.windowStart === windowStart ? previous.hits + 1 : 1;
          leaseRateHits.set(bucket, { windowStart, hits });
          return { hits };
        }
        if (sql.includes('AS pending_invitations')) return { ...leaseAssignmentCounts };
        if (sql.includes('FROM warehouse_delete_leases')) {
          const [companyId, warehouseId, warehouseCode, actorUserId, now, includeReleased] = this.args;
          if (
            activeLease
            && activeLease.company_id === companyId
            && activeLease.warehouse_id === warehouseId
            && activeLease.warehouse_code === warehouseCode
            && activeLease.actor_user_id === actorUserId
            && (
              activeLease.status === 'prepared'
              || (activeLease.status === 'active' && activeLease.expires_at > now)
              || (includeReleased === 1 && activeLease.status === 'released')
            )
          ) return { ...activeLease };
          return null;
        }
        throw new Error(`Unexpected lease first query: ${sql}`);
      },
      async all() {
        if (sql.includes('FROM warehouse_delete_leases')) {
          const [companyId, warehouseId, warehouseCode, actorUserId, now] = this.args;
          const matches = activeLease
            && activeLease.company_id === companyId
            && activeLease.warehouse_id === warehouseId
            && activeLease.warehouse_code === warehouseCode
            && activeLease.actor_user_id === actorUserId
            && (
              ['prepared', 'released'].includes(activeLease.status)
              || (activeLease.status === 'active' && activeLease.expires_at > now)
            );
          return { results: matches ? [{ ...activeLease }] : [] };
        }
        throw new Error(`Unexpected lease all query: ${sql}`);
      },
      async run() {
        if (sql.includes("UPDATE warehouse_delete_leases") && sql.includes("status='expired'")) {
          const [, companyId, now] = this.args;
          if (activeLease?.company_id === companyId && activeLease.status === 'active' && activeLease.expires_at <= now) {
            activeLease.status = 'expired';
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql.includes('INSERT INTO audit_log')) {
          leaseAuditRows.push({
            company_id: this.args[1],
            user_id: this.args[2],
            action: this.args[3],
            entity_id: this.args[4],
            details_json: this.args[5],
          });
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unexpected lease run query: ${sql}`);
      },
    };
    return statement;
  },
  async batch(statements) {
    const results = [];
    let previousChanges = 0;
    for (const statement of statements) {
      const { sql, args } = statement;
      let returnedRows = [];
      if (sql.includes('INSERT INTO warehouse_delete_leases')) {
        if (
          activeLease
          && ['active', 'prepared'].includes(activeLease.status)
          && activeLease.company_id === args[1]
          && (activeLease.warehouse_id === args[2] || activeLease.warehouse_code === args[3])
        ) throw new Error('UNIQUE constraint failed: warehouse_delete_leases target');
        activeLease = {
          id: args[0],
          company_id: args[1],
          warehouse_id: args[2],
          warehouse_code: args[3],
          actor_user_id: args[4],
          token_hash: args[5],
          status: 'active',
          expires_at: args[6],
          created_at: args[7],
          updated_at: args[8],
        };
        leaseTokenHashes.push(args[5]);
        previousChanges = 1;
      } else if (sql.includes('SET token_hash=?,actor_user_id=?,updated_at=?')) {
        const [tokenHash, actorUserId, updatedAt, companyId, warehouseId, warehouseCode] = args;
        previousChanges = Number(Boolean(
          activeLease
          && activeLease.status === 'prepared'
          && activeLease.company_id === companyId
          && activeLease.warehouse_id === warehouseId
          && activeLease.warehouse_code === warehouseCode
        ));
        if (previousChanges) {
          activeLease.token_hash = tokenHash;
          activeLease.actor_user_id = actorUserId;
          activeLease.updated_at = updatedAt;
          leaseTokenHashes.push(tokenHash);
          returnedRows = [{ ...activeLease }];
        }
      } else if (sql.includes("SET status='prepared'")) {
        const [updatedAt, leaseId, companyId, warehouseId, warehouseCode, actorUserId, tokenHash, now] = args;
        previousChanges = Number(Boolean(
          activeLease
          && activeLease.id === leaseId
          && activeLease.company_id === companyId
          && activeLease.warehouse_id === warehouseId
          && activeLease.warehouse_code === warehouseCode
          && activeLease.actor_user_id === actorUserId
          && activeLease.token_hash === tokenHash
          && activeLease.status === 'active'
          && activeLease.expires_at > now
        ));
        if (previousChanges) {
          activeLease.status = 'prepared';
          activeLease.updated_at = updatedAt;
        }
      } else if (sql.includes("SET status='released'")) {
        const [updatedAt, leaseId, companyId, actorUserId, tokenHash, now] = args;
        previousChanges = Number(Boolean(
          activeLease
          && activeLease.id === leaseId
          && activeLease.company_id === companyId
          && activeLease.actor_user_id === actorUserId
          && activeLease.token_hash === tokenHash
          && (
            activeLease.status === 'prepared'
            || (activeLease.status === 'active' && activeLease.expires_at > now)
          )
        ));
        if (previousChanges) {
          activeLease.status = 'released';
          activeLease.updated_at = updatedAt;
        }
      } else if (sql.includes('INSERT INTO audit_log')) {
        if (!sql.includes('changes()=1') || previousChanges === 1) {
          leaseAuditRows.push({
            company_id: args[1],
            user_id: args[2],
            action: args[3],
            entity_id: args[4],
            details_json: args[5],
          });
          previousChanges = 1;
        } else {
          previousChanges = 0;
        }
      } else {
        throw new Error(`Unexpected lease batch query: ${sql}`);
      }
      results.push({ meta: { changes: previousChanges }, results: returnedRows });
    }
    return results;
  },
};
const leaseAccessToken = async userId => _internals.signJwt(env, {
  typ: 'access',
  sub: userId,
  cid: 'cmp_lease',
  did: `dev_${userId}`,
}, 60);
const globalLeaseToken = await leaseAccessToken('usr_global_manager');
const otherGlobalLeaseToken = await leaseAccessToken('usr_other_global');
const scopedLeaseToken = await leaseAccessToken('usr_scoped_manager');
const globalReaderToken = await leaseAccessToken('usr_global_reader');
const leaseRequest = (path, accessToken, data, address = '203.0.113.40') => worker.fetch(new Request(`https://license.test${path}`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    'cf-connecting-ip': address,
  },
  body: JSON.stringify(data),
}), { ...env, DB: leaseDb });

for (const deniedToken of [scopedLeaseToken, globalReaderToken]) {
  const denied = await leaseRequest('/v1/warehouse-delete-leases/acquire', deniedToken, {
    warehouse_id: 'wh_spb',
    warehouse_code: 'СПБ',
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, 'ACCESS_BLOCKED');
}
leaseAssignmentCounts = { users: 2, pending_invitations: 1 };
const assignedLeaseResponse = await leaseRequest('/v1/warehouse-delete-leases/acquire', globalLeaseToken, {
  warehouse_id: 'wh_spb',
  warehouse_code: 'СПБ',
}, '203.0.113.41');
assert.equal(assignedLeaseResponse.status, 409);
const assignedLease = await assignedLeaseResponse.json();
assert.equal(assignedLease.error, 'WAREHOUSE_ASSIGNED');
assert.deepEqual(assignedLease.assigned, { count: 3, users: 2, pending_invitations: 1 });
assert.deepEqual(Object.keys(assignedLease.assigned).sort(), ['count', 'pending_invitations', 'users']);
leaseAssignmentCounts = { users: 0, pending_invitations: 0 };
const acquiredResponse = await leaseRequest('/v1/warehouse-delete-leases/acquire', globalLeaseToken, {
  warehouse_id: 'wh_spb',
  warehouse_code: 'спб',
});
assert.equal(acquiredResponse.status, 200);
const acquiredLease = await acquiredResponse.json();
assert.match(acquiredLease.lease_token, /^jfdl_[A-Za-z0-9_-]+$/);
assert.equal(acquiredLease.lease.warehouse_code, 'СПБ');
assert.equal(acquiredLease.status, 'active');
assert.equal(acquiredLease.prepared, false);
assert.equal(acquiredLease.recovered, false);
assert.equal(acquiredLease.remaining_seconds, 120);

const wrongLeaseResponse = await leaseRequest('/v1/warehouse-delete-leases/verify', globalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ', lease_token: 'wrong-token',
});
assert.equal(wrongLeaseResponse.status, 409);
assert.equal((await wrongLeaseResponse.json()).error, 'WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED');

const verifiedResponse = await leaseRequest('/v1/warehouse-delete-leases/verify', globalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ', lease_token: acquiredLease.lease_token,
});
assert.equal(verifiedResponse.status, 200);
const verifiedLease = await verifiedResponse.json();
assert.equal(verifiedLease.active, true);
assert.equal(verifiedLease.status, 'active');
assert.equal(verifiedLease.prepared, false);
assert.ok(verifiedLease.remaining_seconds >= 30);
assert.equal(Object.hasOwn(verifiedLease, 'lease_token'), false);

const fullLeaseExpiry = activeLease.expires_at;
activeLease.expires_at = Math.floor(Date.now() / 1000) + 29;
const lowTtlResponse = await leaseRequest('/v1/warehouse-delete-leases/verify', globalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ', lease_token: acquiredLease.lease_token,
});
assert.equal(lowTtlResponse.status, 409);
assert.equal((await lowTtlResponse.json()).error, 'WAREHOUSE_DELETE_LEASE_REACQUIRE_REQUIRED');
activeLease.expires_at = fullLeaseExpiry;

const wrongPrepareResponse = await leaseRequest('/v1/warehouse-delete-leases/prepare', globalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ', lease_token: 'wrong-token',
});
assert.equal(wrongPrepareResponse.status, 409);

const preparedResponse = await leaseRequest('/v1/warehouse-delete-leases/prepare', globalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ', lease_token: acquiredLease.lease_token,
});
assert.equal(preparedResponse.status, 200);
const preparedLease = await preparedResponse.json();
assert.equal(preparedLease.status, 'prepared');
assert.equal(preparedLease.prepared, true);
assert.equal(preparedLease.idempotent, false);
assert.equal(preparedLease.remaining_seconds, null);
assert.equal(preparedLease.lease.expires_at, null);
assert.equal(Object.hasOwn(preparedLease, 'lease_token'), false);

activeLease.expires_at = Math.floor(Date.now() / 1000) - 3600;
const durableVerifyResponse = await leaseRequest('/v1/warehouse-delete-leases/verify', globalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ', lease_token: acquiredLease.lease_token,
});
assert.equal(durableVerifyResponse.status, 200);
const durableVerify = await durableVerifyResponse.json();
assert.equal(durableVerify.status, 'prepared');
assert.equal(durableVerify.prepared, true);
assert.equal(durableVerify.remaining_seconds, null);

const idempotentPrepareResponse = await leaseRequest('/v1/warehouse-delete-leases/prepare', globalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ', lease_token: acquiredLease.lease_token,
});
assert.equal(idempotentPrepareResponse.status, 200);
assert.equal((await idempotentPrepareResponse.json()).idempotent, true);

const recoveredResponse = await leaseRequest('/v1/warehouse-delete-leases/acquire', globalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ',
});
assert.equal(recoveredResponse.status, 200);
const recoveredLease = await recoveredResponse.json();
assert.equal(recoveredLease.status, 'prepared');
assert.equal(recoveredLease.prepared, true);
assert.equal(recoveredLease.recovered, true);
assert.equal(recoveredLease.remaining_seconds, null);
assert.notEqual(recoveredLease.lease_token, acquiredLease.lease_token);

const staleTokenVerify = await leaseRequest('/v1/warehouse-delete-leases/verify', globalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ', lease_token: acquiredLease.lease_token,
});
assert.equal(staleTokenVerify.status, 409);
const recoveredVerify = await leaseRequest('/v1/warehouse-delete-leases/verify', globalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ', lease_token: recoveredLease.lease_token,
});
assert.equal(recoveredVerify.status, 200);

const otherActorRecoveryResponse = await leaseRequest('/v1/warehouse-delete-leases/acquire', otherGlobalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ',
});
assert.equal(otherActorRecoveryResponse.status, 200);
const otherActorRecovery = await otherActorRecoveryResponse.json();
assert.equal(otherActorRecovery.recovered, true);
assert.equal(otherActorRecovery.prepared, true);
assert.equal(otherActorRecovery.lease.actor_user_id, 'usr_other_global');
assert.notEqual(otherActorRecovery.lease_token, recoveredLease.lease_token);
const staleRecoveredVerify = await leaseRequest('/v1/warehouse-delete-leases/verify', globalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ', lease_token: recoveredLease.lease_token,
});
assert.equal(staleRecoveredVerify.status, 409);
const otherTargetConflict = await leaseRequest('/v1/warehouse-delete-leases/acquire', otherGlobalLeaseToken, {
  warehouse_id: 'wh_other', warehouse_code: 'СПБ',
});
assert.equal(otherTargetConflict.status, 409);
assert.equal((await otherTargetConflict.json()).error, 'WAREHOUSE_DELETE_LEASE_ACTIVE');

const releasedResponse = await leaseRequest('/v1/warehouse-delete-leases/release', otherGlobalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ', lease_token: otherActorRecovery.lease_token,
});
assert.equal(releasedResponse.status, 200);
const releasedLease = await releasedResponse.json();
assert.equal(releasedLease.released, true);
assert.equal(releasedLease.idempotent, false);
const repeatedReleaseResponse = await leaseRequest('/v1/warehouse-delete-leases/release', otherGlobalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ', lease_token: otherActorRecovery.lease_token,
});
assert.equal(repeatedReleaseResponse.status, 200);
const repeatedRelease = await repeatedReleaseResponse.json();
assert.equal(repeatedRelease.released, true);
assert.equal(repeatedRelease.idempotent, true);

const releasedVerifyResponse = await leaseRequest('/v1/warehouse-delete-leases/verify', otherGlobalLeaseToken, {
  warehouse_id: 'wh_spb', warehouse_code: 'СПБ', lease_token: otherActorRecovery.lease_token,
});
assert.equal(releasedVerifyResponse.status, 409);

const acquireBucket = leaseRateBuckets.at(-1);
leaseRateHits.set(acquireBucket, { ...leaseRateHits.get(acquireBucket), hits: 12 });
const rateLimitedAcquire = await leaseRequest('/v1/warehouse-delete-leases/acquire', otherGlobalLeaseToken, {
  warehouse_id: 'wh_rate_limited', warehouse_code: 'РЛ',
});
assert.equal(rateLimitedAcquire.status, 429);
assert.equal((await rateLimitedAcquire.json()).error, 'TOO_MANY_ATTEMPTS');

const serializedLeaseAudit = JSON.stringify(leaseAuditRows);
assert.equal(serializedLeaseAudit.includes(acquiredLease.lease_token), false);
assert.equal(serializedLeaseAudit.includes(recoveredLease.lease_token), false);
assert.equal(serializedLeaseAudit.includes(otherActorRecovery.lease_token), false);
for (const tokenHash of leaseTokenHashes) assert.equal(serializedLeaseAudit.includes(tokenHash), false);
assert.ok(leaseRateBuckets.length >= 4);
assert.ok(new Set(leaseRateBuckets).size >= 3);
for (const bucket of leaseRateBuckets) {
  assert.match(bucket, /^warehouse-delete-lease-acquire:[A-Za-z0-9_-]+$/);
  assert.equal(bucket.includes('cmp_lease'), false);
  assert.equal(bucket.includes('usr_'), false);
  assert.equal(bucket.includes('203.0.113'), false);
}

// VPS attestations are public only in the HTTP sense: every request must carry
// a company-scoped HMAC, a fresh timestamp and an exact proof-bound payload.
const attestationCompanyId = 'cmp_attestation';
const attestationSecret = `jfvps_${'H'.repeat(43)}`;
const attestationSecretCiphertext = await _internals.encryptIntegrationSecret(
  env,
  attestationCompanyId,
  attestationSecret,
  _internals.INTEGRATION_SECRET_CONTEXTS.dataApiAttestation,
);
const attestationLeaseToken = `jfdl_${'L'.repeat(43)}`;
const attestationLeaseTokenHash = await _internals.sha256(attestationLeaseToken);
let attestationLease = {
  id: 'wdl_attestation',
  company_id: attestationCompanyId,
  warehouse_id: 'wh_attestation',
  warehouse_code: 'СПБ',
  actor_user_id: 'usr_attestation_owner',
  token_hash: attestationLeaseTokenHash,
  status: 'prepared',
  expires_at: Math.floor(Date.now() / 1000) - 3600,
  created_at: '2026-08-23T00:00:00.000Z',
  updated_at: '2026-08-23T00:01:00.000Z',
};
const attestationAuditRows = [];
const attestationDb = {
  prepare(sql) {
    return {
      sql,
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() {
        if (sql.includes('SELECT data_api_attestation_secret_ciphertext')) {
          return this.args[0] === attestationCompanyId
            ? { data_api_attestation_secret_ciphertext: attestationSecretCiphertext }
            : null;
        }
        if (sql.includes('FROM warehouse_delete_leases')) {
          const exactLeaseLookup = sql.includes('WHERE id=?');
          const [leaseId, companyId, warehouseId, warehouseCode] = exactLeaseLookup
            ? this.args
            : [null, ...this.args];
          const scopeMatches = attestationLease
            && (!exactLeaseLookup || attestationLease.id === leaseId)
            && attestationLease.company_id === companyId
            && attestationLease.warehouse_id === warehouseId
            && attestationLease.warehouse_code === warehouseCode;
          if (!scopeMatches) return null;
          if (sql.includes("status='prepared'")) {
            return attestationLease.status === 'prepared' ? { ...attestationLease } : null;
          }
          if (sql.includes('ORDER BY created_at DESC') || exactLeaseLookup) return { ...attestationLease };
        }
        throw new Error(`Unexpected attestation first query: ${sql}`);
      },
      async run() {
        if (sql.includes('INSERT INTO audit_log')) {
          attestationAuditRows.push({
            company_id: this.args[1],
            user_id: this.args[2],
            action: this.args[3],
            entity_id: this.args[4],
            details_json: this.args[5],
          });
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unexpected attestation run query: ${sql}`);
      },
    };
  },
  async batch(statements) {
    const results = [];
    let previousChanges = 0;
    for (const statement of statements) {
      if (statement.sql.includes("SET status='released'")) {
        const [updatedAt, leaseId, companyId, warehouseId, warehouseCode] = statement.args;
        previousChanges = Number(Boolean(
          attestationLease
          && attestationLease.id === leaseId
          && attestationLease.company_id === companyId
          && attestationLease.warehouse_id === warehouseId
          && attestationLease.warehouse_code === warehouseCode
          && attestationLease.status === 'prepared'
        ));
        if (previousChanges) {
          attestationLease.status = 'released';
          attestationLease.updated_at = updatedAt;
        }
      } else if (statement.sql.includes('INSERT INTO audit_log')) {
        if (previousChanges === 1) {
          attestationAuditRows.push({
            company_id: statement.args[1],
            user_id: statement.args[2],
            action: statement.args[3],
            entity_id: statement.args[4],
            details_json: statement.args[5],
          });
        }
      } else {
        throw new Error(`Unexpected attestation batch query: ${statement.sql}`);
      }
      results.push({ meta: { changes: previousChanges } });
    }
    return results;
  },
};
const attestationPayload = {
  company_id: attestationCompanyId,
  warehouse_id: 'wh_attestation',
  warehouse_code: 'СПБ',
  delete_command_id: 'client:test:warehouse:delete:attestation',
  delete_base_version: 7,
  lease_token: attestationLeaseToken,
};
const bytesToHex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
async function vpsAttestationHeaders(payload, options = {}) {
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = options.nonce ?? 'nonce_attestation_0123456789';
  const canonical = await _internals.buildVpsAttestationCanonicalString(payload, timestamp, nonce);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(options.secret ?? attestationSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical)));
  return {
    'content-type': 'application/json',
    'x-justfun-vps-timestamp': timestamp,
    'x-justfun-vps-nonce': nonce,
    'x-justfun-vps-signature': options.signature ?? `v1=${signature}`,
  };
}
async function vpsAttestationRequest(path, bodyPayload, options = {}) {
  const signedPayload = options.signedPayload ?? bodyPayload;
  return worker.fetch(new Request(`https://license.test${path}`, {
    method: 'POST',
    headers: await vpsAttestationHeaders(signedPayload, options),
    body: JSON.stringify(bodyPayload),
  }), { ...env, DB: attestationDb });
}

const verifiedAttestationResponse = await vpsAttestationRequest('/v1/vps-attestations/verify', attestationPayload);
assert.equal(verifiedAttestationResponse.status, 200);
const verifiedAttestation = await verifiedAttestationResponse.json();
assert.equal(verifiedAttestation.verified, true);
assert.equal(verifiedAttestation.prepared, true);
assert.equal(verifiedAttestation.delete_command_id, attestationPayload.delete_command_id);
assert.equal(verifiedAttestation.delete_base_version, attestationPayload.delete_base_version);
assert.equal(Object.hasOwn(verifiedAttestation, 'lease_token'), false);
assert.equal(Object.hasOwn(verifiedAttestation.lease, 'token_hash'), false);

const mismatchedAttestation = await vpsAttestationRequest('/v1/vps-attestations/verify', {
  ...attestationPayload,
  delete_base_version: attestationPayload.delete_base_version + 1,
}, { signedPayload: attestationPayload, nonce: 'nonce_mismatched_0123456789' });
assert.equal(mismatchedAttestation.status, 401);
assert.equal((await mismatchedAttestation.json()).error, 'VPS_ATTESTATION_INVALID');
const attestationFieldMutations = [
  { company_id: 'cmp_attestation_other' },
  { warehouse_id: 'wh_attestation_other' },
  { warehouse_code: 'МСК' },
  { delete_command_id: 'client:test:warehouse:delete:other' },
  { lease_token: `jfdl_${'Q'.repeat(43)}` },
];
for (let index = 0; index < attestationFieldMutations.length; index++) {
  const fieldMismatchResponse = await vpsAttestationRequest('/v1/vps-attestations/verify', {
    ...attestationPayload,
    ...attestationFieldMutations[index],
  }, {
    signedPayload: attestationPayload,
    nonce: `nonce_field_mismatch_${index}_0123456789`,
  });
  assert.equal(fieldMismatchResponse.status, 401);
}
const paddedAttestationField = await vpsAttestationRequest('/v1/vps-attestations/verify', {
  ...attestationPayload,
  warehouse_id: `${attestationPayload.warehouse_id} `,
}, { nonce: 'nonce_padded_field_0123456789' });
assert.equal(paddedAttestationField.status, 400);
const malformedNonceAttestation = await vpsAttestationRequest('/v1/vps-attestations/verify', attestationPayload, {
  nonce: 'short',
});
assert.equal(malformedNonceAttestation.status, 401);
const malformedSignatureAttestation = await vpsAttestationRequest('/v1/vps-attestations/verify', attestationPayload, {
  nonce: 'nonce_bad_signature_0123456789',
  signature: `v1=${'A'.repeat(64)}`,
});
assert.equal(malformedSignatureAttestation.status, 401);
for (const [label, timestamp] of [
  // Keep a deterministic margin beyond the 90-second acceptance boundary.
  // A +91 timestamp can become exactly +90 while the async request is built.
  ['old', Math.floor(Date.now() / 1000) - 120],
  ['future', Math.floor(Date.now() / 1000) + 120],
]) {
  const staleResponse = await vpsAttestationRequest('/v1/vps-attestations/verify', attestationPayload, {
    nonce: `nonce_${label}_timestamp_0123456789`,
    timestamp,
  });
  assert.equal(staleResponse.status, 401);
}
const wrongLeaseAttestation = await vpsAttestationRequest('/v1/vps-attestations/verify', {
  ...attestationPayload,
  lease_token: `jfdl_${'W'.repeat(43)}`,
}, { nonce: 'nonce_wrong_lease_0123456789' });
assert.equal(wrongLeaseAttestation.status, 409);
assert.equal((await wrongLeaseAttestation.json()).error, 'WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED');

const releaseAttestationPayload = { ...attestationPayload };
delete releaseAttestationPayload.lease_token;
const releaseAttestationOptions = { nonce: 'nonce_release_0123456789' };
const releasedAttestationResponse = await vpsAttestationRequest(
  '/v1/vps-attestations/release-warehouse-delete',
  releaseAttestationPayload,
  releaseAttestationOptions,
);
assert.equal(releasedAttestationResponse.status, 200);
const releasedAttestation = await releasedAttestationResponse.json();
assert.equal(releasedAttestation.released, true);
assert.equal(releasedAttestation.idempotent, false);
assert.equal(attestationLease.status, 'released');
const repeatedAttestationReleaseResponse = await vpsAttestationRequest(
  '/v1/vps-attestations/release-warehouse-delete',
  releaseAttestationPayload,
  releaseAttestationOptions,
);
assert.equal(repeatedAttestationReleaseResponse.status, 200);
assert.equal((await repeatedAttestationReleaseResponse.json()).idempotent, true);
const releasedAttestationLease = { ...attestationLease };
attestationLease = {
  ...releasedAttestationLease,
  id: 'wdl_attestation_new_active',
  token_hash: await _internals.sha256(`jfdl_${'N'.repeat(43)}`),
  status: 'active',
  expires_at: Math.floor(Date.now() / 1000) + 120,
  created_at: '2026-08-23T00:02:00.000Z',
  updated_at: '2026-08-23T00:02:00.000Z',
};
const oldReleaseMustNotMaskNewLease = await vpsAttestationRequest(
  '/v1/vps-attestations/release-warehouse-delete',
  releaseAttestationPayload,
  { nonce: 'nonce_new_active_0123456789' },
);
assert.equal(oldReleaseMustNotMaskNewLease.status, 409);
attestationLease = releasedAttestationLease;

const serializedAttestationAudit = JSON.stringify(attestationAuditRows);
assert.equal(serializedAttestationAudit.includes(attestationSecret), false);
assert.equal(serializedAttestationAudit.includes(attestationSecretCiphertext), false);
assert.equal(serializedAttestationAudit.includes(attestationLeaseToken), false);
assert.equal(serializedAttestationAudit.includes(attestationLeaseTokenHash), false);
assert.ok(attestationAuditRows.some(row => row.action === 'warehouse.delete-lease.verify-vps-attestation' && row.user_id === null));
assert.ok(attestationAuditRows.some(row => row.action === 'warehouse.delete-lease.release-vps-attestation' && row.user_id === null));

console.log(JSON.stringify({
  ok: true,
  passwordHash: 'PBKDF2-SHA256',
  jwt: 'HS256',
  generatedUniqueKeys: keys.size,
  warehousePermissions: true,
  companyDataService: true,
  vpsAttestations: true,
  companyTelegramBroker: true,
  employeeWarehouseBrokerAccess: true,
  warehouseDeleteLeaseContract: 3,
  authContextContract: 2,
}));
