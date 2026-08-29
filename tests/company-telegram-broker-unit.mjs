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
assert.equal(_internals.canDeprovisionWarehouseTelegram({ role: 'owner', permissions: [] }, 'wh_main'), true);
assert.equal(_internals.canDeprovisionWarehouseTelegram({ role: 'manager', permissions: ['warehouses.manage', 'jf.warehouse:wh_main'] }, 'wh_main'), false);
assert.equal(_internals.canDeprovisionWarehouseTelegram({ role: 'manager', permissions: ['warehouses.manage', 'jf.warehouse:*'] }, 'wh_main'), true);
assert.equal(_internals.canDeprovisionWarehouseTelegram({ role: 'manager', permissions: ['*'] }, 'wh_main'), true);
assert.equal(_internals.canDeprovisionWarehouseTelegram({ role: 'manager', permissions: ['warehouses.manage', 'jf.warehouse:wh_other'] }, 'wh_main'), false);
const customRoleWithoutPermissions = { role: 'Оператор проверки', permissions: [] };
assert.equal(_internals.canAccessWarehouse(customRoleWithoutPermissions, 'wh_main'), false);
assert.equal(_internals.canManageIntegrations(customRoleWithoutPermissions), false);
assert.equal(_internals.canDeprovisionWarehouseTelegram(customRoleWithoutPermissions, 'wh_main'), false);

const health = await worker.fetch(new Request('https://broker.test/health'), {
  LICENSE_API_ORIGIN: 'https://license.test',
});
assert.equal(health.status, 200);
const healthPayload = await health.json();
assert.equal(healthPayload.broker_contract, 4);
assert.equal(healthPayload.telegram_deprovision_contract, 3);
assert.equal(healthPayload.version, '1.3.0');

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

