Unicode True
ManifestDPIAware True
RequestExecutionLevel user
CRCCheck force
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!ifndef VERSION
  !define VERSION "7.8.3"
!endif
!ifndef PAYLOAD_DIR
  !error "PAYLOAD_DIR is required"
!endif
!ifndef REQUIRED_MB
  !error "REQUIRED_MB is required"
!endif
!ifndef ASSETS_DIR
  !error "ASSETS_DIR is required"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "Orders-Logistics-Setup-${VERSION}-Premium.exe"
!endif

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "StrFunc.nsh"
!include "WordFunc.nsh"
!include "nsDialogs.nsh"
${StrRep}
${StrCase}
${UnStrCase}

Name "JustFun Логистика ${VERSION}"
Caption "JustFun — установка ${VERSION}"
BrandingText "JustFun · Система автоматизации для малого бизнеса"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\JustFun\OrdersLogistics"
InstallDirRegKey HKCU "Software\JustFun\OrdersLogistics" "ProgramDir"
Icon "${ASSETS_DIR}\JustFun.ico"
WindowIcon On
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1049 "ProductName" "JustFun Логистика"
VIAddVersionKey /LANG=1049 "CompanyName" "JustFun"
VIAddVersionKey /LANG=1049 "FileDescription" "Установщик JustFun Логистика"
VIAddVersionKey /LANG=1049 "FileVersion" "${VERSION}.0"
VIAddVersionKey /LANG=1049 "ProductVersion" "${VERSION}.0"
VIAddVersionKey /LANG=1049 "LegalCopyright" "JustFun"

!define MUI_ABORTWARNING
!define MUI_ICON "${ASSETS_DIR}\JustFun.ico"
!define MUI_UNICON "${ASSETS_DIR}\JustFun.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${ASSETS_DIR}\welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${ASSETS_DIR}\welcome.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "${ASSETS_DIR}\header.bmp"
!define MUI_FINISHPAGE_RUN "$INSTDIR\OrdersLogistics.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить JustFun"
!define MUI_FINISHPAGE_NOAUTOCLOSE

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom OptionsPageCreate OptionsPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
UninstPage custom un.OptionsPageCreate un.OptionsPageLeave
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "Russian"

Var DataDir
Var InstallMode
Var DesktopShortcut
Var StartShortcut
Var OptionsDialog
Var DataText
Var BrowseButton
Var FullRadio
Var DemoRadio
Var DesktopCheck
Var StartCheck
Var LogPath
Var StageDir
Var BackupDir
Var SmokeReport
Var FailureMessage
Var ConfigBackup
Var ConfigExisted
Var InstallCommitted
Var OldMoved
Var ExplicitProgramDir
Var PurgeData
Var UninstallDataDir
Var UninstallProgramDir
Var UninstallLogPath
Var UninstallOptionsDialog
Var UninstallKeepCheck
Var RecoveryFailed
Var InstalledVersion
Var AllowDowngrade
Var RemovalDir

!macro JFLog TEXT
  Push "${TEXT}"
  Call WriteLog
!macroend

Function WriteLog
  Exch $0
  Push $1
  ClearErrors
  FileOpen $1 "$LogPath" a
  ${IfNot} ${Errors}
    ; This NSIS runtime opens an existing file at offset 0 even in append
    ; mode. Seek explicitly so every diagnostic line is preserved.
    FileSeek $1 0 END
    FileWrite $1 "$0$\r$\n"
    FileClose $1
  ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

Function .onInit
  StrCpy $DataDir "$DOCUMENTS\JustFun\Заказы и логистика"
  StrCpy $InstallMode "full"
  StrCpy $DesktopShortcut "1"
  StrCpy $StartShortcut "1"
  StrCpy $InstallCommitted "0"
  StrCpy $OldMoved "0"
  StrCpy $ExplicitProgramDir "0"
  StrCpy $AllowDowngrade "0"
  ; -1 means validation has not reached configuration handling yet.
  ; This prevents an early failure from deleting a previous installation config.
  StrCpy $ConfigExisted "-1"
  StrCpy $LogPath "$LOCALAPPDATA\JustFun\OrdersLogistics\logs\installer-${VERSION}.log"

  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/PROGRAMDIR=" $R1
  ${IfNot} ${Errors}
    StrCpy $INSTDIR $R1
    StrCpy $ExplicitProgramDir "1"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/DATADIR=" $R1
  ${IfNot} ${Errors}
    StrCpy $DataDir $R1
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/MODE=" $R1
  ${IfNot} ${Errors}
    StrCmp $R1 "demo" 0 +2
    StrCpy $InstallMode "demo"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/LOG=" $R1
  ${IfNot} ${Errors}
    StrCpy $LogPath $R1
  ${EndIf}
  ${GetOptions} $R0 "/NODESKTOP" $R1
  ${IfNot} ${Errors}
    StrCpy $DesktopShortcut "0"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/NOSTART" $R1
  ${IfNot} ${Errors}
    StrCpy $StartShortcut "0"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/ALLOWDOWNGRADE" $R1
  ${IfNot} ${Errors}
    StrCpy $AllowDowngrade "1"
  ${EndIf}

  ReadRegStr $InstalledVersion HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JustFunOrdersLogistics" "DisplayVersion"
  ${If} $InstalledVersion != ""
  ${AndIf} $AllowDowngrade != "1"
    ${VersionCompare} "$InstalledVersion" "${VERSION}" $0
    ${If} $0 == "1"
      SetErrorLevel 22
      IfSilent downgrade_blocked
      MessageBox MB_ICONSTOP "На компьютере уже установлена более новая версия JustFun ($InstalledVersion). Установка ${VERSION} остановлена, чтобы не повредить данные."
      Abort
