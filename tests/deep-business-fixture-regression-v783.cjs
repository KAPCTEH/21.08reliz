const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'source/application/web/assets/js/00-app-bundle-v595.js'), 'utf8');
const smoke = fs.readFileSync(path.join(root, 'tests/runtime-smoke.mjs'), 'utf8');

assert(app.includes("const runtimeFixture=isolatedFixture===true&&window.__JF_RUNTIME_TEST__===true"));
assert(app.includes("if(!isDemonstrationMode()&&!runtimeFixture)throw new Error('Демонстрационный режим не включён')"));
assert(smoke.includes('const createIsolatedBusinessFixture = () => createDemonstrationScenario({ showMessage: false, isolatedFixture: true })'));
assert.equal((smoke.match(/createIsolatedBusinessFixture\(\);/g) || []).length, 2);
assert(!/deepBusiness[\s\S]{0,20000}createDemonstrationScenario\(\{ showMessage: false \}\)/.test(smoke));
for (const call of [
  'await confirmNotRelevant();',
  'await toggleCurrentOrderPayment();',
  'await retryCurrentDelivery();',
  "await resolveCurrentPartial('pickup');",
]) assert(smoke.includes(call), call);

console.log(JSON.stringify({ ok: true, fullEditionFixture: true, productionGuarded: true }));
