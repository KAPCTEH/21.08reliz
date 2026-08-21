import crypto from 'node:crypto';
import path from 'node:path';
import * as asar from '../source/desktop-runtime/node_modules/@electron/asar/lib/asar.js';

const [archiveArg, fileArg] = process.argv.slice(2);
if (!archiveArg || !fileArg) {
  console.error('Usage: node tests/asar-file-hash.mjs <app.asar> <internal/path>');
  process.exit(2);
}

try {
  const content = asar.extractFile(path.resolve(archiveArg), fileArg.replaceAll('\\', '/'));
  process.stdout.write(crypto.createHash('sha256').update(content).digest('hex'));
} catch (error) {
  console.error(error?.stack || String(error));
  process.exit(1);
}
