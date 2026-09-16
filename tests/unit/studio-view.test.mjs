/**
 * The Studio's live preview.
 *
 * `src/render/studio-view.mjs` arrived with the 16 September update: a
 * hundred and fifteen lines of DOM logic, imported by no test and with
 * neither of its exports named by one. It is also the code least likely to
 * survive contact with a browser unexamined, being the only part of the
 * Studio that builds elements, holds selection state across renders and
 * catches its own errors.
 *
 * Found by re-running the probe that asks which exports nothing names — the
 * same habit that found `assertUsable()` unable to fire, the stale-extraction
 * rule never handed an edit time, and the detached requirement never handed a
 * feature list.
 *
 * These tests are worth having *before* the browser pass rather than after.
 * A pass that spends its two hours finding logic faults never gets to the
 * layout faults only a browser can see.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { block, addHole, addPocket, removeFeature } from "../../src/studio/geometry.mjs";

const mm = (x) => BigInt(Math.round(x * 1000));
const ok = (r) => { assert.equal(r.error, undefined, r.error); return r.model; };
const plate = () => block({ widthUm: mm(100), lengthUm: mm(50), thicknessUm: mm(10) });

/* ---------------------------------------------------------------- the DOM */

/**
 * Enough of a document for this module.
 *
 * Deliberately small and real rather than a mock that answers everything: the
 * module reaches for elements by id and a stub that conjures them on demand
 * would hide exactly the missing-element case worth checking.
 */
function fakeDom(ids) {
  const nodes = new Map();

  const make = (tag = "div") => {
    const node = {
      tagName: tag.toUpperCase(),
      _text: "", className: "", type: "", id: "",
      children: [], attrs: {}, listeners: {},
      innerHTML: "",
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v); this.children = []; },
      append(...kids) { this.children.push(...kids); },
      replaceChildren(...kids) { this.children = [...kids]; this.innerHTML = ""; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      addEventListener(kind, fn) { (this.listeners[kind] ||= []).push(fn); },
      classList: { add() {}, remove() {} },
      /* Not-found is the honest answer from a stub: initStudio decorates
         markup it does not own, and every one of these returning null is the
         case worth checking. */
      querySelector: () => null,
      closest: () => null,
      prepend(...kids) { this.children.unshift(...kids); },
      before() {},
      focus() {},
      scrollIntoView() {},
    };
    return node;
  };

  for (const id of ids) { const n = make(); n.id = id; nodes.set(id, n); }

  globalThis.document = {
    getElementById: (id) => nodes.get(id) ?? null,
    createElement: (tag) => make(tag),
  };
  return nodes;
}

const PRESENT = ["studio-canvas", "studio-model-state", "studio-export-hint",
  "studio-feature-picks", "studio-selection"];

/** Load a fresh copy of the module, since it holds state in closure. */
async function load() {
  return import(`../../src/render/studio-view.mjs?v=${Math.random()}`);
}

let nodes;
beforeEach(() => { nodes = fakeDom(PRESENT); });

const text = (id) => nodes.get(id).textContent;

/* ------------------------------------------------------------ no model yet */

describe("before a part exists", () => {
  test("it says there is no model, rather than looking broken", async () => {
    const { updateStudio } = await load();
    updateStudio(null);
    assert.match(text("studio-model-state"), /No model yet/);
  });

  test("the empty state invites the next step instead of apologising", async () => {
    const { updateStudio } = await load();
    updateStudio(null);
    const empty = nodes.get("studio-canvas").children[0];
    assert.equal(empty.className, "bw-preview-empty");
    const words = empty.children.map((c) => c.textContent).join(" ");
    assert.match(words, /See the part as you build it/);
    assert.match(words, /A model is optional/,
      "the whole product works without one, and the empty state has to say so");
  });

  test("the hint points at the control that starts one", async () => {
    const { updateStudio } = await load();
    updateStudio(null);
    assert.match(text("studio-export-hint"), /Set the block/);
  });

  test("there is nothing to select", async () => {
    const { updateStudio } = await load();
    updateStudio(null);
    assert.equal(nodes.get("studio-feature-picks").children.length, 0);
    assert.match(text("studio-selection"), /Select a feature/);
  });
});

/* --------------------------------------------------------- with a part */

