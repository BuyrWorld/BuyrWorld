/**
 * One scenario at a time.
 *
 * "Start a new one" reset the form fields and the provenance and left the part
 * and its requirements where they were. A new scenario therefore opened with
 * the previous project's geometry drawn on screen and its tolerances listed
 * against it — and exporting then produced the previous project's requirements
 * under the new project's name.
 *
 * Reopening a saved scenario had the same fault from the other side: it
 * restored the fields and inherited whatever model happened to be in memory.
 *
 * The 16 September audit put this first among the remaining work, and that is
 * the right place for it. Everything else in the Studio is careful not to mix
 * one fact with another; this mixed whole projects.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { fnSource } from "../helpers/page.mjs";
import {
  reviewItem, documentRef, confirm, correct, METHOD,
} from "../../src/intake/review.mjs";
import {
  scenario, withField, readiness, started as scStarted, SOURCE, ENTRY, GOAL,
} from "../../src/studio/scenario.mjs";
import {
  newId, saveScenario, loadScenarios, loadScenario, deleteScenario, SCHEMA_VERSION,
} from "../../src/services/studio-store.mjs";
import {
  block, addHole, featureIds, history as geometryHistory,
} from "../../src/studio/geometry.mjs";
import {
  requirement, KIND, SCOPE, tolerance, schedule,
} from "../../src/studio/requirements.mjs";

const app = readFileSync("app.js", "utf8");
const mm = (x) => BigInt(Math.round(x * 1000));

function memory() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _raw: () => map.get("bw.studio.v1"),
    _put: (v) => map.set("bw.studio.v1", v),
  };
}

/* ---------------------------------------------------------------- harness */

function studio() {
  const store = memory();
  const els = new Map();
  const mk = (id) => ({ id, value: "", disabled: false, innerHTML: "", dataset: {},
    focus() {}, setAttribute() {}, style: {} });
  for (const id of ["sc-qty", "sc-grade", "sc-bw", "sc-bl", "sc-bt", "sc-s1", "sc-s2",
    "sc-kerf", "sc-edge", "sc-dv", "sc-ds", "sc-unit", "sc-drafts", "sc-draft-status",
    "sc-out", "rev-out", "sc-pw", "sc-pl", "sc-pt", "sc-pack", "sc-moq", "sc-cont",
    "sc-rot", "sc-amort", "sc-upload-panel", "sc-entry-manual", "sc-entry-upload"]) {
    els.set(id, mk(id));
  }
  els.get("sc-unit").value = "mm";

  const sandbox = {
    document: { getElementById: (id) => els.get(id) ?? null },
    console,
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    window: {
      BW: {
        scenario, withField, scReadiness: readiness, scStarted, scNewId: newId,
        SC_SOURCE: SOURCE, SC_ENTRY: ENTRY, SC_GOAL: GOAL,
        saveScenario: (s) => saveScenario(s, store),
        loadScenarios: () => loadScenarios(store),
        loadScenario: (id) => loadScenario(id, store),
        deleteScenario: (id) => deleteScenario(id, store),
        geometryHistory, featureIds, reqSchedule: schedule,
      },
    },
  };

  const help = app.slice(app.indexOf("var SC_FIELD_HELP = {"),
    app.indexOf("\n};", app.indexOf("var SC_FIELD_HELP = {")) + 3);

  vm.createContext(sandbox);
  vm.runInContext([
    help,
    "var _scUnknown={}; var _scSource={}; var _scEdited={}; var _scEntry='manual';",
    "var _scScenarioId=null; var _scRevision=0;",
    "var _scModel=null; var _scHistory=null; var _scReqs=[];",
    "var _scPreview=null; var _scPackage=null; var _scLast=null;",
    "var _scCompare=null; var _scReadStartedAt=null;",
    "var _exReview={scx:null,ctx:null}; var _exState={scx:null,ctx:null};",
    "function exViewClose(){}",
    "function scClear(){}",
    "function scRenderBuilder(){} function scAiStatus(){} function scRenderFieldStates(){}",
    "function scRenderDrafts(){} function scTouched(){}",
    fnSource("scVal", app), fnSource("scEntry", app),
    fnSource("scClearSession", app), fnSource("toCostClear", app),
    "var _toCost=null; var _toCostTaken=null; var _toCostAllowances=Object.create(null);", fnSource("scNewDraft", app),
    fnSource("scFormScenario", app), fnSource("scApplyScenario", app),
    fnSource("scDraftStatus", app), fnSource("scSaveDraft", app),
    fnSource("scOpenDraft", app),
  ].join("\n"), sandbox);

  return {
    store, els,
    run: (code) => vm.runInContext(code, sandbox),
    set: (id, v) => { els.get(id).value = v; },
    status: () => els.get("sc-draft-status").innerHTML,
    ids: () => JSON.parse(vm.runInContext(
      "JSON.stringify(_scModel ? window.BW.featureIds(_scModel) : null)", sandbox)),
    reqCount: () => vm.runInContext("_scReqs.length", sandbox),
    saved: () => loadScenarios(store),
    /* The reading decisions, as the page holds them. */
    review: () => vm.runInContext("_exReview.scx", sandbox),
    setReview: (items) => {
      sandbox.__items = items;
      vm.runInContext("_exReview.scx = __items;", sandbox);
    },
    setCtxReview: (items) => {
      sandbox.__ctx = items;
      vm.runInContext("_exReview.ctx = __ctx;", sandbox);
    },
  };
}

