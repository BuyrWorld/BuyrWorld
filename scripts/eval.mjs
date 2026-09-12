#!/usr/bin/env node
/**
 * ProcureBench runner.
 *
 *   node scripts/eval.mjs            summary
 *   node scripts/eval.mjs --verbose  per-case detail
 *
 * Evaluates the calculation layer against the corpus in
 * fixtures/procurebench/cases.mjs and exits non-zero on any regression.
 *
 * Cases that need a layer which does not exist yet are reported as PENDING —
 * never as passes. Counting them as passes would be exactly the self-flattery
 * the corpus exists to prevent.
 */
import { costBridge, formatPercent } from "../src/calc/cost-bridge.mjs";
import { moneyToDecimalString } from "../src/calc/exact.mjs";
import { CASES, EVALUABLE, PENDING } from "../fixtures/procurebench/cases.mjs";

const verbose = process.argv.includes("--verbose");
const results = [];

for (const c of EVALUABLE) {
  const checks = [];
  let threw = null, out = null;

  try {
    out = costBridge(c.input);
  } catch (e) {
    threw = e;
  }

  if (c.expectThrows) {
    if (!threw) {
      checks.push({ ok: false, what: "should reject", got: "accepted the input" });
    } else if (!c.expectThrows.test(threw.message)) {
      checks.push({ ok: false, what: `rejection matching ${c.expectThrows}`, got: threw.message });
    } else {
      checks.push({ ok: true, what: "rejected as expected" });
    }
  } else if (threw) {
    checks.push({ ok: false, what: "should calculate", got: `threw: ${threw.message}` });
  } else {
    const e = c.expect || {};
    const actual = {
      warrantedChange: formatPercent(out.warrantedChange),
      warrantedBefore: formatPercent(out.warrantedBeforeConstraints),
      unsupportedChange: formatPercent(out.unsupportedChange),
      unexplainedWeight: formatPercent(out.unexplainedWeight),
      constraintApplied: out.constraintApplied,
      annualRequested: moneyToDecimalString(out.annual.requested),
      annualWarranted: moneyToDecimalString(out.annual.warranted),
      annualUnsupported: moneyToDecimalString(out.annual.unsupported),
      retrospectiveUnits: out.retrospective ? String(out.retrospective.units) : null,
      retrospectiveUnsupported: out.retrospective ? moneyToDecimalString(out.retrospective.unsupported) : null,
    };
    for (const [k, want] of Object.entries(e)) {
      const got = actual[k];
      checks.push({ ok: got === want, what: `${k} = ${want}`, got: String(got) });
    }
    // Named assumptions the reviewer must be shown.
    for (const id of c.expectAssumptions ?? []) {
      const found = out.assumptions.some((a) => a.id === id);
      checks.push({ ok: found, what: `assumption "${id}" surfaced`, got: out.assumptions.map((a) => a.id).join(", ") || "none" });
    }
    // Every case that expects a gap must actually surface one.
    if (c.expectGaps?.length) {
      const surfaced = out.assumptions.length > 0;
      checks.push({ ok: surfaced, what: `${c.expectGaps.length} evidence gap(s) surfaced`, got: `${out.assumptions.length} assumption(s)` });
    }
    // Determinism: the same input must give the identical result.
    const again = costBridge(c.input);
    checks.push({
      ok: again.warrantedChange === out.warrantedChange && again.annual.unsupported.minor === out.annual.unsupported.minor,
      what: "deterministic on re-run",
      got: "differs",
    });
  }

  const failed = checks.filter((x) => !x.ok);
  results.push({ c, checks, ok: failed.length === 0, failed });
}

/* ----------------------------------------------------------------- report */
const passed = results.filter((r) => r.ok);
const failedCases = results.filter((r) => !r.ok);
const totalChecks = results.reduce((n, r) => n + r.checks.length, 0);
const failedChecks = results.reduce((n, r) => n + r.failed.length, 0);

console.log("\nProcureBench — supplier claim review");
console.log("=".repeat(64));

for (const r of results) {
  const mark = r.ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${r.c.id}  ${r.c.title}`);
  if (verbose && r.ok) for (const ch of r.checks) console.log(`        ${ch.what}`);
  if (!r.ok) for (const ch of r.failed) console.log(`        expected ${ch.what}, got ${ch.got}`);
}

if (PENDING.length) {
  console.log("\nPending — the corpus defines these; the system cannot yet answer them:");
  for (const c of PENDING) console.log(`PEND  ${c.id}  ${c.title}\n        ${c.notYetEvaluable}`);
}

console.log("\n" + "-".repeat(64));
console.log(`Cases in corpus        ${CASES.length}`);
console.log(`Evaluable now          ${EVALUABLE.length}`);
console.log(`Passing                ${passed.length} / ${EVALUABLE.length}`);
console.log(`Assertions             ${totalChecks - failedChecks} / ${totalChecks}`);
console.log(`Pending a future layer ${PENDING.length}`);
console.log(`Calculation accuracy   ${((totalChecks - failedChecks) / totalChecks * 100).toFixed(1)}%`);
console.log("-".repeat(64));

if (failedCases.length) {
  console.log(`\n${failedCases.length} case(s) FAILED.\n`);
  process.exit(1);
}
console.log(`\nAll ${EVALUABLE.length} evaluable cases pass. ${PENDING.length} await layers not yet built.\n`);
