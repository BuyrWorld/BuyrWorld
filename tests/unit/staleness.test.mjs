/**
 * Whether something worked out earlier still describes the part in front of
 * you.
 *
 * The harm this prevents is specific. Calculate a cost, add a pocket, save
 * the estimate: what gets stored is the cost of the part before the pocket,
 * filed under the part after it. Build a review package, change a tolerance,
 * export: an engineer receives a package describing a requirement that no
 * longer exists.
 *
 * Neither says anything is wrong, because from the inside nothing is — which
 * is why this is a rule rather than a caption.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { stamp, changedSince, isStale, saidPlainly, check, DEPENDS }
  from "../../src/studio/staleness.mjs";
import { block, addHole } from "../../src/studio/geometry.mjs";
import { requirement, tolerance, KIND, SCOPE } from "../../src/studio/requirements.mjs";

const mm = (x) => BigInt(Math.round(x * 1000));
const part = () => block({ widthUm: mm(100), lengthUm: mm(50), thicknessUm: mm(10) });
const withHole = (m) => addHole(m, { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }).model;
const req = (nominal = "6") => requirement({
  kind: KIND.DIMENSIONAL,
  tolerance: tolerance({ nominal, plusMinus: "0.05", unit: "mm" }),
  scope: { type: SCOPE.FEATURE, featureId: "hole-1" },
});

/* ------------------------------------------------------------ not changed */

describe("nothing moved", () => {
  test("the same inputs are not stale", () => {
    const m = part();
    const mark = stamp({ geometry: m, material: "FG-300", requirements: [] });
    assert.deepEqual([...changedSince(mark, { geometry: m, material: "FG-300", requirements: [] })], []);
    assert.equal(isStale(mark, { geometry: m, material: "FG-300", requirements: [] }), false);
  });

  test("an equal model built separately is not a change", () => {
    /* Comparing by identity would call every re-render a change, and a
       warning that is always on is one nobody reads. */
    const mark = stamp({ geometry: part() });
    assert.equal(isStale(mark, { geometry: part() }), false);
  });

  test("nothing stamped is never stale", () => {
    assert.equal(isStale(stamp({}), { geometry: part() }), false);
  });

  test("saying nothing is the right output for nothing", () => {
    assert.equal(saidPlainly([]), "");
    assert.equal(check(stamp({ geometry: part() }), { geometry: part() }).said, "");
  });
});

/* -------------------------------------------------------------- it moved */

describe("something moved", () => {
  test("adding a feature makes a derived thing stale", () => {
    const mark = stamp({ geometry: part() });
    const after = check(mark, { geometry: withHole(part()) });
    assert.equal(after.stale, true);
    assert.equal(after.usable, false);
    assert.deepEqual([...after.changed], ["geometry"]);
  });

  test("a changed dimension counts, down to the micrometre", () => {
    /* The exactness is the point. A cost worked out for a 10mm plate is not
       the cost of a 10.001mm plate, and nothing here decides which
       differences are small enough to ignore. */
    const a = block({ widthUm: mm(100), lengthUm: mm(50), thicknessUm: mm(10) });
    const b = block({ widthUm: mm(100), lengthUm: mm(50), thicknessUm: mm(10) + 1n });
    assert.equal(isStale(stamp({ geometry: a }), { geometry: b }), true);
  });

  test("a changed material counts", () => {
    assert.deepEqual(
      [...changedSince(stamp({ material: "FG-300" }), { material: "FG-400" })],
      ["material"]);
  });

  test("a changed requirement counts, including its limits", () => {
    const mark = stamp({ requirements: [req("6")] });
    assert.deepEqual([...changedSince(mark, { requirements: [req("6.5")] })], ["requirements"]);
  });

  test("adding or removing a requirement counts", () => {
    assert.equal(isStale(stamp({ requirements: [] }), { requirements: [req()] }), true);
    assert.equal(isStale(stamp({ requirements: [req()] }), { requirements: [] }), true);
  });

  test("several moving are all named", () => {
    const mark = stamp({ geometry: part(), material: "FG-300", requirements: [] });
    const moved = changedSince(mark, {
      geometry: withHole(part()), material: "FG-400", requirements: [req()],
    });
    assert.deepEqual([...moved], ["geometry", "material", "requirements"]);
  });

  test("a model appearing where there was none is a change", () => {
    /* Absent and null are different states, and something worked out with no
       part must not survive a part arriving. */
    assert.equal(isStale(stamp({ geometry: null }), { geometry: part() }), true);
    assert.equal(isStale(stamp({ geometry: part() }), { geometry: null }), true);
  });
});

