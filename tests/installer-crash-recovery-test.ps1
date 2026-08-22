param(
  [Parameter(Mandatory = $true)]
  [string]$Makensis,
  [Parameter(Mandatory = $true)]
  [string]$AssetsDir
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$Makensis = (Resolve-Path -LiteralPath $Makensis).Path
$AssetsDir = (Resolve-Path -LiteralPath $AssetsDir).Path

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Invoke-Setup([string]$Engine, [string]$ProgramDir, [string]$DataDir, [string]$LogPath) {
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Engine
  $start.UseShellExecute = $false
  $arguments = @(
    '/S',
    "/DATADIR=$DataDir",
    '/MODE=demo',
    "/LOG=$LogPath",
    '/NODESKTOP',
    '/NOSTART',
    "/D=$ProgramDir"
  )
  $start.Arguments = ($arguments | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' '
  $process = [Diagnostics.Process]::Start($start)
  $process.WaitForExit()
  return $process.ExitCode
}

function New-KnownInstallation([string]$Directory, [string]$Sentinel) {
  New-Item -ItemType Directory -Path "$Directory\resources" -Force | Out-Null
  Copy-Item -LiteralPath "$env:WINDIR\System32\notepad.exe" -Destination "$Directory\OrdersLogistics.exe" -Force
  $Sentinel | Set-Content -LiteralPath "$Directory\resources\app.asar" -Encoding utf8
  $Sentinel | Set-Content -LiteralPath "$Directory\$Sentinel.txt" -Encoding utf8
}

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ("JustFun-Installer-Crash-QA-" + [Guid]::NewGuid().ToString('N'))))
Assert-True ($tempRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) 'Temporary test root escaped the Windows temp directory.'

