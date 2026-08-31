#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Data, NtExecutable, NtExecutableResource, Resource } = require('@shockpkg/resedit');
const args = process.argv.slice(2);

function argument(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing required argument: ${name}`);
  return path.resolve(args[index + 1]);
}

function textArgument(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing required argument: ${name}`);
  return String(args[index + 1]);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function exactVersion(fixed, prefix) {
  const ms = Number(fixed[`${prefix}VersionMS`]) >>> 0;
  const ls = Number(fixed[`${prefix}VersionLS`]) >>> 0;
  return [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyIcon(resources, iconFile, label) {
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  assert(groups.length === 1, `${label}: expected one PE icon group, found ${groups.length}.`);
  const group = groups[0];
  assert(group.icons.length === iconFile.icons.length, `${label}: PE icon count differs from the approved ICO.`);
  for (let index = 0; index < iconFile.icons.length; index += 1) {
    const expected = iconFile.icons[index];
    const actual = group.icons[index];
    const expectedWidth = expected.width || 256;
    const expectedHeight = expected.height || 256;
    const actualWidth = actual.width || 256;
    const actualHeight = actual.height || 256;
    assert(
      actualWidth === expectedWidth && actualHeight === expectedHeight && actual.bitCount === expected.bitCount,
      `${label}: PE icon metadata differs at index ${index}.`,
    );
    const entry = resources.entries.find(candidate => (
      candidate.type === 3 && candidate.id === actual.iconID && candidate.lang === group.lang
    ));
    assert(entry, `${label}: PE icon resource ${actual.iconID} is missing.`);
    assert(
      Buffer.from(entry.bin).equals(Buffer.from(expected.data.bin)),
      `${label}: PE icon bytes differ from the approved ICO at ${expectedWidth}x${expectedHeight}.`,
    );
  }
  return iconFile.icons.length;
}

function verifyAsarIntegrity(resources, expectedHeaderSha256, label) {
  const entries = resources.entries.filter(entry => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR');
  assert(entries.length === 1, `${label}: expected one INTEGRITY/ELECTRONASAR resource, found ${entries.length}.`);
  let integrity;
  try {
    integrity = JSON.parse(Buffer.from(entries[0].bin).toString('utf8'));
  } catch (error) {
    throw new Error(`${label}: INTEGRITY/ELECTRONASAR is not valid JSON: ${error.message}`);
  }
  assert(Array.isArray(integrity) && integrity.length === 1, `${label}: embedded ASAR integrity list is invalid.`);
  const item = integrity[0];
  assert(item?.file === 'resources\\app.asar', `${label}: embedded ASAR integrity file is invalid.`);
  assert(item?.alg === 'SHA256', `${label}: embedded ASAR integrity algorithm is invalid.`);
  assert(String(item?.value || '').toLowerCase() === expectedHeaderSha256, `${label}: embedded ASAR header hash differs from the protected payload.`);
  return {
    resource: 'INTEGRITY/ELECTRONASAR',
    file: item.file,
    algorithm: item.alg,
    header_sha256: expectedHeaderSha256,
  };
}

function verifyExecutable(spec, iconFile, numericVersion, releaseVersion, commitSha, asarHeaderSha256) {
  const bytes = fs.readFileSync(spec.path);
  assert(bytes.subarray(0, 2).equals(Buffer.from('MZ')), `${spec.id}: not a Windows PE executable.`);
  const executable = NtExecutable.from(bytes);
  const resources = NtExecutableResource.from(executable);
  const iconCount = spec.icon ? verifyIcon(resources, iconFile, spec.id) : 0;
  const asarIntegrity = spec.asarIntegrity ? verifyAsarIntegrity(resources, asarHeaderSha256, spec.id) : null;
  const versions = Resource.VersionInfo.fromEntries(resources.entries);
  assert(versions.length === 1, `${spec.id}: expected one PE version resource, found ${versions.length}.`);
  const info = versions[0];
  const languages = info.getAllLanguagesForStringValues();
  assert(languages.length === 1, `${spec.id}: expected one PE string language, found ${languages.length}.`);
  const strings = info.getStringValues(languages[0]);
  for (const [key, expected] of Object.entries(spec.strings)) {
    if (expected instanceof RegExp) {
      assert(expected.test(String(strings[key] || '')), `${spec.id}: PE ${key} is invalid: ${String(strings[key] || '')}`);
    } else {
      assert(strings[key] === expected, `${spec.id}: PE ${key} differs (expected ${expected}, got ${String(strings[key] || '')}).`);
    }
  }
  assert(
    JSON.stringify(exactVersion(info.fixedInfo, 'file')) === JSON.stringify(numericVersion),
    `${spec.id}: fixed PE file version differs from ${numericVersion.join('.')}.`,
  );
  assert(
    JSON.stringify(exactVersion(info.fixedInfo, 'product')) === JSON.stringify(numericVersion),
    `${spec.id}: fixed PE product version differs from ${numericVersion.join('.')}.`,
  );
  return {
    id: spec.id,
    file: path.basename(spec.path),
    bytes: bytes.length,
    sha256: sha256(spec.path),
    icon_images: iconCount,
    file_version: exactVersion(info.fixedInfo, 'file').join('.'),
    product_version: exactVersion(info.fixedInfo, 'product').join('.'),
    string_values: Object.fromEntries(Object.keys(spec.strings).map(key => [key, strings[key]])),
    asar_integrity: asarIntegrity,
    release_version: releaseVersion,
    commit_sha: commitSha,
  };
}

const iconPath = argument('--icon');
const outputPath = argument('--output');
const releaseVersion = textArgument('--version');
const commitSha = textArgument('--commit-sha').toLowerCase();
const asarHeaderSha256 = textArgument('--asar-header-sha256').toLowerCase();
assert(/^[0-9a-f]{40}$/.test(commitSha), 'Commit SHA must be an exact lowercase Git SHA.');
assert(/^[0-9a-f]{64}$/.test(asarHeaderSha256), 'ASAR header SHA-256 must be exact lowercase hexadecimal.');
const versionMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(releaseVersion);
assert(versionMatch, `Invalid release SemVer: ${releaseVersion}`);
const numericVersion = versionMatch.slice(1, 4).map(Number).concat(0);
const iconFile = Data.IconFile.from(fs.readFileSync(iconPath));
assert(iconFile.icons.length > 0, 'Approved ICO contains no images.');

const dotnetProductVersion = new RegExp(`^${releaseVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\+${commitSha}$`);
const specs = [
  {
    id: 'application', path: argument('--application'), icon: true, asarIntegrity: true,
    strings: {
      CompanyName: 'JustFun', FileDescription: 'JustFun Логистика', FileVersion: releaseVersion,
      InternalName: 'OrdersLogistics', OriginalFilename: 'OrdersLogistics.exe',
      ProductName: 'JustFun Логистика', ProductVersion: releaseVersion,
    },
  },
  {
    id: 'premium_setup', path: argument('--setup'), icon: true,
    strings: {
      CompanyName: 'JustFun', FileDescription: 'Премиальный установщик JustFun Логистика',
      FileVersion: numericVersion.join('.'), InternalName: 'JustFunPremiumSetup.dll',
      OriginalFilename: 'JustFunPremiumSetup.dll', ProductName: 'JustFun Логистика',
      ProductVersion: dotnetProductVersion,
    },
  },
  {
    id: 'setup_engine', path: argument('--setup-engine'), icon: true,
    strings: {
      CompanyName: 'JustFun', FileDescription: 'Установщик JustFun Логистика',
      FileVersion: numericVersion.join('.'), ProductName: 'JustFun Логистика', ProductVersion: releaseVersion,
    },
  },
  {
    id: 'recovery', path: argument('--recovery'), icon: true,
    strings: {
      CompanyName: 'JustFun', FileDescription: 'Диагностика JustFun Логистика',
      FileVersion: numericVersion.join('.'), ProductName: 'JustFun Логистика — диагностика', ProductVersion: releaseVersion,
    },
  },
  {
    id: 'update_helper', path: argument('--update-helper'), icon: false,
    strings: {
      CompanyName: 'JustFun', FileDescription: 'JustFunUpdateHelper', FileVersion: numericVersion.join('.'),
      InternalName: 'JustFunUpdateHelper.dll', OriginalFilename: 'JustFunUpdateHelper.dll',
      ProductName: 'JustFun Логистика', ProductVersion: dotnetProductVersion,
    },
  },
];

const evidence = {
  schema_version: 1,
  product_id: 'justfun-logistics',
  version: releaseVersion,
  commit_sha: commitSha,
  approved_icon: { file: path.basename(iconPath), bytes: fs.statSync(iconPath).size, sha256: sha256(iconPath) },
  executables: specs.map(spec => verifyExecutable(spec, iconFile, numericVersion, releaseVersion, commitSha, asarHeaderSha256)),
  status: 'passed',
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`PE icon and metadata gate: PASS (${evidence.executables.length} executables)\n`);
