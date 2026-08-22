#!/usr/bin/env python3
"""Build native JustFun Setup, Recovery and Uninstall modules on Windows."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import math
import re
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")


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


def main() -> int:
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
    output = args.output_dir.resolve()
    node_modules = args.node_modules.resolve()
    build_identity_path = args.build_identity.resolve()
    source_archive = args.source_archive.resolve()
    test_evidence_path = args.test_evidence.resolve()
    makensis = find_makensis(args.makensis)
    if bool(args.setup_engine) != bool(args.recovery):
        raise RuntimeError("--setup-engine and --recovery must be supplied together.")
    reusable_setup_engine = args.setup_engine.resolve() if args.setup_engine else None
    reusable_recovery = args.recovery.resolve() if args.recovery else None
    if reusable_setup_engine and (not reusable_setup_engine.is_file() or not reusable_recovery.is_file()):
        raise RuntimeError("Reusable setup engine or Recovery file is missing.")
    for required_input in (build_identity_path, source_archive, test_evidence_path):
        if not required_input.is_file():
            raise RuntimeError(f"Required release evidence is missing: {required_input}")
    output.mkdir(parents=True, exist_ok=True)

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
    version = (payload / "version").read_text(encoding="utf-8-sig").strip()
    if not SEMVER.fullmatch(version):
        raise RuntimeError("Payload version is not valid SemVer.")
    build_identity = json.loads(build_identity_path.read_text(encoding="utf-8-sig"))
    if build_identity.get("version") != version:
        raise RuntimeError("Build identity version differs from the protected payload.")
    if build_identity.get("source_dirty") is not False:
        raise RuntimeError("Build identity does not describe a clean source tree.")
    test_evidence = json.loads(test_evidence_path.read_text(encoding="utf-8-sig"))
    if test_evidence.get("commit_sha") != build_identity.get("commit_sha"):
        raise RuntimeError("Test evidence commit differs from the build identity.")
    if not test_evidence.get("groups") or any(item.get("status") != "passed" for item in test_evidence["groups"]):
        raise RuntimeError("Required pre-build test evidence is incomplete or failed.")
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
    (output / "BUILD-MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    # Keep the machine-readable console output compatible with Windows
    # runners whose inherited stdout encoding is a legacy code page.
    print(json.dumps(manifest, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
