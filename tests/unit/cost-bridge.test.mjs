import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  costBridge, partialAcceptance, delayEffect, formatPercent, PROVENANCE,
} from "../../src/calc/cost-bridge.mjs";
import {
  ratioFromPercent, moneyFromDecimal, moneyToDecimalString, ONE,
} from "../../src/calc/exact.mjs";

const p = (x) => ratioFromPercent(x);
const gbp = (x) => moneyFromDecimal(x, "GBP");
const str = moneyToDecimalString;

/** A synthetic, fictional baseline. No real supplier, part or price. */
function baseCase(over = {}) {
  return {
    baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
    requestedChange: p("9"),
    drivers: [
      { id: "material", label: "Steel bar", weight: p("42"), indexMovement: p("10"), source: "synthetic-index-A" },
      { id: "labour",   label: "Direct labour", weight: p("18"), indexMovement: p("5"), source: "synthetic-index-B" },
      { id: "energy",   label: "Electricity", weight: p("8"),  indexMovement: p("12"), source: "synthetic-index-C" },
    ],
    ...over,
  };
}

describe("cost bridge — core decomposition", () => {
  test("warranted change is the weighted sum of driver movements", () => {
    const r = costBridge(baseCase());
    // 0.42*0.10 + 0.18*0.05 + 0.08*0.12 = 0.042 + 0.009 + 0.0096 = 0.0606
    assert.equal(r.warrantedChange, p("6.06"));
    assert.equal(formatPercent(r.warrantedChange), "6.06%");
  });

  test("the unsupported remainder is the number the buyer negotiates against", () => {
    const r = costBridge(baseCase());
    assert.equal(r.unsupportedChange, p("2.94"));   // 9% asked, 6.06% supported
    assert.equal(str(r.unitPrice.requested), "109.00");
    assert.equal(str(r.unitPrice.warranted), "106.06");
    assert.equal(str(r.delta.unsupported), "2.94");
  });

  test("annual and lifetime exposure", () => {
    const r = costBridge(baseCase());
    assert.equal(str(r.annual.requested), "450000.00");    // 9.00 x 50,000
    assert.equal(str(r.annual.warranted), "303000.00");    // 6.06 x 50,000
    assert.equal(str(r.annual.unsupported), "147000.00");  // 2.94 x 50,000
    assert.equal(str(r.lifetime.unsupported), "441000.00"); // 3 years default
  });

  test("unexplained weight is surfaced, not hidden", () => {
    const r = costBridge(baseCase());
    // 42 + 18 + 8 = 68%; 32% of unit cost is unaccounted for
    assert.equal(r.unexplainedWeight, p("32"));
    const note = r.assumptions.find((a) => a.id === "unexplained-weight");
    assert.ok(note, "an assumption should be recorded");
    assert.match(note.text, /32\.00% is unexplained/);
  });

  test("every contribution is traceable to its driver and source", () => {
    const r = costBridge(baseCase());
    assert.equal(r.contributions.length, 3);
    const material = r.contributions.find((c) => c.id === "material");
    assert.equal(material.contribution, p("4.2"));
    assert.equal(material.source, "synthetic-index-A");
    assert.ok(r.formula.includes("weight"), "the formula travels with the result");
  });

  test("determinism — the same inputs give the identical result every time", () => {
    const a = costBridge(baseCase());
    const b = costBridge(baseCase());
    assert.equal(a.warrantedChange, b.warrantedChange);
    assert.equal(a.annual.unsupported.minor, b.annual.unsupported.minor);
  });
});

describe("cost bridge — contract constraints", () => {
  test("a cap binds and says what it suppressed", () => {
    const r = costBridge(baseCase({ constraints: { cap: p("5") } }));
    assert.equal(r.warrantedChange, p("5"));
    assert.equal(r.warrantedBeforeConstraints, p("6.06"));
    assert.equal(r.constraintApplied, "cap");
    assert.match(r.assumptions.find((a) => a.id === "cap-applied").text, /would otherwise support 6\.06%/);
  });

  test("a floor binds on a downward movement", () => {
    const deflation = baseCase({
      drivers: [{ id: "material", label: "Steel bar", weight: p("42"), indexMovement: p("-10") }],
      constraints: { floor: p("-2") },
      requestedChange: p("0"),
    });
    const r = costBridge(deflation);
    assert.equal(r.warrantedBeforeConstraints, p("-4.2"));
    assert.equal(r.warrantedChange, p("-2"));
    assert.equal(r.constraintApplied, "floor");
  });

  test("a collar suppresses small movements entirely", () => {
    const small = baseCase({
      drivers: [{ id: "material", label: "Steel bar", weight: p("20"), indexMovement: p("2") }],
      constraints: { collar: p("1") },
      requestedChange: p("0.4"),
    });
    const r = costBridge(small);
    assert.equal(r.warrantedBeforeConstraints, p("0.4"));
    assert.equal(r.warrantedChange, 0n);
    assert.equal(r.constraintApplied, "collar");
  });

  test("a floor above a cap is a contradiction, not a silent result", () => {
    assert.throws(
      () => costBridge(baseCase({ constraints: { cap: p("2"), floor: p("5") } })),
      /floor cannot exceed/
    );
  });
});

