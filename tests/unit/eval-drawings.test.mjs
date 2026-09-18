/**
 * The drawing evaluator, measured against answers it is given deliberately.
 *
 * `specs/03`: *"Synthetic pack fixtures test routing and evaluator behavior
 * only."* This is the evaluator-behaviour half. The runner scores one fixture
 * that is entirely correct, which proves it can say 100% and nothing else —
 * and a report that can only say 100% is one nobody should believe the day it
 * says something different.
 *
 * So the wrong answers live here rather than in `fixtures/drawings`, where
 * they would fail the run they exist to validate.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { scoreOne, tally, ratio, same, formatOf, CRITICAL }
  from "../../scripts/eval-drawings.mjs";
import { PROMPT_VERSION } from "../../src/intake/vision-read.mjs";

/** A reply in the shape the reader parses, carrying whatever readings we want. */
const replyWith = (candidates) => ({
  text: JSON.stringify({ candidates }),
});

const reading = (field, value, unit = "mm", quote = null) => ({
  field, value, unit,
  quote: quote ?? `${value} ${unit}`,
  confidence: "high",
});

const key = (expected, id = "synthetic.png") => ({ id, expected });

/* ------------------------------------------------------- reading a value */

describe("scoring one field", () => {
  test("a matching value is right", () => {
    const rows = scoreOne({
      key: key({ width: { value: "64.00", unit: "mm", tolerance: null } }),
      reply: replyWith([reading("width", "64.00")]),
    });
    assert.deepEqual(rows.map((r) => r.state), ["right"]);
  });

  test("and 64 is the same width as 64.00", () => {
    const rows = scoreOne({
      key: key({ width: { value: "64.00", unit: "mm", tolerance: null } }),
      reply: replyWith([reading("width", "64")]),
    });
    assert.equal(rows[0].state, "right");
  });

  test("but 6.40 is not", () => {
    const rows = scoreOne({
      key: key({ width: { value: "64.00", unit: "mm", tolerance: null } }),
      reply: replyWith([reading("width", "6.40")]),
    });
    assert.equal(rows[0].state, "wrong");
    assert.equal(rows[0].got, "6.40");
    assert.equal(rows[0].want, "64.00");
  });

  test("a field nobody read is an abstention, not a wrong answer", () => {
    const rows = scoreOne({
      key: key({ width: { value: "64.00", unit: "mm", tolerance: null } }),
      reply: replyWith([]),
    });
    assert.equal(rows[0].state, "abstained");
  });

  test("a field the key does not hold is reported, not scored", () => {
    /* The reader itself drops a field it does not know — "finish" never
       becomes a candidate — so the only way to reach this state is a field it
       does know and the answer key happens not to hold. */
    const rows = scoreOne({
      key: key({ width: { value: "64.00", unit: "mm", tolerance: null } }),
      reply: replyWith([reading("width", "64.00"), reading("length", "120.00")]),
    });
    assert.deepEqual(rows.map((r) => r.state).sort(), ["extra", "right"]);
    assert.equal(tally(rows).inKey, 1, "an unkeyed field inflated the denominator");
  });

  test("a field the reader does not know never reaches the score at all", () => {
    const rows = scoreOne({
      key: key({ width: { value: "64.00", unit: "mm", tolerance: null } }),
      reply: replyWith([reading("width", "64.00"), reading("finish", "ANODISED", null, "ANODISED")]),
    });
    assert.deepEqual(rows.map((r) => r.state), ["right"]);
  });

  test("a fixture with no recorded reply is neither right nor wrong", () => {
    const rows = scoreOne({
      key: key({ width: { value: "64.00", unit: "mm", tolerance: null } }),
      reply: null,
    });
    assert.equal(rows[0].state, "no-reply");
    assert.equal(tally(rows).proposed, 0);
  });
});

/* ------------------------------------------------------------ tolerances */

