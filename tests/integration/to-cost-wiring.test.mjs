/**
 * Carrying the part into the costing form, run against the page's own code.
 *
 * The audit's second remaining item, and the sentence it turns on: *"Do not
 * silently use model mass as purchased stock mass."* The module refuses to
 * hand purchased mass over at all; what a wiring test adds is that the page
 * does not fill a costing field the module never gave it, that nothing crosses
 * until somebody presses the button, and that a proposal made against a part
 * that has since moved is refused where the person is looking.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { fnSource } from "../helpers/page.mjs";
import {
  block, addHole, addPocket, removeFeature, resize, featureIds,
  volume, mass as geometryMass, history as geometryHistory,
} from "../../src/studio/geometry.mjs";
import { density, formatMass } from "../../src/calc/units.mjs";
import { schedule, labelOfKind } from "../../src/studio/requirements.mjs";
import {
  propose as proposeBlank, accept as acceptBlank, stillAbout as blankStillAbout,
  ALLOWANCES as BLANK_ALLOWANCES,
} from "../../src/studio/to-cost.mjs";

const app = readFileSync("app.js", "utf8");

function page({ withModule = true } = {}) {
  const els = new Map();
  for (const id of ["tocost", "tocost-msg", "tocost-by", "pb-out", "pb-status",
                    "pb-w", "pb-l", "pb-t",
                    "sc-bw", "sc-bl", "sc-bt", "sc-pw", "sc-pl", "sc-pt",
                    "sc-dv", "sc-du", "sc-ds"]) {
    els.set(id, { id, value: "", innerHTML: "", textContent: "" });
  }

  const BW = {
    block, addHole, addPocket, removeFeature, resize, featureIds,
    volume, geometryMass, geometryHistory, scDensity: density, formatMass,
    reqSchedule: schedule, reqLabelOfKind: labelOfKind,
  };
  if (withModule) {
    Object.assign(BW, { proposeBlank, acceptBlank, blankStillAbout, BLANK_ALLOWANCES });
  }

  const box = {
    document: { getElementById: (id) => els.get(id) ?? null },
    console,
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    window: { BW },
  };
  vm.createContext(box);
  vm.runInContext([
    "var _scModel=null; var _scHistory=null; var _scReqs=[];",
    "var _toCost=null; var _toCostTaken=null; var _toCostAllowances=Object.create(null);",
    fnSource("scVal", app), fnSource("defSet", app),
    fnSource("toCostRender", app), fnSource("toCostFieldsHTML", app),
    fnSource("toCostProposalHTML", app), fnSource("toCostTakenHTML", app),
    fnSource("mm", app), fnSource("scDensityOrNull", app),
    fnSource("toCostSet", app), fnSource("toCostWork", app), fnSource("scUmFrom", app),
    fnSource("toCostTake", app), fnSource("toCostClear", app),
  ].join("\n"), box);

  const run = (src) => vm.runInContext(src, box);

  return {
    box, els, run,
    model: (m) => { box.__m = m; run("_scModel=__m;"); },
    render: () => run("toCostRender();"),
    html: () => els.get("tocost").innerHTML,
    allow: (name, value) =>
      run(`toCostSet({ value: ${JSON.stringify(value)} }, ${JSON.stringify(name)});`),
    work: () => run("toCostWork();"),
    take: (by) => { els.get("tocost-by").value = by; run("toCostTake();"); },
    msg: () => els.get("tocost-msg").textContent || "",
    field: (id) => els.get(id).value,
    setDensity: () => {
      els.get("sc-dv").value = "7.85";
      els.get("sc-du").value = "g/cm3";
      els.get("sc-ds").value = "Synthetic datasheet, revision B";
    },
    taken: () => run("_toCostTaken === null ? null : _toCostTaken.by"),
    clear: () => run("toCostClear();"),
  };
}

const plain = () => block({ widthUm: 100_000n, lengthUm: 60_000n, thicknessUm: 10_000n });
const holed = () => addHole(plain(), { xUm: 15_000n, yUm: 20_000n, diameterUm: 8_000n }).model;

const allowAll = (v) => {
  v.allow("sideUm", "2");
  v.allow("endUm", "2");
  v.allow("faceUm", "1");
};

let v;
beforeEach(() => { v = page(); v.model(plain()); v.render(); });

/* ----------------------------------------------------------- the panel */

describe("the panel", () => {
  test("is silent when the module is not there", () => {
    const bare = page({ withModule: false });
    bare.model(plain());
    bare.render();
    assert.equal(bare.html(), "");
  });

  test("asks for each allowance as the question the module words it as", () => {
    for (const name of Object.keys(BLANK_ALLOWANCES)) {
      assert.ok(v.html().includes(BLANK_ALLOWANCES[name]), `${name} is not asked`);
    }
  });

  test("and says the part is not the blank before anything is worked out", () => {
    assert.match(v.html(), /The part is not the blank/);
  });

  test("nothing is worked out until it is asked for", () => {
    assert.equal(v.html().includes("The blank is"), false);
  });
});

/* -------------------------------------------------------- working it out */

