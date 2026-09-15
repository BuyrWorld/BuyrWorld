/**
 * A piece count is a complete answer on its own.
 *
 * How many blanks fit on a sheet is a question about two rectangles. It needs
 * no thickness, no alloy and no density, and the pack's manual route depends
 * on exactly that: a buyer who knows the size of the part and how many they
 * need can get a purchase quantity before anyone has settled the material.
 *
 * planMaterial() could not answer it. `boughtVolume` was computed
 * unconditionally from an optional `stockVolumeUm3`, so a plan without a
 * thickness died on `undefined * BigInt` — while every other use of volume in
 * the same function was already guarded. Nothing caught it because the Should
 * Cost form makes thickness mandatory, so no caller had ever left it out.
 *
 * The fixture below is the pack's own acceptance figure
 * (acceptance/STUDIO-V3-CHECKS.md), run through this repository's engine
 * rather than the reference planner shipped beside it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  sheetLayout, planMaterial, stage, CONSUMES, BASIS,
} from "../../src/calc/should-cost.mjs";
import { length, density, boxVolume } from "../../src/calc/units.mjs";
import { ratioFromPercent } from "../../src/calc/exact.mjs";

const mm = (x) => length(x, "mm");

/** 100 good units, 90% pass rate, two blanks consumed setting up. */
const cutting = () => [stage({
  id: "cut", name: "Cut blank",
  yield: ratioFromPercent(90), fixedPieces: 2, consumes: CONSUMES.INPUT,
  basis: BASIS.REVIEWED,
})];

/** Stock 1000 x 500, blank 100 x 50, 10mm edge, 3mm kerf, no rotation. */
const grid = () => sheetLayout(
  { width: mm(1000), length: mm(500) },
  { width: mm(100), length: mm(50) },
  { kerf: mm(3), edgeMargin: mm(10), rotationAllowed: false },
);

/* ------------------------------------------------- the pack's own fixture */

describe("the reference fixture, on this repository's engine", () => {
  test("81 blanks fit on the sheet", () => {
    // (1000 - 20 + 3) / 103 = 9 across, (500 - 20 + 3) / 53 = 9 down.
    assert.equal(grid().perSheet, 81n);
  });

  test("100 accepted parts needs 114 blanks", () => {
    // ceil(100 / 0.9) = 112, plus the 2 consumed setting up.
    const plan = planMaterial({ goodParts: 100, stages: cutting(), layout: grid() });
    assert.equal(plan.route.blanksRequired, 114n);
  });

  test("which is 2 sheets", () => {
    const plan = planMaterial({ goodParts: 100, stages: cutting(), layout: grid() });
    assert.equal(plan.quantities.stockUnitsNeeded, 2n);
    assert.equal(plan.quantities.stockUnitsToBuy, 2n);
  });

  test("and the two sheets would yield 144 good units if fully processed", () => {
    // 162 released, less the 2 setup blanks, at 90%. The pack states 144, and
    // it is only reachable if setup pieces are consumed rather than yielding.
    const plan = planMaterial({ goodParts: 100, stages: cutting(), layout: grid() });
    const released = plan.quantities.blanksPerStockUnit * plan.quantities.stockUnitsToBuy;
    assert.equal(released, 162n);
    assert.equal((released - 2n) * 9n / 10n, 144n);
  });
});

/* --------------------------------------------- the path that used to crash */

describe("a plan with no thickness", () => {
  const quantityOnly = () => planMaterial({ goodParts: 100, stages: cutting(), layout: grid() });

  test("is calculated rather than refused", () => {
    assert.doesNotThrow(quantityOnly, "a piece count does not depend on a thickness");
    assert.equal(quantityOnly().ok, true);
  });

  test("returns every quantity, because none of them needed a volume", () => {
    const q = quantityOnly().quantities;
    assert.equal(q.acceptedPartsRequired, 100n);
    assert.equal(q.blanksForProcess, 114n);
    assert.equal(q.blanksPerStockUnit, 81n);
    assert.equal(q.stockUnitsToBuy, 2n);
  });

  test("and withholds the volumes rather than reporting zero", () => {
    // Zero purchased volume would be a lie about a real quantity. Null is the
    // honest answer to a question nobody supplied the inputs for.
    const v = quantityOnly().volume;
    assert.equal(v.purchasedUm3, null);
    assert.equal(v.releasedAsBlanksUm3, null);
    assert.equal(v.recoverableOffcutUm3, null);
  });

  test("and withholds every mass, including the gross", () => {
    const m = quantityOnly().mass;
    assert.equal(m.grossPurchasedUg, null);
    assert.equal(m.oneBlankUg, null);
    assert.equal(m.finishedPartsNetUg, null);
    assert.equal(m.densitySource, null);
  });

  test("the statement still says what was decided", () => {
    assert.match(quantityOnly().statement, /100 accepted parts needs 114 blanks/);
    assert.match(quantityOnly().statement, /2 stock unit\(s\) at 81 blanks each/);
  });
});

/* ----------------------------------------- and the thickness path is intact */

describe("a plan with a thickness still reports volume", () => {
  const withVolume = (extra = {}) => planMaterial({
    goodParts: 100, stages: cutting(), layout: grid(),
    stockVolumeUm3: boxVolume(mm(1000), mm(500), mm(10)),
    blankVolumeUm3: boxVolume(mm(100), mm(50), mm(10)),
    ...extra,
  });

  test("purchased volume is two whole sheets", () => {
    // 1000 x 500 x 10 mm in cubic micrometres, twice.
    assert.equal(withVolume().volume.purchasedUm3, 2n * 1_000_000n * 500_000n * 10_000n);
  });

  test("released volume is the blanks actually released, not the parts wanted", () => {
    assert.equal(withVolume().volume.releasedAsBlanksUm3, 114n * 100_000n * 50_000n * 10_000n);
  });

  test("offcut is the difference, and is a real quantity here", () => {
    const v = withVolume().volume;
    assert.equal(v.recoverableOffcutUm3, v.purchasedUm3 - v.releasedAsBlanksUm3);
    assert.ok(v.recoverableOffcutUm3 > 0n);
  });

  test("a density then gives the gross purchased mass", () => {
    // 2700 kg/m3 is 2700 ug/mm3 exactly, which is why the canonical unit was
    // chosen. Two sheets are 10,000,000 mm3, so 2.7e10 ug — 27 kg, which is
    // the figure to sanity-check against, not the micrograms.
    const d = density(2700, "kg/m3", "supplier datasheet, entered by the buyer");
    const m = withVolume({ density: d }).mass;
    const mm3 = 2n * 1_000n * 500n * 10n;
    assert.equal(mm3, 10_000_000n);
    assert.equal(m.grossPurchasedUg, mm3 * 2700n);
    assert.equal(m.grossPurchasedUg / 1_000_000_000n, 27n, "27 kg of aluminium plate");
    assert.equal(m.densitySource, "supplier datasheet, entered by the buyer");
  });

  test("a density without a thickness still yields no mass", () => {
    // The density is known and the volume is not, so the product is unknown.
    const d = density(2700, "kg/m3", "a datasheet");
    const plan = planMaterial({ goodParts: 100, stages: cutting(), layout: grid(), density: d });
    assert.equal(plan.mass.grossPurchasedUg, null);
    assert.equal(plan.mass.densitySource, "a datasheet",
      "the density itself was supplied, and saying so is not the same as using it");
  });
});
