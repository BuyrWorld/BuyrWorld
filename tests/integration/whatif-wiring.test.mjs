/**
 * The three what-ifs, run against the page's own code.
 *
 * `src/calc/scenarios.mjs` has its own tests and they check the arithmetic.
 * This checks the half that a person actually meets, and specifically the
 * three things `specs/02`'s Phase 3 gate turns on:
 *
 *   - every numeric impact comes from the tested module, not from the page;
 *   - a missing input visibly blocks the result, with no partial comparison
 *     and no figure anywhere on screen;
 *   - exploring or adopting a scenario never moves the plan it was about.
 *
 * The third is the one worth having a test for. A what-if that quietly
 * rewrote the calculation would be indistinguishable, from the inside, from
 * one that did not.
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

const app = readFileSync("app.js", "utf8");
const p = (x) => ratioFromPercent(x);
const gbp = (x) => moneyFromDecimal(x, "GBP");

/** An ordinary claim: two drivers, entered by hand. */
const claim = (price = "100.00") => costBridge({
  baseline: { unitPrice: gbp(price), annualVolume: 50_000 },
  requestedChange: p("9"),
  drivers: [
    { id: "material", label: "Steel bar", weight: p("42"), indexMovement: p("10"),
      source: "synthetic-index-A" },
    { id: "labour", label: "Direct labour", weight: p("18"), indexMovement: p("5"),
      source: "synthetic-index-B" },
  ],
});

/** Everything the split needs, answered. */
const SPLIT_ANSWERS = Object.freeze({
  firstQuantity: "20000",
  totalQuantity: "50000",
  secondFreight: "450.00",
  firstDate: "2026-11-02",
  secondDate: "2027-01-18",
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
    /* The case view draws the chain too, and the scene module is deliberately
       absent from the BW above: this file also holds that the chain stays
       silent without it. `supply-scene-wiring.test.mjs` exercises it. */
    fnSource("caseSceneHTML", app),
    fnSource("whatIfBase", app), fnSource("whatIfHTML", app),
    fnSource("whatIfPanelHTML", app), fnSource("whatIfWorkedHTML", app),
    fnSource("whatIfAxesHTML", app), fnSource("whatIfAdoptHTML", app),
    fnSource("whatIfAdoptedHTML", app), fnSource("whatIfOpen", app),
    fnSource("whatIfSet", app), fnSource("whatIfWork", app),
    fnSource("whatIfAdopt", app), fnSource("whatIfClear", app),
  ].join("\n")).runInContext(box);

  const run = (src) => vm.runInContext(src, box);

  return {
    box, els,
    calculate: (bridge) => { box.__b = bridge; run("_defResult=__b;"); },
    render: () => run("caseRender();"),
    html: () => els.get("case-view").innerHTML,
    open: (kind) => run(`whatIfOpen(${JSON.stringify(kind)});`),
    type: (field, value) =>
      run(`whatIfSet({ value: ${JSON.stringify(value)} }, ${JSON.stringify(field)});`),
    answer: (answers) => {
      for (const [field, value] of Object.entries(answers)) {
        run(`whatIfSet({ value: ${JSON.stringify(value)} }, ${JSON.stringify(field)});`);
      }
    },
    work: () => run("whatIfWork();"),
    adoptAs: (who) => { els.get("whatif-by").value = who; run("whatIfAdopt();"); },
    adoptMsg: () => els.get("whatif-adopt-msg").textContent || "",
    adopted: () => run("_whatIfAdopted.length"),
    /* Through JSON, because an array built inside the context is a different
       realm's Array and deepEqual compares prototypes. */
    adoptedBy: () => JSON.parse(
      run("JSON.stringify(_whatIfAdopted.map(function(s){return s.adopted.by;}))")),
    typed: (kind) => run(`JSON.stringify(_whatIfInputs[${JSON.stringify(kind)}] || {})`),
    clear: () => run("caseClear();"),
    result: () => box._defResult,
  };
}

let v;
beforeEach(() => {
  v = page();
  v.calculate(claim());
  v.render();
});

/* ------------------------------------------------------------ the offer */

describe("before a calculation exists", () => {
  test("there is no what-if block, because there is no plan to be an alternative to", () => {
    const bare = page();
    bare.render();
    assert.equal(bare.html(), "");
  });

  test("and the module missing is not a crash", () => {
    const bare = page();
    vm.runInContext("window.BW = { project: null };", bare.box);
    bare.calculate(claim());
    bare.render();
    assert.equal(bare.html(), "");
  });
});