downgrade_blocked:
      Quit
    ${EndIf}
  ${EndIf}

  ; Old packages could store a Program Files path in HKCU. This installer is
  ; deliberately per-user, so an inherited protected path is migrated to the
  ; writable LocalAppData default. An explicit protected path is rejected later.
  StrCmp $ExplicitProgramDir "1" init_program_dir_checked
  ${StrCase} $3 "$INSTDIR" "U"
  ${StrCase} $4 "$PROGRAMFILES" "U"
  StrCpy $4 "$4\"
  StrLen $1 $4
  StrCpy $2 "$3" $1
  StrCmp $2 $4 init_reset_program_dir
  ${StrCase} $4 "$PROGRAMFILES64" "U"
  StrCpy $4 "$4\"
  StrLen $1 $4
  StrCpy $2 "$3" $1
  StrCmp $2 $4 init_reset_program_dir
  ${StrCase} $4 "$WINDIR" "U"
  StrCpy $4 "$4\"
  StrLen $1 $4
  StrCpy $2 "$3" $1
  StrCmp $2 $4 init_reset_program_dir init_program_dir_checked
init_reset_program_dir:
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\JustFun\OrdersLogistics"
init_program_dir_checked:

  ; Start every attempt with a fresh, writable diagnostic file. FileOpen in
  ; append mode is not a reliable creator for a previously absent custom log,
  ; which left only the final FAIL line and hid all completed stages.
  ${GetParent} "$LogPath" $R1
  ${If} $R1 != ""
    CreateDirectory "$R1"
  ${EndIf}
  ClearErrors
  FileOpen $R2 "$LogPath" w
  ${IfNot} ${Errors}
    FileWrite $R2 "START version=${VERSION}$\r$\n"
    FileClose $R2
  ${EndIf}
FunctionEnd

Function .onVerifyInstDir
  StrLen $1 "$INSTDIR"
  ${If} $1 < 4
    Abort
  ${EndIf}
  StrCmp "$INSTDIR" "$WINDIR" 0 +2
  Abort
  StrCmp "$INSTDIR" "$PROGRAMFILES" 0 +2
  Abort
  StrCmp "$INSTDIR" "$PROFILE" 0 +2
  Abort
  StrCmp "$INSTDIR" "$DOCUMENTS" 0 +2
  Abort
FunctionEnd

Function OptionsPageCreate
  nsDialogs::Create 1018
  Pop $OptionsDialog
  ${If} $OptionsDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateBitmap} 0 0 29% 100% ""
  Pop $0
  ${NSD_SetImage} $0 "${ASSETS_DIR}\sidebar.bmp" $1

  ${NSD_CreateLabel} 32% 2% 65% 10% "Настройка установки"
  Pop $0
  CreateFont $1 "Segoe UI" 15 700
  SendMessage $0 ${WM_SETFONT} $1 1
  SetCtlColors $0 "D8AD50" "061814"

  ${NSD_CreateLabel} 32% 14% 65% 8% "Рабочие данные хранятся отдельно от программы."
  Pop $0
  SetCtlColors $0 "D6E4DF" "061814"

  ${NSD_CreateLabel} 32% 25% 40% 6% "Папка рабочих данных"
  Pop $0
  SetCtlColors $0 "F4F8F6" "061814"
  ${NSD_CreateText} 32% 32% 50% 12% "$DataDir"
  Pop $DataText
  ${NSD_CreateBrowseButton} 84% 32% 13% 12% "Обзор…"
  Pop $BrowseButton
  ${NSD_OnClick} $BrowseButton BrowseDataDirectory

  ${NSD_CreateGroupBox} 32% 48% 65% 23% "Режим первого запуска"
  Pop $0
  ${NSD_CreateRadioButton} 35% 55% 58% 7% "Полная версия — вход в свой аккаунт"
  Pop $FullRadio
  ${NSD_CreateRadioButton} 35% 63% 58% 7% "Демонстрация — 72 часа"
  Pop $DemoRadio
  StrCmp $InstallMode "demo" 0 +3
  ${NSD_Check} $DemoRadio
  Goto +2
  ${NSD_Check} $FullRadio

  ${NSD_CreateCheckbox} 32% 76% 65% 7% "Создать ярлык на рабочем столе"
  Pop $DesktopCheck
  ${NSD_CreateCheckbox} 32% 84% 65% 7% "Создать группу в меню «Пуск»"
  Pop $StartCheck
  StrCmp $DesktopShortcut "1" 0 +2
  ${NSD_Check} $DesktopCheck
  StrCmp $StartShortcut "1" 0 +2
  ${NSD_Check} $StartCheck

  SetCtlColors $OptionsDialog "F4F8F6" "061814"
  nsDialogs::Show
FunctionEnd

Function BrowseDataDirectory
  nsDialogs::SelectFolderDialog "Выберите отдельную папку рабочих данных" "$DataDir"
  Pop $0
  StrCmp $0 error +2
  ${NSD_SetText} $DataText $0
FunctionEnd

Function OptionsPageLeave
  ${NSD_GetText} $DataText $DataDir
  ${NSD_GetState} $DemoRadio $0
  StrCmp $0 ${BST_CHECKED} 0 +2
  StrCpy $InstallMode "demo"
  ${NSD_GetState} $FullRadio $0
  StrCmp $0 ${BST_CHECKED} 0 +2
  StrCpy $InstallMode "full"
  ${NSD_GetState} $DesktopCheck $DesktopShortcut
  ${NSD_GetState} $StartCheck $StartShortcut

  StrLen $0 "$DataDir"
  ${If} $0 < 4
    MessageBox MB_ICONSTOP "Выберите отдельную папку рабочих данных."
    Abort
  ${EndIf}
  StrCmp "$DataDir" "$INSTDIR" 0 +3
  MessageBox MB_ICONSTOP "Папка программы и папка рабочих данных должны быть раздельными."
  Abort

  StrCpy $0 "$INSTDIR\"
  StrLen $1 $0
  StrCpy $2 "$DataDir" $1
  StrCmp $2 $0 0 +3
  MessageBox MB_ICONSTOP "Папка рабочих данных не может находиться внутри папки программы."
  Abort

  StrCpy $0 "$DataDir\"
  StrLen $1 $0
  StrCpy $2 "$INSTDIR" $1
  StrCmp $2 $0 0 +3
  MessageBox MB_ICONSTOP "Папка программы не может находиться внутри папки рабочих данных."
  Abort
