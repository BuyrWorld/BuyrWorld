import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseSpendCsv, analyseSpend, indicativeSavings } from "../../src/calc/spend.mjs";
import { moneyToDecimalString as str } from "../../src/calc/exact.mjs";
import { formatPercent as P } from "../../src/calc/cost-bridge.mjs";

const CSV =
  "Supplier,Category,Amount\n" +
  "Alpha Castings Ltd,Castings,420000\n" +
  "Bravo Fasteners Ltd,Fasteners,180000\n" +
  "Charlie Coatings,Finishing,95000\n" +
  "Delta Tooling,Tooling,64000\n" +
  "Echo Logistics,Freight,31000\n" +
  "Foxtrot Supplies,Consumables,4200\n" +
  "Golf Print,Consumables,3100\n" +
  "Hotel Safety,PPE,2400\n" +
  "India Cleaning,Facilities,1900\n";

const run = (csv = CSV) => analyseSpend(parseSpendCsv(csv));

describe("amounts are parsed exactly, or not at all", () => {
  test("currency symbols and separators are stripped", () => {
    assert.equal(parseAmount("£1,234.56"), 123456n);
    assert.equal(parseAmount("€ 900"), 90000n);
    assert.equal(parseAmount("1234"), 123400n);
  });

  test("a credit note is a real amount", () => {
    assert.equal(parseAmount("-250.00"), -25000n);
  });

  test("anything unreadable is null, never NaN", () => {
    // parseFloat("12abc") is 12, which is how a wrong total gets a confident
    // presentation. This refuses instead.
    for (const junk of ["abc", "", "12abc", "1.2.3", "1,2.345", "£", "--5"]) {
      assert.equal(parseAmount(junk), null, `${JSON.stringify(junk)} should not parse`);
    }
  });

  test("more than two decimals is refused rather than silently rounded", () => {
    assert.equal(parseAmount("10.005"), null);
  });

  test("no floating point is involved", () => {
    // The classic: 0.1 + 0.2 as floats is not 0.3. In minor units it is exact.
    assert.equal(parseAmount("0.10") + parseAmount("0.20"), parseAmount("0.30"));
    assert.equal(0.1 + 0.2 === 0.3, false, "sanity: floats really do get this wrong");
  });
});

describe("parsing a file", () => {
  test("a header is detected and columns inferred", () => {
    const p = parseSpendCsv(CSV);
    assert.ok(p.header);
    assert.equal(p.header.supplier, 0);
    assert.equal(p.header.category, 1);
    assert.equal(p.header.amount, 2);
    assert.equal(p.rows.length, 9);
  });

  test("columns in an unexpected order are still found", () => {
    const p = parseSpendCsv("Amount,Vendor,Commodity\n1000,Alpha,Castings\n");
    assert.equal(p.header.amount, 0);
    assert.equal(p.header.supplier, 1);
    assert.equal(p.header.category, 2);
    assert.equal(p.rows[0].supplier, "Alpha");
    assert.equal(p.rows[0].minor, 100000n);
  });

  test("a file with no header is read positionally", () => {
    const p = parseSpendCsv("Alpha,Castings,1000\nBravo,Fasteners,500\n");
    assert.equal(p.header, null);
    assert.equal(p.rows.length, 2);
  });

  test("unreadable rows are counted and sampled, not silently dropped", () => {
    const p = parseSpendCsv(CSV + "broken row,Bad,not-a-number\n");
    assert.equal(p.skipped, 1);
    assert.equal(p.skippedExamples.length, 1);
    assert.match(p.skippedExamples[0].text, /broken row/);
  });

  test("blank supplier and category get explicit placeholders", () => {
    const p = parseSpendCsv(",,500\n");
    assert.equal(p.rows[0].supplier, "(blank)");
    assert.equal(p.rows[0].category, "Uncategorised");
  });
});

describe("the measured figures", () => {
  const a = run();

  test("the total is exact", () => {
    assert.equal(str(a.total), "801600.00");
  });

  test("shares are exact, and the largest is reported", () => {
    assert.equal(P(a.largestSupplierShare), "52.40%");   // 420,000 of 801,600
    assert.equal(a.suppliers[0].name, "Alpha Castings Ltd");
  });

  test("categories aggregate across rows", () => {
    const consumables = a.categories.find((c) => c.name === "Consumables");
    assert.equal(str(consumables.value), "7300.00");   // 4,200 + 3,100
  });

  test("suppliers and categories come back sorted by value", () => {
    for (let i = 1; i < a.suppliers.length; i++) {
      assert.ok(a.suppliers[i - 1].minor >= a.suppliers[i].minor, "suppliers must be descending");
    }
  });

  test("the largest single line is identified with its row number", () => {
    assert.equal(a.largestLine.supplier, "Alpha Castings Ltd");
    assert.equal(str(a.largestLine.value), "420000.00");
    assert.equal(a.largestLine.line, 2);
  });
});

