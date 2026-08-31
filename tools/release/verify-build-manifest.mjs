#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const failures = [];

function argument(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing required argument: ${name}`);
  return path.resolve(repository, args[index + 1]);
}

function optionalArgument(name) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? path.resolve(repository, args[index + 1]) : null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function verifyRecord(record, file, label) {
  assert(record && typeof record === 'object', `${label}: record is missing`);
  assert(fs.existsSync(file) && fs.statSync(file).isFile(), `${label}: file is missing: ${file}`);
  if (!record || !fs.existsSync(file) || !fs.statSync(file).isFile()) return;
  assert(record.bytes === fs.statSync(file).size, `${label}: byte count differs`);
  assert(record.sha256 === sha256(file), `${label}: SHA-256 differs`);
}

function artifactPath(record, label) {
  const relative = String(record?.path || '');
  const candidate = path.resolve(installerDirectory, ...relative.split('/'));
  assert(relative.length > 0 && !path.isAbsolute(relative), `${label}: path is empty or absolute`);
  assert(candidate.startsWith(installerDirectory + path.sep), `${label}: path escapes installer directory`);
  return candidate;
}

const manifestPath = argument('--manifest');
const identityPath = argument('--build-identity');
const sourceArchive = argument('--source-archive');
const payloadDirectory = argument('--payload-dir');
const installerDirectory = argument('--installer-dir');
const sbomPath = optionalArgument('--sbom');
const manifest = readJson(manifestPath);
const identity = readJson(identityPath);
const release = readJson(path.join(repository, 'source', 'application', 'release.json'));
const schema = readJson(path.join(repository, 'release', 'build-manifest.schema.json'));

assert(schema.$id === 'https://justfun.invalid/release/build-manifest.schema.json', 'BUILD-MANIFEST schema identity is invalid');
assert(manifest.schema_version === 3, 'BUILD-MANIFEST schema_version must be 3');
for (const field of ['product_id', 'product_name', 'version', 'channel', 'commit_sha', 'source_tree', 'build_id', 'generated_at_utc']) {
  assert(manifest[field] === identity[field], `BUILD-MANIFEST ${field} differs from build identity`);
}
assert(manifest.product_id === release.product_id, 'BUILD-MANIFEST product differs from release.json');
assert(manifest.version === release.version, 'BUILD-MANIFEST version differs from release.json');
assert(JSON.stringify(manifest.contracts) === JSON.stringify(release.contracts), 'BUILD-MANIFEST contracts differ from release.json');
assert(identity.source_dirty === false, 'build identity describes a dirty source tree');
assert(manifest.signing?.algorithm === 'Ed25519', 'BUILD-MANIFEST signing algorithm is invalid');
assert(['unsigned', 'signed'].includes(manifest.signing?.status), 'BUILD-MANIFEST signing status is invalid');
if (sbomPath) {
  assert(fs.existsSync(sbomPath) && fs.statSync(sbomPath).isFile(), `SBOM file is missing: ${sbomPath}`);
  if (fs.existsSync(sbomPath) && fs.statSync(sbomPath).isFile()) {
    assert(manifest.sbom?.sha256 === sha256(sbomPath), 'BUILD-MANIFEST SBOM SHA-256 differs');
    const sbom = readJson(sbomPath);
    assert(sbom.spdxVersion === 'SPDX-2.3', 'SBOM SPDX version is invalid');
    assert(sbom.SPDXID === 'SPDXRef-DOCUMENT', 'SBOM document SPDXID is invalid');
    assert(Array.isArray(sbom.packages) && sbom.packages.length > 1, 'SBOM package inventory is incomplete');
  }
}
assert(Array.isArray(manifest.test_groups) && manifest.test_groups.length > 0, 'BUILD-MANIFEST test groups are missing');
assert(manifest.test_groups?.every(item => item?.status === 'passed'), 'BUILD-MANIFEST contains a non-passing test group');

verifyRecord(manifest.source_archive, sourceArchive, 'source archive');
for (const record of manifest.lockfiles || []) {
  const lockfile = path.resolve(repository, ...String(record.path || '').split('/'));
  assert(lockfile.startsWith(repository + path.sep), `lockfile path escapes repository: ${record.path}`);
  verifyRecord(record, lockfile, `lockfile ${record.path}`);
}

const actualPayloadFiles = fs.readdirSync(payloadDirectory, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => path.join(entry.parentPath, entry.name));
const declaredPayload = new Map((manifest.payload?.files || []).map(record => [String(record.path).toLowerCase(), record]));
assert(declaredPayload.size === actualPayloadFiles.length, 'payload file count differs from BUILD-MANIFEST');
for (const file of actualPayloadFiles) {
  const relative = path.relative(payloadDirectory, file).split(path.sep).join('/');
  const record = declaredPayload.get(relative.toLowerCase());
  verifyRecord(record, file, `payload ${relative}`);
}

for (const [name, record] of [
  ['setup', manifest.artifacts?.setup],
  ['recovery_helper', manifest.artifacts?.recovery_helper],
]) {
  const file = artifactPath(record, `artifact ${name}`);
  verifyRecord(record, file, `artifact ${name}`);
}
for (const [name, record] of [
  ['update_helper', manifest.artifacts?.update_helper],
  ['update_payload', manifest.artifacts?.update_payload],
  ['update_file_manifest', manifest.artifacts?.update_file_manifest],
  ['pe_resource_evidence', manifest.artifacts?.pe_resource_evidence],
  ['crash_recovery_evidence', manifest.artifacts?.crash_recovery_evidence],
  ['protected_payload_security', manifest.artifacts?.protected_payload_security],
]) verifyRecord(record, artifactPath(record, `artifact ${name}`), `artifact ${name}`);
const securityManifestPath = path.join(payloadDirectory, 'resources', 'justfun-security.json');
verifyRecord(manifest.artifacts?.protected_payload_security, securityManifestPath, 'artifact protected_payload_security');
const security = readJson(securityManifestPath);
assert(Number.isSafeInteger(manifest.artifacts?.update_payload?.unpacked_bytes) && manifest.artifacts.update_payload.unpacked_bytes > 0, 'update payload unpacked byte count is invalid');
assert(Number.isSafeInteger(manifest.artifacts?.update_payload?.file_count) && manifest.artifacts.update_payload.file_count === actualPayloadFiles.length, 'update payload file count differs from payload');
const payloadHelper = declaredPayload.get('justfun-updatehelper.exe');
assert(payloadHelper?.sha256 === manifest.artifacts?.update_helper?.sha256, 'versioned Update Helper differs from payload helper');
const payloadUpdateManifest = declaredPayload.get('update-files.json');
assert(payloadUpdateManifest?.sha256 === manifest.artifacts?.update_file_manifest?.sha256, 'published update file manifest differs from payload manifest');

const peEvidencePath = artifactPath(manifest.artifacts?.pe_resource_evidence, 'artifact pe_resource_evidence');
if (fs.existsSync(peEvidencePath) && fs.statSync(peEvidencePath).isFile()) {
  const peEvidence = readJson(peEvidencePath);
  assert(peEvidence.schema_version === 1 && peEvidence.status === 'passed', 'PE resource evidence did not pass');
  assert(peEvidence.product_id === manifest.product_id && peEvidence.version === manifest.version && peEvidence.commit_sha === manifest.commit_sha, 'PE resource evidence identity differs from BUILD-MANIFEST');
  const peExecutables = new Map((peEvidence.executables || []).map(item => [item?.id, item]));
  assert(peExecutables.size === 5, 'PE resource evidence must cover exactly five executables');
  for (const [id, record] of [
    ['application', declaredPayload.get('orderslogistics.exe')],
    ['premium_setup', manifest.artifacts?.setup],
    ['setup_engine', manifest.artifacts?.embedded_setup_engine],
    ['recovery', manifest.artifacts?.recovery_helper],
    ['update_helper', manifest.artifacts?.update_helper],
  ]) {
    const evidence = peExecutables.get(id);
    assert(evidence?.sha256 === record?.sha256 && evidence?.bytes === record?.bytes, `PE resource evidence differs for ${id}`);
  }
  assert(peExecutables.get('application')?.asar_integrity?.header_sha256 === String(security.archive_header_sha256 || '').toLowerCase(), 'PE resource evidence is not bound to the ASAR header integrity resource');
  for (const id of ['application', 'premium_setup', 'setup_engine', 'recovery']) {
    assert(Number.isSafeInteger(peExecutables.get(id)?.icon_images) && peExecutables.get(id).icon_images > 0, `PE icon evidence is missing for ${id}`);
  }
}

const crashEvidencePath = artifactPath(manifest.artifacts?.crash_recovery_evidence, 'artifact crash_recovery_evidence');
if (fs.existsSync(crashEvidencePath) && fs.statSync(crashEvidencePath).isFile()) {
  const crashEvidence = readJson(crashEvidencePath);
  assert(crashEvidence.schema_version === 1 && crashEvidence.status === 'passed', 'installer crash-recovery evidence did not pass');
  assert(Array.isArray(crashEvidence.scenarios) && crashEvidence.scenarios.length === 4, 'installer crash-recovery evidence is incomplete');
  assert(crashEvidence.bound_artifacts?.premium_setup?.sha256 === manifest.artifacts?.setup?.sha256, 'crash-recovery evidence is not bound to Premium Setup');
  assert(crashEvidence.bound_artifacts?.setup_engine?.sha256 === manifest.artifacts?.embedded_setup_engine?.sha256, 'crash-recovery evidence is not bound to the embedded Setup engine');
  for (const id of ['premium_setup', 'setup_engine']) {
    const probe = crashEvidence.runtime_probes?.[id];
    assert(probe?.exit_code === 10 && probe?.fail_closed === true && probe?.extraction_started === false && /^[0-9a-f]{64}$/.test(String(probe?.log_sha256 || '')), `crash-recovery runtime probe is invalid for ${id}`);
  }
}

assert(security.schema === 3 && security.product_id === manifest.product_id && security.product_version === manifest.version, 'protected payload security identity differs from BUILD-MANIFEST');
assert(security.archive_sha256?.toLowerCase() === declaredPayload.get('resources/app.asar')?.sha256, 'protected payload security hash differs from app.asar');

const result = {
  schema_version: 1,
  manifest: path.basename(manifestPath),
  version: manifest.version || null,
  commit_sha: manifest.commit_sha || null,
  payload_files: actualPayloadFiles.length,
  failures,
  passed: failures.length === 0,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
