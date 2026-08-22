'use strict';

const crypto = require('crypto');
const { canonicalBytes } = require('./canonical-json.cjs');
const { compareSemver, parseSemver } = require('./semver.cjs');

function updateError(code, message) {
  return Object.assign(new Error(message), { code });
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, required, label) {
  if (!plainObject(value)) throw updateError('UPDATE_CATALOG_FORMAT', `${label} must be an object.`);
  const actual = Object.keys(value).sort(), expected = [...required].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw updateError('UPDATE_CATALOG_FORMAT', `${label} has unexpected or missing fields.`);
  }
}

function validHttpsUrl(value, allowedHosts, label) {
  let parsed;
  try { parsed = new URL(String(value || '')); }
  catch { throw updateError('UPDATE_URL_INVALID', `${label} is not a valid URL.`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || (parsed.port && parsed.port !== '443')) {
    throw updateError('UPDATE_URL_INVALID', `${label} must be credential-free HTTPS without a fragment.`);
  }
  const allowed = new Set((allowedHosts || []).map(item => String(item).toLowerCase()));
  if (!allowed.has(parsed.hostname.toLowerCase())) throw updateError('UPDATE_URL_HOST', `${label} host is not allowed.`);
  return parsed;
}

function strictBase64(value, code, message) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw updateError(code, message);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw updateError(code, message);
  return decoded;
}

function signingDocument(catalog) {
  const document = { ...catalog };
  delete document.signature;
  return document;
}

function catalogDigest(catalog) {
  return crypto.createHash('sha256').update(canonicalBytes(signingDocument(catalog))).digest('hex');
}

function publicKeyFromEntry(entry) {
  if (entry.public_key_spki_base64) {
    const der = strictBase64(entry.public_key_spki_base64, 'UPDATE_KEY_FORMAT', 'Trusted Ed25519 SPKI key is not valid Base64.');
    if (der.length < 40 || der.length > 80) throw updateError('UPDATE_KEY_FORMAT', 'Trusted Ed25519 SPKI key has an invalid size.');
    return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  }
  if (entry.public_key_pem) return crypto.createPublicKey(entry.public_key_pem);
  throw updateError('UPDATE_KEY_FORMAT', 'Trusted Ed25519 public key is missing.');
}

function rolloutBucket(installationId, buildId) {
  const digest = crypto.createHash('sha256').update(`${installationId}\0${buildId}`, 'utf8').digest();
  return digest.readUInt32BE(0) % 100;
}

