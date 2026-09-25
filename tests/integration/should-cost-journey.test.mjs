/**
 * The guided journey, and what it must never cost you.
 *
 * Two views over one scenario is a claim with a sharp edge: the moment
 * guided mode holds its own copy of anything, switching view starts losing
 * work, and it loses it quietly. So the first thing asserted here is the
 * mechanism rather than the behaviour — that the panels are *moved* between
 * layouts and never rebuilt — because that is what makes the preservation
 * structural instead of something a later change can break without noticing.
 *
 * The rest is the promise the brief makes to somebody who does not know
 * what a should-cost is: that a field they cannot answer produces a question
 * to ask rather than a dead end, that a partial result still says what it
 * established, and that nothing is ever filled in on their behalf.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource, fnSource as pageFnSource } from "../helpers/page.mjs";

const html = pageSource();
const app = readFileSync("app.js", "utf8");
const fnSource = (name) => pageFnSource(name, app);

/** The should-cost section of the page, without its neighbours. */
const page = html.slice(html.indexOf('id="page-shouldcost"'),
                        html.indexOf("<!-- ============ WORKSPACE"));

/* ------------------------------------------------- one scenario, two views */

describe("the two views are one scenario", () => {
  test("every panel exists exactly once in the markup", () => {
    /* The whole preservation guarantee rests on this. Two copies of a panel
       would mean two copies of every input inside it, and the second one a
       person typed into would be the one nothing read. */
    const names = [...page.matchAll(/data-sc-panel="([a-z]+)"/g)].map((m) => m[1]);
    const seen = new Set();
    for (const n of names) {
      assert.equal(seen.has(n), false, `the panel "${n}" appears twice in the markup`);
      seen.add(n);
    }
    assert.ok(names.length >= 10, `only ${names.length} panels are addressable`);
  });

  test("every panel the guided steps ask for is one the markup has", () => {
    const declared = new Set([...page.matchAll(/data-sc-panel="([a-z]+)"/g)].map((m) => m[1]));
    /* The goal question is the one panel with no expert-layout home: in that
       view the answer is "all of it", which is what three columns show. */
    declared.add("goal");

    const steps = fnSource("scRenderGuided") + app.slice(app.indexOf("var SC_STEPS="),
                                                         app.indexOf("function scStepById"));
    const asked = [...steps.matchAll(/panels:\[([^\]]*)\]/g)]
      .flatMap((m) => m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")))
      .filter(Boolean);

    assert.ok(asked.length > 0, "no step names any panel");
    for (const name of asked) {
      assert.ok(declared.has(name), `a step asks for the panel "${name}", which the markup has no element for`);
    }
  });

  test("switching view moves panels and never rebuilds them", () => {
    const src = fnSource("scView") + fnSource("scPanelsHome") + fnSource("scRenderGuided");
    /* insertBefore and appendChild move a live node. innerHTML on a panel
       host would replace it, and every value inside it would go. */
    assert.match(src, /insertBefore/);
    assert.doesNotMatch(fnSource("scPanelsHome"), /innerHTML/,
      "going home writes markup instead of moving the element, so inputs would be recreated empty");
    assert.doesNotMatch(fnSource("scView"), /\.value\s*=/,
      "switching view writes to a field, so it is copying state rather than moving the field");
  });

  test("the stage is emptied without emptying the panels in it", () => {
    /* scRenderGuided clears its own host, which is why every panel has to be
       put home *first*. Clearing the host while a panel is still inside it is
       exactly how this would destroy somebody's typing. */
    const src = fnSource("scRenderGuided");
    const home = src.indexOf("scPanelsHome()");
    const clear = src.indexOf('stage.innerHTML=""');
    assert.notEqual(home, -1, "the panels are never sent home");
    assert.notEqual(clear, -1, "the stage is never cleared");
    assert.ok(home < clear,
      "the stage is cleared before the panels are moved out of it, which destroys their inputs");
  });

  test("where each panel lives is recorded once, before anything moves", () => {
    const src = fnSource("scCapturePanels");
    assert.match(src, /if\(_scPanelHome\) return;/,
      "recapturing after a move would record the guided stage as a panel's home");
    /* A position, not a neighbour. Adjacent panels move together, so a
       recorded sibling is often still on the guided stage when the first
       panel is put back — and insertBefore against a node that is no longer
       a child throws. tests/integration/should-cost-view-switch.test.mjs
       executes that path; this pins the mechanism that makes it work. */
    assert.match(src, /index:parent\?Array\.prototype\.indexOf/,
      "the home position is not recorded as an index, so restoring depends on a live sibling");
    assert.match(fnSource("scPanelsHome"), /back\.sort/,
      "panels are restored in arbitrary order, so their recorded indices stop meaning anything");
    assert.match(fnSource("scBind"), /scCapturePanels\(\)/);
  });

  test("both views are offered, and neither is described as the fallback", () => {
    assert.match(page, /data-do="scView" data-a="guided"/);
    assert.match(page, /data-do="scView" data-a="expert"/);
    assert.match(page, /Everything you have entered is kept when you switch/);
  });

  test("the movable wrapper takes no layout, except where it is itself a panel", () => {
    /* Each [data-sc-panel] is a handle to pick a panel up by. Given a box of
       its own it would sit inside the column's flex gap *and* keep the panel's
       own margin, spacing the approved layout twice as far apart. The one
       exception is the opening question, which carries the handle directly
       and would lose its border to the same rule. */
    const css = readFileSync("studio-enhancements.css", "utf8");
    assert.match(css, /\[data-sc-panel\]:not\(\.bw-panel\)\{display:contents\}/);
    const both = page.match(/class="bw-panel"[^>]*data-sc-panel=|data-sc-panel="[a-z]+"[^>]*class="bw-panel"/g) || [];
    assert.equal(both.length, 1,
      `${both.length} elements are both a panel and a handle; the :not() exception covers one`);
  });

  test("the summary sits outside both hosts, so material risks survive a switch", () => {
    /* Inside the guided host it would disappear the moment somebody switched
       to the expert workspace, taking the unanswered fields and the stated
       assumptions with it. Both are material risks and the brief requires
       them in both views. */
    const summary = page.indexOf('id="sc-guided-summary"');
    const guided = page.indexOf('<div id="sc-guided" hidden>');
    const expert = page.indexOf('id="sc-expert"');
    assert.notEqual(summary, -1, "there is no summary");
    assert.ok(summary < guided, "the summary is inside the guided host");
    assert.ok(summary < expert, "the summary is inside the expert layout");
  });

  test("the summary is redrawn in whichever view is on screen", () => {
    const bind = fnSource("scBind");
    assert.doesNotMatch(bind, /_scView==="guided"\)scRenderSummary/,
      "the summary only follows typing in the guided view, so an expert's risks go stale");
    assert.match(bind, /scRenderSummary\(\)/);
  });

  test("the summary names what is unanswered and what is only assumed", () => {
    const src = fnSource("scRenderSummary");
    assert.match(src, /Unanswered on purpose/);
    assert.match(src, /Nothing has been assumed in their place/);
    assert.match(src, /Resting on/, "a stated assumption is not surfaced as a risk");
  });
});