/** A part with one hole and one tolerance on it, as project A. */
function projectA(s) {
  s.set("sc-grade", "Project A bracket");
  s.set("sc-qty", "100");
  const model = addHole(block({ widthUm: mm(100), lengthUm: mm(50), thicknessUm: mm(10) }),
    { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }).model;
  const req = requirement({
    kind: KIND.DIMENSIONAL,
    tolerance: tolerance({ nominal: "6", plusMinus: "0.05", unit: "mm" }),
    scope: { type: SCOPE.FEATURE, featureId: "hole-1" },
  });
  vmSet(s, model, [req]);
  return { model, req };
}

/** Put a model and requirements into the sandbox without serialising BigInts. */
function vmSet(s, model, reqs) {
  s.run("var __set=function(m,r){ _scModel=m; _scHistory=window.BW.geometryHistory(m); _scReqs=r; };");
  const fn = s.run("__set");
  fn(model, reqs);
}

/* --------------------------------------------------------- starting anew */

describe("starting a new scenario puts the old one down", () => {
  let s;
  beforeEach(() => { s = studio(); projectA(s); });

  test("the previous part is gone", () => {
    /* It used to still be drawn on screen, under the new project's name. */
    assert.deepEqual(s.ids(), ["hole-1"]);
    s.run("scNewDraft();");
    assert.equal(s.ids(), null, "no model");
  });

  test("and so are its requirements", () => {
    assert.equal(s.reqCount(), 1);
    s.run("scNewDraft();");
    assert.equal(s.reqCount(), 0);
  });

  test("and the undo history, so the old part cannot be undone back", () => {
    s.run("scNewDraft();");
    assert.equal(s.run("_scHistory"), null);
  });

  test("and any prepared review package", () => {
    // Exporting then saving would have handed over the previous project.
    s.run("_scPackage={files:{}};");
    s.run("scNewDraft();");
    assert.equal(s.run("_scPackage"), null);
  });

  test("and any drawing comparison waiting for an answer", () => {
    s.run("_scCompare={comparison:{}};");
    s.run("scNewDraft();");
    assert.equal(s.run("_scCompare"), null);
  });

  test("what was saved is untouched", () => {
    s.run("scSaveDraft();");
    s.run("scNewDraft();");
    assert.equal(s.saved().length, 1);
    assert.match(s.status(), /still saved/);
  });
});

