/**
 * BATNA assessment.
 *
 * This is the first part of the engine that depends on facts the product cannot
 * obtain for itself, so most of these tests are about ignorance rather than
 * arithmetic.
 *
 * The failure being guarded is specific and serious: a buyer who believes they
 * can walk away, and cannot, has been handed a worse position than one who
 * knows they are stuck. A confident BATNA resting on a name and some optimism
 * would do exactly that.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  fact, unknown, alternative, assessBatna,
  KNOWN, READINESS, STRENGTH, MATERIAL,
} from "../../src/calc/batna.mjs";
import { moneyFromDecimal, moneyToDecimalString as str, ratioFromPercent as pc } from "../../src/calc/exact.mjs";
import { costBridge } from "../../src/calc/cost-bridge.mjs";
import { assessEvidence } from "../../src/calc/evidence.mjs";
import { prepareNegotiation } from "../../src/calc/negotiation.mjs";

const gbp = (x) => moneyFromDecimal(x, "GBP");

/** Every material attribute evidenced. */
const allKnown = (state = KNOWN.SUPPLIED, src = null) =>
  Object.fromEntries(MATERIAL.map((m) => [m.id, fact("yes", state, src)]));

const half = () => Object.fromEntries(MATERIAL.slice(0, 3).map((m) => [m.id, fact("yes", KNOWN.SUPPLIED)]));

describe("a fact records how it is known", () => {
  test("supplied, cited and assumed are all knowledge; unknown is not", () => {
    assert.equal(fact("yes", KNOWN.SUPPLIED).known, true);
    assert.equal(fact("yes", KNOWN.CITED, { label: "ISO register" }).known, true);
    assert.equal(fact("probably", KNOWN.ASSUMED).known, true);
    assert.equal(unknown().known, false);
  });

  test("only supplied and cited count as evidence", () => {
    // An assumption is written down, which is not the same as established.
    assert.equal(fact("yes", KNOWN.SUPPLIED).evidenced, true);
    assert.equal(fact("yes", KNOWN.CITED, { label: "register" }).evidenced, true);
    assert.equal(fact("probably", KNOWN.ASSUMED).evidenced, false);
    assert.equal(unknown().evidenced, false);
  });

  test("a cited fact without a source is refused", () => {
    assert.throws(() => fact("AS9100", KNOWN.CITED), /needs its source/);
    assert.throws(() => fact("AS9100", KNOWN.CITED, { label: "  " }), /needs its source/);
  });

  test("the source travels with the fact", () => {
    const f = fact("AS9100", KNOWN.CITED, { label: "certification register", url: "https://example.invalid/x" });
    assert.equal(f.source.label, "certification register");
    assert.equal(f.source.url, "https://example.invalid/x");
  });

  test("an unknown cannot smuggle a value", () => {
    assert.throws(() => fact("probably fine", KNOWN.UNKNOWN), /cannot carry a value/);
    assert.equal(unknown().value, null);
  });

  test("an invented state is refused", () => {
    assert.throws(() => fact("x", "probably"), /Not a knowledge state/);
  });
});

describe("an alternative", () => {
  test("every material attribute exists, as an explicit unknown if nobody filled it in", () => {
    // An absent field is invisible; an explicit unknown is a question.
    const a = alternative({ supplier: "Northgate Precision" });
    assert.equal(Object.keys(a.facts).length, MATERIAL.length);
    assert.equal(a.unknownCount, MATERIAL.length);
    assert.equal(a.evidencedCount, 0);
  });

  test("open questions are phrased for a buyer, not as field names", () => {
    const a = alternative({ supplier: "Northgate Precision" });
    assert.ok(a.openQuestions.includes("holds the required certifications"));
    assert.equal(/certifications:/.test(a.openQuestions.join(" ")), false);
  });

  test("it needs a name", () => {
    assert.throws(() => alternative({}), /needs a supplier name/);
    assert.throws(() => alternative({ supplier: "  " }), /needs a supplier name/);
  });

  test("an attribute outside the material set is refused", () => {
    // A long checklist invites filling it in with guesses.
    assert.throws(() => alternative({ supplier: "X", facts: { favouriteColour: fact("blue", KNOWN.SUPPLIED) } }),
      /not a material attribute/);
  });

  test("citations are collected from the facts that carry them", () => {
    const a = alternative({ supplier: "X", facts: allKnown(KNOWN.CITED, { label: "register" }) });
    assert.equal(a.citations.length, MATERIAL.length);
    assert.equal(a.citations[0].label, "register");
  });

  test("an unrecognised readiness is refused", () => {
    assert.throws(() => alternative({ supplier: "X", readiness: "nearly" }), /Not a readiness/);
  });
});

