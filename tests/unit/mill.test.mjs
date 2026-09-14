/**
 * Mill performance.
 *
 * The brief's own example is the test this module lives or dies by: 2/2 and
 * 200/200 are both 100% and contain very different amounts of evidence. Every
 * other rule here follows from taking that seriously — no composite score, no
 * percentage below the threshold, no ranking across unlike material, and no
 * describing any of it as the chance that the next delivery conforms.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DECISION, RESPONSIBILITY, SCOPE, FILTERS, DEFAULT_MINIMUM_LOTS,
  lotRecord, uniqueLots, attribute, applyFilters, cohortOf,
  producerRecord, millPerformance, rank, lotFromReview,
} from "../../src/calc/mill.mjs";

/* --------------------------------------------------------------- helpers */

let seq = 0;
const lot = (over = {}) => lotRecord({
  lotKey: over.lotKey ?? `northgate|h-${++seq}|l-1`,
  producer: "Northgate Steelworks (synthetic)",
  site: "Northgate, Works 2",
  grade: "FG-300",
  form: "plate",
  specification: "SYN-SPEC-100",
  specificationRevision: "C",
  decision: DECISION.CONFORMING,
  scope: SCOPE.FULL,
  firstSubmissionComplete: true,
  reviewedAt: "2026-06-01",
  ...over,
});

const bad = (over = {}) => lot({
  decision: DECISION.NONCONFORMING,
  nonconformities: [{ category: "chemistry out of limit", responsibility: RESPONSIBILITY.PRODUCER }],
  ...over,
});

const many = (n, f = lot) => Array.from({ length: n }, () => f());

/* ---------------------------------------------------------------- records */

describe("a lot record has to be countable once", () => {
  test("no lot key is refused, with the reason", () => {
    assert.throws(() => lotRecord({ decision: DECISION.CONFORMING }), /needs a lot key/);
    assert.throws(() => lotRecord({ decision: DECISION.CONFORMING }), /counted twice/);
  });

  test("an unknown decision is refused", () => {
    assert.throws(() => lotRecord({ lotKey: "a|b|c", decision: "probably fine" }), /Unknown decision/);
  });

  test("a nonconforming lot with no category is refused", () => {
    assert.throws(
      () => lotRecord({ lotKey: "a|b|c", decision: DECISION.NONCONFORMING }),
      /needs at least one category/);
  });

  test("an unknown responsibility is refused rather than defaulted to the mill", () => {
    assert.throws(() => lotRecord({
      lotKey: "a|b|c", decision: DECISION.NONCONFORMING,
      nonconformities: [{ category: "x", responsibility: "the weather" }],
    }), /Unknown responsibility/);
  });

  test("responsibility defaults to not established, never to the producer", () => {
    const r = lotRecord({
      lotKey: "a|b|c", decision: DECISION.NONCONFORMING,
      nonconformities: [{ category: "missing test report" }],
    });
    assert.equal(r.nonconformities[0].responsibility, RESPONSIBILITY.UNKNOWN);
  });

  test("an unassessed submission is null, not false", () => {
    // Null keeps it out of the completeness denominator. False would count it
    // as a failure nobody ever looked for.
    assert.equal(lot({ firstSubmissionComplete: undefined }).firstSubmissionComplete, null);
    assert.equal(lot({ firstSubmissionComplete: false }).firstSubmissionComplete, false);
  });
});

/* --------------------------------------------------------------- identity */

describe("one lot is one lot", () => {
  test("a revised certificate corrects a lot rather than adding one", () => {
    const first = lot({ lotKey: "northgate|h-1|l-1", decision: DECISION.NONCONFORMING,
      nonconformities: [{ category: "missing page" }] });
    const revised = lot({ lotKey: "northgate|h-1|l-1", decision: DECISION.CONFORMING, certificate: "rev 2" });
    const u = uniqueLots([first, revised]);
    assert.equal(u.lots.length, 1);
    assert.equal(u.submissions, 2);
    assert.equal(u.superseded, 1);
    assert.equal(u.lots[0].decision, DECISION.CONFORMING, "the later record wins");
  });

  test("a re-upload does not create a second conforming lot", () => {
    const one = lot({ lotKey: "northgate|h-9|l-1" });
    const p = millPerformance([one, one, one]);
    assert.equal(p.lots, 1);
    assert.equal(p.submissions, 3);
    assert.match(p.submissionNote, /does not add one/);
  });

  test("distinct heats are distinct lots", () => {
    const p = millPerformance([lot({ lotKey: "northgate|h-1|l-1" }), lot({ lotKey: "northgate|h-2|l-1" })]);
    assert.equal(p.lots, 2);
  });
});

