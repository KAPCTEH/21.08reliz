#!/usr/bin/env node

const origin = String(process.argv[2] || 'https://justfun-license-api.l2maloy47rus.workers.dev').replace(/\/+$/, '');
const checks = [
  { method: 'GET', path: '/health', expected: [200], code: null, authContract: 5, warehouseDeleteLeaseContract: 3 },
  { method: 'GET', path: '/v1/health', expected: [200], code: null, authContract: 5, warehouseDeleteLeaseContract: 3 },
  { method: 'POST', path: '/v1/license/check', expected: [400], code: 'LICENSE_KEY_REQUIRED', body: {} },
  { method: 'POST', path: '/v1/auth/introspect', expected: [401], code: 'INVALID_TOKEN', body: {} },
  { method: 'GET', path: '/v1/invitations', expected: [401], code: 'INVALID_TOKEN' },
  { method: 'PATCH', path: '/v1/invitations/unit/revoke', expected: [401], code: 'INVALID_TOKEN', body: {} },
  { method: 'PUT', path: '/v1/company/data-service', expected: [401], code: 'INVALID_TOKEN', body: {} },
  { method: 'PUT', path: '/v1/company/telegram-service', expected: [401], code: 'INVALID_TOKEN', body: {} },
  { method: 'GET', path: '/v1/company/telegram/status', expected: [401], code: 'INVALID_TOKEN' },
  { method: 'POST', path: '/v1/company/telegram/send', expected: [401], code: 'INVALID_TOKEN', body: {} },
  { method: 'POST', path: '/v1/warehouse-delete-leases/acquire', expected: [401], code: 'INVALID_TOKEN', body: {} },
  { method: 'POST', path: '/v1/warehouse-delete-leases/prepare', expected: [401], code: 'INVALID_TOKEN', body: {} },
  { method: 'POST', path: '/v1/warehouse-delete-leases/verify', expected: [401], code: 'INVALID_TOKEN', body: {} },
  { method: 'POST', path: '/v1/warehouse-delete-leases/release', expected: [401], code: 'INVALID_TOKEN', body: {} },
  { method: 'POST', path: '/v1/vps-attestations/verify', expected: [400], code: 'VPS_ATTESTATION_INVALID', body: {} },
  { method: 'POST', path: '/v1/vps-attestations/release-warehouse-delete', expected: [400], code: 'VPS_ATTESTATION_INVALID', body: {} },
  { method: 'PATCH', path: '/v1/users/preflight/access', expected: [401], code: 'INVALID_TOKEN', body: {} },
];

const results = [];
for (const check of checks) {
  let status = 0;
  let payload = {};
  let error = '';
  try {
    const response = await fetch(`${origin}${check.path}`, {
      method: check.method,
      headers: check.body ? { 'content-type': 'application/json' } : {},
      body: check.body ? JSON.stringify(check.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    status = response.status;
    try { payload = await response.json(); }
    catch { error = 'INVALID_JSON'; }
  } catch (requestError) {
    error = String(requestError?.message || requestError);
  }
  const ok = check.expected.includes(status)
    && !error
    && (check.code === null ? payload?.ok === true : payload?.error === check.code)
    && (check.authContract ? Number(payload?.auth_contract) === check.authContract : true)
    && (check.warehouseDeleteLeaseContract
      ? Number(payload?.warehouse_delete_lease_contract) === check.warehouseDeleteLeaseContract
      : true);
  results.push({
    method: check.method,
    path: check.path,
    status,
    error: error || null,
    server_error: payload?.error || null,
    auth_contract: payload?.auth_contract ?? null,
    warehouse_delete_lease_contract: payload?.warehouse_delete_lease_contract ?? null,
    ok,
  });
}

const report = {
  origin,
  checked_at: new Date().toISOString(),
  ok: results.every(result => result.ok),
  results,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 2;
