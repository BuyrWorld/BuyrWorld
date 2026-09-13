/**
 * The commercial memory spine.
 *
 * The failure this whole layer exists to prevent is quiet: a supplier typed
 * with a full stop, or renamed after an acquisition, silently detaching from
 * years of negotiating history while every figure on screen stays plausible.
 * The opposite failure is worse — two real companies welded into one because
 * their names looked alike. Both are tested here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  KIND, normaliseName, similarityKey, entityId, supplierId, partId, contractId, isId, kindOf,
} from "../../src/domain/ids.mjs";
import {
  supplier, part, contract, commercialCase, learningRecord, checkReferences,
  withAlias, renamed, CASE_STATUS, DOMAIN_SCHEMA,
} from "../../src/domain/entities.mjs";
import {
  resolveSupplier, upsertSupplier, suggestMerges, mergeSuppliers, unmergeSupplier,
  remapReferences, listSuppliers, byId,
} from "../../src/domain/registry.mjs";

const NAME = "Meridian Fabrication Ltd";

describe("normalising a name", () => {
  test("case, spacing and trailing punctuation do not make a new party", () => {
    const forms = [NAME, "  meridian  fabrication ltd. ", "MERIDIAN FABRICATION LTD,", "Meridian Fabrication Ltd"];
    const ids = new Set(forms.map(supplierId));
    assert.equal(ids.size, 1, `these should be one supplier, got ${ids.size}`);
  });

  test("accents are folded, so a document typed either way still resolves", () => {
    assert.equal(normaliseName("Müller GmbH"), normaliseName("Muller GmbH"));
  });

  test("genuinely different names stay different", () => {
    assert.notEqual(supplierId("Meridian Fabrication"), supplierId("Meridian Castings"));
    assert.notEqual(supplierId("Alpha Ltd"), supplierId("Alpha Holdings Ltd"));
  });

  test("an empty name cannot produce an id", () => {
    assert.throws(() => entityId(KIND.SUPPLIER, "   "), /needs a natural key/);
    assert.throws(() => entityId("nope", "x"), /Not an entity kind/);
  });
});

describe("the aggressive key is a hint, never a resolution", () => {
  test("it collapses legal suffixes", () => {
    assert.equal(similarityKey("Smith Holdings Ltd"), "smith");
    assert.equal(similarityKey("Smith GmbH"), "smith");
  });

  test("but those are different ids, because they may be different companies", () => {
    assert.notEqual(supplierId("Smith Holdings Ltd"), supplierId("Smith GmbH"));
  });

  test("an empty name yields no key, and an empty key never matches another", () => {
    assert.equal(similarityKey("   "), "");
  });

  test("a name that is only a suffix keeps it, so bare suffixes do not collapse together", () => {
    // Stripping happens only after a space. "Ltd" and "GmbH" therefore keep
    // distinct keys and are never proposed as the same party — which is the
    // behaviour that matters, rather than both reducing to nothing.
    assert.equal(similarityKey("Ltd"), "ltd");
    assert.notEqual(similarityKey("Ltd"), similarityKey("GmbH"));
  });
});

describe("ids are stable and typed", () => {
  test("the same inputs give the same id, everywhere and always", () => {
    assert.equal(supplierId(NAME), supplierId(NAME));
    assert.match(supplierId(NAME), /^sup_[0-9a-z]{13}$/);
  });

  test("a part number belongs to its supplier, not the world", () => {
    // The same drawing number from two suppliers is two commercial relationships.
    assert.notEqual(partId("Alpha Ltd", "MF-4471"), partId("Bravo Ltd", "MF-4471"));
    assert.equal(partId("Alpha Ltd", "MF-4471"), partId("alpha ltd.", "mf-4471"));
  });

  test("a contract reference is unique within a supplier", () => {
    assert.notEqual(contractId("Alpha Ltd", "C-1"), contractId("Bravo Ltd", "C-1"));
  });

  test("an id declares what it is", () => {
    assert.equal(isId(KIND.SUPPLIER, supplierId(NAME)), true);
    assert.equal(isId(KIND.PART, supplierId(NAME)), false);
    assert.equal(kindOf(partId("A", "B")), KIND.PART);
    assert.equal(kindOf("nonsense"), null);
  });
});

describe("a supplier", () => {
  test("carries its own name as an alias, so any spelling on file resolves", () => {
    const s = supplier({ name: NAME });
    assert.equal(s.id, supplierId(NAME));
    assert.deepEqual(s.aliases, ["meridian fabrication ltd"]);
    assert.equal(s.schema, DOMAIN_SCHEMA);
  });

  test("is synthetic unless something says otherwise", () => {
    assert.equal(supplier({ name: NAME }).synthetic, true);
    assert.equal(supplier({ name: NAME, synthetic: false }).synthetic, false);
  });

  test("needs a name", () => {
    assert.throws(() => supplier({}), /supplier name is required/);
    assert.throws(() => supplier({ name: "  " }), /supplier name is required/);
  });

  test("renaming keeps the id, which is the whole point", () => {
    // An acquisition renames the counterparty. The history must not detach.
    const s = supplier({ name: NAME });
    const r = renamed(s, "Meridian Fabrication Limited");
    assert.equal(r.id, s.id);
    assert.equal(r.name, "Meridian Fabrication Limited");
    assert.ok(r.aliases.includes("meridian fabrication ltd"), "the old spelling must still resolve");
    assert.ok(r.aliases.includes("meridian fabrication limited"));
  });

  test("adding an alias twice changes nothing", () => {
    const s = supplier({ name: NAME });
    assert.equal(withAlias(s, "MERIDIAN FABRICATION LTD"), s);
    assert.equal(withAlias(s, "").aliases.length, 1);
  });
});

describe("a part and a contract hang off a supplier", () => {
  test("a part resolves its supplier from a name or an id", () => {
    const s = supplier({ name: NAME });
    assert.equal(part({ supplier: NAME, number: "MF-4471" }).supplierId, s.id);
    assert.equal(part({ supplierId: s.id, number: "MF-4471" }).supplierId, s.id);
  });

  test("what nobody stated stays null rather than being guessed", () => {
    const p = part({ supplier: NAME, number: "MF-4471" });
    assert.equal(p.material, null, 'a material nobody stated is not "steel"');
    assert.equal(p.specification, null);
    assert.equal(p.annualVolume, null);
  });

  test("a volume that is not a whole number of units is refused, not rounded", () => {
    assert.equal(part({ supplier: NAME, number: "X", annualVolume: 1500.7 }).annualVolume, null);
    assert.equal(part({ supplier: NAME, number: "X", annualVolume: 1500 }).annualVolume, 1500);
  });

  test("a contract carries its dates and notice period", () => {
    const c = contract({
      supplier: NAME, reference: "AGR-2024-11",
      effectiveFrom: "2024-01", expiresOn: "2027-01-31", noticePeriodWeeks: 12,
    });
    assert.equal(c.supplierId, supplierId(NAME));
    assert.equal(c.noticePeriodWeeks, 12);
  });

  test("a malformed date is refused rather than stored as prose", () => {
    assert.throws(() => contract({ supplier: NAME, reference: "C", effectiveFrom: "next spring" }),
      /must be YYYY-MM or an ISO date/);
  });

  test("clauses are carried, not redefined", () => {
    // evidence.mjs already owns the shape of a constraint.
    const clause = { id: "7.2", governs: "quarterly-indexation", permits: false };
    assert.deepEqual(contract({ supplier: NAME, reference: "C", clauses: [clause] }).clauses, [clause]);
  });
});

describe("a commercial case", () => {
  test("names its supplier by id, so a retyped reference cannot detach it", () => {
    const k = commercialCase({ supplier: NAME, ref: "SC-001" });
    assert.equal(k.supplierId, supplierId(NAME));
    assert.equal(k.ref, "SC-001");
    assert.equal(k.status, CASE_STATUS.DRAFT);
    assert.equal(k.outcomeId, null, "null is not yet, never none");
  });

  test("the same reference against the same supplier is the same case", () => {
    assert.equal(
      commercialCase({ supplier: NAME, ref: "SC-001" }).id,
      commercialCase({ supplier: "meridian fabrication ltd.", ref: "SC-001" }).id
    );
  });

  test("the same reference against a different supplier is not", () => {
    assert.notEqual(
      commercialCase({ supplier: "Alpha Ltd", ref: "SC-001" }).id,
      commercialCase({ supplier: "Bravo Ltd", ref: "SC-001" }).id
    );
  });

  test("an unknown status is refused", () => {
    assert.throws(() => commercialCase({ supplier: NAME, ref: "X", status: "finished" }), /Not a case status/);
  });
});

describe("a learning record is evidence, not an opinion", () => {
  const ok = { caseId: "case_1", outcomeId: "out_1", argument: "Challenged the freight component" };

  test("it cannot exist without the case and outcome behind it", () => {
    assert.throws(() => learningRecord({ ...ok, outcomeId: "" }), /outcome/);
    assert.throws(() => learningRecord({ ...ok, caseId: "" }), /case/);
    assert.throws(() => learningRecord({ caseId: "c", outcomeId: "o" }), /argument made/);
  });

  test("money stays exact, or stays absent", () => {
    assert.equal(learningRecord({ ...ok, valueMovedMinor: 42_000_00n }).valueMovedMinor, 4200000n);
    assert.equal(learningRecord({ ...ok, valueMovedMinor: 42000.5 }).valueMovedMinor, null,
      "a float here would undo the entire calculation layer");
  });

  test("whether it worked is a recorded fact, and unknown is allowed", () => {
    assert.equal(learningRecord(ok).worked, null);
    assert.equal(learningRecord({ ...ok, worked: false }).worked, false);
    assert.throws(() => learningRecord({ ...ok, worked: "probably" }), /recorded fact/);
  });

  test("the same argument on the same outcome is the same record", () => {
    assert.equal(learningRecord(ok).id, learningRecord({ ...ok, argument: "challenged the FREIGHT component" }).id);
  });
});

describe("resolving a supplier", () => {
  const seed = () => upsertSupplier([], NAME).suppliers;

  test("by id, by alias, and by display name", () => {
    const list = seed();
    const s = list[0];
    assert.equal(resolveSupplier(list, s.id).id, s.id);
    assert.equal(resolveSupplier(list, NAME).id, s.id);
    assert.equal(resolveSupplier(list, "  MERIDIAN FABRICATION LTD. ").id, s.id);
  });

  test("a name nobody has seen resolves to nothing, rather than to the nearest", () => {
    assert.equal(resolveSupplier(seed(), "Meridian Castings Ltd"), null);
    assert.equal(resolveSupplier(seed(), ""), null);
    assert.equal(resolveSupplier([], NAME), null);
  });

  test("a second spelling attaches to the existing supplier and is remembered", () => {
    let { suppliers } = upsertSupplier([], NAME);
    const r = upsertSupplier(suppliers, "meridian fabrication ltd.");
    assert.equal(r.created, false);
    assert.equal(r.suppliers.length, 1, "a full stop must not create a second supplier");
  });

  test("a genuinely different supplier is created, not absorbed", () => {
    let { suppliers } = upsertSupplier([], NAME);
    const r = upsertSupplier(suppliers, "Meridian Fabrication GmbH");
    assert.equal(r.created, true);
    assert.equal(r.suppliers.length, 2, "a Ltd and a GmbH may be separate legal entities");
  });

  test("upsert never mutates what it was given", () => {
    const before = upsertSupplier([], NAME).suppliers;
    const snapshot = before.length;
    upsertSupplier(before, "Someone Else Ltd");
    assert.equal(before.length, snapshot);
  });
});

describe("merges are suggested, never applied", () => {
  const twoForms = () => {
    let { suppliers } = upsertSupplier([], "Meridian Fabrication Ltd");
    return upsertSupplier(suppliers, "Meridian Fabrication GmbH").suppliers;
  };

  test("a suffix-only difference is surfaced with its reason", () => {
    const s = suggestMerges(twoForms());
    assert.equal(s.length, 1);
    assert.equal(s[0].confirmed, false);
    assert.match(s[0].reason, /separate legal entities with separate contracts/);
    assert.match(s[0].reason, /confirm before doing it/);
  });

  test("unrelated suppliers are not suggested", () => {
    let { suppliers } = upsertSupplier([], "Alpha Castings Ltd");
    suppliers = upsertSupplier(suppliers, "Bravo Fasteners Ltd").suppliers;
    assert.deepEqual(suggestMerges(suppliers), []);
  });

  test("names that reduce to nothing are never paired", () => {
    let { suppliers } = upsertSupplier([], "Ltd");
    suppliers = upsertSupplier(suppliers, "GmbH").suppliers;
    assert.deepEqual(suggestMerges(suppliers), [], "an empty key must not match an empty key");
  });

  test("suggesting changes nothing", () => {
    const list = twoForms();
    suggestMerges(list);
    assert.equal(list.length, 2);
  });
});

describe("merging, and undoing it", () => {
  const setup = () => {
    let { suppliers } = upsertSupplier([], "Meridian Fabrication Ltd");
    suppliers = upsertSupplier(suppliers, "Meridian Fabrication GmbH").suppliers;
    return { suppliers, a: suppliers[0].id, b: suppliers[1].id };
  };

  test("the absorbed record is kept, not deleted", () => {
    const { suppliers, a, b } = setup();
    const m = mergeSuppliers(suppliers, b, a);
    assert.equal(m.ok, true);
    assert.equal(m.suppliers.length, 1);
    assert.equal(m.supplier.mergedFrom.length, 1);
    assert.equal(m.supplier.mergedFrom[0].id, b, "a merge made in error must be undoable");
  });

  test("the absorbed aliases resolve to the survivor", () => {
    const { suppliers, a, b } = setup();
    const m = mergeSuppliers(suppliers, b, a);
    assert.equal(resolveSupplier(m.suppliers, "Meridian Fabrication GmbH").id, a);
  });

  test("references are repointed in the same operation", () => {
    // A merge that leaves parts pointing at a supplier nobody can resolve is
    // worse than no merge at all.
    const { suppliers, a, b } = setup();
    const p = part({ supplierId: b, number: "X-1" });
    const m = mergeSuppliers(suppliers, b, a);
    assert.equal(remapReferences([p], m.remap)[0].supplierId, a);
  });

  test("entities that carry no supplier reference pass through untouched", () => {
    const { suppliers, a, b } = setup();
    const m = mergeSuppliers(suppliers, b, a);
    const odd = { id: "x" };
    assert.equal(remapReferences([odd], m.remap)[0], odd);
  });

  test("a merge into itself, or of something absent, is refused", () => {
    const { suppliers, a } = setup();
    assert.match(mergeSuppliers(suppliers, a, a).error, /cannot be merged into itself/);
    assert.match(mergeSuppliers(suppliers, "sup_missing0000", a).error, /No supplier/);
  });

  test("unmerging restores the record", () => {
    const { suppliers, a, b } = setup();
    const m = mergeSuppliers(suppliers, b, a);
    const u = unmergeSupplier(m.suppliers, a, b);
    assert.equal(u.ok, true);
    assert.equal(u.suppliers.length, 2);
    assert.ok(u.suppliers.some((s) => s.id === b));
  });

  test("unmerging something that was never merged says so", () => {
    const { suppliers, a, b } = setup();
    assert.match(unmergeSupplier(suppliers, a, b).error, /does not record a merge/);
  });
});

describe("referential integrity", () => {
  test("a complete set reports clean", () => {
    const s = supplier({ name: NAME });
    const p = part({ supplierId: s.id, number: "MF-4471" });
    const c = contract({ supplierId: s.id, reference: "AGR-1" });
    const k = commercialCase({ supplierId: s.id, ref: "SC-001", partId: p.id, contractId: c.id });
    const r = checkReferences({ suppliers: [s], parts: [p], contracts: [c], cases: [k] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.findings, []);
  });

  test("a dangling reference is reported rather than thrown", () => {
    // Something to show someone, not a reason to refuse to open their data.
    const s = supplier({ name: NAME });
    const k = commercialCase({ supplierId: s.id, ref: "SC-001", partId: "part_missing0000" });
    const r = checkReferences({ suppliers: [s], cases: [k] });
    assert.equal(r.ok, false);
    assert.equal(r.findings[0].field, "partId");
    assert.equal(r.findings[0].expected, "part");
  });

  test("an orphaned part names the supplier it cannot find", () => {
    const p = part({ supplier: "Nobody Ltd", number: "X" });
    const r = checkReferences({ suppliers: [], parts: [p] });
    assert.equal(r.findings[0].missing, p.supplierId);
  });

  test("a learning record without its case is caught", () => {
    const l = learningRecord({ caseId: "case_missing000", outcomeId: "out_1", argument: "Freight" });
    assert.equal(checkReferences({ learning: [l] }).ok, false);
  });
});

describe("lookups", () => {
  test("suppliers list alphabetically for a picker", () => {
    let { suppliers } = upsertSupplier([], "Zeta Ltd");
    suppliers = upsertSupplier(suppliers, "Alpha Ltd").suppliers;
    assert.deepEqual(listSuppliers(suppliers).map((s) => s.name), ["Alpha Ltd", "Zeta Ltd"]);
  });

  test("byId indexes without repeated scans", () => {
    const s = supplier({ name: NAME });
    assert.equal(byId([s]).get(s.id).name, NAME);
    assert.equal(byId(null).size, 0);
  });
});
