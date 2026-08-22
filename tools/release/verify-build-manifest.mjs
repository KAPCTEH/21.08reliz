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

const manifestPath = argument('--manifest');
const identityPath = argument('--build-identity');
const sourceArchive = argument('--source-archive');
const payloadDirectory = argument('--payload-dir');
const installerDirectory = argument('--installer-dir');
const manifest = readJson(manifestPath);
const identity = readJson(identityPath);
const release = readJson(path.join(repository, 'source', 'application', 'release.json'));
const schema = readJson(path.join(repository, 'release', 'build-manifest.schema.json'));

assert(schema.$id === 'https://justfun.invalid/release/build-manifest.schema.json', 'BUILD-MANIFEST schema identity is invalid');
assert(manifest.schema_version === 2, 'BUILD-MANIFEST schema_version must be 2');
for (const field of ['product_id', 'product_name', 'version', 'channel', 'commit_sha', 'source_tree', 'build_id', 'generated_at_utc']) {
  assert(manifest[field] === identity[field], `BUILD-MANIFEST ${field} differs from build identity`);
}
assert(manifest.product_id === release.product_id, 'BUILD-MANIFEST product differs from release.json');
assert(manifest.version === release.version, 'BUILD-MANIFEST version differs from release.json');
assert(JSON.stringify(manifest.contracts) === JSON.stringify(release.contracts), 'BUILD-MANIFEST contracts differ from release.json');
assert(identity.source_dirty === false, 'build identity describes a dirty source tree');
assert(manifest.signing?.algorithm === 'Ed25519', 'BUILD-MANIFEST signing algorithm is invalid');
assert(['unsigned', 'signed'].includes(manifest.signing?.status), 'BUILD-MANIFEST signing status is invalid');
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
  const file = path.join(installerDirectory, String(record?.path || ''));
  verifyRecord(record, file, `artifact ${name}`);
}
if (manifest.artifacts?.update_helper !== null) {
  const record = manifest.artifacts.update_helper;
  verifyRecord(record, path.join(installerDirectory, String(record?.path || '')), 'artifact update_helper');
}

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
