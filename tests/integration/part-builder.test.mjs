/**
 * The Part Builder on the page.
 *
 * The test that justifies the whole increment is "a deleted hole detaches its
 * requirement". Before this wiring, `scRenderRequirements` passed an empty
 * feature list, so every feature-scoped requirement reported as waiting for a
 * model and the detached state could not occur — tested in the module,
 * unreachable in the product. That was the third time this month a guard
 * existed and could never fire.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { fnSource, markupOnly } from "../helpers/page.mjs";
import {
  block, addHole, addPocket, removeFeature, resize, featureIds,
  volume, mass as geometryMass, history as geometryHistory, FRAME,
} from "../../src/studio/geometry.mjs";
import {
  KIND, SCOPE, tolerance, requirement, schedule, labelOfKind,
} from "../../src/studio/requirements.mjs";
import { density } from "../../src/calc/units.mjs";

const app = readFileSync("app.js", "utf8");
const markup = markupOnly();
const page = markup.slice(markup.indexOf('id="sc-mode-material"'), markup.indexOf('id="sc-mode-cert"'));

/* ---------------------------------------------------------------- harness */

function studio({ values = {}, reqs = [] } = {}) {
  const els = new Map();
  const mk = (id) => ({ id, value: values[id] ?? "", innerHTML: "", dataset: {},
    setAttribute() {}, style: {} });
  for (const id of ["pb-w", "pb-l", "pb-t", "pb-hx", "pb-hy", "pb-hd",
    "pb-px", "pb-py", "pb-pw", "pb-pl", "pb-pd", "pb-status", "pb-out",
    "req-list", "sc-dv", "sc-du", "sc-ds"]) els.set(id, mk(id));

  const sandbox = {
    document: { getElementById: (id) => els.get(id) ?? null },
    console,
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    window: {
      BW: {
        block, addHole, addPocket, removeFeature, resize, featureIds,
        volume, geometryMass, geometryHistory,
        scDensity: density,
        reqSchedule: schedule, reqLabelOfKind: labelOfKind,
      },
    },
  };

  vm.createContext(sandbox);
  vm.runInContext([
    "var _scModel=null; var _scHistory=null;",
    `var _scReqs=${JSON.stringify(reqs, (k, v) => (typeof v === "bigint" ? `__b${v}` : v))}
       .map(function(r){ return JSON.parse(JSON.stringify(r), function(k,v){
         return typeof v==="string"&&v.indexOf("__b")===0?BigInt(v.slice(3)):v; }); });`,
    fnSource("scVal", app), fnSource("scUm", app), fnSource("scBuilderStatus", app),
    fnSource("scSetBlock", app), fnSource("scAddHole", app), fnSource("scAddPocket", app),
    fnSource("scRemoveFeature", app), fnSource("scUndoModel", app), fnSource("scRedoModel", app),
    fnSource("scDetachedCount", app), fnSource("scFeatureIds", app),
    fnSource("scModelSvg", app), fnSource("scRenderBuilder", app),
    fnSource("scMm3", app), fnSource("scG", app),
    /* The requirements renderer, so the feature list it now receives is the
       one this builder produces. */
    fnSource("scRenderRequirements", app),
  ].join("\n"), sandbox);

  return {
    els,
    run: (code) => vm.runInContext(code, sandbox),
    set: (id, v) => { els.get(id).value = v; },
    out: () => els.get("pb-out").innerHTML,
    status: () => els.get("pb-status").innerHTML,
    reqList: () => els.get("req-list").innerHTML,
    ids: () => vm.runInContext("JSON.stringify(scFeatureIds())", sandbox),
  };
}

/** A 100 × 50 × 10 block with one hole. */
function built(s) {
  s.set("pb-w", "100"); s.set("pb-l", "50"); s.set("pb-t", "10");
  s.run("scSetBlock();");
  s.set("pb-hx", "15"); s.set("pb-hy", "25"); s.set("pb-hd", "6");
  s.run("scAddHole();");
  return s;
}

const onHole = (id) => requirement({
  kind: KIND.SURFACE_TEXTURE, parameter: "Ra", value: "1.6",
  scope: { type: SCOPE.FEATURE, featureId: id },
});

/* ------------------------------------- the reason this increment was built */

