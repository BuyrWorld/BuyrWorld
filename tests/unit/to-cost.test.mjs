/**
 * Carrying a part into the cost plan.
 *
 * The audit named the danger in one sentence — *"Do not silently use model
 * mass as purchased stock mass"* — and most of this file is that sentence
 * checked from several sides: the blank is not the part, purchased mass is not
 * offered at all, a bracket is never handed over as a figure, and a transfer
 * made against a part that has since moved cannot be taken.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { block, addHole, addPocket, resize, volume } from "../../src/studio/geometry.mjs";
import { density } from "../../src/calc/units.mjs";
import { propose, accept, stillAbout, ALLOWANCES } from "../../src/studio/to-cost.mjs";

const steel = () => density("7850", "kg/m3", "synthetic — EN 10025-2 nominal");

/** A plain rectangular part: its volume is exact. */
const plain = () => block({ widthUm: 100_000n, lengthUm: 60_000n, thicknessUm: 10_000n });

/** The same part with a hole, so its volume is a bracket. */
const holed = () => addHole(plain(), { xUm: 15_000n, yUm: 20_000n, diameterUm: 8_000n }).model;

const allowances = { sideUm: 2_000n, endUm: 2_000n, faceUm: 1_000n };

/* ------------------------------------------------------ before it will say */

describe("what it asks for first", () => {
  test("every allowance, by name, as a question somebody can answer", () => {
    const r = propose({ model: plain() });
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing.map((m) => m.what).sort(), Object.keys(ALLOWANCES).sort());
    for (const m of r.missing) assert.match(m.why, /\?$/);
  });

  test("and it says why zero is not a default", () => {
    assert.match(propose({ model: plain() }).said, /allowance of nothing, which is a decision/);
  });

  test("a missing allowance withholds everything, not just the blank", () => {
    const r = propose({ model: plain(), allowances: { sideUm: 2_000n, endUm: 2_000n } });
    assert.equal(r.ok, false);
    assert.equal(r.blank, undefined);
    assert.equal(r.forPlan, undefined);
  });

  test("zero itself is an answer, and is accepted as one", () => {
    const r = propose({
      model: plain(), allowances: { sideUm: 0n, endUm: 0n, faceUm: 0n },
    });
    assert.equal(r.ok, true);
    assert.equal(r.blank.widthUm, 100_000n);
  });

  test("no model, and it says there is nothing to cut from", () => {
    assert.match(propose({ allowances }).missing[0].why, /nothing to cut a blank from/);
  });
});

/* ------------------------------------------------------------- the blank */

describe("the blank", () => {
  const p = () => propose({ model: plain(), density: steel(), allowances });

  test("is the part plus the allowances, on both sides of each axis", () => {
    assert.equal(p().blank.widthUm, 104_000n);
    assert.equal(p().blank.lengthUm, 64_000n);
    assert.equal(p().blank.thicknessUm, 11_000n);
  });

  test("its volume is exact, because a blank is a box", () => {
    assert.equal(p().blankVolumeUm3, 104_000n * 64_000n * 11_000n);
  });

  test("and what cutting removes is stated", () => {
    const v = volume(plain());
    assert.equal(p().removed.lowerUm3, p().blankVolumeUm3 - v.upperUm3);
    assert.equal(p().removed.upperUm3, p().blankVolumeUm3 - v.lowerUm3);
  });

  test("the allowances are said in words, not only held as numbers", () => {
    assert.match(p().says[0], /plus 2mm each side, 2mm each end and 1mm on the thickness/);
  });

  test("and it says what it is not: the stock, and the purchase quantity", () => {
    assert.ok(p().says.some((s) => /Nothing here says what the stock is/.test(s)));
  });
});

/* -------------------------------------------------- mass, and what it is not */

describe("weight", () => {
  test("is withheld entirely without a confirmed density", () => {
    const r = propose({ model: plain(), allowances });
    assert.equal(r.mass.known, false);
    assert.match(r.mass.why, /guessed from a similar alloy moves the whole purchased quantity/);
  });

  test("with one, the blank and the part are given separately", () => {
    const r = propose({ model: plain(), density: steel(), allowances });
    assert.equal(r.mass.known, true);
    assert.ok(r.mass.blankUg > r.mass.partUpperUg,
      "the blank cannot weigh less than the part cut from it");
  });

  test("and the source travels with it", () => {
    assert.match(propose({ model: plain(), density: steel(), allowances }).mass.source,
      /EN 10025-2/);
  });

  test("purchased mass is not offered, and its absence is deliberate", () => {
    const r = propose({ model: plain(), density: steel(), allowances });
    assert.equal(r.forPlan.purchasedMassUg, null);
    assert.ok("purchasedMassUg" in r.forPlan,
      "the field should be present and null, so nobody fills it in by accident");
    assert.match(r.mass.note, /not the purchased weight/);
  });
});

