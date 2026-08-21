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

function execute(client, command, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        stream.close();
        reject(new Error(`Remote command timeout: ${command}`));
      }, timeoutMs);
      stream.on('data', chunk => { stdout += chunk; });
      stream.stderr.on('data', chunk => { stderr += chunk; });
      stream.once('close', code => {
        clearTimeout(timer);
        resolve({ code: Number(code), stdout: sanitize(stdout).trim(), stderr: sanitize(stderr).trim() });
      });
    });
  });
}

async function main() {
  const client = await connect();
  try {
    const commands = {
      identity: "hostnamectl --static; date -u +%Y-%m-%dT%H:%M:%SZ; uname -srmo",
      services: "systemctl is-active orders-logistics nginx postgresql; systemctl is-enabled orders-logistics nginx postgresql",
      nginx: "nginx -t",
      ports: "ss -lnt | awk 'NR==1 || /:22 |:443 |:5432 |:8765 /'",
      health: "curl -ksS --max-time 12 https://127.0.0.1/health",
      certificate: "openssl s_client -connect 127.0.0.1:443 -servername localhost </dev/null 2>/dev/null | openssl x509 -noout -sha256 -fingerprint -dates -subject",
      serviceConfig: "systemctl show orders-logistics -p User -p Group -p WorkingDirectory -p ExecStart -p EnvironmentFiles --no-pager",
      applicationFiles: "find /opt/justfun/orders-logistics -maxdepth 2 -type f -printf '%p|%s|%u|%g|%m\\n' 2>/dev/null | sort",
      applicationHash: "sha256sum /opt/justfun/orders-logistics/server.py 2>/dev/null || true",
      database: "sudo -u postgres psql -d orderslogistics -X -tAc \"SELECT current_database(), current_user, current_setting('server_version'); SELECT count(*) FROM information_schema.tables WHERE table_schema='public'; SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;\"",
      warehouseInventory: "sudo -u postgres psql -d orderslogistics -X -F '|' -Atc \"SELECT 'entity',workspace_id,warehouse_id,environment,COALESCE(payload->>'name',payload->>'code',''),updated_at FROM workspace_entities WHERE entity_type='warehouse' AND NOT is_deleted UNION ALL SELECT 'snapshot',workspace_id,warehouse_id,environment,COALESCE(snapshot#>>'{warehouse,name}',snapshot#>>'{warehouse,code}',''),updated_at FROM warehouse_snapshots ORDER BY 2,3,4,1;\"",
      warnings: "journalctl -u orders-logistics --since '2026-08-08 00:00:00' -p warning --no-pager -n 80",
    };
    const report = { ok: true, hostReachable: true, checkedAt: new Date().toISOString(), checks: {} };
    for (const [name, command] of Object.entries(commands)) report.checks[name] = await execute(client, command, name === 'warnings' ? 30000 : 20000);
    const reportPath = process.env.JF_VPS_DIAGNOSTIC_REPORT;
    if (reportPath) fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    client.end();
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: sanitize(error?.message || error) })}\n`);
  process.exitCode = 1;
});
