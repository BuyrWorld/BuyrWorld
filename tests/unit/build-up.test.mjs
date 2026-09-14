/**
 * A claim's cost structure against your own build-up.
 *
 * The arithmetic is two subtractions and a multiplication. Almost everything
 * worth testing here is about what the module refuses to say with them: it
 * must not present a difference as a verdict, must not treat an element it
 * cannot model as a zero, must not compare against a partial estimate, and
 * must report the direction that does not help the buyer as plainly as the
 * one that does.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ratioFromPercent, moneyFromDecimal, ratioToPercentString,
} from "../../src/calc/exact.mjs";
import { BASIS } from "../../src/calc/should-cost.mjs";
import { MATERIAL_GAP, buildUpShares, compareToBuildUp, questionsFrom } from "../../src/calc/build-up.mjs";

const pc = ratioFromPercent;
const gbp = (v) => moneyFromDecimal(v, "GBP", null);

/* A costPlan-shaped result, built directly so these tests do not depend on
   the material planner's own arithmetic. */
const plan = (lines, over = {}) => ({
  ok: true,
  complete: over.complete !== false,
  missing: over.missing ?? [],
  currency: "GBP",
  confidence: over.confidence ?? "quote-backed",
  lines: lines.map((l) => ({
    id: l.id, label: l.label, amount: l.amount ?? gbp(l.gbp), signed: l.signed ?? gbp(l.gbp).minor,
    oneTime: Boolean(l.oneTime), credit: Boolean(l.credit),
    basis: l.basis ?? "quoted", quality: l.quality ?? BASIS.QUOTED, note: null,
  })),
  ...over,
});

/* A costBridge-shaped result, same reasoning. */
const bridge = (contributions) => ({ contributions });
const driver = (id, label, weightPc, movementPc) => ({
  id, label, weight: pc(weightPc), indexMovement: pc(movementPc),
});

/** Material 60%, manufacturing 40%, of a £10,000 recurring cost. */
const SIXTY_FORTY = () => plan([
  { id: "stock", label: "Raw stock", gbp: "6000.00" },
  { id: "manufacturing", label: "Manufacturing", gbp: "4000.00" },
]);

/* ------------------------------------------------------------- the shares */

describe("shares come off a complete estimate or not at all", () => {
  test("a complete estimate gives shares of the recurring cost", () => {
    const s = buildUpShares(SIXTY_FORTY());
    assert.equal(s.ok, true);
    assert.equal(ratioToPercentString(s.byId.stock.share, 1), "60.0%");
    assert.equal(ratioToPercentString(s.byId.manufacturing.share, 1), "40.0%");
  });

  test("an incomplete estimate gives none, and says why", () => {
    const s = buildUpShares(plan([{ id: "stock", label: "Raw stock", gbp: "6000.00" }], {
      complete: false, missing: [{ id: "manufacturing", label: "Manufacturing" }],
    }));
    assert.equal(s.ok, false);
    assert.match(s.why, /number about the wrong total/);
    assert.match(s.why, /Manufacturing/);
  });

  test("a one-time charge is not part of the structure of a unit price", () => {
    const s = buildUpShares(plan([
      { id: "stock", label: "Raw stock", gbp: "6000.00" },
      { id: "manufacturing", label: "Manufacturing", gbp: "4000.00" },
      { id: "tooling", label: "Tooling and NRE", gbp: "15000.00", oneTime: true },
    ]));
    assert.equal(ratioToPercentString(s.byId.stock.share, 1), "60.0%");
    assert.equal("tooling" in s.byId, false);
  });

  test("a credit reduces the total and takes a negative share", () => {
    const s = buildUpShares(plan([
      { id: "stock", label: "Raw stock", gbp: "6000.00" },
      { id: "manufacturing", label: "Manufacturing", gbp: "4000.00" },
      { id: "scrapCredit", label: "Scrap credit", gbp: "1000.00", credit: true, signed: -100000n },
    ]));
    assert.ok(s.byId.scrapCredit.share < 0n);
    assert.equal(s.total, 900000n);
  });

  test("the strength of each line travels with its share", () => {
    const s = buildUpShares(plan([
      { id: "stock", label: "Raw stock", gbp: "6000.00", quality: BASIS.QUOTED },
      { id: "manufacturing", label: "Manufacturing", gbp: "4000.00", quality: BASIS.ASSUMED, basis: "estimated cycle time" },
    ]));
    assert.equal(s.byId.manufacturing.quality, BASIS.ASSUMED);
    assert.equal(s.byId.manufacturing.basis, "estimated cycle time");
  });

  test("no estimate at all is handled, not thrown", () => {
    assert.equal(buildUpShares(null).ok, false);
    assert.equal(buildUpShares({ ok: false }).ok, false);
  });
});

/* --------------------------------------------------------- the comparison */

