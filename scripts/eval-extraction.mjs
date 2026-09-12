#!/usr/bin/env node
/**
 * ProcureBench — extraction runner.
 *
 *   node scripts/eval-extraction.mjs            deterministic, runs in CI
 *   node scripts/eval-extraction.mjs --verbose  per-case detail
 *   node scripts/eval-extraction.mjs --live     against the real model endpoint
 *
 * The default run scores the VALIDATOR against scripted model responses. That
 * is the part that can be asserted, because a live model is not deterministic
 * and a suite that fails at random teaches nobody anything.
 *
 * The metric that matters is at the bottom: ungrounded values WRONGLY ACCEPTED.
 * Everything else can look healthy while that number is non-zero, and if it is
 * non-zero the product is lying to its user.
 */
import { createAdapter, mockTransport, httpTransport } from "../src/services/ai/adapter.mjs";
import { extractClaim } from "../src/services/ai/extract-claim.mjs";
import { EXTRACTION_CASES } from "../fixtures/procurebench/extraction-cases.mjs";

const verbose = process.argv.includes("--verbose");
const live = process.argv.includes("--live");

const results = [];

for (const c of EXTRACTION_CASES) {
  const checks = [];
  const ok = (what) => checks.push({ ok: true, what });
  const no = (what, got) => checks.push({ ok: false, what, got: String(got) });

  const transport = live ? httpTransport() : mockTransport(c.response);
  const r = await extractClaim({ letter: c.letter, adapter: createAdapter({ transport }) });

  const want = c.outcome ?? {};

  if (want.adapterFailure) {
    if (r.ok) no(`adapter failure "${want.adapterFailure}"`, "the response was accepted");
    else if (r.failure !== want.adapterFailure) no(`failure "${want.adapterFailure}"`, r.failure);
    else ok(`rejected as ${r.failure}`);
  } else if (!r.ok) {
    no("a usable extraction", `failed: ${r.failure}`);
  } else {
    const nFields = Object.keys(r.fields).length;
    const nDrivers = r.drivers.length;

    if (want.acceptedFields !== undefined) {
      nFields === want.acceptedFields
        ? ok(`${nFields} field(s) accepted`)
        : no(`${want.acceptedFields} field(s) accepted`, nFields);
    }
    if (want.acceptedDrivers !== undefined) {
      nDrivers === want.acceptedDrivers
        ? ok(`${nDrivers} driver(s) accepted`)
        : no(`${want.acceptedDrivers} driver(s) accepted`, nDrivers);
    }
    if (want.rejected !== undefined) {
      r.rejected.length === want.rejected
        ? ok(`${r.rejected.length} value(s) rejected`)
        : no(`${want.rejected} rejection(s)`, `${r.rejected.length}: ${r.rejected.map((x) => x.field).join(", ") || "none"}`);
    }
    if (want.maxDrivers !== undefined) {
      nDrivers <= want.maxDrivers ? ok(`capped at ${nDrivers} drivers`) : no(`at most ${want.maxDrivers} drivers`, nDrivers);
    }
    for (const field of want.mustReject ?? []) {
      r.rejected.some((x) => x.field === field)
        ? ok(`${field} rejected`)
        : no(`${field} rejected`, "it was accepted");
    }

    // Non-negotiable, on every case that produced anything.
    const unconfirmed = [...Object.values(r.fields), ...r.drivers.flatMap((d) => Object.values(d))]
      .every((f) => f.confirmedBy === null);
    unconfirmed ? ok("everything arrived unconfirmed") : no("everything unconfirmed", "something was pre-confirmed");
  }

  const failed = checks.filter((x) => !x.ok);
  results.push({ c, r, checks, failed, ok: failed.length === 0 });
}

/* ------------------------------------------------------------------ report */
console.log(`\nProcureBench — claim extraction${live ? "  [LIVE MODEL]" : ""}`);
console.log("=".repeat(68));

for (const { c, checks, failed, ok } of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.id}  ${c.title}`);
  if (verbose && ok) for (const x of checks) console.log(`        ${x.what}`);
  if (!ok) for (const x of failed) console.log(`        expected ${x.what}, got ${x.got}`);
}

/* The numbers that matter. */
let grounded = 0, claimed = 0, rejectedTotal = 0, wronglyAccepted = 0, preConfirmed = 0;
for (const { c, r } of results) {
  if (!r.ok) continue;
  grounded += r.grounded ?? 0;
  claimed += r.claimed ?? 0;
  rejectedTotal += r.rejected.length;
  // A case that named fields it must reject, which came back accepted anyway.
  for (const f of c.outcome?.mustReject ?? []) if (r.fields[f]) wronglyAccepted++;
  for (const f of [...Object.values(r.fields), ...r.drivers.flatMap((d) => Object.values(d))]) {
    if (f.confirmedBy !== null) preConfirmed++;
  }
}

const passed = results.filter((x) => x.ok).length;
const totalChecks = results.reduce((n, x) => n + x.checks.length, 0);
const failedChecks = results.reduce((n, x) => n + x.failed.length, 0);

console.log("\n" + "-".repeat(68));
console.log(`Cases                        ${results.length}`);
console.log(`Passing                      ${passed} / ${results.length}`);
console.log(`Assertions                   ${totalChecks - failedChecks} / ${totalChecks}`);
console.log(`Values proposed              ${claimed}`);
console.log(`  grounded in the letter     ${grounded}`);
console.log(`  discarded as ungrounded    ${rejectedTotal}`);
console.log(`Ungrounded values ACCEPTED   ${wronglyAccepted}   <- must be zero`);
console.log(`Values pre-confirmed         ${preConfirmed}   <- must be zero`);
console.log("-".repeat(68));

if (wronglyAccepted > 0 || preConfirmed > 0) {
  console.log("\nA safety invariant was broken. This is not a scoring miss.\n");
  process.exit(1);
}
if (passed !== results.length) {
  console.log(`\n${results.length - passed} case(s) FAILED.\n`);
  process.exit(1);
}
console.log(`\nAll ${results.length} extraction cases pass. No ungrounded value was accepted.\n`);
