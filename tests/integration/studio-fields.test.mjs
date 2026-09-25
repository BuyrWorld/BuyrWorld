/**
 * Provenance, "I don't know", and help on every field the engine reads.
 *
 * The pack's rule, stated twice in different words: *"Never turn missing
 * information into an invisible default, a zero cost or a passing check"*, and
 * *"do not calculate a complete purchase quantity using an invisible
 * default"*. A field somebody has said they cannot answer is the sharpest case
 * of that, because it is the one where the person has actively told you the
 * number does not exist yet.
 *
 * The distinction that drives all of this: blank is somebody who has not got
 * there yet; unknown is somebody who has, and cannot answer. They need
 * different words on screen and different behaviour in the engine, because the
 * next step differs — a forgotten field is yours to fill in, an unknown one is
 * somebody else's to answer.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource, fnSource } from "../helpers/page.mjs";

const app = readFileSync("app.js", "utf8");
const html = pageSource();

/* ------------------------------------------------------------- the harness */

/** Run the field layer over a stub form. */
function form({ values = {}, unknown = {}, assumed = {}, source = {} } = {}) {
  const made = [];
  const els = new Map();

  const element = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(),
      id: "", className: "", innerHTML: "", textContent: "", value: "",
      disabled: false, dataset: {}, children: [],
      style: {}, attrs: {},
      appendChild(child) { this.children.push(child); child.parent = this; return child; },
      setAttribute(k, v) { this.attrs[k] = v; },
      focus() { this.focused = true; },
      closest(sel) {
        const want = sel.replace(".", "");
        let node = this;
        while (node) { if (String(node.className).split(" ").includes(want)) return node; node = node.parent; }
        return null;
      },
    };
    made.push(el);
    return el;
  };

  /* One input per mapped field, each inside a .bw-field label. */
  const ids = Object.keys(JSON.parse(
    vm.runInContext("JSON.stringify(SC_FIELD_HELP)", helpContext())));
  for (const id of ids) {
    const label = element("label");
    label.className = "bw-field";
    const input = element("input");
    input.id = id;
    input.value = values[id] ?? "";
    label.appendChild(input);
    els.set(id, input);
    els.set(`__label__${id}`, label);
  }

  const sandbox = {
    document: {
      getElementById: (id) => {
        if (els.has(id)) return els.get(id);
        const meta = made.find((m) => m.id === id);
        return meta ?? null;
      },
      createElement: (tag) => element(tag),
    },
    console,
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    /* The gap card carries the field id into a data- attribute, so the
       attribute escaper is a dependency of it as well. */
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
  };

  vm.createContext(sandbox);
  vm.runInContext(
    [helpSource(),
      fnSource("scFieldName", app), fnSource("scFieldState", app), fnSource("scStateDot", app),
      fnSource("scAnnotate", app), fnSource("scRenderFieldStates", app),
      fnSource("scDontKnow", app), fnSource("scUnknownFields", app),
      /* "I don't know" now produces a next step rather than a disabled box:
         the question to ask, who to ask it of, and what is still available
         without the answer. Its two helpers go in with it. */
      fnSource("scGapCardHTML", app), fnSource("scStillAvailable", app),
      fnSource("scBlocksOf", app),
      /* A field can also be standing on a stated assumption, which reads
         differently again from both an answer and a gap. */
      fnSource("scIsAssumed", app), fnSource("scAssumedCardHTML", app),
      fnSource("scAssumeFormHTML", app),
      "function scTouched(id){ if(SC_FIELD_HELP[id]) _scEdited[id]=new Date().toISOString(); }",

      /* The state variables go in *after* every extracted function, and that
         ordering is load-bearing. fnSource slices from one `function` to the
         next, so a helper that happens to be followed by top-level `var`
         declarations carries them along — scBlocksOf is followed by exactly
         these three. Declared first, they were silently reset to empty by the
         slice, and every "I don't know" test read the field as merely Missing.
         Declared last, the fixture wins. */
      `var _scSource=${JSON.stringify(source)};`,
      /* scDontKnow records the edit, so a later extraction cannot quietly
         overrule somebody saying they do not know. */
      "var _scEdited={};",
      /* Stated assumptions: id to the basis somebody gave. Empty here — the
         assumption path has its own tests below. */
      `var _scAssumed=${JSON.stringify(assumed)};`,
      "var _scAssumeOpen=null;",
      `var _scUnknown=${JSON.stringify(unknown)};`,
    ].join("\n"),
    sandbox);

  return {
    sandbox, els, made,
    run: (code) => vm.runInContext(code, sandbox),
    input: (id) => els.get(id),
    meta: (id) => made.find((m) => m.id === `scmeta-${id}`),
    gap: (id) => made.find((m) => m.id === `scgap-${id}`),
    label: (id) => els.get(`__label__${id}`),
    /* Controls a browser would create by parsing a card's innerHTML. This
       shim stores innerHTML as a string rather than parsing it, so the inputs
       the assumption form declares are registered here instead — the same
       ids, found the same way by getElementById. */
    stub: (id) => { const el = element("input"); el.id = id; return el; },
  };
}

