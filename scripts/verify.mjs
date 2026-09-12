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

const steps = [
  {
    name: "Unit tests (exact arithmetic + cost bridge)",
    cmd: process.execPath,
    args: ["--test", "tests/**/*.test.mjs"],
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
