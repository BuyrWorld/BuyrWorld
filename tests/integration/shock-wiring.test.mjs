/**
 * The cost-shock simulator, executed against the page's own code.
 *
 * This was the last arithmetic a user reads that nothing checked: parseFloat on
 * money, float multiplication, toFixed on a ratio. The tests below run the
 * rewritten runSim over a stub DOM and read the markup, so a figure computed in
 * the page rather than the engine fails here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { mapExposure, costShock, shareFrom, parseAmount } from "../../src/calc/shock.mjs";
import { parseSpendCsv } from "../../src/calc/spend.mjs";
import { formatPercent } from "../../src/calc/cost-bridge.mjs";
import { money, scaleDiv, moneyToDecimalString } from "../../src/calc/exact.mjs";

const html = readFileSync("index.html", "utf8");

/** Sliders with a name, an exposure in minor units, and a position. */
function makeSliders(rows) {
  return rows.map((r, i) => ({
    id: "sim-r" + i, type: "range", value: String(r.shock),
    dataset: { name: r.name, val: String(r.minor) },
  }));
}

function run({ sliders, exp = null, typed = "" }) {
  const out = { innerHTML: "" };
  const els = new Map([["mi-sim-out", out], ["sim-total", { value: typed }]]);
  const sandbox = {
    document: {
      getElementById: (id) => els.get(id) ?? null,
      querySelectorAll: () => sliders,
    },
    window: {
      BW: {
        mapExposure, costShock, shareFrom, parseAmount, parseSpendCsv,
        formatPercent, money, scaleDiv, moneyToDecimalString,
      },
    },
    MI: { exp },
    miStamp: () => "2026-09-13",
    miShowExports() {},
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    console,
  };
  const src = html.slice(html.indexOf("function runSim(){"), html.indexOf("\n// ---- Exports ----"));
  vm.createContext(sandbox);
  new vm.Script(src + "\n;runSim();").runInContext(sandbox);
  return { html: out.innerHTML, MI: sandbox.MI };
}

const EXP = {
  currency: "GBP",
  total: money(500_000_00n, "GBP", null),
  expArr: [["Steel", money(240_000_00n, "GBP", null)], ["Energy", money(160_000_00n, "GBP", null)]],
};

