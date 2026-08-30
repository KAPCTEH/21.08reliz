'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const walk = require('acorn-walk');

const root = path.resolve(__dirname, '..');
const desktopPath = path.join(root, 'source/application/web/assets/js/110-desktop-platform-v750.js');
const routePath = path.join(root, 'source/application/web/assets/js/90-route-engine.js');
const desktop = fs.readFileSync(desktopPath, 'utf8');
const route = fs.readFileSync(routePath, 'utf8');
const desktopAst = acorn.parse(desktop, {ecmaVersion:'latest', sourceType:'script'});
const routeAst = acorn.parse(route, {ecmaVersion:'latest', sourceType:'script'});

const declarations = new Map();
const functions = new Map();
walk.simple(desktopAst, {
  VariableDeclarator(node) { if (node.id.type === 'Identifier' && node.init) declarations.set(node.id.name, node.init); },
  FunctionDeclaration(node) { if (node.id?.name) functions.set(node.id.name, node); },
});

function initializerSource(name) {
  const node = declarations.get(name);
  assert.ok(node, `${name} declaration must exist`);
  return desktop.slice(node.start, node.end);
}

function functionSource(name) {
  const node = functions.get(name);
  assert.ok(node, `${name} function must exist`);
  return desktop.slice(node.start, node.end);
}

const allowed = new Set();
const permissionContext = vm.createContext({
  allowed,
  currentUser: null,
  resolvedFunctionPermission: (_name, fallback) => fallback,
  hasPermission: permission => allowed.has(permission),
});
vm.runInContext(`
  const FUNCTION_ADDITIONAL_PERMISSIONS=${initializerSource('FUNCTION_ADDITIONAL_PERMISSIONS')};
  ${functionSource('permissionRequirements')}
  ${functionSource('functionPermissionRequirements')}
  ${functionSource('missingPermissions')}
  ${functionSource('hasPermissions')}
  this.requirements=functionPermissionRequirements;
  this.allowedFor=hasPermissions;
`, permissionContext);

const requirements = [...permissionContext.requirements('buildSingleRoute', 'routes.plan')];
assert.deepEqual(requirements, ['routes.plan', 'orders.status']);
assert.deepEqual([...permissionContext.requirements('buildAllRoutes', 'routes.plan')], requirements);
permissionContext.allowed.add('routes.plan');
assert.equal(permissionContext.allowedFor(requirements), false, 'routes.plan alone must not finalize and reserve a route');
permissionContext.allowed.add('orders.status');
assert.equal(permissionContext.allowedFor(requirements), true, 'route planning plus order status may finalize a route');
assert.deepEqual([...permissionContext.requirements('createManualRoute', 'routes.plan')], ['routes.plan'], 'draft route composition remains routes.plan-only');

let autoAssignNode = null;
walk.simple(routeAst, {
  AssignmentExpression(node) {
    if (node.left.type === 'Identifier' && node.left.name === 'autoAssignBestDrivers' && node.right.type === 'FunctionExpression') autoAssignNode = node;
  },
});
assert.ok(autoAssignNode, 'autoAssignBestDrivers override must exist');
const assignments = {routeExisting:'driverExisting'};
const autoAssignContext = vm.createContext({
  window:{JustFunPermissionAccessV783:{has:permission=>permission === 'drivers.assign' ? false : true}},
  routeDriverAssignments:assignments,
});
vm.runInContext(`let autoAssignBestDrivers;${route.slice(autoAssignNode.start, autoAssignNode.end)};this.run=autoAssignBestDrivers`, autoAssignContext);
assert.equal(autoAssignContext.run([{id:'routeNew'}]), 0);
assert.deepEqual(assignments, {routeExisting:'driverExisting'}, 'planning without drivers.assign must not add, remove or repair driver assignments');

const guardSource = functionSource('installEntityCommandGuards');
assert.match(functionSource('installGuards'), /required=functionPermissionRequirements\(name,permission,arguments\)/);
assert.match(guardSource, /buildAllRoutes:\{kind:'route_plan_build_all',critical:false,target:\(\)=>activeWarehouseId\(\)\}/);
assert.match(guardSource, /buildSingleRoute:\{kind:'route_plan_build',critical:false,target:args=>args\[0\]\}/);
assert.doesNotMatch(desktop, /SERVER_ENTITY_INTENTS_V783[^;]*route_plan_build/, 'ordinary route builds must retain exact server field permissions');

process.stdout.write(`${JSON.stringify({ok:true,requirements,autoAssignDenied:true,transactionalGuards:2})}\n`);
