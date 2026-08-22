'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canonicalBytes } = require('../source/application/update/canonical-json.cjs');
const { signingDocument } = require('../source/application/update/catalog.cjs');
const { UpdateController } = require('../source/application/update/controller.cjs');

let checks = 0;
function checked(action) { action(); checks += 1; }

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const trustStore = { schema_version: 1, keys: [{
  key_id: 'controller-unit-key', algorithm: 'Ed25519', status: 'active',
  public_key_spki_base64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
}] };
const now = new Date('2026-08-22T12:00:00.000Z');
const policy = {
  schema_version: 1, enabled: true,
  catalog_endpoints: { internal: null, staging: null, stable: 'https://catalog.justfun.invalid/stable.json' },
  allowed_catalog_hosts: ['catalog.justfun.invalid'],
  allowed_payload_hosts: ['downloads.justfun.invalid'],
  allowed_release_notes_hosts: ['releases.justfun.invalid'],
  max_catalog_bytes: 262144, max_payload_bytes: 2_000_000_000,
  download_timeout_seconds: 60, max_download_attempts: 3,
};

function catalog(version = '7.9.0', sequence = 1, rollout = 100) {
  const value = {
    schema_version: 1, product_id: 'justfun-logistics', channel: 'stable', catalog_sequence: sequence,
    generated_at: '2026-08-22T11:00:00.000Z', expires_at: '2026-08-29T11:00:00.000Z',
    release: {
      version, build_id: `jf-${version}-0123456789abcdef0123456789abcdef01234567`,
      commit_sha: '0123456789abcdef0123456789abcdef01234567', published_at: '2026-08-22T10:00:00.000Z',
      minimum_supported_version: '7.8.3', mandatory_after: null, rollout_percent: rollout,
      release_notes_url: `https://releases.justfun.invalid/${version}`,
      required_contracts: { reg_api: 3, license_auth: 4, telegram_broker: 1, storage_protocol: 3 },
      payload: { file_name: `JustFun-${version}-win-x64.zip`, url: `https://downloads.justfun.invalid/JustFun-${version}-win-x64.zip`, bytes: 123, sha256: 'a'.repeat(64), unpacked_bytes: 456, file_count: 7, file_manifest_sha256: 'b'.repeat(64) },
    },
    signature: { algorithm: 'Ed25519', key_id: 'controller-unit-key', value: '' },
  };
  value.signature.value = crypto.sign(null, canonicalBytes(signingDocument(value)), privateKey).toString('base64');
  return value;
}