FunctionEnd

Function RestorePreviousInstallation
  ${If} $InstallCommitted == "1"
    ClearErrors
    RMDir /r "$INSTDIR"
  ${EndIf}
  ${If} $OldMoved == "1"
    ${If} ${FileExists} "$BackupDir\*.*"
      ClearErrors
      Rename "$BackupDir" "$INSTDIR"
    ${EndIf}
  ${EndIf}
  ${If} $ConfigExisted == "1"
    CopyFiles /SILENT "$ConfigBackup" "$LOCALAPPDATA\JustFun\OrdersLogistics\install.json"
  ${ElseIf} $ConfigExisted == "0"
    Delete "$LOCALAPPDATA\JustFun\OrdersLogistics\install.json"
  ${EndIf}
  StrCmp "$StageDir" "" +2
  RMDir /r "$StageDir"
  Delete "$SmokeReport"
FunctionEnd

Function ReconcileInterruptedInstallation
  StrCpy $RecoveryFailed "0"
  ${If} ${FileExists} "$BackupDir\*.*"
    !insertmacro JFLog "RECOVERY interrupted-update-backup detected"
    ; A completed update marks an obsolete backup before trying to remove it.
    ; If power was lost before that marker, prefer the last known installation.
    ${If} ${FileExists} "$BackupDir\.justfun-superseded"
    ${AndIf} ${FileExists} "$INSTDIR\OrdersLogistics.exe"
    ${AndIf} ${FileExists} "$INSTDIR\resources\app.asar"
      RMDir /r "$BackupDir"
      ${If} ${FileExists} "$BackupDir\*.*"
        StrCpy $FailureMessage "Не удалось очистить остаток уже завершённого обновления. Перезагрузите Windows и повторите установку."
        StrCpy $RecoveryFailed "1"
        Return
      ${EndIf}
    ${Else}
      ${IfNot} ${FileExists} "$BackupDir\OrdersLogistics.exe"
        StrCpy $FailureMessage "Обнаружен неполный резерв предыдущей установки. Файлы сохранены для ручной диагностики; установка остановлена."
        StrCpy $RecoveryFailed "1"
        Return
      ${EndIf}
      ${IfNot} ${FileExists} "$BackupDir\resources\app.asar"
        !insertmacro JFLog "RECOVERY corrupt-backup detected"
        StrCpy $FailureMessage "Резерв предыдущей установки повреждён. Файлы сохранены для ручной диагностики; установка остановлена."
        StrCpy $RecoveryFailed "1"
        Return
      ${EndIf}
      RMDir /r "$INSTDIR"
      ${If} ${FileExists} "$INSTDIR\*.*"
        StrCpy $FailureMessage "Не удалось убрать незавершённую версию программы. Закройте JustFun, перезагрузите Windows и повторите установку."
        StrCpy $RecoveryFailed "1"
        Return
      ${EndIf}
      RMDir "$INSTDIR"
      ClearErrors
      Rename "$BackupDir" "$INSTDIR"
      ${If} ${Errors}
        StrCpy $FailureMessage "Не удалось автоматически вернуть предыдущую версию. Резерв не удалён; обратитесь в поддержку с журналом установки."
        StrCpy $RecoveryFailed "1"
        Return
      ${EndIf}
      !insertmacro JFLog "RECOVERY previous installation restored"
    ${EndIf}
  ${Else}
    RMDir "$BackupDir"
  ${EndIf}

  RMDir /r "$StageDir"
  ${If} ${FileExists} "$StageDir\*.*"
    StrCpy $FailureMessage "Не удалось очистить файлы прерванной установки. Перезагрузите Windows и повторите попытку."
    StrCpy $RecoveryFailed "1"
  ${Else}
    RMDir "$StageDir"
  ${EndIf}
FunctionEnd