describe("attribution is kept, including when it is unknown", () => {
  test("a lot with no producer joins nobody's record", () => {
    const a = attribute([lot(), lot({ producer: "" })]);
    assert.equal(a.attributed.length, 1);
    assert.equal(a.unattributed.length, 1);
    assert.match(a.note, /attributed to nobody/);
    assert.match(a.note, /distributor's\s+paperwork onto a mill's record/);
  });

  test("unattributed lots are counted, not dropped", () => {
    const p = millPerformance([lot(), lot({ producer: "" }), lot({ producer: "" })]);
    assert.equal(p.producers, 1);
    assert.equal(p.unattributed, 2);
    assert.ok(p.unattributedNote);
  });

  test("producer, site and distributor stay separate", () => {
    const r = lot({ producer: "Northgate", site: "Works 2", distributor: "Meridian Stockholding" });
    assert.equal(r.producer, "Northgate");
    assert.equal(r.site, "Works 2");
    assert.equal(r.distributor, "Meridian Stockholding");
  });

  test("two sites under one producer are both reported", () => {
    const p = millPerformance([lot({ site: "Works 1" }), lot({ site: "Works 2" })]);
    assert.deepEqual([...p.rows[0].sites].sort(), ["Works 1", "Works 2"]);
  });
});

/* ------------------------------------------------------------ the threshold */

describe("two over two is not two hundred over two hundred", () => {
  test("below the threshold there is no percentage at all", () => {
    const r = producerRecord(many(2), { minimumLots: 5 });
    assert.equal(r.conformity.percent, null, "a percentage with a caveat is still a percentage");
    assert.equal(r.conformity.ratio, null);
    assert.equal(r.conformity.numerator, 2);
    assert.equal(r.conformity.denominator, 2);
    assert.equal(r.conformity.shortBy, 3);
  });

  test("the statement says the thing out loud", () => {
    const r = producerRecord(many(2), { minimumLots: 5 });
    assert.match(r.conformity.statement, /Two out of two and two hundred out of two hundred/);
    assert.match(r.conformity.statement, /not the same statement/);
  });

  test("above the threshold the percentage appears, with its evidence", () => {
    const r = producerRecord(many(10), { minimumLots: 5 });
    assert.equal(r.conformity.percent, "100.0%");
    assert.equal(r.conformity.numerator, 10);
    assert.equal(r.conformity.denominator, 10);
    assert.match(r.conformity.statement, /10 of 10 reviewed lots/);
  });

  test("a rate is never a bare number", () => {
    const r = producerRecord(many(10), { minimumLots: 5 });
    for (const field of ["numerator", "denominator", "statement", "sufficient"]) {
      assert.ok(field in r.conformity, `${field} must travel with the rate`);
    }
  });

  test("no lots with a decision means no rate, not zero per cent", () => {
    const r = producerRecord(many(3, () => lot({ decision: DECISION.PENDING })));
    assert.equal(r.conformity.denominator, 0);
    assert.equal(r.conformity.percent, null);
    assert.match(r.conformity.statement, /No lots have a final decision/);
    assert.equal(r.pending, 3);
  });

  test("the threshold is configurable and says it is a product rule", () => {
    assert.equal(DEFAULT_MINIMUM_LOTS, 5);
    const loose = producerRecord(many(2), { minimumLots: 2 });
    assert.equal(loose.conformity.percent, "100.0%");
    const p = millPerformance(many(2), { minimumLots: 2 });
    assert.match(p.method, /product rule, not a\s+statistical guarantee/);
  });
});

/* -------------------------------------------------------------- the metrics */

