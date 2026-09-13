import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { costBridge, formatPercent as P } from "../../src/calc/cost-bridge.mjs";
import { assessEvidence, evidence, EVIDENCE_KIND as K, contractConstraint, supplierClaim } from "../../src/calc/evidence.mjs";
import { prepareNegotiation, CREDIBILITY } from "../../src/calc/negotiation.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";
import { STEEL_A } from "../../src/data/sample-indices.mjs";

const gbp = (x) => moneyFromDecimal(x, "GBP");

/* £100.00 a unit, 50,000 a year: a £5,000,000 line.
   material 42% x 10% = 4.20pp, labour 18% x 5% = 0.90pp -> 5.10% warranted
   against a 9.00% ask, so 3.90% (£195,000 a year) is unsupported. */
function bridgeFor(over = {}) {
  return costBridge({
    baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
    requestedChange: pc("9"),
    drivers: [
      { id: "material", label: "Steel bar", weight: pc("42"), indexMovement: pc("10") },
      { id: "labour", label: "Labour", weight: pc("18"), indexMovement: pc("5") },
    ],
    ...over,
  });
}

const prep = (over = {}, opts = {}) => {
  const bridge = bridgeFor(over);
  const ev = opts.withEvidence === false ? null : assessEvidence(bridge, opts.evidenceInput ?? {});
  return prepareNegotiation({ bridge, ev, position: opts.position ?? {}, generatedAt: "2026-09-13T00:00:00Z" });
};

describe("the three anchors", () => {
  const n = prep();

  test("current, warranted and requested are all total annual spend", () => {
    assert.equal(str(n.anchors.current.annualCost), "5000000.00");
    assert.equal(str(n.anchors.warranted.annualCost), "5255000.00");
    assert.equal(str(n.anchors.requested.annualCost), "5450000.00");
  });

  test("the disputed amount is the gap between the middle anchor and the top one", () => {
    const gap = n.anchors.requested.annualCost.minor - n.anchors.warranted.annualCost.minor;
    assert.equal(n.anchors.inDispute.minor, gap);
    assert.equal(str(n.anchors.inDispute), "195000.00");
    assert.equal(P(n.anchors.inDisputeChange), "3.90%");
  });

  test("unit prices come through unrounded per unit", () => {
    assert.equal(str(n.anchors.current.unitPrice), "100.00");
    assert.equal(str(n.anchors.warranted.unitPrice), "105.10");
    assert.equal(str(n.anchors.requested.unitPrice), "109.00");
  });

  test("nothing in dispute when the ask is fully warranted", () => {
    const n2 = prep({ requestedChange: pc("5.1") });
    assert.equal(str(n2.anchors.inDispute), "0.00");
  });
});

describe("the hard line", () => {
  test("unevidenced drivers fall out of the defensible figure", () => {
    // Neither driver carries evidence, so nothing survives a challenge.
    const n = prep();
    assert.equal(P(n.hardLine.change), "0.00%");
    assert.equal(str(n.hardLine.belowWarrantedBy), "255000.00");
    assert.equal(n.hardLine.assessed, true);
  });

  test("an evidenced driver holds its ground", () => {
    const n = prep({
      drivers: [
        {
          id: "material", label: "Steel bar", weight: pc("42"), indexMovement: pc("10"),
          evidence: {
            weight: evidence(K.DOCUMENT, { label: "cost breakdown", quote: "material is 42% of unit cost" }),
            movement: evidence(K.PUBLISHED, { label: "synthetic index" }),
          },
        },
        { id: "labour", label: "Labour", weight: pc("18"), indexMovement: pc("5") },
      ],
    });
    // 4.20pp survives, 0.90pp does not.
    assert.equal(P(n.hardLine.change), "4.20%");
    assert.equal(str(n.hardLine.belowWarrantedBy), "45000.00");
  });

  test("half-evidenced is not evidenced", () => {
    // A weight with no movement source buys nothing. Both or neither.
    const n = prep({
      drivers: [{
        id: "material", label: "Steel bar", weight: pc("42"), indexMovement: pc("10"),
        evidence: { weight: evidence(K.DOCUMENT, { label: "breakdown", quote: "42%" }) },
      }],
    });
    assert.equal(P(n.hardLine.change), "0.00%");
  });

  test("without an evidence assessment it says so rather than guessing", () => {
    const n = prep({}, { withEvidence: false });
    assert.equal(n.hardLine.assessed, false);
    assert.equal(P(n.hardLine.change), "5.10%", "it must not silently claim a lower line");
    assert.equal(n.ladder.challenges.length, 0);
    assert.ok(n.assumptions.some((a) => a.id === "no-evidence-assessment"));
  });

  test("the hard line can never sit above the warranted figure", () => {
    // A cap has already reduced the warranted figure; stripping drivers must
    // not push the line back up through it.
    const n = prep({ constraints: { cap: pc("2") } });
    assert.ok(n.hardLine.change <= n.openingPosition.target);
  });
});

