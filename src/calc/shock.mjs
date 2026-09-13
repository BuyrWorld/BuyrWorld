/**
 * Cost-shock modelling.
 *
 * The last arithmetic in the product that a user reads and nothing checks. The
 * simulator ran on `parseFloat`, float multiplication and `toFixed` — the same
 * shape the Spend Analyser had before it was extracted, and the same reason
 * `CLAUDE.md` forbids floats in this directory.
 *
 * Two things here are more than a rewrite.
 *
 * The exposure figures are not measurements. They come from multiplying spend
 * by a cost-composition share a language model proposed, which makes every
 * commodity total an assumption wearing the clothes of a calculation. The rule
 * this project set itself is that no money figure shown to a user may come from
 * a model. It cannot be followed literally here without deleting the tool, so
 * the next best thing is done instead and done loudly: the arithmetic is exact,
 * the shares are labelled `assumed`, and the provenance travels with the
 * numbers rather than sitting in a footnote.
 *
 * And a proposed mix has to add up. If a model says a category is 60% steel and
 * 60% energy, the exposure is inflated by a fifth and every figure downstream
 * is wrong in a way that looks entirely plausible. Each category's shares are
 * totalled and reported; nothing is silently normalised, because normalising
 * hides the fact that the model produced something incoherent.
 */

import {
  SCALE, ONE, money, moneyAdd, moneyScale, scaleDiv, ratioToPercentString,
} from "./exact.mjs";

export { parseAmount } from "./spend.mjs";

/** Tolerance on a category's shares summing to 100%: a quarter of a point. */
export const MIX_TOLERANCE = 2_500_000n;

/**
 * A share as an exact ratio, from "0.42" or "42%" or 0.42.
 * Returns null rather than NaN — an unreadable share must not become a zero
 * that quietly removes a commodity from the exposure.
 */
export function shareFrom(raw) {
  if (typeof raw === "bigint") return raw;
  let s = String(raw ?? "").trim();
  if (s === "") return null;
  let asPercent = false;
  if (s.endsWith("%")) { asPercent = true; s = s.slice(0, -1).trim(); }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;

  const neg = s.startsWith("-");
  const [whole, frac = ""] = (neg ? s.slice(1) : s).split(".");
  // Nine decimal places is the scale; more than that is precision nobody has.
  const digits = (frac + "000000000").slice(0, 9);
  let r = BigInt(whole) * SCALE + BigInt(digits);
  if (asPercent) r = scaleDiv(r, 100n);
  return neg ? -r : r;
}

/* ---------------------------------------------------------------- mapping */

/**
 * Spend by category, times a proposed cost composition, gives exposure by
 * commodity. Exact throughout, and honest about what it rests on.
 *
 * @param {Array}  categories  [{ name, value: Money }]
 * @param {object} mix         { categoryName: { commodity: share } }
 */
