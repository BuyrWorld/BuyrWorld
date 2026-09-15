/**
 * AI-assisted edits — increment C4.
 *
 * The pack defines this increment mostly by what it must not do, so that is
 * what the tests are about:
 *
 *   "AI should produce a validated modelling proposal, not arbitrary
 *    executable code."
 *   "Ask a short question rather than guessing an ambiguous target."
 *   "AI must not manufacture a tolerance/finish value, choose an unknown
 *    specification revision, automatically approve requirements."
 *   "Stale AI proposals cannot overwrite newer manual edits."
 *   "Direct and accepted AI edits use the same deterministic operation layer
 *    and produce equivalent geometry."
 *
 * The example instructions in the pack are the fixtures: "add four 6 mm holes
 * 15 mm from the nearest corner", "make this pocket 4 mm deep", "move the
 * selected hole 10 mm along X", "make this aerospace grade", "tighten the
 * tolerance".
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  OPERATION, OUTCOME,
  validate, preview, accept, describe as describeStep, withheld,
} from "../../src/studio/edit-proposal.mjs";
import {
  block, addHole, addPocket, removeFeature, featureIds, volume,
} from "../../src/studio/geometry.mjs";

const mm = (x) => BigInt(Math.round(x * 1000));
const plate = () => block({ widthUm: mm(100), lengthUm: mm(50), thicknessUm: mm(10) });
const ok = (r) => { assert.equal(r.error, undefined, r.error); return r.model; };

const withHole = () => ok(addHole(plate(), { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }));
const withPocket = () => ok(addPocket(plate(), { xUm: mm(40), yUm: mm(10),
  widthUm: mm(20), lengthUm: mm(20), depthUm: mm(3) }));

/* ------------------------------------------- it is data, not an interpreter */

