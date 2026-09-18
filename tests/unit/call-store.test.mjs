/**
 * The one place a call note can be written.
 *
 * The gate is *"notes retained only by explicit save"*, so the checks worth
 * having are about what is refused and what is dropped: an empty call, a
 * commitment nobody looked at, and a browser that will not store anything.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  saveCall, loadCalls, loadCall, deleteCall, storeStatus, newCallId,
  storageAvailable, MAX_CALL_BYTES, SCHEMA_VERSION,
} from "../../src/services/call-store.mjs";
import {
  note, commitments, confirmCommitment, commitmentUnknown, GOAL,
} from "../../src/case/call.mjs";

/** A localStorage that behaves, and one that does not. */
function memory() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}
const refuses = () => ({
  getItem: () => null,
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: () => {},
});

const notes = () => [
  note({ text: "They will send the index breakdown by 2026-10-12" }),
  note({ text: "We agreed to review the volumes next week" }),
];

let store;
beforeEach(() => { store = memory(); });

describe("saving a call", () => {
  test("keeps the notes as they were taken", () => {
    const id = newCallId();
    const r = saveCall({ id, notes: notes(), commitments: [] }, store);
    assert.equal(r.ok, true);
    assert.deepEqual(loadCall(id, store).notes.map((n) => n.said), notes().map((n) => n.said));
  });

  test("keeps only the commitments somebody decided about", () => {
    const items = commitments(notes());
    const decided = [confirmCommitment(items[0], "me"), items[1]];
    const id = newCallId();

    const r = saveCall({ id, notes: notes(), commitments: decided }, store);
    assert.equal(r.kept, 1);
    assert.equal(r.dropped, 1, "a proposed reading was stored as though it were a record");
    assert.equal(loadCall(id, store).commitments.length, 1);
  });

  test("an unknown date is kept as a decision, because somebody made one", () => {
    const items = commitments(notes());
    const id = newCallId();
    saveCall({ id, notes: notes(),
      commitments: [commitmentUnknown(items[1], "me", "they would not commit")] }, store);
    const [kept] = loadCall(id, store).commitments;
    assert.equal(kept.disposition, "unknown");
    assert.equal(kept.why, "they would not commit");
  });

  test("the words each reading came from are kept with it", () => {
    const items = commitments(notes());
    const id = newCallId();
    saveCall({ id, notes: notes(), commitments: [confirmCommitment(items[0], "me")] }, store);
    assert.equal(loadCall(id, store).commitments[0].evidence.quote,
      "They will send the index breakdown by 2026-10-12");
  });

  test("and the record says it was never sent", () => {
    const id = newCallId();
    saveCall({ id, notes: notes(), goal: GOAL.EVIDENCE }, store);
    assert.equal(loadCall(id, store).sent, false);
  });

  test("an empty call is refused rather than stored as a blank row", () => {
    const r = saveCall({ id: newCallId(), notes: [], commitments: [] }, store);
    assert.equal(r.ok, false);
    assert.match(r.error, /nothing to save/);
    assert.equal(loadCalls(store).length, 0);
  });

  test("saving again replaces, rather than growing a second copy", () => {
    const id = newCallId();
    saveCall({ id, notes: notes() }, store);
    const again = saveCall({ id, notes: [...notes(), note({ text: "One more thing" })] }, store);
    assert.equal(again.replaced, true);
    assert.equal(loadCalls(store).length, 1);
    assert.equal(loadCall(id, store).notes.length, 3);
  });

  test("a browser that refuses says so, and says what to do instead", () => {
    const r = saveCall({ id: newCallId(), notes: notes() }, refuses());
    assert.equal(r.ok, false);
    assert.match(r.error, /Copy the follow-up/);
  });

  test("something far too long is refused with its size", () => {
    const huge = [note({ text: "x".repeat(MAX_CALL_BYTES + 10) })];
    const r = saveCall({ id: newCallId(), notes: huge }, store);
    assert.equal(r.ok, false);
    assert.match(r.error, /over the 64KB limit/);
  });
});

describe("reading them back", () => {
  test("a record from a schema this build does not know is withheld", () => {
    store.setItem("bw.calls.v1", JSON.stringify([{ schema: 99, id: "x", notes: [] }]));
    assert.deepEqual(loadCalls(store), []);
    assert.equal(storeStatus(store).unreadable, 1);
  });

  test("rubbish in the key is not a crash", () => {
    store.setItem("bw.calls.v1", "not json");
    assert.deepEqual(loadCalls(store), []);
  });

  test("status says what is there and which schema this build writes", () => {
    saveCall({ id: newCallId(), notes: notes() }, store);
    const s = storeStatus(store);
    assert.equal(s.readable, 1);
    assert.equal(s.schema, SCHEMA_VERSION);
    assert.equal(storageAvailable(store), true);
  });

  test("deleting one that is not there says so", () => {
    assert.equal(deleteCall("CALL-nope", store).ok, false);
  });
});

describe("nothing saves itself", () => {
  test("there is no timer, no unload hook and no autosave in the file", () => {
    /* Comments stripped first: the file says in as many words that it has no
       beforeunload hook, and a check that reads its own documentation as a
       violation is one nobody can satisfy. */
    const source = readFileSync("src/services/call-store.mjs", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const auto of ["setInterval", "setTimeout", "beforeunload", "addEventListener"]) {
      assert.equal(source.includes(auto), false, `call-store.mjs reaches for ${auto}`);
    }
  });

  test("and the call module still cannot reach this file", () => {
    const call = readFileSync("src/case/call.mjs", "utf8");
    assert.equal(call.includes("call-store"), false,
      "call.mjs can now store notes, which is the promise this pair exists to keep");
  });
});
