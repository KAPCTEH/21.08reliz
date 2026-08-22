'use strict';

const assert = require('assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createUpdatePlan } = require('../source/application/update/plan.cjs');
const { sha256, verifiedHelperCopy, runHelperPhase } = require('../source/application/update/helper-runner.cjs');

let checks = 0;
function checked(action) { action(); checks += 1; }

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'justfun-helper-runner-'));
  try {
    const installRoot = path.join(root, 'Program');
    const updateRoot = path.join(root, 'Local', 'Update');
    fs.mkdirSync(installRoot, { recursive: true });
    const installedHelper = path.join(installRoot, 'JustFun-UpdateHelper.exe');
    fs.writeFileSync(installedHelper, Buffer.from('MZJustFun test helper'));
    const identity = { schema_version: 1, file_name: 'JustFun-UpdateHelper.exe', bytes: fs.statSync(installedHelper).size, sha256: sha256(installedHelper) };
    const copied = verifiedHelperCopy({ installedHelper, identity, updateRoot });
    checked(() => assert.equal(fs.existsSync(copied), true));
    checked(() => assert.equal(sha256(copied), identity.sha256));
    checked(() => assert.equal(verifiedHelperCopy({ installedHelper, identity, updateRoot }), copied));
    fs.appendFileSync(installedHelper, 'tampered');
    checked(() => assert.throws(() => verifiedHelperCopy({ installedHelper, identity, updateRoot }), error => error?.code === 'UPDATE_HELPER_TAMPERED'));

    const operation = 'operation-00000001';
    const catalog = { release: { payload: { file_name: 'JustFun-7.9.0-win-x64.zip' } }, signature: { algorithm: 'Ed25519', key_id: 'test', value: 'x' } };
    const created = createUpdatePlan({ operationId: operation, fromVersion: '7.8.3', installRoot, updateRoot, catalog, sourcePid: 0, healthTimeoutSeconds: 120, now: new Date('2026-08-22T12:00:00.000Z') });
    checked(() => assert.equal(created.plan.staging_root, `${path.resolve(installRoot)}.__justfun_update_stage__`));
    checked(() => assert.equal(created.plan.previous_root, `${path.resolve(installRoot)}.__justfun_update_previous__`));
    checked(() => assert.equal(created.plan.archive_path, path.join(path.resolve(updateRoot), 'downloads', 'JustFun-7.9.0-win-x64.zip')));
    checked(() => assert.equal(created.plan.from_version, '7.8.3'));
    checked(() => assert.equal(JSON.parse(fs.readFileSync(created.planFile, 'utf8')).operation_id, operation));

    const calls = [];
    function spawnPrepare(executable, args, options) {
      calls.push({ executable, args, options });
      const child = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    }
    const prepared = await runHelperPhase({ helperPath: copied, operationId: operation, phase: 'prepare', spawnImpl: spawnPrepare, timeoutMs: 30_000 });
    checked(() => assert.equal(prepared.exitCode, 0));
    checked(() => assert.deepEqual(calls[0].args, ['--prepare', `--operation=${operation}`]));
    checked(() => assert.equal(calls[0].options.shell, false));

    let unrefCalled = false;
    function spawnApply(executable, args, options) {
      calls.push({ executable, args, options });
      return { pid: 42, unref: () => { unrefCalled = true; } };
    }
    const applied = await runHelperPhase({ helperPath: copied, operationId: operation, phase: 'apply', spawnImpl: spawnApply });
    checked(() => assert.equal(applied.pid, 42));
    checked(() => assert.equal(unrefCalled, true));
    checked(() => assert.equal(calls[1].options.detached, true));
    checked(() => assert.throws(() => runHelperPhase({ helperPath: copied, operationId: operation, phase: 'shell', spawnImpl: spawnApply }), error => error?.code === 'UPDATE_HELPER_PHASE'));

    process.stdout.write(`${JSON.stringify({ ok: true, checks })}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
