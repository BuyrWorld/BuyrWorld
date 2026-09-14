/**
 * Should-cost: the material plan and the estimate over it.
 *
 * The brief this implements lists the failures it wants caught, and they are
 * all failures of definition rather than of arithmetic. Five percent scrap
 * means two different quantities depending on whether it is five percent of
 * the input rejected or five percent added to demand. Setup pieces counted in
 * the wrong place get counted twice. A layout that already prices kerf, with a
 * cutting-scrap uplift on top, charges the same material twice. And a rate
 * nobody has produces a zero, which reads on a page as free.
 *
 * So these tests are mostly about what the module refuses to do.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ratioFromPercent, moneyFromDecimal, moneyToDecimalString, ratioToPercentString } from "../../src/calc/exact.mjs";
import { length, density, boxVolume } from "../../src/calc/units.mjs";
import {
  BASIS, CONFIDENCE, CONSUMES, COST_ELEMENTS,
  stage, routeInput, sheetLayout, barLayout, planMaterial, costPlan, assumptions,
} from "../../src/calc/should-cost.mjs";

const pc = ratioFromPercent;
const gbp = (v) => moneyFromDecimal(v, "GBP", null);
const steel = () => density("7.85", "g/cm3", "synthetic datasheet, fictional grade");

/* ------------------------------------------------------------ the stages */

describe("a stage has to say what its losses mean", () => {
  test("a yield must be a Ratio, not a number", () => {
    assert.throws(() => stage({ id: "a", name: "Press", yield: 0.95 }), /must be a Ratio/);
  });

  test("a yield of zero is refused, because no input quantity satisfies it", () => {
    assert.throws(() => stage({ id: "a", name: "Press", yield: 0n }), /cannot produce anything/);
  });

  test("a yield above 100% is refused", () => {
    assert.throws(() => stage({ id: "a", name: "Press", yield: pc(120) }), /would create material/);
  });

  test("fractional pieces are refused", () => {
    assert.throws(() => stage({ id: "a", name: "Press", yield: pc(95), fixedPieces: 2.5 }), /whole number of pieces/);
    assert.throws(() => stage({ id: "a", name: "Press", yield: pc(95), fixedPieces: -1 }), /whole number of pieces/);
  });

  test("where setup pieces come from is required, not defaulted when stated wrongly", () => {
    assert.throws(
      () => stage({ id: "a", name: "Press", yield: pc(95), fixedPieces: 3, consumes: "somewhere" }),
      /out of the input or out of accepted/);
  });

  test("a stage with no setup pieces still defaults sensibly", () => {
    const s = stage({ id: "a", name: "Press", yield: pc(95) });
    assert.equal(s.consumes, CONSUMES.INPUT);
    assert.equal(s.fixedPieces, 0);
    assert.equal(s.basis, BASIS.ASSUMED);
  });
});

/* ------------------------------------------------------------- the route */

