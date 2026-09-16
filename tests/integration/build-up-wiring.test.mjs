/**
 * The join, executed against the page's own code.
 *
 * The whole loop in one place: a build-up is saved on one page and picked up
 * on the other, a mapping is chosen by hand, and the claim's weights are put
 * beside the build-up's shares.
 *
 * Three ways the page could betray the engine's care:
 *
 *   - guessing the mapping, which would be guessing the argument;
 *   - showing a comparison against an estimate that still has gaps, which
 *     would be a share of the wrong total;
 *   - rendering the difference as a verdict rather than a question.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource, fnSource as pageFnSource } from "../helpers/page.mjs";

import { ratioFromPercent, ratioToPercentString, moneyFromDecimal } from "../../src/calc/exact.mjs";
import { BASIS } from "../../src/calc/should-cost.mjs";
import { MATERIAL_GAP, buildUpShares, compareToBuildUp, questionsFrom } from "../../src/calc/build-up.mjs";
import {
  estimateFrom, asCostPlan, saveEstimate, loadEstimates, loadEstimate,
  deleteEstimate, storeStatus as estimateStoreStatus,
} from "../../src/services/estimate-store.mjs";

const html = pageSource();

/** The page's own source for one function. `html` is this file's copy of the page. */
const fnSource = (name) => pageFnSource(name, html);


function fakeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const gbp = (v) => moneyFromDecimal(v, "GBP", null);
const pc = ratioFromPercent;

/** 60% material, 40% manufacturing, of £10,000. */
const COST = (over = {}) => ({
  ok: true,
  complete: over.complete !== false,
  missing: over.missing ?? [],
  currency: "GBP",
  confidence: over.confidence ?? "quote-backed",
  lines: over.lines ?? [
    { id: "stock", label: "Raw stock", amount: gbp("6000.00"), signed: 600000n, oneTime: false, credit: false, quality: BASIS.QUOTED, basis: "quoted sheet price", note: null },
    { id: "manufacturing", label: "Manufacturing", amount: gbp("4000.00"), signed: 400000n, oneTime: false, credit: false, quality: BASIS.QUOTED, basis: "quoted", note: null },
  ],
});
const PLAN = { ok: true, quantities: { acceptedPartsRequired: 1000n } };

/** A costBridge-shaped result: material claimed at 75%, moved 8%. */
const BRIDGE = (over = {}) => ({
  contributions: over.contributions ?? [
    { id: "material", label: "Material", weight: pc(75), indexMovement: pc(8), provenance: "supplied" },
    { id: "labour", label: "Labour", weight: pc(25), indexMovement: pc(3), provenance: "supplied" },
  ],
});

let store;
let sandbox;

