/**
 * Describing a change, on the page.
 *
 * Typing applies nothing. A sentence is read, validated, previewed through the
 * real geometry and shown as steps in plain words; accepting is a separate
 * click. This file drives that whole path through the page's own code.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { fnSource, markupOnly } from "../helpers/page.mjs";
import {
  block, addHole, addPocket, removeFeature, featureIds, volume,
  mass as geometryMass, history as geometryHistory, resize, editFeature,
} from "../../src/studio/geometry.mjs";
import {
  validate as validateProposal, preview as previewProposal,
  accept as acceptProposal,
} from "../../src/studio/edit-proposal.mjs";
import { readInstruction } from "../../src/studio/read-instruction.mjs";
import { proposeEdit } from "../../src/services/ai/propose-edit.mjs";
import { schedule, requirement, KIND, SCOPE } from "../../src/studio/requirements.mjs";
import { density } from "../../src/calc/units.mjs";

const app = readFileSync("app.js", "utf8");
const markup = markupOnly();
const page = markup.slice(markup.indexOf('id="sc-mode-material"'), markup.indexOf('id="sc-mode-cert"'));

/* ---------------------------------------------------------------- harness */

function studio({ reqs = [], bw = {} } = {}) {
  const els = new Map();
  const mk = (id) => ({ id, value: "", innerHTML: "", dataset: {}, setAttribute() {}, style: {} });
  for (const id of ["ai-text", "ai-out", "pb-out", "pb-status", "req-list",
    "pb-w", "pb-l", "pb-t", "sc-dv", "sc-du", "sc-ds"]) els.set(id, mk(id));

  const sandbox = {
    document: { getElementById: (id) => els.get(id) ?? null },
    console,
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    attrEsc: (x) => String(x).replace(/"/g, "&quot;"),
    scErr: (m) => `<err>${m}</err>`,
    window: {
      BW: {
        block, addHole, addPocket, removeFeature, featureIds, volume,
        geometryMass, geometryHistory, resize, editFeature,
        validateProposal, previewProposal, acceptProposal, readInstruction,
        reqSchedule: schedule, scDensity: density,
        /* Extra entries a test needs on window.BW — a provider reader and its
           transport, which this build does not configure. Set on the host
           object: assigning from inside the vm would reach the sandbox global
           rather than the host, which is why the first attempt silently kept
           using the written rules. */
        ...bw,
      },
    },
  };

  vm.createContext(sandbox);
  vm.runInContext([
    "var _scModel=null; var _scHistory=null; var _scPreview=null;",
    `var _scReqs=${JSON.stringify(reqs, (k, v) => (typeof v === "bigint" ? `__b${v}` : v))}
       .map(function(r){ return JSON.parse(JSON.stringify(r), function(k,v){
         return typeof v==="string"&&v.indexOf("__b")===0?BigInt(v.slice(3)):v; }); });`,
    fnSource("scVal", app), fnSource("scUm", app), fnSource("scBuilderStatus", app),
    fnSource("scAiStatus", app),
    /* The reader in front of scDescribeChange: a provider where one is
       configured, the written rules otherwise. This harness configures none,
       so the rules answer — which is the path this build always takes. */
    fnSource("scReadChange", app), fnSource("scDescribeChange", app),
    fnSource("scRenderPreview", app), fnSource("scAcceptChange", app),
    fnSource("scDiscardChange", app), fnSource("scFeatureIds", app),
    fnSource("scRenderBuilder", app), fnSource("scModelSvg", app),
    /* The builder draws the blank panel too. The transfer module is left
       out of the BW below, so this file also holds that the panel stays
       silent without it — `to-cost-wiring.test.mjs` exercises it. */
    fnSource("toCostRender", app), fnSource("toCostClear", app),
    "var _toCost=null; var _toCostTaken=null; var _toCostAllowances=Object.create(null);",
    fnSource("scMm3", app), fnSource("scG", app), fnSource("scRenderRequirements", app),
    /* The builder's own start, so a part exists to change. */
    fnSource("scSetBlock", app),
  ].join("\n"), sandbox);

  const s = {
    els,
    run: (code) => vm.runInContext(code, sandbox),
    /* Returns the promise: scDescribeChange asks a provider first where one
       is configured, so reading a sentence is asynchronous even when the
       answer comes from the written rules. */
    say: (text) => {
      els.get("ai-text").value = text;
      return vm.runInContext("scDescribeChange();", sandbox);
    },
    out: () => els.get("ai-out").innerHTML,
    ids: () => JSON.parse(vm.runInContext("JSON.stringify(scFeatureIds()||[])", sandbox)),
  };
  els.get("pb-w").value = "100"; els.get("pb-l").value = "50"; els.get("pb-t").value = "10";
  s.run("scSetBlock();");
  return s;
}

const onHole = (id) => requirement({
  kind: KIND.SURFACE_TEXTURE, parameter: "Ra", value: "1.6",
  scope: { type: SCOPE.FEATURE, featureId: id },
});

/* ------------------------------------------------- nothing happens by typing */

describe("describing a change applies nothing", () => {
  let s;
  beforeEach(() => { s = studio(); });

  test("a readable instruction shows what it would do, and says so", async () => {
    await s.say("add a 6mm hole at 15, 25");
    assert.match(s.out(), /This would:/);
    assert.match(s.out(), /Add a 6mm hole at 15, 25/);
    assert.match(s.out(), /Nothing has changed yet/);
    assert.deepEqual(s.ids(), [], "and nothing has");
  });

  test("it repeats what was asked, so the reading can be checked", async () => {
    await s.say("add a 6mm hole at 15, 25");
    assert.match(s.out(), /You asked: <b>add a 6mm hole at 15, 25<\/b>/);
  });

  test("accepting is a separate button", async () => {
    await s.say("add a 6mm hole at 15, 25");
    assert.match(s.out(), /data-do="scAcceptChange"/);
    assert.match(s.out(), /data-do="scDiscardChange"/);
  });

  test("and then it happens", async () => {
    await s.say("add a 6mm hole at 15, 25");
    s.run("scAcceptChange();");
    assert.deepEqual(s.ids(), ["hole-1"]);
    assert.match(s.out(), /Undo is in the builder above/);
  });

  test("leaving it changes nothing and clears the proposal", async () => {
    await s.say("add a 6mm hole at 15, 25");
    s.run("scDiscardChange();");
    assert.deepEqual(s.ids(), []);
    assert.match(s.out(), /Left as it was/);
    s.run("scAcceptChange();");
    assert.deepEqual(s.ids(), [], "accepting after discarding does nothing");
  });

  test("the box is emptied once the change is made", async () => {
    await s.say("add a 6mm hole at 15, 25");
    s.run("scAcceptChange();");
    assert.equal(s.els.get("ai-text").value, "");
  });
});

/* ------------------------------------------------------------- questions */

describe("when a sentence does not say enough", () => {
  let s;
  beforeEach(() => { s = studio(); });

  test("it asks, and shows what it can take", async () => {
    await s.say("make it better somehow");
    assert.match(s.out(), /design decision rather than a measurement/);
    assert.equal(/Make this change/.test(s.out()), false, "nothing to accept");
  });

  test("an unreadable sentence offers examples", async () => {
    await s.say("do the usual thing");
    assert.match(s.out(), /could not read that as a change/);
    assert.match(s.out(), /add a 6mm hole at 15, 25/);
  });

  test("an ambiguous target asks which one", async () => {
    await s.say("add a 6mm hole at 15, 25"); s.run("scAcceptChange();");
    await s.say("add a 6mm hole at 50, 25"); s.run("scAcceptChange();");
    await s.say("remove the hole");
    assert.match(s.out(), /There are 2 holes/);
    assert.deepEqual(s.ids(), ["hole-1", "hole-2"], "both are still there");
  });

  test("an impossible change is refused with the geometry's own reason", async () => {
    await s.say("add a 6mm hole at 900, 25");
    assert.match(s.out(), /falls outside the block/);
    assert.deepEqual(s.ids(), []);
  });

  test("with no part it says to build one first", async () => {
    const fresh = studio();
    fresh.run("_scModel=null;");
    await fresh.say("add a 6mm hole at 15, 25");
    assert.match(fresh.out(), /Build a block first/);
  });

  test('"make this aerospace grade" asks which specification applies', async () => {
    await s.say("make this aerospace grade");
    assert.match(s.out(), /question for your organisation/);
  });
});

/* --------------------------------------------------- what a change costs */

describe("the preview says what the change would cost", () => {
  test("removing a hole that carries a requirement warns before it happens", async () => {
    /* The whole chain working at once: geometry knows what the change
       removes, requirements know what pointed at it, and the preview says so
       while there is still a choice. */
    const s = studio({ reqs: [onHole("hole-1")] });
    await s.say("add a 6mm hole at 15, 25"); s.run("scAcceptChange();");
    await s.say("remove hole-1");
    assert.match(s.out(), /1 requirement\(s\) would be left pointing at nothing/);
    assert.match(s.out(), /because this removes hole-1/);
  });

  test("and a change that strands nothing says nothing about it", async () => {
    const s = studio({ reqs: [onHole("hole-1")] });
    await s.say("add a 6mm hole at 15, 25"); s.run("scAcceptChange();");
    await s.say("move hole-1 10mm along X");
    assert.equal(/pointing at nothing/.test(s.out()), false);
  });
});

/* ------------------------------------------------------------- staleness */

describe("a preview of a part that has since changed", () => {
  test("is refused at acceptance", async () => {
    const s = studio();
    await s.say("add a 6mm hole at 15, 25");
    /* Somebody uses the manual controls while the preview is on screen. */
    s.run("_scModel=_scHistory.push(window.BW.addHole(_scModel,{xUm:80000n,yUm:25000n,diameterUm:4000n}).model);");
    s.run("scAcceptChange();");
    assert.match(s.out(), /part changed after this was previewed/);
    assert.deepEqual(s.ids(), ["hole-1"], "the manual edit stands and the proposal did not land");
  });
});

/* -------------------------------------------------------------- the page */

describe("it is on the page", () => {
  test("the box sits under the manual controls, not above them", () => {
    // Typing is the shortcut; the buttons are what always works.
    const buttons = page.indexOf('data-do="scAddPocket"');
    const box = page.indexOf('id="ai-text"');
    assert.ok(buttons > 0 && box > buttons);
  });

  test("it says there is no service and no prompt", () => {
    assert.match(page, /Read by written rule, here in this browser/);
    assert.match(page, /there is no service and no\s*\n?\s*prompt/);
  });

  test("it promises to show before doing", () => {
    assert.match(page, /shows you the change before making it/);
    assert.match(page, /data-do="scDescribeChange">Show me what that would do</);
  });

  test("the result is announced", () => {
    assert.match(page, /id="ai-out" role="status" aria-live="polite"/);
  });

  test("every action is registered", () => {
    for (const name of ["scDescribeChange", "scAcceptChange", "scDiscardChange"]) {
      assert.match(app, new RegExp(`${name}: function`), `${name} is not registered`);
    }
  });

  test("the page's half cannot send anything either", () => {
    const fns = ["scDescribeChange", "scRenderPreview", "scAcceptChange"]
      .map((f) => fnSource(f, app)).join("\n");
    assert.equal(/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(fns), false);
  });
});

/* ------------------------------------------------- where a provider exists */

describe("a provider, when one is configured", () => {
  /** The harness, with a provider reader and a transport on window.BW. */
  const withProvider = (transport) => studio({
    bw: { proposeEdit, aiTransport: transport },
  });

  const replying = (obj) => () => JSON.stringify(obj);

  test("it is asked, and its proposal is previewed like any other", async () => {
    const s = withProvider(replying({ operations: [
      { op: "add-hole", xMm: "30", yMm: "20", diameterMm: "5" }] }));
    await s.say("put a small hole near the left");
    assert.match(s.out(), /Add a 5mm hole at 30, 20/);
    assert.deepEqual(s.ids(), [], "still nothing applied");
  });

  test("and accepting it goes through the same operations", async () => {
    /* The point of one validator: a provider's proposal and a typed one
       reach the geometry by the same path. */
    const s = withProvider(replying({ operations: [
      { op: "add-hole", xMm: "30", yMm: "20", diameterMm: "5" }] }));
    await s.say("put a small hole near the left");
    s.run("scAcceptChange();");
    assert.deepEqual(s.ids(), ["hole-1"]);
  });

  test("a question from the provider is shown, not worked around", async () => {
    const s = withProvider(replying({ question: "Which corner do you mean?" }));
    await s.say("put a hole near the corner");
    assert.match(s.out(), /Which corner do you mean\?/);
    assert.deepEqual(s.ids(), []);
  });

  test("an operation it invents is refused by name", async () => {
    const s = withProvider(replying({ operations: [{ op: "revolve", angle: "90" }] }));
    await s.say("spin it round");
    assert.match(s.out(), /not something this can do/);
  });

  test("a provider that fails does not fall back to guessing", async () => {
    /* It falls back to nothing. The written rules substitute for a provider
       that is absent, not for one that broke — a reader that reinterprets a
       request when the network fails is a reader that changes parts when the
       network does. */
    const s = withProvider(() => { throw new Error("down"); });
    await s.say("add a 6mm hole at 15, 25");
    assert.match(s.out(), /could not be reached/);
    assert.deepEqual(s.ids(), []);
  });

  test("the revision travels with it, so staleness is still caught", async () => {
    const s = withProvider(replying({ operations: [
      { op: "add-hole", xMm: "30", yMm: "20", diameterMm: "5" }] }));
    await s.say("add one");
    /* Somebody edits by hand while the proposal is on screen. */
    s.run("_scModel=_scHistory.push(window.BW.addHole(_scModel,"
      + "{xUm:80000n,yUm:25000n,diameterUm:4000n}).model);");
    s.run("scAcceptChange();");
    assert.match(s.out(), /part changed after this was previewed/);
  });
});

/* --------------------------------------------------------- no provider here */

describe("with no provider, which is this build", () => {
  test("the rules answer", async () => {
    const s = studio();
    await s.say("add a 6mm hole at 15, 25");
    assert.match(s.out(), /Add a 6mm hole at 15, 25/);
  });

  test("and a provider reader with no transport is not asked", async () => {
    let asked = false;
    const s = studio({ bw: { proposeEdit, aiTransport: undefined,
      __watch: () => { asked = true; } } });
    await s.say("add a 6mm hole at 15, 25");
    assert.equal(asked, false);
    assert.match(s.out(), /Add a 6mm hole at 15, 25/);
  });

  test("the page reads through one function either way", () => {
    /* Both readers return the same shape, so nothing after this point knows
       which answered. */
    const fn = fnSource("scReadChange", app);
    assert.match(fn, /B\.proposeEdit && B\.aiTransport/);
    assert.match(fn, /return B\.readInstruction\(text, revision\)/);
  });

  test("and the mount configures no transport", () => {
    const mount = readFileSync("mount.mjs", "utf8");
    assert.match(mount, /\bproposeEdit\b/, "the reader is exposed");
    assert.equal(/aiTransport\s*[:=]/.test(mount), false,
      "a transport configured here would send somebody's part to a provider "
      + "without their say");
  });
});