describe("a requirement can finally lose its target", () => {
  test("with no model, a feature-scoped requirement is waiting, not detached", () => {
    const s = studio({ reqs: [onHole("hole-1")] });
    s.run("scRenderBuilder();");
    assert.match(s.reqList(), /Waiting for the part model/);
    assert.equal(/Needs reattaching/.test(s.reqList()), false);
  });

  test("once the hole exists, it is attached", () => {
    const s = built(studio({ reqs: [onHole("hole-1")] }));
    assert.equal(/Waiting for the part model/.test(s.reqList()), false);
    assert.equal(/Needs reattaching/.test(s.reqList()), false);
  });

  test("deleting the hole detaches it — on the page, not only in the module", () => {
    /* The whole point. This state had tests and could not occur in the
       product, because the page passed an empty feature list. */
    const s = built(studio({ reqs: [onHole("hole-1")] }));
    s.run('scRemoveFeature("hole-1");');
    assert.match(s.reqList(), /Needs reattaching/);
  });

  test("and the builder says what the deletion cost", () => {
    // Rather than leaving somebody to discover it in another panel.
    const s = built(studio({ reqs: [onHole("hole-1")] }));
    s.run('scRemoveFeature("hole-1");');
    assert.match(s.status(), /1 requirement\(s\) now point at nothing/);
  });

  test("deleting an unreferenced feature says nothing alarming", () => {
    const s = built(studio({ reqs: [] }));
    s.run('scRemoveFeature("hole-1");');
    assert.match(s.status(), /Removed hole-1\./);
    assert.equal(/point at nothing/.test(s.status()), false);
  });

  test("the requirement is not moved to a surviving hole", () => {
    const s = built(studio({ reqs: [onHole("hole-1")] }));
    s.set("pb-hx", "50"); s.set("pb-hy", "25"); s.set("pb-hd", "6");
    s.run("scAddHole();");
    s.run('scRemoveFeature("hole-1");');
    assert.equal(s.ids(), JSON.stringify(["hole-2"]));
    assert.match(s.reqList(), /Needs reattaching/, "it points at hole-1 still, which is gone");
  });
});

/* ------------------------------------------------------------- building */

describe("building a part", () => {
  let s;
  beforeEach(() => { s = studio(); });

  test("with no model it says one is not needed", () => {
    s.run("scRenderBuilder();");
    assert.match(s.out(), /You do not need one/);
    assert.match(s.out(), /requirements, quantities and costs all work/);
  });

  test("a block starts from three numbers", () => {
    built(s);
    assert.match(s.out(), /<svg/);
    assert.equal(s.ids(), JSON.stringify(["hole-1"]));
  });

  test("the frame is stated on screen, not left to be assumed", () => {
    built(s);
    assert.match(s.out(), /Measured from the bottom-left corner of the top face/);
    assert.match(s.out(), /X is across the width/);
  });

  test("an impossible hole is refused and the typed values are kept", () => {
    built(s);
    s.set("pb-hx", "500");
    s.run("scAddHole();");
    assert.match(s.status(), /falls outside the block/);
    assert.equal(s.els.get("pb-hx").value, "500", "the form still has what was typed");
    assert.equal(s.ids(), JSON.stringify(["hole-1"]), "and the model is unchanged");
  });

  test("a hole on top of another is refused by name", () => {
    built(s);
    s.set("pb-hx", "16"); s.set("pb-hy", "25"); s.set("pb-hd", "6");
    s.run("scAddHole();");
    assert.match(s.status(), /overlaps hole-1/);
  });

  test("a pocket through the plate is refused with the reason", () => {
    built(s);
    s.set("pb-px", "40"); s.set("pb-py", "10");
    s.set("pb-pw", "20"); s.set("pb-pl", "20"); s.set("pb-pd", "10");
    s.run("scAddPocket();");
    assert.match(s.status(), /That is a hole, not a pocket/);
  });

  test("adding a feature before a block says so plainly", () => {
    s.run("scAddHole();");
    assert.match(s.status(), /Start a block first/);
  });

  test("a resize that would strand a hole is refused", () => {
    built(s);
    s.set("pb-w", "10");
    s.run("scSetBlock();");
    assert.match(s.status(), /hole-1 would fall outside/);
  });

  test("undo steps back", () => {
    built(s);
    s.run("scUndoModel();");
    assert.equal(s.ids(), JSON.stringify([]));
    s.run("scRedoModel();");
    assert.equal(s.ids(), JSON.stringify(["hole-1"]));
  });
});

