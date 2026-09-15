/**
 * Engineering requirements — increment C1.
 *
 * The roadmap's exit gate is "Scoped/versioned records save and reopen", and
 * its stated value is entering tolerances, finishes and specs **even without
 * geometry**. So the first thing tested is that none of this needs a model.
 *
 * After that, the four rules from `design/06-PART-BUILDER-AND-REVIEW.md` that
 * the code is supposed to enforce rather than describe: a cited standard is
 * not its contents; there is no silent universal tolerance; limits are exact;
 * and a conflict is reported, never resolved.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  KIND, SCOPE, VERIFICATION, ATTACHMENT, SCHEMA_VERSION,
  deviationNm, nmToDecimal, tolerance, requirement, newRequirementId,
  attachments, conflicts, schedule, labelOfKind,
  serialiseRequirements, deserialiseRequirements,
} from "../../src/studio/requirements.mjs";

const dim = (over = {}) => requirement({
  kind: KIND.DIMENSIONAL,
  tolerance: tolerance({ nominal: "10", plusMinus: "0.1", unit: "mm" }),
  ...over,
});

/* ------------------------------------------------- it works with no model */

describe("requirements do not need geometry", () => {
  test("a finish on the whole part records with no model at all", () => {
    const r = requirement({
      kind: KIND.FINISH, process: "Anodise", designation: "Type II, clear",
      source: "the enquiry",
    });
    assert.equal(r.scope.type, SCOPE.PART);
    assert.deepEqual([...r.missing], []);
  });

  test("a requirement on a feature that does not exist yet is still recorded", () => {
    // The ordinary case in C1: you know the bore has to be reamed long before
    // anybody has modelled the bore.
    const r = requirement({
      kind: KIND.SURFACE_TEXTURE, parameter: "Ra", value: "1.6", valueUnit: "um",
      scope: { type: SCOPE.FEATURE, featureId: "bore-1" },
    });
    /* null, not []. An empty array now means a model that happens to carry no
       features, which is a different claim: a requirement naming a feature on
       such a part has lost its target rather than being ahead of it. */
    const [a] = attachments([r], null);
    assert.equal(a.state, ATTACHMENT.WAITING);
    assert.match(a.why, /no model yet/);
  });

  test("a model with no features left is not the same as no model", () => {
    /* Delete the only hole on a block and the feature list goes empty. If that
       read as "no model", the requirement that just lost its target would
       report as waiting for a model sitting right there. Found by the Part
       Builder wiring, where it happened. */
    const r = requirement({ kind: KIND.SURFACE_TEXTURE, parameter: "Ra", value: "1.6",
      scope: { type: SCOPE.FEATURE, featureId: "hole-1" } });
    assert.equal(attachments([r], null)[0].state, ATTACHMENT.WAITING, "no model");
    assert.equal(attachments([r], [])[0].state, ATTACHMENT.DETACHED, "a model with nothing on it");
  });

  test("and a schedule says so rather than calling it detached", () => {
    const r = requirement({ kind: KIND.EDGE, condition: "Break 0.3 max",
      scope: { type: SCOPE.FEATURE, featureId: "edge-top" } });
    const s = schedule([r], null);
    assert.deepEqual([...s.waitingForGeometry], [r.id]);
    assert.deepEqual([...s.detached], []);
  });
});

/* ------------------------------------------------------------ exactness */

