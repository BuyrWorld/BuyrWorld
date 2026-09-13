/**
 * The negotiation panel, executed rather than grepped.
 *
 * Checking that `defNegotiationHTML` appears in the file proves nothing about
 * whether it runs. These tests lift the function out of the page, give it a
 * real bridge and a stub DOM, and read the HTML it produces — so a renamed
 * field or a `.toFixed` on a BigInt fails here instead of in front of a user.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { costBridge, formatPercent } from "../../src/calc/cost-bridge.mjs";
import { assessEvidence, evidence, EVIDENCE_KIND } from "../../src/calc/evidence.mjs";
import { prepareNegotiation, CREDIBILITY } from "../../src/calc/negotiation.mjs";
import { supplierHistory } from "../../src/calc/supplier-history.mjs";
import { recordOutcome } from "../../src/calc/outcome.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString } from "../../src/calc/exact.mjs";

const html = readFileSync("index.html", "utf8");

describe("the panel is wired into the page", () => {
  test("the engine is imported and mounted", () => {
    assert.match(html, /from "\.\/src\/calc\/negotiation\.mjs"/);
    const mount = (html.match(/window\.BW\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
    assert.match(mount, /prepareNegotiation/);
    assert.match(mount, /CREDIBILITY/);
  });

  test("defRender actually calls it", () => {
    assert.match(html, /\+defNegotiationHTML\(r,cur\)/,
      "a panel nothing calls is a panel nobody sees");
  });

  test("the position inputs exist and are named for a screen reader", () => {
    for (const id of ["def-alts", "def-qual", "def-notice", "def-switch", "def-crit"]) {
      assert.match(html, new RegExp(`id="${id}"`), `${id} is missing`);
      const labelled = new RegExp(`<label[^>]*>[^<]{3,80}<(input|select)[^>]*id="${id}"`);
      assert.match(html.replace(/\n/g, " "), labelled, `${id} has no visible label`);
    }
  });

  test("no arithmetic is done in the page — the engine owns every figure", () => {
    const fn = html.slice(html.indexOf("function defNegotiationHTML"), html.indexOf("\nfunction defRender(r,cur){"));
    assert.ok(fn.length > 500, "the function was not found");
    assert.equal(/parseFloat|parseInt\([^)]*\)\s*[*/+-]|Number\([^)]*\)\s*[*/]/.test(fn), false,
      "a figure was computed in the page instead of by the engine");
  });
});

describe("the panel renders a real case", () => {
  let out = "";
  const money = (x) => moneyFromDecimal(x, "GBP");

  before(() => {
    /* £100 a unit, 50,000 a year, 9% asked, 5.10% warranted, so £195,000 a year
       is in dispute. No driver carries evidence, so the hard line is 0.00%. */
    const bridge = costBridge({
      baseline: { unitPrice: money("100.00"), annualVolume: 50_000 },
      requestedChange: pc("9"),
      drivers: [
        { id: "material", label: "Steel bar", weight: pc("42"), indexMovement: pc("10") },
        { id: "labour", label: "Labour", weight: pc("18"), indexMovement: pc("5") },
      ],
    });

    const fields = {
      "def-alts": "2", "def-qual": "26", "def-notice": "12",
      "def-switch": "390000", "def-crit": "standard", "def-currency": "GBP",
    };

    const sandbox = {
      window: {
        BW: {
          prepareNegotiation, CREDIBILITY, formatPercent, moneyToDecimalString,
          assessEvidence, moneyFromDecimal,
        },
      },
      document: {
        getElementById: (id) => (id in fields ? { value: fields[id] } : null),
      },
      // The page's own escaper, so output is escaped exactly as it is live.
      ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
      console,
    };

    const src = html.slice(html.indexOf("function defPosition()"), html.indexOf("\nfunction defRender(r,cur){"));
    vm.createContext(sandbox);
    new vm.Script(src + "\n;globalThis.__OUT__ = defNegotiationHTML(__BRIDGE__, 'GBP');")
      .runInContext(Object.assign(sandbox, { __BRIDGE__: bridge }));
    out = sandbox.__OUT__;
  });

  test("it produces a panel rather than an empty string", () => {
    assert.ok(out && out.length > 800, `panel was ${out.length} chars — the function bailed out`);
    assert.match(out, /Negotiation plan/);
  });

  test("the three anchors are on it, with the disputed amount named", () => {
    assert.match(out, /Open at/);
    assert.match(out, /Their ask/);
    assert.match(out, /195000\.00/, "the money actually in dispute must be stated");
    assert.match(out, /9\.00%/);
    assert.match(out, /5\.10%/);
  });

  test("the hard line is shown as below the warranted figure", () => {
    assert.match(out, /Hard line/);
    assert.match(out, /255000\.00 a year below the warranted figure/);
  });

  test("every concession step is priced and marked a choice, not a finding", () => {
    assert.match(out, /48750\.00/);      // a quarter
    assert.match(out, /97500\.00/);      // a half
    assert.match(out, /146250\.00/);     // three quarters
    assert.equal((out.match(/a choice/g) || []).length, 4, "four of five steps are choices");
    assert.equal((out.match(/evidenced</g) || []).length, 1, "only holding is evidenced");
  });

  test("challenges are ordered by what they are worth", () => {
    assert.ok(out.indexOf("210000.00") < out.indexOf("45000.00"),
      "the bigger recovery must be raised first");
  });

  test("the walk-away verdict reflects the inputs", () => {
    // Qualification is 26 weeks against 12 weeks' notice, so it cannot be done.
    assert.match(out, /Walking away is <span[^>]*>not-credible/);
    assert.match(out, /cannot be ready before supply stops/);
  });

  test("the breakeven is shown and labelled assumed", () => {
    assert.match(out, /pays back in about <b>2\.0 years<\/b>/);
    assert.match(out, /assumed<\/span>, because nobody has quoted an alternative/);
  });

  test("a point worth nothing says so rather than showing a flattering figure", () => {
    assert.match(out, /nothing to recover &mdash; already treated as zero/);
  });

  test("the rule it worked to is printed", () => {
    assert.match(out, /commercial choice/);
  });

  test("no BigInt or object leaked into the markup", () => {
    assert.equal(/\[object Object\]|undefined|NaN|\d+n\b/.test(out), false,
      "a raw value reached the page");
  });
});

