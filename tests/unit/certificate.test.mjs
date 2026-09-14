/**
 * Certificate against specification.
 *
 * The brief names the cases it wants covered, and they are all cases where a
 * careless implementation gives a confident wrong answer: a limit exactly at
 * the boundary, an inequality, the wrong specification revision, a missing
 * page, a unit that does not convert, an ambiguous reading. Plus the one that
 * matters most on a page — one failed mandatory requirement must not be
 * averaged away by ninety-nine passes.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  RESULT, OVERALL, KIND, DISPOSITION, RULES_VERSION, UNIT_FAMILIES,
  quantity, requirement, observation, certificate, checkCertificate,
  findConflicts, recordReview, auditTrail, supersede, lotKey,
} from "../../src/calc/certificate.mjs";

/* --------------------------------------------------------------- helpers */

const src = (over = {}) => ({ document: "SYN-SPEC-100", revision: "C", clause: "7.2", ...over });

const maxReq = (property, value, unit = "%", over = {}) =>
  requirement({ id: `max-${property}`, property, max: quantity(value, unit), source: src(), ...over });

const minReq = (property, value, unit = "MPa", over = {}) =>
  requirement({ id: `min-${property}`, property, min: quantity(value, unit), source: src(), ...over });

const obs = (property, value, unit = "%", over = {}) =>
  observation({
    property,
    value: value === null ? null : quantity(value, unit),
    source: { file: "synthetic-cert.pdf", page: 1, quote: `${property} ${value}` },
    confirmed: true,
    ...over,
  });

const cert = (over = {}) => certificate({
  number: "SYN-CERT-0001",
  producer: "Northgate Steelworks (synthetic)",
  issuer: "Northgate Steelworks (synthetic)",
  heat: "H-77213",
  lot: "L-4",
  statedSpecification: "SYN-SPEC-100",
  statedRevision: "C",
  form: "plate",
  condition: "normalised",
  pagesProvided: 3,
  pagesDeclared: 3,
  observations: [],
  ...over,
});

/* ------------------------------------------------------------ quantities */

describe("a reported value keeps what was written", () => {
  test("an inequality survives parsing", () => {
    assert.equal(quantity("<0.005", "%").op, "<");
    assert.equal(quantity("≤0.030", "%").op, "<=");
    assert.equal(quantity("≥400", "MPa").op, ">=");
    assert.equal(quantity(">400", "MPa").op, ">");
    assert.equal(quantity("0.18", "%").op, "=");
  });

  test("decimal places are kept, because precision is evidence", () => {
    assert.equal(quantity("0.03", "%").dp, 2);
    assert.equal(quantity("0.030", "%").dp, 3);
    // The two are numerically equal and are not the same statement.
    assert.equal(quantity("0.03", "%").scaled, quantity("0.030", "%").scaled);
    assert.notEqual(quantity("0.03", "%").dp, quantity("0.030", "%").dp);
  });

  test("a below-detection result is marked as one", () => {
    assert.equal(quantity("<0.005", "%").belowDetection, true);
    assert.equal(quantity("0.005", "%").belowDetection, false);
  });

  test("an empty value is refused, never read as zero", () => {
    assert.throws(() => quantity("", "%"), /is missing/);
    assert.throws(() => quantity(null, "%"), /is missing/);
  });

  test("a value that is not a value is refused", () => {
    assert.throws(() => quantity("trace", "%"), /not a value this can read/);
    assert.throws(() => quantity("0.1-0.2", "%"), /not a value this can read/);
  });

  test("an unknown unit is refused, and says what it knows", () => {
    assert.throws(() => quantity("400", "furlongs"), /not a unit this understands/);
    assert.throws(() => quantity("400", "furlongs"), /MPa/);
  });
});

/* ------------------------------------------------------------ comparison */

