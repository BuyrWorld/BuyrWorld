/**
 * The decision pack carries the work that used to be screen-only.
 *
 * A finding that cannot leave the tool is not evidence in the decision — it
 * is something a person remembers seeing. Two things were in that position:
 * what an independent build-up says about the structure the claim rests on,
 * and how the supplier's material has actually reviewed out.
 *
 * The rule that governs both: neither may change a figure. The build-up
 * challenges an input to the warranted calculation and does not replace its
 * answer, and a quality record has no bearing on what is warranted at all.
 * So the tests that matter most here are the ones proving the numbers are
 * untouched.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ratioFromPercent, moneyFromDecimal, ratioToPercentString } from "../../src/calc/exact.mjs";
import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { buildDecisionPack } from "../../src/calc/decision-pack.mjs";
import { renderDecisionPackHTML } from "../../src/render/decision-pack-html.mjs";
import { BASIS } from "../../src/calc/should-cost.mjs";
import {
  lotRecord, producerRecord, DECISION, RESPONSIBILITY, SCOPE,
} from "../../src/calc/mill.mjs";

const pc = ratioFromPercent;
const gbp = (v) => moneyFromDecimal(v, "GBP", null);

/** A claim: material 75% moved 8%, labour 25% moved 3%. */
const bridge = () => costBridge({
  baseline: { unitPrice: gbp("10.00"), annualVolume: 100000 },
  requestedChange: pc(9),
  drivers: [
    { id: "material", label: "Material", weight: pc(75), indexMovement: pc(8), provenance: "supplied" },
    { id: "labour", label: "Labour", weight: pc(25), indexMovement: pc(3), provenance: "supplied" },
  ],
});

/** A build-up: material 60%, manufacturing 40%. */
const COST = (over = {}) => ({
  ok: true,
  complete: over.complete !== false,
  missing: over.missing ?? [],
  currency: "GBP",
  confidence: over.confidence ?? "quote-backed",
  lines: [
    { id: "stock", label: "Raw stock", amount: gbp("6000.00"), signed: 600000n, oneTime: false, credit: false, quality: BASIS.QUOTED, basis: "quoted sheet price", note: null },
    { id: "manufacturing", label: "Manufacturing", amount: gbp("4000.00"), signed: 400000n, oneTime: false, credit: false, quality: BASIS.QUOTED, basis: "quoted", note: null },
  ],
});

const MAP = { material: "stock", labour: "manufacturing" };

let seq = 0;
const lot = (over = {}) => lotRecord({
  lotKey: `northgate|h-${++seq}|l-1`,
  producer: "Northgate Steelworks (synthetic)",
  grade: "FG-300", form: "plate", specification: "SYN-SPEC-100",
  decision: DECISION.CONFORMING, scope: SCOPE.FULL,
  firstSubmissionComplete: true, reviewedAt: "2026-06-01",
  ...over,
});
const bad = (over = {}) => lot({
  decision: DECISION.NONCONFORMING,
  nonconformities: [{ category: "chemistry out of limit", responsibility: RESPONSIBILITY.PRODUCER }],
  ...over,
});

const quality = () => producerRecord(
  [...Array.from({ length: 7 }, () => lot()), bad(), bad()], { minimumLots: 5 });

const pack = (over = {}) => buildDecisionPack({
  meta: { caseId: "SYN-001", supplier: "Northgate Steelworks (synthetic)", synthetic: true },
  bridge: bridge(),
  generatedAt: "2026-09-15 09:00",
  ...over,
});

/* ------------------------------------------------- nothing changes silently */

describe("neither section may move a figure", () => {
  const plain = () => pack();
  const withBoth = () => pack({ buildUp: { cost: COST(), map: MAP }, supplyQuality: quality() });

  test("the warranted change is identical with and without a build-up", () => {
    assert.equal(withBoth().summary.warranted, plain().summary.warranted);
    assert.equal(withBoth().summary.unsupported, plain().summary.unsupported);
    assert.equal(withBoth().summary.annualUnsupported.minor, plain().summary.annualUnsupported.minor);
  });

  test("the scenarios are identical", () => {
    const a = plain().scenarios, b = withBoth().scenarios;
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i].change, b[i].change, `${a[i].id} changed`);
      assert.equal(a[i].annualCost.minor, b[i].annualCost.minor, `${a[i].id} annual changed`);
    }
  });

  test("the recommendation is identical", () => {
    assert.equal(withBoth().recommendation.action, plain().recommendation.action);
  });

  test("the decomposition is untouched — the claimed weights still stand", () => {
    const material = withBoth().decomposition.find((c) => c.id === "material");
    assert.equal(material.weight, pc(75), "the pack still reports what the supplier claimed");
  });
});

/* ------------------------------------------------------------ the build-up */

