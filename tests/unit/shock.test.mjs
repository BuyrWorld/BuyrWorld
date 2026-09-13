import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { shareFrom, mapExposure, costShock, parseAmount, MIX_TOLERANCE } from "../../src/calc/shock.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";
import { formatPercent as P } from "../../src/calc/cost-bridge.mjs";

const gbp = (x) => moneyFromDecimal(x, "GBP");

describe("shares are read exactly, or not at all", () => {
  test("a decimal, a percentage and a ratio all arrive at the same value", () => {
    assert.equal(shareFrom("0.42"), pc("42"));
    assert.equal(shareFrom("42%"), pc("42"));
    assert.equal(shareFrom(pc("42")), pc("42"));
  });

  test("anything unreadable is null, never zero", () => {
    // A zero would quietly remove a commodity from the exposure and look fine.
    for (const junk of ["", "abc", "0.4.2", "42%%", "--1", "£5", null, undefined]) {
      assert.equal(shareFrom(junk), null, `${JSON.stringify(junk)} should not parse`);
    }
  });

  test("precision beyond the scale is dropped rather than rounded into nonsense", () => {
    assert.equal(shareFrom("0.1234567891234"), shareFrom("0.123456789"));
  });

  test("no floating point is involved", () => {
    assert.equal(shareFrom("0.1") + shareFrom("0.2"), shareFrom("0.3"));
    assert.equal(0.1 + 0.2 === 0.3, false, "sanity: floats really do get this wrong");
  });

  test("the money parser is the one the spend analyser already uses", () => {
    assert.equal(parseAmount("£1,234.56"), 123456n);
    assert.equal(parseAmount("12abc"), null, "parseFloat would have said 12");
  });
});

describe("mapping spend onto commodities", () => {
  const categories = [
    { name: "Castings", value: gbp("400000.00") },
    { name: "Freight", value: gbp("100000.00") },
  ];
  const mix = {
    Castings: { Steel: "0.6", Energy: "0.4" },
    Freight: { Fuel: "0.7", Labour: "0.3" },
  };

  test("exposure is spend times share, exactly", () => {
    const m = mapExposure(categories, mix);
    const by = Object.fromEntries(m.exposure.map((e) => [e.name, str(e.value)]));
    assert.equal(by.Steel, "240000.00");
    assert.equal(by.Energy, "160000.00");
    assert.equal(by.Fuel, "70000.00");
    assert.equal(by.Labour, "30000.00");
  });

  test("a coherent mix conserves the total", () => {
    const m = mapExposure(categories, mix);
    const sum = m.exposure.reduce((a, e) => a + e.value.minor, 0n);
    assert.equal(sum, 500_000_00n);
  });

  test("each commodity carries its share, computed here and not by the page", () => {
    // A page that divides one Money by another is the bug this module removes.
    const m = mapExposure(categories, mix);
    const by = Object.fromEntries(m.exposure.map((e) => [e.name, P(e.share)]));
    assert.equal(by.Steel, "48.00%");    // 240,000 of 500,000
    assert.equal(by.Energy, "32.00%");
    assert.equal(by.Fuel, "14.00%");
    assert.equal(by.Labour, "6.00%");
  });

  test("the shares sum to the whole", () => {
    const m = mapExposure(categories, mix);
    assert.equal(m.exposure.reduce((a, e) => a + e.share, 0n), 1_000_000_000n);
  });

  test("the mapped total comes back as Money", () => {
    const m = mapExposure(categories, mix);
    assert.equal(str(m.total), "500000.00");
    assert.equal(m.total.currency, "GBP");
  });

  test("an empty mapping has no shares rather than dividing by zero", () => {
    const m = mapExposure([], {});
    assert.equal(str(m.total), "0.00");
  });

  test("commodities come back largest first", () => {
    const m = mapExposure(categories, mix);
    for (let i = 1; i < m.exposure.length; i++) {
      assert.ok(m.exposure[i - 1].value.minor >= m.exposure[i].value.minor);
    }
  });

  test("category matching ignores case but is never fuzzy", () => {
    const m = mapExposure([{ name: "CASTINGS", value: gbp("100.00") }], { castings: { Steel: "1" } });
    assert.equal(m.mappedCategories, 1);
    const n = mapExposure([{ name: "Casting", value: gbp("100.00") }], { Castings: { Steel: "1" } });
    assert.equal(n.mappedCategories, 0, "a near-miss landing on the wrong category would be invisible");
  });

  test("a category with no proposed mix is carried as unmapped, not dropped", () => {
    const m = mapExposure([...categories, { name: "Tooling", value: gbp("50000.00") }], mix);
    const un = m.exposure.find((e) => e.name === "Unmapped");
    assert.equal(str(un.value), "50000.00");
    assert.equal(m.unmappedCategories, 1);
    assert.equal(un.provenance, "supplied", "spend that was not estimated is not an assumption");
  });

  test("every mapped figure is labelled an assumption", () => {
    const m = mapExposure(categories, mix);
    for (const e of m.exposure) {
      if (e.name === "Unmapped") continue;
      assert.equal(e.provenance, "assumed");
    }
    assert.equal(m.label, "assumed");
    assert.match(m.note, /proposed, not measured/);
    assert.match(m.note, /replaced\s+with a supplier cost breakdown/);
  });
});