describe("boundaries", () => {
  test("exactly at an inclusive maximum meets it", () => {
    const c = checkCertificate(cert({ observations: [obs("C", "0.200")] }), [maxReq("C", "0.200")]);
    assert.equal(c.findings[0].result, RESULT.MEETS);
  });

  test("one step over does not", () => {
    const c = checkCertificate(cert({ observations: [obs("C", "0.201")] }), [maxReq("C", "0.200")]);
    assert.equal(c.findings[0].result, RESULT.DOES_NOT_MEET);
  });

  test("exactly at an inclusive minimum meets it", () => {
    const c = checkCertificate(cert({ observations: [obs("UTS", "400", "MPa")] }), [minReq("UTS", "400")]);
    assert.equal(c.findings[0].result, RESULT.MEETS);
  });

  test("a value inside a two-sided range meets it, outside does not", () => {
    const req = requirement({
      id: "mn", property: "Mn", min: quantity("1.00", "%"), max: quantity("1.60", "%"), source: src(),
    });
    assert.equal(checkCertificate(cert({ observations: [obs("Mn", "1.30")] }), [req]).findings[0].result, RESULT.MEETS);
    assert.equal(checkCertificate(cert({ observations: [obs("Mn", "0.90")] }), [req]).findings[0].result, RESULT.DOES_NOT_MEET);
    assert.equal(checkCertificate(cert({ observations: [obs("Mn", "1.70")] }), [req]).findings[0].result, RESULT.DOES_NOT_MEET);
  });

  test("a minimum above its maximum is refused at build time", () => {
    assert.throws(() => requirement({
      id: "x", property: "Mn", min: quantity("2.0", "%"), max: quantity("1.0", "%"), source: src(),
    }), /minimum is above the maximum/);
  });
});

describe("inequalities are ranges, not numbers", () => {
  test("below a detection limit that sits under the requirement meets it", () => {
    // <0.005 against max 0.030: every value it could be is under the limit.
    const c = checkCertificate(cert({ observations: [obs("S", "<0.005")] }), [maxReq("S", "0.030")]);
    assert.equal(c.findings[0].result, RESULT.MEETS);
  });

  test("below a detection limit that straddles the requirement settles nothing", () => {
    // <0.005 against max 0.001: the material might be 0.004. It might be
    // 0.0005. The certificate does not say, and neither does this.
    const c = checkCertificate(cert({ observations: [obs("S", "<0.005")] }), [maxReq("S", "0.001")]);
    assert.equal(c.findings[0].result, RESULT.REVIEW_REQUIRED);
    assert.match(c.findings[0].why, /spans/);
    assert.equal(c.findings[0].rule, "range straddles the limit");
  });

  test("a detection limit entirely above a minimum fails it", () => {
    const c = checkCertificate(cert({ observations: [obs("UTS", "<380", "MPa")] }), [minReq("UTS", "400")]);
    assert.equal(c.findings[0].result, RESULT.DOES_NOT_MEET);
  });

  test("a greater-than result above a minimum meets it", () => {
    const c = checkCertificate(cert({ observations: [obs("UTS", ">450", "MPa")] }), [minReq("UTS", "400")]);
    assert.equal(c.findings[0].result, RESULT.MEETS);
  });

  test("a greater-than result that straddles a minimum settles nothing", () => {
    const c = checkCertificate(cert({ observations: [obs("UTS", ">380", "MPa")] }), [minReq("UTS", "400")]);
    assert.equal(c.findings[0].result, RESULT.REVIEW_REQUIRED);
  });

  test("the convenient end of a range is never chosen", () => {
    // Both directions, so a bias one way would show.
    const low = checkCertificate(cert({ observations: [obs("S", "<0.005")] }), [maxReq("S", "0.001")]);
    const high = checkCertificate(cert({ observations: [obs("UTS", ">380", "MPa")] }), [minReq("UTS", "400")]);
    assert.equal(low.findings[0].result, RESULT.REVIEW_REQUIRED);
    assert.equal(high.findings[0].result, RESULT.REVIEW_REQUIRED);
  });
});

