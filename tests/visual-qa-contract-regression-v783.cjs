const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'source/application/main.js'), 'utf8');
const clarity = fs.readFileSync(path.join(root, 'source/application/web/assets/js/140-clarity-redesign-v783.js'), 'utf8');
const clarityCss = fs.readFileSync(path.join(root, 'source/application/web/assets/css/140-clarity-redesign-v783.css'), 'utf8');

assert(!main.includes("window.addItem?.();const input=document.querySelector('#orderModal.open .item-product-search-v610')"));
assert(!main.includes("#orderModal.open .picker-results-v610"));
assert(main.includes("window.openOrderProductDrawerV783?.(false)"));
for (const testId of [
  'order-product-drawer',
  'product-drawer-categories',
  'product-drawer-search',
  'product-drawer-results',
  'product-drawer-basket',
  'product-drawer-submit',
]) {
  assert(clarity.includes(testId), testId);
  assert(main.includes(testId), testId);
}
assert(main.includes("const routeId='demo-route-ready'"));
assert(main.includes('delete routeDriverAssignments[routeId]'));
assert(main.includes("window.openRouteDecisionCenterV783?.(routeId)"));
assert(main.includes("#routeDecisionModalV783.open .clarity-decision-list"));
assert(main.includes("#routeDecisionModalV783.open .clarity-decision-summary"));
const regAccordionRetry = "if(!box.classList.contains('open')||body.hidden)toggle.click()";
const regAccordionVisible = "if(box.classList.contains('open')&&!body.hidden){box.scrollIntoView({block:'start'});return true}";
assert(main.includes(regAccordionRetry), 'REG.RU visual QA must retry after an intermediate rerender');
assert(main.includes(regAccordionVisible), 'REG.RU visual QA must accept only a visible open accordion');
assert(clarityCss.includes('.clarity-decision-box>.modal-head{background-color:#117d4b}'));
assert(clarityCss.includes('.jf-access-head{flex:0 0 auto;padding:22px 25px 18px;background-color:#073e2e;'));

console.log(JSON.stringify({ ok: true, currentProductDrawer: true, deterministicBlockedRoute: true, regAccordionRaceGuarded: true, solidHeaderFallbacks: true }));
