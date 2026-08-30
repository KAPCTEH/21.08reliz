param(
  [string]$OutputDirectory,
  [string]$Makensis,
  [switch]$SkipDependencyInstall,
  [switch]$SkipInstallerAcceptance,
  [switch]$AllowBlockedOwnerRc
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$release = Get-Content -LiteralPath (Join-Path $repo 'source\application\release.json') -Raw | ConvertFrom-Json
$version = [string]$release.version
if ($version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
  throw "Некорректная версия в release.json: $version"
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $repo "build\windows-$version-$stamp"
}
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) {
  if (-not (Test-Path -LiteralPath $output -PathType Container)) {
    throw "Путь результата не является папкой: $output"
  }
  if (@(Get-ChildItem -LiteralPath $output -Force).Count -gt 0) {
    throw "Папка результата должна быть пустой: $output"
  }
} else {
  New-Item -ItemType Directory -Path $output -Force | Out-Null
}

$payload = Join-Path $output 'payload'
$installer = Join-Path $output 'installer'
$evidence = Join-Path $output 'evidence'
New-Item -ItemType Directory -Path $installer, $evidence -Force | Out-Null
$gatePath = Join-Path $output 'RELEASE-GATE.json'
$buildIdentityPath = Join-Path $output 'BUILD-IDENTITY.json'
$sourceArchivePath = Join-Path $output 'SOURCE.zip'
$testEvidencePath = Join-Path $output 'PREBUILD-TEST-RESULTS.json'
$updateHelperDirectory = Join-Path $output 'update-helper'
$updateHelperPath = Join-Path $updateHelperDirectory 'JustFunUpdateHelper.exe'
$updateHelperSelfTest = Join-Path $evidence 'UPDATE-HELPER-SELF-TEST.json'
$fileVersion = (($version -split '[-+]')[0]) + '.0'
$gate = [ordered]@{
  schema = 1
  product = 'JustFun Логистика'
  version = $version
  release_eligible = $false
  source_archive = '02-ИСХОДНЫЙ-КОД'
  installer_acceptance = 'not-run'
  created_at = (Get-Date).ToUniversalTime().ToString('o')
  errors = @()
}

