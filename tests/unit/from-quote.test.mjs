/**
 * A supplier's price increase, said as a case.
 *
 * The first of the five workflows `specs/05` names, and the one this product
 * already has an engine for. What this adds is arrangement, not arithmetic —
 * so most of these tests are about two things:
 *
 *   - every figure came out of the bridge unchanged, because a narrative
 *     layer that did its own sums would be the exact thing "code calculates,
 *     the model explains" exists to stop, one floor down;
 *   - a figure resting on an assumed share of unit cost is withheld until
 *     that assumption is confirmed. That figure is arithmetically sound and
 *     showing it as settled is how an assumption becomes a negotiating
 *     position.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { costBridge } from "../../src/calc/cost-bridge.mjs";
import {
  ratioFromPercent, moneyFromDecimal, moneyToDecimalString,
} from "../../src/calc/exact.mjs";
import { quoteCase, needsOf, assumptionClaims } from "../../src/case/from-quote.mjs";
import { narrative, sectionOf, SECTION, WEIGHT } from "../../src/case/narrative.mjs";
import { project, ROLE, DEPTH } from "../../src/case/projection.mjs";

const p = (x) => ratioFromPercent(x);
const gbp = (x) => moneyFromDecimal(x, "GBP");

/**
 * Every driver evidenced, and the weights summing to the whole unit cost.
 *
 * Both halves are needed for "nothing is assumed", and finding that out was
 * the useful part. `provenance: "user-entered"` is not evidence — the
 * provenance layer says so outright: "entered by hand is not the same as
 * evidenced by a document". And weights that do not reach 100% leave an
 * unattributed share, which is itself an assumption with an id.
 *
 * So a case where nothing waits is rarer than it looks, which is the correct
 * answer rather than an awkward one. What makes the figures appear in
 * practice is a person confirming the assumptions, not a document arriving —
 * `assumptionsToVerify` lists what needs verifying and confirming is the act.
 */
const evidenced = (label) => ({ kind: "published-index", label });
const sourced = (over = {}) => costBridge({
  baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
  requestedChange: p("9"),
  drivers: [
    { id: "material", label: "Steel bar", weight: p("60"), indexMovement: p("10"),
      source: "synthetic-index-A",
      evidence: { weight: evidenced("synthetic cost model A"),
                  movement: evidenced("synthetic index A") } },
    { id: "labour", label: "Direct labour", weight: p("40"), indexMovement: p("5"),
      source: "synthetic-index-B",
      evidence: { weight: evidenced("synthetic cost model B"),
                  movement: evidenced("synthetic index B") } },
  ],
  ...over,
});

const claimsOf = (bridge, opts) => quoteCase(bridge, opts);
const caseOf = (bridge, confirmed = new Set(), opts) =>
  narrative(claimsOf(bridge, opts), { confirmed });

const byId = (n, id) => n.claims.find((c) => c.id === id);

/* --------------------------------------------------------- it only arranges */

describe("every figure came out of the engine", () => {
  test("the request and the warranted part are the bridge's own ratios", () => {
    const b = sourced();
    const n = caseOf(b);
    assert.equal(byId(n, "requested").figure.ratio, b.requestedChange);
    assert.equal(byId(n, "warranted").figure.ratio, b.warrantedChange);
    assert.equal(byId(n, "unsupported").figure.ratio, b.unsupportedChange);
  });

  test("the money is the bridge's money, to the minor unit", () => {
    /* Not re-derived, not re-rounded. The bridge rounds once at the total and
       a second rounding here would quietly undo that. */
    const b = sourced();
    const n = caseOf(b);
    assert.equal(byId(n, "annual").figure.minor, b.annual.requested.minor);
    assert.equal(byId(n, "annual").figure.currency, "GBP");
    assert.equal(byId(n, "annual").figure.amount, moneyToDecimalString(b.annual.requested));
  });

  test("the module does no arithmetic of its own", () => {
    /* A narrative layer doing sums is the thing "code calculates" exists to
       stop, one floor down. */
    const src = readSource();
    assert.equal(/[^/*]\s[-+*/]\s*(?:bridge|b)\./.test(src), false,
      "an arithmetic operator is applied to a bridge figure");
    assert.equal(/\bmoneyAdd|moneySub|moneyScale|ratioMul|scaleDiv\b/.test(src), false,
      "the narrative imports an arithmetic helper");
  });

  test("it refuses to describe nothing", () => {
    assert.throws(() => quoteCase(null), /no cost bridge/);
  });
});