describe("precision is evidence", () => {
  test("a value reported too coarsely to settle the boundary goes to review", () => {
    // 0.03 against a limit of 0.030 rounds to exactly the limit, and the
    // true value could be 0.034.
    const c = checkCertificate(cert({ observations: [obs("S", "0.03")] }), [maxReq("S", "0.030")]);
    assert.equal(c.findings[0].result, RESULT.REVIEW_REQUIRED);
    assert.equal(c.findings[0].rule, "precision cannot settle the boundary");
    assert.match(c.findings[0].why, /cannot tell you which side/);
  });

  test("a coarse value clearly inside the limit still meets it", () => {
    const c = checkCertificate(cert({ observations: [obs("S", "0.01")] }), [maxReq("S", "0.030")]);
    assert.equal(c.findings[0].result, RESULT.MEETS);
  });

  test("a coarse value clearly outside the limit still fails it", () => {
    const c = checkCertificate(cert({ observations: [obs("S", "0.05")] }), [maxReq("S", "0.030")]);
    assert.equal(c.findings[0].result, RESULT.DOES_NOT_MEET);
  });

  test("a value reported at the limit's own precision is settled, not queried", () => {
    const c = checkCertificate(cert({ observations: [obs("S", "0.030")] }), [maxReq("S", "0.030")]);
    assert.equal(c.findings[0].result, RESULT.MEETS);
  });

  test("a value reported more finely than the limit is settled too", () => {
    const c = checkCertificate(cert({ observations: [obs("S", "0.0295")] }), [maxReq("S", "0.030")]);
    assert.equal(c.findings[0].result, RESULT.MEETS);
  });
});

describe("units convert exactly or not at all", () => {
  test("per cent and ppm are the same family and convert", () => {
    // 30 ppm is 0.003%, comfortably inside a 0.030% limit.
    const c = checkCertificate(cert({ observations: [obs("S", "30", "ppm")] }), [maxReq("S", "0.030")]);
    assert.equal(c.findings[0].result, RESULT.MEETS);
  });

  test("ppm above the limit in per cent still fails", () => {
    const c = checkCertificate(cert({ observations: [obs("S", "400", "ppm")] }), [maxReq("S", "0.030")]);
    assert.equal(c.findings[0].result, RESULT.DOES_NOT_MEET);
  });

  test("MPa and N/mm2 are the same measurement", () => {
    const c = checkCertificate(cert({ observations: [obs("UTS", "420", "N/mm2")] }), [minReq("UTS", "400")]);
    assert.equal(c.findings[0].result, RESULT.MEETS);
  });

  test("hardness scales are refused rather than converted", () => {
    const req = minReq("hardness", "180", "HB");
    const c = checkCertificate(cert({ observations: [obs("hardness", "200", "HV")] }), [req]);
    assert.equal(c.findings[0].result, RESULT.REVIEW_REQUIRED);
    assert.match(c.findings[0].why, /Hardness scales do not convert/);
    assert.match(c.findings[0].why, /approximations/);
  });

  test("an unrelated unit is refused without a guess", () => {
    const c = checkCertificate(cert({ observations: [obs("UTS", "20", "%")] }), [minReq("UTS", "400")]);
    assert.equal(c.findings[0].result, RESULT.REVIEW_REQUIRED);
    assert.match(c.findings[0].why, /no exact conversion/);
  });

  test("every family converts only within itself", () => {
    const seen = new Set();
    for (const [family, table] of Object.entries(UNIT_FAMILIES)) {
      for (const unit of Object.keys(table)) {
        if (!unit) continue;
        // A unit may belong to exactly one family, or the conversion is ambiguous.
        assert.equal(seen.has(`${family}:${unit}`), false);
        seen.add(`${family}:${unit}`);
      }
    }
    for (const scale of ["HB", "HV", "HRC"]) {
      assert.deepEqual(Object.keys(UNIT_FAMILIES[scale]), [scale],
        `${scale} must not share a family with another hardness scale`);
    }
  });
});

