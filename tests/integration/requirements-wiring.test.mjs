/**
 * Entering a requirement on the page.
 *
 * The module is tested on its own; this is the seam. What matters here is that
 * the page does not soften any of the module's refusals on the way through —
 * an interface that fills in a plausible default for a field the engine
 * insists on is worse than one that never had the field.
 *
 * Two absences are tested as deliberately as the presences: there is no list
 * of standards to pick from, and nothing is pre-filled.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource, fnSource, markupOnly } from "../helpers/page.mjs";
import {
  KIND, SCOPE, VERIFICATION, ATTACHMENT,
  tolerance, requirement, newRequirementId, attachments, conflicts,
  schedule, labelOfKind,
} from "../../src/studio/requirements.mjs";

const app = readFileSync("app.js", "utf8");
const markup = markupOnly();
const page = markup.slice(markup.indexOf('id="sc-mode-material"'), markup.indexOf('id="sc-mode-cert"'));

/* ---------------------------------------------------------------- harness */

function studio({ values = {} } = {}) {
  const els = new Map();
  const mk = (id) => ({ id, value: values[id] ?? "", innerHTML: "", textContent: "",
    hidden: false, dataset: {}, setAttribute() {}, style: {} });

  const IDS = ["req-kind", "req-scope", "req-target", "req-nominal", "req-tolunit",
    "req-pm", "req-upper", "req-lower", "req-spec", "req-specrev", "req-clause",
    "req-spectext", "req-source", "req-note", "req-question", "req-status",
    "req-list", "req-kind-fields", "req-kind-help", "req-tolerance-fields",
    "req-convention", "req-characteristic", "req-value", "req-valueUnit",
    "req-datumText", "req-parameter", "req-process", "req-designation",
    "req-thickness", "req-condition", "req-requirement", "sc-unit"];
  for (const id of IDS) els.set(id, mk(id));

  const sandbox = {
    document: { getElementById: (id) => els.get(id) ?? null },
    console,
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    window: {
      BW: {
        reqTolerance: tolerance, reqRequirement: requirement,
        reqSchedule: schedule, reqConflicts: conflicts,
        reqAttachments: attachments, reqLabelOfKind: labelOfKind,
        newRequirementId,
        REQ_KIND: KIND, REQ_SCOPE: SCOPE,
        REQ_VERIFICATION: VERIFICATION, REQ_ATTACHMENT: ATTACHMENT,
      },
    },
  };

  const shape = app.slice(app.indexOf("var SC_REQ_FORM = {"),
    app.indexOf("\n};", app.indexOf("var SC_REQ_FORM = {")) + 3);

  vm.createContext(sandbox);
  vm.runInContext([
    shape, "var _scReqs=[];",
    fnSource("scVal", app), fnSource("scReqFromForm", app),
    fnSource("scAddRequirement", app), fnSource("scRemoveRequirement", app),
    fnSource("scClearReqForm", app), fnSource("scReqStatus", app),
    fnSource("scReqKindChanged", app), fnSource("scRenderRequirements", app),
  ].join("\n"), sandbox);

  return {
    els,
    run: (code) => vm.runInContext(code, sandbox),
    set: (id, v) => { els.get(id).value = v; },
    list: () => els.get("req-list").innerHTML,
    status: () => els.get("req-status").innerHTML,
    count: () => vm.runInContext("_scReqs.length", sandbox),
    reqs: () => vm.runInContext("JSON.parse(JSON.stringify(_scReqs, (k,v)=>typeof v==='bigint'?String(v):v))", sandbox),
  };
}

/** Fill in a valid dimensional tolerance and add it. */
function addTolerance(s, over = {}) {
  s.set("req-kind", over.kind ?? "dimensional-tolerance");
  s.set("req-scope", over.scope ?? "whole-part");
  s.set("req-target", over.target ?? "");
  s.set("req-nominal", over.nominal ?? "10");
  s.set("req-tolunit", over.unit ?? "mm");
  s.set("req-pm", over.pm ?? "0.1");
  s.set("req-spec", over.spec ?? "");
  s.set("req-specrev", over.specrev ?? "");
  s.set("req-spectext", over.spectext ?? "");
  s.run("scAddRequirement();");
}

/* --------------------------------------------------- the page keeps the rules */

