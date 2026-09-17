/**
 * What a case says.
 *
 * Five headings like "Why it matters" and "Your options" are exactly the
 * shape of a thing that wants to be generated, and generated prose with
 * numbers in it is the failure this codebase exists to prevent. So the
 * narrative is a list of claims and the sentence is assembled from them.
 *
 * Almost everything here is about one line of `specs/05`:
 *
 *   > "Show a numerical impact only after relevant inputs are confirmed."
 *
 * The interesting cases are all the ways a figure could leak out anyway — as
 * an approximation, as a hedge, as a number in grey with an asterisk, or as a
 * claim that simply forgot to say what it depended on.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  claim, evidenceOf, narrative, resolve, sectionOf, anyFigureWithheld,
  SECTION, SECTION_TITLE, WEIGHT,
} from "../../src/case/narrative.mjs";

const money = (said, needs, weight = WEIGHT.NORMAL) => claim({
  section: SECTION.MATTERS, said, weight, needs,
  figure: { amount: "1250.00", currency: "GBP" },
});

/* ------------------------------------------------------------- the shape */

describe("a claim", () => {
  test("it belongs to one of the five sections", () => {
    assert.throws(() => claim({ section: "summary", said: "x" }), /not one of the five sections/);
    for (const s of Object.values(SECTION)) {
      assert.equal(claim({ section: s, said: "x" }).section, s);
    }
  });

  test("it has to say something", () => {
    assert.throws(() => claim({ section: SECTION.HAPPENED, said: "" }), /say something/);
    assert.throws(() => claim({ section: SECTION.HAPPENED, said: "   " }), /say something/);
  });

  test("a figure has to name what it depends on", () => {
    /* The hole this closes: a figure that depends on nothing is a figure
       nobody has to confirm, and it would show on an empty case. */
    assert.throws(
      () => claim({ section: SECTION.MATTERS, said: "It costs this much",
                    figure: { amount: "1250.00", currency: "GBP" } }),
      /name the inputs it depends on/);
  });

  test("a claim with no figure needs nothing", () => {
    const c = claim({ section: SECTION.HAPPENED, said: "The supplier moved the date." });
    assert.equal(c.figure, null);
    assert.deepEqual([...c.needs], []);
  });

  test("it is frozen, so nothing downstream edits what the case says", () => {
    const c = claim({ section: SECTION.HAPPENED, said: "Something happened." });
    assert.throws(() => { "use strict"; c.said = "Something else."; }, TypeError);
  });
});

/* ------------------------------------------------- the rule the phase turns on */

