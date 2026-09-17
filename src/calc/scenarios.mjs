/**
 * What if we did it differently?
 *
 * `specs/06-SCENARIOS-AND-SPECIALISTS.md`: *"'What if?' creates a scenario
 * copy with an explicit badge. Split delivery needs quantities/dates/
 * capacities and freight costs; expedite needs confirmed transit alternatives
 * and premium; alternative stock needs available quantity, suitability
 * review, cost and lead time. Missing inputs produce questions, not estimated
 * facts disguised as answers."*
 *
 * And `specs/02`'s gate for the phase: *"all numeric impacts come from tested
 * calculation functions using confirmed inputs; missing assumptions visibly
 * block results; scenario never mutates the actual plan without
 * confirmation."*
 *
 * Three rules follow from that, and they are the whole module:
 *
 *   - **A scenario is a copy.** It records what it was based on and changes
 *     nothing. Adopting one is a separate, deliberate act with a name against
 *     it. A tool that quietly moved the plan while somebody explored an
 *     option would make exploring the option dangerous, which is the one
 *     thing a what-if must never be.
 *   - **Missing inputs produce questions.** Not a figure with a caveat, not a
 *     range, not a default. `specs/06` is unusually blunt about this —
 *     "estimated facts disguised as answers" — because the disguise is what
 *     makes them dangerous. Somebody repeats a number in a meeting; nobody
 *     repeats a question.
 *   - **The money is exact.** Integer minor units on BigInt, the same
 *     convention as everything else in `src/calc`. A scenario comparison is
 *     precisely where a rounded penny per unit becomes a wrong answer at
 *     fifty thousand units.
 *
 * Nothing here contacts a supplier, reserves anything, or commits to
 * anything. `specs/06`: *"No automatic supplier commitment."*
 */

import {
  moneyAdd, moneySub, moneyTimesQuantity, moneyToDecimalString, assertSameCurrency,
} from "./exact.mjs";

/** The three `specs/06` names. */
export const SCENARIO = Object.freeze({
  SPLIT: "split-delivery",
  EXPEDITE: "expedite",
  ALTERNATIVE: "alternative-stock",
});

export const SCENARIO_TITLE = Object.freeze({
  [SCENARIO.SPLIT]: "Split the delivery",
  [SCENARIO.EXPEDITE]: "Expedite it",
  [SCENARIO.ALTERNATIVE]: "Source it elsewhere",
});

/**
 * What each needs before it can say anything.
 *
 * Taken from `specs/06` rather than from what happens to be convenient. Each
 * entry is a field name and the question a person is actually asked — "what
 * is the freight cost for a second delivery" is answerable; "freightCost" is
 * a form label.
 */
export const NEEDS = Object.freeze({
  [SCENARIO.SPLIT]: Object.freeze([
    ["firstQuantity", "How many are needed in the first delivery?"],
    ["totalQuantity", "How many in total?"],
    ["secondFreight", "What does the second delivery cost in freight?"],
    ["firstDate", "When would the first delivery arrive?"],
    ["secondDate", "And the second?"],
  ]),
  [SCENARIO.EXPEDITE]: Object.freeze([
    ["quantity", "How many are being expedited?"],
    ["premiumPerUnit", "What is the expediting premium per unit?"],
    ["newDate", "What date does expediting achieve?"],
    ["confirmedBy", "Who confirmed that date with the carrier or supplier?"],
  ]),
  [SCENARIO.ALTERNATIVE]: Object.freeze([
    ["availableQuantity", "How many can the alternative source supply?"],
    ["unitCost", "What does it cost per unit there?"],
    ["leadTimeDays", "How many days is its lead time?"],
    ["suitabilityReviewedBy", "Who reviewed whether the alternative is suitable?"],
  ]),
});

/** Whether a value counts as supplied. Blank, null and absent are all missing. */
const given = (v) =>
  v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");

/**
 * The questions a scenario cannot proceed without.
 *
 * Returned as questions rather than field names so a caller cannot render a
 * form label where a sentence belongs.
 */
export function questionsFor(kind, inputs = {}) {
  const needs = NEEDS[kind];
  if (!needs) throw new TypeError(`"${kind}" is not a scenario this understands`);
  return Object.freeze(
    needs.filter(([field]) => !given(inputs[field]))
      .map(([field, question]) => Object.freeze({ field, question })));
}

/* ----------------------------------------------------------- the copies */

let minted = 0;

/** A stable id for a scenario, distinct from the plan it came from. */
export function newScenarioId(kind) {
  return `WHATIF-${kind}-${Date.now().toString(36)}-${(minted++).toString(36).padStart(3, "0")}`;
}

/**
 * Work out one scenario, or say what it is waiting for.
 *
 * `base` is the plan as it stands: the unit price, the quantity and the date
 * it is expected. Nothing in it is modified — `basedOn` records which plan
 * and which revision this was explored against, so a scenario cannot outlive
 * the plan it was about without that being visible.
 */
