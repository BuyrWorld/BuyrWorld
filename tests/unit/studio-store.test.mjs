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
import {
  reviewItem, documentRef, confirm, correct, usable, METHOD,
} from "../../src/intake/review.mjs";

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

/* ------------------------------------------------ the queue across a refresh */

/**
 * What somebody decided about the drawing, reopened.
 *
 * The queue lived in memory only. Confirm fourteen rows, hit refresh, and
 * every decision went — including the record of who changed what from what,
 * which is the thing the queue was built to keep.
 *
 * The version step is the same shape as the one that added the model and its
 * requirements: a field appears, nothing changes meaning, and a record written
 * by the older build comes back with the field empty rather than being
 * refused.
 */
describe("the review queue survives a refresh", () => {
  const DOC = documentRef({ filename: "brk-a-102.pdf", revision: "B", fingerprint: "abc" });
  const reading = () => reviewItem(
    { field: "thickness", label: "Thickness", value: "5", unit: "mm",
      page: 1, quote: "Thickness 5 mm", confidence: "labelled" },
    { method: METHOD.RULE, document: DOC });

  const withReview = (items) => ({ ...draft(), review: items });

  test("a confirmed row comes back confirmed, with who and when", () => {
    const store = memory();
    saveScenario(withReview([confirm(reading(), "a buyer")]), store);

    const back = loadScenarios(store)[0];
    assert.equal(back.review.length, 1);
    assert.equal(back.review[0].disposition, "confirmed");
    assert.equal(usable(back.review[0]), true);
    assert.equal(back.review[0].revisions[0].by, "a buyer");
  });

  test("a correction comes back with the reading it replaced still under it", () => {
    /* The whole point of storing the queue rather than the values. */
    const store = memory();
    saveScenario(withReview([correct(reading(), { value: "5.2" }, "a buyer")]), store);

    const back = loadScenarios(store)[0].review[0];
    assert.equal(back.value, "5.2");
    assert.equal(back.evidence.value, "5");
    assert.equal(back.revisions[0].from, "5");
  });

  test("the document each decision was made about comes back too", () => {
    /* Without it, reopening a case whose drawing has since changed would
       trust decisions made about the old one. */
    const store = memory();
    saveScenario(withReview([confirm(reading(), "a buyer")]), store);
    assert.equal(loadScenarios(store)[0].review[0].document.fingerprint, "abc");
  });

  test("a scenario saved before the queue existed comes back without one", () => {
    /* Version 2, read by a build that writes version 3. Refusing it would
       discard somebody's saved work over a field that did not exist when they
       saved it. */
    const store = memory();
    const old = { ...draft(), schema: 2, savedAt: new Date().toISOString() };
    store._put([old]);

    const back = loadScenarios(store);
    assert.equal(back.length, 1, "a version-2 record was refused");
    assert.deepEqual([...back[0].review], []);
    assert.equal(back[0].savedSchema, 2);
  });

  test("a decision stored with no record of being made comes back needing a look", () => {
    /* localStorage is a text file the person can edit. This is not a
       privilege problem — they could type the value instead — but an
       unattributed decision is not one, and it is reported rather than
       silently untucked. */
    const store = memory();
    const tampered = JSON.parse(JSON.stringify(confirm(reading(), "a buyer")));
    tampered.revisions = [];
    saveScenario(withReview([tampered]), store);

    const back = loadScenarios(store)[0];
    assert.equal(back.review[0].disposition, "proposed");
    assert.equal(usable(back.review[0]), false);
    assert.equal(back.reviewUntucked.length, 1);
    assert.match(back.reviewUntucked[0].restored, /no record of who decided it/);
  });

  test("a row that is not a reading is refused and counted", () => {
    const store = memory();
    saveScenario(withReview([confirm(reading(), "a buyer"), { nonsense: true }]), store);

    const back = loadScenarios(store)[0];
    assert.equal(back.review.length, 1);
    assert.equal(back.reviewRefused.length, 1);
  });

  test("the store still says which schema it writes", () => {
    assert.equal(SCHEMA_VERSION, 3);
    assert.equal(storeStatus(memory()).schema, 3);
  });

  test("a queue does not push a scenario over the size limit on its own", () => {
    /* Fourteen rows with quotes and histories is the realistic case, and a
       save that fails at the end of a review would be the worst moment for
       it. */
    const store = memory();
    const many = [];
    for (let n = 0; n < 20; n++) {
      many.push(confirm(reviewItem(
        { field: `field${n}`, label: `Field ${n}`, value: "123.45", unit: "mm", page: 2,
          quote: "A quote of the sort a drawing actually carries, with a label and a value",
          confidence: "labelled" },
        { method: METHOD.RULE, document: DOC }), "a buyer"));
    }
    const r = saveScenario(withReview(many), store);
    assert.equal(r.ok, true, r.error);
    assert.equal(loadScenarios(store)[0].review.length, 20);
  });
});
