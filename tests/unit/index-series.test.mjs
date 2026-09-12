import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createSeries, observationAt, movementBetween, compareClaimedBasis, compareLag,
  periodToMonths, monthsToPeriod, shiftPeriod, periodsBetween,
} from "../../src/calc/index-series.mjs";
import { formatPercent as P, costBridge } from "../../src/calc/cost-bridge.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";
import { STEEL_A } from "../../fixtures/procurebench/indices.mjs";

describe("period arithmetic", () => {
  test("round-trips", () => {
    assert.equal(monthsToPeriod(periodToMonths("2026-03")), "2026-03");
    assert.equal(monthsToPeriod(periodToMonths("1999-12")), "1999-12");
  });

  test("shifts across year boundaries", () => {
    assert.equal(shiftPeriod("2026-03", -3), "2025-12");
    assert.equal(shiftPeriod("2026-01", -1), "2025-12");
    assert.equal(shiftPeriod("2025-12", 1), "2026-01");
    assert.equal(shiftPeriod("2026-06", -12), "2025-06");
  });

  test("counts months between periods, signed", () => {
    assert.equal(periodsBetween("2025-01", "2026-06"), 17);
    assert.equal(periodsBetween("2026-06", "2025-01"), -17);
    assert.equal(periodsBetween("2026-06", "2026-06"), 0);
  });

  test("rejects malformed periods rather than guessing", () => {
    assert.throws(() => periodToMonths("2026-13"), RangeError);
    assert.throws(() => periodToMonths("2026-00"), RangeError);
    assert.throws(() => periodToMonths("March 2026"), RangeError);
    assert.throws(() => periodToMonths("2026-3"), RangeError);
  });
});

describe("series", () => {
  test("rejects a duplicate observation", () => {
    assert.throws(
      () => createSeries("x", "X", [["2025-01", "100"], ["2025-01", "101"]]),
      /two observations/
    );
  });

  test("rejects a non-positive value", () => {
    assert.throws(() => createSeries("x", "X", [["2025-01", "0"]]), /must be positive/);
  });

  test("rejects an empty series", () => {
    assert.throws(() => createSeries("x", "X", []), /no observations/);
  });

  test("a missing observation is an error, never interpolated", () => {
    // 2025-02 sits between two real points. Inventing it would be worse than stopping.
    assert.throws(() => observationAt(STEEL_A, "2025-02"), /no observation for 2025-02/);
    assert.throws(() => observationAt(STEEL_A, "2025-02"), /will not interpolate/);
  });

  test("reports the coverage it does have", () => {
    assert.equal(STEEL_A.first, "2024-10");
    assert.equal(STEEL_A.last, "2026-06");
    assert.equal(STEEL_A.synthetic, true, "demonstration data must be labelled");
  });
});

describe("movement", () => {
  test("computes from the contractual base", () => {
    const r = movementBetween({ series: STEEL_A, basePeriod: "2025-01", measurePeriod: "2026-06" });
    assert.equal(P(r.movement), "10.00%");   // 100 -> 110
    assert.equal(r.basePeriodUsed, "2025-01");
    assert.equal(r.measurePeriodUsed, "2026-06");
  });

  test("a lag moves the measurement point back", () => {
    const r = movementBetween({ series: STEEL_A, basePeriod: "2025-01", measurePeriod: "2026-06", lagMonths: 3 });
    assert.equal(r.measurePeriodUsed, "2026-03");
    assert.equal(P(r.movement), "4.00%");    // 100 -> 104
    assert.match(r.lineage, /3-month lag applied to 2026-06/);
  });

  test("lineage names the periods and values actually read", () => {
    const r = movementBetween({ series: STEEL_A, basePeriod: "2025-01", measurePeriod: "2026-06", lagMonths: 3 });
    assert.match(r.lineage, /2025-01 = 100\.00/);
    assert.match(r.lineage, /2026-03 = 104\.00/);
    assert.match(r.lineage, /\[synthetic data\]/);
  });

  test("a negative movement is reported as negative", () => {
    const r = movementBetween({ series: STEEL_A, basePeriod: "2025-01", measurePeriod: "2025-06" });
    assert.equal(P(r.movement), "-8.00%");   // 100 -> 92
  });

  test("measuring before the base is an error", () => {
    assert.throws(
      () => movementBetween({ series: STEEL_A, basePeriod: "2026-06", measurePeriod: "2025-01" }),
      /falls before the base/
    );
  });

  test("a lag that pushes measurement before the base names the lag", () => {
    assert.throws(
      () => movementBetween({ series: STEEL_A, basePeriod: "2025-12", measurePeriod: "2026-03", lagMonths: 12 }),
      /Check the lag: 12 month\(s\)/
    );
  });

  test("a negative lag is rejected", () => {
    assert.throws(
      () => movementBetween({ series: STEEL_A, basePeriod: "2025-01", measurePeriod: "2026-06", lagMonths: -1 }),
      /non-negative integer/
    );
  });
});

