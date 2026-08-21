#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [ledgerArg, findingId, outputArg = "finding-verification.json"] = process.argv.slice(2);
if (!ledgerArg || !/^JF-AUDIT-\d{4}$/.test(findingId || "")) {
  console.error("Usage: node tools/audit/verify-finding.mjs <ledger-root> <JF-AUDIT-NNNN> [output.json]");
  process.exit(2);
}
const ledger = path.resolve(ledgerArg);
const finding = JSON.parse(await readFile(path.join(ledger, "findings", `${findingId}.json`), "utf8"));
const commands = {
  "JF-AUDIT-0001": ["node", "tests/reg-entity-source-contract.cjs"],
  "JF-AUDIT-0002": ["node", "tests/entity-bootstrap-merge-unit.cjs"],
  "JF-AUDIT-0003": ["python", "tests/reg-revision-test.py"],
};
const issueMatch = /\/issues\/(\d+)$/.exec(finding.issue || "");
if (!issueMatch) throw new Error(`${findingId} is not linked to a GitHub Issue`);
const command = commands[findingId];
let run = null;
let state = "BLOCKED_MANUAL_VERIFICATION";
if (command) {
  run = spawnSync(command[0], command.slice(1), { cwd: process.cwd(), encoding: "utf8", windowsHide: true, shell: false, timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
  state = run.status === 0 && !run.error ? "VERIFIED" : "FAILED";
}
const report = {
  schema_version: 1,
  generated_at_utc: new Date().toISOString(),
  finding_id: findingId,
  issue_number: Number(issueMatch[1]),
  source_commit: process.env.GITHUB_SHA || null,
  verification_contract: finding.verification_contract,
  command: command?.join(" ") || null,
  state,
  exit_code: run?.status ?? null,
  stdout_tail: String(run?.stdout || "").slice(-2000),
  stderr_tail: String(run?.stderr || "").slice(-2000),
  limitation: command ? null : "Live/deployment or metric-reduction evidence requires an explicitly approved environment and cannot be inferred from a passing source test.",
};
await writeFile(path.resolve(outputArg), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (state !== "VERIFIED") process.exitCode = 1;
