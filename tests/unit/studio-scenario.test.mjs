/**
 * The one model behind both Studio entry paths.
 *
 * The seven acceptance examples at the end of `design/05-NO-DRAWING.md` are
 * the spine of this file, in order, because they are what the pack says the
 * manual route has to do. The rest covers the three distinctions the model
 * exists to hold: blank is not unknown is not zero; entered text is not a
 * parsed number; and an extracted value is a proposal, not a fact.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  SOURCE, STATE, ENTRY, GOAL, SCHEMA_VERSION,
  field, empty, stateOf, usable, scenario, withField, readiness, started,
  compareExtraction, acceptCandidates, changeUnit, labelOf, FIELDS,
} from "../../src/studio/scenario.mjs";

const manual = (value, unit = null) => field({ value, unit, source: SOURCE.MANUAL });

/** A scenario with everything a quantity plan needs, from the pack's fixture. */
function planReady(extra = {}) {
  let s = scenario({ entry: ENTRY.MANUAL, goal: GOAL.QUANTITY });
  const vals = {
    goodParts: "100", blankWidth: "100", blankLength: "50",
    stockWidth: "1000", stockLength: "500", kerf: "3", edgeMargin: "10",
    passRate: "90", ...extra,
  };
  for (const [k, v] of Object.entries(vals)) s = withField(s, k, { value: v, unit: "mm" });
  return s;
}

/* ------------------------------------------- blank, unknown and zero differ */

describe("blank, unknown and zero are three different things", () => {
  test("a field nobody reached is Missing", () => {
    assert.equal(stateOf(empty()), STATE.MISSING);
    assert.equal(usable(empty()), false);
  });

  test("a field somebody could not answer says so, and is not the same as blank", () => {
    const f = field({ unknown: true });
    assert.equal(stateOf(f), STATE.UNKNOWN);
    assert.notEqual(stateOf(f), stateOf(empty()),
      "'I don't know' is an answer; not having got there is not");
    assert.equal(usable(f), false);
  });

  test("a zero is a value, and is usable", () => {
    // A kerf of zero is a real claim about a waterjet, not a missing number.
    const f = manual("0", "mm");
    assert.equal(stateOf(f), STATE.CONFIRMED);
    assert.equal(usable(f), true);
  });

  test("a field cannot be a value and unknown at once", () => {
    assert.throws(() => field({ value: "10", unknown: true }),
      /cannot both hold a value and be marked unknown/);
  });

  test("and a stored record claiming both is not calculated with", () => {
    /* field() forbids that pair, so this cannot arise from the application —
       but usable() is also handed records straight out of storage, which no
       constructor has vetted. Without this the `unknown` clause in usable() is
       unreachable, and a hand-edited record could put a value nobody knows
       into an arithmetic result.

       Found by mutation: deleting that clause broke no test. */
    assert.equal(usable({ value: "90", unknown: true, source: SOURCE.MANUAL }), false);
    assert.equal(usable({ value: "90", unknown: false, source: SOURCE.MANUAL }), true,
      "and the same record without the contradiction is fine");
  });
});

/* ------------------------------------------------- what the labels say */

describe("what the reader is told about a value", () => {
  test("typed by a person reads as confirmed", () => {
    assert.equal(stateOf(manual("100", "mm")), STATE.CONFIRMED);
  });

  test("read from a document reads as needing a check, and cannot be calculated with", () => {
    const f = field({ value: "100", source: SOURCE.EXTRACTED });
    assert.equal(stateOf(f), STATE.PROPOSED);
    assert.equal(usable(f), false, "nobody has checked it yet");
  });

  test("the same value, once accepted, becomes usable", () => {
    const f = field({ value: "100", source: SOURCE.EXTRACTED, reviewed: true });
    assert.equal(stateOf(f), STATE.CONFIRMED);
    assert.equal(usable(f), true);
  });

  test("a standing default says it is assumed", () => {
    assert.equal(stateOf(field({ value: "3", source: SOURCE.ASSUMPTION })), STATE.ASSUMED);
  });

  test("every field has a label a person would recognise", () => {
    for (const [name] of FIELDS) {
      assert.notEqual(labelOf(name), name, `${name} has no human label`);
      assert.ok(labelOf(name).length > 2);
    }
  });
});

/* ------------------------------------- the pack's acceptance examples, in order */

describe("acceptance example 1 — a manual plan with no document", () => {
  test("a manual scenario has no document and needs none", () => {
    const s = planReady();
    assert.equal(s.entry, ENTRY.MANUAL);
    assert.equal(s.document, null, "no filename, no document id, no upload record");
    assert.equal(readiness(s).quantityPlan.ready, true);
  });

  test("it survives a round trip through storage without gaining one", () => {
    const s = planReady();
    const back = scenario(JSON.parse(JSON.stringify(s)));
    assert.equal(back.document, null);
    assert.equal(back.schema, SCHEMA_VERSION);
    assert.equal(back.fields.goodParts.value, "100");
    assert.equal(readiness(back).quantityPlan.ready, true);
  });
});

