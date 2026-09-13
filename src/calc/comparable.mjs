/**
 * Comparable parts.
 *
 * Part numbers do not travel. The same bracket bought from two suppliers, or
 * drawn twice a decade apart, carries two numbers and no relationship — so the
 * question "are we paying a sensible price for this" has no internal answer
 * even when the organisation has bought something nearly identical for years.
 *
 * This compares on what a part *is* rather than what it is called, and it does
 * two things differently from the obvious version.
 *
 * A similarity figure is never a black box. Every attribute carries a stated
 * weight, and the result lists what matched, what differed, and what nobody
 * recorded. "82% comparable" that cannot be taken apart is not a finding, it is
 * a number with a percent sign.
 *
 * And an unknown is not a match. Two parts agreeing on everything recorded,
 * with half the model unrecorded, are not highly comparable — they are barely
 * compared. Comparability is therefore reported against what was actually
 * checkable, with coverage stated beside it, because the tempting arithmetic
 * (matched over total, unknowns quietly excluded) flatters exactly the pairs
 * that deserve least confidence.
 *
 * What this will not do is call a part overpriced. It computes the gap, shows
 * the differences that could account for some of it, and reports the remainder
 * nothing explains — the same shape as the cost bridge, for the same reason: a
 * buyer needs to know which part of a difference is argued and which is
 * assumed.
 */

import {
  SCALE, ONE, money, moneySub, moneyScale, moneyTimesQuantity,
  moneyToDecimalString, scaleDiv, ratioToPercentString,
} from "./exact.mjs";

const pct = (r) => ratioToPercentString(r, 2);

/**
 * What makes two parts comparable, and how much each matters.
 *
 * Weights are small integers, argued rather than fitted: material and process
 * decide whether it is the same thing at all; finish and geography shift a
 * price without changing what was bought.
 */
export const ATTRIBUTES = Object.freeze([
  { id: "material", label: "material", weight: 3 },
  { id: "specification", label: "specification", weight: 3 },
  { id: "process", label: "manufacturing route", weight: 3 },
  { id: "rawForm", label: "raw form", weight: 2 },
  { id: "tolerance", label: "tolerance class", weight: 2 },
  { id: "heatTreatment", label: "heat treatment", weight: 2 },
  { id: "inspection", label: "inspection requirement", weight: 2 },
  { id: "certification", label: "certification", weight: 2 },
  { id: "sizeBand", label: "size band", weight: 2 },
  { id: "volumeBand", label: "volume band", weight: 2 },
  { id: "surfaceFinish", label: "surface finish", weight: 1 },
  { id: "geography", label: "manufacturing geography", weight: 1 },
]);

const BY_ID = new Map(ATTRIBUTES.map((a) => [a.id, a]));
const TOTAL_WEIGHT = ATTRIBUTES.reduce((n, a) => n + a.weight, 0);

/** Comparison is on meaning, not typography. */
const norm = (v) =>
  v == null ? null : String(v).toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim() || null;

/* ------------------------------------------------------------------ part */

/**
 * A part, described by what it is.
 *
 * @param {object}  input
 * @param {string}  input.ref               the organisation's own number
 * @param {string} [input.supplier]
 * @param {object} [input.attributes]       any subset of ATTRIBUTES ids
 * @param {object} [input.unitPrice]        Money
 * @param {number} [input.annualVolume]
 */
export function comparablePart(input = {}) {
  const ref = String(input.ref ?? "").trim();
  if (!ref) throw new TypeError("A part needs a reference");

  const attributes = {};
  for (const key of Object.keys(input.attributes ?? {})) {
    if (!BY_ID.has(key)) throw new RangeError(`${key} is not a comparison attribute`);
    const v = norm(input.attributes[key]);
    if (v !== null) attributes[key] = v;
  }

  if (input.unitPrice && typeof input.unitPrice.minor !== "bigint") {
    throw new TypeError("unitPrice must be Money — build it with moneyFromDecimal");
  }

  return Object.freeze({
    ref,
    supplier: input.supplier ? String(input.supplier).trim() : null,
    attributes: Object.freeze(attributes),
    unitPrice: input.unitPrice ?? null,
    annualVolume: Number.isInteger(input.annualVolume) ? input.annualVolume : null,
    /* How much of the model this part actually describes. A part with three
       attributes filled in cannot be strongly comparable to anything. */
    describedWeight: ATTRIBUTES.reduce((n, a) => n + (attributes[a.id] ? a.weight : 0), 0),
    synthetic: input.synthetic !== false,
  });
}

