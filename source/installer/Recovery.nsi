Unicode True
ManifestDPIAware True
RequestExecutionLevel user
CRCCheck force
SetCompressor zlib

!ifndef VERSION
  !error "VERSION must come from the canonical release contract"
!endif
!ifndef FILE_VERSION
  !error "FILE_VERSION must come from the canonical release contract"
!endif
!ifndef ASSETS_DIR
  !error "ASSETS_DIR is required"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "Orders-Logistics-Recovery-${VERSION}.exe"
!endif

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"

Name "JustFun — диагностика ${VERSION}"
Caption "JustFun — диагностика и восстановление"
BrandingText "JustFun · Система автоматизации для малого бизнеса"
OutFile "${OUT_FILE}"
Icon "${ASSETS_DIR}\JustFun.ico"
WindowIcon On
ShowInstDetails nevershow
SilentInstall normal

VIProductVersion "${FILE_VERSION}"
VIAddVersionKey /LANG=1049 "ProductName" "JustFun Логистика — диагностика"
VIAddVersionKey /LANG=1049 "CompanyName" "JustFun"
VIAddVersionKey /LANG=1049 "FileDescription" "Диагностика JustFun Логистика"
VIAddVersionKey /LANG=1049 "FileVersion" "${FILE_VERSION}"
VIAddVersionKey /LANG=1049 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1049 "LegalCopyright" "JustFun"

!define MUI_ICON "${ASSETS_DIR}\JustFun.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${ASSETS_DIR}\welcome.bmp"
!insertmacro MUI_PAGE_WELCOME
Page custom DiagnosticsPageCreate DiagnosticsPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"

Var ProgramDir
Var DataDir
Var ReportPath
Var ReportText
Var DiagnosticsOk
Var Dialog
Var LaunchButton
Var SmokeReport

Function BuildDiagnostics
  StrCpy $DiagnosticsOk "1"
  StrCpy $ReportText "JustFun Логистика ${VERSION}$\r$\n$\r$\n"
  ReadRegStr $ProgramDir HKCU "Software\JustFun\OrdersLogistics" "ProgramDir"
  ReadRegStr $DataDir HKCU "Software\JustFun\OrdersLogistics" "DataDir"

  StrCmp $ProgramDir "" program_missing
  StrCpy $ReportText "$ReportTextПрограмма: $ProgramDir$\r$\n"
  ${IfNot} ${FileExists} "$ProgramDir\OrdersLogistics.exe"
    StrCpy $ReportText "$ReportText[ОШИБКА] OrdersLogistics.exe отсутствует.$\r$\n"
    StrCpy $DiagnosticsOk "0"
  ${Else}
    StrCpy $ReportText "$ReportText[OK] Главный EXE найден.$\r$\n"
  ${EndIf}
  ${IfNot} ${FileExists} "$ProgramDir\resources\app.asar"
    StrCpy $ReportText "$ReportText[ОШИБКА] Защищённый архив программы отсутствует.$\r$\n"
    StrCpy $DiagnosticsOk "0"
  ${Else}
    StrCpy $ReportText "$ReportText[OK] Защищённый архив программы найден.$\r$\n"
  ${EndIf}
  ${IfNot} ${FileExists} "$ProgramDir\resources\justfun-security.json"
    StrCpy $ReportText "$ReportText[ОШИБКА] Паспорт защиты программы отсутствует.$\r$\n"
    StrCpy $DiagnosticsOk "0"
  ${Else}
    StrCpy $ReportText "$ReportText[OK] Паспорт защиты программы найден.$\r$\n"
  ${EndIf}
  Goto check_data

program_missing:
  StrCpy $ReportText "$ReportText[ОШИБКА] Установка не зарегистрирована.$\r$\n"
  StrCpy $DiagnosticsOk "0"

check_data:
  StrCpy $ReportText "$ReportText$\r$\nРабочие данные: $DataDir$\r$\n"
  StrCmp $DataDir "" data_missing
  ${IfNot} ${FileExists} "$DataDir\*.*"
    StrCpy $ReportText "$ReportText[ОШИБКА] Папка рабочих данных недоступна.$\r$\n"
    StrCpy $DiagnosticsOk "0"
  ${Else}
    StrCpy $ReportText "$ReportText[OK] Папка рабочих данных доступна.$\r$\n"
  ${EndIf}
  Goto run_smoke

