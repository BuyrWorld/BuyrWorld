/**
 * The supply scene, run against the page's own code.
 *
 * The module refuses to invent; this checks the drawing does not reintroduce
 * what the module refused. Three things in particular:
 *
 *   - no figure reaches the boxes, so the chain cannot become a second way to
 *     read a figure the case above is withholding;
 *   - the accessible reading is the drawing, not a duplicate of it — four list
 *     items, in order, with the arrows marked decorative;
 *   - the tick beside a question is the case view's own tick, against the same
 *     assumption id, rather than a second control confirming the same thing.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { fnSource } from "../helpers/page.mjs";
import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { ratioFromPercent, moneyFromDecimal, moneyToDecimalString } from "../../src/calc/exact.mjs";
import { assumptionsToVerify } from "../../src/calc/provenance.mjs";
import { narrative, sectionOf, SECTION_TITLE } from "../../src/case/narrative.mjs";
import { quoteCase, needsOf } from "../../src/case/from-quote.mjs";
import {
  project, hiddenSaid, ROLE, ROLES, ROLE_TITLE, DEPTH, DEPTHS, SCOPE_SAID,
} from "../../src/case/projection.mjs";
import {
  brief, readiness as briefReadiness, DRAFT_LABEL as BRIEF_DRAFT_LABEL,
} from "../../src/case/brief.mjs";
import {
  consult, missingAcross, SPECIALIST_TITLE, NOT_CONSULTED, CONFIDENCE_SAID,
} from "../../src/case/specialists.mjs";
import { prepareNegotiation } from "../../src/calc/negotiation.mjs";
import {
  whatIf, adopt as adoptScenario, stillAbout as scenarioStillAbout,
  questionsFor as scenarioQuestionsFor, SCENARIO, SCENARIO_TITLE, NEEDS as SCENARIO_NEEDS,
} from "../../src/calc/scenarios.mjs";
import {
  scene, STAGE as SCENE_STAGE, STAGE_TITLE as SCENE_STAGE_TITLE,
  ORDER as SCENE_ORDER, STATE as SCENE_STATE, WEIGHT as SCENE_WEIGHT,
  WOULD_FILL as SCENE_WOULD_FILL,
} from "../../src/case/supply-scene.mjs";

const app = readFileSync("app.js", "utf8");
const p = (x) => ratioFromPercent(x);
const gbp = (x) => moneyFromDecimal(x, "GBP");

/** The page escapes on the way out, so an expected sentence is escaped too. */
const esc = (x) => String(x).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** One driver sourced, one not, and part of the cost unexplained. */
const claim = () => costBridge({
  baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
  requestedChange: p("9"),
  drivers: [
    { id: "material", label: "Steel bar", weight: p("42"), indexMovement: p("10"),
      source: "synthetic-index-A" },
    { id: "labour", label: "Direct labour", weight: p("18"), indexMovement: p("5") },
  ],
});

