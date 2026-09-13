/**
 * Closing the loop, executed against the page's own code.
 *
 * Two things are checked that a grep cannot: that an argument row actually
 * captures the two fields which make a record teachable, and that recording an
 * outcome links it back to the case it resolved. `linkOutcome` has existed
 * since case-store was written and had never been called.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { recordOutcome } from "../../src/calc/outcome.mjs";
import { learningCorpus, whatWorks, captureGaps } from "../../src/calc/learning.mjs";
import { formatPercent } from "../../src/calc/cost-bridge.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString } from "../../src/calc/exact.mjs";
import { supplierId } from "../../src/domain/ids.mjs";

const html = readFileSync("index.html", "utf8");

describe("the capture records what makes a note teachable", () => {
  test("an argument row carries evidence requested and supplier response", () => {
    assert.match(html, /placeholder="Evidence you asked for"/);
    assert.match(html, /placeholder="What the supplier did"/);
  });

  test("both new fields have accessible names, not just placeholders", () => {
    for (const label of ["Evidence you asked for", "What the supplier did"]) {
      assert.match(html, new RegExp(`aria-label="${label}"`));
    }
  });

  test("they reach the recorded outcome", () => {
    assert.match(html, /evidenceRequested:\(a\[2\]\|\|""\)\.trim\(\)\|\|null/);
    assert.match(html, /supplierResponse:\(a\[3\]\|\|""\)\.trim\(\)\|\|null/);
  });

  test("the row is delegated rather than adding inline handlers", () => {
    // A guard test caps inline handlers and only lets the number fall. Adding
    // two capture fields would have pushed it up.
    const fn = html.slice(html.indexOf("function ocRenderArgs()"), html.indexOf("function ocAddArg()"));
    assert.equal(/\son(input|change)=/.test(fn), false, "the row must not carry inline handlers");
    assert.match(fn, /host\.addEventListener\("input",sync\)/);
    assert.match(fn, /host\.addEventListener\("change",sync\)/);
  });

  test("an empty row has four slots, so a rebuild does not lose a field", () => {
    assert.match(html, /_ocArgs=\[\["","","",""\]\]/);
    assert.match(html, /_ocArgs\.push\(\["","","",""\]\)/);
  });
});

describe("the delegated listener", () => {
  function run(events) {
    const rows = [["", "", "", ""]];
    const listeners = {};
    const host = {
      dataset: {},
      innerHTML: "",
      addEventListener: (type, fn) => { listeners[type] = fn; },
    };
    const sandbox = {
      document: { getElementById: (id) => (id === "oc-args" ? host : null) },
      _ocArgs: rows,
      attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
      console,
    };
    const src = html.slice(html.indexOf("function ocRenderArgs()"), html.indexOf("function ocMsg("));
    vm.createContext(sandbox);
    new vm.Script(src + "\n;ocRenderArgs();").runInContext(sandbox);
    for (const e of events) listeners[e.type]({ target: e.target });
    return sandbox._ocArgs;
  }

  test("each field writes to its own slot", () => {
    const rows = run([
      { type: "input", target: { dataset: { arg: "0", field: "0" }, value: "Challenged freight" } },
      { type: "change", target: { dataset: { arg: "0", field: "1" }, value: "yes" } },
      { type: "input", target: { dataset: { arg: "0", field: "2" }, value: "carrier invoices" } },
      { type: "input", target: { dataset: { arg: "0", field: "3" }, value: "none provided" } },
    ]);
    assert.deepEqual([...rows[0]], ["Challenged freight", "yes", "carrier invoices", "none provided"]);
  });

  test("an event from something else in the panel is ignored", () => {
    const rows = run([{ type: "input", target: { dataset: {}, value: "stray" } }]);
    assert.deepEqual([...rows[0]], ["", "", "", ""]);
  });

  test("an event naming a row that is gone does not throw", () => {
    const rows = run([{ type: "input", target: { dataset: { arg: "7", field: "0" }, value: "x" } }]);
    assert.deepEqual([...rows[0]], ["", "", "", ""]);
  });

  test("the listener is attached once, not on every re-render", () => {
    const host = { dataset: {}, innerHTML: "", addEventListener() { host.attached = (host.attached ?? 0) + 1; } };
    const sandbox = {
      document: { getElementById: () => host },
      _ocArgs: [["", "", "", ""]],
      attrEsc: (x) => String(x), console,
    };
    const src = html.slice(html.indexOf("function ocRenderArgs()"), html.indexOf("function ocMsg("));
    vm.createContext(sandbox);
    new vm.Script(src + "\n;ocRenderArgs();ocRenderArgs();ocRenderArgs();").runInContext(sandbox);
    assert.equal(host.attached, 2, "one input listener and one change listener, once");
  });
});

describe("the outcome names its case", () => {
  test("the open case id is carried into the record", () => {
    assert.match(html, /caseId:_defCaseId\|\|null/);
  });

  test("and the case is told it was resolved", () => {
    assert.match(html, /window\.BW\.linkOutcome\(_defCaseId,rec\.id\)/);
    assert.match(html, /Linked to the saved case/);
  });

  test("linkOutcome is exposed, having never been called before", () => {
    const mount = (html.match(/window\.BW\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
    assert.match(mount, /linkOutcome/);
  });

  test("an outcome recorded with no open case still saves", () => {
    // The link is a bonus, not a precondition: refusing to record an outcome
    // because nobody saved the case first would lose the observation.
    const o = recordOutcome({
      bridge: costBridge({
        baseline: { unitPrice: moneyFromDecimal("100.00", "GBP"), annualVolume: 50_000 },
        requestedChange: pc("9"), drivers: [{ id: "s", label: "Steel", weight: pc("40"), indexMovement: pc("10") }],
      }),
      agreedChange: pc("6"),
      meta: { supplier: "Meridian Fabrication Ltd", recordedAt: "2026-01" },
    });
    assert.equal(o.meta.caseId, null);
    assert.ok(o.id, "it still has an identity for a learning record to point at");
  });
});

describe("what has worked is rendered with its sample size", () => {
  const DRIVERS = [{ id: "steel", label: "Steel bar", weight: pc("40"), indexMovement: pc("10") }];
  const outcome = (at) => recordOutcome({
    bridge: costBridge({
      baseline: { unitPrice: moneyFromDecimal("100.00", "GBP"), annualVolume: 50_000 },
      requestedChange: pc("9"), drivers: DRIVERS,
    }),
    agreedChange: pc("6"),
    argumentsUsed: [{
      id: "f", description: "Challenged the freight component", worked: true,
      evidenceRequested: "carrier invoices", supplierResponse: "none provided",
    }],
    meta: { supplier: "Meridian Fabrication Ltd", recordedAt: at, caseId: "case_" + at },
  });

  function render(outcomes) {
    const sandbox = {
      window: {
        BW: { learningCorpus, whatWorks, captureGaps, formatPercent, moneyToDecimalString, loadOutcomes: () => outcomes },
      },
      ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
      console,
    };
    const src = html.slice(html.indexOf("function defLearningHTML(sid)"), html.indexOf("\nfunction defHistoryHTML(){"));
    vm.createContext(sandbox);
    new vm.Script(src + `\n;globalThis.__OUT__ = defLearningHTML("${supplierId("Meridian Fabrication Ltd")}");`)
      .runInContext(sandbox);
    return sandbox.__OUT__;
  }

  test("three observations render as a pattern with its denominator", () => {
    const out = render([outcome("2024-01"), outcome("2025-01"), outcome("2026-01")]);
    assert.match(out, /What has worked against them/);
    assert.match(out, /worked 3 of 3 recorded time\(s\)/);
    assert.match(out, /Asked for: carrier invoices/);
  });

  test("one observation is shown but flagged thin, never as a percentage", () => {
    const out = render([outcome("2025-01")]);
    assert.match(out, /too few to lean on/);
    assert.match(out, />thin</);
    assert.equal(/100\.00%/.test(out), false, "a perfect rate on one case must not read as a fact");
  });

  test("an empty corpus renders nothing rather than an empty panel", () => {
    assert.equal(render([]), "");
  });

  test("a store that throws does not take the record down", () => {
    const sandbox = {
      window: { BW: { learningCorpus, whatWorks, captureGaps, loadOutcomes: () => { throw new Error("blocked"); } } },
      ciEsc: String, console,
    };
    const src = html.slice(html.indexOf("function defLearningHTML(sid)"), html.indexOf("\nfunction defHistoryHTML(){"));
    vm.createContext(sandbox);
    new vm.Script(src + '\n;globalThis.__O__ = defLearningHTML("sup_x");').runInContext(sandbox);
    assert.equal(sandbox.__O__, "");
  });

  test("nothing raw reaches the markup", () => {
    const out = render([outcome("2024-01"), outcome("2025-01"), outcome("2026-01")]);
    assert.equal(/\[object Object\]|undefined|NaN|\d+n\b/.test(out), false);
  });
});