/* ------------------------------------------- the rule about assumed shares */

describe("a figure resting on an assumption waits for it", () => {
  /* A weight with no source is the provenance layer's definition of assumed. */
  const assumed = () => costBridge({
    baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
    requestedChange: p("9"),
    drivers: [
      { id: "material", label: "Steel bar", weight: p("42"), indexMovement: p("10"),
        source: "synthetic-index-A" },
      { id: "labour", label: "Direct labour", weight: p("18"), indexMovement: p("5"),
        source: "synthetic-index-B" },
    ],
  });

  test("the assumptions are found, and become the needs", () => {
    const b = assumed();
    const needs = needsOf(b);
    assert.ok(needs.length > 0, "the fixture has no assumptions to wait on");
    assert.equal(caseOf(b).waiting.length, needs.length);
  });

  test("with them unconfirmed, no figure is shown at all", () => {
    const n = caseOf(assumed());
    for (const id of ["requested", "warranted", "annual", "unsupported"]) {
      assert.equal(byId(n, id).figure, null, `${id} showed a figure`);
      assert.equal(byId(n, id).withheld, true, id);
    }
  });

  test("and each says what it is waiting for", () => {
    const n = caseOf(assumed());
    assert.match(byId(n, "annual").said, /We still need/);
    /* The ids are the assumption ids the provenance layer minted. Readable
       labels are the surface's job — the sentence names which assumptions,
       and that is what makes it actionable. */
    assert.match(byId(n, "annual").said, /weight-material/);
  });

  test("confirming some of them is not confirming them", () => {
    /* The most tempting version of the mistake: two of three settled, so show
       the number. Partial confirmation is not confirmation. */
    const b = assumed();
    const needs = needsOf(b);
    assert.ok(needs.length >= 2, "the fixture cannot show partial confirmation");
    const n = caseOf(b, new Set(needs.slice(0, needs.length - 1)));
    assert.equal(byId(n, "annual").figure, null);
  });

  test("confirming all of them shows the figures", () => {
    const b = assumed();
    const n = caseOf(b, new Set(needsOf(b)));
    assert.equal(byId(n, "annual").figure.minor, b.annual.requested.minor);
    assert.equal(byId(n, "annual").withheld, false);
  });

  test("a case with nothing assumed withholds nothing", () => {
    const b = sourced();
    assert.deepEqual([...needsOf(b)], []);
    assert.equal(caseOf(b).withheld.length, 0);
    assert.equal(byId(caseOf(b), "annual").figure.currency, "GBP");
  });

  test("each assumption is also shown as something to act on", () => {
    /* Naming the gap in the figure's sentence is not enough on its own: the
       reader needs to know which assumption, in the section that lists them. */
    const b = assumed();
    const evidence = sectionOf(caseOf(b), SECTION.EVIDENCE);
    const listed = evidence.filter((c) => needsOf(b).includes(c.id));
    assert.equal(listed.length, needsOf(b).length);
    assert.match(listed[0].said, /rests on an assumption/);
    assert.equal(assumptionClaims(b).length, needsOf(b).length);
  });
});

/* ----------------------------------------------------------- what it says */

