/**
 * What if we did it differently?
 *
 * Three things matter more than the arithmetic, and `specs/06` states all
 * three outright.
 *
 * A scenario is a copy, and nothing about exploring one may change the plan —
 * a tool that quietly moved the plan while somebody looked at an option would
 * make looking at options dangerous, which is the one thing a what-if must
 * never be.
 *
 * Missing inputs produce questions, not "estimated facts disguised as
 * answers". The disguise is what makes them dangerous: somebody repeats a
 * number in a meeting, and nobody repeats a question.
 *
 * And the money is exact, because a scenario comparison is precisely where a
 * rounded penny per unit becomes a wrong answer at fifty thousand units.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  whatIf, questionsFor, adopt, stillAbout, newScenarioId,
  SCENARIO, SCENARIO_TITLE, NEEDS,
} from "../../src/calc/scenarios.mjs";
import { moneyFromDecimal, moneyToDecimalString } from "../../src/calc/exact.mjs";

const base = (over = {}) => ({
  id: "PLAN-1", revision: 2,
  unitPrice: moneyFromDecimal("100.00", "GBP"),
  ...over,
});

const SPLIT_IN = {
  firstQuantity: "200", totalQuantity: "500", secondFreight: "450.00",
  firstDate: "2026-10-01", secondDate: "2026-11-15",
};
const EXPEDITE_IN = {
  quantity: "500", premiumPerUnit: "1.25", newDate: "2026-10-05",
  confirmedBy: "the carrier",
};
const ALT_IN = {
  availableQuantity: "300", unitCost: "92.50", leadTimeDays: "21",
  suitabilityReviewedBy: "an engineer",
};

/* ------------------------------------------------------ questions, not facts */

