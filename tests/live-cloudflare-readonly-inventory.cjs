'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const secretsPath = process.env.JF_TEST_SECRETS_PATH || 'C:\\Users\\zvd1\\.justfun-test-secrets.json';
const reportPath = process.env.JF_CF_INVENTORY_REPORT || '';
const secrets = JSON.parse(fs.readFileSync(path.resolve(secretsPath), 'utf8'));
const token = String(secrets?.cloudflare?.apiToken || '').trim();
let accountId = String(secrets?.cloudflare?.accountId || '').trim();
if (!token) throw new Error('Cloudflare audit credentials are incomplete');

async function cf(method, requestPath, body = null) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${requestPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body === null ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success !== true) {
    const code = payload?.errors?.[0]?.code || response.status;
    throw new Error(`Cloudflare read failed: ${code}`);
  }
  return payload.result;
}

function rows(result) {
  const first = Array.isArray(result) ? result[0] : result;
  return Array.isArray(first?.results) ? first.results : [];
}

async function query(databaseId, sql, params = []) {
  return rows(await cf('POST', `/accounts/${accountId}/d1/database/${databaseId}/query`, { sql, params }));
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
}

async function main() {
  const verification = await cf('GET', '/user/tokens/verify');
  if (!accountId) {
    const accounts = await cf('GET', '/accounts?per_page=50');
    if (!Array.isArray(accounts) || accounts.length !== 1 || !accounts[0]?.id) {
      throw new Error(`Cloudflare account is ambiguous: ${Array.isArray(accounts) ? accounts.length : 0}`);
    }
    accountId = String(accounts[0].id);
  }
  const [scripts, databases, subdomain] = await Promise.all([
    cf('GET', `/accounts/${accountId}/workers/scripts`),
    cf('GET', `/accounts/${accountId}/d1/database?per_page=100`),
    cf('GET', `/accounts/${accountId}/workers/subdomain`),
  ]);

  const databaseReports = [];
  for (const database of Array.isArray(databases) ? databases : []) {
    const tables = await query(database.uuid, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const tableNames = tables.map(item => String(item.name));
    const entry = { name: String(database.name), tableNames };
    if (tableNames.includes('companies') && tableNames.includes('users')) {
      entry.companies = await query(database.uuid, `
        SELECT c.id,c.code,c.status,COUNT(DISTINCT u.id) user_count,
               SUM(CASE WHEN u.role='owner' AND u.status='active' THEN 1 ELSE 0 END) active_owner_count
        FROM companies c LEFT JOIN users u ON u.company_id=c.id
        GROUP BY c.id,c.code,c.status ORDER BY c.code
      `);
    }
    if (tableNames.includes('company_telegram_services')) {
      entry.companyTelegramServices = await query(database.uuid, `
        SELECT company_id,warehouse_id,telegram_bot_username,telegram_deployment_version,updated_at
        FROM company_telegram_services ORDER BY company_id,warehouse_id
      `);
    }
    if (tableNames.includes('chat_bindings')) {
      const bindings = await query(database.uuid, `
        SELECT warehouse_id,entity_type,entity_id,chat_id,title,username,active,updated_at
        FROM chat_bindings ORDER BY warehouse_id,entity_type,entity_id
      `);
      entry.bindings = bindings.map(item => ({
        warehouse_id: item.warehouse_id,
        entity_type: item.entity_type,
        entity_id: item.entity_id,
        chat_hash: hash(item.chat_id),
        title: item.title,
        username: item.username,
        active: item.active,
        updated_at: item.updated_at,
      }));
    }
    databaseReports.push(entry);
  }

  const report = {
    ok: true,
    checkedAt: new Date().toISOString(),
    tokenStatus: String(verification?.status || ''),
    workersSubdomainPresent: Boolean(subdomain?.subdomain),
    workers: (Array.isArray(scripts) ? scripts : []).map(item => ({
      name: String(item.id || item.name || ''),
      modifiedOn: String(item.modified_on || ''),
    })).sort((a, b) => a.name.localeCompare(b.name)),
    databases: databaseReports,
  };
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(error?.message || error) })}\n`);
  process.exitCode = 1;
});