describe("combined and missing", () => {
  test("a combined limit sums the elements it names", () => {
    const req = requirement({
      id: "nbta", property: "Nb+Ta", combines: ["Nb", "Ta"], max: quantity("1.00", "%"), source: src(),
    });
    const c = checkCertificate(cert({ observations: [obs("Nb", "0.40"), obs("Ta", "0.30")] }), [req]);
    assert.equal(c.findings[0].result, RESULT.MEETS);
    assert.match(c.findings[0].why, /0\.40 \+ 0\.30/);
  });

  test("a combined limit exceeded by the sum fails, though neither element does", () => {
    const req = requirement({
      id: "nbta", property: "Nb+Ta", combines: ["Nb", "Ta"], max: quantity("1.00", "%"), source: src(),
    });
    const c = checkCertificate(cert({ observations: [obs("Nb", "0.70"), obs("Ta", "0.60")] }), [req]);
    assert.equal(c.findings[0].result, RESULT.DOES_NOT_MEET);
  });

  test("a combined limit with an inequality in it stays a range", () => {
    // "<0.01 plus 0.40" is not 0.41, and against a tight limit it is unsettled.
    const req = requirement({
      id: "nbta", property: "Nb+Ta", combines: ["Nb", "Ta"], max: quantity("0.405", "%"), source: src(),
    });
    const c = checkCertificate(cert({ observations: [obs("Nb", "<0.01"), obs("Ta", "0.40")] }), [req]);
    assert.equal(c.findings[0].result, RESULT.REVIEW_REQUIRED);
  });

  test("a missing element makes the whole combination missing evidence", () => {
    const req = requirement({
      id: "nbta", property: "Nb+Ta", combines: ["Nb", "Ta"], max: quantity("1.00", "%"), source: src(),
    });
    const c = checkCertificate(cert({ observations: [obs("Nb", "0.40")] }), [req]);
    assert.equal(c.findings[0].result, RESULT.MISSING_EVIDENCE);
    assert.match(c.findings[0].why, /does not report Ta/);
  });

  test("missing is not failing, and the words are different", () => {
    const c = checkCertificate(cert({ observations: [] }), [maxReq("S", "0.030")]);
    assert.equal(c.findings[0].result, RESULT.MISSING_EVIDENCE);
    assert.match(c.findings[0].why, /not evidence that the material is wrong/);
    assert.equal(c.overall, OVERALL.INCOMPLETE_EVIDENCE);
    assert.notEqual(c.overall, OVERALL.POTENTIAL_NONCONFORMANCE);
  });
});

describe("clauses that need a person", () => {
  test("an interpretation clause is never forced into pass or fail", () => {
    const req = requirement({
      id: "surface", property: "surface condition", kind: KIND.INTERPRETATION,
      source: src({ clause: "9.1" }),
    });
    const c = checkCertificate(cert(), [req]);
    assert.equal(c.findings[0].result, RESULT.REVIEW_REQUIRED);
    assert.match(c.findings[0].why, /needs engineering judgement/);
  });

  test("a text requirement compares exactly", () => {
    const req = requirement({
      id: "cond", property: "condition", kind: KIND.TEXT, expected: "normalised", source: src(),
    });
    const yes = checkCertificate(cert({
      observations: [observation({ property: "condition", text: "Normalised", source: { file: "c.pdf", page: 1 }, confirmed: true })],
    }), [req]);
    assert.equal(yes.findings[0].result, RESULT.MEETS);

    const no = checkCertificate(cert({
      observations: [observation({ property: "condition", text: "as rolled", source: { file: "c.pdf", page: 1 }, confirmed: true })],
    }), [req]);
    assert.equal(no.findings[0].result, RESULT.DOES_NOT_MEET);
  });
});

describe("applicability", () => {
  const plateOnly = maxReq("C", "0.200", "%", {
    appliesTo: { forms: ["plate"] },
  });

  test("a limit for another form does not apply, and is not a pass", () => {
    const c = checkCertificate(cert({ form: "bar", observations: [obs("C", "0.18")] }), [plateOnly]);
    assert.equal(c.findings[0].result, RESULT.NOT_APPLICABLE);
    assert.equal(c.checked, 0, "a requirement that does not apply is not a check that was done");
  });

  test("a thickness outside the range does not apply", () => {
    const thick = maxReq("C", "0.200", "%", { appliesTo: { thicknessMaxUm: 20_000n } });
    const c = checkCertificate(cert({ thicknessUm: 50_000n, observations: [obs("C", "0.18")] }), [thick]);
    assert.equal(c.findings[0].result, RESULT.NOT_APPLICABLE);
    assert.match(c.findings[0].why, /thicker than the range/);
  });

  test("a certificate that does not state the form cannot claim a form-specific limit", () => {
    const c = checkCertificate(cert({ form: null, observations: [obs("C", "0.18")] }), [plateOnly]);
    assert.equal(c.findings[0].result, RESULT.NOT_APPLICABLE);
    assert.match(c.findings[0].why, /does not state the product form/);
  });
});