/* ------------------------------------------------------- what it reports */

describe("volume and weight", () => {
  test("a plain block reports one exact volume", () => {
    const s = studio();
    s.set("pb-w", "100"); s.set("pb-l", "50"); s.set("pb-t", "10");
    s.run("scSetBlock();");
    assert.match(s.out(), /50000 mm³/);
    assert.equal(/–/.test(s.out().slice(s.out().indexOf("Volume"), s.out().indexOf("Weight"))), false,
      "nothing round is involved, so there is no range");
  });

  test("a hole makes it a range, and says why", () => {
    const s = built(studio());
    const section = s.out().slice(s.out().indexOf("Volume"), s.out().indexOf("Weight"));
    assert.match(section, /–/, "a round feature puts pi in the arithmetic");
    assert.match(s.out(), /contains pi/);
  });

  test("with no density there is no weight, and it says why", () => {
    const s = built(studio());
    assert.match(s.out(), /Not known/);
    assert.match(s.out(), /guessed from a similar alloy/);
  });

  test("a sourced density gives a weight", () => {
    const s = built(studio({ values: {
      "sc-dv": "2.7", "sc-du": "g/cm3", "sc-ds": "Synthetic datasheet" } }));
    assert.match(s.out(), /Weight/);
    assert.equal(/Not known/.test(s.out()), false);
  });

  test("a density with no source is not used", () => {
    // units.mjs throws; the builder must carry on without a weight rather
    // than falling over.
    const s = built(studio({ values: { "sc-dv": "2.7", "sc-du": "g/cm3", "sc-ds": "" } }));
    assert.match(s.out(), /Not known/);
  });
});

/* ------------------------------------------------------------- the view */

describe("the plan view", () => {
  test("is drawn from the model's own numbers", () => {
    const s = built(studio());
    // One block rectangle, one hole circle, one origin dot.
    assert.equal((s.out().match(/<circle/g) || []).length, 2);
    assert.equal((s.out().match(/<rect/g) || []).length, 1);
  });

  test("a pocket is drawn differently from a hole", () => {
    const s = built(studio());
    s.set("pb-px", "40"); s.set("pb-py", "10");
    s.set("pb-pw", "20"); s.set("pb-pl", "20"); s.set("pb-pd", "3");
    s.run("scAddPocket();");
    assert.match(s.out(), /stroke-dasharray/, "a pocket is not a through feature");
  });

  test("it describes itself for anyone who cannot see it", () => {
    const s = built(studio());
    assert.match(s.out(), /aria-label="Plan view of the part, 100 by 50 millimetres, with 1 feature\(s\)"/);
  });

  test("it is not called a 3D model or a render", () => {
    // It is a plan view. Calling it anything else would claim more than it is.
    assert.equal(/\b3D\b|render|perspective/i.test(fnSource("scModelSvg", app)), false);
  });
});

/* -------------------------------------------------------------- the page */

describe("it is on the page", () => {
  test("the panel says what it is not", () => {
    assert.match(page, /This is not a CAD\s*\n?\s*package/);
    assert.match(page, /no curves, no fillets, nothing freeform/);
  });

  test("and that everything else works without it", () => {
    assert.match(page, /Everything else on this page\s*\n?\s*works without it/);
    assert.match(page, /bw-status--derived">optional/);
  });

  test("every action is registered", () => {
    for (const name of ["scSetBlock", "scAddHole", "scAddPocket", "scRemoveFeature",
      "scUndoModel", "scRedoModel"]) {
      assert.match(app, new RegExp(`${name}: function`), `${name} is not registered`);
    }
  });

  test("the requirements panel is given the real feature list", () => {
    const fn = fnSource("scRenderRequirements", app);
    assert.match(fn, /scFeatureIds\(\)/);
    assert.equal(/reqSchedule\(_scReqs,\s*\[\]\)/.test(fn), false,
      "an empty list here is what made the detached state unreachable");
  });

  test("the module reaches the page through the mount", () => {
    const mount = readFileSync("mount.mjs", "utf8");
    for (const name of ["addHole", "addPocket", "featureIds", "geometryMass", "geometryHistory"]) {
      assert.match(mount, new RegExp(`\\b${name}\\b`), `${name} is not exposed`);
    }
  });
});