/* --------------------------------------------------- the record round trip */

describe("a saved scenario carries its part and its requirements", () => {
  let s;
  beforeEach(() => { s = studio(); projectA(s); });

  test("the model is stored", () => {
    s.run("scSaveDraft();");
    const rec = s.saved()[0];
    assert.ok(rec.model, "no model was saved");
    assert.deepEqual(featureIds(rec.model), ["hole-1"]);
  });

  test("with its dimensions as exact integers, not text", () => {
    s.run("scSaveDraft();");
    const rec = s.saved()[0];
    assert.equal(typeof rec.model.widthUm, "bigint");
    assert.equal(rec.model.widthUm, mm(100));
    assert.equal(rec.model.features[0].diameterUm, mm(6));
  });

  test("the requirements are stored, with their limits intact", () => {
    s.run("scSaveDraft();");
    const [req] = s.saved()[0].requirements;
    assert.ok(req, "no requirements were saved");
    assert.equal(req.scope.featureId, "hole-1");
    assert.equal(typeof req.tolerance.upperNm, "bigint");
    assert.equal(req.tolerance.upperNm, 50_000n, "±0.05mm");
  });

  test("reopening restores both", () => {
    s.run("scSaveDraft();");
    const id = s.saved()[0].id;
    s.run("scNewDraft();");
    assert.equal(s.ids(), null);
    s.run(`scOpenDraft(${JSON.stringify(id)});`);
    assert.deepEqual(s.ids(), ["hole-1"]);
    assert.equal(s.reqCount(), 1);
  });

  test("and gives the restored part a usable undo history", () => {
    s.run("scSaveDraft();");
    const id = s.saved()[0].id;
    s.run("scNewDraft();");
    s.run(`scOpenDraft(${JSON.stringify(id)});`);
    assert.notEqual(s.run("_scHistory"), null);
  });
});

/* ------------------------------------------------- one project at a time */

describe("reopening one project does not inherit another", () => {
  test("project B does not arrive carrying project A's part", () => {
    /* The bleed, from the other direction. Reopening restored the fields on
       top of whatever was on screen, so B's name sat over A's geometry. */
    const s = studio();
    projectA(s);
    s.run("scSaveDraft();");
    const a = s.saved()[0].id;

    s.run("scNewDraft();");
    s.set("sc-grade", "Project B plate");
    s.set("sc-qty", "250");
    s.run("scSaveDraft();");
    const b = s.saved().find((x) => x.id !== a).id;

    /* Open A — its part comes back. Then open B, which has none. */
    s.run(`scOpenDraft(${JSON.stringify(a)});`);
    assert.deepEqual(s.ids(), ["hole-1"]);

    s.run(`scOpenDraft(${JSON.stringify(b)});`);
    assert.equal(s.ids(), null, "B has no part, and must not inherit A's");
    assert.equal(s.reqCount(), 0, "nor A's tolerances");
  });
});

/* ------------------------------------------------------------- migration */

