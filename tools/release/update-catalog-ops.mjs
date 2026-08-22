#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { canonicalBytes } = require('../../source/application/update/canonical-json.cjs');
const { catalogDigest, signingDocument, validateSignedCatalog } = require('../../source/application/update/catalog.cjs');
const { compareSemver } = require('../../source/application/update/semver.cjs');

const MAX_CATALOG_BYTES = 262_144;
const CHANNELS = new Set(['internal', 'staging', 'stable']);

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

function host(value) {
  try { return new URL(value).hostname.toLowerCase(); }
  catch { return ''; }
}

function validationCurrentVersion(catalog) {
  if (catalog?.directive?.mode === 'rollback') return String(catalog.directive.rollback_from_versions?.[0] || '');
  return String(catalog?.release?.minimum_supported_version || '');
}

function publicationValidationOptions(catalog, trustStore, now = new Date()) {
  return {
    now,
    productId: 'justfun-logistics',
    allowedChannels: [catalog.channel],
    allowedPayloadHosts: [host(catalog?.release?.payload?.url)].filter(Boolean),
    allowedReleaseNotesHosts: [host(catalog?.release?.release_notes_url)].filter(Boolean),
    maximumPayloadBytes: 2_000_000_000,
    trustStore,
    availableContracts: catalog?.release?.required_contracts || {},
    currentVersion: validationCurrentVersion(catalog),
    previousSequence: 0,
    installationId: 'catalog-publication-validation',
  };
}

function verifyForPublication(catalog, trustStore, options = {}) {
  const result = validateSignedCatalog(catalog, publicationValidationOptions(catalog, trustStore, options.now));
  if (!CHANNELS.has(catalog.channel)) fail('Catalog channel is invalid.', 'CATALOG_CHANNEL');
  const rollout = catalog.release.rollout_percent;
  if (catalog.channel === 'stable' && ![0, 5, 25, 100].includes(rollout)) fail('Stable rollout must be 0, 5, 25 or 100 percent.', 'CATALOG_STABLE_ROLLOUT');
  return result;
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
  if (currentFile && fs.existsSync(currentFile) && fs.statSync(currentFile).size > 0) {
    current = readJsonFile(currentFile);
    const verificationTime = new Date(new Date(current.value.generated_at).getTime() + 1_000);
    currentValidation = verifyForPublication(current.value, trust, { now: verificationTime });
    if (current.value.channel !== target.value.channel) fail('Current and target catalogs use different channels.', 'CATALOG_CHANNEL_MISMATCH');
    if (target.value.catalog_sequence <= current.value.catalog_sequence) fail('Target catalog sequence must be greater than the published sequence.', 'CATALOG_SEQUENCE_NOT_ADVANCED');
    if (new Date(target.value.generated_at) < new Date(current.value.generated_at)) fail('Target catalog generation time moved backwards.', 'CATALOG_TIME_REGRESSION');
    const sameBuild = current.value.release.build_id === target.value.release.build_id;
    if (target.value.directive.mode === 'halt' && !target.value.directive.withdrawn_build_ids.includes(current.value.release.build_id)) fail('A halt directive must withdraw the currently published build.', 'CATALOG_HALT_CURRENT_BUILD');
    if (target.value.directive.mode === 'rollback') {
      if (!target.value.directive.withdrawn_build_ids.includes(current.value.release.build_id) || !target.value.directive.rollback_from_versions.includes(current.value.release.version)) fail('A rollback directive must withdraw and name the currently published release.', 'CATALOG_ROLLBACK_CURRENT_BUILD');
      if (target.value.directive.rollback_from_versions.some(version => compareSemver(target.value.release.version, version) >= 0)) fail('A rollback target must be lower than every named source version.', 'CATALOG_ROLLBACK_DIRECTION');
    }
    if (target.value.channel === 'stable' && target.value.directive.mode === 'release') {
      const before = current.value.release.rollout_percent;
      const after = target.value.release.rollout_percent;
      if (!sameBuild && after > 5) fail('A new stable build must start at no more than 5 percent.', 'CATALOG_CANARY_REQUIRED');
      if (sameBuild && after < before) fail('A stable release rollout cannot move backwards; use a signed halt or rollback directive.', 'CATALOG_ROLLOUT_REGRESSION');
      if (sameBuild && ((before === 5 && after === 100) || (before === 0 && after > 5))) fail('Stable rollout cannot skip the 25 percent stage.', 'CATALOG_ROLLOUT_STAGE_SKIPPED');
    }
  } else {
    if (target.value.directive.mode !== 'release') fail('A halt or rollback directive requires a currently published catalog.', 'CATALOG_DIRECTIVE_REQUIRES_CURRENT');
    if (target.value.channel === 'stable' && target.value.release.rollout_percent > 5) fail('The first publication of a stable build must start at no more than 5 percent.', 'CATALOG_CANARY_REQUIRED');
  }
  const exactSha256 = exactDocumentSha256(target.bytes);
  return {
    schema_version: 1,
    channel: target.value.channel,
    catalog_sequence: target.value.catalog_sequence,
    build_id: target.value.release.build_id,
    version: target.value.release.version,
    directive: target.value.directive.mode,
    rollout_percent: target.value.release.rollout_percent,
    signing_key_id: validation.keyId,
    signing_digest: catalogDigest(target.value),
    exact_document_sha256: exactSha256,
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

function main(argv) {
  const { command, values } = parseArgs(argv);
  if (command === 'sign') {
    return signCatalog(required(values, 'input'), required(values, 'output'), required(values, 'trust-store'), required(values, 'key-id'), required(values, 'private-key-path'));
  }
  if (command === 'verify') {
    const loaded = readJsonFile(required(values, 'catalog'));
    const trust = readJsonFile(required(values, 'trust-store'), 1_048_576).value;
    const result = verifyForPublication(loaded.value, trust);
    return { ok: true, channel: loaded.value.channel, catalog_sequence: loaded.value.catalog_sequence, key_id: result.keyId, signing_digest: result.digest, exact_document_sha256: exactDocumentSha256(loaded.bytes) };
  }
  if (command === 'plan') {
    const plan = planPublication(required(values, 'catalog'), required(values, 'trust-store'), values.current || null);
    atomicWriteJson(required(values, 'output'), plan);
    return plan;
  }
  fail('Usage: update-catalog-ops.mjs <sign|verify|plan> [options]', 'CATALOG_ARGUMENT');
}

export { exactDocumentSha256, planPublication, readJsonFile, signCatalog, verifyForPublication };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)), null, 2)}\n`); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: String(error?.code || 'CATALOG_OPERATION_FAILED'), error: String(error?.message || 'Catalog operation failed.') })}\n`);
    process.exitCode = 2;
  }
}
