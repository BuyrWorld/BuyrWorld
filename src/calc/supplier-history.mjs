/**
 * Supplier claim history.
 *
 * `recordOutcome` has been capturing `meta.supplier` on every case since it was
 * written. `summariseOutcomes` groups by currency and by argument, and never by
 * supplier — so the data has been accumulating into a dimension nothing reads.
 * This reads it.
 *
 * The point is not a scoreboard. It is that a second letter from the same
 * supplier is not a fresh negotiation, and the file already knows why:
 *
 * - what they asked for last time, what was evidenced, and what was agreed;
 * - whether the gap between their ask and the evidence is a pattern or a one-off;
 * - which drivers they claim every single time, and how often those were ever
 *   supported — a driver claimed three times and evidenced once is the most
 *   useful sentence in the room;
 * - which arguments have actually moved this supplier, as opposed to moving
 *   suppliers in general.
 *
 * Two rules it keeps. Money is never summed across currencies — totals are
 * returned per currency rather than added into a number that means nothing. And
 * nothing here is a prediction: a pattern in three claims is three claims, and
 * the method note says so rather than implying a trend.
 */

import { SCALE, money, moneyAdd, moneyScale, scaleDiv, ratioToPercentString } from "./exact.mjs";
import { VERDICT } from "./outcome.mjs";

const pct = (r) => ratioToPercentString(r, 2);

/** Mean of a list of Ratios, exact. Empty is null, not zero. */
function meanRatio(values) {
  if (!values.length) return null;
  let total = 0n;
  for (const v of values) total += v;
  return scaleDiv(total, BigInt(values.length));
}

/** Chronological where a date exists; recorded order otherwise. */
function chronologically(records) {
  return [...records].sort((a, b) => {
    const ad = a.meta?.recordedAt ?? a.timing?.agreedEffectiveFrom ?? "";
    const bd = b.meta?.recordedAt ?? b.timing?.agreedEffectiveFrom ?? "";
    if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
    return 0;
  });
}

/**
 * Every claim this supplier has made, and what it teaches.
 *
 * @param {Array}  records   recordOutcome results
 * @param {string} supplier  the name to match, case-insensitively
 */