Section "Установка" SEC_INSTALL
  SetShellVarContext current
  StrCpy $SmokeReport "$TEMP\JustFun-installer-smoke-${VERSION}.json"
  StrCpy $ConfigBackup "$TEMP\JustFun-install-config-${VERSION}.bak"
  StrCpy $FailureMessage ""

  !insertmacro JFLog "STEP validate-targets"
  StrLen $0 "$INSTDIR"
  ${If} $0 < 4
    StrCpy $FailureMessage "Путь программы не прошёл первичную проверку безопасности."
    Goto install_failed
  ${EndIf}
  StrLen $0 "$DataDir"
  ${If} $0 < 4
    StrCpy $FailureMessage "Путь рабочих данных не прошёл первичную проверку безопасности."
    Goto install_failed
  ${EndIf}

  ClearErrors
  CreateDirectory "$INSTDIR"
  ${If} ${Errors}
    StrCpy $FailureMessage "Не удалось подготовить выбранную папку программы."
    Goto install_failed
  ${EndIf}
  ClearErrors
  GetFullPathName $0 "$INSTDIR"
  ${If} ${Errors}
    StrCpy $FailureMessage "Не удалось привести путь программы к полному виду."
    Goto install_failed
  ${EndIf}
  StrCpy $INSTDIR $0
  ; Remove only a verified-empty target. Existing installations remain intact.
  RMDir "$INSTDIR"

  StrLen $0 "$INSTDIR"
  ${If} $0 < 4
    StrCpy $FailureMessage "Путь программы не прошёл проверку безопасности."
    Goto install_failed
  ${EndIf}
  StrCmp "$INSTDIR" "$WINDIR" 0 +3
  StrCpy $FailureMessage "Нельзя устанавливать программу в системную папку Windows."
  Goto install_failed
  StrCmp "$INSTDIR" "$PROGRAMFILES" 0 +3
  StrCpy $FailureMessage "Выберите отдельную папку внутри Program Files, а не её корень."
  Goto install_failed
  StrCmp "$INSTDIR" "$PROGRAMFILES64" 0 +3
  StrCpy $FailureMessage "Выберите отдельную папку внутри Program Files, а не её корень."
  Goto install_failed
  StrCmp "$INSTDIR" "$PROFILE" 0 +3
  StrCpy $FailureMessage "Нельзя использовать корень профиля пользователя как папку программы."
  Goto install_failed
  StrCmp "$INSTDIR" "$LOCALAPPDATA" 0 +3
  StrCpy $FailureMessage "Выберите отдельную папку внутри LocalAppData, а не её корень."
  Goto install_failed
  StrCmp "$INSTDIR" "$TEMP" 0 +3
  StrCpy $FailureMessage "Нельзя устанавливать программу в корень временной папки."
  Goto install_failed
  ${StrCase} $3 "$INSTDIR" "U"
  ${StrCase} $4 "$PROGRAMFILES" "U"
  StrCpy $4 "$4\"
  StrLen $1 $4
  StrCpy $2 "$3" $1
  StrCmp $2 $4 0 +3
  StrCpy $FailureMessage "Для установки без прав администратора выберите папку программы внутри LocalAppData, а не Program Files."
  Goto install_failed
  ${StrCase} $4 "$PROGRAMFILES64" "U"
  StrCpy $4 "$4\"
  StrLen $1 $4
  StrCpy $2 "$3" $1
  StrCmp $2 $4 0 +3
  StrCpy $FailureMessage "Для установки без прав администратора выберите папку программы внутри LocalAppData, а не Program Files."
  Goto install_failed
  ${StrCase} $4 "$WINDIR" "U"
  StrCpy $4 "$4\"
  StrLen $1 $4
  StrCpy $2 "$3" $1
  StrCmp $2 $4 0 +3
  StrCpy $FailureMessage "Нельзя устанавливать программу внутри системной папки Windows."
  Goto install_failed

  ClearErrors
  CreateDirectory "$DataDir"
  ${If} ${Errors}
    StrCpy $FailureMessage "Не удалось подготовить выбранную папку рабочих данных."
    Goto install_failed
  ${EndIf}
  ClearErrors
  GetFullPathName $0 "$DataDir"
  ${If} ${Errors}
    StrCpy $FailureMessage "Не удалось привести путь рабочих данных к полному виду."
    Goto install_failed
  ${EndIf}
  StrCpy $DataDir $0
  !insertmacro JFLog "TARGET program=$INSTDIR"
  !insertmacro JFLog "TARGET data=$DataDir"
  StrLen $0 "$DataDir"
  ${If} $0 < 4
    StrCpy $FailureMessage "Путь рабочих данных не прошёл проверку безопасности."
    Goto install_failed
  ${EndIf}
  StrCmp "$DataDir" "$WINDIR" 0 +3
  StrCpy $FailureMessage "Нельзя хранить рабочие данные в системной папке Windows."
  Goto install_failed
  StrCmp "$DataDir" "$PROFILE" 0 +3
  StrCpy $FailureMessage "Нельзя использовать корень профиля как папку рабочих данных."
  Goto install_failed
  StrCmp "$DataDir" "$DOCUMENTS" 0 +3
  StrCpy $FailureMessage "Выберите отдельную папку внутри «Документов», а не их корень."
  Goto install_failed
  StrCmp "$DataDir" "$LOCALAPPDATA" 0 +3
  StrCpy $FailureMessage "Выберите отдельную папку рабочих данных внутри LocalAppData."
  Goto install_failed
  StrCmp "$DataDir" "$TEMP" 0 +3
  StrCpy $FailureMessage "Нельзя хранить рабочие данные в корне временной папки."
  Goto install_failed

  ; Working data must remain writable by the current user. Previous packages
  ; allowed a sibling directory under Program Files, which produced repeating
  ; EPERM failures after a seemingly successful installation.
  ${StrCase} $3 "$DataDir" "U"
  ${StrCase} $4 "$PROGRAMFILES" "U"
  StrCpy $4 "$4\"
  StrLen $1 $4
  StrCpy $2 "$3" $1
  StrCmp $2 $4 0 +3
  StrCpy $FailureMessage "Рабочие данные нельзя хранить внутри Program Files. Выберите «Документы» или другую папку пользователя."
  Goto install_failed
  ${StrCase} $4 "$PROGRAMFILES64" "U"
  StrCpy $4 "$4\"
  StrLen $1 $4
  StrCpy $2 "$3" $1
  StrCmp $2 $4 0 +3
  StrCpy $FailureMessage "Рабочие данные нельзя хранить внутри Program Files. Выберите «Документы» или другую папку пользователя."
  Goto install_failed
  ${StrCase} $4 "$WINDIR" "U"
  StrCpy $4 "$4\"
  StrLen $1 $4
  StrCpy $2 "$3" $1
  StrCmp $2 $4 0 +3
  StrCpy $FailureMessage "Рабочие данные нельзя хранить внутри системной папки Windows."
  Goto install_failed

  ${StrCase} $3 "$INSTDIR" "U"
  ${StrCase} $4 "$DataDir" "U"
  StrCmp $3 $4 0 +3
  StrCpy $FailureMessage "Папка программы и папка рабочих данных совпадают."
  Goto install_failed

  StrCpy $0 "$3\"
  StrLen $1 $0
  StrCpy $2 "$4" $1
  StrCmp $2 $0 0 +3
  StrCpy $FailureMessage "Папка рабочих данных находится внутри папки программы."
  Goto install_failed

  StrCpy $0 "$4\"
  StrLen $1 $0
  StrCpy $2 "$3" $1
  StrCmp $2 $0 0 +3
  StrCpy $FailureMessage "Папка программы находится внутри папки рабочих данных."
  Goto install_failed

  StrCpy $StageDir "$INSTDIR.__justfun_stage__"
  StrCpy $BackupDir "$INSTDIR.__justfun_backup__"

  ; Recursive cleanup is allowed only for ordinary directories. A junction or
  ; symlink at any transactional root could redirect deletion outside JustFun.
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i.r9'
  ${If} $9 != -1
    IntOp $8 $9 & 0x400
    ${If} $8 != 0
      StrCpy $FailureMessage "Папка программы является ссылкой или точкой подключения. Выберите обычную папку."
      Goto install_failed
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$StageDir") i.r9'
  ${If} $9 != -1
    IntOp $8 $9 & 0x400
    ${If} $8 != 0
      StrCpy $FailureMessage "Временная папка установки является ссылкой. Удалите её вручную и повторите установку."
      Goto install_failed
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$BackupDir") i.r9'
  ${If} $9 != -1
    IntOp $8 $9 & 0x400
    ${If} $8 != 0
      StrCpy $FailureMessage "Резервная папка установки является ссылкой. Удалите её вручную и повторите установку."
      Goto install_failed
    ${EndIf}
  ${EndIf}

  FindWindow $0 "" "JustFun Логистика · ${VERSION}"
  StrCmp $0 0 +3
  StrCpy $FailureMessage "Программа сейчас запущена. Закройте JustFun и повторите установку."
  Goto install_failed
  FindWindow $0 "" "JustFun Логистика · JustFun"
  StrCmp $0 0 +3
  StrCpy $FailureMessage "Программа сейчас запущена. Закройте JustFun и повторите установку."
  Goto install_failed
  FindWindow $0 "" "JustFun — Заказы и логистика · ${VERSION}"
  StrCmp $0 0 +3
  StrCpy $FailureMessage "Предыдущая версия программы сейчас запущена. Закройте JustFun и повторите установку."
    Goto install_failed
  
  Call ReconcileInterruptedInstallation
  ${If} $RecoveryFailed != "0"
    Goto install_failed
  ${EndIf}

  ; DriveSpace requires an existing path. A clean transactional install
  ; intentionally removes the verified-empty $INSTDIR before the atomic
  ; rename, so querying $INSTDIR itself incorrectly fails on every new PC.
  ; Query the existing volume/share root instead; it represents the same
  ; filesystem and keeps the final target absent for the atomic commit.
  ${GetRoot} "$INSTDIR" $1
  StrLen $2 "$1"
  ${If} $2 < 2
    !insertmacro JFLog "FAIL_CODE disk-root-unavailable"
    StrCpy $FailureMessage "Не удалось определить диск выбранной папки программы."
    Goto install_failed
  ${EndIf}
  ClearErrors
  ${DriveSpace} "$1" "/D=F /S=M" $0
  ${If} ${Errors}
    !insertmacro JFLog "FAIL_CODE disk-space-unavailable"
    StrCpy $FailureMessage "Не удалось определить свободное место на диске программы."
    Goto install_failed
  ${EndIf}
  !insertmacro JFLog "DISK root=$1 free_mb=$0 required_mb=${REQUIRED_MB}"
  IntCmp $0 ${REQUIRED_MB} disk_space_ok disk_space_low disk_space_ok