/* --------------------------------------------------------- the paperwork */

describe("the document itself", () => {
  test("missing pages are incomplete evidence, prominently", () => {
    const c = checkCertificate(cert({ pagesProvided: 2, pagesDeclared: 4, observations: [obs("C", "0.18")] }),
      [maxReq("C", "0.200")]);
    const issue = c.documentIssues.find((d) => d.id === "pages");
    assert.ok(issue);
    assert.match(issue.detail, /on a page nobody has/);
    assert.equal(c.overall, OVERALL.INCOMPLETE_EVIDENCE);
  });

  test("a specification revision mismatch puts every comparison in doubt", () => {
    const c = checkCertificate(cert({ statedRevision: "B", observations: [obs("C", "0.18")] }),
      [maxReq("C", "0.200")]);
    const issue = c.documentIssues.find((d) => d.id === "revision");
    assert.ok(issue, "a certificate against a different revision must be flagged");
    assert.match(issue.detail, /Revisions change limits/);
    assert.equal(c.overall, OVERALL.REVIEW_REQUIRED);
  });

  test("a matching revision raises nothing", () => {
    const c = checkCertificate(cert({ statedRevision: "C", observations: [obs("C", "0.18")] }),
      [maxReq("C", "0.200")]);
    assert.equal(c.documentIssues.some((d) => d.id === "revision"), false);
    assert.equal(c.overall, OVERALL.MEETS_CHECKED);
  });

  test("producer, issuer and distributor are three identities", () => {
    const c = cert({ producer: "Northgate", issuer: "Meridian Stockholding", distributor: "Meridian Stockholding" });
    assert.equal(c.producer, "Northgate");
    assert.notEqual(c.producer, c.issuer);
  });

  test("a certificate that does not name the mill cannot be attributed to one", () => {
    const c = checkCertificate(
      cert({ producer: "", issuer: "Meridian Stockholding", distributor: "Meridian Stockholding", observations: [obs("C", "0.18")] }),
      [maxReq("C", "0.200")]);
    const issue = c.documentIssues.find((d) => d.id === "producer");
    assert.ok(issue);
    assert.match(issue.detail, /cannot join a producer's record/);
  });

  test("an unconfirmed reading is provisional all the way to the result", () => {
    const c = checkCertificate(
      cert({ observations: [obs("C", "0.18", "%", { confirmed: false })] }), [maxReq("C", "0.200")]);
    assert.equal(c.findings[0].result, RESULT.MEETS);
    assert.equal(c.findings[0].unconfirmed, 1);
    assert.equal(c.overall, OVERALL.INCOMPLETE_EVIDENCE, "a result resting on an unchecked reading is not complete");
    assert.match(c.documentIssues.find((d) => d.id === "unconfirmed").detail, /not the certificate/);
  });
});

/* ------------------------------------------------------------- the verdict */

describe("the overall state is the worst of its parts", () => {
  const many = (n) => Array.from({ length: n }, (_, i) => maxReq(`E${i}`, "1.000"));
  const passing = (n) => Array.from({ length: n }, (_, i) => obs(`E${i}`, "0.100"));

  test("one unmet mandatory requirement is the answer, whatever else passes", () => {
    const reqs = [...many(20), minReq("UTS", "400")];
    const observations = [...passing(20), obs("UTS", "350", "MPa")];
    const c = checkCertificate(cert({ observations }), reqs);
    assert.equal(c.counts[RESULT.MEETS], 20);
    assert.equal(c.overall, OVERALL.POTENTIAL_NONCONFORMANCE);
    assert.equal(c.headline.kind, "nonconformance");
    assert.match(c.headline.text, /UTS/);
  });

  test("a nonconformance outranks missing evidence", () => {
    const c = checkCertificate(
      cert({ observations: [obs("C", "0.30")] }),
      [maxReq("C", "0.200"), maxReq("S", "0.030")]);
    assert.equal(c.overall, OVERALL.POTENTIAL_NONCONFORMANCE);
  });

  test("an informative requirement does not set the overall state", () => {
    const c = checkCertificate(
      cert({ observations: [obs("C", "0.30")] }),
      [maxReq("C", "0.200", "%", { mandatory: false })]);
    assert.equal(c.findings[0].result, RESULT.DOES_NOT_MEET);
    assert.equal(c.overall, OVERALL.MEETS_CHECKED);
  });

  test("everything passing says so, and says what it is not", () => {
    const c = checkCertificate(cert({ observations: [obs("C", "0.18")] }), [maxReq("C", "0.200")]);
    assert.equal(c.overall, OVERALL.MEETS_CHECKED);
    assert.equal(c.headline, null);
    assert.match(c.statement, /not a release of the material/);
  });

  test("nothing here can release material, in the module's own words", () => {
    const c = checkCertificate(cert({ observations: [obs("C", "0.18")] }), [maxReq("C", "0.200")]);
    assert.match(c.disclaimer, /cannot release material/);
    assert.match(c.disclaimer, /no result here is an approval/);
    assert.match(c.disclaimer, /fit for its purpose/);
  });

  test("the rules version travels with the result", () => {
    const c = checkCertificate(cert({ observations: [obs("C", "0.18")] }), [maxReq("C", "0.200")]);
    assert.equal(c.rulesVersion, RULES_VERSION);
    assert.match(c.method, new RegExp(RULES_VERSION.replace(/\./g, "\\.")));
  });
});

/* ------------------------------------------------------------- conflicts */

describe("conflicting requirements are surfaced, not resolved", () => {
  test("two documents with different limits for one property conflict", () => {
    const a = requirement({ id: "spec-c", property: "C", max: quantity("0.200", "%"), source: src() });
    const b = requirement({ id: "po-c", property: "C", max: quantity("0.150", "%"), source: src({ document: "PO-9001", revision: "1", clause: "3" }) });
    const conflicts = findConflicts([a, b]);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].requirements.length, 2);
    assert.match(conflicts[0].why, /decision for the responsible engineer/);
  });

  test("the tighter limit is not silently chosen", () => {
    const a = requirement({ id: "spec-c", property: "C", max: quantity("0.200", "%"), source: src() });
    const b = requirement({ id: "po-c", property: "C", max: quantity("0.150", "%"), source: src({ document: "PO-9001", revision: "1" }) });
    // Both are still checked, and both still report their own answer.
    const c = checkCertificate(cert({ observations: [obs("C", "0.18")] }), [a, b]);
    assert.equal(c.findings[0].result, RESULT.MEETS);
    assert.equal(c.findings[1].result, RESULT.DOES_NOT_MEET);
    assert.equal(c.conflicts.length, 1);
  });

  test("identical limits from two documents are not a conflict", () => {
    const a = requirement({ id: "a", property: "C", max: quantity("0.200", "%"), source: src() });
    const b = requirement({ id: "b", property: "C", max: quantity("0.200", "%"), source: src({ document: "PO-9001", revision: "1" }) });
    assert.equal(findConflicts([a, b]).length, 0);
  });

  test("a requirement without its document revision is refused", () => {
    assert.throws(() => requirement({ id: "x", property: "C", max: quantity("0.2", "%"), source: { document: "SPEC" } }),
      /needs the document and the exact revision/);
  });
});