function options(root, overrides = {}) {
  return {
    productId: 'justfun-logistics', currentVersion: '7.8.3', channel: 'stable',
    currentCommitSha: 'fedcba9876543210fedcba9876543210fedcba98',
    availableContracts: { reg_api: 3, license_auth: 4, telegram_broker: 1, storage_protocol: 3 },
    policy, trustStore, rootDirectory: root, installationId: 'controller-installation-01', now: () => now,
    installRoot: path.join(root, 'Program'),
    prepareUpdate: async () => ({ prepared: true }),
    applyUpdate: async () => ({ started: true }),
    ...overrides,
  };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'justfun-controller-'));
  const failureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'justfun-controller-failure-'));
  try {
    const statuses = [];
    const controller = new UpdateController(options(root, {
      fetchCatalog: async () => catalog(),
      downloadPayload: async input => ({ path: input.destination, bytes: 123, sha256: 'a'.repeat(64), attempts: 1, reused: false }),
      onStatus: status => statuses.push(status),
    }));
    const available = await controller.check();
    checked(() => assert.equal(available.ok, true));
    checked(() => assert.equal(available.updateAvailable, true));
    checked(() => assert.equal(controller.status().state, 'UPDATE_AVAILABLE'));
    checked(() => assert.equal(fs.existsSync(path.join(root, 'Update', 'catalog-state.json')), true));
    checked(() => assert.equal(fs.readdirSync(path.join(root, 'Update', 'catalogs')).length, 1));
    const downloaded = await controller.download();
    checked(() => assert.equal(downloaded.ok, true));
    checked(() => assert.equal(controller.status().state, 'READY_TO_APPLY'));
    checked(() => assert.ok(statuses.length >= 2));
    const applied = await controller.apply();
    checked(() => assert.equal(applied.scheduled, true));
    checked(() => assert.equal(controller.status().state, 'APPLYING'));

    const restarted = new UpdateController(options(root, { fetchCatalog: async () => { throw new Error('not expected'); } }));
    checked(() => assert.deepEqual(restarted.startupRecovery(), { action: 'rollback', state: 'APPLYING' }));
    checked(() => assert.equal(restarted.status().targetVersion, '7.9.0'));
    const helperStateFile = path.join(root, 'Update', 'helper-state.json');
    fs.writeFileSync(helperStateFile, `${JSON.stringify({ schema_version: 1, operation_id: applied.operationId, phase: 'AWAITING_HEALTH_CONFIRMATION', updated_at: now.toISOString(), message: null }, null, 2)}\n`, 'utf8');
    const updatedApplication = new UpdateController(options(root, { currentVersion: '7.9.0' }));
    const confirmation = updatedApplication.confirmHealth(applied.operationId);
    checked(() => assert.equal(confirmation.ok, true));
    checked(() => assert.equal(fs.existsSync(path.join(root, 'Update', 'health', `${applied.operationId}.json`)), true));
    fs.writeFileSync(helperStateFile, `${JSON.stringify({ schema_version: 1, operation_id: applied.operationId, phase: 'CONFIRMED', updated_at: now.toISOString(), message: null }, null, 2)}\n`, 'utf8');
    checked(() => assert.equal(updatedApplication.reconcileHelperState().state, 'CONFIRMED'));

    const disabled = new UpdateController(options(path.join(root, 'disabled'), { policy: { ...policy, enabled: false }, fetchCatalog: async () => { throw new Error('must not fetch'); } }));
    const disabledResult = await disabled.check();
    checked(() => assert.equal(disabledResult.code, 'UPDATE_DISABLED'));

    const current = new UpdateController(options(path.join(root, 'current'), { fetchCatalog: async () => catalog('7.8.3') }));
    const currentResult = await current.check();
    checked(() => assert.equal(currentResult.reason, 'current'));
    checked(() => assert.equal(current.status().state, 'IDLE'));

    const rollout = new UpdateController(options(path.join(root, 'rollout'), { fetchCatalog: async () => catalog('7.9.0', 1, 0) }));
    const rolloutResult = await rollout.check();
    checked(() => assert.equal(rolloutResult.reason, 'rollout'));

    const failing = new UpdateController(options(failureRoot, {
      fetchCatalog: async () => catalog(),
      downloadPayload: async () => { throw Object.assign(new Error('network unavailable'), { code: 'UPDATE_DOWNLOAD_NETWORK' }); },
    }));
    await failing.check();
    const failed = await failing.download();
    checked(() => assert.equal(failed.ok, false));
    checked(() => assert.equal(failed.code, 'UPDATE_DOWNLOAD_NETWORK'));
    checked(() => assert.equal(failing.status().state, 'FAILED'));
    checked(() => assert.equal(failing.status().error.message, 'network unavailable'));

    const retry = new UpdateController(options(failureRoot, {
      fetchCatalog: async () => catalog(),
      downloadPayload: async input => ({ path: input.destination, bytes: 123, sha256: 'a'.repeat(64), attempts: 1 }),
    }));
    const retryCheck = await retry.check();
    checked(() => assert.equal(retryCheck.updateAvailable, true));
    checked(() => assert.equal(retry.status().state, 'UPDATE_AVAILABLE'));
    checked(() => assert.equal(fs.readdirSync(path.join(failureRoot, 'Update', 'history')).length, 1));

    process.stdout.write(`${JSON.stringify({ ok: true, checks })}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(failureRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
