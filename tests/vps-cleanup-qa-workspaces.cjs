'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('../source/application/node_modules/ssh2');

const secretsPath = process.env.JF_TEST_SECRETS_PATH || 'C:\\Users\\zvd1\\.justfun-test-secrets.json';
const secrets = JSON.parse(fs.readFileSync(path.resolve(secretsPath), 'utf8'));
const host = String(secrets?.vps?.host || '').trim();
const port = Number(secrets?.vps?.port || 22);
const username = String(secrets?.vps?.username || process.env.JF_VPS_USERNAME || 'root').trim();
const password = String(secrets?.vps?.password || '');
const workspaceIds = [...new Set(String(process.env.JF_QA_WORKSPACE_IDS || '').split(',').map(value => value.trim()).filter(Boolean))];

if (!host || !password || !username) throw new Error('VPS test credentials are incomplete');
if (!workspaceIds.length || workspaceIds.some(value => !/^cmp_qa_[a-f0-9]{32}$/.test(value))) {
  throw new Error('QA workspace cleanup target is missing or unsafe');
}

function connect() {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const timer = setTimeout(() => {
      client.end();
      reject(new Error('SSH connection timeout'));
    }, 30000);
    client.once('ready', () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    client.connect({ host, port, username, password, readyTimeout: 25000, keepaliveInterval: 10000, keepaliveCountMax: 2 });
  });
}

function execute(client, command, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        stream.close();
        reject(new Error('Remote QA cleanup timed out'));
      }, timeoutMs);
      stream.on('data', chunk => { stdout += chunk; });
      stream.stderr.on('data', chunk => { stderr += chunk; });
      stream.once('close', code => {
        clearTimeout(timer);
        if (Number(code) !== 0) reject(new Error(`Remote QA cleanup failed (${code}): ${stderr.trim().slice(0, 2000)}`));
        else resolve(stdout.trim());
      });
    });
  });
}

async function main() {
  const ids = workspaceIds.map(value => `'${value}'`).join(',');
  const sql = `
WITH
  commands AS (DELETE FROM processed_commands WHERE workspace_id = ANY(ARRAY[${ids}]::varchar[]) RETURNING 1),
  events AS (DELETE FROM workspace_change_events WHERE workspace_id = ANY(ARRAY[${ids}]::varchar[]) RETURNING 1),
  entities AS (DELETE FROM workspace_entities WHERE workspace_id = ANY(ARRAY[${ids}]::varchar[]) RETURNING 1),
  snapshots AS (DELETE FROM warehouse_snapshots WHERE workspace_id = ANY(ARRAY[${ids}]::varchar[]) RETURNING 1)
SELECT json_build_object(
  'commands', (SELECT count(*) FROM commands),
  'events', (SELECT count(*) FROM events),
  'entities', (SELECT count(*) FROM entities),
  'snapshots', (SELECT count(*) FROM snapshots)
)::text;
`;
  const encoded = Buffer.from(sql, 'utf8').toString('base64');
  const client = await connect();
  try {
    const output = await execute(client, `echo '${encoded}' | base64 -d | sudo -u postgres psql -d orderslogistics -X -v ON_ERROR_STOP=1 -tA`);
    const deleted = JSON.parse(output || '{}');
    process.stdout.write(`${JSON.stringify({ ok: true, workspaces: workspaceIds.length, deleted }, null, 2)}\n`);
  } finally {
    client.end();
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(error?.message || error).slice(0, 3000) })}\n`);
  process.exitCode = 1;
});
