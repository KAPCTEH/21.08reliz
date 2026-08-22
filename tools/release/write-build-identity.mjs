#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);

function argument(name, fallback = '') {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || '') : fallback;
}

function git(...gitArgs) {
  const result = spawnSync('git', ['-C', repository, ...gitArgs], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${gitArgs.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

const outputArg = argument('--output');
if (!outputArg) {
  process.stderr.write('Usage: node tools/release/write-build-identity.mjs --output <file> [--channel <channel>] [--commit <sha>] [--allow-dirty]\n');
  process.exit(2);
}

const contractPath = path.join(repository, 'source', 'application', 'release.json');
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes.toString('utf8'));
const channel = argument('--channel', process.env.JF_RELEASE_CHANNEL || contract.default_channel);
const commit = argument('--commit', process.env.GITHUB_SHA || git('rev-parse', 'HEAD')).toLowerCase();
if (!contract.supported_channels.includes(channel)) throw new Error(`Unsupported release channel: ${channel}`);
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Invalid exact commit SHA: ${commit}`);
git('cat-file', '-e', `${commit}^{commit}`);
const status = git('status', '--porcelain=v1');
if (status && !args.includes('--allow-dirty')) throw new Error('Refusing to generate a build identity from a dirty worktree.');
const tree = git('rev-parse', `${commit}^{tree}`);
const contractSha256 = crypto.createHash('sha256').update(contractBytes).digest('hex');
const identity = {
  schema_version: 1,
  product_id: contract.product_id,
  product_name: contract.product_name,
  version: contract.version,
  channel,
  release_status: contract.release_status,
  commit_sha: commit,
  source_tree: tree,
  build_id: `jf-${contract.version}-${commit.slice(0, 12)}`,
  generated_at_utc: new Date().toISOString(),
  release_contract_sha256: contractSha256,
  contracts: contract.contracts,
  service_versions: contract.service_versions,
  windows: contract.windows,
  source_dirty: Boolean(status),
};

const output = path.resolve(repository, outputArg);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(identity)}\n`);