try {
  $payload = Join-Path $tempRoot 'payload'
  $source = Join-Path $tempRoot 'Setup.unicode.nsi'
  $engine = Join-Path $tempRoot 'JustFun.Setup.CrashQA.exe'
  New-Item -ItemType Directory -Path "$payload\resources" -Force | Out-Null
  Copy-Item -LiteralPath "$env:WINDIR\System32\notepad.exe" -Destination "$payload\OrdersLogistics.exe" -Force
  Copy-Item -LiteralPath "$env:WINDIR\System32\notepad.exe" -Destination "$payload\Orders-Logistics-Recovery.exe" -Force
  'fixture-asar' | Set-Content -LiteralPath "$payload\resources\app.asar" -Encoding utf8
  '{"schema":1}' | Set-Content -LiteralPath "$payload\resources\justfun-security.json" -Encoding utf8
  '9.9.9' | Set-Content -LiteralPath "$payload\version" -Encoding ascii

  $setupText = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\source\installer\Setup.nsi') -Raw -Encoding utf8
  [IO.File]::WriteAllText($source, $setupText, [Text.UTF8Encoding]::new($true))
  & $Makensis /WX /V2 /DVERSION=9.9.9 /DFILE_VERSION=9.9.9.0 /DREQUIRED_MB=2000000000 "/DPAYLOAD_DIR=$payload" "/DASSETS_DIR=$AssetsDir" "/DOUT_FILE=$engine" $source
  Assert-True ($LASTEXITCODE -eq 0) "Crash-recovery fixture did not compile: $LASTEXITCODE"
  Assert-True (Test-Path -LiteralPath $engine -PathType Leaf) 'Crash-recovery fixture engine is missing.'

  # 0. A genuinely clean target does not exist yet. DriveSpace must query the
  # existing volume root, reach the deliberate low-space branch and never
  # misdiagnose the missing target directory as an unreadable disk.
  $case0 = Join-Path $tempRoot 'fresh-target-disk-space'
  $program0 = Join-Path $case0 'NeverCreatedBefore\App'
  $log0 = Join-Path $case0 'setup.log'
  New-Item -ItemType Directory -Path $case0 -Force | Out-Null
  Assert-True (-not (Test-Path -LiteralPath $program0)) 'Fresh-target fixture unexpectedly exists before Setup.'
  $exit0 = Invoke-Setup $engine $program0 (Join-Path $case0 'Data') $log0
  Assert-True ($exit0 -eq 10) "Fresh-target disk-space probe returned $exit0 instead of 10."
  $log0Text = Get-Content -LiteralPath $log0 -Raw
  Write-Output "Fresh-target disk-space log:$([Environment]::NewLine)$log0Text"
  Assert-True ($log0Text -match 'DISK root=.* free_mb=.* required_mb=2000000000') 'Fresh-target disk-space values were not logged.'
  Assert-True ($log0Text -match 'FAIL_CODE low-disk-space') 'Fresh target did not reach the low-space branch.'
  Assert-True ($log0Text -notmatch 'FAIL_CODE disk-(?:root|space)-unavailable') 'Fresh target was falsely diagnosed as an unreadable disk.'

  # 1. Power loss after moving the old installation: restore the last known
  # good backup, remove the partial current/staging trees, then stop on the
  # deliberately impossible free-space requirement.
  $case1 = Join-Path $tempRoot 'restore-interrupted'
  $program1 = Join-Path $case1 'App'
  $backup1 = "$program1.__justfun_backup__"
  $stage1 = "$program1.__justfun_stage__"
  New-Item -ItemType Directory -Path $program1, $stage1 -Force | Out-Null
  'partial-current' | Set-Content -LiteralPath "$program1\partial.txt" -Encoding utf8
  'partial-stage' | Set-Content -LiteralPath "$stage1\partial.txt" -Encoding utf8
  New-KnownInstallation $backup1 'known-good'
  $exit1 = Invoke-Setup $engine $program1 (Join-Path $case1 'Data') (Join-Path $case1 'setup.log')
  Assert-True ($exit1 -eq 10) "Interrupted restore returned $exit1 instead of 10."
  Assert-True (Test-Path -LiteralPath "$program1\known-good.txt") 'Known-good backup was not restored.'
  Assert-True (-not (Test-Path -LiteralPath "$program1\partial.txt")) 'Partial current installation survived recovery.'
  Assert-True (-not (Test-Path -LiteralPath $backup1)) 'Restored backup directory still exists.'
  Assert-True (-not (Test-Path -LiteralPath $stage1)) 'Stale staging directory still exists.'

  # 2. Power loss after a completed update: keep the verified current version
  # and delete only the backup marked as superseded.
  $case2 = Join-Path $tempRoot 'cleanup-completed'
  $program2 = Join-Path $case2 'App'
  $backup2 = "$program2.__justfun_backup__"
  New-KnownInstallation $program2 'current-good'
  New-KnownInstallation $backup2 'old-good'
  '9.9.9' | Set-Content -LiteralPath "$backup2\.justfun-superseded" -Encoding ascii
  $exit2 = Invoke-Setup $engine $program2 (Join-Path $case2 'Data') (Join-Path $case2 'setup.log')
  Assert-True ($exit2 -eq 10) "Completed-update cleanup returned $exit2 instead of 10."
  Assert-True (Test-Path -LiteralPath "$program2\current-good.txt") 'Verified current installation was replaced by an obsolete backup.'
  Assert-True (-not (Test-Path -LiteralPath $backup2)) 'Superseded backup was not removed.'

  # 3. Never delete a corrupt backup or the current tree automatically. This
  # intentionally requires support intervention and preserves both evidence sets.
  $case3 = Join-Path $tempRoot 'preserve-corrupt'
  $program3 = Join-Path $case3 'App'
  $backup3 = "$program3.__justfun_backup__"
  New-Item -ItemType Directory -Path $program3, $backup3 -Force | Out-Null
  'current-safe' | Set-Content -LiteralPath "$program3\current-safe.txt" -Encoding utf8
  Copy-Item -LiteralPath "$env:WINDIR\System32\notepad.exe" -Destination "$backup3\OrdersLogistics.exe" -Force
  $exit3 = Invoke-Setup $engine $program3 (Join-Path $case3 'Data') (Join-Path $case3 'setup.log')
  Assert-True ($exit3 -eq 10) "Corrupt-backup refusal returned $exit3 instead of 10."
  Assert-True (Test-Path -LiteralPath "$program3\current-safe.txt") 'Current installation was deleted despite a corrupt backup.'
  Assert-True (Test-Path -LiteralPath "$backup3\OrdersLogistics.exe") 'Corrupt backup evidence was deleted.'
  Assert-True ((Get-Content -LiteralPath (Join-Path $case3 'setup.log') -Raw) -match 'RECOVERY corrupt-backup detected') 'Corrupt-backup diagnosis was not logged.'

  Write-Output 'Installer crash recovery: PASS (fresh-target disk, restore interrupted, clean completed, preserve corrupt)'
}
finally {
  if ($tempRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $tempRoot)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
