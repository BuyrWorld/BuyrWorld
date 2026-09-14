/**
 * What the radar says about reviewed lots.
 *
 * One rule matters more than the rest here. `mill.mjs` refuses to show a
 * percentage below its evidence threshold, on the brief's own reasoning that
 * two out of two and two hundred out of two hundred are both 100% and are not
 * the same statement. A radar that did its own division would quietly undo
 * that refusal — two good lots would become a hundred per cent finding, and
 * two bad ones a zero per cent alarm. So nothing here computes a rate, and
 * nothing fires where the rate was withheld.
 *
 * The rest is the radar's existing discipline applied to a new source: a
 * signal with no data does not fire, value at stake is a real figure or null,
 * severity comes from a printed threshold, and nothing is totalled.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SEVERITY, THRESHOLDS, scanOpportunities } from "../../src/calc/radar.mjs";
import { lotRecord, DECISION, RESPONSIBILITY, SCOPE, DEFAULT_MINIMUM_LOTS } from "../../src/calc/mill.mjs";

let seq = 0;
const lot = (over = {}) => lotRecord({
  lotKey: over.lotKey ?? `northgate|h-${++seq}|l-1`,
  producer: "Northgate Steelworks (synthetic)",
  site: "Works 1", grade: "FG-300", form: "plate",
  specification: "SYN-SPEC-100", specificationRevision: "C",
  decision: DECISION.CONFORMING, scope: SCOPE.FULL,
  firstSubmissionComplete: true, reviewedAt: "2026-06-01",
  ...over,
});

const bad = (over = {}) => lot({
  decision: DECISION.NONCONFORMING,
  nonconformities: [{ category: "chemistry out of limit", responsibility: RESPONSIBILITY.PRODUCER }],
  ...over,
});

const many = (n, f = lot) => Array.from({ length: n }, () => f());

/** Only the findings that came from lots. */
const LOT_KINDS = [
  "claiming-while-underperforming", "reviewed-lot-conformity", "document-completeness",
  "issues-are-the-distributor's", "lots-awaiting-decision", "producer-not-identified",
];
const lotFindings = (input) =>
  scanOpportunities(input).opportunities.filter((f) => LOT_KINDS.includes(f.kind));
const kindOf = (input, kind) => lotFindings(input).find((f) => f.kind === kind);

const openClaim = (supplier = "Northgate Steelworks (synthetic)", over = {}) => ({
  meta: { supplier }, currency: "GBP", annualUnsupportedMinor: "50000000", ...over,
});

/* ------------------------------------------------------------ the threshold */

describe("nothing fires on evidence mill.mjs would not show", () => {
  test("two lots at fifty per cent conformity raise nothing", () => {
    // The number is alarming and the evidence is two lots. If this fired, the
    // radar would have undone the one rule the whole record rests on.
    const found = lotFindings({ lots: [lot(), bad()], cases: [openClaim()] });
    assert.deepEqual(found, []);
  });

  test("the same rate above the threshold does fire", () => {
    const lots = [...many(4), ...many(4, bad)];
    const f = kindOf({ lots }, "reviewed-lot-conformity");
    assert.ok(f, "eight lots at fifty per cent is worth raising");
    assert.equal(f.severity, SEVERITY.HIGH);
  });

  test("the threshold the radar uses is the one mill.mjs uses", () => {
    assert.equal(THRESHOLDS.minimumLots, DEFAULT_MINIMUM_LOTS);
  });

  test("no lots at all raises nothing, rather than a finding about having none", () => {
    assert.deepEqual(lotFindings({ lots: [] }), []);
    assert.deepEqual(lotFindings({}), []);
  });

  test("a clean record above the threshold raises nothing", () => {
    assert.deepEqual(lotFindings({ lots: many(10) }), []);
  });

  test("lots with no decision yet produce no rate and no conformity finding", () => {
    const pending = many(8, () => lot({ decision: DECISION.PENDING }));
    assert.equal(kindOf({ lots: pending }, "reviewed-lot-conformity"), undefined);
  });
});

/* ----------------------------------------------------------------- the join */