describe("working out the blank", () => {
  test("a missing allowance withholds all of it, and says why", () => {
    v.allow("sideUm", "2");
    v.work();
    assert.match(v.html(), /allowance of nothing, which is a decision/);
    assert.equal(v.html().includes("The blank is 104"), false);
  });

  test("with all three, the blank and what cutting removes are on screen", () => {
    allowAll(v);
    v.work();
    assert.match(v.html(), /The blank is 104 × 64 × 11 mm/);
    assert.match(v.html(), /removes \d+ cubic mm/);
  });

  test("the model revision it was worked out from is shown", () => {
    allowAll(v);
    v.work();
    assert.match(v.html(), /blank, from model revision 1/);
  });

  test("without a density, weight is withheld with the reason", () => {
    allowAll(v);
    v.work();
    assert.match(v.html(), /guessed from a similar alloy/);
  });

  test("with one, the blank's weight is shown and named as not the purchased weight", () => {
    v.setDensity();
    allowAll(v);
    v.work();
    assert.match(v.html(), /One blank weighs/);
    assert.match(v.html(), /not the purchased weight/);
  });

  test("a part with a hole says its net volume is withheld", () => {
    v.model(holed());
    allowAll(v);
    v.work();
    assert.match(v.html(), /bracket rather than a figure/);
  });
});

/* ---------------------------------------------------------- carrying it */

describe("putting it in the form", () => {
  beforeEach(() => { allowAll(v); v.work(); });

  test("nothing is in the costing form until the button is pressed", () => {
    assert.equal(v.field("sc-bw"), "");
    assert.equal(v.field("sc-bl"), "");
    assert.equal(v.field("sc-bt"), "");
  });

  test("and not then either, without a name", () => {
    v.take("");
    assert.equal(v.field("sc-bw"), "");
    assert.match(v.msg(), /record who did it/);
  });

  test("with a name, the blank crosses over", () => {
    v.take("estimator");
    assert.equal(v.field("sc-bw"), "104");
    assert.equal(v.field("sc-bl"), "64");
    assert.equal(v.field("sc-bt"), "11");
    assert.equal(v.taken(), "estimator");
  });

  test("a plain rectangle fills the finished-part boxes too", () => {
    v.take("estimator");
    assert.equal(v.field("sc-pw"), "100");
    assert.equal(v.field("sc-pl"), "60");
    assert.equal(v.field("sc-pt"), "10");
    assert.match(v.msg(), /because this part is a plain rectangle/);
  });

  test("a part with a feature does not, and the message says why", () => {
    const w = page();
    w.model(holed());
    w.render();
    allowAll(w);
    w.work();
    w.take("estimator");

    assert.equal(w.field("sc-bw"), "104", "the blank should still cross");
    assert.equal(w.field("sc-pw"), "", "a net mass from a rectangle the part is not");
    assert.match(w.msg(), /worse than none/);
  });

  test("the message says the purchase quantity still comes from the layout", () => {
    v.take("estimator");
    assert.match(v.msg(), /purchase quantity still comes from the layout/);
  });

  test("and who carried it over, against which revision, stays on screen", () => {
    v.take("estimator");
    assert.match(v.html(), /Carried over by estimator/);
    assert.match(v.html(), /from model revision 1/);
  });
});

/* ------------------------------------------------------------ staleness */

describe("when the part moves underneath it", () => {
  beforeEach(() => { allowAll(v); v.work(); });

  test("the panel says so and offers no button", () => {
    v.model(resize(plain(), { widthUm: 120_000n }).model);
    v.render();
    assert.match(v.html(), /The part has changed since this was worked out/);
    assert.equal(v.html().includes("Put this in the costing form"), false);
  });

  test("and carrying it over is refused, naming what moved", () => {
    v.model(resize(plain(), { widthUm: 120_000n }).model);
    v.take("estimator");
    assert.equal(v.field("sc-bw"), "");
    assert.match(v.msg(), /geometry has changed/);
  });

  test("changing the density counts as moving too", () => {
    v.setDensity();
    v.work();
    v.els.get("sc-dv").value = "2.70";
    v.take("estimator");
    assert.match(v.msg(), /material has changed/);
  });
});

/* -------------------------------------------------- the rule being kept */

describe("what never crosses", () => {
  test("no purchased mass or stock quantity is written anywhere", () => {
    v.setDensity();
    allowAll(v);
    v.work();
    v.take("estimator");

    /* The costing form's own fields, checked by name: the blank three are
       filled and nothing about purchasing is. */
    for (const id of ["sc-qty", "sc-kerf", "sc-edge", "sc-pack", "sc-moq"]) {
      assert.equal(v.els.get(id), undefined,
        `${id} is not even in this harness, so the page cannot have written it`);
    }
    assert.match(v.msg(), /purchase quantity still comes from the layout/);
  });

  test("starting a new scenario puts the transfer down", () => {
    allowAll(v);
    v.work();
    v.take("estimator");
    v.clear();

    assert.equal(v.taken(), null);
    assert.equal(v.html(), "");
  });
});
