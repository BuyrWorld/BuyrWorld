/**
 * Two things the Studio works out once and then holds.
 *
 * The calculated plan and cost, which a saved estimate is built from. And the
 * review package, which is what gets handed to an engineer. Neither was
 * invalidated when the part changed — both survived until the case was
 * closed.
 *
 * The harm is specific. Calculate a cost, add a pocket, save the estimate:
 * what is stored is the cost of the part before the pocket, filed under the
 * part after it. Build a review package, change a tolerance, export: the
 * engineer receives a package citing a requirement that no longer exists.
 * Neither says anything is wrong, because from the inside nothing is.
 *
 * `specs/04` requires recalculation, not a warning — so these check that the
 * page refuses, rather than that it prints a sentence next to a button that
 * still works.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { fnSource } from "../helpers/page.mjs";
import { stamp, check as staleCheck, DEPENDS } from "../../src/studio/staleness.mjs";
import { block, addHole } from "../../src/studio/geometry.mjs";
import { requirement, tolerance, KIND, SCOPE } from "../../src/studio/requirements.mjs";

const app = readFileSync("app.js", "utf8");
const mm = (x) => BigInt(Math.round(x * 1000));

const part = () => block({ widthUm: mm(100), lengthUm: mm(50), thicknessUm: mm(10) });
const withHole = (m) => addHole(m, { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }).model;
const req = (nominal = "6") => requirement({
  kind: KIND.DIMENSIONAL,
  tolerance: tolerance({ nominal, plusMinus: "0.05", unit: "mm" }),
  scope: { type: SCOPE.FEATURE, featureId: "hole-1" },
});

/** A page with just enough of the Studio to save an estimate or an artifact. */
function page() {
  const els = new Map();
  const mk = (id) => ({ id, value: "", innerHTML: "", dataset: {}, style: {},
    checked: false, setAttribute() {}, focus() {} });
  for (const id of ["bc-save-msg", "bc-name", "bc-part", "bc-supplier",
                    "rev-out", "sc-grade", "sc-dv", "sc-du", "sc-ds"]) els.set(id, mk(id));
  els.get("bc-name").value = "A build-up worth keeping";
  els.get("sc-grade").value = "FG-300";

  const saved = [];
  const box = {
    document: {
      getElementById: (id) => els.get(id) ?? null,
      createElement: () => ({ style: {}, click() {}, setAttribute() {},
        set href(v) { this._h = v; }, get href() { return this._h; } }),
      body: { appendChild() {}, removeChild() {} },
    },
    console,
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    Blob: function Blob(parts) { this.parts = parts; },
    setTimeout: (fn) => fn(),
    window: {
      BW: {
        staleStamp: stamp, staleCheck, STALE_DEPENDS: DEPENDS,
        estimateFrom: (plan, cost, meta) => ({ ...meta, plan, cost }),
        saveEstimate: (rec) => { saved.push(rec); return { ok: true }; },
        DRAFT_LABEL: "DRAFT — FOR TECHNICAL REVIEW",
      },
    },
    _scModel: null, _scReqs: [], _scLast: null, _scPackage: null,
    scVal: (id) => String((els.get(id) || {}).value || ""),
    scErr: (m) => `<p class="err">${m}</p>`,
    scRenderEstimates: () => {},
    bcRenderSaved: () => {},
  };
  vm.createContext(box);
  new vm.Script([
    fnSource("scDerivedFrom", app),
    fnSource("bcSave", app),
    fnSource("scSaveArtifact", app),
  ].join("\n")).runInContext(box);

  return {
    box, els, saved,
    set: (model, reqs) => {
      box.__m = model; box.__r = reqs ?? [];
      vm.runInContext("_scModel = __m; _scReqs = __r;", box);
    },
    setMaterial: (name) => { els.get("sc-grade").value = name; },
    /* Through the page's own scDerivedFrom, not a copy of it. The first
       version of this harness rebuilt the material object by hand and used
       "" where the page uses null, so every check reported the material as
       changed — a test failing for a difference it had introduced itself. */
    stampNow: () => vm.runInContext("window.BW.staleStamp(scDerivedFrom())", box),
    run: (code) => vm.runInContext(code, box),
    msg: () => els.get("bc-save-msg").innerHTML,
    review: () => els.get("rev-out").innerHTML,
  };
}

let p;
beforeEach(() => { p = page(); });

/* ------------------------------------------------------------ the estimate */