/** The SC_FIELD_HELP table, on its own, for enumerating the mapped ids. */
function helpSource() {
  const at = app.indexOf("var SC_FIELD_HELP = {");
  assert.notEqual(at, -1, "the field help table is not where this test expects it");
  const end = app.indexOf("\n};", at);
  return app.slice(at, end + 3);
}
function helpContext() {
  const ctx = { };
  vm.createContext(ctx);
  vm.runInContext(helpSource(), ctx);
  return ctx;
}

const FIELD_IDS = Object.keys(JSON.parse(
  vm.runInContext("JSON.stringify(SC_FIELD_HELP)", helpContext())));

/* ------------------------------------------------------------ the mapping */

describe("the fields the engine reads carry help", () => {
  test("every mapped field names a field in the scenario model", () => {
    const model = readFileSync("src/studio/scenario.mjs", "utf8");
    const ctx = helpContext();
    const help = JSON.parse(vm.runInContext("JSON.stringify(SC_FIELD_HELP)", ctx));
    for (const [id, entry] of Object.entries(help)) {
      assert.ok(entry.name, `${id} has no scenario field name`);
      assert.match(model, new RegExp(`["\\[]"?${entry.name}"`),
        `${id} maps to "${entry.name}", which the scenario model does not have`);
    }
  });

  test("each answers both questions the pack asks for", () => {
    const help = JSON.parse(vm.runInContext("JSON.stringify(SC_FIELD_HELP)", helpContext()));
    for (const [id, entry] of Object.entries(help)) {
      assert.ok(entry.means && entry.means.length > 25, `${id} does not say what it means`);
      assert.ok(entry.where && entry.where.length > 25, `${id} does not say where to find it`);
    }
  });

  test("the help is attached to the field, not written into the markup sixteen times", () => {
    // Sixteen hand-written copies is sixteen chances to get one wrong, and
    // CLAUDE.md asks for a large index.html change to be split rather than made.
    assert.match(fnSource("scAnnotate", app), /document\.createElement\("details"\)/);
    assert.equal(/What does this mean\?/.test(html.slice(html.indexOf('id="sc-mode-material"'),
      html.indexOf('id="sc-mode-cert"'))), false, "the help should not be in the markup");
  });

  test("help text is set as text, never as markup", () => {
    const fn = fnSource("scAnnotate", app);
    assert.match(fn, /body\.textContent=/);
    assert.match(fn, /where\.textContent=/);
    assert.equal(/\.innerHTML\s*=\s*SC_FIELD_HELP/.test(fn), false);
  });
});

/* -------------------------------------------------------------- the states */

describe("what each field says about itself", () => {
  test("an empty field reads Missing", () => {
    const f = form();
    assert.equal(f.run('scFieldState("sc-qty")'), "Missing");
  });

  test("a filled field reads User confirmed", () => {
    const f = form({ values: { "sc-qty": "1000" } });
    assert.equal(f.run('scFieldState("sc-qty")'), "User confirmed");
  });

  test("a field the person could not answer reads as not known", () => {
    const f = form({ unknown: { "sc-kerf": true } });
    assert.equal(f.run('scFieldState("sc-kerf")'), "Not known yet");
  });

  test("and that is a different answer from Missing", () => {
    const f = form({ unknown: { "sc-kerf": true } });
    assert.notEqual(f.run('scFieldState("sc-kerf")'), f.run('scFieldState("sc-qty")'));
  });

  test("an extracted value says it needs checking", () => {
    const f = form({ values: { "sc-bw": "200" } });
    f.run('_scSource["sc-bw"]="extracted";');
    assert.equal(f.run('scFieldState("sc-bw")'), "Extracted — check this");
  });

  test("an assumption says it is assumed", () => {
    const f = form({ values: { "sc-kerf": "3" } });
    f.run('_scSource["sc-kerf"]="assumption";');
    assert.equal(f.run('scFieldState("sc-kerf")'), "Assumed");
  });

  test("the four states are visibly distinct without relying on colour", () => {
    // Each carries its own words; the dot is an addition, never the signal.
    const states = ["Missing", "User confirmed", "Not known yet", "Extracted — check this", "Assumed"];
    assert.equal(new Set(states).size, states.length);
    assert.match(fnSource("scRenderFieldStates", app), /ciEsc\(state\)/);
  });
});

