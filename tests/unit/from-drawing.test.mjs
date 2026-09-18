/**
 * Starting the block from what somebody confirmed off the drawing.
 *
 * `specs/02`'s Phase 5: *"Connect confirmed dimensions/material/requirements to
 * bounded 3D editing."* The word that matters is confirmed, and the test that
 * matters is that a proposed reading cannot become a model.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { blockFrom, NEEDED } from "../../src/studio/from-drawing.mjs";
import { block, volume } from "../../src/studio/geometry.mjs";
import {
  queue, confirm, correct, confirmedValues, documentRef, METHOD,
} from "../../src/intake/review.mjs";

/** An extraction, in the shape the review queue takes. */
const extraction = (candidates) => ({ candidates });
const candidate = (field, value, unit) => ({
  field, label: field, value, unit, page: 1, quote: `${value} ${unit}`,
});

const drawing = () => documentRef({ filename: "SYN-BRACKET-001.pdf", revision: "B" });

const threeDimensions = () => queue(
  extraction([
    candidate("width", "100", "mm"),
    candidate("length", "60", "mm"),
    candidate("thickness", "10", "mm"),
  ]),
  { method: METHOD.RULE, document: drawing() });

/* ---------------------------------------------------- only what was confirmed */

describe("what it will build from", () => {
  test("three confirmed dimensions make a block", () => {
    const items = threeDimensions().map((i) => confirm(i, "a buyer"));
    const r = blockFrom(confirmedValues(items));

    assert.equal(r.ok, true);
    assert.deepEqual(r.dims, { widthUm: 100_000n, lengthUm: 60_000n, thicknessUm: 10_000n });
  });

  test("and the block it makes is the one the geometry module would", () => {
    const items = threeDimensions().map((i) => confirm(i, "a buyer"));
    const made = block(blockFrom(confirmedValues(items)).dims);
    assert.equal(volume(made).grossUm3, 100_000n * 60_000n * 10_000n);
  });

  test("a queue nobody has looked at builds nothing", () => {
    /* Everything starts proposed. confirmedValues holds none of it, so this is
       the state the whole design turns on. */
    const r = blockFrom(confirmedValues(threeDimensions()));
    assert.equal(r.ok, false);
    assert.equal(r.missing.length, 3);
  });

  test("two of three is not a block, and the third is not zero", () => {
    const items = threeDimensions().map((i, at) => at < 2 ? confirm(i, "a buyer") : i);
    const r = blockFrom(confirmedValues(items));

    assert.equal(r.ok, false);
    assert.deepEqual(r.missing.map((m) => m.field), ["thickness"]);
    assert.match(r.why, /is not zero/);
  });

  test("a corrected value is as good as a confirmed one, and says which", () => {
    const items = threeDimensions().map((i) =>
      i.field === "width" ? correct(i, { value: "104", unit: "mm" }, "a buyer") : confirm(i, "a buyer"));
    const r = blockFrom(confirmedValues(items));

    assert.equal(r.dims.widthUm, 104_000n);
    assert.ok(r.from.some((f) => /corrected by a person/.test(f.said)));
  });

  test("each dimension says where it came from", () => {
    const items = threeDimensions().map((i) => confirm(i, "a buyer"));
    const r = blockFrom(confirmedValues(items));
    assert.equal(r.from.length, 3);
    for (const field of Object.keys(NEEDED)) {
      assert.ok(r.from.some((f) => f.field === field), `${field} has no provenance`);
    }
  });
});

/* -------------------------------------------------------------- refusals */

describe("what stops it", () => {
  test("a value with no unit, in the units module's own words", () => {
    const items = queue(
      extraction([
        candidate("width", "100", null),
        candidate("length", "60", "mm"),
        candidate("thickness", "10", "mm"),
      ]), { method: METHOD.RULE, document: drawing() }).map((i) => confirm(i, "a buyer"));

    const r = blockFrom(confirmedValues(items));
    assert.equal(r.ok, false);
    assert.match(r.missing[0].why, /The width:/);
  });

  test("a unit it cannot convert exactly", () => {
    const items = queue(
      extraction([
        candidate("width", "100", "furlongs"),
        candidate("length", "60", "mm"),
        candidate("thickness", "10", "mm"),
      ]), { method: METHOD.RULE, document: drawing() }).map((i) => confirm(i, "a buyer"));

    assert.equal(blockFrom(confirmedValues(items)).ok, false);
  });

  test("a round part is refused as a round part, not squared off", () => {
    const items = queue(
      extraction([
        candidate("diameter", "25", "mm"),
        candidate("thickness", "10", "mm"),
      ]), { method: METHOD.RULE, document: drawing() }).map((i) => confirm(i, "a buyer"));

    const r = blockFrom(confirmedValues(items));
    assert.equal(r.ok, false);
    assert.match(r.why, /squaring off a bar would produce a part nobody drew/);
  });

  test("nothing at all is a refusal rather than a crash", () => {
    assert.equal(blockFrom().ok, false);
    assert.equal(blockFrom([]).missing.length, 3);
  });
});