describe("the three options on offer", () => {
  test("all three are named, with the words the module names them with", () => {
    for (const title of Object.values(SCENARIO_TITLE)) {
      assert.ok(v.html().includes(title), `${title} is not offered`);
    }
  });

  test("the plan they would be alternatives to is stated", () => {
    assert.match(v.html(), /100\.00 GBP x 50000/);
  });

  test("nothing is open until somebody opens one", () => {
    assert.equal(v.html().includes("Work it out"), false);
  });
});

/* -------------------------------------------------- questions, not figures */

describe("an open scenario asks its questions", () => {
  beforeEach(() => { v.open(SCENARIO.SPLIT); });

  test("every question the module requires is on screen, as a question", () => {
    for (const [, question] of SCENARIO_NEEDS[SCENARIO.SPLIT]) {
      assert.ok(v.html().includes(question), `${question} is not asked`);
    }
  });

  test("a field name never appears where a question belongs", () => {
    for (const [field] of SCENARIO_NEEDS[SCENARIO.SPLIT]) {
      assert.equal(v.html().includes(`>${field}<`), false, `${field} is shown as a label`);
    }
  });

  test("opening the same one again closes it", () => {
    v.open(SCENARIO.SPLIT);
    assert.equal(v.html().includes("Work it out"), false);
  });
});

describe("a scenario missing an input", () => {
  beforeEach(() => {
    v.open(SCENARIO.SPLIT);
    const { secondFreight, ...allButOne } = SPLIT_ANSWERS;
    v.answer(allButOne);
    v.work();
  });

  test("says it cannot be worked out", () => {
    assert.match(v.html(), /cannot be worked out yet/);
  });

  test("shows no figures at all — not the columns that could be answered", () => {
    /* The dates and the quantities were supplied, so a partial comparison is
       available and is exactly what must not appear. The typed values are
       still in their own boxes, which is why this reads the result region
       rather than the whole block: everything after the badge and the line
       naming the plan the scenario was explored against. */
    const said = v.html().split("WHAT IF")[1].split("100.00 GBP x 50000")[1];
    assert.equal(said.includes("2026-11-02"), false, "a date leaked into a blocked result");
    assert.equal(said.includes("20000"), false, "a quantity leaked into a blocked result");
    assert.equal(/\d+\.\d{2} GBP/.test(said), false,
      "money appeared in a scenario that is still waiting on an input");
  });

  test("names the one thing it is waiting for", () => {
    const result = v.html().split("WHAT IF")[1];
    assert.ok(result.includes("What does the second delivery cost in freight?"));
    assert.equal(result.includes("When would the first delivery arrive?"), false,
      "a question that has been answered is still being asked");
  });

  test("carries the badge that says it is not the plan", () => {
    assert.match(v.html(), /WHAT IF — NOT THE PLAN/);
  });

  test("offers nobody the chance to adopt it", () => {
    assert.equal(v.html().includes("Adopt this option"), false);
  });
});

/* ------------------------------------------------------- a worked scenario */

describe("a scenario with everything it needs", () => {
  beforeEach(() => {
    v.open(SCENARIO.SPLIT);
    v.answer(SPLIT_ANSWERS);
    v.work();
  });

  test("shows all four axes", () => {
    for (const axis of ["Cost", "Timing", "Service", "Still unresolved"]) {
      assert.ok(v.html().includes(axis), `${axis} is missing`);
    }
  });

  test("every figure in it is the module's, character for character", () => {
    const expected = whatIf(SCENARIO.SPLIT, {
      base: { id: "the claim on this screen", revision: "x",
              unitPrice: gbp("100.00"), quantity: 50_000 },
      inputs: SPLIT_ANSWERS,
    });
    for (const said of [expected.compared.cost.said, expected.compared.timing.said,
                        expected.compared.service.said]) {
      assert.ok(v.html().includes(said.replace(/—/g, "—")),
        `the page does not say what the module says: ${said}`);
    }
  });

  test("adds nothing up — there is no fifth heading summarising the four", () => {
    const result = v.html().split("WHAT IF")[1].split("Who is adopting this?")[0];
    const headings = [...result.matchAll(/class="eyebrow"[^>]*>([^<]+)</g)].map((m) => m[1]);
    assert.deepEqual(headings, ["Cost", "Timing", "Service", "Still unresolved"],
      "something is summarising four axes into one");
  });

  test("still says it is not the plan", () => {
    assert.match(v.html(), /WHAT IF — NOT THE PLAN/);
  });
});