/* --------------------------------------------------- the optional model */

describe("the visual model is optional, and now reads as optional", () => {
  test("the builder is hidden until it is asked for", () => {
    assert.match(page, /<div class="bw-panel" id="sc-builder" hidden/);
    assert.match(page, /data-do="scShowBuilder"[^>]*aria-expanded="false"/);
  });

  test("it opens the column with the offer, not with the tool", () => {
    const call = page.indexOf('id="sc-model-call"');
    const builder = page.indexOf('id="sc-builder"');
    const part = page.indexOf('data-sc-panel="part"');
    assert.notEqual(call, -1, "there is no explicit way to add a model");
    assert.ok(call < builder, "the builder comes before the offer to add one");
    assert.ok(call < part, "the model call is not at the top of the column it belongs to");
  });

  test("the preview lives with the builder, not in a column of its own", () => {
    /* An empty viewport at the top of the middle column read as a feature
       that had failed rather than one nobody had asked for. */
    const viewport = page.indexOf('id="studio-viewport"');
    const builder = page.indexOf('id="sc-builder"');
    const route = page.indexOf('data-sc-panel="route"');
    assert.ok(viewport > builder, "the viewport is no longer inside the builder");
    assert.ok(viewport < route, "the viewport escaped into the route column");
  });

  test("nothing in the costing path requires a model", () => {
    /* The claim on screen. If the builder ever became a prerequisite this
       sentence would be the lie, so it is asserted rather than trusted. */
    assert.match(page, /Nothing\s+on this page needs one/);
    assert.doesNotMatch(fnSource("scRun"), /_scModel/,
      "the costing reads the model, so a model has quietly become required");
  });
});

/* ------------------------------------------- what a missing answer produces */

