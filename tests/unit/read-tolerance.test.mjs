/**
 * Reading a tolerance off a drawing.
 *
 * The parsing is the easy half. What these are really about is the two things
 * this must refuse:
 *
 *   - a general title-block tolerance quietly becoming a limit on every
 *     dimension, when which dimensions it governs is a question about the
 *     drawing and not about the text;
 *   - "ISO 2768-m" becoming a number, when the table behind it is not here
 *     and an invented deviation would be the most plausible wrong figure this
 *     product could produce.
 *
 * And one thing it must not do at all: read a geometric control as a size
 * tolerance. The number beside a flatness symbol is a zone, not a deviation
 * from a nominal, and turning it into ± would silently widen or narrow a real
 * requirement.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  readTolerance, asTolerance, kindOf, verificationOf, saidPlainly, compareDecimals,
  FORM, APPLIES, REFUSED,
} from "../../src/intake/read-tolerance.mjs";

import { KIND, VERIFICATION, nmToDecimal } from "../../src/studio/requirements.mjs";

/* ------------------------------------------------------------ the notations */

describe("the three ways a tolerance is written", () => {
  test("plus or minus, however the drawing spells it", () => {
    for (const said of ["±0.10", "+/-0.10", "+/- 0.10", "± 0.10"]) {
      const r = readTolerance(said);
      assert.equal(r.form, FORM.SYMMETRIC, said);
      assert.equal(r.plusMinus, "0.10", said);
    }
  });

  test("two different deviations are kept different", () => {
    /* Collapsing +0.2/-0.05 into ±0.2 would widen the part by 0.15 and look
       tidier while doing it. */
    const r = readTolerance("+0.20 / -0.05");
    assert.equal(r.form, FORM.ASYMMETRIC);
    assert.equal(r.upper, "+0.20");
    assert.equal(r.lower, "-0.05");
  });

  test("asymmetric with the same figure both ways is still asymmetric as written", () => {
    /* It means the same band, and `tolerance()` reduces both to the same
       nanometres. What is not done is rewriting what the drawing said. */
    assert.equal(readTolerance("+0.1 / -0.1").form, FORM.ASYMMETRIC);
  });

  test("the minus may be written first", () => {
    const r = readTolerance("-0.05 / +0.20");
    assert.equal(r.form, FORM.ASYMMETRIC);
    assert.equal(r.upper, "+0.20");
    assert.equal(r.lower, "-0.05");
  });

  test("a minus sign that is not a hyphen is still a minus", () => {
    /* Drawings exported from CAD use U+2212 and en dashes freely. */
    for (const dash of ["−", "–", "—"]) {
      assert.equal(readTolerance(`+0.20 / ${dash}0.05`).form, FORM.ASYMMETRIC, dash);
    }
  });

  test("limits stated outright need no nominal", () => {
    const r = readTolerance("10.05 / 9.95");
    assert.equal(r.form, FORM.LIMITS);
    assert.equal(r.maximum, "10.05");
    assert.equal(r.minimum, "9.95");
  });

  test("which limit is the maximum is a fact about the numbers, not the order", () => {
    assert.deepEqual(
      [readTolerance("9.95 / 10.05").maximum, readTolerance("9.95 / 10.05").minimum],
      ["10.05", "9.95"]);
  });

  test("MAX and MIN are read whichever way round they are printed", () => {
    for (const said of ["MAX 10.05 MIN 9.95", "MIN. 9.95 MAX. 10.05"]) {
      const r = readTolerance(said);
      assert.equal(r.form, FORM.LIMITS, said);
      assert.equal(r.maximum, "10.05", said);
      assert.equal(r.minimum, "9.95", said);
    }
  });

  test("two identical limits are not a tolerance", () => {
    assert.equal(readTolerance("10.00 / 10.00").ok, false);
  });

  test("a MAX below its MIN is refused rather than quietly swapped", () => {
    /* The unlabelled pair is ordered by value, because "10.05 / 9.95" says
       nothing about which is which. A labelled pair does say, and if the
       labels disagree with the numbers then something is wrong with the
       reading or with the drawing — silently swapping them would hide
       whichever it is. */
    const r = readTolerance("MAX 9.95 MIN 10.05");
    assert.equal(r.ok, false);
    assert.equal(r.why, REFUSED.BACKWARDS);
  });

  test("a MAX equal to its MIN is refused too", () => {
    assert.equal(readTolerance("MAX 10.00 MIN 10.00").ok, false);
  });
});

