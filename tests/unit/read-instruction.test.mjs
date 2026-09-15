/**
 * Reading a typed instruction, by written rule.
 *
 * No model, for the reason `extract-document.mjs` gives about drawings: with
 * no prompt, text that instructs the reader is just text containing that
 * instruction. More sharply here, because this sentence is about to become a
 * change to a part.
 *
 * The tests that matter are the refusals. A reader that half-understands a
 * sentence and assembles an operation from the parts it did understand is how
 * an instruction becomes a change nobody asked for.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { readInstruction, PHRASINGS } from "../../src/studio/read-instruction.mjs";
import { OPERATION, OUTCOME, validate, preview } from "../../src/studio/edit-proposal.mjs";
import { block, addHole, addPocket, featureIds } from "../../src/studio/geometry.mjs";

const mm = (x) => BigInt(Math.round(x * 1000));
const plate = () => block({ widthUm: mm(100), lengthUm: mm(50), thicknessUm: mm(10) });
const ok = (r) => { assert.equal(r.error, undefined, r.error); return r.model; };
const withHole = () => ok(addHole(plate(), { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }));

/* ------------------------------------------------------- what it can read */

describe("instructions it understands", () => {
  test("adding a hole", () => {
    const r = readInstruction("add a 6mm hole at 15, 25");
    assert.equal(r.ok, true);
    assert.deepEqual(r.proposal.operations, [
      { op: OPERATION.ADD_HOLE, diameterMm: "6", xMm: "15", yMm: "25" },
    ]);
  });

  test("with the spacing and wording people actually use", () => {
    for (const said of [
      "Add a 6 mm hole at 15, 25",
      "put a 6mm hole at 15,25",
      "add 6mm hole at 15 , 25",
      "add a 6mm hole at 15, 25.",
    ]) {
      assert.equal(readInstruction(said).ok, true, said);
    }
  });

  test("adding a pocket", () => {
    const r = readInstruction("add a 20 x 20mm pocket 3mm deep at 40, 10");
    assert.equal(r.ok, true);
    assert.deepEqual(r.proposal.operations, [{
      op: OPERATION.ADD_POCKET, widthMm: "20", lengthMm: "20",
      depthMm: "3", xMm: "40", yMm: "10",
    }]);
  });

  test("moving a feature along one axis", () => {
    const r = readInstruction("move hole-1 10mm along X");
    assert.deepEqual(r.proposal.operations, [{
      op: OPERATION.MOVE_FEATURE, featureId: "hole-1", dxMm: "10", dyMm: "0",
    }]);
  });

  test("and the other, without touching the first", () => {
    const r = readInstruction("move the pocket 2.5 mm along y");
    assert.deepEqual(r.proposal.operations, [{
      op: OPERATION.MOVE_FEATURE, target: "pocket", dxMm: "0", dyMm: "2.5",
    }]);
  });

  test("a negative move keeps its sign", () => {
    const r = readInstruction("move hole-1 -5mm along X");
    assert.equal(r.proposal.operations[0].dxMm, "-5");
  });

  test("resizing a hole", () => {
    assert.deepEqual(readInstruction("change hole-1 to 8mm").proposal.operations, [
      { op: OPERATION.RESIZE_HOLE, featureId: "hole-1", diameterMm: "8" },
    ]);
    assert.equal(readInstruction("make hole-1 8 mm").ok, true);
  });

  test("removing one", () => {
    assert.deepEqual(readInstruction("remove pocket-1").proposal.operations, [
      { op: OPERATION.REMOVE_FEATURE, featureId: "pocket-1" },
    ]);
    assert.equal(readInstruction("delete the pocket").proposal.operations[0].target, "pocket");
  });

  test("an id is an id, and a bare word is a description", () => {
    /* "hole-1" names one thing; "hole" might name several, and that is the
       difference between an operation and a question. */
    assert.equal(readInstruction("remove hole-1").proposal.operations[0].featureId, "hole-1");
    assert.equal(readInstruction("remove hole-1").proposal.operations[0].target, undefined);
    assert.equal(readInstruction("remove the hole").proposal.operations[0].target, "hole");
    assert.equal(readInstruction("remove the hole").proposal.operations[0].featureId, undefined);
  });

  test("the revision it was typed against is carried", () => {
    // So a proposal typed before somebody else edited is caught as stale.
    assert.equal(readInstruction("remove hole-1", 7).proposal.modelRevision, 7);
  });

  test("what was said is kept, to show beside the result", () => {
    assert.equal(readInstruction("  add   a 6mm hole at 15, 25  ").said, "add a 6mm hole at 15, 25");
  });
});

/* ------------------------------------------------------ what it will not do */

