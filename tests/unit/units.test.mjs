/**
 * Units.
 *
 * The failures worth catching here are not arithmetic failures. They are
 * failures to notice that two numbers are not the same kind of thing: a
 * thickness in inches against a width in millimetres, a density in g/cm³
 * against a volume in mm³, or a number typed into a box with no unit at all.
 *
 * Every conversion this accepts is exact, and the test proves it rather than
 * asserting it — an inch is 25 400µm and a pound is 453 592 370µg, so a
 * round trip through the canonical integer returns the number entered.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  LENGTH_UNITS, MASS_UNITS, DENSITY_UNITS,
  length, mass, density, boxVolume, massOf,
  formatLength, formatMass, formatArea,
} from "../../src/calc/units.mjs";

describe("a number is not a measurement", () => {
  test("a missing unit is refused, not guessed", () => {
    assert.throws(() => length("50"), /no unit/);
    assert.throws(() => length("50", ""), /no unit/);
    assert.throws(() => length("50", null), /no unit/);
  });

  test("an unknown unit is refused, and says what it does know", () => {
    assert.throws(() => length("50", "furlong"), /not a unit this understands/);
    assert.throws(() => length("50", "furlong"), /mm/);
  });

  test("an empty value is not zero", () => {
    // The distinction the whole module exists for: nobody entered it.
    assert.throws(() => length("", "mm"), /is missing/);
    assert.throws(() => length(null, "mm"), /is missing/);
    assert.throws(() => length(undefined, "mm"), /is missing/);
  });

  test("a value that is not a plain decimal is refused", () => {
    assert.throws(() => length("1,200", "mm"), /not a plain decimal/);
    assert.throws(() => length("1.2e3", "mm"), /not a plain decimal/);
    assert.throws(() => length("about 50", "mm"), /not a plain decimal/);
  });

  test("a negative length is refused", () => {
    assert.throws(() => length("-5", "mm"), /cannot be negative/);
  });

  test("precision beyond the scale is refused rather than truncated", () => {
    assert.throws(() => length("1.0000000001", "mm"), /decimal places/);
  });
});

describe("every conversion is exact", () => {
  test("an inch is exactly 25 400 micrometres", () => {
    assert.equal(length("1", "in").um, 25_400n);
    assert.equal(length("2.5", "in").um, 63_500n);
  });

  test("a pound is exactly 453 592 370 micrograms", () => {
    assert.equal(mass("1", "lb").ug, 453_592_370n);
  });

  test("mixed units reach the same canonical integer", () => {
    // 25.4mm is one inch, and the two entries must be indistinguishable
    // afterwards — otherwise a plate entered in inches quietly costs more.
    assert.equal(length("25.4", "mm").um, length("1", "in").um);
    assert.equal(length("1000", "mm").um, length("1", "m").um);
    assert.equal(length("12", "in").um, length("1", "ft").um);
  });

  test("a round trip returns what was entered", () => {
    for (const [unit, value, dp] of [["mm", "1234.56", 2], ["in", "12.75", 2], ["m", "3.500", 3], ["cm", "45.25", 2]]) {
      assert.equal(formatLength(length(value, unit).um, unit, dp), value);
    }
    for (const [unit, value] of [["kg", "12.345"], ["g", "500.000"], ["lb", "2.205"]]) {
      assert.equal(formatMass(mass(value, unit).ug, unit, 3), value);
    }
  });

  test("the tables are all integers, which is what makes the above true", () => {
    for (const table of [LENGTH_UNITS, MASS_UNITS, DENSITY_UNITS]) {
      for (const [name, per] of Object.entries(table)) {
        assert.equal(typeof per, "bigint", `${name} is not an exact factor`);
        assert.ok(per > 0n);
      }
    }
  });

  test("a unit that cannot be represented exactly is not offered", () => {
    // A thou is 25.4µm. Rather than round it on the way in, it is absent.
    assert.equal("thou" in LENGTH_UNITS, false);
    assert.throws(() => length("10", "thou"), /not a unit this understands/);
  });
});

describe("density is a fact about a specification, not about a name", () => {
  test("it will not be built without a source", () => {
    assert.throws(() => density("7850", "kg/m3"), /needs a source/);
    assert.throws(() => density("7850", "kg/m3", "   "), /needs a source/);
  });

  test("kg per cubic metre and grams per cubic centimetre agree exactly", () => {
    const a = density("7850", "kg/m3", "datasheet");
    const b = density("7.85", "g/cm3", "datasheet");
    assert.equal(a.perMm3Scaled, b.perMm3Scaled);
  });

  test("a non-positive density is refused", () => {
    assert.throws(() => density("0", "kg/m3", "x"), /must be positive/);
  });

  test("an unknown density unit is refused", () => {
    assert.throws(() => density("0.28", "lb/in3", "x"), /not understood/);
  });

  test("the source is kept, because mass and cost rest on it", () => {
    assert.equal(density("2700", "kg/m3", "user-entered").source, "user-entered");
  });
});

describe("mass follows from geometry and density, once", () => {
  const steel = density("7.85", "g/cm3", "synthetic datasheet");

  test("a cubic metre of steel is 7 850kg", () => {
    const m = length("1", "m");
    assert.equal(formatMass(massOf(boxVolume(m, m, m), steel), "kg", 0), "7850");
  });

  test("a plate is the plate it was entered as, in either unit system", () => {
    // 500mm x 250mm x 10mm at 7.85 g/cm³ = 9.8125kg
    const inMm = boxVolume(length("500", "mm"), length("250", "mm"), length("10", "mm"));
    assert.equal(formatMass(massOf(inMm, steel), "kg", 4), "9.8125");
  });

  test("volume is a product, so it is not rounded at all", () => {
    const v = boxVolume(length("3", "mm"), length("7", "mm"), length("11", "mm"));
    assert.equal(v, 3_000n * 7_000n * 11_000n);
  });

  test("a negative volume is refused rather than producing a negative mass", () => {
    assert.throws(() => massOf(-1n, steel), /cannot be negative/);
  });
});

describe("rendering", () => {
  test("area renders in the unit asked for", () => {
    const a = length("2000", "mm").um * length("1000", "mm").um;
    assert.equal(formatArea(a, "m2", 2), "2.00");
    assert.equal(formatArea(a, "mm2", 0), "2000000");
  });

  test("an unknown display unit raises rather than printing the canonical integer", () => {
    assert.throws(() => formatLength(1000n, "furlong"), /Unknown length unit/);
    assert.throws(() => formatMass(1000n, "stone"), /Unknown mass unit/);
    assert.throws(() => formatArea(1000n, "acre"), /Unknown area unit/);
  });
});
