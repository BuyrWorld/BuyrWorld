/**
 * The two sections that were screen-only until now.
 *
 * The pack is the artefact that leaves the building — printed, attached to an
 * approval, read in a meeting. It said what was warranted and stopped short of
 * what to do about it and what this supplier did last time. These tests check
 * both halves reach the page, in the right order, without a figure being
 * restated differently from the screen.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { costBridge, formatPercent as P } from "../../src/calc/cost-bridge.mjs";
import { buildDecisionPack } from "../../src/calc/decision-pack.mjs";
import { renderDecisionPackHTML } from "../../src/render/decision-pack-html.mjs";
import { recordOutcome } from "../../src/calc/outcome.mjs";
import { supplierHistory } from "../../src/calc/supplier-history.mjs";
import { evidence, EVIDENCE_KIND as K } from "../../src/calc/evidence.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";

const gbp = (x) => moneyFromDecimal(x, "GBP");

/* £100 a unit, 50,000 a year. Steel 40% x 10% = 4.00% warranted against a
   9.00% ask, so 5pp — £250,000 a year — is unsupported. */
const STEEL = { id: "steel", label: "Steel bar", weight: pc("40"), indexMovement: pc("10") };
const FREIGHT = { id: "freight", label: "Freight", weight: pc("12"), indexMovement: pc("10") };

const bridgeFor = (requested = "9", drivers = [STEEL]) => costBridge({
  baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
  requestedChange: pc(requested),
  drivers,
});

const packFor = (extra = {}) => buildDecisionPack({
  meta: { caseId: "SC-001", supplier: "Meridian Fabrication Ltd", synthetic: true },
  bridge: bridgeFor(),
  generatedAt: "2026-09-13T00:00:00Z",
  ...extra,
});

/* Steel carries evidence in the past rounds and freight never does, so the
   repeat-driver flag has something to discriminate between. */
const STEEL_EV = {
  ...STEEL,
  evidence: {
    weight: evidence(K.DOCUMENT, { label: "cost breakdown", quote: "steel is 40% of unit cost" }),
    movement: evidence(K.PUBLISHED, { label: "synthetic index" }),
  },
};

const past = (at, requested, agreed) => recordOutcome({
  bridge: bridgeFor(requested, [STEEL_EV, FREIGHT]),
  agreedChange: pc(agreed),
  argumentsUsed: [{ id: "base-period", description: "Challenged the base period", worked: true }],
  meta: { supplier: "Meridian Fabrication Ltd", recordedAt: at, caseRef: "C-" + at },
});

const HISTORY = supplierHistory(
  [past("2024-03", "8", "6.5"), past("2025-04", "7", "5.2")],
  "Meridian Fabrication Ltd"
);

describe("the pack now carries the position", () => {
  const pack = packFor();

  test("a negotiation is built from the same bridge and evidence", () => {
    assert.ok(pack.negotiation, "the pack stopped at what was warranted before this");
    assert.equal(P(pack.negotiation.openingPosition.target), "4.00%");
    assert.equal(str(pack.negotiation.anchors.inDispute), "250000.00");
  });

  test("it agrees with the summary rather than restating it differently", () => {
    assert.equal(pack.negotiation.anchors.inDispute.minor, pack.summary.annualUnsupported.minor);
    assert.equal(pack.negotiation.openingPosition.target, pack.summary.warranted);
  });

  test("the sourcing position reaches it", () => {
    const p = packFor({ position: { alternatives: 2, qualificationWeeks: 26, noticePeriodWeeks: 12 } });
    assert.equal(p.negotiation.walkAway.credibility, "not-credible");
  });

  test("history is carried when given and null when not", () => {
    assert.equal(packFor().history, null);
    assert.equal(packFor({ history: HISTORY }).history.count, 2);
  });

  test("the pack does not go looking for history itself", () => {
    // It takes what it is given: this module has no business knowing where
    // cases are stored, and a pack built in a test must not read a browser.
    assert.equal(packFor().history, null);
  });
});