describe("a scenario saved by the older build", () => {
  test("still opens, with everything it did record", () => {
    /* Version 1 had no model and no requirements. Refusing to read one would
       throw away somebody's work to enforce a distinction that did not exist
       when they saved it. */
    const s = studio();
    s.store._put(JSON.stringify([{
      schema: 1, id: "SCN-old", name: "An older scenario",
      fields: { goodParts: { value: "250" }, kerf: { value: "3", unit: "mm" } },
      updatedAt: "2026-09-14T00:00:00.000Z",
    }]));
    assert.equal(s.saved().length, 1);
    s.run('scOpenDraft("SCN-old");');
    assert.equal(s.els.get("sc-qty").value, "250");
    assert.equal(s.els.get("sc-kerf").value, "3");
  });

  test("and says why it has no part, rather than looking broken", () => {
    const s = studio();
    s.store._put(JSON.stringify([{
      schema: 1, id: "SCN-old", name: "An older scenario",
      fields: { goodParts: { value: "250" } },
    }]));
    s.run('scOpenDraft("SCN-old");');
    assert.match(s.status(), /saved before the part and its requirements were stored/);
    assert.equal(s.ids(), null);
  });

  test("a version this build has never heard of is still withheld", () => {
    const s = studio();
    s.store._put(JSON.stringify([{ schema: 99, id: "SCN-future", fields: {} }]));
    assert.equal(s.saved().length, 0);
  });

  test("new records are written at the current version", () => {
    const s = studio();
    projectA(s);
    s.run("scSaveDraft();");
    assert.equal(s.saved()[0].savedSchema, SCHEMA_VERSION);

    /* A tripwire, not a fact worth asserting for its own sake. Moving the
       version is allowed; doing it without noticing is not, because every
       bump carries the same obligation — the versions before it stay
       readable, or somebody's saved work is discarded over a field that did
       not exist when they saved it. Bump the number here once the tests
       above still pass for each older schema. */
    assert.equal(SCHEMA_VERSION, 3);
  });

  test("and every version before it is still readable", () => {
    /* The obligation itself, checked rather than trusted to the comment
       above. Schema 1 predates the part and its requirements; schema 2
       predates the reading decisions. Both were somebody's saved work. */
    const s = studio();
    for (const schema of [1, 2]) {
      s.store._put(JSON.stringify([{
        schema, id: `SCN-v${schema}`, name: `Saved by schema ${schema}`,
        fields: { goodParts: { value: "250" } },
        updatedAt: "2026-09-14T00:00:00.000Z",
      }]));
      assert.equal(s.saved().length, 1, `a schema-${schema} record was refused`);
      assert.equal(s.saved()[0].savedSchema, schema);
    }
  });
});

/* ------------------------------------------------------------- the ratchet */

describe("everything per-scenario is cleared", () => {
  test("scClearSession names every _sc module variable that holds one", () => {
    /* The failure this fixes was a clear that handled four of nine. A new
       piece of per-scenario state added without a line here would recreate it
       exactly, so the list is checked against the declarations rather than
       trusted. */
    const declared = [...app.matchAll(/^var (_sc[A-Za-z]+)\s*=/gm)].map((m) => m[1]);
    const clear = fnSource("scClearSession", app);

    /* Not per-scenario: the entry mode is a presentation preference, and the
       field-help table is a constant. */
    const exempt = new Set(["_scEntry", "_scStages", "_scCosts"]);

    const missing = declared.filter((v) => !exempt.has(v) && !clear.includes(v));
    assert.deepEqual(missing, [],
      `scClearSession does not clear: ${missing.join(", ")}`);
    assert.ok(declared.length >= 8, "the declarations were not found");
  });

  test("starting a new scenario and reopening one both go through it", () => {
    assert.match(fnSource("scNewDraft", app), /scClearSession\(\)/);
    assert.match(fnSource("scApplyScenario", app), /scClearSession\(\)/);
  });
});

/* ------------------------------------------- the reading decisions, reopened */

/**
 * Confirm rows, save, reopen.
 *
 * The queue lived in memory. Somebody who ticked fourteen readings against a
 * drawing, saved the case and came back to it found every one unticked, and
 * the record of who confirmed what — the part that answers "why does the case
 * say 5.2 when the drawing says 5.0" — gone with them.
 *
 * Run against the page's own save and open, because the seam is where this
 * would break: the store can hold a queue perfectly and still never be handed
 * one.
 */
