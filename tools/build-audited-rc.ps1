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
      'tests'
    )) {
      Invoke-Checked 'npm.cmd' @('ci') (Join-Path $repo $directory)
    }
  }

  Invoke-Checked 'node' @('tests/security-audit.mjs', 'source', 'tools', '.github')
  Invoke-Checked 'node' @('tests/source-hygiene-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/static-audit-regression-v783.cjs')
  Invoke-Checked 'node' @('tests/main-unit.cjs')
  Invoke-Checked 'node' @('tests/current-cycle-regression-v783.mjs')
  $env:JF_TEST_EDITION = 'full'
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'order-print')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'order-save-integrity')
  Invoke-Checked 'node' @('tests/runtime-smoke.mjs', 'source/application/web', 'atomic-mutation')
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
      [ordered]@{ id = 'installer-source'; status = 'passed' }
    )
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $testEvidencePath -Encoding utf8

  Invoke-Checked 'python' @(
    'source/desktop-runtime/build_payload.py',
    '--app-dir', 'source/application',
    '--electron-dist', 'source/desktop-runtime/node_modules/electron/dist',
    '--output-dir', $payload
  )

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