disk_space_low:
  !insertmacro JFLog "FAIL_CODE low-disk-space"
  StrCpy $FailureMessage "Недостаточно свободного места: для безопасной установки и отката требуется не менее ${REQUIRED_MB} МБ. Доступно $0 МБ."
  Goto install_failed
disk_space_ok:

  StrCpy $ConfigExisted "0"
  ${If} ${FileExists} "$LOCALAPPDATA\JustFun\OrdersLogistics\install.json"
    StrCpy $ConfigExisted "1"
    ClearErrors
    CopyFiles /SILENT "$LOCALAPPDATA\JustFun\OrdersLogistics\install.json" "$ConfigBackup"
    ${If} ${Errors}
      StrCpy $FailureMessage "Не удалось создать резерв конфигурации установки. Прежняя версия не изменена."
      Goto install_failed
    ${EndIf}
  ${EndIf}

  !insertmacro JFLog "STEP extract-stage"
  RMDir /r "$StageDir"
  RMDir /r "$BackupDir"
  CreateDirectory "$StageDir"
  CreateDirectory "$DataDir"
  SetOutPath "$StageDir"
  File /r "${PAYLOAD_DIR}\*"

  ${IfNot} ${FileExists} "$StageDir\OrdersLogistics.exe"
    StrCpy $FailureMessage "После распаковки отсутствует OrdersLogistics.exe."
    Goto install_failed
  ${EndIf}
  ${IfNot} ${FileExists} "$StageDir\resources\app.asar"
    StrCpy $FailureMessage "После распаковки отсутствует защищённый архив программы."
    Goto install_failed
  ${EndIf}
  ${IfNot} ${FileExists} "$StageDir\resources\justfun-security.json"
    StrCpy $FailureMessage "После распаковки отсутствует паспорт защиты программы."
    Goto install_failed
  ${EndIf}
  ${IfNot} ${FileExists} "$StageDir\Orders-Logistics-Recovery.exe"
    StrCpy $FailureMessage "После распаковки отсутствует модуль восстановления."
    Goto install_failed
  ${EndIf}

  ; SetOutPath above makes the staging directory the process working directory.
  ; Windows will not rename that directory while it is current, so leave it
  ; before the atomic commit and before any possible rollback cleanup.
  SetOutPath "$TEMP"
  !insertmacro JFLog "STEP commit-atomic-install"
  ${If} ${FileExists} "$INSTDIR\*.*"
    ClearErrors
    Rename "$INSTDIR" "$BackupDir"
    ${If} ${Errors}
      StrCpy $FailureMessage "Не удалось обновить папку программы. Закройте JustFun и повторите установку."
      Goto install_failed
    ${EndIf}
    StrCpy $OldMoved "1"
  ${EndIf}
  ClearErrors
  Rename "$StageDir" "$INSTDIR"
  ${If} ${Errors}
    StrCpy $FailureMessage "Не удалось перенести проверенные файлы в папку программы."
    Goto install_failed
  ${EndIf}
  StrCpy $InstallCommitted "1"

  !insertmacro JFLog "STEP write-config"
  CreateDirectory "$LOCALAPPDATA\JustFun\OrdersLogistics"
  CreateDirectory "$DataDir\.justfun"
  ClearErrors
  FileOpen $0 "$DataDir\.justfun\product-root.txt" w
  ${If} ${Errors}
    StrCpy $FailureMessage "Не удалось записать защитный маркер папки рабочих данных."
    Goto install_failed
  ${EndIf}
  FileWrite $0 "JustFun.OrdersLogistics$\r$\n"
  FileClose $0

  ${StrRep} $1 "$INSTDIR" "\" "/"
  ${StrRep} $2 "$DataDir" "\" "/"
  ClearErrors
  FileOpen $0 "$LOCALAPPDATA\JustFun\OrdersLogistics\install.json.tmp" w
  ${If} ${Errors}
    StrCpy $FailureMessage "Не удалось создать новую конфигурацию установки."
    Goto install_failed
  ${EndIf}
  FileWriteUTF16LE /BOM $0 `{$\r$\n`
  FileWriteUTF16LE $0 `  "app_version": "${VERSION}",$\r$\n`
  FileWriteUTF16LE $0 `  "mode": "$InstallMode",$\r$\n`
  FileWriteUTF16LE $0 `  "program_dir": "$1",$\r$\n`
  FileWriteUTF16LE $0 `  "data_dir": "$2",$\r$\n`
  FileWriteUTF16LE $0 `  "installed_at": "native-installer-${VERSION}"$\r$\n`
  FileWriteUTF16LE $0 `}$\r$\n`
  FileClose $0
  Delete "$LOCALAPPDATA\JustFun\OrdersLogistics\install.json"
  ClearErrors
  Rename "$LOCALAPPDATA\JustFun\OrdersLogistics\install.json.tmp" "$LOCALAPPDATA\JustFun\OrdersLogistics\install.json"
  ${If} ${Errors}
    StrCpy $FailureMessage "Не удалось безопасно заменить конфигурацию установки."
    Goto install_failed
  ${EndIf}

  ; The uninstaller belongs to the staged payload, but registry and shortcuts are
  ; committed only after the installed application passes its smoke test.
  WriteUninstaller "$INSTDIR\Orders-Logistics-Uninstall.exe"
  ${If} ${Errors}
    StrCpy $FailureMessage "Не удалось создать штатный модуль удаления программы."
    Goto install_failed
  ${EndIf}

  !insertmacro JFLog "STEP smoke-test"
  Delete "$SmokeReport"
  RMDir /r "$SmokeReport.profile"
  nsExec::ExecToStack /TIMEOUT=120000 '"$INSTDIR\OrdersLogistics.exe" --installer-smoke-test --installer-smoke-output="$SmokeReport"'
  Pop $0
  Pop $1
  StrCmp $0 "0" 0 smoke_failed
  ${IfNot} ${FileExists} "$SmokeReport"
    StrCpy $FailureMessage "Программа не сформировала результат встроенной проверки."
    Goto install_failed
  ${EndIf}
  Goto smoke_ok
