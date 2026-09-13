/**
 * The workspace dashboard, executed against the page's own code.
 *
 * Two things are worth testing here and one of them is unusual.
 *
 * The obvious one: every figure must come from an engine, because a dashboard
 * is exactly where a plausible invented number would never be questioned.
 *
 * The unusual one: the empty state. On a fresh browser there are no cases and
 * no outcomes, and that is the state most people will see first. It has to say
 * what is missing and offer the action that fixes it, rather than showing
 * zeroes that read as findings.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { costBridge, formatPercent } from "../../src/calc/cost-bridge.mjs";
import { recordOutcome } from "../../src/calc/outcome.mjs";
import { portfolio } from "../../src/calc/portfolio.mjs";
import { learningCorpus, whatWorks, captureGaps } from "../../src/calc/learning.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString } from "../../src/calc/exact.mjs";

const html = readFileSync("index.html", "utf8");

const DRIVERS = [{ id: "steel", label: "Steel bar", weight: pc("40"), indexMovement: pc("10") }];
const bridge = () => costBridge({
  baseline: { unitPrice: moneyFromDecimal("100.00", "GBP"), annualVolume: 50_000 },
  requestedChange: pc("9"), drivers: DRIVERS,
});

const outcome = (at, agreed = "9") => recordOutcome({
  bridge: bridge(), agreedChange: pc(agreed),
  argumentsUsed: [{
    id: "f", description: "Challenged the freight component", worked: true,
    evidenceRequested: "carrier invoices", supplierResponse: "none provided",
  }],
  meta: { supplier: "Meridian Fabrication Ltd", recordedAt: at, caseId: "case_" + at },
});

const openCase = (ref, status = "analysed") => ({
  id: "c-" + ref, ref, supplier: "Meridian Fabrication Ltd", status,
  updatedAt: "2026-09-13T10:00:00Z",
  summary: { annualUnsupportedMinor: 250_000_00n, currency: "GBP" },
});

/** Run the page's dashboard over a stub DOM. */
function render({ outcomes = [], cases = [] } = {}) {
  const out = { innerHTML: "" };
  const sandbox = {
    document: { getElementById: (id) => (id === "dash-out" ? out : null) },
    window: {
      BW: {
        portfolio, learningCorpus, whatWorks, captureGaps,
        formatPercent, moneyToDecimalString,
        loadOutcomes: () => outcomes,
        loadCases: () => cases,
        listCases: () => cases,
      },
    },
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    console,
  };
  // defPortfolio lives just above the dashboard and is what it reads from.
  const src = html.slice(html.indexOf("function defPortfolio(){"), html.indexOf("\nfunction defHistoryHTML(){"));
  vm.createContext(sandbox);
  new vm.Script(src + "\n;renderDash();").runInContext(sandbox);
  return out.innerHTML;
}

