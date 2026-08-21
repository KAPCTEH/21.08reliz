'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('../source/application/node_modules/ssh2');

const host = String(process.env.JF_DEPLOY_HOST || '').trim();
const port = Number(process.env.JF_DEPLOY_PORT || 22);
const username = String(process.env.JF_DEPLOY_USER || 'root').trim();
const password = String(process.env.JF_DEPLOY_PASSWORD || '');
const knownHostsPath = path.resolve(process.env.JF_DEPLOY_KNOWN_HOSTS || path.join(process.env.USERPROFILE || '', '.ssh', 'known_hosts'));
const sourcePath = path.resolve(process.argv[2] || '');

if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !password) {
  throw new Error('VPS deployment credentials are incomplete.');
}
if (!fs.statSync(sourcePath, { throwIfNoEntry: false })?.isFile()) {
  throw new Error(`Server source not found: ${sourcePath}`);
}

const knownKeys = fs.readFileSync(knownHostsPath, 'utf8')
  .split(/\r?\n/)
  .map(line => line.trim().split(/\s+/))
  .filter(parts => parts.length >= 3 && parts[0].split(',').includes(host))
  .map(parts => Buffer.from(parts[2], 'base64'));
if (!knownKeys.length) throw new Error('The VPS host key is not pinned in known_hosts.');

function hostVerifier(rawKey) {
  return knownKeys.some(known => known.length === rawKey.length && crypto.timingSafeEqual(known, rawKey));
}

function connect() {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.once('ready', () => resolve(client));
    client.once('error', reject);
    client.connect({
      host,
      port,
      username,
      password,
      readyTimeout: 30_000,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3,
      hostVerifier,
    });
  });
}

function openSftp(client) {
  return new Promise((resolve, reject) => client.sftp((error, sftp) => error ? reject(error) : resolve(sftp)));
}

function upload(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => sftp.fastPut(localPath, remotePath, { mode: 0o600 }, error => error ? reject(error) : resolve()));
}

function exec(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let output = '';
      const append = chunk => {
        output += chunk.toString('utf8');
        if (output.length > 64_000) output = output.slice(-64_000);
      };
      stream.on('data', append);
      stream.stderr.on('data', append);
      stream.once('close', code => code === 0 ? resolve(output) : reject(Object.assign(new Error(`Remote deployment failed with exit code ${code}.`), { output })));
    });
  });
}

(async () => {
  const nonce = crypto.randomBytes(12).toString('hex');
  const remoteSource = `/tmp/justfun-server-${nonce}.py`;
  const client = await connect();
  try {
    const sftp = await openSftp(client);
    await upload(sftp, sourcePath, remoteSource);
    sftp.end();
    const command = `bash -s -- '${remoteSource}' <<'JF_DEPLOY'\n` +
      `set -euo pipefail\n` +
      `src="$1"\n` +
      `dest=/opt/justfun/orders-logistics/server.py\n` +
      `backup="${'$'}{dest}.backup-$(date -u +%Y%m%dT%H%M%SZ)"\n` +
      `cleanup(){ rm -f -- "$src"; }\n` +
      `trap cleanup EXIT\n` +
      `python3 -m py_compile "$src"\n` +
      `test -f "$dest"\n` +
      `cp -p -- "$dest" "$backup"\n` +
      `install -o orderslogistics -g orderslogistics -m 0640 "$src" "$dest"\n` +
      `if ! systemctl restart orders-logistics; then\n` +
      `  cp -p -- "$backup" "$dest"\n` +
      `  systemctl restart orders-logistics || true\n` +
      `  echo DEPLOY_ROLLED_BACK_RESTART\n` +
      `  exit 40\n` +
      `fi\n` +
      `ready=0\n` +
      `for attempt in $(seq 1 30); do\n` +
      `  if curl -fsS --max-time 3 http://127.0.0.1:8792/health >/dev/null 2>&1; then ready=1; break; fi\n` +
      `  sleep 1\n` +
      `done\n` +
      `if [ "$ready" != 1 ]; then\n` +
      `  cp -p -- "$backup" "$dest"\n` +
      `  systemctl restart orders-logistics || true\n` +
      `  echo DEPLOY_ROLLED_BACK_HEALTH\n` +
      `  exit 41\n` +
      `fi\n` +
      `echo DEPLOY_OK\n` +
      `JF_DEPLOY`;
    const output = await exec(client, command);
    if (!output.includes('DEPLOY_OK')) throw new Error('VPS did not confirm deployment health.');
    process.stdout.write(JSON.stringify({ ok: true, hostKeyPinned: true, service: 'active', health: 'ok' }) + '\n');
  } finally {
    client.end();
  }
})().catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, error: error.message, remote: String(error.output || '').slice(-4000) }) + '\n');
  process.exitCode = 1;
});
