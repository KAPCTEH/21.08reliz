import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createPackageWithOptions, getRawHeader } from '@electron/asar';
import { flipFuses, FuseVersion, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing required argument: ${name}`);
  return path.resolve(process.argv[index + 1]);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function exactArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function brandWindowsExecutable(executablePath, iconPath) {
  const executableImage = NtExecutable.from(fs.readFileSync(executablePath));
  const resources = NtExecutableResource.from(executableImage);
  const iconGroups = Resource.IconGroupEntry.fromEntries(resources.entries);
  if (iconGroups.length !== 1) {
    throw new Error('Failed to locate a single Windows icon group.');
  }
  const iconFile = Data.IconFile.from(fs.readFileSync(iconPath));
  Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    iconGroups[0].id,
    iconGroups[0].lang,
    iconFile.icons.map(item => item.data),
  );
  const versionInfo = Resource.VersionInfo.fromEntries(resources.entries);
  if (versionInfo.length !== 1) {
    throw new Error('Failed to locate a single Windows version-info resource.');
  }
  const languages = versionInfo[0].getAllLanguagesForStringValues();
  if (languages.length !== 1) {
    throw new Error('Failed to locate a single Windows resource language.');
  }
  versionInfo[0].setFileVersion(7, 8, 3, 0);
  versionInfo[0].setProductVersion(7, 8, 3, 0);
  versionInfo[0].setStringValues(languages[0], {
    CompanyName: 'JustFun',
    FileDescription: 'JustFun Логистика',
    FileVersion: '7.8.3',
    InternalName: 'OrdersLogistics',
    OriginalFilename: 'OrdersLogistics.exe',
    ProductName: 'JustFun Логистика',
    ProductVersion: '7.8.3',
  });
  versionInfo[0].outputToResourceEntries(resources.entries);
  resources.outputResource(executableImage);
  fs.writeFileSync(executablePath, Buffer.from(executableImage.generate()));
}

function embedWindowsAsarIntegrity(executablePath, archivePath) {
  const { headerString } = getRawHeader(archivePath);
  const headerHash = crypto.createHash('sha256').update(headerString, 'utf8').digest('hex');
  const executableData = fs.readFileSync(executablePath);
  const executableImage = NtExecutable.from(executableData);
  const resources = NtExecutableResource.from(executableImage);
  const versionInfo = Resource.VersionInfo.fromEntries(resources.entries);
  if (versionInfo.length !== 1) {
    throw new Error('Failed to locate a single Windows version-info resource.');
  }
  const languages = versionInfo[0].getAllLanguagesForStringValues();
  if (languages.length !== 1) {
    throw new Error('Failed to locate a single Windows resource language.');
  }
  const integrityList = [{
    file: 'resources\\app.asar',
    alg: 'SHA256',
    value: headerHash,
  }];
  const integrityBuffer = Buffer.from(JSON.stringify(integrityList), 'utf8');
  resources.entries.push({
    type: 'INTEGRITY',
    id: 'ELECTRONASAR',
    bin: exactArrayBuffer(integrityBuffer),
    lang: languages[0].lang,
    codepage: languages[0].codepage,
  });
  resources.outputResource(executableImage);
  fs.writeFileSync(executablePath, Buffer.from(executableImage.generate()));
  return headerHash.toUpperCase();
}

const appDir = argument('--app-dir');
const resourcesDir = argument('--resources-dir');
const executable = argument('--executable');
const appAsar = path.join(resourcesDir, 'app.asar');
const applicationIcon = path.join(appDir, 'assets', 'JustFun.ico');

if (!fs.statSync(appDir).isDirectory()) throw new Error(`Application staging directory not found: ${appDir}`);
if (!fs.statSync(resourcesDir).isDirectory()) throw new Error(`Electron resources directory not found: ${resourcesDir}`);
if (!fs.statSync(executable).isFile()) throw new Error(`Electron executable not found: ${executable}`);
if (!fs.statSync(applicationIcon).isFile()) throw new Error(`Application icon not found: ${applicationIcon}`);
if (fs.existsSync(appAsar)) throw new Error(`Refusing to overwrite existing archive: ${appAsar}`);

await createPackageWithOptions(appDir, appAsar, {
  unpack: '**/*.{exe,dll,node}',
});

brandWindowsExecutable(executable, applicationIcon);
const asarHeaderHash = embedWindowsAsarIntegrity(executable, appAsar);

await flipFuses(executable, {
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  // The renderer is loaded from the packaged ASAR and does not need the
  // legacy file:// privilege extension. Keep the fuse disabled so a future
  // renderer change cannot silently re-enable the broader file protocol.
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  [FuseV1Options.WasmTrapHandlers]: true,
});

const fuses = await getCurrentFuseWire(executable);
const manifest = {
  schema: 3,
  generated_at: new Date().toISOString(),
  archive: 'app.asar',
  archive_sha256: sha256(appAsar),
  archive_header_sha256: asarHeaderHash,
  windows_integrity_resource: 'INTEGRITY/ELECTRONASAR',
  executable_branding: 'JustFun Логистика 7.8.3',
  loose_application_directory_present: fs.existsSync(path.join(resourcesDir, 'app')),
  fuses,
  integrity_model: 'electron-asar-header-sha256',
};
fs.writeFileSync(path.join(resourcesDir, 'justfun-security.json'), JSON.stringify(manifest, null, 2), 'utf8');
process.stdout.write(`${JSON.stringify(manifest)}\n`);