describe("once a part exists", () => {
  const withBoth = () => {
    let m = ok(addHole(plate(), { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }));
    return ok(addPocket(m, { xUm: mm(40), yUm: mm(10),
      widthUm: mm(20), lengthUm: mm(20), depthUm: mm(3) }));
  };

  test("the revision is shown, because it is what an export is tied to", async () => {
    const { updateStudio } = await load();
    const m = withBoth();
    updateStudio(m);
    assert.match(text("studio-model-state"), new RegExp(`Model revision ${m.revision}`));
  });

  test("every feature gets a button, named by its id", async () => {
    const { updateStudio } = await load();
    updateStudio(withBoth());
    const picks = nodes.get("studio-feature-picks").children;
    assert.deepEqual(picks.map((b) => b.textContent), ["hole-1", "pocket-1"]);
  });

  test("the buttons are buttons, so they work from a keyboard", async () => {
    const { updateStudio } = await load();
    updateStudio(withBoth());
    for (const b of nodes.get("studio-feature-picks").children) {
      assert.equal(b.tagName, "BUTTON");
      assert.equal(b.type, "button", "a bare button inside a form submits it");
    }
  });

  test("and each says whether it is the selected one", async () => {
    const { updateStudio } = await load();
    updateStudio(withBoth());
    const picks = nodes.get("studio-feature-picks").children;
    assert.equal(picks[0].attrs["aria-pressed"], "false");
    picks[0].listeners.click[0]();
    assert.equal(nodes.get("studio-feature-picks").children[0].attrs["aria-pressed"], "true",
      "selection must be announced, not only drawn");
  });

  test("the hint changes to what you can do next", async () => {
    const { updateStudio } = await load();
    updateStudio(withBoth());
    assert.match(text("studio-export-hint"), /Prepare a review package/);
  });
});

/* ----------------------------------------------------------- selection */

describe("selecting a feature", () => {
  const two = () => {
    const m = ok(addHole(plate(), { xUm: mm(15), yUm: mm(25), diameterUm: mm(6) }));
    return ok(addHole(m, { xUm: mm(50), yUm: mm(25), diameterUm: mm(8) }));
  };

  test("a hole reports its centre, its diameter and that it goes through", async () => {
    const { updateStudio } = await load();
    updateStudio(two());
    nodes.get("studio-feature-picks").children[0].listeners.click[0]();
    const said = text("studio-selection");
    assert.match(said, /hole-1/);
    assert.match(said, /X 15 \/ Y 25 mm/);
    assert.match(said, /Ø 6 mm · through/);
  });

  test("a pocket reports its size and depth instead", async () => {
    const { updateStudio } = await load();
    const m = ok(addPocket(plate(), { xUm: mm(40), yUm: mm(10),
      widthUm: mm(20), lengthUm: mm(20), depthUm: mm(3) }));
    updateStudio(m);
    nodes.get("studio-feature-picks").children[0].listeners.click[0]();
    const said = text("studio-selection");
    assert.match(said, /20 × 20 mm · depth 3 mm/);
    assert.equal(/through/.test(said), false, "a pocket does not go through");
  });

  test("a fractional dimension is not mangled", async () => {
    const { updateStudio } = await load();
    const m = ok(addHole(plate(), { xUm: mm(15.5), yUm: mm(25), diameterUm: mm(6.35) }));
    updateStudio(m);
    nodes.get("studio-feature-picks").children[0].listeners.click[0]();
    assert.match(text("studio-selection"), /X 15\.5 /);
    assert.match(text("studio-selection"), /Ø 6\.35 mm/);
  });

  test("selection survives an edit that keeps the feature", async () => {
    const { updateStudio } = await load();
    const m = two();
    updateStudio(m);
    nodes.get("studio-feature-picks").children[1].listeners.click[0]();
    assert.match(text("studio-selection"), /hole-2/);

    updateStudio(ok(addPocket(m, { xUm: mm(60), yUm: mm(35),
      widthUm: mm(10), lengthUm: mm(10), depthUm: mm(2) })));
    assert.match(text("studio-selection"), /hole-2/, "adding something else deselected it");
  });

  test("and is dropped when the selected feature is deleted", async () => {
    /* Otherwise the panel keeps describing a hole that is no longer there,
       which is the same class of fault as a requirement attached to one. */
    const { updateStudio } = await load();
    const m = two();
    updateStudio(m);
    nodes.get("studio-feature-picks").children[0].listeners.click[0]();
    assert.match(text("studio-selection"), /hole-1/);

    updateStudio(ok(removeFeature(m, "hole-1")));
    assert.match(text("studio-selection"), /Select a hole or pocket/);
  });

  test("and undoing the deletion does not silently reselect it", async () => {
    /* The only way the cleared selection is observable. render() already falls
       back when the selected feature is absent, so dropping `selected` on
       delete changes nothing visible — until undo restores a feature with the
       same id, and a stale selection comes back to life against a feature the
       person had just removed.

       Found by mutation: removing the clause broke no test, which meant the
       clause was defence nobody had checked. */
    const { updateStudio } = await load();
    const m = two();
    updateStudio(m);
    nodes.get("studio-feature-picks").children[0].listeners.click[0]();
    assert.match(text("studio-selection"), /hole-1/);

    updateStudio(ok(removeFeature(m, "hole-1")));
    updateStudio(m);                       // undo: hole-1 is back, same id

    assert.match(text("studio-selection"), /Select a hole or pocket/,
      "the selection came back with the feature");
    const picks = nodes.get("studio-feature-picks").children;
    assert.equal(picks.find((b) => b.textContent === "hole-1").attrs["aria-pressed"], "false");
  });

  test("and when the part goes entirely", async () => {
    const { updateStudio } = await load();
    updateStudio(two());
    nodes.get("studio-feature-picks").children[0].listeners.click[0]();
    updateStudio(null);
    assert.match(text("studio-selection"), /Select a feature/);
    assert.equal(nodes.get("studio-feature-picks").children.length, 0);
  });
});