describe("whether it could be used in time", () => {
  const candidate = (weeks) => alternative({ supplier: "Northgate", readiness: READINESS.CANDIDATE, qualificationWeeks: weeks, facts: allKnown() });

  test("qualification inside the notice period is usable", () => {
    const r = assessBatna({ alternatives: [candidate(8)], noticePeriodWeeks: 12 });
    assert.equal(r.viable.length, 1);
    assert.match(r.alternatives[0].timing, /8 weeks to qualify against 12 weeks/);
  });

  test("qualification longer than notice is not", () => {
    const r = assessBatna({ alternatives: [candidate(26)], noticePeriodWeeks: 12 });
    assert.equal(r.viable.length, 0);
    assert.match(r.alternatives[0].timing, /exceeds 12 weeks/);
  });

  test("an already-qualified supplier needs no lead time", () => {
    const r = assessBatna({
      alternatives: [alternative({ supplier: "N", readiness: READINESS.QUALIFIED, facts: allKnown() })],
      noticePeriodWeeks: 4,
    });
    assert.equal(r.viable.length, 1);
    assert.match(r.alternatives[0].timing, /already qualified/);
  });

  test("an unestimated qualification time is not usable, rather than assumed quick", () => {
    const r = assessBatna({ alternatives: [alternative({ supplier: "N", facts: allKnown() })], noticePeriodWeeks: 12 });
    assert.equal(r.viable.length, 0);
    assert.match(r.alternatives[0].timing, /has not been estimated/);
  });

  test("no recorded notice period means nothing can be timed", () => {
    const r = assessBatna({ alternatives: [candidate(4)] });
    assert.equal(r.viable.length, 0);
    assert.match(r.alternatives[0].timing, /notice period is not recorded/);
    assert.ok(r.openQuestions.some((q) => /notice period/.test(q)));
  });

  test("a stated blocker overrides good timing", () => {
    const blocked = alternative({
      supplier: "N", readiness: READINESS.QUALIFIED, facts: allKnown(),
      blockers: ["customer approval withheld"],
    });
    const r = assessBatna({ alternatives: [blocked], noticePeriodWeeks: 12 });
    assert.equal(r.viable.length, 0);
    assert.equal(r.alternatives[0].blocked, true);
  });
});

describe("strength is a band with its reason", () => {
  test("nothing recorded is none, not weak", () => {
    const r = assessBatna({ noticePeriodWeeks: 12 });
    assert.equal(r.strength, STRENGTH.NONE);
    assert.match(r.rule, /nothing to fall back on/);
  });

  test("a qualified, evidenced alternative inside notice is strong", () => {
    const r = assessBatna({
      alternatives: [alternative({ supplier: "N", readiness: READINESS.QUALIFIED, facts: allKnown() })],
      noticePeriodWeeks: 12,
    });
    assert.equal(r.strength, STRENGTH.STRONG);
  });

  test("qualifiable but not yet qualified is moderate", () => {
    const r = assessBatna({
      alternatives: [alternative({ supplier: "N", readiness: READINESS.CANDIDATE, qualificationWeeks: 8, facts: allKnown() })],
      noticePeriodWeeks: 12,
    });
    assert.equal(r.strength, STRENGTH.MODERATE);
  });

  test("alternatives that cannot be used in time are weak, and it says why", () => {
    const r = assessBatna({
      alternatives: [alternative({ supplier: "N", qualificationWeeks: 26, facts: allKnown() })],
      noticePeriodWeeks: 12,
    });
    assert.equal(r.strength, STRENGTH.WEAK);
    assert.match(r.rule, /cannot be used before supply stops|cannot be in place inside the notice period/);
    assert.match(r.rule, /is not leverage/);
  });

  test("a sole source has no BATNA at any notice period", () => {
    const r = assessBatna({
      alternatives: [alternative({ supplier: "N", readiness: READINESS.QUALIFIED, facts: allKnown() })],
      noticePeriodWeeks: 52, criticality: "single-source",
    });
    assert.equal(r.strength, STRENGTH.NONE);
    assert.match(r.rule, /no alternative to fall back on at any notice period/);
  });
});