smoke_failed:
  RMDir /r "$SmokeReport.profile"
  StrCpy $FailureMessage "Встроенная проверка программы завершилась с кодом $0."
  Goto install_failed
smoke_ok:
  !insertmacro JFLog "STEP register"
  WriteRegStr HKCU "Software\JustFun\OrdersLogistics" "ProgramDir" "$INSTDIR"
  WriteRegStr HKCU "Software\JustFun\OrdersLogistics" "DataDir" "$DataDir"
  WriteRegStr HKCU "Software\JustFun\OrdersLogistics" "Mode" "$InstallMode"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JustFunOrdersLogistics" "DisplayName" "JustFun Логистика"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JustFunOrdersLogistics" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JustFunOrdersLogistics" "Publisher" "JustFun"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JustFunOrdersLogistics" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JustFunOrdersLogistics" "DisplayIcon" "$INSTDIR\OrdersLogistics.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JustFunOrdersLogistics" "UninstallString" "$\"$INSTDIR\Orders-Logistics-Uninstall.exe$\""
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JustFunOrdersLogistics" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JustFunOrdersLogistics" "NoRepair" 0

  StrCmp $DesktopShortcut "1" 0 +2
  Delete "$DESKTOP\JustFun — Заказы и логистика.lnk"
  CreateShortcut "$DESKTOP\JustFun Логистика.lnk" "$INSTDIR\OrdersLogistics.exe" "" "$INSTDIR\OrdersLogistics.exe" 0
  StrCmp $StartShortcut "1" 0 shortcuts_done
  CreateDirectory "$SMPROGRAMS\JustFun"
  CreateShortcut "$SMPROGRAMS\JustFun\JustFun Логистика.lnk" "$INSTDIR\OrdersLogistics.exe" "" "$INSTDIR\OrdersLogistics.exe" 0
  CreateShortcut "$SMPROGRAMS\JustFun\Диагностика.lnk" "$INSTDIR\Orders-Logistics-Recovery.exe" "" "$INSTDIR\Orders-Logistics-Recovery.exe" 0
  CreateShortcut "$SMPROGRAMS\JustFun\Удалить программу.lnk" "$INSTDIR\Orders-Logistics-Uninstall.exe" "" "$INSTDIR\Orders-Logistics-Uninstall.exe" 0