describe("cost bridge — the cases that catch people out", () => {
  test("double-counted weight is rejected with the usual cause named", () => {
    const doubled = baseCase({
      drivers: [
        { id: "material", label: "Material inc. inbound freight", weight: p("70"), indexMovement: p("10") },
        { id: "freight",  label: "Inbound freight", weight: p("40"), indexMovement: p("20") },
      ],
    });
    assert.throws(() => costBridge(doubled), /exceeds 100%/);
    assert.throws(() => costBridge(doubled), /double counting/);
  });

  test("retrospective application is priced on volume already delivered", () => {
    const r = costBridge(baseCase({ period: { retrospectiveMonths: 4 } }));
    assert.equal(r.retrospective.units, 16_667n);               // 50,000 x 4/12, rounded
    assert.equal(str(r.retrospective.unsupported), "49000.98"); // 2.94 x 16,667 exactly
    assert.ok(r.assumptions.some((a) => a.id === "retrospective"));
  });

  test("a fully justified claim leaves nothing to argue about", () => {
    // Sometimes accepting is the right answer, and the engine must say so.
    const fair = baseCase({
      requestedChange: p("6.06"),
      drivers: baseCase().drivers,
    });
    const r = costBridge(fair);
    assert.equal(r.unsupportedChange, 0n);
    assert.equal(str(r.annual.unsupported), "0.00");
    assert.equal(r.warrantedChange, r.requestedChange);
  });

  test("a supplier asking for less than the evidence supports", () => {
    const r = costBridge(baseCase({ requestedChange: p("3") }));
    assert.equal(r.unsupportedChange, p("-3.06"));
    assert.equal(r.unsupportedChange < 0n, true, "negative means they under-asked");
  });

  test("deflation produces a decrease, not a floor at zero", () => {
    const r = costBridge(baseCase({
      drivers: [{ id: "material", label: "Steel bar", weight: p("50"), indexMovement: p("-8") }],
      requestedChange: p("0"),
    }));
    assert.equal(r.warrantedChange, p("-4"));
    assert.equal(str(r.unitPrice.warranted), "96.00");
    assert.equal(r.unsupportedChange, p("4"), "holding price flat when costs fell is itself a claim");
  });

  test("zero volume does not divide by zero", () => {
    const r = costBridge(baseCase({ baseline: { unitPrice: gbp("100.00"), annualVolume: 0 } }));
    assert.equal(str(r.annual.unsupported), "0.00");
  });
});

describe("cost bridge — input validation", () => {
  test("a float where a Ratio belongs is rejected", () => {
    assert.throws(() => costBridge(baseCase({ requestedChange: 0.09 })), /must be a Ratio/);
  });

  test("fractional volume is rejected", () => {
    assert.throws(
      () => costBridge(baseCase({ baseline: { unitPrice: gbp("100.00"), annualVolume: 1000.5 } })),
      /integer number of units/
    );
  });

  test("negative volume is rejected", () => {
    assert.throws(
      () => costBridge(baseCase({ baseline: { unitPrice: gbp("100.00"), annualVolume: -1 } })),
      /cannot be negative/
    );
  });

  test("duplicate driver ids are rejected", () => {
    assert.throws(() => costBridge(baseCase({
      drivers: [
        { id: "material", label: "A", weight: p("10"), indexMovement: p("5") },
        { id: "material", label: "B", weight: p("10"), indexMovement: p("5") },
      ],
    })), /Duplicate driver id/);
  });

  test("no drivers at all is rejected", () => {
    assert.throws(() => costBridge(baseCase({ drivers: [] })), /At least one cost driver/);
  });
});