describe("the case reads as a case", () => {
  test("all five sections have something in them", () => {
    const n = caseOf(sourced());
    for (const s of Object.values(SECTION)) {
      assert.ok(sectionOf(n, s).length > 0, `${s} is empty`);
    }
  });

  test("the unsupported part is material, so no view can hide it", () => {
    /* It is the thing a buyer is in the conversation for. */
    const n = caseOf(sourced());
    assert.equal(byId(n, "unsupported").weight, WEIGHT.MATERIAL);

    const junior = project(n, { role: ROLE.JUNIOR });
    assert.ok(junior.claims.some((c) => c.id === "unsupported"));
  });

  test("unattributed cost is reported as its own material point", () => {
    /* A share with no driver against it: no movement has been claimed on it
       and none ruled out either. */
    const n = caseOf(sourced({ drivers: [
      { id: "material", label: "Steel bar", weight: p("42"), indexMovement: p("10"),
        source: "synthetic-index-A",
        evidence: { weight: evidenced("model A"), movement: evidenced("index A") } },
    ] }));
    const gap = byId(n, "unexplained-weight");
    assert.ok(gap, "the unattributed share went unmentioned");
    assert.equal(gap.weight, WEIGHT.MATERIAL);
    assert.match(gap.said, /not attributed to any driver/);
  });

  test("and a fully attributed case does not mention it", () => {
    const whole = sourced({ drivers: [
      { id: "material", label: "Steel bar", weight: p("100"), indexMovement: p("10"),
        source: "synthetic-index-A",
        evidence: { weight: evidenced("synthetic cost model"),
                    movement: evidenced("synthetic index") } },
    ] });
    assert.equal(byId(caseOf(whole), "unexplained-weight"), undefined);
  });

  test("the next step depends on whether anything is still assumed", () => {
    /* Telling somebody to put a figure to a supplier while the figure rests
       on an assumption is the wrong next step, however good the sentence. */
    const settled = caseOf(sourced());
    assert.ok(byId(settled, "next-ask"), "a settled case was told to confirm assumptions");
    assert.match(byId(settled, "next-ask").said, /in writing/);

    const b = costBridge({
      baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
      requestedChange: p("9"),
      drivers: [{ id: "m", label: "Steel", weight: p("42"), indexMovement: p("10"),
                  source: "synthetic-index-A" }],
    });
    assert.ok(byId(caseOf(b), "next-confirm"), "an assumed case was told to go and negotiate");
  });

  test("a junior is given one next step, and it is the material one", () => {
    const view = project(caseOf(sourced()), { role: ROLE.JUNIOR });
    const next = view.sections.find((s) => s.section === SECTION.NEXT);
    assert.equal(next.claims.length, 1);
    assert.equal(next.claims[0].weight, WEIGHT.MATERIAL);
  });

  test("how it was worked out travels with it", () => {
    const n = caseOf(sourced());
    assert.match(byId(n, "how").said, /warranted = /);
    assert.match(byId(n, "how").said, /not from a model/);
  });

  test("every driver given is named in the evidence", () => {
    const n = caseOf(sourced());
    for (const id of ["material", "labour"]) {
      assert.ok(byId(n, `driver-${id}`), `${id} is not listed as evidence`);
    }
  });

  test("the supplier is named where one is given, and not invented where not", () => {
    assert.match(byId(caseOf(sourced(), new Set(), { supplier: "Northgate (synthetic)" }),
      "requested").said, /^Northgate \(synthetic\) has asked/);
    assert.match(byId(caseOf(sourced()), "requested").said, /^The supplier has asked/);
  });

  test("a contractual cap is mentioned when one applied", () => {
    const capped = sourced({ constraints: { cap: p("3") } });
    const n = caseOf(capped);
    if (capped.constraintApplied) {
      assert.ok(byId(n, "constraint"), "a constraint applied and went unmentioned");
      assert.match(byId(n, "constraint").said, /what the contract permits are not the same figure/);
    }
    assert.ok(capped.constraintApplied, "the fixture did not actually trigger a constraint");
  });
});

/* ------------------------------------------------- it survives a projection */

describe("through a view", () => {
  test("a technical view of a settled case shows every figure", () => {
    const b = sourced();
    const view = project(caseOf(b), { role: ROLE.BUYER, depth: DEPTH.TECHNICAL });
    assert.equal(view.hidden.length, 0);
    assert.equal(view.claims.find((c) => c.id === "annual").figure.minor,
      b.annual.requested.minor);
  });

  test("and no view restores a figure the case withheld", () => {
    /* The two rules meeting: the projection selects, and what it selects from
       has already had its unsettled figures removed. */
    const b = costBridge({
      baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
      requestedChange: p("9"),
      drivers: [{ id: "m", label: "Steel", weight: p("42"), indexMovement: p("10"),
                  source: "synthetic-index-A" }],
    });
    const n = caseOf(b);
    for (const role of [ROLE.JUNIOR, ROLE.BUYER, ROLE.HEAD]) {
      for (const depth of [DEPTH.GUIDED, DEPTH.STANDARD, DEPTH.TECHNICAL]) {
        for (const c of project(n, { role, depth }).claims) {
          assert.equal(c.figure, null, `${role}/${depth} showed ${c.id}`);
        }
      }
    }
  });
});

/** This module's own source, for the claim that it does no arithmetic. */
function readSource() {
  return readFileSync("src/case/from-quote.mjs", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}
import { readFileSync } from "node:fs";