/* ------------------------------------------------- a bracket stays a bracket */

describe("a part with a round feature", () => {
  const p = () => propose({ model: holed(), density: steel(), allowances });

  test("reports its volume as bounds", () => {
    assert.equal(p().part.exact, false);
    assert.ok(p().part.upperUm3 > p().part.lowerUm3);
  });

  test("and the cost plan is given no single figure for it", () => {
    assert.equal(p().forPlan.partVolumeUm3, null);
    assert.match(p().forPlan.partVolumeWithheld, /bracket rather than a figure/);
  });

  test("while a plain part hands one over", () => {
    const flat = propose({ model: plain(), density: steel(), allowances });
    assert.equal(flat.forPlan.partVolumeUm3, volume(plain()).lowerUm3);
    assert.equal(flat.forPlan.partVolumeWithheld, null);
  });

  test("the removed volume is a range, said as one", () => {
    assert.ok(p().says.some((s) => /removes between/.test(s)));
  });
});

/* --------------------------------------------------------- taking it across */

describe("accepting a transfer", () => {
  const p = () => propose({ model: plain(), density: steel(), allowances });

  test("records who did it and which revision it was made against", () => {
    const t = accept(p(), "estimator", { model: plain(), density: steel() });
    assert.equal(t.by, "estimator");
    assert.equal(t.fromRevision, plain().revision);
    assert.ok(t.at);
  });

  test("and carries only the fields the plan takes", () => {
    const t = accept(p(), "estimator", { model: plain(), density: steel() });
    assert.equal(t.blankVolumeUm3, p().blankVolumeUm3);
    assert.equal("grossPurchasedUg" in t, false);
    assert.equal("features" in t, false, "the model came across with the transfer");
  });

  test("it cannot be done by nobody", () => {
    assert.throws(() => accept(p(), null, { model: plain(), density: steel() }),
      /record who did it/);
  });

  test("and not at all while anything is missing", () => {
    assert.throws(() => accept(propose({ model: plain() }), "estimator", { model: plain() }),
      /nothing to carry over/);
  });

  test("a part that has moved since refuses the transfer, naming what moved", () => {
    const proposal = p();
    const changed = resize(plain(), { widthUm: 120_000n }).model;
    assert.throws(
      () => accept(proposal, "estimator", { model: changed, density: steel() }),
      /geometry has changed/);
  });

  test("a material that has moved since does too", () => {
    const proposal = p();
    const other = density("2700", "kg/m3", "synthetic — aluminium");
    assert.throws(
      () => accept(proposal, "estimator", { model: plain(), density: other }),
      /material has changed/);
  });

  test("and the same question can be asked without throwing", () => {
    const proposal = p();
    assert.equal(stillAbout(proposal, { model: plain(), density: steel() }), true);
    assert.equal(
      stillAbout(proposal, { model: resize(plain(), { widthUm: 120_000n }).model, density: steel() }),
      false);
  });
});

/* --------------------------------------------------------- the linkage rule */

describe("the rule the audit asked for", () => {
  test("nothing in a transfer is the model's own mass presented as purchased mass", () => {
    const t = accept(propose({ model: plain(), density: steel(), allowances }),
      "estimator", { model: plain(), density: steel() });
    const fields = Object.keys(t);
    for (const forbidden of ["grossPurchasedUg", "purchasedUm3", "stockUnitsToBuy", "massUg"]) {
      assert.equal(fields.includes(forbidden), false, `${forbidden} crossed over`);
    }
    assert.equal(t.purchasedMassUg, null);
  });

  test("a pocket changes the blank not at all, and the removed volume a lot", () => {
    /* The blank is the envelope. Cutting a pocket into the part removes more
       material; it does not need a bigger piece of stock, and a transfer that
       grew the blank when a pocket appeared would be quietly buying air. */
    const pocketed = addPocket(plain(), {
      xUm: 40_000n, yUm: 10_000n, widthUm: 20_000n, lengthUm: 20_000n, depthUm: 3_000n,
    }).model;

    const flat = propose({ model: plain(), allowances });
    const cut = propose({ model: pocketed, allowances });

    assert.equal(cut.blankVolumeUm3, flat.blankVolumeUm3);
    assert.ok(cut.removed.lowerUm3 > flat.removed.lowerUm3);
  });
});