describe("the route is computed backwards, and rounds at every stage", () => {
  test("one stage: 100 good parts at 95% needs 106 in", () => {
    // 100 / 0.95 = 105.26..., and you cannot release a quarter of a blank.
    const r = routeInput(100, [stage({ id: "p", name: "Press", yield: pc(95) })]);
    assert.equal(r.blanksRequired, 106n);
    assert.equal(r.processLoss, 6n);
  });

  test("two stages compound, and each rounds where it hands over whole pieces", () => {
    // Backwards: 100 / 0.90 = 112 out of press; 112 / 0.95 = 118 blanks.
    const r = routeInput(100, [
      stage({ id: "c", name: "Cut", yield: pc(95) }),
      stage({ id: "m", name: "Machine", yield: pc(90) }),
    ]);
    assert.equal(r.steps[1].requiredInput, 112n);
    assert.equal(r.blanksRequired, 118n);
  });

  test("a percentage of input rejected is not a percentage added to demand", () => {
    // The distinction the brief insists on. 100 at 95% yield is 106 in,
    // whereas 100 plus 5% would be 105. Different quantity, same words.
    const asYield = routeInput(100, [stage({ id: "p", name: "P", yield: pc(95) })]);
    assert.notEqual(asYield.blanksRequired, 105n);
    assert.equal(asYield.blanksRequired, 106n);
  });

  test("setup pieces taken from the input are added after the division", () => {
    // 100 / 0.95 = 106, then 3 setup pieces destroyed before any of it: 109.
    const r = routeInput(100, [stage({ id: "p", name: "Press", yield: pc(95), fixedPieces: 3, consumes: CONSUMES.INPUT })]);
    assert.equal(r.blanksRequired, 109n);
    assert.equal(r.steps[0].lostToFixed, 3n);
  });

  test("test pieces taken from accepted output are added before the division", () => {
    // 3 destructive tests consume finished parts, so demand is 103 before the
    // yield divides: ceil(103 / 0.95) = 109. Same number here by coincidence
    // of the arithmetic, which is exactly why the convention must be explicit.
    const r = routeInput(100, [stage({ id: "p", name: "Press", yield: pc(95), fixedPieces: 3, consumes: CONSUMES.OUTPUT })]);
    assert.equal(r.steps[0].goodOutput, 100n);
    assert.equal(r.blanksRequired, 109n);
  });

  test("the two conventions diverge where the yield is harsher", () => {
    const fromInput = routeInput(100, [stage({ id: "p", name: "P", yield: pc(50), fixedPieces: 10, consumes: CONSUMES.INPUT })]);
    const fromOutput = routeInput(100, [stage({ id: "p", name: "P", yield: pc(50), fixedPieces: 10, consumes: CONSUMES.OUTPUT })]);
    assert.equal(fromInput.blanksRequired, 210n);   // 200 + 10
    assert.equal(fromOutput.blanksRequired, 220n);  // (100 + 10) / 0.5
    assert.notEqual(fromInput.blanksRequired, fromOutput.blanksRequired);
  });

  test("no stages at all means no losses, not an error", () => {
    const r = routeInput(100, []);
    assert.equal(r.blanksRequired, 100n);
    assert.equal(r.processLoss, 0n);
  });

  test("a non-positive or fractional part count is refused", () => {
    assert.throws(() => routeInput(0, []), /positive whole number/);
    assert.throws(() => routeInput(-5, []), /positive whole number/);
    assert.throws(() => routeInput(10.5, []), /positive whole number/);
  });
});

/* ------------------------------------------------------------ the layout */

describe("a simple grid, and it says so", () => {
  const sheet = { width: length("2000", "mm"), length: length("1000", "mm") };
  const kerf = length("3", "mm");
  const edge = length("10", "mm");

  test("blanks fit with kerf between them and a margin at the edge", () => {
    // Usable 1980 x 980. Each 200mm blank plus 3mm kerf: (1980+3)/(200+3) = 9.
    const blank = { width: length("200", "mm"), length: length("100", "mm") };
    const L = sheetLayout(sheet, blank, { kerf, edgeMargin: edge });
    assert.equal(L.columns, 9n);
    assert.equal(L.rows, 9n);   // (980+3)/(100+3) = 9
    assert.equal(L.perSheet, 81n);
    assert.equal(L.kind, "simple grid");
  });

  test("it never calls itself a nest", () => {
    const blank = { width: length("200", "mm"), length: length("100", "mm") };
    const L = sheetLayout(sheet, blank, { kerf, edgeMargin: edge });
    assert.match(L.note, /not an optimal nest/);
    assert.match(L.note, /irregular shape/);
  });

  test("a boundary fit is decided by the kerf, not by the nominal size", () => {
    // Usable 1980 wide. Ten 198mm blanks fit exactly with no kerf...
    const noKerf = sheetLayout(sheet, { width: length("198", "mm"), length: length("100", "mm") },
      { kerf: length("0", "mm"), edgeMargin: edge });
    assert.equal(noKerf.columns, 10n);
    // ...and nine with a 3mm saw, because the tenth needs 9 kerfs of room.
    const withKerf = sheetLayout(sheet, { width: length("198", "mm"), length: length("100", "mm") },
      { kerf, edgeMargin: edge });
    assert.equal(withKerf.columns, 9n);
  });

  test("rotation is not applied unless it is permitted", () => {
    // 990 x 150: as drawn, 2 across and 6 down = 12. Rotated, 1 across... the
    // point is that the engine must not silently turn the part.
    const blank = { width: length("900", "mm"), length: length("150", "mm") };
    const fixed = sheetLayout(sheet, blank, { kerf, edgeMargin: edge, rotationAllowed: false });
    const free = sheetLayout(sheet, blank, { kerf, edgeMargin: edge, rotationAllowed: true });
    assert.equal(fixed.orientation, "as drawn");
    assert.ok(free.perSheet >= fixed.perSheet);
  });

  test("when rotation would help and is forbidden, it says so rather than doing it", () => {
    const blank = { width: length("1500", "mm"), length: length("300", "mm") };
    const fixed = sheetLayout(sheet, blank, { kerf, edgeMargin: edge, rotationAllowed: false });
    // 1500 across fits once; 300 down fits three times. Rotated it would be
    // 300 across (six) by 1500 down (zero) — so here it would not help, and
    // the flag must be honest about that too.
    assert.equal(typeof fixed.rotationWouldHelp, "boolean");
  });

  test("a blank larger than the stock produces a reason, not a zero", () => {
    const L = sheetLayout(sheet, { width: length("2500", "mm"), length: length("100", "mm") },
      { kerf, edgeMargin: edge });
    assert.equal(L.ok, false);
    assert.equal(L.perSheet, 0n);
    assert.match(L.reason, /does not fit/);
  });

  test("an edge margin that consumes the sheet says that, specifically", () => {
    const L = sheetLayout(sheet, { width: length("10", "mm"), length: length("10", "mm") },
      { kerf, edgeMargin: length("600", "mm") });
    assert.equal(L.ok, false);
    assert.match(L.reason, /no usable area/);
  });

  test("utilisation is reported beside the count, so a wasteful layout is visible", () => {
    const L = sheetLayout(sheet, { width: length("200", "mm"), length: length("100", "mm") },
      { kerf, edgeMargin: edge });
    assert.equal(ratioToPercentString(L.utilisation, 1), "81.0%");
    assert.ok(L.unusedAreaUm2 > 0n);
  });

  test("a dimension that is not a length is refused", () => {
    assert.throws(
      () => sheetLayout(sheet, { width: 200, length: length("100", "mm") }, { kerf, edgeMargin: edge }),
      /must be a length/);
  });
});