/* ------------------------------------------------------- only what it used */

describe("only what it was derived from", () => {
  test("something not stamped is not reported as changed", () => {
    /* A review package that does not depend on the quantity must not be
       invalidated by the quantity moving. A warning that cries wolf is one
       people learn to click through. */
    const mark = stamp({ geometry: part(), requirements: [] });
    const moved = changedSince(mark, {
      geometry: part(), requirements: [], inputs: { quantity: "500" },
    });
    assert.deepEqual([...moved], []);
  });

  test("and something that was stamped still is", () => {
    const mark = stamp({ geometry: part(), inputs: { quantity: "100" } });
    assert.deepEqual(
      [...changedSince(mark, { geometry: part(), inputs: { quantity: "500" } })],
      ["inputs"]);
  });
});

/* --------------------------------------------------------------- wording */

describe("what it says", () => {
  test("it names what moved rather than saying something did", () => {
    const said = saidPlainly(["geometry"]);
    assert.match(said, /The part's geometry has changed/);
    assert.match(said, /describes the part as it was, not as it is/);
  });

  test("several read as a sentence", () => {
    const said = saidPlainly(["geometry", "material", "requirements"]);
    assert.match(said, /the part's geometry, the material and the requirements have changed/i);
  });

  test("the verb belongs to the caller", () => {
    /* An estimate is recalculated and a review package is rebuilt. Telling
       somebody to do the wrong one is worse than telling them nothing. */
    assert.match(saidPlainly(["geometry"], { rebuild: "rebuilt" }), /has to be rebuilt/);
    assert.match(saidPlainly(["geometry"], { rebuild: "rebuilt" }), /since this was built/);
    assert.match(saidPlainly(["geometry"]), /has to be worked out again/);
  });

  test("every dependency has a name a person would use", () => {
    for (const [key, said] of Object.entries(DEPENDS)) {
      assert.match(said, /^[a-z]/, `${key} reads like a variable name`);
      assert.ok(said.length > 3, key);
    }
  });
});

/* ----------------------------------------------------------- the whole answer */

describe("the answer a caller acts on", () => {
  test("it says usable, not merely stale", () => {
    /* The spec requires recalculation rather than a warning. A caller that
       reads only the sentence and prints it beside an export button has
       implemented a caption. */
    const fresh = check(stamp({ geometry: part() }), { geometry: part() });
    assert.equal(fresh.usable, true);
    assert.equal(fresh.stale, false);

    const stale = check(stamp({ geometry: part() }), { geometry: withHole(part()) });
    assert.equal(stale.usable, false);
    assert.equal(stale.stale, true);
  });

  test("it carries when the stamp was taken", () => {
    const mark = stamp({ geometry: part() });
    assert.match(check(mark, { geometry: part() }).stampedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test("a missing stamp is not treated as fresh", () => {
    /* Something derived before stamps existed cannot prove it is current. It
       reports nothing changed, which is the honest answer — but the caller
       gets a null stampedAt to distinguish "checked and fine" from "never
       stamped". */
    assert.deepEqual([...changedSince(null, { geometry: part() })], []);
    assert.equal(check(null, { geometry: part() }).stampedAt, null);
  });
});

/* ------------------------------------------------------------- agreement */

describe("the sentence is grammatical", () => {
  test("a singular name takes has", () => {
    assert.match(saidPlainly(["geometry"]), /The part's geometry has changed/);
    assert.match(saidPlainly(["material"]), /The material has changed/);
  });

  test("a name that is already plural takes have, even alone", () => {
    /* Agreement cannot be worked out from how many things changed. One
       changed dependency called "the requirements" still takes *have*, and
       "The requirements has changed" is the kind of sentence that survives in
       a product for years. */
    assert.match(saidPlainly(["requirements"]), /The requirements have changed/);
    assert.match(saidPlainly(["inputs"]), /The figures entered have changed/);
  });

  test("several take have whatever they are", () => {
    assert.match(saidPlainly(["geometry", "material"]), / have changed/);
    assert.match(saidPlainly(["requirements", "inputs"]), / have changed/);
  });

  test("no sentence it can produce says has where it means have", () => {
    /* Every combination, rather than the three above and a hope. */
    const all = ["geometry", "material", "requirements", "inputs"];
    for (let mask = 1; mask < 16; mask++) {
      const moved = all.filter((_, i) => mask & (1 << i));
      const said = saidPlainly(moved);
      const plural = moved.length > 1 || ["requirements", "inputs"].includes(moved[0]);
      assert.match(said, plural ? / have changed/ : / has changed/, moved.join("+"));
    }
  });
});