describe("the metrics do not merge", () => {
  test("conformity and document completeness are separate rates", () => {
    // Every lot conformed; half arrived with incomplete paperwork first time.
    const records = [
      ...many(5, () => lot({ firstSubmissionComplete: true })),
      ...many(5, () => lot({ firstSubmissionComplete: false })),
    ];
    const r = producerRecord(records, { minimumLots: 5 });
    assert.equal(r.conformity.percent, "100.0%");
    assert.equal(r.firstPassCompleteness.percent, "50.0%");
  });

  test("an unassessed submission is out of the completeness denominator", () => {
    const records = [...many(5, () => lot({ firstSubmissionComplete: true })),
                     ...many(5, () => lot({ firstSubmissionComplete: undefined }))];
    const r = producerRecord(records, { minimumLots: 5 });
    assert.equal(r.firstPassCompleteness.denominator, 5);
    assert.equal(r.firstPassCompleteness.percent, "100.0%");
  });

  test("pending lots are in neither rate, and are counted", () => {
    const records = [...many(5), ...many(3, () => lot({ decision: DECISION.PENDING }))];
    const r = producerRecord(records, { minimumLots: 5 });
    assert.equal(r.conformity.denominator, 5);
    assert.equal(r.pending, 3);
    assert.match(r.pendingNote, /in neither rate above/);
  });

  test("there is no composite score anywhere in the result", () => {
    const r = producerRecord(many(10), { minimumLots: 5 });
    const names = Object.keys(r).join(" ").toLowerCase();
    for (const banned of ["score", "rating", "overall", "index"]) {
      assert.equal(names.includes(banned), false, `the record exposes a "${banned}" field`);
    }
  });
});

describe("responsibility sits beside the rate, not inside it", () => {
  const records = () => [
    ...many(6),
    bad({ nonconformities: [{ category: "wrong certificate sent", responsibility: RESPONSIBILITY.DISTRIBUTOR }] }),
    bad({ nonconformities: [{ category: "chemistry out of limit", responsibility: RESPONSIBILITY.PRODUCER }] }),
  ];

  test("categories are counted with who they were attributed to", () => {
    const r = producerRecord(records(), { minimumLots: 5 });
    const distributor = r.nonconformityCategories.find((c) => c.responsibility === RESPONSIBILITY.DISTRIBUTOR);
    assert.equal(distributor.category, "wrong certificate sent");
    assert.equal(distributor.count, 1);
  });

  test("a distributor's error does not silently adjust the conformity rate", () => {
    const r = producerRecord(records(), { minimumLots: 5 });
    assert.equal(r.conformity.numerator, 6);
    assert.equal(r.conformity.denominator, 8, "the lot did not conform, whoever caused it");
    assert.equal(r.attributedToDistributor, 1);
    assert.match(r.attributionNote, /about lots/);
    assert.match(r.attributionNote, /not the same question/);
  });

  test("nothing is attributed to the producer by default", () => {
    const r = producerRecord([...many(5), bad({ nonconformities: [{ category: "missing test report" }] })],
      { minimumLots: 5 });
    const row = r.nonconformityCategories[0];
    assert.equal(row.responsibility, RESPONSIBILITY.UNKNOWN);
  });
});

describe("a partial comparison is not lot conformity", () => {
  test("chemistry-only lots are counted and flagged", () => {
    const r = producerRecord([...many(5), ...many(3, () => lot({ scope: SCOPE.PARTIAL }))], { minimumLots: 5 });
    assert.equal(r.partialScopeLots, 3);
    assert.match(r.scopeNote, /established something\s+about chemistry/);
    assert.match(r.scopeNote, /should not be read as complete lot conformity/);
  });

  test("a fully checked set raises nothing", () => {
    const r = producerRecord(many(5), { minimumLots: 5 });
    assert.equal(r.partialScopeLots, 0);
    assert.equal(r.scopeNote, null);
  });
});

/* ---------------------------------------------------------------- filters */

describe("filters, and what a mixture means", () => {
  test("every dimension a view can be narrowed by is a real distinction", () => {
    assert.deepEqual([...FILTERS].sort(),
      ["condition", "form", "grade", "site", "specification", "specificationRevision"]);
  });

  test("filtering by grade narrows the set", () => {
    const records = [lot({ grade: "FG-300" }), lot({ grade: "FG-450" })];
    assert.equal(applyFilters(records, { grade: "FG-300" }).length, 1);
  });

  test("a date range excludes what falls outside it", () => {
    const records = [lot({ reviewedAt: "2026-01-15" }), lot({ reviewedAt: "2026-06-15" })];
    assert.equal(applyFilters(records, { from: "2026-03-01" }).length, 1);
    assert.equal(applyFilters(records, { to: "2026-03-01" }).length, 1);
  });

  test("a set spanning grades is a summary and says so", () => {
    const p = millPerformance([lot({ grade: "FG-300" }), lot({ grade: "FG-450" })]);
    assert.equal(p.cohort.single, false);
    assert.match(p.cohortNote, /summary, not a comparison/);
    assert.match(p.cohortNote, /not equivalent/);
  });

  test("one grade, one form and one specification is one cohort", () => {
    const c = cohortOf(many(4));
    assert.equal(c.single, true);
  });

  test("the date range travels with the record", () => {
    const r = producerRecord([lot({ reviewedAt: "2026-01-15" }), lot({ reviewedAt: "2026-06-15" })]);
    assert.equal(r.from, "2026-01-15");
    assert.equal(r.to, "2026-06-15");
  });

  test("undated lots are counted rather than assumed into the range", () => {
    const r = producerRecord([lot({ reviewedAt: "2026-01-15" }), lot({ reviewedAt: "" })]);
    assert.equal(r.undated, 1);
  });
});

