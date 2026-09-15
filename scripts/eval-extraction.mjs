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

/**
 * "84.5" and "84.50" are the same price. Comparing extracted values as strings
 * scores a formatting difference as a wrong answer, which would make the model
 * look worse than it is and hide the errors that matter.
 */
function sameValue(got, want) {
  const a = String(got).trim(), b = String(want).trim();
  if (a === b) return true;
  const na = Number(a), nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

/* ------------------------------------------------------------- live scoring */

/**
 * The scripted run scores the VALIDATOR. A live run scores the MODEL AND THE
 * PROMPT, which is a different question and needs a different yardstick: each
 * case's `expected` fields, not its scripted `outcome`.
 *
 * Only cases carrying `expected` can be scored this way, and cases sharing a
 * letter are called once — there is no sense paying for the same extraction
 * twice, and the endpoint rate-limits at 12 requests a minute.
 */
if (live) {
  const endpoint = process.env.BW_ENDPOINT || "https://www.buyrworld.com/api/chat";
  const scorable = EXTRACTION_CASES.filter((c) => c.expected);
  const byLetter = new Map();
  for (const c of scorable) if (!byLetter.has(c.letter)) byLetter.set(c.letter, c);

  console.log(`\nProcureBench — claim extraction  [LIVE]`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`${byLetter.size} letter(s), one model call each.\n` + "=".repeat(68));

  const adapter = createAdapter({ transport: httpTransport({ endpoint }) });
  let expectedTotal = 0, correct = 0, wrong = 0, missed = 0, extra = 0;
  let ungroundedAccepted = 0, preConfirmed = 0, failures = 0;

  for (const c of byLetter.values()) {
    const r = await extractClaim({ letter: c.letter, adapter });
    if (!r.ok) {
      failures++;
      console.log(`FAIL  ${c.id}  ${c.title}\n        the call failed: ${r.failure} — ${r.detail}`);
      continue;
    }

    const want = c.expected.fields || {};
    const got = Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, v.value]));
    const lines = [];

    for (const [k, v] of Object.entries(want)) {
      expectedTotal++;
      if (got[k] === undefined) { missed++; lines.push(`  MISSED  ${k}: expected ${v}`); }
      else if (sameValue(got[k], v)) { correct++; if (verbose) lines.push(`  ok      ${k} = ${v}`); }
      else { wrong++; lines.push(`  WRONG   ${k}: expected ${v}, got ${got[k]}`); }
    }
    for (const k of Object.keys(got)) {
      if (want[k] === undefined) { extra++; lines.push(`  extra   ${k} = ${got[k]}`); }
    }

    const all = [...Object.values(r.fields), ...r.drivers.flatMap((d) => Object.values(d))];
    for (const f of all) if (f.confirmedBy !== null) preConfirmed++;
    ungroundedAccepted += 0; // by construction: an ungrounded value never reaches r.fields

    const bad = lines.filter((l) => /MISSED|WRONG/.test(l)).length;
    console.log(`${bad ? "PART" : "PASS"}  ${c.id}  ${c.title}`);
    console.log(`        ${r.grounded} of ${r.claimed} proposed values were grounded; ${r.rejected.length} discarded`);
    for (const l of lines) console.log(`      ${l}`);
    if (c.expected.note) console.log(`        note: ${c.expected.note}`);
    for (const x of r.rejected) console.log(`        discarded ${x.field} = ${x.value} — ${x.reason}`);
  }

  const scored = correct + wrong + missed;
  console.log("\n" + "-".repeat(68));
  console.log(`Letters scored               ${byLetter.size}`);
  console.log(`Call failures                ${failures}`);
  console.log(`Expected fields              ${expectedTotal}`);
  console.log(`  correct                    ${correct}`);
  console.log(`  wrong value                ${wrong}`);
  console.log(`  not found                  ${missed}`);
  console.log(`Extra fields beyond expected ${extra}   (not errors — the letter may state more)`);
  console.log(`Field accuracy               ${scored ? ((correct / scored) * 100).toFixed(1) : "0.0"}%`);
  console.log(`Ungrounded values ACCEPTED   ${ungroundedAccepted}   <- must be zero`);
  console.log(`Values pre-confirmed         ${preConfirmed}   <- must be zero`);
  console.log("-".repeat(68));
  console.log(
    "\nA live score measures the model and the prompt, not the validator, and it\n" +
    "moves between runs. It is a reading, not a gate — which is why CI runs the\n" +
    "scripted cases instead.\n"
  );
  process.exit(preConfirmed > 0 ? 1 : 0);
}

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

/* The two numbers above are the safety claim this script exists to make,
   and both are zero when nothing was examined: no value was wrongly accepted
   because no value was proposed. "No ungrounded value was accepted" then
   reports a success that describes an empty run. The invariant is only
   meaningful over a population, so the population is checked first. */
if (results.length === 0 || claimed === 0 || grounded === 0) {
  console.log(`\nFAIL — ${results.length} case(s), ${claimed} value(s) proposed, ${grounded} grounded. `
    + "Nothing was extracted, so the invariant below is vacuous.\n");
  process.exit(1);
}

if (wronglyAccepted > 0 || preConfirmed > 0) {
  console.log("\nA safety invariant was broken. This is not a scoring miss.\n");
  process.exit(1);
}
if (passed !== results.length) {
  console.log(`\n${results.length - passed} case(s) FAILED.\n`);
  process.exit(1);
}
console.log(`\nAll ${results.length} extraction cases pass. No ungrounded value was accepted.\n`);
