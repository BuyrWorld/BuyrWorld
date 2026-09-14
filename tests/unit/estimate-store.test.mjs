/**
 * Saved build-ups.
 *
 * The thing worth testing is the round trip. A build-up is reduced to what an
 * argument needs on the way in and rebuilt on the way out, and the shares
 * computed from the rebuilt record must equal the shares computed from the
 * live one — otherwise a figure somebody argued with last month is not the
 * figure they argued with.
 *
 * And the completeness has to survive. A build-up with gaps cannot be
 * compared against a claim, and must not become comparable by being saved.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { ratioToPercentString, moneyFromDecimal } from "../../src/calc/exact.mjs";
import { BASIS } from "../../src/calc/should-cost.mjs";
import { buildUpShares, compareToBuildUp } from "../../src/calc/build-up.mjs";
import {
  SCHEMA_VERSION, MAX_ESTIMATE_BYTES,
  estimateFrom, asCostPlan, saveEstimate, loadEstimates, loadEstimate,
  deleteEstimate, clearEstimates, storeStatus, storageAvailable,
} from "../../src/services/estimate-store.mjs";

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

const gbp = (v) => moneyFromDecimal(v, "GBP", null);

const cost = (over = {}) => ({
  ok: true,
  complete: over.complete !== false,
  missing: over.missing ?? [],
  currency: "GBP",
  confidence: over.confidence ?? "quote-backed",
  lines: over.lines ?? [
    { id: "stock", label: "Raw stock", amount: gbp("6000.00"), signed: 600000n, oneTime: false, credit: false, quality: BASIS.QUOTED, basis: "quoted sheet price", note: null },
    { id: "manufacturing", label: "Manufacturing", amount: gbp("4000.00"), signed: 400000n, oneTime: false, credit: false, quality: BASIS.REVIEWED, basis: "planner's cycle time", note: null },
  ],
});

const plan = { ok: true, quantities: { acceptedPartsRequired: 1000n } };

let store;
beforeEach(() => { store = fakeStore(); });

describe("reducing an estimate to what an argument needs", () => {
  test("it keeps the result and not the working", () => {
    const e = estimateFrom(plan, cost(), { id: "e1", name: "Bracket BRK-A-102" });
    assert.equal(e.lines.length, 2);
    assert.equal(e.lines[0].minor, "600000");
    for (const absent of ["route", "layout", "quantities", "mass", "volume"]) {
      assert.equal(absent in e, false, `the working (${absent}) was stored`);
    }
  });

  test("an id and a name somebody will recognise are both required", () => {
    assert.throws(() => estimateFrom(plan, cost(), { id: "e1" }), /id and a name/);
    assert.throws(() => estimateFrom(plan, cost(), { name: "x" }), /id and a name/);
  });

  test("there has to be a cost to save", () => {
    assert.throws(() => estimateFrom(plan, null, { id: "e1", name: "x" }), /no cost estimate/);
    assert.throws(() => estimateFrom(plan, { ok: false }, { id: "e1", name: "x" }), /no cost estimate/);
  });

  test("the part and supplier travel, so a build-up can be found again", () => {
    const e = estimateFrom(plan, cost(), {
      id: "e1", name: "Bracket", part: "BRK-A-102", supplier: "Meridian Fabrication (synthetic)",
    });
    assert.equal(e.part, "BRK-A-102");
    assert.equal(e.supplier, "Meridian Fabrication (synthetic)");
    assert.equal(e.acceptedParts, "1000");
  });
});

describe("the round trip does not change the argument", () => {
  test("shares from a stored build-up equal shares from the live one", () => {
    const live = buildUpShares(cost());
    const back = buildUpShares(asCostPlan(estimateFrom(plan, cost(), { id: "e1", name: "x" })));
    assert.equal(back.ok, true);
    assert.equal(back.total, live.total);
    for (const id of ["stock", "manufacturing"]) {
      assert.equal(back.byId[id].share, live.byId[id].share,
        `${id} is a different share after a round trip`);
    }
    assert.equal(ratioToPercentString(back.byId.stock.share, 1), "60.0%");
  });

  test("a comparison against a stored build-up matches one against the live one", () => {
    const bridge = { contributions: [{ id: "material", label: "Material", weight: 750_000_000n, indexMovement: 80_000_000n }] };
    const map = { material: "stock" };
    const live = compareToBuildUp({ bridge, cost: cost(), map });
    const stored = compareToBuildUp({ bridge, cost: asCostPlan(estimateFrom(plan, cost(), { id: "e1", name: "x" })), map });
    assert.equal(stored.rows[0].difference, live.rows[0].difference);
    assert.equal(stored.rows[0].atClaimedMovement, live.rows[0].atClaimedMovement);
  });

  test("a credit keeps its sign through storage", () => {
    const withCredit = cost({
      lines: [
        { id: "stock", label: "Raw stock", amount: gbp("6000.00"), signed: 600000n, oneTime: false, credit: false, quality: BASIS.QUOTED, basis: "q", note: null },
        { id: "scrapCredit", label: "Scrap credit", amount: gbp("500.00"), signed: -50000n, oneTime: false, credit: true, quality: BASIS.QUOTED, basis: "q", note: null },
      ],
    });
    const back = buildUpShares(asCostPlan(estimateFrom(plan, withCredit, { id: "e1", name: "x" })));
    assert.ok(back.byId.scrapCredit.share < 0n);
    assert.equal(back.total, 550000n);
  });

  test("the strength of each line survives, because it is part of the argument", () => {
    const back = asCostPlan(estimateFrom(plan, cost(), { id: "e1", name: "x" }));
    assert.equal(back.lines[1].quality, BASIS.REVIEWED);
    assert.equal(back.lines[1].basis, "planner's cycle time");
  });

  test("an unpriced line comes back unpriced, not as zero", () => {
    const withGap = cost({
      complete: false,
      missing: [{ id: "manufacturing", label: "Manufacturing" }],
      lines: [
        { id: "stock", label: "Raw stock", amount: gbp("6000.00"), signed: 600000n, oneTime: false, credit: false, quality: BASIS.QUOTED, basis: "q", note: null },
        { id: "manufacturing", label: "Manufacturing", amount: null, signed: 0n, oneTime: false, credit: false, quality: null, basis: null, note: null },
      ],
    });
    const back = asCostPlan(estimateFrom(plan, withGap, { id: "e1", name: "x" }));
    assert.equal(back.lines[1].amount, null);
  });
});

describe("a build-up with gaps stays uncomparable", () => {
  test("incompleteness survives storage", () => {
    const withGap = cost({ complete: false, missing: [{ id: "freight", label: "Freight and packaging" }] });
    const back = asCostPlan(estimateFrom(plan, withGap, { id: "e1", name: "x" }));
    assert.equal(back.complete, false);
    const s = buildUpShares(back);
    assert.equal(s.ok, false, "saving and reloading must not make a partial estimate comparable");
    assert.match(s.why, /Freight and packaging/);
  });
});

describe("the store", () => {
  const e = (over = {}) => estimateFrom(plan, cost(), { id: "e1", name: "Bracket BRK-A-102", ...over });

  test("a saved build-up comes back", () => {
    assert.equal(saveEstimate(e(), store).ok, true);
    assert.equal(loadEstimates(store).length, 1);
    assert.equal(loadEstimate("e1", store).name, "Bracket BRK-A-102");
    assert.equal(loadEstimate("nope", store), null);
  });

  test("saving the same id replaces, and hands back what was there", () => {
    saveEstimate(e({ name: "First" }), store);
    const second = saveEstimate(e({ name: "Second" }), store);
    assert.equal(second.replaced, true);
    assert.equal(second.previous.name, "First");
    assert.equal(loadEstimates(store).length, 1);
  });

  test("a record with no id is refused", () => {
    assert.match(saveEstimate({ name: "x" }, store).error, /needs an id/);
  });

  test("a write storage refuses is reported", () => {
    assert.match(saveEstimate(e(), fakeStore({ failWrites: true })).error, /QuotaExceededError/);
  });

  test("a browser blocking site data is handled without throwing", () => {
    const blocked = fakeStore({ throwOnAccess: true });
    assert.deepEqual(loadEstimates(blocked), []);
    assert.equal(storageAvailable(blocked), false);
  });

  test("an oversized record is refused with its size", () => {
    const huge = { ...e(), part: "x".repeat(MAX_ESTIMATE_BYTES) };
    assert.match(saveEstimate(huge, store).error, /over the 64KB limit/);
  });

  test("deleting and clearing work, and deleting nothing says so", () => {
    saveEstimate(e(), store);
    assert.equal(deleteEstimate("nope", store).ok, false);
    assert.equal(deleteEstimate("e1", store).ok, true);
    saveEstimate(e(), store);
    clearEstimates(store);
    assert.equal(loadEstimates(store).length, 0);
  });

  test("a record from another build is withheld and reported, not dropped", () => {
    store._raw.set("bw.estimates.v1", JSON.stringify([
      { ...e(), schema: SCHEMA_VERSION },
      { id: "future", name: "Later", lines: [], schema: 99 },
    ]));
    assert.equal(loadEstimates(store).length, 1);
    const status = storeStatus(store);
    assert.equal(status.unreadable, 1);
    assert.match(status.unreadableReasons[0], /saved by schema 99; this build reads 1/);
  });

  test("corrupt storage does not read as an empty store", () => {
    store._raw.set("bw.estimates.v1", "{ not json");
    assert.deepEqual(loadEstimates(store), []);
    assert.equal(storeStatus(store).total, 0);
  });
});
