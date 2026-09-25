/**
 * Switching view, executed rather than pattern-matched.
 *
 * The other journey tests read the source and check that panels are moved
 * instead of rebuilt. That catches the obvious regression and not the
 * interesting one: an ordering mistake in the move itself, which leaves the
 * source looking exactly right and drops somebody's work anyway.
 *
 * So this runs the real functions — `scCapturePanels`, `scView`,
 * `scRenderGuided`, `scPanelsHome` — over a DOM built from the page's own
 * markup, with values typed into the real field ids, and asserts that the
 * values and the expert layout both survive a round trip.
 *
 * The DOM here is a shim, not a browser. It implements exactly the surface
 * these four functions touch, which is why it can be small and why it is
 * honest: anything they started using that is not below would throw rather
 * than quietly pass. It says nothing about layout, focus or paint — see
 * docs/BROWSER-CHECKS.md for what only a browser can answer.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource, fnSource as pageFnSource } from "../helpers/page.mjs";

const html = pageSource();
const app = readFileSync("app.js", "utf8");
const fnSource = (name) => pageFnSource(name, app);

const page = html.slice(html.indexOf('id="page-shouldcost"'),
                        html.indexOf("<!-- ============ WORKSPACE"));

/* ------------------------------------------------------------- the shim */

class El {
  constructor(doc, tag = "div") {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.hidden = false;
    this.id = "";
    this.className = "";
    this.value = "";
    this.disabled = false;
    this._html = "";
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[i + 1] ?? null;
  }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, ref) {
    if (node.parentNode) node.parentNode.removeChild(node);
    const at = ref === null || ref === undefined
      ? this.childNodes.length
      : this.childNodes.indexOf(ref);
    /* A reference node that is not a child is a real DOM error. Matching that
       matters: silently appending is how an ordering bug would hide here. */
    if (at < 0) throw new Error("insertBefore: the reference node is not a child");
    this.childNodes.splice(at, 0, node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  querySelector() { return null; }
  /* innerHTML is write-only here. Nothing under test reads it back, and a
     shim that pretended to parse markup would be inventing a result. */
  set innerHTML(v) { this._html = String(v); this.childNodes.length = 0; }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text ?? ""; }
  scrollIntoView() {}
  focus() { this.ownerDocument.activeElement = this; }
}

function makeDocument() {
  const byId = new Map();
  const doc = {
    activeElement: null,
    byId,
    createElement(tag) { return new El(doc, tag); },
    getElementById(id) { return byId.get(id) ?? null; },
    querySelectorAll(sel) {
      if (sel !== "#page-shouldcost [data-sc-panel]") {
        throw new Error(`the shim does not implement the selector ${sel}`);
      }
      const out = [];
      (function walk(n) {
        for (const c of n.childNodes) {
          if (c.dataset && c.dataset.scPanel) out.push(c);
          walk(c);
        }
      })(byId.get("page-shouldcost"));
      return out;
    },
  };
  doc.make = (tag, id) => {
    const el = new El(doc, tag);
    if (id) { el.id = id; byId.set(id, el); }
    return el;
  };
  return doc;
}

/* --------------------------------------- the page's own panel containment */

/**
 * Which field ids sit inside which panel, read from the markup.
 *
 * Every panel wrapper closes with an `<!-- /name -->` comment, so the block
 * can be sliced without parsing HTML. Built from the page rather than typed
 * out, so a field that moves between panels moves here too.
 */
function panelContents() {
  const out = [];
  for (const m of page.matchAll(/data-sc-panel="([a-z]+)"/g)) {
    const name = m[1];
    /* The goal question lives inside the guided host rather than in a column,
       and is built explicitly above. It is the one panel with no home to
       return to, which is the behaviour a test below pins down. */
    if (name === "goal") continue;
    const start = m.index;
    const end = page.indexOf(`<!-- /${name} -->`, start);
    assert.notEqual(end, -1, `the panel "${name}" has no closing marker`);
    const block = page.slice(start, end);
    out.push({ name, ids: [...block.matchAll(/\sid="([a-zA-Z0-9-]+)"/g)].map((i) => i[1]) });
  }
  return out;
}

