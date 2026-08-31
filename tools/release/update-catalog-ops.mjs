#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { canonicalBytes } = require('../../source/application/update/canonical-json.cjs');
const { catalogDigest, signingDocument, validateSignedCatalog } = require('../../source/application/update/catalog.cjs');
const { compareSemver } = require('../../source/application/update/semver.cjs');

const MAX_CATALOG_BYTES = 262_144;
const MAX_BUILD_EVIDENCE_BYTES = 16_777_216;
const CHANNELS = new Set(['internal', 'staging', 'stable']);
const RELEASE_STATUSES = new Set(['development', 'candidate', 'released', 'withdrawn']);
const CATALOG_CONTRACT_NAMES = Object.freeze([
  'reg_api',
  'license_auth',
  'telegram_broker',
  'storage_protocol',
  'address_search',
  'warehouse_delete_prepare',
  'warehouse_delete_lease',
  'telegram_broker_deprovision',
  'telegram_native_deprovision',
  'vps_attestation',
  'warehouse_delete_release_outbox',
]);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANONICAL_PUBLICATION_FILES = Object.freeze({
  updatePolicy: path.join(REPOSITORY_ROOT, 'source', 'application', 'update', 'policy.json'),
  releaseContract: path.join(REPOSITORY_ROOT, 'source', 'application', 'release.json'),
  compatibilityPolicy: path.join(REPOSITORY_ROOT, 'release', 'compatibility-policy.json'),
});

function fail(message, code = 'CATALOG_OPERATION_FAILED') {
  throw Object.assign(new Error(message), { code });
}

