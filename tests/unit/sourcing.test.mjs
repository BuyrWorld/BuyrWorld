/**
 * Bid normalisation.
 *
 * The failure guarded here is a comparison that looks decisive and is about
 * nothing: three quotes sorted by unit price when one is EXW, one includes
 * tooling, and one wants five times the minimum order.
 *
 * So the tests mostly check that differences survive the comparison rather than
 * being flattened into it, and that nothing gets called the best supplier.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { pageSource } from "../helpers/page.mjs";
import { quote, compareQuotes, questionsFor, SCOPE } from "../../src/calc/sourcing.mjs";
import { fxRate } from "../../src/calc/fx.mjs";
import { moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";
import { readFileSync } from "node:fs";

const gbp = (x) => moneyFromDecimal(x, "GBP");
const eur = (x) => moneyFromDecimal(x, "EUR");

/** Same scope on both, so only price differs. */
const clean = (supplier, price, over = {}) => quote({
  supplier, unitPrice: gbp(price), quantity: 50_000,
  incoterm: "DDP", moq: 1000, leadTimeWeeks: 6, paymentTermsDays: 60, validityDays: 30, ...over,
});

describe("a quote", () => {
  test("it needs a supplier and a Money price", () => {
    assert.throws(() => quote({ unitPrice: gbp("1.00") }), /needs a supplier/);
    assert.throws(() => quote({ supplier: "A" }), /needs a unit price as Money/);
    assert.throws(() => quote({ supplier: "A", unitPrice: 12.4 }), /as Money/);
  });

  test("a number that is not whole is not stored as one", () => {
    assert.equal(quote({ supplier: "A", unitPrice: gbp("1.00"), moq: 1000.5 }).moq, null);
  });

  test("a blank field is null rather than an empty string", () => {
    assert.equal(quote({ supplier: "A", unitPrice: gbp("1.00"), incoterm: "  " }).incoterm, null);
  });
});

describe("it refuses to compare what cannot be compared", () => {
  test("one quote is not a comparison", () => {
    const r = compareQuotes([clean("Alpha", "12.40")]);
    assert.equal(r.ok, false);
    assert.match(r.reason, /Two quotes are the smallest comparison/);
  });

  test("a foreign currency without a dated rate stops it", () => {
    // A comparison resting on a guessed rate is a comparison of nothing.
    const b = quote({ supplier: "Bravo", unitPrice: eur("13.00"), quantity: 50_000 });
    const r = compareQuotes([clean("Alpha", "12.40"), b]);
    assert.equal(r.ok, false);
    assert.equal(r.missingRate, "EUR");
    assert.match(r.reason, /no dated rate was supplied/);
  });

  test("with a dated, sourced rate it converts", () => {
    const b = quote({ supplier: "Bravo", unitPrice: eur("13.00"), quantity: 50_000,
      incoterm: "DDP", moq: 1000, leadTimeWeeks: 6, paymentTermsDays: 60, validityDays: 30 });
    const rate = fxRate({ from: "EUR", to: "GBP", rate: "0.8500", asOf: "2026-09", source: "ECB reference" });
    const r = compareQuotes([clean("Alpha", "12.40"), b], { quantity: 50_000, rates: { EUR: rate } });
    assert.equal(r.ok, true);
    const bravo = r.rows.find((x) => x.supplier === "Bravo");
    assert.equal(str(bravo.headline), "11.05");
    assert.equal(bravo.convertedFrom.currency, "EUR");
  });
});

describe("differences survive the comparison", () => {
  const alpha = clean("Alpha", "12.40", { incoterm: "EXW", moq: 5000, leadTimeWeeks: 10 });
  const bravo = clean("Bravo", "12.65");
  const r = compareQuotes([alpha, bravo], { quantity: 50_000 });

  test("each scope difference is listed, with why it matters", () => {
    const ids = r.unpriced.map((u) => u.id);
    assert.ok(ids.includes("incoterm"));
    assert.ok(ids.includes("moq"));
    assert.ok(ids.includes("leadTimeWeeks"));
    for (const u of r.unpriced) assert.ok(u.why.length > 20, `${u.id} has no explanation`);
  });

  test("it says which supplier holds which value", () => {
    const inco = r.unpriced.find((u) => u.id === "incoterm");
    const exw = inco.values.find((v) => v.value === "EXW");
    assert.deepEqual(exw.suppliers, ["Alpha"]);
  });

  test("an Incoterm is never converted into freight", () => {
    // The freight from Rotterdam is a fact about a shipment, not about a word.
    for (const row of r.rows) assert.deepEqual(row.adjustments, []);
    assert.equal(r.rankingSafe, false);
  });

  test("identical scope leaves nothing unpriced", () => {
    const q = compareQuotes([clean("Alpha", "12.40"), clean("Bravo", "12.65")], { quantity: 50_000 });
    assert.deepEqual(q.unpriced, []);
    assert.equal(q.rankingSafe, true);
  });

  test("every scope field is checked", () => {
    assert.ok(SCOPE.length >= 6);
    for (const f of SCOPE) assert.ok(f.id && f.label && f.why);
  });
});