/** Build the tree: three columns, the panels in markup order, fields inside. */
function buildPage() {
  const doc = makeDocument();
  const root = doc.make("div", "page-shouldcost");
  const guided = doc.make("div", "sc-guided");
  const stage = doc.make("div", "sc-guided-stage");
  const nav = doc.make("div", "sc-guided-nav");
  const summary = doc.make("div", "sc-guided-summary");
  const expert = doc.make("div", "sc-expert");

  guided.appendChild(summary); guided.appendChild(stage); guided.appendChild(nav);
  const goal = doc.make("div", "sc-goal-panel");
  goal.dataset.scPanel = "goal";
  guided.appendChild(goal);
  root.appendChild(guided); root.appendChild(expert);

  for (const b of ["sc-view-guided", "sc-view-expert", "sc-view-note"]) root.appendChild(doc.make("button", b));
  for (const b of ["sc-model-call", "sc-questions"]) root.appendChild(doc.make("div", b));
  /* Hidden, as the markup has it. The model panel is offered on every step
     once the builder is open, so a shim that left it showing would put an
     extra panel on every stage and the assertion below would be wrong about
     which step owns what. */
  const builder = doc.make("div", "sc-builder");
  builder.hidden = true;
  root.appendChild(builder);

  const panels = panelContents();
  /* Three columns, so a panel put back into the wrong one is detectable. */
  const cols = [doc.make("div", "col-0"), doc.make("div", "col-1"), doc.make("div", "col-2")];
  cols.forEach((c) => expert.appendChild(c));

  const home = new Map();
  panels.forEach((p, i) => {
    const wrap = doc.make("div");
    wrap.dataset.scPanel = p.name;
    const col = cols[Math.min(2, Math.floor(i / Math.ceil(panels.length / 3)))];
    col.appendChild(wrap);
    home.set(p.name, { col: col.id, index: col.childNodes.length - 1 });
    for (const id of p.ids) {
      if (doc.byId.has(id)) continue;
      wrap.appendChild(doc.make("input", id));
    }
  });

  return { doc, panels, home, cols };
}

/** Run the real view code over that tree. */
function harness() {
  const built = buildPage();
  const sandbox = {
    document: built.doc,
    console,
    ciEsc: (x) => String(x),
    attrEsc: (x) => String(x),
    _scStages: [],
    _scCosts: {},
    _scReqs: [],
    _scUnknown: {},
    _scLast: null,
    SC_FIELD_HELP: {},
    /* Only the summary is stubbed: it is rendered markup, and what is under
       test is where the panels end up. */
    scRenderSummary() {},
    scAssess: () => ({ has: () => false, unknowns: [], unknownIds: [], planMissing: [],
      massMissing: [], planReady: false, massReady: false, costReady: false,
      costOn: 0, costPriced: 0, costGaps: [], stages: 0, requirements: 0, ran: false }),
    scRenderBuilder() {},
  };
  vm.createContext(sandbox);
  vm.runInContext([
    fnSource("scCapturePanels"), fnSource("scPanelsHome"), fnSource("scView"),
    fnSource("scGoStep"), fnSource("scRenderGuided"), fnSource("scStepRailEl"),
    fnSource("scStepDone"), fnSource("scGuideNavHTML"), fnSource("scStepById"),
    app.slice(app.indexOf("var SC_STEPS="), app.indexOf("function scStepById")),
    "var _scView=\"expert\"; var _scStep=\"start\"; var _scPanelHome=null;",
  ].join("\n"), sandbox);

  return {
    ...built, sandbox,
    run: (code) => vm.runInContext(code, sandbox),
    set: (id, v) => { built.doc.byId.get(id).value = v; },
    get: (id) => built.doc.byId.get(id).value,
    /* Where a panel currently sits: which column, and at what index. */
    where: (name) => {
      const el = built.doc.querySelectorAll("#page-shouldcost [data-sc-panel]")
        .find((p) => p.dataset.scPanel === name);
      if (!el || !el.parentNode) return null;
      return { parent: el.parentNode.id, index: el.parentNode.childNodes.indexOf(el) };
    },
  };
}

/* ------------------------------------------------------------- the tests */

describe("switching view keeps the work", () => {
  test("values typed in the expert view survive a round trip", () => {
    const h = harness();
    const typed = { "sc-qty": "1000", "sc-bw": "200", "sc-bl": "100",
                    "sc-dv": "7.85", "sc-grade": "Fictional grade FG-300" };
    for (const [id, v] of Object.entries(typed)) h.set(id, v);

    h.run('scView("guided")');
    for (const [id, v] of Object.entries(typed)) {
      assert.equal(h.get(id), v, `${id} was lost on the way into the guided view`);
    }

    h.run('scView("expert")');
    for (const [id, v] of Object.entries(typed)) {
      assert.equal(h.get(id), v, `${id} was lost on the way back to the expert view`);
    }
  });

  test("a value typed in the guided view is there in the expert one", () => {
    const h = harness();
    h.run('scView("guided")');
    h.set("sc-qty", "250");
    h.run('scView("expert")');
    assert.equal(h.get("sc-qty"), "250");
  });

  test("the field elements are the same objects, not copies", () => {
    /* The guarantee underneath every assertion above. Two elements with the
       same id would let both views look right while only one is read. */
    const h = harness();
    const before = h.doc.getElementById("sc-qty");
    h.run('scView("guided")');
    h.run('scView("expert")');
    assert.equal(h.doc.getElementById("sc-qty"), before);
  });

  test("walking every step and back loses nothing", () => {
    const h = harness();
    h.set("sc-qty", "1000"); h.set("sc-kerf", "3");
    const steps = h.run("SC_STEPS.map(function(s){return s.id;})");
    for (const id of steps) h.run(`scGoStep(${JSON.stringify(id)})`);
    h.run('scView("expert")');
    assert.equal(h.get("sc-qty"), "1000");
    assert.equal(h.get("sc-kerf"), "3");
  });
});