/* ------------------------------------------------------- saying you cannot */

describe("saying you do not know", () => {
  let f;
  beforeEach(() => { f = form({ values: { "sc-kerf": "3" } }); f.run("scAnnotate();"); });

  test("marks the field and disables it", () => {
    f.run('scDontKnow("sc-kerf");');
    assert.equal(f.run('_scUnknown["sc-kerf"]'), true);
    assert.equal(f.input("sc-kerf").disabled, true);
  });

  test("and clears the value, so no stale number reaches the engine", () => {
    /* A disabled input still hands its old value to anything reading .value.
       Leaving 3 in there would let it reach the engine behind a label saying
       nobody knows it — the exact invisible default the pack forbids. */
    assert.equal(f.input("sc-kerf").value, "3");
    f.run('scDontKnow("sc-kerf");');
    assert.equal(f.input("sc-kerf").value, "");
  });

  test("it can be taken back, and the field becomes editable again", () => {
    f.run('scDontKnow("sc-kerf"); scDontKnow("sc-kerf");');
    assert.equal(f.run('_scUnknown["sc-kerf"]'), undefined);
    assert.equal(f.input("sc-kerf").disabled, false);
  });

  test("taking it back puts the cursor where the answer goes", () => {
    f.run('scDontKnow("sc-kerf"); scDontKnow("sc-kerf");');
    assert.equal(f.input("sc-kerf").focused, true);
  });

  test("the control says which way it will go", () => {
    f.run("scRenderFieldStates();");
    assert.match(f.meta("sc-kerf").innerHTML, /I don&rsquo;t know/);
    f.run('scDontKnow("sc-kerf");');
    assert.match(f.meta("sc-kerf").innerHTML, /I know this after all/);
  });

  test("and is announced as a toggle", () => {
    f.run('scDontKnow("sc-kerf");');
    assert.match(f.meta("sc-kerf").innerHTML, /aria-pressed="true"/);
  });

  test("an id that is not a mapped field does nothing", () => {
    assert.doesNotThrow(() => f.run('scDontKnow("sc-nonsense");'));
    assert.equal(f.run('Object.keys(_scUnknown).length'), 0);
  });

  test("unknown fields are reported by their model names, not their input ids", () => {
    f.run('scDontKnow("sc-kerf"); scDontKnow("sc-qty");');
    const names = f.run("JSON.stringify(scUnknownFields())");
    assert.deepEqual(JSON.parse(names).sort(), ["goodParts", "kerf"]);
  });
});

/* ------------------------------------------------- and the engine refuses */