/* ----------------------------------------------------------- the table */

describe("the default view is an evidence table", () => {
  test("producers are ordered by name, so the order implies nothing", () => {
    const p = millPerformance([
      ...many(6, () => lot({ producer: "Zenith Mill (synthetic)" })),
      ...many(2, () => lot({ producer: "Alpha Mill (synthetic)" })),
    ]);
    assert.equal(p.rows[0].producer, "Alpha Mill (synthetic)");
    assert.equal(p.rows[1].producer, "Zenith Mill (synthetic)");
  });

  test("the disclaimer says what it is not", () => {
    const p = millPerformance(many(5));
    assert.match(p.disclaimer, /not a probability that future material/);
    assert.match(p.disclaimer, /not a supplier rating/);
    assert.match(p.disclaimer, /private to this browser/);
  });

  test("the method names the threshold and refuses a composite", () => {
    const p = millPerformance(many(5));
    assert.match(p.method, /There is no composite score/);
    assert.match(p.method, /never merged/);
  });

  test("an empty set is an empty table, not an error", () => {
    const p = millPerformance([]);
    assert.equal(p.rows.length, 0);
    assert.equal(p.lots, 0);
  });
});

/* --------------------------------------------------------------- ranking */

describe("ranking is opt-in and comes with conditions", () => {
  const twoProducers = () => [
    ...many(6, () => lot({ producer: "Alpha Mill (synthetic)" })),
    ...many(6, () => bad({ producer: "Zenith Mill (synthetic)" })),
  ];

  test("producers below the threshold are not ranked, rather than ranked last", () => {
    const p = millPerformance([
      ...many(6, () => lot({ producer: "Alpha Mill (synthetic)" })),
      ...many(2, () => lot({ producer: "Tiny Mill (synthetic)" })),
    ], { minimumLots: 5 });
    const r = rank(p);
    assert.equal(r.ranked.length, 1);
    assert.equal(r.insufficient.length, 1);
    assert.equal(r.insufficient[0].producer, "Tiny Mill (synthetic)");
    assert.match(r.note, /not ranked last — they are not ranked/);
  });

  test("the threshold does not make the ranked producers better, only better evidenced", () => {
    const r = rank(millPerformance(many(6)));
    assert.match(r.note, /only better evidenced/);
  });

  test("a ranking across grades is refused, with the reason", () => {
    const p = millPerformance([
      ...many(6, () => lot({ producer: "Alpha Mill (synthetic)", grade: "FG-300" })),
      ...many(6, () => lot({ producer: "Zenith Mill (synthetic)", grade: "FG-450" })),
    ]);
    const r = rank(p);
    assert.equal(r.safe, false);
    assert.match(r.why, /requirements they were not all judged against/);
  });

  test("one producer is not a ranking", () => {
    const r = rank(millPerformance(many(6)));
    assert.equal(r.safe, false);
    assert.match(r.why, /nothing to rank/);
  });

  test("a safe ranking orders by rate, and breaks ties on evidence", () => {
    const p = millPerformance(twoProducers(), { minimumLots: 5 });
    const r = rank(p);
    assert.equal(r.safe, true);
    assert.equal(r.ranked[0].producer, "Alpha Mill (synthetic)");
    assert.equal(r.ranked[0].conformity.percent, "100.0%");
    assert.equal(r.ranked[1].conformity.percent, "0.0%");
  });

  test("a tie goes to the producer with more evidence behind it", () => {
    const p = millPerformance([
      ...many(6, () => lot({ producer: "Alpha Mill (synthetic)" })),
      ...many(30, () => lot({ producer: "Zenith Mill (synthetic)" })),
    ], { minimumLots: 5 });
    const r = rank(p);
    assert.equal(r.ranked[0].producer, "Zenith Mill (synthetic)");
    assert.equal(r.ranked[0].conformity.denominator, 30);
  });
});

