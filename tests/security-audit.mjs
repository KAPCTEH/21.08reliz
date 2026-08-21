import fs from 'node:fs';
import path from 'node:path';

const roots = process.argv.slice(2).map(value => path.resolve(value));
if (!roots.length) throw new Error('Specify one or more source roots.');

const textExtensions = new Set([
  '.c', '.h', '.css', '.html', '.js', '.cjs', '.mjs', '.json', '.md',
  '.ps1', '.py', '.sh', '.sql', '.toml', '.txt', '.xml', '.yml', '.yaml'
]);
const excludedNames = new Set(['node_modules', '.git', 'output', '__pycache__']);
const excludedFiles = new Set(['leaflet.js']);
const files = [];

function visit(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (textExtensions.has(path.extname(target).toLowerCase())) files.push(target);
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedNames.has(entry.name)) continue;
    if (entry.isFile() && excludedFiles.has(entry.name)) continue;
    visit(path.join(target, entry.name));
  }
}
for (const root of roots) visit(root);

const rules = [
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['github_token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g],
  ['telegram_bot_token', /\b\d{6,14}:[A-Za-z0-9_-]{30,}\b/g],
  ['jwt_literal', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g],
  ['credential_in_url', /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@/gi],
  ['dynamic_eval', /\beval\s*\(/g],
  ['dynamic_function', /\bnew\s+Function\s*\(/g],
  ['shell_execution', /\b(?:childProcess|child_process)\.exec\s*\(/g],
  ['electron_node_integration', /\bnodeIntegration\s*:\s*true\b/g],
  ['electron_context_isolation', /\bcontextIsolation\s*:\s*false\b/g],
  ['electron_sandbox_disabled', /\bsandbox\s*:\s*false\b/g],
  ['electron_web_security_disabled', /\bwebSecurity\s*:\s*false\b/g],
  ['electron_insecure_content', /\ballowRunningInsecureContent\s*:\s*true\b/g],
  ['unfinished_marker', /(?:^|\s)(?:TODO|FIXME|HACK)(?:\s*[:(]|\s*$)/gim],
];

const findings = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [rule, pattern] of rules) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      findings.push({
        rule,
        file: path.relative(process.cwd(), file).replaceAll(path.sep, '/'),
        line: source.slice(0, match.index).split('\n').length,
      });
    }
  }
}

const forbiddenArtifacts = [];
for (const root of roots) {
  const visitNames = target => {
    const stat = fs.statSync(target);
    if (stat.isFile()) {
      const name = path.basename(target).toLowerCase();
      if (name === '.env' || /\.(?:pem|pfx|p12|key)$/i.test(name) || name === 'wrangler.toml') {
        forbiddenArtifacts.push(path.relative(process.cwd(), target).replaceAll(path.sep, '/'));
      }
      return;
    }
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (entry.isDirectory() && excludedNames.has(entry.name)) continue;
      visitNames(path.join(target, entry.name));
    }
  };
  visitNames(root);
}

const summary = {
  roots: roots.length,
  filesScanned: files.length,
  findings: findings.length,
  forbiddenArtifacts: forbiddenArtifacts.length,
};
process.stdout.write(`${JSON.stringify({
  generatedAt: new Date().toISOString(),
  summary,
  findings,
  forbiddenArtifacts,
}, null, 2)}\n`);
process.exitCode = findings.length || forbiddenArtifacts.length ? 2 : 0;
