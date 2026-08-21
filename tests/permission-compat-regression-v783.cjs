'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../source/application/web/assets/js/110-desktop-platform-v750.js'), 'utf8');
const expansionSource = source.match(/const LEGACY_PERMISSION_EXPANSIONS=Object\.freeze\(\{[\s\S]*?\}\);/)?.[0];
const normalizeSource = source.match(/function normalizePermissionList\(value\)\{[^\n]+\}/)?.[0];
assert.ok(expansionSource, 'legacy permission expansion map must exist');
assert.ok(normalizeSource, 'client permission normalizer must exist');

const context = { result: null };
vm.runInNewContext(`${expansionSource}\n${normalizeSource}\nresult=normalizePermissionList(['routes.update','routes.read','routes.update']);`, context);
assert.deepEqual(JSON.parse(JSON.stringify(context.result)), [
  'routes.update','routes.plan','routes.approve','routes.pick','routes.start',
  'routes.return','routes.close','routes.cancel','routes.settings','routes.read',
]);
assert.match(source, /return normalizePermissionList\(LOCAL_ROLE_PERMISSIONS/);
assert.match(source, /return normalizePermissionList\(user\.permissions\)/);

process.stdout.write(JSON.stringify({ ok: true, clientLegacyExpansion: true, exactPermissionsPreserved: true }) + '\n');