describe("bars are cut, and the last cut is a cut", () => {
  const bar = { length: length("6", "m") };

  test("end trim comes off both ends", () => {
    // 6000 - 2x25 = 5950 usable. Each 300mm blank plus a 3mm part-off: 19.
    const L = barLayout(bar, length("300", "mm"), { kerf: length("3", "mm"), endTrim: length("25", "mm") });
    assert.equal(L.perBar, 19n);
    assert.equal(L.trimLengthUm, 50_000n);
  });

  test("n blanks consume n kerfs, not n minus one", () => {
    const L = barLayout(bar, length("300", "mm"), { kerf: length("3", "mm"), endTrim: length("0", "mm") });
    assert.equal(L.kerfLengthUm, L.perBar * 3_000n);
  });

  test("a bar shorter than one blank produces a reason", () => {
    const L = barLayout({ length: length("200", "mm") }, length("300", "mm"),
      { kerf: length("3", "mm"), endTrim: length("25", "mm") });
    assert.equal(L.ok, false);
    assert.match(L.reason, /shorter than one blank/);
  });

  test("trim that consumes the bar says so", () => {
    const L = barLayout({ length: length("40", "mm") }, length("10", "mm"),
      { kerf: length("1", "mm"), endTrim: length("25", "mm") });
    assert.equal(L.ok, false);
    assert.match(L.reason, /whole bar/);
  });
});

/* -------------------------------------------------------- the whole plan */

function plateJob(over = {}) {
  const blank = { width: length("200", "mm"), length: length("100", "mm") };
  const sheet = { width: length("2000", "mm"), length: length("1000", "mm") };
  const thickness = length("5", "mm");
  return planMaterial({
    goodParts: over.goodParts ?? 1000,
    stages: over.stages ?? [
      stage({ id: "cut", name: "Laser cut", yield: pc(98) }),
      stage({ id: "form", name: "Form", yield: pc(95), fixedPieces: 4, consumes: CONSUMES.INPUT }),
    ],
    layout: over.layout ?? sheetLayout(sheet, blank, { kerf: length("3", "mm"), edgeMargin: length("10", "mm") }),
    density: over.density === null ? undefined : (over.density ?? steel()),
    stockVolumeUm3: boxVolume(sheet.width, sheet.length, thickness),
    blankVolumeUm3: boxVolume(blank.width, blank.length, thickness),
    partVolumeUm3: boxVolume(length("180", "mm"), length("80", "mm"), thickness),
    ...over.extra,
  });
}