describe("a figure waits for its inputs", () => {
  const confirmed = (...names) => new Set(names);

  test("with everything confirmed, the figure is there", () => {
    const c = resolve(money("The increase is worth", ["quantity", "rate"]),
      confirmed("quantity", "rate"));
    assert.equal(c.figure.amount, "1250.00");
    assert.equal(c.withheld, false);
    assert.deepEqual([...c.waiting], []);
  });

  test("with one missing, the figure is gone — not rounded, not hedged", () => {
    const c = resolve(money("This could affect Friday's build.", ["quantity"]),
      confirmed("rate"));
    assert.equal(c.figure, null, "a figure survived an unconfirmed input");
    assert.equal(c.withheld, true);
  });

  test("and the reason stands in its place", () => {
    /* The spec's own shape: the consequence, then the gap. Saying what is
       missing without why it matters is a form to fill in; saying why without
       what is missing is a worry. */
    const c = resolve(money("This could affect Friday's build.", ["quantity"]),
      confirmed(), (n) => ({ quantity: "the quantity required" }[n] ?? n));
    assert.match(c.said, /This could affect Friday's build\./);
    assert.match(c.said, /We still need the quantity required before that figure can be worked out\./);
  });

  test("several missing inputs read as a sentence", () => {
    const c = resolve(money("It moves the landed cost.", ["quantity", "rate", "freight"]),
      confirmed());
    assert.match(c.said, /We still need quantity, rate and freight before those figures/);
  });

  test("a claim with no figure is never rewritten", () => {
    /* Only a figure is withheld. A statement of fact that happens to sit
       beside an unconfirmed field is still a fact. */
    const c = resolve(
      claim({ section: SECTION.HAPPENED, said: "The supplier moved the date to the 30th." }),
      confirmed());
    assert.equal(c.said, "The supplier moved the date to the 30th.");
    assert.equal(c.withheld, false);
  });

  test("a field nobody has looked at is not confirmed", () => {
    /* Absence of a decision is not a decision, and an empty confirmed set is
       the state every case starts in. */
    assert.equal(resolve(money("x", ["quantity"]), new Set()).figure, null);
  });

  test("a sentence that already contains its own figure is refused", () => {
    /* The leak that withholding cannot close: removing the figure field does
       nothing about "about £1,250" in the sentence, and the sentence is what
       a reader sees. Caught where the author is standing instead. */
    assert.throws(
      () => claim({ section: SECTION.MATTERS, said: "The increase is about 1250 pounds.",
                    needs: ["rate"], figure: { amount: "1250.00", currency: "GBP" } }),
      /already contains its own figure/);

    assert.throws(
      () => claim({ section: SECTION.MATTERS, said: "It adds £1,250.00 to the order.",
                    needs: ["rate"], figure: { amount: "1250.00", currency: "GBP" } }),
      /Keep the number out of the words/);
  });

  test("but a sentence may carry numbers that are not its figure", () => {
    /* Deliberately literal: it looks for this claim's own amount as written,
       not for digits. A claim that cannot say "the 30th" or "a 10mm plate"
       would be unusable, and a guard that fires on innocent sentences gets
       removed — and then it guards nothing.

       The first version stripped every non-digit and then trailing zeros,
       which turns 100.00 into "1" and refuses "10 items". These are the cases
       that caught it. */
    const fine = [
      ["The 30th is after the build.", "1250.00"],
      ["A 10mm plate, ten off.", "100.00"],
      ["10 items are affected.", "100.00"],
      ["Rev B of the drawing.", "2.00"],
      ["The 2768 class applies.", "27.68"],
    ];
    for (const [said, amount] of fine) {
      const c = claim({ section: SECTION.MATTERS, said, needs: ["rate"],
                        figure: { amount, currency: "GBP" } });
      assert.equal(c.figure.amount, amount, said);
    }
  });

  test("and the separators somebody actually types are seen through", () => {
    for (const said of ["It adds 1,250.00 to the order.", "It adds 1 250.00 to the order.",
                        "It adds 1,250 to the order."]) {
      assert.throws(
        () => claim({ section: SECTION.MATTERS, said, needs: ["rate"],
                      figure: { amount: "1250.00", currency: "GBP" } }),
        /already contains its own figure/, said);
    }
  });
});

/* ------------------------------------------------------------ the five sections */

describe("the narrative", () => {
  const claims = () => [
    claim({ section: SECTION.HAPPENED, said: "The supplier moved the date to the 30th." }),
    claim({ section: SECTION.MATTERS, said: "That is after the build.",
            weight: WEIGHT.MATERIAL }),
    money("It changes the landed cost.", ["quantity"]),
    claim({ section: SECTION.NEXT, said: "Ask for the revised schedule in writing." }),
    claim({ section: SECTION.EVIDENCE, said: "Read from the supplier's email of 14 September.",
            evidence: [evidenceOf({ kind: "document", said: "supplier email", page: 1 })] }),
  ];

  test("all five sections are present, in the spec's order", () => {
    const n = narrative(claims());
    assert.deepEqual(n.sections.map((s) => s.section), [
      SECTION.HAPPENED, SECTION.MATTERS, SECTION.OPTIONS, SECTION.NEXT, SECTION.EVIDENCE,
    ]);
    assert.deepEqual(n.sections.map((s) => s.title), [
      "What happened", "Why it matters", "Your options",
      "Recommended next step", "Evidence and missing information",
    ]);
  });

  test("a section with nothing to say is present and empty", () => {
    /* Dropping the heading would make a case that has options and one that
       has not look alike. */
    const n = narrative(claims());
    assert.deepEqual([...sectionOf(n, SECTION.OPTIONS)], []);
    assert.equal(n.sections.length, 5);
  });

  test("claims land in their own section and nowhere else", () => {
    const n = narrative(claims());
    assert.equal(sectionOf(n, SECTION.HAPPENED).length, 1);
    assert.equal(sectionOf(n, SECTION.MATTERS).length, 2);
    assert.equal(sectionOf(n, SECTION.NEXT).length, 1);
  });

  test("what the case is waiting on is collected once", () => {
    /* So "Evidence and missing information" is built from what the other four
       sections could not say, rather than from a second opinion about it. */
    const n = narrative([
      money("One.", ["quantity"]), money("Two.", ["quantity", "rate"]),
    ]);
    assert.deepEqual([...n.waiting].sort(), ["quantity", "rate"]);
  });

  test("the withheld figures are named as a set", () => {
    const n = narrative([money("One.", ["quantity"]),
                         claim({ section: SECTION.HAPPENED, said: "A fact." })]);
    assert.equal(n.withheld.length, 1);
    assert.equal(anyFigureWithheld(n), true);
  });

  test("a case with everything confirmed withholds nothing", () => {
    const n = narrative([money("One.", ["quantity"])], { confirmed: new Set(["quantity"]) });
    assert.equal(anyFigureWithheld(n), false);
    assert.deepEqual([...n.waiting], []);
    assert.equal(n.claims[0].figure.amount, "1250.00");
  });

  test("material claims are identified, for the projection to be unable to drop", () => {
    /* `specs/05`: role selection "never grants permissions or hides material
       risks". Which risks those are is a property of the claim, not of the
       reader, so it is decided here. */
    const n = narrative(claims());
    assert.equal(n.material.length, 1);
    assert.match(n.material[0].said, /after the build/);
  });

  test("an empty case still has five sections and says nothing", () => {
    const n = narrative([]);
    assert.equal(n.sections.length, 5);
    assert.deepEqual([...n.claims], []);
    assert.equal(anyFigureWithheld(n), false);
  });
});

/* ------------------------------------------------------- nothing is generated */

describe("nothing here writes prose", () => {
  test("the module produces no sentence a caller did not supply", () => {
    /* Except the one about what is missing, which is assembled from field
       names rather than composed. A module that wrote the narrative would be
       the thing `specs/02` says to do last and behind a flag. */
    const n = narrative([claim({ section: SECTION.HAPPENED, said: "A supplied sentence." })]);
    assert.equal(n.claims[0].said, "A supplied sentence.");
  });

  test("and the one sentence it does write is about gaps, never about impact", () => {
    const c = resolve(money("x", ["quantity"]), new Set());
    const added = c.said.replace("x", "").trim();
    assert.match(added, /^We still need/);
    assert.equal(/[£$€]|\d+\.\d{2}/.test(added), false,
      "the assembled sentence carries a figure");
  });
});