describe("the concession ladder", () => {
  const n = prep();
  const step = (id) => n.ladder.concessions.find((c) => c.id === id);

  test("holding at the warranted figure concedes nothing and is the only evidenced step", () => {
    const hold = step("concede-hold");
    assert.equal(str(hold.costOfThisStep), "0.00");
    assert.equal(P(hold.acceptedChange), "5.10%");
    assert.equal(hold.evidenced, true);
    assert.equal(n.ladder.concessions.filter((c) => c.evidenced).length, 1);
  });

  test("each step is priced exactly", () => {
    assert.equal(str(step("concede-quarter").costOfThisStep), "48750.00");
    assert.equal(str(step("concede-half").costOfThisStep), "97500.00");
    assert.equal(str(step("concede-three-quarters").costOfThisStep), "146250.00");
    assert.equal(str(step("concede-full").costOfThisStep), "195000.00");
  });

  test("the steps sum back to the disputed amount", () => {
    assert.equal(step("concede-full").costOfThisStep.minor, n.anchors.inDispute.minor);
  });

  test("accepting in full lands exactly on their ask", () => {
    const full = step("concede-full");
    assert.equal(P(full.acceptedChange), "9.00%");
    assert.equal(str(full.acceptedUnitPrice), "109.00");
    assert.equal(str(full.annualAvoided), "0.00");
    assert.equal(str(full.annualTotalCost), str(n.anchors.requested.annualCost));
  });

  test("the increase and the resulting spend are reported separately", () => {
    const half = step("concede-half");
    assert.equal(str(half.annualIncrease), "352500.00");        // 5.1% + 1.95% of £5m
    assert.equal(str(half.annualTotalCost), "5352500.00");      // the line plus that
  });

  test("nothing to concede produces one step, not four empty ones", () => {
    const n2 = prep({ requestedChange: pc("5.1") });
    assert.equal(n2.ladder.concessions.length, 1);
    assert.equal(n2.ladder.concessions[0].id, "concede-hold");
  });

  test("challenges are ordered by what they are worth", () => {
    assert.deepEqual(n.ladder.challenges.map((c) => c.driverId), ["material", "labour"]);
    assert.equal(str(n.ladder.challenges[0].worthAnnually), "210000.00");
    assert.equal(str(n.ladder.challenges[1].worthAnnually), "45000.00");
  });

  test("a driver that lowers the price is not something to challenge", () => {
    const n2 = prep({
      drivers: [
        { id: "material", label: "Steel bar", weight: pc("42"), indexMovement: pc("10") },
        { id: "energy", label: "Energy", weight: pc("20"), indexMovement: pc("-8") },
      ],
    });
    assert.equal(n2.ladder.challenges.some((c) => c.driverId === "energy"), false,
      "challenging a favourable driver would raise the price");
  });
});