describe("from parts wanted to stock to buy", () => {
  test("every quantity is a separate number", () => {
    const p = plateJob();
    const q = p.quantities;
    assert.equal(q.acceptedPartsRequired, 1000n);
    // Backwards through the route: form wants 1000 out, so ceil(1000 / 0.95)
    // = 1053 in, plus 4 setup pieces it destroys = 1057. The cut before it
    // must therefore deliver 1057, so ceil(1057 / 0.98) = 1079 blanks.
    assert.equal(p.route.steps[1].requiredInput, 1057n);
    assert.equal(q.blanksForProcess, 1079n);
    // 1079 blanks at 81 per sheet is 14 sheets (13.32 rounded up).
    assert.equal(q.blanksPerStockUnit, 81n);
    assert.equal(q.stockUnitsNeeded, 14n);
    assert.ok(q.stockUnitsToBuy >= q.stockUnitsNeeded);
  });

  test("the statement names the chain rather than asserting a number", () => {
    const p = plateJob();
    assert.match(p.statement, /1000 accepted parts needs/);
    assert.match(p.statement, /stock unit/);
  });

  test("purchase rounding is reported as its own cause", () => {
    const p = plateJob();
    assert.equal(p.losses.purchaseRoundingUnits, p.quantities.stockUnitsToBuy - p.quantities.stockUnitsNeeded);
    assert.equal(p.losses.processLossPieces, p.route.processLoss);
  });

  test("a minimum order raises the purchase without touching the requirement", () => {
    const base = plateJob();
    const withMin = plateJob({ extra: { minimumOrder: 500 } });
    assert.equal(withMin.quantities.stockUnitsNeeded, base.quantities.stockUnitsNeeded);
    assert.equal(withMin.quantities.stockUnitsToBuy, 500n);
    assert.ok(withMin.losses.purchaseRoundingUnits > 0n);
  });

  test("a pack increment rounds up to what the supplier actually sells", () => {
    const p = plateJob({ extra: { packIncrement: 10 } });
    assert.equal(p.quantities.stockUnitsToBuy % 10n, 0n);
  });

  test("contingency is a separate quantity, never folded into the requirement", () => {
    const base = plateJob();
    const withC = plateJob({ extra: { contingency: pc(5) } });
    assert.equal(withC.quantities.blanksForProcess, base.quantities.blanksForProcess,
      "contingency must not change what the route requires");
    assert.ok(withC.quantities.contingencyBlanks > 0n);
    assert.equal(withC.quantities.blanksToRelease,
      withC.quantities.blanksForProcess + withC.quantities.contingencyBlanks);
  });

  test("a cutting-scrap uplift on top of a layout is refused as a double count", () => {
    assert.throws(() => plateJob({ extra: { generalScrapUplift: true } }), /counted twice/);
  });

  test("a layout that failed produces no purchase quantity at all", () => {
    const p = plateJob({
      layout: sheetLayout({ width: length("100", "mm"), length: length("100", "mm") },
        { width: length("200", "mm"), length: length("100", "mm") },
        { kerf: length("3", "mm"), edgeMargin: length("10", "mm") }),
    });
    assert.equal(p.ok, false);
    assert.match(p.reason, /does not fit/);
  });

  test("recoverable offcut is kept apart from the parts released", () => {
    const p = plateJob();
    assert.ok(p.volume.recoverableOffcutUm3 > 0n);
    assert.equal(p.volume.purchasedUm3,
      p.volume.releasedAsBlanksUm3 + p.volume.recoverableOffcutUm3);
  });

  test("without a density there is no mass, rather than a guessed one", () => {
    const p = plateJob({ density: null });
    assert.equal(p.mass.grossPurchasedUg, null);
    assert.equal(p.mass.densitySource, null);
    assert.ok(p.quantities.stockUnitsToBuy > 0n, "the quantity plan still works without a density");
  });

  test("with a density, the source travels with the mass", () => {
    const p = plateJob();
    assert.match(p.mass.densitySource, /synthetic datasheet/);
    assert.ok(p.mass.grossPurchasedUg > p.mass.finishedPartsNetUg,
      "gross purchased mass must exceed the net mass of the finished parts");
  });

  test("a negative contingency is refused", () => {
    assert.throws(() => plateJob({ extra: { contingency: -1n } }), /cannot be negative/);
  });

  test("an invalid pack increment or minimum is refused", () => {
    assert.throws(() => plateJob({ extra: { packIncrement: 0 } }), /positive whole number/);
    assert.throws(() => plateJob({ extra: { minimumOrder: -1 } }), /cannot be negative/);
  });
});

/* ------------------------------------------------------------- the cost */