describe("what the build-up adds", () => {
  const p = () => pack({ buildUp: { cost: COST(), map: MAP, name: "Bracket BRK-A-102" } });

  test("the comparison is a section of the pack", () => {
    const st = p().structure;
    assert.equal(st.available, true);
    assert.equal(st.name, "Bracket BRK-A-102");
    assert.equal(st.comparison.rows.length, 2);
  });

  test("the questions travel with it, so a reader can use them in the room", () => {
    assert.ok(p().structure.questions.length >= 1);
    assert.match(p().structure.questions[0].question, /What accounts for the 15\.0% difference\?/);
  });

  test("the gap becomes an uncertainty about the warranted figure", () => {
    const u = p().uncertainties.join(" ");
    assert.match(u, /Material is claimed at 75\.00%/);
    assert.match(u, /build-up puts Raw stock at 60\.00%/);
    assert.match(u, /The warranted figure above accepts the claimed weight/);
  });

  test("the uncertainty prices the gap where the driver actually moved", () => {
    assert.match(p().uncertainties.join(" "), /worth 1\.20% of the increase requested/);
  });

  test("the build-up is named as a source, with how strong it is", () => {
    const src = p().sources.find((x) => x.kind === "own-cost-model");
    assert.ok(src);
    assert.match(src.detail, /Bracket BRK-A-102/);
    assert.match(src.detail, /quote-backed/);
  });

  test("no build-up means no section, and the pack is as it was", () => {
    assert.equal(pack().structure, null);
    assert.equal(pack().sources.some((x) => x.kind === "own-cost-model"), false);
  });

  test("an incomplete build-up produces a section that says why, not a comparison", () => {
    const st = pack({
      buildUp: {
        cost: COST({ complete: false, missing: [{ id: "freight", label: "Freight and packaging" }] }),
        map: MAP, name: "Half-done",
      },
    }).structure;
    assert.equal(st.available, false);
    assert.match(st.why, /number about the wrong total/);
  });

  test("a build-up with no mapping says there is nothing to compare", () => {
    const st = pack({ buildUp: { cost: COST(), map: {} } }).structure;
    assert.equal(st.available, true);
    assert.match(st.comparison.statement, /nothing to compare/);
  });

  test("a partial comparison carries its caveat into the uncertainties", () => {
    const u = pack({ buildUp: { cost: COST(), map: { material: "stock" } } }).uncertainties.join(" ");
    assert.match(u, /limit of the build-up, not evidence about the claim/);
  });
});

/* -------------------------------------------------------- the quality record */

describe("what the quality record adds", () => {
  const p = () => pack({ supplyQuality: quality() });

  test("it is a section of the pack", () => {
    assert.equal(p().supplyQuality.lots, 9);
    assert.equal(p().supplyQuality.conformity.numerator, 7);
    assert.equal(p().supplyQuality.conformity.denominator, 9);
  });

  test("it is named as a source, carrying its numerator and denominator", () => {
    const src = p().sources.find((x) => x.kind === "reviewed-lots");
    assert.ok(src);
    assert.match(src.detail, /7 of 9 reviewed lots/);
  });

  test("it does not become an uncertainty about the price", () => {
    // Quality is not doubt about the arithmetic. Putting it there would imply
    // the warranted figure is less certain because the material was poor.
    assert.equal(/conform/i.test(p().uncertainties.join(" ")), false);
  });

  test("no record means no section", () => {
    assert.equal(pack().supplyQuality, null);
    assert.equal(pack().sources.some((x) => x.kind === "reviewed-lots"), false);
  });
});

/* ---------------------------------------------------------------- rendering */

describe("both reach the rendered document", () => {
  const html = () => renderDecisionPackHTML(pack({
    buildUp: { cost: COST(), map: MAP, name: "Bracket BRK-A-102" },
    supplyQuality: quality(),
  }));

  test("the build-up renders with both figures and the difference", () => {
    const out = html();
    assert.match(out, /Their cost structure/);
    assert.match(out, /75\.00%/);
    assert.match(out, /60\.00%/);
    assert.match(out, /1\.20%/);
  });

  test("the build-up sits immediately after the decomposition it is about", () => {
    // Not before the summary, where the supplier's history goes: a reader
    // cannot read a table comparing claimed weights before seeing them. And
    // not after the position, by which point the weights are already
    // accepted.
    const out = html();
    const heads = [...out.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
    assert.equal(heads[heads.indexOf("Claim decomposition") + 1], "Their cost structure");
    assert.ok(heads.indexOf("Their cost structure") < heads.indexOf("Negotiating position"));
  });

  test("the quality record sits with the position, where a reader is deciding", () => {
    const heads = [...html().matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
    assert.equal(heads[heads.indexOf("Negotiating position") + 1], "Their quality record");
  });

  test("the framing survives into the document, not just into the object", () => {
    const out = html();
    assert.match(out, /what you think the part costs, not what it costs them/);
    assert.match(out, /never a finding against one/);
  });

  test("the questions are in the document", () => {
    assert.match(html(), /Ask them/);
    assert.match(html(), /What accounts for the 15\.0% difference\?/);
  });

  test("the quality record renders with its evidence beside each figure", () => {
    const out = html();
    assert.match(out, /Their quality record/);
    assert.match(out, /Reviewed-lot conformity/);
    assert.match(out, /7 of 9 reviewed lots/);
    assert.match(out, /chemistry out of limit/);
  });

  test("the quality section says what it does not mean", () => {
    const out = html();
    assert.match(out, /not a forecast of the next delivery/);
    assert.match(out, /may still be\s+entitled to a justified increase/);
  });

  test("a record below the evidence threshold renders no percentage", () => {
    const thin = producerRecord([lot(), bad()], { minimumLots: 5 });
    const out = renderDecisionPackHTML(pack({ supplyQuality: thin }));
    assert.match(out, /not shown/);
    assert.equal(/50\.0%/.test(out), false, "a percentage below the threshold reached the document");
  });

  test("neither section appears when there is nothing to say", () => {
    const out = renderDecisionPackHTML(pack());
    assert.equal(/Their cost structure/.test(out), false);
    assert.equal(/Their quality record/.test(out), false);
  });

  test("a build-up name carrying markup does not reach the document raw", () => {
    const out = renderDecisionPackHTML(pack({
      buildUp: { cost: COST({ complete: false, missing: [{ id: "x", label: "X" }] }), map: MAP, name: '<img src=x onerror="alert(1)">' },
    }));
    assert.equal(/<img src=x/.test(out), false);
    assert.match(out, /&lt;img/);
  });

  test("nothing raw reaches the document", () => {
    assert.equal(/\[object Object\]|undefined|NaN|\d+n\b/.test(html()), false);
  });
});