const localizedRoleAuth = await _internals.introspectLicense(
  { LICENSE_API_ORIGIN: 'https://license.test' },
  new Request('https://broker.test/v1/company/telegram/status', {
    headers: { authorization: 'Bearer localized-role-test-token' },
  }),
  async () => new Response(JSON.stringify({
    ok: true,
    active: true,
    user_id: 'usr_employee',
    company_id: 'cmp_company',
    role: 'Оператор проверки',
    permissions: ['jf.warehouse:wh_main'],
    company: { id: 'cmp_company' },
    device_id: 'dev_test',
  }), { status: 200, headers: { 'content-type': 'application/json' } }),
);
assert.equal(localizedRoleAuth.role, 'Оператор проверки');
assert.deepEqual(localizedRoleAuth.permissions, ['jf.warehouse:wh_main']);
assert.equal(_internals.validateIntrospectedRole('  Оператор   проверки  '), 'Оператор проверки');
assert.equal(_internals.validateIntrospectedRole('owner'), 'owner');
assert.equal(_internals.validateIntrospectedRole('А1'), 'А1');
assert.equal(_internals.validateIntrospectedRole('Р'.repeat(50)), 'Р'.repeat(50));
for (const invalidRole of ['x', 'Owner', 'Оператор<script>', 'Р'.repeat(51)]) {
  assert.throws(
    () => _internals.validateIntrospectedRole(invalidRole),
    error => error?.status === 502 && error?.code === 'AUTH_SERVICE_INVALID',
  );
}
await assert.rejects(
  _internals.introspectLicense(
    { LICENSE_API_ORIGIN: 'https://license.test' },
    new Request('https://broker.test/v1/company/telegram/status', {
      headers: { authorization: 'Bearer conflicting-role-test-token' },
    }),
    async () => new Response(JSON.stringify({
      ok: true,
      active: true,
      user_id: 'usr_employee',
      company_id: 'cmp_company',
      role: 'manager',
      permissions: [],
      user: { id: 'usr_employee', role: 'Оператор проверки', permissions: [] },
      company: { id: 'cmp_company' },
      device_id: 'dev_test',
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  ),
  error => error?.status === 502 && error?.code === 'AUTH_SERVICE_INVALID',
);

const proofContractData = {
  warehouse_id: 'wh_main', warehouse_code: 'СПБ',
  warehouse_delete_lease_token: `jfdl_${'P'.repeat(48)}`,
  delete_command_id: 'client:test:proof:command:001', delete_base_version: 4,
};
const proofContractAuth = { company_id: 'cmp_company', user_id: 'usr_employee', role: 'owner', permissions: [] };
const proofContractRequest = new Request('https://broker.test/v1/company/telegram-service/deprovision', {
  method: 'POST', headers: { authorization: 'Bearer proof-test-token' },
});
const validProofResponse = {
  ok: true, active: true, prepared: true, status: 'prepared', remaining_seconds: null,
  lease: {
    id: 'wdl_proof_contract_001', company_id: 'cmp_company', warehouse_id: 'wh_main',
    warehouse_code: 'СПБ', actor_user_id: 'usr_employee', status: 'prepared', expires_at: null,
  },
};
const verifiedProof = await _internals.verifyPreparedWarehouseDeleteLease(
  { LICENSE_API_ORIGIN: 'https://license.test' }, proofContractRequest, proofContractData, proofContractAuth,
  async (_url, options) => {
    assert.equal(JSON.parse(options.body).lease_token, proofContractData.warehouse_delete_lease_token);
    return new Response(JSON.stringify(validProofResponse), { status: 200 });
  },
);
assert.deepEqual(verifiedProof, {
  companyId: 'cmp_company', warehouseId: 'wh_main', warehouseCode: 'СПБ',
  deleteCommandId: 'client:test:proof:command:001', deleteBaseVersion: 4,
  actorUserId: 'usr_employee', leaseId: 'wdl_proof_contract_001',
});
for (const mutation of [
  { prepared: false, status: 'active', remaining_seconds: 90, lease: { ...validProofResponse.lease, status: 'active', expires_at: new Date().toISOString() } },
  { lease: { ...validProofResponse.lease, company_id: 'cmp_other' } },
  { lease: { ...validProofResponse.lease, actor_user_id: 'usr_other' } },
  { lease: { ...validProofResponse.lease, warehouse_id: 'wh_other' } },
  { lease: { ...validProofResponse.lease, warehouse_code: 'МСК' } },
]) {
  await assert.rejects(
    _internals.verifyPreparedWarehouseDeleteLease(
      { LICENSE_API_ORIGIN: 'https://license.test' }, proofContractRequest, proofContractData, proofContractAuth,
      async () => new Response(JSON.stringify({ ...validProofResponse, ...mutation }), { status: 200 }),
    ),
    error => error?.code === 'WAREHOUSE_DELETE_LEASE_PREPARED_REQUIRED',
  );
}
await assert.rejects(
  _internals.verifyPreparedWarehouseDeleteLease(
    { LICENSE_API_ORIGIN: 'https://license.test' }, proofContractRequest,
    { ...proofContractData, warehouse_delete_lease_token: 'invalid' }, proofContractAuth,
    async () => { throw new Error('must not fetch'); },
  ),
  error => error?.code === 'WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED',
);
await assert.rejects(
  _internals.verifyPreparedWarehouseDeleteLease(
    { LICENSE_API_ORIGIN: 'https://license.test' }, proofContractRequest, proofContractData, proofContractAuth,
    async () => new Response('not-json', { status: 200 }),
  ),
  error => error?.code === 'WAREHOUSE_DELETE_LEASE_SERVICE_INVALID',
);

const proofAttestationHeaders = {
  'x-justfun-vps-timestamp': '1787443200',
  'x-justfun-vps-nonce': 'nonce-proof-contract-001',
  'x-justfun-vps-signature': `v1=${'a'.repeat(64)}`,
};
const proofAttestationRequest = new Request('https://broker.test/v1/company/telegram-service/deprovision', {
  method: 'POST',
  headers: { authorization: 'Bearer proof-test-token', ...proofAttestationHeaders },
});
const validAttestationResponse = {
  ok: true,
  verified: true,
  active: true,
  prepared: true,
  status: 'prepared',
  company_id: 'cmp_company',
  warehouse_id: 'wh_main',
  warehouse_code: 'СПБ',
  delete_command_id: 'client:test:proof:command:001',
  delete_base_version: 4,
};
const verifiedAttestation = await _internals.verifyVpsWarehouseDeleteAttestation(
  { LICENSE_API_ORIGIN: 'https://license.test' },
  proofAttestationRequest,
  proofContractData,
  proofContractAuth,
  async (url, options) => {
    assert.equal(String(url), 'https://license.test/v1/vps-attestations/verify');
    assert.equal(options.headers.authorization, 'Bearer proof-test-token');
    for (const [name, value] of Object.entries(proofAttestationHeaders)) {
      assert.equal(options.headers[name], value);
    }
    assert.deepEqual(JSON.parse(options.body), {
      company_id: 'cmp_company',
      warehouse_id: 'wh_main',
      warehouse_code: 'СПБ',
      delete_command_id: 'client:test:proof:command:001',
      delete_base_version: 4,
      lease_token: proofContractData.warehouse_delete_lease_token,
    });
    return new Response(JSON.stringify(validAttestationResponse), { status: 200 });
  },
);
assert.deepEqual(verifiedAttestation, {
  companyId: 'cmp_company',
  warehouseId: 'wh_main',
  warehouseCode: 'СПБ',
  deleteCommandId: 'client:test:proof:command:001',
  deleteBaseVersion: 4,
});
assert.equal(JSON.stringify(verifiedAttestation).includes(proofContractData.warehouse_delete_lease_token), false);
assert.equal(JSON.stringify(verifiedAttestation).includes(proofAttestationHeaders['x-justfun-vps-signature']), false);
for (const mutation of [
  { company_id: 'cmp_other' },
  { warehouse_id: 'wh_other' },
  { warehouse_code: 'МСК' },
  { delete_command_id: 'client:test:proof:command:other' },
  { delete_base_version: 5 },
  { prepared: false, status: 'active' },
]) {
  await assert.rejects(
    _internals.verifyVpsWarehouseDeleteAttestation(
      { LICENSE_API_ORIGIN: 'https://license.test' },
      proofAttestationRequest,
      proofContractData,
      proofContractAuth,
      async () => new Response(JSON.stringify({ ...validAttestationResponse, ...mutation }), { status: 200 }),
    ),
    error => error?.code === 'VPS_ATTESTATION_SCOPE_MISMATCH',
  );
}
let missingAttestationFetches = 0;
await assert.rejects(
  _internals.verifyVpsWarehouseDeleteAttestation(
    { LICENSE_API_ORIGIN: 'https://license.test' },
    proofContractRequest,
    proofContractData,
    proofContractAuth,
    async () => { missingAttestationFetches += 1; },
  ),
  error => error?.status === 401 && error?.code === 'VPS_ATTESTATION_REQUIRED',
);
assert.equal(missingAttestationFetches, 0);
await assert.rejects(
  _internals.verifyVpsWarehouseDeleteAttestation(
    { LICENSE_API_ORIGIN: 'https://license.test' },
    new Request('https://broker.test/v1/company/telegram-service/deprovision', {
      method: 'POST',
      headers: {
        authorization: 'Bearer proof-test-token',
        ...proofAttestationHeaders,
        'x-justfun-vps-signature': `v1=${'A'.repeat(64)}`,
      },
    }),
    proofContractData,
    proofContractAuth,
    async () => { throw new Error('must not fetch'); },
  ),
  error => error?.status === 401 && error?.code === 'VPS_ATTESTATION_INVALID',
);

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

function createBrokerDeprovisionDb({ withService = true, operation = null } = {}) {
  let service = withService ? {
    company_id: 'cmp_one',
    warehouse_id: 'wh_main',
    telegram_worker_url: 'https://warehouse.example.workers.dev',
    telegram_client_key_ciphertext: encrypted,
    telegram_installation_id: 'inst-warehouse-01',
  } : null;
  let currentOperation = operation ? { ...operation } : null;
  let auditCount = 0;
  function statement(sql, values = []) {
    const source = String(sql);
    return {
      bind(...nextValues) { return statement(source, nextValues); },
      async first() {
        if (source.includes('broker_rate_limits')) return { hits: 1 };
        if (source.includes('INSERT INTO company_telegram_deprovision_operations')) {
          if (source.includes("'','deprovisioned'")) {
            if (service || currentOperation) return null;
            currentOperation = {
              company_id: values[0], warehouse_id: values[1], warehouse_code: values[2],
              delete_command_id: values[3], delete_base_version: values[4], actor_user_id: values[5],
              lease_id: values[6], operation_id: values[7], installation_id: '', status: 'deprovisioned',
              attempt_count: 1, last_error_code: '', created_at: values[8], updated_at: values[9],
              completed_at: values[10],
            };
            return currentOperation;
          }
          if (!service) return currentOperation;
          if (currentOperation?.status === 'deprovisioned') return null;
          if (currentOperation) {
            if (
              currentOperation.warehouse_code !== values[0]
              || currentOperation.delete_command_id !== values[1]
              || currentOperation.delete_base_version !== values[2]
            ) return currentOperation;
            currentOperation = {
              ...currentOperation,
              status: 'running',
              attempt_count: Number(currentOperation.attempt_count || 0) + 1,
              last_error_code: '',
              updated_at: values[7],
              completed_at: null,
            };
          } else {
            currentOperation = {
              company_id: service.company_id,
              warehouse_id: service.warehouse_id,
              warehouse_code: values[0],
              delete_command_id: values[1],
              delete_base_version: values[2],
              actor_user_id: values[3],
              lease_id: values[4],
              operation_id: values[5],
              installation_id: service.telegram_installation_id,
              status: 'running',
              attempt_count: 1,
              last_error_code: '',
              created_at: values[6],
              updated_at: values[7],
              completed_at: null,
            };
          }
          return currentOperation;
        }
        if (source.includes('FROM company_telegram_deprovision_operations')) return currentOperation;
        if (source.includes('FROM company_telegram_services')) return service;
        return null;
      },
      async run() {
        if (source.includes("SET status='failed'")) {
          if (currentOperation?.status !== 'deprovisioned') {
            currentOperation = {
              ...currentOperation,
              status: 'failed',
              last_error_code: values[0],
              updated_at: values[1],
              completed_at: null,
            };
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (source.includes("SET installation_id=?") && source.includes("status='deprovisioned'")) {
          if (!currentOperation || currentOperation.status === 'deprovisioned') return { meta: { changes: 0 } };
          currentOperation = {
            ...currentOperation,
            installation_id: values[0],
            status: 'deprovisioned',
            last_error_code: '',
            updated_at: values[1],
            completed_at: values[2],
          };
          service = null;
          return { meta: { changes: 1 } };
        }
        if (source.includes('INSERT INTO broker_audit_log')) {
          auditCount += 1;
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 1 } };
      },
    };
  }
  return {
    prepare: sql => statement(sql),
    state: () => ({ service, operation: currentOperation, auditCount }),
  };
}

const ownerAuth = {
  company_id: 'cmp_one', user_id: 'usr_owner', role: 'owner', permissions: [],
};
const deleteProof = {
  warehouse_id: 'wh_main',
  warehouse_code: 'СПБ',
  warehouse_delete_lease_token: `jfdl_${'L'.repeat(48)}`,
  delete_command_id: 'client:test:warehouse:delete:broker',
  delete_base_version: 7,
};
const preparedLeasePayload = {
  ok: true, active: true, prepared: true, status: 'prepared', remaining_seconds: null,
  lease: {
    id: 'wdl_delete_broker_001', company_id: 'cmp_one', warehouse_id: 'wh_main',
    warehouse_code: 'СПБ', actor_user_id: 'usr_owner', status: 'prepared', expires_at: null,
  },
};
let nativeDeprovisionCalls = 0;
let vpsAttestationVerificationCalls = 0;
const deprovisionDb = createBrokerDeprovisionDb();
try {
  globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://license.test/v1/auth/introspect') {
      return new Response(JSON.stringify({
        ok: true,
        active: true,
        user_id: 'usr_owner',
        company_id: 'cmp_one',
        role: 'owner',
        permissions: [],
        company: { id: 'cmp_one' },
        device_id: 'dev_vps',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url) === 'https://license.test/v1/vps-attestations/verify') {
      vpsAttestationVerificationCalls += 1;
      assert.equal(options?.headers?.authorization, 'Bearer prepared-delete-token');
      assert.match(options?.headers?.['x-justfun-vps-timestamp'] || '', /^\d{10,12}$/);
      assert.match(options?.headers?.['x-justfun-vps-nonce'] || '', /^[A-Za-z0-9_-]{16,120}$/);
      assert.match(options?.headers?.['x-justfun-vps-signature'] || '', /^v1=[a-f0-9]{64}$/);
      assert.deepEqual(JSON.parse(options?.body || '{}'), {
        company_id: 'cmp_one',
        warehouse_id: 'wh_main',
        warehouse_code: 'СПБ',
        delete_command_id: 'client:test:warehouse:delete:broker',
        delete_base_version: 7,
        lease_token: deleteProof.warehouse_delete_lease_token,
      });
      return new Response(JSON.stringify({
        ok: true,
        verified: true,
        active: true,
        prepared: true,
        status: 'prepared',
        company_id: 'cmp_one',
        warehouse_id: 'wh_main',
        warehouse_code: 'СПБ',
        delete_command_id: 'client:test:warehouse:delete:broker',
        delete_base_version: 7,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url) === 'https://license.test/v1/warehouse-delete-leases/verify') {
      assert.equal(options?.headers?.authorization, 'Bearer prepared-delete-token');
      assert.deepEqual(JSON.parse(options?.body || '{}'), {
        warehouse_id: 'wh_main', warehouse_code: 'СПБ', lease_token: deleteProof.warehouse_delete_lease_token,
      });
      return new Response(JSON.stringify(preparedLeasePayload), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    assert.equal(String(url), 'https://warehouse.example.workers.dev/v1/deprovision');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.headers?.authorization, `Bearer ${'K'.repeat(48)}`);
    nativeDeprovisionCalls += 1;
    return new Response(JSON.stringify({
      ok: true,
      deprovisioned: true,
      already_deprovisioned: false,
      company_id: 'cmp_one',
      warehouse_id: 'live--wh_main',
      installation_id: 'inst-warehouse-01',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let requestNonce = 0;
  const deprovisionRequest = () => new Request('https://broker.test/v1/company/telegram-service/deprovision', {
    method: 'POST',
    headers: {
      'cf-connecting-ip': '127.0.0.1',
      authorization: 'Bearer prepared-delete-token',
      'x-justfun-vps-timestamp': '1787443200',
      'x-justfun-vps-nonce': `nonce-delete-broker-${String(++requestNonce).padStart(3, '0')}`,
      'x-justfun-vps-signature': `v1=${'b'.repeat(64)}`,
    },
  });
  const directBearerDb = createBrokerDeprovisionDb();
  const directBearerOnly = await worker.fetch(new Request(
    'https://broker.test/v1/company/telegram-service/deprovision',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer prepared-delete-token',
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(deleteProof),
    },
  ), {
    DB: directBearerDb,
    INTEGRATION_SECRET: secret,
    LICENSE_API_ORIGIN: 'https://license.test',
  });
  assert.equal(directBearerOnly.status, 401);
  assert.equal((await directBearerOnly.json()).error, 'VPS_ATTESTATION_REQUIRED');
  assert.equal(directBearerDb.state().operation, null);
  assert.notEqual(directBearerDb.state().service, null);
  assert.equal(nativeDeprovisionCalls, 0);
  const request = deprovisionRequest();
  const first = await _internals.deprovisionCompanyTelegramService(
    { DB: deprovisionDb, INTEGRATION_SECRET: secret, LICENSE_API_ORIGIN: 'https://license.test' },
    request,
    deleteProof,
    'request-one',
    ownerAuth,
  );
  assert.deepEqual(first, {
    ok: true,
    warehouse_id: 'wh_main',
    warehouse_code: 'СПБ',
    delete_command_id: 'client:test:warehouse:delete:broker',
    delete_base_version: 7,
    installation_id: 'inst-warehouse-01',
    deprovisioned: true,
    already_deprovisioned: false,
  });
  assert.equal(JSON.stringify(first).includes('workers.dev'), false);
  assert.equal(JSON.stringify(first).includes('K'.repeat(48)), false);
  assert.equal(JSON.stringify(first).includes(deleteProof.warehouse_delete_lease_token), false);
  assert.equal(JSON.stringify(first).includes(`v1=${'b'.repeat(64)}`), false);
  assert.equal(deprovisionDb.state().service, null);
  assert.equal(deprovisionDb.state().operation.status, 'deprovisioned');
  assert.equal(deprovisionDb.state().auditCount, 1);
  const repeated = await _internals.deprovisionCompanyTelegramService(
    { DB: deprovisionDb, INTEGRATION_SECRET: secret, LICENSE_API_ORIGIN: 'https://license.test' },
    deprovisionRequest(),
    deleteProof,
    'request-two',
    ownerAuth,
  );
  assert.equal(repeated.already_deprovisioned, true);
  assert.equal(nativeDeprovisionCalls, 1);

  const noServiceDb = createBrokerDeprovisionDb({ withService: false });
  const noService = await _internals.deprovisionCompanyTelegramService(
    { DB: noServiceDb, INTEGRATION_SECRET: secret, LICENSE_API_ORIGIN: 'https://license.test' },
    deprovisionRequest(),
    deleteProof,
    'request-no-service',
    ownerAuth,
  );
  assert.deepEqual(noService, {
    ok: true,
    warehouse_id: 'wh_main',
    warehouse_code: 'СПБ',
    delete_command_id: 'client:test:warehouse:delete:broker',
    delete_base_version: 7,
    installation_id: '',
    deprovisioned: true,
    already_deprovisioned: true,
  });
  assert.equal(noServiceDb.state().operation.status, 'deprovisioned');
  assert.equal(JSON.stringify(noServiceDb.state()).includes(deleteProof.warehouse_delete_lease_token), false);
  assert.equal(JSON.stringify(noServiceDb.state()).includes(`v1=${'b'.repeat(64)}`), false);
  assert.equal(nativeDeprovisionCalls, 1);

  const inconsistentDb = createBrokerDeprovisionDb({
    withService: false,
    operation: {
      company_id: 'cmp_one', warehouse_id: 'wh_main', operation_id: 'tgdep_stale',
      warehouse_code: 'СПБ', delete_command_id: 'client:test:warehouse:delete:broker',
      delete_base_version: 7, actor_user_id: 'usr_owner', lease_id: 'wdl_delete_broker_001',
      installation_id: 'inst-warehouse-01', status: 'failed', attempt_count: 1,
      last_error_code: 'TELEGRAM_UPSTREAM_UNAVAILABLE', created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), completed_at: null,
    },
  });
  await assert.rejects(
    _internals.deprovisionCompanyTelegramService(
      { DB: inconsistentDb, INTEGRATION_SECRET: secret, LICENSE_API_ORIGIN: 'https://license.test' },
      deprovisionRequest(),
      deleteProof,
      'request-inconsistent',
      ownerAuth,
    ),
    error => error?.code === 'TELEGRAM_DEPROVISION_RECONCILIATION_REQUIRED',
  );
  await assert.rejects(
    _internals.deprovisionCompanyTelegramService(
      { DB: createBrokerDeprovisionDb(), INTEGRATION_SECRET: secret, LICENSE_API_ORIGIN: 'https://license.test' },
      new Request('https://broker.test/v1/company/telegram-service/deprovision', {
        method: 'POST',
        headers: { authorization: 'Bearer prepared-delete-token' },
      }),
      deleteProof,
      'request-no-attestation',
      ownerAuth,
    ),
    error => error?.status === 401 && error?.code === 'VPS_ATTESTATION_REQUIRED',
  );
  assert.equal(nativeDeprovisionCalls, 1);
  await assert.rejects(
    _internals.deprovisionCompanyTelegramService(
      { DB: createBrokerDeprovisionDb(), INTEGRATION_SECRET: secret },
      request,
      { warehouse_id: 'wh_main' },
      'request-denied',
      { company_id: 'cmp_one', user_id: 'usr_manager', role: 'manager', permissions: ['warehouses.manage', 'jf.warehouse:wh_main'] },
    ),
    error => error?.status === 403 && error?.code === 'ACCESS_BLOCKED',
  );
  assert.equal(vpsAttestationVerificationCalls, 4);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Company Telegram broker unit tests: PASS');
