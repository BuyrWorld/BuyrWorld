/**
 * Bid normalisation.
 *
 * The heart of a sourcing decision, and the place a spreadsheet most reliably
 * misleads. Three quotes arrive; one is EXW and one DDP, one includes tooling
 * and one does not, one wants five times the minimum order. Sorting by unit
 * price produces a ranking that looks decisive and is about nothing.
 *
 * So this computes two rankings and refuses to merge them.
 *
 * The headline ranking is unit price alone — honest, useless on its own, and
 * named as such: it is the *lowest headline price*, never the best supplier.
 *
 * The landed ranking includes only what somebody has actually costed. An
 * Incoterm difference is worth money, but not an amount this can derive: the
 * freight from Rotterdam is a fact about a shipment, not about the word EXW. So
 * unpriced differences are listed rather than estimated, and while any remain
 * between the leaders the ranking is reported as unsafe — with the size of the
 * gap they would have to close, so a buyer can see what it would take.
 *
 * Two things it will not do. It will not convert a currency without a dated,
 * sourced rate, because a comparison resting on yesterday's guess at a rate is
 * a comparison of nothing. And it will not name a winner: a recommendation
 * needs technical, quality and risk judgement this has no access to.
 */

import {
  SCALE, money, moneyAdd, moneySub, moneyScale, moneyTimesQuantity,
  moneyToDecimalString, scaleDiv,
} from "./exact.mjs";
import { convertMoney } from "./fx.mjs";

const M = moneyToDecimalString;

/** Differences that change what is being bought, and cannot be inferred into money. */
export const SCOPE = Object.freeze([
  { id: "incoterm", label: "Incoterm", why: "Where the price stops. Freight, insurance and duty sit in the gap." },
  { id: "toolingCost", label: "tooling", why: "A one-off that belongs in the comparison only if the volume it is spread over is stated." },
  { id: "moq", label: "minimum order", why: "A higher minimum is inventory somebody has to hold." },
  { id: "leadTimeWeeks", label: "lead time", why: "Longer lead time is working capital and risk, not a price." },
  { id: "paymentTermsDays", label: "payment terms", why: "Shorter terms are cash out sooner." },
  { id: "validityDays", label: "validity", why: "A quote that expires first is worth less than one that holds." },
]);

/* ------------------------------------------------------------------ quote */

/**
 * One supplier's offer.
 *
 * @param {object}  input
 * @param {string}  input.supplier
 * @param {object}  input.unitPrice     Money
 * @param {number} [input.quantity]     what the price is quoted against
 * @param {object} [input.toolingCost]  Money
 */
export function quote(input = {}) {
  const supplier = String(input.supplier ?? "").trim();
  if (!supplier) throw new TypeError("A quote needs a supplier");
  if (!input.unitPrice || typeof input.unitPrice.minor !== "bigint") {
    throw new TypeError("A quote needs a unit price as Money — build it with moneyFromDecimal");
  }
  if (input.toolingCost && typeof input.toolingCost.minor !== "bigint") {
    throw new TypeError("Tooling must be Money");
  }

  const int = (v) => (Number.isInteger(v) ? v : null);
  const text = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());

  return Object.freeze({
    supplier,
    unitPrice: input.unitPrice,
    currency: input.unitPrice.currency,
    quantity: int(input.quantity),
    incoterm: text(input.incoterm),
    moq: int(input.moq),
    leadTimeWeeks: int(input.leadTimeWeeks),
    paymentTermsDays: int(input.paymentTermsDays),
    validityDays: int(input.validityDays),
    toolingCost: input.toolingCost ?? null,
    synthetic: input.synthetic !== false,
  });
}

/* ------------------------------------------------------------- normalise */

/** Tooling spread over the volume it is actually for. Arithmetic, not an assumption. */
function toolingPerUnit(q, quantity) {
  if (!q.toolingCost || q.toolingCost.minor === 0n) return null;
  const over = q.quantity ?? quantity;
  if (!Number.isInteger(over) || over <= 0) return { perUnit: null, over: null };
  return { perUnit: money(scaleDiv(q.toolingCost.minor, BigInt(over)), q.toolingCost.currency, null), over };
}

