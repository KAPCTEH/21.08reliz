#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  inspectForEvidenceResolution,
  signCatalog,
  planPublication,
  verifyForPublication,
  verifyReleaseStatusForPublication,
  verifyStableRolloutTransition,
} from '../tools/release/update-catalog-ops.mjs';

const require = createRequire(import.meta.url);
const { canonicalBytes } = require('../source/application/update/canonical-json.cjs');
const { signingDocument } = require('../source/application/update/catalog.cjs');

let checks = 0;
function checked(action) { action(); checks += 1; }
function expectCode(code, action) { assert.throws(action, error => error?.code === code, `Expected ${code}`); checks += 1; }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'justfun-catalog-ops-'));
try {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const canonicalReleaseBytes = fs.readFileSync(path.join(repositoryRoot, 'source', 'application', 'release.json'));
  const canonicalRelease = JSON.parse(canonicalReleaseBytes.toString('utf8'));
  const canonicalReleaseSha256 = crypto.createHash('sha256').update(canonicalReleaseBytes).digest('hex');
  const publishWorkflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', '_publish-update-catalog.yml'), 'utf8').replace(/\r\n/g, '\n');
  const stagingPublishWorkflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'publish-staging.yml'), 'utf8');
  const stablePublishWorkflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'publish-stable.yml'), 'utf8');
  const windowsNativeWorkflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'windows-native-783.yml'), 'utf8');
  const windowsNativeWorkflowFixture = fs.readFileSync(path.join(repositoryRoot, 'tests', 'fixtures', 'windows-native-783.yml'), 'utf8');
  const publishCallers = ['publish-staging.yml', 'publish-stable.yml', 'rollback-release.yml', 'rollback-staging.yml']
    .map(name => fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', name), 'utf8'));
  const stagingRollbackWorkflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'rollback-staging.yml'), 'utf8');
  const deployWorkflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'deploy-update-catalog-service.yml'), 'utf8');
  const publishJobEnv = publishWorkflow.match(/\n    env:\n([\s\S]*?)\n    steps:/)?.[1] || '';
  const publishSteps = publishWorkflow.split('\n      - name: ').slice(1);
  const cloudflareSecretSteps = publishSteps.filter(step => step.includes('CLOUDFLARE_API_TOKEN:'));
  checked(() => assert.match(publishWorkflow, /404: Not Found/));
  checked(() => assert.equal(publishWorkflow.includes('--text'), false, 'KV reads must preserve exact catalog bytes'));
  checked(() => assert.match(publishWorkflow, /environment: \$\{\{ inputs\.protected_environment \}\}/));
  checked(() => assert.equal(publishWorkflow.includes('      CLOUDFLARE_API_TOKEN:\n        required: true'), false));
  checked(() => assert.equal(publishWorkflow.includes('      CLOUDFLARE_ACCOUNT_ID:\n        required: true'), false));
  checked(() => assert.doesNotMatch(publishJobEnv, /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/));
  checked(() => assert.deepEqual(cloudflareSecretSteps.map(step => step.split('\n', 1)[0]), [
    'Read and preserve the current catalog',
    'Ensure immutable history, then activate when required',
    'Confirm KV and public Worker bytes after propagation',
  ]));
  checked(() => assert.equal(cloudflareSecretSteps.every(step => step.includes('CLOUDFLARE_ACCOUNT_ID:') && step.includes('wrangler')), true));
  checked(() => assert.doesNotMatch(publishWorkflow, /secrets\.CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/));
  checked(() => assert.equal(cloudflareSecretSteps.every(step => step.includes('secrets.CLOUDFLARE_PUBLISH_API_TOKEN') && step.includes('secrets.CLOUDFLARE_PUBLISH_ACCOUNT_ID')), true));
  checked(() => assert.equal((publishWorkflow.match(/--namespace-id "\$KV_NAMESPACE_ID" --remote/g) || []).length, 3));
  checked(() => assert.doesNotMatch(publishWorkflow, /--binding UPDATE_CATALOGS/));
  checked(() => assert.match(publishWorkflow, /PRODUCTION_KV_NAMESPACE_ID[\s\S]*STAGING_KV_NAMESPACE_ID[\s\S]*test "\$production_id" != "\$staging_id"[\s\S]*stable:production[\s\S]*staging:staging/));
  checked(() => assert.match(publishWorkflow, /Ensure immutable history, then activate when required[\s\S]*ensure_immutable "\$PREVIOUS_KEY"[\s\S]*ensure_immutable "\$IMMUTABLE_KEY"[\s\S]*case "\$PUBLICATION_ACTION" in[\s\S]*publish\) "\$\{wrangler\[@\]\}" put "\$ACTIVE_KEY"[\s\S]*noop\) ;;/));
  checked(() => assert.doesNotMatch(publishWorkflow, /if: steps\.plan\.outputs\.publication_action == 'publish'/));
  checked(() => assert.match(publishWorkflow, /Confirm KV and public Worker bytes after propagation[\s\S]*cmp --silent/));
  checked(() => assert.match(publishWorkflow, /Upload publication and backup evidence[\s\S]*include-hidden-files: true/));
  checked(() => assert.equal(publishCallers.every(workflow => (
    !workflow.includes('secrets: inherit')
    && workflow.includes('vars.CLOUDFLARE_UPDATE_CATALOG_PRODUCTION_KV_NAMESPACE_ID')
    && workflow.includes('vars.CLOUDFLARE_UPDATE_CATALOG_STAGING_KV_NAMESPACE_ID')
  )), true, 'Reusable callers must not inherit deploy-capable repository secrets'));
  checked(() => assert.match(stagingRollbackWorkflow, /channel: staging/));
  checked(() => assert.match(stagingRollbackWorkflow, /wrangler_environment: staging/));
  checked(() => assert.match(stagingRollbackWorkflow, /protected_environment: update-staging/));
  checked(() => assert.match(stagingRollbackWorkflow, /required_directive: halt-or-rollback/));
  checked(() => assert.doesNotMatch(stagingRollbackWorkflow, /channel: stable|wrangler_environment: production|protected_environment: update-production/));
  checked(() => assert.match(publishWorkflow, /build_run_id:[\s\S]*required: false[\s\S]*actions: read/));
  checked(() => assert.match(publishWorkflow, /Validate exact successful Windows build run[\s\S]*\.conclusion[\s\S]*windows-native-783\.yml/));
  checked(() => assert.match(publishWorkflow, /Validate publication workflow source\n\s+shell: bash[\s\S]*refs\/heads\/main/));
  checked(() => assert.doesNotMatch(publishWorkflow, /Validate publication workflow source\n\s+if:/));
  checked(() => assert.match(publishWorkflow, /PUBLICATION_SHA[\s\S]*git\/ref\/heads\/main[\s\S]*test "\$PUBLICATION_SHA" = "\$current_main_sha"/));
  checked(() => assert.match(publishWorkflow, /PUBLICATION_REF[\s\S]*refs\/heads\/main/));
  checked(() => assert.match(publishWorkflow, /CATALOG_CHANNEL[\s\S]*stable[\s\S]*head_branch[\s\S]*main/));
  checked(() => assert.match(publishWorkflow, /actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/));
  checked(() => assert.match(publishWorkflow, /name: justfun-windows-\$\{\{ steps\.build_run\.outputs\.head_sha \}\}/));
  checked(() => assert.equal((publishWorkflow.match(/--build-identity/g) || []).length, 6));
  checked(() => assert.equal((publishWorkflow.match(/--build-manifest/g) || []).length, 6));
  checked(() => assert.equal([stagingPublishWorkflow, stablePublishWorkflow].every(workflow => /build_run_id:[\s\S]*required: true/.test(workflow) && /build_run_id: \$\{\{ inputs\.build_run_id \}\}/.test(workflow)), true));
  checked(() => assert.equal([stagingPublishWorkflow, stablePublishWorkflow].every(workflow => /contents: write/.test(workflow)), true));
  checked(() => assert.match(publishWorkflow, /Publish and verify exact GitHub Release payload[\s\S]*\.visibility'\)" = "public"[\s\S]*gh release upload[\s\S]*curl --fail[\s\S]*actual_sha/));
  checked(() => assert.match(publishWorkflow, /release asset is missing or duplicated[\s\S]*--method PATCH[\s\S]*-F prerelease=false -f make_latest=true[\s\S]*releases\/latest/));
  checked(() => assert.ok(publishWorkflow.indexOf('sha256sum .release-existing-payload.bin') < publishWorkflow.indexOf('-F prerelease=false -f make_latest=true')));
  checked(() => assert.equal((publishWorkflow.match(/git\/ref\/tags\/\$encoded_tag/g) || []).length, 3));
  checked(() => assert.equal((publishWorkflow.match(/git\/tags\/\$object_sha/g) || []).length, 3));
  checked(() => assert.doesNotMatch(publishWorkflow, /repos\/\$GITHUB_REPOSITORY\/commits\/\$encoded_tag/));
  checked(() => assert.ok(publishWorkflow.indexOf('Publish and verify exact GitHub Release payload') < publishWorkflow.indexOf('Ensure immutable history, then activate when required')));
  checked(() => assert.match(publishWorkflow, /\.release-public-payload-evidence\.json/));
  checked(() => assert.match(publishWorkflow, /Resolve successful historical Windows build run[\s\S]*head_sha[\s\S]*conclusion == "success"[\s\S]*workflow_dispatch[\s\S]*head_branch == "main"/));
  checked(() => assert.match(publishWorkflow, /Download historical rollback build evidence[\s\S]*justfun-windows-\$\{\{ steps\.validate\.outputs\.commit_sha \}\}/));
  checked(() => assert.match(publishWorkflow, /Validate historical rollback build evidence[\s\S]*--build-identity[\s\S]*--build-manifest/));
  checked(() => assert.match(publishWorkflow, /Verify existing rollback payload before activation[\s\S]*if: steps\.plan\.outputs\.directive == 'rollback'[\s\S]*curl --fail[\s\S]*actual_sha/));
  checked(() => assert.ok(publishWorkflow.indexOf('Verify existing rollback payload before activation') < publishWorkflow.indexOf('Ensure immutable history, then activate when required')));
  checked(() => assert.match(publishWorkflow, /Confirm KV and public Worker bytes after propagation[\s\S]*PUBLIC_CATALOG_URL[\s\S]*curl --fail[\s\S]*etag: \\"sha256-\$expected_sha\\"\[\[:space:\]\]\*[\s\S]*\.release-public-catalog-evidence\.json/));
  checked(() => assert.ok(publishWorkflow.indexOf('Confirm KV and public Worker bytes after propagation') < publishWorkflow.indexOf('Promote exact release to stable only after public catalog verification')));
  checked(() => assert.match(publishWorkflow, /release_args\+=\(--prerelease --latest=false\)[\s\S]*Promote exact release to stable only after public catalog verification[\s\S]*-F prerelease=false -f make_latest=true/));
  checked(() => assert.match(publishWorkflow, /Create rollback evidence record[\s\S]*previous_catalog[\s\S]*\.release-rollback-evidence\.json[\s\S]*Store rollback evidence[\s\S]*if-no-files-found: error[\s\S]*retention-days: 90/));
  checked(() => assert.doesNotMatch(deployWorkflow, /secrets\.CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/));
  checked(() => assert.match(deployWorkflow, /secrets\.CLOUDFLARE_DEPLOY_API_TOKEN[\s\S]*secrets\.CLOUDFLARE_DEPLOY_ACCOUNT_ID/));
  checked(() => assert.doesNotMatch(deployWorkflow, /CLOUDFLARE_PUBLISH_(?:API_TOKEN|ACCOUNT_ID)/));
  checked(() => assert.match(deployWorkflow, /Require exact current main revision[\s\S]*refs\/heads\/main[\s\S]*git\/ref\/heads\/main[\s\S]*test "\$current_main_sha" = "\$GITHUB_SHA"/));
  checked(() => assert.match(deployWorkflow, /test "\$production_id" != "\$staging_id"[\s\S]*wrangler\.release\.generated\.json[\s\S]*matches\.length !== 1[\s\S]*matches\[0\]\.id = id/));
  checked(() => assert.equal((deployWorkflow.match(/--config "\$WRANGLER_CONFIG"/g) || []).length, 3));
  checked(() => assert.match(deployWorkflow, /Create Worker rollback evidence[\s\S]*versions_before[\s\S]*versions_after[\s\S]*\.worker-rollback-evidence\.json[\s\S]*if-no-files-found: error[\s\S]*retention-days: 90/));
  checked(() => assert.equal([stagingRollbackWorkflow, fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'rollback-release.yml'), 'utf8')].every(workflow => !/build_run_id: \$\{\{ inputs\.build_run_id \}\}/.test(workflow)), true));
  checked(() => assert.equal(windowsNativeWorkflow, windowsNativeWorkflowFixture, 'Windows workflow and source-only contract must remain byte-identical'));
  checked(() => assert.match(windowsNativeWorkflow, /timeout-minutes: 180/));
  checked(() => assert.doesNotMatch(windowsNativeWorkflow, /timeout-minutes: 90/));
  checked(() => assert.match(windowsNativeWorkflow, /name: justfun-windows-\$\{\{ github\.sha \}\}[\s\S]*retention-days: 90/));

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const trustStore = { schema_version: 1, keys: [{
    key_id: 'unit-key', algorithm: 'Ed25519', status: 'active',
    public_key_spki_base64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }] };
  const trustFile = path.join(root, 'trust.json');
  const privateFile = path.join(root, 'private.pem');
  fs.writeFileSync(trustFile, JSON.stringify(trustStore));
  fs.writeFileSync(privateFile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });

  function unsigned(sequence, rollout, version = canonicalRelease.version, channel = 'staging') {
    const commitSha = '0123456789abcdef0123456789abcdef01234567';
    const fileName = `JustFun-${version}-win-${canonicalRelease.windows.architecture}.zip`;
    return {
      schema_version: 1, product_id: 'justfun-logistics', channel, catalog_sequence: sequence,
      generated_at: '2026-08-22T10:00:00.000Z', expires_at: '2026-08-29T10:00:00.000Z',
      directive: { mode: 'release', withdrawn_build_ids: [], rollback_from_versions: [], message: null },
      release: {
        version, build_id: `jf-${version}-${commitSha.slice(0, 12)}`, commit_sha: commitSha,
        published_at: '2026-08-22T09:00:00.000Z', minimum_supported_version: canonicalRelease.minimum_supported_version, mandatory_after: null, rollout_percent: rollout, summary: `Изменения версии ${version}.`,
        release_notes_url: `https://github.com/KAPCTEH/21.08reliz/releases/tag/v${version}`,
        required_contracts: Object.fromEntries(Object.entries(canonicalRelease.contracts).filter(([name]) => !['update_manifest', 'license_auth_context'].includes(name))),
        payload: { file_name: fileName, url: `https://github.com/KAPCTEH/21.08reliz/releases/download/v${version}/${fileName}`, bytes: 123, sha256: 'a'.repeat(64), unpacked_bytes: 456, file_count: 7, file_manifest_sha256: 'b'.repeat(64) },
      },
      signature: { algorithm: 'Ed25519', key_id: 'unit-key', value: '' },
    };
  }

  function buildEvidence(name, value, mutateIdentity = () => {}, mutateManifest = () => {}) {
    const buildContracts = structuredClone(canonicalRelease.contracts);
    for (const [contractName, contractVersion] of Object.entries(value.release.required_contracts)) buildContracts[contractName] = contractVersion;
    const identity = {
      schema_version: 1,
      product_id: canonicalRelease.product_id,
      product_name: canonicalRelease.product_name,
      version: value.release.version,
      channel: value.channel,
      release_status: canonicalRelease.release_status,
      commit_sha: value.release.commit_sha,
      source_tree: 'fedcba9876543210fedcba9876543210fedcba98',
      build_id: value.release.build_id,
      generated_at_utc: '2026-08-22T08:00:00.000Z',
      release_contract_sha256: canonicalReleaseSha256,
      contracts: structuredClone(buildContracts),
      service_versions: structuredClone(canonicalRelease.service_versions),
      windows: structuredClone(canonicalRelease.windows),
      source_dirty: false,
    };
    mutateIdentity(identity);
    const manifest = {
      schema_version: 3,
      product_id: identity.product_id,
      product_name: canonicalRelease.product_name,
      version: identity.version,
      channel: identity.channel,
      commit_sha: identity.commit_sha,
      source_tree: identity.source_tree,
      build_id: identity.build_id,
      generated_at_utc: identity.generated_at_utc,
      contracts: structuredClone(buildContracts),
      artifacts: {
        update_payload: {
          path: value.release.payload.file_name,
          bytes: value.release.payload.bytes,
          sha256: value.release.payload.sha256,
          unpacked_bytes: value.release.payload.unpacked_bytes,
          file_count: value.release.payload.file_count,
        },
        update_file_manifest: {
          path: 'UPDATE-FILES.json',
          bytes: 321,
          sha256: value.release.payload.file_manifest_sha256,
        },
      },
    };
    mutateManifest(manifest);
    const buildIdentityFile = path.join(root, `${name}-build-identity.json`);
    const buildManifestFile = path.join(root, `${name}-BUILD-MANIFEST.json`);
    fs.writeFileSync(buildIdentityFile, `${JSON.stringify(identity, null, 2)}\n`);
    fs.writeFileSync(buildManifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    return { buildIdentityFile, buildManifestFile };
  }

  const evidenceByFile = new Map();
  function sign(name, value, evidence = null) {
    const input = path.join(root, `${name}-unsigned.json`);
    const output = path.join(root, `${name}.json`);
    fs.writeFileSync(input, JSON.stringify(value));
    const build = evidence || (['release', 'rollback'].includes(value.directive.mode) ? buildEvidence(name, value) : {});
    signCatalog(input, output, trustFile, 'unit-key', privateFile, { now: new Date(new Date(value.generated_at).getTime() + 60_000), ...build });
    evidenceByFile.set(output, build);
    return output;
  }

  function publicationOptions(file, now) {
    return { now, ...(evidenceByFile.get(file) || {}) };
  }

  function rawSigned(value) {
    const signed = structuredClone(value);
    signed.signature.value = crypto.sign(null, canonicalBytes(signingDocument(signed)), privateKey).toString('base64');
    return signed;
  }

  const canaryValue = unsigned(1, 5);
  const canary = sign('canary', canaryValue);
  const verified = verifyForPublication(JSON.parse(fs.readFileSync(canary, 'utf8')), trustStore, publicationOptions(canary, new Date('2026-08-22T12:00:00.000Z')));
  checked(() => assert.equal(verified.keyId, 'unit-key'));
  checked(() => assert.match(verified.canonical.update_policy_sha256, /^[0-9a-f]{64}$/));
  checked(() => assert.match(verified.canonical.release_contract_sha256, /^[0-9a-f]{64}$/));
  checked(() => assert.match(verified.canonical.compatibility_policy_sha256, /^[0-9a-f]{64}$/));
  checked(() => assert.match(verified.canonical.build_identity_sha256, /^[0-9a-f]{64}$/));
  checked(() => assert.match(verified.canonical.build_manifest_sha256, /^[0-9a-f]{64}$/));
  checked(() => assert.equal(verified.canonical.commit_sha, canaryValue.release.commit_sha));

  expectCode('CATALOG_BUILD_EVIDENCE_REQUIRED', () => verifyForPublication(rawSigned(canaryValue), trustStore, { now: new Date('2026-08-22T12:00:00.000Z') }));
  const wrongVersion = unsigned(27, 5, '8.0.0');
  const wrongVersionEvidence = buildEvidence('wrong-version', wrongVersion);
  expectCode('CATALOG_VERSION_MISMATCH', () => verifyForPublication(rawSigned(wrongVersion), trustStore, { now: new Date('2026-08-22T12:00:00.000Z'), ...wrongVersionEvidence }));
  const wrongCommit = unsigned(28, 5);
  const wrongCommitEvidence = buildEvidence('wrong-commit', wrongCommit);
  wrongCommit.release.commit_sha = '1'.repeat(40);
  wrongCommit.release.build_id = `jf-${wrongCommit.release.version}-${wrongCommit.release.commit_sha.slice(0, 12)}`;
  expectCode('CATALOG_COMMIT_MISMATCH', () => verifyForPublication(rawSigned(wrongCommit), trustStore, { now: new Date('2026-08-22T12:00:00.000Z'), ...wrongCommitEvidence }));
  const wrongBuildId = unsigned(29, 5);
  const wrongBuildIdEvidence = buildEvidence('wrong-build-id', wrongBuildId);
  wrongBuildId.release.build_id = `jf-${wrongBuildId.release.version}-111111111111`;
  expectCode('CATALOG_BUILD_ID_MISMATCH', () => verifyForPublication(rawSigned(wrongBuildId), trustStore, { now: new Date('2026-08-22T12:00:00.000Z'), ...wrongBuildIdEvidence }));
  const wrongProductEvidence = buildEvidence('wrong-product', canaryValue, identity => { identity.product_id = 'other-product'; });
  expectCode('CATALOG_PRODUCT_MISMATCH', () => verifyForPublication(rawSigned(canaryValue), trustStore, { now: new Date('2026-08-22T12:00:00.000Z'), ...wrongProductEvidence }));
  const wrongStatusEvidence = buildEvidence('wrong-status', canaryValue, identity => { identity.release_status = 'released'; });
  expectCode('CATALOG_RELEASE_STATUS', () => verifyForPublication(rawSigned(canaryValue), trustStore, { now: new Date('2026-08-22T12:00:00.000Z'), ...wrongStatusEvidence }));
  const wrongContractEvidence = buildEvidence('wrong-release-contract', canaryValue, identity => { identity.release_contract_sha256 = '0'.repeat(64); });
  expectCode('CATALOG_RELEASE_CONTRACT_MISMATCH', () => verifyForPublication(rawSigned(canaryValue), trustStore, { now: new Date('2026-08-22T12:00:00.000Z'), ...wrongContractEvidence }));
  const dirtyEvidence = buildEvidence('dirty-build', canaryValue, identity => { identity.source_dirty = true; });
  expectCode('CATALOG_DIRTY_BUILD', () => verifyForPublication(rawSigned(canaryValue), trustStore, { now: new Date('2026-08-22T12:00:00.000Z'), ...dirtyEvidence }));
  const wrongBuildContractEvidence = buildEvidence('wrong-build-contract', canaryValue, () => {}, manifest => { manifest.contracts.reg_api += 1; });
  expectCode('CATALOG_BUILD_CONTRACT_MISMATCH', () => verifyForPublication(rawSigned(canaryValue), trustStore, { now: new Date('2026-08-22T12:00:00.000Z'), ...wrongBuildContractEvidence }));
  for (const [name, mutate] of [
    ['payload-name', manifest => { manifest.artifacts.update_payload.path = 'Different.zip'; }],
    ['payload-bytes', manifest => { manifest.artifacts.update_payload.bytes += 1; }],
    ['payload-sha', manifest => { manifest.artifacts.update_payload.sha256 = 'c'.repeat(64); }],
    ['payload-unpacked', manifest => { manifest.artifacts.update_payload.unpacked_bytes += 1; }],
    ['payload-files', manifest => { manifest.artifacts.update_payload.file_count += 1; }],
    ['update-files-sha', manifest => { manifest.artifacts.update_file_manifest.sha256 = 'd'.repeat(64); }],
  ]) {
    const evidence = buildEvidence(name, canaryValue, () => {}, mutate);
    expectCode('CATALOG_PAYLOAD_EVIDENCE_MISMATCH', () => verifyForPublication(rawSigned(canaryValue), trustStore, { now: new Date('2026-08-22T12:00:00.000Z'), ...evidence }));
  }
  expectCode('CATALOG_RELEASE_STATUS', () => verifyReleaseStatusForPublication('stable', 'candidate'));
  const candidateStable = unsigned(32, 5, canonicalRelease.version, 'stable');
  const candidateStableEvidence = buildEvidence('candidate-stable', candidateStable);
  expectCode('CATALOG_RELEASE_STATUS', () => verifyForPublication(rawSigned(candidateStable), trustStore, { now: new Date('2026-08-22T12:00:00.000Z'), ...candidateStableEvidence }));
  checked(() => verifyReleaseStatusForPublication('staging', 'candidate'));
  checked(() => verifyReleaseStatusForPublication('stable', 'released'));
  for (const channel of ['internal', 'staging', 'stable']) expectCode('CATALOG_RELEASE_STATUS', () => verifyReleaseStatusForPublication(channel, 'withdrawn'));

  const attackerPayload = unsigned(20, 5);
  attackerPayload.release.payload.url = `https://attacker.invalid/${attackerPayload.release.payload.file_name}`;
  expectCode('UPDATE_URL_HOST', () => verifyForPublication(rawSigned(attackerPayload), trustStore, { now: new Date('2026-08-22T12:00:00.000Z') }));
  const attackerNotes = unsigned(21, 5);
  attackerNotes.release.release_notes_url = 'https://attacker.invalid/release-notes';
  expectCode('UPDATE_URL_HOST', () => verifyForPublication(rawSigned(attackerNotes), trustStore, { now: new Date('2026-08-22T12:00:00.000Z') }));
  const wrongContract = unsigned(22, 5);
  wrongContract.release.required_contracts.reg_api += 1;
  expectCode('UPDATE_CONTRACT_MISMATCH', () => verifyForPublication(rawSigned(wrongContract), trustStore, { now: new Date('2026-08-22T12:00:00.000Z') }));
  const missingContract = unsigned(23, 5);
  delete missingContract.release.required_contracts.reg_api;
  expectCode('UPDATE_CONTRACT_FORMAT', () => verifyForPublication(rawSigned(missingContract), trustStore, { now: new Date('2026-08-22T12:00:00.000Z') }));
  const extraContract = unsigned(24, 5);
  extraContract.release.required_contracts.attacker_contract = 1;
  expectCode('UPDATE_CONTRACT_FORMAT', () => verifyForPublication(rawSigned(extraContract), trustStore, { now: new Date('2026-08-22T12:00:00.000Z') }));
  const wrongArchitecture = unsigned(25, 5);
  wrongArchitecture.release.payload.file_name = 'JustFun-8.0.0-win-arm64.zip';
  wrongArchitecture.release.payload.url = `https://github.com/KAPCTEH/21.08reliz/releases/download/v8.0.0/${wrongArchitecture.release.payload.file_name}`;
  expectCode('CATALOG_ARCHITECTURE', () => verifyForPublication(rawSigned(wrongArchitecture), trustStore, { now: new Date('2026-08-22T12:00:00.000Z') }));
  const wrongMinimum = unsigned(26, 5);
  wrongMinimum.release.minimum_supported_version = '7.8.2';
  expectCode('CATALOG_MINIMUM_VERSION', () => verifyForPublication(rawSigned(wrongMinimum), trustStore, { now: new Date('2026-08-22T12:00:00.000Z') }));
  const first = planPublication(canary, trustFile, null, publicationOptions(canary, new Date('2026-08-22T12:00:00.000Z')));
  checked(() => assert.equal(first.active_key, 'catalog:staging'));
  checked(() => assert.match(first.immutable_key, /^history:staging:1:[0-9a-f]{64}$/));
  checked(() => assert.equal(first.publication_action, 'publish'));

  const repeated = planPublication(canary, trustFile, canary, publicationOptions(canary, new Date('2026-08-22T12:00:00.000Z')));
  checked(() => assert.equal(repeated.publication_action, 'noop'));

  const historicalValue = unsigned(30, 5, '7.8.3');
  historicalValue.release.required_contracts.license_auth = 4;
  const historicalFile = path.join(root, 'historical-current.json');
  fs.writeFileSync(historicalFile, `${JSON.stringify(rawSigned(historicalValue), null, 2)}\n`);
  const afterHistoricalValue = unsigned(31, 5);
  afterHistoricalValue.generated_at = '2026-08-22T11:00:00.000Z';
  afterHistoricalValue.release.published_at = '2026-08-22T10:30:00.000Z';
  const afterHistorical = sign('after-historical', afterHistoricalValue);
  const historicalPlan = planPublication(afterHistorical, trustFile, historicalFile, publicationOptions(afterHistorical, new Date('2026-08-22T12:00:00.000Z')));
  checked(() => assert.equal(historicalPlan.previous.catalog_sequence, 30));
  checked(() => assert.equal(historicalPlan.catalog_sequence, 31));

  const conflicting = path.join(root, 'conflicting.json');
  fs.writeFileSync(conflicting, JSON.stringify(JSON.parse(fs.readFileSync(canary, 'utf8'))));
  expectCode('CATALOG_SEQUENCE_CONFLICT', () => planPublication(conflicting, trustFile, canary, publicationOptions(canary, new Date('2026-08-22T12:00:00.000Z'))));

  const quarterValue = unsigned(2, 25);
  quarterValue.generated_at = '2026-08-22T13:00:00.000Z';
  quarterValue.release.published_at = '2026-08-22T12:30:00.000Z';
  const quarter = sign('quarter', quarterValue);
  const next = planPublication(quarter, trustFile, canary, publicationOptions(quarter, new Date('2026-08-22T14:00:00.000Z')));
  checked(() => assert.equal(next.previous.catalog_sequence, 1));
  checked(() => assert.equal(next.rollout_percent, 25));
  expectCode('CATALOG_SEQUENCE_NOT_ADVANCED', () => planPublication(canary, trustFile, quarter, publicationOptions(canary, new Date('2026-08-22T14:00:00.000Z'))));

  const fullValue = unsigned(3, 100);
  fullValue.generated_at = '2026-08-22T15:00:00.000Z';
  fullValue.release.published_at = '2026-08-22T14:30:00.000Z';
  const full = sign('full', fullValue);
  checked(() => assert.equal(planPublication(full, trustFile, quarter, publicationOptions(full, new Date('2026-08-22T16:00:00.000Z'))).rollout_percent, 100));

  const stableCanary = unsigned(1, 5, canonicalRelease.version, 'stable');
  const stableQuarter = unsigned(2, 25, canonicalRelease.version, 'stable');
  const stableFull = unsigned(3, 100, canonicalRelease.version, 'stable');
  const stableRegressed = unsigned(4, 25, canonicalRelease.version, 'stable');
  const stableNewBuild = unsigned(4, 25, canonicalRelease.version, 'stable');
  stableNewBuild.release.commit_sha = '1'.repeat(40);
  stableNewBuild.release.build_id = `jf-${stableNewBuild.release.version}-${stableNewBuild.release.commit_sha.slice(0, 12)}`;
  checked(() => verifyStableRolloutTransition(stableCanary, null));
  expectCode('CATALOG_CANARY_REQUIRED', () => verifyStableRolloutTransition(stableQuarter, null));
  checked(() => verifyStableRolloutTransition(stableQuarter, stableCanary));
  expectCode('CATALOG_ROLLOUT_STAGE_SKIPPED', () => verifyStableRolloutTransition(stableFull, stableCanary));
  checked(() => verifyStableRolloutTransition(stableFull, stableQuarter));
  expectCode('CATALOG_ROLLOUT_REGRESSION', () => verifyStableRolloutTransition(stableRegressed, stableFull));
  expectCode('CATALOG_CANARY_REQUIRED', () => verifyStableRolloutTransition(stableNewBuild, stableFull));

  const wrongKey = crypto.generateKeyPairSync('ed25519').privateKey;
  const wrongKeyFile = path.join(root, 'wrong.pem');
  fs.writeFileSync(wrongKeyFile, wrongKey.export({ format: 'pem', type: 'pkcs8' }));
  const wrongInput = path.join(root, 'wrong-input.json');
  fs.writeFileSync(wrongInput, JSON.stringify(unsigned(5, 5)));
  expectCode('CATALOG_KEY_MISMATCH', () => signCatalog(wrongInput, path.join(root, 'wrong.json'), trustFile, 'unit-key', wrongKeyFile));

  const haltValue = unsigned(5, 0);
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
  rollbackValue.directive = { mode: 'rollback', withdrawn_build_ids: [fullValue.release.build_id], rollback_from_versions: [canonicalRelease.version], message: 'Безопасный откат.' };
  const rollbackSigned = rawSigned(rollbackValue);
  expectCode('CATALOG_BUILD_EVIDENCE_REQUIRED', () => verifyForPublication(rollbackSigned, trustStore, { now: new Date('2026-08-22T21:00:00.000Z') }));
  checked(() => assert.equal(inspectForEvidenceResolution(rollbackSigned, trustStore, { now: new Date('2026-08-22T21:00:00.000Z') }).keyId, 'unit-key'));
  const wrongRollbackPayloadEvidence = buildEvidence('wrong-rollback-payload', rollbackValue, () => {}, manifest => { manifest.artifacts.update_payload.sha256 = 'c'.repeat(64); });
  expectCode('CATALOG_PAYLOAD_EVIDENCE_MISMATCH', () => verifyForPublication(rollbackSigned, trustStore, { now: new Date('2026-08-22T21:00:00.000Z'), ...wrongRollbackPayloadEvidence }));
  const wrongRollbackContractEvidence = buildEvidence('wrong-rollback-contract', rollbackValue, () => {}, manifest => { manifest.contracts.reg_api += 1; });
  expectCode('CATALOG_BUILD_CONTRACT_MISMATCH', () => verifyForPublication(rollbackSigned, trustStore, { now: new Date('2026-08-22T21:00:00.000Z'), ...wrongRollbackContractEvidence }));
  const rollbackFile = sign('rollback', rollbackValue);
  const rollbackPlan = planPublication(rollbackFile, trustFile, full, publicationOptions(rollbackFile, new Date('2026-08-22T21:00:00.000Z')));
  checked(() => assert.equal(rollbackPlan.directive, 'rollback'));
  checked(() => assert.equal(rollbackPlan.canonical.historical, true));
  checked(() => assert.equal(rollbackPlan.public_catalog_url, 'https://justfun-update-catalog-staging.pw-fanat.workers.dev/v1/catalog/staging'));

  const wrongDirectionValue = unsigned(7, 100, '7.9.0');
  wrongDirectionValue.generated_at = '2026-08-22T21:30:00.000Z';
  wrongDirectionValue.release.published_at = '2026-08-22T21:00:00.000Z';
  wrongDirectionValue.directive = { mode: 'rollback', withdrawn_build_ids: [fullValue.release.build_id], rollback_from_versions: ['8.0.0', '7.8.0', canonicalRelease.version], message: 'Недопустимое направление.' };
  const wrongDirectionFile = sign('wrong-direction', wrongDirectionValue);
  expectCode('CATALOG_ROLLBACK_DIRECTION', () => planPublication(wrongDirectionFile, trustFile, full, publicationOptions(wrongDirectionFile, new Date('2026-08-22T22:00:00.000Z'))));

  const oldPublishedValue = unsigned(40, 100, '7.8.3');
  oldPublishedValue.release.minimum_supported_version = '7.8.2';
  oldPublishedValue.release.required_contracts.license_auth = 4;
  const oldPublishedFile = path.join(root, 'old-published.json');
  fs.writeFileSync(oldPublishedFile, `${JSON.stringify(rawSigned(oldPublishedValue), null, 2)}\n`);
  const oldHaltValue = structuredClone(oldPublishedValue);
  oldHaltValue.catalog_sequence = 41;
  oldHaltValue.generated_at = '2026-08-22T22:30:00.000Z';
  oldHaltValue.release.published_at = '2026-08-22T22:00:00.000Z';
  oldHaltValue.release.rollout_percent = 0;
  oldHaltValue.directive = { mode: 'halt', withdrawn_build_ids: [oldPublishedValue.release.build_id], rollback_from_versions: [], message: 'Остановка исторической сборки.' };
  const oldHaltFile = sign('old-halt', oldHaltValue);
  checked(() => assert.equal(planPublication(oldHaltFile, trustFile, oldPublishedFile, { now: new Date('2026-08-22T23:00:00.000Z') }).directive, 'halt'));
  const oldRollbackValue = unsigned(42, 100, '7.8.2');
  oldRollbackValue.generated_at = '2026-08-22T23:30:00.000Z';
  oldRollbackValue.release.published_at = '2026-08-22T23:00:00.000Z';
  oldRollbackValue.release.minimum_supported_version = '7.8.2';
  oldRollbackValue.release.required_contracts.license_auth = 4;
  oldRollbackValue.directive = { mode: 'rollback', withdrawn_build_ids: [oldPublishedValue.release.build_id], rollback_from_versions: ['7.8.3'], message: 'Откат на историческую сборку.' };
  const oldRollbackFile = sign('old-rollback', oldRollbackValue);
  checked(() => assert.equal(planPublication(oldRollbackFile, trustFile, oldPublishedFile, publicationOptions(oldRollbackFile, new Date('2026-08-23T00:00:00.000Z'))).directive, 'rollback'));

  process.stdout.write(`Update catalog operations unit: ${checks}/${checks} checks passed.\n`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
