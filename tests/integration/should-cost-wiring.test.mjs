/**
 * Should Cost Expert, executed against the page's own code.
 *
 * The engine is tested elsewhere. What is tested here is the seam: that the
 * page collects the right things, hands them over in the right units, and
 * draws a diagram that cannot disagree with the table beside it.
 *
 * Two failures this exists to catch. First, a page that quietly computes: the
 * moment a percentage or a quantity is worked out in markup, the guarantee
 * that every figure is reproducible from the engine is gone. Second, a
 * diagram drawn from anything other than the numbers it sits under — a
 * picture that says nine across while the table says eight is worse than no
 * picture, because somebody will trust the picture.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource } from "../helpers/page.mjs";

import {
  ratioFromPercent, ratioToPercentString, money, moneyFromDecimal, moneyToDecimalString,
} from "../../src/calc/exact.mjs";
import {
  length as scLength, density as scDensity, boxVolume, formatLength, formatMass, formatArea,
} from "../../src/calc/units.mjs";
import {
  stage as scStage, sheetLayout, barLayout, planMaterial, costPlan,
  assumptions as scAssumptions, CONSUMES, COST_ELEMENTS,
} from "../../src/calc/should-cost.mjs";

const html = pageSource();

/** One named function's source, read forward so the slice cannot run backwards. */
function fnSource(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const end = html.indexOf("\nfunction ", start + 1);
  return html.slice(start, end < 0 ? html.length : end);
}

/** Run the page's should-cost code over a stub form. */
function run(fields = {}, { stages, checked = false, costs = {}, amortise = false } = {}) {
  const values = {
    "sc-qty": "1000", "sc-unit": "mm", "sc-grade": "Fictional grade FG-300",
    "sc-bw": "200", "sc-bl": "100", "sc-bt": "5",
    "sc-pw": "180", "sc-pl": "80", "sc-pt": "5",
    "sc-dv": "7.85", "sc-du": "g/cm3", "sc-ds": "Synthetic datasheet",
    "sc-form": "sheet", "sc-s1": "2000", "sc-s2": "1000",
    "sc-kerf": "3", "sc-edge": "10", "sc-pack": "1", "sc-moq": "0", "sc-cont": "0",
    "sc-cur": "GBP",
    ...fields,
  };
  const out = { innerHTML: "" };
  const boxes = { "sc-rot": { checked }, "sc-amort": { checked: amortise } };
  const sandbox = {
    document: {
      getElementById: (id) =>
        (id === "sc-out" ? out : (id in boxes ? boxes[id] : (id in values ? { value: values[id] } : null))),
    },
    window: {
      BW: {
        pc: ratioFromPercent, formatPercent: (r) => ratioToPercentString(r, 1),
        money, moneyToDecimalString,
        /* The page's own amount parser, which the defender already uses. */
        parseAmount: (v) => {
          const t = String(v).replace(/[^0-9.]/g, "");
          if (t === "" || !/^\d+(\.\d{1,2})?$/.test(t)) return null;
          return moneyFromDecimal(t, "GBP", null).minor;
        },
        scLength, scDensity, boxVolume, formatLength, formatMass, formatArea,
        scStage, sheetLayout, barLayout, planMaterial, costPlan, scAssumptions,
        CONSUMES, COST_ELEMENTS,
      },
    },
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    console,
    _scStages: stages ?? [["Laser cut", "98", "0", "input"], ["Form", "95", "4", "input"]],
    _scCosts: costs,
  };
  const src = ["scVal", "scInt", "scErr", "scRun", "scRow", "scPlanHTML", "scLayoutHTML",
               "scCostEntries", "scCostHTML", "scAssumptionsHTML", "bcSaveHTML"].map(fnSource).join("\n");
  vm.createContext(sandbox);
  new vm.Script(src + "\n;scRun();").runInContext(sandbox);
  return out.innerHTML;
}

/** The shape the cost capture stores per element. */
const costed = (amount, quality = "quote-backed", basis = "synthetic quote") =>
  ({ on: true, amount, basis, quality });