describe("quality behind a claim", () => {
  const underperforming = () => [...many(7), ...many(2, bad)];

  test("a supplier asking for more while lots fail is the highest finding", () => {
    const f = kindOf({ lots: underperforming(), cases: [openClaim()] }, "claiming-while-underperforming");
    assert.ok(f);
    assert.equal(f.severity, SEVERITY.HIGH);
    assert.match(f.title, /asking for more while/);
  });

  test("it carries the money the claim puts at stake, not a made-up figure", () => {
    const f = kindOf({ lots: underperforming(), cases: [openClaim()] }, "claiming-while-underperforming");
    assert.equal(f.valueAtStake.currency, "GBP");
    assert.equal(f.valueAtStake.minor, 50000000n);
  });

  test("a claim with no calculated exposure gives a finding with no figure", () => {
    const f = kindOf({
      lots: underperforming(),
      cases: [openClaim("Northgate Steelworks (synthetic)", { annualUnsupportedMinor: null })],
    }, "claiming-while-underperforming");
    assert.ok(f);
    assert.equal(f.valueAtStake, null, "a figure is real or it is null");
  });

  test("it does not fire without a claim", () => {
    assert.equal(kindOf({ lots: underperforming() }, "claiming-while-underperforming"), undefined);
  });

  test("it does not fire for a supplier with a good record", () => {
    assert.equal(kindOf({ lots: many(10), cases: [openClaim()] }, "claiming-while-underperforming"), undefined);
  });

  test("a claim from a different supplier does not attach to this record", () => {
    assert.equal(
      kindOf({ lots: underperforming(), cases: [openClaim("Calder Rolling (synthetic)")] },
        "claiming-while-underperforming"),
      undefined);
  });

  test("names are matched loosely enough to survive punctuation and case", () => {
    const f = kindOf({
      lots: underperforming(),
      cases: [openClaim("northgate steelworks  (synthetic)")],
    }, "claiming-while-underperforming");
    assert.ok(f, "a supplier written slightly differently should still match");
  });

  test("it admits the match was by name, and what that does not establish", () => {
    const f = kindOf({ lots: underperforming(), cases: [openClaim()] }, "claiming-while-underperforming");
    assert.match(f.missing.join(" "), /same legal entity/);
    assert.match(f.evidence.join(" "), /Matched to the open claim by supplier name/);
  });

  test("it does not say quality is a reason to refuse the increase", () => {
    const f = kindOf({ lots: underperforming(), cases: [openClaim()] }, "claiming-while-underperforming");
    assert.match(f.why, /not a reason to refuse a justified increase/);
  });
});

/* ------------------------------------------------------------- the record */

describe("the record on its own", () => {
  test("below the concern threshold is medium, below the poor threshold is high", () => {
    // 8 of 9 conforming is about 88.9%: under 90, over 80.
    const medium = kindOf({ lots: [...many(8), bad()] }, "reviewed-lot-conformity");
    assert.equal(medium.severity, SEVERITY.MEDIUM);
    // 6 of 9 is about 66.7%.
    const high = kindOf({ lots: [...many(6), ...many(3, bad)] }, "reviewed-lot-conformity");
    assert.equal(high.severity, SEVERITY.HIGH);
  });

  test("the threshold is printed with the finding so it can be argued with", () => {
    const f = kindOf({ lots: [...many(8), bad()] }, "reviewed-lot-conformity");
    assert.match(f.why, /product rule and not a statistical one/);
    assert.match(f.why, /90\.00%/);
  });

  test("the numerator and denominator travel with it", () => {
    const f = kindOf({ lots: [...many(8), bad()] }, "reviewed-lot-conformity");
    assert.match(f.evidence.join(" "), /8 of 9 reviewed lots/);
  });

  test("it says a rate is not a forecast", () => {
    const f = kindOf({ lots: [...many(8), bad()] }, "reviewed-lot-conformity");
    assert.match(f.action, /not a forecast of the next delivery/);
  });

  test("undecided and partly checked lots are named as what the figure excludes", () => {
    // Seven clean, one partly-checked clean, one failed: 8 of 9 decided, or
    // 88.9%. A tenth clean lot would put it at exactly 90% and the threshold
    // is strictly below, so it would correctly not fire at all.
    const f = kindOf({
      lots: [...many(7), bad(), lot({ decision: DECISION.PENDING }), lot({ scope: SCOPE.PARTIAL })],
    }, "reviewed-lot-conformity");
    assert.ok(f, "88.9% is below the 90% threshold and should fire");
    assert.match(f.missing.join(" "), /no decision yet/);
    assert.match(f.missing.join(" "), /not complete lot conformity/);
  });

  test("exactly at the threshold does not fire", () => {
    // Nine of ten is 90.0%. "Below 90%" means below it.
    const f = kindOf({ lots: [...many(9), bad()] }, "reviewed-lot-conformity");
    assert.equal(f, undefined);
  });
});

describe("paperwork is a different problem", () => {
  test("poor first-pass completeness fires on its own", () => {
    const lots = [...many(4), ...many(5, () => lot({ firstSubmissionComplete: false }))];
    const f = kindOf({ lots }, "document-completeness");
    assert.ok(f);
    assert.equal(f.severity, SEVERITY.MEDIUM);
    assert.match(f.why, /not the\s+same problem as material that does not conform/);
  });

  test("it does not fire where the paperwork is fine", () => {
    assert.equal(kindOf({ lots: many(10) }, "document-completeness"), undefined);
  });

  test("a conforming supplier can still have a paperwork finding", () => {
    // Every lot conformed; most arrived incomplete first time.
    const lots = [...many(4), ...many(5, () => lot({ firstSubmissionComplete: false }))];
    const found = lotFindings({ lots });
    assert.equal(found.some((f) => f.kind === "reviewed-lot-conformity"), false);
    assert.equal(found.some((f) => f.kind === "document-completeness"), true);
  });
});

