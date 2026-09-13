/**
 * Migrating stored records onto entity identity — without migrating them.
 *
 * Ids are deterministic from the name, so a record written before identity
 * existed resolves to the same id as one written after it. That turns a risky
 * rewrite of everything in someone's browser into no rewrite at all.
 *
 * The guarantee that makes it safe is a superset property: any two names that
 * matched under the old `.trim().toLowerCase()` comparison still match now.
 * Some names that did NOT match now do — a full stop, an accent — and that is
 * the defect being fixed, not a regression. Both halves are tested here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { recordOutcome } from "../../src/calc/outcome.mjs";
import { supplierHistory, historyBySupplier } from "../../src/calc/supplier-history.mjs";
import { ratioFromPercent as pc, moneyFromDecimal } from "../../src/calc/exact.mjs";
import { supplierId, normaliseName } from "../../src/domain/ids.mjs";
import { upsertSupplier, mergeSuppliers } from "../../src/domain/registry.mjs";
import { newCase, saveCase, listCases, loadCase } from "../../src/services/case-store.mjs";

const DRIVERS = [{ id: "steel", label: "Steel bar", weight: pc("40"), indexMovement: pc("10") }];
const bridge = (requested) => costBridge({
  baseline: { unitPrice: moneyFromDecimal("100.00", "GBP"), annualVolume: 50_000 },
  requestedChange: pc(requested), drivers: DRIVERS,
});

/** An outcome as written today. */
const outcome = (name, at = "2025-01", requested = "9", agreed = "6") => recordOutcome({
  bridge: bridge(requested), agreedChange: pc(agreed),
  meta: { supplier: name, recordedAt: at },
});

/** An outcome as stored before identity existed: a name and no id. */
function legacy(name, at = "2025-01") {
  const r = outcome(name, at);
  return { ...r, meta: Object.freeze({ ...r.meta, supplierId: undefined }) };
}

function makeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

describe("the superset guarantee", () => {
  const oldMatch = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

  test("anything that matched before still matches", () => {
    const pairs = [
      ["Meridian Fabrication Ltd", "meridian fabrication ltd"],
      ["  Alpha Castings  ", "alpha castings"],
      ["BRAVO FASTENERS LTD", "bravo fasteners ltd"],
    ];
    for (const [a, b] of pairs) {
      assert.equal(oldMatch(a, b), true, "fixture should match under the old rule");
      assert.equal(supplierId(a), supplierId(b), `${a} and ${b} must still be one supplier`);
    }
  });

  test("anything that did not match before, and should not, still does not", () => {
    for (const [a, b] of [["Alpha Castings", "Alpha Coatings"], ["Meridian Ltd", "Meridian Holdings Ltd"]]) {
      assert.equal(oldMatch(a, b), false);
      assert.notEqual(supplierId(a), supplierId(b));
    }
  });

  test("the names that now match are exactly the defect being fixed", () => {
    // A full stop used to lose a supplier's entire history.
    for (const [a, b] of [["Meridian Fabrication Ltd.", "Meridian Fabrication Ltd"], ["Müller GmbH", "Muller GmbH"]]) {
      assert.equal(oldMatch(a, b), false, "these used to be two different suppliers");
      assert.equal(supplierId(a), supplierId(b), "and that was the bug");
    }
  });

  test("normalisation is idempotent, so an id cannot drift on re-save", () => {
    const n = normaliseName("  Meridian Fabrication Ltd. ");
    assert.equal(normaliseName(n), n);
    assert.equal(supplierId(n), supplierId("  Meridian Fabrication Ltd. "));
  });
});

describe("legacy outcomes read identically", () => {
  const NAME = "Meridian Fabrication Ltd";

  test("a record with no supplierId is found by name", () => {
    const h = supplierHistory([legacy(NAME)], NAME);
    assert.equal(h.count, 1, "a record written before identity existed must still be found");
  });

  test("it is also found by the id that name derives to", () => {
    const h = supplierHistory([legacy(NAME)], supplierId(NAME));
    assert.equal(h.count, 1);
  });

  test("old and new records for one supplier land in the same history", () => {
    const h = supplierHistory([legacy(NAME, "2024-01"), outcome(NAME, "2025-01")], NAME);
    assert.equal(h.count, 2, "a rewrite would have been needed for this to work; deriving avoids it");
  });

  test("a legacy record now reachable by a spelling that used to miss", () => {
    const h = supplierHistory([legacy(NAME)], "meridian fabrication ltd.");
    assert.equal(h.count, 1);
  });

  test("the history reports the identity it matched on", () => {
    assert.equal(supplierHistory([legacy(NAME)], NAME).supplierId, supplierId(NAME));
  });

  test("a different supplier is still not absorbed", () => {
    assert.equal(supplierHistory([legacy("Alpha Castings Ltd")], "Alpha Coatings Ltd").count, 0);
  });
});

