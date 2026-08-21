'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('../source/application/node_modules/ssh2');

const secretsPath = process.env.JF_TEST_SECRETS_PATH || 'C:\\Users\\zvd1\\.justfun-test-secrets.json';
const secrets = JSON.parse(fs.readFileSync(path.resolve(secretsPath), 'utf8'));
const host = String(secrets?.vps?.host || '').trim();
const port = Number(secrets?.vps?.port || 22);
const username = String(secrets?.vps?.username || 'root').trim();
const password = String(secrets?.vps?.password || '');
const entityId = String(process.argv[2] || 'catalog-C8-1150-035-1800-8017').trim();

if (!host || !username || !password) throw new Error('VPS test credentials are incomplete');
if (!/^[A-Za-z0-9_-]{1,160}$/.test(entityId)) throw new Error('Unsafe entity identifier');

function connect() {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.once('ready', () => resolve(client));
    client.once('error', reject);
    client.connect({ host, port, username, password, readyTimeout: 25000 });
  });
}

function execute(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = '';
      let stderr = '';
      stream.on('data', chunk => { stdout += chunk; });
      stream.stderr.on('data', chunk => { stderr += chunk; });
      stream.once('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `Remote exit ${code}`)));
    });
  });
}

async function main() {
  const client = await connect();
  try {
    const escaped = entityId.replaceAll("'", "''");
    const sql = [
      "SELECT json_build_object(",
      "'workspace', workspace_id, 'warehouse', warehouse_id, 'environment', environment,",
      "'version', version, 'row_created_at', created_at, 'payload_created_at', payload->>'createdAt',",
      "'payload_sha256', payload_sha256)",
      "FROM workspace_entities",
      "WHERE entity_type='products' AND entity_id='" + escaped + "' AND NOT is_deleted",
      "ORDER BY updated_at DESC;",
    ].join(' ');
    const command = `sudo -u postgres psql -d orderslogistics -X -A -t -c ${JSON.stringify(sql)}`;
    const output = await execute(client, command);
    const rows = output.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    process.stdout.write(`${JSON.stringify({ ok: true, entityId, rows }, null, 2)}\n`);
  } finally {
    client.end();
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(error?.message || error).slice(0, 1000) })}\n`);
  process.exitCode = 1;
});
