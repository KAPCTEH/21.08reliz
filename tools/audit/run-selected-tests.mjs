#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [impactArg, outputArg = "selected-test-results.json"] = process.argv.slice(2);
if (!impactArg) {
  console.error("Usage: node tools/audit/run-selected-tests.mjs <audit-impact.json> [output.json]");
  process.exit(2);
}
const impact = JSON.parse(await readFile(path.resolve(impactArg), "utf8"));
const selected = impact.selected_tests.filter(test => test.runnable_in_pr);
const advisoryFailures = new Set([
  "JF-TEST-ENTITY-BOOTSTRAP-MERGE-UNIT",
  "JF-TEST-REG-REVISION-TEST",
]);
const results = [];
const sanitize = value => String(value || "")
  .replace(/\b\d{6,14}:[A-Za-z0-9_-]{30,}\b/g, "<telegram-token>")
  .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer <redacted>")
  .replace(/\b(api[_ -]?key|password|secret|token)\s*[=:]\s*\S+/gi, "$1=<redacted>");
for (const test of selected) {
  const [command, ...args] = test.command.trim().split(/\s+/);
  const started = new Date();
  const run = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  results.push({
    id: test.id,
    command: test.command,
    started_at_utc: started.toISOString(),
    completed_at_utc: new Date().toISOString(),
    exit_code: run.status,
    signal: run.signal,
    error: run.error?.message || null,
    status: run.status === 0 && !run.error ? "PASS" : "FAIL",
    merge_blocking: run.status !== 0 && !run.error ? !advisoryFailures.has(test.id) : Boolean(run.error) || !advisoryFailures.has(test.id),
    stdout_tail: sanitize(run.stdout).slice(-2000),
    stderr_tail: sanitize(run.stderr).slice(-2000),
  });
}
const report = {
  schema_version: 1,
  generated_at_utc: new Date().toISOString(),
  selected_count: impact.selected_tests.length,
  runnable_count: selected.length,
  skipped_count: impact.selected_tests.length - selected.length,
  passed: results.filter(result => result.status === "PASS").length,
  failed: results.filter(result => result.status === "FAIL").length,
  blocking_failed: results.filter(result => result.status === "FAIL" && result.merge_blocking).length,
  results,
};
await writeFile(path.resolve(outputArg), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ selected: report.selected_count, runnable: report.runnable_count, passed: report.passed, failed: report.failed, blockingFailed: report.blocking_failed }, null, 2));
if (report.blocking_failed) process.exitCode = 1;