describe("deferral", () => {
  const n = prep();

  test("delaying three months avoids a quarter of the first year", () => {
    const d = n.deferrals.find((x) => x.months === 3);
    assert.equal(str(d.firstYearCost), "337500.00");
    assert.equal(str(d.firstYearAvoided), "112500.00");
  });

  test("cost and avoided sum to the full first-year ask at every horizon", () => {
    for (const d of n.deferrals) {
      assert.equal(d.firstYearCost.minor + d.firstYearAvoided.minor,
        450_000_00n, `${d.months} months does not reconcile`);
    }
  });
});

describe("rebuttals", () => {
  const n = prep();

  test("the biggest recoverable point comes first", () => {
    assert.equal(n.rebuttals[0].driverId, "material");
    assert.equal(str(n.rebuttals[0].worthAnnually), "210000.00");
  });

  test("each one says what to ask for", () => {
    for (const r of n.rebuttals) {
      assert.ok(r.ask && r.ask.length > 10, `${r.id} has no ask`);
    }
    assert.match(n.rebuttals.find((r) => r.id.startsWith("weight-")).ask, /cost breakdown/);
    assert.match(n.rebuttals.find((r) => r.id.startsWith("movement-")).ask, /base period/);
  });

  test("unexplained cost is listed but carries no recoverable value", () => {
    const u = n.rebuttals.find((r) => r.id === "unexplained-cost");
    assert.ok(u, "40% of unit cost is unattributed and must be raised");
    assert.equal(u.worthAnnually, null,
      "it is already treated as zero movement, so challenging it recovers nothing");
    assert.equal(n.rebuttals.at(-1).id, "unexplained-cost", "valueless points sort last");
  });

  test("a contract contradiction is carried through with its own ask", () => {
    const n2 = prep({}, {
      evidenceInput: {
        claims: [supplierClaim({ id: "q", mechanism: "quarterly-indexation", quote: "quarterly indexation applies" })],
        constraints: [contractConstraint({
          id: "k", governs: "quarterly-indexation", permits: false,
          evidence: evidence(K.CONTRACT, { label: "agreement", clause: "7.2" }),
        })],
      },
    });
    const c = n2.rebuttals.find((r) => r.id.startsWith("contradiction-"));
    assert.ok(c, "a contradiction must reach the negotiation, not stop at the pack");
    assert.match(c.ask, /clause/);
  });

  test("a shifted base period is raised, priced, and names both periods", () => {
    const n2 = prep({
      requestedChange: pc("9.79"),
      drivers: [{
        id: "material", label: "Steel bar", weight: pc("50"),
        index: { series: STEEL_A, contractualBasePeriod: "2025-01", claimedBasePeriod: "2025-06", measurePeriod: "2026-06" },
      }],
    });
    const b = n2.rebuttals.find((r) => r.id === "basis-material");
    assert.ok(b, "base-period shopping is the most recoverable item in a file");
    assert.match(b.theirPoint, /2025-06/);
    assert.match(b.theirPoint, /2025-01/);
    // The overstatement is 9.57% of the INDEX. Only the driver's 50% share of
    // unit cost reaches the price, so 4.78% of £5m is recoverable — not 9.57%.
    assert.match(b.theirPoint, /4\.78% of unit price at a 50\.00% weight/);
    assert.equal(str(b.worthAnnually), "239130.44");
  });

  test("no assessment means no rebuttals rather than invented ones", () => {
    assert.deepEqual(prep({}, { withEvidence: false }).rebuttals, []);
  });
});