data_missing:
  StrCpy $ReportText "$ReportText[ОШИБКА] Папка рабочих данных не зарегистрирована.$\r$\n"
  StrCpy $DiagnosticsOk "0"

run_smoke:
  ${If} $DiagnosticsOk == "1"
    StrCpy $SmokeReport "$TEMP\JustFun-recovery-smoke-${VERSION}.json"
    Delete "$SmokeReport"
    nsExec::ExecToStack /TIMEOUT=120000 '"$ProgramDir\OrdersLogistics.exe" --installer-smoke-test --installer-smoke-output="$SmokeReport"'
    Pop $0
    Pop $1
    StrCmp $0 "0" 0 smoke_failed
    ${IfNot} ${FileExists} "$SmokeReport"
      Goto smoke_failed
    ${EndIf}
    StrCpy $ReportText "$ReportText[OK] Целостность и безопасный запуск программы подтверждены.$\r$\n"
    Delete "$SmokeReport"
    Goto diagnostics_done
smoke_failed:
    StrCpy $ReportText "$ReportText[ОШИБКА] Встроенная проверка запуска и целостности не пройдена (код $0).$\r$\n"
    StrCpy $DiagnosticsOk "0"
    Delete "$SmokeReport"
  ${EndIf}

diagnostics_done:
  StrCmp $DiagnosticsOk "1" 0 +3
  StrCpy $ReportText "$ReportText$\r$\nИТОГ: обязательные проверки пройдены."
  Goto +2
  StrCpy $ReportText "$ReportText$\r$\nИТОГ: обнаружены ошибки. Переустановите программу, сохранив рабочие данные."
FunctionEnd

Function WriteReport
  StrCmp $ReportPath "" report_done
  FileOpen $0 "$ReportPath" w
  FileWriteUTF16LE /BOM $0 "$ReportText"
  FileClose $0
report_done:
FunctionEnd

Function .onInit
  StrCpy $ReportPath "$LOCALAPPDATA\JustFun\OrdersLogistics\logs\recovery-${VERSION}.txt"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/REPORT=" $R1
  ${IfNot} ${Errors}
    StrCpy $ReportPath $R1
  ${EndIf}
  CreateDirectory "$LOCALAPPDATA\JustFun\OrdersLogistics\logs"
  Call BuildDiagnostics
  Call WriteReport
  StrCmp $DiagnosticsOk "1" 0 +3
  SetErrorLevel 0
  Goto +2
  SetErrorLevel 20
FunctionEnd

Function DiagnosticsPageCreate
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}
  ${NSD_CreateBitmap} 0 0 29% 100% ""
  Pop $0
  ${NSD_SetImage} $0 "${ASSETS_DIR}\sidebar.bmp" $1
  ${NSD_CreateLabel} 32% 3% 65% 10% "Диагностика JustFun"
  Pop $0
  CreateFont $1 "Segoe UI" 15 700
  SendMessage $0 ${WM_SETFONT} $1 1
  SetCtlColors $0 "D8AD50" "061814"
  ${NSD_CreateLabel} 32% 15% 65% 60% "$ReportText"
  Pop $0
  SetCtlColors $0 "F4F8F6" "061814"
  ${NSD_CreateButton} 32% 80% 29% 12% "Запустить программу"
  Pop $LaunchButton
  StrCmp $DiagnosticsOk "1" 0 +2
  ${NSD_OnClick} $LaunchButton LaunchApplication
  StrCmp $DiagnosticsOk "1" +2
  EnableWindow $LaunchButton 0
  ${NSD_CreateButton} 64% 80% 33% 12% "Открыть папку журналов"
  Pop $0
  ${NSD_OnClick} $0 OpenLogs
  SetCtlColors $Dialog "F4F8F6" "061814"
  nsDialogs::Show
FunctionEnd

Function LaunchApplication
  Exec '"$ProgramDir\OrdersLogistics.exe"'
FunctionEnd

Function OpenLogs
  ExecShell "open" "$LOCALAPPDATA\JustFun\OrdersLogistics\logs"
FunctionEnd

Function DiagnosticsPageLeave
FunctionEnd

Section
  Call WriteReport
SectionEnd