describe("it is wired to the engine", () => {
  test("the engine is imported and mounted", () => {
    assert.match(html, /from "\.\/src\/calc\/shock\.mjs"/);
    const mount = (html.match(/window\.BW\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
    for (const name of ["mapExposure", "costShock", "shareFrom", "parseAmount"]) {
      assert.match(mount, new RegExp(name), `${name} is not exposed`);
    }
  });

  test("no float arithmetic survives in the simulator", () => {
    const fn = html.slice(html.indexOf("function runSim(){"), html.indexOf("\n// ---- Exports ----"));
    assert.ok(fn.length > 500, "runSim was not found");
    // Comments are stripped first: a comment explaining why parseFloat is gone
    // is not parseFloat, and scanning raw text fails on its own explanation.
    const code = fn.replace(/^\s*\/\/.*$/gm, "");
    assert.equal(/parseFloat|toFixed/.test(code), false, "a float computation is still in the page");
    assert.match(fn, /parseFloat would take "50k" as 50/, "and the reason is recorded");
  });

  test("miParse reads through the exact parser rather than its own copy", () => {
    const fn = html.slice(html.indexOf("function miParse(raw){"), html.indexOf("\nasync function runExposure(){"));
    assert.match(fn, /window\.BW\.parseSpendCsv/);
    assert.equal(/parseFloat/.test(fn), false, 'parseFloat reads "12abc" as 12');
  });

  test("the slider carries exact minor units, not a float string", () => {
    assert.match(html, /data-val="\$\{MI\.exp\?v\.minor:0\}"/);
  });
});

describe("modelling a shock", () => {
  const sliders = makeSliders([
    { name: "Steel", minor: 240_000_00n, shock: 10 },
    { name: "Energy", minor: 160_000_00n, shock: -5 },
  ]);

  test("the total is exact and carries its currency", () => {
    // 10% of 240,000 is 24,000; -5% of 160,000 is -8,000.
    const { html: out } = run({ sliders, exp: EXP });
    assert.match(out, /\+GBP 16000\.00/);
  });

  test("each line is priced", () => {
    const { html: out } = run({ sliders, exp: EXP });
    assert.match(out, /GBP 24000\.00/);
    assert.match(out, /-GBP 8000\.00|GBP -8000\.00/);
  });

  test("the share of analysed spend is an exact percentage, not a toFixed", () => {
    const { html: out } = run({ sliders, exp: EXP });
    assert.match(out, /3\.20% of GBP 500000\.00 analysed spend/);
  });

  test("the result is labelled assumed and says what it is not", () => {
    const { html: out } = run({ sliders, exp: EXP });
    assert.match(out, /Assumed\.<\/span>/);
    assert.match(out, /not a forecast of either/);
  });

  test("a falling market reads as a decrease, not a red number", () => {
    const { html: out } = run({
      sliders: makeSliders([{ name: "Energy", minor: 160_000_00n, shock: -5 }]), exp: EXP,
    });
    assert.match(out, /Falling input costs/);
    assert.equal(/\+GBP/.test(out), false);
  });

  test("moving nothing asks for a slider rather than reporting zero", () => {
    const { html: out } = run({ sliders: makeSliders([{ name: "Steel", minor: 1n, shock: 0 }]), exp: EXP });
    assert.match(out, /Move at least one slider/);
  });

  test("the biggest mover is listed first", () => {
    const { html: out } = run({
      sliders: makeSliders([
        { name: "Small", minor: 1_000_00n, shock: 10 },
        { name: "BigFall", minor: 100_000_00n, shock: -10 },
      ]),
      exp: EXP,
    });
    assert.ok(out.indexOf("BigFall") < out.indexOf("Small"));
  });
});

describe("the manual spend entry", () => {
  const sliders = makeSliders([
    { name: "Steel", minor: 0n, shock: 10 },
    { name: "Energy", minor: 0n, shock: 10 },
  ]);

  test("a plain amount is read exactly and split across the sliders", () => {
    const { html: out } = run({ sliders, typed: "£500,000" });
    // 500,000 over two sliders is 250,000 each; 10% of each is 25,000.
    assert.match(out, /GBP 25000\.00/);
    assert.match(out, /\+GBP 50000\.00/);
  });

  test("something unreadable asks again rather than modelling nonsense", () => {
    // parseFloat("50k") is 50, which would have produced a confident wrong answer.
    const { html: out } = run({ sliders, typed: "50k" });
    assert.match(out, /Enter your annual spend first/);
    assert.match(out, /as a plain amount/);
  });

  test("an empty entry is refused too", () => {
    assert.match(run({ sliders, typed: "" }).html, /Enter your annual spend first/);
  });
});

describe("what it stores for the export", () => {
  test("the figures kept are Money, not floats", () => {
    const { MI } = run({
      sliders: makeSliders([{ name: "Steel", minor: 240_000_00n, shock: 10 }]), exp: EXP,
    });
    assert.equal(typeof MI.sim.totalImpact.minor, "bigint");
    assert.equal(typeof MI.sim.baseTotal.minor, "bigint");
    assert.equal(typeof MI.sim.shareOfBase, "bigint");
  });
});

describe("it stays safe", () => {
  test("a commodity name carrying markup is escaped", () => {
    const { html: out } = run({
      sliders: makeSliders([{ name: '<img src=x onerror="alert(1)">', minor: 1_000_00n, shock: 5 }]),
      exp: EXP,
    });
    assert.equal(/<img src=x/.test(out), false);
    assert.match(out, /&lt;img/);
  });

  test("nothing raw reaches the markup", () => {
    const { html: out } = run({
      sliders: makeSliders([{ name: "Steel", minor: 240_000_00n, shock: 10 }]), exp: EXP,
    });
    assert.equal(/\[object Object\]|undefined|NaN|\d+n\b/.test(out), false);
  });
});