describe("blame, where the record already answers it", () => {
  test("issues mostly the distributor's are named as such", () => {
    const lots = [
      ...many(6),
      bad({ nonconformities: [{ category: "wrong certificate supplied", responsibility: RESPONSIBILITY.DISTRIBUTOR }] }),
      bad({ nonconformities: [{ category: "missing test report", responsibility: RESPONSIBILITY.DISTRIBUTOR }] }),
      bad(),
    ];
    const f = kindOf({ lots }, "issues-are-the-distributor's");
    assert.ok(f);
    assert.match(f.why, /conversation about them is with a different company/);
    assert.match(f.action, /not to whoever is making/);
  });

  test("it does not fire where most issues are the producer's", () => {
    const lots = [
      ...many(6), bad(), bad(),
      bad({ nonconformities: [{ category: "wrong certificate", responsibility: RESPONSIBILITY.DISTRIBUTOR }] }),
    ];
    assert.equal(kindOf({ lots }, "issues-are-the-distributor's"), undefined);
  });

  test("it does not fire where responsibility was never established", () => {
    const lots = [...many(6), bad({ nonconformities: [{ category: "missing test report" }] })];
    assert.equal(kindOf({ lots }, "issues-are-the-distributor's"), undefined);
  });
});

describe("work not done", () => {
  test("lots piling up undecided is a low finding with a clear action", () => {
    const lots = [...many(6), ...many(5, () => lot({ decision: DECISION.PENDING }))];
    const f = kindOf({ lots }, "lots-awaiting-decision");
    assert.ok(f);
    assert.equal(f.severity, SEVERITY.LOW);
    assert.match(f.why, /not counted as good and not counted as bad; they are not counted/);
  });

  test("a few undecided lots are not a finding", () => {
    const lots = [...many(6), ...many(2, () => lot({ decision: DECISION.PENDING }))];
    assert.equal(kindOf({ lots }, "lots-awaiting-decision"), undefined);
  });
});

describe("the finding that says what to go and record", () => {
  test("a fifth of lots naming no producer is raised", () => {
    const lots = [...many(6), lot({ lotKey: "u|u-1|l", producer: "" }), lot({ lotKey: "u|u-2|l", producer: "" })];
    const f = kindOf({ lots }, "producer-not-identified");
    assert.ok(f);
    assert.match(f.why, /belong to nobody's record/);
    assert.match(f.action, /purchase-order requirement, not a favour/);
  });

  test("one unnamed producer in twenty is not raised", () => {
    const lots = [...many(19), lot({ lotKey: "u|u-1|l", producer: "" })];
    assert.equal(kindOf({ lots }, "producer-not-identified"), undefined);
  });

  test("the share is shown, since that is what makes it worth raising", () => {
    const lots = [...many(6), lot({ lotKey: "u|u-1|l", producer: "" }), lot({ lotKey: "u|u-2|l", producer: "" })];
    assert.match(kindOf({ lots }, "producer-not-identified").title, /25\.00%/);
  });
});

/* --------------------------------------------------------- the radar's rules */

describe("the radar's own discipline still holds", () => {
  const busy = () => ({
    lots: [
      ...many(6),
      ...many(3, bad),
      lot({ decision: DECISION.PENDING }), lot({ decision: DECISION.PENDING }),
      lot({ decision: DECISION.PENDING }), lot({ decision: DECISION.PENDING }),
      lot({ decision: DECISION.PENDING }),
      lot({ lotKey: "u|u-1|l", producer: "" }), lot({ lotKey: "u|u-2|l", producer: "" }),
      lot({ lotKey: "u|u-3|l", producer: "" }), lot({ lotKey: "u|u-4|l", producer: "" }),
    ],
    cases: [openClaim()],
  });

  test("nothing totals the value at stake across findings", () => {
    const scan = scanOpportunities(busy());
    assert.equal("total" in scan, false);
    assert.equal("totalValue" in scan, false);
  });

  test("every lot finding carries an action", () => {
    for (const f of lotFindings(busy())) {
      assert.ok(f.action && f.action.length > 20, `${f.kind} has no action`);
    }
  });

  test("every lot finding names its subject or deliberately has none", () => {
    for (const f of lotFindings(busy())) {
      assert.ok(f.subject !== undefined, `${f.kind} does not say who it is about`);
    }
  });

  test("severity is one of the three, never a score", () => {
    for (const f of lotFindings(busy())) {
      assert.ok(Object.values(SEVERITY).includes(f.severity), `${f.kind} has severity ${f.severity}`);
    }
  });

  test("the same supplier can raise several findings without them merging", () => {
    const kinds = lotFindings(busy()).map((f) => f.kind);
    assert.ok(kinds.length >= 3, `only ${kinds.length} findings on a record with several problems`);
    assert.equal(new Set(kinds).size, kinds.length, "two findings of the same kind for one producer");
  });

  test("a malformed lot does not bring the scan down", () => {
    const scan = scanOpportunities({ lots: [null, undefined, ...many(6)], cases: [] });
    assert.ok(Array.isArray(scan.opportunities));
  });
});