export function whatIf(kind, { base, inputs = {}, at = new Date().toISOString() } = {}) {
  if (!SCENARIO_TITLE[kind]) throw new TypeError(`"${kind}" is not a scenario this understands`);
  if (!base || !base.unitPrice || typeof base.unitPrice.minor !== "bigint") {
    throw new TypeError("A scenario needs the plan it is an alternative to, with exact money.");
  }

  const questions = questionsFor(kind, inputs);
  const shell = Object.freeze({
    id: newScenarioId(kind),
    kind,
    title: SCENARIO_TITLE[kind],
    /* `specs/06`: an explicit badge. It is a field rather than a caller's
       styling choice, so a surface cannot render a scenario as though it were
       the plan. */
    badge: "WHAT IF — NOT THE PLAN",
    basedOn: Object.freeze({
      planId: base.id ?? null,
      revision: base.revision ?? null,
      at,
    }),
    adopted: null,
    questions,
  });

  if (questions.length > 0) {
    /* No figures at all. Not a partial comparison, not the two axes that
       happen to be answerable — a scenario showing three of four columns
       invites somebody to read the three. */
    return Object.freeze({
      ...shell,
      ready: false,
      compared: null,
      said: `This cannot be worked out yet. ${questions.length} thing`
          + `${questions.length === 1 ? " is" : "s are"} missing, and a figure without `
          + "them would be a guess wearing an answer's clothes.",
    });
  }

  return Object.freeze({
    ...shell,
    ready: true,
    compared: compare(kind, base, inputs),
    said: null,
  });
}

/* ------------------------------------------------------- the arithmetic */

/**
 * The four axes `specs/06` asks for: cost, timing, service and what is
 * unresolved.
 *
 * Each scenario fills them differently, and none of them is scored or
 * totalled into a single number. A composite would let a large cost saving
 * outvote a missed build date, which is a judgement nobody asked this to
 * make.
 */
function compare(kind, base, inputs) {
  if (kind === SCENARIO.SPLIT) return splitDelivery(base, inputs);
  if (kind === SCENARIO.EXPEDITE) return expedite(base, inputs);
  return alternativeStock(base, inputs);
}

/**
 * Two deliveries instead of one.
 *
 * The cost of the option is the freight for the second delivery. The unit
 * price does not change — nothing here assumes a supplier would reprice a
 * split, because that is a thing to ask them rather than a thing to model.
 */
function splitDelivery(base, inputs) {
  const first = count(inputs.firstQuantity, "the first delivery's quantity");
  const total = count(inputs.totalQuantity, "the total quantity");
  if (first > total) {
    throw new RangeError(
      `The first delivery (${first}) is more than the total (${total}). Check which is which.`);
  }

  const extra = money(inputs.secondFreight, base.unitPrice.currency, "the second delivery's freight");

  return Object.freeze({
    cost: Object.freeze({
      extra,
      said: `Splitting adds ${moneyToDecimalString(extra)} ${extra.currency} in freight for the `
          + "second delivery. The unit price is unchanged — whether the supplier would reprice a "
          + "split is a question for them, not something worked out here.",
    }),
    timing: Object.freeze({
      firstDate: String(inputs.firstDate),
      secondDate: String(inputs.secondDate),
      said: `${first} arrive on ${inputs.firstDate} and the remaining ${total - first} on `
          + `${inputs.secondDate}.`,
    }),
    service: Object.freeze({
      covered: first,
      short: total - first,
      said: total - first > 0n
        ? `${total - first} are not covered until the second delivery.`
        : "The first delivery covers the whole requirement.",
    }),
    unresolved: Object.freeze([
      "Whether the supplier accepts a split at the same unit price.",
      "Whether the second date is one the supplier has agreed or one you have assumed.",
    ]),
  });
}

/**
 * Pay to have it sooner.
 *
 * The premium is per unit and multiplied exactly. `specs/06` asks for
 * confirmed transit alternatives, so who confirmed the date is a required
 * input rather than a nicety — an expediting date nobody stands behind is the
 * expensive kind of optimism.
 */
function expedite(base, inputs) {
  const qty = count(inputs.quantity, "the quantity being expedited");
  const perUnit = money(inputs.premiumPerUnit, base.unitPrice.currency, "the premium per unit");
  const premium = moneyTimesQuantity(perUnit, qty);

  return Object.freeze({
    cost: Object.freeze({
      extra: premium,
      said: `Expediting ${qty} at ${moneyToDecimalString(perUnit)} ${perUnit.currency} each adds `
          + `${moneyToDecimalString(premium)} ${premium.currency}.`,
    }),
    timing: Object.freeze({
      newDate: String(inputs.newDate),
      said: `Expediting achieves ${inputs.newDate}, confirmed by ${inputs.confirmedBy}.`,
    }),
    service: Object.freeze({
      covered: qty,
      short: 0n,
      said: "The whole quantity arrives on the expedited date.",
    }),
    unresolved: Object.freeze([
      "Whether the premium is one-off or sets a precedent for the next late order.",
      "Whether the expedited date is contractual or best-efforts.",
    ]),
  });
}

