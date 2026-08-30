'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { JSDOM } = require('jsdom');

const desktopPath = path.resolve(__dirname, '../source/application/web/assets/js/110-desktop-platform-v750.js');
const indexPath = path.resolve(__dirname, '../source/application/web/index.html');
const source = fs.readFileSync(desktopPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });

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
  document,
  formPermission: () => '',
  trainingAdminActionForControl: () => '',
  hasPermission: permission => allowed.has(permission),
  qa: (selector, root = document) => [...root.querySelectorAll(selector)],
});
vm.runInContext(`${functionSource('permissionForControl')}\n${functionSource('applyActionPermissions')}`, context);

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

process.stdout.write(`${JSON.stringify({ ok: true, controls: Object.keys(expectedFunctions).length })}\n`);
