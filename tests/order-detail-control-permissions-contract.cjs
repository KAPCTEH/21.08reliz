'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { JSDOM } = require('jsdom');

const desktopPath = path.resolve(__dirname, '../source/application/web/assets/js/110-desktop-platform-v750.js');
const applicationPath = path.resolve(__dirname, '../source/application/web/assets/js/00-app-bundle-v595.js');
const indexPath = path.resolve(__dirname, '../source/application/web/index.html');
const source = fs.readFileSync(desktopPath, 'utf8');
const applicationSource = fs.readFileSync(applicationPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
const applicationAst = acorn.parse(applicationSource, { ecmaVersion: 'latest', sourceType: 'script' });

const declarations = new Map();
const functions = new Map();
walk.simple(ast, {
  VariableDeclarator(node) {
    if (node.id.type === 'Identifier' && node.init) declarations.set(node.id.name, node.init);
  },
  FunctionDeclaration(node) {
    if (node.id?.name) functions.set(node.id.name, node);
  },
});
const applicationFunctions = new Map();
walk.simple(applicationAst, {
  FunctionDeclaration(node) {
    if (node.id?.name) applicationFunctions.set(node.id.name, node);
  },
});

function evaluateInitializer(name) {
  const node = declarations.get(name);
  assert.ok(node, `${name} declaration must exist`);
  return vm.runInNewContext(`(${source.slice(node.start, node.end)})`);
}

function functionSource(name) {
  const node = functions.get(name);
  assert.ok(node, `${name} function must exist`);
  return source.slice(node.start, node.end);
}

const functionPermissions = evaluateInitializer('FUNCTION_PERMISSIONS');
const functionAdditionalPermissions = evaluateInitializer('FUNCTION_ADDITIONAL_PERMISSIONS');
const controlPermissions = evaluateInitializer('CONTROL_PERMISSIONS');
const expectedFunctions = {
  toggleOrderPaymentBtn: 'toggleCurrentOrderPayment',
  editOrderBtn: 'editCurrentOrder',
  orderNotRelevantBtn: 'confirmNotRelevant',
  pickupReadyBtn: 'markCurrentPickupReady',
  pickupCollectedBtn: 'markCurrentPickupCollected',
  retryDeliveryBtn: 'retryCurrentDelivery',
  partialRepeatBtn: 'resolveCurrentPartial',
  partialPickupBtn: 'resolveCurrentPartial',
  partialCloseBtn: 'resolveCurrentPartial',
  deleteOrderBtn: 'deleteOrder',
};

const page = new JSDOM(index);
const { document } = page.window;
for (const [controlId, functionName] of Object.entries(expectedFunctions)) {
  const control = document.getElementById(controlId);
  assert.ok(control, `order detail control #${controlId} must exist`);
  assert.equal(
    controlPermissions[controlId],
    functionPermissions[functionName],
    `#${controlId} must use the same permission as ${functionName}`,
  );
}

const allowed = new Set();
const context = vm.createContext({
  CONTROL_PERMISSIONS: controlPermissions,
  FUNCTION_PERMISSIONS: functionPermissions,
  FUNCTION_ADDITIONAL_PERMISSIONS: functionAdditionalPermissions,
  document,
  formPermission: () => '',
  trainingAdminActionForControl: () => '',
  resolvedFunctionPermission: (_name, fallback) => fallback,
  hasPermission: permission => allowed.has(permission),
  hasPermissions: value => (Array.isArray(value) ? value : [value]).every(permission => allowed.has(permission)),
  qa: (selector, root = document) => [...root.querySelectorAll(selector)],
});
vm.runInContext(`${functionSource('permissionRequirements')}\n${functionSource('functionPermissionRequirements')}\n${functionSource('permissionForControl')}\n${functionSource('applyActionPermissions')}`, context);

for (const [controlId, functionName] of Object.entries(expectedFunctions)) {
  const control = document.getElementById(controlId);
  const permission = functionPermissions[functionName];
  allowed.clear();
  context.applyActionPermissions(document);
  assert.equal(context.permissionForControl(control), permission, `#${controlId} permission lookup`);
  assert.equal(control.classList.contains('jf-role-hidden'), true, `#${controlId} must be hidden when denied`);
  assert.equal(control.getAttribute('aria-hidden'), 'true', `#${controlId} denied aria state`);

  allowed.add(permission);
  context.applyActionPermissions(document);
  assert.equal(control.classList.contains('jf-role-hidden'), false, `#${controlId} must be visible when allowed`);
  assert.equal(control.hasAttribute('aria-hidden'), false, `#${controlId} allowed aria state`);
}

const paymentControl = document.getElementById('toggleOrderPaymentBtn');
allowed.clear();
context.applyActionPermissions(document);
const paymentRenderer = applicationFunctions.get('applyOrderDetailPaymentV595');
assert.ok(paymentRenderer, 'dynamic order payment renderer must exist');
const detailBody = document.createElement('div');
document.body.append(detailBody);
const applicationContext = vm.createContext({
  document,
  $: id => document.getElementById(id),
  money: value => String(value ?? 0),
  escapeHtml: value => String(value ?? ''),
  paymentMethodLabel: value => String(value ?? ''),
  paymentStatusLabel: value => String(value ?? ''),
  formatDateTime: value => String(value ?? ''),
});
vm.runInContext(applicationSource.slice(paymentRenderer.start, paymentRenderer.end), applicationContext);
applicationContext.applyOrderDetailPaymentV595({paymentStatus:'pending', paymentMethod:'cash'}, detailBody);
assert.equal(paymentControl.classList.contains('btn-blue'), true, 'dynamic payment state must update its visual style');
assert.equal(paymentControl.classList.contains('jf-role-hidden'), true, 'dynamic payment rendering must preserve the denied-role marker');

process.stdout.write(`${JSON.stringify({ ok: true, controls: Object.keys(expectedFunctions).length })}\n`);
