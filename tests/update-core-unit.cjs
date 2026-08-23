'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canonicalize, canonicalBytes } = require('../source/application/update/canonical-json.cjs');
const { compareSemver, parseSemver } = require('../source/application/update/semver.cjs');
const { signingDocument, rolloutBucket, validateSignedCatalog } = require('../source/application/update/catalog.cjs');
const { assertNoSecrets, UpdateJournal } = require('../source/application/update/journal.cjs');

let checks = 0;
function checked(action) { action(); checks += 1; }
function expectCode(code, action) {
  assert.throws(action, error => error?.code === code, `Expected ${code}`);
  checks += 1;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const trustStore = {
  schema_version: 1,
  keys: [{
    key_id: 'unit-release-key',
    algorithm: 'Ed25519',
    status: 'active',
    public_key_spki_base64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }],
};
const now = new Date('2026-08-22T12:00:00.000Z');
const options = {
  now,
  productId: 'justfun-logistics',
  allowedChannels: ['stable'],
  allowedPayloadHosts: ['downloads.justfun.invalid'],
  allowedReleaseNotesHosts: ['releases.justfun.invalid'],
  trustStore,
  availableContracts: { reg_api: 3, license_auth: 4, telegram_broker: 1, storage_protocol: 3, address_search: 1 },
  currentVersion: '7.8.3',
  previousSequence: 40,
  installationId: 'unit-installation-01',
};

function unsignedCatalog() {
  return {
    schema_version: 1,
    product_id: 'justfun-logistics',
    channel: 'stable',
    catalog_sequence: 41,
    generated_at: '2026-08-22T11:00:00.000Z',
    expires_at: '2026-08-29T11:00:00.000Z',
    directive: { mode: 'release', withdrawn_build_ids: [], rollback_from_versions: [], message: null },
    release: {
      version: '7.9.0',
      build_id: 'jf-7.9.0-0123456789abcdef0123456789abcdef01234567',
      commit_sha: '0123456789abcdef0123456789abcdef01234567',
      published_at: '2026-08-22T10:00:00.000Z',
      minimum_supported_version: '7.8.3',
      mandatory_after: null,
      rollout_percent: 100,
      summary: 'Улучшена надёжность обновления.',
      release_notes_url: 'https://releases.justfun.invalid/7.9.0',
      required_contracts: { reg_api: 3, license_auth: 4, telegram_broker: 1, storage_protocol: 3, address_search: 1 },
      payload: {
        file_name: 'JustFun-7.9.0-win-x64.zip',
        url: 'https://downloads.justfun.invalid/JustFun-7.9.0-win-x64.zip',
        bytes: 123456,
        sha256: 'a'.repeat(64),
        unpacked_bytes: 654321,
        file_count: 42,
        file_manifest_sha256: 'b'.repeat(64),
      },
    },
    signature: { algorithm: 'Ed25519', key_id: 'unit-release-key', value: '' },
  };
}

function signedCatalog(mutator) {
  const catalog = unsignedCatalog();
  if (mutator) mutator(catalog);
  catalog.signature.value = crypto.sign(null, canonicalBytes(signingDocument(catalog)), privateKey).toString('base64');
  return catalog;
}

checked(() => assert.equal(canonicalize({ z: 1, a: { y: 2, x: 'тест' } }), '{"a":{"x":"тест","y":2},"z":1}'));
checked(() => assert.throws(() => canonicalize({ bad: '\uD800' }), /unpaired high surrogate/));
checked(() => assert.equal(compareSemver('7.10.0', '7.9.9'), 1));
checked(() => assert.equal(compareSemver('8.0.0-rc.2', '8.0.0-rc.10'), -1));
checked(() => assert.equal(compareSemver('8.0.0', '8.0.0-rc.10'), 1));
expectCode('UPDATE_VERSION_INVALID', () => parseSemver('01.2.3'));
expectCode('UPDATE_VERSION_INVALID', () => parseSemver('999999999999999999999.0.0'));

const valid = signedCatalog();
const validation = validateSignedCatalog(valid, options);
checked(() => assert.equal(validation.updateAvailable, true));
checked(() => assert.equal(validation.rolloutEligible, true));
checked(() => assert.equal(validation.directive.mode, 'release'));
checked(() => assert.equal(validation.rollbackRecommended, false));
checked(() => assert.equal(validation.keyId, 'unit-release-key'));
checked(() => assert.equal(validation.canonical.equals(canonicalBytes(signingDocument(valid))), true));

const tampered = clone(valid);
tampered.release.version = '7.9.1';
expectCode('UPDATE_SIGNATURE_INVALID', () => validateSignedCatalog(tampered, options));
expectCode('UPDATE_SIGNATURE_FORMAT', () => validateSignedCatalog({ ...valid, signature: { ...valid.signature, value: `${valid.signature.value.slice(0, -2)}??` } }, options));
expectCode('UPDATE_KEY_UNKNOWN', () => validateSignedCatalog({ ...valid, signature: { ...valid.signature, key_id: 'unknown' } }, options));
expectCode('UPDATE_KEY_REVOKED', () => validateSignedCatalog(valid, { ...options, trustStore: { ...trustStore, keys: [{ ...trustStore.keys[0], status: 'revoked' }] } }));
expectCode('UPDATE_CATALOG_EXPIRED', () => validateSignedCatalog(signedCatalog(c => { c.generated_at = '2026-08-20T00:00:00.000Z'; c.expires_at = '2026-08-21T00:00:00.000Z'; }), options));
expectCode('UPDATE_CATALOG_FUTURE', () => validateSignedCatalog(signedCatalog(c => { c.generated_at = '2026-08-23T00:00:00.000Z'; c.expires_at = '2026-08-30T00:00:00.000Z'; }), options));
expectCode('UPDATE_PRODUCT_MISMATCH', () => validateSignedCatalog(signedCatalog(c => { c.product_id = 'foreign-product'; }), options));
expectCode('UPDATE_CHANNEL_REJECTED', () => validateSignedCatalog(signedCatalog(c => { c.channel = 'internal'; }), options));
expectCode('UPDATE_URL_INVALID', () => validateSignedCatalog(signedCatalog(c => { c.release.payload.url = 'http://downloads.justfun.invalid/file.zip'; }), options));
expectCode('UPDATE_URL_INVALID', () => validateSignedCatalog(signedCatalog(c => { c.release.payload.url = 'https://downloads.justfun.invalid:444/file.zip'; }), options));
expectCode('UPDATE_URL_HOST', () => validateSignedCatalog(signedCatalog(c => { c.release.payload.url = 'https://attacker.invalid/file.zip'; }), options));
expectCode('UPDATE_CONTRACT_MISMATCH', () => validateSignedCatalog(signedCatalog(c => { c.release.required_contracts.reg_api = 4; }), options));
expectCode('UPDATE_CONTRACT_FORMAT', () => validateSignedCatalog(signedCatalog(c => { delete c.release.required_contracts.storage_protocol; }), options));
expectCode('UPDATE_CONTRACT_MISMATCH', () => validateSignedCatalog(signedCatalog(c => { c.release.required_contracts.address_search = 2; }), options));
expectCode('UPDATE_DOWNGRADE_REJECTED', () => validateSignedCatalog(signedCatalog(c => { c.release.version = '7.8.2'; c.release.build_id = 'jf-7.8.2-0123456789abcdef0123456789abcdef01234567'; }), options));
expectCode('UPDATE_HALT_INVALID', () => validateSignedCatalog(signedCatalog(c => { c.directive.mode = 'halt'; }), options));
expectCode('UPDATE_ROLLBACK_VERSIONS', () => validateSignedCatalog(signedCatalog(c => { c.directive.rollback_from_versions = ['7.9.0']; }), options));
expectCode('UPDATE_ROLLBACK_NOT_APPLICABLE', () => validateSignedCatalog(signedCatalog(c => { c.directive.mode = 'rollback'; c.directive.rollback_from_versions = ['8.0.0']; c.release.version = '7.8.2'; c.release.build_id = 'jf-7.8.2-0123456789abcdef0123456789abcdef01234567'; }), options));
const rollback = validateSignedCatalog(signedCatalog(c => { c.directive.mode = 'rollback'; c.directive.rollback_from_versions = ['7.9.0']; c.release.version = '7.8.3'; c.release.build_id = 'jf-7.8.3-0123456789abcdef0123456789abcdef01234567'; }), { ...options, currentVersion: '7.9.0' });
checked(() => assert.equal(rollback.updateAvailable, true));
checked(() => assert.equal(rollback.rollbackRecommended, true));
expectCode('UPDATE_SEQUENCE_REGRESSION', () => validateSignedCatalog(signedCatalog(c => { c.catalog_sequence = 39; }), options));
expectCode('UPDATE_SEQUENCE_REPLACED', () => validateSignedCatalog(valid, { ...options, previousSequence: 41, previousDigest: 'b'.repeat(64) }));
checked(() => assert.equal(rolloutBucket('device-a', 'build-a'), rolloutBucket('device-a', 'build-a')));
checked(() => assert.ok(rolloutBucket('device-a', 'build-a') >= 0 && rolloutBucket('device-a', 'build-a') < 100));

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'justfun-update-core-'));
try {
  const journalPath = path.join(temporaryDirectory, 'journal.json');
  let tick = 0;
  const journal = new UpdateJournal(journalPath, { now: () => new Date(now.getTime() + tick++ * 1000) });
  const initial = journal.create({
    operation_id: 'operation-00000001',
    correlation_id: 'correlation-00001',
    installation_id_hash: 'c'.repeat(64),
    channel: 'stable',
    from_version: '7.8.3',
    to_version: '7.9.0',
    build_id: valid.release.build_id,
    commit_sha: valid.release.commit_sha,
    catalog_sequence: valid.catalog_sequence,
  });
  checked(() => assert.equal(initial.state, 'IDLE'));
  expectCode('UPDATE_TRANSITION_INVALID', () => journal.transition('APPLYING'));
  for (const state of ['CHECKING', 'UPDATE_AVAILABLE', 'DOWNLOADING', 'VERIFYING', 'READY_TO_APPLY', 'APPLYING', 'AWAITING_HEALTH_CONFIRMATION']) journal.transition(state);
  checked(() => assert.deepEqual(journal.recoveryAction(), { action: 'rollback', state: 'AWAITING_HEALTH_CONFIRMATION' }));
  journal.transition('ROLLING_BACK', { rollback: { required: true, result: 'pending', reason: 'health timeout' } });
  journal.transition('ROLLED_BACK', { rollback: { required: true, result: 'succeeded', reason: 'health timeout' } });
  journal.transition('IDLE');
  checked(() => assert.equal(journal.read().attempt, 1));
  checked(() => assert.ok(fs.readFileSync(journalPath, 'utf8').endsWith('\n')));
  expectCode('UPDATE_JOURNAL_SECRET', () => assertNoSecrets({ access_token: 'must-not-be-written' }));
  fs.writeFileSync(journalPath, '{broken', 'utf8');
  expectCode('UPDATE_JOURNAL_INVALID', () => journal.read());
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ ok: true, checks })}\n`);