/**
 * Buy it somewhere else.
 *
 * The comparison is against the plan's own unit price, and the difference is
 * reported as a difference rather than a saving. A cheaper alternative that
 * cannot be used is not a saving, and whether it can be used is the
 * suitability review this refuses to proceed without.
 */
function alternativeStock(base, inputs) {
  const available = count(inputs.availableQuantity, "the quantity available");
  const days = count(inputs.leadTimeDays, "the lead time in days");

  /* The alternative may quote in its own currency, and if it does this stops
     rather than converting.
     *
     * The first version built this amount with the plan's currency and then
     * called assertSameCurrency on it — comparing a value with itself, a
     * guard that could never fire. Taking the currency from the input is what
     * makes the check real. Converting would need a dated, sourced rate, which
     * fx.mjs refuses to invent and this has not been given. */
  const currency = String(inputs.unitCostCurrency || base.unitPrice.currency).toUpperCase();
  const unit = money(inputs.unitCost, currency, "the alternative's unit cost");
  if (currency !== base.unitPrice.currency) {
    throw new RangeError(
      `The alternative is quoted in ${currency} and the plan is in ${base.unitPrice.currency}. `
      + "Converting needs a dated, sourced rate, which this has not been given — supply the "
      + "alternative's price in the plan's currency, or convert it deliberately first.");
  }

  const dearer = unit.minor > base.unitPrice.minor;
  const perUnit = dearer
    ? moneySub(unit, base.unitPrice)
    : moneySub(base.unitPrice, unit);
  const across = moneyTimesQuantity(perUnit, available);

  return Object.freeze({
    cost: Object.freeze({
      extra: dearer ? across : null,
      lower: dearer ? null : across,
      said: `${moneyToDecimalString(perUnit)} ${perUnit.currency} per unit `
          + `${dearer ? "more" : "less"} than the plan, or `
          + `${moneyToDecimalString(across)} ${across.currency} across ${available}. `
          + "A difference, not a saving: whether it can be used is the suitability review.",
    }),
    timing: Object.freeze({
      leadTimeDays: days,
      said: `${days} days from order.`,
    }),
    service: Object.freeze({
      covered: available,
      short: null,
      said: `The alternative can supply ${available}. Whether that is the whole requirement `
          + "depends on the requirement, which this has not been told.",
    }),
    unresolved: Object.freeze([
      `Whether ${inputs.suitabilityReviewedBy}'s review covers this application.`,
      "Whether the existing supplier's agreement permits sourcing elsewhere.",
      "Whether the alternative's price holds for the quantity actually needed.",
    ]),
  });
}

/* --------------------------------------------------------------- adopting */

/**
 * Take a scenario as the plan.
 *
 * A deliberate act with a name against it, and one that produces a record
 * rather than changing anything itself. `specs/06`: *"Adoption requires a
 * deliberate confirm action and records scenario lineage."* The caller
 * applies it; this is the evidence that somebody chose to.
 */
export function adopt(scenario, by) {
  if (!scenario || !scenario.id) throw new TypeError("There is no scenario to adopt.");
  if (!scenario.ready) {
    throw new RangeError(
      "This scenario is still missing inputs, so there is nothing settled to adopt.");
  }
  if (!by) throw new TypeError("Adopting a scenario has to record who did it.");

  return Object.freeze({
    ...scenario,
    adopted: Object.freeze({
      by: String(by),
      at: new Date().toISOString(),
      /* Lineage: which plan, at which revision, this was explored against.
         A scenario adopted against a revision the plan has since moved past
         is a decision made about something that no longer exists. */
      from: scenario.basedOn,
    }),
  });
}

/** Whether a scenario was explored against the plan as it stands now. */
export const stillAbout = (scenario, base) =>
  Boolean(scenario?.basedOn)
  && scenario.basedOn.planId === (base?.id ?? null)
  && String(scenario.basedOn.revision) === String(base?.revision ?? null);

/* ---------------------------------------------------------------- helpers */

/**
 * A whole number of things, as a BigInt.
 *
 * Nothing here is 2.5 units, and returning a Number would leave the one
 * floating-point construct in this file — which the no-float ratchet
 * correctly refused on the first run. BigInt is also what `moneyTimesQuantity`
 * takes, so the count reaches the arithmetic without a conversion on the way.
 */
function count(value, what) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new RangeError(`${what} has to be a whole number, not ${JSON.stringify(value)}.`);
  }
  return BigInt(text);
}

/** Money from a decimal string, in the plan's currency. */
function money(value, currency, what) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new RangeError(`${what} has to be an amount like 12.34, not ${JSON.stringify(value)}.`);
  }
  const [whole, frac = ""] = text.split(".");
  const minor = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return Object.freeze({ minor, currency, asOf: null });
}

export { moneyAdd, moneyToDecimalString };
