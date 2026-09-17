/**
 * The case view, run against the page's own code.
 *
 * This is the first surface in Phase 2, and the gate it exists to meet is
 * `specs/02`'s: *"a junior user explains the issue, sees missing evidence,
 * chooses an action and produces a draft management brief."* The first three
 * of those are what this checks, end to end — from a real cost bridge, not a
 * fixture of claims.
 *
 * The behaviour that matters most is the one the whole phase turns on: a
 * figure resting on an unconfirmed assumption does not appear on screen at
 * all. Not in grey, not with an asterisk, not as a dash. A placeholder where
 * a figure would go is a figure as far as a reader in a hurry is concerned.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { fnSource, pageSource } from "../helpers/page.mjs";
import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { ratioFromPercent, moneyFromDecimal } from "../../src/calc/exact.mjs";
import { assumptionsToVerify } from "../../src/calc/provenance.mjs";
import { narrative, sectionOf, SECTION_TITLE } from "../../src/case/narrative.mjs";
import { quoteCase, needsOf } from "../../src/case/from-quote.mjs";
import {
  project, hiddenSaid, ROLE, ROLES, ROLE_TITLE, DEPTH, DEPTHS, SCOPE_SAID,
} from "../../src/case/projection.mjs";

const app = readFileSync("app.js", "utf8");
const p = (x) => ratioFromPercent(x);
const gbp = (x) => moneyFromDecimal(x, "GBP");

/** Two drivers entered by hand: the ordinary case, where shares are assumed. */
const handEntered = () => costBridge({
  baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
  requestedChange: p("9"),
  drivers: [
    { id: "material", label: "Steel bar", weight: p("42"), indexMovement: p("10"),
      source: "synthetic-index-A" },
    { id: "labour", label: "Direct labour", weight: p("18"), indexMovement: p("5"),
      source: "synthetic-index-B" },
  ],
});

function page() {
  const els = new Map();
  els.set("case-view", { id: "case-view", innerHTML: "" });
  els.set("def-supplier", { id: "def-supplier", value: "Northgate (synthetic)" });

  const box = {
    document: { getElementById: (id) => els.get(id) ?? null },
    console,
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    scVal: (id) => String((els.get(id) || {}).value || ""),
    window: {
      BW: {
        narrative, sectionOf, SECTION_TITLE, quoteCase, needsOf, assumptionsToVerify,
        project, hiddenSaid, ROLE, ROLES, ROLE_TITLE, DEPTH, DEPTHS, SCOPE_SAID,
      },
    },
    _defResult: null,
  };
  vm.createContext(box);
  new vm.Script([
    "var _caseRole=null; var _caseDepth=null;",
    fnSource("caseClear", app), fnSource("caseLabelFor", app),
    fnSource("caseNarrative", app), fnSource("caseRender", app),
    fnSource("caseControlsHTML", app), fnSource("caseSectionHTML", app),
    fnSource("caseClaimHTML", app), fnSource("caseIsAssumption", app),
    fnSource("caseFigureText", app), fnSource("caseFootHTML", app),
    fnSource("caseSetRole", app), fnSource("caseSetDepth", app),
    fnSource("caseConfirm", app),
    "var _caseConfirmed=Object.create(null);",
  ].join("\n")).runInContext(box);

  return {
    box, els,
    calculate: (bridge) => { box.__b = bridge; vm.runInContext("_defResult=__b;", box); },
    render: () => vm.runInContext("caseRender();", box),
    html: () => els.get("case-view").innerHTML,
    confirm: (id) => vm.runInContext(`caseConfirm(${JSON.stringify(id)});`, box),
    setRole: (r) => vm.runInContext(`caseSetRole({ value: ${JSON.stringify(r)} });`, box),
    setDepth: (d) => vm.runInContext(`caseSetDepth({ value: ${JSON.stringify(d)} });`, box),
    clear: () => vm.runInContext("caseClear();", box),
    confirmed: () => vm.runInContext("Object.keys(_caseConfirmed)", box),
  };
}

let v;
beforeEach(() => { v = page(); });

/* ---------------------------------------------------------- nothing yet */

