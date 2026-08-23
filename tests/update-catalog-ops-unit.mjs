#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signCatalog, planPublication, verifyForPublication } from '../tools/release/update-catalog-ops.mjs';

let checks = 0;
function checked(action) { action(); checks += 1; }
function expectCode(code, action) { assert.throws(action, error => error?.code === code, `Expected ${code}`); checks += 1; }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'justfun-catalog-ops-'));
try {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const trustStore = { schema_version: 1, keys: [{
    key_id: 'unit-key', algorithm: 'Ed25519', status: 'active',
    public_key_spki_base64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }] };
  const trustFile = path.join(root, 'trust.json');
  const privateFile = path.join(root, 'private.pem');
  fs.writeFileSync(trustFile, JSON.stringify(trustStore));
  fs.writeFileSync(privateFile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });

  function unsigned(sequence, rollout, version = '8.0.0') {
    return {
      schema_version: 1, product_id: 'justfun-logistics', channel: 'stable', catalog_sequence: sequence,
      generated_at: '2026-08-22T10:00:00.000Z', expires_at: '2026-08-29T10:00:00.000Z',
      directive: { mode: 'release', withdrawn_build_ids: [], rollback_from_versions: [], message: null },
      release: {
        version, build_id: `jf-${version}-0123456789abcdef0123456789abcdef01234567`, commit_sha: '0123456789abcdef0123456789abcdef01234567',
        published_at: '2026-08-22T09:00:00.000Z', minimum_supported_version: '7.8.3', mandatory_after: null, rollout_percent: rollout, summary: `Изменения версии ${version}.`,
        release_notes_url: `https://releases.justfun.invalid/${version}`,
        required_contracts: { reg_api: 3, license_auth: 4, telegram_broker: 4, storage_protocol: 3, address_search: 1, warehouse_delete_prepare: 1, warehouse_delete_lease: 3, telegram_broker_deprovision: 3, telegram_native_deprovision: 1, vps_attestation: 1, warehouse_delete_release_outbox: 1 },
        payload: { file_name: `JustFun-${version}-win-x64.zip`, url: `https://downloads.justfun.invalid/JustFun-${version}-win-x64.zip`, bytes: 123, sha256: 'a'.repeat(64), unpacked_bytes: 456, file_count: 7, file_manifest_sha256: 'b'.repeat(64) },
      },
      signature: { algorithm: 'Ed25519', key_id: 'unit-key', value: '' },
    };
  }

  function sign(name, value) {
    const input = path.join(root, `${name}-unsigned.json`);
    const output = path.join(root, `${name}.json`);
    fs.writeFileSync(input, JSON.stringify(value));
    signCatalog(input, output, trustFile, 'unit-key', privateFile, { now: new Date(new Date(value.generated_at).getTime() + 60_000) });
    return output;
  }

  const canary = sign('canary', unsigned(1, 5));
  const verified = verifyForPublication(JSON.parse(fs.readFileSync(canary, 'utf8')), trustStore, { now: new Date('2026-08-22T12:00:00.000Z') });
  checked(() => assert.equal(verified.keyId, 'unit-key'));
  const first = planPublication(canary, trustFile, null, { now: new Date('2026-08-22T12:00:00.000Z') });
  checked(() => assert.equal(first.active_key, 'catalog:stable'));
  checked(() => assert.match(first.immutable_key, /^history:stable:1:[0-9a-f]{64}$/));

  const quarterValue = unsigned(2, 25);
  quarterValue.generated_at = '2026-08-22T13:00:00.000Z';
  quarterValue.release.published_at = '2026-08-22T12:30:00.000Z';
  const quarter = sign('quarter', quarterValue);
  const next = planPublication(quarter, trustFile, canary, { now: new Date('2026-08-22T14:00:00.000Z') });
  checked(() => assert.equal(next.previous.catalog_sequence, 1));
  checked(() => assert.equal(next.rollout_percent, 25));

  const fullValue = unsigned(3, 100);
  fullValue.generated_at = '2026-08-22T15:00:00.000Z';
  fullValue.release.published_at = '2026-08-22T14:30:00.000Z';
  const full = sign('full', fullValue);
  expectCode('CATALOG_ROLLOUT_STAGE_SKIPPED', () => planPublication(full, trustFile, canary, { now: new Date('2026-08-22T16:00:00.000Z') }));
  checked(() => assert.equal(planPublication(full, trustFile, quarter, { now: new Date('2026-08-22T16:00:00.000Z') }).rollout_percent, 100));

  const regressedValue = unsigned(4, 25);
  regressedValue.generated_at = '2026-08-22T17:00:00.000Z';
  regressedValue.release.published_at = '2026-08-22T16:30:00.000Z';
  const regressed = sign('regressed', regressedValue);
  expectCode('CATALOG_ROLLOUT_REGRESSION', () => planPublication(regressed, trustFile, full, { now: new Date('2026-08-22T18:00:00.000Z') }));

  const newBuild = unsigned(4, 25, '8.0.1');
  newBuild.generated_at = '2026-08-22T17:00:00.000Z';
  newBuild.release.published_at = '2026-08-22T16:30:00.000Z';
  const newBuildFile = sign('new-build', newBuild);
  expectCode('CATALOG_CANARY_REQUIRED', () => planPublication(newBuildFile, trustFile, full, { now: new Date('2026-08-22T18:00:00.000Z') }));

  const wrongKey = crypto.generateKeyPairSync('ed25519').privateKey;
  const wrongKeyFile = path.join(root, 'wrong.pem');
  fs.writeFileSync(wrongKeyFile, wrongKey.export({ format: 'pem', type: 'pkcs8' }));
  const wrongInput = path.join(root, 'wrong-input.json');
  fs.writeFileSync(wrongInput, JSON.stringify(unsigned(5, 5)));
  expectCode('CATALOG_KEY_MISMATCH', () => signCatalog(wrongInput, path.join(root, 'wrong.json'), trustFile, 'unit-key', wrongKeyFile));

  const haltValue = unsigned(5, 0, '8.0.0');
  haltValue.generated_at = '2026-08-22T19:00:00.000Z';
  haltValue.release.published_at = '2026-08-22T18:30:00.000Z';
  haltValue.directive = { mode: 'halt', withdrawn_build_ids: [haltValue.release.build_id], rollback_from_versions: [], message: 'Выпуск остановлен.' };
  const haltFile = sign('halt', haltValue);
  checked(() => assert.equal(planPublication(haltFile, trustFile, full, { now: new Date('2026-08-22T20:00:00.000Z') }).directive, 'halt'));
  expectCode('CATALOG_DIRECTIVE_REQUIRES_CURRENT', () => planPublication(haltFile, trustFile, null, { now: new Date('2026-08-22T20:00:00.000Z') }));

  const wrongHaltValue = unsigned(6, 0, '8.0.1');
  wrongHaltValue.generated_at = '2026-08-22T20:30:00.000Z';
  wrongHaltValue.release.published_at = '2026-08-22T20:00:00.000Z';
  wrongHaltValue.directive = { mode: 'halt', withdrawn_build_ids: [wrongHaltValue.release.build_id], rollback_from_versions: [], message: 'Другой выпуск.' };
  const wrongHaltFile = sign('wrong-halt', wrongHaltValue);
  expectCode('CATALOG_HALT_CURRENT_BUILD', () => planPublication(wrongHaltFile, trustFile, full, { now: new Date('2026-08-22T21:00:00.000Z') }));

  const rollbackValue = unsigned(6, 100, '7.8.3');
  rollbackValue.generated_at = '2026-08-22T20:30:00.000Z';
  rollbackValue.release.published_at = '2026-08-22T20:00:00.000Z';
  rollbackValue.directive = { mode: 'rollback', withdrawn_build_ids: [fullValue.release.build_id], rollback_from_versions: ['8.0.0'], message: 'Безопасный откат.' };
  const rollbackFile = sign('rollback', rollbackValue);
  checked(() => assert.equal(planPublication(rollbackFile, trustFile, full, { now: new Date('2026-08-22T21:00:00.000Z') }).directive, 'rollback'));

  const wrongDirectionValue = unsigned(7, 100, '7.9.0');
  wrongDirectionValue.generated_at = '2026-08-22T21:30:00.000Z';
  wrongDirectionValue.release.published_at = '2026-08-22T21:00:00.000Z';
  wrongDirectionValue.directive = { mode: 'rollback', withdrawn_build_ids: [fullValue.release.build_id], rollback_from_versions: ['8.0.0', '7.8.0'], message: 'Недопустимое направление.' };
  const wrongDirectionFile = sign('wrong-direction', wrongDirectionValue);
  expectCode('CATALOG_ROLLBACK_DIRECTION', () => planPublication(wrongDirectionFile, trustFile, full, { now: new Date('2026-08-22T22:00:00.000Z') }));

  process.stdout.write(`Update catalog operations unit: ${checks}/${checks} checks passed.\n`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
