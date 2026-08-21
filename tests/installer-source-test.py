from __future__ import annotations

import hashlib
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "source" / "installer"
PREMIUM_UI = INSTALLER / "premium-ui"
APP_MAIN = ROOT / "source" / "application" / "main.js"
PAYLOAD_BUILDER = ROOT / "source" / "desktop-runtime" / "build_payload.py"
PAYLOAD_HARDENER = ROOT / "source" / "desktop-runtime" / "harden_payload.mjs"
WINDOWS_WORKFLOW = ROOT / ".github" / "workflows" / "windows-native-783.yml"
CRASH_RECOVERY_TEST = ROOT / "tests" / "installer-crash-recovery-test.ps1"
PE_ICON_TEST = ROOT / "tests" / "verify-pe-icon.mjs"


class NativeInstallerSourceTests(unittest.TestCase):
    def test_windows_ci_installs_pinned_pillow_dependency(self):
        workflow = WINDOWS_WORKFLOW.read_text(encoding="utf-8")
        install = "python -m pip install --disable-pip-version-check --no-deps Pillow==12.3.0"
        self.assertIn(install, workflow)
        self.assertLess(workflow.index("Configure Python 3.12"), workflow.index(install))

    def test_old_script_runtime_is_removed(self):
        removed = (
            "bootstrap.c",
            "installer.ps1",
            "recovery.ps1",
            "uninstall.ps1",
            "package_builder.py",
        )
        for name in removed:
            self.assertFalse((INSTALLER / name).exists(), name)

    def test_setup_and_recovery_do_not_launch_script_hosts(self):
        forbidden = (
            "powershell",
            "pwsh",
            "cmd.exe",
            ".bat",
            ".cmd",
            ".ps1",
            "wscript",
            "cscript",
        )
        for name in ("Setup.nsi", "Recovery.nsi"):
            source = (INSTALLER / name).read_text(encoding="utf-8").lower()
            for token in forbidden:
                self.assertNotIn(token, source, f"{name}: {token}")
        for path in PREMIUM_UI.glob("*.cs"):
            source = path.read_text(encoding="utf-8").lower()
            for token in forbidden:
                self.assertNotIn(token, source, f"{path.name}: {token}")

    def test_premium_installer_has_one_unicode_ui_for_all_states(self):
        xaml = (PREMIUM_UI / "MainWindow.xaml").read_text(encoding="utf-8")
        code = (PREMIUM_UI / "MainWindow.xaml.cs").read_text(encoding="utf-8")
        project = (PREMIUM_UI / "JustFunPremiumSetup.csproj").read_text(encoding="utf-8")
        engine = (PREMIUM_UI / "SetupEngine.cs").read_text(encoding="utf-8")
        for page in (
            'x:Name="WelcomePage"',
            'x:Name="OptionsPage"',
            'x:Name="ProgressPage"',
            'x:Name="FinishPage"',
            'x:Name="ErrorPage"',
        ):
            self.assertIn(page, xaml)
        self.assertIn("ПРЕМИАЛЬНАЯ УСТАНОВКА", xaml)
        self.assertIn("Установка завершена", xaml)
        self.assertIn("pack://application:,,,/Assets/JustFun-official-transparent.png", xaml)
        self.assertIn("<UseWPF>true</UseWPF>", project)
        self.assertIn("<SelfContained>true</SelfContained>", project)
        self.assertIn("<PublishSingleFile>true</PublishSingleFile>", project)
        self.assertIn("JustFun.Setup.Engine", project)
        self.assertIn("--render-previews", code)
        self.assertIn("NSIS requires /D to be the final argument", engine)
        self.assertIn('"/NOSTART"', engine)
        self.assertIn("CleanupStaleExtractions(setupRoot)", engine)
        self.assertIn("TimeSpan.FromHours(6)", engine)
        self.assertIn("for (var attempt = 0; attempt < 8; attempt++)", engine)
        self.assertIn("Thread.Sleep(100 * (attempt + 1))", engine)
        app = (PREMIUM_UI / "App.xaml.cs").read_text(encoding="utf-8")
        self.assertIn("JustFun.OrdersLogistics.PremiumSetup", app)
        self.assertIn("Установщик JustFun уже запущен", app)
        self.assertIn("Shutdown(21)", app)

    def test_setup_is_transactional_and_runs_installed_smoke_test(self):
        source = (INSTALLER / "Setup.nsi").read_text(encoding="utf-8")
        for marker in (
            'StrCpy $StageDir "$INSTDIR.__justfun_stage__"',
            'StrCpy $BackupDir "$INSTDIR.__justfun_backup__"',
            'Rename "$INSTDIR" "$BackupDir"',
            'Rename "$StageDir" "$INSTDIR"',
            "Call RestorePreviousInstallation",
            "--installer-smoke-test",
            "--installer-smoke-output=",
            'WriteUninstaller "$INSTDIR\\Orders-Logistics-Uninstall.exe"',
            'FindWindow $0 "" "JustFun Логистика',
            'GetFullPathName $0 "$INSTDIR"',
            'GetFullPathName $0 "$DataDir"',
            'TARGET program=$INSTDIR',
            'TARGET data=$DataDir',
            "Папка рабочих данных находится внутри папки программы.",
            "Папка программы находится внутри папки рабочих данных.",
            "Рабочие данные нельзя хранить внутри Program Files.",
            "Для установки без прав администратора выберите папку программы внутри LocalAppData",
            'StrCpy $INSTDIR "$LOCALAPPDATA\\Programs\\JustFun\\OrdersLogistics"',
            '${StrCase} $3 "$DataDir" "U"',
            'CreateDirectory "$INSTDIR"',
            'CreateDirectory "$DataDir"',
            'RMDir "$INSTDIR"',
            'StrCmp "$INSTDIR" "$WINDIR"',
            'StrCmp "$DataDir" "$DOCUMENTS"',
            'StrCpy $ConfigExisted "-1"',
            '${ElseIf} $ConfigExisted == "0"',
            'StrCmp "$StageDir" "" +2',
            '!insertmacro JFLog "STEP register"',
            'SetOutPath "$TEMP"',
            "Call ReconcileInterruptedInstallation",
            '"$BackupDir\\.justfun-superseded"',
            "${DriveSpace}",
            '${GetRoot} "$INSTDIR" $1',
            'DISK root=$1 free_mb=$0 required_mb=${REQUIRED_MB}',
            'FileOpen $R2 "$LogPath" w',
            'FileWrite $R2 "START version=${VERSION}$\\r$\\n"',
            'FileSeek $1 0 END',
            "${REQUIRED_MB}",
            "/ALLOWDOWNGRADE",
            "${VersionCompare}",
        ):
            self.assertIn(marker, source)
        self.assertNotIn('GetFullPathName $INSTDIR "$INSTDIR"', source)
        self.assertNotIn('GetFullPathName $DataDir "$DataDir"', source)
        self.assertNotIn('${DriveSpace} "$INSTDIR"', source)
        self.assertLess(
            source.index('${GetRoot} "$INSTDIR" $1'),
            source.index('${DriveSpace} "$1" "/D=F /S=M" $0'),
        )
        self.assertIn('CreateShortcut "$DESKTOP\\JustFun Логистика.lnk"', source)
        self.assertIn('"DisplayName" "JustFun Логистика"', source)
        self.assertNotIn('CreateShortcut "$DESKTOP\\JustFun — Заказы и логистика.lnk"', source)
        failure_cleanup = source[
            source.index("install_failed:") : source.index("install_done:")
        ]
        self.assertNotIn("DeleteRegKey", failure_cleanup)
        self.assertNotIn("CreateShortcut", failure_cleanup)
        self.assertLess(
            source.index('CreateDirectory "$INSTDIR"'),
            source.index('GetFullPathName $0 "$INSTDIR"', source.index('Section "Установка"')),
        )
        self.assertLess(
            source.index('StrCpy $ConfigExisted "0"', source.index('Section "Установка"')),
            source.index('${If} ${FileExists} "$LOCALAPPDATA\\JustFun\\OrdersLogistics\\install.json"'),
        )
        self.assertLess(
            source.index('StrCmp $0 "0" 0 smoke_failed'),
            source.index('!insertmacro JFLog "STEP register"'),
        )
        self.assertLess(
            source.index('SetOutPath "$TEMP"'),
            source.index('!insertmacro JFLog "STEP commit-atomic-install"'),
        )
        main_source = APP_MAIN.read_text(encoding="utf-8")
        self.assertIn('RMDir /r "$SmokeReport.profile"', source)
        self.assertIn("setInstallerSmokeSessionDefaults(outputPath)", main_source)
        self.assertNotIn(
            "setSecureSessionDefaults(config);\n    await app.whenReady();\n    result.checks.electronReady",
            main_source,
        )

    def test_uninstall_is_transactional_and_refuses_unsafe_data_purge(self):
        source = (INSTALLER / "Setup.nsi").read_text(encoding="utf-8")
        uninstall = source[source.index('Section "Uninstall"') :]
        uninstall_logger = source[source.index("Function un.WriteLog") : source.index("Function un.onInit")]
        for marker in (
            'StrCpy $RemovalDir "$INSTDIR.__justfun_remove__"',
            'Rename "$INSTDIR" "$RemovalDir"',
            'Rename "$RemovalDir" "$INSTDIR"',
            "uninstall_rename_retry:",
            "uninstall_remove_retry:",
            "Sleep 500",
            "after 120 retries",
            "Call un.ValidatePurgeTarget",
            'StrCmp $2 "1" 0 data_not_confirmed',
            "SetErrorLevel 30",
            "Рабочие данные и регистрация не изменены",
            "GetFileAttributesW",
            "0x400",
            "program directory is a reparse point",
        ):
            self.assertIn(marker, source)
        self.assertLess(
            uninstall.index('Rename "$INSTDIR" "$RemovalDir"'),
            uninstall.index("DeleteRegKey HKCU"),
        )
        self.assertLess(
            uninstall.index('RMDir /r "$RemovalDir"'),
            uninstall.index("DeleteRegKey HKCU"),
        )
        self.assertIn("FileSeek $1 0 END", uninstall_logger)

    def test_interrupted_update_recovery_is_exercised_on_windows(self):
        test = CRASH_RECOVERY_TEST.read_text(encoding="utf-8")
        setup = (INSTALLER / "Setup.nsi").read_text(encoding="utf-8")
        workflow = WINDOWS_WORKFLOW.read_text(encoding="utf-8")
        for marker in (
            "restore-interrupted",
            "cleanup-completed",
            "preserve-corrupt",
            ".justfun-superseded",
            "2000000000",
        ):
            self.assertIn(marker, test)
        for marker in (
            "FAIL_CODE low-disk-space",
            "FAIL_CODE disk-root-unavailable",
            "FAIL_CODE disk-space-unavailable",
            "RECOVERY corrupt-backup detected",
        ):
            self.assertIn(marker, setup)
        self.assertIn("installer-crash-recovery-test.ps1", workflow)
        self.assertIn("if (-not $?) { throw 'Installer crash recovery test failed.' }", workflow)

    def test_full_installer_acceptance_uses_powershell_invocation_status(self):
        workflow = WINDOWS_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("installer-full-acceptance-test.ps1", workflow)
        self.assertIn("if (-not $?) { throw 'Full installer acceptance failed.' }", workflow)
        self.assertNotIn(
            "if ($LASTEXITCODE -ne 0) { throw 'Full installer acceptance failed.' }",
            workflow,
        )

    def test_shortcut_icon_location_uses_required_com_output_parameter(self):
        workflow = WINDOWS_WORKFLOW.read_text(encoding="utf-8")
        verifier = PE_ICON_TEST.read_text(encoding="utf-8")
        self.assertIn("$iconIndex = $link.GetIconLocation([ref]$iconSource)", workflow)
        self.assertIn("if ($iconIndex -ne 0)", workflow)
        self.assertNotIn("$link.GetIconLocation()", workflow)
        self.assertIn("node tests/verify-pe-icon.mjs $exe", workflow)
        self.assertIn("Buffer.from(entry.bin).equals", verifier)

    def test_program_and_data_are_separate_and_data_is_preserved_by_default(self):
        source = (INSTALLER / "Setup.nsi").read_text(encoding="utf-8")
        self.assertIn(r'InstallDir "$LOCALAPPDATA\Programs\JustFun\OrdersLogistics"', source)
        self.assertIn(r'StrCpy $DataDir "$DOCUMENTS\JustFun\Заказы и логистика"', source)
        self.assertIn("Папка программы и папка рабочих данных должны быть раздельными", source)
        self.assertIn('StrCpy $PurgeData "0"', source)
        self.assertIn(r'$UninstallDataDir\.justfun\product-root.txt', source)
        self.assertIn('StrCmp $1 "JustFun.OrdersLogistics', source)

    def test_recovery_checks_real_installed_files(self):
        source = (INSTALLER / "Recovery.nsi").read_text(encoding="utf-8")
        for path in (
            r"$ProgramDir\OrdersLogistics.exe",
            r"$ProgramDir\resources\app.asar",
            r"$ProgramDir\resources\justfun-security.json",
        ):
            self.assertIn(path, source)
        self.assertIn("SetErrorLevel 20", source)
        self.assertIn("--installer-smoke-test", source)
        self.assertIn("Целостность и безопасный запуск программы подтверждены", source)
        self.assertIn('VIAddVersionKey /LANG=1049 "LegalCopyright" "JustFun"', source)
        self.assertIn("!insertmacro MUI_PAGE_INSTFILES", source)
        self.assertLess(
            source.index('!insertmacro MUI_PAGE_WELCOME'),
            source.index('!insertmacro MUI_LANGUAGE "Russian"'),
        )

    def test_official_logo_hash_is_pinned(self):
        source = (INSTALLER / "build_assets.py").read_text(encoding="utf-8")
        hardener = PAYLOAD_HARDENER.read_text(encoding="utf-8")
        expected = "4faffc5cd41e8e26f44df14c879f340d5451ae058a7b5e90ca485ea442258813"
        transparent_expected = "464d69baa9d275324532b8a55527d72452021cace7da04d88ec7d213b83a0359"
        icon_expected = "a5c189b91d71d7a4bac6297f2b04218104c41f6464d2d347d34014ea2a9fd140"
        self.assertIn(expected, source)
        self.assertIn(transparent_expected, source)
        self.assertIn(icon_expected, source)
        self.assertIn(icon_expected.upper(), hardener)
        icon = ROOT / "source" / "application" / "assets" / "JustFun.ico"
        self.assertEqual(hashlib.sha256(icon.read_bytes()).hexdigest(), icon_expected)
        logo = ROOT / "source" / "application" / "assets" / "JustFun-official.png"
        transparent_logo = ROOT / "source" / "application" / "assets" / "JustFun-official-transparent.png"
        self.assertEqual(hashlib.sha256(logo.read_bytes()).hexdigest(), expected)
        self.assertEqual(hashlib.sha256(transparent_logo.read_bytes()).hexdigest(), transparent_expected)

    def test_application_reads_native_installer_utf16_config(self):
        source = APP_MAIN.read_text(encoding="utf-8")
        self.assertIn("raw[0] === 0xFF && raw[1] === 0xFE", source)
        self.assertIn("toString('utf16le')", source)

    def test_visual_qa_uses_controlled_hidden_surface_and_dpi_normalization(self):
        source = APP_MAIN.read_text(encoding="utf-8")
        for marker in (
            "x:-20000,y:-20000,useContentSize:false,frame:false,resizable:false,show:true,skipTaskbar:true",
            "backgroundThrottling:false",
            "win.setBounds({x:-20000,y:-20000,width:bounds.width+(width-viewport.width)",
            "capturePaintedFrame(win,{x:0,y:0,width:content.width,height:content.height})",
            "captured.resize({width:outputWidth,height:outputHeight,quality:'best'})",
            "viewportWidth:Math.round(testCase.width/testCase.zoom)",
            "Visual QA viewport changed before capture",
            "Visual QA frame has invalid dimensions",
            "10-minimum-1120x720",
            "14-scale-200",
            "localRootOverride=path.join(output,'isolated-local')",
            "app.setPath('userData',electronProfile)",
        ):
            self.assertIn(marker, source)
        self.assertIn("win.showInactive()", source)
        self.assertGreaterEqual(source.count("ensureDir(localRootOverride)"), 2)

    def test_build_verifies_pe_and_forbidden_runtime_dependencies(self):
        source = (INSTALLER / "build_windows.py").read_text(encoding="utf-8")
        self.assertIn("raw[:2] != b\"MZ\"", source)
        self.assertIn('b"powershell.exe"', source)
        self.assertIn("official_logo_sha256", source)
        self.assertIn('"runtime": "wpf-premium-shell+native-nsis-engine"', source)
        self.assertIn('"source_encoding": "utf-8-bom"', source)
        self.assertIn("write_unicode_nsis_source", source)
        self.assertIn('"publish"', source)
        self.assertIn("required_free_mb", source)
        self.assertIn('f"/DREQUIRED_MB={required_free_mb}"', source)
        self.assertIn("dir=payload.parent", source)
        self.assertEqual(source.count('"/WX"'), 2)
        self.assertIn("ensure_ascii=True", source)
        self.assertIn("--setup-engine and --recovery must be supplied together.", source)
        self.assertIn("if reusable_setup_engine:", source)
        self.assertIn("engine_manifest = verify_pe(setup_engine, (b\"Nullsoft\",))", source)

    def test_native_config_json_uses_valid_nsis_quoted_strings(self):
        source = (INSTALLER / "Setup.nsi").read_text(encoding="utf-8")
        self.assertNotIn("'  $\"app_version$\"", source)
        self.assertIn('`  "app_version": "${VERSION}",$\\r$\\n`', source)
        self.assertIn('`  "program_dir": "$1",$\\r$\\n`', source)

    def test_windows_acceptance_uses_native_nsis_directory_switch_last(self):
        source = WINDOWS_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("Render and validate every premium installer screen", source)
        self.assertIn("05-error.png", source)
        self.assertIn("07-route-telegram-actions.png", source)
        self.assertIn("08-driver-telegram.png", source)
        self.assertIn("$shortcutPath = Join-Path $desktop 'JustFun Логистика.lnk'", source)
        self.assertIn("New-Object -ComObject Shell.Application", source)
        self.assertIn("node tests/verify-pe-icon.mjs", source)
        self.assertIn("Installed executable icon differs from the official icon", source)
        self.assertIn("Desktop shortcut target is invalid", source)
        self.assertIn("Desktop shortcut icon source is invalid", source)
        self.assertIn("Running-application uninstall refusal and state preservation: PASS", source)
        self.assertIn("Invalid data-marker purge refusal: PASS", source)
        self.assertIn("uninstall-locked.log", source)
        self.assertIn("uninstall-invalid-marker.log", source)
        self.assertNotIn("New-Object -ComObject WScript.Shell", source)
        self.assertIn("tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip", source)
        self.assertIn("c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1", source)
        self.assertIn('"NSIS_MAKENSIS=$makensis"', source)
        self.assertNotIn("choco install nsis", source)
        install_args = next(
            line.strip()
            for line in source.splitlines()
            if line.strip().startswith("$installArgs = @(")
        )
        self.assertNotIn("/PROGRAMDIR=", install_args)
        self.assertNotIn("/NODESKTOP", install_args)
        self.assertTrue(install_args.endswith('"/D=$install")'), install_args)

    def test_payload_builder_handles_precreated_empty_output_directory(self):
        source = PAYLOAD_BUILDER.read_text(encoding="utf-8")
        self.assertIn("output_dir.rmdir()", source)
        self.assertIn("if any(output_dir.iterdir())", source)
        self.assertLess(source.index("output_dir.rmdir()"), source.index("shutil.copytree(electron_dist, temporary)"))
        self.assertIn('"protect_stage.mjs"', source)
        self.assertIn('"harden_payload.mjs"', source)
        self.assertIn("tempfile.gettempdir()", source)
        self.assertIn('normalized.endswith("/node_modules/cpu-features")', source)
        self.assertIn('{"deps", "cmake", "scripts", "src", "patches", "test"}', source)
        self.assertNotIn('output_dir / "resources" / "app" / "web" / "index.html"', source)

    def test_payload_contains_third_party_notices(self):
        payload_builder = PAYLOAD_BUILDER.read_text(encoding="utf-8")
        windows_builder = (INSTALLER / "build_windows.py").read_text(encoding="utf-8")
        notices = ROOT / "source" / "application" / "THIRD-PARTY-NOTICES.txt"
        self.assertTrue(notices.is_file())
        self.assertIn("LICENSES.chromium.html", payload_builder)
        self.assertIn("THIRD-PARTY-NOTICES.txt", payload_builder)
        self.assertIn("THIRD-PARTY-NOTICES.txt", windows_builder)


if __name__ == "__main__":
    unittest.main(verbosity=2)
