import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { _internals } from '../source/license-server/worker.mjs';

const exactPermissions = ['orders.read', 'orders.update', 'jf.warehouse:wh_exact'];
assert.deepEqual(
  _internals.permissionsForRole('Редактор заказов', exactPermissions),
  exactPermissions,
);
assert.equal(
  _internals.permissionsForRole('Редактор заказов', exactPermissions).includes('orders.delete'),
  false,
);

const password = 'ExactPermissions783';
const passwordRecord = await _internals.hashPassword(password);
const company = {
  company_id: 'cmp_exact_permissions',
  company_code: 'JFEXACT',
  company_name: 'Exact permissions company',
  company_status: 'active',
  license_status: 'active',
};
const ownerRow = {
  ...company,
  id: 'usr_exact_owner',
  login: 'exact.owner',
  full_name: 'Exact Owner',
  role: 'owner',
  permissions_json: '["*"]',
  status: 'active',
};
const employeeRow = {
  ...company,
  id: 'usr_exact_employee',
  login: 'exact.employee',
  full_name: 'Exact Employee',
  role: 'Редактор заказов',
  // Simulate an account created while the runtime bug still added delete.
  // PATCH /access below must replace this with the owner's exact selection.
  permissions_json: '["orders.read","orders.update","orders.delete","jf.warehouse:wh_exact"]',
  password_salt: passwordRecord.salt,
  password_hash: passwordRecord.hash,
  password_iterations: passwordRecord.iterations,
  status: 'active',
};
const deviceValue = 'exact-permissions-device';
const deviceId = 'dev_exact_permissions';
const deviceHash = await _internals.sha256(deviceValue);
const future = () => new Date(Date.now() + 86_400_000).toISOString();
let currentEmployeeSession = null;
let invitationPermissions = null;
let accessPermissions = null;

function activeAuthRow(row) {
  return {
    ...row,
    device_status: 'active',
    session_status: 'active',
    session_expires: future(),
  };
}

const db = {
  prepare(sql) {
    return {
      sql,
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() {
        if (sql.includes('INSERT INTO rate_limits')) return { hits: 1 };
        if (sql.includes('JOIN sessions s ON s.id=?')) {
          return activeAuthRow(this.args[2] === ownerRow.id ? ownerRow : employeeRow);
        }
        if (sql.includes('FROM users u JOIN companies c') && sql.includes('WHERE c.code=?')) {
          return employeeRow;
        }
        if (sql.includes('SELECT * FROM devices WHERE user_id=?')) {
          return { id: deviceId, status: 'active', device_hash: deviceHash };
        }
        if (sql.includes('FROM sessions s') && sql.includes('WHERE s.refresh_hash=?')) {
          assert.ok(currentEmployeeSession, 'login must create a refreshable session first');
          return {
            ...employeeRow,
            session_id: currentEmployeeSession.id,
            session_status: 'active',
            session_created: currentEmployeeSession.createdAt,
            session_expires: currentEmployeeSession.expiresAt,
            device_id: deviceId,
            device_hash: deviceHash,
            device_status: 'active',
          };
        }
        if (sql.includes('SELECT 1 found FROM users WHERE company_id=?')) return null;
        if (sql.includes('SELECT 1 found FROM invitations i')) return null;
        if (sql.includes('SELECT role,permissions_json FROM users WHERE id=?')) {
          return { role: employeeRow.role, permissions_json: employeeRow.permissions_json };
        }
        throw new Error(`Unexpected first(): ${sql}`);
      },
      async run() {
        if (sql.includes('INSERT INTO invitations')) {
          invitationPermissions = JSON.parse(this.args[6]);
          return { meta: { changes: 1 } };
        }
        if (sql.includes('UPDATE users SET role=?,permissions_json=?')) {
          employeeRow.role = this.args[0];
          employeeRow.permissions_json = this.args[1];
          accessPermissions = JSON.parse(this.args[1]);
          return { meta: { changes: 1 } };
        }
        if (sql.includes('INSERT INTO sessions') && sql.includes('FROM users u')) {
          currentEmployeeSession = {
            id: this.args[0],
            createdAt: this.args[3],
            expiresAt: this.args[4],
          };
          return { meta: { changes: 1 } };
        }
        if (sql.includes('UPDATE devices SET device_name=')) return { meta: { changes: 1 } };
        if (sql.includes('INSERT INTO audit_log')) return { meta: { changes: 1 } };
        throw new Error(`Unexpected run(): ${sql}`);
      },
    };
  },
  async batch(statements) {
    if (statements[0]?.sql.includes('INSERT INTO sessions') && statements[0]?.sql.includes('FROM sessions s')) {
      currentEmployeeSession = {
        id: statements[0].args[0],
        createdAt: statements[0].args[2],
        expiresAt: statements[0].args[3],
      };
      return statements.map(() => ({ meta: { changes: 1 } }));
    }
    throw new Error(`Unexpected batch(): ${statements[0]?.sql || ''}`);
  },
};