/* ------------------------------------------------------------------ lots */

describe("one lot of material is one lot", () => {
  test("the lot key is the producer, heat and lot — not the certificate number", () => {
    const first = cert({ number: "SYN-CERT-0001" });
    const revised = cert({ number: "SYN-CERT-0002", revision: "2", supersedes: "SYN-CERT-0001" });
    assert.equal(lotKey(first), lotKey(revised));
  });

  test("a re-upload is recognised as the same lot", () => {
    const c = checkCertificate(cert({ observations: [obs("C", "0.18")] }), [maxReq("C", "0.200")],
      { knownLots: [lotKey(cert())] });
    assert.equal(c.repeatOfKnownLot, true);
  });

  test("a certificate with no heat number cannot be counted as a lot", () => {
    assert.equal(lotKey(cert({ heat: "" })), null);
    const c = checkCertificate(cert({ heat: "", observations: [obs("C", "0.18")] }), [maxReq("C", "0.200")]);
    assert.equal(c.lotKey, null);
    assert.match(c.documentIssues.find((d) => d.id === "lot").detail, /cannot be counted as one/);
    assert.equal(c.overall, OVERALL.INCOMPLETE_EVIDENCE);
  });

  test("a revision records what it supersedes", () => {
    const c = checkCertificate(cert({ number: "SYN-CERT-0002", supersedes: "SYN-CERT-0001", observations: [obs("C", "0.18")] }),
      [maxReq("C", "0.200")]);
    assert.equal(c.supersedes, "SYN-CERT-0001");
  });

  test("superseding keeps the old conclusion rather than editing it", () => {
    const old = checkCertificate(cert({ observations: [obs("C", "0.30")] }), [maxReq("C", "0.200")]);
    const fresh = checkCertificate(cert({ number: "SYN-CERT-0002", observations: [obs("C", "0.18")] }), [maxReq("C", "0.200")]);
    const s = supersede(old, fresh);
    assert.equal(s.superseded.overall, OVERALL.POTENTIAL_NONCONFORMANCE, "the old conclusion is unchanged");
    assert.equal(s.superseded.active, false);
    assert.equal(s.active.overall, OVERALL.MEETS_CHECKED);
    assert.match(s.why, /rewriting them would destroy the record/);
  });
});