describe("the page does not soften the module's refusals", () => {
  let s;
  beforeEach(() => { s = studio(); });

  test("a tolerance with no limits is refused, and says how to state them", () => {
    addTolerance(s, { pm: "" });
    assert.equal(s.count(), 0);
    assert.match(s.status(), /State the tolerance one of three ways/);
  });

  test("nothing is invented to make it pass", () => {
    addTolerance(s, { pm: "" });
    assert.equal(/0\.1|default|assum/i.test(s.status()), false,
      "a refusal that suggests a value is a default with extra steps");
  });

  test("a nominal with no number is refused", () => {
    addTolerance(s, { nominal: "" });
    assert.equal(s.count(), 0);
    assert.match(s.status(), /needs the nominal size/);
  });

  test("'all except' with nothing excepted is refused here too", () => {
    s.set("req-kind", "finish-coating");
    s.set("req-scope", "all-except");
    s.set("req-target", "");
    s.set("req-process", "Anodise");
    s.run("scAddRequirement();");
    assert.equal(s.count(), 0);
    assert.match(s.status(), /simply all surfaces/);
  });

  test("a valid one is added, and the form is emptied for the next", () => {
    addTolerance(s);
    assert.equal(s.count(), 1);
    assert.match(s.status(), /Dimensional tolerance added/);
    assert.equal(s.els.get("req-nominal").value, "", "the form is ready for the next one");
  });
});

/* ----------------------------------------------- a citation is not its contents */

describe("citing a specification", () => {
  let s;
  beforeEach(() => { s = studio(); });

  test("there is no list of standards to choose from", () => {
    /* A dropdown of specification names would imply this tool knows what they
       contain. It does not, and the module refuses to pretend otherwise. */
    const spec = page.slice(page.indexOf('id="req-spec"'), page.indexOf('id="req-spec"') + 200);
    assert.match(spec, /<input/, "the specification field must be free text");
    assert.equal(/<select[^>]*id="req-spec"/.test(page), false);
  });

  test("the page says outright that naming one records a citation", () => {
    assert.match(page, /records the citation, not its\s*\n?\s*contents/);
    assert.match(page, /nothing here knows what any standard requires/);
  });

  test("a name without the clause text shows as unverified", () => {
    addTolerance(s, { spec: "SYN-SPEC-100", specrev: "C" });
    s.run("scRenderRequirements();");
    assert.match(s.list(), /Specification text not supplied/);
  });

  test("supplying the clause text clears that", () => {
    addTolerance(s, { spec: "SYN-SPEC-100", specrev: "C",
      spectext: "Limits are plus or minus one tenth of a millimetre." });
    s.run("scRenderRequirements();");
    assert.equal(/Specification text not supplied/.test(s.list()), false);
  });

  test("a specification with no revision is shown as missing one", () => {
    addTolerance(s, { spec: "SYN-SPEC-100" });
    s.run("scRenderRequirements();");
    assert.match(s.list(), /no revision given/);
  });
});

/* -------------------------------------------------------------- the list */

describe("what the list shows", () => {
  let s;
  beforeEach(() => { s = studio(); });

  test("nothing yet says the requirements do not wait for a model", () => {
    s.run("scRenderRequirements();");
    assert.match(s.list(), /none of it needs a model of the part/);
  });

  test("a tolerance shows both how it was written and what it means", () => {
    addTolerance(s);
    s.run("scRenderRequirements();");
    assert.match(s.list(), /10mm ±0\.1/);
    assert.match(s.list(), /9\.9 … 10\.1mm/);
  });

  test("a feature-scoped requirement says it is waiting for the model", () => {
    // C1 has no geometry at all, so this is waiting — not detached.
    addTolerance(s, { scope: "feature", target: "bore-1" });
    s.run("scRenderRequirements();");
    assert.match(s.list(), /Waiting for the part model/);
    assert.equal(/Needs reattaching/.test(s.list()), false);
  });

  test("two disagreeing tolerances on one target are surfaced, not resolved", () => {
    addTolerance(s, { scope: "feature", target: "bore-1" });
    addTolerance(s, { scope: "feature", target: "bore-1", pm: "0.05" });
    s.run("scRenderRequirements();");
    assert.match(s.list(), /to settle/);
    assert.match(s.list(), /do not agree/);
    assert.equal(s.count(), 2, "both are still there; neither was dropped");
  });

  test("it gives a junior buyer one sentence to take to the reviewer", () => {
    addTolerance(s, { scope: "feature", target: "bore-1" });
    addTolerance(s, { scope: "feature", target: "bore-1", pm: "0.05" });
    s.run("scRenderRequirements();");
    assert.match(s.list(), /To ask the reviewer:/);
  });

  test("and says plainly when there is nothing outstanding", () => {
    addTolerance(s);
    s.run("scRenderRequirements();");
    assert.match(s.list(), /Nothing outstanding/);
    assert.match(s.list(), /ready to send for technical review/);
  });

  test("but never says approved", () => {
    addTolerance(s);
    s.run("scRenderRequirements();");
    assert.equal(/approved/i.test(s.list()), false,
      "exporting or completing a checklist does not approve anything");
  });

  test("removing one leaves the rest", () => {
    addTolerance(s);
    addTolerance(s, { nominal: "20" });
    const id = s.reqs()[0].id;
    s.run(`scRemoveRequirement(${JSON.stringify(id)});`);
    assert.equal(s.count(), 1);
    assert.equal(s.reqs()[0].tolerance.nominalNm, "20000000");
  });

  test("a value from a person is escaped", () => {
    addTolerance(s, { spec: '"><img src=x onerror=alert(1)>' });
    s.run("scRenderRequirements();");
    assert.equal(/<img/.test(s.list()), false);
    assert.match(s.list(), /&lt;img/);
  });
});

