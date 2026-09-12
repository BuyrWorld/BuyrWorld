import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ONE, SCALE, scaleDiv, ratioFromPercent, ratioFromDecimalString, ratioMul,
  ratioToPercentString, money, moneyFromDecimal, moneyAdd, moneySub, moneyScale,
  moneyApplyChange, moneyTimesQuantity, moneyToDecimalString, assertSameCurrency,
} from "../../src/calc/exact.mjs";

describe("exact arithmetic", () => {
  test("the float problem does not exist here", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754. It must here.
    assert.equal(0.1 + 0.2 === 0.3, false, "sanity: floats really are broken");
    const a = ratioFromDecimalString("0.1");
    const b = ratioFromDecimalString("0.2");
    assert.equal(a + b, ratioFromDecimalString("0.3"));
  });

  test("percentages convert exactly", () => {
    assert.equal(ratioFromPercent("4.5"), 45_000_000n);
    assert.equal(ratioFromPercent("100"), ONE);
    assert.equal(ratioFromPercent("0"), 0n);
    assert.equal(ratioFromPercent("-2.75"), -27_500_000n);
  });

  test("rejects input that would silently lose precision", () => {
    assert.throws(() => ratioFromDecimalString("0.0000000001"), RangeError);
    assert.throws(() => ratioFromDecimalString("4.5e-2"), RangeError);
    assert.throws(() => ratioFromDecimalString("abc"), RangeError);
  });

  test("ratio multiplication", () => {
    // 42% weight x 10% movement = 4.2% contribution
    assert.equal(ratioMul(ratioFromPercent("42"), ratioFromPercent("10")), ratioFromPercent("4.2"));
  });

  test("rounding is half-up away from zero", () => {
    assert.equal(scaleDiv(5n, 2n), 3n);      // 2.5 -> 3
    assert.equal(scaleDiv(-5n, 2n), -3n);    // -2.5 -> -3
    assert.equal(scaleDiv(4n, 2n), 2n);
    assert.equal(scaleDiv(1n, 3n), 0n);
    assert.equal(scaleDiv(2n, 3n), 1n);
  });

  test("division by zero is an error, not Infinity", () => {
    assert.throws(() => scaleDiv(1n, 0n), RangeError);
  });
});

describe("money", () => {
  test("parses and renders 2dp exactly", () => {
    assert.equal(moneyToDecimalString(moneyFromDecimal("12.34", "GBP")), "12.34");
    assert.equal(moneyToDecimalString(moneyFromDecimal("12.3", "GBP")), "12.30");
    assert.equal(moneyToDecimalString(moneyFromDecimal("12", "GBP")), "12.00");
    assert.equal(moneyToDecimalString(moneyFromDecimal("-0.05", "GBP")), "-0.05");
  });

  test("rejects more than 2dp rather than rounding silently", () => {
    assert.throws(() => moneyFromDecimal("12.345", "GBP"), RangeError);
  });

  test("rejects a non-ISO currency", () => {
    assert.throws(() => moneyFromDecimal("1.00", "quid"), RangeError);
  });

  test("refuses to mix currencies", () => {
    const gbp = moneyFromDecimal("10.00", "GBP");
    const eur = moneyFromDecimal("10.00", "EUR");
    assert.throws(() => moneyAdd(gbp, eur), /across currencies/);
    assert.throws(() => moneySub(gbp, eur), /across currencies/);
    assert.throws(() => assertSameCurrency(gbp, eur), /dated FX rate/);
  });

  test("applying a change", () => {
    const p = moneyFromDecimal("100.00", "GBP");
    assert.equal(moneyToDecimalString(moneyApplyChange(p, ratioFromPercent("4.5"))), "104.50");
    assert.equal(moneyToDecimalString(moneyApplyChange(p, ratioFromPercent("-10"))), "90.00");
    assert.equal(moneyToDecimalString(moneyApplyChange(p, 0n)), "100.00");
  });

  test("a half-penny rounds up, once, at the named point", () => {
    // 0.015 x 100.00 = 1.50 exactly; 1.005 would be the classic float failure
    const p = moneyFromDecimal("10.05", "GBP");
    assert.equal(moneyToDecimalString(moneyScale(p, ratioFromPercent("50"))), "5.03"); // 5.025 -> 5.03
  });

  test("quantity multiplication is exact for large volumes", () => {
    const unitDelta = moneyFromDecimal("0.07", "GBP");
    const total = moneyTimesQuantity(unitDelta, 1_250_000);
    assert.equal(moneyToDecimalString(total), "87500.00");
  });

  test("percent formatting", () => {
    assert.equal(ratioToPercentString(ratioFromPercent("4.5")), "4.50%");
  });
});
