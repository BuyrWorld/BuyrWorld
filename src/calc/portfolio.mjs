/**
 * The portfolio.
 *
 * Every other module answers a question about one claim. This answers the only
 * question that can be asked of all of them at once, and it is not "how much
 * did we save":
 *
 *     Of the money that was never evidenced, how much did we actually keep?
 *
 * That ratio is the one figure that says whether any of this works. Savings
 * totals do not: a big number can mean a good process or a big supplier, and
 * there is no way to tell them apart. The unsupported remainder is different —
 * it is the part the arithmetic says nobody has justified, so resisting it is
 * the whole job, and the share resisted is a measurement of doing the job.
 *
 * Two things this refuses to do.
 *
 * It will not present a rate without saying what it rests on. A portfolio built
 * from two recorded outcomes out of eleven analysed cases is not a track
 * record, and `coverage` says so in the same breath as the number. An
 * aggregate that hides its own thinness is worse than no aggregate.
 *
 * It will not add money across currencies. Same rule as everywhere else.
 */

import { SCALE, money, moneyScale, scaleDiv, ratioToPercentString } from "./exact.mjs";
import { summariseOutcomes, VERDICT } from "./outcome.mjs";

const pct = (r) => ratioToPercentString(r, 2);
const min = (a, b) => (a < b ? a : b);

/** A currency bucket, created on demand. Money is never added across them. */
function bucket(map, currency) {
  if (!map.has(currency)) {
    map.set(currency, {
      currency,
      cases: 0,
      unsupported: 0n,   // what the arithmetic never justified
      kept: 0n,          // how much of that was resisted
      conceded: 0n,      // how much of that was paid anyway
      accepted: 0n,      // the increase actually agreed
    });
  }
  return map.get(currency);
}

/**
 * What one recorded outcome says about the unsupported remainder.
 *
 * `avoided` can exceed the unsupported amount when a settlement lands below the
 * evidenced position — a good result, but not one that can be credited to
 * resisting the unevidenced part, so it is capped. Counting it would let a
 * single generous supplier push the rate above 100% and make the measurement
 * meaningless.
 */
function unsupportedOf(record) {
  const line = record.position.annualLineValue;
  const unsupportedChange = record.position.requested - record.position.warranted;
  const avoidedChange = record.computed.avoidedChange;

  const unsupported = unsupportedChange > 0n ? moneyScale(line, unsupportedChange) : money(0n, line.currency, null);
  const cappedAvoided = avoidedChange > 0n ? min(avoidedChange, unsupportedChange > 0n ? unsupportedChange : 0n) : 0n;
  const kept = moneyScale(line, cappedAvoided);

  return {
    currency: line.currency,
    unsupported,
    kept,
    conceded: money(unsupported.minor - kept.minor, line.currency, null),
  };
}

/**
 * @param {object}  input
 * @param {Array}  [input.outcomes]  recordOutcome results
 * @param {Array}  [input.cases]     case-store records, for what is still open
 */
