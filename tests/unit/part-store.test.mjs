import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { pageSource } from "../helpers/page.mjs";
import {
  part, savePart, loadPart, loadParts, deletePart, clearParts,
  storeStatus, exportParts, importParts, forComparison,
  SCHEMA_VERSION, STORAGE_KEY,
} from "../../src/services/part-store.mjs";
import { serialise } from "../../src/services/outcome-store.mjs";
import { findComparable, priceGap, ATTRIBUTES } from "../../src/calc/comparable.mjs";
import { moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";
import { readFileSync } from "node:fs";

const gbp = (x) => moneyFromDecimal(x, "GBP");

const FULL = {
  material: "AL 6082", specification: "BS EN 573", process: "CNC milling", rawForm: "bar",
  tolerance: "IT9", heatTreatment: "T6", inspection: "AQL 2.5", certification: "3.1",
  sizeBand: "small", volumeBand: "50k", surfaceFinish: "anodised", geography: "UK",
};

function makeStore({ blocked = false, full = false } = {}) {
  const m = new Map();
  return {
    getItem: (k) => { if (blocked) throw new Error("SecurityError"); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => {
      if (blocked) throw new Error("SecurityError: denied");
      if (full) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
      m.set(k, String(v));
    },
    removeItem: (k) => { if (blocked) throw new Error("SecurityError"); m.delete(k); },
    _set: (v) => m.set(STORAGE_KEY, v),
  };
}

let s;
beforeEach(() => { s = makeStore(); });

const aPart = (over = {}) => part({
  supplier: "Meridian Fabrication Ltd", number: "BRK-A-102",
  attributes: FULL, unitPrice: gbp("12.40"), annualVolume: 50_000, ...over,
});

describe("storing a part", () => {
  test("it round-trips, price included", () => {
    const p = aPart();
    assert.equal(savePart(p, s).ok, true);
    const back = loadPart(p.id, s);
    assert.equal(back.number, "BRK-A-102");
    assert.equal(str(back.unitPrice), "12.40");
    assert.equal(typeof back.unitPrice.minor, "bigint", "a float price would defeat the engine");
  });

  test("the comparison attributes survive", () => {
    const p = aPart();
    savePart(p, s);
    assert.equal(Object.keys(loadPart(p.id, s).attributes).length, ATTRIBUTES.length);
  });

  test("saving the same part twice updates rather than duplicating", () => {
    // The id derives from supplier and number, so a near-duplicate would end up
    // being compared against itself.
    savePart(aPart(), s);
    savePart(aPart({ unitPrice: gbp("13.00") }), s);
    assert.equal(loadParts(s).length, 1);
    assert.equal(str(loadParts(s)[0].unitPrice), "13.00");
  });

  test("the same number from two suppliers is two parts", () => {
    savePart(aPart(), s);
    savePart(aPart({ supplier: "Northgate Precision" }), s);
    assert.equal(loadParts(s).length, 2);
  });

  test("an attribute outside the model is refused at construction", () => {
    assert.throws(() => aPart({ attributes: { colour: "blue" } }), /not a comparison attribute/);
  });

  test("a float price is refused", () => {
    assert.throws(() => aPart({ unitPrice: 12.4 }), /must be Money/);
  });

  test("something that is not a part is refused", () => {
    assert.match(savePart({}, s).error, /not a part/);
  });
});

describe("the version gate", () => {
  test("a part from another schema is withheld, not misread", () => {
    // Attributes meaning something different in another build would produce a
    // confident comparison of two things that are not alike.
    const ok = aPart();
    s._set(serialise([{ ...ok, schema: 99 }, { ...ok, id: "part_other000000", schema: SCHEMA_VERSION }]));
    assert.equal(loadParts(s).length, 1);
    assert.equal(storeStatus(s).unreadable, 1);
  });

  test("saving does not drop what this build cannot read", () => {
    s._set(serialise([{ ...aPart(), id: "part_future00000", schema: 99 }]));
    savePart(aPart(), s);
    assert.equal(storeStatus(s).total, 2);
  });

  test("junk in the store is survived", () => {
    s._set("not json");
    assert.deepEqual(loadParts(s), []);
    assert.equal(savePart(aPart(), s).ok, true);
  });
});

describe("the store says how usable the library is", () => {
  test("a library of names is reported as undescribed", () => {
    // A part with no attributes compares with nothing, and saying so is more
    // use than an empty result later.
    savePart(part({ supplier: "X", number: "A" }), s);
    savePart(part({ supplier: "X", number: "B" }), s);
    const st = storeStatus(s);
    assert.equal(st.readable, 2);
    assert.equal(st.described, 0);
    assert.equal(st.priced, 0);
  });

  test("described and priced are counted separately", () => {
    savePart(aPart(), s);
    savePart(part({ supplier: "X", number: "B", attributes: FULL }), s);
    const st = storeStatus(s);
    assert.equal(st.described, 2);
    assert.equal(st.priced, 1, "a described part without a price cannot answer a price question");
  });
});

describe("storage that refuses", () => {
  test("a blocked store is reported, not swallowed", () => {
    const blocked = makeStore({ blocked: true });
    assert.match(savePart(aPart(), blocked).error, /blocking local storage/);
    assert.deepEqual(loadParts(blocked), []);
  });

  test("a full store says what to do", () => {
    assert.match(savePart(aPart(), makeStore({ full: true })).error, /full\. Export or delete/);
  });
});

describe("deleting and clearing", () => {
  test("one goes, the rest stay", () => {
    const a = aPart();
    savePart(a, s);
    savePart(aPart({ number: "BRK-B-220" }), s);
    assert.equal(deletePart(a.id, s).ok, true);
    assert.equal(loadParts(s).length, 1);
  });

  test("deleting nothing is reported", () => {
    assert.match(deletePart("nope", s).error, /No part with that id/);
  });

  test("clearing removes everything", () => {
    savePart(aPart(), s);
    clearParts(s);
    assert.deepEqual(loadParts(s), []);
  });
});

describe("portability", () => {
  test("an export round-trips with its price intact", () => {
    savePart(aPart(), s);
    const fresh = makeStore();
    assert.equal(importParts(exportParts(s), fresh).imported, 1);
    assert.equal(str(loadParts(fresh)[0].unitPrice), "12.40");
  });

  test("importing appends and skips what is already there", () => {
    savePart(aPart(), s);
    const r = importParts(exportParts(s), s);
    assert.equal(r.imported, 0);
    assert.equal(r.skipped, 1);
  });

  test("another schema is refused with the reason", () => {
    const text = serialise({ format: "buyrworld.parts.v1", schema: 99, parts: [] });
    assert.match(importParts(text, s).error, /schema 99; this build reads 1/);
  });

  test("a file that is not a parts export is refused", () => {
    assert.match(importParts("{}", s).error, /not a BuyrWorld parts export/);
    assert.match(importParts("<<<", s).error, /not a readable parts export/);
  });
});

describe("the seam to the comparison engine", () => {
  test("a stored part reads straight into findComparable", () => {
    savePart(aPart(), s);
    savePart(aPart({ supplier: "Northgate Precision", number: "BRK-B-220",
                     attributes: { ...FULL, tolerance: "IT11", surfaceFinish: "mill" },
                     unitPrice: gbp("9.80") }), s);

    const parts = loadParts(s).map(forComparison);
    const r = findComparable(parts.find((p) => p.ref === "BRK-A-102"), parts);
    assert.equal(r.best.b, "BRK-B-220");
    assert.match(r.best.statement, /Differs on tolerance class, surface finish/);
  });

  test("and into the price gap, with the volume carried through", () => {
    savePart(aPart(), s);
    savePart(aPart({ supplier: "Northgate Precision", number: "BRK-B-220",
                     attributes: FULL, unitPrice: gbp("9.80") }), s);
    const parts = loadParts(s).map(forComparison);
    const g = priceGap(parts.find((p) => p.ref === "BRK-A-102"), parts.find((p) => p.ref === "BRK-B-220"));
    assert.equal(str(g.gap), "2.60");
    assert.equal(str(g.unexplainedAnnual), "130000.00");
  });

  test("the two shapes stay distinct on purpose", () => {
    // A domain part is identified within its supplier; a comparison is about
    // the thing itself. One module understanding both would blur that.
    const p = aPart();
    const c = forComparison(p);
    assert.equal(c.ref, p.number);
    assert.equal(c.supplier, p.supplierId);
    assert.equal(c.id, undefined);
  });
});

describe("the parts page is wired", () => {
  const html = pageSource();

  test("the route, nav entry and icon all exist", () => {
    assert.match(html, /<div class="page" id="page-parts">/);
    assert.match(html, /\["parts","Parts"\]/);
    assert.match(html, /\n  parts:'<path/);
    /* The arrival table in go(), not the chain of ifs this used to read.
       What is being checked has not changed — opening this screen binds it —
       but the mechanism did. tests/integration/route-guard.test.mjs owns the
       table itself; this only asserts that parts is in it. */
    const at = html.indexOf('ON_ARRIVAL["parts"]');
    assert.notEqual(at, -1, "parts has no arrival entry in go()");
    const arrival = html.slice(at, at + 400);
    assert.match(arrival, /ptBind\(\)/,
      "opening parts no longer calls ptBind");
  });

  test("the engine and store are mounted", () => {
    const mount = (html.match(/window\.BW\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
    for (const name of ["findComparable", "priceGap", "makePart", "savePart", "loadParts", "forComparison"]) {
      assert.match(mount, new RegExp(name), `${name} is not exposed`);
    }
  });

  test("attribute fields are generated from the engine's vocabulary", () => {
    // Typing twelve labels into the markup is how the page and the model drift.
    assert.match(html, /window\.BW\.ATTRIBUTES\.map/);
    assert.match(html, /id="pt-a-'\+attrEsc\(a\.id\)\+'"/);
    assert.match(html, /aria-label="'\+attrEsc\(a\.label\)\+'"/);
  });

  test("the price is parsed exactly, never through a float", () => {
    const fn = html.slice(html.indexOf("function ptSave()"), html.indexOf("function ptLibraryHTML()"));
    assert.match(fn, /window\.BW\.parseAmount/);
    // Both comment forms are stripped first. A comment explaining why parseFloat
    // is gone is not parseFloat, and scanning raw text fails on its own reason —
    // which is exactly what happened here, and in the shock simulator before it.
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.equal(/parseFloat|toFixed/.test(code), false,
      "a price typed as 12.405 would round through a float before reaching Money");
  });

  test("the page computes nothing itself", () => {
    const fn = html.slice(html.indexOf("function ptCompare(id)"), html.indexOf("function renderParts()"));
    assert.ok(fn.length > 500);
    assert.equal(/\*\s*100|\/\s*100|toFixed/.test(fn), false);
    assert.match(fn, /window\.BW\.findComparable/);
    assert.match(fn, /window\.BW\.priceGap/);
  });

  test("it adds no inline handlers", () => {
    const page = html.slice(html.indexOf('id="page-parts"'), html.indexOf("<!-- ============ WORKSPACE"));
    assert.equal(/\son(click|change|input)=/.test(page), false);
    assert.match(page, /data-pt-act="save"/);
  });

  test("an empty library says what the smallest useful one is", () => {
    assert.match(html, /Two described parts is the smallest library that can answer anything/);
  });

  test("the page says an unrecorded attribute never counts as a match", () => {
    assert.match(html, /never counts as a match/);
  });
});
