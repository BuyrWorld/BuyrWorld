import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  newCase, saveCase, loadCase, loadCases, listCases, deleteCase, clearCases,
  setStatus, linkOutcome, storeStatus, storageAvailable,
  exportCases, importCases,
  STATUS, SCHEMA_VERSION, STORAGE_KEY, MAX_CASE_BYTES,
} from "../../src/services/case-store.mjs";
import { serialise } from "../../src/services/outcome-store.mjs";
import { ratioFromPercent as pc, moneyFromDecimal } from "../../src/calc/exact.mjs";

/** A localStorage stand-in that behaves like the real one, including throwing. */
function makeStore({ blocked = false, full = false } = {}) {
  const m = new Map();
  return {
    getItem: (k) => { if (blocked) throw new Error("SecurityError: access denied"); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => {
      if (blocked) throw new Error("SecurityError: access denied");
      if (full) { const e = new Error("QuotaExceededError: exceeded"); e.name = "QuotaExceededError"; throw e; }
      m.set(k, String(v));
    },
    removeItem: (k) => { if (blocked) throw new Error("SecurityError: access denied"); m.delete(k); },
    _raw: () => m.get(STORAGE_KEY),
    _set: (v) => m.set(STORAGE_KEY, v),
    _map: m,
  };
}

let s;
beforeEach(() => { s = makeStore(); });

const a = (over = {}) => newCase({ ref: "SC-001", supplier: "Meridian Fabrication Ltd", category: "Castings", ...over });

describe("a case is built before it is stored", () => {
  test("it gets an id, a schema stamp and both timestamps", () => {
    const c = a();
    assert.ok(c.id);
    assert.equal(c.schema, SCHEMA_VERSION);
    assert.ok(c.createdAt);
    assert.equal(c.updatedAt, c.createdAt);
  });

  test("two cases never share an id", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newCase().id));
    assert.equal(ids.size, 200);
  });

  test("it starts as a draft", () => {
    assert.equal(a().status, STATUS.DRAFT);
  });

  test("it is synthetic unless something says otherwise", () => {
    // An unlabelled case must never be presented as real.
    assert.equal(a().synthetic, true);
    assert.equal(a({ synthetic: false }).synthetic, false);
  });
});

describe("saving and reading back", () => {
  test("a saved case comes back whole", () => {
    const c = a({ data: { price: "100.00", drivers: [{ id: "steel" }] } });
    assert.equal(saveCase(c, s).ok, true);
    const back = loadCase(c.id, s);
    assert.equal(back.ref, "SC-001");
    assert.deepEqual(back.data.drivers, [{ id: "steel" }]);
  });

  test("BigInt figures survive the round trip", () => {
    // Every figure in the engine is a BigInt and JSON.stringify throws on one.
    const c = a({ data: { weight: pc("42"), price: moneyFromDecimal("100.00", "GBP") } });
    saveCase(c, s);
    const back = loadCase(c.id, s);
    assert.equal(back.data.weight, pc("42"));
    assert.equal(typeof back.data.weight, "bigint");
    assert.equal(back.data.price.minor, 10_000n);
    assert.equal(back.data.price.currency, "GBP");
  });

  test("saving the same id updates rather than duplicating", () => {
    const c = a();
    saveCase(c, s);
    saveCase({ ...c, supplier: "Renamed Ltd" }, s);
    assert.equal(loadCases(s).length, 1);
    assert.equal(loadCase(c.id, s).supplier, "Renamed Ltd");
  });

  test("updatedAt moves on save, createdAt does not", async () => {
    const c = a();
    saveCase(c, s);
    await new Promise((r) => setTimeout(r, 2));
    saveCase({ ...loadCase(c.id, s), supplier: "X" }, s);
    const back = loadCase(c.id, s);
    assert.equal(back.createdAt, c.createdAt);
    assert.notEqual(back.updatedAt, c.createdAt);
  });

  test("cases come back most recently touched first", async () => {
    const one = a({ ref: "SC-1" }); saveCase(one, s);
    await new Promise((r) => setTimeout(r, 2));
    const two = a({ ref: "SC-2" }); saveCase(two, s);
    assert.deepEqual(loadCases(s).map((c) => c.ref), ["SC-2", "SC-1"]);
  });

  test("an unknown id is null, not an error", () => {
    assert.equal(loadCase("nope", s), null);
  });

  test("something that is not a case is refused with a usable message", () => {
    assert.match(saveCase({}, s).error, /not a case/);
    assert.match(saveCase(null, s).error, /not a case/);
  });
});

describe("the list view", () => {
  test("it carries what a chooser needs and not the payload", () => {
    const c = a({ data: { letter: "x".repeat(5000) } });
    saveCase(c, s);
    const [row] = listCases(s);
    assert.equal(row.ref, "SC-001");
    assert.equal(row.supplier, "Meridian Fabrication Ltd");
    assert.equal(row.status, STATUS.DRAFT);
    assert.equal(row.data, undefined, "the list must not drag every pasted letter into the page");
  });

  test("an empty store lists nothing rather than throwing", () => {
    assert.deepEqual(listCases(s), []);
  });
});