function page() {
  const els = new Map();
  els.set("case-view", { id: "case-view", innerHTML: "" });
  els.set("def-supplier", { id: "def-supplier", value: "Northgate (synthetic)" });
  els.set("case-brief-msg", { id: "case-brief-msg", textContent: "" });
  els.set("whatif-by", { id: "whatif-by", value: "" });
  els.set("whatif-adopt-msg", { id: "whatif-adopt-msg", textContent: "" });

  const box = {
    document: { getElementById: (id) => els.get(id) ?? null },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    console,
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    scVal: (id) => String((els.get(id) || {}).value || ""),
    window: {
      BW: {
        narrative, sectionOf, SECTION_TITLE, quoteCase, needsOf, assumptionsToVerify,
        project, hiddenSaid, ROLE, ROLES, ROLE_TITLE, DEPTH, DEPTHS, SCOPE_SAID,
        brief, briefReadiness, BRIEF_DRAFT_LABEL,
        consult, missingAcross, SPECIALIST_TITLE, NOT_CONSULTED, CONFIDENCE_SAID,
        prepareNegotiation, moneyToDecimalString,
        whatIf, adoptScenario, scenarioStillAbout, scenarioQuestionsFor,
        SCENARIO, SCENARIO_TITLE, SCENARIO_NEEDS,
        scene, SCENE_STAGE, SCENE_STAGE_TITLE, SCENE_ORDER, SCENE_STATE,
        SCENE_WEIGHT, SCENE_WOULD_FILL,
      },
    },
    _defResult: null,
  };
  vm.createContext(box);
  new vm.Script([
    "var _caseRole=null; var _caseDepth=null;",
    "var _caseConfirmed=Object.create(null);",
    "var _whatIfKind=null; var _whatIfInputs=Object.create(null);",
    "var _whatIfWorked=Object.create(null); var _whatIfAdopted=[];",
    fnSource("caseClear", app), fnSource("caseLabelFor", app),
    fnSource("caseNarrative", app), fnSource("caseRender", app),
    fnSource("caseControlsHTML", app), fnSource("caseSectionHTML", app),
    fnSource("caseClaimHTML", app), fnSource("caseIsAssumption", app),
    fnSource("caseFigureText", app), fnSource("caseFootHTML", app),
    fnSource("caseSetRole", app), fnSource("caseSetDepth", app),
    fnSource("caseConfirm", app), fnSource("caseBriefHTML", app),
    fnSource("caseBriefTitle", app), fnSource("caseCopyBrief", app),
    fnSource("caseSpecialistsHTML", app), fnSource("caseNegotiationPlan", app),
    fnSource("caseSceneHTML", app), fnSource("caseSceneAttentionHTML", app),
    fnSource("caseSceneStageHTML", app), fnSource("caseSceneQuestionHTML", app),
    fnSource("whatIfBase", app), fnSource("whatIfHTML", app),
    fnSource("whatIfPanelHTML", app), fnSource("whatIfWorkedHTML", app),
    fnSource("whatIfAxesHTML", app), fnSource("whatIfAdoptHTML", app),
    fnSource("whatIfAdoptedHTML", app), fnSource("whatIfOpen", app),
    fnSource("whatIfSet", app), fnSource("whatIfWork", app),
    fnSource("whatIfAdopt", app), fnSource("whatIfClear", app),
  ].join("\n")).runInContext(box);

  const run = (src) => vm.runInContext(src, box);

  return {
    box, els, run,
    calculate: (bridge) => { box.__b = bridge; run("_defResult=__b;"); },
    render: () => run("caseRender();"),
    html: () => els.get("case-view").innerHTML,
    /* The scene only, so an assertion about it cannot be satisfied by
       something the case above happens to say. */
    block: () => els.get("case-view").innerHTML
      .split("Where this sits in the chain")[1]
      .split("What if we did it differently?")[0],
    confirm: (id) => run(`caseConfirm(${JSON.stringify(id)});`),
    adoptSplit: () => {
      run(`whatIfOpen(${JSON.stringify(SCENARIO.SPLIT)});`);
      for (const [f, v] of Object.entries({
        firstQuantity: "20000", totalQuantity: "50000", secondFreight: "450.00",
        firstDate: "2026-11-02", secondDate: "2027-01-18",
      })) run(`whatIfSet({ value: ${JSON.stringify(v)} }, ${JSON.stringify(f)});`);
      run("whatIfWork();");
      els.get("whatif-by").value = "category manager";
      run("whatIfAdopt();");
    },
  };
}

let v;
beforeEach(() => { v = page(); v.calculate(claim()); v.render(); });

describe("before anything is calculated", () => {
  test("there is no chain, because there is no case to draw one from", () => {
    const bare = page();
    bare.render();
    assert.equal(bare.html(), "");
  });

  test("and the module missing leaves the case standing", () => {
    const bare = page();
    vm.runInContext("delete window.BW.scene;", bare.box);
    bare.calculate(claim());
    bare.render();
    assert.ok(bare.html().includes(SECTION_TITLE[Object.keys(SECTION_TITLE)[0]]));
    assert.equal(bare.html().includes("Where this sits in the chain"), false);
  });
});