describe("the calculation refuses a field nobody knows", () => {
  const source = fnSource("scRun", app);

  test("it checks before any arithmetic starts", () => {
    const guard = source.indexOf("scUnknownFields()");
    /* Reading the form and calling the engine moved into scBuildPlan, which
       the comparison reuses. So the ordering to hold is between the guard and
       scRun's call to *that* — and separately that scBuildPlan is where the
       engine is actually called, so this is not checking an empty seam. */
    const call = source.indexOf("scBuildPlan()");
    assert.notEqual(guard, -1, "scRun does not check for unknown fields");
    assert.notEqual(call, -1, "scRun no longer builds a plan where this test expects it");
    assert.ok(guard < call, "the check must come before the engine is called");

    assert.match(fnSource("scBuildPlan", app), /B\.planMaterial\(\{/,
      "scBuildPlan does not call the engine, so the ordering above guards nothing");
  });

  test("every path to the engine goes through the one that is guarded", () => {
    /* The comparison runs the engine too. It is reachable only from a result
       that already exists, which scRun refuses to produce while a field is
       unknown — so there is no second way past the guard. */
    assert.match(fnSource("scCompareRun", app), /if\(!out\|\|!v\|\|!_scLast\|\|!_scLast\.plan\)return;/,
      "a comparison can be run without a plan, which is a way round the refusal");
    const calls = (app.match(/B\.planMaterial\(\{/g) || []).length;
    assert.equal(calls, 1, `the engine is called from ${calls} places; only scBuildPlan should call it`);
  });

  test("it names them, rather than saying a value is missing", () => {
    // "Enter a blank width" would be wrong: they did not forget it.
    assert.match(source, /Waiting on "\+unknown\.join\(", "\)/);
    assert.match(source, /You marked/);
  });

  test("it says the rest of the work is kept", () => {
    assert.match(source, /can save it as a draft/);
    assert.match(source, /The rest of what you have entered is kept/);
  });

  test("and it returns rather than falling through to a partial answer", () => {
    const at = source.indexOf("var unknown=scUnknownFields();");
    const block = source.slice(at, at + 700);
    assert.match(block, /return;/);
  });
});

/* ---------------------------------------------------------- the annotation */

describe("annotating the form", () => {
  test("every mapped field gets a row and a help panel", () => {
    const f = form();
    f.run("scAnnotate();");
    for (const id of FIELD_IDS) {
      assert.ok(f.meta(id), `${id} has no provenance row`);
      assert.equal(f.label(id).children.some((c) => c.tagName === "DETAILS"), true,
        `${id} has no help`);
    }
  });

  test("annotating twice does not double the controls", () => {
    const f = form();
    f.run("scAnnotate(); scAnnotate();");
    assert.equal(f.label("sc-qty").children.filter((c) => c.tagName === "DETAILS").length, 1);
  });

  test("a field that is not on the page is skipped rather than fatal", () => {
    // The Studio shares a page with two other modes; not every id is present
    // in every state of it.
    const f = form();
    f.run('document.getElementById=function(){return null;};');
    assert.doesNotThrow(() => f.run("scAnnotate();"));
  });

  test("it is reachable from markup by name", () => {
    assert.match(app, /scDontKnow: function \(id\) \{ scDontKnow\(id\); \}/);
    assert.match(fnSource("scRenderFieldStates", app), /data-do="scDontKnow"/);
  });

  test("the page annotates on arrival and keeps the states current as you type", () => {
    const bind = fnSource("scBind", app);
    assert.match(bind, /scAnnotate\(\)/);
    assert.match(bind, /addEventListener\("input"/);
    assert.match(bind, /SC_FIELD_HELP\[e\.target\.id\]/);
  });
});

/* ------------------------------------------------- standing on an assumption */

/**
 * Carrying on without an answer, deliberately.
 *
 * The brief allows an explicit assumption and forbids a silent one, and the
 * distance between those is entirely in what this refuses. An assumption
 * here is a value *and* a basis, chosen by a person, labelled everywhere it
 * surfaces, and still on the list of things to ask about. Nothing in the
 * product proposes one, and no code path writes `_scAssumed` except somebody
 * pressing the button.
 */
describe("carrying on with a stated assumption", () => {
  /** Run one of the assumption functions over a form. */
  const assuming = (opts) => {
    const f = form(opts);
    f.run("scAnnotate();");
    /* The three controls the assumption form declares in its own markup. */
    for (const id of ["scasm-sc-kerf", "scasmb-sc-kerf", "scasme-sc-kerf"]) f.stub(id);
    f.run([
      fnSource("scIsAssumed", app), fnSource("scAssumeOpen", app),
      fnSource("scAssumeApply", app), fnSource("scAssumeCancel", app),
      fnSource("scAssumeDrop", app), fnSource("scStatedAssumptions", app),
    ].join("\n"));
    return f;
  };

  test("a gap offers the assumption route without recommending it", () => {
    const f = assuming({ unknown: { "sc-kerf": true } });
    const html = f.gap("sc-kerf").innerHTML;
    assert.match(html, /Carry on with a stated assumption/);
    /* No value is suggested anywhere in the offer. */
    assert.doesNotMatch(html, /value="[0-9]/);
  });

  test("a value with no basis is refused, and says why", () => {
    const f = assuming({ unknown: { "sc-kerf": true } });
    f.run('scAssumeOpen("sc-kerf")');
    f.run('document.getElementById("scasm-sc-kerf").value="3"');
    f.run('document.getElementById("scasmb-sc-kerf").value=""');
    f.run('scAssumeApply("sc-kerf")');

    assert.equal(f.run("Object.keys(_scAssumed).length"), 0,
      "an assumption with no basis was recorded");
    assert.equal(f.run("_scUnknown['sc-kerf']"), true, "the field stopped being unknown anyway");
    assert.match(f.run('document.getElementById("scasme-sc-kerf").textContent'),
      /An assumption with no basis is a guess/);
  });

  test("a basis with no value is refused too", () => {
    const f = assuming({ unknown: { "sc-kerf": true } });
    f.run('scAssumeOpen("sc-kerf")');
    f.run('document.getElementById("scasm-sc-kerf").value=""');
    f.run('document.getElementById("scasmb-sc-kerf").value="a similar part"');
    f.run('scAssumeApply("sc-kerf")');
    assert.equal(f.run("Object.keys(_scAssumed).length"), 0);
  });

  test("both together are accepted, and the field reads Assumed", () => {
    const f = assuming({ unknown: { "sc-kerf": true } });
    f.run('scAssumeOpen("sc-kerf")');
    f.run('document.getElementById("scasm-sc-kerf").value="3"');
    f.run('document.getElementById("scasmb-sc-kerf").value="the laser on a similar part"');
    f.run('scAssumeApply("sc-kerf")');

    assert.equal(f.run('_scAssumed["sc-kerf"]'), "the laser on a similar part");
    assert.equal(f.run('_scSource["sc-kerf"]'), "assumption");
    assert.equal(f.run("Boolean(_scUnknown['sc-kerf'])"), false);
    assert.equal(f.input("sc-kerf").value, "3");
    assert.equal(f.input("sc-kerf").disabled, false, "the field is still editable");
    /* The vocabulary scenario.mjs owns, not a new word for it. */
    assert.equal(f.run('scFieldState("sc-kerf")'), "Assumed");
  });

  test("an assumed field keeps saying so, with its basis and who to ask", () => {
    const f = assuming({
      values: { "sc-kerf": "3" },
      assumed: { "sc-kerf": "the laser on a similar part" },
      source: { "sc-kerf": "assumption" },
    });
    f.run("scRenderFieldStates()");
    const html = f.gap("sc-kerf").innerHTML;
    assert.match(html, /Assumed, not answered/);
    assert.match(html, /the laser on a similar part/);
    assert.match(html, /Still worth asking/);
    assert.match(html, /Take the assumption back/);
  });

  test("taking it back returns the field to unanswered, not to a number", () => {
    const f = assuming({
      values: { "sc-kerf": "3" },
      assumed: { "sc-kerf": "a similar part" },
      source: { "sc-kerf": "assumption" },
    });
    f.run('scAssumeDrop("sc-kerf")');
    assert.equal(f.run("Object.keys(_scAssumed).length"), 0);
    assert.equal(f.input("sc-kerf").value, "", "the assumed number was left behind");
    assert.equal(f.run("_scUnknown['sc-kerf']"), true);
    assert.equal(f.run('scFieldState("sc-kerf")'), "Not known yet");
  });

  test("an assumption is reported with what it stands on", () => {
    const f = assuming({
      values: { "sc-kerf": "3" },
      assumed: { "sc-kerf": "a similar part" },
      source: { "sc-kerf": "assumption" },
    });
    const listed = f.run("JSON.stringify(scStatedAssumptions())");
    const rows = JSON.parse(listed);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, "3");
    assert.equal(rows[0].basis, "a similar part");
    assert.ok(rows[0].ask, "an assumption carries no question to settle it");
  });

  test("a value somebody simply typed is not an assumption", () => {
    /* The guard that keeps the label meaningful: _scAssumed and the source
       have to agree, so a stale entry in one cannot relabel a typed value. */
    const f = assuming({
      values: { "sc-kerf": "3" },
      assumed: { "sc-kerf": "left over from before" },
    });
    assert.equal(f.run('scIsAssumed("sc-kerf")'), false);
    assert.equal(f.run('scFieldState("sc-kerf")'), "User confirmed");
  });
});