describe("moving a case along", () => {
  test("status changes are kept to the known set", () => {
    const c = a(); saveCase(c, s);
    assert.equal(setStatus(c.id, STATUS.ANALYSED, s).ok, true);
    assert.equal(loadCase(c.id, s).status, STATUS.ANALYSED);
    assert.match(setStatus(c.id, "finished", s).error, /Not a status/);
  });

  test("a status change does not disturb the payload", () => {
    const c = a({ data: { price: "100.00" } }); saveCase(c, s);
    setStatus(c.id, STATUS.DECIDED, s);
    assert.equal(loadCase(c.id, s).data.price, "100.00");
  });

  test("linking an outcome closes the case and records the link", () => {
    const c = a(); saveCase(c, s);
    assert.equal(linkOutcome(c.id, "OC-7", s).ok, true);
    const back = loadCase(c.id, s);
    assert.equal(back.status, STATUS.CLOSED);
    assert.equal(back.outcomeRecorded, true);
    assert.equal(back.outcomeRef, "OC-7");
  });

  test("a missing case is reported rather than silently created", () => {
    assert.match(setStatus("nope", STATUS.CLOSED, s).error, /No case with that id/);
    assert.match(linkOutcome("nope", "OC-1", s).error, /No case with that id/);
  });
});

describe("the version gate", () => {
  test("a case from another schema is withheld, not misread", () => {
    const ok = a({ ref: "SC-NOW" });
    saveCase(ok, s);
    const future = { ...a({ ref: "SC-FUTURE" }), schema: SCHEMA_VERSION + 1 };
    s._set(serialise([future, { ...ok, schema: SCHEMA_VERSION }]));

    assert.deepEqual(loadCases(s).map((c) => c.ref), ["SC-NOW"]);
    assert.equal(loadCase(future.id, s), null, "opening it would look fine and be wrong");
  });

  test("what is withheld is reported, so it does not look like data loss", () => {
    saveCase(a({ ref: "SC-NOW" }), s);
    const future = { ...a({ ref: "SC-FUTURE" }), schema: 99 };
    s._set(serialise([future, ...loadCases(s)]));

    const st = storeStatus(s);
    assert.equal(st.total, 2);
    assert.equal(st.readable, 1);
    assert.equal(st.unreadable, 1);
    assert.match(st.unreadableReasons[0], /saved by schema 99; this build reads 1/);
  });

  test("saving does not drop entries this build cannot read", () => {
    const future = { ...a({ ref: "SC-FUTURE" }), schema: 99 };
    s._set(serialise([future]));
    saveCase(a({ ref: "SC-NEW" }), s);
    assert.equal(storeStatus(s).total, 2, "someone else's build still owns that case");
    assert.equal(storeStatus(s).unreadable, 1);
  });

  test("junk in the store is survived", () => {
    s._set("not json at all");
    assert.deepEqual(loadCases(s), []);
    assert.equal(storeStatus(s).total, 0);
    assert.equal(saveCase(a(), s).ok, true, "a corrupt store must still accept a new case");
  });
});

describe("size", () => {
  test("an oversized case is refused on its own rather than taking the write down", () => {
    saveCase(a({ ref: "SC-KEEP" }), s);
    const huge = a({ ref: "SC-HUGE", data: { letter: "x".repeat(MAX_CASE_BYTES + 1000) } });
    const r = saveCase(huge, s);
    assert.equal(r.ok, false);
    assert.match(r.error, /over the 256KB limit/);
    assert.ok(r.bytes > MAX_CASE_BYTES);
    assert.deepEqual(loadCases(s).map((c) => c.ref), ["SC-KEEP"], "the other case survives");
  });

  test("a normal case reports its size", () => {
    const r = saveCase(a({ data: { letter: "a plausible supplier letter" } }), s);
    assert.equal(r.ok, true);
    assert.ok(r.bytes > 0 && r.bytes < MAX_CASE_BYTES);
  });
});

describe("storage that refuses", () => {
  test("a blocked store is reported, not silently swallowed", () => {
    const blocked = makeStore({ blocked: true });
    assert.equal(storageAvailable(blocked), false);
    const r = saveCase(a(), blocked);
    assert.equal(r.ok, false);
    assert.match(r.error, /blocking local storage/);
  });

  test("a full store says what to do about it", () => {
    const full = makeStore({ full: true });
    const r = saveCase(a(), full);
    assert.equal(r.ok, false);
    assert.match(r.error, /full. Export the cases/);
  });

  test("no store at all is a message, not a crash", () => {
    const r = saveCase(a(), null);
    // Node has no localStorage by default, so this exercises the real path.
    assert.equal(typeof r.ok, "boolean");
  });

  test("reading a blocked store is an empty list", () => {
    assert.deepEqual(loadCases(makeStore({ blocked: true })), []);
  });
});

