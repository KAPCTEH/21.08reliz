'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const secretsPath = process.env.JF_TEST_SECRETS_PATH || 'C:\\Users\\zvd1\\.justfun-test-secrets.json';
const reportPath = process.env.JF_CF_SOURCE_REPORT || '';
const dumpDir = process.env.JF_CF_SOURCE_DUMP_DIR || '';
const secrets = JSON.parse(fs.readFileSync(path.resolve(secretsPath), 'utf8'));
const token = String(secrets?.cloudflare?.apiToken || '').trim();
let accountId = String(secrets?.cloudflare?.accountId || '').trim();

if (!token) throw new Error('Cloudflare audit credentials are incomplete');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function json(requestPath) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${requestPath}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success !== true) {
    const code = payload?.errors?.[0]?.code || response.status;
    throw new Error(`Cloudflare read failed: ${code}`);
  }
  return payload.result;
}

function contentParts(contentType, body) {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)?.slice(1).find(Boolean);
  if (!boundary) return [{ name: 'worker.js', body }];

  return body
    .split(`--${boundary}`)
    .slice(1, -1)
    .map(part => part.replace(/^\r?\n/, '').replace(/\r?\n$/, ''))
    .map(part => {
      const splitAt = part.search(/\r?\n\r?\n/);
      if (splitAt < 0) return null;
      const headers = part.slice(0, splitAt);
      const payload = part.slice(splitAt).replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, '');
      const name = /\bname="([^"]+)"/i.exec(headers)?.[1] || 'unnamed';
      return { name, body: payload };
    })
    .filter(Boolean);
}

function apiRoutes(source) {
  return [...new Set(String(source).match(/\/v1\/[A-Za-z0-9_?=&./:-]+/g) || [])]
    .map(value => value.replace(/[?'"`,;)]+$/, ''))
    .sort();
}

function functionBody(source, name) {
  const text = String(source);
  const start = text.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  if (start < 0) return '';
  const next = text.slice(start + 1).search(/\n(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
}

const targets = [
  {
    worker: 'justfun-company-telegram',
    local: 'source/company-telegram-broker/worker.mjs',
    features: [
      ['configure_retry', 'verifyTelegramWorkerEventually'],
      ['warehouse_scoped_rate_limit', 'configure:${warehouseId}'],
      ['warehouse_access_guard_before_save', 'requireWarehouseAccess(auth, warehouseId)', 'setCompanyTelegramService'],
    ],
    markers: [
      "WHERE company_id=? AND warehouse_id=?",
      "path === '/v1/company/telegram-service'",
      "path === '/v1/company/telegram/events'",
    ],
  },
  {
    worker: 'justfun-license-api',
    local: 'source/license-server/worker.mjs',
    features: [
      ['company_telegram_service', '/v1/company/telegram-service'],
      ['warehouse_access_guard', 'requireWarehouseAccess(auth, warehouseId)'],
    ],
    markers: [
      "path === '/v1/company/telegram-service'",
      "path === '/v1/company/telegram/events'",
      'requireWarehouseAccess(auth, warehouseId)',
    ],
  },
];

async function inspect(target) {
  const localPath = path.join(root, target.local);
  const local = fs.readFileSync(localPath, 'utf8');
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(target.worker)}`,
    {
      headers: { authorization: `Bearer ${token}`, accept: '*/*' },
      signal: AbortSignal.timeout(30000),
    },
  );
  const body = Buffer.from(await response.arrayBuffer()).toString('utf8');
  if (!response.ok) throw new Error(`Worker download failed for ${target.worker}: HTTP ${response.status}`);

  const parts = contentParts(response.headers.get('content-type') || '', body);
  const sourceParts = parts.filter(part => /(?:javascript|typescript|module|worker|\.m?js$)/i.test(part.name)
    || part.body.includes('export default')
    || part.body.includes('addEventListener'));
  const deployedText = sourceParts.map(part => part.body).join('\n');
  const matchedPart = sourceParts.find(part => sha256(Buffer.from(part.body)) === sha256(Buffer.from(local)));
  if (dumpDir) {
    fs.mkdirSync(path.resolve(dumpDir), { recursive: true });
    fs.writeFileSync(path.join(path.resolve(dumpDir), `${target.worker}.mjs`), deployedText, 'utf8');
  }

  return {
    worker: target.worker,
    local: target.local,
    response: {
      contentType: response.headers.get('content-type') || '',
      bytes: Buffer.byteLength(body),
      sha256: sha256(Buffer.from(body)),
    },
    localSha256: sha256(Buffer.from(local)),
    exactLocalMatch: Boolean(matchedPart) || body === local,
    localApiRoutes: apiRoutes(local),
    deployedApiRoutes: apiRoutes(deployedText),
    features: (target.features || []).map(([name, marker, functionName]) => ({
      name,
      local: (functionName ? functionBody(local, functionName) : local).includes(marker),
      deployed: (functionName ? functionBody(deployedText, functionName) : deployedText).includes(marker),
    })),
    parts: parts.map(part => ({
      name: part.name,
      bytes: Buffer.byteLength(part.body),
      sha256: sha256(Buffer.from(part.body)),
    })),
    markers: target.markers.map(marker => ({
      marker: sha256(Buffer.from(marker)).slice(0, 12),
      local: local.includes(marker),
      deployed: deployedText.includes(marker),
    })),
  };
}

async function main() {
  if (!accountId) {
    const accounts = await json('/accounts?per_page=50');
    if (!Array.isArray(accounts) || accounts.length !== 1 || !accounts[0]?.id) {
      throw new Error(`Cloudflare account is ambiguous: ${Array.isArray(accounts) ? accounts.length : 0}`);
    }
    accountId = String(accounts[0].id);
  }

  const report = {
    ok: true,
    checkedAt: new Date().toISOString(),
    targets: [],
  };
  for (const target of targets) report.targets.push(await inspect(target));
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(error?.message || error) })}\n`);
  process.exitCode = 1;
});
