const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'source/application/web/assets/js/140-clarity-redesign-v783.js'),
  'utf8',
);

assert(source.includes('productDrawerReturnFocusV783=document.activeElement instanceof HTMLElement'));
assert(source.includes('isolateProductDrawerBackgroundV783(drawer)'));
assert(source.includes('state.element.inert=true'));
assert(source.includes("drawer.addEventListener('keydown',trapProductDrawerFocusV783)"));
assert(source.includes("if(event.key!=='Tab')return"));
assert(source.includes('restoreProductDrawerBackgroundV783()'));
assert(source.includes('requestAnimationFrame(()=>target.focus())'));
assert(source.includes('aria-modal="true" aria-labelledby="productDrawerTitleV783" tabindex="-1"'));

console.log(JSON.stringify({
  ok: true,
  focusTrap: true,
  inertBackground: true,
  focusReturn: true,
}));
