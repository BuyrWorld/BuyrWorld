#!/usr/bin/env node
/**
 * Repository verification. Runs everything that can currently be checked.
 *
 *   node scripts/verify.mjs
 *
 * Exits non-zero if any step fails. Run this before any deploy.
 *
 * Deliberately dependency-free: no package.json, no install step, nothing that
 * could change how the hosting platform builds this project.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Discover test files ourselves rather than relying on a glob.
 * `node --test "tests/**"` is expanded by the shell on some platforms, by node
 * on others, and by neither on older releases — which is exactly how CI and a
 * developer's machine end up running different sets of tests.
 */
function findTests(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) findTests(full, out);
    else if (name.endsWith(".test.mjs")) out.push(full);
  }
  return out;
}
const testFiles = findTests("tests");
if (testFiles.length === 0) {
  console.error("No test files found under tests/. That is a failure, not a pass.");
  process.exit(1);
}

const steps = [
  {
    name: `Tests (${testFiles.length} files)`,
    cmd: process.execPath,
    args: ["--test", ...testFiles],
  },
  {
    name: "ProcureBench evaluation",
    cmd: process.execPath,
    args: ["scripts/eval.mjs"],
  },
  {
    name: "Prohibited content (commercial + personal)",
    cmd: process.execPath,
    args: ["scripts/verify-content.mjs"],
  },
  {
    name: "Serverless function syntax",
    cmd: process.execPath,
    args: ["--check", "api/chat.js"],
  },
  {
    name: "index.html integrity (JS parse, div balance, dead links)",
    cmd: process.execPath,
    args: ["scripts/verify-html.mjs"],
  },
];

let failed = 0;
for (const step of steps) {
  process.stdout.write(`\n── ${step.name}\n`);
  const r = spawnSync(step.cmd, step.args, { stdio: "inherit" });
  if (r.status !== 0) {
    failed++;
    process.stdout.write(`   FAILED (exit ${r.status})\n`);
  }
}

process.stdout.write(
  failed === 0
    ? `\nAll ${steps.length} checks passed.\n`
    : `\n${failed} of ${steps.length} checks FAILED.\n`
);
process.exit(failed === 0 ? 0 : 1);