describe("a proposed mix has to add up", () => {
  test("shares that total more than 100% are reported, not normalised", () => {
    // 60% steel and 60% energy inflates the exposure by a fifth, and every
    // figure downstream is wrong in a way that looks entirely plausible.
    const m = mapExposure([{ name: "Castings", value: gbp("100000.00") }],
      { Castings: { Steel: "0.6", Energy: "0.6" } });
    assert.equal(m.coherent, false);
    assert.match(m.warnings[0], /totals 120\.00%, not 100%/);
    assert.match(m.warnings[0], /overstated/);
    const sum = m.exposure.reduce((a, e) => a + e.value.minor, 0n);
    assert.equal(sum, 120_000_00n, "normalising would hide that the model produced nonsense");
  });

  test("shares that fall short are reported as understated", () => {
    const m = mapExposure([{ name: "Castings", value: gbp("100000.00") }],
      { Castings: { Steel: "0.5" } });
    assert.equal(m.coherent, false);
    assert.match(m.warnings[0], /understated/);
  });

  test("a small rounding gap is tolerated rather than cried over", () => {
    const m = mapExposure([{ name: "Castings", value: gbp("100000.00") }],
      { Castings: { Steel: "0.3333", Energy: "0.3333", Other: "0.3334" } });
    assert.equal(m.coherent, true);
    assert.deepEqual(m.warnings, []);
  });

  test("the tolerance is a quarter of a point, not a free pass", () => {
    assert.equal(P(MIX_TOLERANCE), "0.25%");
    const m = mapExposure([{ name: "C", value: gbp("100.00") }], { C: { A: "0.5", B: "0.495" } });
    assert.equal(m.coherent, false, "half a point out is a real error");
  });

  test("an unreadable share is dropped and shows up in the total", () => {
    const m = mapExposure([{ name: "C", value: gbp("100.00") }], { C: { A: "0.5", B: "nonsense" } });
    assert.equal(m.coherent, false, "dropping it leaves the mix short, and that must be said");
  });
});