function readJsonFile(file, maximumBytes = MAX_CATALOG_BYTES) {
  const absolute = path.resolve(file);
  const bytes = fs.readFileSync(absolute);
  if (bytes.length < 2 || bytes.length > maximumBytes) fail(`JSON size is invalid: ${absolute}`, 'CATALOG_FILE_SIZE');
  let value;
  try { value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { fail(`JSON is invalid: ${absolute}`, 'CATALOG_FILE_JSON'); }
  return { absolute, bytes, value };
}

function validationCurrentVersion(catalog, releaseContract) {
  if (catalog?.directive?.mode === 'rollback') return String(catalog.directive.rollback_from_versions?.[0] || '');
  return String(releaseContract?.version || '');
}

function sameStrings(left, right) {
  return JSON.stringify([...(left || [])].map(String).sort()) === JSON.stringify([...(right || [])].map(String).sort());
}

function sameRecord(left, right) {
  if (!left || typeof left !== 'object' || Array.isArray(left) || !right || typeof right !== 'object' || Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return sameStrings(keys, Object.keys(right)) && keys.every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}

function loadCanonicalPublicationContract() {
  const updatePolicyFile = readJsonFile(CANONICAL_PUBLICATION_FILES.updatePolicy);
  const releaseContractFile = readJsonFile(CANONICAL_PUBLICATION_FILES.releaseContract);
  const compatibilityPolicyFile = readJsonFile(CANONICAL_PUBLICATION_FILES.compatibilityPolicy);
  const updatePolicy = updatePolicyFile.value;
  const releaseContract = releaseContractFile.value;
  const compatibilityPolicy = compatibilityPolicyFile.value;
  if (updatePolicy?.schema_version !== 1 || updatePolicy.enabled !== true) fail('Canonical update policy is invalid or disabled.', 'CATALOG_CANONICAL_POLICY');
  if (releaseContract?.schema_version !== 1 || !releaseContract.product_id || !releaseContract.version || !releaseContract.minimum_supported_version || !RELEASE_STATUSES.has(releaseContract.release_status)) fail('Canonical release contract is invalid.', 'CATALOG_CANONICAL_RELEASE');
  if (compatibilityPolicy?.schema_version !== 1 || compatibilityPolicy.product_id !== releaseContract.product_id) fail('Canonical compatibility policy does not match the release contract.', 'CATALOG_CANONICAL_COMPATIBILITY');
  if (!sameStrings(releaseContract.supported_channels, compatibilityPolicy.allowed_channels) || !sameStrings(releaseContract.supported_channels, [...CHANNELS])) fail('Canonical channel policy is inconsistent.', 'CATALOG_CANONICAL_CHANNELS');
  if (compatibilityPolicy.minimum_supported_version !== releaseContract.minimum_supported_version) fail('Canonical minimum supported versions are inconsistent.', 'CATALOG_CANONICAL_MINIMUM_VERSION');
  const contracts = releaseContract.contracts;
  const ranges = compatibilityPolicy.required_contracts;
  if (!contracts || typeof contracts !== 'object' || Array.isArray(contracts) || !ranges || typeof ranges !== 'object' || Array.isArray(ranges) || !sameStrings(Object.keys(contracts), Object.keys(ranges))) fail('Canonical contract sets are inconsistent.', 'CATALOG_CANONICAL_CONTRACTS');
  for (const [name, version] of Object.entries(contracts)) {
    if (!Number.isInteger(version) || version < 1 || ranges[name]?.minimum !== version || ranges[name]?.maximum !== version) fail(`Canonical contract range is inconsistent: ${name}.`, 'CATALOG_CANONICAL_CONTRACTS');
  }
  const architecture = String(releaseContract?.windows?.architecture || '');
  if (!/^[a-z0-9_-]+$/i.test(architecture)) fail('Canonical Windows architecture is invalid.', 'CATALOG_CANONICAL_ARCHITECTURE');
  if (!Array.isArray(updatePolicy.allowed_payload_hosts) || updatePolicy.allowed_payload_hosts.length === 0 || !Array.isArray(updatePolicy.allowed_release_notes_hosts) || updatePolicy.allowed_release_notes_hosts.length === 0) fail('Canonical update host allowlists are invalid.', 'CATALOG_CANONICAL_HOSTS');
  if (!Array.isArray(updatePolicy.allowed_catalog_hosts) || updatePolicy.allowed_catalog_hosts.length === 0 || !updatePolicy.catalog_endpoints || typeof updatePolicy.catalog_endpoints !== 'object' || Array.isArray(updatePolicy.catalog_endpoints) || !sameStrings(Object.keys(updatePolicy.catalog_endpoints), [...CHANNELS])) fail('Canonical catalog endpoints are invalid.', 'CATALOG_CANONICAL_ENDPOINTS');
  const allowedCatalogHosts = new Set(updatePolicy.allowed_catalog_hosts.map(item => String(item).toLowerCase()));
  const catalogEndpoints = Object.fromEntries([...CHANNELS].map(channel => {
    let endpoint;
    try { endpoint = new URL(String(updatePolicy.catalog_endpoints[channel] || '')); }
    catch { fail(`Canonical catalog endpoint is invalid: ${channel}.`, 'CATALOG_CANONICAL_ENDPOINTS'); }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash || endpoint.pathname !== `/v1/catalog/${channel}` || !allowedCatalogHosts.has(endpoint.hostname.toLowerCase())) fail(`Canonical catalog endpoint is invalid: ${channel}.`, 'CATALOG_CANONICAL_ENDPOINTS');
    return [channel, endpoint.href];
  }));
  if (!Number.isSafeInteger(updatePolicy.max_payload_bytes) || updatePolicy.max_payload_bytes < 1) fail('Canonical payload size limit is invalid.', 'CATALOG_CANONICAL_PAYLOAD_LIMIT');
  const catalogContracts = Object.fromEntries(CATALOG_CONTRACT_NAMES.map(name => {
    const version = contracts[name];
    if (!Number.isInteger(version) || ranges[name]?.minimum !== version || ranges[name]?.maximum !== version) fail(`Canonical catalog contract is inconsistent: ${name}.`, 'CATALOG_CANONICAL_CONTRACTS');
    return [name, version];
  }));
  return {
    updatePolicy,
    releaseContract,
    compatibilityPolicy,
    catalogContracts,
    catalogEndpoints,
    architecture,
    evidence: {
      update_policy_sha256: exactDocumentSha256(updatePolicyFile.bytes),
      release_contract_sha256: exactDocumentSha256(releaseContractFile.bytes),
      compatibility_policy_sha256: exactDocumentSha256(compatibilityPolicyFile.bytes),
    },
  };
}

function publicationValidationOptions(catalog, trustStore, canonical, now = new Date(), overrides = {}) {
  return {
    now,
    productId: canonical.releaseContract.product_id,
    allowedChannels: canonical.releaseContract.supported_channels,
    allowedPayloadHosts: canonical.updatePolicy.allowed_payload_hosts,
    allowedReleaseNotesHosts: canonical.updatePolicy.allowed_release_notes_hosts,
    maximumPayloadBytes: canonical.updatePolicy.max_payload_bytes,
    trustStore,
    availableContracts: overrides.availableContracts || canonical.catalogContracts,
    currentVersion: overrides.currentVersion || validationCurrentVersion(catalog, canonical.releaseContract),
    previousSequence: 0,
    installationId: 'catalog-publication-validation',
  };
}

function verifyCanonicalCatalogShape(catalog, canonical, requireCanonicalMinimum) {
  if (!CHANNELS.has(catalog.channel)) fail('Catalog channel is invalid.', 'CATALOG_CHANNEL');
  if (requireCanonicalMinimum && catalog.release.minimum_supported_version !== canonical.releaseContract.minimum_supported_version) fail('Catalog minimum supported version differs from the canonical release contract.', 'CATALOG_MINIMUM_VERSION');
  const expectedArchitectureSuffix = `-win-${canonical.architecture}.zip`.toLowerCase();
  if (!String(catalog.release.payload.file_name || '').toLowerCase().endsWith(expectedArchitectureSuffix)) fail('Catalog payload architecture differs from the canonical Windows release.', 'CATALOG_ARCHITECTURE');
  const payloadName = path.posix.basename(new URL(catalog.release.payload.url).pathname);
  if (payloadName !== catalog.release.payload.file_name) fail('Catalog payload URL and file name differ.', 'CATALOG_PAYLOAD_NAME_MISMATCH');
  const rollout = catalog.release.rollout_percent;
  if (catalog.channel === 'stable' && ![0, 5, 25, 100].includes(rollout)) fail('Stable rollout must be 0, 5, 25 or 100 percent.', 'CATALOG_STABLE_ROLLOUT');
}

function verifyReleaseStatusForPublication(channel, releaseStatus) {
  const allowed = channel === 'stable'
    ? new Set(['released'])
    : channel === 'staging'
      ? new Set(['candidate', 'released'])
      : new Set(['development', 'candidate', 'released']);
  if (!allowed.has(releaseStatus)) fail(`Release status ${releaseStatus || '<missing>'} cannot be published to ${channel}.`, 'CATALOG_RELEASE_STATUS');
}

function readReleaseBuildEvidence(options = {}) {
  const identityFile = options.buildIdentityFile;
  const manifestFile = options.buildManifestFile;
  if (!identityFile || !manifestFile) fail('A release or rollback directive requires trusted build identity and BUILD-MANIFEST evidence.', 'CATALOG_BUILD_EVIDENCE_REQUIRED');
  return {
    identity: readJsonFile(identityFile, MAX_BUILD_EVIDENCE_BYTES),
    manifest: readJsonFile(manifestFile, MAX_BUILD_EVIDENCE_BYTES),
  };
}

function verifyReleaseBuildEvidence(catalog, canonical, options = {}) {
  if (catalog?.directive?.mode !== 'release') return null;
  verifyReleaseStatusForPublication(catalog.channel, canonical.releaseContract.release_status);
  const evidenceFiles = readReleaseBuildEvidence(options);
  const identity = evidenceFiles.identity.value;
  const manifest = evidenceFiles.manifest.value;
  const release = catalog.release;
  if (identity?.schema_version !== 1 || manifest?.schema_version !== 3) fail('Build evidence schema is invalid.', 'CATALOG_BUILD_EVIDENCE_INVALID');
  if (identity.product_id !== canonical.releaseContract.product_id || manifest.product_id !== identity.product_id) fail('Build evidence product differs from the canonical release.', 'CATALOG_PRODUCT_MISMATCH');
  if (release.version !== canonical.releaseContract.version || identity.version !== canonical.releaseContract.version || manifest.version !== identity.version) fail('Catalog version differs from the canonical build evidence.', 'CATALOG_VERSION_MISMATCH');
  if (identity.release_status !== canonical.releaseContract.release_status) fail('Build identity release status differs from the canonical release contract.', 'CATALOG_RELEASE_STATUS');
  if (identity.release_contract_sha256 !== canonical.evidence.release_contract_sha256) fail('Build identity is bound to a different release contract.', 'CATALOG_RELEASE_CONTRACT_MISMATCH');
  if (identity.source_dirty !== false) fail('Release build identity describes a dirty source tree.', 'CATALOG_DIRTY_BUILD');
  if (!/^[0-9a-f]{40}$/.test(String(identity.commit_sha || '')) || manifest.commit_sha !== identity.commit_sha || release.commit_sha !== identity.commit_sha) fail('Catalog commit differs from the trusted build evidence.', 'CATALOG_COMMIT_MISMATCH');
  const expectedBuildId = `jf-${identity.version}-${identity.commit_sha.slice(0, 12)}`;
  if (identity.build_id !== expectedBuildId || manifest.build_id !== identity.build_id || release.build_id !== identity.build_id) fail('Catalog build ID differs from the trusted build evidence.', 'CATALOG_BUILD_ID_MISMATCH');
  if (!/^[0-9a-f]{40}$/.test(String(identity.source_tree || '')) || manifest.source_tree !== identity.source_tree) fail('BUILD-MANIFEST source tree differs from the build identity.', 'CATALOG_BUILD_EVIDENCE_INVALID');
  if (!sameRecord(identity.contracts, canonical.releaseContract.contracts) || !sameRecord(manifest.contracts, canonical.releaseContract.contracts)) fail('Build evidence contracts differ from the canonical release contract.', 'CATALOG_BUILD_CONTRACT_MISMATCH');
  const manifestPayload = manifest?.artifacts?.update_payload;
  const manifestUpdateFiles = manifest?.artifacts?.update_file_manifest;
  const manifestPayloadName = path.posix.basename(String(manifestPayload?.path || '').replace(/\\/g, '/'));
  const manifestUpdateFilesName = path.posix.basename(String(manifestUpdateFiles?.path || '').replace(/\\/g, '/')).toUpperCase();
  if (manifestPayloadName !== release.payload.file_name
    || manifestPayload?.bytes !== release.payload.bytes
    || manifestPayload?.sha256 !== release.payload.sha256
    || manifestPayload?.unpacked_bytes !== release.payload.unpacked_bytes
    || manifestPayload?.file_count !== release.payload.file_count
    || manifestUpdateFilesName !== 'UPDATE-FILES.JSON'
    || manifestUpdateFiles?.sha256 !== release.payload.file_manifest_sha256) {
    fail('Catalog payload differs from BUILD-MANIFEST evidence.', 'CATALOG_PAYLOAD_EVIDENCE_MISMATCH');
  }
  return {
    build_identity_sha256: exactDocumentSha256(evidenceFiles.identity.bytes),
    build_manifest_sha256: exactDocumentSha256(evidenceFiles.manifest.bytes),
    build_id: identity.build_id,
    commit_sha: identity.commit_sha,
    release_status: identity.release_status,
  };
}

function verifyHistoricalRollbackBuildEvidence(catalog, options = {}) {
  if (catalog?.directive?.mode !== 'rollback') return null;
  const evidenceFiles = readReleaseBuildEvidence(options);
  const identity = evidenceFiles.identity.value;
  const manifest = evidenceFiles.manifest.value;
  const release = catalog.release;
  if (identity?.schema_version !== 1 || manifest?.schema_version !== 3) fail('Historical build evidence schema is invalid.', 'CATALOG_HISTORICAL_BUILD_EVIDENCE_INVALID');
  if (identity.product_id !== catalog.product_id || manifest.product_id !== identity.product_id) fail('Rollback build evidence belongs to another product.', 'CATALOG_PRODUCT_MISMATCH');
  if (identity.version !== release.version || manifest.version !== identity.version) fail('Rollback version differs from historical build evidence.', 'CATALOG_VERSION_MISMATCH');
  verifyReleaseStatusForPublication(catalog.channel, identity.release_status);
  if (!/^[0-9a-f]{64}$/.test(String(identity.release_contract_sha256 || ''))) fail('Historical release contract digest is invalid.', 'CATALOG_HISTORICAL_BUILD_EVIDENCE_INVALID');
  if (identity.source_dirty !== false) fail('Historical rollback evidence describes a dirty source tree.', 'CATALOG_DIRTY_BUILD');
  if (!/^[0-9a-f]{40}$/.test(String(identity.commit_sha || '')) || manifest.commit_sha !== identity.commit_sha || release.commit_sha !== identity.commit_sha) fail('Rollback commit differs from historical build evidence.', 'CATALOG_COMMIT_MISMATCH');
  const expectedBuildId = `jf-${identity.version}-${identity.commit_sha.slice(0, 12)}`;
  if (identity.build_id !== expectedBuildId || manifest.build_id !== identity.build_id || release.build_id !== identity.build_id) fail('Rollback build ID differs from historical build evidence.', 'CATALOG_BUILD_ID_MISMATCH');
  if (!/^[0-9a-f]{40}$/.test(String(identity.source_tree || '')) || manifest.source_tree !== identity.source_tree || manifest.channel !== identity.channel) fail('Historical BUILD-MANIFEST identity is inconsistent.', 'CATALOG_HISTORICAL_BUILD_EVIDENCE_INVALID');
  if (!sameRecord(identity.contracts, manifest.contracts)) fail('Historical build evidence contract sets differ.', 'CATALOG_BUILD_CONTRACT_MISMATCH');
  for (const [name, version] of Object.entries(release.required_contracts)) {
    if (identity.contracts?.[name] !== version) fail(`Rollback contract differs from historical build evidence: ${name}.`, 'CATALOG_BUILD_CONTRACT_MISMATCH');
  }
  const manifestPayload = manifest?.artifacts?.update_payload;
  const manifestUpdateFiles = manifest?.artifacts?.update_file_manifest;
  const manifestPayloadName = path.posix.basename(String(manifestPayload?.path || '').replace(/\\/g, '/'));
  const manifestUpdateFilesName = path.posix.basename(String(manifestUpdateFiles?.path || '').replace(/\\/g, '/')).toUpperCase();
  if (manifestPayloadName !== release.payload.file_name
    || manifestPayload?.bytes !== release.payload.bytes
    || manifestPayload?.sha256 !== release.payload.sha256
    || manifestPayload?.unpacked_bytes !== release.payload.unpacked_bytes
    || manifestPayload?.file_count !== release.payload.file_count
    || manifestUpdateFilesName !== 'UPDATE-FILES.JSON'
    || manifestUpdateFiles?.sha256 !== release.payload.file_manifest_sha256) {
    fail('Rollback payload differs from historical BUILD-MANIFEST evidence.', 'CATALOG_PAYLOAD_EVIDENCE_MISMATCH');
  }
  return {
    build_identity_sha256: exactDocumentSha256(evidenceFiles.identity.bytes),
    build_manifest_sha256: exactDocumentSha256(evidenceFiles.manifest.bytes),
    build_id: identity.build_id,
    commit_sha: identity.commit_sha,
    release_status: identity.release_status,
    historical: true,
  };
}

function verifyStableRolloutTransition(target, current = null) {
  if (target?.channel !== 'stable' || target?.directive?.mode !== 'release') return;
  const after = target.release.rollout_percent;
  if (!current) {
    if (after > 5) fail('The first publication of a stable build must start at no more than 5 percent.', 'CATALOG_CANARY_REQUIRED');
    return;
  }
  const sameBuild = current.release.build_id === target.release.build_id;
  const before = current.release.rollout_percent;
  if (!sameBuild && after > 5) fail('A new stable build must start at no more than 5 percent.', 'CATALOG_CANARY_REQUIRED');
  if (sameBuild && after < before) fail('A stable release rollout cannot move backwards; use a signed halt or rollback directive.', 'CATALOG_ROLLOUT_REGRESSION');
  if (sameBuild && ((before === 5 && after === 100) || (before === 0 && after > 5))) fail('Stable rollout cannot skip the 25 percent stage.', 'CATALOG_ROLLOUT_STAGE_SKIPPED');
}

function verifyForPublication(catalog, trustStore, options = {}) {
  if (catalog?.directive?.mode === 'rollback') {
    const result = verifyHistoricalPublication(catalog, trustStore, options);
    const build = verifyHistoricalRollbackBuildEvidence(catalog, options);
    return { ...result, canonical: { ...result.canonical, ...build } };
  }
  if (catalog?.directive?.mode !== 'release') return verifyHistoricalPublication(catalog, trustStore, options);
  const canonical = loadCanonicalPublicationContract();
  const result = validateSignedCatalog(catalog, publicationValidationOptions(catalog, trustStore, canonical, options.now));
  verifyCanonicalCatalogShape(catalog, canonical, true);
  const build = verifyReleaseBuildEvidence(catalog, canonical, options);
  return { ...result, canonical: build ? { ...canonical.evidence, ...build } : canonical.evidence };
}

function inspectForEvidenceResolution(catalog, trustStore, options = {}) {
  if (!['halt', 'rollback'].includes(catalog?.directive?.mode)) fail('Historical inspection accepts only halt or rollback directives.', 'CATALOG_INSPECTION_DIRECTIVE');
  return verifyHistoricalPublication(catalog, trustStore, options);
}

function verifyHistoricalPublication(catalog, trustStore, options = {}) {
  const canonical = loadCanonicalPublicationContract();
  const requiredContracts = catalog?.release?.required_contracts;
  if (!requiredContracts || typeof requiredContracts !== 'object' || Array.isArray(requiredContracts) || !sameStrings(Object.keys(requiredContracts), CATALOG_CONTRACT_NAMES)) fail('Historical catalog contract set is invalid.', 'CATALOG_HISTORICAL_CONTRACTS');
  const historicalContracts = Object.fromEntries(CATALOG_CONTRACT_NAMES.map(name => {
    const version = requiredContracts[name];
    if (!Number.isInteger(version) || version < 1) fail(`Historical catalog contract is invalid: ${name}.`, 'CATALOG_HISTORICAL_CONTRACTS');
    return [name, version];
  }));
  const currentVersion = validationCurrentVersion(catalog, { version: catalog?.release?.version });
  const result = validateSignedCatalog(catalog, publicationValidationOptions(catalog, trustStore, canonical, options.now, { availableContracts: historicalContracts, currentVersion }));
  verifyCanonicalCatalogShape(catalog, canonical, false);
  return { ...result, canonical: canonical.evidence };
}

function exactDocumentSha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function planPublication(targetFile, trustStoreFile, currentFile = null, options = {}) {
  const target = readJsonFile(targetFile);
  const trust = readJsonFile(trustStoreFile, 1_048_576).value;
  const validation = verifyForPublication(target.value, trust, options);
  let current = null;
  let currentValidation = null;
  let publicationAction = 'publish';
  if (currentFile && fs.existsSync(currentFile) && fs.statSync(currentFile).size > 0) {
    current = readJsonFile(currentFile);
    const verificationTime = new Date(new Date(current.value.generated_at).getTime() + 1_000);
    currentValidation = verifyHistoricalPublication(current.value, trust, { now: verificationTime });
    if (current.value.channel !== target.value.channel) fail('Current and target catalogs use different channels.', 'CATALOG_CHANNEL_MISMATCH');
    if (target.value.catalog_sequence === current.value.catalog_sequence) {
      if (!target.bytes.equals(current.bytes)) fail('Published catalog sequence already contains different bytes.', 'CATALOG_SEQUENCE_CONFLICT');
      publicationAction = 'noop';
    } else {
      if (target.value.catalog_sequence < current.value.catalog_sequence) fail('Target catalog sequence must not be lower than the published sequence.', 'CATALOG_SEQUENCE_NOT_ADVANCED');
      if (new Date(target.value.generated_at) < new Date(current.value.generated_at)) fail('Target catalog generation time moved backwards.', 'CATALOG_TIME_REGRESSION');
      if (target.value.directive.mode === 'halt' && !target.value.directive.withdrawn_build_ids.includes(current.value.release.build_id)) fail('A halt directive must withdraw the currently published build.', 'CATALOG_HALT_CURRENT_BUILD');
      if (target.value.directive.mode === 'rollback') {
        if (!target.value.directive.withdrawn_build_ids.includes(current.value.release.build_id) || !target.value.directive.rollback_from_versions.includes(current.value.release.version)) fail('A rollback directive must withdraw and name the currently published release.', 'CATALOG_ROLLBACK_CURRENT_BUILD');
        if (target.value.directive.rollback_from_versions.some(version => compareSemver(target.value.release.version, version) >= 0)) fail('A rollback target must be lower than every named source version.', 'CATALOG_ROLLBACK_DIRECTION');
      }
      verifyStableRolloutTransition(target.value, current.value);
    }
  } else {
    if (target.value.directive.mode !== 'release') fail('A halt or rollback directive requires a currently published catalog.', 'CATALOG_DIRECTIVE_REQUIRES_CURRENT');
    verifyStableRolloutTransition(target.value, null);
  }
  const exactSha256 = exactDocumentSha256(target.bytes);
  return {
    schema_version: 1,
    channel: target.value.channel,
    catalog_sequence: target.value.catalog_sequence,
    build_id: target.value.release.build_id,
    version: target.value.release.version,
    directive: target.value.directive.mode,
    publication_action: publicationAction,
    rollout_percent: target.value.release.rollout_percent,
    signing_key_id: validation.keyId,
    signing_digest: catalogDigest(target.value),
    exact_document_sha256: exactSha256,
    canonical: validation.canonical,
    public_catalog_url: loadCanonicalPublicationContract().catalogEndpoints[target.value.channel],
    active_key: `catalog:${target.value.channel}`,
    immutable_key: `history:${target.value.channel}:${target.value.catalog_sequence}:${exactSha256}`,
    previous: current ? {
      catalog_sequence: current.value.catalog_sequence,
      build_id: current.value.release.build_id,
      signing_key_id: currentValidation.keyId,
      exact_document_sha256: exactDocumentSha256(current.bytes),
      immutable_key: `history:${current.value.channel}:${current.value.catalog_sequence}:${exactDocumentSha256(current.bytes)}`,
    } : null,
  };
}

function atomicWriteJson(file, value) {
  const absolute = path.resolve(file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, absolute);
}

function signCatalog(inputFile, outputFile, trustStoreFile, keyId, privateKeyPath, options = {}) {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(String(keyId || ''))) fail('Signing key id is invalid.', 'CATALOG_KEY_ID');
  const input = readJsonFile(inputFile);
  const trust = readJsonFile(trustStoreFile, 1_048_576).value;
  if (!input.value?.signature || input.value.signature.algorithm !== 'Ed25519' || input.value.signature.key_id !== keyId || input.value.signature.value !== '') fail('Unsigned catalog must contain the selected Ed25519 key id and an empty signature value.', 'CATALOG_UNSIGNED_SHAPE');
  const keyFile = path.resolve(privateKeyPath || '');
  if (!privateKeyPath || !fs.existsSync(keyFile) || !fs.statSync(keyFile).isFile()) fail('The protected Ed25519 private key file is unavailable.', 'CATALOG_PRIVATE_KEY_MISSING');
  let privateKey;
  try { privateKey = crypto.createPrivateKey(fs.readFileSync(keyFile)); }
  catch { fail('The protected signing key cannot be loaded.', 'CATALOG_PRIVATE_KEY_INVALID'); }
  if (privateKey.asymmetricKeyType !== 'ed25519') fail('The protected signing key is not Ed25519.', 'CATALOG_PRIVATE_KEY_TYPE');
  const trusted = trust?.keys?.find(item => item?.key_id === keyId && ['active', 'next'].includes(item.status));
  if (!trusted?.public_key_spki_base64) fail('The selected signing key is not present as active or next in the application trust store.', 'CATALOG_KEY_NOT_TRUSTED');
  const derived = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  let expected;
  try { expected = Buffer.from(trusted.public_key_spki_base64, 'base64'); }
  catch { fail('The trusted public key is invalid.', 'CATALOG_TRUST_KEY_INVALID'); }
  if (!derived.equals(expected)) fail('The private key does not match the selected trusted public key.', 'CATALOG_KEY_MISMATCH');
  const signed = structuredClone(input.value);
  signed.signature.value = crypto.sign(null, canonicalBytes(signingDocument(signed)), privateKey).toString('base64');
  verifyForPublication(signed, trust, options);
  atomicWriteJson(outputFile, signed);
  return {
    schema_version: 1,
    output: path.resolve(outputFile),
    channel: signed.channel,
    catalog_sequence: signed.catalog_sequence,
    key_id: keyId,
    signing_digest: catalogDigest(signed),
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    if (!/^--[a-z-]+$/.test(name || '') || index + 1 >= rest.length) fail(`Invalid argument: ${name || ''}`, 'CATALOG_ARGUMENT');
    values[name.slice(2)] = rest[index + 1];
  }
  return { command, values };
}