const env = {
  DB: db,
  JWT_SECRET: 'JustFun-exact-permissions-test-secret-longer-than-thirty-two-characters',
};
const ownerToken = await _internals.signJwt(env, {
  typ: 'access',
  sub: ownerRow.id,
  cid: ownerRow.company_id,
  did: 'dev_exact_owner',
  sid: 'ses_exact_owner',
}, 60);
const ownerHeaders = {
  authorization: `Bearer ${ownerToken}`,
  'content-type': 'application/json',
};

const invitationResponse = await worker.fetch(new Request('https://license.test/v1/users/invite', {
  method: 'POST',
  headers: ownerHeaders,
  body: JSON.stringify({
    full_name: 'Invited Exact Employee',
    login: 'invited.exact',
    role: 'Редактор заказов',
    permissions: exactPermissions,
  }),
}), env);
assert.equal(invitationResponse.status, 200);
const invitation = await invitationResponse.json();
assert.deepEqual(invitation.invitation.permissions, exactPermissions);
assert.deepEqual(invitationPermissions, exactPermissions);
assert.equal(invitationPermissions.includes('orders.delete'), false);

const accessResponse = await worker.fetch(new Request(
  `https://license.test/v1/users/${employeeRow.id}/access`,
  {
    method: 'PATCH',
    headers: ownerHeaders,
    body: JSON.stringify({ role: employeeRow.role, permissions: exactPermissions }),
  },
), env);
assert.equal(accessResponse.status, 200);
const access = await accessResponse.json();
assert.deepEqual(access.permissions, exactPermissions);
assert.deepEqual(accessPermissions, exactPermissions);
assert.equal(accessPermissions.includes('orders.delete'), false);

const loginResponse = await worker.fetch(new Request('https://license.test/v1/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.50' },
  body: JSON.stringify({
    company_code: company.company_code,
    login: employeeRow.login,
    password,
    device_id: deviceValue,
    device_name: 'Exact permissions test device',
  }),
}), env);
assert.equal(loginResponse.status, 200);
const login = await loginResponse.json();
assert.deepEqual(login.permissions, exactPermissions);
assert.deepEqual(login.user.permissions, exactPermissions);
assert.equal(login.permissions.includes('orders.delete'), false);

const loginAccessClaims = await _internals.verifyJwt(env, login.access_token, 'access');
const loginOfflineClaims = await _internals.verifyJwt(env, login.offline_token, 'offline');
assert.deepEqual(loginAccessClaims.permissions, exactPermissions);
assert.deepEqual(loginOfflineClaims.permissions, exactPermissions);

const refreshResponse = await worker.fetch(new Request('https://license.test/v1/auth/refresh', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.50' },
  body: JSON.stringify({ refresh_token: login.refresh_token, device_id: deviceValue }),
}), env);
assert.equal(refreshResponse.status, 200);
const refresh = await refreshResponse.json();
assert.deepEqual(refresh.permissions, exactPermissions);
assert.deepEqual(refresh.user.permissions, exactPermissions);
assert.equal(refresh.permissions.includes('orders.delete'), false);

const introspectionResponse = await worker.fetch(new Request('https://license.test/v1/auth/introspect', {
  method: 'POST',
  headers: { authorization: `Bearer ${refresh.access_token}` },
}), env);
assert.equal(introspectionResponse.status, 200);
const introspection = await introspectionResponse.json();
assert.deepEqual(introspection.permissions, exactPermissions);
assert.deepEqual(introspection.user.permissions, exactPermissions);
assert.equal(introspection.permissions.includes('orders.delete'), false);

const mainSource = fs.readFileSync(new URL('../source/application/main.js', import.meta.url), 'utf8');
const desktopSource = fs.readFileSync(
  new URL('../source/application/web/assets/js/110-desktop-platform-v750.js', import.meta.url),
  'utf8',
);
assert.match(mainSource, /permissions:normalizedPermissions\(permissions\)/);
assert.match(mainSource, /permissions:permissionLists\[0\]/);
assert.match(desktopSource, /return exactPermissionList\(user\.permissions\)/);

console.log(JSON.stringify({
  ok: true,
  invitationExact: true,
  accessUpdateExact: true,
  loginExact: true,
  refreshExact: true,
  introspectionExact: true,
  desktopContextExact: true,
  destructivePermissionNotInferred: true,
}));