describe("whether walking away is real", () => {
  const walk = (position) => prep({}, { position }).walkAway;

  test("with nowhere to go it is not a position", () => {
    const w = walk({ alternatives: 0 });
    assert.equal(w.credibility, CREDIBILITY.NOT_CREDIBLE);
    assert.match(w.rule, /nowhere to walk to/);
  });

  test("qualification longer than notice cannot be executed", () => {
    const w = walk({ alternatives: 2, qualificationWeeks: 26, noticePeriodWeeks: 12 });
    assert.equal(w.credibility, CREDIBILITY.NOT_CREDIBLE);
    assert.match(w.rule, /cannot be ready before supply stops/);
  });

  test("qualification inside the notice period is credible", () => {
    const w = walk({ alternatives: 2, qualificationWeeks: 8, noticePeriodWeeks: 12 });
    assert.equal(w.credibility, CREDIBILITY.CREDIBLE);
  });

  test("a critical part cannot be walked away from at any notice", () => {
    const w = walk({ alternatives: 3, qualificationWeeks: 4, noticePeriodWeeks: 52, criticality: "critical" });
    assert.equal(w.credibility, CREDIBILITY.NOT_CREDIBLE);
  });

  test("missing timings are unknown, not credible", () => {
    assert.equal(walk({ alternatives: 2 }).credibility, CREDIBILITY.UNKNOWN);
    assert.equal(walk({}).credibility, CREDIBILITY.UNKNOWN);
  });

  test("the rule is always stated so it can be argued with", () => {
    for (const p of [{}, { alternatives: 0 }, { alternatives: 2, qualificationWeeks: 8, noticePeriodWeeks: 12 }]) {
      assert.ok(walk(p).rule.length > 20);
    }
  });
});

describe("the switching breakeven", () => {
  test("it is years of the disputed amount, computed exactly", () => {
    const w = walk390();
    assert.equal(w.breakeven.yearsApprox, 2);
    assert.equal(str(w.breakeven.switchingCost), "390000.00");
    assert.equal(str(w.breakeven.annualDisputedAmount), "195000.00");
  });

  test("it is labelled an assumption, because nobody has quoted an alternative", () => {
    const n = prep({}, { position: { alternatives: 2, switchingCost: gbp("390000.00") } });
    const a = n.assumptions.find((x) => x.id === "switching-breakeven");
    assert.ok(a);
    assert.equal(a.label, "assumed");
    assert.match(a.text, /would match today's price/);
  });

  test("nothing in dispute means no breakeven rather than a division by zero", () => {
    const n = prep({ requestedChange: pc("5.1") }, { position: { alternatives: 2, switchingCost: gbp("390000.00") } });
    assert.equal(n.walkAway.breakeven, null);
  });

  test("a switching cost typed as a number is refused", () => {
    assert.throws(
      () => prep({}, { position: { alternatives: 1, switchingCost: 390000 } }),
      /must be Money/);
  });

  function walk390() {
    return prep({}, { position: { alternatives: 2, switchingCost: gbp("390000.00") } }).walkAway;
  }
});

describe("the opening position", () => {
  const n = prep();

  test("open at the hard line, target and limit at the warranted figure", () => {
    assert.equal(P(n.openingPosition.openAt), "0.00%");
    assert.equal(P(n.openingPosition.target), "5.10%");
    assert.equal(P(n.openingPosition.limit), "5.10%");
  });

  test("the rule is printed, and says conceding past the limit is a choice", () => {
    assert.match(n.openingPosition.rule, /commercial choice/);
    assert.match(n.openingPosition.rule, /no evidence\s+explains/);
  });

  test("the method disclaims what it is not", () => {
    assert.match(n.method, /No figure here is produced by a language model/);
    assert.match(n.method, /none is\s+an estimate of what another supplier would charge/);
  });
});

describe("it refuses bad input rather than producing a confident answer", () => {
  test("no bridge is a type error, not an empty pack", () => {
    assert.throws(() => prepareNegotiation({}), /needs a costBridge result/);
  });

  test("every money figure is exact BigInt minor units throughout", () => {
    const n = prep({}, { position: { alternatives: 2, switchingCost: gbp("390000.00") } });
    const seen = [];
    (function walk(v) {
      if (!v || typeof v !== "object") return;
      if (typeof v.minor !== "undefined") { seen.push(v); return; }
      for (const x of Object.values(v)) walk(x);
    })(n);
    assert.ok(seen.length > 15, `expected many money values, saw ${seen.length}`);
    for (const m of seen) {
      assert.equal(typeof m.minor, "bigint", "a float reached the negotiation output");
      assert.equal(m.currency, "GBP");
    }
  });
});