/* ------------------------------------------------------- the kind selector */

describe("choosing a kind", () => {
  let s;
  beforeEach(() => { s = studio(); });

  test("the tolerance fields only show for a tolerance", () => {
    s.set("req-kind", "dimensional-tolerance");
    s.run("scReqKindChanged();");
    assert.equal(s.els.get("req-tolerance-fields").hidden, false);

    s.set("req-kind", "finish-coating");
    s.run("scReqKindChanged();");
    assert.equal(s.els.get("req-tolerance-fields").hidden, true);
  });

  test("each kind brings its own fields", () => {
    s.set("req-kind", "surface-texture");
    s.run("scReqKindChanged();");
    const html = s.els.get("req-kind-fields").innerHTML;
    assert.match(html, /id="req-parameter"/);
    assert.match(html, /id="req-value"/);
  });

  test("and its own plain-English line", () => {
    s.set("req-kind", "edge-condition");
    s.run("scReqKindChanged();");
    assert.match(s.els.get("req-kind-help").textContent,
      /'Break all edges' with no dimension is not a requirement anyone can inspect/);
  });

  test("a generated field is named for a screen reader as well as labelled", () => {
    // Built at runtime, so nothing reading the source can see the association.
    s.set("req-kind", "finish-coating");
    s.run("scReqKindChanged();");
    assert.match(s.els.get("req-kind-fields").innerHTML, /aria-label="Process"/);
  });

  test("every kind the module knows has a form", () => {
    const shape = vm.runInContext("Object.keys(SC_REQ_FORM)",
      (() => { const c = {}; vm.createContext(c);
        vm.runInContext(app.slice(app.indexOf("var SC_REQ_FORM = {"),
          app.indexOf("\n};", app.indexOf("var SC_REQ_FORM = {")) + 3), c); return c; })());
    for (const k of Object.values(KIND)) {
      assert.ok(shape.includes(k), `${k} has no form on the page`);
    }
  });

  test("and every form names a kind the module knows", () => {
    const known = new Set(Object.values(KIND));
    const offered = [...page.matchAll(/<option value="([a-z-]+)">/g)]
      .map((m) => m[1])
      .filter((v) => v.includes("-") && !["whole-part", "feature", "selected-faces", "all-except"].includes(v));
    assert.ok(offered.length >= 8, "the kind list was not read");
    for (const k of offered) assert.ok(known.has(k), `the page offers "${k}", which the module does not know`);
  });
});

/* -------------------------------------------------------------- the page */

describe("it is on the page", () => {
  test("the panel sits beside the route, not in the result column", () => {
    const route = page.indexOf("4 &middot; The route");
    const reqs = page.indexOf("Engineering requirements");
    const cost = page.indexOf("5 &middot; The cost");
    assert.ok(route < reqs && reqs < cost,
      "requirements belong next to the route: both answer what the part needs doing to it");
  });

  test("it says no model is needed", () => {
    assert.match(page, /no model needed/);
  });

  test("the actions are asked for by name", () => {
    assert.match(page, /data-do="scAddRequirement"/);
    assert.match(page, /data-chg="scReqKindChanged"/);
    for (const name of ["scAddRequirement", "scRemoveRequirement", "scReqKindChanged"]) {
      assert.match(app, new RegExp(`${name}: function`), `${name} is not registered`);
    }
  });

  test("the status line is announced", () => {
    assert.match(page, /id="req-status" role="status" aria-live="polite"/);
  });

  test("the panel is drawn when the page opens", () => {
    /* Through scRenderBuilder now: the builder draws itself and then the
       requirements, because the requirements panel needs the feature list the
       builder owns. Calling both from scBind would draw requirements once
       against an empty list and again against the real one. */
    const bind = fnSource("scBind", app);
    assert.match(bind, /scReqKindChanged\(\)/);
    assert.match(bind, /scRenderBuilder\(\)/);
    assert.match(fnSource("scRenderBuilder", app), /scRenderRequirements\(\)/);
  });

  test("the module reaches the page through the mount", () => {
    const mount = readFileSync("mount.mjs", "utf8");
    for (const name of ["reqTolerance", "reqRequirement", "reqSchedule", "reqLabelOfKind"]) {
      assert.match(mount, new RegExp(`\\b${name}\\b`), `${name} is not exposed`);
    }
  });
});