describe("the rendered document", () => {
  const html = renderDecisionPackHTML(packFor({ history: HISTORY }));

  test("both new sections are present", () => {
    assert.match(html, /<h2>Their record<\/h2>/);
    assert.match(html, /<h2>Negotiating position<\/h2>/);
  });

  test("their record comes before the executive summary", () => {
    // A reader who meets a pattern of over-asking on page two has already
    // formed a view of the figures above it.
    assert.ok(html.indexOf("Their record") < html.indexOf("Executive summary"));
  });

  test("the position comes after the options and before the assumptions", () => {
    assert.ok(html.indexOf("<h2>Options</h2>") < html.indexOf("Negotiating position"));
    assert.ok(html.indexOf("Negotiating position") < html.indexOf("Assumptions to verify"));
  });

  test("the three anchors are in one table", () => {
    assert.match(html, /Open at &mdash; the hard line/);
    assert.match(html, /Target &mdash; what the evidence supports/);
    assert.match(html, /Their ask/);
    assert.match(html, /9\.00%/);
    assert.match(html, /4\.00%/);
  });

  test("the disputed amount is stated in money and percentage", () => {
    assert.match(html, /In dispute: GBP 250000\.00 a year \(5\.00%\)/);
  });

  test("each ladder step says whether it is evidenced or a choice", () => {
    assert.match(html, /<b>\(evidenced\)<\/b>/);
    assert.match(html, /\(a choice\)/);
    assert.equal((html.match(/\(a choice\)/g) || []).length, 4, "four of five steps are choices");
  });

  test("deferral is priced alongside the money positions", () => {
    assert.match(html, /Deferral instead of money/);
    assert.match(html, /3 months: GBP \d/);
  });

  test("the walk-away verdict carries its rule", () => {
    assert.match(html, /<h3>Walking away is unknown<\/h3>/);
    assert.match(html, /No sourcing position was supplied/);
  });

  test("the rule it worked to is printed, not just the conclusion", () => {
    assert.match(html, /commercial choice/);
  });
});

describe("their record, rendered", () => {
  const html = renderDecisionPackHTML(packFor({ history: HISTORY }));

  test("every round is a row", () => {
    assert.match(html, /2024-03/);
    assert.match(html, /2025-04/);
  });

  test("conceding above the evidence is priced, and a clean round is a dash", () => {
    assert.match(html, /GBP 65000\.00/);
    assert.match(html, /&mdash;/);
  });

  test("a driver claimed every round and never evidenced is called out in red", () => {
    assert.match(html, /class="gap-material"><b>Claimed every round and never evidenced:<\/b> Freight/);
    assert.equal(/never evidenced:<\/b>[^<.]*Steel/.test(html), false,
      "steel carried evidence and must not be tarred with it");
  });

  test("what has worked against this supplier is carried through", () => {
    assert.match(html, /Has worked against this supplier:.*Challenged the base period \(2 of 2\)/);
  });

  test("the method note travels with it", () => {
    assert.match(html, /history, not a forecast/);
  });

  test("no history means no section at all, rather than an empty one", () => {
    const bare = renderDecisionPackHTML(packFor());
    assert.equal(/Their record/.test(bare), false);
    assert.match(bare, /<h2>Negotiating position<\/h2>/, "the position does not depend on history");
  });

  test("a supplier with no recorded claims is not given an empty table", () => {
    const none = supplierHistory([], "Meridian Fabrication Ltd");
    assert.equal(/Their record/.test(renderDecisionPackHTML(packFor({ history: none }))), false);
  });
});

describe("it stays a document", () => {
  const html = renderDecisionPackHTML(packFor({ history: HISTORY }));

  test("every new table can scroll rather than pushing the page sideways", () => {
    const tables = (html.match(/<table>/g) || []).length;
    const wrapped = (html.match(/<div class="tw"><table>/g) || []).length;
    assert.equal(wrapped, tables, "a table wider than a phone must scroll inside its own box");
  });

  test("the document is still self-contained and declares its language", () => {
    assert.match(html, /<html lang="en">/);
    assert.equal(/<script|src="http/.test(html), false);
  });

  test("a supplier name carrying markup cannot escape", () => {
    const p = buildDecisionPack({
      meta: { caseId: "SC-1", supplier: '<img src=x onerror="alert(1)">', synthetic: true },
      bridge: bridgeFor(),
      history: supplierHistory(
        [recordOutcome({
          bridge: bridgeFor("8", [STEEL, FREIGHT]), agreedChange: pc("7"),
          meta: { supplier: '<img src=x onerror="alert(1)">', recordedAt: "2025-01" },
        })],
        '<img src=x onerror="alert(1)">'
      ),
      generatedAt: "2026-09-13T00:00:00Z",
    });
    const out = renderDecisionPackHTML(p);
    assert.equal(/<img src=x/.test(out), false);
    assert.match(out, /&lt;img/);
  });

  test("nothing raw reaches the document", () => {
    assert.equal(/\[object Object\]|undefined|NaN|\d+n\b/.test(html), false);
  });
});