describe("limits are exact", () => {
  test("a metric deviation converts without rounding", () => {
    assert.equal(deviationNm("0.05", "mm"), 50_000n);
    assert.equal(deviationNm("-0.1", "mm"), -100_000n);
    assert.equal(deviationNm("0", "mm"), 0n);
  });

  test("an imperial one does too, including a thou", () => {
    /* The reason this module counts in nanometres rather than borrowing the
       micrometres units.mjs uses. One thou is 25.4 um — not a whole
       micrometre — and one thou is about the most common tolerance there is.
       In nanometres it is 25 400 exactly. */
    assert.equal(deviationNm("0.001", "in"), 25_400n);
    assert.equal(deviationNm("0.0001", "in"), 2_540n, "a tenth");
    assert.equal(deviationNm("0.00001", "in"), 254n);
    assert.equal(deviationNm("1", "in"), 25_400_000n);
  });

  test("a deviation finer than a nanometre is refused, not rounded", () => {
    /* Rounding would silently change a limit, and a limit that moves is the
       one thing a tolerance must not do. Nothing a person writes as a
       tolerance lands here, so reaching it means a typo. */
    assert.throws(() => deviationNm("0.0000001", "in"), /finer than a nanometre/);
  });

  test("a negative deviation is allowed, unlike a length", () => {
    // units.mjs rejects a negative length, correctly — a part cannot be -3mm
    // wide. A lower deviation of -0.1 is ordinary.
    assert.equal(deviationNm("-0.25", "mm"), -250_000n);
  });

  test("nonsense is refused rather than parsed loosely", () => {
    for (const bad of ["", "abc", "1.2.3", "0,5", "1e-3", null, undefined]) {
      assert.throws(() => deviationNm(bad, "mm"), /not a plain decimal/);
    }
  });

  test("a number with no unit is not a limit", () => {
    assert.throws(() => deviationNm("0.1", ""), /not a unit this understands/);
    assert.throws(() => deviationNm("0.1", "furlongs"), /not a unit this understands/);
  });

  test("nanometres come back as the decimal that went in", () => {
    assert.equal(nmToDecimal(50_000n, "mm"), "0.05");
    assert.equal(nmToDecimal(-100_000n, "mm"), "-0.1");
    assert.equal(nmToDecimal(10_000_000n, "mm"), "10");
    assert.equal(nmToDecimal(25_400_000n, "in"), "1");
    assert.equal(nmToDecimal(25_400n, "in"), "0.001", "one thou");
  });
});

/* ------------------------------------------------- the three ways to write it */

describe("the three ways of writing one tolerance", () => {
  const sym = tolerance({ nominal: "10", plusMinus: "0.1", unit: "mm" });
  const asym = tolerance({ nominal: "10", upper: "0.1", lower: "-0.1", unit: "mm" });
  const lims = tolerance({ nominal: "10", maximum: "10.1", minimum: "9.9", unit: "mm" });

  test("they reduce to the same limits", () => {
    for (const t of [asym, lims]) {
      assert.equal(t.upperNm, sym.upperNm);
      assert.equal(t.lowerNm, sym.lowerNm);
      assert.equal(t.maximumNm, sym.maximumNm);
      assert.equal(t.minimumNm, sym.minimumNm);
    }
  });

  test("but each remembers how it was written", () => {
    assert.equal(sym.form, "symmetric");
    assert.equal(asym.form, "asymmetric");
    assert.equal(lims.form, "limits");
  });

  test("and reads back the way an engineer would write it", () => {
    assert.equal(sym.text, "10mm ±0.1");
    assert.equal(sym.range, "9.9 … 10.1mm");
  });

  test("an asymmetric tolerance keeps its sign", () => {
    const t = tolerance({ nominal: "10", upper: "0.2", lower: "-0.1", unit: "mm" });
    assert.equal(t.text, "10mm +0.2 / -0.1");
    assert.equal(t.range, "9.9 … 10.2mm");
    assert.equal(t.bandNm, 300_000n);
  });

  test("a one-sided tolerance is fine, and not mistaken for symmetric", () => {
    // H7-style: nothing below nominal.
    const t = tolerance({ nominal: "20", upper: "0.021", lower: "0", unit: "mm" });
    assert.equal(t.minimumNm, 20_000_000n);
    assert.equal(t.maximumNm, 20_021_000n);
    assert.equal(t.form, "asymmetric");
  });
});

/* ------------------------------------------------- no silent default */

