import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { costBridge, formatPercent as P } from "../../src/calc/cost-bridge.mjs";
import { recordOutcome, summariseOutcomes, VERDICT } from "../../src/calc/outcome.mjs";
import {
  serialise, deserialise, saveOutcome, loadOutcomes, deleteOutcome,
  clearOutcomes, exportOutcomes, importOutcomes, storageAvailable,
} from "../../src/services/outcome-store.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";

const gbp = (x) => moneyFromDecimal(x, "GBP");

const bridge = costBridge({
  baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
  requestedChange: pc("9"),
  drivers: [
    { id: "material", label: "Steel", weight: pc("42"), indexMovement: pc("10") },
    { id: "labour", label: "Labour", weight: pc("18"), indexMovement: pc("5") },
  ],
});
// warranted = 42%x10% + 18%x5% = 5.10%

const base = (over = {}) => recordOutcome({ bridge, agreedChange: pc("4.5"), ...over });

describe("the arithmetic is computed, never typed", () => {
  test("avoided and accepted come from the analysis", () => {
    const o = base();
    assert.equal(P(o.computed.avoidedChange), "4.50%");   // 9.00 - 4.50
    assert.equal(str(o.computed.avoidedAnnual), "225000.00");
    assert.equal(str(o.computed.acceptedAnnual), "225000.00");
  });

  test("agreeing more than was requested is refused", () => {
    assert.throws(() => base({ agreedChange: pc("12") }),
      /exceeds the 9\.00% requested/);
  });

  test("a typed number where a ratio belongs is refused", () => {
    assert.throws(() => base({ agreedChange: 0.045 }),
      /must be a Ratio.*not a figure/s);
  });

  test("exposure uses the exact line value, not a rounded unit delta", () => {
    const awkward = costBridge({
      baseline: { unitPrice: gbp("0.84"), annualVolume: 4_200_000 },
      requestedChange: pc("7.5"),
      drivers: [{ id: "m", label: "M", weight: pc("55"), indexMovement: pc("9") }],
    });
    const o = recordOutcome({ bridge: awkward, agreedChange: pc("5") });
    assert.equal(str(o.computed.avoidedAnnual), "88200.00");   // 3,528,000 x 2.5%
    assert.equal(str(o.computed.acceptedAnnual), "176400.00"); // 3,528,000 x 5%
  });
});

describe("delay is valued, not just noted", () => {
  test("three months of delay is worth a quarter of the accepted increase", () => {
    const o = base({ requestedEffectiveFrom: "2026-09", agreedEffectiveFrom: "2026-12" });
    assert.equal(o.computed.delayMonths, 3);
    assert.equal(str(o.computed.delayValue), "56250.00");        // 225,000 x 3/12
    assert.equal(str(o.computed.totalAvoidedFirstYear), "281250.00");
  });

  test("no delay is worth nothing, and says so", () => {
    const o = base({ requestedEffectiveFrom: "2026-09", agreedEffectiveFrom: "2026-09" });
    assert.equal(o.computed.delayMonths, 0);
    assert.equal(str(o.computed.delayValue), "0.00");
  });

  test("an effective date earlier than requested is a data error", () => {
    assert.throws(() => base({ requestedEffectiveFrom: "2026-12", agreedEffectiveFrom: "2026-09" }),
      /earlier than the requested/);
  });
});

describe("the verdict compares the outcome with the evidence", () => {
  test("below the evidenced position is better than evidenced", () => {
    assert.equal(base({ agreedChange: pc("4.5") }).computed.verdict, VERDICT.BETTER);
  });
  test("exactly the evidenced position", () => {
    assert.equal(base({ agreedChange: pc("5.1") }).computed.verdict, VERDICT.AT);
  });
  test("above it, but short of the full request", () => {
    assert.equal(base({ agreedChange: pc("7") }).computed.verdict, VERDICT.WORSE);
  });
  test("conceding the whole request is named for what it is", () => {
    assert.equal(base({ agreedChange: pc("9") }).computed.verdict, VERDICT.CONCEDED_UNSUPPORTED);
  });
  test("the gap to the evidenced position is reported signed", () => {
    assert.equal(P(base({ agreedChange: pc("4.5") }).computed.versusWarranted), "-0.60%");
    assert.equal(P(base({ agreedChange: pc("7") }).computed.versusWarranted), "1.90%");
  });
});

