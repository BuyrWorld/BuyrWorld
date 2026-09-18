/**
 * Saving unfinished work from the page, and picking it up again.
 *
 * The refusal message in the previous slice told people they could save a
 * draft. This is the slice that makes that true, so the tests are mostly about
 * the round trip: what is on the form when you come back, and whether the
 * things that are deliberately not values — blank, and "I don't know" — come
 * back as themselves.
 *
 * The form is the source of truth while you type; the scenario is what gets
 * written down. Nothing keeps a third copy, because two copies of the same
 * fact is how one of them goes stale.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource, fnSource, markupOnly } from "../helpers/page.mjs";
import {
  scenario, withField, readiness, started as scStarted,
  SOURCE, ENTRY, GOAL,
} from "../../src/studio/scenario.mjs";
import {
  newId, saveScenario, loadScenarios, loadScenario, deleteScenario,
} from "../../src/services/studio-store.mjs";

const app = readFileSync("app.js", "utf8");
const markup = markupOnly();

/** A localStorage stand-in shared by one test. */
function memory() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/* ---------------------------------------------------------------- harness */

const FIELD_IDS = ["sc-qty", "sc-grade", "sc-bw", "sc-bl", "sc-bt",
  "sc-s1", "sc-s2", "sc-kerf", "sc-edge", "sc-dv"];

/** Drive the page's draft code over a stub form and a real store. */
function studio({ values = {}, unknown = {} } = {}) {
  const store = memory();
  const els = new Map();
  const mk = (id, value = "") => ({ id, value, disabled: false, innerHTML: "", dataset: {},
    focus() { this.focused = true; }, setAttribute() {}, style: {} });

  for (const id of [...FIELD_IDS, "sc-unit", "sc-drafts", "sc-draft-status",
    "sc-upload-panel", "sc-entry-manual", "sc-entry-upload", "sc-out",
    "sc-pw", "sc-pl", "sc-pt", "sc-ds", "sc-pack", "sc-moq", "sc-cont", "sc-rot", "sc-amort"]) {
    els.set(id, mk(id, values[id] ?? (id === "sc-unit" ? "mm" : "")));
  }

  const sandbox = {
    document: { getElementById: (id) => els.get(id) ?? null },
    console,
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    /* The real modules, bound to this test's store, exactly as mount.mjs
       exposes them to the page. */
    window: {
      BW: {
        scenario, withField, scReadiness: readiness, scStarted,
        SC_SOURCE: SOURCE, SC_ENTRY: ENTRY, SC_GOAL: GOAL,
        scNewId: newId,
        saveScenario: (s) => saveScenario(s, store),
        loadScenarios: () => loadScenarios(store),
        loadScenario: (id) => loadScenario(id, store),
        deleteScenario: (id) => deleteScenario(id, store),
      },
    },
    _scCosts: {}, _scStages: [],
    scRenderCosts() {}, scRenderStages() {},
  };

  const help = app.slice(app.indexOf("var SC_FIELD_HELP = {"), app.indexOf("\n};", app.indexOf("var SC_FIELD_HELP = {")) + 3);

  vm.createContext(sandbox);
  vm.runInContext([
    help,
    `var _scUnknown=${JSON.stringify(unknown)};`,
    "var _scSource={};",
    'var _scEntry="manual";',
    /* The two the draft code carries between saves: which scenario is on
       screen, and the revision the stored copy was at. Null and zero mean
       unsaved work, which is a normal state rather than an error. */
    "var _scScenarioId=null;",
    /* scFormScenario carries the part and its requirements now, so a reopened
       scenario comes back with the geometry and tolerances it was saved with
       rather than whatever happened to be on screen. */
    "var _scModel=null; var _scReqs=[];",
    /* The rest of the per-scenario state scClearSession puts down. Declared
       here so the harness exercises the real clearing rather than a stub of
       it — the bug being fixed was a clear that missed some of these. */
    "var _scHistory=null; var _scPreview=null; var _scPackage=null;",
    "var _scCompare=null; var _scReadStartedAt=null;",
    "var _scRevision=0;",
    /* When each field was last touched. scFormScenario stamps it onto every
       field so a late extraction can be recognised as late — see
       studio-conflicts.test.mjs, which is where that rule is exercised. */
    "var _scEdited={};",
    "function scTouched(id){ if(SC_FIELD_HELP[id]) _scEdited[id]=new Date().toISOString(); }",
    fnSource("scVal", app), fnSource("scEntry", app),
    fnSource("scFieldState", app), fnSource("scStateDot", app),
    fnSource("scRenderFieldStates", app),
    fnSource("scFormScenario", app), fnSource("scApplyScenario", app),
    fnSource("scDraftStatus", app), fnSource("scSaveDraft", app),
    fnSource("scNewDraft", app), fnSource("scOpenDraft", app),
    fnSource("scDeleteDraft", app), fnSource("scRenderDrafts", app),
    /* scNewDraft calls the page's own clear, which touches more of the form
       than this harness models. A stub keeps the test on the draft code. */
    "function scClear(){ for(var i=0;i<IDS.length;i++){var e=document.getElementById(IDS[i]); if(e)e.value='';} }",
    `var IDS=${JSON.stringify(FIELD_IDS)};`,
    /* Drawn by the real code on reopen; this harness is about the record, not
       the picture. */
    "function scRenderBuilder(){} function scAiStatus(){}",
    fnSource("scClearSession", app), fnSource("toCostClear", app),
    "var _toCost=null; var _toCostTaken=null; var _toCostAllowances=Object.create(null);",
  ].join("\n"), sandbox);

  return {
    store, els,
    run: (code) => vm.runInContext(code, sandbox),
    el: (id) => els.get(id),
    status: () => els.get("sc-draft-status").innerHTML,
    list: () => els.get("sc-drafts").innerHTML,
    saved: () => loadScenarios(store),
  };
}

