import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const runtime = path.join(root, 'tests', 'runtime-smoke.mjs');
const webRoot = path.join(root, 'source', 'application', 'web');
const roles = ['owner', 'admin', 'manager', 'logistician', 'warehouse', 'viewer'];
const outputLimit = 12 * 1024 * 1024;

function runRole(role) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runtime, webRoot, 'role-matrix'], {
      cwd: root,
      env: { ...process.env, JF_TEST_EDITION: 'full', JF_TEST_ROLE: role, JF_TEST_DATA_SERVICE_DISABLED: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const append = (current, chunk) => {
      const next = current + chunk.toString('utf8');
      if (next.length > outputLimit) child.kill();
      return next;
    };
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.on('error', reject);
    child.on('close', code => {
      try {
        assert.ok(stdout.length <= outputLimit && stderr.length <= outputLimit, `${role}: runtime output exceeded the safety limit`);
        assert.equal(code, 0, `${role}: role-matrix failed\n${stderr}\n${stdout.slice(-4000)}`);
        const report = JSON.parse(stdout);
        assert.equal(report?.roleMatrix?.role, role, `${role}: wrong role in report`);
        assert.deepEqual(report?.roleMatrix?.failures, [], `${role}: role access failures`);
        assert.deepEqual(report?.errors, [], `${role}: runtime errors`);
        resolve({ role, visibleTabs: report.roleMatrix.visibleTabs.length, probes: report.roleMatrix.probes.length });
      } catch (error) {
        reject(error);
      }
    });
  });
}

const results = await Promise.all(roles.map(runRole));
console.log(JSON.stringify({ ok: true, roles: results }, null, 2));
