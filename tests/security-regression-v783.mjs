import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const bundle = fs.readFileSync('source/application/web/assets/js/00-app-bundle-v595.js', 'utf8');
const composer = fs.readFileSync('source/application/web/assets/js/93-route-composer-map.js', 'utf8');
const automation = fs.readFileSync('source/application/web/assets/js/98-smart-automation-v598.js', 'utf8');
const main = fs.readFileSync('source/application/main.js', 'utf8');

const helper = bundle.match(/function escapeInlineJsString\(value\)\{[^\n]+\}/)?.[0] || '';
assert.ok(helper, 'Inline JavaScript string encoder is missing');
const dom = new JSDOM('<button id="probe"></button>', { runScripts: 'dangerously' });
dom.window.eval(helper);
const payload = "manual');window.__JF_XSS_EXECUTED=true;//<script>";
dom.window.__JF_XSS_EXECUTED = false;
dom.window.__JF_XSS_CAPTURE = '';
const encoded = dom.window.escapeInlineJsString(payload);
dom.window.document.querySelector('#probe').setAttribute(
  'onclick',
  `window.__JF_XSS_CAPTURE='${encoded}'`,
);
dom.window.document.querySelector('#probe').click();
assert.equal(dom.window.__JF_XSS_EXECUTED, false);
assert.equal(dom.window.__JF_XSS_CAPTURE, payload);

assert.ok(bundle.includes("escapeInlineJsString(key)"), 'Manual item key is not JavaScript-string encoded');
assert.ok(composer.includes("escapeInlineJsString(def.id)"), 'Route composer IDs are not JavaScript-string encoded');
assert.equal(/onclick="[^"]*escapeAttr\(/.test(composer), false, 'HTML escaping is still used as JavaScript escaping');
assert.ok(automation.includes('data-product-category='), 'Product category action is missing a data binding');
assert.ok(automation.includes("addEventListener('click'"), 'Product category action is not bound with addEventListener');
assert.equal(automation.includes("value='${escapeAttr(x.category)}'"), false, 'Product category still enters inline executable code');
assert.ok(main.includes('validateSnapshotEntityIdentifiers(data)'), 'Desktop snapshot identifiers are not validated');
assert.ok(main.includes("const APP_RENDERER_SCHEME = 'justfun'"), 'Protected application protocol is missing');
assert.ok(main.includes('registerSchemesAsPrivileged'), 'Application protocol is not registered as privileged before ready');
assert.ok(main.includes("targetSession.protocol.handle(APP_RENDERER_SCHEME"), 'Application protocol handler is missing');
assert.ok(main.includes("relative.startsWith('..') || path.isAbsolute(relative)"), 'Application protocol path containment is missing');
assert.equal(main.includes('.loadFile('), false, 'Renderer still depends on file:// loading');
assert.ok(main.includes("if (!isTrustedAppUrl(sourceUrl)) return false"), 'IPC sender does not enforce the protected application origin');
assert.ok(main.includes("decodeURIComponent(parsed.pathname)==='/web/index.html'"), 'IPC sender is not restricted to the main renderer document');

console.log(JSON.stringify({
  ok: true,
  inlineStringAttackBlocked: true,
  productCategoryUsesEventListener: true,
  snapshotIdentifiersValidated: true,
  protectedAppProtocol: true,
}));