describe("concentration", () => {
  test("a monopoly is exactly 10000", () => {
    const a = run("Alpha,Castings,1000\n");
    assert.equal(a.concentration.hhi, 10_000);
    assert.equal(a.concentration.level, "high");
  });

  test("two equal suppliers are exactly 5000", () => {
    const a = run("Alpha,X,500\nBravo,Y,500\n");
    assert.equal(a.concentration.hhi, 5_000);
  });

  test("ten equal suppliers are exactly 1000", () => {
    const csv = Array.from({ length: 10 }, (_, i) => `S${i},X,100`).join("\n");
    assert.equal(run(csv).concentration.hhi, 1_000);
  });

  test("a hundred equal suppliers are competitive", () => {
    const csv = Array.from({ length: 100 }, (_, i) => `S${i},X,100`).join("\n");
    const a = run(csv);
    assert.equal(a.concentration.hhi, 100);
    assert.equal(a.concentration.level, "low");
  });

  test("the thresholds are the conventional ones and are stated", () => {
    assert.match(run().concentration.method, /1800 and above/);
    assert.match(run().concentration.method, /describes this data set only/);
  });

  test("it is computed without dividing early", () => {
    // Two data sets differing only in scale must give the identical index.
    const small = run("Alpha,X,1\nBravo,X,2\nCharlie,X,3\n");
    const large = run("Alpha,X,1000000\nBravo,X,2000000\nCharlie,X,3000000\n");
    assert.equal(small.concentration.hhi, large.concentration.hhi,
      "scaling the whole data set must not change concentration");
  });
});

describe("pareto and banding", () => {
  const a = run();

  test("it counts how few suppliers reach 80%", () => {
    assert.equal(a.pareto.suppliersTo80, 3);
    assert.equal(a.pareto.ofSuppliers, 9);
  });

  test("the top fifth is measured, not assumed to be 80%", () => {
    assert.equal(a.pareto.topFifthCount, 2);          // ceil(9 x 0.2)
    assert.equal(P(a.pareto.topFifthShare), "74.85%"); // what it actually is
  });

  test("every supplier lands in exactly one band", () => {
    const counted = a.bands.reduce((n, b) => n + b.count, 0);
    assert.equal(counted, a.suppliers.length);
  });

  test("band values sum to the total", () => {
    const sum = a.bands.reduce((n, b) => n + b.value.minor, 0n);
    assert.equal(sum, a.total.minor);
  });

  test("the band boundaries are 10% and 1%", () => {
    assert.equal(a.bands[0].count, 3);   // 52.4%, 22.5%, 11.9%
    assert.equal(a.bands[1].count, 2);   // 8.0%, 3.9%
    assert.equal(a.bands[2].count, 4);   // the rest, all under 1%
  });
});

describe("it refuses rather than producing a confident wrong answer", () => {
  test("no readable rows is an explicit failure", () => {
    const a = run("nonsense\nmore nonsense\n");
    assert.equal(a.ok, false);
    assert.match(a.reason, /No rows carried a readable amount/);
  });

  test("empty input fails the same way", () => {
    assert.equal(analyseSpend(parseSpendCsv("")).ok, false);
  });

  test("a total of zero cannot produce shares, and says so", () => {
    const a = run("Alpha,X,500\nBravo,X,-500\n");
    assert.equal(a.ok, false);
    assert.match(a.reason, /sum to zero or less/);
  });
});

describe("savings ranges are labelled as assumptions", () => {
  const a = run();
  const s = indicativeSavings(a);

  test("they are returned separately from the measured figures", () => {
    assert.equal(a.measured, true);
    assert.equal(s.label, "assumed");
    assert.equal(a.savings, undefined, "a heuristic must not sit inside the measurements");
  });

  test("each range states its basis and its assumption", () => {
    for (const r of s.ranges) {
      assert.ok(r.basis && r.basis.length > 10, `${r.id} has no basis`);
      assert.ok(r.assumption && r.assumption.length > 10, `${r.id} has no stated assumption`);
    }
  });

  test("the note says plainly that nothing here is derived from the data", () => {
    assert.match(s.note, /not figures derived\s+from this data/);
    assert.match(s.note, /never as a savings forecast/);
  });

  test("the arithmetic is still exact", () => {
    const top = a.categories[0];                 // Castings 420,000
    const r = s.ranges.find((x) => x.id === "competitive-tension");
    assert.equal(str(r.min), "21000.00");        // 5%
    assert.equal(str(r.max), "50400.00");        // 12%
    assert.equal(top.name, "Castings");
  });

  test("tail consolidation only appears when there is a tail worth consolidating", () => {
    assert.ok(s.ranges.some((r) => r.id === "tail-consolidation"), "9 suppliers, 4 in the tail");
    const small = indicativeSavings(run("Alpha,X,1000\nBravo,X,900\n"));
    assert.equal(small.ranges.some((r) => r.id === "tail-consolidation"), false);
  });

  test("no analysis produces no ranges rather than zeroes", () => {
    const none = indicativeSavings({ ok: false });
    assert.deepEqual(none.ranges, []);
  });
});
