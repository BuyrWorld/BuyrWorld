#!/usr/bin/env node
/**
 * Drawing reading, measured — precision, recall, abstention and coverage.
 *
 *   node scripts/eval-drawings.mjs            the report
 *   node scripts/eval-drawings.mjs --verbose  every field of every fixture
 *
 * `specs/03-FILE-INTELLIGENCE.md` asks for exactly this and is unusually
 * specific about it: *"Gate production with held-out real drawings at multiple
 * quality levels; report precision, recall, abstention and coverage by
 * field/format, plus every critical misread."*
 *
 * Two of those sentences matter more than the numbers.
 *
 * **"Held-out real drawings."** There are none. This runs against synthetic
 * fixtures with recorded replies, and the same paragraph of the spec says what
 * that is worth: *"Synthetic pack fixtures test routing and evaluator
 * behavior only."* So the report ends by saying the production gate is still
 * blocked, in as many words, however good the figures above it look. A green
 * report here is not permission to trust a reading; it is evidence that the
 * pipeline does what it says with an answer it has already been given.
 *
 * **"Plus every critical misread."** A wrong dimension is not the same kind of
 * event as a wrong part number, and averaging them into one accuracy figure
 * hides the one that scraps parts. Critical misreads are counted separately,
 * listed individually, and a single one fails the run regardless of the
 * percentages — which is the same shape as the claim-extraction runner's
 * "ungrounded values accepted" line, and for the same reason.
 *
 * The four measures, said plainly, because they are easy to define wrongly:
 *
 *   - **Coverage** — of the fields the answer key holds, how many the reader
 *     is even able to attempt. A field no rule and no prompt knows about is a
 *     gap in the product, not a failure of a read.
 *   - **Abstention** — of the fields it could attempt, how many it declined to
 *     answer. High abstention is not a fault. It is the behaviour the whole
 *     design asks for when a drawing is unclear, and it is only a problem
 *     beside low precision.
 *   - **Precision** — of the values it did propose, how many are right.
 *   - **Recall** — of the values the key holds, how many it got right.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { pathToFileURL } from "node:url";

import { readingsFrom } from "../src/intake/vision-read.mjs";

const verbose = process.argv.includes("--verbose");

/**
 * The fields where a wrong answer is a different kind of event.
 *
 * A misread dimension or tolerance reaches a quotation, a stock purchase and
 * eventually a part. A misread part number is caught by the first person who
 * reads it. Both are wrong; only one is worth stopping for.
 */
export const CRITICAL = new Set([
  "width", "length", "thickness", "diameter", "tolerance", "generalTolerance",
  "material", "condition", "specification", "specificationRevision",
]);

/** "120.00" and "120" are the same dimension; "120.00" and "12.00" are not. */
export function same(got, want) {
  const a = String(got ?? "").trim().toUpperCase();
  const b = String(want ?? "").trim().toUpperCase();
  if (a === b) return true;
  const na = Number(a), nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

/** Every fixture with an answer key and a recorded reply beside it. */
function fixtures() {
  const dir = "fixtures/drawings";
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || name.endsWith(".reply.json")) continue;
    const key = JSON.parse(readFileSync(join(dir, name), "utf8"));
    const replyPath = join(dir, `${basename(name, ".json")}.reply.json`);
    let reply = null;
    try { reply = JSON.parse(readFileSync(replyPath, "utf8")); } catch { reply = null; }
    out.push({ name, key, reply, replyPath });
  }
  return out;
}

/** The format a fixture is in, from the id its key carries. */
export const formatOf = (key) => (extname(String(key.id ?? "")).replace(".", "") || "unknown").toLowerCase();

export function scoreOne({ key, reply }) {
  const expected = key.expected ?? {};
  const rows = [];

  if (!reply) {
    for (const field of Object.keys(expected)) {
      rows.push({ field, state: "no-reply", got: null, want: expected[field].value });
    }
    return rows;
  }

  const reading = readingsFrom(reply.text);
  const proposed = new Map((reading.candidates ?? []).map((c) => [c.field, c]));

  for (const [field, want] of Object.entries(expected)) {
    const got = proposed.get(field);
    if (!got) {
      rows.push({ field, state: "abstained", got: null, want: want.value });
      continue;
    }
    const valueRight = same(got.value, want.value);
    const toleranceRight = (got.tolerance?.printed ?? null) === (want.tolerance ?? null);
    rows.push({
      field,
      state: valueRight && toleranceRight ? "right" : "wrong",
      got: got.value,
      want: want.value,
      toleranceGot: got.tolerance?.printed ?? null,
      toleranceWant: want.tolerance ?? null,
    });
  }

  /* A value proposed for a field the key does not hold. Not scored as wrong —
     the key may simply be silent — but reported, because a reader inventing
     fields is worth seeing. */
  for (const [field] of proposed) {
    if (!(field in expected)) {
      rows.push({ field, state: "extra", got: proposed.get(field).value, want: null });
    }
  }

  return rows;
}

export function ratio(top, bottom) {
  if (bottom === 0) return "—";
  return `${((top / bottom) * 100).toFixed(1)}%`;
}

export function tally(rows) {
  const right = rows.filter((r) => r.state === "right").length;
  const wrong = rows.filter((r) => r.state === "wrong").length;
  const abstained = rows.filter((r) => r.state === "abstained").length;
  const noReply = rows.filter((r) => r.state === "no-reply").length;
  const extra = rows.filter((r) => r.state === "extra").length;
  const inKey = right + wrong + abstained + noReply;
  const proposed = right + wrong;

  return {
    right, wrong, abstained, noReply, extra, inKey, proposed,
    precision: ratio(right, proposed),
    recall: ratio(right, inKey),
    abstention: ratio(abstained, inKey),
    coverage: ratio(proposed + abstained, inKey),
  };
}