describe("missing inputs produce questions", () => {
  test("with nothing supplied, there are no figures at all", () => {
    /* Not a partial comparison, not the axes that happen to be answerable — a
       scenario showing three of four columns invites somebody to read the
       three. */
    for (const kind of Object.values(SCENARIO)) {
      const s = whatIf(kind, { base: base(), inputs: {} });
      assert.equal(s.ready, false, kind);
      assert.equal(s.compared, null, kind);
      assert.ok(s.questions.length > 0, kind);
    }
  });

  test("and it says so rather than looking empty", () => {
    const s = whatIf(SCENARIO.SPLIT, { base: base(), inputs: {} });
    assert.match(s.said, /cannot be worked out yet/);
    assert.match(s.said, /guess wearing an answer's clothes/);
  });

  test("each question is a question, not a field label", () => {
    /* "freightCost" is a form label. "What does the second delivery cost in
       freight?" is answerable by somebody who does not know the schema. */
    for (const kind of Object.values(SCENARIO)) {
      for (const q of questionsFor(kind, {})) {
        assert.match(q.question, /\?$/, `${kind}: ${q.question}`);
        assert.ok(q.field, "a question with no field cannot be answered");
        /* Not the field name with a question mark on it. "And the second?" is
           three words and a perfectly good question in sequence — a word count
           was the wrong test for what this is actually about. */
        assert.notEqual(q.question.replace(/[^a-z]/gi, "").toLowerCase(),
          q.field.toLowerCase(), q.field);
        assert.match(q.question, /^[A-Z]/, q.question);
      }
    }
  });

  test("one missing input is still enough to withhold everything", () => {
    /* Partial is not ready. Four of five answered is the most tempting moment
       to show what can be shown. */
    for (const [kind, inputs] of [[SCENARIO.SPLIT, SPLIT_IN],
                                  [SCENARIO.EXPEDITE, EXPEDITE_IN],
                                  [SCENARIO.ALTERNATIVE, ALT_IN]]) {
      for (const [field] of NEEDS[kind]) {
        const short = { ...inputs };
        delete short[field];
        const s = whatIf(kind, { base: base(), inputs: short });
        assert.equal(s.ready, false, `${kind} proceeded without ${field}`);
        assert.equal(s.compared, null, `${kind} produced figures without ${field}`);
      }
    }
  });

  test("blank is missing, and so is whitespace", () => {
    const s = whatIf(SCENARIO.EXPEDITE, { base: base(), inputs: { ...EXPEDITE_IN, confirmedBy: "   " } });
    assert.equal(s.ready, false);
  });

  test("the confirmations specs/06 names are required, not optional extras", () => {
    /* An expediting date nobody stands behind is the expensive kind of
       optimism, and a cheaper alternative nobody has reviewed is not a
       saving. */
    assert.ok(NEEDS[SCENARIO.EXPEDITE].some(([f]) => f === "confirmedBy"));
    assert.ok(NEEDS[SCENARIO.ALTERNATIVE].some(([f]) => f === "suitabilityReviewedBy"));
  });
});

/* ------------------------------------------------------------ it is a copy */

describe("a scenario is a copy", () => {
  test("it carries a badge saying it is not the plan", () => {
    /* A field rather than a caller's styling choice, so a surface cannot
       render a scenario as though it were the plan. */
    const s = whatIf(SCENARIO.SPLIT, { base: base(), inputs: SPLIT_IN });
    assert.match(s.badge, /NOT THE PLAN/);
  });

  test("it records which plan and which revision it was explored against", () => {
    const s = whatIf(SCENARIO.SPLIT, { base: base(), inputs: SPLIT_IN });
    assert.equal(s.basedOn.planId, "PLAN-1");
    assert.equal(s.basedOn.revision, 2);
  });

  test("and nothing about it touches the plan", () => {
    const plan = base();
    const before = JSON.stringify({ ...plan, unitPrice: String(plan.unitPrice.minor) });
    whatIf(SCENARIO.EXPEDITE, { base: plan, inputs: EXPEDITE_IN });
    whatIf(SCENARIO.ALTERNATIVE, { base: plan, inputs: ALT_IN });
    assert.equal(JSON.stringify({ ...plan, unitPrice: String(plan.unitPrice.minor) }), before);
  });

  test("two scenarios of the same kind are distinguishable", () => {
    assert.notEqual(newScenarioId(SCENARIO.SPLIT), newScenarioId(SCENARIO.SPLIT));
  });

  test("a scenario knows when the plan has moved past it", () => {
    /* One adopted against a revision the plan has since passed is a decision
       about something that no longer exists. */
    const s = whatIf(SCENARIO.SPLIT, { base: base(), inputs: SPLIT_IN });
    assert.equal(stillAbout(s, base()), true);
    assert.equal(stillAbout(s, base({ revision: 3 })), false);
    assert.equal(stillAbout(s, base({ id: "PLAN-2" })), false);
  });

  test("it refuses a plan with no exact money", () => {
    assert.throws(() => whatIf(SCENARIO.SPLIT, { base: { id: "P" }, inputs: SPLIT_IN }),
      /with exact money/);
    assert.throws(
      () => whatIf(SCENARIO.SPLIT, { base: { unitPrice: { minor: 100 } }, inputs: SPLIT_IN }),
      /with exact money/);
  });

  test("and a kind it has never heard of", () => {
    assert.throws(() => whatIf("teleport-it", { base: base() }), /not a scenario this understands/);
  });
});

/* ------------------------------------------------------------ the arithmetic */

describe("splitting a delivery", () => {
  const s = () => whatIf(SCENARIO.SPLIT, { base: base(), inputs: SPLIT_IN });

  test("the cost is the second delivery's freight, exactly", () => {
    assert.equal(moneyToDecimalString(s().compared.cost.extra), "450.00");
  });

  test("the unit price is left alone, and it says why", () => {
    /* Whether a supplier would reprice a split is a thing to ask them, not a
       thing to model. */
    assert.match(s().compared.cost.said, /unit price is unchanged/);
    assert.match(s().compared.cost.said, /question for them/);
  });

  test("the shortfall is the part the first delivery does not cover", () => {
    assert.equal(s().compared.service.short, 300n);
    assert.match(s().compared.service.said, /300 are not covered/);
  });

  test("a first delivery covering everything is not a shortfall", () => {
    const whole = whatIf(SCENARIO.SPLIT, {
      base: base(), inputs: { ...SPLIT_IN, firstQuantity: "500" },
    });
    assert.equal(whole.compared.service.short, 0n);
    assert.match(whole.compared.service.said, /covers the whole requirement/);
  });

  test("a first delivery larger than the total is a mistake, not a negative", () => {
    assert.throws(() => whatIf(SCENARIO.SPLIT, {
      base: base(), inputs: { ...SPLIT_IN, firstQuantity: "900" },
    }), /Check which is which/);
  });

  test("both dates are carried as given", () => {
    assert.equal(s().compared.timing.firstDate, "2026-10-01");
    assert.equal(s().compared.timing.secondDate, "2026-11-15");
  });
});

describe("expediting", () => {
  const s = () => whatIf(SCENARIO.EXPEDITE, { base: base(), inputs: EXPEDITE_IN });

  test("the premium multiplies exactly across the quantity", () => {
    /* 500 × 1.25 is 625.00 and not 624.99. This is the multiplication a
       floating-point version gets wrong at scale. */
    assert.equal(moneyToDecimalString(s().compared.cost.extra), "625.00");
  });

  test("a fractional penny per unit does not disappear", () => {
    const odd = whatIf(SCENARIO.EXPEDITE, {
      base: base(), inputs: { ...EXPEDITE_IN, quantity: "70000", premiumPerUnit: "0.01" },
    });
    assert.equal(moneyToDecimalString(odd.compared.cost.extra), "700.00");
  });

  test("who confirmed the date travels with it", () => {
    assert.match(s().compared.timing.said, /confirmed by the carrier/);
  });

  test("the whole quantity arrives, so nothing is short", () => {
    assert.equal(s().compared.service.short, 0n);
  });
});

describe("sourcing elsewhere", () => {
  const s = () => whatIf(SCENARIO.ALTERNATIVE, { base: base(), inputs: ALT_IN });

  test("a cheaper alternative is a difference, not a saving", () => {
    /* A cheaper source that cannot be used is not a saving, and whether it
       can be used is the suitability review. */
    const c = s().compared.cost;
    assert.equal(c.extra, null);
    assert.equal(moneyToDecimalString(c.lower), "2250.00");
    assert.match(c.said, /A difference, not a saving/);
  });

  test("a dearer one is reported as extra", () => {
    const dear = whatIf(SCENARIO.ALTERNATIVE, {
      base: base(), inputs: { ...ALT_IN, unitCost: "112.00" },
    });
    assert.equal(dear.compared.cost.lower, null);
    assert.equal(moneyToDecimalString(dear.compared.cost.extra), "3600.00");
    assert.match(dear.compared.cost.said, /more than the plan/);
  });

  test("it does not claim the alternative covers the requirement", () => {
    /* It has not been told what the requirement is. */
    assert.equal(s().compared.service.short, null);
    assert.match(s().compared.service.said, /depends on the requirement, which this has not been told/);
  });

  test("the reviewer is named among what is unresolved", () => {
    assert.match(s().compared.unresolved.join(" "), /an engineer's review covers this application/);
  });

  test("a different currency is refused rather than converted", () => {
    /* The first version of this passed for the wrong reason: the module built
       the alternative's amount using the plan's own currency, so the check
       compared a value with itself and could never fire. The alternative
       carries its own currency now, and converting would need a dated sourced
       rate that fx.mjs refuses to invent. */
    assert.throws(() => whatIf(SCENARIO.ALTERNATIVE, {
      base: base(), inputs: { ...ALT_IN, unitCostCurrency: "EUR" },
    }), /dated, sourced rate/);
  });

  test("and the same currency stated explicitly is fine", () => {
    const same = whatIf(SCENARIO.ALTERNATIVE, {
      base: base(), inputs: { ...ALT_IN, unitCostCurrency: "gbp" },
    });
    assert.equal(same.ready, true);
  });
});

/* ---------------------------------------------------------- the four axes */

describe("four axes, never one score", () => {
  test("each ready scenario fills all four", () => {
    for (const [kind, inputs] of [[SCENARIO.SPLIT, SPLIT_IN],
                                  [SCENARIO.EXPEDITE, EXPEDITE_IN],
                                  [SCENARIO.ALTERNATIVE, ALT_IN]]) {
      const c = whatIf(kind, { base: base(), inputs }).compared;
      for (const axis of ["cost", "timing", "service", "unresolved"]) {
        assert.ok(c[axis], `${kind} has no ${axis}`);
      }
      assert.ok(c.unresolved.length > 0, `${kind} claims nothing is unresolved`);
    }
  });

  test("nothing is scored or totalled into one number", () => {
    /* A composite would let a large cost saving outvote a missed build date,
       which is a judgement nobody asked this to make. */
    for (const [kind, inputs] of [[SCENARIO.SPLIT, SPLIT_IN],
                                  [SCENARIO.EXPEDITE, EXPEDITE_IN],
                                  [SCENARIO.ALTERNATIVE, ALT_IN]]) {
      const s = whatIf(kind, { base: base(), inputs });
      for (const key of ["score", "rank", "total", "best", "recommended"]) {
        assert.equal(key in s, false, `${kind} carries a ${key}`);
        assert.equal(key in s.compared, false, `${kind}'s comparison carries a ${key}`);
      }
    }
  });

  test("every kind has a name a person would say out loud", () => {
    for (const kind of Object.values(SCENARIO)) {
      assert.ok(SCENARIO_TITLE[kind], kind);
      assert.match(SCENARIO_TITLE[kind], /^[A-Z]/, kind);
    }
  });
});

/* -------------------------------------------------------------- adopting */

describe("adopting one is a deliberate act", () => {
  const ready = () => whatIf(SCENARIO.SPLIT, { base: base(), inputs: SPLIT_IN });

  test("it records who and when, and what it was based on", () => {
    const a = adopt(ready(), "a buyer");
    assert.equal(a.adopted.by, "a buyer");
    assert.match(a.adopted.at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(a.adopted.from.planId, "PLAN-1");
    assert.equal(a.adopted.from.revision, 2);
  });

  test("an unattributed adoption is refused", () => {
    assert.throws(() => adopt(ready()), /record who did it/);
  });

  test("a scenario still missing inputs cannot be adopted", () => {
    /* There is nothing settled to adopt. */
    assert.throws(() => adopt(whatIf(SCENARIO.SPLIT, { base: base(), inputs: {} }), "a buyer"),
      /still missing inputs/);
  });

  test("adopting produces a record rather than changing anything", () => {
    /* The caller applies it. This is the evidence somebody chose to. */
    const s = ready();
    const a = adopt(s, "a buyer");
    assert.equal(s.adopted, null, "adopting mutated the scenario it was given");
    assert.notEqual(a.adopted, null);
    assert.equal(a.id, s.id);
  });

  test("nothing anywhere commits to a supplier", () => {
    /* `specs/06`: no automatic supplier commitment. */
    const a = adopt(ready(), "a buyer");
    const text = JSON.stringify(a, (k, v) => (typeof v === "bigint" ? String(v) : v));
    assert.equal(/\b(order(ed|s)? placed|committed to|reserved|booked|confirmed with the supplier)\b/i
      .test(text), false, text);
  });
});
