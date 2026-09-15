/**
 * A drawing that arrives after you have typed.
 *
 * `exApply` used to overwrite. It walked the confirmed rows and assigned
 * straight into the inputs, so somebody who typed their dimensions and then
 * found the PDF lost what they typed — silently, with no way back. The pack
 * forbids that twice:
 *
 *   "If a drawing is uploaded later, compare extracted values against existing
 *    inputs and show conflicts before changing anything."
 *   "Auto-fill only empty fields as unreviewed candidates."
 *
 * The first test in this file is the regression. The rest are the four
 * outcomes a comparison can have — fill, conflict, stale, same — and the rule
 * that nothing moves until a person chooses.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource, fnSource, markupOnly } from "../helpers/page.mjs";
import {
  scenario, withField, readiness, started as scStarted, labelOf,
  compareExtraction, acceptCandidates, SOURCE, ENTRY, GOAL, stateOf,
} from "../../src/studio/scenario.mjs";
import { newId, saveScenario, loadScenarios, loadScenario, deleteScenario }
  from "../../src/services/studio-store.mjs";

const app = readFileSync("app.js", "utf8");
const markup = markupOnly();

/** A row as reviewTable() produces one. */
const row = (field, label, value, { state = "confirmed", unit = "mm", page = 1 } = {}) =>
  ({ field, label, best: { value, state, unit, page, quote: `…${value}…` } });

/* ---------------------------------------------------------------- harness */

function studio({ values = {}, unknown = {}, edited = {},
                  readStartedAt = "2026-09-15T10:00:00.000Z" } = {}) {
  const els = new Map();
  const mk = (id, value = "") => ({ id, value, disabled: false, innerHTML: "", dataset: {},
    focus() {}, setAttribute() {}, style: {} });
  const IDS = ["sc-qty", "sc-grade", "sc-bw", "sc-bl", "sc-bt", "sc-s1", "sc-s2",
    "sc-kerf", "sc-edge", "sc-dv", "sc-unit", "sc-compare", "sc-drafts",
    "sc-draft-status", "scx-apply", "sc-upload-panel", "sc-entry-manual", "sc-entry-upload"];
  for (const id of IDS) els.set(id, mk(id, values[id] ?? (id === "sc-unit" ? "mm" : "")));

  const sandbox = {
    document: { getElementById: (id) => els.get(id) ?? null },
    console,
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    window: {
      BW: {
        scenario, withField, scReadiness: readiness, scStarted, scLabelOf: labelOf,
        compareExtraction, acceptCandidates,
        SC_SOURCE: SOURCE, SC_ENTRY: ENTRY, SC_GOAL: GOAL, scNewId: newId,
        saveScenario: () => ({ ok: true }), loadScenarios: () => [],
        loadScenario: () => null, deleteScenario: () => ({ ok: true }),
      },
    },
  };

  const help = app.slice(app.indexOf("var SC_FIELD_HELP = {"),
    app.indexOf("\n};", app.indexOf("var SC_FIELD_HELP = {")) + 3);
  const map = app.slice(app.indexOf("var EX_TO_FORM={"),
    app.indexOf("\n};", app.indexOf("var EX_TO_FORM={")) + 3);

  vm.createContext(sandbox);
  vm.runInContext([
    help, map,
    `var _scUnknown=${JSON.stringify(unknown)};`,
    "var _scSource={}; var _scEntry=\"manual\"; var _scScenarioId=null; var _scRevision=0;",
    `var _scEdited=${JSON.stringify(edited)};`,
    "function scTouched(id){ if(SC_FIELD_HELP[id]) _scEdited[id]=new Date().toISOString(); }",
    `var _scCompare=null; var _scReadStartedAt=${JSON.stringify(readStartedAt)};`,
    fnSource("scVal", app), fnSource("scEntry", app),
    fnSource("scFieldState", app), fnSource("scStateDot", app),
    fnSource("scRenderFieldStates", app), fnSource("scFormScenario", app),
    fnSource("scReadStarted", app), fnSource("scCompareDrawing", app),
    fnSource("scIdForField", app), fnSource("scAcceptOne", app),
    fnSource("scKeepOne", app), fnSource("scAcceptEmpty", app),
    fnSource("scDismissComparison", app), fnSource("scCompareRow", app),
    fnSource("scRenderComparison", app),
  ].join("\n"), sandbox);

  return {
    els,
    run: (code) => vm.runInContext(code, sandbox),
    el: (id) => els.get(id),
    compare: (rows) => vm.runInContext(`scCompareDrawing(${JSON.stringify(rows)})`, sandbox),
    panel: () => els.get("sc-compare").innerHTML,
  };
}

/* --------------------------------------------------- the regression itself */