describe("acceptance example 2 — no material price", () => {
  test("the quantity plan is ready while the cost is not", () => {
    const r = readiness(planReady());
    assert.equal(r.quantityPlan.ready, true);
    assert.equal(r.cost.ready, false);
  });

  test("and it says which figures a cost is waiting on, rather than showing zero", () => {
    const r = readiness(planReady());
    assert.match(r.cost.message, /A complete cost needs/);
    assert.match(r.cost.message, /Material rate/);
    assert.equal(/0\.00|£0|zero/.test(r.cost.message), false,
      "a missing rate is missing, never zero");
  });

  test("mass is blocked separately from cost, because they fail for different reasons", () => {
    const r = readiness(planReady());
    assert.equal(r.materialMass.ready, false);
    assert.match(r.materialMass.message, /Blank thickness/);
    assert.match(r.materialMass.message, /Material density/);
  });
});

describe("acceptance example 3 — an unknown pass rate", () => {
  const s = () => {
    let x = planReady();
    return withField(x, "passRate", { unknown: true });
  };

  test("the plan is blocked, and names the pass rate", () => {
    const r = readiness(s());
    assert.equal(r.quantityPlan.ready, false);
    assert.match(r.quantityPlan.message, /Expected pass rate/);
  });

  test("no default is substituted", () => {
    // The whole point: an invisible 100% would produce a complete-looking
    // purchase quantity that is short by exactly the scrap.
    assert.equal(usable(s().fields.passRate), false);
    assert.equal(s().fields.passRate.value, null);
  });

  test("but the draft still holds everything else, so it can be saved", () => {
    assert.equal(started(s()), true);
    assert.equal(s().fields.goodParts.value, "100");
    assert.deepEqual([...readiness(s()).unknowns], ["passRate"]);
  });
});

describe("acceptance example 6 — switching units", () => {
  test("converting keeps the size and changes the number", () => {
    const s = changeUnit(planReady(), "in", "convert");
    assert.equal(s.unit, "in");
    // 25.4 mm is exactly 1 inch, so a 3 mm kerf is not exact; 1000 mm is not
    // either. What matters is that the value moved rather than being relabelled.
    assert.notEqual(s.fields.stockWidth.value, "1000");
  });

  test("an exact conversion keeps full precision and no audit note", () => {
    let s = scenario({ unit: "in" });
    s = withField(s, "blankWidth", { value: "1", unit: "in" });
    const mm = changeUnit(s, "mm", "convert");
    assert.equal(mm.fields.blankWidth.value, "25.4");
    assert.equal(mm.fields.blankWidth.enteredAs, null, "nothing was lost, so nothing to record");
  });

  test("an inexact conversion records what was actually typed", () => {
    const s = changeUnit(planReady(), "in", "convert");
    assert.deepEqual(s.fields.kerf.enteredAs, { value: "3", unit: "mm" },
      "a converted 0.118 does not tell anyone that 3 mm was entered");
  });

  test("reinterpreting keeps the number and changes the meaning, when asked", () => {
    const s = changeUnit(planReady(), "in", "reinterpret");
    assert.equal(s.unit, "in");
    assert.equal(s.fields.stockWidth.value, "1000", "the digits stand, now meaning inches");
  });

  test("silently relabelling is not on offer", () => {
    assert.throws(() => changeUnit(planReady(), "in"),
      /Say whether to "convert" the values or "reinterpret" them/);
  });

  test("non-length fields are left alone", () => {
    const s = changeUnit(planReady(), "in", "convert");
    assert.equal(s.fields.goodParts.value, "100", "a count of parts has no unit to convert");
    assert.equal(s.fields.passRate.value, "90");
  });
});

describe("acceptance example 7 — an older case with no source mode", () => {
  test("a record from before this model reopens with its values intact", () => {
    // The documented migration: absent entry mode means it was entered by
    // hand, because that is the only way values got into the old form.
    const old = { id: "SC-9", fields: { goodParts: { value: "250" }, kerf: { value: "2" } } };
    const s = scenario(old);
    assert.equal(s.entry, ENTRY.MANUAL);
    assert.equal(s.fields.goodParts.value, "250");
    assert.equal(s.fields.kerf.value, "2");
    assert.equal(s.fields.stockWidth.value, null, "a field it never had is simply empty");
  });
});

/* ---------------------------------- acceptance example 5 — a later drawing */