/* ------------------------------------------------------------ robustness */

describe("when things are not as expected", () => {
  test("with no canvas it does nothing rather than throwing", async () => {
    /* updateStudio is called from app.js on every builder render. If the
       enhanced markup is absent — an older index.html, a partial render — it
       must be inert, not fatal. */
    fakeDom([]);
    const { updateStudio } = await load();
    assert.doesNotThrow(() => updateStudio(plate()));
    assert.doesNotThrow(() => updateStudio(null));
  });

  test("a view that cannot be drawn shows why, and does not throw", async () => {
    /* The module catches a render failure into the canvas. Worth pinning:
       a throw here would take out the whole builder render that called it. */
    const { updateStudio } = await load();
    const broken = Object.freeze({ ...plate(), widthUm: null });
    assert.doesNotThrow(() => updateStudio(broken));

    /* partView refuses invalid geometry — "Preview needs positive dimensions."
       — and the module puts that in the canvas rather than letting it escape.
       It is called from every builder render, so a throw here would take the
       whole panel down over a bad number. */
    assert.match(nodes.get("studio-canvas").textContent, /positive dimensions/);
  });

  test("it never claims a revision it was not given", async () => {
    const { updateStudio } = await load();
    updateStudio(null);
    assert.equal(/revision/i.test(text("studio-model-state")), false);
  });
});

/* ------------------------------------------------- starting the preview */

describe("initStudio reaches into markup it does not own", () => {
  /**
   * A page with everything except the named ids.
   *
   * Only elements initStudio does *not* create are varied. The ones it builds
   * itself through innerHTML — the canvas, the buttons, the status lines —
   * exist by construction in a browser, and removing them here would test the
   * stub rather than the module.
   */
  function pageWithout(missing) {
    const external = ["studio-viewport", "page-shouldcost", "pb-w", "pb-l", "pb-t",
      "sc-mode-material", "sc-stages", "req-kind", "rev-partrev"];
    const internal = ["studio-view-buttons", "studio-angle", "studio-canvas",
      "studio-model-state", "studio-export-hint", "studio-feature-picks", "studio-selection"];
    const nodes = fakeDom([...external.filter((id) => !missing.includes(id)), ...internal]);
    globalThis.matchMedia = () => ({ matches: false });
    return nodes;
  }

  test("with everything present it starts", async () => {
    pageWithout([]);
    const { initStudio } = await load();
    assert.doesNotThrow(() => initStudio());
  });

  test("with no viewport it does nothing at all", async () => {
    /* The page this module was not asked to enhance. */
    pageWithout(["studio-viewport"]);
    const { initStudio } = await load();
    assert.doesNotThrow(() => initStudio());
  });

  test("a missing Part Builder input does not stop it", async () => {
    /* It watches those three for a resize preview. Reaching through a null
       here used to throw — and a throw here reached the rest of the mount. */
    for (const id of ["pb-w", "pb-l", "pb-t"]) {
      pageWithout([id]);
      const { initStudio } = await load();
      assert.doesNotThrow(() => initStudio(), `it threw without ${id}`);
    }
  });

  test("nor a missing page, mode panel or step target", async () => {
    for (const id of ["page-shouldcost", "sc-mode-material", "sc-stages"]) {
      pageWithout([id]);
      const { initStudio } = await load();
      assert.doesNotThrow(() => initStudio(), `it threw without ${id}`);
    }
  });

  test("nor all of them at once", async () => {
    pageWithout(["page-shouldcost", "pb-w", "pb-l", "pb-t", "sc-mode-material"]);
    const { initStudio } = await load();
    assert.doesNotThrow(() => initStudio());
  });

  test("the mount does not let a failure here reach what follows", () => {
    /* Where this actually bit. mount.mjs assigns window.BW, calls initStudio,
       then renders the Defender's drivers and outcomes. A throw in the middle
       leaves BW assigned — so the engine-missing banner stays correctly quiet
       — while two tables never render and nothing says why. */
    const mount = readFileSync("mount.mjs", "utf8");
    assert.match(mount, /try \{ initStudio\(\); \} catch/);
    const at = mount.indexOf("initStudio()");
    assert.ok(mount.indexOf("defRenderDrivers", at) > at,
      "the renders this protects must come after it");
  });
});
