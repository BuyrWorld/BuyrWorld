/**
 * Outcome learning.
 *
 * Two temptations are tested against here, because both produce something that
 * reads beautifully and is not true.
 *
 * The first is attributing money to an argument. An outcome has one avoided
 * figure and often several arguments, and nothing recorded says which earned
 * what. The second is a confident rate on one observation: "freight challenges
 * work 100% of the time" is a sentence that should never appear beside a
 * denominator of one.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { recordOutcome } from "../../src/calc/outcome.mjs";
import { learningFrom, learningCorpus, whatWorks, captureGaps, THIN_EVIDENCE_BELOW } from "../../src/calc/learning.mjs";
import { ratioFromPercent as pc, moneyFromDecimal, moneyToDecimalString as str } from "../../src/calc/exact.mjs";
import { formatPercent as P } from "../../src/calc/cost-bridge.mjs";
import { supplierId } from "../../src/domain/ids.mjs";

const DRIVERS = [{ id: "steel", label: "Steel bar", weight: pc("40"), indexMovement: pc("10") }];
const bridge = () => costBridge({
  baseline: { unitPrice: moneyFromDecimal("100.00", "GBP"), annualVolume: 50_000 },
  requestedChange: pc("9"), drivers: DRIVERS,
});

/** £5m line, 9% asked, 6% agreed -> 3pp avoided = £150,000 an outcome. */
const outcome = (at, args, supplier = "Meridian Fabrication Ltd", agreed = "6") => recordOutcome({
  bridge: bridge(), agreedChange: pc(agreed), argumentsUsed: args,
  meta: { supplier, recordedAt: at, caseId: "case_" + at },
});

const FREIGHT = {
  id: "freight", description: "Challenged the freight component", worked: true,
  evidenceRequested: "carrier invoices", supplierResponse: "none provided",
};
const INDEX = { id: "index", description: "Challenged the index base period", worked: false };

describe("deriving records from an outcome", () => {
  test("one record per argument used", () => {
    const r = learningFrom(outcome("2025-01", [FREIGHT, INDEX]));
    assert.equal(r.length, 2);
    assert.deepEqual(r.map((x) => x.argument).sort(), [
      "Challenged the freight component", "Challenged the index base period",
    ]);
  });

  test("each points at its outcome and case", () => {
    const o = outcome("2025-01", [FREIGHT]);
    const [r] = learningFrom(o);
    assert.equal(r.outcomeId, o.id);
    assert.equal(r.caseId, "case_2025-01");
    assert.equal(r.supplierId, supplierId("Meridian Fabrication Ltd"));
  });

  test("what was asked for and what came back are carried through", () => {
    const [r] = learningFrom(outcome("2025-01", [FREIGHT]));
    assert.equal(r.evidenceRequested, "carrier invoices");
    assert.equal(r.supplierResponse, "none provided");
    assert.equal(r.worked, true);
  });

  test("a negotiation nobody described teaches nothing, and says so by being empty", () => {
    assert.deepEqual(learningFrom(outcome("2025-01", [])), []);
    assert.deepEqual(learningFrom(null), []);
    assert.deepEqual(learningFrom({}), []);
  });

  test("a blank argument is not a record", () => {
    assert.deepEqual(learningFrom(outcome("2025-01", [{ id: "x", description: "   " }])), []);
  });

  test("an unrecorded result stays unknown rather than becoming a failure", () => {
    const [r] = learningFrom(outcome("2025-01", [{ id: "x", description: "Asked about tooling" }]));
    assert.equal(r.worked, null, "not recorded is not the same as did not work");
  });
});

describe("money is never attributed to an argument", () => {
  test("the outcome figure is context, and says how many arguments shared it", () => {
    const [r] = learningFrom(outcome("2025-01", [FREIGHT, INDEX]));
    assert.equal(str(r.outcomeAvoided), "150000.00");
    assert.equal(r.sharedWithArguments, 2);
  });

  test("valueMovedMinor stays null, because nothing recorded supports a number there", () => {
    for (const r of learningFrom(outcome("2025-01", [FREIGHT, INDEX]))) {
      assert.equal(r.valueMovedMinor, null,
        "splitting the avoided figure between arguments would be invention");
    }
  });

  test("an outcome is counted once however many arguments it carried", () => {
    // Four arguments on one outcome must not look like four outcomes' worth.
    const args = ["a", "b", "c", "d"].map((k) => ({ id: k, description: "Argument " + k, worked: true }));
    const w = whatWorks(learningCorpus([outcome("2025-01", args)]));
    for (const p of w.patterns) {
      assert.equal(str(p.outcomeContext.avoided), "150000.00");
      assert.equal(p.outcomeContext.outcomes, 1);
    }
  });

  test("the context note refuses the attribution out loud", () => {
    const w = whatWorks(learningCorpus([outcome("2025-01", [FREIGHT])]));
    assert.match(w.patterns[0].outcomeContext.note, /not what this argument earned/);
  });
});

