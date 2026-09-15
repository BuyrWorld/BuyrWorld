/**
 * Provenance reaching the engine.
 *
 * `assertUsable()` refuses to calculate with an unconfirmed ai-inferred value,
 * and three documents describe that as the backstop behind the interface. It
 * could never fire: the page stamped every driver `user-entered` on the way
 * in, whatever the value actually was, so the engine was never handed anything
 * to catch.
 *
 * The interface gate was, and still is, real — "Use these values" is disabled
 * until every extracted field is confirmed. What was missing was the second
 * layer, and these tests are about the second layer: that what a model
 * proposed arrives at the engine saying so, and that editing it makes it the
 * person's again.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { pageSource, fnSource } from "../helpers/page.mjs";

const app = readFileSync("app.js", "utf8");
const html = pageSource();

/** An extraction result, as the claim extractor produces one. */
const field = (value, confirmed) => ({
  value, quote: `…${value}…`, provenance: "ai-inferred",
  confirmedBy: confirmed ? { by: "category owner", at: "2026-09-15" } : null,
});

const extraction = ({ weightConfirmed = true, movementConfirmed = true, second = false } = {}) => ({
  fields: {},
  drivers: [
    {
      label: field("Material", true),
      weightPercent: field("60", weightConfirmed),
      movementPercent: field("8", movementConfirmed),
    },
    ...(second ? [{
      label: field("Energy", true),
      weightPercent: field("20", true),
      movementPercent: field("30", true),
    }] : []),
  ],
});

/** Run the page's own row bookkeeping over a stub form. */
function page({ extract = null } = {}) {
  const elements = new Map();
  const sandbox = {
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { id, innerHTML: "", value: "" });
        return elements.get(id);
      },
    },
    window: { BW: { pc: (x) => BigInt(Math.round(Number(x) * 10_000_000)) } },
    console,
    _defExtract: extract,
    DEF_DEFAULT_DRIVERS: [["Material", "60", "8", "direct", "", "", "", ""]],
    defRenderDrivers() {},
    defCalc() {},
    defSet() {},
  };
  const src = [
    app.slice(app.indexOf("let _defRows=DEF_DEFAULT_DRIVERS"), app.indexOf("function defRowEdited(i)")),
    fnSource("defRowEdited", app),
    fnSource("defAddDriver", app),
    fnSource("defRemoveDriver", app),
    fnSource("defRowSet", app),
    fnSource("defApplyExtract", app),
  ].join("\n");
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

const run = (s, code) => vm.runInContext(code, s);

/* _defRows and _defRowSource are `let` bindings: lexical, not properties of
   the global object, so they are read through the context rather than off the
   sandbox. Getting this wrong reads undefined and passes nothing. */
const rows = (s) => run(s, "_defRows");
const sources = (s) => run(s, "JSON.parse(JSON.stringify(_defRowSource))");

/* An object built inside the vm has that realm's prototype, so a strict
   deepEqual against a plain literal fails on the prototype rather than on the
   content. Round-tripping compares what is actually being asserted. */
const from = (s, i) => JSON.parse(run(s, `JSON.stringify(defRowFrom(${i}))`));

/* ------------------------------------------------- what an extraction hands over */

describe("a model's proposal arrives saying so", () => {
  test("applying an extraction marks every row ai-inferred", () => {
    const s = page({ extract: extraction() });
    run(s, "defApplyExtract();");
    assert.equal(sources(s).length, 1);
    assert.equal(sources(s)[0].provenance, "ai-inferred");
  });

  test("a fully confirmed extraction carries the confirmation through", () => {
    const s = page({ extract: extraction() });
    run(s, "defApplyExtract();");
    assert.equal(sources(s)[0].confirmedBy.by, "category owner");
  });

  test("a driver is only as confirmed as its least confirmed number", () => {
    // The weight was ticked and the movement was not. One unchecked figure
    // makes the whole driver unusable, because both go into the same product.
    const s = page({ extract: extraction({ movementConfirmed: false }) });
    run(s, "defApplyExtract();");
    assert.equal(sources(s)[0].provenance, "ai-inferred");
    assert.equal(sources(s)[0].confirmedBy, null);
  });

  test("each driver is judged on its own fields", () => {
    const e = extraction({ second: true });
    e.drivers[1].weightPercent = field("20", false);
    const s = page({ extract: e });
    run(s, "defApplyExtract();");
    assert.ok(sources(s)[0].confirmedBy, "the first driver was fully confirmed");
    assert.equal(sources(s)[1].confirmedBy, null, "the second was not");
  });

  test("a driver with only one figure is confirmed on that one", () => {
    const e = extraction();
    delete e.drivers[0].movementPercent;
    const s = page({ extract: e });
    run(s, "defApplyExtract();");
    assert.ok(e.drivers[0].weightPercent.confirmedBy);
    assert.ok(sources(s)[0].confirmedBy, "the figure that exists was confirmed");
  });
});

