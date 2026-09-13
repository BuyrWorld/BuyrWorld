import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { costBridge, formatPercent as P } from "../../src/calc/cost-bridge.mjs";
import { recordOutcome, VERDICT } from "../../src/calc/outcome.mjs";
import { supplierHistory, historyBySupplier } from "../../src/calc/supplier-history.mjs";
import { evidence, EVIDENCE_KIND as K } from "../../src/calc/evidence.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";

const gbp = (x) => moneyFromDecimal(x, "GBP");

const evidenced = {
  weight: evidence(K.DOCUMENT, { label: "breakdown", quote: "42% material" }),
  movement: evidence(K.PUBLISHED, { label: "synthetic index" }),
};

/** One claim: £100 a unit, 50,000 a year. */
function claim({ requested, drivers, currency = "GBP" }) {
  return costBridge({
    baseline: { unitPrice: moneyFromDecimal("100.00", currency), annualVolume: 50_000 },
    requestedChange: pc(requested),
    drivers,
  });
}

function outcome({ requested, agreed, drivers, supplier = "Alpha Castings Ltd", at, args = [], currency = "GBP", category = "Castings" }) {
  return recordOutcome({
    bridge: claim({ requested, drivers, currency }),
    agreedChange: pc(agreed),
    argumentsUsed: args,
    meta: { supplier, category, caseRef: `C-${at}`, recordedAt: at },
  });
}

/* Three rounds against one supplier.
   Freight is claimed every round and never evidenced. Steel is claimed every
   round and is evidenced from the second onwards. */
const FREIGHT = { id: "freight", label: "Freight", weight: pc("12"), indexMovement: pc("10") };
const STEEL_BARE = { id: "steel", label: "Steel bar", weight: pc("40"), indexMovement: pc("10") };
const STEEL_EV = { ...STEEL_BARE, evidence: evidenced };

const RECORDS = [
  // 2024: asked 8.00, warranted 5.20, agreed 6.50 -> 1.30 above the evidence
  outcome({ at: "2024-03", requested: "8", agreed: "6.5", drivers: [STEEL_BARE, FREIGHT],
            args: [{ id: "base-period", description: "Challenged the base period", worked: true },
                   { id: "volume", description: "Offered volume", worked: false }] }),
  // 2025: asked 7.00, warranted 5.20, agreed 5.20 -> at the evidenced position
  outcome({ at: "2025-04", requested: "7", agreed: "5.2", drivers: [STEEL_EV, FREIGHT],
            args: [{ id: "base-period", description: "Challenged the base period", worked: true }] }),
  // 2026: asked 9.00, warranted 5.20, agreed 9.00 -> conceded in full
  outcome({ at: "2026-05", requested: "9", agreed: "9", drivers: [STEEL_EV, FREIGHT],
            args: [{ id: "escalation", description: "Escalated to the category owner", worked: false }] }),
];

const H = () => supplierHistory(RECORDS, "Alpha Castings Ltd");

describe("finding a supplier's record", () => {
  test("matching ignores case and surrounding space", () => {
    assert.equal(supplierHistory(RECORDS, "  alpha castings ltd ").count, 3);
  });

  test("an unknown supplier is an absence of records, not an absence of claims", () => {
    const h = supplierHistory(RECORDS, "Someone Else Ltd");
    assert.equal(h.count, 0);
    assert.match(h.note, /only that none was recorded/);
  });

  test("no name asked for is refused rather than matched against everything", () => {
    assert.equal(supplierHistory(RECORDS, "").count, 0);
    assert.equal(supplierHistory(RECORDS, null).count, 0);
  });

  test("no records at all is handled", () => {
    assert.equal(supplierHistory([], "Alpha Castings Ltd").count, 0);
    assert.equal(supplierHistory(undefined, "Alpha").count, 0);
  });

  test("claims come back oldest first, numbered", () => {
    const h = H();
    assert.deepEqual(h.claims.map((c) => c.at), ["2024-03", "2025-04", "2026-05"]);
    assert.deepEqual(h.claims.map((c) => c.round), [1, 2, 3]);
  });

  test("order is by date, not by the order they were handed in", () => {
    const shuffled = [RECORDS[2], RECORDS[0], RECORDS[1]];
    assert.deepEqual(supplierHistory(shuffled, "Alpha Castings Ltd").claims.map((c) => c.at),
      ["2024-03", "2025-04", "2026-05"]);
  });
});

