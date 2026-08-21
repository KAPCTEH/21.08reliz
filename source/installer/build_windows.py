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
from pathlib import Path


ROOT = Path(__file__).resolve().parent
VERSION = "7.8.3"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run(*args: str | os.PathLike[str]) -> None:
    subprocess.run([str(value) for value in args], check=True)


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
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)}


def write_unicode_nsis_source(source: Path, destination: Path) -> Path:
    """Force NSIS to consume UTF-8 with BOM regardless of the runner code page."""
    destination.write_text(
        source.read_text(encoding="utf-8"),
        encoding="utf-8-sig",
        newline="\n",
    )
    return destination


def main() -> int:
    if os.name != "nt":
        raise RuntimeError("The native installer build must run on Windows.")

    parser = argparse.ArgumentParser()
    parser.add_argument("--payload-dir", type=Path, required=True)
    parser.add_argument("--logo", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--node-modules", type=Path, required=True)
    parser.add_argument("--makensis")
    parser.add_argument("--setup-engine", type=Path)
    parser.add_argument("--recovery", type=Path)
    args = parser.parse_args()

    payload = args.payload_dir.resolve()
    logo = args.logo.resolve()
    output = args.output_dir.resolve()
    node_modules = args.node_modules.resolve()
    makensis = find_makensis(args.makensis)
    if bool(args.setup_engine) != bool(args.recovery):
        raise RuntimeError("--setup-engine and --recovery must be supplied together.")
    reusable_setup_engine = args.setup_engine.resolve() if args.setup_engine else None
    reusable_recovery = args.recovery.resolve() if args.recovery else None
    if reusable_setup_engine and (not reusable_setup_engine.is_file() or not reusable_recovery.is_file()):
        raise RuntimeError("Reusable setup engine or Recovery file is missing.")
    output.mkdir(parents=True, exist_ok=True)

    required = [
        payload / "OrdersLogistics.exe",
        payload / "resources" / "app.asar",
        payload / "resources" / "justfun-security.json",
        payload / "version",
        payload / "LICENSE",
        payload / "LICENSES.chromium.html",
        payload / "THIRD-PARTY-NOTICES.txt",
    ]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError("Missing payload files: " + ", ".join(missing))
    if (payload / "version").read_text(encoding="utf-8-sig").strip() != VERSION:
        raise RuntimeError("Payload version is not 7.8.3.")
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

        recovery = output / f"Orders-Logistics-Recovery-{VERSION}.exe"
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
                f"/DVERSION={VERSION}",
                f"/DASSETS_DIR={assets}",
                f"/DOUT_FILE={recovery}",
                recovery_source,
            )
            shutil.copy2(recovery, payload / "Orders-Logistics-Recovery.exe")
            run(
                makensis,
                "/WX",
                "/V4",
                f"/DVERSION={VERSION}",
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
        )
        premium_executable = publish / "JustFunPremiumSetup.exe"
        if not premium_executable.is_file():
            raise RuntimeError("The premium WPF installer executable was not published.")
        setup = output / f"Orders-Logistics-Setup-{VERSION}-Premium.exe"
        shutil.copy2(premium_executable, setup)

    manifest = {
        "product": "JustFun Логистика",
        "version": VERSION,
        "runtime": "wpf-premium-shell+native-nsis-engine",
        "source_encoding": "utf-8-bom",
        "official_logo_sha256": sha256(logo),
        "payload_bytes": payload_bytes,
        "required_free_mb": required_free_mb,
        "embedded_engine": engine_manifest,
        "files": [
            verify_pe(setup, ()),
            verify_pe(recovery, (b"Nullsoft",)),
        ],
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
