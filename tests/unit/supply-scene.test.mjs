/**
 * The supply scene.
 *
 * `specs/06` asks for supplier -> transport -> production -> customer,
 * *"populated from the case rather than decorative pseudo-data"*. Most of what
 * is worth checking here is therefore about what the module refuses to say:
 * no figures, no populated-looking empty stage, and no bottleneck named from
 * data that cannot name one.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { assumptionsToVerify } from "../../src/calc/provenance.mjs";
import { ratioFromPercent, moneyFromDecimal } from "../../src/calc/exact.mjs";
import { whatIf, adopt, SCENARIO } from "../../src/calc/scenarios.mjs";
import {
  scene, STAGE, STAGE_TITLE, ORDER, STATE, WEIGHT, WOULD_FILL,
} from "../../src/case/supply-scene.mjs";

const p = (x) => ratioFromPercent(x);
const gbp = (x) => moneyFromDecimal(x, "GBP");

/** Every driver sourced, and the weights adding to the whole. */
const fullyEvidenced = () => costBridge({
  baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
  requestedChange: p("9"),
  drivers: [
    { id: "material", label: "Steel bar", weight: p("60"), indexMovement: p("10"),
      source: "synthetic-index-A" },
    { id: "labour", label: "Direct labour", weight: p("40"), indexMovement: p("5"),
      source: "synthetic-index-B" },
  ],
});

/** The ordinary case: part of the cost unexplained, one driver unsourced. */
const ordinary = () => costBridge({
  baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
  requestedChange: p("9"),
  drivers: [
    { id: "material", label: "Steel bar", weight: p("42"), indexMovement: p("10"),
      source: "synthetic-index-A" },
    { id: "labour", label: "Direct labour", weight: p("18"), indexMovement: p("5") },
  ],
});

const stageOf = (s, stage) => s.stages.find((x) => x.stage === stage);

/** A split delivery somebody adopted. */
function adoptedSplit(by = "category manager") {
  const s = whatIf(SCENARIO.SPLIT, {
    base: { id: "plan", revision: "r1", unitPrice: gbp("100.00"), quantity: 50_000 },
    inputs: {
      firstQuantity: "20000", totalQuantity: "50000", secondFreight: "450.00",
      firstDate: "2026-11-02", secondDate: "2027-01-18",
    },
  });
  return adopt(s, by);
}

/* ------------------------------------------------------------- the shape */

describe("the four stages", () => {
  test("are always all four, in supply order", () => {
    const s = scene({ bridge: ordinary() });
    assert.deepEqual(s.stages.map((x) => x.stage), [...ORDER]);
    assert.deepEqual(s.stages.map((x) => x.title), ORDER.map((k) => STAGE_TITLE[k]));
  });

  test("exist even with no case at all", () => {
    const s = scene();
    assert.equal(s.stages.length, 4);
    for (const stage of s.stages) assert.equal(stage.state, STATE.NOTHING_KNOWN);
  });

  test("and nothing is nominated when there is nothing to nominate from", () => {
    assert.equal(scene().attention.stage, null);
    assert.match(scene().attention.why, /Nothing in this case names a stage/);
  });
});

/* ------------------------------------------------- what it refuses to say */

describe("no figures, anywhere", () => {
  test("not a money amount and not a percentage, in any stage", () => {
    const s = scene({
      bridge: ordinary(), supplier: "Northgate (synthetic)", adopted: [adoptedSplit()],
    });
    const words = JSON.stringify(s);
    assert.equal(/\d+\.\d{2}\s*(GBP|%)/.test(words), false, "a figure reached the scene");
    assert.equal(/\d+\.\d+%/.test(words), false, "a percentage reached the scene");
  });

  test("the quantity is reported as stated, not stated as a number", () => {
    const production = stageOf(scene({ bridge: ordinary() }), STAGE.PRODUCTION);
    assert.match(production.known[0].said, /annual quantity/);
    assert.equal(production.known[0].said.includes("50000"), false);
    assert.equal(production.known[0].said.includes("50,000"), false);
  });
});

describe("a stage the case knows nothing about", () => {
  const empty = () => stageOf(scene({ bridge: ordinary() }), STAGE.TRANSPORT);

  test("says so rather than looking populated", () => {
    assert.equal(empty().state, STATE.NOTHING_KNOWN);
    assert.deepEqual(empty().known, []);
  });

  test("names what would fill it, as something a person could go and find", () => {
    assert.ok(empty().questions[0].said.includes(WOULD_FILL[STAGE.TRANSPORT]));
  });

  test("and that sentence is not counted as a question about the case", () => {
    assert.equal(empty().questions[0].weight, WEIGHT.OPEN);
  });

  test("reads as a sentence, not as a slot with a word in it", () => {
    const customer = stageOf(scene({ bridge: ordinary() }), STAGE.CUSTOMER);
    assert.match(customer.questions[0].said, /nothing about the customer/);
  });
});

/* ------------------------------------------------------- what it does say */