describe("what was decided about the drawing comes back", () => {
  const DOC = documentRef({ filename: "brk-a-102.pdf", revision: "B", fingerprint: "abc" });
  const reading = (field, value) => reviewItem(
    { field, label: field, value, unit: "mm", page: 1,
      quote: `${field} ${value} mm`, confidence: "labelled" },
    { method: METHOD.RULE, document: DOC });

  test("confirmed readings survive a save and reopen", () => {
    const s = studio();
    projectA(s);
    s.setReview([confirm(reading("thickness", "5"), "this browser"),
                 confirm(reading("width", "200"), "this browser")]);
    s.run("scSaveDraft();");

    const id = s.saved()[0].id;
    s.run("scNewDraft();");
    assert.equal(s.review(), null, "the new case kept the last one's decisions");

    s.run(`scOpenDraft(${JSON.stringify(id)});`);
    const back = s.review();
    assert.equal(back.length, 2);
    assert.equal(back[0].disposition, "confirmed");
    assert.equal(back[0].revisions[0].by, "this browser");
  });

  test("a correction comes back with the reading it replaced", () => {
    const s = studio();
    projectA(s);
    s.setReview([correct(reading("thickness", "5"), { value: "5.2" }, "this browser")]);
    s.run("scSaveDraft();");
    const id = s.saved()[0].id;
    s.run("scNewDraft();");
    s.run(`scOpenDraft(${JSON.stringify(id)});`);

    const back = s.review()[0];
    assert.equal(back.value, "5.2");
    assert.equal(back.evidence.value, "5", "what the drawing said did not come back");
  });

  test("and it says how many came back, rather than leaving it to be noticed", () => {
    const s = studio();
    projectA(s);
    s.setReview([confirm(reading("thickness", "5"), "this browser")]);
    s.run("scSaveDraft();");
    const id = s.saved()[0].id;
    s.run(`scOpenDraft(${JSON.stringify(id)});`);
    assert.match(s.status(), /1 reading\(s\) came back with it/);
  });

  test("a scenario with no decisions reopens without inheriting any", () => {
    /* The leak this would most easily introduce: reopening case B while case
       A's ticks are still in memory. */
    const s = studio();
    projectA(s);
    s.run("scSaveDraft();");
    const id = s.saved()[0].id;

    s.setReview([confirm(reading("thickness", "999"), "this browser")]);
    s.run(`scOpenDraft(${JSON.stringify(id)});`);
    assert.equal(s.review(), null, "another case's decisions survived the reopen");
  });

  test("a scenario saved before the queue existed says so", () => {
    const s = studio();
    s.store._put(JSON.stringify([{
      schema: 2, id: "SCN-v2", name: "Saved by the older build",
      fields: { goodParts: { value: "250" } },
      updatedAt: "2026-09-16T00:00:00.000Z",
    }]));
    s.run('scOpenDraft("SCN-v2");');
    assert.match(s.status(), /saved before the reading decisions were stored/);
    assert.equal(s.review(), null);
  });

  test("a decision stored with no record of being made comes back untucked, and is named", () => {
    const s = studio();
    projectA(s);
    const tampered = JSON.parse(JSON.stringify(confirm(reading("thickness", "5"), "this browser")));
    tampered.revisions = [];
    s.setReview([tampered]);
    s.run("scSaveDraft();");
    const id = s.saved()[0].id;
    s.run("scNewDraft();");
    s.run(`scOpenDraft(${JSON.stringify(id)});`);

    assert.equal(s.review()[0].disposition, "proposed");
    assert.match(s.status(), /need checking again/);
  });

  test("only the Studio's queue is stored, not the certificate path's", () => {
    /* They are different documents on different pages. Storing the
       certificate one inside a scenario would put one case's certificate into
       another case's part.

       The rows here are real decisions rather than placeholders: rubbish is
       refused on the way back in by reviveItems, so a test using it would
       pass whether or not the certificate queue leaked. */
    const s = studio();
    projectA(s);
    s.setReview(null);
    s.setCtxReview([confirm(reading("heat", "H-77213"), "this browser")]);
    s.run("scSaveDraft();");

    assert.deepEqual([...s.saved()[0].review], [],
      "the certificate path's decisions were stored inside the scenario");
  });
});