export function supplierHistory(records, supplier) {
  const want = String(supplier ?? "").trim().toLowerCase();
  if (!want) {
    return Object.freeze({ supplier: null, count: 0, note: "No supplier named, so no history can be read." });
  }

  const mine = chronologically(
    (Array.isArray(records) ? records : []).filter(
      (r) => String(r?.meta?.supplier ?? "").trim().toLowerCase() === want
    )
  );

  if (!mine.length) {
    return Object.freeze({
      supplier,
      count: 0,
      claims: Object.freeze([]),
      note: "No previous claims recorded for this supplier. Nothing here says they have not made any — only that none was recorded.",
    });
  }

  /* ------------------------------------------------------------- the rows */
  const claims = mine.map((r, i) => {
    const line = r.position.annualLineValue;
    const above = r.computed.versusWarranted > 0n ? r.computed.versusWarranted : 0n;
    return Object.freeze({
      round: i + 1,
      caseRef: r.meta.caseRef ?? null,
      category: r.meta.category ?? null,
      at: r.meta.recordedAt ?? r.timing?.agreedEffectiveFrom ?? null,
      currency: r.position.currency,
      requested: r.position.requested,
      warranted: r.position.warranted,
      agreed: r.position.agreed,
      verdict: r.computed.verdict,
      avoidedAnnual: r.computed.avoidedAnnual,
      /* What was conceded beyond what the evidence supported. Zero when the
         agreement landed at or below the evidenced position. */
      concededAboveWarranted: above,
      concededAboveWarrantedAnnual: moneyScale(line, above),
      overAsk: r.position.requested - r.position.warranted,
      synthetic: r.meta.synthetic !== false,
    });
  });

  /* ------------------------------------------------------------- the money */
  // Per currency, never across. Adding GBP to EUR would be a figure that
  // looks authoritative and means nothing.
  const totals = new Map();
  for (const c of claims) {
    const acc = totals.get(c.currency) ?? {
      currency: c.currency,
      avoided: money(0n, c.currency, null),
      concededAboveWarranted: money(0n, c.currency, null),
      claims: 0,
    };
    acc.avoided = moneyAdd(acc.avoided, c.avoidedAnnual);
    acc.concededAboveWarranted = moneyAdd(acc.concededAboveWarranted, c.concededAboveWarrantedAnnual);
    acc.claims++;
    totals.set(c.currency, acc);
  }

  /* ----------------------------------------------------------- the pattern */
  const averages = Object.freeze({
    requested: meanRatio(claims.map((c) => c.requested)),
    warranted: meanRatio(claims.map((c) => c.warranted)),
    agreed: meanRatio(claims.map((c) => c.agreed)),
    /* How much more they ask for than the evidence supports. One claim is an
       occasion; the same gap three times is how this supplier opens. */
    overAsk: meanRatio(claims.map((c) => c.overAsk)),
  });

  const counts = Object.freeze({
    claims: claims.length,
    concededUnsupportedInFull: claims.filter((c) => c.verdict === VERDICT.CONCEDED_UNSUPPORTED).length,
    aboveEvidencedPosition: claims.filter((c) => c.concededAboveWarranted > 0n).length,
    atEvidencedPosition: claims.filter((c) => c.verdict === VERDICT.AT).length,
    betterThanEvidenced: claims.filter((c) => c.verdict === VERDICT.BETTER).length,
  });

  /* ----------------------------------------------------------- the drivers */
  // The repeat claim. Records written before drivers were retained simply
  // contribute nothing here rather than being counted as unevidenced.
  const drivers = new Map();
  let roundsWithDrivers = 0;
  for (const r of mine) {
    const list = r.claim?.drivers;
    if (!Array.isArray(list) || !list.length) continue;
    roundsWithDrivers++;
    for (const d of list) {
      const key = d.id || d.label;
      const acc = drivers.get(key) ?? {
        id: d.id, label: d.label, timesClaimed: 0, timesEvidenced: 0, contributions: [],
      };
      acc.timesClaimed++;
      if (d.evidenced) acc.timesEvidenced++;
      acc.contributions.push(d.contribution);
      drivers.set(key, acc);
    }
  }

  const driverRows = [...drivers.values()]
    .map((d) => Object.freeze({
      id: d.id,
      label: d.label,
      timesClaimed: d.timesClaimed,
      timesEvidenced: d.timesEvidenced,
      everEvidenced: d.timesEvidenced > 0,
      claimedEveryRound: roundsWithDrivers > 1 && d.timesClaimed === roundsWithDrivers,
      averageContribution: meanRatio(d.contributions),
    }))
    .sort((a, b) => {
      if (b.timesClaimed !== a.timesClaimed) return b.timesClaimed - a.timesClaimed;
      return (b.averageContribution ?? 0n) > (a.averageContribution ?? 0n) ? 1 : -1;
    });

  /* --------------------------------------------------------- the arguments */
  // What has moved THIS supplier, which is not the same question as what moves
  // suppliers in general.
  const args = new Map();
  for (const r of mine) {
    for (const a of r.learning?.argumentsUsed ?? []) {
      const acc = args.get(a.id) ?? { id: a.id, description: a.description ?? a.id, used: 0, worked: 0 };
      acc.used++;
      if (a.worked === true) acc.worked++;
      args.set(a.id, acc);
    }
  }
  const argumentRows = [...args.values()]
    .map((a) => Object.freeze({ ...a, rate: a.used ? scaleDiv(BigInt(a.worked) * SCALE, BigInt(a.used)) : null }))
    .sort((a, b) => (b.worked - a.worked) || (b.used - a.used));

  /* ---------------------------------------------------------- the sentence */
  const repeat = driverRows.filter((d) => d.claimedEveryRound && !d.everEvidenced);
  const headline =
    `${claims.length} claim${claims.length === 1 ? "" : "s"} recorded. ` +
    (averages.overAsk !== null && averages.overAsk > 0n
      ? `On average they ask ${pct(averages.overAsk)} more than the evidence supports. `
      : "") +
    (counts.aboveEvidencedPosition
      ? `${counts.aboveEvidencedPosition} of ${claims.length} settled above the evidenced position. `
      : `None settled above the evidenced position. `) +
    (repeat.length
      ? `${repeat.map((d) => d.label).join(" and ")} ${repeat.length === 1 ? "has" : "have"} been claimed every round and never evidenced.`
      : "");

  return Object.freeze({
    supplier,
    count: claims.length,
    claims: Object.freeze(claims),
    totals: Object.freeze([...totals.values()].map(Object.freeze)),
    mixedCurrency: totals.size > 1,
    averages,
    counts,
    drivers: Object.freeze(driverRows),
    driverRoundsAvailable: roundsWithDrivers,
    argumentsThatWorked: Object.freeze(argumentRows),
    headline: headline.trim(),
    synthetic: claims.every((c) => c.synthetic),
    method:
      "Counts and averages describe the recorded claims only. They are history, not a forecast: " +
      "three claims are three claims, and nothing here predicts the next one. Money is totalled " +
      "per currency and never added across them.",
  });
}

/**
 * Every supplier with a recorded claim, worst pattern first.
 *
 * "Worst" is ordered by how often a settlement landed above the evidenced
 * position, then by how many claims there are — not by money, which would just
 * rank the biggest line items.
 */
export function historyBySupplier(records) {
  const names = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    const raw = String(r?.meta?.supplier ?? "").trim();
    if (!raw) continue;
    if (!names.has(raw.toLowerCase())) names.set(raw.toLowerCase(), raw);
  }
  return Object.freeze(
    [...names.values()]
      .map((name) => supplierHistory(records, name))
      .sort((a, b) =>
        (b.counts?.aboveEvidencedPosition ?? 0) - (a.counts?.aboveEvidencedPosition ?? 0) ||
        b.count - a.count)
  );
}
