import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const [executableArgument, iconArgument] = process.argv.slice(2);
if (!executableArgument || !iconArgument) {
  throw new Error('Usage: node tests/verify-pe-icon.mjs <executable> <icon>');
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'source', 'desktop-runtime', 'package.json'));
const { Data, NtExecutable, NtExecutableResource, Resource } = require('resedit');
const executablePath = path.resolve(executableArgument);
const iconPath = path.resolve(iconArgument);
const iconFile = Data.IconFile.from(fs.readFileSync(iconPath));
const executable = NtExecutable.from(fs.readFileSync(executablePath));
const resources = NtExecutableResource.from(executable);
const groups = Resource.IconGroupEntry.fromEntries(resources.entries);

if (groups.length !== 1) {
  throw new Error(`Expected one PE icon group, found ${groups.length}.`);
}

const group = groups[0];
if (group.icons.length !== iconFile.icons.length) {
  throw new Error(`PE icon count ${group.icons.length} differs from ICO count ${iconFile.icons.length}.`);
}

for (let index = 0; index < iconFile.icons.length; index += 1) {
  const expected = iconFile.icons[index];
  const actual = group.icons[index];
  const expectedWidth = expected.width || 256;
  const expectedHeight = expected.height || 256;
  const actualWidth = actual.width || 256;
  const actualHeight = actual.height || 256;
  if (actualWidth !== expectedWidth || actualHeight !== expectedHeight || actual.bitCount !== expected.bitCount) {
    throw new Error(`PE icon metadata differs at index ${index}.`);
  }
  const entry = resources.entries.find(candidate => (
    candidate.type === 3 && candidate.id === actual.iconID && candidate.lang === group.lang
  ));
  if (!entry) {
    throw new Error(`PE icon resource ${actual.iconID} is missing.`);
  }
  if (!Buffer.from(entry.bin).equals(Buffer.from(expected.data.bin))) {
    throw new Error(`PE icon resource differs from the approved ICO at ${expectedWidth}x${expectedHeight}.`);
  }
}

process.stdout.write(`Installed PE icon resources: PASS (${iconFile.icons.length} images)\n`);
