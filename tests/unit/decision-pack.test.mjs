import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { costBridge, formatPercent as P } from "../../src/calc/cost-bridge.mjs";
import { buildDecisionPack, ACTION } from "../../src/calc/decision-pack.mjs";
import { renderDecisionPackHTML } from "../../src/render/decision-pack-html.mjs";
import { evidence, EVIDENCE_KIND as K, contractConstraint, supplierClaim } from "../../src/calc/evidence.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";
import { STEEL_A } from "../../src/data/sample-indices.mjs";

const gbp = (x) => moneyFromDecimal(x, "GBP");

function bridgeFor(over = {}) {
  return costBridge({
    baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
    requestedChange: pc("9"),
    drivers: [
      { id: "material", label: "Steel bar", weight: pc("42"), indexMovement: pc("10") },
      { id: "labour", label: "Labour", weight: pc("18"), indexMovement: pc("5") },
    ],
    ...over,
  });
}
const packFor = (over = {}, extra = {}) =>
  buildDecisionPack({ meta: { caseId: "T-1", supplier: "Fictional Ltd" }, bridge: bridgeFor(over), generatedAt: "2026-09-12T00:00:00Z", ...extra });

describe("the recommendation is a rule, not a judgement", () => {
  test("a contract contradiction outranks everything", () => {
    const p = packFor({}, {
      evidenceInput: {
        claims: [supplierClaim({ id: "q", mechanism: "quarterly-indexation", quote: "quarterly indexation applies" })],
        constraints: [contractConstraint({ id: "k", governs: "quarterly-indexation", permits: false,
          evidence: evidence(K.CONTRACT, { label: "agreement", clause: "7.2" }) })],
      },
    });
    assert.equal(p.recommendation.action, ACTION.ESCALATE);
    assert.match(p.recommendation.because, /mechanism the supplied contract does not support/);
    assert.match(p.summary.headline, /contractual basis .* is disputed/);
  });

  test("material evidence gaps outrank the arithmetic", () => {
    const p = packFor();
    assert.equal(p.recommendation.action, ACTION.REQUEST_EVIDENCE);
    assert.match(p.recommendation.because, /material evidence gap/);
  });

  test("with evidence in place, it counters at the warranted figure", () => {
    const p = packFor({
      drivers: [{
        id: "material", label: "Steel bar", weight: pc("100"), indexMovement: pc("5"),
        evidence: {
          weight: evidence(K.DOCUMENT, { label: "breakdown", quote: "100% material" }),
          movement: evidence(K.PUBLISHED, { label: "synthetic index" }),
        },
      }],
    });
    assert.equal(p.recommendation.action, ACTION.COUNTER);
    assert.match(p.recommendation.because, /4\.00% of the request is unsupported/);
  });

  test("a fully supported claim is recommended for acceptance", () => {
    const p = packFor({
      requestedChange: pc("5"),
      drivers: [{
        id: "m", label: "Steel", weight: pc("100"), indexMovement: pc("5"),
        evidence: {
          weight: evidence(K.DOCUMENT, { label: "breakdown", quote: "100% material" }),
          movement: evidence(K.PUBLISHED, { label: "synthetic index" }),
        },
      }],
    });
    assert.equal(p.recommendation.action, ACTION.ACCEPT);
    assert.match(p.recommendation.because, /supports the request in full/);
  });

  test("an under-asking supplier is not talked into asking for more", () => {
    const p = packFor({
      requestedChange: pc("2"),
      drivers: [{
        id: "m", label: "Steel", weight: pc("100"), indexMovement: pc("5"),
        evidence: {
          weight: evidence(K.DOCUMENT, { label: "breakdown", quote: "100% material" }),
          movement: evidence(K.PUBLISHED, { label: "synthetic index" }),
        },
      }],
    });
    assert.equal(p.recommendation.action, ACTION.ACCEPT);
    const opt = p.options.find((o) => o.action === ACTION.ACCEPT);
    assert.match(opt.whatWouldChangeThis, /Do not volunteer the difference/);
  });

  test("the rule that fired is stated, so a reviewer can argue with it", () => {
    const p = packFor();
    assert.match(p.recommendation.rule, /contradiction > material gap > unsupported/);
    assert.equal(p.recommendation.notLegalAdvice, true);
  });
});

describe("scenarios", () => {
  test("a midpoint appears only when there is a gap to split", () => {
    const withGap = packFor();
    assert.ok(withGap.scenarios.some((s) => s.id === "midpoint"));

    const noGap = packFor({
      requestedChange: pc("5"),
      drivers: [{ id: "m", label: "Steel", weight: pc("100"), indexMovement: pc("5") }],
    });
    assert.equal(noGap.scenarios.some((s) => s.id === "midpoint"), false,
      "splitting the difference is meaningless when there is no difference");
  });

  test("scenario costs match the bridge exactly", () => {
    const b = bridgeFor();
    const p = buildDecisionPack({ bridge: b });
    const warranted = p.scenarios.find((s) => s.id === "warranted");
    const requested = p.scenarios.find((s) => s.id === "requested");
    assert.equal(warranted.annualCost.minor, b.annual.warranted.minor);
    assert.equal(requested.annualCost.minor, b.annual.requested.minor);
  });

  test("the midpoint is labelled a negotiating position, not an evidenced one", () => {
    const p = packFor();
    const mid = p.scenarios.find((s) => s.id === "midpoint");
    assert.match(mid.basis, /negotiating position, not an evidenced one/);
  });
});