describe("what it refuses rather than guesses", () => {
  test("a sentence it cannot read is not half-read", () => {
    const r = readInstruction("make the thing a bit bigger somewhere near the middle");
    assert.equal(r.ok, false);
    assert.equal(r.proposal, undefined, "no operation was assembled from the words it knew");
  });

  test("and it shows what it can take instead", () => {
    const r = readInstruction("do the usual");
    assert.match(r.question, /could not read that as a change/);
    assert.ok(r.examples.length >= 4);
    assert.ok(r.examples.some((e) => /add a 6mm hole/.test(e)));
  });

  test("a hole with no position is not placed somewhere reasonable", () => {
    const r = readInstruction("add a 6mm hole");
    assert.equal(r.ok, false);
  });

  test("a hole with no diameter is not given one", () => {
    const r = readInstruction("add a hole at 15, 25");
    assert.equal(r.ok, false);
  });

  test("an empty instruction asks rather than erroring", () => {
    assert.match(readInstruction("").question, /Type what you would like changed/);
    assert.match(readInstruction("   ").question, /Type what you would like changed/);
    assert.match(readInstruction(null).question, /Type what you would like changed/);
  });
});

/* -------------------------------------- the cases the pack calls out by name */

describe("the requests the pack says must not be answered", () => {
  test('"make this aerospace grade" asks for the specification', () => {
    const r = readInstruction("make this aerospace grade");
    assert.equal(r.ok, false);
    assert.equal(r.recognised, true, "it knows what was meant, and still will not do it");
    assert.match(r.question, /question for your organisation/);
    assert.match(r.question, /I will not choose one/);
  });

  test('"tighten the tolerance" asks by how much, and on what', () => {
    const r = readInstruction("tighten the tolerance");
    assert.equal(r.ok, false);
    assert.match(r.question, /By how much, and on which dimension/);
  });

  test('"make it lighter" is named as a design decision, not a measurement', () => {
    const r = readInstruction("make it lighter");
    assert.equal(r.ok, false);
    assert.match(r.question, /design decision rather than a measurement/);
  });

  test("a fillet is refused by naming what this builds", () => {
    // Honest about the bounded scope rather than silently not understanding.
    const r = readInstruction("add a 2mm fillet to the corners");
    assert.equal(r.ok, false);
    assert.match(r.question, /rectangular blocks with round holes/);
    assert.match(r.question, /needs a proper modelling tool/);
  });
});

/* ------------------------------------------------- it feeds the same validator */

describe("what it reads goes through the same checks as anything else", () => {
  test("a readable instruction validates and previews", () => {
    const m = plate();
    const read = readInstruction("add a 6mm hole at 15, 25", m.revision);
    const v = validate(m, read.proposal);
    assert.equal(v.outcome, OUTCOME.READY);
    const p = preview(m, v);
    assert.equal(p.ok, true);
    assert.deepEqual(featureIds(p.model), ["hole-1"]);
  });

  test("an ambiguous description still becomes a question downstream", () => {
    /* The reader does not resolve targets — that needs the part, which the
       validator has. Two holes and "the hole" asks which, exactly as it would
       from any other proposal source. */
    const two = ok(addHole(withHole(), { xUm: mm(50), yUm: mm(25), diameterUm: mm(6) }));
    const read = readInstruction("remove the hole");
    assert.equal(read.ok, true, "the sentence itself is fine");
    const v = validate(two, read.proposal);
    assert.equal(v.outcome, OUTCOME.QUESTION);
    assert.match(v.questions[0], /There are 2 holes/);
  });

  test("an instruction typed against an older revision is caught as stale", () => {
    const m = withHole();
    const read = readInstruction("remove hole-1", m.revision - 1);
    assert.equal(validate(m, read.proposal).outcome, OUTCOME.STALE);
  });

  test("a readable instruction for an impossible change fails at preview, not before", () => {
    // The sentence is well formed; the geometry is not. Different problems,
    // reported at the stage that can tell.
    const m = plate();
    const read = readInstruction("add a 6mm hole at 900, 25", m.revision);
    assert.equal(read.ok, true);
    const p = preview(m, validate(m, read.proposal));
    assert.equal(p.ok, false);
    assert.match(p.why, /falls outside the block/);
  });
});

/* ------------------------------------------------------------ no model here */

describe("there is no model in this file", () => {
  test("it makes no network call and evaluates nothing", () => {
    const src = readFileSync("src/studio/read-instruction.mjs", "utf8");
    assert.equal(/\bfetch\s*\(|XMLHttpRequest|\beval\b|new Function/.test(src), false);
  });

  test("it imports nothing that could reach one", () => {
    const src = readFileSync("src/studio/read-instruction.mjs", "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(imports, ["./edit-proposal.mjs"]);
  });

  test("the phrasings it knows are few and listed", () => {
    /* A reader that recognises twenty shapes of sentence recognises nineteen
       badly, and every one it gets slightly wrong moves metal. */
    assert.ok(PHRASINGS.length <= 8, `${PHRASINGS.length} phrasings is too many to be sure of`);
    assert.ok(PHRASINGS.includes("add-hole-at"));
  });
});