describe("a drawing never overwrites what you typed", () => {
  test("exApply compares instead of assigning, on the drawing path", () => {
    const fn = fnSource("exApply", app);
    const at = fn.indexOf('if(which==="scx"');
    assert.notEqual(at, -1, "the drawing path does not compare");
    const assign = fn.indexOf("el.value=row.best.value");
    assert.ok(at < assign,
      "the comparison must come before the old assignment, or the assignment still runs");
    assert.match(fn.slice(at, at + 900), /return;/,
      "the drawing path must return rather than fall through to the overwrite");
  });

  test("the certificate path is deliberately unchanged", () => {
    // It fills a different form with its own review flow. Moving it here
    // would be a second change hiding inside this one.
    const fn = fnSource("exApply", app);
    assert.match(fn, /el\.value=row\.best\.value/, "the ctx path still assigns");
    assert.match(fn, /which==="scx"/, "and only scx is diverted");
  });

  test("comparing writes nothing into the form", () => {
    const s = studio({ values: { "sc-bw": "100" } });
    s.compare([row("width", "Width", "120")]);
    assert.equal(s.el("sc-bw").value, "100", "the typed value is still there");
  });
});

/* ------------------------------------------------------ the four outcomes */

describe("what a comparison can find", () => {
  test("an empty field is offered, not filled", () => {
    const s = studio();
    const c = s.compare([row("width", "Width", "120")]);
    assert.equal(c.comparison.fill.length, 1);
    assert.equal(s.el("sc-bw").value, "", "still empty until somebody says so");
  });

  test("a different value is a conflict, and says why", () => {
    const s = studio({ values: { "sc-bw": "100" } });
    const c = s.compare([row("width", "Width", "120")]);
    assert.equal(c.comparison.conflict.length, 1);
    assert.match(c.comparison.conflict[0].why, /the drawing says something different/);
  });

  test("the same value is neither, and is reported as agreement", () => {
    const s = studio({ values: { "sc-bw": "100" } });
    const c = s.compare([row("width", "Width", "100")]);
    assert.equal(c.comparison.same.length, 1);
    assert.equal(c.comparison.conflict.length, 0);
  });

  test("a field marked not-known is a conflict, because the person answered it", () => {
    const s = studio({ unknown: { "sc-bw": true } });
    const c = s.compare([row("width", "Width", "120")]);
    assert.equal(c.comparison.conflict.length, 1);
    assert.match(c.comparison.conflict[0].why, /you said this was not known/);
  });

  test("an unconfirmed reading is not offered at all", () => {
    // A candidate nobody ticked in the reader is not a proposal yet.
    const s = studio();
    const c = s.compare([row("width", "Width", "120", { state: "proposed" })]);
    assert.equal(c.comparison.fill.length, 0);
    // Spread: the array comes from inside the vm, so it carries that realm's
    // prototype and a strict deepEqual fails on that rather than on content.
    assert.deepEqual([...c.unusable], ["Width"]);
  });

  test("a reading with no field on this form is ignored rather than guessed at", () => {
    const s = studio();
    const c = s.compare([row("nosuchthing", "Something else", "9")]);
    assert.equal(c.comparison.fill.length, 0);
  });
});

/* ------------------------------------------------------- the stale rule */

describe("an edit made while the drawing was being read", () => {
  test("is left alone, and not even offered as a choice", () => {
    /* The person has seen the field more recently than the reader has. This
       is decided by comparing times, not by the order results come back in. */
    /* Edited at 10:30, read started at 10:00. The person has seen the field
       more recently than the reader has. */
    const s = studio({
      values: { "sc-bw": "115" },
      edited: { "sc-bw": "2026-09-15T10:30:00.000Z" },
      readStartedAt: "2026-09-15T10:00:00.000Z",
    });
    const c = s.compare([row("width", "Width", "120")]);
    assert.equal(c.comparison.stale.length, 1);
    assert.equal(c.comparison.conflict.length, 0);
    assert.equal(s.el("sc-bw").value, "115");
  });

  test("and the panel explains why it was skipped", () => {
    const s = studio({
      values: { "sc-bw": "115" },
      edited: { "sc-bw": "2026-09-15T10:30:00.000Z" },
    });
    s.compare([row("width", "Width", "120")]);
    s.run("scRenderComparison();");
    assert.match(s.panel(), /You changed this while the drawing was being read/);
  });

  test("a stale row offers no buttons, because there is nothing to decide", () => {
    const s = studio({
      values: { "sc-bw": "115" },
      edited: { "sc-bw": "2026-09-15T10:30:00.000Z" },
    });
    s.compare([row("width", "Width", "120")]);
    s.run("scRenderComparison();");
    const stale = s.panel().slice(s.panel().indexOf("bw-cmp--stale"));
    assert.equal(/data-do="scAcceptOne"/.test(stale), false);
  });
});

/* ---------------------------------------------------------- deciding */