describe("a dimension with no stated limits has none", () => {
  test("stating nothing is refused, with the three ways offered", () => {
    assert.throws(() => tolerance({ nominal: "10", unit: "mm" }),
      /State the tolerance one of three ways/);
  });

  test("a tolerance without a unit is refused", () => {
    assert.throws(() => tolerance({ nominal: "10", plusMinus: "0.1" }),
      /needs a unit/);
  });

  test("a tolerance without a nominal is refused", () => {
    assert.throws(() => tolerance({ plusMinus: "0.1", unit: "mm" }),
      /needs the nominal size/);
  });

  test("limits the wrong way round are caught rather than quietly swapped", () => {
    assert.throws(() => tolerance({ nominal: "10", upper: "-0.2", lower: "0.1", unit: "mm" }),
      /upper limit is below the lower one/);
  });

  test("a signed plus/minus is refused, because it reads as one-sided", () => {
    assert.throws(() => tolerance({ nominal: "10", plusMinus: "-0.1", unit: "mm" }),
      /written once, without a sign/);
  });
});

/* --------------------------------------- a cited standard is not its contents */

describe("citing a specification", () => {
  test("a citation without its text leaves the requirement unverified", () => {
    /* The rule stated outright in design/06: "A cited standard name alone does
       not give the tool its limits." Nothing in this repository knows what any
       standard says, and it must stay that way. */
    const r = requirement({
      kind: KIND.FINISH, process: "Anodise",
      spec: { name: "SYN-SPEC-100", revision: "C" },
    });
    assert.equal(r.verification, VERIFICATION.UNVERIFIED);
  });

  test("supplying the clause text makes it sourced", () => {
    const r = requirement({
      kind: KIND.FINISH, process: "Anodise",
      spec: { name: "SYN-SPEC-100", revision: "C", clause: "4.2",
        text: "Coating thickness 20 to 25 micrometres on all external surfaces." },
    });
    assert.equal(r.verification, VERIFICATION.SOURCED);
  });

  test("a specification with no revision says so rather than implying the current one", () => {
    const r = requirement({ kind: KIND.PROCESS, process: "Solution treat",
      spec: { name: "SYN-SPEC-200" } });
    assert.equal(r.spec.revision, null);
    const s = schedule([r], null);
    assert.match(s.rows[0].spec, /no revision given/);
  });

  test("a specification needs an identifier at all", () => {
    assert.throws(() => requirement({ kind: KIND.EDGE, condition: "Deburr", spec: { revision: "A" } }),
      /needs its identifier/);
  });

  test("an explicit question outranks everything", () => {
    const r = requirement({ kind: KIND.INSPECTION, requirement: "CMM report",
      question: "Is a full dimensional report needed on every batch, or first article only?" });
    assert.equal(r.verification, VERIFICATION.QUESTION);
  });
});

/* ------------------------------------------------------------ scope */