describe("sample size is never hidden", () => {
  const repeat = (n) => learningCorpus(
    Array.from({ length: n }, (_, i) => outcome(`202${i}-01`, [FREIGHT]))
  );

  test("one observation is reported but marked too thin to lean on", () => {
    const w = whatWorks(repeat(1));
    assert.equal(w.patterns[0].thinEvidence, true);
    assert.match(w.patterns[0].statement, /too few to lean on/);
    assert.equal(/100\.00%/.test(w.patterns[0].statement), false,
      "a perfect rate on one case must not be stated as a percentage");
  });

  test("three observations is the threshold, and gets its rate", () => {
    const w = whatWorks(repeat(THIN_EVIDENCE_BELOW));
    assert.equal(w.patterns[0].thinEvidence, false);
    assert.match(w.patterns[0].statement, /worked 3 of 3 recorded time\(s\) \(100\.00%\)/);
  });

  test("every pattern carries its denominator", () => {
    const w = whatWorks(repeat(4));
    assert.equal(w.patterns[0].observed, 4);
    assert.equal(w.patterns[0].decided, 4);
    assert.equal(w.patterns[0].cases, 4);
  });

  test("a corpus with nothing solid says to treat it all as anecdote", () => {
    assert.match(whatWorks(repeat(1)).headline, /Treat everything here as anecdote/);
  });

  test("an argument used but never resolved has no rate at all", () => {
    const w = whatWorks(learningCorpus([outcome("2025-01", [{ id: "x", description: "Asked about tooling" }])]));
    assert.equal(w.patterns[0].rate, null, "0 of 0 is not 0%");
    assert.match(w.patterns[0].statement, /no recorded result/);
  });

  test("solid patterns sort above thin ones", () => {
    const corpus = [
      ...repeat(3),
      ...learningCorpus([outcome("2030-01", [{ id: "rare", description: "Rare argument", worked: true }])]),
    ];
    const w = whatWorks(corpus);
    assert.equal(w.patterns[0].thinEvidence, false);
    assert.equal(w.patterns.at(-1).thinEvidence, true);
  });
});

describe("what moves one supplier is a different question", () => {
  const corpus = learningCorpus([
    outcome("2024-01", [FREIGHT], "Meridian Fabrication Ltd"),
    outcome("2025-01", [FREIGHT], "Meridian Fabrication Ltd"),
    outcome("2026-01", [{ ...FREIGHT, worked: false }], "Bravo Fasteners Ltd"),
  ]);

  test("narrowing to a supplier uses only their records", () => {
    const w = whatWorks(corpus, { supplier: "Meridian Fabrication Ltd" });
    assert.equal(w.records, 2);
    assert.equal(w.patterns[0].worked, 2);
    assert.equal(w.patterns[0].didNotWork, 0);
  });

  test("across all suppliers the picture is different, and both are true", () => {
    const w = whatWorks(corpus);
    assert.equal(w.records, 3);
    assert.equal(w.patterns[0].worked, 2);
    assert.equal(w.patterns[0].didNotWork, 1);
  });

  test("a supplier can be named or given by id", () => {
    assert.equal(
      whatWorks(corpus, { supplier: supplierId("Meridian Fabrication Ltd") }).records,
      whatWorks(corpus, { supplier: "meridian fabrication ltd." }).records
    );
  });

  test("a supplier with nothing recorded gets an honest empty answer", () => {
    const w = whatWorks(corpus, { supplier: "Nobody Ltd" });
    assert.equal(w.records, 0);
    assert.match(w.headline, /Nothing can be learned from a negotiation nobody described/);
  });

  test("the scope is stated, so a pattern is not read against the wrong counterparty", () => {
    assert.equal(whatWorks(corpus).scope, "all suppliers");
    assert.equal(whatWorks(corpus, { supplier: "Meridian Fabrication Ltd" }).scope, "supplier");
  });
});

describe("arguments are matched on their wording, tolerantly", () => {
  test("spacing and case do not split one pattern into two", () => {
    const corpus = learningCorpus([
      outcome("2024-01", [{ id: "a", description: "Challenged the freight component", worked: true }]),
      outcome("2025-01", [{ id: "b", description: "challenged  the FREIGHT component", worked: true }]),
    ]);
    const w = whatWorks(corpus);
    assert.equal(w.patterns.length, 1);
    assert.equal(w.patterns[0].observed, 2);
  });

  test("genuinely different arguments stay apart", () => {
    const w = whatWorks(learningCorpus([outcome("2025-01", [FREIGHT, INDEX])]));
    assert.equal(w.patterns.length, 2);
  });
});

describe("capture gaps", () => {
  test("it names what is missing rather than pretending the corpus is complete", () => {
    const corpus = learningCorpus([outcome("2025-01", [FREIGHT, INDEX])]);
    const g = captureGaps(corpus);
    assert.equal(g.records, 2);
    assert.equal(g.missingEvidence, 1);
    assert.equal(g.missingResponse, 1);
    assert.equal(g.missingResult, 0);
    assert.match(g.note, /turns a note into something the next case can use/);
  });

  test("an unrecorded result is counted", () => {
    const g = captureGaps(learningCorpus([outcome("2025-01", [{ id: "x", description: "Tooling" }])]));
    assert.equal(g.missingResult, 1);
  });

  test("nothing recorded says so plainly", () => {
    assert.match(captureGaps([]).note, /Nothing recorded yet/);
  });
});

describe("the method disclaims what it is", () => {
  const w = whatWorks(learningCorpus([outcome("2025-01", [FREIGHT])]));

  test("success is a judgement, not a measurement", () => {
    assert.match(w.method, /their judgement at the time, not a measurement/);
  });

  test("and the money is not attributed", () => {
    assert.match(w.method, /never attributed to a single argument/);
  });
});
