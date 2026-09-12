import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  fxRate, convertMoney, rateMovement, decomposeCurrencyEffect, detectCurrencyDoubleCount,
} from "../../src/calc/fx.mjs";
import { costBridge, formatPercent as P } from "../../src/calc/cost-bridge.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";

const eur = (x) => moneyFromDecimal(x, "EUR");
const BASE = fxRate({ from: "EUR", to: "GBP", rate: "0.8500", asOf: "2025-01", source: "synthetic-fx" });
const NOW  = fxRate({ from: "EUR", to: "GBP", rate: "0.8800", asOf: "2026-06", source: "synthetic-fx" });

describe("a rate is evidence, or it is not usable", () => {
  test("a rate without a date is refused", () => {
    assert.throws(() => fxRate({ from: "EUR", to: "GBP", rate: "0.85", source: "x" }),
      /without a date is not evidence/);
  });

  test("a rate without a source is refused", () => {
    assert.throws(() => fxRate({ from: "EUR", to: "GBP", rate: "0.85", asOf: "2025-01" }),
      /without a source is not evidence/);
  });

  test("nonsense currencies are refused", () => {
    assert.throws(() => fxRate({ from: "euro", to: "GBP", rate: "0.85", asOf: "2025-01", source: "x" }), /Not an ISO currency/);
    assert.throws(() => fxRate({ from: "EUR", to: "EUR", rate: "1", asOf: "2025-01", source: "x" }), /to itself is meaningless/);
  });

  test("a non-positive rate is refused", () => {
    assert.throws(() => fxRate({ from: "EUR", to: "GBP", rate: "0", asOf: "2025-01", source: "x" }), /must be positive/);
  });
});

describe("conversion is explicit or it does not happen", () => {
  test("converts with a matching rate", () => {
    assert.equal(str(convertMoney(eur("100.00"), BASE)), "85.00");
  });

  test("refuses a rate that does not match the amount's currency", () => {
    assert.throws(() => convertMoney(moneyFromDecimal("100.00", "USD"), BASE),
      /Cannot convert USD with a EUR->GBP rate/);
  });

  test("carries the rate's date onto the result", () => {
    assert.equal(convertMoney(eur("100.00"), NOW).asOf, "2026-06");
  });

  test("rate movement is reported as a ratio", () => {
    assert.equal(P(rateMovement(BASE, NOW)), "3.53%");   // 0.85 -> 0.88
  });

  test("incomparable rate pairs are refused", () => {
    const usd = fxRate({ from: "USD", to: "GBP", rate: "0.79", asOf: "2026-06", source: "x" });
    assert.throws(() => rateMovement(BASE, usd), /not comparable/);
  });
});