describe("an input the arithmetic refuses", () => {
  beforeEach(() => {
    v.open(SCENARIO.EXPEDITE);
    v.answer({ quantity: "ten thousand", premiumPerUnit: "0.40",
               newDate: "2026-10-30", confirmedBy: "the carrier" });
    v.work();
  });

  test("is reported rather than thrown at the page", () => {
    assert.match(v.html(), /has to be a whole number/);
  });

  test("and the message names the field in the words the module refused it in", () => {
    assert.match(v.html(), /the quantity being expedited/);
  });

  test("leaves the case around it intact", () => {
    for (const title of Object.values(SECTION_TITLE)) {
      assert.ok(v.html().includes(title), `${title} went with the refusal`);
    }
  });
});

/* ------------------------------------------------------------- adopting */

describe("adopting one", () => {
  beforeEach(() => {
    v.open(SCENARIO.SPLIT);
    v.answer(SPLIT_ANSWERS);
    v.work();
  });

  test("without a name, nothing is recorded and the reason is on screen", () => {
    v.adoptAs("");
    assert.equal(v.adopted(), 0);
    assert.match(v.adoptMsg(), /record who/i);
  });

  test("with a name, it is recorded with its lineage", () => {
    v.adoptAs("category manager");
    assert.equal(v.adopted(), 1);
    assert.deepEqual(v.adoptedBy(), ["category manager"]);
    assert.ok(v.html().includes("Options taken"));
    assert.match(v.html(), /adopted by category manager/);
    assert.match(v.html(), /100\.00 GBP x 50000/);
  });

  test("and the plan it was an alternative to does not move", () => {
    const before = v.result();
    const priceBefore = moneyToDecimalString(before.unitPrice.baseline);
    v.adoptAs("category manager");
    assert.equal(v.result(), before, "the calculation object was replaced");
    assert.equal(moneyToDecimalString(v.result().unitPrice.baseline), priceBefore);
    assert.equal(v.result().annualVolume, 50_000);
  });

  test("the page says adopting changes nothing here", () => {
    assert.match(v.html(), /does not change the figures above/);
  });
});

describe("when the figures move underneath a scenario", () => {
  beforeEach(() => {
    v.open(SCENARIO.SPLIT);
    v.answer(SPLIT_ANSWERS);
    v.work();
    v.calculate(claim("104.00"));
    v.render();
  });

  test("it says the plan it described no longer exists", () => {
    assert.match(v.html(), /no longer exists/);
  });

  test("adopting it is refused", () => {
    v.adoptAs("category manager");
    assert.equal(v.adopted(), 0);
  });

  test("and one adopted earlier is marked rather than deleted", () => {
    const fresh = page();
    fresh.calculate(claim());
    fresh.render();
    fresh.open(SCENARIO.SPLIT);
    fresh.answer(SPLIT_ANSWERS);
    fresh.work();
    fresh.adoptAs("category manager");
    fresh.calculate(claim("104.00"));
    fresh.render();

    assert.equal(fresh.adopted(), 1);
    assert.match(fresh.html(), /The plan has moved since/);
  });
});

/* ---------------------------------------------------------- the typing */

describe("what was typed", () => {
  test("is kept per scenario, so switching between them loses nothing", () => {
    v.open(SCENARIO.SPLIT);
    v.type("firstQuantity", "20000");
    v.open(SCENARIO.EXPEDITE);
    v.type("quantity", "50000");
    v.open(SCENARIO.SPLIT);

    assert.match(v.typed(SCENARIO.SPLIT), /"firstQuantity":"20000"/);
    assert.match(v.typed(SCENARIO.EXPEDITE), /"quantity":"50000"/);
    assert.ok(v.html().includes('value="20000"'), "the box came back empty");
  });

  test("goes nowhere when no scenario is open", () => {
    v.type("firstQuantity", "20000");
    assert.equal(v.typed(SCENARIO.SPLIT), "{}");
  });

  test("is escaped on the way back onto the page", () => {
    v.open(SCENARIO.ALTERNATIVE);
    v.type("suitabilityReviewedBy", '"><script>alert(1)</script>');
    v.render();
    assert.equal(v.html().includes("<script>alert(1)"), false);
  });
});

describe("clearing the case", () => {
  test("takes the scenarios with it", () => {
    v.open(SCENARIO.SPLIT);
    v.answer(SPLIT_ANSWERS);
    v.work();
    v.adoptAs("category manager");
    v.clear();

    assert.equal(v.adopted(), 0);
    assert.equal(v.typed(SCENARIO.SPLIT), "{}");
    v.render();
    assert.equal(v.html().includes("Options taken"), false);
  });
});
