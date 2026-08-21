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
for (const change of changed) {
  const candidates = [change.path, change.previous_path].filter(Boolean);
  for (const file of candidates) {
    for (const matcher of moduleMatchers) {
      if (matcher.patterns.some(pattern => pattern.test(file))) {
        impactSet.add(matcher.module.id);
        reasons.push({ file, module: matcher.module.id, rule: "module_glob" });
      }
    }
    if (file.startsWith(".github/")) {
      impactSet.add("ci");
      impactSet.add("repository-wide");
      reasons.push({ file, module: "repository-wide", rule: "workflow_security_expansion" });
    }
    if (file.startsWith("tools/audit/")) {
      impactSet.add("audit-registry");
      impactSet.add("repository-wide");
      reasons.push({ file, module: "audit-registry", rule: "audit_engine_change" });
    }
    if (file.endsWith("package-lock.json")) reasons.push({ file, module: "dependency-tree", rule: "lockfile_invalidates_dependency_evidence" });
  }
}
const modules = [...impactSet].sort();
const selectedTests = testMap.tests
  .filter(test => test.modules.some(module => impactSet.has(module)))
  .map(test => ({
    id: test.id,
    path: test.path,
    command: test.command,
    class: test.class,
    runnable_in_pr: !test.network_allowed && !test.executable_allowed && !test.requires_explicit_live_authorization && !test.command.includes("<"),
    selected_by: test.modules.filter(module => impactSet.has(module)),
  }));
const result = {
  schema_version: 1,
  generated_at_utc: new Date().toISOString(),
  base,
  target,
  changed_files: changed,
  impact_set: modules,
  impact_reasons: reasons,
  selected_tests: selectedTests,
  evidence_reused: [],
  evidence_invalidated: changed.length ? ["all evidence mapped to impacted modules", "toolchain evidence when workflow/audit engine changes", "dependency evidence for changed lockfiles"] : [],
  limitations: ["No production, live, installer executable, or deployment test is run from an untrusted PR"],
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
const summary = `## Audit impact\n\n- Base: \`${base}\`\n- Target: \`${target}\`\n- Changed files: ${changed.length}\n- Impact set: ${modules.length ? modules.map(value => `\`${value}\``).join(", ") : "none"}\n- Selected tests: ${selectedTests.length}\n- PR-runnable tests: ${selectedTests.filter(test => test.runnable_in_pr).length}\n`;
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
console.log(JSON.stringify({ changed: changed.length, impactSet: modules, selected: selectedTests.length, runnable: selectedTests.filter(test => test.runnable_in_pr).length }, null, 2));