/* ------------------------------------------------------------- the refusals */

describe("what it will not read", () => {
  test("a geometric control is kept as written, not turned into limits", () => {
    /* specs/03: GD&T outside the supported parser stays a raw review item,
       not an invented interpretation. */
    for (const said of ["⏥ 0.05", "flatness 0.05", "true position 0.1", "⊥ 0.02 A"]) {
      const r = readTolerance(said);
      assert.equal(r.ok, false, said);
      assert.equal(r.why, REFUSED.GEOMETRIC, said);
      assert.equal(r.raw, r.said, "the original was not kept");
    }
  });

  test("and it says why, in terms somebody can act on", () => {
    const r = readTolerance("⏥ 0.05");
    assert.match(r.note, /geometric control, not a size tolerance/);
    assert.match(r.note, /zone rather than a deviation from a nominal/);
  });

  test("nothing written is refused rather than treated as zero", () => {
    /* Missing is not zero — a dimension with no tolerance has none, and a
       tolerance of zero is an impossible requirement. */
    for (const said of ["", "   ", null, undefined]) {
      assert.equal(readTolerance(said).why, REFUSED.EMPTY, String(said));
    }
  });

  test("prose is not a tolerance", () => {
    for (const said of ["to be confirmed", "see note 4", "as agreed", "0.05"]) {
      assert.equal(readTolerance(said).ok, false, said);
    }
  });

  test("a bare number is not a tolerance, because it does not say which way", () => {
    /* 0.05 could be a symmetric deviation, an upper limit, or a zone. */
    assert.equal(readTolerance("0.05").why, REFUSED.NOT_A_TOLERANCE);
  });
});

/* ---------------------------------------------------------- general classes */

describe("a class is a citation, not a number", () => {
  test("ISO 2768 and its grade are recognised", () => {
    const r = readTolerance("ISO 2768-m");
    assert.equal(r.ok, true);
    assert.equal(r.form, FORM.CLASS);
    assert.equal(r.grade, "m");
  });

  test("the related standards are recognised too", () => {
    for (const said of ["ISO 2768-mK", "DIN 7168-m", "EN 22768-f", "ASME Y14.5-2018", "ISO 8015"]) {
      assert.equal(readTolerance(said).form, FORM.CLASS, said);
    }
  });

  test("no limits are produced from it, and the refusal says why", () => {
    /* The most plausible wrong number this product could produce is a
       deviation remembered from a table that is not here. */
    const r = asTolerance(readTolerance("ISO 2768-m"), { nominal: "10", unit: "mm" });
    assert.equal(r.ok, false);
    assert.match(r.why, /states which table applies, not what the limits are/);
    assert.equal(r.unverified, true);
  });

  test("it is unverified, which is the word this product already has for it", () => {
    /* The requirement is real; what it requires is not known here. */
    assert.equal(verificationOf(readTolerance("ISO 2768-m")), VERIFICATION.UNVERIFIED);
    assert.equal(verificationOf(readTolerance("±0.1")), VERIFICATION.SOURCED);
    assert.equal(verificationOf(readTolerance("⏥ 0.05")), VERIFICATION.QUESTION);
  });
});

/* ------------------------------------------------------------ applicability */

describe("a general tolerance is not applied to anything", () => {
  test("it is a general requirement, not a dimensional one", () => {
    assert.equal(kindOf(readTolerance("±0.1"), APPLIES.MARKED), KIND.DIMENSIONAL);
    assert.equal(kindOf(readTolerance("±0.1"), APPLIES.GENERAL), KIND.GENERAL_TOLERANCE);
  });

  test("a class is general however it was found", () => {
    assert.equal(kindOf(readTolerance("ISO 2768-m"), APPLIES.MARKED), KIND.GENERAL_TOLERANCE);
  });

  test("and it says outright that nothing has been decided", () => {
    /* The sentence that stops a title-block tolerance quietly becoming a
       limit on fourteen features nobody looked at. */
    const said = saidPlainly(readTolerance("±0.1"), APPLIES.GENERAL);
    assert.match(said, /general tolerance from the document rather than one marked against a dimension/);
    assert.match(said, /has not been decided here/);
    assert.match(said, /whatever carries no tolerance of its own/);
  });

  test("a marked tolerance says only what it is", () => {
    const said = saidPlainly(readTolerance("±0.1"), APPLIES.MARKED);
    assert.match(said, /Plus or minus 0\.1/);
    assert.equal(/has not been decided/.test(said), false);
  });

  test("an unreadable one is still described rather than silently absent", () => {
    assert.match(saidPlainly(readTolerance("⏥ 0.05"), APPLIES.MARKED), /geometric control/);
    assert.match(saidPlainly(readTolerance("see note 4"), APPLIES.MARKED), /kept as written/);
  });
});

