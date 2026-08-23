#!/usr/bin/env python3
"""Run every safe UI button in a fresh renderer process with a hard timeout."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "tests" / "runtime-smoke.mjs"


def source_manifest(web_root: Path) -> dict:
    files = sorted(path for path in web_root.rglob("*") if path.is_file())
    files.extend([RUNTIME, Path(__file__).resolve()])
    entries = []
    for path in sorted(set(files)):
        content = path.read_bytes()
        entries.append({
            "path": path.relative_to(ROOT).as_posix(),
            "bytes": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        })
    encoded = "\n".join(f"{item['path']}\0{item['bytes']}\0{item['sha256']}" for item in entries).encode("utf-8")
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=False
    )
    relative_root = web_root.relative_to(ROOT).as_posix()
    status = subprocess.run(
        ["git", "status", "--porcelain=v1", "--", relative_root],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=False,
    )
    diff = subprocess.run(
        ["git", "diff", "--binary", "HEAD", "--", relative_root],
        cwd=ROOT, capture_output=True, check=False,
    )
    dirty_files = []
    if status.returncode == 0:
        dirty_files = sorted(
            line[3:].replace("\\", "/")
            for line in status.stdout.splitlines()
            if len(line) > 3
        )
    return {
        "repositoryCommit": commit.stdout.strip() if commit.returncode == 0 else None,
        "sourceTreeDirty": bool(dirty_files),
        "sourceDirtyFiles": dirty_files,
        "sourceDiffSha256": hashlib.sha256(diff.stdout).hexdigest() if diff.returncode == 0 else None,
        "sourceTreeSha256": hashlib.sha256(encoded).hexdigest(),
        "sourceFiles": entries,
    }


def run_runtime(web_root: Path, mode: str, edition: str, offset: int | None = None, timeout: int = 60) -> tuple[subprocess.CompletedProcess[str], dict]:
    env = os.environ.copy()
    if edition == "full":
        env["JF_TEST_EDITION"] = "full"
    else:
        env.pop("JF_TEST_EDITION", None)
    if offset is not None:
        env["JF_CLICK_OFFSET"] = str(offset)
        env["JF_CLICK_LIMIT"] = "1"
    completed = subprocess.run(
        ["node", str(RUNTIME), str(web_root), mode],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"runtime-smoke returned invalid JSON: {error}; stderr={completed.stderr[-1000:]}") from error
    return completed, payload


def test_candidate(web_root: Path, edition: str, candidate: dict, timeout: int) -> dict:
    started = time.monotonic()
    index = int(candidate["index"])
    try:
        completed, payload = run_runtime(web_root, "click-all", edition, index, timeout)
    except subprocess.TimeoutExpired:
        return {**candidate, "status": "timeout", "seconds": round(time.monotonic() - started, 3), "error": f"Не завершилась за {timeout} секунд"}
    except Exception as error:  # noqa: BLE001 - test report must retain each isolated failure
        return {**candidate, "status": "harness_error", "seconds": round(time.monotonic() - started, 3), "error": str(error)}

    pressed = (payload.get("buttons") or [{}])[0]
    errors = payload.get("errors") or []
    button_failures = payload.get("buttonFailures") or []
    same_button = pressed.get("id") == candidate.get("id") and pressed.get("label") == candidate.get("label")
    if not same_button:
        status = "candidate_drift"
    elif completed.returncode != 0 or errors or button_failures:
        status = "failed"
    elif pressed.get("clicked"):
        status = "passed"
    elif pressed.get("skipped"):
        status = "skipped"
    else:
        status = "not_clicked"
    return {
        **candidate,
        "status": status,
        "seconds": round(time.monotonic() - started, 3),
        "returnCode": completed.returncode,
        "pressed": pressed,
        "errors": errors,
        "buttonFailures": button_failures,
        "stderr": completed.stderr[-1000:],
    }


def parse_indices(value: str) -> set[int]:
    selected: set[int] = set()
    for part in value.split(","):
        token = part.strip()
        if not token:
            continue
        if "-" in token:
            start_text, end_text = token.split("-", 1)
            start, end = int(start_text), int(end_text)
            if start < 0 or end < start:
                raise argparse.ArgumentTypeError(f"Invalid index range: {token}")
            selected.update(range(start, end + 1))
        else:
            index = int(token)
            if index < 0:
                raise argparse.ArgumentTypeError(f"Invalid index: {token}")
            selected.add(index)
    return selected


def write_report_atomic(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp-{os.getpid()}")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    for attempt in range(20):
        try:
            os.replace(temporary, path)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.05 * (attempt + 1))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("web_root", type=Path)
    parser.add_argument("--edition", choices=("demo", "full"), default="demo")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--indices", default="", help="Candidate indexes/ranges, for example 0-4,8,10-12")
    parser.add_argument("--report", type=Path, help="Atomically update a JSON report after every completed candidate")
    parser.add_argument("--list-only", action="store_true", help="Write the full source UI control inventory without clicking controls")
    args = parser.parse_args()
    web_root = args.web_root.resolve()
    try:
        web_root_label = web_root.relative_to(ROOT).as_posix()
    except ValueError as error:
        raise RuntimeError("web_root must be inside the canonical repository") from error

    listed_process, listed = run_runtime(web_root, "list-buttons", args.edition, timeout=max(args.timeout, 90))
    if listed_process.returncode != 0 or listed.get("errors"):
        raise RuntimeError(f"Cannot enumerate buttons: {listed.get('errors') or listed_process.stderr}")
    candidates = listed.get("buttonCandidates") or []
    if args.list_only:
        inventory = listed.get("buttonInventory") or []
        controls = listed.get("controlInventory") or []
        report = {
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "edition": args.edition,
            "webRoot": web_root_label,
            "mode": "source-inventory",
            "complete": True,
            **source_manifest(web_root),
            "summary": {
                "renderedButtons": len(inventory),
                "renderedControls": len(controls),
                "uniqueSafeCandidates": len(candidates),
                "destructiveOrExpensive": sum(bool(item.get("destructiveOrExpensive")) for item in inventory),
                "dynamic": sum(bool(item.get("dynamic")) for item in inventory),
                "disabled": sum(bool(item.get("disabled")) for item in inventory),
                "hidden": sum(bool(item.get("hidden")) for item in inventory),
                "controlsWithoutStableHook": sum(not bool(item.get("hook")) for item in controls),
                "controlsWithoutContainer": sum(
                    not bool((item.get("scope") or {}).get("id")) and not bool(item.get("containerId"))
                    for item in controls
                ),
            },
            "buttonInventory": inventory,
            "controlInventory": controls,
            "buttonCandidates": candidates,
        }
        if args.report:
            write_report_atomic(args.report.resolve(), report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    if args.indices.strip():
        selected = parse_indices(args.indices)
        candidates = [item for item in candidates if int(item["index"]) in selected]

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as executor:
        futures = {executor.submit(test_candidate, web_root, args.edition, item, args.timeout): item for item in candidates}
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            results.sort(key=lambda item: int(item["index"]))
            partial = {
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "edition": args.edition,
                "webRoot": web_root_label,
                "complete": len(results) == len(candidates),
                "summary": {
                    "selected": len(candidates),
                    "completed": len(results),
                    "passed": sum(item["status"] == "passed" for item in results),
                    "skipped": sum(item["status"] == "skipped" for item in results),
                    "failed": sum(item["status"] in {"timeout", "harness_error", "candidate_drift", "failed", "not_clicked"} for item in results),
                },
                "results": results,
            }
            if args.report:
                write_report_atomic(args.report.resolve(), partial)
            print(f"[{len(results)}/{len(candidates)}] index={result['index']} status={result['status']} seconds={result['seconds']}", file=sys.stderr, flush=True)

    failing_statuses = {"timeout", "harness_error", "candidate_drift", "failed", "not_clicked"}
    failures = [item for item in results if item["status"] in failing_statuses]
    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "edition": args.edition,
        "webRoot": web_root_label,
        "summary": {
            "candidates": len(results),
            "passed": sum(item["status"] == "passed" for item in results),
            "skipped": sum(item["status"] == "skipped" for item in results),
            "failed": len(failures),
            "timeouts": sum(item["status"] == "timeout" for item in results),
        },
        "failures": failures,
        "results": results,
    }
    if args.report:
        write_report_atomic(args.report.resolve(), {**report, "complete": True})
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