describe("the comparison", () => {
  const claim = () => bridge([
    driver("material", "Material", 75, 8),
    driver("labour", "Labour", 25, 3),
  ]);
  const map = { material: "stock", labour: "manufacturing" };

  test("a claimed weight above the build-up is reported, with the gap", () => {
    // Claimed 75% material; the build-up says 60%.
    const c = compareToBuildUp({ bridge: claim(), cost: SIXTY_FORTY(), map });
    const row = c.rows.find((r) => r.driverId === "material");
    assert.equal(ratioToPercentString(row.claimedWeight, 1), "75.0%");
    assert.equal(ratioToPercentString(row.buildUpShare, 1), "60.0%");
    assert.equal(ratioToPercentString(row.difference, 1), "15.0%");
    assert.equal(row.direction, "claimed higher");
    assert.equal(row.material, true);
  });

  test("what the gap is worth is the difference times the claimed movement", () => {
    // 15 points of weight at a claimed 8% movement is 1.2 points of the ask.
    const c = compareToBuildUp({ bridge: claim(), cost: SIXTY_FORTY(), map });
    const row = c.rows.find((r) => r.driverId === "material");
    assert.equal(ratioToPercentString(row.atClaimedMovement, 2), "1.20%");
  });

  test("a large gap on a driver that has not moved is worth nothing", () => {
    // The point of pricing the gap rather than reporting it: a weight that is
    // wrong about something static costs the buyer nothing.
    const c = compareToBuildUp({
      bridge: bridge([driver("material", "Material", 75, 0)]),
      cost: SIXTY_FORTY(), map,
    });
    assert.equal(c.rows[0].material, true);
    assert.equal(c.rows[0].atClaimedMovement, 0n);
    assert.equal(c.overstatedPoints, 0n);
  });

  test("the other direction is reported just as plainly", () => {
    // A comparison that only fires when it helps you is not a comparison.
    const c = compareToBuildUp({
      bridge: bridge([driver("material", "Material", 40, 8)]),
      cost: SIXTY_FORTY(), map,
    });
    assert.equal(c.rows[0].direction, "claimed lower");
    assert.equal(c.rows[0].material, true);
    assert.match(c.statement, /below the build-up/);
  });

  test("a claim below the build-up adds nothing to the overstated total", () => {
    const c = compareToBuildUp({
      bridge: bridge([driver("material", "Material", 40, 8)]),
      cost: SIXTY_FORTY(), map,
    });
    assert.equal(c.overstatedPoints, 0n, "it is not money the buyer is being asked for");
  });

  test("a small difference is not worth raising, and says so", () => {
    const c = compareToBuildUp({
      bridge: bridge([driver("material", "Material", 62, 8)]),
      cost: SIXTY_FORTY(), map,
    });
    assert.equal(c.rows[0].material, false);
    assert.equal(c.raisable.length, 0);
    assert.match(c.rows[0].statement, /close enough not to be worth raising/);
    assert.match(c.statement, /consistent with it/);
  });

  test("the threshold is five points, stated", () => {
    assert.equal(ratioToPercentString(MATERIAL_GAP, 0), "5%");
    const just = compareToBuildUp({
      bridge: bridge([driver("material", "Material", 65, 8)]),
      cost: SIXTY_FORTY(), map,
    });
    assert.equal(just.rows[0].material, false, "exactly at the threshold is not over it");
  });

  test("several overstated drivers are added, and understated ones are not", () => {
    const c = compareToBuildUp({
      bridge: bridge([driver("material", "Material", 75, 8), driver("labour", "Labour", 15, 4)]),
      cost: SIXTY_FORTY(), map,
    });
    // Material +15pp at 8% = 1.20. Labour is 10pp BELOW, so contributes nothing.
    assert.equal(ratioToPercentString(c.overstatedPoints, 2), "1.20%");
  });
});

/* -------------------------------------------------------------- the gaps */

describe("what the build-up cannot model is not a zero", () => {
  test("a driver with no mapping is a gap, not a finding", () => {
    const c = compareToBuildUp({
      bridge: bridge([driver("material", "Material", 60, 8), driver("energy", "Energy", 12, 30)]),
      cost: SIXTY_FORTY(), map: { material: "stock" },
    });
    assert.equal(c.rows.length, 1);
    assert.equal(c.unmappedDrivers.length, 1);
    assert.equal(c.unmappedDrivers[0].label, "Energy");
    assert.equal(c.partial, true);
    assert.match(c.caveat, /limit of the build-up, not evidence about the claim/);
  });

  test("a driver mapped to an element the estimate does not cost is a gap too", () => {
    const c = compareToBuildUp({
      bridge: bridge([driver("energy", "Energy", 12, 30)]),
      cost: SIXTY_FORTY(), map: { energy: "freight" },
    });
    assert.equal(c.rows.length, 0);
    assert.match(c.unmappedDrivers[0].why, /gap in the build-up, not evidence about the claim/);
  });

  test("a build-up line no driver touches is reported, without implying anything", () => {
    const c = compareToBuildUp({
      bridge: bridge([driver("material", "Material", 60, 8)]),
      cost: SIXTY_FORTY(), map: { material: "stock" },
    });
    assert.equal(c.unusedElements.length, 1);
    assert.equal(c.unusedElements[0].label, "Manufacturing");
    assert.match(c.unusedElements[0].why, /may simply not rest on it/);
  });

  test("a fully mapped comparison is not partial", () => {
    const c = compareToBuildUp({
      bridge: bridge([driver("material", "Material", 60, 8), driver("labour", "Labour", 40, 3)]),
      cost: SIXTY_FORTY(), map: { material: "stock", labour: "manufacturing" },
    });
    assert.equal(c.partial, false);
    assert.equal(c.caveat, null);
  });

  test("nothing mapped at all says there is nothing to compare", () => {
    const c = compareToBuildUp({ bridge: bridge([driver("material", "Material", 60, 8)]), cost: SIXTY_FORTY() });
    assert.match(c.statement, /nothing to compare/);
    assert.equal(c.rows.length, 0);
  });

  test("an incomplete estimate refuses the whole comparison", () => {
    const c = compareToBuildUp({
      bridge: bridge([driver("material", "Material", 75, 8)]),
      cost: plan([{ id: "stock", label: "Raw stock", gbp: "6000.00" }],
        { complete: false, missing: [{ id: "manufacturing", label: "Manufacturing" }] }),
      map: { material: "stock" },
    });
    assert.equal(c.ok, false);
    assert.match(c.why, /nothing here to compare/);
  });

  test("no claim to compare is handled, not thrown", () => {
    assert.equal(compareToBuildUp({ cost: SIXTY_FORTY() }).ok, false);
    assert.equal(compareToBuildUp({}).ok, false);
  });
});