describe("what each round says", () => {
  const h = H();

  test("the three positions are carried through", () => {
    assert.equal(P(h.claims[0].requested), "8.00%");
    assert.equal(P(h.claims[0].warranted), "5.20%");
    assert.equal(P(h.claims[0].agreed), "6.50%");
  });

  test("conceding above the evidenced position is measured, and priced", () => {
    assert.equal(P(h.claims[0].concededAboveWarranted), "1.30%");
    assert.equal(str(h.claims[0].concededAboveWarrantedAnnual), "65000.00");   // 1.30% of £5m
  });

  test("landing at the evidenced position concedes nothing above it", () => {
    assert.equal(h.claims[1].verdict, VERDICT.AT);
    assert.equal(h.claims[1].concededAboveWarranted, 0n);
    assert.equal(str(h.claims[1].concededAboveWarrantedAnnual), "0.00");
  });

  test("conceding the whole ask is recorded as exactly that", () => {
    assert.equal(h.claims[2].verdict, VERDICT.CONCEDED_UNSUPPORTED);
    assert.equal(P(h.claims[2].concededAboveWarranted), "3.80%");
    assert.equal(str(h.claims[2].avoidedAnnual), "0.00");
  });
});

describe("the pattern across rounds", () => {
  const h = H();

  test("it counts how the settlements landed", () => {
    assert.equal(h.counts.claims, 3);
    assert.equal(h.counts.aboveEvidencedPosition, 2);
    assert.equal(h.counts.atEvidencedPosition, 1);
    assert.equal(h.counts.concededUnsupportedInFull, 1);
    assert.equal(h.counts.betterThanEvidenced, 0);
  });

  test("the average over-ask is the opening this supplier uses", () => {
    // (8.00-5.20) + (7.00-5.20) + (9.00-5.20) = 2.80 + 1.80 + 3.80, over 3
    assert.equal(P(h.averages.overAsk), "2.80%");
    assert.equal(P(h.averages.requested), "8.00%");
    assert.equal(P(h.averages.warranted), "5.20%");
  });

  test("averages of an empty set are null rather than zero", () => {
    assert.equal(supplierHistory([], "x").averages, undefined);
    assert.equal(H().averages.requested !== null, true);
  });
});

describe("the repeat driver", () => {
  const h = H();
  const d = (id) => h.drivers.find((x) => x.id === id);

  test("a driver claimed every round and never evidenced is found", () => {
    assert.equal(d("freight").timesClaimed, 3);
    assert.equal(d("freight").timesEvidenced, 0);
    assert.equal(d("freight").everEvidenced, false);
    assert.equal(d("freight").claimedEveryRound, true);
  });

  test("a driver that started carrying evidence is not tarred with the same brush", () => {
    assert.equal(d("steel").timesClaimed, 3);
    assert.equal(d("steel").timesEvidenced, 2);
    assert.equal(d("steel").everEvidenced, true);
  });

  test("drivers are ordered by how often they are claimed", () => {
    for (let i = 1; i < h.drivers.length; i++) {
      assert.ok(h.drivers[i - 1].timesClaimed >= h.drivers[i].timesClaimed);
    }
  });

  test("one round cannot establish 'every round'", () => {
    const one = supplierHistory([RECORDS[0]], "Alpha Castings Ltd");
    assert.equal(one.drivers.find((x) => x.id === "freight").claimedEveryRound, false,
      "a single claim is an occasion, not a pattern");
  });

  test("records written before drivers were retained contribute nothing rather than counting as unevidenced", () => {
    const old = { ...RECORDS[0], claim: undefined };
    const h2 = supplierHistory([old, RECORDS[1]], "Alpha Castings Ltd");
    assert.equal(h2.driverRoundsAvailable, 1, "only the newer record carries drivers");
    assert.equal(h2.drivers.find((x) => x.id === "freight").timesClaimed, 1);
  });
});