describe("the supplier stage", () => {
  const s = () => stageOf(
    scene({ bridge: ordinary(), supplier: "Northgate (synthetic)" }), STAGE.SUPPLIER);

  test("names the supplier, from the form", () => {
    assert.equal(s().known[0].said, "Northgate (synthetic) is the supplier this claim is from.");
    assert.equal(s().known[0].from, "the form");
  });

  test("says what each driver is claimed against", () => {
    assert.ok(s().known.some((k) => k.said === "Steel bar is claimed against synthetic-index-A."));
  });

  test("and says plainly when one is claimed against nothing", () => {
    assert.ok(s().known.some((k) => k.said === "Direct labour is claimed with no source named."));
    assert.ok(s().questions.some((q) =>
      q.said === "Nothing says where Direct labour's movement comes from."));
  });

  test("links an unsourced driver to the tick the case view already offers", () => {
    const bridge = ordinary();
    const assumptions = assumptionsToVerify(bridge);
    const linked = stageOf(scene({ bridge, assumptions }), STAGE.SUPPLIER)
      .questions.find((q) => /Direct labour/.test(q.said));

    assert.equal(linked.assumption, "movement-labour");
    assert.ok(assumptions.some((a) => a.id === linked.assumption),
      "the scene points at an assumption the case does not offer");
  });

  test("and links to nothing when the case offers no tick for it", () => {
    const unlinked = s().questions.find((q) => /Direct labour/.test(q.said));
    assert.equal(unlinked.assumption, null);
  });

  test("the unexplained part is never linked, because a tick would not settle it", () => {
    const bridge = ordinary();
    const q = stageOf(scene({ bridge, assumptions: assumptionsToVerify(bridge) }), STAGE.SUPPLIER)
      .questions.find((x) => /rests on nothing stated/.test(x.said));
    assert.equal(q.assumption, null);
  });

  test("a fully evidenced claim raises neither", () => {
    const clean = stageOf(scene({ bridge: fullyEvidenced() }), STAGE.SUPPLIER);
    assert.deepEqual(clean.questions.filter((q) => q.weight === WEIGHT.MATERIAL), []);
  });
});

/* --------------------------------------------------------- adopted options */

describe("an adopted option is a fact about the case", () => {
  const s = () => scene({ bridge: ordinary(), adopted: [adoptedSplit()] });

  test("a split delivery populates transport", () => {
    assert.equal(stageOf(s(), STAGE.TRANSPORT).state, STATE.POPULATED);
    assert.match(stageOf(s(), STAGE.TRANSPORT).known[0].said, /second delivery's freight/);
  });

  test("and customer, because somebody is waiting for the rest of it", () => {
    assert.equal(stageOf(s(), STAGE.CUSTOMER).state, STATE.POPULATED);
    assert.ok(stageOf(s(), STAGE.CUSTOMER).questions.some((q) => /Who is waiting/.test(q.said)));
  });

  test("and each fact says which option it came from and who adopted it", () => {
    assert.match(stageOf(s(), STAGE.TRANSPORT).known[0].from,
      /the option "Split the delivery", adopted by category manager on /);
  });
});

describe("an option nobody adopted", () => {
  const unadopted = whatIf(SCENARIO.SPLIT, {
    base: { id: "plan", revision: "r1", unitPrice: gbp("100.00"), quantity: 50_000 },
    inputs: {
      firstQuantity: "20000", totalQuantity: "50000", secondFreight: "450.00",
      firstDate: "2026-11-02", secondDate: "2027-01-18",
    },
  });

  test("does not reach the scene, because it is not the plan", () => {
    const s = scene({ bridge: ordinary(), adopted: [unadopted] });
    assert.equal(stageOf(s, STAGE.TRANSPORT).state, STATE.NOTHING_KNOWN);
  });

  test("and neither does one that was never worked out", () => {
    const waiting = whatIf(SCENARIO.SPLIT, {
      base: { id: "plan", revision: "r1", unitPrice: gbp("100.00"), quantity: 50_000 },
      inputs: { firstQuantity: "20000" },
    });
    const s = scene({ bridge: ordinary(), adopted: [{ ...waiting, adopted: { by: "x" } }] });
    assert.equal(stageOf(s, STAGE.TRANSPORT).state, STATE.NOTHING_KNOWN);
  });
});

/* --------------------------------------------------------- the bottleneck */

describe("naming the stage to look at", () => {
  test("names one when exactly one carries something material", () => {
    const s = scene({ bridge: ordinary() });
    assert.equal(s.attention.stage, STAGE.SUPPLIER);
    assert.ok(s.attention.why.length > 20);
  });

  test("names none when nothing material is outstanding", () => {
    const s = scene({ bridge: fullyEvidenced() });
    assert.equal(s.attention.stage, null);
    assert.match(s.attention.why, /Nothing in this case names a stage/);
  });

  test("open questions never nominate a stage on their own", () => {
    /* Production always has one — whether the quantity is a commitment — and a
       stage that is the bottleneck of every case is a decoration. */
    const s = scene({ bridge: fullyEvidenced() });
    const production = stageOf(s, STAGE.PRODUCTION);
    assert.ok(production.questions.length > 0);
    assert.equal(s.attention.stage, null);
  });
});
