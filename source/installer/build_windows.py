#!/usr/bin/env python3
"""Build native JustFun Setup, Recovery and Uninstall modules on Windows."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import math
import re
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
HEX_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
HEX_GIT_SHA = re.compile(r"^[0-9a-f]{40}$")
REQUIRED_PREBUILD_GROUPS = frozenset({
    "source-contracts",
    "security",
    "business-regression",
    "installer-source",
    "updater-core",
})
REQUIRED_PROTECTED_FUSES = {
    "0": 48,
    "1": 49,
    "2": 48,
    "3": 48,
    "4": 49,
    "5": 49,
    "6": 48,
    "7": 48,
    "8": 49,
    "version": "1",
}
_ACTIVE_STAGING_OUTPUT: Path | None = None


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run(*args: str | os.PathLike[str]) -> None:
    subprocess.run([str(value) for value in args], check=True)


def command_version(*args: str) -> str:
    result = subprocess.run(args, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def file_record(path: Path, base: Path | None = None) -> dict[str, object]:
    return {
        "path": path.relative_to(base).as_posix() if base else path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def read_json_object(path: Path, label: str) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"{label} is unreadable or invalid JSON: {path}") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"{label} must contain one JSON object: {path}")
    return value


def asar_header_sha256(path: Path) -> str:
    """Hash the exact UTF-8 ASAR header string Electron binds into the PE."""
    try:
        with path.open("rb") as stream:
            size_pickle = stream.read(8)
            if len(size_pickle) != 8:
                raise ValueError("missing ASAR size pickle")
            size_payload, header_size = struct.unpack("<II", size_pickle)
            if size_payload != 4 or header_size < 8 or header_size > path.stat().st_size - 8:
                raise ValueError("invalid ASAR header size")
            header_pickle = stream.read(header_size)
        if len(header_pickle) != header_size:
            raise ValueError("truncated ASAR header")
        pickle_payload, string_size = struct.unpack("<II", header_pickle[:8])
        if pickle_payload != header_size - 4 or string_size > header_size - 8:
            raise ValueError("invalid ASAR string pickle")
        header_bytes = header_pickle[8 : 8 + string_size]
        header_text = header_bytes.decode("utf-8")
        header = json.loads(header_text)
        if not isinstance(header, dict) or not isinstance(header.get("files"), dict):
            raise ValueError("invalid ASAR header object")
    except (OSError, UnicodeError, json.JSONDecodeError, struct.error, ValueError) as error:
        raise RuntimeError(f"Protected payload app.asar header is invalid: {path}") from error
    return hashlib.sha256(header_text.encode("utf-8")).hexdigest()


def verify_release_inputs(
    payload: Path,
    build_identity_path: Path,
    source_archive: Path,
    test_evidence_path: Path,
) -> tuple[str, dict[str, object], dict[str, object], dict[str, object]]:
    """Reject stale, incomplete or tampered release input before emitting EXEs."""
    version_path = payload / "version"
    version = version_path.read_text(encoding="utf-8-sig").strip()
    if not SEMVER.fullmatch(version):
        raise RuntimeError("Payload version is not valid SemVer.")

    build_identity = read_json_object(build_identity_path, "Build identity")
    if build_identity.get("schema_version") != 1:
        raise RuntimeError("Build identity schema is unsupported.")
    if build_identity.get("product_id") != "justfun-logistics":
        raise RuntimeError("Build identity has an unexpected product id.")
    if build_identity.get("product_name") != "JustFun Логистика":
        raise RuntimeError("Build identity has an unexpected product name.")
    if build_identity.get("version") != version:
        raise RuntimeError("Build identity version differs from the protected payload.")
    if build_identity.get("source_dirty") is not False:
        raise RuntimeError("Build identity does not describe a clean source tree.")
    if not HEX_GIT_SHA.fullmatch(str(build_identity.get("commit_sha") or "")):
        raise RuntimeError("Build identity does not contain an exact Git commit SHA.")
    if not HEX_GIT_SHA.fullmatch(str(build_identity.get("source_tree") or "")):
        raise RuntimeError("Build identity does not contain an exact Git source tree SHA.")
    if build_identity.get("build_id") != f"jf-{version}-{str(build_identity['commit_sha'])[:12]}":
        raise RuntimeError("Build identity id differs from its version and commit.")
    if not isinstance(build_identity.get("contracts"), dict) or not build_identity["contracts"]:
        raise RuntimeError("Build identity is missing release contracts.")

    test_evidence = read_json_object(test_evidence_path, "Pre-build test evidence")
    if test_evidence.get("schema_version") != 1:
        raise RuntimeError("Pre-build test evidence schema is unsupported.")
    if test_evidence.get("commit_sha") != build_identity.get("commit_sha"):
        raise RuntimeError("Test evidence commit differs from the build identity.")
    groups = test_evidence.get("groups")
    if not isinstance(groups, list) or not groups:
        raise RuntimeError("Required pre-build test evidence is missing.")
    group_ids: set[str] = set()
    for item in groups:
        if not isinstance(item, dict):
            raise RuntimeError("Pre-build test evidence contains an invalid group.")
        group_id = str(item.get("id") or "")
        if not group_id or group_id in group_ids or item.get("status") != "passed":
            raise RuntimeError("Required pre-build test evidence is incomplete, duplicated or failed.")
        group_ids.add(group_id)
    if group_ids != REQUIRED_PREBUILD_GROUPS:
        raise RuntimeError("Pre-build test evidence does not contain the exact required group set.")

    security_path = payload / "resources" / "justfun-security.json"
    security = read_json_object(security_path, "Protected payload security manifest")
    expected_branding = f"{build_identity.get('product_name')} {version}"
    required_security = {
        "schema": 3,
        "archive": "app.asar",
        "windows_integrity_resource": "INTEGRITY/ELECTRONASAR",
        "product_id": build_identity["product_id"],
        "product_version": version,
        "loose_application_directory_present": False,
        "integrity_model": "electron-asar-header-sha256",
        "executable_branding": expected_branding,
    }
    for field, expected in required_security.items():
        if security.get(field) != expected:
            raise RuntimeError(f"Protected payload security field {field} is invalid.")
    for field in ("archive_sha256", "archive_header_sha256"):
        if not HEX_SHA256.fullmatch(str(security.get(field) or "")):
            raise RuntimeError(f"Protected payload security field {field} is invalid.")
    archive_path = payload / "resources" / "app.asar"
    if sha256(archive_path).upper() != str(security["archive_sha256"]).upper():
        raise RuntimeError("Protected payload app.asar differs from its security manifest.")
    if asar_header_sha256(archive_path).upper() != str(security["archive_header_sha256"]).upper():
        raise RuntimeError("Protected payload ASAR header differs from its security manifest.")
    if security.get("fuses") != REQUIRED_PROTECTED_FUSES:
        raise RuntimeError("Protected payload fuse declaration is incomplete or unsafe.")
    if (payload / "resources" / "app").exists():
        raise RuntimeError("Protected payload contains a forbidden loose application directory.")

    try:
        with zipfile.ZipFile(source_archive, "r") as archive:
            if archive.comment.decode("ascii", "strict").lower() != build_identity["commit_sha"]:
                raise RuntimeError("Source archive commit differs from the build identity.")
            bad_member = archive.testzip()
            if bad_member:
                raise RuntimeError(f"Source archive contains a corrupt member: {bad_member}")
            release_contract_bytes = archive.read("source/application/release.json")
            release_contract = json.loads(release_contract_bytes.decode("utf-8-sig"))
    except (OSError, KeyError, UnicodeError, json.JSONDecodeError, zipfile.BadZipFile) as error:
        raise RuntimeError("Source archive is invalid or lacks the canonical release contract.") from error
    if not isinstance(release_contract, dict):
        raise RuntimeError("Source archive release contract must be one JSON object.")
    if hashlib.sha256(release_contract_bytes).hexdigest() != build_identity.get("release_contract_sha256"):
        raise RuntimeError("Source archive release contract hash differs from the build identity.")
    for field in ("product_id", "product_name", "version", "release_status", "contracts", "service_versions", "windows"):
        if release_contract.get(field) != build_identity.get(field):
            raise RuntimeError(f"Source archive release contract field {field} differs from the build identity.")
    supported_channels = release_contract.get("supported_channels")
    if not isinstance(supported_channels, list) or build_identity.get("channel") not in supported_channels:
        raise RuntimeError("Build identity channel is not supported by the source archive.")
    if release_contract.get("product_id") != build_identity["product_id"] or release_contract.get("version") != version:
        raise RuntimeError("Source archive release contract differs from the protected payload.")
    if security.get("release_contract_schema") != release_contract.get("schema_version"):
        raise RuntimeError("Protected payload release contract schema differs from the source archive.")
    return version, build_identity, test_evidence, security


def prepare_staging_output(final_output: Path) -> Path:
    final_output.parent.mkdir(parents=True, exist_ok=True)
    if final_output.exists():
        if not final_output.is_dir():
            raise RuntimeError(f"Output path is not a directory: {final_output}")
        if any(final_output.iterdir()):
            raise RuntimeError(f"Output directory must be empty: {final_output}")
    return Path(tempfile.mkdtemp(prefix=f".{final_output.name}.building-", dir=final_output.parent))


def publish_staging_output(staging_output: Path, final_output: Path) -> None:
    """Expose the release directory only after every mandatory gate passed."""
    if final_output.exists():
        final_output.rmdir()
    os.replace(staging_output, final_output)


def find_makensis(explicit: str | None) -> Path:
    candidates = [
        Path(explicit) if explicit else None,
        Path(shutil.which("makensis.exe") or ""),
        Path(os.environ.get("ProgramFiles(x86)", "")) / "NSIS" / "makensis.exe",
        Path(os.environ.get("ProgramFiles", "")) / "NSIS" / "makensis.exe",
    ]
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate.resolve()
    raise RuntimeError("makensis.exe was not found. Install NSIS 3.x.")


def verify_pe(path: Path, required_strings: tuple[bytes, ...]) -> dict[str, object]:
    raw = path.read_bytes()
    if raw[:2] != b"MZ":
        raise RuntimeError(f"{path.name} is not a Windows PE executable.")
    lowered = raw.lower()
    forbidden = (b"installer.ps1", b"recovery.ps1", b"uninstall.ps1", b"powershell.exe")
    found = [item.decode("ascii") for item in forbidden if item in lowered]
    if found:
        raise RuntimeError(f"{path.name} contains forbidden runtime dependencies: {found}")
    missing = [item.decode("utf-8", "replace") for item in required_strings if item not in raw]
    if missing:
        raise RuntimeError(f"{path.name} is missing expected product markers: {missing}")
    return {"path": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)}


def write_unicode_nsis_source(source: Path, destination: Path) -> Path:
    """Force NSIS to consume UTF-8 with BOM regardless of the runner code page."""
    destination.write_text(
        source.read_text(encoding="utf-8"),
        encoding="utf-8-sig",
        newline="\n",
    )
    return destination


def write_update_file_manifest(payload: Path, build_identity: dict[str, object]) -> Path:
    manifest_path = payload / "UPDATE-FILES.json"
    if manifest_path.exists():
        manifest_path.unlink()
    files = sorted(
        (file_record(item, payload) for item in payload.rglob("*") if item.is_file()),
        key=lambda item: str(item["path"]).lower(),
    )
    manifest = {
        "schema_version": 1,
        "product_id": build_identity["product_id"],
        "version": build_identity["version"],
        "build_id": build_identity["build_id"],
        "commit_sha": build_identity["commit_sha"],
        "files": files,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest_path


def write_deterministic_update_zip(payload: Path, output_file: Path) -> dict[str, object]:
    files = sorted((item for item in payload.rglob("*") if item.is_file()), key=lambda item: item.relative_to(payload).as_posix().lower())
    with zipfile.ZipFile(output_file, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=True) as archive:
        for source in files:
            relative = source.relative_to(payload).as_posix()
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            with source.open("rb") as input_stream, archive.open(info, "w", force_zip64=True) as output_stream:
                shutil.copyfileobj(input_stream, output_stream, length=1024 * 1024)
    return {
        **file_record(output_file),
        "unpacked_bytes": sum(item.stat().st_size for item in files),
        "file_count": len(files),
    }


def _main() -> int:
    global _ACTIVE_STAGING_OUTPUT
    if os.name != "nt":
        raise RuntimeError("The native installer build must run on Windows.")

    parser = argparse.ArgumentParser()
    parser.add_argument("--payload-dir", type=Path, required=True)
    parser.add_argument("--logo", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--node-modules", type=Path, required=True)
    parser.add_argument("--build-identity", type=Path, required=True)
    parser.add_argument("--source-archive", type=Path, required=True)
    parser.add_argument("--test-evidence", type=Path, required=True)
    parser.add_argument("--makensis")
    parser.add_argument("--setup-engine", type=Path)
    parser.add_argument("--recovery", type=Path)
    args = parser.parse_args()

    payload = args.payload_dir.resolve()
    logo = args.logo.resolve()
    final_output = args.output_dir.resolve()
    node_modules = args.node_modules.resolve()
    build_identity_path = args.build_identity.resolve()
    source_archive = args.source_archive.resolve()
    test_evidence_path = args.test_evidence.resolve()
    makensis = find_makensis(args.makensis)
    if final_output == payload or final_output in payload.parents or payload in final_output.parents:
        raise RuntimeError("Output directory must not overlap the protected payload directory.")
    if bool(args.setup_engine) != bool(args.recovery):
        raise RuntimeError("--setup-engine and --recovery must be supplied together.")
    reusable_setup_engine = args.setup_engine.resolve() if args.setup_engine else None
    reusable_recovery = args.recovery.resolve() if args.recovery else None
    if reusable_setup_engine and (not reusable_setup_engine.is_file() or not reusable_recovery.is_file()):
        raise RuntimeError("Reusable setup engine or Recovery file is missing.")
    for required_input in (build_identity_path, source_archive, test_evidence_path):
        if not required_input.is_file():
            raise RuntimeError(f"Required release evidence is missing: {required_input}")
    required = [
        payload / "OrdersLogistics.exe",
        payload / "resources" / "app.asar",
        payload / "resources" / "justfun-security.json",
        payload / "version",
        payload / "LICENSE",
        payload / "LICENSES.chromium.html",
        payload / "THIRD-PARTY-NOTICES.txt",
        payload / "JustFun-UpdateHelper.exe",
    ]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError("Missing payload files: " + ", ".join(missing))
    version, build_identity, test_evidence, _security_manifest = verify_release_inputs(
        payload,
        build_identity_path,
        source_archive,
        test_evidence_path,
    )
    output = prepare_staging_output(final_output)
    _ACTIVE_STAGING_OUTPUT = output
    numeric_version = version.split("-", 1)[0].split("+", 1)[0]
    product_file_version = f"{numeric_version}.0"
    payload_bytes = sum(path.stat().st_size for path in payload.rglob("*") if path.is_file())
    # Staging is placed next to the final application so an update is atomic.
    # Leave an additional 256 MiB for the uninstaller, smoke report, filesystem
    # metadata and antivirus scanners that may temporarily retain extracted files.
    required_free_mb = math.ceil(payload_bytes / (1024 * 1024)) + 256

    # Keep the branded executable staging area on the payload volume.
    # os.replace is atomic only inside one filesystem and Windows runners
    # commonly place the system temp directory on C: while sources are on D:.
    with tempfile.TemporaryDirectory(
        prefix="justfun-native-installer-",
        dir=payload.parent,
    ) as temp_name:
        temporary = Path(temp_name)
        assets = temporary / "assets"
        run(sys.executable, ROOT / "build_assets.py", "--logo", logo, "--output-dir", assets)
        setup_source = write_unicode_nsis_source(
            ROOT / "Setup.nsi",
            temporary / "Setup.unicode.nsi",
        )
        recovery_source = write_unicode_nsis_source(
            ROOT / "Recovery.nsi",
            temporary / "Recovery.unicode.nsi",
        )

        recovery = output / f"Orders-Logistics-Recovery-{version}.exe"
        setup_engine = temporary / "JustFun.Setup.Engine.exe"
        if reusable_setup_engine:
            shutil.copy2(reusable_recovery, recovery)
            shutil.copy2(recovery, payload / "Orders-Logistics-Recovery.exe")
            shutil.copy2(reusable_setup_engine, setup_engine)
            engine_manifest = verify_pe(setup_engine, (b"Nullsoft",))
        else:
            run(
                makensis,
                "/WX",
                "/V4",
                f"/DVERSION={version}",
                f"/DFILE_VERSION={product_file_version}",
                f"/DASSETS_DIR={assets}",
                f"/DOUT_FILE={recovery}",
                recovery_source,
            )
            shutil.copy2(recovery, payload / "Orders-Logistics-Recovery.exe")

        update_helper = output / f"JustFun-{version}-UpdateHelper.exe"
        shutil.copy2(payload / "JustFun-UpdateHelper.exe", update_helper)
        verify_pe(update_helper, (b"JustFun",))
        update_file_manifest = write_update_file_manifest(payload, build_identity)
        update_file_manifest_copy = output / "UPDATE-FILES.json"
        shutil.copy2(update_file_manifest, update_file_manifest_copy)
        update_payload = output / f"JustFun-{version}-win-x64.zip"
        update_payload_record = write_deterministic_update_zip(payload, update_payload)
        payload_bytes = sum(path.stat().st_size for path in payload.rglob("*") if path.is_file())
        required_free_mb = math.ceil(payload_bytes / (1024 * 1024)) + 256

        if not reusable_setup_engine:
            run(
                makensis,
                "/WX",
                "/V4",
                f"/DVERSION={version}",
                f"/DFILE_VERSION={product_file_version}",
                f"/DREQUIRED_MB={required_free_mb}",
                f"/DPAYLOAD_DIR={payload}",
                f"/DASSETS_DIR={assets}",
                f"/DOUT_FILE={setup_engine}",
                setup_source,
            )
            engine_manifest = verify_pe(setup_engine, (b"Nullsoft",))

        dotnet = shutil.which("dotnet.exe") or shutil.which("dotnet")
        if not dotnet:
            raise RuntimeError("dotnet 8 SDK was not found.")
        publish = temporary / "premium-publish"
        run(
            dotnet,
            "publish",
            ROOT / "premium-ui" / "JustFunPremiumSetup.csproj",
            "-c",
            "Release",
            "-r",
            "win-x64",
            "--self-contained",
            "true",
            "-o",
            publish,
            f"/p:PremiumEnginePath={setup_engine}",
            f"/p:PremiumIconPath={assets / 'JustFun.ico'}",
            f"/p:JustFunProductVersion={version}",
            f"/p:JustFunProductFileVersion={product_file_version}",
        )
        premium_executable = publish / "JustFunPremiumSetup.exe"
        if not premium_executable.is_file():
            raise RuntimeError("The premium WPF installer executable was not published.")
        setup = output / f"Orders-Logistics-Setup-{version}-Premium.exe"
        shutil.copy2(premium_executable, setup)

        node = shutil.which("node.exe") or shutil.which("node")
        powershell = shutil.which("powershell.exe")
        if not node:
            raise RuntimeError("Node.js was not found for the mandatory PE resource gate.")
        if not powershell:
            raise RuntimeError("Windows PowerShell was not found for the mandatory crash-recovery gate.")
        pe_resource_evidence = output / "PE-RESOURCE-QA.json"
        run(
            node,
            ROOT / "verify_pe_resources.mjs",
            "--icon",
            assets / "JustFun.ico",
            "--output",
            pe_resource_evidence,
            "--version",
            version,
            "--commit-sha",
            str(build_identity["commit_sha"]),
            "--asar-header-sha256",
            str(_security_manifest["archive_header_sha256"]),
            "--application",
            payload / "OrdersLogistics.exe",
            "--setup",
            setup,
            "--setup-engine",
            setup_engine,
            "--recovery",
            recovery,
            "--update-helper",
            update_helper,
        )
        crash_recovery_evidence = output / "INSTALLER-CRASH-RECOVERY-QA.json"
        run(
            powershell,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            ROOT.parents[1] / "tests" / "installer-crash-recovery-test.ps1",
            "-Makensis",
            makensis,
            "-AssetsDir",
            assets,
            "-BuiltSetupEngine",
            setup_engine,
            "-BuiltSetup",
            setup,
            "-EvidenceFile",
            crash_recovery_evidence,
        )
        for evidence_path, label in (
            (pe_resource_evidence, "PE resource"),
            (crash_recovery_evidence, "installer crash-recovery"),
        ):
            evidence_value = read_json_object(evidence_path, f"{label} evidence")
            if evidence_value.get("status") != "passed":
                raise RuntimeError(f"Mandatory {label} gate did not pass.")
        protected_payload_security = output / "PROTECTED-PAYLOAD-SECURITY.json"
        shutil.copy2(payload / "resources" / "justfun-security.json", protected_payload_security)

    repository = ROOT.parents[1]
    lockfiles = []
    for relative in (
        "source/application/package-lock.json",
        "source/desktop-runtime/package-lock.json",
        "source/installer/package-lock.json",
        "source/update-helper/packages.lock.json",
        "source/license-server/package-lock.json",
        "source/company-telegram-broker/package-lock.json",
        "tests/package-lock.json",
    ):
        lockfile = repository / relative
        if not lockfile.is_file():
            raise RuntimeError(f"Required lockfile is missing: {relative}")
        lockfiles.append(file_record(lockfile, repository))
    electron_package = json.loads((node_modules / "electron" / "package.json").read_text(encoding="utf-8"))
    payload_files = sorted(
        (file_record(path, payload) for path in payload.rglob("*") if path.is_file()),
        key=lambda item: str(item["path"]).lower(),
    )
    github_server = os.environ.get("GITHUB_SERVER_URL", "")
    github_repository = os.environ.get("GITHUB_REPOSITORY", "")
    github_run_id = os.environ.get("GITHUB_RUN_ID", "")
    workflow_url = (
        f"{github_server}/{github_repository}/actions/runs/{github_run_id}"
        if github_server and github_repository and github_run_id
        else None
    )
    manifest = {
        "schema_version": 3,
        "product_id": build_identity["product_id"],
        "product_name": build_identity["product_name"],
        "version": version,
        "channel": build_identity["channel"],
        "commit_sha": build_identity["commit_sha"],
        "source_tree": build_identity["source_tree"],
        "build_id": build_identity["build_id"],
        "generated_at_utc": build_identity["generated_at_utc"],
        "runner": {
            "image": os.environ.get("ImageOS") or os.environ.get("RUNNER_OS") or "local-windows",
            "os": os.environ.get("RUNNER_OS") or "Windows",
            "architecture": os.environ.get("RUNNER_ARCH") or os.environ.get("PROCESSOR_ARCHITECTURE") or "unknown",
        },
        "toolchain": {
            "python": sys.version.split()[0],
            "node": command_version("node", "--version"),
            "npm": command_version("npm.cmd", "--version"),
            "electron": electron_package["version"],
            "nsis": command_version(str(makensis), "/VERSION"),
            "dotnet": command_version(str(dotnet), "--version"),
        },
        "contracts": build_identity["contracts"],
        "lockfiles": lockfiles,
        "source_archive": file_record(source_archive),
        "payload": {
            "runtime": "electron-protected-asar",
            "bytes": payload_bytes,
            "required_free_mb": required_free_mb,
            "files": payload_files,
        },
        "artifacts": {
            "setup": file_record(setup),
            "recovery_helper": file_record(recovery),
            "update_helper": file_record(update_helper),
            "update_payload": update_payload_record,
            "update_file_manifest": file_record(update_file_manifest_copy),
            "embedded_setup_engine": engine_manifest,
            "pe_resource_evidence": file_record(pe_resource_evidence),
            "crash_recovery_evidence": file_record(crash_recovery_evidence),
            "protected_payload_security": file_record(protected_payload_security),
            "official_logo_sha256": sha256(logo),
            "source_encoding": "utf-8-bom",
        },
        "signing": {
            "status": "unsigned",
            "algorithm": "Ed25519",
            "key_id": os.environ.get("JF_RELEASE_SIGNING_KEY_ID") or None,
            "authenticode_required": False,
        },
        "workflow": {
            "repository": github_repository or None,
            "run_id": github_run_id or None,
            "url": workflow_url,
        },
        "sbom": {"sha256": None},
        "attestation": {"reference": None},
        "test_groups": test_evidence["groups"],
    }
    manifest_text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (output / "BUILD-MANIFEST.json").write_text(manifest_text, encoding="utf-8")
    publish_staging_output(output, final_output)
    _ACTIVE_STAGING_OUTPUT = None
    # Keep the machine-readable console output compatible with Windows
    # runners whose inherited stdout encoding is a legacy code page.
    print(json.dumps(manifest, ensure_ascii=True, indent=2))
    return 0


def main() -> int:
    global _ACTIVE_STAGING_OUTPUT
    try:
        return _main()
    finally:
        staging = _ACTIVE_STAGING_OUTPUT
        _ACTIVE_STAGING_OUTPUT = None
        if staging and staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
