import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { costBridge, formatPercent as P } from "../../src/calc/cost-bridge.mjs";
import { recordOutcome } from "../../src/calc/outcome.mjs";
import { portfolio } from "../../src/calc/portfolio.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";

/* £100 a unit, 50,000 a year — a £5,000,000 line, so a percentage point is
   £50,000 and every figure below can be checked in your head. */
const DRIVERS = [{ id: "steel", label: "Steel bar", weight: pc("40"), indexMovement: pc("10") }];

function bridgeFor(requested, currency = "GBP") {
  return costBridge({
    baseline: { unitPrice: moneyFromDecimal("100.00", currency), annualVolume: 50_000 },
    requestedChange: pc(requested),
    drivers: DRIVERS,
  });
}

/** warranted is always 4.00% here: 40% weight x 10% movement. */
function outcome({ requested, agreed, supplier = "Alpha Castings Ltd", currency = "GBP", at = "2026-01" }) {
  return recordOutcome({
    bridge: bridgeFor(requested, currency),
    agreedChange: pc(agreed),
    meta: { supplier, recordedAt: at, caseRef: "C-" + at },
  });
}

const caseRec = (status, over = {}) => ({ id: "id-" + Math.random(), status, ...over });
const withFigures = (status, unsupportedMinor, currency = "GBP") =>
  caseRec(status, { summary: { annualUnsupportedMinor: unsupportedMinor, currency } });

describe("nothing recorded", () => {
  const p = portfolio({});

  test("it says so rather than reporting zeroes as a result", () => {
    assert.equal(p.outcomes, 0);
    assert.deepEqual(p.resisted, []);
    assert.match(p.headline, /No outcomes recorded yet/);
    assert.match(p.headline, /until a case is closed/);
  });

  test("coverage is unknown, not complete", () => {
    assert.equal(p.coverage.rate, null);
    assert.equal(p.coverage.complete, false);
  });

  test("no arguments invented", () => {
    assert.deepEqual(p.arguments, []);
    assert.equal(p.landed, null);
  });
});

describe("the resisted rate", () => {
  test("holding at the evidenced position resists all of it", () => {
    // Asked 9%, evidenced 4%, agreed 4% -> the whole 5pp unevidenced ask kept.
    const p = portfolio({ outcomes: [outcome({ requested: "9", agreed: "4" })] });
    const [r] = p.resisted;
    assert.equal(str(r.unsupported), "250000.00");   // 5pp of £5m
    assert.equal(str(r.kept), "250000.00");
    assert.equal(str(r.conceded), "0.00");
    assert.equal(P(r.rate), "100.00%");
  });

  test("conceding the whole ask resists none of it", () => {
    const p = portfolio({ outcomes: [outcome({ requested: "9", agreed: "9" })] });
    const [r] = p.resisted;
    assert.equal(str(r.kept), "0.00");
    assert.equal(str(r.conceded), "250000.00");
    assert.equal(P(r.rate), "0.00%");
  });

  test("splitting the difference resists half", () => {
    // Asked 9%, evidenced 4%, agreed 6.5% -> 2.5pp kept of a 5pp remainder.
    const p = portfolio({ outcomes: [outcome({ requested: "9", agreed: "6.5" })] });
    const [r] = p.resisted;
    assert.equal(str(r.kept), "125000.00");
    assert.equal(str(r.conceded), "125000.00");
    assert.equal(P(r.rate), "50.00%");
  });

  test("kept and conceded always reconcile to the unevidenced amount", () => {
    const p = portfolio({
      outcomes: [
        outcome({ requested: "9", agreed: "4" }),
        outcome({ requested: "7", agreed: "6" }),
        outcome({ requested: "9", agreed: "9" }),
      ],
    });
    const [r] = p.resisted;
    assert.equal(r.kept.minor + r.conceded.minor, r.unsupported.minor);
  });

  test("a settlement below the evidenced position cannot push the rate over 100%", () => {
    // Asked 5%, evidenced 4%, agreed 1% — a good result, but only 1pp of it is
    // resistance to the unevidenced part. Counting the rest would let one
    // generous supplier make the measurement meaningless.
    const p = portfolio({ outcomes: [outcome({ requested: "5", agreed: "1" })] });
    const [r] = p.resisted;
    assert.equal(str(r.unsupported), "50000.00");    // 1pp
    assert.equal(str(r.kept), "50000.00");           // capped at the 1pp
    assert.equal(P(r.rate), "100.00%");
  });

  test("a fully evidenced claim has nothing to resist and no rate", () => {
    const p = portfolio({ outcomes: [outcome({ requested: "4", agreed: "4" })] });
    const [r] = p.resisted;
    assert.equal(str(r.unsupported), "0.00");
    assert.equal(r.rate, null, "0 of 0 is not 0%");
    assert.match(p.headline, /no unevidenced amount was in dispute/);
  });

  test("the rate is the pooled amount, not the mean of the rates", () => {
    // A £5m case resisted in full and a £5m case conceded in full is 50%.
    const p = portfolio({
      outcomes: [outcome({ requested: "9", agreed: "4" }), outcome({ requested: "9", agreed: "9" })],
    });
    assert.equal(P(p.resisted[0].rate), "50.00%");
    assert.equal(str(p.resisted[0].unsupported), "500000.00");
  });
});

