/**
 * The opportunity radar.
 *
 * A radar is where a system is most tempted to look busy. Most of these tests
 * are about it staying quiet: a signal needing data nobody recorded must not
 * fire, an anecdote must not become a pattern, and an empty result must say
 * which of the two things it means.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scanOpportunities, SEVERITY, THRESHOLDS } from "../../src/calc/radar.mjs";
import { analyseSpend, parseSpendCsv } from "../../src/calc/spend.mjs";
import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { recordOutcome } from "../../src/calc/outcome.mjs";
import { comparablePart } from "../../src/calc/comparable.mjs";
import { upsertSupplier } from "../../src/domain/registry.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";

const gbp = (x) => moneyFromDecimal(x, "GBP");
const kinds = (r) => r.opportunities.map((o) => o.kind);
const byKind = (r, k) => r.opportunities.find((o) => o.kind === k);

/* One dominant supplier plus a long tail. */
const CONCENTRATED = "Supplier,Category,Amount\nAlpha Castings Ltd,Castings,820000\nBravo,Fasteners,40000\n" +
  Array.from({ length: 12 }, (_, i) => `Tail${i},Misc,${900 + i}`).join("\n");
const spendOf = (csv) => analyseSpend(parseSpendCsv(csv));

const DRIVER = [{ id: "freight", label: "Freight", weight: pc("12"), indexMovement: pc("10") }];
const bridge = (requested) => costBridge({
  baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
  requestedChange: pc(requested), drivers: DRIVER,
});
const outcome = (at, requested, agreed, supplier = "Alpha Castings Ltd") => recordOutcome({
  bridge: bridge(requested), agreedChange: pc(agreed),
  meta: { supplier, recordedAt: at, caseId: "case-" + at },
});

const FULL = {
  material: "AL 6082", specification: "BS EN 573", process: "CNC milling", rawForm: "bar",
  tolerance: "IT9", heatTreatment: "T6", inspection: "AQL 2.5", certification: "3.1",
  sizeBand: "small", volumeBand: "50k", surfaceFinish: "anodised", geography: "UK",
};
const partOf = (ref, price, over = {}, vol = 50_000) =>
  comparablePart({ ref, attributes: { ...FULL, ...over }, unitPrice: gbp(price), annualVolume: vol });

describe("it stays quiet when there is nothing to look at", () => {
  const empty = scanOpportunities({});

  test("an empty corpus raises nothing", () => {
    assert.deepEqual(empty.opportunities, []);
    assert.equal(empty.counts.total, 0);
  });

  test("and says which of the two things that means", () => {
    // "Nothing wrong" and "nothing recorded" look identical without this.
    assert.match(empty.headline, /nothing recorded to look at/);
    assert.ok(empty.blindSpots.length >= 4);
    assert.ok(empty.blindSpots.some((b) => /No spend data/.test(b)));
    assert.ok(empty.blindSpots.some((b) => /No outcomes recorded/.test(b)));
  });

  test("contract windows are declared as unchecked, not silently skipped", () => {
    // Nothing creates a Contract entity, so these signals have no source.
    assert.ok(empty.blindSpots.some((b) => /Contract dates are not held anywhere/.test(b)));
  });

  test("nothing at all is handled", () => {
    assert.equal(scanOpportunities().counts.total, 0);
    assert.equal(scanOpportunities({ outcomes: null, cases: null, parts: null }).counts.total, 0);
  });
});

describe("concentration and tail", () => {
  const r = scanOpportunities({ spend: spendOf(CONCENTRATED) });

  test("a concentrated book is raised with the index that decided it", () => {
    const c = byKind(r, "supplier-concentration");
    assert.equal(c.severity, SEVERITY.HIGH);
    assert.match(c.why, new RegExp(`at or above the ${THRESHOLDS.concentrationHigh}`));
    assert.equal(str(c.valueAtStake), "820000.00");
  });

  test("it says what it cannot know", () => {
    assert.match(byKind(r, "supplier-concentration").missing[0], /Whether an alternative exists/);
  });

  test("a long tail is raised, but low", () => {
    const t = byKind(r, "tail-spend");
    assert.equal(t.severity, SEVERITY.LOW);
    assert.match(t.title, /12 suppliers/);
  });

  test("a healthy book raises neither", () => {
    const even = "Supplier,Category,Amount\n" +
      Array.from({ length: 10 }, (_, i) => `S${i},Cat,100000`).join("\n");
    const q = scanOpportunities({ spend: spendOf(even) });
    assert.equal(kinds(q).includes("supplier-concentration"), false);
    assert.equal(kinds(q).includes("tail-spend"), false);
  });

  test("unreadable spend produces nothing rather than an error", () => {
    assert.equal(scanOpportunities({ spend: analyseSpend(parseSpendCsv("nonsense")) }).counts.total, 0);
  });
});

