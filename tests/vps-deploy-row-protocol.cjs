'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('../source/application/node_modules/ssh2');

const secretsPath = process.env.JF_TEST_SECRETS_PATH || 'C:\\Users\\zvd1\\.justfun-test-secrets.json';
const sourcePath = path.resolve(__dirname, '../source/application/integrations/reg-vps/server/server.py');
const secrets = JSON.parse(fs.readFileSync(path.resolve(secretsPath), 'utf8'));
const host = String(secrets?.vps?.host || '').trim();
const port = Number(secrets?.vps?.port || 22);
const username = String(secrets?.vps?.username || process.env.JF_VPS_USERNAME || 'root').trim();
const password = String(secrets?.vps?.password || '');
const expectedHash = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const backupDir = `/var/backups/justfun-orders-logistics/codex-${stamp}`;
const target = '/opt/justfun/orders-logistics/server.py';
const staging = `${target}.codex-staging-${process.pid}`;

if (!host || !password || !username) throw new Error('VPS test credentials are incomplete');

function sanitize(value) {
  return String(value || '')
    .replace(/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, '<telegram-token>')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer <redacted>')
    .replace(/\b(api[_ -]?key|password|secret)\s*[=:]\s*\S+/gi, '$1=<redacted>')
    .slice(0, 12000);
}

function connect() {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const timer = setTimeout(() => { client.end(); reject(new Error('SSH connection timeout')); }, 30000);
    client.once('ready', () => { clearTimeout(timer); resolve(client); });
    client.once('error', error => { clearTimeout(timer); reject(error); });
    client.connect({ host, port, username, password, readyTimeout: 25000, keepaliveInterval: 10000, keepaliveCountMax: 2 });
  });
}

function execute(client, command, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => { stream.close(); reject(new Error(`Remote command timeout: ${command}`)); }, timeoutMs);
      stream.on('data', chunk => { stdout += chunk; });
      stream.stderr.on('data', chunk => { stderr += chunk; });
      stream.once('close', code => {
        clearTimeout(timer);
        resolve({ code: Number(code), stdout: sanitize(stdout).trim(), stderr: sanitize(stderr).trim() });
      });
    });
  });
}

async function must(client, command, timeoutMs) {
  const result = await execute(client, command, timeoutMs);
  if (result.code !== 0) throw new Error(`${command}: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  return result.stdout;
}

function upload(client) {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) return reject(error);
      sftp.fastPut(sourcePath, staging, { mode: 0o600 }, putError => putError ? reject(putError) : resolve());
    });
  });
}

async function rollback(client) {
  await must(client, 'systemctl stop orders-logistics');
  await must(client, "sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='orderslogistics' AND pid<>pg_backend_pid()\"");
  await must(client, 'sudo -u postgres dropdb --if-exists orderslogistics');
  await must(client, 'sudo -u postgres createdb --owner=orderslogistics orderslogistics');
  await must(client, `sudo -u postgres pg_restore --exit-on-error --dbname=orderslogistics '${backupDir}/orderslogistics.dump'`, 120000);
  await must(client, `cp -a '${backupDir}/server.py' '${target}'`);
  await must(client, "systemctl restart orders-logistics");
}

async function main() {
  const client = await connect();
  let replaced = false;
  try {
    await must(client, `install -d -m 0700 '${backupDir}'`);
    await must(client, `cp -a '${target}' '${backupDir}/server.py'`);
    await must(client, `cp -a /etc/orders-logistics/server.env '${backupDir}/server.env'`);
    await must(client, `sudo -u postgres pg_dump --format=custom orderslogistics > '${backupDir}/orderslogistics.dump'`, 120000);
    await must(client, `sudo -u postgres pg_restore --list '${backupDir}/orderslogistics.dump' > '${backupDir}/orderslogistics.restore-list'`);
    await must(client, `sha256sum '${backupDir}/server.py' '${backupDir}/orderslogistics.dump' > '${backupDir}/SHA256SUMS'`);
    const backupCheck = await must(client, `stat -c '%n|%s|%a|%U|%G' '${backupDir}/server.py' '${backupDir}/server.env' '${backupDir}/orderslogistics.dump' '${backupDir}/orderslogistics.restore-list' '${backupDir}/SHA256SUMS'`);

    await upload(client);
    const uploadedHash = (await must(client, `sha256sum '${staging}'`)).split(/\s+/)[0].toLowerCase();
    if (uploadedHash !== expectedHash) throw new Error('Uploaded server.py hash mismatch');
    await must(client, `python3 -c \"compile(open('${staging}', encoding='utf-8').read(), '${staging}', 'exec')\"`);
    await must(client, `chown orderslogistics:orderslogistics '${staging}'`);
    await must(client, `chmod 0640 '${staging}'`);
    await must(client, `mv -f '${staging}' '${target}'`);
    replaced = true;
    await must(client, 'systemctl restart orders-logistics');
    await new Promise(resolve => setTimeout(resolve, 2000));
    const active = await must(client, 'systemctl is-active orders-logistics');
    const health = await must(client, 'curl -ksS --max-time 12 https://127.0.0.1/health');
    const database = await must(client, "sudo -u postgres psql -d orderslogistics -X -tAc \"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename; SELECT version || ':' || name FROM schema_migrations ORDER BY version;\"");
    const currentHash = (await must(client, `sha256sum '${target}'`)).split(/\s+/)[0].toLowerCase();
    if (active.trim() !== 'active' || currentHash !== expectedHash) throw new Error('Service verification failed after deployment');
    const parsedHealth = JSON.parse(health);
    if (!parsedHealth.ok || parsedHealth.database !== 'ready') throw new Error('Health check failed after deployment');
    const requiredTables = ['business_audit_v3', 'business_commands_v3', 'business_events_v3', 'business_records_v3', 'schema_migrations', 'warehouse_delete_operations_v3', 'warehouse_delete_release_outbox_v3'];
    for (const table of requiredTables) if (!database.includes(table)) throw new Error(`Required table is missing: ${table}`);
    process.stdout.write(`${JSON.stringify({ ok: true, backupDir, expectedHash, active, health: parsedHealth, database: database.split(/\r?\n/).filter(Boolean), backup: backupCheck.split(/\r?\n/).filter(Boolean) }, null, 2)}\n`);
  } catch (error) {
    if (replaced) await rollback(client).catch(() => {});
    throw error;
  } finally {
    await execute(client, `rm -f '${staging}'`).catch(() => {});
    client.end();
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, backupDir, error: sanitize(error?.message || error) })}\n`);
  process.exitCode = 1;
});