describe("before anything is calculated", () => {
  test("it shows nothing rather than an empty shell", () => {
    v.render();
    assert.equal(v.html(), "");
  });

  test("and it does not throw when the engine is missing", () => {
    const bare = page();
    vm.runInContext("window.BW = {};", bare.box);
    bare.calculate(handEntered());
    bare.render();
    assert.equal(bare.html(), "");
  });
});

/* -------------------------------------------------------- the five sections */

describe("the case on screen", () => {
  beforeEach(() => { v.calculate(handEntered()); v.render(); });

  test("all five headings are there", () => {
    for (const title of Object.values(SECTION_TITLE)) {
      assert.ok(v.html().includes(title), `${title} is missing`);
    }
  });

  test("the supplier named on the form is the supplier in the sentence", () => {
    assert.match(v.html(), /Northgate \(synthetic\) has asked for an increase/);
  });

  test("the unsupported part is stated, because nothing may hide it", () => {
    assert.match(v.html(), /not supported by any driver given/);
  });

  test("and the scope sentence says role changes how much, not what you may see", () => {
    assert.match(v.html(), /how much is shown, not what you are allowed to see/);
  });
});

/* -------------------------------------- the rule the whole phase turns on */

describe("a figure waits for its assumption", () => {
  beforeEach(() => { v.calculate(handEntered()); v.render(); });

  test("no figure appears while the shares are assumed", () => {
    /* The percentages and the money both. If any of them is on screen, the
       withholding happened in a module and not on the page. */
    const html = v.html();
    assert.equal(/\d+\.\d{2}%/.test(html), false, "a percentage is on screen");
    assert.equal(/\d+\.\d{2} GBP/.test(html), false, "a money figure is on screen");
  });

  test("and nothing stands in its place", () => {
    /* Not a dash, not a greyed number, not an asterisk. A placeholder where a
       figure would go is a figure as far as a reader in a hurry is concerned.

       Scoped to where a figure would actually be — the bold element the view
       renders one into. The first version searched the whole panel and
       matched the em dashes in ordinary prose, which is a test failing on
       punctuation rather than on behaviour. */
    const figures = v.html().match(/<b[^>]*>([^<]*)<\/b>/g) || [];
    for (const f of figures) {
      assert.equal(/&mdash;|—|\*|n\/a|TBC|\?\?/i.test(f), false, `a placeholder is shown: ${f}`);
    }
  });

  test("it says what it is waiting for instead", () => {
    assert.match(v.html(), /We still need/);
    assert.match(v.html(), /share of unit cost/);
  });

  test("confirming one is not enough", () => {
    const ids = needsOf(handEntered());
    assert.ok(ids.length >= 2);
    v.confirm(ids[0]);
    assert.equal(/\d+\.\d{2} GBP/.test(v.html()), false, "one tick released the figures");
  });

  test("confirming all of them brings the figures out", () => {
    for (const id of needsOf(handEntered())) v.confirm(id);
    assert.match(v.html(), /\d+\.\d{2} GBP/);
    assert.match(v.html(), /\d+\.\d{2}%/);
    assert.equal(/We still need/.test(v.html()), false);
  });

  test("each assumption offers the tick, and says so once ticked", () => {
    const ids = needsOf(handEntered());
    assert.match(v.html(), new RegExp(`data-a="${ids[0]}"`));
    assert.match(v.html(), /I have checked this/);

    v.confirm(ids[0]);
    assert.match(v.html(), /confirmed/);
  });

  test("a tick is recorded against the assumption it names, not a position", () => {
    /* So re-ordering the list cannot tick the wrong one. */
    const ids = needsOf(handEntered());
    v.confirm(ids[1]);
    assert.deepEqual([...v.confirmed()], [ids[1]]);
  });

  test("a new calculation starts with nothing confirmed", () => {
    /* What was checked about the last supplier's shares says nothing about
       this one's. */
    for (const id of needsOf(handEntered())) v.confirm(id);
    assert.ok([...v.confirmed()].length > 0);
    v.clear();
    assert.deepEqual([...v.confirmed()], []);
    assert.equal(v.html(), "");
  });
});

/* ------------------------------------------------------------ the switches */

