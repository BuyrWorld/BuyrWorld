/**
 * The DXF top view.
 *
 * `acceptance/PART-REVIEW-CHECKS.md`: *"Exported solid/2D files are checked
 * with a suitable parser/reader for actual dimensions, units, placement and
 * geometry validity."* So these tests do not check that the file looks like a
 * DXF — they read it back and compare every coordinate against the model it
 * came from.
 *
 * And the boundary the pack cares about most: this is geometry, not a drawing.
 * No dimensions, no tolerances, no annotations. The schedule stays the
 * authoritative record, and a test holds the export to saying so.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  toDxf, readDxf, checkDxf, umToMm, DXF_LAYERS,
} from "../../src/studio/dxf-export.mjs";
import { block, addHole, addPocket } from "../../src/studio/geometry.mjs";

const mm = (x) => BigInt(Math.round(x * 1000));
const ok = (r) => { assert.equal(r.error, undefined, r.error); return r.model; };
const plate = () => block({ widthUm: mm(100), lengthUm: mm(50), thicknessUm: mm(10) });

const withHole = () => ok(addHole(plate(), { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }));
const withBoth = () => ok(addPocket(withHole(),
  { xUm: mm(40), yUm: mm(10), widthUm: mm(20), lengthUm: mm(20), depthUm: mm(3) }));

/* ------------------------------------------------------------- exactness */

describe("micrometres reach the file exactly", () => {
  test("a whole millimetre keeps its decimals", () => {
    assert.equal(umToMm(100_000n), "100.000");
  });

  test("a fraction is not rounded away", () => {
    assert.equal(umToMm(6_350n), "6.350", "a quarter inch in millimetres");
    assert.equal(umToMm(1n), "0.001", "one micrometre");
  });

  test("nothing goes through float division", () => {
    /* Number(um)/1000 is float arithmetic on a dimension, and this repository
       does not do that even for a file somebody else will read.

       Comments stripped first: the module explains the rule by quoting the
       construct it forbids, and the first version of this test matched that
       explanation and failed on its own documentation. */
    const code = readFileSync("src/studio/dxf-export.mjs", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");
    assert.equal(/Number\([^)]*\)\s*\/\s*1000/.test(code), false);
    assert.equal(/parseFloat|toFixed/.test(code), false);
    /* Number() on the units *code* is fine — it is an integer flag, not a
       dimension — so the check is about division, not about Number itself. */
    assert.match(code, /units = Number\(next\[1\]\)/);
  });

  test("a negative coordinate keeps its sign", () => {
    assert.equal(umToMm(-2_500n), "-2.500");
  });
});

/* ------------------------------------------------- reading it back */

describe("the file describes the part it came from", () => {
  test("the units are declared, not left to be guessed", () => {
    /* A DXF with no $INSUNITS is a set of numbers whose scale the reader has
       to assume, and assuming wrong on a part is the expensive kind of wrong. */
    const read = readDxf(toDxf(plate()));
    assert.equal(read.millimetres, true);
    assert.equal(read.units, 4, "DXF's code for millimetres");
  });

  test("the outline is four lines at the model's own corners", () => {
    const read = readDxf(toDxf(plate()));
    assert.equal(read.lines.length, 4);
    const corners = read.lines.map((l) => `${l.x},${l.y}`).sort();
    assert.deepEqual(corners,
      ["0.000,0.000", "0.000,50.000", "100.000,0.000", "100.000,50.000"].sort());
  });

  test("it starts at the origin the model states", () => {
    /* The bottom-left corner of the top face. A DXF whose origin differs from
       the model's is a drawing of the right shape in the wrong place. */
    const read = readDxf(toDxf(plate()));
    assert.ok(read.lines.some((l) => l.x === "0.000" && l.y === "0.000"));
  });

  test("a hole is a circle at its centre, with its radius", () => {
    const read = readDxf(toDxf(withHole()));
    assert.equal(read.circles.length, 1);
    const [c] = read.circles;
    assert.equal(c.x, "15.000");
    assert.equal(c.y, "25.000");
    assert.equal(c.r, "3.000", "radius, not diameter");
  });

  test("a pocket is drawn as its opening", () => {
    const read = readDxf(toDxf(withBoth()));
    assert.equal(read.lines.length, 8, "four for the outline, four for the pocket");
    assert.ok(read.lines.some((l) => l.x === "40.000" && l.y === "10.000"));
  });

  test("each kind is on its own layer, so a reader can separate them", () => {
    const read = readDxf(toDxf(withBoth()));
    const layers = new Set(read.entities.map((e) => e.layer));
    assert.deepEqual([...layers].sort(),
      [DXF_LAYERS.HOLES, DXF_LAYERS.OUTLINE, DXF_LAYERS.POCKETS].sort());
  });

  test("a fractional part survives the round trip", () => {
    const m = ok(addHole(block({ widthUm: mm(63.5), lengthUm: mm(25.4), thicknessUm: mm(6) }),
      { xUm: mm(12.7), yUm: mm(12.7), diameterUm: mm(6.35) }));
    const read = readDxf(toDxf(m));
    assert.equal(read.circles[0].x, "12.700");
    assert.equal(read.circles[0].r, "3.175");
    assert.ok(read.lines.some((l) => l.x === "63.500" && l.y === "25.400"));
  });
});