/* ----------------------------------------------------------- the round trip */

describe("saving a part-finished scenario", () => {
  let s;
  beforeEach(() => {
    s = studio({
      values: { "sc-grade": "FG-300 plate", "sc-qty": "100", "sc-bw": "100", "sc-bl": "50" },
      unknown: { "sc-kerf": true },
    });
  });

  test("it saves without a complete plan", () => {
    s.run("scSaveDraft();");
    assert.equal(s.saved().length, 1);
    assert.match(s.status(), /Saved as SCN-/);
  });

  test("and says what it is still waiting on rather than calling it done", () => {
    s.run("scSaveDraft();");
    assert.match(s.status(), /A quantity plan needs/);
  });

  test("the values come back", () => {
    s.run("scSaveDraft();");
    const id = s.saved()[0].id;
    for (const el of s.els.values()) el.value = "";
    s.run(`scOpenDraft(${JSON.stringify(id)});`);
    assert.equal(s.el("sc-qty").value, "100");
    assert.equal(s.el("sc-bw").value, "100");
    assert.equal(s.el("sc-grade").value, "FG-300 plate");
  });

  test("an 'I don't know' comes back as itself, not as blank", () => {
    /* The distinction the whole slice rests on. If this comes back empty, the
       person is asked a question they already answered. */
    s.run("scSaveDraft();");
    const id = s.saved()[0].id;
    s.run("_scUnknown={};");
    s.run(`scOpenDraft(${JSON.stringify(id)});`);
    assert.equal(s.run('_scUnknown["sc-kerf"]'), true);
    assert.equal(s.run('scFieldState("sc-kerf")'), "Not known yet");
  });

  test("a blank field comes back blank, not as unknown", () => {
    s.run("scSaveDraft();");
    const id = s.saved()[0].id;
    s.run(`scOpenDraft(${JSON.stringify(id)});`);
    assert.equal(s.el("sc-s1").value, "");
    assert.equal(s.run('_scUnknown["sc-s1"]'), undefined);
    assert.equal(s.run('scFieldState("sc-s1")'), "Missing");
  });

  test("the length unit is stored with the numbers it applies to", () => {
    s.el("sc-unit").value = "in";
    s.run("scSaveDraft();");
    const rec = s.saved()[0];
    assert.equal(rec.unit, "in");
    assert.equal(rec.fields.blankWidth.unit, "in", "a dimension without its unit is a number, not a length");
    assert.equal(rec.fields.goodParts.unit, null, "a count of parts has no length unit");
  });

  test("saving twice updates rather than duplicating", () => {
    s.run("scSaveDraft();");
    s.el("sc-bl").value = "60";
    s.run("scSaveDraft();");
    assert.equal(s.saved().length, 1);
    assert.equal(s.saved()[0].fields.blankLength.value, "60");
  });
});

/* --------------------------------------------------------- what is refused */

describe("what cannot be saved", () => {
  test("an empty form is refused, with a reason", () => {
    const s = studio();
    s.run("scSaveDraft();");
    assert.equal(s.saved().length, 0);
    assert.match(s.status(), /Enter something first/);
  });

  test("one 'I don't know' is enough to be worth saving", () => {
    // Saying you cannot answer is progress, and losing it wastes the asking.
    const s = studio({ unknown: { "sc-kerf": true } });
    s.run("scSaveDraft();");
    assert.equal(s.saved().length, 1);
  });

  test("with no engine, it says so instead of failing quietly", () => {
    const s = studio({ values: { "sc-qty": "100" } });
    s.run("window.BW=null;");
    s.run("scSaveDraft();");
    assert.match(s.status(), /engine did not load/);
  });
});

