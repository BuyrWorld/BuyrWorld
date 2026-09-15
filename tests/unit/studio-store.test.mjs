/**
 * Saving unfinished work.
 *
 * The pack requires a manual, incomplete scenario to save and reopen without
 * losing inputs or provenance and without a document id. A draft is the
 * normal case here, not a degraded one, so most of this file is about what
 * survives the round trip when the work is not done.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  SCHEMA_VERSION, MAX_SCENARIO_BYTES, newId,
  loadScenarios, loadScenario, saveScenario, deleteScenario, clearScenarios,
  storeStatus, storageAvailable,
} from "../../src/services/studio-store.mjs";
import {
  scenario, withField, ENTRY, GOAL, SOURCE, stateOf, STATE,
} from "../../src/studio/scenario.mjs";

/** A localStorage stand-in that can also be told to fail. */
function memory({ failWrites = false } = {}) {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failWrites && k !== "bw.probe") {
        const e = new Error("quota"); e.name = "QuotaExceededError"; throw e;
      }
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    _raw: () => map.get("bw.studio.v1"),
    _put: (v) => map.set("bw.studio.v1", typeof v === "string" ? v : JSON.stringify(v)),
  };
}

let store;
beforeEach(() => { store = memory(); });

/** A part-finished manual scenario: some values, one unknown, no document. */
function draft(id = "SCN-1") {
  let s = scenario({ id, name: "Mounting bracket", entry: ENTRY.MANUAL, goal: GOAL.QUANTITY });
  s = withField(s, "partName", { value: "Mounting bracket" });
  s = withField(s, "goodParts", { value: "100" });
  s = withField(s, "blankWidth", { value: "100", unit: "mm" });
  s = withField(s, "passRate", { unknown: true });
  s = withField(s, "kerf", { value: "3", unit: "mm", source: SOURCE.ASSUMPTION });
  return s;
}

/* ---------------------------------------------------------- the round trip */

describe("an unfinished manual scenario", () => {
  test("saves, with no document and no complete result", () => {
    const r = saveScenario(draft(), store);
    assert.equal(r.ok, true);
    assert.equal(r.replaced, false);
  });

  test("reopens with every value it had", () => {
    saveScenario(draft(), store);
    const back = loadScenario("SCN-1", store);
    assert.equal(back.fields.partName.value, "Mounting bracket");
    assert.equal(back.fields.goodParts.value, "100");
    assert.equal(back.fields.blankWidth.value, "100");
    assert.equal(back.fields.blankWidth.unit, "mm");
  });

  test("and with the provenance of each one", () => {
    saveScenario(draft(), store);
    const back = loadScenario("SCN-1", store);
    assert.equal(stateOf(back.fields.kerf), STATE.ASSUMED, "an assumption is still an assumption");
    assert.equal(stateOf(back.fields.partName), STATE.CONFIRMED);
    assert.equal(stateOf(back.fields.stockWidth), STATE.MISSING);
  });

  test("an 'I don't know' survives as itself, not as a blank", () => {
    // These are different answers and the distinction has to cross storage.
    saveScenario(draft(), store);
    const back = loadScenario("SCN-1", store);
    assert.equal(back.fields.passRate.unknown, true);
    assert.equal(stateOf(back.fields.passRate), STATE.UNKNOWN);
    assert.notEqual(stateOf(back.fields.passRate), stateOf(back.fields.stockWidth));
  });

  test("no document id is invented on the way in or out", () => {
    saveScenario(draft(), store);
    assert.equal(loadScenario("SCN-1", store).document, null);
    assert.equal(/documentId|drawingNumber/.test(store._raw()), false);
  });

  test("nothing is stored until something has been entered", () => {
    const r = saveScenario(scenario({ id: "SCN-empty" }), store);
    assert.equal(r.ok, false);
    assert.match(r.error, /nothing to save/);
    assert.equal(loadScenarios(store).length, 0);
  });
});

/* ----------------------------------------------------------- what is stored */

describe("what the record does and does not carry", () => {
  test("no calculated result is stored", () => {
    // A reopened scenario must never show a total its own inputs no longer
    // support, so results are recomputed rather than remembered.
    saveScenario(draft(), store);
    const raw = store._raw();
    assert.equal(/"total"|"unitCost"|"perSheet"|"blanksRequired"/.test(raw), false);
  });

  test("a summary is stored for the list, and is not trusted on open", () => {
    saveScenario(draft(), store);
    const parsed = JSON.parse(store._raw())[0];
    assert.equal(parsed.summary.quantityReady, false);
    assert.equal(parsed.summary.unknowns, 1);

    // Corrupt the summary; the reopened scenario is unaffected because
    // readiness comes from the fields.
    parsed.summary.quantityReady = true;
    store._put([parsed]);
    const back = loadScenario("SCN-1", store);
    assert.equal(back.fields.passRate.unknown, true, "the fields are what matter");
  });

  test("the schema version is stamped", () => {
    saveScenario(draft(), store);
    assert.equal(JSON.parse(store._raw())[0].schema, SCHEMA_VERSION);
  });
});