describe("it is wired in", () => {
  test("the route exists and is in the navigation", () => {
    assert.match(html, /<div class="page" id="page-dash">/);
    assert.match(html, /\["dash","Workspace"\]/);
    assert.match(html, /\n  dash:'<path/, "a destination without an icon falls back");
  });

  test("it renders when the route is opened", () => {
    assert.match(html, /p==="dash"&&typeof renderDash==="function"/);
  });

  test("the public home page was left alone", () => {
    // The north star wants the site and the workspace distinct, and warns off a
    // routing rewrite. A new destination achieves it without touching what works.
    assert.match(html, /<div class="page on" id="page-home">/);
    assert.match(html, /id="pillars"/);
    assert.match(html, /id="features"/);
  });

  test("no arithmetic happens in the page", () => {
    const fn = html.slice(html.indexOf("function dashPanel("), html.indexOf("\nfunction defHistoryHTML(){"));
    assert.ok(fn.length > 1000);
    assert.equal(/parseFloat|toFixed|\*\s*100|\/\s*100/.test(fn), false,
      "a dashboard is where an invented figure would never be questioned");
  });

  test("it adds no inline handlers", () => {
    const page = html.slice(html.indexOf('id="page-dash"'), html.indexOf("<!-- ============ INBOX"));
    assert.equal(/\son(click|change|input)=/.test(page), false);
  });
});

describe("the empty state is the design", () => {
  const out = render();

  test("nothing reads as a finding", () => {
    assert.equal(/0\.00%/.test(out), false, "a zero rate would look like a measurement");
    assert.equal(/£0\.00|GBP 0\.00/.test(out), false);
  });

  test("each panel says what is missing, in the engine's own words", () => {
    assert.match(out, /No case is open/);
    assert.match(out, /No outcomes recorded yet/);
    assert.match(out, /No supplier has a recorded outcome yet/);
    assert.match(out, /Nothing can be learned from a negotiation nobody described/);
  });

  test("each panel offers the action that would fix it", () => {
    assert.match(out, /data-go="inbox"/);
    assert.match(out, /data-go="tool-defender"/);
  });

  test("all four panels are present even when empty", () => {
    for (const t of ["Needs attention", "Your position", "Suppliers", "What works"]) {
      assert.match(out, new RegExp(t));
    }
  });
});

describe("with cases open", () => {
  const out = render({ cases: [openCase("SC-001"), openCase("SC-002", "draft")] });

  test("they are listed with their stage", () => {
    assert.match(out, /SC-001/);
    assert.match(out, /SC-002/);
    assert.match(out, /bw-status--review/);
  });

  test("the count is on the panel head", () => {
    assert.match(out, /2 open/);
  });

  test("a closed case is not competing for attention", () => {
    const closed = render({ cases: [openCase("SC-003", "closed")] });
    assert.match(closed, /No case is open/);
  });

  test("exposure still in dispute is shown against the open cases", () => {
    assert.match(out, /In dispute now/);
    assert.match(out, /GBP 500000\.00/);   // two cases at £250,000
  });
});

describe("with outcomes recorded", () => {
  const outcomes = [outcome("2024-01", "9"), outcome("2025-01", "4"), outcome("2026-01", "6.5")];
  const out = render({ outcomes, cases: [openCase("SC-001", "closed")] });

  test("the resisted rate leads, with the amounts behind it", () => {
    assert.match(out, /Unevidenced ask resisted/);
    assert.match(out, /GBP \d+\.\d\d of \d+\.\d\d/);
  });

  test("suppliers are listed by what was conceded", () => {
    assert.match(out, /Meridian Fabrication Ltd/);
    assert.match(out, /Conceded unevidenced/);
  });

  test("patterns carry their denominator and a thin one says so", () => {
    assert.match(out, /worked 3 of 3 recorded time\(s\)/);
    assert.match(out, /Asked for: carrier invoices/);
  });

  test("coverage qualifies the number in warning colour", () => {
    // Three outcomes against one analysed case is not a track record either way;
    // whichever side it falls, the qualifier must be legible.
    const thin = render({ outcomes, cases: [openCase("SC-1", "analysed"), openCase("SC-2", "closed")] });
    assert.match(thin, /not yet a track record/);
    assert.match(thin, /var\(--bw-warning\)/);
  });
});

describe("it stays honest and safe", () => {
  test("no card exists for a capability that does not", () => {
    // The reference shows a savings tracker, market signals tied to live
    // positions, and an opportunity radar. None can be answered from the data,
    // so none is rendered rather than being filled with plausible numbers.
    const out = render({ outcomes: [outcome("2025-01")] });
    for (const absent of ["Savings Tracker", "Opportunity Radar", "Market Signals"]) {
      assert.equal(out.includes(absent), false, `${absent} has no data behind it and must not appear`);
    }
  });

  test("a supplier name carrying markup is escaped", () => {
    const evil = { ...openCase("SC-001"), supplier: '<img src=x onerror="alert(1)">' };
    const out = render({ cases: [evil] });
    assert.equal(/<img src=x/.test(out), false);
    assert.match(out, /&lt;img/);
  });

  test("a store that throws leaves the page standing", () => {
    const sandbox = {
      document: { getElementById: () => ({ innerHTML: "" }) },
      window: { BW: { portfolio, learningCorpus, whatWorks, captureGaps,
        loadOutcomes() { throw new Error("blocked"); },
        loadCases() { throw new Error("blocked"); },
        listCases() { throw new Error("blocked"); } } },
      ciEsc: String, attrEsc: String, console,
    };
    const src = html.slice(html.indexOf("function defPortfolio(){"), html.indexOf("\nfunction defHistoryHTML(){"));
    vm.createContext(sandbox);
    assert.doesNotThrow(() => new vm.Script(src + "\n;renderDash();").runInContext(sandbox));
  });

  test("nothing raw reaches the markup", () => {
    const out = render({ outcomes: [outcome("2025-01")], cases: [openCase("SC-001")] });
    assert.equal(/\[object Object\]|undefined|NaN|\d+n\b/.test(out), false);
  });

  test("the page says where the data came from", () => {
    assert.match(html, /computed from the cases and outcomes stored in this browser/);
    assert.match(html, /nothing is carried over from anyone else/);
  });
});
