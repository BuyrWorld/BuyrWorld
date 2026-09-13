/**
 * The portfolio view, executed against the page's own code.
 *
 * The risk this guards is not a crash. It is a page that shows a confident
 * resisted rate with no indication that it rests on two cases out of eleven —
 * an aggregate that hides its own thinness reads as a track record. So these
 * tests check the qualifier is on screen as firmly as the number.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { costBridge, formatPercent } from "../../src/calc/cost-bridge.mjs";
import { recordOutcome, summariseOutcomes } from "../../src/calc/outcome.mjs";
import { portfolio } from "../../src/calc/portfolio.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString } from "../../src/calc/exact.mjs";

const html = readFileSync("index.html", "utf8");

const DRIVERS = [{ id: "steel", label: "Steel bar", weight: pc("40"), indexMovement: pc("10") }];
const outcome = (requested, agreed, supplier = "Meridian Fabrication Ltd") => recordOutcome({
  bridge: costBridge({
    baseline: { unitPrice: moneyFromDecimal("100.00", "GBP"), annualVolume: 50_000 },
    requestedChange: pc(requested), drivers: DRIVERS,
  }),
  agreedChange: pc(agreed),
  meta: { supplier, recordedAt: "2026-01", caseRef: "C-1" },
});

const caseRec = (status, summary = null) => ({ id: "c" + Math.random(), status, summary });

/** Run the page's portfolio functions over a given corpus. */
function render(outcomes, cases) {
  const sandbox = {
    window: {
      BW: {
        portfolio, formatPercent, moneyToDecimalString, summariseOutcomes,
        loadOutcomes: () => outcomes,
        loadCases: () => cases,
      },
    },
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    console,
  };
  const src = html.slice(html.indexOf("function defPortfolio(){"), html.indexOf("\nfunction defHistoryHTML(){"));
  vm.createContext(sandbox);
  new vm.Script(src + "\n;globalThis.__FULL__ = defPortfolioHTML();\n;globalThis.__LINE__ = defPortfolioLineHTML();")
    .runInContext(sandbox);
  return { full: sandbox.__FULL__, line: sandbox.__LINE__ };
}