describe("choosing what to do", () => {
  let s;
  beforeEach(() => {
    s = studio();
    s.compare([row("width", "Width", "120"), row("length", "Length", "60")]);
  });

  test("taking one writes only that one", () => {
    s.run('scAcceptOne("blankWidth");');
    assert.equal(s.el("sc-bw").value, "120");
    assert.equal(s.el("sc-bl").value, "", "the other was not touched");
  });

  test("an accepted value is the person's, not a pending candidate", () => {
    // Accepting is reviewing: they looked at it and said yes.
    s.run('scAcceptOne("blankWidth");');
    assert.equal(s.run('scFieldState("sc-bw")'), "User confirmed");
  });

  test("keeping yours removes the offer and changes nothing", () => {
    const before = s.el("sc-bw").value;
    s.run('scKeepOne("blankWidth");');
    assert.equal(s.el("sc-bw").value, before);
    s.run("scRenderComparison();");
    assert.equal(/blankWidth/.test(s.panel()), false, "it is no longer offered");
  });

  test("taking all empties takes every one of them", () => {
    s.run("scAcceptEmpty();");
    assert.equal(s.el("sc-bw").value, "120");
    assert.equal(s.el("sc-bl").value, "60");
  });

  test("accepting for a field marked not-known clears the mark", () => {
    const u = studio({ unknown: { "sc-bw": true } });
    u.compare([row("width", "Width", "120")]);
    u.run('scAcceptOne("blankWidth");');
    assert.equal(u.run('_scUnknown["sc-bw"]'), undefined);
    assert.equal(u.el("sc-bw").disabled, false);
  });

  test("dismissing clears the panel without applying anything", () => {
    s.run("scDismissComparison();");
    assert.equal(s.panel(), "");
    assert.equal(s.el("sc-bw").value, "");
  });
});

/* ------------------------------------------------------------ the panel */

describe("what the panel says", () => {
  test("it leads with the fact that nothing has changed", () => {
    const s = studio({ values: { "sc-bw": "100" } });
    s.run("_scReadStartedAt=null;");
    s.compare([row("width", "Width", "120")]);
    s.run("scRenderComparison();");
    assert.match(s.panel(), /Nothing has changed\. Your values are still on the form\./);
  });

  test("it shows both values side by side", () => {
    const s = studio({ values: { "sc-bw": "100" } });
    s.run("_scReadStartedAt=null;");
    s.compare([row("width", "Width", "120")]);
    s.run("scRenderComparison();");
    assert.match(s.panel(), /On the form:\s*<b>100<\/b>/);
    assert.match(s.panel(), /The drawing says:\s*<b>120<\/b>/);
  });

  test("it names the field the way the form does", () => {
    const s = studio();
    s.compare([row("width", "Width", "120")]);
    s.run("scRenderComparison();");
    assert.match(s.panel(), /Blank width/);
  });

  test("empty fields are described as overwriting nothing", () => {
    const s = studio();
    s.compare([row("width", "Width", "120")]);
    s.run("scRenderComparison();");
    assert.match(s.panel(), /These overwrite nothing/);
    assert.match(s.panel(), /marked as needing a check/);
  });

  test("agreement is reported rather than left silent", () => {
    const s = studio({ values: { "sc-bw": "100" } });
    s.run("_scReadStartedAt=null;");
    s.compare([row("width", "Width", "100")]);
    s.run("scRenderComparison();");
    assert.match(s.panel(), /1 value on the drawing agrees/);
  });

  test("a value from a document is escaped in text and in every attribute", () => {
    const s = studio();
    s.compare([row("width", "Width", '"><img src=x onerror=alert(1)>')]);
    s.run("scRenderComparison();");
    assert.equal(/<img/.test(s.panel()), false, "markup from a document reached the page");
    assert.match(s.panel(), /&lt;img/);
  });

  test("nothing at all to compare says so", () => {
    const s = studio();
    s.compare([]);
    s.run("scRenderComparison();");
    assert.match(s.panel(), /nothing this form could use/);
  });
});

/* -------------------------------------------------------------- the page */

describe("it is wired to the page", () => {
  const page = markup.slice(markup.indexOf('id="sc-mode-material"'), markup.indexOf('id="sc-mode-cert"'));

  test("there is somewhere for the decisions to appear", () => {
    assert.match(page, /id="sc-compare"/);
    assert.match(page, /role="region" aria-label="Differences between the drawing and what you entered"/);
  });

  test("it sits under the fields it is about, not in the result column", () => {
    const compare = page.indexOf('id="sc-compare"');
    const route = page.indexOf("4 &middot; The route");
    assert.ok(compare > 0 && compare < route, "the comparison must stay in the input column");
  });

  test("every decision is an action asked for by name", () => {
    for (const name of ["scAcceptOne", "scKeepOne", "scAcceptEmpty", "scDismissComparison"]) {
      assert.match(app, new RegExp(`${name}: function`), `${name} is not registered`);
    }
  });

  test("the read start is recorded when a drawing is opened", () => {
    assert.match(app, /if\(which==="scx"&&typeof scReadStarted==="function"\)scReadStarted\(\);/);
  });

  test("the model reaches the page through the mount", () => {
    const mount = readFileSync("mount.mjs", "utf8");
    for (const name of ["compareExtraction", "acceptCandidates", "scLabelOf"]) {
      assert.match(mount, new RegExp(`\\b${name}\\b`), `${name} is not exposed`);
    }
  });
});