/* ---------------------------------------- from a check to a record */

describe("a decision becomes a record", () => {
  const stubCheck = (over = {}) => ({
    lotKey: "northgate|h-77213|l-4",
    certificate: {
      number: "SYN-CERT-0001", producer: "Northgate Steelworks (synthetic)",
      distributor: null, form: "plate", condition: "normalised",
      statedSpecification: "SYN-SPEC-100", statedRevision: "C", supersedes: null,
      ...over.certificate,
    },
    findings: over.findings ?? [{ property: "C", result: "meets", mandatory: true }],
    documentIssues: over.documentIssues ?? [],
    ...over,
  });
  const decide = (disposition, over = {}) =>
    ({ disposition, reasoning: "synthetic", at: "2026-06-01", ...over });

  test("an acceptance becomes a conforming lot", () => {
    const r = lotFromReview(stubCheck(), decide("accepted"));
    assert.equal(r.decision, DECISION.CONFORMING);
    assert.equal(r.lotKey, "northgate|h-77213|l-4");
    assert.equal(r.certificate, "SYN-CERT-0001");
  });

  test("a rejection becomes a nonconforming lot with its categories", () => {
    const r = lotFromReview(stubCheck({
      findings: [{ property: "C", result: "does not meet", mandatory: true }],
    }), decide("rejected"));
    assert.equal(r.decision, DECISION.NONCONFORMING);
    assert.equal(r.nonconformities[0].category, "C");
  });

  test("a concession is a nonconforming lot, not a conforming one", () => {
    // The material did not meet the requirement. Somebody accepted it anyway.
    // Recording it as conforming would let every concession raise the rate.
    const r = lotFromReview(stubCheck({
      findings: [{ property: "C", result: "does not meet", mandatory: true }],
    }), decide("accepted under concession"));
    assert.equal(r.decision, DECISION.NONCONFORMING);
  });

  test("a pending decision is a pending lot, in neither rate", () => {
    assert.equal(lotFromReview(stubCheck(), decide("pending")).decision, DECISION.PENDING);
  });

  test("scope is full only where every requirement was actually compared", () => {
    const full = lotFromReview(stubCheck({
      findings: [{ property: "C", result: "meets", mandatory: true },
                 { property: "S", result: "not applicable", mandatory: true }],
    }), decide("accepted"));
    assert.equal(full.scope, SCOPE.FULL);

    const partial = lotFromReview(stubCheck({
      findings: [{ property: "C", result: "meets", mandatory: true },
                 { property: "S", result: "review required", mandatory: true }],
    }), decide("accepted"));
    assert.equal(partial.scope, SCOPE.PARTIAL);
  });

  test("missing evidence or unconfirmed readings make the first submission incomplete", () => {
    const missing = lotFromReview(stubCheck({
      findings: [{ property: "C", result: "missing evidence", mandatory: true }],
    }), decide("pending"));
    assert.equal(missing.firstSubmissionComplete, false);

    const unconfirmed = lotFromReview(stubCheck({
      documentIssues: [{ id: "unconfirmed", what: "x", detail: "y" }],
    }), decide("accepted"));
    assert.equal(unconfirmed.firstSubmissionComplete, false);

    assert.equal(lotFromReview(stubCheck(), decide("accepted")).firstSubmissionComplete, true);
  });

  test("responsibility is not assigned unless somebody assigns it", () => {
    const r = lotFromReview(stubCheck({
      findings: [{ property: "C", result: "does not meet", mandatory: true }],
    }), decide("rejected"));
    assert.equal(r.nonconformities[0].responsibility, RESPONSIBILITY.UNKNOWN);

    const blamed = lotFromReview(stubCheck({
      findings: [{ property: "C", result: "does not meet", mandatory: true }],
    }), decide("rejected"), { responsibility: RESPONSIBILITY.DISTRIBUTOR });
    assert.equal(blamed.nonconformities[0].responsibility, RESPONSIBILITY.DISTRIBUTOR);
  });

  test("a certificate that identifies no lot cannot join a record", () => {
    assert.throws(() => lotFromReview(stubCheck({ lotKey: null }), decide("accepted")),
      /cannot join a performance record/);
  });

  test("an unnamed producer carries through as unattributed", () => {
    const r = lotFromReview(stubCheck({ certificate: { producer: "" } }), decide("accepted"));
    assert.equal(r.producer, null);
    assert.equal(attribute([r]).unattributed.length, 1);
  });
});