describe("a proposal is data checked against a closed list", () => {
  test("an operation this does not know is refused, and the list is named", () => {
    const r = validate(plate(), { operations: [{ op: "revolve-profile", angle: "90" }] });
    assert.equal(r.outcome, OUTCOME.REFUSED);
    assert.match(r.why, /"revolve-profile" is not something this can do/);
    assert.match(r.why, /add a hole or a pocket/);
  });

  test("nothing in a proposal is evaluated", () => {
    /* The point of the closed list. A field that looks like code is a string
       that fails to parse as a number, not something that runs. */
    const r = validate(plate(), { operations: [
      { op: OPERATION.ADD_HOLE, xMm: "process.exit(1)", yMm: "25", diameterMm: "6" },
    ] });
    assert.equal(r.outcome, OUTCOME.QUESTION);
    assert.match(r.questions[0], /needs an X position, in millimetres/);
  });

  test("the module has no way to evaluate anything", () => {
    const src = readFileSync("src/studio/edit-proposal.mjs", "utf8");
    assert.equal(/\beval\b|new Function|setTimeout\s*\(\s*["'`]/.test(src), false);
  });

  test("an empty proposal is refused rather than treated as a no-op", () => {
    assert.equal(validate(plate(), { operations: [] }).outcome, OUTCOME.REFUSED);
    assert.equal(validate(plate(), {}).outcome, OUTCOME.REFUSED);
  });

  test("with no part there is nothing to change", () => {
    const r = validate(null, { operations: [{ op: OPERATION.ADD_HOLE }] });
    assert.equal(r.outcome, OUTCOME.REFUSED);
    assert.match(r.why, /Build a block first/);
  });
});

/* ------------------------------------------------- ambiguity becomes a question */

describe("an ambiguous target is asked about, never guessed", () => {
  const twoHoles = () => ok(addHole(withHole(), { xUm: mm(50), yUm: mm(25), diameterUm: mm(6) }));

  test('"the hole" with two holes asks which', () => {
    const r = validate(twoHoles(), { operations: [
      { op: OPERATION.RESIZE_HOLE, target: "the hole", diameterMm: "8" },
    ] });
    assert.equal(r.outcome, OUTCOME.QUESTION);
    assert.match(r.questions[0], /There are 2 holes — hole-1, hole-2\. Which one\?/);
  });

  test('"the pocket" with exactly one pocket resolves', () => {
    const r = validate(withPocket(), { operations: [
      { op: OPERATION.REMOVE_FEATURE, target: "the pocket" },
    ] });
    assert.equal(r.outcome, OUTCOME.READY);
    assert.equal(r.operations[0].featureId, "pocket-1");
  });

  test("a described target that means nothing here asks rather than picking", () => {
    const r = validate(withHole(), { operations: [
      { op: OPERATION.REMOVE_FEATURE, target: "the flange" },
    ] });
    assert.equal(r.outcome, OUTCOME.QUESTION);
    assert.match(r.questions[0], /could not tell which feature "the flange" means/);
  });

  test("no target at all asks, and says what the part has", () => {
    const r = validate(withHole(), { operations: [{ op: OPERATION.REMOVE_FEATURE }] });
    assert.equal(r.outcome, OUTCOME.QUESTION);
    assert.match(r.questions[0], /needs to say which feature/);
    assert.match(r.questions[0], /hole-1/);
  });

  test("an id that is not on the part is refused, not asked about", () => {
    // Different from ambiguity: this is wrong rather than unclear.
    const r = validate(withHole(), { operations: [
      { op: OPERATION.REMOVE_FEATURE, featureId: "hole-9" },
    ] });
    assert.equal(r.outcome, OUTCOME.REFUSED);
    assert.match(r.why, /no hole-9 on this part/);
  });

  test("asking for a pocket on a part with none says so", () => {
    const r = validate(withHole(), { operations: [
      { op: OPERATION.REMOVE_FEATURE, target: "this pocket" },
    ] });
    assert.equal(r.outcome, OUTCOME.REFUSED);
    assert.match(r.why, /no pocket/);
  });

  test("a missing measurement is a question, not a default", () => {
    /* "tighten the tolerance" and "make this bigger" have no number in them.
       Supplying one would be the tool deciding an engineering value. */
    const r = validate(withHole(), { operations: [
      { op: OPERATION.RESIZE_HOLE, featureId: "hole-1" },
    ] });
    assert.equal(r.outcome, OUTCOME.QUESTION);
    assert.match(r.questions[0], /needs a diameter, in millimetres/);
  });
});

/* -------------------------------------------------------------- staleness */

describe("a proposal about a part that has moved on", () => {
  test("is refused, and says why", () => {
    const m = withHole();
    const r = validate(m, { modelRevision: m.revision - 1, operations: [
      { op: OPERATION.REMOVE_FEATURE, featureId: "hole-1" },
    ] });
    assert.equal(r.outcome, OUTCOME.STALE);
    assert.match(r.why, /worked out when the part was at revision/);
  });

  test("checked before anything else, because every target was resolved against the old part", () => {
    const m = withHole();
    const r = validate(m, { modelRevision: 1, operations: [{ op: "nonsense" }] });
    assert.equal(r.outcome, OUTCOME.STALE, "staleness outranks the bad operation");
  });

  test("a proposal that names no revision is taken at face value", () => {
    // Manual controls do not carry one, and requiring it would make the
    // manual path depend on machinery it has no use for.
    const r = validate(withHole(), { operations: [
      { op: OPERATION.REMOVE_FEATURE, featureId: "hole-1" },
    ] });
    assert.equal(r.outcome, OUTCOME.READY);
  });

  test("accepting after the part changed is refused", () => {
    /* The second half of the same rule. Validation was against the part as it
       was; acceptance has to be against the part it was previewed on. */
    const m = withHole();
    const p = preview(m, validate(m, { operations: [{ op: OPERATION.REMOVE_FEATURE, featureId: "hole-1" }] }));
    const moved = ok(addHole(m, { xUm: mm(80), yUm: mm(25), diameterUm: mm(4) }));
    const r = accept(p, moved);
    assert.equal(r.stale, true);
    assert.match(r.error, /part changed after this was previewed/);
    assert.equal(r.model, moved, "the newer part stands");
  });
});

/* ---------------------------------------------------------------- preview */

describe("previewing runs the real operations", () => {
  test("it produces the model that would result, and commits nothing", () => {
    const m = plate();
    const p = preview(m, validate(m, { operations: [
      { op: OPERATION.ADD_HOLE, xMm: "15", yMm: "25", diameterMm: "6" },
    ] }));
    assert.equal(p.ok, true);
    assert.deepEqual(featureIds(p.model), ["hole-1"]);
    assert.deepEqual(featureIds(m), [], "the model on screen is untouched");
  });

  test("an accepted proposal gives the same geometry as doing it by hand", () => {
    /* The acceptance check, directly: the same deterministic operation layer,
       equivalent geometry. */
    const byHand = ok(addHole(plate(), { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }));
    const m = plate();
    const p = preview(m, validate(m, { operations: [
      { op: OPERATION.ADD_HOLE, xMm: "15", yMm: "25", diameterMm: "6" },
    ] }));
    const byProposal = accept(p, m).model;
    assert.deepEqual(featureIds(byProposal), featureIds(byHand));
    assert.equal(byProposal.features[0].xUm, byHand.features[0].xUm);
    assert.equal(byProposal.features[0].diameterUm, byHand.features[0].diameterUm);
    assert.equal(volume(byProposal).lowerUm3, volume(byHand).lowerUm3);
  });

  test("an impossible step stops the whole proposal", () => {
    /* A half-applied proposal is a part nobody asked for, and worse than
       none of it. */
    const m = plate();
    const p = preview(m, validate(m, { operations: [
      { op: OPERATION.ADD_HOLE, xMm: "15", yMm: "25", diameterMm: "6" },
      { op: OPERATION.ADD_HOLE, xMm: "900", yMm: "25", diameterMm: "6" },
    ] }));
    assert.equal(p.ok, false);
    assert.match(p.why, /falls outside the block/);
    assert.equal(p.model, m, "nothing was applied");
  });

  test("several steps apply in order", () => {
    const m = plate();
    const p = preview(m, validate(m, { operations: [
      { op: OPERATION.ADD_HOLE, xMm: "15", yMm: "25", diameterMm: "6" },
      { op: OPERATION.ADD_HOLE, xMm: "50", yMm: "25", diameterMm: "6" },
      { op: OPERATION.ADD_HOLE, xMm: "85", yMm: "25", diameterMm: "6" },
    ] }));
    assert.equal(p.ok, true);
    assert.deepEqual(featureIds(p.model), ["hole-1", "hole-2", "hole-3"]);
  });

  test("it says which features the change would strand", () => {
    // Before it happens, so a person can see what it costs in requirements.
    const m = withHole();
    const p = preview(m, validate(m, { operations: [
      { op: OPERATION.REMOVE_FEATURE, featureId: "hole-1" },
    ] }));
    assert.deepEqual([...p.losesFeatures], ["hole-1"]);
    assert.deepEqual([...p.gainsFeatures], []);
  });

  test("and which it would add", () => {
    const m = plate();
    const p = preview(m, validate(m, { operations: [
      { op: OPERATION.ADD_HOLE, xMm: "15", yMm: "25", diameterMm: "6" },
    ] }));
    assert.deepEqual([...p.gainsFeatures], ["hole-1"]);
  });

  test("moving a feature moves it from where it is, not to a coordinate", () => {
    // "move the selected hole 10 mm along X" is relative, and resolving it
    // needs the hole's current position.
    const m = withHole();
    const p = preview(m, validate(m, { operations: [
      { op: OPERATION.MOVE_FEATURE, featureId: "hole-1", dxMm: "10", dyMm: "0" },
    ] }));
    assert.equal(p.model.features[0].xUm, mm(25));
    assert.equal(p.model.features[0].yUm, mm(25), "Y is unchanged");
  });

  test("a negative move is allowed, because directions have signs", () => {
    const m = withHole();
    const p = preview(m, validate(m, { operations: [
      { op: OPERATION.MOVE_FEATURE, featureId: "hole-1", dxMm: "-5", dyMm: "0" },
    ] }));
    assert.equal(p.model.features[0].xUm, mm(10));
  });

  test("but a negative diameter is not", () => {
    const r = validate(withHole(), { operations: [
      { op: OPERATION.RESIZE_HOLE, featureId: "hole-1", diameterMm: "-6" },
    ] });
    assert.equal(r.outcome, OUTCOME.QUESTION);
  });

  test("a preview of a refused proposal is refused too", () => {
    const m = plate();
    const p = preview(m, validate(m, { operations: [{ op: "sculpt" }] }));
    assert.equal(p.ok, false);
    assert.equal(p.model, m);
  });
});

/* -------------------------------------------------- what it may not decide */

describe("what a model is not allowed to fill in", () => {
  test("a tolerance value it supplied is held back and reported", () => {
    /* "AI must not manufacture a tolerance/finish value." Held back loudly
       rather than quietly dropped: that a model reached for it is worth
       seeing. */
    const held = withheld({ requirements: [{ kind: "dimensional-tolerance", tolerance: { plusMinus: "0.05" } }] });
    assert.equal(held.length, 1);
    assert.match(held[0], /a value nobody supplied/);
    assert.match(held[0], /not for a model to choose/);
  });

  test("a specification revision it chose is held back", () => {
    const held = withheld({ requirements: [
      { kind: "finish-coating", spec: { name: "SYN-SPEC-100", revision: "C" } },
    ] });
    assert.equal(held.length, 1);
    assert.match(held[0], /Which revision applies is a fact about your organisation/);
  });

  test("but a revision the person supplied is fine", () => {
    const held = withheld({ requirements: [
      { kind: "finish-coating", spec: { name: "SYN-SPEC-100", revision: "C", suppliedByUser: true } },
    ] });
    assert.deepEqual([...held], []);
  });

  test("a requirement arriving already confirmed is held back", () => {
    const held = withheld({ requirements: [{ kind: "inspection-certification", confirmed: true }] });
    assert.match(held[0], /Confirming is a person's act/);
  });

  test("a proposal with no requirements holds nothing back", () => {
    assert.deepEqual([...withheld({})], []);
    assert.deepEqual([...withheld({ operations: [] })], []);
  });

  test("'make this aerospace grade' cannot become a material choice", () => {
    /* The pack's own example. There is no operation for choosing a material,
       so the request has nowhere to land and is refused by the closed list
       rather than by a special case. */
    const r = validate(plate(), { operations: [
      { op: "set-material", grade: "7075-T6" },
    ] });
    assert.equal(r.outcome, OUTCOME.REFUSED);
    assert.match(r.why, /not something this can do/);
  });
});

/* ------------------------------------------------------------ description */

describe("what a person is shown before accepting", () => {
  test("each step reads as something checkable against the drawing", () => {
    const m = plate();
    const v = validate(m, { operations: [
      { op: OPERATION.ADD_HOLE, xMm: "15", yMm: "25", diameterMm: "6" },
      { op: OPERATION.ADD_POCKET, xMm: "40", yMm: "10", widthMm: "20", lengthMm: "20", depthMm: "3" },
    ] });
    assert.equal(describeStep(v.operations[0]), "Add a 6mm hole at 15, 25");
    assert.equal(describeStep(v.operations[1]), "Add a 20 × 20mm pocket 3mm deep at 40, 10");
  });

  test("a move says which way and how far", () => {
    const v = validate(withHole(), { operations: [
      { op: OPERATION.MOVE_FEATURE, featureId: "hole-1", dxMm: "10", dyMm: "-2.5" },
    ] });
    assert.equal(describeStep(v.operations[0]),
      "Move hole-1 by 10mm along X and -2.5mm along Y");
  });

  test("the preview lists what it did, in order", () => {
    const m = plate();
    const p = preview(m, validate(m, { operations: [
      { op: OPERATION.ADD_HOLE, xMm: "15", yMm: "25", diameterMm: "6" },
      { op: OPERATION.ADD_HOLE, xMm: "50", yMm: "25", diameterMm: "6" },
    ] }));
    assert.deepEqual([...p.applied], [
      "Add a 6mm hole at 15, 25",
      "Add a 6mm hole at 50, 25",
    ]);
  });

  test("what was asked for is carried through, so it can be shown beside the result", () => {
    const m = plate();
    const v = validate(m, { said: "add a 6mm hole 15mm from the left", operations: [
      { op: OPERATION.ADD_HOLE, xMm: "15", yMm: "25", diameterMm: "6" },
    ] });
    assert.equal(v.said, "add a 6mm hole 15mm from the left");
  });
});

/* ---------------------------------------------------------------- accept */

describe("accepting", () => {
  test("commits exactly what was previewed", () => {
    /* Not a re-run: what you saw is the only safe definition of what you
       agreed to. */
    const m = plate();
    const p = preview(m, validate(m, { operations: [
      { op: OPERATION.ADD_HOLE, xMm: "15", yMm: "25", diameterMm: "6" },
    ] }));
    assert.equal(accept(p, m).model, p.model, "the previewed model itself");
  });

  test("nothing to accept says so", () => {
    assert.match(accept(null, plate()).error, /nothing to accept/);
    assert.match(accept({ ok: false }, plate()).error, /nothing to accept/);
  });
});

