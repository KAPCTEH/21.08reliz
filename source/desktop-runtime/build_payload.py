#!/usr/bin/env python3
"""Assemble the JustFun Windows payload from Electron and application sources."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")


def load_release_contract(app_dir: Path) -> tuple[dict[str, object], str]:
    contract_path = app_dir / "release.json"
    if not contract_path.is_file():
        raise RuntimeError(f"Release contract is missing: {contract_path}")
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    version = str(contract.get("version", "")).strip()
    if contract.get("product_id") != "justfun-logistics" or not SEMVER.fullmatch(version):
        raise RuntimeError("Release contract product or SemVer is invalid.")
    if contract.get("source_commit_policy") != "resolve_at_build":
        raise RuntimeError("Release contract must resolve the exact commit during the build.")
    service_versions = contract.get("service_versions") or {}
    if service_versions.get("desktop") != version:
        raise RuntimeError("Desktop service version differs from the canonical release version.")
    return contract, version


def runtime_copy_ignore(directory: str, names: list[str]) -> set[str]:
    """Exclude development-only files, including deep native build sources.

    cpu-features is compiled during npm ci. Its deps/cmake/src trees are not
    loaded at runtime, can exceed legacy Windows MAX_PATH in a deep checkout,
    and must not be shipped to customers.
    """
    ignored = set(
        shutil.ignore_patterns(
            "__pycache__", "*.pyc", ".git", ".github",
            "test", "tests", "example", "examples",
            "*.map", "*.ts", "*.c", "*.cc", "*.h", "*.bat",
            "README*", "CHANGELOG*", "CONTRIBUTING*", "PULL_REQUEST_TEMPLATE*",
        )(directory, names)
    )
    normalized = Path(directory).as_posix().lower()
    if normalized.endswith("/node_modules/cpu-features"):
        ignored.update(set(names).intersection({"deps", "cmake", "scripts", "src", "patches", "test"}))
    return ignored


def replace_directory_with_retry(source: Path, target: Path) -> None:
    """Tolerate short Windows AV/indexer locks without losing atomic commit."""
    for attempt in range(12):
        try:
            source.replace(target)
            return
        except PermissionError:
            if attempt == 11:
                raise
            time.sleep(0.25 * (attempt + 1))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-dir", type=Path, required=True)
    parser.add_argument(
        "--electron-dist",
        type=Path,
        default=Path("node_modules/electron/dist"),
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--update-helper", type=Path, required=True)
    args = parser.parse_args()

    app_dir = args.app_dir.resolve()
    electron_dist = args.electron_dist.resolve()
    output_dir = args.output_dir.resolve()
    update_helper = args.update_helper.resolve()
    _, version = load_release_contract(app_dir)
    required_app = [app_dir / "main.js", app_dir / "preload.js", app_dir / "web/index.html", app_dir / "release.json"]
    missing_app = [str(item) for item in required_app if not item.is_file()]
    if missing_app:
        raise RuntimeError("Missing application sources: " + ", ".join(missing_app))
    if not update_helper.is_file() or update_helper.read_bytes()[:2] != b"MZ":
        raise RuntimeError("Verified Windows Update Helper is missing or is not a PE executable.")

    electron_exe = electron_dist / "electron.exe"
    if not electron_exe.is_file() or not (electron_dist / "resources").is_dir():
        raise RuntimeError(
            "Electron Windows runtime is missing. Run npm install in desktop-runtime "
            "on Windows or install the win32-x64 Electron package."
        )
    if output_dir.exists():
        if not output_dir.is_dir():
            raise RuntimeError(f"Output path is not a directory: {output_dir}")
        if any(output_dir.iterdir()):
            raise RuntimeError(f"Output directory is not empty: {output_dir}")
        # Windows cannot atomically rename a prepared directory over an
        # already existing directory, even when the destination is empty.
        # Removing only the verified-empty destination keeps the final
        # sibling rename atomic and avoids a partially assembled payload.
        output_dir.rmdir()

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    # A short system-temp stage avoids Win32 MAX_PATH failures when the source
    # checkout and native dependency trees are both deeply nested. On Windows
    # the system temp and release output normally share the same volume, so the
    # final directory rename remains atomic.
    temp_parent = Path(tempfile.gettempdir()).resolve()
    if os.path.splitdrive(str(temp_parent))[0].lower() != os.path.splitdrive(str(output_dir))[0].lower():
        temp_parent = output_dir.parent
    with tempfile.TemporaryDirectory(prefix="jfpl-", dir=temp_parent) as temp_name:
        temporary = Path(temp_name) / "payload"
        shutil.copytree(electron_dist, temporary)
        target_exe = temporary / "OrdersLogistics.exe"
        (temporary / "electron.exe").replace(target_exe)

        resources = temporary / "resources"
        default_app = resources / "default_app.asar"
        if default_app.exists():
            default_app.unlink()
        staged_app = Path(temp_name) / "application"
        shutil.copytree(
            app_dir,
            staged_app,
            ignore=runtime_copy_ignore,
        )
        helper_identity = {
            "schema_version": 1,
            "file_name": "JustFun-UpdateHelper.exe",
            "bytes": update_helper.stat().st_size,
            "sha256": sha256(update_helper),
        }
        (staged_app / "update" / "helper-identity.json").write_text(
            json.dumps(helper_identity, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        shutil.copy2(update_helper, temporary / helper_identity["file_name"])
        notices = app_dir / "THIRD-PARTY-NOTICES.txt"
        if not notices.is_file():
            raise RuntimeError("THIRD-PARTY-NOTICES.txt is missing from the application sources.")
        shutil.copy2(notices, temporary / "THIRD-PARTY-NOTICES.txt")
        if not (temporary / "LICENSE").is_file() or not (temporary / "LICENSES.chromium.html").is_file():
            raise RuntimeError("Electron or Chromium license notices are missing from the runtime.")
        node = shutil.which("node")
        hardener = Path(__file__).with_name("harden_payload.mjs")
        if not node:
            raise RuntimeError("Node.js is required to create the protected Electron archive.")
        if not hardener.is_file():
            raise RuntimeError(f"Payload hardener is missing: {hardener}")
        protector = Path(__file__).with_name("protect_stage.mjs")
        if not protector.is_file():
            raise RuntimeError(f"Source protector is missing: {protector}")
        subprocess.run(
            [
                node,
                str(protector),
                "--app-dir",
                str(staged_app),
            ],
            check=True,
            cwd=Path(__file__).parent,
        )
        subprocess.run(
            [
                node,
                str(hardener),
                "--app-dir",
                str(staged_app),
                "--resources-dir",
                str(resources),
                "--executable",
                str(target_exe),
            ],
            check=True,
            cwd=Path(__file__).parent,
        )
        if not (resources / "app.asar").is_file() or (resources / "app").exists():
            raise RuntimeError("Protected ASAR packaging did not complete correctly.")
        (temporary / "version").write_text(version + os.linesep, encoding="utf-8")
        replace_directory_with_retry(temporary, output_dir)

    print(output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