describe("what it teaches", () => {
  const withArgs = base({
    argumentsUsed: [
      { id: "unexplained-cost", description: "40% of cost unexplained", worked: true },
      { id: "index-lag", description: "movement had not reached the price", worked: true },
      { id: "volume", description: "offered a commitment", worked: false },
    ],
    lessons: "The breakdown request did the work.",
  });

  test("arguments are split by whether they moved the supplier", () => {
    assert.deepEqual([...withArgs.learning.worked], ["unexplained-cost", "index-lag"]);
    assert.deepEqual([...withArgs.learning.didNotWork], ["volume"]);
  });

  test("a one-line headline is produced for the corpus", () => {
    const o = base({ requestedEffectiveFrom: "2026-09", agreedEffectiveFrom: "2026-12" });
    assert.match(o.learning.headline, /9\.00% requested, 5\.10% evidenced, 4\.50% agreed/);
    assert.match(o.learning.headline, /GBP 225000\.00 avoided/);
    assert.match(o.learning.headline, /3 month\(s\) of delay worth GBP 56250\.00/);
  });

  test("a decision is only recorded when someone actually recorded it", () => {
    assert.equal(base().decision.recorded, false);
    assert.equal(base({ decision: { by: "Category owner", at: "2026-09-20" } }).decision.recorded, true);
  });

  test("demonstration data is flagged by default", () => {
    assert.equal(base().meta.synthetic, true);
  });
});

