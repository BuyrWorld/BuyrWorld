/**
 * The confirmed drawing dimensions, reaching the Part Builder.
 *
 * `specs/02`'s Phase 5 asks for confirmed dimensions to be connected to the
 * bounded editing, and the connection has one property worth a test: it fills
 * the boxes and stops. Building the block stays the thing a person does after
 * looking at the numbers, so a confirmation cannot quietly become a model.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { fnSource } from "../helpers/page.mjs";
import { blockFrom as blockFromDrawing, NEEDED } from "../../src/studio/from-drawing.mjs";
import {
  queue, confirm, confirmedValues, documentRef, METHOD,
} from "../../src/intake/review.mjs";
import { block, addHole, volume } from "../../src/studio/geometry.mjs";

const app = readFileSync("app.js", "utf8");

/** One `var name = function(...){...};` lifted out of the page, verbatim. */
function varSource(name, source) {
  const start = source.indexOf(`var ${name}=function(`);
  if (start < 0) throw new Error(`${name} is not assigned to a var in the page`);
  const end = source.indexOf("};", start);
  if (end < 0) throw new Error(`${name} does not end where this expects`);
  return source.slice(start, end + 2);
}

const candidate = (field, value, unit) => ({
  field, label: field, value, unit, page: 1, quote: `${value} ${unit}`,
});

const drawingQueue = () => queue(
  { candidates: [
    candidate("width", "100", "mm"),
    candidate("length", "60", "mm"),
    candidate("thickness", "10", "mm"),
  ] },
  { method: METHOD.RULE, document: documentRef({ filename: "SYN-001.pdf", revision: "B" }) });

function page({ withModule = true } = {}) {
  const els = new Map();
  for (const id of ["pb-w", "pb-l", "pb-t", "pb-status"]) {
    els.set(id, { id, value: "", innerHTML: "" });
  }

  const BW = { block, addHole, volume };
  if (withModule) Object.assign(BW, { blockFromDrawing, confirmedValues });

  const box = {
    document: { getElementById: (id) => els.get(id) ?? null },
    console,
    ciEsc: (x) => String(x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    window: { BW },
  };
  vm.createContext(box);
  vm.runInContext([
    "var _exReview={scx:null,ctx:null}; var _scModel=null;",
    /* scMm is assigned to a var rather than declared, so fnSource cannot lift
       it. Taken out of app.js by hand here rather than copied: a copy is a
       second implementation, and the one thing this test is about is that the
       page's own code runs. */
    varSource("scMm", app),
    fnSource("scVal", app), fnSource("defSet", app), fnSource("scBuilderStatus", app),
    fnSource("scFromDrawing", app),
  ].join("\n"), box);

  const run = (src) => vm.runInContext(src, box);
  return {
    box, els, run,
    reviewed: (items) => { box.__q = items; run("_exReview.scx=__q;"); },
    use: () => run("scFromDrawing();"),
    field: (id) => els.get(id).value,
    status: () => els.get("pb-status").innerHTML,
  };
}

let v;
beforeEach(() => { v = page(); });

describe("using the confirmed values", () => {
  test("fills the three boxes", () => {
    v.reviewed(drawingQueue().map((i) => confirm(i, "a buyer")));
    v.use();
    assert.equal(v.field("pb-w"), "100");
    assert.equal(v.field("pb-l"), "60");
    assert.equal(v.field("pb-t"), "10");
  });

  test("and builds nothing — that is still a person's act", () => {
    v.reviewed(drawingQueue().map((i) => confirm(i, "a buyer")));
    v.use();
    assert.equal(v.run("_scModel === null"), true);
    assert.match(v.status(), /Nothing is built yet/);
  });

  test("it says where each number came from", () => {
    v.reviewed(drawingQueue().map((i) => confirm(i, "a buyer")));
    v.use();
    for (const said of Object.values(NEEDED)) {
      assert.ok(v.status().includes(said), `${said} is not accounted for`);
    }
    assert.match(v.status(), /read and confirmed/);
  });
});

describe("what it will not do", () => {
  test("a queue nobody has confirmed fills nothing, and says why", () => {
    v.reviewed(drawingQueue());
    v.use();
    assert.equal(v.field("pb-w"), "");
    assert.match(v.status(), /is not zero/);
    assert.match(v.status(), /Nothing confirmed gives the width/);
  });

  test("no drawing at all is a sentence, not a crash", () => {
    v.use();
    assert.equal(v.field("pb-w"), "");
    assert.match(v.status(), /A block needs all three/);
  });

  test("and the module missing says the engine did not load", () => {
    const bare = page({ withModule: false });
    bare.use();
    assert.match(bare.status(), /engine did not load/);
  });
});