describe("currency and cost are separated", () => {
  const d = decomposeCurrencyEffect({
    unitPrice: eur("50.00"), priceChange: pc("9"),
    baseRate: BASE, measureRate: NOW, annualVolume: 20_000,
  });

  test("the parts sum exactly to the total", () => {
    const sum = d.costEffect.minor + d.fxEffect.minor + d.crossTerm.minor;
    assert.equal(sum, d.totalChange.minor, "a decomposition whose parts do not add up is worthless");
  });

  test("each part is the right figure", () => {
    assert.equal(str(d.oldBuyerValue), "850000.00");   // 50 x 20,000 x 0.85
    assert.equal(str(d.newBuyerValue), "959200.00");   // 54.50 x 20,000 x 0.88
    assert.equal(str(d.totalChange), "109200.00");
    assert.equal(str(d.costEffect), "76500.00");       // the 9% at the OLD rate
    assert.equal(str(d.fxEffect), "30000.00");         // old value at the new rate
    assert.equal(str(d.crossTerm), "2700.00");         // the interaction
  });

  test("the FX share is material and would otherwise hide inside the cost case", () => {
    // 30,000 of a 109,200 increase has nothing to do with the supplier's costs.
    const fxShare = (Number(d.fxEffect.minor) / Number(d.totalChange.minor)) * 100;
    assert.ok(fxShare > 27 && fxShare < 28, `FX is ${fxShare.toFixed(1)}% of the increase`);
  });

  test("result is in the buyer's currency, dated, and carries its lineage", () => {
    assert.equal(d.currency, "GBP");
    assert.equal(d.supplierCurrency, "EUR");
    assert.match(d.lineage, /0\.8500 at 2025-01/);
    assert.match(d.lineage, /0\.8800 at 2026-06/);
    assert.match(d.method, /sum to the total/);
  });

  test("a falling rate produces a negative FX effect", () => {
    const weaker = fxRate({ from: "EUR", to: "GBP", rate: "0.8200", asOf: "2026-06", source: "synthetic-fx" });
    const f = decomposeCurrencyEffect({
      unitPrice: eur("50.00"), priceChange: pc("9"),
      baseRate: BASE, measureRate: weaker, annualVolume: 20_000,
    });
    assert.ok(f.fxEffect.minor < 0n, "a weaker supplier currency reduces the buyer's cost");
    const sum = f.costEffect.minor + f.fxEffect.minor + f.crossTerm.minor;
    assert.equal(sum, f.totalChange.minor);
  });

  test("no price change at all still shows the currency effect", () => {
    const f = decomposeCurrencyEffect({
      unitPrice: eur("50.00"), priceChange: 0n,
      baseRate: BASE, measureRate: NOW, annualVolume: 20_000,
    });
    assert.equal(str(f.costEffect), "0.00");
    assert.equal(str(f.crossTerm), "0.00");
    assert.equal(str(f.fxEffect), "30000.00", "the buyer pays more without any cost changing");
  });

  test("a baseline in the wrong currency is refused", () => {
    assert.throws(() => decomposeCurrencyEffect({
      unitPrice: moneyFromDecimal("50.00", "GBP"), priceChange: pc("9"),
      baseRate: BASE, measureRate: NOW, annualVolume: 20_000,
    }), /must be stated in the supplier's currency/);
  });
});

describe("double counting is caught", () => {
  test("a currency driver alongside a conversion is refused", () => {
    assert.throws(() => costBridge({
      baseline: { unitPrice: eur("50.00"), annualVolume: 20_000 },
      requestedChange: pc("9"),
      drivers: [
        { id: "material", label: "Steel", weight: pc("45"), indexMovement: pc("10") },
        { id: "currency", label: "Currency movement", weight: pc("10"), indexMovement: pc("3.53") },
      ],
      fx: { baseRate: BASE, measureRate: NOW },
    }), /counts the exchange movement twice/);
  });

  test("it is detected by explicit flag, id or label", () => {
    const byFlag = [{ id: "x", label: "Something", isCurrency: true }];
    const byId = [{ id: "fx-effect", label: "Something" }];
    const byLabel = [{ id: "z", label: "Exchange rate impact" }];
    for (const ds of [byFlag, byId, byLabel]) {
      assert.notEqual(detectCurrencyDoubleCount(ds, true), null);
    }
  });

  test("a currency driver is fine when no conversion is configured", () => {
    // Priced in one currency throughout: the supplier's own FX exposure may
    // legitimately be a cost driver.
    assert.equal(detectCurrencyDoubleCount([{ id: "currency", label: "FX" }], false), null);
    const r = costBridge({
      baseline: { unitPrice: moneyFromDecimal("50.00", "GBP"), annualVolume: 20_000 },
      requestedChange: pc("9"),
      drivers: [{ id: "currency", label: "Currency movement", weight: pc("10"), indexMovement: pc("3.53") }],
    });
    assert.equal(P(r.warrantedChange), "0.35%");
  });
});

describe("the bridge reports currency alongside cost", () => {
  const r = costBridge({
    baseline: { unitPrice: eur("50.00"), annualVolume: 20_000 },
    requestedChange: pc("9"),
    drivers: [{ id: "material", label: "Steel", weight: pc("45"), indexMovement: pc("10") }],
    fx: { baseRate: BASE, measureRate: NOW },
  });

  test("the cost argument is unaffected by the rate", () => {
    assert.equal(P(r.warrantedChange), "4.50%", "45% x 10%, and nothing to do with FX");
  });

  test("an assumption states the currency split in money", () => {
    const note = r.assumptions.find((a) => a.id === "currency-effect");
    assert.ok(note);
    assert.match(note.text, /GBP 30000\.00 is exchange-rate movement/);
    assert.match(note.text, /3\.53%/);
    assert.match(note.text, /0\.8500 at 2025-01/);
  });

  test("a decomposition without both rates is refused", () => {
    assert.throws(() => costBridge({
      baseline: { unitPrice: eur("50.00"), annualVolume: 20_000 },
      requestedChange: pc("9"),
      drivers: [{ id: "m", label: "Steel", weight: pc("45"), indexMovement: pc("10") }],
      fx: { baseRate: BASE },
    }), /needs both a baseRate and a measureRate/);
  });

  test("no fx input means no currency block, and no change in behaviour", () => {
    const plain = costBridge({
      baseline: { unitPrice: eur("50.00"), annualVolume: 20_000 },
      requestedChange: pc("9"),
      drivers: [{ id: "m", label: "Steel", weight: pc("45"), indexMovement: pc("10") }],
    });
    assert.equal(plain.currency, null);
    assert.equal(plain.warrantedChange, r.warrantedChange);
  });
});
