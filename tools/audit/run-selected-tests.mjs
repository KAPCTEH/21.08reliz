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
const results = [];
const gitRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: process.cwd(),
  encoding: "utf8",
  windowsHide: true,
});
if (gitRoot.status !== 0 || !gitRoot.stdout.trim()) {
  throw new Error(gitRoot.stderr || "Cannot resolve repository root");
}
const repositoryRoot = path.resolve(gitRoot.stdout.trim());
const sanitize = value => String(value || "")
  .replace(/\b\d{6,14}:[A-Za-z0-9_-]{30,}\b/g, "<telegram-token>")
  .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer <redacted>")
  .replace(/\b(api[_ -]?key|password|secret|token)\s*[=:]\s*\S+/gi, "$1=<redacted>");
const buildTestEnvironment = allowlist => {
  const allowed = new Set(allowlist.map(name => name.toUpperCase()));
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => (
    !name.toUpperCase().startsWith("JF_") || allowed.has(name.toUpperCase())
  )));
};
const resolveTestCwd = relativeCwd => {
  if (typeof relativeCwd !== "string" || path.isAbsolute(relativeCwd)) {
    throw new Error("Test cwd must be a repository-relative path");
  }
  const resolved = path.resolve(repositoryRoot, relativeCwd);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Test cwd resolves outside the repository");
  }
  return resolved;
};
for (const test of selected) {
  const started = new Date();
  let run;
  let configurationError = null;
  try {
    if (typeof test.command !== "string" || !test.command.trim()) throw new Error("Test command is missing");
    if (!Number.isInteger(test.timeout_ms) || test.timeout_ms < 1000) throw new Error("Test timeout_ms is invalid");
    if (!Array.isArray(test.env_allowlist) || test.env_allowlist.some(name => typeof name !== "string" || !name)) {
      throw new Error("Test env_allowlist is invalid");
    }
    const [declaredCommand, ...args] = test.command.trim().split(/\s+/);
    const command = process.platform === "win32" && ["npm", "npx"].includes(declaredCommand)
      ? `${declaredCommand}.cmd`
      : declaredCommand;
    run = spawnSync(command, args, {
      cwd: resolveTestCwd(test.cwd),
      env: buildTestEnvironment(test.env_allowlist),
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      timeout: test.timeout_ms,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    configurationError = error;
    run = { status: null, signal: null, error, stdout: "", stderr: "" };
  }
  const failed = run.status !== 0 || Boolean(run.error) || Boolean(configurationError);
  results.push({
    id: test.id,
    command: test.command,
    cwd: test.cwd,
    timeout_ms: test.timeout_ms,
    env_allowlist: test.env_allowlist,
    started_at_utc: started.toISOString(),
    completed_at_utc: new Date().toISOString(),
    exit_code: run.status,
    signal: run.signal,
    error: run.error?.message || null,
    status: failed ? "FAIL" : "PASS",
    merge_blocking: failed,
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
  selection_errors: Array.isArray(impact.selection_errors) ? impact.selection_errors : [],
  results,
};
if ((impact.changed_files?.length || 0) > 0 && selected.length === 0) {
  report.selection_errors.push("Changed files produced zero PR-runnable tests; test execution is blocked.");
}
await writeFile(path.resolve(outputArg), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ selected: report.selected_count, runnable: report.runnable_count, passed: report.passed, failed: report.failed, blockingFailed: report.blocking_failed }, null, 2));
if (report.blocking_failed || report.selection_errors.length) process.exitCode = 1;
