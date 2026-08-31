#!/usr/bin/env python3
"""Unit checks for deterministic release evidence and SPDX generation."""

from __future__ import annotations

import importlib.util
import base64
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools/release/build_release_evidence.py"
SPEC = importlib.util.spec_from_file_location("release_evidence", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
WORK = ROOT / ".release/release-evidence-unit"


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def main() -> None:
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)
    checks = []
    try:
        fixture_version = json.loads(
            (ROOT / "source/application/release.json").read_text(encoding="utf-8")
        )["version"]
        npm_lock = WORK / "package-lock.json"
        nuget_lock = WORK / "packages.lock.json"
        write_json(
            npm_lock,
            {
                "lockfileVersion": 3,
                "packages": {
                    "": {"name": "fixture", "version": "1.0.0"},
                    "node_modules/@scope/example": {
                        "version": "2.3.4",
                        "license": "MIT",
                        "integrity": "sha512-" + base64.b64encode(b"n" * 64).decode("ascii"),
                    },
                },
            },
        )
        write_json(
            nuget_lock,
            {
                "version": 1,
                "dependencies": {
                    "net8.0": {
                        "Example.Package": {
                            "type": "Direct",
                            "resolved": "5.6.7",
                            "contentHash": base64.b64encode(b"d" * 64).decode("ascii"),
                        }
                    }
                },
            },
        )
        release = {"product_id": "justfun-logistics", "product_name": "JustFun", "version": fixture_version}
        identity = {
            "commit_sha": "a" * 40,
            "build_id": f"jf-{fixture_version}-aaaaaaaaaaaa",
            "generated_at_utc": "2026-08-23T00:00:00Z",
            "repository": "KAPCTEH/21.08reliz",
        }
        sbom = MODULE.build_spdx(release, identity, [npm_lock, nuget_lock])
        assert sbom["spdxVersion"] == "SPDX-2.3"
        assert len(sbom["packages"]) == 3
        purls = {
            ref["referenceLocator"]
            for package in sbom["packages"]
            for ref in package.get("externalRefs", [])
        }
        assert "pkg:npm/%40scope/example@2.3.4" in purls
        assert "pkg:nuget/Example.Package@5.6.7" in purls
        assert sum(1 for package in sbom["packages"] if package.get("checksums")) == 2
        checks.append("npm-and-nuget-spdx")

        accepted = MODULE.safe_output_directory(WORK / "accepted")
        assert accepted == (WORK / "accepted").resolve()
        try:
            MODULE.safe_output_directory(ROOT / ".release")
            raise AssertionError(".release root was accepted as a destructive output")
        except RuntimeError:
            checks.append("safe-output-boundary")

        archive_source = WORK / "archive"
        archive_source.mkdir()
        (archive_source / "b.txt").write_text("b", encoding="utf-8")
        (archive_source / "a.txt").write_text("a", encoding="utf-8")
        first = WORK / "first.zip"
        second = WORK / "second.zip"
        MODULE.create_deterministic_zip(archive_source, first, identity["generated_at_utc"])
        MODULE.create_deterministic_zip(archive_source, second, identity["generated_at_utc"])
        assert first.read_bytes() == second.read_bytes()
        checks.append("deterministic-archive")

        fixture = WORK / "full"
        installer = fixture / "installer"
        installer.mkdir(parents=True)
        artifact_records = {}
        for key, name in {
            "setup": "fixture-setup.exe",
            "recovery_helper": "fixture-recovery.exe",
            "update_helper": "fixture-helper.exe",
            "update_payload": "fixture-payload.zip",
            "update_file_manifest": "fixture-update-files.json",
            "pe_resource_evidence": "PE-RESOURCE-QA.json",
            "crash_recovery_evidence": "INSTALLER-CRASH-RECOVERY-QA.json",
            "protected_payload_security": "PROTECTED-PAYLOAD-SECURITY.json",
        }.items():
            artifact = installer / name
            artifact.write_bytes((key + "\n").encode("ascii"))
            artifact_records[key] = MODULE.file_record(artifact)
        source_archive = fixture / "source.zip"
        source_archive.write_bytes(b"source archive fixture")
        identity_path = fixture / "identity.json"
        manifest_path = installer / "BUILD-MANIFEST.json"
        results_path = fixture / "test-results.json"
        write_json(
            identity_path,
            {
                **identity,
                "product_id": "justfun-logistics",
                "product_name": "JustFun Логистика",
                "version": fixture_version,
            },
        )
        real_lock = ROOT / "source/application/package-lock.json"
        lock_record = MODULE.file_record(real_lock, ROOT)
        write_json(
            manifest_path,
            {
                "version": fixture_version,
                "commit_sha": identity["commit_sha"],
                "source_archive": MODULE.file_record(source_archive),
                "artifacts": artifact_records,
                "lockfiles": [lock_record],
                "workflow": {"repository": "KAPCTEH/21.08reliz"},
                "sbom": {"sha256": None},
                "attestation": {"reference": None},
            },
        )
        write_json(results_path, {"commit_sha": identity["commit_sha"], "groups": [{"id": "fixture", "status": "passed"}]})
        qa = fixture / "qa"
        qa.mkdir()
        (qa / "proof.json").write_text('{"ok":true}\n', encoding="utf-8")
        output = fixture / "evidence"
        result = subprocess.run(
            [
                sys.executable,
                str(MODULE_PATH),
                "--manifest", str(manifest_path.relative_to(ROOT)),
                "--build-identity", str(identity_path.relative_to(ROOT)),
                "--source-archive", str(source_archive.relative_to(ROOT)),
                "--test-results", str(results_path.relative_to(ROOT)),
                "--installer-dir", str(installer.relative_to(ROOT)),
                "--output-dir", str(output.relative_to(ROOT)),
                "--evidence", f"fixture={qa.relative_to(ROOT)}",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        expected = {
            f"JustFun-{fixture_version}-Setup.exe",
            f"JustFun-{fixture_version}-Recovery.exe",
            f"JustFun-{fixture_version}-UpdateHelper.exe",
            f"JustFun-{fixture_version}-win-x64.zip",
            "PE-RESOURCE-QA.json",
            "INSTALLER-CRASH-RECOVERY-QA.json",
            "PROTECTED-PAYLOAD-SECURITY.json",
            f"JustFun-{fixture_version}-clean-source.zip",
            "SBOM.spdx.json",
            "SHA256SUMS.txt",
            "RELEASE-EVIDENCE.zip",
            "RELEASE-EVIDENCE.zip.sha256",
        }
        assert expected.issubset({path.name for path in output.iterdir() if path.is_file()})
        evidence_index = json.loads((output / "RELEASE-EVIDENCE.json").read_text(encoding="utf-8"))
        assert evidence_index["release_status"] == "NO_GO"
        zip_digest = hashlib.sha256((output / "RELEASE-EVIDENCE.zip").read_bytes()).hexdigest()
        assert (output / "RELEASE-EVIDENCE.zip.sha256").read_text(encoding="utf-8").startswith(zip_digest)
        checks.append("full-evidence-assembly")

        print(json.dumps({"ok": True, "checks": len(checks), "passed": checks}))
    finally:
        if WORK.exists():
            shutil.rmtree(WORK)


if __name__ == "__main__":
    main()