/* -------------------------------------------------------------- the band */

describe("the exact band, through the module that already owns it", () => {
  test("symmetric becomes nanometres either side of the nominal", () => {
    const r = asTolerance(readTolerance("±0.10"), { nominal: "10.00", unit: "mm" });
    assert.equal(r.ok, true);
    assert.equal(nmToDecimal(r.tolerance.maximumNm, "mm"), "10.1");
    assert.equal(nmToDecimal(r.tolerance.minimumNm, "mm"), "9.9");
    assert.equal(r.tolerance.form, "symmetric");
  });

  test("asymmetric keeps both sides", () => {
    const r = asTolerance(readTolerance("+0.20 / -0.05"), { nominal: "10", unit: "mm" });
    assert.equal(nmToDecimal(r.tolerance.maximumNm, "mm"), "10.2");
    assert.equal(nmToDecimal(r.tolerance.minimumNm, "mm"), "9.95");
  });

  test("limits produce the same band as the deviations that describe them", () => {
    /* The point of reducing three notations to one: two requirements cannot
       look different and mean the same thing. */
    const a = asTolerance(readTolerance("+0.20 / -0.05"), { nominal: "10", unit: "mm" }).tolerance;
    const b = asTolerance(readTolerance("10.20 / 9.95"), { nominal: "10", unit: "mm" }).tolerance;
    assert.equal(a.maximumNm, b.maximumNm);
    assert.equal(a.minimumNm, b.minimumNm);
    assert.equal(a.bandNm, b.bandNm);
  });

  test("an imperial tolerance survives in the last place", () => {
    /* One thou is 25.4µm and a tenth is 2.54µm, which is why the band is held
       in nanometres and not micrometres. */
    const r = asTolerance(readTolerance("±0.0005"), { nominal: "0.5", unit: "in" });
    assert.equal(r.ok, true);
    assert.equal(r.tolerance.upperNm, 12700n);
    assert.equal(r.tolerance.bandNm, 25400n);
  });

  test("no band is produced without the dimension it applies to", () => {
    /* A deviation with nothing to deviate from is not a limit. */
    const r = asTolerance(readTolerance("±0.1"), { unit: "mm" });
    assert.equal(r.ok, false);
    assert.equal(r.needsNominal, true);
    assert.match(r.why, /Say which dimension it governs/);
  });

  test("nor without a unit", () => {
    const r = asTolerance(readTolerance("±0.1"), { nominal: "10" });
    assert.equal(r.ok, false);
    assert.match(r.why, /needs a unit/);
  });

  test("an unreadable tolerance produces nothing and says so", () => {
    assert.equal(asTolerance(readTolerance("see note 4"), { nominal: "10", unit: "mm" }).ok, false);
  });

  test("the engine's own refusals are passed through rather than swallowed", () => {
    /* Finer than a nanometre is a typo, not a limitation being hit, and the
       message that says so is better than a generic failure. */
    const r = asTolerance(readTolerance("±0.0000001"), { nominal: "10", unit: "mm" });
    assert.equal(r.ok, false);
    assert.match(r.why, /finer than a nanometre/);
  });
});

/* ------------------------------------------------------------ the arithmetic */

describe("comparing decimals without floating point", () => {
  test("it orders numbers of different precision correctly", () => {
    assert.equal(compareDecimals("10.05", "9.95"), 1);
    assert.equal(compareDecimals("9.95", "10.05"), -1);
    assert.equal(compareDecimals("10.0", "10.00"), 0);
    assert.equal(compareDecimals("10", "10.000"), 0);
  });

  test("it is exact where floating point is not", () => {
    /* 0.1 + 0.2 is the classic; here the risk is a limit ordered wrongly
       because two decimals compared as floats. */
    assert.equal(compareDecimals("0.30", "0.3"), 0);
    assert.equal(compareDecimals("0.1000000000000000055511151231257827", "0.1"), 1);
  });
});