export function portfolio({ outcomes = [], cases = [] } = {}) {
  const records = Array.isArray(outcomes) ? outcomes : [];
  const caseList = Array.isArray(cases) ? cases : [];

  /* ------------------------------------------------------------- resisted */
  const byCurrency = new Map();
  const bySupplier = new Map();

  for (const r of records) {
    const u = unsupportedOf(r);
    const b = bucket(byCurrency, u.currency);
    b.cases++;
    b.unsupported += u.unsupported.minor;
    b.kept += u.kept.minor;
    b.conceded += u.conceded.minor;
    b.accepted += r.computed.acceptedAnnual.minor;

    const name = String(r.meta?.supplier ?? "").trim() || "(unnamed)";
    const key = name.toLowerCase();
    const s = bySupplier.get(key) ?? {
      supplier: name, currency: u.currency, claims: 0,
      unsupported: 0n, kept: 0n, conceded: 0n, aboveEvidenced: 0, mixedCurrency: false,
    };
    if (s.currency !== u.currency) s.mixedCurrency = true;
    s.claims++;
    s.unsupported += u.unsupported.minor;
    s.kept += u.kept.minor;
    s.conceded += u.conceded.minor;
    if (r.computed.versusWarranted > 0n) s.aboveEvidenced++;
    bySupplier.set(key, s);
  }

  const resisted = [...byCurrency.values()].map((b) =>
    Object.freeze({
      currency: b.currency,
      cases: b.cases,
      unsupported: money(b.unsupported, b.currency, null),
      kept: money(b.kept, b.currency, null),
      conceded: money(b.conceded, b.currency, null),
      acceptedAnnual: money(b.accepted, b.currency, null),
      // The one number worth watching.
      rate: b.unsupported > 0n ? scaleDiv(b.kept * SCALE, b.unsupported) : null,
    })
  ).sort((a, b) => (b.unsupported.minor > a.unsupported.minor ? 1 : -1));

  /* ---------------------------------------------------------------- open */
  // A case carries a summary only once it has been calculated. One that has
  // not is counted, but contributes no money — an unknown is not a zero.
  const OPEN = ["draft", "analysed", "decided"];
  const open = caseList.filter((c) => OPEN.includes(c.status));
  const openByCurrency = new Map();
  let openWithFigures = 0;

  for (const c of open) {
    const sum = c.summary;
    if (!sum || typeof sum.annualUnsupportedMinor !== "bigint" || !sum.currency) continue;
    openWithFigures++;
    const b = bucket(openByCurrency, sum.currency);
    b.cases++;
    b.unsupported += sum.annualUnsupportedMinor;
  }

  const inFlight = [...openByCurrency.values()].map((b) =>
    Object.freeze({ currency: b.currency, cases: b.cases, unsupported: money(b.unsupported, b.currency, null) })
  );

  const byStatus = {};
  for (const c of caseList) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;

  /* ------------------------------------------------------------ coverage */
  // How much of the work actually got an outcome recorded. An aggregate that
  // does not say this invites being read as a track record when it is two
  // cases out of eleven.
  const analysed = caseList.filter((c) => c.status !== "draft").length;
  const closed = caseList.filter((c) => c.status === "closed").length;
  const coverage = Object.freeze({
    casesKnown: caseList.length,
    analysed,
    closed,
    outcomesRecorded: records.length,
    // Null, not 100%, when there are no cases to compare against — an outcomes
    // file imported on its own says nothing about what was left unrecorded.
    rate: analysed > 0 ? scaleDiv(BigInt(closed) * SCALE, BigInt(analysed)) : null,
    complete: analysed > 0 && closed === analysed,
  });

  /* ----------------------------------------------------------- suppliers */
  const suppliers = [...bySupplier.values()]
    .map((s) => Object.freeze({
      supplier: s.supplier,
      claims: s.claims,
      currency: s.mixedCurrency ? null : s.currency,
      mixedCurrency: s.mixedCurrency,
      unsupported: s.mixedCurrency ? null : money(s.unsupported, s.currency, null),
      kept: s.mixedCurrency ? null : money(s.kept, s.currency, null),
      conceded: s.mixedCurrency ? null : money(s.conceded, s.currency, null),
      aboveEvidenced: s.aboveEvidenced,
      rate: s.mixedCurrency || s.unsupported <= 0n ? null : scaleDiv(s.kept * SCALE, s.unsupported),
    }))
    // Where the money is going, not who spends the most.
    .sort((a, b) => {
      const av = a.conceded ? a.conceded.minor : -1n;
      const bv = b.conceded ? b.conceded.minor : -1n;
      if (av !== bv) return bv > av ? 1 : -1;
      return b.claims - a.claims;
    });

  /* ------------------------------------------------------------ verdicts */
  const summary = summariseOutcomes(records);
  const landed = records.length
    ? Object.freeze({
        atOrBelowEvidenced:
          (summary.verdicts?.[VERDICT.AT] ?? 0) + (summary.verdicts?.[VERDICT.BETTER] ?? 0),
        aboveEvidenced:
          (summary.verdicts?.[VERDICT.WORSE] ?? 0) + (summary.verdicts?.[VERDICT.CONCEDED_UNSUPPORTED] ?? 0),
        concededInFull: summary.verdicts?.[VERDICT.CONCEDED_UNSUPPORTED] ?? 0,
      })
    : null;

  /* ------------------------------------------------------------ headline */
  const main = resisted[0] ?? null;
  const headline = !records.length
    ? "No outcomes recorded yet. Nothing here can be measured until a case is closed against what actually happened."
    : `Across ${records.length} recorded outcome${records.length === 1 ? "" : "s"}, ` +
      (main && main.rate !== null
        ? `${pct(main.rate)} of the unevidenced ask was resisted.`
        : "no unevidenced amount was in dispute.") +
      (coverage.rate !== null && !coverage.complete
        ? ` Based on ${closed} of ${analysed} analysed case${analysed === 1 ? "" : "s"}; the rest have no outcome recorded.`
        : "");

  return Object.freeze({
    outcomes: records.length,
    resisted: Object.freeze(resisted),
    inFlight: Object.freeze(inFlight),
    openCases: open.length,
    openWithoutFigures: open.length - openWithFigures,
    byStatus: Object.freeze(byStatus),
    coverage,
    suppliers: Object.freeze(suppliers),
    landed,
    arguments: summary.arguments ?? Object.freeze([]),
    meanAvoidedChange: summary.meanAvoidedChange ?? null,
    delayMonthsTotal: summary.delayMonthsTotal ?? 0,
    headline,
    method:
      "The resisted rate is the share of the unevidenced ask that was not paid, capped per case so " +
      "a settlement below the evidenced position cannot push it above 100%. It is computed from " +
      "recorded outcomes only, and coverage states how many analysed cases have one. Money is " +
      "totalled per currency and never added across them. Argument success is a buyer's judgement " +
      "recorded at the time, not a measurement.",
  });
}