describe("where a requirement applies", () => {
  test("the whole part is the default, and is stated rather than implied", () => {
    assert.equal(requirement({ kind: KIND.EDGE, condition: "Deburr" }).scope.type, SCOPE.PART);
  });

  test("a feature scope needs the feature", () => {
    assert.throws(() => requirement({ kind: KIND.EDGE, condition: "x", scope: { type: SCOPE.FEATURE } }),
      /needs the feature's id/);
  });

  test("selected faces need at least one face", () => {
    assert.throws(() => requirement({ kind: KIND.FINISH, process: "Paint", scope: { type: SCOPE.FACES } }),
      /at least one face/);
  });

  test("'all except' with nothing excepted is refused as misleading", () => {
    /* It is the same as "all surfaces", and writing it the long way hides that
       from whoever reads the schedule. */
    assert.throws(() => requirement({ kind: KIND.FINISH, process: "Anodise",
      scope: { type: SCOPE.ALL_EXCEPT, except: [] } }),
      /it is simply all surfaces/);
  });

  test("masked areas are kept, because they are the requirement", () => {
    const r = requirement({ kind: KIND.FINISH, process: "Anodise",
      scope: { type: SCOPE.ALL_EXCEPT, except: ["bore-1", "face-datum-A"] } });
    assert.deepEqual([...r.scope.except], ["bore-1", "face-datum-A"]);
    assert.match(schedule([r], null).rows[0].target, /all except bore-1\+face-datum-A/);
  });
});

/* ---------------------------------------------------------- attachment */

describe("requirements that lose their target", () => {
  const onBore = () => requirement({ kind: KIND.SURFACE_TEXTURE, parameter: "Ra", value: "1.6",
    scope: { type: SCOPE.FEATURE, featureId: "bore-1" } });

  test("a feature that exists is attached", () => {
    assert.equal(attachments([onBore()], ["bore-1", "bore-2"])[0].state, ATTACHMENT.OK);
  });

  test("a feature that has gone is detached, and named", () => {
    const [a] = attachments([onBore()], ["bore-2"]);
    assert.equal(a.state, ATTACHMENT.DETACHED);
    assert.match(a.why, /bore-1 no longer exists/);
  });

  test("nothing is moved to the surviving feature", () => {
    /* The rule: "Do not silently transfer a tolerance to a different hole."
       The function reports; it never reassigns. */
    const r = onBore();
    const [a] = attachments([r], ["bore-2"]);
    assert.equal(a.state, ATTACHMENT.DETACHED);
    assert.equal(r.scope.featureId, "bore-1", "the requirement still points where it pointed");
  });

  test("a whole-part requirement cannot detach", () => {
    const r = requirement({ kind: KIND.EDGE, condition: "Deburr all over" });
    assert.equal(attachments([r], ["bore-2"])[0].state, ATTACHMENT.OK);
  });

  test("a masked face that has gone detaches too", () => {
    const r = requirement({ kind: KIND.FINISH, process: "Anodise",
      scope: { type: SCOPE.ALL_EXCEPT, except: ["bore-1"] } });
    assert.equal(attachments([r], ["face-1"])[0].state, ATTACHMENT.DETACHED);
  });
});

/* ------------------------------------------------------------ conflicts */

describe("conflicts are reported, never resolved", () => {
  test("two different tolerances on one dimension conflict", () => {
    const a = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" } });
    const b = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" },
      tolerance: tolerance({ nominal: "10", plusMinus: "0.05", unit: "mm" }) });
    const c = conflicts([a, b]);
    assert.equal(c.length, 1);
    assert.equal(c[0].type, "duplicate-target");
    assert.match(c[0].why, /do not agree/);
  });

  test("the same tolerance stated twice is untidy, not a conflict", () => {
    const a = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" } });
    const b = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" } });
    assert.deepEqual([...conflicts([a, b])], []);
  });

  test("neither is chosen", () => {
    // The whole point. Picking one would be an engineering decision made by a
    // tool and hidden from the person it was made for.
    const a = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" } });
    const b = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" },
      tolerance: tolerance({ nominal: "10", plusMinus: "0.05", unit: "mm" }) });
    const c = conflicts([a, b]);
    assert.deepEqual([...c[0].ids].sort(), [a.id, b.id].sort());
    assert.equal(c[0].resolved, undefined, "there is no resolution field to fill in");
  });

  test("a general and a specific tolerance overlap until precedence is stated", () => {
    const general = requirement({ kind: KIND.GENERAL_TOLERANCE, convention: "Synthetic house standard, medium" });
    const specific = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" } });
    const c = conflicts([general, specific]);
    assert.equal(c.length, 1);
    assert.equal(c[0].type, "precedence-unstated");
    assert.match(c[0].why, /Say which governs/);
  });

  test("and stop overlapping once somebody says which governs", () => {
    const general = requirement({ kind: KIND.GENERAL_TOLERANCE, convention: "Synthetic house standard" });
    const specific = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" },
      note: "This overrides the general tolerance." });
    assert.deepEqual([...conflicts([general, specific])], []);
  });

  test("one specification at two revisions conflicts", () => {
    const a = requirement({ kind: KIND.FINISH, process: "Anodise",
      spec: { name: "SYN-SPEC-100", revision: "C" } });
    const b = requirement({ kind: KIND.PROCESS, process: "Seal",
      spec: { name: "SYN-SPEC-100", revision: "D" } });
    const c = conflicts([a, b]);
    assert.equal(c.length, 1);
    assert.equal(c[0].type, "specification-revision");
    assert.match(c[0].why, /cited at C and D/);
  });

  test("two different specifications do not", () => {
    const a = requirement({ kind: KIND.FINISH, process: "Anodise",
      spec: { name: "SYN-SPEC-100", revision: "C" } });
    const b = requirement({ kind: KIND.PROCESS, process: "Seal",
      spec: { name: "SYN-SPEC-200", revision: "A" } });
    assert.deepEqual([...conflicts([a, b])], []);
  });

  test("requirements on different features do not conflict", () => {
    const a = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" } });
    const b = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-2" },
      tolerance: tolerance({ nominal: "10", plusMinus: "0.05", unit: "mm" }) });
    assert.deepEqual([...conflicts([a, b])], []);
  });
});

