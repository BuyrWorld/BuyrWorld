/**
 * The lot store.
 *
 * The unique-lot rule is arithmetic in mill.mjs and a property of the data
 * here: records are keyed by lot, so there is nowhere for a second copy of a
 * lot to go. That is the difference between a rule you have to remember and
 * one you cannot break.
 *
 * The other thing tested here is the schema gate. A record written by another
 * build is withheld and reported — never dropped, and never interpreted. A
 * conformity rate computed over records this build only half understands
 * would be worse than no rate at all.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  SCHEMA_VERSION, MAX_LOT_BYTES,
  loadLots, saveLot, deleteLot, clearLots, storeStatus, storageAvailable,
  exportLots, importLots,
} from "../../src/services/lot-store.mjs";
import { lotRecord, DECISION, SCOPE } from "../../src/calc/mill.mjs";

/** A localStorage stand-in, with the failure modes a real one has. */
function fakeStore({ failWrites = false, throwOnAccess = false } = {}) {
  const m = new Map();
  return {
    getItem(k) { if (throwOnAccess) throw new Error("blocked"); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) {
      if (throwOnAccess) throw new Error("blocked");
      if (failWrites && k !== "bw.probe") { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }
      m.set(k, String(v));
    },
    removeItem(k) { m.delete(k); },
    _raw: m,
  };
}

const lot = (over = {}) => lotRecord({
  lotKey: "northgate|h-77213|l-4",
  producer: "Northgate Steelworks (synthetic)",
  grade: "FG-300", form: "plate",
  specification: "SYN-SPEC-100", specificationRevision: "C",
  decision: DECISION.CONFORMING, scope: SCOPE.FULL,
  firstSubmissionComplete: true, reviewedAt: "2026-06-01",
  certificate: "SYN-CERT-0001",
  ...over,
});

let store;
beforeEach(() => { store = fakeStore(); });

describe("saving and reading back", () => {
  test("a saved lot comes back", () => {
    assert.equal(saveLot(lot(), store).ok, true);
    const back = loadLots(store);
    assert.equal(back.length, 1);
    assert.equal(back[0].lotKey, "northgate|h-77213|l-4");
    assert.equal(back[0].schema, SCHEMA_VERSION);
  });

  test("a record with no lot key is refused", () => {
    const r = saveLot({ producer: "x" }, store);
    assert.equal(r.ok, false);
    assert.match(r.error, /needs a lot key/);
  });

  test("an empty store is empty, not an error", () => {
    assert.deepEqual(loadLots(store), []);
  });

  test("a write that storage refuses is reported rather than swallowed", () => {
    const r = saveLot(lot(), fakeStore({ failWrites: true }));
    assert.equal(r.ok, false);
    assert.match(r.error, /QuotaExceededError/);
  });

  test("a browser that blocks site data is handled without throwing", () => {
    const blocked = fakeStore({ throwOnAccess: true });
    assert.deepEqual(loadLots(blocked), []);
    assert.equal(storageAvailable(blocked), false);
  });
});

describe("one lot has one record", () => {
  test("saving the same lot again corrects it rather than adding one", () => {
    saveLot(lot({ decision: DECISION.PENDING }), store);
    const second = saveLot(lot({ decision: DECISION.CONFORMING, certificate: "SYN-CERT-0002" }), store);
    assert.equal(second.ok, true);
    assert.equal(second.replaced, true);
    assert.equal(loadLots(store).length, 1);
    assert.equal(loadLots(store)[0].decision, DECISION.CONFORMING);
  });

  test("the previous record comes back, because a change of decision matters", () => {
    saveLot(lot({ decision: DECISION.CONFORMING }), store);
    const second = saveLot(lot({
      decision: DECISION.NONCONFORMING,
      nonconformities: [{ category: "chemistry out of limit" }],
    }), store);
    assert.equal(second.previous.decision, DECISION.CONFORMING);
    assert.match(second.note, /corrected rather than a second lot added/);
  });

  test("a different lot is a different record", () => {
    saveLot(lot({ lotKey: "northgate|h-1|l-1" }), store);
    saveLot(lot({ lotKey: "northgate|h-2|l-1" }), store);
    assert.equal(loadLots(store).length, 2);
  });

  test("deleting removes one record and says when there was none", () => {
    saveLot(lot(), store);
    assert.equal(deleteLot("northgate|h-77213|l-4", store).ok, true);
    assert.equal(loadLots(store).length, 0);
    assert.equal(deleteLot("nothing", store).ok, false);
  });

  test("clearing empties the store", () => {
    saveLot(lot(), store);
    clearLots(store);
    assert.equal(loadLots(store).length, 0);
  });
});