function required(values, name) {
  if (!values[name]) fail(`Missing --${name}.`, 'CATALOG_ARGUMENT');
  return values[name];
}

function buildEvidenceOptions(values) {
  return {
    buildIdentityFile: values['build-identity'] || null,
    buildManifestFile: values['build-manifest'] || null,
  };
}

function main(argv) {
  const { command, values } = parseArgs(argv);
  if (command === 'sign') {
    return signCatalog(required(values, 'input'), required(values, 'output'), required(values, 'trust-store'), required(values, 'key-id'), required(values, 'private-key-path'), buildEvidenceOptions(values));
  }
  if (command === 'verify') {
    const loaded = readJsonFile(required(values, 'catalog'));
    const trust = readJsonFile(required(values, 'trust-store'), 1_048_576).value;
    const result = verifyForPublication(loaded.value, trust, buildEvidenceOptions(values));
    return { ok: true, channel: loaded.value.channel, catalog_sequence: loaded.value.catalog_sequence, key_id: result.keyId, signing_digest: result.digest, exact_document_sha256: exactDocumentSha256(loaded.bytes), canonical: result.canonical };
  }
  if (command === 'inspect') {
    const loaded = readJsonFile(required(values, 'catalog'));
    const trust = readJsonFile(required(values, 'trust-store'), 1_048_576).value;
    const result = inspectForEvidenceResolution(loaded.value, trust);
    return { ok: true, channel: loaded.value.channel, catalog_sequence: loaded.value.catalog_sequence, directive: loaded.value.directive.mode, commit_sha: loaded.value.release.commit_sha, build_id: loaded.value.release.build_id, key_id: result.keyId, signing_digest: result.digest, exact_document_sha256: exactDocumentSha256(loaded.bytes) };
  }
  if (command === 'plan') {
    const plan = planPublication(required(values, 'catalog'), required(values, 'trust-store'), values.current || null, buildEvidenceOptions(values));
    atomicWriteJson(required(values, 'output'), plan);
    return plan;
  }
  fail('Usage: update-catalog-ops.mjs <sign|verify|inspect|plan> [options]', 'CATALOG_ARGUMENT');
}

export { exactDocumentSha256, inspectForEvidenceResolution, planPublication, readJsonFile, signCatalog, verifyForPublication, verifyHistoricalRollbackBuildEvidence, verifyReleaseStatusForPublication, verifyStableRolloutTransition };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)), null, 2)}\n`); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: String(error?.code || 'CATALOG_OPERATION_FAILED'), error: String(error?.message || 'Catalog operation failed.') })}\n`);
    process.exitCode = 2;
  }
}