describe("a tolerance is part of the answer", () => {
  test("the right value with the wrong tolerance is wrong", () => {
    /* The failure the fixture exists for: a general title-block tolerance
       attached to a dimension that does not carry one. The value is perfect
       and the reading is still wrong. */
    const rows = scoreOne({
      key: key({ length: { value: "120.00", unit: "mm", tolerance: null } }),
      reply: replyWith([{
        ...reading("length", "120.00", "mm", "120.00 +/-0.05"),
        tolerance: "+/-0.05",
      }]),
    });
    assert.equal(rows[0].state, "wrong");
  });

  test("and the right value with the right tolerance is right", () => {
    const rows = scoreOne({
      key: key({ thickness: { value: "12.00", unit: "mm", tolerance: "+/-0.05" } }),
      reply: replyWith([{
        ...reading("thickness", "12.00", "mm", "12.00 +/-0.05"),
        tolerance: "+/-0.05",
      }]),
    });
    assert.equal(rows[0].state, "right");
  });
});

/* -------------------------------------------------------- the four measures */

describe("the measures", () => {
  /* Four fields: one right, one wrong, one abstained, one with a reading the
     key does not hold. Every denominator is different, which is the point. */
  const mixed = () => scoreOne({
    key: key({
      width: { value: "64.00", unit: "mm", tolerance: null },
      length: { value: "120.00", unit: "mm", tolerance: null },
      thickness: { value: "12.00", unit: "mm", tolerance: null },
    }),
    reply: replyWith([
      reading("width", "64.00"),
      reading("length", "12.00"),
      reading("finish", "ANODISED", null, "ANODISED"),
    ]),
  });

  test("precision is of what was proposed", () => {
    assert.equal(tally(mixed()).precision, "50.0%");
  });

  test("recall is of what the key holds", () => {
    assert.equal(tally(mixed()).recall, ratio(1, 3));
  });

  test("abstention is not counted as a wrong answer", () => {
    const t = tally(mixed());
    assert.equal(t.abstained, 1);
    assert.equal(t.wrong, 1);
    assert.equal(t.abstention, ratio(1, 3));
  });

  test("coverage counts what it could attempt, right or wrong", () => {
    assert.equal(tally(mixed()).coverage, "100.0%");
  });

  test("an empty tally divides by nothing rather than by zero", () => {
    const t = tally([]);
    assert.equal(t.precision, "—");
    assert.equal(t.recall, "—");
  });
});

/* -------------------------------------------------------- critical misreads */

describe("which wrong answers stop the run", () => {
  test("every dimension and every material field is critical", () => {
    for (const field of ["width", "length", "thickness", "diameter",
                         "material", "specification", "generalTolerance"]) {
      assert.ok(CRITICAL.has(field), `${field} is not treated as critical`);
    }
  });

  test("a part number is not, because the first reader catches it", () => {
    assert.equal(CRITICAL.has("partNumber"), false);
  });

  test("the distinction is the point: both are wrong, one is worse", () => {
    const rows = scoreOne({
      key: key({
        partNumber: { value: "SYN-BRK-2100", unit: null, tolerance: null },
        width: { value: "64.00", unit: "mm", tolerance: null },
      }),
      reply: replyWith([
        reading("partNumber", "SYN-BRK-2001", null, "SYN-BRK-2001"),
        reading("width", "6.40"),
      ]),
    });

    const wrong = rows.filter((r) => r.state === "wrong");
    assert.equal(wrong.length, 2);
    assert.equal(wrong.filter((r) => CRITICAL.has(r.field)).length, 1);
  });
});

/* --------------------------------------------------------------- the rest */

describe("the report's own details", () => {
  test("the format comes from the fixture's id", () => {
    assert.equal(formatOf({ id: "a.png" }), "png");
    assert.equal(formatOf({ id: "a.PDF" }), "pdf");
    assert.equal(formatOf({}), "unknown");
  });

  test("values are compared as values, not as strings", () => {
    assert.equal(same("120.00", "120"), true);
    assert.equal(same(" as machined ", "AS MACHINED"), true);
    assert.equal(same("120.00", "12.00"), false);
  });

  test("it scores the reader that is actually shipped", () => {
    /* If the prompt version moves, the recorded replies describe a reader that
       no longer exists — worth knowing, and this is where somebody would look. */
    assert.ok(PROMPT_VERSION, "the reader has no prompt version");
  });
});