describe("the evidence cap", () => {
  test("a promising name nobody has checked cannot be moderate", () => {
    // 8 weeks against 12 weeks' notice reads moderate on timing alone.
    const r = assessBatna({
      alternatives: [alternative({ supplier: "Unknown Co", readiness: READINESS.CANDIDATE, qualificationWeeks: 8 })],
      noticePeriodWeeks: 12,
    });
    assert.equal(r.strength, STRENGTH.WEAK);
    assert.equal(r.cappedByEvidence, true);
    assert.match(r.rule, /only 0 of 6 material attributes/);
    assert.match(r.rule, /nobody has checked is not leverage/);
  });

  test("a qualified supplier nobody has checked is capped too", () => {
    const r = assessBatna({
      alternatives: [alternative({ supplier: "N", readiness: READINESS.QUALIFIED })],
      noticePeriodWeeks: 12,
    });
    assert.equal(r.strength, STRENGTH.WEAK);
    assert.equal(r.cappedByEvidence, true);
  });

  test("half the attributes evidenced clears the cap", () => {
    const r = assessBatna({
      alternatives: [alternative({ supplier: "N", readiness: READINESS.QUALIFIED, facts: half() })],
      noticePeriodWeeks: 12,
    });
    assert.equal(r.strength, STRENGTH.STRONG);
    assert.equal(r.cappedByEvidence, false);
  });

  test("assumptions do not clear the cap", () => {
    // Writing something down is not establishing it.
    const r = assessBatna({
      alternatives: [alternative({ supplier: "N", readiness: READINESS.QUALIFIED, facts: allKnown(KNOWN.ASSUMED) })],
      noticePeriodWeeks: 12,
    });
    assert.equal(r.strength, STRENGTH.WEAK);
    assert.equal(r.cappedByEvidence, true);
  });

  test("citations clear it, since they are evidence", () => {
    const r = assessBatna({
      alternatives: [alternative({ supplier: "N", readiness: READINESS.QUALIFIED, facts: allKnown(KNOWN.CITED, { label: "register" }) })],
      noticePeriodWeeks: 12,
    });
    assert.equal(r.strength, STRENGTH.STRONG);
  });
});

describe("ranking is by stated factors", () => {
  test("readiness first, then timing, then how much is known", () => {
    const r = assessBatna({
      noticePeriodWeeks: 12,
      alternatives: [
        alternative({ supplier: "Candidate", readiness: READINESS.CANDIDATE, qualificationWeeks: 4, facts: allKnown() }),
        alternative({ supplier: "Qualified", readiness: READINESS.QUALIFIED, facts: allKnown() }),
        alternative({ supplier: "InProgress", readiness: READINESS.IN_QUALIFICATION, qualificationWeeks: 6, facts: allKnown() }),
      ],
    });
    assert.deepEqual(r.alternatives.map((a) => a.supplier), ["Qualified", "InProgress", "Candidate"]);
    assert.equal(r.best.supplier, "Qualified");
  });

  test("between equals, the better-evidenced one leads", () => {
    const r = assessBatna({
      noticePeriodWeeks: 12,
      alternatives: [
        alternative({ supplier: "Thin", readiness: READINESS.QUALIFIED }),
        alternative({ supplier: "Checked", readiness: READINESS.QUALIFIED, facts: allKnown() }),
      ],
    });
    assert.equal(r.alternatives[0].supplier, "Checked");
  });
});

describe("what would change the answer", () => {
  test("it names the questions rather than leaving them implied", () => {
    const r = assessBatna({
      alternatives: [alternative({ supplier: "Northgate", readiness: READINESS.CANDIDATE })],
      noticePeriodWeeks: 12,
    });
    assert.ok(r.openQuestions.some((q) => /Estimate qualification time for Northgate/.test(q)));
    assert.ok(r.openQuestions.some((q) => /holds the required certifications/.test(q)));
  });

  test("with nothing recorded it points at discovery", () => {
    assert.ok(assessBatna({}).openQuestions.some((q) => /Supplier Discovery/.test(q)));
  });

  test("a sole source is told what is carrying the verdict", () => {
    const r = assessBatna({ criticality: "critical" });
    assert.ok(r.openQuestions.some((q) => /single-source designation still holds/.test(q)));
  });
});