/* ------------------------------------------------------------- compare */

/**
 * Compare two parts.
 *
 * `comparability` is the share of *checkable* weight that matched — the weight
 * both parts recorded. `coverage` says how much of the model was checkable at
 * all. Reading the first without the second is the error this shape exists to
 * prevent.
 */
export function compare(a, b) {
  const matched = [];
  const differed = [];
  const unknown = [];

  let checkable = 0;
  let agreeing = 0;

  for (const attr of ATTRIBUTES) {
    const av = a.attributes[attr.id] ?? null;
    const bv = b.attributes[attr.id] ?? null;

    if (av === null || bv === null) {
      unknown.push(Object.freeze({
        id: attr.id,
        label: attr.label,
        weight: attr.weight,
        missingFrom: av === null && bv === null ? "both" : (av === null ? a.ref : b.ref),
      }));
      continue;
    }

    checkable += attr.weight;
    if (av === bv) {
      agreeing += attr.weight;
      matched.push(Object.freeze({ id: attr.id, label: attr.label, weight: attr.weight, value: av }));
    } else {
      differed.push(Object.freeze({ id: attr.id, label: attr.label, weight: attr.weight, a: av, b: bv }));
    }
  }

  const comparability = checkable === 0 ? null : scaleDiv(BigInt(agreeing) * SCALE, BigInt(checkable));
  const coverage = scaleDiv(BigInt(checkable) * SCALE, BigInt(TOTAL_WEIGHT));

  /* Thin when less than half the model could be checked. A pair agreeing on two
     attributes out of twelve is not 100% comparable in any useful sense. */
  const thin = checkable * 2 < TOTAL_WEIGHT;

  const statement = comparability === null
    ? `${a.ref} and ${b.ref} share no recorded attribute, so nothing can be compared.`
    : `${pct(comparability)} of what could be checked matched` +
      (thin ? `, but only ${pct(coverage)} of the comparison model was recorded for both. Treat this as barely compared.` : `.`) +
      (differed.length ? ` Differs on ${differed.map((d) => d.label).join(", ")}.` : ``);

  return Object.freeze({
    a: a.ref,
    b: b.ref,
    comparability,
    coverage,
    thin,
    checkableWeight: checkable,
    totalWeight: TOTAL_WEIGHT,
    matched: Object.freeze(matched),
    differed: Object.freeze(differed),
    unknown: Object.freeze(unknown),
    statement,
  });
}

/**
 * Rank candidates against a target.
 *
 * Barely-compared pairs sort below every properly compared one, whatever their
 * percentage. Ordering by percentage alone puts a part described by two
 * attributes — which will score 100% almost every time — at the top of a list
 * of genuine comparables, and the one that most deserves scrutiny is then the
 * one a reader trusts most. Within each group it is percentage, then how much
 * was checkable.
 */
export function findComparable(target, candidates, { minimum = null } = {}) {
  const list = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && c.ref !== target.ref)
    .map((c) => Object.freeze({ part: c, ...compare(target, c) }))
    .filter((r) => r.comparability !== null)
    .filter((r) => (minimum === null ? true : r.comparability >= minimum))
    .sort((x, y) =>
      (Number(x.thin) - Number(y.thin)) ||
      (y.comparability > x.comparability ? 1 : y.comparability < x.comparability ? -1 : 0) ||
      (y.checkableWeight - x.checkableWeight) ||
      x.b.localeCompare(y.b));

  return Object.freeze({
    target: target.ref,
    matches: Object.freeze(list),
    best: list[0] ?? null,
    note: list.length
      ? null
      : "Nothing recorded is comparable enough to say anything. Describe more of the parts, or widen the threshold.",
  });
}