describe("role and depth", () => {
  beforeEach(() => { v.calculate(handEntered()); v.render(); });

  test("every role is offered by a name a person would recognise", () => {
    for (const role of ROLES) {
      assert.ok(v.html().includes(ROLE_TITLE[role]), role);
    }
  });

  test("a junior is given one next step", () => {
    v.setRole(ROLE.JUNIOR);
    const html = v.html();
    const next = html.slice(html.indexOf("Recommended next step"),
                            html.indexOf("Evidence and missing information"));
    assert.equal((next.match(/<li/g) || []).length, 1);
  });

  test("choosing a role moves to that role's depth", () => {
    v.setRole(ROLE.JUNIOR);
    assert.match(v.html(), new RegExp(`value="${DEPTH.GUIDED}" selected`));
  });

  test("and it moves even when a depth had already been chosen", () => {
    /* The case the reset exists for, and the one the test above could not
       see: with no depth chosen, the role default applies either way.

       Switching role is switching context, so the new role's default takes
       over. Keeping the old choice would make picking "junior buyer" appear
       to do nothing, which is the worse of the two annoyances. */
    v.setDepth(DEPTH.TECHNICAL);
    assert.match(v.html(), new RegExp(`value="${DEPTH.TECHNICAL}" selected`));

    v.setRole(ROLE.JUNIOR);
    assert.match(v.html(), new RegExp(`value="${DEPTH.GUIDED}" selected`),
      "the previous depth survived a change of role");
  });

  test("and choosing a depth afterwards keeps it", () => {
    /* `specs/05`: a role picks a starting point, and the user may override it
       at any time. */
    v.setRole(ROLE.JUNIOR);
    v.setDepth(DEPTH.TECHNICAL);
    assert.match(v.html(), new RegExp(`value="${DEPTH.TECHNICAL}" selected`));
  });

  test("technical shows more than standard, and says nothing is hidden at it", () => {
    v.setDepth(DEPTH.STANDARD);
    const fewer = (v.html().match(/<li/g) || []).length;
    assert.match(v.html(), /further point/);

    v.setDepth(DEPTH.TECHNICAL);
    const more = (v.html().match(/<li/g) || []).length;
    assert.ok(more > fewer, `${more} is not more than ${fewer}`);
    assert.equal(/further point/.test(v.html()), false);
  });

  test("no depth ever drops the unsupported part", () => {
    /* The material rule, on the screen rather than in the module. */
    for (const role of ROLES) {
      for (const depth of DEPTHS) {
        v.setRole(role);
        v.setDepth(depth);
        assert.match(v.html(), /not supported by any driver given/, `${role}/${depth}`);
      }
    }
  });
});

/* ------------------------------------------------------------- the wiring */

describe("it is wired the way the page requires", () => {
  test("the controls ask for actions the table registers", () => {
    /* An inline handler will not run under this CSP; a name in markup has to
       be in the table or the control silently does nothing. */
    const html = pageSource();
    for (const name of ["caseSetRole$self", "caseSetDepth$self", "caseConfirm"]) {
      assert.ok(html.includes(`${name}:`), `${name} is not registered`);
    }
  });

  test("the calculation draws it and clears the previous confirmations", () => {
    assert.match(fnSource("defCalc", app), /_caseConfirmed=Object\.create\(null\)/);
    assert.match(fnSource("defCalc", app), /caseRender\(\)/);
  });

  test("both selects carry a name of their own", () => {
    /* The wrapping label names them in the DOM; the source check cannot see a
       wrapper built by concatenation, and is right not to guess. */
    assert.match(fnSource("caseControlsHTML", app), /aria-label="Read this case as"/);
    assert.match(fnSource("caseControlsHTML", app), /aria-label="How much detail to show"/);
  });

  test("the view decides nothing", () => {
    /* Which claims, whether a figure may appear, and what the sentence says
       were all settled before this ran. A surface that re-derived any of them
       would be a second opinion. */
    const src = [fnSource("caseRender", app), fnSource("caseClaimHTML", app)]
      .join("\n").replace(/\/\*[\s\S]*?\*\//g, " ");
    assert.equal(/costBridge|moneyScale|ratioMul|\.minor\s*[-+*/]/.test(src), false,
      "the view does arithmetic");
  });

  test("a value reaching the page is escaped", () => {
    const nasty = page();
    nasty.els.get("def-supplier").value = '<img src=x onerror=alert(1)>';
    nasty.calculate(handEntered());
    nasty.render();
    assert.equal(/<img src=x/.test(nasty.html()), false);
    assert.match(nasty.html(), /&lt;img/);
  });
});