describe("an anecdote is not a pattern", () => {
  test("two claims raise nothing about behaviour", () => {
    const r = scanOpportunities({ outcomes: [outcome("2024-01", "9", "8"), outcome("2025-01", "9", "8")] });
    assert.equal(kinds(r).includes("asks-above-the-evidence"), false);
    assert.equal(kinds(r).includes("unevidenced-driver-repeated"), false);
  });

  test("three claims do", () => {
    const r = scanOpportunities({
      outcomes: [outcome("2024-01", "9", "8"), outcome("2025-01", "9", "8"), outcome("2026-01", "9", "8")],
    });
    const o = byKind(r, "asks-above-the-evidence");
    assert.ok(o);
    assert.match(o.why, /Across 3 recorded claims/);
  });

  test("the threshold is stated rather than buried", () => {
    assert.equal(THRESHOLDS.minimumClaims, 3);
  });

  test("a supplier asking close to the evidence is not flagged", () => {
    // 1.20% over is below the 2.00 point threshold.
    const r = scanOpportunities({
      outcomes: ["2024-01", "2025-01", "2026-01"].map((at) => outcome(at, "2.4", "2.4")),
    });
    assert.equal(kinds(r).includes("asks-above-the-evidence"), false);
  });
});

describe("a driver claimed every round and never evidenced", () => {
  const r = scanOpportunities({
    outcomes: ["2024-01", "2025-01", "2026-01"].map((at) => outcome(at, "9", "8")),
  });

  test("it is raised as high, with the count", () => {
    const d = byKind(r, "unevidenced-driver-repeated");
    assert.equal(d.severity, SEVERITY.HIGH);
    assert.match(d.why, /appeared in all 3 recorded claims and carried evidence in none/);
  });

  test("the action is the specific question to ask", () => {
    assert.match(byKind(r, "unevidenced-driver-repeated").action, /Ask for the Freight breakdown/);
  });
});

describe("exposure sitting in open cases", () => {
  const openCase = (ref) => ({
    id: ref, ref, status: "analysed",
    summary: { annualUnsupportedMinor: 250_000_00n, currency: "GBP" },
  });

  test("it is raised with the amount and the count", () => {
    const r = scanOpportunities({ cases: [openCase("A"), openCase("B")] });
    const e = byKind(r, "exposure-in-flight");
    assert.equal(str(e.valueAtStake), "500000.00");
    assert.match(e.why, /across 2 open case\(s\)/);
  });

  test("uncalculated cases are declared rather than counted as zero", () => {
    const r = scanOpportunities({ cases: [openCase("A"), { id: "B", status: "analysed" }] });
    assert.match(byKind(r, "exposure-in-flight").missing[0], /1 open case\(s\) have not been calculated/);
  });

  test("a thin corpus of outcomes is itself raised", () => {
    const r = scanOpportunities({
      outcomes: [outcome("2025-01", "9", "8")],
      cases: [{ id: "a", status: "analysed" }, { id: "b", status: "closed" }],
    });
    const c = byKind(r, "outcomes-not-recorded");
    assert.ok(c, "the radar rests on recorded outcomes and should say when there are few");
    assert.match(c.action, /the only input that compounds/);
  });
});

