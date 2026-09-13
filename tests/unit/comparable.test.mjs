/**
 * Comparable parts.
 *
 * Two failures are guarded here, and the second is the subtle one.
 *
 * A similarity figure that cannot be taken apart is a number with a percent
 * sign, so every result must name what matched and what differed.
 *
 * And unknowns must not flatter. The tempting arithmetic — matched over total,
 * with unrecorded attributes quietly excluded — gives its highest scores to the
 * pairs nobody has described, which is exactly backwards.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  comparablePart, compare, findComparable, priceGap, ATTRIBUTES,
} from "../../src/calc/comparable.mjs";
import { moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";
import { formatPercent as P } from "../../src/calc/cost-bridge.mjs";

const gbp = (x) => moneyFromDecimal(x, "GBP");

const FULL = {
  material: "AL 6082", specification: "BS EN 573", process: "CNC milling", rawForm: "bar",
  tolerance: "IT9", heatTreatment: "T6", inspection: "AQL 2.5", certification: "3.1",
  sizeBand: "small", volumeBand: "50k", surfaceFinish: "anodised", geography: "UK",
};

const part = (ref, over = {}, rest = {}) =>
  comparablePart({ ref, attributes: { ...FULL, ...over }, ...rest });

describe("describing a part", () => {
  test("it needs a reference", () => {
    assert.throws(() => comparablePart({}), /needs a reference/);
    assert.throws(() => comparablePart({ ref: "  " }), /needs a reference/);
  });

  test("an attribute outside the model is refused", () => {
    assert.throws(() => comparablePart({ ref: "X", attributes: { colour: "blue" } }),
      /not a comparison attribute/);
  });

  test("values are compared on meaning, not typography", () => {
    const a = comparablePart({ ref: "A", attributes: { material: "AL-6082" } });
    const b = comparablePart({ ref: "B", attributes: { material: "  al 6082  " } });
    assert.equal(compare(a, b).matched.length, 1);
  });

  test("a blank attribute is absent rather than an empty match", () => {
    const a = comparablePart({ ref: "A", attributes: { material: "  ", process: "milling" } });
    assert.equal(a.attributes.material, undefined);
    assert.equal(a.describedWeight, 3);
  });

  test("a price must be Money", () => {
    assert.throws(() => comparablePart({ ref: "A", unitPrice: 12.4 }), /must be Money/);
  });
});

describe("comparing two parts", () => {
  test("it names what matched and what differed", () => {
    const c = compare(part("A"), part("B", { tolerance: "IT11", surfaceFinish: "mill" }));
    assert.deepEqual(c.differed.map((d) => d.id).sort(), ["surfaceFinish", "tolerance"]);
    assert.ok(c.matched.length >= 9);
    assert.match(c.statement, /Differs on tolerance class, surface finish/);
  });

  test("identical parts are fully comparable", () => {
    const c = compare(part("A"), part("B"));
    assert.equal(P(c.comparability), "100.00%");
    assert.deepEqual(c.differed, []);
  });

  test("weight matters: material differing costs more than finish differing", () => {
    const onFinish = compare(part("A"), part("B", { surfaceFinish: "mill" })).comparability;
    const onMaterial = compare(part("A"), part("C", { material: "steel" })).comparability;
    assert.ok(onMaterial < onFinish, "material is weighted above surface finish");
  });

  test("the weights are stated, so the ranking can be argued with", () => {
    const c = compare(part("A"), part("B", { material: "steel" }));
    assert.equal(c.differed[0].weight, 3);
    assert.equal(c.totalWeight, ATTRIBUTES.reduce((n, a) => n + a.weight, 0));
  });
});

describe("an unknown is not a match", () => {
  test("attributes nobody recorded are listed, not silently dropped", () => {
    const thin = comparablePart({ ref: "T", attributes: { material: "AL 6082" } });
    const c = compare(part("A"), thin);
    assert.equal(c.unknown.length, ATTRIBUTES.length - 1);
    assert.ok(c.unknown.every((u) => u.missingFrom === "T"));
  });

  test("it says which part is missing it, or both", () => {
    const a = comparablePart({ ref: "A", attributes: { material: "AL 6082" } });
    const b = comparablePart({ ref: "B", attributes: { process: "milling" } });
    const c = compare(a, b);
    assert.equal(c.unknown.find((u) => u.id === "process").missingFrom, "A");
    assert.equal(c.unknown.find((u) => u.id === "material").missingFrom, "B");
    assert.equal(c.unknown.find((u) => u.id === "tolerance").missingFrom, "both");
  });

  test("agreeing on two attributes out of twelve is not a strong match", () => {
    // The tempting arithmetic would call this 100% comparable.
    const thin = comparablePart({ ref: "T", attributes: { material: "AL 6082", process: "CNC milling" } });
    const c = compare(part("A"), thin);
    assert.equal(P(c.comparability), "100.00%", "of what could be checked, all of it matched");
    assert.equal(c.thin, true);
    assert.match(c.statement, /barely compared/);
    assert.ok(c.coverage < 500_000_000n, "under half the model was checkable");
  });

  test("coverage is reported beside comparability, never instead of it", () => {
    const c = compare(part("A"), part("B"));
    assert.equal(P(c.coverage), "100.00%");
    assert.equal(c.thin, false);
    assert.equal(/barely compared/.test(c.statement), false);
  });

  test("no shared attribute means nothing can be said", () => {
    const a = comparablePart({ ref: "A", attributes: { material: "AL 6082" } });
    const b = comparablePart({ ref: "B", attributes: { process: "milling" } });
    const c = compare(a, b);
    assert.equal(c.comparability, null, "0 of 0 is not 0%");
    assert.match(c.statement, /share no recorded attribute/);
  });
});

describe("finding comparables", () => {
  const target = part("TARGET");
  const pool = [
    part("NEAR", { surfaceFinish: "mill" }),
    part("FAR", { material: "steel", process: "casting", rawForm: "casting" }),
    comparablePart({ ref: "THIN", attributes: { material: "AL 6082" } }),
    target,
  ];

  test("the target is never its own comparable", () => {
    assert.equal(findComparable(target, pool).matches.some((m) => m.b === "TARGET"), false);
  });

  test("the closest is first", () => {
    assert.equal(findComparable(target, pool).best.b, "NEAR");
  });

  test("a thin match never outranks a well-described one at the same figure", () => {
    const t2 = part("T2");
    const exact = part("EXACT");
    const thin = comparablePart({ ref: "THIN2", attributes: { material: "AL 6082" } });
    const r = findComparable(t2, [thin, exact]);
    assert.equal(r.matches[0].b, "EXACT", "both are 100%; the described one is the real match");
  });

  test("a threshold filters rather than reorders", () => {
    const r = findComparable(target, pool, { minimum: 900_000_000n });
    assert.ok(r.matches.every((m) => m.comparability >= 900_000_000n));
    assert.equal(r.matches.some((m) => m.b === "FAR"), false);
  });

  test("nothing comparable says so rather than returning the least bad", () => {
    const r = findComparable(target, [], {});
    assert.equal(r.best, null);
    assert.match(r.note, /Nothing recorded is comparable enough/);
  });
});

describe("the price gap", () => {
  const a = part("A", {}, { unitPrice: gbp("12.40"), annualVolume: 50_000 });
  const b = part("B", { tolerance: "IT11" }, { unitPrice: gbp("9.80") });

  test("the raw gap is exact", () => {
    assert.equal(str(priceGap(a, b).gap), "2.60");
  });

  test("with nothing costed, the whole gap is unexplained", () => {
    const g = priceGap(a, b);
    assert.equal(str(g.unexplained), "2.60");
    assert.match(g.statement, /No differences have been costed/);
  });

  test("a stated adjustment reduces the remainder", () => {
    const g = priceGap(a, b, [
      { id: "tol", label: "tighter tolerance", amount: gbp("1.10"), basis: "quoted delta IT9 against IT11" },
    ]);
    assert.equal(str(g.explained), "1.10");
    assert.equal(str(g.unexplained), "1.50");
  });

  test("the remainder is annualised where a volume is known", () => {
    const g = priceGap(a, b, [{ id: "t", amount: gbp("1.10"), basis: "quoted delta" }]);
    assert.equal(str(g.unexplainedAnnual), "75000.00");
  });

  test("no volume means no annual figure rather than a guessed one", () => {
    const noVol = part("A2", {}, { unitPrice: gbp("12.40") });
    assert.equal(priceGap(noVol, b).unexplainedAnnual, null);
  });

  test("an adjustment without a basis is refused", () => {
    // An unexplained adjustment explains nothing.
    assert.throws(() => priceGap(a, b, [{ id: "x", amount: gbp("1.00") }]), /no basis/);
    assert.throws(() => priceGap(a, b, [{ id: "x", amount: gbp("1.00"), basis: "  " }]), /no basis/);
  });

  test("adjustments are labelled assumed, because they are somebody's estimate", () => {
    const g = priceGap(a, b, [{ id: "t", amount: gbp("1.10"), basis: "quoted delta" }]);
    assert.equal(g.adjustments[0].label_state, "assumed");
    assert.equal(g.adjustments[0].basis, "quoted delta");
  });

  test("it never says either part is overpriced", () => {
    const g = priceGap(a, b);
    for (const word of ["overpriced", "too expensive", "should be"]) {
      assert.equal(g.statement.includes(word), false, `the statement claims "${word}"`);
      assert.equal(g.method.includes(word), false);
    }
    assert.match(g.method, /not a finding that either part is mispriced/);
  });

  test("a part cheaper than its comparator reads as below, not as a saving", () => {
    const g = priceGap(b, a);
    assert.match(g.statement, /below/);
    assert.equal(/saving/.test(g.statement), false);
  });

  test("both parts need a price before a gap means anything", () => {
    assert.equal(priceGap(part("A3"), b).ok, false);
    assert.match(priceGap(part("A3"), b).reason, /need a unit price/);
  });

  test("currencies are never mixed", () => {
    const eur = part("E", {}, { unitPrice: moneyFromDecimal("9.80", "EUR") });
    assert.throws(() => priceGap(a, eur), /Cannot compare prices across currencies/);
    assert.throws(() => priceGap(a, b, [{ id: "x", amount: moneyFromDecimal("1.00", "EUR"), basis: "x" }]),
      /not GBP/);
  });

  test("every money value is exact BigInt minor units", () => {
    const g = priceGap(a, b, [{ id: "t", amount: gbp("1.10"), basis: "quoted delta" }]);
    for (const m of [g.gap, g.explained, g.unexplained, g.unexplainedAnnual]) {
      assert.equal(typeof m.minor, "bigint");
    }
  });
});

describe("a barely-compared pair never leads the ranking", () => {
  test("a two-attribute part does not outrank a genuine comparable", () => {
    // It scores 100% of what could be checked, every time. Ordering by
    // percentage alone puts the pair that deserves most scrutiny at the top,
    // where a reader trusts it most.
    const target = part("TARGET");
    const r = findComparable(target, [
      comparablePart({ ref: "THIN", attributes: { material: "AL 6082" } }),
      part("NEAR", { surfaceFinish: "mill" }),
    ]);
    assert.equal(r.best.b, "NEAR");
    assert.equal(r.matches.at(-1).b, "THIN");
    assert.equal(P(r.matches.at(-1).comparability), "100.00%", "it still scores 100%; it just does not lead");
  });

  test("thin matches are still returned, flagged, not hidden", () => {
    const r = findComparable(part("TARGET"), [comparablePart({ ref: "THIN", attributes: { material: "AL 6082" } })]);
    assert.equal(r.matches.length, 1);
    assert.equal(r.best.thin, true);
    assert.match(r.best.statement, /barely compared/);
  });

  test("among thin matches the better-described one still leads", () => {
    const r = findComparable(part("TARGET"), [
      comparablePart({ ref: "THINNER", attributes: { material: "AL 6082" } }),
      comparablePart({ ref: "THINNISH", attributes: { material: "AL 6082", process: "CNC milling", rawForm: "bar" } }),
    ]);
    assert.equal(r.best.b, "THINNISH");
  });
});