/* ------------------------------------------------------- what it will not say */

describe("it is a question, not a verdict", () => {
  const c = () => compareToBuildUp({
    bridge: bridge([driver("material", "Material", 75, 8)]),
    cost: SIXTY_FORTY(), map: { material: "stock" },
  });

  test("the method says a build-up is yours, not theirs", () => {
    assert.match(c().method, /what you think the part costs, not what it costs them/);
    assert.match(c().method, /their yield, overhead, scrap and buying power are not yours/i);
  });

  test("it says explicitly that it does not recalculate the warranted change", () => {
    assert.match(c().method, /nothing above recalculates the\s+warranted change/);
    assert.match(c().method, /challenges an input/);
  });

  test("no row is phrased as a finding against a supplier", () => {
    for (const r of c().rows) {
      for (const banned of ["wrong", "false", "overstated", "inflated", "misrepresent"]) {
        assert.equal(r.statement.toLowerCase().includes(banned), false,
          `a row statement calls the claim "${banned}"`);
      }
    }
  });

  test("the strength of the build-up line is available to be said out loud", () => {
    const weak = compareToBuildUp({
      bridge: bridge([driver("material", "Material", 75, 8)]),
      cost: plan([
        { id: "stock", label: "Raw stock", gbp: "6000.00", quality: BASIS.ASSUMED, basis: "a guess" },
        { id: "manufacturing", label: "Manufacturing", gbp: "4000.00" },
      ], { confidence: "budgetary" }),
      map: { material: "stock" },
    });
    assert.equal(weak.rows[0].buildUpQuality, BASIS.ASSUMED);
    assert.equal(weak.buildUpConfidence, "budgetary");
  });
});

/* ------------------------------------------------------------- questions */

describe("what to ask", () => {
  test("an overstated driver becomes a question with the two figures in it", () => {
    const qs = questionsFrom(compareToBuildUp({
      bridge: bridge([driver("material", "Material", 75, 8)]),
      cost: SIXTY_FORTY(), map: { material: "stock" },
    }));
    assert.match(qs[0].question, /75\.0%/);
    assert.match(qs[0].question, /60\.0%/);
    assert.match(qs[0].question, /What accounts for the 15\.0% difference\?/);
  });

  test("an understated driver asks the opposite question, including of ourselves", () => {
    const qs = questionsFrom(compareToBuildUp({
      bridge: bridge([driver("material", "Material", 40, 8)]),
      cost: SIXTY_FORTY(), map: { material: "stock" },
    }));
    assert.match(qs[0].question, /or is our build-up wrong\?/);
  });

  test("an unmodelled driver asks what it covers, rather than challenging it", () => {
    const qs = questionsFrom(compareToBuildUp({
      bridge: bridge([driver("energy", "Energy", 12, 30)]),
      cost: SIXTY_FORTY(), map: {},
    }));
    assert.match(qs[0].question, /has no line for Energy/);
    assert.match(qs[0].question, /What does it cover/);
  });

  test("questions are ordered by what the answer is worth, not by the size of the gap", () => {
    const qs = questionsFrom(compareToBuildUp({
      bridge: bridge([
        /* A 30-point gap on something that has not moved. */
        driver("labour", "Labour", 70, 0),
        /* A 15-point gap on something that has moved 8%. */
        driver("material", "Material", 75, 8),
      ]),
      cost: SIXTY_FORTY(), map: { material: "stock", labour: "manufacturing" },
    }));
    assert.equal(qs[0].driverId, "material", "the smaller gap is worth more and comes first");
  });

  test("nothing to compare produces no questions", () => {
    assert.deepEqual([...questionsFrom({ ok: false })], []);
    assert.deepEqual([...questionsFrom(null)], []);
  });
});