/**
 * Compare quotes without hiding what differs.
 *
 * @param {Array}   quotes
 * @param {object} [opts]
 * @param {number} [opts.quantity]     the volume the comparison is for
 * @param {object} [opts.rates]        { [currency]: fxRate } — dated and sourced
 * @param {Array}  [opts.adjustments]  [{ supplier, id, label, amount: Money, basis }]
 */
export function compareQuotes(quotes, { quantity = null, rates = {}, adjustments = [] } = {}) {
  const list = Array.isArray(quotes) ? quotes : [];
  if (list.length < 2) {
    return Object.freeze({
      ok: false,
      reason: "Two quotes are the smallest comparison that says anything.",
    });
  }

  /* ---- one currency, or a dated rate for each other one ---- */
  const base = list[0].currency;
  const converted = [];
  for (const q of list) {
    if (q.currency === base) { converted.push({ q, unitPrice: q.unitPrice, tooling: q.toolingCost }); continue; }
    const rate = rates[q.currency];
    if (!rate) {
      return Object.freeze({
        ok: false,
        reason: `${q.supplier} quoted in ${q.currency} against a ${base} comparison, and no dated rate was supplied. ` +
                `A comparison resting on a guessed rate is a comparison of nothing.`,
        missingRate: q.currency,
      });
    }
    converted.push({
      q,
      unitPrice: convertMoney(q.unitPrice, rate),
      tooling: q.toolingCost ? convertMoney(q.toolingCost, rate) : null,
      rate,
    });
  }

  /* ---- what differs across the set ---- */
  const unpriced = [];
  for (const field of SCOPE) {
    const values = new Map();
    for (const { q } of converted) {
      const v = q[field.id];
      const key = v == null ? "(not stated)" : (field.id === "toolingCost" ? M(v) : String(v));
      if (!values.has(key)) values.set(key, []);
      values.get(key).push(q.supplier);
    }
    if (values.size <= 1) continue;

    /* Tooling is the one scope difference that becomes money on its own, and
       only when the volume it spreads over is known. */
    if (field.id === "toolingCost" && (quantity || converted.every(({ q }) => q.quantity))) continue;

    unpriced.push(Object.freeze({
      id: field.id,
      label: field.label,
      why: field.why,
      values: Object.freeze([...values.entries()].map(([v, who]) => Object.freeze({ value: v, suppliers: Object.freeze(who) }))),
    }));
  }

  /* ---- landed cost: unit price, plus tooling per unit, plus what was costed ---- */
  const byId = new Map();
  for (const a of adjustments) {
    if (!a || !a.amount || typeof a.amount.minor !== "bigint") throw new TypeError("An adjustment needs a Money amount");
    if (!String(a.basis ?? "").trim()) {
      throw new TypeError(`Adjustment ${a.id ?? ""} has no basis. An unexplained adjustment explains nothing.`);
    }
    if (a.amount.currency !== base) throw new RangeError(`Adjustment ${a.id ?? ""} is in ${a.amount.currency}, not ${base}`);
    if (!byId.has(a.supplier)) byId.set(a.supplier, []);
    byId.get(a.supplier).push(Object.freeze({ id: a.id ?? null, label: a.label ?? a.id ?? "adjustment", amount: a.amount, basis: String(a.basis), state: "supplied" }));
  }

  const rows = converted.map(({ q, unitPrice, tooling, rate }) => {
    const t = tooling ? toolingPerUnit({ ...q, toolingCost: tooling }, quantity) : null;
    const applied = byId.get(q.supplier) ?? [];
    let landedMinor = unitPrice.minor;
    if (t && t.perUnit) landedMinor += t.perUnit.minor;
    for (const a of applied) landedMinor += a.amount.minor;

    return Object.freeze({
      supplier: q.supplier,
      quote: q,
      headline: unitPrice,
      convertedFrom: rate ? Object.freeze({ currency: q.currency, rate }) : null,
      toolingPerUnit: t ? t.perUnit : null,
      toolingSpreadOver: t ? t.over : null,
      adjustments: Object.freeze(applied),
      landed: money(landedMinor, base, null),
    });
  });

  const byHeadline = [...rows].sort((a, b) => (a.headline.minor > b.headline.minor ? 1 : a.headline.minor < b.headline.minor ? -1 : 0));
  const byLanded = [...rows].sort((a, b) => (a.landed.minor > b.landed.minor ? 1 : a.landed.minor < b.landed.minor ? -1 : 0));

  const lead = byLanded[0];
  const second = byLanded[1];
  const gap = moneySub(second.landed, lead.landed);

  /* ---- can the ranking be relied on? ----
     Only when nothing material is left uncosted. While a scope difference has
     no number against it, the gap is a number about an incomplete comparison. */
  const rankingSafe = unpriced.length === 0;
  const annualGap = quantity ? moneyTimesQuantity(gap, BigInt(quantity)) : null;

  const orderChanged = byHeadline[0].supplier !== byLanded[0].supplier;

  return Object.freeze({
    ok: true,
    currency: base,
    quantity,
    rows: Object.freeze(rows),
    byHeadline: Object.freeze(byHeadline),
    byLanded: Object.freeze(byLanded),
    /* Named carefully. This is the lowest of what has been costed, not a verdict. */
    lowestHeadline: byHeadline[0].supplier,
    lowestCosted: lead.supplier,
    orderChangedByCosting: orderChanged,
    gap,
    annualGap,
    unpriced: Object.freeze(unpriced),
    rankingSafe,
    statement:
      `${byHeadline[0].supplier} has the lowest headline price at ${base} ${M(byHeadline[0].headline)} a unit. ` +
      (orderChanged
        ? `Once tooling and the costed differences are included, ${lead.supplier} is lowest instead. `
        : `It is still lowest once tooling and the costed differences are included. `) +
      (rankingSafe
        ? `The gap to ${second.supplier} is ${base} ${M(gap)} a unit` +
          (annualGap ? `, ${base} ${M(annualGap)} across ${quantity} units` : "") + `.`
        : `The gap to ${second.supplier} is ${base} ${M(gap)} a unit, but ${unpriced.length} difference(s) ` +
          `have no figure against them — ${unpriced.map((u) => u.label).join(", ")} — so that gap is not a ranking.`),
    method:
      "Two rankings, kept apart. The headline is unit price alone. The costed ranking adds tooling " +
      "spread over the stated volume and any difference somebody has actually priced, each carrying " +
      "its basis. Nothing is inferred: an Incoterm is not converted into freight, and a currency is " +
      "not converted without a dated, sourced rate. No supplier is recommended — that needs technical, " +
      "quality and risk judgement this does not have.",
  });
}

/**
 * What to ask each supplier before the comparison means anything.
 * Derived from what is missing, so it is a list of gaps rather than advice.
 */
export function questionsFor(result) {
  if (!result || !result.ok) return Object.freeze([]);
  const out = [];
  for (const u of result.unpriced) {
    for (const v of u.values) {
      if (v.value !== "(not stated)") continue;
      out.push(Object.freeze({
        suppliers: v.suppliers,
        field: u.label,
        question: `Ask ${v.suppliers.join(" and ")} for the ${u.label}. ${u.why}`,
      }));
    }
  }
  for (const u of result.unpriced) {
    if (u.values.some((v) => v.value === "(not stated)")) continue;
    out.push(Object.freeze({
      suppliers: Object.freeze(result.rows.map((r) => r.supplier)),
      field: u.label,
      question: `Cost the ${u.label} difference, or the comparison stays a headline. ${u.why}`,
    }));
  }
  return Object.freeze(out);
}