/* ------------------------------------------------------------- the report */

/**
 * Print it, and say whether the run passed.
 *
 * Separated from the scoring above so the scorer can be tested with fixtures
 * that are deliberately wrong. A report that can only ever say 100% is one
 * nobody should believe the day it says something else, and the wrong answers
 * that prove the scorer works cannot live in the directory the runner scores.
 */
export function report() {
  
  const all = fixtures();
  if (all.length === 0) {
    console.error("No drawing fixtures found under fixtures/drawings. That is a failure, not a pass.");
    process.exit(1);
  }
  
  console.log("\n── Drawing reading — precision, recall, abstention, coverage\n");
  
  const everything = [];
  const criticalMisreads = [];
  const byFormat = new Map();
  
  for (const fixture of all) {
    const rows = scoreOne(fixture);
    const format = formatOf(fixture.key);
    everything.push(...rows);
    byFormat.set(format, [...(byFormat.get(format) ?? []), ...rows]);
  
    const t = tally(rows);
    console.log(`  ${fixture.key.id ?? fixture.name}  (${format})`);
    console.log(`    ${t.right} right, ${t.wrong} wrong, ${t.abstained} abstained`
      + `${t.extra ? `, ${t.extra} not in the key` : ""}`
      + `${t.noReply ? `, ${t.noReply} with no recorded reply` : ""}`);
  
    for (const row of rows) {
      if (row.state === "wrong" && CRITICAL.has(row.field)) {
        criticalMisreads.push({ fixture: fixture.key.id ?? fixture.name, ...row });
      }
      if (verbose || (row.state !== "right" && row.state !== "abstained")) {
        const detail = row.state === "wrong"
          ? `read ${JSON.stringify(row.got)}, key says ${JSON.stringify(row.want)}`
            + (row.toleranceGot !== row.toleranceWant
                ? `; tolerance ${JSON.stringify(row.toleranceGot)} vs ${JSON.stringify(row.toleranceWant)}`
                : "")
          : row.state === "extra" ? `proposed ${JSON.stringify(row.got)}, not in the key`
          : row.state;
        console.log(`      ${row.field.padEnd(22)} ${row.state.toUpperCase().padEnd(10)} ${detail}`);
      }
    }
    console.log("");
  }
  
  /* ------------------------------------------------------------- by field */
  
  const fields = new Map();
  for (const row of everything) {
    if (row.state === "extra") continue;
    fields.set(row.field, [...(fields.get(row.field) ?? []), row]);
  }
  
  console.log("  By field");
  console.log("  " + "-".repeat(66));
  console.log(`  ${"field".padEnd(22)}${"precision".padEnd(11)}${"recall".padEnd(11)}`
    + `${"abstention".padEnd(12)}coverage`);
  for (const [field, rows] of [...fields].sort()) {
    const t = tally(rows);
    console.log(`  ${field.padEnd(22)}${t.precision.padEnd(11)}${t.recall.padEnd(11)}`
      + `${t.abstention.padEnd(12)}${t.coverage}`);
  }
  
  console.log("\n  By format");
  console.log("  " + "-".repeat(66));
  for (const [format, rows] of [...byFormat].sort()) {
    const t = tally(rows.filter((r) => r.state !== "extra"));
    console.log(`  ${format.padEnd(22)}${t.precision.padEnd(11)}${t.recall.padEnd(11)}`
      + `${t.abstention.padEnd(12)}${t.coverage}`);
  }
  
  /* --------------------------------------------------------- the two lines */
  
  const overall = tally(everything.filter((r) => r.state !== "extra"));
  
  console.log("\n  " + "-".repeat(66));
  console.log(`  Fixtures                     ${all.length}`);
  console.log(`  Fields in the answer keys    ${overall.inKey}`);
  console.log(`  Proposed                     ${overall.proposed}`);
  console.log(`  Right                        ${overall.right}`);
  console.log(`  Abstained                    ${overall.abstained}`);
  console.log(`  Precision                    ${overall.precision}`);
  console.log(`  Recall                       ${overall.recall}`);
  console.log(`  Critical misreads            ${criticalMisreads.length}   <- must be zero`);
  console.log("  " + "-".repeat(66));
  
  if (criticalMisreads.length > 0) {
    console.log("\n  Every critical misread, in full:\n");
    for (const m of criticalMisreads) {
      console.log(`    ${m.fixture} · ${m.field}`);
      console.log(`      read ${JSON.stringify(m.got)}, the drawing says ${JSON.stringify(m.want)}`);
    }
  }
  
  /* The sentence that has to survive a good-looking report. */
  console.log(
    "\n  What this does NOT establish. These are synthetic fixtures with recorded"
  + "\n  replies. specs/03: \"Synthetic pack fixtures test routing and evaluator"
  + "\n  behavior only.\" Production accuracy needs held-out real drawings at"
  + "\n  several quality levels, which this repository does not have — so the"
  + "\n  production gate in specs/03 is BLOCKED, whatever the figures above say."
  + "\n  Every extracted value still requires human confirmation.\n");
  
  if (criticalMisreads.length > 0) {
    console.error(`FAIL — ${criticalMisreads.length} critical misread(s).`);
    process.exit(1);
  }
  if (overall.proposed === 0) {
    console.error("FAIL — nothing was proposed at all, so this measured nothing.");
    process.exit(1);
  }
  console.log(`PASS — no critical misread across ${all.length} fixture(s).\n`);
  
}

/* Run only when this file is what node was asked to run. */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) report();