function validateSignedCatalog(catalog, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) throw updateError('UPDATE_CLOCK_INVALID', 'Local update clock is invalid.');
  exactKeys(catalog, ['schema_version', 'product_id', 'channel', 'catalog_sequence', 'generated_at', 'expires_at', 'directive', 'release', 'signature'], 'catalog');
  if (catalog.schema_version !== 1) throw updateError('UPDATE_CATALOG_SCHEMA', 'Unsupported update catalog schema.');
  if (catalog.product_id !== options.productId) throw updateError('UPDATE_PRODUCT_MISMATCH', 'Update catalog belongs to another product.');
  if (!new Set(options.allowedChannels || []).has(catalog.channel)) throw updateError('UPDATE_CHANNEL_REJECTED', 'Update channel is not allowed.');
  if (!Number.isSafeInteger(catalog.catalog_sequence) || catalog.catalog_sequence < 1) throw updateError('UPDATE_SEQUENCE_INVALID', 'Catalog sequence is invalid.');
  const generatedAt = new Date(catalog.generated_at), expiresAt = new Date(catalog.expires_at);
  if (Number.isNaN(generatedAt.getTime()) || Number.isNaN(expiresAt.getTime()) || expiresAt <= generatedAt) throw updateError('UPDATE_CATALOG_TIME', 'Catalog timestamps are invalid.');
  const clockSkewMs = Number(options.clockSkewMs ?? 300000);
  if (generatedAt.getTime() > now.getTime() + clockSkewMs) throw updateError('UPDATE_CATALOG_FUTURE', 'Catalog was generated in the future.');
  if (expiresAt.getTime() < now.getTime() - clockSkewMs) throw updateError('UPDATE_CATALOG_EXPIRED', 'Update catalog has expired.');

  exactKeys(catalog.directive, ['mode', 'withdrawn_build_ids', 'rollback_from_versions', 'message'], 'directive');
  const directive = catalog.directive;
  if (!['release', 'halt', 'rollback'].includes(directive.mode)) throw updateError('UPDATE_DIRECTIVE_MODE', 'Update directive mode is invalid.');
  if (!Array.isArray(directive.withdrawn_build_ids) || directive.withdrawn_build_ids.length > 64 || new Set(directive.withdrawn_build_ids).size !== directive.withdrawn_build_ids.length || directive.withdrawn_build_ids.some(item => typeof item !== 'string' || !/^[A-Za-z0-9._-]{1,160}$/.test(item))) throw updateError('UPDATE_WITHDRAWN_BUILDS', 'Withdrawn update build identifiers are invalid.');
  if (!Array.isArray(directive.rollback_from_versions) || directive.rollback_from_versions.length > 32 || new Set(directive.rollback_from_versions).size !== directive.rollback_from_versions.length) throw updateError('UPDATE_ROLLBACK_VERSIONS', 'Rollback source versions are invalid.');
  for (const version of directive.rollback_from_versions) parseSemver(version);
  if (!(directive.message === null || (typeof directive.message === 'string' && directive.message.length <= 500))) throw updateError('UPDATE_DIRECTIVE_MESSAGE', 'Update directive message is invalid.');

  exactKeys(catalog.signature, ['algorithm', 'key_id', 'value'], 'signature');
  if (catalog.signature.algorithm !== 'Ed25519') throw updateError('UPDATE_SIGNATURE_ALGORITHM', 'Only Ed25519 update signatures are accepted.');
  const trustStore = options.trustStore;
  if (!plainObject(trustStore) || trustStore.schema_version !== 1 || !Array.isArray(trustStore.keys)) throw updateError('UPDATE_TRUST_STORE', 'Update trust store is invalid.');
  const key = trustStore.keys.find(item => item && item.key_id === catalog.signature.key_id);
  if (!key) throw updateError('UPDATE_KEY_UNKNOWN', 'Update signing key is unknown.');
  if (key.status === 'revoked') throw updateError('UPDATE_KEY_REVOKED', 'Update signing key is revoked.');
  if (!['active', 'next'].includes(key.status) || key.algorithm !== 'Ed25519') throw updateError('UPDATE_KEY_REJECTED', 'Update signing key is not trusted.');
  const signature = strictBase64(catalog.signature.value, 'UPDATE_SIGNATURE_FORMAT', 'Update signature is not valid Base64.');
  if (signature.length !== 64) throw updateError('UPDATE_SIGNATURE_FORMAT', 'Ed25519 signature must be 64 bytes.');
  let verified = false;
  try { verified = crypto.verify(null, canonicalBytes(signingDocument(catalog)), publicKeyFromEntry(key), signature); }
  catch (error) { if (error.code?.startsWith('UPDATE_')) throw error; throw updateError('UPDATE_KEY_FORMAT', 'Update public key cannot be used.'); }
  if (!verified) throw updateError('UPDATE_SIGNATURE_INVALID', 'Update catalog signature is invalid.');

  exactKeys(catalog.release, ['version', 'build_id', 'commit_sha', 'published_at', 'minimum_supported_version', 'mandatory_after', 'rollout_percent', 'summary', 'release_notes_url', 'required_contracts', 'payload'], 'release');
  parseSemver(catalog.release.version);
  parseSemver(catalog.release.minimum_supported_version);
  if (!/^[0-9a-f]{40}$/.test(catalog.release.commit_sha)) throw updateError('UPDATE_COMMIT_INVALID', 'Release commit SHA is invalid.');
  if (typeof catalog.release.build_id !== 'string' || !catalog.release.build_id.includes(catalog.release.version)) throw updateError('UPDATE_BUILD_ID', 'Release build ID is invalid.');
  if (!Number.isInteger(catalog.release.rollout_percent) || catalog.release.rollout_percent < 0 || catalog.release.rollout_percent > 100) throw updateError('UPDATE_ROLLOUT_INVALID', 'Rollout percentage is invalid.');
  if (typeof catalog.release.summary !== 'string' || catalog.release.summary.trim().length < 1 || catalog.release.summary.length > 500 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(catalog.release.summary)) throw updateError('UPDATE_SUMMARY_INVALID', 'Release summary is invalid.');
  const publishedAt = new Date(catalog.release.published_at);
  if (Number.isNaN(publishedAt.getTime()) || publishedAt > now.getTime() + clockSkewMs) throw updateError('UPDATE_PUBLISHED_AT', 'Release publication time is invalid.');
  const mandatoryAfter = catalog.release.mandatory_after === null ? null : new Date(catalog.release.mandatory_after);
  if (mandatoryAfter && Number.isNaN(mandatoryAfter.getTime())) throw updateError('UPDATE_MANDATORY_AT', 'Mandatory update time is invalid.');
  validHttpsUrl(catalog.release.release_notes_url, options.allowedReleaseNotesHosts || options.allowedPayloadHosts, 'Release notes URL');
  exactKeys(catalog.release.payload, ['file_name', 'url', 'bytes', 'sha256', 'unpacked_bytes', 'file_count', 'file_manifest_sha256'], 'payload');
  if (!/^[^/\\]+\.zip$/i.test(catalog.release.payload.file_name)) throw updateError('UPDATE_PAYLOAD_NAME', 'Update payload file name is invalid.');
  if (!Number.isSafeInteger(catalog.release.payload.bytes) || catalog.release.payload.bytes < 1 || catalog.release.payload.bytes > Number(options.maximumPayloadBytes || 2_000_000_000)) throw updateError('UPDATE_PAYLOAD_SIZE', 'Update payload size is invalid.');
  if (!/^[0-9a-f]{64}$/.test(catalog.release.payload.sha256)) throw updateError('UPDATE_PAYLOAD_HASH', 'Update payload SHA-256 is invalid.');
  if (!Number.isSafeInteger(catalog.release.payload.unpacked_bytes) || catalog.release.payload.unpacked_bytes < 1 || catalog.release.payload.unpacked_bytes > Number(options.maximumUnpackedBytes || 8_000_000_000)) throw updateError('UPDATE_UNPACKED_SIZE', 'Update unpacked size is invalid.');
  if (!Number.isSafeInteger(catalog.release.payload.file_count) || catalog.release.payload.file_count < 1 || catalog.release.payload.file_count > Number(options.maximumFileCount || 100_000)) throw updateError('UPDATE_FILE_COUNT', 'Update file count is invalid.');
  if (!/^[0-9a-f]{64}$/.test(catalog.release.payload.file_manifest_sha256)) throw updateError('UPDATE_FILE_MANIFEST_HASH', 'Update file manifest SHA-256 is invalid.');
  validHttpsUrl(catalog.release.payload.url, options.allowedPayloadHosts, 'Payload URL');
  if (directive.mode === 'halt' && (catalog.release.rollout_percent !== 0 || !directive.withdrawn_build_ids.includes(catalog.release.build_id))) throw updateError('UPDATE_HALT_INVALID', 'A halt directive must withdraw its build and set rollout to zero.');
  if (directive.mode !== 'rollback' && directive.rollback_from_versions.length !== 0) throw updateError('UPDATE_ROLLBACK_VERSIONS', 'Rollback source versions are allowed only for a rollback directive.');
  if (directive.mode === 'rollback' && directive.rollback_from_versions.length === 0) throw updateError('UPDATE_ROLLBACK_VERSIONS', 'A rollback directive must identify affected installed versions.');

  const requiredContracts = catalog.release.required_contracts;
  if (!plainObject(requiredContracts)) throw updateError('UPDATE_CONTRACT_FORMAT', 'Required contracts are invalid.');
  const expectedContractNames = Object.keys(options.availableContracts || {}).sort();
  if (expectedContractNames.length === 0 || JSON.stringify(Object.keys(requiredContracts).sort()) !== JSON.stringify(expectedContractNames)) {
    throw updateError('UPDATE_CONTRACT_FORMAT', 'Required contract set does not match this client.');
  }
  for (const [name, required] of Object.entries(requiredContracts)) {
    if (!Number.isInteger(required) || required < 1 || Number(options.availableContracts?.[name]) !== required) {
      throw updateError('UPDATE_CONTRACT_MISMATCH', `Required contract is unavailable: ${name}.`);
    }
  }
  const currentVersion = String(options.currentVersion || '');
  parseSemver(currentVersion);
  if (compareSemver(currentVersion, catalog.release.minimum_supported_version) < 0) throw updateError('UPDATE_CLIENT_TOO_OLD', 'Installed version is below the safe automatic-update boundary.');
  const versionDirection = compareSemver(catalog.release.version, currentVersion);
  const rollbackPermitted = directive.mode === 'rollback' && versionDirection < 0 && directive.rollback_from_versions.includes(currentVersion);
  if (directive.mode === 'rollback' && !rollbackPermitted) throw updateError('UPDATE_ROLLBACK_NOT_APPLICABLE', 'Signed rollback does not apply to this installed version.');
  if (versionDirection < 0 && !rollbackPermitted) throw updateError('UPDATE_DOWNGRADE_REJECTED', 'Automatic downgrade is not allowed without an applicable signed rollback directive.');
  if (directive.mode === 'rollback' && catalog.release.rollout_percent === 0) throw updateError('UPDATE_ROLLBACK_ROLLOUT', 'A rollback directive must have a non-zero rollout.');
  const digest = catalogDigest(catalog);
  const previousSequence = Number(options.previousSequence || 0);
  if (catalog.catalog_sequence < previousSequence) throw updateError('UPDATE_SEQUENCE_REGRESSION', 'Catalog sequence moved backwards.');
  if (catalog.catalog_sequence === previousSequence && options.previousDigest && options.previousDigest !== digest) throw updateError('UPDATE_SEQUENCE_REPLACED', 'Catalog content changed without a new sequence.');
  const installationId = String(options.installationId || '');
  if (!installationId) throw updateError('UPDATE_INSTALLATION_ID', 'Installation ID is unavailable.');
  const bucket = rolloutBucket(installationId, catalog.release.build_id);
  const rolloutEligible = directive.mode !== 'halt' && bucket < catalog.release.rollout_percent;
  return {
    catalog,
    digest,
    canonical: canonicalBytes(signingDocument(catalog)),
    keyId: key.key_id,
    updateAvailable: directive.mode !== 'halt' && (versionDirection > 0 || rollbackPermitted),
    mandatory: Boolean(mandatoryAfter && mandatoryAfter <= now),
    rolloutBucket: bucket,
    rolloutEligible,
    directive: Object.freeze({
      mode: directive.mode,
      withdrawnBuildIds: Object.freeze([...directive.withdrawn_build_ids]),
      rollbackFromVersions: Object.freeze([...directive.rollback_from_versions]),
      message: directive.message,
    }),
    rollbackRecommended: rollbackPermitted,
  };
}

module.exports = { updateError, signingDocument, catalogDigest, rolloutBucket, validateSignedCatalog };