describe("tooling is arithmetic, not an assumption", () => {
  test("it is spread over the volume actually stated", () => {
    const a = clean("Alpha", "12.40", { toolingCost: gbp("20000.00") });
    const r = compareQuotes([a, clean("Bravo", "12.65")], { quantity: 50_000 });
    const alpha = r.rows.find((x) => x.supplier === "Alpha");
    assert.equal(str(alpha.toolingPerUnit), "0.40");       // £20,000 over 50,000
    assert.equal(alpha.toolingSpreadOver, 50_000);
    assert.equal(str(alpha.landed), "12.80");
  });

  test("and it can reverse the ranking, which is the point", () => {
    const a = clean("Alpha", "12.40", { toolingCost: gbp("20000.00") });
    const r = compareQuotes([a, clean("Bravo", "12.65")], { quantity: 50_000 });
    assert.equal(r.lowestHeadline, "Alpha");
    assert.equal(r.lowestCosted, "Bravo");
    assert.equal(r.orderChangedByCosting, true);
    assert.match(r.statement, /Once tooling and the costed differences are included, Bravo is lowest instead/);
  });

  test("with no volume to spread it over it stays an unpriced difference", () => {
    const a = quote({ supplier: "Alpha", unitPrice: gbp("12.40"), toolingCost: gbp("20000.00") });
    const b = quote({ supplier: "Bravo", unitPrice: gbp("12.65") });
    const r = compareQuotes([a, b]);
    assert.ok(r.unpriced.some((u) => u.id === "toolingCost"));
    assert.equal(str(r.rows.find((x) => x.supplier === "Alpha").landed), "12.40");
  });
});

describe("adjustments are supplied, never inferred", () => {
  const a = clean("Alpha", "12.40", { incoterm: "EXW" });
  const b = clean("Bravo", "12.65");

  test("a costed difference moves the landed price", () => {
    const r = compareQuotes([a, b], {
      quantity: 50_000,
      adjustments: [{ supplier: "Alpha", id: "freight", label: "freight to site",
                      amount: gbp("0.35"), basis: "quoted by the forwarder for this lane" }],
    });
    assert.equal(str(r.rows.find((x) => x.supplier === "Alpha").landed), "12.75");
  });

  test("one without a basis is refused", () => {
    assert.throws(() => compareQuotes([a, b], {
      adjustments: [{ supplier: "Alpha", id: "freight", amount: gbp("0.35") }],
    }), /no basis/);
  });

  test("one in the wrong currency is refused", () => {
    assert.throws(() => compareQuotes([a, b], {
      adjustments: [{ supplier: "Alpha", id: "f", amount: eur("0.35"), basis: "x" }],
    }), /not GBP/);
  });

  test("each carries its basis through to the result", () => {
    const r = compareQuotes([a, b], {
      adjustments: [{ supplier: "Alpha", id: "freight", amount: gbp("0.35"), basis: "forwarder quote" }],
    });
    const adj = r.rows.find((x) => x.supplier === "Alpha").adjustments[0];
    assert.equal(adj.basis, "forwarder quote");
    assert.equal(adj.state, "supplied");
  });
});

describe("the ranking says how far it can be trusted", () => {
  test("while anything is uncosted, the gap is not a ranking", () => {
    const r = compareQuotes([clean("Alpha", "12.40", { incoterm: "EXW" }), clean("Bravo", "12.65")], { quantity: 50_000 });
    assert.equal(r.rankingSafe, false);
    assert.match(r.statement, /so that gap is not a ranking/);
  });

  test("with nothing left uncosted the gap is stated plainly, per unit and per year", () => {
    const r = compareQuotes([clean("Alpha", "12.40"), clean("Bravo", "12.65")], { quantity: 50_000 });
    assert.equal(r.rankingSafe, true);
    assert.equal(str(r.gap), "0.25");
    assert.equal(str(r.annualGap), "12500.00");
    assert.match(r.statement, /GBP 12500\.00 across 50000 units/);
  });

  test("no quantity means no annual figure rather than a guessed one", () => {
    const a = quote({ supplier: "Alpha", unitPrice: gbp("12.40"), incoterm: "DDP", moq: 1, leadTimeWeeks: 1, paymentTermsDays: 1, validityDays: 1 });
    const b = quote({ supplier: "Bravo", unitPrice: gbp("12.65"), incoterm: "DDP", moq: 1, leadTimeWeeks: 1, paymentTermsDays: 1, validityDays: 1 });
    assert.equal(compareQuotes([a, b]).annualGap, null);
  });
});