describe("the schema gate withholds rather than misreads", () => {
  test("a record from another build is reported, not returned", () => {
    store._raw.set("bw.lots.v1", JSON.stringify([
      { ...lot(), schema: SCHEMA_VERSION },
      { lotKey: "future|h-1|l-1", schema: 99 },
    ]));
    assert.equal(loadLots(store).length, 1);
    const status = storeStatus(store);
    assert.equal(status.total, 2);
    assert.equal(status.readable, 1);
    assert.equal(status.unreadable, 1);
    assert.match(status.unreadableReasons[0], /saved by schema 99; this build reads 1/);
  });

  test("an entry that is not a record at all is described as such", () => {
    store._raw.set("bw.lots.v1", JSON.stringify(["not a record", null, 7]));
    const status = storeStatus(store);
    assert.equal(status.unreadable, 3);
    assert.match(status.unreadableReasons[0], /not a lot record/);
  });

  test("corrupt storage does not read as an empty store", () => {
    store._raw.set("bw.lots.v1", "{ not json");
    assert.deepEqual(loadLots(store), []);
    assert.equal(storeStatus(store).total, 0);
  });

  test("an oversized record is refused with its size", () => {
    const huge = lot({ certificate: "x".repeat(MAX_LOT_BYTES) });
    const r = saveLot(huge, store);
    assert.equal(r.ok, false);
    assert.match(r.error, /over the 32KB limit/);
  });
});

describe("export and import", () => {
  test("an export carries its kind, schema and records", () => {
    saveLot(lot(), store);
    const parsed = JSON.parse(exportLots(store));
    assert.equal(parsed.kind, "buyrworld.lots");
    assert.equal(parsed.schema, SCHEMA_VERSION);
    assert.equal(parsed.records.length, 1);
    assert.match(parsed.note, /Private supplier-quality records/);
  });

  test("importing the same file twice does not double anybody's lot count", () => {
    saveLot(lot(), store);
    const file = exportLots(store);
    const fresh = fakeStore();
    assert.equal(importLots(file, fresh).added, 1);
    const again = importLots(file, fresh);
    assert.equal(again.added, 0);
    assert.equal(again.corrected, 1);
    assert.equal(loadLots(fresh).length, 1);
  });

  test("a file from another schema imports nothing at all", () => {
    const foreign = JSON.stringify({ kind: "buyrworld.lots", schema: 99, records: [lot()] });
    const r = importLots(foreign, store);
    assert.equal(r.ok, false);
    assert.match(r.error, /Nothing was imported/);
    assert.equal(loadLots(store).length, 0);
  });

  test("a file that is not an export is refused", () => {
    assert.match(importLots("{}", store).error, /not an export of lot records/);
    assert.match(importLots("nonsense", store).error, /not a file this can read/);
  });

  test("replace clears what was there first", () => {
    saveLot(lot({ lotKey: "old|h-1|l-1" }), store);
    const file = JSON.stringify({
      kind: "buyrworld.lots", schema: SCHEMA_VERSION,
      records: [{ ...lot({ lotKey: "new|h-1|l-1" }), schema: SCHEMA_VERSION }],
    });
    importLots(file, store, { replace: true });
    assert.equal(loadLots(store).length, 1);
    assert.equal(loadLots(store)[0].lotKey, "new|h-1|l-1");
  });
});