/* ------------------------------------------------------------- overwriting */

describe("saving over existing work", () => {
  test("a later revision replaces an earlier one", () => {
    saveScenario(draft(), store);
    const next = withField(draft(), "stockWidth", { value: "1000", unit: "mm" });
    const r = saveScenario(next, store);
    assert.equal(r.ok, true);
    assert.equal(r.replaced, true);
    assert.equal(loadScenarios(store).length, 1);
    assert.equal(loadScenario("SCN-1", store).fields.stockWidth.value, "1000");
  });

  test("an older revision is refused rather than silently losing the newer one", () => {
    const old = draft();
    const newer = withField(withField(old, "stockWidth", { value: "1000" }), "stockLength", { value: "500" });
    saveScenario(newer, store);

    const r = saveScenario(old, store);
    assert.equal(r.ok, false);
    assert.equal(r.conflict, true);
    assert.match(r.error, /newer \(revision/);
    assert.equal(loadScenario("SCN-1", store).fields.stockWidth.value, "1000",
      "the newer copy is still there");
  });

  test("a scenario with no id is refused", () => {
    const r = saveScenario(scenario({ name: "x" }), store);
    assert.equal(r.ok, false);
    assert.match(r.error, /needs an id/);
  });
});

/* -------------------------------------------------------- awkward storage */

describe("when storage misbehaves", () => {
  test("a full store reports why rather than throwing", () => {
    const r = saveScenario(draft(), memory({ failWrites: true }));
    assert.equal(r.ok, false);
    assert.match(r.error, /Storage refused the write: QuotaExceededError/);
  });

  test("no storage at all is reported, not crashed through", () => {
    assert.equal(storageAvailable(null), false);
    assert.deepEqual(loadScenarios(null), []);
  });

  test("a record from another build is withheld rather than misread", () => {
    store._put([{ id: "SCN-old", schema: 99, fields: {} }]);
    assert.equal(loadScenarios(store).length, 0);
    const status = storeStatus(store);
    assert.equal(status.unreadable, 1);
    assert.match(status.unreadableReasons[0], /schema 99; this build reads 1/);
  });

  test("rubbish in storage does not stop the readable records loading", () => {
    saveScenario(draft(), store);
    const all = JSON.parse(store._raw());
    store._put([...all, null, "not a record", { nope: true }]);
    assert.equal(loadScenarios(store).length, 1);
    assert.equal(storeStatus(store).unreadable, 3);
  });

  test("a value that is not even JSON reads as empty", () => {
    store._put("{{{");
    assert.deepEqual(loadScenarios(store), []);
  });

  test("an oversized scenario is refused with its actual size", () => {
    let big = draft();
    big = withField(big, "partName", { value: "x".repeat(MAX_SCENARIO_BYTES + 10) });
    const r = saveScenario(big, store);
    assert.equal(r.ok, false);
    assert.match(r.error, /over the 128KB limit/);
  });
});

/* ------------------------------------------------------------- housekeeping */

describe("the list of saved work", () => {
  test("is newest first", () => {
    const a = scenario({ ...draft("SCN-a"), updatedAt: "2026-09-10T00:00:00.000Z" });
    const b = scenario({ ...draft("SCN-b"), updatedAt: "2026-09-14T00:00:00.000Z" });
    saveScenario(a, store);
    saveScenario(b, store);
    assert.deepEqual(loadScenarios(store).map((s) => s.id), ["SCN-b", "SCN-a"]);
  });

  test("deleting removes one and leaves the rest", () => {
    saveScenario(draft("SCN-a"), store);
    saveScenario(draft("SCN-b"), store);
    assert.equal(deleteScenario("SCN-a", store).ok, true);
    assert.deepEqual(loadScenarios(store).map((s) => s.id), ["SCN-b"]);
  });

  test("deleting something that is not there says so", () => {
    assert.match(deleteScenario("SCN-nope", store).error, /No scenario with that id/);
  });

  test("clearing empties it", () => {
    saveScenario(draft(), store);
    clearScenarios(store);
    assert.deepEqual(loadScenarios(store), []);
  });

  test("ids are unique across rapid creation", () => {
    /* Ten thousand in a tight loop, so most share a millisecond. The first
       version of this test used two hundred and passed on luck: three base-36
       random characters is 46,656 values, and two hundred draws from that
       collide about a third of the time. A collision here overwrites somebody
       else's saved scenario, so the generator counts rather than guesses. */
    const ids = new Set(Array.from({ length: 10_000 }, newId));
    assert.equal(ids.size, 10_000);
  });

  test("and two ids minted in the same millisecond differ in more than luck", () => {
    const a = newId();
    const b = newId();
    assert.notEqual(a, b);
    // Same timestamp segment, different sequence segment.
    assert.equal(a.split("-")[1], b.split("-")[1], "the test is only meaningful within one tick");
    assert.notEqual(a.split("-")[2], b.split("-")[2]);
  });
});