describe("a comparable priced lower", () => {
  test("it is raised with the unexplained amount annualised", () => {
    const r = scanOpportunities({
      parts: [partOf("BRK-A", "12.40"), partOf("BRK-B", "9.80", { tolerance: "IT11" })],
    });
    const g = byKind(r, "comparable-priced-lower");
    assert.equal(g.subject, "BRK-A");
    assert.equal(str(g.valueAtStake), "130000.00");
  });

  test("it is a question, never a verdict", () => {
    const r = scanOpportunities({ parts: [partOf("BRK-A", "12.40"), partOf("BRK-B", "9.80")] });
    const g = byKind(r, "comparable-priced-lower");
    assert.match(g.action, /It is a question, not a finding that the part is mispriced/);
    assert.equal(/overpriced/.test(g.title + g.why + g.action), false);
  });

  test("a pair is raised once, not from both directions", () => {
    const r = scanOpportunities({ parts: [partOf("BRK-A", "12.40"), partOf("BRK-B", "9.80")] });
    assert.equal(r.opportunities.filter((o) => o.kind === "comparable-priced-lower").length, 1);
  });

  test("a barely-compared pair raises nothing", () => {
    // Two parts agreeing on one attribute is not evidence of a pricing problem.
    const thin = comparablePart({ ref: "THIN", attributes: { material: "AL 6082" }, unitPrice: gbp("2.00") });
    const r = scanOpportunities({ parts: [partOf("BRK-A", "12.40"), thin] });
    assert.equal(kinds(r).includes("comparable-priced-lower"), false);
  });

  test("one priced part compares with nothing", () => {
    const r = scanOpportunities({ parts: [partOf("BRK-A", "12.40")] });
    assert.equal(kinds(r).includes("comparable-priced-lower"), false);
    assert.ok(r.blindSpots.some((b) => /Fewer than two priced parts/.test(b)));
  });

  test("the cheaper part does not raise a finding about itself", () => {
    const r = scanOpportunities({ parts: [partOf("BRK-A", "12.40"), partOf("BRK-B", "9.80")] });
    assert.equal(byKind(r, "comparable-priced-lower").subject, "BRK-A");
  });
});

describe("possible duplicate suppliers", () => {
  test("a suffix-only difference is surfaced, not merged", () => {
    let { suppliers } = upsertSupplier([], "Meridian Fabrication Ltd");
    suppliers = upsertSupplier(suppliers, "Meridian Fabrication GmbH").suppliers;
    const d = byKind(scanOpportunities({ suppliers }), "possible-duplicate-supplier");
    assert.ok(d);
    assert.match(d.action, /Merging pools their negotiating history/);
    assert.match(d.missing[0], /Whether they are one legal entity/);
  });

  test("unrelated suppliers raise nothing", () => {
    let { suppliers } = upsertSupplier([], "Alpha Castings Ltd");
    suppliers = upsertSupplier(suppliers, "Bravo Fasteners Ltd").suppliers;
    assert.equal(kinds(scanOpportunities({ suppliers })).includes("possible-duplicate-supplier"), false);
  });
});

describe("ordering and totals", () => {
  const r = scanOpportunities({
    spend: spendOf(CONCENTRATED),
    outcomes: ["2024-01", "2025-01", "2026-01"].map((at) => outcome(at, "9", "8")),
  });

  test("pressing things come first", () => {
    const ranks = r.opportunities.map((o) => o.severity);
    assert.equal(ranks[0], SEVERITY.HIGH);
    assert.equal(ranks.at(-1), SEVERITY.LOW);
  });

  test("a finding with no figure is not buried beneath small ones", () => {
    // Not knowing what something is worth is not evidence it is worth little.
    const withoutValue = r.opportunities.findIndex((o) => o.severity === SEVERITY.HIGH && !o.valueAtStake);
    const lowWithValue = r.opportunities.findIndex((o) => o.severity === SEVERITY.LOW);
    assert.ok(withoutValue >= 0 && withoutValue < lowWithValue);
  });

  test("nothing is totalled, and the method says why", () => {
    assert.equal(r.total, undefined);
    assert.equal(r.valueAtStake, undefined);
    assert.match(r.method, /Amounts are not totalled/);
    assert.match(r.method, /appears in more than one finding by design/);
  });

  test("every finding carries its rule, its evidence and an action", () => {
    for (const o of r.opportunities) {
      assert.ok(o.why && o.why.length > 20, `${o.id} has no stated rule`);
      assert.ok(o.action && o.action.length > 20, `${o.id} has no action`);
      assert.ok(Array.isArray(o.evidence) && o.evidence.length, `${o.id} cites nothing`);
      assert.ok(["high", "medium", "low"].includes(o.severity));
    }
  });

  test("money is exact where it is quoted at all", () => {
    for (const o of r.opportunities) {
      if (o.valueAtStake) assert.equal(typeof o.valueAtStake.minor, "bigint");
    }
  });
});