describe("aggregation is the asset", () => {
  const a = base({
    agreedChange: pc("4.5"),
    argumentsUsed: [
      { id: "unexplained-cost", description: "unexplained share", worked: true },
      { id: "volume", description: "volume commitment", worked: false },
    ],
  });
  const b = base({
    agreedChange: pc("6"),
    argumentsUsed: [
      { id: "unexplained-cost", description: "unexplained share", worked: true },
      { id: "volume", description: "volume commitment", worked: true },
    ],
  });

  test("empty is reported honestly, not as zero savings", () => {
    const s = summariseOutcomes([]);
    assert.equal(s.count, 0);
    assert.match(s.note, /cannot be checked against reality until it is/);
  });

  test("arguments rank by how often they actually moved a supplier", () => {
    const s = summariseOutcomes([a, b]);
    assert.equal(s.arguments[0].id, "unexplained-cost");
    assert.equal(s.arguments[0].successRate, 100);
    assert.equal(s.arguments[1].id, "volume");
    assert.equal(s.arguments[1].successRate, 50);
  });

  test("money aggregates per currency, never across", () => {
    const eurBridge = costBridge({
      baseline: { unitPrice: moneyFromDecimal("50.00", "EUR"), annualVolume: 1_000 },
      requestedChange: pc("10"),
      drivers: [{ id: "m", label: "M", weight: pc("50"), indexMovement: pc("10") }],
    });
    const e = recordOutcome({ bridge: eurBridge, agreedChange: pc("5") });
    const s = summariseOutcomes([a, e]);
    assert.equal(s.byCurrency.length, 2, "GBP and EUR must not be added together");
    const gbpRow = s.byCurrency.find((x) => x.currency === "GBP");
    assert.equal(gbpRow.cases, 1);
  });

  test("verdicts are counted, so a run of concessions is visible", () => {
    const s = summariseOutcomes([a, b]);
    assert.equal(s.verdicts[VERDICT.BETTER], 1);
    assert.equal(s.verdicts[VERDICT.WORSE], 1);
  });

  test("the method is stated — a success rate is judgement, not measurement", () => {
    assert.match(summariseOutcomes([a]).method, /a buyer's judgement, not a measurement/);
  });
});

/* ------------------------------------------------------------- storage */

/** A localStorage stand-in, including the ways the real one misbehaves. */
function fakeStore({ throwOnSet = false, throwOnGet = false } = {}) {
  const map = new Map();
  return {
    getItem: (k) => { if (throwOnGet) throw new Error("blocked"); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (throwOnSet) { const e = new Error("exceeded the quota"); e.name = "QuotaExceededError"; throw e; } map.set(k, v); },
    removeItem: (k) => map.delete(k),
  };
}

describe("storage survives the ways browsers misbehave", () => {
  test("BigInt round-trips, which JSON.stringify alone cannot do", () => {
    assert.throws(() => JSON.stringify({ n: 1n }), TypeError, "sanity: plain JSON cannot");
    const back = deserialise(serialise({ n: 12345678901234567890n, s: "plain" }));
    assert.equal(back.n, 12345678901234567890n);
    assert.equal(back.s, "plain");
  });

  test("an outcome survives a save and load intact", () => {
    const s = fakeStore();
    const o = base({ requestedEffectiveFrom: "2026-09", agreedEffectiveFrom: "2026-12" });
    assert.equal(saveOutcome(o, s).ok, true);
    const [back] = loadOutcomes(s);
    assert.equal(back.computed.avoidedAnnual.minor, o.computed.avoidedAnnual.minor);
    assert.equal(back.position.agreed, o.position.agreed);
    assert.equal(back.computed.delayMonths, 3);
  });

  test("a full quota is reported, not swallowed", () => {
    const r = saveOutcome(base(), fakeStore({ throwOnSet: true }));
    assert.equal(r.ok, false);
    assert.match(r.error, /Local storage is full/);
  });

  test("blocked storage returns an empty list rather than throwing", () => {
    assert.deepEqual(loadOutcomes(fakeStore({ throwOnGet: true })), []);
    assert.equal(storageAvailable(fakeStore({ throwOnSet: true })), false);
  });

  test("newest first", () => {
    const s = fakeStore();
    saveOutcome(base({ meta: { caseRef: "first" } }), s);
    saveOutcome(base({ meta: { caseRef: "second" } }), s);
    assert.equal(loadOutcomes(s)[0].meta.caseRef, "second");
  });

  test("delete and clear both work, and clear really clears", () => {
    const s = fakeStore();
    saveOutcome(base({ meta: { caseRef: "a" } }), s);
    saveOutcome(base({ meta: { caseRef: "b" } }), s);
    assert.equal(deleteOutcome(0, s).count, 1);
    assert.equal(loadOutcomes(s)[0].meta.caseRef, "a");
    assert.equal(clearOutcomes(s).count, 0);
    assert.deepEqual(loadOutcomes(s), []);
  });

  test("deleting something that is not there is refused, not ignored", () => {
    assert.equal(deleteOutcome(7, fakeStore()).ok, false);
  });

  test("export and import round-trip", () => {
    const s = fakeStore();
    saveOutcome(base({ meta: { caseRef: "kept" } }), s);
    const dump = exportOutcomes(s);
    const fresh = fakeStore();
    const r = importOutcomes(dump, fresh);
    assert.equal(r.ok, true);
    assert.equal(r.imported, 1);
    assert.equal(loadOutcomes(fresh)[0].meta.caseRef, "kept");
    assert.equal(loadOutcomes(fresh)[0].computed.avoidedAnnual.minor, base().computed.avoidedAnnual.minor);
  });

  test("import appends rather than silently overwriting history", () => {
    const s = fakeStore();
    saveOutcome(base({ meta: { caseRef: "existing" } }), s);
    const dump = exportOutcomes(fakeStore());
    importOutcomes(serialise({ format: "buyrworld.outcomes.v1", outcomes: [base({ meta: { caseRef: "new" } })] }), s);
    const all = loadOutcomes(s);
    assert.equal(all.length, 2);
    assert.ok(all.some((o) => o.meta.caseRef === "existing"), "existing history must survive an import");
  });

  test("a foreign or corrupt file is rejected with a reason", () => {
    assert.match(importOutcomes("not json", fakeStore()).error, /not a readable outcome export/);
    assert.match(importOutcomes('{"format":"something-else"}', fakeStore()).error, /not a BuyrWorld outcome export/);
  });
});

describe("a save failure says which failure it was", () => {
  test("a blocked store is distinguished from a full one", () => {
    const blocked = {
      getItem: () => null,
      setItem: () => { const e = new Error("access denied"); e.name = "SecurityError"; throw e; },
      removeItem: () => {},
    };
    const r = saveOutcome(base(), blocked);
    assert.equal(r.ok, false);
    assert.match(r.error, /blocking local storage/);
    assert.equal(/full/.test(r.error), false, "a blocked store is not a full one");
  });

  test("no storage object at all is reported, not thrown", () => {
    const r = saveOutcome(base(), null);
    // globalThis.localStorage is undefined under node, so this exercises the guard.
    assert.equal(r.ok, false);
    assert.match(r.error, /not allowing local storage/);
  });
});
