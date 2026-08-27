from __future__ import annotations

import hashlib
import importlib.util
import json
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "source" / "installer" / "build_windows.py"
SPEC = importlib.util.spec_from_file_location("justfun_installer_builder", BUILDER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Could not load the native installer builder.")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def minimal_asar() -> tuple[bytes, str]:
    header_text = '{"files":{}}'
    header_bytes = header_text.encode("utf-8")
    padding = b"\0" * ((4 - ((4 + len(header_bytes)) % 4)) % 4)
    pickle_payload = struct.pack("<I", len(header_bytes)) + header_bytes + padding
    header_pickle = struct.pack("<I", len(pickle_payload)) + pickle_payload
    size_pickle = struct.pack("<II", 4, len(header_pickle))
    return size_pickle + header_pickle, hashlib.sha256(header_bytes).hexdigest().upper()


class InstallerBuilderUnitTests(unittest.TestCase):
    def make_release_inputs(self, root: Path) -> tuple[Path, Path, Path, Path]:
        payload = root / "payload"
        resources = payload / "resources"
        resources.mkdir(parents=True)
        (payload / "version").write_text("7.8.4\n", encoding="utf-8")
        archive_bytes, archive_header_hash = minimal_asar()
        (resources / "app.asar").write_bytes(archive_bytes)
        archive_hash = hashlib.sha256(archive_bytes).hexdigest().upper()
        write_json(resources / "justfun-security.json", {
            "schema": 3,
            "archive": "app.asar",
            "archive_sha256": archive_hash,
            "archive_header_sha256": archive_header_hash,
            "windows_integrity_resource": "INTEGRITY/ELECTRONASAR",
            "executable_branding": "JustFun Логистика 7.8.4",
            "release_contract_schema": 1,
            "product_id": "justfun-logistics",
            "product_version": "7.8.4",
            "loose_application_directory_present": False,
            "integrity_model": "electron-asar-header-sha256",
            "fuses": dict(BUILDER.REQUIRED_PROTECTED_FUSES),
        })
        release_contract = {
            "schema_version": 1,
            "product_id": "justfun-logistics",
            "product_name": "JustFun Логистика",
            "version": "7.8.4",
            "release_status": "release-candidate",
            "supported_channels": ["stable", "staging"],
            "contracts": {"update_manifest": 1},
            "service_versions": {"desktop": "7.8.4"},
            "windows": {"architecture": "x64", "install_scope": "per-user", "authenticode_required": False},
        }
        release_contract_bytes = json.dumps(release_contract, ensure_ascii=False).encode("utf-8")
        identity = root / "BUILD-IDENTITY.json"
        write_json(identity, {
            "schema_version": 1,
            "product_id": "justfun-logistics",
            "product_name": "JustFun Логистика",
            "version": "7.8.4",
            "channel": "stable",
            "release_status": release_contract["release_status"],
            "commit_sha": "a" * 40,
            "source_tree": "b" * 40,
            "build_id": "jf-7.8.4-aaaaaaaaaaaa",
            "release_contract_sha256": hashlib.sha256(release_contract_bytes).hexdigest(),
            "source_dirty": False,
            "contracts": release_contract["contracts"],
            "service_versions": release_contract["service_versions"],
            "windows": release_contract["windows"],
        })
        evidence = root / "PREBUILD-TEST-RESULTS.json"
        write_json(evidence, {
            "schema_version": 1,
            "commit_sha": "a" * 40,
            "groups": [
                {"id": group_id, "status": "passed"}
                for group_id in sorted(BUILDER.REQUIRED_PREBUILD_GROUPS)
            ],
        })
        source_archive = root / "SOURCE.zip"
        with zipfile.ZipFile(source_archive, "w") as archive:
            archive.comment = b"a" * 40
            archive.writestr("source/application/release.json", release_contract_bytes)
        return payload, identity, source_archive, evidence

    def test_release_inputs_are_bound_to_payload_source_and_tests(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            inputs = self.make_release_inputs(Path(temporary))
            version, identity, evidence, security = BUILDER.verify_release_inputs(*inputs)
            self.assertEqual(version, "7.8.4")
            self.assertEqual(identity["commit_sha"], "a" * 40)
            self.assertEqual(evidence["groups"][0]["status"], "passed")
            self.assertEqual(security["archive_sha256"], hashlib.sha256(minimal_asar()[0]).hexdigest().upper())

    def test_tampered_protected_payload_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            inputs = self.make_release_inputs(Path(temporary))
            (inputs[0] / "resources" / "app.asar").write_bytes(b"tampered")
            with self.assertRaisesRegex(RuntimeError, "app.asar differs"):
                BUILDER.verify_release_inputs(*inputs)

    def test_failed_or_duplicate_prebuild_group_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            inputs = self.make_release_inputs(Path(temporary))
            write_json(inputs[3], {
                "schema_version": 1,
                "commit_sha": "a" * 40,
                "groups": [
                    {"id": "security", "status": "passed"},
                    {"id": "security", "status": "failed"},
                ],
            })
            with self.assertRaisesRegex(RuntimeError, "incomplete, duplicated or failed"):
                BUILDER.verify_release_inputs(*inputs)

    def test_incomplete_prebuild_group_set_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            inputs = self.make_release_inputs(Path(temporary))
            write_json(inputs[3], {
                "schema_version": 1,
                "commit_sha": "a" * 40,
                "groups": [{"id": "security", "status": "passed"}],
            })
            with self.assertRaisesRegex(RuntimeError, "exact required group set"):
                BUILDER.verify_release_inputs(*inputs)

    def test_stale_source_archive_commit_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            inputs = self.make_release_inputs(Path(temporary))
            with zipfile.ZipFile(inputs[2], "a") as archive:
                archive.comment = b"c" * 40
            with self.assertRaisesRegex(RuntimeError, "Source archive commit differs"):
                BUILDER.verify_release_inputs(*inputs)

    def test_output_is_published_atomically_and_nonempty_target_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            final = root / "installer"
            final.mkdir()
            staging = BUILDER.prepare_staging_output(final)
            (staging / "Orders-Logistics-Setup-7.8.4-Premium.exe").write_bytes(b"MZfixture")
            BUILDER.publish_staging_output(staging, final)
            self.assertEqual((final / "Orders-Logistics-Setup-7.8.4-Premium.exe").read_bytes(), b"MZfixture")
            with self.assertRaisesRegex(RuntimeError, "must be empty"):
                BUILDER.prepare_staging_output(final)

    def test_failed_build_removes_staged_installer(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            final = Path(temporary) / "installer"
            staged: list[Path] = []

            def fail_after_writing_setup() -> int:
                staging = BUILDER.prepare_staging_output(final)
                BUILDER._ACTIVE_STAGING_OUTPUT = staging
                staged.append(staging)
                (staging / "Orders-Logistics-Setup-7.8.4-Premium.exe").write_bytes(b"MZunverified")
                raise RuntimeError("mandatory post-build gate failed")

            with mock.patch.object(BUILDER, "_main", side_effect=fail_after_writing_setup):
                with self.assertRaisesRegex(RuntimeError, "mandatory post-build gate failed"):
                    BUILDER.main()
            self.assertFalse(staged[0].exists())
            self.assertFalse(final.exists())

    def test_mandatory_post_build_gates_have_no_skip_switch(self) -> None:
        source = BUILDER_PATH.read_text(encoding="utf-8")
        self.assertIn('ROOT / "verify_pe_resources.mjs"', source)
        self.assertIn('"installer-crash-recovery-test.ps1"', source)
        self.assertIn('publish_staging_output(output, final_output)', source)
        self.assertNotIn("--skip-pe-resource", source.lower())
        self.assertNotIn("--skip-crash-recovery", source.lower())

    def test_release_manifest_and_owner_package_require_gate_evidence(self) -> None:
        schema = json.loads((ROOT / "release" / "build-manifest.schema.json").read_text(encoding="utf-8"))
        required = set(schema["properties"]["artifacts"]["required"])
        self.assertTrue({"pe_resource_evidence", "crash_recovery_evidence", "protected_payload_security"} <= required)
        verifier = (ROOT / "tools" / "release" / "verify-build-manifest.mjs").read_text(encoding="utf-8")
        self.assertIn("PE resource evidence differs", verifier)
        self.assertIn("crash-recovery evidence is not bound", verifier)
        self.assertIn("crash-recovery runtime probe is invalid", verifier)
        package = (ROOT / "tools" / "package-owner-rc.ps1").read_text(encoding="utf-8")
        self.assertIn("PE-RESOURCE-QA.json", package)
        self.assertIn("INSTALLER-CRASH-RECOVERY-QA.json", package)
        self.assertIn("PROTECTED-PAYLOAD-SECURITY.json", package)
        self.assertIn("path escapes installer directory", verifier)


if __name__ == "__main__":
    unittest.main(verbosity=2)
