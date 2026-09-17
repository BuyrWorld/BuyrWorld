/**
 * The general-tolerance fixture, read end to end.
 *
 * `specs/03` asks for one distinction the pack's own fixtures cannot test:
 * *"Distinguish explicitly marked tolerances from a general title-block
 * tolerance."* Reading `clear.jpg`, the model took the title-block tolerance
 * and attached it to the length. The evidence check caught it — the quote it
 * gave did not contain the tolerance — but that drawing has no dimension
 * carrying a tolerance of its own, so it cannot tell a working path from a
 * broken one.
 *
 * `scripts/make-drawing-fixture.mjs` draws a sheet that can: a tolerance
 * marked against one dimension, two dimensions with none, and a general
 * tolerance in the title block.
 *
 * The reply here was recorded from a real read, and that is a limit worth
 * stating rather than glossing: this proves what the pipeline does with that
 * answer, not what the model would say today. Checking the second means
 * re-recording it, which costs a network call and real credits, and is a
 * thing somebody does on purpose rather than something a suite does on every
 * run.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { readingsFrom } from "../../src/intake/vision-read.mjs";
import { queue, documentRef, usable, METHOD } from "../../src/intake/review.mjs";
import {
  readTolerance, asTolerance, saidPlainly, kindOf, verificationOf, FORM, APPLIES,
} from "../../src/intake/read-tolerance.mjs";
import { KIND, VERIFICATION } from "../../src/studio/requirements.mjs";
import { SHEET, groundTruth } from "../../scripts/make-drawing-fixture.mjs";

const recorded = JSON.parse(
  readFileSync("fixtures/drawings/general-tolerance.reply.json", "utf8"));
const truth = JSON.parse(
  readFileSync("fixtures/drawings/general-tolerance.json", "utf8")).expected;

const reading = readingsFrom(recorded.text);
const of = (field) => reading.candidates.find((c) => c.field === field);

describe("the fixture and its answer key agree", () => {
  test("the key is derived from the sheet, so it cannot drift from the drawing", () => {
    /* A fixture whose answer key disagrees with the picture is worse than no
       fixture: it fails for a reason that is not about the code. */
    assert.deepEqual(groundTruth().expected, truth);
  });

  test("the sheet really carries all three cases", () => {
    const withTolerance = SHEET.dimensions.filter((d) => d.tolerance);
    const without = SHEET.dimensions.filter((d) => !d.tolerance);
    assert.equal(withTolerance.length, 1, "no dimension carries its own tolerance");
    assert.ok(without.length >= 2, "nothing to catch a general tolerance carried down");
    assert.ok(SHEET.generalTolerance, "there is no general tolerance to distinguish");
  });

  test("it says on its face that it is synthetic", () => {
    /* It is committed to a public repository and served statically, so this
       cannot live only in a README. */
    assert.match(SHEET.partNumber, /^SYN-/);
    assert.match(SHEET.material, /SYNTHETIC/);
  });

  test("the recorded reply says which model said it, and when", () => {
    /* Otherwise it slowly becomes a claim about nothing in particular. */
    assert.ok(recorded.model, "the reply does not say what produced it");
    assert.match(recorded.recorded, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(recorded.note, /does not\s+prove what the model would say today|not\s*\n?\s*prove what the model would say today/);
  });
});

describe("the recorded read", () => {
  test("every field came back exactly, tolerances included", () => {
    for (const [field, want] of Object.entries(truth)) {
      const got = of(field);
      assert.ok(got, `${field} was not read`);
      assert.equal(got.value.toUpperCase(), want.value.toUpperCase(), field);
      assert.equal(got.tolerance?.printed ?? null, want.tolerance, `${field} tolerance`);
    }
  });

  test("nothing was dropped by the schema gate", () => {
    assert.deepEqual([...reading.dropped], []);
  });

  test("the marked tolerance is attached to the dimension it is printed against", () => {
    assert.equal(of("thickness").tolerance.printed, "+/-0.05");
    assert.equal(of("thickness").tolerance.readable, true);
  });

  test("and is not carried down to the dimensions that have none", () => {
    /* The failure this fixture exists to catch. A general tolerance applied
       to every unmarked dimension would put limits on features nobody
       checked, and it would look like helpfulness while doing it. */
    assert.equal(of("length").tolerance, null);
    assert.equal(of("width").tolerance, null);
  });

  test("the general tolerance is reported once, as its own field", () => {
    assert.equal(of("generalTolerance").value, "ISO 2768-M");
    assert.equal(reading.candidates.filter((c) => c.field === "generalTolerance").length, 1);
  });
});

describe("what the product then does with the general tolerance", () => {
  const general = readTolerance(of("generalTolerance").value);

  test("it is read as a class, not as a number", () => {
    assert.equal(general.form, FORM.CLASS);
    assert.equal(general.grade, "M");
  });

  test("no limits are produced from it", () => {
    /* The most plausible wrong figure this product could produce is a
       deviation remembered from a table it does not carry. */
    const band = asTolerance(general, { nominal: "12.00", unit: "mm" });
    assert.equal(band.ok, false);
    assert.equal(band.unverified, true);
    assert.match(band.why, /states which table applies, not what the limits are/);
  });

  test("it is a general requirement and it is unverified", () => {
    assert.equal(kindOf(general, APPLIES.GENERAL), KIND.GENERAL_TOLERANCE);
    assert.equal(verificationOf(general), VERIFICATION.UNVERIFIED);
  });

  test("and it says outright that nothing has been applied to anything", () => {
    const said = saidPlainly(general, APPLIES.GENERAL);
    assert.match(said, /has not been decided here/);
    assert.match(said, /whatever carries no tolerance of its own/);
  });

  test("the marked one does produce an exact band", () => {
    /* The contrast that makes the distinction worth drawing: one of these is
       a number this product can stand behind, and the other is a citation. */
    const marked = asTolerance(readTolerance(of("thickness").tolerance.printed),
      { nominal: "12.00", unit: "mm" });
    assert.equal(marked.ok, true);
    assert.equal(marked.tolerance.range, "11.95 … 12.05mm");
    assert.equal(kindOf(readTolerance("+/-0.05"), APPLIES.MARKED), KIND.DIMENSIONAL);
  });
});

describe("into the queue", () => {
  const items = queue({ candidates: reading.candidates },
    { method: METHOD.VISION, document: documentRef({ filename: "general-tolerance.png" }) });

  test("nothing is usable until somebody confirms it", () => {
    assert.equal(items.filter(usable).length, 0);
    assert.equal(items.length, Object.keys(truth).length);
  });

  test("the tolerance survives onto the evidence of the row it belongs to", () => {
    const thickness = items.find((i) => i.field === "thickness");
    assert.equal(thickness.evidence.tolerance.printed, "+/-0.05");
  });

  test("and does not appear on the rows it does not belong to", () => {
    for (const field of ["length", "width", "material", "generalTolerance"]) {
      assert.equal(items.find((i) => i.field === field).evidence.tolerance, null, field);
    }
  });
});