describe("options carry what a reviewer needs", () => {
  test("every option states impact, confidence and what would change it", () => {
    const p = packFor();
    assert.ok(p.options.length > 0);
    for (const o of p.options) {
      assert.ok(o.financialImpact?.annual, `${o.action} has no financial impact`);
      assert.ok(["high", "medium", "low"].includes(o.confidence), `${o.action} confidence`);
      assert.ok(o.whatWouldChangeThis, `${o.action} does not say what would change it`);
    }
  });

  test("the recommended action appears among the options", () => {
    const p = packFor();
    assert.ok(p.options.some((o) => o.action === p.recommendation.action));
  });
});

describe("the pack refuses to overstate itself", () => {
  test("it is never pre-approved", () => {
    const p = packFor();
    assert.equal(p.approval.state, "not-approved");
    assert.equal(p.approval.by, null);
    assert.match(p.approval.note, /not approved until a person with spend authority/);
  });

  test("it disclaims legal advice", () => {
    assert.match(packFor().disclaimer, /not legal advice/);
  });

  test("uncertainties are listed rather than smoothed over", () => {
    const p = packFor({ period: { retrospectiveMonths: 4 } });
    assert.ok(p.uncertainties.length >= 2);
    assert.ok(p.uncertainties.some((u) => /not attributed to any driver/.test(u)));
    assert.ok(p.uncertainties.some((u) => /Retrospective volume is estimated/.test(u)));
  });

  test("a clean case still says so explicitly", () => {
    const p = packFor({
      requestedChange: pc("5"),
      drivers: [{
        id: "m", label: "Steel", weight: pc("100"), indexMovement: pc("5"),
        evidence: {
          weight: evidence(K.DOCUMENT, { label: "breakdown", quote: "100% material" }),
          movement: evidence(K.PUBLISHED, { label: "synthetic index" }),
        },
      }],
    });
    assert.deepEqual(p.uncertainties, ["No material uncertainties identified by this analysis."]);
  });

  test("demonstration data is flagged by default", () => {
    assert.equal(packFor().meta.synthetic, true);
  });
});

describe("every figure has a source", () => {
  test("an index-derived movement appears in the appendix with its lineage", () => {
    const b = costBridge({
      baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
      requestedChange: pc("9"),
      drivers: [{
        id: "material", label: "Steel bar", weight: pc("42"),
        index: { series: STEEL_A, contractualBasePeriod: "2025-01", measurePeriod: "2026-06", lagMonths: 3 },
      }],
    });
    const p = buildDecisionPack({ bridge: b });
    const src = p.sources.find((s) => /Steel bar movement/.test(s.for));
    assert.ok(src, "the movement must be sourced");
    assert.match(src.detail, /Synthetic Steel Index A/);
    assert.match(src.detail, /3-month lag/);
  });

  test("a quoted passage appears with its locator", () => {
    const p = packFor({
      drivers: [{
        id: "material", label: "Steel", weight: pc("42"), indexMovement: pc("10"),
        evidence: { weight: evidence(K.DOCUMENT, { label: "cost breakdown", quote: "42% of ex-works", locator: "p2" }) },
      }],
    });
    const src = p.sources.find((s) => s.kind === "document-passage");
    assert.ok(src);
    assert.match(src.detail, /cost breakdown, p2: "42% of ex-works"/);
  });

  test("no sources at all is reported as a finding, not hidden", () => {
    const html = renderDecisionPackHTML(buildDecisionPack({
      bridge: costBridge({
        baseline: { unitPrice: gbp("10.00"), annualVolume: 100 },
        requestedChange: pc("5"),
        drivers: [{ id: "m", label: "M", weight: pc("50"), indexMovement: pc("4") }],
      }),
    }));
    assert.match(html, /No sources were attached to this analysis, which is itself a finding/);
  });
});

describe("rendering", () => {
  const html = renderDecisionPackHTML(packFor({ period: { retrospectiveMonths: 4 } }));

  test("all eleven sections are present", () => {
    for (const h of ["Executive summary", "Recommended action", "Baseline", "Claim decomposition",
      "Evidence", "Scenario comparison", "Options", "Assumptions", "Uncertainties",
      "Source appendix", "Approval record"]) {
      assert.ok(html.includes(`<h2>${h}</h2>`), `missing section: ${h}`);
    }
  });

  test("untrusted content is escaped, never executed", () => {
    const nasty = renderDecisionPackHTML(buildDecisionPack({
      meta: { caseId: "X", supplier: `Evil" onload="alert(1)` },
      bridge: costBridge({
        baseline: { unitPrice: gbp("10.00"), annualVolume: 100 },
        requestedChange: pc("5"),
        drivers: [{
          id: "m", label: "<img src=x onerror=alert(1)>", weight: pc("50"), indexMovement: pc("4"),
          evidence: { weight: evidence(K.DOCUMENT, { label: "doc", quote: "<script>alert(1)</script>" }) },
        }],
      }),
    }));
    assert.equal(nasty.includes("<img src=x"), false, "markup in a driver label must be escaped");
    assert.equal(nasty.includes("<script>alert"), false, "markup in a quote must be escaped");
    assert.equal(nasty.includes(`Evil" onload=`), false, "quotes in a supplier name must be escaped");
    assert.match(nasty, /&lt;img src=x/);
  });

  test("it carries the print stylesheet and no external requests", () => {
    assert.match(html, /@page \{/, "must be print-clean");
    assert.equal(/<link[^>]+href="http/.test(html), false, "no external stylesheets");
    assert.equal(/<script/.test(html.replace(/&lt;script/g, "")), false, "the pack runs no code");
  });

  test("it states that no language model produced a figure", () => {
    assert.match(html, /No language model produced any number\s+in this document/);
  });

  test("the synthetic banner appears for demonstration data", () => {
    assert.match(html, /Synthetic demonstration data/);
  });
});