describe("deleting", () => {
  test("one case goes and the rest stay", () => {
    const one = a({ ref: "SC-1" }); const two = a({ ref: "SC-2" });
    saveCase(one, s); saveCase(two, s);
    assert.equal(deleteCase(one.id, s).ok, true);
    assert.deepEqual(loadCases(s).map((c) => c.ref), ["SC-2"]);
  });

  test("deleting nothing reports it", () => {
    assert.match(deleteCase("nope", s).error, /No case with that id/);
  });

  test("clearing removes everything", () => {
    saveCase(a(), s);
    assert.equal(clearCases(s).ok, true);
    assert.deepEqual(loadCases(s), []);
  });
});

describe("portability", () => {
  test("an export round-trips into an empty store", () => {
    const c = a({ data: { weight: pc("42") } });
    saveCase(c, s);
    const text = exportCases(s);

    const fresh = makeStore();
    const r = importCases(text, fresh);
    assert.equal(r.ok, true);
    assert.equal(r.imported, 1);
    assert.equal(loadCase(c.id, fresh).data.weight, pc("42"));
  });

  test("importing appends rather than overwriting", () => {
    const mine = a({ ref: "SC-MINE" });
    saveCase(mine, s);
    const other = makeStore();
    saveCase(a({ ref: "SC-THEIRS" }), other);

    const r = importCases(exportCases(other), s);
    assert.equal(r.ok, true);
    assert.equal(loadCases(s).length, 2);
    assert.ok(loadCases(s).some((c) => c.ref === "SC-MINE"), "silently losing my cases is the worse failure");
  });

  test("an id that already exists is skipped, not merged", () => {
    const c = a();
    saveCase(c, s);
    const r = importCases(exportCases(s), s);
    assert.equal(r.imported, 0);
    assert.equal(r.skipped, 1);
    assert.equal(loadCases(s).length, 1);
  });

  test("replace is available but never the default", () => {
    saveCase(a({ ref: "SC-MINE" }), s);
    const other = makeStore();
    saveCase(a({ ref: "SC-THEIRS" }), other);
    importCases(exportCases(other), s, { replace: true });
    assert.deepEqual(loadCases(s).map((c) => c.ref), ["SC-THEIRS"]);
  });

  test("an export from another schema is refused with the reason", () => {
    const text = serialise({ format: "buyrworld.cases.v1", schema: 99, cases: [a()] });
    const r = importCases(text, s);
    assert.equal(r.ok, false);
    assert.match(r.error, /schema 99; this build reads 1/);
  });

  test("a file that is not a case export is refused", () => {
    assert.match(importCases("{}", s).error, /not a BuyrWorld case export/);
    assert.match(importCases("<<<", s).error, /not a readable case export/);
    assert.match(importCases(serialise({ format: "buyrworld.outcomes.v1", outcomes: [] }), s).error,
      /not a BuyrWorld case export/);
  });

  test("the export declares its format, schema and that it is synthetic", () => {
    saveCase(a(), s);
    const parsed = JSON.parse(exportCases(s));
    assert.equal(parsed.format, "buyrworld.cases.v1");
    assert.equal(parsed.schema, SCHEMA_VERSION);
    assert.equal(parsed.synthetic, true);
  });
});

describe("it shares one serialisation format with the outcome store", () => {
  test("the two stores cannot drift apart, because the tagging is imported", () => {
    // Asserted against what the outcome store actually produces rather than
    // against a literal. The tag begins with a NUL byte — which is why grep
    // calls outcome-store.mjs a binary file — so a hand-written expectation
    // here would be quietly wrong, as the first version of this test was.
    const c = a({ data: { weight: pc("7.5") } });
    saveCase(c, s);
    // The tag is read out of the outcome store rather than written down here.
    // Text against text: JSON.stringify escapes the control character, so the
    // stored bytes read \u0000n: rather than carrying a literal NUL. Comparing
    // against serialise() output sidesteps having to spell either form.
    const probeText = serialise({ v: pc("7.5") });
    const tagged = probeText.slice(probeText.indexOf(":") + 2, -2);
    assert.ok(tagged.endsWith("75000000"), "probe did not yield a tagged value: " + tagged);
    assert.ok(s._raw().includes(tagged),
      "the case store must tag BigInts exactly as the outcome store does");
  });

  test("the tag opens with a control character, so typed text cannot collide with it", () => {
    const probe = JSON.parse(serialise({ v: 1n })).v;
    assert.ok(probe.charCodeAt(0) < 32,
      "a human can type a space; they cannot type a control character");
  });

  test("the two stores use different keys", () => {
    assert.equal(STORAGE_KEY, "bw.cases.v1");
    assert.notEqual(STORAGE_KEY, "bw.outcomes.v1");
  });
});