/* -------------------------------------------------------------- the list */

describe("the list of saved work", () => {
  test("says so plainly when there is nothing", () => {
    const s = studio();
    s.run("scRenderDrafts();");
    assert.match(s.list(), /Nothing saved yet/);
    assert.match(s.list(), /saved part-finished/);
  });

  test("shows whether each one is ready or still a draft", () => {
    const s = studio({ values: { "sc-qty": "100" }, unknown: { "sc-kerf": true } });
    s.run("scSaveDraft();");
    assert.match(s.list(), /Draft/);
    assert.match(s.list(), /1 not known/);
  });

  test("marks the one currently open", () => {
    const s = studio({ values: { "sc-qty": "100" } });
    s.run("scSaveDraft();");
    assert.match(s.list(), /bw-draft--open/);
  });

  test("a name from a person is escaped in text and in every attribute", () => {
    const s = studio({ values: { "sc-grade": '"><img src=x onerror=alert(1)>' , "sc-qty": "1" } });
    s.run("scSaveDraft();");
    const list = s.list();
    assert.equal(/<img/.test(list), false, "markup from a field reached the page");
    assert.match(list, /&lt;img/);
    assert.equal(/data-a="[^"]*"><img/.test(list), false, "an attribute was broken out of");
  });

  test("deleting removes it and says so", () => {
    const s = studio({ values: { "sc-qty": "100" } });
    s.run("scSaveDraft();");
    const id = s.saved()[0].id;
    s.run(`scDeleteDraft(${JSON.stringify(id)});`);
    assert.equal(s.saved().length, 0);
    assert.match(s.status(), /Deleted/);
  });

  test("opening one that has since gone says so rather than clearing the form", () => {
    const s = studio({ values: { "sc-qty": "100" } });
    s.run('scOpenDraft("SCN-gone");');
    assert.match(s.status(), /no longer stored/);
    assert.equal(s.el("sc-qty").value, "100", "the form was left alone");
  });
});

/* ------------------------------------------------------------ starting over */

describe("starting a new one", () => {
  test("clears the form but keeps what was saved", () => {
    const s = studio({ values: { "sc-qty": "100" }, unknown: { "sc-kerf": true } });
    s.run("scSaveDraft();");
    s.run("scNewDraft();");
    assert.equal(s.el("sc-qty").value, "");
    assert.equal(s.run('Object.keys(_scUnknown).length'), 0);
    assert.equal(s.saved().length, 1, "the saved copy is untouched");
    assert.match(s.status(), /still saved/);
  });

  test("and the next save creates a second scenario rather than overwriting", () => {
    const s = studio({ values: { "sc-qty": "100" } });
    s.run("scSaveDraft();");
    s.run("scNewDraft();");
    s.el("sc-qty").value = "250";
    s.run("scSaveDraft();");
    assert.equal(s.saved().length, 2);
  });
});

/* ------------------------------------------------------------- the page */

describe("it is on the page", () => {
  const page = markup.slice(markup.indexOf('id="sc-mode-material"'), markup.indexOf('id="sc-mode-cert"'));

  test("the controls exist and ask for their actions by name", () => {
    assert.match(page, /data-do="scSaveDraft"/);
    assert.match(page, /data-do="scNewDraft"/);
    assert.match(page, /id="sc-drafts"/);
  });

  test("the status line is announced, so it is not only visible", () => {
    assert.match(page, /id="sc-draft-status" role="status" aria-live="polite"/);
  });

  test("saved work is the first thing in the column, not the last", () => {
    // The opening question is whether you are starting or continuing.
    assert.ok(page.indexOf("Your scenarios") < page.indexOf("1 &middot; The part"));
  });

  test("every draft action is registered", () => {
    for (const name of ["scSaveDraft", "scNewDraft", "scOpenDraft", "scDeleteDraft"]) {
      assert.match(app, new RegExp(`${name}: function`), `${name} is not in the action table`);
    }
  });

  test("the list is drawn when the page is opened", () => {
    assert.match(fnSource("scBind", app), /scRenderDrafts\(\)/);
  });

  test("the modules reach the page through the mount", () => {
    const mount = readFileSync("mount.mjs", "utf8");
    for (const name of ["saveScenario", "loadScenarios", "loadScenario", "deleteScenario", "scNewId"]) {
      assert.match(mount, new RegExp(`\\b${name}\\b`), `${name} is not exposed on window.BW`);
    }
  });
});
