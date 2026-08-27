param(
  [Parameter(Mandatory = $true)][string]$Setup,
  [Parameter(Mandatory = $true)][string]$EvidenceDirectory
)

$ErrorActionPreference = 'Stop'
$releasePath = Join-Path $PSScriptRoot '..\source\application\release.json'
$release = Get-Content -LiteralPath $releasePath -Raw | ConvertFrom-Json
$productVersion = [string]$release.version
if ($productVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
  throw "Invalid product version in release.json: $productVersion"
}
$setupPath = (Resolve-Path -LiteralPath $Setup).Path
$evidence = [IO.Path]::GetFullPath($EvidenceDirectory)
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$tempRoot = Join-Path $tempBase ("JustFun-Full-Installer-QA-" + [Guid]::NewGuid().ToString('N'))
$program = Join-Path $tempRoot 'NeverExisted\Program'
$data = Join-Path $tempRoot 'Data'
$interruptedProgram = Join-Path $tempRoot 'InterruptedUpdate\Program'
$interruptedData = Join-Path $tempRoot 'InterruptedUpdate\Data'
$interruptedBackup = "$interruptedProgram.__justfun_backup__"
$interruptedStage = "$interruptedProgram.__justfun_stage__"
$configPath = Join-Path $env:LOCALAPPDATA 'JustFun\OrdersLogistics\install.json'
$configBackup = Join-Path $tempRoot 'state-backup\install.json'
$productReg = 'Registry::HKEY_CURRENT_USER\Software\JustFun\OrdersLogistics'
$uninstallReg = 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\JustFunOrdersLogistics'
$productRegBackup = Join-Path $tempRoot 'state-backup\product.reg'
$uninstallRegBackup = Join-Path $tempRoot 'state-backup\uninstall.reg'
$localLogDirectory = Join-Path $env:LOCALAPPDATA 'JustFun\OrdersLogistics\logs'
$log = Join-Path $localLogDirectory "installer-$productVersion.log"
$uninstallLog = Join-Path $localLogDirectory "uninstall-$productVersion.log"
$desktopLog = Join-Path $localLogDirectory 'desktop.log'
$evidenceLog = Join-Path $evidence 'full-installer.log'
$evidenceUninstallLog = Join-Path $evidence 'full-uninstaller.log'
$evidenceInterruptedLog = Join-Path $evidence 'full-installer-interrupted-recovery.log'
$logState = @(
  [pscustomobject]@{ Path = $log; Backup = (Join-Path $tempRoot "state-backup\installer-$productVersion.log"); Existed = (Test-Path -LiteralPath $log -PathType Leaf) },
  [pscustomobject]@{ Path = $uninstallLog; Backup = (Join-Path $tempRoot "state-backup\uninstall-$productVersion.log"); Existed = (Test-Path -LiteralPath $uninstallLog -PathType Leaf) },
  [pscustomobject]@{ Path = $desktopLog; Backup = (Join-Path $tempRoot 'state-backup\desktop.log'); Existed = (Test-Path -LiteralPath $desktopLog -PathType Leaf) }
)
$resultPath = Join-Path $evidence 'FULL-INSTALLER-QA.json'
$configExisted = Test-Path -LiteralPath $configPath -PathType Leaf
$productRegExisted = Test-Path -LiteralPath $productReg
$uninstallRegExisted = Test-Path -LiteralPath $uninstallReg
$setupExit = $null
$uninstallExit = $null
$completed = $false
$programFilesRemoved = $false
$emptyProgramDirectoryRemaining = $false
$uninstallCompletionSeconds = $null
$uninstallConfirmed = $false
$interruptedRecoveryConfirmed = $false
$interruptedUninstallConfirmed = $false
$interruptedSetupExit = $null
$interruptedUninstallExit = $null
$failure = $null

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Invoke-Native([string]$File, [string[]]$Arguments) {
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $File
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  # Windows PowerShell 5.1 does not expose ProcessStartInfo.ArgumentList.
  # Quote every value containing whitespace while keeping the NSIS /D switch
  # last in the caller-provided sequence.
  $start.Arguments = ($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' '
  $process = [Diagnostics.Process]::Start($start)
  if (-not $process) { throw "Windows did not start $File" }
  $process.WaitForExit()
  return $process.ExitCode
}

function Get-RemainingProgramFiles([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
  try {
    Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction Stop
  } catch {
    # The temporary NSIS process can remove the directory after Test-Path but
    # before Get-ChildItem opens it. That race is the successful uninstall
    # outcome, not a test failure. Preserve every other enumeration error.
    if (Test-Path -LiteralPath $Path -PathType Container) { throw }
  }
}

function Export-RegistryKey([string]$NativePath, [string]$Destination) {
  $exitCode = Invoke-Native "$env:WINDIR\System32\reg.exe" @('export', $NativePath, $Destination, '/y')
  if ($exitCode -ne 0) { throw "Registry backup failed for $NativePath with code $exitCode" }
}

function Restore-RegistryKey([string]$PowerShellPath, [bool]$Existed, [string]$Backup) {
  if (Test-Path -LiteralPath $PowerShellPath) {
    Remove-Item -LiteralPath $PowerShellPath -Recurse -Force
  }
  if ($Existed) {
    $exitCode = Invoke-Native "$env:WINDIR\System32\reg.exe" @('import', $Backup)
    if ($exitCode -ne 0) { throw "Registry restore failed for $PowerShellPath with code $exitCode" }
  }
}

New-Item -ItemType Directory -Path (Split-Path -Parent $configBackup), $evidence -Force | Out-Null
if ($configExisted) { Copy-Item -LiteralPath $configPath -Destination $configBackup -Force }
if ($productRegExisted) { Export-RegistryKey 'HKCU\Software\JustFun\OrdersLogistics' $productRegBackup }
if ($uninstallRegExisted) { Export-RegistryKey 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\JustFunOrdersLogistics' $uninstallRegBackup }
foreach ($state in $logState) {
  if ($state.Existed) { Copy-Item -LiteralPath $state.Path -Destination $state.Backup -Force }
}
# The installer truncates its own log, but the uninstaller intentionally
# appends. Start this isolated acceptance run with a clean uninstall log and
# restore the user's previous log in finally.
if (Test-Path -LiteralPath $uninstallLog -PathType Leaf) {
  Remove-Item -LiteralPath $uninstallLog -Force
}

try {
  Assert-True (-not (Test-Path -LiteralPath $program)) 'The clean-install target unexpectedly exists before setup.'
  $setupExit = Invoke-Native $setupPath @(
    '/S',
    "/DATADIR=$data",
    '/MODE=demo',
    '/NODESKTOP',
    '/NOSTART',
    "/D=$program"
  )
  Assert-True ($setupExit -eq 0) "Full installer returned $setupExit."

  foreach ($required in @(
    (Join-Path $program 'OrdersLogistics.exe'),
    (Join-Path $program 'Orders-Logistics-Recovery.exe'),
    (Join-Path $program 'Orders-Logistics-Uninstall.exe'),
    (Join-Path $program 'resources\app.asar'),
    (Join-Path $data '.justfun\product-root.txt'),
    $configPath,
    $log
  )) {
    Assert-True (Test-Path -LiteralPath $required -PathType Leaf) "Installed file is missing: $required"
  }
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $program 'resources\app'))) 'A loose application source directory was installed.'

  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  Assert-True ($config.app_version -eq $productVersion) 'Installed configuration has the wrong version.'
  Assert-True ($config.mode -eq 'demo') 'Installed configuration has the wrong mode.'
  Assert-True ([IO.Path]::GetFullPath($config.program_dir) -eq [IO.Path]::GetFullPath($program)) 'Installed configuration has the wrong program path.'
  Assert-True ([IO.Path]::GetFullPath($config.data_dir) -eq [IO.Path]::GetFullPath($data)) 'Installed configuration has the wrong data path.'

  $logText = Get-Content -LiteralPath $log -Raw
  foreach ($marker in @("START version=$productVersion", 'TARGET program=', 'DISK root=', 'STEP smoke-test', 'SUCCESS')) {
    Assert-True ($logText.Contains($marker)) "Installer log is missing: $marker"
  }
  Assert-True (-not $logText.Contains('Не удалось определить свободное место')) 'The released installer repeated the false free-space diagnosis.'
  Copy-Item -LiteralPath $log -Destination $evidenceLog -Force

  $uninstaller = Join-Path $program 'Orders-Logistics-Uninstall.exe'
  $uninstallExit = Invoke-Native $uninstaller @('/S')
  Assert-True ($uninstallExit -eq 0) "Uninstaller returned $uninstallExit."

  # NSIS starts its installed uninstaller, copies it to a unique temporary
  # directory and lets that copy remove the application. The original process
  # can exit before the temporary copy has finished deleting a large Electron
  # payload, so a fixed two-second delay produced a false failure on slower
  # disks and while antivirus was scanning the files. Poll the actual outcome
  # with a hard deadline instead of guessing how long Windows needs.
  $uninstallWatch = [Diagnostics.Stopwatch]::StartNew()
  $uninstallDeadline = [TimeSpan]::FromSeconds(120)
  do {
    $remainingProgramFiles = @(Get-RemainingProgramFiles $program)
    $uninstallLogText = if (Test-Path -LiteralPath $uninstallLog -PathType Leaf) {
      Get-Content -LiteralPath $uninstallLog -Raw -ErrorAction SilentlyContinue
    } else { '' }
    $uninstallConfirmed = $remainingProgramFiles.Count -eq 0 -and $uninstallLogText.Contains('PROGRAM removed')
    if ($uninstallConfirmed) { break }
    Start-Sleep -Milliseconds 500
  } while ($uninstallWatch.Elapsed -lt $uninstallDeadline)
  $uninstallWatch.Stop()
  $uninstallCompletionSeconds = [Math]::Round($uninstallWatch.Elapsed.TotalSeconds, 3)

  if (Test-Path -LiteralPath $uninstallLog -PathType Leaf) {
    Copy-Item -LiteralPath $uninstallLog -Destination $evidenceUninstallLog -Force
  }
  $remainingProgramFiles = @(Get-RemainingProgramFiles $program)
  Assert-True ($remainingProgramFiles.Count -eq 0) "Program files remain after uninstall: $($remainingProgramFiles.FullName -join ', ')"
  Assert-True $uninstallConfirmed 'Uninstaller did not record PROGRAM removed before the acceptance deadline.'
  Assert-True $uninstallLogText.Contains('START uninstall') 'Uninstaller log is missing START uninstall.'
  Assert-True (-not $uninstallLogText.Contains('FAIL ')) "Uninstaller log contains a failure: $uninstallLogText"
  $programFilesRemoved = $true
  $emptyProgramDirectoryRemaining = Test-Path -LiteralPath $program -PathType Container
  Assert-True (Test-Path -LiteralPath $data -PathType Container) 'User data was deleted by the default uninstall.'

  # Exercise the exact released Premium Setup against a disk state left by a
  # power loss after the previous installation was moved to its backup. This
  # complements the isolated NSIS fixture with artifact-bound proof: the real
  # wrapper must restore the known-good backup, remove partial trees, install
  # the protected payload, and remain uninstallable.
  New-Item -ItemType Directory -Path (Join-Path $interruptedProgram 'resources'), (Join-Path $interruptedBackup 'resources'), $interruptedStage -Force | Out-Null
  'partial-current' | Set-Content -LiteralPath (Join-Path $interruptedProgram 'partial-current.txt') -Encoding UTF8
  'partial-stage' | Set-Content -LiteralPath (Join-Path $interruptedStage 'partial-stage.txt') -Encoding UTF8
  Copy-Item -LiteralPath "$env:WINDIR\System32\notepad.exe" -Destination (Join-Path $interruptedBackup 'OrdersLogistics.exe') -Force
  'known-good-asar' | Set-Content -LiteralPath (Join-Path $interruptedBackup 'resources\app.asar') -Encoding UTF8
  'known-good-backup' | Set-Content -LiteralPath (Join-Path $interruptedBackup 'known-good-backup.txt') -Encoding UTF8
  if (Test-Path -LiteralPath $uninstallLog -PathType Leaf) { Remove-Item -LiteralPath $uninstallLog -Force }

  $interruptedSetupExit = Invoke-Native $setupPath @(
    '/S',
    "/DATADIR=$interruptedData",
    '/MODE=demo',
    '/NODESKTOP',
    '/NOSTART',
    "/D=$interruptedProgram"
  )
  Assert-True ($interruptedSetupExit -eq 0) "Interrupted-update recovery install returned $interruptedSetupExit."
  $interruptedLogText = Get-Content -LiteralPath $log -Raw
  foreach ($marker in @('RECOVERY interrupted-update-backup detected', 'RECOVERY previous installation restored', 'STEP smoke-test', 'SUCCESS')) {
    Assert-True ($interruptedLogText.Contains($marker)) "Interrupted-update installer log is missing: $marker"
  }
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $interruptedProgram 'partial-current.txt'))) 'Partial current tree survived artifact-bound recovery.'
  Assert-True (-not (Test-Path -LiteralPath $interruptedStage)) 'Partial staging tree survived artifact-bound recovery.'
  Assert-True (-not (Test-Path -LiteralPath $interruptedBackup)) 'Previous backup survived the completed artifact-bound update.'
  Assert-True (Test-Path -LiteralPath (Join-Path $interruptedProgram 'OrdersLogistics.exe') -PathType Leaf) 'Released payload is missing after artifact-bound recovery.'
  Copy-Item -LiteralPath $log -Destination $evidenceInterruptedLog -Force
  $interruptedRecoveryConfirmed = $true

  $interruptedUninstaller = Join-Path $interruptedProgram 'Orders-Logistics-Uninstall.exe'
  $interruptedUninstallExit = Invoke-Native $interruptedUninstaller @('/S')
  Assert-True ($interruptedUninstallExit -eq 0) "Recovered-install uninstaller returned $interruptedUninstallExit."
  $interruptedDeadline = (Get-Date).AddSeconds(120)
  do {
    $interruptedRemaining = @(Get-RemainingProgramFiles $interruptedProgram)
    $interruptedUninstallLog = if (Test-Path -LiteralPath $uninstallLog -PathType Leaf) {
      Get-Content -LiteralPath $uninstallLog -Raw -ErrorAction SilentlyContinue
    } else { '' }
    $interruptedUninstallConfirmed = $interruptedRemaining.Count -eq 0 -and $interruptedUninstallLog.Contains('PROGRAM removed')
    if (-not $interruptedUninstallConfirmed) { Start-Sleep -Milliseconds 500 }
  } while (-not $interruptedUninstallConfirmed -and (Get-Date) -lt $interruptedDeadline)
  Assert-True $interruptedUninstallConfirmed 'Recovered installation was not completely removed before the acceptance deadline.'
  Assert-True (Test-Path -LiteralPath $interruptedData -PathType Container) 'Recovered installation deleted user data by default.'
  $completed = $true
}
catch {
  $failure = $_.Exception.Message
  throw
}
finally {
  try {
    $uninstaller = Join-Path $program 'Orders-Logistics-Uninstall.exe'
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
      $null = Invoke-Native $uninstaller @('/S')
    }
    $interruptedUninstaller = Join-Path $interruptedProgram 'Orders-Logistics-Uninstall.exe'
    if (Test-Path -LiteralPath $interruptedUninstaller -PathType Leaf) {
      $null = Invoke-Native $interruptedUninstaller @('/S')
    }
  } catch {}

  if ($configExisted) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $configPath) -Force | Out-Null
    Copy-Item -LiteralPath $configBackup -Destination $configPath -Force
  } elseif (Test-Path -LiteralPath $configPath) {
    Remove-Item -LiteralPath $configPath -Force
  }
  Restore-RegistryKey $productReg $productRegExisted $productRegBackup
  Restore-RegistryKey $uninstallReg $uninstallRegExisted $uninstallRegBackup
  if ((Test-Path -LiteralPath $log) -and -not (Test-Path -LiteralPath $evidenceLog)) {
    Copy-Item -LiteralPath $log -Destination $evidenceLog -Force
  }
  foreach ($state in $logState) {
    if ($state.Existed) {
      New-Item -ItemType Directory -Path (Split-Path -Parent $state.Path) -Force | Out-Null
      Copy-Item -LiteralPath $state.Backup -Destination $state.Path -Force
    } elseif (Test-Path -LiteralPath $state.Path) {
      Remove-Item -LiteralPath $state.Path -Force
    }
  }

  [ordered]@{
    schema = 4
    product = 'JustFun Логистика'
    version = $productVersion
    setup_sha256 = (Get-FileHash -LiteralPath $setupPath -Algorithm SHA256).Hash.ToLowerInvariant()
    target_was_absent = $true
    setup_exit = $setupExit
    uninstall_exit = $uninstallExit
    uninstall_completion_seconds = $uninstallCompletionSeconds
    uninstall_log_confirmed = $uninstallConfirmed
    program_files_removed = $programFilesRemoved
    empty_program_directory_remaining = $emptyProgramDirectoryRemaining
    data_preserved_by_default = $completed
    interrupted_update = [ordered]@{
      setup_exit = $interruptedSetupExit
      recovery_confirmed = $interruptedRecoveryConfirmed
      uninstall_exit = $interruptedUninstallExit
      uninstall_confirmed = $interruptedUninstallConfirmed
      log_sha256 = if (Test-Path -LiteralPath $evidenceInterruptedLog -PathType Leaf) { (Get-FileHash -LiteralPath $evidenceInterruptedLog -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
    }
    previous_local_state_restored = $interruptedRecoveryConfirmed
    errors = @($(if ($failure) { $failure }))
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath -Encoding UTF8

  $resolvedTempRoot = [IO.Path]::GetFullPath($tempRoot)
  if ($resolvedTempRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and
      [IO.Path]::GetFileName($resolvedTempRoot).StartsWith('JustFun-Full-Installer-QA-', [StringComparison]::Ordinal)) {
    if (Test-Path -LiteralPath $resolvedTempRoot) { Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force }
  }
}

Write-Output "Full installer acceptance: PASS ($resultPath)"