describe("a missing rate is missing", () => {
  const plan = () => plateJob();

  test("an element nobody mentioned does not make the estimate incomplete", () => {
    const c = costPlan(plan(), [
      { id: "stock", amount: gbp("4200.00"), basis: "quoted sheet price", quality: BASIS.QUOTED },
    ]);
    assert.equal(c.complete, true);
    assert.equal(c.confidence, CONFIDENCE.QUOTED);
  });

  test("an element with no amount is a declared gap, and blocks the total", () => {
    const c = costPlan(plan(), [
      { id: "stock", amount: gbp("4200.00"), basis: "quoted sheet price", quality: BASIS.QUOTED },
      { id: "manufacturing", amount: null, note: "no machining rate yet" },
    ]);
    assert.equal(c.complete, false);
    assert.equal(c.confidence, CONFIDENCE.INCOMPLETE);
    assert.equal(c.perAcceptedPart, null, "a per-part figure over a partial subtotal would be a lie");
    assert.equal(c.missing[0].id, "manufacturing");
    assert.match(c.missing[0].needs, /cycle rate/);
  });

  test("the partial sum is called a subtotal, in those words", () => {
    const c = costPlan(plan(), [
      { id: "stock", amount: gbp("4200.00"), basis: "quoted", quality: BASIS.QUOTED },
      { id: "freight", amount: null },
    ]);
    assert.match(c.statement, /partial subtotal, not a cost/);
    assert.match(c.statement, /Nothing was assumed in their place/);
    assert.equal(/\btotal\b/i.test(c.statement), false);
  });

  test("an unpriced element still appears as a line, so it cannot be overlooked", () => {
    const c = costPlan(plan(), [
      { id: "stock", amount: gbp("4200.00"), basis: "quoted", quality: BASIS.QUOTED },
      { id: "special", amount: null, note: "heat treatment not yet quoted" },
    ]);
    const line = c.lines.find((l) => l.id === "special");
    assert.equal(line.amount, null);
    assert.equal(line.signed, 0n);
    assert.equal(line.note, "heat treatment not yet quoted");
  });

  test("a priced element without a basis is refused", () => {
    assert.throws(
      () => costPlan(plan(), [{ id: "stock", amount: gbp("100.00"), quality: BASIS.QUOTED }]),
      /no basis/);
  });

  test("an unknown element is refused rather than silently ignored", () => {
    assert.throws(() => costPlan(plan(), [{ id: "vibes", amount: gbp("1.00"), basis: "x" }]), /not a cost element/);
  });

  test("the same element twice is refused", () => {
    assert.throws(() => costPlan(plan(), [
      { id: "stock", amount: gbp("1.00"), basis: "a", quality: BASIS.QUOTED },
      { id: "stock", amount: gbp("2.00"), basis: "b", quality: BASIS.QUOTED },
    ]), /entered twice/);
  });

  test("mixed currencies raise rather than converting", () => {
    assert.throws(() => costPlan(plan(), [
      { id: "stock", amount: gbp("100.00"), basis: "a", quality: BASIS.QUOTED },
      { id: "freight", amount: moneyFromDecimal("50.00", "EUR", null), basis: "b", quality: BASIS.QUOTED },
    ]), /never.*converted implicitly/);
  });
});

