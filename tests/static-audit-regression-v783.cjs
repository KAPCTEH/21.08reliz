const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const report = JSON.parse(execFileSync(
  process.execPath,
  [path.join(__dirname, 'static-audit.mjs'), path.join(root, 'source', 'application')],
  { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
));

assert.equal(report.summary.parseErrors, 0);
assert.equal(report.summary.duplicateGlobals, 0);
assert.ok(report.summary.implementationBindings > 0);
assert.ok(report.summary.implementationOverrides > 0);

for (const item of report.implementationBindings) {
  const assignments = item.declarations.filter(declaration =>
    ['function-assignment', 'window-function'].includes(declaration.kind)
  );
  assert.equal(assignments.length, 1, `${item.name} is not a single implementation binding`);
}

for (const item of report.implementationOverrides) {
  assert.ok(item.assignments > 1, `${item.name} is not a real implementation override`);
}

console.log(JSON.stringify({
  ok: true,
  implementationBindings: report.summary.implementationBindings,
  implementationOverrides: report.summary.implementationOverrides
}));
