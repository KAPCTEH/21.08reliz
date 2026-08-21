'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../source/application/web/assets/js/02-runtime-overrides-v783.js'), 'utf8');
const indexHtml = fs.readFileSync(path.resolve(__dirname, '../source/application/web/index.html'), 'utf8');
const window = { calculate(value){ return value + 1; } };
const context = vm.createContext({ window, document: { dispatchEvent(){} }, CustomEvent: class CustomEvent {} });
vm.runInContext(source, context);

assert.equal(window.JustFunOverrides.version, '7.8.3');
window.JustFunOverrides.wrap('calculate', 'test.first', previous => function(value){ return previous(value) * 2; });
window.JustFunOverrides.wrap('calculate', 'test.second', previous => function(value){ return previous(value) + 3; });
assert.equal(window.calculate(4), 13);
assert.deepEqual(
  JSON.parse(JSON.stringify(window.JustFunOverrides.describe('calculate').map(item => [item.owner, item.previousOwner, item.mode]))),
  [['test.first', 'base', 'wrap'], ['test.second', 'test.first', 'wrap']],
);
assert.throws(() => window.JustFunOverrides.replace('bad-name', 'test.owner', () => {}), /Invalid override function name/);
assert.throws(() => window.JustFunOverrides.replace('validName', 'x', () => {}), /Invalid override owner/);
assert.throws(() => window.JustFunOverrides.wrap('calculate', 'test.owner', () => null), /must be a function/);

const baseIndex = indexHtml.indexOf('assets/js/00-app-bundle-v595.js');
const registryIndex = indexHtml.indexOf('assets/js/02-runtime-overrides-v783.js');
const firstCompatibilityIndex = indexHtml.indexOf('assets/js/105-map-reliability-v772.js');
assert.ok(baseIndex >= 0, 'base application bundle must be loaded');
assert.ok(registryIndex > baseIndex, 'override registry must be loaded after the base bundle');
assert.ok(firstCompatibilityIndex > registryIndex, 'override registry must be loaded before compatibility layers');

process.stdout.write(JSON.stringify({ ok: true, orderedWrapping: true, provenance: true, validation: true, scriptOrder: true }) + '\n');