describe("it is wired in", () => {
  test("both modules are imported and mounted", () => {
    assert.match(html, /from "\.\/src\/calc\/should-cost\.mjs"/);
    assert.match(html, /from "\.\/src\/calc\/units\.mjs"/);
    const mount = (html.match(/window\.BW\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
    for (const name of ["planMaterial", "sheetLayout", "barLayout", "scStage", "scLength", "scDensity", "scAssumptions"]) {
      assert.ok(mount.includes(name), `${name} is not exposed`);
    }
  });

  test("it has a destination, an icon and a group", () => {
    assert.match(html, /\["shouldcost","Should Cost Expert"\]/);
    assert.match(html, /\n {2}shouldcost:'/, "no sidebar icon, so it would fall back to the tools glyph");
    assert.match(html, /\["Analysis",\["shouldcost"/);
    assert.match(html, /id="page-shouldcost"/);
  });

  test("it binds on navigation, not with inline handlers", () => {
    assert.match(html, /p==="shouldcost"&&typeof scBind==="function"/);
    const page = html.slice(html.indexOf('id="page-shouldcost"'), html.indexOf("<!-- ============ WORKSPACE"));
    assert.equal(/\son(click|input|change)=/.test(page), false, "an inline handler was added to the page");
    assert.match(fnSource("scBind"), /page\.addEventListener\("click"/);
  });

  test("no inline handlers were added anywhere", () => {
    const handlers = (html.match(/\son(click|input|change|load|error|submit)=/g) || []).length;
    assert.ok(handlers <= 132, `inline handlers rose to ${handlers}`);
  });
});

describe("the page computes nothing", () => {
  test("no arithmetic on a quantity, a mass or a percentage", () => {
    // The whole guarantee rests on this. Coordinates are allowed — the
    // diagram has to turn integers into pixels — and nothing else is.
    for (const name of ["scRun", "scPlanHTML", "scRow"]) {
      const src = fnSource(name)
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^[ \t]*\/\/.*$/gm, " ");
      assert.equal(/toFixed|parseFloat/.test(src), false, `${name} does its own arithmetic`);
    }
  });

  test("the diagram converts exact integers to coordinates and nothing else", () => {
    const src = fnSource("scLayoutHTML");
    assert.match(src, /var k=vbW\/num\(L\.sheetWidthUm\)/, "the scale factor is not derived from the stock width");
    assert.equal(/\*\s*100\b/.test(src), false, "a percentage is being computed in the diagram");
  });

  test("a percentage on the page comes from the shared formatter", () => {
    assert.match(fnSource("scLayoutHTML"), /B\.formatPercent/);
  });
});

describe("what it produces", () => {
  const out = () => run();

  test("the quantities are each named, and each different", () => {
    const o = out();
    for (const label of ["Accepted parts required", "Blanks the route requires", "Blanks to release",
                         "Stock units needed", "Stock units to buy"]) {
      assert.ok(o.includes(label), `${label} is missing from the result`);
    }
    // 1000 parts, form at 95% with 4 setup pieces, cut at 98%: 1079 blanks,
    // 81 per sheet, 14 sheets. The page must show the engine's numbers.
    assert.match(o, /1079/);
    assert.match(o, /\b14\b/);
  });

  test("the route is shown stage by stage, with where each piece went", () => {
    const o = out();
    assert.match(o, /The route, worked backwards/);
    assert.match(o, /Laser cut/);
    assert.match(o, /Lost to yield/);
    assert.match(o, /from the input/);
  });

  test("setup pieces taken from accepted output say so", () => {
    const o = run({}, { stages: [["Form", "95", "4", "output"]] });
    assert.match(o, /from accepted output/);
  });

  test("the diagram agrees with the table it sits under", () => {
    const o = out();
    // 9 across by 9 down = 81, and the SVG must contain exactly that many
    // blanks — a picture that disagrees with the count is worse than none.
    assert.match(o, /9 across by 9 down/);
    assert.match(o, /81 per stock unit/);
    assert.equal((o.match(/fill="var\(--bw-accent-soft\)"/g) || []).length, 81);
  });

  test("the diagram is to scale, and says which figure set the scale", () => {
    const o = out();
    assert.match(o, /Drawn to scale/);
    assert.match(o, /viewBox="0 0 680 340\.0"/, "a 2000x1000 sheet must be drawn twice as wide as it is tall");
  });

  test("the assumptions table carries every yield with its basis", () => {
    const o = out();
    assert.match(o, /Assumptions this rests on/);
    assert.match(o, /Laser cut yield/);
    assert.match(o, /Form yield/);
    assert.match(o, /assumed/);
    assert.match(o, /simple grid/);
  });

  test("it never calls the layout a nest", () => {
    assert.equal(/\bnesting solution\b/.test(out()), false);
    assert.match(out(), /not an optimal nest/);
  });
});

describe("what it refuses to do", () => {
  test("no density means no mass, and it says why", () => {
    const o = run({ "sc-dv": "" });
    assert.match(o, /No density was supplied/);
    assert.match(o, /inventing one/);
    assert.equal(/Gross purchased/.test(o), false);
    assert.match(o, /Stock units to buy/, "the quantity plan still works without a density");
  });

  test("a density with no source is refused rather than accepted", () => {
    const o = run({ "sc-ds": "" });
    assert.match(o, /needs a source/);
  });

  test("a missing quantity is refused with the reason, not defaulted to zero", () => {
    const o = run({ "sc-qty": "" });
    assert.match(o, /Enter how many accepted parts are required/);
  });

  test("a blank that does not fit reports it instead of returning zero sheets", () => {
    const o = run({ "sc-bw": "2500" });
    assert.match(o, /does not fit/);
    assert.equal(/Stock units to buy/.test(o), false);
  });

  test("a missing dimension names the field, not the field id", () => {
    const o = run({ "sc-bt": "" });
    assert.match(o, /Blank thickness is missing/);
  });

  test("contingency is shown as its own quantity", () => {
    const o = run({ "sc-cont": "5" });
    assert.match(o, /Contingency blanks/);
    assert.match(o, /a separate decision, not part of the requirement/);
  });

  test("rotation is not applied unless the box is ticked, and the alternative is surfaced", () => {
    const wide = { "sc-bw": "900", "sc-bl": "150" };
    const fixed = run(wide, { checked: false });
    const free = run(wide, { checked: true });
    assert.match(fixed, /as drawn/);
    assert.ok(free.includes("rotated") || free.includes("as drawn"));
  });
});

describe("bars", () => {
  const bar = () => run({ "sc-form": "bar", "sc-s1": "6000", "sc-bl": "300", "sc-edge": "25" });

  test("a bar is cut, not tiled", () => {
    const o = bar();
    assert.match(o, /blanks per bar/);
    assert.match(o, /End trim/);
    assert.match(o, /saw kerf/);
  });

  test("the count comes from the engine", () => {
    // 6000 less 2x25 trim is 5950 usable; each 300mm blank plus a 3mm
    // part-off gives 19.
    assert.match(bar(), /19 blanks per bar/);
  });

  test("a bar too short for one blank reports it", () => {
    const o = run({ "sc-form": "bar", "sc-s1": "200", "sc-bl": "300", "sc-edge": "25" });
    assert.match(o, /shorter than one blank/);
  });
});

describe("the page is honest about what this release is", () => {
  const page = html.slice(html.indexOf('id="page-shouldcost"'), html.indexOf("<!-- ============ WORKSPACE"));

  test("it says there is no document extraction, rather than implying there is", () => {
    assert.match(page, /There is no document extraction in this build/);
    assert.match(page, /does not contain recoverable 3D geometry/);
    assert.match(page, /no dimension or certificate value here was recovered from one/);
  });

  test("all three releases are built, so nothing is described as coming", () => {
    // The page used to name the unbuilt releases so the shape of the module
    // was visible. All three exist now, and a page that still says one is
    // coming is a page that has stopped tracking what it does.
    for (const stale of ["is the next release and is not built", "are the next two releases"]) {
      assert.equal(page.includes(stale), false, `the page still claims something is unbuilt: "${stale}"`);
    }
    for (const mode of ["material", "cert", "mill"]) {
      assert.match(html, new RegExp(`data-sc-mode="${mode}"`), `the ${mode} mode has no tab`);
    }
  });

  test("what is still absent is named, since that has not changed", () => {
    assert.match(page, /There is no document extraction in this build/);
    assert.match(page, /Everything you record stays in this browser/);
  });

  test("nothing on the page claims a real supplier, price or certificate", () => {
    assert.match(page, /Fictional grade/);
    assert.match(page, /Synthetic datasheet/);
  });
});

describe("escaping", () => {
  test("a material name carrying markup does not reach the page raw", () => {
    const o = run({ "sc-ds": '<img src=x onerror="alert(1)">' });
    assert.equal(/<img src=x/.test(o), false);
    assert.match(o, /&lt;img/);
  });

  test("nothing raw reaches the markup", () => {
    assert.equal(/\[object Object\]|undefined|NaN/.test(run()), false);
  });
});

describe("the cost, and the empty field", () => {
  test("an element switched off is simply absent, and the estimate is complete", () => {
    const o = run({}, { costs: { stock: costed("4620.00") } });
    assert.match(o, /What it should cost<\/div>/);
    assert.match(o, /quote-backed/);
    assert.equal(/no figure/.test(o), false);
  });

  test("an element switched on with no amount is a gap, not a zero", () => {
    // The failure this page exists to avoid: a blank row rendering as 0.00,
    // which on screen reads as free.
    const o = run({}, { costs: { stock: costed("4620.00"), manufacturing: { on: true, amount: "" } } });
    assert.match(o, /no figure/);
    assert.equal(/GBP 0\.00/.test(o), false);
    assert.match(o, /What it should cost, so far/);
    assert.match(o, /incomplete/);
  });

  test("a gap blocks the per-part figure rather than dividing a partial sum", () => {
    const o = run({}, { costs: { stock: costed("4620.00"), manufacturing: { on: true, amount: "" } } });
    assert.match(o, /withheld while the estimate has gaps/);
    assert.match(o, /Subtotal so far/);
    assert.match(o, /not a total/);
  });

  test("a gap says what it needs, so it can be closed", () => {
    const o = run({}, { costs: { stock: costed("4620.00"), manufacturing: { on: true, amount: "" } } });
    assert.match(o, /No figure yet/);
    assert.match(o, /needs operation setup and cycle rate/);
  });

  test("the weakest basis sets the confidence of the whole estimate", () => {
    const o = run({}, {
      costs: {
        stock: costed("4620.00", "quote-backed"),
        manufacturing: costed("880.00", "assumed", "estimated cycle time"),
      },
    });
    assert.match(o, /bw-status--assumed">budgetary/);
  });

  test("tooling is shown apart from the recurring cost", () => {
    const o = run({}, { costs: { stock: costed("4620.00"), tooling: costed("15000.00") } });
    assert.match(o, /one-time/);
    assert.match(o, /GBP 4620\.00/);
    assert.match(o, /GBP 15000\.00/);
  });

  test("amortising tooling moves it into the recurring figure", () => {
    const o = run({}, { costs: { stock: costed("4620.00"), tooling: costed("15000.00") }, amortise: true });
    assert.match(o, /GBP 19620\.00/);
  });

  test("a scrap credit is shown as a subtraction, not as a cost", () => {
    const o = run({}, { costs: { stock: costed("4620.00"), scrapCredit: costed("200.00") } });
    assert.match(o, /&minus;GBP 200\.00/);
    assert.match(o, /GBP 4420\.00/);
  });

  test("an amount that is not an amount is refused, and says to leave it blank", () => {
    const o = run({}, { costs: { stock: { on: true, amount: "about four thousand", basis: "x" } } });
    assert.match(o, /is not an amount/);
    assert.match(o, /Leave it blank if it is not known/);
  });

  test("a priced element with no basis is refused rather than accepted", () => {
    const o = run({}, { costs: { stock: { on: true, amount: "4620.00", basis: "" } } });
    assert.match(o, /no basis/);
    assert.match(o, /What to order/, "the material plan still renders — only the cost is rejected");
  });

  test("no cost entered at all still produces the material plan", () => {
    const o = run();
    assert.match(o, /What to order/);
    assert.match(o, /Assumptions this rests on/);
  });

  test("the cost lines reach the assumptions table with their basis", () => {
    const o = run({}, { costs: { stock: costed("4620.00", "quote-backed", "quoted sheet price") } });
    const table = o.slice(o.indexOf("Assumptions this rests on"));
    assert.match(table, /Raw stock/);
    assert.match(table, /quote-backed — quoted sheet price/);
    assert.match(table, /GBP 4620\.00/);
  });

  test("the material and cost assumptions sit in one table, not two half ones", () => {
    const o = run({}, { costs: { stock: costed("4620.00") } });
    assert.equal((o.match(/Assumptions this rests on/g) || []).length, 1);
    const table = o.slice(o.indexOf("Assumptions this rests on"));
    assert.match(table, /Laser cut yield/, "a material assumption");
    assert.match(table, /Raw stock/, "a cost assumption");
  });
});
