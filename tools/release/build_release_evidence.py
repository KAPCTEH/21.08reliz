#!/usr/bin/env python3
"""Build a truthful, self-contained JustFun release evidence package."""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import re
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


REPOSITORY = Path(__file__).resolve().parents[2]
RELEASE_ROOT = REPOSITORY / ".release"
HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def file_record(path: Path, base: Path | None = None) -> dict[str, object]:
    return {
        "path": path.relative_to(base).as_posix() if base else path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def require_within(path: Path, parent: Path, label: str) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(parent.resolve())
    except ValueError as error:
        raise RuntimeError(f"{label} escapes its allowed directory: {resolved}") from error
    return resolved


def safe_output_directory(path: Path) -> Path:
    resolved = require_within(path, RELEASE_ROOT, "evidence output")
    if resolved == RELEASE_ROOT.resolve():
        raise RuntimeError("Evidence output must be a child of .release, not .release itself.")
    return resolved


def verify_record(record: dict, path: Path, label: str) -> None:
    if not path.is_file():
        raise RuntimeError(f"{label} is missing: {path}")
    if record.get("bytes") != path.stat().st_size:
        raise RuntimeError(f"{label} byte count differs from BUILD-MANIFEST.json")
    expected = str(record.get("sha256") or "")
    if not HEX_SHA256.fullmatch(expected) or sha256(path) != expected:
        raise RuntimeError(f"{label} SHA-256 differs from BUILD-MANIFEST.json")


def package_name_from_npm_path(install_path: str) -> str:
    normalized = install_path.replace("\\", "/")
    marker = "node_modules/"
    if marker not in normalized:
        return ""
    return normalized.rsplit(marker, 1)[1].strip("/")


def integrity_checksum(value: object) -> list[dict[str, str]]:
    if not isinstance(value, str) or "-" not in value:
        return []
    algorithm, encoded = value.split("-", 1)
    algorithm = algorithm.lower()
    spdx_algorithm = {"sha256": "SHA256", "sha384": "SHA384", "sha512": "SHA512"}.get(algorithm)
    if not spdx_algorithm:
        return []
    try:
        digest = base64.b64decode(encoded, validate=True).hex()
    except (ValueError, binascii.Error):
        return []
    expected_bytes = {"SHA256": 32, "SHA384": 48, "SHA512": 64}[spdx_algorithm]
    if len(bytes.fromhex(digest)) != expected_bytes:
        return []
    return [{"algorithm": spdx_algorithm, "checksumValue": digest}]


def npm_components(lockfile: Path) -> list[dict[str, object]]:
    lock = read_json(lockfile)
    components = []
    for install_path, record in (lock.get("packages") or {}).items():
        if not isinstance(record, dict) or not install_path:
            continue
        name = package_name_from_npm_path(str(install_path))
        version = str(record.get("version") or "")
        if not name or not version:
            continue
        purl = f"pkg:npm/{quote(name, safe='/')}@{quote(version, safe='.-_+')}"
        components.append(
            {
                "name": name,
                "version": version,
                "purl": purl,
                "checksums": integrity_checksum(record.get("integrity")),
                "license": record.get("license") if isinstance(record.get("license"), str) else None,
            }
        )
    return components


def nuget_components(lockfile: Path) -> list[dict[str, object]]:
    lock = read_json(lockfile)
    components = []
    for target in (lock.get("dependencies") or {}).values():
        if not isinstance(target, dict):
            continue
        for name, record in target.items():
            if not isinstance(record, dict):
                continue
            version = str(record.get("resolved") or "")
            if not version:
                continue
            purl = f"pkg:nuget/{quote(str(name), safe='.-_')}@{quote(version, safe='.-_+')}"
            components.append(
                {
                    "name": str(name),
                    "version": version,
                    "purl": purl,
                    "checksums": integrity_checksum(
                        f"sha512-{record['contentHash']}" if record.get("contentHash") else None
                    ),
                    "license": None,
                }
            )
    return components


def spdx_id(locator: str) -> str:
    return f"SPDXRef-Package-{hashlib.sha256(locator.encode('utf-8')).hexdigest()[:24]}"


def build_spdx(release: dict, identity: dict, lockfiles: list[Path]) -> dict:
    components: dict[str, dict[str, object]] = {}
    for lockfile in lockfiles:
        parsed = nuget_components(lockfile) if lockfile.name == "packages.lock.json" else npm_components(lockfile)
        for component in parsed:
            components.setdefault(str(component["purl"]), component)

    product_purl = f"pkg:generic/{release['product_id']}@{release['version']}"
    product_id = spdx_id(product_purl)
    packages = [
        {
            "name": release["product_name"],
            "SPDXID": product_id,
            "versionInfo": release["version"],
            "downloadLocation": "NOASSERTION",
            "filesAnalyzed": False,
            "licenseConcluded": "NOASSERTION",
            "licenseDeclared": "NOASSERTION",
            "copyrightText": "NOASSERTION",
            "externalRefs": [
                {
                    "referenceCategory": "PACKAGE-MANAGER",
                    "referenceType": "purl",
                    "referenceLocator": product_purl,
                }
            ],
        }
    ]
    relationships = [
        {
            "spdxElementId": "SPDXRef-DOCUMENT",
            "relationshipType": "DESCRIBES",
            "relatedSpdxElement": product_id,
        }
    ]
    for locator, component in sorted(components.items()):
        package_id = spdx_id(locator)
        package = {
            "name": component["name"],
            "SPDXID": package_id,
            "versionInfo": component["version"],
            "downloadLocation": "NOASSERTION",
            "filesAnalyzed": False,
            "licenseConcluded": "NOASSERTION",
            "licenseDeclared": "NOASSERTION",
            "copyrightText": "NOASSERTION",
            "externalRefs": [
                {
                    "referenceCategory": "PACKAGE-MANAGER",
                    "referenceType": "purl",
                    "referenceLocator": locator,
                }
            ],
        }
        if component["checksums"]:
            package["checksums"] = component["checksums"]
        if component["license"]:
            package["comment"] = f"Package lock declared license: {component['license']}"
        packages.append(package)
        relationships.append(
            {
                "spdxElementId": product_id,
                "relationshipType": "DEPENDS_ON",
                "relatedSpdxElement": package_id,
            }
        )

    repository = identity.get("workflow_repository") or identity.get("repository") or "justfun/local"
    namespace = f"https://github.com/{repository}/sbom/{identity['commit_sha']}/{identity['build_id']}"
    return {
        "spdxVersion": "SPDX-2.3",
        "dataLicense": "CC0-1.0",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": f"{release['product_name']} {release['version']}",
        "documentNamespace": namespace,
        "creationInfo": {
            "created": identity["generated_at_utc"],
            "creators": ["Tool: justfun-build-release-evidence/1.0.0"],
        },
        "packages": packages,
        "relationships": relationships,
    }


def write_markdown(output: Path, name: str, text: str) -> None:
    (output / name).write_text(text.strip() + "\n", encoding="utf-8")


def zip_timestamp(iso_timestamp: str) -> tuple[int, int, int, int, int, int]:
    parsed = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00")).astimezone(timezone.utc)
    year = max(1980, parsed.year)
    return (year, parsed.month, parsed.day, parsed.hour, parsed.minute, parsed.second - parsed.second % 2)


def create_deterministic_zip(source: Path, destination: Path, timestamp: str) -> None:
    stamp = zip_timestamp(timestamp)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for item in sorted(path for path in source.rglob("*") if path.is_file() and path != destination):
            relative = item.relative_to(source).as_posix()
            info = zipfile.ZipInfo(relative, date_time=stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, item.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def parse_evidence(values: list[str]) -> list[tuple[str, Path]]:
    result = []
    names = set()
    for value in values:
        if "=" not in value:
            raise RuntimeError(f"Invalid --evidence value: {value}")
        name, raw_path = value.split("=", 1)
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", name) or name in names:
            raise RuntimeError(f"Invalid or duplicate evidence name: {name}")
        path = require_within((REPOSITORY / raw_path), REPOSITORY, f"evidence {name}")
        if not path.is_dir():
            raise RuntimeError(f"Evidence directory is missing: {path}")
        names.add(name)
        result.append((name, path))
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--build-identity", required=True)
    parser.add_argument("--source-archive", required=True)
    parser.add_argument("--test-results", required=True)
    parser.add_argument("--installer-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--attestation-reference", default="")
    parser.add_argument("--evidence", action="append", default=[])
    args = parser.parse_args()

    manifest_path = require_within(REPOSITORY / args.manifest, REPOSITORY, "manifest")
    identity_path = require_within(REPOSITORY / args.build_identity, REPOSITORY, "build identity")
    source_archive = require_within(REPOSITORY / args.source_archive, REPOSITORY, "source archive")
    test_results_path = require_within(REPOSITORY / args.test_results, REPOSITORY, "test results")
    installer_dir = require_within(REPOSITORY / args.installer_dir, REPOSITORY, "installer directory")
    output = safe_output_directory(REPOSITORY / args.output_dir)
    evidence_directories = parse_evidence(args.evidence)

    release = read_json(REPOSITORY / "source/application/release.json")
    identity = read_json(identity_path)
    manifest = read_json(manifest_path)
    test_results = read_json(test_results_path)
    for label, value in (("manifest", manifest), ("build identity", identity), ("test results", test_results)):
        if value.get("commit_sha") != identity.get("commit_sha"):
            raise RuntimeError(f"{label} commit SHA differs from the build identity")
    if manifest.get("version") != release.get("version") or identity.get("version") != release.get("version"):
        raise RuntimeError("Release version differs across release identity inputs")
    if not all(group.get("status") == "passed" for group in test_results.get("groups", [])):
        raise RuntimeError("Prebuild test evidence contains a non-passing group")
    verify_record(manifest["source_archive"], source_archive, "source archive")

    artifacts = {
        f"JustFun-{release['version']}-Setup.exe": manifest["artifacts"]["setup"],
        f"JustFun-{release['version']}-Recovery.exe": manifest["artifacts"]["recovery_helper"],
        f"JustFun-{release['version']}-UpdateHelper.exe": manifest["artifacts"]["update_helper"],
        f"JustFun-{release['version']}-win-x64.zip": manifest["artifacts"]["update_payload"],
        "UPDATE-FILES.json": manifest["artifacts"]["update_file_manifest"],
    }
    verified_sources: dict[str, Path] = {}
    for destination_name, record in artifacts.items():
        source = require_within(installer_dir / str(record["path"]), installer_dir, destination_name)
        verify_record(record, source, destination_name)
        verified_sources[destination_name] = source

    lockfiles = []
    for record in manifest.get("lockfiles", []):
        lockfile = require_within(REPOSITORY / str(record["path"]), REPOSITORY, "lockfile")
        verify_record(record, lockfile, f"lockfile {record['path']}")
        lockfiles.append(lockfile)

    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for destination_name, source in verified_sources.items():
        shutil.copy2(source, output / destination_name)
    shutil.copy2(source_archive, output / f"JustFun-{release['version']}-clean-source.zip")
    shutil.copy2(identity_path, output / "BUILD-IDENTITY.json")
    shutil.copy2(test_results_path, output / "PREBUILD-TEST-RESULTS.json")

    sbom = build_spdx(release, {**identity, "repository": manifest.get("workflow", {}).get("repository")}, lockfiles)
    sbom_path = output / "SBOM.spdx.json"
    write_json(sbom_path, sbom)
    manifest["sbom"] = {"sha256": sha256(sbom_path)}
    manifest["attestation"] = {"reference": args.attestation_reference or None}
    write_json(manifest_path, manifest)
    shutil.copy2(manifest_path, output / "BUILD-MANIFEST.json")

    version = release["version"]
    commit = identity["commit_sha"]
    write_markdown(
        output,
        "RELEASE-NOTES.md",
        f"""
# JustFun {version}

Сборка: `{identity['build_id']}`  
Исходный коммит: `{commit}`

- Безопасный полный пакет Windows с проверкой целостности.
- Встроенный механизм загрузки, применения и автоматического отката обновлений.
- Центр обновлений с прогрессом, историей и понятными вариантами установки.

Этот пакет является техническим кандидатом. Публичный выпуск разрешён только после подписанного каталога и живой приёмки.
""",
    )
    write_markdown(
        output,
        "KNOWN-LIMITATIONS.md",
        """
# Известные ограничения

- Windows Authenticode не используется; Windows может показать «Неизвестный издатель». Это принято владельцем и не является блокером.
- Автообновление остаётся выключенным до установки настоящего доверенного Ed25519-ключа и публикации подписанного каталога.
- Живая проверка нескольких пользователей, устройств и складов не заменяется данным автоматическим пакетом доказательств.
""",
    )
    write_markdown(
        output,
        "ROLLBACK-RUNBOOK.md",
        """
# Краткая инструкция отката

1. Немедленно остановить rollout новым подписанным каталогом `halt` с увеличенной последовательностью.
2. Не заменять и не удалять ранее опубликованный каталог или payload.
3. Для возврата выпустить новую подписанную директиву `rollback`, точно указав отзываемую и целевую версии.
4. Проверить `/health`, получить каталог с клиента staging и выполнить Windows update/rollback gate.
5. После подтверждения восстановить rollout по этапам 5% → 25% → 100%.

Если новый клиент не подтвердил health marker, Update Helper автоматически возвращает предыдущий payload.
""",
    )
    write_markdown(
        output,
        "LIVE-ACCEPTANCE-REPORT.md",
        f"""
# Живая приёмка JustFun {version}

Статус: **NOT_RUN**  
Коммит: `{commit}`

Не подтверждены данным CI-прогоном: два устройства, два пользователя, два изолированных склада, четыре заказа, маршруты, статусы, водители, отчётность, Telegram и VPS/PostgreSQL. До заполнения этого отчёта результат всего ТЗ №2 остаётся `NO-GO`.
""",
    )

    qa_root = output / "qa"
    for name, source in evidence_directories:
        shutil.copytree(source, qa_root / name)

    technical_status = "passed"
    release_status = "NO_GO"
    index = {
        "schema_version": 1,
        "product_id": release["product_id"],
        "version": version,
        "build_id": identity["build_id"],
        "commit_sha": commit,
        "technical_gate": technical_status,
        "release_status": release_status,
        "signed_catalog_included": False,
        "live_acceptance": "NOT_RUN",
        "attestation_reference": args.attestation_reference or None,
        "artifacts": [],
    }
    for path in sorted(item for item in output.rglob("*") if item.is_file()):
        if path.name in {"SHA256SUMS.txt", "RELEASE-EVIDENCE.zip", "RELEASE-EVIDENCE.zip.sha256", "RELEASE-EVIDENCE.json"}:
            continue
        index["artifacts"].append(file_record(path, output))
    write_json(output / "RELEASE-EVIDENCE.json", index)

    checksum_targets = sorted(
        path for path in output.rglob("*")
        if path.is_file() and path.name not in {"SHA256SUMS.txt", "RELEASE-EVIDENCE.zip", "RELEASE-EVIDENCE.zip.sha256"}
    )
    checksum_text = "".join(f"{sha256(path)}  {path.relative_to(output).as_posix()}\n" for path in checksum_targets)
    (output / "SHA256SUMS.txt").write_text(checksum_text, encoding="utf-8", newline="\n")
    archive = output / "RELEASE-EVIDENCE.zip"
    create_deterministic_zip(output, archive, identity["generated_at_utc"])
    (output / "RELEASE-EVIDENCE.zip.sha256").write_text(
        f"{sha256(archive)}  RELEASE-EVIDENCE.zip\n", encoding="utf-8", newline="\n"
    )

    result = {
        "ok": True,
        "version": version,
        "commit_sha": commit,
        "spdx_packages": len(sbom["packages"]),
        "evidence_files": sum(1 for path in output.rglob("*") if path.is_file()),
        "release_status": release_status,
        "output": output.relative_to(REPOSITORY).as_posix(),
    }
    print(json.dumps(result, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI must fail closed with one clear message.
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=True), file=sys.stderr)
        raise SystemExit(1)