/* ------------------------------------------------------------ the schedule */

describe("the schedule both audiences read", () => {
  test("it lists limits, scope, specification and source", () => {
    const r = dim({
      scope: { type: SCOPE.FEATURE, featureId: "bore-1" },
      spec: { name: "SYN-SPEC-100", revision: "C", text: "clause text supplied" },
      source: "the drawing, page 2",
    });
    const [row] = schedule([r], ["bore-1"]).rows;
    assert.equal(row.limits, "9.9 … 10.1mm");
    assert.equal(row.stated, "10mm ±0.1");
    assert.equal(row.target, "bore-1");
    assert.equal(row.spec, "SYN-SPEC-100 rev C");
    assert.equal(row.source, "the drawing, page 2");
    assert.equal(row.label, "dimensional tolerance");
  });

  test("an incomplete requirement says which field is missing", () => {
    const r = requirement({ kind: KIND.GEOMETRIC, characteristic: "Position" });
    assert.deepEqual([...r.missing], ["value"]);
    const s = schedule([r], null);
    assert.deepEqual([...s.incomplete], [r.id]);
    assert.match(s.nextQuestion, /missing a value: value/);
  });

  test("the next question is the thing blocking review soonest", () => {
    const a = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" } });
    const b = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" },
      tolerance: tolerance({ nominal: "10", plusMinus: "0.05", unit: "mm" }) });
    const incomplete = requirement({ kind: KIND.GEOMETRIC, characteristic: "Position" });
    // A conflict outranks a missing field: one is wrong, the other is unfinished.
    assert.match(schedule([a, b, incomplete], ["bore-1"]).nextQuestion, /do not agree/);
  });

  test("nothing to ask returns null rather than a reassuring sentence", () => {
    const r = requirement({ kind: KIND.EDGE, condition: "Break 0.3 max" });
    assert.equal(schedule([r], null).nextQuestion, null);
  });

  test("it says when a set could go to a reviewer", () => {
    const r = requirement({ kind: KIND.EDGE, condition: "Break 0.3 max" });
    assert.equal(schedule([r], null).readyToRequestReview, true);
  });

  test("and never says approved, because that is a person's decision", () => {
    const s = schedule([requirement({ kind: KIND.EDGE, condition: "x" })], null);
    assert.equal("approved" in s, false);
    assert.equal(JSON.stringify(s).includes("approved"), false);
  });

  test("an unverified citation blocks nothing but is reported", () => {
    const r = requirement({ kind: KIND.FINISH, process: "Anodise",
      spec: { name: "SYN-SPEC-100", revision: "C" } });
    const s = schedule([r], null);
    assert.deepEqual([...s.unverified], [r.id]);
    assert.equal(s.readyToRequestReview, true, "a citation somebody has to check is not an error");
    assert.match(s.nextQuestion, /nobody has supplied/);
  });

  test("a detached requirement stops it being ready", () => {
    const r = requirement({ kind: KIND.SURFACE_TEXTURE, parameter: "Ra", value: "1.6",
      scope: { type: SCOPE.FEATURE, featureId: "bore-1" } });
    assert.equal(schedule([r], ["bore-2"]).readyToRequestReview, false);
  });
});