/* ------------------------------------------------- it checks itself */

describe("the export verifies its own output", () => {
  test("a file made from a model agrees with it", () => {
    const m = withBoth();
    const check = checkDxf(toDxf(m), m);
    assert.equal(check.ok, true, check.problems.join("; "));
  });

  test("a file that lost a hole is caught", () => {
    /* The check exists because "it opened in my CAD package" is not the same
       as "it describes my part". */
    const m = withHole();
    const mangled = toDxf(m).replace(/0\nCIRCLE[\s\S]*?40\n[\d.]+\n/, "");
    const check = checkDxf(mangled, m);
    assert.equal(check.ok, false);
    assert.ok(check.problems.some((p) => /hole\(s\) on the part and 0 circle/.test(p)));
  });

  test("a hole moved in the file is caught", () => {
    const m = withHole();
    const moved = toDxf(m).replace("15.000", "95.000");
    const check = checkDxf(moved, m);
    assert.equal(check.ok, false);
    assert.ok(check.problems.some((p) => /hole-1 is not in the file/.test(p)));
  });

  test("a file with the units stripped is caught", () => {
    const m = plate();
    const noUnits = toDxf(m).replace("9\n$INSUNITS\n70\n4\n", "");
    assert.equal(checkDxf(noUnits, m).ok, false);
  });

  test("a missing pocket is caught by the line count", () => {
    const m = withBoth();
    const short = toDxf(m).split("\n").slice(0, -20).join("\n");
    assert.equal(checkDxf(short, m).ok, false);
  });
});

/* ------------------------------------------------------------ refusals */

describe("what it will not export", () => {
  test("no model, no file", () => {
    assert.throws(() => toDxf(null), /needs a model with a width and a length/);
    assert.throws(() => toDxf({}), /needs a model with a width and a length/);
  });

  test("a part with no size is refused rather than drawn as a point", () => {
    assert.throws(() => toDxf({ ...plate(), widthUm: 0n }), /positive dimensions/);
  });

  test("it does not pretend to be a drawing", () => {
    /* The distinction the pack insists on: geometry is not a dimensioned
       drawing, and a file that carried neither dimensions nor a note saying so
       would be read as one. */
    const dxf = toDxf(withBoth());
    assert.equal(/DIMENSION|MTEXT|\bTEXT\b|LEADER/.test(dxf), false,
      "there are no annotations, and there must be no entities implying any");
  });

  test("the module says outright what it is not", () => {
    /* Comment markers stripped, then whitespace collapsed. Prose wraps, so a
       pattern with a literal space in it meets a newline — and collapsing
       alone is not enough, because the `*` that starts each comment line
       survives into the middle of the sentence. */
    const src = readFileSync("src/studio/dxf-export.mjs", "utf8")
      .replace(/^\s*\*/gm, " ")
      .replace(/\s+/g, " ");
    assert.match(src, /It is not a dimensioned drawing/i);
    assert.match(src, /schedule remains the authoritative record/i);
  });

  test("and why there is no STEP", () => {
    /* A block with through-holes is expressible as an extruded profile. A
       blind pocket is not — it needs a boolean, and that needs a kernel.
       Emitting STEP for the expressible part would describe a different part. */
    const src = readFileSync("src/studio/dxf-export.mjs", "utf8");
    assert.match(src, /blind pocket cannot/);
    assert.match(src, /needs a kernel/);
  });
});