describe("an estimate belongs to the part it names", () => {
  /* One instance, reused. requirement() mints a fresh id on every call, so
     two req() calls are two different requirements and "nothing changed"
     would never hold. */
  let only;
  function calculated() {
    only = req();
    p.set(part(), [only]);
    p.box.__stamp = p.stampNow();
    p.run("_scLast = { plan: {}, cost: {}, stamp: __stamp };");
  }

  test("it saves while the part is the one it was worked out for", () => {
    calculated();
    p.run("bcSave();");
    assert.equal(p.saved.length, 1, p.msg());
  });

  test("adding a feature afterwards stops it", () => {
    /* The case this exists for: the cost of the part before the pocket,
       filed under the part after it. */
    calculated();
    p.set(withHole(part()), [only]);
    p.run("bcSave();");

    assert.equal(p.saved.length, 0, "a stale estimate was saved");
    assert.match(p.msg(), /The part&#39;s geometry has changed/);
    assert.match(p.msg(), /Recalculate, then save/);
  });

  test("changing the material stops it", () => {
    calculated();
    p.setMaterial("FG-400");
    p.run("bcSave();");
    assert.equal(p.saved.length, 0);
    assert.match(p.msg(), /The material has changed/);
  });

  test("changing a requirement stops it", () => {
    calculated();
    p.set(part(), [req("6.5")]);
    p.run("bcSave();");
    assert.equal(p.saved.length, 0);
    assert.match(p.msg(), /The requirements have changed/);
  });

  test("it says what moved rather than that something did", () => {
    calculated();
    p.set(withHole(part()), [only]);
    p.setMaterial("FG-400");
    p.run("bcSave();");
    assert.match(p.msg(), /geometry/);
    assert.match(p.msg(), /material/);
  });

  test("a calculation with no stamp still saves", () => {
    /* One worked out before stamps existed cannot prove it is current, and
       refusing it would break a case somebody had open. It is the older
       behaviour, unchanged. */
    p.set(part(), [req()]);
    void only;
    p.run("_scLast = { plan: {}, cost: {} };");
    p.run("bcSave();");
    assert.equal(p.saved.length, 1);
  });
});

/* ------------------------------------------------------- the review package */

describe("a review package describes the part it was built from", () => {
  let only;
  function built() {
    only = req();
    p.set(part(), [only]);
    p.box.__stamp = p.stampNow();
    p.run("_scPackage = { files: { 'part-model.json': '{}' }, manifest: {}, stamp: __stamp };");
  }

  test("it saves an artifact while the part still matches", () => {
    built();
    p.run("scSaveArtifact('part-model.json');");
    assert.equal(p.review(), "", "an error was shown for a package that is current");
  });

  test("changing a tolerance afterwards stops the export", () => {
    /* An engineer receiving a package that cites a requirement which no
       longer exists is the failure specs/04 names. */
    built();
    p.set(part(), [req("6.5")]);
    p.run("scSaveArtifact('part-model.json');");

    assert.match(p.review(), /The requirements have changed/);
    assert.match(p.review(), /Build it again before sending it/);
  });

  test("changing the geometry stops it too", () => {
    built();
    p.set(withHole(part()), [only]);
    p.run("scSaveArtifact('part-model.json');");
    assert.match(p.review(), /geometry has changed/);
  });

  test("the wording tells you to rebuild, not to recalculate", () => {
    /* An estimate is recalculated and a package is rebuilt. Telling somebody
       to do the wrong one is worse than telling them nothing. */
    built();
    p.set(withHole(part()), [only]);
    p.run("scSaveArtifact('part-model.json');");
    assert.match(p.review(), /has to be rebuilt/);
    assert.equal(/worked out again/.test(p.review()), false);
  });
});

/* --------------------------------------------------------- what it depends on */

describe("what the Studio says its derived things depend on", () => {
  test("one place decides, rather than each caller reading four things", () => {
    /* The failure this shape guards against is a caller that checked three of
       the four and let the fourth through. */
    const src = fnSource("scDerivedFrom", app);
    for (const part of ["geometry", "material", "requirements"]) {
      assert.ok(src.includes(part), `${part} is not among what a derived thing depends on`);
    }
  });

  test("both guards ask the same function", () => {
    assert.match(fnSource("bcSave", app), /scDerivedFrom\(\)/);
    assert.match(fnSource("scSaveArtifact", app), /scDerivedFrom\(\)/);
  });
});

/* ----------------------------------------------- the stamps are taken at all */

/**
 * That the guards can fire.
 *
 * The tests above put a stamp into `_scLast` and `_scPackage` themselves, so
 * they check what the guards do with one — and pass perfectly well if nothing
 * in the page ever takes a stamp. Deleting the stamping line left all twelve
 * green, which makes them a test of a mechanism that could not run.
 *
 * These check the other half: the two places that produce a derived thing
 * record what they derived it from.
 */
describe("the page stamps what it works out", () => {
  test("the calculation records the part it was worked out for", () => {
    const fn = fnSource("scRun", app);
    assert.match(fn, /_scLast=\{plan:plan,cost:cost,/,
      "the calculated plan and cost are stored without a stamp");
    assert.match(fn, /staleStamp\(scDerivedFrom\(\)\)/);
  });

  test("the review package records the part it describes", () => {
    const fn = fnSource("scExportReview", app);
    assert.match(fn, /staleStamp\(scDerivedFrom\(\)\)/,
      "the review package is built without a stamp");
  });

  test("both stamp through the same description of the part", () => {
    /* Two ideas of what a derived thing depends on would drift, and the one
       that drifted would be the one that stopped catching things. */
    for (const name of ["scRun", "scExportReview"]) {
      assert.match(fnSource(name, app), /scDerivedFrom\(\)/, name);
    }
  });
});