/* -------------------------------------------------------------- records */

describe("the records themselves", () => {
  test("every kind has a human label", () => {
    for (const k of Object.values(KIND)) {
      assert.notEqual(labelOfKind(k), k, `${k} has no label`);
    }
  });

  test("an unknown kind is refused rather than stored", () => {
    assert.throws(() => requirement({ kind: "vibes" }), /is not a kind of requirement/);
  });

  test("records carry a schema version, so a later build can tell", () => {
    assert.equal(requirement({ kind: KIND.EDGE, condition: "x" }).schema, SCHEMA_VERSION);
  });

  test("ids are unique across rapid creation", () => {
    const ids = new Set(Array.from({ length: 5000 }, newRequirementId));
    assert.equal(ids.size, 5000);
  });

  test("a record survives storage and comes back the same", () => {
    /* The increment's own exit gate: "Scoped/versioned records save and
       reopen". Plain JSON.stringify throws here, because every limit is a
       BigInt — which is why these two functions exist and why they use the
       tagging format outcome-store.mjs already established rather than a
       second one for the same problem. */
    const r = dim({ scope: { type: SCOPE.FEATURE, featureId: "bore-1" },
      spec: { name: "SYN-SPEC-100", revision: "C" } });

    assert.throws(() => JSON.stringify(r), /BigInt/, "which is the whole reason for the tagging");

    const { requirements: [back], unreadable } = deserialiseRequirements(serialiseRequirements([r]));
    assert.equal(unreadable, 0);
    assert.equal(back.id, r.id);
    assert.equal(back.scope.featureId, "bore-1");
    assert.equal(back.spec.revision, "C");
    assert.equal(back.verification, VERIFICATION.UNVERIFIED);
  });

  test("and its limits come back as exact integers, not as text", () => {
    const r = dim();
    const { requirements: [back] } = deserialiseRequirements(serialiseRequirements([r]));
    assert.equal(typeof back.tolerance.upperNm, "bigint");
    assert.equal(back.tolerance.upperNm, 100_000n);
    assert.equal(back.tolerance.range, r.tolerance.range);
  });

  test("a record another build cannot rebuild is dropped, with a reason", () => {
    // Withheld rather than half-read, which is what every store here does.
    const text = serialiseRequirements([{ id: "REQ-x", kind: "a-kind-from-the-future" }]);
    const out = deserialiseRequirements(text);
    assert.deepEqual([...out.requirements], []);
    assert.equal(out.unreadable, 1);
    assert.match(out.why[0], /REQ-x could not be read/);
  });

  test("rubbish is not mistaken for an empty schedule", () => {
    const out = deserialiseRequirements("{{{");
    assert.equal(out.unreadable, 1);
    assert.match(out.why[0], /not readable text/);
  });

  test("a mix comes back with the good ones and a count of the rest", () => {
    const good = requirement({ kind: KIND.EDGE, condition: "Deburr" });
    const text = serialiseRequirements([good, { id: "REQ-bad", kind: "nope" }]);
    const out = deserialiseRequirements(text);
    assert.equal(out.requirements.length, 1);
    assert.equal(out.requirements[0].id, good.id);
    assert.equal(out.unreadable, 1);
  });

  test("the model revision it was attached against is kept", () => {
    // So a later geometry change can tell whether the attachment still means
    // what it meant when somebody made it.
    const r = dim({ modelRevision: 4 });
    assert.equal(r.modelRevision, 4);
  });
});