shortcuts_done:

  ${If} $OldMoved == "1"
    FileOpen $0 "$BackupDir\.justfun-superseded" w
    ${IfNot} ${Errors}
      FileWrite $0 "${VERSION}$\r$\n"
      FileClose $0
    ${EndIf}
  ${EndIf}
  Delete "$SmokeReport"
  RMDir /r "$SmokeReport.profile"
  RMDir /r "$BackupDir"
  Delete "$ConfigBackup"
  !insertmacro JFLog "SUCCESS"
  SetErrorLevel 0
  Goto install_done

install_failed:
  Push "FAIL $FailureMessage"
  Call WriteLog
  Call RestorePreviousInstallation
  SetErrorLevel 10
  IfSilent +3
  MessageBox MB_ICONSTOP "Установка не завершена.$\r$\n$\r$\n$FailureMessage$\r$\n$\r$\nЖурнал: $LogPath"
  Abort
  Quit
install_done:
SectionEnd

Function un.WriteLog
  Exch $0
  Push $1
  ClearErrors
  FileOpen $1 "$UninstallLogPath" a
  ${IfNot} ${Errors}
    ; Match the installer logger: this NSIS runtime may open an existing file
    ; at offset 0 even in append mode, so seek explicitly before every line.
    FileSeek $1 0 END
    FileWrite $1 "$0$\r$\n"
    FileClose $1
  ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

Function un.onInit
  SetShellVarContext current
  ReadRegStr $UninstallProgramDir HKCU "Software\JustFun\OrdersLogistics" "ProgramDir"
  ReadRegStr $UninstallDataDir HKCU "Software\JustFun\OrdersLogistics" "DataDir"
  StrCpy $PurgeData "0"
  StrCpy $UninstallLogPath "$LOCALAPPDATA\JustFun\OrdersLogistics\logs\uninstall-${VERSION}.log"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/PURGEDATA" $R1
  ${IfNot} ${Errors}
    StrCpy $PurgeData "1"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/LOG=" $R1
  ${IfNot} ${Errors}
    StrCpy $UninstallLogPath $R1
  ${EndIf}
  ${UnStrCase} $0 "$UninstallProgramDir" "U"
  ${UnStrCase} $1 "$INSTDIR" "U"
  StrCmp $0 $1 +3
  MessageBox MB_ICONSTOP "Каталог установленной программы не подтверждён. Удаление остановлено."
  Abort
FunctionEnd

Function un.ValidatePurgeTarget
  StrCpy $2 "0"
  StrLen $0 "$UninstallDataDir"
  ${If} $0 < 8
    Return
  ${EndIf}
  ClearErrors
  GetFullPathName $0 "$UninstallDataDir"
  ${If} ${Errors}
    Return
  ${EndIf}
  StrCpy $UninstallDataDir $0
  System::Call 'kernel32::GetFileAttributesW(w "$UninstallDataDir") i.r0'
  ${If} $0 == -1
    Return
  ${EndIf}
  IntOp $0 $0 & 0x400
  ${If} $0 != 0
    ; Never follow a junction/symlink while purging customer data.
    Return
  ${EndIf}
  ${UnStrCase} $3 "$UninstallDataDir" "U"

  ${UnStrCase} $4 "$WINDIR" "U"
  StrCmp $3 $4 0 +2
  Return
  ${UnStrCase} $4 "$PROFILE" "U"
  StrCmp $3 $4 0 +2
  Return
  ${UnStrCase} $4 "$DOCUMENTS" "U"
  StrCmp $3 $4 0 +2
  Return
  ${UnStrCase} $4 "$LOCALAPPDATA" "U"
  StrCmp $3 $4 0 +2
  Return
  ${UnStrCase} $4 "$TEMP" "U"
  StrCmp $3 $4 0 +2
  Return
  ${UnStrCase} $4 "$PROGRAMFILES" "U"
  StrCmp $3 $4 0 +2
  Return
  ${UnStrCase} $4 "$PROGRAMFILES64" "U"
  StrCmp $3 $4 0 +2
  Return

  ; Never recursively purge data inside Windows or Program Files even if a
  ; registry value and a copied marker were tampered with.
  ${UnStrCase} $4 "$WINDIR" "U"
  StrCpy $4 "$4\"
  StrLen $0 $4
  StrCpy $1 "$3" $0
  StrCmp $1 $4 0 +2
  Return
  ${UnStrCase} $4 "$PROGRAMFILES" "U"
  StrCpy $4 "$4\"
  StrLen $0 $4
  StrCpy $1 "$3" $0
  StrCmp $1 $4 0 +2
  Return
  ${UnStrCase} $4 "$PROGRAMFILES64" "U"
  StrCpy $4 "$4\"
  StrLen $0 $4
  StrCpy $1 "$3" $0
  StrCmp $1 $4 0 +2
  Return
  StrCpy $2 "1"
FunctionEnd

Function un.OptionsPageCreate
  nsDialogs::Create 1018
  Pop $UninstallOptionsDialog
  ${If} $UninstallOptionsDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 2% 3% 96% 12% "Удаление JustFun Логистика"
  Pop $0
  CreateFont $1 "Segoe UI" 15 700
  SendMessage $0 ${WM_SETFONT} $1 1
  ${NSD_CreateLabel} 2% 19% 96% 20% "Файлы программы будут удалены. Рабочие данные по умолчанию сохраняются, чтобы переустановка или обновление не уничтожили заказы и настройки."
  Pop $0
  ${NSD_CreateLabel} 2% 44% 96% 9% "Рабочие данные: $UninstallDataDir"
  Pop $0
  ${NSD_CreateCheckbox} 2% 60% 96% 12% "Сохранить рабочие данные"
  Pop $UninstallKeepCheck
  StrCmp $PurgeData "1" 0 +3
  ${NSD_Uncheck} $UninstallKeepCheck
  Goto +2
  ${NSD_Check} $UninstallKeepCheck
  nsDialogs::Show
FunctionEnd