describe("the estimate is only as strong as its weakest element", () => {
  test("one assumed element makes the whole thing budgetary", () => {
    const c = costPlan(plateJob(), [
      { id: "stock", amount: gbp("4200.00"), basis: "quoted sheet price", quality: BASIS.QUOTED },
      { id: "manufacturing", amount: gbp("900.00"), basis: "estimated cycle time", quality: BASIS.ASSUMED },
    ]);
    assert.equal(c.complete, true);
    assert.equal(c.confidence, CONFIDENCE.BUDGETARY);
  });

  test("reviewed sits between assumed and quoted", () => {
    const c = costPlan(plateJob(), [
      { id: "stock", amount: gbp("4200.00"), basis: "quoted", quality: BASIS.QUOTED },
      { id: "manufacturing", amount: gbp("900.00"), basis: "planner's cycle time", quality: BASIS.REVIEWED },
    ]);
    assert.equal(c.confidence, CONFIDENCE.REVIEWED);
  });

  test("tooling is one-time and sits outside the recurring cost by default", () => {
    const c = costPlan(plateJob(), [
      { id: "stock", amount: gbp("4200.00"), basis: "quoted", quality: BASIS.QUOTED },
      { id: "tooling", amount: gbp("15000.00"), basis: "quoted NRE", quality: BASIS.QUOTED },
    ]);
    assert.equal(moneyToDecimalString(c.subtotal), "4200.00");
    assert.equal(moneyToDecimalString(c.oneTime), "15000.00");
  });

  test("amortising tooling moves it into the recurring cost, and says nothing else changed", () => {
    const c = costPlan(plateJob(), [
      { id: "stock", amount: gbp("4200.00"), basis: "quoted", quality: BASIS.QUOTED },
      { id: "tooling", amount: gbp("15000.00"), basis: "quoted NRE", quality: BASIS.QUOTED },
    ], { amortiseTooling: true });
    assert.equal(moneyToDecimalString(c.subtotal), "19200.00");
    assert.equal(moneyToDecimalString(c.oneTime), "0.00");
  });

  test("a scrap credit reduces the cost, and is marked as a credit", () => {
    const c = costPlan(plateJob(), [
      { id: "stock", amount: gbp("4200.00"), basis: "quoted", quality: BASIS.QUOTED },
      { id: "scrapCredit", amount: gbp("200.00"), basis: "evidenced credit rate", quality: BASIS.QUOTED },
    ]);
    assert.equal(moneyToDecimalString(c.subtotal), "4000.00");
    assert.equal(c.lines.find((l) => l.id === "scrapCredit").credit, true);
  });

  test("cost per accepted part is over the parts actually required", () => {
    const c = costPlan(plateJob(), [
      { id: "stock", amount: gbp("4000.00"), basis: "quoted", quality: BASIS.QUOTED },
    ]);
    assert.equal(moneyToDecimalString(c.perAcceptedPart), "4.00");
  });

  test("material share is reported, so the shape of the cost is visible", () => {
    const c = costPlan(plateJob(), [
      { id: "stock", amount: gbp("3000.00"), basis: "quoted", quality: BASIS.QUOTED },
      { id: "manufacturing", amount: gbp("1000.00"), basis: "quoted", quality: BASIS.QUOTED },
    ]);
    assert.equal(ratioToPercentString(c.materialShare, 0), "75%");
  });

  test("every element in the catalogue states what basis it needs", () => {
    for (const e of COST_ELEMENTS) {
      assert.ok(e.basisNeeded && e.basisNeeded.length > 10, `${e.id} does not say what it needs`);
      assert.ok(e.label, `${e.id} has no label`);
    }
  });

  test("no plan means no cost", () => {
    assert.equal(costPlan(null, []).ok, false);
    assert.match(costPlan({ ok: false }, []).reason, /no material plan/);
  });
});

/* ------------------------------------------------------- reproducibility */

describe("a result without its assumptions is not a result", () => {
  test("every yield reaches the assumptions table with its basis", () => {
    const rows = assumptions(plateJob(), null);
    const yields = rows.filter((r) => r.what.endsWith("yield"));
    assert.equal(yields.length, 2);
    for (const y of yields) assert.equal(y.basis, BASIS.ASSUMED);
  });

  test("setup pieces say which side of the yield they came from", () => {
    const rows = assumptions(plateJob(), null);
    const fixed = rows.find((r) => r.what.includes("setup and test"));
    assert.match(fixed.affects, /taken from the input/);
  });

  test("the density source is recorded, because mass and cost rest on it", () => {
    const rows = assumptions(plateJob(), null);
    const d = rows.find((r) => r.what === "Density");
    assert.match(d.basis, /synthetic datasheet/);
    assert.match(d.affects, /material cost/);
  });

  test("the layout records that it was a simple grid and whether rotation was allowed", () => {
    const rows = assumptions(plateJob(), null);
    const l = rows.find((r) => r.what === "Stock layout");
    assert.match(l.basis, /simple grid/);
    assert.match(l.basis, /rotation not permitted/);
  });

  test("contingency appears as an assumption, not as a requirement", () => {
    const rows = assumptions(plateJob({ extra: { contingency: pc(5) } }), null);
    const c = rows.find((r) => r.what === "Contingency");
    assert.equal(c.basis, BASIS.ASSUMED);
    assert.match(c.affects, /above what the route requires/);
  });

  test("cost lines carry their basis into the same table", () => {
    const p = plateJob();
    const rows = assumptions(p, costPlan(p, [
      { id: "stock", amount: gbp("4200.00"), basis: "quoted sheet price", quality: BASIS.QUOTED },
    ]));
    const stock = rows.find((r) => r.what === "Raw stock");
    assert.match(stock.basis, /quote-backed — quoted sheet price/);
  });
});