describe("a field somebody cannot answer", () => {
  const help = app.slice(app.indexOf("var SC_FIELD_HELP = {"), app.indexOf("\n};", app.indexOf("var SC_FIELD_HELP = {")));

  test("every field carries a question, a reason, a place to look and who to ask", () => {
    /* The ids carry digits — sc-s1, sc-s2 — so a letters-only class silently
       finds eight of ten and the assertion below passes on a short list. */
    const ids = [...help.matchAll(/^\s*"(sc-[a-z0-9]+)":/gm)].map((m) => m[1]);
    assert.ok(ids.length >= 10, `only ${ids.length} fields are explained`);
    for (const key of ["means", "where", "why", "ask", "askWho", "blocks"]) {
      const count = (help.match(new RegExp(`${key}:`, "g")) || []).length;
      assert.ok(count >= ids.length,
        `${count} of ${ids.length} fields have "${key}" — a field without it renders "undefined"`);
    }
  });

  test("the question is a sentence somebody could send, not a field name", () => {
    const asks = [...help.matchAll(/ask:"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(asks.length >= 10);
    for (const a of asks) {
      assert.match(a, /\?$/, `"${a}" is not a question`);
      assert.ok(a.split(" ").length >= 5, `"${a}" is too short to send to anybody`);
    }
  });

  test("what survives a gap is derived, never promised loosely", () => {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext([
      fnSource("scStillAvailable"),
      `var SC_OUTPUT_SAID={plan:"the quantity and stock plan",mass:"the purchased weight",cost:"the cost per part"};`,
      `var SC_FIELD_HELP={"a":{blocks:["plan"]},"b":{blocks:["mass","cost"]},"c":{blocks:[]}};`,
      `function scBlocksOf(id){var h=SC_FIELD_HELP[id];return h&&h.blocks?h.blocks:[];}`,
    ].join("\n"), ctx);

    /* Blocking the plan blocks everything downstream of it. Naming the cost
       as still available while the plan is blocked would be a false promise,
       and it is the specific false promise a per-field list invites. */
    const plan = vm.runInContext('scStillAvailable("a")', ctx);
    assert.match(plan, /Nothing can be worked out/);

    const mass = vm.runInContext('scStillAvailable("b")', ctx);
    assert.match(mass, /Still available without it: the quantity and stock plan/);
    assert.match(mass, /Blocked: the purchased weight and the cost per part/);

    const none = vm.runInContext('scStillAvailable("c")', ctx);
    assert.match(none, /Nothing here is blocked by it/);
  });

  test("a declared unknown stops the run and offers the question instead", () => {
    const src = fnSource("scRun");
    const at = src.indexOf("var unknown=scUnknownFields();");
    assert.notEqual(at, -1);
    const block = src.slice(at, at + 700);
    assert.match(block, /return;/, "it falls through to a partial answer");
    assert.match(block, /scUnknownAdviceHTML\(\)/, "it refuses without saying what to do about it");
  });

  test("nothing anywhere fills an unknown in on your behalf", () => {
    /* The one rule that must survive every convenience added to this screen. */
    assert.doesNotMatch(fnSource("scUnknownAdviceHTML"), /value\s*=/);
    assert.doesNotMatch(fnSource("scGapCardHTML"), /value\s*=/);
  });
});

/* ------------------------------------------------------------ the examples */

describe("two examples, and they differ by one thing", () => {
  const src = fnSource("scExample");

  test("both are reachable before any field is filled in", () => {
    assert.match(page, /data-do="scExample" data-a="complete"/);
    assert.match(page, /data-do="scExample" data-a="incomplete"/);
    const examples = page.indexOf('class="bw-examples"');
    const firstField = page.indexOf('id="sc-qty"');
    assert.ok(examples < firstField, "the examples sit below the form they exist to replace");
  });

  test("each says which it is", () => {
    assert.match(page, /Complete example/);
    assert.match(page, /Example with a gap/);
  });

  test("the incomplete one is missing an amount, never carrying a zero", () => {
    /* A zero reads as free. The gap has to stay a gap all the way down. */
    assert.match(src, /manufacturing:gap/);
    assert.match(src, /amount:""/);
    assert.doesNotMatch(src, /manufacturing:\s*\{on:true,amount:"0/);
  });

  test("they differ by the manufacturing amount and nothing else", () => {
    /* If the two examples differed in more than one input, the difference on
       screen would not be attributable to the gap, which is the entire point
       of showing them side by side. */
    const uses = (src.match(/\bgap\b/g) || []).length;
    assert.ok(uses <= 4, `"gap" is consulted ${uses} times, so the examples differ in more than one place`);
  });

  test("loading one clears what the last scenario could not answer", () => {
    assert.match(src, /_scUnknown=\{\}/,
      "a previous scenario's unknowns would block the example for the wrong reason");
  });

  test("the result says the figures are synthetic", () => {
    assert.match(fnSource("scVerdictHTML"), /synthetic example/);
    assert.match(fnSource("scVerdictHTML"), /Every figure is made up; the arithmetic is real/);
  });
});

/* -------------------------------------------------------------- the verdict */

describe("the result leads with what it establishes", () => {
  const src = fnSource("scVerdictHTML");

  test("it reads the plan and the cost, and computes nothing", () => {
    /* The rule the whole product rests on. A panel that re-derived a figure
       to summarise it would be a second implementation of the arithmetic. */
    for (const bad of [/\+\s*Number\(/, /parseFloat/, /\*\s*100/, /\/\s*100/]) {
      assert.doesNotMatch(src, bad, `the verdict computes something (${bad})`);
    }
  });

  test("a partial cost is never called a should-cost", () => {
    assert.match(src, /which is a subtotal and not a should-cost/);
    assert.match(src, /The cost per part is withheld/);
  });

  test("it says what is concluded before what is open", () => {
    assert.ok(src.indexOf("What this tells you") < src.indexOf("What is still open"));
    assert.ok(src.indexOf("What is still open") < src.indexOf("The most useful next thing"));
  });

  test("the three actions the brief asks for are offered", () => {
    for (const act of ["scSeeWorking", "scAskQuestions", "scExportReview"]) {
      assert.match(src, new RegExp(`data-do="${act}"`), `no action for ${act}`);
    }
  });

  test("the working is available but not in the way", () => {
    assert.match(fnSource("scPlanHTML"), /<details id="sc-working"/);
    assert.match(fnSource("scSeeWorking"), /d\.open=true/);
  });
});

/* ---------------------------------------------------- the questions to ask */

describe("the questions this scenario is waiting on", () => {
  const src = fnSource("scAskQuestions");

  test("they are grouped by who can answer them", () => {
    assert.match(src, /byWho/);
    assert.match(src, /For '\+ciEsc\(who\)/);
  });

  test("nothing is sent, and it says so", () => {
    assert.match(src, /Nothing is sent from here/);
    assert.doesNotMatch(src, /fetch\(/);
  });

  test("an empty list says so rather than showing an empty panel", () => {
    assert.match(src, /Nothing is outstanding/);
  });

  test("a cost element switched on with no amount becomes a question", () => {
    assert.match(src, /a\.costGaps\.forEach/);
    assert.match(src, /Can you break out /);
  });
});

/* -------------------------------------------- the handover, and its labels */

describe("the review package carries the commercial basis", () => {
  test("the export passes it, and passes null when nothing was worked out", () => {
    assert.match(fnSource("scExportReview"), /scenario:scCommercialBasis\(\)/);
    assert.match(fnSource("scCommercialBasis"), /if\(!B\|\|!_scLast\|\|!_scLast\.plan\) return null;/);
  });

  test("every figure in it is read back, never recomputed", () => {
    const src = fnSource("scCommercialBasis");
    for (const bad of [/parseFloat/, /Number\(/, /[^=!<>]\+\s*\(?[a-z]+\.amount/]) {
      assert.doesNotMatch(src, bad, `the basis computes something (${bad})`);
    }
  });

  test("only values a person accepted are listed as sources", () => {
    const src = fnSource("scCommercialBasis");
    assert.match(src, /REVIEW_DISPOSITION\.CONFIRMED/);
    assert.match(src, /REVIEW_DISPOSITION\.CORRECTED/);
    assert.match(src, /return;/, "unaccepted proposals are not filtered out");
  });

  test("switched-off elements are recorded as decisions, not omitted", () => {
    assert.match(fnSource("scCommercialBasis"), /excluded\.push\(def\.label\)/);
  });

  test("the notes distinguish the four kinds of claim", () => {
    const mod = readFileSync("src/studio/review-export.mjs", "utf8");
    for (const kind of ["Calculated", "Asserted", "Assumed", "Illustration"]) {
      assert.ok(mod.includes(`**${kind}**`), `the notes never define "${kind}"`);
    }
    assert.match(mod, /Nobody technical has checked any of this yet/);
    assert.match(mod, /A person accepting a value is not a check that it is technically right/);
  });

  test("an incomplete cost is labelled as not a should-cost in the package too", () => {
    const mod = readFileSync("src/studio/review-export.mjs", "utf8");
    assert.match(mod, /\*\*This is not a should-cost\.\*\*/);
    assert.match(mod, /must not be quoted as a total/);
  });

  test("the route in the package is proposed, and says it wants confirming", () => {
    const mod = readFileSync("src/studio/review-export.mjs", "utf8");
    assert.match(mod, /The process route — proposed, not confirmed/);
    assert.match(mod, /Confirming or correcting it is/);
  });
});
