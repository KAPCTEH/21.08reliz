import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { _internals } from '../source/license-server/worker.mjs';

const workerSource = fs.readFileSync(new URL('../source/license-server/worker.mjs', import.meta.url), 'utf8');
const acceptInvitationSource = workerSource.slice(
  workerSource.indexOf('async function acceptInvitation('),
  workerSource.indexOf('async function listUsers('),
);
assert.equal(
  (acceptInvitationSource.match(/id\('ses'\)/g) || []).length,
  1,
  'invitation acceptance must create exactly one session id',
);
assert.match(
  acceptInvitationSource,
  /INSERT INTO sessions[\s\S]*?\.bind\(sessionId,[\s\S]*?return issueTokenSet\(env, user, deviceId, sessionId,/,
  'the stored session id must be passed unchanged to issueTokenSet',
);

const invitation = {
  id: 'inv_accept_test',
  company_id: 'cmp_accept_test',
  company_code: 'JFACCEPT1',
  company_name: 'Invitation acceptance test',
  company_status: 'active',
  license_status: 'active',
  login: 'employee.accept',
  full_name: 'Invitation Employee',
  role: 'Сотрудник склада',
  permissions_json: '["orders.read","jf.warehouse:wh_accept_test"]',
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  revoked_at: null,
  already_used: 0,
};

const batchedStatements = [];
const auditStatements = [];
const db = {
  prepare(sql) {
    return {
      bind(...args) {
        const statement = {
          sql,
          args,
          async first() {
            if (/INSERT INTO rate_limits/.test(sql)) return { hits: 1 };
            if (/FROM invitations i JOIN companies/.test(sql)) return invitation;
            throw new Error(`Unexpected first(): ${sql}`);
          },
          async run() {
            if (/INSERT INTO audit_log/.test(sql)) {
              auditStatements.push(statement);
              return { meta: { changes: 1 } };
            }
            throw new Error(`Unexpected run(): ${sql}`);
          },
        };
        return statement;
      },
    };
  },
  async batch(statements) {
    batchedStatements.push(...statements);
    return statements.map(() => ({ meta: { changes: 1 } }));
  },
};

const env = {
  DB: db,
  JWT_SECRET: 'JustFun-invitation-test-secret-longer-than-thirty-two-characters',
};
const response = await worker.fetch(new Request('https://license.test/v1/invitations/accept', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.44',
  },
  body: JSON.stringify({
    invitation_code: 'JFI-TEST-ACCEPT',
    password: 'InvitationPassword783',
    device_id: 'invitation-device-test',
    device_name: 'Invitation test device',
  }),
}), env);

assert.equal(response.status, 200, 'invitation acceptance must not return INTERNAL_ERROR');
const result = await response.json();
assert.equal(result.ok, true);
assert.match(result.session_id, /^ses_[a-f0-9]{32}$/);
assert.equal(typeof result.access_token, 'string');
assert.equal(typeof result.offline_token, 'string');
assert.equal(typeof result.refresh_token, 'string');

const sessionStatements = batchedStatements.filter(statement => /INSERT INTO sessions/.test(statement.sql));
assert.equal(sessionStatements.length, 1, 'exactly one session must be inserted');
const [storedSessionId, storedCompanyId, storedUserId, storedDeviceId] = sessionStatements[0].args;
assert.equal(storedSessionId, result.session_id);
assert.equal(storedCompanyId, invitation.company_id);
assert.equal(storedUserId, result.user_id);
assert.equal(storedDeviceId, result.device_id);

const accessClaims = await _internals.verifyJwt(env, result.access_token, 'access');
const offlineClaims = await _internals.verifyJwt(env, result.offline_token, 'offline');
assert.equal(accessClaims.sid, storedSessionId);
assert.equal(offlineClaims.sid, storedSessionId);
assert.equal(auditStatements.length, 1);
assert.equal(auditStatements[0].args[3], 'invitation.accept');

console.log(JSON.stringify({
  ok: true,
  invitationAccepted: true,
  sessionInsertedOnce: true,
  sessionIdBoundToTokens: true,
}));