Function un.OptionsPageLeave
  ${NSD_GetState} $UninstallKeepCheck $0
  StrCmp $0 ${BST_CHECKED} 0 +3
  StrCpy $PurgeData "0"
  Goto +2
  StrCpy $PurgeData "1"
FunctionEnd

Section "Uninstall"
  Push "START uninstall"
  Call un.WriteLog

  IfFileExists "$INSTDIR\OrdersLogistics.exe" 0 uninstall_window_checks
  InitPluginsDir
  StrCpy $2 "$PLUGINSDIR\running-instance.txt"
  Delete "$2"
  StrCpy $4 "missing"
  nsExec::ExecToStack /TIMEOUT=15000 '"$INSTDIR\OrdersLogistics.exe" --running-instance-probe-output="$2"'
  Pop $0
  Pop $1
  IfFileExists "$2" 0 uninstall_probe_invalid
  FileOpen $3 "$2" r
  FileRead $3 $4
  FileClose $3
  StrCmp $4 "RUNNING" uninstall_running
  StrCmp $4 "NOT_RUNNING" 0 uninstall_probe_invalid
  StrCmp $0 "0" uninstall_window_checks uninstall_probe_invalid
uninstall_probe_invalid:
  Push "FAIL application probe returned $0 state=$4"
  Call un.WriteLog
  Goto uninstall_locked
uninstall_running:
  Push "FAIL application is running"
  Call un.WriteLog
  Goto uninstall_locked
uninstall_window_checks:
  FindWindow $0 "" "JustFun Логистика · ${VERSION}"
  StrCmp $0 0 +4
  Push "FAIL application is running"
  Call un.WriteLog
  Goto uninstall_locked
  FindWindow $0 "" "JustFun Логистика · JustFun"
  StrCmp $0 0 +4
  Push "FAIL application is running"
  Call un.WriteLog
  Goto uninstall_locked

  ; First remove the program transactionally. Windows runs the uninstaller from
  ; a temporary copy, so the installed directory can be renamed as one unit.
  StrCpy $RemovalDir "$INSTDIR.__justfun_remove__"
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i.r9'
  ${If} $9 != -1
    IntOp $8 $9 & 0x400
    ${If} $8 != 0
      Push "FAIL program directory is a reparse point"
      Call un.WriteLog
      Goto uninstall_locked
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$RemovalDir") i.r9'
  ${If} $9 != -1
    IntOp $8 $9 & 0x400
    ${If} $8 != 0
      Push "FAIL removal directory is a reparse point"
      Call un.WriteLog
      Goto uninstall_locked
    ${EndIf}
  ${EndIf}
  RMDir /r "$RemovalDir"
  ${If} ${FileExists} "$RemovalDir\*.*"
    Push "FAIL stale removal directory is locked"
    Call un.WriteLog
    Goto uninstall_locked
  ${EndIf}
  SetOutPath "$TEMP"
  ; The generated NSIS uninstaller starts through a short-lived launcher in
  ; the installation directory. Windows Defender or the Electron smoke test
  ; can also retain a handle briefly after setup. A single atomic Rename made
  ; an immediate uninstall fail even though the directory became free moments
  ; later. Retry the same safe operation for up to 60 seconds; registration and
  ; user data are still untouched until the complete program tree is removed.
  StrCpy $5 "0"
uninstall_rename_retry:
  ClearErrors
  Rename "$INSTDIR" "$RemovalDir"
  ${IfNot} ${Errors}
    Goto uninstall_program_renamed
  ${EndIf}
  IntOp $5 $5 + 1
  ${If} $5 >= 120
    Push "FAIL program directory is locked after 120 retries"
    Call un.WriteLog
    Goto uninstall_locked
  ${EndIf}
  Sleep 500
  Goto uninstall_rename_retry

uninstall_program_renamed:
  StrCpy $6 "0"
uninstall_remove_retry:
  RMDir /r "$RemovalDir"
  ${IfNot} ${FileExists} "$RemovalDir\*.*"
    Goto uninstall_program_removed
  ${EndIf}
  IntOp $6 $6 + 1
  ${If} $6 >= 120
    Rename "$RemovalDir" "$INSTDIR"
    Push "FAIL program files could not be removed after 120 retries; installation restored"
    Call un.WriteLog
    Goto uninstall_locked
  ${EndIf}
  Sleep 500
  Goto uninstall_remove_retry

uninstall_program_removed:

  Delete "$DESKTOP\JustFun — Заказы и логистика.lnk"
  Delete "$DESKTOP\JustFun Логистика.lnk"
  RMDir /r "$SMPROGRAMS\JustFun"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JustFunOrdersLogistics"
  DeleteRegKey HKCU "Software\JustFun\OrdersLogistics"

  StrCmp $PurgeData "1" 0 keep_data
  Call un.ValidatePurgeTarget
  StrCmp $2 "1" 0 data_not_confirmed
  ${If} ${FileExists} "$UninstallDataDir\.justfun\product-root.txt"
    FileOpen $0 "$UninstallDataDir\.justfun\product-root.txt" r
    FileRead $0 $1
    FileClose $0
    StrCmp $1 "JustFun.OrdersLogistics$\r$\n" 0 data_not_confirmed
    RMDir /r "$UninstallDataDir"
    Push "DATA removed"
    Call un.WriteLog
    Goto keep_data
  ${EndIf}
data_not_confirmed:
  Push "DATA preserved: marker validation failed"
  Call un.WriteLog
keep_data:
  Push "PROGRAM removed"
  Call un.WriteLog
  SetErrorLevel 0
  Goto uninstall_done

uninstall_locked:
  SetErrorLevel 30
  IfSilent uninstall_done
  MessageBox MB_ICONSTOP "Удаление остановлено: файлы JustFun используются. Закройте программу, при необходимости перезагрузите Windows и повторите удаление. Рабочие данные и регистрация не изменены."
  Abort
uninstall_done:
SectionEnd