describe("it never names a winner", () => {
  const r = compareQuotes([clean("Alpha", "12.40"), clean("Bravo", "12.65")], { quantity: 50_000 });

  test("the phrase is lowest headline price, not best supplier", () => {
    assert.match(r.statement, /lowest headline price/);
    for (const word of ["best supplier", "recommend", "should award", "winner"]) {
      assert.equal(r.statement.toLowerCase().includes(word), false, `the statement says "${word}"`);
    }
  });

  test("the method says why it will not", () => {
    assert.match(r.method, /No supplier is recommended/);
    assert.match(r.method, /technical, quality and risk judgement this does not have/);
  });

  test("the two rankings are kept apart", () => {
    assert.ok(Array.isArray(r.byHeadline) && Array.isArray(r.byLanded));
    assert.match(r.method, /Two rankings, kept apart/);
  });
});

describe("what to ask before it means anything", () => {
  test("a field nobody stated becomes a question naming who to ask", () => {
    const a = clean("Alpha", "12.40", { incoterm: null });
    const q = questionsFor(compareQuotes([a, clean("Bravo", "12.65")], { quantity: 50_000 }));
    const inco = q.find((x) => x.field === "Incoterm");
    assert.ok(inco);
    assert.match(inco.question, /Ask Alpha for the Incoterm/);
  });

  test("a field stated differently becomes a costing task", () => {
    const q = questionsFor(compareQuotes(
      [clean("Alpha", "12.40", { incoterm: "EXW" }), clean("Bravo", "12.65")], { quantity: 50_000 }));
    assert.ok(q.some((x) => /Cost the Incoterm difference/.test(x.question)));
  });

  test("a complete comparison asks nothing", () => {
    const q = questionsFor(compareQuotes([clean("Alpha", "12.40"), clean("Bravo", "12.65")], { quantity: 50_000 }));
    assert.deepEqual(q, []);
  });

  test("a failed comparison asks nothing rather than throwing", () => {
    assert.deepEqual(questionsFor({ ok: false }), []);
    assert.deepEqual(questionsFor(null), []);
  });
});

describe("money stays exact", () => {
  test("every figure is BigInt minor units", () => {
    const r = compareQuotes([clean("Alpha", "12.40", { toolingCost: gbp("20000.00") }), clean("Bravo", "12.65")],
      { quantity: 50_000 });
    for (const row of r.rows) {
      assert.equal(typeof row.headline.minor, "bigint");
      assert.equal(typeof row.landed.minor, "bigint");
    }
    assert.equal(typeof r.gap.minor, "bigint");
    assert.equal(typeof r.annualGap.minor, "bigint");
  });
});

describe("the normalisation panel is wired", () => {
  const html = pageSource();
  const fnSource = (name) => {
    const start = html.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`${name} not found`);
    const end = html.indexOf("\nfunction ", start + 1);
    return html.slice(start, end < 0 ? html.length : end);
  };

  test("the engine is imported and mounted", () => {
    assert.match(html, /from "\.\/src\/calc\/sourcing\.mjs"/);
    const mount = (html.match(/window\.BW\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
    for (const name of ["makeQuote", "compareQuotes", "questionsFor"]) {
      assert.match(mount, new RegExp(name), `${name} is not exposed`);
    }
  });

  test("it sits beneath the existing comparator rather than replacing it", () => {
    // The prose tool reads documents; this compares figures. Different halves.
    assert.ok(html.indexOf('id="q-out"') < html.indexOf('id="qn-list"'));
    assert.match(html, /id="tool-quotes"/);
    assert.match(html, /data-do="runComparator"/);
  });

  test("it binds when the page is opened", () => {
    assert.match(html, /p==="tool-quotes"&&typeof qnBind==="function"/);
  });

  test("prices are parsed exactly, never through a float", () => {
    const fn = fnSource("qnRun");
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.equal(/parseFloat|toFixed/.test(code), false);
    assert.match(fn, /window\.BW\.parseAmount/);
  });

  test("the page computes no comparison of its own", () => {
    const fn = fnSource("qnRun");
    assert.match(fn, /window\.BW\.compareQuotes/);
    assert.equal(/\*\s*100|\/\s*100/.test(fn), false);
  });

  test("every capture field is named for a screen reader", () => {
    const fn = fnSource("qnRow");
    assert.match(fn, /aria-label="'\+attrEsc\(label\)\+'"/);
  });

  test("eight fields per quote, none of them an inline handler", () => {
    const fn = fnSource("qnRow");
    assert.equal(/\son(input|change|click)=/.test(fn), false);
    assert.match(fnSource("qnRender"), /host\.addEventListener\("input",sync\)/);
  });

  test("the page says nothing is estimated and no supplier is recommended", () => {
    assert.match(html, /nothing is estimated into money/);
    assert.match(html, /no supplier is recommended/);
  });

  test("an unsafe ranking is chipped as such", () => {
    const fn = fnSource("qnRun");
    assert.match(fn, /bw-status--high">ranking not safe/);
    assert.match(fn, /bw-status--evidenced">ranking complete/);
  });
});