function Invoke-Checked([string]$File, [string[]]$Arguments, [string]$WorkingDirectory = $repo) {
  Push-Location $WorkingDirectory
  try {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$File завершился с кодом $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

try {
  Invoke-Checked 'node' @('tools/release/verify-release-contract.mjs')
  Invoke-Checked 'node' @('tools/release/write-build-identity.mjs', '--output', $buildIdentityPath)
  Invoke-Checked 'git' @('archive', '--format=zip', "--output=$sourceArchivePath", 'HEAD')
  if (-not $SkipDependencyInstall) {
    foreach ($directory in @(
      'source/application',
      'source/desktop-runtime',
      'source/installer',
      'source/update-catalog-service',
      'tests'
    )) {
      Invoke-Checked 'npm.cmd' @('ci') (Join-Path $repo $directory)
    }
  }
  Invoke-Checked 'dotnet' @(
    'restore', 'source/update-helper/JustFunUpdateHelper.csproj', '--locked-mode',
    "/p:JustFunProductVersion=$version", "/p:JustFunProductFileVersion=$fileVersion"
  )
  Invoke-Checked 'dotnet' @(
    'publish', 'source/update-helper/JustFunUpdateHelper.csproj', '-c', 'Release', '-r', 'win-x64',
    '--self-contained', 'true', '--no-restore', '-o', $updateHelperDirectory,
    "/p:JustFunProductVersion=$version", "/p:JustFunProductFileVersion=$fileVersion"
  )
  Invoke-Checked $updateHelperPath @("--self-test-report=$updateHelperSelfTest")

  Invoke-Checked 'node' @('tests/audit-tools-unit.mjs')
  Invoke-Checked 'node' @('tests/security-audit.mjs', 'source', 'tools', '.github')
  Invoke-Checked 'node' @('tests/security-manifest-unit.cjs')
  Invoke-Checked 'node' @('tests/security-regression-v783.mjs')
  Invoke-Checked 'node' @('tests/source-hygiene-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/static-audit-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/main-unit.cjs')
  Invoke-Checked 'node' @('tests/tz3-live-defects-unit.cjs')
  Invoke-Checked 'node' @('tests/action-dispatch-unit.cjs')
  Invoke-Checked 'node' @('tests/startup-auth-regression.cjs')
  Invoke-Checked 'node' @('tests/license-server-unit.mjs')
  Invoke-Checked 'node' @('tests/license-invitation-accept-unit.mjs')
  Invoke-Checked 'node' @('tests/license-exact-permissions-runtime-unit.mjs')
  Invoke-Checked 'python' @('tests/license-schema-test.py')
  Invoke-Checked 'python' @('tests/license-custom-role-migration-test.py')
  Invoke-Checked 'python' @('tests/license-exact-permission-migration-test.py')
  Invoke-Checked 'python' @('tests/license-granular-permission-migration-test.py')
  Invoke-Checked 'node' @('tests/auth-reg-source-contract.cjs')
  Invoke-Checked 'node' @('tests/permission-compat-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/company-scope-test.mjs')
  Invoke-Checked 'node' @('tests/local-outbox-v783-unit.cjs')
  Invoke-Checked 'node' @('tests/atomic-mutation-async-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/update-core-unit.cjs')
  Invoke-Checked 'node' @('tests/update-downloader-unit.cjs')
  Invoke-Checked 'node' @('tests/update-controller-unit.cjs')
  Invoke-Checked 'node' @('tests/update-ui-unit.cjs')
  Invoke-Checked 'node' @('tests/update-helper-runner-unit.cjs')
  Invoke-Checked 'node' @('tests/update-catalog-ops-unit.mjs')
  Invoke-Checked 'node' @('tests/update-catalog-worker-unit.mjs')
  Invoke-Checked 'npm.cmd' @('run', 'check') (Join-Path $repo 'source/update-catalog-service')
  Invoke-Checked 'python' @('tests/release-evidence-unit.py')
  Invoke-Checked 'python' @('tests/installer-builder-unit.py')
  Invoke-Checked 'node' @('tests/reg-entity-source-contract.cjs')
  Invoke-Checked 'python' @('tests/reg-api-contract-test.py')
  Invoke-Checked 'python' @('tests/reg-entity-protocol-test.py')
  Invoke-Checked 'python' @('tests/reg-map-proxy-test.py')
  Invoke-Checked 'node' @('tests/reg-native-ssh-unit.cjs')
  Invoke-Checked 'node' @('tests/reg-tls-source-test.cjs')
  Invoke-Checked 'python' @('tests/reg-legacy-migration-unit.py')
  Invoke-Checked 'python' @('tests/reg-legacy-migration-integration.py')
  Invoke-Checked 'node' @('tests/entity-bootstrap-merge-unit.cjs')
  Invoke-Checked 'node' @('tests/active-warehouse-persistence-unit.cjs')
  Invoke-Checked 'node' @('tests/active-warehouse-recovery-runtime-unit.cjs')
  Invoke-Checked 'node' @('tests/entity-remote-apply-atomicity-unit.cjs')
  Invoke-Checked 'python' @('tests/reg-revision-test.py')
  Invoke-Checked 'node' @('tests/background-cloud-sync-failure-regression-v783.cjs')
  Invoke-Checked 'python' @('tests/company-telegram-broker-schema-test.py')
  Invoke-Checked 'node' @('tests/company-telegram-broker-unit.mjs')
  Invoke-Checked 'node' @('tests/telegram-scope-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/telegram-shared-d1-schema.cjs')
  Invoke-Checked 'node' @('tests/telegram-system-proxy-transport-unit.cjs')
  Invoke-Checked 'node' @('tests/telegram-wizard-open-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/telegram-worker-unit.mjs')
  Invoke-Checked 'node' @('tests/current-cycle-regression-v783.mjs')
  Invoke-Checked 'node' @('tests/company-settings-mutation-contract.cjs')
  Invoke-Checked 'node' @('tests/order-detail-control-permissions-contract.cjs')
  Invoke-Checked 'node' @('tests/reverse-inventory-movement-guard-contract.cjs')
  Invoke-Checked 'node' @('tests/route-closure-cleanup-contract.cjs')
  Invoke-Checked 'node' @('tests/route-driver-terms-binding-contract.cjs')
  Invoke-Checked 'node' @('tests/route-planning-permission-contract.cjs')
  Invoke-Checked 'node' @('tests/address-intelligence-unit-v783.cjs')
  Invoke-Checked 'python' @('tests/reg-address-search-test.py')
  Invoke-Checked 'node' @('tests/design-token-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/product-drawer-accessibility-v783.cjs')
  Invoke-Checked 'node' @('tests/dead-override-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/deep-business-fixture-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/desktop-dialog-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/error-boundary-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/icon-system-regression-v783.cjs')
  Invoke-Checked 'python' @('tests/logo-transparency-test.py')
  Invoke-Checked 'node' @('tests/map-diagnostic-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/route-stage-pagination-unit.cjs')
  Invoke-Checked 'node' @('tests/runtime-overrides-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/role-matrix-all.mjs')
  $env:JF_TEST_EDITION = 'demo'
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'accessibility')
  $env:JF_TEST_EDITION = 'full'
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'order-print')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'order-save-integrity')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'security-fuzz')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'atomic-mutation')
  $env:JF_TEST_DATA_SERVICE_DISABLED = '1'
  try {
    Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'local-mutation-durability')
    Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'local-warehouse')
  } finally {
    Remove-Item Env:JF_TEST_DATA_SERVICE_DISABLED -ErrorAction SilentlyContinue
  }
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'local-first-offline')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'local-first-retry')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'bootstrap-version-conflict')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'bootstrap-scope-isolation')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'background-scope-race')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'outbox-aba-race')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'critical-scope-guard')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'critical-crash-recovery')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'critical-storage-failover')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'ordinary-crash-recovery')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'entity-ack-validation')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'local-to-server-migration')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'local-to-server-migration-resume')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'deep-business')
  Invoke-Checked 'node' @('tests/experience-regression-v783.mjs')
  Invoke-Checked 'node' @('tests/visual-qa-contract-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/release-regression-v783.mjs')
  Invoke-Checked 'python' @('tests/installer-source-test.py')

  $head = (git -C $repo rev-parse HEAD).Trim().ToLowerInvariant()
  [ordered]@{
    schema_version = 1
    commit_sha = $head
    groups = @(
      [ordered]@{ id = 'source-contracts'; status = 'passed' },
      [ordered]@{ id = 'security'; status = 'passed' },
      [ordered]@{ id = 'business-regression'; status = 'passed' },
      [ordered]@{ id = 'installer-source'; status = 'passed' },
      [ordered]@{ id = 'updater-core'; status = 'passed' }
    )
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $testEvidencePath -Encoding utf8

  Invoke-Checked 'python' @(
    'source/desktop-runtime/build_payload.py',
    '--app-dir', 'source/application',
    '--electron-dist', 'source/desktop-runtime/node_modules/electron/dist',
    '--update-helper', $updateHelperPath,
    '--output-dir', $payload
  )
  Invoke-Checked 'node' @('tests/update-payload-identity-test.mjs', $payload)

  $printQa = Join-Path $evidence 'print-qa'
  New-Item -ItemType Directory -Path $printQa -Force | Out-Null
  $payloadApplication = Join-Path $payload 'OrdersLogistics.exe'
  $printQaProcess = Start-Process -FilePath $payloadApplication -ArgumentList @("--print-qa-output=$printQa") -PassThru -Wait -WindowStyle Hidden
  if ($printQaProcess.ExitCode -ne 0) {
    throw "Защищённый payload завершил PDF-проверку с кодом $($printQaProcess.ExitCode)."
  }
  $printQaResult = Get-Content -LiteralPath (Join-Path $printQa 'PRINT-QA.json') -Raw | ConvertFrom-Json
  if (@($printQaResult.errors).Count -ne 0 -or @($printQaResult.documents).Count -ne 5) {
    throw 'Проверка PDF не создала пять корректных документов.'
  }

  $installerArguments = @(
    'source/installer/build_windows.py',
    '--payload-dir', $payload,
    '--logo', 'source/application/assets/JustFun-official.png',
    '--output-dir', $installer,
    '--node-modules', 'source/desktop-runtime/node_modules',
    '--build-identity', $buildIdentityPath,
    '--source-archive', $sourceArchivePath,
    '--test-evidence', $testEvidencePath
  )
  if (-not [string]::IsNullOrWhiteSpace($Makensis)) {
    $installerArguments += @('--makensis', $Makensis)
  }
  Invoke-Checked 'python' $installerArguments
  Invoke-Checked 'node' @(
    'tools/release/verify-build-manifest.mjs',
    '--manifest', (Join-Path $installer 'BUILD-MANIFEST.json'),
    '--build-identity', $buildIdentityPath,
    '--source-archive', $sourceArchivePath,
    '--payload-dir', $payload,
    '--installer-dir', $installer
  )

  $setup = Join-Path $installer "Orders-Logistics-Setup-$version-Premium.exe"
  if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) {
    throw "Установщик не создан: $setup"
  }

  if ($SkipInstallerAcceptance) {
    $gate.installer_acceptance = 'skipped'
  } else {
    Invoke-Checked 'powershell.exe' @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', (Join-Path $repo 'tests/installer-full-acceptance-test.ps1'),
      '-Setup', $setup,
      '-EvidenceDirectory', $evidence
    )
    $gate.installer_acceptance = 'passed'
    $gate.release_eligible = $true
  }
} catch {
  $gate.errors = @($_.Exception.Message)
  throw
} finally {
  $gate | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $gatePath -Encoding UTF8
}

$packageArguments = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', (Join-Path $repo 'tools/package-owner-rc.ps1'),
  '-InstallerDirectory', $installer,
  '-ReleaseGate', $gatePath,
  '-OutputDirectory', $output
)
if ($AllowBlockedOwnerRc) { $packageArguments += '-AllowBlockedOwnerRc' }
Invoke-Checked 'powershell.exe' $packageArguments
Write-Output "Windows release candidate created: $output"
