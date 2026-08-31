#!/usr/bin/env node

import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [ledgerArg, base, target, outputArg = "audit-impact.json"] = process.argv.slice(2);
if (!ledgerArg || !/^[0-9a-f]{40}$/.test(base || "") || !/^[0-9a-f]{40}$/.test(target || "")) {
  console.error("Usage: node tools/audit/impact.mjs <ledger-root> <base-sha> <target-sha> [output.json]");
  process.exit(2);
}
const ledger = path.resolve(ledgerArg);
const output = path.resolve(outputArg);
const moduleMap = JSON.parse(await readFile(path.join(ledger, "module-map.yml"), "utf8"));
const testMap = JSON.parse(await readFile(path.join(ledger, "test-map.yml"), "utf8"));

function globRegex(glob) {
  let expression = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") { expression += ".*"; index += 1; }
    else if (char === "*") expression += "[^/]*";
    else expression += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${expression}$`);
}
const moduleMatchers = moduleMap.modules.map(module => ({ module, patterns: module.globs.map(globRegex) }));
const testsByPath = new Map();
for (const test of testMap.tests) {
  const normalizedPath = String(test.path || "").replaceAll("\\", "/");
  if (!testsByPath.has(normalizedPath)) testsByPath.set(normalizedPath, []);
  testsByPath.get(normalizedPath).push(test);
}
const diff = spawnSync("git", ["diff", "--name-status", "-M", base, target], { encoding: "utf8", windowsHide: true });
if (diff.status !== 0) throw new Error(diff.stderr || "git diff failed");
const changed = [];
for (const line of diff.stdout.split(/\r?\n/).filter(Boolean)) {
  const fields = line.split("\t");
  const status = fields[0];
  if (status.startsWith("R") || status.startsWith("C")) {
    changed.push({ status, path: fields[2], previous_path: fields[1] });
  } else changed.push({ status, path: fields[1] });
}

const impactSet = new Set();
const reasons = [];
const unmappedFiles = new Set();
const directlyChangedTestIds = new Set();
for (const change of changed) {
  const candidates = [change.path, change.previous_path].filter(Boolean);
  for (const file of candidates) {
    let mapped = false;
    for (const test of testsByPath.get(file) || []) {
      mapped = true;
      directlyChangedTestIds.add(test.id);
      for (const module of test.modules || []) impactSet.add(module);
      reasons.push({ file, test: test.id, modules: test.modules || [], rule: "declared_test_path" });
    }
    for (const matcher of moduleMatchers) {
      if (matcher.patterns.some(pattern => pattern.test(file))) {
        mapped = true;
        impactSet.add(matcher.module.id);
        reasons.push({ file, module: matcher.module.id, rule: "module_glob" });
      }
    }
    if (file.startsWith(".github/")) {
      mapped = true;
      impactSet.add("ci");
      impactSet.add("repository-wide");
      reasons.push({ file, module: "repository-wide", rule: "workflow_security_expansion" });
    }
    if (file.startsWith("tools/audit/")) {
      mapped = true;
      impactSet.add("audit-registry");
      impactSet.add("repository-wide");
      reasons.push({ file, module: "audit-registry", rule: "audit_engine_change" });
    }
    if (file.endsWith("package-lock.json")) reasons.push({ file, module: "dependency-tree", rule: "lockfile_invalidates_dependency_evidence" });
    if (!mapped) unmappedFiles.add(file);
  }
}
const fullSafeFallback = unmappedFiles.size > 0;
if (fullSafeFallback) {
  impactSet.add("repository-wide");
  reasons.push({
    files: [...unmappedFiles].sort(),
    module: "repository-wide",
    rule: "unmapped_change_full_safe_test_fallback",
  });
}
const effectiveModules = [...impactSet].sort();
const isRunnableInPr = test => !test.network_allowed
  && !test.executable_allowed
  && !test.requires_explicit_live_authorization
  && !test.command.includes("<");
const selectedTests = testMap.tests
  .filter(test => fullSafeFallback || directlyChangedTestIds.has(test.id) || test.modules.some(module => impactSet.has(module)))
  .map(test => ({
    id: test.id,
    path: test.path,
    command: test.command,
    cwd: test.cwd,
    env_allowlist: test.env_allowlist,
    timeout_ms: test.timeout_ms,
    class: test.class,
    runnable_in_pr: isRunnableInPr(test),
    selected_by: fullSafeFallback
      ? ["unmapped-change-full-safe-fallback"]
      : [
          ...(directlyChangedTestIds.has(test.id) ? ["changed-test-path"] : []),
          ...test.modules.filter(module => impactSet.has(module)),
        ],
  }));
const runnableCount = selectedTests.filter(test => test.runnable_in_pr).length;
const selectionErrors = changed.length > 0 && runnableCount === 0
  ? ["Changed files produced zero PR-runnable tests; audit selection is blocked."]
  : [];
const result = {
  schema_version: 1,
  generated_at_utc: new Date().toISOString(),
  base,
  target,
  changed_files: changed,
  impact_set: effectiveModules,
  impact_reasons: reasons,
  selection_mode: fullSafeFallback ? "full-safe-fallback" : "module-mapped",
  unmapped_changed_files: [...unmappedFiles].sort(),
  selection_errors: selectionErrors,
  selected_tests: selectedTests,
  evidence_reused: [],
  evidence_invalidated: changed.length ? ["all evidence mapped to impacted modules", "toolchain evidence when workflow/audit engine changes", "dependency evidence for changed lockfiles"] : [],
  limitations: ["No production, live, installer executable, or deployment test is run from an untrusted PR"],
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
const summary = `## Audit impact\n\n- Base: \`${base}\`\n- Target: \`${target}\`\n- Changed files: ${changed.length}\n- Impact set: ${effectiveModules.length ? effectiveModules.map(value => `\`${value}\``).join(", ") : "none"}\n- Selection mode: \`${result.selection_mode}\`\n- Unmapped changed files: ${unmappedFiles.size}\n- Selected tests: ${selectedTests.length}\n- PR-runnable tests: ${runnableCount}\n- Selection errors: ${selectionErrors.length}\n`;
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
console.log(JSON.stringify({ changed: changed.length, impactSet: effectiveModules, selectionMode: result.selection_mode, unmapped: unmappedFiles.size, selected: selectedTests.length, runnable: runnableCount, selectionErrors: selectionErrors.length }, null, 2));
if (selectionErrors.length) process.exitCode = 1;
