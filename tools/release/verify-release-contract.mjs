#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const checks = [];
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function relative(file) {
  return path.relative(repository, file).split(path.sep).join('/');
}

function readText(file) {
  return fs.readFileSync(path.join(repository, ...file.split('/')), 'utf8');
}

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch (error) {
    failures.push(`${file}: invalid JSON: ${error.message}`);
    return null;
  }
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function checked(name, callback) {
  const before = failures.length;
  try {
    callback();
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
  checks.push({ name, passed: failures.length === before });
}

const release = readJson('source/application/release.json');
const releaseSchema = readJson('release/release-contract.schema.json');
const catalogSchema = readJson('release/test-catalog.schema.json');
const catalog = readJson('release/test-catalog.json');
const updateCatalogSchema = readJson('release/update-catalog.schema.json');
const updateJournalSchema = readJson('release/update-journal.schema.json');
const buildManifestSchema = readJson('release/build-manifest.schema.json');
const compatibility = readJson('release/compatibility-policy.json');

checked('release-contract-shape', () => {
  assert(release?.schema_version === 1, 'release schema_version must be 1');
  assert(release?.product_id === 'justfun-logistics', 'release product_id is invalid');
  assert(typeof release?.product_name === 'string' && release.product_name.length > 0, 'release product_name is missing');
  assert(semverPattern.test(release?.version || ''), 'release version is not SemVer');
  assert(semverPattern.test(release?.minimum_supported_version || ''), 'minimum_supported_version is not SemVer');
  assert(release?.version_scheme === 'semver', 'version_scheme must be semver');
  assert(release?.source_commit_policy === 'resolve_at_build', 'source commit must be resolved at build time');
  const channels = release?.supported_channels || [];
  assert(JSON.stringify(channels) === JSON.stringify(['internal', 'staging', 'stable']), 'supported release channels are invalid');
  assert(channels.includes(release?.default_channel), 'default release channel is unsupported');
  assert(release?.windows?.architecture === 'x64', 'Windows architecture must be x64');
  assert(release?.windows?.install_scope === 'per-user', 'Windows install scope must be per-user');
  assert(release?.windows?.authenticode_required === false, 'Authenticode must remain explicitly non-blocking');
  assert(releaseSchema?.$id === 'https://justfun.invalid/release/release-contract.schema.json', 'release schema identity is invalid');
});

checked('contract-versions', () => {
  const contracts = release?.contracts || {};
  for (const name of ['update_manifest', 'reg_api', 'license_auth', 'license_auth_context', 'telegram_broker', 'storage_protocol']) {
    assert(Number.isInteger(contracts[name]) && contracts[name] > 0, `release contract ${name} is invalid`);
  }
  const main = readText('source/application/main.js');
  const server = readText('source/application/integrations/reg-vps/server/server.py');
  const license = readText('source/license-server/worker.mjs');
  const broker = readText('source/company-telegram-broker/worker.mjs');
  assert(main.includes(`const REG_API_CONTRACT=${contracts.reg_api};`), 'desktop REG API contract differs from release.json');
  assert(server.includes(`API_CONTRACT = ${contracts.reg_api}`), 'VPS API contract differs from release.json');
  assert(license.includes(`auth_contract: ${contracts.license_auth}`), 'license auth contract differs from release.json');
  assert(license.includes(`auth_context_version: ${contracts.license_auth_context}`), 'license auth context differs from release.json');
  assert(broker.includes(`broker_contract: ${contracts.telegram_broker}`), 'Telegram broker contract differs from release.json');
});

checked('package-versions', () => {
  const expected = new Map([
    ['source/application', release?.service_versions?.desktop],
    ['source/desktop-runtime', release?.service_versions?.desktop],
    ['source/installer', release?.service_versions?.desktop],
    ['source/license-server', release?.service_versions?.license_api],
    ['source/company-telegram-broker', release?.service_versions?.company_telegram_broker],
  ]);
  assert(release?.service_versions?.desktop === release?.version, 'desktop service version must equal product version');
  assert(release?.service_versions?.reg_api === release?.version, 'REG API service version must equal product version');
  assert(release?.service_versions?.telegram_worker === release?.version, 'Telegram Worker version must equal product version');
  for (const [directory, expectedVersion] of expected) {
    const packageJson = readJson(`${directory}/package.json`);
    const packageLock = readJson(`${directory}/package-lock.json`);
    assert(packageJson?.version === expectedVersion, `${directory}/package.json version differs from release.json`);
    assert(packageLock?.version === expectedVersion, `${directory}/package-lock.json version differs from release.json`);
    assert(packageLock?.packages?.['']?.version === expectedVersion, `${directory}/package-lock root version differs from release.json`);
    assert(packageJson?.name === packageLock?.name, `${directory} package and lock names differ`);
  }
});

checked('runtime-version-consumers', () => {
  const main = readText('source/application/main.js');
  const payload = readText('source/desktop-runtime/build_payload.py');
  const hardener = readText('source/desktop-runtime/harden_payload.mjs');
  const installer = readText('source/installer/build_windows.py');
  const windowsWorkflow = readText('.github/workflows/windows-native-783.yml');
  const installerAcceptance = readText('tests/installer-full-acceptance-test.ps1');
  const preload = readText('source/application/preload.js');
  const nativeSsh = readText('source/application/integrations/reg-vps/native-ssh.cjs');
  const provisioner = readText('source/application/integrations/telegram-cloudflare-native/provisioner.cjs');
  const premiumProject = readText('source/installer/premium-ui/JustFunPremiumSetup.csproj');
  const premiumWindow = readText('source/installer/premium-ui/MainWindow.xaml.cs');
  const premiumXaml = readText('source/installer/premium-ui/MainWindow.xaml');
  const premiumIdentity = readText('source/installer/premium-ui/ReleaseIdentity.cs');
  const releaseBuilder = readText('tools/build-audited-rc.ps1');
  const ownerPackager = readText('tools/package-owner-rc.ps1');
  const setupNsi = readText('source/installer/Setup.nsi');
  const recoveryNsi = readText('source/installer/Recovery.nsi');
  assert(main.includes("require('./release.json')"), 'desktop main process does not load the canonical release contract');
  assert(main.includes('const VERSION = RELEASE.version;'), 'desktop version is not derived from release.json');
  assert(!/const VERSION\s*=\s*['"]\d/.test(main), 'desktop contains a hard-coded product VERSION');
  assert(payload.includes('load_release_contract(app_dir)'), 'payload build does not load release.json');
  assert(!/^VERSION\s*=\s*['"]\d/m.test(payload), 'payload builder contains a hard-coded product VERSION');
  assert(hardener.includes("path.join(appDir, 'release.json')"), 'payload hardener does not load release.json');
  assert(!/setProductVersion\(7,\s*8,\s*3/.test(hardener), 'Windows resources contain a hard-coded product version');
  assert(installer.includes('version = (payload / "version")'), 'installer does not derive its version from the verified payload');
  assert(!/^VERSION\s*=\s*['"]\d/m.test(installer), 'installer contains a hard-coded product VERSION');
  assert(windowsWorkflow.includes('JF_PRODUCT_VERSION'), 'Windows workflow does not export the canonical product version');
  assert(windowsWorkflow.includes('verify-release-contract.mjs'), 'Windows workflow does not validate the release contract');
  assert(windowsWorkflow.includes('write-build-identity.mjs'), 'Windows workflow does not emit an exact build identity');
  assert(!windowsWorkflow.includes(`Orders-Logistics-Setup-${release.version}-Premium.exe`), 'Windows workflow contains a hard-coded installer version');
  assert(installerAcceptance.includes('source\\application\\release.json'), 'installer acceptance does not load release.json');
  assert(!installerAcceptance.includes(`version = '${release.version}'`), 'installer acceptance contains a hard-coded result version');
  assert(preload.includes("startsWith('--jf-version=')") && preload.includes('version: bootstrapVersion'), 'sandboxed preload does not consume the canonical version argument');
  assert(main.includes('`--jf-version=${VERSION}`'), 'main process does not pass the canonical version into sandboxed preloads');
  assert(nativeSsh.includes("require('../../release.json')") && nativeSsh.includes('version: RELEASE.version'), 'VPS provisioning version is not derived from release.json');
  assert(provisioner.includes("require('../../release.json')") && provisioner.includes('const DEPLOYMENT_VERSION = RELEASE.version;'), 'Telegram provisioning version is not derived from release.json');
  assert(!main.includes(`'JustFun-OrdersLogistics-self-test-${release.version}.json'`), 'main self-test path contains a hard-coded product version');
  assert(!main.includes(`'JustFun-OrdersLogistics-installer-smoke-${release.version}.json'`), 'main installer smoke path contains a hard-coded product version');
  assert(!premiumProject.includes(`<Version>${release.version}</Version>`), '.NET installer metadata contains a hard-coded product version');
  assert(premiumProject.includes('<Version>$(JustFunProductVersion)</Version>'), '.NET installer metadata is not bound to the canonical build version');
  assert(!premiumWindow.includes(`installer-${release.version}.log`), 'premium installer log contains a hard-coded product version');
  assert(premiumWindow.includes('ReleaseIdentity.Version'), 'premium installer UI does not consume its verified executable version');
  assert(premiumIdentity.includes('AssemblyInformationalVersionAttribute'), 'premium installer cannot read its verified executable version');
  assert(!premiumXaml.includes(`Text="${release.version}"`), 'premium installer UI contains a hard-coded product version');
  assert(releaseBuilder.includes('source\\application\\release.json') && releaseBuilder.includes('"Orders-Logistics-Setup-$version-Premium.exe"'), 'release builder does not derive artifact names from release.json');
  assert(ownerPackager.includes('source\\application\\release.json') && ownerPackager.includes('"JUSTFUN-$version-WINDOWS.zip"'), 'owner packager does not derive artifact names from release.json');
  assert(setupNsi.includes('!error "VERSION must come from the canonical release contract"'), 'Setup permits a non-canonical fallback version');
  assert(recoveryNsi.includes('!error "VERSION must come from the canonical release contract"'), 'Recovery permits a non-canonical fallback version');
  assert(installer.includes('"schema_version": 2'), 'Windows builder does not emit the extended BUILD-MANIFEST');
  assert(installer.includes('parser.add_argument("--build-identity", type=Path, required=True)'), 'Windows builder does not require exact build identity evidence');
  assert(installer.includes('f"/DFILE_VERSION={product_file_version}"'), 'NSIS file version is not derived from canonical SemVer');
});

checked('release-formats-and-compatibility', () => {
  assert(updateCatalogSchema?.$id === 'https://justfun.invalid/release/update-catalog.schema.json', 'update catalog schema identity is invalid');
  assert(updateJournalSchema?.$id === 'https://justfun.invalid/release/update-journal.schema.json', 'update journal schema identity is invalid');
  assert(buildManifestSchema?.$id === 'https://justfun.invalid/release/build-manifest.schema.json', 'build manifest schema identity is invalid');
  const states = updateJournalSchema?.properties?.state?.enum || [];
  for (const state of ['IDLE', 'CHECKING', 'UPDATE_AVAILABLE', 'DOWNLOADING', 'VERIFYING', 'READY_TO_APPLY', 'APPLYING', 'AWAITING_HEALTH_CONFIRMATION', 'CONFIRMED', 'ROLLING_BACK', 'ROLLED_BACK', 'FAILED']) {
    assert(states.includes(state), `update journal state is missing: ${state}`);
  }
  assert(updateCatalogSchema?.properties?.signature?.properties?.algorithm?.const === 'Ed25519', 'update catalog signature algorithm must be Ed25519');
  assert(compatibility?.schema_version === 1, 'compatibility policy schema_version must be 1');
  assert(compatibility?.product_id === release?.product_id, 'compatibility policy product differs from release.json');
  assert(compatibility?.version_scheme === release?.version_scheme, 'compatibility version scheme differs from release.json');
  assert(JSON.stringify(compatibility?.allowed_channels) === JSON.stringify(release?.supported_channels), 'compatibility channels differ from release.json');
  assert(compatibility?.minimum_supported_version === release?.minimum_supported_version, 'minimum supported version differs from release.json');
  assert(compatibility?.allow_automatic_downgrade === false, 'automatic downgrade must be disabled');
  assert(compatibility?.full_payload_only === true, 'first updater contract must require a full payload');
  for (const [name, version] of Object.entries(release?.contracts || {})) {
    assert(compatibility?.required_contracts?.[name]?.minimum === version, `compatibility minimum differs for ${name}`);
    assert(compatibility?.required_contracts?.[name]?.maximum === version, `compatibility maximum differs for ${name}`);
  }
});

checked('service-health-versions', () => {
  const license = readText('source/license-server/worker.mjs');
  const broker = readText('source/company-telegram-broker/worker.mjs');
  const regServer = readText('source/application/integrations/reg-vps/server/server.py');
  const telegramWorker = readText('source/application/integrations/telegram-cloudflare-native/worker/index.js');
  const telegramPackage = readJson('source/application/integrations/telegram-cloudflare-native/package.json');
  const index = readText('source/application/web/index.html');
  assert(license.includes(`version: '${release?.service_versions?.license_api}'`), 'license health version differs from release.json');
  assert(broker.includes(`version: '${release?.service_versions?.company_telegram_broker}'`), 'broker health version differs from release.json');
  assert(regServer.includes(`VERSION = "${release?.service_versions?.reg_api}"`), 'REG API version differs from release.json');
  assert(regServer.includes(`MIN_CLIENT_VERSION = "${release?.minimum_supported_version}"`), 'REG API minimum client version differs from release.json');
  assert(telegramWorker.includes(`env.DEPLOYMENT_VERSION || '${release?.service_versions?.telegram_worker}'`), 'Telegram Worker fallback version differs from release.json');
  assert(telegramPackage?.version === release?.service_versions?.telegram_worker, 'Telegram deployment package version differs from release.json');
  assert(index.includes(`<title>${release?.product_name} · ${release?.version}</title>`), 'application title version differs from release.json');
  assert(index.includes(`Версия системы: ${release?.version}`), 'application diagnostic version differs from release.json');
});

checked('test-catalog', () => {
  assert(catalogSchema?.$id === 'https://justfun.invalid/release/test-catalog.schema.json', 'test catalog schema identity is invalid');
  assert(catalog?.schema_version === 1, 'test catalog schema_version must be 1');
  const tests = catalog?.tests || [];
  assert(tests.length >= 60, 'test catalog unexpectedly lost required coverage');
  const ids = new Set();
  const requiredFields = [
    'id', 'name', 'level', 'path', 'command', 'cwd', 'prerequisites', 'env_allowlist', 'network_allowed',
    'executable_allowed', 'requires_explicit_live_authorization', 'modules', 'contracts',
    'expected_outputs', 'timeout_ms', 'artifact_paths', 'run_rule', 'invalidation_rule', 'class',
  ];
  for (const test of tests) {
    for (const field of requiredFields) assert(Object.hasOwn(test, field), `${test.id || '<missing id>'}: missing ${field}`);
    assert(/^JF-TEST-[A-Z0-9-]+$/.test(test.id || ''), `invalid test id: ${test.id}`);
    assert(!ids.has(test.id), `duplicate test id: ${test.id}`);
    ids.add(test.id);
    assert(typeof test.name === 'string' && test.name.length > 0, `${test.id}: test name is missing`);
    assert(['source', 'integration', 'windows', 'live', 'production'].includes(test.level), `${test.id}: test level is invalid`);
    const testPath = path.resolve(repository, ...String(test.path || '').split('/'));
    assert(testPath.startsWith(repository + path.sep), `${test.id}: test path escapes repository`);
    assert(fs.existsSync(testPath), `${test.id}: test path is missing: ${relative(testPath)}`);
    assert(Array.isArray(test.modules) && test.modules.length > 0, `${test.id}: modules are missing`);
    assert(Array.isArray(test.contracts) && test.contracts.length > 0, `${test.id}: contracts are missing`);
    assert(Array.isArray(test.expected_outputs) && test.expected_outputs.length > 0, `${test.id}: expected outputs are missing`);
    assert(Number.isInteger(test.timeout_ms) && test.timeout_ms >= 1000, `${test.id}: timeout is invalid`);
    if (test.network_allowed || test.executable_allowed) {
      assert(test.requires_explicit_live_authorization === true, `${test.id}: dangerous test is not explicitly gated`);
    }
  }
  for (const id of [
    'JF-TEST-RELEASE-CONTRACT',
    'JF-TEST-BUILD-MANIFEST',
    'JF-TEST-SECURITY-AUDIT',
    'JF-TEST-RUNTIME-SMOKE',
    'JF-TEST-INSTALLER-SOURCE-TEST',
    'JF-TEST-WINDOWS-NATIVE-783',
  ]) assert(ids.has(id), `required test catalog entry is missing: ${id}`);
});

const result = {
  schema_version: 1,
  product_id: release?.product_id || null,
  version: release?.version || null,
  checks,
  test_count: catalog?.tests?.length || 0,
  failures,
  passed: failures.length === 0,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
