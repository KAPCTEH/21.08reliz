param(
  [Parameter(Mandatory = $true)][string]$InstallerDirectory,
  [Parameter(Mandatory = $true)][string]$ReleaseGate,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [switch]$AllowBlockedOwnerRc
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$installer = (Resolve-Path -LiteralPath $InstallerDirectory).Path
$gatePath = (Resolve-Path -LiteralPath $ReleaseGate).Path
$output = [IO.Path]::GetFullPath($OutputDirectory)
$gate = Get-Content -LiteralPath $gatePath -Raw -Encoding UTF8 | ConvertFrom-Json
$release = Get-Content -LiteralPath (Join-Path $repo 'source\application\release.json') -Raw | ConvertFrom-Json
$version = [string]$release.version
if ($version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
  throw "Некорректная версия в release.json: $version"
}
if ([string]$gate.version -ne $version) {
  throw "Версия RELEASE-GATE.json не совпадает с release.json: $($gate.version) != $version"
}
if (-not $gate.release_eligible -and -not $AllowBlockedOwnerRc) {
  throw 'Сборка не прошла обязательную проверку установщика. Архив владельца не создан.'
}

$required = @(
  "Orders-Logistics-Setup-$version-Premium.exe",
  "Orders-Logistics-Recovery-$version.exe",
  "JustFun-$version-UpdateHelper.exe",
  "JustFun-$version-win-x64.zip",
  'UPDATE-FILES.json',
  'BUILD-MANIFEST.json'
)
foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $installer $name) -PathType Leaf)) {
    throw "В сборке отсутствует обязательный файл: $name"
  }
}

Push-Location $repo
try {
  $trackedChanges = git status --porcelain --untracked-files=no
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось проверить состояние Git.' }
  if (-not [string]::IsNullOrWhiteSpace(($trackedChanges -join "`n"))) {
    throw 'Есть незакоммиченные изменения отслеживаемых файлов. Архив исходников должен соответствовать точному коммиту.'
  }
  $head = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($head)) {
    throw 'Не удалось определить коммит исходников.'
  }
} finally {
  Pop-Location
}

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$tempRoot = Join-Path $tempBase ('jf-owner-' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $tempRoot 'package'
$setupStage = Join-Path $stage 'УСТАНОВЩИК'
$sourceArchive = Join-Path $stage '02-ИСХОДНЫЙ-КОД.zip'
$archive = Join-Path $output "JUSTFUN-$version-WINDOWS.zip"

try {
  New-Item -ItemType Directory -Path $setupStage -Force | Out-Null
  foreach ($name in $required) {
    Copy-Item -LiteralPath (Join-Path $installer $name) -Destination $setupStage -Force
  }
  Copy-Item -LiteralPath $gatePath -Destination (Join-Path $stage 'RELEASE-GATE.json') -Force

  Push-Location $repo
  try {
    & git archive --format=zip --output=$sourceArchive HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Git не создал архив исходников.' }
  } finally {
    Pop-Location
  }

  [ordered]@{
    product = 'JustFun Логистика'
    version = $version
    commit = $head
    release_eligible = [bool]$gate.release_eligible
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stage 'PACKAGE.json') -Encoding UTF8

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
  [IO.Compression.ZipFile]::CreateFromDirectory(
    $stage,
    $archive,
    [IO.Compression.CompressionLevel]::Optimal,
    $false
  )
} finally {
  $resolvedTempRoot = [IO.Path]::GetFullPath($tempRoot)
  if ($resolvedTempRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and
      [IO.Path]::GetFileName($resolvedTempRoot).StartsWith('jf-owner-', [StringComparison]::Ordinal)) {
    if (Test-Path -LiteralPath $resolvedTempRoot) {
      Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force
    }
  }
}

Write-Output "Owner archive: $archive"