describe("money is never added across currencies", () => {
  const p = portfolio({
    outcomes: [
      outcome({ requested: "9", agreed: "4" }),
      outcome({ requested: "9", agreed: "9", currency: "EUR" }),
    ],
  });

  test("each currency gets its own row and its own rate", () => {
    assert.equal(p.resisted.length, 2);
    const gbp = p.resisted.find((r) => r.currency === "GBP");
    const eur = p.resisted.find((r) => r.currency === "EUR");
    assert.equal(P(gbp.rate), "100.00%");
    assert.equal(P(eur.rate), "0.00%");
  });

  test("the biggest exposure leads", () => {
    assert.equal(p.resisted[0].unsupported.minor >= p.resisted[1].unsupported.minor, true);
  });

  test("a supplier whose claims span currencies reports no total at all", () => {
    const mixed = portfolio({
      outcomes: [
        outcome({ requested: "9", agreed: "9", supplier: "Split Ltd" }),
        outcome({ requested: "9", agreed: "9", supplier: "Split Ltd", currency: "EUR" }),
      ],
    });
    const s = mixed.suppliers.find((x) => x.supplier === "Split Ltd");
    assert.equal(s.mixedCurrency, true);
    assert.equal(s.unsupported, null, "one number across two currencies would be worse than none");
    assert.equal(s.rate, null);
    assert.equal(s.claims, 2);
  });
});

describe("coverage, stated in the same breath as the number", () => {
  test("two outcomes against eleven analysed cases is not a track record", () => {
    const cases = [
      ...Array.from({ length: 9 }, () => caseRec("analysed")),
      caseRec("closed"), caseRec("closed"),
    ];
    const p = portfolio({
      outcomes: [outcome({ requested: "9", agreed: "4" }), outcome({ requested: "9", agreed: "4" })],
      cases,
    });
    assert.equal(p.coverage.analysed, 11);
    assert.equal(p.coverage.closed, 2);
    assert.equal(P(p.coverage.rate), "18.18%");
    assert.equal(p.coverage.complete, false);
    assert.match(p.headline, /Based on 2 of 11 analysed cases; the rest have no outcome recorded/);
  });

  test("drafts are not counted as analysed work", () => {
    const p = portfolio({ cases: [caseRec("draft"), caseRec("draft"), caseRec("closed")] });
    assert.equal(p.coverage.analysed, 1);
    assert.equal(p.coverage.casesKnown, 3);
  });

  test("a complete corpus says nothing apologetic", () => {
    const p = portfolio({ outcomes: [outcome({ requested: "9", agreed: "4" })], cases: [caseRec("closed")] });
    assert.equal(p.coverage.complete, true);
    assert.equal(/Based on/.test(p.headline), false);
  });

  test("outcomes with no cases to compare against give no coverage rate", () => {
    // An outcomes file imported on its own says nothing about what went unrecorded.
    const p = portfolio({ outcomes: [outcome({ requested: "9", agreed: "4" })] });
    assert.equal(p.coverage.rate, null);
    assert.equal(p.coverage.complete, false);
  });
});