/* -------------------------------------------------------- editing takes it back */

describe("editing a value makes it the person's", () => {
  test("a typed change drops the model's claim on the row", () => {
    const s = page({ extract: extraction() });
    run(s, "defApplyExtract();");
    assert.equal(sources(s)[0].provenance, "ai-inferred");
    run(s, "defRowSet.call({value:'75'}, 0, 1);");
    assert.equal(sources(s)[0], null);
    assert.equal(rows(s)[0][1], "75");
  });

  test("the row reverts to user-entered, not to nothing", () => {
    const s = page({ extract: extraction() });
    run(s, "defApplyExtract(); defRowSet.call({value:'75'}, 0, 1);");
    assert.deepEqual(from(s, 0), { provenance: "user-entered", confirmedBy: null });
  });

  test("editing one row leaves the others alone", () => {
    const s = page({ extract: extraction({ second: true }) });
    run(s, "defApplyExtract(); defRowSet.call({value:'75'}, 0, 1);");
    assert.equal(sources(s)[0], null);
    assert.equal(sources(s)[1].provenance, "ai-inferred");
  });
});

/* ----------------------------------------------------- the arrays stay in step */

describe("the two arrays stay aligned", () => {
  test("adding a driver adds a source", () => {
    const s = page({ extract: extraction() });
    run(s, "defApplyExtract(); defAddDriver();");
    assert.equal(rows(s).length, sources(s).length);
    assert.equal(sources(s)[1], null, "a driver somebody added is theirs");
  });

  test("removing a driver removes its source, not somebody else's", () => {
    const s = page({ extract: extraction({ second: true }) });
    run(s, "defApplyExtract();");
    run(s, "_defRowSource[0]=null;");                    // the first was edited
    run(s, "defRemoveDriver(0);");
    assert.equal(rows(s).length, 1);
    assert.equal(sources(s).length, 1);
    assert.equal(sources(s)[0].provenance, "ai-inferred",
      "the surviving row kept its own provenance rather than the deleted row's");
  });

  test("a row with no entry reads as typed by a person", () => {
    const s = page();
    assert.deepEqual(from(s, 0), { provenance: "user-entered", confirmedBy: null });
    assert.deepEqual(from(s, 99), { provenance: "user-entered", confirmedBy: null });
  });
});

/* -------------------------------------------------------------- and onwards */

describe("the engine is given what the row carries", () => {
  test("defCalc reads the row's provenance rather than a constant", () => {
    const fn = fnSource("defCalc", app);
    assert.match(fn, /var from=defRowFrom\(i\)/);
    assert.match(fn, /provenance:from\.provenance/);
    assert.match(fn, /confirmedBy:from\.confirmedBy/);
    assert.equal(/provenance:"user-entered"/.test(fn), false,
      "a hardcoded provenance is what made the guard unable to fire");
  });

  test("a worked example and a restored case are nobody's proposal", () => {
    assert.match(fnSource("defLoadExample", app), /_defRowSource=\[\]/);
    assert.match(fnSource("defRestore", app), /_defRowSource=\[\]/);
  });

  test("the interface gate is still there, because this is the second layer", () => {
    // Removing the first layer would be a worse product, not a safer one.
    assert.match(html, /disabled title="Confirm every field first"/);
  });
});