describe("the switching breakeven", () => {
  test("it is years of the disputed amount, and labelled an assumption", () => {
    const r = assessBatna({
      alternatives: [alternative({ supplier: "N", readiness: READINESS.QUALIFIED, facts: allKnown() })],
      noticePeriodWeeks: 12,
      switchingCost: gbp("390000.00"),
      annualDisputed: gbp("195000.00"),
    });
    assert.equal(r.breakeven.yearsApprox, 2);
    assert.match(r.breakeven.assumption, /would match today's price/);
  });

  test("nothing in dispute means no breakeven rather than a division by zero", () => {
    const r = assessBatna({ switchingCost: gbp("100.00"), annualDisputed: gbp("0.00") });
    assert.equal(r.breakeven, null);
  });
});

describe("it hands the negotiation a real position", () => {
  test("the position counts viable alternatives, not names on a list", () => {
    const r = assessBatna({
      noticePeriodWeeks: 12,
      alternatives: [
        alternative({ supplier: "TooSlow", qualificationWeeks: 40, facts: allKnown() }),
        alternative({ supplier: "Usable", readiness: READINESS.QUALIFIED, facts: allKnown() }),
      ],
    });
    assert.equal(r.position.alternatives, 1, "a supplier who cannot be used in time is not an alternative");
    assert.equal(r.position.noticePeriodWeeks, 12);
  });

  test("it carries the best qualification time through", () => {
    const r = assessBatna({
      noticePeriodWeeks: 12,
      alternatives: [alternative({ supplier: "N", readiness: READINESS.CANDIDATE, qualificationWeeks: 8, facts: allKnown() })],
    });
    assert.equal(r.position.qualificationWeeks, 8);
  });
});

describe("the method disclaims what it is", () => {
  const r = assessBatna({ alternatives: [alternative({ supplier: "N" })], noticePeriodWeeks: 12 });

  test("an unknown never counts in favour", () => {
    assert.match(r.method, /an unknown never counts in favour/);
  });

  test("nothing is inferred from a name or a website", () => {
    assert.match(r.method, /No capability here is inferred from a supplier's name, sector or website/);
  });

  test("the cap is explained rather than hidden", () => {
    assert.match(r.method, /capped at weak when less than half/);
  });
});

describe("it drives the negotiation's walk-away verdict", () => {
  const bridge = () => costBridge({
    baseline: { unitPrice: gbp("100.00"), annualVolume: 50_000 },
    requestedChange: pc("9"),
    drivers: [{ id: "s", label: "Steel", weight: pc("40"), indexMovement: pc("10") }],
  });
  const plan = (batna) => prepareNegotiation({ bridge: bridge(), ev: assessEvidence(bridge(), {}), batna });

  test("a qualified, checked alternative makes leaving credible", () => {
    const b = assessBatna({
      alternatives: [alternative({ supplier: "Northgate", readiness: READINESS.QUALIFIED, facts: allKnown() })],
      noticePeriodWeeks: 12,
    });
    const w = plan(b).walkAway;
    assert.equal(w.credibility, "credible");
    assert.equal(w.strength, STRENGTH.STRONG);
    assert.equal(w.fromAssessedAlternatives, true);
  });

  test("a qualified alternative nobody has checked does not", () => {
    // This is the case the whole module exists for: the naive reading is
    // "we have a qualified alternative", and it is not leverage.
    const b = assessBatna({
      alternatives: [alternative({ supplier: "Unknown Co", readiness: READINESS.QUALIFIED })],
      noticePeriodWeeks: 12,
    });
    const w = plan(b).walkAway;
    assert.equal(w.credibility, "not-credible");
    assert.equal(w.cappedByEvidence, true);
  });

  test("the plan carries what would change the answer", () => {
    const b = assessBatna({
      alternatives: [alternative({ supplier: "Northgate", readiness: READINESS.CANDIDATE })],
      noticePeriodWeeks: 12,
    });
    const w = plan(b).walkAway;
    assert.ok(w.openQuestions.length > 0);
    assert.ok(w.openQuestions.some((q) => /Estimate qualification time/.test(q)));
  });

  test("the verdict and the rule come from one place, so they cannot disagree", () => {
    const b = assessBatna({ criticality: "single-source", noticePeriodWeeks: 52 });
    const w = plan(b).walkAway;
    assert.equal(w.rule, b.rule);
    assert.equal(w.credibility, "not-credible");
  });

  test("without a BATNA the original position fields still work", () => {
    const n = prepareNegotiation({
      bridge: bridge(), ev: assessEvidence(bridge(), {}),
      position: { alternatives: 2, qualificationWeeks: 26, noticePeriodWeeks: 12 },
    });
    assert.equal(n.walkAway.credibility, "not-credible");
    assert.equal(n.walkAway.fromAssessedAlternatives, undefined);
  });
});