describe("cost bridge — AI values may not enter arithmetic unconfirmed", () => {
  test("an unconfirmed AI-inferred driver is refused", () => {
    const ai = baseCase({
      drivers: [{
        id: "material", label: "Steel bar", weight: p("42"), indexMovement: p("10"),
        provenance: PROVENANCE.AI,
      }],
    });
    assert.throws(() => costBridge(ai), /unconfirmed AI-inferred value/);
  });

  test("the same driver is accepted once a human has confirmed it", () => {
    const confirmed = baseCase({
      drivers: [{
        id: "material", label: "Steel bar", weight: p("42"), indexMovement: p("10"),
        provenance: PROVENANCE.AI, confirmedBy: { by: "buyer", at: "2026-09-12" },
      }],
    });
    const r = costBridge(confirmed);
    assert.equal(r.warrantedChange, p("4.2"));
  });

  test("document-extracted and user-entered values pass through", () => {
    const r = costBridge(baseCase({
      drivers: [{ id: "m", label: "M", weight: p("50"), indexMovement: p("10"), provenance: PROVENANCE.DOCUMENT }],
    }));
    assert.equal(r.warrantedChange, p("5"));
  });
});

describe("options", () => {
  test("partial acceptance quantifies what it costs and what it avoids", () => {
    const r = costBridge(baseCase());
    const opt = partialAcceptance(r, p("6.06"));   // concede exactly the warranted amount
    assert.equal(str(opt.acceptedUnitPrice), "106.06");
    assert.equal(str(opt.annualCost), "303000.00");
    assert.equal(str(opt.annualAvoided), "147000.00");
    assert.equal(opt.versusWarranted, 0n);
  });

  test("delaying implementation reduces first-year exposure pro rata", () => {
    const r = costBridge(baseCase());
    const d = delayEffect(r, 3, 50_000);
    assert.equal(d.affectedUnits, 37_500n);
    assert.equal(d.avoidedUnits, 12_500n);
    assert.equal(str(d.firstYearCost), "337500.00");     // 9.00 x 37,500
    assert.equal(str(d.firstYearAvoided), "112500.00");  // 9.00 x 12,500
  });

  test("an impossible delay is rejected", () => {
    const r = costBridge(baseCase());
    assert.throws(() => delayEffect(r, 13, 50_000), /0-12 months/);
  });
});

describe("rounding: round once, at the total", () => {
  test("a sub-penny unit delta is not lost across a large volume", () => {
    // Found by ProcureBench PB-14. 0.84 +7.5% is exactly 0.903, but a 2dp unit
    // price forces 0.90. Rounding per unit and then multiplying understated a
    // 4.2m-unit line by GBP 12,600 a year.
    const r = costBridge({
      baseline: { unitPrice: gbp("0.84"), annualVolume: 4_200_000 },
      requestedChange: p("7.5"),
      drivers: [{ id: "m", label: "Polymer", weight: p("55"), indexMovement: p("9") }],
    });
    assert.equal(str(r.annual.requested), "264600.00", "exact: 3,528,000 x 7.5%");
    assert.notEqual(str(r.annual.requested), "252000.00", "the per-unit-rounded figure");
    assert.equal(str(r.annual.warranted), "174636.00");
    assert.equal(str(r.annual.unsupported), "89964.00");
  });

  test("the displayed per-unit delta is still 2dp, because a price list is", () => {
    const r = costBridge({
      baseline: { unitPrice: gbp("0.84"), annualVolume: 4_200_000 },
      requestedChange: p("7.5"),
      drivers: [{ id: "m", label: "Polymer", weight: p("55"), indexMovement: p("9") }],
    });
    assert.equal(str(r.delta.requested), "0.06", "display value rounds to a price-list penny");
    // ...but exposure was NOT computed from it. Had it been, we would see this:
    const naive = r.delta.requested.minor * 4_200_000n;
    assert.notEqual(r.annual.requested.minor, naive,
      "exposure must not be the rounded per-unit delta times volume");
    assert.equal(r.annual.requested.minor - naive, 1_260_000n,
      "the difference is exactly the GBP 12,600 that rounding would have lost");
  });

  test("exposure and options agree with each other", () => {
    const r = costBridge({
      baseline: { unitPrice: gbp("0.84"), annualVolume: 4_200_000 },
      requestedChange: p("7.5"),
      drivers: [{ id: "m", label: "Polymer", weight: p("55"), indexMovement: p("9") }],
    });
    const opt = partialAcceptance(r, r.warrantedChange);
    assert.equal(str(opt.annualCost), str(r.annual.warranted));
    assert.equal(str(opt.annualAvoided), str(r.annual.unsupported));
  });
});
