#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [ledgerArg, repositoryArg = ".", outputArg = "audit-ledger-verification.json"] = process.argv.slice(2);
if (!ledgerArg) {
  console.error("Usage: node tools/audit/verify-ledger.mjs <ledger-root> [repository-root] [output.json]");
  process.exit(2);
}

const ledger = path.resolve(ledgerArg);
const repository = path.resolve(repositoryArg);
const output = path.resolve(outputArg);
const failures = [];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const posix = value => value.split(path.sep).join("/");

async function json(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    failures.push(`invalid_json:${posix(path.relative(ledger, file))}:${error.message}`);
    return null;
  }
}

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(fullPath));
    else if (entry.isFile()) result.push(fullPath);
  }
  return result.sort((a, b) => a.localeCompare(b, "en"));
}

const index = await json(path.join(ledger, "index.json"));
const scope = await json(path.join(ledger, "scope.yml"));
const moduleMap = await json(path.join(ledger, "module-map.yml"));
const testMap = await json(path.join(ledger, "test-map.yml"));
const publishManifest = await json(path.join(ledger, "publish-manifest.json"));
const secretScan = await json(path.join(ledger, "publish-secret-scan.json"));
if (!index || !scope || !moduleMap || !testMap || !publishManifest || !secretScan) process.exitCode = 1;

if (secretScan?.finding_count !== 0 || secretScan?.findings?.length) failures.push("publish_secret_scan_not_clean");
if (await stat(path.join(ledger, "baselines", publishManifest?.baseline_id || "missing", "live", "cloudflare-readonly-inventory.json")).then(() => true, () => false)) {
  failures.push("raw_sensitive_cloudflare_inventory_is_publishable");
}

const allLedgerFiles = (await filesUnder(ledger))
  .map(file => posix(path.relative(ledger, file)))
  .filter(file => file !== "publish-manifest.json" && !file.startsWith(".git/"));
const manifestPaths = new Set((publishManifest?.files || []).map(file => file.path));
const actualPaths = new Set(allLedgerFiles);
for (const file of actualPaths) if (!manifestPaths.has(file)) failures.push(`manifest_missing:${file}`);
for (const file of manifestPaths) if (!actualPaths.has(file)) failures.push(`manifest_orphan:${file}`);
for (const item of publishManifest?.files || []) {
  const bytes = await readFile(path.join(ledger, ...item.path.split("/")));
  if (bytes.length !== item.bytes) failures.push(`size_mismatch:${item.path}`);
  if (sha256(bytes) !== item.sha256) failures.push(`sha256_mismatch:${item.path}`);
}

const findingFiles = await filesUnder(path.join(ledger, "findings"));
const evidenceFiles = await filesUnder(path.join(ledger, "evidence"));
const findings = (await Promise.all(findingFiles.filter(file => file.endsWith(".json")).map(json))).filter(Boolean);
const evidence = (await Promise.all(evidenceFiles.filter(file => file.endsWith(".json")).map(json))).filter(Boolean);
const findingIds = new Set();
const fingerprints = new Set();
const evidenceIds = new Set(evidence.map(item => item.id));
const severityCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };
for (const item of findings) {
  if (!/^JF-AUDIT-\d{4}$/.test(item.id)) failures.push(`invalid_finding_id:${item.id}`);
  if (findingIds.has(item.id)) failures.push(`duplicate_finding_id:${item.id}`);
  findingIds.add(item.id);
  if (fingerprints.has(item.fingerprint)) failures.push(`duplicate_fingerprint:${item.fingerprint}`);
  fingerprints.add(item.fingerprint);
  if (item.status === "OPEN") severityCounts[item.severity] += 1;
  if (!/^https:\/\/github\.com\/KAPCTEH\/21\.08reliz\/issues\/\d+$/.test(item.issue || "")) failures.push(`finding_without_issue:${item.id}`);
  for (const evidenceId of item.evidence || []) if (!evidenceIds.has(evidenceId)) failures.push(`missing_evidence:${item.id}:${evidenceId}`);
  if (!item.verification_contract?.length) failures.push(`empty_verification_contract:${item.id}`);
}
for (const item of evidence) {
  for (const findingId of item.findings || []) if (!findingIds.has(findingId)) failures.push(`evidence_unknown_finding:${item.id}:${findingId}`);
}
if (JSON.stringify(severityCounts) !== JSON.stringify(index?.open_findings_by_severity)) failures.push("index_severity_counts_mismatch");
if (!Array.isArray(moduleMap?.modules) || !moduleMap.modules.every(module => module.id && module.owner && module.globs?.length && module.required_checks?.length)) failures.push("incomplete_module_map");
if (!Array.isArray(testMap?.tests) || !testMap.tests.every(test => test.id && test.path && test.command && test.modules?.length && typeof test.network_allowed === "boolean")) failures.push("incomplete_test_map");
for (const test of testMap?.tests || []) {
  if ((test.network_allowed || test.executable_allowed) && !test.requires_explicit_live_authorization) failures.push(`dangerous_test_not_gated:${test.id}`);
}

const baselineId = publishManifest?.baseline_id;
const baselineRoot = path.join(ledger, "baselines", baselineId || "missing");
const allowlist = await json(path.join(baselineRoot, "allowlist.json"));
const inventoryText = await readFile(path.join(baselineRoot, "input-file-inventory.jsonl"), "utf8");
for (const [lineIndex, line] of inventoryText.split(/\r?\n/).entries()) {
  if (!line) continue;
  const record = JSON.parse(line);
  if (record.category === "MANUAL_REVIEW") failures.push(`manual_review_inventory_line:${lineIndex + 1}`);
}
const targetCommit = index?.last_audited_commit;
const commitCheck = spawnSync("git", ["-C", repository, "cat-file", "-e", `${targetCommit}^{commit}`], { encoding: "utf8", windowsHide: true });
if (commitCheck.status !== 0) failures.push(`missing_target_commit:${targetCommit}`);
else {
  const tree = spawnSync("git", ["-C", repository, "ls-tree", "-r", "--name-only", targetCommit], { encoding: "utf8", windowsHide: true });
  const treePaths = new Set(tree.stdout.split(/\r?\n/).filter(Boolean));
  const allowedPaths = new Set((allowlist?.files || []).map(file => file.path));
  for (const file of treePaths) if (!allowedPaths.has(file)) failures.push(`commit_not_allowlisted:${file}`);
  for (const file of allowedPaths) if (!treePaths.has(file)) failures.push(`allowlist_missing_from_commit:${file}`);
}

const result = {
  schema_version: 1,
  generated_at_utc: new Date().toISOString(),
  ledger,
  repository,
  baseline_id: baselineId,
  target_commit: targetCommit,
  counts: { files: allLedgerFiles.length + 1, findings: findings.length, evidence: evidence.length, modules: moduleMap?.modules?.length || 0, tests: testMap?.tests?.length || 0 },
  open_findings_by_severity: severityCounts,
  passed: failures.length === 0,
  failures,
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