/* --------------------------------------------------------- price gap */

/**
 * The price difference between two parts, and how much of it is explained.
 *
 * Adjustments are supplied, not inferred. A volume difference only explains
 * money if somebody states the rate at which it should; this will not invent
 * a learning curve. Each adjustment is labelled and summed, and whatever the
 * adjustments do not account for is returned as the unexplained remainder —
 * the only figure here worth arguing about.
 *
 * It does not conclude that either part is overpriced. That is a judgement
 * resting on facts this has no access to.
 *
 * @param {object} a  the part being questioned
 * @param {object} b  the comparator
 * @param {Array} [adjustments]  [{ id, label, amount: Money, basis }]
 */
export function priceGap(a, b, adjustments = []) {
  if (!a.unitPrice || !b.unitPrice) {
    return Object.freeze({
      ok: false,
      reason: "Both parts need a unit price before a gap means anything.",
    });
  }
  if (a.unitPrice.currency !== b.unitPrice.currency) {
    throw new RangeError(
      `Cannot compare prices across currencies (${a.unitPrice.currency} vs ${b.unitPrice.currency}). ` +
      `Convert explicitly with a dated FX rate first.`
    );
  }

  const cur = a.unitPrice.currency;
  const gap = moneySub(a.unitPrice, b.unitPrice);

  let explained = 0n;
  const applied = [];
  for (const adj of adjustments) {
    if (!adj || !adj.amount || typeof adj.amount.minor !== "bigint") {
      throw new TypeError("An adjustment needs a Money amount");
    }
    if (adj.amount.currency !== cur) {
      throw new RangeError(`Adjustment ${adj.id ?? ""} is in ${adj.amount.currency}, not ${cur}`);
    }
    if (!String(adj.basis ?? "").trim()) {
      throw new TypeError(
        `Adjustment ${adj.id ?? ""} has no basis. An unexplained adjustment explains nothing.`
      );
    }
    explained += adj.amount.minor;
    applied.push(Object.freeze({
      id: adj.id ?? null,
      label: adj.label ?? adj.id ?? "adjustment",
      amount: adj.amount,
      basis: String(adj.basis),
      label_state: "assumed",
    }));
  }

  const unexplained = money(gap.minor - explained, cur, null);
  const annual = a.annualVolume != null
    ? moneyTimesQuantity(unexplained, BigInt(a.annualVolume))
    : null;

  return Object.freeze({
    ok: true,
    currency: cur,
    a: Object.freeze({ ref: a.ref, unitPrice: a.unitPrice, annualVolume: a.annualVolume }),
    b: Object.freeze({ ref: b.ref, unitPrice: b.unitPrice }),
    gap,
    explained: money(explained, cur, null),
    unexplained,
    unexplainedAnnual: annual,
    adjustments: Object.freeze(applied),
    /* Deliberately not a verdict. */
    statement:
      `${a.ref} is ${cur} ${moneyToDecimalString(gap)} a unit ` +
      `${gap.minor >= 0n ? "above" : "below"} ${b.ref}. ` +
      (applied.length
        ? `${cur} ${moneyToDecimalString(money(explained, cur, null))} is accounted for by stated differences; `
        : `No differences have been costed, so `) +
      `${cur} ${moneyToDecimalString(unexplained)} is not accounted for` +
      (annual ? `, which is ${cur} ${moneyToDecimalString(annual)} a year at ${a.annualVolume} units` : "") +
      `.`,
    method:
      "The gap is arithmetic. The adjustments are supplied, not inferred — nothing here derives a " +
      "volume curve or a material index on its own, and each adjustment carries the basis somebody " +
      "gave it. The remainder is what those differences do not account for; it is a question to put " +
      "to the supplier, not a finding that either part is mispriced.",
  });
}