describe("arguments that moved this supplier", () => {
  const h = H();

  test("it counts uses and successes for this supplier only", () => {
    const base = h.argumentsThatWorked.find((a) => a.id === "base-period");
    assert.equal(base.used, 2);
    assert.equal(base.worked, 2);
    assert.equal(P(base.rate), "100.00%");
  });

  test("an argument that has never worked is still listed, honestly", () => {
    const esc = h.argumentsThatWorked.find((a) => a.id === "escalation");
    assert.equal(esc.worked, 0);
    assert.equal(P(esc.rate), "0.00%");
  });

  test("what worked sorts above what did not", () => {
    assert.equal(h.argumentsThatWorked[0].id, "base-period");
  });
});

describe("money is never summed across currencies", () => {
  test("one currency gives one total", () => {
    const h = H();
    assert.equal(h.totals.length, 1);
    assert.equal(h.mixedCurrency, false);
    assert.equal(h.totals[0].currency, "GBP");
    // 1.50% avoided in 2024, 1.80% in 2025, 0% in 2026, all of £5m
    assert.equal(str(h.totals[0].avoided), "165000.00");
    assert.equal(str(h.totals[0].concededAboveWarranted), "255000.00");   // £65,000 + £190,000
  });

  test("two currencies give two totals and say so", () => {
    const mixed = [
      RECORDS[0],
      outcome({ at: "2025-09", requested: "7", agreed: "6", drivers: [STEEL_BARE], currency: "EUR" }),
    ];
    const h = supplierHistory(mixed, "Alpha Castings Ltd");
    assert.equal(h.mixedCurrency, true);
    assert.deepEqual(h.totals.map((t) => t.currency).sort(), ["EUR", "GBP"]);
    for (const t of h.totals) assert.equal(t.avoided.currency, t.currency);
  });
});

describe("the headline", () => {
  test("it names the over-ask, the settlements and the unevidenced repeat", () => {
    const h = H();
    assert.match(h.headline, /3 claims recorded/);
    assert.match(h.headline, /ask 2\.80% more than the evidence supports/);
    assert.match(h.headline, /2 of 3 settled above the evidenced position/);
    assert.match(h.headline, /Freight (has|have) been claimed every round and never evidenced/);
  });

  test("a clean record does not get a manufactured accusation", () => {
    // Steel alone warrants 4.00%: 40% weight x 10% movement. Freight is what
    // takes the evidenced figure to 5.20% in the three-round fixture.
    const clean = [outcome({ at: "2025-01", requested: "5.2", agreed: "4", drivers: [STEEL_EV] })];
    const h = supplierHistory(clean, "Alpha Castings Ltd");
    assert.match(h.headline, /None settled above the evidenced position/);
    assert.equal(/never evidenced/.test(h.headline), false);
  });

  test("the method says this is history, not a forecast", () => {
    assert.match(H().method, /history, not a forecast/);
    assert.match(H().method, /never added across them/);
  });
});

describe("every supplier at once", () => {
  const many = [
    ...RECORDS,
    outcome({ at: "2025-02", requested: "6", agreed: "4", drivers: [STEEL_EV], supplier: "Bravo Fasteners Ltd" }),
    outcome({ at: "2026-02", requested: "6", agreed: "4", drivers: [STEEL_EV], supplier: "Bravo Fasteners Ltd" }),
  ];

  test("each supplier gets its own history", () => {
    const all = historyBySupplier(many);
    assert.equal(all.length, 2);
    assert.deepEqual(all.map((h) => h.count).sort(), [2, 3]);
  });

  test("the supplier that keeps winning sorts first, not the biggest spender", () => {
    const all = historyBySupplier(many);
    assert.equal(all[0].supplier, "Alpha Castings Ltd");
    assert.equal(all[0].counts.aboveEvidencedPosition, 2);
    assert.equal(all[1].counts.aboveEvidencedPosition, 0);
  });

  test("records with no supplier are skipped rather than grouped under a blank", () => {
    const anon = recordOutcome({
      bridge: claim({ requested: "5", drivers: [STEEL_EV] }), agreedChange: pc("5"), meta: {},
    });
    assert.equal(historyBySupplier([...many, anon]).length, 2);
  });

  test("no records is an empty list, not a thrown error", () => {
    assert.deepEqual(historyBySupplier([]), []);
    assert.deepEqual(historyBySupplier(null), []);
  });
});