describe("base-period shopping is made visible", () => {
  test("quantifies what a flattering base is worth", () => {
    const c = compareClaimedBasis({
      series: STEEL_A,
      claimedBasePeriod: "2025-06",        // the trough
      contractualBasePeriod: "2025-01",
      measurePeriod: "2026-06",
    });
    assert.equal(P(c.claimed.movement), "19.57%");
    assert.equal(P(c.contractual.movement), "10.00%");
    assert.equal(P(c.overstatement), "9.57%");
    assert.equal(c.basesDiffer, true);
    assert.equal(c.monthsShifted, 5);
  });

  test("identical bases produce no overstatement", () => {
    const c = compareClaimedBasis({
      series: STEEL_A,
      claimedBasePeriod: "2025-01",
      contractualBasePeriod: "2025-01",
      measurePeriod: "2026-06",
    });
    assert.equal(c.overstatement, 0n);
    assert.equal(c.basesDiffer, false);
  });
});

describe("lag is made visible", () => {
  test("quantifies movement that has not reached the price", () => {
    const l = compareLag({ series: STEEL_A, basePeriod: "2025-01", measurePeriod: "2026-06", lagMonths: 3 });
    assert.equal(P(l.unlagged.movement), "10.00%");
    assert.equal(P(l.lagged.movement), "4.00%");
    assert.equal(P(l.overstatement), "6.00%");
  });
});

describe("the cost bridge resolves indices itself", () => {
  const baseline = { unitPrice: moneyFromDecimal("120.00", "GBP"), annualVolume: 25_000 };

  test("a driver may name an index instead of stating a movement", () => {
    const r = costBridge({
      baseline,
      requestedChange: pc("9.79"),
      drivers: [{
        id: "material", label: "Steel bar", weight: pc("50"),
        index: { series: STEEL_A, contractualBasePeriod: "2025-01", measurePeriod: "2026-06" },
      }],
    });
    assert.equal(P(r.warrantedChange), "5.00%");           // 50% x 10%
    assert.equal(P(r.contributions[0].indexMovement), "10.00%");
    assert.match(r.contributions[0].lineage, /Synthetic Steel Index A/);
  });

  test("base shopping is recorded as an assumption with the numbers in it", () => {
    const r = costBridge({
      baseline,
      requestedChange: pc("9.79"),
      drivers: [{
        id: "material", label: "Steel bar", weight: pc("50"),
        index: {
          series: STEEL_A, contractualBasePeriod: "2025-01",
          claimedBasePeriod: "2025-06", measurePeriod: "2026-06",
        },
      }],
    });
    const note = r.assumptions.find((a) => a.id === "base-period-material");
    assert.ok(note, "the reviewer must be told the base was shifted");
    assert.match(note.text, /measures from 2025-06 \(19\.57%\)/);
    assert.match(note.text, /contractual base is 2025-01 \(10\.00%\)/);
    assert.match(note.text, /removes 9\.57%/);
    assert.equal(P(r.contributions[0].basis.overstatement), "9.57%");
    assert.equal(r.contributions[0].basis.monthsShifted, 5);
  });

  test("lag is recorded as an assumption", () => {
    const r = costBridge({
      baseline,
      requestedChange: pc("5"),
      drivers: [{
        id: "material", label: "Steel bar", weight: pc("50"),
        index: { series: STEEL_A, contractualBasePeriod: "2025-01", measurePeriod: "2026-06", lagMonths: 3 },
      }],
    });
    assert.equal(P(r.warrantedChange), "2.00%");           // 50% x 4%
    const note = r.assumptions.find((a) => a.id === "index-lag-material");
    assert.ok(note);
    assert.match(note.text, /measured to 2026-03, not 2026-06/);
    assert.match(note.text, /4\.00% rather than 10\.00%/);
  });

  test("the derived figure cannot be base-shopped — the contract wins", () => {
    const shopped = costBridge({
      baseline, requestedChange: pc("9.79"),
      drivers: [{
        id: "m", label: "Steel", weight: pc("50"),
        index: { series: STEEL_A, contractualBasePeriod: "2025-01", claimedBasePeriod: "2025-06", measurePeriod: "2026-06" },
      }],
    });
    const honest = costBridge({
      baseline, requestedChange: pc("9.79"),
      drivers: [{
        id: "m", label: "Steel", weight: pc("50"),
        index: { series: STEEL_A, contractualBasePeriod: "2025-01", measurePeriod: "2026-06" },
      }],
    });
    assert.equal(shopped.warrantedChange, honest.warrantedChange,
      "the claimed base must not influence the warranted figure at all");
  });

  test("a driver with neither a movement nor a usable index is rejected", () => {
    assert.throws(() => costBridge({
      baseline, requestedChange: pc("5"),
      drivers: [{ id: "m", label: "Steel", weight: pc("50") }],
    }), /needs either an indexMovement/);
  });

  test("exposure still comes out exact", () => {
    const r = costBridge({
      baseline, requestedChange: pc("9.79"),
      drivers: [{
        id: "m", label: "Steel", weight: pc("50"),
        index: { series: STEEL_A, contractualBasePeriod: "2025-01", measurePeriod: "2026-06" },
      }],
    });
    // 120.00 x 25,000 = 3,000,000 line value
    assert.equal(str(r.annual.requested), "293700.00");   // x 9.79%
    assert.equal(str(r.annual.warranted), "150000.00");   // x 5.00%
    assert.equal(str(r.annual.unsupported), "143700.00"); // x 4.79%
  });
});