describe("the four stages on screen", () => {
  test("all four are drawn, in supply order", () => {
    const titles = SCENE_ORDER.map((k) => SCENE_STAGE_TITLE[k]);
    const positions = titles.map((t) => v.block().indexOf(t));
    assert.equal(positions.some((i) => i < 0), false, "a stage is missing");
    assert.deepEqual([...positions].sort((a, b) => a - b), positions,
      "the stages are not in supply order");
  });

  test("it is one ordered list of four, not a picture with a list beside it", () => {
    assert.equal((v.block().match(/<ol/g) || []).length, 1);
    assert.equal((v.block().match(/<li style="flex:1 1 210px/g) || []).length, 4);
  });

  test("the arrows are decorative, and say so", () => {
    assert.equal((v.block().match(/aria-hidden="true"/g) || []).length, 3);
  });

  test("a stage the case knows nothing about says so, and what would fill it", () => {
    assert.ok(v.block().includes("nothing known"));
    assert.ok(v.block().includes(SCENE_WOULD_FILL[SCENE_STAGE.TRANSPORT]));
  });
});

describe("no figure reaches the chain", () => {
  test("not a money amount and not a percentage", () => {
    assert.equal(/\d+\.\d{2} GBP/.test(v.block()), false, "money reached the chain");
    assert.equal(/\d+\.\d+%/.test(v.block()), false, "a percentage reached the chain");
  });

  test("even once every assumption has been confirmed", () => {
    for (const a of assumptionsToVerify(claim())) v.confirm(a.id);
    v.render();
    assert.equal(/\d+\.\d{2} GBP/.test(v.block()), false);
    assert.equal(/\d+\.\d+%/.test(v.block()), false);
  });
});

describe("the stage to look at", () => {
  test("is named where the case names one", () => {
    assert.match(v.block(), /Look at supplier/);
  });

  test("and the reason is the module's sentence", () => {
    const expected = scene({
      bridge: claim(), supplier: "Northgate (synthetic)",
      assumptions: assumptionsToVerify(claim()),
    }).attention.why;
    assert.ok(v.block().includes(esc(expected)), "the page is wording it for itself");
  });
});

describe("a question with an assumption behind it", () => {
  test("offers the case view's own tick, against the same id", () => {
    assert.match(v.block(), /data-do="caseConfirm" data-a="movement-labour"/);
  });

  test("and reports it confirmed once it is, rather than offering it twice", () => {
    v.confirm("movement-labour");
    v.render();
    assert.equal(v.block().includes('data-a="movement-labour"'), false);
    assert.match(v.block(), /confirmed/);
  });

  test("a question with nothing to confirm offers no tick", () => {
    const unexplained = v.block().split("rests on nothing stated")[1].split("</li>")[0];
    assert.equal(unexplained.includes("caseConfirm"), false);
  });
});

describe("an adopted option becomes part of the chain", () => {
  test("transport stops being empty once one is adopted", () => {
    assert.ok(v.block().includes(SCENE_WOULD_FILL[SCENE_STAGE.TRANSPORT]));
    v.adoptSplit();
    assert.equal(v.block().includes(SCENE_WOULD_FILL[SCENE_STAGE.TRANSPORT]), false);
    assert.match(v.block(), /second delivery&#39;s freight/);
  });

  test("and the fact says which option it came from, and who adopted it", () => {
    v.adoptSplit();
    assert.match(v.block(), /adopted by category manager/);
  });

  test("an option only explored changes nothing in the chain", () => {
    v.run(`whatIfOpen(${JSON.stringify(SCENARIO.SPLIT)});`);
    for (const [f, val] of Object.entries({
      firstQuantity: "20000", totalQuantity: "50000", secondFreight: "450.00",
      firstDate: "2026-11-02", secondDate: "2027-01-18",
    })) v.run(`whatIfSet({ value: ${JSON.stringify(val)} }, ${JSON.stringify(f)});`);
    v.run("whatIfWork();");

    assert.ok(v.block().includes(SCENE_WOULD_FILL[SCENE_STAGE.TRANSPORT]),
      "a what-if badged NOT THE PLAN turned up in the plan's own chain");
  });
});