describe("the supplier's record opens the plan", () => {
  const money = (x) => moneyFromDecimal(x, "GBP");
  const DRIVERS = [
    { id: "steel", label: "Steel bar", weight: pc("40"), indexMovement: pc("10"),
      evidence: { weight: evidence(EVIDENCE_KIND.DOCUMENT, { label: "breakdown", quote: "40%" }),
                  movement: evidence(EVIDENCE_KIND.PUBLISHED, { label: "synthetic index" }) } },
    { id: "freight", label: "Freight", weight: pc("12"), indexMovement: pc("10") },
  ];

  const past = (at, requested, agreed) => recordOutcome({
    bridge: costBridge({
      baseline: { unitPrice: money("100.00"), annualVolume: 50_000 },
      requestedChange: pc(requested), drivers: DRIVERS,
    }),
    agreedChange: pc(agreed),
    argumentsUsed: [{ id: "base-period", description: "Challenged the base period", worked: true }],
    meta: { supplier: "Meridian Fabrication Ltd", recordedAt: at, caseRef: "C-" + at },
  });

  /** Run defHistoryHTML with a given supplier field and stored corpus. */
  function render(supplierName, stored) {
    const sandbox = {
      window: { BW: { supplierHistory, loadOutcomes: () => stored, formatPercent, moneyToDecimalString } },
      document: { getElementById: (id) => (id === "def-supplier" ? { value: supplierName } : null) },
      ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
      console,
    };
    const src = html.slice(html.indexOf("function defHistoryHTML()"), html.indexOf("\nfunction defNegotiationHTML(r,cur){"));
    vm.createContext(sandbox);
    new vm.Script(src + "\n;globalThis.__H__ = defHistoryHTML();").runInContext(sandbox);
    return sandbox.__H__;
  }

  test("it is rendered at the top of the plan, before the anchors", () => {
    assert.match(html, /Negotiation plan<\/div>'\s*\n?\s*\+defHistoryHTML\(\)/,
      "the record must come before the anchors it changes the reading of");
  });

  test("two rounds produce a record with both of them in it", () => {
    const out = render("Meridian Fabrication Ltd", [past("2024-03", "8", "6.5"), past("2025-04", "7", "5.2")]);
    assert.match(out, /Their record/);
    assert.match(out, /2 claims recorded/);
    assert.match(out, /2024-03/);
    assert.match(out, /2025-04/);
  });

  test("a driver claimed every round and never evidenced is called out", () => {
    const out = render("Meridian Fabrication Ltd", [past("2024-03", "8", "6.5"), past("2025-04", "7", "5.2")]);
    assert.match(out, /Claimed every round and never evidenced: <b>Freight<\/b>/);
    assert.equal(/never evidenced: <b>[^<]*Steel/.test(out), false,
      "steel carries evidence and must not be tarred with it");
  });

  test("what has worked against this supplier is shown with its record", () => {
    const out = render("Meridian Fabrication Ltd", [past("2024-03", "8", "6.5"), past("2025-04", "7", "5.2")]);
    assert.match(out, /Has worked against this supplier: Challenged the base period \(2 of 2\)/);
  });

  test("conceding above the evidence is priced, and a clean round is not", () => {
    const out = render("Meridian Fabrication Ltd", [past("2024-03", "8", "6.5"), past("2025-04", "7", "5.2")]);
    assert.match(out, /GBP 65000\.00/, "1.30% of £5m conceded above the evidence in 2024");
    assert.match(out, /&mdash;/, "the round that landed on the evidence shows a dash, not a zero");
  });

  test("a different supplier gets nothing, not someone else's record", () => {
    const out = render("Someone Else Ltd", [past("2024-03", "8", "6.5")]);
    assert.equal(/Their record/.test(out), false);
    assert.match(out, /No previous claims recorded for Someone Else Ltd/);
    assert.match(out, /absence of records, not an absence of claims/);
  });

  test("an empty corpus renders nothing at all", () => {
    assert.equal(render("Meridian Fabrication Ltd", []), "",
      "a first-time case must not be cluttered by a feature it cannot use yet");
  });

  test("no supplier named renders nothing", () => {
    assert.equal(render("", [past("2024-03", "8", "6.5")]), "");
  });

  test("a broken store is survived rather than taking the panel down", () => {
    const sandbox = {
      window: { BW: { supplierHistory, loadOutcomes: () => { throw new Error("storage blocked"); },
                      formatPercent, moneyToDecimalString } },
      document: { getElementById: () => ({ value: "Meridian Fabrication Ltd" }) },
      ciEsc: (x) => String(x), console,
    };
    const src = html.slice(html.indexOf("function defHistoryHTML()"), html.indexOf("\nfunction defNegotiationHTML(r,cur){"));
    vm.createContext(sandbox);
    new vm.Script(src + "\n;globalThis.__H__ = defHistoryHTML();").runInContext(sandbox);
    assert.equal(sandbox.__H__, "");
  });

  test("nothing raw reaches the page", () => {
    const out = render("Meridian Fabrication Ltd", [past("2024-03", "8", "6.5"), past("2025-04", "7", "5.2")]);
    assert.equal(/\[object Object\]|undefined|NaN|\d+n\b/.test(out), false);
  });
});
