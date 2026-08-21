import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { minify } from 'terser';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing required argument: ${name}`);
  return path.resolve(process.argv[index + 1]);
}

function applicationScripts(appDir) {
  const roots = [
    appDir,
    path.join(appDir, 'web', 'assets', 'js'),
    path.join(appDir, 'integrations'),
  ];
  const output = new Set();
  const visit = directory => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(?:js|cjs)$/i.test(entry.name)) output.add(full);
    }
  };
  for (const root of roots) {
    if (root === appDir) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isFile() && /\.(?:js|cjs)$/i.test(entry.name)) output.add(path.join(root, entry.name));
      }
    } else {
      visit(root);
    }
  }
  return [...output].sort();
}

const appDir = argument('--app-dir');
if (!fs.statSync(appDir).isDirectory()) throw new Error(`Application staging directory not found: ${appDir}`);

let originalBytes = 0;
let protectedBytes = 0;
const files = applicationScripts(appDir);
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  originalBytes += Buffer.byteLength(source);
  const isModule = /^\s*(?:import|export)\s/m.test(source);
  const result = await minify(source, {
    module: isModule,
    compress: {
      passes: 2,
      unsafe: false,
      drop_console: false,
    },
    mangle: {
      toplevel: false,
      keep_classnames: true,
      keep_fnames: true,
    },
    format: {
      comments: false,
      ascii_only: false,
      semicolons: true,
    },
    sourceMap: false,
  });
  if (!result.code) throw new Error(`Terser returned empty output for ${file}`);
  const protectedSource = `${result.code}\n`;
  fs.writeFileSync(file, protectedSource, 'utf8');
  protectedBytes += Buffer.byteLength(protectedSource);
}

const report = {
  schema: 1,
  protection: 'terser-minification-and-local-identifier-mangling',
  files: files.length,
  original_bytes: originalBytes,
  protected_bytes: protectedBytes,
};
fs.writeFileSync(path.join(appDir, 'source-protection.json'), JSON.stringify(report, null, 2), 'utf8');
process.stdout.write(`${JSON.stringify(report)}\n`);