describe("applying a shock", () => {
  const lines = [
    { name: "Steel", exposure: gbp("240000.00"), shock: pc("10") },
    { name: "Energy", exposure: gbp("160000.00"), shock: pc("-5") },
  ];

  test("each impact is exposure times movement, exactly", () => {
    const r = costShock(lines);
    const by = Object.fromEntries(r.rows.map((x) => [x.name, str(x.impact)]));
    assert.equal(by.Steel, "24000.00");
    assert.equal(by.Energy, "-8000.00");
  });

  test("the total is the sum of the impacts", () => {
    const r = costShock(lines);
    assert.equal(str(r.totalImpact), "16000.00");
    assert.equal(r.rows.reduce((a, x) => a + x.impact.minor, 0n), r.totalImpact.minor);
  });

  test("the share of analysed spend is exact, not a toFixed", () => {
    const r = costShock(lines, { baseTotal: gbp("500000.00") });
    assert.equal(P(r.shareOfBase), "3.20%");
  });

  test("no base total means no share rather than a division by zero", () => {
    assert.equal(costShock(lines).shareOfBase, null);
    assert.equal(costShock(lines, { baseTotal: gbp("0.00") }).shareOfBase, null);
  });

  test("the biggest mover leads, by absolute impact", () => {
    const r = costShock([
      { name: "Small", exposure: gbp("1000.00"), shock: pc("10") },
      { name: "Big fall", exposure: gbp("100000.00"), shock: pc("-10") },
    ]);
    assert.equal(r.rows[0].name, "Big fall", "a large decrease is as actionable as a large increase");
  });

  test("lines that were not moved are left out entirely", () => {
    const r = costShock([...lines, { name: "Untouched", exposure: gbp("999999.00"), shock: 0n }]);
    assert.equal(r.linesMoved, 2);
    assert.equal(r.rows.some((x) => x.name === "Untouched"), false);
  });

  test("moving nothing is an explicit refusal, not a zero", () => {
    const r = costShock([{ name: "Steel", exposure: gbp("100.00"), shock: 0n }]);
    assert.equal(r.ok, false);
    assert.match(r.reason, /no shock to model/);
    assert.deepEqual(r.rows, []);
  });

  test("the direction is stated so the reading is not left to a colour", () => {
    assert.equal(costShock(lines).direction, "increase");
    assert.equal(costShock([{ name: "E", exposure: gbp("100.00"), shock: pc("-5") }]).direction, "decrease");
  });

  test("it says what it is and is not", () => {
    assert.match(costShock(lines).method, /not a forecast of either/);
    assert.equal(costShock(lines).label, "assumed");
  });
});

describe("currencies are never mixed", () => {
  test("mapping across two currencies raises rather than adding them", () => {
    assert.throws(() => mapExposure([
      { name: "A", value: gbp("100.00") },
      { name: "B", value: moneyFromDecimal("100.00", "EUR") },
    ], { A: { X: "1" }, B: { X: "1" } }), /Cannot model a shock across currencies/);
  });

  test("totalling across two currencies raises too", () => {
    assert.throws(() => costShock([
      { name: "A", exposure: gbp("100.00"), shock: pc("5") },
      { name: "B", exposure: moneyFromDecimal("100.00", "EUR"), shock: pc("5") },
    ]), /Cannot total a shock across currencies/);
  });
});

describe("bad input", () => {
  test("no categories is an empty mapping, not a throw", () => {
    const m = mapExposure([], {});
    assert.deepEqual(m.exposure, []);
    assert.equal(m.coherent, true);
  });

  test("a category with no money is skipped", () => {
    const m = mapExposure([{ name: "A" }, { name: "B", value: gbp("100.00") }], { B: { X: "1" } });
    assert.equal(m.mappedCategories, 1);
  });

  test("nothing at all is handled", () => {
    assert.equal(mapExposure(null, null).exposure.length, 0);
    assert.equal(costShock(null).ok, false);
  });

  test("every money value is exact BigInt minor units", () => {
    const r = costShock([{ name: "Steel", exposure: gbp("240000.00"), shock: pc("10") }],
      { baseTotal: gbp("500000.00") });
    for (const row of r.rows) {
      assert.equal(typeof row.impact.minor, "bigint");
      assert.equal(typeof row.exposure.minor, "bigint");
    }
    assert.equal(typeof r.totalImpact.minor, "bigint");
  });
});