export function mapExposure(categories, mix = {}) {
  const cats = Array.isArray(categories) ? categories : [];
  const byCommodity = new Map();
  const integrity = [];
  let currency = null;
  let mapped = 0;
  let unmapped = 0;

  for (const c of cats) {
    if (!c || !c.value || typeof c.value.minor !== "bigint") continue;
    currency = currency ?? c.value.currency;
    if (c.value.currency !== currency) {
      throw new RangeError(
        `Cannot model a shock across currencies (${currency} vs ${c.value.currency}). ` +
        `Convert explicitly with a dated FX rate first.`
      );
    }

    // Matching is case-insensitive but never fuzzy: a near-miss that silently
    // lands on the wrong category would be invisible.
    const key = Object.keys(mix).find((k) => k.toLowerCase() === String(c.name).toLowerCase());
    const proposed = key ? mix[key] : null;

    if (!proposed || typeof proposed !== "object") {
      unmapped++;
      byCommodity.set("Unmapped", moneyAdd(byCommodity.get("Unmapped") ?? money(0n, currency, null), c.value));
      continue;
    }

    let sum = 0n;
    const shares = [];
    for (const [commodity, rawShare] of Object.entries(proposed)) {
      const share = shareFrom(rawShare);
      if (share === null || share < 0n) continue;   // unreadable is not zero: it is dropped and counted below
      sum += share;
      shares.push([commodity, share]);
    }

    const off = sum - ONE;
    integrity.push(Object.freeze({
      category: c.name,
      sum,
      coherent: (off < 0n ? -off : off) <= MIX_TOLERANCE,
      note: (off < 0n ? -off : off) <= MIX_TOLERANCE
        ? null
        : `The proposed mix for ${c.name} totals ${ratioToPercentString(sum, 2)}, not 100%. ` +
          `Exposure for this category is ${off > 0n ? "overstated" : "understated"} in the same proportion.`,
    }));

    for (const [commodity, share] of shares) {
      const part = moneyScale(c.value, share);
      byCommodity.set(commodity, moneyAdd(byCommodity.get(commodity) ?? money(0n, currency, null), part));
    }
    mapped++;
  }

  /* Shares are computed here rather than in whatever renders this. A page that
     divides one Money by another is the bug this module exists to remove. */
  let mappedTotal = 0n;
  for (const v of byCommodity.values()) mappedTotal += v.minor;

  const exposure = [...byCommodity.entries()]
    .map(([name, value]) => Object.freeze({
      name,
      value,
      share: mappedTotal > 0n ? scaleDiv(value.minor * SCALE, mappedTotal) : 0n,
      provenance: name === "Unmapped" ? "supplied" : "assumed",
    }))
    .sort((a, b) => (b.value.minor > a.value.minor ? 1 : b.value.minor < a.value.minor ? -1 : 0));

  const incoherent = integrity.filter((i) => !i.coherent);

  return Object.freeze({
    currency,
    exposure: Object.freeze(exposure),
    total: money(mappedTotal, currency ?? "GBP", null),
    mappedCategories: mapped,
    unmappedCategories: unmapped,
    integrity: Object.freeze(integrity),
    coherent: incoherent.length === 0,
    warnings: Object.freeze(incoherent.map((i) => i.note)),
    label: "assumed",
    note:
      "Cost composition is proposed, not measured: each commodity figure is spend multiplied by an " +
      "estimated share. The arithmetic is exact; the shares are an assumption and should be replaced " +
      "with a supplier cost breakdown before any of this is relied on.",
  });
}

/* ----------------------------------------------------------------- shocks */

/**
 * Apply a percentage movement to each exposed line.
 *
 * @param {Array}  lines   [{ name, exposure: Money, shock: Ratio }]
 * @param {object} [opts]  { baseTotal: Money } for the share-of-spend figure
 */
export function costShock(lines, { baseTotal = null } = {}) {
  const input = Array.isArray(lines) ? lines : [];
  const moved = input.filter((l) => l && l.exposure && typeof l.shock === "bigint" && l.shock !== 0n);

  if (!moved.length) {
    return Object.freeze({
      ok: false,
      reason: "No input was moved, so there is no shock to model.",
      rows: Object.freeze([]),
    });
  }

  const currency = moved[0].exposure.currency;
  let total = 0n;
  const rows = [];

  for (const l of moved) {
    if (l.exposure.currency !== currency) {
      throw new RangeError(
        `Cannot total a shock across currencies (${currency} vs ${l.exposure.currency}). ` +
        `Convert explicitly with a dated FX rate first.`
      );
    }
    const impact = moneyScale(l.exposure, l.shock);
    total += impact.minor;
    rows.push(Object.freeze({
      name: l.name,
      exposure: l.exposure,
      shock: l.shock,
      impact,
      provenance: l.provenance ?? "assumed",
    }));
  }

  // Largest absolute impact first: that is the line to act on.
  rows.sort((a, b) => {
    const A = a.impact.minor < 0n ? -a.impact.minor : a.impact.minor;
    const B = b.impact.minor < 0n ? -b.impact.minor : b.impact.minor;
    return B > A ? 1 : B < A ? -1 : 0;
  });

  const totalImpact = money(total, currency, null);
  const shareOfBase = baseTotal && baseTotal.minor > 0n
    ? scaleDiv(total * SCALE, baseTotal.minor)
    : null;

  return Object.freeze({
    ok: true,
    currency,
    rows: Object.freeze(rows),
    totalImpact,
    baseTotal,
    shareOfBase,
    direction: total > 0n ? "increase" : total < 0n ? "decrease" : "flat",
    linesMoved: moved.length,
    label: "assumed",
    method:
      "Each line is its exposure multiplied by the movement applied to it, in exact integer " +
      "arithmetic, and the total is their sum. It models a movement you chose against a cost " +
      "composition that was estimated; it is not a forecast of either.",
  });
}
