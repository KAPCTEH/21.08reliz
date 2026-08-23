#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const impactScript = path.join(repositoryRoot, "tools", "audit", "impact.mjs");
const runnerScript = path.join(repositoryRoot, "tools", "audit", "run-selected-tests.mjs");
const temporaryRoots = [];

const run = (command, args, options = {}) => spawnSync(command, args, {
  encoding: "utf8",
  windowsHide: true,
  ...options,
});

const git = (cwd, args) => {
  const result = run("git", args, { cwd });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
};

const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");

async function makeTemporaryRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function testImpactFallbackAndFailClosedSelection() {
  const root = await makeTemporaryRoot("justfun-audit-impact-");
  const repo = path.join(root, "repo");
  const ledger = path.join(root, "ledger");
  await mkdir(repo, { recursive: true });
  await mkdir(ledger, { recursive: true });
  git(repo, ["init", "--quiet"]);

  const changedFiles = [
    "release/example.json",
    "tools/release/example.mjs",
    "tests/example.test.mjs",
    "source/update-catalog-service/example.mjs",
  ];
  for (const file of changedFiles) {
    const absolute = path.join(repo, ...file.split("/"));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, "before\n", "utf8");
  }
  git(repo, ["add", "."]);
  git(repo, ["-c", "user.name=Audit Test", "-c", "user.email=audit@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "base"]);
  const base = git(repo, ["rev-parse", "HEAD"]);
  for (const file of changedFiles) {
    await writeFile(path.join(repo, ...file.split("/")), "after\n", "utf8");
  }
  git(repo, ["add", "."]);
  git(repo, ["-c", "user.name=Audit Test", "-c", "user.email=audit@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "unmapped"]);
  const target = git(repo, ["rev-parse", "HEAD"]);

  await writeJson(path.join(ledger, "module-map.yml"), {
    schema_version: 1,
    modules: [{ id: "application", globs: ["source/application/**"] }],
  });
  await writeJson(path.join(ledger, "test-map.yml"), {
    schema_version: 1,
    tests: [
      {
        id: "SAFE-UNIT",
        path: "tests/safe.mjs",
        command: "node tests/safe.mjs",
        cwd: ".",
        env_allowlist: ["JF_ALLOWED"],
        timeout_ms: 4321,
        class: "unit",
        modules: ["application"],
        network_allowed: false,
        executable_allowed: false,
        requires_explicit_live_authorization: false,
      },
      {
        id: "LIVE-ONLY",
        path: "tests/live.mjs",
        command: "node tests/live.mjs",
        cwd: ".",
        env_allowlist: [],
        timeout_ms: 5000,
        class: "live",
        modules: ["application"],
        network_allowed: true,
        executable_allowed: false,
        requires_explicit_live_authorization: true,
      },
    ],
  });
  const output = path.join(root, "impact.json");
  const result = run(process.execPath, [impactScript, ledger, base, target, output], { cwd: repo });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(output, "utf8"));
  assert.equal(report.selection_mode, "full-safe-fallback");
  assert.deepEqual(report.unmapped_changed_files, [...changedFiles].sort());
  assert.equal(report.selected_tests.length, 2);
  assert.equal(report.selected_tests[0].cwd, ".");
  assert.deepEqual(report.selected_tests[0].env_allowlist, ["JF_ALLOWED"]);
  assert.equal(report.selected_tests[0].timeout_ms, 4321);
  assert.equal(report.selected_tests[0].runnable_in_pr, true);
  assert.equal(report.selected_tests[1].runnable_in_pr, false);

  const declaredTestPath = path.join(repo, "tests", "safe.mjs");
  await writeFile(declaredTestPath, "changed declared test\n", "utf8");
  git(repo, ["add", "."]);
  git(repo, ["-c", "user.name=Audit Test", "-c", "user.email=audit@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "declared test"]);
  const declaredTestTarget = git(repo, ["rev-parse", "HEAD"]);
  const declaredOutput = path.join(root, "impact-declared-test.json");
  const declaredResult = run(process.execPath, [impactScript, ledger, target, declaredTestTarget, declaredOutput], { cwd: repo });
  assert.equal(declaredResult.status, 0, declaredResult.stderr || declaredResult.stdout);
  const declaredReport = JSON.parse(await readFile(declaredOutput, "utf8"));
  assert.equal(declaredReport.selection_mode, "module-mapped");
  assert.equal(declaredReport.unmapped_changed_files.length, 0);
  assert.equal(declaredReport.selected_tests.some(test => test.id === "SAFE-UNIT" && test.selected_by.includes("changed-test-path")), true);

  const mappedBase = declaredTestTarget;
  const mappedFile = path.join(repo, "source", "application", "main.js");
  await mkdir(path.dirname(mappedFile), { recursive: true });
  await writeFile(mappedFile, "changed\n", "utf8");
  git(repo, ["add", "."]);
  git(repo, ["-c", "user.name=Audit Test", "-c", "user.email=audit@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "mapped"]);
  const mappedTarget = git(repo, ["rev-parse", "HEAD"]);
  await writeJson(path.join(ledger, "test-map.yml"), {
    schema_version: 1,
    tests: [{
      id: "UNRELATED",
      path: "tests/unrelated.mjs",
      command: "node tests/unrelated.mjs",
      cwd: ".",
      env_allowlist: [],
      timeout_ms: 5000,
      class: "unit",
      modules: ["license-server"],
      network_allowed: false,
      executable_allowed: false,
      requires_explicit_live_authorization: false,
    }],
  });
  const zeroOutput = path.join(root, "impact-zero.json");
  const zeroResult = run(process.execPath, [impactScript, ledger, mappedBase, mappedTarget, zeroOutput], { cwd: repo });
  assert.equal(zeroResult.status, 1, zeroResult.stderr || zeroResult.stdout);
  const zeroReport = JSON.parse(await readFile(zeroOutput, "utf8"));
  assert.equal(zeroReport.selection_mode, "module-mapped");
  assert.equal(zeroReport.selected_tests.length, 0);
  assert.equal(zeroReport.selection_errors.length, 1);
}

async function testRunnerPolicy() {
  const root = await makeTemporaryRoot("justfun-audit-runner-");
  const repo = path.join(root, "repo");
  const fixture = path.join(repo, "fixture");
  await mkdir(fixture, { recursive: true });
  git(repo, ["init", "--quiet"]);
  await writeFile(path.join(fixture, "probe.mjs"), [
    "console.log(JSON.stringify({",
    "  cwd: process.cwd(),",
    "  allowed: process.env.JF_ALLOWED || null,",
    "  blocked: process.env.JF_BLOCKED || null,",
    "  normal: process.env.NORMAL_VALUE || null,",
    "}));",
    "",
  ].join("\n"), "utf8");
  await writeFile(path.join(fixture, "slow.mjs"), "setTimeout(() => {}, 2500);\n", "utf8");

  const impact = path.join(root, "impact.json");
  const output = path.join(root, "results.json");
  await writeJson(impact, {
    schema_version: 1,
    changed_files: [{ status: "M", path: "tests/example.mjs" }],
    selection_errors: [],
    selected_tests: [
      {
        id: "ENV-CWD",
        command: "node probe.mjs",
        cwd: "fixture",
        env_allowlist: ["JF_ALLOWED"],
        timeout_ms: 5000,
        runnable_in_pr: true,
      },
      {
        id: "TIMEOUT",
        command: "node slow.mjs",
        cwd: "fixture",
        env_allowlist: [],
        timeout_ms: 1000,
        runnable_in_pr: true,
      },
    ],
  });
  const result = run(process.execPath, [runnerScript, impact, output], {
    cwd: repo,
    env: {
      ...process.env,
      JF_ALLOWED: "allowed-value",
      JF_BLOCKED: "must-not-leak",
      NORMAL_VALUE: "kept-value",
    },
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(output, "utf8"));
  assert.equal(report.passed, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.blocking_failed, 1);
  const probe = JSON.parse(report.results[0].stdout_tail.trim());
  assert.equal(path.resolve(probe.cwd), path.resolve(fixture));
  assert.equal(probe.allowed, "allowed-value");
  assert.equal(probe.blocked, null);
  assert.equal(probe.normal, "kept-value");
  assert.equal(report.results[1].timeout_ms, 1000);
  assert.equal(report.results[1].status, "FAIL");
  assert.equal(report.results[1].merge_blocking, true);

  const emptyImpact = path.join(root, "empty-impact.json");
  const emptyOutput = path.join(root, "empty-results.json");
  await writeJson(emptyImpact, {
    schema_version: 1,
    changed_files: [{ status: "M", path: "release/example.json" }],
    selection_errors: [],
    selected_tests: [],
  });
  const emptyResult = run(process.execPath, [runnerScript, emptyImpact, emptyOutput], { cwd: repo });
  assert.equal(emptyResult.status, 1, emptyResult.stderr || emptyResult.stdout);
  const emptyReport = JSON.parse(await readFile(emptyOutput, "utf8"));
  assert.equal(emptyReport.selection_errors.length, 1);
}

try {
  await testImpactFallbackAndFailClosedSelection();
  await testRunnerPolicy();
  console.log("Audit tools unit: PASS");
} finally {
  for (const root of temporaryRoots.reverse()) {
    await rm(root, { recursive: true, force: true });
  }
}