describe("what is still open", () => {
  test("open cases are counted by status", () => {
    const p = portfolio({ cases: [caseRec("draft"), caseRec("analysed"), caseRec("closed")] });
    assert.equal(p.openCases, 2);
    assert.equal(p.byStatus.draft, 1);
    assert.equal(p.byStatus.closed, 1);
  });

  test("exposure in flight is totalled from the cases that carry figures", () => {
    const p = portfolio({ cases: [withFigures("analysed", 250_000_00n), withFigures("decided", 100_000_00n)] });
    assert.equal(p.inFlight.length, 1);
    assert.equal(str(p.inFlight[0].unsupported), "350000.00");
    assert.equal(p.inFlight[0].cases, 2);
  });

  test("a case that has not been calculated contributes nothing and is declared", () => {
    // An unknown is not a zero, and a silent one would understate the exposure.
    const p = portfolio({ cases: [withFigures("analysed", 250_000_00n), caseRec("draft")] });
    assert.equal(str(p.inFlight[0].unsupported), "250000.00");
    assert.equal(p.openWithoutFigures, 1);
  });

  test("closed cases are not in flight", () => {
    const p = portfolio({ cases: [withFigures("closed", 999_999_00n)] });
    assert.deepEqual(p.inFlight, []);
    assert.equal(p.openCases, 0);
  });

  test("in-flight money is also kept per currency", () => {
    const p = portfolio({
      cases: [withFigures("analysed", 100_00n), withFigures("analysed", 200_00n, "EUR")],
    });
    assert.equal(p.inFlight.length, 2);
  });
});

describe("where the money is going", () => {
  const p = portfolio({
    outcomes: [
      outcome({ requested: "9", agreed: "9", supplier: "Alpha Castings Ltd" }),   // conceded 5pp
      outcome({ requested: "9", agreed: "9", supplier: "Alpha Castings Ltd" }),   // conceded 5pp
      outcome({ requested: "9", agreed: "6.5", supplier: "Bravo Fasteners Ltd" }), // conceded 2.5pp
      outcome({ requested: "9", agreed: "4", supplier: "Charlie Coatings" }),      // conceded nothing
    ],
  });

  test("suppliers are ranked by what was conceded, not by what was spent", () => {
    assert.deepEqual(p.suppliers.map((s) => s.supplier),
      ["Alpha Castings Ltd", "Bravo Fasteners Ltd", "Charlie Coatings"]);
    assert.equal(str(p.suppliers[0].conceded), "500000.00");
  });

  test("each supplier carries its own resisted rate", () => {
    assert.equal(P(p.suppliers[0].rate), "0.00%");
    assert.equal(P(p.suppliers[1].rate), "50.00%");
    assert.equal(P(p.suppliers[2].rate), "100.00%");
  });

  test("settling above the evidenced position is counted", () => {
    assert.equal(p.suppliers[0].aboveEvidenced, 2);
    assert.equal(p.suppliers[2].aboveEvidenced, 0);
  });

  test("an unnamed supplier is grouped honestly rather than dropped", () => {
    const q = portfolio({ outcomes: [outcome({ requested: "9", agreed: "9", supplier: "" })] });
    assert.equal(q.suppliers[0].supplier, "(unnamed)");
  });
});

describe("how settlements landed", () => {
  test("at or below the evidence is separated from above it", () => {
    const p = portfolio({
      outcomes: [
        outcome({ requested: "9", agreed: "4" }),   // at
        outcome({ requested: "9", agreed: "2" }),   // better
        outcome({ requested: "9", agreed: "6" }),   // above
        outcome({ requested: "9", agreed: "9" }),   // conceded in full
      ],
    });
    assert.equal(p.landed.atOrBelowEvidenced, 2);
    assert.equal(p.landed.aboveEvidenced, 2);
    assert.equal(p.landed.concededInFull, 1);
  });
});

describe("the method disclaims what it is", () => {
  const p = portfolio({ outcomes: [outcome({ requested: "9", agreed: "6" })] });

  test("it explains the cap rather than hiding it", () => {
    assert.match(p.method, /capped per case/);
    assert.match(p.method, /cannot push it above 100%/);
  });

  test("it says coverage qualifies the figure", () => {
    assert.match(p.method, /coverage states how many analysed cases have one/);
  });

  test("it does not let argument success pass as measurement", () => {
    assert.match(p.method, /buyer's judgement recorded at the time, not a measurement/);
  });

  test("it repeats the currency rule", () => {
    assert.match(p.method, /never added across them/);
  });
});

describe("bad input", () => {
  test("no argument at all is handled", () => {
    assert.equal(portfolio().outcomes, 0);
    assert.equal(portfolio({ outcomes: null, cases: null }).outcomes, 0);
  });

  test("every money value is exact BigInt minor units", () => {
    const p = portfolio({
      outcomes: [outcome({ requested: "9", agreed: "6" })],
      cases: [withFigures("analysed", 1234_56n)],
    });
    const seen = [];
    (function walk(v) {
      if (!v || typeof v !== "object") return;
      if (typeof v.minor !== "undefined") { seen.push(v); return; }
      for (const x of Object.values(v)) walk(x);
    })(p);
    assert.ok(seen.length > 4);
    for (const m of seen) assert.equal(typeof m.minor, "bigint");
  });
});