describe("the expert layout is restored exactly", () => {
  test("every panel returns to its own column, in its own position", () => {
    const h = harness();
    const before = {};
    for (const p of h.panels) before[p.name] = h.where(p.name);

    h.run('scView("guided")');
    const steps = h.run("SC_STEPS.map(function(s){return s.id;})");
    for (const id of steps) h.run(`scGoStep(${JSON.stringify(id)})`);
    h.run('scView("expert")');

    for (const p of h.panels) {
      assert.deepEqual(h.where(p.name), before[p.name],
        `the panel "${p.name}" came back somewhere else`);
    }
  });

  test("the goal panel is put away in the expert view rather than left on screen", () => {
    const h = harness();
    h.run('scView("guided")');
    h.run('scView("expert")');
    assert.equal(h.doc.getElementById("sc-goal-panel").parentNode, null,
      "the opening question is still in the document in the expert view");
  });

  test("the two hosts are never both showing", () => {
    const h = harness();
    h.run('scView("guided")');
    assert.equal(h.doc.getElementById("sc-expert").hidden, true);
    assert.equal(h.doc.getElementById("sc-guided").hidden, false);
    h.run('scView("expert")');
    assert.equal(h.doc.getElementById("sc-expert").hidden, false);
    assert.equal(h.doc.getElementById("sc-guided").hidden, true);
  });

  test("a panel is never in two places at once", () => {
    const h = harness();
    h.run('scGoStep("part")');
    const seen = new Map();
    for (const p of h.doc.querySelectorAll("#page-shouldcost [data-sc-panel]")) {
      const n = p.dataset.scPanel;
      assert.equal(seen.has(n), false, `"${n}" is in the tree twice`);
      seen.set(n, true);
    }
  });

  test("the tab state follows the view", () => {
    const h = harness();
    h.run('scView("guided")');
    assert.equal(h.doc.getElementById("sc-view-guided").getAttribute("aria-selected"), "true");
    assert.equal(h.doc.getElementById("sc-view-expert").getAttribute("aria-selected"), "false");
    h.run('scView("expert")');
    assert.equal(h.doc.getElementById("sc-view-guided").getAttribute("aria-selected"), "false");
    assert.equal(h.doc.getElementById("sc-view-expert").getAttribute("aria-selected"), "true");
  });
});

describe("the guided stage shows one task", () => {
  test("each step puts its own panels on the stage and no others", () => {
    const h = harness();
    const steps = h.run("SC_STEPS.map(function(s){return {id:s.id,panels:s.panels};})");
    for (const s of steps) {
      h.run(`scGoStep(${JSON.stringify(s.id)})`);
      const stage = h.doc.getElementById("sc-guided-stage");
      const on = stage.childNodes.filter((c) => c.dataset && c.dataset.scPanel)
        .map((c) => c.dataset.scPanel);
      /* The model panel is offered from any step once the builder is open;
         it is closed throughout this test, so the sets must match exactly.

         Joined rather than deep-compared: `s.panels` comes back across the vm
         boundary with that realm's Array prototype, and assert/strict counts
         that as a difference while printing two identical-looking arrays. */
      assert.equal(on.join(","), Array.from(s.panels).join(","),
        `step "${s.id}" shows ${on.join(", ") || "nothing"}`);
    }
  });

  test("the step rail marks where you are", () => {
    const h = harness();
    h.run('scGoStep("cost")');
    const rail = h.doc.getElementById("sc-guided-stage").childNodes[0];
    const current = rail.childNodes
      .map((li) => li.childNodes[0])
      .filter((b) => b.getAttribute("aria-current") === "step");
    assert.equal(current.length, 1, "the rail marks no single current step");
    assert.equal(current[0].textContent, "The cost");
  });
});