describe("acceptance example 5 — a drawing uploaded later", () => {
  const started = "2026-09-15T10:00:00.000Z";

  test("an empty field is offered as a candidate, not filled in", () => {
    const s = scenario({});
    const c = compareExtraction(s, { blankWidth: { value: "100", unit: "mm" } }, started);
    assert.equal(c.fill.length, 1);
    assert.equal(c.applied, false, "nothing changes until somebody chooses");
    assert.equal(s.fields.blankWidth.value, null, "the scenario is untouched");
  });

  test("a candidate that disagrees is a conflict, and the current value stands", () => {
    let s = scenario({});
    s = withField(s, "blankWidth", { value: "100", unit: "mm", at: "2026-09-15T09:00:00.000Z" });
    const c = compareExtraction(s, { blankWidth: { value: "120", unit: "mm" } }, started);
    assert.equal(c.conflict.length, 1);
    assert.match(c.conflict[0].why, /the drawing says something different/);
    assert.equal(s.fields.blankWidth.value, "100");
  });

  test("a candidate that agrees is neither a fill nor a conflict", () => {
    let s = scenario({});
    s = withField(s, "blankWidth", { value: "100", unit: "mm", at: "2026-09-15T09:00:00.000Z" });
    const c = compareExtraction(s, { blankWidth: { value: "100", unit: "mm" } }, started);
    assert.equal(c.same.length, 1);
    assert.equal(c.conflict.length, 0);
  });

  test("an edit made while the extraction ran is not overwritten, or even offered", () => {
    // The pack's rule: a late extraction must not overwrite newer manual
    // edits. Decided by time, not by the order results arrive in.
    let s = scenario({});
    s = withField(s, "blankWidth", { value: "115", unit: "mm", at: "2026-09-15T10:30:00.000Z" });
    const c = compareExtraction(s, { blankWidth: { value: "120", unit: "mm" } }, started);
    assert.equal(c.stale.length, 1);
    assert.equal(c.conflict.length, 0, "not a choice to make — the person already answered");
    assert.equal(c.fill.length, 0);
  });

  test("a field marked unknown is a conflict, because the person answered it", () => {
    let s = scenario({});
    s = withField(s, "passRate", { unknown: true, at: "2026-09-15T09:00:00.000Z" });
    const c = compareExtraction(s, { passRate: { value: "92" } }, started);
    assert.equal(c.conflict.length, 1);
    assert.match(c.conflict[0].why, /you said this was not known/);
  });

  test("accepting applies only the named fields, and marks them reviewed", () => {
    let s = scenario({});
    const c = compareExtraction(s, {
      blankWidth: { value: "100", unit: "mm" },
      blankLength: { value: "50", unit: "mm" },
    }, started);

    const next = acceptCandidates(s, c, ["blankWidth"], "a buyer");
    assert.equal(next.fields.blankWidth.value, "100");
    assert.equal(next.fields.blankWidth.reviewed, true, "accepting is reviewing");
    assert.equal(usable(next.fields.blankWidth), true);
    assert.equal(next.fields.blankLength.value, null, "not accepted, so not applied");
  });

  test("an unknown field the extraction proposes is not silently taken", () => {
    let s = scenario({});
    s = withField(s, "passRate", { unknown: true, at: "2026-09-15T09:00:00.000Z" });
    const c = compareExtraction(s, { passRate: { value: "92" } }, started);
    const untouched = acceptCandidates(s, c, [], null);
    assert.equal(untouched.fields.passRate.unknown, true);
  });

  test("a candidate for a field this model does not have is ignored", () => {
    const c = compareExtraction(scenario({}), { inventedField: { value: "x" } }, started);
    assert.equal(c.fill.length + c.conflict.length + c.stale.length + c.same.length, 0);
  });
});

/* ------------------------------------------------------------- the model */

describe("both entry paths use this model", () => {
  test("an upload scenario and a manual one differ only in how they started", () => {
    const a = planReady();
    const b = scenario({ ...planReady(), entry: ENTRY.UPLOAD, document: { name: "BW-1.pdf" } });
    assert.deepEqual(readiness(a).quantityPlan, readiness(b).quantityPlan,
      "identical reviewed values must produce identical readiness");
  });

  test("editing a field returns a new scenario and bumps the revision", () => {
    const a = planReady();
    const b = withField(a, "kerf", { value: "2", unit: "mm" });
    assert.equal(a.fields.kerf.value, "3", "the original is unchanged");
    assert.equal(b.fields.kerf.value, "2");
    assert.equal(b.revision, a.revision + 1);
  });

  test("an unknown field name is refused rather than silently stored", () => {
    assert.throws(() => withField(scenario({}), "notAField", { value: "1" }), /Unknown field/);
  });

  test("an untouched scenario is not worth saving; one keystroke is", () => {
    assert.equal(started(scenario({})), false);
    assert.equal(started(withField(scenario({}), "partName", { value: "Bracket" })), true);
    assert.equal(started(withField(scenario({}), "passRate", { unknown: true })), true,
      "saying you do not know is progress worth keeping");
  });
});