describe("it is wired in", () => {
  test("the engine is imported and mounted", () => {
    assert.match(html, /from "\.\/src\/calc\/portfolio\.mjs"/);
    const mount = (html.match(/window\.BW\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
    assert.match(mount, /\bportfolio\b/);
    assert.match(mount, /\bloadCases\b/, "the portfolio cannot see open cases without it");
  });

  test("the full view renders above the recorded outcomes", () => {
    assert.match(html, /host\.innerHTML=pf\+'<div class="card"/);
  });

  test("a glanceable line sits on the case list, where a person lands", () => {
    assert.match(html, /\+defPortfolioLineHTML\(\)/);
  });

  test("a calculated case stores its figures for the in-flight total", () => {
    assert.match(html, /annualUnsupportedMinor:_defResult\.annual\.unsupported\.minor/);
  });

  test("the two step-5 headings introduced earlier were renumbered", () => {
    assert.equal((html.match(/>5 &middot; /g) || []).length, 1, "two sections numbered 5 is a defect");
    assert.match(html, />6 &middot; Record what was agreed/);
  });
});

describe("with outcomes recorded", () => {
  let out;
  before(() => {
    // Two cases: one resisted in full, one conceded in full. Pooled: 50%.
    out = render([outcome("9", "4"), outcome("9", "9")], [caseRec("closed"), caseRec("closed")]);
  });

  test("the resisted rate leads, with the amounts behind it", () => {
    assert.match(out.full, /Resisted \(GBP\)/);
    assert.match(out.full, /50\.00%/);
    assert.match(out.full, /GBP 250000\.00 kept of 500000\.00 unevidenced/);
  });

  test("how settlements landed is stated both ways", () => {
    assert.match(out.full, /at or below the evidenced position <b[^>]*>1<\/b>/);
    assert.match(out.full, /above it <b[^>]*>1<\/b>/);
    assert.match(out.full, /1 conceded in full/);
  });

  test("suppliers are listed with what was conceded", () => {
    assert.match(out.full, /Where the money went/);
    assert.match(out.full, /Meridian Fabrication Ltd/);
  });

  test("the method is on the page, not hidden", () => {
    assert.match(out.full, /capped per case/);
    assert.match(out.full, /never added across them/);
  });

  test("the glanceable line carries the rate", () => {
    // The rate is emphasised, so the figure and its words are not contiguous.
    assert.match(out.line, /<b[^>]*>50\.00%<\/b> of the unevidenced ask resisted/);
  });
});

describe("coverage is never separated from the number", () => {
  test("a thin corpus says so on screen, in warning colour", () => {
    const cases = [...Array.from({ length: 9 }, () => caseRec("analysed")), caseRec("closed"), caseRec("closed")];
    const out = render([outcome("9", "4"), outcome("9", "4")], cases);
    assert.match(out.full, /Based on 2 of 11 analysed case\(s\)/);
    assert.match(out.full, /not yet a track record/);
    assert.match(out.full, /#FFB800/, "the qualifier must not be quiet grey next to a lime headline");
  });

  test("a complete corpus is not apologised for", () => {
    const out = render([outcome("9", "4")], [caseRec("closed")]);
    assert.equal(/not yet a track record/.test(out.full), false);
  });

  test("open cases with no figures are declared rather than counted as zero", () => {
    const out = render([outcome("9", "4")], [caseRec("closed"), caseRec("analysed")]);
    assert.match(out.full, /1 open case\(s\) have not been calculated and contribute no figure/);
  });
});

describe("exposure still in dispute", () => {
  test("it is totalled from the cases that carry figures", () => {
    const out = render(
      [outcome("9", "4")],
      [caseRec("closed"), caseRec("analysed", { annualUnsupportedMinor: 250_000_00n, currency: "GBP" })]
    );
    assert.match(out.full, /In dispute now/);
    assert.match(out.full, /GBP 250000\.00/);
    assert.match(out.line, /GBP 250000\.00 still in dispute/);
  });
});

describe("an empty corpus", () => {
  test("it says what is missing rather than showing zeroes", () => {
    const out = render([], []);
    assert.match(out.full, /No outcomes recorded yet/);
    assert.match(out.full, /until a case is closed/);
    assert.equal(/0\.00%/.test(out.full), false, "a zero rate would read as a result");
  });

  test("the glanceable line stays out of the way entirely", () => {
    assert.equal(render([], []).line, "");
  });

  test("open cases are still reported when nothing is closed", () => {
    const out = render([], [caseRec("draft"), caseRec("analysed")]);
    assert.match(out.full, /2 case\(s\) open/);
  });
});

describe("it survives what it cannot read", () => {
  test("a store that throws does not take the panel down", () => {
    const sandbox = {
      window: {
        BW: {
          portfolio, formatPercent, moneyToDecimalString, summariseOutcomes,
          loadOutcomes: () => { throw new Error("blocked"); },
          loadCases: () => { throw new Error("blocked"); },
        },
      },
      ciEsc: (x) => String(x), console,
    };
    const src = html.slice(html.indexOf("function defPortfolio(){"), html.indexOf("\nfunction defHistoryHTML(){"));
    vm.createContext(sandbox);
    new vm.Script(src + "\n;globalThis.__F__ = defPortfolioHTML();").runInContext(sandbox);
    assert.match(sandbox.__F__, /No outcomes recorded yet/);
  });

  test("a supplier name carrying markup is escaped", () => {
    const out = render([outcome("9", "9", '<img src=x onerror="alert(1)">')], [caseRec("closed")]);
    assert.equal(/<img src=x/.test(out.full), false);
    assert.match(out.full, /&lt;img/);
  });

  test("nothing raw reaches the markup", () => {
    const out = render([outcome("9", "6")], [caseRec("closed")]);
    assert.equal(/\[object Object\]|undefined|NaN|\d+n\b/.test(out.full), false);
  });
});
