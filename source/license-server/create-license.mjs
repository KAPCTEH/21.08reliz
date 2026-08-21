#!/usr/bin/env node

const [origin, companyName, requestedCode] = process.argv.slice(2);
const adminToken = String(process.env.JUSTFUN_ADMIN_TOKEN || '').trim();
if (!origin || !adminToken || !companyName) {
  console.error('Set JUSTFUN_ADMIN_TOKEN and run: node create-license.mjs API_ORIGIN COMPANY_NAME [COMPANY_CODE]');
  process.exit(2);
}
const response = await fetch(new URL('/v1/admin/licenses', origin), {
  method: 'POST',
  headers: {
    authorization: `Bearer ${adminToken}`,
    'content-type': 'application/json; charset=utf-8',
  },
  body: JSON.stringify({ company_name: companyName, company_code: requestedCode || undefined }),
});
const payload = await response.json();
if (!response.ok || !payload.ok) {
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(payload, null, 2));