/* ---------------------------------------------------------------- review */

describe("a person decides, and it is recorded as a person deciding", () => {
  const clean = () => checkCertificate(cert({ observations: [obs("C", "0.18")] }), [maxReq("C", "0.200")]);
  const bad = () => checkCertificate(cert({ observations: [obs("C", "0.30")] }), [maxReq("C", "0.200")]);

  test("a decision needs a reviewer and reasoning", () => {
    assert.throws(() => recordReview(clean(), { disposition: DISPOSITION.ACCEPT, reasoning: "fine" }), /needs the person/);
    assert.throws(() => recordReview(clean(), { reviewer: "QA", disposition: DISPOSITION.ACCEPT }), /needs its reasoning/);
  });

  test("pending needs neither, because nothing has been decided", () => {
    const r = recordReview(clean(), { reviewer: "QA", disposition: DISPOSITION.PENDING });
    assert.equal(r.disposition, DISPOSITION.PENDING);
  });

  test("the decision records what was true when it was made", () => {
    const r = recordReview(clean(), { reviewer: "QA", disposition: DISPOSITION.ACCEPT, reasoning: "all limits met" });
    assert.equal(r.against.overall, OVERALL.MEETS_CHECKED);
    assert.equal(r.against.rulesVersion, RULES_VERSION);
    assert.equal(r.against.certificate, "SYN-CERT-0001");
  });

  test("a concession departs from the comparison, and is marked deliberate", () => {
    // Accepting material that did not meet a requirement is what a concession
    // is. It departs — the useful distinction is whether anybody meant to.
    const r = recordReview(bad(), {
      reviewer: "QA", disposition: DISPOSITION.CONCESSION,
      reasoning: "accepted under concession CN-0007 for this application only",
    });
    assert.equal(r.departsFromFindings, true);
    assert.equal(r.deliberate, true);
    assert.match(r.note, /by design/);
  });

  test("a plain acceptance over a nonconformance departs, and nothing says it was meant", () => {
    const straight = recordReview(bad(), { reviewer: "QA", disposition: DISPOSITION.ACCEPT, reasoning: "looks fine" });
    assert.equal(straight.departsFromFindings, true);
    assert.equal(straight.deliberate, false);
    assert.match(straight.note, /differs from the comparison/);
  });

  test("a decision that follows the comparison is not marked as departing", () => {
    const ok = recordReview(clean(), { reviewer: "QA", disposition: DISPOSITION.ACCEPT, reasoning: "all limits met" });
    assert.equal(ok.departsFromFindings, false);
    assert.equal(ok.note, null);
    const reject = recordReview(bad(), { reviewer: "QA", disposition: DISPOSITION.REJECT, reasoning: "carbon out of limit" });
    assert.equal(reject.departsFromFindings, false);
  });

  test("an unknown disposition is refused", () => {
    assert.throws(() => recordReview(clean(), { reviewer: "QA", disposition: "probably ok", reasoning: "x" }), /Unknown disposition/);
  });

  test("the machine findings are not altered by the decision", () => {
    const check = bad();
    recordReview(check, { reviewer: "QA", disposition: DISPOSITION.ACCEPT, reasoning: "concession" });
    assert.equal(check.overall, OVERALL.POTENTIAL_NONCONFORMANCE);
    assert.equal(check.findings[0].result, RESULT.DOES_NOT_MEET);
  });
});