beforeEach(() => {
  store = fakeStore();
  sandbox = {
    document: { getElementById: () => null },
    window: {
      BW: {
        formatPercent: (r) => ratioToPercentString(r, 1),
        MATERIAL_GAP, buildUpShares, compareToBuildUp, questionsFrom,
        estimateFrom, asCostPlan,
        saveEstimate: (e) => saveEstimate(e, store),
        loadEstimates: () => loadEstimates(store),
        loadEstimate: (id) => loadEstimate(id, store),
        deleteEstimate: (id) => deleteEstimate(id, store),
        estimateStoreStatus: () => estimateStoreStatus(store),
      },
    },
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    console,
    _bcMap: {},
    _bcPicked: "",
    _scLast: null,
    _defResult: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(["bcSaveHTML", "bcCompareHTML"].map(fnSource).join("\n"), sandbox);
});

/** Put a saved build-up in the store, the way the should-cost page would. */
function saved(over = {}) {
  const rec = estimateFrom(PLAN, COST(over), { id: "bracket", name: "Bracket BRK-A-102", part: "BRK-A-102" });
  saveEstimate(rec, store);
  return rec;
}

function compare({ picked = "bracket", map = {}, bridge = BRIDGE() } = {}) {
  sandbox._bcPicked = picked;
  sandbox._bcMap = map;
  sandbox.__bridge = bridge;
  vm.runInContext("__out = bcCompareHTML(__bridge);", sandbox);
  return sandbox.__out;
}

describe("it is wired in", () => {
  test("the engine and the store are imported and mounted", () => {
    assert.match(html, /from "\.\/src\/calc\/build-up\.mjs"/);
    assert.match(html, /from "\.\/src\/services\/estimate-store\.mjs"/);
    const mount = (html.match(/window\.BW\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
    for (const name of ["compareToBuildUp", "questionsFrom", "estimateFrom", "asCostPlan", "saveEstimate", "loadEstimates"]) {
      assert.ok(mount.includes(name), `${name} is not exposed`);
    }
  });

  test("the panel sits in the negotiation plan", () => {
    assert.match(html, /\+bcCompareHTML\(r\)/);
  });

  test("saving sits on the cost result", () => {
    assert.match(html, /\+bcSaveHTML\(cost\)/);
  });

  test("no inline handlers were added", () => {
    const handlers = (html.match(/\son(click|input|change|load|error|submit)=/g) || []).length;
    assert.ok(handlers <= 132, `inline handlers rose to ${handlers}`);
  });

  test("the page compares nothing of its own", () => {
    const src = fnSource("bcCompareHTML").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
    assert.equal(/toFixed|parseFloat|\*\s*100/.test(src), false, "the panel does its own arithmetic");
    assert.match(src, /B\.compareToBuildUp/);
    assert.match(src, /B\.formatPercent/);
  });
});

describe("with nothing saved", () => {
  test("it says where a build-up comes from rather than showing an empty table", () => {
    const out = compare({ picked: "" });
    assert.match(out, /No build-up has been saved yet/);
    assert.match(out, /Should Cost Expert/);
    assert.match(out, /only be argued in the supplier&#39;s own numbers/);
    assert.equal(/<table/.test(out), false);
  });
});

describe("the mapping is chosen, never guessed", () => {
  test("a saved build-up offers a select per driver, defaulting to nothing", () => {
    saved();
    const out = compare({ map: {} });
    assert.match(out, /data-bc-driver="material"/);
    assert.match(out, /data-bc-driver="labour"/);
    assert.match(out, /<option value="">not in this build-up<\/option>/);
    assert.match(out, /Nothing guesses this/);
    assert.match(out, /guessing the argument/);
  });

  test("with nothing mapped, there is nothing to compare", () => {
    saved();
    const out = compare({ map: {} });
    assert.match(out, /nothing to compare/);
    assert.equal(/<th class="n">They claim<\/th>/.test(out), false);
  });

  test("the select offers only the lines this build-up actually has", () => {
    saved();
    const out = compare({ map: {} });
    assert.match(out, /<option value="stock"/);
    assert.match(out, /<option value="manufacturing"/);
    assert.equal(/<option value="freight"/.test(out), false);
  });
});

describe("the comparison on the page", () => {
  const mapped = () => { saved(); return compare({ map: { material: "stock", labour: "manufacturing" } }); };

  test("it shows both figures and the difference between them", () => {
    const out = mapped();
    assert.match(out, /75\.0%/);
    assert.match(out, /60\.0%/);
    assert.match(out, /15\.0%/);
  });

  test("it prices the difference in points of the increase being asked for", () => {
    // 15 points of weight at a claimed 8% movement is 1.2 points of the ask.
    assert.match(mapped(), /1\.2%/);
  });

  test("overstating one driver necessarily understates another, and both are marked", () => {
    // Claimed weights sum to 100% and build-up shares sum to 100%, so
    // material at +15 points forces labour to -15. Marking only the one that
    // helps the buyer would misrepresent what the comparison actually found.
    const out = mapped();
    const rows = out.slice(out.indexOf("<tbody>"), out.indexOf("</tbody>")).split("<tr");
    for (const name of ["Material", "Labour"]) {
      assert.match(rows.find((r) => r.includes(name)), /bw-warning-soft/, `${name} is not marked`);
    }
  });

  test("only the overstated side carries a price", () => {
    const out = mapped();
    const rows = out.slice(out.indexOf("<tbody>"), out.indexOf("</tbody>")).split("<tr");
    // Material is claimed higher, so its gap inflates the ask and is priced.
    assert.match(rows.find((r) => r.includes("Material")), /1\.2%/);
    // Labour is claimed lower. That is not money the buyer is being asked
    // for, so there is a dash where the price would be.
    assert.match(rows.find((r) => r.includes("Labour")), /&mdash;/);
  });

  test("a row within the threshold is not marked at all", () => {
    saved();
    const out = compare({
      map: { material: "stock" },
      bridge: BRIDGE({ contributions: [{ id: "material", label: "Material", weight: pc(62), indexMovement: pc(8) }] }),
    });
    assert.equal(/bw-warning-soft/.test(out), false, "two points apart is not worth raising");
    assert.match(out, /consistent with it/);
  });

  test("the questions are on the page, phrased as questions", () => {
    const out = mapped();
    assert.match(out, /Ask them/);
    assert.match(out, /What accounts for the 15\.0% difference\?/);
  });

  test("how strong the build-up line is travels into the table", () => {
    assert.match(mapped(), /bw-status--evidenced">quote-backed/);
  });

  test("a claim below the build-up is shown, not hidden", () => {
    saved();
    const out = compare({
      map: { material: "stock" },
      bridge: BRIDGE({ contributions: [{ id: "material", label: "Material", weight: pc(40), indexMovement: pc(8) }] }),
    });
    assert.match(out, /below the build-up/);
    assert.match(out, /is our build-up wrong\?/);
  });

  test("a driver the build-up does not model is listed as the build-up's limit", () => {
    saved();
    const out = compare({
      map: { material: "stock" },
      bridge: BRIDGE({
        contributions: [
          { id: "material", label: "Material", weight: pc(60), indexMovement: pc(8) },
          { id: "energy", label: "Energy", weight: pc(12), indexMovement: pc(30) },
        ],
      }),
    });
    assert.match(out, /Your build-up does not model these/);
    assert.match(out, /Energy/);
    assert.match(out, /not evidence about the claim/);
  });

  test("the method is on the page, so the framing cannot be lost", () => {
    const out = mapped();
    assert.match(out, /what you think the part costs, not what it costs them/);
    assert.match(out, /recalculates the\s+warranted change/);
  });
});

describe("a build-up with gaps is not comparable, on the page too", () => {
  test("picking one says why rather than showing shares", () => {
    saved({ complete: false, missing: [{ id: "manufacturing", label: "Manufacturing" }] });
    const out = compare({ map: { material: "stock" } });
    assert.match(out, /number about the wrong total/);
    assert.equal(/<th class="n">They claim<\/th>/.test(out), false);
  });

  test("the picker marks it so it is obvious before selecting", () => {
    saved({ complete: false, missing: [{ id: "manufacturing", label: "Manufacturing" }] });
    const out = compare({ picked: "" });
    assert.match(out, /\(has gaps\)/);
  });
});

describe("saving, from the estimate side", () => {
  test("a complete estimate offers to be saved, and says what is kept", () => {
    sandbox.__cost = COST();
    vm.runInContext("__save = bcSaveHTML(__cost);", sandbox);
    assert.match(sandbox.__save, /Keep this build-up/);
    assert.match(sandbox.__save, /Only the result is kept, not the working/);
    assert.match(sandbox.__save, /should still be that figure/);
  });

  test("an estimate with gaps warns before it is saved", () => {
    sandbox.__cost = COST({ complete: false, missing: [{ id: "freight", label: "Freight and packaging" }] });
    vm.runInContext("__save = bcSaveHTML(__cost);", sandbox);
    assert.match(sandbox.__save, /will save but cannot be compared against a claim/);
  });

  test("no estimate offers nothing", () => {
    sandbox.__cost = null;
    vm.runInContext("__save = bcSaveHTML(__cost);", sandbox);
    assert.equal(sandbox.__save, "");
  });
});

describe("the whole loop", () => {
  test("save on one page, compare on the other", () => {
    // Nothing saved: the panel says so.
    assert.match(compare({ picked: "" }), /No build-up has been saved yet/);

    // The should-cost page saves one.
    const rec = estimateFrom(PLAN, COST(), { id: "bracket", name: "Bracket BRK-A-102", part: "BRK-A-102" });
    assert.equal(saveEstimate(rec, store).ok, true);

    // The defender now offers it, and compares once mapped.
    assert.match(compare({ picked: "" }), /Bracket BRK-A-102/);
    const out = compare({ map: { material: "stock", labour: "manufacturing" } });
    assert.match(out, /1\.2%/);
    assert.match(out, /What accounts for the 15\.0% difference\?/);
  });
});

describe("escaping", () => {
  test("a build-up name carrying markup does not reach the page raw", () => {
    saveEstimate(estimateFrom(PLAN, COST(), {
      id: "x", name: '<img src=x onerror="alert(1)">',
    }), store);
    const out = compare({ picked: "" });
    assert.equal(/<img src=x/.test(out), false);
    assert.match(out, /&lt;img/);
  });

  test("nothing raw reaches the markup", () => {
    saved();
    const out = compare({ map: { material: "stock", labour: "manufacturing" } });
    assert.equal(/\[object Object\]|undefined|NaN|\d+n\b/.test(out), false);
  });
});