describe("grouping every supplier", () => {
  test("two spellings produce one row, not two half-histories", () => {
    const all = historyBySupplier([
      legacy("Meridian Fabrication Ltd", "2024-01"),
      outcome("Meridian Fabrication Ltd.", "2025-01"),
    ]);
    assert.equal(all.length, 1, "two half-histories each looking complete is the failure here");
    assert.equal(all[0].count, 2);
  });

  test("genuinely different suppliers stay apart", () => {
    const all = historyBySupplier([outcome("Alpha Castings Ltd"), outcome("Bravo Fasteners Ltd")]);
    assert.equal(all.length, 2);
  });
});

describe("the registry carries renames and merges into history", () => {
  const OLD = "Meridian Fabrication Ltd";
  const NEW = "Meridian Fabrication Limited";

  test("a rename keeps the old records attached", () => {
    // The acquisition case: the counterparty is renamed, the history must not
    // detach. Without a registry the two names are different ids by design.
    let { suppliers, supplier } = upsertSupplier([], OLD);
    suppliers = upsertSupplier(suppliers, NEW).suppliers;
    // Two records exist, so merge them the way a person would confirm.
    const other = suppliers.find((s) => s.id !== supplier.id);
    const merged = mergeSuppliers(suppliers, other.id, supplier.id);

    const records = [legacy(OLD, "2024-01"), outcome(NEW, "2025-01")];
    const h = supplierHistory(records, NEW, { suppliers: merged.suppliers });
    assert.equal(h.count, 2, "both spellings resolve to the surviving identity");
  });

  test("without a registry the two names are separate, which is the safe default", () => {
    const records = [legacy(OLD, "2024-01"), outcome(NEW, "2025-01")];
    assert.equal(supplierHistory(records, NEW).count, 1,
      "merging these without confirmation would be a guess about company structure");
  });

  test("a merged-away spelling resolves to the survivor", () => {
    let { suppliers } = upsertSupplier([], "Smith Ltd");
    suppliers = upsertSupplier(suppliers, "Smith GmbH").suppliers;
    const [a, b] = suppliers;
    const merged = mergeSuppliers(suppliers, b.id, a.id);
    const h = supplierHistory([outcome("Smith GmbH")], "Smith Ltd", { suppliers: merged.suppliers });
    assert.equal(h.count, 1);
  });
});

describe("cases carry identity too", () => {
  test("a saved case derives its supplier id", () => {
    const s = makeStore();
    const c = newCase({ ref: "SC-001", supplier: "Meridian Fabrication Ltd." });
    saveCase(c, s);
    assert.equal(listCases(s)[0].supplierId, supplierId("Meridian Fabrication Ltd"));
  });

  test("a case stored before identity existed gets one on read", () => {
    const s = makeStore();
    const c = newCase({ ref: "SC-001", supplier: "Meridian Fabrication Ltd" });
    saveCase({ ...c, supplierId: undefined }, s);
    const row = listCases(s)[0];
    assert.equal(row.supplierId, supplierId("Meridian Fabrication Ltd"),
      "derived on read, so nothing in a real browser needed rewriting");
  });

  test("the typed name is kept verbatim beside the id", () => {
    const s = makeStore();
    saveCase(newCase({ ref: "SC-001", supplier: "  Meridian Fabrication Ltd. " }), s);
    const stored = loadCase(listCases(s)[0].id, s);
    assert.equal(stored.supplier, "  Meridian Fabrication Ltd. ",
      "the name is what the document said; rewriting it would lose evidence");
    assert.equal(stored.supplierId, supplierId("Meridian Fabrication Ltd"));
  });

  test("a case with no supplier has no id rather than a made-up one", () => {
    const s = makeStore();
    saveCase(newCase({ ref: "SC-001" }), s);
    assert.equal(listCases(s)[0].supplierId, null);
  });

  test("an outcome can name the case it resolved", () => {
    // linkOutcome existed and was never called; this is the field that makes
    // the loop closable.
    const r = recordOutcome({
      bridge: bridge("9"), agreedChange: pc("6"),
      meta: { supplier: "Meridian Fabrication Ltd", caseId: "case_abc1234567890" },
    });
    assert.equal(r.meta.caseId, "case_abc1234567890");
  });
});

describe("nothing was rewritten to achieve this", () => {
  test("an outcome object from before the change is still readable as-is", () => {
    const old = legacy("Meridian Fabrication Ltd");
    assert.equal(old.meta.supplierId, undefined, "the fixture really is a legacy shape");
    assert.equal(supplierHistory([old], "Meridian Fabrication Ltd").count, 1);
  });

  test("every existing field survives the addition", () => {
    const r = outcome("Meridian Fabrication Ltd");
    for (const field of ["caseRef", "supplier", "category", "synthetic", "recordedAt"]) {
      assert.ok(field in r.meta, `${field} must not have been dropped`);
    }
  });
});