describe("the audit trail", () => {
  test("entries are ordered and each names the rules it ran under", () => {
    const trail = auditTrail([
      { kind: "certificate uploaded", at: "2026-09-14T09:00:00Z", by: "buyer" },
      { kind: "values confirmed", at: "2026-09-14T09:20:00Z", by: "buyer" },
      { kind: "comparison run", at: "2026-09-14T09:21:00Z", rulesVersion: RULES_VERSION },
      { kind: "decision recorded", at: "2026-09-14T10:00:00Z", by: "QA" },
    ]);
    assert.equal(trail.length, 4);
    assert.equal(trail[0].seq, 1);
    assert.equal(trail[3].seq, 4);
    assert.equal(trail[2].rulesVersion, RULES_VERSION);
  });
});

describe("evidence travels with every finding", () => {
  test("each result names the page it was read from", () => {
    const c = checkCertificate(cert({
      observations: [observation({
        property: "C", value: quantity("0.18", "%"),
        source: { file: "synthetic-cert.pdf", page: 2, quote: "C 0.18" }, confirmed: true,
      })],
    }), [maxReq("C", "0.200")]);
    assert.equal(c.findings[0].evidence[0].page, 2);
    assert.equal(c.findings[0].evidence[0].quote, "C 0.18");
  });

  test("each requirement names the clause it came from", () => {
    const c = checkCertificate(cert({ observations: [obs("C", "0.18")] }), [maxReq("C", "0.200")]);
    assert.equal(c.findings[0].source.document, "SYN-SPEC-100");
    assert.equal(c.findings[0].source.revision, "C");
    assert.equal(c.findings[0].source.clause, "7.2");
  });

  test("an observation with no source is refused", () => {
    assert.throws(() => observation({ property: "C", value: quantity("0.18", "%") }),
      /needs the file and page/);
    assert.throws(() => observation({ property: "C", value: quantity("0.18", "%"), source: { file: "c.pdf" } }),
      /needs the file and page/);
  });
});

describe("a revision belongs to its own document", () => {
  const specReq = maxReq("C", "0.200");
  const drawingReq = requirement({
    id: "cond", property: "condition", kind: KIND.TEXT, expected: "normalised",
    source: { document: "SYN-DRW-4471", revision: "B", clause: "note 3" },
  });

  test("a drawing at revision B does not make a certificate at specification revision C wrong", () => {
    // This fired on a perfectly ordinary set of inputs before it was fixed:
    // requirements come from several documents, and a revision letter only
    // means something against the document it belongs to.
    const c = checkCertificate(
      cert({ statedSpecification: "SYN-SPEC-100", statedRevision: "C", observations: [obs("C", "0.18")] }),
      [specReq, drawingReq]);
    assert.equal(c.documentIssues.some((d) => d.id === "revision"), false,
      "a warning that fires on ordinary inputs teaches people to ignore it");
  });

  test("a mismatch within the same document still fires", () => {
    const older = requirement({
      id: "old-c", property: "C", max: quantity("0.150", "%"),
      source: { document: "SYN-SPEC-100", revision: "B", clause: "7.2" },
    });
    const c = checkCertificate(
      cert({ statedSpecification: "SYN-SPEC-100", statedRevision: "C", observations: [obs("C", "0.18")] }),
      [older]);
    const issue = c.documentIssues.find((d) => d.id === "revision");
    assert.ok(issue);
    assert.match(issue.detail, /of the same document/);
  });

  test("a certificate that names no specification raises nothing", () => {
    const c = checkCertificate(
      cert({ statedSpecification: "", statedRevision: "C", observations: [obs("C", "0.18")] }),
      [specReq]);
    assert.equal(c.documentIssues.some((d) => d.id === "revision"), false);
  });
});
